//! 共有上の品質データ（SQLite）を手元へ写してから読む係。Python 版（program/app/services/db_mirror.py）と**同じ手順・同じ台帳・同じ文言**。
//!
//! - 写し方: 書き手（DataRelay）と干渉しない作法。書き手の作業中の印（.incoming・-journal・-wal）があれば写さない →
//!   SQLite として開かず、置き換えを許す開き方でファイルを丸ごと一気に写す → 写す前後の (大きさ, 更新時刻) が同じで、
//!   作業中の印も出ていないか → quick_check。どれかで見送れば少し空けてやり直す（Python の db_mirror.py の冒頭に理由）
//! - 「再読込」は今すぐ確かめるだけ（元が変わっていなければ写さない）。約束は program/docs/SHARED_READ.md
//! - 世代名: 毎回 `<キー>.g<世代>.sqlite3` で作り、台帳 `_mirror.json` が今の世代を指す（開いているファイルを上書きしない）
//! - いつ: 背景の糸が一定間隔で元の (パス, 大きさ, 更新時刻 ns) を見て、変わっていれば写す。一覧の問い合わせの中では共有を見ない
//! - 台帳は Python と同じ形なので、どちらが写した写しも互いに読める（desktop/tests/mirror_parity.rs が突き合わせる）
//! - 版 3.60.0: 作業実績の設備ごと・データ元ごとの写しも窓が受け持つ（Mirrors。キー → 係。同じ元のキーは 1 つの係を分け合う）。
//!   周回の様子は `<キー>.state.json` に置く（受け身の Python が「写しています」の理由と、最初の周回が済んだかを読む）

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const LEDGER: &str = "_mirror.json";
const DEFAULT_INTERVAL_SEC: i64 = 60;
const MIN_INTERVAL_SEC: i64 = 10;
const FIRST_WAIT: Duration = Duration::from_secs(30);
const STAT_RETRY_SEC: [f64; 3] = [0.3, 0.7, 1.5];
const RETRY_AFTER_UNREACHABLE_SEC: i64 = 10;
const RETRY_AFTER_BUSY_SEC: i64 = 5;
/// 写しがまだ1つも無いあいだ（入れた直後）は、何度しくじっても間隔を待たずに写し直す（Python の RETRY_UNTIL_FIRST_COPY_SEC と同じ）
const RETRY_UNTIL_FIRST_COPY_SEC: i64 = 10;
const COPY_CHUNK: usize = 4 * 1024 * 1024;
const REPLACE_BUDGET: f64 = 2.0;
/// 同じ台帳に、いくつもの係（作業実績の設備ごと・データ元ごと）が書くので、読んで直して書くあいだは 1 本にする（ほかの係の行を消さない）
static LEDGER_LOCK: Mutex<()> = Mutex::new(());

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

/// OS の誤りの文（Python の _os_error_text と同じ形: "Errno 2 No such file or directory"・Windows は "WinError 2 …"・末尾の句点なし）。
pub fn os_error_text(e: &std::io::Error) -> String {
    let text = e.to_string();
    match e.raw_os_error() {
        Some(n) => {
            let msg = text.strip_suffix(&format!(" (os error {n})")).unwrap_or(&text).trim();
            // Windows の文は末尾に句点が付く。Python（CPython）は末尾の空白と「.」を落とすので合わせる
            let msg = if cfg!(windows) { msg.trim_end_matches(|c: char| c == '.' || c.is_whitespace()) } else { msg };
            format!("{} {n} {msg}", if cfg!(windows) { "WinError" } else { "Errno" })
        }
        None => text,
    }
}

/// fn を、失敗のあいだ budget 秒まで間を広げながらやり直す（無い＝NotFound はやり直さない。Python の fsio.retrying と同じ）。
fn retrying<T>(budget: f64, mut f: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    let (mut delay, mut waited) = (0.05, 0.0);
    loop {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(e),
            Err(e) => {
                if waited >= budget {
                    return Err(e);
                }
                std::thread::sleep(Duration::from_secs_f64(delay));
                waited += delay;
                delay = (delay * 2.0).min(0.5);
            }
        }
    }
}

/// 書き手が作業中の印（元ファイルと同じフォルダ）。DataRelay の公開の書きかけ（.<名前>.<番号>.incoming）と、
/// SQLite の中を書き換える書き手の -journal・-wal。Python の writer_marks と同じ（小文字で比べ、名前の順）。
pub fn writer_marks(remote: &str) -> Vec<String> {
    let p = Path::new(remote);
    let Some(name) = p.file_name().map(|n| n.to_string_lossy().to_lowercase()) else { return vec![] };
    let Ok(rd) = std::fs::read_dir(p.parent().unwrap_or(Path::new("."))) else { return vec![] };
    let (head, journal, wal) = (format!(".{name}."), format!("{name}-journal"), format!("{name}-wal"));
    let mut v: Vec<String> = rd
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| {
            let l = n.to_lowercase();
            (l.starts_with(&head) && l.ends_with(".incoming")) || l == journal || l == wal
        })
        .collect();
    v.sort();
    v
}

/// 元を読むために開く。Windows では、開いているあいだも書き手が置き換え（os.replace）できる開き方
/// （FILE_SHARE_DELETE。std の既定でも付くが、ここで明かす）。Python の open_shared_read と同じ。
pub fn open_shared(remote: &str) -> std::io::Result<std::fs::File> {
    let mut o = std::fs::OpenOptions::new();
    o.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        o.share_mode(0x1 | 0x2 | 0x4).custom_flags(0x0800_0000); // 読み・書き・削除を許す／順に読む
    }
    o.open(remote)
}

