//! 保存の行の部品（版 3.79.0）。Python の services/pivot_presets.py の行の決まり（範囲・見せる行・書ける人・標準の決め方・画面の形・
//! 画面から来た値の確かめ）と、routes/presets._gate（書いてよいかの言葉）、repositories/master_repository._preset_write（作る・直す。
//! ★標準にしたら同じ組のほかの★を外す・同じ組の名前は 1 つ）を窓の 1 か所に持つ。
//!
//! 使う組: ダッシュボードのセット（src/dash_sets.rs。版 3.79.0）。組み方のプリセット・カードの設計・ダッシュボードも
//! 同じ行の形（マスタ dashboards・pivot_presets の FIELDS）なので、移すときはこの部品に中身の確かめだけを足す。
//!
//! 窓が Python と同じに書けない値は呼ぶ側が先に Python に任せる（plain_input・rows_plain）: 本文の項目が並び・表（Python は str() の
//! ['x'] の形か TypeError）・小数（いちばん短い字が 2 つ並ぶ丁度まん中の値で窓の float_repr が Python の repr と逆に丸める）・
//! i64 に入らない整数（Python は桁のまま）。

use crate::master_rows::{self, Rev, Spec};
use crate::master_store::{next_id, MasterError, Store};
use crate::worksum::{py_str, truthy};
use serde_json::{json, Map, Value};

/// 置く項目（pivot_presets.FIELDS）
pub const FIELDS: [&str; 7] = ["名前", "元", "範囲", "ログインID", "標準", "中身", "備考"];
/// 画面の言葉 → マスタの値（pivot_presets.SCOPES。並びは標準を決める順の逆）
pub const SCOPES: [(&str, &str); 3] = [("default", "共通デフォルト"), ("all", "共通"), ("me", "ID")];
pub const NAME_MAX: usize = 40;
const NOTE_MAX: usize = 200;
const DEVELOPER: &str = "開発者";

pub(crate) const DASHBOARDS: Spec = Spec { name: "dashboards", fields: &FIELDS, unique: None, renamed: &[] };

pub type Answer = (u16, Value);

fn scope_value(key: &str) -> &'static str {
    SCOPES.iter().find(|(k, _)| *k == key).map(|(_, v)| *v).unwrap_or("")
}

fn s<'a>(row: &'a Map<String, Value>, k: &str) -> Option<&'a str> {
    row.get(k).and_then(Value::as_str)
}

/// 範囲の画面の言葉（scope_of: 知らない値は me）
pub fn scope_of(row: &Map<String, Value>) -> &'static str {
    SCOPES.iter().find(|(_, v)| row.get("範囲").is_some_and(|x| x == v)).map(|(k, _)| *k).unwrap_or("me")
}

/// 名前・標準を 1 つに決める組（元・範囲・持ち主。Python の値をそのまま比べる: 無いと空の字は別）
fn group_of(row: &Map<String, Value>) -> (Option<Value>, Option<Value>, Option<Value>) {
    let owner =
        if row.get("範囲").is_some_and(|x| x == scope_value("me")) { row.get("ログインID").cloned() } else { Some(json!("")) };
    (row.get("元").cloned(), row.get("範囲").cloned(), owner)
}

/// この ID に見せる行か（共通デフォルト・共通は全員・ID の分は本人だけ）
pub fn visible(row: &Map<String, Value>, login: &str) -> bool {
    let r = row.get("範囲");
    r.is_some_and(|x| x == scope_value("all") || x == scope_value("default"))
        || (!login.is_empty() && r.is_some_and(|x| x == scope_value("me")) && s(row, "ログインID") == Some(login))
}

/// 書く人（routes/presets._who: ログイン ID・共通を書けるか・共通デフォルトを書けるか〈開発者〉・切断されているか）
pub struct Who {
    pub login: String,
    pub common_ok: bool,
    pub default_ok: bool,
    pub revoked: bool,
}

impl Who {
    /// name は共通を書く権限を見るマスタ（ダッシュボード・セット・カードは dashboards）
    pub fn of(me: &Value, name: &str) -> Who {
        Who {
            login: me["login"].as_str().unwrap_or("").to_string(),
            common_ok: crate::access::can_write(me, name),
            default_ok: me["flags"]["role"].as_str() == Some(DEVELOPER),
            revoked: me.get("revoked").is_some_and(truthy),
        }
    }

    /// 書いてよいか（pivot_presets.can_edit）
    pub fn can_edit(&self, row: &Map<String, Value>) -> bool {
        match scope_of(row) {
            "default" => self.default_ok,
            "all" => self.common_ok,
            _ => !self.login.is_empty() && s(row, "ログインID") == Some(self.login.as_str()),
        }
    }

