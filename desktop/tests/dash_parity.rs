//! ダッシュボードのパネルの数（版 3.62.0）: 窓（src/dashboard.rs。src/lot.rs の handle_body）が POST /api/dashboard/query に、
//! Python の道（routes/dashboard.py の dashboard_query）と同じ答え・同じ失敗を返すか。program/tests/dashboard_oracle.py が開発用サーバーと
//! 同じ試験データに読めない設備・表示しない設備・設備の並び・設備の列の書きゆれ・30 を超える設備・設備グループ（正規表現・除く）・
//! 全角の合金を足し、パネルの形ごと（数字・グラフ・合わせた表・別のデータ・設備の分け方・まとめ・設備グループの段・手で並べた順・
//! 期間・計算列・箱ひげ・確かめの失敗）に Python で答えた物と突き合わせる。稼働（ガント・ABC）とスケジュールは Python へ回す（None）。
//! 写しは窓が自分の置き場へ写す。写しの様子（mirrors）は元の場所・間隔・古さのしきい・写したかを比べ、かかった時間（timing）は比べない。

mod common;

use da_core::lot::Lot;
use serde_json::{json, Value};

/// 窓と Python で同じになるはずの所だけにする（写しの時刻・かかった時間を外す）
fn strip(v: &mut Value) {
    match v {
        Value::Object(o) => {
            o.remove("timing");
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

/// Python へ送った本文の字そのもの（鍵は送った順。版 3.83.0。読み直した serde の値は鍵を字の順に並べ直すので使わない）
fn sent(c: &Value) -> Vec<u8> {
    match c["raw"].as_str() {
        Some(t) => t.as_bytes().to_vec(),
        None => serde_json::to_vec(&json!({"panel": c["panel"]})).unwrap(),
    }
}

#[test]
fn dashboard_answers_like_python() {
    let work = common::work("dash");
    let o = common::python_json("dashboard_oracle.py", &[]);
    let settings = o["settings"].clone();
    assert_eq!(settings["engine"], "rust");
    assert!(settings["lists"]["dash"]["now"].is_string(), "試験の「いま」が設定の答えに無い");
    let lot = Lot::new(work.join("db_cache"));
    let ask = || Ok(settings.clone());
    let mut bad = vec![];
    let (mut total, mut cells, mut fails, mut facets, mut boards, mut links) = (0, 0, 0, 0, 0, 0);
    for c in o["cases"].as_array().unwrap() {
        total += 1;
        let name = c["name"].as_str().unwrap();
        let body = sent(c);
        let Some((status, mut got)) = lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask) else {
            bad.push(format!("{name}: 窓が答えません（Python に回した）"));
            continue;
        };
        let mut want = c["body"].clone();
        cells += want.get("cells").is_some() as usize;
        fails += (c["status"] != 200) as usize;
        facets += want.get("facets").and_then(Value::as_array).is_some_and(|f| !f.is_empty()) as usize;
        boards += want.get("groups").is_some() as usize;
        links += want.get("link").is_some() as usize;
        strip(&mut want);
        strip(&mut got);
        if status as u64 != c["status"].as_u64().unwrap() {
            bad.push(format!("{name}: 状態 {status} / Python {}（窓 {} / Python {}）", c["status"], got["error"], want["error"]));
        } else if let Some(d) = common::diff(&want, &got, "") {
            bad.push(format!("{name}: {d}"));
        }
    }
    // 設定を替えて問い直す段: 「いま」を変える（前の「いま」で同じ組を先に問い、答えの控えに入れてから）・出さないタブ
    let mut phases = 0;
    for ph in o["phases"].as_array().unwrap() {
        let phs = ph["settings"].clone();
        let ask_ph = || Ok(phs.clone());
        for c in ph["cases"].as_array().unwrap() {
            total += 1;
            let name = format!("{} / {}", ph["name"].as_str().unwrap(), c["name"].as_str().unwrap());
            let body = sent(c);
            if ph["warm"] == true {
                lot.invalidate();
                let _ = lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask);
            }
            lot.invalidate();
            let Some((status, mut got)) = lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask_ph) else {
                bad.push(format!("{name}: 窓が答えません"));
                continue;
            };
            let mut want = c["body"].clone();
            strip(&mut want);
            strip(&mut got);
            if status as u64 != c["status"].as_u64().unwrap() {
                bad.push(format!("{name}: 状態 {status} / Python {}", c["status"]));
            } else if let Some(d) = common::diff(&want, &got, "") {
                bad.push(format!("{name}: {d}"));
            }
            fails += (c["status"] == 403) as usize;
        }
        phases += 1;
    }
    lot.invalidate();
    assert!(o["cases"].as_array().unwrap().iter().all(|c| c["raw"].is_string()), "送った本文の字（raw）が答えの見本に無い");
    assert!(o["cases"].as_array().unwrap().iter().any(|c| c["name"] == "計算列 式の上限は送った順の先頭 40 個"), "送った順に効く組が無い");
    assert!(phases >= 3, "設定を替えて問い直す段が足りません: {phases}");
    assert!(
        total >= 60 && cells >= 35 && fails >= 12 && facets >= 4 && boards >= 4 && links >= 4,
        "組が足りません: {total} 通り・答え {cells}・失敗 {fails}・並べる {facets}・合わせた表 {boards}・合わせる {links}"
    );
    // 稼働・ABC・スケジュールは Python が答える
    for c in o["python"].as_array().unwrap() {
        let body = serde_json::to_vec(&json!({"panel": c["panel"]})).unwrap();
        if lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask).is_some() {
            bad.push(format!("{}: 窓が答えた（Python へ回すはず）", c["name"]));
        }
    }
    // engine=python はその 1 回だけ Python
    let body = serde_json::to_vec(&json!({"panel": o["cases"][0]["panel"]})).unwrap();
    assert!(lot.handle_body("POST", "/api/dashboard/query", "engine=python", &body, &ask).is_none());
    assert!(lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask).is_some(), "ふつうは窓が答える");
    // 材料（lists.dash）を答えない中身（前の版の Python）とは、ダッシュボードを Python に任せる
    let mut old = settings.clone();
    old["lists"].as_object_mut().unwrap().remove("dash");
    lot.invalidate();
    let ask_old = || Ok(old.clone());
    assert!(lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask_old).is_none(), "材料の無い中身は Python へ回す");
    lot.invalidate();
    // 中身の係が python なら（食い違いに気づいて Python に戻した設定）、ダッシュボードも Python
    let mut py = settings.clone();
    py["engine"] = json!("python");
    let ask_py = || Ok(py.clone());
    assert!(lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask_py).is_none(), "engine が python なら Python へ回す");
    lot.invalidate();
    // 答えの控え: 同じ組でも、写しが新しくなれば数え直す（控えの鍵に写しのファイルの印）
    let kpi =
        serde_json::to_vec(&json!({"panel": {"id": "c1", "visual": "kpi", "source": "lot", "body": {"measures": [{"agg": "count"}]}}}))
            .unwrap();
    let count =
        |lot: &Lot| lot.handle_body("POST", "/api/dashboard/query", "", &kpi, &ask).and_then(|(_, v)| v["cells"][0]["v"][0].as_i64());
    let before = count(&lot);
    assert_eq!(before, count(&lot), "同じ写しなら同じ答え（控え）");
    let q = &o["quality"];
    let db = rusqlite::Connection::open(q["path"].as_str().unwrap()).unwrap();
    let t = q["table"].as_str().unwrap();
    db.execute(&format!("DELETE FROM [{t}] WHERE rowid = (SELECT MIN(rowid) FROM [{t}])"), []).unwrap();
    drop(db);
    let r = lot.handle("POST", "/api/lotlist/refresh", "", &ask).expect("再読込は窓が答える");
    assert_eq!(r.1["result"]["updated"], true, "写し直した: {}", r.1);
    let after = count(&lot);
    assert_eq!(after, before.map(|n| n - 1), "写しが新しくなったら数え直す（控えのまま {before:?} を返さない）");
    let _ = std::fs::remove_dir_all(&work);
    assert!(bad.is_empty(), "{} / {total} 通りが食い違いました:\n{}", bad.len(), bad.join("\n"));
}
