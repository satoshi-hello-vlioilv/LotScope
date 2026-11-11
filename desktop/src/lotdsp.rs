//! LotDsp（ロット問い合わせ）の 9 本の道（版 3.98.0。窓がただ 1 つの係: sidecar.rs の SERVES に lotdsp。Python は答えない）。
//!
//! 写した Python（program/app）: routes/lots.py の 9 本・services/lotdsp_progress.py（画面の表 → ロットと工程）・lotdsp_api.py
//! （API を引く・項目名を学ぶ・調べる）・lotdsp_link.py（調べる道具の紐づけ）・lotdsp_rules.py（9 本が共にする決まり）。
//! 画面の表の読み方は src/lotdsp_html.rs、見えない Edge と LotDsp の窓は src/lotdsp_direct.rs。
//!
//! 窓は Python に任せない: 本文の端（字でない html・数や null のロット番号・NaN・並び・表でない本文）も、Python と同じ答えか
//! 同じ字で断る（rules::read_body）。答えは Python の道（Python を答えの見本にした突き合わせ: desktop/tests/lotdsp_parity.rs ←
//! program/tests/lotdsp_oracle.py）と、Python に頼らない独立の答え（DOM で読んだ表・仕様から書いた事例の表・作り物の DevTools と
//! 差し替えた時計: desktop/tests/lotdsp_cases.rs）の両方で確かめる。
//!
//! 学びの覚え（作業場所の lotdsp_api_map.json）の書き手は窓の 1 つ（KeyMap の Mutex）。状態の道・/api/config（bundle.rs が同じファイルを
//! 読む）・学ぶ糸は同じ覚えを使い、保存に失敗したらメモリも前に戻す（メモリとファイルを食い違わせない）。

use crate::lotdsp_html::{self, Tables};
use crate::pyfmt;
use crate::pyjson::{self, J};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use unicode_normalization::UnicodeNormalization;

// ================================================================== 9 本が共にする決まり（lotdsp_rules.py と同じ）
pub mod rules {
    use super::J;
    use unicode_normalization::UnicodeNormalization;

    /// 前後から除く空白（Python の strip と JS の trim のどちらでも空白の字）
    pub const SITE_SPACES: &[char] = &[
        '\t', '\n', '\x0b', '\x0c', '\r', ' ', '\u{a0}', '\u{1680}', '\u{2000}', '\u{2001}', '\u{2002}', '\u{2003}', '\u{2004}',
        '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}', '\u{2009}', '\u{200a}', '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}',
    ];
    pub const API_PATH: &str = "/service/lotdsp/search//searchAction";
    pub const SEARCH_PAGE: &str = "/#/lotdsp";

    /// LotDsp の場所（前後の空白を除き、# から後ろを捨て、末尾の / を除く）
    pub fn site_base(url: &str) -> String {
        let s = url.trim_matches(SITE_SPACES);
        let s = s.split('#').next().unwrap_or("");
        s.trim_end_matches('/').to_string()
    }

    pub fn api_search_url(url: &str) -> String {
        let b = site_base(url);
        if b.is_empty() {
            b
        } else {
            b + API_PATH
        }
    }

    pub fn direct_search_url(url: &str) -> String {
        let b = site_base(url);
        if b.is_empty() {
            b
        } else {
            b + SEARCH_PAGE
        }
    }

    /// 決め ①: API の日時は日本時間（時）
    pub const TZ_HOURS: i64 = 9;

    /// 桁区切り（「,」と空白）を除く: 先頭の数の小数点・指数より前で、前が数字・後ろがちょうど 3 桁の数字のまとまりのときだけ
    fn ungroup(s: &[char]) -> Vec<char> {
        let dig = |c: char| c.is_ascii_digit();
        let (mut out, n) = (Vec::with_capacity(s.len()), s.len());
        let mut i = 0;
        while i < n {
            let c = s[i];
            if matches!(c, '.' | 'e' | 'E') {
                out.extend_from_slice(&s[i..]);
                return out;
            }
            if (c == ',' || crate::pyfmt::is_space(c))
                && out.last().is_some_and(|x: &char| dig(*x))
                && i + 4 <= n
                && s[i + 1..i + 4].iter().all(|x| dig(*x))
                && (i + 4 == n || !dig(s[i + 4]))
            {
                i += 1;
                continue;
            }
            if !(dig(c) || matches!(c, '+' | '-' | ',')) {
                out.extend_from_slice(&s[i..]);
                return out;
            }
            out.push(c);
            i += 1;
        }
        out
    }

    /// 読んだ様子（read_number）
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub enum How {
        Ok,
        Empty,
        Unreadable,
        Extra,
    }

    impl How {
        pub fn name(self) -> &'static str {
            match self {
                How::Ok => "ok",
                How::Empty => "empty",
                How::Unreadable => "unreadable",
                How::Extra => "extra",
            }
        }
    }

    /// 決め ②（2026-11-11 に言い直した）: NFKC で全角をそろえ、桁区切りを除き、先頭の数の全体（符号・小数点・先頭の点・指数）を読み、
    /// 後ろの単位などの字は捨てる → (値, 様子, 読んだ先頭の字)。先頭に数が無い空でない字は読めない・捨てた後ろに数字があれば Extra
    pub fn read_number_str(text: &str) -> (Option<f64>, How, String) {
        let s: String = text.nfkc().collect::<String>().replace('\u{2212}', "-");
        let s = crate::pyfmt::strip(&s);
        if s.is_empty() {
            return (None, How::Empty, String::new());
        }
        let c = ungroup(&s.chars().collect::<Vec<char>>());
        let dig = |i: usize| c.get(i).is_some_and(char::is_ascii_digit);
        let mut i = 0;
        if matches!(c.first(), Some('+' | '-')) {
            i += 1;
        }
        let st = i;
        while dig(i) {
            i += 1;
        }
        let int_d = i - st;
        let mut frac_d = 0;
        if c.get(i) == Some(&'.') && (int_d > 0 || dig(i + 1)) {
            i += 1;
            while dig(i) {
                i += 1;
                frac_d += 1;
            }
        }
        if int_d == 0 && frac_d == 0 {
            return (None, How::Unreadable, String::new());
        }
        if matches!(c.get(i), Some('e' | 'E')) {
            let mut j = i + 1;
            if matches!(c.get(j), Some('+' | '-')) {
                j += 1;
            }
            let e0 = j;
            while dig(j) {
                j += 1;
            }
            if j > e0 {
                i = j;
            }
        }
        let lead: String = c[..i].iter().collect();
        let v: f64 = lead.parse().unwrap_or(f64::NAN);
        if !v.is_finite() {
            return (None, How::Unreadable, String::new());
        }
        let extra = c[i..].iter().any(|x| crate::pyfmt::digit(*x).is_some());
        (Some(v), if extra { How::Extra } else { How::Ok }, lead)
    }

    /// read_number の値だけ
    pub fn to_number_str(text: &str) -> Option<f64> {
        read_number_str(text).0
    }

    /// read_number（数そのものは str() してから読む。真偽・None は空）
    pub fn read_number(v: &J) -> (Option<f64>, How, String) {
        match v {
            J::Null | J::Bool(_) => (None, How::Empty, String::new()),
            J::Str(s) => read_number_str(s),
            _ => read_number_str(&v.py_str()),
        }
    }

    /// to_number（数そのものは str() してから読む。真偽・None は None）
    pub fn to_number(v: &J) -> Option<f64> {
        match v {
            J::Null | J::Bool(_) => None,
            J::Str(s) => to_number_str(s),
            _ => to_number_str(&v.py_str()),
        }
    }

    /// 画面の数（小数 dec 桁）が応答の数 raw を丸めた物か（整数の欄は応答も整数のときだけ）
    pub fn round_eq(shown: f64, dec: usize, raw: f64) -> bool {
        if (shown - raw).abs() > 0.5 * 10f64.powf(-(dec as f64)) + 1e-9 || (shown - raw).is_nan() {
            return false;
        }
        dec > 0 || (raw - raw.round_ties_even()).abs() < 1e-9
    }

    /// 決め ③: プロキシを通さない 1 回だけ。プロキシの答えは届いていない
    pub const PROXY_ANSWERS: [i64; 4] = [407, 502, 503, 504];

    pub fn reached_status(code: i64) -> bool {
        !PROXY_ANSWERS.contains(&code)
    }

    /// 道の全体の秒（小数 1 桁。Python の round(x, 1)）
    pub fn seconds_of(t0: f64, t1: f64) -> f64 {
        format!("{:.1}", (t1 - t0).max(0.0)).parse().unwrap_or(0.0)
    }

    pub const LOT_MAX: usize = 12;

    /// ロット番号の字をそろえる（NFKC・前後の空白・大文字）。字でなければ Err
    pub fn norm_lot(v: Option<&J>) -> Result<String, String> {
        match v {
            None | Some(J::Null) => Ok(String::new()),
            Some(J::Str(s)) => Ok(crate::pyfmt::strip(&s.nfkc().collect::<String>()).to_uppercase()),
            Some(_) => Err("ロット番号は字で送ってください。".into()),
        }
    }

    pub fn checked_lot_str(lot: &str) -> Result<String, String> {
        let ok = !lot.is_empty() && lot.chars().count() <= LOT_MAX && lot.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
        if ok {
            Ok(lot.to_string())
        } else {
            Err(format!("ロット番号の形が違います（{}）", if lot.is_empty() { "空" } else { lot }))
        }
    }

    /// ロット番号（英数字 1〜12 字）
    pub fn checked_lot(v: Option<&J>) -> Result<String, String> {
        checked_lot_str(&norm_lot(v)?)
    }

    pub const MAX_HTML_CHARS: usize = 5_000_000;
    pub const MAX_DEPTH: usize = 64;

    fn depth_ok(text: &str) -> bool {
        let (mut depth, mut in_str, mut esc) = (0i64, false, false);
        for ch in text.chars() {
            if in_str {
                if esc {
                    esc = false;
                } else if ch == '\\' {
                    esc = true;
                } else if ch == '"' {
                    in_str = false;
                }
            } else if ch == '"' {
                in_str = true;
            } else if ch == '[' || ch == '{' {
                depth += 1;
                if depth > MAX_DEPTH as i64 {
                    return false;
                }
            } else if ch == ']' || ch == '}' {
                depth -= 1;
            }
        }
        true
    }

    /// 本文 → 表。空・null は空の表。読めなければ Err（400 invalid の字）
    pub fn read_body(raw: &[u8]) -> Result<J, String> {
        if raw.is_empty() {
            return Ok(J::obj());
        }
        let Ok(text) = std::str::from_utf8(raw) else { return Err("本文を UTF-8 として読めません。".into()) };
        if !depth_ok(text) {
            return Err("本文の入れ子が深すぎます。".into());
        }
        match crate::pyjson::loads(text) {
            Err(_) => Err("本文を JSON として読めません。".into()),
            Ok(J::Null) => Ok(J::obj()),
            Ok(v @ J::Obj(_)) => Ok(v),
            Ok(_) => Err("本文の形が違います（表で送ってください）。".into()),
        }
    }

    pub fn html_of(body: &J, key: &str) -> Result<String, String> {
        match body.get(key) {
            None | Some(J::Null) => Ok(String::new()),
            Some(J::Str(s)) => Ok(s.clone()),
            Some(_) => Err("HTML は字で送ってください。".into()),
        }
    }

    pub fn flag_of(body: &J, key: &str) -> bool {
        body.get(key) == Some(&J::Bool(true))
    }

    /// BOX の№（int()。|値| が 1e9 以上・有限でない数は読まない: 版 3.98.0。前は巨大な整数を答えに書いた）
    pub fn box_of(f: f64) -> Option<i64> {
        (f.is_finite() && f.abs() < 1e9).then(|| f.trunc() as i64)
    }
}

// ================================================================== Python の値の扱い（設定の Value）
/// bool(v)
pub fn truthy(v: Option<&Value>) -> bool {
    crate::bundle::py_truthy(v.unwrap_or(&Value::Null))
}

/// str(v)
pub fn py_str_value(v: &Value) -> String {
    J::from_value(v).py_str()
}

/// str(v or "")
pub fn py_text(v: Option<&Value>) -> String {
    match v {
        Some(x) if truthy(Some(x)) => py_str_value(x),
        _ => String::new(),
    }
}

/// float(v)（無ければ既定）
pub fn py_float_of(v: Option<&Value>, def: f64) -> Result<f64, String> {
    match v {
        None => Ok(def),
        Some(Value::Number(n)) => Ok(n.as_f64().unwrap_or(f64::NAN)),
        Some(Value::Bool(b)) => Ok(if *b { 1.0 } else { 0.0 }),
        Some(Value::String(s)) => pyfmt::py_float(s),
        Some(x) => Err(format!("float() argument must be a string or a real number, not '{}'", J::from_value(x).type_name())),
    }
}

/// `x.get(k) or {}`（表でなければ空）
pub fn section(v: &Value, k: &str) -> Map<String, Value> {
    match v.get(k) {
        Some(Value::Object(o)) => o.clone(),
        _ => Map::new(),
    }
}

/// format(f, ".{prec}g")（Python の g: 指数が -4 未満か prec 以上なら指数、末尾の 0 は除く）
pub fn py_g(f: f64, prec: usize) -> String {
    if f.is_nan() {
        return "nan".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "inf" } else { "-inf" }.into();
    }
    if f == 0.0 {
        return if f.is_sign_negative() { "-0" } else { "0" }.into();
    }
    let p = prec.max(1);
    let e = format!("{:.*e}", p - 1, f);
    let (m, x) = e.split_once('e').unwrap();
    let x: i32 = x.parse().unwrap();
    let strip = |s: String| if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.').to_string() } else { s };
    if x < -4 || x >= p as i32 {
        format!("{}e{}{:02}", strip(m.to_string()), if x < 0 { '-' } else { '+' }, x.abs())
    } else {
        strip(format!("{:.*}", (p as i32 - 1 - x).max(0) as usize, f))
    }
}

