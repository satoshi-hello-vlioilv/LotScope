//! 設備グループの道（版 3.94.0）。Python の `routes/equipgroups.py` のマスタ管理の 4 本を窓が受ける:
//!
//! ```text
//! GET    /api/masters/equipgroups          … 一覧（表示順・まとめ方ごとの組・選べる設備〈実際に出てくる設備と、どこで見たか・件数〉・
//!                                              グループごとのいま当てはまる設備・ルールの比べ方・書けるか・共有か・版）
//! POST   /api/masters/equipgroups          … 足す（201・一覧＋created）
//! PUT    /api/masters/equipgroups/<id>     … 直す（来た物だけ。設備・ルール・除く設備の一部だけなら残りは今の行の値。本文 base_rev は開いたときの行の版）
//! DELETE /api/masters/equipgroups/<id>     … 消す（?rev= は開いたときの行の版）
//! ```
//!
//! 決まりは services/equip_groups.py と master_repository の equip_group_* と同じ（評価関数: tests/equipgroups_write_parity.rs ←
//! program/tests/equipgroups_oracle.py）。行の書き方は共通の型（src/master_rows.rs）、一覧の形は束と同じ bundle::group_views、
//! 当てはまる設備は dashboard::members_in、選べる設備は dashboard::equipment_seen（設備の木〈/api/dashboard/equip-tree〉と同じ 1 か所。
//! データ元の設備はダッシュボードの数え方で数える）。字は Python の `str(v or "")`（0・false は空）、比べ方は normalize_part
//! （NFKC・前後の空白を除く・大文字）。ルールの字は json.dumps の既定の区切り（", "・": "）で書く。
//!
//! 窓が答えず Python に任せる形: 空・読めない本文（Python は get_json(force=True) で 400 の HTML）・表でない真の本文のうち Python が
//! 道の外で落ちる物（直す・消す。500）・値が並び・表（Python の repr）・i64 に入らない数・正規表現のルール（re の言葉と重さの決まりは
//! Python。置き場の行にあっても任せる）・op が並び・表（unhashable）・表示順が i64 に入らない・置き場の行を窓が同じに読めない
//! （id・版・値の形・ルールの JSON の字・まとめ方が字でない）・置き場のファイルを窓が同じに読めない・選べる設備を窓が数えられない
//! （スケジュールの元・束を組めない）・i64 に入らない id・百分率符号の道。

use crate::access::{normalize_part, Place};
use crate::conversions_write::{of_master, rev_of, seed, strict};
use crate::jsontree::Tree;
use crate::master_rows::{self, Spec};
use crate::master_store::{MasterError, Store};
use crate::pyfmt::strip;
use crate::worksum::{equipment_list, py_str, truthy};
use serde_json::{json, Map, Value};

pub const NAME: &str = "equipment_groups";
const FIELDS: [&str; 6] = ["名称", "まとめ方", "設備", "ルール", "表示順", "備考"];
const SPEC: Spec = Spec { name: NAME, fields: &FIELDS, unique: None, renamed: &[] };
const NAME_MAX: usize = 40;
const MAX_RULES: usize = 12;
const SET_DEFAULT: &str = "グループ";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    List,
    Create,
    Update(i64),
    Delete(i64),
}

/// 窓が受ける道か（<int:item_id> は \d+ と int()。Unicode の数字・先頭の 0 も。i64 に入らない id は Python）
pub fn route_of(method: &str, path: &str) -> Option<Route> {
    let rest = path.strip_prefix("/api/masters/equipgroups")?;
    match (method, rest) {
        ("GET", "") => Some(Route::List),
        ("POST", "") => Some(Route::Create),
        ("PUT", r) => Some(Route::Update(crate::worklog_write::id_of(r.strip_prefix('/')?)?)),
        ("DELETE", r) => Some(Route::Delete(crate::worklog_write::id_of(r.strip_prefix('/')?)?)),
        _ => None,
    }
}

type Answer = (u16, Value);

/// 確かめで止まる理由: Python に任せる（Delegate）か、設備グループの誤り（GroupError の言葉）
enum Bad {
    Delegate,
    Group(String),
}
type C<T> = Result<T, Bad>;
/// ルール 1 つ（op, value）
type Rule = (String, String);

fn group<T>(m: impl Into<String>) -> C<T> {
    Err(Bad::Group(m.into()))
}

