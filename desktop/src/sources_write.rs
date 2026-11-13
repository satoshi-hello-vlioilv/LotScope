//! データ元の書く道（版 3.90.0）。Python の `routes/sources.py` の 7 本を窓が受ける:
//!
//! ```text
//! POST   /api/sources               … 足す（201。キーは "s" と 16 進 8 字）
//! PUT    /api/sources/<key>         … 直す（送った列だけ今の行に重ねる。base_rev は行の版〈行が無ければ 0〉）
//! DELETE /api/sources/<key>         … 消す（決まった元は既定へ戻す。?rev= は行の版）
//! POST   /api/sources/<key>/quick   … その場で変える（画面・グループ・表示名だけ）
//! POST   /api/sources/order         … 並べ替え（並びを 10 刻みで振る）
//! POST   /api/sources/groups        … グループの名前を変える・消す
//! PUT    /api/sources/<key>/conn    … 接続の設定の 1 項目（参照先の項目〈settings_write〉か、このマスタの行）
//! ```
//!
//! 決まりは Python と同じ（評価関数: tests/sources_write_parity.rs ← program/tests/sources_write_oracle.py）:
//! - 行の整え方は services/data_sources.clean_row、結合は services/data_join.parse・clean（確かめる順も同じ。誤りの出る順が答えになる）。
//!   列の順・役割・取り出し方・接続の欄の範囲と言葉・組み込みの元は焼いた表（bundle_tables.json の sources・sourcesList・join）
//! - 書く係は master_repository の data_source_put・data_source_order・data_source_delete（キーは正規化しない一致・足すときだけ一意を確かめる・
//!   order は決めた列だけ変え、同じなら行の版を上げない）。何も変えなくてもマスタの版は上がる（Python の store.write と同じ）
//! - 今の並び（_all）は窓の束の材料（bundle::Inputs::sources_parts。GET /api/sources と同じ物）
//!
//! 窓が答えず Python に任せる形: 読めない・読みの割れる本文（NaN・1e400・-0・i64 に入らない整数）・表でない真の本文（Python は 400 か 500）・
//! 値が並び・表（Python の str() の repr が要る。結合の列だけは並びを読む）・keys が表（送った順の鍵）か数・結合の on・cols が数や真偽・cols が表・
//! 道に百分率符号・置き場の行を窓が Python と同じに読めない・版の番号に 10 進でない数の字・書く係の思いがけない失敗。

use crate::bundle::tables;
use crate::master_rows::{base_rev, check_rev, check_unique, normalize_all, py_int, stamped, Rev, Spec};
use crate::master_store::{next_id, MasterError, Store};
use crate::pyfmt;
use crate::worksum::{py_str, truthy};
use serde_json::{json, Map, Value};

pub const NAME: &str = "data_sources";
/// clean_row の答え（列 → 字）
type Row = std::collections::HashMap<String, String>;
const SPEC: Spec = Spec { name: NAME, fields: &[], unique: Some("キー"), renamed: &[] };
/// ロット番号の列の長さ（clean_row の [:120]）
const LOT_COL_MAX: usize = 120;

#[derive(Debug, Clone, PartialEq)]
pub enum Route {
    Add,
    Put(String),
    Delete(String),
    Quick(String),
    Order,
    Groups,
    Conn(String),
}

/// Flask の <key>（/ を含まない空でない字）。戻した字に「%」が残るキーは任せる
fn key_of(s: &str) -> Option<String> {
    (!s.is_empty() && !s.contains('/') && !s.contains('%')).then(|| s.to_string())
}

/// 窓が受ける道か（routes/sources.py の 7 本だけ。確かめる道〈/check・/conn/check・/join/preview〉と /columns は Python）。
/// 百分率符号は Python と同じく道を戻してから合わせる（body::unquote。版 3.106.0。前は任せていた）
pub fn route_of(method: &str, path: &str) -> Option<Route> {
    let path = crate::body::unquote(path);
    let rest = path.strip_prefix("/api/sources");
    match (method, rest?) {
        ("POST", "") => Some(Route::Add),
        ("POST", "/order") => Some(Route::Order),
        ("POST", "/groups") => Some(Route::Groups),
        (m, r) => {
            let r = r.strip_prefix('/')?;
            match m {
                "POST" => r.strip_suffix("/quick").and_then(key_of).map(Route::Quick),
                "PUT" => match r.strip_suffix("/conn") {
                    Some(k) => key_of(k).map(Route::Conn),
                    None => key_of(r).map(Route::Put),
                },
                "DELETE" => key_of(r).map(Route::Delete),
                _ => None,
            }
        }
    }
}

type Answer = (u16, Value);

/// 窓が Python と同じに答えられない形（Python に任せる）
pub struct Delegate;
pub(crate) type D<T> = Result<T, Delegate>;

fn t(path: &[&str]) -> &'static Value {
    path.iter().fold(tables(), |v, k| &v[*k])
}

fn strs(v: &Value) -> Vec<String> {
    v.as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect()
}

