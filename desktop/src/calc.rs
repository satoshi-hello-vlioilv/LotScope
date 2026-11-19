//! 転写距離・ピッチ計算（版 3.72.0。順 6 の 1 段目。program/app/services/calculator.py・equipment_names.py を写した物）。
//! POST /api/calculate と POST /api/equipment/inspection を窓が答える（Lot::calc_route）。
//!
//! Python と同じ答え（同じビットの数）にするための決まり:
//! - 式の順は Python と同じに書く（浮動小数の足し算・掛け算は順で答えが変わる）。2 乗は `(x)**2` が C の pow を呼ぶので、
//!   畳まれない pow（`pow2`。定数の 2 を畳むと x*x になり、1 ulp 違うことがある）を使う
//! - Python で int の 0 を返す所（厚さ 0 の工程の長さ・転写距離・ピッチなど）は整数の 0 のまま返す
//! - Python が例外で答える形（工程の鍵が無い・設備名が字でない・found_equipment が整数に読めない・遡る途中の設備名が null など）は、
//!   Python と同じ順で最初に出る例外の種類と言葉（error_message）で 400 を答える（版 3.116.0。前は Python に任せた）。値を読む順は
//!   Python の行の順のまま書く
//! - 答えに NaN・inf が出る形は、その値を null にして答える（Python の web.dumps の _finite と同じ。計算の途中は NaN のまま持つ）
//! - i64・u64 に入らない整数（番号・発見設備）は桁のまま読む（held::body_value・pyfmt::PyInt）
//!
//! Python との違い: マスタは置き場の共有のファイルを直に読む（Python は写しを読み、取り直す間隔だけ古いことがある）。

use crate::pyfmt::{self, PyInt};
use crate::pyjson::J;
use crate::worksum::{py_str, truthy};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::f64::consts::PI;
use unicode_normalization::UnicodeNormalization;

type Row = Map<String, Value>;

/// Python が例外で答える形（Py: 例外のクラスの名前と str(e)。道は error_message の言葉と type の欄で 400 を答える）か、
/// 窓が答えない形（Hand: 起こらないはずの内の形だけ）。版 3.116.0: 前は例外の形をみな任せた
#[derive(Debug, Clone, PartialEq)]
pub enum Stop {
    Py(&'static str, String),
    Hand,
}

type R<T> = Result<T, Stop>;

/// Python の型の名前（例外の文に出る）
fn type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "NoneType",
        Value::Bool(_) => "bool",
        Value::Number(n) if n.is_f64() => "float",
        Value::Number(_) => "int",
        Value::String(_) if crate::held::big_digits(v).is_some() => "int",
        Value::String(_) if crate::held::is_held(v) => "float",
        Value::String(_) => "str",
        Value::Array(_) => "list",
        Value::Object(_) => "dict",
    }
}

fn key_err(k: &str) -> Stop {
    Stop::Py("KeyError", pyfmt::str_repr(k))
}

fn no_attr(v: &Value, attr: &str) -> Stop {
    Stop::Py("AttributeError", format!("'{}' object has no attribute '{attr}'", type_name(v)))
}

fn not_iterable(v: &Value) -> Stop {
    Stop::Py("TypeError", format!("'{}' object is not iterable", type_name(v)))
}

/// `d["k"]`（d が表でなければ TypeError・鍵が無ければ KeyError）
fn sub<'a>(d: &'a Value, k: &str) -> R<&'a Value> {
    match d {
        Value::Object(o) => o.get(k).ok_or_else(|| key_err(k)),
        Value::Array(_) => Err(Stop::Py("TypeError", "list indices must be integers or slices, not str".into())),
        Value::String(_) if !crate::held::is_held(d) => Err(Stop::Py("TypeError", "string indices must be integers, not 'str'".into())),
        _ => Err(Stop::Py("TypeError", format!("'{}' object is not subscriptable", type_name(d)))),
    }
}

/// `p["k"]`（工程の表）
fn item<'a>(p: &'a Row, k: &str) -> R<&'a Value> {
    p.get(k).ok_or_else(|| key_err(k))
}

/// Python の dict(p)（工程の 1 つ）: 表はそのまま・並びは 2 つ組の並び・空の字は空の表。ほかは Python と同じ例外。
/// 鍵が字でない組（数・真偽・null の鍵）は、計算が引く鍵（字）に当たらないので外し、あったことを mixed に記す: 計算が最後まで進むと、
/// 答えを書くとき（web.dumps の sort_keys）に字の鍵と比べられず TypeError になる（calculate の終わりで答える）
fn py_dict(p: &Value, mixed: &mut bool) -> R<Row> {
    let short = |i: usize, n: usize| Stop::Py("ValueError", format!("dictionary update sequence element #{i} has length {n}; 2 is required"));
    match p {
        Value::Object(o) => Ok(o.clone()),
        Value::String(_) if crate::held::is_held(p) => Err(not_iterable(p)),
        Value::String(s) if s.is_empty() => Ok(Row::new()),
        Value::String(_) => Err(short(0, 1)),
        Value::Array(a) => {
            let mut out = Row::new();
            for (i, e) in a.iter().enumerate() {
                let (k, v) = match e {
                    Value::Array(x) if x.len() == 2 => (x[0].clone(), x[1].clone()),
                    Value::Array(x) => return Err(short(i, x.len())),
                    Value::String(_) if crate::held::is_held(e) => {
                        return Err(Stop::Py("TypeError", format!("cannot convert dictionary update sequence element #{i} to a sequence")))
                    }
                    Value::String(s) => {
                        let c: Vec<char> = s.chars().collect();
                        if c.len() != 2 {
                            return Err(short(i, c.len()));
                        }
                        (json!(c[0].to_string()), json!(c[1].to_string()))
                    }
                    Value::Object(o) if o.len() == 2 => {
                        let mut ks = o.keys();
                        (json!(ks.next().unwrap()), json!(ks.next().unwrap()))
                    }
                    Value::Object(o) => return Err(short(i, o.len())),
                    _ => return Err(Stop::Py("TypeError", format!("cannot convert dictionary update sequence element #{i} to a sequence"))),
                };
                match k {
                    Value::String(s) if !crate::held::is_held(&Value::String(s.clone())) => {
                        out.insert(s, v);
                    }
                    Value::Array(_) | Value::Object(_) => {
                        return Err(Stop::Py("TypeError", format!("unhashable type: '{}'", type_name(&k))));
                    }
                    _ => *mixed = true,
                }
            }
            Ok(out)
        }
        _ => Err(not_iterable(p)),
    }
}

