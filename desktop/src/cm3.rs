//! CM3 の答えを整える（版 3.96.0。Python の services/cm3_schedule.py の _decode_body・fix_text・行の区分・_stop_text・normalize・
//! table_rows を写した）。字の決まり（CP932・Shift_JIS・CP1252・HTML の文字参照・charset の名前）は Python から焼いた表
//! （src/cm3_tables.json。program/tools/cm3-tables.py が焼き、tests/test_cm3_tables.py が古い表を止める）で読む。
//!
//! 答えは Python と同じ。Python が落ちる形（例外で 500）と、窓が同じに整えられない形（窓の持たない codec の charset・NaN の数・
//! 読みの割れる JSON・印字できない字の repr など）は Fail::Python で「Python に任せる」（src/schedule.rs が係を降りる）。

use crate::jsontree::Tree;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

/// 取れない・整えられない理由
#[derive(Debug, Clone, PartialEq)]
pub enum Fail {
    /// Python の Cm3Error（利用者に見せる言葉）
    Cm3(String),
    /// 窓は Python と同じに答えられない（Python が落ちる・窓の持たない決まり）。理由は記録のため
    Python(&'static str),
}

pub type R<T> = Result<T, Fail>;

fn py<T>(why: &'static str) -> R<T> {
    Err(Fail::Python(why))
}

// ------------------------------------------------------------------ 焼いた表
struct Codec {
    one: Vec<Option<char>>,
    two: HashMap<u8, Vec<Option<char>>>,
}

struct Tables {
    cp932: Codec,
    shift_jis: Codec,
    cp1252: Vec<Option<char>>,
    cp1252_enc: HashMap<char, u8>,
    names: HashMap<String, String>,
    charrefs: HashMap<u32, String>,
    codepoints: HashSet<u32>,
    codecs: HashMap<String, String>,
    word: HashSet<char>,
}

fn tables() -> &'static Tables {
    static T: OnceLock<Tables> = OnceLock::new();
    T.get_or_init(|| {
        let v: Value = serde_json::from_str(include_str!("cm3_tables.json")).expect("cm3_tables.json");
        let one = |a: &Value| -> Vec<Option<char>> {
            a.as_array().unwrap().iter().map(|x| x.as_i64().filter(|n| *n >= 0).and_then(|n| char::from_u32(n as u32))).collect()
        };
        let codec = |v: &Value| Codec {
            one: one(&v["one"]),
            two: v["two"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, s)| {
                    let lead = u8::from_str_radix(k, 16).unwrap();
                    (lead, s.as_str().unwrap().chars().map(|c| (c != '\0').then_some(c)).collect())
                })
                .collect(),
        };
        let cp1252 = one(&v["cp1252"]);
        let cp1252_enc = cp1252.iter().enumerate().filter_map(|(i, c)| c.map(|c| (c, i as u8))).collect();
        let strs = |o: &Value| -> HashMap<String, String> {
            o.as_object().unwrap().iter().map(|(k, x)| (k.clone(), x.as_str().unwrap().to_string())).collect()
        };
        Tables {
            cp932: codec(&v["cp932"]),
            shift_jis: codec(&v["shift_jis"]),
            cp1252,
            cp1252_enc,
            names: strs(&v["html"]["names"]),
            charrefs: strs(&v["html"]["invalidCharrefs"]).into_iter().map(|(k, x)| (k.parse().unwrap(), x)).collect(),
            codepoints: v["html"]["invalidCodepoints"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u32).collect(),
            codecs: strs(&v["codecs"]),
            word: v["word"].as_str().unwrap().chars().collect(),
        }
    })
}

// ------------------------------------------------------------------ 字の読み（bytes.decode）
/// charset の名前 → Python の codec の名前（codecs.lookup(名前).name）。引けなければ None（LookupError）。
/// Python と同じ順にそろえる: ASCII の大文字を小文字に → encodings.normalize_encoding（英数字と「.」のほかは区切りの「_」に、
/// ASCII でない英数字は落とす）→ 別名の表 → モジュールの名前
pub fn codec_of(name: &str) -> Option<&'static str> {
    let t = tables();
    let mut out = String::new();
    let mut punct = false;
    for c in name.chars().map(|c| c.to_ascii_lowercase()) {
        let alnum = if c.is_ascii() { c.is_ascii_alphanumeric() } else { (c as u32) <= 0xFF && t.word.contains(&c) && c != '_' };
        if alnum || c == '.' {
            if punct && !out.is_empty() {
                out.push('_');
            }
            if c.is_ascii() {
                out.push(c);
            }
            punct = false;
        } else {
            punct = true;
        }
    }
    t.codecs.get(&out).or_else(|| t.codecs.get(&out.replace('.', "_"))).map(String::as_str)
}

fn decode_mb(raw: &[u8], c: &Codec) -> Option<String> {
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        let b = raw[i];
        if let Some(ch) = c.one[b as usize] {
            out.push(ch);
            i += 1;
            continue;
        }
        let row = c.two.get(&b)?;
        let t = *raw.get(i + 1)?;
        if !(0x40..=0xFC).contains(&t) {
            return None;
        }
        out.push(row[(t - 0x40) as usize]?);
        i += 2;
    }
    Some(out)
}

/// codec で読む（Python の raw.decode(codec) の strict）。Some(None) は読めない（UnicodeDecodeError）・None は窓の持たない codec
pub fn decode(raw: &[u8], codec: &str) -> Option<Option<String>> {
    let t = tables();
    Some(match codec {
        "utf-8" => std::str::from_utf8(raw).ok().map(str::to_string),
        "cp932" => decode_mb(raw, &t.cp932),
        "shift_jis" => decode_mb(raw, &t.shift_jis),
        "iso8859-1" => Some(raw.iter().map(|&b| b as char).collect()),
        "ascii" => raw.is_ascii().then(|| String::from_utf8_lossy(raw).into_owned()),
        "cp1252" => raw.iter().map(|&b| t.cp1252[b as usize]).collect(),
        _ => return None,
    })
}

