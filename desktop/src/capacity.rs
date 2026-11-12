//! 基準の数（版 3.103.0。Python の services/capacity.py と同じ決め方・同じ答え）。
//!
//! 集計（src/pivot.rs の query_many）のセルごとに、そのセルの行から数える数。値の計算の式で ［稼働直］ のように読み、
//! 値を割る（値の per）・値として出す（agg "base"）・作った数の式に使う。決め方の説明は capacity.py の冒頭と同じ:
//!     稼働直＝実績のある（作業日×直）の数・稼働日＝実績のある作業日の数（設備ごとに数えて足す）・1日の直数＝勤務体系の直の数
//!     （直の段で絞られたセルはその直だけ）・期間の日数＝パネルの期間の日数（日の段で切る。期間なしはセルの最初〜最後の作業日）・
//!     期間の直数＝期間の日数×1日の直数（設備ごとに掛けて足す）・作った数（each は設備ごとに当てて足す）。
//! 足す設備は、セルの設備の段に当たるパネルのすべての設備（実績の無い設備も）。答えが同じことは pivot_parity・dash_parity
//! （← program/tests/pivot_oracle.py・dashboard_oracle.py）で確かめ、Python は独立の答え tools/capacity-truth.py と比べる。

use crate::aggregate::N;
use crate::lotlist::{json_str, json_truthy};
use crate::num_expr::{self, Expr};
use chrono::{Duration as Days, NaiveDate};
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};

pub const SHIFTS: &str = "稼働直";
pub const DAYS: &str = "稼働日";
pub const SPD: &str = "1日の直数";
pub const PDAYS: &str = "期間の日数";
pub const PSHIFTS: &str = "期間の直数";
pub const FIXED: [&str; 5] = [SHIFTS, DAYS, SPD, PDAYS, PSHIFTS];
/// 勤務体系の直が要る数（作業実績だけ）。Python の NEED_SHIFT と同じ並び
pub const NEED_SHIFT: [&str; 3] = [SHIFTS, SPD, PSHIFTS];
const OWN_MAX: usize = 12;
const NAME_MAX: usize = 16;
const EXPR_MAX: usize = 60;
const UNIT_MAX: usize = 6;

/// 作った基準の数（clean_own を通した物）
#[derive(Debug, Clone)]
pub struct OwnBase {
    pub name: String,
    pub expr: Expr,
    pub each: bool,
    pub json: Value,
}

fn fixed_names() -> Vec<String> {
    FIXED.iter().map(|x| x.to_string()).collect()
}

fn take(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Python の str(x.get(k) or "")
fn py_s(v: Option<&Value>) -> String {
    match v {
        Some(x) if json_truthy(x) => json_str(x),
        _ => String::new(),
    }
}

/// 作った数の並び → 確かめた並び（Python の clean_own）。並びでなければ None
pub fn clean_own(v: Option<&Value>) -> Option<Vec<OwnBase>> {
    let Some(Value::Array(xs)) = v else { return None };
    let fixed = fixed_names();
    let mut out: Vec<OwnBase> = vec![];
    for x in xs {
        let Value::Object(m) = x else { continue };
        let name = take(crate::pyfmt::strip(&py_s(m.get("name"))), NAME_MAX);
        let expr = take(crate::pyfmt::strip(&py_s(m.get("expr"))), EXPR_MAX);
        if name.is_empty() || name.contains('[') || name.contains(']') || FIXED.contains(&name.as_str()) || out.iter().any(|o| o.name == name) {
            continue;
        }
        let Ok(Some(e)) = num_expr::compile_with(&expr, Some(&fixed), false) else { continue };
        let each = m.get("each") == Some(&Value::Bool(true));
        let mut j = Map::new();
        j.insert("name".into(), json!(name));
        j.insert("expr".into(), json!(expr));
        if each {
            j.insert("each".into(), json!(true));
        }
        if let Some(Value::String(u)) = m.get("unit") {
            let u = take(crate::pyfmt::strip(u), UNIT_MAX);
            if !u.is_empty() {
                j.insert("unit".into(), json!(u));
            }
        }
        out.push(OwnBase { name, expr: e, each, json: Value::Object(j) });
        if out.len() >= OWN_MAX {
            break;
        }
    }
    Some(out)
}

/// 使える名前（決まった数＋作った数）
pub fn names_of(own: &[OwnBase]) -> Vec<String> {
    let mut v = fixed_names();
    v.extend(own.iter().map(|o| o.name.clone()));
    v
}

fn vars_in(expr: &str) -> Vec<String> {
    num_expr::var_names(&num_expr::normalize(expr))
}

/// 値が使う基準の数 → (決まった数, 作った数の名前)
pub fn uses(ms: &[Map<String, Value>], own: &[OwnBase]) -> (BTreeSet<String>, BTreeSet<String>) {
    let mut want: BTreeSet<String> = BTreeSet::new();
    for m in ms {
        let s = |k: &str| m.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        if s("agg") == "base" {
            want.insert(s("base"));
        }
        if !s("per").is_empty() {
            want.insert(s("per"));
        }
        if !s("expr").is_empty() {
            want.extend(vars_in(&s("expr")));
        }
    }
    let mut fixed: BTreeSet<String> = want.iter().filter(|w| FIXED.contains(&w.as_str())).cloned().collect();
    let mine: BTreeSet<String> = want.iter().filter(|w| own.iter().any(|o| &o.name == *w)).cloned().collect();
    for o in own.iter().filter(|o| mine.contains(&o.name)) {
        fixed.extend(vars_in(o.json["expr"].as_str().unwrap_or("")).into_iter().filter(|v| FIXED.contains(&v.as_str())));
    }
    if fixed.contains(PSHIFTS) {
        fixed.insert(PDAYS.into());
        fixed.insert(SPD.into());
    }
    (fixed, mine)
}

fn date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok().filter(|_| s.len() == 10)
}

