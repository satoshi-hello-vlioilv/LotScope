//! JSON の列の展開（版 3.120.0。利用者の依頼 2026-11-17「６）JSONデータ列に対応してほしい」）。
//!
//! 列の中の JSON（例 {"ANF":0.365,"DL2":1}＝設備ごとの加重平均通過回数）を、形に合う分け方で行・列に分けた表を作る。
//! 決め事は人の事例の表 program/tests/fixtures/json_expand_cases.json（cargo test --test json_expand_cases が突き合わせる）。
//!
//! - 5 つの標準の形: ① dict 名前→値（鍵ごとに行へ・鍵と値の 2 列）・② list 値の並び（要素ごとに行へ・値の 1 列）・
//!   ③ rows 表の並び（要素ごとに行へ・中の名前が列に）・④ nest 入れ子の辞書（平らにして列を足す〈寸法.幅〉・行は増えない）・
//!   ⑤ dictrows 名前→表（鍵ごとに行へ・中を列に）
//! - 見分け（detect）: 先頭の行（呼ぶ側が 500 行まで渡す）の形ごとの行の数を数え、いちばん合う形を勧める
//! - 合わない行（空・壊れた JSON・違う形）は捨てずに 1 行のまま残し（足した列は空）、数と理由と例を返す
//! - 道筋（path。「寸法.幅」）: 深い入れ子は、先にその道筋の中へ降りてから分ける
//!
//! JSON は自前で読む（鍵の順を保つ・同じ鍵は後ろの値を前の位置に・i64 に入らない整数は桁の字のまま・壊れた理由を言う）。
//! 分けた表は join.rs の結合した表と同じく、作業場所の db_cache/expands に 1 つの SQLite のファイルとして組み（元の写しが替わったときだけ組み直す）、
//! 一覧・集計表・ダッシュボード・計算列は今の道（lists.rs の段取りが読むファイルを替える）でふつうの列として読む。

use crate::join::{py_dumps, ro_uri};
use crate::lotlist::qi;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// 見分けに読む先頭の行の数
pub const PROBE_ROWS: usize = 500;
/// 合わない行の例の数（種類ごと）
pub const EXAMPLES: usize = 3;
/// 例の字の長さ
const SNIPPET: usize = 40;
/// 入れ子の深さの上限（これより深い JSON は読めない形）
const DEPTH: usize = 200;

// ------------------------------------------------------------------ JSON の値

