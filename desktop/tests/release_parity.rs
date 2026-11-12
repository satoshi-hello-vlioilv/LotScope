//! 配布の置き場を変える 3 本（src/release_place.rs の handle・plan・Mover）が Python の道（routes/settings.py の
//! POST /api/release/place/check・move・GET progress と services/release_place.py）と同じ答えか（版 3.95.0）。
//! program/tests/release_place_oracle.py が場面ごとに同じ中身のフォルダを 3 つ（py・rs・pd）作り、py に Python の道で問い合わせの並びを当てる。
//! ここでは rs に同じ並びを窓の道（Lot::release_route と同じ順: ?engine=python → 道 → move は門番 gate → plan → 写す係）で当て、
//! 1 歩ごとの答え（状態・本文。断る言葉も 1 字まで）と、写し終えた後の進み具合（final）、終わった後のフォルダの中身
//! （ファイルの中身・大きさ・更新時刻〈copy2 と同じく元の時刻〉・権限）を突き合わせる。写しかけの一時フォルダが残らないことも見る。
//! 窓が答えず Python に任せる歩（delegates）は、窓が答えないことを見る。
//! 比べない所: 道の字の場面のフォルダ（@ROOT にそろえる）・時刻（started・finished・elapsed）・一時フォルダの名前の pid と秒・
//! 権限を読めない理由（Python の例外の字。言葉の形は比べる）・Windows の OS の言葉（Python は errno と WinError で書き分ける）。
//! 権限の場面（読めないファイル・読めないフォルダ・書けない上のフォルダ・中を読めない置き場）は、root で流すと意味を持たない
//! （root は権限を見ずに読み書きできるので、写せる答えどうしを比べる）。CI は root でない利用者で動くので、そこでは Python の
//! PermissionError の答え（進み具合の error の字）と写しかけの片付けを必ず突き合わせる: oracle の "root" が偽なら、
//! Permission denied の答えを 3 つ以上比べたことを確かめる（版 3.95.0 の CI で、手元の root では一度も比べていなかったと分かった）。

mod common;

use da_core::access::Gate;
use da_core::release_place::{handle, join_for, py_oserror, py_path_for, route_of, settings_answer, Mover, Route};
use serde_json::{json, Map, Value};
use std::path::Path;

/// 比べる形へ: 場面のフォルダ → @ROOT・時刻を外す・一時フォルダの名前の pid と秒を伏せる・権限を読めない理由を伏せる
fn norm(v: &Value, root: &str) -> Value {
    match v {
        Value::String(s) => {
            let s = s.replace(root, "@ROOT");
            let s = regex::Regex::new(r"\.copying-\d+-\d+").unwrap().replace_all(&s, ".copying-<pid>-<t>").into_owned();
            let s = regex::Regex::new(r"権限を読めないので、置き場を変えられません（.*）。")
                .unwrap()
                .replace_all(&s, "権限を読めないので、置き場を変えられません（<理由>）。")
                .into_owned();
            if cfg!(windows) && s.starts_with("写せませんでした: ") && !s.ends_with("is a named pipe") {
                return json!("写せませんでした: <OS の言葉>");
            }
            json!(s)
        }
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(k, _)| !matches!(k.as_str(), "started" | "finished" | "elapsed"))
                // 名乗りの「権限を読めない」理由は Python の例外の字（窓は窓の言葉）。あることと形を比べる
                .map(|(k, x)| (k.clone(), if k == "error" && o.contains_key("canRelease") { json!("<理由>") } else { norm(x, root) }))
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(|x| norm(x, root)).collect()),
        _ => v.clone(),
    }
}

/// 道の字の @ROOT → 場面のフォルダ
fn sub(x: &str, root: &str) -> String {
    x.replace("@ROOT", root)
}

/// 本文（JSON の字）の @ROOT → 場面のフォルダ（JSON の字として逃がす）
fn sub_json(x: &str, root: &str) -> String {
    let esc = serde_json::to_string(root).unwrap();
    x.replace("@ROOT", &esc[1..esc.len() - 1])
}

/// 権限の場面で落とした権限を戻す（root でない利用者でも作業フォルダを消せるように）
fn unlock(dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o755));
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            unlock(&e.path());
        }
    }
}