/// 元をファイルとして丸ごと写す（SQLite として開かない・休まない。開き方は open_shared）。
pub fn copy_shared(remote: &str, tmp: &Path) -> std::io::Result<()> {
    use std::io::{Read, Write};
    let mut src = open_shared(remote)?;
    let mut dst = std::fs::File::create(tmp)?;
    let mut buf = vec![0u8; COPY_CHUNK];
    loop {
        let n = src.read(&mut buf)?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n])?;
    }
    Ok(())
}

/// JSON を置き換えで書く（途中で止まっても前の台帳か新しい台帳のどちらか）。Python の write_json_atomic（indent=1）と同じ形。
fn write_json_atomic(path: &Path, data: &Value) -> std::io::Result<()> {
    use serde::Serialize;
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tmp =
        path.with_file_name(format!(".{}.{}-{nanos}.tmp", path.file_name().unwrap_or_default().to_string_lossy(), std::process::id()));
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, serde_json::ser::PrettyFormatter::with_indent(b" "));
    data.serialize(&mut ser).map_err(std::io::Error::other)?;
    buf.push(b'\n');
    let r = std::fs::write(&tmp, &buf).and_then(|_| retrying(REPLACE_BUDGET, || std::fs::rename(&tmp, path)));
    let _ = std::fs::remove_file(&tmp);
    r
}

fn sqlite_text(e: &rusqlite::Error) -> String {
    match e {
        rusqlite::Error::SqliteFailure(_, Some(m)) => m.clone(),
        e => e.to_string(),
    }
}

/// 設定（元ファイル・間隔・古さのしきい）。
struct Conf {
    remote: String,
    interval: i64,
    stale_hours: f64,
}

#[derive(Default)]
struct Wake {
    woken: bool,
    first_done: bool,
}

pub struct DbMirror {
    pub key: String,
    cache_dir: PathBuf,
    conf: Mutex<Conf>,
    state: Mutex<Map<String, Value>>,
    refresh_lock: Mutex<()>,
    wake: Arc<(Mutex<Wake>, Condvar)>,
    started: Mutex<bool>,
    /// いま写している途中のファイル（写しかけの一時ファイル・元の大きさ・写し始めた時刻。版 3.97.0: 画面の「あと約 n 秒」の材料）
    copying: Mutex<Option<(PathBuf, u64, Instant)>>,
}

/// 写している途中の様子（copy_progress）
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CopyProgress {
    pub done: u64,
    pub total: u64,
    pub secs: f64,
}

impl DbMirror {
    pub fn new(key: &str, remote: &str, cache_dir: &Path, interval_sec: i64, stale_hours: f64) -> Arc<DbMirror> {
        let key = if key.is_empty() { "db" } else { key };
        let key: String = key.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        Arc::new(DbMirror {
            key,
            cache_dir: cache_dir.to_path_buf(),
            conf: Mutex::new(Conf { remote: remote.into(), interval: interval_of(interval_sec), stale_hours }),
            state: Mutex::default(),
            refresh_lock: Mutex::new(()),
            wake: Arc::default(),
            started: Mutex::new(false),
            copying: Mutex::default(),
        })
    }

    pub fn remote(&self) -> String {
        self.conf.lock().unwrap().remote.clone()
    }

    fn enabled(&self) -> bool {
        !self.remote().is_empty()
    }

    /// 元ファイル・間隔・古さのしきいが変わったとき、起動し直さずに切り替える（背景の糸を起こして次の周回を今すぐ）。変わった物があれば true。
    pub fn reconfigure(self: &Arc<Self>, remote: &str, interval_sec: i64, stale_hours: f64) -> bool {
        let changed = self.reconfigure_quiet(remote, interval_sec, stale_hours);
        if changed {
            self.start();
            self.wake();
        }
        changed
    }

    /// 切り替えるだけ（背景の糸は起こさない。突き合わせの試験と、受け身の Python 版と同じ振る舞い）。
    pub fn reconfigure_quiet(&self, remote: &str, interval_sec: i64, stale_hours: f64) -> bool {
        let mut changed = false;
        {
            let mut c = self.conf.lock().unwrap();
            // 同じファイルを指す書き方の違い（. ・重なった区切り・Windows の大文字小文字と / \\）では切り替えない（版 3.60.0。
            // 受け身の Python の「写して」と窓の段取りで元の字の書き方が違っても、写し直さない）
            if same_place(remote) != same_place(&c.remote) {
                c.remote = remote.into();
                *self.state.lock().unwrap() = Map::new();
                changed = true;
            }
            let iv = interval_sec.max(MIN_INTERVAL_SEC); // Python も切り替えでは 0 を既定にしない（max(10, int(n))）
            if iv != c.interval {
                c.interval = iv;
                changed = true;
            }
            if stale_hours != c.stale_hours {
                c.stale_hours = stale_hours;
                changed = true;
            }
        }
        changed
    }

    fn ledger_path(&self) -> PathBuf {
        self.cache_dir.join(LEDGER)
    }

    fn ledger(&self) -> Map<String, Value> {
        std::fs::read(self.ledger_path())
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default()
    }