/// 読んだ JSON（鍵の順を保つ）
#[derive(Debug, Clone, PartialEq)]
pub enum J {
    Null,
    Bool(bool),
    Int(i64),
    /// i64 に入らない整数・有限でない小数（桁の字のまま）
    Big(String),
    Num(f64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

/// 読めなかった理由
#[derive(Debug, Clone, PartialEq)]
pub enum ParseErr {
    /// 途中で切れている
    Eof,
    /// 引用符が '（at は字の位置）
    Quote(usize),
    /// そのほか（at は字の位置）
    Bad(usize),
}

struct P<'a> {
    s: &'a str,
    b: &'a [u8],
    i: usize,
    depth: usize,
}

impl<'a> P<'a> {
    fn ws(&mut self) {
        while self.i < self.b.len() && matches!(self.b[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }
    fn char_at(&self) -> usize {
        self.s[..self.i.min(self.s.len())].chars().count() + 1
    }
    fn bad(&self) -> ParseErr {
        if self.i >= self.b.len() {
            ParseErr::Eof
        } else if self.b[self.i] == b'\'' {
            ParseErr::Quote(self.char_at())
        } else {
            ParseErr::Bad(self.char_at())
        }
    }
    fn lit(&mut self, word: &str, v: J) -> Result<J, ParseErr> {
        let w = word.as_bytes();
        for (k, c) in w.iter().enumerate() {
            match self.b.get(self.i + k) {
                None => {
                    self.i += k;
                    return Err(ParseErr::Eof);
                }
                Some(x) if x == c => {}
                Some(_) => {
                    self.i += k;
                    return Err(self.bad());
                }
            }
        }
        self.i += w.len();
        Ok(v)
    }
    fn value(&mut self) -> Result<J, ParseErr> {
        self.ws();
        let Some(&c) = self.b.get(self.i) else { return Err(ParseErr::Eof) };
        match c {
            b'{' => self.obj(),
            b'[' => self.arr(),
            b'"' => self.string().map(J::Str),
            b't' => self.lit("true", J::Bool(true)),
            b'f' => self.lit("false", J::Bool(false)),
            b'n' => self.lit("null", J::Null),
            b'-' | b'0'..=b'9' => self.number(),
            _ => Err(self.bad()),
        }
    }
    fn deeper(&mut self) -> Result<(), ParseErr> {
        self.depth += 1;
        if self.depth > DEPTH {
            return Err(ParseErr::Bad(self.char_at()));
        }
        Ok(())
    }
    fn obj(&mut self) -> Result<J, ParseErr> {
        self.deeper()?;
        self.i += 1;
        let mut out: Vec<(String, J)> = vec![];
        self.ws();
        if self.b.get(self.i) == Some(&b'}') {
            self.i += 1;
            self.depth -= 1;
            return Ok(J::Obj(out));
        }
        loop {
            self.ws();
            match self.b.get(self.i) {
                None => return Err(ParseErr::Eof),
                Some(b'"') => {}
                Some(_) => return Err(self.bad()),
            }
            let k = self.string()?;
            self.ws();
            match self.b.get(self.i) {
                None => return Err(ParseErr::Eof),
                Some(b':') => self.i += 1,
                Some(_) => return Err(self.bad()),
            }
            let v = self.value()?;
            // 同じ鍵は後ろの値を前の位置に（Python の dict と同じ）
            match out.iter_mut().find(|(n, _)| *n == k) {
                Some(slot) => slot.1 = v,
                None => out.push((k, v)),
            }
            self.ws();
            match self.b.get(self.i) {
                None => return Err(ParseErr::Eof),
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    self.depth -= 1;
                    return Ok(J::Obj(out));
                }
                Some(_) => return Err(self.bad()),
            }
        }
    }
    fn arr(&mut self) -> Result<J, ParseErr> {
        self.deeper()?;
        self.i += 1;
        let mut out = vec![];
        self.ws();
        if self.b.get(self.i) == Some(&b']') {
            self.i += 1;
            self.depth -= 1;
            return Ok(J::Arr(out));
        }
        loop {
            out.push(self.value()?);
            self.ws();
            match self.b.get(self.i) {
                None => return Err(ParseErr::Eof),
                Some(b',') => self.i += 1,
                Some(b']') => {
                    self.i += 1;
                    self.depth -= 1;
                    return Ok(J::Arr(out));
                }
                Some(_) => return Err(self.bad()),
            }
        }
    }
    fn hex4(&mut self) -> Result<u32, ParseErr> {
        let mut n = 0u32;
        for _ in 0..4 {
            let Some(&c) = self.b.get(self.i) else { return Err(ParseErr::Eof) };
            let d = (c as char).to_digit(16).ok_or_else(|| self.bad())?;
            n = n * 16 + d;
            self.i += 1;
        }
        Ok(n)
    }
    fn string(&mut self) -> Result<String, ParseErr> {
        self.i += 1; // "
        let mut out = String::new();
        loop {
            let start = self.i;
            while self.i < self.b.len() && self.b[self.i] != b'"' && self.b[self.i] != b'\\' && self.b[self.i] >= 0x20 {
                self.i += 1;
            }
            out.push_str(&self.s[start..self.i]);
            let Some(&c) = self.b.get(self.i) else { return Err(ParseErr::Eof) };
            match c {
                b'"' => {
                    self.i += 1;
                    return Ok(out);
                }
                b'\\' => {
                    self.i += 1;
                    let Some(&e) = self.b.get(self.i) else { return Err(ParseErr::Eof) };
                    self.i += 1;
                    match e {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let hi = self.hex4()?;
                            let ch = if (0xD800..0xDC00).contains(&hi)
                                && self.b.get(self.i) == Some(&b'\\')
                                && self.b.get(self.i + 1) == Some(&b'u')
                            {
                                let save = self.i;
                                self.i += 2;
                                let lo = self.hex4()?;
                                if (0xDC00..0xE000).contains(&lo) {
                                    char::from_u32(0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00))
                                } else {
                                    self.i = save;
                                    None
                                }
                            } else {
                                char::from_u32(hi)
                            };
                            // 片割れの代用字は置き換えの字
                            out.push(ch.unwrap_or('\u{FFFD}'));
                        }
                        _ => {
                            self.i -= 1;
                            return Err(ParseErr::Bad(self.char_at()));
                        }
                    }
                }
                _ => return Err(ParseErr::Bad(self.char_at())), // 逃がしていない制御の字
            }
        }
    }
    fn number(&mut self) -> Result<J, ParseErr> {
        let start = self.i;
        if self.b[self.i] == b'-' {
            self.i += 1;
        }
        let digits = |p: &mut P| {
            let s = p.i;
            while p.i < p.b.len() && p.b[p.i].is_ascii_digit() {
                p.i += 1;
            }
            p.i - s
        };
        let first = self.b.get(self.i).copied();
        let n = digits(self);
        if n == 0 {
            return Err(if self.i >= self.b.len() { ParseErr::Eof } else { self.bad() });
        }
        if first == Some(b'0') && n > 1 {
            return Err(ParseErr::Bad(self.char_at()));
        }
        let mut float = false;
        if self.b.get(self.i) == Some(&b'.') {
            self.i += 1;
            float = true;
            if digits(self) == 0 {
                return Err(if self.i >= self.b.len() { ParseErr::Eof } else { self.bad() });
            }
        }
        if matches!(self.b.get(self.i), Some(b'e' | b'E')) {
            self.i += 1;
            float = true;
            if matches!(self.b.get(self.i), Some(b'+' | b'-')) {
                self.i += 1;
            }
            if digits(self) == 0 {
                return Err(if self.i >= self.b.len() { ParseErr::Eof } else { self.bad() });
            }
        }
        let text = &self.s[start..self.i];
        if !float {
            return Ok(text.parse::<i64>().map(J::Int).unwrap_or_else(|_| J::Big(text.to_string())));
        }
        match text.parse::<f64>() {
            Ok(f) if f.is_finite() => Ok(J::Num(f)),
            _ => Ok(J::Big(text.to_string())),
        }
    }
}

/// 字から読む（前後の JSON の空白は除く。後ろに余りがあれば読めない形）
pub fn parse(text: &str) -> Result<J, ParseErr> {
    let mut p = P { s: text, b: text.as_bytes(), i: 0, depth: 0 };
    let v = p.value()?;
    p.ws();
    if p.i < p.b.len() {
        return Err(p.bad());
    }
    Ok(v)
}

impl J {
    fn container(&self) -> bool {
        matches!(self, J::Arr(_) | J::Obj(_))
    }

    /// 詰めた JSON の字（鍵の順のまま・区切りに空白なし・日本語はそのまま）
    pub fn compact(&self) -> String {
        match self {
            J::Null => "null".into(),
            J::Bool(b) => b.to_string(),
            J::Int(i) => i.to_string(),
            J::Big(s) => s.clone(),
            J::Num(f) => crate::pyfmt::float_repr(*f),
            J::Str(s) => py_dumps(&Value::String(s.clone())),
            J::Arr(a) => format!("[{}]", a.iter().map(J::compact).collect::<Vec<_>>().join(",")),
            J::Obj(o) => format!(
                "{{{}}}",
                o.iter().map(|(k, v)| format!("{}:{}", py_dumps(&Value::String(k.clone())), v.compact())).collect::<Vec<_>>().join(",")
            ),
        }
    }

    /// 表のセルの値（真偽は 1・0・i64 に入らない整数は桁の字・入れ子は詰めた JSON の字）
    pub fn out(&self) -> Out {
        match self {
            J::Null => Out::Null,
            J::Bool(b) => Out::Int(i64::from(*b)),
            J::Int(i) => Out::Int(*i),
            J::Big(s) => Out::Text(s.clone()),
            J::Num(f) => Out::Real(*f),
            J::Str(s) => Out::Text(s.clone()),
            J::Arr(_) | J::Obj(_) => Out::Text(self.compact()),
        }
    }
}

