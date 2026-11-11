//! ピボット集計（Python の services/pivot.py と同じ答え。版 3.61.0 で移した）。
//!
//! 一覧と同じ絞り込み（検索・条件・列で絞り込む・スライサー）に当たる全件を数える。答えの形・決め方は pivot.py の説明と同じ:
//! 行・列（dims）は最大 3 段（値のまま・日付のまとめ・数の区間・作業日・直・設備・設備グループ）、値（measures）は最大 6 つ
//! （src/aggregate.rs）、小計・総計は段の頭の組すべて、箱ひげ（box）・月で絞る（month）・期間（period）・計算列（calc）・
//! いくつかのファイル（query_many。ダッシュボードの「作業実績 すべての設備」など）・設備で絞る（equips）・設備のまとめ（egroups）・
//! 設備グループの段（sets）。
//! 答えが同じことは desktop/tests/routes_parity.rs（一覧の集計の道）と pivot_parity.rs（いくつかのファイル・期間・設備のまとめ・
//! 計算列・箱ひげ。← program/tests/pivot_oracle.py）が Python の答えと突き合わせて確かめる。

use crate::aggregate::{self, Acc, OutCell, N};
use crate::formula::{self, Calc, CalcColumns, Tables};
use crate::lotlist::{self, connect_ro, json_str, json_truthy, qi, sql_err, Exprs};
use crate::pyfmt::{self, Py};
use crate::worksum::{self, normalize_part, Clock, Own, OUTSIDE};
use chrono::{Datelike, Duration as Days, NaiveDate, NaiveDateTime};
use rusqlite::types::Value as SqlValue;
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

pub const MAX_DIMS: usize = 3;
pub const MAX_MEASURES: usize = 6;
const MAX_ROW_KEYS: usize = 2000;
const MAX_COL_KEYS: usize = 120;
const MAX_ROWS: i64 = 1_000_000;
const DATE_PARTS: &[&str] = &["year", "ym", "date", "month", "weekday", "hour"];
const WORK_DIMS: &[&str] = &["@workday", "@shift"];
pub const EQUIP_DIM: &str = "@equip";
pub const EGROUP_DIM: &str = "@egroup";
pub const PANEL_SET: &str = "@panel";
const NO_GROUP: &str = "グループなし";
const NO_GROUP_KEY: &str = "!none";
const NO_EQUIP: &str = "設備なし";
const OTHER_EQUIP: &str = "その他の設備";
const WORKDAY_PARTS: &[&str] = &["", "ym", "year"];
const WD: [&str; 7] = ["月", "火", "水", "木", "金", "土", "日"];
const BLANK: &str = "（空欄）";
const DATE_RATIO: f64 = 0.8;
const DENS_POINTS: usize = 24;
const DENS_SAMPLE: usize = 2000;
const PERIOD_MAX_DAYS: i64 = 3660;
const PRE_MARGIN: i64 = 2;
const PRE_GLOB: &str = "[0-9][0-9][0-9][0-9][-/.][0-9][0-9][-/.][0-9][0-9]*";

/// 期間の種類と名前（Python の PERIODS と同じ並び）
pub const PERIODS: &[(&str, &str)] = &[
    ("today", "今日"),
    ("yesterday", "前日"),
    ("days", "直近 n 日"),
    ("this_month", "今月"),
    ("last_month", "先月"),
    ("month", "n か月前"),
    ("range", "日付で決める"),
    // 版 3.69.0: 今日を含まない n 日・今月を含む n か月・今年・昨年・今年を含む n 年
    ("days_before", "直近 n 日（今日を含まない）"),
    ("months", "直近 n か月"),
    ("this_year", "今年"),
    ("last_year", "昨年"),
    ("years", "直近 n 年"),
];

/// 数えられなかった理由（Invalid … 組み方の誤り＝400・Down … 読めない＝503。Python の PivotError とほかの例外）
#[derive(Debug, Clone, PartialEq)]
pub enum Fail {
    Invalid(String),
    Down(String),
}

impl Fail {
    pub fn text(&self) -> &str {
        match self {
            Fail::Invalid(s) | Fail::Down(s) => s,
        }
    }
}

type R<T> = Result<T, Fail>;

fn invalid<T>(s: impl Into<String>) -> R<T> {
    Err(Fail::Invalid(s.into()))
}

fn down(e: String) -> Fail {
    Fail::Down(e)
}

/// Python の str(v or "")（JSON の値）
fn py_s(v: Option<&Value>) -> String {
    match v {
        Some(x) if json_truthy(x) => json_str(x),
        _ => String::new(),
    }
}

/// 数に読める JSON の値（Python の work_summary.num。真偽は読まない）
fn num_json(v: Option<&Value>) -> Option<f64> {
    match v {
        None | Some(Value::Bool(_)) => None,
        Some(x) => worksum::num(&Own::of_json(Some(x)).py()),
    }
}

/// 数の鍵の字（Python の _num_text: 1.0 → "1"・0.1+0.2 → "0.3"）
fn num_text(f: f64) -> String {
    let r = aggregate::py_round(f, 10);
    if r == r.trunc() && r.is_finite() {
        if r == 0.0 {
            "0".into()
        } else {
            format!("{r:.0}")
        }
    } else {
        pyfmt::float_repr(r)
    }
}

fn day_label(day: &str) -> String {
    let wd = NaiveDate::parse_from_str(day, "%Y-%m-%d").map(|d| WD[d.weekday().num_days_from_monday() as usize]).unwrap_or("");
    format!("{}/{}/{}({wd})", &day[..4], &day[5..7], &day[8..10])
}

/// date.fromisoformat（Python 3.13: YYYY-MM-DD・YYYYMMDD・週の形）→ 'YYYY-MM-DD'
fn iso_date(s: &str) -> Option<NaiveDate> {
    let b = s.as_bytes();
    let digits = |r: std::ops::Range<usize>| {
        b.get(r.clone()).filter(|x| x.iter().all(u8::is_ascii_digit)).map(|x| std::str::from_utf8(x).unwrap().parse::<u32>().unwrap())
    };
    let ymd = |y: u32, m: u32, d: u32| (y >= 1).then(|| NaiveDate::from_ymd_opt(y as i32, m, d)).flatten();
    let week = |y: u32, w: u32, d: u32| {
        (y >= 1 && (1..=7).contains(&d))
            .then(|| NaiveDate::from_isoywd_opt(y as i32, w, chrono::Weekday::try_from((d - 1) as u8).ok()?))
            .flatten()
    };
    match b.len() {
        10 if b[4] == b'-' && b[7] == b'-' => ymd(digits(0..4)?, digits(5..7)?, digits(8..10)?),
        10 if b[4] == b'-' && b[5] == b'W' && b[8] == b'-' => week(digits(0..4)?, digits(6..8)?, digits(9..10)?),
        8 if b[4] == b'-' && b[5] == b'W' => week(digits(0..4)?, digits(6..8)?, 1),
        8 if b[4] == b'W' => week(digits(0..4)?, digits(5..7)?, digits(7..8)?),
        8 => ymd(digits(0..4)?, digits(4..6)?, digits(6..8)?),
        7 if b[4] == b'W' => week(digits(0..4)?, digits(5..7)?, 1),
        _ => None,
    }
}

fn iso_day(v: Option<&Value>) -> String {
    let s: String = py_s(v).chars().take(10).collect();
    iso_date(&s).map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default()
}

fn ymd(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

// ------------------------------------------------------------------ 段・値
/// 1 つの段
#[derive(Debug, Clone)]
pub struct Dim {
    pub column: String,
    pub part: String,
    width: Option<N>,
    origin: Option<N>,
    auto: bool,
    bin: bool,
}

impl Dim {
    fn plain(column: &str, part: &str) -> Dim {
        Dim { column: column.into(), part: part.into(), width: None, origin: None, auto: false, bin: false }
    }
    fn json(&self) -> Value {
        let mut m = Map::new();
        m.insert("column".into(), json!(self.column));
        m.insert("part".into(), json!(self.part));
        if self.bin {
            m.insert("width".into(), self.width.map(N::json).unwrap_or(Value::Null));
            m.insert("origin".into(), self.origin.map(N::json).unwrap_or(Value::Null));
            if self.auto {
                m.insert("auto".into(), json!(true));
            }
        }
        m.insert("name".into(), json!(dim_name(self)));
        Value::Object(m)
    }
}

fn part_label(p: &str) -> &'static str {
    match p {
        "year" => "年",
        "ym" => "年月",
        "date" => "年月日",
        "month" => "月",
        "weekday" => "曜日",
        "hour" => "時",
        _ => "区間",
    }
}

/// 段の見せる名前（列と区切りから。Python の _dim_name に {column, part} を渡したとき）
pub fn dim_name_of(column: &str, part: &str) -> String {
    dim_name(&Dim::plain(column, part))
}

/// 段の見せる名前（Python の _dim_name）
pub fn dim_name(d: &Dim) -> String {
    match d.column.as_str() {
        EQUIP_DIM => "設備".into(),
        EGROUP_DIM => {
            format!("設備グループ{}", if d.part.is_empty() || d.part == PANEL_SET { String::new() } else { format!("（{}）", d.part) })
        }
        "@workday" => {
            if d.part.is_empty() {
                "作業日".into()
            } else {
                format!("作業日（{}）", part_label(&d.part))
            }
        }
        "@shift" => "直".into(),
        c if d.part.is_empty() => c.into(),
        c => format!("{c}（{}）", part_label(&d.part)),
    }
}

/// 行・列・値の JSON（字か並び）→ 物の並び（Python の _parse_list）
fn parse_list(text: &str, limit: usize, what: &str) -> R<Vec<Map<String, Value>>> {
    if text.is_empty() {
        return Ok(vec![]);
    }
    let v: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return invalid(format!("{what}の形が違います。")),
    };
    let Value::Array(items) = v else { return invalid(format!("{what}の形が違います。")) };
    Ok(items.into_iter().filter_map(|x| if let Value::Object(o) = x { Some(o) } else { None }).take(limit).collect())
}

/// 条件の並び（読めなければ空。Python の _filter_items）
fn filter_items(text: &str) -> Vec<Map<String, Value>> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Array(items)) => items.into_iter().filter_map(|x| if let Value::Object(o) = x { Some(o) } else { None }).collect(),
        _ => vec![],
    }
}