    fn entry(&self) -> Map<String, Value> {
        self.ledger().get(&self.key).and_then(Value::as_object).cloned().unwrap_or_default()
    }

    fn save_entry(&self, signature: &Value, filename: &str) -> std::io::Result<()> {
        let _one = LEDGER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut data = self.ledger();
        data.insert(self.key.clone(), json!({"signature": signature, "file": filename}));
        write_json_atomic(&self.ledger_path(), &Value::Object(data))
    }

    fn generation_path(&self, gen: i64) -> PathBuf {
        self.cache_dir.join(format!("{}.g{gen}.sqlite3", self.key))
    }

    /// `<キー>.g<n>.sqlite3` の名前を並べる。
    fn generations(&self) -> Vec<PathBuf> {
        let prefix = format!("{}.g", self.key);
        std::fs::read_dir(&self.cache_dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(&prefix) && n.ends_with(".sqlite3")))
            .collect()
    }

    fn next_generation(&self) -> i64 {
        let prefix = format!("{}.g", self.key);
        let top = self
            .generations()
            .iter()
            .filter_map(|p| {
                let n = p.file_name()?.to_str()?;
                crate::pyfmt::py_int(&n[prefix.len()..n.len() - ".sqlite3".len()]).ok()
            })
            .fold(0, i64::max);
        top + 1
    }

    pub fn mirror_path(&self) -> Option<PathBuf> {
        match self.entry().get("file") {
            Some(Value::String(s)) if !s.is_empty() => Some(self.cache_dir.join(s)),
            Some(v) if !matches!(v, Value::Null | Value::Bool(false)) && v.as_str() != Some("") => Some(self.cache_dir.join(v.to_string())),
            _ => None,
        }
    }

    fn sweep(&self, keep: &Path) {
        let keep = keep.file_name().map(|n| n.to_os_string());
        for p in self.generations() {
            if p.file_name().map(|n| n.to_os_string()) != keep {
                let _ = retrying(0.2, || std::fs::remove_file(&p)); // 読んでいる間は消せない。次の周回でまた試す
            }
        }
    }

    fn remote_stat(&self, remote: &str, retry: bool) -> Result<Value, String> {
        let waits: &[f64] = if retry { &[0.0, STAT_RETRY_SEC[0], STAT_RETRY_SEC[1], STAT_RETRY_SEC[2]] } else { &[0.0] };
        let mut err = None;
        for w in waits {
            if *w > 0.0 {
                std::thread::sleep(Duration::from_secs_f64(*w));
            }
            match std::fs::metadata(remote) {
                Ok(m) => {
                    let ns = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos() as u64).unwrap_or(0);
                    return Ok(json!({"source": remote, "size": m.len(), "mtime_ns": ns}));
                }
                Err(e) => err = Some(e),
            }
        }
        Err(err.map(|e| os_error_text(&e)).unwrap_or_default())
    }

    fn verify(tmp: &Path) -> Option<String> {
        let c = match Connection::open_with_flags(tmp, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX) {
            Ok(c) => c,
            Err(e) => return Some(format!("開けません: {}", sqlite_text(&e))),
        };
        let _ = c.busy_timeout(Duration::from_secs(10));
        let row: Result<Option<String>, _> = c.query_row("PRAGMA quick_check(1)", [], |r| r.get::<_, Option<String>>(0));
        match row {
            Err(rusqlite::Error::QueryReturnedNoRows) => return Some("整合性検査に通りません: (応答なし)".into()),
            Err(e) => return Some(format!("読めません: {}", sqlite_text(&e))),
            Ok(v) => {
                let v = v.unwrap_or_else(|| "None".into());
                if v.to_lowercase() != "ok" {
                    return Some(format!("整合性検査に通りません: {v}"));
                }
            }
        }
        match c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table'", [], |r| r.get::<_, i64>(0)) {
            Ok(0) => Some("テーブルが1つもありません（まだ書き込み中の可能性）".into()),
            Ok(_) => None,
            Err(e) => Some(format!("読めません: {}", sqlite_text(&e))),
        }
    }

    /// 1回ぶん写し直す。結果（画面の診断用）を返す。
    /// 1回ぶん確かめ、元が変わっていれば写し直す（Python の refresh と同じ。「再読込」も同じ道）。
    pub fn refresh(&self) -> Value {
        let _one = self.refresh_lock.lock().unwrap_or_else(|e| e.into_inner());
        Value::Object(self.refresh_inner())
    }

    /// 写し終えた後も、元が写す前と同じで、書き手の作業中の印も無いか（約束の R5。Python の _settled と同じ文）。
    /// ダメなら見送る理由、良ければ None。
    fn settled(&self, remote: &str, sig: &Value) -> Option<String> {
        if self.remote_stat(remote, false).ok().as_ref() != Some(sig) {
            return Some("写しているあいだに元ファイルが入れ替わったため、見送りました。少し空けて写し直します".into());
        }
        writer_marks(remote)
            .first()
            .map(|m| format!("写しているあいだに書き手が書き始めたため、見送りました（{m}）。少し空けて写し直します"))
    }

    fn refresh_inner(&self) -> Map<String, Value> {
        let remote = self.remote();
        let mut res = Map::new();
        res.insert("updated".into(), json!(false));
        res.insert("reason".into(), json!(""));
        res.insert("at".into(), json!(now()));
        res.insert("remote".into(), json!(remote));
        let reason = |res: &mut Map<String, Value>, r: String| {
            res.insert("reason".into(), json!(r));
        };
        if remote.is_empty() {
            reason(&mut res, "元ファイルが設定されていません".into());
            return self.record(res);
        }
        let entry = self.entry();
        let local = self.mirror_path();
        let has_local = local.as_ref().is_some_and(|p| p.exists());
        let prev = self.state.lock().unwrap().clone();
        let prev_unreachable = prev.get("unreachable").is_some_and(truthy);
        let prev_same_remote = prev.get("remote").and_then(Value::as_str) == Some(remote.as_str());
        let known_good = !prev.is_empty() && prev_same_remote && !prev_unreachable;
        let sig = match self.remote_stat(&remote, known_good) {
            Ok(s) => s,
            Err(err) => {
                let same = prev_unreachable && prev_same_remote;
                let fails = if same { prev.get("fails").and_then(Value::as_i64).filter(|n| *n != 0).unwrap_or(1) + 1 } else { 1 };
                res.insert("unreachable".into(), json!(true));
                res.insert("error".into(), json!(err));
                res.insert("fails".into(), json!(fails));
                let name = Path::new(&remote).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let head = if has_local {
                    "共有の元ファイルへ届かないため、前の写しを使い続けます"
                } else {
                    "共有の元ファイルへ届かず、写しもまだありません"
                };
                reason(&mut res, format!("{head}（{name}: {err}）"));
                return self.record(res);
            }
        };
        if has_local && entry.get("signature").is_some_and(|had| same_signature(had, &sig)) {
            res.insert("skipped".into(), json!(true));
            reason(&mut res, "元ファイルは変わっていません".into());
            self.sweep(local.as_deref().unwrap());
            return self.record(res);
        }
        let marks = writer_marks(&remote);
        if let Some(m) = marks.first() {
            res.insert("busy".into(), json!(true));
            reason(&mut res, format!("書き手が公開している途中のため、写すのを見送りました（{m}）。少し空けて写し直します"));
            return self.record(res);
        }
        let _ = std::fs::create_dir_all(&self.cache_dir);
        let target = self.generation_path(self.next_generation());
        let tmp = target.with_extension("sqlite3.tmp");
        let _ = std::fs::remove_file(&tmp);
        let size = sig.get("size").and_then(Value::as_u64).unwrap_or(0);
        *self.copying.lock().unwrap() = Some((tmp.clone(), size, Instant::now()));
        let copied = copy_shared(&remote, &tmp);
        *self.copying.lock().unwrap() = None;
        if let Err(e) = copied {
            reason(&mut res, format!("写せませんでした: {}", copy_error_text(&e, &remote)));
            cleanup(&tmp);
            return self.record(res);
        }
        if let Some(moved) = self.settled(&remote, &sig) {
            res.insert("busy".into(), json!(true));
            reason(&mut res, moved);
            cleanup(&tmp);
            return self.record(res);
        }
        if let Some(bad) = Self::verify(&tmp) {
            reason(&mut res, format!("写しが正しくないため見送りました（{bad}）"));
            cleanup(&tmp);
            return self.record(res);
        }
        let name = target.file_name().unwrap().to_string_lossy().into_owned();
        if let Err(e) = retrying(REPLACE_BUDGET, || std::fs::rename(&tmp, &target)).and_then(|_| self.save_entry(&sig, &name)) {
            reason(&mut res, format!("写しを置き換えられませんでした: {}", copy_error_text(&e, &target.display().to_string())));
            cleanup(&tmp);
            return self.record(res);
        }
        res.insert("updated".into(), json!(true));
        res.insert("how".into(), json!("copy"));
        reason(&mut res, "写しを更新しました".into());
        self.sweep(&target);
        self.record(res)
    }

    fn record(&self, res: Map<String, Value>) -> Map<String, Value> {
        *self.state.lock().unwrap() = res.clone();
        // 受け身の Python が読む周回の様子（理由・届かない・最後に確かめた時刻）。書けなくても写しは続ける
        let _ = write_json_atomic(&self.cache_dir.join(format!("{}.state.json", self.key)), &Value::Object(res.clone()));
        res
    }

    /// 元を外す（ほかのキーと同じ元へ移ったキーの、もう使わない係。背景の糸は休む）
    pub fn retire(&self) {
        let (interval, stale) = {
            let c = self.conf.lock().unwrap();
            (c.interval, c.stale_hours)
        };
        self.reconfigure_quiet("", interval, stale);
    }

    /// いま写している途中なら、済んだバイト（写しかけの一時ファイルの大きさ）・元の大きさ・写し始めてからの秒（版 3.97.0）
    pub fn copy_progress(&self) -> Option<CopyProgress> {
        let (tmp, total, at) = self.copying.lock().unwrap().clone()?;
        let done = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
        Some(CopyProgress { done: done.min(total.max(done)), total: total.max(done), secs: at.elapsed().as_secs_f64() })
    }

    /// 最初の周回（写し）が済んだか（糸が動いていなければ済んだと見る。Python の wait_first(0) と同じ）
    pub fn first_done(&self) -> bool {
        !*self.started.lock().unwrap() || self.wake.0.lock().unwrap().first_done
    }

    /// 起動して最初の周回（写し）が済むまで、timeout まで待つ（済んだか、糸が動いていなければすぐ）
    pub fn wait_first(&self, timeout: Duration) {
        if *self.started.lock().unwrap() {
            let (m, cv) = &*self.wake;
            let g = m.lock().unwrap();
            let _ = cv.wait_timeout_while(g, timeout, |w| !w.first_done);
        }
    }

    /// 写さない係（受け身）: 窓のほかの係が置いた周回の様子（`<キー>.state.json`）を読む。元が今と違う物は読まない
    /// （受け身の Python の _status と同じ）。もう様子を持っていれば何もしない
    pub fn load_state(&self) {
        let mut st = self.state.lock().unwrap();
        if !st.is_empty() {
            return;
        }
        let path = self.cache_dir.join(format!("{}.state.json", self.key));
        let Some(Value::Object(d)) = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()) else { return };
        let remote = d.get("remote").and_then(Value::as_str).unwrap_or("");
        if remote.is_empty() || same_place(remote) == same_place(&self.remote()) {
            *st = d;
        }
    }

    /// 読む場所（read_path）。wait=false は最初の周回を待たない（いくつもの係をまとめて待った後: Mirrors::wait_first）
    pub fn read_path_wait(&self, wait: bool) -> Option<PathBuf> {
        if !self.enabled() {
            return None;
        }
        if wait {
            self.wait_first(FIRST_WAIT);
        }
        let remote = self.remote();
        let entry = self.entry();
        let src = entry.get("signature").and_then(|s| s.get("source")).and_then(Value::as_str).unwrap_or("");
        if same_place(src) != same_place(&remote) {
            return None;
        }
        self.mirror_path().filter(|p| p.exists())
    }

    /// 実際に読む場所 = その元から作った写し。まだ無ければ None（共有は直接読まない。理由は not_ready_text）。最初の周回が済むまでは待つ。
    pub fn read_path(&self) -> Option<PathBuf> {
        self.read_path_wait(true)
    }

    /// いまの元から作った写しがあるか（共有は見ない。台帳の印と手元のファイルだけ）。
    fn mirrored(&self) -> bool {
        let sig = self.entry().get("signature").and_then(Value::as_object).cloned().unwrap_or_default();
        Self::is_mirrored(&sig, &self.remote(), self.mirror_path().as_deref())
    }

    fn is_mirrored(sig: &Map<String, Value>, remote: &str, local: Option<&Path>) -> bool {
        sig.get("source").and_then(Value::as_str).is_some_and(|s| !remote.is_empty() && same_place(s) == same_place(remote))
            && local.is_some_and(|p| p.exists())
    }

    /// 写しがまだ無いときに画面へ出す文（なぜ無いか＋写し終えたら出ること）。Python の not_ready_text と同じ。
    pub fn not_ready_text(&self) -> String {
        let why = self.state.lock().unwrap().get("reason").and_then(Value::as_str).unwrap_or("").to_string();
        let why = if why.is_empty() { why } else { format!("（{why}）") };
        format!("共有の元ファイルを、まだ手元へ写せていません{why}。写し終えると一覧が出ます。")
    }

    /// いま読んでいるデータは「いつのものか」。共有は見に行かない（台帳の印から読む）。
    pub fn source_info(&self) -> Value {
        let (remote, interval, stale_hours) = {
            let c = self.conf.lock().unwrap();
            (c.remote.clone(), c.interval, c.stale_hours)
        };
        let entry = self.entry();
        let sig = entry.get("signature").and_then(Value::as_object).cloned().unwrap_or_default();
        let local = self.mirror_path();
        let mirrored = Self::is_mirrored(&sig, &remote, local.as_deref());
        let mut at = Value::Null;
        let mut copied = Value::Null;
        if mirrored {
            if let Some(ns) = sig.get("mtime_ns").and_then(Value::as_f64) {
                at = json!(ns / 1e9);
            }
            if let Some(t) = local.as_ref().and_then(|p| std::fs::metadata(p).ok()).and_then(|m| m.modified().ok()) {
                copied = json!(t.duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0));
            }
        }
        let st = self.state.lock().unwrap().clone();
        let checked = st.get("at").and_then(Value::as_f64).map(Value::from).unwrap_or(Value::Null);
        let mut out = json!({
            "remote": remote, "at": at, "mirrored": mirrored, "copiedAt": copied, "checkedAt": checked,
            "unreachable": st.get("unreachable").is_some_and(truthy), "reason": st.get("reason").cloned().unwrap_or(json!("")),
            "interval_sec": interval, "staleHours": stale_hours,
        });
        let o = out.as_object_mut().unwrap();
        match at.as_f64() {
            Some(a) => {
                let age = (now() - a) / 3600.0;
                o.insert("ageHours".into(), json!(round1(age)));
                o.insert("stale".into(), json!(stale_hours > 0.0 && age > stale_hours));
            }
            None => {
                o.insert("ageHours".into(), Value::Null);
                o.insert("stale".into(), Value::Null);
            }
        }
        out
    }

    fn next_wait(&self) -> Duration {
        let st = self.state.lock().unwrap().clone();
        let interval = self.conf.lock().unwrap().interval;
        let secs =
            if st.get("unreachable").is_some_and(truthy) && st.get("fails").and_then(Value::as_i64).filter(|n| *n != 0).unwrap_or(1) == 1 {
                interval.min(RETRY_AFTER_UNREACHABLE_SEC)
            } else if st.get("busy").is_some_and(truthy) {
                interval.min(RETRY_AFTER_BUSY_SEC)
            } else if !self.mirrored() {
                interval.min(RETRY_UNTIL_FIRST_COPY_SEC)
            } else {
                interval
            };
        Duration::from_secs(secs.max(1) as u64)
    }

    /// 背景の糸を始める（元が決まっていない・もう動いているなら何もしない）。
    pub fn start(self: &Arc<Self>) -> bool {
        let mut started = self.started.lock().unwrap();
        if *started || !self.enabled() {
            return false;
        }
        *started = true;
        let me = self.clone();
        std::thread::Builder::new()
            .name(format!("db-mirror-{}", self.key))
            .spawn(move || {
                me.refresh();
                {
                    let (m, cv) = &*me.wake;
                    m.lock().unwrap().first_done = true;
                    cv.notify_all();
                }
                loop {
                    let (m, cv) = &*me.wake;
                    let end = Instant::now() + me.next_wait();
                    let mut g = m.lock().unwrap();
                    while !g.woken {
                        let left = end.saturating_duration_since(Instant::now());
                        if left.is_zero() {
                            break;
                        }
                        g = cv.wait_timeout(g, left).unwrap().0;
                    }
                    g.woken = false;
                    drop(g);
                    me.refresh();
                }
            })
            .is_ok()
    }

    /// 次の周回を今すぐにする。
    pub fn wake(&self) {
        let (m, cv) = &*self.wake;
        m.lock().unwrap().woken = true;
        cv.notify_all();
    }
}

