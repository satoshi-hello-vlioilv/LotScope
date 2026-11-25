//! LotDsp の 9 本（src/lotdsp.rs・lotdsp_direct.rs）が Python の道（routes/lots.py）と同じ答えか（版 3.98.0）。
//! 前の版の答え合わせ役 lotdsp が作り物の LotDsp の API・サイトを起こしたまま、場面ごとの Python の答え（状態・本文・1 歩ごとの
//! 学びの覚え）と、作り物のブラウザ（tests/lotdsp_cdp_fake.py）で見えない Edge の係を通した答え・送った DevTools の命令の並びを出す。
//! ここでは同じ設定・同じ設備マスタ・同じ作り物で窓の係に同じ本文を当て、答え・覚え・命令の並びが同じか（時刻と秒は伏せる）を見る。
//! 窓は 9 本のどの形も自分で答える（Python に任せない）ことも確かめる。
//!
//! 版 3.117.0: 窓の答えを焼いた表（tests/baked/lotdsp.json）に持つ。Python 無しの形（TPA_NO_PYTHON=1）では、作り物の LotDsp の API と
//! サイトを app を import しない台本（program/tests/fakes_serve.py lotdsp）で起こしたままにして、焼いた答えと比べる。作り物の URL
//! （流すたびに変わるポート）は、表では名前つきの印 @URL(lotdsp)。作り物のブラウザを起こす包み（sh の台本）と、実行できないブラウザの
//! 見本は、窓の試験の側（作業フォルダの rs/）に作る（答え合わせ役の側 py/ は Python だけの写しで、表の場面に持たない）。

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

/// 作り物のブラウザ（program/tests/lotdsp_cdp_fake.py）を Edge として起こす包み（sh の台本）を dir/browser/chromium に作る → その道。
/// 答え合わせ役（前の版の答え合わせ役 lotdsp の wrapper）と同じ形。Python は TPA_PYTHON（無ければ python3）
fn wrapper(dir: &Path) -> String {
    let d = dir.join("browser");
    std::fs::create_dir_all(&d).unwrap();
    let exe = d.join("chromium");
    let py = common::bake::stdlib_python();
    let fake = common::program().join("tests").join("lotdsp_cdp_fake.py");
    std::fs::write(&exe, format!("#!/bin/sh\nexec \"{py}\" \"{}\" \"$@\"\n", fake.display())).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    exe.to_string_lossy().into_owned()
}

/// JSON の字の中の形（引用符の内側）
fn esc(s: &str) -> String {
    let t = serde_json::to_string(s).unwrap();
    t[1..t.len() - 1].to_string()
}

fn lotdsp(local: &Path) -> Arc<Lotdsp> {
    let l = Arc::new(Lotdsp::new(local.to_path_buf(), Direct::real()));
    l.sync_learn.store(true, std::sync::atomic::Ordering::SeqCst);
    l
}

