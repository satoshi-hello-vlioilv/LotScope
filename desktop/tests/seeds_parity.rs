//! 起動の初期値を窓が当てた後のファイルを、Python（program/tests/seeds_oracle.py の master_seeds）が当てた後と突き合わせる（版 3.110.0）。
//! 2 つのプロセスの場面（窓と窓・窓と今の版の Python・窓と前の版の Python）は、どちらも app_seeds を読んだ直後で待ち合わせ、同じ時に当てる
//! （採点の係が再現した、前の版で記録が seed ごとに 2 行・中身の版が空の書き込みで上がった形）。
mod common;

use da_core::seeds;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
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
    let oracle = common::python_json("seeds_oracle.py", &[base.join("oracle").to_str().unwrap()]);
    let scenes = oracle["scenarios"].as_array().unwrap();
    assert!(scenes.len() >= 11, "事例の表の 8 と足した 3");
    for (i, sc) in scenes.iter().enumerate() {
        let name = sc["name"].as_str().unwrap();
        let run = &sc["run"];
        let root = base.join(format!("{i}-rs"));
        let store = common::seeds_store(&root, run, "rs");
        let o = seeds::run(&store, &|_: Duration| {});
        assert_eq!(json!(o.applied), sc["applied"], "{name}: 当てた初期値");
        let mut rs = Value::Object(common::seeds_files(&root, run));
        let mut py = sc["files"].clone();
        mask(&mut rs);
        mask(&mut py);
        if let Some(d) = common::diff(&py, &rs, name) {
            panic!("{name}: 終わった後のファイルが Python と違う: {d}");
        }
    }
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

