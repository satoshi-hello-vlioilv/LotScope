//! 転写距離・ピッチ計算（src/calc.rs）が Python の道（POST /api/calculate・POST /api/equipment/inspection）と同じ答えか
//! （版 3.72.0。順 6 の 1 段目）。program/tests/calc_oracle.py が場面ごとに置き場と設定を作り、本文ごとの Python の答えを出す。
//! ここでは同じ置き場（access::Place の読み方）と設定で窓の道に同じ本文を当て、窓が答えた物は状態・本文が同じか
//! （数は 0 と 0.0 を分けて比べる）、答えなかった物は Python に任せてよい形（must でない）かを見る。
//! 同じ PC の Python で答えを作る（2 乗の pow は OS の数学の部品の答えなので、焼いた表にしない）。

mod common;

use da_core::access::Place;
use da_core::calc::{handle, Masters};
use serde_json::Value;

#[test]
fn calc_matches_python() {
    let base = common::work("calc");
    let oracle = common::python_json("calc_oracle.py", &[base.to_str().unwrap()]);
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
            // 書く道の本文の門（版 3.104.0。本物の道 Lot::handle_body と同じく部品より先）
            let r = match common::gate("POST", c["path"].as_str().unwrap(), c["body"].as_str().unwrap().as_bytes()) {
                Err(a) => Some(a),
                Ok(b) => handle(c["path"].as_str().unwrap(), &b, &calc, &masters),
            };
            // Python の例外の答え（type の欄つき）は、どれも事例の表の種類で、日本語の言葉（版 3.115.0。前は「'thickness'」などの例外の字）
            if let Some(ty) = c["json"]["type"].as_str() {
                typed += 1;
                let e = c["json"]["error"].as_str().unwrap_or("");
                if !kinds.contains_key(ty) || !e.starts_with("計算の入力") {
                    bad.push(format!("{case}: Python の例外の答えが事例の表に無い {ty}: {e}"));
                }
            }
            match r {
                None => {
                    handed += 1;
                    if c["must"] == true {
                        bad.push(format!("{case}: 窓が答えない（Python {}）", c["status"]));
                    }
                }
                Some((status, got)) => {
                    answered += 1;
                    // 画面へ返す字（held::reply_bytes: 大きな整数は桁のまま・NaN と Infinity は null）で比べる
                    let got = common::json_keep(&da_core::held::reply_bytes(&got)).expect("窓の答えの字");
                    let want: &Value = &c["json"];
                    if status as i64 != c["status"].as_i64().unwrap() {
                        bad.push(format!(
                            "{case}: 状態 Python {} / 窓 {status}: {}",
                            c["status"],
                            got.to_string().chars().take(200).collect::<String>()
                        ));
                    } else if let Some(d) = common::diff(want, &got, "") {
                        bad.push(format!("{case}: {d}"));
                    }
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&base);
    println!("窓が答えた {answered}・Python に任せた {handed}");
    assert!(answered >= 600, "窓が答えた数が少ない: {answered}（任せた {handed}）");
    assert!(typed >= 150, "Python の例外の答えが少ない: {typed}");
    assert!(bad.is_empty(), "{} 件の食い違い（答えた {answered}・任せた {handed}）:\n{}", bad.len(), bad.join("\n"));
}
