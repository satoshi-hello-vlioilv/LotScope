//! スケジュール（CM3。src/schedule.rs・cm3.rs・cm3_http.rs）が Python の道（routes/schedule.py・services/schedule.py・cm3_schedule.py）と
//! 同じ答えか（版 3.96.0）。program/tests/schedule_oracle.py serve が作り物の CM3（tests/schedule_fixture.Cm3Server）を起こし、場面ごとに
//! Python の道（窓の無い形＝Python が係）の答え・置いた世代と状態のファイル・CM3 が受けた要求を書く。ここでは同じ作り物の CM3 に
//! 本物の窓の道（Lot::handle_body。設定は窓の束の材料）で同じ並びを当て、1 歩ごとの答え（状態・本文。断る言葉も 1 字まで）・
//! 世代の表（列・行・値の型）と状態のファイル（seq・error・整えた答え。時刻と指紋は伏せる）・CM3 への要求（要求の行・見出しの並びと値・本文）を
//! 突き合わせる。窓が答えず Python に任せる歩（delegate）は、窓が答えず、状態に「係を降りた」と書いたことを見る。
//! 続けて、錠を待つ問い合わせが先に済んだ結果を使う形（黙る CM3 に 4 本同時）と、2 つのプロセス（窓と受け身の Python が rrprrp・prrrpp の
//! 順に取り直す）で、相手の今の世代が消えない・Python が世代を置かない・CM3 への問い合わせが 1 回ずつであることを見る。
//! 字の読み（CP932・Shift_JIS・CP1252 の 1・2 バイトの全部・UTF-8 の置き換え・charset の名前）は codecs で Python と比べる。

mod common;

use da_core::bundle::{Builder, Env};
use da_core::lot::Lot;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 伏せる時刻（timing は道の中の時間、now はダッシュボードの今）
const TIMES: [&str; 7] = ["fetchedAt", "checkedAt", "copiedAt", "changedAt", "builtAt", "timing", "now"];

/// 比べる形（時刻を伏せ、走る係の名前〈/rs/・/py/〉・置き場・書き手の印をそろえる）
fn norm(v: &Value, rs: &str, py: &str) -> Value {
    match v {
        Value::String(s) => {
            json!(s.replace(rs, py).replace("/rs/", "/py/").replace(".rs.sqlite3", ".w.sqlite3").replace(".py.sqlite3", ".w.sqlite3"))
        }
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| {
                    let x = if TIMES.contains(&k.as_str()) && !x.is_null() { json!("<t>") } else { norm(x, rs, py) };
                    (k.clone(), x)
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(|x| norm(x, rs, py)).collect()),
        _ => v.clone(),
    }
}

/// 置き場の世代（表の中身）と状態のファイル（oracle の files と同じ形）
fn files(root: &Path) -> Map<String, Value> {
    let mut out = Map::new();
    let d = root.join("local").join("db_cache").join("schedule");
    let mut names: Vec<PathBuf> = std::fs::read_dir(&d).into_iter().flatten().flatten().map(|e| e.path()).collect();
    names.sort();
    for p in names {
        let n = p.file_name().unwrap().to_string_lossy().replace(".rs.", ".w.").replace(".py.", ".w.");
        if n.ends_with(".sqlite3") {
            let c = rusqlite::Connection::open(&p).unwrap();
            let t: String = c.query_row("SELECT name FROM sqlite_master WHERE type='table'", [], |r| r.get(0)).unwrap();
            let mut st = c.prepare(&format!("SELECT * FROM \"{t}\"")).unwrap();
            let cols: Vec<String> = st.column_names().iter().map(|s| s.to_string()).collect();
            let rows: Vec<Value> = st
                .query_map([], |r| {
                    Ok(Value::Array(
                        (0..cols.len())
                            .map(|i| match r.get_ref(i).unwrap() {
                                rusqlite::types::ValueRef::Null => json!(["NoneType", null]),
                                rusqlite::types::ValueRef::Integer(x) => json!(["int", x]),
                                rusqlite::types::ValueRef::Real(x) => json!(["float", x]),
                                rusqlite::types::ValueRef::Text(x) => json!(["str", String::from_utf8_lossy(x)]),
                                rusqlite::types::ValueRef::Blob(_) => json!(["bytes", null]),
                            })
                            .collect(),
                    ))
                })
                .unwrap()
                .map(Result::unwrap)
                .collect();
            out.insert(n, json!({"table": t, "cols": cols, "rows": rows}));
        } else if n.ends_with(".state.json") {
            out.insert(n, serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap());
        }
    }
    out
}