fn days(a: &str, b: &str) -> i64 {
    match (date(a), date(b)) {
        (Some(x), Some(y)) => (y - x).num_days() + 1,
        _ => 0,
    }
}

/// 日の段の鍵 → (はじめ, おわり)（Python の key_span）
pub fn key_span(part: &str, key: &str) -> Option<(String, String)> {
    if key.is_empty() {
        return None;
    }
    match part {
        "" | "date" => date(key).map(|_| (key.to_string(), key.to_string())),
        "ym" => {
            let y: i32 = key.get(..4)?.parse().ok()?;
            let m: u32 = key.get(5..7)?.parse().ok()?;
            let first = NaiveDate::from_ymd_opt(y, m, 1)?;
            let nxt = if m == 12 { NaiveDate::from_ymd_opt(y + 1, 1, 1)? } else { NaiveDate::from_ymd_opt(y, m + 1, 1)? };
            Some((first.format("%Y-%m-%d").to_string(), (nxt - Days::days(1)).format("%Y-%m-%d").to_string()))
        }
        "year" => {
            let y: i32 = key.parse().ok()?;
            Some((format!("{y:04}-01-01"), format!("{y:04}-12-31")))
        }
        _ => None,
    }
}

/// 足す設備 1 つ
pub struct Unit {
    pub pi: usize,
    pub name: String,
    pub spd: Option<i64>,
    names: Option<Vec<String>>,
    pub range: Option<(String, String)>,
    pub ekeys: Vec<String>,
}

#[derive(Default)]
struct Stat {
    per: Vec<(usize, HashSet<(u32, i64)>, HashSet<u32>)>,
    span: Option<(u32, u32)>,
}

/// セルの鍵（pivot の鍵: [行の段の数, 列の段の数, 行の鍵の番号…, 列の鍵の番号…]）
pub type Key = Vec<u32>;
/// セルの数（名前 → 数か None）
pub type Env = HashMap<String, Option<N>>;

/// セルごと・設備ごとに（作業日, 直）と作業日をためる係（Python の Cells）
pub struct Cells {
    pub fixed: BTreeSet<String>,
    pub own: Vec<OwnBase>,
    dims: Vec<(String, String)>,
    nr: usize,
    by_name: bool,
    pub units: Vec<Unit>,
    unit_at: HashMap<(usize, String), usize>,
    stats: Vec<Stat>,
    at: HashMap<Key, usize>,
    day_ids: HashMap<String, u32>,
    day_text: Vec<String>,
    clip: Vec<usize>,
    shift_dims: Vec<usize>,
    pub equip_dims: Vec<usize>,
    pub hidden: HashSet<usize>,
}

impl Cells {
    /// dims … (列, まとめ方) の並び（行の段が先）・period_col … 期間の列（無ければ ""）
    pub fn new(fixed: BTreeSet<String>, mine: &BTreeSet<String>, own: &[OwnBase], dims: Vec<(String, String)>, nr: usize, period_col: &str, by_name: bool) -> Cells {
        let clip = dims
            .iter()
            .enumerate()
            .filter(|(_, (c, p))| {
                !period_col.is_empty()
                    && ((period_col == "@workday" && c == "@workday") || (c == period_col && ["date", "ym", "year"].contains(&p.as_str())))
            })
            .map(|(i, _)| i)
            .collect();
        let shift_dims = dims.iter().enumerate().filter(|(_, (c, _))| c == "@shift").map(|(i, _)| i).collect();
        let equip_dims = dims.iter().enumerate().filter(|(_, (c, _))| c == "@equip" || c == "@egroup").map(|(i, _)| i).collect();
        Cells {
            fixed,
            own: own.iter().filter(|o| mine.contains(&o.name)).cloned().collect(),
            dims,
            nr,
            by_name,
            units: vec![],
            unit_at: HashMap::new(),
            stats: vec![],
            at: HashMap::new(),
            day_ids: HashMap::new(),
            day_text: vec![],
            clip,
            shift_dims,
            equip_dims,
            hidden: HashSet::new(),
        }
    }