/// 見出しの \w（latin-1 で読んだ字。Python の正規表現の \w）
fn is_word(c: char) -> bool {
    tables().word.contains(&c)
}

/// Content-Type の charset（re.search(r"charset=([\w\-]+)", 見出し, re.I) の 1 つ目）
pub fn charset_of(content_type: &str) -> Option<String> {
    let cs: Vec<char> = content_type.chars().collect();
    let key: Vec<char> = "charset=".chars().collect();
    for i in 0..cs.len() {
        if i + key.len() > cs.len() || !cs[i..i + key.len()].iter().zip(&key).all(|(a, b)| a.to_ascii_lowercase() == *b) {
            continue;
        }
        let name: String = cs[i + key.len()..].iter().take_while(|c| is_word(**c) || **c == '-').collect();
        if !name.is_empty() {
            return Some(name);
        }
    }
    None
}

/// 答えのバイト列 → 字（Python の _decode_body: charset の見出し → UTF-8 → CP932 → UTF-8 の置き換え）
pub fn decode_body(raw: &[u8], content_type: Option<&str>) -> R<String> {
    let mut names: Vec<String> = content_type.and_then(charset_of).into_iter().collect();
    names.push("utf-8".into());
    names.push("cp932".into());
    for n in &names {
        let Some(codec) = codec_of(n) else { continue }; // LookupError
        match decode(raw, codec) {
            None => return py("窓の持たない codec の charset"),
            Some(Some(s)) => return Ok(s),
            Some(None) => continue,
        }
    }
    Ok(String::from_utf8_lossy(raw).into_owned())
}

// ------------------------------------------------------------------ Python の値の字
/// Python の str(値)（JSON から読んだ値）。印字できるか分からない字を含む並び・表の repr は Python に任せる
pub fn py_str(v: &Tree) -> R<String> {
    match v {
        Tree::Str(s) => Ok(s.clone()),
        x => py_repr(x),
    }
}

/// repr で逃がさずに書く字か（Python の str.isprintable の確かな所だけ。ほかは Python に任せる）
fn plainly_printable(c: char) -> bool {
    let n = c as u32;
    (0x20..0x7F).contains(&n)
        || (0xA1..=0x2FF).contains(&n) && n != 0xAD
        || (0x3001..=0x30FF).contains(&n)
        || (0x3400..=0x9FFF).contains(&n)
        || (0xFF01..=0xFFEF).contains(&n)
}

/// Python の repr(値)
pub fn py_repr(v: &Tree) -> R<String> {
    Ok(match v {
        Tree::Null => "None".into(),
        Tree::Bool(b) => (if *b { "True" } else { "False" }).into(),
        Tree::Num(n) => num_text(n),
        Tree::Str(s) => {
            if !s.chars().all(|c| plainly_printable(c) || matches!(c, '\n' | '\r' | '\t')) {
                return py("repr に印字できるか分からない字");
            }
            crate::pyfmt::str_repr(s)
        }
        Tree::Arr(a) => format!("[{}]", a.iter().map(py_repr).collect::<R<Vec<_>>>()?.join(", ")),
        Tree::Obj(m) => {
            let items =
                m.iter().map(|(k, x)| Ok(format!("{}: {}", py_repr(&Tree::Str(k.clone()))?, py_repr(x)?))).collect::<R<Vec<_>>>()?;
            format!("{{{}}}", items.join(", "))
        }
    })
}

/// 数の字（int は桁のまま・float は repr）
fn num_text(n: &serde_json::Number) -> String {
    if n.is_i64() || n.is_u64() {
        n.to_string()
    } else {
        crate::pyfmt::float_repr(n.as_f64().unwrap_or(0.0))
    }
}

/// Python の真偽
pub fn truthy(v: &Tree) -> bool {
    match v {
        Tree::Null => false,
        Tree::Bool(b) => *b,
        Tree::Num(n) => n.as_f64() != Some(0.0),
        Tree::Str(s) => !s.is_empty(),
        Tree::Arr(a) => !a.is_empty(),
        Tree::Obj(m) => !m.is_empty(),
    }
}

/// `x or ""`
fn or_empty(v: Option<&Tree>) -> Tree {
    match v {
        Some(x) if truthy(x) => x.clone(),
        _ => Tree::Str(String::new()),
    }
}

