//! 窓が焼く係（tests/common/bake.rs。版 3.115.0）そのものの試験: 変異で落ちること（窓の答えを 1 字変える・範囲の外を変える・
//! そろえる決まりを外す・Python と違うのに焼く）と、場面の宣言の写しと作り直しが同じ形に戻ること。
//! 本の焼いた表（tests/baked/*.json）は使わず、ここで作った小さな表で見る。

mod common;

use common::bake::{diff_tol, materialize, settle, settle_with, snapshot, Bake, Ctx, Mode};
use serde_json::{json, Value};
use std::panic::{catch_unwind, AssertUnwindSafe};

fn table(answers: Value, routes: Value) -> Value {
    json!({"book": "selftest", "os": "posix", "oracle": {"steps": []}, "scene": {"files": {}, "dirs": {}, "links": {}, "blobs": {}},
           "answers": answers, "routes": routes, "sources": {}})
}

fn finished(bk: Bake) -> Result<(), String> {
    catch_unwind(AssertUnwindSafe(|| bk.finish(&[])))
        .map_err(|e| e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default())
}

#[test]
fn a_one_character_change_in_the_window_answer_is_caught() {
    let base = common::work("bake-one-char");
    let t =
        table(json!({"k": {"status": 200, "json": {"a": "窓の答え", "updated_at": "2001-01-01T00:00:00"}}}), json!({"k": "GET /api/x"}));
    let same = |text: &str| {
        let mut bk = Bake::with("selftest", "selftest", Mode::Baked, vec![], Some(t.clone()), &base);
        // 焼いた表と比べる形を明示する（Windows は焼いた表と比べない決め〈nt の上書きは 2 版目〉なので、ここで比べる形にする）
        bk.check = true;
        let _ = bk.oracle("unused.py", &[]);
        let want = bk.want("k", || Value::Null);
        bk.note("k", "GET /api/x", &json!({"status": 200, "json": {"a": text, "updated_at": "2001-01-01T00:00:00"}}), &want);
        finished(bk)
    };
    assert!(same("窓の答え").is_ok(), "同じ答えは通る");
    let e = same("窓の答へ").expect_err("1 字変えた答えは落ちる");
    assert!(e.contains("焼いた表と違う"), "{e}");
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn a_scoped_bless_refuses_changes_outside_the_scope() {
    let base = common::work("bake-scope");
    let out = base.join("out");
    let t =
        table(json!({"a": {"status": 200, "json": 1}, "b": {"status": 200, "json": 2}}), json!({"a": "GET /api/x", "b": "POST /api/y"}));
    let run = |a: i64, b: i64| {
        let mut bk = Bake::with("selftest", "selftest", Mode::BlessScope, vec!["POST /api/y".into()], Some(t.clone()), &base);
        bk.out = Some(out.clone());
        let _ = bk.oracle("unused.py", &[]);
        bk.note("a", "GET /api/x", &json!({"status": 200, "json": a}), &Value::Null);
        bk.note("b", "POST /api/y", &json!({"status": 200, "json": b}), &Value::Null);
        finished(bk)
    };
    let e = run(9, 2).expect_err("範囲の外（GET /api/x）が変わったら書かない");
    assert!(e.contains("範囲") && !out.join("selftest.json").exists(), "{e}");
    run(1, 9).expect("範囲の中だけが変わったら書く");
    let w: Value = serde_json::from_slice(&std::fs::read(out.join("selftest.json")).unwrap()).unwrap();
    assert_eq!(w["answers"]["b"]["json"], 9);
    assert_eq!(w["answers"]["a"]["json"], 1);
    let _ = std::fs::remove_dir_all(&base);
}

/// 利用者の別（root・root でない利用者）は Bake の欄で決まり、試験を流している利用者に左右されない（版 3.115.0 の CI の直し: root でない
/// runner では上の試験が本の答えを変えず variants.user にだけ書いて落ちた）。"user" では本の答えを変えず、違う歩だけを variants.user に持ち、
/// 比べる・範囲を確かめる相手も variants.user を重ねた答え
#[test]
fn the_user_variant_is_chosen_by_the_field_not_by_who_runs_the_test() {
    let base = common::work("bake-variant");
    let out = base.join("out");
    let mut t =
        table(json!({"a": {"status": 200, "json": 1}, "b": {"status": 200, "json": 2}}), json!({"a": "GET /api/x", "b": "POST /api/y"}));
    t["variants"] = json!({"user": {"b": {"status": 200, "json": 5}}});
    let bake = |mode: Mode, variant: &'static str| {
        let mut bk = Bake::with("selftest", "selftest", mode, vec!["POST /api/y".into()], Some(t.clone()), &base);
        assert_eq!(bk.variant, "root", "with は流している利用者によらず root");
        bk.variant = variant;
        bk.out = Some(out.clone());
        bk.check = true;
        let _ = bk.oracle("unused.py", &[]);
        bk
    };
    let run = |mode: Mode, variant: &'static str, a: i64, b: i64| {
        let mut bk = bake(mode, variant);
        let wa = bk.want("a", || Value::Null);
        let wb = bk.want("b", || Value::Null);
        bk.note("a", "GET /api/x", &json!({"status": 200, "json": a}), &wa);
        bk.note("b", "POST /api/y", &json!({"status": 200, "json": b}), &wb);
        finished(bk)
    };
    // 焼いた表と比べる: root は本の答え、user は variants.user を重ねた答え
    run(Mode::Baked, "root", 1, 2).expect("root は本の答え");
    run(Mode::Baked, "user", 1, 5).expect("user は variants.user の答え");
    assert!(run(Mode::Baked, "user", 1, 2).is_err(), "user で本の答えは食い違い");
    // 範囲を決めた焼き直し（user）: variants.user と同じなら範囲の外も変わっていない
    assert!(run(Mode::BlessScope, "user", 3, 5).expect_err("範囲の外").contains("範囲"));
    run(Mode::BlessScope, "user", 1, 7).expect("範囲の中だけが変わったら書く");
    let w: Value = serde_json::from_slice(&std::fs::read(out.join("selftest.json")).unwrap()).unwrap();
    assert_eq!(w["answers"]["b"]["json"], 2, "user は本の答えを変えない");
    assert_eq!(w["variants"]["user"]["b"]["json"], 7, "違う歩だけを variants.user に");
    assert!(w["variants"]["user"].get("a").is_none(), "同じ歩は variants.user に持たない");
    // 同じ表を root で焼き直すと本の答えが替わり、variants.user は残す
    run(Mode::BlessScope, "root", 1, 8).expect("root の範囲の中");
    let w: Value = serde_json::from_slice(&std::fs::read(out.join("selftest.json")).unwrap()).unwrap();
    assert_eq!(w["answers"]["b"]["json"], 8);
    assert_eq!(w["variants"]["user"]["b"]["json"], 5, "root の焼き直しは variants.user を変えない");
    let _ = std::fs::remove_dir_all(&base);
}