/// 写し終えるまで待つ
fn wait_done(m: &Mover) -> Value {
    let end = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while std::time::Instant::now() < end && m.progress()["state"] == "running" {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    m.progress()
}

/// 窓の道で 1 歩答える。None は窓が答えない（Python に任せる）。GET /api/update/settings は窓の me から who を組み、
/// source は Python の答えの字を使う（効いている設定の重ね方は page_parity が突き合わせる）
fn answer(conf: &Value, st: &Value, root: &str, mover: &Mover) -> Option<(u16, Value)> {
    let (method, path) = (st["method"].as_str().unwrap(), st["path"].as_str().unwrap());
    let route = route_of(method, path).expect("配布の置き場の道");
    let mut c = conf.clone();
    let (login, pc) = (st["who"][0].as_str().unwrap(), st["who"][1].as_str().unwrap());
    c["who"]["login"] = json!(login);
    c["who"]["pc"] = json!(pc);
    c["who"]["key"] = json!(da_core::bundle::terminal_key(login, pc));
    let me = || Gate::default().me(&c);
    if route == Route::Settings {
        let source = st["json"]["source"].as_str().unwrap_or("");
        return Some((200, settings_answer(source, &me(), c["place"]["shareDir"].as_str().unwrap_or(""))));
    }
    let body = sub_json(st["body"].as_str().unwrap_or(""), root);
    if st["hold"] == true {
        mover.hold(true);
    }
    // 書く道の本文の門（版 3.104.0。本物の道 Lot::handle_body と同じく部品より先）
    let r = match common::gate(method, path, body.as_bytes()) {
        Err(a) => Some(a),
        Ok(b) => handle(route, st["query"].as_str().unwrap_or(""), &b, &me, mover, &common::program()),
    };
    if st["hold"] == true {
        mover.hold(false);
    }
    r
}

/// 権限（oct(st_mode & 0o777)。Windows は比べない）
fn mode_of(m: &std::fs::Metadata) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        Some(format!("0o{:o}", m.permissions().mode() & 0o777))
    }
    #[cfg(not(unix))]
    {
        let _ = m;
        None
    }
}

/// フォルダの中身（release_place_oracle.py の listing と同じ形）
fn listing(root: &Path) -> Map<String, Value> {
    let mut out = Map::new();
    fn walk(dir: &Path, root: &Path, out: &mut Map<String, Value>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            if ["app", "local", "share"].iter().any(|x| rel == *x || rel.starts_with(&format!("{x}/"))) {
                continue;
            }
            let lm = std::fs::symlink_metadata(&p).unwrap();
            if lm.file_type().is_symlink() {
                out.insert(rel, json!({"type": "link"}));
            } else if lm.is_dir() {
                out.insert(rel, json!({"type": "dir"}));
                walk(&p, root, out);
            } else if !lm.is_file() {
                out.insert(rel, json!({"type": "special"})); // 名前付きパイプなど（読むと止まる）
            } else {
                let mt = lm.modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
                // 権限の無いファイル（root でない利用者。CI）は中身を比べず印にする（oracle の listing と同じ）
                let sha = std::fs::read(&p).map(|d| da_core::bundle::sha1_hex(&d)).unwrap_or_else(|_| "<読めない>".into());
                let mut f = json!({"type": "file", "size": lm.len(), "mtimeNs": mt.to_string(), "sha1": sha});
                if let Some(m) = mode_of(&lm) {
                    f["mode"] = json!(m);
                }
                out.insert(rel, f);
            }
        }
    }
    walk(root, root, &mut out);
    out
}

