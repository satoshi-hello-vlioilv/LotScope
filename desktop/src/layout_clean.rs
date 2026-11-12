//! ダッシュボードの中身の確かめ（版 3.81.0。services/dashboard.py の clean_layout 一式を写した部品）。
//!
//! 道（GET・POST・PUT・DELETE /api/dashboards・PUT /api/dashboards-hidden）は次の版でこの部品の上に載せる。この版では部品だけを作り、
//! Python の答えを焼いた事例の表（program/tests/fixtures/layout_cases.json。program/tools/layout-cases.py が焼き、古い表は
//! tests/test_layout_cases.py が止める）と突き合わせる（cargo test --test layout_cases）。
//!
//! 中身は送った順を保つ木（jsontree::Tree）で読む。Python は送った順の dict で確かめるので、先頭 40 個を残す色・系列・120 字で切った後に
//! 重なる名前（後ろが勝つ）・字にした表（str(dict)）の並びが、送った順でないと割れる。置く字は json.dumps(sort_keys=True)（join::py_dumps）。
//!
//! 窓が Python と同じに読めない形は Stop::Py（Python に任せる）: 数として読む字（int()・float()）が ASCII の印字できる字と空白でない
//! （全角の数・\x1c〜\x1f の空白・4,000 字を超える字）、字にする並び・表の中の字に ASCII と和文の印字できる字でない物がある、
//! Python が道の外の例外で落ちる形（外した組み込みの中身・前の版の条件の中身が表でない真の値、keys が数・真）。

use crate::jsontree::Tree;
use crate::pyfmt::{self, strip};
use serde_json::{json, Map, Value};

/// 確かめを止める理由（Layout は Python の LayoutError〈画面に出す理由〉・Py は窓が答えず Python に任せる）
#[derive(Debug, Clone, PartialEq)]
pub enum Stop {
    Layout(String),
    Py,
}

type R<T> = Result<T, Stop>;

fn err<T>(m: impl Into<String>) -> R<T> {
    Err(Stop::Layout(m.into()))
}

pub const GRID_COLS: i64 = 12;
pub const ROWS_MIN: i64 = 4;
pub const ROWS_MAX: i64 = 16;
pub const ROWS_DEFAULT: i64 = 8;
const MAX_PANELS: usize = 24;
const MAX_BYTES: usize = 64 * 1024 * 2;
const MAX_FILTERS: usize = 20;
const IN_MAX: usize = 20000;
const MAX_EQUIPS: usize = 200;
const MAX_EGROUPS: usize = 24;
const MAX_MEASURES: usize = 6; // pivot.MAX_MEASURES
const MAX_CALC: usize = 40; // formula.MAX_CALC
const MAX_LEN: usize = 2000; // formula.MAX_LEN
const MAX_CALC_EQUIPS: usize = 200; // formula.MAX_CALC_EQUIPS
const MAX_REFS: usize = 4;
const MAX_COLORS: usize = 40;
const PCOLORS_MAX: usize = 10;
const NUM_MAX: usize = 160;
const EXPR_MAX: usize = 60;
const UNIT_MAX: usize = 12;
const MAX_SIDES: usize = 4;
const MAX_GROUPS: usize = 4;
const MAX_ORDER: usize = 200;
const TOP_MAX: i64 = 60;
const ABC_LIMS_MAX: usize = 50;
const SUM_NAME: &str = "選んだ設備の計";
pub const BUILTIN_KEYS: [&str; 1] = ["standard"];

const PERIODS: [&str; 12] = [
    "today",
    "yesterday",
    "days",
    "this_month",
    "last_month",
    "month",
    "range",
    "days_before",
    "months",
    "this_year",
    "last_year",
    "years",
];
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
const EXTRA_VISUALS: [&str; 5] = ["kpi", "board", "gantt", "abc", "slicer"];
const OPS_VISUALS: [&str; 2] = ["gantt", "abc"];
const SLICER_PARTS: [&str; 3] = ["period", "date", "equip"];
const SORTS: [&str; 3] = ["", "desc", "asc"];
const FRAMES: [&str; 9] = ["card", "emph", "accent", "plain", "tint", "top", "float", "wash", "night"];
const EGROUP_MODES: [&str; 3] = ["sum", "panel", "master"];
const EGROUP_RESTS: [&str; 3] = ["keep", "other", "hide"];
const ESPLITS: [&str; 3] = ["series", "facet", "sum"];
const LINK_ROLES: [&str; 3] = ["target", "actual", ""];
const LINK_BUILDS: [&str; 2] = ["as", "cum"];
const LINK_EXTRAS: [&str; 2] = ["diff", "rate"];
const BOARD_LOOKS: [&str; 8] = ["bar", "heat", "num", "stack", "share", "dot", "signal", "spark"];
const BOARD_ORDERS: [&str; 4] = ["value", "name", "equip", "manual"];
const ABC_ITEMS: [&str; 10] = ["share", "occ", "lshare", "cum", "rank", "avg", "factor", "conv", "chart", "foot"];
const SERIES_LABELS: [&str; 3] = ["top", "below", "off"];
const SERIES_KINDS: [&str; 3] = ["bar", "line", "area"];
const SERIES_AXES: [&str; 2] = ["left", "right"];
const NUM_CATS: [&str; 5] = ["num", "cur", "pct", "sci", "custom"];
const NUM_NEGS: [&str; 5] = ["minus", "tri", "paren", "red", "redtri"];
const ALIGNS: [&str; 3] = ["left", "center", "right"];
const VALIGNS: [&str; 3] = ["top", "middle", "bottom"];
const NSIZES: [&str; 3] = ["s", "l", "xl"];
const STYLES: [&str; 7] = ["", "round", "grad", "outline", "soft", "shadow", "bold"];
const FMT_CHOICES: [(&str, &[&str]); 10] = [
    ("labels", &["auto", "none", "top", "inside", "both"]),
    ("xdate", &["auto", "md", "mdw", "d", "dw", "ymd", "ym", "w"]),
    ("xrot", &["auto", "0", "45", "90"]),
    ("unit", &["auto", "none", "k", "man", "m", "oku"]),
    ("legend", &["auto", "none", "top", "bottom"]),
    ("size", &["s", "m", "l"]),
    (
        "palette",
        &[
            "", "vivid", "calm", "cud", "mono", "warm", "cool", "biz", "pastel", "wa", "ocean", "sunset", "earth", "neon", "blue", "green",
            "olive", "gold", "red", "purple", "gray", "custom",
        ],
    ),
    ("kpi", &["num", "bar", "gauge"]),
    // 数字のパネルの置き方（版 3.92.0。Python の KPI_PAIRS・KPI_METAS）
    ("kpair", &["side", "stack"]),
    ("kmeta", &["top", "row"]),
];
// aggregate.AGGS・COUNTS・SHOWS
const AGGS: [&str; 20] = [
    "count", "lots", "sum", "avg", "min", "max", "n", "range", "sd", "var", "cv", "cpk", "median", "q1", "q3", "iqr", "pct", "mode",
    "distinct", "base",
];
const SHOWS: [&str; 6] = ["pct_total", "pct_row", "pct_col", "cum", "diff", "rank"];

