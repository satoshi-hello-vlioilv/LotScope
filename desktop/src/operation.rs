//! 設備の稼働（版 3.63.0。Python の services/operation.py と同じ答え）: 作業実績の作業開始・作業終了から、設備ごとの稼働の区間（ガントチャート）・
//! 勤務時間・稼働率と、品種ごとの ABC 分析・換算係数・全設備のリードタイム・基準の期間での換算を数える。決まりの説明は Python の operation.py の冒頭。
//! 数は Python と同じく整数と小数を分けて持つ（空の和は 0・round(整数) は整数）。和は Python 3.13 の sum と同じ足し方（aggregate::N::sum。小数だけの和は aggregate::py_sum）。
//! 答えが同じことは desktop/tests/ops_parity.rs（← program/tests/ops_oracle.py）と dash_parity.rs の稼働の組で確かめる。

use crate::aggregate::{py_round, py_sum, N};
use crate::formula::{Calc, Tables};
use crate::lotlist::{self, qi, sql_err, Exprs};
use crate::pivot::{self, Fail, Part};
use crate::pyfmt::{self, Py};
use crate::worksum::{self, hm, Clock, Own, Segment};
use chrono::{Duration, NaiveDate, NaiveDateTime, NaiveTime};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Arc;

pub const MAX_HOURS: i64 = 168;
pub const MAX_OPS: usize = 1500;
pub const MAX_DAYS: i64 = 62;
const MAX_ROWS: i64 = 400_000;
pub const QTYS: &[&str] = &["lots", "time"];
pub const LEAD_AROUND_DAYS: i64 = 62;
pub const KEY_SEP: &str = "／";
const MAX_CLS: usize = 4;
const END_CANDIDATES: &[&str] = &["BOX実績_作業終了_日付"];
const SERIAL_RANGE: (f64, f64) = (20000.0, 80000.0);

type R<T> = Result<T, Fail>;

fn invalid<T>(m: impl Into<String>) -> R<T> {
    Err(Fail::Invalid(m.into()))
}

