//! マスタの置き場の 4 本（src/master_place.rs の handle・plan・move_to・status）が Python の道（routes/masters.py の GET /api/masters/status・
//! routes/settings.py の GET /api/masters/place・POST place/check・move と services/master_place.py）と同じ答えか（版 3.101.0）。
//! program/tests/place_oracle.py が場面ごとに同じ中身のフォルダを 3 つ（py・rs・pd）作り、py に Python の道で問い合わせの並びを当てる。
//! ここでは rs に同じ並びを窓の道（Lot::place_route と同じ順: ?engine=python → 道 → move は門番 → plan → 写して切り替える）で当て、
//! 1 歩ごとの答え（状態・本文。断る言葉も 1 字まで）と、終わった後のフォルダの中身（引っ越し先のマスタ・利用状況の記録・前の置き場の印・
//! この PC の覚え・写し）を突き合わせる。窓が答えず Python に任せる歩（delegates）は、窓が答えないことを見る。
//! 比べない所: 場面のフォルダの道（@ROOT にそろえる）・時刻（<時刻>）・一時フォルダの名前の印。
//! 種まきの競い合い（2 つのプロセスが同時に空の共有を読む）: 空の共有で、Python の status（種をまく）を別のプロセスで動かしながら窓の status を
//! 繰り返し、窓は種まきの要る間は答えず（Python に任せる）、まき終えた後は Python と同じ答え・共有のマスタは壊れず版 1 のまま。

mod common;

use da_core::access::Gate;
use da_core::master_place::{handle, route_of, Local};
use da_core::master_store::Store;
use serde_json::{json, Map, Value};
use std::path::Path;
use std::sync::Arc;

fn norm(v: &Value, root: &str) -> Value {
    match v {
        Value::String(s) => {
            let s = s.replace(root, "@ROOT");
            let s = regex::Regex::new(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d").unwrap().replace_all(&s, "<時刻>").into_owned();
            let s = regex::Regex::new(r"\.(tmp|probe)-[0-9a-f]{8}").unwrap().replace_all(&s, ".$1-<印>").into_owned();
            json!(s)
        }
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.replace(root, "@ROOT"), norm(x, root))).collect()),
        Value::Array(a) => Value::Array(a.iter().map(|x| norm(x, root)).collect()),
        _ => v.clone(),
    }
}

fn sub(x: &str, root: &str) -> String {
    x.replace("@ROOT", root)
}

fn sub_json(x: &str, root: &str) -> String {
    let esc = serde_json::to_string(root).unwrap();
    x.replace("@ROOT", &esc[1..esc.len() - 1])
}

/// フォルダの中身（place_oracle.py の listing と同じ形）
fn listing(root: &Path) -> Map<String, Value> {
    let mut out = Map::new();
    fn walk(dir: &Path, root: &Path, out: &mut Map<String, Value>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            if rel == "app" || rel.starts_with("app/") {
                continue;
            }
            if p.is_dir() {
                out.insert(rel, json!({"type": "dir"}));
                walk(&p, root, out);
                continue;
            }
            let body = match std::fs::read(&p) {
                Err(_) => json!("<読めない>"),
                Ok(raw) => {
                    let raw = raw.strip_prefix(b"\xef\xbb\xbf").map(|r| r.to_vec()).unwrap_or(raw);
                    let text = String::from_utf8_lossy(&raw).into_owned();
                    if rel.ends_with(".json") {
                        serde_json::from_str(&text).unwrap_or(json!(text))
                    } else {
                        json!(text)
                    }
                }
            };
            out.insert(rel, json!({"type": "file", "body": body}));
        }
    }
    walk(root, root, &mut out);
    out
}

fn store_of(conf: &Value) -> Arc<Store> {
    Arc::new(Store::from_access(conf, "rs").expect("置き場の材料"))
}

/// 窓の道で 1 歩答える（None は Python に任せる）
fn answer(conf: &Value, store: &Arc<Store>, st: &Value, root: &str) -> Option<(u16, Value)> {
    let (method, path) = (st["method"].as_str().unwrap(), st["path"].as_str().unwrap());
    let route = route_of(method, path).expect("置き場の道");
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
    let local = Local { configured: conf["configured"].as_str().unwrap_or("").into(), root: store.local_root().to_path_buf() };
    let body = sub_json(st["body"].as_str().unwrap_or(""), root);
    let r = handle(route, st["query"].as_str().unwrap_or(""), body.as_bytes(), store, &local, &me, &common::program());
    if st["revoke"] == true {
        let _ = std::fs::remove_file(&revoke);
    }
    r
}

/// 写して切り替えた後の置き場（窓は次に束を組むとき、この PC の覚え master_share.json から読む: Lot::place_route）
fn follow(conf: &mut Value, rs: &Path) {
    let ov: Value = serde_json::from_slice(&std::fs::read(rs.join("local/master_share.json")).unwrap()).unwrap();
    let dir = ov["dir"].as_str().unwrap().to_string();
    conf["place"]["shareDir"] = json!(dir);
    conf["place"]["presence"] = json!(Path::new(&dir).join("presence_tpa").to_string_lossy());
}