/// `[dict(p) for p in processes]`（並びは 1 つずつ・表は鍵の字・字は 1 字ずつ・ほかは回せない）
fn py_processes(v: &Value, mixed: &mut bool) -> R<Vec<Row>> {
    match v {
        Value::Array(a) => a.iter().map(|p| py_dict(p, mixed)).collect(),
        Value::Object(o) => o.keys().map(|k| py_dict(&json!(k), mixed)).collect(),
        Value::String(s) if !crate::held::is_held(v) => s.chars().map(|c| py_dict(&json!(c.to_string()), mixed)).collect(),
        _ => Err(not_iterable(v)),
    }
}

/// 2 乗（C の pow。Python の `x ** 2` と同じビット。利用者の決め 2026-11-18: 掛け算に替えない）。有限の数の 2 乗があふれると
/// Python は OverflowError（C の pow の ERANGE）
fn pow2(x: f64) -> R<f64> {
    let y = x.powf(std::hint::black_box(2.0));
    if y.is_infinite() && x.is_finite() {
        return Err(Stop::Py("OverflowError", "(34, 'Numerical result out of range')".into()));
    }
    Ok(y)
}

/// Python の float(v)（読めなければ None。calculator.num の default を呼ぶ側が決める）。num が受けるのは TypeError・ValueError だけで、
/// f64 に入らない大きな整数（本文の 400 桁の数）の OverflowError はそのまま出る
fn num(v: Option<&Value>) -> R<Option<f64>> {
    let Some(v) = v else { return Ok(None) };
    Ok(match v {
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        Value::Number(n) => n.as_f64(),
        Value::String(_) if crate::held::is_held(v) => match crate::held::big_digits(v) {
            Some(d) => Some(pyfmt::py_float_of_int(d).map_err(|e| Stop::Py("OverflowError", e))?),
            None => match crate::held::held(v) {
                Some(J::Float(f)) => Some(f),
                _ => None,
            },
        },
        Value::String(s) => pyfmt::py_float(s).ok(),
        _ => None,
    })
}

fn n0(v: Option<&Value>) -> R<f64> {
    Ok(num(v)?.unwrap_or(0.0))
}

/// Python の max(x, 1)（x が 1 より大きくなければ 1。NaN は NaN のまま）
fn at_least_1(v: Option<&Value>) -> R<f64> {
    let x = num(v)?.unwrap_or(1.0);
    Ok(if 1.0 > x { 1.0 } else { x })
}

/// `(v or "").strip()`。字でない真の値は Python では AttributeError
fn sstrip(v: Option<&Value>) -> R<String> {
    match v {
        None => Ok(String::new()),
        Some(x) if !truthy(x) => Ok(String::new()),
        Some(x @ Value::String(s)) if !crate::held::is_held(x) => Ok(pyfmt::strip(s).to_string()),
        Some(x) => Err(no_attr(x, "strip")),
    }
}

/// `str(v or "")`
fn text(v: Option<&Value>) -> String {
    match v {
        Some(x) if truthy(x) => py_str(x),
        _ => String::new(),
    }
}

/// Python の int(v)（数は切り捨て・字は int(字)・真偽は 0/1・大きな数は桁のまま）。読めなければ Python と同じ例外
fn py_int_value(v: &Value) -> R<PyInt> {
    pyfmt::py_int_of(v.into()).map_err(|e| {
        let ty = if e.starts_with("int() argument") {
            "TypeError"
        } else if e.starts_with("cannot convert float infinity") {
            "OverflowError"
        } else {
            "ValueError"
        };
        Stop::Py(ty, e)
    })
}

/// Python の真偽（数の値）
fn truthy_f(v: &Value) -> bool {
    truthy(v)
}

/// 答えの中の小数。数でない値（NaN・Infinity）は持っている値の印（src/held.rs）にして計算を続け、答えの字は null になる
/// （Python の web.dumps の _finite と held::reply_bytes が同じ。版 3.116.0: 前は Python に任せた）
fn fl(x: f64) -> Value {
    if x.is_finite() {
        json!(x)
    } else {
        crate::held::to_value(&J::Float(x))
    }
}

fn fv(v: &Value) -> f64 {
    match v {
        Value::String(_) => match crate::held::held(v) {
            Some(J::Float(f)) => f,
            _ => 0.0,
        },
        _ => v.as_f64().unwrap_or(0.0),
    }
}

// ---------------------------------------------------------------- 設備名の読み替え（equipment_names.py）

const FIELD: &str = "同一工程";

/// compact: NFKC で全角半角をそろえ、空白を除く
fn compact(v: Option<&Value>) -> String {
    text(v).nfkc().filter(|c| !pyfmt::is_space(*c)).collect()
}

fn compact_str(s: &str) -> String {
    s.nfkc().filter(|c| !pyfmt::is_space(*c)).collect()
}

fn norm(v: Option<&Value>) -> String {
    compact(v).to_uppercase()
}

pub(crate) fn norm_str(s: &str) -> String {
    compact_str(s).to_uppercase()
}

