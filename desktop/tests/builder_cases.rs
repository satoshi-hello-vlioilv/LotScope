//! 組む所の読み（版 3.99.0。src/builder.rs・pivot.rs の field_sets・merge_fields・column_names）が、仕様から人が書いた事例の表
//! program/tests/fixtures/builder_cases.json と同じ答えを出すか。Python に頼らない独立の答え（Python も同じ表を tests/test_builder_cases.py で読み、
//! 答えは tools/builder-truth.py〈app を import しない sqlite3 だけ〉でも作り直して突き合わせる）。
//! 事例: 札（合わせた本当の種類・空欄を 1 つ・0 と '0'・全部空欄・1,001 の境・1 台だけ空・13 台目からの列・計算列の並び）・
//! 値の見本（空欄を除き生の値）・確かめる（欄の表・" の場所・PC の時計より先の更新時刻・役割ごとの古さの警告）

use da_core::builder;
use da_core::formula::{clean_calc, Tables};
use da_core::lotlist::WORK_TABLES;
use da_core::pivot::{self, Part};
use rusqlite::types::Value as Sql;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn cases() -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixtures/builder_cases.json");
    serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap()
}

fn work() -> PathBuf {
    let d = std::env::temp_dir().join(format!("da-builder-cases-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn q(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// 事例の値 → SQLite の値（{"blob": 16 進}・{"real": 数}・数・字・null）
fn sql_of(v: &Value) -> Sql {
    match v {
        Value::Null => Sql::Null,
        Value::String(s) => Sql::Text(s.clone()),
        Value::Number(n) => n.as_i64().map(Sql::Integer).unwrap_or_else(|| Sql::Real(n.as_f64().unwrap())),
        Value::Object(o) if o.contains_key("blob") => {
            let h = o["blob"].as_str().unwrap();
            Sql::Blob((0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect())
        }
        Value::Object(o) if o.contains_key("real") => Sql::Real(o["real"].as_f64().unwrap()),
        _ => panic!("事例の値 {v}"),
    }
}

/// {"range": [頭, 始め, 終わり]} を広げた行
fn rows_of(rows: &Value) -> Vec<Vec<Value>> {
    let mut out = vec![];
    for r in rows.as_array().unwrap() {
        if let Some(rg) = r.get("range") {
            let (a, b) = (rg[1].as_i64().unwrap(), rg[2].as_i64().unwrap());
            for i in a..b {
                out.push(vec![match rg[0].as_str() {
                    Some(h) => json!(format!("{h}{i}")),
                    None => json!(i),
                }]);
            }
        } else {
            out.push(r.as_array().unwrap().clone());
        }
    }
    out
}

/// 事例のファイル（{"tables": {表: {cols, rows}}} か {cols, rows}＝表「実績」）を作る
fn make(path: &Path, spec: &Value) {
    let c = rusqlite::Connection::open(path).unwrap();
    let tabs: Vec<(String, Value)> = match spec.get("tables") {
        Some(t) => t.as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        None => vec![("実績".into(), json!({"cols": spec["cols"], "rows": spec["rows"]}))],
    };
    for (name, t) in tabs {
        let cols: Vec<String> = t["cols"].as_array().unwrap().iter().map(|x| q(x.as_str().unwrap())).collect();
        c.execute(&format!("CREATE TABLE {} ({})", q(&name), cols.join(", ")), []).unwrap();
        let marks = vec!["?"; cols.len()].join(", ");
        for r in rows_of(&t["rows"]) {
            let vals: Vec<Sql> = r.iter().map(sql_of).collect();
            c.execute(&format!("INSERT INTO {} VALUES ({marks})", q(&name)), rusqlite::params_from_iter(vals)).unwrap();
        }
    }
}

fn part(path: PathBuf, name: &str) -> Part {
    Part {
        path,
        table: String::new(),
        preferred_table: String::new(),
        candidates: WORK_TABLES,
        work: None,
        equip: None,
        name: name.into(),
        lot_col: None,
    }
}

#[test]
fn builder_cases_match_the_spec() {
    let cs = cases();
    let d = work();
    let conv = Arc::new(Tables::from_json(&json!({})));
    let mut bad = vec![];
    // 札
    for (i, c) in cs["fields"].as_array().unwrap().iter().enumerate() {
        let name = c["name"].as_str().unwrap();
        let calc = c.get("calc").and_then(|x| clean_calc(&x.to_string()));
        let mut per = vec![];
        for (j, p) in c["parts"].as_array().unwrap().iter().enumerate() {
            let f = d.join(format!("f{i}_{j}.sqlite3"));
            make(&f, p);
            let pt = part(f, &format!("台{}", j + 1));
            per.push((pt.name.clone(), pivot::field_sets(&pt, calc.as_ref(), &conv, 300).unwrap()));
        }
        let got = pivot::merge_fields(&per);
        for (col, want) in c["want"].as_object().unwrap() {
            let Some(g) = got.iter().find(|f| f["column"] == col.as_str()) else {
                bad.push(format!("{name}: 列 {col} が無い"));
                continue;
            };
            for (k, w) in want.as_object().unwrap() {
                let v =
                    if k == "blankOnly" || k == "calc" { json!(g.get(k).and_then(Value::as_bool).unwrap_or(false)) } else { g[k].clone() };
                if &v != w {
                    bad.push(format!("{name}: {col}.{k} 事例 {w} / 窓 {v}"));
                }
            }
        }
        if let Some(order) = c.get("order") {
            let cols: Vec<Value> = got.iter().map(|f| f["column"].clone()).collect();
            if &json!(cols) != order {
                bad.push(format!("{name}: 並び 事例 {order} / 窓 {}", json!(cols)));
            }
        }
    }
    // 値の見本
    for (i, c) in cs["samples"].as_array().unwrap().iter().enumerate() {
        let f = d.join(format!("s{i}.sqlite3"));
        make(&f, c);
        let (_, cols) = pivot::column_names(&part(f, ""), pivot::SAMPLES).unwrap();
        let got: serde_json::Map<String, Value> = cols.into_iter().map(|(k, v)| (k, json!(v))).collect();
        if Value::Object(got.clone()) != c["want"] {
            bad.push(format!("{}: 見本 事例 {} / 窓 {}", c["name"], c["want"], Value::Object(got)));
        }
    }
    // 確かめる
    for (i, c) in cs["checks"].as_array().unwrap().iter().enumerate() {
        let name = c["name"].as_str().unwrap();
        let p = d.join(format!("c{i}.sqlite3"));
        let place = match c["file"].as_str().unwrap() {
            "empty" => String::new(),
            kind => {
                if kind == "two" {
                    make(&p, &cs["files"]["two"]);
                } else if kind == "text" {
                    std::fs::write(&p, "abc").unwrap();
                }
                if let Some(h) = c.get("mtimeHours").and_then(Value::as_f64) {
                    let t = std::time::SystemTime::now() + std::time::Duration::from_secs_f64(h.abs() * 3600.0);
                    let t = if h < 0.0 { std::time::SystemTime::now() - std::time::Duration::from_secs_f64(-h * 3600.0) } else { t };
                    std::fs::File::options().write(true).open(&p).unwrap().set_modified(t).unwrap();
                }
                if c.get("quote") == Some(&json!(true)) {
                    format!("\"{}\"", p.display())
                } else {
                    p.display().to_string()
                }
            }
        };
        let b = &c["body"];
        let s = |k: &str| b.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let got = builder::check_sqlite(&place, &s("table"), &s("role"), &s("equipColumn"));
        let msg = got["message"].as_str().unwrap_or("");
        for (k, w) in c["want"].as_object().unwrap() {
            let v = if k == "ok" { got["ok"].clone() } else { got["detail"].get(k).cloned().unwrap_or(Value::Null) };
            if &v != w {
                bad.push(format!("{name}: {k} 事例 {w} / 窓 {v}（{msg}）"));
            }
        }
        for x in c.get("has").and_then(Value::as_array).into_iter().flatten() {
            if !msg.contains(x.as_str().unwrap()) {
                bad.push(format!("{name}: 言葉に「{x}」が無い（{msg}）"));
            }
        }
        for x in c.get("hasNot").and_then(Value::as_array).into_iter().flatten() {
            if msg.contains(x.as_str().unwrap()) {
                bad.push(format!("{name}: 言葉に「{x}」がある（{msg}）"));
            }
        }
    }
    // 結合の「試す」（作業実績の設備ごとに組んで足す。組めない設備は飛ばして名前を言う。作った後の採点の割れ）
    for (i, c) in cs["joins"].as_array().unwrap().iter().enumerate() {
        let name = c["name"].as_str().unwrap();
        let mut lefts = vec![];
        for (j, p) in c["parts"].as_array().unwrap().iter().enumerate() {
            let f = d.join(format!("j{i}_{j}.sqlite3"));
            make(&f, p);
            lefts.push(builder::Left { name: format!("台{}", j + 1), key: json!(format!("k{i}_{j}")), path: f, table: "実績".into() });
        }
        let r = d.join(format!("r{i}.sqlite3"));
        make(&r, &c["right"]);
        let items = da_core::join::Join::list(&json!([{"with": "r", "how": "left", "on": c["on"], "cols": []}]));
        let rights = vec![da_core::join::Right { path: r, table: "仕掛".into(), name: "相手".into() }];
        let joiner = da_core::join::Joiner::new(d.join("joins"));
        let (ans, failed, status) = builder::try_each(&joiner, &lefts, &items, &rights, "実績");
        let w = &c["want"];
        let names: Vec<Value> = failed.iter().map(|f| f["name"].clone()).collect();
        if json!(names) != w["failed"] || failed.iter().any(|f| f["kind"] != "join") {
            bad.push(format!("{name}: 組めなかった設備 事例 {} / 窓 {}", w["failed"], json!(failed)));
        }
        match ans {
            None if w["counted"] == 0 => {
                if status.map(|x| json!(x)) != Some(w["status"].clone()) {
                    bad.push(format!("{name}: 状態 事例 {} / 窓 {status:?}", w["status"]));
                }
            }
            Some(a) if w["counted"] != 0 => {
                let st = &a["stats"][0];
                let got = json!({"counted": a["counted"], "rows": st["rows"], "hit": st["hit"], "miss": st["miss"]});
                let want = json!({"counted": w["counted"], "rows": w["rows"], "hit": w["hit"], "miss": w["miss"]});
                if got != want {
                    bad.push(format!("{name}: 事例 {want} / 窓 {got}"));
                }
            }
            other => bad.push(format!("{name}: 数えた設備 事例 {} / 窓 {other:?}", w["counted"])),
        }
    }
    let _ = std::fs::remove_dir_all(&d);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

#[test]
fn decisions_are_the_main_sessions() {
    // 決め（主のセッションの決め 1〜7。Python の services/builder.py と同じ値。builder_parity が Python の値とも突き合わせる）
    let d = builder::decisions();
    assert_eq!(d["kindsUnion"], json!(true));
    assert_eq!(d["equipLimit"], Value::Null);
    assert_eq!(d["joinAllEquips"], json!(true));
    assert_eq!(d["staleRoles"], json!(["品質", "仕掛", "実績"]));
    assert_eq!(d["cm3Reach"], json!(true));
}
