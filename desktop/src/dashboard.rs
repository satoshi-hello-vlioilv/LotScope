//! ダッシュボードのパネルの数（版 3.62.0。Python の routes/dashboard.py の /api/dashboard/query と services/dashboard.py の確かめと同じ答え）。
//!
//! 1 枚のパネル（本文 {panel}）を確かめ（clean_panel）、段取り（どのファイルを読むか: lists.rs）をして、集計（pivot.rs の query_many）で数え、
//! 形に合わせて組み立てる: 設備の分け方（重ねる series・並べる facet・合算 sum）・別のデータを合わせる（link）・合わせた表（board）。
//! 稼働（ガント・ABC）とスケジュール（CM3）のデータは Python が答える（None を返す。2 段目の版 3.63.0 で移す）。
//! 材料（データ元・作業実績の登録・勤務体系・設備の名前・設備グループ・試験の「いま」）は、一覧の設定の答え（lists）で受け取る。
//! 答えが同じことは desktop/tests/dash_parity.rs が Python の答え（program/tests/dash_oracle.py）と突き合わせて確かめる。

use crate::formula::{self, Calc, Tables};
use crate::lists::{Conf, Lists, Plan, Quality};
use crate::lotlist::{json_str, json_truthy, TABLE_CANDIDATES, WORK_TABLES};
use crate::operation::{self, ReadArgs};
use crate::pivot::{self, Ask, Equip, EquipMatcher, Fail as PFail, Part, Work};
use crate::pyfmt;
use crate::worksum::{self, normalize_part, Clock};
use crate::{aggregate, aggregate::N};
use chrono::NaiveDateTime;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MAX_FILTERS: usize = 20;
const IN_MAX: usize = 20000;
const MAX_EQUIPS: usize = 200;
const MAX_EGROUPS: usize = 24;
const SUM_NAME: &str = "選んだ設備の計";
const MAX_FACETS: usize = 24;
const MAX_SIDES: usize = 4;
const MAX_GROUPS: usize = 4;
const FIRST_WAIT: Duration = Duration::from_secs(30);
const CACHE_MAX: usize = 96;
const CHARTS: &[&str] = &[
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
const EXTRA_VISUALS: &[&str] = &["kpi", "board", "gantt", "abc", "slicer"];
const OPS_VISUALS: &[&str] = &["gantt", "abc"];
const BOX_VISUALS: &[&str] = &["box", "violin", "xbar"];

/// パネルの確かめの失敗（Python の LayoutError。400）
type R<T> = Result<T, String>;

// ------------------------------------------------------------------ Python の字の扱い
fn s_or(v: Option<&Value>) -> String {
    match v {
        Some(x) if json_truthy(x) => json_str(x),
        _ => String::new(),
    }
}
fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
fn strip(s: &str) -> String {
    pyfmt::strip(s).to_string()
}
/// Python の _int(v, lo, hi, default)
fn int_of(v: Option<&Value>, lo: i64, hi: i64, d: i64) -> i64 {
    let n = match v {
        Some(Value::Bool(b)) => Some(*b as i64),
        Some(Value::Number(k)) => k.as_i64().or_else(|| k.as_f64().map(|f| f.trunc() as i64)),
        Some(Value::String(t)) => pyfmt::py_int(t).ok(),
        _ => None,
    };
    n.map(|n| n.clamp(lo, hi)).unwrap_or(d)
}
fn arr(v: Option<&Value>) -> &[Value] {
    v.and_then(Value::as_array).map(|a| a.as_slice()).unwrap_or(&[])
}
fn obj(v: &Value) -> Option<&Map<String, Value>> {
    v.as_object()
}

// ------------------------------------------------------------------ 確かめ（services/dashboard.py）
/// 段の並び（Python の pivot_presets._dims）
fn dims(v: Option<&Value>) -> Vec<Value> {
    let Some(Value::Array(a)) = v else { return vec![] };
    let mut out = vec![];
    for d in a.iter().take(3) {
        let Some(m) = obj(d) else { continue };
        let Some(col) = m.get("column").and_then(Value::as_str).filter(|c| !c.is_empty()) else { continue };
        let mut x = Map::new();
        x.insert("column".into(), json!(cut(col, 200)));
        x.insert("part".into(), json!(cut(&s_or(m.get("part")), 10)));
        for k in ["width", "origin"] {
            if let Some(n @ Value::Number(_)) = m.get(k) {
                x.insert(k.into(), n.clone());
            }
        }
        out.push(Value::Object(x));
    }
    out
}

fn filters(v: Option<&Value>) -> Vec<Value> {
    let mut out = vec![];
    for f in arr(v).iter().take(MAX_FILTERS) {
        let Some(m) = obj(f) else { continue };
        let (col, op) = (strip(&s_or(m.get("column"))), strip(&s_or(m.get("op"))));
        if col.is_empty() || op.is_empty() {
            continue;
        }
        let op = cut(&op, 20);
        let col = cut(&strip(&json_str(&m["column"])), 200);
        let value = match m.get("value") {
            None | Some(Value::Null) => String::new(),
            Some(x) => cut(&json_str(x), if op == "in" { IN_MAX } else { 400 }),
        };
        let mut x = json!({"column": col, "op": op, "value": value});
        if op == "in" {
            if let Some(k) = m.get("key").and_then(Value::as_str).filter(|k| ["date", "month", "year"].contains(k)) {
                x["key"] = json!(k);
            }
        }
        out.push(x);
    }
    out
}

fn day_of(v: Option<&Value>) -> String {
    let t = cut(&s_or(v), 10);
    // Python の \d{4}-\d{2}-\d{2}（\d は全角などの数字にも当たる。pivot がその日付を読めずに断る所まで同じにする）
    let cs: Vec<char> = t.chars().collect();
    let ok = cs.len() == 10 && cs.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == '-' } else { pyfmt::digit(*c).is_some() });
    if ok {
        t
    } else {
        String::new()
    }
}

fn period(v: Option<&Value>) -> Value {
    let Some(m) = v.and_then(obj) else { return Value::Null };
    let kind = m.get("kind").and_then(Value::as_str).unwrap_or("");
    let col = strip(&s_or(m.get("column")));
    if !pivot::PERIODS.iter().any(|(k, _)| *k == kind) || col.is_empty() {
        return Value::Null;
    }
    let mut out = json!({"column": cut(&col, 200), "kind": kind, "n": int_of(m.get("n"), 1, 3660, 7)});
    if kind == "range" {
        let days: Vec<String> = [day_of(m.get("from")), day_of(m.get("to"))].into_iter().filter(|d| !d.is_empty()).collect();
        if days.is_empty() {
            return Value::Null;
        }
        out["from"] = json!(days.iter().min().unwrap());
        out["to"] = json!(days.iter().max().unwrap());
    }
    out
}

