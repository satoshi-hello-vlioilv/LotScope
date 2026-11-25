//! 品質データの写し: Rust（src/mirror.rs）が Python（前の版の db_mirror）と同じ手順・同じ文言・同じ台帳か。
//! 筋書きは 前の版の答え合わせ役 mirror の STEPS（Python が別の置き場で同じ筋書きを行い、一歩ずつの結果を出す）。

mod common;

use da_core::mirror::DbMirror;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

/// 作業フォルダの場所を <D> に、時刻を「あるか」に（Python の normalize と同じ）。
fn normalize(v: &Value, base: &str) -> Value {
    match v {
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| {
                    let y = match k.as_str() {
                        "at" | "copiedAt" | "checkedAt" => json!(!x.is_null()),
                        _ => normalize(x, base),
                    };
                    (k.clone(), y)
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(|x| normalize(x, base)).collect()),
        Value::String(s) => json!(s.replace(base, "<D>").replace('\\', "/")),
        _ => v.clone(),
    }
}

/// 経った時間（ageHours）は、Python と Rust で走らせた時刻がずれるので 0.15 時間の幅で比べ、Rust の値を Python の値にそろえる。
fn align_age(want: &Value, got: &mut Value) {
    if let (Some(w), Some(g)) = (want.get("ageHours").and_then(Value::as_f64), got.get("ageHours").and_then(Value::as_f64)) {
        if (w - g).abs() <= 0.15 {
            got["ageHours"] = json!(w);
        }
    }
}

fn set_age(p: &Path, hours: f64) {
    let t = SystemTime::now() - Duration::from_secs_f64(hours * 3600.0);
    std::fs::File::options().write(true).open(p).unwrap().set_modified(t).unwrap();
}

#[test]
fn rust_mirrors_like_python() {
    let work = common::work("mirror");
    let mut bk = common::bake::Bake::open("mirror", &work);
    (bk.strip, bk.strip_in) = (vec!["results".into()], vec!["steps"]);
    let o = bk.table_oracle();
    let base = work.join("rs");
    std::fs::create_dir_all(base.join("share")).unwrap();
    let assets = work.join("assets");
    let place = |k: &str| -> String {
        match k {
            "share" => base.join("share").join("SIKADEF.sqlite3").display().to_string(),
            "other" => base.join("other.sqlite3").display().to_string(),
            "missing" => base.join("nowhere").join("x.sqlite3").display().to_string(),
            _ => String::new(),
        }
    };
    let cache: PathBuf = base.join("cache");
    let mut m: Option<Arc<DbMirror>> = None;
    let mut bad = vec![];
    let steps = o["steps"].as_array().unwrap();
    for (i, st) in steps.iter().enumerate() {
        let s = |k: &str| st[k].as_str().unwrap_or("").to_string();
        let r: Value = match s("do").as_str() {
            "new" => {
                // 背景の糸は起こさない（写すのは筋書きの refresh だけ。Python 側も受け身で同じ）
                m = Some(DbMirror::new(
                    "lot_list",
                    &place(&s("remote")),
                    &cache,
                    st["interval"].as_i64().unwrap(),
                    st["stale"].as_f64().unwrap(),
                ));
                Value::Null
            }
            "put" => {
                std::fs::copy(assets.join(format!("{}.sqlite3", s("asset"))), place(&s("file"))).unwrap();
                set_age(Path::new(&place(&s("file"))), st["age"].as_f64().unwrap());
                Value::Null
            }
            "corrupt" => {
                std::fs::write(place(&s("file")), b"not a sqlite file".repeat(100)).unwrap();
                set_age(Path::new(&place(&s("file"))), st["age"].as_f64().unwrap());
                Value::Null
            }
            "unlink" => {
                std::fs::remove_file(place(&s("file"))).unwrap();
                Value::Null
            }
            // DataRelay の公開の書きかけ（.<名前>.<番号>.incoming）。Python の筋書きと同じ名前
            "mark" | "unmark" => {
                let f = PathBuf::from(place(&s("file")));
                let mark = f.with_file_name(format!(".{}.4242.incoming", f.file_name().unwrap().to_string_lossy()));
                if s("do") == "mark" {
                    std::fs::write(&mark, b"x").unwrap();
                } else {
                    std::fs::remove_file(&mark).unwrap();
                }
                Value::Null
            }
            // 写しの置き場に世代の名前のファイルを置く（版 3.104.0 の作った後の採点: i64 に入らない世代の次）
            "plant" => {
                std::fs::create_dir_all(&cache).unwrap();
                std::fs::write(cache.join(s("name")), b"x").unwrap();
                Value::Null
            }
            "refresh" => m.as_ref().unwrap().refresh(),
            "read_path" => m.as_ref().unwrap().read_path().map(|p| json!(p.display().to_string())).unwrap_or(Value::Null),
            "source_info" => m.as_ref().unwrap().source_info(),
            "reconfigure" => {
                // 試験では背景の糸を起こさない形で切り替える（Python 側も受け身）
                m.as_ref().unwrap().reconfigure_quiet(
                    &place(&s("remote")),
                    st["interval"].as_i64().unwrap(),
                    st["stale"].as_f64().unwrap(),
                );
                Value::Null
            }
            "files" => {
                // 周回の様子（<キー>.state.json。版 3.60.0）は窓だけが置く（受け身の Python が読む）ので比べない
                let mut v: Vec<String> = std::fs::read_dir(&cache)
                    .unwrap()
                    .flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .filter(|n| !n.ends_with(".state.json"))
                    .collect();
                v.sort();
                json!(v)
            }
            "ledger" => {
                let l: Value = serde_json::from_slice(&std::fs::read(cache.join("_mirror.json")).unwrap()).unwrap();
                let e = &l["lot_list"];
                let mtime = std::fs::metadata(place("share"))
                    .unwrap()
                    .modified()
                    .unwrap()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos() as u64;
                json!({"file": e["file"], "source": e["signature"]["source"], "size": e["signature"]["size"],
                       "mtime_ns_is_stat": e["signature"]["mtime_ns"].as_u64() == Some(mtime)})
            }
            other => panic!("知らない歩: {other}"),
        };
        let mut got = normalize(&r, &base.display().to_string());
        let key = format!("#{i:02}");
        let w = bk.want(&key, || o["results"][i]["result"].clone());
        let want = &w;
        align_age(want, &mut got);
        bk.note(&key, st["do"].as_str().unwrap_or(""), &got, want);
        if let Some(d) = common::diff(want, &got, "") {
            bad.push(format!("#{i} {st}: {d}"));
        }
    }
    bk.finish(&bad);
    let _ = std::fs::remove_dir_all(&work);
    assert!(bad.is_empty(), "{} / {} 歩が食い違いました:\n{}", bad.len(), steps.len(), bad.join("\n"));
}
