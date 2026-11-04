//! アクセス権限の判定と書き込みの門番（版 3.65.0。順 5 の 1 段目 a。program/app/services/access.py・routes/access.py の _access_guard・
//! routes/common.py の me を移したもの。同じ決まり・同じ言葉）。
//!
//! - 窓は中身（Python）へ回す問い合わせごとに、この PC・このログインの me（名乗り・権限の行・効く権限・できること・切断）を決め、
//!   見出し X-TPA-Me に載せて渡す（router.rs の gate）。画面から来た同じ名前の見出しは必ず捨てる（画面が権限を名乗れない）
//! - 名乗り（ログイン ID・PC 名）とマスタ・利用状況の置き場は Python が決め、一覧の設定（GET /api/lotlist/settings の access）で渡す。
//!   窓は置き場から権限のマスタ（access_permissions・tab_access）と切断の指示を自分で読む
//! - 読めないとき（マスタが壊れている・置き場に届かない）は me を載せない。Python が今までどおり自分で決め、門番も自分で見る
//!   （止めない側へ倒す決まりは Python と同じ: 権限を読めないときは書き込みを止めない）
//!
//! 評価関数: tests/access_parity.rs（← program/tests/access_oracle.py。行の組・名乗り・タブ・切断・道ごとに Python と同じ答え）。

use crate::pyfmt;
use crate::worksum::{py_str, truthy};
use chrono::NaiveDateTime;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use unicode_normalization::UnicodeNormalization;

pub const ROLE_DEVELOPER: &str = "開発者";
pub const ROLE_MAINTAINER: &str = "メンテナンス者";
pub const ROLE_USER: &str = "一般ユーザー";
pub const ROLE_OPERATOR: &str = "設備作業者";
pub const ROLES: [&str; 4] = [ROLE_DEVELOPER, ROLE_MAINTAINER, ROLE_USER, ROLE_OPERATOR];

pub const ME_HIDDEN: &str = "非表示";
pub const ME_VIEW: &str = "閲覧のみ";
pub const ME_PARTIAL: &str = "部分的編集可";
pub const ME_FULL: &str = "編集可";
pub const MASTER_EDIT_LEVELS: [&str; 4] = [ME_HIDDEN, ME_VIEW, ME_PARTIAL, ME_FULL];

/// 管理のマスタ（「部分的編集可」では書けない）
pub const ADMIN_MASTERS: [&str; 5] = ["access_permissions", "path_settings", "work_log_files", "data_sources", "tab_access"];
const TAB_SHOW: &str = "出す";
const TAB_HIDE: &str = "出さない";
/// タブの決まりを決められる区分（開発者はいつも全部）
const TAB_ROLES: [&str; 3] = [ROLE_MAINTAINER, ROLE_USER, ROLE_OPERATOR];

/// 切断の指示が効く長さ（presence.REVOKE_COOLDOWN_SEC）
const REVOKE_COOLDOWN_SEC: f64 = 300.0;
const REVOKE_SUFFIX: &str = ".revoke.json";
/// 切断の指示を覚える長さ（routes/common.me と同じ 5 秒。読めなければ切断されていないものとして続ける）
const REVOKE_TTL: Duration = Duration::from_secs(5);
/// me を覚える長さ（ダッシュボードは 1 回に何十も問い合わせる。権限・タブの権限を書いたら forget ですぐ読み直す）
const ME_TTL: Duration = Duration::from_secs(2);

/// 門番が見る道（接頭辞 → マスタの名前。routes/access._GUARDED と同じ並び）
const GUARDED: [(&str, &str); 11] = [
    ("/api/masters/equipment", "equipment_master"),
    ("/api/masters/rolls", "roll_master"),
    ("/api/masters/access", "access_permissions"),
    ("/api/settings/", "path_settings"),
    ("/api/masters/worklog", "work_log_files"),
    ("/api/masters/formats", "display_formats"),
    ("/api/masters/shifts", "shift_patterns"),
    ("/api/masters/equipgroups", "equipment_groups"),
    ("/api/masters/conversions", "conversions"),
    ("/api/sources", "data_sources"),
    ("/api/masters/tabaccess", "tab_access"),
];

