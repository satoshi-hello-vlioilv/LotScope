//! 作業実績を「作業」でまとめ、日ごと・日＋直ごとに数える（作業実績の画面の「作業でまとめる」。版 3.60.0 で Python から移した）。
//! 答えは Python の app/services/work_summary.py・shifts.py と同じ（desktop/tests/lotlist_parity.rs が突き合わせる）。
//!
//! - 1 作業: 作業開始（既定の列 BOX実績_作業開始_日付）が同じ行（幅・丈で分割したロット）。作業開始が空の行はまとめない
//! - 日・直: その設備の勤務体系（マスタ shift_patterns。設備を書いた体系 → 全設備共通）の区分に作業開始の時刻を当てる。
//!   日付は現場歴（basis=work。日を跨ぐ直の跨いだ後は日付補正の日）か太陽暦（cal）
//! - 一覧（lotlist::query の grouping）: 作業開始の新しい順に並べ、同じ作業の行を 1 か所に集める。答えの work に、ページの行ごとの
//!   [作業の鍵, 日, 直の番号, 作業開始] と、絞り込みに当たる全部の行の日・直ごとの数（buckets）を入れる

use crate::lotlist::{qi, sql_err};
use crate::pyfmt::{self, digit, strip, Py};
use chrono::{Duration, NaiveDate};
use rusqlite::functions::FunctionFlags;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::time::Instant;

const START_CANDIDATES: &[&str] = &["BOX実績_作業開始_日付"];
/// 0 件の日を埋める日数の上限（読み違えた古い日付で、何万行もの表にしない）
const MAX_FILL_DAYS: i64 = 3660;
pub const DAYOFF_DEFAULT: i64 = -1;
pub const DAYOFF_LIMIT: i64 = 7;
/// 時刻はあるが、どの区分にも入らない（直の間の空き時間など）
pub const OUTSIDE: i64 = -1;
/// 時刻が無い（日付だけ）
pub const NO_TIME: i64 = -2;

