//! 読む道の種まき（版 3.105.0。作った後の採点の割れ: 共有にまだ無いマスタを読む道の一部が種をまかなかった）。
//! program/tests/seed_reads_oracle.py が読む道ごとに置き場（共有は空・マスタは写しだけ）を作り、Python の道で GET を 1 回当てて、
//! 終わった後の共有のファイルを渡す。ここでは同じ置き場に本物の窓の道（Lot::handle_body・sources_list・page。Python は居ない）で同じ GET を当て、
//! 共有に置かれたマスタと中身（時刻は伏せる・場面のフォルダの名前はそろえる）を Python と比べる。決まり:
//! - Python がその道で置くマスタは、窓も必ず置く（置き漏らさない）。置いた中身は同じ
//! - 窓が Python より多く置いてよいのは、窓がどの道でも読むマスタ（bundle::EVERY_READ: 参照先・権限 2 つ）と束の節のマスタ
//!   （bundle::SECTIONS の 7 つ）だけ。窓はどの問い合わせでも束を組んで門番を通す（前は束を Python に尋ね、Python が束を答えるときに
//!   7 つを置いた）。どれも Python が読めば同じ中身で置くマスタなので、置かれる時が早まるだけ
//! - 窓が答えず Python に任せた道は、窓が置いた物がこの 2 つの和に入るか
//!
//! 窓の読みはみな access::Place を通り、共有にまだ無いマスタを読む前に、束の材料を読む Builder::inputs と Lot::store_for が覚えさせた係
//! （master_store::shared_store）に置かせる（1 か所。Python の MasterStore.read と同じく読むときに置く）。

mod common;

use da_core::bundle::{Builder, Env, EVERY_READ, SECTIONS};
use da_core::lot::Lot;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// 共有に置かれたマスタのファイル（錠は除く）。時刻は伏せ、場面のフォルダは Python の側の名前にそろえる
fn share_files(root: &Path, from: &str, to: &str) -> Map<String, Value> {
    let mut out = Map::new();
    let mut names: Vec<_> =
        std::fs::read_dir(root.join("share")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    for f in names.into_iter().filter(|f| f.ends_with(".json") && f != "master.lock.json") {
        let t = std::fs::read_to_string(root.join("share").join(&f)).unwrap();
        let v: Value = serde_json::from_str(&t.replace(from, to)).unwrap_or(json!("<読めない>"));
        out.insert(f, v);
    }
    out
}

fn masked(v: &Value) -> Value {
    let mut v = v.clone();
    if let Some(o) = v.as_object_mut() {
        o.insert("updated_at".into(), json!("<時刻>"));
    }
    v
}

#[test]
fn reads_seed_the_same_masters_as_python() {
    let base = common::work("seed-reads");
    let oracle = common::python_json("seed_reads_oracle.py", &[base.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut answered, mut delegated, mut seeded) = (0, 0, 0);
    for sc in oracle["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let e = &sc["env"];
        let p = |k: &str| PathBuf::from(e[k].as_str().unwrap());
        // SAFETY: この試験の糸だけが環境を変える（配った設定の置き場）
        unsafe { std::env::set_var("TRANSFER_APP_CONFIG", e["config"].as_str().unwrap()) };
        let lot = Lot::new(p("local").join("db_cache"));
        lot.set_bundle(Builder::new(Env { base: p("base"), program: p("program"), local: p("local"), config: p("config"), now: None }));
        let ask = || -> Result<Value, String> { Err("Python は居ない".into()) };
        let (path, query) = (sc["path"].as_str().unwrap(), sc["query"].as_str().unwrap());
        let got = match path {
            "/" => lot.page(false, &|| "ready").map(|_| 200u16),
            "/api/sources" => lot.sources_list(query).map(|(st, _)| st),
            _ => lot.handle_body("GET", path, query, b"", &ask).map(|(st, _)| st),
        };
        let esc = |k: &str| {
            let t = serde_json::to_string(sc[k].as_str().unwrap()).unwrap();
            t[1..t.len() - 1].to_string()
        };
        let mine = share_files(Path::new(sc["rs"].as_str().unwrap()), &esc("rs"), &esc("py"));
        let want = sc["files"].as_object().unwrap();
        seeded += want.len();
        let allowed = |f: &str| {
            let n = f.trim_end_matches(".json");
            EVERY_READ.contains(&n) || SECTIONS.iter().any(|(_, fs)| fs.contains(&n))
        };
        match got {
            Some(_) => answered += 1,
            None => delegated += 1,
        }
        let how = if got.is_some() { "窓が答えた" } else { "窓は任せた" };
        if got.is_some() {
            for f in want.keys().filter(|f| !mine.contains_key(*f)) {
                bad.push(format!("{name}（{how}・Python {}）: 窓が置き漏らした {f}", sc["status"]));
            }
        }
        for f in mine.keys().filter(|f| !want.contains_key(*f) && !allowed(f)) {
            bad.push(format!("{name}（{how}）: 窓だけが置いた {f}（束と門番のマスタでない）"));
        }
        for (f, v) in want.iter().filter(|(f, _)| mine.contains_key(*f)) {
            if let Some(d) = common::diff(&masked(v), &masked(&mine[f]), f) {
                bad.push(format!("{name}: 置いた中身 {d}"));
            }
        }
    }
    unsafe { std::env::remove_var("TRANSFER_APP_CONFIG") };
    eprintln!("窓が答えた道 {answered}・任せた道 {delegated}・Python が置いたファイル {seeded}");
    assert!(answered >= 20 && seeded >= 80, "場面が足りない: 答えた {answered}・置いた {seeded}");
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