fn names(v: Option<&Value>, n: usize) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for x in arr(v).iter().take(n) {
        let t = cut(&strip(&s_or(Some(x))), 120);
        if !t.is_empty() && !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

/// 値（Python の _measure）。合わなければ None
fn measure(m: Option<&Value>) -> Option<Value> {
    let m = m.and_then(obj)?;
    if !m.get("agg").and_then(Value::as_str).is_some_and(aggregate::is_agg) {
        return None;
    }
    let mut m = m.clone();
    m.insert("column".into(), json!(cut(&s_or(m.get("column")), 200)));
    let out = match aggregate::clean(&m, &|c| !c.is_empty()) {
        Ok(o) => o,
        Err(_) => {
            if !m.get("expr").is_some_and(json_truthy) {
                return None;
            }
            m.remove("expr");
            return measure(Some(&Value::Object(m)));
        }
    };
    let mut out = out;
    if out.get("column").and_then(Value::as_str) == Some("") {
        out.remove("column");
    }
    Some(Value::Object(out))
}

fn clean_egroup(v: Option<&Value>) -> Value {
    let Some(m) = v.and_then(obj) else { return Value::Null };
    let mode = m.get("mode").and_then(Value::as_str).unwrap_or("");
    if !["sum", "panel", "master"].contains(&mode) {
        return Value::Null;
    }
    let rest = m.get("rest").and_then(Value::as_str).filter(|r| ["keep", "other", "hide"].contains(r)).unwrap_or("keep");
    let mut out = json!({"mode": mode, "rest": rest});
    match mode {
        "sum" => {
            let n = cut(&strip(&s_or(m.get("name"))), 40);
            out["name"] = json!(if n.is_empty() { SUM_NAME.to_string() } else { n });
        }
        "panel" => {
            let mut gs = vec![];
            for g in arr(m.get("groups")).iter().take(MAX_EGROUPS) {
                let Some(g) = obj(g) else { continue };
                let n = strip(&s_or(g.get("name")));
                if !n.is_empty() {
                    gs.push(json!({"name": cut(&n, 40), "members": names(g.get("members"), MAX_EQUIPS)}));
                }
            }
            if gs.is_empty() {
                return Value::Null;
            }
            out["groups"] = json!(gs);
        }
        _ => {
            let set = cut(&strip(&s_or(m.get("set"))), 40);
            if set.is_empty() {
                return Value::Null;
            }
            out["set"] = json!(set);
        }
    }
    out
}

pub(crate) fn is_screen_source(s: &str) -> bool {
    s == "lot"
        || s == "work"
        || s.strip_prefix("src:")
            .is_some_and(|k| (1..=16).contains(&k.len()) && k.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// 数える元と行の決め方（Python の _data）
fn data(p: &Map<String, Value>, what: &str) -> R<Map<String, Value>> {
    let src = s_or(p.get("source"));
    if !is_screen_source(&src) {
        return Err(format!("{what}のデータ（lot・work・src:<キー>）が違います。"));
    }
    let mut out = Map::new();
    out.insert("source".into(), json!(src));
    out.insert("equip".into(), json!(cut(&s_or(p.get("equip")), 40)));
    out.insert("filters".into(), json!(filters(p.get("filters"))));
    out.insert("search".into(), json!(cut(&strip(&s_or(p.get("search"))), 200)));
    out.insert("period".into(), period(p.get("period")));
    out.insert("basis".into(), json!(if p.get("basis").and_then(Value::as_str) == Some("cal") { "cal" } else { "work" }));
    let eq = names(p.get("equips"), MAX_EQUIPS);
    if !eq.is_empty() {
        out.insert("equips".into(), json!(eq));
    }
    if let Some(c) = p.get("calc").filter(|c| c.is_object()) {
        if formula::clean_calc(&c.to_string()).is_some() {
            out.insert("calc".into(), c.clone());
        }
    }
    Ok(out)
}

fn clean_link(v: Option<&Value>, what: &str) -> R<Value> {
    let Some(m) = v.and_then(obj) else { return Ok(Value::Null) };
    let raw = arr(m.get("sides"));
    if raw.is_empty() {
        return Ok(Value::Null);
    }
    if !(2..=MAX_SIDES).contains(&raw.len()) {
        return Err(format!("{what}の合わせるデータは 2〜{MAX_SIDES} つです。"));
    }
    let mut sides = vec![];
    for (i, x) in raw.iter().enumerate() {
        let Some(x) = obj(x) else { return Err(format!("{what}の合わせるデータの形が違います。")) };
        let key = dims(Some(&json!(x.get("key").filter(|k| k.is_object()).cloned().into_iter().collect::<Vec<_>>())));
        if key.is_empty() {
            return Err(format!("{what}の合わせるデータ {} に、軸（合わせる段）がありません。", i + 1));
        }
        let mut msr = measure(x.get("measure")).unwrap_or_else(|| json!({"agg": "lots"}));
        msr.as_object_mut().unwrap().remove("show");
        let mut side = data(x, &format!("{what}の合わせるデータ {}", i + 1))?;
        side.insert("title".into(), json!(cut(&strip(&s_or(x.get("title"))), 40)));
        let role = x.get("role").and_then(Value::as_str).filter(|r| ["target", "actual"].contains(r)).unwrap_or("");
        side.insert("role".into(), json!(role));
        side.insert("build".into(), json!(if x.get("build").and_then(Value::as_str) == Some("cum") { "cum" } else { "as" }));
        side.insert("key".into(), key[0].clone());
        side.insert("measure".into(), msr);
        sides.push(Value::Object(side));
    }
    let given = arr(m.get("extra"));
    let extra: Vec<&str> = ["diff", "rate"].into_iter().filter(|e| given.iter().any(|g| g == e)).collect();
    let mut out = json!({"sides": sides});
    if !extra.is_empty() {
        out["extra"] = json!(extra);
    }
    Ok(out)
}

fn clean_group(g: &Value, i: usize) -> R<Value> {
    let Some(g) = obj(g) else { return Err("列のまとまりの形が違います。".into()) };
    let title = cut(&strip(&s_or(g.get("title"))), 40);
    let what = format!("列のまとまり「{}」", if title.is_empty() { (i + 1).to_string() } else { title.clone() });
    let mut out = data(g, &what)?;
    out.insert("title".into(), json!(title));
    out.insert("measure".into(), measure(g.get("measure")).unwrap_or_else(|| json!({"agg": "lots"})));
    out.insert("cols".into(), json!(dims(g.get("cols")).into_iter().take(2).collect::<Vec<_>>()));
    Ok(Value::Object(out))
}

fn rows_is_equip(rows: &[Value]) -> bool {
    rows.first().is_none_or(|r| r["column"] == "@equip")
}

fn board_default() -> Value {
    json!({"rows": {"column": "@equip", "part": ""},
           "groups": [{"title": "仕掛ロット数", "source": "src:wip", "equip": "", "filters": [], "search": "", "period": null, "basis": "work",
                       "measure": {"agg": "lots"}, "cols": []},
                      {"title": "", "source": "work", "equip": "", "filters": [], "search": "",
                       "period": {"column": "@workday", "kind": "yesterday", "n": 7}, "basis": "work", "measure": {"agg": "lots"},
                       "cols": [{"column": "@shift", "part": ""}]}],
           "order": {}})
}

fn clean_board(p: &Map<String, Value>, what: &str) -> R<Map<String, Value>> {
    let groups = arr(p.get("groups"));
    let Value::Object(mut out) = (if groups.is_empty() {
        board_default()
    } else {
        if groups.len() > MAX_GROUPS {
            return Err(format!("{what}の列のまとまりは {MAX_GROUPS} つまでです。"));
        }
        let rows = dims(Some(&json!(p.get("rows").filter(|r| r.is_object()).cloned().into_iter().collect::<Vec<_>>())));
        let gs: Vec<Value> = groups.iter().enumerate().map(|(i, g)| clean_group(g, i)).collect::<R<_>>()?;
        let o = p.get("order").and_then(obj).cloned().unwrap_or_default();
        let mut order = Map::new();
        if rows_is_equip(&rows) && !strip(&s_or(o.get("tree"))).is_empty() {
            order.insert("tree".into(), json!(cut(&strip(&s_or(o.get("tree"))), 40)));
        }
        let mut b =
            json!({"rows": rows.first().cloned().unwrap_or_else(|| json!({"column": "@equip", "part": ""})), "groups": gs, "order": order});
        for (k, v) in [
            ("equips", json!(names(p.get("equips"), MAX_EQUIPS))),
            ("egroup", clean_egroup(p.get("egroup"))),
            ("filters", json!(filters(p.get("filters")))),
        ] {
            if json_truthy(&v) {
                b[k] = v;
            }
        }
        b
    }) else {
        unreachable!()
    };
    out.remove("legacy");
    Ok(out)
}

/// 画面から来たパネル → 数える形（Python の clean_panel の、数えるのに要る所。見せ方〈書式・枠〉は数えないので見ない）。
/// 稼働（ガント・ABC）は out["ops"] に選び方を置く（版 3.63.0。数えるのは operation.rs）
fn clean_panel(p: &Value) -> R<Map<String, Value>> {
    let Some(p) = obj(p) else { return Err("パネルの形が違います。".into()) };
    let id = s_or(p.get("id"));
    let pid = if (1..=16).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        id
    } else {
        "p1".into()
    };
    let title = cut(&strip(&s_or(p.get("title"))), 60);
    let visual = p.get("visual").and_then(Value::as_str).filter(|v| CHARTS.contains(v) || EXTRA_VISUALS.contains(v)).unwrap_or("column");
    let mut out = Map::new();
    out.insert("id".into(), json!(pid));
    out.insert("title".into(), json!(title));
    out.insert("visual".into(), json!(visual));
    let what = format!("パネル「{}」", if title.is_empty() { pid.clone() } else { title.clone() });
    if visual == "board" {
        out.extend(clean_board(p, &what)?);
        return Ok(out);
    }
    let body = p.get("body").filter(|b| b.is_object()).cloned().unwrap_or(json!({}));
    let ms: Vec<Value> = arr(body.get("measures")).iter().take(pivot::MAX_MEASURES).filter_map(|m| measure(Some(m))).collect();
    let rows = dims(body.get("rows"));
    out.extend(data(p, &what)?);
    out.insert(
        "body".into(),
        json!({"rows": rows, "cols": dims(body.get("cols")), "measures": if ms.is_empty() { vec![json!({"agg": "lots"})] } else { ms }}),
    );
    let eg = clean_egroup(p.get("egroup"));
    if !eg.is_null() {
        out.insert("egroup".into(), eg);
    }
    if let Some(e) = p.get("esplit").and_then(Value::as_str).filter(|e| ["series", "facet", "sum"].contains(e)) {
        out.insert("esplit".into(), json!(e));
    }
    let eo = names(p.get("eorder"), MAX_EQUIPS);
    if !eo.is_empty() {
        out.insert("eorder".into(), json!(eo));
    }
    if OPS_VISUALS.contains(&visual) {
        // 稼働・ABC 分析（版 3.63.0 から窓が数える）: 作業実績だけ・行と列の段は使わない・設備のまとめと分け方は外す
        if out["source"] != "work" {
            return Err(format!("{what}の稼働・ABC 分析は、作業実績（作業開始と作業終了がある）で使えます。"));
        }
        out.insert("ops".into(), clean_ops(p.get("ops")));
        out["body"]["rows"] = json!([]);
        out["body"]["cols"] = json!([]);
        out.remove("egroup");
        out.remove("esplit");
        return Ok(out);
    }
    let link = clean_link(p.get("link"), &what)?;
    if !link.is_null() {
        out.insert("link".into(), link);
        return Ok(out);
    }
    if !["kpi", "none"].contains(&visual) && out["body"]["rows"].as_array().is_none_or(|r| r.is_empty()) {
        return Err(format!("{what}は行の段が要ります（大きな数にするなら「数字」の形を選んでください）。"));
    }
    Ok(out)
}

// ------------------------------------------------------------------ 稼働・ABC 分析の確かめ（Python の clean_ops・abc_lims）
const ABC_A: f64 = 70.0;
const ABC_B: f64 = 90.0;
const ABC_LIMS_MAX: usize = 50;
const ABC_ITEMS: &[&str] = &["share", "occ", "lshare", "cum", "rank", "avg", "factor", "conv", "chart", "foot"];

/// Python の _float（読めない・NaN・無限は None）
fn float_of(v: &Value) -> Option<f64> {
    let f = match v {
        Value::Bool(b) => *b as i64 as f64,
        Value::Number(n) => n.as_f64()?,
        Value::String(t) => pyfmt::py_float(t).ok()?,
        _ => return None,
    };
    f.is_finite().then_some(f)
}

/// ABC の線（Python の abc_lims）
fn abc_lims(v: &Map<String, Value>) -> Vec<f64> {
    let raw: Vec<Value> = match v.get("lims") {
        Some(Value::Array(a)) => a.clone(),
        _ => vec![v.get("a").cloned().unwrap_or(json!(ABC_A)), v.get("b").cloned().unwrap_or(json!(ABC_B))],
    };
    let mut xs: Vec<f64> = raw.iter().filter_map(float_of).filter(|x| *x > 0.0).map(|x| aggregate::py_round(x.min(100.0), 4)).collect();
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    xs.dedup();
    xs.truncate(ABC_LIMS_MAX);
    if xs.is_empty() {
        vec![ABC_A, ABC_B]
    } else {
        xs
    }
}

fn clean_ops(v: Option<&Value>) -> Value {
    let empty = Map::new();
    let v = v.and_then(obj).unwrap_or(&empty);
    let col = |k: &str| cut(&strip(&s_or(v.get(k))), 200);
    let lims = abc_lims(v);
    let mut out = Map::new();
    for k in ["start", "end", "label", "color"] {
        if !col(k).is_empty() {
            out.insert(k.into(), json!(col(k)));
        }
    }
    if v.get("span").and_then(Value::as_str) == Some("lead") {
        out.insert("span".into(), json!("lead"));
    }
    if let Some(Value::Object(r)) = v.get("refPeriod") {
        let mut r = r.clone();
        r.insert("column".into(), json!("@workday"));
        let rp = period(Some(&Value::Object(r)));
        if !rp.is_null() {
            out.insert("refPeriod".into(), rp);
        }
    }
    let given = arr(v.get("hide"));
    let hide: Vec<&str> = ABC_ITEMS.iter().copied().filter(|x| given.iter().any(|g| g == x)).collect();
    if !hide.is_empty() {
        out.insert("hide".into(), json!(hide));
    }
    let raw_cls: Vec<String> = match v.get("cls") {
        Some(Value::Array(a)) => a.iter().map(|x| cut(&strip(&s_or(Some(x))), 200)).collect(),
        _ => vec![col("cls")],
    };
    let mut cls: Vec<String> = vec![];
    for x in raw_cls {
        if !x.is_empty() && !cls.contains(&x) {
            cls.push(x);
        }
    }
    cls.truncate(4);
    if cls.len() == 1 {
        out.insert("cls".into(), json!(cls[0]));
    } else if !cls.is_empty() {
        out.insert("cls".into(), json!(cls));
    }
    let (qty, base) = (col("qty"), cut(&strip(&s_or(v.get("base"))), 120));
    out.insert("qty".into(), json!(if qty.is_empty() { "lots".to_string() } else { qty }));
    out.insert("base".into(), json!(if base.is_empty() { "avg".to_string() } else { base }));
    if lims != [ABC_A, ABC_B] {
        out.insert("lims".into(), json!(lims));
    }
    if v.get("rankBy").and_then(Value::as_str) == Some("each") {
        out.insert("rankBy".into(), json!("each"));
    }
    Value::Object(out)
}

// ------------------------------------------------------------------ 材料（一覧の設定の答えの dash）
struct Dash<'a> {
    conf: &'a Conf<'a>,
}

impl Dash<'_> {
    fn names(&self) -> Vec<String> {
        arr(self.conf.v["dash"].get("equipNames")).iter().map(json_str).collect()
    }
    fn groups(&self) -> &[Value] {
        arr(self.conf.v["dash"].get("equipGroups"))
    }
    /// まとめ方 set のグループ（Python の equip_groups.groups_for）
    fn groups_for(&self, set: &str) -> Vec<Value> {
        let key = normalize_part(set);
        self.groups()
            .iter()
            .filter(|g| normalize_part(&s_or(g.get("set"))) == key)
            .map(|g| {
                let mut x = json!({"name": g["name"], "members": g["equipment"]});
                if arr(g.get("rules")).iter().next().is_some() {
                    x["rules"] = g["rules"].clone();
                    x["except"] = g["except"].clone();
                }
                x
            })
            .collect()
    }
    /// まとめ方の並び（Python の equip_groups.sets）→ [(名前, [グループ])]
    fn sets(&self) -> Vec<(String, Vec<&Value>)> {
        let mut out: Vec<(String, Vec<&Value>)> = vec![];
        for g in self.groups() {
            let s = s_or(g.get("set"));
            match out.iter_mut().find(|(n, _)| *n == s) {
                Some((_, v)) => v.push(g),
                None => out.push((s, vec![g])),
            }
        }
        out
    }
    fn source(&self, key: &str) -> Option<&Value> {
        self.conf.source(key)
    }
}

