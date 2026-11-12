//! 変換表の道（src/conversions_write.rs）が Python の道（routes/conversions.py の 8 本）と同じ答えか（版 3.93.0）。
//! program/tests/conversions_oracle.py が場面ごとに同じ中身の置き場を作り、py に Python の道で問い合わせの並びを当てる。ここでは rs に
//! 同じ並びを本物の窓の道（Lot::handle_body → conversions_route。門番・書く係）で当て、1 歩ごとの答え（状態・本文。断る言葉も 1 字まで）と、
//! 終わった後のファイル（共有・同梱の data/ の変換表と標準）を突き合わせる。窓が答えず Python に任せる歩（delegates）は、窓が答えないことを見る。
//! 取り込みで標準にもする 2 回の書き込みの間に錠を置く場面は、conversions_write::set_between_writes で Python と同じ錠のファイルを置く。

mod common;

use da_core::bundle::{Builder, Env};
use da_core::lot::Lot;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const FILES: [&str; 2] = ["conversions.json", "conversion_defaults.json"];

/// 時刻を伏せる（比べるのは形と中身）。断る言葉の中の「（年-月-日 時:分）」も伏せる（Python と窓が分の境をまたぐと字が違う）
fn norm(v: &Value) -> Value {
    match v {
        Value::String(s) => {
            static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
            let re = RE.get_or_init(|| regex::Regex::new(r"（[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}）").unwrap());
            json!(re.replace_all(s, "（<t>）"))
        }
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| {
                    let v = if k == "updated_at" && x.as_str().is_some_and(|s| !s.is_empty()) { json!("<t>") } else { norm(x) };
                    (k.clone(), v)
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        _ => v.clone(),
    }
}

/// 置き場の変換表と標準のファイル（共有・同梱の data/）
fn files(root: &Path) -> Map<String, Value> {
    let mut out = Map::new();
    for d in ["share", "base/data"] {
        for f in FILES {
            if let Ok(b) = std::fs::read(root.join(d).join(f)) {
                out.insert(format!("{d}/{f}"), norm(&serde_json::from_slice::<Value>(&b).unwrap_or_else(|_| json!("<読めない>"))));
            }
        }
    }
    out
}

#[test]
fn conversion_tables_match_python() {
    let base = common::work("conversions-write");
    let oracle = common::python_json("conversions_oracle.py", &[base.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut steps, mut delegated) = (0, 0);
    for sc in oracle["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let e = &sc["env"];
        let p = |k: &str| PathBuf::from(e[k].as_str().unwrap());
        // SAFETY: この試験の糸だけが環境を変える（配った設定の置き場）
        unsafe { std::env::set_var("TRANSFER_APP_CONFIG", e["config"].as_str().unwrap()) };
        let lot = Lot::new(p("local").join("db_cache"));
        lot.set_bundle(Builder::new(Env { base: p("base"), program: p("program"), local: p("local"), config: p("config"), now: None }));
        let rs = PathBuf::from(sc["rs"].as_str().unwrap());
        let hook = sc["between"].as_str().map(|lock| {
            let (file, lock) = (rs.join("share").join("master.lock.json"), lock.to_string());
            Arc::new(move || std::fs::write(&file, &lock).unwrap()) as Arc<dyn Fn() + Send + Sync>
        });
        da_core::conversions_write::set_between_writes(hook);
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
        // 言葉の中の場面のフォルダ（共有に届かない置き場など）は Python の側の名前にそろえる（JSON の字の中の形どうしで）
        let esc = |k: &str| {
            let t = serde_json::to_string(sc[k].as_str().unwrap()).unwrap();
            t[1..t.len() - 1].to_string()
        };
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            steps += 1;
            let Some((status, got)) = call(st) else {
                bad.push(format!("{name} [{i}] 窓が答えない: {} {} {}", st["method"], st["path"], st["body"]));
                continue;
            };
            let got: Value = serde_json::from_str(&got.to_string().replace(&esc("rs"), &esc("py"))).unwrap();
            let want = &st["json"];
            if status as i64 != st["status"].as_i64().unwrap() || common::diff(&norm(want), &norm(&got), "").is_some() {
                bad.push(format!(
                    "{name} [{i}] {} {}?{} {}: Python {} {} / 窓 {status} {}",
                    st["method"].as_str().unwrap(),
                    st["path"].as_str().unwrap(),
                    st["query"].as_str().unwrap(),
                    st["body"],
                    st["status"],
                    common::diff(&norm(want), &norm(&got), "").unwrap_or_default(),
                    norm(&got).to_string().chars().take(300).collect::<String>()
                ));
            }
        }
        da_core::conversions_write::set_between_writes(None);
        // 窓が答えず Python に任せる歩（書く前に断る＝ファイルは変わらない）
        for st in sc["delegates"].as_array().unwrap() {
            delegated += 1;
            if let Some((status, got)) = call(st) {
                bad.push(format!(
                    "{name}: 窓が答えた（Python に任せるはず） {} {}?{} {}: 窓 {status} {}",
                    st["method"],
                    st["path"],
                    st["query"],
                    st["body"],
                    got.to_string().chars().take(200).collect::<String>()
                ));
            }
        }
        let (fp, fr) = (files(Path::new(sc["py"].as_str().unwrap())), files(&rs));
        for (k, v) in &fp {
            if let Some(d) = common::diff(v, fr.get(k).unwrap_or(&Value::Null), k) {
                bad.push(format!("{name}: ファイル {d}"));
            }
        }
        for k in fr.keys().filter(|k| !fp.contains_key(*k)) {
            bad.push(format!("{name}: 窓だけのファイル {k}"));
        }
        for d in ["share", "base/data"] {
            for e in std::fs::read_dir(rs.join(d)).into_iter().flatten().flatten() {
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
    // 版 3.105.0: 任せた歩の下限は置かない（任せる歩は 0 へ減らしていく数で、減らすたびに落ちる。任せるはずの歩を窓が答えないことは歩ごとの確かめが、上限は予算〈common::check_budget〉が見る）
    assert!(steps >= 243, "歩が少ない: {steps}・{delegated}");
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
