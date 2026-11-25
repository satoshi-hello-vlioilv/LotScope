//! 一覧の道（版 3.60.0）: 窓（src/lot.rs・src/lists.rs）が品質・作業実績・データ元の一覧・スライサー・データの時刻・再読込に、
//! Python の道（routes/lotlist.py・worklog.py・sources.py）と同じ答え・同じ失敗を返すか。前の版の答え合わせ役 routes が開発用サーバーと
//! 同じ試験データに結合・ロット番号の列・間隔・名前の変わったファイル・大文字小文字の違う登録名・設備ごとの表・表示しない設備・
//! 見つからない設備を足し、同じ問い合わせを Python で答えた物と突き合わせる。段は 2 つ（開発者・実績と結合した表を出さない一般ユーザー）。
//! 写しは窓が自分の置き場へ写す（Python の写しとは別）。いつのデータか（source）は、元の場所・間隔・古さのしきい・写したか・古いか・届かないか・理由を比べる（common::mirror_part）
//! （時刻は比べない）。再読込の結果は、写したか・見送ったか・理由を比べる。かかった時間（timing・work.ms）は比べない。
//! 版 3.117.2 から窓の答えを焼いた表（tests/baked/routes.json。詰めた形）にも持つ。場面は作業フォルダの下で、SQLite は標準の部品だけの台本
//! （program/tests/ui_scene.py）が作り、表は指紋だけを持つ。名前つきの歩: 登録の後にファイルが無くなった SL3 は 404・missing、中身が SQLite でない
//! BAD は 503・copying（前は消した SL3 のファイル番号を BAD が使い回すかで、ext4 と tmpfs で答えが入れ替わった）。

mod common;

use da_core::lot::Lot;
use serde_json::{json, Value};

/// いつのデータか（source の答え）のうち、窓と Python で同じになるはずの所
fn source_part(v: &Value) -> Value {
    common::mirror_part(v)
}

fn strip(v: &mut Value, path: &str) {
    if path.ends_with("/source") && v.get("error").is_none() {
        *v = source_part(v);
        return;
    }
    if let Some(o) = v.as_object_mut() {
        o.remove("timing");
        if let Some(s) = o.get("source").cloned() {
            o.insert("source".into(), source_part(&s));
        }
        if let Some(r) = o.get("result").cloned() {
            o.insert("result".into(), json!({"updated": r["updated"], "skipped": r["skipped"], "reason": r["reason"]}));
        }
        if let Some(w) = o.get_mut("work").and_then(Value::as_object_mut) {
            w.remove("ms");
        }
    }
}