/// 「ANF, ANI*」→ ["ANF", "ANI*"]（区切りは カンマ・読点・空白）
fn parse_patterns(v: Option<&Value>) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for p in text(v).split(|c: char| c == ',' || c == '、' || c == '，' || pyfmt::is_space(c)) {
        let p = norm_str(p);
        if !p.is_empty() && !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

fn is_wild(p: &str) -> bool {
    p.contains('*') || p.contains('?')
}

/// * は何文字でも・? は 1 文字（Python の re の . と同じく改行には当たらない。比べる名前に改行は無い）
fn wild_match(p: &[char], s: &[char]) -> bool {
    let (mut pi, mut si, mut star, mut mark) = (0usize, 0usize, None::<usize>, 0usize);
    while si < s.len() {
        if pi < p.len() && (p[pi] == '?' && s[si] != '\n' || p[pi] == s[si] && p[pi] != '*' && p[pi] != '?') {
            pi += 1;
            si += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = si;
            pi += 1;
        } else if let Some(st) = star {
            if s[mark] == '\n' {
                return false;
            }
            pi = st + 1;
            mark += 1;
            si = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// 設備マスタを保存する前の確かめ（equipment_names.check_row。版 3.77.0。書く道 src/equip_write.rs が使う）。問題があれば利用者に見せる文。
/// 値はそろえる前の生の値で読む（str(v or "")。0・False は空）。比べる相手は id が self_id でない行（足すときは id の無い行も除く）
pub(crate) fn equipment_check(rows: &[Value], data: &Row, self_id: Option<&crate::pyfmt::PyInt>) -> Option<String> {
    let name = pyfmt::strip(&text(data.get("設備名"))).to_string();
    let pats = parse_patterns(data.get(FIELD));
    let others: Vec<&Row> =
        rows.iter().filter_map(Value::as_object).filter(|r| !crate::master_rows::is_self(&Value::Object((*r).clone()), self_id)).collect();
    // Python の f 文字列の {r.get('設備名')}（無ければ None）
    let shown = |r: &Row| r.get("設備名").map(py_str).unwrap_or_else(|| "None".into());
    for p in &pats {
        let pc: Vec<char> = p.chars().collect();
        let wild = is_wild(p);
        for r in &others {
            let other = norm(r.get("設備名"));
            if !other.is_empty() && (if wild { wild_match(&pc, &other.chars().collect::<Vec<_>>()) } else { *p == other }) {
                let n = shown(r);
                return Some(format!("「{p}」はほかの設備「{n}」の名前にも当たります。同じ工程なら「{n}」の行を消してから登録するか、当たらない書き方にしてください。"));
            }
            if !wild && parse_patterns(r.get(FIELD)).contains(p) {
                return Some(format!("「{p}」はもう設備「{}」の同一工程の名前に登録されています。", shown(r)));
            }
        }
    }
    if !name.is_empty() {
        let own: Vec<char> = norm_str(&name).chars().collect();
        for r in &others {
            for q in parse_patterns(r.get(FIELD)) {
                let hit = if is_wild(&q) { wild_match(&q.chars().collect::<Vec<_>>(), &own) } else { q.chars().eq(own.iter().copied()) };
                if hit {
                    return Some(format!(
                        "設備名「{name}」は、設備「{}」の同一工程の名前「{q}」に当たります。先にそちらを直してください。",
                        shown(r)
                    ));
                }
            }
        }
    }
    None
}

/// 設備マスタの行から「出てきた設備名 → マスタの行」を引く（EquipmentResolver）。版 3.98.0 から LotDsp の取込（src/lotdsp.rs）も使い、
/// どう当たったか（name・alias・pattern）と当たった書き方も返す（resolve_how。report.renamed の by。計算の答えは変えない）
pub(crate) struct Resolver<'a> {
    rows: &'a [Row],
    by_name: HashMap<String, usize>,
    by_alias: HashMap<String, usize>,
    wild: Vec<(usize, Vec<char>, usize)>,
}

impl<'a> Resolver<'a> {
    pub(crate) fn new(all: &'a [Row]) -> Resolver<'a> {
        let mut r = Resolver { rows: all, by_name: HashMap::new(), by_alias: HashMap::new(), wild: vec![] };
        let live: Vec<usize> = (0..all.len()).filter(|&i| !norm(all[i].get("設備名")).is_empty()).collect();
        for &i in &live {
            r.by_name.insert(norm(all[i].get("設備名")), i);
        }
        for &i in &live {
            for p in parse_patterns(all[i].get(FIELD)) {
                if is_wild(&p) {
                    let spec = p.chars().filter(|c| *c != '*' && *c != '?').count();
                    r.wild.push((spec, p.chars().collect(), i));
                } else {
                    r.by_alias.entry(p).or_insert(i);
                }
            }
        }
        r.wild.sort_by_key(|w| std::cmp::Reverse(w.0)); // 安定（同じ具体さなら登録の順）
        r
    }

    fn resolve_norm(&self, k: &str) -> Option<usize> {
        self.how_norm(k).map(|x| x.0)
    }

    /// (行の番号, どう当たったか, 当たった書き方)。Python の resolve の (行, how, pattern)
    fn how_norm(&self, k: &str) -> Option<(usize, &'static str, String)> {
        if k.is_empty() {
            return None;
        }
        if let Some(i) = self.by_name.get(k) {
            return Some((*i, "name", k.to_string()));
        }
        if let Some(i) = self.by_alias.get(k) {
            return Some((*i, "alias", k.to_string()));
        }
        let s: Vec<char> = k.chars().collect();
        self.wild.iter().find(|(_, p, _)| wild_match(p, &s)).map(|w| (w.2, "pattern", w.1.iter().collect()))
    }

    /// 出てきた名前 → (行, どう当たったか, 当たった書き方)
    pub(crate) fn resolve_how(&self, name: &str) -> Option<(&'a Row, &'static str, String)> {
        self.how_norm(&norm_str(name)).map(|(i, how, p)| (&self.rows[i], how, p))
    }

    fn resolve(&self, name: &str) -> Option<usize> {
        self.resolve_norm(&norm_str(name))
    }

    /// 代表の設備名（当たらなければ元の名前のまま）。当たった行の設備名が字でなければ Python と同じ AttributeError
    fn canonical(&self, name: &str) -> R<String> {
        match self.resolve(name) {
            Some(i) => sstrip(self.rows[i].get("設備名")),
            None => Ok(pyfmt::strip(name).to_string()),
        }
    }

    pub(crate) fn same(&self, a: &str, b: &str) -> bool {
        match (self.resolve(a), self.resolve(b)) {
            (Some(x), Some(y)) => x == y,
            _ => norm_str(a) == norm_str(b),
        }
    }
}

/// 計算が読むマスタ（設備マスタ・ロールマスタ。読むときの形をそろえた物）
pub struct Masters {
    equipment: Vec<Row>,
    rolls: Vec<Row>,
}

impl Masters {
    /// 行（置き場から読んだ物）→ 旧い列名を読み替える（巻出し方向 → 巻取方向。master_repository._normalize）
    pub fn new(equipment: Vec<Value>, rolls: Vec<Value>) -> Option<Masters> {
        let rows = |v: Vec<Value>| v.into_iter().map(|r| r.as_object().cloned()).collect::<Option<Vec<Row>>>();
        let mut equipment = rows(equipment)?;
        for r in equipment.iter_mut() {
            if let Some(v) = r.remove("巻出し方向") {
                r.entry("巻取方向").or_insert(v);
            }
        }
        Some(Masters { equipment, rolls: rows(rolls)? })
    }

    /// 設備名 → {rewind, line_direction}（equipment_map。字でない値は Python と同じ AttributeError）
    fn equipment_map(&self) -> R<HashMap<String, (String, String)>> {
        let mut out = HashMap::new();
        for r in &self.equipment {
            let key = sstrip(r.get("設備名"))?;
            if !key.is_empty() {
                out.insert(key, (sstrip(r.get("巻取方向"))?, sstrip(r.get("ライン方向"))?));
            }
        }
        Ok(out)
    }

    /// 設備名ごとに「検査計がある設備か」（inspection_of）
    pub fn inspection_of(&self, names: &[String]) -> Value {
        let res = Resolver::new(&self.equipment);
        let mut out = Map::new();
        for n in names {
            let ok = res.resolve(n).is_some_and(|i| pyfmt::strip(&text(self.equipment[i].get("検査計"))) == "有");
            out.insert(n.clone(), json!(ok));
        }
        Value::Object(out)
    }
}

// ---------------------------------------------------------------- 計算（calculator.py）

const REWIND_VALUES: [&str; 3] = ["上", "下", "-"];

fn direction(v: Option<&Value>) -> R<String> {
    let v = sstrip(v)?;
    Ok(if v == "上" || v == "下" { v } else { String::new() })
}

/// 設定の calculation（Python の self.settings.get("calculation", {})）。表でなければ、最初に .get を呼ぶ所で AttributeError
struct Calc<'a> {
    cfg: &'a Value,
}

impl Calc<'_> {
    fn get(&self, k: &str) -> R<Option<&Value>> {
        match self.cfg {
            Value::Object(o) => Ok(o.get(k)),
            x => Err(no_attr(x, "get")),
        }
    }

    /// 内径の自動の値（_auto_inner_diameter）: `ids = cfg.get(...) or {}`・`eq in ids`・`ids[eq]`
    fn auto_inner_diameter(&self, eq: &str) -> R<f64> {
        let ids = self.get("equipment_inner_diameter_mm")?.filter(|x| truthy(x));
        let hit = match ids {
            None => None,
            Some(Value::Object(o)) => o.get(eq),
            // 並びは「同じ字があるか」で、あれば ids[eq] が TypeError（並びの添え字は整数）
            Some(Value::Array(a)) => {
                if a.iter().any(|x| x.as_str() == Some(eq) && !crate::held::is_held(x)) {
                    return Err(Stop::Py("TypeError", "list indices must be integers or slices, not str".into()));
                }
                None
            }
            // 字は「含むか」で、含めば ids[eq] が TypeError
            Some(x @ Value::String(s)) if !crate::held::is_held(x) => {
                if s.contains(eq) {
                    return Err(Stop::Py("TypeError", "string indices must be integers, not 'str'".into()));
                }
                None
            }
            Some(x) => return Err(Stop::Py("TypeError", format!("argument of type '{}' is not a container or iterable", type_name(x)))),
        };
        if let Some(v) = hit {
            return n0(Some(v));
        }
        if eq == "HOT" {
            return Ok(num(self.get("hot_inner_diameter_mm")?)?.unwrap_or(610.0));
        }
        Ok(num(self.get("default_inner_diameter_mm")?)?.unwrap_or(558.0))
    }

    /// `any(eq.startswith(x) for x in cfg.get("end_back_equipment", ["L-"]))`（当たった所で止まる。字でない要素は TypeError）
    fn end_back_eligible(&self, eq: &str) -> R<bool> {
        let starts = |x: &Value| match x {
            Value::String(s) if !crate::held::is_held(x) => Ok(eq.starts_with(s.as_str())),
            x => Err(Stop::Py("TypeError", format!("startswith first arg must be str or a tuple of str, not {}", type_name(x)))),
        };
        match self.get("end_back_equipment")? {
            None => Ok(eq.starts_with("L-")),
            Some(Value::Array(a)) => {
                for x in a {
                    if starts(x)? {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            // 表は鍵の字・字は 1 字ずつ
            Some(Value::Object(o)) => Ok(o.keys().any(|k| eq.starts_with(k.as_str()))),
            Some(x @ Value::String(s)) if !crate::held::is_held(x) => Ok(s.chars().any(|c| eq.starts_with(c))),
            Some(x) => Err(not_iterable(x)),
        }
    }

    /// 前工程との重量差から、この工程で取った後オフの長さ（m）。減っていなければ None（_end_back_m。鍵を読む順も Python と同じ）
    fn end_back_m(p: &Row, prev: Option<&Row>, density: f64) -> R<Option<f64>> {
        let Some(prev) = prev else { return Ok(None) };
        let t = n0(Some(item(p, "thickness")?))?;
        let w = n0(Some(item(p, "width")?))?;
        if !(t != 0.0 && w != 0.0 && density != 0.0) {
            return Ok(None);
        }
        if n0(Some(item(prev, "weight")?))? <= 0.0 || n0(Some(item(p, "weight")?))? <= 0.0 {
            return Ok(None);
        }
        let dk = n0(prev.get("weight"))? - n0(p.get("weight"))?;
        if dk <= 0.0 {
            return Ok(None);
        }
        let split = at_least_1(p.get("design_split"))?;
        let vs = at_least_1(p.get("vertical_split"))?;
        let length = n0(p.get("weight"))? * 1000.0 / (w * t * density) / split * vs;
        let dw = n0(Some(item(prev, "width")?))? - w;
        let edge_kg = if dw > 0.0 { dw * t * density * length * split / vs / 1000.0 } else { 0.0 };
        let kg = dk - edge_kg;
        if kg <= 0.0 {
            return Ok(None);
        }
        Ok(Some(kg * 1000.0 / (w * t * density) / split * vs))
    }
}

fn int0() -> Value {
    json!(0)
}

/// ロットと入力 → 工程ごとの値・仮の発生設備ごとのたどり直し・最も確からしい発生設備（Calculator.calculate）。
/// cfg は設定の calculation。Python が例外で答える形は、Python と同じ順で最初に出る例外（Stop::Py）。値を読む順・鍵を引く順は
/// Python の行の順のまま書く（誤りが 2 つある本文で、どちらが先に出るかが同じになるように。版 3.116.0）
pub fn calculate(cfg: &Value, m: &Masters, lot: &Value, inputs: &Value) -> R<Value> {
    let c = Calc { cfg };
    let mut mixed = false;
    let mut ps: Vec<Row> = py_processes(sub(lot, "processes")?, &mut mixed)?;
    let fe = sub(inputs, "found_equipment")?;
    let fe = if fe.is_array() || fe.is_object() { crate::held::repr(fe) } else { py_str(fe) };
    let found_no = pyfmt::py_int(fe.split(':').next().unwrap_or("")).map_err(|e| Stop::Py("ValueError", e))?;
    let pitch = n0(Some(sub(inputs, "found_pitch_mm")?))?;
    let inp = inputs.as_object().ok_or(Stop::Hand)?;
    let lot_o = lot.as_object().ok_or(Stop::Hand)?;
    let a = num(inp.get("soil_a_m"))?;
    let b = num(inp.get("soil_b_m"))?;
    let tol = num(inp.get("tolerance_percent"))?.unwrap_or(5.0);
    let (density, density_source) = match num(lot_o.get("density"))? {
        Some(d) if d > 0.0 => (d, "lot"),
        _ => (num(c.get("default_density")?)?.unwrap_or(2.7), "default"),
    };
    // found_t: 番号が発見の番号と同じ最初の工程の厚さ（そこで止まる。後ろの工程の番号はここでは読まない）
    let (mut found_t, mut found_t_v) = (0.0, int0());
    for p in &ps {
        if py_int_value(item(p, "no")?)? == found_no {
            found_t = n0(Some(item(p, "thickness")?))?;
            found_t_v = fl(found_t);
            break;
        }
    }
    let actual = match (a, b) {
        (Some(a), Some(b)) => Some((b - a).abs()),
        _ => None,
    };
    let actual_v = actual.map(fl).unwrap_or(Value::Null);
    let resolver = Resolver::new(&m.equipment);
    let ratio_mode = c.get("trace_ratio")?.cloned().unwrap_or(json!("adjacent"));
    let found_mode = ratio_mode == json!("found");
    let no_of = |p: &Row| py_int_value(item(p, "no")?);

    // ① 工程ごとの値（_derive）
    let eqmap = m.equipment_map()?;
    let mut eqs: Vec<String> = Vec::with_capacity(ps.len());
    for i in 0..ps.len() {
        let eq = sstrip(Some(item(&ps[i], "equipment")?))?;
        let entered = num(ps[i].get("off_back_m"))?;
        let auto = if !eq.is_empty() && c.end_back_eligible(&resolver.canonical(&eq)?)? {
            Calc::end_back_m(&ps[i], if i > 0 { Some(&ps[i - 1]) } else { None }, density)?
        } else {
            None
        };
        let ce = resolver.canonical(&eq)?;
        let (auto_rw, line_dir) = eqmap.get(&ce).cloned().unwrap_or_default();
        let entered_rw = pyfmt::strip(&text(ps[i].get("rewind_master"))).to_string();
        let rw_input = REWIND_VALUES.contains(&entered_rw.as_str());
        let t = n0(Some(item(&ps[i], "thickness")?))?;
        let w = n0(Some(item(&ps[i], "width")?))?;
        let kg = n0(Some(item(&ps[i], "weight")?))?;
        let split = at_least_1(ps[i].get("design_split"))?;
        let vs = at_least_1(ps[i].get("vertical_split"))?;
        let after = if t * w * density != 0.0 { fl(kg * 1000.0 / (w * t * density) / split * vs) } else { int0() };
        let entered_d = num(ps[i].get("inner_diameter_mm"))?;
        let auto_d = c.auto_inner_diameter(&eq)?;
        let input_d = matches!(entered_d, Some(d) if d > 0.0);
        let inner_d = if input_d { entered_d.unwrap_or(0.0) } else { auto_d };
        let r = inner_d / 2.0;
        let off_back_m = entered.unwrap_or(auto.unwrap_or(0.0));
        let p = &mut ps[i];
        p.insert("auto_off_back_m".into(), auto.map(fl).unwrap_or(Value::Null));
        p.insert(
            "off_back_source".into(),
            json!(if entered.is_some() {
                "input"
            } else if auto.is_some() {
                "auto"
            } else {
                ""
            }),
        );
        p.insert("off_back_m".into(), fl(off_back_m));
        p.insert("auto_rewind_master".into(), json!(auto_rw));
        p.insert(
            "rewind_source".into(),
            json!(if rw_input {
                "input"
            } else if !auto_rw.is_empty() {
                "auto"
            } else {
                ""
            }),
        );
        p.insert("rewind_master".into(), json!(if rw_input { entered_rw } else { auto_rw }));
        p.insert("line_direction".into(), json!(line_dir));
        p.insert("after_length_m".into(), after);
        p.insert("auto_inner_diameter_mm".into(), fl(auto_d));
        p.insert("inner_diameter_source".into(), json!(if input_d { "input" } else { "auto" }));
        p.insert("inner_diameter_mm".into(), fl(inner_d));
        let front = off_hint(&ps[i], "off_front_m", "off_front_thickness_mm", t, r)?;
        // 後オフの合計は直した後の off_back_m で数える（Python も p["off_back_m"] を直してから数える）
        let back = off_hint(&ps[i], "off_back_m", "off_back_thickness_mm", t, r)?;
        // 焼鈍（AN）の工程は番号を読まない（Python の `1 if eq.startswith("AN") else (2 if int(p["no"]) == found_no else 0)`）
        let flag = if eq.starts_with("AN") {
            1
        } else if no_of(&ps[i])? == found_no {
            2
        } else {
            0
        };
        let p = &mut ps[i];
        p.insert("total_off_front_m".into(), front);
        p.insert("total_off_back_m".into(), back);
        p.insert("equipment_flag".into(), json!(flag));
        eqs.push(eq);
    }

    // ② 面・側の反転（_track_face_side）
    let (mut face, mut side) = (0, 0);
    for i in 0..ps.len() {
        if i > 0 && !eqs[i].starts_with("AN") {
            let unwind = direction(ps[i].get("unwind"))?;
            let rewind = direction(ps[i].get("rewind_master"))?;
            if !unwind.is_empty() && !rewind.is_empty() && unwind != rewind {
                face = 1 - face;
            }
            let (pl, cl) = (text(ps[i - 1].get("line_direction")), text(ps[i].get("line_direction")));
            if !pl.is_empty() && !cl.is_empty() && pl != cl {
                side = 1 - side;
            }
        }
        ps[i].insert("face_state".into(), json!(face));
        ps[i].insert("side_state".into(), json!(side));
    }

    // ③ 転写距離（_trace_back）。番号はここで初めて全部の工程を読む（A があるときだけ）
    let mut included: Vec<usize> = vec![];
    let mut nos: Vec<Option<PyInt>> = vec![None; ps.len()];
    if a.is_some() {
        for i in 0..ps.len() {
            let n = no_of(&ps[i])?;
            if n <= found_no {
                included.push(i);
            }
            nos[i] = Some(n);
        }
    }
    let is_found = |i: usize| nos[i].as_ref() == Some(&found_no);
    let mut pos: Option<f64> = None;
    let mut head_tail: i64 = 1;
    for idx in (0..included.len()).rev() {
        let i = included[idx];
        let mut prev_pos = pos.map(fl).unwrap_or(Value::Null);
        let (mut ratio, mut off, mut an_skip) = (1.0_f64, json!(0.0), false);
        if is_found(i) {
            let av = a.unwrap_or(0.0);
            prev_pos = fl(av);
            off = ps[i]["total_off_front_m"].clone();
            pos = Some(av + fv(&off));
            head_tail = 1;
        } else {
            let next = *included.get(idx + 1).ok_or_else(|| Stop::Py("IndexError", "list index out of range".into()))?;
            // included[idx + 1]["equipment"].strip(): null・0・False は字でないので AttributeError
            let ne = match &ps[next]["equipment"] {
                x @ Value::String(s) if !crate::held::is_held(x) => pyfmt::strip(s).to_string(),
                x => return Err(no_attr(x, "strip")),
            };
            if ne.starts_with("AN") {
                an_skip = true;
            } else {
                head_tail = 1 - head_tail;
                let t_row = n0(ps[i].get("thickness"))?;
                let t_ref = if found_mode { found_t } else { n0(ps[next].get("thickness"))? };
                ratio = if t_row != 0.0 { t_ref / t_row } else { 1.0 };
                off = if head_tail == 1 { ps[i]["total_off_front_m"].clone() } else { ps[i]["total_off_back_m"].clone() };
                pos = Some(pos.ok_or(Stop::Hand)? * ratio + fv(&off));
            }
        }
        let pos_f = pos.ok_or(Stop::Hand)?;
        let p = &ps[i];
        let other = fv(&p["after_length_m"]) - pos_f;
        let inner_len = if head_tail == 1 { pos_f } else { other };
        let inner_d = fv(&p["inner_diameter_mm"]);
        let r = inner_d / 2.0;
        let t = n0(p.get("thickness"))?;
        let x = r * r + inner_len * t * 1000.0 / PI;
        let inner_th = (if x > 0.0 { x } else { 0.0 }).sqrt() - r;
        let circumference = (2.0 * inner_th + inner_d) * PI / 1000.0;
        let transfer: Value = if is_found(i) {
            actual_v.clone()
        } else if found_t != 0.0 {
            fl(circumference * t / found_t)
        } else {
            int0()
        };
        let agreement: Value = match actual {
            Some(act) if act != 0.0 && truthy_f(&transfer) => {
                let tr = fv(&transfer);
                let (lo, hi) = (if tr < act { tr } else { act }, if tr > act { tr } else { act });
                fl(lo / hi * 100.0)
            }
            Some(_) => int0(),
            None => Value::Null,
        };
        let flag = p["equipment_flag"].as_i64().unwrap_or(0);
        let matched: Value = match actual {
            Some(act) => json!(if flag == 0 { (fv(&transfer) - act).abs() < act * tol / 100.0 } else { false }),
            None => Value::Null,
        };
        let trace = json!({"prev_pos_m": prev_pos, "ratio": fl(ratio), "off_m": off,
                           "off_side": if an_skip { "" } else if head_tail == 1 { "頭" } else { "尾" },
                           "an_skip": an_skip, "circumference_m": fl(circumference)});
        let p = &mut ps[i];
        p.insert("trace".into(), trace);
        p.insert("head_tail".into(), json!(head_tail));
        p.insert("position_from_a_m".into(), fl(pos_f));
        p.insert("position_from_b_m".into(), fl(other));
        p.insert("inner_length_m".into(), fl(inner_len));
        p.insert("inner_thickness_mm".into(), fl(inner_th));
        p.insert("transfer_distance_m".into(), transfer);
        p.insert("agreement_percent".into(), agreement);
        p.insert("transfer_match".into(), matched);
    }

    // 仮の発生設備ごとのたどり直し（_origins）。鍵は str(no)。同じ鍵は後の値・最初の位置（Python の dict）
    let mut origins: Vec<(String, Value)> = vec![];
    for (k, &xi) in included.iter().enumerate() {
        let x = &ps[xi];
        if x["equipment_flag"] != json!(0) {
            continue;
        }
        let circ = fv(&x["trace"]["circumference_m"]);
        let tx = n0(x.get("thickness"))?;
        let outward = if x["head_tail"] == json!(1) { 1.0 } else { -1.0 };
        let mut steps: Vec<Value> = vec![];
        let mut prev_p: Option<usize> = None;
        for &pi_ in &included[k..] {
            let p = &ps[pi_];
            let length_v = p["after_length_m"].clone();
            let length = fv(&length_v);
            let t = n0(p.get("thickness"))?;
            let spacing = if t != 0.0 { circ * tx / t } else { circ };
            let pos1 = fv(&p["position_from_a_m"]);
            let pos2 = pos1 + outward * spacing;
            let a_is_head = p["head_tail"] == json!(1);
            let from_head = |v: f64| if a_is_head { v } else { length - v };
            let inner_d = fv(&p["inner_diameter_mm"]);
            let wall = |inner_len: f64| {
                let r = inner_d / 2.0;
                let il = if inner_len > 0.0 { inner_len } else { 0.0 };
                let x = r * r + il * t * 1000.0 / PI;
                (if x > 0.0 { x } else { 0.0 }).sqrt() - r
            };
            let hs = at_least_1(p.get("horizontal_split"))?;
            let edge = match prev_p {
                Some(j) => (n0(ps[j].get("width"))? - n0(p.get("width"))? * hs) / 2.0,
                None => 0.0,
            };
            let mark = |v: f64| json!({"from_head_m": fl(from_head(v)), "inner_length_m": fl(from_head(v)), "wall_mm": fl(wall(from_head(v)))});
            let eqp = sstrip(p.get("equipment"))?;
            steps.push(json!({
                "no": p["no"], "equipment": p["equipment"], "thickness": fl(t), "width": fl(n0(p.get("width"))?),
                "after_length_m": length_v, "inner_diameter_mm": fl(inner_d),
                "a_end": if a_is_head { "頭" } else { "尾" }, "inner_end": "頭",
                "spacing_m": fl(spacing), "ratio_to_origin": fl(if circ != 0.0 { spacing / circ } else { 1.0 }),
                "marks": [mark(pos1), mark(pos2)],
                "off_front_m": p["total_off_front_m"], "off_back_m": p["total_off_back_m"],
                "off_back_source": p.get("off_back_source").cloned().unwrap_or(json!("")),
                "edge_trim_mm": fl(if edge > 0.0 { edge } else { 0.0 }),
                "annealing": eqp.starts_with("AN"),
                "is_origin": pi_ == xi, "is_found": is_found(pi_),
            }));
            prev_p = Some(pi_);
        }
        let predicted = steps.last().map(|s| s["spacing_m"].clone()).unwrap_or(Value::Null);
        let last = *included.last().ok_or(Stop::Hand)?;
        let o = json!({
            "no": x["no"], "equipment": x["equipment"],
            "soil_a_m": ps[last]["trace"]["prev_pos_m"],
            "inner_length_m": x["inner_length_m"], "inner_thickness_mm": x["inner_thickness_mm"],
            "inner_diameter_mm": x["inner_diameter_mm"], "circumference_m": fl(circ), "thickness": fl(tx),
            "found_thickness_mm": found_t_v, "predicted_m": predicted, "actual_m": actual_v,
            "agreement_percent": x["agreement_percent"], "match": x["transfer_match"], "steps": steps,
        });
        let key = py_str(&x["no"]);
        match origins.iter_mut().find(|(k2, _)| *k2 == key) {
            Some(slot) => slot.1 = o,
            None => origins.push((key, o)),
        }
    }

    // ④ 幅落ち・丈落ち（_losses）
    for i in 0..ps.len() {
        let (t, w, kg) = (n0(ps[i].get("thickness"))?, n0(ps[i].get("width"))?, n0(ps[i].get("weight"))?);
        let al = fv(&ps[i]["after_length_m"]);
        let (mut wl, mut lk, mut lm) = (json!(""), json!(""), json!(""));
        if i > 0 && !eqs[i].is_empty() {
            let dw = n0(ps[i - 1].get("width"))? - w;
            if dw != 0.0 {
                wl = fl(dw * t * density * al * 1000.0 / 1e6);
                let dk = n0(ps[i - 1].get("weight"))? - kg;
                if dk != 0.0 {
                    lk = fl(dk);
                    lm = if t != 0.0 && w != 0.0 && density != 0.0 { fl(dk / t / w * 1e6 / 1e3 / density) } else { json!("") };
                }
            }
        }
        ps[i].insert("width_loss_kg".into(), wl);
        ps[i].insert("length_loss_kg".into(), lk);
        ps[i].insert("length_loss_m".into(), lm);
    }

    // ⑤ ピッチと候補ロール（_pitches・_candidates）
    let mut previous_out: Option<Value> = None;
    for i in 0..ps.len() {
        let eq = &eqs[i];
        let t = n0(ps[i].get("thickness"))?;
        let out_pitch = if t != 0.0 { fl(pitch * found_t / t) } else { int0() };
        let in_pitch = previous_out.clone().unwrap_or_else(int0);
        previous_out = Some(out_pitch.clone());
        let an = eq.starts_with("AN");
        let pin = if eq != "HOT" && !an { in_pitch } else { int0() };
        let din = if truthy_f(&pin) { fl(fv(&pin) / PI) } else { int0() };
        let pout = if !an { out_pitch } else { int0() };
        let dout = if truthy_f(&pout) { fl(fv(&pout) / PI) } else { int0() };
        let cands = candidates(eq, fv(&din), fv(&dout), &m.rolls, tol, &resolver)?;
        let p = &mut ps[i];
        p.insert("pitch_in_mm".into(), pin);
        p.insert("diameter_in_mm".into(), din);
        p.insert("pitch_out_mm".into(), pout);
        p.insert("diameter_out_mm".into(), dout);
        p.insert("roll_candidates".into(), Value::Array(cands));
    }

    let mut ranked: Vec<(f64, Value)> = origins
        .iter()
        .filter(|(_, o)| !o["agreement_percent"].is_null())
        .map(|(_, o)| (fv(&o["agreement_percent"]), o["no"].clone()))
        .collect();
    ranked.sort_by(|x, y| y.0.partial_cmp(&x.0).unwrap_or(std::cmp::Ordering::Equal));
    if mixed {
        // 字でない鍵のある工程（組の並びで書いた工程）: 答えを書くときに鍵を並べられない
        return Err(Stop::Py("TypeError", "'<' not supported between instances of 'str' and 'int'".into()));
    }
    Ok(json!({
        "lot": lot, "inputs": inputs,
        "actual_transfer_distance_m": actual_v,
        "soil_positions_ready": actual.is_some(), "soil_a_ready": a.is_some(),
        "found_thickness_mm": found_t_v, "density": fl(density), "density_source": density_source,
        "trace_ratio": ratio_mode,
        "origins": Value::Object(origins.into_iter().collect()),
        "likely_origin_no": ranked.first().map(|r| r.1.clone()).unwrap_or(Value::Null),
        "processes": ps.into_iter().map(Value::Object).collect::<Vec<_>>(),
    }))
}

/// オフの合計（前オフ・後オフ ＋ オフの厚さの分の巻き）。厚さ 0 の工程は int の 0
fn off_hint(p: &Row, k: &str, th: &str, t: f64, r: f64) -> R<Value> {
    if t != 0.0 {
        let off = n0(p.get(k))?;
        let a = pow2(n0(p.get(th))? + r)?;
        Ok(fl(off + PI * (a - pow2(r)?) / t / 1000.0))
    } else {
        Ok(int0())
    }
}

/// 候補ロール（ロールマスタから、対象径が ±誤差% に入り、設備〈同一工程の名前も〉と入出位置が合う物。_candidates）
fn candidates(eq: &str, dia_in: f64, dia_out: f64, rolls: &[Row], tol: f64, res: &Resolver) -> R<Vec<Value>> {
    let mut out = vec![];
    if eq.is_empty() {
        return Ok(out);
    }
    let (lo, hi) = (1.0 - tol / 100.0, 1.0 + tol / 100.0);
    for r in rolls {
        let req = sstrip(r.get("設備"))?;
        if !(req == eq || res.same(&req, eq)) {
            continue;
        }
        let loc = sstrip(r.get("入出位置"))?;
        let target = if loc == "入側" { dia_in } else { dia_out };
        let rd = num(r.get("ロール径MAX"))?.unwrap_or(-1.0);
        if target != 0.0 && rd >= 0.0 && target * lo <= rd && rd <= target * hi {
            out.push(json!({
                "name": r.get("ロール名").cloned().unwrap_or(json!("")),
                "location": if loc.is_empty() { "ー".to_string() } else { loc },
                "diameter_max_mm": fl(rd),
                "diameter_min_mm": num(r.get("ロール径MIN"))?.map(fl).unwrap_or_else(int0),
                "reference": r.get("基準番号").cloned().unwrap_or(json!("")),
                "condition": r.get("ロール使用条件").cloned().unwrap_or(json!("")),
            }));
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- 道

/// POST /api/calculate・POST /api/equipment/inspection の本文 → 答え。本文の形（読めない・NaN・表でない）は本文の門（body::gate）が
/// 先に断る。Python が例外で答える形は、同じ言葉（error_message）と type の欄で 400（版 3.116.0。前は Python に任せた）。
/// i64・u64 に入らない整数は桁のまま読む（held::body_value）。None は窓が答えない形（門を通らずに来た読めない本文・Stop::Hand）
pub fn handle(path: &str, body: &[u8], calculation: &Value, masters: &Masters) -> Option<(u16, Value)> {
    // request.get_json(silent=True) or {}: 空・偽の値は {}。真の値で表でない本文は門が断っている（ここへ来たら答えない）
    let v = crate::master_rows::py_body_held(body)?;
    let o = v.as_object()?;
    match path {
        "/api/calculate" => {
            if !o.get("lot").is_some_and(truthy) {
                return Some((400, json!({"error": "計算するロット（lot）がありません。"})));
            }
            let r = match o.get("inputs") {
                None => Err(key_err("inputs")),
                Some(inputs) => calculate(calculation, masters, &o["lot"], inputs),
            };
            match r {
                Ok(v) => Some((200, v)),
                Err(Stop::Py(ty, text)) => Some((400, json!({"error": error_message(ty, &text), "type": ty}))),
                Err(Stop::Hand) => None,
            }
        }
        "/api/equipment/inspection" => {
            // [str(n) for n in (body.get("names") or [])][:100]: 並びは 1 つずつ・字は 1 字ずつ・表は鍵。数・真は回せない（TypeError の 500 は
            // master_call の外なので、窓は答えない）
            let names: Vec<String> = match o.get("names").filter(|x| truthy(x)) {
                None => vec![],
                Some(Value::Array(a)) => a.iter().map(py_str).collect(),
                Some(x @ Value::String(s)) if !crate::held::is_held(x) => s.chars().map(String::from).collect(),
                Some(Value::Object(m)) => m.keys().cloned().collect(),
                Some(_) => return None,
            };
            let names: Vec<String> = names.into_iter().take(100).collect();
            Some((200, json!({"inspection": masters.inspection_of(&names)})))
        }
        _ => None,
    }
}

/// 計算の誤りの言葉（版 3.115.0。Python の services/calc_errors.message と同じ決まり。事例の表 tests/fixtures/calc_error_cases.json）。
/// 例外の種類の名前と str(e) → 言葉（知らない種類は str(e) のまま）。版 3.116.0 から窓の道（handle）が使う
pub fn error_message(type_name: &str, text: &str) -> String {
    match type_name {
        "KeyError" => {
            let q = text.chars().next().filter(|c| matches!(c, '\'' | '"'));
            let key = match q {
                Some(c) if text.chars().count() >= 2 && text.ends_with(c) => &text[1..text.len() - 1],
                _ => text,
            };
            format!("計算の入力に「{key}」がありません。")
        }
        "ValueError" => match text.rfind(": '").filter(|_| text.ends_with('\'')) {
            Some(i) if i + 3 < text.len() => {
                format!("計算の入力に数で読めない値「{}」があります（整数で書いてください）。", &text[i + 3..text.len() - 1])
            }
            _ => "計算の入力に数で読めない値があります。".into(),
        },
        "IndexError" => "計算の入力の並び（工程・候補）が足りません。".into(),
        "AttributeError" | "TypeError" => "計算の入力に字でない値があります（字で送ってください）。".into(),
        "OverflowError" => "計算の入力に大きすぎる数があります。".into(),
        _ => text.into(),
    }
}

pub fn is_route(method: &str, path: &str) -> bool {
    method == "POST" && matches!(path, "/api/calculate" | "/api/equipment/inspection")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcards_and_names() {
        let m = |p: &str, s: &str| wild_match(&p.chars().collect::<Vec<_>>(), &s.chars().collect::<Vec<_>>());
        assert!(m("ANI*", "ANI") && m("ANI*", "ANI12") && m("CA?", "CAF") && !m("CA?", "CA") && !m("CA?", "CAFE"));
        assert!(m("*", "") && m("A*B", "AxxB") && !m("A*B", "AxxC"));
        assert_eq!(norm(Some(&json!(" ａｎｆ２ "))), "ANF2");
        assert_eq!(parse_patterns(Some(&json!("anf, ANI*、cal　ANF"))), vec!["ANF", "ANI*", "CAL"]);
    }

    #[test]
    fn pow_is_not_folded() {
        // x*x と C の pow が違う値（Python の (x)**2 は pow）
        let x = 279.01_f64;
        assert_eq!(pow2(x).unwrap().to_bits(), x.powf(std::hint::black_box(2.0)).to_bits());
        // 利用者の決め（2026-11-18）: 2 乗はべき乗のまま。掛け算と違うビットになる値（この値は glibc の pow で 1 ulp 違う）を持つ
        assert!(pow2(1e200).is_err(), "有限の数の 2 乗があふれたら OverflowError");
    }
}
