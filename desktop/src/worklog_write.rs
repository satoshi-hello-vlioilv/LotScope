//! 作業実績の登録の道（版 3.91.0）。Python の `routes/worklog.py` のマスタ管理の 5 本と、作業実績のタブが開くたびに呼ぶ 1 本を窓が受ける:
//!
//! ```text
//! GET    /api/masters/worklog          … 登録の行（いま結んでいるファイル・状態）と、まだ登録していないファイル（?fresh=1 はフォルダを読み直す）
//! POST   /api/masters/worklog/scan     … フォルダを探し直し、登録に当てる（名前が変わったファイルをたどる・新しい設備を足す）
//! PUT    /api/masters/worklog/order    … 設備の並び（{keys}）
//! PUT    /api/masters/worklog/<id>     … 設備名・表示・表・備考・結ぶファイル（ファイル名）を直す
//! DELETE /api/masters/worklog/<id>     … 消す
//! GET    /api/worklog/files            … 作業実績のタブで選べる設備（?all=1 は表示しない行も・?fresh=1）
//! ```
//!
//! 決まりは Python と同じ（評価関数: tests/worklog_write_parity.rs ← program/tests/worklog_write_oracle.py）:
//! services/work_log の view・match（同じ名前 → 同じファイルID〈same_fid。Python と同じ決まり〉の順・taken つき）・ordered・order_numbers・
//! mark_stale と、master_repository の work_log_sync・update・delete・order。フォルダの中身と 10 秒の覚えは src/lists.rs の 1 つ（found_fresh）。
//!
//! 窓が答えず Python に任せる形: 読めない・空の本文（Python は get_json(force=True) で 400 の HTML）・表でない真の本文（500）・
//! 並びや表の値（Python の str() の repr）・版の番号に 10 進でない数の字・i64 に入らない id・置き場の行を窓が同じに読めない・
//! 古さの警告の時間が数で読めない・百分率符号の道。

use crate::lists::{same_fid, Found};
use crate::master_rows::{base_rev, normalize_all, py_int, stamped, Rev, Spec};
use crate::master_store::{next_id, MasterError, Store};
use crate::pyfmt;
use crate::worksum::{py_str, truthy};
use serde_json::{json, Map, Value};

pub const NAME: &str = "work_log_files";
const FIELDS: [&str; 8] = ["キー", "設備名", "ファイル名", "ファイルID", "表示", "表", "備考", "並び"];
const SPEC: Spec = Spec { name: NAME, fields: &FIELDS, unique: Some("キー"), renamed: &[] };

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Route {
    Get,
    Scan,
    Order,
    Update(i64),
    Delete(i64),
    Files,
}

/// Python の int(字)（\d+ の道の id。Unicode の数字も・先頭の 0 も）。i64 に入らなければ None（Python に任せる）。
/// 版 3.93.0 から変換表の道（src/conversions_write.rs）も使う
pub(crate) fn id_of(s: &str) -> Option<i64> {
    if s.is_empty() || !s.chars().all(|c| pyfmt::digit(c).is_some()) {
        return None;
    }
    let mut n: i64 = 0;
    for c in s.chars() {
        n = n.checked_mul(10)?.checked_add(pyfmt::digit(c)? as i64)?;
    }
    Some(n)
}

/// 窓が受ける道か
pub fn route_of(method: &str, path: &str) -> Option<Route> {
    match (method, path) {
        ("GET", "/api/masters/worklog") => Some(Route::Get),
        ("POST", "/api/masters/worklog/scan") => Some(Route::Scan),
        ("PUT", "/api/masters/worklog/order") => Some(Route::Order),
        ("GET", "/api/worklog/files") => Some(Route::Files),
        (m @ ("PUT" | "DELETE"), p) => {
            let id = id_of(p.strip_prefix("/api/masters/worklog/")?)?;
            Some(if m == "PUT" { Route::Update(id) } else { Route::Delete(id) })
        }
        _ => None,
    }
}

type Answer = (u16, Value);
pub struct Delegate;
type D<T> = Result<T, Delegate>;

/// Python の str(v or "")（偽の値は ""・並びと表は repr が要るので任せる）
fn s_or(v: Option<&Value>) -> D<String> {
    match v {
        Some(x) if truthy(x) => match x {
            Value::Array(_) | Value::Object(_) => Err(Delegate),
            x => Ok(py_str(x)),
        },
        _ => Ok(String::new()),
    }
}

