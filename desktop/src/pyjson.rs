//! Python の json.loads・json.dumps・str()・repr() と同じに読み書きする JSON の値（版 3.98.0。LotDsp の道 src/lotdsp.rs）。
//!
//! serde_json の Value は鍵を字の順に並べ直し、NaN・Infinity・大きな整数を持てない。LotDsp の API の応答は、鍵の順（学ぶときの
//! 並びの選び方・状態の probe の 80 項目）と値の書き方（str(値) で照らす）が答えに効くので、Python の json.loads と同じ値を持つ:
//! - 鍵は送った順。同じ鍵が 2 つあれば後ろの値を前の位置に入れる（Python の dict と同じ）
//! - 整数は桁のまま（i64 に入らない整数は字で持つ）・小数は f64（1e400 は inf）・NaN・Infinity・-Infinity も読む
//! - 字の片割れの代用字（\ud800 など）は U+FFFD にする（Rust の字は片割れを持てない。LotDsp の答えに出ない形）
//! - 入れ子は MAX_DEPTH 段まで（Python は再帰の上限で落ちる。窓は読まない）

use serde_json::{json, Value};

pub const MAX_DEPTH: usize = 900;

#[derive(Debug, Clone, PartialEq)]
pub enum J {
    Null,
    Bool(bool),
    Int(i64),
    /// i64 に入らない整数（10 進の字。符号つき）
    Big(String),
    Float(f64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

impl J {
    pub fn obj() -> J {
        J::Obj(vec![])
    }

    pub fn get(&self, k: &str) -> Option<&J> {
        match self {
            J::Obj(m) => m.iter().find(|(n, _)| n == k).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn get_mut(&mut self, k: &str) -> Option<&mut J> {
        match self {
            J::Obj(m) => m.iter_mut().find(|(n, _)| n == k).map(|(_, v)| v),
            _ => None,
        }
    }

    /// d[k] = v（あれば同じ位置、無ければ後ろへ）
    pub fn set(&mut self, k: &str, v: J) {
        if let J::Obj(m) = self {
            match m.iter_mut().find(|(n, _)| n == k) {
                Some(slot) => slot.1 = v,
                None => m.push((k.to_string(), v)),
            }
        }
    }

    /// d.setdefault(k, v)
    pub fn setdefault(&mut self, k: &str, v: J) -> &mut J {
        if self.get(k).is_none() {
            self.set(k, v);
        }
        self.get_mut(k).unwrap()
    }

    pub fn remove(&mut self, k: &str) -> Option<J> {
        match self {
            J::Obj(m) => m.iter().position(|(n, _)| n == k).map(|i| m.remove(i).1),
            _ => None,
        }
    }

    pub fn entries(&self) -> &[(String, J)] {
        match self {
            J::Obj(m) => m,
            _ => &[],
        }
    }

    pub fn items(&self) -> &[J] {
        match self {
            J::Arr(a) => a,
            _ => &[],
        }
    }

    pub fn is_obj(&self) -> bool {
        matches!(self, J::Obj(_))
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            J::Str(s) => Some(s),
            _ => None,
        }
    }

    /// Python の真偽
    pub fn truthy(&self) -> bool {
        match self {
            J::Null => false,
            J::Bool(b) => *b,
            J::Int(i) => *i != 0,
            J::Big(_) => true,
            J::Float(f) => *f != 0.0,
            J::Str(s) => !s.is_empty(),
            J::Arr(a) => !a.is_empty(),
            J::Obj(m) => !m.is_empty(),
        }
    }

    /// 数（int・float。bool は除く）
    pub fn is_number(&self) -> bool {
        matches!(self, J::Int(_) | J::Big(_) | J::Float(_))
    }

    /// float(値)（数のときだけ）
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            J::Int(i) => Some(*i as f64),
            J::Big(s) => s.parse::<f64>().ok(),
            J::Float(f) => Some(*f),
            _ => None,
        }
    }

    /// Python の type(v).__name__
    pub fn type_name(&self) -> &'static str {
        match self {
            J::Null => "NoneType",
            J::Bool(_) => "bool",
            J::Int(_) | J::Big(_) => "int",
            J::Float(_) => "float",
            J::Str(_) => "str",
            J::Arr(_) => "list",
            J::Obj(_) => "dict",
        }
    }

    /// Python の str(値)
    pub fn py_str(&self) -> String {
        match self {
            J::Str(s) => s.clone(),
            _ => self.repr(),
        }
    }

