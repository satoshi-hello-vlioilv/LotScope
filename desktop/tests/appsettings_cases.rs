//! 配った設定の読み方（版 3.112.0。段 ③ の最初）: 仕様から人が書いた事例の表 program/tests/fixtures/appsettings_cases.json を、窓
//! （src/bundle.rs の read_settings・inputs・build・Lot::update_settings・GET /api/config）が同じに答えるか。Python に頼らない
//! （Python は tests/test_appsettings_cases.py が同じ表を読む）。決め: 配った設定は Python の json.loads と同じく読み、段が表でない形は
//! その段だけ組まず理由（stage）を付け、置き場・名乗り・権限・更新の置き場はどの段が壊れても組む。

mod common;

use da_core::bundle::{Builder, Env};
use da_core::lot::Lot;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn table() -> Value {
    common::json_keep(include_bytes!("../../program/tests/fixtures/appsettings_cases.json")).expect("事例の表")
}

/// 事例を 1 つのフォルダに置く: share（参照先の行）・local・base・config.json。→ (Lot, Builder の材料, 共有の道)
fn place(root: &Path, c: &Value) -> (Lot, Env, String) {
    let _ = std::fs::remove_dir_all(root);
    let (share, local, base) = (root.join("share"), root.join("local"), root.join("base"));
    for d in [&share, &local, &base] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::write(local.join("instance_id"), "inst-case").unwrap();
    let share_s = share.to_string_lossy().into_owned();
    let esc = serde_json::to_string(&share_s).unwrap();
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
        let doc = json!({"schema": 1, "revision": 3, "updated_at": "", "updated_by": {}, "rows": rows});
        std::fs::write(share.join("path_settings.json"), doc.to_string()).unwrap();
    }
    if c["remember"] == true {
        std::fs::write(local.join("master_share.json"), json!({"dir": share_s}).to_string()).unwrap();
    }
    let env = Env { base, program: common::program(), local: local.clone(), config: root.join("config.json"), now: None };
    let lot = Lot::new(local.join("db_cache"));
    lot.set_program(common::program());
    (lot, env, share_s)
}

fn at<'a>(v: &'a Value, path: &str) -> &'a Value {
    path.split('.').fold(v, |v, k| &v[k])
}

/// 表の値（@share・@big:）と窓の値が同じか
fn same(want: &Value, got: &Value, share: &str) -> bool {
    match want {
        Value::String(w) if w == "@share" => da_core::bundle::py_path(got.as_str().unwrap_or("")) == da_core::bundle::py_path(share),
        Value::String(w) if w.starts_with("@big:") => da_core::worksum::py_str(got) == w["@big:".len()..],
        Value::Number(_) => got.as_f64() == want.as_f64() && got.is_i64() == want.is_i64(),
        _ => common::diff(want, got, "").is_none(),
    }
}

