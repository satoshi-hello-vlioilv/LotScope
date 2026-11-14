//! 窓が答えずに中身（Python）へ回す道の型（版 3.112.0。採点の指摘 8）: 中身が答えない形で、Flask の全部の道の型（方法 × 道。
//! program/tests/settings_oracle.py が create_app の道の一覧を渡す）を、main.rs の native と同じ順（画面・心拍・権限・データ元の並び・
//! handle_body）で当てる。当てる場面は settings_oracle の全部の場面と、配った設定の事例の表 appsettings_cases.json の全件（版 3.112.0 の
//! 作った後の採点の割れ 1・2。名前は「表: 事例の名前」）。窓が答えない（None＝router が中身へ回す）型が、許す並び
//! （program/tests/fixtures/delegates_budget.json の routerForward: 理由・場面・型）に入っているか、項目が 1 度は当たるか、当たりの数
//! （場面 × 型）が予算 routerForwardTotal と同じか（増えても減っても落とす。数え方は delegate-count.py の任せる歩と並べて報告する）を見る。
//! 事例の表の bundle が err の件（置き場が決まらない fail-closed）は全部の道が中身へ回るので数えない

mod common;

use da_core::bundle::{Builder, Env};
use da_core::lot::Lot;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
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

/// 事例の表の件を置く（tests/appsettings_cases.rs と同じ形: share・local・base・config.json）
fn place_case(root: &Path, c: &Value) -> Env {
    let _ = std::fs::remove_dir_all(root);
    let (share, local, base) = (root.join("share"), root.join("local"), root.join("base"));
    for d in [&share, &local, &base] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::write(local.join("instance_id"), "inst-reach").unwrap();
    let esc = serde_json::to_string(&share.to_string_lossy()).unwrap();
    let esc = &esc[1..esc.len() - 1];
    let text = match c.get("configText").and_then(Value::as_str) {
        Some(t) => t.replace("@share", esc),
        None => c["config"].to_string().replace("@share", esc),
    };
    std::fs::write(root.join("config.json"), text).unwrap();
    if let Some(rows) = c["paths"].as_array() {
        let rows: Vec<Value> = rows
            .iter()
            .enumerate()
            .map(|(i, r)| {
                let mut r = r.clone();
                r["id"] = json!(i + 1);
                r
            })
            .collect();
        std::fs::write(share.join("path_settings.json"), json!({"schema": 1, "revision": 3, "rows": rows}).to_string()).unwrap();
    }
    if c["remember"] == true {
        std::fs::write(local.join("master_share.json"), json!({"dir": share.to_string_lossy()}).to_string()).unwrap();
    }
    Env { base, program: common::program(), local, config: root.join("config.json"), now: None }
}

/// 1 つの場面に全部の型を当てる → 窓が答えなかった型
fn forwarded(env: Env, routes: &[(String, String)]) -> Vec<String> {
    let lot = Arc::new(Lot::new(env.local.join("db_cache")));
    lot.set_program(env.program.clone());
    lot.set_bundle(Builder::new(env));
    let mut out = vec![];
    for (m, rule) in routes {
        let path = sample(rule);
        let q = query_for(&path).to_string();
        let (tx, rx) = mpsc::channel();
        let (l, m2, p2) = (lot.clone(), m.clone(), path.clone());
        std::thread::spawn(move || {
            let _ = tx.send(ask(&l, &m2, &p2, &q).is_some());
        });
        // 待ち切れない道（写しを待つなど）は答えた扱い（中身へは回していない）
        if !rx.recv_timeout(Duration::from_secs(30)).unwrap_or(true) {
            out.push(format!("{m} {rule}"));
        }
    }
    out
}

#[test]
fn only_the_listed_route_types_go_to_python() {
    let work = common::work("reach");
    let o = common::python_json("settings_oracle.py", &[work.to_str().unwrap()]);
    let budget: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/delegates_budget.json")).unwrap();
    let table = common::json_keep(include_bytes!("../../program/tests/fixtures/appsettings_cases.json")).unwrap();
    let allow = budget["routerForward"].as_array().expect("routerForward");
    let routes: Vec<(String, String)> = o["routes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["method"].as_str().unwrap().into(), r["rule"].as_str().unwrap().into()))
        .collect();
    assert!(routes.len() >= 130, "道の型が少ない: {}", routes.len());
    let mut scenes: Vec<(String, Vec<String>)> = vec![];
    for sc in o["scenarios"].as_array().unwrap() {
        let saved: Vec<(String, Option<String>)> =
            sc["vars"].as_object().unwrap().keys().map(|k| (k.clone(), std::env::var(k).ok())).collect();
        for (k, v) in sc["vars"].as_object().unwrap() {
            // SAFETY: この試験の糸だけが環境を変える（場面の後で戻す）
            unsafe { std::env::set_var(k, v.as_str().unwrap()) };
        }
        let e = &sc["env"];
        let p = |k: &str| PathBuf::from(e[k].as_str().unwrap());
        let env = Env {
            base: p("base"),
            program: p("program"),
            local: p("local"),
            config: p("config"),
            now: e["now"].as_str().map(String::from),
        };
        scenes.push((sc["name"].as_str().unwrap().to_string(), forwarded(env, &routes)));
        for (k, v) in &saved {
            match v {
                Some(v) => unsafe { std::env::set_var(k, v) },
                None => unsafe { std::env::remove_var(k) },
            }
        }
    }
    for (i, c) in table["cases"].as_array().unwrap().iter().enumerate() {
        if c["want"]["bundle"] == "err" {
            continue; // 置き場が決まらない（fail-closed）: 全部の道が中身へ回る
        }
        let env = place_case(&work.join(format!("t{i}")), c);
        scenes.push((format!("表: {}", c["name"].as_str().unwrap()), forwarded(env, &routes)));
    }
    let mut hit = vec![0usize; allow.len()];
    let mut bad = vec![];
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for (name, tys) in &scenes {
        for ty in tys {
            *seen.entry(ty.clone()).or_default() += 1;
            let ok = allow.iter().enumerate().find(|(_, a)| {
                a["routes"].as_array().unwrap().iter().any(|r| r == ty)
                    && regex::Regex::new(a["scenes"].as_str().unwrap()).unwrap().is_match(name)
            });
            match ok {
                Some((i, _)) => hit[i] += 1,
                None => bad.push(format!("{name}: {ty} を窓が答えず中身へ回した（許す並びに無い）")),
            }
        }
    }
    eprintln!("中身へ回した型と場面の数: {seen:?}");
    for (i, a) in allow.iter().enumerate() {
        if hit[i] == 0 {
            bad.push(format!("許す並びの「{}」が 1 度も当たらない（閉じた任せを消し忘れた）", a["why"].as_str().unwrap_or("")));
        }
    }
    let total: usize = hit.iter().sum();
    let want = budget["routerForwardTotal"].as_u64().expect("routerForwardTotal") as usize;
    eprintln!("道ごとに中身へ回す当たり（場面 × 型）: {total}（予算 {want}）・場面 {}", scenes.len());
    if total != want {
        bad.push(format!("道ごとに中身へ回す当たりが {total}（予算 routerForwardTotal {want}）。増えたら理由を書いて上げ、減ったら下げる"));
    }
    let _ = std::fs::remove_dir_all(&work);
    assert!(bad.is_empty(), "{} か所:\n{}", bad.len(), bad.join("\n"));
}
