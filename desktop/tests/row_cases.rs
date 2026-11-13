//! 置き場の読めない行を隔てる決まり（版 3.107.0。src/row_check.rs と src/held.rs）を、人が仕様から書いた事例の表
//! program/tests/fixtures/row_cases.json と突き合わせる（Python は program/tests/test_row_cases.py が同じ表を読む）。

use da_core::row_check;
use serde_json::{json, Value};

#[test]
fn rows_are_isolated_like_the_table() {
    let table: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/row_cases.json")).unwrap();
    let mut bad = vec![];
    for c in table["cases"].as_array().unwrap() {
        let master = c["master"].as_str().unwrap();
        let mut rows = vec![da_core::held::parse(c["raw"].as_str().unwrap()).expect("raw は J で読める")];
        row_check::normalize_like_specs(master, &mut rows);
        let iso = row_check::check(master, &rows, row_check::fields_of(master));
        let got = iso.first().map(|(_, _, w)| json!(w)).unwrap_or(Value::Null);
        if got != c["why"] {
            bad.push(format!("{}: 窓 {got}（表 {}）", c["name"], c["why"]));
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

#[test]
fn next_id_counts_isolated_rows() {
    // 次の id は隔てた行の id も int() が読めれば数える（Python の master_store.next_id と同じ）
    use da_core::master_store::next_id;
    assert_eq!(next_id(&[json!({"id": 1}), json!({"id": "4"}), json!({"id": "abc"}), json!({"id": ["x"]})]), json!(5));
    assert_eq!(next_id(&[json!({"id": 1e19})]), json!(10000000000000000001u64));
    assert_eq!(next_id(&[json!({"id": true}), json!({"id": null})]), json!(2));
}
