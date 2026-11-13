//! 変換表の式の入れ子の数え方（版 3.106.0。作った後の採点の割れ 3）: program/tests/fixtures/nest_cases.json（仕様から人が書いた答え。Python は
//! tests/test_nest_cases.py）を、窓の formula::nest_count が同じに数え、上限が conversions_write::NEST_MAX と同じか。上限ちょうどの式を窓が読めること
use da_core::conversions_write::NEST_MAX;
use da_core::formula::{nest_count, Formula};
use serde_json::Value;

#[test]
fn nesting_counts_like_the_table() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/nest_cases.json")).unwrap();
    assert_eq!(t["max"].as_u64(), Some(NEST_MAX as u64));
    let mut bad = vec![];
    for c in t["cases"].as_array().unwrap() {
        let got = nest_count(c["src"].as_str().unwrap());
        if Some(got as u64) != c["count"].as_u64() {
            bad.push(format!("{}: 表 {} / 窓 {got}", c["name"], c["count"]));
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
    let deep = format!("{}1{}", "(".repeat(NEST_MAX), ")".repeat(NEST_MAX));
    assert!(Formula::compile(&deep).is_ok(), "上限ちょうどのかっこを窓が読める");
    let not = format!("{}1", "not ".repeat(NEST_MAX));
    assert!(Formula::compile(&not).is_ok(), "上限ちょうどの not を窓が読める");
}
