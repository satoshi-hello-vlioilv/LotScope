//! 置き場のファイルの行の読み書きだけを pyjson::J にする小さな部品（版 3.107.0。Rust 化の段 ① の 4 歩目・案 E4 と J の小さな形）。
//!
//! serde の Value は NaN・Infinity（1e400 も）を持てず、入れ子 128 段で読むのをやめる。前は、置き場のファイルにそういう字が 1 つあるだけで
//! そのマスタの道を全部 Python に任せていた。ここでは置き場のファイルを Python の json.loads と同じ J で読み、serde の Value に移す:
//! - 移せない値（NaN・Infinity・-Infinity・u64 に入らない整数）は、その値を J の字にして頭に MARK を付けた字で持つ（読まない値。
//!   知らない鍵・ほかの元の行の値）。書くときに J へ戻し、Python の json.dumps(indent=2) と同じ字で書き戻す（隔てない・Python を変えない）
//! - 読む欄（中身・名前など）にそういう値があるかは、行の確かめ（src/row_check.rs）が is_held で見て、その行を隔てる
//! - 対の無い代用字（\ud800 など）は pyjson::LONE_BASE からの字で持ち（行の確かめが is_lone で見て、その行を隔てる）、書くときに
//!   \udXXX の字へ戻す（Python は書くときに backslashreplace で同じ字にする。版 3.107.0 の採点の割れ 9b: 前はファイルごと読めないにした）
//!
//! 版 3.108.0（H2。大きな整数を桁のまま持つ）: u64 に入らない整数も同じ印の字（MARK ＋桁の字）で持つ。置き場のファイルも書く道の本文も
//! この形で読み（int_value・body_value）、Python の int と同じに比べ・並べ（pyfmt::PyInt。IntArg が印の字を読む）、書き戻す（to_pretty・
//! 答えの字 reply_bytes・送った順の木 jsontree::Tree・join::py_dumps が桁のまま書く）。str() は桁の字（worksum::py_str）。
//! 前は u64 に入らない整数のファイルを Store が断り、本文の大きな整数も道ごと Python に任せた。

use crate::pyjson::{self, J};
use serde_json::Value;

/// 移せない値の印（字の頭）。版 3.108.0 の作った後の採点の割れ 1: 前は決まった字（NUL・J・:）で、利用者の字・データの字が同じ頭で
/// 始まると、大きな整数・NaN と取り違えて黙って書き替えた（to_pretty・答え・int()・str()）。いまは起動ごとの乱数（16 進 16 字）を挟み、
/// 外から来る字（本文・ファイル・SQLite の値）が印を名乗れない。印の字はこの窓の中だけで使い、ファイル・答えに出る前に必ず値に戻る
/// （to_pretty・reply_bytes・Tree・py_dumps・py_str・repr）。同じ窓の中の読み書きは同じ印を使う
pub fn mark() -> &'static str {
    static M: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    M.get_or_init(|| {
        let mut b = [0u8; 8];
        if getrandom::fill(&mut b).is_err() {
            // 乱数を取れなければ時刻とプロセス番号から（外から当てられない）
            let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
            b = ((t as u64) ^ ((std::process::id() as u64) << 32)).to_le_bytes();
        }
        format!("\u{0}J{}:", b.iter().map(|x| format!("{x:02x}")).collect::<String>())
    })
}

/// 読めない理由
#[derive(Debug, PartialEq)]
pub enum Bad {
    /// JSON として読めない（Python の json.loads も ValueError）
    Broken(String),
}

/// ファイルの字（BOM を外した物）→ 値。整数の -0 は J が int の 0 と読む（Python と同じ）。対の無い代用字は LONE_BASE からの字
pub fn parse(text: &str) -> Result<Value, Bad> {
    let j = pyjson::loads_keep_lone(text).map_err(Bad::Broken)?;
    Ok(to_value(&j))
}

fn lone_char(c: char) -> bool {
    (pyjson::LONE_BASE..=pyjson::LONE_BASE + 0x7FF).contains(&(c as u32))
}

/// 値のどこか（字・鍵）に対の無い代用字があるか
pub fn has_lone(v: &Value) -> bool {
    match v {
        // 持つ字は UTF-8 で 0xF4 から始まる（無ければ字ごとに見ない。速さ）
        Value::String(s) => s.as_bytes().contains(&0xF4) && s.chars().any(lone_char),
        Value::Array(a) => a.iter().any(has_lone),
        Value::Object(m) => m.iter().any(|(k, x)| k.chars().any(lone_char) || has_lone(x)),
        _ => false,
    }
}

/// J → Value（移せない値は MARK の字）
pub fn to_value(j: &J) -> Value {
    match j {
        J::Float(f) if !f.is_finite() => Value::String(format!("{}{}", mark(), j.dumps(None))),
        J::Big(s) => match s.parse::<u64>() {
            Ok(u) => Value::from(u),
            Err(_) => Value::String(format!("{}{s}", mark())),
        },
        J::Arr(a) => Value::Array(a.iter().map(to_value).collect()),
        J::Obj(m) => Value::Object(m.iter().map(|(k, v)| (k.clone(), to_value(v))).collect()),
        other => other.to_value(),
    }
}

