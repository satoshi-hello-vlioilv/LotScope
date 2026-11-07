//! データ元の並び（GET /api/sources。routes/sources.py の sources_list）を窓が答える（版 3.87.0）。
//!
//! マスタと設定から決まる部分（並び・接続の設定・参照先の項目の答え）は bundle.rs の `Inputs::sources_parts`。ここは動く部分:
//! - 写しの様子（mirror）: 品質は窓の写しの係・ほかの元は窓の写しの係（まだ開いていない元も、写さずに台帳から様子を読む。
//!   Python の `_mirrors().peek` はそのプロセスが開いた元だけで、ほかは null だった。窓はより多く答える）
//! - 行の数（rows）: 手元の写しの COUNT(*)（待たない）。結合した表は最後に組んだ答えの行の数
//! - 結合の数（joinStats）: db_cache/joins の答えの覚え（Python の Joiner.recent のファイルの読み方と同じ。`<キー>_*.json` → `try-<キー>_*.json`）
//! - スケジュールのカード: Python の Schedules の覚え（プロセスのメモリだけ）。中身が起きていれば尋ね、起きていなければ
//!   Python を起こした直後と同じ `{mirror: null, equipCount}`
//!
//! 書けるか（canEdit・othersCanEdit）は窓の me、共有か・版（shared・revision）は窓のマスタの置き場の係から。

use crate::bundle::{tables, Inputs};
use crate::master_store::Store;
use crate::mirror::{DbMirror, Mirrors};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// 動く部分の材料
pub struct Live<'a> {
    /// 品質の写しの係（無ければ null）
    pub lot: Option<Arc<DbMirror>>,
    /// データ元の写しの係（窓が開いた物だけ）
    pub src: &'a Mirrors,
    /// 結合した答えの置き場（db_cache/joins）
    pub joins: PathBuf,
    /// スケジュールのカード（中身が起きていれば Python の答え。None なら起こした直後の形）
    pub card: &'a dyn Fn() -> Option<Value>,
}

/// 手元の写しの行の数（routes/sources.py の _rows_of。読めなければ null）
fn rows_of(m: Option<&Arc<DbMirror>>, d: &Map<String, Value>) -> Value {
    let Some(path) = m.and_then(|m| m.read_path()) else { return Value::Null };
    let tl = &tables()["sourcesList"];
    let cands: Vec<&str> = tl[if d["key"] == "lot" { "lotTables" } else { "srcTables" }]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    count(&path, d.get("table").and_then(Value::as_str).unwrap_or(""), &cands).map(Value::from).unwrap_or(Value::Null)
}

fn count(path: &Path, table: &str, cands: &[&str]) -> Option<i64> {
    let c = rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .ok()?;
    c.busy_timeout(Duration::from_secs(2)).ok()?;
    let mut st = c
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .ok()?;
    let names: Vec<String> = st.query_map([], |r| r.get(0)).ok()?.filter_map(Result::ok).collect();
    let t = crate::lotlist::pick_table(&names, table, cands);
    if t.is_empty() {
        return None;
    }
    c.query_row(&format!("SELECT COUNT(*) FROM \"{}\"", t.replace('"', "\"\"")), [], |r| r.get(0)).ok()
}

/// 最後に組んだ結合の覚え（data_join.Joiner.recent のファイルの読み方）。決まり items が今と同じ物のうち、いちばん新しい物
fn recent(root: &Path, key: &str, items: &Value) -> Option<Map<String, Value>> {
    let head = format!("{key}_");
    let mut best: Option<Map<String, Value>> = None;
    for e in std::fs::read_dir(root).ok()?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.starts_with(&head) || !name.ends_with(".json") {
            continue;
        }
        let Some(Value::Object(had)) = std::fs::read(e.path()).ok().and_then(|b| serde_json::from_slice(&b).ok()) else { continue };
        let at = |m: &Map<String, Value>| m.get("builtAt").and_then(Value::as_f64).unwrap_or(0.0);
        if had.get("items") == Some(items) && best.as_ref().is_none_or(|b| at(&had) > at(b)) {
            best = Some(had);
        }
    }
    best.map(|b| ["stats", "builtAt", "seconds", "items"].iter().map(|k| (k.to_string(), b.get(*k).cloned().unwrap_or(Value::Null))).collect())
}

