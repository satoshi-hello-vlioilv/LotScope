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
    /// 品質の写しの係（動いていれば。場所が今の並びと違う・まだ無ければ、写さずに台帳から読む係を作る）
    pub lot: Option<Arc<DbMirror>>,
    /// 品質の写しの置き場（db_cache）
    pub cache: PathBuf,
    /// データ元の写しの係（窓が開いた物だけ）
    pub src: &'a Mirrors,
    /// 結合した答えの置き場（db_cache/joins）
    pub joins: PathBuf,
    /// スケジュールのカード（中身が起きていれば Python の答え。None なら起こした直後の形）
    pub card: &'a dyn Fn() -> Option<Value>,
}

/// 手元の写しの行の数（routes/sources.py の _rows_of。読めなければ null）
fn rows_of(m: Option<&Arc<DbMirror>>, d: &Map<String, Value>) -> Value {
    // 待たない（最初の周回の途中でも、見出しのタブを止めない。受け身の Python の read_path も待たない）
    let Some(path) = m.and_then(|m| m.read_path_wait(false)) else { return Value::Null };
    let tl = &tables()["sourcesList"];
    let cands: Vec<&str> =
        tl[if d["key"] == "lot" { "lotTables" } else { "srcTables" }].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    count(&path, d.get("table").and_then(Value::as_str).unwrap_or(""), &cands).map(Value::from).unwrap_or(Value::Null)
}

fn count(path: &Path, table: &str, cands: &[&str]) -> Option<i64> {
    let c =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX)
            .ok()?;
    c.busy_timeout(Duration::from_secs(2)).ok()?;
    let mut st =
        c.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").ok()?;
    let names: Vec<String> = st.query_map([], |r| r.get(0)).ok()?.filter_map(Result::ok).collect();
    let t = crate::lotlist::pick_table(&names, table, cands);
    if t.is_empty() {
        return None;
    }
    c.query_row(&format!("SELECT COUNT(*) FROM \"{}\"", t.replace('"', "\"\"")), [], |r| r.get(0)).ok()
}

/// Python の == （数は 1 と 1.0 を同じとみなす。真偽は数とは別に比べる: JSON の true と 1 は Python でも True == 1 だが、
/// 結合の決まりに真偽は入らない）
fn py_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| py_eq(p, q)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| py_eq(v, w))),
        _ => a == b,
    }
}

/// Python の `(v or 0)` を比べられる数（真偽・数）。比べられない（字・表）なら Err（Python は > で落ちる）
fn built_at(m: &Map<String, Value>) -> Result<f64, ()> {
    match m.get("builtAt") {
        None | Some(Value::Null) => Ok(0.0),
        Some(Value::Bool(b)) => Ok(f64::from(u8::from(*b))),
        Some(Value::Number(n)) => n.as_f64().ok_or(()),
        Some(Value::String(s)) if s.is_empty() => Ok(0.0),
        Some(Value::Array(a)) if a.is_empty() => Ok(0.0),
        Some(Value::Object(o)) if o.is_empty() => Ok(0.0),
        _ => Err(()),
    }
}

/// 最後に組んだ結合の覚え（data_join.Joiner.recent のファイルの読み方）。決まり items が今と同じ物のうち、いちばん新しい物。
/// Python が落ちる形（比べられない builtAt）は Err（窓は答えず Python に任せる）
fn recent(root: &Path, key: &str, items: &Value) -> Result<Option<Map<String, Value>>, ()> {
    let head = format!("{key}_");
    let mut best: Option<Map<String, Value>> = None;
    let Ok(dir) = std::fs::read_dir(root) else { return Ok(None) };
    for e in dir.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.starts_with(&head) || !name.ends_with(".json") {
            continue;
        }
        let Some(Value::Object(had)) = std::fs::read(e.path()).ok().and_then(|b| serde_json::from_slice(&b).ok()) else { continue };
        if !had.get("items").is_some_and(|i| py_eq(i, items)) {
            continue;
        }
        let newer = match &best {
            None => true,
            Some(b) => built_at(&had)? > built_at(b)?,
        };
        if newer {
            best = Some(had);
        }
    }
    Ok(best.map(|b| {
        ["stats", "builtAt", "seconds", "items"].iter().map(|k| (k.to_string(), b.get(*k).cloned().unwrap_or(Value::Null))).collect()
    }))
}

fn recent_either(root: &Path, d: &Map<String, Value>) -> Result<Option<Map<String, Value>>, ()> {
    let key = d["key"].as_str().unwrap_or("");
    let joins = &d["joins"];
    match recent(root, key, joins)? {
        Some(x) => Ok(Some(x)),
        None => recent(root, &format!("try-{key}"), joins),
    }
}

