//! 参照先の項目の道（版 3.89.0）。Python の `routes/settings.py` の 2 本を窓が受ける:
//!
//! ```text
//! GET /api/settings        … 項目ごとの既定・マスタで変えた値・効いている値・行の版、共有か・共有の置き場・配った設定のファイル・マスタの版
//! PUT /api/settings/<key>  … 値を置く（空なら行を消して既定へ戻す。本文 base_rev は開いたときの行の版〈行が無かったときは 0〉）
//! ```
//!
//! 決まりは Python と同じ（評価関数: tests/settings_write_parity.rs ← program/tests/settings_write_oracle.py、GET は tests/page_parity.rs）:
//! - 値の読み方は services/path_settings.parse（誤りの言葉も同じ字。項目の名前・範囲は焼いた表 bundle_tables.json の settingsItems）。
//!   置く字は Python の str(value)（整数は桁、小数は float の repr〈36.0・1e+16〉）
//! - 行の書き方は master_repository.path_setting_put（「項目」が同じ最初の行を直す・無ければ足す・値が空なら消す）を master_rows::put_by_key で
//!
//! 窓が答えず Python に任せる形（ブラウザの欄〈exe〉は版 3.98.0 から窓も lotdsp_direct::trusted_browser で確かめて答える）: 読めない本文（NaN・1e400・
//! 読みの割れる数）・表でない本文（Python は body.get で落ちる）・値が並び・表（Python の str() の書き方が要る）・版の番号に 10 進でない数の字・
//! 置き場の行の id・版・項目・値を窓が Python と同じに読めない・道に百分率符号（Python は戻してから項目を探す）・書く係の思いがけない失敗。

use crate::master_rows::{base_rev, put_by_key, Spec};
use crate::master_store::{MasterError, Store};
use crate::pyfmt;
use crate::worksum::py_str;
use serde_json::{json, Value};

pub const NAME: &str = "path_settings";
const FIELDS: [&str; 2] = ["項目", "値"];
const SPEC: Spec = Spec { name: NAME, fields: &FIELDS, unique: Some("項目"), renamed: &[] };

#[derive(Debug, Clone, PartialEq)]
pub enum Route {
    Get,
    Put(String),
}

/// 窓が受ける道か（Python の <path:key> は空でない字）。百分率符号は Python と同じく戻してから項目を探す（body::unquote。版 3.106.0。
/// 前は任せていた）。戻した字に「%」・改行が残る道と、/ で始まる項目は今どおり任せる
pub fn route_of(method: &str, path: &str) -> Option<Route> {
    match (method, path) {
        ("GET", "/api/settings") => Some(Route::Get),
        ("PUT", p) => {
            let p = crate::body::unquote(p);
            let key = p.strip_prefix("/api/settings/")?;
            (!key.is_empty() && !key.contains(['%', '\n']) && !key.starts_with('/')).then(|| Route::Put(key.to_string()))
        }
        _ => None,
    }
}

type Answer = (u16, Value);

/// 焼いた表の項目（path_settings.BY_KEY）
pub(crate) fn item_of(key: &str) -> Option<&'static Value> {
    crate::bundle::tables()["settingsItems"].as_array()?.iter().find(|it| it["key"] == key)
}

/// parse の誤り（Invalid は ValueError の言葉。Python は error(str(e), 400, "invalid")）か、窓が Python と同じに読めない値
pub(crate) enum Bad {
    Invalid(String),
    Python,
}

/// 範囲の端の字（f"{lo}"。無ければ None）
fn edge(v: &Value) -> String {
    if v.is_null() {
        "None".into()
    } else {
        py_str(v)
    }
}

