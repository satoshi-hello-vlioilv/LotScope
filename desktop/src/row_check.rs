//! 置き場の読めない行を行ごとに隔てる決まり（版 3.107.0。Rust 化の段 ① の 4 歩目・案 E3＋E4）。Python の services/row_check.py と同じ。
//! 事例は tests/fixtures/row_cases.json（cargo test --test row_cases。Python は tests/test_row_cases.py）。
//!
//! 前は置き場に読めない行が 1 行あるだけで、その道を全部 Python に任せていた（Python の答えにも誤り: NaN の行で一覧が JSON でない・
//! 名前が数の行で 500・版の読めない行で PUT は「見つかりません」・DELETE は書かずに {ok: true}）。いまは:
//! - 隔てた行は一覧に出さず、答えの skipped（{row, why}）で知らせる
//! - 書く道は、隔てた行に触れる直す・消すだけを止める（guard）。足すは通す。次の id・名前の重なりは隔てた行も数え、隔てた行は書き戻す
//! - 権限の 2 つ（STRICT）は読みは今どおり、隔てる形の行があれば書く道を全部止める
//! - 読まない値（知らない鍵・ほかの元の行）は隔てない（src/held.rs が J のまま持って書き戻す）

use crate::held;
use crate::master_store::MasterError;
use serde_json::{json, Map, Value};

/// 名前の列（字か null でなければ隔てる）
pub const NAME_COLS: [(&str, &str); 16] = [
    ("equipment_master", "設備名"),
    ("roll_master", "設備"),
    ("path_settings", "項目"),
    ("access_permissions", "ログインID"),
    ("tab_access", "タブ"),
    ("work_log_files", "設備名"),
    ("display_formats", "名前"),
    ("shift_patterns", "名称"),
    ("equipment_groups", "名称"),
    ("conversions", "名前"),
    ("conversion_defaults", "名前"),
    ("pivot_presets", "名前"),
    ("pivot_quick", "ログインID"),
    ("data_sources", "キー"),
    ("dashboard_settings", "キー"),
    ("dashboards", "名前"),
];
const PRESET: &[&str] = &["名前", "元", "範囲", "ログインID", "標準", "中身", "備考"];
/// 字だけを置く列（字でなければ隔てる。null も）
pub const STR_COLS: [(&str, &[&str]); 4] = [
    ("dashboards", PRESET),
    ("pivot_presets", PRESET),
    ("display_formats", &["名前", "元", "表", "作った所", "中身", "備考"]),
    ("pivot_quick", &["ログインID", "元", "並び"]),
];
const CONV: &[&str] = &["入力", "判定", "当て方"]; // その他は式か値の字（JSON でない）
/// 中身の列（JSON の字）
pub const CONTENT_COLS: [(&str, &[&str]); 10] = [
    ("dashboards", &["中身"]),
    ("pivot_presets", &["中身"]),
    ("display_formats", &["中身"]),
    ("pivot_quick", &["並び"]),
    ("equipment_groups", &["ルール"]),
    ("conversions", CONV),
    ("conversion_defaults", CONV),
    ("shift_patterns", &["区分"]),
    ("data_sources", &["結合"]),
    ("dashboard_settings", &["条件"]),
];
/// 行を丸ごと答える（一覧が行をそのまま返す）マスタ: 知らない鍵の数でない値も答えに出るので隔てる
pub const RAW: [&str; 2] = ["equipment_master", "roll_master"];
pub const STRICT: [&str; 2] = ["access_permissions", "tab_access"];
/// マスタの置き場の状態で隔てた行を知らせるマスタ（Python の row_check.STATUS）
pub const STATUS: [&str; 13] = [
    "equipment_master",
    "roll_master",
    "shift_patterns",
    "equipment_groups",
    "conversions",
    "display_formats",
    "pivot_presets",
    "pivot_quick",
    "dashboards",
    "dashboard_settings",
    "path_settings",
    "access_permissions",
    "tab_access",
];
pub const DEEP: usize = 128;
const SHORT: usize = 30;

