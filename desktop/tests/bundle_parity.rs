//! 設定の束（版 3.84.0）: 窓（src/bundle.rs）が自分で組んだ束が、Python の道（routes/lotlist.py の GET /api/lotlist/settings）の答えと
//! 同じか。program/tests/settings_oracle.py が場面ごとのフォルダ（配った設定・共有・作業場所・同梱の data/）を作って Python に尋ね、
//! 尋ねる前の形に戻す。窓は同じフォルダから束を組み、答えを 1 字ずつ突き合わせる（conversions.rev は窓と Python で別の字なので比べない）。
//! "delegate" の場面は窓が組まずに Python に尋ねること（束の材料を組めない）、"seed" の場面（版 3.105.0）は共有にまだ無いマスタに窓も
//! Python と同じ最初の版を置いてから組み、束も置いた中身も Python と同じこと、"broken:節,…" の場面は窓がその節だけを
//! 理由つきで組まず、ほかの節は Python と同じに組むこと（版 3.102.0）、"pyFollows" の場面は窓が同じ置き場へ引っ越しの印をたどり、
//! この PC の覚えに書くことを見る。

mod common;

use da_core::bundle::{Builder, Env};
use serde_json::Value;
use std::path::PathBuf;

#[test]
fn bundle_is_built_like_python() {
    let work = common::work("bundle");
    let o = common::python_json("settings_oracle.py", &[work.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut same, mut delegated, mut broken_n, mut seeded) = (0, 0, 0, 0);
    for sc in o["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let saved: Vec<(String, Option<String>)> =
            sc["vars"].as_object().unwrap().keys().map(|k| (k.clone(), std::env::var(k).ok())).collect();
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
        // 版 3.105.0: 共有にまだ無いマスタ（種まき）。窓は束を組むとき（Builder::inputs が置き場の書く係を覚えさせ、節の確かめが Place::seed で
        // 置く）に Python と同じ最初の版を置くので、束は種まきの要る節を言わずに Python と同じ。置いたファイルも同じ中身。窓だけが置いてよいのは、
        // どの問い合わせでも読む門番の権限 2 つ（bundle::EVERY_READ。Python の束の道は門番を通らない）
        let seed_why = (sc["expect"] == "seed").then(|| {
            let mut why = vec![];
            if got.as_ref().is_ok_and(|v| v["broken"].as_object().is_some_and(|m| m.values().any(|w| w["seed"] == true))) {
                why.push(format!("{name}: 窓が種をまかずに種まきの要る節を言った"));
            }
            let share = p("base").parent().unwrap().join("share");
            let strip = |v: &Value| {
                let mut v = v.clone();
                if let Some(o) = v.as_object_mut() {
                    o.remove("updated_at");
                }
                v
            };
            for (f, want) in sc["shareAfter"].as_object().expect("Python が置いた物") {
                let mine = std::fs::read(share.join(f)).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(Value::Null);
                if let Some(d) = common::diff(&strip(want), &strip(&mine), f) {
                    why.push(format!("{name}: 置いた最初の版 {d}"));
                }
            }
            for e in std::fs::read_dir(&share).unwrap().flatten() {
                let f = e.file_name().to_string_lossy().into_owned();
                let every = da_core::bundle::EVERY_READ.iter().any(|n| f == format!("{n}.json"));
                if !sc["shareAfter"].as_object().unwrap().contains_key(&f) && !every {
                    why.push(format!("{name}: 窓だけが置いた {f}"));
                }
            }
            why
        });
        for (k, v) in &saved {
            // 場面の前の値へ戻す（名乗りの環境はほかの場面にも効く）
            match v {
                Some(v) => unsafe { std::env::set_var(k, v) },
                None => unsafe { std::env::remove_var(k) },
            }
        }
        if let Some(want) = sc["expectOverride"].as_str() {
            let over: Value =
                serde_json::from_slice(&std::fs::read(p("local").join("master_share.json")).unwrap_or_default()).unwrap_or(Value::Null);
            if over["dir"].as_str() != Some(want) {
                bad.push(format!("{name}: 窓が束を組めなくても引っ越しの印をたどるはず（覚えの置き場 {}）", over["dir"]));
            }
        }
        if let Some(why) = seed_why {
            seeded += 1;
            bad.extend(why);
        }
        if sc["expect"] == "delegate" {
            delegated += 1;
            // 窓が束を Python に尋ねる形: 材料を組めない（Err）か、種まきの要る節がある（Lot::settings が Python に尋ねる）
            let seed = got.as_ref().is_ok_and(|v| v["broken"].as_object().is_some_and(|m| m.values().any(|w| w["seed"] == true)));
            if let (Ok(v), false) = (&got, seed) {
                bad.push(format!("{name}: 窓が組んだ（Python に尋ねるはず）: {}", v.to_string().chars().take(200).collect::<String>()));
            }
            continue;
        }
        if let Some(want_broken) = sc["expect"].as_str().and_then(|e| e.strip_prefix("broken:")) {
            broken_n += 1;
            let Ok(mut got) = got else {
                bad.push(format!("{name}: 窓が束を組めない（{} の節だけ組まないはず）", want_broken));
                continue;
            };
            let keys: Vec<String> = got["broken"].as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default();
            let mut want_keys: Vec<String> = want_broken.split(',').map(String::from).collect();
            want_keys.sort();
            if keys != want_keys {
                bad.push(format!("{name}: 組まない節 {keys:?} / 仕様 {want_keys:?}（{}）", got["broken"]));
            }
            for (k, w) in got["broken"].as_object().into_iter().flatten() {
                if w["why"].as_str().is_none_or(str::is_empty) || w["seed"] == true {
                    bad.push(format!("{name}: 節 {k} の理由が無い・種まきになった: {w}"));
                }
            }
            // ほかの節は Python と同じ（Python の答えが JSON で渡せたとき）
            let mut want = sc["answer"].clone();
            if !want.is_null() {
                for v in [&mut want, &mut got] {
                    v["conversions"]["rev"] = Value::Null;
                    v["broken"] = Value::Null;
                    for k in &want_keys {
                        match k.as_str() {
                            "lot_list" => {
                                for f in ["source", "refresh_seconds", "stale_hours", "table", "page_size"] {
                                    v[f] = Value::Null;
                                }
                            }
                            "conversions" => v["conversions"]["tables"] = Value::Null,
                            k => v["lists"][k] = Value::Null,
                        }
                    }
                }
                if let Some(d) = common::diff(&want, &got, "") {
                    bad.push(format!("{name}（組めた節）: {d}"));
                }
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
    assert!(
        // 版 3.105.0: 任せた歩の下限は置かない（任せる歩は 0 へ減らしていく数で、減らすたびに落ちる。任せるはずの歩を窓が答えないことは歩ごとの確かめが、上限は予算〈common::check_budget〉が見る）
        // 版 3.108.0（H2）: 「表示順が i64 に入らない設備グループ」は窓も組む（節だけ組まない場面が 1 つ減って 3）
        same >= 26 && broken_n >= 3 && seeded >= 2,
        "場面が足りません: 同じ {same}・任せる {delegated}・節だけ組まない {broken_n}・種まき {seeded}"
    );
    assert!(bad.is_empty(), "{} か所違います:\n{}", bad.len(), bad.join("\n"));
}
