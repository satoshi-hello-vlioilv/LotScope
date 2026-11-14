//! 置き場の読めない行を隔てる決まり（版 3.107.0。src/row_check.rs と src/held.rs）を、人が仕様から書いた事例の表
//! program/tests/fixtures/row_cases.json と突き合わせる（Python は program/tests/test_row_cases.py が同じ表を読む）。

use da_core::row_check;
use serde_json::{json, Value};

#[test]
fn rows_are_isolated_like_the_table() {
    let table: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/row_cases.json")).unwrap();
    let mut bad = vec![];
    for c in table["cases"].as_array().unwrap() {
        let master = c["master"].as_str().unwrap();
        let mut rows = vec![da_core::held::parse(c["raw"].as_str().unwrap()).expect("raw は J で読める")];
        row_check::normalize_like_specs(master, &mut rows);
        let iso = row_check::check(master, &rows, row_check::fields_of(master));
        let got = iso.first().map(|(_, _, w)| json!(w)).unwrap_or(Value::Null);
        if got != c["why"] {
            bad.push(format!("{}: 窓 {got}（表 {}）", c["name"], c["why"]));
        }
        // 行の目印（何行目かで消す道の確かめ。版 3.108.0 の作った後の採点の割れ 4。形をそろえる前の行から）
        if let Some(want) = c.get("key").and_then(Value::as_str) {
            let raw = da_core::held::parse(c["raw"].as_str().unwrap()).unwrap();
            if row_check::row_key(master, &raw) != want {
                bad.push(format!("{}: 目印は窓 {}（表 {want}）", c["name"], row_check::row_key(master, &raw)));
            }
        }
        // 隔てない行の、名前の列・字だけの列の字でない値は str() で読む（Python の row_check.coerce と同じ）
        if let Some(want) = c.get("coerced").and_then(Value::as_object) {
            let got = row_check::coerce(master, &rows[0]);
            for (k, w) in want {
                if &got[k.as_str()] != w {
                    bad.push(format!("{}: {k} は窓 {}（表 {w}）", c["name"], got[k.as_str()]));
                }
            }
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

#[test]
fn next_id_counts_isolated_rows() {
    // 次の id は隔てた行の id も int() が読めれば数える（Python の master_store.next_id と同じ）
    use da_core::master_store::next_id;
    assert_eq!(next_id(&[json!({"id": 1}), json!({"id": "4"}), json!({"id": "abc"}), json!({"id": ["x"]})]), json!(5));
    assert_eq!(next_id(&[json!({"id": 1e19})]), json!(10000000000000000001u64));
    assert_eq!(next_id(&[json!({"id": true}), json!({"id": null})]), json!(2));
}

/// 置き場の行・設定・控えの形（版 3.113.0。採点の指摘 1）: 人が仕様から書いた正しい答えと版 3.112.0 の Python の答え（py）を並べた
/// program/tests/fixtures/rowshape_cases.json を、窓が正しい答えのとおりに答えるか（Python は tests/test_row_cases.py の RowShape）
#[test]
fn rowshape_like_the_table() {
    let text = include_str!("../../program/tests/fixtures/rowshape_cases.json");
    let t = da_core::held::parse(text).expect("表は J で読める（対の無い代用字の \\udXXX）");
    let why_of = |master: &str, raw: &Value| -> Value {
        let mut rows = vec![raw.clone()];
        row_check::normalize_like_specs(master, &mut rows);
        let iso = row_check::check(master, &rows, row_check::fields_of(master));
        iso.first().map(|(_, _, w)| json!(w)).unwrap_or(Value::Null)
    };
    let mut bad = vec![];
    for c in t["rows"].as_array().unwrap() {
        let (name, master) = (c["name"].as_str().unwrap(), c["master"].as_str().unwrap());
        let raw = da_core::held::parse(c["raw"].as_str().unwrap()).unwrap();
        let why = why_of(master, &raw);
        if why != c["why"] {
            bad.push(format!("{name}: 窓 {why}（表 {}）", c["why"]));
        }
        if why.is_null() {
            if let Some(want) = c.get("view").and_then(Value::as_object) {
                let got = da_core::bundle::conv_views(std::slice::from_ref(&raw)).expect("読める行は組める");
                for (k, w) in want {
                    if &got[0][k] != w {
                        bad.push(format!("{name}: view の {k} = {}（表 {w}）", got[0][k]));
                    }
                }
            }
        }
    }
    for c in t["worklog"].as_array().unwrap() {
        let raw = da_core::held::parse(c["raw"].as_str().unwrap()).unwrap();
        let why = why_of("work_log_files", &raw);
        let got = (why.clone(), raw.is_object(), !why.is_null());
        if got != (c["why"].clone(), c["listed"] == true, c["skipped"] == true) {
            bad.push(format!("{}: 窓 {got:?}（表 {} {} {}）", c["name"], c["why"], c["listed"], c["skipped"]));
        }
    }
    for c in t["sources"].as_array().unwrap() {
        let raw = da_core::held::parse(c["raw"].as_str().unwrap()).unwrap();
        let why = why_of("data_sources", &raw);
        if why != c["why"] {
            bad.push(format!("{}: 窓 {why}（表 {}）", c["name"], c["why"]));
        }
        if let Some(want) = c.get("joins") {
            let got = da_core::bundle::joins_value(raw.get("結合"));
            if got.as_ref() != Some(want) {
                bad.push(format!("{}: 結合 {got:?}（表 {want}）", c["name"]));
            }
        }
    }
    let dir = std::env::temp_dir().join(format!("da-rowshape-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    for c in t["keymap"].as_array().unwrap() {
        let p = dir.join("lotdsp_api_map.json");
        std::fs::write(&p, da_core::held::to_text(&c["data"], None)).unwrap();
        let st = da_core::lotdsp::KeyMap::load(&p).status(true);
        let got = json!({"ready": st["ready"], "missing": st["missing"], "learned": st["learned"]});
        if got != c["want"] {
            bad.push(format!("{}: 窓 {got}（表 {}）", c["name"], c["want"]));
        }
    }
    for c in t["seconds"].as_array().unwrap() {
        let raw: Value = serde_json::from_str(c["raw"].as_str().unwrap()).unwrap();
        let got = da_core::lotdsp::py_float_of(raw.get("timeout_seconds"), 60.0);
        if Some(got) != c["want"].as_f64() {
            bad.push(format!("{}: 窓 {got}（表 {}）", c["name"], c["want"]));
        }
    }
    let reply = |v: &Value| String::from_utf8(da_core::held::reply_bytes(v)).unwrap();
    for c in t["uistate"].as_array().unwrap() {
        let (name, w) = (c["name"].as_str().unwrap(), &c["want"]);
        let local = dir.join("ui");
        std::fs::create_dir_all(&local).unwrap();
        std::fs::write(da_core::presence::ui_state::path(&local), c["text"].as_str().unwrap()).unwrap();
        let got = da_core::presence::ui_state::load(&local);
        if reply(&got["rev"]) != w["rev"].as_str().unwrap() || got["keys"] != w["keys"] {
            bad.push(format!("{name}: 読み {}（表 {} {}）", reply(&got), w["rev"], w["keys"]));
        }
        let r = da_core::presence::ui_state::post(&local, br#"{"changed": {"tpa.x": "1"}}"#);
        let after = da_core::held::parse(&std::fs::read_to_string(da_core::presence::ui_state::path(&local)).unwrap()).unwrap();
        let kept: Vec<&String> = after["keys"].as_object().map(|o| o.keys().collect()).unwrap_or_default();
        let want_kept: Vec<&str> = w["kept"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
        let rev = r.as_ref().map(|(s, v)| format!("{s} {}", reply(&v["rev"])));
        if rev != Some(format!("200 {}", w["postRev"].as_str().unwrap()))
            || reply(&after["rev"]) != w["postRev"].as_str().unwrap()
            || kept != want_kept
        {
            bad.push(format!("{name}: 書き {rev:?} {kept:?}（表 {} {want_kept:?}）", w["postRev"]));
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    assert!(bad.is_empty(), "{} 件違います:\n{}", bad.len(), bad.join("\n"));
    for part in ["rows", "worklog", "sources", "keymap", "seconds", "uistate"] {
        assert!(t[part].as_array().unwrap().iter().all(|c| c["py"].as_str().is_some_and(|p| !p.is_empty())), "{part} の py");
    }
}
