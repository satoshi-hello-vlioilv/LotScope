//! カードの設計の道（版 3.80.0）。Python の routes/dashboard.py のカードの 4 本を窓が受ける:
//!
//! ```text
//! GET    /api/card-forms?source=card:…   … その表のカードの設計の並び（自分の ID → 共通 → 共通デフォルト）・いま当てる標準・書けるか・方眼の範囲と色の鍵
//! POST   /api/card-forms                 … 足す（201。{name, source, scope: default|all|me, standard, body, note}）
//! PUT    /api/card-forms/<id>            … 直す（名前・中身・標準・備考。本文 base_rev は開いたときの行の版）
//! DELETE /api/card-forms/<id>            … 消す（?rev= は開いたときの行の版。無い行・カードでない行は何もせず ok）
//! ```
//!
//! 行の決まり（範囲・★標準・書ける人・名前の重なり）は src/preset_rows.rs、中身の決まりは services/card_forms.clean_body と同じ
//! （評価関数: tests/cards_parity.rs ← program/tests/cards_oracle.py）。置き場はマスタ dashboards の行のうち元が「card:」で始まる行。
//!
//! 窓が答えず Python に任せる形（card_plain）: 項目の名前・列・式・字・日付の列・タブの名前が並び・表（Python は repr の字で置く）・
//! 項目のタブが並び・表（Python は TypeError）・方眼の数の字に ASCII でない字（全角の数字・ASCII でない空白・制御字。Python の int() の
//! 読みと窓の読みが割れうる）や 4,000 字を超える字（Python は桁の上限で既定の値）・中身の字を窓が Python と同じに読めない（text_split）。
//! ほかはセットと同じ（preset_rows::plain_input・rows_plain・Place::split_file・share_absent・ASCII でない id）。

use crate::master_rows::{self, base_rev, Rev};
use crate::master_store::Store;
use crate::preset_rows::{self as pr, Answer, Who, DASHBOARDS};
use crate::worksum::{py_str, truthy};
use serde_json::{json, Map, Value};

pub const PREFIX: &str = "card:";
const WHAT: &str = "カードの設計";
const MAX_ITEMS: usize = 250;
const MAX_TABS: usize = 12;
const MAX_DATE_COLS: usize = 30;
const COLS: (i64, i64, i64) = (6, 24, 12);
const ROW: (i64, i64, i64) = (32, 96, 48);
const MAX_Y: i64 = 200;
const MAX_H: i64 = 24;
const MAX_BYTES: usize = 64 * 1024;
const KINDS: [&str; 5] = ["field", "combo", "text", "section", "dates"];
const FS: [&str; 4] = ["s", "m", "l", "xl"];
const ALIGN: [&str; 3] = ["left", "center", "right"];
const LAB: [&str; 8] = ["top", "bottom", "left", "spread", "legend", "tag", "inline", "none"];
const BORDER: [&str; 3] = ["line", "none", "strong"];
const DENSITY: [&str; 3] = ["normal", "compact", "roomy"];
const COLORS: [&str; 9] = ["", "ink", "muted", "blue", "teal", "green", "amber", "red", "purple"];
const BGS: [&str; 9] = ["", "white", "pale", "blue", "teal", "green", "amber", "red", "gray"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    List,
    Create,
    Update(i64),
    Delete(i64),
}

pub fn route_of(method: &str, path: &str) -> Option<Route> {
    let rest = path.strip_prefix("/api/card-forms")?;
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

/// 表の鍵（card_forms._SOURCE: card:(lotlist|worklog|src:[a-z0-9]{1,16}):[^\x00-\x1f]{0,120}）
pub fn source_ok(s: &str) -> bool {
    let Some(rest) = s.strip_prefix(PREFIX) else { return false };
    let tail = if let Some(t) = rest.strip_prefix("lotlist:").or_else(|| rest.strip_prefix("worklog:")) {
        t
    } else if let Some(t) = rest.strip_prefix("src:") {
        let Some(i) = t.find(':') else { return false };
        let key = &t[..i];
        if !(1..=16).contains(&key.len()) || !key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) {
            return false;
        }
        &t[i + 1..]
    } else {
        return false;
    };
    tail.chars().count() <= 120 && tail.chars().all(|c| (c as u32) > 0x1f)
}

