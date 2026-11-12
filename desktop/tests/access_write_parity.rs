//! 権限のマスタを書く道（src/access_write.rs）が Python の道（routes/access.py）と同じ答えか（版 3.68.0。順 5 の 2 段目 b）。
//! program/tests/access_write_oracle.py が場面ごとに同じ中身のフォルダを 2 つ作り、片方に Python の道で問い合わせの並びを当てる。
//! ここではもう片方に同じ並びを窓の道（門番 access::guard → access_write::handle。書く係は master_store）で当て、
//! 1 歩ごとの答え（状態・本文）と、終わった後のファイル（共有・同梱の data/・写し）を突き合わせる。

mod common;

use da_core::access;
use da_core::access_write::{handle, route_of};
use da_core::master_store::{Config, Store};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// 時刻を伏せる（比べるのは形と中身）。断る言葉の中の「（年-月-日 時:分）」も伏せる（Python が答えを作った分と、窓が答えた分が
/// 分の境をまたぐと字が違う。CI で 02:58 と 02:59 に分かれて落ちた）
fn norm(v: &Value) -> Value {
    if let Value::String(s) = v {
        let re = regex::Regex::new(r"（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）").unwrap();
        return json!(re.replace_all(s, "（<t>）"));
    }
    match v {
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| {
                    (k.clone(), if k == "updated_at" && x.as_str().is_some_and(|s| !s.is_empty()) { json!("<t>") } else { norm(x) })
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        _ => v.clone(),
    }
}

fn store_of(conf: &Value, who: &Value) -> Store {
    let p = &conf["place"];
    let path = |k: &str| p[k].as_str().filter(|s| !s.is_empty()).map(PathBuf::from);
    let cache = path("cache").unwrap();
    Store::new(Config {
        data: path("data").unwrap(),
        defaults: path("defaults").unwrap(),
        share_dir: path("shareDir"),
        shared: p["shared"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect(),
        local_root: cache.parent().unwrap().to_path_buf(),
        cache,
        pc: who["pc"].as_str().unwrap_or("").into(),
        login: who["login"].as_str().unwrap_or("").into(),
        role: "rs".into(),
        lock_ttl: 20.0,
    })
}

/// 窓の道: 門番を通してから受ける（Lot と同じ順）
/// None は窓が答えない（Python に任せる）
fn answer(store: &Store, conf: &Value, step: &Value) -> Option<(u16, Value)> {
    let mut c = conf.clone();
    // 書く道の本文の門（版 3.104.0）: 本物の道（Lot::handle_body）と同じく、門番・部品より先
    let gated = match common::gate(
        step["method"].as_str().unwrap(),
        step["path"].as_str().unwrap(),
        step["body"].as_str().unwrap_or("").as_bytes(),
    ) {
        Ok(b) => b,
        Err(a) => return Some(a),
    };
    c["who"]["login"] = step["who"][0].clone();
    c["who"]["pc"] = step["who"][1].clone();
    let me = access::me(&c, None).expect("me");
    let (method, path) = (step["method"].as_str().unwrap(), step["path"].as_str().unwrap());
    if let Some((status, kind, msg)) = access::guard(method, path, &me) {
        return Some((status, json!({"error": msg, "kind": kind})));
    }
    if (method, path) == ("GET", "/api/masters/tabaccess") {
        // タブの権限を読む（版 3.101.0。Lot::tabaccess_route と同じ材料: タブの権限の行・いま効いているデータ元の並び）
        let tabs = access::Place::from_json(&c["place"]).rows("tab_access").unwrap();
        let sources: Vec<serde_json::Map<String, Value>> =
            step["sources"].as_array().unwrap().iter().map(|x| x.as_object().unwrap().clone()).collect();
        return da_core::access_write::tabs_answer(store, &me, &tabs, &sources);
    }
    let route = route_of(method, path).expect("窓が受ける道");
    let tabs = access::Place::from_json(&c["place"]).rows("tab_access").unwrap();
    handle(store, &me, route, step["query"].as_str().unwrap_or(""), &gated, &tabs)
}

/// 置き場のマスタのファイル（共有・同梱の data/・写し。錠と書きかけの残りは無いこと）
fn files(root: &Path) -> Map<String, Value> {
    let mut out = Map::new();
    for d in ["share", "app/data", "local/master_cache"] {
        let Ok(rd) = std::fs::read_dir(root.join(d)) else { continue };
        let mut names: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        for n in names {
            let b = std::fs::read(root.join(d).join(&n)).unwrap();
            let v = serde_json::from_slice::<Value>(&b).unwrap_or_else(|_| json!("<読めない>"));
            out.insert(format!("{d}/{n}"), norm(&v));
        }
    }
    out
}

#[test]
fn access_writes_match_python() {
    let base = common::work("access-write");
    let oracle = common::python_json("access_write_oracle.py", &[base.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut steps, mut delegated) = (0, 0);
    for sc in oracle["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let store = store_of(&sc["conf"], &sc["storeWho"]);
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            steps += 1;
            let Some((status, got)) = answer(&store, &sc["conf"], st) else {
                bad.push(format!("{name} [{i}] 窓が答えない: {} {} {}", st["method"], st["path"], st["body"]));
                continue;
            };
            let want = &st["json"];
            let same = if want["kind"] == "error" {
                // 思いがけない失敗（Python の例外の言葉）は種類と状態だけ比べる
                got["kind"] == "error"
            } else {
                common::diff(&norm(want), &norm(&got), "").is_none()
            };
            if status as i64 != st["status"].as_i64().unwrap() || !same {
                bad.push(format!(
                    "{name} [{i}] {} {}?{}: Python {} {} / 窓 {status} {}",
                    st["method"].as_str().unwrap(),
                    st["path"].as_str().unwrap(),
                    st["query"].as_str().unwrap(),
                    st["status"],
                    norm(want),
                    norm(&got)
                ));
            }
        }
        // 窓が答えず Python に任せる歩（版 3.77.0。置き場の行の id・版を窓が Python と同じに読めない形。書く前に断る＝ファイルは変わらない）
        for st in sc["delegates"].as_array().unwrap() {
            delegated += 1;
            if let Some((status, got)) = answer(&store, &sc["conf"], st) {
                bad.push(format!(
                    "{name}: 窓が答えた（Python に任せるはず） {} {} {}: 窓 {status} {got}",
                    st["method"], st["path"], st["body"]
                ));
            }
        }
        // 終わった後のファイル: 共有と data/ は同じ。写しは窓が書いた物だけ（Python は読むたびに写しを取り直す）が Python と同じ
        let (fp, fr) = (files(Path::new(sc["py"].as_str().unwrap())), files(Path::new(sc["rs"].as_str().unwrap())));
        for (k, v) in &fr {
            if k.ends_with(".lock.json") || k.contains(".tmp") || k.contains(".gone") {
                bad.push(format!("{name}: 窓が残した {k}"));
            }
            if let Some(d) = common::diff(fp.get(k).unwrap_or(&Value::Null), v, k) {
                bad.push(format!("{name}: ファイル {d}"));
            }
        }
        for k in fp.keys().filter(|k| !k.starts_with("local/")) {
            if !fr.contains_key(k) {
                bad.push(format!("{name}: 窓に無いファイル {k}"));
            }
        }
    }
    // 版 3.105.0: 任せた歩の下限は置かない（任せる歩は 0 へ減らしていく数で、減らすたびに落ちる。任せるはずの歩を窓が答えないことは歩ごとの確かめが、上限は予算〈common::check_budget〉が見る）
    assert!(steps >= 50, "歩が少ない: {steps}・{delegated}");
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
