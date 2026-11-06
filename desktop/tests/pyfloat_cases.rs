//! 窓の小数の書き手（pyfmt::float_repr・join::py_dumps）が Python 3.13 の repr・json.dumps と同じ字を書くか（版 3.80.0）。
//! 表は program/tests/fixtures/pyfloat_cases.json（program/tools/pyfloat-cases.py が焼く。古い表は program/tests/test_pyfloat_cases.py が止める）。
//! 前の float_repr（Rust の {:e} のいちばん短い字のまま）は、丁度まん中の値で Python と逆に丸めた。前の py_dumps は小数を serde の字
//! （0.00001・1e16）で書いた。どちらも、ここで食い違いの数として見える

use da_core::join::py_dumps;
use da_core::pyfmt::float_repr;
use serde_json::{json, Value};

/// 前の float_repr（{:e} の字のまま。丁度まん中の値で上へ丸める）。直したことが表で見えるかを確かめるため
fn old_repr(f: f64) -> String {
    let e = format!("{:e}", f.abs());
    let (mant, exp) = e.split_once('e').unwrap();
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let decpt: i32 = exp.parse::<i32>().unwrap() + 1;
    let n = digits.len() as i32;
    let sign = if f.is_sign_negative() { "-" } else { "" };
    let body = if -4 < decpt && decpt <= 16 {
        if decpt <= 0 {
            format!("0.{}{}", "0".repeat((-decpt) as usize), digits)
        } else if decpt >= n {
            format!("{}{}.0", digits, "0".repeat((decpt - n) as usize))
        } else {
            format!("{}.{}", &digits[..decpt as usize], &digits[decpt as usize..])
        }
    } else {
        let m = if n > 1 { format!("{}.{}", &digits[..1], &digits[1..]) } else { digits.clone() };
        let x = decpt - 1;
        format!("{m}e{}{:02}", if x < 0 { '-' } else { '+' }, x.abs())
    };
    format!("{sign}{body}")
}

#[test]
fn floats_are_written_like_python() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/pyfloat_cases.json")).unwrap();
    let cases = t["cases"].as_array().unwrap();
    assert!(cases.len() > 5000, "表が小さい: {}", cases.len());
    let (mut bad, mut old_bad, mut old_dumps) = (vec![], 0, 0);
    for c in cases {
        let bits = u64::from_str_radix(c[0].as_str().unwrap(), 16).unwrap();
        let f = f64::from_bits(bits);
        let (repr, dumps) = (c[1].as_str().unwrap(), c[2].as_str().unwrap());
        if float_repr(f) != repr {
            bad.push(format!("{f:e}: repr Python {repr} / 窓 {}", float_repr(f)));
        }
        if py_dumps(&json!(f)) != dumps {
            bad.push(format!("{f:e}: json.dumps Python {dumps} / 窓 {}", py_dumps(&json!(f))));
        }
        old_bad += (old_repr(f) != repr) as usize;
        old_dumps += (serde_json::Number::from_f64(f).map(|n| n.to_string()).unwrap_or_default() != dumps) as usize;
    }
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.iter().take(20).cloned().collect::<Vec<_>>().join("\n"));
    // 前の書き手は表で食い違う（表が欠けを見せられる。消えたら表の値が足りない）
    assert!(old_bad > 0 && old_dumps > 0, "前の書き手でも食い違いが見えない（repr {old_bad}・dumps {old_dumps}）: 表を見直す");
    eprintln!("前の書き手の食い違い: repr {old_bad} 件・json.dumps {old_dumps} 件（今は 0 件）");
}