    /// 書いてよいかの門（routes/presets._gate。what は知らせの言葉）
    pub fn gate(&self, row: &Map<String, Value>, what: &str) -> Result<(), Answer> {
        let msg = if self.revoked {
            format!("この PC は一時的に切断されています。{what}を書き換えられません。")
        } else if self.can_edit(row) {
            return Ok(());
        } else {
            match scope_of(row) {
                "default" => format!("全員の既定の{what}を書き換えられるのは、開発者だけです。全員（共有）か自分だけに保存してください。"),
                "all" => format!(
                    "全員（共有）の{what}を書き換えられるのは、マスタを書ける権限（部分的編集可から）の人だけです。自分だけに保存してください。"
                ),
                _ => format!("ほかの ID の{what}は書き換えられません。"),
            }
        };
        Err((403, json!({"error": msg, "kind": "forbidden"})))
    }

    /// マスタの行 → 画面の形（pivot_presets.view。body は中身を読んだ物）
    pub fn view(&self, row: &Map<String, Value>, body: Value) -> Value {
        let get = |k: &str, d: Value| row.get(k).cloned().unwrap_or(d);
        json!({"id": get("id", Value::Null), "name": get("名前", json!("")), "source": get("元", json!("")), "scope": scope_of(row),
               "login": get("ログインID", json!("")), "standard": s(row, "標準") == Some("1"), "body": body,
               "note": get("備考", json!("")), "rev": get("rev", json!(1)), "updatedAt": get("updated_at", json!("")),
               "updatedBy": row.get("updated_by").filter(|v| truthy(v)).cloned().unwrap_or(json!({})),
               "canEdit": self.can_edit(row), "builtin": false})
    }
}

/// この ID・この元で当てる標準（ID の標準 → 共通の標準 → 共通デフォルトの標準 → 無し）
pub fn standard_for<'a>(rows: &[&'a Map<String, Value>], source: &str, login: &str) -> Option<&'a Map<String, Value>> {
    let mine: Vec<&Map<String, Value>> =
        rows.iter().copied().filter(|r| s(r, "元") == Some(source) && s(r, "標準") == Some("1") && visible(r, login)).collect();
    ["me", "all", "default"].iter().find_map(|k| mine.iter().copied().find(|r| s(r, "範囲") == Some(scope_value(k))))
}

/// 一覧の並び（SCOPE_ORDER の順 → 名前の字の順。Python の sorted と同じく安定）
pub fn sort_views(items: &mut [Value]) {
    let order = |v: &Value| match v["scope"].as_str() {
        Some("me") => 0,
        Some("all") => 1,
        _ => 2,
    };
    items.sort_by(|a, b| order(a).cmp(&order(b)).then_with(|| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))));
}

/// 字の JSON を Python と窓で読みが割れるか（master_rows::text_split。ここでも同じ名前で使う）
pub use crate::master_rows::text_split;

/// 置き場の行を窓が Python と同じに読めるか: id・版が読め（master_rows::row_readable）、置く項目は字か無い（Python の並べ替え・比べ方が
/// 字のときと同じになる）、中身の字は窓の serde が Python の json.loads と同じに読める（text_split）
pub fn rows_plain(rows: &[Value]) -> bool {
    rows.iter().all(|r| {
        r.as_object().is_some_and(|o| {
            master_rows::row_readable(o)
                && FIELDS.iter().all(|k| o.get(*k).is_none_or(Value::is_string))
                && s(o, "名前").is_none_or(|n| !crate::access::key_split(n))
                && s(o, "中身").is_none_or(|t| !text_split(t))
        })
    })
}

/// 本文の項目の値を窓が Python の str() と同じ字にできるか（字・i64 の整数・真偽・null。小数・並び・表・大きな整数は Python に任せる）
fn str_plain(v: &Value) -> bool {
    match v {
        Value::Number(n) => n.as_i64().is_some(),
        Value::Array(_) | Value::Object(_) => false,
        _ => true,
    }
}

/// 本文の行の項目（clean_row が読む物）を窓が Python と同じに扱えるか。name・note は str() の字、scope は辞書の鍵として比べる
/// （並び・表は Python では TypeError）、standard は真偽だけ（どの形でもよい）。名前に比べ方が割れる字（access::key_split）があれば任せる
pub fn plain_input(d: &Map<String, Value>) -> bool {
    ["name", "note"].iter().all(|k| d.get(*k).is_none_or(str_plain))
        && d.get("scope").is_none_or(|v| !v.is_array() && !v.is_object())
        && d.get("name").and_then(Value::as_str).is_none_or(|n| !crate::access::key_split(n))
}

/// Python の str(v or "")（真でない値は空の字）
fn str_or_empty(v: Option<&Value>) -> String {
    match v {
        Some(x) if truthy(x) => py_str(x),
        _ => String::new(),
    }
}

