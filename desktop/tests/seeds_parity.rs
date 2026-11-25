//! 起動の初期値を窓が当てた後のファイルを、Python（前の版の答え合わせ役 seeds の master_seeds）が当てた後と突き合わせる（版 3.110.0）。
//! 2 つのプロセスの場面（窓と窓・窓と今の版の Python・窓と前の版の Python）は、どちらも app_seeds を読んだ直後で待ち合わせ、同じ時に当てる
//! （採点の係が再現した、前の版で記録が seed ごとに 2 行・中身の版が空の書き込みで上がった形）。
mod common;

use da_core::seeds;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

/// 時刻と書いた人（プロセスごとに違う）を伏せる
fn mask(v: &mut Value) {
    match v {
        Value::Object(o) => {
            for (k, x) in o.iter_mut() {
                if k == "updated_at" || k == "updated_by" {
                    *x = json!("*");
                } else {
                    mask(x);
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(mask),
        _ => {}
    }
}

#[test]
fn the_window_leaves_the_same_files_as_python() {
    let base = common::work("seeds-parity");
    // 場面の置き場は窓が事例の表の走らせる形（run）から作る（seeds_store）ので、宣言には持たない（答え合わせ役の作業フォルダ oracle は除く）
    let mut bk = common::bake::Bake::open("seeds", &base);
    bk.exclude.push("oracle");
    (bk.strip, bk.strip_in) = (vec!["applied".into(), "files".into()], vec!["run"]);
    let oracle = bk.table_oracle();
    let scenes = oracle["scenarios"].as_array().unwrap();
    assert!(scenes.len() >= 11, "事例の表の 8 と足した 3");
    for (i, sc) in scenes.iter().enumerate() {
        let name = sc["name"].as_str().unwrap();
        let run = &sc["run"];
        let root = base.join(format!("{i}-rs"));
        let store = common::seeds_store(&root, run, "rs");
        let o = seeds::run(&store, &|_: Duration| {});
        let w = bk.want(name, || json!({"applied": sc["applied"], "files": sc["files"]}));
        assert_eq!(json!(o.applied), w["applied"], "{name}: 当てた初期値");
        let mut rs = Value::Object(common::seeds_files(&root, run));
        let mut py = w["files"].clone();
        mask(&mut rs);
        mask(&mut py);
        bk.note(name, "seeds", &json!({"applied": o.applied, "files": rs}), &json!({"applied": w["applied"], "files": py}));
        if let Some(d) = common::diff(&bk.s(&py), &bk.s(&rs), name) {
            panic!("{name}: 終わった後のファイルが Python と違う: {d}");
        }
    }
    bk.finish(&[]);
    let _ = std::fs::remove_dir_all(&base);
}

fn rows(share: &Path, name: &str) -> Vec<Value> {
    let v = common::file_value(&std::fs::read(share.join(format!("{name}.json"))).unwrap());
    v["rows"].as_array().cloned().unwrap()
}

fn revision(share: &Path, name: &str) -> Value {
    common::file_value(&std::fs::read(share.join(format!("{name}.json"))).unwrap())["revision"].clone()
}

/// 当て終えた共有: 中身はどれも 1 つずつ（同じ時に当てても 2 回足さない）・錠が残らない
fn contents_once(share: &Path, tag: &str) {
    let eq = rows(share, "equipment_master");
    for m in seeds::METERS {
        assert_eq!(eq.iter().filter(|r| r["設備名"] == m).count(), 1, "{tag}: 設備 {m}");
        assert!(eq.iter().all(|r| r["検査計"] == "有"), "{tag}");
    }
    assert_eq!(rows(share, "access_permissions").iter().filter(|r| r["ログインID"] == seeds::FIRST_DEVELOPER).count(), 1, "{tag}");
    assert_eq!(rows(share, "conversions").iter().filter(|r| r["名前"] == seeds::KAMA_TABLE).count(), 1, "{tag}");
    assert!(!share.join(da_core::master_store::LOCK_FILENAME).exists(), "{tag}: 錠が残った");
}

/// 新しい版どうし: 記録は seed ごとに 1 行・中身の版は空の書き込みで上がらない
fn once_each(share: &Path, tag: &str) {
    contents_once(share, tag);
    let seeds: Vec<Value> = rows(share, seeds::SEEDS_MASTER).iter().map(|r| r["seed"].clone()).collect();
    assert_eq!(seeds.len(), 3, "{tag}: 記録 {seeds:?}");
    for (sid, _) in seeds::SEEDS {
        assert_eq!(seeds.iter().filter(|s| **s == sid).count(), 1, "{tag}: {sid}");
    }
    // 種まき（版 1）＋ 中身を書いた 1 回。後から当てた係は書かない
    assert_eq!(revision(share, "equipment_master"), json!(2), "{tag}");
    assert_eq!(revision(share, "access_permissions"), json!(2), "{tag}");
    assert_eq!(revision(share, "conversions"), json!(1), "{tag}: 同梱の最初の中身に釜番日付がある");
    assert_eq!(revision(share, seeds::SEEDS_MASTER), json!(4), "{tag}: 種まき 1 ＋ 記録 3");
}

#[test]
fn two_windows_reading_the_record_together_apply_once() {
    let base = common::work("seeds-race-rs");
    for round in 0..5 {
        let root = base.join(format!("r{round}"));
        let share = root.join("share");
        std::fs::create_dir_all(&share).unwrap();
        let (a, b) = (
            common::seeds_store_at(&root.join("A"), Some(share.clone()), "A"),
            common::seeds_store_at(&root.join("B"), Some(share.clone()), "B"),
        );
        let both = std::sync::Barrier::new(2);
        // 本物と同じ 1 秒×5 回で待つ（版 3.110.0。100ms に縮めると、書き込みの遅い Windows の CI で相手の錠が 0.4 秒を超えて落ちた）
        let wait = |d: Duration| std::thread::sleep(d);
        let (oa, ob) = std::thread::scope(|s| {
            let ha = s.spawn(|| {
                seeds::run_with(&a, &wait, &|| {
                    both.wait();
                })
            });
            let hb = s.spawn(|| {
                seeds::run_with(&b, &wait, &|| {
                    both.wait();
                })
            });
            (ha.join().unwrap(), hb.join().unwrap())
        });
        assert_eq!((oa.stopped.clone(), ob.stopped.clone()), (None, None), "r{round}: {oa:?} {ob:?}");
        once_each(&share, &format!("窓と窓 r{round}"));
    }
    let _ = std::fs::remove_dir_all(&base);
}

/// 配った設定 cfg の Lot（作業場所 work・共有 share。版 3.110.0 の作った後の直し）
fn lot_at(work: &Path, share: &Path, cfg: &str) -> da_core::lot::Lot {
    for d in [work.join("local"), work.join("base").join("data"), share.to_path_buf()] {
        std::fs::create_dir_all(d).unwrap();
    }
    let c = work.join("config.json");
    std::fs::write(&c, cfg.replace("@SHARE", &json!(share.to_string_lossy()).to_string())).unwrap();
    let env = da_core::bundle::Env { base: work.join("base"), program: common::program(), local: work.join("local"), config: c, now: None };
    let lot = da_core::lot::Lot::new(work.join("local").join("db_cache"));
    lot.set_bundle(da_core::bundle::Builder::new(env));
    lot
}

#[test]
fn settings_the_window_cannot_bundle_still_get_the_same_seeds_as_python() {
    // 作った後の採点の割れ 2: 配った設定に NaN・Infinity・i64 を超える整数があっても、窓は置き場の材料だけで当て、終わった後の共有は
    // Python が空の共有に当てた形（答えの元の最初の場面）と同じ
    let base = common::work("seeds-cfg");
    let mut bk = common::bake::Bake::open_part("seeds", "cfg", &base);
    bk.exclude.push("oracle");
    (bk.strip, bk.strip_in) = (vec!["applied".into(), "files".into()], vec!["run"]);
    let oracle = bk.table_oracle();
    let first = &oracle["scenarios"][0];
    assert!(first["name"].as_str().unwrap().contains("空の共有"));
    let first = bk.want("空の共有", || json!({"applied": first["applied"], "files": first["files"]}));
    let mut py = first["files"].clone();
    mask(&mut py);
    for (i, extra) in ["NaN", "Infinity", "100000000000000000000"].iter().enumerate() {
        let (work, share) = (base.join(format!("c{i}")), base.join(format!("c{i}-share")));
        let lot = lot_at(&work, &share, &format!(r#"{{"master_share": {{"dir": @SHARE}}, "lot_list": {{"page_size": {extra}}}}}"#));
        let o = lot.run_seeds(&|_: Duration| ()).unwrap_or_else(|e| panic!("{extra}: {e}"));
        // 版 3.112.0: 束も組める（前は組めない形だった。配った設定を J で読む）
        assert!(lot.own_bundle().is_some_and(|b| b.is_ok()), "{extra}: 束も組める");
        assert_eq!(json!(o.applied), first["applied"], "{extra}");
        // 当てた 4 つのマスタ（共有の置き場を直に読む）
        let mut rs: Value = Value::Object(
            ["app_seeds", "equipment_master", "access_permissions", "conversions"]
                .iter()
                .map(|n| (n.to_string(), common::file_value(&std::fs::read(share.join(format!("{n}.json"))).unwrap())))
                .collect(),
        );
        mask(&mut rs);
        if i == 0 {
            // 焼いた表には窓が NaN の配った設定で当てた形を記す（ほかの 2 つも同じ形かは下で見る）
            let four = |v: &Value| -> Value {
                ["app_seeds", "equipment_master", "access_permissions", "conversions"]
                    .iter()
                    .map(|n| (n.to_string(), v[*n].clone()))
                    .collect()
            };
            bk.note(
                "空の共有",
                "seeds",
                &json!({"applied": o.applied, "files": four(&rs)}),
                &json!({"applied": first["applied"], "files": four(&py)}),
            );
        }
        let (py, rs) = (bk.s(&py), bk.s(&rs));
        for name in ["app_seeds", "equipment_master", "access_permissions", "conversions"] {
            if let Some(d) = common::diff(&py[name], &rs[name], name) {
                panic!("{extra}: {name} が Python と違う: {d}");
            }
        }
    }
    bk.finish(&[]);
    let _ = std::fs::remove_dir_all(&base);
}
