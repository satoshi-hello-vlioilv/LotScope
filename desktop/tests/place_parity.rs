//! マスタの置き場の 4 本（src/master_place.rs の handle・plan・move_to・status）が Python の道（routes/masters.py の GET /api/masters/status・
//! routes/settings.py の GET /api/masters/place・POST place/check・move と services/master_place.py）と同じ答えか（版 3.101.0）。
//! program/tests/place_oracle.py が場面ごとに同じ中身のフォルダを 3 つ（py・rs・pd）作り、py に Python の道で問い合わせの並びを当てる。
//! ここでは rs に同じ並びを窓の道（Lot::place_route と同じ順: ?engine=python → 道 → move は門番 → plan → 写して切り替える）で当て、
//! 1 歩ごとの答え（状態・本文。断る言葉も 1 字まで）と、終わった後のフォルダの中身（引っ越し先のマスタ・利用状況の記録・前の置き場の印・
//! この PC の覚え・写し）を突き合わせる。窓が答えず Python に任せる歩（delegates）は、窓が答えないことを見る。
//! 比べない所: 場面のフォルダの道（@ROOT にそろえる）・時刻（<時刻>）・一時フォルダの名前の印。
//! 種まきの競い合い（版 3.105.0 から窓も種をまく）: 空の共有を、窓 2 つ（別の PC）と Python（別のプロセス）が合図で一斉に読み、
//! どのマスタも置かれるのは 1 回だけ（錠の中で共有を見直す Store::seed・Python の _seed）・中身は置いた者の写しで壊れない・
//! 錠も一時ファイルも残らない・まき終えた後の 3 つの答えは同じ。

mod common;

use da_core::access::Gate;
use da_core::master_place::{handle, route_of, Local};
use da_core::master_store::Store;
use serde_json::{json, Map, Value};
use std::path::Path;
use std::sync::Arc;

fn norm(v: &Value, root: &str) -> Value {
    match v {
        Value::String(s) => {
            let s = s.replace(root, "@ROOT");
            let s = regex::Regex::new(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d").unwrap().replace_all(&s, "<時刻>").into_owned();
            let s = regex::Regex::new(r"\.(tmp|probe)-[0-9a-f]{8}").unwrap().replace_all(&s, ".$1-<印>").into_owned();
            json!(s)
        }
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.replace(root, "@ROOT"), norm(x, root))).collect()),
        Value::Array(a) => Value::Array(a.iter().map(|x| norm(x, root)).collect()),
        _ => v.clone(),
    }
}

/// 錠の「あと何秒」（remaining と「あと約 n 秒」）。錠を最初に見てからの経過で数えるので、Python と窓で歩の間の時間が
/// 違えば 1 秒ほどずれる（Windows の CI で 20 / 19）。両方の秒を取り出して返し、答えからは伏せる
fn lock_secs(v: &Value, out: &mut Vec<i64>) -> Value {
    let re = regex::Regex::new(r"あと約(\d+)秒").unwrap();
    match v {
        Value::String(s) => {
            out.extend(re.captures_iter(s).filter_map(|c| c[1].parse::<i64>().ok()));
            json!(re.replace_all(s, "あと約<秒>秒").into_owned())
        }
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| match (k.as_str(), x.as_i64()) {
                    ("remaining", Some(n)) => {
                        out.push(n);
                        (k.clone(), json!("<秒>"))
                    }
                    _ => (k.clone(), lock_secs(x, out)),
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(|x| lock_secs(x, out)).collect()),
        _ => v.clone(),
    }
}

/// 両方の秒が同じ数だけあり、どれも錠の長さ（20 秒）の内で、差が 2 秒以内なら伏せた形を返す（揺れ以外の食い違いは前どおり拾う）
fn same_lock_wait(want: &Value, got: &Value) -> Option<(Value, Value)> {
    let (mut ws, mut gs) = (vec![], vec![]);
    let (w, g) = (lock_secs(want, &mut ws), lock_secs(got, &mut gs));
    let ok = !ws.is_empty()
        && ws.len() == gs.len()
        && ws.iter().zip(&gs).all(|(a, b)| (1..=21).contains(a) && (1..=21).contains(b) && (a - b).abs() <= 2);
    ok.then_some((w, g))
}

fn sub(x: &str, root: &str) -> String {
    x.replace("@ROOT", root)
}

fn sub_json(x: &str, root: &str) -> String {
    let esc = serde_json::to_string(root).unwrap();
    x.replace("@ROOT", &esc[1..esc.len() - 1])
}

