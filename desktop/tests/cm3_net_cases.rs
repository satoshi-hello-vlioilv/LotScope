//! CM3 に届かないときの言葉（src/cm3_net.rs）が、人が書いた事例の表 program/tests/fixtures/cm3_net_cases.json と同じか（版 3.117.1）。
//! Python は tests/test_cm3_net_cases.py が同じ表を app/services/cm3_net.py に当てる。

use da_core::cm3_net::{self, Kind};
use serde_json::Value;

fn cases() -> Value {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixtures/cm3_net_cases.json");
    serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap()
}

fn kind(v: &Value) -> Kind {
    Kind::of_name(v.as_str().unwrap()).unwrap_or_else(|| panic!("知らない種類 {v}"))
}

fn hex(v: &Value) -> u32 {
    u32::from_str_radix(v.as_str().unwrap().trim_start_matches("0x"), 16).unwrap()
}

#[test]
fn words_like_the_table() {
    let t = cases();
    let mut bad = vec![];
    assert_eq!(cm3_net::HINT, t["hint"]);
    assert_eq!(da_core::sysproxy::PAC_NOTE, t["pac"]);
    for c in t["messages"].as_array().unwrap() {
        let got = cm3_net::message(kind(&c["kind"]), c["detail"].as_str().unwrap(), c["note"].as_str().unwrap());
        if got != c["want"] {
            bad.push(format!("messages {}: 表 {} / 窓 {got}", c["kind"], c["want"]));
        }
    }
    for c in t["openssl"].as_array().unwrap() {
        let got = cm3_net::kind_of_openssl(c["text"].as_str().unwrap());
        if got != kind(&c["kind"]) {
            bad.push(format!("openssl {}: 表 {} / 窓 {}", c["name"], c["kind"], got.name()));
        }
    }
    for c in t["schannel"].as_array().unwrap() {
        let got = cm3_net::kind_of_schannel(hex(&c["code"]));
        if got != kind(&c["kind"]) {
            bad.push(format!("schannel {}: 表 {} / 窓 {}", c["name"], c["kind"], got.name()));
        }
    }
    for c in t["schannelText"].as_array().unwrap() {
        let got = cm3_net::os_error_code(c["text"].as_str().unwrap()).map(|n| n as u32);
        let want = (!c["code"].is_null()).then(|| hex(&c["code"]));
        if got != want {
            bad.push(format!("schannelText {}: 表 {want:?} / 窓 {got:?}", c["name"]));
        }
    }
    // 窓の持つ schannel の番号の表は、事例の表に全部ある（足すなら表にも）
    for (code, k) in cm3_net::SCHANNEL {
        let hit = t["schannel"].as_array().unwrap().iter().any(|c| hex(&c["code"]) == code && kind(&c["kind"]) == k);
        if !hit {
            bad.push(format!("schannel 0x{code:08X} {} が表に無い", k.name()));
        }
    }
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