/// 画面から来た値 → マスタの行（pivot_presets.clean_row。source は呼ぶ側が決めた元〈セットは dashset〉。partial は直すとき〈来た物だけ〉。
/// body_text は中身を確かめて置く字にする関数）。誤りは知らせの言葉
pub fn clean_row(
    d: &Map<String, Value>,
    login: &str,
    partial: bool,
    source: &str,
    body_text: &dyn Fn(Option<&Value>) -> Result<String, String>,
) -> Result<Map<String, Value>, String> {
    let mut row = Map::new();
    if !partial || d.contains_key("name") {
        let name = crate::pyfmt::strip(&str_or_empty(d.get("name"))).to_string();
        if name.is_empty() {
            return Err("名前を入れてください。".into());
        }
        if name.chars().count() > NAME_MAX {
            return Err(format!("名前は {NAME_MAX} 字までです。"));
        }
        row.insert("名前".into(), json!(name));
    }
    if !partial {
        let scope = d.get("scope").and_then(Value::as_str).filter(|k| SCOPES.iter().any(|(s, _)| s == k));
        let Some(scope) = scope else { return Err("置き場（all か me）が違います。".into()) };
        if scope == "me" && login.is_empty() {
            return Err("ログイン ID が分からないので、ID ごとには保存できません。".into());
        }
        row.insert("元".into(), json!(source));
        row.insert("範囲".into(), json!(scope_value(scope)));
        row.insert("ログインID".into(), json!(if scope == "me" { login } else { "" }));
    }
    if !partial || d.contains_key("body") {
        row.insert("中身".into(), json!(body_text(d.get("body"))?));
    }
    if !partial || d.contains_key("standard") {
        row.insert("標準".into(), json!(if d.get("standard").is_some_and(truthy) { "1" } else { "" }));
    }
    if !partial || d.contains_key("note") {
        row.insert("備考".into(), json!(str_or_empty(d.get("note")).chars().take(NOTE_MAX).collect::<String>()));
    }
    Ok(row)
}

/// 同じ組（元・範囲・持ち主）の名前は 1 つ（master_repository._check_row の pivot_presets・dashboards。what は組の言葉）
fn check_name(rows: &[Value], data: &Map<String, Value>, self_id: Option<i64>, what: &str) -> Result<(), MasterError> {
    let g = group_of(data);
    let key = crate::access::normalize_part(data.get("名前"));
    for r in rows {
        let Some(o) = r.as_object() else { continue };
        if !master_rows::is_self(r, self_id) && group_of(o) == g && crate::access::normalize_part(o.get("名前")) == key {
            return Err(MasterError::Duplicate(format!(
                "{what}「{}」はもうあります。上書きするか、別の名前にしてください。",
                data.get("名前").map(py_str).unwrap_or_else(|| "None".into())
            )));
        }
    }
    Ok(())
}

/// 作る（item_id が None）・直す（_preset_write）。標準にしたら、同じ組のほかの標準を外す（1 回の書き込みで）。
/// what は名前が重なったときの言葉（dashboards は「ダッシュボード」・pivot_presets は「組み方」）
pub(crate) fn write(
    store: &Store,
    spec: &Spec,
    item_id: Option<i64>,
    data: &Map<String, Value>,
    base: Option<Rev>,
    what: &str,
) -> Result<Value, MasterError> {
    store.write(spec.name, |rows, stamp| {
        master_rows::normalize_all(rows, spec);
        let i = match item_id {
            None => {
                let mut row = Map::new();
                row.insert("id".into(), json!(next_id(rows)));
                for k in spec.fields {
                    row.insert((*k).into(), json!(""));
                }
                check_name(rows, data, None, what)?;
                row.insert("rev".into(), json!(0));
                rows.push(Value::Object(row));
                rows.len() - 1
            }
            Some(id) => {
                let Some(i) = rows.iter().position(|r| master_rows::same_id(r, id)) else {
                    return Err(if base.is_some() {
                        MasterError::Conflict(None)
                    } else {
                        MasterError::NotFound(format!("id={id} が見つかりません。"))
                    });
                };
                master_rows::check_rev(&rows[i], base)?;
                let mut merged = rows[i].as_object().cloned().unwrap_or_default();
                for (k, v) in data {
                    merged.insert(k.clone(), v.clone());
                }
                check_name(rows, &merged, Some(id), what)?;
                i
            }
        };
        let row = rows[i].as_object_mut().ok_or_else(|| MasterError::Error("行の形が違います".into()))?;
        for k in spec.fields {
            if data.contains_key(*k) {
                row.insert((*k).into(), json!(master_rows::clean(data.get(*k))));
            }
        }
        let rev = row.get("rev").and_then(master_rows::py_int).unwrap_or(0);
        row.insert("rev".into(), json!(rev + 1));
        master_rows::stamped(row, stamp);
        let done = row.clone();
        if s(&done, "標準") == Some("1") {
            let g = group_of(&done);
            for (j, r) in rows.iter_mut().enumerate() {
                let Some(o) = r.as_object_mut() else { continue };
                if j != i && s(o, "標準") == Some("1") && group_of(o) == g {
                    let rev = o.get("rev").and_then(master_rows::py_int).unwrap_or(1);
                    o.insert("標準".into(), json!(""));
                    o.insert("rev".into(), json!(rev + 1));
                    master_rows::stamped(o, stamp);
                }
            }
        }
        Ok(Value::Object(done))
    })
}