/// r.get(k) or ""（値はそのまま）
fn or_empty(r: &Value, k: &str) -> Value {
    r.get(k).filter(|v| truthy(v)).cloned().unwrap_or(json!(""))
}

// ------------------------------------------------------------------ 並び（work_log.ordered・order_numbers）
/// 並びの番号（int(str(並び or "").strip())。読めなければ None）
fn order_num(r: &Value) -> D<Option<i128>> {
    let t = s_or(r.get("並び"))?;
    let t = pyfmt::strip(&t);
    if t.is_empty() {
        return Ok(None);
    }
    // i128 に入らない桁の数（39 桁から。Python の int は桁のまま並べる）は Python に任せる。wide_int_text は桁があふれると
    // i128 の端に潰すので、先に桁を数える（版 3.91.0 の作った後の採点: 40 桁の並びが 2 行あると順が Python と違った）
    if t.chars().filter(|c| pyfmt::digit(*c).is_some()).count() > 38 {
        return Err(Delegate);
    }
    Ok(crate::bundle::wide_int_text(t))
}

/// ordered: 並びの番号 → 番号の無い行は登録の順で後ろ（行の位置の並び）
fn ordered(rows: &[Value]) -> D<Vec<usize>> {
    let mut keyed = vec![];
    for (i, r) in rows.iter().enumerate() {
        let n = order_num(r)?;
        keyed.push((n.is_none(), n.unwrap_or(0), i));
    }
    keyed.sort();
    Ok(keyed.into_iter().map(|(_, _, i)| i).collect())
}

/// order_numbers: keys の行だけを、その行たちのいまの所へ keys の順で入れ直し、全部に 1 から番号（行の位置, 番号）
fn order_numbers(rows: &[Value], keys: &[String]) -> D<Vec<(usize, String)>> {
    let cur = ordered(rows)?;
    let key_of = |i: usize| rows[i].get("キー").cloned().unwrap_or(Value::Null);
    let mut seen: Vec<String> = vec![];
    for k in keys {
        if cur.iter().any(|&i| key_of(i) == json!(k)) && !seen.contains(k) {
            seen.push(k.clone());
        }
    }
    let in_seen = |i: usize| key_of(i).as_str().is_some_and(|k| seen.iter().any(|s| s == k));
    let moved: Vec<usize> = seen.iter().flat_map(|k| cur.iter().copied().filter(move |&i| key_of(i) == json!(k))).collect();
    let mut it = moved.into_iter();
    let new: Vec<usize> = cur.iter().map(|&i| if in_seen(i) { it.next().unwrap_or(i) } else { i }).collect();
    Ok(new.into_iter().enumerate().map(|(n, i)| (i, (n + 1).to_string())).collect())
}

// ------------------------------------------------------------------ 結ぶ（work_log.match）
struct Matched {
    linked: Vec<(usize, usize)>,
    renamed: Vec<(usize, usize)>,
    new: Vec<usize>,
    missing: Vec<usize>,
}

/// match: order の順の行をフォルダのファイルに結ぶ（1. 同じ名前〈大文字・小文字は区別しない〉 2. 同じファイルID 3. 残りは missing・new）
fn match_rows(rows: &[Value], order: &[usize], found: &[Found]) -> D<Matched> {
    let low = |f: &Found| f.file.to_lowercase();
    let mut taken: Vec<String> = vec![];
    let (mut linked, mut renamed, mut missing) = (vec![], vec![], vec![]);
    for &i in order {
        let name = s_or(rows[i].get("ファイル名"))?.to_lowercase();
        // files = {f["file"].lower(): f}（同じ字は後ろのファイル）
        if let Some(fi) = found.iter().rposition(|f| low(f) == name) {
            if !taken.contains(&low(&found[fi])) {
                taken.push(low(&found[fi]));
                linked.push((i, fi));
            }
        }
    }
    for &i in order {
        if linked.iter().any(|(r, _)| *r == i) {
            continue;
        }
        let fid = s_or(rows[i].get("ファイルID"))?;
        match found.iter().position(|x| !fid.is_empty() && same_fid(&x.fid, &fid) && !taken.contains(&low(x))) {
            Some(fi) => {
                taken.push(low(&found[fi]));
                renamed.push((i, fi));
            }
            None => missing.push(i),
        }
    }
    let new = (0..found.len()).filter(|&fi| !taken.contains(&low(&found[fi]))).collect();
    Ok(Matched { linked, renamed, new, missing })
}

