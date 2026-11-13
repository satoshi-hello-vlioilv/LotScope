//! マスタの書く係（src/master_store.rs）が Python の MasterStore と同じ答えか（版 3.67.0。順 5 の 2 段目 a）。
//! program/tests/masters_oracle.py の手順（SCENARIOS）を Python に当てた答えと、同じ手順を Rust の書く係に当てた答えを、
//! 1 歩ずつ（答え・断る言葉・状態の番号）と、終わった後のファイル（共有・写し・data/・錠・書きかけの残り）で突き合わせる。

mod common;

use da_core::master_store::{next_id, Config, MasterError, Store, LOCK_FILENAME};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

fn setup(work: &Path, sc: &Value) {
    for d in ["data", "share", "local/master_cache", "defaults"] {
        std::fs::create_dir_all(work.join(d)).unwrap();
    }
    std::fs::write(work.join("local/instance_id"), "inst1").unwrap();
    for (rel, body) in sc["files"].as_object().unwrap() {
        let (bom, rel) = match rel.strip_prefix("bom:") {
            Some(r) => (true, r),
            None => (false, rel.as_str()),
        };
        let p = work.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        let mut b = if bom { b"\xef\xbb\xbf".to_vec() } else { vec![] };
        b.extend(serde_json::to_vec(body).unwrap());
        std::fs::write(p, b).unwrap();
    }
}

fn store_of(work: &Path, sc: &Value, shared: &[String]) -> Store {
    Store::new(Config {
        data: work.join("data"),
        defaults: work.join("defaults"),
        share_dir: sc["shared"].as_bool().unwrap().then(|| work.join("share")),
        shared: shared.to_vec(),
        cache: work.join("local/master_cache"),
        local_root: work.join("local"),
        pc: "PC1".into(),
        login: "u1".into(),
        role: "rs".into(),
        lock_ttl: sc["ttl"].as_f64().unwrap_or(20.0),
    })
}

fn lock_body(holder: &str, left: f64) -> Value {
    let now = chrono::Local::now().naive_local();
    let iso = |t: chrono::NaiveDateTime| t.format("%Y-%m-%dT%H:%M:%S").to_string();
    let inst = match holder {
        "other" => "otherpc:py",
        "sibling" => "inst1:py",
        "mine" => "inst1:rs",
        _ => "inst1",
    };
    let other = holder == "other";
    json!({"token": format!("t-{holder}"), "holder_pc": if other {"PC9"} else {"PC1"}, "holder_login": if other {"u9"} else {"u1"},
           "holder_instance": inst, "acquired_at": iso(now), "expires_at": iso(now + chrono::Duration::milliseconds((left * 1000.0) as i64))})
}

fn find_lock(work: &Path) -> PathBuf {
    // 書く途中で錠のある所（共有に錠があれば共有、無ければ data/）
    let s = work.join("share").join(LOCK_FILENAME);
    if s.exists() {
        s
    } else {
        work.join("data").join(LOCK_FILENAME)
    }
}