fn find<T: Copy>(table: &[(&str, T)], name: &str) -> Option<T> {
    table.iter().find(|(n, _)| *n == name).map(|(_, v)| *v)
}

/// 理由に添える値（Python の repr。30 字を超えれば … で切る）
pub fn short(v: &Value) -> String {
    let t = held::repr(v);
    if t.chars().count() <= SHORT {
        return t;
    }
    let mut s: String = t.chars().take(SHORT - 1).collect();
    s.push('…');
    s
}

/// int(v) が読めればその数（Python の row_check.as_int）。i64 に入らなければ Big の字
pub fn as_int(v: &Value) -> Option<crate::pyfmt::PyInt> {
    if held::is_held(v) {
        return match held::held(v) {
            Some(crate::pyjson::J::Big(s)) => Some(crate::pyfmt::PyInt::Big(s)),
            _ => None, // int(nan)・int(inf) は読めない
        };
    }
    crate::pyfmt::py_int_of(v.into()).ok()
}

fn is_int(v: &Value) -> bool {
    match v {
        Value::Bool(_) => true,
        Value::Number(n) => n.is_i64() || n.is_u64(),
        _ => matches!(held::held(v), Some(crate::pyjson::J::Big(_))),
    }
}

/// 中身の列の字の理由（隔てないなら None）。JSON として読めない字は隔てない（道が今どおりに読む・断る）
pub fn content_problem(col: &str, text: Option<&Value>) -> Option<String> {
    let t = text?.as_str().filter(|t| !t.is_empty() && !held::is_held(text.unwrap()))?;
    if crate::master_rows::json_depth(t.as_bytes()) >= DEEP {
        return Some(format!("「{col}」の入れ子が深すぎます（{DEEP} 段以上）"));
    }
    let (j, lone) = crate::pyjson::loads_flagged(t).ok()?;
    if nonfinite(&j) {
        return Some(format!("「{col}」に数でない値（NaN・Infinity）があります"));
    }
    if lone {
        return Some(format!("「{col}」に対の無い代用字があります"));
    }
    None
}

fn nonfinite(j: &crate::pyjson::J) -> bool {
    use crate::pyjson::J;
    match j {
        J::Float(f) => !f.is_finite(),
        J::Arr(a) => a.iter().any(nonfinite),
        J::Obj(m) => m.iter().any(|(_, v)| nonfinite(v)),
        _ => false,
    }
}

/// 行の理由（隔てないなら None。Python の row_check.problem と同じ順に見る）。fields はそのマスタの置く項目
pub fn problem(name: &str, r: &Value, fields: &[&str]) -> Option<String> {
    let Some(o) = r.as_object() else { return Some("表でない行".into()) };
    if let Some(v) = o.get("id") {
        if !is_int(v) {
            return Some(format!("id が数ではありません（{}）", short(v)));
        }
    }
    if let Some(v) = o.get("rev") {
        if as_int(v).is_none() {
            return Some(format!("版（rev）が読めません（{}）", short(v)));
        }
    }
    let name_col = find(&NAME_COLS, name);
    let strs = find(&STR_COLS, name).unwrap_or(&[]);
    let mut cols: Vec<&str> = fields.to_vec();
    if let Some(n) = name_col.filter(|n| !fields.contains(n)) {
        cols.push(n);
    }
    for k in cols {
        let Some(v) = o.get(k) else { continue };
        if v.is_array() || v.is_object() {
            return Some(format!("「{k}」が並び・表です（{}）", short(v)));
        }
        if held::is_nonfinite(v) {
            return Some(format!("「{k}」が数でない値です（{}）", short(v)));
        }
        let text = v.is_string() && !held::is_held(v);
        if strs.contains(&k) && !text {
            return Some(format!("「{k}」が字ではありません（{}）", short(v)));
        }
        if Some(k) == name_col && !v.is_null() && !text {
            return Some(format!("「{k}」が字ではありません（{}）", short(v)));
        }
    }
    for k in find(&CONTENT_COLS, name).unwrap_or(&[]) {
        if let Some(why) = content_problem(k, o.get(*k)) {
            return Some(why);
        }
    }
    if RAW.contains(&name) && held::has_nonfinite(r) {
        return Some("数でない値（NaN・Infinity）があります".into());
    }
    None
}