/// 元のファイルが同じかを比べる形（Python の work_log.same_place と同じ考え: 前後の空白と " を除き、. と .. と重なった区切りを畳む。
/// Windows では大文字小文字と / \\ の違いも同じと見る）。空なら ""
pub fn same_place(remote: &str) -> String {
    let s = remote.trim().trim_matches('"');
    if s.is_empty() {
        return String::new();
    }
    let win = cfg!(windows);
    let s = if win { s.replace('/', "\\").to_lowercase() } else { s.to_string() };
    let sep = if win { '\\' } else { '/' };
    let lead: String = s.chars().take_while(|c| *c == sep).collect();
    let lead = if win {
        lead.chars().take(2).collect()
    } else if lead.len() == 2 {
        lead
    } else {
        lead.chars().take(1).collect()
    };
    let mut parts: Vec<&str> = vec![];
    for p in s.split(sep).filter(|p| !p.is_empty() && *p != ".") {
        if p == ".." && parts.last().is_some_and(|l| *l != "..") {
            parts.pop();
        } else {
            parts.push(p);
        }
    }
    let body = parts.join(&sep.to_string());
    if lead.is_empty() && body.is_empty() {
        ".".into()
    } else {
        format!("{lead}{body}")
    }
}

/// 台帳の印と今の元の印が同じか（大きさ・更新時刻が同じで、元が同じファイル。元の字の書き方〈./ の有無など〉の違いは同じと見る。版 3.60.0）
fn same_signature(had: &Value, now: &Value) -> bool {
    let src = |v: &Value| same_place(v["source"].as_str().unwrap_or(""));
    had["size"] == now["size"] && had["mtime_ns"] == now["mtime_ns"] && src(had) == src(now)
}

