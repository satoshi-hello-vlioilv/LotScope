//! 届くかを尋ねる係（版 3.114.0。S12b）。届かない共有（SMB・眠ったサーバー・切れた VPN）の読みは OS の待ちが長く、尋ねた糸は
//! 打ち切れない。前は「参照…」（folder_browse の bounded・places）・マスタの置き場の状態（master_place の PROBES）・使っている PC
//! （using）が別々に糸を立て、status のほかは尋ねるたびに糸を積んだ（止まる共有へ「参照…」を開き直すたびに増えた）。
//!
//! ここは 1 つの係: 鍵（normcase した道の根〈X:\ か \\サーバー\共有〉と尋ね方）ごとに走る糸は 1 本・全体で LIMIT 本まで。
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

    /// 走っている糸の数（試験）
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
        if st.busy.contains(key) || st.running >= self.inner.limit {
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
            st.running -= 1;
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
                st.running += 1;
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

    #[test]
    fn roots() {
        assert_eq!(root_key("r", "\\\\srv\\share\\a\\b"), root_key("r", "\\\\srv\\share\\c"));
        assert_ne!(root_key("r", "\\\\srv\\share\\a"), root_key("r", "\\\\srv\\other\\a"));
        assert_ne!(root_key("r", "\\\\srv\\share"), root_key("s", "\\\\srv\\share"));
    }
}