/// 窓が事例どおりに答えるか → 違いの言葉
fn check(c: &Value, root: &Path) -> Vec<String> {
    let name = c["name"].as_str().unwrap();
    let want = &c["want"];
    let (lot, env, share) = place(root, c);
    let mut bad = vec![];
    let b = Builder::new(env.clone());
    let got = b.build();
    match (want["bundle"].as_str(), &got) {
        (Some("err"), Ok(v)) => bad.push(format!("{name}: 束を組んだ（置き場が決まらないはず）: {}", v["access"]["place"])),
        (Some("ok"), Err(e)) => bad.push(format!("{name}: 束を組めない（{}）", e.say())),
        (Some("err"), Err(e)) if !e.say().contains("config.json") => {
            bad.push(format!("{name}: 置き場が決まらない理由に配った設定のファイルの名前が無い: {}", e.say()))
        }
        _ => {}
    }
    if let Ok(v) = &got {
        // 組まない節と段
        let broken: Vec<(String, String)> = v["broken"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, w)| w["warn"] != true)
            .map(|(k, w)| (k.clone(), w["stage"].as_str().unwrap_or("?").to_string()))
            .collect();
        let mut want_b: Vec<(String, String)> =
            want["broken"].as_object().into_iter().flatten().map(|(k, s)| (k.clone(), s.as_str().unwrap().to_string())).collect();
        want_b.sort();
        let mut got_b = broken.clone();
        got_b.sort();
        if got_b != want_b {
            bad.push(format!("{name}: 組まない節と段 {got_b:?}（表 {want_b:?}）: {}", v["broken"]));
        }
        for (k, w) in v["broken"].as_object().into_iter().flatten() {
            let why = w["why"].as_str().unwrap_or("");
            if want_b.iter().any(|(n, _)| n == k) && (!why.contains("config.json") || w["file"] != "config.json" || w["window"] == true) {
                bad.push(format!("{name}: 節 {k} の理由が配った設定のファイルと段を言わない（または window）: {w}"));
            }
        }
        // 配った設定の段の壊れ（settingsBroken）
        let mut stages: Vec<String> =
            v["settingsBroken"].as_array().into_iter().flatten().map(|p| p["stage"].as_str().unwrap_or("").to_string()).collect();
        stages.sort();
        let mut want_s: Vec<String> = want["stages"].as_array().into_iter().flatten().map(|s| s.as_str().unwrap().to_string()).collect();
        want_s.sort();
        if stages != want_s {
            bad.push(format!("{name}: 段の壊れ {stages:?}（表 {want_s:?}）: {}", v["settingsBroken"]));
        }
        for p in v["settingsBroken"].as_array().into_iter().flatten() {
            if p["file"] != "config.json" || !p["why"].as_str().unwrap_or("").contains("config.json") {
                bad.push(format!("{name}: 段の壊れの理由がファイルを言わない: {p}"));
            }
        }
        // 置き場・名乗りはいつも組む
        if !v["access"]["who"]["key"].is_string() || !v["access"]["place"].is_object() {
            bad.push(format!("{name}: 名乗りと置き場を組まない: {}", v["access"]));
        }
        // 答えに NaN の印が残らない（Python の jsonify と同じく null）
        if da_core::held::has_nonfinite(v) {
            bad.push(format!("{name}: 答えに NaN・Infinity が残った"));
        }
        for (k, w) in want["values"].as_object().into_iter().flatten() {
            let g = at(v, k);
            let ok = match w.as_str() {
                Some("@os") => g.as_str().is_some_and(|x| !x.contains("この端末の名前")),
                _ => same(w, g, &share),
            };
            if !ok {
                bad.push(format!("{name}: {k} = {g}（表 {w}）"));
            }
        }
    }
    // 更新の置き場（採点の指摘 1: 束を組めない形でも Lot::update_settings は答える）
    lot.set_bundle(Builder::new(env));
    // @unknown は決まらない（None: 更新の係は確かめずに控えた置き場を残す。空の字で控えを上書きしない）
    if let Some(u) = want["update"].as_str() {
        match lot.update_settings() {
            None if u == "@unknown" => {}
            Some(s) if s["source"] == u => {}
            other => bad.push(format!("{name}: 更新の置き場 {:?}（表 {u}）", other.map(|s| s["source"].clone()))),
        }
    }
    // GET /api/config
    match &want["config"] {
        Value::String(x) if x == "python" => {
            if let Some((st, v)) = lot.handle_body("GET", "/api/config", "", b"") {
                bad.push(format!("{name}: /api/config を窓が答えた（残りは中身へ回す）: {st} {v}"));
            }
        }
        Value::Object(o) => match lot.handle_body("GET", "/api/config", "", b"") {
            Some((200, v)) => {
                for (k, w) in o {
                    if !same(w, &v[k], &share) {
                        bad.push(format!("{name}: /api/config の {k} = {}（表 {w}）", v[k]));
                    }
                }
            }
            other => bad.push(format!("{name}: /api/config を窓が答えない: {other:?}")),
        },
        _ => {}
    }
    bad
}

#[test]
fn settings_are_read_like_the_table() {
    let t = table();
    let cases = t["cases"].as_array().unwrap();
    assert!(cases.len() >= 50, "事例が足りません: {}", cases.len());
    let work = common::work("appsettings");
    let mut bad = vec![];
    for (i, c) in cases.iter().enumerate() {
        bad.extend(check(c, &work.join(format!("c{i}"))));
    }
    let _ = std::fs::remove_dir_all(&work);
    assert!(bad.is_empty(), "{} か所違います:\n{}", bad.len(), bad.join("\n"));
}