fn clean_dims(text: &str, cs: &[String], work_ok: bool, equip_ok: bool) -> R<Vec<Dim>> {
    let mut out = vec![];
    for d in parse_list(text, MAX_DIMS, "行・列")? {
        let (col, mut part) = (py_s(d.get("column")), py_s(d.get("part")));
        if col == EQUIP_DIM || col == EGROUP_DIM {
            if !equip_ok {
                return invalid("設備・設備グループの段は、設備を見分けられる元（作業実績・設備の列を決めたデータ元）だけで使えます。");
            }
            if col == EGROUP_DIM {
                out.push(Dim::plain(&col, &pyfmt::strip(&part).chars().take(40).collect::<String>()));
                continue;
            }
            part = String::new();
        } else if WORK_DIMS.contains(&col.as_str()) {
            if !work_ok {
                return invalid("作業日・直は作業実績だけで使えます。");
            }
            if !(col == "@workday" && WORKDAY_PARTS.contains(&part.as_str())) {
                part = String::new();
            }
        } else if !cs.contains(&col) {
            return invalid(format!("列「{col}」がありません。"));
        }
        if !(part.is_empty() || DATE_PARTS.contains(&part.as_str()) || part == "bin") {
            part = String::new();
        }
        let mut dim = Dim::plain(&col, &part);
        if part == "bin" {
            dim.bin = true;
            dim.width = Some(N::F(num_json(d.get("width")).unwrap_or(0.0).max(0.0)));
            dim.origin = num_json(d.get("origin")).map(N::F);
        }
        out.push(dim);
    }
    Ok(out)
}

fn clean_measures(text: &str, cs: &[String]) -> R<Vec<Map<String, Value>>> {
    let mut out = vec![];
    for m in parse_list(text, MAX_MEASURES, "値")? {
        out.push(aggregate::clean(&m, &|c| cs.iter().any(|x| x == c)).map_err(Fail::Invalid)?);
    }
    if out.is_empty() {
        out.push(Map::from_iter([("agg".into(), json!("count")), ("column".into(), json!(""))]));
    }
    Ok(out)
}

/// ヒストグラムの区間の幅（Python の nice_width。整数に読めれば整数）
fn nice_width(lo: f64, hi: f64, n: usize) -> N {
    let span = hi - lo;
    if span <= 0.0 {
        return N::F(1.0);
    }
    let k = ((n.max(1) as f64).log2().ceil() as i64 + 1).clamp(5, 40);
    let raw = span / k as f64;
    let p = raw.log10().floor() as i32;
    let e = if p >= 0 { 10f64.powi(p) } else { 10f64.powf(p as f64) };
    let mut best = (f64::INFINITY, 0.0);
    for m in [1.0, 2.0, 2.5, 5.0, 10.0] {
        let x = m * e;
        let d = (x / raw).ln().abs();
        if d < best.0 {
            best = (d, x);
        }
    }
    let w = best.1;
    if w == w.trunc() {
        N::I(w as i64)
    } else {
        N::F(w)
    }
}

/// 数の並び → 傾向の数（Python の describe）
pub fn describe(values: &[f64]) -> Option<Value> {
    let d = Desc::of(values)?;
    Some(d.json())
}

struct Desc {
    n: usize,
    mean: f64,
    sd: f64,
    min: f64,
    q1: f64,
    median: f64,
    q3: f64,
    max: f64,
}

impl Desc {
    fn of(values: &[f64]) -> Option<Desc> {
        let mut xs = values.to_vec();
        xs.sort_by(f64::total_cmp);
        let n = xs.len();
        if n == 0 {
            return None;
        }
        let mean = aggregate::py_sum(xs.iter().copied()) / n as f64;
        let sd = if n > 1 { (aggregate::py_sum(xs.iter().map(|x| (x - mean).powi(2))) / (n - 1) as f64).sqrt() } else { 0.0 };
        let q = |p: f64| aggregate::quantile(&xs, p);
        Some(Desc { n, mean, sd, min: xs[0], q1: q(0.25), median: q(0.5), q3: q(0.75), max: xs[n - 1] })
    }
    fn json(&self) -> Value {
        json!({"n": self.n, "mean": self.mean, "sd": self.sd, "min": self.min, "q1": self.q1, "median": self.median, "q3": self.q3, "max": self.max})
    }
}

/// 分布の形（バイオリン図。Python の density）
fn density(values: &[f64], d: &Desc) -> Value {
    if d.n < 2 || d.max <= d.min {
        return Value::Null;
    }
    let mut xs = values.to_vec();
    xs.sort_by(f64::total_cmp);
    if xs.len() > DENS_SAMPLE {
        let step = xs.len() as f64 / DENS_SAMPLE as f64;
        xs = (0..DENS_SAMPLE).map(|i| xs[(i as f64 * step) as usize]).collect();
    }
    let or = |a: f64, b: f64| if a != 0.0 { a } else { b };
    let spread = or(or(d.sd.min((d.q3 - d.q1) / 1.34), d.sd), (d.max - d.min) / 4.0);
    let h = 0.9 * spread * (xs.len() as f64).powf(-0.2);
    let (lo, hi) = (d.min, d.max);
    let grid: Vec<f64> = (0..DENS_POINTS).map(|i| lo + (hi - lo) * i as f64 / (DENS_POINTS - 1) as f64).collect();
    let ys: Vec<f64> = grid.iter().map(|g| aggregate::py_sum(xs.iter().map(|x| (-0.5 * ((g - x) / h).powi(2)).exp()))).collect();
    let top = or(ys.iter().copied().fold(f64::NEG_INFINITY, f64::max), 1.0);
    json!({"lo": lo, "hi": hi, "d": ys.iter().map(|y| aggregate::py_round(y / top, 4)).collect::<Vec<_>>()})
}

/// 箱ひげの数（Python の box_stats）
fn box_stats(values: &[f64]) -> Option<Value> {
    let d = Desc::of(values)?;
    let iqr = d.q3 - d.q1;
    let (lo_lim, hi_lim) = (d.q1 - 1.5 * iqr, d.q3 + 1.5 * iqr);
    let inside: Vec<f64> = values.iter().copied().filter(|x| lo_lim <= *x && *x <= hi_lim).collect();
    let mut out: Vec<f64> = values.iter().copied().filter(|x| *x < lo_lim || *x > hi_lim).collect();
    out.sort_by(|a, b| (-(a - d.median).abs()).total_cmp(&-(b - d.median).abs()));
    let mut shown: Vec<f64> = out.iter().take(30).copied().collect();
    shown.sort_by(f64::total_cmp);
    let mut v = d.json();
    let m = v.as_object_mut().unwrap();
    m.insert("lo".into(), json!(if inside.is_empty() { d.min } else { inside.iter().copied().fold(f64::INFINITY, f64::min) }));
    m.insert("hi".into(), json!(if inside.is_empty() { d.max } else { inside.iter().copied().fold(f64::NEG_INFINITY, f64::max) }));
    m.insert("out".into(), json!(shown));
    m.insert("outN".into(), json!(out.len()));
    m.insert("dens".into(), density(values, &d));
    Some(v)
}

// ------------------------------------------------------------------ 設備
/// 列の値 → 設備名（Python の data_sources.EquipmentMatcher）
#[derive(Debug, Clone)]
pub struct EquipMatcher {
    prefix: bool,
    names: Vec<(String, String)>,
}

impl EquipMatcher {
    /// names … 設備の名前の並び。mode … 「そのまま」「前方一致」
    pub fn new(names: &[String], mode: &str) -> EquipMatcher {
        let mut sorted: Vec<String> = names.iter().map(|x| pyfmt::strip(x).to_string()).collect();
        sorted.sort_by_key(|x| std::cmp::Reverse(normalize_part(x).chars().count()));
        let mut seen = HashSet::new();
        let mut out = vec![];
        for n in sorted {
            let k = normalize_part(&n);
            if !k.is_empty() && seen.insert(k.clone()) {
                out.push((k, n));
            }
        }
        EquipMatcher { prefix: mode == "前方一致", names: out }
    }
    pub fn name(&self, value: &Py) -> String {
        let v = if *value == Py::None { String::new() } else { pyfmt::strip(&value.py_str()).to_string() };
        if v.is_empty() {
            return v;
        }
        let k = normalize_part(&v);
        if self.prefix {
            return match self.names.iter().find(|(nk, _)| k.starts_with(nk.as_str())) {
                Some((_, n)) => n.clone(),
                None => v.split(pyfmt::is_space).find(|x| !x.is_empty()).unwrap_or("").to_string(),
            };
        }
        self.names.iter().find(|(nk, _)| *nk == k).map(|(_, n)| n.clone()).unwrap_or(v)
    }
}

/// 設備の段の決め方（Python の Part.equip）
#[derive(Debug, Clone)]
pub enum Equip {
    /// ファイルが 1 設備（作業実績）
    Name(String),
    /// 列の値から見分ける（データ元の設備の列）
    Column(String, EquipMatcher),
}

impl Equip {
    fn column(&self) -> &str {
        match self {
            Equip::Name(_) => "",
            Equip::Column(c, _) => c,
        }
    }
}

const RULE_OPS: &[&str] = &["prefix", "suffix", "contains", "equals", "regex"];

pub(crate) enum Rule {
    Prefix(String),
    Suffix(String),
    Contains(String),
    Equals(String),
    Regex(fancy_regex::Regex),
}

/// 設備グループの決まり [{op, value}] → 比べる係（Python の compile_rules）
pub(crate) fn compile_rules(rules: Option<&Value>) -> Vec<Rule> {
    let mut out = vec![];
    for r in rules.and_then(Value::as_array).into_iter().flatten() {
        let (op, v) = (py_s(r.get("op")), pyfmt::strip(&py_s(r.get("value"))).to_string());
        if v.is_empty() || !RULE_OPS.contains(&op.as_str()) {
            continue;
        }
        if op == "regex" {
            let units: Vec<u16> = v.encode_utf16().collect();
            if formula::regex_risk(&units).is_some() {
                continue;
            }
            if let Ok(rx) = fancy_regex::Regex::new(&format!("(?i){v}")) {
                out.push(Rule::Regex(rx));
            }
            continue;
        }
        let nv = normalize_part(&v);
        out.push(match op.as_str() {
            "prefix" => Rule::Prefix(nv),
            "suffix" => Rule::Suffix(nv),
            "contains" => Rule::Contains(nv),
            _ => Rule::Equals(nv),
        });
    }
    out
}

pub(crate) fn rules_hit(rules: &[Rule], k: &str) -> bool {
    rules.iter().any(|r| match r {
        Rule::Prefix(v) => k.starts_with(v.as_str()),
        Rule::Suffix(v) => k.ends_with(v.as_str()),
        Rule::Contains(v) => k.contains(v.as_str()),
        Rule::Equals(v) => k == v,
        Rule::Regex(rx) => rx.is_match(k).unwrap_or(false),
    })
}