// ---------------------------------------------------------------- Python の値の読み方（木の上で）
fn get<'a>(t: &'a Tree, k: &str) -> Option<&'a Tree> {
    t.get(k)
}

fn arr(t: Option<&Tree>) -> &[Tree] {
    match t {
        Some(Tree::Arr(a)) => a,
        _ => &[],
    }
}

fn s_of(t: Option<&Tree>) -> Option<&str> {
    match t {
        Some(Tree::Str(s)) => Some(s),
        _ => None,
    }
}

/// 字が引数と同じか（Python の v in (…) は字のときだけ当たる）
fn is_in(t: Option<&Tree>, choices: &[&str]) -> bool {
    s_of(t).is_some_and(|s| choices.contains(&s))
}

pub fn truthy(t: &Tree) -> bool {
    match t {
        Tree::Null => false,
        Tree::Bool(b) => *b,
        Tree::Num(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Tree::Str(s) => !s.is_empty(),
        Tree::Arr(a) => !a.is_empty(),
        Tree::Obj(m) => !m.is_empty(),
    }
}

fn truthy_o(t: Option<&Tree>) -> bool {
    t.is_some_and(truthy)
}

/// repr できる字（ASCII の印字できる字と、和文の印字できる字。ほかの字の repr の逃がしは窓が Python と同じにできない）
fn repr_safe(s: &str) -> bool {
    s.chars().all(|c| {
        let n = c as u32;
        // 割り当てのある和文の範囲だけ（Python 3.13〈Unicode 15.1〉で isprintable が真。版 3.81.0 の採点で、U+3040・U+3097 などの割り当ての無い字は
        // Python が \\u で逃がすと分かった）: 和文の記号・ひらがな・カタカナ・CJK 統合漢字・全角の英数と記号
        (0x20..0x7f).contains(&n)
            || (0x3001..=0x303f).contains(&n)
            || (0x3041..=0x3096).contains(&n)
            || (0x3099..=0x30ff).contains(&n)
            || (0x4e00..=0x9fff).contains(&n)
            || (0xff01..=0xff5e).contains(&n)
    })
}

fn num_str(n: &serde_json::Number) -> String {
    match n.as_i64() {
        Some(i) => i.to_string(),
        None => pyfmt::float_repr(n.as_f64().unwrap_or(0.0)),
    }
}

/// Python の repr（並び・表の中の値）
fn py_repr(t: &Tree) -> R<String> {
    Ok(match t {
        Tree::Str(s) => {
            if !repr_safe(s) {
                return Err(Stop::Py);
            }
            pyfmt::str_repr(s)
        }
        other => py_str(other)?,
    })
}

/// Python の str(v)
fn py_str(t: &Tree) -> R<String> {
    Ok(match t {
        Tree::Null => "None".into(),
        Tree::Bool(b) => if *b { "True" } else { "False" }.into(),
        Tree::Num(n) => num_str(n),
        Tree::Str(s) => s.clone(),
        Tree::Arr(a) => format!("[{}]", a.iter().map(py_repr).collect::<R<Vec<_>>>()?.join(", ")),
        Tree::Obj(m) => format!(
            "{{{}}}",
            m.iter().map(|(k, v)| Ok(format!("{}: {}", py_repr(&Tree::Str(k.clone()))?, py_repr(v)?))).collect::<R<Vec<_>>>()?.join(", ")
        ),
    })
}

/// Python の str(v or "")
fn str_or(t: Option<&Tree>) -> R<String> {
    match t {
        Some(x) if truthy(x) => py_str(x),
        _ => Ok(String::new()),
    }
}

fn take(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// str(v or "").strip()[:n]
fn stripped(t: Option<&Tree>, n: usize) -> R<String> {
    Ok(take(strip(&str_or(t)?), n))
}

/// 数として読む字を窓が Python と同じに読めるか（ASCII の印字できる字と ASCII の空白だけ・4,000 字まで）
fn num_text_plain(s: &str) -> bool {
    s.len() <= 4000 && s.bytes().all(|b| (0x20..0x7f).contains(&b) || b"\t\n\r\x0b\x0c".contains(&b))
}

/// Python の int(v)（読めなければ None。版 3.104.0 から pyfmt::py_int_of の 1 つ。前は ASCII でない字を Python に任せていた）
fn py_int_of(t: Option<&Tree>) -> R<Option<i128>> {
    Ok(t.and_then(|x| pyfmt::py_int_of(x.into()).ok()).map(|n| n.wide_saturating()))
}

/// _int(v, lo, hi, default)
fn int_of(t: Option<&Tree>, lo: i64, hi: i64, d: i64) -> R<i64> {
    Ok(match py_int_of(t)? {
        Some(n) => n.clamp(lo as i128, hi as i128) as i64, // Python は max(lo, min(hi, n))
        None => d,
    })
}

/// Python の float(v)（読めない・有限でなければ None。aggregate._num・dashboard._float）
fn float_of(t: Option<&Tree>) -> R<Option<f64>> {
    let f = match t {
        Some(Tree::Bool(b)) => Some(if *b { 1.0 } else { 0.0 }),
        Some(Tree::Num(n)) => n.as_f64(),
        Some(Tree::Str(s)) => {
            if !num_text_plain(s) {
                return Err(Stop::Py);
            }
            pyfmt::py_float(s).ok()
        }
        _ => None,
    };
    Ok(f.filter(|f| f.is_finite()))
}

fn is_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// \d{4}-\d{2}-\d{2}（Python の \d は Unicode の 10 進の数字）
fn is_day(t: &str) -> bool {
    let cs: Vec<char> = t.chars().collect();
    cs.len() == 10 && cs.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == '-' } else { pyfmt::digit(*c).is_some() })
}

// ---------------------------------------------------------------- 部品（Python の同じ名前の関数）
/// pivot_presets._dims（並びの先頭 3 つ・column が空でない字の物）
fn dims(t: Option<&Tree>) -> R<Vec<Value>> {
    let mut out = vec![];
    for d in arr(t).iter().take(3) {
        let Tree::Obj(_) = d else { continue };
        let Some(col) = s_of(get(d, "column")).filter(|c| !c.is_empty()) else { continue };
        let mut x = Map::new();
        x.insert("column".into(), json!(take(col, 200)));
        x.insert("part".into(), json!(take(&str_or(get(d, "part"))?, 10)));
        for k in ["width", "origin"] {
            if let Some(Tree::Num(n)) = get(d, k) {
                x.insert(k.into(), Value::Number(n.clone()));
            }
        }
        out.push(Value::Object(x));
    }
    Ok(out)
}

/// _filters
fn filters(t: Option<&Tree>) -> R<Vec<Value>> {
    let mut out = vec![];
    for f in arr(t).iter().take(MAX_FILTERS) {
        let Tree::Obj(_) = f else { continue };
        let col = strip(&str_or(get(f, "column"))?).to_string();
        let op_full = strip(&str_or(get(f, "op"))?).to_string();
        if col.is_empty() || op_full.is_empty() {
            continue;
        }
        let op = take(&op_full, 20);
        let value = match get(f, "value") {
            None | Some(Tree::Null) => String::new(),
            Some(v) => take(&py_str(v)?, if op == "in" { IN_MAX } else { 400 }),
        };
        let mut x = json!({"column": take(&col, 200), "op": op, "value": value});
        if op == "in" && is_in(get(f, "key"), &["date", "month", "year"]) {
            x["key"] = json!(s_of(get(f, "key")).unwrap());
        }
        out.push(x);
    }
    Ok(out)
}