/// 見出しの名前（routes/common.ME_HEADER）
pub const ME_HEADER: &str = "X-TPA-Me";

// ---------------------------------------------------------------- 字の比べ方（Python と同じ）

/// Python の str(v or "")
fn text(v: Option<&Value>) -> String {
    match v {
        Some(x) if truthy(x) => py_str(x),
        _ => String::new(),
    }
}

/// 比べるための形（identity.normalize_part: NFKC・前後の空白を除く・大文字）
pub fn normalize_part(v: Option<&Value>) -> String {
    let n: String = text(v).nfkc().collect();
    pyfmt::strip(&n).to_uppercase()
}

fn is_tab_key(t: &str) -> bool {
    let b = t.as_bytes();
    !b.is_empty() && b.len() <= 16 && b[0].is_ascii_lowercase() && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

pub fn normalize_role(v: Option<&Value>) -> &'static str {
    let s = text(v);
    let s = pyfmt::strip(&s);
    ROLES.iter().copied().find(|r| *r == s).unwrap_or(ROLE_USER)
}

fn role_rank(role: &str) -> u8 {
    match role {
        ROLE_DEVELOPER => 3,
        ROLE_MAINTAINER => 2,
        ROLE_USER => 1,
        _ => 0,
    }
}

pub fn normalize_master_edit(v: Option<&Value>) -> &'static str {
    let s = text(v);
    let s = pyfmt::strip(&s);
    MASTER_EDIT_LEVELS.iter().copied().find(|r| *r == s).unwrap_or(ME_FULL)
}

fn me_rank(lv: &str) -> u8 {
    MASTER_EDIT_LEVELS.iter().position(|x| *x == lv).unwrap_or(0) as u8
}

pub fn master_edit_cap(role: &str) -> &'static str {
    if role == ROLE_OPERATOR {
        ME_HIDDEN
    } else {
        ME_FULL
    }
}

fn master_edit_effective(role: &str, stored: &'static str) -> &'static str {
    let cap = master_edit_cap(role);
    if me_rank(stored) <= me_rank(cap) {
        stored
    } else {
        cap
    }
}

pub fn master_scope(name: &str) -> &'static str {
    if ADMIN_MASTERS.contains(&name) {
        "admin"
    } else {
        "field"
    }
}

/// open … マスタ管理を開く / write … その scope のマスタへ書く
pub fn master_edit_can(level: &str, action: &str, scope: &str) -> bool {
    let lv = normalize_master_edit(Some(&Value::from(level)));
    match action {
        "open" => lv != ME_HIDDEN,
        "write" => lv == ME_FULL || (lv == ME_PARTIAL && scope != "admin"),
        _ => false,
    }
}

pub fn role_can(role: &str, action: &str, target_role: &str) -> bool {
    match action {
        "presence:view" => role != ROLE_OPERATOR,
        "presence:disconnect" => role == ROLE_DEVELOPER || (role == ROLE_MAINTAINER && target_role != ROLE_DEVELOPER),
        "presence:forget" | "release:publish" => role == ROLE_DEVELOPER || role == ROLE_MAINTAINER,
        "role:grant" => role == ROLE_DEVELOPER || role_rank(role) > role_rank(target_role),
        _ => false,
    }
}

fn enabled(row: &Map<String, Value>) -> bool {
    pyfmt::strip(&text(row.get("有効"))) != "無"
}