// ------------------------------------------------------------------ HTML の文字参照（html.unescape）
/// Python の html.unescape。Python が落ちる形（4300 桁を超える 10 進の参照）は Err
pub fn unescape(s: &str) -> R<String> {
    if !s.contains('&') {
        return Ok(s.to_string());
    }
    let t = tables();
    let cs: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < cs.len() {
        if cs[i] != '&' {
            out.push(cs[i]);
            i += 1;
            continue;
        }
        let rest = &cs[i + 1..];
        // 1. #10 進  2. #x16 進  3. 名前（[^\t\n\f <&#;]{1,32}）。どれも後ろの「;」は 1 つまで（10 進の桁の数は先頭の 0 も数える: Python の int() の 4300 桁の上限。版 3.98.0 で直した）
        let digits = |from: usize, hex: bool| {
            rest[from..].iter().take_while(|c| if hex { c.is_ascii_hexdigit() } else { c.is_ascii_digit() }).count()
        };
        let semi = |at: usize| usize::from(rest.get(at) == Some(&';'));
        let (len, rep) = if rest.first() == Some(&'#') && digits(1, false) > 0 {
            let n = digits(1, false);
            let txt: String = rest[1..1 + n].iter().collect();
            if txt.len() > 4300 {
                return py("4300 桁を超える数の参照（Python の int() が落ちる）");
            }
            (1 + n + semi(1 + n), charref(t, txt.parse::<u128>().unwrap_or(u128::MAX)))
        } else if rest.first() == Some(&'#') && matches!(rest.get(1), Some('x' | 'X')) && digits(2, true) > 0 {
            let n = digits(2, true);
            let txt: String = rest[2..2 + n].iter().collect();
            (
                2 + n + semi(2 + n),
                charref(t, u128::from_str_radix(txt.trim_start_matches('0').get(..32).unwrap_or(&txt), 16).unwrap_or(u128::MAX)),
            )
        } else {
            let n = rest.iter().take(32).take_while(|c| !matches!(c, '\t' | '\n' | '\x0c' | ' ' | '<' | '&' | '#' | ';')).count();
            if n == 0 {
                out.push('&');
                i += 1;
                continue;
            }
            let len = n + semi(n);
            let name: String = rest[..len].iter().collect();
            let rep = match t.names.get(&name) {
                Some(v) => v.clone(),
                None => {
                    let nc: Vec<char> = name.chars().collect();
                    let mut got = None;
                    for x in (2..nc.len()).rev() {
                        let head: String = nc[..x].iter().collect();
                        if let Some(v) = t.names.get(&head) {
                            got = Some(format!("{v}{}", nc[x..].iter().collect::<String>()));
                            break;
                        }
                    }
                    got.unwrap_or_else(|| format!("&{name}"))
                }
            };
            (len, rep)
        };
        out.push_str(&rep);
        i += 1 + len;
    }
    Ok(out)
}

fn charref(t: &Tables, num: u128) -> String {
    if num <= u32::MAX as u128 {
        if let Some(v) = t.charrefs.get(&(num as u32)) {
            return v.clone();
        }
    }
    if (0xD800..=0xDFFF).contains(&num) || num > 0x10FFFF {
        return "\u{FFFD}".into();
    }
    if t.codepoints.contains(&(num as u32)) {
        return String::new();
    }
    char::from_u32(num as u32).map(String::from).unwrap_or_else(|| "\u{FFFD}".into())
}

// ------------------------------------------------------------------ 字の直し（fix_text）
fn latin_high(c: char) -> bool {
    let n = c as u32;
    (0x80..=0xFF).contains(&n) || (0x152..=0x192).contains(&n) || (0x2C6..=0x2DC).contains(&n) || (0x2013..=0x2122).contains(&n)
}

fn jp(c: char) -> bool {
    let n = c as u32;
    (0x3000..=0x30FF).contains(&n) || (0x3400..=0x9FFF).contains(&n) || (0xFF01..=0xFF9F).contains(&n)
}

/// タグ（<[^>]+>）を空白に
fn strip_tags(s: &str) -> String {
    let cs: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < cs.len() {
        if cs[i] == '<' {
            if let Some(j) = cs[i + 1..].iter().position(|c| *c == '>').map(|p| i + 1 + p) {
                if j > i + 1 {
                    out.push(' ');
                    i = j + 1;
                    continue;
                }
            }
        }
        out.push(cs[i]);
        i += 1;
    }
    out
}

/// 見せる字へ直す（Python の fix_text。字だけ。字でない値は呼ぶ側がそのまま使う）
pub fn fix_str(value: &str) -> R<String> {
    if value.is_empty() {
        return Ok(String::new());
    }
    let mut s = value.to_string();
    if s.contains('<') && s.contains('>') {
        s = strip_tags(&s);
    }
    if s.contains('&') {
        s = unescape(&s)?;
    }
    if s.chars().any(latin_high) {
        let t = tables();
        let latin1 = || s.chars().map(|c| u8::try_from(c as u32).ok()).collect::<Option<Vec<u8>>>();
        let cp1252 = || s.chars().map(|c| t.cp1252_enc.get(&c).copied()).collect::<Option<Vec<u8>>>();
        for (src, dst) in [(0, "utf-8"), (1, "utf-8"), (0, "cp932"), (1, "cp932")] {
            let Some(b) = (if src == 0 { latin1() } else { cp1252() }) else { continue };
            let Some(Some(back)) = decode(&b, dst) else { continue };
            if back.chars().any(jp) {
                s = back;
                break;
            }
        }
    }
    Ok(crate::pyfmt::strip(&s.replace('\u{3000}', " ")).to_string())
}

/// fix_text(値): 字なら直し、字でない値（数・null・並び…）はそのまま
pub fn fix_text(v: &Tree) -> R<Tree> {
    match v {
        Tree::Str(s) => Ok(Tree::Str(fix_str(s)?)),
        x => Ok(x.clone()),
    }
}

// ------------------------------------------------------------------ 行の区分
const LOT_DATA_KEYS: [&str; 8] =
    ["zaishitsu", "inItaAtsu", "outItaAtsu", "reienHaba", "seihinItaAtsu", "seihinItaHaba", "keijo", "jiKotei"];
const DIMENSION_KEYS: [&str; 5] = ["inItaAtsu", "outItaAtsu", "reienHaba", "seihinItaAtsu", "seihinItaHaba"];
const NON_TEXT_KEYS: [&str; 5] = ["rowStyle", "teisiStyle", "ltNoRendered", "lotToiawaseUrl", "yotoMei"];

/// Python の float(v)（読めなければ None）
fn to_float(v: Option<&Tree>) -> Option<f64> {
    match v? {
        Tree::Num(n) => n.as_f64(),
        Tree::Bool(b) => Some(f64::from(u8::from(*b))),
        Tree::Str(s) => crate::pyfmt::py_float(s).ok(),
        _ => None,
    }
}

