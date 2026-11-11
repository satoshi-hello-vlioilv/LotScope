//! LotDsp の窓の部品を、Python に頼らない独立の答えで確かめる（版 3.98.0）。
//! - 9 本が共にする決まり（program/tests/fixtures/lotdsp_rules_cases.json。仕様から人が書いた答え。Python と画面も同じ表を読む）
//! - 画面の表の読み方（program/tests/fixtures/lotdsp_html_cases.json。焼いた Python 3.13.18 の答えと、Chromium の DOM の答え。
//!   DOM と違う事例は理由が書いてある物だけ）

use da_core::lotdsp::rules;
use da_core::lotdsp_html::inner_tables;
use da_core::pyjson::J;
use serde_json::Value;
use std::path::PathBuf;

fn fixture(name: &str) -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program").join("tests").join("fixtures").join(name);
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn tables_value(t: &[Vec<Vec<String>>]) -> Value {
    serde_json::to_value(t).unwrap()
}

#[test]
fn rules_cases() {
    let c = fixture("lotdsp_rules_cases.json");
    let mut bad = vec![];
    for s in c["site"].as_array().unwrap() {
        let url = s["url"].as_str().unwrap();
        for (got, want) in
            [(rules::site_base(url), &s["base"]), (rules::api_search_url(url), &s["api"]), (rules::direct_search_url(url), &s["direct"])]
        {
            if got != want.as_str().unwrap() {
                bad.push(format!("場所 {url:?}: {got} / {want}"));
            }
        }
    }
    for n in c["number"].as_array().unwrap() {
        let got = rules::to_number(&J::from_value(&n[0]));
        let want = n[1].as_f64();
        if got != want {
            bad.push(format!("数 {}: {got:?} / {want:?}", n[0]));
        }
    }
    for r in c["round_eq"].as_array().unwrap() {
        let got = rules::round_eq(r[0].as_f64().unwrap(), r[1].as_u64().unwrap() as usize, r[2].as_f64().unwrap());
        if got != r[3].as_bool().unwrap() {
            bad.push(format!("round_eq {r}"));
        }
    }
    for l in c["lot"].as_array().unwrap() {
        let got = rules::checked_lot(Some(&J::from_value(&l[0])));
        let ok = match (&got, l[1].as_str()) {
            (Ok(g), Some(w)) if w != "shape" => g == w,
            (Err(_), None) | (Err(_), Some("shape")) => true,
            _ => false,
        };
        if !ok {
            bad.push(format!("ロット番号 {}: {got:?}", l[0]));
        }
    }
    for r in c["reached"].as_array().unwrap() {
        if rules::reached_status(r[0].as_i64().unwrap()) != r[1].as_bool().unwrap() {
            bad.push(format!("届く {r}"));
        }
    }
    for b in c["body"].as_array().unwrap() {
        let raw: Vec<u8> = if let Some(h) = b["raw_hex"].as_str() {
            (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect()
        } else if let Some(d) = b["depth"].as_u64() {
            format!("{{\"a\": {}{}}}", "[".repeat(d as usize - 1), "]".repeat(d as usize - 1)).into_bytes()
        } else {
            b["raw"].as_str().unwrap().as_bytes().to_vec()
        };
        let got = rules::read_body(&raw);
        let ok = match (&got, b.get("error"), b.get("ok"), b.get("ok_keys")) {
            (Err(m), Some(e), _, _) => m == e.as_str().unwrap(),
            (Ok(v), None, Some(want), _) => v.to_value() == *want,
            (Ok(v), None, None, Some(keys)) => {
                let mut k: Vec<&str> = v.entries().iter().map(|(k, _)| k.as_str()).collect();
                k.sort();
                k == keys.as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect::<Vec<_>>()
            }
            _ => false,
        };
        if !ok {
            bad.push(format!("本文 {:?}: {got:?}", String::from_utf8_lossy(&raw).chars().take(40).collect::<String>()));
        }
    }
    assert!(bad.is_empty(), "{} 件:\n{}", bad.len(), bad.join("\n"));
}

#[test]
fn html_cases() {
    let c = fixture("lotdsp_html_cases.json");
    let cases = c["cases"].as_object().unwrap();
    assert!(cases.len() >= 50);
    let (mut bad, mut dom_same) = (vec![], 0);
    for (name, case) in cases {
        let html = match case["file"].as_str() {
            Some(f) => {
                std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixtures").join(f)).unwrap()
            }
            None => case["html"].as_str().unwrap().to_string(),
        };
        let got = match inner_tables(&html) {
            Ok(t) => tables_value(&t),
            Err(e) => {
                bad.push(format!("{name}: 読めない {e}"));
                continue;
            }
        };
        if got != case["python"] {
            bad.push(format!("{name}: 窓 {got} / Python {}", case["python"]));
        }
        // 独立の答え（ブラウザの DOM）。違う事例は理由が書いてある物だけ
        if case.get("dom_differs").is_none() {
            if got != case["dom"] {
                bad.push(format!("{name}: 窓 {got} / DOM {}", case["dom"]));
            }
            dom_same += 1;
        }
    }
    println!("{} 例・DOM と同じ {dom_same} 例", cases.len());
    assert!(bad.is_empty(), "{} 件:\n{}", bad.len(), bad.join("\n"));
}
