//! 置き場と設定（版 3.100.0）の事例の表 program/tests/fixtures/place_cases.json を、窓が既に持つ同じ部品で読む（Python は
//! tests/test_place_cases.py が同じ表を読み、答えは tools/place-truth.py〈app を import しない独立の答え〉でも確かめ直す）。
//! 3.100.0 で窓が読むのは、フォルダの名前（release_place::check_name。配布の置き場とマスタの置き場の確かめ）とタブの例外の読み方
//! （access::tab_exceptions）。版 3.101.0 で 8 本を窓へ移し、残りの節（sort・clean・sync・marks・moves・moveRaces・tabCounts・blank・hidden）も
//! 窓の部品（folder_browse・master_place・builder::settings_check・access::tab_exception_counts）で読む。引っ越しの写す物・写す量・
//! ほかの PC の行は、独立の答え（tools/place-truth.py の --copied・--tree-size・--followed・--rows。app を import しない）と比べる。
//! Windows では、道の比べ（同じ所・中）に使う normcase が Python 3.13 の ntpath.normcase（LCMapStringEx）と全部の BMP の字で同じかも見る。

use da_core::master_store::{Config, Store, SHARED_ALWAYS};
use da_core::{access, builder, folder_browse, master_place, release_place};
use serde_json::{json, Map, Value};
use std::path::PathBuf;

fn cases() -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixtures/place_cases.json");
    serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap()
}

#[test]
fn names_match_the_table() {
    let c = cases();
    let names = c["names"].as_array().unwrap();
    assert!(names.len() > 60, "事例の数");
    for cs in names {
        let name = cs["name"].as_str().unwrap();
        let got = release_place::check_name(name);
        if cs["ok"].as_bool().unwrap() {
            assert_eq!(got.as_deref(), Ok(cs["want"].as_str().unwrap()), "{name:?}");
        } else {
            assert_eq!(got.as_ref().map_err(String::as_str), Err(cs["problem"].as_str().unwrap()), "{name:?}");
        }
    }
}

#[test]
fn tab_exceptions_match_the_table() {
    let c = cases();
    for cs in c["tabExceptions"].as_array().unwrap() {
        let v = &cs["value"];
        let got = access::tab_exceptions(if v.is_null() { None } else { Some(v) }).expect("壊れた例外は空として読む（Err にしない）");
        let mut m = Map::new();
        for (t, hide) in got {
            m.insert(t, json!(if hide { "出さない" } else { "出す" }));
        }
        assert_eq!(Value::Object(m), cs["want"], "{v}");
    }
}

/// Windows の CI: normcase（LCMapStringEx）が Python の ntpath.normcase と全部の BMP の字（代用字を除く）で同じ
#[cfg(windows)]
#[test]
fn normcase_is_pythons() {
    let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| "python".into());
    let script = "import json, ntpath, sys\n\
                  cs = [chr(i) for i in range(0x10000) if not 0xD800 <= i < 0xE000]\n\
                  sys.stdout.buffer.write(json.dumps([ntpath.normcase(c) for c in cs]).encode('ascii'))";
    let out = std::process::Command::new(&py).args(["-c", script]).output().expect("Python を起こせない");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let want: Vec<String> = serde_json::from_slice(&out.stdout).unwrap();
    let chars: Vec<char> = (0u32..0x10000).filter_map(char::from_u32).collect();
    assert_eq!(chars.len(), want.len());
    let bad: Vec<String> = chars
        .iter()
        .zip(&want)
        .filter(|(c, w)| release_place::normcase(&c.to_string()) != **w)
        .take(20)
        .map(|(c, w)| format!("U+{:04X} 窓 {:?} / Python {:?}", *c as u32, release_place::normcase(&c.to_string()), w))
        .collect();
    assert!(bad.is_empty(), "{bad:#?}");
    assert_eq!(release_place::normcase("C:/Ａ/İ/Masters"), want_of(&py, "C:/Ａ/İ/Masters"));
}

#[cfg(windows)]
fn want_of(py: &str, s: &str) -> String {
    let out = std::process::Command::new(py)
        .args([
            "-c",
            "import json, ntpath, sys; sys.stdout.buffer.write(json.dumps(ntpath.normcase(json.loads(sys.argv[1]))).encode('ascii'))",
            &json!(s).to_string(),
        ])
        .output()
        .unwrap();
    serde_json::from_slice(&out.stdout).unwrap()
}

fn program() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../program")
}

