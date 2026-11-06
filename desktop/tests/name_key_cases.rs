//! 名前の比べ方（access::normalize_part: NFKC・前後の空白を除く・大文字）が Python 3.13 の services/identity.normalize_part と
//! 全部の字で同じか（版 3.79.0）。割れる字（Rust の std と unicode-normalization が Python の Unicode 15.1 より新しい表を持つ字）は、
//! みな access::key_split の表に入っていること（窓はその字を含む名前を比べる道を Python に任せる）を確かめる。
//! Rust や crate の版を上げて割れる字が増えたら、ここが落ちて表を足すことを知らせる

mod common;

use da_core::access::{key_split, normalize_part};
use serde_json::json;
use std::collections::HashMap;

#[test]
fn name_keys_split_only_where_the_window_hands_over() {
    let oracle = common::python_json("name_key_oracle.py", &[]);
    let py: HashMap<u32, String> =
        oracle["changed"].as_array().unwrap().iter().map(|x| (x[0].as_u64().unwrap() as u32, x[1].as_str().unwrap().to_string())).collect();
    assert!(py.len() > 6000, "Python の答えが少ない: {}", py.len());
    let (mut split, mut missing) = (0, vec![]);
    for cp in 0u32..0x110000 {
        let Some(c) = char::from_u32(cp) else { continue };
        let want = py.get(&cp).cloned().unwrap_or_else(|| c.to_string());
        if normalize_part(Some(&json!(c.to_string()))) != want {
            split += 1;
            if !key_split(&c.to_string()) {
                missing.push(format!("U+{cp:04X}"));
            }
        }
    }
    assert!(split > 0, "割れる字が 1 つも無い（Python {}）: 表を見直す", oracle["python"]);
    assert!(
        missing.is_empty(),
        "key_split の表に無い割れる字 {} 字（program/tools/key-split-table.py の ASSIGNED_SPLIT に足して焼き直す）: {}",
        missing.len(),
        missing.join(" ")
    );
    // 表は、Python でまだ割り当てのない字（並びで割れる形も閉じる）と、1 字で割れる字だけ（余分が無い。焼き直しを忘れていない）
    let unassigned: Vec<(u32, u32)> =
        oracle["unassigned"].as_array().unwrap().iter().map(|r| (r[0].as_u64().unwrap() as u32, r[1].as_u64().unwrap() as u32)).collect();
    let mut extra = vec![];
    for cp in 0u32..0x110000 {
        let Some(c) = char::from_u32(cp) else { continue };
        let cn = unassigned.iter().any(|(a, b)| (*a..=*b).contains(&cp));
        let one = normalize_part(Some(&json!(c.to_string()))) != py.get(&cp).cloned().unwrap_or_else(|| c.to_string());
        if key_split(&c.to_string()) != (cn || one) {
            extra.push(format!("U+{cp:04X}"));
        }
    }
    assert!(
        extra.is_empty(),
        "表と Python（Unicode {}）の割り当てが合わない {} 字（焼き直す）: {}",
        oracle["unicode"],
        extra.len(),
        extra.iter().take(20).cloned().collect::<Vec<_>>().join(" ")
    );
    // 並びで割れる形（1 字では割れない）: Python で割り当てのない字を含むので、窓は Python に任せる
    for s in ["\u{1611E}\u{1611E}", "a\u{0897}\u{0316}"] {
        assert!(key_split(s), "{s:?} は任せる");
    }
}
