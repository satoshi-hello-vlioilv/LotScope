//! 一覧の段取り（版 3.60.0。Python の routes/worklog.py の worklog_plan・routes/sources.py の src_plan / raw_plan / with_joins・
//! routes/lotlist.py の lotlist_plan を移した）。どのファイルを・どの表で・どの決まりで引くかを決め、品質・作業実績・データ元の
//! 一覧とスライサーに窓（Rust）が答える。答え・失敗の言葉は Python と同じ（desktop/tests/lists_parity.rs・lot.rs の試験）。
//!
//! - 材料（データ元の定義・作業実績の登録・勤務体系・出さないタブ）は Python の設定の答え（/api/lotlist/settings の lists）。
//!   マスタは共有のマスタにあるので読むのは Python、決めるのは Rust
//! - 作業実績のフォルダは窓が見る（10 秒覚える）。名前が変わったファイルは、同じファイルID の物をたどる（work_log.match と同じ決まり）
//! - 写しは窓の写しの係（mirror::Mirrors）。結合は src/join.rs
//! - スケジュール（CM3。版 3.96.0 から窓が係）: 設備ごとに src/schedule.rs が CM3 から取って置いた世代に、データ元の結合を当てる。
//!   設定（schedule の段）は一覧の設定の scheduleConf（窓の束から。Python に尋ねた設定には無い＝窓は答えず Python に任せる）

use crate::join::{Join, JoinError, Joiner, Right};
use crate::lotlist::{self, Opts, TABLE_CANDIDATES, WORK_TABLES};
use crate::mirror::{DbMirror, Mirrors};
use crate::schedule::{self, Cfg, Schedules, St, HOT_KEY};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// フォルダの中身を覚える長さ（タブを開くたびに共有を読み直さない。Python の work_log.LIST_TTL_SEC と同じ）
const LIST_TTL: Duration = Duration::from_secs(10);

/// 品質の元ファイルが決まっていないとき（Python の lotlist_plan と同じ言葉）
pub const NO_SOURCE: &str = "品質の元ファイルが決まっていません。「マスタ管理」の「データ元」で品質の場所を入れてください。";

/// 失敗の答え（状態, 本文）
pub type Fail = (u16, Value);

fn error(status: u16, message: &str, kind: Option<&str>, extra: &[(&str, Value)]) -> Fail {
    let mut v = json!({"error": message});
    if let Some(k) = kind {
        v["kind"] = json!(k);
    }
    for (k, x) in extra {
        v[*k] = x.clone();
    }
    (status, v)
}

/// Python の真偽（JSON の値）
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        x => x.to_string(),
    }
}

/// フォルダ・ファイルの欄の字（前後の空白と " を除く。Python の fsio.unquote_path）
pub fn unquote_path(s: &str) -> String {
    crate::pyfmt::strip(s).trim_matches('"').to_string()
}

// ------------------------------------------------------------------ 作業実績のフォルダ（Python の work_log.scan・match・resolve）
#[derive(Debug, Clone)]
pub struct Found {
    pub file: String,
    pub fid: String,
    /// ファイル名の * の所（Python の work_log.equipment_of）
    pub equipment: String,
    pub size: u64,
    /// 更新時刻（Python の st_mtime と同じ「秒 + ナノ秒 × 1e-9」。版 3.91.0）
    pub mtime: f64,
}

/// 「実績_*.sqlite3」→ ("実績_", ".sqlite3")。* はちょうど 1 つ
pub fn split_pattern(pattern: &str) -> Result<(String, String), String> {
    let p = crate::pyfmt::strip(pattern);
    if p.matches('*').count() != 1 {
        return Err(format!("ファイル名の決まり「{p}」には、設備名の所に * をちょうど 1 つ書いてください（例: 実績_*.sqlite3）。"));
    }
    let (h, t) = p.split_once('*').unwrap();
    Ok((h.into(), t.into()))
}

/// ファイル名が決まりに合えば * の所（設備名。前後の空白を除く。空なら合わない）。大文字・小文字は区別しない（Python の work_log.equipment_of）
pub(crate) fn equipment_of(name: &str, head: &str, tail: &str) -> Option<String> {
    let (low, h, t) = (name.to_lowercase(), head.to_lowercase(), tail.to_lowercase());
    let n = name.chars().count();
    if n <= head.chars().count() + tail.chars().count() || !low.starts_with(&h) || !low.ends_with(&t) {
        return None;
    }
    let mid: String = name.chars().skip(head.chars().count()).take(n - head.chars().count() - tail.chars().count()).collect();
    let mid = crate::pyfmt::strip(&mid);
    (!mid.is_empty()).then(|| mid.to_string())
}

/// 書き手の作業用のファイルか（隠し・.pending_・-journal・-wal・-shm・.incoming。Python の db_mirror.is_side_file）
fn is_side_file(name: &str) -> bool {
    let low = name.to_lowercase();
    low.starts_with('.') || low.contains(".pending_") || [".incoming", "-journal", "-wal", "-shm"].iter().any(|x| low.ends_with(x))
}

/// ファイルそのものの見分け（装置の番号:ファイル番号[:作った時刻]。Python の work_log.file_id と同じ形）
#[cfg(unix)]
pub(crate) fn file_id(path: &Path) -> String {
    use std::os::unix::fs::MetadataExt;
    match std::fs::metadata(path) {
        Ok(m) if m.ino() != 0 => format!("{}:{}", m.dev(), m.ino()),
        _ => String::new(),
    }
}

#[cfg(windows)]
pub(crate) fn file_id(path: &Path) -> String {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
    // 中は読まない（属性だけ）。書き手の置き換え・削除を止めない開き方
    let Ok(f) = std::fs::OpenOptions::new().access_mode(0).share_mode(7).custom_flags(0x0200_0000).open(path) else { return String::new() };
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(HANDLE(f.as_raw_handle()), &mut info) }.is_err() {
        return String::new();
    }
    let ino = ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64;
    if ino == 0 {
        return String::new();
    }
    let ft = ((info.ftCreationTime.dwHighDateTime as u64) << 32) | info.ftCreationTime.dwLowDateTime as u64;
    if ft == 0 {
        // 作った時刻を答えない置き場（Python も st_birthtime が 0 なら付けない）
        return format!("{}:{ino}", info.dwVolumeSerialNumber);
    }
    let birth = (ft as i128 - 116_444_736_000_000_000) * 100; // 1601 年からの 100ns → 1970 年からの ns（Python の st_birthtime_ns）
    format!("{}:{ino}:{birth}", info.dwVolumeSerialNumber)
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn file_id(_: &Path) -> String {
    String::new()
}

