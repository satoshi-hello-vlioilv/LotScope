//! LotDsp の 9 本（src/lotdsp.rs・lotdsp_direct.rs）が Python の道（routes/lots.py）と同じ答えか（版 3.98.0）。
//! program/tests/lotdsp_oracle.py が作り物の LotDsp の API・サイトを起こしたまま、場面ごとの Python の答え（状態・本文・1 歩ごとの
//! 学びの覚え）と、作り物のブラウザ（tests/lotdsp_cdp_fake.py）で見えない Edge の係を通した答え・送った DevTools の命令の並びを出す。
//! ここでは同じ設定・同じ設備マスタ・同じ作り物で窓の係に同じ本文を当て、答え・覚え・命令の並びが同じか（時刻と秒は伏せる）を見る。
//! 窓は 9 本のどの形も自分で答える（Python に任せない）ことも確かめる。

mod common;

use da_core::lotdsp::{route_of, Inputs, Lotdsp};
use da_core::lotdsp_direct::{Cfg, Direct};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;

fn mask(v: &Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(
            m.iter()
                .map(|(k, x)| (k.clone(), if ["at", "conflict", "seconds"].contains(&k.as_str()) { json!("*") } else { mask(x) }))
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(mask).collect()),
        x => x.clone(),
    }
}

fn hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn lotdsp(local: &Path) -> Arc<Lotdsp> {
    let l = Arc::new(Lotdsp::new(local.to_path_buf(), Direct::real()));
    l.sync_learn.store(true, std::sync::atomic::Ordering::SeqCst);
    l
}