/// 写しの係の束（キー → 係。作業実績の設備ごと・データ元ごと。Python の work_log.Mirrors と同じ決まり）。
/// 元が同じファイル（same_place）のキーどうしは 1 つの係を分け合う（同じファイルを 2 回写さない・2 つの写しが別の時刻の中身にならない）。
/// 間隔と古さのしきいは、係を作ったキー（持ち主）の設定に従う
pub struct Mirrors {
    cache_dir: PathBuf,
    prefix: String,
    all: Mutex<std::collections::HashMap<String, Arc<DbMirror>>>,
}

impl Mirrors {
    pub fn new(cache_dir: PathBuf, prefix: &str) -> Mirrors {
        Mirrors { cache_dir, prefix: prefix.into(), all: Mutex::default() }
    }

    fn own_key(&self, key: &str) -> String {
        DbMirror::new(&format!("{}_{key}", self.prefix), "", &self.cache_dir, 0, 0.0).key.clone()
    }

    /// キーの写しの係（無ければ作る）。背景の周回も始める
    pub fn get(&self, key: &str, remote: &str, interval_sec: i64, stale_hours: f64) -> Arc<DbMirror> {
        let place = same_place(remote);
        let own = self.own_key(key);
        let mut changed = false;
        let m = {
            let mut all = self.all.lock().unwrap();
            let find = |all: &std::collections::HashMap<String, Arc<DbMirror>>| {
                all.iter().find(|(k, m)| *k != key && same_place(&m.remote()) == place).map(|(_, m)| m.clone())
            };
            let mut m = all.get(key).cloned();
            if let Some(cur) = m.clone() {
                if same_place(&cur.remote()) != place {
                    let shared = all.iter().any(|(k, x)| k != key && Arc::ptr_eq(x, &cur));
                    if shared {
                        m = None; // 分け合っていれば抜ける
                    } else if !place.is_empty() && find(&all).is_some() {
                        cur.retire(); // 1 人なら、元の無い係にして持ち替える
                        m = None;
                    }
                }
            }
            match m {
                Some(cur) => {
                    if cur.key == own {
                        changed = cur.reconfigure_quiet(remote, interval_sec, stale_hours);
                    }
                    cur
                }
                None => {
                    let m = (!place.is_empty()).then(|| find(&all)).flatten().unwrap_or_else(|| {
                        DbMirror::new(&format!("{}_{key}", self.prefix), remote, &self.cache_dir, interval_sec, stale_hours)
                    });
                    all.insert(key.to_string(), m.clone());
                    m
                }
            }
        };
        if !m.start() && changed {
            m.wake(); // もう動いている係で元・間隔が変わったときは、次の周回を今すぐ（reconfigure と同じ）
        }
        m
    }

