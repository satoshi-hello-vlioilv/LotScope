//! ダッシュボードのパネルの数（版 3.62.0）: 窓（src/dashboard.rs。src/lot.rs の handle_body）が POST /api/dashboard/query に、
//! Python の道（前の版の dashboard の dashboard_query）と同じ答え・同じ失敗を返すか。前の版の答え合わせ役 dashboard が開発用サーバーと
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

/// 送った本文（{"panel": …} の字）に明細の鍵を足した本文（パネルの字は送った順のまま）
fn with_drill(c: &Value, drill: &Value) -> Vec<u8> {
    let raw = String::from_utf8(sent(c)).unwrap();
    let end = raw.rfind('}').unwrap();
    format!("{},\"drill\":{}}}", &raw[..end], drill).into_bytes()
}

/// 明細（版 3.126.0）の突き合わせ: 焼いた場面の組ごとに、答えのセル（いちばん下の段・小計・総計）を最大 16 ずつ尋ねる
fn drill_cells(lot: &Lot, cases: &[(String, Value, Value)], ask: &dyn Fn() -> Result<Value, String>, bad: &mut Vec<String>) {
    let (mut asked, mut same, mut subs, mut boards, mut sides, mut series, mut no) = (0, 0, 0, 0, 0, 0, 0);
    let mut others = 0;
    let mut check = |key: &str, c: &Value, drill: Value, want: &Value, bad: &mut Vec<String>| {
        let Some((st, v)) = lot.handle_body_with("POST", "/api/dashboard/drill", "", &with_drill(c, &drill), ask) else {
            bad.push(format!("{key}: 明細を窓が答えません"));
            return None;
        };
        if v.get("unsupported").is_some() {
            return Some(v);
        }
        if st != 200 {
            bad.push(format!("{key}: 明細が {st}（{}）", v["error"]));
            return None;
        }
        asked += 1;
        let ck = &v["check"];
        if ck["same"] == false {
            bad.push(format!("{key} {drill}: 明細から数え直した数 {} ≠ セルの数 {}", ck["again"], ck["raw"]));
        }
        if !want.is_null() && ck["cell"] != *want && !(ck["cell"].as_f64().zip(want.as_f64()).is_some_and(|(a, b)| (a - b).abs() < 1e-9)) {
            bad.push(format!("{key} {drill}: 明細のセルの数 {} ≠ パネルの答え {want}", ck["cell"]));
        }
        same += (ck["same"] == true) as usize;
        if v["total"].as_u64().unwrap_or(0) as usize != v["rows"].as_array().map(|r| r.len()).unwrap_or(0)
            && v["total"].as_u64().unwrap_or(0) <= 500
        {
            bad.push(format!(
                "{key} {drill}: 行の数 {} と返した行 {} が違う",
                v["total"],
                v["rows"].as_array().map(|r| r.len()).unwrap_or(0)
            ));
        }
        Some(v)
    };
    let pick = |cells: &[Value]| -> Vec<Value> {
        // いちばん下の段・小計・総計が混ざるよう、段の長さごとに散らして最大 16
        let mut by: std::collections::BTreeMap<usize, Vec<&Value>> = Default::default();
        for x in cells {
            let n = x["r"].as_array().map(|a| a.len()).unwrap_or(0) * 10 + x["c"].as_array().map(|a| a.len()).unwrap_or(0);
            by.entry(n).or_default().push(x);
        }
        let mut out = vec![];
        for xs in by.values() {
            let step = (xs.len() / 4).max(1);
            out.extend(xs.iter().step_by(step).take(4).map(|x| (*x).clone()));
        }
        out.truncate(16);
        out
    };
    for (name, c, want) in cases {
        if want["status"] != 200 {
            continue;
        }
        let key = format!("明細 {name}");
        let b = &want["body"];
        let vis = c["panel"]["visual"].as_str().unwrap_or("");
        if vis == "gantt" || vis == "abc" {
            if let Some(v) = check(&key, c, json!({"r": [], "c": []}), &Value::Null, bad) {
                no += v.get("unsupported").is_some() as usize;
            }
            continue;
        }
        if let Some(gs) = b.get("groups").and_then(Value::as_array) {
            for (g, a) in gs.iter().enumerate() {
                for x in pick(a["cells"].as_array().map(Vec::as_slice).unwrap_or(&[])) {
                    boards += 1;
                    check(&key, c, json!({"g": g, "r": x["r"], "c": x["c"], "m": 0}), &x["v"][0], bad);
                }
            }
            continue;
        }
        let Some(cells) = b.get("cells").and_then(Value::as_array) else { continue };
        if b.get("facets").is_some() {
            if let Some(v) = check(&key, c, json!({"r": [], "c": []}), &Value::Null, bad) {
                no += v.get("unsupported").is_some() as usize;
            }
            continue;
        }
        let link = c["panel"].get("link").is_some();
        let nm = b["measures"].as_array().map(|m| m.len()).unwrap_or(1);
        // 上位 N の「その他」（画面の withOther）: 行の葉の先頭 2 つを上位として、残りの行。件数・合計は残りの葉の数の和と同じ
        let nr = b["dims"]["rows"].as_array().map(|a| a.len()).unwrap_or(0);
        let agg = b["measures"][0]["agg"].as_str().unwrap_or("");
        let leaves: Vec<&Value> = cells
            .iter()
            .filter(|x| x["r"].as_array().is_some_and(|a| a.len() == nr) && x["c"].as_array().is_some_and(|a| a.is_empty()))
            .collect();
        if !link
            && nr == 1
            && leaves.len() >= 3
            && (agg == "count" || agg == "sum")
            && b.get("esplit").is_none()
            && b["measures"][0].get("show").is_none()
            && b["measures"][0].get("expr").is_none()
        {
            let keep: Vec<Value> = leaves[..2].iter().map(|x| x["r"].clone()).collect();
            let rest: f64 = leaves[2..].iter().filter_map(|x| x["v"][0].as_f64()).sum();
            if let Some(v) = check(&key, c, json!({"r": [], "c": [], "m": 0, "keep": keep}), &Value::Null, bad) {
                let got = v["check"]["again"].as_f64().unwrap_or(f64::NAN);
                if (got - rest).abs() > 1e-6 * rest.abs().max(1.0) {
                    bad.push(format!("{key}: その他の明細 {got} ≠ 残りの行の数の和 {rest}"));
                }
                others += 1;
            }
        }
        for x in pick(cells) {
            subs += (x["r"].as_array().map(|a| a.len()).unwrap_or(0) < b["dims"]["rows"].as_array().map(|a| a.len()).unwrap_or(0)) as usize;
            series += b.get("esplit").is_some() as usize;
            for j in 0..nm.min(3) {
                if link {
                    // 別のデータと合わせた答え: 側ごと（差・達成率の列は側の外 → 理由）。セルの数は側の数（累計にした側は除く）
                    let side = &c["panel"]["link"]["sides"][j];
                    // 読めない側（答えの link.sides に error）・積み上げにした側・値の無い所は尋ねない（読めない側は窓が理由の 404 を返す）
                    let failed = b["link"]["sides"][j].get("error").is_some();
                    if !side.is_null() && (failed || x["v"][j].is_null()) {
                        continue;
                    }
                    let want = if side.is_null() || side["build"] == "cum" || !x["c"].as_array().is_some_and(|a| a.is_empty()) {
                        Value::Null
                    } else {
                        x["v"][j].clone()
                    };
                    if let Some(v) = check(&key, c, json!({"r": x["r"], "c": [], "m": j, "side": j}), &want, bad) {
                        sides += 1;
                        no += v.get("unsupported").is_some() as usize;
                    }
                } else {
                    check(&key, c, json!({"r": x["r"], "c": x["c"], "m": j}), &x["v"][j], bad);
                }
            }
        }
    }
    assert!(
        asked >= 300 && same >= 250 && subs >= 30 && boards >= 20 && sides >= 8 && series >= 10 && no >= 3 && others >= 5,
        "明細の組が足りません: 尋ねた {asked}・同じ {same}・小計と総計 {subs}・合わせた表 {boards}・合わせる側 {sides}・設備ごとの系列 {series}・理由 {no}・その他 {others}"
    );
}