/// ファイルID が同じファイルを指すか。Python の版で装置の番号の幅（Windows の 32/64 ビット）と作った時刻の有無が違っても、
/// 装置の番号の下 32 ビット・ファイル番号が同じで、作った時刻が両方にあれば同じ、を同じファイルと見る
pub fn same_fid(a: &str, b: &str) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }
    if a == b {
        return true;
    }
    // 数字だけ（ASCII・38 桁まで。Python の work_log.same_fid と同じ読み方。parse は「+」も読むので先に見る）
    let p = |s: &str| {
        s.split(':')
            .map(|x| (!x.is_empty() && x.len() <= 38 && x.bytes().all(|b| b.is_ascii_digit())).then(|| x.parse::<u128>().ok()).flatten())
            .collect::<Vec<_>>()
    };
    let (x, y) = (p(a), p(b));
    if x.len() < 2 || y.len() < 2 || x.iter().chain(&y).any(Option::is_none) {
        return false;
    }
    let low = |v: &Option<u128>| v.unwrap() & 0xFFFF_FFFF;
    low(&x[0]) == low(&y[0]) && x[1] == y[1] && (x.len() < 3 || y.len() < 3 || x[2] == y[2])
}

/// フォルダの中で決まりに合うファイル（名前の順）。届かなければ理由
/// Python の st_mtime（秒を床・ナノ秒を正にして「秒 + ナノ秒 × 1e-9」。1970 年より前は負の秒）
pub(crate) fn py_mtime(t: std::time::SystemTime) -> f64 {
    match t.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_secs() as f64 + d.subsec_nanos() as f64 * 1e-9,
        Err(e) => {
            let d = e.duration();
            let (s, n) = (d.as_secs() as i64, d.subsec_nanos());
            if n == 0 {
                -s as f64
            } else {
                -(s + 1) as f64 + (1_000_000_000 - n) as f64 * 1e-9
            }
        }
    }
}

pub fn scan(folder: &str, pattern: &str) -> Result<Vec<Found>, String> {
    let folder = unquote_path(folder);
    if folder.is_empty() {
        return Err("作業実績のフォルダが決まっていません。「マスタ管理」の「データ元」の「実績」でフォルダを入れてください。".into());
    }
    let (head, tail) = split_pattern(pattern)?;
    let rd = std::fs::read_dir(&folder).map_err(|e| {
        let why = e.to_string();
        // OS の言葉（Python の strerror と同じ所まで: 「(os error n)」と末尾の「.」・空白を除く。英語の Windows は末尾に「.」が付く）
        let why = why.split(" (os error").next().unwrap_or(&why).trim_end_matches(['.', ' ']).to_string();
        format!("作業実績のフォルダに届きません（{why}）: {folder}")
    })?;
    let mut out = vec![];
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if is_side_file(&name) {
            continue;
        }
        let Some(equipment) = equipment_of(&name, &head, &tail) else { continue };
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) && !e.path().is_file() {
            continue;
        }
        // 属性を読めないファイルは除く（Python の os.stat が落ちた行と同じ）
        let Ok(m) = std::fs::metadata(e.path()) else { continue };
        let mtime = m.modified().map(py_mtime).unwrap_or(0.0);
        out.push(Found { fid: file_id(&e.path()), file: name, equipment, size: m.len(), mtime });
    }
    out.sort_by_key(|f| f.file.to_lowercase());
    Ok(out)
}

/// その行で読むファイル（同じ名前 → 無ければ同じファイルID の物）。見つからなければ None
pub fn resolve(row: &Value, folder: &str, found: &[Found]) -> Option<PathBuf> {
    let name = text(&row["ファイル名"]).to_lowercase();
    let hit = found.iter().find(|f| f.file.to_lowercase() == name).or_else(|| {
        let fid = text(&row["ファイルID"]);
        found.iter().find(|f| same_fid(&fid, &f.fid))
    })?;
    Some(Path::new(&unquote_path(folder)).join(&hit.file))
}

// ------------------------------------------------------------------ 段取り
/// 一覧を読む前の段取り（どのファイルを・どの表で・どの決まりで）
pub struct Plan {
    pub mirror: Option<Arc<DbMirror>>,
    pub path: Option<PathBuf>,
    pub table: String,
    pub page_size: i64,
    pub source: Value,
    pub equip: Option<Value>,
    /// 表の候補を決める元（結合した表は元の元。Python の candKey）
    pub cand_key: String,
    pub lot_col: Option<String>,
    /// 結合の数（with_joins の stats。結合が無ければ Null）
    pub joined: Value,
    /// スケジュールの段取り（設備・覚え。版 3.96.0）
    pub sched: Option<SchPlan>,
}

/// スケジュールの段取りの残り（一覧の答えに添える数のため）
pub struct SchPlan {
    pub cfg: Cfg,
    pub equip: String,
    pub state: St,
    /// HOT の設備ごとの覚え
    pub states: Vec<(String, St)>,
    /// HOT の情報
    pub hot: Option<Value>,
}

impl Plan {
    pub fn opts(&self) -> Opts {
        let quality = self.cand_key == "lot";
        Opts {
            table: self.table.clone(),
            candidates: if self.cand_key == "work" { WORK_TABLES } else { TABLE_CANDIDATES },
            page_size: self.page_size,
            lot_col: self.lot_col.clone().filter(|s| !s.is_empty()),
            quality,
        }
    }
}

/// 設定の答えの lists（Python の lotlist.lists_settings）
pub struct Conf<'a> {
    pub v: &'a Value,
}

