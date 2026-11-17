//! 道の字の門（版 3.114.0。src/path_gate.rs）が事例の表 tests/fixtures/ospath_cases.json のとおりに答えるか。Python の
//! services/path_rules.py は tests/test_ospath_cases.py で同じ表を読む。表は人が仕様と OS の決まりから書いた答え（want）と、版 3.113.0 の
//! Python の答え（py）を並べる。種類（browse・dir・name）× OS（posix・nt）。POSIX と Windows の両方の決まりを 1 つの PC で突き合わせ、
//! GetFullPathNameW で整える事例（win32）は Windows でだけ流す（Windows の CI）。

use da_core::path_gate::{apply, gate, Env, Kind, Passwd};
use serde_json::Value;
use std::collections::HashMap;

fn table() -> Value {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixtures/ospath_cases.json");
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn strs(v: &Value) -> HashMap<String, String> {
    v.as_object().into_iter().flatten().filter_map(|(k, x)| x.as_str().map(|s| (k.clone(), s.to_string()))).collect()
}

fn env_of(t: &Value, case: &Value, col: &str) -> Env {
    let mut base = t["env"][col].as_object().unwrap().clone();
    for (k, v) in case[col]["env"].as_object().into_iter().flatten() {
        base.insert(k.clone(), v.clone());
    }
    let base = Value::Object(base);
    if col == "nt" {
        return Env {
            nt: true,
            vars: strs(&base["env"]),
            passwd: Passwd::Table(HashMap::new(), None),
            cwd: base["cwd"].as_str().unwrap().into(),
            win32: cfg!(windows),
        };
    }
    let uid = base["uid"].as_str().map(String::from);
    Env {
        nt: false,
        vars: strs(&base["env"]),
        passwd: Passwd::Table(strs(&base["passwd"]), uid),
        cwd: base["cwd"].as_str().unwrap().into(),
        win32: false,
    }
}

#[test]
fn messages_are_the_gates() {
    let t = table();
    let m = &t["messages"];
    for (k, v) in [
        ("E_CTRL", da_core::path_gate::E_CTRL),
        ("E_DEVICE", da_core::path_gate::E_DEVICE),
        ("E_DEVICE_TRIM", da_core::path_gate::E_DEVICE_TRIM),
        ("E_DRIVE_REL", da_core::path_gate::E_DRIVE_REL),
        ("E_LONG_POSIX", da_core::path_gate::E_LONG_POSIX),
        ("E_LONG_NT", da_core::path_gate::E_LONG_NT),
        ("E_PATH_POSIX", da_core::path_gate::E_PATH_POSIX),
        ("E_URL_BRACKET", da_core::path_gate::E_URL_BRACKET),
        ("E_URL_HOST", da_core::path_gate::E_URL_HOST),
        ("E_FULL", da_core::path_gate::E_FULL),
        ("E_REL_TRIM", da_core::path_gate::E_REL_TRIM),
    ] {
        assert_eq!(m[k].as_str(), Some(v), "{k}");
    }
    assert_eq!(m.as_object().unwrap().len(), 11);
}

#[test]
fn gate_answers_like_the_table() {
    let t = table();
    let (mut bad, mut ran) = (vec![], 0);
    for c in t["cases"].as_array().unwrap() {
        let kind = Kind::of(c["kind"].as_str().unwrap()).unwrap();
        let text = c["text"].as_str().unwrap();
        for col in ["posix", "nt"] {
            if c["win32"] == true && col == "nt" && !cfg!(windows) {
                continue;
            }
            ran += 1;
            let want = &c[col]["want"];
            let exp: Result<String, String> = match want.get("no") {
                Some(k) => Err(t["messages"][k.as_str().unwrap()].as_str().unwrap().into()),
                None if want["os"] == true => Ok(os_answer(kind, text)),
                None => Ok(want["ok"].as_str().unwrap_or(text).to_string()),
            };
            let got = gate(kind, text, &env_of(&t, c, col));
            if got != exp {
                bad.push(format!("{} {text:?} {col}: 表 {exp:?} / 門 {got:?}", c["kind"]));
            }
        }
    }
    assert!(ran >= 210, "事例が少ない: {ran}");
    assert!(bad.is_empty(), "{} 件:\n{}", bad.len(), bad.join("\n"));
}

/// 欄の並びごとの門（apply）: 名前が check_name で断られる・上のフォルダが空なら後ろの欄を見ない（作った後の採点の割れ 4。stops を外すと落ちる）
#[test]
fn apply_answers_like_the_routes() {
    let t = table();
    let mut bad = vec![];
    for r in t["routes"].as_array().unwrap() {
        for col in ["posix", "nt"] {
            let want = &r[col];
            let mut v: HashMap<String, String> = strs(&r["values"]);
            let got = apply("POST", r["rule"].as_str().unwrap(), &mut v, &env_of(&t, &Value::Null, col)).map(|_| v);
            let exp: Result<HashMap<String, String>, String> = match want.get("no") {
                Some(k) => Err(t["messages"][k.as_str().unwrap()].as_str().unwrap().into()),
                None => {
                    let mut e = strs(&r["values"]);
                    e.extend(strs(&want["ok"]));
                    Ok(e)
                }
            };
            if got != exp {
                bad.push(format!("{} {col}: 表 {exp:?} / 門 {got:?}", r["why"]));
            }
        }
    }
    assert!(t["routes"].as_array().unwrap().len() >= 9);
    assert!(bad.is_empty(), "{} 件:\n{}", bad.len(), bad.join("\n"));
}

/// want が os の事例（Microsoft の文書が決めていない形）の正しい答え: Windows の GetFullPathNameW そのもの（門の前段〈前後の空白と引用符・
/// 装置の道〉と「参照…」の整え〈tidy〉だけを足す）。Windows でだけ呼ぶ
fn os_answer(kind: Kind, text: &str) -> String {
    let pre = da_core::path_gate::device(da_core::pyfmt::strip(&da_core::lists::unquote_path(text)).trim_matches('\''), true).unwrap();
    let full = |p: &str| da_core::path_gate::full_path_name(p).expect("GetFullPathNameW");
    match kind {
        Kind::Browse => {
            let t = da_core::folder_browse::tidy_for(&pre, true);
            da_core::folder_browse::tidy_for(&full(&t), true)
        }
        _ => full(&pre),
    }
}

/// Windows の CI: win32 の事例は、門が呼ぶ GetFullPathNameW の答えが表の want と同じ（人が書いた want が Win32 の決まりと合う）
#[cfg(windows)]
#[test]
fn win32_cases_are_getfullpathname() {
    let t = table();
    let mut n = 0;
    for c in t["cases"].as_array().unwrap().iter().filter(|c| c["win32"] == true) {
        if let Some(w) = c["nt"]["want"]["ok"].as_str() {
            n += 1;
            let got = gate(Kind::of(c["kind"].as_str().unwrap()).unwrap(), c["text"].as_str().unwrap(), &env_of(&t, c, "nt"));
            assert_eq!(got.as_deref(), Ok(w), "{}", c["text"]);
        }
    }
    assert!(n >= 6);
}