/// 独立の答え（tools/place-truth.py）に尋ねる
fn truth(args: &[&str]) -> Value {
    let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
    let out = std::process::Command::new(&py)
        .arg(program().join("tools").join("place-truth.py"))
        .args(args)
        .env("PYTHONIOENCODING", "utf-8")
        .output()
        .expect("Python を起こせない");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
}

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("da-placecases-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn os_ok(cs: &Value) -> bool {
    match cs["os"].as_str() {
        Some("posix") => cfg!(unix),
        Some("nt") => cfg!(windows),
        _ => true,
    }
}

#[test]
fn sort_clean_sync_tabcounts_match_the_table() {
    let c = cases();
    for cs in c["sort"].as_array().unwrap() {
        let want: Vec<String> = cs.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
        let mut rev = want.clone();
        rev.reverse();
        assert_eq!(folder_browse::sorted(&rev), want, "並び");
        assert_eq!(folder_browse::sorted(&want), want, "並び");
    }
    for cs in c["clean"].as_array().unwrap().iter().filter(|c| os_ok(c)) {
        assert_eq!(folder_browse::clean(cs["text"].as_str().unwrap()).as_deref(), cs["want"].as_str(), "道の字 {}", cs["text"]);
    }
    for cs in c["sync"].as_array().unwrap() {
        assert_eq!(master_place::sync_folder(cs["path"].as_str().unwrap()), cs["kind"].as_str().unwrap(), "{}", cs["path"]);
    }
    for cs in c["tabCounts"].as_array().unwrap() {
        let rows: Vec<Map<String, Value>> = cs["rows"].as_array().unwrap().iter().map(|r| r.as_object().unwrap().clone()).collect();
        assert_eq!(Value::Object(access::tab_exception_counts(&rows)), cs["want"], "{}", cs["name"]);
    }
}

#[test]
fn marks_match_the_table() {
    let c = cases();
    let base = tmp("marks");
    for (i, cs) in c["marks"].as_array().unwrap().iter().enumerate().filter(|(_, c)| os_ok(c)) {
        let up = base.join(format!("u{i}"));
        let d = up.join("m");
        std::fs::create_dir_all(&d).unwrap();
        for n in cs["files"].as_array().into_iter().flatten() {
            std::fs::write(d.join(n.as_str().unwrap()), "x").unwrap();
        }
        for n in cs["dirs"].as_array().into_iter().flatten() {
            std::fs::create_dir(d.join(n.as_str().unwrap())).unwrap();
        }
        let (purpose, pattern) = (cs["purpose"].as_str().unwrap(), cs["pattern"].as_str().unwrap_or(""));
        let here = folder_browse::browse(&d.to_string_lossy(), purpose, pattern, 4.0).unwrap();
        assert_eq!(here["mark"].get("text").cloned().unwrap_or(Value::Null), cs["want"], "いまのフォルダの印: {}", cs["name"]);
        let above = folder_browse::browse(&up.to_string_lossy(), purpose, pattern, 4.0).unwrap();
        let e = above["entries"].as_array().unwrap().iter().find(|e| e["name"] == "m").unwrap();
        assert_eq!(e["mark"].get("text").cloned().unwrap_or(Value::Null), cs["want"], "上のフォルダの並びの印: {}", cs["name"]);
    }
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn blank_values_match_the_table() {
    for cs in cases()["blank"].as_array().unwrap() {
        let key = cs["key"].as_str().unwrap();
        let mut settings = json!({});
        let parts: Vec<&str> = key.split('.').collect();
        let mut cur = &mut settings;
        for p in &parts[..parts.len() - 1] {
            cur = cur.as_object_mut().unwrap().entry(p.to_string()).or_insert(json!({}));
        }
        cur[parts[parts.len() - 1]] = cs["default"].clone();
        let body = json!({"key": key, "value": cs["value"]}).to_string();
        let (status, got) = builder::settings_check(body.as_bytes(), &settings, &settings, "*.sqlite3").expect("窓が答える");
        assert_eq!(status, 200);
        if cs["want"].is_null() {
            assert_ne!(got["message"], "値を入れてください。", "exe は空で Edge を探す");
        } else {
            assert_eq!(got["message"], cs["want"], "{key}");
        }
    }
}

/// 書く係（Python の MoveBase.store と同じ形: 同梱の data/ を写した base・PC ごとの作業場所）
fn store(base: &std::path::Path, pc: &str, share: Option<&std::path::Path>, ttl: f64) -> std::sync::Arc<Store> {
    let mut shared: Vec<String> = SHARED_ALWAYS.iter().map(|s| s.to_string()).collect();
    shared.extend(["roll_master".to_string(), "equipment_master".to_string()]);
    std::sync::Arc::new(Store::new(Config {
        data: base.join("base").join("data"),
        defaults: program().join("app").join("master_defaults"),
        share_dir: share.map(|p| p.to_path_buf()),
        shared,
        cache: base.join(pc).join("master_cache"),
        local_root: base.join(pc),
        pc: pc.into(),
        login: "u".into(),
        role: "rs".into(),
        lock_ttl: ttl,
    }))
}

fn move_base(name: &str) -> PathBuf {
    let d = tmp(name);
    let data = d.join("base").join("data");
    std::fs::create_dir_all(&data).unwrap();
    for e in std::fs::read_dir(program().join("data")).unwrap().flatten() {
        if e.path().is_file() {
            std::fs::copy(e.path(), data.join(e.file_name())).unwrap();
        }
    }
    std::fs::create_dir_all(d.join("nas")).unwrap();
    d
}

fn tree_bytes(folder: &std::path::Path) -> Map<String, Value> {
    let mut out = Map::new();
    fn walk(d: &std::path::Path, root: &std::path::Path, out: &mut Map<String, Value>) {
        for e in std::fs::read_dir(d).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, root, out);
            } else {
                let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                out.insert(rel, json!(da_core::bundle::sha1_hex(&std::fs::read(&p).unwrap())));
            }
        }
    }
    walk(folder, folder, &mut out);
    out
}