/// 覚えの stats（`got.get("stats") or []`）。並びでない真の値・表でない項目は Python が落ちる（Err）
fn stats_of(got: &Map<String, Value>) -> Result<Vec<Map<String, Value>>, ()> {
    match got.get("stats") {
        Some(Value::Array(a)) => a.iter().map(|x| x.as_object().cloned().ok_or(())).collect(),
        x if x.is_none_or(|v| !crate::bundle::py_truthy(v)) => Ok(vec![]),
        _ => Err(()),
    }
}

/// 結合の数（_join_stats）
fn join_stats(root: &Path, d: &Map<String, Value>) -> Result<Value, ()> {
    if d["joins"].as_array().is_none_or(Vec::is_empty) {
        return Ok(Value::Null);
    }
    let Some(got) = recent_either(root, d)? else { return Ok(Value::Null) };
    let stats = stats_of(&got)?;
    Ok(Value::Array(stats.iter().map(|x| json!({"hit": x.get("hit"), "rows": x.get("rows"), "miss": x.get("miss")})).collect()))
}

/// 結合した表の行の数（_view_rows）
fn view_rows(root: &Path, d: &Map<String, Value>) -> Result<Value, ()> {
    let Some(got) = recent_either(root, d)? else { return Ok(Value::Null) };
    Ok(stats_of(&got)?.last().and_then(|x| x.get("out")).cloned().unwrap_or(Value::Null))
}