/// _day
fn day(t: Option<&Tree>) -> R<String> {
    let s = take(&str_or(t)?, 10);
    Ok(if is_day(&s) { s } else { String::new() })
}

/// _period
fn period(t: Option<&Tree>) -> R<Value> {
    let Some(v @ Tree::Obj(_)) = t else { return Ok(Value::Null) };
    if !is_in(get(v, "kind"), &PERIODS) {
        return Ok(Value::Null);
    }
    let col = stripped(get(v, "column"), usize::MAX)?;
    if col.is_empty() {
        return Ok(Value::Null);
    }
    let kind = s_of(get(v, "kind")).unwrap();
    let mut out = json!({"column": take(&col, 200), "kind": kind, "n": int_of(get(v, "n"), 1, 3660, 7)?});
    if kind == "range" {
        let days: Vec<String> = [day(get(v, "from"))?, day(get(v, "to"))?].into_iter().filter(|x| !x.is_empty()).collect();
        if days.is_empty() {
            return Ok(Value::Null);
        }
        out["from"] = json!(days.iter().min().unwrap());
        out["to"] = json!(days.iter().max().unwrap());
    }
    Ok(out)
}

/// formula.clean_calc（字なら JSON として読む）
fn clean_calc(t: Option<&Tree>) -> R<Option<Value>> {
    let parsed;
    let v = match t {
        Some(Tree::Str(s)) => {
            if strip(s).is_empty() {
                return Ok(None);
            }
            if crate::master_rows::text_split(s) {
                return Err(Stop::Py);
            }
            match Tree::parse(s) {
                Some(x) => {
                    parsed = x;
                    &parsed
                }
                None => return Ok(None),
            }
        }
        Some(x) => x,
        None => return Ok(None),
    };
    let Tree::Obj(_) = v else { return Ok(None) };
    let strs = |d: Option<&Tree>, n: usize, size: usize| -> R<Map<String, Value>> {
        let mut out = Map::new();
        if let Some(Tree::Obj(m)) = d {
            for (k, x) in m.iter().take(n) {
                if let Tree::Str(x) = x {
                    if !strip(k).is_empty() {
                        out.insert(take(k, 200), json!(take(x, size)));
                    }
                }
            }
        }
        Ok(out)
    };
    let mut f = strs(get(v, "formulas"), MAX_CALC, MAX_LEN)?;
    f.retain(|_, x| !strip(x.as_str().unwrap_or("")).is_empty());
    let mut eq = Map::new();
    if let Some(Tree::Obj(m)) = get(v, "equips") {
        for (k, x) in m.iter().take(MAX_CALC_EQUIPS) {
            if !matches!(x, Tree::Obj(_)) || strip(k).is_empty() {
                continue;
            }
            let mut inner = vec![];
            if let Some(y) = get(x, "formulas") {
                inner.push(("formulas".to_string(), y.clone()));
            } else {
                inner.push(("formulas".to_string(), Tree::Null));
            }
            inner.push(("names".to_string(), get(x, "names").cloned().unwrap_or(Tree::Null)));
            if let Some(c) = clean_calc(Some(&Tree::Obj(inner)))? {
                eq.insert(take(k, 200), c);
            }
        }
    }
    if f.is_empty() && eq.is_empty() {
        return Ok(None);
    }
    let mut own = vec![];
    for x in arr(get(v, "own")) {
        let s = py_str(x)?;
        if f.contains_key(&s) {
            own.push(json!(take(&s, 200)));
        }
    }
    own.truncate(MAX_CALC);
    let mut out = json!({"formulas": f, "names": strs(get(v, "names"), 400, 200)?});
    if !own.is_empty() {
        out["own"] = json!(own);
    }
    if !eq.is_empty() {
        out["equips"] = Value::Object(eq);
    }
    Ok(Some(out))
}

/// aggregate.clean（has_column は bool(列)）。ValueError は Err(Stop::Layout(理由))
fn agg_clean(m: &Tree, column: &str, names: &[String]) -> R<Map<String, Value>> {
    let agg = s_of(get(m, "agg")).unwrap_or("count");
    let agg = if agg.is_empty() { "count" } else { agg };
    let counts = agg == "count" || agg == "lots" || agg == "base";
    let col = if counts { String::new() } else { column.to_string() };
    if !counts && col.is_empty() {
        return err(format!("値の列「{col}」がありません。"));
    }
    let mut out = Map::new();
    out.insert("agg".into(), json!(agg));
    out.insert("column".into(), json!(col));
    if agg == "base" {
        // 基準の数（版 3.103.0）: その数そのものを値に（名前は決まった数かこのパネルの作った数）
        let b = strip(&str_or(get(m, "base"))?).to_string();
        if !names.contains(&b) {
            return err(format!("基準の数「{b}」がありません。"));
        }
        out.insert("base".into(), json!(b));
    }
    if agg == "pct" {
        let p = float_of(get(m, "p"))?;
        out.insert("p".into(), json!(p.map(|p| p.round_ties_even().clamp(1.0, 99.0) as i64).unwrap_or(90)));
    }
    if agg == "cpk" {
        let (lsl, usl) = (float_of(get(m, "lsl"))?, float_of(get(m, "usl"))?);
        if lsl.is_none() && usl.is_none() {
            return err(format!("「{col}」の Cpk には、規格の下限か上限が要ります。"));
        }
        if let (Some(a), Some(b)) = (lsl, usl) {
            if a >= b {
                return err(format!("「{col}」の Cpk の規格は、下限 < 上限にしてください。"));
            }
        }
        for (k, v) in [("lsl", lsl), ("usl", usl)] {
            if let Some(v) = v {
                out.insert(k.into(), json!(v));
            }
        }
    }
    let show = str_or(get(m, "show"))?;
    if SHOWS.contains(&show.as_str()) {
        out.insert("show".into(), json!(show));
    }
    let expr = take(strip(&str_or(get(m, "expr"))?), EXPR_MAX);
    if !expr.is_empty() {
        if let Err(e) = crate::num_expr::compile_with(&expr, Some(names), true) {
            return err(format!("「{}」の計算「{expr}」が読めません（{e}）。", crate::aggregate::name(&out)));
        }
        out.insert("expr".into(), json!(expr));
    }
    if let Some(Tree::Str(per)) = get(m, "per") {
        let per = strip(per);
        if !per.is_empty() {
            if !names.iter().any(|n| n == per) {
                return err(format!("「{}」を割る基準の数「{per}」がありません。", crate::aggregate::name(&out)));
            }
            out.insert("per".into(), json!(per));
        }
    }
    if let Some(d) = float_of(get(m, "dec"))? {
        out.insert("dec".into(), json!(d.round_ties_even().clamp(0.0, 6.0) as i64));
    }
    if let Some(Tree::Str(u)) = get(m, "utext") {
        out.insert("utext".into(), json!(take(strip(u), 12)));
    }
    if matches!(get(m, "hideExpr"), Some(Tree::Bool(true))) {
        out.insert("hideExpr".into(), json!(true));
    }
    Ok(out)
}

