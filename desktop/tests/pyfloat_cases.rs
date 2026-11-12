//! 窓の小数の書き手（pyfmt::float_repr・join::py_dumps）が Python 3.13 の repr・json.dumps と同じ字を書くか（版 3.80.0）。
//! 表は program/tests/fixtures/pyfloat_cases.json（program/tools/pyfloat-cases.py が焼く。古い表は program/tests/test_pyfloat_cases.py が止める）。
//! 前の float_repr（Rust の {:e} のいちばん短い字のまま）は、丁度まん中の値で Python と逆に丸めた。前の py_dumps は小数を serde の字
//! （0.00001・1e16）で書いた。どちらも、ここで食い違いの数として見える。
//! 版 3.105.0 から表の fields（欄の値の str()・str(v or "")）で、書く道の欄の値の字（worksum::py_str）と答えるかの決め
//! （master_rows::unreadable_u64_ok・worksum::str_plain）も確かめる

use da_core::join::py_dumps;
use da_core::master_rows::unreadable_u64_ok;
use da_core::pyfmt::float_repr;
use da_core::worksum::{py_str, str_plain, truthy};
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

/// 欄の値の JSON の字 → (Python の str(値), str(値 or ""))（表の fields。版 3.105.0）
fn fields() -> Vec<(String, String, String)> {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/pyfloat_cases.json")).unwrap();
    let f = t["fields"].as_array().expect("表に fields が無い（python program/tools/pyfloat-cases.py で作り直す）");
    f.iter().map(|c| (c[0].as_str().unwrap().into(), c[1].as_str().unwrap().into(), c[2].as_str().unwrap().into())).collect()
}

/// serde が値をそのまま持てる字か（小数の字・u64 までの整数・真偽・null・字）。u64 を超える整数の字は serde が小数に読むので持てない
fn serde_exact(s: &str) -> bool {
    if s.contains(['.', 'e', 'E']) || !s.starts_with(|c: char| c == '-' || c.is_ascii_digit()) {
        return true;
    }
    s.parse::<i128>().is_ok_and(|n| n >= i64::MIN as i128 && n <= u64::MAX as i128)
}

/// worksum::py_str が、serde がそのまま持てる値で Python の str() と同じ字を書くか（前は as_i64 だけを見て、i64 に入らない u64 の整数を
/// 小数の字 9.223372036854776e+18 にした）
#[test]
fn field_values_are_written_like_python() {
    let mut bad = vec![];
    for (s, want, want_or) in fields() {
        if !serde_exact(&s) {
            continue;
        }
        let v: Value = serde_json::from_str(&s).unwrap();
        if py_str(&v) != want {
            bad.push(format!("{s}: str() Python {want} / 窓 {}", py_str(&v)));
        }
        let or = if truthy(&v) { py_str(&v) } else { String::new() };
        if or != want_or {
            bad.push(format!("{s}: str(v or \"\") Python {want_or:?} / 窓 {or:?}"));
        }
    }
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 書く道（共有の書式・ダッシュボードのセット・設備とロール）が欄の値を窓で答えるかの決め（master_rows::unreadable_u64_ok と
/// worksum::str_plain）: 答えるのは serde がそのまま持てる値だけ（u64 を超える整数の字は任せる）で、その値はみな答える（任せすぎない）。
/// 包んだ形（並びの中・ほかの鍵の下）でも決めは同じ
#[test]
fn field_values_are_answered_only_when_exact() {
    let mut bad = vec![];
    for (s, _, _) in fields() {
        for body in [format!("{{\"v\": {s}}}"), format!("{{\"x\": [{s}], \"v\": 1}}"), format!("{{\"x\": {{\"y\": {s}}}, \"v\": 1}}")] {
            let answered = !unreadable_u64_ok(body.as_bytes())
                && serde_json::from_str::<Value>(&body).unwrap()["v"].as_object().is_none()
                && str_plain(&serde_json::from_str::<Value>(&body).unwrap()["v"]);
            if answered != serde_exact(&s) {
                bad.push(format!("{body}: 窓が答える {answered} / 答えるべき {}", serde_exact(&s)));
            }
        }
    }
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
