//! 本文の読み方が事例の表と同じか（版 3.104.0）。program/tests/fixtures/body_cases.json（仕様から人が書いた答え。Python は
//! tests/test_body_cases.py で同じ表を読む）を、窓の src/body.rs の read が門の引数ごと（read・need・lotdsp）に同じに読むかを突き合わせる。
//! 読んだ値は json.dumps(ensure_ascii=False) の字（pyjson::J::dumps）で比べる。

use da_core::body::{mode_of, read, unquote, GATE_NEED, GATE_READ, LOTDSP};
use serde_json::{json, Value};

#[test]
fn bodies_read_like_the_table() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/body_cases.json")).unwrap();
    let cases = t["cases"].as_array().unwrap();
    assert!(cases.len() > 40, "事例が少ない");
    let mut bad = vec![];
    for c in cases {
        let raw: Vec<u8> = match c["hex"].as_str() {
            Some(h) => (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect(),
            None => c["raw"].as_str().unwrap().as_bytes().to_vec(),
        };
        for (mode, want) in c["want"].as_object().unwrap() {
            let rules = match mode.as_str() {
                "read" => GATE_READ,
                "need" => GATE_NEED,
                _ => LOTDSP,
            };
            let got = match read(&raw, &rules) {
                Ok(v) => json!({"ok": v.dumps(None)}),
                Err(e) => json!({"error": e}),
            };
            if &got != want {
                bad.push(format!("{} [{mode}]: 表 {want} / 窓 {got}", c["name"].as_str().unwrap()));
            }
        }
    }
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 道ごとの門と、百分率符号を戻した道（版 3.104.0 の作った後の採点: <path:…> の 2 字目から先の改行・「%+1」）。Python は test_body_cases.py
#[test]
fn routes_and_unquote_like_the_table() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/body_cases.json")).unwrap();
    let mut bad = vec![];
    for c in t["routes"].as_array().unwrap() {
        let (m, p) = (c["method"].as_str().unwrap(), c["path"].as_str().unwrap());
        let got = mode_of(m, p);
        if got != c["mode"].as_str() {
            bad.push(format!("{m} {p}: 表 {} / 窓 {got:?}", c["mode"]));
        }
    }
    for c in t["unquote"].as_array().unwrap() {
        let got = unquote(c["in"].as_str().unwrap());
        if got != c["out"].as_str().unwrap() {
            bad.push(format!("unquote {}: 表 {} / 窓 {got:?}", c["in"], c["out"]));
        }
    }
    assert!(t["routes"].as_array().unwrap().len() >= 15);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
