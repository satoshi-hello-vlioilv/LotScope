//! アプリの中身（Python・program/sidecar.py）を子プロセスで起こし、パイプの枠で問い合わせる。**ポートは使わない**。
//!
//! - 問い合わせごとに番号（id）を付けて送り、答えは読み手の糸が番号で持ち主へ返す（長い問い合わせが短いものを待たせない）
//! - 窓が終わればこの値が捨てられ、標準入力が閉じる → Python は入力の終わりを見て自分で終わる
//!   （親が強制終了されてもパイプは OS が閉じるので、子は残らない）
//! - 子が途中で止まったら、待っている問い合わせへ失敗を返し、Supervisor が次の問い合わせで起こし直す
//! - 枠の約束の版（`protocol`）が窓と違えば起こさない（窓と中身の組がずれたとき、黙って食い違った答えを出さない）

use crate::frame::{read_frame, write_frame};
use crate::locate::Python;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// 答え（HTTP の答えと同じ中身）。
#[derive(Debug, Clone)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// 問い合わせ（窓が受けた HTTP の問い合わせを、そのまま渡す形）。
pub struct Ask<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: &'a str,
    pub headers: Vec<(String, String)>,
    pub body: &'a [u8],
}

/// 枠の約束の版。program/sidecar.py の PROTOCOL と同じ数（枠の形を変えたら両方を1つ上げる）。
pub const PROTOCOL: u64 = 1;
/// 窓（Rust）が受け持つこと。中身（Python）へ TPA_SHELL_SERVES で伝える（app/__init__.py の shell_serves）。
/// lotlist: 品質異常の問い合わせと品質データの写し（src/lot.rs。Python は写さず同じ台帳を読む）。
/// lists: 作業実績・データ元の一覧・スライサーとその写し・結合（版 3.60.0。src/lists.rs。Python の写しは受け身になり、写しが要るときは
/// 知らせの枠 {"id": 0, "event": "mirror", …} で窓へ伝える: Supervisor::on_notice）。
/// access: 権限の判定（me）と書き込みの門番（版 3.65.0。src/access.rs。Python は窓が載せた me〈見出し X-TPA-Me〉を使い、門番を窓に任せる）。
/// presence・ui_state: 心拍と利用状況・使用の履歴の 7 本・画面の設定の控え（版 3.71.0。src/presence.rs。書き手は窓の 1 つ。Python は心拍で書かない）。
/// bundle: 設定の束を窓が組み、マスタの置き場の引っ越しの印をたどる（版 3.84.0。src/bundle.rs。Python は印をたどらず、この PC の覚え
/// master_share.json を読み直すだけ: master_store.follow_moved）。
/// release: 更新の置き場（GET /api/update/settings）と配布の置き場を写す係（版 3.95.0。src/release_place.rs。写す係はプロセスに 1 つなので、
/// Python は /api/release/place/move で写さない: routes/settings.py）。
/// schedule: スケジュール（CM3）の係（版 3.96.0。src/schedule.rs。CM3 へ取りに行く・世代を置く・状態を書くのは窓の 1 つ。Python の
/// Schedules は受け身で、取りに行く要るときは知らせの枠 {"id": 0, "event": "schedule", …}〈効いている設定つき〉で窓に頼んで待つ。
/// 窓が取れない設定の間は窓が状態に「係を降りた」と書き、Python が取る）。
/// lotdsp: LotDsp の 9 本の係（版 3.98.0。src/lotdsp.rs・lotdsp_direct.rs。見えない Edge・錠・中止・学びの覚えは窓の 1 つ。Python の 9 本は
/// 来たら誤りの印〈409 kind shell〉を返す。窓はどの形も自分で答えるので来ない）
/// place: マスタの置き場の 4 本と「参照…」の 2 本（版 3.101.0。src/master_place.rs・folder_browse.rs）。マスタの置き場を写す係
/// （引っ越し）はプロセスに 1 つなので、Python は /api/masters/place/move で写さずに 409 で断る（routes/settings.py。配布の置き場と同じ型）
pub const SERVES: &[&str] = &["lotlist", "lists", "access", "presence", "ui_state", "bundle", "release", "schedule", "lotdsp", "place"];
/// 入力を閉じてから Python が片付け（見えない Edge を閉じる・boot.stop）を終えるのを待つ長さ。終わらなければ止める。
const STOP_WAIT: Duration = Duration::from_millis(5000);
/// 止めたあと、本当に終わったと見えるまで待つ長さ（その間に入れ替えを始めない）。
const KILL_WAIT: Duration = Duration::from_millis(3000);

