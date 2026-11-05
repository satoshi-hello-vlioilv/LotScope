//! 計算列の式（版 3.59.0）。画面の式（program/app/static/js/list-formula.js）と同じ書き方・同じ答えを、Rust で計算する。
//!
//! Python の式（program/app/services/formula.py）を移した物。答えの基準は画面（JavaScript）で、3 つの実装は同じ事例表
//! （program/tests/fixtures/formula_cases.json。画面の答えを焼き付けた物）と突き合わせる（tests/formula_cases.rs・Python の
//! tests/test_formula_parity.py）。決まり（JavaScript の動きに合わせる）:
//! - 字は UTF-16 の単位の並びで持つ（JavaScript と同じ。切り出しで生まれる片割れのサロゲートもそのまま持つ）。長さ・位置・大小は単位で数える
//! - 数は倍精度の実数。字にするときは JavaScript の String(数) と同じ書き方（js_num_text）
//! - 空白（trim・字の区切り）は JavaScript の空白（全角の空白 U+3000 なども）
//! - 正規表現（extract・match・regreplace・regcount）は JavaScript の書き方を fancy-regex の書き方へ読み替える（\d・\w・\b は英数字だけ、
//!   \s は JavaScript の空白、. は改行以外、(?<名前>…)・\k<名前>・後方参照・先読み）。空に合ったら 1 字進める（JavaScript と同じ）
//! - 壊れた式は読むとき（compile）に断り、行ごとの失敗（正規表現が読めない・答えが長すぎる等）はその行だけ空（Null）にする
//!
//! 合わない所（分かっていて残す。Python と同じ）: round の桁に小数を書いたとき（round(x, 2.5)）の最後の桁・U+10000 以上の字（絵文字など）を
//! 正規表現で扱うとき（JavaScript は 2 つの単位、Rust は 1 字と数える）・正規表現に片割れのサロゲートを渡したとき（U+FFFD に置き換える）。
//! 正規表現の仕組み（fancy-regex）が JavaScript と違うので残る所（利用者が書くのはまれ。画面の答えは事例表の作り方の説明の通り node で確かめた）:
//! - 繰り返しの中の組は、JavaScript では回るたびに空に戻る（^(?:(a)|b)+\1$ で「ab」に当たる）。Rust は前の回の値を持ち続ける
//! - 長さの決まらない後読み（(?<=a+)b・(?<!a*)b）は読めない（JavaScript は読む）
//! - 空に合った回で繰り返しを止める JavaScript の決まり（(|a)+ で「aa」）を持たない。(?:^)+ のような位置の組の繰り返しは断る
//! - 捕まえる組を含む先読みを 0 回から繰り返すと（(?=(a))*）、組ごと外すので、その組を参照する式（(?=(a))*\1）は読めない

use fancy_regex::{Captures, Regex};
use serde_json::Value;
use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};

/// 式の長さ・正規表現の長さ・正規表現に渡す字の長さ・答えの字の長さ・rept の答えの長さ（UTF-16 の単位。画面と同じ）
pub const MAX_LEN: usize = 2000;
const RE_MAX: usize = 200;
const RE_TEXT_MAX: usize = 2000;
const STR_MAX: usize = 100_000;
const REPT_MAX: usize = 10_000;
const DOT_REPEAT_MAX: usize = 2;
/// 入れ子の深さの上限（かっこを何百重にもした式・変換表が自分を引く式で止まらない）
const MAX_DEPTH: u32 = 200;
/// 計算列の数の上限（Python の MAX_CALC と同じ）
pub const MAX_CALC: usize = 40;
/// 設備ごとの式を持てる設備の数（Python の MAX_CALC_EQUIPS）
pub const MAX_CALC_EQUIPS: usize = 200;

/// JavaScript の空白（WhiteSpace と LineTerminator。trim・\s・parseFloat の頭の空白）
const JS_WS: [u16; 25] = [
    0x9, 0xa, 0xb, 0xc, 0xd, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
    0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

fn is_ws(c: u16) -> bool {
    JS_WS.contains(&c)
}

// ================================================================ 値

/// 式の値（JavaScript の null・数・字）。字は UTF-16 の単位の並び
#[derive(Clone, Debug, PartialEq)]
pub enum V {
    Null,
    Num(f64),
    Str(Arc<[u16]>),
}

impl V {
    pub fn text(s: &str) -> V {
        V::Str(s.encode_utf16().collect::<Vec<_>>().into())
    }
    fn units(s: Vec<u16>) -> V {
        V::Str(s.into())
    }
    fn empty() -> V {
        V::Str(Arc::from(&[][..]))
    }
    fn bool(b: bool) -> V {
        V::Num(if b { 1.0 } else { 0.0 })
    }
}

/// 読めない式の理由（UTF-16。画面と同じ字。片割れのサロゲートを含みうる）
#[derive(Clone, Debug, PartialEq)]
pub struct FormulaError(pub Vec<u16>);

impl FormulaError {
    fn new(s: &str) -> FormulaError {
        FormulaError(s.encode_utf16().collect())
    }
    /// 理由の字（片割れのサロゲートは U+FFFD）
    pub fn message(&self) -> String {
        String::from_utf16_lossy(&self.0)
    }
}

type R<T> = Result<T, FormulaError>;

fn too_long() -> FormulaError {
    FormulaError::new(&format!("答えが長すぎます（{STR_MAX}文字まで）"))
}

fn u16s(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn lossy(s: &[u16]) -> String {
    String::from_utf16_lossy(s)
}

/// JavaScript の String(数)
pub fn js_num_text(f: f64) -> String {
    if f.is_nan() {
        return "NaN".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if f == 0.0 {
        return "0".into();
    }
    let sign = if f < 0.0 { "-" } else { "" };
    // いちばん短く元の数へ戻る桁（Rust の {:e} は最短の桁を出す）: d.ddde±x
    let e = format!("{:e}", f.abs());
    let (mant, exp) = e.split_once('e').unwrap_or((&e, "0"));
    let exp: i32 = exp.parse().unwrap_or(0);
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let digits = digits.trim_end_matches('0');
    let digits = if digits.is_empty() { "0" } else { digits };
    let (k, n) = (digits.len() as i32, exp + 1);
    let out = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let rest = if k > 1 { format!(".{}", &digits[1..]) } else { String::new() };
        format!("{}{rest}e{}{}", &digits[..1], if e >= 0 { "+" } else { "-" }, e.abs())
    };
    format!("{sign}{out}")
}

/// 値の字（JavaScript の String。null は空）
pub fn text_of(v: &V) -> Cow<'_, [u16]> {
    match v {
        V::Null => Cow::Borrowed(&[]),
        V::Num(f) => Cow::Owned(u16s(&js_num_text(*f))),
        V::Str(s) => Cow::Borrowed(s),
    }
}

/// 頭から読める「数の字」の長さ（parseFloat と同じ形: [+-]?(Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)）。読めなければ 0
fn float_prefix(s: &[u16]) -> (usize, bool) {
    let dig = |i: usize| i < s.len() && (b'0' as u16..=b'9' as u16).contains(&s[i]);
    let mut i = 0;
    if i < s.len() && (s[i] == b'+' as u16 || s[i] == b'-' as u16) {
        i += 1;
    }
    let inf: Vec<u16> = u16s("Infinity");
    if s[i..].starts_with(&inf) {
        return (i + inf.len(), true);
    }
    let start = i;
    while dig(i) {
        i += 1;
    }
    let int_digits = i > start;
    if int_digits {
        if i < s.len() && s[i] == b'.' as u16 {
            i += 1;
            while dig(i) {
                i += 1;
            }
        }
    } else if i < s.len() && s[i] == b'.' as u16 && dig(i + 1) {
        i += 1;
        while dig(i) {
            i += 1;
        }
    } else {
        return (0, false);
    }
    if i < s.len() && (s[i] == b'e' as u16 || s[i] == b'E' as u16) {
        let mut j = i + 1;
        if j < s.len() && (s[j] == b'+' as u16 || s[j] == b'-' as u16) {
            j += 1;
        }
        if dig(j) {
            while dig(j) {
                j += 1;
            }
            i = j;
        }
    }
    (i, false)
}

fn ascii_f64(s: &[u16]) -> Option<f64> {
    let t: String = s.iter().map(|&u| u as u8 as char).collect();
    t.parse::<f64>().ok()
}

/// list-formula.js の numOf（parseFloat。, は除く・頭の数だけ読む・有限の数に読めなければ None）
pub fn num_of(v: &V) -> Option<f64> {
    match v {
        V::Null => None,
        V::Num(f) => Some(*f),
        V::Str(s) => {
            if s.is_empty() {
                return None;
            }
            let t: Vec<u16> = s.iter().copied().filter(|&u| u != b',' as u16).collect();
            let start = t.iter().position(|&u| !is_ws(u)).unwrap_or(t.len());
            let t = &t[start..];
            let (n, inf) = float_prefix(t);
            if n == 0 || inf {
                return None;
            }
            ascii_f64(&t[..n]).filter(|f| f.is_finite())
        }
    }
}

pub fn truthy(v: &V) -> bool {
    match num_of(v) {
        None => !text_of(v).is_empty(),
        Some(n) => n != 0.0,
    }
}

fn js_trim(s: &[u16]) -> &[u16] {
    let a = s.iter().position(|&u| !is_ws(u)).unwrap_or(s.len());
    let b = s.iter().rposition(|&u| !is_ws(u)).map(|i| i + 1).unwrap_or(a);
    &s[a..b.max(a)]
}

/// ^[-+]?(\d+\.?\d*|\.\d+)$ の数（表示ルールの緩い読み方。前後の空白・3 桁区切りを除く）
fn loose_num(v: &V) -> Option<f64> {
    let t: Vec<u16> = js_trim(&text_of(v)).iter().copied().filter(|&u| u != b',' as u16).collect();
    if t.is_empty() {
        return None;
    }
    let (n, inf) = float_prefix(&t);
    // 指数（e）と Infinity は緩い読み方に入れない
    if inf || n != t.len() || t.iter().any(|&u| u == b'e' as u16 || u == b'E' as u16) {
        return None;
    }
    ascii_f64(&t).filter(|f| f.is_finite())
}

/// 比べ方の「本当に数か」（元の字へ戻して同じときだけ数）
fn strict_num(v: &V) -> Option<f64> {
    if let V::Num(f) = v {
        return Some(*f);
    }
    let t = text_of(v);
    let s = js_trim(&t);
    if s.is_empty() {
        return None;
    }
    let (n, inf) = float_prefix(s);
    if inf || n != s.len() {
        return None;
    }
    let f = ascii_f64(s)?;
    (f.is_finite() && u16s(&js_num_text(f)) == s).then_some(f)
}

/// 表示ルールと同じ比べ方（-1/0/1）
pub fn js_cmp(a: &V, b: &V) -> i32 {
    match (loose_num(a), loose_num(b)) {
        (Some(x), Some(y)) => {
            if x < y {
                -1
            } else if x > y {
                1
            } else {
                0
            }
        }
        _ => order(&text_of(a), &text_of(b)),
    }
}

fn order(a: &[u16], b: &[u16]) -> i32 {
    match a.cmp(b) {
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Equal => 0,
        std::cmp::Ordering::Greater => 1,
    }
}

// ---------------------------------------------------------------- 字（UTF-16 の単位）
fn find(hay: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() {
        return (from <= hay.len()).then_some(from);
    }
    if needle.len() > hay.len() {
        return None;
    }
    (from..=hay.len() - needle.len()).find(|&i| hay[i..i + needle.len()] == *needle)
}

fn split<'a>(t: &'a [u16], sep: &[u16]) -> Vec<&'a [u16]> {
    let (mut out, mut at) = (Vec::new(), 0);
    while let Some(i) = find(t, sep, at) {
        out.push(&t[at..i]);
        at = i + sep.len();
    }
    out.push(&t[at..]);
    out
}

