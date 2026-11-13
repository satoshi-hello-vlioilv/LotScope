//! 起動の決め（版 3.111.0。src/boot.rs）を、人が仕様から書いた事例の表 program/tests/fixtures/boot_cases.json と突き合わせる。
//! 事例ごとに本物の program の写し（窓が読む物と、窓が読んではいけない物〈sidecar.py・配った設定〉）を作って変え、窓の準備（window_ready）を
//! 当て、決め（decide）が表の行うことと同じかを見る。Python には頼らない（独立の答えは表そのもの）

use da_core::boot::{self, Act, Facts, Page, Python};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

fn program() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("program")
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            copy_dir(&p, &to.join(e.file_name()));
        } else {
            std::fs::copy(&p, to.join(e.file_name())).unwrap();
        }
    }
}

/// 本物の program のうち、窓の準備が読む物と、読んではいけない物（sidecar.py・配った設定）を写す
fn fresh_copy(dir: &Path) {
    let src = program();
    let _ = std::fs::remove_dir_all(dir);
    for d in ["app/templates", "app/static", "app/master_defaults"] {
        copy_dir(&src.join(d), &dir.join(d));
    }
    for f in ["sidecar.py", "app/version.py", "app/brand.json", "config/appsettings.example.json", "config/appsettings.json"] {
        std::fs::create_dir_all(dir.join(f).parent().unwrap()).unwrap();
        std::fs::copy(src.join(f), dir.join(f)).unwrap();
    }
}

fn apply(dir: &Path, step: &Value) {
    let path = dir.join(step["path"].as_str().unwrap_or(""));
    match step["op"].as_str().unwrap() {
        "write" => {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, step["text"].as_str().unwrap()).unwrap();
        }
        "remove" => std::fs::remove_file(&path).unwrap(),
        "app_id" => {
            let p = dir.join("app").join("brand.json");
            let mut b: Value = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
            b["app_id"] = step["value"].clone();
            std::fs::write(&p, serde_json::to_vec(&b).unwrap()).unwrap();
        }
        x => panic!("知らない変え方 {x}"),
    }
}

fn app_id() -> String {
    let b: Value = serde_json::from_slice(&std::fs::read(program().join("app").join("brand.json")).unwrap()).unwrap();
    b["app_id"].as_str().unwrap().to_string()
}

fn table() -> Value {
    serde_json::from_str(include_str!("../../program/tests/fixtures/boot_cases.json")).unwrap()
}

#[test]
fn boot_decides_like_the_table() {
    let t = table();
    assert_eq!(t["beatLimitSec"].as_u64(), Some(boot::BEAT_LIMIT.as_secs()), "画面の心拍を待つ上限は表と同じ");
    assert_eq!(t["afterConfigSec"].as_u64(), Some(boot::AFTER_CONFIG.as_secs()), "設定の答えから心拍を待つ長さは表と同じ");
    assert_eq!(t["askLimitSec"].as_u64(), Some(boot::ASK_LIMIT.as_secs()), "設定の答えを待つ上限は表と同じ");
    // 画面の心拍が来る（来ない）ことを前提にした行は、本物の窓で確かめる場面（verify.py）を名指す（版 3.111.0 の作った後の採点の割れ 5）
    let verify = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("bundle").join("verify.py")).unwrap();
    for c in t["cases"].as_array().unwrap() {
        if let Some(v) = c.get("verify").and_then(Value::as_str) {
            let scene = v.rsplit(' ').next().unwrap();
            assert!(
                verify.contains(&format!("\"{scene}."))
                    || verify.contains(&format!("{scene}. "))
                    || verify.contains(&format!("def {scene}(")),
                "{}: verify.py に場面 {v} が無い",
                c["name"]
            );
        }
    }
    let id = app_id();
    let dir = std::env::temp_dir().join(format!("da-boot-cases-{}", std::process::id()));
    let mut bad = vec![];
    let cases = t["cases"].as_array().unwrap();
    for c in cases {
        let name = c["name"].as_str().unwrap();
        fresh_copy(&dir);
        for s in c["setup"].as_array().unwrap() {
            apply(&dir, s);
        }
        let ready = boot::window_ready(&dir, &id);
        let got_window = match &ready {
            Ok(_) => "ok",
            Err(b) => b.kind,
        };
        if got_window != c["window"].as_str().unwrap() {
            bad.push(format!("{name}: 窓の準備は {got_window}（表 {}）: {:?}", c["window"], ready.as_ref().err()));
        }
        let facts = Facts {
            installed: c["installed"].as_bool().unwrap(),
            applied: c["applied"].as_bool().unwrap(),
            window_ok: ready.is_ok(),
            page: match c.get("clock") {
                // 画面の様子を時刻から決める（版 3.111.0 の作った後の採点の割れ 2。boot::page_of）
                Some(k) => {
                    let s = |v: &Value| v.as_f64().map(Duration::from_secs_f64);
                    boot::page_of(s(&k["open"]).unwrap(), k["beat"].as_bool().unwrap(), s(&k["asked"]), s(&k["answered"]))
                }
                None => Page::of(c["page"].as_str().unwrap()).expect("page"),
            },
            python: Python::of(c["python"].as_str().unwrap()).expect("python"),
        };
        let acts: Vec<&str> = boot::decide(&facts).into_iter().map(Act::name).collect();
        let want: Vec<&str> = c["acts"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
        if acts != want {
            bad.push(format!("{name}: 行うことは {acts:?}（表 {want:?}）"));
        }
        if acts.contains(&"revert") != c["revert"].as_bool().unwrap() {
            bad.push(format!("{name}: 戻すかが人の決め（{}）と違う", c["revert"]));
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    assert!(bad.is_empty(), "{}", bad.join("\n"));
    // 表が仕様の必ず入れる形を持っている（採点の指摘 5）
    let names: Vec<&str> = cases.iter().map(|c| c["name"].as_str().unwrap()).collect();
    for must in [
        "配った設定（config/appsettings.json）が JSON でない",
        "Python が 120 秒を超える",
        "Python が見つからない",
        "Python がすぐ終わる",
        "共有に届かない",
        "権限の表が読めない",
        "app/version.py が読めない",
        "画面の型 templates/index.html が無い",
        "指紋を作れない",
        "同梱の既定 app/master_defaults/conversions.json が壊れた",
        "app_id が違う",
    ] {
        assert!(names.iter().any(|n| n.starts_with(must)), "表に「{must}」が無い");
    }
}

#[test]
fn failed_marks_like_the_table() {
    let t = table();
    for c in t["failed"].as_array().unwrap() {
        assert_eq!(boot::failed_blocks(&c["file"], c["version"].as_str().unwrap()), c["blocks"].as_bool().unwrap(), "{}", c["name"]);
    }
}

#[test]
fn the_real_program_is_ready() {
    // 作業場所の program（配る版になる物）が窓の準備を通る
    assert!(boot::window_ready(&program(), &app_id()).is_ok(), "{:?}", boot::window_ready(&program(), &app_id()).err());
}