/// path_settings.parse の窓の 1 つの写し（読む道〈bundle.rs の束・GET /api/settings〉と書く道で同じ）: 画面から来た値 → その項目の値
/// （int は整数・number は小数・ほかは字。None は空＝既定へ）。読む道は Invalid を「壊れた値は使わない」として None に読む
pub(crate) fn parse_value(item: &Value, raw: Option<&Value>) -> Result<Option<Value>, Bad> {
    let s = match raw {
        None | Some(Value::Null) => String::new(),
        Some(Value::Array(_) | Value::Object(_)) => return Err(Bad::Python),
        Some(x) => pyfmt::strip(&py_str(x)).to_string(),
    };
    if s.is_empty() {
        return Ok(None);
    }
    let label = item["label"].as_str().unwrap_or("");
    let kind = item["kind"].as_str().unwrap_or("");
    let fail = |m: String| Err(Bad::Invalid(m));
    match kind {
        "int" | "number" => {
            let n = match pyfmt::py_float(&s) {
                Ok(n) if n.is_finite() => n,
                _ => return fail(format!("「{label}」は数で入れてください。")),
            };
            if kind == "int" && n.fract() != 0.0 {
                return fail(format!("「{label}」は整数で入れてください。"));
            }
            let (lo, hi) = (item.get("min").cloned().unwrap_or(Value::Null), item.get("max").cloned().unwrap_or(Value::Null));
            if lo.as_f64().is_some_and(|l| n < l) || hi.as_f64().is_some_and(|h| n > h) {
                return fail(format!("「{label}」は {}〜{} で入れてください。", edge(&lo), edge(&hi)));
            }
            Ok(Some(if kind == "int" { json!(n as i64) } else { json!(n) }))
        }
        "url" if !(s.starts_with("http://") || s.starts_with("https://")) => {
            fail(format!("「{label}」は http:// か https:// で始まる URL を入れてください。"))
        }
        "url" | "text" => Ok(Some(json!(s))),
        // unquote_path: str(value or "").strip().strip('"')
        "sqlite" | "folder" => Ok(Some(json!(crate::lists::unquote_path(&s)))),
        "pattern" => {
            if s.matches('*').count() != 1 {
                return fail(format!(
                    "ファイル名の決まり「{s}」には、設備名の所に * をちょうど 1 つ書いてください（例: 実績_*.sqlite3）。"
                ));
            }
            Ok(Some(json!(s)))
        }
        "release" => {
            let parts: Vec<String> = s.split(['\n', ';']).map(crate::lists::unquote_path).filter(|x| !x.is_empty()).collect();
            Ok(Some(json!(parts.join(";"))))
        }
        // ブラウザの欄（版 3.98.0 から窓も確かめる: lotdsp_direct::trusted_browser〈Edge・Chrome の決まった形。Python と同じ〉）
        "exe" => {
            let s = crate::lists::unquote_path(&s);
            let why = if s.is_empty() { String::new() } else { crate::lotdsp_direct::trusted_browser(&s) };
            if !why.is_empty() {
                return fail(format!("「{label}」: {why}"));
            }
            Ok(Some(json!(s)))
        }
        _ => Err(Bad::Python),
    }
}

/// 置く字（Python の str(value)。整数は桁・小数は float の repr）
fn parse(item: &Value, raw: Option<&Value>) -> Result<Option<String>, Bad> {
    Ok(parse_value(item, raw)?.map(|v| py_str(&v)))
}

/// 置き場の行を窓が Python と同じに読み書きできるか（id・版は master_rows の読み方・項目と値は字か数か真偽）
fn readable(rows: &[Value]) -> bool {
    crate::master_rows::rows_plain(rows, &FIELDS)
}

/// GET /api/settings の答え（routes/settings.settings_get）
pub fn get_answer(items: Vec<Value>, store: &Store, share_dir: &str, config_file: &str) -> Value {
    json!({"items": items, "shared": store.is_shared(NAME), "share_dir": share_dir, "config_file": config_file,
           "revision": store.revision(NAME)})
}

/// 書いた後の後始末を呼ぶ側に知らせる（Python の put_setting: lot_list.* は品質の写しを当て直す・work_log.* はフォルダの覚えを捨てる。
/// update.* は窓の更新の係がすぐ確かめる〈main.rs〉）
pub fn after_of(key: &str) -> &'static str {
    ["lot_list.", "work_log.", "update."].into_iter().find(|p| key.starts_with(p)).unwrap_or("")
}

