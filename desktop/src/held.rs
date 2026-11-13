//! 置き場のファイルの行の読み書きだけを pyjson::J にする小さな部品（版 3.107.0。Rust 化の段 ① の 4 歩目・案 E4 と J の小さな形）。
//!
//! serde の Value は NaN・Infinity（1e400 も）を持てず、入れ子 128 段で読むのをやめる。前は、置き場のファイルにそういう字が 1 つあるだけで
//! そのマスタの道を全部 Python に任せていた。ここでは置き場のファイルを Python の json.loads と同じ J で読み、serde の Value に移す:
//! - 移せない値（NaN・Infinity・-Infinity・u64 に入らない整数）は、その値を J の字にして頭に MARK を付けた字で持つ（読まない値。
//!   知らない鍵・ほかの元の行の値）。書くときに J へ戻し、Python の json.dumps(indent=2) と同じ字で書き戻す（隔てない・Python を変えない）
//! - 読む欄（中身・名前など）にそういう値があるかは、行の確かめ（src/row_check.rs）が is_held で見て、その行を隔てる
//! - 対の無い代用字（\ud800 など）は窓の字が持てない（U+FFFD に替わる）ので、ファイルごと読めない（Python も写しに書けないので同じに扱う）
//!
//! 次の版（3.108.0）の H2（大きな整数を桁のまま持つ）は、この上に載せる（いまは u64 に入らない整数のファイルを Store が断り、道は任せる）。

use crate::pyjson::{self, J};
use serde_json::Value;

/// 移せない値の印（字の頭。データの字に NUL で始まる物は無い）
pub const MARK: &str = "\u{0}J:";

/// 読めない理由
#[derive(Debug, PartialEq)]
pub enum Bad {
    /// 対の無い代用字がある（窓の字が持てない）
    Lone,
    /// JSON として読めない（Python の json.loads も ValueError）
    Broken(String),
}

/// ファイルの字（BOM を外した物）→ 値。整数の -0 は J が int の 0 と読む（Python と同じ）
pub fn parse(text: &str) -> Result<Value, Bad> {
    let (j, lone) = pyjson::loads_flagged(text).map_err(Bad::Broken)?;
    if lone {
        return Err(Bad::Lone);
    }
    Ok(to_value(&j))
}

/// J → Value（移せない値は MARK の字）
pub fn to_value(j: &J) -> Value {
    match j {
        J::Float(f) if !f.is_finite() => Value::String(format!("{MARK}{}", j.dumps(None))),
        J::Big(s) => match s.parse::<u64>() {
            Ok(u) => Value::from(u),
            Err(_) => Value::String(format!("{MARK}{s}")),
        },
        J::Arr(a) => Value::Array(a.iter().map(to_value).collect()),
        J::Obj(m) => Value::Object(m.iter().map(|(k, v)| (k.clone(), to_value(v))).collect()),
        other => other.to_value(),
    }
}

/// 持っている値（MARK の字）なら、その J
pub fn held(v: &Value) -> Option<J> {
    let s = v.as_str()?.strip_prefix(MARK)?;
    pyjson::loads(s).ok()
}

pub fn is_held(v: &Value) -> bool {
    v.as_str().is_some_and(|s| s.starts_with(MARK))
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
    if !has_held(v) {
        return serde_json::to_vec_pretty(v).map_err(std::io::Error::other);
    }
    Ok(to_j(v).dumps(Some(2)).into_bytes())
}

/// Python の repr(値)（持っている値は元の値の repr: nan・inf）
pub fn repr(v: &Value) -> String {
    to_j(v).repr()
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(parse(r#"{"a": "\ud800"}"#) == Err(Bad::Lone));
        assert!(matches!(parse("{"), Err(Bad::Broken(_))));
        let deep = format!("{{\"x\": {}{}}}", "[".repeat(200), "]".repeat(200));
        assert!(parse(&deep).is_ok());
    }
}
