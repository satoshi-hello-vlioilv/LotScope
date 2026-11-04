//! アクセス権限（版 3.65.0）: 窓（src/access.rs）が Python の道（routes/common.me・routes/access._access_guard）と同じ me・同じ門番の答えを出すか。
//! program/tests/access_oracle.py が組ごとに置き場（共有・壊れた共有と写し・写しだけ・手元だけ・BOM・読めない写し）・権限の行・タブの権限・
//! 切断の指示・名乗りを置いて Python で答え、置き場のファイルを残したまま窓が同じ置き場から読んで答える。
//! Python が me を決められない組は、窓も決めず（見出しを載せない）、門番は止めない（Python も止めない）。

mod common;

use chrono::NaiveDateTime;
use da_core::access::{self, Gate, Place};
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

/// 権限を書いたら forget ですぐ読み直す・名乗りが違えば覚えた me を使わない
#[test]
fn gate_forgets_after_writes() {
    let d = common::work("access-gate");
    let share = d.join("share");
    std::fs::create_dir_all(&share).unwrap();
    let put = |role: &str| {
        let doc = json!({"rows": [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者"},
                                  {"id": 2, "ログインID": "u1", "PC名": "", "権限区分": role}]});
        std::fs::write(share.join("access_permissions.json"), doc.to_string()).unwrap();
    };
    let conf = |login: &str| {
        json!({"who": {"login": login, "pc": "PC-1", "pcSource": "試験", "key": format!("PC-1@{login}")},
               "place": {"shareDir": share, "shared": ["access_permissions", "tab_access"], "data": d.join("data"),
                         "defaults": d.join("defaults"), "cache": d.join("cache"), "presence": ""}})
    };
    let gate = Gate::default();
    put("設備作業者");
    assert!(gate.check("POST", "/api/masters/equipment", Some(&conf("u1"))).is_err(), "設備作業者は書けない");
    put("メンテナンス者");
    assert!(gate.check("POST", "/api/masters/equipment", Some(&conf("u1"))).is_err(), "覚えている間は前の答え");
    gate.forget();
    let ok = gate.check("POST", "/api/masters/equipment", Some(&conf("u1"))).unwrap().unwrap();
    assert_eq!(serde_json::from_str::<Value>(&ok).unwrap()["flags"]["role"], "メンテナンス者", "forget のあとは読み直す");
    let other = gate.check("GET", "/api/access/me", Some(&conf("boss"))).unwrap().unwrap();
    assert_eq!(serde_json::from_str::<Value>(&other).unwrap()["flags"]["role"], "開発者", "名乗りが違えば覚えた me を使わない");
    assert_eq!(gate.check("POST", "/api/masters/equipment", None), Ok(None), "名乗りが無ければ載せない");
    std::fs::remove_dir_all(&d).ok();
}