/// JavaScript の slice の位置（負は後ろから・小数は 0 の側へ切る・NaN は 0）
fn slice_at(v: f64, n: usize) -> usize {
    if v.is_nan() {
        return 0;
    }
    if v.is_infinite() {
        return if v > 0.0 { n } else { 0 };
    }
    let v = v.trunc();
    if v < 0.0 {
        (n as f64 + v).max(0.0) as usize
    } else {
        v.min(n as f64) as usize
    }
}

fn slice(s: &[u16], start: f64, end: Option<f64>) -> Vec<u16> {
    let n = s.len();
    let a = slice_at(start, n);
    let b = end.map(|e| slice_at(e, n)).unwrap_or(n);
    if a >= b {
        Vec::new()
    } else {
        s[a..b].to_vec()
    }
}

/// 字の正しい所（片割れのサロゲートを除く）にだけ f を当てる（toUpperCase・normalize は片割れをそのまま残す）
fn map_valid(s: &[u16], f: impl Fn(&str) -> String) -> Vec<u16> {
    let mut out = Vec::with_capacity(s.len());
    let mut run = String::new();
    for r in char::decode_utf16(s.iter().copied()) {
        match r {
            Ok(c) => run.push(c),
            Err(e) => {
                out.extend(f(&run).encode_utf16());
                run.clear();
                out.push(e.unpaired_surrogate());
            }
        }
    }
    out.extend(f(&run).encode_utf16());
    out
}

// ================================================================ 正規表現（JavaScript → fancy-regex）

/// 重すぎる正規表現か → 理由（重くなければ None）。画面（list-formula.js の regexRisk）と同じ決まり:
/// ① 繰り返しを含むかっこを、さらに繰り返す ② 「.」の繰り返しが 3 つ以上
pub fn regex_risk(src: &[u16]) -> Option<String> {
    let c = |i: usize| src.get(i).copied().unwrap_or(0);
    let quant_at = |i: usize| -> Option<usize> {
        let ch = c(i);
        if ch == b'*' as u16 || ch == b'+' as u16 {
            return Some(i + 1);
        }
        if ch != b'{' as u16 {
            return None;
        }
        let dig = |j: usize| (b'0' as u16..=b'9' as u16).contains(&c(j)) && j < src.len();
        let mut j = i + 1;
        if !dig(j) {
            return None;
        }
        while dig(j) {
            j += 1;
        }
        if c(j) == b',' as u16 && j < src.len() {
            j += 1;
            while dig(j) {
                j += 1;
            }
        }
        (c(j) == b'}' as u16 && j < src.len()).then_some(j + 1)
    };
    let (mut st, mut i, mut in_class, mut dots) = (vec![false], 0usize, false, 0usize);
    while i < src.len() {
        let ch = src[i];
        if ch == b'\\' as u16 {
            i += 2;
            continue;
        }
        if in_class {
            in_class = ch != b']' as u16;
            i += 1;
            continue;
        }
        if ch == b'[' as u16 {
            in_class = true;
            i += 1;
            continue;
        }
        if ch == b'(' as u16 {
            st.push(false);
            i += 1;
            continue;
        }
        if ch == b')' as u16 {
            let inner = if st.len() > 1 { st.pop().unwrap_or(false) } else { false };
            i += 1;
            let q = quant_at(i);
            if q.is_some() && inner {
                return Some("繰り返しを含むかっこを、さらに繰り返す正規表現は使えません（とても重くなるため）".into());
            }
            if q.is_some() || inner {
                *st.last_mut().unwrap() = true;
            }
            continue;
        }
        if let Some(q) = quant_at(i) {
            *st.last_mut().unwrap() = true;
            if i > 0 && src[i - 1] == b'.' as u16 && (i < 2 || src[i - 2] != b'\\' as u16) {
                dots += 1;
            }
            i = q;
            continue;
        }
        i += 1;
    }
    (dots > DOT_REPEAT_MAX).then(|| format!("「.*」「.+」は {DOT_REPEAT_MAX} つまでです（とても重くなるため）"))
}

const WORD: &str = "A-Za-z0-9_";

fn ws_class_body() -> String {
    JS_WS.iter().map(|&u| format!("\\x{{{u:X}}}")).collect()
}

/// JavaScript の正規表現を読み替えた物（組は番号だけで持ち、名前は名前 → 番号の対応で引く）
pub struct JsRe {
    pub re: Regex,
    names: Vec<(String, usize)>,
}

impl JsRe {
    fn group_of(&self, name: &str) -> Option<usize> {
        self.names.iter().find(|(n, _)| n == name).map(|(_, k)| *k)
    }
}

/// 捕まえる組の名前の並び（番号の順。名前の無い組は None）。[] の中・\ の後は見ない
fn group_names(cs: &[char]) -> Result<Vec<Option<String>>, String> {
    let (mut out, mut i, mut in_class) = (Vec::new(), 0, false);
    while i < cs.len() {
        match cs[i] {
            '\\' => i += 1,
            '[' if !in_class => in_class = true,
            ']' if in_class => in_class = false,
            '(' if !in_class => {
                if cs.get(i + 1) != Some(&'?') {
                    out.push(None);
                } else if cs.get(i + 2) == Some(&'<') && !matches!(cs.get(i + 3), Some('=') | Some('!')) {
                    let end = cs[i + 3..].iter().position(|c| *c == '>').map(|k| i + 3 + k).ok_or("Invalid capture group name")?;
                    let name: String = cs[i + 3..end].iter().collect();
                    let ok = name.chars().next().is_some_and(|c| c.is_alphabetic() || c == '_' || c == '$')
                        && name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$');
                    if !ok {
                        return Err("Invalid capture group name".into());
                    }
                    if out.contains(&Some(name.clone())) {
                        return Err("Duplicate capture group name".into());
                    }
                    out.push(Some(name));
                }
            }
            _ => {}
        }
        i += 1;
    }
    Ok(out)
}

/// JavaScript の 8 進の書き方（Annex B の LegacyOctalEscapeSequence）: cs[j] から読める数と、読んだ字の数
fn legacy_octal(cs: &[char], j: usize) -> (u32, usize) {
    let d = |k: usize| cs.get(k).and_then(|c| c.to_digit(8));
    let a = d(j).unwrap_or(0);
    match (d(j + 1), d(j + 2)) {
        (Some(b), Some(c)) if a <= 3 => (a * 64 + b * 8 + c, 3),
        (Some(b), _) => (a * 8 + b, 2),
        _ => (a, 1),
    }
}

/// 繰り返し（* + ? {n} {n,} {n,m}）が cs[i] から始まるなら、(終わりの次の位置, いちばん少ない回数)
fn quantifier_at(cs: &[char], i: usize) -> Option<(usize, u32)> {
    match cs.get(i)? {
        '*' | '?' => Some((i + 1, 0)),
        '+' => Some((i + 1, 1)),
        '{' => {
            let mut j = i + 1;
            while cs.get(j).is_some_and(char::is_ascii_digit) {
                j += 1;
            }
            if j == i + 1 {
                return None;
            }
            let min: u32 = cs[i + 1..j].iter().collect::<String>().parse().unwrap_or(u32::MAX);
            if cs.get(j) == Some(&',') {
                j += 1;
                while cs.get(j).is_some_and(char::is_ascii_digit) {
                    j += 1;
                }
            }
            (cs.get(j) == Some(&'}')).then_some((j + 1, min))
        }
        _ => None,
    }
}

fn hex_at(cs: &[char], i: usize, n: usize) -> Option<u32> {
    let s: String = cs.get(i..i + n)?.iter().collect();
    (s.len() == n && s.chars().all(|c| c.is_ascii_hexdigit())).then(|| u32::from_str_radix(&s, 16).unwrap_or(0))
}

fn code(v: u32) -> String {
    let v = if (0xd800..0xe000).contains(&v) { 0xfffd } else { v }; // 片割れのサロゲートは Rust の字にできない
    format!("\\x{{{v:X}}}")
}

/// [] の中の 1 つ（字か、\d のような字の組）
enum ClassAtom {
    Char(u32),
    Set(String),
}

/// [] の中の \ の後（cs[i] は \ の次の字）→ (1 つ, 読んだ字の数)
fn class_escape(cs: &[char], i: usize, ws: &str) -> (ClassAtom, usize) {
    let c = cs[i];
    let ch = |v: u32| ClassAtom::Char(v);
    match c {
        'd' => (ClassAtom::Set("0-9".into()), 1),
        'D' => (ClassAtom::Set("[^0-9]".into()), 1),
        'w' => (ClassAtom::Set(WORD.into()), 1),
        'W' => (ClassAtom::Set(format!("[^{WORD}]")), 1),
        's' => (ClassAtom::Set(ws.into()), 1),
        'S' => (ClassAtom::Set(format!("[^{ws}]")), 1),
        'b' => (ch(8), 1),
        'f' => (ch(12), 1),
        'n' => (ch(10), 1),
        'r' => (ch(13), 1),
        't' => (ch(9), 1),
        'v' => (ch(11), 1),
        // [] の中の \c は英字のほか数字・_ も制御文字（Annex B）。ほかは \ そのもの（c は次に読む）
        'c' => match cs.get(i + 1) {
            Some(x) if x.is_ascii_alphanumeric() || *x == '_' => (ch(*x as u32 % 32), 2),
            _ => (ch('\\' as u32), 0),
        },
        'x' => hex_at(cs, i + 1, 2).map(|v| (ch(v), 3)).unwrap_or((ch('x' as u32), 1)),
        'u' => hex_at(cs, i + 1, 4).map(|v| (ch(v), 5)).unwrap_or((ch('u' as u32), 1)),
        d if d.is_digit(8) => {
            let (v, k) = legacy_octal(cs, i);
            (ch(v), k)
        }
        other => (ch(other as u32), 1),
    }
}

/// [ の後（cs[i] は [ の次）から ] までを、JavaScript の決まり（範囲・\d の隣の - は字）で読む → (fancy-regex の [...], 次の位置)
fn translate_class(cs: &[char], mut i: usize, ws: &str) -> Result<(String, usize), String> {
    let neg = cs.get(i) == Some(&'^');
    if neg {
        i += 1;
    }
    let mut atoms: Vec<(ClassAtom, bool)> = Vec::new(); // (1 つ, 書いてある字の - か: 範囲の印にもなる)
    loop {
        let Some(&c) = cs.get(i) else { return Err("Unterminated character class".into()) };
        if c == ']' {
            i += 1;
            break;
        }
        if c == '\\' && i + 1 < cs.len() {
            let (a, k) = class_escape(cs, i + 1, ws);
            atoms.push((a, false));
            i += 1 + k;
        } else {
            atoms.push((ClassAtom::Char(c as u32), c == '-'));
            i += 1;
        }
    }
    let one = |a: &ClassAtom| match a {
        ClassAtom::Char(x) => code(*x),
        ClassAtom::Set(s) => s.clone(),
    };
    let mut out = String::from(if neg { "[^" } else { "[" });
    let mut k = 0;
    while k < atoms.len() {
        // A - B は範囲（B は - でもよい。順が逆なら断る）。どちらかが \d のような組なら、範囲にせず 3 つの字の和（Annex B）
        if k + 2 < atoms.len() && atoms[k + 1].1 {
            match (&atoms[k].0, &atoms[k + 2].0) {
                (ClassAtom::Char(x), ClassAtom::Char(y)) => {
                    if x > y {
                        return Err("Range out of order in character class".into());
                    }
                    out += &format!("{}-{}", code(*x), code(*y));
                }
                (a, b) => out += &format!("{}\\-{}", one(a), one(b)),
            }
            k += 3;
            continue;
        }
        out += &one(&atoms[k].0);
        k += 1;
    }
    out.push(']');
    Ok((out, i))
}