/// GET /api/sources の答え。組めなければ None（Python に任せる）
pub fn answer(inp: &Inputs, me: &Value, store: &Store, live: &Live) -> Option<Value> {
    let parts = inp.sources_parts().ok()?;
    let by_key: Vec<(String, Map<String, Value>)> =
        parts.items.iter().map(|d| (d["key"].as_str().unwrap_or("").to_string(), d.clone())).collect();
    let mut items = vec![];
    let mut made: Vec<(String, Arc<DbMirror>)> = vec![];
    for mut d in parts.items {
        let k = d.get("base").and_then(Value::as_str).filter(|b| !b.is_empty()).unwrap_or(d["key"].as_str().unwrap_or("")).to_string();
        if d["kind"] == "cm3" {
            let card =
                (live.card)().filter(Value::is_object).unwrap_or_else(|| json!({"mirror": null, "equipCount": parts.schedule_equips}));
            for (ck, cv) in card.as_object().into_iter().flatten() {
                d.insert(ck.clone(), cv.clone());
            }
            d.insert("rows".into(), Value::Null);
            d.insert("joinStats".into(), Value::Null);
            items.push(Value::Object(d));
            continue;
        }
        let api = d["api"].as_str().unwrap_or("");
        // 元（結合した表は元の元）。同じキーの行が 2 つあれば最初の行（一覧を開く道 data_sources.find・lists.rs の conf.source と同じ）
        let base = by_key.iter().find(|(n, _)| *n == k).map(|(_, b)| b).unwrap_or(&d);
        let place = base["place"].as_str().unwrap_or("").to_string();
        let read = base["read"].clone();
        let (interval, stale) = (crate::lists::num(&read["refresh_seconds"], 60.0) as i64, crate::lists::num(&read["stale_hours"], 36.0));
        let m = if api.starts_with("/api/src/") || k == "lot" {
            if k == "lot" {
                // 動いている品質の写しの係は、場所が今の並びと同じときだけ（設定を覚える 10 秒の間に替わった場所と混ぜない）
                live.lot.clone().filter(|m| crate::mirror::same_place(&m.remote()) == crate::mirror::same_place(&place)).or_else(|| {
                    let m = DbMirror::new("lot_list", &place, &live.cache, interval, stale);
                    m.load_state();
                    Some(m)
                })
            } else {
                // 元（結合した表は元の元）の場所・間隔・古さのしきい（本当に開くときの lists.rs と同じ読み方）。場所の無い元は係を作らない
                // この答えの中で作った受け身の係も、同じファイルなら分け合う（Mirrors::get と同じ: 2 つの元が 1 つの写し）
                live.src.peek(&k).or_else(|| {
                    if place.is_empty() {
                        return None;
                    }
                    let same = crate::mirror::same_place(&place);
                    if let Some((_, m)) = made.iter().find(|(p, _)| *p == same) {
                        return Some(m.clone());
                    }
                    let m = live.src.peek_or_passive(&k, &place, interval, stale);
                    made.push((same, m.clone()));
                    Some(m)
                })
            }
        } else {
            None
        };
        let rows = if d["kind"] == "view" { view_rows(&live.joins, &d).ok()? } else { rows_of(m.as_ref(), &d) };
        d.insert("mirror".into(), m.as_ref().map(|m| m.source_info()).unwrap_or(Value::Null));
        d.insert("rows".into(), rows);
        d.insert("joinStats".into(), join_stats(&live.joins, &d).ok()?);
        items.push(Value::Object(d));
    }
    let tl = &tables()["sourcesList"];
    Some(json!({"items": items, "others": parts.others, "othersCanEdit": crate::access::can_write(me, "path_settings"),
                "newConn": parts.new_conn, "roles": tl["roles"], "equipModes": tl["equipModes"],
                "canEdit": crate::access::can_write(me, "data_sources"), "shared": store.is_shared("data_sources"),
                "revision": store.revision("data_sources")}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joins_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("da-srclist-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn item(joins: Value) -> Map<String, Value> {
        json!({"key": "s1", "kind": "file", "joins": joins}).as_object().cloned().unwrap()
    }

    #[test]
    fn join_memos_are_read_like_python() {
        // 版 3.87.0 の作った後の採点の割れ: 決まりの比べ方は Python の ==（1 と 1.0 は同じ）・いちばん新しい物・try- は後
        let d = joins_dir("eq");
        let rule = json!([{"with": "wip", "how": "left", "on": [["a", "b"]], "cols": [], "n": 1}]);
        std::fs::write(
            d.join("s1_a.json"),
            json!({"items": [{"with": "wip", "how": "left", "on": [["a", "b"]], "cols": [], "n": 1.0}],
            "builtAt": 5, "stats": [{"hit": 1, "rows": 2, "miss": 1, "out": 2}]})
            .to_string(),
        )
        .unwrap();
        std::fs::write(
            d.join("s1_b.json"),
            json!({"items": rule, "builtAt": 9.5, "stats": [{"hit": 2, "rows": 2, "miss": 0, "out": 7}]}).to_string(),
        )
        .unwrap();
        std::fs::write(d.join("s1_c.json"), json!({"items": [], "builtAt": 99, "stats": [{"hit": 9}]}).to_string()).unwrap();
        std::fs::write(d.join("try-s1_d.json"), json!({"items": rule, "builtAt": 100, "stats": [{"hit": 5}]}).to_string()).unwrap();
        let it = item(rule.clone());
        assert_eq!(join_stats(&d, &it), Ok(json!([{"hit": 2, "rows": 2, "miss": 0}])), "今の決まりのいちばん新しい物（try- より先）");
        assert_eq!(view_rows(&d, &it), Ok(json!(7)));
        let _ = std::fs::remove_file(d.join("s1_b.json"));
        assert_eq!(join_stats(&d, &it), Ok(json!([{"hit": 1, "rows": 2, "miss": 1}])), "1.0 と 1 は同じ決まり");
        // try- だけ・決まりが無い元
        let _ = std::fs::remove_file(d.join("s1_a.json"));
        assert_eq!(join_stats(&d, &it), Ok(json!([{"hit": 5, "rows": null, "miss": null}])));
        assert_eq!(join_stats(&d, &item(json!([]))), Ok(Value::Null));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn python_crashes_are_left_to_python() {
        // Python が落ちる（500）形は窓も答えない（Err → GET /api/sources を Python に任せる）
        let rule = json!([{"with": "wip", "how": "left", "on": [], "cols": []}]);
        let it = item(rule.clone());
        for (name, files) in [
            ("at", vec![json!({"items": rule, "builtAt": "x", "stats": []}), json!({"items": rule, "builtAt": 1, "stats": []})]),
            ("dict", vec![json!({"items": rule, "builtAt": 1, "stats": {"a": 1}})]),
            ("item", vec![json!({"items": rule, "builtAt": 1, "stats": [1]})]),
        ] {
            let d = joins_dir(name);
            for (i, f) in files.iter().enumerate() {
                std::fs::write(d.join(format!("s1_{i}.json")), f.to_string()).unwrap();
            }
            assert!(join_stats(&d, &it).is_err() || view_rows(&d, &it).is_err(), "{name}");
            let _ = std::fs::remove_dir_all(&d);
        }
        // 1 つだけなら比べないので、字の builtAt でも Python は落ちない
        let d = joins_dir("one");
        std::fs::write(d.join("s1_0.json"), json!({"items": rule, "builtAt": "x", "stats": []}).to_string()).unwrap();
        assert_eq!(join_stats(&d, &it), Ok(json!([])));
        let _ = std::fs::remove_dir_all(&d);
    }
}