/// _measure（合わなければ None。読めない計算は外して値は残す）。決まった数だけの名前（合わせた表・合わせるデータ）
fn measure(m: Option<&Tree>) -> R<Option<Map<String, Value>>> {
    measure_with(m, &crate::capacity::names_of(&[]))
}

/// names … 使える基準の数の名前（版 3.103.0。パネルの作った数も）。無い基準の数で割る物は、割らずに残す
fn measure_with(m: Option<&Tree>, names: &[String]) -> R<Option<Map<String, Value>>> {
    let Some(m @ Tree::Obj(_)) = m else { return Ok(None) };
    if !is_in(get(m, "agg"), &AGGS) {
        return Ok(None);
    }
    let col = take(&str_or(get(m, "column"))?, 200);
    let out = match agg_clean(m, &col, names) {
        Ok(o) => o,
        Err(Stop::Py) => return Err(Stop::Py),
        Err(Stop::Layout(_)) => {
            let drop = if truthy_o(get(m, "expr")) {
                "expr"
            } else if truthy_o(get(m, "per")) {
                "per"
            } else {
                return Ok(None);
            };
            let Tree::Obj(items) = m else { unreachable!() };
            let rest = Tree::Obj(items.iter().filter(|(k, _)| k != drop).cloned().collect());
            return measure_with(Some(&rest), names);
        }
    };
    Ok(Some(out.into_iter().filter(|(k, v)| !(k == "column" && v.as_str() == Some(""))).collect()))
}

/// 作った基準の数の並び（Python の capacity.clean_own）。並びでなければ None
fn clean_own(t: Option<&Tree>) -> R<Option<Vec<Value>>> {
    let Some(Tree::Arr(xs)) = t else { return Ok(None) };
    let fixed = crate::capacity::names_of(&[]);
    let mut out: Vec<Value> = vec![];
    for x in xs {
        if !matches!(x, Tree::Obj(_)) {
            continue;
        }
        let name = stripped(get(x, "name"), 16)?;
        let expr = stripped(get(x, "expr"), 60)?;
        if name.is_empty()
            || name.contains('[')
            || name.contains(']')
            || fixed.contains(&name)
            || out.iter().any(|o| o["name"] == json!(name))
        {
            continue;
        }
        if !matches!(crate::num_expr::compile_with(&expr, Some(&fixed), false), Ok(Some(_))) {
            continue;
        }
        let mut b = Map::new();
        b.insert("name".into(), json!(name));
        b.insert("expr".into(), json!(expr));
        if matches!(get(x, "each"), Some(Tree::Bool(true))) {
            b.insert("each".into(), json!(true));
        }
        if let Some(Tree::Str(u)) = get(x, "unit") {
            let u = take(strip(u), 6);
            if !u.is_empty() {
                b.insert("unit".into(), json!(u));
            }
        }
        out.push(Value::Object(b));
        if out.len() >= 12 {
            break;
        }
    }
    Ok(Some(out))
}

/// _names
fn names(t: Option<&Tree>, n: usize) -> R<Vec<String>> {
    let mut out: Vec<String> = vec![];
    for x in arr(t).iter().take(n) {
        let s = take(strip(&str_or(Some(x))?), 120);
        if !s.is_empty() && !out.contains(&s) {
            out.push(s);
        }
    }
    Ok(out)
}

/// clean_egroup
fn clean_egroup(t: Option<&Tree>) -> R<Option<Value>> {
    let Some(v @ Tree::Obj(_)) = t else { return Ok(None) };
    if !is_in(get(v, "mode"), &EGROUP_MODES) {
        return Ok(None);
    }
    let mode = s_of(get(v, "mode")).unwrap();
    let rest = if is_in(get(v, "rest"), &EGROUP_RESTS) { s_of(get(v, "rest")).unwrap() } else { "keep" };
    let mut out = json!({"mode": mode, "rest": rest});
    match mode {
        "sum" => {
            let n = stripped(get(v, "name"), 40)?;
            out["name"] = json!(if n.is_empty() { SUM_NAME.to_string() } else { n });
        }
        "panel" => {
            let mut gs = vec![];
            for g in arr(get(v, "groups")).iter().take(MAX_EGROUPS) {
                if matches!(g, Tree::Obj(_)) && !strip(&str_or(get(g, "name"))?).is_empty() {
                    gs.push(json!({"name": stripped(get(g, "name"), 40)?, "members": names(get(g, "members"), MAX_EQUIPS)?}));
                }
            }
            if gs.is_empty() {
                return Ok(None);
            }
            out["groups"] = json!(gs);
        }
        _ => {
            let s = stripped(get(v, "set"), 40)?;
            if s.is_empty() {
                return Ok(None);
            }
            out["set"] = json!(s);
        }
    }
    Ok(Some(out))
}