/// 設備のまとめ（Python の EquipGroups）
pub struct EquipGroups {
    rest: String,
    other: String,
    names: Vec<String>,
    map: HashMap<String, String>,
    rules: Vec<(String, Vec<Rule>, HashSet<String>)>,
    memo: std::cell::RefCell<HashMap<String, Option<String>>>,
}

impl EquipGroups {
    pub fn new(groups: Option<&Value>, rest: &str, other: &str) -> EquipGroups {
        let mut g = EquipGroups {
            rest: if ["keep", "other", "hide"].contains(&rest) { rest.into() } else { "keep".into() },
            other: if pyfmt::strip(other).is_empty() { OTHER_EQUIP.into() } else { pyfmt::strip(other).into() },
            names: vec![],
            map: HashMap::new(),
            rules: vec![],
            memo: Default::default(),
        };
        for x in groups.and_then(Value::as_array).into_iter().flatten() {
            let n = pyfmt::strip(&py_s(x.get("name"))).to_string();
            if n.is_empty() {
                continue;
            }
            if !g.names.contains(&n) {
                g.names.push(n.clone());
            }
            for m in x.get("members").and_then(Value::as_array).into_iter().flatten() {
                g.map.entry(normalize_part(&py_s(Some(m)))).or_insert_with(|| n.clone());
            }
            if x.get("rules").is_some_and(json_truthy) {
                let ex = x.get("except").and_then(Value::as_array).into_iter().flatten().map(|e| normalize_part(&py_s(Some(e)))).collect();
                g.rules.push((n.clone(), compile_rules(x.get("rules")), ex));
            }
        }
        g
    }
    fn on(&self) -> bool {
        !self.names.is_empty()
    }
    fn group_of(&self, name: &str) -> Option<String> {
        let k = normalize_part(name);
        if let Some(hit) = self.memo.borrow().get(&k) {
            return hit.clone();
        }
        let g = self
            .map
            .get(&k)
            .cloned()
            .or_else(|| self.rules.iter().find(|(_, t, ex)| !ex.contains(&k) && rules_hit(t, &k)).map(|(n, _, _)| n.clone()));
        self.memo.borrow_mut().insert(k, g.clone());
        g
    }
    /// 設備名 → (まとまりの名前, 並び〈入らない設備は -1〉)
    fn place(&self, name: &str) -> (String, i64) {
        if let Some(g) = self.group_of(name) {
            let at = self.names.iter().position(|n| *n == g).unwrap_or(0) as i64;
            return (g, at);
        }
        if self.rest == "other" {
            return (self.other.clone(), self.names.iter().position(|n| *n == self.other).unwrap_or(self.names.len()) as i64);
        }
        (name.into(), -1)
    }
    fn keeps(&self, name: &str) -> bool {
        self.rest != "hide" || self.group_of(name).is_some()
    }
}

// ------------------------------------------------------------------ 段の鍵
/// 並べる鍵の 1 つ（Python の tuple の要素: 数か字）
#[derive(Debug, Clone, PartialEq)]
enum Sk {
    N(f64),
    S(String),
}

fn sk_cmp(a: &[Sk], b: &[Sk]) -> std::cmp::Ordering {
    use std::cmp::Ordering::*;
    for (x, y) in a.iter().zip(b) {
        let o = match (x, y) {
            (Sk::N(p), Sk::N(q)) => p.partial_cmp(q).unwrap_or(Equal),
            (Sk::S(p), Sk::S(q)) => p.cmp(q),
            (Sk::N(_), Sk::S(_)) => Less,
            (Sk::S(_), Sk::N(_)) => Greater,
        };
        if o != Equal {
            return o;
        }
    }
    a.len().cmp(&b.len())
}

fn n(x: impl Into<f64>) -> Sk {
    Sk::N(x.into())
}
fn s(x: impl Into<String>) -> Sk {
    Sk::S(x.into())
}

type KeyOut = (String, Vec<Sk>, String);

/// 値を覚える鍵（Python の dict の鍵: 1 と 1.0 は同じ）
#[derive(Hash, PartialEq, Eq, Clone)]
enum Mk {
    Null,
    Num(u64),
    Text(String),
    Blob(Vec<u8>),
}

fn mk(v: &Own) -> Mk {
    let f = |x: f64| Mk::Num(if x == 0.0 { 0f64.to_bits() } else { x.to_bits() });
    match v {
        Own::None => Mk::Null,
        Own::Int(i) => f(*i as f64),
        Own::Float(x) => f(*x),
        Own::Text(t) => Mk::Text(t.clone()),
        Own::Blob(b) => Mk::Blob(b.clone()),
    }
}

/// 1 つの段の鍵の作り方（Python の _Keyer）。鍵は段ごとの通し番号（Ids）にして覚える
struct Keyer<'a> {
    dim: &'a Dim,
    clock: Option<&'a Clock>,
    basis: &'a str,
    equip: Option<&'a Equip>,
    order: usize,
    by_name: bool,
    groups: Option<&'a EquipGroups>,
    sets: &'a HashMap<String, EquipGroups>,
    memo: HashMap<(Mk, Mk), usize>,
}

/// 段ごとの鍵の通し番号（鍵の字・並べる鍵・見せる字は初めて出たもの）
#[derive(Default)]
struct Ids {
    at: HashMap<String, usize>,
    keys: Vec<KeyOut>,
}

impl Ids {
    fn id(&mut self, k: KeyOut) -> usize {
        if let Some(&i) = self.at.get(&k.0) {
            return i;
        }
        self.at.insert(k.0.clone(), self.keys.len());
        self.keys.push(k);
        self.keys.len() - 1
    }
}

impl<'a> Keyer<'a> {
    #[allow(clippy::too_many_arguments)]
    fn new(
        dim: &'a Dim,
        clock: Option<&'a Clock>,
        basis: &'a str,
        equip: Option<&'a Equip>,
        order: usize,
        by_name: bool,
        groups: Option<&'a EquipGroups>,
        sets: &'a HashMap<String, EquipGroups>,
    ) -> Keyer<'a> {
        Keyer { dim, clock, basis, equip, order, by_name, groups, sets, memo: HashMap::new() }
    }

    fn key(&mut self, v: &Own, tv: &Own, ids: &mut Ids, places: &mut HashMap<(Mk, Mk), (String, i64)>) -> usize {
        let work = WORK_DIMS.contains(&self.dim.column.as_str());
        let mkey = (mk(v), if work { mk(tv) } else { Mk::Null });
        if let Some(&i) = self.memo.get(&mkey) {
            return i;
        }
        let out = self.make(v, tv, places);
        let i = ids.id(out);
        self.memo.insert(mkey, i);
        i
    }

    fn equip_name(&self, v: &Own) -> String {
        match self.equip {
            Some(Equip::Name(n)) => n.clone(),
            Some(Equip::Column(_, m)) => m.name(&v.py()),
            None => {
                let p = v.py();
                if p.truthy() {
                    pyfmt::strip(&p.py_str()).to_string()
                } else {
                    String::new()
                }
            }
        }
    }

    fn make(&self, v: &Own, tv: &Own, places: &mut HashMap<(Mk, Mk), (String, i64)>) -> KeyOut {
        let (col, part) = (self.dim.column.as_str(), self.dim.part.as_str());
        if col == EGROUP_DIM {
            let name = self.equip_name(v);
            let grp = self.sets.get(part).filter(|g| g.on());
            let (g, at) = match grp {
                Some(g) if !name.is_empty() => g.place(&name),
                _ => (String::new(), -1),
            };
            if at < 0 {
                return (NO_GROUP_KEY.into(), vec![n(1), n(0), s("")], NO_GROUP.into());
            }
            return (g.clone(), vec![n(0), n(at as f64), s(g.clone())], g);
        }
        if col == EQUIP_DIM {
            let name = self.equip_name(v);
            if name.is_empty() {
                return (String::new(), vec![n(1), n(0), s("")], NO_EQUIP.into());
            }
            let ord = if matches!(self.equip, Some(Equip::Name(_))) { self.order } else { 0 } as f64;
            if let Some(gr) = self.groups.filter(|g| g.on()) {
                let (g, at) = gr.place(&name);
                let o = if at >= 0 { at as f64 } else { 10_000.0 + ord };
                return (g.clone(), vec![n(0), n(o), s(g.clone())], g);
            }
            return (name.clone(), vec![n(0), n(ord), s(name.clone())], name);
        }
        if WORK_DIMS.contains(&col) {
            let pk = (mk(v), mk(tv));
            let (day, idx) = match places.get(&pk) {
                Some(x) => x.clone(),
                None => {
                    let stamp = pyfmt::to_datetime(&v.py(), &tv.py()).unwrap_or_default();
                    let got = self.clock.map(|c| c.place(&stamp, self.basis)).unwrap_or((String::new(), worksum::NO_TIME));
                    places.insert(pk, got.clone());
                    got
                }
            };
            if col == "@workday" {
                if day.is_empty() {
                    return (String::new(), vec![n(1), s("")], "日付なし".into());
                }
                return match part {
                    "ym" => (day[..7].into(), vec![n(0), s(&day[..7])], format!("{}/{}", &day[..4], &day[5..7])),
                    "year" => (day[..4].into(), vec![n(0), s(&day[..4])], format!("{}年", &day[..4])),
                    _ => (day.clone(), vec![n(0), s(day.clone())], day_label(&day)),
                };
            }
            let name = if idx >= 0 {
                self.clock.and_then(|c| c.segments.get(idx as usize)).map(|g| g.name.clone()).unwrap_or_default()
            } else if idx == OUTSIDE {
                "直の外".into()
            } else {
                "時刻なし".into()
            };
            let sk = if idx >= 0 { vec![n(0), n(idx as f64), s(name.clone())] } else { vec![n(1), n(-idx as f64), s(name.clone())] };
            let key = if self.by_name && idx >= 0 { name.clone() } else { idx.to_string() };
            return (key, sk, name);
        }
        if part.is_empty() {
            return match lotlist::sort_key(&v.py()) {
                SqlValue::Null => (String::new(), vec![n(2), n(0), s("")], BLANK.into()),
                SqlValue::Integer(i) => {
                    let t = num_text(i as f64);
                    (format!("#{t}"), vec![n(0), n(i as f64), s("")], t)
                }
                SqlValue::Real(f) => {
                    let t = num_text(f);
                    (format!("#{t}"), vec![n(0), n(f), s("")], t)
                }
                SqlValue::Text(k) => (format!("${k}"), vec![n(1), n(0), s(k.clone())], k),
                SqlValue::Blob(_) => (String::new(), vec![n(2), n(0), s("")], BLANK.into()),
            };
        }
        if part == "bin" {
            let Some(f) = worksum::num(&v.py()) else { return (String::new(), vec![n(1), n(0)], BLANK.into()) };
            let (w, o) = (self.dim.width.unwrap_or(N::F(1.0)), self.dim.origin.unwrap_or(N::F(0.0)));
            let k = ((f - o.f()) / w.f() + 1e-9).floor();
            let st = o.f() + k * w.f();
            return (num_text(st), vec![n(0), n(st)], format!("{}〜{}", num_text(st), num_text(st + w.f())));
        }
        let Some(stamp) = pyfmt::to_datetime(&v.py(), &Py::None) else { return (String::new(), vec![n(1), s("")], BLANK.into()) };
        let d = NaiveDate::parse_from_str(&stamp[..10], "%Y-%m-%d").ok();
        match part {
            "year" => (stamp[..4].into(), vec![n(0), s(&stamp[..4])], format!("{}年", &stamp[..4])),
            "ym" => (stamp[..7].into(), vec![n(0), s(&stamp[..7])], format!("{}/{}", &stamp[..4], &stamp[5..7])),
            "date" => (stamp[..10].into(), vec![n(0), s(&stamp[..10])], day_label(&stamp[..10])),
            "month" => (stamp[5..7].into(), vec![n(0), s(&stamp[5..7])], format!("{}月", stamp[5..7].parse::<u32>().unwrap_or(0))),
            "weekday" => {
                let w = d.map(|d| d.weekday().num_days_from_monday()).unwrap_or(0);
                (w.to_string(), vec![n(0), n(w)], WD[w as usize].into())
            }
            "hour" if stamp.len() < 13 => (String::new(), vec![n(1), s("")], "時刻なし".into()),
            "hour" => (stamp[11..13].into(), vec![n(0), s(&stamp[11..13])], format!("{}時", stamp[11..13].parse::<u32>().unwrap_or(0))),
            _ => (String::new(), vec![n(1), s("")], BLANK.into()),
        }
    }
}

