//! 作業実績・データ元の一覧（版 3.60.0）: Rust（src/lotlist.rs・src/worksum.rs）の答えが Python（lot_list.query・work_summary）と同じか。
//! 表の候補・設定の表・ロット番号の列の上書き・作業でまとめる（勤務体系・直・日の数）・日時の読み方を、
//! program/tests/lists_oracle.py の答えと突き合わせる。

mod common;

use chrono::NaiveDate;
use da_core::formula::Tables;
use da_core::join::{build, Join, JoinError, Joiner, Right};
use da_core::lotlist::{query, slicer, slicer_combos, Args, Opts, TABLE_CANDIDATES, WORK_TABLES};
use da_core::pyfmt::{to_datetime, to_minutes, Py};
use da_core::worksum::{pattern_for, Grouping};
use serde_json::{json, Value};
use std::sync::Arc;

fn py(v: &Value) -> Py<'_> {
    match v {
        Value::Null => Py::None,
        Value::String(s) => Py::Text(s),
        Value::Number(n) => n.as_i64().map(Py::Int).unwrap_or_else(|| Py::Float(n.as_f64().unwrap())),
        x => panic!("値の形: {x}"),
    }
}

#[test]
fn work_and_source_lists_answer_like_python() {
    let work = common::work("lists");
    let o = common::python_json("lists_oracle.py", &[work.to_str().unwrap()]);
    let today = NaiveDate::parse_from_str(o["today"].as_str().unwrap(), "%Y-%m-%d").unwrap();
    let shifts = o["shifts"].as_array().unwrap().clone();
    let tables = Arc::new(Tables::from_json(&json!({})));
    let (cases, expected) = (o["cases"].as_array().unwrap(), o["expected"].as_array().unwrap());
    assert!(cases.len() >= 40, "問い合わせの組が足りません: {}", cases.len());
    let grouped = expected.iter().filter(|e| e["ok"]["work"]["buckets"].as_array().is_some_and(|b| !b.is_empty())).count();
    assert!(grouped >= 20, "作業でまとめた答えが足りません: {grouped}");
    let read = o["datetimes"].as_array().unwrap().iter().filter(|x| !x[2].is_null()).count();
    assert!(read >= 300 && o["datetimes"].as_array().unwrap().len() >= 500, "日時の事例が足りません: {read}");
    let mut bad = vec![];
    for (i, (case, want)) in cases.iter().zip(expected).enumerate() {
        let db = std::path::PathBuf::from(o["dbs"][case["db"].as_str().unwrap()].as_str().unwrap());
        let qs: Vec<(String, String)> =
            case["args"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string())).collect();
        let a = Args::from_query(
            &qs.iter()
                .map(|(k, v)| format!("{k}={}", v.bytes().map(|b| format!("%{b:02X}")).collect::<String>()))
                .collect::<Vec<_>>()
                .join("&"),
        );
        let quality = case["cands"] == "lot";
        let opts = Opts {
            table: case["table"].as_str().unwrap_or("").into(),
            candidates: if case["cands"] == "work" { WORK_TABLES } else { TABLE_CANDIDATES },
            page_size: 500,
            lot_col: case["lot"].as_str().map(str::to_string),
            quality,
        };
        let answer = if let Some(cols) = case["combos"].as_str() {
            slicer_combos(&db, &a, cols, &opts, today).map_err(|(_, e)| e)
        } else if let Some(col) = case["slicer"].as_str() {
            slicer(&db, &a, col, "", &opts, today).map_err(|(_, e)| e)
        } else {
            let pat = pattern_for(&shifts, case["equip"].as_str().unwrap_or("CAL"));
            let mut g = Grouping::from_query(&qs, pat.as_ref());
            query(&db, &a, &opts, today, &tables, g.as_mut())
        };
        let got = match answer {
            Ok(mut v) => {
                v.as_object_mut().unwrap().remove("timing");
                if let Some(w) = v.get_mut("work").and_then(Value::as_object_mut) {
                    w.remove("ms");
                }
                json!({"ok": v})
            }
            Err(e) => json!({"error": e}),
        };
        if let Some(d) = common::diff(want, &got, "") {
            bad.push(format!("#{i} {case}: {d}"));
        }
    }
    // 日時の読み方（作業開始の鍵・日・直の元）
    for x in o["datetimes"].as_array().unwrap() {
        let got = to_datetime(&py(&x[0]), &py(&x[1]));
        if got.as_deref() != x[2].as_str() {
            bad.push(format!("to_datetime({}, {}) = {got:?}（Python は {}）", x[0], x[1], x[2]));
        }
    }
    for x in o["minutes"].as_array().unwrap() {
        let got = to_minutes(&py(&x[0])).map(|(h, m, s)| json!([h, m, s])).unwrap_or(Value::Null);
        if got != x[1] {
            bad.push(format!("to_minutes({}) = {got}（Python は {}）", x[0], x[1]));
        }
    }
    // 結合（data_join → src/join.rs）: 数・列・行の全部と、答えのファイルの名前（Python と同じ決まりの名前なら互いに使い回せる）
    let joins = o["joins"].as_array().unwrap();
    assert!(joins.len() >= 8 && joins.iter().filter(|j| j["expected"]["error"].is_string()).count() >= 2, "結合の事例が足りません");
    for (i, j) in joins.iter().enumerate() {
        let want = &j["expected"];
        let base = std::path::PathBuf::from(o["dbs"][j["base"].as_str().unwrap()].as_str().unwrap());
        let items = Join::list(&j["items"]);
        let rights: Vec<Right> = want["rights"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|r| Right {
                        path: r[0].as_str().unwrap().into(),
                        table: r[1].as_str().unwrap().into(),
                        name: r[2].as_str().unwrap().into(),
                    })
                    .collect()
            })
            .unwrap_or_else(|| {
                // 失敗の事例は相手の場所を答えに持たないので、同じ作り方で並べる（製造条件・設備のマスタ）
                j["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|x| {
                        let (file, table) =
                            if x["with"] == "cond" { ("製造条件マスタ", "製造条件") } else { ("設備マスタ", "設備") };
                        Right { path: work.join("masters").join(format!("{file}.sqlite3")), table: table.into(), name: file.into() }
                    })
                    .collect()
            });
        let dest = work.join("joins_rs").join(format!("j{i}.sqlite3"));
        match build(&dest, &base, "仕掛", &items, &rights) {
            Err(e) => {
                let rule = matches!(e, JoinError::Rule(_));
                if want["error"].as_str() != Some(e.to_string().as_str()) || want["rule"].as_bool() != Some(rule) {
                    bad.push(format!("結合 #{i}: 失敗 {e}（{rule}）/ Python {want}"));
                }
            }
            Ok(stats) => {
                let c = rusqlite::Connection::open(&dest).unwrap();
                let cols: Vec<String> =
                    c.prepare("PRAGMA table_info(\"仕掛\")").unwrap().query_map([], |r| r.get(1)).unwrap().map(Result::unwrap).collect();
                let mut st = c.prepare("SELECT * FROM \"仕掛\"").unwrap();
                let n = cols.len();
                let rows: Vec<Value> = st
                    .query_map([], |r| {
                        Ok(Value::Array(
                            (0..n)
                                .map(|k| match r.get_ref(k).unwrap() {
                                    rusqlite::types::ValueRef::Null => Value::Null,
                                    rusqlite::types::ValueRef::Integer(x) => json!(x),
                                    rusqlite::types::ValueRef::Real(x) => json!(x),
                                    rusqlite::types::ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                                    rusqlite::types::ValueRef::Blob(b) => json!(format!("（バイナリ {} バイト）", b.len())),
                                })
                                .collect(),
                        ))
                    })
                    .unwrap()
                    .map(Result::unwrap)
                    .collect();
                let got = json!({"stats": stats, "columns": cols, "rows": rows});
                let mut w = want.clone();
                for k in ["rights", "name"] {
                    w.as_object_mut().unwrap().remove(k);
                }
                if let Some(d) = common::diff(&w, &got, "") {
                    bad.push(format!("結合 #{i}: {d}"));
                }
                let (path, _) = Joiner::new(work.join("joiner_rs")).path_for(&format!("k{i}"), &base, "仕掛", &items, &rights).unwrap();
                if path.file_name().unwrap().to_str() != want["name"].as_str() {
                    bad.push(format!("結合 #{i}: 答えのファイルの名前 {path:?} / Python {}", want["name"]));
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&work);
    assert!(bad.is_empty(), "{} 通りが食い違いました:\n{}", bad.len(), bad.join("\n"));
}