/// 分けた表のセルの値
#[derive(Debug, Clone, PartialEq)]
pub enum Out {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
}

impl Out {
    pub fn json(&self) -> Value {
        match self {
            Out::Null => Value::Null,
            Out::Int(i) => json!(i),
            Out::Real(f) => serde_json::Number::from_f64(*f).map(Value::Number).unwrap_or(Value::Null),
            Out::Text(s) => json!(s),
        }
    }
    fn sql(&self) -> SqlValue {
        match self {
            Out::Null => SqlValue::Null,
            Out::Int(i) => SqlValue::Integer(*i),
            Out::Real(f) => SqlValue::Real(*f),
            Out::Text(s) => SqlValue::Text(s.clone()),
        }
    }
}

// ------------------------------------------------------------------ 形

/// 5 つの標準の形
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shape {
    Dict,
    List,
    Rows,
    Nest,
    DictRows,
}

pub const SHAPES: [Shape; 5] = [Shape::Dict, Shape::List, Shape::Rows, Shape::Nest, Shape::DictRows];

impl Shape {
    pub fn key(self) -> &'static str {
        match self {
            Shape::Dict => "dict",
            Shape::List => "list",
            Shape::Rows => "rows",
            Shape::Nest => "nest",
            Shape::DictRows => "dictrows",
        }
    }
    pub fn of(key: &str) -> Option<Shape> {
        SHAPES.iter().copied().find(|s| s.key() == key)
    }
    pub fn name(self) -> &'static str {
        match self {
            Shape::Dict => "① 名前→値",
            Shape::List => "② 値の並び",
            Shape::Rows => "③ 表の並び",
            Shape::Nest => "④ 入れ子の辞書",
            Shape::DictRows => "⑤ 名前→表",
        }
    }
    fn index(self) -> usize {
        SHAPES.iter().position(|s| *s == self).unwrap_or(0)
    }
}

/// 値の形（"dict"・"list"・"rows"・"nest"・"dictrows"・"mixed"〈値と表の混ざった並び〉・"scalar"〈1 つの値〉）
pub fn shape_of(j: &J) -> &'static str {
    match j {
        J::Obj(o) if o.iter().all(|(_, v)| !v.container()) => "dict",
        J::Obj(o) if o.iter().all(|(_, v)| matches!(v, J::Obj(_))) => "dictrows",
        J::Obj(_) => "nest",
        J::Arr(a) if a.iter().all(|v| !v.container()) => "list",
        J::Arr(a) if a.iter().all(|v| matches!(v, J::Obj(_))) => "rows",
        J::Arr(_) => "mixed",
        _ => "scalar",
    }
}

/// 形の言葉（違う形の理由）
pub fn shape_word(k: &str) -> &'static str {
    match k {
        "dict" => "① 名前→値",
        "list" => "② 値の並び",
        "rows" => "③ 表の並び",
        "nest" => "④ 入れ子の辞書",
        "dictrows" => "⑤ 名前→表",
        "mixed" => "値と表の混ざった並び",
        _ => "1 つの値",
    }
}

/// その形で分けられるか（④ は辞書なら何でも平らにできる）
pub fn fits(j: &J, s: Shape) -> bool {
    match s {
        Shape::Nest => matches!(j, J::Obj(_)),
        _ => shape_of(j) == s.key(),
    }
}

/// 表のセル（元の表の 1 つの値）
#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
    Blob,
}

impl Cell {
    pub fn from_ref(v: ValueRef<'_>) -> Cell {
        match v {
            ValueRef::Null => Cell::Null,
            ValueRef::Integer(i) => Cell::Int(i),
            ValueRef::Real(f) => Cell::Real(f),
            ValueRef::Text(t) => Cell::Text(String::from_utf8_lossy(t).into_owned()),
            ValueRef::Blob(_) => Cell::Blob,
        }
    }
    /// 事例の表の値（null・数・字）
    pub fn from_json(v: &Value) -> Cell {
        match v {
            Value::Null => Cell::Null,
            Value::Number(n) if n.is_i64() => Cell::Int(n.as_i64().unwrap_or(0)),
            Value::Number(n) => Cell::Real(n.as_f64().unwrap_or(0.0)),
            Value::String(s) => Cell::Text(s.clone()),
            _ => Cell::Blob,
        }
    }
    fn text(&self) -> String {
        match self {
            Cell::Null => String::new(),
            Cell::Int(i) => i.to_string(),
            Cell::Real(f) => crate::pyfmt::float_repr(*f),
            Cell::Text(t) => t.clone(),
            Cell::Blob => "（バイナリ）".into(),
        }
    }
}

/// セルを読んだ結果
#[derive(Debug, Clone, PartialEq)]
pub enum Read {
    /// 空（NULL・空白だけ・null・{}・[]）
    Empty,
    /// 壊れた JSON（理由）
    Broken(String),
    /// JSON の入れ物でない値（1 つの値・JSON でない字。理由）
    Other(String),
    /// 読めた入れ物（辞書・並び）
    Value(J),
}

fn blank(s: &str) -> &str {
    crate::pyfmt::strip(s.trim_start_matches('\u{feff}'))
}

/// セルが JSON の入れ物に見えるか（前後の空白を除いて { か [ で始まる）
pub fn looks_json(c: &Cell) -> bool {
    matches!(c, Cell::Text(t) if matches!(blank(t).chars().next(), Some('{' | '[')))
}

/// 1 つのセルを読む
pub fn read(c: &Cell) -> Read {
    let t = match c {
        Cell::Null => return Read::Empty,
        Cell::Blob => return Read::Broken("字でない値（バイナリ）".into()),
        Cell::Int(_) | Cell::Real(_) => return Read::Other("1 つの値（数）".into()),
        Cell::Text(t) => blank(t),
    };
    if t.is_empty() {
        return Read::Empty;
    }
    let boxy = matches!(t.chars().next(), Some('{' | '['));
    match parse(t) {
        Ok(J::Null) => Read::Empty,
        Ok(J::Obj(o)) if o.is_empty() => Read::Empty,
        Ok(J::Arr(a)) if a.is_empty() => Read::Empty,
        Ok(j) if j.container() => Read::Value(j),
        Ok(_) => Read::Other("1 つの値".into()),
        Err(_) if !boxy => Read::Other("JSON でない字".into()),
        Err(ParseErr::Eof) => Read::Broken("閉じていない（途中で切れている）".into()),
        Err(ParseErr::Quote(_)) => Read::Broken("引用符が '（JSON は \"）".into()),
        Err(ParseErr::Bad(n)) => Read::Broken(format!("JSON として読めない（{n} 字目）")),
    }
}