// ------------------------------------------------------------------ 値（SQLite から読んだ物を持ち回す形）
/// 持ち主のある値（pyfmt::Py の持ち主版）
#[derive(Debug, Clone, PartialEq)]
pub enum Own {
    None,
    Int(i64),
    Float(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl Own {
    pub fn py(&self) -> Py<'_> {
        match self {
            Own::None => Py::None,
            Own::Int(i) => Py::Int(*i),
            Own::Float(f) => Py::Float(*f),
            Own::Text(s) => Py::Text(s),
            Own::Blob(b) => Py::Blob(b),
        }
    }
    pub fn of_ref(v: ValueRef<'_>) -> Own {
        match v {
            ValueRef::Null => Own::None,
            ValueRef::Integer(i) => Own::Int(i),
            ValueRef::Real(f) => Own::Float(f),
            ValueRef::Text(t) => Own::Text(String::from_utf8_lossy(t).into_owned()),
            ValueRef::Blob(b) => Own::Blob(b.to_vec()),
        }
    }
    /// 一覧の答えの行の値（JSON）から（Python の dict_rows の値と同じ種類）
    pub fn of_json(v: Option<&Value>) -> Own {
        match v {
            None | Some(Value::Null) => Own::None,
            Some(Value::Number(n)) => n.as_i64().map(Own::Int).unwrap_or_else(|| Own::Float(n.as_f64().unwrap_or(0.0))),
            Some(Value::String(s)) => Own::Text(s.clone()),
            Some(Value::Bool(b)) => Own::Int(*b as i64),
            Some(x) => Own::Text(x.to_string()),
        }
    }
}

fn py_of(v: ValueRef<'_>) -> Py<'_> {
    match v {
        ValueRef::Null => Py::None,
        ValueRef::Integer(i) => Py::Int(i),
        ValueRef::Real(f) => Py::Float(f),
        ValueRef::Text(t) => Py::Text(std::str::from_utf8(t).unwrap_or("")),
        ValueRef::Blob(b) => Py::Blob(b),
    }
}

/// 数に読める値 → f64（"1,234.5"・" 54"・数）。読めなければ None（合計に入れない。Python の work_summary.num と同じ）
pub fn num(v: &Py) -> Option<f64> {
    let f = match v {
        Py::None => return None,
        Py::Int(i) => *i as f64,
        Py::Float(f) => *f,
        x => {
            let s = x.py_str().replace(',', "");
            let s = strip(&s);
            if s.is_empty() {
                return None;
            }
            pyfmt::py_float(s).ok()?
        }
    };
    f.is_finite().then_some(f)
}

/// 比べるための形（NFKC・前後の空白を除く・大文字。Python の identity.normalize_part と同じ）
pub fn normalize_part(s: &str) -> String {
    crate::access::py_key(s) // 窓の 1 か所（Python 3.13 と同じ答え。Unicode の版の違いも扱う）
}

// ------------------------------------------------------------------ 勤務体系（Python の shifts.py）
/// 'H:MM'・'HH:MM' → 0 時からの分（^([01]?\d|2[0-3]):([0-5]\d)$。読めなければ None）
pub fn hm(v: &str) -> Option<u32> {
    let cs: Vec<char> = strip(v).chars().collect();
    let colon = cs.iter().position(|c| *c == ':')?;
    let (h, m) = (&cs[..colon], &cs[colon + 1..]);
    let hour = match h {
        [a] => digit(*a)?,
        [a @ ('0' | '1'), b] => (*a as u32 - '0' as u32) * 10 + digit(*b)?,
        ['2', b @ '0'..='3'] => 20 + (*b as u32 - '0' as u32),
        _ => return None,
    };
    let min = match m {
        [a @ '0'..='5', b] => (*a as u32 - '0' as u32) * 10 + digit(*b)?,
        _ => return None,
    };
    Some(hour * 60 + min)
}

/// '8:15' → '08:15'
pub fn pad_hm(v: &str) -> String {
    match hm(v) {
        Some(m) => format!("{:02}:{:02}", m / 60, m % 60),
        None => strip(v).to_string(),
    }
}

/// 日を跨ぐ区分か（終了 <= 開始）
pub fn crosses_midnight(start: &str, end: &str) -> bool {
    matches!((hm(start), hm(end)), (Some(a), Some(b)) if b <= a)
}

/// Python の int(値)（JSON の値。読めなければ None）
pub fn py_int_of(v: &Value) -> Option<i64> {
    match v {
        Value::Bool(b) => Some(*b as i64),
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.is_finite()).map(|f| f.trunc() as i64)),
        Value::String(s) => pyfmt::py_int(s).ok(),
        _ => None,
    }
}

/// この区分の「跨いだ後の時間帯」に当てる日付補正。跨がない区分は必ず 0。未設定は -1
pub fn day_offset(start: &str, end: &str, raw: Option<&Value>) -> i64 {
    if !crosses_midnight(start, end) {
        return 0;
    }
    match raw {
        None | Some(Value::Null) => DAYOFF_DEFAULT,
        Some(Value::String(s)) if s.is_empty() => DAYOFF_DEFAULT,
        Some(v) => py_int_of(v).map(|n| n.clamp(-DAYOFF_LIMIT, DAYOFF_LIMIT)).unwrap_or(DAYOFF_DEFAULT),
    }
}

/// Python の真偽（JSON の値）
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// Python の str(値)（JSON の値）
pub fn py_str(v: &Value) -> String {
    match v {
        Value::Null => "None".into(),
        Value::Bool(b) => if *b { "True" } else { "False" }.into(),
        Value::String(s) => s.clone(),
        Value::Number(n) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => pyfmt::float_repr(n.as_f64().unwrap_or(0.0)),
        },
        x => x.to_string(),
    }
}

/// 適用設備（カンマ区切りの字・並び）→ 設備名の並び（前後の空白を除き、同じ名前は 1 つ）
pub fn equipment_list(v: Option<&Value>) -> Vec<String> {
    let items: Vec<String> = match v {
        Some(Value::Array(a)) => a.iter().map(|x| if truthy(x) { py_str(x) } else { String::new() }).collect(),
        Some(x) if truthy(x) => py_str(x).split([',', '、', '，', '\n']).map(str::to_string).collect(),
        _ => vec![],
    };
    let mut out: Vec<String> = vec![];
    for x in items {
        let s = strip(&x).to_string();
        if !s.is_empty() && out.iter().all(|y| normalize_part(&s) != normalize_part(y)) {
            out.push(s);
        }
    }
    out
}