/// 組ごとの中身の確かめ（窓が同じに扱えない中身の形。Python の master_repository.EXTRA_CHECKS）
pub type Extra<'a> = Option<&'a dyn Fn(&Map<String, Value>) -> Option<String>>;

/// 隔てた行: (行の位置, 何行目, 理由)。表でない行も入れる
pub fn isolated(name: &str, rows: &[Value], fields: &[&str], extra: Extra) -> Vec<(usize, usize, String)> {
    rows.iter()
        .enumerate()
        .filter_map(|(i, r)| {
            let why = problem(name, r, fields).or_else(|| extra.and_then(|f| r.as_object().and_then(f)))?;
            Some((i, i + 1, why))
        })
        .collect()
}

/// 隔てた行の知らせ（答えの skipped）
pub fn skipped_of(iso: &[(usize, usize, String)]) -> Value {
    Value::Array(iso.iter().map(|(_, n, why)| json!({"row": n, "why": why})).collect())
}

/// 隔てた行の知らせの言葉（3 行まで）
pub fn skipped_text(name: &str, iso: &[(usize, usize, String)]) -> String {
    let rows: Vec<String> = iso.iter().take(3).map(|(_, n, why)| format!("{n} 行目（{why}）")).collect();
    let more = if iso.len() > 3 { format!(" ほか {} 行", iso.len() - 3) } else { String::new() };
    format!("{name}.json の {}{more}が読めません", rows.join("・"))
}

/// 位置 i の行が隔てた行か
pub fn is_isolated(iso: &[(usize, usize, String)], i: usize) -> bool {
    iso.iter().any(|(j, _, _)| *j == i)
}

/// 直す・消す行が隔てた行なら書かない（Python の master_repository.guard）
pub fn guard(name: &str, rows: &[Value], iso: &[(usize, usize, String)], item_id: i64) -> Result<(), MasterError> {
    for (i, n, why) in iso {
        let hit = rows[*i].as_object().and_then(|o| o.get("id")).and_then(as_int).is_some_and(|x| x.small() == Some(item_id));
        if hit {
            return Err(refuse_row(name, *n, why));
        }
    }
    Ok(())
}

pub fn refuse_row(name: &str, n: usize, why: &str) -> MasterError {
    MasterError::Unreadable(format!("{name}.json の {n} 行目が読めません（{why}）。ファイルを直すまで保存しません。"))
}

/// 権限の 2 つ: 隔てる形の行があれば書かない（Python の _normalize_all）
pub fn refuse_strict(name: &str, iso: &[(usize, usize, String)]) -> Result<(), MasterError> {
    if iso.is_empty() || !STRICT.contains(&name) {
        return Ok(());
    }
    Err(MasterError::Unreadable(format!("{}。ファイルを直すまで保存しません。", skipped_text(name, iso))))
}

/// 一覧の答えに添える知らせ（Python の routes/common.row_notes。無ければ足さない）
pub fn notes(out: &mut Map<String, Value>, iso: &[(usize, usize, String)], unreadable: Option<String>) {
    if !iso.is_empty() {
        out.insert("skipped".into(), skipped_of(iso));
    }
    if let Some(u) = unreadable {
        out.insert("unreadable".into(), json!(u));
    }
}

/// 一覧に出す行（隔てた行を除く）
pub fn good<'a>(rows: &'a [Value], iso: &[(usize, usize, String)]) -> Vec<&'a Value> {
    rows.iter().enumerate().filter(|(i, r)| r.is_object() && !is_isolated(iso, *i)).map(|(_, r)| r).collect()
}

/// 組ごとの中身の確かめ（Python の master_repository.EXTRA_CHECKS）
/// 行の確かめの関数
type Check = fn(&Map<String, Value>) -> Option<String>;

fn extra_of(name: &str) -> Option<Check> {
    match name {
        "display_formats" => Some(crate::formats_write::row_problem),
        "pivot_presets" => Some(crate::pivot_presets::row_problem),
        "dashboards" => Some(dashboards_extra),
        "dashboard_settings" => Some(crate::layout_clean::settings_problem),
        "equipment_groups" => Some(crate::equipgroups_write::row_problem),
        _ => None,
    }
}

