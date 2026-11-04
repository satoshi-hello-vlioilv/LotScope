//! アクセス権限（版 3.65.0）: 窓（src/access.rs）が Python の道（routes/common.me・routes/access._access_guard）と同じ me・同じ門番の答えを出すか。
//! program/tests/access_oracle.py が組ごとに置き場（共有・壊れた共有と写し・写しだけ・手元だけ・BOM・読めない写し）・権限の行・タブの権限・
//! 切断の指示・名乗りを置いて Python で答え、置き場のファイルを残したまま窓が同じ置き場から読んで答える。
//! Python が me を決められない組は、窓も決めず（見出しを載せない）、門番は止めない（Python も止めない）。

mod common;

use chrono::NaiveDateTime;
use da_core::access::{self, Gate, Place};
use da_core::lot::Lot;
use serde_json::{json, Value};

#[test]
fn same_me_and_guard_as_python() {
    let dir = common::work("access");
    let o = common::python_json("access_oracle.py", &["--keep", dir.to_str().unwrap()]);
    let cases = o["cases"].as_array().unwrap();
    assert!(cases.len() >= 25, "組が足りません: {}", cases.len());
    let mut bad: Vec<String> = vec![];
    for c in cases {
        let name = c["name"].as_str().unwrap();
        let conf = &c["conf"];
        let now = NaiveDateTime::parse_from_str(c["now"].as_str().unwrap(), "%Y-%m-%dT%H:%M:%S%.f").unwrap();
        let place = Place::from_json(&conf["place"]);
        let revoked = access::revocation(place.presence.as_deref(), conf["who"]["key"].as_str().unwrap(), now);
        let got = access::me(conf, revoked);
        match (&c["me"], &got) {
            (Value::Null, Err(_)) => {}
            (Value::Null, Ok(_)) => bad.push(format!("{name}: Python は決められないのに窓は me を決めた")),
            (_, Err(e)) => bad.push(format!("{name}: 窓が me を決められません: {e}")),
            (want, Ok(m)) => {
                if let Some(d) = common::diff(want, m, "") {
                    bad.push(format!("{name}: me {d}"));
                }
            }
        }
        for g in c["guards"].as_array().unwrap() {
            let (method, path) = (g["method"].as_str().unwrap(), g["path"].as_str().unwrap());
            let mine = got.as_ref().ok().and_then(|m| access::guard(method, path, m));
            let mine = mine.map(|(s, kind, error)| (json!(s), json!({"error": error, "kind": kind}))).unwrap_or((Value::Null, Value::Null));
            if (&g["status"], &g["body"]) != (&mine.0, &mine.1) {
                bad.push(format!("{name}: {method} {path} 門番 Python {} {} / 窓 {} {}", g["status"], g["body"], mine.0, mine.1));
            }
        }
        // 覚える係を通しても同じ（決められない組は見出しを載せず止めない）
        let gate = Gate::default();
        let r = gate.check("POST", "/api/masters/access", Some(conf));
        if c["me"].is_null() && r != Ok(None) {
            bad.push(format!("{name}: 決められないのに見出しを載せた・断った"));
        }
    }
    std::fs::remove_dir_all(&dir).ok();
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 権限を書いたら（一覧の設定に効くマスタを書く道の後: Lot::after_python）すぐ読み直す・名乗りが違えば覚えた me を使わない・
/// 切断の指示は PC ごと（鍵の違う覚えを使わない）・百分率符号で書いた道も同じ門番
#[test]
fn lot_gate_forgets_after_writes() {
    let d = common::work("access-gate");
    let (share, pres) = (d.join("share"), d.join("presence"));
    std::fs::create_dir_all(&share).unwrap();
    std::fs::create_dir_all(&pres).unwrap();
    let put = |role: &str| {
        let doc = json!({"rows": [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者"},
                                  {"id": 2, "ログインID": "u1", "PC名": "", "権限区分": role}]});
        std::fs::write(share.join("access_permissions.json"), doc.to_string()).unwrap();
    };
    let who = std::cell::RefCell::new("u1".to_string());
    let settings = || {
        let login = who.borrow().clone();
        Ok(json!({"access": {"who": {"login": login, "pc": "PC-1", "pcSource": "試験", "key": format!("PC-1@{login}")},
                  "place": {"shareDir": share, "shared": ["access_permissions", "tab_access"], "data": d.join("data"),
                            "defaults": d.join("defaults"), "cache": d.join("cache"), "presence": pres}}}))
    };
    let lot = Lot::new(d.join("cache"));
    let role = |method: &str, path: &str| {
        lot.access_check(method, path, &settings).map(|m| serde_json::from_str::<Value>(&m.unwrap()).unwrap()["flags"]["role"].clone())
    };
    put("設備作業者");
    assert!(role("POST", "/api/masters/equipment").is_err(), "設備作業者は書けない");
    put("メンテナンス者");
    assert!(role("POST", "/api/masters/equipment").is_err(), "覚えている間は前の答え");
    lot.after_python("GET", "/api/masters/access", 200);
    lot.after_python("POST", "/api/masters/access", 403);
    assert!(role("POST", "/api/masters/equipment").is_err(), "読むだけ・断られた書き込みでは捨てない");
    lot.after_python("PUT", "/api/masters/access/2", 200);
    assert_eq!(role("POST", "/api/masters/equipment").unwrap(), "メンテナンス者", "権限を書いた後は読み直す");
    for (p, r) in [
        ("/api/masters/tabaccess", "設備作業者"),
        ("/api/masters/place/move", "一般ユーザー"),
        ("/api/settings/lot_list", "メンテナンス者"),
    ] {
        put(r);
        lot.after_python("POST", p, 200);
        assert_eq!(role("GET", "/api/access/me").unwrap(), r, "{p} を書いた後も読み直す");
    }
    // 切断の指示は PC（鍵）ごと: u1 の切断を覚えたまま boss に替えても、boss は切断されていない
    let at = chrono::Local::now().naive_local().format("%Y-%m-%dT%H:%M:%S").to_string();
    std::fs::write(pres.join("PC-1@u1.revoke.json"), json!({"by": "boss", "at": at}).to_string()).unwrap();
    // （切断の指示は Python と同じく 5 秒覚えるので、新しい窓で確かめる）
    let lot = Lot::new(d.join("cache"));
    put("メンテナンス者");
    assert_eq!(lot.access_check("POST", "/api/masters/equipment", &settings).unwrap_err().1, "revoked");
    *who.borrow_mut() = "boss".into();
    lot.invalidate(); // 名乗りは設定（この端末の名前）を書くと替わり、そのときは一覧の設定の覚えを捨てる
    let boss = lot.access_check("POST", "/api/masters/equipment", &settings).unwrap().unwrap();
    let boss: Value = serde_json::from_str(&boss).unwrap();
    assert_eq!(
        (boss["flags"]["role"].as_str(), &boss["revoked"]),
        (Some("開発者"), &Value::Null),
        "鍵の違う切断の覚えを使わない・名乗りが違えば読み直す"
    );
    *who.borrow_mut() = "u1".into();
    lot.invalidate();
    assert_eq!(lot.access_check("POST", "/api/masters/equipment", &settings).unwrap_err().1, "revoked");
    std::fs::remove_file(pres.join("PC-1@u1.revoke.json")).unwrap();
    let gate = Gate::default();
    assert_eq!(gate.check("POST", "/api/masters/equipment", None), Ok(None), "名乗りが無ければ載せない");
    std::fs::remove_dir_all(&d).ok();
}

/// 切断の時刻の書き方（Python の datetime.fromisoformat と同じに読む）・ファイルの形（BOM・壊れた字・JSON の NaN）・冷却の境
#[test]
fn revocation_reads_like_python() {
    let dir = common::work("access-revoke");
    let o = common::python_json("access_oracle.py", &["--revocations", dir.to_str().unwrap()]);
    let now = NaiveDateTime::parse_from_str(o["now"].as_str().unwrap(), "%Y-%m-%dT%H:%M:%S%.f").unwrap();
    let mut bad = vec![];
    for c in o["cases"].as_array().unwrap() {
        let got = access::revocation(Some(&dir), c["key"].as_str().unwrap(), now).unwrap_or(Value::Null);
        if got != c["want"] {
            bad.push(format!("{}: Python {} / 窓 {}", c["label"], c["want"], got));
        }
    }
    std::fs::remove_dir_all(&dir).ok();
    assert!(o["cases"].as_array().unwrap().len() >= 30);
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 覚えた me にも、いまの切断の指示を重ねる（me を覚えている間でも、切断は切断の指示の覚えの長さで効く）
#[test]
fn revocation_is_laid_over_the_remembered_me() {
    let d = common::work("access-overlay");
    let (share, pres) = (d.join("share"), d.join("presence"));
    std::fs::create_dir_all(&share).unwrap();
    std::fs::create_dir_all(&pres).unwrap();
    std::fs::write(
        share.join("access_permissions.json"),
        json!({"rows": [{"id": 1, "ログインID": "u1", "権限区分": "開発者"}]}).to_string(),
    )
    .unwrap();
    let conf = json!({"who": {"login": "u1", "pc": "PC-1", "pcSource": "", "key": "PC-1@u1"},
                      "place": {"shareDir": share, "shared": ["access_permissions"], "data": d.join("data"), "defaults": d.join("defaults"),
                                "cache": d.join("cache"), "presence": pres}});
    let gate = Gate::with_ttl(std::time::Duration::from_secs(600), std::time::Duration::ZERO);
    assert!(gate.check("POST", "/api/masters/equipment", Some(&conf)).is_ok());
    let at = chrono::Local::now().naive_local().format("%Y-%m-%dT%H:%M:%S").to_string();
    std::fs::write(pres.join("PC-1@u1.revoke.json"), json!({"by": "boss", "at": at}).to_string()).unwrap();
    assert_eq!(gate.check("POST", "/api/masters/equipment", Some(&conf)).unwrap_err().1, "revoked", "me を覚えていても切断は効く");
    std::fs::remove_file(pres.join("PC-1@u1.revoke.json")).unwrap();
    assert!(gate.check("POST", "/api/masters/equipment", Some(&conf)).is_ok(), "切断が解ければ書ける");
    std::fs::remove_dir_all(&d).ok();
}

/// 段取りの材料（lists）の出さないタブと勤務体系を直せるかは、窓の me から決める（版 3.65.1。Python が自分で作った値を上書き）。
/// 窓が me を決められないときは Python の値のまま
#[test]
fn lists_take_hidden_tabs_from_the_shell_me() {
    use da_core::lot::Settings;
    let d = common::work("access-lists");
    let share = d.join("share");
    std::fs::create_dir_all(&share).unwrap();
    std::fs::write(
        share.join("access_permissions.json"),
        json!({"rows": [{"id": 1, "ログインID": "boss", "権限区分": "開発者"},
                        {"id": 2, "ログインID": "u1", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "タブの例外": "{\"lot\": \"出さない\"}"}]})
        .to_string(),
    )
    .unwrap();
    std::fs::write(share.join("tab_access.json"), json!({"rows": [{"タブ": "work", "出さない区分": "一般ユーザー"}]}).to_string()).unwrap();
    let access = |login: &str| {
        json!({"who": {"login": login, "pc": "PC-1", "pcSource": "", "key": format!("PC-1@{login}")},
               "place": {"shareDir": share, "shared": ["access_permissions", "tab_access"], "data": d.join("data"),
                         "defaults": d.join("defaults"), "cache": d.join("cache"), "presence": ""}})
    };
    // Python が自分の me から作った値（窓の me と違う形にしておく）
    let python_lists = json!({"hidden": ["wip"], "sources": [], "work": {"canEditShifts": true, "rows": []}});
    let lot = Lot::new(d.join("cache"));
    let s = Settings::from_json(&json!({"lists": python_lists, "access": access("u1")}));
    let v = lot.lists_of(&s);
    assert_eq!(v["hidden"], json!(["lot", "work"]), "出さないタブは窓の me（区分の決まり＋人ごとの例外）");
    assert_eq!(v["work"]["canEditShifts"], false, "閲覧のみは勤務体系を直せない");
    assert_eq!(v["sources"], json!([]), "ほかの材料は Python の答えのまま");
    let boss = lot.lists_of(&Settings::from_json(&json!({"lists": python_lists, "access": access("boss")})));
    assert_eq!((boss["hidden"].clone(), boss["work"]["canEditShifts"].clone()), (json!([]), json!(true)), "開発者は全部のタブ・直せる");
    // 窓が me を決められない（材料が無い・権限の表が壊れている）: Python の値のまま
    assert_eq!(lot.lists_of(&Settings::from_json(&json!({"lists": python_lists}))), python_lists);
    // 共有が壊れていて写しも壊れている（Python も me を決められない形。共有だけが壊れていれば写し・同梱で読む）
    std::fs::write(share.join("access_permissions.json"), "{").unwrap();
    std::fs::create_dir_all(d.join("cache")).unwrap();
    std::fs::write(d.join("cache").join("access_permissions.json"), "[").unwrap();
    let broken = Lot::new(d.join("cache2"));
    assert_eq!(broken.lists_of(&Settings::from_json(&json!({"lists": python_lists, "access": access("u1")}))), python_lists);
    std::fs::remove_dir_all(&d).ok();
}
