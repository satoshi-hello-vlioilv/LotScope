//! 式の正規表現が読めるか（版 3.106.0。作った後の採点の割れ 4）: program/tests/fixtures/formula_regex_cases.json（Python の formula.js_regex から
//! tools/formula-regex-cases.py が焼いた 255 形）を、窓の formula::js_regex が同じに「読める・読めない」と答えるか。変換表の道（conversions_write）は
//! 式の正規表現の読めない理由を Python の re の言葉なしで答えるので、この判定が割れないことが窓が答えてよい条件
use da_core::formula::{js_regex, regex_split};
use serde_json::Value;

#[test]
fn regexes_read_like_python() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/formula_regex_cases.json")).unwrap();
    let cases = t["cases"].as_array().unwrap();
    assert!(cases.len() > 200);
    let mut bad = vec![];
    for c in cases {
        let p = c["pattern"].as_str().unwrap();
        let src: Vec<u16> = p.encode_utf16().collect();
        let got = js_regex(&src).is_ok();
        // 割れる形は、窓が Python に任せる形（regex_split）に当たること
        if Some(got) != c["ok"].as_bool() && !regex_split(p) {
            bad.push(format!("{p:?}: Python {} / 窓 {got}（{}）", c["ok"], c["why"]));
        }
    }
    assert!(bad.is_empty(), "{} 形が割れる（任せる形に当たらない）:\n{}", bad.len(), bad.join("\n"));
    let split = cases.iter().filter(|c| regex_split(c["pattern"].as_str().unwrap())).count();
    assert!(split >= 1, "後読みの形が表にある");
}