/// json.dumps(字)（ensure_ascii）
pub fn json_ascii(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || (c as u32) > 0x7e => {
                let mut b = [0u16; 2];
                for u in c.encode_utf16(&mut b) {
                    out.push_str(&format!("\\u{:04x}", u));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// unicodedata.normalize("NFKC", str(v)).strip()
fn nfkc(s: &str) -> String {
    pyfmt::strip(&s.nfkc().collect::<String>()).to_string()
}

/// equipment_names.compact（NFKC・空白を除く）
fn compact(s: &str) -> String {
    s.nfkc().filter(|c| !pyfmt::is_space(*c)).collect()
}

/// equipment_names.norm（compact・大文字）
fn name_key(s: &str) -> String {
    compact(s).to_uppercase()
}

fn is_d(c: char) -> bool {
    pyfmt::digit(c).is_some()
}

/// re.sub(r"\D", "", s)
fn digits_of(s: &str) -> String {
    s.chars().filter(|c| is_d(*c)).collect()
}

/// _NUM_TEXT = ^[+-]?[\d,]*\.?\d+$
fn num_text(s: &str) -> bool {
    let c: Vec<char> = s.chars().collect();
    let mut i = 0;
    if matches!(c.first(), Some('+' | '-')) {
        i = 1;
    }
    // 最後の字は数字、その前は [\d,]* と任意の 1 つの「.」（「.」の後は数字だけ）
    if c.len() <= i || !is_d(*c.last().unwrap()) {
        return false;
    }
    let body = &c[i..];
    match body.iter().position(|x| *x == '.') {
        Some(p) => body[..p].iter().all(|x| is_d(*x) || *x == ',') && body[p + 1..].iter().all(|x| is_d(*x)) && p + 1 < body.len(),
        None => body.iter().all(|x| is_d(*x) || *x == ','),
    }
}

/// _DATEISH = ^[\d\s/:.,\-]+$
fn dateish(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| is_d(c) || pyfmt::is_space(c) || matches!(c, '/' | ':' | '.' | ',' | '-'))
}

/// float(字)（Python の float。読めなければ None）
fn pyfloat(s: &str) -> Option<f64> {
    pyfmt::py_float(s).ok()
}

// ================================================================== 進度情報の表 → ロット（lotdsp_progress.py）
const DEFAULT_ACTUAL: [(&str, &str); 10] = [
    ("no", "№"),
    ("equipment", "設備"),
    ("work_date", "日付"),
    ("thickness", "板厚"),
    ("width", "板幅"),
    ("weight", "重量"),
    ("pieces", "枚本"),
    ("length_m", "長さ"),
    ("off_front_m", "前オフ"),
    ("off_back_m", "後オフ"),
];
const DEFAULT_DESIGN: [(&str, &str); 5] =
    [("no", "№"), ("equipment", "設備"), ("horizontal_split", "横"), ("vertical_split", "縦"), ("pieces", "枚本")];
const DEFAULT_LOT_LABELS: [(&str, &str); 7] = [
    ("lot_no", "ロット番号"),
    ("casting_no", "鋳造番号"),
    ("inspection_no", "検査番号"),
    ("order_no", "オーダー番号"),
    ("use_code", "用途"),
    ("use_name", "用途名"),
    ("density", "比重"),
];
const DEFAULT_PRODUCT: [(&str, &str); 5] =
    [("material", "材質"), ("temper", "調質"), ("product_thickness", "板厚"), ("product_width", "板幅"), ("product_length", "板丈")];
const PROCESS_HEADER_KEYS: [&str; 5] = ["設備", "日付", "板厚", "板幅", "重量"];
pub const DEFAULT_UNWIND: &str = "上";

/// dict(DEFAULT, **(cfg.get(key) or {}))
fn columns(cfg: &Value, key: &str, defaults: &[(&str, &str)]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = defaults.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    for (k, v) in section(cfg, key) {
        let v = py_str_value(&v);
        match out.iter_mut().find(|(n, _)| *n == k) {
            Some(slot) => slot.1 = v,
            None => out.push((k, v)),
        }
    }
    out
}

/// 工程の行（{項目: 画面の字}・BOX の№）
#[derive(Debug, Clone)]
pub struct Row {
    pub no: i64,
    pub cells: Vec<(String, String)>,
}

impl Row {
    pub fn get(&self, k: &str) -> &str {
        self.cells.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str()).unwrap_or("")
    }

    fn has(&self, k: &str) -> bool {
        self.cells.iter().any(|(n, _)| n == k)
    }

    fn set(&mut self, k: &str, v: String) {
        match self.cells.iter_mut().find(|(n, _)| n == k) {
            Some(s) => s.1 = v,
            None => self.cells.push((k.to_string(), v)),
        }
    }
}

fn header_index(header: &[String], cols: &[(String, String)]) -> Vec<(String, usize)> {
    let labels: Vec<String> = header.iter().map(|h| compact(h)).collect();
    cols.iter().filter_map(|(k, label)| labels.iter().position(|l| *l == compact(label)).map(|i| (k.clone(), i))).collect()
}

fn truthy_num(x: Option<f64>) -> bool {
    x.is_some_and(|f| f != 0.0)
}

fn process_rows(rows: &[Vec<String>], cols: &[(String, String)]) -> (Vec<Row>, Vec<(String, usize)>) {
    let idx = header_index(&rows[0], cols);
    let mut out = vec![];
    for r in &rows[1..] {
        let cell = |k: &str| -> String { idx.iter().find(|(n, _)| n == k).and_then(|(_, i)| r.get(*i)).cloned().unwrap_or_default() };
        let Some(no) = rules::to_number_str(&cell("no")) else { continue };
        let equipment = pyfmt::strip(&cell("equipment")).to_string();
        if equipment.is_empty() && !["thickness", "width", "weight"].iter().any(|k| truthy_num(rules::to_number_str(&cell(k)))) {
            continue;
        }
        let Some(no) = rules::box_of(no) else { continue };
        let mut row = Row { no, cells: idx.iter().map(|(k, _)| (k.clone(), cell(k))).collect() };
        row.set("equipment", equipment);
        out.push(row);
    }
    (out, idx)
}

fn classify(rows: &[Vec<String>]) -> Option<&'static str> {
    let labels: BTreeSet<String> = rows[0].iter().map(|h| compact(h)).collect();
    if !PROCESS_HEADER_KEYS.iter().all(|k| labels.contains(*k)) {
        return None;
    }
    if labels.contains("前オフ") || labels.contains("後オフ") {
        return Some("actual");
    }
    if labels.contains("横") && labels.contains("縦") {
        return Some("design");
    }
    None
}

/// 読めない（Python の例外）: 型の名前と字
#[derive(Debug, Clone, PartialEq)]
pub struct PyErr {
    pub ty: &'static str,
    pub msg: String,
}

fn py_err<T>(ty: &'static str, msg: impl Into<String>) -> Result<T, PyErr> {
    Err(PyErr { ty, msg: msg.into() })
}

fn process_tables(tables: &Tables, cfg: &Value) -> Result<(Vec<Row>, Vec<Row>), PyErr> {
    let (mut actual, mut design) = (None, None);
    for rows in tables {
        match classify(rows) {
            Some("actual") if actual.is_none() => actual = Some(rows),
            Some("design") if design.is_none() => design = Some(rows),
            _ => {}
        }
    }
    let Some(actual) = actual else {
        return py_err(
            "LookupError",
            "進度情報の「実績」の表が見つかりません。ロット問い合わせで進度情報タブを開いた画面か確かめてください。",
        );
    };
    let acols = columns(cfg, "actual_columns", &DEFAULT_ACTUAL);
    let (actual_rows, actual_idx) = process_rows(actual, &acols);
    let design_rows = match design {
        Some(d) => process_rows(d, &columns(cfg, "design_columns", &DEFAULT_DESIGN)).0,
        None => vec![],
    };
    let missing: Vec<String> = ["equipment", "thickness", "width", "weight"]
        .iter()
        .filter(|k| !actual_idx.iter().any(|(n, _)| n == *k))
        .map(|k| acols.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()).unwrap_or_default())
        .collect();
    if !missing.is_empty() {
        return py_err("LookupError", format!("実績の表に次の列が見つかりません: {}", missing.join("、")));
    }
    Ok((actual_rows, design_rows))
}

/// 見出し項目の小さな表 → {正規化した見出し: 値}（先に出たほうを採る）
fn lot_pairs(tables: &Tables) -> Vec<(String, String)> {
    let mut pairs: Vec<(String, String)> = vec![];
    let mut put = |k: &str, v: &str| {
        if !k.is_empty() {
            let key = compact(k);
            if !pairs.iter().any(|(n, _)| *n == key) {
                pairs.push((key, v.to_string()));
            }
        }
    };
    for rows in tables {
        if rows.iter().all(|r| r.len() == 2) {
            for r in rows {
                put(&r[0], &r[1]);
            }
        } else if rows.len() == 2 && rows[0].len() == rows[1].len() {
            for (k, v) in rows[0].iter().zip(&rows[1]) {
                put(k, v);
            }
        }
    }
    pairs
}

fn product(tables: &Tables, cols: &[(String, String)]) -> Vec<(String, String)> {
    for rows in tables {
        let labels: Vec<String> = rows[0].iter().map(|h| compact(h)).collect();
        if labels.iter().any(|l| l == "材質") && labels.iter().any(|l| l == "調質") && rows.len() >= 2 {
            let last = rows.last().unwrap();
            return header_index(&rows[0], cols).into_iter().filter_map(|(k, i)| last.get(i).map(|v| (k, v.clone()))).collect();
        }
    }
    vec![]
}

/// 画面のロットの見出し項目と製品の材質・寸法（字のまま）
pub fn lot_fields(tables: &Tables, cfg: &Value) -> J {
    let pairs = lot_pairs(tables);
    let mut lot = J::obj();
    for (k, label) in columns(cfg, "lot_labels", &DEFAULT_LOT_LABELS) {
        let key = compact(&label);
        lot.set(&k, J::Str(pairs.iter().find(|(n, _)| *n == key).map(|(_, v)| v.clone()).unwrap_or_default()));
    }
    for (k, v) in product(tables, &columns(cfg, "product_columns", &DEFAULT_PRODUCT)) {
        lot.set(&k, J::Str(v));
    }
    lot
}

/// ロットの項目をそろえる（比重・寸法は数に）。読んだロット番号が頼んだものと違えば ValueError
pub fn check_lot(mut lot: J, expect: &str) -> Result<J, PyErr> {
    for k in ["density", "product_thickness", "product_width", "product_length"] {
        if let Some(v) = lot.get(k) {
            let n = rules::to_number(v);
            lot.set(k, n.map(J::Float).unwrap_or(J::Int(0)));
        }
    }
    let page_lot = pyfmt::strip(&lot.get("lot_no").filter(|v| v.truthy()).map(J::py_str).unwrap_or_default()).to_string();
    let want = pyfmt::strip(expect).to_string();
    if !want.is_empty() && !page_lot.is_empty() && name_key(&page_lot) != name_key(&want) {
        return py_err("ValueError", format!("画面のロット番号（{page_lot}）が、取込を頼んだロット番号（{want}）と違います。"));
    }
    if page_lot.is_empty() {
        lot.set("lot_no", J::Str(want));
    }
    Ok(lot)
}

/// 設備マスタ（行は表）
pub struct Master {
    rows: Vec<Map<String, Value>>,
}

impl Master {
    pub fn new(rows: &[Value]) -> Master {
        Master { rows: rows.iter().filter_map(|r| r.as_object().cloned()).collect() }
    }
}

fn int_or(v: &str, def: i64) -> i64 {
    match rules::to_number_str(v) {
        Some(n) if n != 0.0 && n.abs() < 1e9 => n.round_ties_even() as i64,
        Some(n) if n != 0.0 => def,
        _ => def,
    }
}

/// 実績の数の欄（板厚・板幅・重量・オフ）→ 値。空は 0、読めない字は空（null）にして知らせる。先頭の数だけを読んで後ろに数字を
/// 捨てたときも知らせる（版 3.98.0。作った後の採点の割れ 1。Python の lotdsp_progress._num_cell と同じ字）
fn num_cell(v: &str, no: i64, label: &str, warnings: &mut Vec<J>) -> J {
    let (n, how, lead) = rules::read_number_str(v);
    match how {
        rules::How::Unreadable => {
            warnings.push(J::Str(format!("№{no}: {label}「{v}」を数として読めませんでした（空として取り込みました）")));
            return J::Null;
        }
        rules::How::Extra => warnings.push(J::Str(format!("№{no}: {label}「{v}」は先頭の「{lead}」だけを数として読みました"))),
        _ => {}
    }
    match n {
        Some(n) if n != 0.0 => J::Float(n),
        _ => J::Int(0),
    }
}

