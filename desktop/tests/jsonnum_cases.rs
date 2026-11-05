//! マスタを書く道の本文の数の字が Python と同じに読めるか（版 3.77.0）。program/tests/fixtures/jsonnum_cases.json
//! （program/tools/jsonnum-cases.py が同梱と同じ Python で焼いた表）で、窓の判定（master_rows::unreadable）を確かめる:
//! - 窓が答える（unreadable でない）物は、値の str() が Python と同じ字（マスタに置く字）
//! - Python が読み、有限の小数か i64 に入る整数（整数の -0 を除く）・真偽・null は、窓が必ず答える（任せすぎない）
//! - 字の中の数（{"v": "字"}）は数として見ない（字はどれも窓が答え、字のまま置く）
//!
//! 書く道の組（権限・勤務体系・設備・ロール）はみな同じ判定を使う。

use da_core::master_rows::unreadable;
use da_core::worksum::py_str;
use serde_json::Value;

#[test]
fn numbers_in_bodies_read_like_python() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/jsonnum_cases.json")).unwrap();
    let cases = t["cases"].as_array().unwrap();
    assert!(cases.len() >= 60, "事例が少ない");
    let mut bad = vec![];
    for c in cases {
        let s = c["s"].as_str().unwrap();
        let body = format!("{{\"v\": {s}}}");
        let plain = c["plain"].as_bool().unwrap();
        if unreadable(body.as_bytes()) {
            if plain {
                bad.push(format!("{s}: 窓が答えるべきなのに Python に任せた"));
            }
        } else {
            let got: Value = serde_json::from_str(&body).unwrap();
            if !c["loads"].as_bool().unwrap() || got["v"].is_array() {
                bad.push(format!("{s}: Python は読めないのに窓は読んだ"));
            } else if Some(py_str(&got["v"]).as_str()) != c["str"].as_str() {
                bad.push(format!("{s}: Python の str() {} / 窓 {}", c["str"], py_str(&got["v"])));
            }
        }
        // 並びの中・項目でない鍵の値でも同じ判定（数の字は本文のどこにあっても見る）
        for wrap in [format!("{{\"v\": [{s}]}}"), format!("{{\"x\": {{\"updated_by\": {s}}}, \"v\": 1}}")] {
            if plain == unreadable(wrap.as_bytes()) && c["loads"].as_bool().unwrap() {
                bad.push(format!("{wrap}: 包んだ形で判定が変わる"));
            }
        }
        // 字の中の数は見ない
        let in_str = format!("{{\"v\": {}}}", serde_json::to_string(&format!("a {s} b")).unwrap());
        if unreadable(in_str.as_bytes()) {
            bad.push(format!("{in_str}: 字の中の数で Python に任せた"));
        }
    }
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
