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
pub(crate) const TAB_SHOW: &str = "出す";
pub(crate) const TAB_HIDE: &str = "出さない";
/// タブの決まりを決められる区分（開発者はいつも全部）
pub(crate) const TAB_ROLES: [&str; 3] = [ROLE_MAINTAINER, ROLE_USER, ROLE_OPERATOR];
/// データ元ではない画面（データ元のタブはデータ元のキー。Python の access.TAB_FIXED）
pub(crate) const TAB_FIXED: [(&str, &str); 2] = [("dash", "ダッシュボード"), ("calc", "転写・ピッチ計算")];

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
pub(crate) fn text(v: Option<&Value>) -> String {
    match v {
        Some(Value::Number(n)) if n.is_u64() && n.as_u64() != Some(0) => n.to_string(), // i64 を超える整数も字のまま（Python の str(int)）
        Some(x) if truthy(x) => py_str(x),
        _ => String::new(),
    }
}

/// Python 3.13（Unicode 15.1）でまだ割り当てのない字と、窓だけが大文字の対を持つ字の表（src/key_split_table.rs。
/// program/tools/key-split-table.py が Python から焼く）。この字は Python では分解も合成も大文字も無い字なので、比べ方 py_key がそのまま残す
pub use crate::key_split_table::{ASSIGNED_SPLIT, KEY_SPLIT};

/// その字が表にあるか（Python では NFKC も大文字も変えない字）
pub fn is_key_split(c: char) -> bool {
    let c = c as u32;
    KEY_SPLIT
        .binary_search_by(|(a, b)| {
            if *b < c {
                std::cmp::Ordering::Less
            } else if *a > c {
                std::cmp::Ordering::Greater
            } else {
                std::cmp::Ordering::Equal
            }
        })
        .is_ok()
}

/// Python でまだ割り当てのない字か（表の字のうち ASSIGNED_SPLIT でない字。Python では分解も合成も大文字も無い）
fn unassigned_in_python(c: char) -> bool {
    is_key_split(c) && !ASSIGNED_SPLIT.contains(&(c as u32))
}

/// 名前に表の字があるか（試験と文書のため。比べ方は py_key が Python と同じに扱うので、道を任せる判定には使わない）
pub fn key_split(s: &str) -> bool {
    s.chars().any(is_key_split)
}

/// 比べるための形（Python の identity.normalize_part: NFKC・前後の空白を除く・大文字）を、Python 3.13 と同じ答えで（版 3.79.0）。
/// 窓の std と unicode-normalization は Python より新しい Unicode の表を持つので、そのまま NFKC・大文字にすると、Python で割り当てのない字
/// （Unicode 16 から後の字）の合成・並べ替え・大文字が Python と割れる。表の字はそのまま残し、表の字で区切った間だけを NFKC にする
/// （割り当てのない字は Python では結合の段 0 の分解も合成も無い字なので、間を越えて合成も並べ替えも起きない。窓だけが大文字の対を持つ
/// 割り当て済みの字〈ASSIGNED_SPLIT〉は NFKC を通し、大文字にだけしない）。割り当て済みの字どうしの分解・合成は
/// Unicode の正規化の安定の約束で版が上がっても変わらない。tests/name_key_cases.rs が全部の字と並びの例を Python と突き合わせる
pub fn py_key(s: &str) -> String {
    pyfmt::strip(&py_nfkc_upper(s)).to_string()
}

/// NFKC・大文字（Python の unicodedata.normalize("NFKC", s).upper()。前後の空白は残す。py_key と同じ表の扱い。版 3.96.0）
pub fn py_nfkc_upper(s: &str) -> String {
    let (mut out, mut seg) = (String::new(), String::new());
    for c in s.chars() {
        if unassigned_in_python(c) {
            out.extend(seg.nfkc());
            seg.clear();
            out.push(c);
        } else {
            seg.push(c);
        }
    }
    out.extend(seg.nfkc());
    out.chars().fold(String::new(), |mut acc, c| {
        if is_key_split(c) {
            acc.push(c);
        } else {
            acc.extend(c.to_uppercase());
        }
        acc
    })
}

pub fn normalize_part(v: Option<&Value>) -> String {
    py_key(&text(v))
}