/// 起動の途中の知らせ（起動前の確認の進み具合）を受ける係。
pub type Progress = Arc<dyn Fn(&Value) + Send + Sync>;
/// 動いている間の知らせ（答えではない枠。今は作業実績・データ元の「写して」）を受ける係。起こし直しても同じ係へ届く
pub type Notices = Arc<Mutex<Option<Progress>>>;

pub struct Sidecar {
    /// 書き口。終わるときに先に閉じる（閉じれば Python は入力の終わりを見て自分で終わる）
    stdin: Mutex<Option<BufWriter<ChildStdin>>>,
    pending: Arc<Mutex<HashMap<u64, Sender<Reply>>>>,
    next: AtomicU64,
    alive: Arc<AtomicBool>,
    child: Mutex<Child>,
    /// 準備できたときの知らせ（版・指紋・Python の場所・起動にかかった秒）
    pub ready: Value,
}

impl Sidecar {
    /// 起こして「準備できた」を待つ。起動できない理由（Python の誤り）はそのまま返す。
    /// 動いている間の知らせは notices へ渡す。
    pub fn spawn(
        py: &Python,
        program: &Path,
        log_dir: &Path,
        wait: Duration,
        progress: &Progress,
        notices: Notices,
    ) -> Result<Sidecar, String> {
        std::fs::create_dir_all(log_dir).ok();
        let err_log = log_dir.join("sidecar_stderr.log");
        let stderr = std::fs::File::create(&err_log).map(Stdio::from).unwrap_or_else(|_| Stdio::null());
        let mut cmd = Command::new(&py.exe);
        cmd.args(&py.args)
            .arg("-X")
            .arg("utf8")
            // .pyc は program ではなく作業場所へ（program を写す・入れ替えるときに混ざらない。Store 版でも同じ）
            .arg("-X")
            .arg(format!("pycache_prefix={}", crate::locate::local_root().join("pycache").display()))
            .arg(program.join("sidecar.py"))
            .current_dir(program)
            .env("PYTHONIOENCODING", "utf-8")
            .env("TPA_SHELL", "desktop")
            // 窓が受け持つこと（Python はここに無いことを自分で受け持つ。古い窓と新しい中身の組でも欠けない）
            .env("TPA_SHELL_SERVES", SERVES.join(","))
            // 作業場所は窓と同じ所（app_env.local_root と同じ決まりで窓が決めた値を渡す）
            .env("TRANSFER_LOCAL_ROOT", crate::locate::local_root())
            // 窓が何から作られたか・どこで動いているか
            .env("TPA_SHELL_COMMIT", env!("TPA_BUILD_COMMIT"))
            .env("TPA_SHELL_EXE", std::env::current_exe().unwrap_or_default())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(stderr);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| format!("Python を起動できません（{}）: {e}", py.exe.display()))?;
        let stdin = child.stdin.take().ok_or("標準入力を開けません")?;
        let mut out = BufReader::with_capacity(1 << 16, child.stdout.take().ok_or("標準出力を開けません")?);

