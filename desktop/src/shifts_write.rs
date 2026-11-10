//! 勤務体系のマスタの道（版 3.75.0。7 段目の手本）。Python の `routes/shifts.py` の 4 本を窓が受ける:
//!
//! ```text
//! GET    /api/masters/shifts        … 一覧（区分・適用設備つき）・テンプレート・選べる設備・この PC が書けるか
//! POST   /api/masters/shifts        … 足す（201・一覧＋created）
//! PUT    /api/masters/shifts/<id>   … 直す（一覧。本文 base_rev は開いたときの行の版）
//! DELETE /api/masters/shifts/<id>   … 消す（一覧。?rev= は開いたときの行の版）
//! ```
//!
//! 決まりは Python と同じ（評価関数: tests/shifts_parity.rs ← program/tests/shifts_oracle.py）:
//! - 本文の読み方（services/shifts.clean_row・clean_segments。名称・適用設備・区分〈JSON の字は json.dumps(separators=(',',':')) と同じ〉・表示順・備考）
//! - 行の書き方は共通の型（src/master_rows.rs。SPECS["shift_patterns"]: 名称は 1 つずつ）。表示順の無い行は最後（row_order.next_order と同じ）
//! - 数の読み方は pyfmt（tests/fixtures/pynum_cases.json で Python と突き合わせた 1 つの表）
//!
//! 窓が答えず Python に任せる形: 読めない本文・表でない本文（Python は Flask の 400〈本文の形〉か例外）・
//! 項目が並び・表のとき（Python の str() の書き方〈[1, 2]〉が要る）・i64 に入らない数・版の番号に 10 進でない数の字があるとき。

use crate::access::{master_edit_can, master_scope};
use crate::master_rows::{base_rev, no_check, Rev, Spec};
use crate::master_store::{MasterError, Store};
use crate::pyfmt::{self, strip};
use crate::worksum::{
    crosses_midnight, equipment_list, hm, normalize_part, order_of, pad_hm, py_int_of, py_str, segments_of, truthy, DAYOFF_LIMIT,
};
use serde_json::{json, Map, Value};

pub const NAME: &str = "shift_patterns";
const FIELDS: [&str; 5] = ["名称", "適用設備", "区分", "表示順", "備考"];
const SPEC: Spec = Spec { name: NAME, fields: &FIELDS, unique: Some("名称"), renamed: &[] };
const NAME_MAX: usize = 40;
const SEGMENTS_MAX: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Route {
    List,
    Create,
    Update(i64),
    Delete(i64),
}

/// 窓が受ける道か（Python の <int:item_id> は数字だけ）
pub fn route_of(method: &str, path: &str) -> Option<Route> {
    match (method, path) {
        ("GET", "/api/masters/shifts") => Some(Route::List),
        ("POST", "/api/masters/shifts") => Some(Route::Create),
        (m @ ("PUT" | "DELETE"), p) => {
            let id = p.strip_prefix("/api/masters/shifts/")?;
            if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let id: i64 = id.parse().ok()?;
            Some(if m == "PUT" { Route::Update(id) } else { Route::Delete(id) })
        }
        _ => None,
    }
}

type Answer = (u16, Value);

/// clean_row の誤り（ShiftError）。master_call の exception_error と同じ形
fn shift_error(msg: impl Into<String>) -> Answer {
    (400, json!({"error": msg.into(), "kind": "error", "type": "ShiftError"}))
}

fn of_master(e: MasterError) -> Answer {
    match e {
        MasterError::Error(m) => (400, json!({"error": m, "kind": "error"})),
        e => (e.status(), e.payload()),
    }
}

/// Python の str(v or "")（偽の値は空）
fn s_or(v: Option<&Value>) -> String {
    v.filter(|x| truthy(x)).map(py_str).unwrap_or_default()
}

fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// 値が並び・表（Python の str() が [1, 2] の形になる）か、i64 に入らない数（Python の int は桁のまま）か
fn awkward(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Array(_) | Value::Object(_)) => true,
        Some(Value::Number(n)) => n.as_i64().is_none() && n.as_f64().is_some_and(|f| f.is_finite() && f.abs() >= 9.0e15),
        Some(Value::String(s)) => pyfmt::py_int(s).is_ok() && digits_len(s) > 18,
        _ => false,
    }
}

fn digits_len(s: &str) -> usize {
    s.chars().filter(|c| pyfmt::digit(*c).is_some()).count()
}

/// 本文を窓が答えてよいか（読めない・表でない本文、Python の str() と書き方の違う値は Python に任せる）
pub fn needs_python(body: &[u8]) -> bool {
    if body.iter().all(|b| b.is_ascii_whitespace()) {
        return true; // get_json(force=True) は空の本文を読めない（Flask の 400）
    }
    if crate::master_rows::unreadable(body) {
        return true; // 読めない・読みが割れる数（整数の -0・i64 に入らない整数。版 3.77.0）
    }
    let Ok(v) = serde_json::from_slice::<Value>(body) else { return true };
    if !truthy(&v) {
        return false;
    }
    let Some(o) = v.as_object() else { return true };
    if ["name", "note", "order", "base_rev"].iter().any(|k| awkward(o.get(*k))) {
        return true;
    }
    // 適用設備: 表、並びの中の並び・表は Python の str() の書き方（{'a': 1}・[1, 2]）が要る（作った後の採点で見つけた）
    // i64 に入らない整数も（Python の str() は桁のまま、窓は小数の書き方。2 回目の採点で見つけた）
    // 1.9 のような小数は Python の str() も窓も同じ書き方なので、整数の値で i64 に入らない物だけ
    let big = |x: &Value| {
        x.as_number()
            .is_some_and(|n| n.is_u64() && n.as_i64().is_none() || n.as_f64().is_some_and(|f| f.fract() == 0.0 && f.abs() >= 9.2e18))
    };
    match o.get("equipment") {
        Some(Value::Object(_)) => return true,
        Some(Value::Array(a)) if a.iter().any(|x| x.is_array() || x.is_object() || big(x)) => return true,
        Some(x) if big(x) => return true,
        _ => {}
    }
    // 区分: JSON の字で来たら中を読む（Python の json.loads は NaN・Infinity・1e400 を読む。窓が読めなければ Python に任せる）
    let parsed;
    let segs = match o.get("segments") {
        Some(Value::String(t)) if !t.is_empty() => match serde_json::from_str::<Value>(t) {
            Ok(v) => {
                parsed = v;
                &parsed
            }
            Err(_) => return crate::access::py_json(t).is_some(),
        },
        Some(v) => v,
        None => return false,
    };
    match segs {
        Value::Array(segs) => segs.iter().any(|s| {
            s.as_object()
                .is_some_and(|m| ["name", "start", "end", "dayOffset"].iter().any(|k| awkward(m.get(*k)) || m.get(*k).is_some_and(big)))
        }),
        _ => false,
    }
}