pub(crate) fn is_tab_key(t: &str) -> bool {
    let b = t.as_bytes();
    !b.is_empty() && b.len() <= 16 && b[0].is_ascii_lowercase() && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

pub fn normalize_role(v: Option<&Value>) -> &'static str {
    let s = text(v);
    let s = pyfmt::strip(&s);
    ROLES.iter().copied().find(|r| *r == s).unwrap_or(ROLE_USER)
}

pub(crate) fn role_rank(role: &str) -> u8 {
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

pub(crate) fn me_rank(lv: &str) -> u8 {
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

pub(crate) fn enabled(row: &Map<String, Value>) -> bool {
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

pub(crate) fn has_admin_row(rows: &[Map<String, Value>]) -> bool {
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
pub(crate) fn tab_rules(rows: &[Value]) -> Result<Vec<(String, Vec<&'static str>)>, String> {
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

/// アクセス権限の行の「タブの例外」→ [(タブ, 出す|出さない)]（壊れた字は空。JSON の表でない字〈並び・数・字〉も空。版 3.100.0: 前は
/// Python が落ちる形を Err にして任せた。Python も空に直した。事例は program/tests/fixtures/place_cases.json の tabExceptions）。
/// Result は呼ぶ側の形を変えないため（いまは Err を返さない）
pub fn tab_exceptions(value: Option<&Value>) -> Result<Vec<(String, bool)>, String> {
    let parsed;
    let d = match value {
        Some(Value::String(s)) if !pyfmt::strip(s).is_empty() => match py_json(s) {
            Some(v) => {
                parsed = v;
                &parsed
            }
            None => return Ok(vec![]),
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
        _ => Ok(vec![]),
    }
}

/// {タブ: 例外を持つ人の数}。効く行だけ（有効な行・開発者でない行。hidden_tabs と同じ決まり。Python の access.tab_exception_counts）
pub fn tab_exception_counts(rows: &[Map<String, Value>]) -> Map<String, Value> {
    let mut out = Map::new();
    for r in rows {
        if !enabled(r) || normalize_role(r.get("権限区分")) == ROLE_DEVELOPER {
            continue;
        }
        for (t, _) in tab_exceptions(r.get("タブの例外")).unwrap_or_default() {
            let n = out.get(&t).and_then(Value::as_i64).unwrap_or(0);
            out.insert(t, json!(n + 1));
        }
    }
    out
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

/// 区分ごとに選べるマスタ編集の段（services/access.master_edit_options: 区分の上限までの段）
fn master_edit_options(role: &str) -> Vec<&'static str> {
    let top = me_rank(master_edit_cap(role));
    MASTER_EDIT_LEVELS.iter().copied().filter(|lv| me_rank(lv) <= top).collect()
}

/// 画面の選択欄（services/access.choices: 区分・段・区分ごとの上限・タブの区分）
pub fn choices() -> Map<String, Value> {
    let by_role: Map<String, Value> = ROLES.iter().map(|r| (r.to_string(), json!(master_edit_options(r)))).collect();
    let mut m = Map::new();
    m.insert("roles".into(), json!(ROLES));
    m.insert("masterEditLevels".into(), json!(MASTER_EDIT_LEVELS));
    m.insert("masterEditByRole".into(), Value::Object(by_role));
    m.insert("tabRoles".into(), json!(TAB_ROLES));
    m
}

/// 権限の読む 2 本（版 3.76.0。routes/access.access_me・access_list）。どちらも本文を読まず、問い合わせの字も見ない
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadRoute {
    Me,
    List,
}

pub fn read_route(method: &str, path: &str) -> Option<ReadRoute> {
    match (method, path) {
        ("GET", "/api/access/me") => Some(ReadRoute::Me),
        ("GET", "/api/masters/access") => Some(ReadRoute::List),
        _ => None,
    }
}

/// 窓の me から答える（Python も窓が載せた同じ me で答えるので、作りから同じ答えになる）。version は中身（Python）の版
pub fn read_answer(route: ReadRoute, me: &Value, version: &str) -> Value {
    let mut out = Map::new();
    match route {
        ReadRoute::Me => {
            for (k, from) in [("loginId", "login"), ("pcName", "pc"), ("pcNameSource", "pcSource")] {
                out.insert(k.into(), me.get(from).cloned().unwrap_or(Value::Null));
            }
            out.insert("version".into(), json!(version));
            out.insert("revoked".into(), me.get("revoked").cloned().unwrap_or(Value::Null));
            if let Some(c) = me["caps"].as_object() {
                out.extend(c.clone());
            }
        }
        ReadRoute::List => {
            out.insert("items".into(), me.get("rows").cloned().unwrap_or(json!([])));
            out.insert("matchedId".into(), me["flags"].get("matchedId").cloned().unwrap_or(Value::Null));
            out.extend(choices());
        }
    }
    Value::Object(out)
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
    /// 共有のファイルが読めない理由（版 3.107.0。Python の MasterStore.share_problem と同じ。読みは写しで続けるので、一覧の帯で知らせる）
    pub fn share_problem(&self, name: &str) -> Option<String> {
        let share = self.share_dir.as_ref().filter(|_| self.shared.iter().any(|n| n == name))?;
        let path = share.join(format!("{name}.json"));
        let c = read_cached(&path).ok()?;
        if c.doc.is_ok() {
            return None; // 読める（i64 に入らない整数も版 3.109.0 から src/held.rs の印の字で読む。前は split_file で道が任せた）
        }
        match crate::master_store::parse_master(&c.raw, &path) {
            Ok(_) => None,
            Err(e) => Some(crate::master_store::read_reason("共有の", &path, &c.raw, &e)),
        }
    }

    /// 共有に置くマスタで、共有のフォルダはあるのにそのファイルがまだ無いか（版 3.79.0）。Python は読むだけで写しから共有に最初の版を
    /// 作る（MasterStore._maybe_refresh）。版 3.105.0 から窓の読む道も Store::seed_absent で同じく置いてから読む（置けなければ Python に任せる）
    pub fn share_absent(&self, name: &str) -> bool {
        self.share_dir
            .as_ref()
            .is_some_and(|d| self.shared.iter().any(|n| n == name) && d.is_dir() && !d.join(format!("{name}.json")).exists())
    }

    /// 共有にまだ無いマスタなら、この置き場の種をまく係（master_store::remember_seeder。窓の Lot::store_for が覚えさせる）に
    /// 最初の版を置かせる（版 3.105.0。窓の読みはみなここを通るので、Python の MasterStore.read と同じく読むときに置く）。
    /// → 共有にあるか（共有しない・届かない名前は true。係が無い・置けなければ false）
    pub fn seed(&self, name: &str) -> bool {
        if !self.share_absent(name) {
            return true;
        }
        let share = self.share_dir.as_deref().unwrap_or(std::path::Path::new(""));
        crate::master_store::seed_through(share, name).unwrap_or(false)
    }

    /// マスタの行（Python の _list と同じく、一覧が隔てる行は除く: row_check::FILTERED。版 3.107.0 の割れ 2。束・ダッシュボードの問い合わせ・
    /// 式の変換表・直の当て方が隔てた行を使わない）。自分で行を隔てて skipped を言う道は rows_all
    pub fn rows(&self, name: &str) -> Result<Vec<Value>, String> {
        let rows = self.rows_all(name)?;
        if !crate::row_check::FILTERED.contains(&name) {
            return Ok(rows);
        }
        let mut norm = rows.clone();
        crate::row_check::normalize_like_specs(name, &mut norm);
        let iso = crate::row_check::check(name, &norm, crate::row_check::fields_of(name));
        Ok(rows.into_iter().enumerate().filter(|(i, _)| !crate::row_check::is_isolated(&iso, *i)).map(|(_, r)| r).collect())
    }

    /// マスタの全部の行（隔てる前。行を隔てて skipped を言う道・書く前の確かめ）
    pub fn rows_all(&self, name: &str) -> Result<Vec<Value>, String> {
        self.doc(name).map(|(rows, _)| rows)
    }

    /// 種をまかずに読む（版 3.105.0）。Python がその道で読まないマスタを、窓が確かめのために読む所（変換表・設備グループの道は、
    /// Python が読む歩でだけ conversions_write::seed で置く）
    pub fn rows_peek(&self, name: &str) -> Result<Vec<Value>, String> {
        self.read_doc(name).map(|(rows, _)| rows)
    }

    /// 読めないマスタのファイルの理由の言葉（Python の MasterUnreadable と同じ。版 3.102.0）。読めれば None。
    /// 読む順は doc と同じ（共有が壊れていれば写しで続けるので、言うのは実際に読めなかった写し・同梱の data/・最初の中身）
    pub fn unreadable(&self, name: &str) -> Option<String> {
        let file = format!("{name}.json");
        let mut tries: Vec<(PathBuf, &str)> = vec![];
        if let Some(share) = self.share_dir.as_ref().filter(|_| self.shared.iter().any(|n| n == name)) {
            tries.push((share.join(&file), "共有の"));
            tries.push((self.cache.join(&file), "この PC の写しの"));
        }
        tries.push((self.data.join(&file), "手元の"));
        tries.push((self.defaults.join(&file), "同梱の最初の中身の"));
        let n = tries.len();
        for (i, (path, where_)) in tries.iter().enumerate() {
            let Ok(b) = std::fs::read(path) else { continue };
            let err = match crate::master_store::parse_master(&b, path) {
                Ok(v) if v.is_array() || v.get("rows").is_some_and(Value::is_array) => return None,
                Ok(_) => crate::master_store::ReadErr::Shape,
                Err(e) => e,
            };
            if i == 0 && n > 3 {
                continue; // 共有の書きかけ・壊れた物は写しで続ける
            }
            return Some(crate::master_store::read_reason(where_, path, &b, &err));
        }
        None
    }

    /// マスタの版の番号（MasterStore.revision: {revision} の int。行の配列〈同梱の data/ の昔の形〉・無いファイルは 0）
    pub fn revision(&self, name: &str) -> Result<i64, String> {
        self.doc(name).map(|(_, rev)| rev)
    }

    /// 読むファイル（共有 → 写し → 同梱の data/ → 最初の中身）の行と版の番号
    fn doc(&self, name: &str) -> Result<(Vec<Value>, i64), String> {
        self.seed(name);
        self.read_doc(name)
    }

    fn read_doc(&self, name: &str) -> Result<(Vec<Value>, i64), String> {
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
            match read_cached(path) {
                Ok(c) => match &c.doc {
                    Ok(doc) => return Ok(doc.clone()),
                    // 共有のファイルが書きかけ・壊れている: 写しで続ける（Python の _maybe_refresh も写しで続ける）
                    Err(_) if i == 0 && tries.len() > 3 => continue,
                    Err(e) => return Err(format!("{}: {e}", path.display())),
                },
                Err(_) if i < last => continue,
                Err(_) => return Ok((vec![], 0)),
            }
        }
        Ok((vec![], 0))
    }
}

/// 読んだファイルの覚え（版 3.107.0 の割れ 6: 一覧 1 回で同じファイルを rows・share_problem が別々に読み・JSON にしていた）。
/// 鍵はファイルの道、目印は (更新時刻, 大きさ)
struct Cached {
    sig: Option<(u128, u64)>,
    raw: Vec<u8>,
    doc: Result<(Vec<Value>, i64), String>,
}

static READ_MEMO: std::sync::Mutex<Option<std::collections::HashMap<PathBuf, std::sync::Arc<Cached>>>> = std::sync::Mutex::new(None);

/// ファイルを読む（同じ目印なら前の答えを使い回す。覚えるのは 32 個まで）
fn read_cached(path: &std::path::Path) -> std::io::Result<std::sync::Arc<Cached>> {
    let sig = crate::master_store::stat_sig(path);
    if sig.is_some() {
        let g = READ_MEMO.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = g.as_ref().and_then(|m| m.get(path)).filter(|c| c.sig == sig) {
            return Ok(c.clone());
        }
    }
    let raw = std::fs::read(path)?;
    let doc = doc_of(&raw);
    // 字は読めないときの理由の言葉にだけ使う（読める大きなファイルの字は覚えない）
    let raw = if doc.is_err() { raw } else { vec![] };
    let c = std::sync::Arc::new(Cached { sig, doc, raw });
    if sig.is_some() {
        let mut g = READ_MEMO.lock().unwrap_or_else(|e| e.into_inner());
        let m = g.get_or_insert_with(std::collections::HashMap::new);
        if m.len() >= 32 {
            m.clear();
        }
        m.insert(path.to_path_buf(), c.clone());
    }
    Ok(c)
}

/// {schema, revision, rows} か行の配列（同梱の data/ の昔の形）→ (行, 版の番号)。読みは Store と同じ parse_master（版 3.107.0。
/// 読めない版・対の無い代用字も読めないファイル。NaN・Infinity は src/held.rs が持つ）
fn doc_of(b: &[u8]) -> Result<(Vec<Value>, i64), String> {
    match crate::master_store::parse_master(b, std::path::Path::new("")) {
        Ok(Value::Array(a)) => Ok((a, 0)),
        Ok(Value::Object(mut o)) => {
            let rev = o.get("revision").and_then(crate::row_check::as_int).and_then(|n| n.small()).unwrap_or(0);
            match o.remove("rows") {
                Some(Value::Array(a)) => Ok((a, rev)),
                _ => Err("マスタの形が読めません".into()),
            }
        }
        Ok(_) => Err("マスタの形が読めません".into()),
        Err(e) => Err(format!("{e:?}")),
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

/// 時刻の字（Python 3.11 からの datetime.fromisoformat と同じ読み方。日付の後の 1 字はどの字でも区切り。時差の付いた時刻は
/// この PC の時刻と引き算できないので Python と同じく読まない＝None）
pub fn parse_at(s: &str) -> Option<NaiveDateTime> {
    let c: Vec<char> = s.chars().collect();
    let n = c.len();
    if n < 7 {
        return None;
    }
    // 日付の終わり（_find_isoformat_datetime_separator）
    let pos = if n == 7 {
        7
    } else if c[4] == '-' {
        if c[5] == 'W' {
            if n > 8 && c[8] == '-' {
                if n == 9 {
                    return None;
                }
                if n > 10 && c[10].is_ascii_digit() {
                    8
                } else {
                    10
                }
            } else {
                8
            }
        } else {
            10
        }
    } else if c[4] == 'W' {
        let mut i = 7;
        while i < n && c[i].is_ascii_digit() {
            i += 1;
        }
        if i < 9 {
            i
        } else if i % 2 == 0 {
            7
        } else {
            8
        }
    } else {
        8
    };
    let date = iso_date(&c[..pos.min(n)])?;
    if n <= pos {
        return date.and_hms_opt(0, 0, 0);
    }
    let t = &c[pos + 1..];
    if t.iter().any(|x| matches!(x, 'Z' | '+' | '-')) {
        return None; // 時差つき（または壊れた時差）
    }
    let (h, m, sec, us) = iso_time(t)?;
    date.and_hms_micro_opt(h, m, sec, us)
}

fn digits(c: &[char]) -> Option<u32> {
    if c.is_empty() || !c.iter().all(char::is_ascii_digit) {
        return None;
    }
    c.iter().try_fold(0u32, |a, d| a.checked_mul(10)?.checked_add(d.to_digit(10)?))
}

fn iso_date(c: &[char]) -> Option<chrono::NaiveDate> {
    use chrono::{NaiveDate, Weekday};
    let year = digits(c.get(..4)?)? as i32;
    let rest = &c[4..];
    let dash = rest.first() == Some(&'-');
    let r = if dash { &rest[1..] } else { rest };
    if r.first() == Some(&'W') {
        let week = digits(r.get(1..3)?)?;
        let day = match &r[3..] {
            [] => 1,
            [d] if !dash => digits(&[*d])?,
            ['-', d] if dash => digits(&[*d])?,
            _ => return None,
        };
        let wd = [Weekday::Mon, Weekday::Tue, Weekday::Wed, Weekday::Thu, Weekday::Fri, Weekday::Sat, Weekday::Sun]
            .get((day as usize).checked_sub(1)?)?;
        return NaiveDate::from_isoywd_opt(year, week, *wd);
    }
    let (m, d) = if dash {
        if r.len() != 5 || r[2] != '-' {
            return None;
        }
        (digits(&r[..2])?, digits(&r[3..])?)
    } else {
        if r.len() != 4 {
            return None;
        }
        (digits(&r[..2])?, digits(&r[2..])?)
    };
    NaiveDate::from_ymd_opt(year, m, d)
}

/// 時刻（_parse_hh_mm_ss_ff）: HH・HH:MM・HH:MM:SS・HHMM・HHMMSS と、どれかの後に . か , と小数（6 桁で切る・マイクロ秒）
fn iso_time(t: &[char]) -> Option<(u32, u32, u32, u32)> {
    let mut comps = [0u32; 3];
    let mut pos = 0;
    let mut has_sep = false;
    for (i, comp) in comps.iter_mut().enumerate() {
        *comp = digits(t.get(pos..pos + 2)?)?;
        pos += 2;
        let next = t.get(pos);
        if i == 0 {
            has_sep = next == Some(&':');
        }
        // 時・分・秒のどの後にも小数を付けられる（小数はマイクロ秒として読む: 09.5 は 9 時 0.5 秒）
        if next.is_none() || matches!(next, Some('.' | ',')) || i >= 2 {
            break;
        }
        if has_sep && next != Some(&':') {
            return None;
        }
        pos += has_sep as usize;
    }
    let mut us = 0;
    if pos < t.len() {
        if !matches!(t[pos], '.' | ',') {
            return None;
        }
        pos += 1;
        let f = &t[pos..];
        let take = f.len().min(6);
        us = digits(&f[..take])? * 10u32.pow((6 - take) as u32);
        if !f[take..].iter().all(char::is_ascii_digit) {
            return None;
        }
    }
    Some((comps[0], comps[1], comps[2], us))
}

/// Python の json.loads が読める字を serde_json で読む（文字列の外の NaN・Infinity・-Infinity と、f64 に入らない数を、
/// 真の数 1 に置き換える。ここで使う所〈権限の表・タブの例外・切断の指示〉では、その値は「表でも字でもない真の値」としか見ない）
pub(crate) fn py_json(text: &str) -> Option<Value> {
    if let Ok(v) = serde_json::from_str(text) {
        return Some(v);
    }
    let b: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < b.len() {
        let ch = b[i];
        if ch == '"' {
            // 文字列の中: 対の無いサロゲート（\ud800 など。Python は読む）を U+FFFD に置き換える（ここで見るのは「出す」「出さない」と
            // タブのキーの形だけで、どちらにも当たらないのは同じ）
            out.push('"');
            i += 1;
            while i < b.len() && b[i] != '"' {
                if b[i] == '\\' && b.get(i + 1) == Some(&'u') {
                    let hex = |at: usize| -> Option<u32> { u32::from_str_radix(&b.get(at..at + 4)?.iter().collect::<String>(), 16).ok() };
                    if let Some(u) = hex(i + 2) {
                        let low = (0xD800..0xDC00).contains(&u)
                            && b.get(i + 6) == Some(&'\\')
                            && b.get(i + 7) == Some(&'u')
                            && hex(i + 8).is_some_and(|l| (0xDC00..0xE000).contains(&l));
                        if low {
                            out.extend(&b[i..i + 12]);
                            i += 12;
                        } else if (0xD800..0xE000).contains(&u) {
                            out.push_str("\\ufffd");
                            i += 6;
                        } else {
                            out.extend(&b[i..i + 6]);
                            i += 6;
                        }
                        continue;
                    }
                }
                let step = if b[i] == '\\' { 2 } else { 1 };
                out.extend(&b[i..(i + step).min(b.len())]);
                i += step;
            }
            if i < b.len() {
                out.push('"');
                i += 1;
            }
            continue;
        }
        // 値の置き場（先頭か [ , : の後）に始まり、区切り（空白 , ] } か終わり）で終わる語だけを置き換える（-NaN・1NaN・NaNNaN は Python も読めない）
        let at_value = matches!(out.trim_end().chars().last(), None | Some('[' | ',' | ':'));
        let ends = |j: usize| b.get(j).is_none_or(|c| c.is_whitespace() || matches!(c, ',' | ']' | '}'));
        let rest: String = b[i..b.len().min(i + 9)].iter().collect();
        if let Some(w) = ["-Infinity", "Infinity", "NaN"].iter().find(|w| rest.starts_with(**w)) {
            let n = w.chars().count();
            if at_value && ends(i + n) {
                out.push('1');
            } else {
                out.extend(&b[i..i + n]);
            }
            i += n;
            continue;
        }
        if ch == '-' || ch.is_ascii_digit() {
            let start = i;
            i += 1;
            while i < b.len() && (b[i].is_ascii_digit() || matches!(b[i], '.' | 'e' | 'E' | '+' | '-')) {
                i += 1;
            }
            let num: String = b[start..i].iter().collect();
            match num.parse::<f64>() {
                Ok(f) if !f.is_finite() && at_value && ends(i) => out.push('1'),
                _ => out.push_str(&num),
            }
            continue;
        }
        out.push(ch);
        i += 1;
    }
    serde_json::from_str(&out).ok()
}

pub fn key_ok(key: &str) -> bool {
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
    // Python は utf-8 で読む（BOM 付きは json が読まず「切断なし」）
    let d = py_json(std::str::from_utf8(&b).ok()?)?;
    let o = d.as_object().filter(|o| !o.is_empty())?;
    if o.get("_unreadable").is_some_and(truthy) {
        return None; // Python の _read_json が「読めない」に使う印（data.get("_unreadable") を見て切断なしとする）
    }
    let at = parse_at(&o.get("at").map(py_str).unwrap_or_else(|| "None".into()))?;
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

/// この me でマスタ name を書けるか（routes/common.can_write: 切断されていない・その scope を書ける段。画面がボタンを出すかを決める）
pub fn can_write(me: &Value, name: &str) -> bool {
    !me.get("revoked").is_some_and(truthy) && master_edit_can(me["flags"]["masterEdit"].as_str().unwrap_or(""), "write", master_scope(name))
}

/// 書き込みの門番（routes/access._access_guard）。断るなら (状態, 種類, 言葉)
pub fn guard(method: &str, path: &str, me: &Value) -> Option<(u16, &'static str, String)> {
    // 確かめの道（書かない）は POST のときだけ除く（DELETE /api/sources/check は「check」というデータ元を消す道になる）
    let check = path == "/api/settings/check"
        || path == "/api/sources/check"
        || (path.starts_with("/api/sources/") && path.ends_with("/conn/check"));
    if matches!(method, "GET" | "HEAD" | "OPTIONS") || (method == "POST" && check) {
        return None;
    }
    // 読めない行を何行目かで消す道（/api/masters/rows/<名前>/<n>。版 3.108.0）は道のマスタの名前で見る（Python の _row_master と同じ）
    let row_name = path.strip_prefix("/api/masters/rows/").map(|r| r.split('/').next().unwrap_or("")).filter(|n| !n.is_empty());
    let name = match GUARDED.iter().find(|(p, _)| path.starts_with(p)) {
        Some((_, n)) => *n,
        None => row_name?,
    };
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
pub struct Gate {
    me: Mutex<Option<(Instant, String, Value)>>,
    revoke: Mutex<Option<(Instant, String, Option<Value>)>>,
    ttl: (Duration, Duration),
}

impl Default for Gate {
    fn default() -> Gate {
        Gate::with_ttl(ME_TTL, REVOKE_TTL)
    }
}

impl Gate {
    /// 覚える長さを決めて作る（me・切断の指示。試験が境を確かめる）
    pub fn with_ttl(me: Duration, revoke: Duration) -> Gate {
        Gate { me: Mutex::default(), revoke: Mutex::default(), ttl: (me, revoke) }
    }

    /// me（権限の行・効く権限は 2 秒覚える。切断の指示は別に 5 秒覚え、毎回いまの物を重ねる＝効くまでの遅れは前と同じ最長 5 秒）
    pub fn me(&self, conf: &Value) -> Result<Value, String> {
        let sig = conf.to_string();
        let key = conf["who"]["key"].as_str().unwrap_or("").to_string();
        let revoked = self.revoked(&Place::from_json(&conf["place"]), &key);
        let hit = self.me.lock().unwrap().as_ref().filter(|(at, s, _)| at.elapsed() < self.ttl.0 && *s == sig).map(|(_, _, v)| v.clone());
        let mut v = match hit {
            Some(v) => v,
            None => {
                let v = me(conf, None)?;
                *self.me.lock().unwrap() = Some((Instant::now(), sig, v.clone()));
                v
            }
        };
        v["revoked"] = revoked.unwrap_or(Value::Null);
        Ok(v)
    }

    fn revoked(&self, place: &Place, key: &str) -> Option<Value> {
        if let Some((at, k, v)) = self.revoke.lock().unwrap().as_ref() {
            if at.elapsed() < self.ttl.1 && k == key {
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