/// 状態のファイルの比べる所（書き手は伏せ、道はファイル名だけ。指紋は書き手によらず同じ字〈作った後の直し〉なので比べる）
fn state_view(v: &Value) -> Value {
    let mut v = v.clone();
    if let Some(o) = v.as_object_mut() {
        o.remove("writer");
        if let Some(p) = o.get("path").and_then(Value::as_str) {
            let name = Path::new(p).file_name().unwrap().to_string_lossy().replace(".rs.", ".w.").replace(".py.", ".w.");
            o.insert("path".into(), json!(name));
        }
    }
    v
}

fn lot_for(e: &Value) -> Lot {
    let p = |k: &str| PathBuf::from(e[k].as_str().unwrap());
    // SAFETY: この試験の糸だけが環境を変える（配った設定の置き場）
    unsafe { std::env::set_var("TRANSFER_APP_CONFIG", e["config"].as_str().unwrap()) };
    let lot = Lot::new(p("local").join("db_cache"));
    lot.set_bundle(Builder::new(Env { base: p("base"), program: p("program"), local: p("local"), config: p("config"), now: None }));
    lot
}

fn no_python() -> Result<Value, String> {
    Err("Python は居ない".into())
}

fn call(lot: &Lot, st: &Value) -> Option<(u16, Value)> {
    lot.handle_body(
        st["method"].as_str().unwrap(),
        st["path"].as_str().unwrap(),
        st["query"].as_str().unwrap_or(""),
        st["body"].as_str().unwrap_or("").as_bytes(),
        &no_python,
    )
}

/// 要求の比べる形（道と見出しの /rs/ をそろえる）
fn req_view(r: &Value) -> Value {
    json!({"method": r["method"], "path": norm(&r["path"], "/rs/", "/py/"), "headers": norm(&r["headers"], "/rs/", "/py/"), "body": r["body"]})
}

