//! 集計の値の決め方（Python の services/aggregate.py と同じ答え。集計 src/pivot.rs の値〈measures〉の 1 か所）。
//!
//! 値の種類（agg）は、ためる物で分かれる（要る物だけをためる。1 つの値に 1 つの器 Acc）:
//!     数え方   … count（行の数）・lots（ロット数: pivot がロットの鍵の集まりで数える）
//!     足し算   … sum・avg・min・max・n・range
//!     ばらつき … sd・var・cv・cpk（Welford の方法で平均と偏差の 2 乗の和をためる）
//!     並び     … median・q1・q3・iqr・pct・mode（値の並びをためる）
//!     種類     … distinct（種類の数。空欄は数えない）
//! 表し方（show）: pct_total・pct_row・pct_col・cum・diff・rank（数え終えたセルの値から決める apply_show）。
//! 計算（expr）: 数え終えたセルの値に四則演算を当てる（src/num_expr.rs）。表し方は計算した後の値から決める。
//! 数は Python と同じく整数（件数・ロット数・個数・種類の数・順位）と小数を分けて持つ（JSON の 1 と 1.0 も同じに書く）。

use crate::num_expr;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

pub const COUNTS: &[&str] = &["count", "lots"];
const SIMPLE: &[&str] = &["sum", "avg", "min", "max", "n", "range"];
const SPREAD: &[&str] = &["sd", "var", "cv", "cpk"];
const ORDERED: &[&str] = &["median", "q1", "q3", "iqr", "pct", "mode"];
const KINDS: &[&str] = &["distinct"];
const SHOWS: &[&str] = &["", "pct_total", "pct_row", "pct_col", "cum", "diff", "rank"];
const EXPR_MAX: usize = 60;
const DEC_MAX: f64 = 6.0;

pub fn is_agg(a: &str) -> bool {
    [COUNTS, SIMPLE, SPREAD, ORDERED, KINDS].iter().any(|g| g.contains(&a))
}

fn label(agg: &str) -> &'static str {
    match agg {
        "count" => "件数",
        "lots" => "ロット数",
        "sum" => "合計",
        "avg" => "平均",
        "min" => "最小",
        "max" => "最大",
        "n" => "個数",
        "range" => "範囲",
        "sd" => "標準偏差",
        "var" => "分散",
        "cv" => "変動係数(%)",
        "cpk" => "Cpk",
        "median" => "中央値",
        "q1" => "25%点",
        "q3" => "75%点",
        "iqr" => "四分位範囲",
        "pct" => "%点",
        "mode" => "最頻値",
        _ => "種類の数",
    }
}

fn show_label(s: &str) -> &'static str {
    match s {
        "pct_total" => "総計に対する%",
        "pct_row" => "行の計に対する%",
        "pct_col" => "列の計に対する%",
        "cum" => "累計",
        "diff" => "前との差",
        _ => "順位",
    }
}

/// 数（Python の int と float を分けて持つ）
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum N {
    I(i64),
    F(f64),
}

impl N {
    pub fn f(self) -> f64 {
        match self {
            N::I(i) => i as f64,
            N::F(f) => f,
        }
    }
    pub fn json(self) -> Value {
        match self {
            N::I(i) => json!(i),
            N::F(f) => json!(f),
        }
    }
    fn add(self, o: N) -> N {
        match (self, o) {
            (N::I(a), N::I(b)) => a.checked_add(b).map(N::I).unwrap_or(N::F(a as f64 + b as f64)),
            (a, b) => N::F(a.f() + b.f()),
        }
    }
    fn sub(self, o: N) -> N {
        match (self, o) {
            (N::I(a), N::I(b)) => a.checked_sub(b).map(N::I).unwrap_or(N::F(a as f64 - b as f64)),
            (a, b) => N::F(a.f() - b.f()),
        }
    }
    fn truthy(self) -> bool {
        self.f() != 0.0
    }
}

/// セルの 1 つの値（None は答え無し）
pub type Cell = Option<N>;

/// 小数を 10^-n の位で丸める（Python の round(x, n)。正しく丸めた字に書いて読み戻す）
pub fn py_round(x: f64, n: usize) -> f64 {
    if !x.is_finite() {
        return x;
    }
    format!("{x:.n$}").parse().unwrap_or(x)
}

/// 足し算の誤差（1248967.0999999992）を丸める（Python の pivot の clean）
pub fn clean_cell(v: Cell) -> Cell {
    match v {
        Some(N::F(f)) => Some(N::F(py_round(f, 6))),
        x => x,
    }
}

