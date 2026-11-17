//! 窓が焼く係（tests/common/bake.rs。版 3.115.0）そのものの試験: 変異で落ちること（窓の答えを 1 字変える・範囲の外を変える・
//! そろえる決まりを外す・Python と違うのに焼く）と、場面の宣言の写しと作り直しが同じ形に戻ること。
//! 本の焼いた表（tests/baked/*.json）は使わず、ここで作った小さな表で見る。

mod common;

use common::bake::{materialize, settle, settle_with, snapshot, Bake, Ctx, Mode};
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
    let t = table(json!({"k": {"status": 200, "json": {"a": "窓の答え", "updated_at": "@T"}}}), json!({"k": "GET /api/x"}));
    let same = |text: &str| {
        let mut bk = Bake::with("selftest", "selftest", Mode::Baked, vec![], Some(t.clone()), &base);
        let _ = bk.oracle("unused.py", &[]);
        let want = bk.want("k", || Value::Null);
        bk.note("k", "GET /api/x", &json!({"status": 200, "json": {"a": text, "updated_at": "2026-11-17T21:15:03"}}), &want);
        finished(bk)
    };
    assert!(same("窓の答え").is_ok(), "同じ答え（時刻はそろえる決まりが伏せる）は通る");
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
    // 時刻（鍵の名前の表）と作業フォルダ（道の字）だけが違うなら焼く
    let w = base.join("s0").to_string_lossy().into_owned();
    run(
        json!({"v": "x", "at": "2026-11-17T21:15:03", "p": format!("{w}/a")}),
        json!({"v": "x", "at": "2026-11-18T01:00:00", "p": format!("{w}/a")}),
    )
    .expect("そろえた後が同じなら焼く");
    let t: Value = serde_json::from_slice(&std::fs::read(out.join("selftest.json")).unwrap()).unwrap();
    assert_eq!(t["answers"]["k"], json!({"v": "x", "at": "@T", "p": "@WORK/s0/a"}));
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn dropping_a_settle_rule_lets_the_wobble_through() {
    let base = common::work("bake-settle");
    let ctx = Ctx::new(&base);
    let a = json!({"updated_at": 1763412345.5, "msg": "最後の更新 2026/11/17 21:15・3 ms", "url": "http://127.0.0.1:40123/x"});
    let b = json!({"updated_at": 1763412400.25, "msg": "最後の更新 2026/11/17 21:16・7 ms", "url": "http://127.0.0.1:51234/x"});
    assert_eq!(settle(&a, &ctx, &[]), settle(&b, &ctx, &[]), "決まりを全部当てれば揺れは消える");
    for drop in ["updated_at", "@T", "・@MS ms", "$1:@PORT"] {
        assert_ne!(settle_with(&a, &ctx, &[], Some(drop)), settle_with(&b, &ctx, &[], Some(drop)), "{drop} を外すと揺れが残る");
    }
    // 揺れない値は変えない（決まりは名前と形で当てる。値の中身は見る）
    assert_ne!(settle(&json!({"v": "古い表"}), &ctx, &[]), settle(&json!({"v": "古い衣"}), &ctx, &[]));
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
