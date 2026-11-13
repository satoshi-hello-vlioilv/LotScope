//! ダッシュボードの道（版 3.82.0）。Python の routes/dashboard.py のダッシュボードの 5 本を窓が受ける:
//!
//! ```text
//! GET    /api/dashboards          … ダッシュボードの並び（自分の ID → 共通 → 共通デフォルト〈置いた物 → 組み込み〉）・いま開く標準・外した組み込み
//! PUT    /api/dashboards-hidden   … 組み込みを外す・戻す（{scope: default|me, keys: [組み込みの鍵]}。keys が空ならその置き場の行を消す）
//! POST   /api/dashboards          … 足す（201。{name, scope: default|all|me, standard, body: {rows, panels}, note}）
//! PUT    /api/dashboards/<id>     … 直す（名前・中身・標準・備考。本文 base_rev は開いたときの行の版）
//! DELETE /api/dashboards/<id>     … 消す（?rev= は開いたときの行の版。無い行・ダッシュボードでない行は何もせず ok）
//! ```
//!
//! 中身の確かめは版 3.81.0 の部品（src/layout_clean.rs）、行の決まりは src/preset_rows.rs。組み込みのダッシュボードは Python の BUILTIN_LAYOUTS を
//! 焼いた表（src/dash_builtins.json。program/tools/dash-builtins.py が焼き、古い表は tests/test_dash_builtins.py が止める）。
//! 評価関数: tests/dashboards_parity.rs ← program/tests/dashboards_oracle.py。
//!
//! Python と同じにするための決まり（版 3.82.0 の案の採点の指摘）:
//! - 組み込みと同じ名前で自分の ID か共通デフォルトに置く行は、中身に replaces を入れる（with_builtin_replace）。Python はこのとき中身の確かめを
//!   2〜3 回通し、通すたびに字が変わることがある（題の末尾の空白を 60 字で切った後に strip する等）・大きさも確かめ直すので、窓も同じ回数だけ通す
//! - 中身は送った順のまま確かめる（本文を送った順の木 jsontree でも読む）
//! - 一覧を読むとき、組み込みと同じ名前の行の中身が確かめに通らないと Python は 500（窓は答えない）
//! - 一覧は前の版の条件のマスタ dashboard_settings も読む（まだ無い・読めない・行が表でないときは窓は答えない）

use crate::jsontree::Tree;
use crate::layout_clean::{self as lc, Stop};
use crate::master_rows::{self, base_rev};
use crate::master_store::Store;
use crate::preset_rows::{self as pr, Answer, Who, DASHBOARDS};
use crate::worksum::truthy;
use serde_json::{json, Map, Value};
use std::cell::Cell;
use std::sync::OnceLock;

pub const SOURCE: &str = "dash";
const HIDE_SOURCE: &str = "dashoff";
const HIDE_NAME: &str = "外した組み込み";
const SETTINGS: &str = "dashboard_settings";
const WHAT: &str = "ダッシュボード";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    List,
    Hidden,
    Create,
    Update(i64),
    Delete(i64),
}

pub fn route_of(method: &str, path: &str) -> Option<Route> {
    if path == "/api/dashboards-hidden" {
        return (method == "PUT").then_some(Route::Hidden);
    }
    let rest = path.strip_prefix("/api/dashboards")?;
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

fn layout_error(msg: impl Into<String>) -> Answer {
    (400, json!({"error": msg.into(), "kind": "error", "type": "LayoutError"}))
}

/// 組み込みのダッシュボード（鍵・名前・画面の形。Python から焼いた表）
fn builtins() -> &'static [Value] {
    static TABLE: OnceLock<Value> = OnceLock::new();
    TABLE.get_or_init(|| serde_json::from_str(include_str!("dash_builtins.json")).expect("組み込みのダッシュボードの表"))["layouts"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn s<'a>(r: &'a Map<String, Value>, k: &str) -> Option<&'a str> {
    r.get(k).and_then(Value::as_str)
}

/// builtin_named: 組み込みと同じ名前で、自分の ID か共通デフォルトに置く行なら、その組み込みの鍵
fn builtin_named(row: &Map<String, Value>) -> Option<String> {
    let scope = s(row, "範囲")?;
    if scope != pr::scope_value("default") && scope != pr::scope_value("me") {
        return None;
    }
    let name = row.get("名前").filter(|v| truthy(v)).map(crate::worksum::py_str).unwrap_or_default();
    let name = crate::pyfmt::strip(&name);
    builtins().iter().find(|b| b["name"].as_str() == Some(name)).and_then(|b| b["key"].as_str()).map(str::to_string)
}