fn processes(actual: &[Row], design: &[Row], master: &Master, only_master: bool, labels: &[(String, String)]) -> (Vec<J>, J) {
    let label = |k: &str| labels.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()).unwrap_or_else(|| k.to_string());
    let resolver = crate::calc::Resolver::new(&master.rows);
    let (mut procs, mut skipped, mut warnings, mut renamed, mut pending) = (vec![], vec![], vec![], vec![], vec![]);
    let design_by: BTreeMap<i64, &Row> = design.iter().map(|r| (r.no, r)).collect();
    let actual_by: BTreeMap<i64, &Row> = actual.iter().map(|r| (r.no, r)).collect();
    let resolve = |no: i64, raw: &str, why: &str, skipped: &mut Vec<J>, renamed: &mut Vec<J>| -> Option<String> {
        let hit = resolver.resolve_how(raw);
        if hit.is_none() && only_master {
            skipped.push(J::Obj(vec![
                ("no".into(), J::Int(no)),
                ("equipment".into(), J::Str(raw.into())),
                ("reason".into(), J::Str(why.into())),
            ]));
            return None;
        }
        let eq = match &hit {
            Some((m, _, _)) => pyfmt::strip(&py_text(m.get("設備名"))).to_string(),
            None => raw.to_string(),
        };
        if let Some((_, how, pattern)) = &hit {
            if (*how == "alias" || *how == "pattern") && name_key(raw) != name_key(&eq) {
                renamed.push(J::Obj(vec![
                    ("no".into(), J::Int(no)),
                    ("from".into(), J::Str(raw.into())),
                    ("to".into(), J::Str(eq.clone())),
                    ("by".into(), J::Str(pattern.clone())),
                ]));
            }
        }
        Some(eq)
    };
    let nos: BTreeSet<i64> = actual_by.keys().chain(design_by.keys()).copied().collect();
    for no in nos {
        let Some(r) = actual_by.get(&no) else {
            let Some(eq) = resolve(no, design_by[&no].get("equipment"), "設備マスタに無い設備（実績なし）", &mut skipped, &mut renamed)
            else {
                continue;
            };
            pending.push(J::Obj(vec![("no".into(), J::Int(no)), ("equipment".into(), J::Str(eq.clone()))]));
            let n = procs.len() as i64 + 1;
            procs.push(J::Obj(vec![
                ("no".into(), J::Int(n)),
                ("equipment".into(), J::Str(eq)),
                ("unwind".into(), J::Null),
                ("thickness".into(), J::Null),
                ("width".into(), J::Null),
                ("weight".into(), J::Null),
                ("off_front_m".into(), J::Null),
                ("off_back_m".into(), J::Null),
                ("work_date".into(), J::Str(String::new())),
                ("design_split".into(), J::Null),
                ("horizontal_split".into(), J::Null),
                ("vertical_split".into(), J::Null),
                ("lotdsp_no".into(), J::Int(no)),
            ]));
            continue;
        };
        let mut raw = r.get("equipment").to_string();
        if raw.is_empty() {
            if let Some(d) = design_by.get(&no) {
                raw = d.get("equipment").to_string(); // 実績の値はあるが名前が空欄 → 設計の名前
            }
        }
        if raw.is_empty() {
            skipped.push(J::Obj(vec![
                ("no".into(), J::Int(no)),
                ("equipment".into(), J::Str(String::new())),
                ("reason".into(), J::Str("設備名が実績にも設計にもありません".into())),
            ]));
            continue;
        }
        let Some(eq) = resolve(no, &raw, "設備マスタに無い設備", &mut skipped, &mut renamed) else { continue };
        let mut d = design_by.get(&no).copied();
        if let Some(dd) = d {
            if !resolver.same(dd.get("equipment"), &raw) {
                warnings.push(J::Str(format!(
                    "№{no}: 設計は{}、実績は{raw}でした。実績の設備で取り込み、分割数は実績の枚本を使いました。",
                    dd.get("equipment")
                )));
                d = None;
            }
        }
        let nums: Vec<J> = ["thickness", "width", "weight", "off_front_m", "off_back_m"]
            .iter()
            .map(|k| num_cell(r.get(k), no, &label(k), &mut warnings))
            .collect();
        let dget = |k: &str| d.map(|x| x.get(k)).unwrap_or("");
        let pieces = if !dget("pieces").is_empty() { dget("pieces") } else { r.get("pieces") };
        let n = procs.len() as i64 + 1;
        procs.push(J::Obj(vec![
            ("no".into(), J::Int(n)),
            ("equipment".into(), J::Str(eq)),
            ("unwind".into(), J::Str(DEFAULT_UNWIND.into())),
            ("thickness".into(), nums[0].clone()),
            ("width".into(), nums[1].clone()),
            ("weight".into(), nums[2].clone()),
            ("off_front_m".into(), nums[3].clone()),
            ("off_back_m".into(), nums[4].clone()),
            ("work_date".into(), J::Str(r.get("work_date").to_string())),
            ("design_split".into(), J::Int(int_or(pieces, 1))),
            ("horizontal_split".into(), J::Int(int_or(dget("horizontal_split"), 1))),
            ("vertical_split".into(), J::Int(int_or(dget("vertical_split"), 1))),
            ("lotdsp_no".into(), J::Int(no)),
        ]));
    }
    let notes = J::Obj(vec![
        ("skipped".into(), J::Arr(skipped)),
        ("renamed".into(), J::Arr(renamed)),
        ("planned".into(), J::Arr(pending)),
        ("warnings".into(), J::Arr(warnings)),
    ]);
    (procs, notes)
}

/// 進度情報の HTML → (表, 実績の行, 設計の行)
pub fn progress_tables(html: &str, cfg: &Value) -> Result<(Tables, Vec<Row>, Vec<Row>), PyErr> {
    if pyfmt::strip(html).is_empty() {
        return py_err("ValueError", "取り込む HTML が空です。");
    }
    if html.chars().count() > rules::MAX_HTML_CHARS {
        return py_err("ValueError", "HTML が大きすぎます（進度情報の画面だけを渡してください）。");
    }
    let tables = lotdsp_html::inner_tables(html).map_err(|m| PyErr { ty: "ValueError", msg: m })?;
    let (a, d) = process_tables(&tables, cfg)?;
    Ok((tables, a, d))
}

/// ロットの項目と実績・設計の行 → (lot, report)
pub fn build_lot(lot: J, actual: &[Row], design: &[Row], master: &Master, cfg: &Value, source: &str) -> Result<(J, J), PyErr> {
    let only = cfg.get("only_master_equipment").map(|v| truthy(Some(v))).unwrap_or(true);
    let labels = columns(cfg, "actual_columns", &DEFAULT_ACTUAL);
    let (procs, notes) = processes(actual, design, master, only, &labels);
    if !procs.iter().any(|p| !matches!(p.get("thickness"), Some(J::Null))) {
        return py_err("LookupError", "取り込める工程がありません（実績の行が無いか、すべて設備マスタに無い設備です）。");
    }
    let imported: Vec<J> = procs
        .iter()
        .map(|p| {
            J::Obj(vec![
                ("no".into(), p.get("no").cloned().unwrap()),
                ("lotdsp_no".into(), p.get("lotdsp_no").cloned().unwrap()),
                ("equipment".into(), p.get("equipment").cloned().unwrap()),
            ])
        })
        .collect();
    let mut report = J::Obj(vec![
        ("source".into(), J::Str(source.into())),
        ("lot_no".into(), lot.get("lot_no").cloned().unwrap_or(J::Str(String::new()))),
        ("actual_rows".into(), J::Int(actual.len() as i64)),
        ("imported".into(), J::Arr(imported)),
    ]);
    for (k, v) in notes.entries() {
        report.set(k, v.clone());
    }
    report.set("default_unwind", J::Str(DEFAULT_UNWIND.into()));
    let mut lot = lot;
    lot.set("processes", J::Arr(procs));
    Ok((lot, report))
}

const PROC_FIELDS: [(&str, &str); 14] = [
    ("no", ""),
    ("equipment", ""),
    ("unwind", "上"),
    ("thickness", "0"),
    ("width", "0"),
    ("weight", "0"),
    ("off_front_m", "0"),
    ("off_back_m", "0"),
    ("off_front_thickness_mm", "0"),
    ("off_back_thickness_mm", "0"),
    ("work_date", "s"),
    ("design_split", "1"),
    ("horizontal_split", "1"),
    ("vertical_split", "1"),
];
const LOT_FIELDS: [(&str, &str); 11] = [
    ("inspection_no", "s"),
    ("casting_no", "s"),
    ("order_no", "s"),
    ("use_code", "s"),
    ("use_name", "s"),
    ("material", "s"),
    ("temper", "s"),
    ("product_thickness", "0"),
    ("product_width", "0"),
    ("product_length", "0"),
    ("density", "0"),
];

fn default_of(d: &str) -> J {
    match d {
        "s" => J::Str(String::new()),
        "上" => J::Str("上".into()),
        "0" => J::Int(0),
        "1" => J::Int(1),
        _ => J::Null,
    }
}

/// (lot, report) → Lot.to_dict()（models に無い項目は落とし、無い項目は既定で埋める）
pub fn to_models(data: &J, expect: &str) -> Value {
    let mut out = Map::new();
    let lot_no = data.get("lot_no").filter(|v| v.truthy()).map(J::py_str).unwrap_or_else(|| expect.to_string());
    out.insert("lot_no".into(), json!(lot_no));
    for (k, d) in LOT_FIELDS {
        out.insert(k.into(), data.get(k).cloned().unwrap_or_else(|| default_of(d)).to_value());
    }
    let procs: Vec<Value> = data
        .get("processes")
        .map(J::items)
        .unwrap_or(&[])
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let mut m = Map::new();
            for (k, d) in PROC_FIELDS {
                let v = match (k, p.get(k)) {
                    (_, Some(v)) => v.clone(),
                    ("no", None) => J::Int(i as i64 + 1),
                    _ => default_of(d),
                };
                m.insert(k.into(), v.to_value());
            }
            Value::Object(m)
        })
        .collect();
    out.insert("processes".into(), Value::Array(procs));
    Value::Object(out)
}

/// 読んだ物（Lot.to_dict()・report・表・実績の行・設計の行）
pub type Read = (Value, Value, Tables, Vec<Row>, Vec<Row>);

/// 進度情報の HTML → (Lot.to_dict(), report)
pub fn read_html(html: &str, master: &Master, cfg: &Value, expect: &str) -> Result<Read, PyErr> {
    let (tables, actual, design) = progress_tables(html, cfg)?;
    let lot = check_lot(lot_fields(&tables, cfg), expect)?;
    let (data, report) = build_lot(lot, &actual, &design, master, cfg, "LotDsp 進度情報")?;
    Ok((to_models(&data, expect), report.to_value(), tables, actual, design))
}

// ================================================================== LotDsp の API（lotdsp_api.py）
#[derive(Debug, Clone)]
pub struct ApiCfg {
    pub enabled: bool,
    pub search_url: String,
    pub timeout: f64,
    pub fields: Vec<(String, String)>,
    pub entity: String,
    pub candidates: String,
    pub detail: String,
}

impl ApiCfg {
    pub fn from(li: &Value) -> Result<ApiCfg, String> {
        let a = section(li, "api");
        let url = pyfmt::strip(&py_text(li.get("url"))).to_string();
        let search = py_text(a.get("search_url"));
        let mut fields: Vec<(String, String)> = [("lotNo", "lotNo"), ("inspectionNo", "kensaNo"), ("page", "nowPage")]
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        for (k, v) in section(&Value::Object(a.clone()), "request_fields") {
            let v = py_str_value(&v);
            match fields.iter_mut().find(|(n, _)| *n == k) {
                Some(s) => s.1 = v,
                None => fields.push((k, v)),
            }
        }
        let s = |k: &str, d: &str| a.get(k).map(py_str_value).unwrap_or_else(|| d.to_string());
        Ok(ApiCfg {
            enabled: a.get("enabled").map(|v| truthy(Some(v))).unwrap_or(true) && (!url.is_empty() || truthy(a.get("search_url"))),
            search_url: if search.is_empty() { rules::api_search_url(&url) } else { search },
            timeout: py_float_of(a.get("timeout_seconds"), 15.0).map_err(|e| format!("lotdsp_import.api.timeout_seconds: {e}"))?,
            fields,
            entity: s("entity_path", "entity"),
            candidates: s("candidates_path", "searchKeyInfos"),
            detail: s("detail_path", "staffCommonBean"),
        })
    }

    fn field(&self, k: &str) -> &str {
        self.fields.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str()).unwrap_or("")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ApiError {
    pub kind: &'static str,
    pub msg: String,
}

fn api_err<T>(kind: &'static str, msg: impl Into<String>) -> Result<T, ApiError> {
    Err(ApiError { kind, msg: msg.into() })
}

pub fn get_path<'a>(data: &'a J, path: &str) -> Option<&'a J> {
    let mut cur = data;
    for part in path.split('.').filter(|p| !p.is_empty()) {
        cur = cur.get(part)?;
    }
    Some(cur)
}

/// searchAction を 1 回呼ぶ → 応答（Cookie・パスワードは送らない・プロキシを通さない）
pub fn call(lot_no: &str, cfg: &ApiCfg) -> Result<J, ApiError> {
    if !cfg.enabled {
        return api_err("disabled", "LotDsp の API を使わない設定です。");
    }
    let mut body = J::obj();
    body.set(cfg.field("lotNo"), J::Str(lot_no.into()));
    body.set(cfg.field("inspectionNo"), J::Str(String::new()));
    body.set(cfg.field("page"), J::Int(0));
    let text = format!(
        "{{{}}}",
        body.entries()
            .iter()
            .map(|(k, v)| format!("{}: {}", json_ascii(k), if let J::Str(s) = v { json_ascii(s) } else { v.dumps(None) }))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let unreachable = || format!("LotDsp の API（{}）に届きません（社外・VPN 未接続・サイトの停止）。", cfg.search_url);
    if cfg.timeout.is_nan() || cfg.timeout <= 0.0 || !cfg.timeout.is_finite() {
        return api_err("unreachable", unreachable());
    }
    let r =
        match crate::cm3_http::post_plain(&cfg.search_url, text.as_bytes(), std::time::Duration::from_secs_f64(cfg.timeout.min(86400.0))) {
            Ok(r) => r,
            Err(crate::cm3::Fail::Cm3(m)) if m == "CM3の応答がタイムアウトしました" => {
                return api_err("timeout", format!("LotDsp の API から {} 秒たっても応答がありません。", py_g(cfg.timeout, 6)))
            }
            Err(_) if cfg.search_url.to_ascii_lowercase().starts_with("https:") => {
                return api_err(
                    "unreachable",
                    format!(
                        "LotDsp の API（{}）に届きません（https の場所は読めません。参照先に http の URL を入れてください）。",
                        cfg.search_url
                    ),
                )
            }
            Err(_) => return api_err("unreachable", unreachable()),
        };
    if !(200..300).contains(&r.status) {
        return api_err("http", format!("LotDsp の API が HTTP {} を返しました。", r.status));
    }
    let raw = r.body.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&r.body);
    let result = std::str::from_utf8(raw).ok().and_then(|t| pyjson::loads(t).ok());
    let Some(result) = result else {
        return api_err("invalid", "LotDsp の API の応答を JSON として読めませんでした（ログインの画面が返った可能性があります）。");
    };
    if !result.is_obj() {
        return api_err("invalid", "LotDsp の API の応答の形が想定と違います。");
    }
    if result.get("status") == Some(&J::Str("ERROR".into())) {
        let m = result.get("errorMessage").filter(|v| v.truthy()).map(J::py_str).unwrap_or_else(|| "（理由なし）".into());
        return api_err("business", format!("LotDsp の API がエラーを返しました: {m}"));
    }
    Ok(result)
}

/// 応答 → 検索結果の本体（entity）。該当なしは not_found
pub fn entity_of<'a>(result: &'a J, cfg: &ApiCfg, lot_no: &str) -> Result<&'a J, ApiError> {
    let entity = get_path(result, &cfg.entity).unwrap_or(result);
    if !entity.is_obj() {
        return api_err("invalid", "LotDsp の API の応答に検索結果（entity）がありません。");
    }
    match get_path(entity, &cfg.candidates) {
        Some(J::Arr(a)) if !a.is_empty() => Ok(entity),
        _ => api_err("not_found", format!("ロット問い合わせに {lot_no} が見つかりません（検索結果 0件）。")),
    }
}

/// 画面の値が、キーを見分ける手がかりになるか
pub fn informative(display: &str) -> bool {
    let d = nfkc(display);
    if d.is_empty() {
        return false;
    }
    !(num_text(&d) && pyfloat(&d.replace(',', "")) == Some(0.0))
}

