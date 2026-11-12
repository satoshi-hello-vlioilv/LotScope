//! 集計表・グラフの組み方のプリセットの道（版 3.81.0）。Python の routes/presets.py の 5 本を窓が受ける:
//!
//! ```text
//! GET    /api/pivot-presets?source=   … 組み方の並び（自分の ID → 共通 → 共通デフォルト → 組み込み）・いま当てる標準・すぐに見るの並び
//! PUT    /api/pivot-quick             … この ID のすぐに見るの並び（{source, keys} か {source, reset: true}）
//! POST   /api/pivot-presets           … 足す（201。{name, source, scope: default|all|me, standard, body, note}）
//! PUT    /api/pivot-presets/<id>      … 直す（名前・中身・標準・備考。本文 base_rev は開いたときの行の版）
//! DELETE /api/pivot-presets/<id>      … 消す（?rev= は開いたときの行の版。無い行は何もせず ok）
//! ```
//!
//! 行の決まり（範囲・★標準・書ける人・名前の重なり）は src/preset_rows.rs、中身の決まりは services/pivot_presets.clean_body と同じ
//! （評価関数: tests/presets_parity.rs ← program/tests/presets_oracle.py）。組み込みの組み方は Python の BUILTINS を焼いた表
//! （src/pivot_builtins.json。program/tools/pivot-builtins.py が焼き、古い表は tests/test_pivot_builtins.py が止める）。
//!
//! 窓が答えず Python に任せる形: 窓が読めない本文・空の本文・表でない真の本文、本文の name・note が小数・並び・表・大きな整数、
//! 中身の str() する所（段の part・値の column・expr）が並び・表、chartAt の字が 18 字より長い（Python の int() は 4,300 桁で断り、
//! i64 を超えても読む）、すぐに見るの id の字が ASCII でない（Python の isdigit は「²」なども数字と読む）、置き場の行の形が違う。

use crate::master_rows::{self, base_rev, Spec};
use crate::master_store::{next_id, MasterError, Store};
use crate::preset_rows::{self as pr, Answer, Who};
use crate::worksum::{py_str, truthy};
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

pub const NAME: &str = "pivot_presets";
pub const QUICK_NAME: &str = "pivot_quick";
const SPEC: Spec = Spec { name: NAME, fields: &pr::FIELDS, unique: None, renamed: &[] };
const QUICK_FIELDS: [&str; 3] = ["ログインID", "元", "並び"];
const QUICK_SPEC: Spec = Spec { name: QUICK_NAME, fields: &QUICK_FIELDS, unique: None, renamed: &[] };
const QUICK_MAX: usize = 24;
const MAX_BYTES: usize = 64 * 1024;
const EXPR_MAX: usize = 60; // aggregate.EXPR_MAX
const DEC_MAX: f64 = 6.0; // aggregate.DEC_MAX
const WHAT: &str = "組み方";
const CHARTS: [&str; 28] = [
    "time",
    "line",
    "area",
    "control",
    "xbar",
    "swimlane",
    "column",
    "bar",
    "lollipop",
    "pareto",
    "stack",
    "stack100",
    "hstack",
    "hstack100",
    "stackarea",
    "donut",
    "treemap",
    "sankey",
    "hist",
    "box",
    "violin",
    "heat",
    "scatter",
    "bubble",
    "diag45",
    "combo",
    "waterfall",
    "none",
];
const AGGS: [&str; 6] = ["count", "lots", "sum", "avg", "min", "max"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    List,
    Quick,
    Create,
    Update(i64),
    Delete(i64),
}

pub fn route_of(method: &str, path: &str) -> Option<Route> {
    if path == "/api/pivot-quick" {
        return (method == "PUT").then_some(Route::Quick);
    }
    let rest = path.strip_prefix("/api/pivot-presets")?;
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

/// 中身の決まりに合わない（PresetError。Python は 400 と例外の種類）
fn preset_error(msg: impl Into<String>) -> Answer {
    (400, json!({"error": msg.into(), "kind": "error", "type": "PresetError"}))
}

fn take(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Python の str(v or "")
fn str_or(v: Option<&Value>) -> String {
    match v {
        Some(x) if truthy(x) => py_str(x),
        _ => String::new(),
    }
}

fn is_num(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Number(_)))
}

