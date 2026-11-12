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

/// 本文の欄の型と中身の欄の門（版 3.106.0。D2・A2）: program/tests/fixtures/body_type_cases.json（仕様から人が書いた答え）を窓の門
/// （body::gate。表は Python の body_rules.TYPES を焼いた src/body_routes.json）が同じに答えるか。Python は tests/test_body_types.py。
/// passed は窓が部品へ渡す本文の欄（中身の字の整数の -0 を 0 に書き直した字）
#[test]
fn types_like_the_table() {
    use da_core::body::{gate, Gate};
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/body_type_cases.json")).unwrap();
    let cases = t["cases"].as_array().unwrap();
    assert!(cases.len() > 60, "事例が少ない");
    let mut bad = vec![];
    for c in cases {
        let (m, p, raw) = (c["method"].as_str().unwrap(), c["path"].as_str().unwrap(), c["raw"].as_str().unwrap());
        let (got, passed) = match gate(m, p, raw.as_bytes()) {
            Gate::Pass(b) => (json!({"ok": true}), serde_json::from_slice::<Value>(&b).ok()),
            Gate::Refuse(st, v) => {
                assert_eq!(st, 400, "{}", c["name"]);
                assert_eq!(v["kind"], "body", "{}", c["name"]);
                (json!({"error": v["error"]}), None)
            }
        };
        if got != c["want"] {
            bad.push(format!("{}: 表 {} / 窓 {got}", c["name"].as_str().unwrap(), c["want"]));
        }
        for (k, want) in c["passed"].as_object().into_iter().flatten() {
            let had = passed.as_ref().map(|v| v[k.as_str()].clone());
            if had.as_ref() != Some(want) {
                bad.push(format!("{} [渡す {k}]: 表 {want} / 窓 {had:?}", c["name"].as_str().unwrap()));
            }
        }
    }
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 置き場の字・中身の字の整数の -0 を 0 に書き直す読み手（master_rows::inner_text。版 3.106.0）: 字の中・-0.0・-0e5・-01 は替えない
#[test]
fn minus_zero_reader() {
    use da_core::master_rows::{has_int_minus_zero, inner_text};
    for (src, want) in [
        (r#"{"a": -0}"#, r#"{"a": 0}"#),
        (r#"[-0,-0 , -0]"#, r#"[0,0 , 0]"#),
        (r#"{"s": "-0", "f": -0.0, "e": -0e5, "E": -0E1}"#, r#"{"s": "-0", "f": -0.0, "e": -0e5, "E": -0E1}"#),
        (r#"{"q": "a\"-0", "x": -0}"#, r#"{"q": "a\"-0", "x": 0}"#),
        (r#"{"n": -10, "m": -0}"#, r#"{"n": -10, "m": 0}"#),
    ] {
        assert_eq!(inner_text(src), want, "{src}");
        assert_eq!(has_int_minus_zero(src.as_bytes()), src != want, "{src}");
    }
}