/// 直前の 1 つの種類（繰り返せるか・繰り返したらどうなるか）
#[derive(Clone, Copy, PartialEq)]
enum Last {
    Nothing,          // 頭・| ・( の直後（繰り返せない）
    Atom,             // 字・組・[] など
    Quantified,       // 繰り返しの後（もう一度は繰り返せない）
    Assertion,        // ^ $ \b \B（繰り返せない）
    Lookahead(usize), // 先読みの組（Annex B では繰り返せる。out の中の始まり）
    Lookbehind,       // 後読みの組（繰り返せない）
    EmptyGroup,       // (?:) のような空の組（繰り返しても同じ）
}

/// JavaScript の正規表現の書き方 → fancy-regex の書き方（\d・\w・\b は英数字だけ。組は番号だけ）。画面（JavaScript の RegExp・Annex B）
/// が断る書き方（(?i)・(?#…)・(?P<…>)・(?>…)・繰り返しの後の繰り返し・後読みの繰り返し・逆の範囲・同じ組の名前）は断る。読めなければ理由
fn translate(src: &[u16]) -> Result<JsRe, String> {
    let cs: Vec<char> = lossy(src).chars().collect();
    let n = cs.len();
    let names = group_names(&cs)?;
    let named: Vec<(String, usize)> = names.iter().enumerate().filter_map(|(k, x)| x.clone().map(|x| (x, k + 1))).collect();
    let ws = ws_class_body();
    let (wb, nwb) = (
        format!("(?:(?<=[{WORD}])(?![{WORD}])|(?<![{WORD}])(?=[{WORD}]))"),
        format!("(?:(?<=[{WORD}])(?=[{WORD}])|(?<![{WORD}])(?![{WORD}]))"),
    );
    let lit = |c: char| regex::escape(&c.to_string());
    // 組 k への後方参照: 組がもう閉じていれば「合っていれば同じ字・合っていなければ空」、まだ閉じていない（前・中）なら空（JavaScript と同じ）
    let backref = |k: usize, closed: &HashSet<usize>| if closed.contains(&k) { format!("(?:(?({k})\\{k}|))") } else { "(?:)".into() };
    let (mut out, mut i, mut opened) = (String::new(), 0usize, 0usize);
    let mut closed: HashSet<usize> = HashSet::new();
    let mut last = Last::Nothing;
    let mut stack: Vec<(usize, Last, usize, Option<usize>)> = Vec::new(); // (out の中の始まり, 閉じたときの種類, 中身の始まり, 組の番号)
    while i < n {
        let ch = cs[i];
        if let Some((end, min)) = quantifier_at(&cs, i) {
            let lazy = cs.get(end) == Some(&'?');
            match last {
                Last::Nothing | Last::Quantified | Last::Assertion => return Err("Nothing to repeat".into()),
                Last::Lookbehind => return Err("Invalid quantifier".into()),
                // 先読みを繰り返す: 0 回でよければ何も無い（空に合う）、1 回以上なら 1 回と同じ
                Last::Lookahead(start) => {
                    if min == 0 {
                        out.truncate(start);
                        out += "(?:)";
                    }
                }
                Last::EmptyGroup => {}
                Last::Atom => {
                    out += &cs[i..end].iter().collect::<String>();
                    if lazy {
                        out.push('?');
                    }
                }
            }
            i = end + lazy as usize;
            last = Last::Quantified;
            continue;
        }
        if ch == '\\' && i + 1 < n {
            let nx = cs[i + 1];
            let mut used = 2;
            last = Last::Atom;
            match nx {
                's' => out += &format!("[{ws}]"),
                'S' => out += &format!("[^{ws}]"),
                'd' => out += "[0-9]",
                'D' => out += "[^0-9]",
                'w' => out += &format!("[{WORD}]"),
                'W' => out += &format!("[^{WORD}]"),
                'b' => {
                    out += &wb;
                    last = Last::Assertion;
                }
                'B' => {
                    out += &nwb;
                    last = Last::Assertion;
                }
                // \k<名前>: 名前付きの組が 1 つでもあれば、その組への後方参照（無い名前は断る）。1 つも無ければ字の k
                'k' if !named.is_empty() => {
                    let end =
                        (cs.get(i + 2) == Some(&'<')).then(|| cs[i + 3..].iter().position(|c| *c == '>').map(|k| i + 3 + k)).flatten();
                    let Some(end) = end else { return Err("Invalid named reference".into()) };
                    let name: String = cs[i + 3..end].iter().collect();
                    let k = named.iter().find(|(x, _)| *x == name).map(|(_, k)| *k).ok_or("Invalid named capture referenced")?;
                    out += &backref(k, &closed);
                    used = end + 1 - i;
                }
                // \c と英字は制御文字。英字でなければ \ そのもの（c は次に字として読む）
                'c' if cs.get(i + 2).is_some_and(char::is_ascii_alphabetic) => {
                    out += &code(cs[i + 2] as u32 % 32);
                    used = 3;
                }
                'c' => {
                    out += "\\\\";
                    used = 1;
                }
                'x' if hex_at(&cs, i + 2, 2).is_some() => {
                    out += &code(hex_at(&cs, i + 2, 2).unwrap_or(0));
                    used = 4;
                }
                'u' if hex_at(&cs, i + 2, 4).is_some() => {
                    out += &code(hex_at(&cs, i + 2, 4).unwrap_or(0));
                    used = 6;
                }
                '0' => {
                    let (v, k) = legacy_octal(&cs, i + 1); // \0 は NUL、\012 のような 8 進も（JavaScript の Annex B）
                    out += &code(v);
                    used = 1 + k;
                }
                c if c.is_ascii_digit() => {
                    // \N: その番号の組があれば後方参照。無ければ 8 進（1〜7 で始まる）か、その字（8・9）
                    let mut j = i + 1;
                    while cs.get(j).is_some_and(char::is_ascii_digit) {
                        j += 1;
                    }
                    let num: usize = cs[i + 1..j].iter().collect::<String>().parse().unwrap_or(usize::MAX);
                    if num <= names.len() {
                        out += &backref(num, &closed);
                        used = j - i;
                    } else if c.is_digit(8) {
                        let (v, k) = legacy_octal(&cs, i + 1);
                        out += &code(v);
                        used = 1 + k;
                    } else {
                        out += &lit(c);
                    }
                }
                'f' | 'n' | 'r' | 't' | 'v' => {
                    out.push('\\');
                    out.push(nx);
                }
                c => out += &lit(c), // JavaScript では知らない英字・記号の \ は、その字そのもの
            }
            i += used;
            continue;
        }
        let rest = &cs[i..];
        if rest.starts_with(&['[', '^', ']']) {
            out += "[\\s\\S]";
            i += 3;
            last = Last::Atom;
            continue;
        }
        if rest.starts_with(&['[', ']']) {
            out += "(?!)";
            i += 2;
            last = Last::Atom;
            continue;
        }
        match ch {
            '[' => {
                let (cls, next) = translate_class(&cs, i + 1, &ws)?;
                out += &cls;
                i = next;
                last = Last::Atom;
                continue;
            }
            '(' => {
                let start = out.len();
                // JavaScript が読む ( の形は ( (?: (?= (?! (?<= (?<! (?<名前> だけ
                let (kind, skip) = match (cs.get(i + 1), cs.get(i + 2), cs.get(i + 3)) {
                    (Some('?'), Some(':'), _) => (Last::Atom, 3),
                    (Some('?'), Some('='), _) | (Some('?'), Some('!'), _) => (Last::Lookahead(start), 3),
                    (Some('?'), Some('<'), Some('=')) | (Some('?'), Some('<'), Some('!')) => (Last::Lookbehind, 4),
                    (Some('?'), Some('<'), _) => {
                        let end = cs[i + 3..].iter().position(|c| *c == '>').map(|k| i + 3 + k).unwrap_or(n);
                        opened += 1;
                        out.push('(');
                        stack.push((start, Last::Atom, out.len(), Some(opened)));
                        i = end + 1;
                        last = Last::Nothing;
                        continue;
                    }
                    (Some('?'), _, _) => return Err("Invalid group".into()),
                    _ => {
                        opened += 1;
                        out.push('(');
                        stack.push((start, Last::Atom, out.len(), Some(opened)));
                        i += 1;
                        last = Last::Nothing;
                        continue;
                    }
                };
                out += &cs[i..i + skip].iter().collect::<String>();
                stack.push((start, kind, out.len(), None));
                i += skip;
                last = Last::Nothing;
                continue;
            }
            ')' => {
                let Some((_, kind, inner, group)) = stack.pop() else { return Err("Unmatched ')'".into()) };
                let empty = out.len() == inner;
                out.push(')');
                if let Some(k) = group {
                    closed.insert(k);
                }
                last = if matches!(kind, Last::Atom) && empty && group.is_none() { Last::EmptyGroup } else { kind };
                i += 1;
                continue;
            }
            '|' => {
                out.push('|');
                last = Last::Nothing;
                i += 1;
                continue;
            }
            '^' | '$' => {
                out.push(ch);
                last = Last::Assertion;
                i += 1;
                continue;
            }
            '.' => out += "[^\\n\\r\\x{2028}\\x{2029}]",
            '{' => out += "\\{", // 繰り返しでない { は字（JavaScript は字として読む）
            '}' => out += "\\}",
            ']' => out += "\\]",
            _ => out.push(ch),
        }
        last = Last::Atom;
        i += 1;
    }
    let re = Regex::new(&out).map_err(|e| e.to_string())?;
    Ok(JsRe { re, names: named })
}

thread_local! {
    static RE_CACHE: RefCell<HashMap<Vec<u16>, Arc<JsRe>>> = RefCell::new(HashMap::new());
}

/// 利用者の正規表現（JavaScript の書き方）→ 読み替えた正規表現（同じ物は使い回す）
pub fn js_regex(src: &[u16]) -> R<Arc<JsRe>> {
    if let Some(hit) = RE_CACHE.with(|c| c.borrow().get(src).cloned()) {
        return Ok(hit);
    }
    if src.len() > RE_MAX {
        return Err(FormulaError::new(&format!("正規表現は{RE_MAX}文字までです")));
    }
    if let Some(why) = regex_risk(src) {
        return Err(FormulaError::new(&why));
    }
    let re = Arc::new(translate(src).map_err(|e| FormulaError::new(&e))?);
    RE_CACHE.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() > 200 {
            c.clear();
        }
        c.insert(src.to_vec(), re.clone());
    });
    Ok(re)
}

fn re_text(v: &V) -> R<String> {
    let t = text_of(v);
    if t.len() > RE_TEXT_MAX {
        return Err(FormulaError::new(&format!("正規表現で調べる字は{RE_TEXT_MAX}文字までです")));
    }
    Ok(lossy(&t))
}

/// 合う所を左から全部（JavaScript の g と同じ: 空に合ったら 1 字進める）。first なら最初の 1 つだけ
fn matches<'t>(re: &JsRe, t: &'t str, first: bool) -> R<Vec<Captures<'t>>> {
    let (mut out, mut pos) = (Vec::new(), 0usize);
    while pos <= t.len() {
        let Some(m) = re.re.captures_from_pos(t, pos).map_err(|e| FormulaError::new(&e.to_string()))? else { break };
        let whole = m.get(0).map(|x| (x.start(), x.end())).unwrap_or((pos, pos));
        out.push(m);
        if first {
            break;
        }
        pos = if whole.1 > whole.0 { whole.1 } else { whole.1 + t[whole.1..].chars().next().map_or(1, char::len_utf8) };
    }
    Ok(out)
}