/// Python の _s（("" if v is None else str(v)).strip()）。並び・表は repr が要るので任せる
fn py_s(v: Option<&Value>) -> D<String> {
    match v {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::Array(_) | Value::Object(_)) => Err(Delegate),
        Some(x) => Ok(pyfmt::strip(&py_str(x)).to_string()),
    }
}

/// str(v)（strip しない）
fn py_raw(v: &Value) -> D<String> {
    match v {
        Value::Array(_) | Value::Object(_) => Err(Delegate),
        x => Ok(py_str(x)),
    }
}

fn invalid(msg: impl Into<String>) -> Answer {
    (400, json!({"error": msg.into(), "kind": "invalid"}))
}

// ------------------------------------------------------------------ 結合（services/data_join.parse・clean）
pub(crate) struct Join {
    with: String,
    how: String,
    on: Vec<(String, String)>,
    cols: Vec<String>,
}

/// Python の for x in v（字は 1 字ずつ・並びはそのまま）。表は鍵の順が要るので任せる（on の鍵は字なので並びにならない＝空でよい: on_keys）
fn iter_of(v: Option<&Value>, on_keys: bool) -> D<Vec<Value>> {
    match v {
        Some(x) if !truthy(x) => Ok(vec![]),
        None => Ok(vec![]),
        Some(Value::Array(a)) => Ok(a.clone()),
        Some(Value::String(s)) => Ok(s.chars().map(|c| json!(c.to_string())).collect()),
        Some(Value::Object(_)) if on_keys => Ok(vec![]),
        _ => Err(Delegate), // 数・真偽（TypeError）・表の cols（送った順の鍵）
    }
}

fn parse_joins(text: Option<&Value>) -> D<Vec<Join>> {
    let parsed;
    let items: &Value = match text {
        Some(v @ Value::Array(_)) => v,
        Some(Value::String(s)) => {
            if pyfmt::strip(s).is_empty() {
                return Ok(vec![]);
            }
            if crate::master_rows::text_split_py(s) {
                return Err(Delegate); // Python の json.loads だけが読む字（NaN・1e400）・読みの割れる数（整数の -0 は 0 と読む）
            }
            match serde_json::from_str::<Value>(&crate::master_rows::inner_text(s)) {
                Ok(v) => {
                    parsed = v;
                    &parsed
                }
                Err(_) => return Ok(vec![]),
            }
        }
        // None・数・真偽・表は str() の字を json.loads して並びにならない（[]）
        _ => return Ok(vec![]),
    };
    let hows = strs(t(&["join", "hows"]));
    let (max_keys, max_joins) =
        (t(&["join", "maxKeys"]).as_u64().unwrap_or(8) as usize, t(&["join", "maxJoins"]).as_u64().unwrap_or(6) as usize);
    let mut out = vec![];
    for it in items.as_array().into_iter().flatten() {
        let Some(o) = it.as_object() else { continue };
        let mut on = vec![];
        for p in iter_of(o.get("on"), true)? {
            if let Some(p) = p.as_array().filter(|p| p.len() == 2) {
                let (a, b) = (py_s(Some(&p[0]))?, py_s(Some(&p[1]))?);
                if !a.is_empty() && !b.is_empty() {
                    on.push((a, b));
                }
            }
        }
        on.truncate(max_keys);
        let mut cols = vec![];
        for c in iter_of(o.get("cols"), false)? {
            let c = py_s(Some(&c))?;
            if !c.is_empty() {
                cols.push(c);
            }
        }
        let how = o.get("how").and_then(Value::as_str).filter(|h| hows.iter().any(|x| x == h)).unwrap_or("left").to_string();
        out.push(Join { with: py_s(o.get("with"))?, how, on, cols });
    }
    out.truncate(max_joins);
    Ok(out)
}

/// json.dumps(items, ensure_ascii=False)（鍵の順 with・how・on・cols、区切り ", " ": "）
fn dumps_joins(items: &[Join]) -> String {
    let q = |s: &str| serde_json::to_string(s).unwrap_or_default();
    let one = |j: &Join| {
        let on: Vec<String> = j.on.iter().map(|(a, b)| format!("[{}, {}]", q(a), q(b))).collect();
        let cols: Vec<String> = j.cols.iter().map(|c| q(c)).collect();
        format!("{{\"with\": {}, \"how\": {}, \"on\": [{}], \"cols\": [{}]}}", q(&j.with), q(&j.how), on.join(", "), cols.join(", "))
    };
    format!("[{}]", items.iter().map(one).collect::<Vec<_>>().join(", "))
}

/// 窓の並びの結合（sources_full の joins: data_join.parse の形の値）を置く字に（master_repository._cell）
fn dumps_join_values(v: &Value) -> String {
    let items: Vec<Join> = v
        .as_array()
        .into_iter()
        .flatten()
        .map(|j| Join {
            with: j["with"].as_str().unwrap_or("").into(),
            how: j["how"].as_str().unwrap_or("left").into(),
            on: j["on"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|p| (p[0].as_str().unwrap_or("").into(), p[1].as_str().unwrap_or("").into()))
                .collect(),
            cols: strs(&j["cols"]),
        })
        .collect();
    if items.is_empty() {
        String::new()
    } else {
        dumps_joins(&items)
    }
}