/// その人・その PC に当たる行（ログインIDとPC名の両方 > ログインIDだけ > PC名だけ > 両方空。同じ段なら後の行）
fn row_for<'a>(rows: &'a [Map<String, Value>], login: &str, pc: &str) -> Option<&'a Map<String, Value>> {
    let (tl, tp) = (normalize_part(Some(&Value::from(login))), normalize_part(Some(&Value::from(pc))));
    let mut best: [Option<&Map<String, Value>>; 4] = [None; 4];
    for r in rows.iter().filter(|r| enabled(r)) {
        let (rl, rp) = (normalize_part(r.get("ログインID")), normalize_part(r.get("PC名")));
        let slot = match (rl.is_empty(), rp.is_empty()) {
            (false, false) => (rl == tl && rp == tp).then_some(0),
            (false, true) => (rl == tl).then_some(1),
            (true, false) => (rp == tp).then_some(2),
            (true, true) => Some(3),
        };
        if let Some(i) = slot {
            best[i] = Some(r);
        }
    }
    best.into_iter().flatten().next()
}

fn has_admin_row(rows: &[Map<String, Value>]) -> bool {
    rows.iter().any(|r| enabled(r) && role_rank(normalize_role(r.get("権限区分"))) > role_rank(ROLE_USER))
}

/// その人・その PC に効く権限 {role, masterEdit, masterEditStored, matchedId}（services/access.flags）
pub fn flags(rows: &[Map<String, Value>], login: &str, pc: &str) -> Map<String, Value> {
    let r = row_for(rows, login, pc);
    let role = normalize_role(r.and_then(|r| r.get("権限区分")));
    // 登録の無い人は「部分的編集可」。管理する人がまだ 1 人も居ないうちは「編集可」（最初の 1 人が権限の表を作れるように）
    let stored = match r {
        Some(r) => normalize_master_edit(r.get("マスタ編集")),
        None if has_admin_row(rows) => ME_PARTIAL,
        None => ME_FULL,
    };
    let mut f = Map::new();
    f.insert("role".into(), role.into());
    f.insert("masterEdit".into(), master_edit_effective(role, stored).into());
    f.insert("masterEditStored".into(), stored.into());
    f.insert("matchedId".into(), r.and_then(|r| r.get("id")).cloned().unwrap_or(Value::Null));
    f
}

