//! 置き場と設定（版 3.100.0）の事例の表 program/tests/fixtures/place_cases.json を、窓が既に持つ同じ部品で読む（Python は
//! tests/test_place_cases.py が同じ表を読み、答えは tools/place-truth.py〈app を import しない独立の答え〉でも確かめ直す）。
//! 3.100.0 で窓が読むのは、フォルダの名前（release_place::check_name。配布の置き場とマスタの置き場の確かめ）とタブの例外の読み方
//! （access::tab_exceptions）。並び・印・道の字・写す物は 3.101.0 で 8 本を窓へ移すときに、同じ表の節を読む。
//! Windows では、道の比べ（同じ所・中）に使う normcase が Python 3.13 の ntpath.normcase（LCMapStringEx）と全部の BMP の字で同じかも見る。

use da_core::{access, release_place};
use serde_json::{json, Map, Value};
use std::path::PathBuf;

fn cases() -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixtures/place_cases.json");
    serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap()
}

#[test]
fn names_match_the_table() {
    let c = cases();
    let names = c["names"].as_array().unwrap();
    assert!(names.len() > 60, "事例の数");
    for cs in names {
        let name = cs["name"].as_str().unwrap();
        let got = release_place::check_name(name);
        if cs["ok"].as_bool().unwrap() {
            assert_eq!(got.as_deref(), Ok(cs["want"].as_str().unwrap()), "{name:?}");
        } else {
            assert_eq!(got.as_ref().map_err(String::as_str), Err(cs["problem"].as_str().unwrap()), "{name:?}");
        }
    }
}

#[test]
fn tab_exceptions_match_the_table() {
    let c = cases();
    for cs in c["tabExceptions"].as_array().unwrap() {
        let v = &cs["value"];
        let got = access::tab_exceptions(if v.is_null() { None } else { Some(v) }).expect("壊れた例外は空として読む（Err にしない）");
        let mut m = Map::new();
        for (t, hide) in got {
            m.insert(t, json!(if hide { "出さない" } else { "出す" }));
        }
        assert_eq!(Value::Object(m), cs["want"], "{v}");
    }
}

/// Windows の CI: normcase（LCMapStringEx）が Python の ntpath.normcase と全部の BMP の字（代用字を除く）で同じ
#[cfg(windows)]
#[test]
fn normcase_is_pythons() {
    let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| "python".into());
    let script = "import json, ntpath, sys\n\
                  cs = [chr(i) for i in range(0x10000) if not 0xD800 <= i < 0xE000]\n\
                  sys.stdout.buffer.write(json.dumps([ntpath.normcase(c) for c in cs]).encode('ascii'))";
    let out = std::process::Command::new(&py).args(["-c", script]).output().expect("Python を起こせない");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let want: Vec<String> = serde_json::from_slice(&out.stdout).unwrap();
    let chars: Vec<char> = (0u32..0x10000).filter_map(char::from_u32).collect();
    assert_eq!(chars.len(), want.len());
    let bad: Vec<String> = chars
        .iter()
        .zip(&want)
        .filter(|(c, w)| release_place::normcase(&c.to_string()) != **w)
        .take(20)
        .map(|(c, w)| format!("U+{:04X} 窓 {:?} / Python {:?}", *c as u32, release_place::normcase(&c.to_string()), w))
        .collect();
    assert!(bad.is_empty(), "{bad:#?}");
    assert_eq!(release_place::normcase("C:/Ａ/İ/Masters"), want_of(&py, "C:/Ａ/İ/Masters"));
}

#[cfg(windows)]
fn want_of(py: &str, s: &str) -> String {
    let out = std::process::Command::new(py)
        .args([
            "-c",
            "import json, ntpath, sys; sys.stdout.buffer.write(json.dumps(ntpath.normcase(json.loads(sys.argv[1]))).encode('ascii'))",
            &json!(s).to_string(),
        ])
        .output()
        .unwrap();
    serde_json::from_slice(&out.stdout).unwrap()
}