fn iso(t: NaiveDateTime) -> String {
    t.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn day0(d: NaiveDate) -> NaiveDateTime {
    d.and_time(NaiveTime::MIN)
}

fn ymd(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn date_of(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok()
}

fn mins(a: NaiveDateTime, b: NaiveDateTime) -> f64 {
    (b - a).num_seconds() as f64 / 60.0
}

/// 作業終了の列（Python の end_column）
pub fn end_column(cs: &[String], preferred: &str, start: &str) -> String {
    if !preferred.is_empty() && cs.iter().any(|c| c == preferred) {
        return preferred.into();
    }
    for c in END_CANDIDATES {
        if cs.iter().any(|x| x == c) {
            return c.to_string();
        }
    }
    if start.contains("開始") {
        let alt = start.replace("開始", "終了");
        if cs.contains(&alt) {
            return alt;
        }
    }
    cs.iter().find(|c| c.contains("作業終了") && (c.contains("日付") || c.contains("日時"))).cloned().unwrap_or_default()
}

/// 'YYYY-MM-DD HH:MM[:SS]' → 日時（時刻の無い日付・読めない字は None。Python の _dt）
fn dt_of(stamp: &str) -> Option<NaiveDateTime> {
    if stamp.chars().count() < 16 {
        return None;
    }
    NaiveDateTime::parse_from_str(stamp, "%Y-%m-%d %H:%M:%S").or_else(|_| NaiveDateTime::parse_from_str(stamp, "%Y-%m-%d %H:%M")).ok()
}

// ------------------------------------------------------------------ 勤務時間（直の時間帯）
/// 作業日 first〜last の勤務時間 → [(始め, 終わり, 区分の名前, 作業日)]（Python の shift_windows）
pub fn shift_windows(segments: &[Segment], first: &str, last: &str, basis: &str) -> Vec<(NaiveDateTime, NaiveDateTime, String, String)> {
    let clock = Clock::new(segments.to_vec());
    let (Some(lo), Some(hi)) = (date_of(first), date_of(last)) else { return vec![] };
    let mut out = vec![];
    let mut d = lo - Duration::days(1);
    while d <= hi + Duration::days(1) {
        let base = day0(d);
        for seg in segments {
            let (s, e) = (hm(&seg.start).unwrap_or(0) as i64, hm(&seg.end).unwrap_or(0) as i64);
            let a = base + Duration::minutes(s);
            let b = base + Duration::minutes(if e > s { e } else { e + 24 * 60 });
            let next = base + Duration::days(1);
            let pieces = if e > s { vec![(a, b)] } else { vec![(a, next), (next, b)] };
            for (x, y) in pieces {
                if x >= y {
                    continue;
                }
                let (day, _) = clock.place(&iso(x), basis);
                if first <= day.as_str() && day.as_str() <= last {
                    out.push((x, y, seg.name.clone(), day));
                }
            }
        }
        d += Duration::days(1);
    }
    out.sort_by_key(|w| w.0);
    out
}

/// 作業日 first〜last の区切り → [(始め, 終わり, 作業日)]（Python の work_days）
pub fn work_days(segments: &[Segment], first: &str, last: &str, basis: &str) -> Vec<(NaiveDateTime, NaiveDateTime, String)> {
    let clock = Clock::new(segments.to_vec());
    let (Some(lo), Some(hi)) = (date_of(first), date_of(last)) else { return vec![] };
    let mut marks: Vec<i64> = vec![0];
    if !segments.is_empty() && basis == "work" {
        for s in segments {
            marks.push(hm(&s.start).unwrap_or(0) as i64);
            marks.push(hm(&s.end).unwrap_or(0) as i64);
        }
    }
    marks.sort();
    marks.dedup();
    let begin = |d: NaiveDate| -> NaiveDateTime {
        for c in [d - Duration::days(1), d, d + Duration::days(1)] {
            for m in &marks {
                let t = day0(c) + Duration::minutes(*m);
                if clock.place(&iso(t), basis).0 == ymd(d) {
                    return t;
                }
            }
        }
        day0(d)
    };
    let (mut out, mut d) = (vec![], lo);
    while d <= hi {
        out.push((begin(d), begin(d + Duration::days(1)), ymd(d)));
        d += Duration::days(1);
    }
    out
}

/// 区間を重ねる（Python の merge）
fn merge(mut spans: Vec<(NaiveDateTime, NaiveDateTime)>) -> Vec<(NaiveDateTime, NaiveDateTime)> {
    spans.sort();
    let mut out: Vec<(NaiveDateTime, NaiveDateTime)> = vec![];
    for (a, b) in spans {
        match out.last_mut() {
            Some(l) if a <= l.1 => {
                if b > l.1 {
                    l.1 = b;
                }
            }
            _ => out.push((a, b)),
        }
    }
    out
}

fn overlap_minutes(spans: &[(NaiveDateTime, NaiveDateTime)], a: NaiveDateTime, b: NaiveDateTime) -> f64 {
    let mut t = 0.0;
    for (x, y) in spans {
        let (lo, hi) = ((*x).max(a), (*y).min(b));
        if hi > lo {
            t += mins(lo, hi);
        }
    }
    t
}

/// 作業と勤務時間 → 稼働率の答え（Python の utilization）
fn utilization(
    ops: &[Op],
    windows: &[(NaiveDateTime, NaiveDateTime, String, String)],
    clip: Option<(NaiveDateTime, NaiveDateTime)>,
) -> Map<String, Value> {
    let mut spans = merge(ops.iter().filter_map(|o| Some((o.start?, o.end?))).collect());
    if let Some((c0, c1)) = clip {
        spans = spans.into_iter().filter(|(a, b)| *b > c0 && *a < c1).map(|(a, b)| (a.max(c0), b.min(c1))).collect();
    }
    let shift_min = N::sum(windows.iter().map(|(a, b, _, _)| N::F(mins(*a, *b))));
    let mut by: Vec<((String, String), f64, f64)> = vec![];
    for (a, b, name, day) in windows {
        let k = (day.clone(), name.clone());
        let i = match by.iter().position(|x| x.0 == k) {
            Some(i) => i,
            None => {
                by.push((k, 0.0, 0.0));
                by.len() - 1
            }
        };
        by[i].1 += mins(*a, *b);
        by[i].2 += overlap_minutes(&spans, *a, *b);
    }
    let busy = N::sum(by.iter().map(|x| N::F(x.2)));
    let total = N::sum(spans.iter().map(|(a, b)| N::F(mins(*a, *b))));
    let rows: Vec<Value> = by
        .iter()
        .map(|((day, shift), m, b)| {
            json!({"day": day, "shift": shift, "min": py_round(*m, 2), "busy": py_round(*b, 2),
                   "rate": if *m != 0.0 { json!(py_round(b / m, 4)) } else { Value::Null }})
        })
        .collect();
    let outside = (total.f() - busy.f()).max(0.0);
    let mut out = Map::new();
    out.insert("shiftMin".into(), shift_min.round(2).json());
    out.insert("busyMin".into(), busy.round(2).json());
    out.insert("outsideMin".into(), json!(py_round(outside, 2)));
    out.insert("rate".into(), if shift_min.f() != 0.0 { json!(py_round(busy.f() / shift_min.f(), 4)) } else { Value::Null });
    out.insert("byShift".into(), json!(rows));
    out
}

// ------------------------------------------------------------------ 作業を読む
/// 作業 1 本（Python の read_ops の ops の 1 つ）
#[derive(Debug, Clone)]
pub struct Op {
    pub key: String,
    pub start: Option<NaiveDateTime>,
    pub end: Option<NaiveDateTime>,
    pub n: i64,
    pub values: HashMap<String, Own>,
    pub nums: HashMap<String, f64>,
    pub why: String,
    pub carry: bool,
    pub after: bool,
    pub running: bool,
    /// ロット番号 → その行の列の値（入った順）
    pub lots: Vec<(String, HashMap<String, Own>)>,
    pub steps: i64,
}

/// 1 設備を読んだ答え（Python の read_ops の答え）
pub struct Read {
    pub ops: Vec<Op>,
    pub start: String,
    pub end: String,
    pub range: Option<(String, String)>,
    pub lot: String,
}

/// 読む引数（Python の read_ops の引数）
pub struct ReadArgs<'a> {
    pub search: &'a str,
    pub filters: &'a str,
    pub today: NaiveDate,
    pub calc: Option<&'a Calc>,
    pub conv: &'a Arc<Tables>,
    pub period: Option<&'a Value>,
    pub now: NaiveDateTime,
    pub end: &'a str,
    pub start: &'a str,
    pub cols: Vec<String>,
    pub reach: bool,
    pub lots: bool,
    pub around: i64,
}

fn stamp_columns(cs: &[String], first: &str, word: &str) -> Vec<(String, String)> {
    let mut names: Vec<String> = vec![];
    for c in std::iter::once(first.to_string())
        .chain(cs.iter().filter(|c| *c != first && c.contains(word) && ["日付", "日時", "時分秒"].iter().any(|k| c.contains(k))).cloned())
    {
        if !c.is_empty() && !names.contains(&c) {
            names.push(c);
        }
    }
    names.into_iter().map(|c| (c.clone(), worksum::time_column(cs, &c))).collect()
}

/// 日時の数（1899/12/30 からの日数）→ 日時の字（Python の _serial）
fn serial(v: &Py) -> Option<String> {
    let f = match *v {
        Py::Int(i) => i as f64,
        Py::Float(f) => f,
        Py::Text(t) => {
            let f = pyfmt::py_float(t).ok()?;
            if !t.contains('.') {
                return None;
            }
            f
        }
        _ => return None,
    };
    if !(SERIAL_RANGE.0 <= f && f < SERIAL_RANGE.1) {
        return None;
    }
    let secs = (f * 86400.0).round_ties_even() as i64;
    Some(iso(day0(NaiveDate::from_ymd_opt(1899, 12, 30)?) + Duration::seconds(secs)))
}

fn blank(v: &Py) -> bool {
    match *v {
        Py::None => true,
        Py::Text(t) => pyfmt::strip(t).is_empty(),
        _ => false,
    }
}

/// 列の組の値 → (日時, 日付だけの字, 読めなかった訳)（Python の read_stamp）
fn read_stamp(vals: &[(Py, Py)]) -> (Option<NaiveDateTime>, String, &'static str) {
    let (mut day, mut why) = (String::new(), "blank");
    for (v, t) in vals {
        if blank(v) {
            continue;
        }
        let texty = matches!(v, Py::Text(_));
        let mut stamp = if texty || t.truthy() { pyfmt::to_datetime(v, t) } else { serial(v).or_else(|| pyfmt::to_datetime(v, t)) };
        if let (Some(s), Py::Text(tx)) = (&stamp, v) {
            if s.chars().count() == 10 && tx.contains('.') {
                stamp = serial(v).or(stamp);
            }
        }
        let s = stamp.unwrap_or_default();
        if let Some(d) = dt_of(&s) {
            return (Some(d), s.chars().take(10).collect(), "");
        }
        if !s.is_empty() {
            if day.is_empty() {
                day = s;
            }
            why = "notime";
        } else if why == "blank" {
            why = "unread";
        }
    }
    (None, day, why)
}

fn why_rank(w: &str) -> i32 {
    match w {
        "blank" => 1,
        "unread" => 2,
        "notime" => 3,
        _ => 0,
    }
}

fn py_float_of(v: &Own) -> Option<f64> {
    match v {
        Own::Int(i) => Some(*i as f64),
        Own::Float(f) => Some(*f),
        Own::Text(t) => pyfmt::py_float(t).ok(),
        Own::Blob(b) => std::str::from_utf8(b).ok().and_then(|t| pyfmt::py_float(t).ok()),
        Own::None => None,
    }
}

/// 1 設備のファイル → 作業の並び（Python の read_ops）
pub fn read_ops(part: &Part, a: &ReadArgs) -> R<Read> {
    let down = |e: String| Fail::Down(e);
    let (clock, basis) = match &part.work {
        Some(w) => (w.clock.clone(), w.basis.clone()),
        None => (Clock::new(vec![]), "work".to_string()),
    };
    let back = Duration::hours(MAX_HOURS) + Duration::days(1);
    let c = lotlist::connect_ro(&part.path).map_err(down)?;
    let names = lotlist::tables(&c).map_err(down)?;
    let t =
        if names.contains(&part.table) { part.table.clone() } else { lotlist::pick_table(&names, &part.preferred_table, part.candidates) };
    if t.is_empty() {
        return invalid("表が 1 つもありません。");
    }
    let raw = lotlist::dedup(&lotlist::raw_columns(&c, &t).map_err(down)?);
    let (exprs, calcs, broken) = pivot::calc_exprs_pub(&c, a.calc, &raw, a.conv)?;
    let mut cs = raw.clone();
    cs.extend(calcs.iter().filter(|x| exprs.contains_key(*x) && !raw.contains(x)).cloned());
    let start =
        worksum::start_column(&cs, if a.start.is_empty() { part.work.as_ref().map(|w| w.start.as_str()).unwrap_or("") } else { a.start });
    if start.is_empty() {
        return invalid("作業開始の列がありません（作業実績だけで使えます。組む所の「作業開始」で選んでください）。");
    }
    let stop = end_column(&cs, a.end, &start);
    if stop.is_empty() {
        return invalid("作業終了の列が見つかりません（組む所の「作業終了の列」で選んでください）。");
    }
    let (s_cols, e_cols) = (stamp_columns(&cs, &start, "作業開始"), stamp_columns(&cs, &stop, "作業終了"));
    let lot = lotlist::lot_column(&cs, part.lot_col.as_deref());
    let mut want: Vec<String> = vec![];
    for x in a.cols.iter().chain(std::iter::once(&lot)) {
        if !x.is_empty() && cs.contains(x) && !want.contains(x) {
            want.push(x.clone());
        }
    }
    let bad: Vec<&String> = want.iter().filter(|x| broken.contains(x)).collect();
    if !bad.is_empty() {
        return invalid(format!(
            "計算列「{}」の式が読めません（一覧の「表示列」で式を直してください）。",
            bad.iter().map(|x| x.as_str()).collect::<Vec<_>>().join("」「")
        ));
    }
    let (mut where_parts, mut params) = lotlist::search_filter_where(&raw, a.search, a.filters, a.today, &exprs).map_err(down)?;
    let mut span: Option<(String, String)> = None;
    let period = match a.period {
        Some(p) => pivot::clean_period(Some(p))?,
        None => None,
    };
    if let Some(p) = &period {
        let now_s = iso(a.now);
        let day = if p.column == "@workday" { clock.place(&now_s, &basis).0 } else { ymd(a.now.date()) };
        let sp = pivot::period_range(p, if day.is_empty() { &now_s[..10] } else { &day })?;
        let pcol = if p.column == "@workday" { start.clone() } else { p.column.clone() };
        if !cs.contains(&pcol) {
            return invalid(format!("期間で絞る列「{pcol}」がありません。"));
        }
        if raw.contains(&pcol) {
            let d0 = date_of(&sp.0).unwrap_or(a.today);
            let lo = if a.reach || a.around > 0 {
                ymd(d0 - if a.around > 0 { Duration::days(a.around) } else { Duration::days(back.num_days()) })
            } else {
                sp.0.clone()
            };
            let hi = if a.around > 0 { ymd(date_of(&sp.1).unwrap_or(a.today) + Duration::days(a.around)) } else { sp.1.clone() };
            if let Some((w, wp)) = pivot::period_prefilter_pub(&pcol, Some(&(lo, hi))) {
                where_parts.push(w);
                params.extend(wp);
            }
        }
        span = Some(sp);
    }
    let wh = if where_parts.is_empty() { String::new() } else { format!(" WHERE {}", where_parts.join(" AND ")) };
    let n: i64 = c
        .query_row(&format!("SELECT COUNT(*) FROM {}{wh}", qi(&t)), rusqlite::params_from_iter(params.iter()), |r| r.get(0))
        .map_err(|e| down(sql_err(e)))?;
    if n > MAX_ROWS {
        return invalid(format!(
            "当たる行が多すぎます（{} 行。{} 行まで）。期間・条件で絞ってください。",
            pivot::commas_pub(n),
            pivot::commas_pub(MAX_ROWS)
        ));
    }
    let pc = match &period {
        Some(p) if p.column != "@workday" && p.column != start => p.column.clone(),
        _ => String::new(),
    };
    let mut sel: Vec<String> = vec![];
    for (x, y) in s_cols.iter().chain(e_cols.iter()) {
        sel.push(x.clone());
        sel.push(y.clone());
    }
    sel.extend(want.iter().cloned());
    if !pc.is_empty() {
        sel.push(pc.clone());
    }
    let sql_of = |x: &String| if x.is_empty() { "NULL".to_string() } else { exprs_get(&exprs, x).unwrap_or_else(|| qi(x)) };
    let sql = format!("SELECT {} FROM {}{wh}", sel.iter().map(sql_of).collect::<Vec<_>>().join(", "), qi(&t));
    let mut stmt = c.prepare(&sql).map_err(|e| down(sql_err(e)))?;
    let width = sel.len();
    let rows: Vec<Vec<Own>> = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |r| (0..width).map(|i| r.get_ref(i).map(Own::of_ref)).collect())
        .map_err(|e| down(sql_err(e)))?
        .collect::<Result<_, _>>()
        .map_err(|e| down(sql_err(e)))?;
    let (ns, ne) = (s_cols.len() * 2, e_cols.len() * 2);
    let pairs = |row: &[Own], at: usize, k: usize| -> Vec<(Own, Own)> {
        (0..k).map(|i| (row[at + 2 * i].clone(), row[at + 2 * i + 1].clone())).collect()
    };
    let lo_carry = match &span {
        Some(sp) if a.reach || a.around > 0 => {
            ymd(date_of(&sp.0).unwrap() - if a.around > 0 { Duration::days(a.around) } else { Duration::days(back.num_days()) })
        }
        _ => String::new(),
    };
    let hi_after = match &span {
        Some(sp) if a.around > 0 => ymd(date_of(&sp.1).unwrap() + Duration::days(a.around)),
        _ => String::new(),
    };
    let mut ops: Vec<Op> = vec![];
    let mut at: HashMap<String, usize> = HashMap::new();
    let mut last_any: Option<NaiveDateTime> = None;
    for row in &rows {
        let sp_pairs = pairs(row, 0, s_cols.len());
        let sv: Vec<(Py, Py)> = sp_pairs.iter().map(|(x, y)| (x.py(), y.py())).collect();
        let (s_dt, s_day, _) = read_stamp(&sv);
        let stamp = s_dt.map(iso).unwrap_or(s_day);
        if let Some(s) = s_dt {
            if last_any.is_none_or(|l| s > l) {
                last_any = Some(s);
            }
        }
        let (mut carry, mut after) = (false, false);
        if let Some(sp) = &span {
            let day = if !pc.is_empty() {
                pyfmt::to_datetime(&row[ns + ne + want.len()].py(), &Py::None).unwrap_or_default().chars().take(10).collect::<String>()
            } else if stamp.is_empty() {
                String::new()
            } else {
                clock.place(&stamp, &basis).0
            };
            if day.is_empty() {
                continue;
            }
            if !(sp.0 <= day && day <= sp.1) {
                if (a.reach || a.around > 0) && lo_carry <= day && day < sp.0 && s_dt.is_some() {
                    carry = true;
                } else if a.around > 0 && sp.1 < day && day <= hi_after && s_dt.is_some() {
                    after = true;
                } else {
                    continue;
                }
            }
        }
        let mut k = if s_dt.is_some() { stamp.clone() } else { worksum::work_key(&row[0].py(), &row[1].py()) };
        if k.is_empty() {
            k = format!("#{}", ops.len());
        }
        let i = match at.get(&k) {
            Some(i) => *i,
            None => {
                ops.push(Op {
                    key: k.clone(),
                    start: s_dt,
                    end: None,
                    n: 0,
                    values: HashMap::new(),
                    nums: HashMap::new(),
                    why: if s_dt.is_some() { String::new() } else { "nostart".into() },
                    carry,
                    after,
                    running: false,
                    lots: vec![],
                    steps: 0,
                });
                at.insert(k, ops.len() - 1);
                ops.len() - 1
            }
        };
        let o = &mut ops[i];
        o.n += 1;
        let ep = pairs(row, ns, e_cols.len());
        let ev: Vec<(Py, Py)> = ep.iter().map(|(x, y)| (x.py(), y.py())).collect();
        let (mut e, _, why) = read_stamp(&ev);
        if let (Some(ee), Some(ss)) = (e, o.start) {
            if ee < ss && ee.date() == ss.date() {
                e = Some(ee + Duration::days(1));
            }
        }
        if e.is_some() && (o.end.is_none() || e > o.end) {
            o.end = e;
        } else if e.is_none() && o.end.is_none() && why_rank(why) > why_rank(&o.why) {
            o.why = why.into();
        }
        if a.lots && !lot.is_empty() {
            let lv = &row[ns + ne + want.iter().position(|x| *x == lot).unwrap_or(0)];
            let ln = if lv.py().truthy() { pyfmt::strip(&lv.py().py_str()).to_string() } else { String::new() };
            if !ln.is_empty() && !o.lots.iter().any(|(x, _)| *x == ln) {
                let vals = want.iter().enumerate().map(|(j, col)| (col.clone(), row[ns + ne + j].clone())).collect();
                o.lots.push((ln, vals));
            }
        }
        for (j, col) in want.iter().enumerate() {
            let v = &row[ns + ne + j];
            o.values.entry(col.clone()).or_insert_with(|| v.clone());
            if let Some(f) = py_float_of(v) {
                *o.nums.entry(col.clone()).or_insert(0.0) += f;
            }
        }
    }
    for o in ops.iter_mut() {
        match (o.start, o.end) {
            (None, _) => {
                o.end = None;
                o.why = "nostart".into();
            }
            (Some(s), Some(e)) => {
                o.why = if e <= s {
                    "before".into()
                } else if e - s > Duration::hours(MAX_HOURS) {
                    "long".into()
                } else {
                    String::new()
                };
                if !o.why.is_empty() {
                    o.end = None;
                }
            }
            (Some(_), None) => {
                if o.why.is_empty() {
                    o.why = "blank".into();
                }
            }
        }
    }
    ops.sort_by_key(|o| (o.start.is_none(), o.start.unwrap_or(NaiveDateTime::MIN)));
    if a.reach {
        if let Some(newest) = ops.iter_mut().rev().find(|o| o.start.is_some()) {
            let s = newest.start.unwrap();
            let age = a.now - s;
            if newest.end.is_none()
                && newest.why == "blank"
                && Some(s) == last_any
                && age > Duration::zero()
                && age <= Duration::hours(MAX_HOURS)
            {
                newest.end = Some(a.now);
                newest.running = true;
                newest.why = String::new();
            }
        }
        ops.retain(|o| !(o.carry && o.end.is_none()));
    }
    Ok(Read { ops, start, end: stop, range: span, lot })
}

