//! 届くかを尋ねる係（版 3.114.0。S12b）。届かない共有（SMB・眠ったサーバー・切れた VPN）の読みは OS の待ちが長く、尋ねた糸は
//! 打ち切れない。前は「参照…」（folder_browse の bounded・places）・マスタの置き場の状態（master_place の PROBES）・使っている PC
//! （using）が別々に糸を立て、status のほかは尋ねるたびに糸を積んだ（止まる共有へ「参照…」を開き直すたびに増えた）。
//!
//! ここは 1 つの係: 鍵（normcase した道の根〈X:\ か \\サーバー\共有〉と尋ね方）ごとに走る糸は 1 本。止まりうる道（共有〈\\…〉と
//! Windows の割り当てたネットワークドライブ〈GetDriveTypeW が DRIVE_REMOTE〉）の尋ねだけを全体で LIMIT 本までに数える（版 3.114.0 の作った後の
//! 採点の割れ 2: 止まる共有が上限を塞ぐと、ローカルの C:\ の「参照…」まで待たされた）。人が押した「参照…」（browse）は上限で待たせない。
//! 割り当てたドライブ（Z:\）とその実体の \\サーバー\共有 は別の鍵（同じサーバーへ 2 本まで。どちらも上限に数える。windows_risks 4）。
//! 並んだ行（places・using）は wait_all でまとめて待つ（空きができたらすぐ次を起こし、終わった物から受け取る。割れ 1: 行の順に待つと、
//! 止まる行の後ろで上限を待った行が締め切りの後に起こされて消えた）。
//! 待ちは Condvar（前は 5 ms ごとに見に行った）。終わった鍵は片付ける。上限に当たった・時間切れの答えは None（呼ぶ側は reachable
//! null＝確かめ中で答え、false〈届かない〉にしない: 版 3.100.0 の決まり。null は保存を止めない）。覚え（memo）は、鍵が塞がっている・
//! 時間切れのときに、MEMO 秒以内に終わった同じ尋ね方の答えで代える（using・places の行だけ。GET /api/masters/status は呼ぶたびに確かめる）。
//! Python の 4 つの糸（folder_browse._bounded・places・master_place._bounded・using）は ?engine=python のときだけ動く（段 ④ で消える）。

use std::any::Any;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// 全体で走らせる糸の上限
pub const LIMIT: usize = 16;
/// 覚えておく秒（鍵が塞がっている・時間切れのときに代える）
pub const MEMO: Duration = Duration::from_secs(2);

type Memo = HashMap<String, (Instant, Arc<dyn Any + Send + Sync>)>;

#[derive(Default)]
struct State {
    busy: HashSet<String>,
    /// 上限に数える糸（止まりうる道）の数
    running: usize,
    memo: Memo,
    /// これまでに立てた糸（試験が見る）
    spawned: usize,
}

struct Inner {
    st: Mutex<State>,
    cv: Condvar,
    limit: usize,
}

/// 尋ねる係（このプロセスに 1 つ: PROBES。試験は自分の係を作る）
#[derive(Clone)]
pub struct Probes {
    inner: Arc<Inner>,
}

pub static PROBES: LazyLock<Probes> = LazyLock::new(|| Probes::new(LIMIT));

type Job<T> = Box<dyn FnOnce() -> T + Send>;

/// 始めた尋ね（走っている・鍵か上限で待っている）
pub struct Ticket<T> {
    key: String,
    memo: Option<String>,
    slot: Option<Arc<Mutex<Option<T>>>>,
    job: Option<Job<T>>,
}