/// JavaScript の置き換えの字（$1・$&・$$・$`・$'・$<名前>）で、合った所 m の置き換えを作る
fn substitution(rep: &[char], m: &Captures, t: &str, re: &JsRe) -> String {
    let groups = re.re.captures_len() - 1;
    let named = !re.names.is_empty();
    let whole = m.get(0).map(|x| (x.start(), x.end())).unwrap_or((0, 0));
    let group = |k: usize| m.get(k).map(|x| x.as_str()).unwrap_or("");
    let (mut out, mut i, n) = (String::new(), 0usize, rep.len());
    while i < n {
        let ch = rep[i];
        if ch != '$' || i + 1 >= n {
            out.push(ch);
            i += 1;
            continue;
        }
        let nx = rep[i + 1];
        match nx {
            '$' => {
                out.push('$');
                i += 2;
            }
            '&' => {
                out += &t[whole.0..whole.1];
                i += 2;
            }
            '`' => {
                out += &t[..whole.0];
                i += 2;
            }
            '\'' => {
                out += &t[whole.1..];
                i += 2;
            }
            c if c.is_ascii_digit() => {
                let one = c.to_digit(10).unwrap_or(0) as usize;
                let two = rep.get(i + 2).filter(|d| d.is_ascii_digit()).map(|d| one * 10 + d.to_digit(10).unwrap_or(0) as usize);
                if let Some(k) = two.filter(|k| (1..=groups).contains(k)) {
                    out += group(k);
                    i += 3;
                } else if (1..=groups).contains(&one) {
                    out += group(one);
                    i += 2;
                } else {
                    out.push('$');
                    out.push(c);
                    i += 2;
                }
            }
            '<' if named && rep[i + 2..].contains(&'>') => {
                let j = i + 2 + rep[i + 2..].iter().position(|c| *c == '>').unwrap_or(0);
                let name: String = rep[i + 2..j].iter().collect();
                out += re.group_of(&name).and_then(|k| m.get(k)).map(|x| x.as_str()).unwrap_or("");
                i = j + 1;
            }
            _ => {
                out.push('$');
                i += 1;
            }
        }
    }
    out
}

// ================================================================ 字句解析・構文解析（list-formula.js と同じ）

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Col(String),
    Str(Arc<[u16]>),
    Num(f64),
    Op(&'static str),
    LParen,
    RParen,
    Comma,
    Name(String),
}

fn lex(s: &[u16]) -> R<Vec<Tok>> {
    let (mut out, mut i) = (Vec::new(), 0usize);
    let is = |i: usize, c: u8| s.get(i) == Some(&(c as u16));
    let digit = |i: usize| s.get(i).is_some_and(|&u| (b'0' as u16..=b'9' as u16).contains(&u));
    let alpha = |u: u16| u < 128 && ((u as u8).is_ascii_alphabetic() || u == b'_' as u16);
    while i < s.len() {
        let ch = s[i];
        if is_ws(ch) {
            i += 1;
            continue;
        }
        if ch == b'[' as u16 {
            let end = find(s, &[b']' as u16], i + 1).ok_or_else(|| FormulaError::new("列名の [ ] が閉じていません"))?;
            out.push(Tok::Col(lossy(&s[i + 1..end])));
            i = end + 1;
            continue;
        }
        if ch == b'\'' as u16 || ch == b'"' as u16 {
            let j = find(s, &[ch], i + 1).ok_or_else(|| FormulaError::new("文字列の引用符が閉じていません"))?;
            out.push(Tok::Str(s[i + 1..j].into()));
            i = j + 1;
            continue;
        }
        if digit(i) {
            let mut j = i;
            while digit(j) {
                j += 1;
            }
            if is(j, b'.') && digit(j + 1) {
                j += 1;
                while digit(j) {
                    j += 1;
                }
            }
            out.push(Tok::Num(ascii_f64(&s[i..j]).unwrap_or(0.0)));
            i = j;
            continue;
        }
        let two = |a: u8, b: u8| is(i, a) && is(i + 1, b);
        if let Some(op) = [("<=", b'<', b'='), (">=", b'>', b'='), ("<>", b'<', b'>'), ("<>", b'!', b'=')]
            .iter()
            .find(|(_, a, b)| two(*a, *b))
            .map(|x| x.0)
        {
            out.push(Tok::Op(op));
            i += 2;
            continue;
        }
        let single = match ch {
            0x28 => Some(Tok::LParen),
            0x29 => Some(Tok::RParen),
            0x2c => Some(Tok::Comma),
            0x2b => Some(Tok::Op("+")),
            0x2d => Some(Tok::Op("-")),
            0x2a => Some(Tok::Op("*")),
            0x2f => Some(Tok::Op("/")),
            0x25 => Some(Tok::Op("%")),
            0x3d => Some(Tok::Op("=")),
            0x3c => Some(Tok::Op("<")),
            0x3e => Some(Tok::Op(">")),
            _ => None,
        };
        if let Some(t) = single {
            out.push(t);
            i += 1;
            continue;
        }
        if alpha(ch) {
            let mut j = i + 1;
            while j < s.len() && (alpha(s[j]) || digit(j)) {
                j += 1;
            }
            out.push(Tok::Name(lossy(&s[i..j]).to_lowercase()));
            i = j;
            continue;
        }
        let mut msg = u16s("使えない文字です: ");
        msg.push(ch); // JavaScript は UTF-16 の単位 1 つを言う（U+10000 以上の字は片割れのサロゲート）
        return Err(FormulaError(msg));
    }
    Ok(out)
}

type Func = fn(&[V], &Env) -> R<V>;

#[derive(Clone, Debug)]
enum Node {
    Num(f64),
    Str(Arc<[u16]>),
    Col(String),
    Neg(Box<Node>),
    Not(Box<Node>),
    And(Box<Node>, Box<Node>),
    Or(Box<Node>, Box<Node>),
    Cmp(&'static str, Box<Node>, Box<Node>),
    Bin(&'static str, Box<Node>, Box<Node>),
    If(Vec<Node>),
    Call(Func, Vec<Node>),
}

struct Parser {
    ts: Vec<Tok>,
    p: usize,
    depth: u32,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.ts.get(self.p)
    }
    fn eat(&mut self, t: &Tok) -> bool {
        if self.peek() == Some(t) {
            self.p += 1;
            true
        } else {
            false
        }
    }
    fn name_is(&self, v: &str) -> bool {
        matches!(self.peek(), Some(Tok::Name(n)) if n == v)
    }
    fn op_in(&self, ops: &[&str]) -> Option<&'static str> {
        match self.peek() {
            Some(Tok::Op(o)) if ops.contains(o) => Some(o),
            _ => None,
        }
    }
    fn or_expr(&mut self) -> R<Node> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(FormulaError::new("式の入れ子が深すぎます"));
        }
        let mut n = self.and_expr()?;
        while self.name_is("or") {
            self.p += 1;
            n = Node::Or(Box::new(n), Box::new(self.and_expr()?));
        }
        self.depth -= 1;
        Ok(n)
    }
    fn and_expr(&mut self) -> R<Node> {
        let mut n = self.cmp_expr()?;
        while self.name_is("and") {
            self.p += 1;
            n = Node::And(Box::new(n), Box::new(self.cmp_expr()?));
        }
        Ok(n)
    }
    fn cmp_expr(&mut self) -> R<Node> {
        let mut n = self.add_expr()?;
        while let Some(op) = self.op_in(&["=", "<>", "<", "<=", ">", ">="]) {
            self.p += 1;
            n = Node::Cmp(op, Box::new(n), Box::new(self.add_expr()?));
        }
        Ok(n)
    }
    fn add_expr(&mut self) -> R<Node> {
        let mut n = self.mul_expr()?;
        while let Some(op) = self.op_in(&["+", "-"]) {
            self.p += 1;
            n = Node::Bin(op, Box::new(n), Box::new(self.mul_expr()?));
        }
        Ok(n)
    }
    fn mul_expr(&mut self) -> R<Node> {
        let mut n = self.unary()?;
        while let Some(op) = self.op_in(&["*", "/", "%"]) {
            self.p += 1;
            n = Node::Bin(op, Box::new(n), Box::new(self.unary()?));
        }
        Ok(n)
    }
    fn unary(&mut self) -> R<Node> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(FormulaError::new("式の入れ子が深すぎます"));
        }
        let n = if self.peek() == Some(&Tok::Op("-")) {
            self.p += 1;
            Node::Neg(Box::new(self.unary()?))
        } else if self.name_is("not") {
            self.p += 1;
            Node::Not(Box::new(self.unary()?))
        } else {
            self.atom()?
        };
        self.depth -= 1;
        Ok(n)
    }
    fn atom(&mut self) -> R<Node> {
        let x = self.peek().cloned().ok_or_else(|| FormulaError::new("式が途中で終わっています"))?;
        match x {
            Tok::Num(v) => {
                self.p += 1;
                Ok(Node::Num(v))
            }
            Tok::Str(v) => {
                self.p += 1;
                Ok(Node::Str(v))
            }
            Tok::Col(v) => {
                self.p += 1;
                Ok(Node::Col(v))
            }
            Tok::LParen => {
                self.p += 1;
                let n = self.or_expr()?;
                if !self.eat(&Tok::RParen) {
                    return Err(FormulaError::new(") が必要です"));
                }
                Ok(n)
            }
            Tok::Name(name) => {
                self.p += 1;
                if !self.eat(&Tok::LParen) {
                    return Err(FormulaError::new(&format!("関数の ( が必要です: {name}")));
                }
                let mut args = Vec::new();
                if !self.eat(&Tok::RParen) {
                    args.push(self.or_expr()?);
                    while self.eat(&Tok::Comma) {
                        args.push(self.or_expr()?);
                    }
                    if !self.eat(&Tok::RParen) {
                        return Err(FormulaError::new(") が必要です"));
                    }
                }
                let f = func(&name);
                if name != "if" && f.is_none() {
                    return Err(FormulaError::new(&format!("知らない関数です: {name}")));
                }
                if name == "if" && args.len() < 2 {
                    return Err(FormulaError::new("if は if(条件, 真のとき, 偽のとき) です"));
                }
                if let Some((lo, hi)) = arity(&name) {
                    if lo == hi && args.len() != lo {
                        return Err(FormulaError::new(&format!("{name} は引数が{lo}個です（{}個でした）", args.len())));
                    }
                    if !(lo..=hi).contains(&args.len()) {
                        return Err(FormulaError::new(&format!("{name} は引数が{lo}〜{hi}個です（{}個でした）", args.len())));
                    }
                }
                if matches!(name.as_str(), "extract" | "match" | "regreplace" | "regcount") {
                    if let Some(Node::Str(src)) = args.get(1) {
                        if let Err(e) = js_regex(src) {
                            let mut msg = u16s(&format!("{name} の正規表現として読めません: "));
                            msg.extend(e.0);
                            return Err(FormulaError(msg));
                        }
                    }
                }
                Ok(match f {
                    Some(f) => Node::Call(f, args),
                    None => Node::If(args),
                })
            }
            _ => Err(FormulaError::new("式として読めません")),
        }
    }
}

fn parse(src: &[u16]) -> R<Node> {
    if src.len() > MAX_LEN {
        return Err(FormulaError::new(&format!("式が長すぎます({MAX_LEN}文字まで)")));
    }
    let mut p = Parser { ts: lex(src)?, p: 0, depth: 0 };
    let node = p.or_expr()?;
    if p.p < p.ts.len() {
        return Err(FormulaError::new("式の後ろに余分なものがあります"));
    }
    Ok(node)
}

/// 引数の数（下限, 上限）。書いていない関数（concat・coalesce）は幾つでも
fn arity(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "num" | "text" | "abs" | "len" | "trim" | "upper" | "lower" | "hankaku" | "lenb" | "int" | "ceil" | "sqrt" | "isnum"
        | "isblank" | "year" | "month" | "day" | "hour" | "minute" | "weekday" | "date" => (1, 1),
        "cmp" | "round" | "left" | "right" | "find" | "match" | "contains" | "startswith" | "endswith" | "count" | "regcount" | "rept" => {
            (2, 2)
        }
        "replace" | "regreplace" | "split" => (3, 3),
        "mid" | "extract" | "padleft" => (2, 3),
        "conv" => (2, 9),
        "roundup" | "rounddown" => (1, 2),
        "datediff" => (2, 3),
        "ifs" => (2, 40),
        "switch" => (3, 41),
        "kamadate" => (1, 2),
        "min" | "max" | "sum" | "avg" => (1, 30),
        _ => return None,
    })
}

// ================================================================ 関数（list-formula.js の FUNCS と同じ）

