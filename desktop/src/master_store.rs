//! マスタの書く係（版 3.67.0。順 5 の 2 段目 a）。Python の `program/app/repositories/master_store.py` の MasterStore の書く所を写した物。
//!
//! ```text
//! 書く … 錠を取る → 共有から取り直す（共有にまだ無ければ写し・同梱の data/ を最初の版として置く: seed）→ 行に当てる → 版を上げる
//!        → 置き換える直前に錠と共有がそのままかを確かめる → 共有と写しを丸ごと置き換える（書き切ってから名前を替える）→ 錠を返す。
//! 手元だけのマスタ（共有しない設定・共有しない名前）は data/ に錠を取り、行の配列（昔の形）で書く。
//! ```
//!
//! 錠は置き場ごとに 1 つ（共有の master.lock.json か data/ の物）。持ち主は PC 名・ログイン ID・この PC のアプリの印（instance_id）と
//! 係（py＝Python・rs＝窓）。窓と Python は同じ作業場所の instance_id を使い、係で見分ける（版 3.64.0 の決まり）。
//!
//! 答えは Python と同じ（評価関数: tests/masters_parity.rs ← program/tests/masters_oracle.py。同じ手順を両方の書く係に当て、
//! 答え・断る言葉・できたファイルを突き合わせる）。違う所: ファイルの中の鍵の並び（serde_json は名前の順。Python は書いた順）。
//! 読む側はどちらも鍵で引くので、中身は同じ。

use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const LOCK_FILENAME: &str = "master.lock.json";
const LOCK_TRIES: usize = 5;
const LOCK_MOVE_BUDGET: Duration = Duration::from_millis(500);
pub const LOCK_TTL_DEFAULT: f64 = 20.0;
const SCHEMA: i64 = 1;
const INSTANCE_FILENAME: &str = "instance_id";
/// 共有フォルダがあればいつも共有するマスタ（Python の SHARED_ALWAYS と同じ）
pub const SHARED_ALWAYS: &[&str] = &[
    "path_settings",
    "access_permissions",
    "app_seeds",
    "ui_defaults",
    "work_log_files",
    "display_formats",
    "shift_patterns",
    "pivot_presets",
    "pivot_quick",
    "data_sources",
    "dashboard_settings",
    "dashboards",
    "equipment_groups",
    "conversions",
    "conversion_defaults",
    "tab_access",
];

// ------------------------------------------------------------------ 断る理由（画面へ返す。Python の MasterError と同じ形）

#[derive(Debug, Clone, PartialEq)]
pub enum MasterError {
    /// ほかの PC（同じ PC のもう 1 つの係）が保存中
    Locked {
        pc: String,
        login: String,
        remaining: i64,
        same_pc: bool,
    },
    /// 開いてから保存するまでに同じ行が変わった（None は消された）
    Conflict(Option<Value>),
    Duplicate(String),
    NotFound(String),
    /// 共有に届かない・錠を置けない
    Unavailable(String),
    /// 行の確かめで断る（master_repository.InvalidRow。400・invalid。版 3.77.0）
    Invalid(String),
    /// そのほか（読めない・書けない）。Python では例外のまま 500
    Error(String),
}

impl MasterError {
    pub fn kind(&self) -> &'static str {
        match self {
            MasterError::Locked { .. } => "locked",
            MasterError::Conflict(_) => "conflict",
            MasterError::Duplicate(_) => "duplicate",
            MasterError::NotFound(_) => "not_found",
            MasterError::Unavailable(_) => "unavailable",
            MasterError::Invalid(_) => "invalid",
            MasterError::Error(_) => "error",
        }
    }

    pub fn status(&self) -> u16 {
        match self {
            MasterError::Locked { .. } | MasterError::Conflict(_) | MasterError::Duplicate(_) => 409,
            MasterError::NotFound(_) => 404,
            MasterError::Unavailable(_) => 503,
            MasterError::Invalid(_) => 400,
            MasterError::Error(_) => 500,
        }
    }

    pub fn message(&self) -> String {
        match self {
            MasterError::Locked { pc, login, remaining, same_pc } => {
                let who = if *same_pc {
                    "この PC のもう 1 つの係（アプリの中身・窓）".to_string()
                } else {
                    let w = [pc.as_str(), login.as_str()].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join("／");
                    if w.is_empty() {
                        "ほかの PC".into()
                    } else {
                        w
                    }
                };
                format!("{who} がマスタを保存中です（あと約{remaining}秒）。少し待つと保存できます。")
            }
            MasterError::Conflict(None) => "この行は、ほかの PC で削除されました。".into(),
            MasterError::Conflict(Some(cur)) => {
                // Python: current.get("updated_by") or {}（無い・空は「ほかの PC」）
                let by = cur.get("updated_by").filter(|v| v.is_object()).cloned().unwrap_or(json!({}));
                let s = |v: &Value| v.as_str().unwrap_or("").to_string();
                let w = [s(&by["pc"]), s(&by["login"])].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join("／");
                let who = if w.is_empty() { "ほかの PC".to_string() } else { w };
                let when: String =
                    cur.get("updated_at").map(crate::worksum::py_str).unwrap_or_default().replace('T', " ").chars().take(16).collect();
                format!("この行は、開いたあとに {who} が変更しました（{when}）。")
            }
            MasterError::Duplicate(m)
            | MasterError::NotFound(m)
            | MasterError::Unavailable(m)
            | MasterError::Invalid(m)
            | MasterError::Error(m) => m.clone(),
        }
    }

    /// 画面へ返す中身（Python の payload() と同じ鍵）
    pub fn payload(&self) -> Value {
        let mut out = json!({"error": self.message(), "kind": self.kind()});
        match self {
            MasterError::Locked { pc, login, remaining, .. } => {
                out["holder_pc"] = json!(pc);
                out["holder_login"] = json!(login);
                out["remaining"] = json!(remaining);
            }
            MasterError::Conflict(cur) => out["current"] = cur.clone().unwrap_or(Value::Null),
            _ => {}
        }
        out
    }
}

type R<T> = Result<T, MasterError>;

fn io_err(e: impl std::fmt::Display) -> MasterError {
    MasterError::Error(e.to_string())
}

// ------------------------------------------------------------------ 小さな部品

/// 変わったかの目印（更新時刻 ns・大きさ）。届かなければ None
pub fn stat_sig(path: &Path) -> Option<(u128, u64)> {
    let m = std::fs::metadata(path).ok()?;
    let t = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
    Some((t, m.len()))
}