/// data_join.clean: Ok(Ok(置く字)) / Ok(Err(JoinError の言葉))
pub(crate) fn clean_joins(text: Option<&Value>, self_key: &str, known: &[(String, String)]) -> D<Result<(String, Vec<Join>), String>> {
    let items = parse_joins(text)?;
    let name = |k: &str| known.iter().rev().find(|(n, _)| n == k).map(|(_, v)| v.clone());
    for (i, j) in items.iter().enumerate() {
        let i = i + 1;
        if j.with.is_empty() {
            return Ok(Err(format!("{i} つ目の結合の相手を選んでください。")));
        }
        if j.with == self_key {
            return Ok(Err(format!("{i} つ目の結合: 同じデータ元どうしは合わせられません。")));
        }
        let Some(n) = name(&j.with) else {
            return Ok(Err(format!("{i} つ目の結合の相手（{}）がありません。作業実績（設備ごとのファイル）は相手にできません。", j.with)));
        };
        if j.on.is_empty() {
            return Ok(Err(format!("{i} つ目の結合（{n}）の鍵を 1 つ以上決めてください（この列 = 相手の列）。")));
        }
    }
    let text = if items.is_empty() { String::new() } else { dumps_joins(&items) };
    Ok(Ok((text, items)))
}

// ------------------------------------------------------------------ 行（services/data_sources.clean_row・row_of・join_targets）
/// join_targets: 1 ファイルの元（kind file）→ (キー, 表示名)。同じキーは後ろの名前（Python の dict）
pub(crate) fn join_targets(items: &[Map<String, Value>]) -> Vec<(String, String)> {
    items
        .iter()
        .filter(|d| d.get("kind").and_then(Value::as_str) == Some("file"))
        .map(|d| (d["key"].as_str().unwrap_or("").into(), py_str(&d["name"])))
        .collect()
}

fn builtin_name(key: &str) -> Option<String> {
    t(&["sources", "builtins"]).as_array()?.iter().find(|b| b["key"] == key).and_then(|b| b["name"].as_str().map(String::from))
}

/// row_of: いま効いているデータ元 → このマスタの行の形
fn row_of(item: &Map<String, Value>) -> D<Map<String, Value>> {
    let g = |k: &str| item.get(k).cloned().unwrap_or(Value::Null);
    let gs = |k: &str| py_raw(item.get(k).unwrap_or(&json!("")));
    let key = gs("key")?;
    let builtin = truthy(&g("builtin"));
    let base = truthy(&g("base"));
    let name = gs("name")?;
    let read = item.get("rowRead").cloned().unwrap_or(json!({}));
    let mut r = Map::new();
    r.insert("キー".into(), json!(key));
    r.insert("表示名".into(), json!(if builtin && builtin_name(&key).as_deref() == Some(name.as_str()) { String::new() } else { name }));
    r.insert("役割".into(), if builtin { json!("") } else { g("role") });
    r.insert("場所".into(), if g("storage") == "master" && !base { g("place") } else { json!("") });
    r.insert("表".into(), if !base { g("table") } else { json!("") });
    r.insert("設備の列".into(), g("equipColumn"));
    r.insert("設備の取り出し方".into(), g("equipMode"));
    r.insert("画面".into(), json!(if truthy(&g("listed")) { "有" } else { "無" }));
    r.insert("並び".into(), json!(py_s(item.get("order"))?));
    r.insert("備考".into(), item.get("note").cloned().unwrap_or(json!("")));
    r.insert("結合".into(), if truthy(&g("joins")) { g("joins") } else { json!([]) });
    r.insert("グループ".into(), item.get("groupSet").cloned().unwrap_or(json!("")));
    r.insert("元".into(), item.get("base").cloned().unwrap_or(json!("")));
    r.insert("確かめる間隔".into(), read.get("確かめる間隔").cloned().unwrap_or(json!("")));
    r.insert("古さの警告".into(), read.get("古さの警告").cloned().unwrap_or(json!("")));
    r.insert("ロット番号の列".into(), item.get("lotSet").cloned().unwrap_or(json!("")));
    Ok(r)
}

/// " ".join(s.split())（Python の空白で分ける）
fn squash(s: &str) -> String {
    s.split(pyfmt::is_space).filter(|x| !x.is_empty()).collect::<Vec<_>>().join(" ")
}

fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// clean_row: 画面から来た行 → マスタの形（Ok(Err(言葉)) は ValueError・JoinError ＝ 400 invalid）
fn clean_row(data: &Map<String, Value>, key: Option<&str>, known: &[(String, String)]) -> D<Result<Row, String>> {
    let fields = strs(t(&["sourcesList", "fields"]));
    let mut row: Row = Row::new();
    for k in fields.iter().filter(|k| *k != "結合") {
        row.insert(k.clone(), py_s(data.get(k))?);
    }
    if let Some(k) = key {
        row.insert("キー".into(), k.to_string());
    }
    let get = |row: &Row, k: &str| row.get(k).cloned().unwrap_or_default();
    let self_key = get(&row, "キー");
    let joins = match clean_joins(data.get("結合"), &self_key, known)? {
        Ok(j) => j,
        Err(m) => return Ok(Err(m)),
    };
    row.insert("結合".into(), joins.0.clone());
    let roles = strs(t(&["sourcesList", "roles"]));
    let role = get(&row, "役割");
    if !role.is_empty() && !roles.contains(&role) {
        return Ok(Err(format!("役割は {} のどれかにしてください。", roles.join("・"))));
    }
    let modes = strs(t(&["sourcesList", "equipModes"]));
    let mode = get(&row, "設備の取り出し方");
    if !mode.is_empty() && !modes.contains(&mode) {
        return Ok(Err(format!("設備の取り出し方は {} のどちらかにしてください。", modes.join("・"))));
    }
    let screen = if get(&row, "画面") == "無" { "無" } else { "有" };
    row.insert("画面".into(), screen.into());
    let place = get(&row, "場所");
    row.insert("場所".into(), if place.is_empty() { String::new() } else { crate::lists::unquote_path(&place) });
    let gmax = t(&["sourcesList", "groupMax"]).as_u64().unwrap_or(24) as usize;
    row.insert("グループ".into(), cut(&squash(&get(&row, "グループ")), gmax));
    row.insert("ロット番号の列".into(), cut(&get(&row, "ロット番号の列"), LOT_COL_MAX));
    for (col, field) in [("確かめる間隔", "refresh"), ("古さの警告", "stale")] {
        let v = get(&row, col);
        if v.is_empty() {
            continue;
        }
        let spec = t(&["sourcesList", "connSpecs", field]);
        let label = spec["label"].as_str().unwrap_or("");
        let Ok(n) = pyfmt::py_float(&v) else {
            return Ok(Err(format!("「{label}」は数で入れてください。")));
        };
        let (lo, hi) = (spec["min"].as_f64().unwrap_or(f64::NAN), spec["max"].as_f64().unwrap_or(f64::NAN));
        if !(lo <= n && n <= hi) {
            return Ok(Err(format!("「{label}」は {}〜{} で入れてください。", py_str(&spec["min"]), py_str(&spec["max"]))));
        }
        let text = if field == "refresh" || n == n.trunc() { format!("{}", n.trunc() as i64) } else { pyfmt::float_repr(n) };
        row.insert(col.into(), text);
    }
    let builtins: Vec<String> =
        t(&["sources", "builtins"]).as_array().into_iter().flatten().filter_map(|b| b["key"].as_str().map(String::from)).collect();
    let is_builtin = builtins.contains(&self_key);
    if is_builtin {
        row.insert("元".into(), String::new());
        if !strs(t(&["sources", "groupable"])).contains(&self_key) {
            row.insert("グループ".into(), String::new());
        }
    }
    let base = get(&row, "元");
    if !base.is_empty() {
        if base == self_key || !known.iter().any(|(k, _)| *k == base) {
            return Ok(Err(
                "結合した表の元にするデータ元を選んでください（品質・仕掛・足したデータ元。実績と結合した表は元にできません）。".into(),
            ));
        }
        if joins.1.is_empty() {
            return Ok(Err("結合した表は、合わせる相手を 1 つ以上決めてください（鍵: この列 = 相手の列）。".into()));
        }
        if joins.1.iter().any(|j| j.with == base) {
            return Ok(Err("結合した表の元と同じデータ元は、相手にできません。".into()));
        }
        row.insert("場所".into(), String::new());
        row.insert("表".into(), String::new());
    }
    if !is_builtin && get(&row, "表示名").is_empty() {
        return Ok(Err("表示名を入れてください（見出しのタブ・ダッシュボードに出す名前）。".into()));
    }
    if !is_builtin && get(&row, "場所").is_empty() && base.is_empty() {
        return Ok(Err("場所（共有の .sqlite3 ファイル）を入れてください。".into()));
    }
    Ok(Ok(row))
}

// ------------------------------------------------------------------ 書く係（master_repository の data_source_*）
fn same_key(r: &Value, key: &str) -> bool {
    r.get("キー").and_then(Value::as_str) == Some(key)
}