#[test]
fn routes_answer_like_python() {
    let work = common::work("routes");
    let mut bk = common::bake::Bake::open("routes", &work);
    bk.pack = true;
    bk.script = Some(("ui_scene.py", vec![work.to_string_lossy().into_owned(), "routes".into()]));
    // 答え合わせ役（Python）だけの写し・控えは場面に持たない。場面のファイルID は @FID(道)
    bk.exclude.extend(["cache", "local", "instance_id", "roll_master.json", "roll_master.csv"]);
    bk.fid_key = Some("fids");
    let o = bk.table_oracle();
    let phases = o["phases"].as_array().unwrap();
    assert_eq!(phases.len(), 2, "開発者と、タブを出さない一般ユーザーの 2 段");
    let lot = Lot::new(work.join("db_cache"));
    let mut bad = vec![];
    let (mut total, mut filled, mut forbidden) = (0, 0, 0);
    let mut named: std::collections::BTreeMap<String, (i64, Value)> = Default::default();
    for ph in phases {
        let settings = ph["settings"].clone();
        assert_eq!(settings["engine"], "rust");
        lot.invalidate(); // 段ごとの設定の答え（出さないタブ）で尋ね直す。写しの係はそのまま
        let ask = || Ok(settings.clone());
        for (i, a) in ph["asks"].as_array().unwrap().iter().enumerate() {
            total += 1;
            let (method, path, query) = (a["method"].as_str().unwrap(), a["path"].as_str().unwrap(), a["query"].as_str().unwrap());
            let label = format!("{method} {path}?{query}");
            let key = format!("{}#{i} {method} {path}", ph["name"].as_str().unwrap());
            let Some((status, mut got)) = lot.handle_with(method, path, query, &ask) else {
                bad.push(format!("[{}] {path}?{query}: 窓が答えません（Python に回した）", ph["name"]));
                continue;
            };
            filled += got["rows"].as_array().or(got["values"].as_array()).is_some_and(|r| !r.is_empty()) as usize;
            forbidden += (got["kind"] == "forbidden") as usize;
            strip(&mut got, path);
            let got = json!({"status": status, "body": got});
            let want = bk.want(&key, || {
                let mut b = a["body"].clone();
                strip(&mut b, path);
                json!({"status": a["status"], "body": b})
            });
            bk.note(&key, path, &got, &want);
            if ph["name"] == "開発者" {
                for (n, l) in o["named"].as_object().unwrap() {
                    if l.as_str() == Some(label.as_str()) {
                        named.insert(n.clone(), (status as i64, got["body"].clone()));
                        named.insert(format!("{n}（比べる相手）"), (want["status"].as_i64().unwrap_or(-1), want["body"].clone()));
                    }
                }
            }
            let (want, got) = (bk.s(&want), bk.s(&got));
            if got["status"] != want["status"] {
                bad.push(format!(
                    "[{}] {label}: 状態 {} / Python {}（{}）",
                    ph["name"], got["status"], want["status"], got["body"]["error"]
                ));
            } else if let Some(d) = common::diff(&want, &got, "") {
                bad.push(format!("[{}] {label}: {d}", ph["name"]));
            }
        }
    }
    // 名前つきの歩（版 3.117.2 の採点 first_fixes 6）: 窓も比べる相手（Python か焼いた表）も、SL3 は 404・missing／BAD は 503・copying。
    // 作った後の採点の割れ 1: 更新が止まった HOT（40 時間前・しきい 36 時間）の一覧は 200 で、写しの様子が stale=true・届く
    for n in ["SL3", "BAD", "HOT"] {
        for who in [n.to_string(), format!("{n}（比べる相手）")] {
            let ok = match (n, named.get(&who)) {
                ("SL3", Some((s, b))) => *s == 404 && b["kind"] == "missing",
                ("BAD", Some((s, b))) => *s == 503 && b["kind"] == "copying",
                ("HOT", Some((s, b))) => *s == 200 && b["source"]["stale"] == true && b["source"]["unreachable"] == false,
                _ => false,
            };
            if !ok {
                bad.push(format!("名前つきの歩 {who}: 答えが違う（{:?}）", named.get(&who)));
            }
        }
    }
    assert!(total >= 40 && filled >= 16 && forbidden >= 5, "問い合わせの組が足りません: {total} 通り・中身 {filled}・権限 {forbidden}");
    let ask = || Ok(phases[0]["settings"].clone());
    // スケジュールは、Python に尋ねた設定（窓の束の設定が無い形）では、版 3.118.0 の作った後の採点の割れ 5 から窓が理由つきの 503 で断る
    // （前は Python へ回した。窓が答える形は tests/schedule_parity.rs）
    let got = lot.handle_with("GET", o["python"].as_str().unwrap(), "", &ask);
    assert_eq!(got.as_ref().map(|r| (r.0, r.1["kind"].clone())), Some((503, json!("settings"))), "スケジュールの段が無い: {got:?}");
    // 作業実績の写しは窓の置き場（db_cache/work_log）・結合の答えは db_cache/joins（Python と同じ名前の決まり）
    assert!(work.join("db_cache").join("work_log").join("_mirror.json").exists(), "作業実績の写しの台帳");
    assert!(std::fs::read_dir(work.join("db_cache").join("joins")).map(|d| d.count()).unwrap_or(0) >= 2, "結合の答えのファイル");
    let _ = std::fs::remove_dir_all(&work);
    bk.finish(&bad);
    assert!(bad.is_empty(), "{} / {total} 通りが食い違いました:\n{}", bad.len(), bad.join("\n"));
}