        // 「準備できた」か「起動できない」まで読む。その前の「起動前の確認」の進み具合は起動画面へ流す。
        // 待つのは**知らせが途切れてから** wait まで（部品の導入は長くかかるが、進んでいる間は待つ）
        let (tx, rx) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            loop {
                let f = read_frame(&mut out);
                let done = !matches!(&f, Ok(Some(fr)) if fr.head["event"] == "progress");
                let _ = tx.send(f.map(|f| f.map(|f| f.head)));
                if done {
                    break;
                }
            }
            out
        });
        let first = loop {
            match rx.recv_timeout(wait) {
                Ok(Ok(Some(head))) if head["event"] == "progress" => progress(&head),
                other => break other,
            }
        };
        let ready = match first {
            Ok(Ok(Some(head))) if head["event"] == "ready" && head["protocol"].as_u64() != Some(PROTOCOL) => {
                let _ = child.kill();
                return Err(format!(
                    "窓とアプリの中身の版が食い違っています（窓 {PROTOCOL} / 中身 {}）。アプリを閉じて、開き直してください。直らなければ配られた ZIP を展開し直してください。",
                    head["protocol"]
                ));
            }
            Ok(Ok(Some(head))) if head["event"] == "ready" => head,
            Ok(Ok(Some(head))) => {
                let _ = child.kill();
                return Err(format!("アプリの中身（Python）が起動できませんでした: {}", head["error"].as_str().unwrap_or("理由不明")));
            }
            Ok(Ok(None)) | Ok(Err(_)) => {
                let _ = child.wait();
                return Err(format!("アプリの中身（Python）がすぐに終わりました。\n{}", tail(&err_log, 12)));
            }
            Err(_) => {
                let _ = child.kill();
                return Err(format!("アプリの中身（Python）が {} 秒たっても準備できません。\n{}", wait.as_secs(), tail(&err_log, 12)));
            }
        };
        let out = reader.join().map_err(|_| "読み手の糸が止まりました")?;

        let pending: Arc<Mutex<HashMap<u64, Sender<Reply>>>> = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));
        let (p2, a2) = (pending.clone(), alive.clone());
        std::thread::Builder::new()
            .name("sidecar-reader".into())
            .spawn(move || read_loop(out, p2, a2, notices))
            .map_err(|e| e.to_string())?;
        Ok(Sidecar {
            stdin: Mutex::new(Some(BufWriter::new(stdin))),
            pending,
            next: AtomicU64::new(1),
            alive,
            child: Mutex::new(child),
            ready,
        })
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// 1つ問い合わせて答えを待つ。送れない・止まった・時間切れは誤り（画面には 503/504 で返す）。
    pub fn request(&self, ask: &Ask, wait: Duration) -> Result<Reply, RequestError> {
        if !self.is_alive() {
            return Err(RequestError::Dead);
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let mut headers = serde_json::Map::new();
        for (k, v) in &ask.headers {
            // 同じ名前が並ぶときは HTTP と同じく「, 」でつなぐ
            let joined = match headers.get(k).and_then(Value::as_str) {
                Some(prev) => format!("{prev}, {v}"),
                None => v.clone(),
            };
            headers.insert(k.clone(), Value::from(joined));
        }
        let head = json!({"id": id, "method": ask.method, "path": ask.path, "query": ask.query, "headers": headers});
        let sent = match self.stdin.lock().unwrap().as_mut() {
            Some(w) => write_frame(w, &head, ask.body),
            None => Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe)),
        };
        if sent.is_err() {
            self.pending.lock().unwrap().remove(&id);
            self.alive.store(false, Ordering::SeqCst);
            return Err(RequestError::Dead);
        }
        match rx.recv_timeout(wait) {
            Ok(r) => Ok(r),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.pending.lock().unwrap().remove(&id);
                Err(RequestError::Timeout)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(RequestError::Died),
        }
    }
}

impl Sidecar {
    /// 起こしたプロセスの PID と、本当に動いている Python の PID（起動の合図の`pid`）。違えば入口（別名）を通っている。
    pub fn pids(&self) -> (u32, Option<u32>) {
        let spawned = self.child.lock().unwrap().id();
        let real = self.ready["pid"].as_u64().map(|p| p as u32).filter(|p| *p != spawned);
        (spawned, real)
    }
}

