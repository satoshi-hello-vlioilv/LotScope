//! 転写距離・ピッチ計算の、人が手で確かめた値の事例の表（program/tests/fixtures/calc_cases.json。版 3.116.0）を窓の calc::calculate が
//! 満たすか。Python は tests/test_calc_cases.py が同じ表を読む。焼いた表（tests/baked/calc.json。窓が自分の答えを焼いた物）とは別の、
//! bless が書き換えない第 2 の線（段 ④ で Python の test_calculator.py が消えても残る）。Python を呼ばない。

use da_core::calc::{calculate, Masters};
use serde_json::{json, Map, Value};

fn rows(file: &str) -> Vec<Value> {
    let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program").join("data").join(file);
    let v: Value = serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap();
    v.get("rows").cloned().unwrap_or(v).as_array().unwrap().clone()
}

/// 見本 L6183D0（program/tests/test_calculator.py の lot_l6183d0 と同じ）
fn lot_l6183d0(unwind: &str) -> Value {
    let rows: [(&str, f64, f64, f64, i64, i64, i64); 10] = [
        ("HOT", 7.0, 1200.0, 6214.0, 1, 0, 0),
        ("L-1", 3.6, 1200.0, 6214.0, 1, 0, 0),
        ("L-1", 2.2, 1200.0, 6214.0, 1, 0, 0),
        ("L-1", 1.3, 1200.0, 6214.0, 1, 0, 0),
        ("L-2", 0.8, 1200.0, 6149.7, 1, 0, 0),
        ("L-2", 0.508, 1200.0, 6031.9, 1, 0, 0),
        ("CAL", 0.505, 1200.0, 5854.9, 1, 0, 0),
        ("TLV", 0.505, 1179.8, 5511.5, 1, 85, 121),
        ("LS4", 0.505, 49.87, 5121.3, 69, 60, 68),
        ("KEN", 0.505, 49.9, 4935.0, 69, 0, 0),
    ];
    let ps: Vec<Value> = rows
        .iter()
        .enumerate()
        .map(|(i, (eq, t, w, kg, sp, f, b))| {
            json!({"no": i + 1, "equipment": eq, "unwind": unwind, "thickness": t, "width": w, "weight": kg, "design_split": sp,
                   "horizontal_split": 1, "vertical_split": 1, "off_front_m": f, "off_back_m": b})
        })
        .collect();
    json!({"lot_no": "L6183D0", "density": 2.73, "processes": ps})
}

fn lot_of(spec: &Value) -> Value {
    if let Some(rows) = spec["rows"].as_array() {
        let ps: Vec<Value> = rows
            .iter()
            .enumerate()
            .map(|(i, r)| {
                json!({"no": i + 1, "equipment": r[0], "unwind": "上", "thickness": r[1], "width": r[2], "weight": r[3], "design_split": 1,
                       "horizontal_split": 1, "vertical_split": 1, "off_front_m": 0, "off_back_m": r[4]})
            })
            .collect();
        return json!({"lot_no": "T", "density": 2.73, "processes": ps});
    }
    let mut lot = lot_l6183d0(spec["unwind"].as_str().unwrap_or("上"));
    for s in spec["set"].as_array().into_iter().flatten() {
        let p = lot["processes"][s[0].as_u64().unwrap() as usize].as_object_mut().unwrap();
        p.extend(s[1].as_object().unwrap().clone());
    }
    let o = lot.as_object_mut().unwrap();
    o.extend(spec["top"].as_object().cloned().unwrap_or_default());
    for k in spec["del"].as_array().into_iter().flatten() {
        o.remove(k.as_str().unwrap());
    }
    lot
}

fn inputs_of(case: &Value) -> Value {
    let mut i: Map<String, Value> =
        json!({"found_equipment": "8:TLV", "found_pitch_mm": 610, "soil_a_m": 1610.70, "soil_b_m": 1613.70, "tolerance_percent": 2})
            .as_object()
            .unwrap()
            .clone();
    i.extend(case["inputs"].as_object().cloned().unwrap_or_default());
    for k in case["inputsDel"].as_array().into_iter().flatten() {
        i.remove(k.as_str().unwrap());
    }
    Value::Object(i)
}