/// 式を計算するときの周り（変換表・入れ子の深さ）
pub struct Env<'a> {
    pub tables: &'a Tables,
    depth: Cell<u32>,
}

fn num_or0(v: &V) -> f64 {
    num_of(v).unwrap_or(0.0)
}

fn pos_of(v: &V) -> f64 {
    num_of(v).map(|n| n.floor().max(1.0)).unwrap_or(1.0)
}

fn s(v: Vec<u16>) -> R<V> {
    Ok(V::units(v))
}

fn opt(v: Option<f64>) -> R<V> {
    Ok(v.map(V::Num).unwrap_or(V::Null))
}

fn f_round(a: &[V], _: &Env) -> R<V> {
    let Some(n) = num_of(&a[0]) else { return Ok(V::Null) };
    let d = num_or0(&a[1]).clamp(0.0, 8.0);
    let p = 10f64.powf(d);
    let x = n * p;
    let r = if x.is_finite() {
        let f = x.floor();
        if x - f >= 0.5 {
            f + 1.0
        } else {
            f
        }
    } else {
        x
    };
    Ok(V::Num(r / p))
}

fn f_mid(a: &[V], _: &Env) -> R<V> {
    let t = text_of(&a[0]);
    let st = pos_of(&a[1]) - 1.0;
    let n = if a.len() > 2 { num_or0(&a[2]).max(0.0) } else { t.len() as f64 };
    s(slice(&t, st, Some(st + n)))
}

fn f_replace(a: &[V], _: &Env) -> R<V> {
    let (t, sub, rep) = (text_of(&a[0]), text_of(&a[1]), text_of(&a[2]));
    let parts: Vec<&[u16]> = if sub.is_empty() { t.chunks(1).collect() } else { split(&t, &sub) };
    let hits = if sub.is_empty() { t.len() + 1 } else { parts.len() - 1 };
    if t.len() as i64 + hits as i64 * (rep.len() as i64 - sub.len() as i64) > STR_MAX as i64 {
        return Err(too_long());
    }
    s(parts.join(&rep[..]))
}

fn f_extract(a: &[V], _: &Env) -> R<V> {
    let t = re_text(&a[0])?;
    let re = js_regex(&text_of(&a[1]))?;
    let ms = matches(&re, &t, true)?;
    let Some(m) = ms.first() else { return Ok(V::empty()) };
    let g = if a.len() > 2 { num_or0(&a[2]).max(0.0) } else { 0.0 };
    if g.fract() != 0.0 || g as usize >= re.re.captures_len() {
        return Ok(V::empty());
    }
    Ok(V::text(m.get(g as usize).map(|x| x.as_str()).unwrap_or("")))
}

fn f_match(a: &[V], _: &Env) -> R<V> {
    let t = re_text(&a[0])?;
    let re = js_regex(&text_of(&a[1]))?;
    Ok(V::bool(!matches(&re, &t, true)?.is_empty()))
}

fn f_regreplace(a: &[V], _: &Env) -> R<V> {
    let t = re_text(&a[0])?;
    let rep = text_of(&a[2]);
    let tl = u16s(&t).len();
    if rep.len() * (tl + 1) + tl > STR_MAX {
        return Err(too_long());
    }
    let re = js_regex(&text_of(&a[1]))?;
    let rep: Vec<char> = lossy(&rep).chars().collect();
    let (mut out, mut last) = (String::new(), 0usize);
    for m in matches(&re, &t, false)? {
        let w = m.get(0).map(|x| (x.start(), x.end())).unwrap_or((last, last));
        out += &t[last..w.0];
        out += &substitution(&rep, &m, &t, &re);
        last = w.1;
    }
    out += &t[last..];
    Ok(V::text(&out))
}

fn f_regcount(a: &[V], _: &Env) -> R<V> {
    let t = re_text(&a[0])?;
    let re = js_regex(&text_of(&a[1]))?;
    Ok(V::Num(matches(&re, &t, false)?.len() as f64))
}

fn f_split(a: &[V], _: &Env) -> R<V> {
    let (t, sep) = (text_of(&a[0]), text_of(&a[1]));
    let parts: Vec<&[u16]> = if sep.is_empty() { vec![&t[..]] } else { split(&t, &sep) };
    let i = pos_of(&a[2]) as usize - 1;
    s(parts.get(i).map(|p| p.to_vec()).unwrap_or_default())
}

fn f_padleft(a: &[V], _: &Env) -> R<V> {
    let t = text_of(&a[0]);
    let width = num_or0(&a[1]).clamp(0.0, 64.0).trunc() as usize;
    let fill = if a.len() > 2 { text_of(&a[2]).into_owned() } else { Vec::new() };
    let fill = if fill.is_empty() { u16s("0") } else { fill };
    if width <= t.len() {
        return s(t.into_owned());
    }
    let need = width - t.len();
    let mut out: Vec<u16> = fill.iter().copied().cycle().take(need).collect();
    out.extend_from_slice(&t);
    s(out)
}

fn f_coalesce(a: &[V], _: &Env) -> R<V> {
    Ok(a.iter().find(|v| !matches!(v, V::Null) && !matches!(v, V::Str(s) if s.is_empty())).cloned().unwrap_or_else(V::empty))
}

fn nums(a: &[V]) -> Vec<f64> {
    a.iter().filter_map(num_of).collect()
}

fn fold_js(xs: &[f64], pick: fn(f64, f64) -> f64) -> Option<f64> {
    let mut it = xs.iter().copied();
    let first = it.next()?;
    Some(it.fold(first, |m, x| if m.is_nan() || x.is_nan() { f64::NAN } else { pick(m, x) }))
}

fn sum(xs: &[f64]) -> f64 {
    xs.iter().fold(0.0, |s, x| s + x) // 左から順に足す（JavaScript の reduce と同じ丸め）
}

fn round_dir(a: &[V], up: bool) -> R<V> {
    let Some(n) = num_of(&a[0]) else { return Ok(V::Null) };
    let d = if a.len() > 1 { num_or0(&a[1]).clamp(0.0, 8.0).trunc() } else { 0.0 };
    let p = 10f64.powi(d as i32);
    // x×10^桁 の小さな誤差（1.1×10＝11.000000000000002）は 15 桁で丸めてから切る（toPrecision(15)）
    let t: f64 = format!("{:.14e}", n.abs() * p).parse().unwrap_or(f64::NAN);
    Ok(V::Num(if n < 0.0 { -1.0 } else { 1.0 } * if up { t.ceil() } else { t.floor() } / p))
}

fn f_rept(a: &[V], _: &Env) -> R<V> {
    let t = text_of(&a[0]);
    let mut n = num_or0(&a[1]).clamp(0.0, 1000.0).trunc() as usize;
    if !t.is_empty() && t.len() * n > REPT_MAX {
        n = REPT_MAX / t.len();
    }
    s(t.repeat(n))
}

fn eq_of(a: &V, b: &V) -> bool {
    match (strict_num(a), strict_num(b)) {
        (Some(x), Some(y)) => x == y,
        _ => text_of(a) == text_of(b),
    }
}

fn f_switch(a: &[V], _: &Env) -> R<V> {
    let mut i = 1;
    while i + 1 < a.len() {
        if eq_of(&a[0], &a[i]) {
            return Ok(a[i + 1].clone());
        }
        i += 2;
    }
    Ok(if a.len().is_multiple_of(2) { a[a.len() - 1].clone() } else { V::empty() })
}

fn f_ifs(a: &[V], _: &Env) -> R<V> {
    let mut i = 0;
    while i + 1 < a.len() {
        if truthy(&a[i]) {
            return Ok(a[i + 1].clone());
        }
        i += 2;
    }
    Ok(if a.len() % 2 == 1 { a[a.len() - 1].clone() } else { V::empty() })
}

// ---------------------------------------------------------------- 日時（数字は半角だけ。区切りは - / . 年月日 と T・空白）
struct DateRe {
    ymd: regex::Regex,
    yy: regex::Regex,
    d8: regex::Regex,
    t: regex::Regex,
}

fn date_re() -> &'static DateRe {
    static RE: OnceLock<DateRe> = OnceLock::new();
    RE.get_or_init(|| DateRe {
        ymd: regex::Regex::new(
            r"^([0-9]{4})[-/.年]([0-9]{1,2})[-/.月]([0-9]{1,2})日?(?:[T \x{3000}]+([0-9]{1,2})[:時]([0-9]{1,2})(?:[:分]([0-9]{1,2})(?:\.[0-9]+)?秒?)?)?$",
        )
        .expect("日時の正規表現"),
        yy: regex::Regex::new(r"^([0-9]{2})/([0-9]{1,2})/([0-9]{1,2})(?:[T \x{3000}]+([0-9]{1,2}):([0-9]{1,2})(?::([0-9]{1,2}))?)?$")
            .expect("日時の正規表現"),
        d8: regex::Regex::new(r"^([0-9]{4})([0-9]{2})([0-9]{2})$").expect("日時の正規表現"),
        t: regex::Regex::new(r"^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$").expect("日時の正規表現"),
    })
}

/// 1970-01-01 からの日数（days_from_civil。整数だけで計算する）
fn days(y: i64, m: i64, d: i64) -> i64 {
    let y = y - (m <= 2) as i64;
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468
}

