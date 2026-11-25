//! スケジュール（CM3。src/schedule.rs・cm3.rs・cm3_http.rs）が Python の道（前の版の schedule・前の版の schedule・前の版の cm3_schedule）と
//! 同じ答えか（版 3.96.0）。前の版の答え合わせ役 schedule serve が作り物の CM3（tests/schedule_fixture.Cm3Server）を起こし、場面ごとに
//! Python の道（窓の無い形＝Python が係）の答え・置いた世代と状態のファイル・CM3 が受けた要求を書く。ここでは同じ作り物の CM3 に
//! 本物の窓の道（Lot::handle_body。設定は窓の束の材料）で同じ並びを当て、1 歩ごとの答え（状態・本文。断る言葉も 1 字まで）・
//! 世代の表（列・行・値の型）と状態のファイル（seq・error・整えた答え。時刻と指紋は伏せる）・CM3 への要求（要求の行・見出しの並びと値・本文）を
//! 突き合わせる。窓が答えない（製品では 503）歩（delegate）は、窓が答えず、状態に「係を降りた」と書いたことを見る。
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
                    // 取った係（版 3.117.1。窓は rs・Python は py。同じ場面の答えは係のほかは同じ）
                    let x = if TIMES.contains(&k.as_str()) && !x.is_null() {
                        json!("<t>")
                    } else if k == "engine" && (x == "rs" || x == "py") {
                        json!("w")
                    } else {
                        norm(x, rs, py)
                    };
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
    lot.handle_body_with(
        st["method"].as_str().unwrap(),
        st["path"].as_str().unwrap(),
        st["query"].as_str().unwrap_or(""),
        st["body"].as_str().unwrap_or("").as_bytes(),
        &no_python,
    )
}

/// 要求の設備（本文の setsubiName。GET の 30x の後は道の eq=）
fn equip_of_req(r: &Value) -> String {
    let b: Value = serde_json::from_str(r["body"].as_str().unwrap_or("null")).unwrap_or(Value::Null);
    match b["setsubiName"].as_str() {
        Some(s) => s.to_string(),
        None => r["path"].as_str().unwrap_or("").split("eq=").nth(1).unwrap_or("").split('&').next().unwrap_or("").to_string(),
    }
}

/// 要求の比べる形（道と見出しの /rs/ をそろえる）
fn req_view(r: &Value) -> Value {
    json!({"method": r["method"], "path": norm(&r["path"], "/rs/", "/py/"), "headers": norm(&r["headers"], "/rs/", "/py/"), "body": r["body"]})
}

