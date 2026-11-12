//! 組む所の読み 7 本（src/builder.rs）が Python の道（routes/dashboard.py の dashboard_fields・data_columns、routes/sources.py の
//! sources_columns・sources_check・sources_join_preview・sources_conn_check）と同じ答えか（版 3.99.0）。
//! program/tests/builder_oracle.py を起こしたままにし、場面ごとに同じ中身のフォルダの py に Python の道で当てた答えを受け取る。
//! ここでは rs に同じ並びを本物の窓の道（Lot::handle_body → builder_route。材料は窓の束の材料・門番）で当て、1 歩ごとの答え
//! （状態・本文。確かめるの ms・更新時刻の小数・SQLite の英語の字だけ伏せる）を突き合わせる。窓が答えず Python に任せる歩（delegates）は、
//! 窓が答えないことを見る。Python に頼らない独立の答え（tools/builder-truth.py。"truth"）とも窓の答えを比べる（Python と窓が同じ誤りを
//! 持っていても見つかる）。決め（services/builder.py と src/builder.rs の定数）も突き合わせる。
//! 最後に、窓と Python が同じ作業場所で同時に「試す」（作業実績 14 台の try-work-<キー>）を組んでも、答えが同じで、答えのファイルが壊れないかを見る。

mod common;

use da_core::bundle::{Builder, Env};
use da_core::lot::Lot;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// 伏せる: 確かめるの ms・SQLite の誤りの字（Python の sqlite3 と rusqlite で英語の字が違いうる。疑い 4: 答えは変えない）・更新時刻の小数・
/// 写しの係が元を見に行った時刻（checkedAt。見に行った瞬間で違う）
fn norm(v: &Value) -> Value {
    match v {
        Value::String(s) => {
            let re = regex::Regex::new(r"・\d+ ms").unwrap();
            let s = re.replace_all(s, "・<ms> ms").to_string();
            let re = regex::Regex::new(r"SQLite のファイルとして開けません（.*?）。").unwrap();
            json!(re.replace_all(&s, "SQLite のファイルとして開けません（<e>）。"))
        }
        Value::Object(o) => Value::Object(
            o.iter().filter(|(k, _)| !["mtime", "checkedAt"].contains(&k.as_str())).map(|(k, x)| (k.clone(), norm(x))).collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        _ => v.clone(),
    }
}

fn lot_of(e: &Value) -> Lot {
    let p = |k: &str| PathBuf::from(e[k].as_str().unwrap());
    let lot = Lot::new(p("local").join("db_cache"));
    lot.set_bundle(Builder::new(Env { base: p("base"), program: p("program"), local: p("local"), config: p("config"), now: None }));
    lot
}

fn call(lot: &Lot, st: &Value) -> Option<(u16, Value)> {
    let ask = || -> Result<Value, String> { Err("Python は居ない".into()) };
    lot.handle_body(
        st["method"].as_str().unwrap(),
        st["path"].as_str().unwrap(),
        st["query"].as_str().unwrap_or(""),
        st["body"].as_str().unwrap_or("").as_bytes(),
        &ask,
    )
}

/// 窓の答えの札 → {列: (kinds, many, numeric, blankOnly)}・元の列の並び
fn fields_of(v: &Value) -> (Vec<String>, std::collections::HashMap<String, Value>) {
    let mut order = vec![];
    let mut m = std::collections::HashMap::new();
    for f in v["fields"].as_array().into_iter().flatten() {
        let c = f["column"].as_str().unwrap().to_string();
        if f.get("calc") != Some(&json!(true)) {
            order.push(c.clone());
        }
        m.insert(
            c,
            json!({"kinds": f["kinds"], "many": f["many"], "numeric": f["numeric"], "blankOnly": f.get("blankOnly") == Some(&json!(true))}),
        );
    }
    (order, m)
}

#[test]
fn builder_reads_match_python_and_the_truth() {
    let base = common::work("builder");
    let (mut live, o) = common::Live::start("builder_oracle.py", &[base.to_str().unwrap()]);
    let mut bad = vec![];
    // 決め（主のセッションの決め 1〜7）が Python と窓で同じ値
    if o["decisions"] != da_core::builder::decisions() {
        bad.push(format!("決め: Python {} / 窓 {}", o["decisions"], da_core::builder::decisions()));
    }
    let (mut steps, mut delegated) = (0, 0);
    let mut first: Vec<(String, Value)> = vec![];
    for sc in o["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        // SAFETY: この試験の糸だけが環境を変える
        unsafe { std::env::set_var("TRANSFER_APP_CONFIG", sc["env"]["config"].as_str().unwrap()) };
        let lot = lot_of(&sc["env"]);
        let esc = |k: &str| {
            let t = serde_json::to_string(sc[k].as_str().unwrap()).unwrap();
            t[1..t.len() - 1].to_string()
        };
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            steps += 1;
            let Some((status, got)) = call(&lot, st) else {
                bad.push(format!("{name} [{i}] 窓が答えない: {} {}?{} {}", st["method"], st["path"], st["query"], st["body"]));
                continue;
            };
            let got: Value = serde_json::from_str(&got.to_string().replace(&esc("rs"), &esc("py"))).unwrap();
            let want = &st["json"];
            if status as i64 != st["status"].as_i64().unwrap() || common::diff(&norm(want), &norm(&got), "").is_some() {
                let d = common::diff(&norm(want), &norm(&got), "").unwrap_or_default();
                bad.push(format!(
                    "{name} [{i}] {} {}?{} {}: Python {} / 窓 {status}: {d}\n  Python {}\n  窓     {}",
                    st["method"].as_str().unwrap(),
                    st["path"].as_str().unwrap(),
                    st["query"].as_str().unwrap(),
                    st["body"],
                    st["status"],
                    norm(want).to_string().chars().take(600).collect::<String>(),
                    norm(&got).to_string().chars().take(600).collect::<String>()
                ));
            }
            if first.is_empty() || name == o["scenarios"][0]["name"] {
                first.push((
                    format!(
                        "{} {}?{} {}",
                        st["method"].as_str().unwrap(),
                        st["path"].as_str().unwrap(),
                        st["query"].as_str().unwrap(),
                        st["body"].as_str().unwrap_or("")
                    ),
                    got,
                ));
            }
        }
        for st in sc["delegates"].as_array().unwrap() {
            delegated += 1;
            if let Some((status, got)) = call(&lot, st) {
                bad.push(format!(
                    "{name}: 窓が答えた（Python に任せるはず） {} {}?{} {}: 窓 {status} {got}",
                    st["method"], st["path"], st["query"], st["body"]
                ));
            }
        }
    }
    // Python に頼らない独立の答え（tools/builder-truth.py）と窓の答え
    let t = &o["truth"];
    let ans = |head: &str| first.iter().find(|(k, _)| k.starts_with(head)).map(|(_, v)| v.clone()).unwrap_or(Value::Null);
    for (head, key) in [
        ("GET /api/dashboard/fields?source=work ", "workFields"),
        ("GET /api/dashboard/fields?source=lot ", "lotFields"),
        ("GET /api/dashboard/fields?source=src%3Awip ", "wipFields"),
    ] {
        let (order, got) = fields_of(&ans(head));
        let want = &t[key];
        if json!(order) != want["order"] {
            bad.push(format!("独立の答え {key} の列の並び: {} / 窓 {}", want["order"], json!(order)));
        }
        for (c, w) in want["fields"].as_object().unwrap() {
            if got.get(c) != Some(w) {
                bad.push(format!("独立の答え {key}.{c}: {w} / 窓 {:?}", got.get(c)));
            }
        }
    }
    let wc = ans("GET /api/sources/work/columns");
    if wc["columns"] != t["workColumns"] || wc["rows"] != t["workRows"] {
        bad.push(format!("独立の答え 作業実績の列と行: {} {} / 窓 {} {}", t["workColumns"], t["workRows"], wc["columns"], wc["rows"]));
    }
    let jp = ans(r#"POST /api/sources/join/preview? {"key": "work""#);
    let st = &jp["stats"][0];
    let tw = &t["workJoin"];
    if json!({"rows": st["rows"], "hit": st["hit"], "miss": st["miss"], "counted": jp["counted"]})
        != json!({"rows": tw["rows"], "hit": tw["hit"], "miss": tw["miss"], "counted": tw["counted"]})
    {
        bad.push(format!("独立の答え 作業実績の試す: {} / 窓 {}", t["workJoin"], st));
    }
    // 1 台（CAL）にだけある鍵の列で「試す」: その設備で数え、ほかの設備は数えず名前と理由を言う（作った後の採点。前は全体が 400）
    let jc = ans(r#"POST /api/sources/join/preview? {"key": "work", "joins": [{"with": "wip", "on": [["CALだけ""#);
    let w = &t["workJoinCal"];
    let st = &jc["stats"][0];
    let joinfail = jc["failed"].as_array().map(|a| a.iter().filter(|f| f["kind"] == "join").count()).unwrap_or(0);
    if json!({"rows": st["rows"], "hit": st["hit"], "counted": jc["counted"]})
        != json!({"rows": w["rows"], "hit": w["hit"], "counted": w["counted"]})
        || joinfail != w["skipped"].as_array().map(|a| a.len()).unwrap_or(99)
    {
        bad.push(format!("独立の答え 1 台だけの鍵の列: {w} / 窓 {jc}"));
    }
    if ans("GET /api/sources/m1/columns")["samples"] != t["m1Samples"] {
        bad.push(format!("独立の答え マスタの見本: {} / 窓 {}", t["m1Samples"], ans("GET /api/sources/m1/columns")["samples"]));
    }
    // 窓と Python が同じ作業場所で同時に「試す」を組む（同じ try-work-<キー> の答えのファイル）
    let sh = &o["shared"];
    unsafe { std::env::set_var("TRANSFER_APP_CONFIG", sh["env"]["config"].as_str().unwrap()) };
    let lot = lot_of(&sh["env"]);
    let st = json!({"method": "POST", "path": "/api/sources/join/preview", "query": "", "body": sh["body"]});
    let warm = call(&lot, &st).expect("窓が答える");
    // 写しは窓が作った（Python は受け身で読む）。答えのファイルは消して、窓と Python が同じ名前を本当に同時に組む形にする
    let joins = Path::new(sh["root"].as_str().unwrap()).join("local/db_cache/joins");
    for e in std::fs::read_dir(&joins).into_iter().flatten().flatten() {
        let _ = std::fs::remove_file(e.path());
    }
    std::thread::scope(|s| {
        let h = s.spawn(|| (0..4).map(|_| call(&lot, &st)).collect::<Vec<_>>());
        let py = live.ask(&json!({"cmd": "join", "root": sh["root"], "body": sh["body"], "n": 4}).to_string());
        let rs = h.join().unwrap();
        for (k, x) in py.as_array().unwrap().iter().enumerate() {
            if x["status"] != 200 || common::diff(&x["json"], &warm.1, "").is_some() {
                bad.push(format!("同時に組む: Python [{k}] {} / 窓の最初 {}", x["json"], warm.1));
            }
        }
        for (k, x) in rs.iter().enumerate() {
            match x {
                Some((200, v)) if common::diff(v, &warm.1, "").is_none() => {}
                other => bad.push(format!("同時に組む: 窓 [{k}] {other:?}")),
            }
        }
    });
    let mut files = 0;
    for e in std::fs::read_dir(&joins).into_iter().flatten().flatten() {
        let p = e.path();
        let n = p.file_name().unwrap().to_string_lossy().into_owned();
        if n.ends_with(".tmp") {
            bad.push(format!("同時に組む: 書きかけの残り {n}"));
        }
        if n.ends_with(".sqlite3") {
            files += 1;
            let c = rusqlite::Connection::open_with_flags(&p, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
            let ok: Result<i64, _> = c.query_row("SELECT COUNT(*) FROM \"実績\"", [], |r| r.get(0));
            if ok.is_err() {
                bad.push(format!("同時に組む: 読めない答えのファイル {n}"));
            }
        }
    }
    if files != 14 {
        bad.push(format!("同時に組む: 答えのファイルの数 {files}（設備 14 台）"));
    }
    unsafe { std::env::remove_var("TRANSFER_APP_CONFIG") };
    drop(live);
    // 版 3.105.0: 任せた歩の下限は置かない（任せる歩は 0 へ減らしていく数で、減らすたびに落ちる。任せるはずの歩を窓が答えないことは歩ごとの確かめが、上限は予算〈common::check_budget〉が見る）
    assert!(steps >= 60, "歩が少ない: {steps}・{delegated}");
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