/// Python の float の答え（小数の書き方は JSON に任せる。整数の大きさは u64）
fn file_json(f: &Found) -> Value {
    json!({"file": f.file, "equipment": f.equipment, "size": f.size, "mtime": f.mtime})
}

/// view（items・new・error）
fn view(rows: &[Value], found: &[Found], err: &str) -> D<(Vec<Value>, Vec<Value>)> {
    let order = ordered(rows)?;
    let m = if err.is_empty() {
        match_rows(rows, &order, found)?
    } else {
        Matched { linked: vec![], renamed: vec![], new: vec![], missing: order.clone() }
    };
    let mut items = vec![];
    for &i in &order {
        let r = &rows[i];
        let hit = m
            .linked
            .iter()
            .find(|(x, _)| *x == i)
            .map(|(_, f)| ("ok", *f))
            .or_else(|| m.renamed.iter().find(|(x, _)| *x == i).map(|(_, f)| ("renamed", *f)));
        let (state, f) = match hit {
            Some((s, f)) => (s, Some(&found[f])),
            None => (if err.is_empty() { "missing" } else { "unknown" }, None),
        };
        let shown = if truthy(r.get("表示").unwrap_or(&Value::Null)) { s_or(r.get("表示"))? } else { "有".into() };
        items.push(json!({
            "id": r.get("id").cloned().unwrap_or(Value::Null), "key": or_empty(r, "キー"), "name": or_empty(r, "設備名"),
            "file": or_empty(r, "ファイル名"), "visible": shown != "無", "table": or_empty(r, "表"), "note": or_empty(r, "備考"),
            "rev": r.get("rev").cloned().unwrap_or(json!(1)), "state": state, "now": f.map(|f| f.file.clone()).unwrap_or_default(),
            "size": f.map(|f| json!(f.size)).unwrap_or(Value::Null), "mtime": f.map(|f| json!(f.mtime)).unwrap_or(Value::Null),
            "updated_at": r.get("updated_at").cloned().unwrap_or(json!("")),
            "updated_by": r.get("updated_by").filter(|v| truthy(v)).cloned().unwrap_or(json!({})),
        }));
    }
    Ok((items, m.new.iter().map(|&fi| file_json(&found[fi])).collect()))
}

/// mark_stale（ageHours は Python の round(…, 1)・0 以下のしきいは言わない）
fn mark_stale(items: &mut [Value], stale_hours: f64, now: f64) {
    for x in items.iter_mut() {
        let age = x["mtime"].as_f64().filter(|m| *m != 0.0).map(|m| (now - m) / 3600.0);
        x["ageHours"] = age.map(|a| json!(crate::aggregate::py_round(a, 1))).unwrap_or(Value::Null);
        x["stale"] = json!(age.is_some_and(|a| stale_hours > 0.0 && a > stale_hours));
    }
}

// ------------------------------------------------------------------ 道
/// 道に要る物（窓の束の材料から）
pub struct Ctx<'a> {
    /// 作業実績の登録の行（置き場のファイルのまま）
    pub rows: &'a [Value],
    /// 作業実績の決まり（一覧の設定の work: folder・pattern・stale_hours）
    pub work: &'a Value,
    /// フォルダの中身（fresh は読み直す。src/lists.rs の覚え）
    pub found: &'a dyn Fn(bool) -> Result<Vec<Found>, String>,
    /// この PC が作業実績の登録を書けるか（access::can_write）
    pub can_edit: bool,
    /// いま（秒。mark_stale）
    pub now: f64,
    /// 新しい行のキー（work_log.new_key: 16 進 12 字。試験は差し替える）
    pub new_key: &'a dyn Fn() -> Option<String>,
}

fn of_master(e: MasterError) -> Answer {
    match e {
        MasterError::Error(m) => crate::master_rows::error_answer(&m),
        e => (e.status(), e.payload()),
    }
}

/// 古さの警告の時間（float(stale_hours or 0)）。読めなければ Python に任せる
fn stale_of(work: &Value) -> D<f64> {
    let v = &work["stale_hours"];
    if !truthy(v) {
        return Ok(0.0);
    }
    match v {
        Value::Number(n) => n.as_f64().ok_or(Delegate),
        Value::String(s) => pyfmt::py_float(s).map_err(|_| Delegate),
        Value::Bool(b) => Ok(*b as i64 as f64),
        _ => Err(Delegate),
    }
}