#[test]
fn schedule_matches_python() {
    let base = common::work("schedule-parity");
    let (mut live, oracle) = common::Live::start("schedule_oracle.py", &["serve", base.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut steps, mut delegated, mut file_cmp, mut req_cmp, mut ok_lists) = (0, 0, 0, 0, 0);
    let scenarios = oracle["scenarios"].as_array().unwrap();
    for sc in scenarios {
        let name = sc["name"].as_str().unwrap();
        let (py, rs) = (sc["py"].as_str().unwrap(), sc["rs"].as_str().unwrap());
        let lot = lot_for(&sc["env"]);
        let mut has_delegate = false;
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            let got = call(&lot, st);
            if st["delegate"] == true {
                has_delegate = true;
                delegated += 1;
                if let Some((status, v)) = got {
                    bad.push(format!(
                        "{name} [{i}] 窓が答えた（Python に任せるはず）: {status} {}",
                        v.to_string().chars().take(200).collect::<String>()
                    ));
                }
                continue;
            }
            steps += 1;
            let Some((status, v)) = got else {
                bad.push(format!("{name} [{i}] 窓が答えない: {} {}?{}", st["method"], st["path"], st["query"]));
                continue;
            };
            if status == 200 && st["path"] == "/api/src/sch" {
                ok_lists += 1;
            }
            let (want, got) = (norm(&st["json"], rs, py), norm(&v, rs, py));
            if status as i64 != st["status"].as_i64().unwrap() || common::diff(&want, &got, "").is_some() {
                bad.push(format!(
                    "{name} [{i}] {} {}?{}: Python {} {} / 窓 {status} {}",
                    st["method"].as_str().unwrap(),
                    st["path"].as_str().unwrap(),
                    st["query"].as_str().unwrap(),
                    st["status"],
                    common::diff(&want, &got, "").unwrap_or_default(),
                    got.to_string().chars().take(300).collect::<String>()
                ));
            }
        }
        if has_delegate {
            // 窓は係を降りた（状態の resigned に書いた）。Python が取りに行く
            let any = files(Path::new(rs)).iter().any(|(k, v)| k.ends_with(".state.json") && v["resigned"].is_object());
            if !any {
                bad.push(format!("{name}: 任せた設備の状態に「係を降りた」が無い"));
            }
            continue;
        }
        // 置いた世代と状態のファイル
        let (fp, fr) = (sc["files"].as_object().unwrap(), files(Path::new(rs)));
        let keys = |m: &Map<String, Value>| m.keys().cloned().collect::<Vec<_>>();
        if keys(fp) != keys(&fr) {
            bad.push(format!("{name}: 置いたファイル Python {:?} / 窓 {:?}", keys(fp), keys(&fr)));
        }
        for (k, want) in fp {
            let Some(got) = fr.get(k) else { continue };
            file_cmp += 1;
            let (want, got) = if k.ends_with(".state.json") {
                (norm(&state_view(want), rs, py), norm(&state_view(got), rs, py))
            } else {
                (want.clone(), got.clone())
            };
            if let Some(d) = common::diff(&want, &got, k) {
                bad.push(format!("{name}: ファイル {d}"));
            }
        }
        // CM3 が受けた要求（要求の行・見出しの並びと値・本文）
        let scene = sc["scene"].as_str().unwrap_or("");
        if !scene.is_empty() {
            // HOT の設備は同時に取りに行くので、届く順は決まらない（並べ替えて比べる）
            let sorted = |mut v: Vec<Value>| {
                v.sort_by_key(|x| x.to_string());
                v
            };
            let wr =
                sorted(live.ask(&format!("requests rs {scene}")).as_array().cloned().unwrap_or_default().iter().map(req_view).collect());
            let pr = sorted(sc["requests"].as_array().unwrap().iter().map(req_view).collect());
            req_cmp += pr.len();
            if wr != pr {
                let at = pr.iter().zip(&wr).position(|(a, b)| a != b);
                bad.push(format!(
                    "{name}: CM3 への要求 Python {} 本 / 窓 {} 本。最初の違い {:?}: {} / {}",
                    pr.len(),
                    wr.len(),
                    at,
                    at.map(|i| pr[i].to_string()).unwrap_or_default(),
                    at.map(|i| wr[i].to_string()).unwrap_or_default()
                ));
            }
        }
    }
    eprintln!("答えた歩 {steps}・任せた歩 {delegated}・比べたファイル {file_cmp}・比べた要求 {req_cmp}・答えた一覧 {ok_lists}");
    assert!(steps >= 80 && delegated >= 5 && file_cmp >= 40 && req_cmp >= 40 && ok_lists >= 20, "歩が少ない");

    // 錠を待つ問い合わせは、先に済んだ結果を使う（黙る CM3〈timeout 1 秒〉に同じ設備を 4 本同時。前は 1・2・3・4 秒と積み重なった）
    let silent = scenarios.iter().find(|s| s["scene"] == "silent").unwrap();
    let lot = Arc::new(lot_for(&silent["env"]));
    let before = live.ask("count rs silent").as_i64().unwrap();
    let t0 = std::time::Instant::now();
    let hs: Vec<_> = (0..4)
        .map(|_| {
            let lot = lot.clone();
            std::thread::spawn(move || {
                lot.handle_body("GET", "/api/src/sch", "equip=L-2", b"", &no_python).map(|(s, v)| (s, v["error"].clone()))
            })
        })
        .collect();
    let answers: Vec<_> = hs.into_iter().map(|h| h.join().unwrap()).collect();
    let took = t0.elapsed().as_secs_f64();
    let n = live.ask("count rs silent").as_i64().unwrap() - before;
    let want = Some((502u16, json!("L-2 の予定を CM3 から取れません: CM3の応答がタイムアウトしました")));
    if answers.iter().any(|a| *a != want) || n != 1 || took > 2.2 {
        bad.push(format!("同時に 4 本: 答え {answers:?}・CM3 への要求 {n} 本・{took:.2} 秒（1 本・2.2 秒未満のはず）"));
    }

    // 2 つのプロセス（窓と受け身の Python）: 再現した順で取り直しても、相手の今の世代が消えない・Python は世代を置かない・CM3 へ 1 回ずつ
    let change = scenarios.iter().find(|s| s["scene"] == "change").unwrap();
    for (k, order) in ["rrprrp", "prrrpp"].iter().enumerate() {
        let e = &change["env"];
        let root = base.join(format!("two{k}"));
        let local = root.join("local");
        std::fs::create_dir_all(&local).unwrap();
        std::fs::copy(Path::new(e["local"].as_str().unwrap()).join("instance_id"), local.join("instance_id")).unwrap();
        let runner = format!("t{k}");
        let text = std::fs::read_to_string(e["config"].as_str().unwrap()).unwrap().replace("/rs/change", &format!("/{runner}/change"));
        let cfg_path = root.join("config.json");
        std::fs::write(&cfg_path, &text).unwrap();
        let env = json!({"base": e["base"], "program": e["program"], "local": local, "config": cfg_path});
        let lot = lot_for(&env);
        let url = serde_json::from_str::<Value>(&text).unwrap()["schedule"]["cm3_base_url"].as_str().unwrap().to_string();
        let sroot = local.join("db_cache").join("schedule");
        let (mut py, _) = common::Live::start("schedule_oracle.py", &["passive", sroot.to_str().unwrap(), &url]);
        let mut seen = 0;
        for (i, c) in order.chars().enumerate() {
            if c == 'r' {
                let got = lot.handle_body("POST", "/api/src/sch/refresh", "equip=L-1", b"", &no_python);
                if got.as_ref().map(|x| x.0) != Some(200) {
                    bad.push(format!("2 つのプロセス {order} [{i}] 窓の取り直し {got:?}"));
                }
            } else {
                py.send("p");
                loop {
                    let v = py.read();
                    if v["event"] == "schedule" {
                        lot.notice(&v);
                    } else {
                        if v["result"]["error"].as_str().is_some_and(|s| !s.is_empty()) {
                            bad.push(format!("2 つのプロセス {order} [{i}] Python {v}"));
                        }
                        break;
                    }
                }
            }
            let st: Value =
                serde_json::from_slice(&std::fs::read(sroot.join(format!("{}.state.json", da_core::schedule::safe("L-1")))).unwrap())
                    .unwrap();
            let cur = PathBuf::from(st["path"].as_str().unwrap_or(""));
            let py_files: Vec<String> = std::fs::read_dir(&sroot)
                .unwrap()
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.contains(".py."))
                .collect();
            let n = live.ask(&format!("count {runner} change")).as_i64().unwrap();
            if !cur.exists() || !py_files.is_empty() || n != i as i64 + 1 || st["writer"] != "rs" {
                bad.push(format!(
                    "2 つのプロセス {order} [{i}]: 今の世代 {} ある {}・Python の世代 {py_files:?}・CM3 への要求 {n}（{} のはず）・書き手 {}",
                    cur.display(),
                    cur.exists(),
                    i + 1,
                    st["writer"]
                ));
            }
            seen += 1;
        }
        assert_eq!(seen, 6);
    }
    // 降りる → Python が取る → 窓が戻る（版 3.96.0 の作った後の採点の割れ 1・2）
    back_after_resign(&base, change, &mut live, &mut bad);
    drop(live);
    unsafe { std::env::remove_var("TRANSFER_APP_CONFIG") };
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 字の読み: CP932・Shift_JIS・CP1252 の 1・2 バイトの全部、UTF-8 の strict と置き換え、charset の名前の引き方と見出しの読み
#[test]
fn codecs_match_python() {
    let v = common::python_json("schedule_oracle.py", &["codecs"]);
    let mut bad = vec![];
    let mut n = 0;
    for enc in ["cp932", "shift_jis", "cp1252"] {
        for (b, want) in v[enc]["one"].as_array().unwrap().iter().enumerate() {
            n += 1;
            let got = da_core::cm3::decode(&[b as u8], enc).unwrap();
            if got.as_deref() != want.as_str() {
                bad.push(format!("{enc} {b:02X}: Python {want} / 窓 {got:?}"));
            }
        }
        for (lead, row) in v[enc]["two"].as_object().unwrap() {
            let l = u8::from_str_radix(lead, 16).unwrap();
            for (t, want) in row.as_array().unwrap().iter().enumerate() {
                n += 1;
                let got = da_core::cm3::decode(&[l, t as u8], enc).unwrap();
                if got.as_deref() != want.as_str() {
                    bad.push(format!("{enc} {lead}{t:02X}: Python {want} / 窓 {got:?}"));
                }
            }
        }
    }
    for x in v["utf8"].as_array().unwrap() {
        n += 1;
        let b: Vec<u8> = (0..x[0].as_str().unwrap().len() / 2)
            .map(|i| u8::from_str_radix(&x[0].as_str().unwrap()[i * 2..i * 2 + 2], 16).unwrap())
            .collect();
        let strict = da_core::cm3::decode(&b, "utf-8").unwrap();
        if strict.as_deref() != x[1].as_str() || String::from_utf8_lossy(&b) != x[2].as_str().unwrap() {
            bad.push(format!("utf-8 {}: Python {} {} / 窓 {strict:?} {}", x[0], x[1], x[2], String::from_utf8_lossy(&b)));
        }
    }
    for (name, want) in v["lookup"].as_object().unwrap() {
        n += 1;
        if da_core::cm3::codec_of(name) != want.as_str() {
            bad.push(format!("lookup {name}: Python {want} / 窓 {:?}", da_core::cm3::codec_of(name)));
        }
    }
    for (ct, want) in v["charset"].as_object().unwrap() {
        n += 1;
        if da_core::cm3::charset_of(ct).as_deref() != want.as_str() {
            bad.push(format!("charset {ct}: Python {want} / 窓 {:?}", da_core::cm3::charset_of(ct)));
        }
    }
    eprintln!("比べた読み {n}");
    assert!(n > 65_000, "比べた読みが少ない: {n}");
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.iter().take(40).cloned().collect::<Vec<_>>().join("\n"));
}