impl Conf<'_> {
    pub fn source(&self, key: &str) -> Option<&Value> {
        self.v["sources"].as_array()?.iter().find(|s| s["key"] == key)
    }
    fn hidden(&self, tab: &str) -> bool {
        self.v["hidden"].as_array().is_some_and(|a| a.iter().any(|x| x == tab))
    }
    /// 出さないタブなら断る答え（Python の common.tab_denied）
    pub fn denied(&self, tab: &str, name: &str) -> Option<Fail> {
        self.hidden(tab).then(|| {
            let n = if name.is_empty() { tab } else { name };
            error(
                403,
                &format!("「{n}」を見る権限がありません（アクセス権限のタブの決まり）。必要なら管理する人に頼んでください。"),
                Some("forbidden"),
                &[],
            )
        })
    }
    fn lot_set(&self, key: &str) -> Option<String> {
        self.source(key).map(|s| text(&s["lotSet"])).filter(|s| !s.is_empty())
    }
    pub fn work(&self) -> &Value {
        &self.v["work"]
    }
    /// スケジュールの設定（一覧の設定の scheduleConf）。無ければ None（窓は答えず Python に任せる）・組めなければ Some(Err)
    pub fn sched_cfg(&self) -> Option<Result<Cfg, &'static str>> {
        let v = self.v.get("scheduleConf")?;
        Some(Cfg::from_section(Some(v)))
    }

    pub fn shifts(&self) -> Vec<Value> {
        self.v["shifts"].as_array().cloned().unwrap_or_default()
    }
}

pub(crate) fn num(v: &Value, d: f64) -> f64 {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())).unwrap_or(d)
}

/// 品質の写し（Lot が持つ）と、その設定
pub struct Quality<'a> {
    pub mirror: Arc<DbMirror>,
    pub table: &'a str,
    pub page_size: i64,
}

/// フォルダの中身の覚え（(フォルダ, 決まり) → (読んだ時刻, 見つけたファイルか届かない理由)）
type Listing = HashMap<(String, String), (Instant, Result<Vec<Found>, String>)>;

/// 作業実績・データ元の写しの係・結合の係・フォルダの覚え
pub struct Lists {
    pub work: Mirrors,
    pub src: Mirrors,
    pub joiner: Joiner,
    /// スケジュールの係（版 3.96.0。この PC の作業場所の db_cache/schedule）
    pub sched: Arc<Schedules>,
    listing: Mutex<Listing>,
    /// フォルダの中身を覚える長さ（既定 LIST_TTL。試験は 0 にして、届かなくなったフォルダをすぐ見る）
    pub list_ttl: Duration,
}

impl Lists {
    pub fn new(cache_root: &Path) -> Lists {
        Lists {
            work: Mirrors::new(cache_root.join("work_log"), "work_log"),
            src: Mirrors::new(cache_root.join("sources"), "src"),
            joiner: Joiner::new(cache_root.join("joins")),
            sched: Arc::new(Schedules::new(cache_root.join("schedule"))),
            listing: Mutex::default(),
            list_ttl: LIST_TTL,
        }
    }

    /// 受け身の Python からの「写して」（{prefix, key, remote, interval, stale}）
    pub fn notice(&self, v: &Value) {
        if v["event"] == "schedule" {
            // 受け身の Python からの「取って」（版 3.96.0）: 窓の係が裏で取り、状態のファイルを書く（知らせの糸を止めない）
            let (me, v) = (self.sched.clone(), v.clone());
            std::thread::spawn(move || me.on_notice(&v));
            return;
        }
        if v["event"] != "mirror" {
            return;
        }
        let ms = match v["prefix"].as_str() {
            Some("work_log") => &self.work,
            Some("src") => &self.src,
            _ => return,
        };
        let (key, remote) = (text(&v["key"]), text(&v["remote"]));
        if !key.is_empty() && !remote.is_empty() {
            ms.get(&key, &remote, num(&v["interval"], 60.0) as i64, num(&v["stale"], 36.0));
        }
    }

    /// フォルダの覚えを捨てる（参照先の実績のフォルダ・決まりを書いたとき。Python の WORK_LISTING.forget と同じ）
    pub fn forget_listing(&self) {
        self.listing.lock().unwrap().clear();
    }

    /// フォルダで見つけたファイル（10 秒覚える）
    fn found(&self, folder: &str, pattern: &str) -> Result<Vec<Found>, String> {
        self.found_fresh(folder, pattern, false)
    }

    /// フォルダで見つけたファイル（Python の work_log.Listing.get。fresh は覚えを使わずに探し、探した中身を覚える）。
    /// 作業実績の一覧の段取りと、マスタ管理の作業実績の登録（版 3.91.0。src/worklog_write.rs）が同じ覚えを使う
    pub fn found_fresh(&self, folder: &str, pattern: &str, fresh: bool) -> Result<Vec<Found>, String> {
        let key = (unquote_path(folder), pattern.to_string());
        if !fresh {
            if let Some((at, r)) = self.listing.lock().unwrap().get(&key) {
                if at.elapsed() < self.list_ttl {
                    return r.clone();
                }
            }
        }
        let r = scan(&key.0, &key.1);
        let mut m = self.listing.lock().unwrap();
        if m.len() > 16 {
            m.clear();
        }
        m.insert(key, (Instant::now(), r.clone()));
        r
    }

    /// 品質の段取り（Python の lotlist_plan）
    pub fn lot_plan(&self, conf: &Conf, q: &Quality, joined: bool) -> Result<Plan, Fail> {
        if joined {
            if let Some(f) = conf.denied("lot", "品質") {
                return Err(f);
            }
        }
        let m = q.mirror.clone();
        if m.remote().is_empty() {
            return Err(error(400, NO_SOURCE, None, &[("source", m.source_info())]));
        }
        let Some(path) = m.read_path() else {
            return Err(error(503, &m.not_ready_text(), Some("copying"), &[("source", m.source_info())]));
        };
        let plan = Plan {
            source: m.source_info(),
            mirror: Some(m),
            path: Some(path),
            table: q.table.into(),
            page_size: q.page_size,
            equip: None,
            cand_key: "lot".into(),
            lot_col: conf.lot_set("lot"),
            joined: Value::Null,
            sched: None,
        };
        match (joined, conf.source("lot")) {
            (true, Some(s)) => self.with_joins(conf, q, plan, s, None),
            _ => Ok(plan),
        }
    }