fn exprs_get(exprs: &Exprs, x: &str) -> Option<String> {
    exprs.get(x).cloned()
}

pub fn minutes(o: &Op) -> Option<f64> {
    match (o.start, o.end) {
        (Some(s), Some(e)) if !o.running => Some(mins(s, e)),
        _ => None,
    }
}

fn why_text(k: &str) -> String {
    match k {
        "blank" => "作業終了が空".into(),
        "notime" => "作業終了に時刻が無い".into(),
        "unread" => "作業終了が日時と読めない".into(),
        "before" => "作業終了が作業開始より前".into(),
        "long" => format!("{} 日より長い", MAX_HOURS / 24),
        "nostart" => "作業開始が日時と読めない".into(),
        "last" => "最後の作業の作業終了が空".into(),
        x => x.into(),
    }
}

/// 区間を出せない作業の理由ごとの数（Python の reasons。多い順）
fn reasons<'a>(ops: impl IntoIterator<Item = &'a Op>) -> Value {
    let mut by: Vec<(String, i64)> = vec![];
    for o in ops {
        if o.end.is_none() && !o.why.is_empty() {
            match by.iter_mut().find(|x| x.0 == o.why) {
                Some(x) => x.1 += 1,
                None => by.push((o.why.clone(), 1)),
            }
        }
    }
    by.sort_by_key(|x| -x.1);
    let mut m = Map::new();
    for (k, n) in by {
        m.insert(why_text(&k), json!(n));
    }
    Value::Object(m)
}

