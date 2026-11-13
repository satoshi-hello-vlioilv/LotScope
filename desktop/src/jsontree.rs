//! 送った順を保つ JSON の木（版 3.80.0）。serde_json の Map は鍵を字の順に並べ直す（preserve_order は tauri を含む crate 全体の Map を
//! 替えるので使わない）。Python の json.loads は鍵を送った順のまま持ち、json.dumps はその順で書くので、置く字をそのまま写したい所
//! （共有の書式の中身: display_formats.clean_body の json.dumps(separators=(',', ':'))）はこの木で読み、この木で書く。
//!
//! 決まりは Python と同じ: 同じ鍵が 2 つあれば後ろの値を前の位置に入れる（どの段でも）・字は ensure_ascii=False で、逃がすのは
//! 「"」「\」と 0x20 未満だけ（U+007F・U+2028 は逃がさない）・数は整数は桁のまま、小数は float.__repr__（join::py_number）。
//! 窓が Python と同じに読めない字（NaN・Infinity・1e400・整数の -0・片割れの代用字）は、呼ぶ側が先に
//! master_rows::unreadable・text_split で Python に任せる。i64・u64 に入らない整数は版 3.108.0 から src/held.rs の印の字（Tree::Str）で持ち、
//! 桁のまま書く（parse は J で読む）。

use serde_json::{Number, Value};

#[derive(Debug, Clone, PartialEq)]
pub enum Tree {
    Null,
    Bool(bool),
    Num(Number),
    Str(String),
    Arr(Vec<Tree>),
    Obj(Vec<(String, Tree)>),
}

impl<'de> serde::Deserialize<'de> for Tree {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Tree, D::Error> {
        struct Visit;
        impl<'de> serde::de::Visitor<'de> for Visit {
            type Value = Tree;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("JSON の値")
            }
            fn visit_unit<E>(self) -> Result<Tree, E> {
                Ok(Tree::Null)
            }
            fn visit_bool<E>(self, v: bool) -> Result<Tree, E> {
                Ok(Tree::Bool(v))
            }
            fn visit_i64<E>(self, v: i64) -> Result<Tree, E> {
                Ok(Tree::Num(v.into()))
            }
            fn visit_u64<E>(self, v: u64) -> Result<Tree, E> {
                Ok(Tree::Num(v.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Tree, E> {
                Number::from_f64(v).map(Tree::Num).ok_or_else(|| E::custom("有限でない数"))
            }
            fn visit_str<E>(self, v: &str) -> Result<Tree, E> {
                Ok(Tree::Str(v.to_string()))
            }
            fn visit_string<E>(self, v: String) -> Result<Tree, E> {
                Ok(Tree::Str(v))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut s: A) -> Result<Tree, A::Error> {
                let mut out = vec![];
                while let Some(x) = s.next_element::<Tree>()? {
                    out.push(x);
                }
                Ok(Tree::Arr(out))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut m: A) -> Result<Tree, A::Error> {
                let mut out: Vec<(String, Tree)> = vec![];
                while let Some((k, v)) = m.next_entry::<String, Tree>()? {
                    match out.iter_mut().find(|(n, _)| *n == k) {
                        Some(slot) => slot.1 = v, // 同じ鍵は後ろの値を前の位置に（Python の dict と同じ）
                        None => out.push((k, v)),
                    }
                }
                Ok(Tree::Obj(out))
            }
        }
        d.deserialize_any(Visit)
    }
}

impl Tree {
    /// 字から読む（読めなければ None）。i64・u64 に入らない整数があれば J で読み、その数は印の字で持つ（版 3.108.0）
    pub fn parse(text: &str) -> Option<Tree> {
        if crate::master_store::has_wide_int(text.as_bytes()) {
            return crate::pyjson::loads(text).ok().map(|j| Tree::from_j(&j));
        }
        serde_json::from_str(text).ok()
    }

    /// 本文の字から（parse と同じ。バイトの字）
    pub fn parse_bytes(body: &[u8]) -> Option<Tree> {
        Tree::parse(std::str::from_utf8(body).ok()?)
    }

    /// J から（送った順のまま。serde の数に移せない値〈大きな整数・NaN〉は src/held.rs の印の字）
    pub fn from_j(j: &crate::pyjson::J) -> Tree {
        use crate::pyjson::J;
        match j {
            J::Arr(a) => Tree::Arr(a.iter().map(Tree::from_j).collect()),
            J::Obj(m) => Tree::Obj(m.iter().map(|(k, v)| (k.clone(), Tree::from_j(v))).collect()),
            other => Tree::from_value(&crate::held::to_value(other)),
        }
    }

