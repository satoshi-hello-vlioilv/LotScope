//! 一覧の表示の初期設定の道（版 3.78.0）。Python の `routes/system.py` の 2 本を窓が受ける:
//!
//! ```text
//! GET /api/ui-defaults   … 表示の設定の範囲（keys）・初期設定（defaults）・置いた時刻と人・この PC が置けるか（canPublish＝開発者か）
//! PUT /api/ui-defaults   … 今の表示を初期設定にする（開発者だけ・切断中は置けない・{keys: {名前: 字}}。keys が空なら外す）
//! ```
//!
//! 決まりは Python と同じ（評価関数: tests/ui_defaults_parity.rs ← program/tests/ui_defaults_oracle.py）:
//! - 範囲の名前（PROFILE_KEYS）は services/ui_defaults.py の 1 か所。一覧の設定の答え（uiProfileKeys）で Python から受け取る
//! - 置くのは範囲の名前で値が字の物だけ・json.dumps の UTF-8 で 2 MB まで・行は名前の字の順（ui_defaults.replace）
//! - 本文は Content-Type によらず読み、表でなければ 400・keys が表でなければ 400（Python も版 3.78.0 から同じ）
//!
//! 窓が答えず Python に任せる形: 範囲の名前を受け取っていない（前の版の Python）・窓が読めない本文（NaN・片割れの代用字など。
//! master_rows::unreadable）・置き場の行の形が違う（行が表でない・名前や値が字でない）。

use crate::master_store::{MasterError, Store};
use crate::worksum::py_str;
use serde_json::{json, Map, Value};

pub const NAME: &str = "ui_defaults";
const MAX_BYTES: usize = 2 * 1024 * 1024;
const DEVELOPER: &str = "開発者";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Get,
    Put,
}

pub fn route_of(method: &str, path: &str) -> Option<Route> {
    match (method, path) {
        ("GET", "/api/ui-defaults") => Some(Route::Get),
        ("PUT", "/api/ui-defaults") => Some(Route::Put),
        _ => None,
    }
}

type Answer = (u16, Value);

fn error(status: u16, msg: impl Into<String>, kind: Option<&str>) -> Answer {
    let mut o = Map::new();
    o.insert("error".into(), json!(msg.into()));
    if let Some(k) = kind {
        o.insert("kind".into(), json!(k));
    }
    (status, Value::Object(o))
}

/// 範囲の名前で値が字の物だけ（ui_defaults.clean）。大きすぎれば Err（言葉は Python と同じ）
fn clean(keys: &Map<String, Value>, profile: &[String]) -> Result<Map<String, Value>, String> {
    let out: Map<String, Value> =
        keys.iter().filter(|(k, v)| v.is_string() && profile.iter().any(|p| p == *k)).map(|(k, v)| (k.clone(), v.clone())).collect();
    // json.dumps(out, ensure_ascii=False) の UTF-8 の長さ（鍵の並びは長さに効かない。区切りは既定の ", " と ": "）
    if crate::join::py_dumps(&Value::Object(out.clone())).len() > MAX_BYTES {
        return Err("表示の設定が大きすぎます。".into());
    }
    Ok(out)
}

/// 置き場の行を窓が Python と同じに読めるか（行が表・名前と値が字か無い）
fn readable(rows: &[Value]) -> bool {
    rows.iter().all(|r| r.as_object().is_some_and(|o| ["名前", "値"].iter().all(|k| o.get(*k).is_none_or(Value::is_string))))
}

/// 画面に渡す形（system.ui_profile: 範囲・初期設定・置いた時刻と人。読めなければ既定の見せ方＝空）
fn profile_view(rows: &[Value], profile: &[String]) -> Value {
    let mut keys = Map::new();
    for r in rows.iter().filter_map(Value::as_object) {
        let name = r.get("名前").filter(|v| crate::worksum::truthy(v)).map(py_str).unwrap_or_default();
        if let Some(v) = r.get("値").filter(|v| v.is_string()) {
            keys.insert(name, v.clone());
        }
    }
    let first = rows.first().and_then(Value::as_object);
    let (defaults, at, by) = match clean(&keys, profile) {
        Ok(d) => (
            d,
            first.and_then(|o| o.get("updated_at")).cloned().unwrap_or(json!("")),
            first.and_then(|o| o.get("updated_by")).filter(|v| crate::worksum::truthy(v)).cloned().unwrap_or(json!({})),
        ),
        Err(_) => (Map::new(), json!(""), json!({})),
    };
    json!({"keys": profile, "defaults": defaults, "updatedAt": at, "updatedBy": by})
}

/// 窓が受ける 2 本を答える。me は窓が決めた me、rows は置き場の行、profile は範囲の名前。窓が答えない形は None
pub fn handle(store: &Store, me: &Value, route: Route, body: &[u8], rows: &[Value], profile: &[String]) -> Option<Answer> {
    if !readable(rows) {
        return None;
    }
    let role = me["flags"]["role"].as_str().unwrap_or("");
    if route == Route::Get {
        let mut v = profile_view(rows, profile);
        v["canPublish"] = json!(role == DEVELOPER);
        return Some((200, v));
    }
    if role != DEVELOPER {
        return Some(error(403, format!("初期設定を置けるのは開発者だけです（この PC は {role}）。"), Some("forbidden")));
    }
    if me.get("revoked").is_some_and(crate::worksum::truthy) {
        return Some(error(403, "この PC は一時的に切断されています。初期設定を置けません。", Some("revoked")));
    }
    if crate::master_rows::unreadable(body) {
        return None; // 窓が読めない本文（Python が読むか 400 にするかは Python に任せる）
    }
    let parsed: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let Some(obj) = parsed.as_object() else {
        return Some(error(400, "本文の形が違います（{keys: {名前: 字}}）。", None));
    };
    let Some(keys) = obj.get("keys").and_then(Value::as_object) else {
        return Some(error(400, "keys の形が違います（{名前: 文字}）。", None));
    };
    let keys = match clean(keys, profile) {
        Ok(k) => k,
        Err(m) => return Some(error(400, m, None)),
    };
    let written = store.write(NAME, |rows, stamp| {
        let mut names: Vec<&String> = keys.keys().collect();
        names.sort();
        *rows = names
            .into_iter()
            .map(|k| {
                let mut r = Map::new();
                r.insert("名前".into(), json!(k));
                r.insert("値".into(), keys[k].clone());
                crate::master_rows::stamped(&mut r, stamp);
                Value::Object(r)
            })
            .collect();
        Ok(Value::Array(rows.clone()))
    });
    Some(match written {
        Ok(Value::Array(now)) => {
            let mut v = profile_view(&now, profile);
            v["count"] = json!(now.len());
            (200, v)
        }
        Ok(_) => error(500, "初期設定を書けませんでした。", Some("error")),
        // Python は store.write の失敗を受け止めず、枠の 500 の頁で答える
        Err(e) => error(500, MasterError::message(&e), Some("error")),
    })
}