#[test]
fn lotdsp_matches_python() {
    let base = common::work("lotdsp");
    let (mut live, oracle) = common::Live::start("lotdsp_oracle.py", &["serve", base.join("py").to_str().unwrap()]);
    let mut bad: Vec<String> = vec![];
    let mut steps = 0;
    // ---------------------------------------------------------------- 道（作り物の API）
    for sc in oracle["api"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let local = base.join("rs").join(name.replace('/', "_"));
        let _ = std::fs::remove_dir_all(&local);
        std::fs::create_dir_all(&local).unwrap();
        if sc["setup"] == "unwritable" {
            std::fs::create_dir_all(local.join("lotdsp_api_map.json")).unwrap();
        }
        let l = lotdsp(&local);
        let mut li = sc["li"].clone();
        let equipment = sc["equipment"].as_array().unwrap().clone();
        for st in sc["steps"].as_array().unwrap() {
            steps += 1;
            if let Some(x) = st.get("li") {
                li = x.clone();
            }
            let case = format!("{name} / {}", st.get("name").and_then(Value::as_str).unwrap_or(st["path"].as_str().unwrap()));
            let (method, path) = (st["method"].as_str().unwrap(), st["path"].as_str().unwrap());
            let Some(route) = route_of(method, path) else {
                bad.push(format!("{case}: 窓の道に無い"));
                continue;
            };
            let inp = || Ok(Inputs { app: li.clone(), eff: li.clone(), equipment: equipment.clone() });
            let t0 = std::time::Instant::now();
            let (status, got) =
                l.handle(route, st["query"].as_str().unwrap_or(""), &hex(st["body_hex"].as_str().unwrap()), &inp, &move || {
                    t0.elapsed().as_secs_f64()
                });
            if status as i64 != st["status"].as_i64().unwrap() {
                bad.push(format!(
                    "{case}: 状態 Python {} / 窓 {status}: {}",
                    st["status"],
                    got.to_string().chars().take(300).collect::<String>()
                ));
                continue;
            }
            if let Some(d) = common::diff(&st["json"], &mask(&got), "") {
                bad.push(format!("{case}: {d}"));
            }
            let map = std::fs::read_to_string(local.join("lotdsp_api_map.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
            let map = map.map(|m| mask(&m)).unwrap_or(Value::Null);
            if let Some(d) = common::diff(&st["map"], &map, "") {
                bad.push(format!("{case}: 学びの覚え {d}"));
            }
        }
    }
    // ---------------------------------------------------------------- 見えない Edge（作り物のブラウザ）
    let browser = oracle["browser"].as_str().unwrap().to_string();
    let site = format!("{}/LotDspWeb/", oracle["base"].as_str().unwrap());
    for (i, sc) in oracle["direct"].as_array().unwrap().iter().enumerate() {
        let name = sc["name"].as_str().unwrap();
        let d = base.join("rs").join(format!("direct-{i}"));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let li = match sc.get("li") {
            Some(li) => li.clone(),
            None => {
                let mut script = sc["script"].clone();
                script["href"] = json!(format!("{site}#/lotdsp"));
                script["log"] = json!(d.join("rs.log").to_string_lossy());
                std::fs::write(d.join("rs.json"), script.to_string()).unwrap();
                let over = &sc["over"];
                json!({"url": site, "direct": {"browser": browser, "extra_args": [format!("--fake-script={}", d.join("rs.json").display())],
                       "timeout_seconds": over.get("timeout_seconds").cloned().unwrap_or(json!(12)),
                       "start_timeout_seconds": over.get("start_timeout_seconds").cloned().unwrap_or(json!(10)),
                       "keep_seconds": 0, "window_keep_seconds": 0,
                       "login_wait_seconds": over.get("login_wait_seconds").cloned().unwrap_or(json!(30)),
                       "window_profile": d.join("rs-window").to_string_lossy()}})
            }
        };
        let window = sc.get("over").and_then(|o| o.get("window")).and_then(Value::as_bool).unwrap_or(false);
        let cfg = Cfg::from(&li, &d).unwrap();
        let direct = Direct::real();
        let tmp = d.join("tmp");
        std::fs::create_dir_all(&tmp).unwrap();
        direct.set_temp(&tmp); // ほかの試験（本物のブラウザ）の一時プロファイルと混ざらない
        let got = match direct.fetch("L7150C0", &cfg, window) {
            Ok(h) => json!({"ok": true, "html_len": h.chars().count(), "html_head": h.chars().take(200).collect::<String>()}),
            Err(e) => json!({"ok": false, "kind": e.kind, "error": e.msg}),
        };
        direct.shutdown();
        let left = temp_profiles(&tmp).len();
        if let Some(x) = common::diff(&sc["result"], &got, "") {
            bad.push(format!("見えない Edge / {name}: 答え {x}"));
        }
        if sc.get("left").is_some() && left as i64 != sc["left"].as_i64().unwrap() {
            bad.push(format!("見えない Edge / {name}: 一時プロファイルの残り Python {} / 窓 {left}", sc["left"]));
        }
        if sc.get("log").is_some() {
            let log: Vec<Value> =
                std::fs::read_to_string(d.join("rs.log")).unwrap_or_default().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
            if let Some(x) = common::diff(&sc["log"], &Value::Array(log.clone()), "") {
                bad.push(format!("見えない Edge / {name}: 送った命令 {x}\n  Python {}\n  窓     {}", sc["log"], Value::Array(log)));
            }
        }
    }
    live.send("");
    drop(live);
    let _ = std::fs::remove_dir_all(&base);
    println!("道 {steps} 歩・見えない Edge {} 場面", oracle["direct"].as_array().unwrap().len());
    assert!(steps >= 150, "歩が少ない: {steps}");
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

fn temp_profiles(dir: &Path) -> Vec<std::path::PathBuf> {
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("tpa-lotdsp-")))
                .collect()
        })
        .unwrap_or_default()
}

/// 窓は 9 本のどの形も自分で答える（Python に任せない）: 道の表・HEAD・いろいろな本文で答えが Some
#[test]
fn every_route_is_answered_by_the_window() {
    let base = common::work("lotdsp-routes");
    let l = lotdsp(&base);
    let inp = || {
        Ok(Inputs {
            app: json!({"url": "http://127.0.0.1:9/x/", "api": {"enabled": false}}),
            eff: json!({"url": "", "direct": {"enabled": false}}),
            equipment: vec![],
        })
    };
    let none = || Err::<Inputs, String>("材料を組めない".into());
    let bodies: [&[u8]; 7] = [b"", b"{}", b"[1]", b"{bad", b"{\"html\": NaN, \"lot_no\": [1]}", b"\xff", b"null"];
    for (m, p, _) in da_core::lotdsp::ROUTES {
        assert!(route_of(m, p).is_some(), "{m} {p}");
        if p == "/lotdsp-link" {
            continue; // 画面は main.rs が描く（描けなければ 500）
        }
        for b in bodies {
            for q in ["", "lot=L1", "engine=python"] {
                let (st, v) = l.handle(route_of(m, p).unwrap(), q, b, &inp, &|| 0.0);
                assert!(st >= 200 && v.is_object(), "{m} {p} {b:?}: {st} {v}");
                let (st, v) = l.handle(route_of(m, p).unwrap(), q, b, &none, &|| 0.0);
                assert!(st >= 200 && v.is_object(), "{m} {p}: {st} {v}");
            }
        }
    }
    assert!(route_of("HEAD", "/lotdsp-link").is_some());
    let _ = std::fs::remove_dir_all(&base);
}