#[test]
fn master_place_matches_python() {
    let base = common::work("place");
    let oracle = common::python_json("place_oracle.py", &[base.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut steps, mut delegated, mut moved) = (0, 0, 0);
    for sc in oracle["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let (py, rs) = (sc["roots"]["py"].as_str().unwrap(), sc["roots"]["rs"].as_str().unwrap());
        let mut conf = sc["conf"].clone();
        let mut store = store_of(&conf);
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            if let Some(op) = st["do"].as_str() {
                match op {
                    "rename" => std::fs::rename(sub(st["a"].as_str().unwrap(), rs), sub(st["b"].as_str().unwrap(), rs)).unwrap(),
                    "remove" => std::fs::remove_file(sub(st["path"].as_str().unwrap(), rs)).unwrap(),
                    x => panic!("知らない do: {x}"),
                }
                continue;
            }
            steps += 1;
            let Some((status, got)) = answer(&conf, &store, st, rs) else {
                bad.push(format!("{name} [{i}] 窓が答えない: {} {} {}", st["method"], st["path"], st["body"]));
                continue;
            };
            let (want, gotn) = (norm(&st["json"], py), norm(&got, rs));
            if status as i64 != st["status"].as_i64().unwrap_or(0) || common::diff(&want, &gotn, "").is_some() {
                bad.push(format!(
                    "{name} [{i}] {} {} {}: {}\n  Python {} {want}\n  窓     {status} {gotn}",
                    st["method"].as_str().unwrap(),
                    st["path"].as_str().unwrap(),
                    st["body"],
                    common::diff(&want, &gotn, "").unwrap_or_default(),
                    st["status"]
                ));
            }
            if st["path"] == "/api/masters/place/move" && status == 200 {
                moved += 1;
                follow(&mut conf, Path::new(rs));
                store = store_of(&conf);
            }
        }
        for st in sc["delegates"].as_array().unwrap() {
            delegated += 1;
            if let Some((status, got)) = answer(&conf, &store, st, rs) {
                bad.push(format!(
                    "{name}: 窓が答えた（Python に任せるはず） {} {} {}: 窓 {status} {got}",
                    st["method"], st["path"], st["body"]
                ));
            }
        }
        let got = listing(Path::new(rs));
        let want = sc["files"].as_object().unwrap();
        let (gotn, wantn) = (norm(&Value::Object(got), rs), norm(&Value::Object(want.clone()), py));
        let (g, w) = (gotn.as_object().unwrap(), wantn.as_object().unwrap());
        for k in g.keys().filter(|k| k.contains(".tmp-") || k.contains(".probe-") || k.ends_with("master.lock.json")) {
            bad.push(format!("{name}: 片付け忘れ {k}"));
        }
        for k in w.keys().chain(g.keys()) {
            if let Some(d) = common::diff(w.get(k).unwrap_or(&Value::Null), g.get(k).unwrap_or(&Value::Null), k) {
                bad.push(format!("{name}: フォルダの中身 {d}"));
            }
        }
    }
    eprintln!("歩 {steps}・写して切り替えた歩 {moved}・Python に任せた歩 {delegated}");
    assert!(steps >= 45 && delegated >= 4 && moved >= 4, "歩が少ない: {steps}・{delegated}・{moved}");
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 2 つのプロセス（窓と Python）が同時に空の共有を読む: 種まきは Python の 1 か所。窓は種まきの要る間は答えない
#[test]
fn an_empty_share_is_seeded_once_by_python() {
    let base = common::work("place-seed");
    let oracle = common::python_json("place_oracle.py", &[base.to_str().unwrap()]);
    let sc = oracle["scenarios"].as_array().unwrap().iter().find(|s| s["name"].as_str().unwrap().contains("空の共有")).unwrap();
    let rs = sc["roots"]["rs"].as_str().unwrap().to_string();
    let conf = sc["conf"].clone();
    let store = store_of(&conf);
    let local = Local { configured: conf["configured"].as_str().unwrap_or("").into(), root: store.local_root().to_path_buf() };
    let c = conf.clone();
    let me = move || Gate::default().me(&c);
    let route = route_of("GET", "/api/masters/status").unwrap();
    assert!(handle(route, "", b"", &store, &local, &me, &common::program()).is_none(), "空の共有: 窓は種をまかずに Python に任せる");
    // Python の status（種をまく）を別のプロセスで動かす間、窓も尋ね続ける
    let py = std::thread::spawn({
        let rs = rs.clone();
        move || common::python_json("place_oracle.py", &["--status", &rs])
    });
    let mut answered = 0;
    while !py.is_finished() {
        if handle(route, "", b"", &store, &local, &me, &common::program()).is_some() {
            answered += 1;
        }
    }
    let want = py.join().unwrap();
    let got = handle(route, "", b"", &store, &local, &me, &common::program()).expect("まき終えた後は窓が答える").1;
    let strip = |v: &Value| {
        let mut v = norm(v, &rs);
        // 更新した人（種をまいた Python のプロセスの名乗り〈試験では本物の名乗り〉）は比べない
        for m in v["masters"].as_object_mut().unwrap().values_mut() {
            m.as_object_mut().unwrap().remove("updated_by");
        }
        for k in ["last_sync", "error", "lock", "who"] {
            v.as_object_mut().unwrap().remove(k);
        }
        v
    };
    assert_eq!(common::diff(&strip(&want), &strip(&got), ""), None, "窓 {got}\nPython {want}");
    for n in da_core::master_place::STATUS_NAMES {
        let d: Value = serde_json::from_slice(&std::fs::read(Path::new(&rs).join("share").join(format!("{n}.json"))).unwrap()).unwrap();
        assert!(d["revision"].as_i64().unwrap() >= 1 && d["rows"].is_array(), "{n}: {d}");
    }
    assert!(!Path::new(&rs).join("share/master.lock.json").exists(), "錠が残らない");
    eprintln!("Python が種をまく間に窓が答えた回数 {answered}");
    let _ = std::fs::remove_dir_all(&base);
}
