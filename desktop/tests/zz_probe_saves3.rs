//! 採点者の当て直し（一時）
mod common;

use da_core::access;
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


fn ask(store: &Store, conf: &Value, step: &Value, card: bool) -> Option<(u16, Value)> {
    let mut c = conf.clone();
    c["who"]["login"] = step["who"][0].clone();
    c["who"]["pc"] = step["who"][1].clone();
    let key = format!("{}@{}", step["who"][1].as_str().unwrap(), step["who"][0].as_str().unwrap());
    c["who"]["key"] = json!(key);
    let place = access::Place::from_json(&c["place"]);
    let revoked = access::revocation(place.presence.as_deref(), &key, chrono::Local::now().naive_local());
    let me = access::me(&c, revoked).expect("me");
    let (m, p) = (step["method"].as_str().unwrap(), step["path"].as_str().unwrap());
    let body = step["body"].as_str().unwrap_or("");
    let q = step["query"].as_str().unwrap_or("");
    if card {
        let route = da_core::card_forms::route_of(m, p)?;
        return da_core::card_forms::answer(store, &me, route, q, body.as_bytes(), &place);
    }
    let route = da_core::formats_write::route_of(m, p)?;
    if let Some((status, kind, msg)) = access::guard(m, p, &me) {
        return Some((status, json!({"error": msg, "kind": kind})));
    }
    da_core::formats_write::answer(store, &me, route, q, body.as_bytes(), &place)
}

#[test]
fn zz_probe() {
    for (env, card, pre) in [("PROBE_FMT", false, "display_formats"), ("PROBE_CARD", true, "dashboards")] {
        let Ok(path) = std::env::var(env) else { continue };
        let oracle: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let mut out = String::new();
        for sc in oracle["scenarios"].as_array().unwrap() {
            let name = sc["name"].as_str().unwrap();
            let store = store_of(&sc["conf"], &sc["storeWho"]);
            for st in sc["steps"].as_array().unwrap() {
                let py = format!("{} {}", st["status"], norm(&st["json"]));
                let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ask(&store, &sc["conf"], st, card)));
                let (verdict, rs) = match r {
                    Err(_) => ("panic".to_string(), String::new()),
                    Ok(None) => ("任せる".to_string(), String::new()),
                    Ok(Some((s, g))) => {
                        let same = s as i64 == st["status"].as_i64().unwrap() && match st["json"].get("_deep").and_then(Value::as_str) { Some(t) => serde_json::to_string(&norm(&g)).unwrap() == t, None => common::diff(&norm(&st["json"]), &norm(&g), "").is_none() };
                        (if same { "同じ" } else { "割れ" }.to_string(), format!("{s} {}", norm(&g)))
                    }
                };
                let fp = files(Path::new(sc["py"].as_str().unwrap()), pre);
                let fr = files(Path::new(sc["rs"].as_str().unwrap()), pre);
                let mut fd = vec![];
                for (k, v) in &fr { if let Some(d) = common::diff(fp.get(k).unwrap_or(&Value::Null), v, k) { fd.push(d); } }
                for k in fp.keys().filter(|k| !k.starts_with("local/")) { if !fr.contains_key(k) { fd.push(format!("窓に無い {k}")); } }
                let fsame = if verdict == "任せる" { "-".to_string() } else if fd.is_empty() { "ファイル同じ".into() } else { format!("ファイル割れ {}", fd.join(" | ").chars().take(400).collect::<String>()) };
                let cut = |s: &str| s.chars().take(400).collect::<String>();
                out.push_str(&format!("{name}\t{verdict}\t{fsame}\tpy {}\trs {}\n", cut(&py), cut(&rs)));
            }
        }
        std::fs::write(format!("{path}.tsv"), out).unwrap();
    }
}
/// 置き場のマスタのファイル（共有・同梱の data/・写し。錠と書きかけの残りは無いこと）
fn files(root: &Path, pre: &str) -> Map<String, Value> {
    let mut out = Map::new();
    for d in ["share", "app/data", "local/master_cache"] {
        let Ok(rd) = std::fs::read_dir(root.join(d)) else { continue };
        let mut names: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        // dashboards のファイルだけを比べる（Python は権限を読むとき、タブの権限などほかのマスタの共有のファイルを作る〈読みの副作用〉）
        for n in names.into_iter().filter(|n| n.starts_with(pre)) {
            let b = std::fs::read(root.join(d).join(&n)).unwrap();
            let v = serde_json::from_slice::<Value>(&b).unwrap_or_else(|_| json!("<読めない>"));
            out.insert(format!("{d}/{n}"), norm(&v));
        }
    }
    out
}