/// 1 つの場面の置き場（change の場面の設定を、走る係の名前〈runner〉と作り物の CM3 の場面〈scene〉だけ替えて写す）
fn own_root(base: &Path, change: &Value, runner: &str, scene: &str) -> (PathBuf, Value, String) {
    let e = &change["env"];
    let root = base.join(runner);
    let local = root.join("local");
    std::fs::create_dir_all(&local).unwrap();
    std::fs::copy(Path::new(e["local"].as_str().unwrap()).join("instance_id"), local.join("instance_id")).unwrap();
    let text = std::fs::read_to_string(e["config"].as_str().unwrap()).unwrap().replace("/rs/change", &format!("/{runner}/{scene}"));
    let cfg_path = root.join("config.json");
    std::fs::write(&cfg_path, &text).unwrap();
    (root, json!({"base": e["base"], "program": e["program"], "local": local, "config": cfg_path}), text)
}

/// 設定の schedule の段に項目を足して書き直す（窓は配った設定の変わりを見て束を組み直す）
fn set_schedule(env: &Value, text: &str, more: &Value) {
    let mut v: Value = serde_json::from_str(text).unwrap();
    for (k, x) in more.as_object().unwrap() {
        v["schedule"][k] = x.clone();
    }
    std::fs::write(env["config"].as_str().unwrap(), serde_json::to_string_pretty(&v).unwrap()).unwrap();
}