/// 区分の並び（clean_segments）→ 置く形の JSON の字（json.dumps(…, ensure_ascii=False, separators=(",", ":"))）
fn clean_segments(v: Option<&Value>) -> Result<String, String> {
    let parsed;
    let segs = match v {
        Some(Value::String(s)) => {
            // Python の json.loads も読めない字（窓が読めず Python が読む NaN などは needs_python で Python に任せた）
            parsed = serde_json::from_str(if s.is_empty() { "[]" } else { s }).map_err(|_| "勤務区分の形が読めません。".to_string())?;
            &parsed
        }
        Some(x) => x,
        None => &Value::Null,
    };
    let Value::Array(segs) = segs else { return Err("勤務区分の形が違います（区分の並び）。".into()) };
    if segs.len() > SEGMENTS_MAX {
        return Err(format!("勤務区分は {SEGMENTS_MAX} までです。"));
    }
    let mut out: Vec<String> = vec![];
    let mut names: Vec<String> = vec![];
    let empty = Map::new();
    for seg in segs {
        let seg = seg.as_object().unwrap_or(&empty);
        let name = cut(strip(&s_or(seg.get("name"))), NAME_MAX);
        let (start, end) = (strip(&s_or(seg.get("start"))).to_string(), strip(&s_or(seg.get("end"))).to_string());
        if name.is_empty() {
            return Err("勤務区分の名称を入れてください。".into());
        }
        if names.contains(&name) {
            return Err(format!("勤務区分「{name}」が 2 つあります。名前を分けてください。"));
        }
        names.push(name.clone());
        if hm(&start).is_none() || hm(&end).is_none() {
            return Err(format!("「{name}」の時刻は HH:MM（00:00〜23:59）で入れてください。"));
        }
        if hm(&start) == hm(&end) {
            return Err(format!("「{name}」の開始と終了が同じです。"));
        }
        let raw = seg.get("dayOffset");
        let off = match raw {
            None | Some(Value::Null) => None,
            Some(Value::String(x)) if x.is_empty() => None,
            Some(r) if crosses_midnight(&start, &end) => {
                // int(raw): 真偽・整数・小数（切り捨て。inf・nan は読めない）・字（pyfmt の読み方）
                let n = py_int_of(r).ok_or_else(|| format!("「{name}」の日付の数え方は整数（日数）で入れてください。"))?;
                Some(n.clamp(-DAYOFF_LIMIT, DAYOFF_LIMIT))
            }
            Some(_) => None,
        };
        out.push(format!(
            "{{\"name\":{},\"start\":{},\"end\":{},\"dayOffset\":{}}}",
            serde_json::to_string(&name).unwrap(),
            serde_json::to_string(&pad_hm(&start)).unwrap(),
            serde_json::to_string(&pad_hm(&end)).unwrap(),
            off.map(|n| n.to_string()).unwrap_or_else(|| "null".into())
        ));
    }
    Ok(format!("[{}]", out.join(",")))
}

/// 画面から来た値 → マスタの行（clean_row。partial は直すとき〈来た物だけ〉）
fn clean_row(data: &Map<String, Value>, partial: bool) -> Result<Map<String, Value>, String> {
    let mut out = Map::new();
    if !partial || data.contains_key("name") {
        let name = strip(&s_or(data.get("name"))).to_string();
        if name.is_empty() {
            return Err("勤務体系の名称を入れてください。".into());
        }
        out.insert("名称".into(), json!(cut(&name, NAME_MAX)));
    }
    if !partial || data.contains_key("equipment") {
        out.insert("適用設備".into(), json!(equipment_list(data.get("equipment")).join(",")));
    }
    if !partial || data.contains_key("segments") {
        let segs = clean_segments(data.get("segments"))?;
        if segs == "[]" {
            return Err("勤務区分を 1 つ以上入れてください（テンプレートから入れられます）。".into());
        }
        out.insert("区分".into(), json!(segs));
    }
    if data.contains_key("order") {
        out.insert("表示順".into(), json!(data.get("order").and_then(py_int_of).map(|n| n.to_string()).unwrap_or_default()));
    }
    if !partial || data.contains_key("note") {
        out.insert("備考".into(), json!(cut(strip(&s_or(data.get("note"))), 200)));
    }
    Ok(out)
}

/// 画面へ出す形（shifts.view）
fn view(row: &Value) -> Value {
    let eq = equipment_list(row.get("適用設備"));
    let raw_or = |k: &str, d: Value| row.get(k).filter(|v| truthy(v)).cloned().unwrap_or(d);
    json!({
        "id": row.get("id").cloned().unwrap_or(Value::Null),
        "name": raw_or("名称", json!("")),
        "equipment": eq,
        "equipmentText": if eq.is_empty() { "全設備共通".to_string() } else { eq.join("・") },
        "segments": segments_of(row).iter().map(|s| s.json()).collect::<Vec<_>>(),
        "order": order_of(row),
        "note": raw_or("備考", json!("")),
        "rev": row.get("rev").cloned().unwrap_or(json!(1)),
        "updated_at": row.get("updated_at").cloned().unwrap_or(json!("")),
        "updated_by": raw_or("updated_by", json!({})),
    })
}