fn is_day(d: &Dim) -> bool {
    (d.column == "@workday" && d.part.is_empty()) || (d.column != "@workday" && d.part == "date")
}

/// 月で絞れる段の番号（Python の day_dim）。無ければ None
fn day_dim(dims: &[Dim]) -> Option<usize> {
    if dims.first().is_some_and(is_day) {
        return Some(0);
    }
    if dims.len() > 1 && dims[0].part == "ym" && dims[1].column == dims[0].column && is_day(&dims[1]) {
        return Some(1);
    }
    None
}

// ------------------------------------------------------------------ 期間
/// 確かめた期間（Python の clean_period）
#[derive(Debug, Clone)]
pub struct Period {
    pub column: String,
    pub kind: String,
    pub n: i64,
    from: Option<String>,
    to: Option<String>,
}

impl Period {
    fn json(&self) -> Map<String, Value> {
        let mut m = Map::new();
        m.insert("column".into(), json!(self.column));
        m.insert("kind".into(), json!(self.kind));
        m.insert("n".into(), json!(self.n));
        if let (Some(f), Some(t)) = (&self.from, &self.to) {
            m.insert("from".into(), json!(f));
            m.insert("to".into(), json!(t));
        }
        m
    }
}

/// Python の int(v or 7)（読めなければ 7）
fn py_int_or(v: Option<&Value>, d: i64) -> i64 {
    match v {
        Some(x) if json_truthy(x) => match x {
            Value::Bool(b) => *b as i64,
            Value::Number(k) => k.as_i64().unwrap_or_else(|| k.as_f64().map(|f| f.trunc() as i64).unwrap_or(d)),
            Value::String(t) => pyfmt::py_int(t).unwrap_or(d),
            _ => d,
        },
        _ => d,
    }
}

pub fn clean_period(p: Option<&Value>) -> R<Option<Period>> {
    let Some(Value::Object(p)) = p else { return Ok(None) };
    if !p.get("kind").is_some_and(json_truthy) {
        return Ok(None);
    }
    let (kind, col) = (py_s(p.get("kind")), py_s(p.get("column")));
    if !PERIODS.iter().any(|(k, _)| *k == kind) {
        return invalid("期間の種類が違います。");
    }
    if col.is_empty() {
        return invalid("期間で絞る日付の列を選んでください。");
    }
    let n = py_int_or(p.get("n"), 7);
    let (from, to) = if kind == "range" { (Some(iso_day(p.get("from"))), Some(iso_day(p.get("to")))) } else { (None, None) };
    Ok(Some(Period { column: col, kind, n, from, to }))
}

/// 期間の種類 → (はじめ, おわり)（Python の period_range）
pub fn period_range(p: &Period, today: &str) -> R<(String, String)> {
    if p.kind == "range" {
        let (f, t) = (p.from.clone().unwrap_or_default(), p.to.clone().unwrap_or_default());
        let a = if f.is_empty() { t.clone() } else { f.clone() };
        let b = if t.is_empty() { f } else { t };
        if a.is_empty() {
            return invalid("期間の日付（から・まで）を入れてください。");
        }
        return Ok(if a <= b { (a, b) } else { (b, a) });
    }
    let Some(d) = iso_date(today) else { return Err(Fail::Down(format!("Invalid isoformat string: {}", pyfmt::str_repr(today)))) };
    let one = |x: NaiveDate| (ymd(x), ymd(x));
    Ok(match p.kind.as_str() {
        "today" => one(d),
        "yesterday" => one(d - Days::days(1)),
        "days" => {
            let k = (if p.n == 0 { 7 } else { p.n }).clamp(1, PERIOD_MAX_DAYS);
            (ymd(d - Days::days(k - 1)), ymd(d))
        }
        "days_before" => {
            let k = (if p.n == 0 { 7 } else { p.n }).clamp(1, PERIOD_MAX_DAYS);
            (ymd(d - Days::days(k)), ymd(d - Days::days(1)))
        }
        "months" => {
            let back = (if p.n == 0 { 3 } else { p.n }).clamp(1, 120) - 1;
            let t = d.year() as i64 * 12 + d.month() as i64 - 1 - back;
            (ymd(NaiveDate::from_ymd_opt(t.div_euclid(12) as i32, t.rem_euclid(12) as u32 + 1, 1).unwrap()), ymd(d))
        }
        "this_year" => (ymd(NaiveDate::from_ymd_opt(d.year(), 1, 1).unwrap()), ymd(d)),
        "last_year" => {
            (ymd(NaiveDate::from_ymd_opt(d.year() - 1, 1, 1).unwrap()), ymd(NaiveDate::from_ymd_opt(d.year() - 1, 12, 31).unwrap()))
        }
        "years" => {
            let back = (if p.n == 0 { 3 } else { p.n }).clamp(1, 10) - 1;
            (ymd(NaiveDate::from_ymd_opt(d.year() - back as i32, 1, 1).unwrap()), ymd(d))
        }
        "this_month" => (ymd(d.with_day(1).unwrap()), ymd(d)),
        "last_month" => {
            let last = d.with_day(1).unwrap() - Days::days(1);
            (ymd(last.with_day(1).unwrap()), ymd(last))
        }
        "month" => {
            let back = (if p.n == 0 { 1 } else { p.n }).clamp(1, 120);
            let t = d.year() as i64 * 12 + d.month() as i64 - 1 - back;
            let (y, m) = (t.div_euclid(12), t.rem_euclid(12));
            let first = NaiveDate::from_ymd_opt(y as i32, m as u32 + 1, 1).unwrap();
            let next = NaiveDate::from_ymd_opt((y + (m + 1) / 12) as i32, ((m + 1) % 12) as u32 + 1, 1).unwrap();
            (ymd(first), ymd(next - Days::days(1)))
        }
        _ => return invalid("期間の種類が違います。"),
    })
}

/// 期間の先絞り（稼働の operation.rs も使う）
pub(crate) fn period_prefilter_pub(col: &str, span: Option<&(String, String)>) -> Option<(String, Vec<SqlValue>)> {
    period_prefilter(col, span)
}

/// 計算列を接続に登録する → (名前 → SQL の式, 計算列の並び, 読めない計算列)（稼働の operation.rs も使う）
pub(crate) fn calc_exprs_pub(
    c: &rusqlite::Connection,
    calc: Option<&Calc>,
    cs: &[String],
    conv: &Arc<Tables>,
) -> R<(Exprs, Vec<String>, Vec<String>)> {
    calc_exprs(c, calc, cs, conv).map(|(e, o, b, _)| (e, o, b))
}

/// 千の位の区切り（稼働の operation.rs も使う）
pub(crate) fn commas_pub(n: i64) -> String {
    commas(n)
}

/// 期間の先絞り（Python の period_prefilter）
fn period_prefilter(col: &str, span: Option<&(String, String)>) -> Option<(String, Vec<SqlValue>)> {
    let (lo, hi) = span?;
    let at = |x: &str, k: i64| NaiveDate::parse_from_str(x, "%Y-%m-%d").map(|d| ymd(d + Days::days(k))).unwrap_or_default();
    let t = format!("CAST({} AS TEXT)", qi(col));
    Some((
        format!(
            "({q} IS NULL OR NOT ({t} GLOB '{PRE_GLOB}') OR (substr({t}, 1, 4) || '-' || substr({t}, 6, 2) || '-' || substr({t}, 9, 2)) BETWEEN ? AND ?)",
            q = qi(col)
        ),
        vec![SqlValue::Text(at(lo, -PRE_MARGIN)), SqlValue::Text(at(hi, PRE_MARGIN))],
    ))
}

// ------------------------------------------------------------------ 数える
/// 作業実績のとき（作業日・直・ロット数の決め方）
#[derive(Debug, Clone)]
pub struct Work {
    pub clock: Clock,
    pub basis: String,
    pub start: String,
}

/// 数える 1 つのファイル（Python の Part）
#[derive(Debug, Clone)]
pub struct Part {
    pub path: PathBuf,
    pub table: String,
    pub preferred_table: String,
    pub candidates: &'static [&'static str],
    pub work: Option<Work>,
    pub equip: Option<Equip>,
    pub name: String,
    pub lot_col: Option<String>,
}

/// 問い合わせ（Python の query_many の引数。rows・cols・measures・filters は JSON の字）
pub struct Ask<'a> {
    pub search: &'a str,
    pub filters: &'a str,
    pub rows: &'a str,
    pub cols: &'a str,
    pub measures: &'a str,
    pub today: NaiveDate,
    pub month: &'a str,
    pub box_col: &'a str,
    pub period: Option<&'a Value>,
    pub now: NaiveDateTime,
    pub calc: Option<&'a Calc>,
    pub conv: &'a Arc<Tables>,
    pub equips: &'a [String],
    pub egroups: Option<&'a Value>,
    pub sets: Option<&'a Value>,
}