// ------------------------------------------------------------------ ガントチャート
fn view_of(read: &Read, days: &[(NaiveDateTime, NaiveDateTime, String)]) -> Option<(NaiveDateTime, NaiveDateTime)> {
    if let (Some(f), Some(l)) = (days.first(), days.last()) {
        return Some((f.0, l.1));
    }
    let (a, b) = read.range.as_ref()?;
    Some((day0(date_of(a)?), day0(date_of(b)?) + Duration::days(1)))
}

fn text_of(v: Option<&Own>) -> String {
    match v {
        None => "None".into(),
        Some(x) => x.py().py_str(),
    }
}

/// 1 台の答え（Python の gantt）
pub fn gantt(
    name: &str,
    read: &Read,
    windows: &[(NaiveDateTime, NaiveDateTime, String, String)],
    label: &str,
    color: &str,
    days: &[(NaiveDateTime, NaiveDateTime, String)],
) -> Map<String, Value> {
    let view = view_of(read, days);
    let mine: Vec<&Op> = read.ops.iter().filter(|o| !o.carry).collect();
    let mut out = Map::new();
    out.insert("name".into(), json!(name));
    out.extend(utilization(&read.ops, windows, view));
    let mut bars = vec![];
    for o in &read.ops {
        let (Some(s), Some(e)) = (o.start, o.end) else { continue };
        if let Some((v0, v1)) = view {
            if e <= v0 || s >= v1 {
                continue;
            }
        }
        if bars.len() < MAX_OPS {
            let text = if label.is_empty() { String::new() } else { text_of(o.values.get(label)) };
            let col = if color.is_empty() {
                String::new()
            } else {
                match o.values.get(color) {
                    Some(v) if v.py().truthy() => v.py().py_str(),
                    _ => String::new(),
                }
            };
            bars.push(json!([
                iso(s),
                iso(e),
                if text == "None" { String::new() } else { text },
                col,
                o.n,
                if o.running {
                    "r"
                } else if o.carry {
                    "c"
                } else {
                    ""
                }
            ]));
        }
    }
    out.insert("ops".into(), json!(bars));
    out.insert("windows".into(), json!(windows.iter().map(|(a, b, s, d)| json!([iso(*a), iso(*b), s, d])).collect::<Vec<_>>()));
    out.insert("view".into(), view.map(|(a, b)| json!([iso(a), iso(b)])).unwrap_or(Value::Null));
    out.insert("days".into(), json!(days.iter().map(|(a, b, d)| json!([iso(*a), iso(*b), d])).collect::<Vec<_>>()));
    out.insert("noEnd".into(), json!(mine.iter().filter(|o| o.end.is_none()).count()));
    out.insert("why".into(), reasons(mine.iter().copied()));
    out.insert("count".into(), json!(mine.len()));
    out.insert("carry".into(), json!(read.ops.iter().filter(|o| o.carry).count()));
    out.insert("truncated".into(), json!(read.ops.iter().filter(|o| o.end.is_some()).count() > MAX_OPS));
    out
}

