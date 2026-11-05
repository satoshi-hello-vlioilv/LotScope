//! 利用状況・使用の履歴・画面の設定の控え（src/presence.rs）が Python の道（心拍・routes/access.py の利用状況・/api/ui-state）と
//! 同じ答えか（版 3.71.0。順 5 の 3 段目）。program/tests/presence_oracle.py が場面ごとに同じ中身のフォルダを 2 つ作り、
//! 片方に Python の道で歩みの並びを当てる（1 歩ごとに時計を差し替える）。ここではもう片方に同じ並びを窓の道で当て、
//! 1 歩ごとの答え（状態・本文）と、終わった後のファイル（中身・字下げ・改行。書きかけの残りが無いこと）を突き合わせる。

mod common;

use chrono::NaiveDateTime;
use da_core::access::{self, revocation, Place};
use da_core::presence::{ui_state, Presence};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// 窓の答えの中の置き場の道（rs の作業フォルダ）を Python の物（py）に書き換える
fn swap_root(v: &Value, rs: &str, py: &str) -> Value {
    let esc = |s: &str| serde_json::to_string(s).unwrap().trim_matches('"').to_string();
    serde_json::from_str(&serde_json::to_string(v).unwrap().replace(&esc(rs), &esc(py))).unwrap()
}

/// 終わった後のファイル（相対の道 → 字）
fn files(root: &Path) -> Vec<(String, String)> {
    fn walk(d: &Path, out: &mut Vec<PathBuf>) {
        for e in std::fs::read_dir(d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else {
                out.push(p);
            }
        }
    }
    let mut ps = vec![];
    for d in ["share/presence_tpa", "gone"] {
        walk(&root.join(d), &mut ps);
    }
    let ui = root.join("local").join("ui_state.json");
    if ui.exists() {
        ps.push(ui);
    }
    let mut out: Vec<(String, String)> = ps
        .iter()
        .map(|p| {
            let rel = p
                .strip_prefix(root)
                .unwrap()
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            (rel, String::from_utf8_lossy(&std::fs::read(p).unwrap()).into_owned())
        })
        .collect();
    out.sort();
    out
}

#[test]
fn presence_matches_python() {
    let base = common::work("presence");
    let oracle = common::python_json("presence_oracle.py", &[base.to_str().unwrap()]);
    let version = oracle["version"].as_str().unwrap();
    let mut bad = vec![];
    let mut steps = 0;
    for sc in oracle["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let (py, rs) = (sc["py"].as_str().unwrap(), sc["rs"].as_str().unwrap());
        let rs_root = PathBuf::from(rs);
        let local = rs_root.join("local");
        let now: Arc<Mutex<NaiveDateTime>> = Arc::new(Mutex::new(NaiveDateTime::default()));
        let clock = now.clone();
        let pres = Presence::new(local.clone(), da_core::presence::clock_from(move || *clock.lock().unwrap()));
        pres.set_version(version);
        let place = Place::from_json(&sc["conf"]["place"]);
        pres.configure(place.presence.clone());
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            let t = access::parse_at(st["t"].as_str().unwrap()).expect("時刻");
            *now.lock().unwrap() = t;
            let mut conf = sc["conf"].clone();
            if let Some(w) = st["who"].as_array() {
                conf["who"]["login"] = w[0].clone();
                conf["who"]["pc"] = w[1].clone();
                conf["who"]["key"] = st["key"].clone();
            }
            let key = st["key"].as_str().unwrap_or("");
            let me = || access::me(&conf, revocation(pres.dir().as_deref(), key, t)).expect("me");
            let got: Option<(u16, Value)> = match st["op"].as_str().unwrap() {
                "file" => {
                    let rel = st["path"].as_str().unwrap();
                    let p = match rel.strip_prefix("@local/") {
                        Some(r) => local.join(r),
                        None => pres.dir().unwrap().join(rel),
                    };
                    match st["text"].as_str() {
                        Some(text) => {
                            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                            std::fs::write(&p, text).unwrap();
                        }
                        None => {
                            let _ = std::fs::remove_file(&p);
                        }
                    }
                    None
                }
                "want" => {
                    let w = local.join("want.json");
                    match st["version"].as_str() {
                        Some(v) => std::fs::write(&w, json!({"version": v}).to_string()).unwrap(),
                        None => {
                            let _ = std::fs::remove_file(&w);
                        }
                    }
                    None
                }
                "move" => {
                    pres.configure(Some(rs_root.join(st["to"].as_str().unwrap())));
                    None
                }
                "leave" => {
                    let w = st["who"].as_array().unwrap();
                    pres.leave_as(w[0].as_str().unwrap(), w[1].as_str().unwrap(), key);
                    None
                }
                "beat" => {
                    let m = me();
                    pres.beat(&m);
                    Some((200, pres.answer(&m)))
                }
                _ => {
                    let (method, path) = (st["method"].as_str().unwrap(), st["path"].as_str().unwrap());
                    let body = st["body"].as_str().unwrap_or("").as_bytes();
                    if path == "/api/ui-state" {
                        if method == "GET" {
                            Some((200, ui_state::load(&local)))
                        } else {
                            Some(ui_state::post(&local, body).expect("窓が答える"))
                        }
                    } else {
                        let m = me();
                        Some(
                            pres.handle(&m, place.share_dir.is_some(), method, path, st["query"].as_str().unwrap_or(""), body)
                                .expect("窓が答える"),
                        )
                    }
                }
            };
            let Some((status, got)) = got else { continue };
            steps += 1;
            let got = swap_root(&got, rs, py);
            let want = &st["json"];
            if status as i64 != st["status"].as_i64().unwrap() || common::diff(want, &got, "").is_some() {
                let d = common::diff(want, &got, "").unwrap_or_default();
                bad.push(format!(
                    "{name} [{i}] {} {}?{}: Python {} / 窓 {status}: {d}\n  Python {}\n  窓     {}",
                    st["op"],
                    st["path"].as_str().unwrap_or(""),
                    st["query"].as_str().unwrap_or(""),
                    st["status"],
                    want.to_string().chars().take(600).collect::<String>(),
                    got.to_string().chars().take(600).collect::<String>()
                ));
            }
        }
        // 終わった後のファイル: 同じ物があり、窓が書いた物は Python の字下げ・改行と同じ（鍵の並びは問わない）
        let want = sc["files"].as_object().unwrap();
        let got = files(&rs_root);
        for (rel, text) in &got {
            if rel.contains(".tmp") {
                bad.push(format!("{name}: 窓が残した書きかけ {rel}"));
                continue;
            }
            match want.get(rel) {
                None => bad.push(format!("{name}: Python に無いファイル {rel}")),
                Some(w) if w["text"] == json!(text) || w["canon"] == json!(text) => {}
                Some(w) => bad.push(format!("{name}: ファイル {rel}\n  Python {}\n  窓     {}", w["canon"], json!(text))),
            }
        }
        for rel in want.keys() {
            if !got.iter().any(|(r, _)| r == rel) {
                bad.push(format!("{name}: 窓に無いファイル {rel}"));
            }
        }
    }
    assert!(steps >= 100, "歩が少ない: {steps}");
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