/// _master_view（GET の答え。書いた後も）
fn master_view(store: &Store, cx: &Ctx, rows: &[Value], fresh: bool) -> D<Value> {
    let (found, err) = match (cx.found)(fresh) {
        Ok(f) => (f, String::new()),
        Err(e) => (vec![], e),
    };
    let (mut items, new) = view(rows, &found, &err)?;
    mark_stale(&mut items, stale_of(cx.work)?, cx.now);
    Ok(json!({"folder": cx.work["folder"], "pattern": cx.work["pattern"], "canEdit": cx.can_edit, "shared": store.is_shared(NAME),
              "revision": store.revision(NAME), "staleHours": cx.work["stale_hours"], "items": items, "new": new, "error": err}))
}

/// 本文（get_json(force=True)〈silent でない〉 or {}）: 空・読めない本文は Python（400 の HTML）、表でない真の本文も Python（500）
fn strict_body(body: &[u8]) -> D<Map<String, Value>> {
    if body.iter().all(|b| b.is_ascii_whitespace()) || crate::master_rows::unreadable(body) || crate::master_rows::split_number(body) {
        return Err(Delegate);
    }
    let v: Value = serde_json::from_slice(body).map_err(|_| Delegate)?;
    match v {
        Value::Object(o) => Ok(o),
        v if !truthy(&v) => Ok(Map::new()),
        _ => Err(Delegate),
    }
}

/// 読む前に正規化した行（_normalize_all: 版の無い行は 1）
fn normalized(rows: &[Value]) -> Vec<Value> {
    let mut r = rows.to_vec();
    normalize_all(&mut r, &SPEC);
    r
}