/// 中身の字を確かめ直す（clean_layout(字)）
fn clean_text(text: &str) -> Result<(Value, String), Stop> {
    lc::clean_layout(&Tree::Str(text.to_string()))
}

/// with_builtin_replace: 行の中身に replaces を入れる（組み込みと同じ名前で置く物は、その組み込みの代わり）。old は直すときの前の行
fn with_builtin_replace(row: Map<String, Value>, old: Option<&Map<String, Value>>) -> Result<Map<String, Value>, Stop> {
    let mut whole = old.cloned().unwrap_or_default();
    whole.extend(row.clone());
    let Some(key) = builtin_named(&whole) else { return Ok(row) };
    let text = s(&whole, "中身").filter(|t| !t.is_empty()).unwrap_or("{}").to_string();
    let (body, _) = clean_text(&text)?;
    if body.get("replaces").and_then(Value::as_str) == Some(key.as_str()) {
        return Ok(row);
    }
    let mut tree = Tree::from_value(&body);
    if let Tree::Obj(m) = &mut tree {
        match m.iter_mut().find(|(k, _)| k == "replaces") {
            Some(slot) => slot.1 = Tree::Str(key),
            None => m.push(("replaces".into(), Tree::Str(key))),
        }
    }
    let (_, text) = lc::clean_layout(&tree)?;
    let mut row = row;
    row.insert("中身".into(), json!(text));
    Ok(row)
}

/// layout_view の body（中身が確かめに通らなければ {rows: 8, panels: []}。Python に任せる形は Err）
fn view_body(row: &Map<String, Value>) -> Result<Value, ()> {
    let text = s(row, "中身").filter(|t| !t.is_empty()).unwrap_or("{}");
    match clean_text(text) {
        Ok((b, _)) => Ok(b),
        Err(Stop::Layout(_)) => Ok(json!({"rows": lc::ROWS_DEFAULT, "panels": []})),
        Err(Stop::Py) => Err(()),
    }
}

fn is_dash(r: &Map<String, Value>) -> bool {
    s(r, "元") == Some(SOURCE)
}

