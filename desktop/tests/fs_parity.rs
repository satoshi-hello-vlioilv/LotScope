//! 「参照…」の 2 本（src/folder_browse.rs の handle・browse・places）が Python の道（routes/settings.py の POST /api/fs/browse・
//! GET /api/fs/places と services/folder_browse.py）と同じ答えか（版 3.101.0）。program/tests/fs_oracle.py が 1 つのフォルダの木
//! （自然な並びの名前・隠し・記号リンク・目的ごとの印・400 を超える数・読めないフォルダ）に Python の道で問い合わせの並びを当て、
//! ここでは同じフォルダに同じ並びを窓の道で当て、答え（状態・本文。断る言葉も 1 字まで）を突き合わせる。窓が答えず Python に任せる歩
//! （delegates）は、窓が答えないことを見る。字の整え（tidy: ntpath・posixpath の normpath）と区切り（crumbs: Path の anchor・parts）は、
//! POSIX と Windows の両方の決まりを 1 つの PC で事例の表（fs_oracle.py --tables）と突き合わせる。

mod common;

use da_core::access::Gate;
use da_core::folder_browse::{crumbs_for, handle, route_of, tidy_for};
use serde_json::{json, Value};
use std::path::Path;

fn unlock(dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir.join("tree").join("locked"), std::fs::Permissions::from_mode(0o755));
    }
    let _ = dir;
}

#[test]
fn tidy_and_crumbs_match_python() {
    let t = common::python_json("fs_oracle.py", &["--tables"]);
    let mut bad = vec![];
    for c in t["tidy"].as_array().unwrap() {
        let (s, win) = (c["text"].as_str().unwrap(), c["win"].as_bool().unwrap());
        let got = tidy_for(s, win);
        if got.as_deref() != c["tidy"].as_str() {
            bad.push(format!("tidy {s:?} win={win}: Python {} / 窓 {got:?}", c["tidy"]));
            continue;
        }
        let cr = json!(crumbs_for(c["tidy"].as_str().unwrap(), win));
        if cr != c["crumbs"] {
            bad.push(format!("crumbs {:?} win={win}: Python {} / 窓 {cr}", c["tidy"], c["crumbs"]));
        }
    }
    assert!(t["tidy"].as_array().unwrap().len() >= 40);
    assert!(bad.is_empty(), "{} 件:\n{}", bad.len(), bad.join("\n"));
}

#[test]
fn folder_browse_matches_python() {
    let base = common::work("fs");
    let oracle = common::python_json("fs_oracle.py", &[base.to_str().unwrap()]);
    let root = oracle["root"].as_str().unwrap().to_string();
    let esc = serde_json::to_string(&root).unwrap();
    let app_paths: Vec<(String, String, String)> = oracle["appPaths"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| (a[0].as_str().unwrap().into(), a[1].as_str().unwrap().into(), a[2].as_str().unwrap().into()))
        .collect();
    let conf = oracle["conf"].clone();
    let answer = |st: &Value| {
        let (method, path) = (st["method"].as_str().unwrap(), st["path"].as_str().unwrap());
        let route = route_of(method, path).expect("参照… の道");
        let mut c = conf.clone();
        let (login, pc) = (st["who"][0].as_str().unwrap(), st["who"][1].as_str().unwrap());
        c["who"]["login"] = json!(login);
        c["who"]["pc"] = json!(pc);
        c["who"]["key"] = json!(da_core::bundle::terminal_key(login, pc));
        let pdir = Path::new(c["place"]["presence"].as_str().unwrap()).to_path_buf();
        let revoke = pdir.join(format!("{}.revoke.json", da_core::bundle::terminal_key("c1", "PC-4")));
        if st["revoke"] == true {
            std::fs::create_dir_all(&pdir).unwrap();
            let at = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
            std::fs::write(&revoke, json!({"by": "boss", "byPc": "PC-1", "reason": "点検", "at": at}).to_string()).unwrap();
        }
        let me = || Gate::default().me(&c);
        let paths = || Some(app_paths.clone());
        let body = st["body"].as_str().unwrap_or("").replace("@ROOT", &esc[1..esc.len() - 1]);
        let r = handle(route, st["query"].as_str().unwrap_or(""), body.as_bytes(), &me, &paths);
        if st["revoke"] == true {
            let _ = std::fs::remove_file(&revoke);
        }
        r
    };
    let mut bad = vec![];
    let (mut steps, mut delegated) = (0, 0);
    for (i, st) in oracle["steps"].as_array().unwrap().iter().enumerate() {
        steps += 1;
        let Some((status, got)) = answer(st) else {
            bad.push(format!("[{i}] 窓が答えない: {} {}", st["path"], st["body"]));
            continue;
        };
        if status as i64 != st["status"].as_i64().unwrap() || common::diff(&st["json"], &got, "").is_some() {
            bad.push(format!(
                "[{i}] {} {}: {}\n  Python {} {}\n  窓     {status} {got}",
                st["path"],
                st["body"],
                common::diff(&st["json"], &got, "").unwrap_or_default(),
                st["status"],
                st["json"]
            ));
        }
    }
    for st in oracle["delegates"].as_array().unwrap() {
        delegated += 1;
        if let Some((status, got)) = answer(st) {
            bad.push(format!("窓が答えた（Python に任せるはず） {} {}: 窓 {status} {got}", st["path"], st["body"]));
        }
    }
    eprintln!("歩 {steps}・Python に任せた歩 {delegated}");
    assert!(steps >= 30 && delegated >= 4, "歩が少ない: {steps}・{delegated}");
    unlock(&base.join("fs"));
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