/// グループに入る設備（Python の equip_groups.members_in）
fn members_in(g: &Value, names: &[String]) -> Vec<String> {
    let test = pivot::compile_rules(g.get("rules"));
    let ex: Vec<String> = arr(g.get("except")).iter().map(|x| normalize_part(&json_str(x))).collect();
    let mine: Vec<String> = arr(g.get("equipment")).iter().map(|x| normalize_part(&json_str(x))).collect();
    names
        .iter()
        .filter(|n| {
            let k = normalize_part(n);
            mine.contains(&k) || (!ex.contains(&k) && pivot::rules_hit(&test, &k))
        })
        .cloned()
        .collect()
}

// ------------------------------------------------------------------ 数える
/// 答えの控え（Python の DASH_CACHE と同じ: 同じ組み・同じ写し・同じ「今日」なら前の答え。古い物から捨てる）
#[derive(Default)]
pub struct Cache {
    at: HashMap<String, Value>,
    order: VecDeque<String>,
}

impl Cache {
    fn get(&mut self, k: &str) -> Option<Value> {
        let v = self.at.get(k).cloned()?;
        self.order.retain(|x| x != k);
        self.order.push_back(k.to_string());
        Some(v)
    }
    fn put(&mut self, k: String, v: Value) {
        self.order.retain(|x| *x != k);
        self.order.push_back(k.clone());
        self.at.insert(k, v);
        while self.order.len() > CACHE_MAX {
            if let Some(old) = self.order.pop_front() {
                self.at.remove(&old);
            }
        }
    }
}

/// 窓が答える係の持ち物（数えるたびに使う）
pub struct Ctx<'a> {
    pub lists: &'a Lists,
    pub conf: &'a Conf<'a>,
    pub q: &'a Quality<'a>,
    pub now: NaiveDateTime,
    pub conv: &'a Arc<Tables>,
    pub cache: &'a Mutex<Cache>,
}

/// 段取りの失敗（Python の _fail）→ {error, kind, status}
fn fail_of((status, v): &(u16, Value)) -> Value {
    let e = v.get("error").and_then(Value::as_str).filter(|e| !e.is_empty()).unwrap_or("読めませんでした。");
    let k = v.get("kind").and_then(Value::as_str).filter(|k| !k.is_empty()).unwrap_or("error");
    json!({"error": e, "kind": k, "status": status})
}

struct Parts {
    parts: Vec<Part>,
    failed: Vec<Value>,
    name: String,
    mirrors: Vec<Value>,
}

/// 段取りの答え: Ok(Some) 数える物・Ok(None) Python へ回す（スケジュール）・Err 失敗の答え
type Planned = Result<Option<Parts>, Value>;