/// 32 字の印（錠の token・一時ファイルの名前。重ならなければよい）
pub fn hex_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut out = String::new();
    for salt in 0..2u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(n);
        h.write_u128(t);
        h.write_u32(std::process::id());
        h.write_u64(salt);
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

pub fn now_local() -> chrono::NaiveDateTime {
    chrono::Local::now().naive_local()
}

/// Python の datetime.isoformat(timespec="seconds")
pub fn iso(t: chrono::NaiveDateTime) -> String {
    t.format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// 読む（BOM を外す）。Windows の std::fs は読んでいる間もほかが置き換えられる開き方（FILE_SHARE_DELETE）で開く
fn read_json(path: &Path) -> std::io::Result<Value> {
    let b = std::fs::read(path)?;
    let b = b.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&b);
    let bad = |m: String| std::io::Error::new(std::io::ErrorKind::InvalidData, m);
    match serde_json::from_slice(b) {
        Ok(v) => {
            // serde_json は i64・u64 に入らない整数を小数に変えて読む。書き戻すと値が黙って変わるので、窓は書かずに断る
            if has_wide_int(b) {
                return Err(bad(format!(
                    "{}: 窓では値を変えずに書けない大きな整数があります（Python の書く係で保存してください）",
                    path.display()
                )));
            }
            Ok(v)
        }
        Err(e) => {
            let text = String::from_utf8_lossy(b);
            if ["NaN", "Infinity"].iter().any(|w| text.contains(w)) || text.contains("E400") || text.contains("e400") {
                return Err(bad(format!("{}: 窓では読めない数（NaN・Infinity・大きすぎる数）があります（{e}）", path.display())));
            }
            Err(bad(format!("{}: {e}", path.display())))
        }
    }
}

/// 字の外に、i64・u64 に入らない整数（小数点・指数の無い数）があるか
pub(crate) fn has_wide_int(b: &[u8]) -> bool {
    let (mut i, mut in_str) = (0, false);
    while i < b.len() {
        let c = b[i];
        if in_str {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == b'"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        if c == b'"' {
            in_str = true;
            i += 1;
            continue;
        }
        if c == b'-' || c.is_ascii_digit() {
            let s = i;
            i += 1;
            while i < b.len() && (b[i].is_ascii_digit() || matches!(b[i], b'.' | b'e' | b'E' | b'+' | b'-')) {
                i += 1;
            }
            let tok = std::str::from_utf8(&b[s..i]).unwrap_or("");
            if !tok.contains(['.', 'e', 'E']) && tok.parse::<i64>().is_err() && tok.parse::<u64>().is_err() {
                return true;
            }
            continue;
        }
        i += 1;
    }
    false
}

/// この窓（このプロセス）のどこかの糸が、いま持っている錠の印（取れたら入れ、外したら出す）。
/// 同じ係の錠でも、ここにある錠は「自分が落ちて残した錠」ではなく生きた錠なので、引き継がずに待つ（版 3.94.0 の CI。
/// 起動の直後に並んだ道が最初の版を置くとき、互いの生きた錠をどけ合い、保存が途中で断られ、空の錠が残った）
static LIVE: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn live(token: &str, add: bool) {
    let mut g = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let set = g.get_or_insert_with(HashSet::new);
    if add {
        set.insert(token.to_string());
    } else {
        set.remove(token);
    }
}

fn is_live(token: Option<&Value>) -> bool {
    let Some(t) = token.and_then(Value::as_str) else { return false };
    LIVE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(|s| s.contains(t))
}

/// 錠の印（無い・null は印なし。Python の lock.get("token") が None）
fn token_of(v: Option<&Value>) -> Option<Value> {
    v.filter(|x| !x.is_null()).cloned()
}

/// 版の番号（Python の int(revision): 数・小数〈切り捨て〉・真偽〈1・0〉・字〈前後の空白と数字の間の _ を許す〉）
fn revision_of(v: &Value) -> Option<i64> {
    match v {
        Value::Bool(b) => Some(*b as i64),
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.is_finite() && f.abs() < 9.2e18).map(|f| f.trunc() as i64)),
        Value::String(s) => {
            let t = s.trim();
            let body = t.strip_prefix(['+', '-']).unwrap_or(t);
            let ok = !body.is_empty()
                && !body.starts_with('_')
                && !body.ends_with('_')
                && !body.contains("__")
                && body.chars().all(|c| c.is_ascii_digit() || c == '_');
            if ok {
                t.replace('_', "").parse().ok()
            } else {
                None
            }
        }
        _ => None,
    }
}

/// マスタ・錠はディスクへ書き切ってから置き換える（停電・切断でも書きかけを残さない。Python の write_json_atomic(durable=True)）
pub fn write_json_atomic(path: &Path, data: &Value) -> std::io::Result<()> {
    let mut body = serde_json::to_vec_pretty(data).map_err(std::io::Error::other)?;
    body.push(b'\n');
    write_bytes_atomic(path, &body)
}

/// この PC の写し（master_cache）を書く。窓と Python は同じ写しのファイルを置き換え合うので、Windows で相手が開いている間の置き換えの
/// 断り（ERROR_ACCESS_DENIED・ERROR_SHARING_VIOLATION＝PermissionDenied）は 0.5 秒までやり直す（版 3.101.0。Python の _pull も同じ長さ）。
/// それでも書けなければ Err（呼ぶ側は取り直せなかった理由を覚え、status の error に出す: 黙って古い写しのまま答えない）
pub fn write_mirror(path: &Path, data: &Value) -> std::io::Result<()> {
    let end = Instant::now() + MIRROR_RETRY;
    loop {
        match write_json_atomic(path, data) {
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied && Instant::now() < end => {
                std::thread::sleep(Duration::from_millis(50))
            }
            r => return r,
        }
    }
}

/// 写しの置き換えをやり直す長さ
pub const MIRROR_RETRY: Duration = Duration::from_millis(500);

/// 字を書き切ってから置き換える（write_json_atomic の中身。Python の json.dumps の字〈鍵の順・字下げ〉を書くとき: 版 3.101.0）
pub fn write_bytes_atomic(path: &Path, body: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.{}.tmp", hex_id()));
    let res = (|| {
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        f.write_all(body)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)
    })();
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res
}

/// 無ければ作って書く（あれば AlreadyExists）。作れた 1 つだけが持つ。
/// 作れても書き切れない（共有の空きが尽きた・切断など）ときは、作った空・書きかけのファイルを残さずに返す（版 3.99.0。Python の _create_exclusive）。
/// 前は 0 バイトの錠が残り、ほかの PC・次に開いた窓が、見てから錠の長さのあいだ「ほかの PC がマスタを保存中です」で断られた
fn create_exclusive(path: &Path, body: &[u8]) -> std::io::Result<()> {
    create_exclusive_with(path, body, |f, b| f.write_all(b))
}