struct State {
    name: String,
    table: String,
    dims: Vec<Dim>,
    nr: usize,
    ms: Vec<Map<String, Value>>,
    pos: Vec<(i64, i64)>,
    mpos: Vec<i64>,
    bpos: i64,
    lots_by: &'static str,
    kpos: (i64, i64),
    ppos: (i64, i64),
    start: String,
    data: Vec<Vec<Own>>,
    clock: Option<Clock>,
    basis: String,
    equip: Option<Equip>,
    epos: i64,
    ignored: Vec<String>,
    places: HashMap<(Mk, Mk), (String, i64)>,
}

/// 計算列の名前 → SQL の式・計算列の並び（読めない物も）・読めない計算列・係
type CalcExprs = (Exprs, Vec<String>, Vec<String>, Option<CalcColumns>);

/// 計算列を接続に登録する → (計算列の名前 → SQL の式, 計算列の並び〈読めない物も〉, 読めない計算列, 係)
fn calc_exprs(c: &rusqlite::Connection, calc: Option<&Calc>, cs: &[String], conv: &Arc<Tables>) -> R<CalcExprs> {
    let Some(calc) = calc else { return Ok((Exprs::new(), vec![], vec![], None)) };
    let exprs = formula::register(c, calc, cs, conv, qi).map_err(|e| down(sql_err(e)))?;
    let cc = CalcColumns::new(calc, cs);
    let broken = cc.calcs.iter().filter(|x| cc.broken(x)).cloned().collect();
    let order = cc.calcs.clone();
    Ok((exprs, order, broken, Some(cc)))
}

fn open_part(part: &Part, a: &Ask, period: Option<&Period>, need_equip: bool, span: Option<&(String, String)>) -> R<State> {
    let work = part.work.as_ref();
    let c = connect_ro(&part.path).map_err(down)?;
    let names = lotlist::tables(&c).map_err(down)?;
    let t =
        if names.contains(&part.table) { part.table.clone() } else { lotlist::pick_table(&names, &part.preferred_table, part.candidates) };
    if t.is_empty() {
        return Err(down("表が 1 つもありません。".into()));
    }
    let raw_cs = lotlist::dedup(&lotlist::raw_columns(&c, &t).map_err(down)?);
    let mine = a.calc.and_then(|x| x.for_part(&part.name)); // その設備の式（版 3.74.0）
    let (exprs, calcs, broken, _) = calc_exprs(&c, mine.as_ref(), &raw_cs, a.conv)?;
    let used: HashSet<String> = filter_items(a.rows)
        .iter()
        .chain(filter_items(a.cols).iter())
        .chain(filter_items(a.measures).iter())
        .map(|d| py_s(d.get("column")))
        .collect();
    let mut bad: Vec<&String> = broken.iter().filter(|b| used.contains(*b)).collect();
    bad.sort();
    if !bad.is_empty() {
        return invalid(format!(
            "計算列「{}」の式が読めません（一覧の「表示列」で式を直してください）。",
            bad.iter().map(|x| x.as_str()).collect::<Vec<_>>().join("」「")
        ));
    }
    let mut cs = raw_cs.clone();
    cs.extend(calcs.iter().filter(|x| exprs.contains_key(*x) && !raw_cs.contains(x)).cloned());
    let start = work.map(|w| worksum::start_column(&cs, &w.start)).unwrap_or_default();
    let tcol = if start.is_empty() { String::new() } else { worksum::time_column(&cs, &start) };
    let equip = part.equip.clone().filter(|e| e.column().is_empty() || cs.iter().any(|x| x == e.column()));
    let rd = clean_dims(a.rows, &cs, !start.is_empty(), equip.is_some())?;
    let cd = clean_dims(a.cols, &cs, !start.is_empty(), equip.is_some())?;
    let ms = clean_measures(a.measures, &cs)?;
    if !a.box_col.is_empty() && !cs.iter().any(|x| x == a.box_col) {
        return invalid(format!("箱ひげの列「{}」がありません。", a.box_col));
    }
    if let Some(p) = period {
        if p.column != "@workday" && !cs.contains(&p.column) {
            return invalid(format!("期間で絞る列「{}」がありません。", p.column));
        }
        if p.column == "@workday" && start.is_empty() {
            return invalid("作業日の期間は作業実績だけで使えます。");
        }
    }
    let ignored: Vec<String> = filter_items(a.filters)
        .iter()
        .filter(|f| f.get("op").and_then(Value::as_str) != Some("tuple_in"))
        .map(|f| py_s(f.get("column")))
        .filter(|col| !col.is_empty() && !cs.contains(col))
        .collect();
    let (mut where_parts, mut params) =
        lotlist::search_filter_where(&c, &t, &raw_cs, a.search, a.filters, a.today, &exprs).map_err(down)?;
    let pcol = period.map(|p| if p.column == "@workday" { start.clone() } else { p.column.clone() }).unwrap_or_default();
    if !pcol.is_empty() && raw_cs.contains(&pcol) {
        if let Some((w, wp)) = period_prefilter(&pcol, span) {
            where_parts.push(w);
            params.extend(wp);
        }
    }
    let wh = if where_parts.is_empty() { String::new() } else { format!(" WHERE {}", where_parts.join(" AND ")) };
    let lot = lotlist::lot_column(&cs, part.lot_col.as_deref());
    let mut need: Vec<String> = vec![];
    let mut use_col = |col: &str| -> i64 {
        if col.is_empty() {
            return -1;
        }
        if let Some(i) = need.iter().position(|x| x == col) {
            return i as i64;
        }
        need.push(col.into());
        need.len() as i64 - 1
    };
    let epos = match &equip {
        Some(e) if need_equip => use_col(e.column()),
        _ => -1,
    };
    let dims: Vec<Dim> = rd.iter().chain(cd.iter()).cloned().collect();
    let mut pos = vec![];
    for d in &dims {
        if WORK_DIMS.contains(&d.column.as_str()) {
            pos.push((use_col(&start), use_col(&tcol)));
        } else if d.column == EQUIP_DIM || d.column == EGROUP_DIM {
            pos.push((use_col(equip.as_ref().map(|e| e.column()).unwrap_or("")), -1));
        } else {
            pos.push((use_col(&d.column), -1));
        }
    }
    let mpos: Vec<i64> = ms.iter().map(|m| use_col(m["column"].as_str().unwrap_or(""))).collect();
    let bpos = use_col(a.box_col);
    let lots_by = if !start.is_empty() {
        "work"
    } else if !lot.is_empty() {
        "lot"
    } else {
        ""
    };
    let kpos = match lots_by {
        "work" => (use_col(&start), use_col(&tcol)),
        "lot" => (use_col(&lot), -1),
        _ => (-1, -1),
    };
    let ppos = match period {
        Some(p) if p.column == "@workday" => (use_col(&start), use_col(&tcol)),
        Some(p) => (use_col(&p.column), -1),
        None => (-1, -1),
    };
    let total: i64 = c
        .query_row(&format!("SELECT COUNT(*) FROM {}{wh}", qi(&t)), rusqlite::params_from_iter(params.iter()), |r| r.get(0))
        .map_err(|e| down(sql_err(e)))?;
    if total > MAX_ROWS {
        return invalid(format!(
            "当たる行が多すぎます（{} 行。{} 行まで）。条件で絞ってから集計してください。",
            commas(total),
            commas(MAX_ROWS)
        ));
    }
    let data = if need.is_empty() {
        vec![vec![]; total as usize]
    } else {
        let sel = need.iter().map(|x| exprs.get(x).cloned().unwrap_or_else(|| qi(x))).collect::<Vec<_>>().join(", ");
        let mut st = c.prepare(&format!("SELECT {sel} FROM {}{wh}", qi(&t))).map_err(|e| down(sql_err(e)))?;
        let mut rows = st.query(rusqlite::params_from_iter(params.iter())).map_err(|e| down(sql_err(e)))?;
        let mut out = vec![];
        while let Some(r) = rows.next().map_err(|e| down(sql_err(e)))? {
            out.push((0..need.len()).map(|i| r.get_ref(i).map(Own::of_ref).unwrap_or(Own::None)).collect());
        }
        out
    };
    Ok(State {
        name: part.name.clone(),
        table: t,
        nr: rd.len(),
        dims,
        ms,
        pos,
        mpos,
        bpos,
        lots_by,
        kpos,
        ppos,
        start,
        data,
        clock: work.map(|w| w.clock.clone()),
        basis: work.map(|w| w.basis.clone()).unwrap_or_else(|| "work".into()),
        equip,
        epos,
        ignored,
        places: HashMap::new(),
    })
}

