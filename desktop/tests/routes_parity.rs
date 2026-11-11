//! 一覧の道（版 3.60.0）: 窓（src/lot.rs・src/lists.rs）が品質・作業実績・データ元の一覧・スライサー・データの時刻・再読込に、
//! Python の道（routes/lotlist.py・worklog.py・sources.py）と同じ答え・同じ失敗を返すか。program/tests/routes_oracle.py が開発用サーバーと
//! 同じ試験データに結合・ロット番号の列・間隔・名前の変わったファイル・大文字小文字の違う登録名・設備ごとの表・表示しない設備・
//! 見つからない設備を足し、同じ問い合わせを Python で答えた物と突き合わせる。段は 2 つ（開発者・実績と結合した表を出さない一般ユーザー）。
//! 写しは窓が自分の置き場へ写す（Python の写しとは別）。いつのデータか（source）は、元の場所・間隔・古さのしきい・写したかを比べる
//! （時刻は比べない）。再読込の結果は、写したか・見送ったか・理由を比べる。かかった時間（timing・work.ms）は比べない。

mod common;

use da_core::lot::Lot;
use serde_json::{json, Value};

/// いつのデータか（source の答え）のうち、窓と Python で同じになるはずの所
fn source_part(v: &Value) -> Value {
    json!({"remote": v["remote"], "interval_sec": v["interval_sec"], "staleHours": v["staleHours"], "mirrored": v["mirrored"]})
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
    let o = common::python_json("routes_oracle.py", &[]);
    let phases = o["phases"].as_array().unwrap();
    assert_eq!(phases.len(), 2, "開発者と、タブを出さない一般ユーザーの 2 段");
    let lot = Lot::new(work.join("db_cache"));
    let mut bad = vec![];
    let (mut total, mut filled, mut forbidden) = (0, 0, 0);
    for ph in phases {
        let settings = ph["settings"].clone();
        assert_eq!(settings["engine"], "rust");
        lot.invalidate(); // 段ごとの設定の答え（出さないタブ）で尋ね直す。写しの係はそのまま
        let ask = || Ok(settings.clone());
        for a in ph["asks"].as_array().unwrap() {
            total += 1;
            let (method, path, query) = (a["method"].as_str().unwrap(), a["path"].as_str().unwrap(), a["query"].as_str().unwrap());
            let Some((status, mut got)) = lot.handle(method, path, query, &ask) else {
                bad.push(format!("[{}] {path}?{query}: 窓が答えません（Python に回した）", ph["name"]));
                continue;
            };
            filled += got["rows"].as_array().or(got["values"].as_array()).is_some_and(|r| !r.is_empty()) as usize;
            forbidden += (got["kind"] == "forbidden") as usize;
            let mut want = a["body"].clone();
            strip(&mut want, path);
            strip(&mut got, path);
            if status != a["status"].as_u64().unwrap() as u16 {
                bad.push(format!("[{}] {method} {path}?{query}: 状態 {status} / Python {}（{}）", ph["name"], a["status"], got["error"]));
            } else if let Some(d) = common::diff(&want, &got, "") {
                bad.push(format!("[{}] {method} {path}?{query}: {d}", ph["name"]));
            }
        }
    }
    assert!(total >= 40 && filled >= 16 && forbidden >= 5, "問い合わせの組が足りません: {total} 通り・中身 {filled}・権限 {forbidden}");
    let ask = || Ok(phases[0]["settings"].clone());
    // スケジュール（CM3）は、Python に尋ねた設定（窓の束の設定が無い形）では Python が答える（窓が答える形は tests/schedule_parity.rs）
    assert!(lot.handle("GET", o["python"].as_str().unwrap(), "", &ask).is_none(), "スケジュールは Python へ回す");
    // 作業実績の写しは窓の置き場（db_cache/work_log）・結合の答えは db_cache/joins（Python と同じ名前の決まり）
    assert!(work.join("db_cache").join("work_log").join("_mirror.json").exists(), "作業実績の写しの台帳");
    assert!(std::fs::read_dir(work.join("db_cache").join("joins")).map(|d| d.count()).unwrap_or(0) >= 2, "結合の答えのファイル");
    let _ = std::fs::remove_dir_all(&work);
    assert!(bad.is_empty(), "{} / {total} 通りが食い違いました:\n{}", bad.len(), bad.join("\n"));
}