/// フォルダの中身（place_oracle.py の listing と同じ形）
fn listing(root: &Path) -> Map<String, Value> {
    let mut out = Map::new();
    fn walk(dir: &Path, root: &Path, out: &mut Map<String, Value>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            if rel == "app" || rel.starts_with("app/") {
                continue;
            }
            if p.is_dir() {
                out.insert(rel, json!({"type": "dir"}));
                walk(&p, root, out);
                continue;
            }
            let body = match std::fs::read(&p) {
                Err(_) => json!("<読めない>"),
                Ok(raw) => {
                    let raw = raw.strip_prefix(b"\xef\xbb\xbf").map(|r| r.to_vec()).unwrap_or(raw);
                    let text = String::from_utf8_lossy(&raw).into_owned();
                    if rel.ends_with(".json") {
                        serde_json::from_str(&text).unwrap_or(json!(text))
                    } else {
                        json!(text)
                    }
                }
            };
            out.insert(rel, json!({"type": "file", "body": body}));
        }
    }
    walk(root, root, &mut out);
    out
}

/// 独立の答え（tools/place-truth.py）に尋ねる
fn truth(args: &[&str]) -> Value {
    let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
    let out = std::process::Command::new(&py)
        .arg(common::program().join("tools").join("place-truth.py"))
        .args(args)
        .env("PYTHONIOENCODING", "utf-8")
        .output()
        .expect("Python を起こせない");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
}

/// フォルダの中のファイルの相対の道（/ 区切り）
fn collect(d: &Path, root: &Path, out: &mut Vec<String>) {
    for e in std::fs::read_dir(d).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(&p, root, out);
        } else {
            out.push(p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"));
        }
    }
}

fn store_of(conf: &Value) -> Arc<Store> {
    Arc::new(Store::from_access(conf, "rs").expect("置き場の材料"))
}

/// 窓の道で 1 歩答える（None は Python に任せる）
fn answer(conf: &Value, store: &Arc<Store>, st: &Value, root: &str) -> Option<(u16, Value)> {
    let (method, path) = (st["method"].as_str().unwrap(), st["path"].as_str().unwrap());
    let route = route_of(method, path).expect("置き場の道");
    let mut c = conf.clone();
    let (login, pc) = (st["who"][0].as_str().unwrap(), st["who"][1].as_str().unwrap());
    c["who"]["login"] = json!(login);
    c["who"]["pc"] = json!(pc);
    c["who"]["key"] = json!(da_core::bundle::terminal_key(login, pc));
    let pdir = Path::new(c["place"]["presence"].as_str().unwrap()).to_path_buf();
    let revoke = pdir.join(format!("{}.revoke.json", da_core::bundle::terminal_key("c1", "PC-4")));
    if st["revoke"] == true {
        std::fs::create_dir_all(&pdir).unwrap();
        let at = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        std::fs::write(&revoke, json!({"by": "boss", "byPc": "PC-1", "reason": "点検", "at": at}).to_string()).unwrap();
    }
    let me = || Gate::default().me(&c);
    let local = Local { configured: conf["configured"].as_str().unwrap_or("").into(), root: store.local_root().to_path_buf() };
    let body = sub_json(st["body"].as_str().unwrap_or(""), root);
    // 書く道の本文の門（版 3.104.0。本物の道 Lot::handle_body と同じく部品より先）
    let r = match common::gate(method, path, body.as_bytes()) {
        Err(a) => Some(a),
        Ok(b) => handle(route, st["query"].as_str().unwrap_or(""), &b, store, &local, &me, &common::program()),
    };
    if st["revoke"] == true {
        let _ = std::fs::remove_file(&revoke);
    }
    r
}

/// 写して切り替えた後の置き場（窓は次に束を組むとき、この PC の覚え master_share.json から読む: Lot::place_route）
fn follow(conf: &mut Value, rs: &Path) {
    let ov: Value = serde_json::from_slice(&std::fs::read(rs.join("local/master_share.json")).unwrap()).unwrap();
    let dir = ov["dir"].as_str().unwrap().to_string();
    conf["place"]["shareDir"] = json!(dir);
    conf["place"]["presence"] = json!(Path::new(&dir).join("presence_tpa").to_string_lossy());
}