pub(crate) fn commas(n: i64) -> String {
    let t = n.abs().to_string();
    let mut out = String::new();
    for (i, ch) in t.chars().enumerate() {
        if i > 0 && (t.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    if n < 0 {
        format!("-{out}")
    } else {
        out
    }
}

fn part_today(st_clock: Option<&Clock>, basis: &str, period: &Period, now: NaiveDateTime) -> String {
    let stamp = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let day = match (period.column.as_str(), st_clock) {
        ("@workday", Some(c)) => c.place(&stamp, basis).0,
        _ => String::new(),
    };
    if day.is_empty() {
        ymd(now.date())
    } else {
        day
    }
}

fn get(row: &[Own], i: i64) -> &Own {
    static NONE: Own = Own::None;
    if i >= 0 {
        &row[i as usize]
    } else {
        &NONE
    }
}

struct Acc3 {
    count: i64,
    /// ロットの鍵の番号の集まり（同じファイルの同じ鍵は同じ番号・鍵が空の行は 1 行ずつ別の番号）
    lots: HashSet<u64>,
    accs: Vec<Acc>,
}

/// 1 つのファイル（Python の query）
pub fn query(part: Part, a: &Ask) -> R<Value> {
    query_many(vec![part], a)
}

/// いくつかのファイルを 1 つの集計にまとめる（Python の query_many と同じ答え）
pub fn query_many(parts: Vec<Part>, a: &Ask) -> R<Value> {
    let t0 = Instant::now();
    let period = clean_period(a.period)?;
    let multi = parts.len() > 1;
    let pick: HashSet<String> = a.equips.iter().filter(|x| !pyfmt::strip(x).is_empty()).map(|x| normalize_part(x)).collect();
    let groups =
        a.egroups.filter(|g| json_truthy(g)).map(|g| EquipGroups::new(g.get("groups"), &py_s(g.get("rest")), &py_s(g.get("other"))));
    let gsets: HashMap<String, EquipGroups> = a
        .sets
        .and_then(Value::as_object)
        .map(|m| m.iter().map(|(k, v)| (k.clone(), EquipGroups::new(Some(v), "keep", ""))).collect())
        .unwrap_or_default();
    let need_equip = !pick.is_empty() || groups.as_ref().is_some_and(|g| g.on() && g.rest == "hide");
    let mut states: Vec<State> = vec![];
    let mut skipped: Vec<Value> = vec![];
    let total = parts.len();
    for (i, part) in parts.iter().enumerate() {
        crate::progress::step("read", i, total); // 読み終えたファイル i / total（版 3.97.0）
        let got = (|| {
            let span = match &period {
                Some(p) => Some(period_range(
                    p,
                    &part_today(
                        part.work.as_ref().map(|w| &w.clock),
                        part.work.as_ref().map(|w| w.basis.as_str()).unwrap_or("work"),
                        p,
                        a.now,
                    ),
                )?),
                None => None,
            };
            open_part(part, a, period.as_ref(), need_equip, span.as_ref())
        })();
        match got {
            Ok(s) => states.push(s),
            Err(e) if multi => skipped.push(json!({"name": part.name, "error": e.text()})),
            Err(e) => return Err(e),
        }
    }
    if states.is_empty() {
        let tail: String = skipped
            .iter()
            .take(3)
            .map(|x| format!(" {}: {}", x["name"].as_str().unwrap_or(""), x["error"].as_str().unwrap_or("")))
            .collect();
        return invalid(format!("数えられるファイルがありません。{tail}"));
    }
    crate::progress::step("count", 0, 0);
    let mut dims = states[0].dims.clone();
    let (nr, nc) = (states[0].nr, dims.len() - states[0].nr);
    let ms = states[0].ms.clone();
    let groups_on = groups.as_ref().filter(|g| g.on());
    // 設備で絞る（選んだ設備・まとめで数えない設備）。設備を見分けられない元は絞れない（知らせる）
    let mut equip_ignored = false;
    if need_equip {
        for st in states.iter_mut() {
            let Some(eq) = st.equip.clone() else {
                equip_ignored = true;
                continue;
            };
            let dim = Dim::plain(EQUIP_DIM, "");
            let none = HashMap::new();
            let mut ek = Keyer::new(&dim, None, "work", Some(&eq), 0, false, None, &none);
            let mut ids = Ids::default();
            let mut places = HashMap::new();
            let epos = st.epos;
            st.data.retain(|r| {
                let i = ek.key(get(r, epos), &Own::None, &mut ids, &mut places);
                let name = &ids.keys[i].2;
                (pick.is_empty() || pick.contains(&normalize_part(name))) && groups_on.is_none_or(|g| g.keeps(name))
            });
        }
    }
    // 期間で絞る
    let mut ranges: Vec<(String, String)> = vec![];
    if let Some(p) = &period {
        let pdim = Dim::plain(&p.column, if p.column == "@workday" { "" } else { "date" });
        let none = HashMap::new();
        for st in states.iter_mut() {
            let (lo, hi) = period_range(p, &part_today(st.clock.as_ref(), &st.basis, p, a.now))?;
            let mut places = std::mem::take(&mut st.places);
            let mut ids = Ids::default();
            {
                let mut pk = Keyer::new(&pdim, st.clock.as_ref(), &st.basis, None, 0, false, None, &none);
                let (x, y) = st.ppos;
                st.data.retain(|r| {
                    let i = pk.key(get(r, x), get(r, y), &mut ids, &mut places);
                    let k = &ids.keys[i].0;
                    let k = if k.is_empty() { "~" } else { k.as_str() };
                    lo.as_str() <= k && k <= hi.as_str()
                });
            }
            st.places = places;
            if !ranges.contains(&(lo.clone(), hi.clone())) {
                ranges.push((lo, hi));
            }
        }
    }
    // 月で絞る
    let dd = day_dim(&dims[..nr]);
    let month = if dd.is_some() { a.month.to_string() } else { String::new() };
    let mut months: BTreeSet<String> = BTreeSet::new();
    if let Some(dd) = dd {
        let none = HashMap::new();
        for st in states.iter_mut() {
            let mut places = std::mem::take(&mut st.places);
            let mut ids = Ids::default();
            let mk_of: Vec<String> = {
                let mut dk = Keyer::new(&dims[dd], st.clock.as_ref(), &st.basis, st.equip.as_ref(), 0, false, None, &none);
                let (x, y) = st.pos[dd];
                st.data
                    .iter()
                    .map(|r| {
                        let i = dk.key(get(r, x), get(r, y), &mut ids, &mut places);
                        ids.keys[i].0.chars().take(7).collect()
                    })
                    .collect()
            };
            st.places = places;
            months.extend(mk_of.iter().filter(|m| !m.is_empty()).cloned());
            if !month.is_empty() {
                let mut it = mk_of.iter();
                st.data.retain(|_| it.next().is_some_and(|m| *m == month));
            }
        }
    }
    // 区間の幅・起点（全部のファイルの値で決める）
    let mut bins = vec![];
    let mut stats = Map::new();
    #[allow(clippy::needless_range_loop)] // 段の番号 i で、ファイルごとの読む列（st.pos[i]）も引く
    for i in 0..dims.len() {
        if dims[i].part != "bin" {
            continue;
        }
        let vals: Vec<f64> =
            states.iter().flat_map(|st| st.data.iter().filter_map(move |r| worksum::num(&get(r, st.pos[i].0).py()))).collect();
        let (lo, hi) = if vals.is_empty() {
            (0.0, 1.0)
        } else {
            (vals.iter().copied().fold(f64::INFINITY, f64::min), vals.iter().copied().fold(f64::NEG_INFINITY, f64::max))
        };
        let d = &mut dims[i];
        if d.width.is_none_or(|w| w.f() == 0.0) {
            d.width = Some(nice_width(lo, hi, vals.len()));
            d.auto = true;
        }
        let w = d.width.unwrap();
        if d.origin.is_none() {
            let k = (lo / w.f()).floor();
            d.origin = Some(match w {
                N::I(wi) => N::I(k as i64 * wi),
                N::F(wf) => N::F(k * wf),
            });
        }
        bins.push(json!({"dim": i, "column": d.column, "width": w.json(), "origin": d.origin.unwrap().json(), "auto": d.auto, "min": lo, "max": hi}));
        stats.insert(d.column.clone(), describe(&vals).unwrap_or(Value::Null));
    }
    let lots_on = ms.iter().any(|m| m["agg"] == "lots");
    // 1 行ずつ鍵を作り、行・列の段の頭の組（小計・総計）ごとに数える
    let mut ids: Vec<Ids> = (0..dims.len()).map(|_| Ids::default()).collect();
    let mut cells: HashMap<Vec<u32>, usize> = HashMap::new();
    let mut accs: Vec<(Vec<u32>, Acc3)> = vec![];
    let mut box_at: HashMap<Vec<u32>, usize> = HashMap::new();
    let mut box_vals: Vec<(Vec<u32>, Vec<f64>)> = vec![];
    let mut lot_ids: HashMap<(usize, String), u64> = HashMap::new();
    let mut next_lot = 0u64;
    let mut count = 0usize;
    for (pi, st) in states.iter_mut().enumerate() {
        let mut places = std::mem::take(&mut st.places);
        {
            let mut keyers: Vec<Keyer> =
                dims.iter().map(|d| Keyer::new(d, st.clock.as_ref(), &st.basis, st.equip.as_ref(), pi, multi, groups_on, &gsets)).collect();
            count += st.data.len();
            let mut ks = vec![0u32; dims.len()];
            for row in &st.data {
                for (i, kr) in keyers.iter_mut().enumerate() {
                    let (x, y) = st.pos[i];
                    ks[i] = kr.key(get(row, x), get(row, y), &mut ids[i], &mut places) as u32;
                }
                let lk = if !st.lots_by.is_empty() {
                    let (x, y) = st.kpos;
                    let k = if st.lots_by == "work" {
                        worksum::work_key(&get(row, x).py(), &get(row, y).py())
                    } else {
                        let p = get(row, x).py();
                        if p.truthy() {
                            pyfmt::strip(&p.py_str()).to_uppercase()
                        } else {
                            String::new()
                        }
                    };
                    if k.is_empty() {
                        next_lot += 1;
                        next_lot
                    } else {
                        *lot_ids.entry((pi, k)).or_insert_with(|| {
                            next_lot += 1;
                            next_lot
                        })
                    }
                } else {
                    next_lot += 1;
                    next_lot
                };
                let raws: Vec<&Own> = st.mpos.iter().map(|&p| get(row, p)).collect();
                let vals: Vec<Option<f64>> = raws.iter().map(|v| if **v == Own::None { None } else { worksum::num(&v.py()) }).collect();
                let texts: Vec<Option<String>> = raws.iter().map(|v| if **v == Own::None { None } else { Some(v.py().py_str()) }).collect();
                if st.bpos >= 0 {
                    if let Some(f) = worksum::num(&get(row, st.bpos).py()) {
                        let k: Vec<u32> = ks[..nr].to_vec();
                        let at = *box_at.entry(k.clone()).or_insert_with(|| {
                            box_vals.push((k, vec![]));
                            box_vals.len() - 1
                        });
                        box_vals[at].1.push(f);
                    }
                }
                for ra in 0..=nr {
                    for cb in 0..=nc {
                        let mut key = Vec::with_capacity(2 + ra + cb);
                        key.push(ra as u32);
                        key.push(cb as u32);
                        key.extend_from_slice(&ks[..ra]);
                        key.extend_from_slice(&ks[nr..nr + cb]);
                        let at = match cells.get(&key) {
                            Some(&i) => i,
                            None => {
                                cells.insert(key.clone(), accs.len());
                                accs.push((
                                    key,
                                    Acc3 {
                                        count: 0,
                                        lots: HashSet::new(),
                                        accs: ms.iter().map(|m| Acc::new(m["agg"].as_str().unwrap_or("count"))).collect(),
                                    },
                                ));
                                accs.len() - 1
                            }
                        };
                        let acc = &mut accs[at].1;
                        acc.count += 1;
                        if !st.lots_by.is_empty() && lots_on {
                            acc.lots.insert(lk);
                        }
                        for (j, f) in vals.iter().enumerate() {
                            acc.accs[j].add(*f, texts[j].as_deref());
                        }
                    }
                }
            }
        }
        st.places = places;
    }
    let lots_by = if states.iter().all(|s| !s.lots_by.is_empty()) { states[0].lots_by } else { "" };
    // 鍵の並び（段ごと）と、いちばん下の段の数の上限
    let orders: Vec<Vec<usize>> = ids
        .iter()
        .map(|d| {
            let mut ix: Vec<usize> = (0..d.keys.len()).collect();
            ix.sort_by(|&x, &y| sk_cmp(&d.keys[x].1, &d.keys[y].1));
            ix
        })
        .collect();
    let mut truncated = json!({"rows": false, "cols": false});
    let mut alive: Vec<bool> = vec![true; accs.len()];
    for (axis, n, lim, off) in [("rows", nr, MAX_ROW_KEYS, 0usize), ("cols", nc, MAX_COL_KEYS, nr)] {
        if n == 0 {
            continue;
        }
        let part_of = |key: &Vec<u32>| -> Vec<u32> {
            let (ra, cb) = (key[0] as usize, key[1] as usize);
            if axis == "rows" {
                key[2..2 + ra].to_vec()
            } else {
                key[2 + ra..2 + ra + cb].to_vec()
            }
        };
        let full = |key: &Vec<u32>| key[0] as usize == nr && key[1] as usize == nc;
        let mut leaves: Vec<Vec<u32>> = vec![];
        let mut seen: HashSet<Vec<u32>> = HashSet::new();
        for (k, _) in accs.iter() {
            if full(k) {
                let p = part_of(k);
                if seen.insert(p.clone()) {
                    leaves.push(p);
                }
            }
        }
        if leaves.len() > lim {
            let rank: Vec<HashMap<usize, usize>> =
                (0..n).map(|i| orders[off + i].iter().enumerate().map(|(r, &k)| (k, r)).collect()).collect();
            leaves.sort_by_key(|p| p.iter().enumerate().map(|(i, k)| rank[i][&(*k as usize)]).collect::<Vec<_>>());
            let keep: HashSet<Vec<u32>> = leaves.iter().take(lim).cloned().collect();
            truncated[axis] = json!(leaves.len());
            for (i, (k, _)) in accs.iter().enumerate() {
                let p = part_of(k);
                if p.len() == n && !keep.contains(&p) {
                    alive[i] = false;
                }
            }
        }
    }
    let label_of = |dim: usize, id: u32| -> String { ids[dim].keys[id as usize].0.clone() };
    let mut out_cells: Vec<OutCell> = accs
        .iter()
        .zip(&alive)
        .filter(|(_, ok)| **ok)
        .map(|((k, acc), _)| {
            let (ra, cb) = (k[0] as usize, k[1] as usize);
            let r = k[2..2 + ra].iter().enumerate().map(|(i, id)| label_of(i, *id)).collect();
            let c = k[2 + ra..2 + ra + cb].iter().enumerate().map(|(i, id)| label_of(nr + i, *id)).collect();
            let v = ms
                .iter()
                .enumerate()
                .map(|(j, m)| {
                    aggregate::clean_cell(match m["agg"].as_str().unwrap_or("") {
                        "count" => Some(N::I(acc.count)),
                        "lots" => Some(N::I(if lots_by.is_empty() { acc.count } else { acc.lots.len() as i64 })),
                        _ => acc.accs[j].value(m),
                    })
                })
                .collect();
            OutCell { r, c, v }
        })
        .collect();
    let order_keys: Vec<Vec<String>> =
        orders.iter().enumerate().map(|(i, o)| o.iter().map(|&k| ids[i].keys[k].0.clone()).collect()).collect();
    aggregate::apply_expr(&mut out_cells, &ms);
    aggregate::apply_show(&mut out_cells, &ms, nr, &order_keys);
    for x in out_cells.iter_mut() {
        for v in x.v.iter_mut() {
            *v = aggregate::clean_cell(*v);
        }
    }
    let leaves: HashSet<Vec<u32>> =
        accs.iter().zip(&alive).filter(|((k, _), ok)| **ok && k[0] as usize == nr).map(|((k, _), _)| k[2..2 + nr].to_vec()).collect();
    let boxes: Vec<Value> = if a.box_col.is_empty() {
        vec![]
    } else {
        box_vals
            .iter()
            .filter(|(k, _)| leaves.contains(k))
            .filter_map(|(k, v)| {
                let mut b = box_stats(v)?;
                b["r"] = json!(k.iter().enumerate().map(|(i, id)| label_of(i, *id)).collect::<Vec<_>>());
                Some(b)
            })
            .collect()
    };
    let note = if !lots_by.is_empty() || !lots_on {
        ""
    } else {
        "ロットを見分ける列（作業開始・ロット番号）が無いので、ロット数は行の数です。"
    };
    let ignored: BTreeSet<String> = states.iter().flat_map(|s| s.ignored.iter().cloned()).collect();
    let cell_json =
        |x: &OutCell| json!({"r": x.r, "c": x.c, "v": x.v.iter().map(|v| v.map(N::json).unwrap_or(Value::Null)).collect::<Vec<_>>()});
    let labels: Vec<Value> = ids.iter().map(|d| Value::Object(d.keys.iter().map(|(k, _, l)| (k.clone(), json!(l))).collect())).collect();
    let mut out = json!({
        "table": states[0].table, "count": count,
        "dims": {"rows": dims[..nr].iter().map(Dim::json).collect::<Vec<_>>(), "cols": dims[nr..].iter().map(Dim::json).collect::<Vec<_>>()},
        "measures": ms.iter().map(|m| { let mut x = m.clone(); x.insert("name".into(), json!(aggregate::name(m))); Value::Object(x) }).collect::<Vec<_>>(),
        "orders": order_keys, "labels": labels, "cells": out_cells.iter().map(cell_json).collect::<Vec<_>>(), "truncated": truncated,
        "bins": bins, "stats": stats, "box": a.box_col, "boxes": boxes, "lotsBy": lots_by, "start": states[0].start, "note": note,
        "months": months.into_iter().collect::<Vec<_>>(), "month": month, "ignoredFilters": ignored.into_iter().collect::<Vec<_>>(),
        "equipIgnored": equip_ignored, "timing": {"server": t0.elapsed().as_millis() as u64},
    });
    if let Some(p) = &period {
        let name = if p.kind != "month" || ranges.is_empty() {
            PERIODS.iter().find(|(k, _)| *k == p.kind).map(|(_, n)| n.to_string()).unwrap_or_default()
        } else {
            let f = &ranges[0].0;
            format!("{}年{}月", f[..4].parse::<i64>().unwrap_or(0), f[5..7].parse::<i64>().unwrap_or(0))
        };
        let mut m = p.json();
        m.insert("name".into(), json!(name));
        m.insert("ranges".into(), json!(ranges.iter().map(|(a, b)| json!({"from": a, "to": b})).collect::<Vec<_>>()));
        out["period"] = Value::Object(m);
    }
    if states.iter().any(|s| s.clock.is_some()) {
        let mut names: Vec<String> = vec![];
        for seg in states.iter().filter_map(|s| s.clock.as_ref()).flat_map(|c| c.segments.iter()) {
            if !names.contains(&seg.name) {
                names.push(seg.name.clone());
            }
        }
        out["shifts"] = json!(names);
    }
    if multi {
        out["parts"] = json!(states
            .iter()
            .map(|s| json!({"name": s.name, "table": s.table, "count": s.data.len(),
                            "shifts": s.clock.as_ref().map(|c| c.segments.iter().map(|g| g.name.clone()).collect::<Vec<_>>()).unwrap_or_default()}))
            .collect::<Vec<_>>());
        out["skipped"] = json!(skipped);
    }
    Ok(out)
}

// ------------------------------------------------------------------ カラムの札（版 3.99.0。Python の pivot.field_sets・merge_fields・fields）
/// 札の種類を数える上限（1,000 を超えたら「1,000 種類以上」。Python の pivot.KINDS_MAX）
pub const KINDS_MAX: usize = 1001;
/// 値の見本の数（Python の pivot.SAMPLES）
pub const SAMPLES: usize = 3;

/// 同じ値の見分け（SortKey の答え）。Python の set と同じく、整数と同じ大きさの小数は同じ値（1 と 1.0）
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum KeyV {
    I(i64),
    F(u64),
    T(String),
    B(Vec<u8>),
}

impl KeyV {
    fn of(v: SqlValue) -> Option<KeyV> {
        Some(match v {
            SqlValue::Null => return None,
            SqlValue::Integer(i) => KeyV::I(i),
            SqlValue::Real(f) => {
                if f.fract() == 0.0 && (-9.223_372_036_854_775e18..9.223_372_036_854_775e18).contains(&f) && (f as i64) as f64 == f {
                    KeyV::I(f as i64)
                } else {
                    KeyV::F(f.to_bits())
                }
            }
            SqlValue::Text(t) => KeyV::T(t),
            SqlValue::Blob(b) => KeyV::B(b),
        })
    }
}

/// 1 つのファイルの 1 列の札の材料（合わせる前）
#[derive(Debug, Clone)]
pub struct FieldSet {
    pub column: String,
    pub calc: bool,
    pub broken: bool,
    /// 同じ値の見分け（SortKey）の集合（KINDS_MAX で止める）
    pub keys: HashSet<KeyV>,
    /// 空欄（SortKey が NULL）がある
    pub blank: bool,
    /// 空欄でない値の先頭 sample 個がみな数か（値が無ければ None）
    pub numeric: Option<bool>,
    pub date: bool,
    /// 計算列: 先頭 60 個の 8 割が日付
    pub dated: bool,
    pub deps: Vec<String>,
}

/// 1 つのファイルの札の材料（Python の field_sets）
#[derive(Debug, Clone)]
pub struct FieldSets {
    pub table: String,
    pub fields: Vec<FieldSet>,
}

/// 1 つのファイルの札の材料（Python の field_sets）。合わせ方は merge_fields（作業実績のすべての設備も、1 つのファイルも同じ）
pub fn field_sets(part: &Part, calc: Option<&Calc>, conv: &Arc<Tables>, sample: usize) -> R<FieldSets> {
    let c = connect_ro(&part.path).map_err(down)?;
    let names = lotlist::tables(&c).map_err(down)?;
    let t =
        if names.contains(&part.table) { part.table.clone() } else { lotlist::pick_table(&names, &part.preferred_table, part.candidates) };
    if t.is_empty() {
        return Err(down("表が 1 つもありません。".into()));
    }
    let cs = lotlist::dedup(&lotlist::raw_columns(&c, &t).map_err(down)?);
    let dates: HashSet<String> = lotlist::date_columns(&c, &t, &cs).map_err(down)?.into_iter().collect();
    let qt = qi(&t);
    let hint = |col: &str, sql: &str| -> R<(FieldSet, Vec<Own>)> {
        let mut st =
            c.prepare(&format!("SELECT DISTINCT SortKey({sql}) FROM {qt} LIMIT {}", KINDS_MAX + 1)).map_err(|e| down(sql_err(e)))?;
        let mut rows = st.query([]).map_err(|e| down(sql_err(e)))?;
        let (mut keys, mut blank) = (HashSet::new(), false);
        while let Some(r) = rows.next().map_err(|e| down(sql_err(e)))? {
            match KeyV::of(r.get::<_, SqlValue>(0).map_err(|e| down(sql_err(e)))?) {
                Some(k) => {
                    keys.insert(k);
                }
                None => blank = true,
            }
        }
        let mut st =
            c.prepare(&format!("SELECT {sql} FROM {qt} WHERE SortKey({sql}) IS NOT NULL LIMIT {sample}")).map_err(|e| down(sql_err(e)))?;
        let mut rows = st.query([]).map_err(|e| down(sql_err(e)))?;
        let mut vals = vec![];
        while let Some(r) = rows.next().map_err(|e| down(sql_err(e)))? {
            vals.push(r.get_ref(0).map(Own::of_ref).unwrap_or(Own::None));
        }
        let numeric = (!vals.is_empty()).then(|| vals.iter().all(|v| worksum::num(&v.py()).is_some()));
        let f = FieldSet { column: col.into(), calc: false, broken: false, keys, blank, numeric, date: false, dated: false, deps: vec![] };
        Ok((f, vals))
    };
    let mut out = vec![];
    for col in &cs {
        let (mut f, _) = hint(col, &qi(col))?;
        f.date = dates.contains(col);
        out.push(f);
    }
    let (exprs, calcs, broken, cc) = calc_exprs(&c, calc, &cs, conv)?;
    for col in &calcs {
        if broken.contains(col) {
            out.push(FieldSet {
                column: col.clone(),
                calc: true,
                broken: true,
                keys: HashSet::new(),
                blank: false,
                numeric: None,
                date: false,
                dated: false,
                deps: vec![],
            });
            continue;
        }
        let (mut f, vals) = hint(col, &exprs[col])?;
        let head: Vec<&Own> = vals.iter().take(60).collect();
        f.dated =
            !head.is_empty() && head.iter().filter(|v| pyfmt::to_date(&v.py()).is_some()).count() as f64 / head.len() as f64 >= DATE_RATIO;
        f.calc = true;
        f.deps = cc.as_ref().map(|x| x.raw_deps(col)).unwrap_or_default();
        out.push(f);
    }
    Ok(FieldSets { table: t, fields: out })
}

/// ファイルごとの札の材料 [(名前, 材料)] → 札の並び（Python の merge_fields。決まりは src/builder.rs の冒頭）
pub fn merge_fields(per: &[(String, FieldSets)]) -> Vec<Value> {
    struct Acc {
        keys: HashSet<KeyV>,
        most: usize,
        blank: bool,
        nums: Vec<bool>,
        date: bool,
        dated: bool,
        calc: bool,
        deps: Option<Vec<String>>,
        broken: Vec<String>,
        seen: usize,
    }
    let mut acc: HashMap<String, Acc> = HashMap::new();
    let (mut raw_order, mut calc_order) = (vec![], vec![]);
    for (name, d) in per {
        for f in &d.fields {
            let m = acc.entry(f.column.clone()).or_insert_with(|| {
                if f.calc {
                    calc_order.push(f.column.clone());
                } else {
                    raw_order.push(f.column.clone());
                }
                Acc {
                    keys: HashSet::new(),
                    most: 0,
                    blank: false,
                    nums: vec![],
                    date: false,
                    dated: false,
                    calc: f.calc,
                    deps: None,
                    broken: vec![],
                    seen: 0,
                }
            });
            m.seen += 1;
            if f.broken {
                m.broken.push(name.clone());
                continue;
            }
            if m.deps.is_none() && f.calc {
                m.deps = Some(f.deps.clone());
            }
            if crate::builder::KINDS_UNION {
                for k in &f.keys {
                    if m.keys.len() >= KINDS_MAX {
                        break;
                    }
                    m.keys.insert(k.clone());
                }
            }
            m.most = m.most.max(f.keys.len());
            m.blank |= f.blank;
            if let Some(n) = f.numeric {
                m.nums.push(n);
            }
            m.date |= f.date;
            m.dated |= f.dated;
        }
    }
    let mut out = vec![];
    for col in raw_order.iter().chain(&calc_order) {
        let m = &acc[col];
        if m.calc && m.broken.len() == m.seen {
            out.push(
                json!({"column": col, "calc": true, "kinds": 0, "many": false, "numeric": false, "date": false, "error": "式が読めません"}),
            );
            continue;
        }
        let n = (if crate::builder::KINDS_UNION { m.keys.len() } else { m.most }).min(KINDS_MAX);
        let kinds = (n + usize::from(m.blank && n > 0)).min(KINDS_MAX);
        let numeric = !m.nums.is_empty() && m.nums.iter().all(|x| *x);
        let mut x = Map::new();
        x.insert("column".into(), json!(col));
        x.insert("kinds".into(), json!(kinds));
        x.insert("many".into(), json!(kinds > KINDS_MAX - 1));
        x.insert("numeric".into(), json!(numeric));
        x.insert("date".into(), json!(if m.calc { m.dated && !numeric } else { m.date }));
        if n == 0 && m.blank {
            x.insert("blankOnly".into(), json!(true));
        }
        if m.calc {
            x.insert("calc".into(), json!(true));
            x.insert("deps".into(), json!(m.deps.clone().unwrap_or_default()));
            if !m.broken.is_empty() {
                x.insert("brokenIn".into(), json!(m.broken));
            }
        }
        out.push(Value::Object(x));
    }
    out
}

/// いくつかのファイルの札（作業実績のすべての設備・1 つのファイル）: 読めたファイルの札を合わせた答えと、読めなかったファイル [{name, error, kind}]。
/// 計算列の無い札は、合わせた全部のファイルの指紋（場所・更新時刻・大きさ・表の選び方）の並びごとに、合わせた答えを覚える（版 3.99.0。
/// 前は 1 ファイルずつ覚えた。値の集合は数えている間だけ持つ）。読めないファイルがあれば覚えない。progress の read に n/m を載せる
pub fn fields_many(
    parts: &[Part],
    calc: &dyn Fn(&Part) -> Option<Calc>,
    plain: bool,
    conv: &Arc<Tables>,
    sample: usize,
) -> (String, Vec<Value>, Vec<Value>) {
    let key =
        plain.then(|| parts.iter().map(|p| fields_key(p, sample)).collect::<Option<Vec<String>>>()).flatten().map(|v| v.join("\u{1d}"));
    if let Some(k) = &key {
        if let Some(v) = FIELDS.lock().ok().and_then(|m| m.get(k).cloned()) {
            crate::progress::step("read", parts.len(), parts.len());
            return (v.0, v.1, vec![]);
        }
    }
    let (mut per, mut failed) = (vec![], vec![]);
    for (i, p) in parts.iter().enumerate() {
        crate::progress::step("read", i, parts.len()); // 読み終えたファイル i / 全部（版 3.99.0）
        match field_sets(p, calc(p).as_ref(), conv, sample) {
            Ok(d) => per.push((p.name.clone(), d)),
            Err(e) => failed.push(json!({"name": p.name, "error": e.text(), "kind": "error"})),
        }
    }
    crate::progress::step("read", parts.len(), parts.len());
    let table = per.first().map(|(_, d)| d.table.clone()).unwrap_or_default();
    let fields = merge_fields(&per);
    if let (Some(k), true) = (key, failed.is_empty()) {
        if let Ok(mut m) = FIELDS.lock() {
            if m.len() >= FIELDS_KEEP {
                m.clear();
            }
            m.insert(k, (table.clone(), fields.clone()));
        }
    }
    (table, fields, failed)
}

/// 集計の左のカラムの札に出す手がかり（1 つのファイル。Python の fields）
pub fn fields(part: &Part, calc: Option<&Calc>, conv: &Arc<Tables>, sample: usize) -> R<Value> {
    let (table, fields, failed) = fields_many(std::slice::from_ref(part), &|_| calc.cloned(), calc.is_none(), conv, sample);
    if let Some(f) = failed.first() {
        return Err(down(f["error"].as_str().unwrap_or("").to_string()));
    }
    Ok(json!({"table": table, "fields": fields}))
}

/// 覚えたカラムの札（合わせたファイルの指紋の並び → (表, 札)）。数が多くなったら全部を捨てる（写しの版が替わると古い鍵は使われない）
type Kept = (String, Vec<Value>);
static FIELDS: std::sync::LazyLock<std::sync::Mutex<HashMap<String, Kept>>> = std::sync::LazyLock::new(Default::default);
const FIELDS_KEEP: usize = 64;

fn fields_key(part: &Part, sample: usize) -> Option<String> {
    let meta = std::fs::metadata(&part.path).ok()?;
    let mtime = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
    Some(format!(
        "{}\u{1e}{mtime}\u{1e}{}\u{1e}{}\u{1e}{}\u{1e}{}\u{1e}{sample}",
        part.path.display(),
        meta.len(),
        part.table,
        part.preferred_table,
        part.candidates.join("\u{1f}")
    ))
}

/// 空欄でない値の見本（Python の samples_of。決まりは src/builder.rs の冒頭）: 空欄（SortKey が NULL）を除き、表の行の順に、
/// 見せる字（生の値の Python の str）が同じ物を 1 つにして n 個まで
pub fn samples_of(c: &rusqlite::Connection, t: &str, sql: &str, n: usize) -> Result<Vec<String>, String> {
    let mut st =
        c.prepare(&format!("SELECT DISTINCT {sql} FROM {} WHERE SortKey({sql}) IS NOT NULL LIMIT {}", qi(t), n * 4)).map_err(sql_err)?;
    let mut rows = st.query([]).map_err(sql_err)?;
    let mut out: Vec<String> = vec![];
    while let Some(r) = rows.next().map_err(sql_err)? {
        let s = r.get_ref(0).map(Own::of_ref).unwrap_or(Own::None).py().py_str();
        if !out.contains(&s) {
            out.push(s);
        }
        if out.len() >= n {
            break;
        }
    }
    Ok(out)
}

/// 列ごとの値の見本 [(列, 見本)]
pub type Samples = Vec<(String, Vec<String>)>;

/// 表の列の名前と値の見本 → (表, [(列, 見本)])（Python の column_names）
pub fn column_names(part: &Part, n: usize) -> R<(String, Samples)> {
    let c = connect_ro(&part.path).map_err(down)?;
    let t = lotlist::pick_table(&lotlist::tables(&c).map_err(down)?, &part.preferred_table, part.candidates);
    if t.is_empty() {
        return Err(down("表が 1 つもありません。".into()));
    }
    let mut out = vec![];
    for col in lotlist::dedup(&lotlist::raw_columns(&c, &t).map_err(down)?) {
        let s = samples_of(&c, &t, &qi(&col), n).map_err(down)?;
        out.push((col, s));
    }
    Ok((t, out))
}
