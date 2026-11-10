//! 作業実績の登録の道（src/worklog_write.rs）が Python の道（routes/worklog.py の 6 本）と同じ答えか（版 3.91.0）。
//! program/tests/worklog_write_oracle.py が場面ごとに同じ中身の置き場を作り（実績のファイルのフォルダは共にする）、py に Python の道で
//! 問い合わせの並びを当てる。ここでは rs に同じ並びを本物の窓の道（Lot::handle_body → worklog_route。門番・書く係・フォルダの覚え）で当て、
//! 1 歩ごとの答え（状態・本文。断る言葉も 1 字まで）と、終わった後のファイル（共有・同梱の data/）を突き合わせる。
//! 窓が答えず Python に任せる歩（delegates）は、窓が答えないことを見る。足す行のキー（Lot::set_new_key）と古さを測る時刻（Lot::set_clock）は
//! Python と同じに差し替える。ファイルID は Python と窓で書き方（装置の番号の幅・作った時刻の有無）が違ってよいので、
//! 同じファイルを指す ID（same_fid）を「<fid:ファイル名>」にそろえて比べる。

mod common;

use da_core::bundle::{Builder, Env};
use da_core::lists::same_fid;
use da_core::lot::Lot;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// 時刻を伏せる（比べるのは形と中身）。断る言葉の中の「（年-月-日 時:分）」も伏せる（Python と窓が分の境をまたぐと字が違う）
fn norm(v: &Value, fids: &Map<String, Value>) -> Value {
    if let Value::String(s) = v {
        let re = regex::Regex::new(r"（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）").unwrap();
        return json!(re.replace_all(s, "（<t>）"));
    }
    match v {
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| {
                    let fid = (k == "ファイルID").then(|| x.as_str()).flatten().and_then(|f| fids.iter().find(|(p, _)| same_fid(p, f)));
                    let v = match fid {
                        Some((_, name)) => json!(format!("<fid:{}>", name.as_str().unwrap_or(""))),
                        None if k == "updated_at" && x.as_str().is_some_and(|s| !s.is_empty()) => json!("<t>"),
                        None => norm(x, fids),
                    };
                    (k.clone(), v)
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(|x| norm(x, fids)).collect()),
        _ => v.clone(),
    }
}

/// 置き場の作業実績の登録のファイル（共有・同梱の data/。錠と書きかけの残りは無いこと）
fn files(root: &Path, fids: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for d in ["share", "base/data"] {
        let p = root.join(d).join("work_log_files.json");
        if let Ok(b) = std::fs::read(&p) {
            out.insert(
                format!("{d}/work_log_files.json"),
                norm(&serde_json::from_slice::<Value>(&b).unwrap_or_else(|_| json!("<読めない>")), fids),
            );
        }
    }
    out
}

#[test]
fn work_log_registration_matches_python() {
    let base = common::work("worklog-write");
    let oracle = common::python_json("worklog_write_oracle.py", &[base.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut steps, mut delegated) = (0, 0);
    let fids = oracle["fids"].as_object().unwrap().clone();
    let now = oracle["now"].as_f64().unwrap();
    for sc in oracle["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let e = &sc["env"];
        let p = |k: &str| PathBuf::from(e[k].as_str().unwrap());
        // SAFETY: この試験の糸だけが環境を変える（GET /api/settings の config_file と同じ置き場）
        unsafe { std::env::set_var("TRANSFER_APP_CONFIG", e["config"].as_str().unwrap()) };
        let lot = Lot::new(p("local").join("db_cache"));
        lot.set_bundle(Builder::new(Env { base: p("base"), program: p("program"), local: p("local"), config: p("config"), now: None }));
        let n = Arc::new(AtomicUsize::new(0));
        let n2 = n.clone();
        lot.set_new_key(Arc::new(move || format!("k{:03}", n2.fetch_add(1, Ordering::SeqCst) + 1)));
        lot.set_clock(Arc::new(move || now));
        let ask = || -> Result<Value, String> { Err("Python は居ない".into()) };
        let call = |st: &Value| {
            lot.handle_body(
                st["method"].as_str().unwrap(),
                st["path"].as_str().unwrap(),
                st["query"].as_str().unwrap_or(""),
                st["body"].as_str().unwrap_or("").as_bytes(),
                &ask,
            )
        };
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            steps += 1;
            let Some((status, got)) = call(st) else {
                bad.push(format!("{name} [{i}] 窓が答えない: {} {} {}", st["method"], st["path"], st["body"]));
                continue;
            };
            // 言葉の中の場面のフォルダ（共有に届かない置き場など）は Python の側の名前にそろえる
            // JSON の字の中の形（Windows の道の \ は \\ と書かれる）どうしで置き換える
            let esc = |k: &str| {
                let t = serde_json::to_string(sc[k].as_str().unwrap()).unwrap();
                t[1..t.len() - 1].to_string()
            };
            let got: Value = serde_json::from_str(&got.to_string().replace(&esc("rs"), &esc("py"))).unwrap();
            let want = &st["json"];
            if status as i64 != st["status"].as_i64().unwrap() || common::diff(&norm(want, &fids), &norm(&got, &fids), "").is_some() {
                bad.push(format!(
                    "{name} [{i}] {} {}?{} {}: Python {} {} / 窓 {status} {}",
                    st["method"].as_str().unwrap(),
                    st["path"].as_str().unwrap(),
                    st["query"].as_str().unwrap(),
                    st["body"],
                    st["status"],
                    norm(want, &fids),
                    norm(&got, &fids)
                ));
            }
        }
        // 窓が答えず Python に任せる歩（書く前に断る＝ファイルは変わらない）
        for st in sc["delegates"].as_array().unwrap() {
            delegated += 1;
            if let Some((status, got)) = call(st) {
                bad.push(format!(
                    "{name}: 窓が答えた（Python に任せるはず） {} {} {}: 窓 {status} {got}",
                    st["method"], st["path"], st["body"]
                ));
            }
        }
        let (fp, fr) = (files(Path::new(sc["py"].as_str().unwrap()), &fids), files(Path::new(sc["rs"].as_str().unwrap()), &fids));
        for (k, v) in &fp {
            if let Some(d) = common::diff(v, fr.get(k).unwrap_or(&Value::Null), k) {
                bad.push(format!("{name}: ファイル {d}"));
            }
        }
        for k in fr.keys().filter(|k| !fp.contains_key(*k)) {
            bad.push(format!("{name}: 窓だけのファイル {k}"));
        }
        for d in ["share", "base/data"] {
            for e in std::fs::read_dir(Path::new(sc["rs"].as_str().unwrap()).join(d)).into_iter().flatten().flatten() {
                let f = e.file_name().to_string_lossy().into_owned();
                // 場面が置いたほかの PC の錠（Python の側にも同じ物がある）は窓が残した物ではない
                let placed = Path::new(sc["py"].as_str().unwrap()).join(d).join(&f).exists();
                if !placed && (f.ends_with(".lock.json") || f.contains(".tmp") || f.contains(".gone")) {
                    bad.push(format!("{name}: 窓が残した {d}/{f}"));
                }
            }
        }
    }
    unsafe { std::env::remove_var("TRANSFER_APP_CONFIG") };
    assert!(steps >= 75 && delegated >= 14, "歩が少ない: {steps}・{delegated}");
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