fn filled(v: Option<&Tree>) -> R<bool> {
    match v {
        None | Some(Tree::Null) => Ok(false),
        Some(x) => Ok(!crate::pyfmt::strip(&py_str(x)?).is_empty()),
    }
}

pub fn is_stop_row(m: &Tree) -> R<bool> {
    let mut f = 0;
    for k in LOT_DATA_KEYS {
        if filled(m.get(k))? {
            f += 1;
        }
    }
    let numeric = DIMENSION_KEYS.iter().filter(|k| to_float(m.get(k)).is_some()).count();
    Ok(!(f >= 4 && numeric >= 1))
}

/// NFKC・大文字（Python の unicodedata.normalize("NFKC", s).upper()。前後の空白は残す）
pub fn nfkc_upper(s: &str) -> String {
    crate::access::py_nfkc_upper(s)
}

fn is_inspect_row(lot: &Tree, yoto: &Tree, keywords: &[String]) -> R<bool> {
    let s = |v: &Tree| -> R<String> {
        if truthy(v) {
            py_str(v)
        } else {
            Ok(String::new())
        }
    };
    let text = format!("{} {}", nfkc_upper(&s(lot)?), nfkc_upper(&s(yoto)?));
    Ok(keywords.iter().any(|k| !k.is_empty() && text.contains(&nfkc_upper(k))))
}

/// Python の \d（Unicode の 10 進数字）の並びの長さと値
fn digits_at(cs: &[char], i: usize) -> (usize, u64) {
    let mut n = 0;
    let mut v: u64 = 0;
    while let Some(d) = cs.get(i + n).and_then(|c| crate::pyfmt::digit(*c)) {
        v = v.saturating_mul(10).saturating_add(d as u64);
        n += 1;
    }
    (n, v)
}

/// ^\d+(\.\d+)?\s*(分|h|H|時間)?$ （停止の長さ）
fn is_duration(s: &str) -> bool {
    let cs: Vec<char> = s.chars().collect();
    let (n, _) = digits_at(&cs, 0);
    if n == 0 {
        return false;
    }
    let mut i = n;
    if cs.get(i) == Some(&'.') {
        let (m, _) = digits_at(&cs, i + 1);
        if m > 0 {
            i += 1 + m;
        }
    }
    while cs.get(i).is_some_and(|c| crate::pyfmt::is_space(*c)) {
        i += 1;
    }
    let rest: String = cs[i..].iter().collect();
    // $ は末尾か、末尾の改行の前（字は strip した後なので末尾の改行は無い）
    matches!(rest.as_str(), "" | "分" | "h" | "H" | "時間")
}

/// 停止の文（答えの項目の順につなぐ。長さは最後）
fn stop_text(m: &Tree) -> R<String> {
    let (mut name, mut extra) = (String::new(), vec![]);
    let Tree::Obj(items) = m else { return py("行が表でない") };
    for (k, v) in items {
        if NON_TEXT_KEYS.contains(&k.as_str()) || k == "kanryoYotei" {
            continue;
        }
        if matches!(v, Tree::Null | Tree::Bool(_) | Tree::Obj(_) | Tree::Arr(_)) {
            continue;
        }
        let v = fix_str(&py_str(v)?)?;
        if v.is_empty() {
            continue;
        }
        if is_duration(&v) {
            extra.push(v);
        } else {
            name.push_str(&v);
        }
    }
    let mut parts = vec![name];
    parts.extend(extra);
    let t = crate::pyfmt::strip(&parts.join(" ")).to_string();
    Ok(if t.is_empty() { "設備停止".into() } else { t })
}

// ------------------------------------------------------------------ 時刻
/// 現場の時刻（JST）の日時（年・月・日・時・分・秒・マイクロ秒）
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct Jst(pub chrono::NaiveDateTime);

impl Jst {
    fn iso(&self) -> String {
        format!("{}+09:00", self.0.format("%Y-%m-%dT%H:%M:%S"))
    }
}

/// 字の Python の int()（10 進）の符号と数字（Unicode の数字・あいだの _）。読めなければ None
pub fn py_int_digits(s: &str) -> Option<(bool, String)> {
    let t = crate::pyfmt::strip(s);
    let (neg, rest) = match t.chars().next() {
        Some('-') => (true, &t[1..]),
        Some('+') => (false, &t[1..]),
        _ => (false, t),
    };
    let cs: Vec<char> = rest.chars().collect();
    let mut out = String::new();
    let mut prev = false;
    for (i, c) in cs.iter().enumerate() {
        if let Some(d) = crate::pyfmt::digit(*c) {
            out.push(char::from_digit(d, 10).unwrap());
            prev = true;
        } else if *c == '_' && prev && cs.get(i + 1).and_then(|n| crate::pyfmt::digit(*n)).is_some() {
            prev = false;
        } else {
            return None;
        }
    }
    (!out.is_empty()).then_some((neg, out))
}

/// int(ts) / 1000 が float に入らない（Python は OverflowError）
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Overflow;

/// int(ts) / 1000（Python の int の真の割り算。正しく丸めた値）。
/// Ok(None) は int() が TypeError・ValueError（読めない）、Err は OverflowError（Python は source_info で落ちる）
pub fn ms_to_seconds(ts: &Tree) -> Result<Option<f64>, Overflow> {
    let (neg, digits) = match ts {
        Tree::Null | Tree::Arr(_) | Tree::Obj(_) => return Ok(None),
        Tree::Bool(b) => (false, if *b { "1".to_string() } else { "0".to_string() }),
        Tree::Num(n) => {
            if let Some(i) = n.as_i64() {
                (i < 0, i.unsigned_abs().to_string())
            } else if let Some(u) = n.as_u64() {
                (false, u.to_string())
            } else {
                let f = n.as_f64().unwrap_or(f64::NAN);
                if !f.is_finite() {
                    return Err(Overflow); // int(inf) は OverflowError（NaN は ValueError だが JSON から NaN は来ない＝読む前に任せる）
                }
                let t = f.trunc();
                (t < 0.0, format!("{:.0}", t.abs()))
            }
        }
        Tree::Str(s) => match py_int_digits(s) {
            None => return Ok(None),
            Some((neg, d)) => {
                if d.trim_start_matches('0').len() > 4300 {
                    return Ok(None); // int() の桁の上限（ValueError）
                }
                (neg, d)
            }
        },
    };
    let v: f64 = format!("{digits}e-3").parse().unwrap_or(f64::INFINITY);
    if v.is_infinite() {
        return Err(Overflow);
    }
    Ok(Some(if neg { -v } else { v }))
}

