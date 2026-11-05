//! 利用状況（だれが・どの PC で・どの版を使っているか）と画面の設定の控え（版 3.71.0。順 5 の 3 段目。program/app/services/presence.py・
//! ui_state.py を写した物）。窓（デスクトップ版）が受け持つときは、心拍・利用状況の道・使用の履歴・画面の控えの書き手は窓の 1 つだけ
//! （sidecar::SERVES の presence・ui_state。Python は心拍で書かない）。置き場とファイルの形は Python と同じ:
//!     <key>.json          … いま使っている（心拍で at を更新。TTL を過ぎたら使っていない）
//!     <key>.revoke.json   … 管理する人が書いた切断の指示（REVOKE_COOLDOWN のあいだ効く。読むのは access::revocation）
//!     history/<key>.json  … 使った記録の要約（初めて・最後・回数・使った時間・版の移り変わり）
//!     sessions/<key>/<年-月>.json … 使用の履歴（起動ごとに 始め・終わり・使った時間・版・権限区分）
//!     settings.json       … 履歴を残す日数（管理する人が書く）
//! 1 つのファイルを書くのはその PC だけ。読めないファイルは「無い」ではなく「読めない」（消さない）。
//! 時刻はどれも `Clock` から取る（試験 tests/presence_parity.rs が Python と同じ時計を当てる）。
//! Python との違い（害の無い物）: 閉じたときに使い終わりを書く（Python は呼んでいなかった）・利用状況の画面の readable はいつも true
//! （Python は値の型が混ざった記録で例外になると false）・鍵は字だけで確かめる（区切りと「..」は断るので置き場の外へは出ない。Python は
//! resolve も見る）・書いたファイルの鍵の並びは字の順（Python は足した順。読む側は並びを問わない）。

use crate::access::{self, key_ok, revocation, Place};
use crate::pyfmt;
use crate::worksum::{py_int_of, py_str, truthy};
use chrono::{Duration as Days, NaiveDate, NaiveDateTime};
use serde_json::{json, Map, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub const TTL_SEC: f64 = 75.0;
const WRITE_INTERVAL_SEC: f64 = 20.0;
const HISTORY_WRITE_SEC: f64 = 60.0;
pub const REVOKE_COOLDOWN_SEC: f64 = 300.0;
const SWEEP_INTERVAL_SEC: f64 = 300.0;
const NEWEST_INTERVAL_SEC: f64 = 300.0;
const HISTORY_VERSIONS: usize = 10;
const REVOKE_SUFFIX: &str = ".revoke.json";
const LATEST_EXCLUDED_ROLE: &str = "開発者";
const SESSIONS_DIR: &str = "sessions";
const SETTINGS_FILE: &str = "settings.json";
const DEFAULT_HISTORY_DAYS: i64 = 365;
pub const HISTORY_DAYS_RANGE: (i64, i64) = (30, 3650);
/// 窓の update.rs が作業場所に覚える配る版（presence.WANT_FILE）
const WANT_FILE: &str = "want.json";
/// 置き換えを拒まれた（Windows で読み手が開いている）ときに待つ長さ（presence._write_json の retry_budget）
const RETRY_BUDGET: f64 = 1.0;

/// いまの時刻: (この PC の時刻〈記録に書く〉, 1970 年からの秒〈UTC。間隔を測る。Python の time.time()〉)。
/// 間隔をこの PC の時刻で測ると、時計が戻った（夏時間の終わり）ときに書かない間ができる（作った後の採点）。試験は差し替える
pub type Clock = Arc<dyn Fn() -> (NaiveDateTime, f64) + Send + Sync>;

pub fn system_clock() -> Clock {
    Arc::new(|| {
        let t = chrono::Local::now();
        (t.naive_local(), t.timestamp_micros() as f64 / 1e6)
    })
}

/// 試験の時計（決めた時刻から、間隔を測る秒も作る）
pub fn clock_from(f: impl Fn() -> NaiveDateTime + Send + Sync + 'static) -> Clock {
    Arc::new(move || {
        let t = f();
        (t, ts(t))
    })
}

fn epoch() -> NaiveDateTime {
    NaiveDate::from_ymd_opt(1970, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap()
}

/// time.time() の代わり（間隔だけを見るので、時差は問わない）
fn ts(t: NaiveDateTime) -> f64 {
    (t - epoch()).num_microseconds().unwrap_or(0) as f64 / 1e6
}

/// fsio.now_iso（秒まで）
fn iso(t: NaiveDateTime) -> String {
    t.format("%Y-%m-%dT%H:%M:%S").to_string()
}

fn secs(a: NaiveDateTime, b: NaiveDateTime) -> f64 {
    (a - b).num_microseconds().unwrap_or(i64::MAX) as f64 / 1e6
}

// ---------------------------------------------------------------- ファイル

/// presence._read_json: 無い・読めない（{"_unreadable": True}）・読めた
enum Doc {
    Missing,
    Bad,
    Ok(Value),
}

fn read(path: &Path) -> Doc {
    match std::fs::read(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Doc::Missing,
        Err(_) => Doc::Bad,
        Ok(b) => match std::str::from_utf8(&b).ok().and_then(access::py_json) {
            Some(v) => Doc::Ok(v),
            None => Doc::Bad,
        },
    }
}

/// `data and not data.get("_unreadable")` を満たす表（表でない物は読めない物として扱う）
fn live(d: Doc) -> Option<Map<String, Value>> {
    match d {
        Doc::Ok(Value::Object(m)) if !m.is_empty() && !m.get("_unreadable").is_some_and(truthy) => Some(m),
        _ => None,
    }
}

/// Python の str(v or "")
fn text(v: Option<&Value>) -> String {
    match v {
        Some(x) if truthy(x) => py_str(x),
        _ => String::new(),
    }
}

/// presence.safe_key（区切り・「..」・空・長すぎるのは不可）
pub fn safe_key(v: Option<&Value>) -> bool {
    key_ok(&text(v))
}

/// base の直下の「鍵＋suffix」（鍵が正しいときだけ。presence._under）
fn under(base: &Path, key: &str, suffix: &str) -> Option<PathBuf> {
    key_ok(key).then(|| base.join(format!("{key}{suffix}")))
}

fn tmp_name(path: &Path) -> PathBuf {
    use std::sync::atomic::AtomicU64;
    static N: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let id = format!("{:x}{:x}{:x}", std::process::id(), nanos, N.fetch_add(1, Ordering::Relaxed));
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!(".{name}.{id}.tmp"))
}

/// Python の json.dump(data, ensure_ascii=False, indent=indent) と改行 1 つ（字下げは presence 1・ui_state 0）
pub fn dumps_indent(data: &Value, indent: &[u8]) -> Vec<u8> {
    use serde::Serialize;
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, serde_json::ser::PrettyFormatter::with_indent(indent));
    data.serialize(&mut ser).expect("JSON の値は書ける");
    buf.push(b'\n');
    buf
}