fn card_error(msg: impl Into<String>) -> Answer {
    (400, json!({"error": msg.into(), "kind": "error", "type": "CardFormError"}))
}

/// Python の int(v) を範囲に収める（card_forms._int。読めなければ既定の値。card_plain を通った値だけを渡す）
fn int_of(v: Option<&Value>, lo: i64, hi: i64, default: i64) -> i64 {
    let n: Option<i128> = match v {
        Some(Value::Bool(b)) => Some(*b as i128),
        Some(Value::Number(n)) => {
            n.as_i64().map(i128::from).or_else(|| n.as_f64().filter(|f| f.is_finite()).map(|f| f.trunc().clamp(-1e30, 1e30) as i128))
        }
        Some(Value::String(s)) => {
            let t = s.trim_matches(|c: char| c == ' ' || ('\t'..='\r').contains(&c));
            let (neg, body) = match t.as_bytes().first() {
                Some(b'-') => (true, &t[1..]),
                Some(b'+') => (false, &t[1..]),
                _ => (false, t),
            };
            let ok = !body.is_empty()
                && !body.starts_with('_')
                && !body.ends_with('_')
                && !body.contains("__")
                && body.bytes().all(|b| b.is_ascii_digit() || b == b'_');
            ok.then(|| {
                let digits: String = body.chars().filter(|c| *c != '_').collect();
                // 先頭の 0 は桁に数えない（Python の int("0"×30+"7") は 7。版 3.80.0 の作った後の採点で見つかった）
                let digits = digits.trim_start_matches('0');
                let v: i128 = if digits.len() > 30 { i128::MAX / 2 } else { digits.parse().unwrap_or(0) };
                if neg {
                    -v
                } else {
                    v
                }
            })
        }
        _ => None,
    };
    match n {
        Some(n) => n.clamp(lo as i128, hi as i128) as i64,
        None => default,
    }
}

fn pick<'a>(v: Option<&Value>, allowed: &[&'a str], default: &'a str) -> &'a str {
    v.and_then(Value::as_str).and_then(|s| allowed.iter().find(|a| **a == s).copied()).unwrap_or(default)
}

/// Python の str(v or "")（並び・表は card_plain が先に任せる）
fn str_or(v: Option<&Value>) -> String {
    match v {
        Some(x) if truthy(x) => py_str(x),
        _ => String::new(),
    }
}