impl Ctx<'_> {
    fn dash(&self) -> Dash<'_> {
        Dash { conf: self.conf }
    }

    fn equip_of(&self, def: Option<&Value>) -> Option<Equip> {
        let def = def?;
        let col = s_or(def.get("equipColumn"));
        if col.is_empty() {
            return None;
        }
        Some(Equip::Column(col, EquipMatcher::new(&self.dash().names(), &s_or(def.get("equipMode")))))
    }

    fn part(
        &self,
        plan: &Plan,
        candidates: &'static [&'static str],
        work: Option<Work>,
        equip: Option<Equip>,
        name: &str,
        lot: Option<String>,
    ) -> Part {
        Part {
            path: plan.path.clone().unwrap_or_default(),
            table: String::new(),
            preferred_table: plan.table.clone(),
            candidates,
            work,
            equip,
            name: name.into(),
            lot_col: lot.filter(|l| !l.is_empty()),
        }
    }

    /// パネルのデータ → 数えるファイルの並び（Python の panel_parts）
    fn panel_parts(&self, source: &str, equip: &str, basis: &str, equips: &[String]) -> Planned {
        let (lists, conf, q) = (self.lists, self.conf, self.q);
        let def_of = |k: &str| self.dash().source(k).cloned();
        if source == "work" {
            let pick: Vec<String> = equips.iter().map(|x| normalize_part(x)).collect();
            let wl = conf.work();
            let mut all: Vec<&Value> = arr(wl.get("rows")).iter().collect();
            let num = |r: &Value| pyfmt::py_int(&strip(&s_or(r.get("並び")))).ok();
            let mut idx: Vec<usize> = (0..all.len()).collect();
            idx.sort_by_key(|&i| (num(all[i]).is_none(), num(all[i]).unwrap_or(0), i));
            all = idx.into_iter().map(|i| all[i]).collect();
            let rows: Vec<&Value> = all
                .into_iter()
                .filter(|r| {
                    let v = s_or(r.get("表示"));
                    v != "無"
                })
                .filter(|r| equip.is_empty() || r["キー"] == equip)
                .filter(|r| pick.is_empty() || pick.contains(&normalize_part(&s_or(r.get("設備名")))))
                .collect();
            if rows.is_empty() {
                return Err(
                    json!({"error": "数える設備がありません（「マスタ管理」の「データ元」の「実績」で表示する設備を決めてください）。", "kind": "unknown", "status": 404}),
                );
            }
            let work_def = def_of("work");
            let lot = work_def.as_ref().map(|d| s_or(d.get("lotSet")));
            // 全部の設備の写しを一度に始めて、まとめて待つ（Python の start_mirrors）
            let mut keys = vec![];
            for r in &rows {
                let key = s_or(r.get("キー"));
                match lists.work_plan_wait(conf, q, &key, true, false, false) {
                    Ok(_) => keys.push(key),
                    Err((_, v)) if v["kind"] == "copying" => keys.push(key),
                    Err(_) => {}
                }
            }
            lists.work.wait_first(&keys, FIRST_WAIT);
            let shifts = conf.shifts();
            let (mut parts, mut failed, mut mirrors) = (Vec::<Part>::new(), Vec::<Value>::new(), Vec::<Value>::new());
            let mut first: Option<(Value, String)> = None; // 1 つも読めないときの答え（写し中を先に選ぶ）
            for r in &rows {
                let name = s_or(r.get("設備名"));
                match lists.work_plan_wait(conf, q, &s_or(r.get("キー")), true, true, false) {
                    Err(f) => {
                        let fv = fail_of(&f);
                        let kind = fv["kind"].as_str().unwrap_or("").to_string();
                        let mut x = json!({"name": name});
                        x.as_object_mut().unwrap().extend(fv.as_object().unwrap().clone());
                        failed.push(x);
                        if !first.as_ref().is_some_and(|(_, k)| k == "copying") {
                            first = Some((fv, kind));
                        }
                    }
                    Ok(plan) => {
                        let pat = worksum::pattern_for(&shifts, &name);
                        let work = Work {
                            clock: Clock::new(pat.map(|p| p.segments).unwrap_or_default()),
                            basis: basis.into(),
                            start: String::new(),
                        };
                        parts.push(self.part(&plan, WORK_TABLES, Some(work), Some(Equip::Name(name.clone())), &name, lot.clone()));
                        mirrors.push(plan.source.clone());
                    }
                }
            }
            if parts.is_empty() {
                return Err(first.map(|(f, _)| f).unwrap_or(Value::Null));
            }
            let name = work_def.map(|d| s_or(d.get("name"))).unwrap_or_else(|| "作業実績".into());
            return Ok(Some(Parts { parts, failed, name, mirrors }));
        }
        if source == "lot" {
            let plan = lists.lot_plan(conf, q, true).map_err(|f| fail_of(&f))?;
            let d = def_of("lot");
            let named = d.as_ref().and_then(|d| d.get("name")).map(|n| s_or(Some(n)));
            let lot = d.as_ref().map(|d| s_or(d.get("lotSet")));
            let part = self.part(&plan, TABLE_CANDIDATES, None, self.equip_of(d.as_ref()), &named.clone().unwrap_or_default(), lot);
            return Ok(Some(Parts {
                parts: vec![part],
                failed: vec![],
                name: named.unwrap_or_else(|| "品質データ".into()),
                mirrors: vec![plan.source],
            }));
        }
        let key = source.strip_prefix("src:").unwrap_or("");
        let plan = match lists.src_plan(conf, q, key, true, true) {
            Ok(None) => return Ok(None), // スケジュール（CM3）は Python
            Ok(Some(p)) => p,
            Err(f) => return Err(fail_of(&f)),
        };
        let d = def_of(key);
        let name = d.as_ref().map(|d| s_or(d.get("name"))).unwrap_or_default();
        let lot = d.as_ref().map(|d| s_or(d.get("lotSet")));
        let part = self.part(&plan, TABLE_CANDIDATES, None, self.equip_of(d.as_ref()), &name, lot);
        Ok(Some(Parts { parts: vec![part], failed: vec![], name, mirrors: vec![plan.source] }))
    }

    /// パネルの設備のまとめ → 数える形（Python の resolve_egroup）
    fn resolve_egroup(&self, p: &Map<String, Value>) -> Value {
        let Some(eg) = p.get("egroup").filter(|e| e.is_object()) else { return Value::Null };
        match eg["mode"].as_str().unwrap_or("") {
            "sum" => {
                json!({"groups": [{"name": eg["name"], "members": p.get("equips").cloned().unwrap_or(json!([]))}], "rest": "other", "other": eg["name"]})
            }
            mode => {
                let groups = if mode == "panel" { arr(eg.get("groups")).to_vec() } else { self.dash().groups_for(&s_or(eg.get("set"))) };
                if groups.is_empty() {
                    Value::Null
                } else {
                    json!({"groups": groups, "rest": eg["rest"]})
                }
            }
        }
    }

    /// 設備グループの段のまとめ方 → グループ（Python の _group_sets）
    fn group_sets(&self, p: &Map<String, Value>) -> Value {
        let b = &p["body"];
        let mut names: Vec<String> = vec![];
        for d in arr(b.get("rows")).iter().chain(arr(b.get("cols"))) {
            if d["column"] == pivot::EGROUP_DIM {
                let n = s_or(d.get("part"));
                if !names.contains(&n) {
                    names.push(n);
                }
            }
        }
        if names.is_empty() {
            return Value::Null;
        }
        let mut out = Map::new();
        for n in names {
            let v = if n == pivot::PANEL_SET || n.is_empty() {
                let eg = p.get("egroup").cloned().unwrap_or(json!({}));
                if eg["mode"] == "panel" {
                    json!(arr(eg.get("groups"))
                        .iter()
                        .map(|g| json!({"name": g["name"], "members": g.get("members").cloned().unwrap_or(json!([]))}))
                        .collect::<Vec<_>>())
                } else {
                    json!([])
                }
            } else {
                json!(self.dash().groups_for(&n))
            };
            out.insert(n, v);
        }
        Value::Object(out)
    }

    fn box_column(p: &Map<String, Value>) -> String {
        if !BOX_VISUALS.contains(&p["visual"].as_str().unwrap_or("")) {
            return String::new();
        }
        arr(p["body"].get("measures"))
            .iter()
            .find(|m| m.get("column").and_then(Value::as_str).is_some_and(|c| !c.is_empty()) && m["agg"] != "distinct")
            .map(|m| s_or(m.get("column")))
            .unwrap_or_default()
    }

    fn stamp(&self) -> String {
        self.now.format("%Y-%m-%d %H:%M:%S").to_string()
    }

    /// 1 つの組みの数 → 答え（Python の _answer）。Ok(None) は Python へ回す
    fn answer(&self, p: &Map<String, Value>) -> Option<Value> {
        let s = |k: &str| s_or(p.get(k));
        let equips = names(p.get("equips"), MAX_EQUIPS);
        let got = match self.panel_parts(&s("source"), &s("equip"), &s("basis"), &equips) {
            Ok(None) => return None,
            Ok(Some(x)) => x,
            Err(f) => return Some(f),
        };
        let egroups = self.resolve_egroup(p);
        let sets = self.group_sets(p);
        let stamp = self.stamp();
        let days: Vec<String> =
            got.parts.iter().map(|x| x.work.as_ref().map(|w| w.clock.place(&stamp, &w.basis).0).unwrap_or_default()).collect();
        let sig = file_sigs(&got.parts);
        let failed_names: Vec<Value> = got.failed.iter().map(|f| f["name"].clone()).collect();
        let key = json!([p, egroups, sets, sig, days, self.now.date().to_string(), failed_names]).to_string();
        let hit = self.cache.lock().unwrap().get(&key);
        let hit = match hit {
            Some(h) => h,
            None => {
                let h = self.count(p, got.parts.clone(), &egroups, &sets);
                if h.get("error").is_some() {
                    return Some(h);
                }
                self.cache.lock().unwrap().put(key, h.clone());
                h
            }
        };
        let eg = p.get("egroup");
        let note = if eg.is_some_and(|e| e["mode"] == "master") && egroups.is_null() {
            format!(
                "設備のまとめのマスタ「{}」にグループがありません（マスタ管理の「設備グループ」）。",
                s_or(eg.and_then(|e| e.get("set")))
            )
        } else {
            String::new()
        };
        let mut out = with_eorder(hit, p);
        out["sourceName"] = json!(got.name);
        out["mirrors"] = json!(got.mirrors);
        out["failed"] = json!(got.failed);
        out["now"] = json!(stamp);
        if !note.is_empty() {
            let old = s_or(out.get("note"));
            out["note"] = json!([old, note].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join(" "));
        }
        Some(out)
    }

    /// 数える（Python の _count）。数えられなければ {error, kind, status}
    fn count(&self, p: &Map<String, Value>, parts: Vec<Part>, egroups: &Value, sets: &Value) -> Value {
        let b = &p["body"];
        let (rows, cols, measures) = (b["rows"].to_string(), b["cols"].to_string(), b["measures"].to_string());
        let (search, filters) = (s_or(p.get("search")), p.get("filters").cloned().unwrap_or(json!([])).to_string());
        let calc = p.get("calc").and_then(|c| formula::clean_calc(&c.to_string()));
        let equips = names(p.get("equips"), MAX_EQUIPS);
        let bx = Self::box_column(p);
        let period = p.get("period").filter(|x| !x.is_null());
        let ask = Ask {
            search: &search,
            filters: &filters,
            rows: &rows,
            cols: &cols,
            measures: &measures,
            today: self.now.date(),
            month: "",
            box_col: &bx,
            period,
            now: self.now,
            calc: calc.as_ref(),
            conv: self.conv,
            equips: &equips,
            egroups: Some(egroups).filter(|e| !e.is_null()),
            sets: Some(sets).filter(|e| !e.is_null()),
        };
        match pivot::query_many(parts, &ask) {
            Ok(v) => v,
            Err(PFail::Invalid(e)) => json!({"error": e, "kind": "invalid", "status": 400}),
            Err(PFail::Down(e)) => json!({"error": e, "kind": "error", "status": 503}),
        }
    }

    fn equip_ok(&self, source: &str) -> bool {
        if source == "work" {
            return true;
        }
        let key = if source == "lot" { "lot" } else { source.strip_prefix("src:").unwrap_or("") };
        self.dash().source(key).is_some_and(|d| !s_or(d.get("equipColumn")).is_empty())
    }

    /// 設備の分け方を当てて数える（Python の _split_answer）
    fn split_answer(&self, p: &Map<String, Value>) -> Option<Value> {
        let mut sp = if self.equip_ok(&s_or(p.get("source"))) { split_of(p) } else { String::new() };
        let b = p["body"].clone();
        let nrows = arr(b.get("rows")).len();
        let ncols = arr(b.get("cols")).len();
        if sp == "series" && (p["visual"] == "kpi" || ncols >= pivot::MAX_DIMS) {
            sp = "facet".into();
        }
        let eqd = json!({"column": pivot::EQUIP_DIM, "part": ""});
        let with_body = |body: Value| {
            let mut q = p.clone();
            q.insert("body".into(), body);
            q
        };
        if sp == "series" {
            let mut body = b.clone();
            body["cols"] = json!(std::iter::once(eqd).chain(arr(b.get("cols")).iter().cloned()).collect::<Vec<_>>());
            let mut a = self.answer(&with_body(body))?;
            if a.get("cells").is_some() {
                a["esplit"] = json!("series");
            }
            return Some(a);
        }
        if sp != "facet" || nrows >= pivot::MAX_DIMS {
            let mut a = self.answer(p)?;
            let eg_sum = p.get("egroup").is_some_and(|e| e["mode"] == "sum");
            let told = sp == "sum" && (p.get("esplit").is_some_and(json_truthy) || names(p.get("equips"), MAX_EQUIPS).len() >= 2 || eg_sum);
            if a.get("cells").is_some() && told {
                a["esplit"] = json!(sp);
            }
            return Some(a);
        }
        let ms: Vec<Value> = arr(b.get("measures")).to_vec();
        let mut body = b.clone();
        body["rows"] = json!(std::iter::once(eqd).chain(arr(b.get("rows")).iter().cloned()).collect::<Vec<_>>());
        body["measures"] = json!(ms
            .iter()
            .map(|m| {
                let mut m = m.clone();
                m.as_object_mut().unwrap().remove("show");
                m
            })
            .collect::<Vec<_>>());
        let mut a = self.answer(&with_body(body))?;
        if a.get("cells").is_none() {
            return Some(a);
        }
        let f = facets_of(&a, &ms);
        a["esplit"] = json!("facet");
        a["facets"] = json!(f);
        Some(a)
    }

    /// 別のデータを合わせる（Python の _link_answer）
    fn link_answer(&self, p: &Map<String, Value>) -> Option<Value> {
        let link = &p["link"];
        let sides = arr(link.get("sides"));
        let mut answers = vec![];
        for i in 0..sides.len() {
            answers.push(self.answer(&side_query(link, i, p))?);
        }
        if answers.iter().all(|a| a.get("cells").is_none()) {
            return Some(answers.swap_remove(0));
        }
        let mut keys: HashMap<String, HashMap<usize, Value>> = HashMap::new();
        let mut labels = Map::new();
        let mut first: Vec<String> = vec![];
        for (i, a) in answers.iter().enumerate() {
            if a.get("cells").is_none() {
                continue;
            }
            for k in arr(a["orders"].get(0)) {
                let k = json_str(k);
                if k.is_empty() {
                    continue;
                }
                let ck = link_key(&k);
                if !keys.contains_key(&ck) {
                    keys.insert(ck.clone(), HashMap::new());
                    labels.insert(ck.clone(), a["labels"][0].get(&k).cloned().unwrap_or(json!(k)));
                    first.push(ck.clone());
                }
                let v = arr(a.get("cells"))
                    .iter()
                    .find(|c| c["r"] == json!([k]) && arr(c.get("c")).is_empty())
                    .map(|c| c["v"][0].clone())
                    .unwrap_or(Value::Null);
                keys.get_mut(&ck).unwrap().insert(i, v);
            }
        }
        let is_day = |k: &str| {
            let b = k.as_bytes();
            let d4 = b.len() >= 4 && b[..4].iter().all(u8::is_ascii_digit);
            let rest = &b[4.min(b.len())..];
            d4 && (rest.is_empty()
                || (rest.len().is_multiple_of(3)
                    && rest.len() <= 6
                    && rest.chunks(3).all(|c| c[0] == b'-' && c[1].is_ascii_digit() && c[2].is_ascii_digit())))
        };
        let mut order = first.clone();
        if !first.is_empty() && first.iter().all(|k| is_day(k)) {
            order.sort();
        }
        let mut vals: HashMap<String, Vec<Value>> = order
            .iter()
            .map(|k| (k.clone(), (0..sides.len()).map(|i| keys[k].get(&i).cloned().unwrap_or(Value::Null)).collect()))
            .collect();
        let num = |v: &Value| match v {
            Value::Number(n) => Some(n.as_i64().map(N::I).unwrap_or_else(|| N::F(n.as_f64().unwrap_or(0.0)))),
            _ => None,
        };
        let mut grand: Vec<Value> = vec![];
        for (i, x) in sides.iter().enumerate() {
            if x["build"] == "cum" {
                let mut run = N::I(0);
                for k in &order {
                    if let Some(v) = num(&vals[k][i]) {
                        run = add(run, v);
                    }
                    vals.get_mut(k).unwrap()[i] = run.json();
                }
                grand.push(if order.is_empty() { Value::Null } else { run.json() });
            } else {
                grand.push(
                    arr(answers[i].get("cells"))
                        .iter()
                        .find(|c| arr(c.get("r")).is_empty() && arr(c.get("c")).is_empty())
                        .map(|c| c["v"][0].clone())
                        .unwrap_or(Value::Null),
                );
            }
        }
        let ti = sides.iter().position(|x| x["role"] == "target");
        let ai = sides.iter().position(|x| x["role"] == "actual");
        let extra: Vec<String> = if ti.is_some() && ai.is_some() { arr(link.get("extra")).iter().map(json_str).collect() } else { vec![] };
        let extras = |v: &[Value]| -> Vec<Value> {
            let (t, r) = (ti.and_then(|i| num(&v[i])), ai.and_then(|i| num(&v[i])));
            extra
                .iter()
                .map(|e| match (t, r) {
                    (Some(t), Some(r)) if e == "diff" => sub(r, t).json(),
                    (Some(t), Some(r)) if t.f() != 0.0 => json!(aggregate::py_round(r.f() / t.f() * 100.0, 4)),
                    _ => Value::Null,
                })
                .collect()
        };
        let role_name = |r: &str| match r {
            "target" => "目標",
            "actual" => "実績",
            _ => "",
        };
        let mut names_: Vec<String> = vec![];
        for (i, x) in sides.iter().enumerate() {
            let title = s_or(x.get("title"));
            let base = if title.is_empty() {
                format!("{}の{}", s_or(answers[i].get("sourceName")), aggregate_name(&x["measure"], &s_or(x.get("source"))))
            } else {
                title
            };
            let role = s_or(x.get("role"));
            names_.push(if role.is_empty() { base } else { format!("{}：{base}", role_name(&role)) });
        }
        let mut ms: Vec<Value> = sides
            .iter()
            .enumerate()
            .map(|(i, x)| {
                let mut m = x["measure"].clone();
                m["name"] = json!(format!("{}{}", names_[i], if x["build"] == "cum" { "（積み上げ）" } else { "" }));
                m["role"] = x["role"].clone();
                m["side"] = json!(i);
                m
            })
            .collect();
        for e in &extra {
            ms.push(json!({"agg": "sum", "name": if e == "diff" { "差（実績−目標）" } else { "達成率（実績÷目標 %）" }, "role": e}));
        }
        let mut cells: Vec<Value> = order
            .iter()
            .map(|k| {
                let v = &vals[k];
                json!({"r": [k], "c": [], "v": v.iter().cloned().chain(extras(v)).collect::<Vec<_>>()})
            })
            .collect();
        cells.push(json!({"r": [], "c": [], "v": grand.iter().cloned().chain(extras(&grand)).collect::<Vec<_>>()}));
        let ok: Vec<&Value> = answers.iter().filter(|a| a.get("cells").is_some()).collect();
        let note: Vec<String> = answers
            .iter()
            .enumerate()
            .filter(|(_, a)| a.get("cells").is_none())
            .map(|(i, a)| format!("{}: {}", names_[i], s_or(a.get("error"))))
            .collect();
        let notes: Vec<String> =
            std::iter::once(note.join("　")).chain(ok.iter().map(|a| s_or(a.get("note")))).filter(|x| !x.is_empty()).collect();
        let uniq = |it: Vec<String>| -> Vec<String> {
            let mut out: Vec<String> = vec![];
            for x in it {
                if !out.contains(&x) {
                    out.push(x);
                }
            }
            out
        };
        let key0 = sides[0]["key"].clone();
        let mut row0 = key0.clone();
        row0["name"] =
            json!(uniq(sides.iter().map(|x| pivot::dim_name_of(&s_or(x["key"].get("column")), &s_or(x["key"].get("part")))).collect())
                .join("・"));
        let mut ignored: Vec<String> = ok.iter().flat_map(|a| arr(a.get("ignoredFilters")).iter().map(json_str)).collect();
        ignored.sort();
        ignored.dedup();
        let link_sides: Vec<Value> = sides
            .iter()
            .enumerate()
            .map(|(i, x)| {
                let mut v = json!({"role": x["role"], "build": x["build"], "name": names_[i], "sourceName": s_or(answers[i].get("sourceName")),
                                   "keyName": pivot::dim_name_of(&s_or(x["key"].get("column")), &s_or(x["key"].get("part")))});
                if answers[i].get("cells").is_none() {
                    v["error"] = answers[i]["error"].clone();
                }
                v
            })
            .collect();
        Some(json!({
            "table": "", "count": ok.iter().map(|a| a["count"].as_i64().unwrap_or(0)).sum::<i64>(), "lotsBy": "", "start": "", "bins": [], "stats": {},
            "box": "", "boxes": [], "dims": {"rows": [row0], "cols": []}, "measures": ms, "orders": [order], "labels": [labels], "cells": cells,
            "truncated": {"rows": false, "cols": false}, "months": [], "month": "", "ignoredFilters": ignored,
            "equipIgnored": ok.iter().any(|a| a["equipIgnored"] == true), "note": notes.join(" "),
            "sourceName": uniq(ok.iter().map(|a| s_or(a.get("sourceName"))).collect()).join("・"),
            "mirrors": ok.iter().flat_map(|a| arr(a.get("mirrors")).to_vec()).collect::<Vec<_>>(),
            "failed": ok.iter().flat_map(|a| arr(a.get("failed")).to_vec()).collect::<Vec<_>>(), "now": self.stamp(),
            "link": {"sides": link_sides},
        }))
    }

    /// 設備グループのまとめ方ごとに、names の設備がどのグループに入るか（Python の equip_tree）
    fn equip_tree(&self, names: &[String], set_name: &str) -> Vec<Value> {
        self.dash()
            .sets()
            .into_iter()
            .filter(|(n, _)| set_name.is_empty() || n == set_name)
            .map(|(n, gs)| json!({"name": n, "groups": gs.iter().map(|g| json!({"name": g["name"], "members": members_in(g, names)})).collect::<Vec<_>>()}))
            .collect()
    }
}

