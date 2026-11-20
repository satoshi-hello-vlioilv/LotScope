//! CM3 のシステムのプロキシの読み方（src/sysproxy.rs）が、人が書いた事例の表 program/tests/fixtures/sysproxy_cases.json と同じか（版 3.117.1）。
//! Python は tests/test_sysproxy_cases.py が同じ表を urllib の関数に当てる。Windows の決め（nt）も Linux で流す（読み方は純粋な関数）。

use da_core::sysproxy::{self, Choice, Reg, RegVal, System};
use serde_json::{json, Value};

fn cases() -> Value {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixtures/sysproxy_cases.json");
    serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap()
}

fn env_of(c: &Value) -> Vec<(String, String)> {
    c["env"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|x| (x[0].as_str().unwrap().to_string(), x[1].as_str().unwrap().to_string()))
        .collect()
}

fn val(v: Option<&Value>) -> Option<RegVal> {
    match v? {
        Value::Number(n) => Some(RegVal::Int(n.as_i64().unwrap())),
        Value::String(s) => Some(RegVal::Str(s.clone())),
        _ => None,
    }
}

fn reg_of(c: &Value) -> Option<Reg> {
    let r = c.get("reg")?.as_object()?;
    Some(Reg {
        enable: val(r.get("ProxyEnable")),
        server: val(r.get("ProxyServer")),
        overrides: val(r.get("ProxyOverride")),
        autoconfig: val(r.get("AutoConfigURL")),
    })
}

fn sys_of(c: &Value) -> System {
    System { env: env_of(c), reg: reg_of(c), nt: c["nt"].as_bool().unwrap_or(false) }
}

fn pairs(v: &[(String, String)]) -> Value {
    json!(v.iter().map(|(k, x)| json!([k, x])).collect::<Vec<_>>())
}

#[test]
fn reads_like_the_table() {
    let t = cases();
    let mut bad = vec![];
    let mut n = 0;
    for c in t["env"].as_array().unwrap() {
        n += 1;
        let got = pairs(&sysproxy::env_proxies(&env_of(c), c["nt"].as_bool().unwrap()));
        if got != c["want"] {
            bad.push(format!("env {}: 表 {} / 窓 {got}", c["name"], c["want"]));
        }
    }
    for c in t["registry"].as_array().unwrap() {
        n += 1;
        let got = reg_of(c).map(|r| pairs(&sysproxy::reg_proxies(&r))).unwrap_or(json!([]));
        if got != c["want"] {
            bad.push(format!("registry {}: 表 {} / 窓 {got}", c["name"], c["want"]));
        }
    }
    for c in t["bypass"].as_array().unwrap() {
        n += 1;
        let got = sysproxy::bypass(c["host"].as_str().unwrap(), &sys_of(c));
        if json!(got) != c["want"] {
            bad.push(format!("bypass {}: 表 {} / 窓 {got}", c["name"], c["want"]));
        }
    }
    for c in t["choose"].as_array().unwrap() {
        n += 1;
        let sys = sys_of(c);
        let got = match sysproxy::choose(c["url_type"].as_str().unwrap(), c["host"].as_str().unwrap(), &sys.proxies(), &|h| sys.bypass(h)) {
            Ok(Choice::Direct) => Value::Null,
            Ok(Choice::Proxy(hp)) => json!(hp),
            Err(e) => json!({"error": e}),
        };
        if got != c["want"] {
            bad.push(format!("choose {}: 表 {} / 窓 {got}", c["name"], c["want"]));
        }
    }
    for c in t["pac"].as_array().unwrap() {
        n += 1;
        let got = sysproxy::pac_note(&sys_of(c));
        if json!(got) != c["want"] {
            bad.push(format!("pac {}: 表 {} / 窓 {got}", c["name"], c["want"]));
        }
    }
    eprintln!("事例 {n}");
    assert!(n >= 70, "事例が少ない: {n}");
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// この PC の設定（Windows は HKCU のレジストリ）を読める（Windows の CI の本物の段は .github/workflows/desktop.yml が設定を書いて比べる）
#[test]
fn reads_this_pc() {
    let sys = System::read();
    assert_eq!(sys.nt, cfg!(windows));
    let _ = sys.proxies();
}