/// Windows の CPython で datetime.fromtimestamp(t, tz=JST) の答えが確かでない時刻か（版 3.96.0。Windows の CI で見つけた）。
/// tz を渡すと CPython は _PyTime_gmtime（Windows は UCRT の gmtime_s）で UTC にし、gmtime_s が断れば OSError（Python は None にする）。
/// gmtime_s の受ける範囲は CPython のソースでは決まらない（CI で −1 秒を受けた。前の版はここを 0 から〈3000 年の後まで〉と推して None を
/// 答え、Python の「1970/01/01 08:59:59」と割れた）。Linux の答えが時刻になる値のうち、1970 年より前と 3000 年から後は窓が答えず Python に任せる。
/// 両方の OS で None になる値（1 年より前・9999 年より後）は窓が答える
fn windows_unsure(t: f64) -> bool {
    cfg!(windows) && !(0.0..32_535_216_000.0).contains(&t)
}

/// datetime.fromtimestamp(t, tz=JST)（Linux の gmtime の範囲）。範囲の外（OverflowError・ValueError・OSError）は None。
/// Windows で答えの確かでない値は呼ぶ前に windows_unsure で除く
fn from_timestamp(t: f64) -> Option<Jst> {
    // _PyTime_DoubleToDenominator（マイクロ秒は偶数への丸め）
    let ip = t.trunc();
    let mut fp = ((t - ip) * 1e6).round_ties_even();
    let mut sec = ip;
    if fp >= 1e6 {
        fp -= 1e6;
        sec += 1.0;
    } else if fp < 0.0 {
        fp += 1e6;
        sec -= 1.0;
    }
    if !(-1e15..=1e15).contains(&sec) {
        return None;
    }
    let sec = sec as i64;
    let utc = chrono::DateTime::from_timestamp(sec, (fp as u32) * 1000)?.naive_utc();
    use chrono::Datelike;
    if utc.year() < 1 || utc.year() > 9999 {
        return None;
    }
    let jst = utc.checked_add_signed(chrono::TimeDelta::hours(9))?;
    (jst.year() <= 9999).then_some(Jst(jst))
}

/// 現場の時刻の今の年（datetime.now(JST).year）
fn now_year() -> i32 {
    use chrono::Datelike;
    (chrono::Utc::now().naive_utc() + chrono::TimeDelta::hours(9)).year()
}

/// ^\s*(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*$ → (月, 日, 時, 分)
fn date_time(s: &str) -> Option<(u64, u64, u64, u64)> {
    let cs: Vec<char> = s.chars().collect();
    let sp = |mut i: usize| {
        while cs.get(i).is_some_and(|c| crate::pyfmt::is_space(*c)) {
            i += 1;
        }
        i
    };
    let mut i = sp(0);
    let (n, mo) = digits_at(&cs, i);
    if !(1..=2).contains(&n) || cs.get(i + n) != Some(&'/') {
        return None;
    }
    i += n + 1;
    let (n, d) = digits_at(&cs, i);
    if !(1..=2).contains(&n) {
        return None;
    }
    i += n;
    let j = sp(i);
    if j == i {
        return None;
    }
    let (h, mi, end) = time_at(&cs, j)?;
    (sp(end) == cs.len()).then_some((mo, d, h, mi))
}

fn time_at(cs: &[char], i: usize) -> Option<(u64, u64, usize)> {
    let (n, h) = digits_at(cs, i);
    if !(1..=2).contains(&n) || cs.get(i + n) != Some(&':') {
        return None;
    }
    let (m, mi) = digits_at(cs, i + n + 1);
    if m != 2 {
        return None;
    }
    Some((h, mi, i + n + 1 + 2))
}

/// ^\s*(\d{1,2}):(\d{2})\s*$ → (時, 分)
fn time_only(s: &str) -> Option<(u64, u64)> {
    let cs: Vec<char> = s.chars().collect();
    let sp = |mut i: usize| {
        while cs.get(i).is_some_and(|c| crate::pyfmt::is_space(*c)) {
            i += 1;
        }
        i
    };
    let (h, m, end) = time_at(&cs, sp(0))?;
    (sp(end) == cs.len()).then_some((h, m))
}

fn make(year: i32, mo: u64, d: u64, h: u64, mi: u64) -> Option<Jst> {
    if !(1..=9999).contains(&year) || mo > 12 || d > 31 || h > 23 || mi > 59 {
        return None;
    }
    let date = chrono::NaiveDate::from_ymd_opt(year, mo as u32, d as u32)?;
    Some(Jst(date.and_hms_opt(h as u32, mi as u32, 0)?))
}

// ------------------------------------------------------------------ 整える（normalize）
/// lot_count の鍵（Python の dict の鍵の等しさ: 1 == 1.0 == True）
#[derive(Clone, Debug)]
enum Key {
    S(String),
    I(i128),
    F(f64),
}