    /// 作業実績の設備の段取り（Python の worklog_plan）。need_copy=false は写しがまだ無くてもよい（再読込）
    pub fn work_plan(&self, conf: &Conf, q: &Quality, key: &str, need_copy: bool, joined: bool) -> Result<Plan, Fail> {
        self.work_plan_wait(conf, q, key, need_copy, joined, true)
    }

    /// wait … 初めての写しを待つ（false は待たない。いくつもの設備の写しを一度に始めて、まとめて待つ所: dashboard.rs。Python の worklog_plan の wait）
    pub fn work_plan_wait(&self, conf: &Conf, q: &Quality, key: &str, need_copy: bool, joined: bool, wait: bool) -> Result<Plan, Fail> {
        if joined {
            if let Some(f) = conf.denied("work", "実績") {
                return Err(f);
            }
        }
        let wl = conf.work();
        let row = wl["rows"].as_array().and_then(|rs| rs.iter().find(|r| r["キー"] == key));
        let Some(row) = row.filter(|_| !key.is_empty()) else {
            return Err(error(
                404,
                "その設備は作業実績に登録されていません。「マスタ管理」の「データ元」の「実績」でフォルダを探してください。",
                Some("unknown"),
                &[],
            ));
        };
        let shown = text(&row["表示"]);
        if shown == "無" {
            return Err(error(
                403,
                &format!("「{}」は表示しない設定です（「マスタ管理」の「データ元」の「実績」で変えられます）。", text(&row["設備名"])),
                Some("hidden"),
                &[],
            ));
        }
        let folder = text(&wl["folder"]);
        let (found, err) = match self.found(&folder, &text(&wl["pattern"])) {
            Ok(f) => (f, String::new()),
            Err(e) => (vec![], e),
        };
        let path = if err.is_empty() { resolve(row, &folder, &found) } else { None };
        let (refresh, stale) = (num(&wl["refresh_seconds"], 60.0) as i64, num(&wl["stale_hours"], 36.0));
        let m = match &path {
            Some(p) => self.work.get(key, &p.display().to_string(), refresh, stale),
            None => match self.work.peek(key) {
                // フォルダに届かない・見つからなくても、前に写した物があればそれで見せる（fail-open）
                Some(m) if m.source_info()["mirrored"] == true => m,
                _ => {
                    let why = if err.is_empty() {
                        format!(
                            "「{}」が作業実績のフォルダに見つかりません（名前が変わったか、消されました）。「マスタ管理」の「データ元」の「実績」で結ぶファイルを選び直してください。",
                            text(&row["ファイル名"])
                        )
                    } else {
                        err.clone()
                    };
                    let equip = json!({"key": key, "name": row["設備名"], "file": row["ファイル名"]});
                    return Err(if err.is_empty() {
                        error(404, &why, Some("missing"), &[("equip", equip)])
                    } else {
                        error(503, &why, Some("unreachable"), &[("equip", equip)])
                    });
                }
            },
        };
        let read = m.read_path_wait(wait);
        let file_now = path.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned());
        let equip = json!({
            "key": key, "name": text(&row["設備名"]),
            "file": file_now.clone().unwrap_or_else(|| text(&row["ファイル名"])),
            "renamed": file_now.as_ref().is_some_and(|n| *n != text(&row["ファイル名"])),
        });
        if read.is_none() && need_copy {
            return Err(error(503, &m.not_ready_text(), Some("copying"), &[("source", m.source_info()), ("equip", equip)]));
        }
        let table = Some(text(&row["表"])).filter(|t| !t.is_empty()).unwrap_or_else(|| text(&wl["table"]));
        let plan = Plan {
            source: m.source_info(),
            mirror: Some(m),
            path: read,
            table,
            page_size: num(&wl["page_size"], 500.0) as i64,
            equip: Some(equip),
            cand_key: "work".into(),
            lot_col: conf.lot_set("work"),
            joined: Value::Null,
            sched: None,
        };
        match (joined && plan.path.is_some(), conf.source("work")) {
            (true, Some(s)) => self.with_joins(conf, q, plan, s, Some(&format!("work-{key}"))),
            _ => Ok(plan),
        }
    }

    /// データ元（/api/src/<キー>）の段取り（Python の src_plan）。Ok(None) はスケジュール（Python が答える）
    pub fn src_plan(&self, conf: &Conf, q: &Quality, key: &str, need_copy: bool, joined: bool) -> Result<Option<Plan>, Fail> {
        self.src_plan_eq(conf, q, key, need_copy, joined, "", false)
    }

    /// src_plan に、スケジュールの設備（equip。空なら最初の設備・__HOT__ は HOT コイル作業順）と取り直し（force）を足した物。
    /// Ok(None) は窓が答えない形（スケジュールの設定を窓が組めない・係を降りた）
    #[allow(clippy::too_many_arguments)]
    pub fn src_plan_eq(
        &self,
        conf: &Conf,
        q: &Quality,
        key: &str,
        need_copy: bool,
        joined: bool,
        equip: &str,
        force: bool,
    ) -> Result<Option<Plan>, Fail> {
        let Some(s) = conf.source(key).filter(|s| text(&s["api"]).starts_with("/api/src/")) else {
            return Err(error(404, "そのデータ元はありません。「マスタ管理」の「データ元」で確かめてください。", Some("unknown"), &[]));
        };
        let name = text(&s["name"]);
        if joined {
            if let Some(f) = conf.denied(key, &name) {
                return Err(f);
            }
        }
        let read = &s["read"];
        match s["kind"].as_str() {
            Some("cm3") => return self.sch_plan(conf, q, s, equip, force, joined),
            Some("view") => {
                if truthy(&s["broken"]) {
                    return Err(error(
                        400,
                        &format!("「{name}」の元のデータ元がありません。「マスタ管理」の「データ元」で元を選び直してください。"),
                        Some("unset"),
                        &[],
                    ));
                }
                let base = text(&s["base"]);
                // スケジュールを元にした結合した表（版 3.96.0 から窓）: 元は最初の設備の予定（Python の raw_plan → schedule_plan）
                let Some(mut plan) = self.raw_plan_opt(conf, q, &base)? else { return Ok(None) };
                plan.page_size = num(&read["page_size"], 500.0) as i64;
                plan.cand_key = base;
                plan.lot_col = Some(text(&s["lotSet"])).filter(|x| !x.is_empty());
                return if joined { self.with_joins(conf, q, plan, s, None).map(Some) } else { Ok(Some(plan)) };
            }
            _ => {}
        }
        let place = text(&s["place"]);
        if place.is_empty() {
            return Err(error(
                400,
                &format!("「{name}」の場所が決まっていません。「マスタ管理」の「データ元」で入れてください。"),
                Some("unset"),
                &[],
            ));
        }
        let m = self.src.get(key, &place, num(&read["refresh_seconds"], 60.0) as i64, num(&read["stale_hours"], 36.0));
        let path = m.read_path();
        if path.is_none() && need_copy {
            return Err(error(503, &m.not_ready_text(), Some("copying"), &[("source", m.source_info())]));
        }
        let plan = Plan {
            source: m.source_info(),
            mirror: Some(m),
            path,
            table: text(&s["table"]),
            page_size: num(&read["page_size"], 500.0) as i64,
            equip: None,
            cand_key: key.into(),
            lot_col: Some(text(&s["lotSet"])).filter(|x| !x.is_empty()),
            joined: Value::Null,
            sched: None,
        };
        if joined && plan.path.is_some() {
            self.with_joins(conf, q, plan, s, None).map(Some)
        } else {
            Ok(Some(plan))
        }
    }

    /// 作業実績の表示する設備（表示の並び）ごとの、結合しない段取り（版 3.99.0。Python の routes/sources.work_plans）→
    /// ([(登録の行, 段取り)], 読めなかった設備 [{name, error, kind}], 1 台も読めないときの失敗の答え〈写し中を先に〉)。
    /// 写しを一度に始めて、最初の写しを wait まで待つ（Python の start_mirrors）。読めない設備は飛ばす
    pub(crate) fn work_raw_plans(
        &self,
        conf: &Conf,
        q: &Quality,
        all: bool,
        wait: std::time::Duration,
    ) -> (Vec<(Value, Plan)>, Vec<Value>, Option<Fail>) {
        let wl = conf.work();
        let rows: Vec<&Value> = wl["rows"].as_array().into_iter().flatten().filter(|r| text(&r["表示"]) != "無").collect();
        let Some(mut rows) = crate::bundle::work_order(rows) else {
            return (vec![], vec![], Some(error(503, "作業実績の登録を読めません。", None, &[])));
        };
        if rows.is_empty() {
            return (vec![], vec![], Some(error(404, "作業実績の設備がありません。", Some("unknown"), &[])));
        }
        if !all {
            rows.truncate(1);
        }
        let mut keys = vec![];
        for r in &rows {
            let key = text(&r["キー"]);
            match self.work_plan_wait(conf, q, &key, true, false, false) {
                Ok(_) => keys.push(key),
                Err((_, v)) if v["kind"] == "copying" => keys.push(key),
                Err(_) => {}
            }
        }
        self.work.wait_first(&keys, wait);
        let (mut got, mut failed, mut first): (Vec<(Value, Plan)>, Vec<Value>, Option<Fail>) = (vec![], vec![], None);
        for r in rows {
            match self.work_plan_wait(conf, q, &text(&r["キー"]), true, false, false) {
                Ok(p) => got.push((r.clone(), p)),
                Err(f) => {
                    let kind = f.1["kind"].as_str().filter(|k| !k.is_empty()).unwrap_or("error").to_string();
                    let e = f.1["error"].as_str().filter(|e| !e.is_empty()).unwrap_or("読めませんでした。").to_string();
                    failed.push(json!({"name": text(&r["設備名"]), "error": e, "kind": kind}));
                    let first_copying = first.as_ref().is_some_and(|(_, v)| v["kind"] == "copying");
                    if first.is_none() || (kind == "copying" && !first_copying) {
                        first = Some(f);
                    }
                }
            }
        }
        let fail = if got.is_empty() { first } else { None };
        (got, failed, fail)
    }

    /// raw_plan のうち、スケジュールの元で窓が答えない形を None にした物
    pub(crate) fn raw_plan_opt(&self, conf: &Conf, q: &Quality, key: &str) -> Result<Option<Plan>, Fail> {
        if conf.source(key).is_some_and(|b| b["kind"] == "cm3") {
            return self.src_plan(conf, q, key, true, false);
        }
        self.raw_plan(conf, q, key).map(Some)
    }

    /// 結合しない元のままの段取り（結合の相手・結合した表の元。Python の raw_plan）
    pub fn raw_plan(&self, conf: &Conf, q: &Quality, key: &str) -> Result<Plan, Fail> {
        match key {
            "lot" => self.lot_plan(conf, q, false),
            // 作業実績（設備ごとのファイル）は結合の相手・結合した表の元にならない（data_sources.join_targets が 1 ファイルの元だけ）ので、
            // ここへは来ない（Python の raw_plan の "work" は結合の欄の列の手がかり・「試す」のためで、窓は受け持たない。来ても下の src_plan が 404）
            _ => {
                if let Some(s) = conf.source(key).filter(|s| s["kind"] == "view") {
                    if truthy(&s["broken"]) {
                        return Err(error(400, "結合した表の元がありません。", Some("unset"), &[]));
                    }
                    return self.raw_plan(conf, q, &text(&s["base"]));
                }
                match self.src_plan(conf, q, key, true, false)? {
                    Some(p) => Ok(p),
                    None => Err(error(400, "スケジュールは結合の元にできません。", Some("invalid"), &[])),
                }
            }
        }
    }

    /// 段取りの読むファイルを、データ元 s の結合を当てた答えのファイルに替える（結合が無ければそのまま。Python の with_joins）
    fn with_joins(&self, conf: &Conf, q: &Quality, plan: Plan, s: &Value, scope: Option<&str>) -> Result<Plan, Fail> {
        self.with_joins_as(conf, q, plan, s, scope, None)
    }

    /// with_joins に、決まりを替えて試す（「試す」の数。Python の with_joins の joins）口を足した物（版 3.99.0）
    pub(crate) fn with_joins_as(
        &self,
        conf: &Conf,
        q: &Quality,
        plan: Plan,
        s: &Value,
        scope: Option<&str>,
        over: Option<Vec<Join>>,
    ) -> Result<Plan, Fail> {
        let joins = over.unwrap_or_else(|| Join::list(&s["joins"]));
        if joins.is_empty() {
            return Ok(plan);
        }
        let rights = self.rights_of(conf, q, &joins)?;
        let base = plan.path.clone().unwrap_or_default();
        let ck = if !plan.cand_key.is_empty() { plan.cand_key.clone() } else { text(&s["key"]) };
        let table = actual_table(&base, &plan.table, &ck).map_err(|e| error(503, &e, None, &[]))?;
        let name = text(&s["name"]);
        let key = scope.map(str::to_string).unwrap_or_else(|| text(&s["key"]));
        match self.joiner.path_for(&key, &base, &table, &joins, &rights) {
            Ok((path, stats)) => Ok(Plan { path: Some(path), table, joined: stats, ..plan }),
            Err(e) => {
                let st = if matches!(e, JoinError::Rule(_)) { 400 } else { 503 };
                Err(error(st, &format!("「{name}」の結合を組めませんでした: {e}"), Some("join"), &[]))
            }
        }
    }

    /// 結合ごとの相手の (写し, 表, 名前)（Python の _rights）
    pub(crate) fn rights_of(&self, conf: &Conf, q: &Quality, joins: &[Join]) -> Result<Vec<Right>, Fail> {
        let mut rights = vec![];
        for j in joins {
            let d = conf.source(&j.with).filter(|d| d["kind"] == "file");
            let Some(d) = d else {
                return Err(error(
                    400,
                    &format!("結合の相手（{}）がありません。「マスタ管理」の「データ元」で結合を直してください。", j.with),
                    Some("invalid"),
                    &[],
                ));
            };
            let dk = text(&d["key"]);
            let rp = self.raw_plan(conf, q, &dk)?;
            let path = rp.path.clone().unwrap_or_default();
            let table = actual_table(&path, &rp.table, &dk).map_err(|e| error(503, &e, None, &[]))?;
            rights.push(Right { path, table, name: text(&d["name"]) });
        }
        Ok(rights)
    }
}

