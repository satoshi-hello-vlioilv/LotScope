//! ダッシュボードのパネルの数（版 3.62.0）: 窓（src/dashboard.rs。src/lot.rs の handle_body）が POST /api/dashboard/query に、
//! Python の道（routes/dashboard.py の dashboard_query）と同じ答え・同じ失敗を返すか。program/tests/dashboard_oracle.py が開発用サーバーと
//! 同じ試験データに読めない設備・表示しない設備・設備の並び・設備の列の書きゆれ・30 を超える設備・設備グループ（正規表現・除く）・
//! 全角の合金を足し、パネルの形ごと（数字・グラフ・合わせた表・別のデータ・設備の分け方・まとめ・設備グループの段・手で並べた順・
//! 期間・計算列・箱ひげ・確かめの失敗）に Python で答えた物と突き合わせる。スケジュールは窓の束の設定が無いこの試験では Python へ回す（None。
//! 窓が答える形は tests/schedule_parity.rs）。
//! 写しは窓が自分の置き場へ写す。写しの様子（mirrors）は元の場所・間隔・古さのしきい・写したか・古いか・届かないか・理由を比べ（common::mirror_part）、かかった時間（timing）は比べない。
//! 版 3.117.2 から窓の答えを焼いた表（tests/baked/dashboard.json。詰めた形）にも持つ。場面は作業フォルダの下で、SQLite は標準の部品だけの台本
//! （program/tests/ui_scene.py）が作り、表は指紋だけを持つ。

mod common;

use da_core::lot::Lot;
use serde_json::{json, Value};

/// 窓と Python で同じになるはずの所だけにする（写しの時刻・かかった時間を外す）
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
                    *m = common::mirror_part(m);
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

/// 表の問い合わせに持つ形（Python の答え status・body を除く。変換表の版の印は決めた字）
fn question(v: &Value) -> Value {
    let mut o = v.clone();
    let drop = |cs: &mut Value| {
        for c in cs.as_array_mut().unwrap() {
            let c = c.as_object_mut().unwrap();
            c.remove("status");
            c.remove("body");
        }
    };
    drop(&mut o["cases"]);
    for ph in o["phases"].as_array_mut().unwrap() {
        drop(&mut ph["cases"]);
    }
    common::bake::fixed_conv_rev(&mut o);
    o
}

/// 答えの中の、更新が止まった HOT（実績_HOT.sqlite3）の写しの様子の stale（版 3.117.2 の作った後の採点の割れ 1）
fn hot_stale(v: &Value, out: &mut Vec<Value>) {
    match v {
        Value::Object(o) => {
            if o.get("remote").and_then(Value::as_str).is_some_and(|r| r.ends_with("実績_HOT.sqlite3")) {
                out.push(o.get("stale").cloned().unwrap_or(Value::Null));
            }
            o.values().for_each(|x| hot_stale(x, out));
        }
        Value::Array(a) => a.iter().for_each(|x| hot_stale(x, out)),
        _ => {}
    }
}

/// 1 つの組を窓に尋ね、比べる相手（Python か焼いた表）と比べる → 比べる相手の答え（数える所に使う）。窓が答えなければ None
fn one(
    bk: &mut common::bake::Bake,
    lot: &Lot,
    c: &Value,
    key: &str,
    ask: &dyn Fn() -> Result<Value, String>,
    bad: &mut Vec<String>,
) -> Option<Value> {
    let body = sent(c);
    let Some((status, mut got)) = lot.handle_body_with("POST", "/api/dashboard/query", "", &body, ask) else {
        bad.push(format!("{key}: 窓が答えません（Python に回した）"));
        return None;
    };
    strip(&mut got);
    let got = json!({"status": status, "body": got});
    let want = bk.want(key, || {
        let mut b = c["body"].clone();
        strip(&mut b);
        json!({"status": c["status"], "body": b})
    });
    bk.note(key, "POST /api/dashboard/query", &got, &want);
    // 名前つきの確かめ: 窓も比べる相手も、HOT の写しの様子はどれも stale=true
    let (mut gs, mut ws) = (vec![], vec![]);
    hot_stale(&got, &mut gs);
    hot_stale(&want, &mut ws);
    if gs.iter().chain(&ws).any(|x| *x != true) {
        bad.push(format!("{key}: 更新が止まった HOT の写しの様子が stale=true でない（窓 {gs:?} / 比べる相手 {ws:?}）"));
    }
    let (w, g) = (bk.s(&want), bk.s(&got));
    if g["status"] != w["status"] {
        bad.push(format!(
            "{key}: 状態 {} / Python {}（窓 {} / Python {}）",
            g["status"], w["status"], g["body"]["error"], w["body"]["error"]
        ));
    } else if let Some(d) = common::diff(&w, &g, "") {
        bad.push(format!("{key}: {d}"));
    }
    Some(want)
}

