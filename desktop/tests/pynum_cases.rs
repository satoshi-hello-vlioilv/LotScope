//! 数の読み方が Python と同じか（版 3.75.0）。program/tests/fixtures/pynum_cases.json（program/tools/pynum-cases.py が
//! 同梱と同じ Python で焼いた表）を、窓の pyfmt（int()・float()・\d の数字）と worksum::hm（勤務体系の時刻）が同じに読むかを突き合わせる。
//! 版 3.104.0: i64 に入らない数は桁の字（pyfmt::PyInt::Big。前は端へ丸めた）・読めない字の誤りの文（ASCII の印字できる字だけの事例）・
//! str.isspace の全部の字を前後に付けた事例（int()・float() は U+001C〜U+001F を空白に読まない）・4,300 桁の上限。
//! 作った後の採点から: 誤りの文（int_err・float_err）を全部の事例で 1 字まで（印字できない字の repr の逃がし）。

use da_core::{pyfmt, worksum};
use serde_json::Value;

#[test]
fn numbers_read_like_python() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/pynum_cases.json")).unwrap();
    // 数字の範囲が Python の \d と同じ（足りないと、その系統の数字を窓だけ読めない）
    let want: Vec<(u32, u32)> =
        t["digits"].as_array().unwrap().iter().map(|r| (r[0].as_u64().unwrap() as u32, r[1].as_u64().unwrap() as u32)).collect();
    assert_eq!(pyfmt::DIGITS, want.as_slice(), "数字の範囲が Python（Unicode {}）と違う", t["unicode"]);
    let mut bad = vec![];
    for c in t["cases"].as_array().unwrap() {
        let s = c["s"].as_str().unwrap();
        let int = pyfmt::py_int(s);
        // 誤りの文も 1 字まで（版 3.104.0 の作った後の採点: repr の逃がしは Python の isprintable の表〈src/printable_table.rs〉）
        let ok_int = match &c["int"] {
            Value::Null => match &int {
                Err(e) => Some(e.as_str()) == c["int_err"].as_str(),
                Ok(_) => false,
            },
            Value::String(x) => int.as_ref().ok() == Some(&pyfmt::PyInt::Big(x.clone())),
            v => int.as_ref().ok().and_then(|n| n.small()) == v.as_i64(),
        };
        let fl = pyfmt::py_float(s);
        let ok_float = match &c["float"] {
            Value::Null => fl.as_ref().err().map(String::as_str) == c["float_err"].as_str(),
            Value::String(x) if x == "nan" => fl.as_ref().is_ok_and(|f| f.is_nan()),
            Value::String(x) if x == "inf" => fl.as_ref().is_ok_and(|f| *f == f64::INFINITY),
            Value::String(x) if x == "-inf" => fl.as_ref().is_ok_and(|f| *f == f64::NEG_INFINITY),
            v => fl.as_ref().ok().copied() == v.as_f64(),
        };
        let d = !s.is_empty() && s.chars().all(|ch| pyfmt::digit(ch).is_some());
        let hm = worksum::hm(s).map(|m| m as u64);
        if !ok_int || !ok_float || d != c["d"].as_bool().unwrap() || hm != c["hm"].as_u64() {
            bad.push(format!(
                "{s:?}: Python int={} float={} d={} hm={} / 窓 int={int:?} float={fl:?} d={d} hm={hm:?}",
                c["int"], c["float"], c["d"], c["hm"]
            ));
        }
    }
    assert!(t["cases"].as_array().unwrap().len() > 400, "事例が少ない");
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
