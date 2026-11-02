//! 計算列の式（src/formula.rs）が、画面の式（program/app/static/js/list-formula.js）と同じ答えを出すか（評価関数。版 3.59.0）。
//!
//! 画面の答えは事例表（program/tests/fixtures/formula_cases.json。program/tools/formula-cases.py が node で作る）に焼き付けてあり、
//! node・Python 無しで突き合わせる。Python（tests/test_formula_parity.py）も同じ表と突き合わせるので、表が 3 つの実装の約束になる。
//! 答え（数・字・空）と、その字（String(値)）と、読めない式の理由が全部合えば通る（壊れた正規表現の理由の後半は仕組みの言葉なので前半だけ）。

use da_core::formula::{check, js_num_text, text_of, Formula, Tables, V};
use serde_json::Value;

const CASES: &str = include_str!("../../program/tests/fixtures/formula_cases.json");
const RE_HEAD: &str = "の正規表現として読めません: ";

/// 事例表の字（{"utf16": [単位]} は片割れのサロゲートを含む字）→ UTF-16 の単位
fn units(v: &Value) -> Option<Vec<u16>> {
    match v {
        Value::String(s) => Some(s.encode_utf16().collect()),
        Value::Object(o) => o.get("utf16")?.as_array().map(|a| a.iter().map(|x| x.as_u64().unwrap_or(0) as u16).collect()),
        _ => None,
    }
}

fn row_value(v: &Value) -> V {
    match v {
        Value::Null => V::Null,
        Value::Number(n) => V::Num(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => V::text(s),
        other => V::text(&other.to_string()),
    }
}

/// Rust の答えが、画面の答え js と同じか（違えば理由）
fn differs(expr: &str, row: &serde_json::Map<String, Value>, js: &Value, tables: &Tables) -> Option<String> {
    let ok = js["ok"].as_bool().unwrap_or(false);
    match check(expr) {
        Err(e) => {
            if ok {
                return Some(format!("Rust は読めない（{}）が画面は読める", e.message()));
            }
            let want = units(&js["error"]).unwrap_or_default();
            let (want, got) = (String::from_utf16_lossy(&want), e.message());
            let same = want == got || (want.contains(RE_HEAD) && want.split(RE_HEAD).next() == got.split(RE_HEAD).next());
            (!same).then(|| format!("理由が違う: 画面「{want}」・Rust「{got}」"))
        }
        Ok(_) if !ok => Some(format!("画面は読めない（{}）が Rust は読める", js["error"])),
        Ok(_) => {
            let v = Formula::compile(expr).ok()?.run(&|c| row.get(c).map(row_value).unwrap_or(V::Null), tables);
            let text = text_of(&v).into_owned();
            let want_text = units(&js["text"]).unwrap_or_default();
            let same = match (&v, &js["value"]) {
                (V::Null, Value::Null) => true,
                (V::Num(f), Value::Number(n)) => *f == n.as_f64().unwrap_or(f64::NAN),
                (V::Num(f), Value::String(s)) if !f.is_finite() => *s == format!("#{}", js_num_text(*f)),
                (V::Str(s), w) => units(w).is_some_and(|w| w == s.to_vec()),
                _ => false,
            } && text == want_text;
            (!same).then(|| format!("答えが違う: 画面 {} ／ Rust {:?}（字「{}」）", js, v, String::from_utf16_lossy(&text)))
        }
    }
}

#[test]
fn rust_gives_the_same_answer_as_the_screen() {
    let d: Value = serde_json::from_str(CASES).expect("事例表を読めません");
    let tables = Tables::from_json(&d["tables"]);
    let cases = d["cases"].as_array().expect("cases");
    let empty = serde_json::Map::new();
    let bad: Vec<String> = cases
        .iter()
        .filter_map(|c| {
            let expr = c["expr"].as_str().unwrap_or("");
            let row = c["row"].as_object().unwrap_or(&empty);
            differs(expr, row, &c["js"], &tables).map(|why| format!("  {expr:?} 行 {}\n    {why}", c["row"]))
        })
        .collect();
    assert!(cases.len() > 3000, "事例が少なすぎる（{} 件）", cases.len());
    assert!(
        bad.is_empty(),
        "{} / {} 件が画面と食い違い。最初の 10 件:\n{}",
        bad.len(),
        cases.len(),
        bad.iter().take(10).cloned().collect::<Vec<_>>().join("\n")
    );
}