/// PUT /api/settings/<key> を答える（門番は呼ぶ側が通した）。窓が答えない形は None
pub fn put(store: &Store, key: &str, query: &str, body: &[u8], rows: &[Value]) -> Option<Answer> {
    let Some(item) = item_of(key) else {
        return Some((400, json!({"error": "知らない項目です。", "kind": "error"})));
    };
    // get_json(force=True, silent=True) or {}（読めない本文は {}。Python に任せる本文は master_rows::py_body が決める）
    let parsed = crate::master_rows::py_body(body)?;
    let value = match parse(item, parsed.get("value")) {
        Ok(v) => v,
        Err(Bad::Invalid(m)) => return Some((400, json!({"error": m, "kind": "invalid"}))),
        Err(Bad::Python) => return None,
    };
    let base = base_rev(&parsed, query);
    if !readable(rows) {
        return None;
    }
    match put_by_key(store, &SPEC, "項目", key, value.as_deref(), "値", base) {
        Ok(row) => Some((200, json!({"row": row}))),
        // 書く係の思いがけない失敗（読めない・書けない）も窓が答える（ほかの書く道と同じ形。共有を置き換えた後の写しの失敗を
        // Python に回すと、Python がもう一度書いて「ほかの PC が先に直した」と答える。作った後の採点で見つけた）
        Err(MasterError::Error(m)) => Some(crate::master_rows::error_answer(&m)),
        Err(e) => Some((e.status(), e.payload())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(key: &str) -> &'static Value {
        item_of(key).unwrap()
    }

    fn p(key: &str, raw: Value) -> Result<Option<String>, String> {
        parse(item(key), Some(&raw)).map_err(|e| match e {
            Bad::Invalid(m) => m,
            Bad::Python => "python".into(),
        })
    }

    #[test]
    fn parse_is_like_python() {
        // 数: str(int)・float の repr・全角の数字・範囲・整数でない・数でない（言葉は Python と同じ字）
        assert_eq!(p("lot_list.refresh_seconds", json!(60)).unwrap().as_deref(), Some("60"));
        assert_eq!(p("lot_list.refresh_seconds", json!("６０.0")).unwrap().as_deref(), Some("60"));
        assert_eq!(p("lot_list.stale_hours", json!(36)).unwrap().as_deref(), Some("36.0"));
        assert_eq!(p("lot_list.stale_hours", json!("1e1")).unwrap().as_deref(), Some("10.0"));
        assert_eq!(
            p("lot_list.refresh_seconds", json!("10.5")).unwrap_err(),
            "「品質の元ファイルを確かめる間隔（秒）」は整数で入れてください。"
        );
        assert_eq!(
            p("lot_list.refresh_seconds", json!(5)).unwrap_err(),
            "「品質の元ファイルを確かめる間隔（秒）」は 10〜3600 で入れてください。"
        );
        assert_eq!(
            p("lot_list.refresh_seconds", json!(true)).unwrap_err(),
            "「品質の元ファイルを確かめる間隔（秒）」は数で入れてください。"
        );
        assert_eq!(
            p("lot_list.refresh_seconds", json!("nan")).unwrap_err(),
            "「品質の元ファイルを確かめる間隔（秒）」は数で入れてください。"
        );
        // 空は既定へ・字・URL・決まり・置き場の " ・更新の置き場の候補
        assert_eq!(p("lot_list.table", json!("  ")).unwrap(), None);
        assert_eq!(p("lot_list.table", json!(" 品質 ")).unwrap().as_deref(), Some("品質"));
        assert!(p("lotdsp_import.url", json!("ftp://x")).unwrap_err().ends_with("URL を入れてください。"));
        assert!(p("work_log.pattern", json!("a*b*")).unwrap_err().starts_with("ファイル名の決まり「a*b*」"));
        assert_eq!(p("lot_list.source", json!("\"C:\\x.sqlite3\"")).unwrap().as_deref(), Some("C:\\x.sqlite3"));
        assert_eq!(p("update.source", json!("\"a\"; b\n\"c\" ;")).unwrap().as_deref(), Some("a;b;c"));
        // ブラウザの欄（版 3.98.0 から窓も確かめる）・Python に任せる: 並び
        if !cfg!(windows) {
            assert!(p("lotdsp_import.direct.browser", json!("C:\\x.exe")).unwrap_err().contains("だけを指せます"));
            assert_eq!(p("lotdsp_import.direct.browser", json!("\"/usr/bin/msedge\"")).unwrap().as_deref(), Some("/usr/bin/msedge"));
        }
        assert_eq!(p("lotdsp_import.direct.browser", json!(" ")).unwrap(), None, "空は窓が答える（既定へ）");
        assert_eq!(p("lot_list.table", json!([1])).unwrap_err(), "python");
    }

    #[test]
    fn sections_and_config_file_are_like_python() {
        // _set: 無い段は作る・表なら下りる・字・null・並びの段は落ちる
        let cfg = json!({"lot_list": {"a": 1}, "update": null, "lotdsp_import": "x", "schedule": [1]});
        assert!(crate::bundle::sections_ok(&cfg, "lot_list.table"));
        assert!(crate::bundle::sections_ok(&cfg, "work_log.folder"), "無い段は作る");
        for k in ["update.source", "lotdsp_import.url", "schedule.client_ip", "lotdsp_import.direct.browser"] {
            assert!(!crate::bundle::sections_ok(&cfg, k), "{k}");
        }
    }

    #[test]
    fn routes() {
        assert_eq!(route_of("GET", "/api/settings"), Some(Route::Get));
        assert_eq!(route_of("PUT", "/api/settings/lot_list.table"), Some(Route::Put("lot_list.table".into())));
        assert_eq!(route_of("PUT", "/api/settings/"), None);
        assert_eq!(route_of("PUT", "/api/settings/lot%5Flist.table"), Some(Route::Put("lot_list.table".into())), "百分率符号は戻して探す");
        assert_eq!(route_of("PUT", "/api/settings/a%0Ab"), None, "戻した字の改行は任せる");
        assert_eq!(route_of("POST", "/api/settings/check"), None, "確かめるは Python");
        assert_eq!(after_of("update.source"), "update.");
        assert_eq!(after_of("schedule.client_ip"), "");
    }
}
