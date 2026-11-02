//! ダッシュボードのパネルの速さ（版 3.62.0）: program/tests/dashboard_oracle.py --bench が作った設定の答えとパネル（Python の道の時間つき）を、
//! 窓の受け口（Lot::handle_body）で同じく 5 回の中央値で測り、並べて出す。答えの控えは毎回空にする（数える時間を測る。Python も同じ）。
//! 写しは作業フォルダに窓が写す（1 回目は数えない）。
//!     cd desktop && cargo run --release --example dash_bench -- 出力.json
use da_core::lot::Lot;
use serde_json::{json, Value};
use std::time::Instant;

fn main() {
    let file = std::env::args().nth(1).expect("dashboard_oracle.py --bench の出力を渡してください");
    let doc: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    let work = std::env::temp_dir().join(format!("dash-bench-{}", std::process::id()));
    let lot = Lot::new(work.join("db_cache"));
    let settings = doc["settings"].clone();
    let ask = || Ok(settings.clone());
    let (mut rows, mut total) = (vec![], (0.0, 0.0));
    for a in doc["cases"].as_array().unwrap() {
        let body = serde_json::to_vec(&json!({"panel": a["panel"]})).unwrap();
        let first = lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask);
        let mut xs = vec![];
        for _ in 0..5 {
            lot.forget_dashboard();
            let t = Instant::now();
            let _ = lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask);
            xs.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let (status, v) = first.unwrap_or((0, Value::Null));
        let py = a["ms"].as_f64().unwrap_or(0.0);
        total = (total.0 + py, total.1 + xs[2]);
        rows.push(json!({"name": a["name"], "python_ms": py, "rust_ms": (xs[2] * 100.0).round() / 100.0, "status": status,
                         "same_shape": shape(&v) == a["shape"]}));
    }
    let _ = std::fs::remove_dir_all(&work);
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({"panels": rows, "python_ms": (total.0 * 100.0_f64).round() / 100.0,
                                                          "rust_ms": (total.1 * 100.0_f64).round() / 100.0}))
        .unwrap()
    );
}

/// 答えの形の手がかり（升の数・合わせた表のまとまりごとの升の数・総計。稼働は設備の数と棒の数の計、ABC は品種の数と基準の分）。
/// Python の答えと同じ数を数えたか（dashboard_oracle.py の shape と同じ）
fn shape(v: &Value) -> Value {
    let equips = v["equips"].as_array().map(Vec::as_slice).unwrap_or_default();
    match v["kind"].as_str() {
        Some("gantt") => return json!([equips.len(), equips.iter().map(|e| e["count"].as_i64().unwrap_or(0)).sum::<i64>()]),
        Some("abc") => return json!([v["all"]["items"].as_array().map_or(0, Vec::len), v["all"]["base"]["minutes"]]),
        _ => {}
    }
    let cells = |a: &Value| a["cells"].as_array().map(|c| c.len());
    let grand = |a: &Value| {
        a["cells"].as_array().and_then(|c| c.iter().find(|x| x["r"].as_array().is_some_and(|r| r.is_empty()))).map(|x| x["v"].clone())
    };
    match v.get("groups").and_then(Value::as_array) {
        Some(gs) => json!(gs.iter().map(|g| json!([cells(g), grand(g)])).collect::<Vec<_>>()),
        None => json!([cells(v), grand(v)]),
    }
}