fn container(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Array(_) | Value::Object(_)))
}

/// 中身（表）を窓が Python と同じに扱えるか（上の「任せる形」）
fn body_obj_plain(b: &Value) -> bool {
    let Some(b) = b.as_object() else { return true };
    let dims_ok = |k: &str| {
        b.get(k)
            .and_then(Value::as_array)
            .is_none_or(|ds| ds.iter().take(3).filter_map(Value::as_object).all(|d| !container(d.get("part"))))
    };
    let ms_ok = b
        .get("measures")
        .and_then(Value::as_array)
        .is_none_or(|ms| ms.iter().take(4).filter_map(Value::as_object).all(|m| !container(m.get("column")) && !container(m.get("expr"))));
    let at_ok = b.get("chartAt").and_then(Value::as_str).is_none_or(|s| s.chars().count() <= 18);
    dims_ok("rows") && dims_ok("cols") && ms_ok && at_ok
}

/// 中身の字・表 → 窓が答えてよいか（字は text_split も見る）
fn body_plain(b: Option<&Value>) -> bool {
    match b {
        Some(Value::String(t)) => !master_rows::text_split(t) && serde_json::from_str::<Value>(t).map_or(true, |v| body_obj_plain(&v)),
        Some(v) => body_obj_plain(v),
        None => true,
    }
}

/// 段（_dims）: 並びの先頭 3 つのうち、column が空でない字の物
fn dims(v: Option<&Value>) -> Vec<Value> {
    let mut out = vec![];
    for d in v.and_then(Value::as_array).into_iter().flatten().take(3) {
        let Some(d) = d.as_object() else { continue };
        let Some(col) = d.get("column").and_then(Value::as_str).filter(|c| !c.is_empty()) else { continue };
        let mut x = Map::new();
        x.insert("column".into(), json!(take(col, 200)));
        x.insert("part".into(), json!(take(&str_or(d.get("part")), 10)));
        for k in ["width", "origin"] {
            if is_num(d.get(k)) {
                x.insert(k.into(), d[k].clone());
            }
        }
        out.push(Value::Object(x));
    }
    out
}

/// Python の round（偶数へ）→ int → 0〜DEC_MAX
fn dec_of(v: &Value) -> i64 {
    let f = v.as_f64().unwrap_or(0.0);
    f.round_ties_even().clamp(0.0, DEC_MAX) as i64
}

/// chartAt: max(0, int(str(v or 0).strip()))。読めなければ 0（字の長い物は body_plain が任せる）
fn chart_at(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::String(s)) if !s.is_empty() => crate::pyfmt::py_int(crate::pyfmt::strip(s)).map_or(0, |n| n.saturating().max(0)),
        Some(Value::Number(n)) => n.as_i64().map_or(0, |n| n.max(0)), // 小数の str() は int() で読めない
        _ => 0,                                                       // 真偽・null・並び・表の str() も読めない
    }
}