/// 窓が係を降りた後に受け身の Python が取り、窓が係に戻る 2 つの形（2 回目だけ NaN の答えで 1 回だけ降りる・システムのプロキシの設定で降りて戻す）。
/// 戻った窓の一覧・データの札（/source）が状態のファイル〈Python がいちばん新しく取った答え。カードもここを読む〉と同じで、CM3 へ取り直さない
/// （Python だけの形でも、取ったばかりの答えを使う）。戻った窓が 2 回置き直すと、Python の世代は残らず、置き場は今の世代と 1 つ前の 2 つ
/// （Python だけの形と同じ）。1 回目の置き直しでは、Python の今の世代は「1 つ前」として残る（読んでいる途中の問い合わせが開ける）
fn back_after_resign(base: &Path, change: &Value, live: &mut common::Live, bad: &mut Vec<String>) {
    let code = "L-1";
    let mut steps = 0;
    for (runner, scene, how) in [("f0", "flip", "nan"), ("f1", "change", "proxy")] {
        let (_root, env, text) = own_root(base, change, runner, scene);
        let lot = lot_for(&env);
        let url = serde_json::from_str::<Value>(&text).unwrap()["schedule"]["cm3_base_url"].as_str().unwrap().to_string();
        let sroot = PathBuf::from(env["local"].as_str().unwrap()).join("db_cache").join("schedule");
        let extra = if how == "proxy" { json!({"use_system_proxy": true}) } else { json!({}) };
        let (mut py, _) = common::Live::start("schedule_oracle.py", &["passive", sroot.to_str().unwrap(), &url, &extra.to_string()]);
        let tag = |i: usize| format!("降りて戻る（{how}）[{i}]");
        let count = |live: &mut common::Live| live.ask(&format!("count {runner} {scene}")).as_i64().unwrap();
        let state = || -> Value {
            serde_json::from_slice(&std::fs::read(sroot.join(format!("{}.state.json", da_core::schedule::safe(code)))).unwrap()).unwrap()
        };
        let gens = || -> Vec<String> {
            let head = format!("{}.g", da_core::schedule::safe(code));
            let mut v: Vec<String> = std::fs::read_dir(&sroot)
                .unwrap()
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.starts_with(&head) && n.ends_with(".sqlite3"))
                .collect();
            v.sort();
            v
        };
        let get = |path: &str, method: &str| lot.handle_body(method, path, "equip=L-1", b"", &no_python);
        // 0: 窓が係（1 回目の答え）
        let list0 = get("/api/src/sch", "GET");
        let first = get("/api/src/sch/source", "GET");
        if list0.as_ref().map(|x| x.0) != Some(200) || first.as_ref().map(|x| x.0) != Some(200) {
            bad.push(format!("{} 窓の最初の答え {first:?}", tag(0)));
        }
        // 1: 窓が降りる（NaN の答え・窓の取れない設定）
        let down = if how == "nan" {
            get("/api/src/sch/refresh", "POST")
        } else {
            set_schedule(&env, &text, &json!({"use_system_proxy": true}));
            lot.invalidate();
            get("/api/src/sch", "GET")
        };
        let st = state();
        if down.is_some() || !st["resigned"].is_object() {
            bad.push(format!("{} 窓が降りない: {down:?}・状態の resigned {}", tag(1), st["resigned"]));
        }
        // 2: 受け身の Python が取って置く（書き手 py）
        py.send("p");
        let v = loop {
            let v = py.read();
            if v["event"] == "schedule" {
                lot.notice(&v);
            } else {
                break v;
            }
        };
        let st = state();
        let py_path = st["path"].as_str().unwrap_or("").to_string();
        if v["result"]["error"].as_str().is_some_and(|s| !s.is_empty()) || st["writer"] != "py" || !py_path.contains(".py.") {
            bad.push(format!("{} Python が取らない: {v}・書き手 {}・世代 {py_path}", tag(2), st["writer"]));
        }
        let n_py = count(live);
        // 3: 窓が戻る。すぐ答える一覧・データの札は、状態のファイル（Python の今の答え）と同じ。CM3 へは取り直さない
        if how == "proxy" {
            set_schedule(&env, &text, &json!({}));
            lot.invalidate();
        }
        let want_src = {
            let sec: Value = serde_json::from_str(&std::fs::read_to_string(env["config"].as_str().unwrap()).unwrap()).unwrap();
            let cfg = da_core::schedule::Cfg::from_section(Some(&sec["schedule"])).unwrap();
            da_core::schedule::source_info(&cfg, &da_core::schedule::st_of(&state()), code)
        };
        let src = get("/api/src/sch/source", "GET");
        let list = get("/api/src/sch", "GET");
        let rows_in = |p: &str| -> i64 {
            let c = rusqlite::Connection::open(p).unwrap();
            c.query_row(&format!("SELECT COUNT(*) FROM \"{}\"", da_core::schedule::TABLE), [], |r| r.get(0)).unwrap()
        };
        let total = list.as_ref().and_then(|x| x.1["count"].as_i64());
        if src.as_ref().map(|x| x.0) != Some(200)
            || common::diff(&norm(&want_src, "", ""), &norm(&src.as_ref().unwrap().1, "", ""), "").is_some()
            || total != Some(rows_in(&py_path))
            || src == first
        {
            bad.push(format!(
                "{} 戻った窓の答えが状態のファイルと違う: データの札 {:?}・一覧の行 {total:?} / Python の世代 {}",
                tag(3),
                src.as_ref().map(|x| common::diff(&norm(&want_src, "", ""), &norm(&x.1, "", ""), "")),
                rows_in(&py_path)
            ));
        }
        if count(live) != n_py {
            bad.push(format!("{} 戻った窓が取り直した（{} 本 → {} 本）", tag(3), n_py, count(live)));
        }
        // 4・5: 窓が 2 回置き直す。1 回目は Python の今の世代を 1 つ前として残し、2 回目で Python の世代は残らない
        for i in [4, 5] {
            let got = get("/api/src/sch/refresh", "POST");
            let st = state();
            let g = gens();
            let py_left: Vec<&String> = g.iter().filter(|n| n.contains(".py.")).collect();
            let want_py: Vec<String> =
                if i == 4 { vec![Path::new(&py_path).file_name().unwrap().to_string_lossy().into_owned()] } else { vec![] };
            if got.as_ref().map(|x| x.0) != Some(200)
                || st["writer"] != "rs"
                || py_left.iter().map(|s| s.to_string()).collect::<Vec<_>>() != want_py
                || g.len() != 2
                || !Path::new(st["path"].as_str().unwrap_or("")).exists()
            {
                bad.push(format!(
                    "{} 窓の置き直し {:?}・書き手 {}・置き場 {g:?}（Python の世代は {want_py:?}、全部で 2 つのはず）",
                    tag(i),
                    got.map(|x| x.0),
                    st["writer"]
                ));
            }
        }
        steps += 6;
        drop(py);
    }
    eprintln!("降りて戻る: 2 形・{steps} 歩");
}