#[test]
fn dashboard_answers_like_python() {
    let work = common::work("dash");
    let mut bk = common::bake::Bake::open("dashboard", &work);
    bk.pack = true;
    bk.script = Some(("ui_scene.py", vec![work.to_string_lossy().into_owned(), "dashboard".into()]));
    bk.exclude.extend(["cache", "local", "instance_id", "roll_master.json", "roll_master.csv"]);
    bk.fid_key = Some("fids");
    let o = bk.oracle_with("dashboard_oracle.py", &[work.to_str().unwrap()], question);
    let settings = o["settings"].clone();
    assert_eq!(settings["engine"], "rust");
    assert!(settings["lists"]["dash"]["now"].is_string(), "試験の「いま」が設定の答えに無い");
    let lot = Lot::new(work.join("db_cache"));
    let ask = || Ok(settings.clone());
    let mut bad = vec![];
    let (mut total, mut cells, mut fails, mut facets, mut boards, mut links, mut hot) = (0, 0, 0, 0, 0, 0, 0);
    for (i, c) in o["cases"].as_array().unwrap().iter().enumerate() {
        total += 1;
        let key = format!("#{i} {}", c["name"].as_str().unwrap());
        let Some(want) = one(&mut bk, &lot, c, &key, &ask, &mut bad) else { continue };
        let mut hs = vec![];
        hot_stale(&want, &mut hs);
        hot += (!hs.is_empty()) as usize;
        let w = &want["body"];
        cells += w.get("cells").is_some() as usize;
        fails += (want["status"] != 200) as usize;
        facets += w.get("facets").and_then(Value::as_array).is_some_and(|f| !f.is_empty()) as usize;
        boards += w.get("groups").is_some() as usize;
        links += w.get("link").is_some() as usize;
    }
    // 設定を替えて問い直す段: 「いま」を変える（前の「いま」で同じ組を先に問い、答えの控えに入れてから）・出さないタブ
    let mut phases = 0;
    for ph in o["phases"].as_array().unwrap() {
        let phs = ph["settings"].clone();
        let ask_ph = || Ok(phs.clone());
        for (i, c) in ph["cases"].as_array().unwrap().iter().enumerate() {
            total += 1;
            let key = format!("{} #{i} {}", ph["name"].as_str().unwrap(), c["name"].as_str().unwrap());
            if ph["warm"] == true {
                lot.invalidate();
                let _ = lot.handle_body_with("POST", "/api/dashboard/query", "", &sent(c), &ask);
            }
            lot.invalidate();
            if let Some(want) = one(&mut bk, &lot, c, &key, &ask_ph, &mut bad) {
                fails += (want["status"] == 403) as usize;
            }
        }
        phases += 1;
    }
    lot.invalidate();
    assert!(o["cases"].as_array().unwrap().iter().all(|c| c["raw"].is_string()), "送った本文の字（raw）が答えの見本に無い");
    assert!(o["cases"].as_array().unwrap().iter().any(|c| c["name"] == "計算列 式の上限は送った順の先頭 40 個"), "送った順に効く組が無い");
    for name in ["順 表示名の重なり 合金→重量", "順 表示名の重なり 合わせた表 合金→重量", "順 設備の式＋共通 40 先頭の z"]
    {
        assert!(o["cases"].as_array().unwrap().iter().any(|c| c["name"] == name), "計算列の中で送った順に効く組が無い: {name}");
    }
    assert!(phases >= 3, "設定を替えて問い直す段が足りません: {phases}");
    assert!(hot >= 20, "更新が止まった HOT の写しの様子を持つ組が足りません: {hot}");
    assert!(
        total >= 60 && cells >= 35 && fails >= 12 && facets >= 4 && boards >= 4 && links >= 4,
        "組が足りません: {total} 通り・答え {cells}・失敗 {fails}・並べる {facets}・合わせた表 {boards}・合わせる {links}"
    );
    // スケジュールは、Python に尋ねた設定（窓の束を組めない形。この試験の設定: スケジュールの段 scheduleConf が無い）では、版 3.118.0（段 ④）の
    // 作った後の採点の割れ 5 から窓が理由つきで断る（前は窓が答えず Python が答えた。窓の束の設定では窓が係: tests/schedule_parity.rs）
    for c in o["python"].as_array().unwrap() {
        let body = serde_json::to_vec(&json!({"panel": c["panel"]})).unwrap();
        let got = lot.handle_body_with("POST", "/api/dashboard/query", "", &body, &ask);
        if got.as_ref().map(|r| r.0) != Some(503) {
            bad.push(format!("{}: 窓が理由つきの 503 で断らない（{got:?}）", c["name"]));
        }
    }
    // engine=python はその 1 回だけ Python
    let body = serde_json::to_vec(&json!({"panel": o["cases"][0]["panel"]})).unwrap();
    assert!(lot.handle_body_with("POST", "/api/dashboard/query", "engine=python", &body, &ask).is_none());
    assert!(lot.handle_body_with("POST", "/api/dashboard/query", "", &body, &ask).is_some(), "ふつうは窓が答える");
    // 材料（lists.dash）を答えない中身（前の版の Python）とは、ダッシュボードを Python に任せる
    let mut old = settings.clone();
    old["lists"].as_object_mut().unwrap().remove("dash");
    lot.invalidate();
    let ask_old = || Ok(old.clone());
    assert!(lot.handle_body_with("POST", "/api/dashboard/query", "", &body, &ask_old).is_none(), "材料の無い中身は Python へ回す");
    lot.invalidate();
    // 中身の係が python なら（食い違いに気づいて Python に戻した設定）、ダッシュボードも Python
    let mut py = settings.clone();
    py["engine"] = json!("python");
    let ask_py = || Ok(py.clone());
    assert!(lot.handle_body_with("POST", "/api/dashboard/query", "", &body, &ask_py).is_none(), "engine が python なら Python へ回す");
    lot.invalidate();
    // 答えの控え: 同じ組でも、写しが新しくなれば数え直す（控えの鍵に写しのファイルの印）
    let kpi =
        serde_json::to_vec(&json!({"panel": {"id": "c1", "visual": "kpi", "source": "lot", "body": {"measures": [{"agg": "count"}]}}}))
            .unwrap();
    let count =
        |lot: &Lot| lot.handle_body_with("POST", "/api/dashboard/query", "", &kpi, &ask).and_then(|(_, v)| v["cells"][0]["v"][0].as_i64());
    let before = count(&lot);
    assert_eq!(before, count(&lot), "同じ写しなら同じ答え（控え）");
    let q = &o["quality"];
    let db = rusqlite::Connection::open(q["path"].as_str().unwrap()).unwrap();
    let t = q["table"].as_str().unwrap();
    db.execute(&format!("DELETE FROM [{t}] WHERE rowid = (SELECT MIN(rowid) FROM [{t}])"), []).unwrap();
    drop(db);
    let r = lot.handle_with("POST", "/api/lotlist/refresh", "", &ask).expect("再読込は窓が答える");
    assert_eq!(r.1["result"]["updated"], true, "写し直した: {}", r.1);
    let after = count(&lot);
    assert_eq!(after, before.map(|n| n - 1), "写しが新しくなったら数え直す（控えのまま {before:?} を返さない）");
    let _ = std::fs::remove_dir_all(&work);
    bk.finish(&bad);
    assert!(bad.is_empty(), "{} / {total} 通りが食い違いました:\n{}", bad.len(), bad.join("\n"));
}