/// 組み方の中身（表か JSON 字）→ (中身, 置く字)（pivot_presets.clean_body。body_plain を通った物だけを渡す）
pub fn clean_body(body: Option<&Value>) -> Result<(Value, String), String> {
    let parsed;
    let body = match body {
        Some(Value::String(t)) => {
            parsed = serde_json::from_str::<Value>(t).map_err(|_| "中身の形が違います。".to_string())?;
            &parsed
        }
        Some(b) => b,
        None => &Value::Null,
    };
    let Some(b) = body.as_object() else { return Err("中身の形が違います。".into()) };
    let mut out = Map::new();
    out.insert("rows".into(), json!(dims(b.get("rows"))));
    out.insert("cols".into(), json!(dims(b.get("cols"))));
    let mut ms = vec![];
    for m in b.get("measures").and_then(Value::as_array).into_iter().flatten().take(4) {
        let Some(m) = m.as_object() else { continue };
        let Some(agg) = m.get("agg").and_then(Value::as_str).filter(|a| AGGS.contains(a)) else { continue };
        let mut x = Map::new();
        x.insert("agg".into(), json!(agg));
        if agg != "count" && agg != "lots" {
            x.insert("column".into(), json!(take(&str_or(m.get("column")), 200)));
        }
        let expr = take(crate::pyfmt::strip(&str_or(m.get("expr"))), EXPR_MAX);
        if !expr.is_empty() && crate::num_expr::compile(&expr).is_ok() {
            x.insert("expr".into(), json!(expr));
        }
        if is_num(m.get("dec")) {
            x.insert("dec".into(), json!(dec_of(&m["dec"])));
        }
        ms.push(Value::Object(x));
    }
    out.insert("measures".into(), json!(ms));
    let chart = b.get("chart").and_then(Value::as_str).filter(|c| CHARTS.contains(c)).unwrap_or("time");
    out.insert("chart".into(), json!(chart));
    for k in ["sub", "grand", "split", "labels"] {
        let v = match b.get(k) {
            Some(x) => truthy(x),
            None => k == "sub" || k == "grand",
        };
        out.insert(k.into(), json!(v));
    }
    out.insert("chartAt".into(), json!(chart_at(b.get("chartAt"))));
    if out["rows"].as_array().is_none_or(Vec::is_empty) {
        return Err("行の段が 1 つも無い組み方は保存できません（左のカラムの［行］を押してから保存してください）。".into());
    }
    let out = Value::Object(out);
    let text = crate::join::py_dumps(&out);
    if text.len() > MAX_BYTES {
        return Err("組み方が大きすぎます。".into());
    }
    Ok((out, text))
}

/// 置き場の中身の字 → 画面の body（pivot_presets.view: 読めなければ {}。中身が空なら "{}" を読んだ形＝{}）
fn view_body(row: &Map<String, Value>) -> Value {
    let t = row.get("中身").and_then(Value::as_str).filter(|t| !t.is_empty()).unwrap_or("{}");
    clean_body(Some(&json!(t))).map_or(json!({}), |(b, _)| b)
}

/// 組み込みの組み方（Python の builtin_views を焼いた表）
fn builtins(source: &str) -> Vec<Value> {
    static TABLE: OnceLock<Value> = OnceLock::new();
    let t = TABLE.get_or_init(|| serde_json::from_str(include_str!("pivot_builtins.json")).expect("組み込みの組み方の表"));
    t.get(source).and_then(Value::as_array).cloned().unwrap_or_default()
}

/// すぐに見るの id の字（str(k).strip()[:40]）を窓が Python と同じに読めるか（ASCII でない字は Python の isdigit の表が要る。
/// 並び・表・小数・真偽・null の str() は数字にも b:鍵 にもならないので、どれでも同じに捨てる）
fn quick_key(k: &Value) -> Option<Option<String>> {
    let t = match k {
        Value::String(s) => take(crate::pyfmt::strip(s), 40),
        Value::Number(n) if n.as_i64().is_some() => n.to_string(),
        _ => return Some(None),
    };
    let b = t.strip_prefix("b:").is_some_and(|r| !r.is_empty());
    if !b && !t.is_ascii() {
        return None; // Python の isdigit（Unicode の数字の表）。窓は答えない
    }
    Some((b || (!t.is_empty() && t.bytes().all(|c| c.is_ascii_digit()))).then_some(t))
}

/// clean_quick: 数の id か "b:鍵"・同じ物は 1 つ・QUICK_MAX まで。窓が読めない字があれば None（Python に任せる）
fn clean_quick(keys: &Value) -> Option<Result<Vec<String>, String>> {
    let Some(ks) = keys.as_array() else { return Some(Err("すぐに見るの並びの形が違います。".into())) };
    let mut out: Vec<String> = vec![];
    for k in ks {
        if let Some(t) = quick_key(k)? {
            if !out.contains(&t) {
                out.push(t);
            }
        }
    }
    Some(if out.len() > QUICK_MAX { Err(format!("すぐに見るに並べられるのは {QUICK_MAX} までです。")) } else { Ok(out) })
}