/// str(Path(上のフォルダ) / 名前) の事例の表（POSIX と Windows の決まりを 1 つの PC で）
#[test]
fn joined_paths_match_python() {
    let oracle = common::python_json("release_place_oracle.py", &["--tables"]);
    let mut bad = vec![];
    for c in oracle["joins"].as_array().unwrap() {
        let up = da_core::pyfmt::strip(c["parent"].as_str().unwrap()).trim_matches('"').to_string();
        let name = c["name"].as_str().unwrap();
        for (win, key, bkey) in [(false, "posix", "posixBase"), (true, "win", "winBase")] {
            let b = py_path_for(&up, win);
            let got = join_for(&b, name, win);
            if b != c[bkey] || got != c[key] {
                bad.push(format!("{key} {:?} / {name}: Python {} {} / 窓 {b} {got}", c["parent"], c[bkey], c[key]));
            }
        }
    }
    // OSError の str（Linux の errno と文。Windows では表が空）
    for c in oracle["oserrors"].as_array().unwrap() {
        let n = c["errno"].as_i64().unwrap() as i32;
        let text = std::io::Error::from_raw_os_error(n).to_string();
        let msg = text.rsplit_once(" (os error ").map(|(m, _)| m.to_string()).unwrap_or(text);
        let got = py_oserror(Some(n), &msg, c["a"].as_str(), c["b"].as_str());
        if got != c["str"] {
            bad.push(format!("OSError: Python {} / 窓 {got}", c["str"]));
        }
    }
    assert!(oracle["joins"].as_array().unwrap().len() >= 40, "事例が少ない");
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

#[test]
fn release_place_matches_python() {
    let base = common::work("release");
    let oracle = common::python_json("release_place_oracle.py", &[base.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut steps, mut delegated, mut copied, mut denied) = (0, 0, 0, 0);
    for sc in oracle["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let (py, rs) = (sc["roots"]["py"].as_str().unwrap(), sc["roots"]["rs"].as_str().unwrap());
        let mover = Mover::new(None);
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            steps += 1;
            if let Some(s) = st.get("sync") {
                // 写す係をその場で動かす（2 つの PC が同じ置き場を写す形）
                let got = Mover::new(None).run_sync(&sub(s["src"].as_str().unwrap(), rs), &sub(s["dest"].as_str().unwrap(), rs));
                denied += st["json"].to_string().contains("Permission denied") as usize;
                if let Some(d) = common::diff(&norm(&st["json"], py), &norm(&got, rs), "") {
                    bad.push(format!("{name} [{i}] 写す係: {d}"));
                }
                continue;
            }
            let Some((status, got)) = answer(&sc["conf"], st, rs, &mover) else {
                bad.push(format!("{name} [{i}] 窓が答えない: {} {} {}", st["method"], st["path"], st["body"]));
                continue;
            };
            let (want, gotn) = (norm(&st["json"], py), norm(&got, rs));
            if status as i64 != st["status"].as_i64().unwrap_or(0) || common::diff(&want, &gotn, "").is_some() {
                bad.push(format!(
                    "{name} [{i}] {} {} {}: Python {} {want} / 窓 {status} {gotn}",
                    st["method"].as_str().unwrap(),
                    st["path"].as_str().unwrap(),
                    st["body"],
                    st["status"]
                ));
            }
            if st["wait"] == true {
                copied += 1;
                let fin = wait_done(&mover);
                denied += st["final"].to_string().contains("Permission denied") as usize;
                if let Some(d) = common::diff(&norm(&st["final"], py), &norm(&fin, rs), "") {
                    bad.push(format!(
                        "{name} [{i}] 写し終えた後の進み具合: {d}\n  Python {}\n  窓     {}",
                        norm(&st["final"], py),
                        norm(&fin, rs)
                    ));
                }
            }
        }
        for st in sc["delegates"].as_array().unwrap() {
            delegated += 1;
            if let Some((status, got)) = answer(&sc["conf"], st, rs, &mover) {
                bad.push(format!(
                    "{name}: 窓が答えた（Python に任せるはず） {} {} {}: 窓 {status} {got}",
                    st["method"], st["path"], st["body"]
                ));
            }
        }
        // 終わった後のフォルダ: 写した物の中身・時刻・権限まで Python と同じ。写しかけの一時フォルダが残らない
        let got = listing(Path::new(rs));
        let want = sc["files"].as_object().unwrap();
        for k in got.keys().filter(|k| k.contains(".copying-")) {
            bad.push(format!("{name}: 写しかけが残った {k}"));
        }
        for k in want.keys().chain(got.keys()) {
            if let Some(d) = common::diff(want.get(k).unwrap_or(&Value::Null), got.get(k).unwrap_or(&Value::Null), k) {
                bad.push(format!("{name}: フォルダの中身 {d}"));
            }
        }
    }
    eprintln!(
        "歩 {steps}・写し終えるまで見た歩 {copied}・Python に任せた歩 {delegated}・権限の答え（Permission denied）を比べた歩 {denied}"
    );
    assert!(steps >= 70 && delegated >= 10 && copied >= 2, "歩が少ない: {steps}・{delegated}・{copied}");
    if cfg!(unix) && oracle["root"] == false {
        assert!(denied >= 3, "root でないのに権限の答え（Permission denied）を比べた歩が少ない: {denied}");
    }
    unlock(&base);
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