/// clean_fmt（既定と違う物だけ。無ければ None）
fn clean_fmt(t: Option<&Tree>) -> R<Option<Value>> {
    let Some(v @ Tree::Obj(_)) = t else { return Ok(None) };
    let mut out = Map::new();
    for (k, choices) in FMT_CHOICES {
        let x = str_or(get(v, k))?;
        if choices.contains(&x.as_str()) && !["auto", "", "m", "num"].contains(&x.as_str()) {
            out.insert(k.into(), json!(x));
        }
    }
    let d = int_of(get(v, "digits"), -1, 4, -1)?;
    if d >= 0 {
        out.insert("digits".into(), json!(d));
    }
    for k in ["ymin", "ymax", "target"] {
        if let Some(f) = float_of(get(v, k))? {
            out.insert(k.into(), json!(f));
        }
    }
    if let (Some(a), Some(b)) = (out.get("ymin").and_then(Value::as_f64), out.get("ymax").and_then(Value::as_f64)) {
        if a >= b {
            out.remove("ymax");
        }
    }
    if matches!(get(v, "grid"), Some(Tree::Bool(false))) {
        out.insert("grid".into(), json!(false));
    }
    let mut refs = vec![];
    for r in arr(get(v, "refs")).iter().take(MAX_REFS) {
        let f = if matches!(r, Tree::Obj(_)) { float_of(get(r, "value"))? } else { None };
        if let Some(f) = f {
            let c = str_or(get(r, "color"))?;
            refs.push(json!({"value": f, "label": stripped(get(r, "label"), 20)?, "color": if is_color(&c) { c } else { String::new() }}));
        }
    }
    if !refs.is_empty() {
        out.insert("refs".into(), json!(refs));
    }
    if let Some(Tree::Obj(m)) = get(v, "colors") {
        let mut cs = Map::new();
        for (k, c) in m.iter().take(MAX_COLORS) {
            let c = py_str(c)?;
            if !strip(k).is_empty() && is_color(&c) {
                cs.insert(take(k, 120), json!(c)); // 120 字で切った後に重なれば後ろが勝つ（Python の dict）
            }
        }
        if !cs.is_empty() {
            out.insert("colors".into(), Value::Object(cs));
        }
    }
    if let Some(Tree::Obj(m)) = get(v, "series") {
        let mut ss = Map::new();
        for (k, x) in m.iter().take(MAX_COLORS) {
            let mut one = Map::new();
            if matches!(x, Tree::Obj(_)) {
                if is_in(get(x, "label"), &SERIES_LABELS) {
                    one.insert("label".into(), json!(s_of(get(x, "label")).unwrap()));
                }
                if matches!(get(x, "dash"), Some(Tree::Bool(true))) {
                    one.insert("dash".into(), json!(true));
                }
                if is_in(get(x, "kind"), &SERIES_KINDS) {
                    one.insert("kind".into(), json!(s_of(get(x, "kind")).unwrap()));
                }
                if is_in(get(x, "axis"), &SERIES_AXES) {
                    one.insert("axis".into(), json!(s_of(get(x, "axis")).unwrap()));
                }
            }
            if !strip(k).is_empty() && !one.is_empty() {
                ss.insert(take(k, 120), Value::Object(one));
            }
        }
        if !ss.is_empty() {
            out.insert("series".into(), Value::Object(ss));
        }
    }
    let code = stripped(get(v, "num"), NUM_MAX)?;
    if !code.is_empty() {
        out.insert("num".into(), json!(code));
        if let Some(ui @ Tree::Obj(_)) = get(v, "numUi") {
            if is_in(get(ui, "cat"), &NUM_CATS) {
                out.insert(
                    "numUi".into(),
                    json!({"cat": s_of(get(ui, "cat")).unwrap(), "dec": int_of(get(ui, "dec"), 0, 6, 0)?,
                           "sep": !matches!(get(ui, "sep"), Some(Tree::Bool(false))),
                           "neg": if is_in(get(ui, "neg"), &NUM_NEGS) { s_of(get(ui, "neg")).unwrap() } else { "minus" },
                           "pre": take(&str_or(get(ui, "pre"))?, 12), "suf": take(&str_or(get(ui, "suf"))?, 12)}),
                );
            }
        }
    }
    for (k, choices) in [("align", &ALIGNS[..]), ("valign", &VALIGNS[..]), ("nsize", &NSIZES[..])] {
        if is_in(get(v, k), choices) {
            out.insert(k.into(), json!(s_of(get(v, k)).unwrap()));
        }
    }
    if s_of(get(v, "bold")) == Some("off") {
        out.insert("bold".into(), json!("off"));
    }
    if is_in(get(v, "style"), &STYLES[1..]) {
        out.insert("style".into(), json!(s_of(get(v, "style")).unwrap()));
    }
    if out.get("palette").and_then(Value::as_str) == Some("custom") {
        let mut pcs = vec![];
        for c in arr(get(v, "pcolors")) {
            let s = py_str(c)?;
            if is_color(&s) {
                pcs.push(json!(s.to_ascii_lowercase()));
            }
        }
        pcs.truncate(PCOLORS_MAX);
        if pcs.is_empty() {
            out.remove("palette");
        } else {
            out.insert("pcolors".into(), json!(pcs));
        }
    }
    let c = str_or(get(v, "ncolor"))?;
    if is_color(&c) {
        out.insert("ncolor".into(), json!(c));
    }
    let e = stripped(get(v, "expr"), EXPR_MAX)?;
    if !e.is_empty() && e.chars().all(expr_char) {
        out.insert("expr".into(), json!(e));
    }
    if let Some(Tree::Str(u)) = get(v, "utext") {
        out.insert("utext".into(), json!(take(strip(u), UNIT_MAX)));
    }
    Ok(if out.is_empty() { None } else { Some(Value::Object(out)) })
}

/// 数の計算に使える字（_EXPR: [0-9.xX値ｘＸ+\-*/^()×÷−–✕＋－＊／＾（）０-９．\s]）
fn expr_char(c: char) -> bool {
    c.is_ascii_digit() || "0123456789.xX値ｘＸ+-*/^()×÷−–✕＋－＊／＾（）．".contains(c) || ('０'..='９').contains(&c) || pyfmt::is_space(c)
}

/// _data（数える元と行の決め方）
fn data(p: &Tree, what: &str) -> R<Map<String, Value>> {
    let src = str_or(get(p, "source"))?;
    if !crate::dashboard::is_screen_source(&src) {
        return err(format!("{what}のデータ（lot・work・src:<キー>）が違います。"));
    }
    let mut out = Map::new();
    out.insert("source".into(), json!(src));
    out.insert("equip".into(), json!(take(&str_or(get(p, "equip"))?, 40)));
    out.insert("filters".into(), json!(filters(get(p, "filters"))?));
    out.insert("search".into(), json!(stripped(get(p, "search"), 200)?));
    out.insert("period".into(), period(get(p, "period"))?);
    out.insert("basis".into(), json!(if s_of(get(p, "basis")) == Some("cal") { "cal" } else { "work" }));
    let eq = names(get(p, "equips"), MAX_EQUIPS)?;
    if !eq.is_empty() {
        out.insert("equips".into(), json!(eq));
    }
    // dashboard.clean_calc は表だけを読む（字は None。formula.clean_calc は字も読むが、ここは通らない）
    if let Some(c @ Tree::Obj(_)) = get(p, "calc") {
        if let Some(c) = clean_calc(Some(c))? {
            out.insert("calc".into(), c);
        }
    }
    Ok(out)
}

/// clean_link
fn clean_link(t: Option<&Tree>, what: &str) -> R<Option<Value>> {
    let Some(v @ Tree::Obj(_)) = t else { return Ok(None) };
    let raw = arr(get(v, "sides"));
    if raw.is_empty() {
        return Ok(None);
    }
    if !(2..=MAX_SIDES).contains(&raw.len()) {
        return err(format!("{what}の合わせるデータは 2〜{MAX_SIDES} つです。"));
    }
    let mut sides = vec![];
    for (i, x) in raw.iter().enumerate() {
        if !matches!(x, Tree::Obj(_)) {
            return err(format!("{what}の合わせるデータの形が違います。"));
        }
        let key = match get(x, "key") {
            Some(k @ Tree::Obj(_)) => dims(Some(&Tree::Arr(vec![k.clone()])))?,
            _ => vec![],
        };
        if key.is_empty() {
            return err(format!("{what}の合わせるデータ {} に、軸（合わせる段）がありません。", i + 1));
        }
        let mut m = measure(get(x, "measure"))?.unwrap_or_else(|| json!({"agg": "lots"}).as_object().unwrap().clone());
        m.remove("show");
        let mut side = data(x, &format!("{what}の合わせるデータ {}", i + 1))?;
        side.insert("title".into(), json!(stripped(get(x, "title"), 40)?));
        side.insert("role".into(), json!(if is_in(get(x, "role"), &LINK_ROLES) { s_of(get(x, "role")).unwrap() } else { "" }));
        side.insert("build".into(), json!(if is_in(get(x, "build"), &LINK_BUILDS) { s_of(get(x, "build")).unwrap() } else { "as" }));
        side.insert("key".into(), key[0].clone());
        side.insert("measure".into(), Value::Object(m));
        sides.push(Value::Object(side));
    }
    let ex = arr(get(v, "extra"));
    let extra: Vec<&str> = LINK_EXTRAS.iter().copied().filter(|e| ex.iter().any(|x| s_of(Some(x)) == Some(*e))).collect();
    let mut out = json!({"sides": sides});
    if !extra.is_empty() {
        out["extra"] = json!(extra);
    }
    Ok(Some(out))
}