impl Probes {
    pub fn new(limit: usize) -> Probes {
        Probes { inner: Arc::new(Inner { st: Mutex::new(State::default()), cv: Condvar::new(), limit }) }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.inner.st.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 上限に数える走っている糸の数（試験）
    pub fn running(&self) -> usize {
        self.lock().running
    }

    /// これまでに立てた糸の数（試験）
    pub fn spawned(&self) -> usize {
        self.lock().spawned
    }

    fn remembered<T: Clone + 'static>(st: &State, memo: Option<&str>) -> Option<T> {
        let (at, v) = st.memo.get(memo?)?;
        (at.elapsed() <= MEMO).then(|| v.downcast_ref::<T>().cloned()).flatten()
    }

    /// 鍵が空き、上限に余りがあれば糸を立てる（st を持ったまま）。立てたら slot
    fn launch<T: Clone + Send + Sync + 'static>(
        &self,
        st: &mut State,
        key: &str,
        memo: Option<&str>,
        job: Job<T>,
    ) -> Result<Arc<Mutex<Option<T>>>, Job<T>> {
        let limited = limited(key);
        if st.busy.contains(key) || (limited && st.running >= self.inner.limit) {
            return Err(job);
        }
        let slot: Arc<Mutex<Option<T>>> = Arc::new(Mutex::new(None));
        let (inner, k, m, sl) = (self.inner.clone(), key.to_string(), memo.map(String::from), slot.clone());
        // job を糸へ渡すため、立てられなかったときに取り戻せるよう共有の箱に入れる
        let boxed: Arc<Mutex<Option<Job<T>>>> = Arc::new(Mutex::new(Some(job)));
        let b2 = boxed.clone();
        let spawned = std::thread::Builder::new().name("probe".into()).spawn(move || {
            let f = b2.lock().unwrap_or_else(|e| e.into_inner()).take();
            let v = f.map(|f| f());
            let mut st = inner.st.lock().unwrap_or_else(|e| e.into_inner());
            st.busy.remove(&k);
            if limited {
                st.running -= 1;
            }
            if let (Some(v), Some(m)) = (v.as_ref(), m) {
                st.memo.retain(|_, (at, _)| at.elapsed() <= MEMO);
                st.memo.insert(m, (Instant::now(), Arc::new(v.clone())));
            }
            *sl.lock().unwrap_or_else(|e| e.into_inner()) = v;
            drop(st);
            inner.cv.notify_all();
        });
        match spawned {
            Ok(_) => {
                st.busy.insert(key.to_string());
                st.running += limited as usize;
                st.spawned += 1;
                Ok(slot)
            }
            Err(_) => Err(boxed.lock().unwrap_or_else(|e| e.into_inner()).take().unwrap_or_else(|| Box::new(|| unreachable!()))),
        }
    }

    /// 尋ね始める（待たない）。鍵が塞がっている・上限なら、wait で空くのを待つ（queue）か覚えで代える
    pub fn start<T, F>(&self, key: &str, memo: Option<&str>, f: F) -> Ticket<T>
    where
        T: Clone + Send + Sync + 'static,
        F: FnOnce() -> T + Send + 'static,
    {
        let mut st = self.lock();
        match self.launch(&mut st, key, memo, Box::new(f)) {
            Ok(slot) => Ticket { key: key.into(), memo: memo.map(String::from), slot: Some(slot), job: None },
            Err(job) => Ticket { key: key.into(), memo: memo.map(String::from), slot: None, job: Some(job) },
        }
    }

    /// 始めた尋ねの答えを deadline まで待つ。queue: 鍵が塞がっていた尋ねは、空くのを待ってから走らせる（偽ならすぐ覚えか None）
    pub fn wait<T: Clone + Send + Sync + 'static>(&self, mut t: Ticket<T>, deadline: Instant, queue: bool) -> Option<T> {
        let mut st = self.lock();
        if t.slot.is_none() {
            loop {
                let job = t.job.take()?;
                match self.launch(&mut st, &t.key, t.memo.as_deref(), job) {
                    Ok(slot) => {
                        t.slot = Some(slot);
                        break;
                    }
                    Err(job) => t.job = Some(job),
                }
                let now = Instant::now();
                if !queue || now >= deadline {
                    return Self::remembered(&st, t.memo.as_deref());
                }
                st = self.inner.cv.wait_timeout(st, deadline - now).unwrap_or_else(|e| e.into_inner()).0;
            }
        }
        let slot = t.slot.clone()?;
        loop {
            if let Some(v) = slot.lock().unwrap_or_else(|e| e.into_inner()).take() {
                return Some(v);
            }
            let now = Instant::now();
            if now >= deadline {
                return Self::remembered(&st, t.memo.as_deref());
            }
            st = self.inner.cv.wait_timeout(st, deadline - now).unwrap_or_else(|e| e.into_inner()).0;
        }
    }

    /// 並んだ尋ねをまとめて deadline まで待つ（空きができたら待っている尋ねをすぐ起こし、終わった物から受け取る）。答えは並びの順。
    /// 締め切りまでに答えの無い物は覚え（memo）か None
    pub fn wait_all<T: Clone + Send + Sync + 'static>(&self, tickets: Vec<Ticket<T>>, deadline: Instant) -> Vec<Option<T>> {
        let mut tickets = tickets;
        let mut out: Vec<Option<Option<T>>> = tickets.iter().map(|_| None).collect();
        let mut st = self.lock();
        loop {
            for (t, o) in tickets.iter_mut().zip(out.iter_mut()) {
                if o.is_some() {
                    continue;
                }
                if t.slot.is_none() {
                    if let Some(job) = t.job.take() {
                        match self.launch(&mut st, &t.key, t.memo.as_deref(), job) {
                            Ok(slot) => t.slot = Some(slot),
                            Err(job) => t.job = Some(job),
                        }
                    }
                }
                if let Some(v) = t.slot.as_ref().and_then(|s| s.lock().unwrap_or_else(|e| e.into_inner()).take()) {
                    *o = Some(Some(v));
                }
            }
            if out.iter().all(Option::is_some) {
                break;
            }
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            st = self.inner.cv.wait_timeout(st, deadline - now).unwrap_or_else(|e| e.into_inner()).0;
        }
        tickets.iter().zip(out).map(|(t, o)| o.unwrap_or_else(|| Self::remembered(&st, t.memo.as_deref()))).collect()
    }

    /// 尋ねて timeout まで待つ（start と wait）
    pub fn ask<T, F>(&self, key: &str, memo: Option<&str>, timeout: Duration, queue: bool, f: F) -> Option<T>
    where
        T: Clone + Send + Sync + 'static,
        F: FnOnce() -> T + Send + 'static,
    {
        let deadline = Instant::now() + timeout;
        let t = self.start(key, memo, f);
        self.wait(t, deadline, queue)
    }
}