/// master_call の exception_error（GroupError）
fn group_error(m: String) -> Answer {
    (400, json!({"error": m, "kind": "error", "type": "GroupError"}))
}

// ------------------------------------------------------------------ 値の字（Python の str()）
/// str(v or "")（偽の値は空。並び・表・i64 に入らない整数は Python の書き方が要るので任せる）
fn s_or(v: Option<&Value>) -> C<String> {
    match v {
        Some(x) if truthy(x) => {
            if !master_rows::value_plain(x) {
                return Err(Bad::Delegate);
            }
            Ok(py_str(x))
        }
        _ => Ok(String::new()),
    }
}

fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// shifts.equipment_list（並びの中の 5・true・1.0 は「5」「True」「1.0」）。並び・表・大きな整数の字は Python の repr なので任せる
fn eq_list(v: Option<&Value>) -> C<Vec<String>> {
    let plain = |x: &Value| !truthy(x) || master_rows::value_plain(x);
    let ok = match v {
        Some(Value::Array(a)) => a.iter().all(plain),
        Some(x) => plain(x),
        None => true,
    };
    if !ok {
        return Err(Bad::Delegate);
    }
    Ok(equipment_list(v))
}

/// ルールの比べ方（pivot.RULE_OPS の鍵。焼いた表）
fn rule_ops() -> Vec<String> {
    crate::bundle::tables()["equipGroups"]["ruleOps"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|x| x.as_str().map(String::from))
        .collect()
}

/// clean_rules: [:12] で切ってから、表でない・知らない op・空の値を外し、重ねを除く。正規表現は Python（re の言葉と重さの決まり）
fn clean_rules(v: Option<&Value>) -> C<Vec<Rule>> {
    let Some(Value::Array(items)) = v else { return Ok(vec![]) };
    let ops = rule_ops();
    let mut out: Vec<Rule> = vec![];
    for r in items.iter().take(MAX_RULES) {
        let Some(o) = r.as_object() else { continue };
        let op = match o.get("op") {
            Some(Value::Array(_) | Value::Object(_)) => return Err(Bad::Delegate), // unhashable type（Python の TypeError）
            Some(Value::String(op)) if ops.contains(op) => op.clone(),
            _ => continue,
        };
        let val = cut(strip(&s_or(o.get("value"))?), 80);
        if val.is_empty() {
            continue;
        }
        if op == "regex" {
            // 書き方（src/equip_regex.rs）→ 読めるか → 重さ（版 3.102.0。前は正規表現を全部 Python に任せた）。Python の re が読めて
            // 窓が読めない形は Python の言葉で断るので任せる
            let why = crate::equip_regex::why_of(&val);
            if !why.is_empty() {
                return group(format!("正規表現「{val}」は{why}。"));
            }
            if fancy_regex::Regex::new(&val).is_err() {
                return Err(Bad::Delegate);
            }
            if let Some(risk) = crate::formula::regex_risk(&val.encode_utf16().collect::<Vec<u16>>()) {
                return group(format!("正規表現「{val}」: {risk}"));
            }
        }
        let x = (op, val);
        if !out.contains(&x) {
            out.push(x);
        }
    }
    Ok(out)
}

/// 置き場の行のルール（equip_groups.rules_of。束の読み方と同じ bundle::group_rules）→ (ルール, 除く設備)。読めない字は任せる。
/// 当てていない決まり（読めない・重い・窓で写せない正規表現）も、直すときに黙って消さないよう後ろに残す（版 3.102.0。Python の kept と同じ）
fn rules_of(row: &Map<String, Value>) -> C<(Vec<Rule>, Vec<String>)> {
    let (rules, ex, unapplied) = crate::bundle::group_rules(row).map_err(|_| Bad::Delegate)?;
    let rules = rules
        .as_array()
        .into_iter()
        .flatten()
        .chain(unapplied.iter().filter(|u| u["op"].as_str().is_some_and(|op| rule_ops().iter().any(|x| x == op))))
        .map(|r| (py_str(&r["op"]), py_str(&r["value"])))
        .collect();
    let ex = ex.as_array().into_iter().flatten().map(py_str).collect();
    Ok((rules, ex))
}

/// 表示順（str(int(order))。読めなければ ""）。一覧の表示順は i64 で渡すので、入らない数は任せる
fn order_text(v: Option<&Value>) -> C<String> {
    let t = master_rows::py_int_text(v).ok_or(Bad::Delegate)?;
    if !t.is_empty() && t.parse::<i64>().is_err() {
        return Err(Bad::Delegate);
    }
    Ok(t)
}