/// 値 → [年, 月, 日, 時, 分, 秒] と日付があるか。日時と読めなければ None（時刻だけは 1970-01-01 の時刻）
fn when(v: &V) -> Option<([i64; 6], bool)> {
    let t = lossy(js_trim(&text_of(v)));
    let re = date_re();
    let num = |c: &regex::Captures, i: usize| c.get(i).and_then(|x| x.as_str().parse::<i64>().ok()).unwrap_or(0);
    let (g, has) = if let Some(c) = re.ymd.captures(&t).or_else(|| re.d8.captures(&t)) {
        ([num(&c, 1), num(&c, 2), num(&c, 3), num(&c, 4), num(&c, 5), num(&c, 6)], true)
    } else if let Some(c) = re.yy.captures(&t) {
        ([num(&c, 1) + 2000, num(&c, 2), num(&c, 3), num(&c, 4), num(&c, 5), num(&c, 6)], true)
    } else {
        let c = re.t.captures(&t)?;
        ([1970, 1, 1, num(&c, 1), num(&c, 2), num(&c, 3)], false)
    };
    let (y, mo, d, h, mi, sec) = (g[0], g[1], g[2], g[3], g[4], g[5]);
    const DIM: [i64; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let dim = if mo == 2 && leap {
        29
    } else if (1..=12).contains(&mo) {
        DIM[(mo - 1) as usize]
    } else {
        0
    };
    (1 <= d && d <= dim && h <= 23 && mi <= 59 && sec <= 59).then_some((g, has))
}

fn sec_of(w: &[i64; 6]) -> i64 {
    days(w[0], w[1], w[2]) * 86400 + w[3] * 3600 + w[4] * 60 + w[5]
}

fn part(a: &[V], i: usize, need_date: bool) -> R<V> {
    Ok(match when(&a[0]) {
        Some((w, has)) if has || !need_date => V::Num(w[i] as f64),
        _ => V::Null,
    })
}

fn ymd_text(y: i64, m: i64, d: i64) -> V {
    V::text(&format!("{y:04}-{m:02}-{d:02}"))
}

fn f_weekday(a: &[V], _: &Env) -> R<V> {
    Ok(match when(&a[0]) {
        Some((w, true)) => V::Num(((days(w[0], w[1], w[2]).rem_euclid(7) + 4) % 7 + 1) as f64),
        _ => V::Null,
    })
}

fn f_date(a: &[V], _: &Env) -> R<V> {
    Ok(match when(&a[0]) {
        Some((w, true)) => ymd_text(w[0], w[1], w[2]),
        _ => V::Null,
    })
}

fn f_datediff(a: &[V], _: &Env) -> R<V> {
    let unit = if a.len() > 2 { lossy(js_trim(&text_of(&a[2]))).to_lowercase() } else { "d".into() };
    let u = match unit.as_str() {
        "d" | "日" => 86400.0,
        "h" | "時" | "時間" => 3600.0,
        "m" | "分" => 60.0,
        "s" | "秒" => 1.0,
        _ => return Ok(V::Null),
    };
    match (when(&a[0]), when(&a[1])) {
        (Some((x, _)), Some((y, _))) => Ok(V::Num((sec_of(&y) - sec_of(&x)) as f64 / u)),
        _ => Ok(V::Null),
    }
}

/// y 年 m 月の、第 week 週・曜日 wd（日＝1 〜 土＝7）の日（無ければ None）。月初を第 1 週として日曜日で 1 つ進み、第 6 週は第 1 週に戻す
fn kama_day(y: i64, m: i64, week: i64, wd: i64) -> Option<i64> {
    let first = days(y, m, 1);
    let last = if m == 12 { days(y + 1, 1, 1) } else { days(y, m + 1, 1) } - first;
    let sw = (first.rem_euclid(7) + 4) % 7;
    let mut n = 0;
    for d in 1..=last {
        let dw = (sw + d - 1) % 7 + 1;
        if n == 0 || dw == 1 {
            n = if n == 5 { 1 } else { n + 1 };
        }
        if n == week && dw == wd {
            return Some(d);
        }
    }
    None
}

/// kamadate(釜番[, 基準日])（版 3.51.2）: 釜番 → 日付。基準日（省くと今日）の前の月・その月・次の月のうち、いちばん近い物
fn f_kamadate(a: &[V], _: &Env) -> R<V> {
    let k = js_trim(&text_of(&a[0])).to_vec();
    if k.len() != 3 || !k.iter().all(|&u| (b'0' as u16..=b'9' as u16).contains(&u)) {
        return Ok(V::Null);
    }
    let (week, wd) = ((k[0] - b'0' as u16) as i64, (k[1] - b'0' as u16) as i64);
    if !(1..=5).contains(&week) || !(1..=7).contains(&wd) {
        return Ok(V::Null);
    }
    let (y, m, d0) = if a.len() > 1 {
        match when(&a[1]) {
            Some((w, true)) => (w[0], w[1], w[2]),
            _ => return Ok(V::Null),
        }
    } else {
        use chrono::Datelike;
        let t = chrono::Local::now().date_naive();
        (t.year() as i64, t.month() as i64, t.day() as i64)
    };
    let base = days(y, m, d0);
    let mut best: Option<(i64, i64, i64, i64)> = None;
    for dm in [-1, 0, 1] {
        let (yy, mm) = match m + dm {
            0 => (y - 1, 12),
            13 => (y + 1, 1),
            x => (y, x),
        };
        if let Some(d) = kama_day(yy, mm, week, wd) {
            let gap = (days(yy, mm, d) - base).abs();
            if best.is_none_or(|b| gap < b.0) {
                best = Some((gap, yy, mm, d));
            }
        }
    }
    Ok(best.map(|b| ymd_text(b.1, b.2, b.3)).unwrap_or(V::Null))
}

fn f_lenb(a: &[V], _: &Env) -> R<V> {
    Ok(V::Num(text_of(&a[0]).iter().map(|&u| if u <= 0x7f || (0xff61..=0xff9f).contains(&u) { 1.0 } else { 2.0 }).sum()))
}

fn f_count(a: &[V], _: &Env) -> R<V> {
    let sub = text_of(&a[1]);
    Ok(V::Num(if sub.is_empty() { 0.0 } else { (split(&text_of(&a[0]), &sub).len() - 1) as f64 }))
}

fn func(name: &str) -> Option<Func> {
    let f: Func = match name {
        "num" => |a, _| opt(num_of(&a[0])),
        "text" => |a, _| s(text_of(&a[0]).into_owned()),
        "abs" => |a, _| opt(num_of(&a[0]).map(f64::abs)),
        "round" => f_round,
        "len" => |a, _| Ok(V::Num(text_of(&a[0]).len() as f64)),
        "left" => |a, _| s(slice(&text_of(&a[0]), 0.0, Some(num_or0(&a[1]).max(0.0)))),
        "right" => |a, _| {
            let n = num_or0(&a[1]).max(0.0);
            s(if n != 0.0 && !n.is_nan() { slice(&text_of(&a[0]), -n, None) } else { Vec::new() })
        },
        "trim" => |a, _| s(js_trim(&text_of(&a[0])).to_vec()),
        "upper" => |a, _| s(map_valid(&text_of(&a[0]), str::to_uppercase)),
        "lower" => |a, _| s(map_valid(&text_of(&a[0]), str::to_lowercase)),
        "concat" => |a, _| s(a.iter().flat_map(|v| text_of(v).into_owned()).collect()),
        "coalesce" => f_coalesce,
        "mid" => f_mid,
        "find" => |a, _| Ok(V::Num(find(&text_of(&a[0]), &text_of(&a[1]), 0).map_or(0.0, |i| (i + 1) as f64))),
        "replace" => f_replace,
        "extract" => f_extract,
        "match" => f_match,
        "regreplace" => f_regreplace,
        "split" => f_split,
        "contains" => |a, _| Ok(V::bool(find(&text_of(&a[0]), &text_of(&a[1]), 0).is_some())),
        "cmp" => |a, _| Ok(V::Num(js_cmp(&a[0], &a[1]) as f64)),
        "startswith" => |a, _| Ok(V::bool(text_of(&a[0]).starts_with(&text_of(&a[1])))),
        "endswith" => |a, _| Ok(V::bool(text_of(&a[0]).ends_with(&text_of(&a[1])))),
        "hankaku" => |a, _| {
            use unicode_normalization::UnicodeNormalization;
            s(map_valid(&text_of(&a[0]), |x| x.nfkc().collect()))
        },
        "padleft" => f_padleft,
        "conv" => f_conv,
        "count" => f_count,
        "regcount" => f_regcount,
        "lenb" => f_lenb,
        "rept" => f_rept,
        "min" => |a, _| opt(fold_js(&nums(a), f64::min)),
        "max" => |a, _| opt(fold_js(&nums(a), f64::max)),
        "sum" => |a, _| {
            let x = nums(a);
            opt((!x.is_empty()).then(|| sum(&x)))
        },
        "avg" => |a, _| {
            let x = nums(a);
            opt((!x.is_empty()).then(|| sum(&x) / x.len() as f64))
        },
        "int" => |a, _| opt(num_of(&a[0]).map(f64::floor)),
        "ceil" => |a, _| opt(num_of(&a[0]).map(f64::ceil)),
        "roundup" => |a, _| round_dir(a, true),
        "rounddown" => |a, _| round_dir(a, false),
        "sqrt" => |a, _| opt(num_of(&a[0]).filter(|n| *n >= 0.0).map(f64::sqrt)),
        "isnum" => |a, _| Ok(V::bool(strict_num(&a[0]).is_some())),
        "isblank" => |a, _| Ok(V::bool(js_trim(&text_of(&a[0])).is_empty())),
        "ifs" => f_ifs,
        "switch" => f_switch,
        "year" => |a, _| part(a, 0, true),
        "month" => |a, _| part(a, 1, true),
        "day" => |a, _| part(a, 2, true),
        "hour" => |a, _| part(a, 3, false),
        "minute" => |a, _| part(a, 4, false),
        "weekday" => f_weekday,
        "date" => f_date,
        "datediff" => f_datediff,
        "kamadate" => f_kamadate,
        _ => return None,
    };
    Some(f)
}

// ================================================================ 変換表（list-formula.js の conv と同じ決まり・同じ答え）

/// 変換表の試し（{op, v:[…], min, max, minInc, maxInc}）
struct Test {
    op: String,
    v: Vec<Vec<u16>>,
    min: Option<f64>,
    max: Option<f64>,
    min_inc: bool,
    max_inc: bool,
}

enum Out {
    Text(V),
    Formula(Box<Formula>),
    Bad,
}

/// 変換表の行の条件（入力の名前 → 試しの並び。並びでない物は None＝不問）
type When = HashMap<String, Option<Vec<Test>>>;

struct ConvTable {
    inputs: Vec<(String, bool)>, // (名前, 数で比べるか)
    rows: Vec<(When, Out)>,
    other: Out,
}

/// 変換表の並び（名前 → 表）。式の conv('表の名前', 値…) が引く
#[derive(Default)]
pub struct Tables(HashMap<String, Arc<ConvTable>>);

fn json_text(v: &Value) -> Vec<u16> {
    match v {
        Value::Null => Vec::new(),
        Value::String(s) => u16s(s),
        Value::Number(n) => u16s(&js_num_text(n.as_f64().unwrap_or(f64::NAN))),
        Value::Bool(b) => u16s(if *b { "true" } else { "false" }),
        other => u16s(&other.to_string()),
    }
}

fn conv_out(o: Option<&Value>) -> Out {
    let t = o.map(json_text).unwrap_or_default();
    if t.first() != Some(&(b'=' as u16)) {
        return Out::Text(V::units(t));
    }
    match Formula::compile_units(&t[1..]) {
        Ok(f) => Out::Formula(Box::new(f)),
        Err(_) => Out::Bad,
    }
}

fn bound(v: Option<&Value>) -> Option<f64> {
    match v {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s.is_empty() => None,
        Some(x) => loose_num(&V::units(json_text(x))),
    }
}

impl Tables {
    /// マスタの変換表（{名前: {inputs, rows, other}}。Python の conversions.tables と同じ形）
    pub fn from_json(v: &Value) -> Tables {
        let mut out = HashMap::new();
        for (name, tb) in v.as_object().into_iter().flatten() {
            let Some(tb) = tb.as_object() else { continue };
            let list = |k: &str| {
                tb.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_object).collect::<Vec<_>>()).unwrap_or_default()
            };
            let inputs = list("inputs")
                .iter()
                .map(|x| {
                    (
                        x.get("name").map(|n| lossy(&json_text(n))).unwrap_or_else(|| "undefined".into()),
                        x.get("type") == Some(&Value::from("num")),
                    )
                })
                .collect();
            let rows = list("rows")
                .iter()
                .map(|r| {
                    let when: When = r
                        .get("when")
                        .and_then(Value::as_object)
                        .map(|w| w.iter().map(|(k, ts)| (k.clone(), ts.as_array().map(|a| tests(a)))).collect())
                        .unwrap_or_default();
                    (when, conv_out(r.get("out")))
                })
                .collect();
            out.insert(name.clone(), Arc::new(ConvTable { inputs, rows, other: conv_out(tb.get("other")) }));
        }
        Tables(out)
    }
    fn get(&self, name: &str) -> Option<&Arc<ConvTable>> {
        self.0.get(name)
    }
}

/// 試しの並び（物でない試しは「当たらない」。空の並びは「不問」と読むので None と分ける）
fn tests(a: &[Value]) -> Vec<Test> {
    a.iter()
        .map(|t| match t.as_object() {
            Some(t) => Test {
                op: t.get("op").and_then(Value::as_str).unwrap_or("").into(),
                v: t.get("v").and_then(Value::as_array).map(|v| v.iter().map(json_text).collect()).unwrap_or_default(),
                min: bound(t.get("min")),
                max: bound(t.get("max")),
                min_inc: t.get("minInc") != Some(&Value::Bool(false)),
                max_inc: t.get("maxInc") != Some(&Value::Bool(false)),
            },
            None => Test { op: String::new(), v: Vec::new(), min: None, max: None, min_inc: true, max_inc: true },
        })
        .collect()
}

fn conv_eq(s: &[u16], x: &[u16], num: bool) -> bool {
    let t = js_trim(x);
    if num {
        if let (Some(a), Some(b)) = (loose_num(&V::units(s.to_vec())), loose_num(&V::units(t.to_vec()))) {
            return a == b;
        }
    }
    s == t
}