/// API の日時の値 → 日本時間の (年, 月, 日, 時, 分, 秒)（読めなければ None）
pub fn moment(raw: &J) -> Option<(i32, u32, u32, u32, u32, u32)> {
    use chrono::{Datelike, Timelike};
    let from_secs = |t: f64| -> Option<(i32, u32, u32, u32, u32, u32)> {
        if !t.is_finite() {
            return None;
        }
        // datetime.fromtimestamp: マイクロ秒を偶数へ丸め、繰り上がれば秒に足す
        let (mut sec, frac) = (t.trunc(), t - t.trunc());
        let us = (frac * 1e6).round_ties_even();
        if us >= 1e6 {
            sec += 1.0;
        } else if us < 0.0 {
            sec -= 1.0;
        }
        if !(-62135596800.0..253402300800.0).contains(&sec) {
            return None;
        }
        let dt = chrono::DateTime::from_timestamp(sec as i64, 0)? + chrono::Duration::hours(rules::TZ_HOURS);
        let n = dt.naive_utc();
        Some((n.year(), n.month(), n.day(), n.hour(), n.minute(), n.second()))
    };
    match raw {
        J::Bool(_) => return None,
        J::Int(_) | J::Big(_) | J::Float(_) => {
            let f = raw.as_f64()?;
            if f >= 1e11 {
                return from_secs(match raw {
                    J::Int(i) => *i as f64 / 1000.0,
                    _ => f / 1000.0,
                });
            }
            return if f >= 1e9 { from_secs(f) } else { None };
        }
        _ => {}
    }
    let t = if raw.truthy() { raw.py_str() } else { String::new() };
    let mut t = pyfmt::strip(&t).replace('Z', "+00:00").replace('/', "-");
    // ([+-]\d{2})(\d{2})$ → \1:\2
    let tc: Vec<char> = t.chars().collect();
    let n = tc.len();
    if n >= 5 && matches!(tc[n - 5], '+' | '-') && tc[n - 4..].iter().all(|c| is_d(*c)) {
        let head: String = tc[..n - 2].iter().collect();
        let tail: String = tc[n - 2..].iter().collect();
        t = format!("{head}:{tail}");
    }
    let tc: Vec<char> = t.chars().collect();
    if tc.len() < 10
        || !tc[..4].iter().all(|c| is_d(*c))
        || tc[4] != '-'
        || !tc[5..7].iter().all(|c| is_d(*c))
        || tc[7] != '-'
        || !tc[8..10].iter().all(|c| is_d(*c))
    {
        return None;
    }
    let t = t.replacen(' ', "T", 1);
    let (naive, off) = fromisoformat(&t)?;
    let naive = match off {
        None => naive,
        Some(o) => naive - chrono::Duration::microseconds(o) + chrono::Duration::hours(rules::TZ_HOURS),
    };
    Some((naive.year(), naive.month(), naive.day(), naive.hour(), naive.minute(), naive.second()))
}

/// datetime.fromisoformat の写し（日付・区切りの 1 字・時刻〈時・分・秒は「:」つきか詰めた形・小数は 6 桁まで〉・
/// ずれ〈±HH[:MM[:SS[.f]]]〉）。読めなければ None。ずれはマイクロ秒
fn fromisoformat(t: &str) -> Option<(chrono::NaiveDateTime, Option<i64>)> {
    let c: Vec<char> = t.chars().collect();
    if !c.iter().all(char::is_ascii) {
        return None;
    }
    let num =
        |s: &[char]| -> Option<u32> { s.iter().all(char::is_ascii_digit).then(|| s.iter().collect::<String>().parse().ok()).flatten() };
    let (y, m, d) = (num(&c[0..4])? as i32, num(&c[5..7])?, num(&c[8..10])?);
    let date = chrono::NaiveDate::from_ymd_opt(y, m, d)?;
    if c.len() == 10 {
        return Some((date.and_hms_opt(0, 0, 0)?, None));
    }
    let rest = &c[11..]; // 区切りは 1 字（どの字でもよい）
    let tz_at = rest.iter().position(|ch| *ch == '+' || *ch == '-');
    let (time, tz) = match tz_at {
        Some(i) => (&rest[..i], Some(&rest[i..])),
        None => (rest, None),
    };
    // (時, 分, 秒, マイクロ秒)
    let parse_time = |s: &[char]| -> Option<(u32, u32, u32, u32)> {
        if s.is_empty() {
            return None;
        }
        let (main, frac) = match s.iter().position(|ch| *ch == '.' || *ch == ',') {
            Some(i) => (&s[..i], Some(&s[i + 1..])),
            None => (s, None),
        };
        let parts: Vec<&[char]> = if main.contains(&':') {
            main.split(|ch| *ch == ':').collect()
        } else if main.len() % 2 == 0 && main.len() <= 6 {
            main.chunks(2).collect()
        } else {
            return None;
        };
        if parts.is_empty() || parts.len() > 3 || parts.iter().any(|p| p.len() != 2) {
            return None;
        }
        let h = num(parts[0])?;
        let mi = if parts.len() > 1 { num(parts[1])? } else { 0 };
        let se = if parts.len() > 2 { num(parts[2])? } else { 0 };
        let us = match frac {
            None => 0,
            Some(f) => {
                if parts.len() != 3 || f.is_empty() || !f.iter().all(char::is_ascii_digit) {
                    return None;
                }
                let digits: String = f.iter().take(6).collect();
                format!("{digits:0<6}").parse().ok()?
            }
        };
        (h < 24 && mi < 60 && se < 60).then_some((h, mi, se, us))
    };
    let (h, mi, se, us) = parse_time(time)?;
    let naive = date.and_hms_micro_opt(h, mi, se, us)?;
    let off = match tz {
        None => None,
        Some(z) => {
            let sign = if z[0] == '-' { -1 } else { 1 };
            let (oh, om, os, ous) = parse_time(&z[1..])?;
            let o = (oh as i64 * 3600 + om as i64 * 60 + os as i64) * 1_000_000 + ous as i64;
            if o >= 86_400_000_000 {
                return None;
            }
            Some(sign * o)
        }
    };
    Some((naive, off))
}

fn stamp_full(m: (i32, u32, u32, u32, u32, u32)) -> String {
    format!("{:04}{:02}{:02}{:02}{:02}{:02}", m.0, m.1, m.2, m.3, m.4, m.5)
}

/// 画面に出た字と API の値が同じものか（画面が空なら None）
pub fn same(display: &str, raw: Option<&J>) -> Option<bool> {
    let d = nfkc(display);
    if d.is_empty() {
        return None;
    }
    let raw = match raw {
        None | Some(J::Null) => return Some(false),
        Some(r) => r,
    };
    let r = nfkc(&raw.py_str());
    if d == r || d.replace(' ', "") == r.replace(' ', "") {
        return Some(true);
    }
    if num_text(&d) {
        if matches!(raw, J::Bool(_)) {
            return Some(false);
        }
        let Some(rv) = pyfloat(&raw.py_str().replace(',', "")) else { return Some(false) };
        let dv = pyfloat(&d.replace(',', ""))?;
        let dec = d.split_once('.').map(|(_, b)| b.chars().count()).unwrap_or(0);
        return Some(rules::round_eq(dv, dec, rv));
    }
    let (dd, rd) = (digits_of(&d), digits_of(&r));
    if dd.chars().count() >= 6 && d.chars().any(|c| matches!(c, '/' | ':' | '-' | '年')) {
        if rd.contains(&dd) {
            return Some(true);
        }
        return Some(moment(raw).is_some_and(|m| stamp_full(m).contains(&dd)));
    }
    Some(false)
}

/// entity の中の値（並びの中は見ない）→ {道すじ: 値}
fn leaves(entity: &J, depth: i32, prefix: &str, out: &mut Vec<(String, J)>) {
    if !entity.is_obj() || depth < 0 {
        return;
    }
    for (k, v) in entity.entries() {
        let path = format!("{prefix}{k}");
        match v {
            J::Obj(_) => leaves(v, depth - 1, &format!("{path}."), out),
            J::Arr(_) => {}
            _ => put(out, path, v.clone()),
        }
    }
}

fn put<T>(out: &mut Vec<(String, T)>, k: String, v: T) {
    match out.iter_mut().find(|(n, _)| *n == k) {
        Some(s) => s.1 = v,
        None => out.push((k, v)),
    }
}

/// entity の中の「表の並び」→ {場所: 並び}（2 段まで）
fn lists_in(entity: &J, depth: i32, prefix: &str, out: &mut Vec<(String, Vec<J>)>) {
    if !entity.is_obj() || depth < 0 {
        return;
    }
    for (k, v) in entity.entries() {
        let path = format!("{prefix}{k}");
        match v {
            J::Arr(a) if !a.is_empty() && a.iter().all(J::is_obj) => put(out, path, a.clone()),
            J::Obj(_) => lists_in(v, depth - 1, &format!("{path}."), out),
            _ => {}
        }
    }
}

/// int(float(str(v)))（読めなければ None。値は f64 の整数で持つ）
fn int_float_str(v: Option<&J>) -> Option<f64> {
    let s = v.map(J::py_str).unwrap_or_else(|| "None".into());
    let f = pyfloat(&s)?;
    f.is_finite().then(|| f.trunc())
}

/// 並びの要素と画面の行（BOX の№）の対応 → ({№: 要素の番号}, №のキー)
fn align(items: &[J], rows: &[Row]) -> (Vec<(f64, usize)>, Option<String>) {
    let nos: BTreeSet<i64> = rows.iter().map(|r| r.no).collect();
    let keys: BTreeSet<String> = items.iter().flat_map(|x| x.entries().iter().map(|(k, _)| k.clone())).collect();
    for k in &keys {
        let ints: Option<Vec<f64>> = items.iter().map(|x| int_float_str(x.get(k).or(Some(&J::Null)))).collect();
        let Some(ints) = ints else { continue };
        let uniq: BTreeSet<u64> = ints.iter().map(|f| f.to_bits()).collect();
        let all_in = nos.iter().all(|n| ints.contains(&(*n as f64)));
        let sequential = ints.iter().enumerate().all(|(j, i)| *i == (j + 1) as f64);
        if uniq.len() == ints.len() && all_in && !sequential {
            return (ints.into_iter().enumerate().map(|(i, f)| (f, i)).collect(), Some(k.clone()));
        }
    }
    ((0..items.len()).map(|i| ((i + 1) as f64, i)).collect(), None)
}

fn by_no<'a>(map: &[(f64, usize)], items: &'a [J], no: i64) -> Option<&'a J> {
    map.iter().find(|(f, _)| *f == no as f64).map(|(_, i)| &items[*i])
}

const KNOWN_LOT_KEYS: [(&str, &str); 9] = [
    ("lot_no", "ltno"),
    ("casting_no", "cyno"),
    ("inspection_no", "knno"),
    ("order_no", "juno"),
    ("material", "lta"),
    ("temper", "ltb"),
    ("product_thickness", "ltx"),
    ("product_width", "lty"),
    ("product_length", "ltz"),
];

fn hint(name: &str, col: &str) -> Option<&'static str> {
    let t: &[(&str, &str)] = match name {
        "actual" => &[
            ("list", "staffProgressJBoxInfos"),
            ("equipment", "jbsm"),
            ("work_date", "jbedate"),
            ("thickness", "jbx"),
            ("width", "jby"),
            ("weight", "jbrw"),
            ("pieces", "jbrmh"),
        ],
        "design" => &[
            ("list", "staffProgressBoxInfos"),
            ("equipment", "sbsm"),
            ("horizontal_split", "sbyky"),
            ("vertical_split", "sbtty"),
            ("pieces", "sbmh"),
        ],
        _ => &[],
    };
    t.iter().find(|(k, _)| *k == col).map(|(_, v)| *v)
}

const REQUIRED: [(&str, &[&str]); 3] = [
    ("actual", &["equipment", "work_date", "thickness", "width", "weight", "off_front_m", "off_back_m"]),
    ("design", &["equipment", "horizontal_split", "vertical_split"]),
    ("lot", &["lot_no"]),
];

fn required(name: &str) -> &'static [&'static str] {
    REQUIRED.iter().find(|(n, _)| *n == name).map(|(_, c)| *c).unwrap_or(&[])
}

const LOT_COLUMNS: [&str; 12] = [
    "lot_no",
    "casting_no",
    "inspection_no",
    "order_no",
    "use_code",
    "use_name",
    "density",
    "material",
    "temper",
    "product_thickness",
    "product_width",
    "product_length",
];
const MIN_SEEN: i64 = 2;
const TIE_SEEN: i64 = 3;

/// datetime.now().isoformat(timespec="seconds")（この PC の時刻。記録の時刻）
pub type NowIso = Arc<dyn Fn() -> String + Send + Sync>;

pub fn system_now_iso() -> NowIso {
    Arc::new(|| chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string())
}

fn seen_of(c: &J) -> i64 {
    match c.get("seen") {
        Some(J::Int(i)) => *i,
        Some(J::Float(f)) => *f as i64,
        Some(J::Bool(b)) => *b as i64,
        _ => 0,
    }
}

/// 学んだ対応（KeyMap）。中身は Python と同じ形の J
pub struct KeyMap {
    pub path: PathBuf,
    pub data: J,
    sig: Option<(u64, u128)>,
}

/// fsio.write_json_atomic（親のフォルダを作り、一時ファイル → 置き換え。拒まれたら budget 秒まで間を広げてやり直す）
pub fn write_atomic(path: &Path, bytes: &[u8], budget: f64) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    let mut r = [0u8; 8];
    let _ = getrandom::fill(&mut r);
    let id: String = r.iter().map(|b| format!("{b:02x}")).collect();
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.{id}.tmp"));
    let res = (|| {
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        f.write_all(bytes)?;
        drop(f);
        let (mut delay, mut waited) = (0.05_f64, 0.0_f64);
        loop {
            match std::fs::rename(&tmp, path) {
                Ok(()) => return Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound || waited >= budget => return Err(e),
                Err(_) => {
                    std::thread::sleep(std::time::Duration::from_secs_f64(delay));
                    waited += delay;
                    delay = (delay * 2.0).min(0.5);
                }
            }
        }
    })();
    let _ = std::fs::remove_file(&tmp);
    res
}

fn file_sig(p: &Path) -> Option<(u64, u128)> {
    let m = std::fs::metadata(p).ok()?;
    Some((m.len(), m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos()))
}