/// 勤務区分（効いている日付補正つき）
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub name: String,
    pub start: String,
    pub end: String,
    pub day_offset: i64,
    pub crosses: bool,
}

impl Segment {
    pub fn json(&self) -> Value {
        json!({"name": self.name, "start": self.start, "end": self.end, "dayOffset": self.day_offset, "crosses": self.crosses})
    }
}

/// 行の区分（JSON の字）→ 区分の並び。壊れた区分は飛ばす（読むだけなので止めない）
pub fn segments_of(row: &Value) -> Vec<Segment> {
    // 字だけを読む（Python の json.loads は字でない値〈並び・数〉で TypeError → 区分なし。作った後の採点〈版 3.75.0〉で見つけた）
    let raw = row.get("区分").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("[]").to_string();
    let parsed: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    let mut out = vec![];
    for seg in parsed.as_array().into_iter().flatten() {
        let (Some(s), Some(e)) = (seg.get("start"), seg.get("end")) else { continue };
        let (s, e) = (if truthy(s) { py_str(s) } else { String::new() }, if truthy(e) { py_str(e) } else { String::new() });
        let name = seg.get("name").filter(|n| truthy(n));
        if !seg.is_object() || hm(&s).is_none() || hm(&e).is_none() || name.is_none() {
            continue;
        }
        let (s, e) = (pad_hm(&s), pad_hm(&e));
        out.push(Segment {
            name: py_str(name.unwrap()),
            day_offset: day_offset(&s, &e, seg.get("dayOffset")),
            crosses: crosses_midnight(&s, &e),
            start: s,
            end: e,
        });
    }
    out
}

pub fn order_of(row: &Value) -> i64 {
    row.get("表示順").filter(|v| truthy(v)).and_then(py_int_of).unwrap_or(0)
}

/// その設備で使う勤務体系（設備名を書いた体系が先、無ければ全設備共通。同じ段に複数あれば表示順で最初）
#[derive(Debug, Clone, PartialEq)]
pub struct Pattern {
    pub id: Value,
    pub name: String,
    pub equipment_text: String,
    pub segments: Vec<Segment>,
}

impl Pattern {
    /// 画面へ返す短い形（{id, name, equipmentText}）
    pub fn brief(&self) -> Value {
        json!({"id": self.id, "name": self.name, "equipmentText": self.equipment_text})
    }
}

fn view(row: &Value) -> Pattern {
    let eq = equipment_list(row.get("適用設備"));
    Pattern {
        id: row.get("id").cloned().unwrap_or(Value::Null),
        name: row.get("名称").filter(|v| truthy(v)).map(py_str).unwrap_or_default(),
        equipment_text: if eq.is_empty() { "全設備共通".into() } else { eq.join("・") },
        segments: segments_of(row),
    }
}

pub fn pattern_for(rows: &[Value], equipment: &str) -> Option<Pattern> {
    let mut ordered: Vec<&Value> = rows.iter().collect();
    ordered.sort_by_key(|r| (order_of(r), r.get("id").filter(|v| truthy(v)).and_then(py_int_of).unwrap_or(0)));
    let key = normalize_part(equipment);
    if !key.is_empty() {
        for r in &ordered {
            if equipment_list(r.get("適用設備")).iter().any(|x| normalize_part(x) == key) && !segments_of(r).is_empty() {
                return Some(view(r));
            }
        }
    }
    ordered.iter().find(|r| equipment_list(r.get("適用設備")).is_empty() && !segments_of(r).is_empty()).map(|r| view(r))
}

/// 区分の並び → 時刻（分）から（区分の番号, 日付補正）を答える係（WaveLog の resolve_shift_info と同じ決め方）
#[derive(Debug, Clone, Default)]
pub struct Clock {
    pub segments: Vec<Segment>,
    spans: Vec<(u32, u32, i64)>,
}

impl Clock {
    pub fn new(segments: Vec<Segment>) -> Clock {
        let spans = segments.iter().map(|s| (hm(&s.start).unwrap_or(0), hm(&s.end).unwrap_or(0), s.day_offset)).collect();
        Clock { segments, spans }
    }