fn create_exclusive_with(
    path: &Path,
    body: &[u8],
    write: impl FnOnce(&mut std::fs::File, &[u8]) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(path)?;
    let res = write(&mut f, body);
    drop(f);
    if res.is_err() {
        drop_unwritten(path, body);
    }
    res
}

/// 書き切れなかった自分のファイルを消す。名前を変えてどけてから中身を見る（その間にほかが置いた物を消さない）:
/// どけた物が自分の書きかけ（body の頭・空）なら消し、ほかの中身なら「無ければ作る」で元へ戻す（Python の _drop_unwritten）
fn drop_unwritten(path: &Path, body: &[u8]) {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let aside = path.with_file_name(format!(".{name}.{}.gone", hex_id()));
    if std::fs::rename(path, &aside).is_err() {
        return;
    }
    let raw = std::fs::read(&aside).unwrap_or_default();
    if !body.starts_with(&raw) {
        let _ = create_exclusive(path, &raw);
    }
    let _ = std::fs::remove_file(&aside);
}

/// fn() を、OSError のあいだ budget まで間を広げながらやり直す（無い〈NotFound〉はやり直さない。Python の fsio.retrying）
fn retrying<T>(mut f: impl FnMut() -> std::io::Result<T>, budget: Duration) -> std::io::Result<T> {
    let (mut delay, mut waited) = (Duration::from_millis(50), Duration::ZERO);
    loop {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(e),
            Err(e) => {
                if waited >= budget {
                    return Err(e);
                }
                std::thread::sleep(delay);
                waited += delay;
                delay = (delay * 2).min(Duration::from_millis(500));
            }
        }
    }
}

/// この PC のアプリの印（作業場所の instance_id。Python と同じファイル。無ければ作る）
pub fn instance_id(root: &Path) -> String {
    let path = root.join(INSTANCE_FILENAME);
    if let Ok(s) = std::fs::read_to_string(&path) {
        if !s.trim().is_empty() {
            return s.trim().to_string();
        }
    }
    let mine = hex_id();
    let _ = std::fs::create_dir_all(root);
    match create_exclusive(&path, mine.as_bytes()) {
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            std::fs::read_to_string(&path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or(mine)
        }
        _ => mine,
    }
}

/// マスタの中身（{schema, revision, updated_at, updated_by, rows}）
#[derive(Debug, Clone)]
pub struct Doc {
    pub revision: i64,
    pub updated_at: Value,
    pub updated_by: Value,
    pub rows: Vec<Value>,
}

impl Doc {
    pub fn empty() -> Doc {
        Doc { revision: 0, updated_at: json!(""), updated_by: json!({}), rows: vec![] }
    }

    /// 共有・写しは {schema, revision, rows…}、同梱の data/ は行の配列（昔の形）。どちらも読む（Python の _as_doc）
    fn from_value(v: Value) -> R<Doc> {
        match v {
            Value::Array(rows) => Ok(Doc { rows, ..Doc::empty() }),
            Value::Object(mut o) if matches!(o.get("rows"), Some(Value::Array(_))) => {
                let rows = match o.remove("rows") {
                    Some(Value::Array(a)) => a,
                    _ => vec![],
                };
                let revision = match o.get("revision") {
                    None => 0,
                    Some(v) => revision_of(v).ok_or_else(|| io_err("マスタの版が読めません"))?,
                };
                let by = match o.remove("updated_by") {
                    None | Some(Value::Null) => json!({}),
                    Some(v) if v.as_object().is_some_and(|m| m.is_empty()) || v == json!("") || v == json!(false) || v == json!(0) => {
                        json!({})
                    }
                    Some(v) => v,
                };
                Ok(Doc { revision, updated_at: o.remove("updated_at").unwrap_or(json!("")), updated_by: by, rows })
            }
            _ => Err(io_err("マスタの形が読めません")),
        }
    }

    pub fn read(path: &Path) -> R<Doc> {
        Doc::from_value(read_json(path).map_err(io_err)?)
    }

    fn to_value(&self) -> Value {
        json!({"schema": SCHEMA, "revision": self.revision, "updated_at": self.updated_at, "updated_by": self.updated_by, "rows": self.rows})
    }
}

/// 錠をどけた結果
#[derive(Debug, PartialEq)]
enum Away {
    Ok,
    Other,
    Gone,
    Error,
}

/// この糸の錠の置き場（Python の threading.local の _where）
#[derive(Default, Clone)]
struct Where {
    local: bool,
    dir: Option<PathBuf>,
    held: bool,
    /// この糸が書く錠（write_lock）を持っているか（Python の RLock と同じく、持っている糸はもう一度取れる）
    writing: bool,
}

thread_local! {
    /// Store ごと・糸ごとの錠の置き場（Python の _where は MasterStore ごとの threading.local。Store をまたいで 1 つにすると、
    /// ある置き場の exclusive の中で別の置き場の Store が書いたとき、前の置き場の錠を見てしまう）
    static WHERE: RefCell<HashMap<u64, Where>> = RefCell::new(HashMap::new());
}

/// 置き場を変えている間の覚え。抜けるとき（断った・panic した時も）元へ戻す
struct Scoped {
    store: u64,
    before: Where,
}

impl Drop for Scoped {
    fn drop(&mut self) {
        let (id, before) = (self.store, std::mem::take(&mut self.before));
        WHERE.with(|m| {
            m.borrow_mut().insert(id, before);
        });
    }
}

/// 置き場と名乗り（Store を作る材料）
#[derive(Debug, Clone)]
pub struct Config {
    /// 同梱の data/（手元だけのマスタ・その錠）
    pub data: PathBuf,
    /// マスタの最初の中身（app/master_defaults）
    pub defaults: PathBuf,
    /// 共有の置き場（無ければ手元だけ）
    pub share_dir: Option<PathBuf>,
    /// 共有するマスタの名前（設定の masters ＋ SHARED_ALWAYS）
    pub shared: Vec<String>,
    /// 写しの置き場（作業場所の master_cache）
    pub cache: PathBuf,
    /// 作業場所（instance_id）
    pub local_root: PathBuf,
    pub pc: String,
    pub login: String,
    pub role: String,
    pub lock_ttl: f64,
}

