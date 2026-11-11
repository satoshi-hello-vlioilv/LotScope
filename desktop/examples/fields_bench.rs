//! 組む所の札（版 3.99.0）の窓の速さを測る（開発用。program/tools/dash-bench.py --fields --window が呼ぶ）。
//!
//!     cargo run --example fields_bench -- 実績のファイル…
//!
//! 作業実績のすべての設備の札を、窓の pivot::fields_many（合わせた全部のファイルの指紋ごとに答えを覚える）で、1 回目・2 回目・
//! 1 台だけファイルが新しくなった後・計算列あり（覚えない）で測り、ミリ秒を JSON で出す。前の窓（版 3.98.0）と比べるときは、
//! 同じ形の測り方を前の版の pivot::fields（1 ファイルずつ覚える・Python が最初の 12 台を合わせた）で書いた物を使う（dash-bench.py の説明）
use da_core::formula::{clean_calc, Tables};
use da_core::lotlist::WORK_TABLES;
use da_core::pivot::{self, Part};
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

fn main() {
    let files: Vec<PathBuf> = std::env::args().skip(1).map(PathBuf::from).collect();
    let parts: Vec<Part> = files
        .iter()
        .map(|f| Part {
            path: f.clone(),
            table: String::new(),
            preferred_table: String::new(),
            candidates: WORK_TABLES,
            work: None,
            equip: None,
            name: f.file_stem().unwrap().to_string_lossy().into_owned(),
            lot_col: None,
        })
        .collect();
    let conv = Arc::new(Tables::from_json(&json!({})));
    let calc = clean_calc(r#"{"formulas": {"重さ2": "[重量]*2"}, "names": {}}"#);
    let run = |with_calc: bool| {
        let t = Instant::now();
        let (_, f, bad) = pivot::fields_many(
            &parts,
            &|p: &Part| if with_calc { calc.as_ref().and_then(|c| c.for_part(&p.name)) } else { None },
            !with_calc,
            &conv,
            300,
        );
        assert!(bad.is_empty(), "{bad:?}");
        ((t.elapsed().as_secs_f64() * 10000.0).round() / 10.0, f.len())
    };
    let first = run(false);
    let second = run(false);
    let third = run(false);
    let f0 = std::fs::File::options().write(true).open(&files[0]).unwrap();
    f0.set_modified(std::time::SystemTime::now()).unwrap();
    let touched = run(false);
    let with_calc = run(true);
    println!(
        "{}",
        json!({"window": "after", "build": if cfg!(debug_assertions) { "debug" } else { "release" }, "files": parts.len(), "columns": first.1,
               "ms": {"1 回目": first.0, "2 回目": second.0, "3 回目": third.0, "1 台だけ新しい": touched.0, "計算列あり": with_calc.0}})
    );
}
