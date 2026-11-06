//! 名前の比べ方（access::py_key・normalize_part: NFKC・前後の空白を除く・大文字）が Python 3.13 の services/identity.normalize_part と
//! 同じ答えか（版 3.79.0）。窓の std と unicode-normalization は Python より新しい Unicode の表を持つので、Python でまだ割り当てのない字と
//! 窓だけが大文字の対を持つ字（access::KEY_SPLIT。program/tools/key-split-table.py が焼く）はそのまま残す。ここでは
//! ①全部の字で答えが同じ ②表が「Python で割り当てのない字＋窓の素の NFKC・大文字が 1 字で割れる字」に過不足なく合う ③並びの例で答えが同じ、
//! を確かめる。Rust や crate の版を上げて割れる字が増えたら ①② が落ちて、表を焼き直す（ASSIGNED_SPLIT に足す）ことを知らせる

mod common;

use da_core::access::{is_key_split, normalize_part, py_key};
use serde_json::json;
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;

/// 表を使わない素の比べ方（前の版の窓。表に入れる字を見つけるため）
fn raw_key(s: &str) -> String {
    let n: String = s.nfkc().collect();
    n.trim_matches(|c: char| c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)).to_uppercase()
}

#[test]
fn name_keys_match_python() {
    let oracle = common::python_json("name_key_oracle.py", &[]);
    let py: HashMap<u32, String> =
        oracle["changed"].as_array().unwrap().iter().map(|x| (x[0].as_u64().unwrap() as u32, x[1].as_str().unwrap().to_string())).collect();
    assert!(py.len() > 6000, "Python の答えが少ない: {}", py.len());
    let unassigned: Vec<(u32, u32)> =
        oracle["unassigned"].as_array().unwrap().iter().map(|r| (r[0].as_u64().unwrap() as u32, r[1].as_u64().unwrap() as u32)).collect();
    let (mut wrong, mut table, mut raw_split) = (vec![], vec![], 0);
    for cp in 0u32..0x110000 {
        let Some(c) = char::from_u32(cp) else { continue };
        let s = c.to_string();
        let want = py.get(&cp).cloned().unwrap_or_else(|| s.clone());
        if normalize_part(Some(&json!(s))) != want {
            wrong.push(format!("U+{cp:04X}"));
        }
        let cn = unassigned.iter().any(|(a, b)| (*a..=*b).contains(&cp));
        let one = raw_key(&s) != want;
        raw_split += one as usize;
        if is_key_split(c) != (cn || one) {
            table.push(format!("U+{cp:04X}"));
        }
    }
    assert!(raw_split > 0, "素の比べ方で割れる字が 1 つも無い（Python {}）: 表を見直す", oracle["python"]);
    assert!(
        wrong.is_empty(),
        "Python と答えが違う字 {} 字（表を焼き直す）: {}",
        wrong.len(),
        wrong.iter().take(20).cloned().collect::<Vec<_>>().join(" ")
    );
    assert!(
        table.is_empty(),
        "表と Python（Unicode {}）の割り当て・1 字の割れが合わない {} 字（program/tools/key-split-table.py の ASSIGNED_SPLIT を直して焼き直す）: {}",
        oracle["unicode"],
        table.len(),
        table.iter().take(20).cloned().collect::<Vec<_>>().join(" ")
    );
    let mut bad = vec![];
    for x in oracle["samples"].as_array().unwrap() {
        let (t, want) = (x[0].as_str().unwrap(), x[1].as_str().unwrap());
        if py_key(t) != want {
            bad.push(format!("{t:?}: Python {want:?} / 窓 {:?} / 素 {:?}", py_key(t), raw_key(t)));
        }
    }
    assert!(bad.is_empty(), "並びの例で答えが違う:\n{}", bad.join("\n"));
}