/// 上限に数える鍵か: 尋ね方が「参照…」（browse。人が押した 1 本）でなく、道が止まりうる（共有・割り当てたネットワークドライブ）。
/// 鍵は「尋ね方:道」（root_key・master_place の status:置き場）
pub fn limited(key: &str) -> bool {
    match key.split_once(':') {
        Some((kind, path)) => kind != "browse" && remote(path),
        None => false,
    }
}

/// 止まりうる道か（共有〈\\…・//…〉と、Windows の割り当てたネットワークドライブ）
pub fn remote(path: &str) -> bool {
    if path.starts_with("\\\\") || path.starts_with("//") {
        return true;
    }
    let mut cs = path.chars();
    match (cs.next(), cs.next()) {
        (Some(d), Some(':')) if d.is_ascii_alphabetic() => drive_remote(d),
        _ => false,
    }
}

#[cfg(windows)]
fn drive_remote(d: char) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;
    let root: Vec<u16> = format!("{d}:\\").encode_utf16().chain(std::iter::once(0)).collect();
    // DRIVE_REMOTE（4）
    unsafe { GetDriveTypeW(PCWSTR::from_raw(root.as_ptr())) == 4 }
}

#[cfg(not(windows))]
fn drive_remote(_d: char) -> bool {
    false
}