/// よくある勤務体系（shifts.TEMPLATES）
fn templates() -> Value {
    json!([
        {"label": "日勤", "segments": [{"name": "日勤", "start": "08:15", "end": "17:05"}]},
        {"label": "交替勤務(1,2,3直)", "segments": [
            {"name": "1直", "start": "07:00", "end": "15:00"}, {"name": "2直", "start": "15:00", "end": "23:00"},
            {"name": "3直", "start": "23:00", "end": "07:00", "dayOffset": -1}]},
        {"label": "交替勤務(4,5直)", "segments": [
            {"name": "4直", "start": "11:00", "end": "19:10"}, {"name": "5直", "start": "21:20", "end": "05:45", "dayOffset": -1}]},
    ])
}

/// 読む物（窓の置き場から）: 勤務体系の行・作業実績の登録の行
pub struct Read {
    pub shifts: Vec<Value>,
    pub work_logs: Vec<Value>,
}

/// 一覧（routes/shifts._listing）
fn listing(store: &Store, me: &Value, read: &Read) -> Value {
    let mut rows: Vec<Value> = read.shifts.clone();
    for r in rows.iter_mut() {
        if let Some(o) = r.as_object_mut() {
            o.entry("rev").or_insert(json!(1));
        }
    }
    let mut items: Vec<Value> = rows.iter().map(view).collect();
    items.sort_by_key(|x| (x["order"].as_i64().unwrap_or(0), x.get("id").filter(|v| truthy(v)).and_then(py_int_of).unwrap_or(0)));
    let mut equipments: Vec<String> = vec![];
    let names = read
        .work_logs
        .iter()
        .map(|r| r.get("設備名").cloned().unwrap_or(Value::Null))
        .chain(items.iter().flat_map(|x| x["equipment"].as_array().cloned().unwrap_or_default()));
    for n in names {
        let s = strip(&s_or(Some(&n))).to_string();
        if !s.is_empty() && equipments.iter().all(|y| normalize_part(&s) != normalize_part(y)) {
            equipments.push(s);
        }
    }
    let can = !truthy(&me["revoked"]) && master_edit_can(me["flags"]["masterEdit"].as_str().unwrap_or(""), "write", master_scope(NAME));
    json!({"items": items, "templates": templates(), "equipments": equipments, "canEdit": can,
           "shared": store.is_shared(NAME), "revision": store.revision(NAME), "dayOffsetDefault": crate::worksum::DAYOFF_DEFAULT})
}

/// 窓が Python と同じに読める行か（版 3.75.0。作った後の採点で見つけた形は Python に任せる）: i64 に入らない表示順
/// （Python の int は桁のまま並べる・次の表示順を数える）・数でない id（Python の並べ替えは数と字を比べられず 500）・
/// Python の json は読めて窓は読めない区分の字（NaN・Infinity など）
fn readable(rows: &[Value]) -> bool {
    rows.iter().all(|r| {
        let order_ok = match r.get("表示順") {
            Some(Value::Number(n)) => n.as_i64().is_some() || n.as_f64().is_some_and(|f| f.abs() < 9.0e15),
            v => v.filter(|v| truthy(v)).map(py_str).is_none_or(|v| pyfmt::py_int(strip(&v)).is_err() || digits_len(&v) <= 18),
        };
        // id・版と、名称・備考の値の形（版 3.77.0。大きな id・読めない版・並びや表の名称は Python）
        let id_ok = crate::master_rows::rows_plain(std::slice::from_ref(r), &["名称", "備考"]);
        let seg_ok = match r.get("区分") {
            Some(Value::String(s)) if !s.is_empty() => serde_json::from_str::<Value>(s).is_ok() || crate::access::py_json(s).is_none(),
            _ => true,
        };
        order_ok && id_ok && seg_ok
    })
}

