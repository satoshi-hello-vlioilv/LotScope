//! 稼働（ガントチャート）・ABC 分析と換算係数（版 3.63.0）: 窓（src/operation.rs・src/dashboard.rs の稼働の道）が POST /api/dashboard/query の
//! gantt・abc のパネルに、Python の道（routes/dashboard.py の _ops_answer・services/operation.py）と同じ答え・同じ失敗を返すか。
//! program/tests/ops_oracle.py が tools/ops-bench.py の 9 つの書き方の設備に、区間を出せない理由のすべて・棒の上限を超える設備・読めない設備・
//! 品種と量の列・勤務体系の違う設備を足し、ガントと ABC の選び方ごとに Python で答えた物と突き合わせる。設定を替えて問い直す段も
//! （足した設備〈値の書き方・勤務体系の形・上限の両側〉・いまを替える〈答えの控えを残したまま。組ごとに設定を持つ〉・勤務体系が無い）。
//! 段の始めと、設定を持つ組の前で一覧の設定を尋ね直す（Lot::invalidate。答えの控えは消さない）。
//! 写しの様子（mirrors）は元の場所・間隔・古さのしきい・写したかを比べ、かかった時間は比べない。

mod common;

use da_core::lot::Lot;
use serde_json::{json, Value};

fn strip(v: &mut Value) {
    match v {
        Value::Object(o) => {
            o.remove("timing");
            // 写している途中の済んだバイト・速さ・残り秒は、問い合わせた時に写しの糸がどこまで進んでいたかで決まる（版 3.111.0。
            // Windows の CI で、窓だけが写しの途中の bytes を持つ形が出た）。数え方そのものは dashboard::tests の
            // copying_is_counted_within_one_data_source が決まった数で確かめるので、ここでは何台写したか（done・total・name）だけを比べる
            if let Some(Value::Object(c)) = o.get_mut("copy") {
                for k in ["bytes", "rate", "leftSec"] {
                    c.remove(k);
                }
            }
            if let Some(Value::Array(ms)) = o.get_mut("mirrors") {
                for m in ms.iter_mut() {
                    *m = json!({"remote": m["remote"], "interval_sec": m["interval_sec"], "staleHours": m["staleHours"], "mirrored": m["mirrored"]});
                }
            }
            o.values_mut().for_each(strip);
        }
        Value::Array(a) => a.iter_mut().for_each(strip),
        _ => {}
    }
}

fn check(lot: &Lot, settings: &Value, c: &Value, label: &str, bad: &mut Vec<String>) -> bool {
    let ask = || Ok(settings.clone());
    let body = serde_json::to_vec(&json!({"panel": c["panel"]})).unwrap();
    let Some((status, mut got)) = lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask) else {
        bad.push(format!("{label}: 窓が答えません（Python に回した）"));
        return false;
    };
    let mut want = c["body"].clone();
    strip(&mut want);
    strip(&mut got);
    if status as u64 != c["status"].as_u64().unwrap() {
        bad.push(format!("{label}: 状態 {status} / Python {}（窓 {} / Python {}）", c["status"], got["error"], want["error"]));
    } else if let Some(d) = common::diff(&want, &got, "") {
        bad.push(format!("{label}: {d}"));
    }
    true
}

/// 答えの控え: 同じ組でも、作業実績の写しが新しくなれば数え直す（控えの鍵に写しのファイルの印）。足した設備 TXT の元から 1 行消して写し直す
fn recount_after_refresh(lot: &Lot, o: &Value, bad: &mut Vec<String>) {
    let settings = o["phases"][0]["settings"].clone();
    let ask = || Ok(settings.clone());
    lot.invalidate();
    let body =
        serde_json::to_vec(&json!({"panel": {"id": "g1", "visual": "gantt", "source": "work", "equips": ["TXT"], "ops": {}}})).unwrap();
    let count = || lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask).and_then(|(_, v)| v["equips"][0]["count"].as_i64());
    let before = count();
    if before != count() {
        bad.push("写しが同じなのに答えが変わりました（控え）".into());
    }
    let db = rusqlite::Connection::open(std::path::Path::new(o["workFolder"].as_str().unwrap()).join("実績_TXT.sqlite3")).unwrap();
    db.execute("DELETE FROM 実績 WHERE ロット番号 = 'T002'", []).unwrap();
    drop(db);
    let rows = settings["lists"]["work"]["rows"].as_array().cloned().unwrap_or_default();
    let key = rows.iter().find(|r| r["設備名"] == "TXT").and_then(|r| r["キー"].as_str()).unwrap_or("").to_string();
    let r = lot.handle("POST", "/api/worklog/refresh", &format!("equip={key}"), &ask).expect("写し直しは窓が答える");
    if r.1["result"]["updated"] != true {
        bad.push(format!("TXT を写し直せません: {}", r.1));
    }
    let after = count();
    if after != before.map(|n| n - 1) {
        bad.push(format!("写しが新しくなったのに数え直しません（前 {before:?}・後 {after:?}）"));
    }
}

#[test]
fn operation_answers_like_python() {
    let work = common::work("ops");
    let o = common::python_json("ops_oracle.py", &[]);
    let settings = o["settings"].clone();
    let lot = Lot::new(work.join("db_cache"));
    let mut bad = vec![];
    let (mut total, mut gantt, mut abc, mut fails, mut phased) = (0, 0, 0, 0, 0);
    for c in o["cases"].as_array().unwrap() {
        total += 1;
        let name = c["name"].as_str().unwrap();
        gantt += (c["body"]["kind"] == "gantt") as usize;
        abc += (c["body"]["kind"] == "abc") as usize;
        fails += (c["status"] != 200) as usize;
        check(&lot, &settings, c, name, &mut bad);
    }
    for ph in o["phases"].as_array().unwrap() {
        lot.invalidate();
        for c in ph["cases"].as_array().unwrap() {
            total += 1;
            phased += 1;
            let settings = match c.get("settings") {
                Some(s) => {
                    lot.invalidate();
                    s
                }
                None => &ph["settings"],
            };
            check(&lot, settings, c, &format!("{} / {}", ph["name"].as_str().unwrap(), c["name"].as_str().unwrap()), &mut bad);
        }
    }
    recount_after_refresh(&lot, &o, &mut bad);
    let _ = std::fs::remove_dir_all(&work);
    // Python の係が作った作業の場所（tools/ops-bench.py の tpa-ops-*。workFolder はその中の「実績」）も片付ける
    if let Some(top) = o["workFolder"].as_str().and_then(|f| std::path::Path::new(f).parent()) {
        let _ = std::fs::remove_dir_all(top);
    }
    assert!(
        total >= 150 && gantt >= 15 && abc >= 20 && fails >= 6 && phased >= 100,
        "組が足りません: {total} 通り・ガント {gantt}・ABC {abc}・失敗 {fails}・段の中 {phased}"
    );
    assert!(bad.is_empty(), "{} / {total} 通りが食い違いました:\n{}", bad.len(), bad.join("\n"));
}