    pub fn resolve(&self, minute: u32) -> (i64, i64) {
        for (i, &(s, e, off)) in self.spans.iter().enumerate() {
            if e <= s {
                if minute >= s {
                    return (i as i64, 0);
                }
                if minute < e {
                    return (i as i64, off);
                }
            } else if s <= minute && minute < e {
                return (i as i64, 0);
            }
        }
        (OUTSIDE, 0)
    }

    /// 日時の字（'YYYY-MM-DD[ HH:MM:SS]'）→ (日付, 区分の番号)。basis="work" は現場歴（日付補正を当てる）
    pub fn place(&self, stamp: &str, basis: &str) -> (String, i64) {
        if stamp.is_empty() {
            return (String::new(), NO_TIME);
        }
        let cs: Vec<char> = stamp.chars().collect();
        let mut day: String = cs.iter().take(10).collect();
        if cs.len() < 16 {
            return (day, NO_TIME);
        }
        let n = |a: usize, b: usize| cs[a..b].iter().try_fold(0u32, |v, c| Some(v * 10 + digit(*c)?)).unwrap_or(0);
        let (idx, off) = if self.segments.is_empty() { (OUTSIDE, 0) } else { self.resolve(n(11, 13) * 60 + n(14, 16)) };
        if off != 0 && basis == "work" {
            if let Ok(d) = NaiveDate::parse_from_str(&day, "%Y-%m-%d") {
                day = (d + Duration::days(off)).format("%Y-%m-%d").to_string();
            }
        }
        (day, idx)
    }
}

// ------------------------------------------------------------------ 作業でまとめる（Python の work_summary.py）
/// 作業開始の列: 選んだ列（あれば）→ 既定の名前 → 「作業開始」を含み日付・日時の列。無ければ ""
pub fn start_column(cs: &[String], preferred: &str) -> String {
    if !preferred.is_empty() && cs.iter().any(|c| c == preferred) {
        return preferred.into();
    }
    for c in START_CANDIDATES {
        if cs.iter().any(|x| x == c) {
            return c.to_string();
        }
    }
    cs.iter().find(|c| c.contains("作業開始") && (c.contains("日付") || c.contains("日時"))).cloned().unwrap_or_default()
}

/// 作業開始の時刻が別の列にあるとき、その列（〜日付 → 〜時刻・〜時間）。無ければ ""
pub fn time_column(cs: &[String], start: &str) -> String {
    let Some(head) = start.strip_suffix("日付") else { return String::new() };
    ["時刻", "時間"].iter().map(|x| format!("{head}{x}")).find(|c| cs.contains(c)).unwrap_or_default()
}

/// 1 作業の鍵: 日時と読めれば 'YYYY-MM-DD[ HH:MM:SS]'、読めなければ字、空なら ""（まとめない）
pub fn work_key(v: &Py, t: &Py) -> String {
    if let Some(s) = pyfmt::to_datetime(v, t) {
        return s;
    }
    let raw = if *v == Py::None { String::new() } else { strip(&v.py_str()).to_string() };
    if raw.is_empty() {
        return String::new();
    }
    let tv = if *t == Py::None { String::new() } else { strip(&t.py_str()).to_string() };
    format!("?{raw}|{tv}")
}

fn dt(v: &Py, t: &Py) -> String {
    pyfmt::to_datetime(v, t).unwrap_or_default()
}

/// 数の列（空でない値を先頭から sample 個読み、みな数に読める列）
pub fn numeric_columns(c: &Connection, t: &str, cs: &[String], sample: usize) -> Result<Vec<String>, String> {
    let mut out = vec![];
    for col in cs {
        let q = qi(col);
        let mut st = c.prepare(&format!("SELECT {q} FROM {} WHERE TRIM(CStr({q})) <> '' LIMIT {sample}", qi(t))).map_err(sql_err)?;
        let mut rows = st.query([]).map_err(sql_err)?;
        let (mut any, mut all) = (false, true);
        while let Some(r) = rows.next().map_err(sql_err)? {
            any = true;
            if num(&py_of(r.get_ref(0).map_err(sql_err)?)).is_none() {
                all = false;
                break;
            }
        }
        if any && all {
            out.push(col.clone());
        }
    }
    Ok(out)
}

/// まとめの係が一覧に足す段取り（鍵の式・並べ替えの前に置く式・帯で押した日・直の絞り込み）
pub struct Plan {
    pub key: String,
    pub lead: Vec<String>,
    pub filter: Option<(Vec<String>, Vec<SqlValue>)>,
}

