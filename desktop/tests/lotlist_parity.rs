//! 異常ロット一覧: Rust（src/lotlist.rs）の答えが Python（app/services/lot_list.py）と同じか。
//! 試験用の品質データと問い合わせの組は program/tests/lotlist_fixture.py（Python の試験と同じ物）。
//! 版 3.116.0 から窓の答えを焼いた表（tests/baked/lotlist.json。詰めた形。場面の品質データは台本 lotlist_fixture.py が作り、表は指紋だけ）にも持ち、Python 無しでは表とだけ比べる。

mod common;

use chrono::NaiveDate;
use da_core::formula::Tables;
use da_core::lotlist::{query, slicer, slicer_combos, Args, Opts};
use serde_json::Value;
use std::sync::Arc;

fn args(case: &Value) -> Args {
    let s = |k: &str| case.get(k).and_then(Value::as_str).map(str::to_string);
    Args {
        table: s("table").unwrap_or_default(),
        page: s("page"),
        page_size: s("page_size"),
        search: s("search").unwrap_or_default(),
        filters: s("filters").unwrap_or_default(),
        sorts: s("sorts").unwrap_or_default(),
        group: s("group").as_deref() == Some("1"),
        marks: s("marks").unwrap_or_default(),
        calc: s("calc").unwrap_or_default(),
    }
}

#[test]
fn rust_answers_like_python() {
    let work = common::work("lotlist");
    let mut bk = common::bake::Bake::open("lotlist", &work);
    bk.pack = true;
    // 場面の品質データは標準の部品だけの台本（lotlist_fixture.py）が作り、表は指紋だけを持つ
    bk.script = Some(("lotlist_fixture.py", vec![work.join("lotlist_fixture.sqlite3").to_string_lossy().into_owned()]));
    // Python の答え（expected）は表に持たない（表は窓の答えを answers に持つ）
    bk.drop.push("expected");
    let o = bk.oracle("lotlist_oracle.py", &[work.to_str().unwrap()]);
    let db = std::path::PathBuf::from(o["db"].as_str().unwrap());
    let today = NaiveDate::parse_from_str(o["today"].as_str().unwrap(), "%Y-%m-%d").unwrap();
    let cases = o["cases"].as_array().unwrap();
    // 計算列の式の conv が引く変換表（Python の oracle と同じ同梱のプリセット）
    let tables = Arc::new(Tables::from_json(&o["tables"]));
    assert!(cases.iter().filter(|c| c.get("calc").is_some()).count() >= 8, "計算列で並べ替える組が足りません");
    assert!(cases.len() >= 40, "問い合わせの組が足りません: {}", cases.len());
    let mut bad = vec![];
    for (i, case) in cases.iter().enumerate() {
        // Python の oracle と同じ渡し方（設定の件数は 500・設定の表は無し）
        let s = |k: &str| case.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
        let answer = if case.get("combos").is_some() {
            // 計算列のスライサー（/api/lotlist/slicer の columns）
            slicer_combos(&db, &args(case), &s("combos"), &Opts::quality("", 500), today).map_err(|(_, e)| e)
        } else if case.get("slicer").is_some() {
            // スライサーに並べる値（/api/lotlist/slicer）
            slicer(&db, &args(case), &s("slicer"), &s("key"), &Opts::quality("", 500), today).map_err(|(_, e)| e)
        } else {
            query(&db, &args(case), &Opts::quality("", 500), today, &tables, None)
        };
        let got = match answer {
            Ok(mut v) => {
                v.as_object_mut().unwrap().remove("timing");
                serde_json::json!({"ok": v})
            }
            Err(e) => serde_json::json!({"error": e}),
        };
        let key = format!("#{i}");
        let want = bk.want(&key, || o["expected"][i].clone());
        let route = if case.get("combos").is_some() {
            "slicer combos"
        } else if case.get("slicer").is_some() {
            "slicer"
        } else {
            "query"
        };
        bk.note(&key, route, &got, &want);
        if let Some(d) = common::diff(&bk.s(&want), &bk.s(&got), "") {
            bad.push(format!("#{i} {case}: {d}"));
        }
    }
    let _ = std::fs::remove_dir_all(&work);
    bk.finish(&bad);
    assert!(bad.is_empty(), "{} / {} 通りが食い違いました:\n{}", bad.len(), cases.len(), bad.join("\n"));
}