impl PartialEq for Key {
    fn eq(&self, o: &Key) -> bool {
        match (self, o) {
            (Key::S(a), Key::S(b)) => a == b,
            (Key::I(a), Key::I(b)) => a == b,
            (Key::F(a), Key::F(b)) => a == b,
            (Key::I(a), Key::F(b)) | (Key::F(b), Key::I(a)) => b.fract() == 0.0 && b.abs() < 1e30 && *a == *b as i128,
            _ => false,
        }
    }
}

fn key_of(v: &Tree) -> R<Key> {
    Ok(match v {
        Tree::Str(s) => Key::S(s.clone()),
        Tree::Bool(b) => Key::I(i128::from(*b)),
        Tree::Num(n) => match (n.as_i64(), n.as_u64()) {
            (Some(i), _) => Key::I(i128::from(i)),
            (_, Some(u)) => Key::I(i128::from(u)),
            _ => Key::F(n.as_f64().unwrap_or(0.0)),
        },
        Tree::Null => Key::S("\u{0}None".into()),
        _ => return py("ロット番号が並び・表（dict の鍵にできない）"),
    })
}

/// CM3 の答え → 画面の形（Python の normalize）。答えは serde の値（鍵の順は問わない所）
pub fn normalize(raw: &Tree, own: &str, keywords: &[String]) -> R<Value> {
    let Tree::Obj(_) = raw else { return Err(Fail::Cm3("CM3応答の形式が不正です".into())) };
    let status = raw.get("status").cloned().unwrap_or(Tree::Null);
    if status != Tree::Str("SUCCESS".into()) {
        return Err(Fail::Cm3(format!("CM3応答 status={}", py_str(&status)?)));
    }
    let entity = match raw.get("entity") {
        Some(e) if truthy(e) => e.clone(),
        _ => Tree::Obj(vec![]),
    };
    if !matches!(entity, Tree::Obj(_)) {
        return py("entity が表でない（Python は .get で落ちる）");
    }
    if entity.get("error").is_some_and(truthy) {
        let m = fix_text(entity.get("errorMessage").unwrap_or(&Tree::Null))?;
        let m = if truthy(&m) { py_str(&m)? } else { "詳細不明".into() };
        return Err(Fail::Cm3(format!("CM3エラー: {m}")));
    }
    let ts = entity.get("updateTs").cloned().unwrap_or(Tree::Null);
    let update_dt = match ms_to_seconds(&ts) {
        Ok(Some(t)) => {
            let d = from_timestamp(t);
            if d.is_some() && windows_unsure(t) {
                return py("Windows の gmtime_s が受けるか確かでない更新時刻（1970 年より前・3000 年から後）");
            }
            d
        }
        _ => None,
    };
    use chrono::Datelike;
    if update_dt.is_some_and(|d| d.0.year() < 1000) {
        return py("1000 年より前の更新時刻（strftime の %Y の桁が OS で違う）");
    }
    let base_year = update_dt.map(|d| d.0.year()).unwrap_or_else(now_year);
    let (mut cur_month, mut cur_day) = (update_dt.map(|d| d.0.month() as u64), update_dt.map(|d| d.0.day() as u64));
    let (mut prev_dt, mut prev_end): (Option<Jst>, Option<Jst>) = (None, None);
    let rows: Vec<Tree> = match entity.get("meisaiList") {
        Some(x) if !truthy(x) => vec![],
        None => vec![],
        Some(Tree::Arr(a)) => a.clone(),
        Some(_) => return py("meisaiList が並びでない"),
    };
    let mut lot_count: Vec<(Key, i64)> = vec![];
    let mut items: Vec<Map<String, Value>> = vec![];
    let mut lot_keys: Vec<Option<Key>> = vec![];
    for (idx, m) in rows.iter().enumerate() {
        if !matches!(m, Tree::Obj(_)) {
            return py("meisaiList の行が表でない");
        }
        let rk = or_empty(m.get("kanryoYotei"));
        let Tree::Str(rk) = fix_text(&rk)? else { return py("完了予定が字でない（正規表現が落ちる）") };
        let md = date_time(&rk);
        let mt = if md.is_some() { None } else { time_only(&rk) };
        let (hh, mm) = match (md, mt) {
            (Some((mo, d, h, mi)), _) => {
                cur_month = Some(mo);
                cur_day = Some(d);
                (Some(h), Some(mi))
            }
            (_, Some((h, mi))) => (Some(h), Some(mi)),
            _ => (None, None),
        };
        let mut kanryo: Option<Jst> = None;
        if let (Some(h), Some(mi), Some(mo)) = (hh, mm, cur_month) {
            let mut year = base_year;
            if let Some(u) = update_dt {
                if (mo as i64) < u.0.month() as i64 - 6 {
                    year += 1;
                }
            }
            if let Some(mut k) = make(year, mo, cur_day.unwrap_or(0), h, mi) {
                if prev_dt.is_some_and(|p| k < p) && md.is_none() {
                    let Some(n) = k.0.checked_add_signed(chrono::TimeDelta::days(1)).filter(|n| n.year() <= 9999) else {
                        return py("日付の繰り上がりが 9999 年を越える（Python は OverflowError）");
                    };
                    k = Jst(n);
                    cur_month = Some(k.0.month() as u64);
                    cur_day = Some(k.0.day() as u64);
                }
                prev_dt = Some(k);
                kanryo = Some(k);
            }
        }
        let mut item = Map::new();
        item.insert("seq".into(), json!(idx + 1));
        item.insert("setsubi".into(), json!(own));
        item.insert("kanryoYoteiRaw".into(), json!(rk));
        item.insert("kanryoYotei".into(), json!(kanryo.map(|k| k.0.format("%m/%d %H:%M").to_string()).unwrap_or_else(|| rk.clone())));
        item.insert("kanryoYoteiIso".into(), kanryo.map(|k| json!(k.iso())).unwrap_or(Value::Null));
        item.insert("startYotei".into(), json!(prev_end.map(|k| k.0.format("%m/%d %H:%M").to_string()).unwrap_or_default()));
        item.insert("startYoteiIso".into(), prev_end.map(|k| json!(k.iso())).unwrap_or(Value::Null));
        item.insert("teisiStyle".into(), m.get("teisiStyle").map(Tree::to_value).unwrap_or(Value::Null));
        item.insert("rowStyle".into(), m.get("rowStyle").map(Tree::to_value).unwrap_or(Value::Null));
        item.insert("passNo".into(), Value::Null);
        item.insert("passTotal".into(), Value::Null);
        if kanryo.is_some() {
            prev_end = kanryo;
        }
        if is_stop_row(m)? {
            for (k, v) in [
                ("rowKind", json!("stop")),
                ("isStop", json!(true)),
                ("stopText", json!(stop_text(m)?)),
                ("lotNo", json!("")),
                ("zaishitsu", json!("")),
                ("inItaAtsu", json!("")),
                ("outItaAtsu", json!("")),
                ("reductionRate", Value::Null),
                ("reienHaba", json!("")),
                ("seihinItaAtsu", json!("")),
                ("seihinItaHaba", json!("")),
                ("keijo", json!("")),
                ("yotoMei", json!("")),
                ("jiKotei", json!("")),
                ("selfNext", json!(false)),
            ] {
                item.insert(k.into(), v);
            }
            lot_keys.push(None);
        } else {
            let field = |k: &str| fix_text(&or_empty(m.get(k)));
            let lot = field("lotNo")?;
            let yoto_raw = match m.get("yotoMeiFull") {
                Some(x) if truthy(x) => x.clone(),
                _ => or_empty(m.get("yotoMei")),
            };
            let yoto = fix_text(&yoto_raw)?;
            let ji = field("jiKotei")?;
            let inspect = is_inspect_row(&lot, &yoto, keywords)?;
            let key = if inspect { None } else { Some(key_of(&lot)?) };
            if let Some(key) = &key {
                let n = match lot_count.iter_mut().find(|(k, _)| k == key) {
                    Some(x) => {
                        x.1 += 1;
                        x.1
                    }
                    None => {
                        lot_count.push((key.clone(), 1));
                        1
                    }
                };
                item.insert("passNo".into(), json!(n));
            }
            let red = reduction(m.get("inItaAtsu"), m.get("outItaAtsu"))?;
            item.insert("rowKind".into(), json!(if inspect { "inspect" } else { "lot" }));
            item.insert("isStop".into(), json!(false));
            item.insert("stopText".into(), json!(""));
            item.insert("lotNo".into(), lot.to_value());
            for k in ["zaishitsu", "inItaAtsu", "outItaAtsu"] {
                item.insert(k.into(), field(k)?.to_value());
            }
            item.insert("reductionRate".into(), red.map(|x| json!(x)).unwrap_or(Value::Null));
            for k in ["reienHaba", "seihinItaAtsu", "seihinItaHaba", "keijo"] {
                item.insert(k.into(), field(k)?.to_value());
            }
            item.insert("yotoMei".into(), yoto.to_value());
            item.insert("selfNext".into(), json!(ji == Tree::Str(own.into())));
            item.insert("jiKotei".into(), ji.to_value());
            lot_keys.push(key);
        }
        items.push(item);
    }
    for (it, k) in items.iter_mut().zip(&lot_keys) {
        if let Some(k) = k {
            let n = lot_count.iter().find(|(x, _)| x == k).map(|x| x.1).unwrap_or(1);
            it.insert("passTotal".into(), json!(n));
        }
    }
    let count = |kind: &str| items.iter().filter(|i| i["rowKind"] == kind).count();
    let setsubi = match entity.get("setsubiName") {
        Some(x) if truthy(x) => x.to_value(),
        _ => json!(own),
    };
    Ok(json!({
        "setsubi": setsubi, "termKbn": entity.get("termKbn").map(Tree::to_value).unwrap_or(Value::Null),
        "updateTs": ts.to_value(),
        "updateTime": update_dt.map(|d| d.0.format("%Y/%m/%d %H:%M:%S").to_string()),
        "count": count("lot"), "inspectCount": count("inspect"), "stopCount": count("stop"),
        "items": items.into_iter().map(Value::Object).collect::<Vec<_>>(),
    }))
}