/// 道 → 値の並び（欄が無ければ None）と、並びを答える道か（[*]・[has=欄]）
fn walk<'a>(v: &'a Value, path: &str) -> (Vec<Option<&'a Value>>, bool) {
    let (mut cur, mut many) = (vec![Some(v)], false);
    for seg in path.split('.') {
        let (name, sel) = match seg.split_once('[') {
            Some((n, s)) => (n, Some(s.trim_end_matches(']'))),
            None => (seg, None),
        };
        let mut nxt = vec![];
        for c in cur {
            let x = c.and_then(|c| c.as_object()).and_then(|o| o.get(name));
            match (sel, x) {
                (None, _) | (_, None) => nxt.push(x),
                (Some("*"), Some(x)) => nxt.extend(x.as_array().unwrap().iter().map(Some)),
                (Some(s), Some(x)) if s.starts_with("has=") => {
                    nxt.extend(x.as_array().unwrap().iter().filter(|e| e.get(&s[4..]).is_some()).map(Some))
                }
                (Some(s), Some(x)) if s.starts_with("no=") => {
                    let n: i64 = s[3..].parse().unwrap();
                    nxt.extend(x.as_array().unwrap().iter().filter(|e| e["no"].as_i64() == Some(n)).map(Some))
                }
                (Some(s), Some(x)) => nxt.push(x.get(s.parse::<usize>().unwrap())),
            }
        }
        many = many || sel.is_some_and(|s| s == "*" || s.starts_with("has="));
        cur = nxt;
    }
    (cur, many)
}

/// Python の round(a - b, places) == 0
fn close(a: Option<&Value>, b: Option<&Value>, places: i32) -> bool {
    match (a.and_then(Value::as_f64), b.and_then(Value::as_f64)) {
        (Some(a), Some(b)) => a.is_finite() && ((a - b) * 10f64.powi(places)).round() == 0.0,
        _ => false,
    }
}

/// Python の ==（数は値で比べる: 610.0 == 610。真偽と数は分ける）
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q)),
        _ => a == b,
    }
}

#[test]
fn the_window_satisfies_the_human_table() {
    let table: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/calc_cases.json")).unwrap();
    let masters = Masters::new(rows("equipment_master.json"), rows("roll_master.json")).expect("同梱のマスタ");
    let cases = table["cases"].as_array().unwrap();
    let results: Vec<(String, Value)> = cases
        .iter()
        .map(|c| {
            let name = c["name"].as_str().unwrap().to_string();
            let cfg = c.get("cfg").cloned().unwrap_or(json!({}));
            let r =
                calculate(&cfg, &masters, &lot_of(&c["lot"]), &inputs_of(c)).unwrap_or_else(|e| panic!("{name}: 窓が計算できない {e:?}"));
            // 画面へ返す字（NaN は null・大きな整数は桁のまま）にしてから比べる
            (name, serde_json::from_slice(&da_core::held::reply_bytes(&r)).unwrap())
        })
        .collect();
    let of = |name: &str| &results.iter().find(|(n, _)| n == name).unwrap_or_else(|| panic!("事例 {name} が無い")).1;
    let (mut bad, mut n) = (vec![], 0);
    for c in cases {
        let name = c["name"].as_str().unwrap();
        let res = of(name);
        for ch in c["checks"].as_array().unwrap() {
            n += 1;
            let (path, op) = (ch[0].as_str().unwrap(), ch[1].as_str().unwrap());
            let (got, many) = walk(res, path);
            let one = got.first().copied().flatten();
            let listed = Value::Array(got.iter().map(|x| x.cloned().unwrap_or(Value::Null)).collect());
            let ok = match op {
                "~" => close(one, Some(&ch[2]), 6),
                "!~" => !close(one, Some(&ch[2]), 3),
                "=" => same(if many { &listed } else { one.unwrap_or(&Value::Null) }, &ch[2]) && (many || one.is_some()),
                ">" => got.iter().all(|x| x.and_then(Value::as_f64).is_some_and(|v| v > ch[2].as_f64().unwrap())),
                "null" => one == Some(&Value::Null),
                "absent" => got.iter().all(Option::is_none),
                "~path" => close(one, walk(res, ch[2].as_str().unwrap()).0.first().copied().flatten(), 6),
                "~case" | "!=case" => {
                    let other = walk(of(ch[2].as_str().unwrap()), ch[3].as_str().unwrap()).0.first().copied().flatten();
                    if op == "~case" {
                        close(one, other, 6)
                    } else {
                        one != other
                    }
                }
                x => panic!("知らない比べ方 {x}"),
            };
            if !ok {
                bad.push(format!("{name}: {path} {op} {}: 窓 {listed}", Value::Array(ch.as_array().unwrap()[2..].to_vec())));
            }
        }
    }
    assert!(cases.len() >= 30 && n >= 90, "事例が少ない: {} 件・確かめ {n}", cases.len());
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