#[test]
fn dashboard_answers_like_python() {
    let work = common::work("dash");
    let mut bk = common::bake::Bake::open("dashboard", &work);
    bk.pack = true;
    bk.script = Some(("ui_scene.py", vec![work.to_string_lossy().into_owned(), "dashboard".into()]));
    bk.exclude.extend(["cache", "local", "instance_id", "roll_master.json", "roll_master.csv"]);
    bk.fid_key = Some("fids");
    let o = bk.table_oracle();
    let settings = o["settings"].clone();
    assert_eq!(settings["engine"], "rust");
    assert!(settings["lists"]["dash"]["now"].is_string(), "試験の「いま」が設定の答えに無い");
    let lot = Lot::new(work.join("db_cache"));
    let ask = || Ok(settings.clone());
    let mut bad = vec![];
    let (mut total, mut cells, mut fails, mut facets, mut boards, mut links, mut hot) = (0, 0, 0, 0, 0, 0, 0);
    let mut answered: Vec<(String, Value, Value)> = vec![];
    for (i, c) in o["cases"].as_array().unwrap().iter().enumerate() {
        total += 1;
        let key = format!("#{i} {}", c["name"].as_str().unwrap());
        let Some(want) = one(&mut bk, &lot, c, &key, &ask, &mut bad) else { continue };
        answered.push((key.clone(), c.clone(), want.clone()));
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
    // 明細（版 3.126.0。POST /api/dashboard/drill）: どの組のどのセル（小計・総計・設備で分けた系列・合わせた表のまとまり・別のデータの側）も、
    // 選んだ行で数え直した数（check.again）がセルの数（check.raw）と同じで、セルの数（check.cell）がパネルの答えのセルと同じ
    drill_cells(&lot, &answered, &ask, &mut bad);
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
    // 材料（lists.dash）を答えない中身（前の版の Python）とは、ダッシュボードを 答えない（製品では 503）
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
