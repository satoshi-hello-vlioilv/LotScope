//! 一覧の段取り（版 3.60.0。Python の routes/worklog.py の worklog_plan・routes/sources.py の src_plan / raw_plan / with_joins・
//! routes/lotlist.py の lotlist_plan を移した）。どのファイルを・どの表で・どの決まりで引くかを決め、品質・作業実績・データ元の
//! 一覧とスライサーに窓（Rust）が答える。答え・失敗の言葉は Python と同じ（desktop/tests/lists_parity.rs・lot.rs の試験）。
//!
//! - 材料（データ元の定義・作業実績の登録・勤務体系・出さないタブ）は Python の設定の答え（/api/lotlist/settings の lists）。
//!   マスタは共有のマスタにあるので読むのは Python、決めるのは Rust
//! - 作業実績のフォルダは窓が見る（10 秒覚える）。名前が変わったファイルは、同じファイルID の物をたどる（work_log.match と同じ決まり）
//! - 写しは窓の写しの係（mirror::Mirrors）。結合は src/join.rs
//! - スケジュール（CM3）は Python のまま（None を返して Python へ回す）

use crate::join::{Join, JoinError, Joiner, Right};
use crate::lotlist::{self, Opts, TABLE_CANDIDATES, WORK_TABLES};
use crate::mirror::{DbMirror, Mirrors};
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
    s.trim().trim_matches('"').to_string()
}

// ------------------------------------------------------------------ 作業実績のフォルダ（Python の work_log.scan・match・resolve）
#[derive(Debug, Clone)]
pub struct Found {
    pub file: String,
    pub fid: String,
}

/// 「実績_*.sqlite3」→ ("実績_", ".sqlite3")。* はちょうど 1 つ
pub fn split_pattern(pattern: &str) -> Result<(String, String), String> {
    let p = pattern.trim();
    if p.matches('*').count() != 1 {
        return Err(format!("ファイル名の決まり「{p}」には、設備名の所に * をちょうど 1 つ書いてください（例: 実績_*.sqlite3）。"));
    }
    let (h, t) = p.split_once('*').unwrap();
    Ok((h.into(), t.into()))
}

/// ファイル名が決まりに合うか（* の所＝設備名が空でない。大文字・小文字は区別しない）
fn fits(name: &str, head: &str, tail: &str) -> bool {
    let (low, h, t) = (name.to_lowercase(), head.to_lowercase(), tail.to_lowercase());
    let n = name.chars().count();
    if n <= head.chars().count() + tail.chars().count() || !low.starts_with(&h) || !low.ends_with(&t) {
        return false;
    }
    let mid: String = name.chars().skip(head.chars().count()).take(n - head.chars().count() - tail.chars().count()).collect();
    !crate::pyfmt::strip(&mid).is_empty()
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
    let p = |s: &str| s.split(':').map(|x| x.parse::<u128>().ok()).collect::<Vec<_>>();
    let (x, y) = (p(a), p(b));
    if x.len() < 2 || y.len() < 2 || x.iter().chain(&y).any(Option::is_none) {
        return false;
    }
    let low = |v: &Option<u128>| v.unwrap() & 0xFFFF_FFFF;
    low(&x[0]) == low(&y[0]) && x[1] == y[1] && (x.len() < 3 || y.len() < 3 || x[2] == y[2])
}

