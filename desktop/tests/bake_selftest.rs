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

/// 場面の SQLite のファイルは、作った SQLite の版によらない形で比べる（版 3.115.0 の PR #115 の CI の直し: 答え合わせ役の Python に付く
/// SQLite の版が手元〈3.53.1〉と CI で違い、頭の版の番号のバイトだけで「場面のフォルダが表の宣言と違う」になった）。
/// 版の番号と変更の数が違うだけなら同じ・行の値・表の定義・ページの大きさが違えば違う・SQLite として開けない物はバイトのまま
#[test]
fn sqlite_files_in_a_scene_are_compared_by_content_not_by_the_library_version() {
    use common::bake::{decl_cmp, sqlite_logical};
    let base = common::work("bake-sqlite");
    let make = |name: &str, sql: &str| -> Vec<u8> {
        let p = base.join(name);
        let c = rusqlite::Connection::open(&p).unwrap();
        c.execute_batch(sql).unwrap();
        drop(c);
        std::fs::read(&p).unwrap()
    };
    let sql = "CREATE TABLE t(a, b); INSERT INTO t VALUES (1, 'あ'), (2.5, x'00ff'), (NULL, 'い'); PRAGMA user_version = 7;";
    let a = make("a.sqlite3", sql);
    // 別の版の SQLite が書いた形: 版の番号（96〜99）・その版が数えた変更の数（92〜95）・変更の数（24〜27）だけが違う
    let mut other = a.clone();
    other[96..100].copy_from_slice(&3_045_001u32.to_be_bytes());
    other[92..96].copy_from_slice(&9u32.to_be_bytes());
    other[24..28].copy_from_slice(&9u32.to_be_bytes());
    assert_ne!(a, other);
    let b64 = |b: &[u8]| {
        use std::fmt::Write;
        let t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".as_bytes();
        let mut out = String::new();
        for ch in b.chunks(3) {
            let n = (ch[0] as u32) << 16 | (*ch.get(1).unwrap_or(&0) as u32) << 8 | *ch.get(2).unwrap_or(&0) as u32;
            for (i, sh) in [18, 12, 6, 0].iter().enumerate() {
                let _ = write!(out, "{}", if i <= ch.len() { t[(n >> sh & 63) as usize] as char } else { '=' });
            }
        }
        out
    };
    let scene =
        |b: &[u8]| json!({"files": {"d/x.sqlite3": {"blob": "k"}}, "dirs": {"d": {}}, "links": {}, "blobs": {"k": {"b64": b64(b)}}});
    assert_eq!(decl_cmp(&scene(&a)), decl_cmp(&scene(&other)), "版の番号と変更の数だけが違うファイルは同じ場面");
    assert!(decl_cmp(&scene(&a))["files"]["d/x.sqlite3"]["blob"]["sqlite"]["rows"]["t"].as_array().is_some_and(|r| r.len() == 3));
    // 中身が違えば違う: 行の値・表の定義・user_version・ページの大きさ
    for (what, sql2) in [
        ("行の値", sql.replace("'い'", "'う'")),
        ("行の数", sql.replace(", (NULL, 'い')", "")),
        (
            "表の定義",
            sql.replace("t(a, b)", "t(a, b, c)")
                .replace("'あ')", "'あ', 1)")
                .replace("x'00ff')", "x'00ff', 1)")
                .replace("'い')", "'い', 1)"),
        ),
        ("user_version", sql.replace("= 7", "= 8")),
        ("ページの大きさ", format!("PRAGMA page_size = 8192; {sql}")),
    ] {
        let c = make(&format!("{what}.sqlite3"), &sql2);
        assert_ne!(decl_cmp(&scene(&a)), decl_cmp(&scene(&c)), "{what} が違えば違う場面");
    }
    // SQLite として開けない物（頭だけ SQLite）と SQLite でない物はバイトのまま比べる
    let mut broken = b"SQLite format 3\0".to_vec();
    broken.extend(std::iter::repeat_n(0xAAu8, 200));
    assert!(sqlite_logical(&broken).is_none() && sqlite_logical(b"plain").is_none());
    let mut broken2 = broken.clone();
    broken2[150] = 0xAB;
    assert_ne!(decl_cmp(&scene(&broken)), decl_cmp(&scene(&broken2)));
    let _ = std::fs::remove_dir_all(&base);
}