/// 窓が受ける 6 本を答える（門番は呼ぶ側が通した）。窓が答えない形は None
pub fn handle(store: &Store, route: Route, query: &str, body: &[u8], cx: &Ctx) -> Option<Answer> {
    if !crate::master_rows::rows_plain(cx.rows, &FIELDS) {
        return None;
    }
    let q = crate::lotlist::parse_query(query);
    let flag = |k: &str| q.iter().any(|(n, v)| n == k && v == "1");
    let rows = normalized(cx.rows);
    let ok = |v: D<Value>| v.ok().map(|v| (200, v));
    // 書いた後の答え（_master_view）は古さの時間を読む。読めない形は書く前に Python に任せる（書いた後に任せると Python がもう一度書き、版が 2 つ上がる）
    // 並びの番号（ordered）も同じ（39 桁を超える並びは Python に任せる）
    if matches!(route, Route::Scan | Route::Order) && (stale_of(cx.work).is_err() || ordered(&rows).is_err()) {
        return None;
    }
    match route {
        Route::Get => ok(master_view(store, cx, &rows, flag("fresh"))),
        Route::Files => {
            let (found, err) = match (cx.found)(flag("fresh")) {
                Ok(f) => (f, String::new()),
                Err(e) => (vec![], e),
            };
            let (mut items, new) = view(&rows, &found, &err).ok()?;
            if !flag("all") {
                items.retain(|x| x["visible"] == json!(true));
            }
            mark_stale(&mut items, stale_of(cx.work).ok()?, cx.now);
            Some((
                200,
                json!({"folder": cx.work["folder"], "pattern": cx.work["pattern"], "canEdit": cx.can_edit,
                              "staleHours": cx.work["stale_hours"], "items": items, "new": new, "error": err}),
            ))
        }
        Route::Scan => {
            let found = match (cx.found)(true) {
                Ok(f) => f,
                Err(e) => return Some((503, json!({"error": e, "kind": "unreachable"}))),
            };
            let r = store.write(NAME, |have, stamp| {
                normalize_all(have, &SPEC);
                let m = match_rows(have, &(0..have.len()).collect::<Vec<_>>(), &found).map_err(|_| MasterError::Error("行の形が変わりました".into()))?;
                let key = || (cx.new_key)().ok_or_else(|| MasterError::Error("新しいキーを作れません（乱数を取れない）".into()));
                let missing: Vec<Value> = m.missing.iter().map(|&i| have[i].get("設備名").cloned().unwrap_or(Value::Null)).collect();
                let mut renamed = vec![];
                for &(i, fi) in m.linked.iter().chain(&m.renamed) {
                    let f = &found[fi];
                    let r = have[i].as_object_mut().ok_or_else(|| MasterError::Error("行の形が違います".into()))?;
                    let mut changed = false;
                    if r.get("ファイル名") != Some(&json!(f.file)) {
                        renamed.push(json!({"id": r.get("id").cloned().unwrap_or(Value::Null), "from": r.get("ファイル名").cloned().unwrap_or(Value::Null), "to": f.file}));
                        r.insert("ファイル名".into(), json!(f.file));
                        changed = true;
                    }
                    let have_fid = r.get("ファイルID").filter(|v| truthy(v)).map(py_str).unwrap_or_default();
                    if !f.fid.is_empty() && !same_fid(&have_fid, &f.fid) {
                        r.insert("ファイルID".into(), json!(f.fid));
                        changed = true;
                    }
                    if !r.get("キー").is_some_and(truthy) {
                        r.insert("キー".into(), json!(key()?));
                        changed = true;
                    }
                    if changed {
                        let rev = r.get("rev").map(|v| py_int(v).ok_or_else(|| MasterError::Error("版が読めません".into()))).transpose()?.unwrap_or(1);
                        r.insert("rev".into(), json!(rev + 1));
                        stamped(r, stamp);
                    }
                }
                let mut added = vec![];
                for &fi in &m.new {
                    let f = &found[fi];
                    let mut row = Map::new();
                    row.insert("id".into(), json!(next_id(have)));
                    row.insert("キー".into(), json!(key()?));
                    for (k, v) in [("設備名", &f.equipment), ("ファイル名", &f.file), ("ファイルID", &f.fid)] {
                        row.insert(k.into(), json!(v));
                    }
                    row.insert("表示".into(), json!("有"));
                    row.insert("表".into(), json!(""));
                    row.insert("備考".into(), json!(""));
                    row.insert("rev".into(), json!(1));
                    stamped(&mut row, stamp);
                    added.push(row.get("設備名").cloned().unwrap_or(Value::Null));
                    have.push(Value::Object(row));
                }
                Ok((added, renamed, missing, have.clone()))
            });
            match r {
                Err(e) => Some(of_master(e)),
                Ok((added, renamed, missing, now_rows)) => {
                    let mut v = master_view(store, cx, &normalized(&now_rows), false).ok()?;
                    v["result"] = json!({"added": added, "renamed": renamed, "missing": missing, "files": found.len()});
                    Some((200, v))
                }
            }
        }
        Route::Order => {
            let data = strict_body(body).ok()?;
            let keys = match data.get("keys") {
                Some(Value::Array(a)) if !a.is_empty() => a,
                _ => return Some((400, json!({"error": "並べるキー（keys）がありません。", "kind": "error", "type": "ValueError"}))),
            };
            let mut ks = vec![];
            for k in keys {
                ks.push(match k {
                    Value::Array(_) | Value::Object(_) => return None,
                    k => py_str(k),
                });
            }
            order_numbers(&rows, &ks).ok()?; // 窓が読めない並びの番号は書く前に Python へ
            let r = store.write(NAME, |have, stamp| {
                normalize_all(have, &SPEC);
                let plan = order_numbers(have, &ks).map_err(|_| MasterError::Error("行の形が変わりました".into()))?;
                for (i, n) in plan {
                    let cur = s_or(have[i].get("並び")).map_err(|_| MasterError::Error("並びが読めません".into()))?;
                    if cur != n {
                        let r = have[i].as_object_mut().ok_or_else(|| MasterError::Error("行の形が違います".into()))?;
                        r.insert("並び".into(), json!(n));
                        let rev = r
                            .get("rev")
                            .map(|v| py_int(v).ok_or_else(|| MasterError::Error("版が読めません".into())))
                            .transpose()?
                            .unwrap_or(1);
                        r.insert("rev".into(), json!(rev + 1));
                        stamped(r, stamp);
                    }
                }
                Ok(have.clone())
            });
            match r {
                Err(e) => Some(of_master(e)),
                Ok(now_rows) => ok(master_view(store, cx, &normalized(&now_rows), false)),
            }
        }
        Route::Update(id) => {
            // base_rev() は本文を silent で読む（読めなければ確かめない）。続いて本文を get_json(force=True) で読む
            let parsed = crate::master_rows::py_body(body)?;
            let base = base_rev(&parsed, query);
            if base == Some(Rev::Unknown) {
                return None;
            }
            let mut data = strict_body(body).ok()?;
            data.remove("base_rev");
            if let Some(name) = data.get("ファイル名").cloned() {
                let want = match &name {
                    Value::Array(_) | Value::Object(_) => return None,
                    v => py_str(v),
                };
                let found = match (cx.found)(true) {
                    Ok(f) => f,
                    Err(e) => {
                        let kind = if e.starts_with("ファイル名の決まり") { "ValueError" } else { "FolderError" };
                        return Some((400, json!({"error": e, "kind": "error", "type": kind})));
                    }
                };
                let Some(f) = found.iter().find(|x| x.file.to_lowercase() == want.to_lowercase()) else {
                    return Some((
                        400,
                        json!({"error": format!("「{want}」はフォルダにありません。"), "kind": "error", "type": "ValueError"}),
                    ));
                };
                data.insert("ファイル名".into(), json!(f.file));
                data.insert("ファイルID".into(), json!(f.fid));
            }
            // work_log_update: 決めた列だけ（キーは変えない）・表示は「無」か「有」・設備名は空にできない
            let mut d = Map::new();
            for (k, v) in &data {
                if FIELDS.contains(&k.as_str()) && k != "キー" {
                    if !crate::master_rows::value_plain(v) {
                        return None;
                    }
                    d.insert(k.clone(), v.clone());
                }
            }
            if let Some(v) = d.get("表示").cloned() {
                d.insert("表示".into(), json!(if pyfmt::strip(&py_str(&v)) == "無" { "無" } else { "有" }));
            }
            if d.contains_key("設備名") && crate::master_rows::clean(d.get("設備名")).is_empty() {
                return Some(of_master(MasterError::Invalid("設備名を入れてください。".into())));
            }
            match crate::master_rows::update(store, &SPEC, id, &d, base, &crate::master_rows::no_check) {
                Ok(row) => Some((200, row)),
                Err(e) => Some(of_master(e)),
            }
        }
        Route::Delete(id) => {
            let parsed = crate::master_rows::py_body(body)?;
            let base = base_rev(&parsed, query);
            if base == Some(Rev::Unknown) {
                return None;
            }
            match crate::master_rows::delete(store, &SPEC, id, base) {
                Ok(()) => Some((200, json!({"status": "deleted", "id": id}))),
                Err(e) => Some(of_master(e)),
            }
        }
    }
}