/// 道筋（「寸法.幅」）の中へ降りる。空の道筋はそのまま。無ければ Err(理由)
pub fn descend(j: J, path: &str) -> Result<J, String> {
    if path.trim().is_empty() {
        return Ok(j);
    }
    let mut cur = j;
    for part in path.split('.') {
        let next = match &cur {
            J::Obj(o) => o.iter().find(|(k, _)| k == part).map(|(_, v)| v.clone()),
            J::Arr(a) => part.parse::<usize>().ok().and_then(|i| a.get(i).cloned()),
            _ => None,
        };
        match next {
            Some(n) => cur = n,
            None => return Err(format!("道筋「{path}」が無い")),
        }
    }
    Ok(cur)
}

/// 道筋を当てた後の読み（道筋の先が空なら空・入れ物でなければ違う形）
fn read_at(c: &Cell, path: &str) -> Read {
    match read(c) {
        Read::Value(j) => match descend(j, path) {
            Err(e) => Read::Other(e),
            Ok(J::Null) => Read::Empty,
            Ok(J::Obj(o)) if o.is_empty() => Read::Empty,
            Ok(J::Arr(a)) if a.is_empty() => Read::Empty,
            Ok(j) if j.container() => Read::Value(j),
            Ok(_) => Read::Other("道筋の先が 1 つの値".into()),
        },
        r => r,
    }
}

// ------------------------------------------------------------------ 見分け

/// 列の見分け（先頭の行）
#[derive(Debug, Clone, Default)]
pub struct Probe {
    pub total: usize,
    pub empty: usize,
    pub broken: usize,
    /// JSON の入れ物でない値（1 つの値・JSON でない字）
    pub scalar: usize,
    /// 形ごとに分けられる行の数（SHAPES の順）
    pub fit: [usize; 5],
    /// 勧める形（読めた入れ物が無ければ None）
    pub best: Option<Shape>,
    /// JSON の列に見えるか（空でない行の半分以上が { か [ で始まり、1 つ以上読めた）
    pub json: bool,
}

impl Probe {
    /// 勧める形で分けられない空でない行（壊れ・違う形）
    pub fn other(&self) -> usize {
        let fit = self.best.map(|b| self.fit[b.index()]).unwrap_or(0);
        self.total - self.empty - self.broken - fit
    }
    pub fn json(&self) -> Value {
        let fit: Map<String, Value> = SHAPES.iter().map(|s| (s.key().to_string(), json!(self.fit[s.index()]))).collect();
        json!({"total": self.total, "empty": self.empty, "broken": self.broken, "other": self.other(), "fit": fit,
               "best": self.best.map(Shape::key), "json": self.json})
    }
}

/// 先頭の行から形を数えて勧める。勧める順: ③ 表の並び → ② 値の並び → ⑤ 名前→表 → ① 名前→値 → ④ 入れ子の辞書 のうち、
/// 分けられる行がいちばん多い形の 9 割以上の最初の物。⑤ は、⑤ に合う行の 9 割以上が同じ鍵の組なら ④（行ごとに鍵の替わらない入れ子）
pub fn detect(cells: &[Cell], path: &str) -> Probe {
    let mut p = Probe { total: cells.len(), ..Probe::default() };
    let mut boxy = 0;
    let mut keysets: Vec<(Vec<String>, usize)> = vec![];
    let mut values = 0;
    for c in cells {
        if looks_json(c) {
            boxy += 1;
        }
        match read_at(c, path) {
            Read::Empty => p.empty += 1,
            Read::Broken(_) => p.broken += 1,
            Read::Other(_) => p.scalar += 1,
            Read::Value(j) => {
                values += 1;
                for s in SHAPES {
                    if fits(&j, s) {
                        p.fit[s.index()] += 1;
                    }
                }
                if let J::Obj(o) = &j {
                    if shape_of(&j) == "dictrows" {
                        let mut ks: Vec<String> = o.iter().map(|(k, _)| k.clone()).collect();
                        ks.sort();
                        match keysets.iter_mut().find(|(k, _)| *k == ks) {
                            Some(x) => x.1 += 1,
                            None => keysets.push((ks, 1)),
                        }
                    }
                }
            }
        }
    }
    let nonempty = p.total - p.empty;
    p.json = values > 0 && (boxy * 2 >= nonempty || !path.trim().is_empty());
    let max = *p.fit.iter().max().unwrap_or(&0);
    if max > 0 {
        for s in [Shape::Rows, Shape::List, Shape::DictRows, Shape::Dict, Shape::Nest] {
            let n = p.fit[s.index()];
            if n * 10 >= max * 9 {
                let same = keysets.iter().map(|x| x.1).max().unwrap_or(0);
                p.best = Some(if s == Shape::DictRows && same * 10 >= n * 9 { Shape::Nest } else { s });
                break;
            }
        }
    }
    p
}

// ------------------------------------------------------------------ 展開

/// 分け方
#[derive(Debug, Clone, PartialEq)]
pub struct Spec {
    /// JSON の列
    pub col: String,
    pub shape: Shape,
    /// 鍵の列の名前（① ⑤。空なら「鍵」）
    pub key: String,
    /// 値の列の名前（① ②。空なら「値」）
    pub value: String,
    /// 道筋（空なら列の値そのもの）
    pub path: String,
}

