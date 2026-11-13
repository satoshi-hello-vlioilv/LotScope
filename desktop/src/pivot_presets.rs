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
use crate::pyfmt::PyInt;
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    List,
    Quick,
    Create,
    Update(PyInt),
    Delete(PyInt),
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
            let id = crate::pyfmt::path_int(id)?;
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

/// isinstance(v, (int, float)) and not bool（持っている大きな整数も int。版 3.108.0）
fn is_num(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Number(_))) || v.is_some_and(|x| crate::held::big_digits(x).is_some())
}

fn container(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Array(_) | Value::Object(_)))
}

/// 置き場の行の中身の形が窓と同じに扱えない理由（版 3.107.0。隔てる。Python の pivot_presets.row_problem と同じ）:
/// 段（rows・cols の先頭 3 つ）の part・値（measures の先頭 4 つ）の column・expr が並び・表
pub fn row_problem(row: &Map<String, Value>) -> Option<String> {
    let t = row.get("中身")?.as_str()?;
    let t = if t.is_empty() { "{}" } else { t };
    let Some(Value::Object(b)) = crate::held::text_value(t) else { return None };
    for k in ["rows", "cols"] {
        let bad = b
            .get(k)
            .and_then(Value::as_array)
            .is_some_and(|ds| ds.iter().take(3).filter_map(Value::as_object).any(|d| container(d.get("part"))));
        if bad {
            return Some(format!("中身の段（{k}）の part が並び・表です"));
        }
    }
    let bad = b
        .get("measures")
        .and_then(Value::as_array)
        .is_some_and(|ms| ms.iter().take(4).filter_map(Value::as_object).any(|m| container(m.get("column")) || container(m.get("expr"))));
    bad.then(|| "中身の値（measures）の column・expr が並び・表です".to_string())
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
    // 長い chartAt の字（大きな整数）は版 3.108.0 から chart_at が桁のまま読む（前は 18 字を超える字を任せた）
    dims_ok("rows") && dims_ok("cols") && ms_ok
}

/// 中身の字を読む（大きな整数は src/held.rs の印の字で桁のまま。整数の -0 は 0）
fn body_json(t: &str) -> Option<Value> {
    crate::held::body_value(master_rows::inner_text(t).as_bytes())
}

/// 本文の中身 → 窓が答えてよいか（字は text_split。大きな整数は版 3.108.0 から読む）
fn body_input_ok(b: Option<&Value>) -> bool {
    match b {
        Some(Value::String(t)) => !master_rows::text_split_held(t),
        _ => true,
    }
}

/// 置き場の行の中身の字・表 → 窓が答えてよいか（字は text_split も見る。置き場の行の型は版 3.107.0 の E3 で隔てる）
fn body_plain(b: Option<&Value>) -> bool {
    match b {
        Some(Value::String(t)) => !master_rows::text_split_held(t) && body_json(t).is_none_or(|v| body_obj_plain(&v)),
        Some(v) => body_obj_plain(v),
        None => true,
    }
}

