//! 転写距離・ピッチ計算の誤りの言葉（版 3.115.0。src/calc.rs の error_message）が、人の書いた事例の表
//! program/tests/fixtures/calc_error_cases.json と同じか（Python は tests/test_calc_errors.py が同じ表を読む）

use serde_json::Value;

#[test]
fn calc_errors_like_the_table() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/calc_error_cases.json")).unwrap();
    let mut bad = vec![];
    for c in t["cases"].as_array().unwrap() {
        let got = da_core::calc::error_message(c["type"].as_str().unwrap(), c["str"].as_str().unwrap());
        if got != c["want"].as_str().unwrap() {
            bad.push(format!("{}: 表 {} / 窓 {got}", c["why"], c["want"]));
        }
    }
    assert!(t["cases"].as_array().unwrap().len() >= 12);
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}