fn conv_test(t: &Test, v: &V, num: bool) -> bool {
    let tx = text_of(v);
    let s = js_trim(&tx);
    let any = |f: &dyn Fn(&[u16]) -> bool| t.v.iter().any(|x| !x.is_empty() && f(x));
    match t.op.as_str() {
        "eq" => t.v.iter().any(|x| conv_eq(s, x, num)),
        "ne" => !t.v.iter().any(|x| conv_eq(s, x, num)),
        "starts" => any(&|x| s.starts_with(x)),
        "nstarts" => !any(&|x| s.starts_with(x)),
        "ends" => any(&|x| s.ends_with(x)),
        "nends" => !any(&|x| s.ends_with(x)),
        "contains" => any(&|x| find(s, x, 0).is_some()),
        "ncontains" => !any(&|x| find(s, x, 0).is_some()),
        "empty" => s.is_empty(),
        "filled" => !s.is_empty(),
        "range" => {
            let Some(n) = loose_num(&V::units(s.to_vec())) else { return false };
            if let Some(lo) = t.min {
                if if t.min_inc { n < lo } else { n <= lo } {
                    return false;
                }
            }
            if let Some(hi) = t.max {
                if if t.max_inc { n > hi } else { n >= hi } {
                    return false;
                }
            }
            true
        }
        _ => false,
    }
}

fn conv_give(o: &Out, vals: &HashMap<&str, V>, env: &Env) -> R<V> {
    match o {
        Out::Bad => Ok(V::Null),
        Out::Text(t) => Ok(t.clone()),
        Out::Formula(f) => Ok(f.run_in(&|c: &str| vals.get(c).cloned().unwrap_or(V::Null), env)),
    }
}

fn f_conv(a: &[V], env: &Env) -> R<V> {
    let Some(tb) = env.tables.get(&lossy(&text_of(&a[0]))).cloned() else { return Ok(V::Null) };
    let vals: HashMap<&str, V> =
        tb.inputs.iter().enumerate().map(|(i, (n, _))| (n.as_str(), a.get(i + 1).cloned().unwrap_or(V::Null))).collect();
    for (when, out) in &tb.rows {
        let hit = tb.inputs.iter().all(|(name, num)| match when.get(name) {
            Some(Some(ts)) if !ts.is_empty() => ts.iter().any(|t| conv_test(t, &vals[name.as_str()], *num)),
            _ => true,
        });
        if hit {
            return conv_give(out, &vals, env);
        }
    }
    conv_give(&tb.other, &vals, env)
}

// ================================================================ 評価

fn cmp_op(op: &str, a: &V, b: &V) -> bool {
    match (strict_num(a), strict_num(b)) {
        (Some(x), Some(y)) => match op {
            "=" => x == y,
            "<>" => x != y,
            "<" => x < y,
            "<=" => x <= y,
            ">" => x > y,
            _ => x >= y,
        },
        _ => {
            let c = order(&text_of(a), &text_of(b));
            match op {
                "=" => c == 0,
                "<>" => c != 0,
                "<" => c < 0,
                "<=" => c <= 0,
                ">" => c > 0,
                _ => c >= 0,
            }
        }
    }
}

fn eval(n: &Node, row: &dyn Fn(&str) -> V, env: &Env) -> R<V> {
    Ok(match n {
        Node::Num(v) => V::Num(*v),
        Node::Str(v) => V::Str(v.clone()),
        Node::Col(c) => row(c),
        Node::Neg(a) => num_of(&eval(a, row, env)?).map(|x| V::Num(-x)).unwrap_or(V::Null),
        Node::Not(a) => V::bool(!truthy(&eval(a, row, env)?)),
        Node::And(a, b) => V::bool(truthy(&eval(a, row, env)?) && truthy(&eval(b, row, env)?)),
        Node::Or(a, b) => V::bool(truthy(&eval(a, row, env)?) || truthy(&eval(b, row, env)?)),
        Node::Cmp(op, a, b) => V::bool(cmp_op(op, &eval(a, row, env)?, &eval(b, row, env)?)),
        Node::Bin(op, a, b) => {
            let (a, b) = (eval(a, row, env)?, eval(b, row, env)?);
            let (x, y) = (num_of(&a), num_of(&b));
            if *op == "+" {
                if let (Some(x), Some(y)) = (x, y) {
                    return Ok(V::Num(x + y));
                }
                let (ta, tb) = (text_of(&a), text_of(&b));
                if ta.len() + tb.len() > STR_MAX {
                    return Err(too_long());
                }
                return s([&ta[..], &tb[..]].concat());
            }
            let (Some(x), Some(y)) = (x, y) else { return Ok(V::Null) };
            match *op {
                "-" => V::Num(x - y),
                "*" => V::Num(x * y),
                "/" if y == 0.0 => V::Null,
                "/" => V::Num(x / y),
                _ if y == 0.0 => V::Null,
                _ => V::Num(x % y),
            }
        }
        Node::If(args) => {
            if truthy(&eval(&args[0], row, env)?) {
                eval(&args[1], row, env)?
            } else if args.len() > 2 {
                eval(&args[2], row, env)?
            } else {
                V::empty()
            }
        }
        Node::Call(f, args) => {
            let vals = args.iter().map(|a| eval(a, row, env)).collect::<R<Vec<V>>>()?;
            let v = f(&vals, env)?;
            if matches!(&v, V::Str(s) if s.len() > STR_MAX) {
                return Err(too_long());
            }
            v
        }
    })
}

fn columns_used(n: &Node, out: &mut Vec<String>) {
    match n {
        Node::Col(c) => {
            if !out.contains(c) {
                out.push(c.clone());
            }
        }
        Node::Neg(a) | Node::Not(a) => columns_used(a, out),
        Node::And(a, b) | Node::Or(a, b) | Node::Cmp(_, a, b) | Node::Bin(_, a, b) => {
            columns_used(a, out);
            columns_used(b, out);
        }
        Node::If(args) | Node::Call(_, args) => args.iter().for_each(|a| columns_used(a, out)),
        Node::Num(_) | Node::Str(_) => {}
    }
}

/// 読み解いた式（1 回だけ読み、行ごとに使い回す）
pub struct Formula {
    node: Node,
    pub columns: Vec<String>,
}

impl Formula {
    pub fn compile(src: &str) -> Result<Formula, FormulaError> {
        Formula::compile_units(&u16s(src))
    }
    fn compile_units(src: &[u16]) -> Result<Formula, FormulaError> {
        let node = parse(src)?;
        let mut columns = Vec::new();
        columns_used(&node, &mut columns);
        Ok(Formula { node, columns })
    }
    /// 1 行ぶんの答え（lookup は 列名 → 値。無ければ Null）。行ごとの失敗はその行だけ Null
    pub fn run(&self, lookup: &dyn Fn(&str) -> V, tables: &Tables) -> V {
        self.run_in(lookup, &Env { tables, depth: Cell::new(0) })
    }
    fn run_in(&self, lookup: &dyn Fn(&str) -> V, env: &Env) -> V {
        let d = env.depth.get();
        if d >= MAX_DEPTH {
            return V::Null; // 変換表が自分を引き続ける（画面は呼び出しが深すぎて空になる）
        }
        env.depth.set(d + 1);
        let v = eval(&self.node, lookup, env).unwrap_or(V::Null);
        env.depth.set(d);
        v
    }
}

/// 書いている最中の確かめと同じ（読めれば式が使う列、読めなければ理由）
pub fn check(src: &str) -> Result<Vec<String>, FormulaError> {
    if js_trim(&u16s(src)).is_empty() {
        return Err(FormulaError::new("式を入力してください"));
    }
    Formula::compile(src).map(|f| f.columns)
}

// ================================================================ 計算列（一覧の表示列の設定と同じ引き方）

/// 画面が送る計算列 {formulas: {列名: 式}, names: {元の列名: 表示名}} → 字だけ・数と長さを限った形（Python の clean_calc）。
/// 式・表示名は送られた順のまま持つ（式の数の上限で切る所・同じ表示名を 2 つの列に付けたときの後勝ちが、Python と同じになる）
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Calc {
    pub formulas: Vec<(String, String)>,
    pub names: Vec<(String, String)>,
    /// 設備ごとの式（版 3.74.0。Python の equips）: 設備名 → その設備の式・表示名。数えるファイルごとに for_part で上に重ねる
    pub equips: Vec<(String, Calc)>,
}

/// 鍵の並びに (鍵, 値) を入れる: 同じ鍵があれば値だけ替え、場所は先の物のまま（Python の dict と同じ）
fn put<T>(xs: &mut Vec<(String, T)>, k: String, v: T) {
    match xs.iter_mut().find(|(n, _)| *n == k) {
        Some(x) => x.1 = v,
        None => xs.push((k, v)),
    }
}

impl Calc {
    /// 設備 name のファイルで使う形（Python の calc_for）: その設備の式・表示名を上に重ねる。式の並びはその設備の物 → 共通の物。
    /// 式が 1 つも無ければ None
    pub fn for_part(&self, name: &str) -> Option<Calc> {
        let (mut formulas, mut names) = (self.formulas.clone(), self.names.clone());
        if let Some((_, e)) = self.equips.iter().find(|(n, _)| n == name) {
            let mut mine = e.formulas.clone();
            mine.extend(formulas.into_iter().filter(|(k, _)| !e.formulas.iter().any(|(m, _)| m == k)));
            formulas = mine;
            for (k, v) in &e.names {
                put(&mut names, k.clone(), v.clone());
            }
        }
        (!formulas.is_empty()).then_some(Calc { formulas, names, equips: vec![] })
    }
}

/// JSON を、物（{}）の鍵の順を保って読む（serde_json の Map は鍵の字の順に並べ直すため）
enum Item {
    Map(Vec<(String, Item)>),
    Text(String),
    Other,
}

impl<'de> serde::Deserialize<'de> for Item {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Item, D::Error> {
        struct Visit;
        impl<'de> serde::de::Visitor<'de> for Visit {
            type Value = Item;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("JSON の値")
            }
            fn visit_str<E>(self, v: &str) -> Result<Item, E> {
                Ok(Item::Text(v.to_string()))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut m: A) -> Result<Item, A::Error> {
                let mut out = Vec::new();
                while let Some((k, v)) = m.next_entry::<String, Item>()? {
                    out.push((k, v));
                }
                Ok(Item::Map(out))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut s: A) -> Result<Item, A::Error> {
                while s.next_element::<Item>()?.is_some() {}
                Ok(Item::Other)
            }
            fn visit_bool<E>(self, _: bool) -> Result<Item, E> {
                Ok(Item::Other)
            }
            fn visit_i64<E>(self, _: i64) -> Result<Item, E> {
                Ok(Item::Other)
            }
            fn visit_u64<E>(self, _: u64) -> Result<Item, E> {
                Ok(Item::Other)
            }
            fn visit_f64<E>(self, _: f64) -> Result<Item, E> {
                Ok(Item::Other)
            }
            fn visit_unit<E>(self) -> Result<Item, E> {
                Ok(Item::Other)
            }
        }
        d.deserialize_any(Visit)
    }
}