// ------------------------------------------------------------------ 全設備のリードタイム
fn nums_of(vals: &HashMap<String, Own>) -> HashMap<String, f64> {
    vals.iter().filter_map(|(k, v)| py_float_of(v).map(|f| (k.clone(), f))).collect()
}

/// 1 本のロットが通った作業と、その作業でのロットの値
type Passes<'a> = Vec<(&'a Op, &'a HashMap<String, Own>)>;

/// 設備ごとの読んだ答え → ロットごとの作業 1 本の並び（Python の lead_ops）
pub fn lead_ops(reads: &[Read]) -> Vec<Op> {
    let mut by: Vec<(String, Passes)> = vec![];
    let mut at: HashMap<&str, usize> = HashMap::new();
    for r in reads {
        for o in &r.ops {
            for (ln, vals) in &o.lots {
                let i = *at.entry(ln.as_str()).or_insert_with(|| {
                    by.push((ln.clone(), vec![]));
                    by.len() - 1
                });
                by[i].1.push((o, vals));
            }
        }
    }
    let mk = |key: &str, start, end, vals: &HashMap<String, Own>, why: &str, steps: usize| Op {
        key: key.into(),
        start,
        end,
        n: 1,
        values: vals.clone(),
        nums: nums_of(vals),
        why: why.into(),
        carry: false,
        after: false,
        running: false,
        lots: vec![],
        steps: steps as i64,
    };
    let mut out = vec![];
    for (ln, xs) in &by {
        let mut timed: Vec<&(&Op, &HashMap<String, Own>)> = xs.iter().filter(|x| x.0.start.is_some()).collect();
        if timed.is_empty() {
            if xs.iter().all(|x| x.0.carry || x.0.after) {
                continue;
            }
            out.push(mk(ln, None, None, xs[0].1, "nostart", xs.len()));
            continue;
        }
        timed.sort_by_key(|x| x.0.start);
        let (first, last) = (timed[0], timed[timed.len() - 1]);
        if last.0.carry || last.0.after {
            continue;
        }
        let a = first.0.start.unwrap();
        let ends: Vec<NaiveDateTime> = timed.iter().filter_map(|x| x.0.end).collect();
        let (mut b, mut why) = if !ends.is_empty() && last.0.end.is_some() {
            (ends.iter().max().copied(), String::new())
        } else if timed.len() > 1 {
            (None, "last".to_string())
        } else {
            (None, if last.0.why.is_empty() { "blank".into() } else { last.0.why.clone() })
        };
        if b.is_some_and(|b| b <= a) {
            b = None;
            why = "before".into();
        }
        out.push(mk(ln, Some(a), b, first.1, &why, timed.len()));
    }
    out.sort_by_key(|o| (o.start.is_none(), o.start.unwrap_or(NaiveDateTime::MIN)));
    out
}