/// マスタ tab_access の行 → [(タブ, 出さない区分)]（知らない区分は数えない。後の行が勝つ）
fn tab_rules(rows: &[Value]) -> Result<Vec<(String, Vec<&'static str>)>, String> {
    let mut out: Vec<(String, Vec<&'static str>)> = vec![];
    for r in rows {
        let r = r.as_object().ok_or("タブの権限の行の形が違います")?;
        let t = text(r.get("タブ"));
        let t = pyfmt::strip(&t).to_string();
        let raw = text(r.get("出さない区分"));
        let roles: Vec<&'static str> = TAB_ROLES
            .iter()
            .copied()
            .filter(|x| raw.split(|c: char| matches!(c, '・' | ',' | '、') || pyfmt::is_space(c)).any(|p| p == *x))
            .collect();
        if is_tab_key(&t) && !roles.is_empty() {
            match out.iter_mut().find(|(k, _)| *k == t) {
                Some(e) => e.1 = roles,
                None => out.push((t, roles)),
            }
        }
    }
    Ok(out)
}

/// アクセス権限の行の「タブの例外」→ [(タブ, 出す|出さない)]（壊れた字は空。字が JSON の物でも表でもないと Python は落ちる: Err）
fn tab_exceptions(value: Option<&Value>) -> Result<Vec<(String, bool)>, String> {
    let parsed;
    let d = match value {
        Some(Value::String(s)) if !pyfmt::strip(s).is_empty() => match serde_json::from_str::<Value>(s) {
            Ok(v) => {
                parsed = v;
                &parsed
            }
            Err(_) => return Ok(vec![]),
        },
        Some(v @ Value::Object(_)) => v,
        _ => return Ok(vec![]),
    };
    match d {
        Value::Object(o) => Ok(o
            .iter()
            .filter(|(k, _)| is_tab_key(k))
            .filter_map(|(k, v)| match v.as_str() {
                Some(TAB_SHOW) => Some((k.clone(), false)),
                Some(TAB_HIDE) => Some((k.clone(), true)),
                _ => None,
            })
            .collect()),
        v if !truthy(v) => Ok(vec![]),
        _ => Err("タブの例外の形が違います".into()),
    }
}

/// その人に出さないタブ（開発者はいつも空。区分の決まりに人ごとの例外を重ねる）
pub fn hidden_tabs(rule_rows: &[Value], perm_row: Option<&Map<String, Value>>, role: &str) -> Result<Vec<String>, String> {
    if role == ROLE_DEVELOPER {
        return Ok(vec![]);
    }
    let mut hidden: Vec<String> = tab_rules(rule_rows)?.into_iter().filter(|(_, roles)| roles.contains(&role)).map(|(t, _)| t).collect();
    for (t, hide) in tab_exceptions(perm_row.and_then(|r| r.get("タブの例外")))? {
        hidden.retain(|x| *x != t);
        if hide {
            hidden.push(t);
        }
    }
    hidden.sort();
    Ok(hidden)
}

/// 画面へ渡す「できること」（services/access.capabilities）
pub fn capabilities(f: &Map<String, Value>) -> Value {
    let role = f["role"].as_str().unwrap_or(ROLE_USER);
    let lv = f["masterEdit"].as_str().unwrap_or(ME_HIDDEN);
    json!({"role": role, "masterEdit": lv, "masterEditStored": f["masterEditStored"], "masterEditCap": master_edit_cap(role),
           "canOpenMaster": master_edit_can(lv, "open", "field"),
           "canEditFieldMaster": master_edit_can(lv, "write", "field"),
           "canEditAdminMaster": master_edit_can(lv, "write", "admin"),
           "adminMasters": ADMIN_MASTERS,
           "canViewPresence": role_can(role, "presence:view", ""),
           "canDisconnect": role_can(role, "presence:disconnect", ""),
           "canDisconnectDeveloper": role_can(role, "presence:disconnect", ROLE_DEVELOPER),
           "canForget": role_can(role, "presence:forget", ""),
           "canRelease": role_can(role, "release:publish", ""),
           "hiddenTabs": f.get("hiddenTabs").cloned().unwrap_or(json!([]))})
}

// ---------------------------------------------------------------- 置き場から読む

/// マスタ・利用状況の置き場（Python の lotlist._access_place）
#[derive(Debug, Clone, Default)]
pub struct Place {
    pub share_dir: Option<PathBuf>,
    pub shared: Vec<String>,
    pub data: PathBuf,
    pub defaults: PathBuf,
    pub cache: PathBuf,
    pub presence: Option<PathBuf>,
}

impl Place {
    pub fn from_json(v: &Value) -> Place {
        let p = |k: &str| v[k].as_str().filter(|s| !s.is_empty()).map(PathBuf::from);
        Place {
            share_dir: p("shareDir"),
            shared: v["shared"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(),
            data: p("data").unwrap_or_default(),
            defaults: p("defaults").unwrap_or_default(),
            cache: p("cache").unwrap_or_default(),
            presence: p("presence"),
        }
    }

    /// マスタの行（MasterStore.read と同じ物: 共有するマスタは共有のファイル → 写し、無ければ同梱の data/ → 最初の中身）。
    /// 共有のファイルを直に読む（Python の写しは Python が読むときに取り直すので、窓が読むときに古いことがある）
    pub fn rows(&self, name: &str) -> Result<Vec<Value>, String> {
        let file = format!("{name}.json");
        let mut tries: Vec<PathBuf> = vec![];
        if let Some(share) = self.share_dir.as_ref().filter(|_| self.shared.iter().any(|n| n == name)) {
            tries.push(share.join(&file));
            tries.push(self.cache.join(&file));
        }
        tries.push(self.data.join(&file));
        tries.push(self.defaults.join(&file));
        let last = tries.len() - 1;
        for (i, path) in tries.iter().enumerate() {
            match std::fs::read(path) {
                Ok(b) => match doc_rows(&b) {
                    Ok(rows) => return Ok(rows),
                    // 共有のファイルが書きかけ・壊れている: 写しで続ける（Python の _maybe_refresh も写しで続ける）
                    Err(_) if i == 0 && tries.len() > 3 => continue,
                    Err(e) => return Err(format!("{}: {e}", path.display())),
                },
                Err(_) if i < last => continue,
                Err(_) => return Ok(vec![]),
            }
        }
        Ok(vec![])
    }
}

/// {schema, revision, rows} か行の配列（同梱の data/ の昔の形）
fn doc_rows(b: &[u8]) -> Result<Vec<Value>, String> {
    let b = b.strip_prefix(b"\xef\xbb\xbf").unwrap_or(b);
    let v: Value = serde_json::from_slice(b).map_err(|e| e.to_string())?;
    match v {
        Value::Array(a) => Ok(a),
        Value::Object(mut o) => match o.remove("rows") {
            Some(Value::Array(a)) => Ok(a),
            _ => Err("マスタの形が読めません".into()),
        },
        _ => Err("マスタの形が読めません".into()),
    }
}

/// 権限の行（読むときに版の無い行は 1。MasterRepository._normalize）
fn perm_rows(rows: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    rows.into_iter()
        .map(|r| match r {
            Value::Object(mut o) => {
                o.entry("rev").or_insert(json!(1));
                Ok(o)
            }
            _ => Err("権限の行の形が違います".to_string()),
        })
        .collect()
}

/// 時刻の字（datetime.fromisoformat の、この PC の時刻で書いた形）
fn parse_at(s: &str) -> Option<NaiveDateTime> {
    ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M"]
        .iter()
        .find_map(|f| NaiveDateTime::parse_from_str(s, f).ok())
        .or_else(|| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok().and_then(|d| d.and_hms_opt(0, 0, 0)))
}

fn key_ok(key: &str) -> bool {
    let bad = |c: char| matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || pyfmt::is_space(c);
    let n = key.chars().count();
    (1..=120).contains(&n) && !key.chars().any(bad) && !key.starts_with('.') && !key.contains("..")
}

/// その PC に効いている切断の指示（無ければ None。冷却が切れたら効かない。presence.revocation）
pub fn revocation(presence: Option<&Path>, key: &str, now: NaiveDateTime) -> Option<Value> {
    let dir = presence?;
    if !key_ok(key) {
        return None;
    }
    let b = std::fs::read(dir.join(format!("{key}{REVOKE_SUFFIX}"))).ok()?;
    let d: Value = serde_json::from_slice(b.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&b)).ok()?;
    let o = d.as_object().filter(|o| !o.is_empty())?;
    let at = parse_at(o.get("at")?.as_str()?)?;
    let age = (now - at).num_microseconds()? as f64 / 1e6;
    if age > REVOKE_COOLDOWN_SEC {
        return None;
    }
    let get = |k: &str| o.get(k).cloned().unwrap_or(json!(""));
    Some(json!({"by": get("by"), "byPc": get("byPc"), "reason": get("reason"), "at": get("at"),
                "remainingSec": ((REVOKE_COOLDOWN_SEC - age).max(0.0)).trunc() as i64}))
}

/// me を決める（routes/common.me）。conf は一覧の設定の access {who, place}。revoked は切断の指示（呼ぶ側が覚える）
pub fn me(conf: &Value, revoked: Option<Value>) -> Result<Value, String> {
    let who = conf.get("who").and_then(Value::as_object).ok_or("名乗りがありません")?;
    let place = Place::from_json(&conf["place"]);
    let (login, pc) = (who.get("login").and_then(Value::as_str).unwrap_or(""), who.get("pc").and_then(Value::as_str).unwrap_or(""));
    let rows = perm_rows(place.rows("access_permissions")?)?;
    let mut f = flags(&rows, login, pc);
    let row = (!f["matchedId"].is_null()).then(|| rows.iter().find(|r| r.get("id") == Some(&f["matchedId"]))).flatten();
    // タブの権限を読めないときは出す（止めない。マスタの共有に届かないときと同じ）
    let hidden = place.rows("tab_access").and_then(|t| hidden_tabs(&t, row, f["role"].as_str().unwrap_or(ROLE_USER))).unwrap_or_default();
    f.insert("hiddenTabs".into(), json!(hidden));
    let caps = capabilities(&f);
    let mut out = who.clone();
    out.insert("rows".into(), Value::Array(rows.into_iter().map(Value::Object).collect()));
    out.insert("flags".into(), Value::Object(f));
    out.insert("caps".into(), caps);
    out.insert("revoked".into(), revoked.unwrap_or(Value::Null));
    Ok(Value::Object(out))
}

/// 書き込みの門番（routes/access._access_guard）。断るなら (状態, 種類, 言葉)
pub fn guard(method: &str, path: &str, me: &Value) -> Option<(u16, &'static str, String)> {
    if matches!(method, "GET" | "HEAD" | "OPTIONS")
        || path == "/api/settings/check"
        || path == "/api/sources/check"
        || (path.starts_with("/api/sources/") && path.ends_with("/conn/check"))
    {
        return None;
    }
    let (_, name) = GUARDED.iter().find(|(p, _)| path.starts_with(p))?;
    if let Some(r) = me.get("revoked").filter(|r| truthy(r)) {
        let by = r.get("by").filter(|v| truthy(v)).map(py_str).unwrap_or_else(|| "管理する人".into());
        let left = r.get("remainingSec").and_then(Value::as_i64).unwrap_or(0).div_euclid(60) + 1;
        let why = r.get("reason").filter(|v| truthy(v)).map(|v| format!("理由: {}", py_str(v))).unwrap_or_default();
        return Some((403, "revoked", format!("この PC は {by} により一時的に切断されています（あと {left} 分）。{why}")));
    }
    let f = &me["flags"];
    let lv = f["masterEdit"].as_str().unwrap_or("");
    let scope = master_scope(name);
    if master_edit_can(lv, "write", scope) {
        return None;
    }
    let what = if scope == "admin" { "管理のマスタ（アクセス権限・タブの権限・データ元）" } else { "マスタ" };
    Some((
        403,
        "forbidden",
        format!("この PC の権限（{}・マスタ編集「{lv}」）では{what}を書き換えられません。", f["role"].as_str().unwrap_or("")),
    ))
}

// ---------------------------------------------------------------- 覚えておく係

/// me と切断の指示を短く覚える（窓の 1 つ）。権限・タブの権限・置き場を書いたら forget
#[derive(Default)]
pub struct Gate {
    me: Mutex<Option<(Instant, String, Value)>>,
    revoke: Mutex<Option<(Instant, String, Option<Value>)>>,
}

impl Gate {
    pub fn me(&self, conf: &Value) -> Result<Value, String> {
        let sig = conf.to_string();
        if let Some((at, s, v)) = self.me.lock().unwrap().as_ref() {
            if at.elapsed() < ME_TTL && *s == sig {
                return Ok(v.clone());
            }
        }
        let key = conf["who"]["key"].as_str().unwrap_or("").to_string();
        let revoked = self.revoked(&Place::from_json(&conf["place"]), &key);
        let v = me(conf, revoked)?;
        *self.me.lock().unwrap() = Some((Instant::now(), sig, v.clone()));
        Ok(v)
    }

    fn revoked(&self, place: &Place, key: &str) -> Option<Value> {
        if let Some((at, k, v)) = self.revoke.lock().unwrap().as_ref() {
            if at.elapsed() <= REVOKE_TTL && k == key {
                return v.clone();
            }
        }
        let v = revocation(place.presence.as_deref(), key, chrono::Local::now().naive_local());
        *self.revoke.lock().unwrap() = Some((Instant::now(), key.to_string(), v.clone()));
        v
    }

    pub fn forget(&self) {
        *self.me.lock().unwrap() = None;
    }

    /// 中身（Python）へ回す問い合わせの前: me を決めて門番に通す。Ok(Some(me の JSON)) は見出しに載せる・Ok(None) は載せない
    /// （名乗り・権限を読めない。Python が自分で決める）・Err は断る (状態, 種類, 言葉)
    pub fn check(&self, method: &str, path: &str, conf: Option<&Value>) -> Result<Option<String>, (u16, &'static str, String)> {
        let Some(m) = conf.filter(|c| c.is_object()).and_then(|c| self.me(c).ok()) else {
            return Ok(None);
        };
        match guard(method, path, &m) {
            Some(no) => Err(no),
            None => Ok(Some(m.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(v: Value) -> Vec<Map<String, Value>> {
        perm_rows(v.as_array().unwrap().clone()).unwrap()
    }

    #[test]
    fn row_priority_and_first_admin() {
        let r = rows(json!([
            {"id": 1, "ログインID": "", "PC名": "", "権限区分": "設備作業者"},
            {"id": 2, "ログインID": "ｓａｔｏ ", "PC名": "", "権限区分": "メンテナンス者"},
            {"id": 3, "ログインID": "SATO", "PC名": "pc-1", "権限区分": "開発者", "有効": "無"},
        ]));
        let f = flags(&r, "sato", "PC-1");
        assert_eq!((f["role"].as_str(), f["matchedId"].as_i64()), (Some("メンテナンス者"), Some(2)), "止めた行は数えない・NFKC と大文字");
        assert_eq!(flags(&r, "x", "y")["masterEdit"], "非表示", "両方空の行 → 設備作業者の上限");
        let none = flags(&[], "a", "b");
        assert_eq!(none["masterEdit"], "編集可", "管理する人が居ないうちは最初の 1 人が作れる");
        let only_user = rows(json!([{"id": 9, "ログインID": "a", "PC名": "", "権限区分": "メンテナンス者"}]));
        assert_eq!(flags(&only_user, "b", "c")["masterEdit"], "部分的編集可", "未登録の人");
    }

    #[test]
    fn tabs_and_guard() {
        let rules = json!([{"タブ": "work", "出さない区分": "一般ユーザー・設備作業者"}, {"タブ": "BAD", "出さない区分": "一般ユーザー"}]);
        let row = rows(json!([{"タブの例外": "{\"work\": \"出す\", \"dash\": \"出さない\"}"}]));
        assert_eq!(hidden_tabs(rules.as_array().unwrap(), None, ROLE_USER).unwrap(), ["work"]);
        assert_eq!(hidden_tabs(rules.as_array().unwrap(), Some(&row[0]), ROLE_USER).unwrap(), ["dash"]);
        assert!(hidden_tabs(rules.as_array().unwrap(), None, ROLE_DEVELOPER).unwrap().is_empty());
        let m = json!({"flags": {"role": "一般ユーザー", "masterEdit": "部分的編集可"}, "revoked": null});
        assert!(guard("POST", "/api/masters/equipment", &m).is_none(), "現場のマスタは書ける");
        assert_eq!(guard("PUT", "/api/masters/access/3", &m).unwrap().1, "forbidden");
        assert!(guard("GET", "/api/masters/access", &m).is_none());
        assert!(guard("POST", "/api/sources/q1/conn/check", &m).is_none());
        let cut = json!({"flags": m["flags"], "revoked": {"by": "", "remainingSec": 61, "reason": "点検"}});
        assert_eq!(
            guard("POST", "/api/masters/rolls", &cut).unwrap().2,
            "この PC は 管理する人 により一時的に切断されています（あと 2 分）。理由: 点検"
        );
    }
}