/// マスタの書く係。**置き場ごとに 1 つ作り、長く持つ**（道ごとに作り直さない）: 錠の残り秒は「この PC で最初に見てからの経過」で
/// 測るので（相手の時計を信じない）、作り直すと覚えが消え、期限の過ぎた錠もいつまでも「保存中」と断る
pub struct Store {
    id: u64,
    cfg: Config,
    shared: HashSet<String>,
    instance: String,
    holder: String,
    write_lock: Mutex<()>,
    lock_seen: Mutex<HashMap<String, Instant>>,
    share_sig: Mutex<HashMap<String, (u128, u64)>>,
    /// 最後に共有から写しを取り直した時刻・最後に取り直せなかった理由（Python の _last_sync・_last_error と同じ意味。
    /// このプロセスの覚え。GET /api/masters/status の last_sync・error。版 3.101.0）
    last_sync: Mutex<String>,
    last_error: Mutex<String>,
}

impl Store {
    pub fn new(cfg: Config) -> Store {
        let instance = instance_id(&cfg.local_root);
        let holder = format!("{instance}:{}", cfg.role);
        let shared = cfg.shared.iter().cloned().collect();
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        Store {
            id: NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            cfg,
            shared,
            instance,
            holder,
            write_lock: Mutex::new(()),
            lock_seen: Mutex::new(HashMap::new()),
            share_sig: Mutex::new(HashMap::new()),
            last_sync: Mutex::new(String::new()),
            last_error: Mutex::new(String::new()),
        }
    }

    /// 一覧の設定の access（{who, place}）から作る（Lot::store_for・試験）。置き場の材料が無ければ None
    pub fn from_access(conf: &Value, role: &str) -> Option<Store> {
        let p = &conf["place"];
        let path = |k: &str| p[k].as_str().filter(|s| !s.is_empty()).map(PathBuf::from);
        let cache = path("cache")?;
        Some(Store::new(Config {
            data: path("data")?,
            defaults: path("defaults")?,
            share_dir: path("shareDir"),
            shared: p["shared"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(),
            local_root: cache.parent()?.to_path_buf(),
            cache,
            pc: conf["who"]["pc"].as_str().unwrap_or("").into(),
            login: conf["who"]["login"].as_str().unwrap_or("").into(),
            role: role.into(),
            lock_ttl: p["lockTtl"].as_f64().unwrap_or(LOCK_TTL_DEFAULT),
        }))
    }

    pub fn is_shared(&self, name: &str) -> bool {
        self.cfg.share_dir.is_some() && self.shared.contains(name)
    }

    pub fn share_reachable(&self) -> bool {
        self.cfg.share_dir.as_ref().is_some_and(|d| d.is_dir())
    }

    fn bundled(&self, name: &str) -> PathBuf {
        self.cfg.data.join(format!("{name}.json"))
    }

    /// 共有・写しが無いときに読む物: 同梱の data/ → 無ければ最初の中身
    fn initial(&self, name: &str) -> PathBuf {
        let p = self.bundled(name);
        if p.exists() {
            p
        } else {
            self.cfg.defaults.join(format!("{name}.json"))
        }
    }

    pub fn share_file(&self, name: &str) -> Option<PathBuf> {
        self.cfg.share_dir.as_ref().map(|d| d.join(format!("{name}.json")))
    }

    pub fn mirror(&self, name: &str) -> PathBuf {
        self.cfg.cache.join(format!("{name}.json"))
    }

    /// この糸のこの Store の錠の置き場
    fn wh(&self) -> Where {
        WHERE.with(|m| m.borrow().get(&self.id).cloned().unwrap_or_default())
    }

    /// 錠の置き場を変える（返す物を持つ間だけ。抜けると元へ戻る）
    fn scoped(&self, f: impl FnOnce(&mut Where)) -> Scoped {
        let before = self.wh();
        let mut now = before.clone();
        f(&mut now);
        WHERE.with(|m| {
            m.borrow_mut().insert(self.id, now);
        });
        Scoped { store: self.id, before }
    }

    fn lock_file(&self) -> PathBuf {
        let w = self.wh();
        if let Some(d) = w.dir {
            return d.join(LOCK_FILENAME);
        }
        if w.local {
            return self.cfg.data.join(LOCK_FILENAME);
        }
        self.cfg.share_dir.clone().unwrap_or_else(|| self.cfg.data.clone()).join(LOCK_FILENAME)
    }

    /// この PC の中で書き込みを 1 本にまとめる（同じ糸はもう一度入れる）
    fn serialized<T>(&self, f: impl FnOnce() -> T) -> T {
        if self.wh().writing {
            return f();
        }
        let _g = self.write_lock.lock().unwrap_or_else(|e| e.into_inner());
        let _s = self.scoped(|w| w.writing = true);
        f()
    }

    // ---------------------------------------------------------- 錠

    fn read_lock(&self) -> Option<Map<String, Value>> {
        let p = self.lock_file();
        // 錠は書き戻さないので、マスタ用の「値を変えずに書けない数を断る」読み方は使わない（大きな整数の印でも読み、どけられる）
        let read = std::fs::read(&p).and_then(|b| {
            let b = b.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&b);
            serde_json::from_slice::<Value>(b).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
        });
        match read {
            Ok(Value::Object(o)) => Some(o),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            // 書きかけ・壊れた錠。中身の代わりに目印を印にし、期限はほかの錠と同じく見てからの経過で測る
            _ => stat_sig(&p).map(|(t, n)| {
                let mut o = Map::new();
                o.insert("token".into(), json!(format!("broken:{t}:{n}")));
                o.insert("expires_at".into(), json!(""));
                o
            }),
        }
    }

    fn by_clock(lock: &Map<String, Value>) -> f64 {
        lock.get("expires_at")
            .and_then(|v| v.as_str())
            .and_then(crate::access::parse_at)
            .map(|t| (t - now_local()).num_microseconds().unwrap_or(0) as f64 / 1e6)
            .unwrap_or(0.0)
    }

    /// 錠の残り秒（相手の時計を信じない: 書かれた期限と、この PC で最初に見てからの経過の、長く待つ方。期限は錠の長さまで）
    fn remaining(&self, lock: &Map<String, Value>) -> f64 {
        // 覚えの鍵は Python の `lock.get("token") or ""` と同じ: 空とみなす値（無い・null・""・0・false・空の表と配列）は ""、
        // ほかは値の形のまま（数の 5 と字の "5" は別の錠）
        let token = match lock.get("token") {
            None | Some(Value::Null) | Some(Value::Bool(false)) => String::new(),
            Some(Value::String(s)) if s.is_empty() => String::new(),
            Some(Value::String(s)) => format!("s:{s}"),
            Some(Value::Number(n)) if n.as_f64() == Some(0.0) => String::new(),
            Some(Value::Array(a)) if a.is_empty() => String::new(),
            Some(Value::Object(o)) if o.is_empty() => String::new(),
            Some(v) => format!("v:{v}"),
        };
        let now = Instant::now();
        let ttl = self.cfg.lock_ttl;
        let first = {
            let mut seen = self.lock_seen.lock().unwrap_or_else(|e| e.into_inner());
            seen.retain(|_, t| now.duration_since(*t).as_secs_f64() <= 10.0 * ttl);
            *seen.entry(token).or_insert(now)
        };
        let by_clock = Self::by_clock(lock);
        (if by_clock <= ttl { by_clock } else { 0.0 }).max(ttl - now.duration_since(first).as_secs_f64())
    }

