//! 設備グループの道（src/equipgroups_write.rs）が Python の道（routes/equipgroups.py の 4 本）と同じ答えか（版 3.94.0）。
//! program/tests/equipgroups_oracle.py が場面ごとに同じ中身の置き場を作り、py に Python の道で問い合わせの並びを当てる。ここでは rs に
//! 同じ並びを本物の窓の道（Lot::handle_body → equipgroups_route。門番・書く係・選べる設備を数えるダッシュボードの数え方）で当て、
//! 1 歩ごとの答え（状態・本文。断る言葉も 1 字まで。選べる設備の出どころと件数も）と、終わった後のファイル（共有・同梱の data/ の
//! 設備グループ）を突き合わせる。窓が答えず Python に任せる歩（delegates）は、窓が答えないことを見る。
//! ファイルの比べは共有（share）と同梱の data/ だけで、この PC の写し（local/master_cache）は比べない（窓は数えるために読んだマスタの写しを置かず、
//! 直すの誤りや錠では設備グループの写しも置かない。これまでの窓の道と同じ扱い）。共有・data/ のマスタのファイルの名前は全部の場面で比べ、
//! 任せる歩では窓が何も置かないことを見る。共有にまだ無い数える材料（作業実績・設備マスタ・データ元）は、版 3.105.0 から窓も Python と
//! 同じ最初の版を置く（種まき。置いた中身も突き合わせる）。

mod common;

use da_core::bundle::{Builder, Env};
use da_core::lot::Lot;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

const FILES: [&str; 1] = ["equipment_groups.json"];

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

/// 置き場の設備グループのファイル（共有・同梱の data/）
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

/// この道が読むマスタ（設備グループと、選べる設備を数える作業実績・設備マスタ・データ元）。権限の係が読むマスタ（tab_access など）は
/// どの道でも門番が読むので、ここでは比べない（これまでの窓の道と同じ扱い）
const READS: [&str; 4] = ["equipment_groups.json", "work_log_files.json", "equipment_master.json", "data_sources.json"];

/// 共有・同梱の data/ にある、この道が読むマスタのファイルの名前
fn names(root: &Path) -> Vec<String> {
    let mut out = vec![];
    for d in ["share", "base/data"] {
        for f in READS {
            if root.join(d).join(f).exists() {
                out.push(format!("{d}/{f}"));
            }
        }
    }
    out
}

#[test]
fn equipment_groups_match_python() {
    let base = common::work("equipgroups-write");
    // 作り物の CM3 は窓が問い合わせる間も起こしておく（版 3.96.0 から窓がスケジュールの係）
    let (live, oracle) = common::Live::start("equipgroups_oracle.py", &[base.to_str().unwrap(), "--serve"]);
    let mut bad = vec![];
    let (mut steps, mut delegated, mut seen, mut placed_by_python, mut cm3_cases) = (0, 0, 0, 0, 0);
    for sc in oracle["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let e = &sc["env"];
        let p = |k: &str| PathBuf::from(e[k].as_str().unwrap());
        // SAFETY: この試験の糸だけが環境を変える（配った設定の置き場）
        unsafe { std::env::set_var("TRANSFER_APP_CONFIG", e["config"].as_str().unwrap()) };
        let lot = Lot::new(p("local").join("db_cache"));
        lot.set_bundle(Builder::new(Env { base: p("base"), program: p("program"), local: p("local"), config: p("config"), now: None }));
        let rs = PathBuf::from(sc["rs"].as_str().unwrap());
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
            // データ元の設備の列から数えた設備（出どころが場面のデータ元）がある答えを数える（数え方の突き合わせが空振りしていないか）
            if want["seen"].as_array().into_iter().flatten().any(|x| x["from"].as_array().is_some_and(|f| f.contains(&json!("仕掛")))) {
                seen += 1;
            }
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
        // 置かれたマスタのファイル: 窓（答えた歩＋任せた歩）と Python（答えた歩）で同じ名前。任せた歩で Python が最初の版を置くマスタは、窓は置かない
        let (np, nr) = (names(Path::new(sc["py"].as_str().unwrap())), names(&rs));
        if np != nr {
            let only = |a: &[String], b: &[String]| a.iter().filter(|x| !b.contains(x)).cloned().collect::<Vec<_>>();
            bad.push(format!("{name}: 置かれたファイル Python だけ {:?} / 窓だけ {:?}", only(&np, &nr), only(&nr, &np)));
        }
        // 共有にまだ無いマスタ（数える材料）の場面（版 3.105.0）: 窓も Python と同じ最初の版を置く（種まき）。中身（版・行・置いた人）も同じ
        // （写しがあれば写し、写しも data/ も無ければ最初の中身〈program/app/master_defaults〉か空の版 1。時刻は伏せる）
        if let Some(absent) = sc["absent"].as_str() {
            let f = format!("share/{absent}.json");
            // 中身の場面のフォルダ（データ元の場所など）は Python の側の名前にそろえる
            let mine = std::fs::read(rs.join(&f))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .and_then(|v| serde_json::from_str::<Value>(&v.to_string().replace(&esc("rs"), &esc("py"))).ok());
            match (&sc["absentPlaced"], mine) {
                (Value::Null, _) => bad.push(format!("{name}: {f} を Python が置かない")),
                (_, None) => bad.push(format!("{name}: {f} を窓が置かない")),
                (want, Some(got)) => match common::diff(&norm(want), &norm(&got), &f) {
                    Some(d) => bad.push(format!("{name}: 置いた最初の版 {d}")),
                    None => placed_by_python += 1,
                },
            }
        }
        // スケジュールの元がある場面（版 3.94.0。CI の自己診断で見つけた）: 選べる設備は CM3 に届くかで変わる（届けばスケジュールの設備も数える）。
        // 版 3.96.0 から窓がスケジュールの係なので、一覧も書ける歩も窓が答え、上で Python と同じ答え。ここでは数えたかが場面どおりかを見る
        if let Some(cm3) = sc["cm3"].as_str() {
            let list = &sc["steps"][0]["json"]["seen"];
            let counted =
                list.as_array().into_iter().flatten().any(|x| x["from"].as_array().is_some_and(|f| f.contains(&json!("スケジュール"))));
            if counted == (cm3 == "up") {
                cm3_cases += 1;
            } else {
                bad.push(format!("{name}: CM3 {cm3} で Python がスケジュールの設備を数えた {counted}"));
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
    drop(live);
    eprintln!(
        "答えた歩 {steps}・任せた歩 {delegated}・データ元の設備を数えた答え {seen}・共有に無い数える材料を窓も同じに置いた場面 {placed_by_python}"
    );
    // 版 3.105.0: 任せた歩の下限は置かない（任せる歩は 0 へ減らしていく数で、減らすたびに落ちる。任せるはずの歩を窓が答えないことは歩ごとの確かめが、上限は予算〈common::check_budget〉が見る）
    assert!(steps >= 288, "歩が少ない: {steps}・{delegated}");
    assert!(placed_by_python >= 6, "共有にまだ無いマスタを窓と Python が同じに置く場面が空振り: {placed_by_python}");
    assert!(cm3_cases >= 2, "スケジュールの元の場面が空振り: {cm3_cases}");
    assert!(seen >= 40, "データ元の設備の列から数えた答えが少ない: {seen}");
    let _ = std::fs::remove_dir_all(&base);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