/// 計算列の JSON の字 → 計算列（無い・読めない・式が 1 つも無ければ None）
pub fn clean_calc(text: &str) -> Option<Calc> {
    if text.trim().is_empty() {
        return None;
    }
    let Ok(Item::Map(top)) = serde_json::from_str::<Item>(text) else { return None };
    let get = |k: &str| top.iter().rev().find(|(n, _)| n == k).map(|(_, v)| v); // 同じ鍵が 2 つあれば後ろ（Python の json.loads と同じ）
    let cut = |s: &str, n: usize| s.chars().take(n).collect::<String>();
    let strs = |d: Option<&Item>, n: usize, size: usize| -> Vec<(String, String)> {
        let Some(Item::Map(m)) = d else { return Vec::new() };
        m.iter()
            .take(n)
            .filter_map(|(k, x)| match x {
                Item::Text(t) if !k.trim().is_empty() => Some((cut(k, 200), cut(t, size))),
                _ => None,
            })
            .collect()
    };
    let formulas: Vec<(String, String)> =
        strs(get("formulas"), MAX_CALC, MAX_LEN).into_iter().filter(|(_, x)| !x.trim().is_empty()).collect();
    // 設備ごとの式（Python の clean_calc の equips）: 同じ設備名は後ろの値・先の場所（json.loads の dict）。200 台まで
    let mut seen: Vec<(String, &Item)> = vec![];
    if let Some(Item::Map(m)) = get("equips") {
        for (k, x) in m {
            put(&mut seen, k.clone(), x);
        }
    }
    let mut equips: Vec<(String, Calc)> = vec![];
    for (k, x) in seen.into_iter().take(MAX_CALC_EQUIPS) {
        let Item::Map(sub) = x else { continue };
        if k.trim().is_empty() {
            continue;
        }
        let pick = |key: &str| sub.iter().rev().find(|(n, _)| n == key).map(|(_, v)| v);
        let f: Vec<(String, String)> =
            strs(pick("formulas"), MAX_CALC, MAX_LEN).into_iter().filter(|(_, x)| !x.trim().is_empty()).collect();
        if !f.is_empty() {
            put(&mut equips, cut(&k, 200), Calc { formulas: f, names: strs(pick("names"), 400, 200), equips: vec![] });
        }
    }
    if formulas.is_empty() && equips.is_empty() {
        return None;
    }
    Some(Calc { formulas, names: strs(get("names"), 400, 200), equips })
}

/// 表示列の設定の式と表示名 → 計算列を値にする。画面（lotlist-columns.js の baseRow）と同じ引き方:
/// [名前] は元の列 → 表示名 → 式を持つ列（その式を元の値で 1 段だけ計算）。計算列＝表に無い列の式
pub struct CalcColumns {
    cols: HashSet<String>,
    names_rev: HashMap<String, String>,
    compiled: Vec<(String, Option<Formula>)>,
    pub calcs: Vec<String>,
}

impl CalcColumns {
    pub fn new(calc: &Calc, table_columns: &[String]) -> CalcColumns {
        let cols: HashSet<String> = table_columns.iter().cloned().collect();
        let names_rev = calc.names.iter().filter(|(_, v)| !v.is_empty()).map(|(k, v)| (v.clone(), k.clone())).collect();
        let compiled: Vec<(String, Option<Formula>)> = calc
            .formulas
            .iter()
            .take(MAX_CALC)
            .filter(|(_, v)| !v.trim().is_empty())
            .map(|(k, v)| (k.clone(), Formula::compile(v).ok()))
            .collect();
        let calcs = compiled.iter().filter(|(k, _)| !cols.contains(k)).map(|(k, _)| k.clone()).collect();
        CalcColumns { cols, names_rev, compiled, calcs }
    }
    fn key(&self, name: &str) -> String {
        if self.cols.contains(name) {
            name.to_string()
        } else {
            self.names_rev.get(name).cloned().unwrap_or_else(|| name.to_string())
        }
    }
    fn formula(&self, name: &str) -> Option<&Option<Formula>> {
        self.compiled.iter().find(|(k, _)| k == name).map(|(_, f)| f)
    }
    /// 読めない計算列か
    pub fn broken(&self, name: &str) -> bool {
        matches!(self.formula(name), Some(None))
    }
    /// 計算列 name が読む表の列（表示名・ほかの式の列を 1 段たどる）。並びは決まった順
    pub fn raw_deps(&self, name: &str) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let Some(Some(f)) = self.formula(name) else { return out };
        for c in &f.columns {
            let k = self.key(c);
            let sub = if k != name { self.formula(&k).and_then(|x| x.as_ref()) } else { None };
            let ds: Vec<String> = sub.map(|s| s.columns.clone()).unwrap_or_else(|| vec![k.clone()]);
            for d in ds {
                if self.cols.contains(&d) && !out.contains(&d) {
                    out.push(d);
                }
            }
        }
        out
    }
    /// 計算列 name の値（読む列の値を raw_deps の並びで渡す）
    pub fn value(&self, name: &str, deps: &[String], vals: &[V], tables: &Tables) -> V {
        let Some(Some(f)) = self.formula(name) else { return V::Null };
        let raw: HashMap<&str, &V> = deps.iter().map(String::as_str).zip(vals.iter()).collect();
        let plain = |c: &str| raw.get(c).map(|v| (*v).clone()).unwrap_or(V::Null);
        let look = |c: &str| -> V {
            let k = self.key(c);
            if k == name {
                return plain(&k);
            }
            match self.formula(&k) {
                Some(Some(sub)) => sub.run(&plain, tables),
                _ => plain(&k),
            }
        };
        f.run(&look, tables)
    }
}

/// SQLite の値の組を覚える鍵（同じ値の組の答えは使い回す）
#[derive(Hash, PartialEq, Eq)]
enum Key {
    Null,
    Int(i64),
    Real(u64),
    Bytes(Vec<u8>),
}

fn key_of(v: rusqlite::types::ValueRef<'_>) -> Key {
    use rusqlite::types::ValueRef as Q;
    match v {
        Q::Null => Key::Null,
        Q::Integer(i) => Key::Int(i),
        Q::Real(f) => Key::Real(f.to_bits()),
        Q::Text(b) | Q::Blob(b) => Key::Bytes(b.to_vec()),
    }
}

/// 覚える値の組の数の上限（Python の register と同じ）
const MEMO_MAX: usize = 200_000;

/// 計算列を接続に SQLite の関数として登録する → 計算列の名前 → SQL の式（Python の formula.register と同じ）。
/// 読めない計算列は入れない（並べ替えから外れる）。qi は列名を括る関数
pub fn register(
    c: &rusqlite::Connection,
    calc: &Calc,
    table_columns: &[String],
    tables: &Arc<Tables>,
    qi: fn(&str) -> String,
) -> rusqlite::Result<HashMap<String, String>> {
    use rusqlite::functions::FunctionFlags;
    let cc = Arc::new(CalcColumns::new(calc, table_columns));
    let mut exprs = HashMap::new();
    for (i, name) in cc.calcs.iter().enumerate() {
        if cc.broken(name) {
            continue;
        }
        let deps = cc.raw_deps(name);
        let (cc2, tables, name2, deps2) = (cc.clone(), tables.clone(), name.clone(), deps.clone());
        let memo: RefCell<HashMap<Vec<Key>, rusqlite::types::Value>> = RefCell::new(HashMap::new());
        let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
        let fname = format!("TpaCalc{i}");
        c.create_scalar_function(fname.as_str(), deps.len() as i32, flags, move |ctx| {
            let key: Vec<Key> = (0..ctx.len()).map(|k| key_of(ctx.get_raw(k))).collect();
            if let Some(hit) = memo.borrow().get(&key) {
                return Ok(hit.clone());
            }
            let vals: Vec<V> = (0..ctx.len()).map(|k| from_sql(ctx.get_raw(k))).collect();
            let out = sql_value(&cc2.value(&name2, &deps2, &vals, &tables));
            let mut m = memo.borrow_mut();
            if m.len() > MEMO_MAX {
                m.clear();
            }
            m.insert(key, out.clone());
            Ok(out)
        })?;
        exprs.insert(name.clone(), format!("TpaCalc{i}({})", deps.iter().map(|d| qi(d)).collect::<Vec<_>>().join(", ")));
    }
    Ok(exprs)
}

/// 式の答え → SQLite に返す値（整数に読める実数は整数: 字にしたとき JavaScript と同じ「1」になる）
pub fn sql_value(v: &V) -> rusqlite::types::Value {
    use rusqlite::types::Value as Q;
    match v {
        V::Null => Q::Null,
        V::Num(f) if !f.is_finite() => Q::Text(js_num_text(*f)),
        V::Num(f) if f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0 => Q::Integer(*f as i64),
        V::Num(f) => Q::Real(*f),
        V::Str(s) => Q::Text(lossy(s)),
    }
}

/// SQLite の値 → 式の値（Python の sqlite3 と同じ: バイナリは UTF-8 として読む）
pub fn from_sql(v: rusqlite::types::ValueRef<'_>) -> V {
    use rusqlite::types::ValueRef as Q;
    match v {
        Q::Null => V::Null,
        Q::Integer(i) => V::Num(i as f64),
        Q::Real(f) => V::Num(f),
        Q::Text(b) | Q::Blob(b) => V::text(&String::from_utf8_lossy(b)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(src: &str, row: &[(&str, V)]) -> V {
        let f = Formula::compile(src).unwrap_or_else(|e| panic!("{src}: {}", e.message()));
        f.run(&|c| row.iter().find(|(k, _)| *k == c).map(|x| x.1.clone()).unwrap_or(V::Null), &Tables::default())
    }

    #[test]
    fn numbers_are_written_like_javascript() {
        for (f, s) in [
            (0.1 + 0.2, "0.30000000000000004"),
            (1e21, "1e+21"),
            (1e-7, "1e-7"),
            (123456789012.0, "123456789012"),
            (-0.0, "0"),
            (2.5, "2.5"),
            (0.000001, "0.000001"),
        ] {
            assert_eq!(js_num_text(f), s);
        }
    }

    #[test]
    fn utf16_units_like_javascript() {
        assert_eq!(run("len('😀x')", &[]), V::Num(3.0));
        assert_eq!(run("left('😀x', 1)", &[]), V::Str(vec![0xd83d].into()), "片割れのサロゲートもそのまま持つ");
        assert_eq!(run("extract('１２３', '\\d+')", &[]), V::text(""), "\\d は半角の数字だけ");
    }

    #[test]
    fn calc_columns_follow_names_and_other_formulas() {
        let calc = Calc {
            formulas: vec![
                ("区分".into(), "if([板厚(表示)] > 1, '厚', '薄')".into()),
                ("倍".into(), "[重量] * 2".into()),
                ("倍の倍".into(), "[倍] * 2".into()),
                ("重量".into(), "[重量] + 1".into()),
                ("自分".into(), "[自分]".into()),
            ],
            names: vec![("板厚".into(), "板厚(表示)".into())],
            ..Default::default()
        };
        let t = Tables::default();
        let cc = CalcColumns::new(&calc, &["板厚".into(), "重量".into()]);
        assert_eq!(cc.calcs, ["区分", "倍", "倍の倍", "自分"], "表に無い列の式だけが計算列");
        assert_eq!(cc.raw_deps("区分"), ["板厚"]);
        assert_eq!(cc.value("区分", &cc.raw_deps("区分"), &[V::Num(2.0)], &t), V::text("厚"), "表示名で書いても元の列を読む");
        assert_eq!(cc.value("倍の倍", &["重量".into()], &[V::Num(10.0)], &t), V::Num(40.0), "計算列から計算列は元の値で 1 段");
        assert_eq!(
            cc.value("倍", &["重量".into()], &[V::Num(10.0)], &t),
            V::Num(22.0),
            "表にある列の式は、計算列の中で [その列] と書くと効く"
        );
        assert_eq!(cc.value("自分", &[], &[], &t), V::Null);
        assert_eq!(sql_value(&V::Num(3.0)), rusqlite::types::Value::Integer(3), "整数に読める答えは整数");
    }

    #[test]
    fn calc_keeps_the_order_it_was_sent_in() {
        let c = clean_calc(r#"{"formulas": {"b": "1", "a": "2", "空": " "}, "names": {"y": "表示", "x": "表示"}}"#).unwrap();
        assert_eq!(c.formulas.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), ["b", "a"], "送られた順・空の式は外す");
        let cc = CalcColumns::new(&c, &["x".into(), "y".into()]);
        assert_eq!(cc.key("表示"), "x", "同じ表示名は後ろの列（Python の dict と同じ後勝ち）");
        assert_eq!(clean_calc("[1]"), None);
        assert_eq!(clean_calc(r#"{"formulas": {"a": 1}}"#), None, "式が字でなければ無い");
    }

    #[test]
    fn deep_nesting_is_refused_without_overflow() {
        let src = format!("{}1{}", "(".repeat(900), ")".repeat(900));
        assert_eq!(Formula::compile(&src).err().map(|e| e.message()), Some("式の入れ子が深すぎます".into()));
    }
}