    /// 画面に出す「あと何秒」
    fn wait(&self, lock: &Map<String, Value>) -> i64 {
        let left = self.remaining(lock);
        let by_clock = Self::by_clock(lock);
        let v = if 0.0 < by_clock && by_clock <= left { by_clock } else { left };
        1.max(v.trunc() as i64 + 1)
    }

    fn locked(&self, lock: Option<&Map<String, Value>>, remaining: i64) -> MasterError {
        let s = |k: &str| lock.and_then(|l| l.get(k)).map(crate::worksum::py_str).unwrap_or_default();
        let (pc, login, inst) = (s("holder_pc"), s("holder_login"), s("holder_instance"));
        let same = !pc.is_empty()
            && pc == self.cfg.pc
            && login == self.cfg.login
            && inst.starts_with(&format!("{}:", self.instance))
            && inst != self.holder;
        MasterError::Locked { pc, login, remaining, same_pc: same }
    }

    /// 持ち主が自分（この PC のこのアプリのこの係）が落ちて残した錠か。名乗れない PC は自分と言わない。
    /// この窓のほかの糸がいま持っている錠（生きた錠）は自分の物と言わない（どけると、持っている方の保存が途中で断られる）
    fn is_mine(&self, lock: &Map<String, Value>) -> bool {
        let (pc, login) = (&self.cfg.pc, &self.cfg.login);
        if pc.is_empty() || login.is_empty() || lock.is_empty() || is_live(lock.get("token")) {
            return false;
        }
        let inst = lock.get("holder_instance");
        let mine = inst == Some(&json!(self.holder)) || (self.cfg.role == "py" && inst == Some(&json!(self.instance)));
        lock.get("holder_pc") == Some(&json!(pc)) && lock.get("holder_login") == Some(&json!(login)) && mine
    }

    /// 錠を取る → 錠の印（token）
    fn acquire_lock(&self) -> R<String> {
        let w = self.wh();
        let local = w.local || w.dir.as_deref() == Some(self.cfg.data.as_path());
        let p = self.lock_file();
        if local {
            if let Some(d) = p.parent() {
                let _ = std::fs::create_dir_all(d);
            }
        } else if w.dir.is_none() && !self.share_reachable() {
            return Err(MasterError::Unavailable(format!(
                "共有フォルダに届かないため保存できません（読みは手元の写しで続けています）: {}",
                self.cfg.share_dir.as_ref().map(|d| d.display().to_string()).unwrap_or_default()
            )));
        }
        let token = hex_id();
        let now = now_local();
        let body = serde_json::to_vec(&json!({
            "token": token, "holder_pc": self.cfg.pc, "holder_login": self.cfg.login, "holder_instance": self.holder,
            "acquired_at": iso(now), "expires_at": iso(now + chrono::Duration::milliseconds((self.cfg.lock_ttl * 1000.0) as i64)),
        }))
        .map_err(io_err)?;
        let mut done = false;
        for _ in 0..LOCK_TRIES {
            match create_exclusive(&p, &body) {
                Ok(()) => {
                    done = true;
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let Some(cur) = self.read_lock() else { continue };
                    if self.remaining(&cur) > 0.0 && !self.is_mine(&cur) {
                        let wait = self.wait(&cur);
                        return Err(self.locked(Some(&cur), wait));
                    }
                    self.take_away(token_of(cur.get("token")).as_ref());
                }
                Err(e) => {
                    let place = if local { "手元のマスタの置き場（data）" } else { "共有フォルダ" };
                    return Err(MasterError::Unavailable(format!("{place}に錠を置けません: {e}")));
                }
            }
        }
        if !done {
            let cur = self.read_lock();
            return Err(self.locked(cur.as_ref(), 2));
        }
        let check = self.read_lock();
        if check.as_ref().and_then(|c| c.get("token")) != Some(&json!(token)) {
            return Err(self.locked(check.as_ref(), 2));
        }
        live(&token, true);
        Ok(token)
    }