/// フォルダの中で決まりに合うファイル（名前の順）。届かなければ理由
pub fn scan(folder: &str, pattern: &str) -> Result<Vec<Found>, String> {
    let folder = unquote_path(folder);
    if folder.is_empty() {
        return Err("作業実績のフォルダが決まっていません。「マスタ管理」の「データ元」の「実績」でフォルダを入れてください。".into());
    }
    let (head, tail) = split_pattern(pattern)?;
    let rd = std::fs::read_dir(&folder).map_err(|e| {
        let why = e.to_string();
        let why = why.split(" (os error").next().unwrap_or(&why).to_string();
        format!("作業実績のフォルダに届きません（{why}）: {folder}")
    })?;
    let mut out = vec![];
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if is_side_file(&name) || !fits(&name, &head, &tail) {
            continue;
        }
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) && !e.path().is_file() {
            continue;
        }
        out.push(Found { fid: file_id(&e.path()), file: name });
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
            listing: Mutex::default(),
            list_ttl: LIST_TTL,
        }
    }

    /// 受け身の Python からの「写して」（{prefix, key, remote, interval, stale}）
    pub fn notice(&self, v: &Value) {
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

    /// フォルダで見つけたファイル（10 秒覚える）
    fn found(&self, folder: &str, pattern: &str) -> Result<Vec<Found>, String> {
        let key = (unquote_path(folder), pattern.to_string());
        if let Some((at, r)) = self.listing.lock().unwrap().get(&key) {
            if at.elapsed() < self.list_ttl {
                return r.clone();
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
        };
        match (joined && plan.path.is_some(), conf.source("work")) {
            (true, Some(s)) => self.with_joins(conf, q, plan, s, Some(&format!("work-{key}"))),
            _ => Ok(plan),
        }
    }

    /// データ元（/api/src/<キー>）の段取り（Python の src_plan）。Ok(None) はスケジュール（Python が答える）
    pub fn src_plan(&self, conf: &Conf, q: &Quality, key: &str, need_copy: bool, joined: bool) -> Result<Option<Plan>, Fail> {
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
            Some("cm3") => return Ok(None),
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
                if conf.source(&base).is_some_and(|b| b["kind"] == "cm3") {
                    return Ok(None); // スケジュールを元にした結合した表は Python が答える
                }
                let mut plan = self.raw_plan(conf, q, &base)?;
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
        };
        if joined && plan.path.is_some() {
            self.with_joins(conf, q, plan, s, None).map(Some)
        } else {
            Ok(Some(plan))
        }
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
        let joins = Join::list(&s["joins"]);
        if joins.is_empty() {
            return Ok(plan);
        }
        let mut rights = vec![];
        for j in &joins {
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
        let base = plan.path.clone().unwrap_or_default();
        let ck = if !plan.cand_key.is_empty() { plan.cand_key.clone() } else { text(&s["key"]) };
        let table = actual_table(&base, &plan.table, &ck).map_err(|e| error(503, &e, None, &[]))?;
        let name = text(&s["name"]);
        let key = scope.map(str::to_string).unwrap_or_else(|| text(&s["key"]));
        match self.joiner.path_for(&key, &base, &table, &joins, &rights) {
            Ok((path, _)) => Ok(Plan { path: Some(path), table, ..plan }),
            Err(e) => {
                let st = if matches!(e, JoinError::Rule(_)) { 400 } else { 503 };
                Err(error(st, &format!("「{name}」の結合を組めませんでした: {e}"), Some("join"), &[]))
            }
        }
    }
}

/// 写しの中で実際に読む表の名前（設定の表 → 候補 → 最初の表。Python の sources.actual_table）
fn actual_table(path: &Path, preferred: &str, key: &str) -> Result<String, String> {
    let c = lotlist::connect_ro(path)?;
    let names = lotlist::tables(&c)?;
    Ok(lotlist::pick_table(&names, preferred, if key == "work" { WORK_TABLES } else { TABLE_CANDIDATES }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_rules_like_python() {
        assert!(split_pattern("実績_*.sqlite3").is_ok() && split_pattern("実績.sqlite3").is_err() && split_pattern("**").is_err());
        assert!(fits("実績_CR1.sqlite3", "実績_", ".sqlite3") && fits("実績_cr1.SQLITE3", "実績_", ".sqlite3"));
        assert!(!fits("実績_.sqlite3", "実績_", ".sqlite3") && !fits("実績_ .sqlite3", "実績_", ".sqlite3"), "設備名が空");
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