#[test]
fn lotdsp_matches_python() {
    let base = common::work("lotdsp");
    let mut bk = common::bake::Bake::open("lotdsp", &base);
    bk.pack = true;
    // 表の問い合わせに Python の答えを持たない（歩の状態・本文・学びの覚え、見えない Edge の答え・命令の並び・残り・閉じた時期・かかった秒。
    // 窓の答えは answers に持つ。かかった秒は流すたびに変わるので焼かない）
    bk.strip = ["status", "json", "map", "result", "log", "left", "seconds", "closed"].iter().map(|s| s.to_string()).collect();
    bk.strip_in = vec!["method", "name"];
    // Python 無しの形では、作り物の LotDsp（API とサイト）を起こしたままの相手の台本で起こす
    bk.fakes = Some(("fakes_serve.py", vec!["lotdsp".to_string()]));
    let (live, oracle) = bk.live_table();
    let mut live = live.expect("作り物の LotDsp を起こしたままにする相手");
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
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
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
            let map = std::fs::read_to_string(local.join("lotdsp_api_map.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
            let map = map.map(|m| mask(&m)).unwrap_or(Value::Null);
            let key = format!("{name} #{i} {}", st.get("name").and_then(Value::as_str).unwrap_or(path));
            let w = bk.want(&key, || json!({"status": st["status"], "json": st["json"], "map": st["map"]}));
            let g = json!({"status": status, "json": mask(&got), "map": map});
            bk.note(&key, &format!("{method} {path}"), &g, &w);
            let (g, w) = (bk.s(&g), bk.s(&w));
            if g["status"] != w["status"] {
                bad.push(format!(
                    "{case}: 状態 Python {} / 窓 {status}: {}",
                    w["status"],
                    got.to_string().chars().take(300).collect::<String>()
                ));
                continue;
            }
            if let Some(d) = common::diff(&w["json"], &g["json"], "") {
                bad.push(format!("{case}: {d}"));
            }
            if let Some(d) = common::diff(&w["map"], &g["map"], "") {
                bad.push(format!("{case}: 学びの覚え {d}"));
            }
        }
    }
    // ---------------------------------------------------------------- 見えない Edge（作り物のブラウザ）
    // 作り物のブラウザの包みと、実行できないブラウザの見本は窓の試験の側（rs/）に作る。答え合わせ役の場面の設定（li）の道（py/）は rs/ に読み替え、
    // 窓の答えの中の道は py/ に戻してから比べる（Python の答えと同じ字・表も同じ字）
    let browser = wrapper(&base.join("rs"));
    let noexec = base.join("rs").join("noexec").join("chromium");
    std::fs::create_dir_all(noexec.parent().unwrap()).unwrap();
    std::fs::write(&noexec, "not a program\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&noexec, std::fs::Permissions::from_mode(0o644)).unwrap();
    }
    let (py_dir, rs_dir) = (esc(&base.join("py").to_string_lossy()), esc(&base.join("rs").to_string_lossy()));
    let swap = |v: &Value, from: &str, to: &str| -> Value { serde_json::from_str(&v.to_string().replace(from, to)).unwrap() };
    let site = format!("{}/LotDspWeb/", oracle["base"].as_str().unwrap());
    for (i, sc) in oracle["direct"].as_array().unwrap().iter().enumerate() {
        let name = sc["name"].as_str().unwrap();
        if sc["watch"] == true {
            // Windows の表だけの形（版 3.117.3）: 表の宣言の場面は Linux の形（sh の包み）で、Windows の Python と比べる形と同じく
            // 作り物のブラウザを起こせない（信じるブラウザの名前は msedge.exe・chrome.exe だけ）ので見張りの場面は流さない（nt の表の skip）
            if cfg!(windows) && !bk.python() {
                println!("見えない Edge / {name}: 飛ばす（Windows の表だけの形）");
                continue;
            }
            if let Some(why) = sc["skipped"].as_str() {
                // 作り物のブラウザを起こせない環境（Windows の trusted_browser の決まり）だけ。Linux の CI で飛ばしたら落とす
                if cfg!(unix) {
                    bad.push(format!("見えない Edge / {name}: unix で飛ばした（{why}）"));
                } else {
                    println!("見えない Edge / {name}: 飛ばす（{why}）");
                }
                continue;
            }
            let key = format!("見えない Edge / {name}");
            let w = bk.want(&key, || json!({"closed": sc["closed"], "log": sc["log"]}));
            match watch_scenario(sc, &browser, &site, &base.join("rs").join("direct-watch")) {
                Err(x) => bad.push(format!("見えない Edge / {name}: {x}")),
                Ok(g) => {
                    bk.note(&key, "direct watch", &g, &w);
                    let (g, w) = (bk.s(&g), bk.s(&w));
                    if g["closed"] != w["closed"] {
                        bad.push(format!("見えない Edge / {name}: 閉じた時期 Python {} / 窓 {}", w["closed"], g["closed"]));
                    }
                    if let Some(x) = common::diff(&w["log"], &g["log"], "") {
                        bad.push(format!("見えない Edge / {name}: 送った命令 {x}"));
                    }
                }
            }
            continue;
        }
        let d = base.join("rs").join(format!("direct-{i}"));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        // 台本つきの場面（作り物のブラウザを起こす）は、一時プロファイルの残りと送った命令の並びも比べる
        let scripted = sc.get("script").is_some();
        let li = match sc.get("li") {
            Some(li) => swap(li, &py_dir, &rs_dir),
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
        let log: Vec<Value> =
            std::fs::read_to_string(d.join("rs.log")).unwrap_or_default().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        let key = format!("見えない Edge / {name}");
        let w = bk.want(&key, || json!({"result": sc["result"], "left": sc["left"], "log": sc["log"]}));
        let g = if scripted {
            json!({"result": got, "left": left, "log": log})
        } else {
            json!({"result": swap(&got, &rs_dir, &py_dir), "left": null, "log": null})
        };
        bk.note(&key, "direct", &g, &w);
        let (g, w) = (bk.s(&g), bk.s(&w));
        if let Some(x) = common::diff(&w["result"], &g["result"], "") {
            bad.push(format!("見えない Edge / {name}: 答え {x}"));
        }
        if scripted && g["left"] != w["left"] {
            bad.push(format!("見えない Edge / {name}: 一時プロファイルの残り Python {} / 窓 {}", w["left"], g["left"]));
        }
        if scripted {
            if let Some(x) = common::diff(&w["log"], &g["log"], "") {
                bad.push(format!("見えない Edge / {name}: 送った命令 {x}\n  Python {}\n  窓     {}", w["log"], g["log"]));
            }
        }
    }
    live.send("");
    drop(live);
    println!("道 {steps} 歩・見えない Edge {} 場面", oracle["direct"].as_array().unwrap().len());
    assert!(steps >= 150, "歩が少ない: {steps}");
    bk.finish(&bad);
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 差し替えた時計（本物の時計＋進めた秒）で、見張りが Browser.close を出す時期が Python と同じか（作った後の採点の足りない突き合わせ）
fn watch_scenario(sc: &Value, browser: &str, site: &str, d: &Path) -> Result<Value, String> {
    use std::sync::{Condvar, Mutex};
    let _ = std::fs::remove_dir_all(d);
    std::fs::create_dir_all(d).unwrap();
    let mut script = sc["script"].clone();
    script["href"] = json!(format!("{site}#/lotdsp"));
    script["log"] = json!(d.join("rs.log").to_string_lossy());
    std::fs::write(d.join("rs.json"), script.to_string()).unwrap();
    let li = json!({"url": site, "direct": {"browser": browser, "extra_args": [format!("--fake-script={}", d.join("rs.json").display())],
                    "timeout_seconds": 12, "start_timeout_seconds": 10, "keep_seconds": 300, "window_keep_seconds": 1800,
                    "login_wait_seconds": 30, "window_profile": d.join("rs-window").to_string_lossy()}});
    let off = Arc::new((Mutex::new(0.0f64), Condvar::new()));
    let real = || std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64();
    let o1 = off.clone();
    let clock: da_core::lotdsp_direct::Clock = Arc::new(move || real() + *o1.0.lock().unwrap());
    let o2 = off.clone();
    let sleep: da_core::lotdsp_direct::Sleep = Arc::new(move |s| {
        let end = real() + *o2.0.lock().unwrap() + s;
        let mut g = o2.0.lock().unwrap();
        while real() + *g < end {
            let left = (end - real() - *g).clamp(0.001, 0.05);
            g = o2.1.wait_timeout(g, std::time::Duration::from_secs_f64(left)).unwrap().0;
        }
    });
    let direct = Direct::new(Box::new(da_core::lotdsp_direct::RealLaunch), clock, sleep);
    let tmp = d.join("tmp");
    std::fs::create_dir_all(&tmp).unwrap();
    direct.set_temp(&tmp);
    let cfg = Cfg::from(&li, d).unwrap();
    let closed = || std::fs::read_to_string(d.join("rs.log")).unwrap_or_default().contains("Browser.close");
    if let Err(e) = direct.fetch("L7150C0", &cfg, false) {
        return Err(format!("読めない {e:?}"));
    }
    let mut got = vec![closed()];
    for s in sc["steps"].as_array().unwrap() {
        *off.0.lock().unwrap() += s.as_f64().unwrap();
        off.1.notify_all();
        std::thread::sleep(std::time::Duration::from_millis(2500));
        got.push(closed());
    }
    direct.shutdown();
    let log: Vec<Value> =
        std::fs::read_to_string(d.join("rs.log")).unwrap_or_default().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    Ok(json!({"closed": got, "log": log}))
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