/// 錠の「あと約 n 秒」は、焼いた表との比べでも差 1 までを同じとみなす（版 3.115.0 の PR #115 の CI の直し: 期限は秒まで・今は小数なので、
/// 錠を置いた時刻の秒の端数で同じ錠が 20 にも 19 にもなる）。差 2・持ち主の名前・ほかの数・ほかの言葉の数は許さない
#[test]
fn the_seconds_left_on_a_lock_may_differ_by_one_and_nothing_else() {
    let ans = |who: &str, n: i64| json!({"err": {"error": format!("{who} がマスタを保存中です（あと約{n}秒）。少し待つと保存できます。"), "holder_pc": "PC1", "kind": "locked", "remaining": n}, "status": 409});
    assert!(diff_tol(&ans("PC1／u1", 20), &ans("PC1／u1", 19), "k").is_none(), "20 と 19 は同じ");
    assert!(diff_tol(&ans("PC1／u1", 14), &ans("PC1／u1", 15), "k").is_none(), "14 と 15 は同じ");
    assert!(diff_tol(&ans("PC1／u1", 20), &ans("PC1／u1", 18), "k").is_some(), "差 2 は違う");
    assert!(diff_tol(&ans("PC1／u1", 20), &ans("PC1／u1", 5), "k").is_some());
    assert!(diff_tol(&ans("PC1／u1", 20), &ans("PC2／u1", 20), "k").is_some(), "持ち主が違えば違う");
    assert!(diff_tol(&ans("PC1／u1", 20), &ans("PC2／u1", 19), "k").is_some());
    // 言葉は同じで数だけ・数は同じで言葉だけが違う形も、それぞれ見る
    let mut only_num = ans("PC1／u1", 20);
    only_num["err"]["remaining"] = json!(17);
    assert!(diff_tol(&ans("PC1／u1", 20), &only_num, "k").is_some(), "鍵 remaining の差 3");
    only_num["err"]["remaining"] = json!(19);
    assert!(diff_tol(&ans("PC1／u1", 20), &only_num, "k").is_none());
    // ほかの鍵の数・ほかの言葉の数は 1 つ違っても違う
    assert!(diff_tol(&json!({"status": 409, "left": 20}), &json!({"status": 409, "left": 19}), "k").is_some());
    assert!(diff_tol(&json!({"n": {"remaining2": 20}}), &json!({"n": {"remaining2": 19}}), "k").is_some());
    assert!(diff_tol(&json!("あと 20 秒で閉じます"), &json!("あと 19 秒で閉じます"), "k").is_some());
    assert!(diff_tol(&json!("写した 5/11（あと約20秒）"), &json!("写した 6/11（あと約20秒）"), "k").is_some(), "ほかの数は比べる");
    // 「あと約 n 秒」が片方にしか無い・数が 2 つあって片方が離れている
    assert!(diff_tol(&json!("保存中です（あと約20秒）。"), &json!("保存中です。"), "k").is_some());
    assert!(diff_tol(&json!("あと約20秒・あと約3秒"), &json!("あと約19秒・あと約3秒"), "k").is_none());
    assert!(diff_tol(&json!("あと約20秒・あと約3秒"), &json!("あと約19秒・あと約9秒"), "k").is_some());
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

// ------------------------------------------------------------------ 版 3.116.0: 詰める形・場面の台本の指紋・測るだけ

/// 詰める → 開く ＝ 元（往復）。参照は中身の指紋で、1 歩が変わってもほかの歩の行（詰めた字）は動かない。参照の先を 1 字変えると、
/// 開いた答えが変わって表との比べが落ちる。印と同じ形の表・長い繰り返しの字も元に戻る
#[test]
fn packing_round_trips_and_references_do_not_move() {
    use common::bake::{pack_table, unpack_table, PACK_MIN, REP_MIN};
    let long = |c: &str| c.repeat(PACK_MIN);
    let big = format!("{{\"k\": \"{}\", \"m\": \"{}\"}}", "あ".repeat(REP_MIN + 10), "ab".repeat(REP_MIN));
    let answers = json!({
        "a": {"status": 200, "json": {"rows": [long("x"), long("y")], "lot": {"n": long("z")}}},
        "b": {"status": 200, "json": {"rows": [long("x"), long("y")], "lot": {"n": long("z")}, "extra": 1}},
        "c": {"status": 200, "json": {"@same": "印と同じ形の表"}},
        "d": {"status": 200, "json": {"body": big.clone(), "again": big}},
    });
    let t = table(answers.clone(), json!({"a": "GET /a", "b": "GET /b", "c": "GET /c", "d": "GET /d"}));
    let packed = pack_table(&t);
    let text = serde_json::to_string(&packed).unwrap();
    assert!(packed["parts"].as_object().is_some_and(|p| !p.is_empty()), "2 回出る部分は parts に置く");
    assert!(text.len() < serde_json::to_string(&t).unwrap().len() / 2, "詰めた表は小さい: {}", text.len());
    assert!(text.contains("\"@rep\"") && text.contains("\"@lit\""), "長い繰り返しの字は作り方・印と同じ形の表は包む");
    assert_eq!(unpack_table(&packed), t, "詰める → 開く ＝ 元");
    assert_eq!(pack_table(&unpack_table(&packed)), packed, "開く → 詰める ＝ 同じ字（焼き直しで差分が出ない）");
    // 1 歩（b）だけを変えても、ほかの歩（a・c・d）の詰めた字と、変わらない部分の参照は動かない
    let mut changed = t.clone();
    changed["answers"]["b"]["json"]["extra"] = json!(2);
    let p2 = pack_table(&changed);
    for k in ["a", "c", "d"] {
        assert_eq!(p2["answers"][k], packed["answers"][k], "歩 {k} の詰めた字が動いた");
    }
    assert_eq!(p2["answers"]["b"]["json"]["rows"], packed["answers"]["b"]["json"]["rows"], "変わらない部分の参照は同じ指紋");
    // 参照の先（parts の中身）を 1 字変えると、開いた答えが変わる
    let mut tampered = packed.clone();
    let key = packed["answers"]["a"]["json"]["lot"]["@same"].as_str().expect("lot は参照").to_string();
    tampered["parts"][key.as_str()]["n"] = json!(long("z").replacen('z', "Z", 1));
    assert_ne!(unpack_table(&tampered)["answers"]["a"], t["answers"]["a"], "参照の先の 1 字の違いは開いた答えに出る");
    // 参照の先が無い表は分かる言葉で落ちる
    let mut broken = packed.clone();
    broken["parts"].as_object_mut().unwrap().remove(&key);
    let e = catch_unwind(AssertUnwindSafe(|| unpack_table(&broken))).expect_err("参照の先が無い");
    let e = e.downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(e.contains("parts にありません"), "{e}");
    // 詰めた表でも、窓の答えの 1 字の違いは落ちる（比べるのは開いた後）
    let base = common::work("bake-packed");
    let same = |text: &str| {
        let mut bk = Bake::with("selftest", "selftest", Mode::Baked, vec![], Some(unpack_table(&packed)), &base);
        bk.check = true;
        let _ = bk.oracle("unused.py", &[]);
        for k in ["a", "b", "c", "d"] {
            let mut got = answers[k].clone();
            if k == "a" {
                got["json"]["lot"]["n"] = json!(text);
            }
            let want = bk.want(k, || Value::Null);
            bk.note(k, &format!("GET /{k}"), &got, &want);
        }
        finished(bk)
    };
    assert!(same(&long("z")).is_ok(), "同じ答えは通る");
    assert!(same(&long("z").replacen('z', "Z", 1)).expect_err("1 字違う").contains("焼いた表と違う"));
    let _ = std::fs::remove_dir_all(&base);
}

/// 場面の台本が作るファイルは、表に中身でなく指紋を持つ: 同じ中身なら同じ指紋（SQLite は作った版によらない形）・1 行違えば違う指紋・
/// 宣言から作り直すときは台本の作った物に触らない
#[test]
fn files_made_by_a_scene_script_are_declared_by_their_fingerprint() {
    use common::bake::{made_print, snapshot_with};
    let base = common::work("bake-made");
    let db = |name: &str, rows: &[i64]| {
        let p = base.join(name);
        let _ = std::fs::remove_file(&p);
        let c = rusqlite::Connection::open(&p).unwrap();
        c.execute_batch("CREATE TABLE t (a)").unwrap();
        for r in rows {
            c.execute("INSERT INTO t VALUES (?1)", [r]).unwrap();
        }
        p
    };
    let (a, b, c) = (db("a.sqlite3", &[1, 2, 3]), db("b.sqlite3", &[1, 2, 3]), db("c.sqlite3", &[1, 2, 4]));
    assert_eq!(made_print(&a), made_print(&b), "同じ中身は同じ指紋");
    assert_ne!(made_print(&a), made_print(&c), "1 行違えば違う指紋");
    std::fs::write(base.join("plain.txt"), "中身").unwrap();
    let ctx = Ctx::new(&base);
    let decl = snapshot_with(&base, &ctx, &[], &["a.sqlite3".to_string()]);
    assert_eq!(decl["files"]["a.sqlite3"], json!({"made": made_print(&a)}), "台本の作る物は指紋だけ（中身も更新時刻も持たない）");
    assert!(decl["files"]["b.sqlite3"]["blob"].is_string() && decl["files"]["plain.txt"]["blob"].is_string());
    assert!(!serde_json::to_string(&decl["blobs"]).unwrap().is_empty());
    // 作り直す: 台本の作る物（a）は書かない（台本が先に作る）。ほかは宣言から戻る
    let again = common::work("bake-made-again");
    materialize(&decl, &again, &Ctx::new(&again));
    assert!(!again.join("a.sqlite3").exists() && again.join("b.sqlite3").exists() && again.join("plain.txt").exists());
    for d in [&base, &again] {
        let _ = std::fs::remove_dir_all(d);
    }
}

/// 測るだけ（TPA_MEASURE。表と比べない PC〈Windows〉）: 表と違う歩を試験を落とさずに数えて記録に書く
#[test]
fn measuring_counts_the_steps_that_differ_without_failing() {
    let base = common::work("bake-measure");
    let out = base.join("measure");
    let t = table(
        json!({"same": {"status": 200, "json": {"a": 1}}, "differs": {"status": 200, "json": {"a": "posix の答え"}}, "gone": {"status": 200, "json": {}}}),
        json!({"same": "GET /s", "differs": "GET /d", "gone": "GET /g"}),
    );
    let mut bk = Bake::with("selftest", "measured", Mode::Python, vec![], Some(t.clone()), &base);
    bk.check = false; // 表と比べない PC（Windows）の形
    bk.measure = Some(out.clone());
    bk.note("same", "GET /s", &json!({"status": 200, "json": {"a": 1}}), &Value::Null);
    bk.note("differs", "GET /d", &json!({"status": 200, "json": {"a": "nt の答え"}}), &Value::Null);
    bk.note("new", "GET /n", &json!({"status": 200, "json": {}}), &Value::Null);
    assert!(finished(bk).is_ok(), "測るだけは落とさない");
    let m: Value = serde_json::from_slice(&std::fs::read(out.join("measured.json")).expect("測りの記録")).unwrap();
    assert_eq!((m["steps"].as_u64(), m["tableSteps"].as_u64()), (Some(3), Some(3)));
    let keys: Vec<&str> = m["differing"].as_array().unwrap().iter().map(|x| x["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["differs", "new"], "違う歩と表に無い歩だけ: {m}");
    assert!(m["differing"][0]["diff"].as_str().unwrap().contains("posix の答え"), "{m}");
    assert_eq!(m["missing"], json!(["gone"]), "表にあって答えなかった歩");
    assert_eq!((&m["form"], &m["finished"]), (&json!("python"), &json!(true)), "流した形と、finish まで流れたか: {m}");
    // 表だけの形（Mode::Baked。段 ④ の後の形。版 3.117.0）でも同じ記録を書く（form: table）。試験が finish に届かなくても（表の答えと
    // 比べて途中で落ちても）、手放すとき（Drop）にそこまでの歩を書く
    let mut bk = Bake::with("selftest", "tabled", Mode::Baked, vec![], Some(t.clone()), &base);
    bk.check = false;
    bk.measure = Some(out.clone());
    bk.note("same", "GET /s", &json!({"status": 200, "json": {"a": 1}}), &Value::Null);
    bk.note("differs", "GET /d", &json!({"status": 200, "json": {"a": "nt の答え"}}), &Value::Null);
    drop(bk);
    let m: Value = serde_json::from_slice(&std::fs::read(out.join("tabled.json")).expect("表だけの形の測りの記録")).unwrap();
    assert_eq!((&m["form"], &m["finished"]), (&json!("table"), &json!(false)), "{m}");
    let keys: Vec<&str> = m["differing"].as_array().unwrap().iter().map(|x| x["key"].as_str().unwrap()).collect();
    assert_eq!((keys, &m["missing"]), (vec!["differs"], &json!(["gone"])), "{m}");
    // 場面を作れなかった表（宣言が Windows で作れない など）は、理由を sceneError に書いてから落ちる
    let mut broken = t.clone();
    broken["scene"] = json!({"files": {"a.txt": {"blob": "無い"}}, "dirs": {}, "links": {}, "blobs": {}});
    let mut bk = Bake::with("selftest", "noscene", Mode::Baked, vec![], Some(broken), &base.join("noscene"));
    bk.check = false;
    bk.measure = Some(out.clone());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| bk.oracle("無い台本.py", &[])));
    assert!(r.is_err(), "場面を作れなければ試験は落ちる");
    drop(bk);
    let m: Value = serde_json::from_slice(&std::fs::read(out.join("noscene.json")).expect("場面を作れなかった表の記録")).unwrap();
    assert!(m["sceneError"].is_string() && m["finished"] == false && m["steps"] == 0, "{m}");
    // 比べる PC（check）では測りの記録を書かない（表と違えば今までどおり落ちる）
    let mut bk = Bake::with("selftest", "checked", Mode::Python, vec![], Some(table(json!({}), json!({}))), &base);
    bk.check = true;
    bk.measure = Some(out.clone());
    assert!(finished(bk).is_ok() && !out.join("checked.json").exists());
    let _ = std::fs::remove_dir_all(&base);
}

/// 版 3.116.0 で足したそろえる決まり 2 つは狭い: 画面の指紋（今の program の指紋の字そのものだけ）と、名乗りの鍵（値「端末@利用者」の
/// 終わりが OS の利用者の名前のときだけ）。許す範囲のすぐ外（別の指紋・別の利用者・別の鍵・端末の名前の違い）はそのまま比べる。
/// 決まりを外すと揺れが残る
#[test]
fn the_build_stamp_and_the_terminal_key_are_settled_narrowly() {
    let base = common::work("bake-stamp");
    let ctx = Ctx::new(&base);
    let stamp = common::bake::build_stamp();
    let (ver, hex) = stamp.rsplit_once('-').expect("版-指紋");
    assert!(hex.len() == 12 && hex.chars().all(|c| c.is_ascii_hexdigit()), "{stamp}");
    let page = |s: &str| json!({"html": format!("<meta name=\"tpa-build\" content=\"{s}\"><script src=\"/static/app.js?v={s}\">")});
    let settled = settle(&page(stamp), &ctx, &[]);
    assert_eq!(settled, json!({"html": "<meta name=\"tpa-build\" content=\"@BUILD\"><script src=\"/static/app.js?v=@BUILD\">"}));
    // 別の指紋（同じ版・12 桁）はそろえない＝古い画面・別の program の指紋は表との比べで落ちる
    let other = format!("{ver}-{}", if hex.starts_with('0') { "1".repeat(12) } else { "0".repeat(12) });
    assert_eq!(settle(&page(&other), &ctx, &[]), page(&other), "別の指紋はそのまま");
    assert_ne!(settle_with(&page(stamp), &ctx, &[], Some("@BUILD")), settled, "決まりを外すと指紋の字が残る");
    // 画面の字（指紋のある字）の中のアプリの版（見出しの札）も @VERSION に。別の版・指紋の無い字の中の版はそのまま
    let badge = |s: &str, v: &str| json!({"html": format!("<meta content=\"{s}\"><button>VER{v}</button> 1{v} {v}.1")});
    assert_eq!(
        settle(&badge(stamp, ver), &ctx, &[]),
        json!({"html": format!("<meta content=\"@BUILD\"><button>VER@VERSION</button> 1{ver} {ver}.1")})
    );
    assert_eq!(
        settle(&badge(stamp, "0.0.1"), &ctx, &[])["html"],
        json!(format!("<meta content=\"@BUILD\"><button>VER0.0.1</button> 10.0.1 0.0.1.1"))
    );
    assert_eq!(
        settle(&json!({"text": format!("VER{ver} の画面")}), &ctx, &[]),
        json!({"text": format!("VER{ver} の画面")}),
        "指紋の無い字の中の版はそのまま"
    );
    // 名乗りの表の鍵（端末@利用者。使えない字があれば _ にして sha1 の 6 字）
    let Some(u) = common::bake::os_user() else { return };
    let key = da_core::bundle::terminal_key;
    let who = |pc: &str, k: String| json!({"who": {"key": k, "pc": pc}});
    for pc in ["PC-1", "PC 1:北"] {
        assert_eq!(settle(&who(pc, key(u, pc)), &ctx, &[]), who(pc, key("@USER", pc)), "{pc}: 利用者を @USER にして作り直す");
    }
    assert!(key(u, "PC 1:北").contains('-') && key("@USER", "PC 1:北") != key(u, "PC 1:北"), "使えない字の端末は sha1 の 6 字つき");
    assert_ne!(
        settle(&who("PC-1", key(u, "PC-1")), &ctx, &[]),
        settle(&who("PC-2", key(u, "PC-2")), &ctx, &[]),
        "端末の名前の違いは落ちる"
    );
    let stranger = format!("{u}x");
    assert_eq!(settle(&who("PC-1", key(&stranger, "PC-1")), &ctx, &[]), who("PC-1", key(&stranger, "PC-1")), "別の利用者はそのまま");
    // sha1 の 6 字が違う鍵（作り方の誤り）はそろえない＝表との比べで落ちる
    let wrong = format!("{}-000000", key(u, "PC 1:北").rsplit_once('-').unwrap().0);
    assert_eq!(settle(&who("PC 1:北", wrong.clone()), &ctx, &[]), who("PC 1:北", wrong), "違う sha1 はそのまま");
    assert_eq!(settle(&json!({"key": key(u, "PC-1")}), &ctx, &[]), json!({"key": key(u, "PC-1")}), "となりに pc の無い鍵はそのまま");
    assert_eq!(
        settle_with(&who("PC-1", key(u, "PC-1")), &ctx, &[], Some("who.key")),
        who("PC-1", key(u, "PC-1")),
        "決まりを外すと利用者の名前が残る"
    );
    let _ = std::fs::remove_dir_all(&base);
}

/// 詰める形の往復は、2 回出る部分の無い表でも、乱数で作った表でも成り立つ（版 3.116.0 の作った後の採点の割れ 4: 前は parts の無い表が
/// 開かれず、長い繰り返しの字・印と同じ形の表が詰めた形のまま残った）
#[test]
fn packing_round_trips_without_repeats_and_for_random_tables() {
    use common::bake::{pack_table, unpack_table, PACK_MIN, REP_MIN};
    // 重なりの無い表に、長い繰り返しの字と、印と同じ形の表
    let t = table(
        json!({"a": {"status": 200, "json": {"body": "い".repeat(REP_MIN + 5), "mark": {"@rep": [1]}, "lit": {"@lit": {"@same": "x"}}}}}),
        json!({"a": "GET /a"}),
    );
    let packed = pack_table(&t);
    assert_eq!(packed["parts"], json!({}), "2 回出る部分が無くても、詰めた表の印として空の parts を付ける");
    assert!(serde_json::to_string(&packed).unwrap().contains("\"@rep\":[["), "長い繰り返しの字は作り方");
    assert_eq!(unpack_table(&packed), t, "重なりの無い表も 詰める → 開く ＝ 元");
    assert_eq!(pack_table(&unpack_table(&packed)), packed);
    // 乱数の表（決めた種。2000 字の境の前後の繰り返しの字・印と同じ形の表・重なる部分木・重ならない部分木）
    let mut seed = 0x2545F4914F6CDD1Du64;
    let mut rnd = move |n: u64| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed % n
    };
    fn gen(depth: u32, rnd: &mut dyn FnMut(u64) -> u64) -> Value {
        match rnd(if depth > 3 { 5 } else { 9 }) {
            0 => json!(rnd(1000)),
            1 => json!(["あ", "ab", "x"][rnd(3) as usize].repeat((REP_MIN - 3 + rnd(7) as usize) / [1, 2, 1][rnd(3) as usize])),
            2 => json!("字".repeat(rnd(2 * PACK_MIN as u64) as usize)),
            3 => json!({["@same", "@rep", "@lit"][rnd(3) as usize]: rnd(5)}),
            4 => json!({"k": "重なる部分".repeat(PACK_MIN / 4), "n": rnd(2)}),
            5 | 6 => Value::Array((0..rnd(4)).map(|_| gen(depth + 1, rnd)).collect()),
            _ => Value::Object((0..rnd(4)).map(|i| (format!("k{i}"), gen(depth + 1, rnd))).collect()),
        }
    }
    let (mut with_parts, mut without) = (0, 0);
    for i in 0..300 {
        let answers: serde_json::Map<String, Value> = (0..1 + rnd(4)).map(|k| (format!("s{k}"), gen(0, &mut rnd))).collect();
        let routes: serde_json::Map<String, Value> = answers.keys().map(|k| (k.clone(), json!("GET /x"))).collect();
        let t = table(Value::Object(answers), Value::Object(routes));
        let packed = pack_table(&t);
        if packed["parts"].as_object().is_some_and(|p| p.is_empty()) {
            without += 1;
        } else {
            with_parts += 1;
        }
        assert_eq!(unpack_table(&packed), t, "乱数の表 {i}: 詰める → 開く ＝ 元");
        // 書いた字から読み直しても同じ・詰め直しても同じ
        let reread: Value = serde_json::from_str(&common::bake::lines(&packed, 0)).unwrap();
        assert_eq!(unpack_table(&reread), t, "乱数の表 {i}: 書いた字から読み直す");
        assert_eq!(pack_table(&unpack_table(&reread)), packed, "乱数の表 {i}: 詰め直しても同じ字");
    }
    assert!(with_parts >= 50 && without >= 50, "重なりのある表 {with_parts}・無い表 {without} の両方を見る");
}