    /// 設備の番号（無ければ足す）。segments … 勤務体系の直の名前（作業実績でなければ None）
    pub fn unit(&mut self, pi: usize, name: &str, segments: Option<Vec<String>>, range: Option<(String, String)>) -> usize {
        if let Some(&u) = self.unit_at.get(&(pi, name.to_string())) {
            return u;
        }
        let u = self.units.len();
        self.unit_at.insert((pi, name.to_string()), u);
        self.units.push(Unit { pi, name: name.into(), spd: segments.as_ref().map(|s| s.len() as i64), names: segments, range, ekeys: vec![] });
        u
    }

    /// 1 行を 1 つのセルに足す。day … 作業日（無ければ ""）・idx … 直の番号（分からなければ負）
    pub fn add(&mut self, key: &[u32], u: usize, day: &str, idx: i64) {
        let at = match self.at.get(key) {
            Some(&i) => i,
            None => {
                self.at.insert(key.to_vec(), self.stats.len());
                self.stats.push(Stat::default());
                self.stats.len() - 1
            }
        };
        let did = if day.is_empty() {
            None
        } else {
            Some(match self.day_ids.get(day) {
                Some(&d) => d,
                None => {
                    let d = self.day_text.len() as u32;
                    self.day_ids.insert(day.to_string(), d);
                    self.day_text.push(day.to_string());
                    d
                }
            })
        };
        let st = &mut self.stats[at];
        let e = match st.per.iter().position(|x| x.0 == u) {
            Some(i) => i,
            None => {
                st.per.push((u, HashSet::new(), HashSet::new()));
                st.per.len() - 1
            }
        };
        let Some(d) = did else { return };
        st.per[e].2.insert(d);
        if idx >= 0 {
            st.per[e].1.insert((d, idx));
        }
        let t = &self.day_text;
        st.span = Some(match st.span {
            None => (d, d),
            Some((lo, hi)) => (if t[d as usize] < t[lo as usize] { d } else { lo }, if t[d as usize] > t[hi as usize] { d } else { hi }),
        });
    }

    /// セルの最初と最後の日（Python の span）
    pub fn spans(&self) -> Vec<(&Key, (String, String))> {
        self.at
            .iter()
            .filter_map(|(k, &i)| self.stats[i].span.map(|(a, b)| (k, (self.day_text[a as usize].clone(), self.day_text[b as usize].clone()))))
            .collect()
    }

    fn key_at(&self, key: &[u32], i: usize, name_of: &dyn Fn(usize, u32) -> String) -> Option<String> {
        let (ra, cb) = (key[0] as usize, key[1] as usize);
        if i < self.nr {
            (i < ra).then(|| name_of(i, key[2 + i]))
        } else {
            let j = i - self.nr;
            (j < cb).then(|| name_of(i, key[2 + ra + j]))
        }
    }

    fn members(&self, key: &[u32], name_of: &dyn Fn(usize, u32) -> String) -> Vec<usize> {
        let fixed: Vec<(usize, String)> =
            self.equip_dims.iter().enumerate().filter_map(|(x, &i)| self.key_at(key, i, name_of).map(|k| (x, k))).collect();
        (0..self.units.len()).filter(|j| !self.hidden.contains(j) && fixed.iter().all(|(x, k)| &self.units[*j].ekeys[*x] == k)).collect()
    }

    fn spd(&self, u: &Unit, key: &[u32], name_of: &dyn Fn(usize, u32) -> String) -> Option<i64> {
        let spd = u.spd?;
        let sk: Vec<String> = self.shift_dims.iter().filter_map(|&i| self.key_at(key, i, name_of)).collect();
        if sk.is_empty() {
            return Some(spd);
        }
        let names = u.names.as_ref()?;
        Some(
            names
                .iter()
                .enumerate()
                .filter(|(idx, nm)| {
                    let mine = if self.by_name { nm.to_string() } else { idx.to_string() };
                    sk.iter().all(|k| *k == mine)
                })
                .count() as i64,
        )
    }

