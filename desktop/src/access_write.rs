//! 権限のマスタを書く道（版 3.68.0。順 5 の 2 段目 b）。Python の `routes/access.py` の 4 本を窓が受ける:
//!
//! ```text
//! POST   /api/masters/access          … 権限の行を足す（201・足した行）
//! PUT    /api/masters/access/<id>     … 直す（直した行。本文 base_rev は開いたときの行の版）
//! DELETE /api/masters/access/<id>     … 消す（{status: deleted, id}。?rev= は開いたときの行の版）
//! PUT    /api/masters/tabaccess       … タブの権限を置く（{ok, revision}。本文 base_rev は開いたときのマスタの版）
//! ```
//!
//! 決まりは Python と同じ（評価関数: tests/access_write_parity.rs ← program/tests/access_write_oracle.py。同じ問い合わせの並びを
//! Python の道と窓に当て、答え・断る言葉・できたファイルを突き合わせる）:
//! - 本文の読み方（routes/access._perm_payload）・権限の門（_perm_gate: 区分の上限・区分を変えてよいか）・消してよいか（delete_check）
//! - 行の書き方（repositories/master_repository の _create・_update・_delete・tab_access_put: 版の無い行は 1・ログインID と PC名 の組は 1 行・行の版）
//! - 書く係は src/master_store.rs（錠・取り直し・置き換えの直前の確かめ）
//!
//! 門番（書いてよい段か・切断）は呼ぶ側（Lot）が先に通す。
//!
//! Python と違う所（どれも画面が送る形〈application/json・数の base_rev・字の項目〉では起きない。作った後の採点で確かめた）:
//! - 本文の Content-Type を見ない（Python は application/json でなければ {} と読む。画面はいつも application/json）
//! - 窓が読めない本文（NaN・Infinity・1e400・片割れの代用字など）は、窓は答えず Python に任せる（needs_python。{} と読んで空の行を作らない）
//! - 足す道の本文が並び・字・数のとき・rules の値が数のとき、Python は例外で 500、窓は 400（error）。言葉は型によらず同じ
//!   （直す・消す道の本文が表でないときは、Python と同じく 500 で書かない）
//! - 版の番号に窓の表に無い系統の数字（数学の太字の数字・クメールなど）があれば、窓は答えず Python に任せる
//! - u64 を超える整数の項目は小数の字になる（Python は桁のまま）。行の rev が null の壊れた表は 1 と読む（Python は 400）
//! - Python の出さないタブの覚え（_TAB_CACHE・2 秒）は窓が書いても捨てない（窓が me を載せる間は使われない）

use crate::access::{
    flags, has_admin_row, normalize_master_edit, normalize_part, normalize_role, role_can, tab_exceptions, text, MASTER_EDIT_LEVELS,
    ROLE_USER, TAB_HIDE, TAB_ROLES, TAB_SHOW,
};
use crate::master_rows::{base_rev, clean, normalize_all, py_int, same_id, stamped, Rev, Spec};
use crate::master_store::{next_id, MasterError, Store};
use crate::worksum::py_str;
use serde_json::{json, Map, Value};

const PERM: &str = "access_permissions";
const TABS: &str = "tab_access";
const PERM_FIELDS: [&str; 7] = ["ログインID", "PC名", "権限区分", "マスタ編集", "有効", "備考", "タブの例外"];
/// 権限の組（SPECS["access_permissions"]: 名前が 1 つずつの列は無い。ログインID と PC名 の組は check_row）
const PERM_SPEC: Spec = Spec { name: PERM, fields: &PERM_FIELDS, unique: None, renamed: &[] };