/// fsio.write_json_atomic: 親のフォルダを作り、一時ファイル → 置き換え（拒まれたら budget 秒まで間を広げてやり直す）
pub fn write_json_atomic(path: &Path, data: &Value, indent: &[u8], budget: f64) -> std::io::Result<()> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = tmp_name(path);
    let res = (|| {
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        f.write_all(&dumps_indent(data, indent))?;
        drop(f);
        let (mut delay, mut waited) = (0.05_f64, 0.0_f64);
        loop {
            match std::fs::rename(&tmp, path) {
                Ok(()) => return Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound || waited >= budget => return Err(e),
                Err(_) => {
                    std::thread::sleep(std::time::Duration::from_secs_f64(delay));
                    waited += delay;
                    delay = (delay * 2.0).min(0.5);
                }
            }
        }
    })();
    let _ = std::fs::remove_file(&tmp);
    res
}

fn json_files(d: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(d) else { return vec![] };
    rd.flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.file_name().is_some_and(|n| n.to_string_lossy().ends_with(".json")))
        .collect()
}

fn stem(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn age_sec(m: &Map<String, Value>, now: NaiveDateTime) -> Option<f64> {
    let at = m.get("at").map(py_str).unwrap_or_else(|| "None".into());
    access::parse_at(&at).map(|t| secs(now, t))
}

/// "2026-09" → その次の月の初め（読めなければ None。presence._month_after）
fn month_after(month: &str) -> Option<NaiveDateTime> {
    let parts: Vec<&str> = month.split('-').collect();
    if parts.len() != 2 {
        return None;
    }
    let (y, m) = (pyfmt::py_int(parts[0]).ok()?, pyfmt::py_int(parts[1]).ok()?);
    let (y, m) = (y + (m == 12) as i64, m.rem_euclid(12) + 1);
    NaiveDate::from_ymd_opt(i32::try_from(y).ok().filter(|y| (1..=9999).contains(y))?, m as u32, 1)?.and_hms_opt(0, 0, 0)
}

/// version.version_key（'1.10.0' > '1.9.3'。読めない部分は 0）
pub fn version_key(v: &str) -> Vec<i64> {
    let mut out: Vec<i64> = v.split('.').map(|p| pyfmt::py_int(p).unwrap_or(0)).collect();
    while out.len() < 3 {
        out.push(0);
    }
    out
}

/// その版は「要更新」か（presence.behind）
pub fn behind(latest: Option<&str>, ver: &str, distributed: bool) -> bool {
    match latest {
        Some(l) if !l.is_empty() && !ver.is_empty() => {
            if distributed {
                ver != l
            } else {
                version_key(l) > version_key(ver)
            }
        }
        _ => false,
    }
}

/// (ログインID, PC名) の登録上の区分（access.registered_roles）
fn role_of(rows: &[Map<String, Value>], login: &str, pc: &str) -> String {
    access::flags(rows, login, pc)["role"].as_str().unwrap_or("").to_string()
}

fn perm_rows(me: &Value) -> Vec<Map<String, Value>> {
    me["rows"].as_array().map(|a| a.iter().filter_map(|r| r.as_object().cloned()).collect()).unwrap_or_default()
}

// ---------------------------------------------------------------- 係

#[derive(Default)]
struct State {
    last_history: f64,
    last_sweep: f64,
    since: Option<String>,
    session_key: Option<String>,
    left: bool,
    session_start: Option<String>,
    session_sec: i64,
    role: String,
}

/// 使い終わり（leave）に要る名乗り（最後の心拍の物）
#[derive(Clone, Default)]
struct Who {
    login: String,
    pc: String,
    key: String,
}

pub struct Presence {
    clock: Clock,
    local_root: PathBuf,
    dir: Mutex<Option<PathBuf>>,
    st: Mutex<State>,
    last_write: Mutex<f64>,
    newest: Mutex<(Option<String>, f64)>,
    busy: AtomicBool,
    version: Mutex<String>,
    /// 中身（program）の置き場。書く版は書くたびにここから読む（更新で入れ替わる。update::program_version）
    program: Mutex<Option<PathBuf>>,
    who: Mutex<Who>,
}

impl Presence {
    pub fn new(local_root: PathBuf, clock: Clock) -> Presence {
        Presence {
            clock,
            local_root,
            dir: Mutex::default(),
            st: Mutex::default(),
            last_write: Mutex::new(0.0),
            newest: Mutex::new((None, 0.0)),
            busy: AtomicBool::new(false),
            version: Mutex::new(String::new()),
            program: Mutex::default(),
            who: Mutex::default(),
        }
    }

    /// 書く版（試験は決めた版。窓は set_program）
    pub fn set_version(&self, v: &str) {
        *self.version.lock().unwrap() = v.to_string();
    }

    pub fn set_program(&self, program: PathBuf) {
        *self.program.lock().unwrap() = Some(program);
    }

    fn app_version(&self) -> String {
        let prog = self.program.lock().unwrap().clone();
        if let Some(v) = prog.and_then(|p| crate::update::program_version(&p)) {
            *self.version.lock().unwrap() = v;
        }
        self.version.lock().unwrap().clone()
    }

    /// 置き場（一覧の設定の access.place.presence。マスタの置き場が移れば付いてくる）
    pub fn configure(&self, dir: Option<PathBuf>) {
        *self.dir.lock().unwrap() = dir;
    }

    pub fn dir(&self) -> Option<PathBuf> {
        self.dir.lock().unwrap().clone()
    }

    fn now(&self) -> NaiveDateTime {
        (self.clock)().0
    }

    /// 間隔を測る秒（time.time()）
    fn secs_now(&self) -> f64 {
        (self.clock)().1
    }

    /// presence._write_json: 置き場の親（共有フォルダ・この PC の作業フォルダ）が無ければ書かない
    fn write(&self, path: &Path, data: &Value) -> bool {
        let Some(root) = self.dir() else { return false };
        if !root.parent().is_some_and(Path::exists) {
            return false;
        }
        write_json_atomic(path, data, b" ", RETRY_BUDGET).is_ok()
    }

    // ---------------------------------------------------------------- 書く（この PC の分だけ）

    /// 使った記録を足す（要約と使用の履歴。presence._record）。値の形が違うときは Python の例外と同じく途中でやめる
    #[allow(clippy::too_many_arguments)]
    fn record(&self, st: &mut State, key: &str, login: &str, pc: &str, now: NaiveDateTime, fin: bool, role: Option<&str>) -> Option<()> {
        if let Some(r) = role {
            st.role = r.to_string();
        }
        let dir = self.dir()?;
        let path = under(&dir.join("history"), key, ".json")?;
        let now_s = iso(now);
        let version = self.app_version();
        let mut h = live(read(&path)).unwrap_or_else(|| {
            let mut m = Map::new();
            for (k, v) in [
                ("key", json!(key)),
                ("login", json!(login)),
                ("pc", json!(pc)),
                ("firstAt", json!(now_s)),
                ("sessions", json!(0)),
                ("totalSec", json!(0)),
                ("versions", json!({})),
            ] {
                m.insert(k.into(), v);
            }
            m
        });
        let gap = match h.get("lastAt") {
            Some(last) if truthy(last) => last.as_str().and_then(access::parse_at).map(|l| secs(now, l)),
            _ => None,
        };
        let new_session = st.session_key.as_deref() != Some(key) || gap.is_none_or(|g| g > TTL_SEC);
        let int_of = |v: Option<&Value>| match v {
            Some(x) if truthy(x) => py_int_of(x),
            _ => Some(0),
        };
        if new_session {
            let n = int_of(h.get("sessions"))?;
            h.insert("sessions".into(), json!(n + 1));
            h.insert("sessionAt".into(), json!(now_s));
            st.session_key = Some(key.to_string());
        } else if let Some(g) = gap.filter(|g| *g != 0.0) {
            let n = int_of(h.get("totalSec"))?;
            h.insert("totalSec".into(), json!(n + g.min(TTL_SEC).trunc() as i64));
        }
        h.insert("login".into(), json!(login));
        h.insert("pc".into(), json!(pc));
        h.insert("lastAt".into(), json!(now_s));
        h.insert("version".into(), json!(version));
        let mut vers: Vec<(String, String)> = match h.get("versions") {
            Some(Value::Object(o)) => o.iter().map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect::<Option<_>>()?,
            Some(x) if truthy(x) => return None,
            _ => vec![],
        };
        vers.retain(|(k, _)| *k != version);
        vers.push((version.clone(), now_s.clone()));
        vers.sort_by(|a, b| a.1.cmp(&b.1));
        let cut = vers.len().saturating_sub(HISTORY_VERSIONS);
        h.insert("versions".into(), Value::Object(vers.split_off(cut).into_iter().map(|(k, v)| (k, json!(v))).collect()));
        let t = self.secs_now();
        let write = fin || new_session || t - st.last_history >= HISTORY_WRITE_SEC;
        self.log_session(st, key, login, pc, now, new_session, gap, write, &version);
        if write {
            self.write(&path, &Value::Object(h));
            st.last_history = t;
        }
        Some(())
    }

    /// いまの使い始めの行を足す・伸ばす（presence._log_session）
    #[allow(clippy::too_many_arguments)]
    fn log_session(
        &self,
        st: &mut State,
        key: &str,
        login: &str,
        pc: &str,
        now: NaiveDateTime,
        new: bool,
        gap: Option<f64>,
        write: bool,
        version: &str,
    ) {
        let now_s = iso(now);
        if new || st.session_start.as_deref().is_none_or(str::is_empty) {
            st.session_start = Some(now_s.clone());
            st.session_sec = 0;
        } else if let Some(g) = gap.filter(|g| *g != 0.0) {
            st.session_sec += g.min(TTL_SEC).trunc() as i64;
        }
        if !write {
            return;
        }
        let Some(dir) = self.dir() else { return };
        let start = st.session_start.clone().unwrap_or_default();
        let month: String = start.chars().take(7).collect();
        let path = dir.join(SESSIONS_DIR).join(key).join(format!("{month}.json"));
        let mut doc = live(read(&path)).unwrap_or_else(|| {
            let mut m = Map::new();
            m.insert("key".into(), json!(key));
            m.insert("login".into(), json!(login));
            m.insert("pc".into(), json!(pc));
            m.insert("sessions".into(), json!([]));
            m
        });
        let rows = doc.entry("sessions").or_insert_with(|| json!([]));
        let Some(rows) = rows.as_array_mut() else { return };
        let at = match rows.iter().rposition(|r| r.get("start") == Some(&json!(start))) {
            Some(i) => i,
            None => {
                rows.push(json!({"start": start}));
                rows.len() - 1
            }
        };
        let Some(row) = rows[at].as_object_mut() else { return };
        let role = if st.role.is_empty() { row.get("role").cloned().unwrap_or(json!("")) } else { json!(st.role) };
        row.insert("end".into(), json!(now_s));
        row.insert("sec".into(), json!(st.session_sec));
        row.insert("version".into(), json!(version));
        row.insert("role".into(), role);
        doc.insert("login".into(), json!(login));
        doc.insert("pc".into(), json!(pc));
        self.write(&path, &Value::Object(doc));
        if new {
            self.prune_own(key, now);
        }
    }

    fn cutoff(&self, now: NaiveDateTime) -> NaiveDateTime {
        now - Days::days(self.history_days())
    }

    /// この PC の履歴のうち、残す日数より古いものを消す（presence._prune_own）
    fn prune_own(&self, key: &str, now: NaiveDateTime) {
        let Some(dir) = self.dir() else { return };
        let cutoff = self.cutoff(access::parse_at(&iso(now)).unwrap_or(now));
        let (cut_month, cut_iso) = (cutoff.format("%Y-%m").to_string(), iso(cutoff));
        for p in json_files(&dir.join(SESSIONS_DIR).join(key)) {
            let s = stem(&p);
            let Some(nxt) = month_after(&s) else { continue };
            if nxt <= cutoff {
                let _ = std::fs::remove_file(&p);
            } else if s == cut_month {
                let Some(mut doc) = live(read(&p)) else { continue };
                let rows = doc.get("sessions").and_then(Value::as_array).cloned().unwrap_or_default();
                let keep: Vec<Value> = rows
                    .iter()
                    .filter(|r| {
                        let v = r.get("end").filter(|v| truthy(v)).or_else(|| r.get("start").filter(|v| truthy(v)));
                        text(v) >= cut_iso
                    })
                    .cloned()
                    .collect();
                if keep.len() != rows.len() {
                    doc.insert("sessions".into(), Value::Array(keep));
                    self.write(&p, &Value::Object(doc));
                }
            }
        }
    }

    fn load_settings(&self) -> Map<String, Value> {
        self.dir().and_then(|d| live(read(&d.join(SETTINGS_FILE)))).unwrap_or_default()
    }

    pub fn history_days(&self) -> i64 {
        let (lo, hi) = HISTORY_DAYS_RANGE;
        let s = self.load_settings();
        match s.get("historyDays").filter(|v| truthy(v)) {
            None => DEFAULT_HISTORY_DAYS,
            Some(v) => py_int_of(v).map(|n| n.clamp(lo, hi)).unwrap_or(DEFAULT_HISTORY_DAYS),
        }
    }

    fn save_settings(&self, days: i64, by: &str, by_pc: &str) -> bool {
        let Some(dir) = self.dir() else { return false };
        let mut s = self.load_settings();
        s.insert("historyDays".into(), json!(days));
        s.insert("by".into(), json!(by));
        s.insert("byPc".into(), json!(by_pc));
        s.insert("at".into(), json!(iso(self.now())));
        self.write(&dir.join(SETTINGS_FILE), &Value::Object(s))
    }

    /// 管理する人の「古い記録を整理」（presence.prune_all）
    fn prune_all(&self) -> Value {
        let cutoff = self.cutoff(self.now());
        let (mut files, mut rows) = (0, 0);
        if let Some(root) = self.dir().map(|d| d.join(SESSIONS_DIR)) {
            for d in std::fs::read_dir(&root).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
                for p in json_files(&d) {
                    if month_after(&stem(&p)).is_some_and(|n| n <= cutoff) {
                        rows += match read(&p) {
                            Doc::Ok(v) => match v.get("sessions") {
                                Some(Value::Array(a)) => a.len(),
                                Some(Value::Object(o)) => o.len(),
                                Some(Value::String(s)) => s.chars().count(),
                                _ => 0,
                            },
                            _ => 0,
                        };
                        let _ = std::fs::remove_file(&p);
                        files += 1;
                    }
                }
                if std::fs::read_dir(&d).is_ok_and(|mut r| r.next().is_none()) {
                    let _ = std::fs::remove_dir(&d);
                }
            }
        }
        json!({"files": files, "sessions": rows, "cutoff": iso(cutoff)})
    }

    /// 使用の履歴（新しい順。presence.sessions）
    fn sessions(&self, key: Option<&str>, limit: usize) -> Value {
        let empty = json!({"items": [], "more": false});
        let Some(root) = self.dir().map(|d| d.join(SESSIONS_DIR)).filter(|r| r.exists()) else { return empty };
        if key.is_some_and(|k| !key_ok(k)) {
            return empty;
        }
        let dirs: Vec<PathBuf> = match key {
            Some(k) => vec![root.join(k)],
            None => std::fs::read_dir(&root).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect(),
        };
        let mut files: Vec<(String, PathBuf)> =
            dirs.iter().filter(|d| d.exists()).flat_map(|d| json_files(d)).map(|p| (stem(&p), p)).collect();
        files.sort_by(|a, b| b.0.cmp(&a.0));
        let mut rows: Vec<Map<String, Value>> = vec![];
        let mut month: Option<String> = None;
        for (m, p) in files {
            if month.as_ref().is_some_and(|x| !x.is_empty() && *x != m) && rows.len() > limit {
                break;
            }
            month = Some(m);
            let Some(doc) = live(read(&p)) else { continue };
            let parent = p.parent().and_then(Path::file_name).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let key = doc.get("key").filter(|v| truthy(v)).cloned().unwrap_or(json!(parent));
            for r in doc.get("sessions").and_then(Value::as_array).into_iter().flatten() {
                let Some(r) = r.as_object() else { continue };
                let mut row = r.clone();
                row.insert("key".into(), key.clone());
                row.insert("login".into(), doc.get("login").cloned().unwrap_or(json!("")));
                row.insert("pc".into(), doc.get("pc").cloned().unwrap_or(json!("")));
                rows.push(row);
            }
        }
        rows.sort_by_key(|r| text(r.get("start")));
        let kname = |r: &Map<String, Value>| py_str(&r["key"]);
        let mut prev: std::collections::HashMap<String, Value> = Default::default();
        for r in rows.iter_mut() {
            let k = kname(r);
            let ver = r.get("version").cloned().unwrap_or(Value::Null);
            if let Some(before) = prev.get(&k).filter(|b| truthy(b) && **b != ver) {
                r.insert("changedFrom".into(), before.clone());
            }
            prev.insert(k, ver);
        }
        let online: std::collections::HashSet<String> = self.online(None).iter().map(|o| py_str(&o["key"])).collect();
        let mut last: std::collections::HashMap<String, usize> = Default::default();
        for (i, r) in rows.iter().enumerate() {
            last.insert(kname(r), i);
        }
        for (k, i) in last {
            rows[i].insert("live".into(), json!(online.contains(&k)));
        }
        rows.reverse();
        let more = rows.len() > limit;
        rows.truncate(limit);
        json!({"items": rows, "more": more})
    }

    /// いま使っていることを書く（WRITE_INTERVAL ごと。記録・掃除もここで。presence.touch）。key は me の key（terminal_key）
    pub fn touch(&self, login: &str, pc: &str, role: &str, key: &str, force: bool) -> bool {
        self.touch_inner(login, pc, role, key, force).unwrap_or(false)
    }

    /// None は Python で例外になる形（記録の値の形が違う）: 掃除も最新版の数え直しもしない（touch_async の糸が例外で終わるのと同じ）
    fn touch_inner(&self, login: &str, pc: &str, role: &str, key: &str, force: bool) -> Option<bool> {
        let Some(dir) = self.dir() else { return Some(false) };
        let (now, t) = (self.clock)();
        if !force && t - *self.last_write.lock().unwrap() < WRITE_INTERVAL_SEC {
            return Some(false);
        }
        let now_s = iso(now);
        let mut st = self.st.lock().unwrap();
        if st.since.is_none() || st.session_key.as_deref() != Some(key) {
            st.since = Some(now_s.clone());
        }
        let doc = json!({"key": key, "login": login, "pc": pc, "role": role, "version": self.app_version(),
                         "since": st.since, "at": now_s});
        let ok = match under(&dir, key, ".json") {
            Some(p) => self.write(&p, &doc),
            None => false,
        };
        *self.last_write.lock().unwrap() = t;
        st.left = false;
        self.record(&mut st, key, login, pc, now, false, Some(role))?;
        if t - st.last_sweep >= SWEEP_INTERVAL_SEC {
            self.sweep(&dir, now);
            st.last_sweep = t;
        }
        Some(ok)
    }

    /// 心拍の書く所（presence.touch_async の糸の中身。試験はこれを直に呼ぶ）
    pub fn beat(&self, me: &Value) {
        let (login, pc, role, key) =
            (text(me.get("login")), text(me.get("pc")), me["flags"]["role"].as_str().unwrap_or("").to_string(), text(me.get("key")));
        *self.who.lock().unwrap() = Who { login: login.clone(), pc: pc.clone(), key: key.clone() };
        if self.touch_inner(&login, &pc, &role, &key, false).is_none() {
            return;
        }
        if self.secs_now() - self.newest.lock().unwrap().1 >= NEWEST_INTERVAL_SEC {
            self.refresh_newest(&perm_rows(me));
        }
    }

    /// 心拍から: 書くのは裏の 1 本の糸（共有が遅くても心拍を待たせない）。書いている最中の頼みは捨てる
    pub fn beat_async(self: &Arc<Self>, me: &Value) {
        if self.dir().is_none() || self.secs_now() - *self.last_write.lock().unwrap() < WRITE_INTERVAL_SEC {
            return;
        }
        if self.busy.swap(true, Ordering::AcqRel) {
            return;
        }
        let (me2, this) = (me.clone(), self.clone());
        let spawned = std::thread::Builder::new().name("presence".into()).spawn(move || {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| this.beat(&me2)));
            this.busy.store(false, Ordering::Release);
        });
        if spawned.is_err() {
            self.busy.store(false, Ordering::Release);
        }
    }

    /// 使い終わり（アプリの終了。presence.leave）: いまのファイルを消し、記録を最後まで書く
    pub fn leave(&self) {
        let w = self.who.lock().unwrap().clone();
        if w.key.is_empty() {
            return;
        }
        self.leave_as(&w.login, &w.pc, &w.key);
    }

    pub fn leave_as(&self, login: &str, pc: &str, key: &str) {
        let Some(dir) = self.dir() else { return };
        let mut st = self.st.lock().unwrap();
        if st.left {
            return;
        }
        let now = self.now();
        self.record(&mut st, key, login, pc, now, true, None);
        if let Some(p) = under(&dir, key, ".json") {
            let _ = std::fs::remove_file(p);
        }
        st.left = true;
    }

    fn pc_files(d: &Path) -> Vec<PathBuf> {
        json_files(d).into_iter().filter(|p| p.file_name().is_some_and(|n| n != SETTINGS_FILE)).collect()
    }

    /// 古い「いま使っている」（TTL の 4 倍）と切断の指示（冷却の 4 倍）を消す（presence._sweep）
    fn sweep(&self, d: &Path, now: NaiveDateTime) {
        for p in Self::pc_files(d) {
            let Some(data) = live(read(&p)) else { continue };
            let limit = if p.to_string_lossy().ends_with(REVOKE_SUFFIX) { REVOKE_COOLDOWN_SEC } else { TTL_SEC };
            if age_sec(&data, now).is_some_and(|a| a > limit * 4.0) {
                let _ = std::fs::remove_file(&p);
            }
        }
    }

    // ---------------------------------------------------------------- 読む

    fn online(&self, d: Option<&Path>) -> Vec<Map<String, Value>> {
        let own = self.dir();
        let Some(d) = d.or(own.as_deref()).filter(|d| d.exists()) else { return vec![] };
        let now = self.now();
        let mut out = vec![];
        for p in Self::pc_files(d) {
            if p.to_string_lossy().ends_with(REVOKE_SUFFIX) {
                continue;
            }
            let Some(mut data) = live(read(&p)) else { continue };
            if let Some(age) = age_sec(&data, now).filter(|a| *a <= TTL_SEC) {
                if safe_key(data.get("key")) {
                    data.insert("idleSec".into(), json!(age.trunc() as i64));
                    out.push(data);
                }
            }
        }
        out
    }

    fn history(&self) -> Vec<Map<String, Value>> {
        let Some(d) = self.dir().map(|d| d.join("history")).filter(|d| d.exists()) else { return vec![] };
        json_files(&d).iter().filter_map(|p| live(read(p))).filter(|h| safe_key(h.get("key"))).collect()
    }

    /// この PC が確かめた配る版（presence.distributed_version）
    fn distributed_version(&self) -> Option<String> {
        let v = match read(&self.local_root.join(WANT_FILE)) {
            Doc::Ok(Value::Object(m)) => text(m.get("version")),
            _ => String::new(),
        };
        let v = pyfmt::strip(&v).to_string();
        (!v.is_empty()).then_some(v)
    }

    /// 配る版。決まっていなければ、使っている人たち（開発者を除く）の版のうちいちばん新しいもの（presence.latest_version）
    fn latest_version(&self, rows: &[Map<String, Value>]) -> Option<String> {
        if let Some(v) = self.distributed_version() {
            return Some(v);
        }
        let mut recs: Vec<((String, String), Vec<String>)> = vec![];
        for r in self.history().into_iter().chain(self.online(None)) {
            let pair = (text(r.get("login")), text(r.get("pc")));
            let ver = text(r.get("version"));
            match recs.iter_mut().find(|(p, _)| *p == pair) {
                Some((_, vs)) => vs.push(ver),
                None => recs.push((pair, vec![ver])),
            }
        }
        let mut best: Option<String> = None;
        for ((login, pc), vs) in &recs {
            if role_of(rows, login, pc) == LATEST_EXCLUDED_ROLE {
                continue;
            }
            for v in vs.iter().filter(|v| !v.is_empty()) {
                if best.as_ref().is_none_or(|b| version_key(v) > version_key(b)) {
                    best = Some(v.clone());
                }
            }
        }
        best
    }

    fn refresh_newest(&self, rows: &[Map<String, Value>]) {
        if let Some(v) = self.latest_version(rows) {
            self.newest.lock().unwrap().0 = Some(v);
        }
        self.newest.lock().unwrap().1 = self.secs_now();
    }

    /// {latestVersion, myVersion, distributed, outdated}（まだ数えていなければ null。presence.version_notice）
    pub fn version_notice(&self, role: &str) -> Value {
        let Some(latest) = self.newest.lock().unwrap().0.clone() else { return Value::Null };
        let mine = self.app_version();
        let dist = self.distributed_version().as_deref() == Some(latest.as_str());
        json!({"latestVersion": latest, "myVersion": mine, "distributed": dist,
               "outdated": role != LATEST_EXCLUDED_ROLE && behind(Some(&latest), &mine, dist)})
    }

    /// 心拍の答え（routes/system._presence_beat）
    pub fn answer(&self, me: &Value) -> Value {
        json!({"version": self.version_notice(me["flags"]["role"].as_str().unwrap_or("")), "revoked": me["revoked"]})
    }

    /// 利用状況の画面の中身（presence.fleet）
    fn fleet(&self, rows: &[Map<String, Value>]) -> Value {
        let mut online: Vec<(String, Map<String, Value>)> = vec![];
        for r in self.online(None) {
            let k = py_str(&r["key"]);
            online.retain(|(x, _)| *x != k);
            online.push((k, r));
        }
        let mut hist: Vec<(String, Map<String, Value>)> = vec![];
        for h in self.history() {
            if let Some(k) = h.get("key").filter(|v| truthy(v)).map(py_str) {
                hist.retain(|(x, _)| *x != k);
                hist.push((k, h));
            }
        }
        let mut keys: Vec<String> = online.iter().map(|x| x.0.clone()).collect();
        keys.extend(hist.iter().map(|x| x.0.clone()).filter(|k| !online.iter().any(|o| o.0 == *k)));
        let latest = self.latest_version(rows);
        let dist = latest.is_some() && self.distributed_version() == latest;
        let now = self.now();
        let dir = self.dir();
        let get = |m: &Map<String, Value>, k: &str| m.get(k).cloned().unwrap_or(Value::Null);
        let mut items: Vec<Value> = vec![];
        for k in &keys {
            let o = online.iter().find(|x| x.0 == *k).map(|x| &x.1);
            let empty = Map::new();
            let h = hist.iter().find(|x| x.0 == *k).map(|x| &x.1).unwrap_or(&empty);
            let base = o.unwrap_or(h);
            let (login, pc) = (base.get("login").cloned().unwrap_or(json!("")), base.get("pc").cloned().unwrap_or(json!("")));
            let role = role_of(rows, &py_str(&login), &py_str(&pc));
            let ver = o.and_then(|o| o.get("version")).filter(|v| truthy(v)).or_else(|| h.get("version").filter(|v| truthy(v)));
            let ver = ver.cloned().unwrap_or(json!(""));
            let counted = role != LATEST_EXCLUDED_ROLE;
            let last_at = o.and_then(|o| o.get("at")).filter(|v| truthy(v)).cloned().unwrap_or_else(|| get(h, "lastAt"));
            items.push(json!({
                "key": k, "login": login, "pc": pc, "role": role, "version": ver,
                "online": o.is_some(), "idleSec": o.map(|o| get(o, "idleSec")).unwrap_or(Value::Null),
                "since": o.map(|o| get(o, "since")).unwrap_or(Value::Null),
                "firstAt": get(h, "firstAt"), "lastAt": last_at,
                "sessions": h.get("sessions").cloned().unwrap_or(json!(0)), "totalSec": h.get("totalSec").cloned().unwrap_or(json!(0)),
                "versions": h.get("versions").cloned().unwrap_or(json!({})), "counted": counted,
                "outdated": counted && behind(latest.as_deref(), &text(Some(&ver)), dist),
                "revoked": revocation(dir.as_deref(), k, now),
            }));
        }
        items.sort_by(|a, b| {
            let key = |x: &Value| {
                (!x["outdated"].as_bool().unwrap_or(false), !x["online"].as_bool().unwrap_or(false), py_str(&x["pc"]), py_str(&x["login"]))
            };
            key(a).cmp(&key(b))
        });
        let n_on = items.iter().filter(|x| x["online"] == true).count();
        let n_out = items.iter().filter(|x| x["outdated"] == true).count();
        json!({"items": items, "latest": latest, "distributed": dist, "online": n_on, "outdated": n_out, "total": keys.len()})
    }

    fn disconnect(&self, key: &str, by: &str, by_pc: &str, reason: &str) -> bool {
        let Some(p) = self.dir().and_then(|d| under(&d, key, REVOKE_SUFFIX)) else { return false };
        let reason: String = reason.chars().take(200).collect();
        self.write(&p, &json!({"key": key, "by": by, "byPc": by_pc, "reason": reason, "at": iso(self.now())}))
    }

    fn clear_revocation(&self, key: &str) -> bool {
        let Some(p) = self.dir().and_then(|d| under(&d, key, REVOKE_SUFFIX)) else { return false };
        match std::fs::remove_file(p) {
            Ok(()) => true,
            Err(e) => e.kind() == std::io::ErrorKind::NotFound,
        }
    }

    fn forget(&self, key: &str) -> bool {
        let Some(dir) = self.dir().filter(|_| key_ok(key)) else { return false };
        let gone = |p: PathBuf| match std::fs::remove_file(p) {
            Ok(()) => true,
            Err(e) => e.kind() == std::io::ErrorKind::NotFound,
        };
        if !gone(dir.join("history").join(format!("{key}.json"))) || !gone(dir.join(format!("{key}.json"))) {
            return false;
        }
        let _ = std::fs::remove_dir_all(dir.join(SESSIONS_DIR).join(key));
        self.clear_revocation(key);
        true
    }

    // ---------------------------------------------------------------- 道（routes/access.py の利用状況）

    /// 利用状況の 7 本を答える（心拍は Lot が答える）。me は窓が決めた me、shared はマスタの共有フォルダがあるか。
    /// 本文が表でない（Python では 500）・serde_json が読めない本文は None（Python に任せる。Python の道は残してある）
    pub fn handle(&self, me: &Value, shared: bool, method: &str, path: &str, query: &str, body: &[u8]) -> Option<(u16, Value)> {
        let role = me["flags"]["role"].as_str().unwrap_or("").to_string();
        let caps = me["caps"].clone();
        let deny = |what: String| Some((403, json!({"error": what, "kind": "forbidden"})));
        let body = || -> Option<Map<String, Value>> {
            if crate::access_write::needs_python(body) {
                return None;
            }
            match serde_json::from_slice::<Value>(body).ok().filter(truthy) {
                None => Some(Map::new()),
                Some(Value::Object(m)) => Some(m),
                Some(_) => None,
            }
        };
        let rows = perm_rows(me);
        let manager =
            |what: &str| (!access::role_can(&role, "presence:forget", "")).then(|| format!("この PC の権限区分（{role}）では{what}。"));
        match (method, path) {
            ("GET", "/api/presence") => {
                if caps["canViewPresence"] != true {
                    return deny(format!("この PC の権限区分（{role}）では利用状況を見られません。"));
                }
                Some((
                    200,
                    json!({
                        "fleet": self.fleet(&rows), "readable": true, "shared": shared,
                        "dir": self.dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
                        "me": me["key"], "can": caps, "ttlSec": TTL_SEC as i64, "cooldownSec": REVOKE_COOLDOWN_SEC as i64,
                        "revoked": me["revoked"], "roles": access::ROLES,
                    }),
                ))
            }
            ("POST", "/api/presence/disconnect" | "/api/presence/allow" | "/api/presence/forget") => {
                let b = body()?;
                let key = pyfmt::strip(&text(b.get("key"))).to_string();
                let fl = self.fleet(&rows);
                let Some(t) = fl["items"].as_array().and_then(|a| a.iter().rev().find(|x| x["key"] == json!(key))).cloned() else {
                    return Some((404, json!({"error": "その PC の記録がありません。", "kind": "not_found"})));
                };
                let t_role = t["role"].as_str().unwrap_or("");
                match path {
                    "/api/presence/disconnect" => {
                        if t["key"] == me["key"] {
                            return Some((400, json!({"error": "自分の PC は切断できません。", "kind": "invalid"})));
                        }
                        if !access::role_can(&role, "presence:disconnect", t_role) {
                            return deny(format!("この PC の権限区分（{role}）では{t_role}の PC を切断できません。"));
                        }
                        if t["online"] != true {
                            return Some((
                                409,
                                json!({"error": "その PC はいま使っていません（切断するものがありません）。", "kind": "conflict"}),
                            ));
                        }
                        let reason = text(b.get("reason"));
                        if !self.disconnect(&key, &text(me.get("login")), &text(me.get("pc")), &reason) {
                            return Some((
                                503,
                                json!({"error": "切断の指示を書けませんでした（共有フォルダを確かめてください）。", "kind": "unavailable"}),
                            ));
                        }
                    }
                    "/api/presence/allow" => {
                        if !access::role_can(&role, "presence:disconnect", t_role) {
                            return deny(format!("この PC の権限区分（{role}）では切断を解けません。"));
                        }
                        self.clear_revocation(&key);
                    }
                    _ => {
                        if !access::role_can(&role, "presence:forget", "") {
                            return deny(format!("この PC の権限区分（{role}）では記録を消せません。"));
                        }
                        if t["online"] == true {
                            return Some((
                                409,
                                json!({"error": "いま使っている PC の記録は消せません（使い終わってから消してください）。", "kind": "conflict"}),
                            ));
                        }
                        self.forget(&key);
                    }
                }
                Some((200, json!({"ok": true})))
            }
            ("GET", "/api/presence/sessions") => {
                if caps["canViewPresence"] != true {
                    return deny(format!("この PC の権限区分（{role}）では利用状況を見られません。"));
                }
                let q = crate::lotlist::parse_query(query);
                let arg = |k: &str| q.iter().find(|(x, _)| x == k).map(|(_, v)| v.clone()).unwrap_or_default();
                let limit = match arg("limit") {
                    s if s.is_empty() => 300,
                    s => pyfmt::py_int(&s).unwrap_or(300),
                }
                .clamp(1, 2000) as usize;
                let key = pyfmt::strip(&arg("key")).to_string();
                let mut d = self.sessions((!key.is_empty()).then_some(key.as_str()), limit);
                d["historyDays"] = json!(self.history_days());
                d["range"] = json!([HISTORY_DAYS_RANGE.0, HISTORY_DAYS_RANGE.1]);
                d["can"] = caps;
                Some((200, d))
            }
            ("POST", "/api/presence/retention") => {
                if let Some(e) = manager("履歴を残す日数を変えられません") {
                    return deny(e);
                }
                let b = body()?;
                let days = match parse_history_days(b.get("days")) {
                    Ok(n) => n,
                    Err(e) => return Some((400, json!({"error": e, "kind": "invalid"}))),
                };
                if !self.save_settings(days, &text(me.get("login")), &text(me.get("pc"))) {
                    return Some((503, json!({"error": "書けませんでした（共有フォルダを確かめてください）。", "kind": "unavailable"})));
                }
                Some((200, json!({"ok": true, "historyDays": days})))
            }
            ("POST", "/api/presence/prune") => {
                if let Some(e) = manager("古い記録を整理できません") {
                    return deny(e);
                }
                let mut v = self.prune_all();
                v["ok"] = json!(true);
                Some((200, v))
            }
            _ => None,
        }
    }

    /// 窓の置き場の答えに合わせて置き場を決め、道を答える（Lot から）
    pub fn handle_with_place(&self, me: &Value, place: &Place, method: &str, path: &str, query: &str, body: &[u8]) -> Option<(u16, Value)> {
        self.configure(place.presence.clone());
        self.handle(me, place.share_dir.is_some(), method, path, query, body)
    }
}