    /// Python の repr(値)
    pub fn repr(&self) -> String {
        match self {
            J::Null => "None".into(),
            J::Bool(b) => if *b { "True" } else { "False" }.into(),
            J::Int(i) => i.to_string(),
            J::Big(s) => s.clone(),
            J::Float(f) => crate::pyfmt::float_repr(*f),
            J::Str(s) => crate::pyfmt::str_repr(s),
            J::Arr(a) => format!("[{}]", a.iter().map(J::repr).collect::<Vec<_>>().join(", ")),
            J::Obj(m) => format!(
                "{{{}}}",
                m.iter().map(|(k, v)| format!("{}: {}", crate::pyfmt::str_repr(k), v.repr())).collect::<Vec<_>>().join(", ")
            ),
        }
    }

    /// 答えの値（serde_json。鍵の順は字の順になる: 答えは sort_keys の json.dumps なので同じ）。NaN・inf は null
    pub fn to_value(&self) -> Value {
        match self {
            J::Null => Value::Null,
            J::Bool(b) => json!(b),
            J::Int(i) => json!(i),
            J::Big(s) => s.parse::<f64>().map(|f| json!(f)).unwrap_or(Value::Null),
            J::Float(f) => serde_json::Number::from_f64(*f).map(Value::Number).unwrap_or(Value::Null),
            J::Str(s) => json!(s),
            J::Arr(a) => Value::Array(a.iter().map(J::to_value).collect()),
            J::Obj(m) => Value::Object(m.iter().map(|(k, v)| (k.clone(), v.to_value())).collect()),
        }
    }

    pub fn from_value(v: &Value) -> J {
        match v {
            Value::Null => J::Null,
            Value::Bool(b) => J::Bool(*b),
            Value::Number(n) => match n.as_i64() {
                Some(i) => J::Int(i),
                None => match n.as_u64() {
                    Some(u) => J::Big(u.to_string()),
                    None => J::Float(n.as_f64().unwrap_or(f64::NAN)),
                },
            },
            Value::String(s) => J::Str(s.clone()),
            Value::Array(a) => J::Arr(a.iter().map(J::from_value).collect()),
            Value::Object(m) => J::Obj(m.iter().map(|(k, v)| (k.clone(), J::from_value(v))).collect()),
        }
    }

    /// json.dumps(値, ensure_ascii=False, indent=indent)（indent が None なら separators の既定 ", " と ": "）
    pub fn dumps(&self, indent: Option<usize>) -> String {
        let mut out = String::new();
        self.write(&mut out, indent, 0);
        out
    }

    fn write(&self, out: &mut String, indent: Option<usize>, level: usize) {
        let nl = |out: &mut String, lv: usize| {
            if let Some(n) = indent {
                out.push('\n');
                out.push_str(&" ".repeat(n * lv));
            }
        };
        match self {
            J::Null => out.push_str("null"),
            J::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            J::Int(i) => out.push_str(&i.to_string()),
            J::Big(s) => out.push_str(s),
            J::Float(f) => out.push_str(&if f.is_nan() {
                "NaN".to_string()
            } else if f.is_infinite() {
                if *f > 0.0 { "Infinity" } else { "-Infinity" }.to_string()
            } else {
                crate::pyfmt::float_repr(*f)
            }),
            J::Str(s) => write_str(out, s),
            J::Arr(a) => {
                if a.is_empty() {
                    out.push_str("[]");
                    return;
                }
                out.push('[');
                for (i, x) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                        if indent.is_none() {
                            out.push(' ');
                        }
                    }
                    nl(out, level + 1);
                    x.write(out, indent, level + 1);
                }
                nl(out, level);
                out.push(']');
            }
            J::Obj(m) => {
                if m.is_empty() {
                    out.push_str("{}");
                    return;
                }
                out.push('{');
                for (i, (k, v)) in m.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                        if indent.is_none() {
                            out.push(' ');
                        }
                    }
                    nl(out, level + 1);
                    write_str(out, k);
                    out.push_str(": ");
                    v.write(out, indent, level + 1);
                }
                nl(out, level);
                out.push('}');
            }
        }
    }
}

/// json.dumps の字（ensure_ascii=False: 逃がすのは「"」「\」と 0x20 未満だけ）
fn write_str(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

// ------------------------------------------------------------------ 読む（json.loads）
struct P<'a> {
    s: &'a [u8],
    i: usize,
    depth: usize,
    /// 対の無い代用字（\ud800 など）を U+FFFD に替えたか（本文の門が断る。src/body.rs）
    lone: bool,
    /// 対の無い代用字を U+FFFD でなく LONE_BASE からの字で持つ（置き場の行。src/held.rs が \udXXX の字で書き戻す。版 3.107.0）
    keep: bool,
}

/// 対の無い代用字 U+D800〜U+DFFF を持つ字（補助私用領域 B の終わりの 0x800 字。データに出ない）
pub const LONE_BASE: u32 = 0x10F800;

/// int() の桁の上限（Python の sys.get_int_max_str_digits() の既定。json.loads は 4,300 桁を超える整数で ValueError）
pub const INT_MAX_DIGITS: usize = 4300;