/// _keys（str(x) が空白だけでない物。None も "None"）
fn keys(t: Option<&Tree>) -> R<Vec<String>> {
    let mut out = vec![];
    for x in arr(t).iter().take(MAX_ORDER) {
        let s = py_str(x)?;
        if !strip(&s).is_empty() {
            out.push(take(&s, 120));
        }
    }
    Ok(out)
}

/// clean_group
fn clean_group(g: &Tree, i: usize) -> R<Value> {
    if !matches!(g, Tree::Obj(_)) {
        return err("列のまとまりの形が違います。");
    }
    let title = stripped(get(g, "title"), 40)?;
    let what = format!("列のまとまり「{}」", if title.is_empty() { (i + 1).to_string() } else { title.clone() });
    let mut out = data(g, &what)?;
    out.insert("title".into(), json!(title));
    out.insert(
        "measure".into(),
        Value::Object(measure(get(g, "measure"))?.unwrap_or_else(|| json!({"agg": "lots"}).as_object().unwrap().clone())),
    );
    out.insert("cols".into(), json!(dims(get(g, "cols"))?.into_iter().take(2).collect::<Vec<_>>()));
    out.insert("look".into(), json!(if is_in(get(g, "look"), &BOARD_LOOKS) { s_of(get(g, "look")).unwrap() } else { "num" }));
    out.insert("total".into(), json!(get(g, "total").is_none_or(truthy)));
    out.insert("zero".into(), json!(truthy_o(get(g, "zero"))));
    let c = str_or(get(g, "color"))?;
    out.insert("color".into(), json!(if is_color(&c) { c } else { String::new() }));
    let lim = get(g, "limits").filter(|l| matches!(l, Tree::Obj(_)));
    let mut l = Map::new();
    for k in ["warn", "alert"] {
        if let Some(f) = float_of(lim.and_then(|x| get(x, k)))? {
            l.insert(k.into(), json!(f));
        }
    }
    if !l.is_empty() {
        l.insert("dir".into(), json!(if lim.and_then(|x| s_of(get(x, "dir"))) == Some("low") { "low" } else { "high" }));
        out.insert("limits".into(), Value::Object(l));
    }
    Ok(Value::Object(out))
}

/// board_default（前の版の 1 枚の表と同じ組み。conds は前の版の条件 {wip, work: {filters, search}}）
pub fn board_default(conds: Option<&Value>) -> Value {
    let c = |k: &str, f: &str| conds.and_then(|c| c.get(k)).and_then(|x| x.get(f)).cloned();
    let fl = |k: &str| c(k, "filters").filter(|v| v.as_array().is_some_and(|a| !a.is_empty())).unwrap_or(json!([]));
    let se = |k: &str| c(k, "search").filter(|v| v.as_str().is_some_and(|s| !s.is_empty())).unwrap_or(json!(""));
    json!({"rows": {"column": "@equip", "part": ""},
           "groups": [{"title": "仕掛ロット数", "source": "src:wip", "equip": "", "filters": fl("wip"), "search": se("wip"),
                       "period": null, "basis": "work", "measure": {"agg": "lots"}, "cols": [], "look": "bar", "total": true, "zero": false, "color": ""},
                      {"title": "", "source": "work", "equip": "", "filters": fl("work"), "search": se("work"),
                       "period": {"column": "@workday", "kind": "yesterday", "n": 7}, "basis": "work", "measure": {"agg": "lots"},
                       "cols": [{"column": "@shift", "part": ""}], "look": "heat", "total": true, "zero": true, "color": ""}],
           "order": {"by": "value", "group": 0, "dir": "desc", "list": [], "hide": []}})
}

/// clean_board
fn clean_board(p: &Tree, what: &str) -> R<Map<String, Value>> {
    let groups = arr(get(p, "groups"));
    if groups.is_empty() {
        return Ok(board_default(None).as_object().unwrap().clone());
    }
    if groups.len() > MAX_GROUPS {
        return err(format!("{what}の列のまとまりは {MAX_GROUPS} つまでです。"));
    }
    let rows = match get(p, "rows") {
        Some(r @ Tree::Obj(_)) => dims(Some(&Tree::Arr(vec![r.clone()])))?,
        _ => vec![],
    };
    let o = get(p, "order").filter(|o| matches!(o, Tree::Obj(_)));
    let og = |k: &str| o.and_then(|o| get(o, k));
    let gs = groups.iter().enumerate().map(|(i, g)| clean_group(g, i)).collect::<R<Vec<_>>>()?;
    let mut out = Map::new();
    let eq = names(get(p, "equips"), MAX_EQUIPS)?;
    if !eq.is_empty() {
        out.insert("equips".into(), json!(eq));
    }
    if let Some(e) = clean_egroup(get(p, "egroup"))? {
        out.insert("egroup".into(), e);
    }
    let fl = filters(get(p, "filters"))?;
    if !fl.is_empty() {
        out.insert("filters".into(), json!(fl));
    }
    let is_equip = rows.first().is_none_or(|r| r["column"] == "@equip");
    let mut order = json!({"by": if is_in(og("by"), &BOARD_ORDERS) { s_of(og("by")).unwrap() } else { "value" },
                           "group": int_of(og("group"), 0, gs.len() as i64 - 1, 0)?,
                           "dir": if s_of(og("dir")) == Some("asc") { "asc" } else { "desc" },
                           "list": keys(og("list"))?, "hide": keys(og("hide"))?});
    if is_equip && !strip(&str_or(og("tree"))?).is_empty() {
        order["tree"] = json!(take(strip(&py_str(og("tree").unwrap())?), 40));
        order["glist"] = json!(keys(og("glist"))?);
    }
    out.insert("rows".into(), rows.first().cloned().unwrap_or(json!({"column": "@equip", "part": ""})));
    out.insert("groups".into(), json!(gs));
    out.insert("order".into(), order);
    Ok(out)
}

/// abc_lims
fn abc_lims(v: &Tree) -> R<Vec<f64>> {
    let raw: Vec<Tree> = match get(v, "lims") {
        Some(Tree::Arr(a)) => a.clone(),
        _ => vec![
            get(v, "a").cloned().unwrap_or(Tree::Num(serde_json::Number::from_f64(70.0).unwrap())),
            get(v, "b").cloned().unwrap_or(Tree::Num(serde_json::Number::from_f64(90.0).unwrap())),
        ],
    };
    let mut xs: Vec<f64> = vec![];
    for r in &raw {
        if let Some(x) = float_of(Some(r))? {
            if x > 0.0 {
                let y = crate::aggregate::py_round(x.min(100.0), 4);
                if !xs.contains(&y) {
                    xs.push(y);
                }
            }
        }
    }
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    xs.truncate(ABC_LIMS_MAX);
    Ok(if xs.is_empty() { vec![70.0, 90.0] } else { xs })
}