// ------------------------------------------------------------------ スケジュール（版 3.96.0。Python の routes/schedule.py）
impl Lists {
    /// 問い合わせの設備（空なら最初の設備。Python の equip_of）
    fn sch_equip(cfg: &Cfg, equip: &str) -> Result<String, Fail> {
        let codes: Vec<&str> = cfg.equipments.iter().map(|e| e.code.as_str()).collect();
        if equip.is_empty() {
            return codes
                .first()
                .map(|c| c.to_string())
                .ok_or_else(|| error(400, "スケジュールの設備が決まっていません（参照先の「スケジュールの設備」）。", Some("unset"), &[]));
        }
        if equip == HOT_KEY {
            if cfg.hot.equipments.is_empty() {
                return Err(error(400, "HOT コイル作業順の設備が決まっていません。", Some("unset"), &[]));
            }
            return Ok(equip.into());
        }
        if !codes.contains(&equip) {
            return Err(error(400, &format!("未登録の設備です: {equip}"), Some("unset"), &[]));
        }
        Ok(equip.into())
    }

    /// スケジュールの段取り（Python の schedule_plan）。Ok(None) は窓が答えない形（Python に任せる）
    fn sch_plan(&self, conf: &Conf, q: &Quality, s: &Value, equip: &str, force: bool, joined: bool) -> Result<Option<Plan>, Fail> {
        let Some(Ok(cfg)) = conf.sched_cfg() else { return Ok(None) };
        let code = Self::sch_equip(&cfg, equip)?;
        if code == HOT_KEY {
            return self.hot_plan(conf, q, s, cfg, force);
        }
        let st = match self.sched.ensure(&cfg, &code, cfg.auto_refresh(), force) {
            Ok(st) => st,
            Err(crate::cm3::Fail::Cm3(e)) => {
                return Err(error(502, &format!("{code} の予定を CM3 から取れません: {e}"), Some("cm3"), &[]));
            }
            Err(crate::cm3::Fail::Python(_)) => return Ok(None),
        };
        if schedule::source_info_falls(&st) {
            return Ok(None);
        }
        let plan = Plan {
            mirror: None,
            path: st.path.clone(),
            table: schedule::TABLE.into(),
            page_size: num(&s["read"]["page_size"], 500.0) as i64,
            source: schedule::source_info(&cfg, &st, &code),
            equip: None,
            cand_key: text(&s["key"]),
            lot_col: Some(text(&s["lotSet"])).filter(|x| !x.is_empty()),
            joined: Value::Null,
            sched: Some(SchPlan { cfg, equip: code.clone(), state: st, states: vec![], hot: None }),
        };
        if !joined {
            return Ok(Some(plan));
        }
        let rs = self.sch_resolved(conf, q, s);
        self.with_joins(conf, q, plan, &rs, Some(&format!("sch_{}", schedule::safe(&code)))).map(Some)
    }

