//! 集計（版 3.61.0）: src/pivot.rs の query_many が、Python の services/pivot.query_many と同じ答え・同じ失敗を返すか。
//! program/tests/pivot_oracle.py が開発用サーバーと同じ試験データで、ダッシュボードが使う形（いくつかのファイル・設備の段・設備で絞る・
//! 設備のまとめ・設備グループの段・期間・計算列・箱ひげ・区間・読めないファイル・組み方の誤り）を Python で数えた答えと突き合わせる。
//! 値の計算（四則演算）は、Python が答えた事例を src/num_expr.rs でも計算して比べる。かかった時間（timing）は比べない。

mod common;

use chrono::NaiveDateTime;
use da_core::formula::{clean_calc, Tables};
use da_core::lotlist::{TABLE_CANDIDATES, WORK_TABLES};
use da_core::num_expr;
use da_core::pivot::{self, Ask, Equip, EquipMatcher, Fail, Part, Work};
use da_core::worksum::{segments_of, Clock};
use serde_json::{json, Value};
use std::sync::Arc;

fn text(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        x => x.to_string(),
    }
}

fn part_of(p: &Value) -> Part {
    let work = p.get("work").filter(|w| !w.is_null()).map(|w| Work {
        clock: Clock::new(segments_of(&json!({"区分": w["segments"].to_string()}))),
        basis: w["basis"].as_str().unwrap_or("work").into(),
        start: w["start"].as_str().unwrap_or("").into(),
    });
    let equip = p.get("equip").filter(|e| !e.is_null()).map(|e| match e.get("name") {
        Some(n) => Equip::Name(n.as_str().unwrap().into()),
        None => {
            let names: Vec<String> = e["names"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
            Equip::Column(e["column"].as_str().unwrap().into(), EquipMatcher::new(&names, e["mode"].as_str().unwrap_or("")))
        }
    });
    Part {
        path: p["path"].as_str().unwrap().into(),
        table: p["table"].as_str().unwrap_or("").into(),
        preferred_table: p["preferred"].as_str().unwrap_or("").into(),
        candidates: if p["cand"] == "work" { WORK_TABLES } else { TABLE_CANDIDATES },
        work,
        equip,
        name: p["name"].as_str().unwrap_or("").into(),
        lot_col: p["lot_col"].as_str().map(str::to_string),
    }
}

#[test]
fn pivot_answers_like_python() {
    let o = common::python_json("pivot_oracle.py", &[]);
    let now = NaiveDateTime::parse_from_str(o["now"].as_str().unwrap(), "%Y-%m-%d %H:%M:%S").unwrap();
    let conv = Arc::new(Tables::from_json(&Value::Null));
    let mut bad = vec![];
    let cases = o["cases"].as_array().unwrap();
    let (mut answered, mut failed) = (0, 0);
    for c in cases {
        let a = &c["ask"];
        let s = |k: &str| match &a[k] {
            Value::Null => String::new(),
            Value::String(x) => x.clone(),
            x => x.to_string(),
        };
        let (rows, cols, measures, filters, search, month, bx) =
            (s("rows"), s("cols"), s("measures"), s("filters"), s("search"), s("month"), s("box"));
        let calc = c["calc_text"].as_str().and_then(clean_calc);
        let equips: Vec<String> = a["equips"].as_array().map(|x| x.iter().map(text).collect()).unwrap_or_default();
        let now = c["now"].as_str().map(|t| NaiveDateTime::parse_from_str(t, "%Y-%m-%d %H:%M:%S").unwrap()).unwrap_or(now);
        let ask = Ask {
            search: &search,
            filters: &filters,
            rows: &rows,
            cols: &cols,
            measures: &measures,
            today: now.date(),
            month: &month,
            box_col: &bx,
            period: a.get("period"),
            now,
            calc: calc.as_ref(),
            conv: &conv,
            equips: &equips,
            egroups: a.get("egroups"),
            sets: a.get("sets"),
            bases: a.get("bases"),
        };
        let parts: Vec<Part> = c["parts"].as_array().unwrap().iter().map(part_of).collect();
        let name = c["name"].as_str().unwrap();
        match (pivot::query_many(parts, &ask), c.get("answer"), c.get("fail")) {
            (Ok(mut got), Some(want), _) => {
                answered += 1;
                got.as_object_mut().unwrap().remove("timing");
                if let Some(d) = common::diff(want, &got, "") {
                    bad.push(format!("{name}: {d}"));
                }
            }
            (Err(e), _, Some(f)) => {
                failed += 1;
                let kind = if matches!(e, Fail::Invalid(_)) { "invalid" } else { "down" };
                if kind != f["kind"] || e.text() != f["error"].as_str().unwrap() {
                    bad.push(format!("{name}: 失敗 {kind} {} / Python {} {}", e.text(), f["kind"], f["error"]));
                }
            }
            (Ok(_), _, f) => {
                bad.push(format!("{name}: 窓は答えた / Python は失敗 {}", f.map(|f| f["error"].to_string()).unwrap_or_default()))
            }
            (Err(e), _, _) => bad.push(format!("{name}: 窓は失敗 {} / Python は答えた", e.text())),
        }
    }
    assert!(answered >= 40 && failed >= 10, "組が足りません: 答え {answered}・失敗 {failed}");
    // カラムの札（計算列も: 式が読む列・読めない式・日付と読める計算列）
    let fields = o["fields"].as_array().unwrap();
    for f in fields {
        let calc = f["calc_text"].as_str().and_then(clean_calc);
        match (pivot::fields(&part_of(&f["part"]), calc.as_ref(), &conv, 300), f.get("answer")) {
            (Ok(got), Some(want)) => {
                if let Some(d) = common::diff(want, &got, "") {
                    bad.push(format!("カラムの札 {}: {d}", f["calc"]));
                }
            }
            (got, _) => bad.push(format!("カラムの札 {}: 窓 {:?} / Python {}", f["calc"], got.err(), f["fail"])),
        }
    }
    assert!(
        fields.len() >= 3 && fields.iter().any(|f| f["answer"]["fields"].as_array().is_some_and(|x| x.iter().any(|c| c["calc"] == true)))
    );
    // 値の計算（四則演算）: Python が答えた事例
    let mut n = 0;
    for x in o["num_expr"].as_array().unwrap() {
        let (src, v, want) = (x[0].as_str().unwrap(), x[1].as_f64().unwrap(), &x[2]);
        let got = num_expr::compile(src);
        let same = match want.as_str() {
            Some("err") => got.as_ref().is_err_and(|e| x.get(3).and_then(Value::as_str).is_none_or(|m| m == e)),
            Some("none") => matches!(got, Ok(None)),
            _ => match (got.ok().flatten().and_then(|e| e.apply(v)), want.as_f64()) {
                (None, None) => true,
                (Some(g), Some(w)) => g == w || (g - w).abs() <= w.abs() * 1e-15,
                _ => false,
            },
        };
        n += 1;
        if !same {
            bad.push(format!("値の計算「{src}」 x={v}: Python {want}"));
        }
    }
    assert!(n >= 200, "値の計算の事例が足りません: {n}");
    assert!(bad.is_empty(), "{} 通りが食い違いました:\n{}", bad.len(), bad.join("\n"));
}