fn mutate(work: &Path, acts: &[Value], rows: &mut Vec<Value>, stamp: &Value) -> Result<i64, MasterError> {
    let merge = |row: &mut Map<String, Value>| {
        for (k, v) in stamp.as_object().unwrap() {
            row.insert(k.clone(), v.clone());
        }
    };
    for a in acts {
        if let Some(r) = a.get("append") {
            let mut row = r.as_object().unwrap().clone();
            row.insert("id".into(), json!(next_id(rows)));
            merge(&mut row);
            rows.push(Value::Object(row));
        } else if let Some(s) = a.get("set") {
            let (id, key, val) = (&s[0], s[1].as_str().unwrap(), s[2].clone());
            let Some(row) = rows.iter_mut().find(|r| &r["id"] == id) else {
                return Err(MasterError::NotFound("その行がありません".into()));
            };
            let o = row.as_object_mut().unwrap();
            o.insert(key.into(), val);
            merge(o);
        } else if let Some(id) = a.get("delete") {
            rows.retain(|r| &r["id"] != id);
        } else if let Some(k) = a.get("raise") {
            return Err(match k.as_str().unwrap() {
                "not_found" => MasterError::NotFound("その行がありません".into()),
                "conflict" => MasterError::Conflict(rows.first().cloned()),
                _ => MasterError::Duplicate("同じ名前があります".into()),
            });
        } else if let Some(p) = a.get("touch") {
            std::thread::sleep(std::time::Duration::from_millis(20));
            std::fs::write(work.join(p.as_str().unwrap()), r#"{"schema": 1, "revision": 99, "rows": []}"#).unwrap();
        } else if a.get("steal").is_some() {
            let p = find_lock(work);
            let tmp = p.with_file_name("steal.tmp");
            std::fs::write(&tmp, serde_json::to_vec(&lock_body("other", 15.0)).unwrap()).unwrap();
            std::fs::rename(&tmp, &p).unwrap();
        }
    }
    Ok(rows.len() as i64)
}

fn answer<T: Into<Value>>(r: Result<T, MasterError>) -> Value {
    match r {
        Ok(v) => json!({"ok": v.into()}),
        Err(MasterError::Error(_)) => json!({"err": {"kind": "error"}, "status": 500}),
        Err(e) => json!({"err": e.payload(), "status": e.status()}),
    }
}

fn run(work: &Path, st: &Store, steps: &[Value], out: &mut Vec<Value>) {
    for s in steps {
        let r = match s["op"].as_str().unwrap() {
            "write" => answer(st.write(s["name"].as_str().unwrap(), |rows, stamp| mutate(work, s["do"].as_array().unwrap(), rows, stamp))),
            "pull" => answer(st.pull(s["name"].as_str().unwrap(), true, false)),
            "exclusive" => answer(st.exclusive(|| {
                let mut inner = vec![];
                run(work, st, s["do"].as_array().unwrap(), &mut inner);
                Ok(Value::Array(inner))
            })),
            "lock" => {
                let d = work.join(if s["local"].as_bool().unwrap_or(false) { "data" } else { "share" });
                let p = d.join(LOCK_FILENAME);
                let left = s["left"].as_f64().unwrap_or(15.0);
                if s["holder"] == "broken" {
                    std::fs::write(p, r#"{"token": "half"#).unwrap();
                } else if s["holder"] == "bigtoken" {
                    let body = serde_json::to_string(&lock_body("other", left)).unwrap().replace("\"t-other\"", "123456789012345678901234");
                    std::fs::write(p, body).unwrap();
                } else if s["holder"] == "empty" {
                    std::fs::write(p, "{}").unwrap();
                } else if let Some(t) = match s["holder"].as_str().unwrap() {
                    "notoken" => Some(None),
                    "nulltoken" => Some(Some(Value::Null)),
                    "numtoken" => Some(Some(json!(5))),
                    _ => None,
                } {
                    let mut body = lock_body("other", left);
                    match t {
                        None => {
                            body.as_object_mut().unwrap().remove("token");
                        }
                        Some(v) => body["token"] = v,
                    }
                    std::fs::write(p, serde_json::to_vec(&body).unwrap()).unwrap();
                } else {
                    std::fs::write(
                        p,
                        serde_json::to_vec(&lock_body(s["holder"].as_str().unwrap(), s["left"].as_f64().unwrap_or(15.0))).unwrap(),
                    )
                    .unwrap();
                }
                json!({"ok": null})
            }
            "unshare" => {
                std::fs::rename(work.join("share"), work.join("share_away")).unwrap();
                json!({"ok": null})
            }
            "reshare" => {
                std::fs::rename(work.join("share_away"), work.join("share")).unwrap();
                json!({"ok": null})
            }
            "sleep" => {
                std::thread::sleep(std::time::Duration::from_secs_f64(s["sec"].as_f64().unwrap()));
                json!({"ok": null})
            }
            "file" => {
                let p = work.join(s["path"].as_str().unwrap());
                std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                std::fs::write(p, serde_json::to_vec(&s["json"]).unwrap()).unwrap();
                json!({"ok": null})
            }
            op => panic!("知らない手順 {op}"),
        };
        out.push(r);
    }
}

/// 時刻・錠の印・作業フォルダの名前を伏せる（比べるのは形と中身）
fn norm(v: &Value, work: &str) -> Value {
    match v {
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| {
                    let x = if ["updated_at", "acquired_at", "expires_at", "token"].contains(&k.as_str())
                        && x.as_str().is_some_and(|s| !s.is_empty())
                    {
                        json!("<t>")
                    } else {
                        norm(x, work)
                    };
                    (k.clone(), x)
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(|x| norm(x, work)).collect()),
        Value::String(s) => json!(s.replace(work, "<w>")),
        _ => v.clone(),
    }
}

/// 終わった後のファイル（共有・写し・data/。錠と、書きかけ・どけた錠の残り）
fn files(work: &Path) -> Value {
    let mut out = Map::new();
    for d in ["share", "share_away", "data", "local/master_cache"] {
        let Ok(rd) = std::fs::read_dir(work.join(d)) else { continue };
        let mut names: Vec<_> = rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        for n in names {
            let p = work.join(d).join(&n);
            let b = std::fs::read(&p).unwrap();
            let b = b.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&b);
            let v = serde_json::from_slice::<Value>(b).unwrap_or_else(|_| json!(format!("<読めない {} バイト>", b.len())));
            out.insert(format!("{d}/{n}"), v);
        }
    }
    Value::Object(out)
}

/// 「あと約 N 秒」は秒の切り捨てで ±1 ずれることがある（期限の書き方が秒まで）。ずれが 1 なら Python の数にそろえる
fn same_remaining(py: &Value, rs: &mut Value) {
    if let (Some(a), Some(b)) = (py["err"]["remaining"].as_i64(), rs["err"]["remaining"].as_i64()) {
        if (a - b).abs() <= 1 && a != b {
            rs["err"]["remaining"] = json!(a);
            let m = rs["err"]["error"].as_str().unwrap_or("").replace(&format!("約{b}秒"), &format!("約{a}秒"));
            rs["err"]["error"] = json!(m);
        }
    }
    if let (Some(x), Some(y)) = (py.get("ok").and_then(|v| v.as_array()), rs.get_mut("ok").and_then(|v| v.as_array_mut())) {
        for (p, r) in x.iter().zip(y.iter_mut()) {
            same_remaining(p, r);
        }
    }
}

#[test]
fn master_writes_match_python() {
    let base = common::work("masters-parity");
    let py_base = base.join("py");
    let oracle = common::python_json("masters_oracle.py", &[py_base.to_str().unwrap()]);
    let mut bad = vec![];
    let cases = oracle.as_array().unwrap();
    assert!(cases.len() >= 20, "場面が少ない: {}", cases.len());
    for (i, case) in cases.iter().enumerate() {
        let sc = &case["scenario"];
        let name = sc["name"].as_str().unwrap();
        let work = base.join("rs").join(format!("s{i}"));
        setup(&work, sc);
        let shared: Vec<String> = case["config"]["shared"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
        let st = store_of(&work, sc, &shared);
        let mut got = vec![];
        run(&work, &st, sc["steps"].as_array().unwrap(), &mut got);
        let pw = case["work"].as_str().unwrap();
        let want: Vec<Value> = case["results"].as_array().unwrap().iter().map(|x| norm(x, pw)).collect();
        let mut got: Vec<Value> = got.iter().map(|x| norm(x, work.to_str().unwrap())).collect();
        for (w, g) in want.iter().zip(got.iter_mut()) {
            same_remaining(w, g);
        }
        let (want, got) = (Value::Array(want), Value::Array(got));
        if let Some(d) = common::diff(&want, &got, "答え") {
            bad.push(format!("{name}: {d}\n  Python {want}\n  Rust   {got}"));
        }
        let (fp, fr) = (norm(&files(Path::new(pw)), pw), norm(&files(&work), work.to_str().unwrap()));
        if let Some(d) = common::diff(&fp, &fr, "ファイル") {
            bad.push(format!("{name}: {d}\n  Python {fp}\n  Rust   {fr}"));
        }
    }
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 同じ PC で Python（係 py）と窓（係 rs）が同時に同じマスタへ書いても、保存が 1 つも消えない（共有・手元だけの両方）。
/// どちらの係も、断られたら少し待って送り直す（画面の withLockWait と同じ）
#[test]
fn python_and_window_writing_together_lose_nothing() {
    for shared in [true, false] {
        let work = common::work(if shared { "masters-race-share" } else { "masters-race-local" });
        let sc = json!({"shared": shared, "files": {"data/equipment_master.json": []}});
        setup(&work, &sc);
        let names: Vec<String> = ["equipment_master", "roll_master"].iter().map(|s| s.to_string()).collect();
        let st = store_of(&work, &sc, &names);
        let n = 150;
        let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
        let child = std::process::Command::new(py)
            .arg(common::program().join("tests").join("masters_oracle.py"))
            .args(["--hammer", work.to_str().unwrap(), &n.to_string(), if shared { "shared" } else { "local" }])
            .env("PYTHONIOENCODING", "utf-8")
            .current_dir(common::program())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let wait_for = |name: &str| {
            let t0 = std::time::Instant::now();
            while !work.join(name).exists() {
                assert!(t0.elapsed().as_secs() < 60, "Python の印 {name} が来ない");
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        };
        wait_for("py_started");
        std::fs::write(work.join("rs_started"), "1").unwrap();
        // 3 分の 1・3 分の 2 で Python と待ち合わせる（どの区切りにも両方の行が入り、入れ替わりは必ず 3 回以上。時間に頼らない。
        // 版 3.80.0: 遅い CI で片方が書き終えてから、もう片方が書いて落ちた）
        let mut marks = vec![(n / 3, 1), (2 * n / 3, 2)];
        let mut ok = 0;
        let mut refused = 0;
        while ok < n {
            if let Some(i) = marks.iter().position(|(at, _)| *at == ok) {
                let (_, k) = marks.remove(i);
                std::fs::write(work.join(format!("rs_mark{k}")), "1").unwrap();
                wait_for(&format!("py_mark{k}"));
            }
            match st.write("equipment_master", |rows, stamp| {
                let mut row = json!({"id": next_id(rows), "by": "rs"});
                for (k, v) in stamp.as_object().unwrap() {
                    row[k] = v.clone();
                }
                rows.push(row);
                Ok(())
            }) {
                Ok(()) => ok += 1,
                Err(MasterError::Locked { .. }) => {
                    refused += 1;
                    std::thread::sleep(std::time::Duration::from_millis(3));
                }
                Err(e) => panic!("{shared}: {e:?}"),
            }
        }
        let out = child.wait_with_output().unwrap();
        assert!(out.status.success());
        let file = if shared { work.join("share/equipment_master.json") } else { work.join("data/equipment_master.json") };
        let v: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        let rows = if shared { v["rows"].as_array().unwrap().clone() } else { v.as_array().unwrap().clone() };
        let count = |who: &str| rows.iter().filter(|r| r["by"] == who).count();
        assert_eq!((count("py"), count("rs")), (n, n), "共有 {shared}: どちらの保存も消えない（窓が断られた回数 {refused}）");
        // 本当に取り合った（py と rs の行が入り混じる）
        let turns = rows.windows(2).filter(|w| w[0]["by"] != w[1]["by"]).count();
        assert!(turns >= 3, "共有 {shared}: 2 つの係が交互に書いていない（入れ替わり {turns} 回）");
        let mut ids: Vec<i64> = rows.iter().map(|r| r["id"].as_i64().unwrap()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 2 * n, "id が重ならない");
        let _ = std::fs::remove_dir_all(&work);
    }
}

fn plain_store(work: &Path, shared: bool, ttl: f64) -> Store {
    let names: Vec<String> = ["equipment_master", "roll_master"].iter().map(|s| s.to_string()).collect();
    store_of(work, &json!({"shared": shared, "ttl": ttl}), &names)
}

fn append(st: &Store, name: &str) -> Result<i64, MasterError> {
    st.write(name, |rows, stamp| {
        let mut row = json!({"id": next_id(rows)});
        for (k, v) in stamp.as_object().unwrap() {
            row[k] = v.clone();
        }
        rows.push(row);
        Ok(rows.len() as i64)
    })
}

/// 版が端（i64 の最大）なら書かずに理由を付けて断り、ファイルを変えず、錠を残さない（大きな整数・NaN・Infinity は版 3.107.0・3.108.0 から
/// 持ったまま書き戻す）。版の字（真偽・"1_0"）は Python の int() と同じに読む
#[test]
fn numbers_the_window_cannot_keep_are_refused() {
    let work = common::work("masters-numbers");
    setup(&work, &json!({"shared": true, "files": {}}));
    let st = plain_store(&work, true, 20.0);
    let share = work.join("share/equipment_master.json");
    // 版 3.107.0: NaN・Infinity・1E400 は src/held.rs が J のまま持ち、Python の json.dumps と同じ字（NaN・Infinity）で書き戻す（下で確かめる）
    // 版 3.108.0（H2）: i64・u64 に入らない整数も J のまま持ち、桁のまま書き戻す（前は断った。下で確かめる）
    {
        let (body, why) = (r#"{"schema": 1, "revision": 9223372036854775807, "rows": []}"#, "版の端");
        std::fs::write(&share, body).unwrap();
        let e = append(&st, "equipment_master").expect_err(why);
        assert_eq!(e.kind(), "error", "{why}: {e:?}");
        assert_eq!(std::fs::read_to_string(&share).unwrap(), body, "{why}: ファイルを変えない");
        assert!(!work.join("share").join(LOCK_FILENAME).exists(), "{why}: 錠を残さない");
    }
    // 大きな整数の行は桁のまま書き戻し、次の id も桁で数える（Python の int と同じ。版 3.108.0）
    std::fs::write(&share, r#"{"schema": 1, "revision": 1, "rows": [{"id": 100000000000000000000, "big": -123456789012345678901234}]}"#)
        .unwrap();
    let t = {
        append(&st, "equipment_master").expect("大きな整数");
        std::fs::read_to_string(&share).unwrap()
    };
    assert!(t.contains(r#""big": -123456789012345678901234"#) && t.contains(r#""id": 100000000000000000001"#), "{t}");
    // NaN・1E400 の行は持ったまま書き戻す（Python の json.dumps と同じ NaN・Infinity の字。版 3.107.0）
    std::fs::write(&share, r#"{"schema": 1, "revision": 1, "rows": [{"id": 1, "x": NaN, "y": [1E400, -Infinity]}]}"#).unwrap();
    assert_eq!(append(&st, "equipment_master").unwrap(), 2);
    let t = std::fs::read_to_string(&share).unwrap();
    assert!(t.contains(r#""x": NaN"#) && t.contains("Infinity,") && t.contains("-Infinity"), "{t}");
    let v = common::file_value(t.as_bytes());
    assert_eq!((v["rows"][1]["id"].clone(), v["revision"].clone()), (json!(2), json!(2)), "{v}");
    // 字の中の大きな数・u64 に入る数は書ける
    std::fs::write(
        &share,
        r#"{"schema": 1, "revision": 1, "rows": [{"id": 1, "s": "123456789012345678901234", "u": 18446744073709551615}]}"#,
    )
    .unwrap();
    append(&st, "equipment_master").unwrap();
    let v: Value = serde_json::from_slice(&std::fs::read(&share).unwrap()).unwrap();
    assert_eq!(v["rows"][0]["u"], json!(18446744073709551615u64));
    // 版の字
    for (rev, want) in [(json!(true), 2), (json!("1_0"), 11), (json!(" 7 "), 8), (json!(3.9), 4)] {
        std::fs::write(&share, serde_json::to_vec(&json!({"schema": 1, "revision": rev, "rows": []})).unwrap()).unwrap();
        append(&st, "equipment_master").unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(&share).unwrap()).unwrap();
        assert_eq!(v["revision"], json!(want), "版 {rev}");
    }
    let _ = std::fs::remove_dir_all(&work);
}

/// 2 つの置き場の Store を同じ糸で使っても、錠の置き場が混ざらない（Python の _where は MasterStore ごと）。
/// panic しても錠の置き場と錠は元へ戻る
#[test]
fn stores_keep_their_own_lock_place() {
    let a_dir = common::work("masters-two-a");
    let b_dir = common::work("masters-two-b");
    for d in [&a_dir, &b_dir] {
        setup(d, &json!({"shared": true, "files": {}}));
    }
    let (a, b) = (plain_store(&a_dir, true, 20.0), plain_store(&b_dir, true, 20.0));
    // B の置き場にはほかの PC の生きた錠がある。A の exclusive の中で B が書いても、B は自分の置き場の錠を見て断る
    std::fs::write(b_dir.join("share").join(LOCK_FILENAME), serde_json::to_vec(&lock_body("other", 15.0)).unwrap()).unwrap();
    let inner = a.exclusive(|| Ok(append(&b, "equipment_master"))).unwrap();
    assert!(matches!(inner, Err(MasterError::Locked { .. })), "B は B の置き場の錠で断る: {inner:?}");
    assert!(!b_dir.join("share/equipment_master.json").exists(), "B は書いていない");
    // 手元のマスタを書く途中で panic しても、次の共有の書き込みは共有の錠を見る（data/ の錠を見て、生きた錠を無視しない）
    let c_dir = common::work("masters-panic");
    setup(&c_dir, &json!({"shared": true, "files": {}}));
    let c = plain_store(&c_dir, true, 20.0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.write("card_forms", |_rows, _stamp| -> Result<(), MasterError> { panic!("書く途中で落ちた") });
    }));
    assert!(r.is_err());
    assert!(!c_dir.join("data").join(LOCK_FILENAME).exists(), "panic しても data/ の錠を外す");
    std::fs::write(c_dir.join("share").join(LOCK_FILENAME), serde_json::to_vec(&lock_body("other", 15.0)).unwrap()).unwrap();
    assert!(matches!(append(&c, "equipment_master"), Err(MasterError::Locked { .. })), "共有の錠を見る");
    for d in [&a_dir, &b_dir, &c_dir] {
        let _ = std::fs::remove_dir_all(d);
    }
}

/// 窓の SHARED_ALWAYS（共有フォルダがあればいつも共有するマスタ）が Python と同じ
#[test]
fn shared_always_matches_python() {
    let base = common::work("masters-shared");
    let oracle = common::python_json("masters_oracle.py", &[base.join("py").to_str().unwrap()]);
    let py: Vec<String> = oracle[0]["config"]["shared"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
    let mut rs: Vec<String> = da_core::master_store::SHARED_ALWAYS.iter().map(|s| s.to_string()).collect();
    rs.extend(["equipment_master".to_string(), "roll_master".to_string()]);
    rs.sort();
    rs.dedup();
    assert_eq!(rs, py);
    let _ = std::fs::remove_dir_all(&base);
}