/// 画面から来た日数 → 整数（presence.parse_history_days）
pub fn parse_history_days(v: Option<&Value>) -> Result<i64, String> {
    let (lo, hi) = HISTORY_DAYS_RANGE;
    let s = py_str(v.unwrap_or(&Value::Null));
    let n = pyfmt::py_int(pyfmt::strip(&s)).map_err(|_| "日数は整数で入れてください。".to_string())?;
    if !(lo..=hi).contains(&n) {
        return Err(format!("日数は {lo}〜{hi} で入れてください。"));
    }
    Ok(n)
}

/// 利用状況の道か（窓が受け持つ 7 本。心拍は別）
pub fn is_route(method: &str, path: &str) -> bool {
    matches!(
        (method, path),
        ("GET", "/api/presence")
            | ("GET", "/api/presence/sessions")
            | (
                "POST",
                "/api/presence/disconnect"
                    | "/api/presence/allow"
                    | "/api/presence/forget"
                    | "/api/presence/retention"
                    | "/api/presence/prune"
            )
    )
}

// ---------------------------------------------------------------- 画面の設定の控え（services/ui_state.py）

pub mod ui_state {
    use super::*;

    const PREFIX: &str = "tpa.";
    const MAX_BYTES: usize = 4 * 1024 * 1024;
    static LOCK: Mutex<()> = Mutex::new(());

