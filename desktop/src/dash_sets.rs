//! ダッシュボードのセットの道（版 3.79.0）。Python の routes/dashboard.py のセットの 4 本を窓が受ける:
//!
//! ```text
//! GET    /api/dashboard-sets        … セットの並び（自分の ID → 共通 → 共通デフォルト）・いま開く標準（standardId）・書けるか・最大の数
//! POST   /api/dashboard-sets        … 足す（201。{name, scope: default|all|me, standard, body: {items}, note}）
//! PUT    /api/dashboard-sets/<id>   … 直す（名前・中身・標準・備考。本文 base_rev は開いたときの行の版）
//! DELETE /api/dashboard-sets/<id>   … 消す（?rev= は開いたときの行の版。無い行・セットでない行は何もせず ok）
//! ```
//!
//! 行の決まり（範囲・★標準・書ける人・名前の重なり）は src/preset_rows.rs、中身の決まりは services/dashboard.clean_set_body と同じ
//! （評価関数: tests/sets_parity.rs ← program/tests/sets_oracle.py）。置き場はマスタ dashboards の行のうち元 dashset だけ。
//!
//! 窓が答えず Python に任せる形: 窓が読めない本文（master_rows::unreadable）・空の本文・表でない真の本文・本文の name・note が小数・並び・表・
//! 大きな整数、scope が並び・表（preset_rows::plain_input）・中身を字で送り、その字を窓が読めない（NaN・-0 など）・置き場の行の形が違う
//! （preset_rows::rows_plain）・道の id が ASCII の数字でない。

use crate::master_rows::{self, base_rev, Rev};
use crate::master_store::Store;
use crate::preset_rows::{self as pr, Answer, Who, DASHBOARDS};
use serde_json::{json, Map, Value};

pub const SOURCE: &str = "dashset";
pub const MAX_ITEMS: usize = 12;
const WHAT: &str = "ダッシュボードのセット";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    List,
    Create,
    Update(i64),
    Delete(i64),
}

pub fn route_of(method: &str, path: &str) -> Option<Route> {
    let rest = path.strip_prefix("/api/dashboard-sets")?;
    match (method, rest) {
        ("GET", "") => Some(Route::List),
        ("POST", "") => Some(Route::Create),
        (m @ ("PUT" | "DELETE"), r) => {
            let id = r.strip_prefix('/')?;
            if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let id: i64 = id.parse().ok()?;
            Some(if m == "PUT" { Route::Update(id) } else { Route::Delete(id) })
        }
        _ => None,
    }
}

/// 中身の決まりに合わない（LayoutError。Python は 400 と例外の種類）
fn layout_error(msg: impl Into<String>) -> Answer {
    (400, json!({"error": msg.into(), "kind": "error", "type": "LayoutError"}))
}

/// セットに入れるダッシュボード（_SET_ITEM: \d{1,9}〈Python の \d は Unicode の 10 進の数字〉か b:鍵）
fn item_ok(t: &str) -> bool {
    let n = t.chars().count();
    if let Some(k) = t.strip_prefix("b:") {
        let m = k.chars().count();
        return (1..=32).contains(&m) && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    }
    (1..=9).contains(&n) && t.chars().all(|c| crate::pyfmt::digit(c).is_some())
}

/// セットの中身 → (中身, 置く字)（clean_set_body。字で来たら JSON として読む。読めない字・1 つも無い・多すぎるは誤り）。
/// 字の中身を窓が Python と同じに読めないとき（NaN・-0 など）は Ok(None)＝Python に任せる
fn clean_body(body: Option<&Value>) -> Result<Option<(Value, String)>, String> {
    let parsed;
    let body = match body {
        Some(Value::String(t)) => {
            if pr::text_split(t) {
                return Ok(None); // Python だけが読む字（NaN など）・読みが割れる数
            }
            parsed = serde_json::from_str::<Value>(t).map_err(|_| "セットの中身の形が違います。".to_string())?;
            Some(&parsed)
        }
        b => b,
    };
    let raw = body.and_then(|b| b.get("items")).and_then(Value::as_array);
    let mut items: Vec<String> = vec![];
    for x in raw.into_iter().flatten() {
        // str(x): 字はそのまま・i64 の整数は桁。小数・真偽・null・並び・表・大きな整数の str() は \d{1,9} にも b:鍵 にも当たらない
        let t = match x {
            Value::String(t) => t.clone(),
            Value::Number(n) if n.as_i64().is_some() => n.to_string(),
            _ => continue,
        };
        if item_ok(&t) && !items.contains(&t) {
            items.push(t);
        }
    }
    if items.is_empty() {
        return Err("セットに入れるダッシュボードを 1 つ以上選んでください。".into());
    }
    if items.len() > MAX_ITEMS {
        return Err(format!("セットに入れられるダッシュボードは {MAX_ITEMS} までです。"));
    }
    let out = json!({"items": items});
    let text = crate::join::py_dumps(&out);
    Ok(Some((out, text)))
}

/// 置き場の中身の字 → 画面の body（set_view: 読めなければ {items: []}）
fn view_body(row: &Map<String, Value>) -> Value {
    let t = row.get("中身").and_then(Value::as_str).filter(|t| !t.is_empty()).unwrap_or("{}");
    match clean_body(Some(&json!(t))) {
        Ok(Some((b, _))) => b,
        _ => json!({"items": []}),
    }
}