/// 隔てた行（組ごとの中身の確かめも。Python の master_repository.isolated）
pub fn check(name: &str, rows: &[Value], fields: &[&str]) -> Vec<(usize, usize, String)> {
    let extra = extra_of(name);
    isolated(name, rows, fields, extra.as_ref().map(|f| f as &dyn Fn(&Map<String, Value>) -> Option<String>))
}

/// 読む欄（中身の列）の字に i64 に入らない整数があるか（窓は値を変えずに扱えない。H2 で桁のまま持つまで、その道は Python に任せる）
pub fn wide_content(name: &str, rows: &[Value]) -> bool {
    let cols = find(&CONTENT_COLS, name).unwrap_or(&[]);
    rows.iter().filter_map(Value::as_object).any(|o| {
        cols.iter().any(|k| {
            o.get(*k)
                .and_then(Value::as_str)
                .is_some_and(|t| crate::pyjson::loads(t).is_ok() && crate::master_rows::split_wide(t.as_bytes()))
        })
    })
}

/// dashboards の組ごとの確かめ: カードの設計の行（元 card:…）だけ（Python の master_repository._dashboards_extra）
fn dashboards_extra(r: &Map<String, Value>) -> Option<String> {
    let card = r.get("元").and_then(Value::as_str).is_some_and(|s| s.starts_with("card:"));
    if card {
        crate::card_forms::row_problem(r)
    } else {
        None
    }
}

/// マスタの置く項目（Python の master_repository.SPECS の fields。状態の skipped を数えるとき）
pub fn fields_of(name: &str) -> &'static [&'static str] {
    match name {
        "equipment_master" => &["設備名", "巻取方向", "ライン方向", "同一工程", "検査計"],
        "roll_master" => &[
            "設備",
            "入出位置",
            "接触面",
            "ロール径MAX",
            "ロール径MIN",
            "ロール面長",
            "材質",
            "硬度",
            "本数",
            "ロール名",
            "ロール使用条件",
            "駆動方式",
            "基準番号",
            "備考",
        ],
        "path_settings" => &["項目", "値"],
        "access_permissions" => &["ログインID", "PC名", "権限区分", "マスタ編集", "有効", "備考", "タブの例外"],
        "tab_access" => &["タブ", "出さない区分"],
        "work_log_files" => &["キー", "設備名", "ファイル名", "ファイルID", "表示", "表", "備考", "並び"],
        "display_formats" => &["名前", "元", "表", "作った所", "中身", "備考"],
        "shift_patterns" => &["名称", "適用設備", "区分", "表示順", "備考"],
        "equipment_groups" => &["名称", "まとめ方", "設備", "ルール", "表示順", "備考"],
        "conversions" | "conversion_defaults" => &["名前", "入力", "判定", "その他", "当て方", "表示順"],
        "pivot_presets" | "dashboards" => PRESET,
        "pivot_quick" => &["ログインID", "元", "並び"],
        "data_sources" => &[
            "キー",
            "表示名",
            "役割",
            "場所",
            "表",
            "設備の列",
            "設備の取り出し方",
            "画面",
            "並び",
            "備考",
            "結合",
            "グループ",
            "元",
            "確かめる間隔",
            "古さの警告",
            "ロット番号の列",
        ],
        "dashboard_settings" => &["キー", "条件", "備考"],
        _ => &[],
    }
}

/// 行の形をそろえる（Python の master_repository._normalize: 旧い列名の読み替え〈設備マスタの 巻出し方向 → 巻取方向〉・版の無い行は 1）
pub fn normalize_like_specs(name: &str, rows: &mut [Value]) {
    let renamed: &[(&str, &str)] = if name == "equipment_master" { &[("巻出し方向", "巻取方向")] } else { &[] };
    let spec = crate::master_rows::Spec { name: "", fields: &[], unique: None, renamed };
    crate::master_rows::normalize_all(rows, &spec);
}