    /// 結合の仕掛の鍵の列を、仕掛の写しの実際の列に合わせる（Python の _resolved。写せていなければそのまま）
    fn sch_resolved(&self, conf: &Conf, q: &Quality, s: &Value) -> Value {
        let joins = s["joins"].as_array().cloned().unwrap_or_default();
        if !joins.iter().any(|j| j["with"] == "wip") {
            return s.clone();
        }
        let Ok(plan) = self.raw_plan(conf, q, "wip") else { return s.clone() };
        let path = plan.path.clone().unwrap_or_default();
        let Ok(t) = actual_table(&path, &plan.table, "wip") else { return s.clone() };
        let Ok(cols) = table_columns(&path, &t) else { return s.clone() };
        let auto = lotlist::lot_column(&cols, None);
        let mut out = s.clone();
        let new: Vec<Value> = joins
            .into_iter()
            .map(|mut j| {
                if j["with"] == "wip" {
                    if let Some(on) = j["on"].as_array() {
                        let on: Vec<Value> = on
                            .iter()
                            .map(|p| {
                                let (a, b) = (p[0].clone(), text(&p[1]));
                                let b = if cols.contains(&b) || auto.is_empty() { b } else { auto.clone() };
                                json!([a, b])
                            })
                            .collect();
                        j["on"] = Value::Array(on);
                    }
                }
                j
            })
            .collect();
        out["joins"] = Value::Array(new);
        out
    }

