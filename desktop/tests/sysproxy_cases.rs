//! CM3 のシステムのプロキシの読み方（src/sysproxy.rs）が、人が書いた事例の表 program/tests/fixtures/sysproxy_cases.json と同じか（版 3.117.1）。
//! Python は tests/test_sysproxy_cases.py が同じ表を urllib の関数に当てる。env・bypass・choose・pac の事例は posix と nt（Windows）の
//! 2 つの答えを持ち、どの OS で流しても両方を確かめる（読み方は nt を選ぶ純粋な関数。版 3.117.1 の作った後の直し・割れ 1）。

use da_core::sysproxy::{self, Choice, Reg, RegVal, System};
use serde_json::{json, Value};

fn cases() -> Value {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixtures/sysproxy_cases.json");
    serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap()
}

fn env_of(c: &Value) -> Vec<(String, String)> {
    c["env"].as_array().into_iter().flatten().map(|x| (x[0].as_str().unwrap().to_string(), x[1].as_str().unwrap().to_string())).collect()
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

fn sys_of(c: &Value, nt: bool) -> System {
    System { env: env_of(c), reg: reg_of(c), nt }
}

/// 事例の 2 つの OS（名前・nt か・その OS の答え）
fn both(c: &Value) -> [(&'static str, bool, &Value); 2] {
    assert!(c.get("nt").is_none(), "事例 {} に nt の印が残っている（答えは want の posix と nt に持つ）", c["name"]);
    [("posix", false, &c["want"]["posix"]), ("nt", true, &c["want"]["nt"])]
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
        for (os, nt, want) in both(c) {
            n += 1;
            let got = pairs(&sysproxy::env_proxies(&env_of(c), nt));
            if got != *want {
                bad.push(format!("env {} ({os}): 表 {want} / 窓 {got}", c["name"]));
            }
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
        for (os, nt, want) in both(c) {
            n += 1;
            let got = sysproxy::bypass(c["host"].as_str().unwrap(), &sys_of(c, nt));
            if json!(got) != *want {
                bad.push(format!("bypass {} ({os}): 表 {want} / 窓 {got}", c["name"]));
            }
        }
    }
    for c in t["choose"].as_array().unwrap() {
        for (os, nt, want) in both(c) {
            n += 1;
            let sys = sys_of(c, nt);
            let got =
                match sysproxy::choose(c["url_type"].as_str().unwrap(), c["host"].as_str().unwrap(), &sys.proxies(), &|h| sys.bypass(h)) {
                    Ok(Choice::Direct) => Value::Null,
                    Ok(Choice::Proxy(hp)) => json!(hp),
                    Err(e) => json!({"error": e}),
                };
            if got != *want {
                bad.push(format!("choose {} ({os}): 表 {want} / 窓 {got}", c["name"]));
            }
        }
    }
    for c in t["pac"].as_array().unwrap() {
        for (os, nt, want) in both(c) {
            n += 1;
            let got = sysproxy::pac_note(&sys_of(c, nt));
            if json!(got) != *want {
                bad.push(format!("pac {} ({os}): 表 {want} / 窓 {got}", c["name"]));
            }
        }
    }
    eprintln!("事例 {n}");
    assert!(n >= 130, "事例が少ない: {n}");
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// この PC の設定（Windows は HKCU のレジストリ）を読める（Windows の CI の本物の段は .github/workflows/desktop.yml が設定を書いて比べる）
#[test]
fn reads_this_pc() {
    let sys = System::read();
    assert_eq!(sys.nt, cfg!(windows));
    let _ = sys.proxies();
}

/// Windows の CI の段「TLS とプロキシを Windows の本物で（③-6）」だけ（HKCU の Internet Settings を書いてから流す。TPA_SYSPROXY_REAL=1 か pac）:
/// 窓のレジストリの読み（System::read）が、同じ機械の Windows の Python の urllib.request.getproxies・proxy_bypass と、
/// app の services/sysproxy.pac_note（PAC の一言。winreg を本当に読む。版 3.117.1 の作った後の直し・割れ 6: 前は窓の答えを定数と比べるだけで、
/// Python の winreg の読みはどこでも流れていなかった）と同じ答えか。落ちたときは期待（Python）と来た物（窓）を出す（手元の Linux では流せない）
#[test]
#[ignore = "Windows の CI の段が HKCU に書いてから流す"]
fn the_real_registry_reads_like_windows_python() {
    let mode = std::env::var("TPA_SYSPROXY_REAL").unwrap_or_default();
    assert!(cfg!(windows) && !mode.is_empty(), "Windows の CI の段（TPA_SYSPROXY_REAL）だけで流す");
    let hosts = ["nlmfangyweb1a:9085", "cm3.corp.example", "Cm3.CORP.Example:443", "10.1.2.3:80", "x.other.example", "corp.example"];
    let program = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
    let script = format!(
        "import json, sys, urllib.request as u\nsys.path.insert(0, {program:?})\nfrom app.services import sysproxy\nhosts = {hosts:?}\n\
         print(json.dumps({{'proxies': [[k, v] for k, v in u.getproxies().items()], 'bypass': {{h: bool(u.proxy_bypass(h)) for h in hosts}}, \
         'pac': sysproxy.pac_note()}}))",
        program = program.to_string_lossy()
    );
    let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| "python".into());
    let out = std::process::Command::new(&py).arg("-c").arg(&script).output().expect("Windows の Python を起こせません");
    assert!(out.status.success(), "Windows の Python: {}", String::from_utf8_lossy(&out.stderr));
    let want: Value = serde_json::from_slice(&out.stdout).unwrap();
    let sys = System::read();
    println!("窓が読んだレジストリ: {:?}", sys.reg);
    let got_proxies = pairs(&sys.proxies());
    println!("getproxies 期待（Windows の Python） {} / 来た（窓） {got_proxies}", want["proxies"]);
    let mut bad = vec![];
    if got_proxies != want["proxies"] {
        bad.push(format!("getproxies: 期待 {} / 来た {got_proxies}", want["proxies"]));
    }
    for h in hosts {
        let g = sys.bypass(h);
        println!("proxy_bypass({h}) 期待 {} / 来た {g}", want["bypass"][h]);
        if json!(g) != want["bypass"][h] {
            bad.push(format!("proxy_bypass({h}): 期待 {} / 来た {g}", want["bypass"][h]));
        }
    }
    // PAC の一言: Windows の Python の pac_note（winreg）と窓の pac_note が同じ。pac の形では一言が出る（ProxyEnable 0・AutoConfigURL あり）、
    // 1 の形では出ない（ProxyEnable 1）
    let note = da_core::sysproxy::pac_note(&sys);
    println!("PAC の一言 期待（Windows の Python）「{}」/ 来た（窓）「{note}」", want["pac"]);
    if json!(note) != want["pac"] {
        bad.push(format!("PAC の一言: 期待（Windows の Python）「{}」/ 来た（窓）「{note}」", want["pac"]));
    }
    let expect_note = if mode == "pac" { da_core::sysproxy::PAC_NOTE } else { "" };
    if want["pac"] != json!(expect_note) {
        bad.push(format!("PAC の一言が段の書いた設定と違う（Windows の Python「{}」/ 段の設定なら「{expect_note}」）", want["pac"]));
    }
    if mode != "pac" && !want["proxies"].as_array().is_some_and(|a| !a.is_empty()) {
        bad.push("段が書いたプロキシの設定を Python が読んでいない（段の書き方を確かめる）".into());
    }
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