impl Drop for Sidecar {
    /// 入力を閉じて自分で終わる（片付けてから）のを待ち、終わらなければ止める。
    /// **本物の Python が終わるまで**見る——入口（`WindowsApps\python.exe`）だけを見て止めると、本物が残って
    /// `program`を掴み、版の入れ替えが断られる。
    fn drop(&mut self) {
        if let Ok(mut w) = self.stdin.lock() {
            drop(w.take()); // 出し切ってから閉じる
        }
        let (_, real) = self.pids();
        let mut child = self.child.lock().unwrap();
        let end = Instant::now() + STOP_WAIT;
        let mut child_done = false;
        while Instant::now() < end {
            child_done = child_done || matches!(child.try_wait(), Ok(Some(_)));
            if child_done && real.is_none_or(|p| !crate::proc::alive(p)) {
                return;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        if !child_done {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(p) = real.filter(|p| crate::proc::alive(*p)) {
            crate::proc::kill(p);
            let _ = crate::proc::wait_gone(p, KILL_WAIT);
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum RequestError {
    /// 送る前から止まっている（次の問い合わせで起こし直す）
    Dead,
    /// 答えを待つ間に止まった
    Died,
    Timeout,
}

fn read_loop(
    mut out: BufReader<std::process::ChildStdout>,
    pending: Arc<Mutex<HashMap<u64, Sender<Reply>>>>,
    alive: Arc<AtomicBool>,
    notices: Notices,
) {
    while let Ok(Some(f)) = read_frame(&mut out) {
        let id = f.head["id"].as_u64().unwrap_or(0);
        if id == 0 {
            // 知らせ（答えではない）。受け手の中で時間をかけない（読み手の糸を止めると答えが届かない）ので、受け手は短く済ませる
            let tell = notices.lock().unwrap().clone();
            if let Some(tell) = tell {
                tell(&f.head);
            }
            continue;
        }
        let headers = f.head["headers"]
            .as_array()
            .map(|a| a.iter().filter_map(|kv| Some((kv.get(0)?.as_str()?.to_string(), kv.get(1)?.as_str()?.to_string()))).collect())
            .unwrap_or_default();
        let reply = Reply { status: f.head["status"].as_u64().unwrap_or(500) as u16, headers, body: f.body };
        if let Some(tx) = pending.lock().unwrap().remove(&id) {
            let _ = tx.send(reply);
        }
    }
    // 止まった: 待っている問い合わせへ知らせる（送り手を捨てると受け手は Disconnected）
    alive.store(false, Ordering::SeqCst);
    pending.lock().unwrap().clear();
}

/// 記録の終わりの数行（起動できない理由を画面に出すため）。
pub fn tail(path: &PathBuf, lines: usize) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let v: Vec<&str> = text.lines().collect();
    v[v.len().saturating_sub(lines)..].join("\n")
}

/// 生きているかを答えられる物（起こし直しの係が持つ物。本物は Sidecar、試験では作り物）
pub trait Live {
    fn is_alive(&self) -> bool;
}

impl Live for Sidecar {
    fn is_alive(&self) -> bool {
        Sidecar::is_alive(self)
    }
}

/// 起こし直しの係の状態（版 3.86.0。起動で Python を待たずに画面を開くため、起こしている最中を錠の外に出した）
enum Phase<T> {
    /// まだ起こしていない・止めた
    Idle,
    /// だれかが錠の外で起こしている（ほかの者は changed で待ち合わせる）
    Starting,
    Up(Arc<T>),
    /// 起こせなかった（理由と時刻）。RETRY_AFTER の間は起こし直さず同じ理由を返す（壊れた版を問い合わせのたびに起こさない）
    Down(String, Instant),
    /// 止めた（窓を閉じる）。もう起こさない（起こしている最中に止めたら、起き上がった物は捨てる）
    Stopped,
}

/// 起こせなかったあと、起こし直すまでの間
pub const RETRY_AFTER: Duration = Duration::from_secs(30);

/// 1 つの物を起こし直す係の芯（錠を持ったまま起こさない。起こすのは最初に来た 1 人で、ほかは待ち合わせる）
pub struct Phases<T> {
    cur: Mutex<Phase<T>>,
    changed: Condvar,
    retry_after: Duration,
}

impl<T: Live> Phases<T> {
    pub fn new(retry_after: Duration) -> Self {
        Phases { cur: Mutex::new(Phase::Idle), changed: Condvar::new(), retry_after }
    }

    /// 動いている物（無ければ・止まっていれば start で起こす。だれかが起こしている最中なら wait まで待ち合わせる）
    #[cfg(test)]
    pub fn get(&self, start: impl FnOnce() -> Result<T, String>, wait: Duration) -> Result<Arc<T>, String> {
        self.get_then(start, wait, |_| {})
    }

    /// get と同じ。自分が起こしたときだけ、状態を変えたあと（錠の外で）done に結果を渡す（記録・画面の帯）
    pub fn get_then(
        &self,
        start: impl FnOnce() -> Result<T, String>,
        wait: Duration,
        done: impl FnOnce(&Result<Arc<T>, String>),
    ) -> Result<Arc<T>, String> {
        let deadline = Instant::now() + wait;
        let mut start = Some(start);
        let mut g = self.cur.lock().unwrap();
        loop {
            match &*g {
                Phase::Up(s) if s.is_alive() => return Ok(s.clone()),
                Phase::Stopped => return Err("アプリを終えています。".into()),
                Phase::Starting => {
                    let left = deadline.saturating_duration_since(Instant::now());
                    if left.is_zero() {
                        return Err(
                            "アプリの中身（Python）を起こしている最中で、待ちきれませんでした。少し待ってからお試しください。".into()
                        );
                    }
                    g = self.changed.wait_timeout(g, left).unwrap().0;
                }
                Phase::Down(e, at) if at.elapsed() < self.retry_after => return Err(e.clone()),
                _ => {
                    let Some(f) = start.take() else {
                        return Err("アプリの中身（Python）を起こし直せませんでした。".into());
                    };
                    // 古い物（止まった Sidecar）は錠の外で捨てる（Drop は片付けを最大 5 秒待つ。その間 up()・心拍を待たせない）
                    let old = std::mem::replace(&mut *g, Phase::Starting);
                    drop(g);
                    drop(old);
                    // 起こす途中の panic は、試験の組み方（unwind）では Down にする。製品の組み方は panic = "abort" なので窓ごと終わる
                    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))
                        .unwrap_or_else(|_| Err("アプリの中身（Python）を起こす途中で止まりました。".into()));
                    g = self.cur.lock().unwrap();
                    let (out, late) = if matches!(*g, Phase::Stopped) {
                        // 起こしている最中に止めた: 起き上がった物は捨てる（錠の外で）
                        (Err("アプリを終えています。".to_string()), r.ok())
                    } else {
                        match r {
                            Ok(s) => {
                                let s = Arc::new(s);
                                *g = Phase::Up(s.clone());
                                (Ok(s), None)
                            }
                            Err(e) => {
                                *g = Phase::Down(e.clone(), Instant::now());
                                (Err(e), None)
                            }
                        }
                    };
                    self.changed.notify_all();
                    drop(g);
                    drop(late);
                    done(&out);
                    return out;
                }
            }
        }
    }

    /// 待たずに、いま動いている物（無い・止まった・起こしている最中は None）
    pub fn up(&self) -> Option<Arc<T>> {
        match &*self.cur.lock().unwrap() {
            Phase::Up(s) if s.is_alive() => Some(s.clone()),
            _ => None,
        }
    }

    /// だれかが起こしている最中か・起こせなかった直後か・止めたか（このときは起こしに行かない）
    pub fn busy(&self) -> bool {
        match &*self.cur.lock().unwrap() {
            Phase::Starting | Phase::Stopped => true,
            Phase::Down(_, at) => at.elapsed() < self.retry_after,
            _ => false,
        }
    }

    /// だれかが起こしている最中か
    pub fn starting(&self) -> bool {
        matches!(*self.cur.lock().unwrap(), Phase::Starting)
    }

    /// 起こせなかった理由（起こせなかったあと、まだ起こし直していなければ）
    pub fn down_reason(&self) -> Option<String> {
        match &*self.cur.lock().unwrap() {
            Phase::Down(e, _) => Some(e.clone()),
            _ => None,
        }
    }

    /// 起こせなかった理由を忘れる（「もう一度」: 次の get で待たずに起こし直す）
    pub fn forget_down(&self) {
        let mut g = self.cur.lock().unwrap();
        if matches!(*g, Phase::Down(..)) {
            *g = Phase::Idle;
        }
    }

    /// 止める（持っている物を錠の外で捨て、もう起こさない。起こしている最中なら、起き上がった物を get が捨てる）
    pub fn take(&self) {
        let mut g = self.cur.lock().unwrap();
        let old = std::mem::replace(&mut *g, Phase::Stopped);
        self.changed.notify_all();
        drop(g);
        drop(old);
    }
}

/// 中身の Python を1つ持ち、止まっていたら次の問い合わせで起こし直す係（複製しても同じ係）。
#[derive(Clone)]
pub struct Supervisor {
    inner: Arc<Inner>,
}

struct Inner {
    py: Python,
    program: PathBuf,
    log_dir: PathBuf,
    phases: Phases<Sidecar>,
    progress: Progress,
    notices: Notices,
    start_wait: Duration,
    /// 起こした結果（起きた・起こせなかった）の受け手（記録・画面の帯。版 3.86.0）
    changed: Mutex<Option<Changed>>,
}

/// 起こした結果の受け手（起きた: 準備の知らせ・起こせなかった: 理由）
pub type Changed = Arc<dyn Fn(Result<&Value, &str>) + Send + Sync>;

impl Supervisor {
    pub fn new(py: Python, program: PathBuf, log_dir: PathBuf, progress: Progress) -> Self {
        Supervisor {
            inner: Arc::new(Inner {
                py,
                program,
                log_dir,
                phases: Phases::new(RETRY_AFTER),
                progress,
                notices: Notices::default(),
                start_wait: Duration::from_secs(120),
                changed: Mutex::new(None),
            }),
        }
    }

    /// 動いている間の知らせ（作業実績・データ元の「写して」）の受け手を置く
    pub fn on_notice(&self, f: Progress) {
        *self.inner.notices.lock().unwrap() = Some(f);
    }

    /// 動いている中身（無ければ・止まっていれば起こす。だれかが起こしている最中なら待ち合わせる）。
    pub fn get(&self) -> Result<Arc<Sidecar>, String> {
        let i = &self.inner;
        let changed = i.changed.lock().unwrap().clone();
        i.phases.get_then(
            || Sidecar::spawn(&i.py, &i.program, &i.log_dir, i.start_wait, &i.progress, i.notices.clone()),
            i.start_wait + Duration::from_secs(5),
            |r| {
                if let Some(f) = changed {
                    f(r.as_ref().map(|s| &s.ready).map_err(String::as_str));
                }
            },
        )
    }

    /// 起こした結果の受け手を置く（起こすたび: 最初・止まったあと・「もう一度」）
    pub fn on_changed(&self, f: Changed) {
        *self.inner.changed.lock().unwrap() = Some(f);
    }

    /// 起こしている最中か
    pub fn starting(&self) -> bool {
        self.inner.phases.starting()
    }

    /// 起こせなかった理由（まだ起こし直していなければ）
    pub fn down_reason(&self) -> Option<String> {
        self.inner.phases.down_reason()
    }

    /// 「もう一度」: 起こせなかった理由を忘れて、裏で起こし直す
    pub fn retry(&self) {
        self.inner.phases.forget_down();
        self.kick();
    }

    /// 待たずに、いま動いている中身（無い・起こしている最中は None）
    pub fn up(&self) -> Option<Arc<Sidecar>> {
        self.inner.phases.up()
    }

    /// 動いていなければ裏の糸で起こし始める（待たない。起こしている最中・起こせなかった直後は何もしない）
    pub fn kick(&self) {
        if self.up().is_some() || self.inner.phases.busy() {
            return;
        }
        let me = self.clone();
        let _ = std::thread::Builder::new().name("sidecar-start".into()).spawn(move || {
            let _ = me.get();
        });
    }

    /// 準備できたときの知らせ（動いていなければ null。窓の情報 /__desktop/info に載せる）
    pub fn ready(&self) -> Value {
        self.up().map(|s| s.ready.clone()).unwrap_or(Value::Null)
    }

    /// 終わるとき: 中身を捨てる（入力を閉じる → Python が自分で終わる）。
    pub fn stop(&self) {
        self.inner.phases.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    struct Fake(AtomicBool);
    impl Live for Fake {
        fn is_alive(&self) -> bool {
            self.0.load(Ordering::SeqCst)
        }
    }

    #[test]
    fn starting_does_not_block_the_quick_questions() {
        // 版 3.86.0: 起こしている最中も up()・busy() は待たない。get() は待ち合わせて同じ物を受け取り、起こすのは 1 回だけ
        let p = Arc::new(Phases::<Fake>::new(Duration::from_millis(300)));
        let starts = Arc::new(AtomicUsize::new(0));
        let (p1, s1) = (p.clone(), starts.clone());
        let first = std::thread::spawn(move || {
            p1.get(
                || {
                    s1.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(400));
                    Ok(Fake(AtomicBool::new(true)))
                },
                Duration::from_secs(5),
            )
        });
        std::thread::sleep(Duration::from_millis(50));
        let t = Instant::now();
        assert!(p.up().is_none() && p.busy(), "起こしている最中");
        assert!(t.elapsed() < Duration::from_millis(50), "待たずに答える");
        let s2 = starts.clone();
        let second = p.get(
            || {
                s2.fetch_add(1, Ordering::SeqCst);
                Ok(Fake(AtomicBool::new(true)))
            },
            Duration::from_secs(5),
        );
        let first = first.join().unwrap().unwrap();
        assert!(Arc::ptr_eq(&first, &second.unwrap()), "待ち合わせた者も同じ物");
        assert_eq!(starts.load(Ordering::SeqCst), 1, "起こすのは 1 回");
        assert!(p.up().is_some() && !p.busy());
        // 止まった物は次の get で起こし直す
        first.0.store(false, Ordering::SeqCst);
        assert!(p.up().is_none());
        let again = p.get(|| Ok(Fake(AtomicBool::new(true))), Duration::from_secs(1)).unwrap();
        assert!(!Arc::ptr_eq(&first, &again));
    }

    struct SlowDrop(AtomicBool);
    impl Live for SlowDrop {
        fn is_alive(&self) -> bool {
            self.0.load(Ordering::SeqCst)
        }
    }
    impl Drop for SlowDrop {
        fn drop(&mut self) {
            std::thread::sleep(Duration::from_millis(400));
        }
    }

    #[test]
    fn stopping_while_starting_leaves_it_stopped() {
        // 作った後の採点（版 3.86.0）: 起こしている最中に止めたら、起き上がった物は捨てて「止めた」のまま。止めたあとは起こさない
        let p = Arc::new(Phases::<Fake>::new(Duration::from_millis(100)));
        let p1 = p.clone();
        let t = std::thread::spawn(move || {
            p1.get(
                || {
                    std::thread::sleep(Duration::from_millis(300));
                    Ok(Fake(AtomicBool::new(true)))
                },
                Duration::from_secs(5),
            )
        });
        std::thread::sleep(Duration::from_millis(50));
        p.take();
        assert!(t.join().unwrap().is_err(), "止めたあとに起き上がった物は渡さない");
        assert!(p.up().is_none() && p.busy(), "止めたまま（起こしに行かない）");
        let tries = AtomicUsize::new(0);
        assert!(p
            .get(
                || {
                    tries.fetch_add(1, Ordering::SeqCst);
                    Ok(Fake(AtomicBool::new(true)))
                },
                Duration::from_secs(1)
            )
            .is_err());
        assert_eq!(tries.load(Ordering::SeqCst), 0, "止めたあとは起こさない");
    }

    #[test]
    fn the_old_one_is_dropped_outside_the_lock() {
        // 止まった古い物の後片付け（Drop。本物は最大 5 秒）の間も、up()・busy() は待たない
        let p = Arc::new(Phases::<SlowDrop>::new(Duration::from_millis(100)));
        let first = p.get(|| Ok(SlowDrop(AtomicBool::new(true))), Duration::from_secs(1)).unwrap();
        first.0.store(false, Ordering::SeqCst);
        drop(first);
        let p1 = p.clone();
        let t = std::thread::spawn(move || p1.get(|| Ok(SlowDrop(AtomicBool::new(true))), Duration::from_secs(5)).map(|_| ()));
        std::thread::sleep(Duration::from_millis(80));
        let at = Instant::now();
        let _ = (p.up(), p.busy());
        assert!(at.elapsed() < Duration::from_millis(150), "古い物を捨てている間も待たない: {:?}", at.elapsed());
        assert!(t.join().unwrap().is_ok());
    }

    #[test]
    fn only_the_starter_hears_the_result() {
        // 起こした結果（記録・画面の帯）は、起こした 1 人だけが受け取る（待ち合わせた者は受け取らない）
        let p = Arc::new(Phases::<Fake>::new(Duration::from_millis(100)));
        let heard = Arc::new(AtomicUsize::new(0));
        let mut ts = vec![];
        for _ in 0..4 {
            let (p1, h1) = (p.clone(), heard.clone());
            ts.push(std::thread::spawn(move || {
                p1.get_then(
                    || {
                        std::thread::sleep(Duration::from_millis(150));
                        Ok(Fake(AtomicBool::new(true)))
                    },
                    Duration::from_secs(5),
                    |r| {
                        assert!(r.is_ok());
                        h1.fetch_add(1, Ordering::SeqCst);
                    },
                )
            }));
        }
        for t in ts {
            assert!(t.join().unwrap().is_ok());
        }
        assert_eq!(heard.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_failure_is_remembered_for_a_while() {
        // 起こせなかった理由は retry_after の間おぼえ、問い合わせのたびに起こし直さない（壊れた版を何度も起こさない）
        let p = Phases::<Fake>::new(Duration::from_millis(200));
        let tries = AtomicUsize::new(0);
        let bad = || {
            tries.fetch_add(1, Ordering::SeqCst);
            Err::<Fake, _>("起動できません".to_string())
        };
        assert_eq!(p.get(bad, Duration::from_secs(1)).err().as_deref(), Some("起動できません"));
        assert!(p.busy(), "起こせなかった直後は起こしに行かない");
        assert_eq!(p.get(bad, Duration::from_secs(1)).err().as_deref(), Some("起動できません"));
        assert_eq!(tries.load(Ordering::SeqCst), 1, "覚えている間は起こさない");
        std::thread::sleep(Duration::from_millis(250));
        assert!(!p.busy());
        assert!(p.get(|| Ok(Fake(AtomicBool::new(true))), Duration::from_secs(1)).is_ok(), "間が過ぎれば起こし直す");
        // 起こす途中で止まっても（panic）、起こしている最中のまま残らない
        let q = Phases::<Fake>::new(Duration::from_millis(10));
        assert!(q.get(|| panic!("止まった"), Duration::from_secs(1)).is_err());
        assert!(q.busy() && q.up().is_none());
    }
}