    pub fn peek(&self, key: &str) -> Option<Arc<DbMirror>> {
        self.all.lock().unwrap().get(key).cloned()
    }

    /// キーの写しの係。まだ無ければ、同じファイルを指す別のキーの係（get と同じく分け合う）、それも無ければ写さずに台帳と
    /// 周回の様子（`<キー>.state.json`）を読むだけの係（束に入れない・背景の周回を始めない。版 3.87.0: データ元の並びの答えは、
    /// 窓がまだ開いていない元も写しの様子を言う。受け身の Python の _status と同じ読み方）
    pub fn peek_or_passive(&self, key: &str, remote: &str, interval_sec: i64, stale_hours: f64) -> Arc<DbMirror> {
        let place = same_place(remote);
        let shared = {
            let all = self.all.lock().unwrap();
            all.get(key).cloned().or_else(|| {
                (!place.is_empty())
                    .then(|| all.iter().find(|(k, m)| *k != key && same_place(&m.remote()) == place).map(|(_, m)| m.clone()))
                    .flatten()
            })
        };
        shared.unwrap_or_else(|| {
            let m = DbMirror::new(&format!("{}_{key}", self.prefix), remote, &self.cache_dir, interval_sec, stale_hours);
            m.load_state();
            m
        })
    }

    /// keys の係が最初の写しを済ませるまで待つ（全部で timeout まで。1 つずつ timeout ずつ待たない）
    pub fn wait_first(&self, keys: &[String], timeout: Duration) {
        let end = Instant::now() + timeout;
        for k in keys {
            if let Some(m) = self.peek(k) {
                m.wait_first(end.saturating_duration_since(Instant::now()));
            }
        }
    }
}

