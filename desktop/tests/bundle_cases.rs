//! 設定の束の節（版 3.102.0）: 節が使うマスタ（src/bundle.rs の SECTIONS）と道が使う節（src/lot.rs の sections_for）が、
//! 事例の表 program/tests/fixtures/bundle_cases.json と同じか（Python の routes/lotlist.SECTIONS は tests/test_bundle_sections.py が同じ表と比べる）。
//! 組めない節を使う道だけを断る（ほかの道は答え続ける）決まりを 1 つの表にする。

use da_core::bundle::SECTIONS;
use da_core::lot::sections_for;
use serde_json::{json, Value};

#[test]
fn sections_and_routes_are_like_the_table() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/bundle_cases.json")).unwrap();
    let mine: serde_json::Map<String, Value> = SECTIONS.iter().map(|(n, f)| (n.to_string(), json!(f))).collect();
    assert_eq!(Value::Object(mine), t["sections"], "節が使うマスタ");
    for r in t["routes"].as_array().unwrap() {
        let got = sections_for(r["path"].as_str().unwrap(), r["conv"].as_bool().unwrap());
        assert_eq!(json!(got), r["need"], "{}", r);
    }
}