fn add(a: N, b: N) -> N {
    match (a, b) {
        (N::I(x), N::I(y)) => x.checked_add(y).map(N::I).unwrap_or(N::F(x as f64 + y as f64)),
        (x, y) => N::F(x.f() + y.f()),
    }
}
fn sub(a: N, b: N) -> N {
    match (a, b) {
        (N::I(x), N::I(y)) => x.checked_sub(y).map(N::I).unwrap_or(N::F(x as f64 - y as f64)),
        (x, y) => N::F(x.f() - y.f()),
    }
}

/// 軸の鍵 → そろえる鍵（Python の _link_key）
fn link_key(k: &str) -> String {
    let k = k.strip_prefix(['$', '#']).unwrap_or(k);
    normalize_part(k)
}

/// 値の名前（ロット数は作業実績なら実績本数。Python の aggregate_name）
fn aggregate_name(m: &Value, source: &str) -> String {
    if m["agg"] == "lots" {
        return if source == "work" { "実績本数" } else { "ロット数" }.into();
    }
    m.as_object().map(aggregate::name).unwrap_or_default()
}

/// パネルの設備の分け方（Python の split_of）
fn split_of(p: &Map<String, Value>) -> String {
    let b = &p["body"];
    if p.get("link").is_some()
        || arr(b.get("rows")).iter().chain(arr(b.get("cols"))).any(|d| d["column"] == pivot::EQUIP_DIM || d["column"] == pivot::EGROUP_DIM)
    {
        return String::new();
    }
    let mode = p.get("egroup").map(|e| s_or(e.get("mode"))).unwrap_or_default();
    if mode == "sum" {
        return "sum".into();
    }
    let want = s_or(p.get("esplit"));
    if !want.is_empty() {
        return want;
    }
    if names(p.get("equips"), MAX_EQUIPS).len() >= 2 || mode == "panel" || mode == "master" {
        "series".into()
    } else {
        "sum".into()
    }
}