/// 窓が受ける道か（受けないなら None: Python が答える）
pub fn route_of(method: &str, path: &str) -> Option<Route> {
    match (method, path) {
        ("POST", "/api/masters/access") => Some(Route::Create),
        ("PUT", "/api/masters/tabaccess") => Some(Route::Tabs),
        (m @ ("PUT" | "DELETE"), p) => {
            let id = p.strip_prefix("/api/masters/access/")?;
            // Python の <int:item_id>（数字だけ）
            if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let id: i64 = id.parse().ok()?;
            Some(if m == "PUT" { Route::Update(id) } else { Route::Delete(id) })
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Route {
    Create,
    Update(i64),
    Delete(i64),
    Tabs,
}

type Answer = (u16, Value);

fn err(status: u16, kind: &str, msg: impl Into<String>) -> Answer {
    (status, json!({"error": msg.into(), "kind": kind}))
}

/// MasterError → 画面へ返す形（routes/common.master_call: 決まりで断るのは理由の種類と言葉、思いがけない失敗は 400 の error）
fn of_master(e: MasterError) -> Answer {
    match e {
        MasterError::Error(m) => err(400, "error", m),
        e => (e.status(), e.payload()),
    }
}

fn forbidden(msg: String) -> Answer {
    err(403, "forbidden", msg)
}

/// 人ごとのタブの例外を置く字（services/access.clean_tab_exceptions: タブの名前の順・json.dumps と同じ区切り）
fn clean_tab_exceptions(raw: Option<&Value>) -> Result<String, String> {
    let mut d = tab_exceptions(raw)?;
    if d.is_empty() {
        return Ok(String::new());
    }
    d.sort_by(|a, b| a.0.cmp(&b.0));
    d.dedup_by(|a, b| a.0 == b.0);
    let parts: Vec<String> = d.iter().map(|(k, hide)| format!("\"{k}\": \"{}\"", if *hide { TAB_HIDE } else { TAB_SHOW })).collect();
    Ok(format!("{{{}}}", parts.join(", ")))
}

/// 本文 → 置く行の中身（routes/access._perm_payload）
fn perm_payload(body: &Value) -> Result<Map<String, Value>, String> {
    let d = match body {
        Value::Object(o) => o.clone(),
        v if !crate::worksum::truthy(v) => Map::new(),
        _ => return Err("'list' object has no attribute 'get'".into()),
    };
    let mut out = Map::new();
    for k in ["ログインID", "PC名", "権限区分", "マスタ編集", "有効", "備考"] {
        out.insert(k.into(), json!(crate::pyfmt::strip(&text(d.get(k)))));
    }
    out.insert("タブの例外".into(), json!(clean_tab_exceptions(d.get("タブの例外"))?));
    let role = normalize_role(out.get("権限区分"));
    out.insert("権限区分".into(), json!(role));
    let lv = normalize_master_edit(out.get("マスタ編集"));
    out.insert("マスタ編集".into(), json!(lv));
    let on = if out.get("有効") == Some(&json!("無")) { "無" } else { "有" };
    out.insert("有効".into(), json!(on));
    Ok(out)
}

fn s(m: &Map<String, Value>, k: &str) -> String {
    m.get(k).map(py_str).unwrap_or_default()
}

/// その区分にその段を与えてよいか（services/access.master_edit_check）
fn master_edit_check(role: &str, level: &str) -> Result<(), String> {
    let (r, lv) = (normalize_role(Some(&json!(role))), normalize_master_edit(Some(&json!(level))));
    let cap = crate::access::master_edit_cap(r);
    let rank = |x: &str| MASTER_EDIT_LEVELS.iter().position(|y| *y == x).unwrap_or(0);
    if rank(lv) <= rank(cap) {
        return Ok(());
    }
    Err(format!(
        "権限区分「{r}」に「{lv}」は与えられません（上限は「{cap}」）。先に権限区分を上げるか、マスタ編集を上限までにしてください。"
    ))
}

/// その行（空欄＝問わない）は、その人・その PC に当たるか（services/access.covers）
fn covers(row_login: &str, row_pc: &str, login: &str, pc: &str) -> bool {
    let n = |x: &str| normalize_part(Some(&json!(x)));
    let (rl, rp) = (n(row_login), n(row_pc));
    (rl.is_empty() || rl == n(login)) && (rp.is_empty() || rp == n(pc))
}

/// 区分を old から new へ変えてよいか（services/access.role_change_check）
#[allow(clippy::too_many_arguments)]
fn role_change_check(
    rows: &[Map<String, Value>],
    actor_login: &str,
    actor_pc: &str,
    old_role: &str,
    new_role: &str,
    row_id: Option<&Value>,
    row_login: &str,
    row_pc: &str,
) -> Result<(), String> {
    let (old, new) = (normalize_role(Some(&json!(old_role))), normalize_role(Some(&json!(new_role))));
    if old == new {
        return Ok(());
    }
    let me = flags(rows, actor_login, actor_pc);
    let matched = me.get("matchedId").filter(|v| !v.is_null());
    let mine = match row_id {
        Some(id) => matched.is_some_and(|m| py_str(id) == py_str(m)),
        None => covers(row_login, row_pc, actor_login, actor_pc),
    };
    let actor = me.get("role").and_then(|v| v.as_str()).unwrap_or(ROLE_USER).to_string();
    if mine {
        return Err(format!(
            "自分の権限区分は自分では変更できません（いまの区分: {actor}）。上位の区分を持つ人に変更してもらってください。"
        ));
    }
    if !has_admin_row(rows) {
        return Ok(());
    }
    if !role_can(&actor, "role:grant", old) {
        return Err(format!(
            "この PC の権限区分（{actor}）では、{old}の登録の区分を変更できません。より上位の区分を持つ人に依頼してください。"
        ));
    }
    if !role_can(&actor, "role:grant", new) {
        return Err(format!(
            "この PC の権限区分（{actor}）では、{new}を与えられません。自分より上位（同格を含む）の区分は付与できません。"
        ));
    }
    Ok(())
}

/// その行を消してよいか（services/access.delete_check）
fn delete_check(rows: &[Map<String, Value>], actor_login: &str, actor_pc: &str, row: &Map<String, Value>) -> Result<(), String> {
    let me = flags(rows, actor_login, actor_pc);
    let matched = me.get("matchedId").filter(|v| !v.is_null());
    if matched.is_some_and(|m| py_str(row.get("id").unwrap_or(&Value::Null)) == py_str(m)) {
        return Err("自分の権限を決めている行は自分では消せません。上位の区分を持つ人に依頼してください。".into());
    }
    if !has_admin_row(rows) {
        return Ok(());
    }
    let target = normalize_role(row.get("権限区分"));
    let actor = me.get("role").and_then(|v| v.as_str()).unwrap_or(ROLE_USER).to_string();
    if !role_can(&actor, "role:grant", target) {
        return Err(format!("この PC の権限区分（{actor}）では、{target}の登録を消せません。"));
    }
    Ok(())
}

/// その行を置いてよいか（routes/access._perm_gate）
fn perm_gate(me: &Value, rows: &[Map<String, Value>], data: &Map<String, Value>, old: Option<&Map<String, Value>>) -> Result<(), String> {
    master_edit_check(&s(data, "権限区分"), &s(data, "マスタ編集"))?;
    let old_role = old.and_then(|o| o.get("権限区分")).map(py_str).unwrap_or_else(|| ROLE_USER.into());
    role_change_check(
        rows,
        me["login"].as_str().unwrap_or(""),
        me["pc"].as_str().unwrap_or(""),
        &old_role,
        &s(data, "権限区分"),
        old.and_then(|o| o.get("id")),
        &s(data, "ログインID"),
        &s(data, "PC名"),
    )
}

/// ログインID と PC名 の組は 1 行だけ（_check_row の access_permissions）
fn check_row(rows: &[Value], data: &Map<String, Value>, self_id: Option<i64>) -> Result<(), MasterError> {
    let key = (normalize_part(data.get("ログインID")), normalize_part(data.get("PC名")));
    for r in rows {
        if crate::master_rows::is_self(r, self_id) {
            continue;
        }
        if (normalize_part(r.get("ログインID")), normalize_part(r.get("PC名"))) == key {
            let show = |k: &str| {
                let v = text(data.get(k));
                if v.is_empty() {
                    "（空）".to_string()
                } else {
                    v
                }
            };
            return Err(MasterError::Duplicate(format!(
                "ログインID「{}」・PC名「{}」の組はもう登録してあります。その行を直してください。",
                show("ログインID"),
                show("PC名")
            )));
        }
    }
    Ok(())
}

/// 画面から来た {タブ: [区分]} → 置ける形（services/access.clean_tab_rules。並びは本文の順）
fn clean_tab_rules(raw: Option<&Ordered>) -> Result<Vec<(String, Vec<&'static str>)>, String> {
    let Some(raw) = raw else { return Err("タブの権限の形が違います。".into()) };
    let mut out: Vec<(String, Vec<&'static str>)> = vec![];
    for (t, roles) in &raw.0 {
        let t = crate::pyfmt::strip(t).to_string();
        if !crate::access::is_tab_key(&t) {
            return Err(format!("知らないタブです: {t}"));
        }
        // Python の [str(x) for x in (roles or [])]: 並びは要素、表は鍵、字は 1 字ずつ
        let items: Vec<String> = match roles {
            v if !crate::worksum::truthy(v) => vec![],
            Value::Array(a) => a.iter().map(py_str).collect(),
            Value::Object(o) => o.keys().cloned().collect(),
            Value::String(s) => s.chars().map(String::from).collect(),
            _ => return Err("'int' object is not iterable".into()),
        };
        let bad: Vec<&str> = items.iter().map(String::as_str).filter(|x| !TAB_ROLES.contains(x)).collect();
        if !bad.is_empty() {
            return Err(format!("「{}」のタブは決められません（開発者はいつも全部のタブを見ます）。", bad.join("・")));
        }
        let kept: Vec<&'static str> = TAB_ROLES.iter().copied().filter(|r| items.iter().any(|x| x == r)).collect();
        match out.iter_mut().find(|(k, _)| *k == t) {
            Some(slot) => slot.1 = kept,
            None => out.push((t, kept)),
        }
    }
    Ok(out)
}

/// タブの権限を 1 回の錠の中で置き換える（master_repository.tab_access_put。空の並びのタブは行を消す・書いていないタブはそのまま）
fn tab_access_put(store: &Store, rules: &[(String, Vec<&'static str>)]) -> Result<(), MasterError> {
    store.write(TABS, |rows, stamp| {
        normalize_all(rows, &Spec { name: TABS, fields: &[], unique: None, renamed: &[] }); // 版の無い行は 1（旧い列名は無い）
        for (tab, roles) in rules {
            let text_now = roles.join("・");
            // by = {r.get("タブ"): r}（同じタブの行が 2 つあれば後の行）
            let at = rows.iter().rposition(|r| r.get("タブ").map(py_str).as_deref() == Some(tab.as_str()));
            if roles.is_empty() {
                if let Some(i) = at {
                    rows.remove(i);
                }
                continue;
            }
            let i = match at {
                Some(i) => {
                    if clean(rows[i].get("出さない区分")) == text_now {
                        continue;
                    }
                    i
                }
                None => {
                    rows.push(json!({"id": next_id(rows), "rev": 0, "タブ": tab}));
                    rows.len() - 1
                }
            };
            let row = rows[i].as_object_mut().ok_or_else(|| MasterError::Error("行の形が違います".into()))?;
            row.insert("出さない区分".into(), json!(text_now));
            let rev = row.get("rev").and_then(py_int).unwrap_or(0);
            row.insert("rev".into(), json!(rev + 1));
            stamped(row, stamp);
        }
        Ok(())
    })
}

/// 鍵の並びを保って読む表（タブの権限の本文。新しく足すタブの id は本文の順に振る: Python の dict と同じ）
#[derive(Debug, Default)]
pub struct Ordered(pub Vec<(String, Value)>);

impl<'de> serde::Deserialize<'de> for Ordered {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> serde::de::Visitor<'de> for V {
            type Value = Ordered;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("an object")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(self, mut m: A) -> Result<Ordered, A::Error> {
                let mut out: Vec<(String, Value)> = vec![];
                while let Some((k, v)) = m.next_entry::<String, Value>()? {
                    match out.iter_mut().find(|(x, _)| *x == k) {
                        Some(slot) => slot.1 = v,
                        None => out.push((k, v)),
                    }
                }
                Ok(Ordered(out))
            }
        }
        d.deserialize_map(V)
    }
}

/// 本文の rules を、鍵の並びを保って読む（rules が表でなければ None。上の段に rules が 2 つあれば後の方: Python の json.loads と同じ）
fn ordered_rules(body: &[u8]) -> Option<Ordered> {
    struct Top(Option<Ordered>);
    impl<'de> serde::Deserialize<'de> for Top {
        fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
            struct V;
            impl<'de> serde::de::Visitor<'de> for V {
                type Value = Top;
                fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                    f.write_str("an object")
                }
                fn visit_map<A: serde::de::MapAccess<'de>>(self, mut m: A) -> Result<Top, A::Error> {
                    #[derive(serde::Deserialize)]
                    #[serde(untagged)]
                    enum Rules {
                        Map(Ordered),
                        Other(serde::de::IgnoredAny),
                    }
                    let mut out = None;
                    while let Some(k) = m.next_key::<String>()? {
                        if k == "rules" {
                            out = match m.next_value::<Rules>()? {
                                Rules::Map(o) => Some(o),
                                Rules::Other(_) => None,
                            };
                        } else {
                            m.next_value::<serde::de::IgnoredAny>()?;
                        }
                    }
                    Ok(Top(out))
                }
            }
            d.deserialize_map(V)
        }
    }
    serde_json::from_slice::<Top>(body).ok().and_then(|t| t.0)
}

/// 窓では読めない本文か（空でない本文を serde_json が読めない: NaN・Infinity・1e400・片割れの代用字など）。そのときは窓は答えず
/// Python に任せる（Python は読める物は読み、読めない物は {} と読む。窓が {} と読むと、だれにでも当たる行を作ってしまう）
pub fn needs_python(body: &[u8]) -> bool {
    crate::master_rows::unreadable(body)
}

/// 窓が受ける 4 本を答える。me は窓が決めた me（門番は呼ぶ側が通した）。rows は me の権限の行
/// 窓が答えない（Python に任せる）なら None: 版の番号に窓の表に無い系統の数字がある
/// tabs はタブの権限の置き場の行（タブの権限を書く道の確かめに使う）
pub fn handle(store: &Store, me: &Value, route: Route, query: &str, body: &[u8], tabs: &[Value]) -> Option<Answer> {
    // 置き場の行の id・版を窓が Python と同じに読めないなら Python に任せる（版 3.77.0。権限の行と、タブの権限を書くときはタブの権限の行）
    // 項目の値が並び・表・i64 に入らない整数の行も（Python の str() と字が違う。master_rows::rows_plain）
    let perm: Vec<Value> = rows_of(me).into_iter().map(Value::Object).collect();
    // タブの例外は JSON の字で置く項目で、読み方は access::tab_exceptions（並び・表も読む）なので見ない
    if !crate::master_rows::rows_plain(&perm, &PERM_FIELDS[..6])
        || (route == Route::Tabs && !crate::master_rows::rows_plain(tabs, &["タブ", "出さない区分"]))
    {
        return None;
    }
    // request.get_json(silent=True) or {}: 読めない・空・偽の値は {}
    let parsed: Value = serde_json::from_slice(body).ok().filter(crate::worksum::truthy).unwrap_or(json!({}));
    if matches!(route, Route::Update(_) | Route::Delete(_)) {
        // routes/common.base_rev は master_call の外で本文を読む: 表でない本文（並び・字・数）は Python では 500（行は書かない）
        if !parsed.is_object() {
            return Some(err(500, "error", "本文の形が違います"));
        }
        if base_rev(&parsed, query) == Some(Rev::Unknown) {
            return None;
        }
    }
    Some(answer(store, me, &rows_of(me), route, query, body, &parsed))
}

fn rows_of(me: &Value) -> Vec<Map<String, Value>> {
    me["rows"].as_array().map(|a| a.iter().filter_map(|r| r.as_object().cloned()).collect()).unwrap_or_default()
}

fn answer(store: &Store, me: &Value, rows: &[Map<String, Value>], route: Route, query: &str, body: &[u8], parsed: &Value) -> Answer {
    let rows = rows.to_vec();
    match route {
        Route::Create => {
            let data = match perm_payload(parsed) {
                Ok(d) => d,
                Err(e) => return err(400, "error", e),
            };
            if let Err(why) = perm_gate(me, &rows, &data, None) {
                return forbidden(why);
            }
            match crate::master_rows::create(store, &PERM_SPEC, &data, &check_row) {
                Ok(row) => (201, row),
                Err(e) => of_master(e),
            }
        }
        Route::Update(id) => {
            let base = base_rev(parsed, query);
            let data = match perm_payload(parsed) {
                Ok(d) => d,
                Err(e) => return err(400, "error", e),
            };
            let fallback = {
                let mut m = Map::new();
                m.insert("id".into(), json!(id));
                m
            };
            let old = rows.iter().find(|r| r.get("id").is_some_and(|v| same_id(&json!({"id": v}), id))).unwrap_or(&fallback);
            if let Err(why) = perm_gate(me, &rows, &data, Some(old)) {
                return forbidden(why);
            }
            match crate::master_rows::update(store, &PERM_SPEC, id, &data, base, &check_row) {
                Ok(row) => (200, row),
                Err(e) => of_master(e),
            }
        }
        Route::Delete(id) => {
            let base = base_rev(parsed, query);
            if let Some(old) = rows.iter().find(|r| r.get("id").is_some_and(|v| same_id(&json!({"id": v}), id))) {
                if let Err(why) = delete_check(&rows, me["login"].as_str().unwrap_or(""), me["pc"].as_str().unwrap_or(""), old) {
                    return forbidden(why);
                }
            }
            match crate::master_rows::delete(store, &PERM_SPEC, id, base) {
                Ok(()) => (200, json!({"status": "deleted", "id": id})),
                Err(e) => of_master(e),
            }
        }
        Route::Tabs => {
            let rules = match clean_tab_rules(ordered_rules(body).as_ref()) {
                Ok(r) => r,
                Err(e) => return err(400, "invalid", e),
            };
            if let Some(b) = parsed.get("base_rev").filter(|v| !v.is_null()) {
                if py_str(b) != store.revision(TABS).to_string() {
                    return err(409, "conflict", "開いたあとに、ほかの PC がタブの権限を変えました。読み直してから直してください。");
                }
            }
            match tab_access_put(store, &rules) {
                Ok(()) => (200, json!({"ok": true, "revision": store.revision(TABS)})),
                Err(e) => of_master(e),
            }
        }
    }
}