// ------------------------------------------------------------------ ABC 分析と換算係数
/// 品種の列（Python の cls_list）
pub fn cls_list(cls: Option<&Value>) -> Vec<String> {
    let xs: Vec<Value> = match cls {
        Some(Value::Array(a)) => a.clone(),
        Some(x) => vec![x.clone()],
        None => vec![Value::Null],
    };
    let mut out: Vec<String> = vec![];
    for x in xs {
        let t = if lotlist::json_truthy(&x) { pyfmt::strip(&lotlist::json_str(&x)).to_string() } else { String::new() };
        if !t.is_empty() && !out.contains(&t) {
            out.push(t);
        }
    }
    out.truncate(MAX_CLS);
    out
}

/// 段の番号 → 名前 A, B, …, Z, AA …（Python の rank_name）
pub fn rank_name(i: usize) -> String {
    let (mut out, mut i) = (String::new(), i + 1);
    while i > 0 {
        let r = (i - 1) % 26;
        i = (i - 1) / 26;
        out.insert(0, (b'A' + r as u8) as char);
    }
    out
}

fn rank_of(i: usize, cum: f64, limits: &[f64], each: bool) -> usize {
    if each {
        return i;
    }
    if i == 0 {
        return 0;
    }
    limits.iter().position(|lim| cum <= lim + 1e-9).unwrap_or(limits.len())
}