/// lotlist::query に渡す係（prepare で鍵と並びを決め、extra で答えに日・直を足す）
pub struct Grouping {
    pub clock: Clock,
    pub day: String,
    pub shift: Option<i64>,
    pub preferred: String,
    pub basis: String,
    pub order: String,
    pub pattern: Option<Value>,
    pub total: String,
    pub fill: bool,
    pub column: String,
    pub time_col: String,
}

impl Grouping {
    /// 問い合わせの引数（start・basis・order・day・shift・total・fill）と、その設備の勤務体系から（Python の routes/worklog.work_grouping）
    pub fn from_query(qs: &[(String, String)], pattern: Option<&Pattern>) -> Option<Grouping> {
        let arg = |k: &str| qs.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        if arg("work") != Some("1") {
            return None;
        }
        let shift = match arg("shift") {
            Some(s) if !s.is_empty() => pyfmt::py_int(s).ok(),
            _ => None,
        };
        let day = arg("day").unwrap_or("");
        let basis = arg("basis").unwrap_or("work");
        let order = arg("order").unwrap_or("desc");
        Some(Grouping {
            clock: Clock::new(pattern.map(|p| p.segments.clone()).unwrap_or_default()),
            day: if day.chars().count() == 10 || day == "-" { day.into() } else { String::new() },
            shift,
            preferred: arg("start").unwrap_or("").into(),
            basis: if ["work", "cal"].contains(&basis) { basis.into() } else { "work".into() },
            order: if ["desc", "asc"].contains(&order) { order.into() } else { "desc".into() },
            pattern: pattern.map(Pattern::brief),
            total: arg("total").unwrap_or("").into(),
            fill: arg("fill") == Some("1"),
            column: String::new(),
            time_col: String::new(),
        })
    }

    fn args(&self) -> String {
        format!("{}, {}", qi(&self.column), if self.time_col.is_empty() { "NULL".into() } else { qi(&self.time_col) })
    }

    pub fn prepare(&mut self, c: &Connection, cs: &[String]) -> Result<Option<Plan>, String> {
        self.column = start_column(cs, &self.preferred);
        self.time_col = if self.column.is_empty() { String::new() } else { time_column(cs, &self.column) };
        if self.column.is_empty() {
            return Ok(None);
        }
        let det = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
        c.create_scalar_function("WorkKey", 2, det, |ctx| Ok(work_key(&py_of(ctx.get_raw(0)), &py_of(ctx.get_raw(1))))).map_err(sql_err)?;
        c.create_scalar_function("WorkStamp", 2, det, |ctx| {
            Ok(pyfmt::to_datetime(&py_of(ctx.get_raw(0)), &py_of(ctx.get_raw(1))).map(SqlValue::Text).unwrap_or(SqlValue::Null))
        })
        .map_err(sql_err)?;
        let a = self.args();
        let stamp = format!("WorkStamp({a})");
        let mut plan = Plan {
            key: format!("WorkKey({a})"),
            // 読めない作業開始（空・日時でない字）はいつも後ろ。同じ時刻の作業どうしは鍵で分ける
            lead: vec![format!("{stamp} IS NULL"), format!("{stamp} {}", self.order.to_uppercase()), format!("WorkKey({a})")],
            filter: None,
        };
        if !self.day.is_empty() {
            // 日・直の決め方は summarize と同じ Clock::place（ここ 1 か所の決まりを SQL からも呼ぶ）
            let (clock, basis) = (self.clock.clone(), self.basis.clone());
            c.create_scalar_function("WorkPlace", 2, det, move |ctx| {
                let (day, idx) = clock.place(&dt(&py_of(ctx.get_raw(0)), &py_of(ctx.get_raw(1))), &basis);
                Ok(format!("{day}|{idx}"))
            })
            .map_err(sql_err)?;
            let day = if self.day == "-" { String::new() } else { self.day.clone() };
            plan.filter = Some(match self.shift {
                None => (vec![format!("WorkPlace({a}) LIKE ?")], vec![SqlValue::Text(format!("{}|%", day.replace('%', "")))]),
                Some(s) => (vec![format!("WorkPlace({a}) = ?")], vec![SqlValue::Text(format!("{day}|{s}"))]),
            });
        }
        Ok(Some(plan))
    }

