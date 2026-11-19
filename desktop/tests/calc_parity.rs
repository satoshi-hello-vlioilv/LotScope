//! 転写距離・ピッチ計算（src/calc.rs）が Python の道（POST /api/calculate・POST /api/equipment/inspection）と同じ答えか
//! （版 3.72.0。順 6 の 1 段目）。program/tests/calc_oracle.py が場面ごとに置き場と設定を作り、本文ごとの Python の答えを出す。
//! ここでは同じ置き場（access::Place の読み方）と設定で窓の道に同じ本文を当て、状態・本文が同じか（数は 0 と 0.0 を分けて比べる）を見る。
//! 版 3.116.0 から窓はどの形も答える（Python が例外で答える形・大きな整数・答えに NaN の出る形。任せる歩は 0）。
//! 2 乗は C の pow のまま（利用者の決め 2026-11-18）。窓の答えは焼いた表（tests/baked/calc.json。詰めた形）にも持ち、Python 無し
//! （TPA_NO_PYTHON=1）では表とだけ比べる。乱数の事例は Python とは 160 件を比べ、表には 40 件を焼く（"bake": false の事例は焼かない）。
//! Windows で最後の桁が違う歩は、Windows の測るだけの仕事（.github/workflows/desktop.yml）が数える。

mod common;

use da_core::access::Place;
use da_core::calc::{handle, Masters};
use serde_json::{json, Value};

/// 表に焼く事例だけにした答え合わせ役の答え（"bake": false の事例を除く）
fn baked_only(oracle: &Value) -> Value {
    let mut o = oracle.clone();
    for sc in o["scenarios"].as_array_mut().unwrap() {
        sc["cases"].as_array_mut().unwrap().retain(|c| c["bake"] != false);
    }
    o
}

#[test]
fn calc_matches_python() {
    let base = common::work("calc");
    let mut bk = common::bake::Bake::open("calc", &base);
    bk.pack = true;
    // 事例（name・path・body）の status・json は焼かない（表は窓の答えを answers に持つ）
    bk.strip_in = vec!["body"];
    let oracle = if bk.python() {
        let full = common::python_json("calc_oracle.py", &[base.to_str().unwrap()]);
        bk.took(&baked_only(&full));
        full
    } else {
        bk.oracle("calc_oracle.py", &[base.to_str().unwrap()])
    };
    let (mut bad, mut answered, mut handed, mut typed) = (vec![], 0, 0, 0);
    let table: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/calc_error_cases.json")).unwrap();
    let kinds = table["kinds"].as_object().unwrap().clone();
    for sc in oracle["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let place = Place::from_json(&sc["conf"]["place"]);
        let masters = Masters::new(place.rows("equipment_master").unwrap(), place.rows("roll_master").unwrap()).expect("マスタ");
        // 設定の calculation は束の値のまま（版 3.116.0: null・並びも Python と同じ例外の答えになる。前は null を {} にして渡した）
        let calc = sc["calculation"].clone();
        for c in sc["cases"].as_array().unwrap() {
            let case = format!("{name} / {}", c["name"].as_str().unwrap());
            let path = c["path"].as_str().unwrap();
            // 書く道の本文の門（版 3.104.0。本物の道 Lot::handle_body と同じく部品より先）
            let r = match common::gate("POST", path, c["body"].as_str().unwrap().as_bytes()) {
                Err(a) => Some(a),
                Ok(b) => handle(path, &b, &calc, &masters),
            };
            let Some((status, got)) = r else {
                handed += 1;
                bad.push(format!("{case}: 窓が答えない"));
                continue;
            };
            answered += 1;
            // 画面へ返す字（held::reply_bytes: 大きな整数は桁のまま・NaN と Infinity は null）で比べる
            let got = common::json_keep(&da_core::held::reply_bytes(&got)).expect("窓の答えの字");
            let (want_status, want) = if c["bake"] == false {
                (c["status"].as_i64().unwrap(), c["json"].clone())
            } else {
                let w = bk.want_step(&case, c);
                bk.note(&case, &format!("POST {path}"), &json!({"status": status, "json": got}), &json!({"status": w.0, "json": w.1}));
                w
            };
            // Python の例外の答え（type の欄つき）は、どれも事例の表の種類で、日本語の言葉（版 3.115.0。前は「'thickness'」などの例外の字）
            if let Some(ty) = want["type"].as_str() {
                typed += 1;
                let e = want["error"].as_str().unwrap_or("");
                if !kinds.contains_key(ty) || !e.starts_with("計算の入力") {
                    bad.push(format!("{case}: 例外の答えが事例の表に無い {ty}: {e}"));
                }
            }
            if status as i64 != want_status {
                bad.push(format!("{case}: 状態 {want_status} / 窓 {status}: {}", got.to_string().chars().take(200).collect::<String>()));
            } else if let Some(d) = common::diff(&bk.s(&want), &bk.s(&got), "") {
                bad.push(format!("{case}: {d}"));
            }
        }
    }
    let _ = std::fs::remove_dir_all(&base);
    println!("窓が答えた {answered}・Python に任せた {handed}");
    assert!(answered >= 1200, "窓が答えた数が少ない: {answered}（任せた {handed}）");
    assert_eq!(handed, 0, "窓が答えない形がある");
    assert!(typed >= 150, "例外の答えが少ない: {typed}");
    bk.finish(&bad);
    assert!(bad.is_empty(), "{} 件の食い違い（答えた {answered}・任せた {handed}）:\n{}", bad.len(), bad.join("\n"));
}