    pub fn path(local_root: &Path) -> PathBuf {
        local_root.join("ui_state.json")
    }

    /// → {"rev", "keys"}。無い・壊れているときは空（ui_state.load）
    pub fn load(local_root: &Path) -> Value {
        let empty = json!({"rev": 0, "keys": {}});
        let Doc::Ok(Value::Object(d)) = read(&path(local_root)) else { return empty };
        let keys: Map<String, Value> = match d.get("keys") {
            Some(Value::Object(k)) => {
                k.iter().filter(|(k, v)| k.starts_with(PREFIX) && v.is_string()).map(|(k, v)| (k.clone(), v.clone())).collect()
            }
            Some(x) if truthy(x) => return empty,
            _ => Map::new(),
        };
        let rev = match d.get("rev") {
            Some(x) if truthy(x) => match py_int_of(x) {
                Some(n) => n,
                None => return empty,
            },
            _ => 0,
        };
        json!({"rev": rev, "keys": keys})
    }

    /// 変わった名前と消した名前を控えに重ねる（ui_state.merge。POST /api/ui-state）。読めない本文（片割れの代用字など）は None（Python に任せる）
    pub fn post(local_root: &Path, body: &[u8]) -> Option<(u16, Value)> {
        if crate::access_write::needs_python(body) {
            return None;
        }
        let b: Value = serde_json::from_slice(body).ok().filter(truthy).unwrap_or(json!({}));
        let b = b.as_object()?;
        let bad = |e: &str| Some((400, json!({"error": e})));
        let changed = b.get("changed");
        let removed = b.get("removed").filter(|v| truthy(v)).cloned().unwrap_or(json!([]));
        let (Some(Value::Object(changed)), Value::Array(removed)) = (changed, &removed) else {
            return bad("changed・removed の形が違います。");
        };
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let cur = load(local_root);
        let mut keys = cur["keys"].as_object().cloned().unwrap_or_default();
        for (k, v) in changed {
            if k.starts_with(PREFIX) && v.is_string() {
                keys.insert(k.clone(), v.clone());
            }
        }
        for k in removed.iter().filter_map(Value::as_str).filter(|k| k.starts_with(PREFIX)) {
            keys.remove(k);
        }
        // 大きさは Python の json.dumps の区切り（", " と ": "）の字で数える
        if crate::join::py_dumps(&Value::Object(keys.clone())).len() > MAX_BYTES {
            return bad("画面の設定が大きすぎます。");
        }
        // i64 に入らない版の番号（壊れた控え）は Python に任せる（Python の int は上限が無い）
        let rev = cur["rev"].as_i64().unwrap_or(0).checked_add(1)?;
        if let Err(e) = write_json_atomic(&path(local_root), &json!({"rev": rev, "keys": keys}), b"", 0.0) {
            return Some((500, json!({"error": e.to_string(), "kind": "error"})));
        }
        Some((200, json!({"rev": rev})))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_months_and_versions() {
        assert!(safe_key(Some(&json!("PC-1@sato"))));
        for k in ["", "..", "../x", "a/b", ".x", "a b"] {
            assert!(!safe_key(Some(&json!(k))), "{k}");
        }
        assert_eq!(month_after("2026-12"), NaiveDate::from_ymd_opt(2027, 1, 1).unwrap().and_hms_opt(0, 0, 0));
        assert_eq!(month_after("2026-x"), None);
        assert_eq!(month_after("0-3"), None, "Python は datetime(0, …) で止まる: 数えない");
        assert!(version_key("1.10.0") > version_key("1.9.3"));
        assert_eq!(version_key("3"), vec![3, 0, 0]);
        assert!(behind(Some("3.70.0"), "3.69.0", false) && !behind(Some("3.69.0"), "3.70.0", false));
        assert!(behind(Some("3.69.0"), "3.70.0", true), "配る版が決まっていれば、新しすぎる版も戻す");
        assert_eq!(parse_history_days(Some(&json!(" 400 "))), Ok(400));
        assert!(parse_history_days(Some(&json!(400.0))).is_err(), "str(400.0) は int に読めない");
        assert!(parse_history_days(Some(&json!(10))).unwrap_err().contains("30〜3650"));
    }

    #[test]
    fn indent_matches_python() {
        let v = json!({"a": [1, {"b": "日本"}], "c": {}});
        assert_eq!(
            String::from_utf8(dumps_indent(&v, b" ")).unwrap(),
            "{\n \"a\": [\n  1,\n  {\n   \"b\": \"日本\"\n  }\n ],\n \"c\": {}\n}\n"
        );
        assert_eq!(String::from_utf8(dumps_indent(&json!({"rev": 1, "keys": {}}), b"")).unwrap(), "{\n\"keys\": {},\n\"rev\": 1\n}\n");
    }

    #[test]
    fn writes_nothing_without_the_share() {
        let d = std::env::temp_dir().join(format!("da-presence-unit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let p = Presence::new(d.join("local"), system_clock());
        p.set_version("3.71.0");
        p.configure(Some(d.join("share").join("presence_tpa")));
        assert!(!p.touch("u", "PC", "一般ユーザー", "PC@u", true), "共有の置き場そのものは作らない");
        assert!(!d.join("share").exists());
        std::fs::create_dir_all(d.join("share")).unwrap();
        assert!(p.touch("u", "PC", "一般ユーザー", "PC@u", true));
        assert!(d.join("share/presence_tpa/history/PC@u.json").exists());
        assert!(!p.touch("u", "PC", "一般ユーザー", "../x", true), "鍵の正しくない名乗りは書かない");
        // 壊れた控え: i64 に入らない版の番号は Python に任せる（Python の int は上限が無い。作った後の採点）
        std::fs::create_dir_all(d.join("local")).unwrap();
        std::fs::write(ui_state::path(&d.join("local")), r#"{"rev": 9223372036854775807, "keys": {}}"#).unwrap();
        assert!(ui_state::post(&d.join("local"), br#"{"changed": {"tpa.a": "1"}}"#).is_none());
        let _ = std::fs::remove_dir_all(&d);
    }
}