/// この ID・この元で選んだ並び（quick_for。選んでいなければ Ok(None)。窓が読めない並びは Err）
fn quick_for(rows: &[Value], source: &str, login: &str) -> Result<Option<Vec<String>>, ()> {
    let s = |r: &Map<String, Value>, k: &str| r.get(k).and_then(Value::as_str).map(str::to_string);
    let Some(row) = rows
        .iter()
        .filter_map(Value::as_object)
        .find(|r| s(r, "元").as_deref() == Some(source) && !login.is_empty() && s(r, "ログインID").as_deref() == Some(login))
    else {
        return Ok(None);
    };
    let text = s(row, "並び").filter(|t| !t.is_empty()).unwrap_or_else(|| "[]".into());
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return Ok(None) };
    match clean_quick(&v) {
        None => Err(()),
        Some(r) => Ok(r.ok()),
    }
}

/// default_quick: 共通デフォルトのうち開発者が置いた物（id の順）→ 組み込みの quick の物
fn default_quick(items: &[Value]) -> Vec<String> {
    let mut placed: Vec<&Value> = items.iter().filter(|x| x["scope"] == "default" && x["builtin"] != true).collect();
    placed.sort_by_key(|x| x["id"].as_i64().unwrap_or(0));
    let mut out: Vec<String> = placed.iter().map(|x| py_str(&x["id"])).collect();
    out.extend(items.iter().filter(|x| x["builtin"] == true && x.get("quick").is_some_and(truthy)).map(|x| py_str(&x["id"])));
    out
}

/// すぐに見るの置き場の行を窓が Python と同じに読めるか（置く項目は字か無い・並びの字は serde が Python と同じに読める）
fn quick_rows_plain(rows: &[Value]) -> bool {
    rows.iter().all(|r| {
        r.as_object().is_some_and(|o| {
            master_rows::row_readable(o)
                && QUICK_FIELDS.iter().all(|k| o.get(*k).is_none_or(Value::is_string))
                && o.get("並び").and_then(Value::as_str).is_none_or(|t| !master_rows::text_split(t))
        })
    })
}

