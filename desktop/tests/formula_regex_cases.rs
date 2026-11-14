//! 式の正規表現が読めるか（版 3.106.0。作った後の採点の割れ 4。版 3.113.0 から正しい答え want と比べる）: program/tests/fixtures/formula_regex_cases.json
//! （tools/formula-regex-cases.py が Python の formula.js_regex と画面の JavaScript から焼いた形）を、窓の formula::js_regex が want と同じに
//! 「読める・読めない」と答えるか。want は「画面の JavaScript が読み、サーバーも計算できる」（js かつ ok）。変換表の道（conversions_write）は
//! 式の正規表現の読めない理由を Python の re の言葉なしで答え、版 3.113.0 から後読みの式も Python に任せない（前の formula::regex_split）
use da_core::formula::js_regex;
use serde_json::Value;

#[test]
fn regexes_read_like_the_table() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/formula_regex_cases.json")).unwrap();
    let cases = t["cases"].as_array().unwrap();
    assert!(cases.len() > 260);
    let mut bad = vec![];
    for c in cases {
        let p = c["pattern"].as_str().unwrap();
        let src: Vec<u16> = p.encode_utf16().collect();
        let got = js_regex(&src).is_ok();
        if Some(got) != c["want"].as_bool() {
            bad.push(format!("{p:?}: want {} / 窓 {got}（Python {} {}・画面 {}）", c["want"], c["ok"], c["why"], c["js"]));
        }
    }
    assert!(bad.is_empty(), "{} 形が正しい答えと割れる:\n{}", bad.len(), bad.join("\n"));
    // 画面だけが読む形（長さの決まらない後読み）が表にあり、窓は断る
    let js_only = cases.iter().filter(|c| c["js"] == true && c["want"] == false).count();
    assert!(js_only >= 3, "画面だけが読む後読みの形が表にある: {js_only}");
    let split = cases.iter().filter(|c| c["pattern"].as_str().is_some_and(|p| p.contains("(?<=") && p.contains('|')) && c["want"] == true).count();
    assert!(split >= 3, "枝の長さの違う後読みが読める形で表にある: {split}");
}