/// data_source_put: キーの最初の行を直す・無ければ足す（足すときだけ一意を確かめる）
fn data_source_put(store: &Store, key: &str, data: &Row, base: Option<Rev>) -> Result<Value, MasterError> {
    let fields = strs(t(&["sourcesList", "fields"]));
    store.write(NAME, |rows, stamp| {
        normalize_all(rows, &SPEC);
        let mut pos = rows.iter().position(|r| same_key(r, key));
        if let Some(b) = base {
            let have = match pos {
                Some(i) => py_int(rows[i].get("rev").unwrap_or(&json!(1))),
                None => Some(0),
            };
            if !matches!((have, b), (Some(h), Rev::Small(b)) if h == b) {
                return Err(MasterError::Conflict(pos.map(|i| rows[i].clone())));
            }
        }
        if pos.is_none() {
            let mut probe = Map::new();
            probe.insert("キー".into(), json!(key));
            check_unique(rows, &SPEC, &probe, None)?;
            rows.push(json!({"id": next_id(rows), "rev": 0}));
            pos = Some(rows.len() - 1);
        }
        let row = rows[pos.unwrap()].as_object_mut().ok_or_else(|| MasterError::Error("行の形が違います".into()))?;
        for k in &fields {
            row.insert(k.clone(), json!(pyfmt::strip(data.get(k).map(String::as_str).unwrap_or(""))));
        }
        row.insert("キー".into(), json!(key));
        let rev = row.get("rev").map(|v| py_int(v).ok_or_else(|| MasterError::Error("版が読めません".into()))).transpose()?.unwrap_or(0);
        row.insert("rev".into(), json!(rev + 1));
        stamped(row, stamp);
        Ok(Value::Object(row.clone()))
    })
}

/// _clean と _cell（並びは結合の JSON の字）
fn cell(v: Option<&Value>) -> D<String> {
    match v {
        Some(Value::Array(_)) => Ok(dumps_join_values(v.unwrap())),
        _ => py_s(v),
    }
}

/// data_source_order: 決めた列だけ置く（行が無ければこの行で足す・同じなら行の版を上げない）
fn data_source_order(store: &Store, rows_in: &[(String, Map<String, Value>)], only: &[&str]) -> D<Result<(), MasterError>> {
    let fields = strs(t(&["sourcesList", "fields"]));
    // 置く字を先に作る（並び・表の値は Python の repr が要る: 任せる）
    let mut prepared = vec![];
    for (key, data) in rows_in {
        let mut full = Map::new();
        for k in &fields {
            full.insert(k.clone(), json!(cell(data.get(k))?));
        }
        let mut part = vec![];
        for f in only {
            part.push((f.to_string(), py_s(data.get(*f))?));
        }
        prepared.push((key.clone(), full, part));
    }
    Ok(store.write(NAME, |have, stamp| {
        normalize_all(have, &SPEC);
        for (key, full, part) in &prepared {
            // by = {r.get("キー"): r for r in have}（同じキーは後ろの行。足した行は by に入らない）
            let idx = have.iter().rposition(|r| same_key(r, key));
            let i = match idx {
                None => {
                    let mut row = Map::new();
                    row.insert("id".into(), json!(next_id(have)));
                    row.insert("rev".into(), json!(0));
                    for (k, v) in full {
                        row.insert(k.clone(), v.clone());
                    }
                    row.insert("キー".into(), json!(key));
                    have.push(Value::Object(row));
                    have.len() - 1
                }
                Some(i) => {
                    let same = part.iter().all(|(f, v)| {
                        let cur = have[i].get(f.as_str()).map(|x| pyfmt::strip(&py_str(x)).to_string()).unwrap_or_default();
                        let cur = if have[i].get(f.as_str()).is_none_or(Value::is_null) { String::new() } else { cur };
                        cur == *v
                    });
                    if same {
                        continue;
                    }
                    i
                }
            };
            let row = have[i].as_object_mut().ok_or_else(|| MasterError::Error("行の形が違います".into()))?;
            for (f, v) in part {
                row.insert(f.clone(), json!(v));
            }
            let rev =
                row.get("rev").map(|v| py_int(v).ok_or_else(|| MasterError::Error("版が読めません".into()))).transpose()?.unwrap_or(0);
            row.insert("rev".into(), json!(rev + 1));
            stamped(row, stamp);
        }
        Ok(())
    }))
}

/// data_source_delete: キーの最初の行を消す（無ければ何もしない。行の版）
fn data_source_delete(store: &Store, key: &str, base: Option<Rev>) -> Result<(), MasterError> {
    store.write(NAME, |rows, _| {
        normalize_all(rows, &SPEC);
        let Some(i) = rows.iter().position(|r| same_key(r, key)) else { return Ok(()) };
        check_rev(&rows[i], base)?;
        rows.remove(i);
        Ok(())
    })
}

// ------------------------------------------------------------------ 道
/// 書く道に要る物（窓の束の材料から）
pub struct Ctx<'a> {
    /// いま効いているデータ元の並び（_all。接続の欄 conn つき）
    pub items: &'a [Map<String, Value>],
    /// データ元のマスタの行（置き場のファイルのまま）
    pub rows: &'a [Value],
    /// 参照先のマスタの行（接続の設定の settings の欄）
    pub ps_rows: &'a [Value],
    /// 足す元のキー（"s" と 16 進 8 字。試験は差し替える）
    pub new_key: &'a dyn Fn() -> Option<String>,
    /// 参照先の項目をその値で重ねられるか（bundle::sections_ok。重ねられない形は Python が書いた後に落ちるので任せる）
    pub settings_ok: &'a dyn Fn(&str) -> bool,
}

