//! 設定の束の節（版 3.102.0）: 節が使うマスタ（src/bundle.rs の SECTIONS）と道が使う節（src/lot.rs の sections_for）が、
//! 事例の表 program/tests/fixtures/bundle_cases.json と同じか（Python の routes/lotlist.SECTIONS は tests/test_bundle_sections.py が同じ表と比べる）。
//! 組めない節を使う道だけを断る（ほかの道は答え続ける）決まりを 1 つの表にする。

use da_core::bundle::{Builder, Env, SECTIONS};
use da_core::lot::sections_for;
use serde_json::{json, Value};

#[test]
fn sections_and_routes_are_like_the_table() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/bundle_cases.json")).unwrap();
    let mine: serde_json::Map<String, Value> = SECTIONS.iter().map(|(n, f)| (n.to_string(), json!(f))).collect();
    assert_eq!(Value::Object(mine), t["sections"], "節が使うマスタ");
    for r in t["routes"].as_array().unwrap() {
        let got = sections_for(r["path"].as_str().unwrap(), r["conv"].as_bool().unwrap());
        assert_eq!(json!(got), r["need"], "{}", r);
    }
}

#[test]
fn broken_rows_are_skipped_and_broken_files_refused_like_the_table() {
    // 表でない行だけなら節は読める行で組み、警告（warn）で言う。ファイルが読めないときだけ節を null にする（版 3.102.0 の作った後の採点の割れ 2）
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/bundle_cases.json")).unwrap();
    let program = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
    for (i, c) in t["cases"].as_array().unwrap().iter().enumerate() {
        let work = std::env::temp_dir().join(format!("da-bundle-cases-{}-{i}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(work.join("base").join("data")).unwrap();
        std::fs::create_dir_all(work.join("local")).unwrap();
        std::fs::write(work.join("base").join("data").join(format!("{}.json", c["master"].as_str().unwrap())), c["text"].as_str().unwrap())
            .unwrap();
        std::fs::write(work.join("config.json"), r#"{"master_share": {}}"#).unwrap();
        let b = Builder::new(Env {
            base: work.join("base"),
            program: program.clone(),
            local: work.join("local"),
            config: work.join("config.json"),
            now: None,
        });
        let v = b.build().unwrap_or_else(|e| panic!("{}: 束を組めない {}", c["name"], e.why));
        let sec = c["section"].as_str().unwrap();
        let w = &v["broken"][sec];
        assert_eq!((&w["why"], w["warn"] == true), (&c["why"], c["warn"] == true), "{}: {}", c["name"], v["broken"]);
        let got = &v["lists"][sec];
        assert_eq!(!got.is_null(), c["built"] == true, "{}: {got}", c["name"]);
        if let Some(n) = c["rows"].as_u64() {
            assert_eq!(got.as_array().map(Vec::len), Some(n as usize), "{}", c["name"]);
        }
        let _ = std::fs::remove_dir_all(&work);
    }
}
