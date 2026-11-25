//! 集計（版 3.61.0）: src/pivot.rs の query_many が、Python の services/pivot.query_many と同じ答え・同じ失敗を返すか。
//! 前の版の答え合わせ役 pivot が開発用サーバーと同じ試験データで、ダッシュボードが使う形（いくつかのファイル・設備の段・設備で絞る・
//! 設備のまとめ・設備グループの段・期間・計算列・箱ひげ・区間・読めないファイル・組み方の誤り）を Python で数えた答えと突き合わせる。
//! 値の計算（四則演算）は、Python が答えた事例を src/num_expr.rs でも計算して比べる。かかった時間（timing）は比べない。
//! 版 3.117.2 から窓の答えを焼いた表（tests/baked/pivot.json。詰めた形）にも持つ。場面は作業フォルダの下で、SQLite は標準の部品だけの台本
//! （program/tests/ui_scene.py）が作り、表は指紋だけを持つ。

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

/// 失敗の形（invalid・down と言葉）
fn fail_of(e: &Fail) -> Value {
    json!({"fail": {"kind": if matches!(e, Fail::Invalid(_)) { "invalid" } else { "down" }, "error": e.text()}})
}

#[test]
fn pivot_answers_like_python() {
    let work = common::work("pivot");
    let mut bk = common::bake::Bake::open("pivot", &work);
    bk.pack = true;
    bk.script = Some(("ui_scene.py", vec![work.to_string_lossy().into_owned(), "pivot".into()]));
    bk.exclude.extend(["cache", "local", "instance_id", "roll_master.json", "roll_master.csv"]);
    bk.fid_key = Some("fids");
    let o = bk.table_oracle();
    let now = NaiveDateTime::parse_from_str(o["now"].as_str().unwrap(), "%Y-%m-%d %H:%M:%S").unwrap();
    let conv = Arc::new(Tables::from_json(&Value::Null));
    let mut bad = vec![];
    let cases = o["cases"].as_array().unwrap();
    let (mut answered, mut failed) = (0, 0);
    for (i, c) in cases.iter().enumerate() {
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
        let got = match pivot::query_many(parts, &ask) {
            Ok(mut got) => {
                got.as_object_mut().unwrap().remove("timing");
                json!({"answer": got})
            }
            Err(e) => fail_of(&e),
        };
        let key = format!("#{i} {name}");
        let want = bk.want(&key, || match (c.get("answer"), c.get("fail")) {
            (Some(w), _) => json!({"answer": w}),
            (_, Some(f)) => json!({"fail": f}),
            _ => json!({}),
        });
        bk.note(&key, "query_many", &got, &want);
        answered += want.get("answer").is_some() as usize;
        failed += want.get("fail").is_some() as usize;
        let (want, got) = (bk.s(&want), bk.s(&got));
        match (got.get("answer"), want.get("answer")) {
            (Some(_), Some(_)) | (None, None) => {
                if let Some(d) = common::diff(&want, &got, "") {
                    bad.push(format!("{name}: {d}"));
                }
            }
            (Some(_), None) => bad.push(format!("{name}: 窓は答えた / Python は失敗 {}", want["fail"]["error"])),
            (None, Some(_)) => bad.push(format!("{name}: 窓は失敗 {} / Python は答えた", got["fail"]["error"])),
        }
    }
    assert!(answered >= 40 && failed >= 10, "組が足りません: 答え {answered}・失敗 {failed}");
    // カラムの札（計算列も: 式が読む列・読めない式・日付と読める計算列）
    let fields = o["fields"].as_array().unwrap();
    let mut calc_field = false;
    for (i, f) in fields.iter().enumerate() {
        let calc = f["calc_text"].as_str().and_then(clean_calc);
        let got = match pivot::fields(&part_of(&f["part"]), calc.as_ref(), &conv, 300) {
            Ok(g) => json!({"answer": g}),
            Err(e) => json!({"fail": format!("{e:?}")}),
        };
        let key = format!("カラムの札 #{i}");
        let want = bk.want(&key, || match f.get("answer") {
            Some(w) => json!({"answer": w}),
            None => json!({"fail": f["fail"]}),
        });
        bk.note(&key, "fields", &got, &want);
        calc_field |= want["answer"]["fields"].as_array().is_some_and(|x| x.iter().any(|c| c["calc"] == true));
        let (want, got) = (bk.s(&want), bk.s(&got));
        if want.get("answer").is_none() || got.get("answer").is_none() {
            bad.push(format!("カラムの札 {}: 窓 {} / Python {}", f["calc"], got, want));
        } else if let Some(d) = common::diff(&want, &got, "") {
            bad.push(format!("カラムの札 {}: {d}", f["calc"]));
        }
    }
    assert!(fields.len() >= 3 && calc_field);
    // 値の計算（四則演算）: Python が答えた事例（表は窓の答え。数は 1e-15 の内を同じとみなす）
    let mut n = 0;
    for (i, x) in o["num_expr"].as_array().unwrap().iter().enumerate() {
        let (src, v) = (x[0].as_str().unwrap(), x[1].as_f64().unwrap());
        let got = match num_expr::compile(src) {
            Err(e) => json!({"err": e}),
            Ok(None) => json!({"none": true}),
            Ok(Some(e)) => json!({"v": e.apply(v)}),
        };
        let key = format!("値の計算 #{i}");
        let want = bk.want(&key, || match x[2].as_str() {
            Some("err") => json!({"err": x.get(3).cloned().unwrap_or(Value::Null)}),
            Some("none") => json!({"none": true}),
            _ => json!({"v": x[2]}),
        });
        bk.note(&key, "num_expr", &got, &want);
        let same = match (&got["v"], &want["v"]) {
            (Value::Null, Value::Null) => {
                // 失敗の言葉は Python が言葉を添えた時だけ比べる
                got.get("err").is_some() == want.get("err").is_some()
                    && got.get("none") == want.get("none")
                    && (want["err"].is_null() || got["err"] == want["err"])
            }
            (g, w) => match (g.as_f64(), w.as_f64()) {
                (Some(g), Some(w)) => g == w || (g - w).abs() <= w.abs() * 1e-15,
                _ => false,
            },
        };
        n += 1;
        if !same {
            bad.push(format!("値の計算「{src}」 x={v}: 窓 {got} / Python {want}"));
        }
    }
    assert!(n >= 200, "値の計算の事例が足りません: {n}");
    let _ = std::fs::remove_dir_all(&work);
    bk.finish(&bad);
    assert!(bad.is_empty(), "{} 通りが食い違いました:\n{}", bad.len(), bad.join("\n"));
}