impl Spec {
    /// データ元の「展開」（{"列", "形", "鍵", "値", "道筋"} の字か表）→ Spec。読めなければ Err(言葉)
    pub fn parse(v: &Value) -> Result<Spec, String> {
        let v = match v {
            Value::String(s) if s.trim().is_empty() => return Err("展開の決まりが空です。".into()),
            Value::String(s) => serde_json::from_str::<Value>(s).map_err(|_| "展開の決まりが読めません。".to_string())?,
            other => other.clone(),
        };
        let s = |k: &str| v.get(k).and_then(Value::as_str).map(|x| crate::pyfmt::strip(x).to_string()).unwrap_or_default();
        let col = s("列");
        if col.is_empty() {
            return Err("展開する JSON の列を選んでください。".into());
        }
        let shape = Shape::of(&s("形")).ok_or_else(|| "分け方（① 〜 ⑤）を選んでください。".to_string())?;
        let (key, value) = (s("鍵"), s("値"));
        for n in [&key, &value] {
            if n.chars().count() > 40 {
                return Err("列の名前は 40 字までにしてください。".into());
            }
        }
        Ok(Spec { col, shape, key, value, path: s("道筋") })
    }

    /// 置く形（データ元の行の「展開」の字。鍵の順は決まった順）
    pub fn json(&self) -> Value {
        json!({"列": self.col, "形": self.shape.key(), "鍵": self.key, "値": self.value, "道筋": self.path})
    }

    fn key_name(&self) -> String {
        if self.key.is_empty() {
            "鍵".into()
        } else {
            self.key.clone()
        }
    }
    fn value_name(&self) -> String {
        if self.value.is_empty() {
            "値".into()
        } else {
            self.value.clone()
        }
    }
}

/// 合わない行の例
#[derive(Debug, Clone, PartialEq)]
pub struct Issue {
    /// 元の表の何行目か（1 から）
    pub row: usize,
    /// "broken"（壊れた JSON）・"other"（違う形）
    pub kind: &'static str,
    pub reason: String,
    /// 値の頭（40 字まで）
    pub text: String,
}

/// 展開の数
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Stats {
    /// 元の行
    pub rows: usize,
    /// 分けた元の行
    pub fit: usize,
    pub empty: usize,
    pub broken: usize,
    /// 違う形（その分け方に合わない入れ物・1 つの値・JSON でない字・道筋が無い）
    pub other: usize,
    /// 分けてできた行（分けた行＋そのまま残した行）
    pub out: usize,
    /// 値の列（① ②）の値のうち数でない字の数
    pub text: usize,
}

impl Stats {
    pub fn json(&self) -> Value {
        json!({"rows": self.rows, "fit": self.fit, "empty": self.empty, "broken": self.broken, "other": self.other,
               "out": self.out, "text": self.text})
    }
}

/// 分けた答え: 足す列の名前・元の行ごとの分けた行（合わない行は足す列が空の 1 行）・数・例
#[derive(Debug, Clone, Default)]
pub struct Expanded {
    pub cols: Vec<String>,
    pub rows: Vec<Vec<Vec<Out>>>,
    pub stats: Stats,
    pub issues: Vec<Issue>,
}

impl Expanded {
    pub fn issues_json(&self) -> Value {
        Value::Array(self.issues.iter().map(|i| json!({"row": i.row, "kind": i.kind, "reason": i.reason, "text": i.text})).collect())
    }
}

/// 平らにする（④ ⑤ の中）: 葉（入れ物でない値・空の入れ物・並び）を「親.子」の名前で
fn flatten(prefix: &str, j: &J, out: &mut Vec<(String, J)>) {
    match j {
        J::Obj(o) if !o.is_empty() => {
            for (k, v) in o {
                let name = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
                flatten(&name, v, out);
            }
        }
        _ => out.push((prefix.to_string(), j.clone())),
    }
}

fn snippet(c: &Cell) -> String {
    let t = c.text();
    let t = crate::pyfmt::strip(&t);
    let mut s: String = t.chars().take(SNIPPET).collect();
    if t.chars().count() > SNIPPET {
        s.push('…');
    }
    s
}