struct Item {
    key: String,
    parts: Vec<String>,
    lots: i64,
    timed: i64,
    minutes: f64,
    sum: f64,
    avg: Option<f64>,
    occ: Option<f64>,
    qty: N,
}

/// 作業の並び → 品種ごとの ABC 分析と換算係数（Python の abc）
pub fn abc(ops: &[Op], cls: &[String], qty: &str, base: &str, limits: &[f64], each: bool) -> Map<String, Value> {
    let cols: Vec<String> = cls.to_vec();
    let mut items: Vec<Item> = vec![];
    for o in ops {
        let mut parts: Vec<String> = cols
            .iter()
            .map(|c| match o.values.get(c) {
                None | Some(Own::None) => String::new(),
                Some(v) => pyfmt::strip(&v.py().py_str()).to_string(),
            })
            .collect();
        if parts.is_empty() {
            parts.push(String::new());
        }
        let k = parts.join(KEY_SEP);
        let i = match items.iter().position(|x| x.key == k) {
            Some(i) => i,
            None => {
                items.push(Item { key: k, parts, lots: 0, timed: 0, minutes: 0.0, sum: 0.0, avg: None, occ: None, qty: N::I(0) });
                items.len() - 1
            }
        };
        let x = &mut items[i];
        x.lots += 1;
        if let Some(m) = minutes(o) {
            x.timed += 1;
            x.minutes += m;
        }
        if !QTYS.contains(&qty) {
            x.sum += o.nums.get(qty).copied().unwrap_or(0.0);
        }
    }
    for x in items.iter_mut() {
        x.avg = if x.timed > 0 { Some(x.minutes / x.timed as f64) } else { None };
        x.occ = x.avg.map(|a| x.lots as f64 * a);
        x.qty = match qty {
            "lots" => N::I(x.lots),
            "time" => N::F(x.occ.unwrap_or(0.0)),
            _ => N::F(x.sum),
        };
    }
    items.sort_by(|a, b| b.qty.f().partial_cmp(&a.qty.f()).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.key.cmp(&b.key)));
    let total = N::sum(items.iter().map(|x| x.qty));
    let mut lims: Vec<f64> = limits.to_vec();
    lims.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let lots_all: i64 = items.iter().map(|x| x.lots).sum();
    let occ_all = N::sum(items.iter().map(|x| N::F(x.occ.unwrap_or(0.0))));
    let timed: Vec<usize> = (0..items.len()).filter(|i| items[*i].avg.is_some()).collect();
    let (rf, ref_name): (Option<f64>, String) = match base {
        "avg" => {
            let n: i64 = timed.iter().map(|i| items[*i].timed).sum();
            let m = py_sum(timed.iter().map(|i| items[*i].minutes));
            (if n > 0 { Some(m / n as f64) } else { None }, "全作業の平均".into())
        }
        "top" => {
            let top = timed.iter().copied().fold(None::<usize>, |best, i| match best {
                Some(b) if items[b].lots >= items[i].lots => Some(b),
                _ => Some(i),
            });
            match top {
                Some(t) => {
                    (items[t].avg, format!("いちばん多い品種「{}」", if items[t].key.is_empty() { "（空欄）" } else { &items[t].key }))
                }
                None => (None, String::new()),
            }
        }
        b => match timed.iter().find(|i| items[**i].key == b) {
            Some(i) => (items[*i].avg, format!("品種「{b}」")),
            None => (None, format!("品種「{b}」（作業がありません）")),
        },
    };
    let rf = rf.filter(|r| *r != 0.0);
    let mut run = N::I(0);
    let mut out_items = vec![];
    let mut conv_sum: Vec<N> = vec![];
    for (i, x) in items.iter().enumerate() {
        run = match (run, x.qty) {
            (N::I(a), N::I(b)) => N::I(a + b),
            (a, b) => N::F(a.f() + b.f()),
        };
        let share = if total.f() != 0.0 { py_round(x.qty.f() / total.f() * 100.0, 4) } else { 0.0 };
        let cum = if total.f() != 0.0 { py_round(run.f() / total.f() * 100.0, 4) } else { 0.0 };
        let ri = rank_of(i, cum, &lims, each);
        let factor = match (rf, x.avg) {
            (Some(r), Some(a)) => Some(py_round(a / r, 4)),
            _ => None,
        };
        let conv = factor.map(|f| py_round(x.lots as f64 * f, 4));
        // Python の x["conv"] or 0: None と 0.0 は整数の 0（全部がそれなら計も整数）
        conv_sum.push(conv.filter(|c| *c != 0.0).map(N::F).unwrap_or(N::I(0)));
        out_items.push(json!({
            "key": x.key, "parts": x.parts, "lots": x.lots, "timed": x.timed, "minutes": py_round(x.minutes, 2),
            "avg": x.avg.map(|a| py_round(a, 2)), "occ": x.occ.map(|o| py_round(o, 2)), "qty": x.qty.json(),
            "share": share, "cum": cum, "ri": ri, "rank": rank_name(ri),
            "lotShare": if lots_all != 0 { py_round(x.lots as f64 / lots_all as f64 * 100.0, 4) } else { 0.0 },
            "occShare": if occ_all.f() != 0.0 { py_round(x.occ.unwrap_or(0.0) / occ_all.f() * 100.0, 4) } else { 0.0 },
            "factor": factor, "conv": conv,
        }));
    }
    let mut m = Map::new();
    m.insert("items".into(), json!(out_items));
    m.insert("total".into(), total.json());
    m.insert("base".into(), json!({"minutes": rf.map(|r| py_round(r, 2)), "name": ref_name}));
    m.insert("conv".into(), N::sum(conv_sum).round(4).json());
    m.insert("lots".into(), json!(lots_all));
    m.insert("occ".into(), occ_all.round(2).json());
    m.insert("noEnd".into(), json!(ops.iter().filter(|o| minutes(o).is_none()).count()));
    m.insert("why".into(), reasons(ops.iter()));
    m.insert("cls".into(), json!(cols));
    m.insert(
        "ranks".into(),
        json!({"each": each, "lims": if each { vec![] } else { lims.clone() }, "count": if each { items.len() } else { lims.len() + 1 }}),
    );
    m
}