impl KeyMap {
    pub fn load(path: &Path) -> KeyMap {
        let data = std::fs::read_to_string(path).ok().and_then(|t| pyjson::loads(&t).ok()).filter(J::is_obj).unwrap_or_else(J::obj);
        KeyMap { path: path.to_path_buf(), data, sig: file_sig(path) }
    }

    /// ほかの書き手がファイルを替えていたら読み直す
    fn refresh(&mut self) {
        let s = file_sig(&self.path);
        if s != self.sig {
            *self = KeyMap::load(&self.path);
        }
    }

    pub fn save(&mut self) -> std::io::Result<()> {
        let text = self.data.dumps(Some(1)) + "\n";
        write_atomic(&self.path, text.as_bytes(), 1.0)?;
        self.sig = file_sig(&self.path);
        Ok(())
    }

    fn col(&self, name: &str, col: &str) -> Option<&J> {
        self.data.get(name).filter(|s| s.is_obj())?.get("cols").filter(|c| c.is_obj())?.get(col).filter(|c| c.is_obj())
    }

    pub fn key(&self, name: &str, col: &str) -> Option<String> {
        let c = self.col(name, col)?;
        let cands: Vec<&J> = c.get("cands").map(J::items).unwrap_or(&[]).iter().collect();
        if cands.is_empty() {
            return None;
        }
        let first = cands[0].as_str()?.to_string();
        if cands.len() > 1 {
            return (name == "lot" && seen_of(c) >= TIE_SEEN).then_some(first);
        }
        (c.get("trusted").is_some_and(J::truthy) || seen_of(c) >= MIN_SEEN).then_some(first)
    }

    pub fn missing(&self) -> Vec<(String, String)> {
        let mut out = vec![];
        for (name, cols) in REQUIRED {
            let list = self.data.get(name).and_then(|s| s.get("list")).is_some_and(J::truthy);
            if name != "lot" && !list {
                out.push((name.to_string(), "（並び）".to_string()));
                continue;
            }
            for c in cols {
                if self.key(name, c).is_none() {
                    out.push((name.to_string(), c.to_string()));
                }
            }
        }
        if self.col("lot", "density").is_some_and(|d| d.get("seen").is_some_and(J::truthy)) && self.key("lot", "density").is_none() {
            out.push(("lot".into(), "density".into()));
        }
        out
    }

    pub fn ready(&self) -> bool {
        self.data.truthy() && self.missing().is_empty()
    }

    fn section(&mut self, name: &str) -> &mut J {
        let ok = self.data.get(name).is_some_and(J::is_obj);
        if !ok {
            self.data.remove(name);
        }
        let s = self.data.setdefault(name, J::Obj(vec![("list".into(), J::Null), ("box".into(), J::Null), ("cols".into(), J::obj())]));
        if !s.get("cols").is_some_and(J::is_obj) {
            s.set("cols", J::obj());
        }
        s
    }

    pub fn status(&self, enabled: bool) -> Value {
        let missing: Vec<String> = self.missing().iter().map(|(s, c)| format!("{s}.{c}")).collect();
        let mut learned = 0;
        for s in ["actual", "design", "lot"] {
            if let Some(cols) = self.data.get(s).and_then(|x| x.get("cols")) {
                learned += cols.entries().iter().filter(|(c, _)| self.key(s, c).is_some()).count();
            }
        }
        json!({"enabled": enabled, "ready": self.ready(), "missing": missing,
               "login_free": self.data.get("login_free").map(J::to_value).unwrap_or(Value::Null),
               "last_error": self.data.get("last_error").map(J::to_value).unwrap_or(Value::Null),
               "probe": self.data.get("probe").filter(|p| p.truthy()).map(J::to_value).unwrap_or(json!({})),
               "learned": learned})
    }
}

fn narrow(st: &mut J, consistent: &BTreeSet<String>, seen: i64, now: &NowIso) {
    if seen == 0 {
        return;
    }
    let prev: Option<BTreeSet<String>> = match st.get("cands") {
        None | Some(J::Null) => None,
        Some(x) => Some(x.items().iter().map(J::py_str).collect()),
    };
    let now_c: Vec<String> = match &prev {
        None => consistent.iter().cloned().collect(),
        Some(p) => p.intersection(consistent).cloned().collect(),
    };
    let base = if prev.is_some() { seen_of(st) } else { 0 };
    st.set("seen", J::Int(if now_c.is_empty() { 0 } else { base + seen }));
    st.set("cands", if now_c.is_empty() { J::Null } else { J::Arr(now_c.iter().map(|s| J::Str(s.clone())).collect()) });
    if now_c.is_empty() {
        st.set("conflict", J::Str(now()));
    }
}

fn learn_rows(km: &mut KeyMap, name: &str, entity: &J, rows: &[Row], cols: &[&str], now: &NowIso) {
    if rows.is_empty() {
        return;
    }
    type PerCol = Vec<(String, (BTreeSet<String>, i64))>;
    type Best = ((i64, i64), String, Option<String>, PerCol);
    let mut best: Option<Best> = None;
    let mut lists = vec![];
    lists_in(entity, 2, "", &mut lists);
    for (path, items) in &lists {
        let (map, boxk) = align(items, rows);
        let keys: BTreeSet<String> = items.iter().flat_map(|x| x.entries().iter().map(|(k, _)| k.clone())).collect();
        let (mut score, mut per_col): (i64, PerCol) = (0, vec![]);
        for col in cols {
            let (mut ok, mut seen) = (keys.clone(), 0i64);
            for r in rows {
                if !informative(r.get(col)) {
                    continue;
                }
                let Some(item) = by_no(&map, items, r.no) else {
                    ok = BTreeSet::new();
                    break;
                };
                seen += 1;
                ok.retain(|k| same(r.get(col), item.get(k)) == Some(true));
            }
            if seen > 0 && !ok.is_empty() {
                score += 1;
            }
            per_col.push((col.to_string(), (ok, seen)));
        }
        let h = (path.rsplit('.').next() == hint(name, "list")) as i64;
        let eq_ok = per_col.iter().find(|(c, _)| c == "equipment").is_some_and(|(_, (s, _))| !s.is_empty());
        if eq_ok && best.as_ref().is_none_or(|b| (score, h) > b.0) {
            best = Some(((score, h), path.clone(), boxk, per_col));
        }
    }
    let Some((_, path, boxk, per_col)) = best else { return };
    let sec = km.section(name);
    if sec.get("list") != Some(&J::Str(path.clone())) {
        sec.set("list", J::Str(path.clone()));
        sec.set("box", boxk.clone().map(J::Str).unwrap_or(J::Null));
        sec.set("cols", J::obj());
    }
    sec.set("box", boxk.map(J::Str).unwrap_or(J::Null));
    let req = required(name);
    for (col, (ok, seen)) in per_col {
        let cols_j = sec.get_mut("cols").unwrap();
        let st = cols_j.setdefault(&col, J::Obj(vec![("cands".into(), J::Null), ("seen".into(), J::Int(0))]));
        narrow(st, &ok, seen, now);
        if let Some(hn) = hint(name, &col) {
            let cands: Vec<String> = st.get("cands").map(J::items).unwrap_or(&[]).iter().map(J::py_str).collect();
            if cands.len() > 1 && cands.iter().any(|c| c == hn) && !req.contains(&col.as_str()) {
                st.set("cands", J::Arr(vec![J::Str(hn.into())]));
                let s = seen_of(st).max(MIN_SEEN);
                st.set("seen", J::Int(s));
            }
        }
    }
}

fn lot_path(cfg: &ApiCfg, key: &str) -> String {
    if key.contains('.') {
        key.to_string()
    } else {
        format!("{}.{key}", cfg.detail)
    }
}

fn learn_lot(km: &mut KeyMap, entity: &J, cfg: &ApiCfg, fields: &J, now: &NowIso) {
    let mut found = vec![];
    leaves(entity, 3, "", &mut found);
    let sec = km.section("lot");
    sec.set("list", J::Str("entity".into()));
    for col in LOT_COLUMNS {
        let cols_j = sec.get_mut("cols").unwrap();
        let init = match KNOWN_LOT_KEYS.iter().find(|(k, _)| *k == col) {
            Some((_, key)) => J::Obj(vec![
                ("cands".into(), J::Arr(vec![J::Str(lot_path(cfg, key))])),
                ("seen".into(), J::Int(0)),
                ("trusted".into(), J::Bool(true)),
            ]),
            None => J::Obj(vec![("cands".into(), J::Null), ("seen".into(), J::Int(0))]),
        };
        let st = cols_j.setdefault(col, init);
        if st.get("cands").is_some_and(J::truthy) {
            let c: Vec<J> = st.get("cands").unwrap().items().iter().map(|x| J::Str(lot_path(cfg, &x.py_str()))).collect();
            st.set("cands", J::Arr(c));
        }
        let v = fields.get(col).map(J::py_str).unwrap_or_default();
        if !informative(&v) {
            continue;
        }
        let consistent: BTreeSet<String> = found.iter().filter(|(_, x)| same(&v, Some(x)) == Some(true)).map(|(k, _)| k.clone()).collect();
        narrow(st, &consistent, 1, now);
    }
}

/// 値の形だけ（数字→9・英字→a・かな漢字→あ・型の名前つき）
pub fn shape(v: &J) -> String {
    let t: String = v
        .py_str()
        .chars()
        .take(40)
        .map(|c| {
            if py_isdigit(c) {
                '9'
            } else if c.is_ascii_alphabetic() {
                'a'
            } else if !c.is_ascii() && c.is_alphabetic() {
                'あ'
            } else {
                c
            }
        })
        .collect();
    format!("{}:{t}", v.type_name())
}

/// str.isdigit（10 進の数字と、上付き・下付き・丸囲みなどの数字）
fn py_isdigit(c: char) -> bool {
    is_d(c)
        || matches!(c as u32, 0xB2 | 0xB3 | 0xB9 | 0x2070 | 0x2074..=0x2079 | 0x2080..=0x2089 | 0x2460..=0x2468 | 0x2474..=0x247C | 0x2488..=0x2490 | 0x24EA | 0x24F5..=0x24FD | 0x24FF | 0x2776..=0x277E | 0x2780..=0x2788 | 0x278A..=0x2792)
}

fn probe(km: &mut KeyMap, entity: &J, tables: &Tables, actual: &[Row], design: &[Row]) {
    let mut out = J::obj();
    let fields = lot_fields(tables, &Value::Null);
    let mut found = vec![];
    leaves(entity, 3, "", &mut found);
    for (sec_name, col) in km.missing() {
        if col.starts_with('（') {
            continue;
        }
        let name = format!("{sec_name}.{col}");
        let st = km.col(&sec_name, &col).cloned().unwrap_or_else(J::obj);
        let held = |o: &mut Vec<(String, J)>| {
            o.push(("cands".into(), st.get("cands").cloned().unwrap_or(J::Null)));
            o.push(("seen".into(), st.get("seen").cloned().unwrap_or(J::Int(0))));
        };
        if sec_name == "lot" {
            let v = fields.get(&col).map(J::py_str).unwrap_or_default();
            if informative(&v) {
                let numeric = num_text(&nfkc(&v));
                let api: Vec<(String, J)> =
                    found.iter().filter(|(_, x)| !numeric || x.is_number()).take(80).map(|(k, x)| (k.clone(), J::Str(shape(x)))).collect();
                let mut o = vec![("screen".into(), J::Str(shape(&J::Str(v))))];
                held(&mut o);
                o.push(("api".into(), J::Obj(api)));
                out.set(&name, J::Obj(o));
            } else {
                let mut o = vec![("screen".into(), J::Str("（画面の値がまだ空）".into()))];
                held(&mut o);
                out.set(&name, J::Obj(o));
            }
            continue;
        }
        let rows = if sec_name == "actual" { actual } else { design };
        let Some(hit) = rows.iter().find(|r| informative(r.get(&col))) else {
            let mut o = vec![("screen".into(), J::Str("（画面の値がまだ空）".into()))];
            held(&mut o);
            out.set(&name, J::Obj(o));
            continue;
        };
        let path = km.data.get(&sec_name).and_then(|s| s.get("list")).filter(|p| p.truthy()).map(J::py_str);
        let items: Vec<J> = path.and_then(|p| get_path(entity, &p).cloned()).map(|x| x.items().to_vec()).unwrap_or_default();
        let item = if items.is_empty() || !items.iter().all(J::is_obj) {
            J::obj()
        } else {
            let (map, _) = align(&items, rows);
            by_no(&map, &items, hit.no).cloned().filter(J::truthy).unwrap_or_else(J::obj)
        };
        let mut o = vec![("screen".into(), J::Str(shape(&J::Str(hit.get(&col).into()))))];
        held(&mut o);
        o.push(("api".into(), J::Obj(item.entries().iter().map(|(k, x)| (k.clone(), J::Str(shape(x)))).collect())));
        out.set(&name, J::Obj(o));
    }
    km.data.set("probe", out);
}

/// 画面で読めたロットと、同じロットの API の応答を照らし合わせて、対応を学ぶ
#[allow(clippy::too_many_arguments)]
pub fn learn(km: &mut KeyMap, entity: &J, cfg: &ApiCfg, tables: &Tables, actual: &[Row], design: &[Row], lot_no: &str, now: &NowIso) {
    let acols: Vec<&str> = DEFAULT_ACTUAL[1..].iter().map(|(k, _)| *k).collect();
    let dcols: Vec<&str> = DEFAULT_DESIGN[1..].iter().map(|(k, _)| *k).collect();
    learn_rows(km, "actual", entity, actual, &acols, now);
    learn_rows(km, "design", entity, design, &dcols, now);
    learn_lot(km, entity, cfg, &lot_fields(tables, &Value::Null), now);
    probe(km, entity, tables, actual, design);
    let missing: Vec<J> = km.missing().iter().map(|(s, c)| J::Str(format!("{s}.{c}"))).collect();
    let entry = J::Obj(vec![
        ("at".into(), J::Str(now())),
        ("lot".into(), J::Str(lot_no.into())),
        ("ready".into(), J::Bool(km.ready())),
        ("missing".into(), J::Arr(missing)),
    ]);
    if !matches!(km.data.get("log"), Some(J::Arr(_))) {
        km.data.set("log", J::Arr(vec![]));
    }
    if let Some(J::Arr(log)) = km.data.get_mut("log") {
        log.push(entry);
        let n = log.len();
        if n > 20 {
            log.drain(..n - 20);
        }
    }
    km.data.set("login_free", J::Obj(vec![("at".into(), J::Str(now())), ("lot".into(), J::Str(lot_no.into()))]));
}