fn interval_of(sec: i64) -> i64 {
    (if sec == 0 { DEFAULT_INTERVAL_SEC } else { sec }).max(MIN_INTERVAL_SEC)
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// Python の round(x, 1)（偶数への丸めの違いは 0.05 刻みの境目だけ。比べる側は 0.15 の幅を持つ）。
fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// 写せなかったときの文（Python の shutil.copyfile の誤り "[Errno 2] No such file or directory: 'パス'" と同じ形）。
fn copy_error_text(e: &std::io::Error, path: &str) -> String {
    let t = os_error_text(e);
    match t.split_once(' ').and_then(|(kind, rest)| rest.split_once(' ').map(|(n, msg)| (kind, n, msg))) {
        Some((kind, n, msg)) if e.raw_os_error().is_some() => format!("[{kind} {n}] {msg}: {}", crate::pyfmt::str_repr(path)),
        _ => t,
    }
}

fn cleanup(tmp: &Path) {
    let _ = retrying(1.0, || std::fs::remove_file(tmp));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 同じ元のキーどうしは 1 つの係を分け合う・元を替えたら抜ける・置いて行った係は写さない（Python の work_log.Mirrors と同じ決まり）
    #[test]
    fn mirrors_share_one_copy_per_file() {
        let dir = std::env::temp_dir().join(format!("qa-mirrors-{}", std::process::id()));
        let ms = Mirrors::new(dir.join("cache"), "src");
        let a = ms.get("wip", "/data/LOTNOW.sqlite3", 60, 24.0);
        let b = ms.get("wip2", " \"/data/./LOTNOW.sqlite3\" ", 300, 48.0);
        assert!(Arc::ptr_eq(&a, &b), "元が同じファイルなら 1 つの写しを分け合う");
        assert_eq!((a.key.as_str(), a.conf.lock().unwrap().interval), ("src_wip", 60), "間隔は係を作ったキーの設定");
        let c = ms.get("wip2", "/data/NEW.sqlite3", 60, 24.0);
        assert!(!Arc::ptr_eq(&c, &a) && a.remote() == "/data/LOTNOW.sqlite3", "分け合っていた元を替えたら抜ける");
        let d = ms.get("wip", "/data/NEW.sqlite3", 60, 24.0);
        assert!(Arc::ptr_eq(&d, &c), "ほかのキーが写しているファイルに替えたら、そちらに乗る");
        assert_eq!(a.remote(), "", "置いて行った係は写さない");
        assert!(ms.peek("wip").is_some_and(|m| Arc::ptr_eq(&m, &c)) && ms.peek("none").is_none());
        // . と .. と重なった区切りを畳む（Windows は区切りを \\ にそろえ、大文字小文字も同じと見る）
        assert_eq!(same_place("/a//b/../c/"), if cfg!(windows) { "\\a\\c" } else { "/a/c" });
        assert_eq!(same_place("/A/c") == same_place("/a/C"), cfg!(windows));
        assert_eq!(same_place(""), "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 台帳の元の字と係の元の字の書き方が違っても（./ の有無）、同じ写しを読む・写したと言う。元が空の係は写したと言わない（版 3.60.0）
    #[test]
    fn spelling_of_the_remote_does_not_hide_the_copy() {
        let dir = std::env::temp_dir().join(format!("qa-spell-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let remote = dir.join("SIKADEF.sqlite3");
        rusqlite::Connection::open(&remote).unwrap().execute_batch("CREATE TABLE t (a); INSERT INTO t VALUES (1);").unwrap();
        let cache = dir.join("cache");
        let spelled = dir.join(".").join("SIKADEF.sqlite3").display().to_string();
        assert_eq!(DbMirror::new("k", &spelled, &cache, 60, 36.0).refresh()["updated"], true);
        let m = DbMirror::new("k", &remote.display().to_string(), &cache, 60, 36.0);
        assert!(m.read_path_wait(false).is_some(), "台帳は ./ を挟んだ字・係は挟まない字でも読む");
        assert_eq!(m.source_info()["mirrored"], true);
        assert_eq!(m.refresh()["skipped"], true, "同じ元なので写し直さない");
        // 更新時刻が同じでも大きさが変われば、別の中身として写し直す
        let mtime = std::fs::metadata(&remote).unwrap().modified().unwrap();
        let mut f = std::fs::OpenOptions::new().append(true).open(&remote).unwrap();
        std::io::Write::write_all(&mut f, &[0u8; 4096]).unwrap();
        f.set_modified(mtime).unwrap();
        drop(f);
        assert_eq!(m.refresh()["updated"], true, "大きさが変われば写し直す");
        // 元が空の係: 台帳に空の元の行があり、写しのファイルも残っていても、写したと言わない
        let file = m.mirror_path().unwrap().file_name().unwrap().to_string_lossy().into_owned();
        assert!(cache.join(&file).exists());
        std::fs::write(cache.join(LEDGER), json!({"e": {"signature": {"source": ""}, "file": file}}).to_string()).unwrap();
        let e = DbMirror::new("e", "", &cache, 60, 36.0);
        assert_eq!((e.read_path_wait(false), e.source_info()["mirrored"].as_bool()), (None, Some(false)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 元を別の場所へ移したとき（大きさ・更新時刻を残したコピー）は、前の元の写しを使わず写し直す（印は元の場所も比べる。版 3.60.0）
    #[test]
    fn moving_the_remote_copies_again_even_with_the_same_size_and_time() {
        let dir = std::env::temp_dir().join(format!("qa-move-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("新しい共有")).unwrap();
        let a = dir.join("SIKADEF.sqlite3");
        rusqlite::Connection::open(&a).unwrap().execute_batch("CREATE TABLE t (a); INSERT INTO t VALUES (1);").unwrap();
        let b = dir.join("新しい共有").join("SIKADEF.sqlite3");
        std::fs::copy(&a, &b).unwrap();
        std::fs::File::options().write(true).open(&b).unwrap().set_modified(std::fs::metadata(&a).unwrap().modified().unwrap()).unwrap();
        let cache = dir.join("cache");
        let m = DbMirror::new("k", &a.display().to_string(), &cache, 60, 36.0);
        assert_eq!(m.refresh()["updated"], true);
        m.reconfigure_quiet(&b.display().to_string(), 60, 36.0);
        assert!(m.read_path_wait(false).is_none(), "移した先の写しはまだ無い");
        assert_eq!(m.refresh()["updated"], true, "大きさ・更新時刻が同じでも、元の場所が違えば写し直す");
        assert!(m.read_path_wait(false).is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 写し終えた後の確かめ（約束の R5）: 元が同じでも、書き手の印が出ていれば見送る。Python の _settled と同じ文。
    #[test]
    fn settled_refuses_when_the_writer_started() {
        let dir = std::env::temp_dir().join(format!("qa-settled-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let remote = dir.join("SIKADEF.sqlite3");
        std::fs::write(&remote, b"x").unwrap();
        let r = remote.display().to_string();
        let m = DbMirror::new("k", &r, &dir.join("cache"), 60, 36.0);
        let sig = m.remote_stat(&r, false).unwrap();
        assert_eq!(m.settled(&r, &sig), None);
        std::fs::write(dir.join("SIKADEF.sqlite3-journal"), b"j").unwrap();
        let why = m.settled(&r, &sig).unwrap();
        assert!(why.contains("書き始めた") && why.contains("SIKADEF.sqlite3-journal"), "{why}");
        std::fs::write(&remote, b"xy").unwrap();
        assert!(m.settled(&r, &sig).unwrap().contains("入れ替わった"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 写しがまだ無いあいだ（入れた直後）は、届かないが続いても間隔を待たずに写し直す。写せた後は間隔どおり（Python と同じ）
    #[test]
    fn retries_soon_until_the_first_copy() {
        let dir = std::env::temp_dir().join(format!("qa-first-copy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let remote = dir.join("SIKADEF.sqlite3");
        let m = DbMirror::new("k", &remote.display().to_string(), &dir.join("cache"), 3600, 36.0);
        for _ in 0..3 {
            assert!(m.refresh()["unreachable"] == true);
            assert_eq!(m.next_wait(), Duration::from_secs(RETRY_UNTIL_FIRST_COPY_SEC as u64), "写しが無いうちは 2 回目からも早めに");
        }
        let c = rusqlite::Connection::open(&remote).unwrap();
        c.execute_batch("CREATE TABLE t (a TEXT); INSERT INTO t VALUES ('x');").unwrap();
        drop(c);
        assert!(m.refresh()["updated"] == true);
        assert!(m.refresh()["updated"] == false);
        assert_eq!(m.next_wait(), Duration::from_secs(3600), "写せた後は間隔どおり");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
