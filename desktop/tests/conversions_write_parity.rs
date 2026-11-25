//! 変換表の道（src/conversions_write.rs）が Python の道（前の版の conversions の 8 本）と同じ答えか（版 3.93.0）。
//! 前の版の答え合わせ役 conversions が場面ごとに同じ中身の置き場を作り、py に Python の道で問い合わせの並びを当てる。ここでは rs に
//! 同じ並びを本物の窓の道（Lot::handle_body → conversions_route。門番・書く係）で当て、1 歩ごとの答え（状態・本文。断る言葉も 1 字まで）と、
//! 終わった後のファイル（共有・同梱の data/ の変換表と標準）を突き合わせる。窓が答えない（製品では 503）歩（delegates）は、窓が答えないことを見る。
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
            let re = common::re(r"（[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}）");
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
                out.insert(format!("{d}/{f}"), norm(&common::file_value(&b)));
            }
        }
    }
    out
}

#[test]
fn conversion_tables_match_python() {
    let base = common::work("conversions-write");
    // 版 3.116.0: 窓の答えと終わった後のファイルを焼いた表（tests/baked/conversions.json。詰めた形）にも持つ
    let mut bk = common::bake::Bake::open("conversions", &base);
    bk.pack = true;
    let oracle = bk.table_oracle();
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
            lot.handle_body_with(
                st["method"].as_str().unwrap(),
                st["path"].as_str().unwrap(),
                st["query"].as_str().unwrap_or(""),
                st["body"].as_str().unwrap_or("").as_bytes(),
                &ask,
            )
        };
        // 言葉の中の場面のフォルダ（共有に届かない置き場など）は Python の側の名前にそろえる（JSON の字の中の形どうしで）
        // 場面の rs のフォルダの道（どの書き方も。common::swap_path_json）を py に
        let swap = |t: &str| common::swap_path_json(t, sc["rs"].as_str().unwrap(), sc["py"].as_str().unwrap());
        for (i, st) in sc["steps"].as_array().unwrap().iter().enumerate() {
            steps += 1;
            let Some((status, got)) = call(st) else {
                bad.push(format!("{name} [{i}] 窓が答えない: {} {} {}", st["method"], st["path"], st["body"]));
                continue;
            };
            let got: Value = serde_json::from_str(&swap(&got.to_string())).unwrap();
            let key = format!("{name} #{i}");
            let w = bk.want_step(&key, st);
            bk.note_step(&key, st, status, &got, &w);
            let (want, got) = (&bk.s(&w.1), bk.s(&got));
            if status as i64 != w.0 || common::diff(&norm(want), &norm(&got), "").is_some() {
                bad.push(format!(
                    "{name} [{i}] {} {}?{} {}: Python {} {} / 窓 {status} {}",
                    st["method"].as_str().unwrap(),
                    st["path"].as_str().unwrap(),
                    st["query"].as_str().unwrap(),
                    st["body"],
                    w.0,
                    common::diff(&norm(want), &norm(&got), "").unwrap_or_default(),
                    norm(&got).to_string().chars().take(300).collect::<String>()
                ));
            }
        }
        da_core::conversions_write::set_between_writes(None);
        // 窓が答えない（製品では 503）歩（書く前に断る＝ファイルは変わらない）
        for st in sc["delegates"].as_array().unwrap() {
            delegated += 1;
            if let Some((status, got)) = call(st) {
                bad.push(format!(
                    "{name}: 窓が答えた（答えない（製品では 503）はず） {} {}?{} {}: 窓 {status} {}",
                    st["method"],
                    st["path"],
                    st["query"],
                    st["body"],
                    got.to_string().chars().take(200).collect::<String>()
                ));
            }
        }
        let fr = files(&rs);
        let fkey = format!("{name} ファイル");
        let fp = bk.want(&fkey, || Value::Object(files(Path::new(sc["py"].as_str().unwrap()))));
        bk.note_files(&fkey, &Value::Object(fr.clone()), &fp);
        let fp = bk.s(&fp).as_object().cloned().unwrap_or_default();
        let fr: Map<String, Value> = bk.s(&Value::Object(fr)).as_object().cloned().unwrap();
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
                // Python 無しでは、場面の宣言にある物か、書き込みの間に置く錠（between。Python の側にも同じ錠が残る）
                let placed = if bk.python() {
                    Path::new(sc["py"].as_str().unwrap()).join(d).join(&f).exists()
                } else {
                    bk.in_scene(&rs.join(d).join(&f)) || (sc["between"].is_string() && d == "share" && f == "master.lock.json")
                };
                if !placed && (f.ends_with(".lock.json") || f.contains(".tmp") || f.contains(".gone")) {
                    bad.push(format!("{name}: 窓が残した {d}/{f}"));
                }
            }
        }
    }
    unsafe { std::env::remove_var("TRANSFER_APP_CONFIG") };
    // 版 3.105.0: 任せた歩の下限は置かない（任せる歩は 0 へ減らしていく数で、減らすたびに落ちる。任せるはずの歩を窓が答えないことは歩ごとの確かめが、上限は予算〈common::check_budget〉が見る）
    assert!(steps >= 243, "歩が少ない: {steps}・{delegated}");
    bk.finish(&bad);
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