/// 日付・時刻を画面と同じ書き方（YY/MM/DD hh:mm:ss）に。読めない形はそのまま
pub fn date_text(raw: &J) -> String {
    if let Some(m) = moment(raw) {
        return format!("{:02}/{:02}/{:02} {:02}:{:02}:{:02}", m.0.rem_euclid(100), m.1, m.2, m.3, m.4, m.5);
    }
    let s = if raw.truthy() { raw.py_str() } else { String::new() };
    let d: Vec<char> = s.chars().filter(|c| is_d(*c)).collect();
    let g = |a: usize, b: usize| d[a..b].iter().collect::<String>();
    if d.len() == 14 {
        return format!("{}/{}/{} {}:{}:{}", g(2, 4), g(4, 6), g(6, 8), g(8, 10), g(10, 12), g(12, 14));
    }
    if d.len() == 8 {
        return format!("{}/{}/{}", g(2, 4), g(4, 6), g(6, 8));
    }
    pyfmt::strip(&s).to_string()
}

fn api_rows(km: &KeyMap, name: &str, entity: &J, cols: &[&str]) -> Vec<Row> {
    let sec = km.data.get(name);
    let list = sec.and_then(|s| s.get("list")).filter(|l| l.truthy()).map(J::py_str);
    let Some(J::Arr(items)) = list.and_then(|l| get_path(entity, &l)) else { return vec![] };
    let boxk = sec.and_then(|s| s.get("box")).filter(|b| b.truthy()).map(J::py_str);
    let mut out = vec![];
    for (i, x) in items.iter().enumerate() {
        if !x.is_obj() {
            continue; // 版 3.98.0: 表でない要素は読まない（前の Python は落ちた）
        }
        let no = match &boxk {
            Some(k) => match int_float_str(x.get(k).or(Some(&J::Null))).and_then(rules::box_of) {
                Some(n) => n,
                None => continue,
            },
            None => i as i64 + 1,
        };
        let mut row = Row { no, cells: vec![] };
        for col in cols {
            let Some(k) = km.key(name, col) else { continue };
            let v = match x.get(&k) {
                None | Some(J::Null) => String::new(),
                Some(v) if *col == "work_date" => date_text(v),
                Some(v) => pyfmt::strip(&v.py_str()).to_string(),
            };
            row.set(col, v);
        }
        let eq = row.get("equipment").to_string();
        row.set("equipment", eq.clone());
        if eq.is_empty() && !["thickness", "width", "weight"].iter().any(|k| truthy_num(rules::to_number_str(row.get(k)))) {
            continue;
        }
        let _ = row.has("no");
        out.push(row);
    }
    out
}

pub enum ReadErr {
    Api(ApiError),
    Py(PyErr),
}

/// API でロットを読む → (Lot.to_dict(), report)
pub fn api_read_lot(km: &KeyMap, cfg: &ApiCfg, lot_no: &str, master: &Master, read_cfg: &Value) -> Result<(Value, Value), ReadErr> {
    if !km.ready() {
        let miss: Vec<String> = km.missing().iter().take(6).map(|(s, c)| format!("{s}.{c}")).collect();
        return Err(ReadErr::Api(ApiError {
            kind: "not_ready",
            msg: format!("LotDsp の API の項目名をまだ学び終えていません（{}）。", miss.join("、")),
        }));
    }
    let result = call(lot_no, cfg).map_err(ReadErr::Api)?;
    let entity = entity_of(&result, cfg, lot_no).map_err(ReadErr::Api)?;
    let acols: Vec<&str> = DEFAULT_ACTUAL[1..].iter().map(|(k, _)| *k).collect();
    let dcols: Vec<&str> = DEFAULT_DESIGN[1..].iter().map(|(k, _)| *k).collect();
    let actual = api_rows(km, "actual", entity, &acols);
    let design = api_rows(km, "design", entity, &dcols);
    if actual.is_empty() {
        return Err(ReadErr::Api(ApiError {
            kind: "invalid",
            msg: "LotDsp の API の応答に、学んだ場所の実績の並びがありません（応答の形が変わった可能性）。".into(),
        }));
    }
    let mut fields = J::obj();
    for col in LOT_COLUMNS {
        let Some(k) = km.key("lot", col) else { continue };
        if let Some(v) = get_path(entity, &lot_path(cfg, &k)).filter(|v| !matches!(v, J::Null)) {
            fields.set(col, J::Str(pyfmt::strip(&v.py_str()).to_string()));
        }
    }
    let lot = check_lot(fields, lot_no).map_err(|e| ReadErr::Api(ApiError { kind: "mismatch", msg: e.msg }))?;
    let (data, report) = build_lot(lot, &actual, &design, master, read_cfg, "LotDsp API（ログインなし）").map_err(ReadErr::Py)?;
    Ok((to_models(&data, lot_no), report.to_value()))
}

// ------------------------------------------------------------------ 応答の全項目の調査
struct Stat {
    types: BTreeSet<&'static str>,
    of: i64,
    nonnull: i64,
    first: Option<J>,
}

fn survey_walk(node: &J, path: &str, stats: &mut Vec<(String, Stat)>, arrays: &mut Vec<(String, usize)>) {
    match node {
        J::Obj(m) => {
            for (k, v) in m {
                survey_walk(v, &if path.is_empty() { k.clone() } else { format!("{path}.{k}") }, stats, arrays);
            }
        }
        J::Arr(a) => {
            match arrays.iter_mut().find(|(p, _)| p == path) {
                Some(x) => x.1 = x.1.max(a.len()),
                None => arrays.push((path.to_string(), a.len())),
            }
            for item in a {
                let p = format!("{path}[]");
                if matches!(item, J::Obj(_) | J::Arr(_)) {
                    survey_walk(item, &p, stats, arrays);
                } else {
                    survey_leaf(item, &p, stats);
                }
            }
        }
        _ => survey_leaf(node, path, stats),
    }
}

fn survey_leaf(v: &J, path: &str, stats: &mut Vec<(String, Stat)>) {
    let i = match stats.iter().position(|(p, _)| p == path) {
        Some(i) => i,
        None => {
            stats.push((path.to_string(), Stat { types: BTreeSet::new(), of: 0, nonnull: 0, first: None }));
            stats.len() - 1
        }
    };
    let st = &mut stats[i].1;
    st.of += 1;
    st.types.insert(v.type_name());
    if !matches!(v, J::Null) && *v != J::Str(String::new()) {
        st.nonnull += 1;
        if st.first.is_none() {
            st.first = Some(v.clone());
        }
    }
}

/// このアプリが使っている応答の項目 → 用途
fn used_paths(km: &KeyMap, cfg: &ApiCfg) -> Vec<(String, Vec<String>)> {
    let head = if cfg.entity.is_empty() { String::new() } else { format!("{}.", cfg.entity) };
    let mut used: Vec<(String, Vec<String>)> = vec![];
    for sec in ["lot", "actual", "design"] {
        let base = km.data.get(sec).and_then(|s| s.get("list")).map(J::py_str).unwrap_or_else(|| "None".into());
        let cols: Vec<String> =
            km.data.get(sec).and_then(|s| s.get("cols")).map(|c| c.entries().iter().map(|(k, _)| k.clone()).collect()).unwrap_or_default();
        for col in cols {
            let Some(k) = km.key(sec, &col) else { continue };
            let path = format!("{head}{}", if sec == "lot" { k } else { format!("{base}[].{k}") });
            match used.iter_mut().find(|(p, _)| *p == path) {
                Some(x) => x.1.push(format!("{sec}.{col}")),
                None => used.push((path, vec![format!("{sec}.{col}")])),
            }
        }
    }
    used
}

pub fn survey(result: &J, km: &KeyMap, cfg: &ApiCfg, values: bool) -> Map<String, Value> {
    let (mut stats, mut arrays) = (vec![], vec![]);
    survey_walk(result, "", &mut stats, &mut arrays);
    let used = used_paths(km, cfg);
    let used_of = |p: &str| used.iter().find(|(k, _)| k == p).map(|(_, v)| json!(v)).unwrap_or(Value::Null);
    let mut fields = vec![];
    for (path, st) in &stats {
        let mut row = json!({"path": path, "type": st.types.iter().copied().collect::<Vec<_>>().join("/"),
                             "shape": st.first.as_ref().map(|v| json!(shape(v))).unwrap_or(Value::Null),
                             "nonnull": st.nonnull, "of": st.of, "used_for": used_of(path)});
        if values && st.nonnull > 0 {
            row["value"] = json!(st.first.as_ref().map(|v| v.py_str().chars().take(80).collect::<String>()).unwrap_or_default());
        }
        fields.push(row);
    }
    let non_empty = fields.iter().filter(|f| f["nonnull"].as_i64().unwrap_or(0) > 0).count();
    let used_n = fields.iter().filter(|f| truthy(Some(&f["used_for"]))).count();
    let unused: Vec<Value> = fields
        .iter()
        .filter(|f| f["nonnull"].as_i64().unwrap_or(0) > 0 && !truthy(Some(&f["used_for"])))
        .map(|f| f["path"].clone())
        .collect();
    let mut out = Map::new();
    out.insert("values_included".into(), json!(values));
    out.insert(
        "note".into(),
        json!(if values {
            "値を含みます。この PC の画面で見るだけにしてください（実際の製造・検査・受注データは外部へ渡さない）。"
        } else {
            "形だけです（数字→9・英字→a）。値は含みません。"
        }),
    );
    out.insert(
        "summary".into(),
        json!({"fields": fields.len(), "non_empty": non_empty, "used_by_app": used_n,
               "arrays": arrays.iter().map(|(p, n)| json!({"path": p, "length": n})).collect::<Vec<_>>()}),
    );
    out.insert("unused_non_empty".into(), Value::Array(unused));
    out.insert("fields".into(), Value::Array(fields));
    out
}

// ================================================================== 調べる道具（lotdsp_link.py）
const LABEL_MAX: usize = 24;
const COLUMN_MATCH: f64 = 0.8;
const COLUMN_MIN_PAIRS: i64 = 2;

fn label_like(t: &str) -> bool {
    let t = nfkc(t);
    !t.is_empty() && t.chars().count() <= LABEL_MAX && !num_text(&t) && !dateish(&t) && t.chars().any(char::is_alphabetic)
}

fn distinctive_screen(t: &str) -> bool {
    let d = nfkc(t);
    if d.is_empty() {
        return false;
    }
    if num_text(&d) {
        return digits_of(&d).chars().count() >= 3 && pyfloat(&d.replace(',', "")) != Some(0.0);
    }
    if dateish(&d) {
        return digits_of(&d).chars().count() >= 4;
    }
    d.chars().count() >= 2
}

fn distinctive_api(v: &J) -> bool {
    match v {
        J::Null | J::Bool(_) | J::Arr(_) | J::Obj(_) => false,
        J::Int(_) | J::Big(_) | J::Float(_) => {
            let f = v.as_f64().unwrap_or(f64::NAN);
            let mut txt = py_g(f, 10);
            if txt.contains('.') && !txt.contains('e') {
                txt = txt.trim_end_matches('0').trim_end_matches('.').to_string();
            } else if txt.contains('.') {
                // 「1.5e+10」の形（Python は字の末尾の 0 だけを取る: 指数の後ろは数字なので変わらない）
                txt = txt.trim_end_matches('0').trim_end_matches('.').to_string();
            }
            digits_of(&txt).chars().count() >= 3 && f != 0.0
        }
        J::Str(s) => nfkc(s).chars().count() >= 2,
    }
}