    /// HOT コイル作業順（Python の hot_plan）
    fn hot_plan(&self, conf: &Conf, q: &Quality, s: &Value, cfg: Cfg, force: bool) -> Result<Option<Plan>, Fail> {
        let got = self.sched.ensure_many(&cfg, &cfg.hot.equipments, cfg.auto_refresh(), force);
        if got.iter().any(|(_, r)| matches!(r, Err(crate::cm3::Fail::Python(_)))) {
            return Ok(None);
        }
        let rs = self.sch_resolved(conf, q, s);
        if Join::list(&rs["joins"]).is_empty() {
            return Err(error(
                400,
                "HOT コイル作業順は、スケジュールを仕掛と結合して使います（前工程・次の設備・釜番は仕掛の列）。「マスタ管理」の「データ元」で、スケジュールに仕掛の結合を足してください。",
                Some("join"),
                &[],
            ));
        }
        let (mut parts, mut errors, mut states) = (vec![], vec![], vec![]);
        for (code, r) in got {
            let st = match r {
                Ok(st) => st,
                Err(crate::cm3::Fail::Cm3(e)) => {
                    errors.push(format!("{code}: {e}"));
                    continue;
                }
                Err(crate::cm3::Fail::Python(_)) => return Ok(None),
            };
            if schedule::source_info_falls(&st) {
                return Ok(None);
            }
            let base = Plan {
                mirror: None,
                path: st.path.clone(),
                table: schedule::TABLE.into(),
                page_size: 0,
                source: Value::Null,
                equip: None,
                cand_key: text(&s["key"]),
                lot_col: None,
                joined: Value::Null,
                sched: None,
            };
            let p = self.with_joins(conf, q, base, &rs, Some(&format!("sch_{}", schedule::safe(&code))))?;
            parts.push((code.clone(), p.path.unwrap_or_default(), p.table));
            states.push((code, st));
        }
        if parts.is_empty() {
            let msg = if errors.is_empty() { "HOT の設備の予定を取れません。".to_string() } else { errors.join(" / ") };
            return Err(error(502, &msg, Some("cm3"), &[]));
        }
        let Ok((path, info)) = self.sched.build_hot(&cfg, &parts, &errors) else { return Ok(None) };
        let hot = self.sched.peek(HOT_KEY);
        let ats: Vec<f64> =
            states.iter().filter_map(|(k, st)| schedule::source_info(&cfg, st, k)["at"].as_f64()).filter(|x| *x != 0.0).collect();
        let mut src = schedule::source_info(&cfg, &St { data: Some(json!({})), error: errors.join(" / "), ..hot.clone() }, HOT_KEY);
        src["at"] = ats.into_iter().reduce(f64::max).map(|x| json!(x)).unwrap_or(Value::Null);
        Ok(Some(Plan {
            mirror: None,
            path: Some(path),
            table: schedule::HOT_TABLE.into(),
            page_size: num(&s["read"]["page_size"], 500.0) as i64,
            source: src,
            equip: None,
            cand_key: text(&s["key"]),
            lot_col: Some(text(&s["lotSet"])).filter(|x| !x.is_empty()),
            joined: Value::Null,
            sched: Some(SchPlan { cfg, equip: HOT_KEY.into(), state: hot, states, hot: Some(info) }),
        }))
    }

    /// 一覧の答えに添える数（設備の札・HOT の札。Python の schedule_extra）。窓が同じに組めなければ None
    pub fn sch_extra(&self, plan: &Plan) -> Option<Value> {
        let sp = plan.sched.as_ref()?;
        if sp.equip == HOT_KEY {
            let mut per = serde_json::Map::new();
            for (k, st) in &sp.states {
                per.insert(k.clone(), schedule::summary(st, None));
            }
            return Some(json!({"equip": HOT_KEY, "hot": sp.hot, "perEquipment": per}));
        }
        let stats = plan.joined.as_array().cloned().unwrap_or_default();
        let wip = stats.iter().find(|x| x["with"] == "wip");
        let joined = wip.or(stats.first()).filter(|j| j.as_object().is_some_and(|o| !o.is_empty()));
        let mut sm = schedule::summary(&sp.state, joined);
        sm["missLots"] = match wip {
            Some(w) => {
                let cols: Vec<String> = w["columns"].as_array()?.iter().map(text).collect();
                Value::Array(schedule::missing_lots(plan.path.as_ref()?, &plan.table, &cols).ok()??)
            }
            None => json!([]),
        };
        Some(json!({"equip": sp.equip, "summary": sm, "viewUrl": schedule::view_url(&sp.cfg, &sp.equip), "joined": wip.is_some()}))
    }