fn recent_either(root: &Path, d: &Map<String, Value>) -> Option<Map<String, Value>> {
    let key = d["key"].as_str().unwrap_or("");
    let joins = &d["joins"];
    recent(root, key, joins).or_else(|| recent(root, &format!("try-{key}"), joins))
}

/// 結合の数（_join_stats）
fn join_stats(root: &Path, d: &Map<String, Value>) -> Value {
    if d["joins"].as_array().is_none_or(Vec::is_empty) {
        return Value::Null;
    }
    let Some(got) = recent_either(root, d) else { return Value::Null };
    let stats = got.get("stats").and_then(Value::as_array).cloned().unwrap_or_default();
    Value::Array(stats.iter().map(|x| json!({"hit": x.get("hit"), "rows": x.get("rows"), "miss": x.get("miss")})).collect())
}

/// 結合した表の行の数（_view_rows）
fn view_rows(root: &Path, d: &Map<String, Value>) -> Value {
    let got = recent_either(root, d);
    let st = got.as_ref().and_then(|g| g.get("stats")).and_then(Value::as_array).cloned().unwrap_or_default();
    st.last().and_then(|x| x.get("out")).cloned().unwrap_or(Value::Null)
}

/// GET /api/sources の答え。組めなければ None（Python に任せる）
pub fn answer(inp: &Inputs, me: &Value, store: &Store, live: &Live) -> Option<Value> {
    let parts = inp.sources_parts().ok()?;
    let by_key: Vec<(String, Map<String, Value>)> =
        parts.items.iter().map(|d| (d["key"].as_str().unwrap_or("").to_string(), d.clone())).collect();
    let mut items = vec![];
    for mut d in parts.items {
        let k = d.get("base").and_then(Value::as_str).filter(|b| !b.is_empty()).unwrap_or(d["key"].as_str().unwrap_or("")).to_string();
        if d["kind"] == "cm3" {
            let card = (live.card)().filter(Value::is_object).unwrap_or_else(|| json!({"mirror": null, "equipCount": parts.schedule_equips}));
            for (ck, cv) in card.as_object().into_iter().flatten() {
                d.insert(ck.clone(), cv.clone());
            }
            d.insert("rows".into(), Value::Null);
            d.insert("joinStats".into(), Value::Null);
            items.push(Value::Object(d));
            continue;
        }
        let api = d["api"].as_str().unwrap_or("");
        let m = if api.starts_with("/api/src/") || k == "lot" {
            if k == "lot" {
                live.lot.clone()
            } else {
                // 元（結合した表は元の元）の場所・間隔・古さのしきい。場所の無い元は写しの係を作らない
                let base = by_key.iter().rev().find(|(n, _)| *n == k).map(|(_, b)| b).unwrap_or(&d);
                let place = base["place"].as_str().unwrap_or("");
                let read = &base["read"];
                let interval = read["refresh_seconds"].as_f64().unwrap_or(60.0) as i64;
                let stale = read["stale_hours"].as_f64().unwrap_or(36.0);
                live.src.peek(&k).or_else(|| (!place.is_empty()).then(|| live.src.peek_or_passive(&k, place, interval, stale)))
            }
        } else {
            None
        };
        let rows = if d["kind"] == "view" { view_rows(&live.joins, &d) } else { rows_of(m.as_ref(), &d) };
        d.insert("mirror".into(), m.as_ref().map(|m| m.source_info()).unwrap_or(Value::Null));
        d.insert("rows".into(), rows);
        d.insert("joinStats".into(), join_stats(&live.joins, &d));
        items.push(Value::Object(d));
    }
    let tl = &tables()["sourcesList"];
    Some(json!({"items": items, "others": parts.others, "othersCanEdit": crate::access::can_write(me, "path_settings"),
                "newConn": parts.new_conn, "roles": tl["roles"], "equipModes": tl["equipModes"],
                "canEdit": crate::access::can_write(me, "data_sources"), "shared": store.is_shared("data_sources"),
                "revision": store.revision("data_sources")}))
}