#[test]
fn moves_copy_what_the_share_holds() {
    let c = cases();
    for (i, cs) in c["moves"].as_array().unwrap().iter().enumerate() {
        let d = move_base(&format!("moves{i}"));
        let share = d.join("nas").join(format!("Old{i}"));
        for (rel, body) in cs["share"].as_object().unwrap() {
            let p = rel.split('/').fold(share.clone(), |p, s| p.join(s));
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            let text = match body {
                Value::String(s) => s.clone(),
                v => serde_json::to_string_pretty(v).unwrap(),
            };
            std::fs::write(&p, text).unwrap();
        }
        let held = tree_bytes(&share);
        let a = store(&d, &format!("pc{i}"), Some(&share), 20.0);
        let cwd = program();
        let pl = master_place::plan(&a, &d.join("nas").to_string_lossy(), &format!("New{i}"), &cwd).unwrap();
        assert_eq!(pl["ok"], true, "{pl}");
        let moved = match master_place::move_to(&a, &d.join("nas").to_string_lossy(), &format!("New{i}"), &cwd, &master_place::read_file) {
            Ok(v) => v,
            Err(_) => panic!("写せない"),
        };
        let dest = d.join("nas").join(format!("New{i}"));
        let mut want: Vec<String> = cs["copied"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
        want.sort();
        assert_eq!(truth(&["--copied", &share.to_string_lossy()]), json!(want), "独立の答えの写す物");
        let got = tree_bytes(&dest);
        assert_eq!(got.keys().cloned().collect::<Vec<_>>(), want, "写す物: {}", cs["name"]);
        for rel in &want {
            assert_eq!(got[rel], held[rel], "{rel} は錠を取った時の前の置き場の中身と同じ字");
        }
        let size = truth(&["--tree-size", &dest.to_string_lossy()]);
        assert_eq!(json!([pl["files"], pl["bytes"]]), size, "確かめた写す量＝実際に書いた量（独立の答え）");
        assert_eq!(json!([moved["files"], moved["bytes"]]), size);
        let _ = std::fs::remove_dir_all(&d);
    }
}

/// 引っ越しが錠の長さを超える場面（Python の MoveRaces と同じ形）。ほかの PC の行は、その PC が印をたどった先に必ずある
#[test]
fn a_save_while_a_slow_move_holds_the_lock_is_not_lost() {
    for cs in cases()["moveRaces"].as_array().unwrap() {
        let d = move_base("races");
        let cwd = program();
        let nas = d.join("nas").to_string_lossy().into_owned();
        let seed = store(&d, "pcS", None, 20.0);
        assert!(master_place::move_to(&seed, &nas, "Masters", &cwd, &master_place::read_file).is_ok());
        let share = d.join("nas").join("Masters");
        let hist = share.join("presence_tpa").join("history");
        std::fs::create_dir_all(&hist).unwrap();
        for i in 0..cs["presenceFiles"].as_u64().unwrap() {
            std::fs::write(hist.join(format!("PC-{i}@u.json")), "{}").unwrap();
        }
        let ttl = cs["lockTtl"].as_f64().unwrap();
        let a = store(&d, "pcA", Some(&share), ttl);
        let b = store(&d, "pcB", Some(&share), ttl);
        let master = cs["master"].as_str().unwrap().to_string();
        let started = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let delay = std::time::Duration::from_secs_f64(cs["readDelay"].as_f64().unwrap());
        let after = std::time::Duration::from_secs_f64(cs["saveAfter"].as_f64().unwrap());
        let other = {
            let (b, started, master) = (b.clone(), started.clone(), master.clone());
            std::thread::spawn(move || {
                while !started.load(std::sync::atomic::Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                std::thread::sleep(after);
                let end = std::time::Instant::now() + std::time::Duration::from_secs(20);
                while std::time::Instant::now() < end {
                    let r = b.write(&master, |rows, _| {
                        let rid = da_core::master_store::next_id(rows);
                        rows.push(json!({"id": rid, "ログインID": "race", "PC名": "", "権限区分": "一般ユーザー", "有効": "有", "rev": 1}));
                        Ok(rid)
                    });
                    if let Ok(rid) = r {
                        return Some(rid);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                None
            })
        };
        let st = started.clone();
        let slow = move |p: &std::path::Path| {
            st.store(true, std::sync::atomic::Ordering::SeqCst);
            std::thread::sleep(delay);
            std::fs::read(p)
        };
        let moved = master_place::move_to(&a, &nas, "New", &cwd, &slow);
        let rid = other.join().unwrap().expect("ほかの PC は保存できた");
        let where_ = truth(&["--followed", &share.to_string_lossy()]);
        let ids = truth(&["--rows", where_.as_str().unwrap(), &master]);
        assert!(
            ids.as_array().unwrap().contains(&json!(rid)),
            "印をたどった先（{where_}）に、ほかの PC の行がある（引っ越し: {}）",
            match &moved {
                Ok(_) => "切り替えた".to_string(),
                Err(master_place::MoveError::Invalid(m)) => m.clone(),
                Err(_) => "ほかの断り".to_string(),
            }
        );
        let left: Vec<String> =
            std::fs::read_dir(d.join("nas")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(!left.iter().any(|n| n.contains(".tmp-")), "写しかけを残さない: {left:?}");
        let _ = std::fs::remove_dir_all(&d);
    }
}

/// Windows の CI: 隠し・システムの属性の物は「参照…」に出さない（事例の表 hidden）
#[cfg(windows)]
#[test]
fn hidden_and_system_entries_are_not_listed() {
    let d = tmp("hidden");
    for cs in cases()["hidden"].as_array().unwrap() {
        let p = d.join(cs["name"].as_str().unwrap());
        if cs["file"] == true {
            std::fs::write(&p, "x").unwrap();
        } else {
            std::fs::create_dir(&p).unwrap();
        }
        let attrs = cs["attrs"].as_str().unwrap();
        if !attrs.is_empty() {
            let flags: Vec<String> = attrs.chars().map(|c| format!("+{c}")).collect();
            let st = std::process::Command::new("attrib").args(&flags).arg(&p).status().unwrap();
            assert!(st.success());
        }
    }
    let got = folder_browse::browse(&d.to_string_lossy(), "folder", "", 4.0).unwrap();
    let names: Vec<&str> = got["entries"].as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap()).collect();
    for cs in cases()["hidden"].as_array().unwrap() {
        if cs["file"] == true {
            continue; // 「参照…」のフォルダの欄はファイルを並べない（数は others）
        }
        assert_eq!(names.contains(&cs["name"].as_str().unwrap()), cs["shown"].as_bool().unwrap(), "{}", cs["name"]);
    }
    let shown_files = cases()["hidden"].as_array().unwrap().iter().filter(|c| c["file"] == true && c["shown"] == true).count();
    assert_eq!(got["others"], json!(shown_files), "隠しのファイルは数えない");
    for cs in cases()["hidden"].as_array().unwrap() {
        let _ = std::process::Command::new("attrib").args(["-h", "-s"]).arg(d.join(cs["name"].as_str().unwrap())).status();
    }
    let _ = std::fs::remove_dir_all(&d);
}

/// この PC の覚えを、確かめた後（名前を替えた後）に書けない（空きが尽きた形）: 写した置き場を消して元に戻し、前の置き場の印は書かない。
/// 前の置き場で保存してから同じ所をもう一度選ぶと、写して切り替える（古い写しへ切り替えない）。写した物は独立の答え（place-truth.py）と比べる
#[test]
fn a_failed_remember_rolls_back_and_the_retry_copies_the_share() {
    let d = move_base("remember");
    let cwd = program();
    let nas = d.join("nas").to_string_lossy().into_owned();
    let seed = store(&d, "pcS", None, 20.0);
    assert!(master_place::move_to(&seed, &nas, "Masters", &cwd, &master_place::read_file).is_ok());
    let share = d.join("nas").join("Masters");
    let a = store(&d, "pcA", Some(&share), 20.0);
    *master_place::TEST_REMEMBER_FAIL.lock().unwrap() = Some(d.join("pcA"));
    let r = master_place::move_to(&a, &nas, "New", &cwd, &master_place::read_file);
    *master_place::TEST_REMEMBER_FAIL.lock().unwrap() = None;
    match r {
        Err(master_place::MoveError::Invalid(m)) => assert!(m.contains("写した置き場を消して元に戻しました"), "{m}"),
        _ => panic!("断るはず"),
    }
    assert!(!d.join("nas").join("New").exists(), "写した置き場を消した");
    assert!(!share.join("_MOVED.json").exists(), "前の置き場の印は書かない");
    assert!(!d.join("pcA").join("master_share.json").exists(), "この PC の置き場は替わらない");
    // 覚えのファイルの所がフォルダ: 写す前に断る
    std::fs::create_dir_all(d.join("pcA").join("master_share.json")).unwrap();
    match master_place::move_to(&a, &nas, "New", &cwd, &master_place::read_file) {
        Err(master_place::MoveError::Invalid(m)) => assert!(m.contains("写す前に止めました"), "{m}"),
        _ => panic!("断るはず"),
    }
    assert!(!d.join("nas").join("New").exists());
    std::fs::remove_dir_all(d.join("pcA").join("master_share.json")).unwrap();
    // 前の置き場で保存 → やり直す
    let b = store(&d, "pcB", Some(&share), 20.0);
    let rid = b
        .write("roll_master", |rows, _| {
            let id = da_core::master_store::next_id(rows);
            rows.push(json!({"id": id, "設備": "TLV", "ロール名": "やり直しの前の保存", "rev": 1}));
            Ok(id)
        })
        .unwrap();
    let held = tree_bytes(&share);
    let pl = master_place::plan(&a, &nas, "New", &cwd).unwrap();
    assert_eq!(pl["mode"], "copy", "古い写しへ「写さずに切り替える」にならない: {pl}");
    assert!(master_place::move_to(&a, &nas, "New", &cwd, &master_place::read_file).is_ok());
    let dest = d.join("nas").join("New");
    let got = tree_bytes(&dest);
    assert_eq!(json!(got.keys().cloned().collect::<Vec<_>>()), truth(&["--copied", &share.to_string_lossy()]));
    for (rel, sha) in &got {
        assert_eq!(Some(sha), held.get(rel), "{rel} は錠を取った時の前の置き場の中身と同じ字");
    }
    let ids = truth(&["--rows", truth(&["--followed", &share.to_string_lossy()]).as_str().unwrap(), "roll_master"]);
    assert!(ids.as_array().unwrap().contains(&json!(rid)));
    let _ = std::fs::remove_dir_all(&d);
}

/// Windows の CI: 窓と Python は同じ写し（master_cache）を置き換え合う。相手が置き換えを許さずに開いている間の断りは 0.5 秒までやり直し
/// （master_store::write_mirror）、それを超えたら取り直せなかった理由を覚える（黙って古い写しのまま答えない。版 3.101.0 の作った後の採点の観察 2）
#[cfg(windows)]
#[test]
fn a_mirror_held_open_on_windows_is_retried_then_said() {
    use std::os::windows::fs::OpenOptionsExt;
    let d = move_base("winmirror");
    let share = d.join("nas").join("Masters");
    std::fs::create_dir_all(&share).unwrap();
    let doc = |rev: i64| json!({"schema": 1, "revision": rev, "rows": []}).to_string();
    std::fs::write(share.join("roll_master.json"), doc(1)).unwrap();
    let a = store(&d, "pcA", Some(&share), 20.0);
    a.refresh("roll_master");
    let mirror = a.mirror("roll_master");
    assert!(mirror.exists());
    for (hold_ms, ok) in [(200u64, true), (2000, false)] {
        let rev = if ok { 2 } else { 3 };
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(share.join("roll_master.json"), doc(rev)).unwrap();
        // FILE_SHARE_READ だけ（置き換え・消すを許さない開き方。ほかのアプリが写しを開いている形）
        let f = std::fs::OpenOptions::new().read(true).share_mode(1).open(&mirror).unwrap();
        let t = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(hold_ms));
            drop(f);
        });
        a.refresh("roll_master");
        t.join().unwrap();
        let (_, err) = a.sync_state();
        assert_eq!(err.is_empty(), ok, "開いている {hold_ms} ms: {err}");
        if ok {
            let v: Value = serde_json::from_slice(&std::fs::read(&mirror).unwrap()).unwrap();
            assert_eq!(v["revision"], rev);
        }
    }
    let _ = std::fs::remove_dir_all(&d);
}