    /// データの時刻（GET /api/src/<スケジュール>/source。Python の schedule_source）: 古くなった設備は裏で取り直す（答えは待たない）。
    /// 窓が答えない形（設定を組めない・係を降りた設備がある）は None
    pub fn sch_source(&self, conf: &Conf, equip: &str) -> Option<(u16, Value)> {
        let Ok(cfg) = conf.sched_cfg()? else { return None };
        let code = match Self::sch_equip(&cfg, equip) {
            Ok(c) => c,
            Err(f) => return Some(f),
        };
        let codes: Vec<String> = if code == HOT_KEY { cfg.hot.equipments.clone() } else { vec![code.clone()] };
        if codes.iter().any(|c| self.sched.resigned(&cfg, c)) {
            return None;
        }
        self.sched.refresh_later(&cfg, &codes);
        let sts: Vec<St> = codes.iter().map(|c| self.sched.shared(c)).collect();
        if sts.iter().any(schedule::source_info_falls) {
            return None;
        }
        let infos: Vec<Value> = codes.iter().zip(&sts).map(|(k, st)| schedule::source_info(&cfg, st, k)).collect();
        if code != HOT_KEY {
            return Some((200, infos[0].clone()));
        }
        let mut v = infos[0].clone();
        let fmax = |k: &str| infos.iter().filter_map(|i| i[k].as_f64()).filter(|x| *x != 0.0).reduce(f64::max);
        v["remote"] = json!(cfg.base_text());
        v["at"] = fmax("at").map(|x| json!(x)).unwrap_or(Value::Null);
        let changed: Vec<f64> = infos.iter().filter_map(|i| i["copiedAt"].as_f64()).filter(|x| *x != 0.0).collect();
        v["copiedAt"] = changed.into_iter().reduce(f64::max).map(|x| json!(x)).unwrap_or(Value::Null);
        v["mirrored"] = json!(infos.iter().all(|i| i["mirrored"] == true));
        v["unreachable"] = json!(infos.iter().any(|i| i["unreachable"] == true));
        v["reason"] = json!(codes
            .iter()
            .zip(&infos)
            .filter(|(_, i)| i["reason"].as_str().is_some_and(|r| !r.is_empty()))
            .map(|(k, i)| format!("{k}: {}", text(&i["reason"])))
            .collect::<Vec<_>>()
            .join(" / "));
        Some((200, v))
    }

    /// 今すぐ取り直す（POST /api/src/<スケジュール>/refresh。Python の src_refresh の cm3）
    pub fn sch_refresh(&self, conf: &Conf, q: &Quality, key: &str, equip: &str) -> Option<(u16, Value)> {
        let s = conf.source(key)?.clone();
        match self.sch_plan(conf, q, &s, equip, true, false) {
            Ok(None) => None,
            Ok(Some(p)) => Some((200, json!({"result": {"copied": true}, "source": p.source}))),
            Err(f) => Some(f),
        }
    }
}

/// 表の列（同じ名前は 1 つ。Python の lot_list.columns）
fn table_columns(path: &Path, table: &str) -> Result<Vec<String>, String> {
    let c = lotlist::connect_ro(path)?;
    let st = c.prepare(&format!("SELECT * FROM {} LIMIT 0", lotlist::qi(table))).map_err(|e| e.to_string())?;
    let mut out: Vec<String> = vec![];
    for n in st.column_names() {
        if !out.iter().any(|x| x == n) {
            out.push(n.to_string());
        }
    }
    Ok(out)
}

/// 写しの中で実際に読む表の名前（設定の表 → 候補 → 最初の表。Python の sources.actual_table）
pub(crate) fn actual_table(path: &Path, preferred: &str, key: &str) -> Result<String, String> {
    let c = lotlist::connect_ro(path)?;
    let names = lotlist::tables(&c)?;
    Ok(lotlist::pick_table(&names, preferred, if key == "work" { WORK_TABLES } else { TABLE_CANDIDATES }))
}

#[cfg(test)]
mod tests {

    #[test]
    fn same_fid_follows_the_shared_cases() {
        // 版 3.91.0: Python の work_log.same_fid と同じ事例の表（program/tests/fixtures/fid_cases.json）
        let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixtures/fid_cases.json");
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap();
        for c in v["cases"].as_array().unwrap() {
            let (a, b, want) = (c[0].as_str().unwrap(), c[1].as_str().unwrap(), c[2].as_bool().unwrap());
            assert_eq!(super::same_fid(a, b), want, "{a} / {b}");
        }
    }

    use super::*;

    #[test]
    fn folder_rules_like_python() {
        assert!(split_pattern("実績_*.sqlite3").is_ok() && split_pattern("実績.sqlite3").is_err() && split_pattern("**").is_err());
        assert!(
            equipment_of("実績_CR1.sqlite3", "実績_", ".sqlite3").is_some()
                && equipment_of("実績_cr1.SQLITE3", "実績_", ".sqlite3").is_some()
        );
        assert!(
            equipment_of("実績_.sqlite3", "実績_", ".sqlite3").is_none() && equipment_of("実績_ .sqlite3", "実績_", ".sqlite3").is_none(),
            "設備名が空"
        );
        assert!(is_side_file(".x.incoming") && is_side_file("実績_A.sqlite3-wal") && is_side_file("実績_A.pending_2026"));
        assert!(same_fid("65024:11", "65024:11") && same_fid("4294967297:7:100", "1:7") && !same_fid("1:7:100", "1:7:200"));
        assert!(!same_fid("", "") && !same_fid("1:2", "1:3"));
        let dir = std::env::temp_dir().join(format!("da-lists-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for n in ["実績_B.sqlite3", "実績_a.sqlite3", ".実績_C.sqlite3.1.incoming", "メモ.txt"] {
            std::fs::write(dir.join(n), b"x").unwrap();
        }
        let f = scan(&format!("\"{}\"", dir.display()), "実績_*.sqlite3").unwrap();
        assert_eq!(f.iter().map(|x| x.file.as_str()).collect::<Vec<_>>(), ["実績_a.sqlite3", "実績_B.sqlite3"], "名前の順・作業用は除く");
        let row = json!({"ファイル名": "実績_Old.sqlite3", "ファイルID": f[1].fid});
        assert_eq!(resolve(&row, &dir.display().to_string(), &f), Some(dir.join("実績_B.sqlite3")), "名前が変わったら同じファイルID");
        assert!(scan("", "実績_*.sqlite3").unwrap_err().contains("フォルダが決まっていません"));
        assert!(scan(&dir.join("無い").display().to_string(), "実績_*.sqlite3")
            .unwrap_err()
            .starts_with("作業実績のフォルダに届きません（"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