    /// 答えに足す work（ページの行の日・直と、絞り込みに当たる全部の行の日・直ごとの数）。wh・params は係の絞り込みを外した物
    #[allow(clippy::too_many_arguments)]
    pub fn extra(
        &self,
        c: &Connection,
        t: &str,
        cs: &[String],
        date_cols: &[String],
        wh: &str,
        params: &[SqlValue],
        rows: &[Value],
    ) -> Result<Value, String> {
        let total_col = if cs.contains(&self.total) { self.total.clone() } else { String::new() };
        let mut info = Map::new();
        info.insert("column".into(), json!(self.column));
        info.insert("timeColumn".into(), json!(self.time_col));
        info.insert("basis".into(), json!(self.basis));
        info.insert("order".into(), json!(self.order));
        info.insert("totalColumn".into(), json!(total_col));
        info.insert("fill".into(), json!(self.fill));
        info.insert("numeric".into(), json!(numeric_columns(c, t, cs, 200)?));
        info.insert("pick".into(), if self.day.is_empty() { Value::Null } else { json!({"day": self.day, "shift": self.shift}) });
        info.insert("candidates".into(), json!(date_cols.iter().filter(|x| **x != self.time_col).collect::<Vec<_>>()));
        info.insert("pattern".into(), self.pattern.clone().unwrap_or(Value::Null));
        info.insert("shifts".into(), Value::Array(self.clock.segments.iter().map(Segment::json).collect()));
        if self.column.is_empty() {
            info.insert("rows".into(), json!([]));
            info.insert("buckets".into(), json!([]));
            info.insert("total".into(), summarize(&[], &self.clock, &self.basis, &self.order, false)["total"].clone());
            return Ok(Value::Object(info));
        }
        let tc = &self.time_col;
        let page: Vec<Value> = rows
            .iter()
            .map(|r| {
                let v = Own::of_json(r.get(&self.column));
                let tv = if tc.is_empty() { Own::None } else { Own::of_json(r.get(tc)) };
                let stamp = dt(&v.py(), &tv.py());
                let (day, idx) = self.clock.place(&stamp, &self.basis);
                json!([work_key(&v.py(), &tv.py()), day, idx, stamp])
            })
            .collect();
        info.insert("rows".into(), Value::Array(page));
        let t0 = Instant::now();
        let pick = |x: &str| if x.is_empty() { "NULL".to_string() } else { qi(x) };
        let sql = format!("SELECT {}, {}, {} FROM {}{wh}", qi(&self.column), pick(tc), pick(&total_col), qi(t));
        let mut st = c.prepare(&sql).map_err(sql_err)?;
        let mut q = st.query(params_from_iter(params.iter())).map_err(sql_err)?;
        let mut pairs = vec![];
        while let Some(r) = q.next().map_err(sql_err)? {
            pairs.push([0, 1, 2].map(|i| r.get_ref(i).map(Own::of_ref).unwrap_or(Own::None)));
        }
        if let Value::Object(s) = summarize(&pairs, &self.clock, &self.basis, &self.order, self.fill) {
            info.extend(s);
        }
        info.insert("ms".into(), json!(t0.elapsed().as_millis() as u64));
        Ok(Value::Object(info))
    }
}

fn shift_rank(idx: Option<i64>) -> i64 {
    match idx {
        None => -1, // 0 件の日の行（直は無い）
        Some(i) if i >= 0 => i,
        Some(i) => 1000 - i, // 区分の順 → 直の外 → 時刻なし
    }
}

/// 作業のあった日の最初から最後までのうち、作業の無い日。→ (日の並び, 埋めなかった日数)
pub fn empty_days(days: &[String]) -> (Vec<String>, i64) {
    let mut have: Vec<&String> = days.iter().filter(|d| !d.is_empty()).collect();
    have.sort();
    have.dedup();
    if have.len() < 2 {
        return (vec![], 0);
    }
    let parse = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok();
    let (Some(first), Some(last)) = (parse(have[0]), parse(have[have.len() - 1])) else { return (vec![], 0) };
    let span = (last - first).num_days() + 1;
    if span > MAX_FILL_DAYS {
        return (vec![], span);
    }
    let out = (0..span).map(|i| (first + Duration::days(i)).format("%Y-%m-%d").to_string()).filter(|d| !have.contains(&d)).collect();
    (out, 0)
}