fn reduction(a: Option<&Tree>, b: Option<&Tree>) -> R<Option<f64>> {
    let (Some(a), b) = (to_float(a), to_float(b)) else { return Ok(None) };
    if a == 0.0 {
        return Ok(None);
    }
    let Some(b) = b else { return Ok(None) };
    let r = crate::aggregate::py_round((a - b) / a * 100.0, 1);
    if !r.is_finite() {
        return py("圧下率が NaN・無限（JSON の NaN は窓が書けない）");
    }
    Ok(Some(r))
}

// ------------------------------------------------------------------ 一覧の表の形
pub const COLUMNS: [(&str, &str); 21] = [
    ("No", "seq"),
    ("完了予定", "kanryoYotei"),
    ("区分", "rowKind"),
    ("ロットNo", "lotNo"),
    ("パス", "passNo"),
    ("総パス", "passTotal"),
    ("材質", "zaishitsu"),
    ("入側板厚", "inItaAtsu"),
    ("出側板厚", "outItaAtsu"),
    ("圧下率", "reductionRate"),
    ("冷延幅", "reienHaba"),
    ("製品板厚", "seihinItaAtsu"),
    ("製品幅", "seihinItaHaba"),
    ("形状", "keijo"),
    ("用途名", "yotoMei"),
    ("次工程", "jiKotei"),
    ("停止内容", "stopText"),
    ("設備", "setsubi"),
    ("開始予定", "startYotei"),
    ("完了予定日時", "kanryoYoteiIso"),
    ("開始予定日時", "startYoteiIso"),
];