/// 分ける。cells は元の表の JSON の列の値（行の順）
pub fn expand(cells: &[Cell], spec: &Spec) -> Expanded {
    // 1 回目: 読む・形を確かめる・足す列の名前を集める（出てきた順）
    enum Got {
        Keep,
        Fit(J),
    }
    let mut got = Vec::with_capacity(cells.len());
    let mut st = Stats { rows: cells.len(), ..Stats::default() };
    let mut issues: Vec<Issue> = vec![];
    let mut seen_kind: HashMap<&'static str, usize> = HashMap::new();
    let mut note = |row: usize, kind: &'static str, reason: String, c: &Cell, issues: &mut Vec<Issue>| {
        let n = seen_kind.entry(kind).or_default();
        *n += 1;
        if *n <= EXAMPLES {
            issues.push(Issue { row, kind, reason, text: snippet(c) });
        }
    };
    let mut names: Vec<String> = vec![];
    let add = |names: &mut Vec<String>, n: &str| {
        if !names.iter().any(|x| x == n) {
            names.push(n.to_string());
        }
    };
    for (i, c) in cells.iter().enumerate() {
        match read_at(c, &spec.path) {
            Read::Empty => {
                st.empty += 1;
                got.push(Got::Keep);
            }
            Read::Broken(r) => {
                st.broken += 1;
                note(i + 1, "broken", r, c, &mut issues);
                got.push(Got::Keep);
            }
            Read::Other(r) => {
                st.other += 1;
                note(i + 1, "other", r, c, &mut issues);
                got.push(Got::Keep);
            }
            Read::Value(j) if !fits(&j, spec.shape) => {
                st.other += 1;
                note(i + 1, "other", format!("{}です", shape_word(shape_of(&j))), c, &mut issues);
                got.push(Got::Keep);
            }
            Read::Value(j) => {
                st.fit += 1;
                match (&j, spec.shape) {
                    (J::Arr(a), Shape::Rows) => {
                        for e in a {
                            if let J::Obj(o) = e {
                                for (k, _) in o {
                                    add(&mut names, k);
                                }
                            }
                        }
                    }
                    (J::Obj(_), Shape::Nest) => {
                        let mut f = vec![];
                        flatten("", &j, &mut f);
                        for (k, _) in &f {
                            add(&mut names, k);
                        }
                    }
                    (J::Obj(o), Shape::DictRows) => {
                        for (_, inner) in o {
                            let mut f = vec![];
                            flatten("", inner, &mut f);
                            for (k, _) in &f {
                                add(&mut names, k);
                            }
                        }
                    }
                    _ => {}
                }
                got.push(Got::Fit(j));
            }
        }
    }
    issues.sort_by_key(|x| (x.kind != "broken", x.row));
    let cols: Vec<String> = match spec.shape {
        Shape::Dict => vec![spec.key_name(), spec.value_name()],
        Shape::List => vec![spec.value_name()],
        Shape::Rows | Shape::Nest => names.clone(),
        Shape::DictRows => std::iter::once(spec.key_name()).chain(names.iter().cloned()).collect(),
    };
    let width = cols.len();
    let blank_row = || vec![Out::Null; width];
    let at = |n: &str| names.iter().position(|x| x == n);
    let mut rows = Vec::with_capacity(got.len());
    let mut text = 0;
    for g in got {
        let out: Vec<Vec<Out>> = match g {
            Got::Keep => vec![blank_row()],
            Got::Fit(j) => match (j, spec.shape) {
                (J::Obj(o), Shape::Dict) => o
                    .into_iter()
                    .map(|(k, v)| {
                        if matches!(v, J::Str(_)) {
                            text += 1;
                        }
                        vec![Out::Text(k), v.out()]
                    })
                    .collect(),
                (J::Arr(a), Shape::List) => a
                    .into_iter()
                    .map(|v| {
                        if matches!(v, J::Str(_)) {
                            text += 1;
                        }
                        vec![v.out()]
                    })
                    .collect(),
                (J::Arr(a), Shape::Rows) => a
                    .into_iter()
                    .map(|e| {
                        let mut r = blank_row();
                        if let J::Obj(o) = e {
                            for (k, v) in o {
                                if let Some(p) = at(&k) {
                                    r[p] = v.out();
                                }
                            }
                        }
                        r
                    })
                    .collect(),
                (j @ J::Obj(_), Shape::Nest) => {
                    let mut r = blank_row();
                    let mut f = vec![];
                    flatten("", &j, &mut f);
                    for (k, v) in f {
                        if let Some(p) = at(&k) {
                            r[p] = v.out();
                        }
                    }
                    vec![r]
                }
                (J::Obj(o), Shape::DictRows) => o
                    .into_iter()
                    .map(|(k, inner)| {
                        let mut r = blank_row();
                        r[0] = Out::Text(k);
                        let mut f = vec![];
                        flatten("", &inner, &mut f);
                        for (n, v) in f {
                            if let Some(p) = at(&n) {
                                r[p + 1] = v.out();
                            }
                        }
                        r
                    })
                    .collect(),
                _ => vec![blank_row()],
            },
        };
        st.out += out.len();
        rows.push(out);
    }
    st.text = text;
    Expanded { cols, rows, stats: st, issues }
}

/// 足す列の名前を元の表の列とぶつからない名前にする（SQLite は ASCII の大小を同じ名前とみなす）: ぶつかれば「JSON の列.名前」、
/// それでもぶつかれば後ろに _2・_3 …
pub fn final_names(base: &[String], new: &[String], json_col: &str) -> Vec<String> {
    let low = |s: &str| s.to_ascii_lowercase();
    let mut taken: Vec<String> = base.iter().map(|s| low(s)).collect();
    let mut out = vec![];
    for n in new {
        let n = if n.is_empty() { "値".to_string() } else { n.clone() };
        let mut name = n.clone();
        if taken.contains(&low(&name)) {
            name = format!("{json_col}.{n}");
        }
        let stem = name.clone();
        let mut k = 2;
        while taken.contains(&low(&name)) {
            name = format!("{stem}_{k}");
            k += 1;
        }
        taken.push(low(&name));
        out.push(name);
    }
    out
}

// ------------------------------------------------------------------ 元の表を読む・組む

/// 表の列の名前
pub fn columns(c: &Connection, schema: &str, table: &str) -> rusqlite::Result<Vec<String>> {
    let mut st = c.prepare(&format!("PRAGMA {schema}.table_info({})", qi(table)))?;
    let rows = st.query_map([], |r| r.get::<_, String>(1))?;
    rows.collect()
}

/// 元の表（読むだけ）の列と行（limit が Some なら先頭のその行まで）
pub fn read_table(path: &Path, table: &str, limit: Option<usize>) -> Result<(Vec<String>, Vec<Vec<SqlValue>>), String> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI;
    let c = Connection::open_with_flags(ro_uri(path), flags).map_err(|e| e.to_string())?;
    let _ = c.busy_timeout(std::time::Duration::from_secs(30));
    let cols = columns(&c, "main", table).map_err(|e| e.to_string())?;
    if cols.is_empty() {
        return Err(format!("表「{table}」が見つかりません。"));
    }
    let lim = limit.map(|n| format!(" LIMIT {n}")).unwrap_or_default();
    let mut st = c.prepare(&format!("SELECT * FROM {}{lim}", qi(table))).map_err(|e| e.to_string())?;
    let n = cols.len();
    let rows = st
        .query_map([], |r| (0..n).map(|i| r.get::<_, SqlValue>(i)).collect::<rusqlite::Result<Vec<_>>>())
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok((cols, rows))
}

pub fn cell_of(v: &SqlValue) -> Cell {
    match v {
        SqlValue::Null => Cell::Null,
        SqlValue::Integer(i) => Cell::Int(*i),
        SqlValue::Real(f) => Cell::Real(*f),
        SqlValue::Text(t) => Cell::Text(t.clone()),
        SqlValue::Blob(_) => Cell::Blob,
    }
}