#[test]
fn schedule_matches_python() {
    let base = common::work("schedule-parity");
    // 版 3.117.1: 窓の答えを焼いた表（tests/baked/schedule.json）に持つ。Python 無しの形（TPA_NO_PYTHON=1）では、場面を表の宣言から作り、
    // 作り物（CM3・https・プロキシ）は app を import しない台本（program/tests/fakes_serve.py schedule）を起こしたままにして、焼いた答えと比べる
    let mut bk = common::bake::Bake::open("schedule", &base);
    bk.pack = true;
    // 表の問い合わせに Python の答えを持たない（歩の状態と本文・置いたファイル・CM3 とプロキシが受けた要求。窓の答えは answers に持つ）
    bk.strip = ["status", "json", "files", "requests", "proxylog"].iter().map(|s| s.to_string()).collect();
    bk.strip_in = vec!["method", "name"];
    // Python 無しの形の作り物の仕掛の SQLite（届く場面の予定の元。台本が lotlist_fixture で作る。答え合わせ役は場面の LOTNOW.sqlite3 を使う）
    let fake_wip = base.join("fakes").join("wip.sqlite3");
    bk.fakes = Some(("fakes_serve.py", vec!["schedule".to_string(), fake_wip.to_string_lossy().into_owned()]));
    bk.exclude.push("fakes");
    // 答え合わせ役の答えの上の段の作り物のポート（流すたびに変わる。URL は名前つきの @URL で持つ）
    bk.drop.push("port");
    let (live, oracle) = bk.live_table();
    let mut live = live.expect("作り物の CM3 を起こしたままにする相手");
    common::trust_test_ca();
    // 走る係ごとの中継のプロキシ（答えと状態の via.proxy の名前:番号）は Python の側の物にそろえる
    let hp = |k: &str| oracle["urls"][k].as_str().unwrap_or("").trim_start_matches("http://").to_string();
    let urls_now: Value = bk.ctx.urls.iter().map(|(n, u)| (n.clone(), json!(u))).collect::<Map<String, Value>>().into();
    let hp_now = |k: &str| urls_now[k].as_str().unwrap_or("").trim_start_matches("http://").to_string();
    let (relay_rs, relay_py) = (hp_now("relay_rs"), if bk.python() { hp("relay_py") } else { hp_now("relay_py") });
    let relay = |v: &Value| -> Value {
        if relay_rs.is_empty() {
            return v.clone();
        }
        serde_json::from_str(&v.to_string().replace(&relay_rs, &relay_py)).unwrap()
    };
    let mut bad = vec![];
    let (mut steps, mut delegated, mut file_cmp, mut req_cmp, mut ok_lists) = (0, 0, 0, 0, 0);
    let scenarios = oracle["scenarios"].as_array().unwrap();
    for sc in scenarios {
        let name = sc["name"].as_str().unwrap();
        let (py, rs) = (sc["py"].as_str().unwrap(), sc["rs"].as_str().unwrap());
        let lot = lot_for(&sc["env"]);
        let _env = common::ProxyEnv::set(&sc["proxyEnv"]);
        let mut has_delegate = false;
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            let got = call(&lot, st);
            if st["delegate"] == true {
                has_delegate = true;
                delegated += 1;
                if let Some((status, v)) = got {
                    bad.push(format!(
                        "{name} [{i}] 窓が答えた（答えない（製品では 503）はず）: {status} {}",
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
            let key = format!("{name} #{i}");
            let w = bk.want_step(&key, st);
            let (want, got) = (norm(&w.1, rs, py), norm(&relay(&v), rs, py));
            bk.note_step(&key, st, status, &got, &(w.0, want.clone()));
            let (want, got) = (bk.s(&want), bk.s(&got));
            if status as i64 != w.0 || common::diff(&want, &got, "").is_some() {
                bad.push(format!(
                    "{name} [{i}] {} {}?{}: Python {} {} / 窓 {status} {}",
                    st["method"].as_str().unwrap(),
                    st["path"].as_str().unwrap(),
                    st["query"].as_str().unwrap(),
                    w.0,
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
        // 置いた世代と状態のファイル（状態は書き手と道の頭を伏せ、時刻を伏せた形で焼く）
        let view = |m: &Map<String, Value>| -> Value {
            Value::Object(
                m.iter()
                    .map(|(k, v)| (k.clone(), if k.ends_with(".state.json") { norm(&state_view(v), rs, py) } else { v.clone() }))
                    .collect(),
            )
        };
        let fkey = format!("{name} ファイル");
        let fp = bk.want(&fkey, || view(sc["files"].as_object().unwrap()));
        let fr = view(relay(&Value::Object(files(Path::new(rs)))).as_object().unwrap());
        bk.note_files(&fkey, &fr, &fp);
        let (fp, fr) = (bk.s(&fp).as_object().cloned().unwrap_or_default(), bk.s(&fr).as_object().cloned().unwrap_or_default());
        let keys = |m: &Map<String, Value>| m.keys().cloned().collect::<Vec<_>>();
        if keys(&fp) != keys(&fr) {
            bad.push(format!("{name}: 置いたファイル Python {:?} / 窓 {:?}", keys(&fp), keys(&fr)));
        }
        for (k, want) in &fp {
            let Some(got) = fr.get(k) else { continue };
            file_cmp += 1;
            if let Some(d) = common::diff(want, got, k) {
                bad.push(format!("{name}: ファイル {d}"));
            }
        }
        // 作り物のプロキシ（中継）が受けた要求の行と見出し（版 3.117.1: 利用者:合言葉 を送らない・URL の全体・CONNECT の行）
        let plv = |v: &Value| -> Value {
            let mut out: Vec<Value> = v.as_array().into_iter().flatten().map(|x| norm(&relay(x), "/rs/", "/py/")).collect();
            out.sort_by_key(|x| x.to_string());
            Value::Array(out)
        };
        let pkey = format!("{name} プロキシが受けた要求");
        let pw = bk.want(&pkey, || plv(&sc["proxylog"]));
        let pg = plv(&live.ask("proxylog relay_rs"));
        bk.note_files(&pkey, &pg, &pw);
        if bk.s(&pg) != bk.s(&pw) {
            bad.push(format!("{name}: プロキシが受けた要求 Python {pw} / 窓 {pg}"));
        }
        // CM3 が受けた要求（要求の行・見出しの並びと値・本文）
        let scene = sc["scene"].as_str().unwrap_or("");
        if !scene.is_empty() {
            // HOT の設備は同時に取りに行くので、設備をまたぐ順は決まらない。設備ごとの並びは決まる（版 3.117.1 の K5: 前は全部を並べ替えて比べ、
            // 設備の中の順の違いを見なかった）。設備（本文の setsubiName か道の eq）で分け、設備の名前の順に並べて比べる
            let sorted = |v: Vec<Value>| {
                let mut v: Vec<(String, usize, Value)> = v.into_iter().enumerate().map(|(i, x)| (equip_of_req(&x), i, x)).collect();
                v.sort_by(|a, b| (&a.0, a.1).cmp(&(&b.0, b.1)));
                Value::Array(v.into_iter().map(|x| x.2).collect::<Vec<_>>())
            };
            let rkey = format!("{name} CM3 への要求");
            let pr = bk.want(&rkey, || sorted(sc["requests"].as_array().unwrap().iter().map(req_view).collect()));
            let wr =
                sorted(live.ask(&format!("requests rs {scene}")).as_array().cloned().unwrap_or_default().iter().map(req_view).collect());
            bk.note_files(&rkey, &wr, &pr);
            let (pr, wr) = (bk.s(&pr).as_array().cloned().unwrap_or_default(), bk.s(&wr).as_array().cloned().unwrap_or_default());
            req_cmp += pr.len();
            if wr != pr {
                let at = pr.iter().zip(&wr).position(|(a, b)| a != b);
                let names = |v: &[Value]| -> Vec<String> {
                    v.iter()
                        .map(|x| {
                            let b: Value = serde_json::from_str(x["body"].as_str().unwrap_or("null")).unwrap_or(Value::Null);
                            format!("{}{}", b["setsubiName"].as_str().unwrap_or("?"), b["termKbn"].as_str().unwrap_or(""))
                        })
                        .collect()
                };
                bad.push(format!(
                    "{name}: CM3 への要求 Python {} 本 {:?} / 窓 {} 本 {:?}。最初の違い {:?}: {} / {}",
                    pr.len(),
                    names(&pr),
                    wr.len(),
                    names(&wr),
                    at,
                    at.map(|i| pr[i].to_string()).unwrap_or_default(),
                    at.map(|i| wr[i].to_string()).unwrap_or_default()
                ));
            }
        }
    }
    eprintln!("答えた歩 {steps}・任せた歩 {delegated}・比べたファイル {file_cmp}・比べた要求 {req_cmp}・答えた一覧 {ok_lists}");
    // 版 3.105.0: 任せた歩の下限は置かない（任せる歩は 0 へ減らしていく数で、減らすたびに落ちる。任せるはずの歩を窓が答えないことは歩ごとの確かめが、上限は予算〈common::check_budget〉が見る）
    assert!(steps >= 80 && file_cmp >= 40 && req_cmp >= 40 && ok_lists >= 20, "歩が少ない");

    // 錠を待つ問い合わせは、先に済んだ結果を使う（黙る CM3〈timeout 1 秒〉に同じ設備を 4 本同時。前は 1・2・3・4 秒と積み重なった）
    let silent = scenarios.iter().find(|s| s["scene"] == "silent").unwrap();
    let lot = Arc::new(lot_for(&silent["env"]));
    let before = live.ask("count rs silent").as_i64().unwrap();
    let t0 = std::time::Instant::now();
    let hs: Vec<_> = (0..4)
        .map(|_| {
            let lot = lot.clone();
            std::thread::spawn(move || {
                lot.handle_body_with("GET", "/api/src/sch", "equip=L-2", b"", &no_python).map(|(s, v)| (s, v["error"].clone()))
            })
        })
        .collect();
    let answers: Vec<_> = hs.into_iter().map(|h| h.join().unwrap()).collect();
    let took = t0.elapsed().as_secs_f64();
    let n = live.ask("count rs silent").as_i64().unwrap() - before;
    let want = Some((
        502u16,
        json!(format!("L-2 の予定を予定の元から取れません: 予定の元の応答がタイムアウトしました{}", da_core::cm3_net::HINT)),
    ));
    if answers.iter().any(|a| *a != want) || n != 1 || took > 2.2 {
        bad.push(format!("同時に 4 本: 答え {answers:?}・CM3 への要求 {n} 本・{took:.2} 秒（1 本・2.2 秒未満のはず）"));
    }

    // 段 ④（版 3.118.0）: 降りない（前の「降りる → Python が取る → 窓が戻る」。Python を使わないので、Python 無しの形でも流す）
    let change = scenarios.iter().find(|s| s["scene"] == "change").unwrap();
    no_resign(&base, change, &mut live, &mut bad);
    drop(live);
    unsafe { std::env::remove_var("TRANSFER_APP_CONFIG") };
    bk.finish(&bad);
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
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

/// 段 ④（版 3.118.0）: 窓は係を降りない 2 つの形（2 回目だけ i64 に入らない整数の答え・戻り道の設定〈fetch_engine が python〉）。
/// 前（版 3.117.x）は降りて受け身の Python が取り、窓が戻った。いまは i64 に入らない整数は理由つきで断り（前の答えを残し、データの札に理由）、
/// fetch_engine の python は見ずに窓が取る。状態の resigned はいつも null・書き手は rs・Python の世代（.py.）は置かれない
fn no_resign(base: &Path, change: &Value, live: &mut common::Live, bad: &mut Vec<String>) {
    let code = "L-1";
    let mut steps = 0;
    for (runner, scene, how) in [("f0", "flip", "big"), ("f1", "change", "engine")] {
        let (_root, env, text) = own_root(base, change, runner, scene);
        let lot = lot_for(&env);
        let sroot = PathBuf::from(env["local"].as_str().unwrap()).join("db_cache").join("schedule");
        let tag = |i: usize| format!("降りない（{how}）[{i}]");
        let count = |live: &mut common::Live| live.ask(&format!("count {runner} {scene}")).as_i64().unwrap();
        let state = || -> Value {
            serde_json::from_slice(&std::fs::read(sroot.join(format!("{}.state.json", da_core::schedule::safe(code)))).unwrap()).unwrap()
        };
        let get = |path: &str, method: &str| lot.handle_body_with(method, path, "equip=L-1", b"", &no_python);
        // 0: 窓が係（1 回目の答え）
        let list0 = get("/api/src/sch", "GET");
        let first = get("/api/src/sch/source", "GET");
        if list0.as_ref().map(|x| x.0) != Some(200) || first.as_ref().map(|x| x.0) != Some(200) {
            bad.push(format!("{} 窓の最初の答え {first:?}", tag(0)));
        }
        let n0 = count(live);
        // 1: 前は降りた形（i64 に入らない整数の答え・窓の取れない設定）。窓が答え、降りない
        let got = if how == "big" {
            get("/api/src/sch/refresh", "POST")
        } else {
            set_schedule(&env, &text, &json!({"fetch_engine": "python"}));
            lot.invalidate();
            get("/api/src/sch/refresh", "POST")
        };
        let st = state();
        if got.as_ref().map(|x| x.0) != Some(200) || !st["resigned"].is_null() || st["writer"] != "rs" || count(live) != n0 + 1 {
            bad.push(format!(
                "{} 窓が答えて降りない: {got:?}・resigned {}・書き手 {}・要求 {} → {}",
                tag(1),
                st["resigned"],
                st["writer"],
                n0,
                count(live)
            ));
        }
        let src = get("/api/src/sch/source", "GET");
        let err = src.as_ref().map(|x| x.1["reason"].as_str().unwrap_or("").to_string()).unwrap_or_default();
        let want_err = if how == "big" { da_core::schedule::BIG_OR_DEEP } else { "" };
        if src.as_ref().map(|x| x.0) != Some(200) || !err.contains(want_err) || (how == "big") == err.is_empty() {
            bad.push(format!("{} データの札の理由: {err:?}（{want_err:?} のはず）", tag(2)));
        }
        let py_gens: Vec<String> = std::fs::read_dir(&sroot)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".py."))
            .collect();
        if !py_gens.is_empty() {
            bad.push(format!("{} Python の世代がある: {py_gens:?}", tag(3)));
        }
        steps += 4;
    }
    eprintln!("降りない: 2 形・{steps} 歩");
}
