//! 共有の書式の道（版 3.80.0）。Python の routes/formats.py の 4 本を窓が受ける:
//!
//! ```text
//! GET    /api/masters/formats        … 書式の一覧（?source= でその一覧の分だけ・名前の順）・この PC が書けるか・共有か・版
//! POST   /api/masters/formats        … 足す（201。{name, source, table, origin, note, body}）
//! PUT    /api/masters/formats/<id>   … 直す（名前・中身・備考だけ。本文 base_rev は開いたときの行の版）
//! DELETE /api/masters/formats/<id>   … 消す（?rev= は開いたときの行の版）
//! ```
//!
//! 決まりは services/display_formats.py と同じ（評価関数: tests/formats_parity.rs ← program/tests/formats_oracle.py）。書けるのは
//! 現場のマスタと同じ（門番 access::guard。呼ぶ側が通す）。中身は送った順のまま json.dumps(separators=(',', ':')) の字で置く
//! （送った順を保つ木 src/jsontree.rs）。名前は元ごとに 1 つ（名前の比べ方は access::py_key）。
//!
//! 窓が答えず Python に任せる形: 窓が読めない本文（master_rows::unreadable_u64_ok。u64 を超える整数など）・空の本文・表でない真の本文・
//! 本文の name・table・origin・note が並び・表（Python の str() の repr の字。小数と u64 の整数は版 3.105.0 から窓が答える）・中身を字で送り、その字を窓が Python と同じに読めない（text_split）・置き場の行の形が違う
//! （中身の部品の形・字でない項目）・道の id が ASCII の数字でない。

use crate::jsontree::Tree;
use crate::master_rows::{self, base_rev, Spec};
use crate::master_store::{MasterError, Store};
use crate::worksum::{py_str, truthy};
use serde_json::{json, Map, Value};