/// 分けた表を dest（.sqlite3）に組む → 数（stats・cols〈足した列の名前〉・issues）。組み終えてから置き換える
pub fn build(dest: &Path, base: &Path, table: &str, spec: &Spec) -> Result<Value, String> {
    let (bcols, brows) = read_table(base, table, None)?;
    let Some(ci) = bcols.iter().position(|c| *c == spec.col) else {
        return Err(format!("列「{}」が見つかりません。", spec.col));
    };
    let cells: Vec<Cell> = brows.iter().map(|r| cell_of(&r[ci])).collect();
    let ex = expand(&cells, spec);
    let names = final_names(&bcols, &ex.cols, &spec.col);
    if let Some(d) = dest.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let stem = dest.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dest.with_file_name(format!("{stem}.{}.{nanos}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    let run = || -> rusqlite::Result<()> {
        let mut c = Connection::open(&tmp)?;
        c.execute_batch("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")?;
        let all: Vec<String> = bcols.iter().chain(names.iter()).map(|c| qi(c)).collect();
        c.execute_batch(&format!("CREATE TABLE main.{} ({})", qi(table), all.join(", ")))?;
        let tx = c.transaction()?;
        {
            let marks = vec!["?"; all.len()].join(", ");
            let mut ins = tx.prepare(&format!("INSERT INTO main.{} VALUES ({marks})", qi(table)))?;
            for (base_row, outs) in brows.iter().zip(&ex.rows) {
                for o in outs {
                    let vals: Vec<SqlValue> = base_row.iter().cloned().chain(o.iter().map(Out::sql)).collect();
                    ins.execute(rusqlite::params_from_iter(vals))?;
                }
            }
        }
        tx.commit()
    };
    if let Err(e) = run() {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("分けた表を組めませんでした: {e}"));
    }
    std::fs::rename(&tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("分けた表のファイルを置き換えられませんでした: {e}")
    })?;
    Ok(json!({"stats": ex.stats.json(), "cols": names, "issues": ex.issues_json(), "shape": spec.shape.key()}))
}

fn stamp(path: &Path) -> Value {
    match std::fs::metadata(path) {
        Ok(m) => {
            let ns = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos() as u64);
            json!([path.display().to_string(), m.len(), ns])
        }
        Err(_) => json!([path.display().to_string(), null, null]),
    }
}

/// 分けた表のファイルの係（db_cache/expands。join.rs の Joiner と同じ形: 元の写しの大きさ・時刻と決まりが同じなら組み直さない）
pub struct Expander {
    root: PathBuf,
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl Expander {
    pub fn new(root: PathBuf) -> Expander {
        Expander { root, locks: Mutex::default() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 分けた表のファイル（無い・古ければ組む）→ (ファイル, 数)
    pub fn path_for(&self, key: &str, base: &Path, table: &str, spec: &Spec) -> Result<(PathBuf, Value), String> {
        let id = json!({"base": [base.display().to_string(), table], "spec": spec.json()});
        let hash = Sha256::digest(py_dumps(&id).as_bytes());
        let name = format!("{key}_{}", hash.iter().take(6).map(|b| format!("{b:02x}")).collect::<String>());
        let dest = self.root.join(format!("{name}.sqlite3"));
        let meta = self.root.join(format!("{name}.json"));
        let want = stamp(base);
        let lock = self.locks.lock().unwrap().entry(name.clone()).or_default().clone();
        let _one = lock.lock().unwrap_or_else(|e| e.into_inner());
        let had: Value = std::fs::read(&meta).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
        if dest.exists() && had["stamp"] == want {
            return Ok((dest, had.get("stats").cloned().unwrap_or(Value::Null)));
        }
        let t0 = Instant::now();
        let stats = build(&dest, base, table, spec)?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0);
        let info = json!({"stamp": want, "stats": stats, "builtAt": now, "seconds": (t0.elapsed().as_secs_f64() * 1000.0).round() / 1000.0,
                          "spec": spec.json()});
        let _ = std::fs::write(&meta, serde_json::to_vec(&info).unwrap_or_default());
        // 同じ元の前の決まりのファイルを消す
        let head = format!("{key}_");
        for e in std::fs::read_dir(&self.root).into_iter().flatten().flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if n.starts_with(&head) && !n.starts_with(&name) {
                let _ = std::fs::remove_file(e.path());
            }
        }
        Ok((dest, stats))
    }

    /// 最後に組んだ数（データ元の一覧の行の数。決まりが今と同じ物）
    pub fn recent(&self, key: &str, spec: &Spec) -> Option<Value> {
        let head = format!("{key}_");
        let want = spec.json();
        let mut best: Option<(f64, Value)> = None;
        for e in std::fs::read_dir(&self.root).ok()?.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if !n.starts_with(&head) || !n.ends_with(".json") {
                continue;
            }
            let Some(had) = std::fs::read(e.path()).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else { continue };
            if had["spec"] != want {
                continue;
            }
            let at = had["builtAt"].as_f64().unwrap_or(0.0);
            if best.as_ref().is_none_or(|(b, _)| at > *b) {
                best = Some((at, had["stats"].clone()));
            }
        }
        best.map(|(_, s)| s)
    }
}

// ------------------------------------------------------------------ 窓の口（見分け・試す）

/// 「X別Y」の列の名前から鍵・値の名前の候補（設備別通過回数 → 設備・通過回数）。当たらなければ 鍵・値
pub fn suggest_names(col: &str) -> (String, String) {
    if let Some(i) = col.find('別') {
        let (a, b) = (&col[..i], &col[i + '別'.len_utf8()..]);
        if !a.is_empty() && !b.is_empty() {
            return (a.to_string(), b.to_string());
        }
    }
    ("鍵".into(), "値".into())
}

/// 見分け（POST /api/sources/json/probe）: 元の表の先頭 PROBE_ROWS 行から、JSON に見える列ごとの形の数
pub fn probe_answer(cols: &[String], rows: &[Vec<SqlValue>]) -> Value {
    let mut out = vec![];
    for (i, c) in cols.iter().enumerate() {
        let cells: Vec<Cell> = rows.iter().map(|r| cell_of(&r[i])).collect();
        let p = detect(&cells, "");
        if !p.json {
            continue;
        }
        let (k, v) = suggest_names(c);
        let mut x = p.json();
        x["column"] = json!(c);
        x["suggest"] = json!({"鍵": k, "値": v});
        out.push(x);
    }
    json!({"read": rows.len(), "columns": out, "baseColumns": cols})
}