/// json.loads(text)。読めなければ Err（Python は ValueError）
pub fn loads(text: &str) -> Result<J, String> {
    loads_flagged(text).map(|(v, _)| v)
}

/// json.loads(text) と、対の無い代用字があったか（窓の字は片割れを持てないので U+FFFD に替えて読む。版 3.104.0）
pub fn loads_flagged(text: &str) -> Result<(J, bool), String> {
    loads_with(text, false)
}

/// json.loads(text)。対の無い代用字は LONE_BASE からの字で持つ（置き場の行を値を変えずに書き戻すため。版 3.107.0）
pub fn loads_keep_lone(text: &str) -> Result<J, String> {
    loads_with(text, true).map(|(v, _)| v)
}

fn loads_with(text: &str, keep: bool) -> Result<(J, bool), String> {
    let mut p = P { s: text.as_bytes(), i: 0, depth: 0, lone: false, keep };
    p.ws();
    let v = p.value()?;
    p.ws();
    if p.i != p.s.len() {
        return Err("Extra data".into());
    }
    Ok((v, p.lone))
}

impl P<'_> {
    fn ws(&mut self) {
        while self.i < self.s.len() && matches!(self.s[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }

    fn lit(&mut self, w: &str) -> bool {
        if self.s[self.i..].starts_with(w.as_bytes()) {
            self.i += w.len();
            true
        } else {
            false
        }
    }

    fn value(&mut self) -> Result<J, String> {
        let Some(&c) = self.s.get(self.i) else { return Err("Expecting value".into()) };
        match c {
            b'{' => self.object(),
            b'[' => self.array(),
            b'"' => Ok(J::Str(self.string()?)),
            b't' if self.lit("true") => Ok(J::Bool(true)),
            b'f' if self.lit("false") => Ok(J::Bool(false)),
            b'n' if self.lit("null") => Ok(J::Null),
            b'N' if self.lit("NaN") => Ok(J::Float(f64::NAN)),
            b'I' if self.lit("Infinity") => Ok(J::Float(f64::INFINITY)),
            b'-' if self.s[self.i..].starts_with(b"-Infinity") => {
                self.i += 9;
                Ok(J::Float(f64::NEG_INFINITY))
            }
            b'-' | b'0'..=b'9' => self.number(),
            _ => Err("Expecting value".into()),
        }
    }

    fn number(&mut self) -> Result<J, String> {
        let st = self.i;
        if self.s[self.i] == b'-' {
            self.i += 1;
        }
        let digits = |p: &mut Self| {
            let a = p.i;
            while p.i < p.s.len() && p.s[p.i].is_ascii_digit() {
                p.i += 1;
            }
            p.i - a
        };
        match self.s.get(self.i) {
            Some(b'0') => self.i += 1,
            Some(b'1'..=b'9') => {
                digits(self);
            }
            _ => return Err("Expecting value".into()),
        }
        let mut float = false;
        if self.s.get(self.i) == Some(&b'.') && self.s.get(self.i + 1).is_some_and(u8::is_ascii_digit) {
            self.i += 1;
            digits(self);
            float = true;
        }
        if matches!(self.s.get(self.i), Some(b'e' | b'E')) {
            let save = self.i;
            self.i += 1;
            if matches!(self.s.get(self.i), Some(b'+' | b'-')) {
                self.i += 1;
            }
            if digits(self) == 0 {
                self.i = save;
            } else {
                float = true;
            }
        }
        let t = std::str::from_utf8(&self.s[st..self.i]).unwrap();
        if float {
            return Ok(J::Float(t.parse::<f64>().unwrap_or(if t.starts_with('-') { f64::NEG_INFINITY } else { f64::INFINITY })));
        }
        // 整数の -0 は int の 0。4,300 桁を超える整数は int() が断る（Python の json.loads も ValueError。版 3.104.0）
        if t.trim_start_matches('-').len() > INT_MAX_DIGITS {
            return Err(format!("Exceeds the limit ({INT_MAX_DIGITS} digits) for integer string conversion"));
        }
        Ok(match t.parse::<i64>() {
            Ok(i) => J::Int(i),
            Err(_) => J::Big(t.to_string()),
        })
    }

    fn string(&mut self) -> Result<String, String> {
        self.i += 1;
        let mut out = String::new();
        loop {
            let st = self.i;
            while self.i < self.s.len() && self.s[self.i] != b'"' && self.s[self.i] != b'\\' && self.s[self.i] >= 0x20 {
                self.i += 1;
            }
            out.push_str(std::str::from_utf8(&self.s[st..self.i]).map_err(|_| "Invalid UTF-8")?);
            match self.s.get(self.i) {
                None => return Err("Unterminated string".into()),
                Some(b'"') => {
                    self.i += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.i += 1;
                    let e = *self.s.get(self.i).ok_or("Unterminated string")?;
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
                            if (0xD800..0xDC00).contains(&hi) && self.s.get(self.i) == Some(&b'\\') && self.s.get(self.i + 1) == Some(&b'u')
                            {
                                let save = self.i;
                                self.i += 2;
                                let lo = self.hex4()?;
                                if (0xDC00..0xE000).contains(&lo) {
                                    out.push(char::from_u32(0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)).unwrap());
                                    continue;
                                }
                                self.i = save;
                            }
                            if (0xD800..0xE000).contains(&hi) {
                                self.lone = true;
                                if self.keep {
                                    out.push(char::from_u32(LONE_BASE + hi - 0xD800).unwrap());
                                    continue;
                                }
                            }
                            out.push(char::from_u32(hi).unwrap_or('\u{FFFD}'));
                        }
                        _ => return Err("Invalid \\escape".into()),
                    }
                }
                Some(_) => return Err("Invalid control character".into()),
            }
        }
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let h = self.s.get(self.i..self.i + 4).ok_or("Invalid \\uXXXX escape")?;
        let t = std::str::from_utf8(h).map_err(|_| "Invalid \\uXXXX escape")?;
        if !t.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid \\uXXXX escape".into());
        }
        self.i += 4;
        Ok(u32::from_str_radix(t, 16).unwrap())
    }

    fn enter(&mut self) -> Result<(), String> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err("入れ子が深すぎます".into());
        }
        Ok(())
    }

    fn array(&mut self) -> Result<J, String> {
        self.enter()?;
        self.i += 1;
        let mut out = vec![];
        self.ws();
        if self.s.get(self.i) == Some(&b']') {
            self.i += 1;
            self.depth -= 1;
            return Ok(J::Arr(out));
        }
        loop {
            self.ws();
            out.push(self.value()?);
            self.ws();
            match self.s.get(self.i) {
                Some(b',') => self.i += 1,
                Some(b']') => {
                    self.i += 1;
                    self.depth -= 1;
                    return Ok(J::Arr(out));
                }
                _ => return Err("Expecting ',' delimiter".into()),
            }
        }
    }

    fn object(&mut self) -> Result<J, String> {
        self.enter()?;
        self.i += 1;
        let mut out = J::obj();
        self.ws();
        if self.s.get(self.i) == Some(&b'}') {
            self.i += 1;
            self.depth -= 1;
            return Ok(out);
        }
        loop {
            self.ws();
            if self.s.get(self.i) != Some(&b'"') {
                return Err("Expecting property name enclosed in double quotes".into());
            }
            let k = self.string()?;
            self.ws();
            if self.s.get(self.i) != Some(&b':') {
                return Err("Expecting ':' delimiter".into());
            }
            self.i += 1;
            self.ws();
            let v = self.value()?;
            out.set(&k, v);
            self.ws();
            match self.s.get(self.i) {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    self.depth -= 1;
                    return Ok(out);
                }
                _ => return Err("Expecting ',' delimiter".into()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_like_python() {
        let v = loads(r#"{"b": 1, "a": [1.5, NaN, -Infinity, 12345678901234567890123, "😀", "\ud800x"], "b": 2}"#).unwrap();
        assert_eq!(v.entries()[0].0, "b", "同じ鍵は前の位置");
        assert_eq!(v.get("b"), Some(&J::Int(2)), "後ろの値");
        let a = v.get("a").unwrap().items();
        assert!(matches!(a[1], J::Float(f) if f.is_nan()));
        assert_eq!(a[3], J::Big("12345678901234567890123".into()));
        assert_eq!(a[4], J::Str("😀".into()));
        assert_eq!(a[5], J::Str("\u{FFFD}x".into()));
        assert_eq!(loads("-0").unwrap(), J::Int(0));
        assert_eq!(loads("1e400").unwrap(), J::Float(f64::INFINITY));
        assert!(loads("{bad").is_err() && loads("[1] x").is_err() && loads("\u{feff}{}").is_err() && loads("[01]").is_err());
        assert_eq!(v.repr(), "{'b': 2, 'a': [1.5, nan, -inf, 12345678901234567890123, '😀', '\u{FFFD}x']}");
        assert_eq!(J::Bool(true).py_str(), "True");
        assert_eq!(J::Float(5e-05).py_str(), "5e-05");
        assert_eq!(
            loads(r#"{"a": [], "b": {}, "c": [1, {"d": "x\n"}]}"#).unwrap().dumps(Some(1)),
            "{\n \"a\": [],\n \"b\": {},\n \"c\": [\n  1,\n  {\n   \"d\": \"x\\n\"\n  }\n ]\n}"
        );
    }
}
