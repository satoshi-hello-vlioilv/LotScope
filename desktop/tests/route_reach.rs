//! 窓が答えずに中身（Python）へ回す道の型（版 3.112.0。採点の指摘 8）: 中身が答えない形で、Flask の全部の道の型（方法 × 道。
//! program/tests/settings_oracle.py が create_app の道の一覧を渡す）を、main.rs の native と同じ順（画面・心拍・権限・データ元の並び・
//! handle_body）で、settings_oracle の全部の場面（管理者の名乗りのふつうの共有も）に当てる。窓が答えない（None＝router が中身へ回す）型が、
//! 許す並び（program/tests/fixtures/delegates_budget.json の routerForward: 理由と場面ごと）に入っているかを見る。
//! 窓は束を Python に尋ねない（lot.rs に口が無い）ので、ここで見るのは道ごとの転送だけ。許す並びの項目が 1 度も当たらなければ、
//! 並びが古い（閉じた任せを消し忘れた）として落とす。

mod common;

use da_core::bundle::{Builder, Env};
use da_core::lot::Lot;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{mpsc, Arc};
use std::time::Duration;

fn sample(rule: &str) -> String {
    rule.replace("<int:item_id>", "1")
        .replace("<int:row>", "1")
        .replace("<name>", "data_sources")
        .replace("<path:key>", "lot_list.source")
        .replace("<key>", "s3")
}

fn query_for(path: &str) -> &'static str {
    if path.starts_with("/api/worklog") && !path.ends_with("files") {
        "equip=CAL"
    } else if path.ends_with("/slicer") {
        "col=x"
    } else {
        ""
    }
}

/// main.rs の native と同じ順に当てる → 窓が答えたか（None は中身へ回す）
fn ask(lot: &Lot, m: &str, path: &str, q: &str) -> Option<(u16, Value)> {
    let py = || "stopped";
    match (m, path) {
        ("GET", "/") => lot.page(false, &py).map(|_| (200, json!("page"))),
        // main.rs の native が答える（src/small_reads.rs・health・調べる道具の画面）
        ("GET", "/api/build" | "/api/changelog" | "/api/health" | "/lotdsp-link") => Some((200, json!("native"))),
        ("POST", "/api/heartbeat") => lot.heartbeat(&|| da_core::presence::PythonNow { state: "stopped", why: "試験".into() }),
        ("GET", "/api/access/me" | "/api/masters/access") => lot.access_read(m, path),
        ("GET", "/api/sources") => lot.sources_list(q),
        _ => lot.handle_body(m, path, q, b"{}"),
    }
}

#[test]
fn only_the_listed_route_types_go_to_python() {
    let work = common::work("reach");
    let o = common::python_json("settings_oracle.py", &[work.to_str().unwrap()]);
    let budget: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/delegates_budget.json")).unwrap();
    let allow = budget["routerForward"].as_array().expect("routerForward");
    let routes: Vec<(String, String)> = o["routes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["method"].as_str().unwrap().into(), r["rule"].as_str().unwrap().into()))
        .collect();
    assert!(routes.len() >= 130, "道の型が少ない: {}", routes.len());
    let mut hit = vec![0usize; allow.len()];
    let mut bad = vec![];
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for sc in o["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap().to_string();
        let saved: Vec<(String, Option<String>)> =
            sc["vars"].as_object().unwrap().keys().map(|k| (k.clone(), std::env::var(k).ok())).collect();
        for (k, v) in sc["vars"].as_object().unwrap() {
            // SAFETY: この試験の糸だけが環境を変える（場面の後で戻す）
            unsafe { std::env::set_var(k, v.as_str().unwrap()) };
        }
        let e = &sc["env"];
        let p = |k: &str| PathBuf::from(e[k].as_str().unwrap());
        let lot = Arc::new(Lot::new(p("local").join("db_cache")));
        lot.set_program(p("program"));
        lot.set_bundle(Builder::new(Env {
            base: p("base"),
            program: p("program"),
            local: p("local"),
            config: p("config"),
            now: e["now"].as_str().map(String::from),
        }));
        for (m, rule) in &routes {
            let path = sample(rule);
            let q = query_for(&path).to_string();
            let (tx, rx) = mpsc::channel();
            let (l, m2, p2) = (lot.clone(), m.clone(), path.clone());
            std::thread::spawn(move || {
                let _ = tx.send(ask(&l, &m2, &p2, &q).is_some());
            });
            // 待ち切れない道（写しを待つなど）は答えた扱い（中身へは回していない）
            let answered = rx.recv_timeout(Duration::from_secs(30)).unwrap_or(true);
            if answered {
                continue;
            }
            let ty = format!("{m} {rule}");
            *seen.entry(ty.clone()).or_default() += 1;
            let ok = allow.iter().enumerate().find(|(_, a)| {
                a["routes"].as_array().unwrap().iter().any(|r| r == &ty)
                    && regex::Regex::new(a["scenes"].as_str().unwrap()).unwrap().is_match(&name)
            });
            match ok {
                Some((i, _)) => hit[i] += 1,
                None => bad.push(format!("{name}: {ty} を窓が答えず中身へ回した（許す並びに無い）")),
            }
        }
        for (k, v) in &saved {
            match v {
                Some(v) => unsafe { std::env::set_var(k, v) },
                None => unsafe { std::env::remove_var(k) },
            }
        }
    }
    eprintln!("中身へ回した型と場面の数: {seen:?}");
    for (i, a) in allow.iter().enumerate() {
        if hit[i] == 0 {
            bad.push(format!("許す並びの「{}」が 1 度も当たらない（閉じた任せを消し忘れた）", a["why"].as_str().unwrap_or("")));
        }
    }
    let _ = std::fs::remove_dir_all(&work);
    assert!(bad.is_empty(), "{} か所:\n{}", bad.len(), bad.join("\n"));
}