/// 書いた後に呼ぶ側がすること（参照先の項目を書いたときはその項目〈settings_write::after_of〉）
pub struct Done {
    pub answer: Answer,
    pub setting: Option<String>,
}

fn of_master(e: MasterError) -> Answer {
    match e {
        MasterError::Error(m) => crate::master_rows::error_answer(&m),
        e => (e.status(), e.payload()),
    }
}

fn wrote(r: Result<Value, MasterError>, ok: u16) -> Answer {
    match r {
        Ok(row) => (ok, json!({"row": row})),
        Err(e) => of_master(e),
    }
}

/// 新しい元のキー（data_sources.new_key: "s" + uuid4 の 16 進の頭 8 字）。乱数を取れなければ None（窓は答えず Python に任せる）
pub fn new_key() -> Option<String> {
    let mut b = [0u8; 4];
    getrandom::fill(&mut b).ok()?;
    Some(format!("s{}", b.iter().map(|x| format!("{x:02x}")).collect::<String>()))
}

fn first<'a>(items: &'a [Map<String, Value>], key: &str) -> Option<&'a Map<String, Value>> {
    items.iter().find(|x| x.get("key").and_then(Value::as_str) == Some(key))
}

const GONE: &str = "そのデータ元はありません（ほかの PC が消した可能性があります）。";