fn num_of(v: Option<&Value>) -> Option<f64> {
    // Python の _num: float(v)（字は空白を除いた数の字・真偽は 1/0）。有限でなければ None
    let f = match v? {
        Value::Number(n) => n.as_f64(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        Value::String(s) => crate::pyfmt::py_float(s).ok(),
        _ => None,
    }?;
    f.is_finite().then_some(f)
}

/// 画面から来た値 → 確かめた値（Python の aggregate.clean と同じ。合わなければ理由の字）。has_column(列) → その列があるか
pub fn clean(m: &Map<String, Value>, has_column: &dyn Fn(&str) -> bool) -> Result<Map<String, Value>, String> {
    let s = |k: &str| match m.get(k) {
        Some(Value::Null) | None => String::new(),
        Some(v) if !crate::lotlist::json_truthy(v) => String::new(),
        Some(Value::String(x)) => x.clone(),
        Some(v) => crate::lotlist::json_str(v),
    };
    let mut agg = s("agg");
    if agg.is_empty() {
        agg = "count".into();
    }
    if !is_agg(&agg) {
        agg = "count".into();
    }
    let col = if COUNTS.contains(&agg.as_str()) { String::new() } else { s("column") };
    if !COUNTS.contains(&agg.as_str()) && !has_column(&col) {
        return Err(format!("値の列「{col}」がありません。"));
    }
    let mut out = Map::new();
    out.insert("agg".into(), json!(agg));
    out.insert("column".into(), json!(col));
    if agg == "pct" {
        let p = num_of(m.get("p"));
        out.insert("p".into(), json!(p.map(|p| (p.round_ties_even() as i64).clamp(1, 99)).unwrap_or(90)));
    }
    if agg == "cpk" {
        let (lsl, usl) = (num_of(m.get("lsl")), num_of(m.get("usl")));
        if lsl.is_none() && usl.is_none() {
            return Err(format!("「{col}」の Cpk には、規格の下限か上限が要ります。"));
        }
        if let (Some(a), Some(b)) = (lsl, usl) {
            if a >= b {
                return Err(format!("「{col}」の Cpk の規格は、下限 < 上限にしてください。"));
            }
        }
        for (k, v) in [("lsl", lsl), ("usl", usl)] {
            if let Some(v) = v {
                out.insert(k.into(), json!(v));
            }
        }
    }
    let show = s("show");
    if !show.is_empty() && SHOWS.contains(&show.as_str()) {
        out.insert("show".into(), json!(show));
    }
    let expr: String = crate::pyfmt::strip(&s("expr")).chars().take(EXPR_MAX).collect();
    if !expr.is_empty() {
        if let Err(e) = num_expr::compile(&expr) {
            return Err(format!("「{}」の計算「{expr}」が読めません（{e}）。", name(&out)));
        }
        out.insert("expr".into(), json!(expr));
    }
    if let Some(d) = num_of(m.get("dec")) {
        out.insert("dec".into(), json!(d.round_ties_even().clamp(0.0, DEC_MAX) as i64));
    }
    Ok(out)
}

fn ms(m: &Map<String, Value>, k: &str) -> String {
    m.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

/// 計算の見せ方（÷1000 → 値÷1000）
pub fn expr_text(expr: &str) -> String {
    match num_expr::compile(expr) {
        Ok(Some(e)) if !e.text.is_empty() => e.text,
        _ => expr.to_string(),
    }
}

/// 値の見せる名前（件数・ロット数・〇〇の平均・〇〇の90%点・〇〇の平均（累計））
pub fn name(m: &Map<String, Value>) -> String {
    let agg = ms(m, "agg");
    let base = if COUNTS.contains(&agg.as_str()) {
        label(&agg).to_string()
    } else {
        let p = if agg == "pct" { m.get("p").map(|p| p.to_string()).unwrap_or_default() } else { String::new() };
        format!("{}の{p}{}", ms(m, "column"), label(&agg))
    };
    let show = ms(m, "show");
    let expr = ms(m, "expr");
    format!(
        "{base}{}{}",
        if show.is_empty() { String::new() } else { format!("（{}）", show_label(&show)) },
        if expr.is_empty() { String::new() } else { format!("［{}］", expr_text(&expr)) }
    )
}

/// 1 つのセル・1 つの値の器
pub struct Acc {
    agg: String,
    n: i64,
    sum: f64,
    lo: Option<f64>,
    hi: Option<f64>,
    mean: f64,
    m2: f64,
    vals: Option<Vec<f64>>,
    kinds: Option<HashSet<String>>,
}

impl Acc {
    pub fn new(agg: &str) -> Acc {
        Acc {
            agg: agg.into(),
            n: 0,
            sum: 0.0,
            lo: None,
            hi: None,
            mean: 0.0,
            m2: 0.0,
            vals: ORDERED.contains(&agg).then(Vec::new),
            kinds: (agg == "distinct").then(HashSet::new),
        }
    }

    /// f … 数に読めた値（読めなければ None）・raw … 元の値の字（種類の数。None は空）
    pub fn add(&mut self, f: Option<f64>, raw: Option<&str>) {
        if let Some(k) = self.kinds.as_mut() {
            let t = crate::pyfmt::strip(raw.unwrap_or(""));
            if !t.is_empty() {
                k.insert(t.to_string());
            }
            return;
        }
        let Some(f) = f else { return };
        self.n += 1;
        self.sum += f;
        self.lo = Some(match self.lo {
            Some(l) if l <= f => l,
            _ => f,
        });
        self.hi = Some(match self.hi {
            Some(h) if h >= f => h,
            _ => f,
        });
        let d = f - self.mean;
        self.mean += d / self.n as f64;
        self.m2 += d * (f - self.mean);
        if let Some(v) = self.vals.as_mut() {
            v.push(f);
        }
    }

    fn sd(&self) -> Option<f64> {
        (self.n > 1).then(|| (self.m2 / (self.n - 1) as f64).sqrt())
    }

    pub fn value(&self, m: &Map<String, Value>) -> Cell {
        let agg = self.agg.as_str();
        if agg == "distinct" {
            return Some(N::I(self.kinds.as_ref().map(|k| k.len()).unwrap_or(0) as i64));
        }
        if agg == "n" {
            return Some(N::I(self.n));
        }
        if self.n == 0 {
            return None;
        }
        let f = |x: f64| Some(N::F(x));
        match agg {
            "sum" => f(self.sum),
            "avg" => f(self.sum / self.n as f64),
            "min" => self.lo.map(N::F),
            "max" => self.hi.map(N::F),
            "range" => f(self.hi? - self.lo?),
            "sd" | "var" | "cv" | "cpk" => {
                let sd = self.sd()?;
                match agg {
                    "sd" => f(sd),
                    "var" => f(sd * sd),
                    "cv" => (self.mean != 0.0).then(|| N::F(sd / self.mean.abs() * 100.0)),
                    _ => {
                        if sd == 0.0 {
                            return None;
                        }
                        let mut sides = vec![];
                        if let Some(u) = m.get("usl").and_then(Value::as_f64) {
                            sides.push((u - self.mean) / (3.0 * sd));
                        }
                        if let Some(l) = m.get("lsl").and_then(Value::as_f64) {
                            sides.push((self.mean - l) / (3.0 * sd));
                        }
                        sides.into_iter().reduce(f64::min).map(N::F)
                    }
                }
            }
            _ => {
                let mut xs = self.vals.clone().unwrap_or_default();
                xs.sort_by(|a, b| a.total_cmp(b));
                if agg == "mode" {
                    // いちばん多い値（同じ数なら小さい方）
                    let mut best: Option<(usize, f64)> = None;
                    let mut i = 0;
                    while i < xs.len() {
                        let mut j = i;
                        while j < xs.len() && xs[j] == xs[i] {
                            j += 1;
                        }
                        if best.is_none_or(|(k, _)| j - i > k) {
                            best = Some((j - i, xs[i]));
                        }
                        i = j;
                    }
                    return best.map(|(_, x)| N::F(x));
                }
                let q = match agg {
                    "median" => 0.5,
                    "q1" => 0.25,
                    "q3" => 0.75,
                    "pct" => m.get("p").and_then(Value::as_f64).unwrap_or(90.0) / 100.0,
                    _ => return f(quantile(&xs, 0.75) - quantile(&xs, 0.25)),
                };
                f(quantile(&xs, q))
            }
        }
    }
}

/// 小数の並びの和（Python 3.12 からの組み込みの sum と同じ: Neumaier の補正つき。最後に補正を足す）
pub fn py_sum(xs: impl IntoIterator<Item = f64>) -> f64 {
    let (mut s, mut c) = (0.0f64, 0.0f64);
    for x in xs {
        let t = s + x;
        c += if s.abs() >= x.abs() { (s - t) + x } else { (x - t) + s };
        s = t;
    }
    if c != 0.0 && c.is_finite() {
        s += c;
    }
    s
}

/// 並べた値の p 点（両端を含む直線の補い。Excel の PERCENTILE.INC と同じ）
pub fn quantile(xs: &[f64], p: f64) -> f64 {
    let i = (xs.len() - 1) as f64 * p;
    let lo = i.floor() as usize;
    xs[lo] + (xs[(lo + 1).min(xs.len() - 1)] - xs[lo]) * (i - lo as f64)
}

/// セル（行の鍵・列の鍵・値の並び）
#[derive(Debug, Clone)]
pub struct OutCell {
    pub r: Vec<String>,
    pub c: Vec<String>,
    pub v: Vec<Cell>,
}

/// 計算（expr）を当てる。数でない値はそのまま
pub fn apply_expr(cells: &mut [OutCell], measures: &[Map<String, Value>]) {
    let fns: Vec<(usize, num_expr::Expr)> = measures
        .iter()
        .enumerate()
        .filter_map(|(j, m)| m.get("expr").and_then(Value::as_str).and_then(|e| num_expr::compile(e).ok().flatten()).map(|e| (j, e)))
        .collect();
    if fns.is_empty() {
        return;
    }
    for x in cells.iter_mut() {
        for (j, f) in &fns {
            if let Some(v) = x.v[*j] {
                x.v[*j] = f.apply(v.f()).map(N::F);
            }
        }
    }
}

/// 表し方（show）を当てる。orders … 段ごとの鍵の並び（行は 0〜nr-1）
pub fn apply_show(cells: &mut [OutCell], measures: &[Map<String, Value>], nr: usize, orders: &[Vec<String>]) {
    let js: Vec<(usize, String)> = measures
        .iter()
        .enumerate()
        .filter_map(|(j, m)| m.get("show").and_then(Value::as_str).filter(|s| !s.is_empty()).map(|s| (j, s.to_string())))
        .collect();
    if js.is_empty() {
        return;
    }
    type K = (Vec<String>, Vec<String>);
    let at: HashMap<K, usize> = cells.iter().enumerate().map(|(i, x)| ((x.r.clone(), x.c.clone()), i)).collect();
    let raw: Vec<Vec<Cell>> = cells.iter().map(|x| x.v.clone()).collect();
    let rank: Vec<HashMap<&String, usize>> =
        (0..nr).map(|i| orders.get(i).map(|o| o.iter().enumerate().map(|(n, k)| (k, n)).collect()).unwrap_or_default()).collect();
    let base_of = |k: &K| at.get(k).map(|&i| &raw[i]);
    for (j, show) in &js {
        let j = *j;
        if show.starts_with("pct_") {
            for cell in cells.iter_mut() {
                let key: K = match show.as_str() {
                    "pct_total" => (vec![], vec![]),
                    "pct_row" => (cell.r.clone(), vec![]),
                    _ => (vec![], cell.c.clone()),
                };
                let b = base_of(&key).and_then(|v| v[j]);
                cell.v[j] = match (cell.v[j], b) {
                    (Some(v), Some(b)) if b.truthy() => Some(N::F(v.f() / b.f() * 100.0)),
                    _ => None,
                };
            }
            continue;
        }
        // 累計・差・順位: 行の段の深さごと、同じ親・同じ列の中で、行の並びの順に（Python と同じく、組の並びは初めて出た順）
        type G = (usize, Vec<String>, Vec<String>);
        let mut at_group: HashMap<G, usize> = HashMap::new();
        let mut groups: Vec<(G, Vec<usize>)> = vec![];
        for (i, x) in cells.iter().enumerate() {
            if x.r.is_empty() {
                continue;
            }
            let g: G = (x.r.len(), x.r[..x.r.len() - 1].to_vec(), x.c.clone());
            let k = *at_group.entry(g.clone()).or_insert_with(|| {
                groups.push((g, vec![]));
                groups.len() - 1
            });
            groups[k].1.push(i);
        }
        for (g, rs) in groups {
            let mut rs = rs;
            let a = g.0;
            rs.sort_by_key(|&i| rank[a - 1].get(cells[i].r.last().unwrap()).copied().unwrap_or(usize::MAX));
            let vals: Vec<Cell> = rs.iter().map(|&i| raw[i][j]).collect();
            let out: Vec<Cell> = match show.as_str() {
                "cum" => {
                    let mut s = N::I(0);
                    vals.iter()
                        .map(|v| {
                            v.map(|v| {
                                s = s.add(v);
                                s
                            })
                        })
                        .collect()
                }
                "diff" => std::iter::once(None)
                    .chain(vals.windows(2).map(|w| match (w[0], w[1]) {
                        (Some(a), Some(b)) => Some(b.sub(a)),
                        _ => None,
                    }))
                    .take(vals.len())
                    .collect(),
                _ => {
                    let mut sorted: Vec<N> = vals.iter().flatten().copied().collect();
                    sorted.sort_by(|a, b| b.f().total_cmp(&a.f()));
                    vals.iter().map(|v| v.map(|v| N::I(sorted.iter().position(|x| x.f() == v.f()).unwrap_or(0) as i64 + 1))).collect()
                }
            };
            for (i, v) in rs.into_iter().zip(out) {
                cells[i].v[j] = v;
            }
        }
        if show == "rank" {
            for x in cells.iter_mut() {
                if x.r.is_empty() {
                    x.v[j] = None;
                }
            }
        }
    }
}