/// builtin_skip: 一覧に出さない組み込みの鍵 → (外した鍵と範囲〈置いた順〉, 入れ替えた鍵)
/// 外した組み込みの鍵と、その行の範囲（置いた順）
type Off = Vec<(String, &'static str)>;

fn builtin_skip(rows: &[Value], login: &str) -> Result<(Off, Vec<String>), Stop> {
    let mut off: Off = vec![];
    for r in rows.iter().filter_map(Value::as_object).filter(|r| s(r, "元") == Some(HIDE_SOURCE) && pr::visible(r, login)) {
        let text = s(r, "中身").filter(|t| !t.is_empty()).unwrap_or("{}");
        // 中身が表でない・keys が数の行は、外した鍵なしとして読む（Python の builtin_skip の except。版 3.107.0 の割れ 8）
        if let Some(b) = Tree::parse(&crate::master_rows::inner_text(text)) {
            let bad_body = lc::truthy(&b) && !matches!(b, Tree::Obj(_));
            let bad_keys = b.get("keys").is_some_and(|k| lc::truthy(k) && !matches!(k, Tree::Arr(_) | Tree::Str(_) | Tree::Obj(_)));
            if bad_body || bad_keys {
                continue;
            }
        }
        let (v, _) = lc::clean_hide_body(&Tree::Str(text.to_string()))?;
        for k in v["keys"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            if !off.iter().any(|(x, _)| x == k) {
                off.push((k.to_string(), pr::scope_of(r)));
            }
        }
    }
    let mut swapped = vec![];
    for r in rows.iter().filter_map(Value::as_object).filter(|r| is_dash(r) && pr::visible(r, login)) {
        let text = s(r, "中身").filter(|t| !t.is_empty()).unwrap_or("{}");
        let rep = serde_json::from_str::<Value>(&crate::master_rows::inner_text(text)).ok().and_then(|v| v.get("replaces").cloned());
        let k = match rep.as_ref().and_then(Value::as_str) {
            Some(k) if lc::BUILTIN_KEYS.contains(&k) => Some(k.to_string()),
            _ => builtin_named(r),
        };
        if let Some(k) = k {
            if !swapped.contains(&k) {
                swapped.push(k);
            }
        }
    }
    Ok((off, swapped))
}

/// with_legacy_conditions: 前の版の 1 枚の表（合わせた表で legacy の印のある物）へ、前の版の条件を入れる
fn with_legacy_conditions(body: &mut Value, conds: &Option<Value>) {
    let Some(conds) = conds else { return };
    for p in body.get_mut("panels").and_then(Value::as_array_mut).into_iter().flatten() {
        if p["visual"] == "board" && p.get("legacy").is_some_and(truthy) {
            if let (Some(o), Value::Object(d)) = (p.as_object_mut(), lc::board_default(Some(conds))) {
                o.extend(d);
            }
        }
    }
}

/// 置き場から行を読んで答える（Lot::dashboards_route と試験 tests/dashboards_parity.rs の入口）。窓が答えない形は None
pub fn answer(store: &Store, me: &Value, route: Route, query: &str, body: &[u8], place: &crate::access::Place) -> Option<Answer> {
    let name = DASHBOARDS.name;
    // 一覧は、共有にまだ無ければ Python の読みと同じく最初の版を置いてから読む（ダッシュボードと前の版の条件。版 3.105.0。
    // 置けなければ前どおり任せる）
    if place.split_file(name) || (route == Route::List && (place.split_file(SETTINGS) || !store.seed_absent(&[name, SETTINGS]))) {
        return None;
    }
    // 置き場の読めない行は隔てる（版 3.107.0。前は任せた）。組ごとの中身の確かめ（組み込みと同じ名前の行・外した組み込み・前の版の条件）は
    // まだ任せる（Python は LayoutError の 500・AttributeError で落ちる。row_check で隔てる形にしていない）
    let (all, iso) = pr::read_rows(&place.rows_all(name).ok()?, name)?;
    let rows = pr::good_rows(name, &all, &iso);
    let who = Who::of(me, name);
    if route == Route::List {
        // 前の版の条件のマスタの読めない行（表でない・条件が表でない）は隔てて読む（版 3.107.0。前は Python が落ちた）
        let mut settings = place.rows_all(SETTINGS).ok()?;
        crate::master_rows::normalize_all(
            &mut settings,
            &master_rows::Spec { name: SETTINGS, fields: &["キー", "条件", "備考"], unique: Some("キー"), renamed: &[] },
        );
        if crate::row_check::wide_content(SETTINGS, &settings) {
            return None;
        }
        let siso = crate::row_check::check(SETTINGS, &settings, &["キー", "条件", "備考"]);
        let settings = pr::good_rows(SETTINGS, &settings, &siso);
        let mut out = list(&rows, &settings, &who)?;
        crate::row_check::notes(out.1.as_object_mut().unwrap(), name, &all, &iso, place.share_problem(name));
        return Some(out);
    }
    if master_rows::unreadable(body) {
        return None;
    }
    let blank = body.iter().all(|b| b.is_ascii_whitespace());
    let parsed: Value = if blank { Value::Null } else { serde_json::from_slice(body).ok()? };
    let tree: Tree = if blank { Tree::Null } else { serde_json::from_slice(body).ok()? };
    let find = |id: i64, delete: bool| pr::find_row(name, &all, &iso, id, delete);
    if let Route::Delete(id) = route {
        if truthy(&parsed) && !parsed.is_object() {
            return None;
        }
        let base = base_rev(&parsed, query);
        let found = match find(id, true) {
            Ok(f) => f,
            Err(a) => return Some(a),
        };
        let Some(old) = found.filter(is_dash) else { return Some((200, json!({"ok": true}))) };
        if let Err(a) = who.gate(&old, WHAT) {
            return Some(a);
        }
        return Some(match master_rows::delete(store, &DASHBOARDS, id, base) {
            Ok(()) => (200, json!({"ok": true})),
            Err(e) => (e.status(), e.payload()),
        });
    }
    // 足す・直す・外すの本文は get_json(force=True) or {}: 空の本文は BadRequest、表でない真の本文は Python の例外（窓は答えない）
    if blank || (truthy(&parsed) && !parsed.is_object()) {
        return None;
    }
    let empty = Map::new();
    let d = parsed.as_object().unwrap_or(&empty);
    if route == Route::Hidden {
        return hidden(store, &who, d, &tree, &rows);
    }
    // 名前・備考・範囲の型は本文の門が断る（body_rules.TYPES。版 3.106.0。前は plain_input で任せていた）
    // 中身は送った順の木で確かめる（clean_row は serde の値を渡すので、その値は使わず木の body を見る）
    let py = Cell::new(false);
    let tree_body = tree.get("body").cloned().unwrap_or(Tree::Null);
    let body_text = |_: Option<&Value>| -> Result<String, String> {
        match lc::clean_layout(&tree_body) {
            Ok((_, t)) => Ok(t),
            Err(Stop::Layout(m)) => Err(m),
            Err(Stop::Py) => {
                py.set(true);
                Err(String::new())
            }
        }
    };
    let (row, base, id) = match route {
        Route::Create => {
            let row = match pr::clean_row(d, &who.login, false, Some(SOURCE), &body_text) {
                Ok(r) => r,
                Err(_) if py.get() => return None,
                Err(m) => return Some(layout_error(m)),
            };
            let row = match with_builtin_replace(row, None) {
                Ok(r) => r,
                Err(Stop::Py) => return None,
                Err(Stop::Layout(m)) => return Some(layout_error(m)),
            };
            if let Err(a) = who.gate(&row, WHAT) {
                return Some(a);
            }
            (row, None, None)
        }
        Route::Update(id) => {
            let base = base_rev(&parsed, query);
            // routes/dashboard.dashboards_update: id の行が無いかダッシュボードでなければ「見つかりません」
            let found = match find(id, false) {
                Ok(f) => f,
                Err(a) => return Some(a),
            };
            let Some(old) = found.filter(is_dash) else {
                return Some(layout_error(format!("id={id} が見つかりません（ほかの PC が消した可能性があります）。")));
            };
            if let Err(a) = who.gate(&old, WHAT) {
                return Some(a);
            }
            let row = match pr::clean_row(d, &who.login, true, None, &body_text) {
                Ok(r) => r,
                Err(_) if py.get() => return None,
                Err(m) => return Some(layout_error(m)),
            };
            let mut row = match with_builtin_replace(row, Some(&old)) {
                Ok(r) => r,
                Err(Stop::Py) => return None,
                Err(Stop::Layout(m)) => return Some(layout_error(m)),
            };
            row.retain(|k, _| ["名前", "中身", "標準", "備考"].contains(&k.as_str()));
            (row, base, Some(id))
        }
        _ => return None,
    };
    Some(match pr::write(store, &DASHBOARDS, id, &row, base, WHAT) {
        Ok(Value::Object(done)) => match view_body(&done) {
            Ok(b) => (if id.is_none() { 201 } else { 200 }, who.view(&done, b)),
            Err(()) => return None,
        },
        Ok(_) => (500, json!({"error": "ダッシュボードを書けませんでした。", "kind": "error"})),
        Err(e) => (e.status(), e.payload()),
    })
}

/// GET /api/dashboards
fn list(rows: &[Value], settings: &[Value], who: &Who) -> Option<Answer> {
    let mine: Vec<&Map<String, Value>> =
        rows.iter().filter_map(Value::as_object).filter(|r| is_dash(r) && pr::visible(r, &who.login)).collect();
    let std = pr::standard_for(&mine, SOURCE, &who.login);
    let mut items = vec![];
    for r in &mine {
        // 組み込みと同じ名前の行は中身に replaces を入れてから見せる（確かめに通らなければ Python は 500。窓は答えない）
        // 中身が確かめに通らなければ入れ替えずにそのまま出す（Python の with_builtin_replace_view。版 3.107.0 の割れ 8）
        let r2 = match with_builtin_replace((*r).clone(), None) {
            Ok(x) => x,
            Err(Stop::Layout(_)) => (*r).clone(),
            Err(Stop::Py) => return None,
        };
        items.push(who.view(&r2, view_body(&r2).ok()?));
    }
    pr::sort_views(&mut items);
    let (off, swapped) = builtin_skip(rows, &who.login).ok()?;
    for b in builtins() {
        let key = b["key"].as_str().unwrap_or("");
        if !off.iter().any(|(k, _)| k == key) && !swapped.iter().any(|k| k == key) {
            items.push(b["view"].clone());
        }
    }
    for x in items.iter_mut() {
        if let Some(rep) = x["body"].get("replaces").filter(|v| truthy(v)).map(crate::worksum::py_str) {
            x["replaces"] = json!(format!("b:{rep}"));
        }
    }
    // 前の版の 1 枚の表の条件（マスタ dashboard_settings）。条件があれば、legacy の印の合わせた表へ入れる
    let srows: Vec<Tree> = settings.iter().map(Tree::from_value).collect();
    let wip = lc::condition_of(&srows, "wip").ok()?;
    let work = lc::condition_of(&srows, "work").ok()?;
    let any = [&wip, &work]
        .iter()
        .any(|c| c["filters"].as_array().is_some_and(|a| !a.is_empty()) || c["search"].as_str().is_some_and(|s| !s.is_empty()));
    let conds = any.then(|| json!({"wip": wip, "work": work}));
    for x in items.iter_mut() {
        with_legacy_conditions(&mut x["body"], &conds);
    }
    let names: Vec<(&str, &str)> = builtins().iter().map(|b| (b["key"].as_str().unwrap_or(""), b["name"].as_str().unwrap_or(""))).collect();
    let hidden: Vec<Value> = off
        .iter()
        .map(|(k, sc)| json!({"id": format!("b:{k}"), "name": names.iter().find(|(x, _)| x == k).map(|(_, n)| *n).unwrap_or(k), "scope": sc}))
        .collect();
    let standard_id = match std {
        Some(r) => r.get("id").cloned().unwrap_or(Value::Null),
        None => items.last().map(|x| x["id"].clone()).unwrap_or(Value::Null),
    };
    Some((
        200,
        json!({"items": items, "login": who.login, "canEditCommon": who.common_ok, "canEditDefault": who.default_ok,
               "standardId": standard_id, "cols": lc::GRID_COLS, "rowsRange": [lc::ROWS_MIN, lc::ROWS_MAX], "hidden": hidden}),
    ))
}

/// PUT /api/dashboards-hidden（routes/dashboard.dashboards_hidden）
fn hidden(store: &Store, who: &Who, d: &Map<String, Value>, tree: &Tree, rows: &[Value]) -> Option<Answer> {
    let scope = d.get("scope").and_then(Value::as_str).filter(|s| *s == "default" || *s == "me");
    let Some(scope) = scope else { return Some(layout_error("置き場（default か me）が違います。")) };
    let mut want = Map::new();
    want.insert("元".into(), json!(HIDE_SOURCE));
    want.insert("範囲".into(), json!(pr::scope_value(scope)));
    want.insert("ログインID".into(), json!(if scope == "me" { who.login.as_str() } else { "" }));
    if let Err(a) = who.gate(&want, "組み込みのダッシュボード") {
        return Some(a);
    }
    let g = pr::group_of(&want);
    let old = rows.iter().filter_map(Value::as_object).find(|r| pr::group_of(r) == g);
    // keys は d.get("keys") or [] を {keys: …} にして確かめる（送った順の木で。数・真は Python が落ちる＝窓は答えない）
    let raw = match tree.get("keys") {
        Some(k) if lc::truthy(k) => k.clone(),
        _ => Tree::Arr(vec![]),
    };
    let (v, text) = lc::clean_hide_body(&Tree::Obj(vec![("keys".into(), raw)])).ok()?;
    let keys = v["keys"].clone();
    if keys.as_array().is_none_or(Vec::is_empty) {
        if let Some(o) = old {
            let id = o.get("id").and_then(Value::as_i64)?;
            if let Err(e) = master_rows::delete(store, &DASHBOARDS, id, None) {
                return Some((e.status(), e.payload()));
            }
        }
        return Some((200, json!({"ok": true, "keys": []})));
    }
    let done = match old {
        Some(o) => {
            let id = o.get("id").and_then(Value::as_i64)?;
            let mut data = Map::new();
            data.insert("中身".into(), json!(text));
            pr::write(store, &DASHBOARDS, Some(id), &data, None, WHAT)
        }
        None => {
            let input = json!({"name": HIDE_NAME, "scope": scope});
            let row = match pr::clean_row(input.as_object().unwrap(), &who.login, false, Some(HIDE_SOURCE), &|_| Ok(text.clone())) {
                Ok(r) => r,
                Err(m) => return Some(layout_error(m)),
            };
            pr::write(store, &DASHBOARDS, None, &row, None, WHAT)
        }
    };
    Some(match done {
        Ok(_) => (200, json!({"ok": true, "keys": keys})),
        Err(e) => (e.status(), e.payload()),
    })
}