fn take(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn id_ok(t: &str) -> bool {
    (1..=24).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// 方眼の数の字を窓が Python の int() と同じに読めるか（ASCII の数字・符号・下線・ASCII の空白だけ・4,000 字まで）
fn int_plain(v: Option<&Value>) -> bool {
    match v {
        Some(Value::String(s)) => {
            s.len() <= 4000
                && s.bytes().all(|b| b.is_ascii_digit() || b"+-_ \t\n\r\x0b\x0c".contains(&b) || b.is_ascii_alphabetic() || b == b'.')
        }
        Some(Value::Array(_) | Value::Object(_)) => true, // int([]) は TypeError で既定の値（窓も既定）
        _ => true,
    }
}

fn scalar(v: Option<&Value>) -> bool {
    !matches!(v, Some(Value::Array(_) | Value::Object(_)))
}

/// 中身（表）を窓が Python と同じに扱えるか（上の「任せる形」）
fn card_plain(body: &Value) -> bool {
    let Some(b) = body.as_object() else { return true };
    let ints = |o: &Map<String, Value>, ks: &[&str]| ks.iter().all(|k| int_plain(o.get(*k)));
    if !ints(b, &["cols", "row"]) || !b.get("theme").and_then(Value::as_object).is_none_or(|t| int_plain(t.get("radius"))) {
        return false;
    }
    let tabs_ok =
        b.get("tabs").and_then(Value::as_array).is_none_or(|ts| ts.iter().filter_map(Value::as_object).all(|t| scalar(t.get("name"))));
    let items_ok = b.get("items").and_then(Value::as_array).is_none_or(|is| {
        is.iter().filter_map(Value::as_object).all(|it| {
            ints(it, &["w", "x", "h", "y"])
                && ["label", "col", "expr", "text", "tab"].iter().all(|k| scalar(it.get(*k)))
                && it.get("cols").and_then(Value::as_array).is_none_or(|cs| cs.iter().all(|c| scalar(Some(c))))
        })
    });
    tabs_ok && items_ok
}

/// 中身の字・表 → 窓が答えてよいか（字は text_split も見る）
fn body_plain(b: Option<&Value>) -> bool {
    match b {
        Some(Value::String(t)) => !master_rows::text_split(t) && serde_json::from_str::<Value>(t).map_or(true, |v| card_plain(&v)),
        Some(v) => card_plain(v),
        None => true,
    }
}

fn overlaps(a: &Map<String, Value>, b: &Map<String, Value>) -> bool {
    let n = |o: &Map<String, Value>, k: &str| o[k].as_i64().unwrap_or(0);
    n(a, "x") < n(b, "x") + n(b, "w")
        && n(b, "x") < n(a, "x") + n(a, "w")
        && n(a, "y") < n(b, "y") + n(b, "h")
        && n(b, "y") < n(a, "y") + n(a, "h")
}

fn style(st: Option<&Value>) -> Value {
    let st = st.filter(|v| v.is_object());
    let g = |k: &str| st.and_then(|s| s.get(k));
    json!({"fs": pick(g("fs"), &FS, "m"), "bold": g("bold").is_some_and(truthy), "color": pick(g("color"), &COLORS, ""),
           "bg": pick(g("bg"), &BGS, ""), "align": pick(g("align"), &ALIGN, "left"), "lab": pick(g("lab"), &LAB, "top"),
           "border": pick(g("border"), &BORDER, "line")})
}

/// カードの設計の中身（表か JSON 字）→ (中身, 置く字)（card_forms.clean_body。body_plain を通った物だけを渡す）
fn clean_body(body: Option<&Value>) -> Result<(Value, String), String> {
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
    let cols = int_of(b.get("cols"), COLS.0, COLS.1, COLS.2);
    let th = b.get("theme").filter(|v| v.is_object());
    let tg = |k: &str| th.and_then(|t| t.get(k));
    let accent = pick(tg("accent"), &COLORS, "blue");
    let theme = json!({"accent": if accent.is_empty() { "blue" } else { accent }, "density": pick(tg("density"), &DENSITY, "normal"),
                       "radius": int_of(tg("radius"), 0, 16, 9)});
    let (mut tabs, mut tab_ids): (Vec<Value>, Vec<String>) = (vec![], vec![]);
    for (k, t) in b.get("tabs").and_then(Value::as_array).into_iter().flatten().enumerate() {
        let Some(t) = t.as_object() else { continue };
        if tabs.len() >= MAX_TABS {
            continue;
        }
        let mut tid = str_or(t.get("id"));
        if !id_ok(&tid) || tab_ids.contains(&tid) {
            tid = format!("t{}", k + 1);
            while tab_ids.contains(&tid) {
                tid.push('x');
            }
        }
        tab_ids.push(tid.clone());
        let dflt = format!("タブ {}", k + 1);
        let raw = match t.get("name") {
            Some(x) if truthy(x) => py_str(x),
            _ => dflt.clone(),
        };
        let name = take(crate::pyfmt::strip(&raw), 30);
        tabs.push(json!({"id": tid, "name": if name.is_empty() { dflt } else { name }}));
    }
    let raw = b.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
    if raw.len() > MAX_ITEMS {
        return Err(format!("項目は {MAX_ITEMS} までです。"));
    }
    let (mut items, mut ids): (Vec<Map<String, Value>>, Vec<String>) = (vec![], vec![]);
    for (i, it) in raw.iter().enumerate() {
        let Some(it) = it.as_object() else { continue };
        let kind = pick(it.get("kind"), &KINDS, "field");
        let mut iid = str_or(it.get("id"));
        if !id_ok(&iid) || ids.contains(&iid) {
            iid = format!("i{}", i + 1);
            while ids.contains(&iid) {
                iid.push('x');
            }
        }
        ids.push(iid.clone());
        let w = int_of(it.get("w"), 1, cols, 3);
        let x = int_of(it.get("x"), 0, cols - w, 0);
        let h = int_of(it.get("h"), 1, MAX_H, 1);
        let y = int_of(it.get("y"), 0, MAX_Y, 0);
        let mut o = Map::new();
        for (k, v) in [("id", json!(iid)), ("kind", json!(kind)), ("x", json!(x)), ("y", json!(y)), ("w", json!(w)), ("h", json!(h))] {
            o.insert(k.into(), v);
        }
        let label = take(&str_or(it.get("label")), 60);
        o.insert("label".into(), json!(label));
        o.insert("st".into(), style(it.get("st")));
        if !tabs.is_empty() {
            let tab = it.get("tab").and_then(Value::as_str).filter(|t| tab_ids.iter().any(|x| x == t));
            o.insert("tab".into(), json!(tab.map(str::to_string).unwrap_or_else(|| tab_ids[0].clone())));
        }
        let name_of = |o: &Map<String, Value>| {
            let l = o["label"].as_str().unwrap_or("").to_string();
            if !l.is_empty() {
                return l;
            }
            o.get("col")
                .and_then(Value::as_str)
                .filter(|c| !c.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| o["id"].as_str().unwrap_or("").to_string())
        };
        match kind {
            "field" => {
                let col = take(&str_or(it.get("col")), 200);
                if col.is_empty() {
                    return Err(format!("{} つ目の項目の列がありません。", i + 1));
                }
                o.insert("col".into(), json!(col));
            }
            "combo" => {
                let expr = take(crate::pyfmt::strip(&str_or(it.get("expr"))), 2000);
                if expr.is_empty() {
                    return Err(format!("組み合わせた項目「{}」の中身（式）がありません。", if label.is_empty() { &iid } else { &label }));
                }
                o.insert("expr".into(), json!(expr));
            }
            "dates" => {
                let cs: Vec<String> = it
                    .get("cols")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter(|c| !crate::pyfmt::strip(&str_or(Some(c))).is_empty())
                    .map(|c| take(&py_str(c), 200))
                    .take(MAX_DATE_COLS)
                    .collect();
                if cs.is_empty() {
                    return Err(format!("日付のまとまり「{}」に列がありません。", if label.is_empty() { &iid } else { &label }));
                }
                o.insert("cols".into(), json!(cs));
            }
            _ => {
                o.insert("text".into(), json!(take(&str_or(it.get("text")), 400)));
                if kind == "section" {
                    let fold = it.get("fold").is_some_and(truthy);
                    o.insert("fold".into(), json!(fold));
                    o.insert("shut".into(), json!(it.get("shut").is_some_and(truthy) && fold));
                }
            }
        }
        if let Some(hit) = items.iter().find(|q| q.get("tab") == o.get("tab") && overlaps(q, &o)) {
            return Err(format!("項目「{}」と「{}」が重なっています。", name_of(&o), name_of(hit)));
        }
        items.push(o);
    }
    let mut out = json!({"cols": cols, "row": int_of(b.get("row"), ROW.0, ROW.1, ROW.2), "theme": theme,
                         "items": items.into_iter().map(Value::Object).collect::<Vec<_>>()});
    if !tabs.is_empty() {
        out["tabs"] = json!(tabs);
    }
    let text = crate::join::py_dumps(&out);
    if text.len() > MAX_BYTES {
        return Err("カードの設計が大きすぎます。".into());
    }
    Ok((out, text))
}

/// 置き場の中身の字 → 画面の body（card_forms.view: 読めなければ既定の形。中身が空なら "{}" を読んだ形）
fn view_body(row: &Map<String, Value>) -> Value {
    let t = row.get("中身").and_then(Value::as_str).filter(|t| !t.is_empty()).unwrap_or("{}");
    match clean_body(Some(&json!(t))) {
        Ok((b, _)) => b,
        Err(_) => json!({"cols": COLS.2, "row": ROW.2, "theme": {}, "items": []}),
    }
}

fn is_card(r: &Map<String, Value>) -> bool {
    r.get("元").and_then(Value::as_str).is_some_and(|s| s.starts_with(PREFIX))
}

/// 置き場から行を読んで答える（Lot::cards_route と試験 tests/cards_parity.rs の入口）。窓が答えない形は None
pub fn answer(store: &Store, me: &Value, route: Route, query: &str, body: &[u8], place: &crate::access::Place) -> Option<Answer> {
    if place.split_file(DASHBOARDS.name) || (route == Route::List && place.share_absent(DASHBOARDS.name)) {
        return None;
    }
    let rows = place.rows(DASHBOARDS.name).ok()?;
    if !pr::rows_plain(&rows) {
        return None;
    }
    // 置き場のカードの行の中身も、窓が Python と同じに読み直せること（画面の形は中身を確かめ直して作る）
    if !rows.iter().filter_map(Value::as_object).filter(|r| is_card(r)).all(|r| body_plain(r.get("中身"))) {
        return None;
    }
    let who = Who::of(me, DASHBOARDS.name);
    if route == Route::List {
        let q = crate::lotlist::parse_query(query);
        let src = q.iter().find(|(k, _)| k == "source").map(|(_, v)| v.clone()).unwrap_or_default();
        if !source_ok(&src) {
            return Some((400, json!({"error": "表の鍵（source）が違います。", "kind": "invalid"})));
        }
        let mine: Vec<&Map<String, Value>> = rows
            .iter()
            .filter_map(Value::as_object)
            .filter(|r| is_card(r) && r.get("元").and_then(Value::as_str) == Some(src.as_str()) && pr::visible(r, &who.login))
            .collect();
        let std = pr::standard_for(&mine, &src, &who.login);
        let mut items: Vec<Value> = mine.iter().map(|r| who.view(r, view_body(r))).collect();
        pr::sort_views(&mut items);
        return Some((
            200,
            json!({"items": items, "standardId": std.and_then(|r| r.get("id")).cloned().unwrap_or(Value::Null), "login": who.login,
                   "canEditCommon": who.common_ok, "canEditDefault": who.default_ok, "cols": [COLS.0, COLS.1, COLS.2],
                   "row": [ROW.0, ROW.1, ROW.2], "colors": COLORS, "bgs": BGS}),
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
            return None;
        }
        let base = match base_rev(&parsed, query) {
            Some(Rev::Unknown) => return None,
            b => b,
        };
        let Some(old) = find(id).filter(|r| is_card(r)) else { return Some((200, json!({"ok": true}))) };
        if let Err(a) = who.gate(old, WHAT) {
            return Some(a);
        }
        return Some(match master_rows::delete(store, &DASHBOARDS, id, base) {
            Ok(()) => (200, json!({"ok": true})),
            Err(e) => (e.status(), e.payload()),
        });
    }
    if blank || (truthy(&parsed) && !parsed.is_object()) {
        return None;
    }
    let empty = Map::new();
    let d = parsed.as_object().unwrap_or(&empty);
    if !pr::plain_input(d) || !body_plain(d.get("body")) {
        return None;
    }
    let body_text = |b: Option<&Value>| -> Result<String, String> { clean_body(b).map(|(_, t)| t) };
    let (row, base, id) = match route {
        Route::Create => {
            let src = d.get("source").and_then(Value::as_str).filter(|s| source_ok(s));
            let row = match pr::clean_row(d, &who.login, false, src, &body_text) {
                Ok(r) => r,
                Err(m) => return Some(card_error(m)),
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
            let Some(old) = find(id).filter(|r| is_card(r)) else {
                return Some(card_error(format!("カードの設計 id={id} が見つかりません（ほかの PC が消した可能性があります）。")));
            };
            if let Err(a) = who.gate(old, WHAT) {
                return Some(a);
            }
            let mut row = match pr::clean_row(d, &who.login, true, None, &body_text) {
                Ok(r) => r,
                Err(m) => return Some(card_error(m)),
            };
            row.retain(|k, _| ["名前", "中身", "標準", "備考"].contains(&k.as_str()));
            (row, base, Some(id))
        }
        _ => return None,
    };
    Some(match pr::write(store, &DASHBOARDS, id, &row, base, "ダッシュボード") {
        Ok(Value::Object(done)) => (if id.is_none() { 201 } else { 200 }, who.view(&done, view_body(&done))),
        Ok(_) => (500, json!({"error": "カードの設計を書けませんでした。", "kind": "error"})),
        Err(e) => (e.status(), e.payload()),
    })
}