/// 合わせるデータ i → ふつうのパネルと同じ形（Python の side_query）
fn side_query(link: &Value, i: usize, panel: &Map<String, Value>) -> Map<String, Value> {
    let x = &link["sides"][i];
    let mut out = Map::new();
    for k in ["source", "equip", "search", "period", "basis"] {
        if let Some(v) = x.get(k) {
            out.insert(k.into(), v.clone());
        }
    }
    if x.get("calc").is_some_and(json_truthy) {
        out.insert("calc".into(), x["calc"].clone());
    }
    let pe = panel.get("equips").filter(|e| json_truthy(e));
    if let Some(e) = pe.or_else(|| x.get("equips").filter(|e| json_truthy(e))) {
        out.insert("equips".into(), e.clone());
    }
    out.insert("filters".into(), json!(arr(x.get("filters")).iter().chain(arr(panel.get("filters"))).cloned().collect::<Vec<_>>()));
    out.insert("visual".into(), json!("none"));
    out.insert("body".into(), json!({"rows": [x["key"]], "cols": [], "measures": [x["measure"]]}));
    out
}

/// 合わせた表の列のまとまり i → ふつうのパネルと同じ形（Python の board_query）
fn board_query(board: &Map<String, Value>, i: usize) -> Map<String, Value> {
    let g = &board["groups"][i];
    let mut out = Map::new();
    for k in ["source", "equip", "search", "period", "basis"] {
        if let Some(v) = g.get(k) {
            out.insert(k.into(), v.clone());
        }
    }
    if g.get("calc").is_some_and(json_truthy) {
        out.insert("calc".into(), g["calc"].clone());
    }
    if g.get("equips").is_some_and(json_truthy) {
        out.insert("equips".into(), g["equips"].clone());
    }
    for k in ["equips", "egroup"] {
        if let Some(v) = board.get(k).filter(|v| json_truthy(v)) {
            out.insert(k.into(), v.clone());
        }
    }
    out.insert("filters".into(), json!(arr(g.get("filters")).iter().chain(arr(board.get("filters"))).cloned().collect::<Vec<_>>()));
    out.insert("visual".into(), json!("none"));
    out.insert("body".into(), json!({"rows": [board["rows"]], "cols": g["cols"], "measures": [g["measure"]]}));
    out
}

/// 名前の並び → 手で並べた順（Python の order_names）
fn order_names(names: &[Value], eorder: &[String]) -> Vec<Value> {
    if eorder.is_empty() {
        return names.to_vec();
    }
    let at: HashMap<String, usize> = eorder.iter().enumerate().map(|(i, n)| (normalize_part(n), i)).collect();
    let mut v: Vec<(usize, &Value)> = names.iter().enumerate().collect();
    v.sort_by_key(|(_, n)| match at.get(&normalize_part(&json_str(n))) {
        Some(i) => (0, *i),
        None => (1, 0),
    });
    v.into_iter().map(|(_, n)| n.clone()).collect()
}

/// 設備の段の鍵の並びを、パネルの手で並べた順に（Python の with_eorder）
fn with_eorder(mut a: Value, p: &Map<String, Value>) -> Value {
    let eo = names(p.get("eorder"), MAX_EQUIPS);
    if eo.is_empty() || a.get("orders").is_none() {
        return a;
    }
    let dims: Vec<Value> = arr(a["dims"].get("rows")).iter().chain(arr(a["dims"].get("cols"))).cloned().collect();
    let orders: Vec<Value> =
        arr(a.get("orders"))
            .iter()
            .enumerate()
            .map(|(i, o)| {
                if dims.get(i).is_some_and(|d| d["column"] == pivot::EQUIP_DIM) {
                    json!(order_names(arr(Some(o)), &eo))
                } else {
                    o.clone()
                }
            })
            .collect();
    a["orders"] = json!(orders);
    a
}

/// 行の段の頭が設備の答え → 設備ごとの答え（Python の facets_of）
fn facets_of(a: &Value, measures: &[Value]) -> Vec<Value> {
    let nr = arr(a["dims"].get("rows")).len().saturating_sub(1);
    let orders = arr(a.get("orders"));
    let mut out = vec![];
    for k in arr(orders.first()).iter().filter(|x| *x != "").take(MAX_FACETS) {
        let mine: Vec<&Value> = arr(a.get("cells")).iter().filter(|c| arr(c.get("r")).first() == Some(k)).collect();
        let mut cells: Vec<aggregate::OutCell> = mine
            .iter()
            .map(|c| aggregate::OutCell {
                r: arr(c.get("r")).iter().skip(1).map(json_str).collect(),
                c: arr(c.get("c")).iter().map(json_str).collect(),
                v: arr(c.get("v"))
                    .iter()
                    .map(|v| match v {
                        Value::Number(n) => Some(n.as_i64().map(N::I).unwrap_or_else(|| N::F(n.as_f64().unwrap_or(0.0)))),
                        _ => None,
                    })
                    .collect(),
            })
            .collect();
        let sub_orders: Vec<Vec<String>> = orders
            .iter()
            .skip(1)
            .take(nr)
            .enumerate()
            .map(|(i, o)| arr(Some(o)).iter().map(json_str).filter(|x| cells.iter().any(|c| c.r.get(i) == Some(x))).collect())
            .chain(orders.iter().skip(nr + 1).map(|o| arr(Some(o)).iter().map(json_str).collect()))
            .collect();
        let ms: Vec<Map<String, Value>> = measures.iter().filter_map(|m| m.as_object().cloned()).collect();
        aggregate::apply_show(&mut cells, &ms, nr, &sub_orders);
        let mut sub = Map::new();
        for x in ["table", "lotsBy", "start", "bins", "stats", "box", "truncated", "months", "month", "shifts"] {
            if let Some(v) = a.get(x) {
                sub.insert(x.into(), v.clone());
            }
        }
        sub.insert(
            "dims".into(),
            json!({"rows": arr(a["dims"].get("rows")).iter().skip(1).cloned().collect::<Vec<_>>(), "cols": a["dims"]["cols"]}),
        );
        sub.insert(
            "measures".into(),
            json!(ms
                .iter()
                .map(|m| {
                    let mut x = m.clone();
                    x.insert("name".into(), json!(aggregate::name(m)));
                    Value::Object(x)
                })
                .collect::<Vec<_>>()),
        );
        sub.insert("orders".into(), json!(sub_orders));
        sub.insert("labels".into(), json!(arr(a.get("labels")).iter().skip(1).cloned().collect::<Vec<_>>()));
        sub.insert(
            "cells".into(),
            json!(cells
                .iter()
                .map(|c| json!({"r": c.r, "c": c.c, "v": c.v.iter().map(|v| v.map(N::json).unwrap_or(Value::Null)).collect::<Vec<_>>()}))
                .collect::<Vec<_>>()),
        );
        sub.insert("count".into(), Value::Null);
        sub.insert(
            "boxes".into(),
            json!(arr(a.get("boxes"))
                .iter()
                .filter(|x| arr(x.get("r")).first() == Some(k))
                .map(|x| {
                    let mut x = x.clone();
                    x["r"] = json!(arr(x.get("r")).iter().skip(1).cloned().collect::<Vec<_>>());
                    x
                })
                .collect::<Vec<_>>()),
        );
        out.push(json!({"key": k, "name": a["labels"][0].get(json_str(k)).cloned().unwrap_or(k.clone()), "answer": sub}));
    }
    out
}