/// 段（_dims）: 並びの先頭 3 つのうち、column が空でない字の物
fn dims(v: Option<&Value>) -> Vec<Value> {
    let mut out = vec![];
    for d in v.and_then(Value::as_array).into_iter().flatten().take(3) {
        let Some(d) = d.as_object() else { continue };
        // isinstance(column, str)（持っている大きな整数は int なので字でない）
        let Some(col) = d.get("column").filter(|v| crate::held::is_text(v)).and_then(Value::as_str).filter(|c| !c.is_empty()) else {
            continue;
        };
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
    // 持っている大きな整数（版 3.108.0）: 負なら 0、正なら DEC_MAX
    if let Some(d) = crate::held::big_digits(v) {
        return if d.starts_with('-') { 0 } else { DEC_MAX as i64 };
    }
    let f = v.as_f64().unwrap_or(0.0);
    f.round_ties_even().clamp(0.0, DEC_MAX) as i64
}

/// chartAt: max(0, int(str(v or 0).strip()))。読めなければ 0。版 3.108.0 から大きな数も Python の int と同じく桁のまま
/// （前は字の長い物を任せ、u64 の整数は 0 にしていた）
fn chart_at(v: Option<&Value>) -> Value {
    let n = match v {
        Some(x) if crate::held::big_digits(x).is_some() => crate::pyfmt::py_int_of(x.into()).ok(),
        Some(Value::String(s)) if !s.is_empty() => crate::pyfmt::py_int(crate::pyfmt::strip(s)).ok(),
        // 整数の str() は桁の字（小数の str() は int() で読めない）
        Some(Value::Number(n)) if n.is_i64() || n.is_u64() => crate::pyfmt::py_int_of(crate::pyfmt::IntArg::Num(n)).ok(),
        _ => None, // 真偽・null・並び・表の str() も読めない
    };
    crate::held::int_value(&n.filter(|n| *n > PyInt::Small(0)).unwrap_or(PyInt::Small(0)))
}

/// 組み方の中身（表か JSON 字）→ (中身, 置く字)（pivot_presets.clean_body。body_plain を通った物だけを渡す）
pub fn clean_body(body: Option<&Value>) -> Result<(Value, String), String> {
    let parsed;
    let body = match body {
        Some(Value::String(t)) if !crate::held::is_held(body.unwrap()) => {
            parsed = body_json(t).ok_or_else(|| "中身の形が違います。".to_string())?;
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
    out.insert("chartAt".into(), chart_at(b.get("chartAt")));
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

/// すぐに見るの id の字（str(k).strip()[:40] が isdigit か "b:鍵"）。isdigit は Python の表（pyfmt::is_digit。版 3.106.0 から
/// 全角の数字・「²」も Python と同じに読む。前は ASCII でない字を Python に任せた）。
/// 並び・表・小数・真偽・null の str() は数字にも b:鍵 にもならないので、どれでも同じに捨てる
fn quick_key(k: &Value) -> Option<Option<String>> {
    let t = match k {
        // 持っている大きな整数は int の str()（桁の字。版 3.108.0）
        v @ Value::String(_) if crate::held::big_digits(v).is_some() => take(crate::held::big_digits(v).unwrap_or(""), 40),
        Value::String(s) => take(crate::pyfmt::strip(s), 40),
        Value::Number(n) if n.as_i64().is_some() || n.as_u64().is_some() => n.to_string(),
        _ => return Some(None),
    };
    let b = t.strip_prefix("b:").is_some_and(|r| !r.is_empty());
    Some((b || (!t.is_empty() && t.chars().all(crate::pyfmt::is_digit))).then_some(t))
}

/// clean_quick: 数の id か "b:鍵"・同じ物は 1 つ・QUICK_MAX まで。窓が読めない字があれば None（Python に任せる）
pub(crate) fn clean_quick(keys: &Value) -> Option<Result<Vec<String>, String>> {
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
    // 並びの字の大きな整数も桁のまま読む（版 3.109.0。src/held.rs。前は wide_content で任せた。serde は小数に丸める）
    let Some(v) = crate::held::text_value(&text) else { return Ok(None) };
    match clean_quick(&v) {
        None => Err(()),
        Some(r) => Ok(r.ok()),
    }
}

/// default_quick: 共通デフォルトのうち開発者が置いた物（id の順）→ 組み込みの quick の物
fn default_quick(items: &[Value]) -> Vec<String> {
    let mut placed: Vec<&Value> = items.iter().filter(|x| x["scope"] == "default" && x["builtin"] != true).collect();
    // 真は 1・偽は 0（Python の int）。大きな id も桁で比べる（版 3.108.0）
    placed.sort_by_key(|x| crate::row_check::as_int(&x["id"]).unwrap_or(PyInt::Small(0)));
    let mut out: Vec<String> = placed.iter().map(|x| py_str(&x["id"])).collect();
    out.extend(items.iter().filter(|x| x["builtin"] == true && x.get("quick").is_some_and(truthy)).map(|x| py_str(&x["id"])));
    out
}

/// すぐに見るの置き場の行（版 3.107.0）: 形をそろえ、隔てた行を分ける → (隔てた行を除いた行, 隔てた行)。並びの字の大きな整数も
/// 版 3.109.0 から桁のまま読む（前は None で任せた）
fn quick_read(rows: &[Value]) -> Option<(Vec<Value>, master_rows::Iso, Vec<Value>)> {
    let mut rows = rows.to_vec();
    master_rows::normalize_all(&mut rows, &QUICK_SPEC);
    let iso = crate::row_check::check(QUICK_NAME, &rows, &QUICK_FIELDS);
    Some((pr::good_rows(QUICK_NAME, &rows, &iso), iso, rows))
}

/// 置き場から行を読んで答える（Lot::presets_route と試験 tests/presets_parity.rs の入口）。窓が答えない形は None
pub fn answer(store: &Store, me: &Value, route: Route, query: &str, body: &[u8], place: &crate::access::Place) -> Option<Answer> {
    let names: &[&str] = match route {
        Route::List => &[NAME, QUICK_NAME],
        Route::Quick => &[QUICK_NAME],
        _ => &[NAME],
    };
    // 一覧は、共有にまだ無ければ Python の読みと同じく最初の版を置いてから読む（組み方とすぐに見る。版 3.105.0。置けなければ前どおり任せる）
    // i64・u64 に入らない整数の組み方のファイルも版 3.108.0 から、すぐに見るのファイルも版 3.109.0 から読む（src/held.rs が桁のまま持つ。
    // 前は Place::split_file で任せた）
    if route == Route::List && !store.seed_absent(names) {
        return None;
    }
    // 置き場の読めない行は隔てる（版 3.107.0。中身の段・値の形は row_problem で。前は任せた）。長い chartAt の字も版 3.108.0 から桁のまま
    let (all, iso) = pr::read_rows(&place.rows_all(NAME).ok()?, NAME)?;
    let rows = pr::good_rows(NAME, &all, &iso);
    if !rows.iter().filter_map(Value::as_object).all(|r| body_plain(r.get("中身"))) {
        return None;
    }
    let who = Who::of(me, NAME);
    if route == Route::List {
        let (quick_rows, quick_iso, quick_all) = quick_read(&place.rows_all(QUICK_NAME).ok()?)?;
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
        // 既定のすぐに見るは共通デフォルトの行を id で並べる（Python の sorted。小数・null・字の id の行は版 3.107.0 から隔てる。
        // u64・大きな整数の id も版 3.108.0 から Python の int と同じく桁で比べる〈default_quick〉）
        let dflt = default_quick(&items);
        let quick = match &chosen {
            Some(c) => c.iter().filter(|k| known.contains(k)).cloned().collect(),
            None => dflt.clone(),
        };
        let mut out = json!({"items": items, "login": who.login, "canEditCommon": who.common_ok, "canEditDefault": who.default_ok,
                             "standardId": std.and_then(|r| r.get("id")).cloned().unwrap_or(Value::Null),
                             "quick": quick, "quickCustom": chosen.is_some(), "quickDefault": dflt});
        let o = out.as_object_mut().unwrap();
        crate::row_check::notes(o, NAME, &all, &iso, place.share_problem(NAME));
        if !quick_iso.is_empty() {
            o.insert("quickSkipped".into(), crate::row_check::skipped_with(QUICK_NAME, &quick_all, &quick_iso));
        }
        return Some((200, out));
    }
    // 本文の大きな整数は版 3.108.0 から桁のまま読む（src/held.rs）
    if master_rows::unreadable_held(body) {
        return None;
    }
    let blank = body.iter().all(|b| b.is_ascii_whitespace());
    let parsed: Value = if blank { Value::Null } else { crate::held::body_value(body)? };
    let find = |id: &PyInt, delete: bool| pr::find_row(NAME, &all, &iso, id, delete);
    if let Route::Delete(id) = &route {
        if truthy(&parsed) && !parsed.is_object() {
            return None; // 消す道は先に base_rev が本文を読む（表でない真の本文は Python では道の外の例外）
        }
        let base = base_rev(&parsed, query);
        let found = match find(id, true) {
            Ok(f) => f,
            Err(a) => return Some(a),
        };
        let Some(old) = found else { return Some((200, json!({"ok": true}))) };
        if let Err(a) = who.gate(&old, WHAT) {
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
        // 自分の行が中身まで同じ物を 2 つ持つ形は、quick_put が Python の rows.remove(r)（== で先の行を消す）を写す（版 3.106.0）
        // すぐに見るの置き場の表でない行は書かない（版 3.102.0。quick_set の _normalize_all）・読めない行は隔てて書き戻す（版 3.107.0）
        quick_read(&place.rows_all(QUICK_NAME).ok()?)?;
        return quick_put(store, &who, d);
    }
    // 本文の欄の型（名前・備考・範囲・段の part・値の column・expr が並び・表）は本文の門が断る（body_rules.TYPES。版 3.106.0。前は
    // plain_input・body_obj_plain で任せていた）。ここで見るのは、中身の字を窓が同じに読めるか（text_split）と長い chartAt（大きな整数。H2）だけ
    if !body_input_ok(d.get("body")) {
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
            // routes/common の repo.find: id の合う最初の行（元は見ない。隔てた行なら書かない）
            let found = match find(&id, false) {
                Ok(f) => f,
                Err(a) => return Some(a),
            };
            let Some(old) = found else { return Some(preset_error(format!("id={id} が見つかりません。"))) };
            if let Err(a) = who.gate(&old, WHAT) {
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
    Some(match pr::write(store, &SPEC, id.as_ref(), &row, base, WHAT) {
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
        let iso = master_rows::prepare(rows, &QUICK_SPEC)?;
        // Python の quick_set を写す: mine = 自分の行（id は Python の物の同一）。mine[1:]（既定に戻すときは mine[:1] も）を
        // rows.remove(r) で消す。remove は == で「先に並ぶ同じ中身の行」を消すので、中身まで同じ行が 2 つあると mine[0] の方が消え、
        // その後で書き換える mine[0] は並びに残らない（書いた答えを返すが、ファイルには前の行が残る。版 3.106.0）
        let mut slots: Vec<(usize, Value)> = std::mem::take(rows).into_iter().enumerate().collect();
        let is_mine = |r: &Value| r["ログインID"].as_str() == Some(login.as_str()) && r["元"].as_str() == Some(src);
        // 隔てた行は自分の行に数えない（そのまま書き戻す。版 3.107.0）
        let mine: Vec<(usize, Value)> =
            slots.iter().filter(|(i, r)| !crate::row_check::is_isolated(&iso, *i) && is_mine(r)).cloned().collect();
        let mut gone: Vec<&Value> = mine.iter().skip(1).map(|(_, r)| r).collect();
        if keys.is_none() {
            gone.extend(mine.iter().take(1).map(|(_, r)| r));
        }
        for r in gone {
            if let Some(at) = slots.iter().position(|(_, x)| x == r) {
                slots.remove(at);
            }
        }
        let first = mine.first().map(|(i, _)| *i);
        let still = first.and_then(|f| slots.iter().position(|(i, _)| *i == f));
        *rows = slots.into_iter().map(|(_, r)| r).collect();
        let Some(keys) = &keys else { return Ok::<(), MasterError>(()) };
        let i = match (first, still) {
            (Some(_), Some(at)) => at,
            // mine[0] は並びから消えた（同じ中身の行を remove した）: 書き換えた行はファイルに残らない
            (Some(_), None) => return Ok(()),
            (None, _) => {
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
            (json!(3), json!(0), json!(0), json!(0), json!(0), json!(10))
        );
        // 大きな数も Python の int と同じく桁のまま（版 3.108.0。前は 18 字を超える字を任せ、u64 の整数は 0）
        assert_eq!(at(json!("9".repeat(30))), json!(format!("{}{}", crate::held::mark(), "9".repeat(30))));
        assert_eq!(at(json!(10000000000000000000u64)), json!(10000000000000000000u64));
        assert_eq!(at(json!("9".repeat(4301))), json!(0), "4,300 桁を超える字は int() が読めない");
    }
}
