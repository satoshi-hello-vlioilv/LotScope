//! 作業実績・データ元の一覧（版 3.60.0）: Rust（src/lotlist.rs・src/worksum.rs）の答えが Python（lot_list.query・work_summary）と同じか。
//! 表の候補・設定の表・ロット番号の列の上書き・作業でまとめる（勤務体系・直・日の数）・日時の読み方を、
//! program/tests/lists_oracle.py の答えと突き合わせる。
//! 版 3.116.0 から窓の答えを焼いた表（tests/baked/lists.json。詰めた形）にも持つ。場面の SQLite は標準の部品だけの台本
//! （program/tests/lists_scene.py）が作り、表は指紋だけを持つ（Python 無しの形では台本が作り直した物と指紋を比べる）。

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
    let mut bk = common::bake::Bake::open("lists", &work);
    bk.pack = true;
    bk.script = Some(("lists_scene.py", vec![work.to_string_lossy().into_owned()]));
    // Python が作った結合の答え（joins_py・joiner_py）は場面に入れない
    bk.exclude.extend(["joins_py", "joiner_py"]);
    // Python の答え（expected・結合の expected）は表の問い合わせに持たない（表は窓の答えを answers に持つ）
    let o = bk.oracle_with("lists_oracle.py", &[work.to_str().unwrap()], |v| {
        let mut o = v.clone();
        o.as_object_mut().unwrap().remove("expected");
        for j in o["joins"].as_array_mut().unwrap() {
            j.as_object_mut().unwrap().remove("expected");
        }
        o
    });
    let today = NaiveDate::parse_from_str(o["today"].as_str().unwrap(), "%Y-%m-%d").unwrap();
    let shifts = o["shifts"].as_array().unwrap().clone();
    let tables = Arc::new(Tables::from_json(&json!({})));
    let cases = o["cases"].as_array().unwrap();
    assert!(cases.len() >= 40, "問い合わせの組が足りません: {}", cases.len());
    let mut grouped = 0;
    let read = o["datetimes"].as_array().unwrap().iter().filter(|x| !x[2].is_null()).count();
    assert!(read >= 300 && o["datetimes"].as_array().unwrap().len() >= 500, "日時の事例が足りません: {read}");
    let mut bad = vec![];
    for (i, case) in cases.iter().enumerate() {
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
        let key = format!("#{i}");
        let want = bk.want(&key, || o["expected"][i].clone());
        bk.note(&key, "list", &got, &want);
        grouped += usize::from(want["ok"]["work"]["buckets"].as_array().is_some_and(|b| !b.is_empty()));
        if let Some(d) = common::diff(&bk.s(&want), &bk.s(&got), "") {
            bad.push(format!("#{i} {case}: {d}"));
        }
    }
    assert!(grouped >= 20, "作業でまとめた答えが足りません: {grouped}");
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
    assert!(joins.len() >= 8, "結合の事例が足りません");
    // 答えのファイルの名前（k番号_指紋.sqlite3）の指紋は基の場所（作業フォルダの道）から作るので、表には名前の頭と拡張子だけを持つ
    // （Python とは名前の全部を比べる。同じ決まりの名前なら互いに使い回せる）
    let name_re = common::re(r"^(k\d+)_[0-9a-f]+(\.sqlite3)$");
    let mut failed = 0;
    for (i, j) in joins.iter().enumerate() {
        let key = format!("結合 #{i}");
        let want = bk.want(&key, || {
            let mut w = j["expected"].clone();
            if let Some(n) = w["name"].as_str() {
                w["name"] = json!(name_re.replace(n, "${1}_<指紋>${2}"));
            }
            w
        });
        // 結合の基は小さい物（lists_scene の quality_s・wip_s）
        let base = std::path::PathBuf::from(o["dbs"][format!("{}_s", j["base"].as_str().unwrap())].as_str().unwrap());
        let items = Join::list(&j["items"]);
        let rights: Vec<Right> = j["rights"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| Right { path: r[0].as_str().unwrap().into(), table: r[1].as_str().unwrap().into(), name: r[2].as_str().unwrap().into() })
            .collect();
        let dest = work.join("joins_rs").join(format!("j{i}.sqlite3"));
        let got = match build(&dest, &base, "仕掛", &items, &rights) {
            Err(e) => {
                failed += 1;
                json!({"error": e.to_string(), "rule": matches!(e, JoinError::Rule(_))})
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
                let (path, _) = Joiner::new(work.join("joiner_rs")).path_for(&format!("k{i}"), &base, "仕掛", &items, &rights).unwrap();
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                // Python とは名前の全部を比べる
                if bk.python() && Some(name.as_str()) != j["expected"]["name"].as_str() {
                    bad.push(format!("結合 #{i}: 答えのファイルの名前 {name} / Python {}", j["expected"]["name"]));
                }
                json!({"stats": stats, "columns": cols, "rows": rows, "name": name_re.replace(&name, "${1}_<指紋>${2}")})
            }
        };
        bk.note(&key, "join", &got, &want);
        if let Some(d) = common::diff(&bk.s(&want), &bk.s(&got), "") {
            bad.push(format!("結合 #{i}: {d}"));
        }
    }
    assert!(failed >= 2, "結合の失敗の事例が足りません: {failed}");
    let _ = std::fs::remove_dir_all(&work);
    bk.finish(&bad);
    assert!(bad.is_empty(), "{} 通りが食い違いました:\n{}", bad.len(), bad.join("\n"));
}