    pub fn get(&self, key: &str) -> Option<&Tree> {
        match self {
            Tree::Obj(m) => m.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// serde の値から（鍵は serde の Map の順＝字の順。Python で json.dumps(sort_keys=True) した字を読み直した形と同じ順）
    pub fn from_value(v: &Value) -> Tree {
        match v {
            Value::Null => Tree::Null,
            Value::Bool(b) => Tree::Bool(*b),
            Value::Number(n) => Tree::Num(n.clone()),
            Value::String(s) => Tree::Str(s.clone()),
            Value::Array(a) => Tree::Arr(a.iter().map(Tree::from_value).collect()),
            Value::Object(m) => Tree::Obj(m.iter().map(|(k, v)| (k.clone(), Tree::from_value(v))).collect()),
        }
    }

    /// serde の値へ（鍵の順は失う。比べる・読むため）
    pub fn to_value(&self) -> Value {
        match self {
            Tree::Null => Value::Null,
            Tree::Bool(b) => Value::Bool(*b),
            Tree::Num(n) => Value::Number(n.clone()),
            Tree::Str(s) => Value::String(s.clone()),
            Tree::Arr(a) => Value::Array(a.iter().map(Tree::to_value).collect()),
            Tree::Obj(m) => Value::Object(m.iter().map(|(k, v)| (k.clone(), v.to_value())).collect()),
        }
    }

    /// json.dumps(ensure_ascii=False, separators=(item, key)) と同じ字（送った順のまま）
    pub fn dumps(&self, item: &str, key: &str) -> String {
        let mut out = String::new();
        self.write(&mut out, item, key);
        out
    }

    fn write(&self, out: &mut String, item: &str, key: &str) {
        match self {
            Tree::Null => out.push_str("null"),
            Tree::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Tree::Num(n) => out.push_str(&crate::join::py_number(n)),
            Tree::Str(s) => out.push_str(&crate::join::py_dumps(&Value::String(s.clone()))),
            Tree::Arr(a) => {
                out.push('[');
                for (i, x) in a.iter().enumerate() {
                    if i > 0 {
                        out.push_str(item);
                    }
                    x.write(out, item, key);
                }
                out.push(']');
            }
            Tree::Obj(m) => {
                out.push('{');
                for (i, (k, v)) in m.iter().enumerate() {
                    if i > 0 {
                        out.push_str(item);
                    }
                    out.push_str(&crate::join::py_dumps(&Value::String(k.clone())));
                    out.push_str(key);
                    v.write(out, item, key);
                }
                out.push('}');
            }
        }
    }
}

/// int() に渡す値（pyfmt::py_int_of。版 3.104.0）
impl<'a> From<&'a Tree> for crate::pyfmt::IntArg<'a> {
    fn from(t: &'a Tree) -> crate::pyfmt::IntArg<'a> {
        use crate::pyfmt::IntArg;
        match t {
            Tree::Null => IntArg::None,
            Tree::Bool(b) => IntArg::Bool(*b),
            Tree::Num(n) => IntArg::Num(n),
            Tree::Str(s) if s.starts_with(crate::held::mark()) => {
                // 持っている値（版 3.108.0）は Value の読み方と同じ
                match crate::held::big_digits_str(s) {
                    Some(d) => IntArg::Big(d),
                    None => IntArg::Other("str"),
                }
            }
            Tree::Str(s) => IntArg::Str(s),
            Tree::Arr(_) => IntArg::Other("list"),
            Tree::Obj(_) => IntArg::Other("dict"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Tree;

    #[test]
    fn keeps_the_sent_order_and_writes_like_python() {
        // Python: json.dumps(json.loads(t), ensure_ascii=False, separators=(",", ":"))
        let cases = [
            (r#"{"y":1,"x":2,"y":3}"#, r#"{"y":3,"x":2}"#),
            (r#"{"b":{"d":1,"c":[1,2.5,{"z":true,"a":null}]},"a":"字"}"#, r#"{"b":{"d":1,"c":[1,2.5,{"z":true,"a":null}]},"a":"字"}"#),
            (r#"{"s":"\"\\\n\u0001\u007f /"}"#, "{\"s\":\"\\\"\\\\\\n\\u0001\u{7f}\u{2028}/\"}"),
            (r#"{"f":[0.00001,1e16,3.0,-0.0,1E2,5e-324]}"#, r#"{"f":[1e-05,1e+16,3.0,-0.0,100.0,5e-324]}"#),
            (r#"[]"#, r#"[]"#),
        ];
        for (inp, want) in cases {
            assert_eq!(Tree::parse(inp).unwrap().dumps(",", ":"), want, "{inp}");
        }
        assert_eq!(Tree::parse(r#"{"a":1,"b":[1,2]}"#).unwrap().dumps(", ", ": "), r#"{"a": 1, "b": [1, 2]}"#);
        assert!(Tree::parse("{").is_none());
    }
}