/// 置き場から行を読んで答える（Lot::presets_route と試験 tests/presets_parity.rs の入口）。窓が答えない形は None
pub fn answer(store: &Store, me: &Value, route: Route, query: &str, body: &[u8], place: &crate::access::Place) -> Option<Answer> {
    let names: &[&str] = match route {
        Route::List => &[NAME, QUICK_NAME],
        Route::Quick => &[QUICK_NAME],
        _ => &[NAME],
    };
    if names.iter().any(|n| place.split_file(n) || (route == Route::List && place.share_absent(n))) {
        return None;
    }
    let rows = place.rows(NAME).ok()?;
    if !pr::rows_plain(&rows) || !rows.iter().filter_map(Value::as_object).all(|r| body_plain(r.get("中身"))) {
        return None;
    }
    let who = Who::of(me, NAME);
    if route == Route::List {
        let quick_rows = place.rows(QUICK_NAME).ok()?;
        if !quick_rows_plain(&quick_rows) {
            return None;
        }
        let q = crate::lotlist::parse_query(query);
        let src = q.iter().find(|(k, _)| k == "source").map(|(_, v)| v.clone()).unwrap_or_default();
        if !crate::dashboard::is_screen_source(&src) {
            return Some((400, json!({"error": "source は lot・work・src:<キー> のどれかです。"})));
        }
        let mine: Vec<&Map<String, Value>> = rows
            .iter()
            .filter_map(Value::as_object)
            .filter(|r| r.get("元").and_then(Value::as_str) == Some(src.as_str()) && pr::visible(r, &who.login))
            .collect();
        let std = pr::standard_for(&mine, &src, &who.login);
        let mut items: Vec<Value> = mine.iter().map(|r| who.view(r, view_body(r))).collect();
        pr::sort_views(&mut items);
        items.extend(builtins(&src));
        let chosen = quick_for(&quick_rows, &src, &who.login).ok()?;
        let known: Vec<String> = items.iter().map(|x| py_str(&x["id"])).collect();
        // 既定のすぐに見るは共通デフォルトの行を id で並べる（Python の sorted。真偽・小数・null の id は比べ方が違う・null は TypeError）
        let placed: Vec<&Value> = items.iter().filter(|x| x["scope"] == "default" && x["builtin"] != true).collect();
        if placed.len() >= 2 && placed.iter().any(|x| x["id"].as_i64().is_none()) {
            return None;
        }
        let dflt = default_quick(&items);
        let quick = match &chosen {
            Some(c) => c.iter().filter(|k| known.contains(k)).cloned().collect(),
            None => dflt.clone(),
        };
        return Some((
            200,
            json!({"items": items, "login": who.login, "canEditCommon": who.common_ok, "canEditDefault": who.default_ok,
                   "standardId": std.and_then(|r| r.get("id")).cloned().unwrap_or(Value::Null),
                   "quick": quick, "quickCustom": chosen.is_some(), "quickDefault": dflt}),
        ));
    }
    if master_rows::unreadable(body) {
        return None;
    }
    let blank = body.iter().all(|b| b.is_ascii_whitespace());
    let parsed: Value = if blank { Value::Null } else { serde_json::from_slice(body).ok()? };
    let find = |id: i64| rows.iter().find(|r| master_rows::same_id(r, id)).and_then(Value::as_object);
    if let Route::Delete(id) = route {
        if truthy(&parsed) && !parsed.is_object() {
            return None; // 消す道は先に base_rev が本文を読む（表でない真の本文は Python では道の外の例外）
        }
        let base = base_rev(&parsed, query);
        let Some(old) = find(id) else { return Some((200, json!({"ok": true}))) };
        if let Err(a) = who.gate(old, WHAT) {
            return Some(a);
        }
        return Some(match master_rows::delete(store, &SPEC, id, base) {
            Ok(()) => (200, json!({"ok": true})),
            Err(e) => (e.status(), e.payload()),
        });
    }
    // 足す・直す・すぐに見るの本文は get_json(force=True) or {}: 空の本文は BadRequest、表でない真の本文は Python の例外（窓は答えない）
    if blank || (truthy(&parsed) && !parsed.is_object()) {
        return None;
    }
    let empty = Map::new();
    let d = parsed.as_object().unwrap_or(&empty);
    if route == Route::Quick {
        // すぐに見るの置き場の行も、窓が Python と同じに読めること（表でない行は Python が落ちて書かない）。
        // 自分の行が中身まで同じ物を 2 つ持つと、Python の rows.remove(r) は == で先の行を消し、書いた行が残らない（窓は答えない）
        let quick_rows = place.rows(QUICK_NAME).ok()?;
        if !quick_rows_plain(&quick_rows) {
            return None;
        }
        let login = who.login.as_str();
        let src = d.get("source").and_then(Value::as_str).unwrap_or("");
        let mine: Vec<&Value> =
            quick_rows.iter().filter(|r| r["ログインID"].as_str() == Some(login) && r["元"].as_str() == Some(src)).collect();
        if mine.iter().enumerate().any(|(i, a)| mine[..i].contains(a)) {
            return None;
        }
        return quick_put(store, &who, d);
    }
    if !pr::plain_input(d) || !body_plain(d.get("body")) {
        return None;
    }
    let body_text = |b: Option<&Value>| -> Result<String, String> { clean_body(b).map(|(_, t)| t) };
    let (row, base, id) = match route {
        Route::Create => {
            let src = d.get("source").and_then(Value::as_str).filter(|s| crate::dashboard::is_screen_source(s));
            let row = match pr::clean_row(d, &who.login, false, src, &body_text) {
                Ok(r) => r,
                Err(m) => return Some(preset_error(m)),
            };
            if let Err(a) = who.gate(&row, WHAT) {
                return Some(a);
            }
            (row, None, None)
        }
        Route::Update(id) => {
            let base = base_rev(&parsed, query);
            // routes/common.find_row: id の合う最初の行（元は見ない）
            let Some(old) = find(id) else { return Some(preset_error(format!("id={id} が見つかりません。"))) };
            if let Err(a) = who.gate(old, WHAT) {
                return Some(a);
            }
            let mut row = match pr::clean_row(d, &who.login, true, None, &body_text) {
                Ok(r) => r,
                Err(m) => return Some(preset_error(m)),
            };
            row.retain(|k, _| ["名前", "中身", "標準", "備考"].contains(&k.as_str()));
            (row, base, Some(id))
        }
        _ => return None,
    };
    Some(match pr::write(store, &SPEC, id, &row, base, WHAT) {
        Ok(Value::Object(done)) => (if id.is_none() { 201 } else { 200 }, who.view(&done, view_body(&done))),
        Ok(_) => (500, json!({"error": "組み方を書けませんでした。", "kind": "error"})),
        Err(e) => (e.status(), e.payload()),
    })
}