/// 持っている値（MARK の字）なら、その J
pub fn held(v: &Value) -> Option<J> {
    let s = v.as_str()?.strip_prefix(mark())?;
    pyjson::loads(s).ok()
}

pub fn is_held(v: &Value) -> bool {
    v.as_str().is_some_and(|s| s.starts_with(mark()))
}

/// 持っている値が数でない値（NaN・Infinity）か
pub fn is_nonfinite(v: &Value) -> bool {
    matches!(held(v), Some(J::Float(f)) if !f.is_finite())
}

/// 値のどこかに持っている値があるか
pub fn has_held(v: &Value) -> bool {
    match v {
        Value::String(_) => is_held(v),
        Value::Array(a) => a.iter().any(has_held),
        Value::Object(m) => m.values().any(has_held),
        _ => false,
    }
}

/// 値のどこかに数でない値（NaN・Infinity）があるか
pub fn has_nonfinite(v: &Value) -> bool {
    match v {
        Value::String(_) => is_nonfinite(v),
        Value::Array(a) => a.iter().any(has_nonfinite),
        Value::Object(m) => m.values().any(has_nonfinite),
        _ => false,
    }
}

/// Value → J（持っている値は元の J に戻す）
pub fn to_j(v: &Value) -> J {
    match v {
        Value::String(_) => held(v).unwrap_or_else(|| J::from_value(v)),
        Value::Array(a) => J::Arr(a.iter().map(to_j).collect()),
        Value::Object(m) => J::Obj(m.iter().map(|(k, x)| (k.clone(), to_j(x))).collect()),
        _ => J::from_value(v),
    }
}

/// マスタのファイルに書く字（json.dumps(indent=2)。持っている値が無ければ前と同じ serde の字）
pub fn to_pretty(v: &Value) -> std::io::Result<Vec<u8>> {
    if !has_held(v) && !has_lone(v) {
        return serde_json::to_vec_pretty(v).map_err(std::io::Error::other);
    }
    // 対の無い代用字は \udXXX の字に戻す（Python の errors="backslashreplace" と同じ字）
    let t = to_j(v).dumps(Some(2));
    let out: String =
        t.chars().map(|c| if lone_char(c) { format!("\\u{:04x}", c as u32 - pyjson::LONE_BASE + 0xD800) } else { c.to_string() }).collect();
    Ok(out.into_bytes())
}

/// Python の repr(値)（持っている値は元の値の repr: nan・inf）
pub fn repr(v: &Value) -> String {
    to_j(v).repr()
}

/// Python の int の値（版 3.108.0）: i64・u64 に入れば数、入らなければ印の字（桁のまま。書くときに桁の数に戻る）
pub fn int_value(n: &crate::pyfmt::PyInt) -> Value {
    match n {
        crate::pyfmt::PyInt::Small(i) => Value::from(*i),
        crate::pyfmt::PyInt::Big(s) => match s.parse::<u64>() {
            Ok(u) => Value::from(u),
            Err(_) => Value::String(format!("{}{s}", mark())),
        },
    }
}

/// 持っている大きな整数（u64 に入らない整数）の桁の字（符号つき）
pub fn big_digits(v: &Value) -> Option<&str> {
    big_digits_str(v.as_str()?)
}

/// big_digits の字の形（jsontree::Tree の字）
pub fn big_digits_str(s: &str) -> Option<&str> {
    let s = s.strip_prefix(mark())?;
    let d = s.strip_prefix('-').unwrap_or(s);
    (!d.is_empty() && d.bytes().all(|b| b.is_ascii_digit())).then_some(s)
}

/// 値が JSON の字（持っている値でない字）か。持っている大きな整数・NaN は Python では数（isinstance(v, str) が偽）
pub fn is_text(v: &Value) -> bool {
    v.is_string() && !is_held(v)
}

/// 書く道の本文（版 3.108.0）: 字の外に i64・u64 に入らない整数があれば J で読み、その数を印の字で持つ（serde は小数に丸める）。
/// 無ければ serde のまま。整数の -0 は本文の門（body::gate）が 0 に書き直してある。読めなければ None
pub fn body_value(body: &[u8]) -> Option<Value> {
    if !crate::master_store::has_wide_int(body) && !crate::master_rows::has_int_minus_zero(body) {
        return serde_json::from_slice(body).ok();
    }
    let t = std::str::from_utf8(body).ok()?;
    // 数でない値（NaN・Infinity）は読めない本文と同じに扱う（呼ぶ側が Python に任せる）
    parse(t).ok().filter(|v| !has_nonfinite(v))
}

/// 置き場の中身の字（"{…}"。ダッシュボード・カード・セット・書式・すぐに見るの中身・前の版の条件）→ 値（版 3.109.0。Python の
/// json.loads と同じく i64・u64 に入らない整数も読み、印の字で持つ。整数の -0 は 0。前は serde で読み、大きな整数を小数に丸めるので
/// row_check::wide_content でその道を Python に任せた）。NaN・Infinity・読めない字は None（行の確かめが先に隔てる）
pub fn text_value(t: &str) -> Option<Value> {
    body_value(crate::master_rows::inner_text(t).as_bytes())
}