/// 基準の期間（地点 A）の換算係数を、いまの期間（地点 B）の答えに当てる（Python の apply_ref）
pub fn apply_ref(cur: &mut Map<String, Value>, rf: &Map<String, Value>, ref_range: Option<&(String, String)>) {
    let fac: HashMap<String, f64> = rf
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|x| Some((lotlist::json_str(&x["key"]), x.get("factor")?.as_f64()?)))
        .collect();
    let (mut conv, mut missing) = (0.0_f64, 0_i64);
    if let Some(Value::Array(items)) = cur.get_mut("items") {
        for x in items.iter_mut() {
            let f = fac.get(&lotlist::json_str(&x["key"])).copied();
            let lots = x["lots"].as_i64().unwrap_or(0);
            let rc = py_round(lots as f64 * f.unwrap_or(1.0), 4);
            x["refFactor"] = json!(f);
            x["refConv"] = json!(rc);
            conv += rc;
            if f.is_none() {
                missing += lots;
            }
        }
    }
    let lots = cur.get("lots").cloned().unwrap_or(json!(0));
    cur.insert(
        "ref".into(),
        json!({"range": ref_range.map(|(a, b)| json!([a, b])).unwrap_or(Value::Null), "base": rf.get("base").cloned().unwrap_or(Value::Null),
               "conv": py_round(conv, 4), "missing": missing, "lots": lots}),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_parts_like_python() {
        assert_eq!(rank_name(0), "A");
        assert_eq!(rank_name(25), "Z");
        assert_eq!(rank_name(26), "AA");
        assert_eq!(rank_name(701), "ZZ");
        assert_eq!(rank_name(702), "AAA");
        assert_eq!(serial(&Py::Text("46297.34375")).as_deref(), Some("2026-10-02 08:15:00"));
        assert_eq!(serial(&Py::Text("46297")), None);
        assert_eq!(serial(&Py::Float(19999.0)), None);
        assert_eq!(end_column(&["作業開始日".into(), "作業終了日".into()], "", "作業開始日"), "作業終了日");
        assert_eq!(cls_list(Some(&json!([" 合金 ", "調質", "合金", "", "a", "b", "c"]))), vec!["合金", "調質", "a", "b"]);
        let m = merge(vec![
            (dt_of("2026-10-01 10:00:00").unwrap(), dt_of("2026-10-01 12:00:00").unwrap()),
            (dt_of("2026-10-01 08:00:00").unwrap(), dt_of("2026-10-01 10:00:00").unwrap()),
        ]);
        assert_eq!(m.len(), 1);
    }
}