    /// 錠を名前を変えてどける（名前の変更は 1 つしか成功しない）。思っていた錠でなければ元へ戻す。
    /// 印は値のまま比べる（Python の got == expected_token。印の無い錠・null の錠どうしは同じ、数の印は数で比べる）
    fn take_away(&self, expected: Option<&Value>) -> Away {
        let p = self.lock_file();
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let aside = p.with_file_name(format!(".{name}.{}.gone", hex_id()));
        match retrying(|| std::fs::rename(&p, &aside), LOCK_MOVE_BUDGET) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Away::Gone,
            Err(_) => return Away::Error,
        }
        let out = match std::fs::read(&aside) {
            Ok(raw) => {
                // 書きかけ・壊れた錠・表でない錠は印なし（Python の ValueError・AttributeError → None）
                let got = serde_json::from_slice::<Value>(&raw).ok().filter(|v| v.is_object()).and_then(|v| token_of(v.get("token")));
                let broken = expected.and_then(|e| e.as_str()).is_some_and(|s| s.starts_with("broken:"));
                let same = got.as_ref() == expected || (got.is_none() && broken);
                if same {
                    Away::Ok
                } else {
                    // 取り違えた。元の持ち主へ戻す。ただし中身の読めない錠（ほかが「無ければ作る」で作り、まだ書いていない）は戻さない:
                    // 作った方はどけられた方へ書き、確かめで断るので、戻した錠はだれの物でもなく、錠の長さのあいだ皆を止める（版 3.94.0 の CI）
                    if got.is_some() {
                        let _ = create_exclusive(&p, &raw);
                    }
                    Away::Other
                }
            }
            Err(_) => Away::Other,
        };
        let _ = std::fs::remove_file(&aside);
        out
    }

    fn release_lock(&self, token: Option<&str>) {
        if let Some(t) = token {
            if self.take_away(Some(&json!(t))) == Away::Error {
                eprintln!("マスタの錠を消せませんでした（{}秒で切れます）", self.cfg.lock_ttl);
            }
            live(t, false); // 消せずに残った錠は、落ちて残した錠と同じく引き継げる
        }
    }

    /// 錠を持って f を行い、外す（f が断っても・panic しても外す）
    fn with_lock<T>(&self, f: impl FnOnce(&str) -> R<T>) -> R<T> {
        let token = self.acquire_lock()?;
        struct Release<'a>(&'a Store, String);
        impl Drop for Release<'_> {
            fn drop(&mut self) {
                self.0.release_lock(Some(&self.1));
            }
        }
        let held = Release(self, token);
        let out = f(&held.1);
        drop(held);
        out
    }

    // ---------------------------------------------------------- 共有から取り直す

    /// 共有から写しを取り直す（共有にまだ無ければ seed）。取り直したら true
    pub fn pull(&self, name: &str, force: bool, have_lock: bool) -> R<bool> {
        let Some(src) = self.share_file(name) else { return Ok(false) };
        let mut sig = stat_sig(&src);
        if sig.is_none() {
            if !self.share_reachable() {
                return Err(MasterError::Unavailable(format!(
                    "共有フォルダに届きません: {}",
                    self.cfg.share_dir.as_ref().map(|d| d.display().to_string()).unwrap_or_default()
                )));
            }
            self.seed(name, have_lock)?;
            sig = stat_sig(&src);
            if sig.is_none() {
                return Ok(false);
            }
        }
        let mirror = self.mirror(name);
        {
            let s = self.share_sig.lock().unwrap_or_else(|e| e.into_inner());
            if !force && s.get(name) == sig.as_ref() && mirror.exists() {
                return Ok(false);
            }
        }
        let doc = Doc::read(&src)?;
        write_mirror(&mirror, &doc.to_value()).map_err(io_err)?;
        self.share_sig.lock().unwrap_or_else(|e| e.into_inner()).insert(name.to_string(), sig.unwrap_or_default());
        *self.last_error.lock().unwrap_or_else(|e| e.into_inner()) = String::new();
        *self.last_sync.lock().unwrap_or_else(|e| e.into_inner()) = iso(now_local());
        Ok(true)
    }

    /// 共有にマスタが無いとき、手元の写し（無ければ同梱の data/・最初の中身）を最初の版として置く。錠を取って行う
    fn seed(&self, name: &str, have_lock: bool) -> R<()> {
        let have = have_lock || self.wh().held;
        let go = |_: &str| -> R<()> {
            let Some(src) = self.share_file(name) else { return Ok(()) };
            if stat_sig(&src).is_some() {
                return Ok(());
            }
            let mirror = self.mirror(name);
            let seed = if mirror.exists() { mirror } else { self.initial(name) };
            let mut doc = if seed.exists() { Doc::read(&seed)? } else { Doc::empty() };
            doc.revision = doc.revision.max(1);
            doc.updated_at = json!(iso(now_local()));
            doc.updated_by = self.who();
            write_json_atomic(&src, &doc.to_value()).map_err(io_err)
        };
        if have {
            go("")
        } else {
            // この窓の書き込みと 1 本にまとめる（保存中のほかの糸の錠に当たって断り、最初の版を Python に任せない）
            self.serialized(|| self.with_lock(go))
        }
    }

    /// マスタの版の番号（Python の MasterStore.revision: 共有するマスタは共有から取り直した写し、手元だけは data/〈行の配列なら 0〉→ 最初の中身）
    pub fn revision(&self, name: &str) -> i64 {
        if self.is_shared(name) {
            self.refresh(name); // 読みは届かなくても写しで続ける
            let m = self.mirror(name);
            if m.exists() {
                return Doc::read(&m).map(|d| d.revision).unwrap_or(0);
            }
        }
        let p = self.initial(name);
        if p.exists() {
            Doc::read(&p).map(|d| d.revision).unwrap_or(0)
        } else {
            0
        }
    }

    pub fn who(&self) -> Value {
        json!({"pc": self.cfg.pc, "login": self.cfg.login})
    }

    // ---------------------------------------------------------- 置き場の状態（版 3.101.0。src/master_place.rs）

    /// 共有から取り直す（読む道の _maybe_refresh と同じ: 失敗は投げずに覚える）
    pub fn refresh(&self, name: &str) {
        if let Err(e) = self.pull(name, false, false) {
            *self.last_error.lock().unwrap_or_else(|e| e.into_inner()) =
                format!("共有マスタを取り込めませんでした（写しで続けます）: {}", e.message());
        }
    }

    /// (最後に取り直した時刻, 最後の失敗の理由)
    pub fn sync_state(&self) -> (String, String) {
        (
            self.last_sync.lock().unwrap_or_else(|e| e.into_inner()).clone(),
            self.last_error.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        )
    }

    pub fn share_dir(&self) -> Option<&Path> {
        self.cfg.share_dir.as_deref()
    }

    pub fn lock_ttl(&self) -> f64 {
        self.cfg.lock_ttl
    }

    pub fn data_dir(&self) -> &Path {
        &self.cfg.data
    }

    /// 共有するマスタの名前（名前の順）
    pub fn shared_names(&self) -> Vec<String> {
        let mut v: Vec<String> = self.shared.iter().cloned().collect();
        v.sort();
        v
    }

    /// 同梱の data/ のファイル
    pub fn bundled_file(&self, name: &str) -> PathBuf {
        self.bundled(name)
    }

    /// 共有・写しが無いときに読むファイル（同梱の data/ → 最初の中身）
    pub fn initial_file(&self, name: &str) -> PathBuf {
        self.initial(name)
    }

    /// この PC の作業場所（master_share.json・want.json・instance_id の置き場）
    pub fn local_root(&self) -> &Path {
        &self.cfg.local_root
    }

    /// 共有に届くのに、まだ無いマスタがあるか（取り直すと最初の版を置く＝種まき。窓は Python に任せる。版 3.101.0 の主のセッションの決め）
    pub fn needs_seed(&self, names: &[&str]) -> bool {
        self.share_reachable() && names.iter().any(|n| self.is_shared(n) && self.share_file(n).is_some_and(|p| stat_sig(&p).is_none()))
    }

    /// いま読むマスタ（Python の _read_doc。peek は共有を見ない _peek_doc）→ (中身, 読んだ元〈shared・bundled-fallback・local〉)。
    /// 読めない中身（壊れた JSON・版が数でない）は Err（Python は 500）
    pub fn read_doc(&self, name: &str, peek: bool) -> R<(Doc, &'static str)> {
        if self.is_shared(name) && !peek {
            self.refresh(name);
        }
        let mirror = self.mirror(name);
        let path = if self.is_shared(name) && mirror.exists() { mirror.clone() } else { self.initial(name) };
        let doc = if path.exists() { Doc::read(&path)? } else { Doc::empty() };
        let src = if self.is_shared(name) && mirror.exists() {
            "shared"
        } else if self.is_shared(name) {
            "bundled-fallback"
        } else {
            "local"
        };
        Ok((doc, src))
    }

    /// 錠の様子（Python の lock_status。共有でなければ None）
    pub fn lock_status(&self) -> Option<Value> {
        self.cfg.share_dir.as_ref()?;
        let cur = self.read_lock();
        let Some(cur) = cur.filter(|c| !c.is_empty() && self.remaining(c) > 0.0) else { return Some(json!({"locked": false})) };
        let g = |k: &str| cur.get(k).cloned().unwrap_or(json!(""));
        Some(json!({"locked": true, "holder_pc": g("holder_pc"), "holder_login": g("holder_login"), "remaining": self.wait(&cur),
                    "mine": self.is_mine(&cur)}))
    }

    // ---------------------------------------------------------- 書く

    /// `mutate(rows, stamp)` が行の配列を直し、画面へ返す値を返す。競合は MasterError で返る（Python の MasterStore.write）
    pub fn write<T>(&self, name: &str, mutate: impl FnOnce(&mut Vec<Value>, &Value) -> R<T>) -> R<T> {
        self.serialized(|| {
            let stamp = json!({"updated_at": iso(now_local()), "updated_by": self.who()});
            if !self.is_shared(name) {
                return self.write_local(name, mutate, &stamp);
            }
            let share = self.share_file(name).unwrap_or_default();
            self.with_lock(|token| {
                self.pull(name, true, true)?; // 当てる前に共有から取り直す
                let pulled = stat_sig(&share);
                let mut doc = Doc::read(&self.mirror(name))?;
                let result = mutate(&mut doc.rows, &stamp)?;
                // 版が端（i64 の最大）なら足せない。Python は大きな整数で続けるが、窓は書かずに断る（黙って負へ回さない）
                doc.revision = doc.revision.checked_add(1).ok_or_else(|| io_err("マスタの版の番号が大きすぎて、窓では保存できません"))?;
                doc.updated_at = stamp["updated_at"].clone();
                doc.updated_by = stamp["updated_by"].clone();
                self.still_mine(token, &share, pulled)?; // 置き換える直前に、錠も共有もそのままかを確かめる
                write_json_atomic(&share, &doc.to_value()).map_err(io_err)?;
                write_json_atomic(&self.mirror(name), &doc.to_value()).map_err(io_err)?;
                if let Some(s) = stat_sig(&share) {
                    self.share_sig.lock().unwrap_or_else(|e| e.into_inner()).insert(name.to_string(), s);
                }
                Ok(result)
            })
        })
    }

    /// 手元だけのマスタ（data/）を書く。錠も data/ に取り、行の配列（昔の形）のまま書く
    fn write_local<T>(&self, name: &str, mutate: impl FnOnce(&mut Vec<Value>, &Value) -> R<T>, stamp: &Value) -> R<T> {
        let path = self.bundled(name);
        let _s = self.scoped(|w| w.local = true);
        self.with_lock(|token| {
            let first = self.initial(name); // 錠を取ってから決めて読む
            let pulled = stat_sig(&path);
            let mut doc = if first.exists() { Doc::read(&first)? } else { Doc::empty() };
            let result = mutate(&mut doc.rows, stamp)?;
            let cur = self.read_lock();
            if cur.as_ref().and_then(|c| c.get("token")) != Some(&json!(token)) || stat_sig(&path) != pulled {
                return Err(self.locked(cur.as_ref(), 2));
            }
            write_json_atomic(&path, &Value::Array(doc.rows)).map_err(io_err)?;
            Ok(result)
        })
    }

    /// 置き換える直前の確かめ（錠が自分の物でない・共有が取り直した時から変わったなら、書かずに断る）
    fn still_mine(&self, token: &str, share: &Path, pulled: Option<(u128, u64)>) -> R<()> {
        let cur = self.read_lock();
        if cur.as_ref().and_then(|c| c.get("token")) != Some(&json!(token)) || stat_sig(share) != pulled {
            return Err(self.locked(cur.as_ref(), 2));
        }
        Ok(())
    }

    /// マスタを丸ごと扱う間（置き場の引っ越しなど）、この PC の書き込みを止め、いまの置き場の錠を持つ（共有に届けば共有、無ければ data/）
    pub fn exclusive<T>(&self, f: impl FnOnce() -> R<T>) -> R<T> {
        self.serialized(|| {
            let place = if self.share_reachable() { self.cfg.share_dir.clone().unwrap_or_default() } else { self.cfg.data.clone() };
            let _s = self.scoped(|w| w.dir = Some(place));
            self.with_lock(|_| {
                let _h = self.scoped(|w| w.held = true);
                f()
            })
        })
    }
}