/// PUT /api/pivot-quick（routes/presets.quick_put: 元 → 切断 → ログイン ID → 並び の順に確かめ、1 回の書き込みで行を 1 つにまとめる）
fn quick_put(store: &Store, who: &Who, d: &Map<String, Value>) -> Option<Answer> {
    let src = d.get("source").and_then(Value::as_str).filter(|s| crate::dashboard::is_screen_source(s));
    let Some(src) = src else { return Some(preset_error("元（lot・work・src:<キー>）が違います。")) };
    if who.revoked {
        return Some((403, json!({"error": "この PC は一時的に切断されています。すぐに見るを書き換えられません。", "kind": "forbidden"})));
    }
    if who.login.is_empty() {
        return Some(preset_error("ログイン ID が分からないので、すぐに見るを選んで覚えられません。"));
    }
    let keys = if d.get("reset").is_some_and(truthy) {
        None
    } else {
        match clean_quick(d.get("keys").unwrap_or(&Value::Null))? {
            Ok(k) => Some(k),
            Err(m) => return Some(preset_error(m)),
        }
    };
    let login = who.login.clone();
    let done = store.write(QUICK_NAME, |rows, stamp| {
        master_rows::normalize_all(rows, &QUICK_SPEC);
        let is_mine = |r: &Value| r["ログインID"].as_str() == Some(login.as_str()) && r["元"].as_str() == Some(src);
        let first = rows.iter().position(is_mine);
        // 自分の行は 1 つに（2 つ目から消す。既定に戻すときは 1 つ目も）
        let mut seen = false;
        rows.retain(|r| {
            if !is_mine(r) {
                return true;
            }
            let keep = !seen && keys.is_some();
            seen = true;
            keep
        });
        let Some(keys) = &keys else { return Ok::<(), MasterError>(()) };
        let i = match first {
            Some(_) => rows.iter().position(is_mine).unwrap(),
            None => {
                rows.push(json!({"id": next_id(rows), "ログインID": login, "元": src, "rev": 0}));
                rows.len() - 1
            }
        };
        let rev = master_rows::py_int(&rows[i]["rev"]).unwrap_or(0) + 1; // Python の int(row.get("rev", 0)) + 1（"3"・2.0・真も読む）
        let row = rows[i].as_object_mut().unwrap();
        row.insert("並び".into(), json!(crate::join::py_dumps(&json!(keys))));
        row.insert("rev".into(), json!(rev));
        for (k, v) in stamp.as_object().into_iter().flatten() {
            row.insert(k.clone(), v.clone());
        }
        Ok(())
    });
    Some(match done {
        Ok(()) => (200, json!({"ok": true, "quick": keys, "quickCustom": keys.is_some()})),
        Err(e) => (e.status(), e.payload()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_are_baked_for_both_sources() {
        assert!(builtins("lot").len() >= 9 && builtins("work").len() >= 9);
        assert!(builtins("src:x").is_empty());
    }

    #[test]
    fn chart_at_reads_like_python_int_of_str() {
        let at = |v: Value| chart_at(Some(&v));
        assert_eq!(
            (at(json!(" 3 ")), at(json!("-2")), at(json!("2.5")), at(json!(2.5)), at(json!(true)), at(json!("1_0"))),
            (3, 0, 0, 0, 0, 10)
        );
    }
}