#[test]
fn master_place_matches_python() {
    let base = common::work("place");
    let oracle = common::python_json("place_oracle.py", &[base.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut steps, mut delegated, mut moved) = (0, 0, 0);
    for sc in oracle["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let (py, rs) = (sc["roots"]["py"].as_str().unwrap(), sc["roots"]["rs"].as_str().unwrap());
        let mut conf = sc["conf"].clone();
        let mut store = store_of(&conf);
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            if let Some(op) = st["do"].as_str() {
                match op {
                    "rename" => std::fs::rename(sub(st["a"].as_str().unwrap(), rs), sub(st["b"].as_str().unwrap(), rs)).unwrap(),
                    "remove" => std::fs::remove_file(sub(st["path"].as_str().unwrap(), rs)).unwrap(),
                    "rmtree" => std::fs::remove_dir_all(sub(st["path"].as_str().unwrap(), rs)).unwrap(),
                    "write" => std::fs::write(sub(st["path"].as_str().unwrap(), rs), st["text"].as_str().unwrap()).unwrap(),
                    x => panic!("知らない do: {x}"),
                }
                continue;
            }
            steps += 1;
            let Some((status, got)) = answer(&conf, &store, st, rs) else {
                bad.push(format!("{name} [{i}] 窓が答えない: {} {} {}", st["method"], st["path"], st["body"]));
                continue;
            };
            let (want, gotn) = (norm(&st["json"], py), norm(&got, rs));
            let (want, gotn) = same_lock_wait(&want, &gotn).unwrap_or((want, gotn));
            if status as i64 != st["status"].as_i64().unwrap_or(0) || common::diff(&want, &gotn, "").is_some() {
                bad.push(format!(
                    "{name} [{i}] {} {} {}: {}\n  Python {} {want}\n  窓     {status} {gotn}",
                    st["method"].as_str().unwrap(),
                    st["path"].as_str().unwrap(),
                    st["body"],
                    common::diff(&want, &gotn, "").unwrap_or_default(),
                    st["status"]
                ));
            }
            if st["path"] == "/api/masters/place/move" && status == 200 {
                moved += 1;
                if name.contains("覚えを書けない") {
                    // やり直しで切り替えた先の写した物＝前の置き場の今の中身（独立の答え place-truth.py の --copied と同じ名前・同じ字）
                    let (old, new) = (Path::new(rs).join("share"), Path::new(rs).join("nas").join("New"));
                    let want = truth(&["--copied", &old.to_string_lossy()]);
                    let mut got: Vec<String> = vec![];
                    collect(&new, &new, &mut got);
                    got.sort();
                    if json!(got) != want {
                        bad.push(format!("{name}: 写した物 {got:?} / 独立の答え {want}"));
                    }
                    for rel in &got {
                        if std::fs::read(new.join(rel)).ok() != std::fs::read(old.join(rel)).ok() {
                            bad.push(format!("{name}: {rel} が前の置き場の中身と違う"));
                        }
                    }
                }
                follow(&mut conf, Path::new(rs));
                store = store_of(&conf);
            }
        }
        for st in sc["delegates"].as_array().unwrap() {
            delegated += 1;
            if let Some((status, got)) = answer(&conf, &store, st, rs) {
                bad.push(format!(
                    "{name}: 窓が答えた（Python に任せるはず） {} {} {}: 窓 {status} {got}",
                    st["method"], st["path"], st["body"]
                ));
            }
        }
        let got = listing(Path::new(rs));
        let want = sc["files"].as_object().unwrap();
        let (gotn, wantn) = (norm(&Value::Object(got), rs), norm(&Value::Object(want.clone()), py));
        let (g, w) = (gotn.as_object().unwrap(), wantn.as_object().unwrap());
        for k in g.keys().filter(|k| k.contains(".tmp-") || k.contains(".probe-") || k.ends_with("master.lock.json")) {
            bad.push(format!("{name}: 片付け忘れ {k}"));
        }
        for k in w.keys().chain(g.keys()) {
            if let Some(d) = common::diff(w.get(k).unwrap_or(&Value::Null), g.get(k).unwrap_or(&Value::Null), k) {
                bad.push(format!("{name}: フォルダの中身 {d}"));
            }
        }
    }
    eprintln!("歩 {steps}・写して切り替えた歩 {moved}・Python に任せた歩 {delegated}");
    // 版 3.105.0: 任せた歩の下限は置かない（任せる歩は 0 へ減らしていく数で、減らすたびに落ちる。任せるはずの歩を窓が答えないことは歩ごとの確かめが、上限は予算〈common::check_budget〉が見る）
    assert!(steps >= 61 && moved >= 4, "歩が少ない: {steps}・{delegated}・{moved}");
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 窓と Python が置き場の状態に答える（Python は別のプロセス。seededByPython はこの Python が共有に最初の版を置いた名前）
fn python_status(root: &str, ready_go: Option<(&Path, &Path)>) -> Value {
    let mut args = vec!["--status".to_string(), root.to_string()];
    if let Some((ready, go)) = ready_go {
        args.extend(["--ready".into(), ready.to_string_lossy().into_owned(), "--go".into(), go.to_string_lossy().into_owned()]);
    }
    let a: Vec<&str> = args.iter().map(String::as_str).collect();
    common::python_json("place_oracle.py", &a)
}

/// 種まきの競い合い（版 3.105.0。前は「種まきは Python の 1 か所」で、要る間は窓が答えなかった）: 空の共有を、窓 2 つ（別の PC:
/// 作業場所と写しが別。A は Python と同じ PC）と Python（別のプロセス）が同時に読む（Python が支度を終えた印を見てから、合図で一斉に）。
/// 見ること（5 回くり返す）: どのマスタも共有に置かれるのは 1 回だけ（窓の Store::seeded と Python が置いた名前の和）・置かれた中身は
/// 置いた者の写し（A・Python は版 4 の「写しA」、B は版 7 の「写しB」）か最初の中身で壊れていない・錠も一時ファイルも残らない・
/// まき終えた後の窓 2 つと Python の答えが同じ（置いた人・時刻・錠・名乗りは比べない）
#[test]
fn an_empty_share_is_seeded_once_by_whoever_comes_first() {
    let base = common::work("place-seed");
    let oracle = common::python_json("place_oracle.py", &[base.join("oracle").to_str().unwrap()]);
    let sc = oracle["scenarios"].as_array().unwrap().iter().find(|s| s["name"].as_str().unwrap().contains("空の共有")).unwrap();
    let rs = sc["roots"]["rs"].as_str().unwrap().to_string();
    let route = route_of("GET", "/api/masters/status").unwrap();
    let mut seeders = std::collections::BTreeMap::<&str, usize>::new();
    for round in 0..5 {
        // 場面の窓のフォルダ（Python がまだ触っていない形）を写して使う
        let root = base.join(format!("r{round}"));
        let copy = |from: &Path, to: &Path| {
            fn walk(a: &Path, b: &Path) {
                std::fs::create_dir_all(b).unwrap();
                for e in std::fs::read_dir(a).unwrap().flatten() {
                    let (x, y) = (e.path(), b.join(e.file_name()));
                    if x.is_dir() {
                        walk(&x, &y);
                    } else {
                        std::fs::copy(&x, &y).unwrap();
                    }
                }
            }
            walk(from, to);
        };
        copy(Path::new(&rs), &root);
        let r = root.to_string_lossy().into_owned();
        let conf_a: Value = serde_json::from_str(&sub_json(&sc["conf"].to_string().replace(&sub_json("@ROOT", &rs), "@ROOT"), &r)).unwrap();
        // B は別の PC（作業場所・写し・名乗りが別）
        let local_b = root.join("localB");
        std::fs::create_dir_all(local_b.join("master_cache")).unwrap();
        std::fs::write(local_b.join("instance_id"), "instB").unwrap();
        let mut conf_b = conf_a.clone();
        conf_b["place"]["cache"] = json!(local_b.join("master_cache").to_string_lossy());
        conf_b["who"]["pc"] = json!("PC-B");
        let doc = |who: &str, rev: i64| json!({"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": [{"id": 1, "設備名": who}]});
        let cache_a = Path::new(conf_a["place"]["cache"].as_str().unwrap()).to_path_buf();
        std::fs::create_dir_all(&cache_a).unwrap();
        std::fs::write(cache_a.join("equipment_master.json"), doc("写しA", 4).to_string()).unwrap();
        std::fs::write(local_b.join("master_cache/equipment_master.json"), doc("写しB", 7).to_string()).unwrap();
        let share = root.join("share");
        let absent: Vec<&str> = da_core::master_place::STATUS_NAMES
            .iter()
            .copied()
            .filter(|n| conf_a["place"]["shared"].as_array().unwrap().contains(&json!(n)) && !share.join(format!("{n}.json")).exists())
            .collect();
        assert!(absent.len() >= 10 && absent.contains(&"equipment_master"), "空の共有に無いマスタ: {absent:?}");
        let (sa, sb) = (store_of(&conf_a), store_of(&conf_b));
        let ask = |store: &Arc<Store>, conf: &Value| {
            let local = Local { configured: conf["configured"].as_str().unwrap_or("").into(), root: store.local_root().to_path_buf() };
            let c = conf.clone();
            let me = move || Gate::default().me(&c);
            handle(route, "", b"", store, &local, &me, &common::program()).expect("窓が答える（版 3.105.0 から種まきも）").1
        };
        // Python が支度を終えてから、合図で 3 つが一斉に尋ねる
        let (ready, go) = (root.join("ready"), root.join("go"));
        let py = std::thread::spawn({
            let (r, ready, go) = (r.clone(), ready.clone(), go.clone());
            move || python_status(&r, Some((&ready, &go)))
        });
        while !ready.exists() {
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        let start = std::sync::Barrier::new(3);
        std::thread::scope(|s| {
            s.spawn(|| {
                start.wait();
                ask(&sa, &conf_a)
            });
            s.spawn(|| {
                start.wait();
                ask(&sb, &conf_b)
            });
            start.wait();
            std::fs::write(&go, "1").unwrap();
        });
        let in_race = py.join().unwrap();
        // まき終えた後: Python・窓 A・窓 B の順に尋ね直す（競い合いで錠に当たって置けなかった名前があれば、ここで置かれる）
        let after = python_status(&r, None);
        let (ga, gb) = (ask(&sa, &conf_a), ask(&sb, &conf_b));
        let names = |v: &Value| -> Vec<String> {
            v["seededByPython"].as_array().unwrap().iter().filter_map(|x| x.as_str().map(String::from)).collect()
        };
        let (pa, pb, p1, p2) = (sa.seeded(), sb.seeded(), names(&in_race), names(&after));
        for n in &absent {
            let who: Vec<&str> = [("窓A", &pa), ("窓B", &pb), ("Python", &p1), ("Python（後）", &p2)]
                .iter()
                .flat_map(|(w, v)| v.iter().filter(|x| x == n).map(move |_| *w))
                .collect();
            assert_eq!(who.len(), 1, "回 {round}: {n} を置いたのは 1 回だけのはず: {who:?}");
            *seeders.entry(who[0]).or_default() += 1;
            let d: Value = serde_json::from_slice(&std::fs::read(share.join(format!("{n}.json"))).unwrap()).expect("置いた中身が JSON");
            assert!(d["rows"].is_array() && d["schema"] == 1, "回 {round}: {n}: {d}");
            if *n == "equipment_master" {
                let (name, rev) = if who[0] == "窓B" { ("写しB", 7) } else { ("写しA", 4) };
                assert_eq!(
                    (d["rows"][0]["設備名"].as_str(), d["revision"].as_i64()),
                    (Some(name), Some(rev)),
                    "回 {round}: 置いた者 {who:?} の写し: {d}"
                );
            } else {
                assert!(d["revision"].as_i64().unwrap() >= 1, "回 {round}: {n}: {d}");
            }
        }
        for e in std::fs::read_dir(&share).unwrap().flatten() {
            let f = e.file_name().to_string_lossy().into_owned();
            assert!(!f.ends_with("master.lock.json") && !f.contains(".tmp"), "回 {round}: 残った {f}");
        }
        let strip = |v: &Value| {
            let mut v = norm(v, &r);
            for m in v["masters"].as_object_mut().unwrap().values_mut() {
                m.as_object_mut().unwrap().remove("updated_by");
            }
            for k in ["last_sync", "error", "lock", "who", "seededByPython"] {
                v.as_object_mut().unwrap().remove(k);
            }
            v
        };
        assert_eq!(common::diff(&strip(&after), &strip(&ga), ""), None, "回 {round}: 窓A {ga}\nPython {after}");
        assert_eq!(common::diff(&strip(&after), &strip(&gb), ""), None, "回 {round}: 窓B {gb}\nPython {after}");
    }
    eprintln!("置いた者（マスタ × 回）: {seeders:?}");
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn only_the_lock_wait_jitter_is_forgiven() {
    let a = json!({"error": "PC-9／o がマスタを保存中です（あと約20秒）。", "remaining": 20, "kind": "locked"});
    let b = json!({"error": "PC-9／o がマスタを保存中です（あと約19秒）。", "remaining": 19, "kind": "locked"});
    let (w, g) = same_lock_wait(&a, &b).expect("1 秒の揺れは同じとみなす");
    assert_eq!(w, g);
    let far = json!({"error": "PC-9／o がマスタを保存中です（あと約5秒）。", "remaining": 5, "kind": "locked"});
    assert!(same_lock_wait(&a, &far).is_none(), "2 秒を超える差は食い違いのまま");
    let other = json!({"error": "PC-8／o がマスタを保存中です（あと約19秒）。", "remaining": 19, "kind": "locked"});
    let (w, g) = same_lock_wait(&a, &other).unwrap();
    assert_ne!(w, g, "秒のほかの違い（名乗り）は残る");
    assert!(same_lock_wait(&a, &json!({"remaining": 20})).is_none(), "秒の数が違えば伏せない");
    assert!(same_lock_wait(&json!({"ok": true}), &json!({"ok": true})).is_none(), "秒の無い答えは触らない");
}
