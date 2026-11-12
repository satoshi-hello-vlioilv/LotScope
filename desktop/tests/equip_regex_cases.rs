//! 設備グループの正規表現（版 3.102.0）: 窓（src/equip_regex.rs の判定と、src/pivot.rs の compile_rules〈fancy-regex の (?i)〉の当たり）が、
//! 事例の表 program/tests/fixtures/equip_regex_cases.json（program/tools/equip-regex-cases.py が仕様と同梱と同じ Python の re から作る）と
//! 同じか。Python は tests/test_equip_regex.py が同じ表を読む。Python に頼らない（表を読むだけ）ので Windows の CI でも流れる。

use da_core::equip_regex::{check, why_of, Verdict};
use da_core::pivot::rules_match;
use serde_json::{json, Value};

#[test]
fn regex_rules_read_like_the_table() {
    let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/equip_regex_cases.json")).unwrap();
    let names: Vec<String> = t["names"].as_array().unwrap().iter().map(|n| n.as_str().unwrap().to_string()).collect();
    let mut bad = vec![];
    let (mut ok, mut refused) = (0, 0);
    for c in t["cases"].as_array().unwrap() {
        let p = c["pattern"].as_str().unwrap();
        let (v, why) = check(p);
        if v.name() != c["verdict"] || why != c["why"].as_str().unwrap() {
            bad.push(format!("{p:?}: 表 {} 「{}」 / 窓 {} 「{why}」", c["verdict"], c["why"].as_str().unwrap(), v.name()));
            continue;
        }
        if v != Verdict::Ok {
            refused += 1;
            assert!(!why_of(p).is_empty(), "{p:?}: 断る理由");
            // 当てない（ほかの決まりは当てる）: 名前で決まる決まりと並べて、正規表現の側だけが外れる
            let rules = json!([{"op": "regex", "value": p}, {"op": "equals", "value": "CAL"}]);
            for n in &names {
                if rules_match(&rules, n) != (n == "CAL") {
                    bad.push(format!("{p:?}: 当てない書き方が {n} に当たった"));
                }
            }
            continue;
        }
        ok += 1;
        let rules = json!([{"op": "regex", "value": p}]);
        let hits: Vec<bool> = names.iter().map(|n| rules_match(&rules, n)).collect();
        let want: Vec<bool> = c["hits"].as_array().unwrap().iter().map(|x| x.as_bool().unwrap()).collect();
        if hits != want {
            let which: Vec<&String> = names.iter().zip(hits.iter().zip(&want)).filter(|(_, (a, b))| a != b).map(|(n, _)| n).collect();
            bad.push(format!("{p:?}: Python の re と当たりが違う名前 {which:?}"));
        }
    }
    assert!(bad.is_empty(), "{} 件:\n{}", bad.len(), bad.join("\n"));
    assert!(ok >= 90 && refused >= 60, "表の数（ok {ok}・断る {refused}）");
}
