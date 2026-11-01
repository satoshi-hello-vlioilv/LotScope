//! 一覧の道（版 3.60.0）: 窓（src/lot.rs・src/lists.rs）が品質・作業実績・データ元の一覧とスライサーに、Python の道
//! （routes/lotlist.py・worklog.py・sources.py）と同じ答え・同じ失敗を返すか。program/tests/routes_oracle.py が開発用サーバーと同じ
//! 試験データに結合・ロット番号の列・表示しない設備・見つからない設備を足し、同じ問い合わせを Python で答えた物と突き合わせる。
//! 写しは窓が自分の置き場へ写す（Python の写しとは別）。いつのデータか（source）・かかった時間（timing・work.ms）は比べない。

mod common;

use da_core::lot::Lot;
use serde_json::Value;

fn strip(v: &mut Value) {
    if let Some(o) = v.as_object_mut() {
        o.remove("source");
        o.remove("timing");
        if let Some(w) = o.get_mut("work").and_then(Value::as_object_mut) {
            w.remove("ms");
        }
    }
}

#[test]
fn routes_answer_like_python() {
    let work = common::work("routes");
    let o = common::python_json("routes_oracle.py", &[]);
    let settings = o["settings"].clone();
    assert_eq!(settings["engine"], "rust");
    let lot = Lot::new(work.join("db_cache"));
    let ask = || Ok(settings.clone());
    let asks = o["asks"].as_array().unwrap();
    assert!(asks.len() >= 20 && asks.iter().filter(|a| a["status"] != 200).count() >= 5, "問い合わせの組が足りません");
    let mut bad = vec![];
    let mut filled = 0;
    for a in asks {
        let (method, path, query) = (a["method"].as_str().unwrap(), a["path"].as_str().unwrap(), a["query"].as_str().unwrap());
        let Some((status, mut got)) = lot.handle(method, path, query, &ask) else {
            bad.push(format!("{path}?{query}: 窓が答えません（Python に回した）"));
            continue;
        };
        filled += got["rows"].as_array().or(got["values"].as_array()).is_some_and(|r| !r.is_empty()) as usize;
        let mut want = a["body"].clone();
        strip(&mut want);
        strip(&mut got);
        if status != a["status"].as_u64().unwrap() as u16 {
            bad.push(format!("{path}?{query}: 状態 {status} / Python {}（{}）", a["status"], got["error"]));
        } else if let Some(d) = common::diff(&want, &got, "") {
            bad.push(format!("{path}?{query}: {d}"));
        }
    }
    assert!(filled >= 12, "中身のある答えが少なすぎます: {filled}");
    // スケジュール（CM3）は Python が答える
    assert!(lot.handle("GET", o["python"].as_str().unwrap(), "", &ask).is_none(), "スケジュールは Python へ回す");
    // 作業実績の写しは窓の置き場（db_cache/work_log）・結合の答えは db_cache/joins（Python と同じ名前の決まり）
    assert!(work.join("db_cache").join("work_log").join("_mirror.json").exists(), "作業実績の写しの台帳");
    assert!(std::fs::read_dir(work.join("db_cache").join("joins")).map(|d| d.count()).unwrap_or(0) >= 2, "結合の答えのファイル");
    let _ = std::fs::remove_dir_all(&work);
    assert!(bad.is_empty(), "{} / {} 通りが食い違いました:\n{}", bad.len(), asks.len(), bad.join("\n"));
}
