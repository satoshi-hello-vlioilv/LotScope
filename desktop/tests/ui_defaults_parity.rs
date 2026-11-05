//! 一覧の表示の初期設定の道（src/ui_defaults.rs）が Python の道（routes/system.py の GET／PUT /api/ui-defaults）と同じ答えか（版 3.78.0）。
//! program/tests/ui_defaults_oracle.py が場面ごとに同じ中身のフォルダを 2 つ作り、片方に Python の道で問い合わせの並びを当てる。
//! ここではもう片方に同じ並びを窓の道（ui_defaults::handle。書く係は master_store）で当て、1 歩ごとの答えと、終わった後のファイルを突き合わせる。
//! delegates の歩（窓が読めない本文・置き場の行の形が違う）は、窓が答えないこと（Python に任せる）を確かめる。
//! 切断の指示は窓の me と同じく置き場から読む（access::revocation）。範囲の名前は答えの係の profileKeys（窓は一覧の設定の答えで受け取る）

mod common;

use da_core::access;
use da_core::master_store::{Config, Store};
use da_core::ui_defaults::{handle, route_of, NAME};
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
                    (
                        k.clone(),
                        if (k == "updated_at" || k == "updatedAt") && x.as_str().is_some_and(|s| !s.is_empty()) {
                            json!("<t>")
                        } else {
                            norm(x)
                        },
                    )
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

/// 窓の道（門番の外。置けるかは handle が見る）。None は窓が答えない（Python に任せる）
fn answer(store: &Store, conf: &Value, step: &Value, profile: &[String]) -> Option<(u16, Value)> {
    let mut c = conf.clone();
    c["who"]["login"] = step["who"][0].clone();
    c["who"]["pc"] = step["who"][1].clone();
    let key = format!("{}@{}", step["who"][1].as_str().unwrap(), step["who"][0].as_str().unwrap());
    c["who"]["key"] = json!(key);
    let place = access::Place::from_json(&c["place"]);
    let revoked = access::revocation(place.presence.as_deref(), &key, chrono::Local::now().naive_local());
    let me = access::me(&c, revoked).expect("me");
    let route = route_of(step["method"].as_str().unwrap(), step["path"].as_str().unwrap()).expect("窓が受ける道");
    let body = step["body"].as_str().unwrap_or("");
    let rows = place.rows(NAME).unwrap();
    handle(store, &me, route, body.as_bytes(), &rows, profile)
}

/// 置き場のマスタのファイル（共有・同梱の data/・写し。錠と書きかけの残りは無いこと）
fn files(root: &Path) -> Map<String, Value> {
    let mut out = Map::new();
    for d in ["share", "app/data", "local/master_cache"] {
        let Ok(rd) = std::fs::read_dir(root.join(d)) else { continue };
        let mut names: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        // 初期設定のファイルだけを比べる（Python は権限を読むとき、タブの権限などほかのマスタの共有のファイルを作る〈読みの副作用〉）
        for n in names.into_iter().filter(|n| n.starts_with("ui_defaults")) {
            let b = std::fs::read(root.join(d).join(&n)).unwrap();
            let v = serde_json::from_slice::<Value>(&b).unwrap_or_else(|_| json!("<読めない>"));
            out.insert(format!("{d}/{n}"), norm(&v));
        }
    }
    out
}

#[test]
fn ui_defaults_match_python() {
    let base = common::work("ui-defaults");
    let oracle = common::python_json("ui_defaults_oracle.py", &[base.to_str().unwrap()]);
    let profile: Vec<String> = oracle["profileKeys"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
    let mut bad = vec![];
    let (mut steps, mut delegated) = (0, 0);
    for sc in oracle["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let store = store_of(&sc["conf"], &sc["storeWho"]);
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            steps += 1;
            let Some((status, got)) = answer(&store, &sc["conf"], st, &profile) else {
                bad.push(format!("{name} [{i}] 窓が答えない: {} {} {}", st["method"], st["path"], st["body"]));
                continue;
            };
            let want = &st["json"];
            let same = { common::diff(&norm(want), &norm(&got), "").is_none() };
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
        // 窓が答えず Python に任せる歩（書く前に断る＝窓のファイルは変わらない）
        for st in sc["delegates"].as_array().unwrap() {
            delegated += 1;
            if let Some((status, got)) = answer(&store, &sc["conf"], st, &profile) {
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
    assert!(steps >= 35 && delegated >= 6, "歩が少ない: {steps}・{delegated}");
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