/// 窓は束を Python に尋ねない（版 3.112.0。採点の指摘 8・コンパイルで保つ）: 窓の中身（main.rs・lot.rs の本体）に束を尋ねる口の名前が無い
#[test]
fn the_window_has_no_mouth_that_asks_python_for_the_bundle() {
    let src = |f: &str| std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src").join(f)).unwrap();
    let main = src("main.rs");
    for w in ["/api/lotlist/settings", "/api/update/settings", "lot_settings", "ask_update_settings", "AskSettings"] {
        assert!(!main.contains(w), "main.rs に {w}");
    }
    let lot = src("lot.rs");
    let body = &lot[..lot.find("#[cfg(test)]\nmod tests").unwrap()];
    assert!(!body.contains("type AskSettings") && !body.contains("ask: AskSettings"), "lot.rs に AskSettings");
    // 束を差し込む口（given）は試験の組み立てだけ（cfg(test)・feature "testing"）
    for line in body.lines().filter(|l| l.contains("given::")) {
        let at = body.find(line).unwrap();
        let before = &body[..at];
        let near: String = before.chars().rev().take(300).collect::<Vec<_>>().into_iter().rev().collect();
        assert!(near.contains("cfg(any(test, feature = \"testing\"))") || near.contains("cfg(test)"), "試験の口でない所で given: {line}");
    }
}

/// 2 台の PC（採点の指摘 11）: 3.111.0 と 3.112.0 の PC が同じ壊れた配った設定（NaN・lot_list が字）と同じ共有で動くとき、3.112.0 の窓は
/// 答えるが、共有に書く物は増やさない（段の壊れの理由〈settingsBroken・stage〉は答えにだけ載せる）。共有のファイルは前の版の Python と
/// 窓が読む形（最初の版の種と利用状況）だけで、知らない鍵を書かない
#[test]
fn a_broken_config_writes_nothing_new_to_the_share() {
    let t = table();
    let work = common::work("appsettings-share");
    for name in ["lot_list が字", "page_size が NaN", "update が null で参照先に更新の置き場", "identity が字"] {
        let c = t["cases"].as_array().unwrap().iter().find(|c| c["name"] == name).unwrap();
        let root = work.join(name.replace(' ', "_"));
        let (lot, env, share) = place(&root, c);
        lot.set_bundle(Builder::new(env));
        let ready = || da_core::presence::PythonNow { state: "ready", why: String::new() };
        let stopped = || da_core::presence::PythonNow { state: "stopped", why: "試験".into() };
        let _ = lot.handle_body("GET", "/api/lotlist", "", b"");
        let _ = lot.handle_body("GET", "/api/config", "", b"");
        let _ = lot.handle_body("GET", "/api/worklog", "equip=x", b"");
        let _ = lot.access_read("GET", "/api/access/me");
        let _ = lot.update_settings();
        assert!(lot.heartbeat(&ready).is_some_and(|r| r.0 == 200), "{name}: 心拍");
        assert!(lot.heartbeat(&stopped).is_some_and(|r| r.0 == 200), "{name}: 心拍（中身が止まっていても）");
        std::thread::sleep(std::time::Duration::from_millis(300)); // 利用状況は裏の糸が書く
        lot.leave();
        let mut files = vec![];
        fn walk(d: &Path, out: &mut Vec<PathBuf>) {
            for e in std::fs::read_dir(d).into_iter().flatten().flatten() {
                if e.path().is_dir() {
                    walk(&e.path(), out);
                } else {
                    out.push(e.path());
                }
            }
        }
        walk(Path::new(&share), &mut files);
        for f in &files {
            let text = std::fs::read_to_string(f).unwrap_or_default();
            for k in ["settingsBroken", "\"stage\"", "config.json"] {
                assert!(!text.contains(k), "{name}: 共有の {} に答えの鍵 {k}", f.display());
            }
            let rel = f.strip_prefix(&share).unwrap().to_string_lossy().into_owned();
            let top = f.parent() == Some(Path::new(&share));
            let known = rel.starts_with("presence_tpa") || (top && rel.ends_with(".json"));
            assert!(known, "{name}: 共有に知らないファイル {rel}");
        }
    }
    let _ = std::fs::remove_dir_all(&work);
}
