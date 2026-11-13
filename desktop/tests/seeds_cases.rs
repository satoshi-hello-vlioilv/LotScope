//! 起動の初期値の事例の表（program/tests/fixtures/seeds_cases.json。人が仕様から書いた答え）を窓の src/seeds.rs で確かめる（版 3.110.0）。
//! Python は tests/test_seeds_cases.py が同じ表を読む。
mod common;

use da_core::seeds;
use serde_json::{json, Value};
use std::time::Duration;

fn table() -> Value {
    let p = common::program().join("tests").join("fixtures").join("seeds_cases.json");
    // NaN・Infinity・1e400 の事例があるので、serde で読めなければ Python の json.loads と同じ J で読む（common::file_value）
    common::file_value(&std::fs::read(p).unwrap())
}

#[test]
fn each_rule_like_the_table() {
    let t = table();
    let cases = t["cases"].as_array().unwrap();
    assert!(cases.len() >= 30);
    for c in cases {
        let name = c["name"].as_str().unwrap();
        let mut rows = c["rows"].as_array().unwrap().clone();
        let stamp = &t["stamp"];
        let bundled = if c["bundled_error"] == true { Err("読めない".to_string()) } else { Ok(c["bundled"].clone()) };
        let got = match c["seed"].as_str().unwrap() {
            "record" => seeds::record(&mut rows, stamp, c["sid"].as_str().unwrap()),
            "2026-10-23-kama-date-table" => seeds::kama_date_table(&mut rows, stamp, bundled),
            sid => seeds::apply(sid, &mut rows, stamp, &|| unreachable!()),
        };
        let ex = &c["expect"];
        match got {
            Err(e) => assert!(ex["error"] == true, "{name}: 止まった（{e}）"),
            Ok(changed) => {
                assert!(ex["error"] != true, "{name}: 止まるはず");
                assert_eq!(changed, ex["changed"] == true, "{name}");
                let want = if changed { &ex["rows"] } else { &c["rows"] };
                assert_eq!(&Value::Array(rows), want, "{name}");
            }
        }
    }
}

fn rows_of(v: &Value) -> Vec<Value> {
    v.get("rows").unwrap_or(v).as_array().cloned().unwrap_or_default()
}

#[test]
fn each_run_like_the_table() {
    let t = table();
    let base = common::work("seeds-cases");
    for (i, run) in t["runs"].as_array().unwrap().iter().enumerate() {
        let name = run["name"].as_str().unwrap();
        let root = base.join(format!("run{i}"));
        let store = common::seeds_store(&root, run, "rs");
        let waited = std::cell::Cell::new(0);
        let o = seeds::run(&store, &|_: Duration| waited.set(waited.get() + 1));
        let ex = &run["expect"];
        assert_eq!(json!(o.applied), ex["applied"], "{name}");
        assert_eq!(json!(o.stopped.as_ref().map(|s| &s.0)), ex["stopped"], "{name}: {:?}", o.stopped);
        assert_eq!(o.skipped.is_some(), ex["skipped"] == true, "{name}: {:?}", o.skipped);
        let got = common::seeds_files(&root, run);
        if !ex["seeds"].is_null() {
            let seeds: Vec<Value> = got.get("app_seeds").map(rows_of).unwrap_or_default().iter().map(|r| r["seed"].clone()).collect();
            assert_eq!(json!(seeds), ex["seeds"], "{name}");
        }
        for (m, rev) in ex["revisions"].as_object().cloned().unwrap_or_default() {
            assert_eq!(got[&m]["revision"], rev, "{name}: {m}");
        }
        for (m, n) in ex["counts"].as_object().cloned().unwrap_or_default() {
            assert_eq!(json!(rows_of(&got[&m]).len()), n, "{name}: {m}");
        }
        assert_eq!(
            json!(waited.get()),
            ex.get("waits").cloned().unwrap_or(json!(0)),
            "{name}: 錠を待った回数（錠に当たらない形では待たない）"
        );
        if run["place"] == "unreachable" {
            assert!(!root.join("無い共有").exists(), "{name}: 届かない共有は作らない");
        }
    }
    let _ = std::fs::remove_dir_all(&base);
}