/// 待ち合わせの印が置かれるまで待つ
fn until(p: &Path) {
    let end = std::time::Instant::now() + Duration::from_secs(30);
    while !p.exists() {
        assert!(std::time::Instant::now() < end, "{} を待ちきれない", p.display());
        std::thread::sleep(Duration::from_millis(1));
    }
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

/// 窓と Python（old: 前の版の係）が app_seeds を読んだ直後で待ち合わせて当てる
fn with_python(old: bool, tag: &str) -> Vec<PathBuf> {
    let base = common::work(&format!("seeds-race-py{}", if old { "-old" } else { "" }));
    let mut shares = vec![];
    for round in 0..5 {
        let root = base.join(format!("r{round}"));
        let share = root.join("share");
        std::fs::create_dir_all(&share).unwrap();
        let (ready_py, ready_rs, go) = (root.join("ready-py"), root.join("ready-rs"), root.join("go"));
        let rs = common::seeds_store_at(&root.join("rs"), Some(share.clone()), "rs");
        // 本物と同じ 1 秒×5 回で待つ（版 3.110.0。100ms に縮めると、書き込みの遅い Windows の CI で相手の錠が 0.4 秒を超えて落ちた）
        let wait = |d: Duration| std::thread::sleep(d);
        let (py, o) = std::thread::scope(|s| {
            let args: Vec<String> =
                ["race", share.to_str().unwrap(), root.join("py").to_str().unwrap(), ready_py.to_str().unwrap(), go.to_str().unwrap()]
                    .iter()
                    .map(|x| x.to_string())
                    .chain(old.then(|| "--old".to_string()))
                    .collect();
            let hp = s.spawn(move || {
                let a: Vec<&str> = args.iter().map(String::as_str).collect();
                common::python_json("seeds_oracle.py", &a)
            });
            let hr = s.spawn(|| {
                seeds::run_with(&rs, &wait, &|| {
                    std::fs::write(&ready_rs, "1").unwrap();
                    until(&go);
                })
            });
            until(&ready_py);
            until(&ready_rs);
            std::fs::write(&go, "1").unwrap();
            (hp.join().unwrap(), hr.join().unwrap())
        });
        assert_eq!(o.stopped, None, "{tag} r{round}: {o:?} / Python {py}");
        assert_eq!(py["applied"].as_array().map(Vec::len), Some(3), "{tag} r{round}: Python も止まらない {py}");
        shares.push(share);
    }
    shares
}

#[test]
fn the_window_and_python_reading_the_record_together_apply_once() {
    for share in with_python(false, "窓と今の版の Python") {
        once_each(&share, "窓と今の版の Python");
    }
}

#[test]
fn the_window_never_adds_a_second_record_even_beside_the_old_python() {
    // 前の版の Python は見直さないので記録が 2 行になりうる（今の版の窓・Python どうしは塞がる）。窓は自分より先の記録があれば足さない
    for share in with_python(true, "窓と前の版の Python") {
        contents_once(&share, "窓と前の版の Python");
        let recs = rows(&share, seeds::SEEDS_MASTER);
        for (sid, _) in seeds::SEEDS {
            let of: Vec<&Value> = recs.iter().filter(|r| r["seed"] == sid).collect();
            assert!((1..=2).contains(&of.len()), "{sid}: {of:?}");
            let by_rs: Vec<usize> = of.iter().enumerate().filter(|(_, r)| r["updated_by"]["pc"] == "PC-rs").map(|(i, _)| i).collect();
            assert!(by_rs.iter().all(|i| *i == 0), "{sid}: 窓は先の記録の後に足さない {of:?}");
        }
    }
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
    let oracle = common::python_json("seeds_oracle.py", &[base.join("oracle").to_str().unwrap()]);
    let first = &oracle["scenarios"][0];
    assert!(first["name"].as_str().unwrap().contains("空の共有"));
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
        for name in ["app_seeds", "equipment_master", "access_permissions", "conversions"] {
            if let Some(d) = common::diff(&py[name], &rs[name], name) {
                panic!("{extra}: {name} が Python と違う: {d}");
            }
        }
    }
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn the_seeds_win_the_lock_against_the_bundle_seeding_and_python_create_app() {
    // 作った後の採点の割れ 3: 起動の同じ瞬間に、窓の束の種まき（Builder::inputs。warm・最初の画面・更新の係の道）と Python の create_app
    // （起動の参照先の読み＝ path_settings の種まき）が同じ空の共有で錠を取り合っても、初期値は 5 回の待ちの中で当たり、中身は 1 つずつ・
    // 錠は残らない
    let base = common::work("seeds-lock");
    for round in 0..3 {
        let (work, share) = (base.join(format!("r{round}")), base.join(format!("r{round}-share")));
        let lot = lot_at(&work, &share, r#"{"master_share": {"dir": @SHARE}}"#);
        let (ready, go) = (work.join("ready-py"), work.join("go"));
        let wait = |_: Duration| std::thread::sleep(Duration::from_millis(200));
        let start = std::sync::Barrier::new(3);
        let (py, seeded, _) = std::thread::scope(|s| {
            let args: Vec<String> =
                ["create", share.to_str().unwrap(), work.join("py").to_str().unwrap(), ready.to_str().unwrap(), go.to_str().unwrap()]
                    .iter()
                    .map(|x| x.to_string())
                    .collect();
            let hp = s.spawn(move || {
                let a: Vec<&str> = args.iter().map(String::as_str).collect();
                common::python_json("seeds_oracle.py", &a)
            });
            until(&ready);
            let hb = s.spawn(|| {
                start.wait();
                lot.own_bundle()
            });
            let hs = s.spawn(|| {
                start.wait();
                lot.run_seeds(&wait)
            });
            start.wait();
            std::fs::write(&go, "1").unwrap();
            (hp.join().unwrap(), hs.join().unwrap(), hb.join().unwrap())
        });
        let o = seeded.unwrap_or_else(|e| panic!("r{round}: {e}"));
        assert_eq!((o.applied.len(), o.stopped.clone()), (3, None), "r{round}: {o:?}");
        // Python の create_app は最後まで動く（参照先の種まきが錠に当たった回は、写しで答えて次に読むときにまた置く＝前からの決まり。
        // 置いたかは回によって違うので決め打ちしない）
        assert!(py["seeded"].is_boolean(), "r{round}: Python の create_app が動き終えた {py}");
        contents_once(&share, &format!("錠の取り合い r{round}"));
        let recs = rows(&share, seeds::SEEDS_MASTER);
        assert_eq!(recs.len(), 3, "r{round}: {recs:?}");
    }
    let _ = std::fs::remove_dir_all(&base);
}