pub fn kind_label(k: &str) -> &'static str {
    match k {
        "lot" => "製造",
        "inspect" => "点検",
        "stop" => "設備停止",
        _ => "",
    }
}

/// SQLite に置く値（Python の sqlite3 が置く形: 字・整数・小数・NULL。真偽は整数）
#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
}

impl Cell {
    fn of(v: &Value) -> R<Cell> {
        Ok(match v {
            Value::Null => Cell::Null,
            Value::Bool(b) => Cell::Int(i64::from(*b)),
            Value::String(s) => Cell::Text(s.clone()),
            Value::Number(n) => match (n.as_i64(), n.as_f64()) {
                (Some(i), _) => Cell::Int(i),
                (None, Some(_)) if n.is_u64() => return py("i64 に入らない整数（sqlite3 は OverflowError）"),
                (None, Some(f)) => Cell::Real(f),
                _ => Cell::Null,
            },
            _ => return py("表に置けない値（並び・表。sqlite3 が断る）"),
        })
    }

    pub fn to_sql(&self) -> rusqlite::types::Value {
        use rusqlite::types::Value as V;
        match self {
            Cell::Null => V::Null,
            Cell::Int(i) => V::Integer(*i),
            Cell::Real(f) => V::Real(*f),
            Cell::Text(s) => V::Text(s.clone()),
        }
    }

    /// 世代の指紋に使う字（窓の中だけで閉じる）
    pub fn sig_text(&self) -> String {
        match self {
            Cell::Null => "N".into(),
            Cell::Int(i) => format!("I{i}"),
            Cell::Real(f) => format!("R{}", crate::pyfmt::float_repr(*f)),
            Cell::Text(s) => format!("T{}", serde_json::to_string(s).unwrap_or_default()),
        }
    }
}

/// "2026-10-19T14:05:00+09:00" → "2026-10-19 14:05"
fn iso_local(v: &Value) -> Value {
    match v {
        Value::String(s) if !s.is_empty() => json!(s.chars().take(16).collect::<String>().replace('T', " ")),
        _ => Value::Null,
    }
}

/// 整えた答え → 表の行（列の並びは COLUMNS。空の字は NULL）
pub fn table_rows(data: &Value) -> R<Vec<Vec<Cell>>> {
    let mut out = vec![];
    for it in data["items"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
        let mut row = vec![];
        for (_, key) in COLUMNS {
            let v = &it[key];
            let v = match key {
                "rowKind" => json!(kind_label(v.as_str().unwrap_or(""))),
                "kanryoYoteiIso" | "startYoteiIso" => iso_local(v),
                _ => v.clone(),
            };
            row.push(if v == json!("") { Cell::Null } else { Cell::of(&v)? });
        }
        out.push(row);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codec_names_and_charset_like_python() {
        assert_eq!(codec_of("UTF-8"), Some("utf-8"));
        assert_eq!(codec_of("utf_é8"), Some("utf-8"));
        assert_eq!(codec_of("Windows-31J"), Some("cp932"));
        assert_eq!(codec_of("SHIFT-JIS"), Some("shift_jis"));
        assert_eq!(codec_of("x-sjis"), None);
        assert_eq!(codec_of("cp-932"), None);
        assert_eq!(codec_of("Ütf8"), None);
        assert_eq!(charset_of("application/json; Charset=Shift_JIS"), Some("Shift_JIS".into()));
        assert_eq!(charset_of("text/html; charset=\"UTF-8\""), None, "引用符つきは読まない");
        assert_eq!(charset_of("a; charset=;charset=utf-8"), Some("utf-8".into()));
    }

    #[test]
    fn decodes_cp932_and_shift_jis_differences() {
        assert_eq!(decode(&[0x81, 0x60], "cp932"), Some(Some("～".into())));
        assert_eq!(decode(&[0x81, 0x60], "shift_jis"), Some(Some("〜".into())));
        assert_eq!(decode(&[0xA0, 0xFD], "cp932"), Some(Some("\u{F8F0}\u{F8F1}".into())));
        assert_eq!(decode(&[0x82], "cp932"), Some(None));
        assert_eq!(decode(&[0x82], "euc_jp"), None);
    }

    #[test]
    fn unescape_and_fix_text_like_python() {
        for (raw, want) in [
            ("&amp;x", "&x"),
            ("&ampx", "&x"),
            ("&notit;", "¬it;"),
            ("&#128;", "€"),
            ("&#1;", ""),
            ("&#xD800;", "\u{FFFD}"),
            ("&#x3000", "\u{3000}"),
            ("&#;", "&#;"),
            ("&zz;", "&zz;"),
        ] {
            assert_eq!(unescape(raw).unwrap(), want, "{raw}");
        }
        assert_eq!(fix_str("缶&#12288;材").unwrap(), "缶 材");
        assert_eq!(fix_str("<br>a<b>").unwrap(), "a");
        let moji: String = "缶材".as_bytes().iter().map(|&b| b as char).collect();
        assert_eq!(fix_str(&moji).unwrap(), "缶材");
        assert_eq!(fix_str("\u{1c} x \u{1f}").unwrap(), "x", "Python の strip は \\x1c〜\\x1f も除く");
    }

    #[test]
    fn durations_and_times() {
        assert!(is_duration("7分") && is_duration("1.5 時間") && is_duration("３０分") && !is_duration("7分x") && !is_duration("1.h"));
        assert_eq!(date_time("10/19 14:05"), Some((10, 19, 14, 5)));
        assert_eq!(date_time("１０/１９ １４:０５"), Some((10, 19, 14, 5)));
        assert_eq!(date_time("10/19 14:5"), None);
        assert_eq!(time_only("14:27"), Some((14, 27)));
    }
}