/// clean_ops
fn clean_ops(t: Option<&Tree>) -> R<Value> {
    let empty = Tree::Obj(vec![]);
    let v = match t {
        Some(x @ Tree::Obj(_)) => x,
        _ => &empty,
    };
    let col = |k: &str| stripped(get(v, k), 200);
    let lims = abc_lims(v)?;
    let mut out = Map::new();
    for k in ["start", "end", "label", "color"] {
        let c = col(k)?;
        if !c.is_empty() {
            out.insert(k.into(), json!(c));
        }
    }
    if s_of(get(v, "span")) == Some("lead") {
        out.insert("span".into(), json!("lead"));
    }
    if let Some(Tree::Obj(m)) = get(v, "refPeriod") {
        let mut m = m.clone();
        match m.iter_mut().find(|(k, _)| k == "column") {
            Some(slot) => slot.1 = Tree::Str("@workday".into()),
            None => m.push(("column".into(), Tree::Str("@workday".into()))),
        }
        let r = period(Some(&Tree::Obj(m)))?;
        if !r.is_null() {
            out.insert("refPeriod".into(), r);
        }
    }
    let hl = arr(get(v, "hide"));
    let hide: Vec<&str> = ABC_ITEMS.iter().copied().filter(|x| hl.iter().any(|h| s_of(Some(h)) == Some(*x))).collect();
    if !hide.is_empty() {
        out.insert("hide".into(), json!(hide));
    }
    let cls_raw: Vec<String> = match get(v, "cls") {
        Some(Tree::Arr(a)) => a.iter().map(|x| stripped(Some(x), 200)).collect::<R<_>>()?,
        _ => vec![col("cls")?],
    };
    let mut cls: Vec<String> = vec![];
    for c in cls_raw {
        if !c.is_empty() && !cls.contains(&c) {
            cls.push(c);
        }
    }
    cls.truncate(4);
    if cls.len() == 1 {
        out.insert("cls".into(), json!(cls[0]));
    } else if !cls.is_empty() {
        out.insert("cls".into(), json!(cls));
    }
    let qty = col("qty")?;
    let base = stripped(get(v, "base"), 120)?;
    out.insert("qty".into(), json!(if qty.is_empty() { "lots".to_string() } else { qty }));
    out.insert("base".into(), json!(if base.is_empty() { "avg".to_string() } else { base }));
    if lims != [70.0, 90.0] {
        out.insert("lims".into(), json!(lims));
    }
    if s_of(get(v, "rankBy")) == Some("each") {
        out.insert("rankBy".into(), json!("each"));
    }
    Ok(Value::Object(out))
}

/// clean_slicer（既定〈出す・期間と設備〉なら空）
fn clean_slicer(t: Option<&Tree>) -> Value {
    let empty = Tree::Obj(vec![]);
    let v = match t {
        Some(x @ Tree::Obj(_)) => x,
        _ => &empty,
    };
    let parts: Vec<&str> = match get(v, "parts") {
        Some(Tree::Arr(a)) => SLICER_PARTS.iter().copied().filter(|x| a.iter().any(|p| s_of(Some(p)) == Some(*x))).collect(),
        _ => SLICER_PARTS.to_vec(),
    };
    let mut out = Map::new();
    if matches!(get(v, "off"), Some(Tree::Bool(true))) {
        out.insert("off".into(), json!(true));
    }
    if parts != SLICER_PARTS {
        out.insert("parts".into(), json!(parts));
    }
    Value::Object(out)
}

/// clean_panel（保存の道〈clean_layout〉と問い合わせの道〈dashboard::query〉の 1 か所。版 3.83.0）
pub fn clean_panel(p: &Tree, i: usize, rows: i64) -> R<Map<String, Value>> {
    if !matches!(p, Tree::Obj(_)) {
        return err("パネルの形が違います。");
    }
    let pid = str_or(get(p, "id"))?;
    let pid_ok = (1..=16).contains(&pid.len()) && pid.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    let pid = if pid_ok { pid } else { format!("p{}", i + 1) };
    let w = int_of(get(p, "w"), 1, GRID_COLS, 4)?;
    let h = int_of(get(p, "h"), 1, rows, 2)?;
    let mut out = Map::new();
    out.insert("id".into(), json!(pid));
    out.insert("x".into(), json!(int_of(get(p, "x"), 0, GRID_COLS - w, 0)?));
    out.insert("y".into(), json!(int_of(get(p, "y"), 0, rows - h, 0)?));
    out.insert("w".into(), json!(w));
    out.insert("h".into(), json!(h));
    let title = stripped(get(p, "title"), 60)?;
    out.insert("title".into(), json!(title));
    let visual = s_of(get(p, "visual")).filter(|v| CHARTS.contains(v) || EXTRA_VISUALS.contains(v)).unwrap_or("column").to_string();
    out.insert("visual".into(), json!(visual));
    let frame = s_of(get(p, "frame")).filter(|f| FRAMES.contains(f)).unwrap_or(if truthy_o(get(p, "emph")) { "emph" } else { "card" });
    out.insert("emph".into(), json!(frame == "emph"));
    if frame != "card" {
        out.insert("frame".into(), json!(frame));
    }
    if let Some(f) = clean_fmt(get(p, "fmt"))? {
        out.insert("fmt".into(), f);
    }
    if matches!(get(p, "noslice"), Some(Tree::Bool(true))) {
        out.insert("noslice".into(), json!(true));
    }
    let what = format!("パネル「{}」", if title.is_empty() { pid.clone() } else { title.clone() });
    if visual == "board" {
        if !truthy_o(get(p, "groups")) || truthy_o(get(p, "legacy")) {
            out.insert("legacy".into(), json!(true));
        }
        out.extend(clean_board(p, &what)?);
        return Ok(out);
    }
    let body = get(p, "body").filter(|b| matches!(b, Tree::Obj(_)));
    let bg = |k: &str| body.and_then(|b| get(b, k));
    // このパネルが使う作った基準の数（版 3.103.0。ダッシュボードの bases の写し）
    let own = clean_own(bg("bases"))?.unwrap_or_default();
    let mut bnames = crate::capacity::names_of(&[]);
    bnames.extend(own.iter().map(|o| o["name"].as_str().unwrap_or("").to_string()));
    let mut ms = vec![];
    for m in arr(bg("measures")).iter().take(MAX_MEASURES) {
        if let Some(x) = measure_with(Some(m), &bnames)? {
            ms.push(Value::Object(x));
        }
    }
    let rows_ = dims(bg("rows"))?;
    out.extend(data(p, &what)?);
    let sub = truthy_o(bg("sub")) && visual == "none" && rows_.len() > 1;
    let grand = match bg("grand") {
        Some(x) => truthy(x),
        None => visual == "none" || visual == "kpi",
    };
    out.insert(
        "body".into(),
        json!({"rows": rows_, "cols": dims(bg("cols"))?, "measures": if ms.is_empty() { json!([{"agg": "lots"}]) } else { json!(ms) },
               "sub": sub, "grand": grand, "chartAt": int_of(bg("chartAt"), 0, 3, 0)?, "labels": bg("labels").is_none_or(truthy)}),
    );
    out.insert("sort".into(), json!(s_of(get(p, "sort")).filter(|s| SORTS.contains(s)).unwrap_or("")));
    out.insert("top".into(), json!(int_of(get(p, "top"), 0, TOP_MAX, 0)?));
    if !own.is_empty() {
        out["body"]["bases"] = json!(own);
    }
    if let Some(e) = clean_egroup(get(p, "egroup"))? {
        out.insert("egroup".into(), e);
    }
    if is_in(get(p, "esplit"), &ESPLITS) {
        out.insert("esplit".into(), json!(s_of(get(p, "esplit")).unwrap()));
    }
    let eo = names(get(p, "eorder"), MAX_EQUIPS)?;
    if !eo.is_empty() {
        out.insert("eorder".into(), json!(eo));
    }
    if OPS_VISUALS.contains(&visual.as_str()) {
        if out["source"] != "work" {
            return err(format!("{what}の稼働・ABC 分析は、作業実績（作業開始と作業終了がある）で使えます。"));
        }
        out.insert("ops".into(), clean_ops(get(p, "ops"))?);
        out["body"]["rows"] = json!([]);
        out["body"]["cols"] = json!([]);
        out.remove("egroup");
        out.remove("esplit");
        return Ok(out);
    }
    if let Some(l) = clean_link(get(p, "link"), &what)? {
        out.insert("link".into(), l);
        return Ok(out);
    }
    if visual != "kpi" && visual != "none" && out["body"]["rows"].as_array().is_none_or(Vec::is_empty) {
        return err(format!("{what}は行の段が要ります（大きな数にするなら「数字」の形を選んでください）。"));
    }
    Ok(out)
}