/// この PC の名前（ホスト名）は、表の「pc」の欄の値がホスト名そのもののときだけ @HOST にそろえる（PR #116 の CI の直し: 名乗りを決めて
/// いない場面の答えに焼いた PC の名前が入り、CI の runner で落ちた）。名乗りの鍵も @HOST で作り直す。ほかの端末の名前・ほかの欄の
/// ホスト名はそのまま比べる（窓の名乗りの係が違う名前を答えたら、表との比べで落ちる）。決まりを外すとホスト名が残る
#[test]
fn the_host_name_is_settled_only_in_the_pc_field() {
    let base = common::work("bake-host");
    let ctx = Ctx::new(&base);
    let (Some(host), Some(u)) = (common::bake::host_name(), common::bake::os_user()) else { return };
    let key = da_core::bundle::terminal_key;
    let who = |pc: &str| json!({"who": {"key": key(u, pc), "pc": pc, "source": "ホスト名"}});
    assert_eq!(settle(&who(host), &ctx, &[]), json!({"who": {"key": key("@USER", "@HOST"), "pc": "@HOST", "source": "ホスト名"}}));
    // ほかの名前（窓がホスト名を読み違えた形: 先頭だけ・FQDN）はそのまま
    for other in [format!("{host}x"), format!("{host}.example.invalid"), "PC-ORACLE".to_string()] {
        assert_eq!(settle(&who(&other), &ctx, &[])["who"]["pc"], json!(other), "ほかの名前はそのまま");
        assert_eq!(settle(&who(&other), &ctx, &[])["who"]["key"], json!(key("@USER", &other)));
    }
    // pc でない欄のホスト名・字の中のホスト名はそのまま
    assert_eq!(
        settle(&json!({"name": host, "text": format!("{host} から")}), &ctx, &[]),
        json!({"name": host, "text": format!("{host} から")})
    );
    assert_eq!(settle_with(&who(host), &ctx, &[], Some("@HOST"))["who"]["pc"], json!(host), "決まりを外すとホスト名が残る");
    let _ = std::fs::remove_dir_all(&base);
}