/// 道の根の鍵（normcase した X:\ か \\サーバー\共有。POSIX は /）。同じ止まる共有の別のフォルダで糸を積まない
pub fn root_key(kind: &str, path: &str) -> String {
    let root = if cfg!(windows) || path.starts_with("\\\\") {
        let (d, r, _) = crate::path_gate::nt_splitroot(path);
        format!("{d}{r}")
    } else {
        "/".to_string()
    };
    format!("{kind}:{}", crate::release_place::normcase(&root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;

    /// 止まる尋ね方: 合図が来るまで返らない
    fn stuck(gate: Arc<Mutex<mpsc::Receiver<()>>>, calls: Arc<AtomicUsize>) -> impl FnOnce() -> bool + Send + 'static {
        move || {
            calls.fetch_add(1, Ordering::SeqCst);
            let _ = gate.lock().unwrap().recv();
            true
        }
    }

    #[test]
    fn one_thread_per_key_and_no_more_than_the_limit() {
        let p = Probes::new(4);
        let (tx, rx) = mpsc::channel::<()>();
        let rx = Arc::new(Mutex::new(rx));
        let calls = Arc::new(AtomicUsize::new(0));
        // 同じ鍵へ 100 回: 糸は 1 本・答えは None（確かめ中）
        for _ in 0..100 {
            let got = p.ask("reach:\\\\srv\\share", None, Duration::from_millis(5), true, stuck(rx.clone(), calls.clone()));
            assert_eq!(got, None);
        }
        assert_eq!((p.spawned(), p.running()), (1, 1), "同じ鍵は 1 本");
        // 別の鍵へ 100 回: 上限（4）までしか立てない
        for i in 0..100 {
            let got = p.ask(&format!("reach:\\\\srv{i}\\s"), None, Duration::from_millis(1), true, stuck(rx.clone(), calls.clone()));
            assert_eq!(got, None);
        }
        assert_eq!((p.spawned(), p.running()), (4, 4), "上限を超えない");
        // 止まりが解けたら片付き、次は真の答え
        for _ in 0..4 {
            tx.send(()).unwrap();
        }
        let end = Instant::now() + Duration::from_secs(5);
        while p.running() > 0 && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(p.running(), 0, "終わった鍵は片付ける");
        assert_eq!(p.ask("reach:\\\\srv\\share", None, Duration::from_secs(2), true, || 7u32), Some(7));
        assert_eq!(calls.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn a_busy_key_without_queue_answers_at_once_and_the_memo_fills_in() {
        let p = Probes::new(LIMIT);
        assert_eq!(p.ask("online:a", Some("online:a"), Duration::from_secs(2), true, || 1u8), Some(1));
        let (tx, rx) = mpsc::channel::<()>();
        let rx = Arc::new(Mutex::new(rx));
        let first = p.start("online:a", Some("online:a"), move || {
            let _ = rx.lock().unwrap().recv();
            2u8
        });
        let t0 = Instant::now();
        assert_eq!(p.ask("online:a", Some("online:a"), Duration::from_secs(3), false, || 3u8), Some(1), "塞がっている間は覚えで代える");
        assert!(t0.elapsed() < Duration::from_millis(500), "queue なしは待たない");
        assert_eq!(p.ask("online:b", None, Duration::from_secs(2), false, || 4u8), Some(4), "別の鍵は走る");
        tx.send(()).unwrap();
        assert_eq!(p.wait(first, Instant::now() + Duration::from_secs(5), false), Some(2));
    }

    #[test]
    fn a_queued_ask_runs_after_the_key_frees() {
        let p = Probes::new(LIMIT);
        let first = p.start("k", None, || {
            std::thread::sleep(Duration::from_millis(100));
            1u8
        });
        let second = p.start("k", None, || 2u8);
        let end = Instant::now() + Duration::from_secs(5);
        assert_eq!(p.wait(first, end, true), Some(1));
        assert_eq!(p.wait(second, end, true), Some(2), "同じ鍵の 2 つ目は空いてから走る");
        assert_eq!(p.spawned(), 2);
    }

    /// 作った後の採点の割れ 1: 止まる 1 行の後ろで上限を待った行も、空きができたらすぐ起こし、締め切りの中で答える（行の順に待たない）
    #[test]
    fn rows_behind_a_stuck_row_still_answer() {
        let p = Probes::new(4);
        let (tx, rx) = mpsc::channel::<()>();
        let rx = Arc::new(Mutex::new(rx));
        let r2 = rx.clone();
        let mut tickets = vec![p.start("reach:\\\\srv\\share\\", None, move || {
            let _ = r2.lock().unwrap().recv();
            true
        })];
        // 止まりうる道（共有）の速い行 20: 上限 4 なので 3 本ずつ空きを待つ
        for i in 0..20 {
            tickets.push(p.start(&format!("reach:\\\\srv{i}\\s\\"), None, move || {
                std::thread::sleep(Duration::from_millis(5));
                i % 2 == 0
            }));
        }
        let got = p.wait_all(tickets, Instant::now() + Duration::from_secs(5));
        assert_eq!(got[0], None, "止まる行は確かめ中");
        assert!(got[1..].iter().all(Option::is_some), "後ろの行も答える: {got:?}");
        assert_eq!(got[2], Some(false));
        tx.send(()).unwrap();
    }

    /// 割れ 2: 止まる共有が上限を塞いでも、ローカルの道（上限に数えない）と人が押した「参照…」は待たされない
    #[test]
    fn a_full_limit_does_not_starve_local_or_browse() {
        let p = Probes::new(16);
        let (tx, rx) = mpsc::channel::<()>();
        let rx = Arc::new(Mutex::new(rx));
        for i in 0..16 {
            let r = rx.clone();
            let _ = p.start(&format!("online:\\\\srv\\s{i}\\"), None, move || {
                let _ = r.lock().unwrap().recv();
                true
            });
        }
        assert_eq!(p.running(), 16);
        let t0 = Instant::now();
        assert_eq!(p.ask("browse:c:\\", None, Duration::from_secs(2), true, || 1u8), Some(1), "ローカルの「参照…」");
        assert_eq!(p.ask("reach:/", None, Duration::from_secs(2), true, || 2u8), Some(2), "ローカルの行");
        assert_eq!(p.ask("browse:\\\\srv2\\x\\", None, Duration::from_secs(2), true, || 3u8), Some(3), "人が押した共有の「参照…」");
        assert!(t0.elapsed() < Duration::from_secs(1));
        assert_eq!(p.ask("reach:\\\\srv3\\x\\", None, Duration::from_millis(100), true, || 4u8), None, "共有の行は上限を守る");
        for _ in 0..16 {
            tx.send(()).unwrap();
        }
    }

    #[test]
    fn what_is_limited() {
        assert!(limited("reach:\\\\srv\\s\\") && limited("online://srv/s") && limited("status:\\\\srv\\s\\M"));
        assert!(!limited("browse:\\\\srv\\s\\") && !limited("reach:/") && !limited("k"));
        assert_eq!(limited("reach:c:\\"), cfg!(windows) && remote("c:\\"), "Windows は割り当てたネットワークドライブだけ");
    }

    #[test]
    fn roots() {
        assert_eq!(root_key("r", "\\\\srv\\share\\a\\b"), root_key("r", "\\\\srv\\share\\c"));
        assert_ne!(root_key("r", "\\\\srv\\share\\a"), root_key("r", "\\\\srv\\other\\a"));
        assert_ne!(root_key("r", "\\\\srv\\share"), root_key("s", "\\\\srv\\share"));
    }
}