/// clean_row: 画面から来た値（name・set・equipment・rules・except・order・note）→ マスタの行。partial は直すとき（来た物だけ）。
/// 設備・ルール・除く設備は 1 組で置き、直すときに一部だけが来たら残りは今の行（old）の値で組む（版 3.94.0 で Python を直した形）
fn clean_row(data: &Map<String, Value>, partial: bool, old: Option<&Map<String, Value>>) -> C<Map<String, Value>> {
    let came = |k: &str| !partial || data.contains_key(k);
    let mut out = Map::new();
    if came("name") {
        let name = strip(&s_or(data.get("name"))?).to_string();
        if name.is_empty() {
            return group("グループの名称を入れてください。");
        }
        out.insert("名称".into(), json!(cut(&name, NAME_MAX)));
    }
    if came("set") {
        let set = strip(&s_or(data.get("set"))?).to_string();
        out.insert("まとめ方".into(), json!(cut(if set.is_empty() { SET_DEFAULT } else { &set }, NAME_MAX)));
    }
    if came("equipment") || came("rules") || came("except") {
        let empty = Map::new();
        let old = old.unwrap_or(&empty);
        let before = if partial && !(came("rules") && came("except")) { rules_of(old)? } else { (vec![], vec![]) };
        let eq = eq_list(if came("equipment") { data.get("equipment") } else { old.get("設備") })?;
        let rules = if came("rules") { clean_rules(data.get("rules"))? } else { before.0 };
        if eq.is_empty() && rules.is_empty() {
            return group("グループに入れる設備を 1 つ以上選ぶか、設備の名前の決まり（ルール）を 1 つ以上入れてください。");
        }
        out.insert("設備".into(), json!(eq.join(",")));
        let ex = if rules.is_empty() {
            vec![]
        } else if came("except") {
            eq_list(data.get("except"))?
        } else {
            before.1
        };
        let text = if rules.is_empty() {
            String::new()
        } else {
            let s = |x: &str| Tree::Str(x.to_string());
            let mut d = vec![(
                "rules".to_string(),
                Tree::Arr(rules.iter().map(|(op, v)| Tree::Obj(vec![("op".into(), s(op)), ("value".into(), s(v))])).collect()),
            )];
            if !ex.is_empty() {
                d.push(("except".into(), Tree::Arr(ex.iter().map(|x| s(x)).collect())));
            }
            Tree::Obj(d).dumps(", ", ": ")
        };
        out.insert("ルール".into(), json!(text));
    }
    if data.contains_key("order") {
        out.insert("表示順".into(), json!(order_text(data.get("order"))?));
    }
    if came("note") {
        out.insert("備考".into(), json!(cut(strip(&s_or(data.get("note"))?), 200)));
    }
    Ok(out)
}