/// Python の round(x, 6)（正しく丸めた 10 進の 6 桁）
fn round6(x: f64) -> f64 {
    format!("{x:.6}").parse().unwrap_or(x)
}

#[derive(Default)]
struct Bucket {
    day: String,
    shift: Option<i64>,
    works: i64,
    rows: i64,
    split: i64,
    sum: f64,
}

/// (作業開始, 時刻, 合計する数) の並び → 日・直ごとの作業の数（Python の work_summary.summarize と同じ答え）
pub fn summarize(pairs: &[[Own; 3]], clock: &Clock, basis: &str, order: &str, fill: bool) -> Value {
    // 作業ごと（同じ鍵は 1 作業。鍵の無い行は 1 行で 1 作業）。並びは初めて出た順
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut works: Vec<(usize, i64, f64)> = vec![]; // (最初の行, 行の数, 合計)
    for (i, p) in pairs.iter().enumerate() {
        let x = num(&p[2].py()).unwrap_or(0.0);
        let k = work_key(&p[0].py(), &p[1].py());
        let slot = if k.is_empty() { None } else { index.get(&k).copied() };
        match slot {
            Some(w) => {
                works[w].1 += 1;
                works[w].2 += x;
            }
            None => {
                if !k.is_empty() {
                    index.insert(k, works.len());
                }
                works.push((i, 1, x));
            }
        }
    }
    let mut buckets: Vec<Bucket> = vec![];
    let mut at: HashMap<(String, Option<i64>), usize> = HashMap::new();
    let mut total = Bucket::default();
    let (mut no_time, mut no_stamp) = (0i64, 0i64);
    for (i, n, x) in works {
        let stamp = dt(&pairs[i][0].py(), &pairs[i][1].py());
        let (day, idx) = clock.place(&stamp, basis);
        let k = *at.entry((day.clone(), Some(idx))).or_insert_with(|| {
            buckets.push(Bucket { day: day.clone(), shift: Some(idx), ..Bucket::default() });
            buckets.len() - 1
        });
        for b in [&mut buckets[k], &mut total] {
            b.works += 1;
            b.rows += n;
            b.split += (n > 1) as i64;
            b.sum += x;
        }
        no_time += (!stamp.is_empty() && idx == NO_TIME) as i64;
        no_stamp += if stamp.is_empty() { n } else { 0 };
    }
    let days: Vec<String> = buckets.iter().map(|b| b.day.clone()).collect();
    let (empty, skipped) = if fill { empty_days(&days) } else { (vec![], 0) };
    for d in &empty {
        buckets.push(Bucket { day: d.clone(), shift: None, ..Bucket::default() });
    }
    let mut ds: Vec<&String> = buckets.iter().map(|b| &b.day).filter(|d| !d.is_empty()).collect();
    ds.sort();
    ds.dedup();
    if order == "desc" {
        ds.reverse();
    }
    let rank: HashMap<&String, usize> = ds.iter().enumerate().map(|(i, d)| (*d, i)).collect();
    let mut order_of: Vec<(usize, i64, usize)> =
        buckets.iter().enumerate().map(|(i, b)| (*rank.get(&b.day).unwrap_or(&ds.len()), shift_rank(b.shift), i)).collect();
    order_of.sort();
    let out: Vec<Value> = order_of
        .iter()
        .map(|&(_, _, i)| {
            let b = &buckets[i];
            json!({"day": b.day, "shift": b.shift, "works": b.works, "rows": b.rows, "split": b.split, "sum": round6(b.sum)})
        })
        .collect();
    json!({
        "buckets": out,
        "total": {"works": total.works, "rows": total.rows, "split": total.split, "noTime": no_time, "noStamp": no_stamp, "sum": round6(total.sum)},
        "outside": OUTSIDE, "noTimeIndex": NO_TIME, "empty": empty.len(), "fillSkipped": skipped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segs(v: Value) -> Vec<Segment> {
        segments_of(&json!({"区分": v.to_string()}))
    }

    #[test]
    fn shifts_like_python() {
        assert_eq!((hm("8:15"), hm("23:59"), hm("24:00"), hm("7:5"), hm(" 07:00 ")), (Some(495), Some(1439), None, None, Some(420)));
        let s = segs(json!([{"name": "1直", "start": "7:00", "end": "15:00"}, {"name": "3直", "start": "23:00", "end": "07:00"},
                            {"name": "x", "start": "bad", "end": "1:00"}]));
        assert_eq!(s.len(), 2, "壊れた区分は飛ばす");
        assert_eq!((s[0].start.as_str(), s[0].day_offset, s[1].day_offset, s[1].crosses), ("07:00", 0, -1, true));
        let c = Clock::new(s);
        assert_eq!(c.place("2026-10-02 02:00:00", "work"), ("2026-10-01".into(), 1), "3直の跨いだ後は前の日（現場歴）");
        assert_eq!(c.place("2026-10-02 02:00:00", "cal"), ("2026-10-02".into(), 1));
        assert_eq!(c.place("2026-10-02 16:00:00", "work"), ("2026-10-02".into(), OUTSIDE));
        assert_eq!(c.place("2026-10-02", "work"), ("2026-10-02".into(), NO_TIME));
        assert_eq!(equipment_list(Some(&json!("CR1、 cr1 ,ＣＲ２\nL-1"))), ["CR1", "ＣＲ２", "L-1"], "NFKC・大文字で同じ名前は 1 つ");
        let rows = vec![
            json!({"id": 2, "名称": "共通", "適用設備": "", "区分": json!([{"name": "日勤", "start": "8:00", "end": "17:00"}]).to_string()}),
            json!({"id": 1, "名称": "CR2", "適用設備": "CR2", "区分": json!([{"name": "4直", "start": "11:00", "end": "19:10"}]).to_string(), "表示順": "5"}),
        ];
        assert_eq!(pattern_for(&rows, "ｃｒ２").unwrap().name, "CR2", "設備を書いた体系が先");
        assert_eq!(pattern_for(&rows, "L-1").unwrap().equipment_text, "全設備共通");
    }

    #[test]
    fn datetimes_like_python() {
        let t = |s: &str| pyfmt::to_datetime(&Py::Text(s), &Py::None);
        assert_eq!(t("2026/10/01 8:15:00").as_deref(), Some("2026-10-01 08:15:00"));
        assert_eq!(t("20261002201500").as_deref(), Some("2026-10-02 20:15:00"));
        assert_eq!(t("2026/10/02 午後 8:15:00").as_deref(), Some("2026-10-02 20:15:00"));
        assert_eq!(t("2026/10/02 8:15:00 PM").as_deref(), Some("2026-10-02 20:15:00"));
        assert_eq!(t("2026/10/02 12:15 AM").as_deref(), Some("2026-10-02 00:15:00"));
        assert_eq!(t("2026/02/30 8:00").as_deref(), None, "無い日");
        assert_eq!(pyfmt::to_datetime(&Py::Text("2026/10/01"), &Py::Text("8:15")).as_deref(), Some("2026-10-01 08:15:00"));
        assert_eq!(pyfmt::to_datetime(&Py::Int(20261002201500), &Py::None).as_deref(), Some("2026-10-02 20:15:00"));
        assert_eq!(work_key(&Py::Text(" 不明 "), &Py::None), "?不明|");
        assert_eq!(work_key(&Py::Text("  "), &Py::None), "");
    }

    #[test]
    fn summarize_counts_works_and_fills_days() {
        let c = Clock::new(vec![]);
        let p = |a: &str, x: f64| [Own::Text(a.into()), Own::None, Own::Float(x)];
        let pairs = vec![p("2026/10/01 8:00", 1.0), p("2026/10/01 8:00", 2.5), p("2026/10/03 9:00", 1.0), p("", 4.0)];
        let v = summarize(&pairs, &c, "work", "desc", true);
        assert_eq!(v["total"], json!({"works": 3, "rows": 4, "split": 1, "noTime": 0, "noStamp": 1, "sum": 8.5}));
        let days: Vec<&str> = v["buckets"].as_array().unwrap().iter().map(|b| b["day"].as_str().unwrap()).collect();
        assert_eq!(days, ["2026-10-03", "2026-10-02", "2026-10-01", ""], "新しい順・0 件の日・日付なしは最後");
        assert_eq!(v["empty"], 1);
    }
}