/// 新しい行の id（いまの最大 + 1。Python の next_id）
pub fn next_id(rows: &[Value]) -> i64 {
    rows.iter()
        .map(|r| {
            let v = &r["id"];
            // Python の int(r.get("id") or 0): 真偽は 1・0（版 3.77.0。前は真偽を 0 と読み、Python と違う id を付けた）
            v.as_bool()
                .map(i64::from)
                .or_else(|| v.as_i64())
                .or_else(|| v.as_f64().map(|f| f as i64))
                .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
                .unwrap_or(0)
        })
        .max()
        .unwrap_or(0)
        + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 一時の置き場（共有・写し・作業場所）。同じ作業場所の係 role の書く係を作る
    struct Env {
        root: PathBuf,
    }

    impl Env {
        fn new(tag: &str) -> Env {
            let root = std::env::temp_dir().join(format!("da-mstore-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            for d in ["data", "defaults", "share", "local/master_cache"] {
                std::fs::create_dir_all(root.join(d)).unwrap();
            }
            std::fs::write(root.join("local").join(INSTANCE_FILENAME), "inst1").unwrap();
            Env { root }
        }

        fn store(&self, role: &str) -> Store {
            Store::new(Config {
                data: self.root.join("data"),
                defaults: self.root.join("defaults"),
                share_dir: Some(self.root.join("share")),
                shared: SHARED_ALWAYS.iter().map(|s| s.to_string()).collect(),
                cache: self.root.join("local").join("master_cache"),
                local_root: self.root.join("local"),
                pc: "PC-A".into(),
                login: "me".into(),
                role: role.into(),
                lock_ttl: LOCK_TTL_DEFAULT,
            })
        }

        fn lock(&self) -> PathBuf {
            self.root.join("share").join(LOCK_FILENAME)
        }

        fn shared(&self, name: &str) -> bool {
            self.root.join("share").join(format!("{name}.json")).exists()
        }
    }

    impl Drop for Env {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn a_live_lock_of_the_same_role_in_this_process_is_not_taken_over() {
        // 版 3.94.0 の CI: 起動の直後に画面が並べて問い合わせる道（変換表・設備グループ…）が、それぞれ共有にまだ無いマスタの最初の版を置く。
        // 同じ係（窓）のほかの糸・ほかの書く係が持つ生きた錠を「自分が残した錠」と見てどけると、持っていた方の保存は途中で断られる
        // （Python の MASTER_WRITE_ABORT と同じ形）。生きている錠は待つ（断る）。自分が落ちて残した錠（持ち主がもう居ない）だけを引き継ぐ
        let env = Env::new("steal");
        let (a, b) = (env.store("rs"), env.store("rs"));
        assert_eq!(a.holder, b.holder, "同じ作業場所の同じ係");
        let mut seeded = None;
        let out = a.write("equipment_groups", |rows, _| {
            seeded = Some(std::thread::scope(|s| s.spawn(|| b.pull("conversions", false, false)).join().unwrap()));
            rows.push(json!({"id": 1}));
            Ok(())
        });
        assert!(out.is_ok(), "持っている方の保存は通る: {out:?}");
        assert!(matches!(seeded, Some(Err(MasterError::Locked { .. }))), "生きた錠はどけない: {seeded:?}");
        assert!(!env.lock().exists(), "錠は残らない");
        assert!(b.pull("conversions", false, false).unwrap(), "錠が外れたら最初の版を置ける");
        assert!(env.shared("conversions"));
        // 自分が落ちて残した錠（この糸たちのどれも持っていない）は、今までどおり引き継ぐ
        std::fs::write(
            env.lock(),
            json!({"token": "left", "holder_pc": "PC-A", "holder_login": "me", "holder_instance": a.holder, "expires_at": ""}).to_string(),
        )
        .unwrap();
        a.write("equipment_groups", |rows, _| {
            rows.push(json!({"id": 2}));
            Ok(())
        })
        .unwrap();
        assert!(!env.lock().exists());
    }

    #[test]
    fn threads_of_one_store_wait_for_each_other_to_seed() {
        // 同じ書く係のほかの糸が保存している間に最初の版を置く道は、保存が終わるのを待ってから置く（断って Python に任せない）
        let env = Env::new("wait");
        let a = env.store("rs");
        let (out, seeded) = std::thread::scope(|s| {
            let mut seeder = None;
            let out = a.write("equipment_groups", |rows, _| {
                seeder = Some(s.spawn(|| a.pull("conversions", false, false)));
                std::thread::sleep(Duration::from_millis(200));
                rows.push(json!({"id": 1}));
                Ok(())
            });
            (out, seeder.unwrap().join().unwrap())
        });
        assert!(out.is_ok(), "{out:?}");
        assert_eq!(seeded, Ok(true), "保存の後に最初の版を置く");
        assert!(env.shared("conversions") && !env.lock().exists());
    }

    #[test]
    fn releasing_does_not_leave_an_empty_lock_behind() {
        // 錠を外すとき、どけた錠が自分の物でなく、しかも中身がまだ無い（ほかの糸・ほかの PC が「無ければ作る」で作り、書く前）なら、
        // 元へ戻さない。戻した空の錠はだれの物でもなく（作った方はどけられた方へ書き、確かめで断る）、名乗りの無い「ほかの PC が
        // 保存中（あと約20秒）」として錠の長さのあいだ残り、Python の最初の版を置くのが止まった（版 3.94.0 の CI の 16 秒）
        let env = Env::new("empty");
        let a = env.store("rs");
        a.with_lock(|_| {
            std::fs::remove_file(env.lock()).unwrap(); // 自分の錠がどけられ、
            std::fs::write(env.lock(), b"").unwrap(); // ほかが作った直後（まだ書いていない）
            Ok(())
        })
        .unwrap();
        assert!(!env.lock().exists(), "空の錠を戻して残さない");
        let py = env.store("py");
        assert_eq!(py.pull("ui_defaults", false, false), Ok(true), "もう 1 つの係はすぐに最初の版を置ける");
        assert!(env.shared("ui_defaults"));
        // 中身のある錠（作った方が書き終えた）は元へ戻す（持ち主の確かめが通る）
        let live = json!({"token": "other", "holder_pc": "PC-B", "holder_login": "x", "holder_instance": "y:py"}).to_string();
        a.with_lock(|_| {
            std::fs::remove_file(env.lock()).unwrap();
            std::fs::write(env.lock(), &live).unwrap();
            Ok(())
        })
        .unwrap();
        assert_eq!(std::fs::read_to_string(env.lock()).unwrap(), live, "ほかの生きた錠は戻す");
    }

    #[test]
    fn a_lock_that_could_not_be_written_is_not_left() {
        // 版 3.99.0: 錠を「無ければ作る」で作れても、中身を書けない（共有の空きが尽きた ENOSPC など）ときは、作った空・書きかけの錠を残さない。
        // 前は 0 バイトの錠が残り、もう 1 つの係・次に開いた窓が、見てから錠の長さ（20 秒）のあいだ「ほかの PC が保存中」で断られた
        let env = Env::new("unwritten");
        let full = || std::io::Error::new(std::io::ErrorKind::StorageFull, "No space left on device");
        let got = create_exclusive_with(&env.lock(), b"{\"token\": \"mine\"}", |_, _| Err(full()));
        assert!(got.is_err());
        assert!(!env.lock().exists(), "書けなかった空の錠を残さない");
        let got = create_exclusive_with(&env.lock(), b"{\"token\": \"mine\"}", |f, b| {
            f.write_all(&b[..7])?;
            Err(full())
        });
        assert!(got.is_err());
        assert!(!env.lock().exists(), "書きかけの錠を残さない");
        assert_eq!(env.store("py").pull("ui_defaults", false, false), Ok(true), "空きが戻ればもう 1 つの係はすぐに最初の版を置ける");
        // その間にほかが置いた錠（自分の書きかけでない中身）は消さずに戻す
        let other = json!({"token": "other", "holder_pc": "PC-B"}).to_string();
        let got = create_exclusive_with(&env.lock(), b"{\"token\": \"mine\"}", |_, _| {
            std::fs::remove_file(env.lock()).unwrap();
            std::fs::write(env.lock(), &other).unwrap();
            Err(full())
        });
        assert!(got.is_err());
        assert_eq!(std::fs::read_to_string(env.lock()).unwrap(), other, "ほかの錠は戻す");
    }
}
