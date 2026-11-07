//! 設定の束（版 3.84.0）: 窓（src/bundle.rs）が自分で組んだ束が、Python の道（routes/lotlist.py の GET /api/lotlist/settings）の答えと
//! 同じか。program/tests/settings_oracle.py が場面ごとのフォルダ（配った設定・共有・作業場所・同梱の data/）を作って Python に尋ね、
//! 尋ねる前の形に戻す。窓は同じフォルダから束を組み、答えを 1 字ずつ突き合わせる（conversions.rev は窓と Python で別の字なので比べない）。
//! "delegate" の場面は窓が組まずに Python に尋ねること、"pyFollows" の場面は窓が同じ置き場へ引っ越しの印をたどり、この PC の覚えに書くことを見る。

mod common;

use da_core::bundle::{Builder, Env};
use serde_json::Value;
use std::path::PathBuf;

#[test]
fn bundle_is_built_like_python() {
    let work = common::work("bundle");
    let o = common::python_json("settings_oracle.py", &[work.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut same, mut delegated) = (0, 0);
    for sc in o["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        for (k, v) in sc["vars"].as_object().unwrap() {
            // SAFETY: この試験の糸だけが環境を変える（ほかの試験はこの名前を読まない）
            unsafe { std::env::set_var(k, v.as_str().unwrap()) };
        }
        let e = &sc["env"];
        let p = |k: &str| PathBuf::from(e[k].as_str().unwrap());
        let b = Builder::new(Env {
            base: p("base"),
            program: p("program"),
            local: p("local"),
            config: p("config"),
            now: e["now"].as_str().map(String::from),
        });
        let got = b.build();
        for k in sc["vars"].as_object().unwrap().keys() {
            unsafe { std::env::remove_var(k) };
        }
        if sc["expect"] == "delegate" {
            delegated += 1;
            if let Ok(v) = got {
                bad.push(format!("{name}: 窓が組んだ（Python に尋ねるはず）: {}", v.to_string().chars().take(200).collect::<String>()));
            }
            continue;
        }
        same += 1;
        let mut want = sc["answer"].clone();
        let mut got = match got {
            Ok(v) => v,
            Err(e) => {
                bad.push(format!("{name}: 窓が組めない（{}）", e.0));
                continue;
            }
        };
        assert!(got["conversions"]["rev"].is_string(), "{name}: 変換表の版の印が無い");
        for v in [&mut want, &mut got] {
            v["conversions"]["rev"] = Value::Null;
        }
        if let Some(d) = common::diff(&want, &got, "") {
            bad.push(format!("{name}: {d}"));
        }
        if sc["pyFollows"] == true {
            let over: Value =
                serde_json::from_slice(&std::fs::read(p("local").join("master_share.json")).unwrap_or_default()).unwrap_or(Value::Null);
            if over["dir"] != sc["override"]["dir"] {
                bad.push(format!("{name}: この PC の覚えの置き場 {} / Python {}", over["dir"], sc["override"]["dir"]));
            }
            let (h, ph) = (over["history"].as_array().map(Vec::len), sc["override"]["history"].as_array().map(Vec::len));
            if h != ph {
                bad.push(format!("{name}: 覚えの履歴の数 {h:?} / Python {ph:?}"));
            }
            // 2 回目は印をたどらない（同じ置き場が履歴に 2 回載らない）
            let again = b.build();
            let over2: Value =
                serde_json::from_slice(&std::fs::read(p("local").join("master_share.json")).unwrap_or_default()).unwrap_or(Value::Null);
            if again.is_err() || over2["history"] != over["history"] {
                bad.push(format!("{name}: 2 回目の束で覚えが変わった"));
            }
        }
    }
    // 組む速さ（ふつうの場面を 20 回。中央値。Python の束は約 2〜3 ms）
    let first = &o["scenarios"][0]["env"];
    let p = |k: &str| PathBuf::from(first[k].as_str().unwrap());
    let b = Builder::new(Env { base: p("base"), program: p("program"), local: p("local"), config: p("config"), now: None });
    let mut ms: Vec<f64> = (0..20)
        .map(|_| {
            let t = std::time::Instant::now();
            let _ = b.build();
            t.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    eprintln!("窓が束を組む時間（中央値）: {:.2} ms", ms[10]);
    assert!(same >= 9 && delegated >= 5, "場面が足りません: 同じ {same}・任せる {delegated}");
    assert!(bad.is_empty(), "{} か所違います:\n{}", bad.len(), bad.join("\n"));
}
