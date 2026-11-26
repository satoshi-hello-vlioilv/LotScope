//! ルールで作る列（版 3.123.0。表示列の窓の「≡ ルールで作る」）を、窓が画面と同じ値で数えるか（評価関数）。
//!
//! 画面はルール（条件 → 値・色）を同じ意味の式（lotlist-rules.js の formulaOf。この列＝空欄）にして窓へ送り、窓はその式で
//! 並べ替え・値で絞る・スライサー・集計表を数える（src/formula.rs）。事例の表（program/tests/fixtures/rule_formula_cases.json）は
//! 人が仕様から書いた行ごとの答え（want）と、画面が作った式（expr。凍った答え）を持つ。ここでは窓の式で expr を動かし、
//! want と同じかを見る（画面の側は node program/tools/rule-formula-check.mjs が同じ表で、画面の式とセルの道の答えを見る）。
//! 読めないルール（壊れた正規表現・知らない比べ方・読めない式の条件・読めない出す値の式）と空のルールも、式は読めて空欄か既定の値になる。

use da_core::formula::{check, text_of, Formula, Tables, V};
use serde_json::Value;

const CASES: &str = include_str!("../../program/tests/fixtures/rule_formula_cases.json");

fn row_value(v: &Value) -> V {
    match v {
        Value::Null => V::Null,
        Value::Number(n) => V::Num(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => V::text(s),
        other => V::text(&other.to_string()),
    }
}

fn table() -> Value {
    serde_json::from_str(CASES).expect("事例の表を読めません")
}

/// 表の 1 件を窓の式で数えた答え（行ごとの字）
fn answers(expr: &str, rows: &[Value]) -> Vec<String> {
    let tables = Tables::from_json(&Value::Null);
    let f = Formula::compile(expr).unwrap_or_else(|e| panic!("式が読めない（{}）: {expr}", e.message()));
    rows.iter()
        .map(|row| {
            let row = row.as_object().expect("行");
            let v = f.run(&|c| row.get(c).map(row_value).unwrap_or(V::Null), &tables);
            String::from_utf16_lossy(&text_of(&v))
        })
        .collect()
}

#[test]
fn the_window_counts_rule_columns_like_the_screen() {
    let d = table();
    let rows = d["rows"].as_array().expect("rows");
    let cases = d["cases"].as_array().expect("cases");
    assert!(cases.len() >= 10 && rows.len() >= 8, "事例が少なすぎる（{} 件・{} 行）", cases.len(), rows.len());
    let mut bad = Vec::new();
    for c in cases {
        let (name, expr) = (c["name"].as_str().unwrap_or(""), c["expr"].as_str().unwrap_or(""));
        if let Err(e) = check(expr) {
            bad.push(format!("{name}: 窓が式を読めない（{}）: {expr}", e.message()));
            continue;
        }
        let want: Vec<String> = c["want"].as_array().expect("want").iter().map(|w| w.as_str().unwrap_or("").to_string()).collect();
        let got = answers(expr, rows);
        for (i, (g, w)) in got.iter().zip(&want).enumerate() {
            if g != w {
                bad.push(format!("{name}: 行 {}（{}）窓 {g:?} ≠ 表 {w:?}", i + 1, rows[i]["ロット番号"]));
            }
        }
    }
    assert!(bad.is_empty(), "{} か所が食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 空のルール（行が無い）は式 '' で、どの行も空欄。読めないルールの部分は式に入らない（式全体は読める）
#[test]
fn empty_and_unreadable_rules_still_give_a_readable_formula() {
    let d = table();
    let rows = d["rows"].as_array().expect("rows");
    let by = |n: &str| {
        d["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"].as_str().unwrap_or("").starts_with(n))
            .cloned()
            .unwrap_or_else(|| panic!("事例「{n}」が無い"))
    };
    let empty = by("空のルール");
    assert_eq!(empty["expr"], "''", "空のルールの式");
    assert!(answers("''", rows).iter().all(|s| s.is_empty()));
    for n in ["読めない正規表現", "知らない比べ方", "読めない式の条件", "読めない出す値の式"] {
        let c = by(n);
        let expr = c["expr"].as_str().unwrap_or("");
        assert!(check(expr).is_ok(), "「{n}」の式が読めない: {expr}");
        assert!(!c["notesHave"].as_array().map(|a| a.is_empty()).unwrap_or(true), "「{n}」に知らせの言葉が無い");
    }
    // 並べ替えの順（窓は答えの字で並べる）: 管理区分の答えを並べると、3 つの値が群れになる
    let c = by("管理区分");
    let mut got = answers(c["expr"].as_str().unwrap(), rows);
    got.sort();
    got.dedup();
    assert_eq!(got, vec!["3000系", "5052厚板", "その他"]);
}