pub const NAME: &str = "display_formats";
const FIELDS: [&str; 6] = ["名前", "元", "表", "作った所", "中身", "備考"];
const SPEC: Spec = Spec { name: NAME, fields: &FIELDS, unique: None, renamed: &[] };
const NAME_MAX: usize = 40;
const MAX_BYTES: usize = 512 * 1024;
/// 中身の部品（display_formats.PARTS: 鍵・並びか表か・人の言葉。並びは表示順）
const PARTS: [(&str, bool, &str); 10] = [
    ("columns", false, "表示列"),
    ("rules", false, "読み替えルール"),
    ("arrange", false, "並び・まとめ"),
    ("sorts", true, "並べ替え"),
    ("filters", true, "条件"),
    ("presets", true, "登録した条件"),
    ("views", true, "保存した見方"),
    ("slicer", false, "スライサー"),
    ("marks", true, "色付け"),
    ("adhoc", false, "列で絞り込む"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    List,
    Create,
    Update(i64),
    Delete(i64),
}

pub fn route_of(method: &str, path: &str) -> Option<Route> {
    let rest = path.strip_prefix("/api/masters/formats")?;
    match (method, rest) {
        ("GET", "") => Some(Route::List),
        ("POST", "") => Some(Route::Create),
        (m @ ("PUT" | "DELETE"), r) => {
            let id = r.strip_prefix('/')?;
            // Python の <int:…>（\d+: 全角・アラビア文字などの数字も）。i64 に入らない id は Python に任せる（版 3.104.0）
            let id: i64 = crate::pyfmt::path_int(id)?;
            Some(if m == "PUT" { Route::Update(id) } else { Route::Delete(id) })
        }
        _ => None,
    }
}

type Answer = (u16, Value);

fn format_error(msg: impl Into<String>) -> Answer {
    (400, json!({"error": msg.into(), "kind": "error", "type": "FormatError"}))
}

fn part_ok(v: &Value, list: bool) -> bool {
    if list {
        v.is_array()
    } else {
        v.is_object()
    }
}

/// 中身（表）にある部品の名前（display_formats.parts_of。Python の真偽で見る）
fn parts_of(body: &Map<String, Value>) -> Vec<String> {
    let mut out = vec![];
    for (k, list, label) in PARTS {
        let Some(v) = body.get(k).filter(|v| truthy(v)) else { continue };
        let mut label = label.to_string();
        if k == "filters" || k == "sorts" {
            label = format!("{label} {}", v.as_array().map_or(0, Vec::len));
        } else if k == "slicer" {
            let cards = v.get("cards").and_then(Value::as_array);
            if cards.is_some_and(|c| c.iter().any(|c| c.get("sel").is_some_and(truthy))) {
                label = "スライサー（選んだ値）".into();
            }
        } else if k == "adhoc" {
            let set = match v.get("value") {
                Some(Value::String(s)) => !crate::pyfmt::strip(s).is_empty(),
                Some(x) => truthy(x),
                None => false,
            };
            if set {
                label = "列で絞り込む（値）".into();
            }
        }
        let _ = list;
        out.push(label);
    }
    out
}

/// マスタの行 → 画面の形（display_formats.view。中身が壊れていれば body は {}）
fn view(row: &Map<String, Value>) -> Value {
    let s = |k: &str| row.get(k).filter(|v| truthy(v)).cloned().unwrap_or(json!(""));
    let body = row
        .get("中身")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .and_then(|t| serde_json::from_str::<Value>(&master_rows::inner_text(t)).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    json!({"id": row.get("id").cloned().unwrap_or(Value::Null), "name": s("名前"), "source": s("元"), "table": s("表"),
           "origin": s("作った所"), "note": s("備考"), "rev": row.get("rev").cloned().unwrap_or(json!(1)),
           "updatedAt": s("updated_at"), "updatedBy": row.get("updated_by").filter(|v| truthy(v)).cloned().unwrap_or(json!({})),
           "parts": parts_of(&body), "body": body})
}

/// 置き場の行の中身の部品の形が違う理由（版 3.107.0。隔てる。Python の display_formats.row_problem と同じ）: 真の部品が決めた形
/// （並びか表）でない・スライサーの cards が並びでない・列で絞り込むの値が並び・表
pub fn row_problem(row: &Map<String, Value>) -> Option<String> {
    let t = row.get("中身").and_then(Value::as_str).filter(|t| !t.is_empty()).unwrap_or("{}");
    let Ok(Value::Object(b)) = serde_json::from_str::<Value>(&master_rows::inner_text(t)) else { return None };
    for (k, list, label) in PARTS {
        let Some(v) = b.get(k).filter(|v| truthy(v)) else { continue };
        let bad = !part_ok(v, list)
            || (k == "slicer" && v.get("cards").is_some_and(|c| truthy(c) && !c.is_array()))
            || (k == "adhoc" && v.get("value").is_some_and(|x| x.is_array() || x.is_object()));
        if bad {
            return Some(format!("中身の「{label}」の形が違います"));
        }
    }
    None
}

fn str_or_empty(v: Option<&Value>) -> String {
    match v {
        Some(x) if truthy(x) => py_str(x),
        _ => String::new(),
    }
}

/// 中身 → 置く字（display_formats.clean_body。送った順のまま・知らない部品と形の違う部品は外す）。Ok(None) は Python に任せる
fn clean_body(body: Option<&Tree>) -> Result<Option<String>, String> {
    let parsed;
    let body = match body {
        Some(Tree::Str(t)) => {
            if master_rows::text_split_py(t) {
                return Ok(None);
            }
            parsed = Tree::parse(&master_rows::inner_text(t)).ok_or("書式の中身が JSON ではありません。")?;
            &parsed
        }
        Some(b) => b,
        None => &Tree::Null,
    };
    let Tree::Obj(m) = body else { return Err("書式の中身の形が違います（{部品: 中身}）。".into()) };
    let out: Vec<(String, Tree)> = m
        .iter()
        .filter(|(k, v)| PARTS.iter().any(|(p, list, _)| p == k && matches!((list, v), (true, Tree::Arr(_)) | (false, Tree::Obj(_)))))
        .cloned()
        .collect();
    if out.is_empty() {
        return Err("書式に入れる表示ルールがありません（表示列・並び・条件などを整えてから保存してください）。".into());
    }
    let text = Tree::Obj(out).dumps(",", ":");
    if text.len() > MAX_BYTES {
        return Err(format!("書式が大きすぎます（{} KB まで）。", MAX_BYTES / 1024));
    }
    Ok(Some(text))
}

/// 画面から来た値 → マスタの行（display_formats.clean_row）。Ok(None) は Python に任せる
fn clean_row(d: &Map<String, Value>, tree: &Tree, partial: bool) -> Result<Option<Map<String, Value>>, String> {
    let mut out = Map::new();
    if !partial || d.contains_key("name") {
        let name = crate::pyfmt::strip(&str_or_empty(d.get("name"))).to_string();
        if name.is_empty() {
            return Err("書式の名前を入れてください。".into());
        }
        if name.chars().count() > NAME_MAX {
            return Err(format!("書式の名前は {NAME_MAX} 字までです。"));
        }
        out.insert("名前".into(), json!(name));
    }
    if !partial {
        let src = d.get("source").and_then(Value::as_str).filter(|s| crate::dashboard::is_screen_source(s));
        let Some(src) = src else { return Err("どの一覧の書式か（source: lot・work・src:<キー>）が違います。".into()) };
        out.insert("元".into(), json!(src));
        out.insert("表".into(), json!(crate::pyfmt::strip(&str_or_empty(d.get("table")))));
        let origin = str_or_empty(d.get("origin"));
        out.insert("作った所".into(), json!(crate::pyfmt::strip(&origin).chars().take(80).collect::<String>()));
    }
    if !partial || d.contains_key("body") {
        match clean_body(tree.get("body"))? {
            Some(t) => out.insert("中身".into(), json!(t)),
            None => return Ok(None),
        };
    }
    if d.contains_key("note") {
        let note = str_or_empty(d.get("note"));
        out.insert("備考".into(), json!(crate::pyfmt::strip(&note).chars().take(200).collect::<String>()));
    }
    Ok(Some(out))
}

/// 名前は元ごとに 1 つ（master_repository._check_row の display_formats。比べ方は access::py_key・言葉は送った名前）
fn check(rows: &[Value], data: &Map<String, Value>, self_id: Option<i64>) -> Result<(), MasterError> {
    let key = (crate::access::normalize_part(data.get("名前")), data.get("元").cloned());
    for r in rows {
        let Some(o) = r.as_object() else { continue };
        if !master_rows::is_self(r, self_id) && (crate::access::normalize_part(o.get("名前")), o.get("元").cloned()) == key {
            return Err(MasterError::Duplicate(format!(
                "書式「{}」はもうあります。上書きするか、別の名前にしてください。",
                data.get("名前").map(py_str).unwrap_or_else(|| "None".into())
            )));
        }
    }
    Ok(())
}

/// 置き場から行を読んで答える（Lot::formats_route と試験 tests/formats_parity.rs の入口。門番は呼ぶ側）。窓が答えない形は None
pub fn answer(store: &Store, me: &Value, route: Route, query: &str, body: &[u8], place: &crate::access::Place) -> Option<Answer> {
    // 一覧は、共有にまだ無ければ Python の読みと同じく最初の版を置いてから読む（版 3.105.0。置けなければ前どおり任せる）
    if place.split_file(NAME) || (route == Route::List && !store.seed_absent(&[NAME])) {
        return None;
    }
    // 置き場の読めない行は隔てる（版 3.107.0。中身の部品の形は row_problem で。前は任せた）。中身の字に i64 に入らない整数（H2）はまだ任せる
    let mut all = place.rows_all(NAME).ok()?;
    master_rows::normalize_all(&mut all, &SPEC);
    if crate::row_check::wide_content(NAME, &all) {
        return None;
    }
    let iso = crate::row_check::check(NAME, &all, &FIELDS);
    let rows: Vec<Value> = crate::row_check::good(NAME, &all, &iso);
    if route == Route::List {
        let q = crate::lotlist::parse_query(query);
        let src = q.iter().find(|(k, _)| k == "source").map(|(_, v)| v.clone()).unwrap_or_default();
        if !src.is_empty() && !crate::dashboard::is_screen_source(&src) {
            return Some((400, json!({"error": "source は lot・work・src:<キー> のどれかです。"})));
        }
        let mut items: Vec<Value> = rows
            .iter()
            .filter_map(Value::as_object)
            .filter(|r| src.is_empty() || r.get("元").and_then(Value::as_str) == Some(src.as_str()))
            .map(view)
            .collect();
        items.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
        let mut out = json!({"items": items, "canEdit": crate::access::can_write(me, NAME), "shared": store.is_shared(NAME), "revision": store.revision(NAME)});
        crate::row_check::notes(out.as_object_mut().unwrap(), NAME, &all, &iso, place.share_problem(NAME));
        return Some((200, out));
    }
    if master_rows::unreadable_u64_ok(body) {
        return None;
    }
    let blank = body.iter().all(|b| b.is_ascii_whitespace());
    if blank && !matches!(route, Route::Delete(_)) {
        return None; // 足す・直す道の get_json(force=True) は空の本文で BadRequest（道の外。窓は答えない）。消す道は版を読むだけ
    }
    let (parsed, tree): (Value, Tree) =
        if blank { (Value::Null, Tree::Null) } else { (serde_json::from_slice(body).ok()?, serde_json::from_slice(body).ok()?) };
    if truthy(&parsed) && !parsed.is_object() {
        return None; // 表でない真の本文は Python の例外（窓は答えない）
    }
    if let Route::Delete(id) = route {
        let base = base_rev(&parsed, query);
        return Some(match master_rows::delete(store, &SPEC, id, base) {
            Ok(()) => (200, json!({"ok": true})),
            Err(e) => (e.status(), e.payload()),
        });
    }
    let empty = Map::new();
    let d = parsed.as_object().unwrap_or(&empty);
    // 名前・表・作った所・備考の型は本文の門が断る（body_rules.TYPES。版 3.106.0。前は str_plain で任せていた）
    let tree = if parsed.is_object() { tree } else { Tree::Obj(vec![]) };
    let done = match route {
        Route::Create => {
            let row = match clean_row(d, &tree, false) {
                Ok(Some(r)) => r,
                Ok(None) => return None,
                Err(m) => return Some(format_error(m)),
            };
            master_rows::create(store, &SPEC, &row, &check).map(|v| (201, v))
        }
        Route::Update(id) => {
            let base = base_rev(&parsed, query);
            let mut row = match clean_row(d, &tree, true) {
                Ok(Some(r)) => r,
                Ok(None) => return None,
                Err(m) => return Some(format_error(m)),
            };
            row.retain(|k, _| ["名前", "中身", "備考"].contains(&k.as_str()));
            master_rows::update(store, &SPEC, id, &row, base, &check).map(|v| (200, v))
        }
        _ => return None,
    };
    Some(match done {
        Ok((st, Value::Object(r))) => (st, view(&r)),
        Ok((st, v)) => (st, v),
        Err(e) => (e.status(), e.payload()),
    })
}