/// 1 枚のパネルの数（本文 {panel}。Python の dashboard_query）。None は Python へ回す（スケジュール）
pub fn query(cx: &Ctx, body: &Value) -> Option<(u16, Value)> {
    // Python の body.get("panel") or {}: null・[]・0 のような空の値は、空のパネルとして確かめる
    let p = match clean_panel(body.get("panel").filter(|v| json_truthy(v)).unwrap_or(&json!({}))) {
        Ok(p) => p,
        Err(e) => return Some((400, json!({"error": e}))),
    };
    if p["visual"] == "board" {
        let n = arr(p.get("groups")).len();
        let mut groups = vec![];
        for i in 0..n {
            groups.push(cx.answer(&board_query(&p, i))?);
        }
        let mut out = json!({"groups": groups, "equipOrder": cx.dash().names(), "now": cx.stamp()});
        let tree = s_or(p["order"].get("tree"));
        if !tree.is_empty() {
            let mut keys: Vec<String> = vec![];
            for a in groups.iter().filter(|a| a.get("orders").is_some()) {
                for k in arr(a["orders"].get(0)) {
                    let k = json_str(k);
                    if k.is_empty() {
                        continue;
                    }
                    let lab = a["labels"][0].get(&k).map(json_str).unwrap_or(k);
                    if !keys.contains(&lab) {
                        keys.push(lab);
                    }
                }
            }
            let t = cx.equip_tree(&keys, &tree);
            out["tree"] = t.first().map(|x| x["groups"].clone()).unwrap_or(json!([]));
        }
        return Some((200, out));
    }
    let a = if OPS_VISUALS.contains(&p["visual"].as_str().unwrap_or("")) {
        cx.ops_answer(&p)?
    } else if p.get("link").is_some() {
        cx.link_answer(&p)?
    } else {
        cx.split_answer(&p)?
    };
    if a.get("status").is_some() && a.get("cells").is_none() {
        let st = a["status"].as_u64().unwrap_or(503) as u16;
        return Some((st, json!({"error": a["error"], "kind": a["kind"]})));
    }
    Some((200, a))
}

/// 数えるファイルの印（控えの鍵: 場所・書いた時刻・大きさ。Python の _file_sig）
fn file_sigs(parts: &[Part]) -> Vec<Value> {
    parts
        .iter()
        .map(|x| {
            let m = std::fs::metadata(&x.path).ok();
            let mt = m
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            json!([x.path.display().to_string(), mt.to_string(), m.map(|m| m.len()).unwrap_or(0)])
        })
        .collect()
}

/// 数える設備のファイルを手で並べた順に（Python の order_parts）
fn order_parts(parts: Vec<Part>, eorder: &[String]) -> Vec<Part> {
    if eorder.is_empty() {
        return parts;
    }
    let names = order_names(&parts.iter().map(|x| json!(x.name)).collect::<Vec<_>>(), eorder);
    let mut v = parts;
    v.sort_by_key(|x| names.iter().position(|n| n == &json!(x.name)).unwrap_or(usize::MAX));
    v
}

/// ガントの既定の期間（前日）
fn gantt_period() -> Value {
    json!({"column": "@workday", "kind": "yesterday", "n": 1})
}

/// N を JSON の数から（整数か小数か）
fn n_of(v: &Value) -> N {
    match v {
        Value::Number(n) => n.as_i64().map(N::I).unwrap_or_else(|| N::F(n.as_f64().unwrap_or(0.0))),
        _ => N::I(0),
    }
}

/// 1 回の ABC 分析の答え（Python の _abc_pass の答え）
struct AbcPass {
    equips: Vec<Map<String, Value>>,
    all: Map<String, Value>,
    skipped: Vec<Value>,
    range: Option<(String, String)>,
    start: String,
    end: String,
}