/// 同じまとめ方の中で同じ名称を 2 つ持たない（equip_groups.check_unique。直すときは直した後の行で比べ、言葉はその行の字のまま）
fn check_unique(rows: &[Value], data: &Map<String, Value>, self_id: Option<i64>) -> Result<(), MasterError> {
    let key = (normalize_part(data.get("まとめ方")), normalize_part(data.get("名称")));
    let dflt = json!(SET_DEFAULT);
    for r in rows {
        let set = r.get("まとめ方").filter(|v| truthy(v)).unwrap_or(&dflt);
        if !master_rows::is_self(r, self_id) && (normalize_part(Some(set)), normalize_part(r.get("名称"))) == key {
            let text = |k: &str| py_str(data.get(k).unwrap_or(&Value::Null));
            return Err(MasterError::Duplicate(format!(
                "まとめ方「{}」には、グループ「{}」がもうあります。",
                text("まとめ方"),
                text("名称")
            )));
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ 読む
/// 置き場の行（窓が Python と同じに読める物だけ）: id・版・値の形（rows_plain）・一覧の形（bundle::group_views。正規表現のルール・
/// 読めない JSON の字・i64 に入らない表示順は任せる）・まとめ方は字（Python は字でないまとめ方を値のまま組に分ける）
fn read(place: &Place) -> Option<Vec<Value>> {
    if place.split_file(NAME) {
        return None;
    }
    let mut rows = place.rows(NAME).ok()?;
    if !master_rows::rows_plain(&rows, &FIELDS) {
        return None;
    }
    master_rows::normalize_all(&mut rows, &SPEC);
    if rows.iter().any(|r| r.get("まとめ方").is_some_and(|v| truthy(v) && !v.is_string())) {
        return None;
    }
    crate::bundle::group_views(&rows).ok()?;
    Some(rows)
}

/// 一覧（routes/equipgroups._listing）。seen は選べる設備（equipment_seen）
fn listing(store: &Store, me: &Value, rows: &[Value], mut seen: Vec<Value>) -> Option<Value> {
    let mut items = crate::bundle::group_views(rows).ok()?;
    let mut names: Vec<String> = seen.iter().map(|x| py_str(&x["name"])).collect();
    let mut have: Vec<String> = names.iter().map(|n| crate::worksum::normalize_part(n)).collect();
    // グループに書いてある名前（もう出てこない設備も外せるように）
    for n in items.iter().flat_map(|x| x["equipment"].as_array().cloned().unwrap_or_default()) {
        let n = py_str(&n);
        let k = crate::worksum::normalize_part(&n);
        if !have.contains(&k) {
            have.push(k);
            names.push(n.clone());
            seen.push(json!({"name": n, "from": [], "n": 0}));
        }
    }
    for x in items.iter_mut() {
        x["matched"] = json!(crate::dashboard::members_in(x, &names));
    }
    // まとめ方の並び（表示順の最初のグループの順）
    let mut sets: Vec<(Value, Vec<Value>)> = vec![];
    for x in &items {
        match sets.iter_mut().find(|(n, _)| *n == x["set"]) {
            Some((_, g)) => g.push(x.clone()),
            None => sets.push((x["set"].clone(), vec![x.clone()])),
        }
    }
    let sets: Vec<Value> = sets.into_iter().map(|(n, g)| json!({"name": n, "groups": g})).collect();
    Some(json!({"items": items, "sets": sets, "equipments": names, "seen": seen,
                "ruleOps": crate::bundle::tables()["equipGroups"]["ruleOpLabels"],
                "canEdit": crate::access::can_write(me, NAME), "shared": store.is_shared(NAME), "revision": store.revision(NAME)}))
}

/// 窓が受ける 4 本を答える（門番は呼ぶ側が通した）。seen は選べる設備を数える係（数えられなければ None）。窓が答えない形は None
pub fn handle(
    store: &Store,
    me: &Value,
    place: &Place,
    route: Route,
    query: &str,
    body: &[u8],
    seen: &dyn Fn() -> Option<Vec<Value>>,
) -> Option<Answer> {
    // 書いた後の一覧（読み直せなければ、書いたことだけを知らせる。None を返すと Python がもう一度書く）。選べる設備は書く前に数えた物
    // （書くのは設備グループだけで、選べる設備は変わらない）。断ると見込んで数えなかった歩が書けた（ほかの PC と行き違った）ときだけ、ここで数える
    let done = |status: u16, extra: Value, counted: Option<Vec<Value>>| -> Option<Answer> {
        let Some(mut v) = read(place).and_then(|rows| listing(store, me, &rows, counted.or_else(seen)?)) else {
            return Some((
                503,
                json!({"error": "保存しましたが、読み直せませんでした。画面を開き直してください。", "kind": "reread", "saved": true}),
            ));
        };
        for (k, x) in extra.as_object().into_iter().flatten() {
            v[k] = x.clone();
        }
        Some((status, v))
    };
    let clean = |data: &Map<String, Value>, partial: bool, old: Option<&Map<String, Value>>| match clean_row(data, partial, old) {
        Ok(row) => Ok(row),
        Err(Bad::Delegate) => Err(None),
        Err(Bad::Group(m)) => Err(Some(group_error(m))),
    };
    // 名称・まとめ方が来たときだけ確かめる（master_repository._check_row の equipment_groups）
    let checker = |row: &Map<String, Value>| {
        let named = row.contains_key("名称") || row.contains_key("まとめ方");
        move |rows: &[Value], d: &Map<String, Value>, self_id: Option<i64>| if named { check_unique(rows, d, self_id) } else { Ok(()) }
    };
    // 選べる設備を数える（Some(Some)）。書く係が断ると読んだ行から分かる歩（無い行・版の食い違い・名前の重なり）は、Python も一覧を組まずに
    // 断る（選べる設備を数えない）ので、数えずに書く係へ渡す（Some(None)。版 3.94.0: スケジュールの元があって数えられない PC でも、無い行を
    // 直す・消すは Python と同じ 404 を窓が答える）。書けると見込む歩で数えられなければ None（書かずに Python に任せる）
    let count = |refused: bool| -> Option<Option<Vec<Value>>> {
        if refused {
            Some(None)
        } else {
            seen().map(Some)
        }
    };
    match route {
        Route::List => {
            seed(store, place, NAME); // 共有にまだ無ければ、Python が読むときと同じく最初の版を置く
            let rows = read(place)?;
            let seen = seen()?;
            Some((200, listing(store, me, &rows, seen)?))
        }
        Route::Create => {
            let d = match strict(body, false)? {
                Ok(d) => d.to_value(),
                Err(a) => return Some(a),
            };
            let data = d.as_object().cloned().unwrap_or_default();
            let mut row = match clean(&data, false, None) {
                Ok(row) => row,
                Err(a) => return a,
            };
            seed(store, place, NAME); // equip_group_create は表示順を数えるか書くために設備グループを読む
            let rows = read(place)?;
            let seen = count(check_unique(&rows, &row, None).is_err())?;
            if strip(&py_str(row.get("表示順").unwrap_or(&json!("")))).is_empty() {
                let order = master_rows::next_order(&rows)?;
                order.parse::<i64>().ok()?;
                row.insert("表示順".into(), json!(order));
            }
            let check = checker(&row);
            match master_rows::create(store, &SPEC, &row, &check) {
                Ok(made) => done(201, json!({"created": made.get("id").cloned().unwrap_or(Value::Null)}), seen),
                Err(e) => Some(of_master(e)),
            }
        }
        Route::Update(id) => {
            let base = rev_of(body, query)?;
            let d = strict(body, true)?.ok()?.to_value();
            let mut data = d.as_object().cloned().unwrap_or_default();
            data.remove("base_rev");
            seed(store, place, NAME); // 今の行を読む（設備・ルールの一部だけが来たときの残り）
            let rows = read(place)?;
            let old = rows.iter().find(|r| master_rows::same_id(r, id)).and_then(Value::as_object);
            let row = match clean(&data, true, old) {
                Ok(row) => row,
                Err(a) => return a,
            };
            let named = row.contains_key("名称") || row.contains_key("まとめ方");
            let refused = match rows.iter().find(|r| master_rows::same_id(r, id)) {
                None => true, // 無い行は 404（版を添えたなら 409）
                Some(r) => {
                    let mut merged = r.as_object().cloned().unwrap_or_default();
                    merged.extend(row.clone());
                    master_rows::check_rev(r, base).is_err() || named && check_unique(&rows, &merged, Some(id)).is_err()
                }
            };
            let seen = count(refused)?;
            let check = checker(&row);
            match master_rows::update(store, &SPEC, id, &row, base, &check) {
                Ok(_) => done(200, json!({}), seen),
                Err(e) => Some(of_master(e)),
            }
        }
        Route::Delete(id) => {
            let base = rev_of(body, query)?;
            seed(store, place, NAME); // 消す係は書く前に共有から取り直す（無ければ最初の版を置く）
            let rows = read(place)?;
            let refused = match rows.iter().find(|r| master_rows::same_id(r, id)) {
                None => base.is_none(), // 無い行は 404（版を添えたなら、もう消えている＝望みどおりで一覧）
                Some(r) => master_rows::check_rev(r, base).is_err(),
            };
            let seen = count(refused)?;
            match master_rows::delete(store, &SPEC, id, base) {
                Ok(()) => done(200, json!({}), seen),
                Err(e) => Some(of_master(e)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_and_ids_are_like_python() {
        assert_eq!(route_of("GET", "/api/masters/equipgroups"), Some(Route::List));
        assert_eq!(route_of("POST", "/api/masters/equipgroups"), Some(Route::Create));
        assert_eq!(route_of("PUT", "/api/masters/equipgroups/０7"), Some(Route::Update(7)));
        assert_eq!(route_of("DELETE", "/api/masters/equipgroups/12"), Some(Route::Delete(12)));
        assert_eq!(route_of("GET", "/api/masters/equipgroups/3"), None);
        assert_eq!(route_of("POST", "/api/masters/equipgroups/3"), None);
        assert_eq!(route_of("PUT", "/api/masters/equipgroupsx"), None);
        assert_eq!(route_of("PUT", "/api/masters/equipgroups/99999999999999999999"), None, "i64 に入らない id は Python");
    }

    fn row(body: &str, partial: bool, old: Option<Value>) -> String {
        let d: Value = serde_json::from_str(body).unwrap();
        match clean_row(d.as_object().unwrap(), partial, old.as_ref().and_then(Value::as_object)) {
            Ok(r) => Value::Object(r).to_string(),
            Err(Bad::Group(m)) => m,
            Err(Bad::Delegate) => "任せる".into(),
        }
    }

    #[test]
    fn rows_are_written_like_python() {
        assert_eq!(
            row(
                r#"{"name": " ｃｒ ライン ", "set": " ", "equipment": ["CR1", 5, true, 1.0, "", null, "cr1"],
                    "rules": [{"op": "prefix", "value": " L- "}, {"op": "prefix", "value": "L-"}, {"op": "x", "value": "a"}, 5,
                              {"op": "suffix", "value": ""}, {"op": "regex", "value": null}],
                    "except": "L-9、L-9,\nL-8", "order": "１２", "note": 0}"#,
                false,
                None
            ),
            json!({"名称": "ｃｒ ライン", "まとめ方": "グループ", "設備": "CR1,5,True,1.0",
                   "ルール": r#"{"rules": [{"op": "prefix", "value": "L-"}], "except": ["L-9", "L-8"]}"#, "表示順": "12", "備考": ""})
            .to_string()
        );
        assert_eq!(row(r#"{"name": 0, "equipment": "A"}"#, false, None), "グループの名称を入れてください。", "0 は空（str(v or \"\")）");
        assert_eq!(
            row(r#"{"name": "x", "rules": [], "equipment": []}"#, false, None),
            "グループに入れる設備を 1 つ以上選ぶか、設備の名前の決まり（ルール）を 1 つ以上入れてください。"
        );
        // 正規表現（版 3.102.0 から窓が書く。Python と同じ意味の書き方だけ。違う書き方・重い形は理由を添えて断る）
        assert!(row(r#"{"name": "x", "rules": [{"op": "regex", "value": "^A"}]}"#, false, None).contains(r#"\"regex\", \"value\": \"^A\""#));
        assert!(row(r#"{"name": "x", "rules": [{"op": "regex", "value": "\\p{Han}"}]}"#, false, None).contains("窓で写せない書き方"));
        assert!(row(r#"{"name": "x", "rules": [{"op": "regex", "value": "(a+)+"}]}"#, false, None).contains("とても重く"));
        assert_eq!(row(r#"{"name": "x", "rules": [{"op": ["prefix"], "value": "A"}]}"#, false, None), "任せる", "unhashable は Python");
        assert_eq!(row(r#"{"name": ["x"], "equipment": "A"}"#, false, None), "任せる");
        assert_eq!(row(r#"{"name": "x", "equipment": [["A"]]}"#, false, None), "任せる");
        assert_eq!(row(r#"{"name": "x", "equipment": "A", "order": 1e20}"#, false, None), "任せる");
        assert_eq!(row(r#"{"name": "x", "equipment": "A", "order": "1000000000000000000000"}"#, false, None), "任せる");
        // 一部だけの直し: 残りは今の行の値（版 3.94.0 で Python を直した形）
        let old = json!({"設備": "CR1, CR2", "ルール": r#"{"rules": [{"op": "prefix", "value": "L-"}], "except": ["L-9"]}"#});
        assert_eq!(
            row(r#"{"rules": [{"op": "suffix", "value": "-1"}]}"#, true, Some(old.clone())),
            json!({"設備": "CR1,CR2", "ルール": r#"{"rules": [{"op": "suffix", "value": "-1"}], "except": ["L-9"]}"#}).to_string()
        );
        assert_eq!(
            row(r#"{"equipment": "TLV"}"#, true, Some(old.clone())),
            json!({"設備": "TLV", "ルール": r#"{"rules": [{"op": "prefix", "value": "L-"}], "except": ["L-9"]}"#}).to_string()
        );
        assert_eq!(
            row(r#"{"except": []}"#, true, Some(old.clone())),
            json!({"設備": "CR1,CR2", "ルール": r#"{"rules": [{"op": "prefix", "value": "L-"}]}"#}).to_string()
        );
        assert_eq!(row(r#"{"name": "y"}"#, true, Some(old)), json!({"名称": "y"}).to_string(), "名前だけなら設備に触らない");
    }
}