fn overlaps(a: &Map<String, Value>, b: &Map<String, Value>) -> bool {
    let n = |o: &Map<String, Value>, k: &str| o[k].as_i64().unwrap_or(0);
    n(a, "x") < n(b, "x") + n(b, "w")
        && n(b, "x") < n(a, "x") + n(a, "w")
        && n(a, "y") < n(b, "y") + n(b, "h")
        && n(b, "y") < n(a, "y") + n(a, "h")
}

/// clean_layout: ダッシュボードの中身（表か JSON 字）→ (中身, 置く字)
pub fn clean_layout(body: &Tree) -> R<(Value, String)> {
    let parsed;
    let body = match body {
        Tree::Str(s) => {
            if crate::master_rows::text_split(s) {
                return Err(Stop::Py);
            }
            match Tree::parse(s) {
                Some(t) => {
                    parsed = t;
                    &parsed
                }
                None => return err("中身の形が違います。"),
            }
        }
        b => b,
    };
    if !matches!(body, Tree::Obj(_)) {
        return err("中身の形が違います。");
    }
    let rows = int_of(get(body, "rows"), ROWS_MIN, ROWS_MAX, ROWS_DEFAULT)?;
    let raw = arr(get(body, "panels"));
    if raw.len() > MAX_PANELS {
        return err(format!("パネルは {MAX_PANELS} 枚までです。"));
    }
    let mut panels: Vec<Map<String, Value>> = vec![];
    let mut ids: Vec<String> = vec![];
    for (i, p) in raw.iter().enumerate() {
        let mut x = clean_panel(p, i, rows)?;
        // 付け直す先の名前ももうあれば、次の数へ（Python と一緒に直した。前は同じ名前を作り続けて止まらなかった。版 3.81.0 の採点）
        let mut n = ids.len() + i + 2;
        while ids.iter().any(|id| Some(id.as_str()) == x["id"].as_str()) {
            x.insert("id".into(), json!(format!("p{n}")));
            n += 1;
        }
        ids.push(x["id"].as_str().unwrap_or("").to_string());
        if let Some(hit) = panels.iter().find(|q| overlaps(q, &x)) {
            let name = |o: &Map<String, Value>| {
                let t = o["title"].as_str().unwrap_or("");
                if t.is_empty() {
                    o["id"].as_str().unwrap_or("").to_string()
                } else {
                    t.to_string()
                }
            };
            return err(format!("パネル「{}」と「{}」が重なっています。", name(&x), name(hit)));
        }
        panels.push(x);
    }
    let mut out = json!({"rows": rows, "panels": panels});
    let sc = clean_slicer(get(body, "slicer"));
    if sc.as_object().is_some_and(|m| !m.is_empty()) {
        out["slicer"] = sc;
    }
    if let Some(own) = clean_own(get(body, "bases"))? {
        out["bases"] = json!(own); // 作った基準の数（版 3.103.0。ダッシュボードで共通）
    }
    let rep = str_or(get(body, "replaces"))?;
    if BUILTIN_KEYS.contains(&rep.as_str()) {
        out["replaces"] = json!(s_of(get(body, "replaces")).unwrap_or(&rep)); // 字の "standard" だけが当たる
    }
    let text = crate::join::py_dumps(&out);
    if text.len() > MAX_BYTES {
        return err("ダッシュボードが大きすぎます。");
    }
    Ok((out, text))
}

/// clean_hide_body: 外した組み込みの中身 → ({keys}, 置く字)。Python が道の外の例外で落ちる形は Stop::Py
pub fn clean_hide_body(body: &Tree) -> R<(Value, String)> {
    let parsed;
    let body = match body {
        Tree::Str(s) => {
            if crate::master_rows::text_split(s) {
                return Err(Stop::Py);
            }
            parsed = Tree::parse(s).unwrap_or(Tree::Obj(vec![]));
            &parsed
        }
        b => b,
    };
    // (body or {}).get("keys"): 表でない真の値は AttributeError（Python は落ちる）
    if truthy(body) && !matches!(body, Tree::Obj(_)) {
        return Err(Stop::Py);
    }
    let raw = match get(body, "keys") {
        Some(k) if truthy(k) => k.clone(),
        _ => Tree::Arr(vec![]),
    };
    let items: Vec<String> = match &raw {
        Tree::Arr(a) => a.iter().map(py_str).collect::<R<_>>()?,
        Tree::Str(s) => s.chars().map(|c| c.to_string()).collect(),
        Tree::Obj(m) => m.iter().map(|(k, _)| k.clone()).collect(),
        _ => return Err(Stop::Py), // 数・真は TypeError（並べられない）
    };
    let mut keys: Vec<String> = vec![];
    for k in items {
        if BUILTIN_KEYS.contains(&k.as_str()) && !keys.contains(&k) {
            keys.push(k);
        }
    }
    let out = json!({"keys": keys});
    let text = crate::join::py_dumps(&out);
    Ok((out, text))
}

/// condition_of: 前の版の 1 枚の表の条件（マスタ dashboard_settings の行のうち キー が key の物）。Python が落ちる形は Stop::Py
pub fn condition_of(rows: &[Tree], key: &str) -> R<Value> {
    let mut row = None;
    for r in rows {
        let k = match r {
            Tree::Obj(_) => str_or(get(r, "キー"))?,
            _ => return Err(Stop::Py), // r.get が無い（Python は落ちる）
        };
        if k == key {
            row = Some(r);
            break;
        }
    }
    let text = row.and_then(|r| get(r, "条件"));
    let d = match text {
        Some(t) if truthy(t) => match t {
            Tree::Str(s) => {
                if crate::master_rows::text_split(s) {
                    return Err(Stop::Py);
                }
                Tree::parse(s).unwrap_or(Tree::Obj(vec![]))
            }
            _ => Tree::Obj(vec![]), // json.loads が TypeError（数・並び・表）→ {}
        },
        _ => Tree::Obj(vec![]),
    };
    if !matches!(d, Tree::Obj(_)) {
        return Err(Stop::Py); // d.get が無い（Python は落ちる）
    }
    Ok(json!({"filters": filters(get(&d, "filters"))?, "search": stripped(get(&d, "search"), 200)?}))
}