/// 本物の Chromium（ある PC だけ）で、見本の LotDsp（program/tests/fixtures/lotdsp_site_fake.html）を見えない Edge の係で読み、取り込める
/// （使い回し・該当なし・ログインの画面は押さずに引き返す・一時プロファイルを消す）。Python の RealBrowser と同じ形
#[test]
fn a_real_browser_reads_the_fake_site() {
    let chrome = [
        "/opt/pw-browsers/chromium-1243/chrome-linux/chrome",
        "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
        "/usr/bin/google-chrome",
    ]
    .into_iter()
    .map(String::from)
    .chain(std::env::var("TPA_TEST_BROWSER").ok())
    .find(|p| Path::new(p).is_file());
    let Some(chrome) = chrome else {
        println!("Chromium が無いので飛ばす");
        return;
    };
    if !cfg!(unix) {
        return;
    }
    let site = std::fs::read(common::program().join("tests/fixtures/lotdsp_site_fake.html")).unwrap();
    let srv = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = srv.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for s in srv.incoming().flatten() {
            let site = site.clone();
            std::thread::spawn(move || {
                use std::io::{Read, Write};
                let mut s = s;
                let mut b = [0u8; 4096];
                let _ = s.read(&mut b);
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    site.len()
                );
                let _ = s.write_all(head.as_bytes());
                let _ = s.write_all(&site);
            });
        }
    });
    let base = common::work("lotdsp-real");
    // 名前が Edge・Chrome の形でないと起こさないので、決まった名前の道を作る（記号リンク）
    let exe = base.join("chromium");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&chrome, &exe).unwrap();
    let url = format!("http://127.0.0.1:{port}/LotDspWeb/");
    let li = |q: &str| {
        json!({"url": url, "direct": {"browser": exe.to_string_lossy(), "extra_args": ["--no-sandbox"], "timeout_seconds": 40,
               "start_timeout_seconds": 40, "search_url": format!("{url}{q}#/lotdsp")}})
    };
    let d = Direct::real();
    let tmp = base.join("tmp");
    std::fs::create_dir_all(&tmp).unwrap();
    d.set_temp(&tmp); // ほかの試験（作り物のブラウザの場面・Python の係）の一時プロファイルと混ざらない
    let master: Vec<Value> = serde_json::from_slice(&std::fs::read(common::program().join("data/equipment_master.json")).unwrap()).unwrap();
    let master = da_core::lotdsp::Master::new(&master);
    let html = d.fetch("L7150C0", &Cfg::from(&li(""), &base).unwrap(), false).expect("読める");
    let t = std::time::Instant::now();
    let again = d.fetch("L7150C0", &Cfg::from(&li(""), &base).unwrap(), false).expect("使い回して読める");
    assert!(t.elapsed() < std::time::Duration::from_secs(8));
    assert_eq!(d.status()["reused"], true);
    for h in [&html, &again] {
        let (lot, report, ..) = da_core::lotdsp::read_html(h, &master, &Value::Null, "L7150C0").expect("取り込める");
        assert_eq!(lot["lot_no"], "L7150C0");
        assert_eq!(report["actual_rows"], 10, "実績の行が描き終わるまで待ってから読む");
    }
    let nf = d.fetch("X9999", &Cfg::from(&li(""), &base).unwrap(), false).unwrap_err();
    assert_eq!(nf.kind, "not_found", "{nf:?}");
    d.shutdown();
    let login = d.fetch("L7150C0", &Cfg::from(&li("?vpn=1"), &base).unwrap(), false).unwrap_err();
    assert_eq!(login.kind, "login", "ログインが要る画面では押さずに引き返す: {login:?}");
    d.shutdown();
    let left = temp_profiles(&tmp);
    assert!(left.is_empty(), "閉じたら一時プロファイルは消す: {left:?}");
    let _ = std::fs::remove_dir_all(&base);
}