/// 画面へ返す答えの字（版 3.108.0。Flask の jsonify と同じく大きな整数は桁のまま。NaN・Infinity は null〈答えは allow_nan=False〉）。
/// 持っている値が無ければ前と同じ serde の字
pub fn reply_bytes(v: &Value) -> Vec<u8> {
    if !has_held(v) {
        return serde_json::to_vec(v).unwrap_or_default();
    }
    fn plain(j: J) -> J {
        match j {
            J::Float(f) if !f.is_finite() => J::Null,
            J::Arr(a) => J::Arr(a.into_iter().map(plain).collect()),
            J::Obj(m) => J::Obj(m.into_iter().map(|(k, v)| (k, plain(v))).collect()),
            x => x,
        }
    }
    plain(to_j(v)).dumps(None).into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 中身の字の境の数（版 3.109.0・H3）: program/tests/fixtures/bigint_cases.json の content（Python の清め方の答え）と、窓の清め方
    /// （カードの設計・ダッシュボード・セット・共有の書式・すぐに見る・前の版の条件）が同じ字・同じ値か。窓は中身を text_value で読み、
    /// 印の字（大きな整数）は str() で桁の字・書き戻しで桁の数
    #[test]
    fn content_like_the_table() {
        use crate::jsontree::Tree;
        let table: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/bigint_cases.json")).unwrap();
        let mut bad = vec![];
        let same_value = |a: &str, b: &str| parse(a).ok() == parse(b).ok();
        for c in table["content"].as_array().unwrap() {
            let (kind, text) = (c["kind"].as_str().unwrap(), c["text"].as_str().unwrap());
            let want = c["want"].as_str();
            let got: Option<String> = match kind {
                "card" => crate::card_forms::clean_body(Some(&json_text(text))).ok().map(|x| x.1),
                "layout" => crate::layout_clean::clean_layout(&Tree::Str(text.into())).ok().map(|x| x.1),
                "set" => crate::dash_sets::clean_body(Some(&json_text(text))).ok().flatten().map(|x| x.1),
                "format" => crate::formats_write::clean_body(Some(&Tree::Str(text.into()))).ok().flatten(),
                "quick" => text_value(text)
                    .and_then(|v| crate::pivot_presets::clean_quick(&v))
                    .and_then(Result::ok)
                    .map(|ks| format!("[{}]", ks.iter().map(|k| serde_json::to_string(k).unwrap()).collect::<Vec<_>>().join(", "))),
                _ => {
                    let rows = [Tree::Obj(vec![("キー".into(), Tree::Str("wip".into())), ("条件".into(), Tree::Str(text.into()))])];
                    crate::layout_clean::condition_of(&rows, "wip").ok().map(|v| String::from_utf8(reply_bytes(&v)).unwrap())
                }
            };
            let ok = match (kind, want, &got) {
                // 前の版の条件は値で比べる（鍵の順・区切りの字は答えの組み方による）
                ("condition", Some(w), Some(g)) => same_value(w, g),
                (_, w, g) => w == g.as_deref(),
            };
            if !ok {
                bad.push(format!("{kind} {}: 窓 {got:?} / Python {want:?}", c["edge"]));
            }
        }
        assert!(bad.is_empty(), "{} 件違います:\n{}", bad.len(), bad.join("\n"));
    }

    fn json_text(t: &str) -> Value {
        Value::String(t.to_string())
    }

    #[test]
    fn keeps_nan_and_writes_it_back() {
        let v = parse(r#"{"rows": [{"id": 1, "x": NaN, "y": [Infinity, -Infinity, 1e400], "z": -0, "w": 18446744073709551615}]}"#).unwrap();
        let row = &v["rows"][0];
        assert!(is_nonfinite(&row["x"]) && is_held(&row["y"][2]) && !is_held(&row["z"]));
        assert_eq!(row["z"], 0);
        assert_eq!(row["w"].as_u64(), Some(u64::MAX));
        let t = String::from_utf8(to_pretty(&v).unwrap()).unwrap();
        assert!(t.contains("\"x\": NaN") && t.contains("Infinity,\n") && t.contains("-Infinity"), "{t}");
        assert_eq!(repr(&row["x"]), "nan");
        assert_eq!(repr(&row["y"]), "[inf, -inf, inf]");
        let lone = parse(r#"{"a": "x\ud800y"}"#).unwrap();
        assert!(has_lone(&lone));
        assert_eq!(String::from_utf8(to_pretty(&lone).unwrap()).unwrap(), "{\n  \"a\": \"x\\ud800y\"\n}");
        assert!(matches!(parse("{"), Err(Bad::Broken(_))));
        let deep = format!("{{\"x\": {}{}}}", "[".repeat(200), "]".repeat(200));
        assert!(parse(&deep).is_ok());
    }
}