/// 窓が受ける 7 本を答える（門番は呼ぶ側が通した）。窓が答えない形は None
pub fn handle(store: &Store, route: &Route, query: &str, body: &[u8], cx: &Ctx) -> Option<Done> {
    // 置き場の行の id・版・列の値を窓が Python と同じに読めない形は任せる
    let fields = strs(t(&["sourcesList", "fields"]));
    if !crate::master_rows::rows_plain(cx.rows, &fields.iter().map(String::as_str).collect::<Vec<_>>()) {
        return None;
    }
    let parsed = crate::master_rows::py_body(body)?;
    let data = parsed.as_object().cloned().unwrap_or_default();
    let known = join_targets(cx.items);
    let done = |answer: Answer| Some(Done { answer, setting: None });
    // 開いたときの版（routes/common.base_rev）を読むのは、直す・その場で変える・消す・接続の設定だけ
    let base = || base_rev(&parsed, query);
    match route {
        Route::Add => {
            let key = (cx.new_key)()?;
            match clean_row(&data, Some(&key), &known).ok()? {
                Err(m) => done(invalid(m)),
                Ok(row) => done(wrote(data_source_put(store, &key, &row, Some(Rev::Small(0))), 201)),
            }
        }
        Route::Put(key) | Route::Quick(key) => {
            let Some(it) = first(cx.items, key) else { return done(invalid(GONE)) };
            let mut merged = row_of(it).ok()?;
            let patch = strs(t(&["sourcesList", "patchFields"]));
            for (k, v) in &data {
                let allowed = if matches!(route, Route::Quick(_)) { patch.contains(k) } else { fields.contains(k) };
                if allowed {
                    merged.insert(k.clone(), v.clone());
                }
            }
            match clean_row(&merged, Some(key), &known).ok()? {
                Err(m) => done(invalid(m)),
                Ok(row) => done(wrote(data_source_put(store, key, &row, base()), 200)),
            }
        }
        Route::Delete(key) => done(match data_source_delete(store, key, base()) {
            Ok(()) => (200, json!({"ok": true})),
            Err(e) => of_master(e),
        }),
        Route::Order => {
            let keys = match iter_of(data.get("keys"), false) {
                Ok(k) => k,
                Err(_) => return None,
            };
            let mut ks = vec![];
            for k in &keys {
                let k = py_raw(k).ok()?;
                if k != "lot" && k != "work" {
                    ks.push(k);
                }
            }
            // items = {x["key"]: x}（同じキーは後ろの元）
            let last = |k: &str| cx.items.iter().rev().find(|x| x.get("key").and_then(Value::as_str) == Some(k));
            let uniq: std::collections::HashSet<&String> = ks.iter().collect();
            if ks.iter().any(|k| last(k).is_none()) || uniq.len() != ks.len() {
                return done(invalid("並べ替えるデータ元が、いまの並びと合いません。読み直してから並べてください。"));
            }
            let mut rows = vec![];
            for (i, k) in ks.iter().enumerate() {
                let mut r = row_of(last(k)?).ok()?;
                r.insert("並び".into(), json!(((i + 1) * 10).to_string()));
                rows.push((k.clone(), r));
            }
            done(match data_source_order(store, &rows, &["並び"]).ok()? {
                Ok(()) => (200, json!({"ok": true})),
                Err(e) => of_master(e),
            })
        }
        Route::Groups => {
            let from = data.get("from").filter(|v| truthy(v)).map(py_raw).transpose().ok()?.unwrap_or_default();
            let from = pyfmt::strip(&from).to_string();
            let to = data.get("to").filter(|v| truthy(v)).map(py_raw).transpose().ok()?.unwrap_or_default();
            let gmax = t(&["sourcesList", "groupMax"]).as_u64().unwrap_or(24) as usize;
            let to = cut(&squash(&to), gmax);
            if from.is_empty() {
                return done(invalid("グループを選んでください。"));
            }
            let members: Vec<&Map<String, Value>> =
                cx.items.iter().filter(|x| x.get("group").and_then(Value::as_str) == Some(from.as_str())).collect();
            if members.is_empty() {
                return done(invalid(format!(
                    "グループ「{from}」はありません（ほかの PC が変えた可能性があります）。読み直してください。"
                )));
            }
            let master = t(&["sourcesList", "masterRole"]).as_str().unwrap_or("マスタ");
            let no_group = t(&["sourcesList", "noGroup"]).as_str().unwrap_or("-");
            // rows = {キー: 行}（同じキーは前の位置に後ろの値）
            let mut rows: Vec<(String, Map<String, Value>)> = vec![];
            for x in members {
                let val = if !to.is_empty() {
                    to.clone()
                } else if x.get("role").and_then(Value::as_str) == Some(master) {
                    no_group.into()
                } else {
                    String::new()
                };
                let mut r = row_of(x).ok()?;
                r.insert("グループ".into(), json!(val));
                let k = py_raw(x.get("key").unwrap_or(&json!(""))).ok()?;
                match rows.iter_mut().find(|(n, _)| *n == k) {
                    Some(slot) => slot.1 = r,
                    None => rows.push((k, r)),
                }
            }
            let n = rows.len();
            done(match data_source_order(store, &rows, &["グループ"]).ok()? {
                Ok(()) => (200, json!({"ok": true, "count": n})),
                Err(e) => of_master(e),
            })
        }
        Route::Conn(key) => {
            let field = data.get("field").filter(|v| truthy(v)).map(py_raw).transpose().ok()?.unwrap_or_default();
            let Some(s) = first(cx.items, key) else {
                return done((404, json!({"error": GONE, "kind": "unknown"})));
            };
            let Some(f) = s.get("conn").and_then(Value::as_array).and_then(|c| c.iter().find(|x| x["id"] == field.as_str())) else {
                return done(invalid(format!("「{}」に「{field}」の設定はありません。", py_str(&s["name"]))));
            };
            let item = f["item"].as_str().unwrap_or("").to_string();
            if f["bind"] == "settings" {
                if !(cx.settings_ok)(&item) {
                    return None;
                }
                let answer = crate::settings_write::put(store, &item, query, body, cx.ps_rows)?;
                return Some(Done { answer, setting: Some(item) });
            }
            let raw = match data.get("value") {
                None | Some(Value::Null) => String::new(),
                Some(v) => py_raw(v).ok()?,
            };
            let mut row = row_of(s).ok()?;
            row.insert(item, json!(raw));
            match clean_row(&row, Some(key), &known).ok()? {
                Err(m) => done(invalid(m)),
                Ok(row) => done(wrote(data_source_put(store, key, &row, base()), 200)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_are_the_seven_python_routes() {
        assert_eq!(route_of("POST", "/api/sources"), Some(Route::Add));
        assert_eq!(route_of("PUT", "/api/sources/wip"), Some(Route::Put("wip".into())));
        assert_eq!(route_of("PUT", "/api/sources/order"), Some(Route::Put("order".into())), "Flask は <key> に order が入る");
        assert_eq!(route_of("DELETE", "/api/sources/check"), Some(Route::Delete("check".into())));
        assert_eq!(route_of("POST", "/api/sources/wip/quick"), Some(Route::Quick("wip".into())));
        assert_eq!(route_of("PUT", "/api/sources/wip/conn"), Some(Route::Conn("wip".into())));
        assert_eq!(route_of("POST", "/api/sources/order"), Some(Route::Order));
        assert_eq!(route_of("POST", "/api/sources/groups"), Some(Route::Groups));
        assert_eq!(route_of("PUT", "/api/sources/w%69p"), Some(Route::Put("wip".into())), "百分率符号は戻して合わせる（版 3.106.0）");
        assert_eq!(route_of("POST", "/api/sources/%6Frder"), Some(Route::Order));
        for (m, p) in [
            ("POST", "/api/sources/check"),
            ("POST", "/api/sources/wip/conn/check"),
            ("POST", "/api/sources/join/preview"),
            ("GET", "/api/sources/wip/columns"),
            ("PUT", "/api/sources/w%2569p"),
            ("PUT", "/api/sources/a%2Fb"),
            ("DELETE", "/api/sources/a/b"),
            ("GET", "/api/sources"),
            ("PUT", "/api/sources/"),
        ] {
            assert_eq!(route_of(m, p), None, "{m} {p}");
        }
    }

    #[test]
    fn joins_are_read_and_written_like_python() {
        let known = vec![("wip".to_string(), "仕掛".to_string()), ("s1".to_string(), "足した".to_string())];
        let ok = |v: Value| match clean_joins(Some(&v), "self", &known) {
            Ok(Ok((t, _))) => t,
            Ok(Err(m)) => format!("ERR {m}"),
            Err(_) => "PY".into(),
        };
        assert_eq!(
            ok(json!([{"with": "wip", "on": [["a", 1.0], ["", "x"]], "cols": "xy", "how": "inner"}])),
            r#"[{"with": "wip", "how": "inner", "on": [["a", "1.0"]], "cols": ["x", "y"]}]"#
        );
        assert_eq!(
            ok(json!(r#"[{"with":"wip","on":[["鍵","鍵"]]}]"#)),
            r#"[{"with": "wip", "how": "left", "on": [["鍵", "鍵"]], "cols": []}]"#
        );
        assert_eq!(ok(json!("壊れた")), "", "読めない字は空");
        assert_eq!(ok(json!(5)), "", "数は空");
        assert_eq!(ok(json!([{"with": "", "on": []}])), "ERR 1 つ目の結合の相手を選んでください。");
        assert_eq!(ok(json!([{"with": "self", "on": [["a", "b"]]}])), "ERR 1 つ目の結合: 同じデータ元どうしは合わせられません。");
        assert!(ok(json!([{"with": "work", "on": [["a", "b"]]}])).contains("（work）がありません"));
        assert_eq!(ok(json!([{"with": "s1"}])), "ERR 1 つ目の結合（足した）の鍵を 1 つ以上決めてください（この列 = 相手の列）。");
        assert_eq!(ok(json!([{"with": "wip", "on": [["a", "b"]], "cols": 5}])), "PY", "数の cols は TypeError");
        assert_eq!(ok(json!([{"with": "wip", "on": [["a", "b"]], "cols": {"a": 1}}])), "PY", "表の cols は送った順");
        assert_eq!(ok(json!(r#"[{"with":"wip","on":[["a",NaN]]}]"#)), "PY");
    }

    #[test]
    fn rows_are_cleaned_like_python() {
        let known = vec![("wip".to_string(), "仕掛".to_string())];
        let c = |v: Value, key: &str| match clean_row(v.as_object().unwrap(), Some(key), &known) {
            Ok(Ok(r)) => Ok(r),
            Ok(Err(m)) => Err(m),
            Err(_) => Err("PY".into()),
        };
        let r = c(json!({"表示名": " 足した ", "場所": " \"C:\\x.sqlite3\" ", "グループ": " a　 b ", "確かめる間隔": "１０.5", "古さの警告": "0.1"}), "s1").unwrap();
        assert_eq!((r["表示名"].as_str(), r["場所"].as_str(), r["グループ"].as_str()), ("足した", "C:\\x.sqlite3", "a b"));
        assert_eq!((r["確かめる間隔"].as_str(), r["古さの警告"].as_str(), r["画面"].as_str()), ("10", "0.1", "有"));
        assert_eq!(c(json!({"表示名": "x", "場所": "y", "古さの警告": "-0"}), "s1").unwrap()["古さの警告"], "0");
        assert_eq!(
            c(json!({"表示名": "x", "場所": "y", "確かめる間隔": "nan"}), "s1").unwrap_err(),
            "「確かめる間隔（秒）」は 10〜3600 で入れてください。"
        );
        assert_eq!(
            c(json!({"表示名": "x", "場所": "y", "確かめる間隔": "abc"}), "s1").unwrap_err(),
            "「確かめる間隔（秒）」は数で入れてください。"
        );
        assert_eq!(c(json!({"場所": "y"}), "s1").unwrap_err(), "表示名を入れてください（見出しのタブ・ダッシュボードに出す名前）。");
        assert_eq!(c(json!({"表示名": "x"}), "s1").unwrap_err(), "場所（共有の .sqlite3 ファイル）を入れてください。");
        assert!(c(json!({"表示名": "x", "場所": "y", "役割": "変"}), "s1")
            .unwrap_err()
            .starts_with("役割は 品質・実績・仕掛・マスタ・その他"));
        assert_eq!(c(json!({"グループ": "g", "元": "wip"}), "lot").unwrap()["グループ"], "", "決まった元はグループに入れない");
        assert_eq!(
            c(json!({"表示名": "x", "元": "wip"}), "s1").unwrap_err(),
            "結合した表は、合わせる相手を 1 つ以上決めてください（鍵: この列 = 相手の列）。"
        );
        assert_eq!(c(json!({"表示名": "x", "備考": [1, "a"]}), "s1").unwrap_err(), "PY", "並びの値は repr");
    }

    #[test]
    fn new_keys_look_like_python() {
        let k = new_key().unwrap();
        assert!(k.len() == 9 && k.starts_with('s') && k[1..].bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()), "{k}");
        assert_ne!(new_key(), new_key());
        assert_eq!(crate::master_rows::error_answer("Permission denied (os error 13)").1["type"], "PermissionError");
    }
}