/// 今から secs 秒ずれた地方時の日時の字（fmt の形）
fn at(secs: i64, fmt: &str) -> String {
    (chrono::Local::now().naive_local() + chrono::Duration::seconds(secs)).format(fmt).to_string()
}

fn now_epoch() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64()
}

#[test]
fn bless_writes_only_when_the_settled_window_answer_equals_python() {
    let base = common::work("bake-bless");
    let out = base.join("out");
    let run = |py: Value, rs: Value| {
        let mut bk = Bake::with("selftest", "selftest", Mode::Bless, vec![], None, &base);
        bk.out = Some(out.clone());
        bk.took(&json!({"steps": []}));
        bk.note("k", "GET /api/x", &rs, &py);
        finished(bk)
    };
    let e = run(json!({"v": "Python"}), json!({"v": "窓"})).expect_err("Python と違えば焼かない");
    assert!(e.contains("焼きません") && !out.join("selftest.json").exists(), "{e}");
    // 今に近い時刻（同じ形で秒の差が TOL の内）と作業フォルダ（道の字）だけが違うなら焼く
    let w = base.join("s0").to_string_lossy().into_owned();
    let f = "%Y-%m-%dT%H:%M:%S";
    run(json!({"v": "x", "at": at(-5, f), "p": format!("{w}/a")}), json!({"v": "x", "at": at(-65, f), "p": format!("{w}/a")}))
        .expect("そろえた後が同じなら焼く");
    let t: Value = serde_json::from_slice(&std::fs::read(out.join("selftest.json")).unwrap()).unwrap();
    let a = t["answers"]["k"]["at"].as_str().unwrap();
    assert!(a.starts_with("@T(-Ts|-6") || a.starts_with("@T(-Ts|-"), "今に近い時刻は形と今からの秒: {a}");
    assert_eq!(t["answers"]["k"]["p"], "@WORK/s0/a");
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn only_times_near_now_are_settled_and_their_shape_and_value_are_kept() {
    // 採点の割れ 1（版 3.115.0 の作った後の直し）: 遠い固定の日時・日時でない字・遠い数・ポートはそのまま比べる。今に近い時刻は形と今からの秒で比べる
    let base = common::work("bake-near");
    let ctx = Ctx::new(&base);
    let differ = |a: Value, b: Value, why: &str| {
        let (x, y) = (settle(&a, &ctx, &[]), settle(&b, &ctx, &[]));
        assert!(diff_tol(&x, &y, "").is_some(), "{why}: {x} / {y}");
    };
    let same = |a: Value, b: Value, why: &str| {
        let (x, y) = (settle(&a, &ctx, &[]), settle(&b, &ctx, &[]));
        assert!(diff_tol(&x, &y, "").is_none(), "{why}: {x} / {y}");
    };
    differ(json!({"v": "2020-01-01 08:00"}), json!({"v": "2020-01-01 09:00"}), "遠い固定の日時は時刻まで比べる（場面の作業実績の見本）");
    differ(json!({"v": "2020-01-01 08:00"}), json!({"v": "1920-01-01 08:00"}), "変異 M2: 見本の日時の年を替える");
    differ(json!({"at": at(-60, "%Y-%m-%dT%H:%M")}), json!({"at": "壊れた字"}), "時刻の鍵でも日時でない字はそのまま");
    differ(json!({"mtime": 1.7e9}), json!({"mtime": 1.8e9}), "遠い更新時刻の数");
    differ(json!({"u": "http://127.0.0.1:8080/x"}), json!({"u": "http://127.0.0.1:9/x"}), "作り物のサーバーでないポート");
    // 変異 M1: 切断の指示の at を、読んだ字のまま返さず「年-月-日T時:分:秒」に書き直す（小数と時差が消える）
    let raw = format!("{}.123456+09:00", at(-30, "%Y-%m-%dT%H:%M:%S"));
    differ(json!({"at": raw.clone()}), json!({"at": at(-30, "%Y-%m-%dT%H:%M:%S")}), "変異 M1: 今に近い時刻の形が替わる");
    differ(
        json!({"at": at(-30, "%Y-%m-%dT%H:%M:%S")}),
        json!({"at": at(-30 - 7200, "%Y-%m-%dT%H:%M:%S")}),
        "今に近い時刻でも 2 時間ずれれば違う",
    );
    same(
        json!({"at": raw}),
        json!({"at": format!("{}.654321+09:00", at(-90, "%Y-%m-%dT%H:%M:%S"))}),
        "今に近い時刻は同じ形で秒の差が TOL の内なら同じ",
    );
    differ(json!({"t": now_epoch()}), json!({"t": now_epoch() - 30.0}), "時刻の鍵でない数はそのまま");
    same(json!({"at": now_epoch()}), json!({"at": now_epoch() - 40.0}), "時刻の鍵の今に近い数");
    differ(json!({"at": now_epoch()}), json!({"at": now_epoch() - 4000.0}), "時刻の鍵の数でも秒の差が TOL を超えれば違う");
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn only_the_work_folder_and_named_users_are_replaced() {
    // 採点の割れ 3・9: 一時フォルダの字は置き換えない（答え合わせ役の固定の「/tmp/x/../y」を混ぜない）・段の境の前後を見る・
    // 区切りの作業フォルダより上は @ABOVE 1 つ・利用者の名前は名前を書く欄だけ
    let base = common::work("bake-paths");
    let ctx = Ctx::new(&base);
    let w = base.to_string_lossy().into_owned();
    let tmp = std::env::temp_dir().to_string_lossy().trim_end_matches('/').to_string();
    assert_eq!(settle(&json!("/tmp/x/../y"), &ctx, &[]), json!("/tmp/x/../y"));
    assert_eq!(settle(&json!(format!("{tmp}/other")), &ctx, &[]), json!(format!("{tmp}/other")));
    assert_eq!(settle(&json!(format!("{w}/a")), &ctx, &[]), json!("@WORK/a"));
    assert!(!settle(&json!(format!("/x{w}/a")), &ctx, &[]).to_string().contains("@WORK"), "前が道の続きなら置き換えない");
    assert!(!settle(&json!(format!("{w}2/a")), &ctx, &[]).to_string().contains("@WORK"), "後ろが道の続きなら置き換えない");
    // 置き換えた後の区切りは「/」（Windows の「\」も）
    assert_eq!(settle(&json!(format!("{w}\\s0\\a")), &ctx, &[]), json!("@WORK/s0/a"));
    let deep = json!([{"name": "/", "path": "/"}, {"name": "tmp", "path": tmp}, {"name": "x", "path": w}, {"name": "a", "path": format!("{w}/a")}]);
    assert_eq!(
        settle(&deep, &ctx, &[]),
        json!([{"name": "@ABOVE", "path": "@ABOVE"}, {"name": "x", "path": "@WORK"}, {"name": "a", "path": "@WORK/a"}]),
        "作業フォルダの深さに頼らない"
    );
    if let Some(u) = common::bake::os_user() {
        let v = settle(&json!({"login": u, "name": u, "updated_by": {"login": u, "pc": "PC-1"}}), &ctx, &[]);
        assert_eq!(v, json!({"login": "@USER", "name": u, "updated_by": {"login": "@USER", "pc": "PC-1"}}), "名前を書く欄だけ");
    }
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn the_repository_is_the_same_wherever_it_is_checked_out() {
    // 版 3.115.0 の 2 回目の直し: リポジトリの道は @REPO。家の下にある PC（CI の /home/runner/work/…）でも @HOME/… にならない
    let base = common::work("bake-repo");
    let repo = common::bake::repo_root();
    let p = repo.join("program").join("app").join("master_defaults").to_string_lossy().into_owned();
    let raw = common::program().join("app").to_string_lossy().into_owned();
    for home in [None, repo.parent().map(|h| h.to_string_lossy().into_owned()), Some("/".into())] {
        let ctx = Ctx::with_home(&base, home.as_deref());
        assert_eq!(settle(&json!(p), &ctx, &[]), json!("@REPO/program/app/master_defaults"), "家 {home:?}");
        assert_eq!(settle(&json!(raw), &ctx, &[]), json!("@REPO/program/app"), "desktop/.. の書き方も");
    }
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn baking_fixes_the_time_zone() {
    // 採点の割れ 4: 焼く・比べるときの時差は UTC（答え合わせ役の地方時の日時が PC の時差で違う更新時刻にならない）
    let base = common::work("bake-tz");
    // 本「selftest」の焼いた表は無いので、TPA_NO_PYTHON=1 の流し方では開いた後に「焼いた表がありません」で落ちる。時差は表を探す前に
    // 決めるので、どの流し方でも時差だけを見る（版 3.115.0 の CI の直し: 前は TPA_NO_PYTHON=1 で流すとこの試験だけが落ちた）
    let _ = catch_unwind(AssertUnwindSafe(|| Bake::open("selftest", &base)));
    assert_eq!(std::env::var("TZ").as_deref(), Ok("UTC"));
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn dropping_a_settle_rule_lets_the_wobble_through() {
    let base = common::work("bake-settle");
    let mut ctx = Ctx::new(&base);
    ctx.url("http://127.0.0.1:40123");
    let a = json!({"msg": format!("最後の更新 {}・3 ms", at(-60, "%Y/%m/%d %H:%M")), "url": "http://127.0.0.1:40123/x", "at": now_epoch()});
    let b = json!({"msg": format!("最後の更新 {}・7 ms", at(-120, "%Y/%m/%d %H:%M")), "url": "http://127.0.0.1:40123/x", "at": now_epoch() - 50.0});
    assert!(diff_tol(&settle(&a, &ctx, &[]), &settle(&b, &ctx, &[]), "").is_none(), "決まりを全部当てれば揺れは消える");
    for drop in ["near", "・@MS ms", "at"] {
        assert!(
            diff_tol(&settle_with(&a, &ctx, &[], Some(drop)), &settle_with(&b, &ctx, &[], Some(drop)), "").is_some(),
            "{drop} を外すと揺れが残る"
        );
    }
    assert_eq!(settle(&json!("http://127.0.0.1:40123/x"), &ctx, &[]), json!("@URL/x"), "作り物のサーバーの URL だけ");
    assert_ne!(settle(&json!({"v": "古い表"}), &ctx, &[]), settle(&json!({"v": "古い衣"}), &ctx, &[]));
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn a_scoped_bless_refuses_steps_vanishing_outside_the_scope() {
    // 採点の割れ 6: 前の表にあって今回の答えに無い歩も、範囲の外なら止める
    let base = common::work("bake-scope-gone");
    let out = base.join("out");
    let t =
        table(json!({"a": {"status": 200, "json": 1}, "b": {"status": 200, "json": 2}}), json!({"a": "GET /api/x", "b": "POST /api/y"}));
    let run = |note_a: bool| {
        let mut bk = Bake::with("selftest", "selftest", Mode::BlessScope, vec!["POST /api/y".into()], Some(t.clone()), &base);
        bk.out = Some(out.clone());
        let _ = bk.oracle("unused.py", &[]);
        if note_a {
            bk.note("a", "GET /api/x", &json!({"status": 200, "json": 1}), &Value::Null);
        }
        bk.note("b", "POST /api/y", &json!({"status": 200, "json": 9}), &Value::Null);
        finished(bk)
    };
    let e = run(false).expect_err("範囲の外の歩が消えたら書かない");
    assert!(e.contains("消えた") && !out.join("selftest.json").exists(), "{e}");
    run(true).expect("範囲の外が同じなら書く");
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn a_scene_comes_back_from_its_declaration() {
    let base = common::work("bake-scene");
    let (a, b) = (base.join("a"), base.join("b"));
    std::fs::create_dir_all(a.join("share/sub")).unwrap();
    let now = chrono::Local::now().naive_local();
    let lock = format!(r#"{{"acquired_at": "{}", "dir": "{}"}}"#, now.format("%Y-%m-%dT%H:%M:%S"), a.join("share").display());
    std::fs::write(a.join("share/master.lock.json"), &lock).unwrap();
    std::fs::write(a.join("share/sub/old.txt"), "2001-01-01T00:00:00 は遠い時刻").unwrap();
    std::fs::write(a.join("bin.sqlite3"), [0u8, 1, 2, 255, 0, 7]).unwrap();
    let old = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000_000);
    std::fs::File::options().write(true).open(a.join("share/sub/old.txt")).unwrap().set_modified(old).unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("share/sub", a.join("link")).unwrap();
        std::process::Command::new("mkfifo").arg(a.join("pipe")).status().unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(a.join("bin.sqlite3"), std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let decl = snapshot(&a, &Ctx::new(&a), &[]);
    let text = decl.to_string();
    assert!(!text.contains(&a.to_string_lossy().into_owned()), "作業フォルダの字は @WORK にする: {text}");
    assert!(text.contains("@NOW("), "今に近い時刻は今からのずれ: {text}");
    assert!(text.contains("2001-01-01T00:00:00"), "遠い時刻はそのまま");
    materialize(&decl, &b, &Ctx::new(&b));
    let again = snapshot(&b, &Ctx::new(&b), &[]);
    let names = |v: &Value, k: &str| v[k].as_object().unwrap().keys().cloned().collect::<Vec<_>>();
    for k in ["files", "dirs", "links"] {
        assert_eq!(names(&decl, k), names(&again, k), "{k}");
    }
    assert_eq!(std::fs::read(b.join("bin.sqlite3")).unwrap(), [0u8, 1, 2, 255, 0, 7], "バイトのまま");
    assert_eq!(std::fs::metadata(b.join("share/sub/old.txt")).unwrap().modified().unwrap(), old, "遠い更新時刻はそのまま");
    let lock_b = std::fs::read_to_string(b.join("share/master.lock.json")).unwrap();
    assert!(lock_b.contains(&b.join("share").display().to_string()), "道は作った所の字: {lock_b}");
    #[cfg(unix)]
    {
        use std::os::unix::fs::{FileTypeExt, PermissionsExt};
        assert!(std::fs::symlink_metadata(b.join("link")).unwrap().file_type().is_symlink());
        assert!(std::fs::symlink_metadata(b.join("pipe")).unwrap().file_type().is_fifo());
        assert_eq!(std::fs::metadata(b.join("bin.sqlite3")).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let _ = std::fs::remove_dir_all(&base);
}