/// 試す（POST /api/sources/json/preview）: 全部の行で、形ごとの分けられる行と分けてできる行・選んだ分け方の数・合わない行・見本・
/// 鍵と設備マスタの照らし合わせ（① ⑤）。master は設備マスタの設備名
pub fn preview_answer(cols: &[String], rows: &[Vec<SqlValue>], spec: &Spec, lot_col: &str, master: &[String]) -> Result<Value, String> {
    let Some(ci) = cols.iter().position(|c| *c == spec.col) else {
        return Err(format!("列「{}」が見つかりません。", spec.col));
    };
    let li = cols.iter().position(|c| c == lot_col);
    let cells: Vec<Cell> = rows.iter().map(|r| cell_of(&r[ci])).collect();
    let lot = |i: usize| li.map(|l| cell_of(&rows[i][l]).text()).unwrap_or_default();
    let mut shapes = Map::new();
    for s in SHAPES {
        let e = expand(&cells, &Spec { shape: s, ..spec.clone() });
        shapes.insert(s.key().into(), json!({"fit": e.stats.fit, "out": e.stats.out, "cols": e.cols.len()}));
    }
    let probe = detect(&cells[..cells.len().min(PROBE_ROWS)], &spec.path);
    let ex = expand(&cells, spec);
    let names = final_names(cols, &ex.cols, &spec.col);
    let renamed: Vec<Value> = ex.cols.iter().zip(&names).filter(|(a, b)| a != b).map(|(a, b)| json!({"from": a, "to": b})).collect();
    // 見本: 分けた元の行の先頭 2 行（分けた行は 1 行あたり 8 行まで）
    let mut sample = vec![];
    for (i, outs) in ex.rows.iter().enumerate() {
        if sample.len() >= 2 {
            break;
        }
        if outs.len() == 1 && outs[0].iter().all(|o| *o == Out::Null) {
            continue;
        }
        let n = outs.len();
        sample.push(json!({"row": i + 1, "lot": lot(i), "text": snippet(&cells[i]), "n": n,
                           "out": outs.iter().take(8).map(|o| o.iter().map(Out::json).collect::<Vec<_>>()).collect::<Vec<_>>()}));
    }
    let mut issues = ex.issues_json();
    for x in issues.as_array_mut().into_iter().flatten() {
        let r = x["row"].as_u64().unwrap_or(1) as usize;
        x["lot"] = json!(lot(r.saturating_sub(1)));
    }
    // 鍵と設備マスタ（① ⑤）: 鍵ごとの行の数と、マスタに無い鍵の例の行
    let key_master = if matches!(spec.shape, Shape::Dict | Shape::DictRows) {
        let norm = |s: &str| crate::worksum::normalize_part(crate::pyfmt::strip(s));
        let known: Vec<String> = master.iter().map(|m| norm(m)).collect();
        let mut keys: Vec<(String, usize, Vec<Value>)> = vec![];
        for (i, outs) in ex.rows.iter().enumerate() {
            for o in outs {
                if let Some(Out::Text(k)) = o.first() {
                    let slot = match keys.iter().position(|x| x.0 == *k) {
                        Some(p) => p,
                        None => {
                            keys.push((k.clone(), 0, vec![]));
                            keys.len() - 1
                        }
                    };
                    keys[slot].1 += 1;
                    if keys[slot].2.len() < EXAMPLES {
                        let ex_row: Vec<Value> = o.iter().map(Out::json).collect();
                        keys[slot].2.push(json!({"row": i + 1, "lot": lot(i), "out": ex_row}));
                    }
                }
            }
        }
        let missing: Vec<Value> = keys
            .iter()
            .filter(|(k, _, _)| !known.contains(&norm(k)))
            .map(|(k, n, ex)| json!({"key": k, "rows": n, "examples": ex}))
            .collect();
        json!({"keys": keys.len(), "in": keys.len() - missing.len(), "missing": missing, "master": !master.is_empty()})
    } else {
        Value::Null
    };
    Ok(json!({"rows": rows.len(), "column": spec.col, "shape": spec.shape.key(), "probe": probe.json(), "shapes": shapes,
              "stats": ex.stats.json(), "cols": names, "renamed": renamed, "issues": issues, "sample": sample,
              "lotColumn": if li.is_some() { json!(lot_col) } else { Value::Null }, "keyMaster": key_master}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_like_the_rules() {
        assert_eq!(
            parse(r#"{"b":1,"a":2,"b":3}"#),
            Ok(J::Obj(vec![("b".into(), J::Int(3)), ("a".into(), J::Int(2))])),
            "同じ鍵は後ろの値を前の位置に"
        );
        assert_eq!(parse("123456789012345678901234"), Ok(J::Big("123456789012345678901234".into())));
        assert_eq!(parse(r#"{"a":1"#), Err(ParseErr::Eof));
        assert!(matches!(parse("{'a': 1}"), Err(ParseErr::Quote(2))));
        assert_eq!(J::Obj(vec![("寸".into(), J::Num(0.5))]).compact(), r#"{"寸":0.5}"#);
    }

    #[test]
    fn builds_a_table_and_reuses_it() {
        let d = std::env::temp_dir().join(format!("da-jx-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let base = d.join("b.sqlite3");
        let c = Connection::open(&base).unwrap();
        c.execute_batch(
            r#"CREATE TABLE t (ロット番号, j); INSERT INTO t VALUES ('L1', '{"A":1,"B":2.5}'), ('L2', NULL), ('L3', '{"A":');"#,
        )
        .unwrap();
        drop(c);
        let ex = Expander::new(d.join("expands"));
        let spec = Spec { col: "j".into(), shape: Shape::Dict, key: "設備".into(), value: "回".into(), path: String::new() };
        let (p, st) = ex.path_for("s1", &base, "t", &spec).unwrap();
        assert_eq!(st["stats"]["out"], 4);
        assert_eq!(st["stats"]["broken"], 1);
        let c = Connection::open(&p).unwrap();
        let sum: f64 = c.query_row("SELECT SUM(回) FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(sum, 3.5);
        let (p2, _) = ex.path_for("s1", &base, "t", &spec).unwrap();
        assert_eq!(p, p2, "元が同じなら組み直さない");
        assert_eq!(ex.recent("s1", &spec).unwrap()["stats"]["fit"], 1);
        let _ = std::fs::remove_dir_all(&d);
    }
}