    fn clipped(&self, u: &Unit, key: &[u32], name_of: &dyn Fn(usize, u32) -> String) -> Option<(String, String)> {
        let (mut lo, mut hi) = u.range.clone()?;
        for &i in &self.clip {
            let Some(k) = self.key_at(key, i, name_of) else { continue };
            let (a, b) = key_span(&self.dims[i].1, &k)?;
            if a > lo {
                lo = a;
            }
            if b < hi {
                hi = b;
            }
        }
        (lo <= hi).then_some((lo, hi))
    }

    fn pdays(&self, u: &Unit, key: &[u32], name_of: &dyn Fn(usize, u32) -> String) -> Option<i64> {
        u.range.as_ref()?;
        Some(self.clipped(u, key, name_of).map(|(a, b)| days(&a, &b)).unwrap_or(0))
    }

    /// セルの鍵 → 名前 → 数（Python の env）。name_of(段, 鍵の番号) → 鍵の字
    pub fn env(&self, key: &[u32], name_of: &dyn Fn(usize, u32) -> String) -> Env {
        let st = self.at.get(key).map(|&i| &self.stats[i]);
        let mem = self.members(key, name_of);
        let cell_span = st.and_then(|s| s.span).map(|(a, b)| days(&self.day_text[a as usize], &self.day_text[b as usize])).unwrap_or(0);
        let mut per: Vec<Env> = vec![];
        for &j in &mem {
            let u = &self.units[j];
            let (sh, dy) = st
                .and_then(|s| s.per.iter().find(|x| x.0 == j))
                .map(|x| (x.1.len() as i64, x.2.len() as i64))
                .unwrap_or((0, 0));
            let spd = self.spd(u, key, name_of);
            let pd = self.pdays(u, key, name_of).unwrap_or(cell_span);
            let mut e = Env::new();
            e.insert(SHIFTS.into(), Some(N::I(sh)));
            e.insert(DAYS.into(), Some(N::I(dy)));
            e.insert(SPD.into(), spd.map(N::I));
            e.insert(PDAYS.into(), Some(N::I(pd)));
            e.insert(PSHIFTS.into(), spd.map(|s| N::I(pd * s)));
            per.push(e);
        }
        let int = |e: &Env, k: &str| match e.get(k) {
            Some(Some(N::I(i))) => Some(*i),
            _ => None,
        };
        let mut out = Env::new();
        out.insert(SHIFTS.into(), Some(N::I(per.iter().map(|e| int(e, SHIFTS).unwrap_or(0)).sum())));
        out.insert(DAYS.into(), Some(N::I(per.iter().map(|e| int(e, DAYS).unwrap_or(0)).sum())));
        let mut spds: Vec<Option<i64>> = vec![];
        for e in &per {
            let v = int(e, SPD);
            if !spds.contains(&v) {
                spds.push(v);
            }
        }
        out.insert(SPD.into(), if spds.len() == 1 { spds[0].map(N::I) } else { None });
        if mem.iter().any(|&j| self.units[j].range.is_some()) {
            let mut spans: Vec<(String, String)> = mem.iter().filter_map(|&j| self.clipped(&self.units[j], key, name_of)).collect();
            spans.sort();
            let (mut n, mut end): (i64, Option<String>) = (0, None);
            for (lo, hi) in spans {
                match &end {
                    Some(e) if lo <= *e => {
                        if hi > *e {
                            n += days(e, &hi) - 1;
                            end = Some(hi);
                        }
                    }
                    _ => {
                        n += days(&lo, &hi);
                        end = Some(hi);
                    }
                }
            }
            out.insert(PDAYS.into(), Some(N::I(n)));
        } else {
            out.insert(PDAYS.into(), Some(N::I(cell_span)));
        }
        let ps = if per.is_empty() || per.iter().any(|e| int(e, PSHIFTS).is_none()) {
            None
        } else {
            Some(N::I(per.iter().map(|e| int(e, PSHIFTS).unwrap_or(0)).sum()))
        };
        out.insert(PSHIFTS.into(), ps);
        for o in &self.own {
            let look = |e: &Env| {
                let e = e.clone();
                move |k: &str| e.get(k).copied().flatten().map(N::f)
            };
            let v = if o.each {
                let vals: Vec<Option<f64>> = per.iter().map(|e| o.expr.apply_env(0.0, &look(e))).collect();
                if vals.is_empty() || vals.iter().any(Option::is_none) {
                    None
                } else {
                    Some(N::sum(vals.into_iter().map(|v| N::F(v.unwrap_or(0.0)))))
                }
            } else {
                o.expr.apply_env(0.0, &look(&out)).map(N::F)
            };
            out.insert(o.name.clone(), v);
        }
        out
    }
}