impl Ctx<'_> {
    /// 稼働（gantt）・ABC 分析（abc）のパネル（Python の _ops_answer）
    fn ops_answer(&self, p: &Map<String, Value>) -> Option<Value> {
        let s = |k: &str| s_or(p.get(k));
        let equips = names(p.get("equips"), MAX_EQUIPS);
        let got = match self.panel_parts(&s("source"), &s("equip"), &s("basis"), &equips) {
            Ok(None) => return None,
            Ok(Some(x)) => x,
            Err(f) => return Some(f),
        };
        let gantt = p["visual"] == "gantt";
        let period = match p.get("period").filter(|x| !x.is_null()) {
            Some(x) => x.clone(),
            None if gantt => gantt_period(),
            None => Value::Null,
        };
        let stamp = self.stamp();
        let days: Vec<String> =
            got.parts.iter().map(|x| x.work.as_ref().map(|w| w.clock.place(&stamp, &w.basis).0).unwrap_or_default()).collect();
        let failed_names: Vec<Value> = got.failed.iter().map(|f| f["name"].clone()).collect();
        let hour = if gantt { self.now.format("%H").to_string() } else { "0".into() };
        let key = json!(["ops", p, period, file_sigs(&got.parts), days, self.now.date().to_string(), hour, failed_names]).to_string();
        let hit = self.cache.lock().unwrap().get(&key);
        let hit = match hit {
            Some(h) => h,
            None => {
                let h = self.ops_count(p, got.parts.clone(), &period);
                if h.get("error").is_some() {
                    return Some(h);
                }
                self.cache.lock().unwrap().put(key, h.clone());
                h
            }
        };
        let mut out = hit;
        let mut failed = got.failed.clone();
        failed.extend(arr(out.get("skipped")).iter().cloned());
        out["failed"] = json!(failed);
        out["sourceName"] = json!(got.name);
        out["mirrors"] = json!(got.mirrors);
        out["now"] = json!(stamp);
        Some(out)
    }

    fn read_args<'b>(
        &'b self,
        p: &'b Map<String, Value>,
        o: &'b Value,
        period: Option<&'b Value>,
        filters: &'b str,
        calc: Option<&'b Calc>,
    ) -> ReadArgs<'b> {
        ReadArgs {
            search: p.get("search").and_then(Value::as_str).unwrap_or(""),
            filters,
            today: self.now.date(),
            calc,
            conv: self.conv,
            period,
            now: self.now,
            end: o.get("end").and_then(Value::as_str).unwrap_or(""),
            start: o.get("start").and_then(Value::as_str).unwrap_or(""),
            cols: vec![],
            reach: false,
            lots: false,
            around: 0,
        }
    }

    /// 稼働のパネルを数える（Python の _ops_count）
    fn ops_count(&self, p: &Map<String, Value>, parts: Vec<Part>, period: &Value) -> Value {
        let o = p.get("ops").cloned().unwrap_or(json!({}));
        let filters = p.get("filters").cloned().unwrap_or(json!([])).to_string();
        let calc = p.get("calc").and_then(|c| formula::clean_calc(&c.to_string()));
        let per = Some(period).filter(|x| !x.is_null());
        if p["visual"] == "abc" {
            return self.abc_count(p, parts, &o, per, &filters, calc.as_ref());
        }
        let shifts = self.conf.shifts();
        let (label, color) = (s_or(o.get("label")), s_or(o.get("color")));
        let eorder = names(p.get("eorder"), MAX_EQUIPS);
        let (mut equips, mut skipped): (Vec<Value>, Vec<Value>) = (vec![], vec![]);
        let (mut rng, mut start_col, mut end_col): (Option<(String, String)>, String, String) = (None, String::new(), String::new());
        for part in order_parts(parts, &eorder) {
            let mut args = self.read_args(p, &o, per, &filters, calc.as_ref());
            args.cols = [label.clone(), color.clone()].into_iter().filter(|c| !c.is_empty()).collect();
            args.reach = true;
            let r = match operation::read_ops(&part, &args) {
                Ok(r) => r,
                Err(e) => {
                    skipped.push(json!({"name": part.name, "error": e.text()}));
                    equips.push(
                        json!({"name": part.name, "error": e.text(), "ops": [], "windows": [], "view": null, "rate": null, "shiftMin": 0,
                                       "busyMin": 0, "outsideMin": 0, "byShift": [], "noEnd": 0, "why": {}, "count": 0, "carry": 0,
                                       "truncated": false, "pattern": ""}),
                    );
                    continue;
                }
            };
            if start_col.is_empty() {
                start_col = r.start.clone();
            }
            if end_col.is_empty() {
                end_col = r.end.clone();
            }
            if rng.is_none() {
                rng = r.range.clone();
            }
            if let Some((a, b)) = &r.range {
                let span = chrono::NaiveDate::parse_from_str(b, "%Y-%m-%d").ok().zip(chrono::NaiveDate::parse_from_str(a, "%Y-%m-%d").ok());
                if span.is_some_and(|(b, a)| (b - a).num_days() + 1 > operation::MAX_DAYS) {
                    return json!({"error": format!("ガントチャートの期間は {} 日までです（期間を短くしてください）。", operation::MAX_DAYS),
                                  "kind": "invalid", "status": 400});
                }
            }
            let pat = worksum::pattern_for(&shifts, &part.name);
            let basis = part.work.as_ref().map(|w| w.basis.clone()).unwrap_or_else(|| "work".into());
            let segs = pat.as_ref().map(|x| x.segments.clone()).unwrap_or_default();
            let wins = match (&pat, &r.range) {
                (Some(_), Some((a, b))) => operation::shift_windows(&segs, a, b, &basis),
                _ => vec![],
            };
            let days = match &r.range {
                Some((a, b)) => operation::work_days(&segs, a, b, &basis),
                None => vec![],
            };
            let lab = if !label.is_empty() { label.clone() } else { r.lot.clone() };
            let mut g = operation::gantt(&part.name, &r, &wins, &lab, &color, &days);
            g.insert("pattern".into(), json!(pat.map(|x| x.name).unwrap_or_default()));
            equips.push(Value::Object(g));
        }
        if !equips.iter().any(|e| e.get("error").is_none()) {
            return no_equips(&skipped);
        }
        let sm = N::sum(equips.iter().map(|e| n_of(&e["shiftMin"])));
        let bm = N::sum(equips.iter().map(|e| n_of(&e["busyMin"])));
        let no_pattern: Vec<Value> =
            equips.iter().filter(|e| e["pattern"] == "" && e.get("error").is_none()).map(|e| e["name"].clone()).collect();
        let no_end: i64 = equips.iter().map(|e| e["noEnd"].as_i64().unwrap_or(0)).sum();
        let mut out = ops_head(p, per, &rng, &start_col, &end_col, equips, &skipped);
        out["total"] = json!({"shiftMin": sm.round(2).json(), "busyMin": bm.round(2).json(),
                              "rate": if sm.f() != 0.0 { json!(aggregate::py_round(bm.f() / sm.f(), 4)) } else { Value::Null },
                              "noPattern": no_pattern, "noEnd": no_end});
        out
    }

    /// ABC 分析を 1 つの期間で数える（Python の _abc_pass）。数えられなければ Err(答え)
    #[allow(clippy::too_many_arguments)]
    fn abc_pass(
        &self,
        p: &Map<String, Value>,
        parts: &[Part],
        o: &Value,
        period: Option<&Value>,
        filters: &str,
        calc: Option<&Calc>,
    ) -> Result<AbcPass, Value> {
        let qty = qty_of(o);
        let cls = operation::cls_list(o.get("cls"));
        let mut cols = cls.clone();
        cols.push(if operation::QTYS.contains(&qty.as_str()) { String::new() } else { qty.clone() });
        let lead = o.get("span").and_then(Value::as_str) == Some("lead");
        let base = {
            let b = s_or(o.get("base"));
            if b.is_empty() {
                "avg".to_string()
            } else {
                b
            }
        };
        let lims = abc_lims(o.as_object().unwrap_or(&Map::new()));
        let each = o.get("rankBy").and_then(Value::as_str) == Some("each");
        let eorder = names(p.get("eorder"), MAX_EQUIPS);
        let (mut equips, mut skipped, mut every, mut reads) = (vec![], vec![], vec![], vec![]);
        let (mut rng, mut start_col, mut end_col): (Option<(String, String)>, String, String) = (None, String::new(), String::new());
        for part in order_parts(parts.to_vec(), &eorder) {
            let mut args = self.read_args(p, o, period, filters, calc);
            args.cols = cols.iter().filter(|c| !c.is_empty()).cloned().collect();
            args.lots = lead;
            args.around = if lead && period.is_some() { operation::LEAD_AROUND_DAYS } else { 0 };
            let r = match operation::read_ops(&part, &args) {
                Ok(r) => r,
                Err(e) => {
                    skipped.push(json!({"name": part.name, "error": e.text()}));
                    continue;
                }
            };
            if start_col.is_empty() {
                start_col = r.start.clone();
            }
            if end_col.is_empty() {
                end_col = r.end.clone();
            }
            if rng.is_none() {
                rng = r.range.clone();
            }
            let mine: Vec<operation::Op> = r.ops.iter().filter(|x| !x.carry && !x.after).cloned().collect();
            let mut e = Map::new();
            e.insert("name".into(), json!(part.name));
            e.extend(operation::abc(&mine, &cls, &qty, &base, &lims, each));
            equips.push(e);
            every.extend(mine);
            reads.push(r);
        }
        if equips.is_empty() {
            return Err(no_equips(&skipped));
        }
        if lead && !reads.iter().any(|r| !r.lot.is_empty()) {
            return Err(
                json!({"error": "ロット番号の列が無いので、リードタイム（同じロットの最初の作業開始〜最後の作業終了）を出せません。",
                              "kind": "invalid", "status": 400}),
            );
        }
        let ops = if lead { operation::lead_ops(&reads) } else { every };
        let all = operation::abc(&ops, &cls, &qty, &base, &lims, each);
        Ok(AbcPass { equips, all, skipped, range: rng, start: start_col, end: end_col })
    }

    /// ABC 分析と換算係数（基準の期間で換算も。Python の _abc_count）
    fn abc_count(
        &self,
        p: &Map<String, Value>,
        parts: Vec<Part>,
        o: &Value,
        period: Option<&Value>,
        filters: &str,
        calc: Option<&Calc>,
    ) -> Value {
        let mut got = match self.abc_pass(p, &parts, o, period, filters, calc) {
            Ok(g) => g,
            Err(e) => return e,
        };
        if let Some(rf) = o.get("refPeriod").filter(|r| json_truthy(r)) {
            let a = match self.abc_pass(p, &parts, o, Some(rf), filters, calc) {
                Ok(a) => a,
                Err(mut e) => {
                    e["error"] = json!(format!("基準の期間（地点 A）: {}", s_or(e.get("error"))));
                    return e;
                }
            };
            let empty = Map::new();
            for e in got.equips.iter_mut() {
                let name = e["name"].clone();
                let by = a.equips.iter().find(|x| x["name"] == name).unwrap_or(&empty);
                operation::apply_ref(e, by, a.range.as_ref());
            }
            operation::apply_ref(&mut got.all, &a.all, a.range.as_ref());
        }
        let qty = qty_of(o);
        let cls = operation::cls_list(o.get("cls"));
        let equips: Vec<Value> = got.equips.into_iter().map(Value::Object).collect();
        let mut out = ops_head(p, period, &got.range, &got.start, &got.end, equips, &got.skipped);
        out["all"] = Value::Object(got.all);
        out["span"] = json!(if o.get("span").and_then(Value::as_str) == Some("lead") { "lead" } else { "sum" });
        out["cls"] = json!(cls.join(operation::KEY_SEP));
        out["clsList"] = json!(cls);
        out["qty"] = json!(qty);
        out
    }
}

/// ABC の量（clean_ops の既定と同じく、空なら本数）
fn qty_of(o: &Value) -> String {
    let q = s_or(o.get("qty"));
    if q.is_empty() {
        "lots".to_string()
    } else {
        q
    }
}

fn no_equips(skipped: &[Value]) -> Value {
    let why: String = skipped.iter().take(3).map(|x| format!(" {}: {}", s_or(x.get("name")), s_or(x.get("error")))).collect();
    json!({"error": format!("数えられる設備がありません。{why}"), "kind": "invalid", "status": 400})
}

/// 稼働の答えの頭（Python の _ops_head）
fn ops_head(
    p: &Map<String, Value>,
    period: Option<&Value>,
    rng: &Option<(String, String)>,
    start: &str,
    end: &str,
    equips: Vec<Value>,
    skipped: &[Value],
) -> Value {
    let per = period.map(|x| {
        let mut m = x.as_object().cloned().unwrap_or_default();
        let kind = s_or(x.get("kind"));
        m.insert("name".into(), json!(pivot::PERIODS.iter().find(|(k, _)| *k == kind).map(|(_, n)| *n).unwrap_or("")));
        m.insert("ranges".into(), json!(rng.iter().map(|(a, b)| json!({"from": a, "to": b})).collect::<Vec<_>>()));
        Value::Object(m)
    });
    json!({"kind": p["visual"], "equips": equips, "skipped": skipped, "range": rng.as_ref().map(|(a, b)| json!([a, b])),
           "startColumn": start, "endColumn": end, "period": per, "basis": p["basis"]})
}

/// 試験の「いま」（一覧の設定の答えの dash.now。無ければ窓の時計）
pub fn now_of(conf: &Conf) -> NaiveDateTime {
    conf.v["dash"]["now"]
        .as_str()
        .and_then(|t| NaiveDateTime::parse_from_str(t, "%Y-%m-%d %H:%M:%S").ok())
        .unwrap_or_else(|| chrono::Local::now().naive_local())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_panel_messages_like_python() {
        let e = |p: Value| clean_panel(&p).unwrap_err();
        assert_eq!(e(json!(1)), "パネルの形が違います。");
        assert_eq!(e(json!({"title": "t", "source": "x"})), "パネル「t」のデータ（lot・work・src:<キー>）が違います。");
        assert_eq!(
            e(json!({"id": "a1", "visual": "bar", "source": "lot"})),
            "パネル「a1」は行の段が要ります（大きな数にするなら「数字」の形を選んでください）。"
        );
        assert_eq!(e(json!({"visual": "board", "groups": [1, 2, 3, 4, 5]})), "パネル「p1」の列のまとまりは 4 つまでです。");
        let g = clean_panel(&json!({"visual": "gantt", "source": "work"})).unwrap();
        assert!(g["ops"].is_object() && g.get("egroup").is_none(), "{g:?}");
        assert_eq!(
            e(json!({"title": "t", "visual": "abc", "source": "lot"})),
            "パネル「t」の稼働・ABC 分析は、作業実績（作業開始と作業終了がある）で使えます。"
        );
        let p = clean_panel(&json!({"visual": "kpi", "source": "src:wip", "period": {"column": "@workday", "kind": "days", "n": "99999"}}))
            .unwrap();
        assert_eq!(p["period"]["n"], 3660);
        assert_eq!(p["body"]["measures"], json!([{"agg": "lots"}]));
        assert_eq!(link_key("$Ａ1"), "A1");
        assert_eq!(order_names(&[json!("b"), json!("a"), json!("c")], &["C".into(), "B".into()]), vec![json!("c"), json!("b"), json!("a")]);
    }
}