/// 新しい行のキー（work_log.new_key: uuid4 の 16 進の頭 12 字）。乱数を取れなければ None
pub fn new_key() -> Option<String> {
    let mut b = [0u8; 6];
    getrandom::fill(&mut b).ok()?;
    Some(b.iter().map(|x| format!("{x:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_and_ids_are_like_python() {
        assert_eq!(route_of("PUT", "/api/masters/worklog/１"), Some(Route::Update(1)));
        assert_eq!(route_of("DELETE", "/api/masters/worklog/0001"), Some(Route::Delete(1)));
        assert_eq!(route_of("PUT", "/api/masters/worklog/order"), Some(Route::Order));
        assert_eq!(route_of("PUT", "/api/masters/worklog/-1"), None);
        assert_eq!(route_of("PUT", "/api/masters/worklog/99999999999999999999"), None, "i64 に入らない id は Python");
        assert_eq!(route_of("DELETE", "/api/masters/worklog/order"), None);
        assert_eq!(route_of("GET", "/api/worklog/files"), Some(Route::Files));
    }

    #[test]
    fn rows_without_a_key_keep_their_own_numbers() {
        let rows = vec![
            json!({"キー": "a1", "並び": "1"}),
            json!({"キー": "b1", "並び": "2"}),
            json!({"キー": null, "並び": "3"}),
            json!({"並び": "4"}),
        ];
        let got: Vec<(usize, String)> = order_numbers(&rows, &["b1".into(), "a1".into()]).ok().unwrap();
        assert_eq!(got, vec![(1, "1".into()), (0, "2".into()), (2, "3".into()), (3, "4".into())]);
        // 並びの番号: 全角・前後の空白は読む、2.0・true は番号なし（後ろ）
        let rows = vec![json!({"並び": 2.0}), json!({"並び": " ２ "}), json!({"並び": true}), json!({"並び": "1"})];
        assert_eq!(ordered(&rows).ok().unwrap(), vec![3, 1, 0, 2]);
    }
}
