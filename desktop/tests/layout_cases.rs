//! ダッシュボードの中身の確かめ（src/layout_clean.rs）が、Python の clean_layout・clean_hide_body・condition_of と同じ答えか（版 3.81.0）。
//! 答えは program/tools/layout-cases.py が Python で焼いた事例の表（program/tests/fixtures/layout_cases.json）。入力は送った順のまま JSON の字で持ち、
//! 窓は送った順を保つ木（jsontree）で読んで確かめる。中身（値）と置く字（json.dumps(sort_keys=True)）と、誤りの理由を突き合わせる。
//! "py" の印の事例と、Python が道の外の例外で落ちる事例（crash）は、窓が答えず Python に任せる（Stop::Py）こと

use da_core::jsontree::Tree;
use da_core::layout_clean::{clean_hide_body, clean_layout, condition_of, Stop};
use serde_json::Value;

#[test]
fn layout_checks_answer_like_python() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixtures/layout_cases.json");
    let table: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let cases = table["cases"].as_array().unwrap();
    assert!(cases.len() >= 80, "事例が少ない: {}", cases.len());
    let mut bad = vec![];
    let (mut answered, mut delegated) = (0, 0);
    for (i, c) in cases.iter().enumerate() {
        let input = Tree::parse(c["in"].as_str().unwrap()).expect("入力の字");
        let got = match c["fn"].as_str().unwrap() {
            "layout" => clean_layout(&input),
            "hide" => clean_hide_body(&input),
            _ => {
                let Tree::Arr(rows) = &input else { panic!("行の並び") };
                condition_of(rows, c["key"].as_str().unwrap()).map(|v| {
                    let t = da_core::join::py_dumps(&v);
                    (v, t)
                })
            }
        };
        let want = &c["want"];
        let must_delegate = c["py"] == true || want.get("crash").is_some();
        let label = format!("[{i}] {} {}", c["fn"], c["in"].as_str().unwrap().chars().take(120).collect::<String>());
        match got {
            Err(Stop::Py) => {
                delegated += 1;
                if !must_delegate {
                    bad.push(format!("{label}: 窓が答えない（Python の答え {}）", want.to_string().chars().take(300).collect::<String>()));
                }
            }
            _ if must_delegate => bad.push(format!("{label}: 窓が答えた（Python に任せるはず。Python {want}）")),
            Err(Stop::Layout(m)) => {
                answered += 1;
                if want["error"].as_str() != Some(m.as_str()) {
                    bad.push(format!("{label}: Python {want} / 窓 誤り {m}"));
                }
            }
            Ok((v, t)) => {
                answered += 1;
                let (wv, wt) = (&want["ok"][0], want["ok"][1].as_str());
                if wt != Some(t.as_str()) || wv != &v {
                    bad.push(format!("{label}:\n  Python {}\n  窓     {t}", wt.unwrap_or("(誤り)")));
                }
            }
        }
    }
    assert!(answered >= 65 && delegated >= 10, "答えた {answered}・任せた {delegated}");
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