#[derive(Clone)]
struct Cell {
    value: String,
    labels: Vec<(String, &'static str)>,
}

struct Screen {
    tab: String,
    lot: String,
    cells: Vec<Cell>,
    columns: Vec<(String, Vec<String>)>,
}

/// 選ばれているタブ（MniTabSelTxt[^>]*>\s*<span[^>]*>\s*([^<]+?)\s*</span>）
fn selected_tab(html: &str) -> String {
    let lit = "MniTabSelTxt";
    let mut from = 0;
    while let Some(p) = html[from..].find(lit) {
        let at = from + p + lit.len();
        from = from + p + 1;
        let rest = &html[at..];
        let Some(gt) = rest.find('>') else { continue };
        let r = rest[gt + 1..].trim_start_matches(pyfmt::is_space);
        let Some(r) = r.strip_prefix("<span") else { continue };
        let Some(gt2) = r.find('>') else { continue };
        let r = &r[gt2 + 1..];
        let Some(lt) = r.find('<') else { continue };
        if !r[lt..].starts_with("</span>") {
            continue;
        }
        let cap = r[..lt].trim_start_matches(pyfmt::is_space);
        let content = if cap.is_empty() {
            // 中身が空白だけ: 最後の 1 字（空白）が拾われ、NFKC・strip で空
            let whole = &r[..lt];
            if whole.is_empty() {
                continue;
            }
            String::new()
        } else {
            cap.trim_end_matches(pyfmt::is_space).to_string()
        };
        return nfkc(&content);
    }
    String::new()
}

fn read_screen(html: &str) -> Result<Screen, String> {
    let tables = lotdsp_html::inner_tables(html)?;
    let tab = selected_tab(html);
    let (mut cells, mut columns) = (vec![], vec![]);
    for rows in tables.iter() {
        let width = rows.iter().map(Vec::len).max().unwrap_or(0);
        for (r, row) in rows.iter().enumerate() {
            for (c, v) in row.iter().enumerate() {
                if nfkc(v).is_empty() {
                    continue;
                }
                let mut cand: Vec<(String, &'static str)> = vec![];
                if r > 0 && c < rows[0].len() && label_like(&rows[0][c]) {
                    cand.push((nfkc(&rows[0][c]), "header"));
                }
                for rr in (0..r).rev() {
                    if c < rows[rr].len() && label_like(&rows[rr][c]) {
                        cand.push((nfkc(&rows[rr][c]), "above"));
                        break;
                    }
                }
                for cc in (0..c).rev() {
                    if label_like(&row[cc]) {
                        cand.push((nfkc(&row[cc]), "left"));
                        break;
                    }
                }
                if c > 0 && label_like(&row[0]) {
                    cand.push((nfkc(&row[0]), "row"));
                }
                let me = nfkc(v);
                let mut labels: Vec<(String, &'static str)> = vec![];
                for (label, how) in cand {
                    if label != me && !labels.iter().any(|(l, _)| *l == label) {
                        labels.push((label, how));
                    }
                }
                cells.push(Cell { value: me, labels });
            }
        }
        if rows.len() >= 3 {
            for c in 0..width {
                let head = rows[0].get(c).cloned().unwrap_or_default();
                let vals: Vec<String> = rows[1..].iter().map(|rr| rr.get(c).map(|x| nfkc(x)).unwrap_or_default()).collect();
                if label_like(&head) && vals.iter().filter(|x| distinctive_screen(x)).count() as i64 >= COLUMN_MIN_PAIRS {
                    columns.push((nfkc(&head), vals));
                }
            }
        }
    }
    let lot = pyfmt::strip(&lot_fields(&tables, &Value::Null).get("lot_no").map(J::py_str).unwrap_or_default()).to_string();
    Ok(Screen { tab, lot, cells, columns })
}

struct Index {
    cells: Vec<usize>,
    by_text: Vec<(String, Vec<usize>)>,
    numeric: Vec<(f64, usize, usize)>,
    dates: Vec<(String, usize)>,
}

impl Index {
    fn new(cells: &[Cell]) -> Index {
        let mut ix = Index { cells: vec![], by_text: vec![], numeric: vec![], dates: vec![] };
        for (i, c) in cells.iter().enumerate() {
            if !distinctive_screen(&c.value) {
                continue;
            }
            ix.cells.push(i);
            let v = &c.value;
            let key = v.replace(' ', "");
            match ix.by_text.iter_mut().find(|(k, _)| *k == key) {
                Some(x) => x.1.push(i),
                None => ix.by_text.push((key, vec![i])),
            }
            let code = v.chars().count() > 1 && v.starts_with('0') && !v.contains('.');
            if num_text(v) && !code {
                let dec = v.split_once('.').map(|(_, b)| b.chars().count()).unwrap_or(0);
                if let Some(f) = pyfloat(&v.replace(',', "")) {
                    ix.numeric.push((f, dec, i));
                }
            } else if dateish(v) && digits_of(v).chars().count() >= 6 {
                ix.dates.push((digits_of(v), i));
            }
        }
        ix
    }

    fn find(&self, raw: &J) -> Vec<usize> {
        let mut out: Vec<usize> = vec![];
        if raw.is_number() {
            let x = raw.as_f64().unwrap_or(f64::NAN);
            out.extend(self.numeric.iter().filter(|(y, d, _)| rules::round_eq(*y, *d, x)).map(|(_, _, c)| *c));
        } else {
            let t = nfkc(&raw.py_str()).replace(' ', "");
            if let Some((_, cs)) = self.by_text.iter().find(|(k, _)| *k == t) {
                out.extend(cs);
            }
            if num_text(&t) {
                if let Some(x) = pyfloat(&t.replace(',', "")) {
                    for (y, d, c) in &self.numeric {
                        if rules::round_eq(*y, *d, x) && !out.contains(c) {
                            out.push(*c);
                        }
                    }
                }
            }
        }
        if let Some(m) = moment(raw) {
            if !self.dates.is_empty() {
                let stamp = stamp_full(m);
                for (d, c) in &self.dates {
                    if stamp.contains(d.as_str()) && !out.contains(c) {
                        out.push(*c);
                    }
                }
            }
        }
        out
    }
}

type Scalars = Vec<(String, J)>;
type Columns = Vec<(String, Vec<J>)>;

fn flat(node: &J, prefix: &str, out: &mut Vec<(String, J)>) {
    match node {
        J::Obj(m) => {
            for (k, v) in m {
                flat(v, &if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") }, out);
            }
        }
        J::Arr(_) => {}
        _ => put(out, prefix.to_string(), node.clone()),
    }
}

fn collect(result: &J) -> (Scalars, Columns) {
    let (mut scalars, mut columns): (Scalars, Columns) = (vec![], vec![]);
    fn walk(node: &J, path: &str, scalars: &mut Scalars, columns: &mut Columns) {
        let J::Obj(m) = node else { return };
        for (k, v) in m {
            let p = if path.is_empty() { k.clone() } else { format!("{path}.{k}") };
            match v {
                J::Arr(a) if !a.is_empty() && a.iter().all(J::is_obj) => {
                    let flats: Vec<Vec<(String, J)>> = a
                        .iter()
                        .map(|x| {
                            let mut d = vec![];
                            flat(x, "", &mut d);
                            d
                        })
                        .collect();
                    let mut keys: Vec<String> = vec![];
                    for d in &flats {
                        for (kk, _) in d {
                            if !keys.contains(kk) {
                                keys.push(kk.clone());
                            }
                        }
                    }
                    for kk in keys {
                        let vals: Vec<J> =
                            flats.iter().map(|d| d.iter().find(|(n, _)| *n == kk).map(|(_, v)| v.clone()).unwrap_or(J::Null)).collect();
                        let name = format!("{p}[].{kk}");
                        if vals.len() == 1 {
                            put(scalars, name, vals[0].clone());
                        } else {
                            put(columns, name, vals);
                        }
                    }
                }
                J::Obj(_) => walk(v, &p, scalars, columns),
                J::Arr(_) => {}
                _ => put(scalars, p, v.clone()),
            }
        }
    }
    walk(result, "", &mut scalars, &mut columns);
    (scalars, columns)
}

fn value_texts(scalars: &Scalars, columns: &Columns, ix: &Index, cells: &[Cell]) -> BTreeSet<String> {
    let mut texts = BTreeSet::new();
    for raw in scalars.iter().map(|(_, v)| v).chain(columns.iter().flat_map(|(_, v)| v.iter())) {
        if distinctive_api(raw) {
            texts.extend(ix.find(raw).into_iter().map(|c| cells[c].value.clone()));
        }
    }
    texts
}

fn best_label(cell: &Cell, texts: &BTreeSet<String>) -> Option<String> {
    cell.labels.iter().find(|(l, _)| !texts.contains(l)).map(|(l, _)| l.clone())
}

struct Linked {
    labels: Vec<String>,
    votes: Vec<(String, i64)>,
    kind: &'static str,
}

fn link_one(result: &J, screen: &Screen) -> Vec<(String, Linked)> {
    let (scalars, columns) = collect(result);
    let ix = Index::new(&screen.cells);
    let texts = value_texts(&scalars, &columns, &ix, &screen.cells);
    let mut out: Vec<(String, Linked)> = vec![];
    for (path, raw) in &scalars {
        if !distinctive_api(raw) {
            continue;
        }
        let hits = ix.find(raw);
        if hits.is_empty() {
            continue;
        }
        let mut score: Vec<(String, i64)> = vec![];
        for c in &hits {
            if let Some(l) = best_label(&screen.cells[*c], &texts) {
                match score.iter_mut().find(|(n, _)| *n == l) {
                    Some(x) => x.1 += 1,
                    None => score.push((l, 1)),
                }
            }
        }
        if !score.is_empty() {
            let mut labels = score.clone();
            labels.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            put(&mut out, path.clone(), Linked { labels: labels.into_iter().map(|x| x.0).collect(), votes: score, kind: "値" });
        }
    }
    for (path, vals) in &columns {
        let mut best: Option<((i64, i64), String)> = None;
        for (label, cvals) in &screen.columns {
            let n = vals.len().min(cvals.len());
            let (mut pairs, mut ok) = (0i64, 0i64);
            for (raw, disp) in vals[..n].iter().zip(&cvals[..n]) {
                if distinctive_api(raw) && distinctive_screen(disp) {
                    pairs += 1;
                    ok += (same(disp, Some(raw)) == Some(true)) as i64;
                }
            }
            if pairs >= COLUMN_MIN_PAIRS && ok as f64 / pairs as f64 >= COLUMN_MATCH && best.as_ref().is_none_or(|b| (ok, pairs) > b.0) {
                best = Some(((ok, pairs), label.clone()));
            }
        }
        if let Some(((ok, _), label)) = best {
            put(&mut out, path.clone(), Linked { labels: vec![label.clone()], votes: vec![(label, ok)], kind: "列" });
        }
    }
    out
}

fn unmatched(result: &J, screen: &Screen) -> Vec<String> {
    let (scalars, columns) = collect(result);
    let ix = Index::new(&screen.cells);
    let mut matched: BTreeSet<usize> = BTreeSet::new();
    for raw in scalars.iter().map(|(_, v)| v).chain(columns.iter().flat_map(|(_, v)| v.iter())) {
        if distinctive_api(raw) {
            matched.extend(ix.find(raw));
        }
    }
    let texts = value_texts(&scalars, &columns, &ix, &screen.cells);
    let mut labels: Vec<String> = vec![];
    for c in &ix.cells {
        if let Some(l) = best_label(&screen.cells[*c], &texts) {
            if !matched.contains(c) && !labels.contains(&l) {
                labels.push(l);
            }
        }
    }
    labels
}

/// 画面のファイル（{name, html}）の並び → 紐づけの結果
pub fn link_files(files: &[J], km: &KeyMap, cfg: &ApiCfg, call_api: &dyn Fn(&str) -> Result<J, ApiError>) -> Value {
    let mut results: BTreeMap<String, J> = BTreeMap::new();
    let mut per_file: Vec<Value> = vec![];
    type Found = Vec<(Vec<String>, Vec<(String, i64)>, &'static str, String)>;
    let mut acc: Vec<((String, String), Found)> = vec![];
    let mut gone: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for f in files {
        let name = match f.get("name") {
            Some(J::Str(s)) if !s.is_empty() => s.clone(),
            _ => "画面".to_string(),
        };
        let html = match f.get("html") {
            None | Some(J::Null) => String::new(),
            Some(J::Str(s)) => s.clone(),
            Some(_) => {
                per_file.push(json!({"name": name, "error": "画面を読めませんでした: HTML は字で送ってください。"}));
                continue;
            }
        };
        if html.chars().count() > rules::MAX_HTML_CHARS {
            per_file.push(
                json!({"name": name, "error": "画面を読めませんでした: HTML が大きすぎます（進度情報の画面だけを渡してください）。"}),
            );
            continue;
        }
        let screen = match read_screen(&html) {
            Ok(s) => s,
            Err(e) => {
                per_file.push(json!({"name": name, "error": format!("画面を読めませんでした: {e}")}));
                continue;
            }
        };
        if screen.lot.is_empty() {
            per_file.push(json!({"name": name, "tab": screen.tab, "error": "画面からロット番号を読めませんでした（LotDsp の画面を保存したものか確かめてください）"}));
            continue;
        }
        if !results.contains_key(&screen.lot) {
            let got = call_api(&screen.lot).and_then(|r| entity_of(&r, cfg, &screen.lot).map(|_| ()).map(|_| r));
            match got {
                Ok(r) => {
                    results.insert(screen.lot.clone(), r);
                }
                Err(e) => {
                    per_file.push(json!({"name": name, "tab": screen.tab, "lot": screen.lot, "error": e.msg}));
                    continue;
                }
            }
        }
        let res = &results[&screen.lot];
        let one = link_one(res, &screen);
        let tab = if screen.tab.is_empty() { "（タブ名なし）".to_string() } else { screen.tab.clone() };
        for (path, info) in &one {
            let key = (tab.clone(), path.clone());
            let item = (info.labels.clone(), info.votes.clone(), info.kind, screen.lot.clone());
            match acc.iter_mut().find(|(k, _)| *k == key) {
                Some(x) => x.1.push(item),
                None => acc.push((key, vec![item])),
            }
        }
        gone.entry(tab.clone()).or_default().extend(unmatched(res, &screen));
        per_file.push(json!({"name": name, "tab": tab, "lot": screen.lot, "cells": screen.cells.len(), "linked": one.len()}));
    }
    let used = used_paths(km, cfg);
    let mut rows: Vec<(String, i64, String, Value)> = vec![];
    for ((tab, path), found) in &acc {
        let sets: Vec<BTreeSet<String>> = found.iter().map(|f| f.0.iter().cloned().collect()).collect();
        let inter: BTreeSet<String> = sets.iter().skip(1).fold(sets[0].clone(), |a, b| a.intersection(b).cloned().collect());
        let lots: BTreeSet<String> = found.iter().map(|f| f.3.clone()).collect();
        let pool: BTreeSet<String> = if inter.is_empty() { sets.iter().flatten().cloned().collect() } else { inter.clone() };
        let vote = |x: &str| -> i64 { found.iter().map(|f| f.1.iter().find(|(n, _)| n == x).map(|(_, v)| *v).unwrap_or(0)).sum() };
        let mut labels: Vec<String> = pool.into_iter().collect();
        labels.sort_by(|a, b| vote(b).cmp(&vote(a)).then(a.cmp(b)));
        let strong = found.iter().any(|f| f.2 == "列");
        let lead = labels.len() == 1 || (labels.len() > 1 && vote(&labels[0]) > vote(&labels[1]));
        let (status, order) = if !inter.is_empty() && lead && (lots.len() >= 2 || strong) {
            ("確定", 0)
        } else if !inter.is_empty() {
            ("候補", 1)
        } else {
            ("食い違い", 2)
        };
        let used_for = used.iter().find(|(p, _)| p == path).map(|(_, v)| json!(v)).unwrap_or(Value::Null);
        let row = json!({"tab": tab, "path": path, "labels": labels.iter().take(4).collect::<Vec<_>>(), "status": status, "lots": lots.len(),
                         "kind": if strong { "列" } else { "値" }, "used_for": used_for});
        rows.push((tab.clone(), order, path.clone(), row));
    }
    rows.sort_by(|a, b| (&a.0, a.1, &a.2).cmp(&(&b.0, b.1, &b.2)));
    let count = |s: &str| rows.iter().filter(|r| r.3["status"] == s).count();
    let tabs: BTreeSet<String> = rows.iter().map(|r| r.0.clone()).collect();
    json!({
        "files": per_file,
        "summary": {"linked": rows.len(), "confirmed": count("確定"), "candidates": count("候補"), "conflicts": count("食い違い"),
                    "lots": results.keys().collect::<Vec<_>>(), "tabs": tabs},
        "links": rows.into_iter().map(|r| r.3).collect::<Vec<_>>(),
        "screen_only": gone.iter().map(|(t, v)| (t.clone(), json!(v.iter().take(80).collect::<Vec<_>>()))).collect::<Map<String, Value>>(),
        "note": "値は含みません（項目の道すじと画面の見出しだけです）。確定は、見出しが1つに絞れて、2つ以上のロット（または並びの列の照合）で一致したものです。",
    })
}

// ================================================================== 道（routes/lots.py の 9 本）
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Route {
    Import,
    Fetch,
    FetchApi,
    Survey,
    Link,
    Page,
    ApiStatus,
    FetchStatus,
    Cancel,
}

pub const ROUTES: [(&str, &str, Route); 9] = [
    ("POST", "/api/lots/import-lotdsp", Route::Import),
    ("POST", "/api/lots/fetch-lotdsp", Route::Fetch),
    ("POST", "/api/lots/fetch-lotdsp-api", Route::FetchApi),
    ("GET", "/api/lots/lotdsp-api/survey", Route::Survey),
    ("POST", "/api/lots/lotdsp-api/link", Route::Link),
    ("GET", "/lotdsp-link", Route::Page),
    ("GET", "/api/lots/lotdsp-api/status", Route::ApiStatus),
    ("GET", "/api/lots/fetch-lotdsp/status", Route::FetchStatus),
    ("POST", "/api/lots/fetch-lotdsp/cancel", Route::Cancel),
];

pub fn route_of(method: &str, path: &str) -> Option<Route> {
    let m = if method == "HEAD" { "GET" } else { method };
    ROUTES.iter().find(|(mm, p, _)| *mm == m && *p == path).map(|x| x.2)
}

/// 道に効く材料（呼ぶ側が束の材料から組む）
pub struct Inputs {
    /// 配った設定の lotdsp_import（取込の列・設備マスタで絞るか）
    pub app: Value,
    /// 参照先を重ねた lotdsp_import（API・見えない Edge の設定）
    pub eff: Value,
    pub equipment: Vec<Value>,
}

/// LotDsp の係（このプロセスに 1 つ）
pub struct Lotdsp {
    pub direct: Arc<crate::lotdsp_direct::Direct>,
    maps: Mutex<Option<Arc<Mutex<KeyMap>>>>,
    /// 学ぶのを待つ（試験。Python の LOTDSP_API_SYNC）
    pub sync_learn: std::sync::atomic::AtomicBool,
    pub now_iso: Mutex<NowIso>,
    pub local_root: PathBuf,
}

fn bad(status: u16, msg: impl Into<String>, kind: &str) -> (u16, Value) {
    (status, json!({"error": msg.into(), "kind": kind}))
}

fn py_answer(e: &PyErr) -> (u16, Value) {
    (400, json!({"error": e.msg, "type": e.ty}))
}

/// fetch-lotdsp の理由 → 状態
fn direct_status(kind: &str) -> u16 {
    match kind {
        "login" | "busy" | "cancelled" => 409,
        "not_found" => 404,
        "invalid" => 400,
        _ => 503,
    }
}

/// API の理由 → 状態
fn api_status(kind: &str) -> u16 {
    match kind {
        "not_ready" | "disabled" => 409,
        "not_found" => 404,
        _ => 502,
    }
}

impl Lotdsp {
    pub fn new(local_root: PathBuf, direct: Arc<crate::lotdsp_direct::Direct>) -> Lotdsp {
        Lotdsp {
            direct,
            maps: Mutex::default(),
            sync_learn: std::sync::atomic::AtomicBool::new(false),
            now_iso: Mutex::new(system_now_iso()),
            local_root,
        }
    }

    /// 学びの覚え（作業場所の lotdsp_api_map.json。プロセスに 1 つ）
    pub fn keymap(&self) -> Arc<Mutex<KeyMap>> {
        let mut m = self.maps.lock().unwrap();
        m.get_or_insert_with(|| Arc::new(Mutex::new(KeyMap::load(&self.local_root.join("lotdsp_api_map.json"))))).clone()
    }

    fn now(&self) -> NowIso {
        self.now_iso.lock().unwrap().clone()
    }

    /// 覚えを変えて保存する。保存に失敗したらメモリも前に戻す
    fn change(&self, km: &Mutex<KeyMap>, f: impl FnOnce(&mut KeyMap)) -> std::io::Result<()> {
        let mut g = km.lock().unwrap();
        g.refresh();
        let before = g.data.clone();
        f(&mut g);
        if let Err(e) = g.save() {
            g.data = before;
            return Err(e);
        }
        Ok(())
    }

    /// 画面（HTML）で読めたあと: 同じロットを API で引いて学ぶ（失敗は記録だけ）
    pub fn learn_from_html(&self, cfg: &ApiCfg, html: &str, lot_no: &str, read_cfg: &Value) {
        let km = self.keymap();
        let now = self.now();
        let res: Result<(), (String, String)> = (|| {
            let (tables, actual, design) = progress_tables(html, read_cfg).map_err(|e| ("learn".to_string(), e.msg))?;
            let result = call(lot_no, cfg).map_err(|e| (e.kind.to_string(), e.msg.clone()))?;
            let entity = entity_of(&result, cfg, lot_no).map_err(|e| (e.kind.to_string(), e.msg.clone()))?.clone();
            self.change(&km, |m| learn(m, &entity, cfg, &tables, &actual, &design, lot_no, &now))
                .map_err(|e| ("learn".to_string(), crate::cm3_http::os_text(&e)))
        })();
        if let Err((kind, msg)) = res {
            let at = now();
            let _ = self.change(&km, |m| {
                m.data.set(
                    "last_error",
                    J::Obj(vec![
                        ("at".into(), J::Str(at)),
                        ("lot".into(), J::Str(lot_no.into())),
                        ("kind".into(), J::Str(kind)),
                        ("message".into(), J::Str(msg)),
                    ]),
                )
            });
        }
    }

    fn learn_later(self: &Arc<Self>, cfg: ApiCfg, html: String, lot_no: String, read_cfg: Value) {
        if !cfg.enabled || lot_no.is_empty() {
            return;
        }
        if self.sync_learn.load(std::sync::atomic::Ordering::SeqCst) {
            self.learn_from_html(&cfg, &html, &lot_no, &read_cfg);
            return;
        }
        let me = self.clone();
        let _ = std::thread::Builder::new().name("lotdsp-learn".into()).spawn(move || me.learn_from_html(&cfg, &html, &lot_no, &read_cfg));
    }

    fn read_and_learn(self: &Arc<Self>, html: &str, expect: &str, inp: &Inputs, api: Option<&ApiCfg>) -> Result<(Value, Value), PyErr> {
        let master = Master::new(&inp.equipment);
        let (lot, report, ..) = read_html(html, &master, &inp.app, expect)?;
        if let Some(cfg) = api {
            let lot_no = lot["lot_no"].as_str().unwrap_or("").to_string();
            self.learn_later(cfg.clone(), html.to_string(), lot_no, inp.app.clone());
        }
        Ok((lot, report))
    }

    /// 9 本の答え（どの形も窓が答える。Python に任せない）。材料を組めないときは inp が Err（理由の字）
    pub fn handle(
        self: &Arc<Self>,
        route: Route,
        query: &str,
        body: &[u8],
        inp: &dyn Fn() -> Result<Inputs, String>,
        clock: &dyn Fn() -> f64,
    ) -> (u16, Value) {
        let t0 = clock();
        // 材料の要らない道
        match route {
            Route::FetchStatus => return (200, self.direct.status()),
            Route::Cancel => return (200, json!({"cancelled": self.direct.cancel()})),
            _ => {}
        }
        let payload = if matches!(route, Route::Import | Route::Fetch | Route::FetchApi | Route::Link) {
            match rules::read_body(body) {
                Ok(b) => b,
                Err(m) => return bad(400, m, "invalid"),
            }
        } else {
            J::obj()
        };
        let inp = match inp() {
            Ok(i) => i,
            Err(why) => return bad(503, format!("LotDsp の設定・設備マスタを読めません（{why}）。"), "settings"),
        };
        let api = ApiCfg::from(&inp.eff);
        match route {
            Route::Import => {
                let html = match rules::html_of(&payload, "html") {
                    Ok(h) => h,
                    Err(m) => return bad(400, m, "invalid"),
                };
                let lot_no = match rules::norm_lot(payload.get("lot_no")) {
                    Ok(l) => l,
                    Err(m) => return bad(400, m, "invalid"),
                };
                let Ok(api) = api else { return bad(503, "LotDsp の API の設定を読めません。", "settings") };
                match self.read_and_learn(&html, &lot_no, &inp, Some(&api)) {
                    Ok((lot, report)) => (200, json!({"lot": lot, "report": report})),
                    Err(e) => py_answer(&e),
                }
            }
            Route::Fetch => {
                let lot_no = match rules::checked_lot(payload.get("lot_no")) {
                    Ok(l) => l,
                    Err(m) => return bad(400, m, "invalid"),
                };
                let cfg = match crate::lotdsp_direct::Cfg::from(&inp.eff, &self.local_root) {
                    Ok(c) => c,
                    Err(m) => return bad(503, format!("LotDsp の設定を読めません（{m}）。"), "settings"),
                };
                let html = match self.direct.fetch(&lot_no, &cfg, rules::flag_of(&payload, "login_window")) {
                    Ok(h) => h,
                    Err(e) => return bad(direct_status(&e.kind), e.msg, &e.kind),
                };
                let Ok(api) = api else { return bad(503, "LotDsp の API の設定を読めません。", "settings") };
                match self.read_and_learn(&html, &lot_no, &inp, Some(&api)) {
                    Ok((lot, mut report)) => {
                        let s = rules::seconds_of(t0, clock());
                        report["seconds"] = json!(s);
                        (200, json!({"lot": lot, "report": report, "seconds": s}))
                    }
                    Err(e) => bad(400, e.msg, "parse"),
                }
            }
            Route::FetchApi => {
                let lot_no = match rules::checked_lot(payload.get("lot_no")) {
                    Ok(l) => l,
                    Err(m) => return bad(400, m, "invalid"),
                };
                let Ok(api) = api else { return bad(503, "LotDsp の API の設定を読めません。", "settings") };
                let km = self.keymap();
                let g = {
                    let mut g = km.lock().unwrap();
                    g.refresh();
                    KeyMap { path: g.path.clone(), data: g.data.clone(), sig: g.sig }
                };
                match api_read_lot(&g, &api, &lot_no, &Master::new(&inp.equipment), &inp.app) {
                    Ok((lot, mut report)) => {
                        let s = rules::seconds_of(t0, clock());
                        report["seconds"] = json!(s);
                        (200, json!({"lot": lot, "report": report, "seconds": s}))
                    }
                    Err(ReadErr::Api(e)) => bad(api_status(e.kind), e.msg, e.kind),
                    Err(ReadErr::Py(e)) => bad(400, e.msg, "parse"),
                }
            }
            Route::Survey => {
                let qs = crate::lotlist::parse_query(query);
                let arg = |k: &str| qs.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
                let raw = arg("lot").unwrap_or_default();
                if pyfmt::strip(&raw).is_empty() {
                    return bad(400, "ロット番号を付けてください（例: …/survey?lot=L7150C0）。", "invalid");
                }
                let lot_no = match rules::checked_lot(Some(&J::Str(raw))) {
                    Ok(l) => l,
                    Err(m) => return bad(400, m, "invalid"),
                };
                let Ok(api) = api else { return bad(503, "LotDsp の API の設定を読めません。", "settings") };
                let result = match call(&lot_no, &api).and_then(|r| entity_of(&r, &api, &lot_no).map(|_| ()).map(|_| r)) {
                    Ok(r) => r,
                    Err(e) => return bad(api_status(e.kind), e.msg, e.kind),
                };
                let km = self.keymap();
                let mut g = km.lock().unwrap();
                g.refresh();
                let mut out = survey(&result, &g, &api, arg("values").as_deref() == Some("1"));
                out.insert("lot".into(), json!(lot_no));
                (200, Value::Object(out))
            }
            Route::Link => {
                let files = match payload.get("files") {
                    None | Some(J::Null) => vec![],
                    Some(J::Arr(a)) => a.iter().filter(|f| f.is_obj()).cloned().collect(),
                    Some(_) => return bad(400, "files は並びで送ってください。", "invalid"),
                };
                if files.is_empty() {
                    return bad(400, "画面（保存した HTML）を1つ以上渡してください。", "invalid");
                }
                if files.len() > 40 {
                    return bad(400, "一度に渡せるのは 40 ファイルまでです。", "invalid");
                }
                let Ok(api) = api else { return bad(503, "LotDsp の API の設定を読めません。", "settings") };
                let km = self.keymap();
                let g = {
                    let mut g = km.lock().unwrap();
                    g.refresh();
                    KeyMap { path: g.path.clone(), data: g.data.clone(), sig: g.sig }
                };
                (200, link_files(&files, &g, &api, &|lot| call(lot, &api)))
            }
            Route::ApiStatus => {
                let Ok(api) = api else { return bad(503, "LotDsp の API の設定を読めません。", "settings") };
                let km = self.keymap();
                let mut g = km.lock().unwrap();
                g.refresh();
                (200, g.status(api.enabled))
            }
            Route::Page | Route::FetchStatus | Route::Cancel => (500, json!({"error": "ここには来ない"})),
        }
    }

    /// アプリの終わり: 使い回しているブラウザを閉じる
    pub fn shutdown(&self) {
        self.direct.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn g_format_like_python() {
        for (f, p, want) in [
            (15.0, 6, "15"),
            (0.5, 6, "0.5"),
            (1e-05, 6, "1e-05"),
            (24000.0, 10, "24000"),
            (12345678901.0, 10, "1.23456789e+10"),
            (2.73, 10, "2.73"),
            (1e16, 10, "1e+16"),
        ] {
            assert_eq!(py_g(f, p), want, "{f}");
        }
        assert_eq!(json_ascii("ａ\"x"), "\"\\uff41\\\"x\"");
    }

    #[test]
    fn numbers_and_dates() {
        assert_eq!(rules::to_number_str(".5"), Some(0.5));
        assert_eq!(rules::to_number_str("12mm"), Some(12.0), "単位は捨てる（決め ② の言い直し）");
        assert_eq!(rules::read_number_str("7.0/8.0").1, rules::How::Extra);
        assert_eq!(rules::read_number_str("*").1, rules::How::Unreadable);
        assert_eq!(date_text(&J::Int(1758097000000)), "25/09/17 17:16:40");
        assert_eq!(date_text(&J::Str("2025-09-17T08:16:40Z".into())), "25/09/17 17:16:40");
        assert_eq!(date_text(&J::Str("2025-09-17T17:16:40".into())), "25/09/17 17:16:40");
        assert_eq!(same("7", Some(&J::Float(7.4))), Some(false));
        assert_eq!(same("7.000", Some(&J::Float(7.0004))), Some(true));
        assert!(num_text("1,200.00") && num_text(".5") && !num_text("1.") && !num_text("a1"));
    }
}