/// 窓が受ける 4 本を答える（門番は呼ぶ側が通した）。read は書く前の読み、reread は書いた後に読み直す係。窓が答えない形は None
pub fn handle(
    store: &Store,
    me: &Value,
    route: Route,
    query: &str,
    body: &[u8],
    read: &Read,
    reread: &dyn Fn() -> Option<Read>,
) -> Option<Answer> {
    if !readable(&read.shifts) {
        return None;
    }
    if route == Route::List {
        return Some((200, listing(store, me, read)));
    }
    // 直す・消す道は先に routes/common.base_rev が本文を silent で読む: 窓が読めない本文（NaN・1e400 など）は Python に任せ、
    // 表でない本文（並び・字・数）は Python が body.get で落ちて 500 になり書かない（作った後の採点で見つけた。access_write と同じ）
    if matches!(route, Route::Update(_) | Route::Delete(_)) && !body.iter().all(|b| b.is_ascii_whitespace()) {
        match serde_json::from_slice::<Value>(body) {
            Err(_) => return None,
            Ok(v) if truthy(&v) && !v.is_object() => return Some((500, json!({"error": "本文の形が違います", "kind": "error"}))),
            Ok(_) => {}
        }
    }
    // 足す・直す道は本文を get_json(force=True) で読む（読めない・空なら Flask の 400）
    if matches!(route, Route::Create | Route::Update(_)) && needs_python(body) {
        return None;
    }
    let parsed: Value = serde_json::from_slice(body).ok().filter(truthy).unwrap_or(json!({}));
    let data = parsed.as_object().cloned().unwrap_or_default();
    let base = if matches!(route, Route::Update(_) | Route::Delete(_)) { base_rev(&parsed, query) } else { None };
    if base == Some(Rev::Unknown) {
        return None;
    }
    // 書いた後は必ず窓が答える（None を返すと Python がもう一度書く）。読み直せなければ書いたことだけを知らせる
    let done = |status: u16, created: Option<Value>| -> Option<Answer> {
        let Some(now) = reread() else {
            return Some((
                503,
                json!({"error": "保存しましたが、読み直せませんでした。画面を開き直してください。", "kind": "reread", "saved": true}),
            ));
        };
        let mut v = listing(store, me, &now);
        if let Some(id) = created {
            v["created"] = id;
        }
        Some((status, v))
    };
    match route {
        Route::Create => {
            let mut row = match clean_row(&data, false) {
                Ok(r) => r,
                Err(e) => return Some(shift_error(e)),
            };
            if strip(&s_or(row.get("表示順"))).is_empty() {
                // 表示順の決まりは master_rows の 1 つ（変換表と同じ。版 3.93.0）
                row.insert("表示順".into(), json!(crate::master_rows::next_order(&read.shifts)?));
            }
            match crate::master_rows::create(store, &SPEC, &row, &no_check) {
                Ok(r) => done(201, Some(r.get("id").cloned().unwrap_or(Value::Null))),
                Err(e) => Some(of_master(e)),
            }
        }
        Route::Update(id) => {
            let mut data = data;
            data.remove("base_rev");
            let row = match clean_row(&data, true) {
                Ok(r) => r,
                Err(e) => return Some(shift_error(e)),
            };
            match crate::master_rows::update(store, &SPEC, id, &row, base, &no_check) {
                Ok(_) => done(200, None),
                Err(e) => Some(of_master(e)),
            }
        }
        Route::Delete(id) => match crate::master_rows::delete(store, &SPEC, id, base) {
            Ok(()) => done(200, None),
            Err(e) => Some(of_master(e)),
        },
        Route::List => unreachable!(),
    }
}