fn sets<'a>(rows: &'a [Value], login: &str) -> Vec<&'a Map<String, Value>> {
    rows.iter()
        .filter_map(Value::as_object)
        .filter(|r| r.get("元").and_then(Value::as_str) == Some(SOURCE) && pr::visible(r, login))
        .collect()
}

/// 置き場から行を読んで答える（Lot::dash_sets_route と試験 tests/sets_parity.rs の入口）。置き場のファイルを窓が Python と同じに
/// 読めない（Place::split_file: 深い入れ子・NaN・-0・大きな整数・対の無い代用字など）・置き場を読めないときは None（Python に任せる）
pub fn answer(store: &Store, me: &Value, route: Route, query: &str, body: &[u8], place: &crate::access::Place) -> Option<Answer> {
    if place.split_file(DASHBOARDS.name) || (route == Route::List && place.share_absent(DASHBOARDS.name)) {
        return None;
    }
    let rows = place.rows(DASHBOARDS.name).ok()?;
    handle(store, me, route, query, body, &rows)
}

/// 窓が受ける 4 本を答える。me は窓が決めた me、rows は置き場の dashboards の行。窓が答えない形は None
pub fn handle(store: &Store, me: &Value, route: Route, query: &str, body: &[u8], rows: &[Value]) -> Option<Answer> {
    if !pr::rows_plain(rows) {
        return None;
    }
    let who = Who::of(me, DASHBOARDS.name);
    if route == Route::List {
        let mine = sets(rows, &who.login);
        let std = pr::standard_for(&mine, SOURCE, &who.login);
        let mut items: Vec<Value> = mine.iter().map(|r| who.view(r, view_body(r))).collect();
        pr::sort_views(&mut items);
        return Some((
            200,
            json!({"items": items, "standardId": std.and_then(|r| r.get("id")).cloned().unwrap_or(Value::Null), "login": who.login,
                   "canEditCommon": who.common_ok, "canEditDefault": who.default_ok, "max": MAX_ITEMS}),
        ));
    }
    if master_rows::unreadable(body) {
        return None;
    }
    let blank = body.iter().all(|b| b.is_ascii_whitespace());
    let parsed: Value = if blank { Value::Null } else { serde_json::from_slice(body).ok()? };
    // routes/common.find_row: id の合う最初の行（元は見ない）。その行がセットでなければ「無い」
    let find = |id: i64| rows.iter().find(|r| master_rows::same_id(r, id)).and_then(Value::as_object);
    if let Route::Delete(id) = route {
        // 消す道は先に base_rev が本文を読む（表でない真の本文は Python では道の外の例外。窓は答えない）
        if crate::worksum::truthy(&parsed) && !parsed.is_object() {
            return None;
        }
        let base = match base_rev(&parsed, query) {
            Some(Rev::Unknown) => return None,
            b => b,
        };
        let Some(old) = find(id).filter(|r| r.get("元").and_then(Value::as_str) == Some(SOURCE)) else {
            return Some((200, json!({"ok": true})));
        };
        if let Err(a) = who.gate(old, WHAT) {
            return Some(a);
        }
        return Some(match master_rows::delete(store, &DASHBOARDS, id, base) {
            Ok(()) => (200, json!({"ok": true})),
            Err(e) => (e.status(), e.payload()),
        });
    }
    // 足す・直す道の本文は get_json(force=True) or {}: 空の本文は BadRequest、表でない真の本文は Python の例外（窓は答えない）
    if blank || (crate::worksum::truthy(&parsed) && !parsed.is_object()) {
        return None;
    }
    let empty = Map::new();
    let d = parsed.as_object().unwrap_or(&empty);
    if !pr::plain_input(d) {
        return None;
    }
    // 中身を字で送り、窓が読めない字なら Python に任せる（clean_body の Ok(None)）
    if let Some(Value::String(t)) = d.get("body") {
        if pr::text_split(t) {
            return None;
        }
    }
    let body_text = |b: Option<&Value>| -> Result<String, String> {
        clean_body(b).and_then(|x| x.map(|(_, t)| t).ok_or_else(|| "セットの中身の形が違います。".into()))
    };
    let (row, base, id) = match route {
        Route::Create => {
            let row = match pr::clean_row(d, &who.login, false, SOURCE, &body_text) {
                Ok(r) => r,
                Err(m) => return Some(layout_error(m)),
            };
            if let Err(a) = who.gate(&row, WHAT) {
                return Some(a);
            }
            (row, None, None)
        }
        Route::Update(id) => {
            let base = match base_rev(&parsed, query) {
                Some(Rev::Unknown) => return None,
                b => b,
            };
            let Some(old) = find(id).filter(|r| r.get("元").and_then(Value::as_str) == Some(SOURCE)) else {
                return Some(layout_error(format!("セット id={id} が見つかりません（ほかの PC が消した可能性があります）。")));
            };
            if let Err(a) = who.gate(old, WHAT) {
                return Some(a);
            }
            let mut row = match pr::clean_row(d, &who.login, true, SOURCE, &body_text) {
                Ok(r) => r,
                Err(m) => return Some(layout_error(m)),
            };
            row.retain(|k, _| ["名前", "中身", "標準", "備考"].contains(&k.as_str()));
            (row, base, Some(id))
        }
        _ => return None,
    };
    Some(match pr::write(store, &DASHBOARDS, id, &row, base, "ダッシュボード") {
        Ok(Value::Object(done)) => (if id.is_none() { 201 } else { 200 }, who.view(&done, view_body(&done))),
        Ok(_) => (500, json!({"error": "セットを書けませんでした。", "kind": "error"})),
        Err(e) => (e.status(), e.payload()),
    })
}
