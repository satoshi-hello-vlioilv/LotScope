//! 一覧の道の速さ（版 3.60.0）: program/tests/routes_oracle.py --bench が作った設定の答えと問い合わせ（Python の道の時間つき）を、
//! 窓の受け口（Lot::handle）で同じく 5 回の中央値で測り、並べて出す。写しは作業フォルダに窓が写す（1 回目は数えない）。
//!     cd desktop && cargo run --release --example routes_bench -- 出力.json
use da_core::lot::Lot;
use serde_json::{json, Value};
use std::time::Instant;

fn main() {
    let file = std::env::args().nth(1).expect("routes_oracle.py --bench の出力を渡してください");
    let doc: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    let work = std::env::temp_dir().join(format!("routes-bench-{}", std::process::id()));
    let lot = Lot::new(work.join("db_cache"));
    let settings = doc["settings"].clone();
    let ask = || Ok(settings.clone());
    let mut rows = vec![];
    for a in doc["asks"].as_array().unwrap() {
        let (m, p, q) = (a["method"].as_str().unwrap(), a["path"].as_str().unwrap(), a["query"].as_str().unwrap());
        let first = lot.handle_with(m, p, q, &ask).map(|(s, v)| (s, v["count"].clone()));
        let mut xs = vec![];
        for _ in 0..5 {
            let t = Instant::now();
            let _ = lot.handle_with(m, p, q, &ask);
            xs.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let (status, count) = first.unwrap_or((0, Value::Null));
        rows.push(json!({"path": p, "query": q, "python_ms": a["ms"], "rust_ms": (xs[2] * 100.0).round() / 100.0,
                         "status": status, "same_count": count == a["count"]}));
    }
    let _ = std::fs::remove_dir_all(&work);
    println!("{}", serde_json::to_string_pretty(&rows).unwrap());
}
