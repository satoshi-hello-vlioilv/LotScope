//! 組む所の読み 7 本（版 3.99.0。Python の routes/dashboard.py の dashboard_fields・data_columns と、routes/sources.py の sources_columns・
//! sources_check・sources_join_preview・sources_conn_check。決まりは services/builder.py）を窓が答える。
//!
//! - GET・POST /api/dashboard/fields … パネルを組む所の左のカラムの札（pivot.rs の field_sets・merge_fields・fields_many）
//! - GET /api/data/columns … 変換表の当てる列（pivot.rs の column_names。見本は samples_of の 1 か所）
//! - GET /api/sources/<key>/columns … 結合の欄の列（作業実績は表示する全部の設備）
//! - POST /api/sources/check … データ元の場所の「確かめる」（check_sqlite）
//! - POST /api/sources/join/preview … 結合の「試す」（作業実績は表示する全部の設備で数えて足す）
//! - POST /api/sources/<key>/conn/check … 接続の設定の 1 項目の「確かめる」
//!
//! 決め（主のセッションが決めた。Python の services/builder.py と同じ名前・同じ値。desktop/tests/builder_parity.rs が突き合わせる）:
//!   1 KINDS_UNION … すべての設備の札の種類は、値を合わせた本当の数（和集合）
//!   2 EQUIP_LIMIT … 合わせる設備の上限（None は全部。前は 12 台）
//!   3 種類はスライサー・集計と同じ見分け（SortKey: 空欄を 1 つ・0 と '0' を同じ。pivot::field_sets・merge_fields の 1 か所）
//!   4 JOIN_ALL_EQUIPS … 作業実績の結合の「試す」と列は、表示する全部の設備で数える（設備ごとの内訳 byEquip・読めなかった設備 failed）
//!   5 STALE_ROLES … 「最後の更新が古いファイルです」の警告を出す役割（マスタなど更新の少ない役割には出さない）
//!   6 CM3_REACH … スケジュール（CM3）の URL の確かめは、CM3 に届くかまで見る（lotdsp_direct::reachable: プロキシを通さない 1 回の GET。cm3_http）
//!   7 札を待つ間は、ダッシュボードの待ちの段（progress.rs。?ask=）に写した・読んだ設備 n/m で載せる
//!   SQLite の英語の誤りの字は答えを変えない（日本語に読み替えるかは分からない。計画書）
//!
//! 窓が答えず Python に任せる形（Python と同じ字にできない・Python も落ちる形）: ?engine=python・窓の束の設定や一覧の材料を組めない・
//! 窓が同じに読めない本文（NaN・Infinity・大きな数など: master_rows::unreadable）・表でない本文（並び・数・字。Python は 500）・
//! 字でない欄（source・equip・key・base・place など。Python は str() の字にするか落ちる）・字でない設備の並び・
//! スケジュールを窓が答えない形（panel_parts の Ok(None)）・道の鍵に百分率符号・結合の決まりの窓の読めない形（sources_write の Delegate）・
//! 参照先の項目の値の窓の読めない形（settings_write の Bad::Python）

use crate::dashboard::Ctx;
use crate::jsontree::Tree;
use crate::lotlist::{self, connect_ro, qi, TABLE_CANDIDATES, WORK_TABLES};
use crate::pivot::{self, Part};
use crate::pyfmt;
use crate::worksum::py_str;
use serde_json::{json, Map, Value};
use std::time::{Duration, Instant};

pub const KINDS_UNION: bool = true;
pub const EQUIP_LIMIT: Option<usize> = None;
pub const JOIN_ALL_EQUIPS: bool = true;
pub const STALE_ROLES: &[&str] = &["品質", "仕掛", "実績"];
pub const CM3_REACH: bool = true;
/// 古さの警告を出すまでの時間（確かめるの言葉）
pub const STALE_HOURS: f64 = 36.0;
/// 札・当てる列・結合の欄が作業実績の最初の写しを待つ長さ（Python の db_mirror.FIRST_WAIT_SEC）
pub const FIRST_WAIT: Duration = Duration::from_secs(30);
const LOT_MISSING: &str = "ロット番号の列が見つかりません（ロット番号・ﾛｯﾄ番号・ロット№・LTNO）。";
const STALE_TEXT: &str = "最後の更新が古いファイルです。名前の違う別のファイルではないか確かめてください。";

/// 決めの値（Python の builder.decisions と同じ形）
pub fn decisions() -> Value {
    json!({"kindsUnion": KINDS_UNION, "equipLimit": EQUIP_LIMIT, "joinAllEquips": JOIN_ALL_EQUIPS, "staleRoles": STALE_ROLES,
           "cm3Reach": CM3_REACH, "staleHours": STALE_HOURS as i64})
}

fn use_parts(parts: &[Part]) -> &[Part] {
    match EQUIP_LIMIT {
        Some(n) if parts.len() > n => &parts[..n],
        _ => parts,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Route {
    Fields,
    DataColumns,
    SrcColumns(String),
    Check,
    JoinPreview,
    ConnCheck(String),
}

/// 窓が受ける道か（Flask の <key> は / を含まない空でない字。百分率符号は Python が戻してから探すので任せる）
pub fn route_of(method: &str, path: &str) -> Option<Route> {
    let key_ok = |k: &str| !k.is_empty() && !k.contains('/') && !k.contains('%');
    match (method, path) {
        ("GET" | "POST", "/api/dashboard/fields") => Some(Route::Fields),
        ("GET", "/api/data/columns") => Some(Route::DataColumns),
        ("POST", "/api/sources/check") => Some(Route::Check),
        ("POST", "/api/sources/join/preview") => Some(Route::JoinPreview),
        ("GET", p) => {
            let k = p.strip_prefix("/api/sources/")?.strip_suffix("/columns")?;
            key_ok(k).then(|| Route::SrcColumns(k.into()))
        }
        ("POST", p) => {
            let k = p.strip_prefix("/api/sources/")?.strip_suffix("/conn/check")?;
            key_ok(k).then(|| Route::ConnCheck(k.into()))
        }
        _ => None,
    }
}

type Answer = (u16, Value);

// ------------------------------------------------------------------ 本文（Python の request.get_json(force=True, silent=True) or {}）
/// 本文 → 送った順の木。窓が同じに読めない本文・表でない本文（Python は 500）は None。空・偽の値は {}
pub fn body_of(body: &[u8]) -> Option<Tree> {
    if crate::master_rows::unreadable(body) {
        return None;
    }
    let empty = Tree::Obj(vec![]);
    if body.iter().all(|b| b.is_ascii_whitespace()) {
        return Some(empty);
    }
    let t: Tree = serde_json::from_slice(body).ok()?;
    match &t {
        Tree::Obj(_) => Some(t),
        x if !crate::layout_clean::truthy(x) => Some(empty),
        _ => None,
    }
}

/// str(本文の欄 or "")（字・偽の値だけ。ほかは None＝Python に任せる）
fn text_of(t: Option<&Tree>) -> Option<String> {
    match t {
        None => Some(String::new()),
        Some(Tree::Str(s)) => Some(s.clone()),
        Some(x) if !crate::layout_clean::truthy(x) => Some(String::new()),
        _ => None,
    }
}

/// str(本文の欄 or "")（数・真も Python の str の字に。並び・表は None）
fn text_or_num(t: Option<&Tree>) -> Option<String> {
    match t {
        Some(x @ Tree::Num(n)) if crate::layout_clean::truthy(x) => {
            n.as_i64().map(|i| i.to_string()).or_else(|| n.as_f64().map(pyfmt::float_repr))
        }
        Some(Tree::Bool(true)) => Some("True".into()),
        x => text_of(x),
    }
}

fn err(status: u16, msg: &str, kind: &str) -> Answer {
    (status, json!({"error": msg, "kind": kind}))
}

// ------------------------------------------------------------------ 札（GET・POST /api/dashboard/fields）
/// 組む所の左のカラムの札（Python の dashboard_fields）。None は Python に任せる
pub fn fields(cx: &Ctx, post: bool, query: &str, body: &[u8]) -> Option<Answer> {
    let (source, equip, equips, calc) = if post {
        let t = body_of(body)?;
        let equips = match t.get("equips") {
            Some(Tree::Arr(a)) => {
                let mut out = vec![];
                for x in a {
                    out.push(text_of(Some(x)).filter(|_| matches!(x, Tree::Str(_)))?);
                }
                out
            }
            _ => vec![],
        };
        let calc = match t.get("calc") {
            Some(Tree::Str(s)) => crate::formula::clean_calc(s),
            Some(o @ Tree::Obj(_)) => crate::formula::clean_calc(&o.dumps(", ", ": ")),
            _ => None,
        };
        (text_of_strict(t.get("source"))?, text_of_strict(t.get("equip"))?, equips, calc)
    } else {
        let q = lotlist::parse_query(query);
        let get = |k: &str| q.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()).unwrap_or_default();
        (get("source"), get("equip"), vec![], None)
    };
    let (parts, mut failed, name) = match cx.parts_for(&source, &equip, &equips, FIRST_WAIT) {
        Ok(Some(x)) => x,
        Ok(None) => return None,
        Err(raw) => return Some(raw),
    };
    let use_ = use_parts(&parts);
    let plain = calc.is_none();
    let (table, fields, bad) = pivot::fields_many(use_, &|p: &Part| calc.as_ref().and_then(|c| c.for_part(&p.name)), plain, cx.conv, 300);
    failed.extend(bad);
    let mut special = vec![];
    if parts.iter().all(|x| x.equip.is_some()) {
        let col = match &parts[0].equip {
            Some(pivot::Equip::Column(c, _)) => Some(c.clone()),
            _ => None,
        };
        let hint = match &col {
            Some(c) if !c.is_empty() => format!("「{c}」の値から見分けた設備"),
            _ => "作業実績の設備（ファイル）ごと".into(),
        };
        special.push(json!({"column": pivot::EQUIP_DIM, "name": "設備", "hint": hint}));
        let sets = cx.set_names();
        let hint = if sets.is_empty() {
            "まだ設備グループがありません（マスタ管理の「設備グループ」で作ります）"
        } else {
            "設備が入るグループ（マスタ管理の「設備グループ」のまとめ方）"
        };
        special.push(json!({"column": pivot::EGROUP_DIM, "name": "設備グループ", "sets": sets, "hint": hint}));
    }
    if parts[0].work.is_some() {
        special.push(json!({"column": "@workday", "name": "作業日", "hint": "作業開始の日（現場歴／太陽暦）", "date": true}));
        special.push(json!({"column": "@shift", "name": "直", "hint": "作業開始の時刻が入る直（マスタ管理の勤務体系）"}));
    }
    Some((200, json!({"fields": fields, "special": special, "table": table, "sourceName": name, "failed": failed})))
}

/// a.get(k, "")（無ければ ""。字でなければ None＝Python に任せる: panel_parts は字として比べる）
fn text_of_strict(t: Option<&Tree>) -> Option<String> {
    match t {
        None => Some(String::new()),
        Some(Tree::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

// ------------------------------------------------------------------ 当てる列（GET /api/data/columns）
/// データ元ごとの列と値の見本（Python の data_columns）
pub fn data_columns(cx: &Ctx) -> Option<Answer> {
    let mut out = vec![];
    for (key, name) in cx.source_keys() {
        let mut x = json!({"key": key, "name": name, "columns": [], "error": ""});
        let (parts, failed) = match cx.parts_for(&key, "", &[], FIRST_WAIT) {
            Ok(Some((p, f, _))) => (p, f),
            Ok(None) => return None,
            Err((_, v)) => {
                x["error"] = json!(v.get("error").and_then(Value::as_str).filter(|e| !e.is_empty()).unwrap_or("読めませんでした。"));
                out.push(x);
                continue;
            }
        };
        let (mut cols, mut samples): (Vec<String>, Map<String, Value>) = (vec![], Map::new());
        let mut error = String::new();
        let use_ = use_parts(&parts);
        for (i, part) in use_.iter().enumerate() {
            crate::progress::step("read", i, use_.len());
            match pivot::column_names(part, pivot::SAMPLES) {
                Err(e) => {
                    if error.is_empty() {
                        error = format!("{}: {}", part.name, e.text());
                    }
                }
                Ok((_, cs)) => {
                    for (c, s) in cs {
                        let had = samples.entry(c.clone()).or_insert_with(|| {
                            cols.push(c.clone());
                            json!([])
                        });
                        let mut v: Vec<String> = had.as_array().unwrap().iter().filter_map(|x| x.as_str().map(String::from)).collect();
                        for t in s {
                            if !v.contains(&t) {
                                v.push(t);
                            }
                        }
                        v.truncate(pivot::SAMPLES);
                        *had = json!(v);
                    }
                }
            }
        }
        if cols.is_empty() && error.is_empty() {
            if let Some(f) = failed.first() {
                error = f["error"].as_str().unwrap_or("").to_string();
            }
        }
        x["columns"] = Value::Array(cols.iter().map(|c| json!({"column": c, "samples": samples[c]})).collect());
        x["error"] = json!(error);
        out.push(x);
    }
    Some((200, json!({"sources": out})))
}

// ------------------------------------------------------------------ 結合の欄の列（GET /api/sources/<key>/columns）
fn candidates_of(key: &str) -> &'static [&'static str] {
    if key == "work" {
        WORK_TABLES
    } else {
        TABLE_CANDIDATES
    }
}

/// 1 つのファイルの (表, 列, 行の数, 値の見本)
type Cols = (String, Vec<String>, i64, Map<String, Value>);

/// 1 つのファイルの (表, 列, 行の数, 値の見本)（Python の _columns_of）
fn columns_of(path: &std::path::Path, table: &str, key: &str) -> Result<Cols, String> {
    let c = connect_ro(path)?;
    let t = lotlist::pick_table(&lotlist::tables(&c)?, table, candidates_of(key));
    let cols = lotlist::dedup(&lotlist::raw_columns(&c, &t)?);
    let n: i64 = c.query_row(&format!("SELECT COUNT(*) FROM {}", qi(&t)), [], |r| r.get(0)).map_err(lotlist::sql_err)?;
    let mut sm = Map::new();
    for col in &cols {
        sm.insert(col.clone(), json!(pivot::samples_of(&c, &t, &qi(col), pivot::SAMPLES)?));
    }
    Ok((t, cols, n, sm))
}

/// 結合の欄の手がかり（Python の sources_columns）
pub fn src_columns(cx: &Ctx, key: &str) -> Option<Answer> {
    let Some(s) = cx.conf.source(key).cloned() else { return Some(err(404, "そのデータ元はありません。", "unknown")) };
    let (plans, mut failed): (Vec<(Option<Value>, crate::lists::Plan)>, Vec<Value>) = if key == "work" {
        let (got, failed, fail) = cx.lists.work_raw_plans(cx.conf, cx.q, JOIN_ALL_EQUIPS, FIRST_WAIT);
        if let Some(f) = fail {
            return Some(f);
        }
        (got.into_iter().map(|(r, p)| (Some(r), p)).collect(), failed)
    } else {
        match cx.lists.raw_plan_opt(cx.conf, cx.q, key) {
            Ok(None) => return None,
            Err(f) => return Some(f),
            Ok(Some(p)) => (vec![(None, p)], vec![]),
        }
    };
    let (mut table, mut cols, mut rows, mut samples, mut equips) = (String::new(), Vec::<String>::new(), 0i64, Map::new(), vec![]);
    for (r, plan) in plans {
        let got = match &plan.path {
            Some(p) => columns_of(p, &plan.table, key),
            None => Err("写しがありません。".into()),
        };
        let (t, cs, n, sm) = match got {
            Ok(x) => x,
            Err(e) => match &r {
                None => return Some((503, json!({"error": e}))),
                Some(r) => {
                    failed.push(json!({"name": name_of(r), "error": e, "kind": "error"}));
                    continue;
                }
            },
        };
        if table.is_empty() {
            table = t;
        }
        rows += n;
        for c in cs {
            let had = samples.entry(c.clone()).or_insert_with(|| {
                cols.push(c.clone());
                json!([])
            });
            let mut v: Vec<String> = had.as_array().unwrap().iter().filter_map(|x| x.as_str().map(String::from)).collect();
            for x in sm[&c].as_array().into_iter().flatten().filter_map(Value::as_str) {
                if !v.iter().any(|y| y == x) {
                    v.push(x.into());
                }
            }
            v.truncate(pivot::SAMPLES);
            *had = json!(v);
        }
        if let Some(r) = r {
            equips.push(json!({"name": name_of(&r), "key": r.get("キー").cloned().unwrap_or(Value::Null), "rows": n}));
        }
    }
    if key == "work" && equips.is_empty() {
        let e = failed
            .first()
            .and_then(|f| f["error"].as_str())
            .filter(|e| !e.is_empty())
            .unwrap_or("作業実績を読めませんでした。")
            .to_string();
        return Some((503, json!({"error": e})));
    }
    let lot_set = s.get("lotSet").filter(|v| crate::lotlist::json_truthy(v)).cloned().unwrap_or(json!(""));
    let mut out = json!({"key": key, "name": s.get("name").cloned().unwrap_or(Value::Null), "table": table, "columns": cols,
                         "samples": samples, "rows": rows, "autoLot": lotlist::lot_column(&cols, None), "lotSet": lot_set});
    if key == "work" {
        out["equips"] = json!(equips);
        out["failed"] = json!(failed);
    }
    Some((200, out))
}

/// str(行.get("設備名") or "")
fn name_of(r: &Value) -> String {
    match r.get("設備名") {
        Some(v) if crate::lotlist::json_truthy(v) => py_str(v),
        _ => String::new(),
    }
}

// ------------------------------------------------------------------ 試す（POST /api/sources/join/preview）
/// 設備ごとの結合の数 → 足した数（Python の builder.sum_stats）
pub fn sum_stats(per: &[Value]) -> Value {
    let first = per[0].as_array().cloned().unwrap_or_default();
    let mut out = vec![];
    for (i, f) in first.iter().enumerate() {
        let steps: Vec<&Value> = per.iter().map(|p| &p[i]).collect();
        let mut x = f.as_object().cloned().unwrap_or_default();
        let n = |v: &Value, k: &str| v.get(k).and_then(Value::as_i64).unwrap_or(0);
        for k in ["rows", "hit", "miss", "out", "rightRows"] {
            x.insert(k.into(), json!(steps.iter().map(|s| n(s, k)).sum::<i64>()));
        }
        for k in ["rightHit", "rightOnly"] {
            let none = steps.iter().any(|s| s.get(k).is_none_or(Value::is_null));
            x.insert(k.into(), if none { Value::Null } else { json!(steps.iter().map(|s| n(s, k)).sum::<i64>()) });
        }
        x.insert("rightDup".into(), json!(steps.iter().map(|s| n(s, "rightDup")).max().unwrap_or(0)));
        let mut miss: Vec<Value> = vec![];
        for s in &steps {
            for m in s.get("missSample").and_then(Value::as_array).into_iter().flatten() {
                if !miss.contains(m) && miss.len() < crate::join::SAMPLE {
                    miss.push(m.clone());
                }
            }
        }
        x.insert("missSample".into(), json!(miss));
        out.push(Value::Object(x));
    }
    Value::Array(out)
}

/// 試す設備（設備名, キー, 読むファイル, 表）
pub struct Left {
    pub name: String,
    pub key: Value,
    pub path: std::path::PathBuf,
    pub table: String,
}

/// 作業実績の「試す」（決め 4。Python の builder.try_each）: 設備ごとに結合を組んで数え、足す。組めない設備（その設備にだけ鍵の列が無い など）は
/// failed（設備名と理由・kind join）に入れて飛ばし、ほかの設備で数える（前は 1 台が組めないと全体が 400 になった。作った後の採点）。
/// → (答え〈数えた設備が 1 台も無ければ None〉, 組めなかった設備, 最初の失敗の状態〈400 か 503〉)
pub fn try_each(
    joiner: &crate::join::Joiner,
    lefts: &[Left],
    items: &[crate::join::Join],
    rights: &[crate::join::Right],
    source_name: &str,
) -> (Option<Map<String, Value>>, Vec<Value>, Option<u16>) {
    let (mut per, mut failed, mut table, mut status) = (vec![], vec![], String::new(), None);
    for l in lefts {
        let scope = format!("try-work-{}", py_str(&l.key));
        match joiner.path_for(&scope, &l.path, &l.table, items, rights) {
            Err(e) => {
                failed.push(json!({"name": l.name, "error": format!("「{source_name}」の結合を組めませんでした: {e}"), "kind": "join"}));
                status = status.or(Some(if matches!(e, crate::join::JoinError::Rule(_)) { 400 } else { 503 }));
            }
            Ok((_, stats)) => {
                if table.is_empty() {
                    table = l.table.clone();
                }
                per.push(json!({"name": l.name, "key": l.key, "stats": stats}));
            }
        }
    }
    if per.is_empty() {
        return (None, failed, status);
    }
    let stats: Vec<Value> = per.iter().map(|x| x["stats"].clone()).collect();
    let mut out = Map::new();
    out.insert("stats".into(), sum_stats(&stats));
    out.insert("table".into(), json!(table));
    out.insert("equip".into(), Value::Null);
    out.insert("counted".into(), json!(per.len()));
    out.insert("byEquip".into(), Value::Array(per));
    (Some(out), failed, status)
}

/// 「試す」（Python の sources_join_preview）。None は Python に任せる
pub fn join_preview(cx: &Ctx, items: &[Map<String, Value>], body: &[u8]) -> Option<Answer> {
    let t = body_of(body)?;
    let v = t.to_value();
    let key = text_of(t.get("key"))?;
    let base = text_of(t.get("base"))?;
    let targets = crate::sources_write::join_targets(items);
    let s = if !base.is_empty() && key.is_empty() {
        if !targets.iter().any(|(k, _)| *k == base) {
            return Some(err(400, "結合した表の元にするデータ元を選んでください。", "invalid"));
        }
        json!({"key": "", "name": "結合した表", "base": base, "kind": "view", "joins": []})
    } else {
        match cx.conf.source(&key) {
            Some(s) => s.clone(),
            None => return Some(err(404, "そのデータ元はありません。", "unknown")),
        }
    };
    let own_base = match s.get("base") {
        Some(b) if crate::lotlist::json_truthy(b) => py_str(b),
        _ => String::new(),
    };
    let known: Vec<(String, String)> = targets.into_iter().filter(|(k, _)| *k != own_base).collect();
    let joins = match crate::sources_write::clean_joins(v.get("joins"), &key, &known).ok()? {
        Err(e) => return Some(err(400, &e, "invalid")),
        Ok((text, _)) => crate::join::Join::list(&serde_json::from_str(&text).unwrap_or(Value::Null)),
    };
    if joins.is_empty() {
        return Some((200, json!({"stats": [], "rows": null})));
    }
    if key == "work" {
        let (got, mut failed, fail) = cx.lists.work_raw_plans(cx.conf, cx.q, JOIN_ALL_EQUIPS, FIRST_WAIT);
        if let Some(f) = fail {
            return Some(f);
        }
        let total = got.len() + failed.len(); // 表示する設備（読めた設備と、写し・ファイルで読めなかった設備）
        let rights = match cx.lists.rights_of(cx.conf, cx.q, &joins) {
            Ok(r) => r,
            Err(f) => return Some(f),
        };
        let sname = s.get("name").map(py_str).unwrap_or_default();
        let mut lefts = vec![];
        for (r, plan) in got {
            let path = plan.path.clone().unwrap_or_default();
            match crate::lists::actual_table(&path, &plan.table, "work") {
                Ok(table) => lefts.push(Left { name: name_of(&r), key: r.get("キー").cloned().unwrap_or(Value::Null), path, table }),
                Err(e) => {
                    failed.push(json!({"name": name_of(&r), "error": format!("「{sname}」の結合を組めませんでした: {e}"), "kind": "join"}))
                }
            }
        }
        let (ans, bad, status) = try_each(&cx.lists.joiner, &lefts, &joins, &rights, &sname);
        let first_bad = bad.first().cloned();
        failed.extend(bad);
        let Some(mut ans) = ans else {
            // 全部の設備で組めない: 最初の設備の理由で断る
            let e = first_bad.or_else(|| failed.first().cloned()).map(|f| f["error"].clone()).unwrap_or(json!(""));
            return Some((status.unwrap_or(503), json!({"error": e, "kind": "join"})));
        };
        ans.insert("failed".into(), json!(failed));
        ans.insert("total".into(), json!(total));
        return Some((200, Value::Object(ans)));
    }
    let from = if base.is_empty() { key.clone() } else { base.clone() };
    let plan = match cx.lists.raw_plan_opt(cx.conf, cx.q, &from) {
        Ok(None) => return None,
        Err(f) => return Some(f),
        Ok(Some(p)) => p,
    };
    let scope = format!("try-{}", if key.is_empty() { format!("new-{base}") } else { key.clone() });
    match cx.lists.with_joins_as(cx.conf, cx.q, plan, &s, Some(&scope), Some(joins)) {
        Err(f) => Some(f),
        Ok(out) => Some((200, json!({"stats": out.joined, "table": out.table, "equip": null}))),
    }
}

// ------------------------------------------------------------------ 確かめる（POST /api/sources/check・conn/check の場所）
/// 確かめるが表を探す候補（一覧と同じ: 品質は品質データの候補・ほかはデータ元の候補。どちらも同じ並び）
fn check_candidates(_role: &str) -> &'static [&'static str] {
    TABLE_CANDIDATES
}

/// OS の言葉（Python の OSError の strerror: 「(os error n)」を除く）
/// Python の OSError.strerror（Windows は CPython と同じ FormatMessage の文から末尾の空白と「.」を切った形。Rust の io::Error の文は
/// 言語も切り方も違う〈版 3.96.0 の cm3_http::win_message〉。Windows の CI で「…specified」と「…specified.」が食い違った）
fn strerror(e: &std::io::Error) -> String {
    #[cfg(windows)]
    if let Some(n) = e.raw_os_error() {
        return crate::cm3_http::win_message(n);
    }
    let t = e.to_string();
    t.split(" (os error").next().unwrap_or(&t).to_string()
}

/// 「確かめる」（.sqlite3 の場所。Python の builder.check_sqlite）
pub fn check_sqlite(value: &str, table: &str, role: &str, equip_column: &str) -> Value {
    let p = crate::lists::unquote_path(value);
    if p.is_empty() {
        return json!({"ok": false, "message": "ファイルの場所を入れてください。"});
    }
    let t0 = Instant::now();
    let meta = match std::fs::metadata(&p) {
        Ok(m) => m,
        Err(e) => {
            return json!({"ok": false, "message": format!("ファイルに届きません（{}）。場所・名前・共有フォルダへの接続を確かめてください。", strerror(&e))})
        }
    };
    let col = pyfmt::strip(equip_column).to_string();
    // (表の並び, 一覧に使う表, 行の数, 列, 設備の列の値の例)
    type Opened = (Vec<String>, String, i64, Vec<String>, Option<Vec<String>>);
    let opened = (|| -> Result<Opened, String> {
        let c = connect_ro(std::path::Path::new(&p))?;
        let names = lotlist::tables(&c)?;
        let t = lotlist::pick_table(&names, table, check_candidates(role));
        let n: i64 = if t.is_empty() {
            0
        } else {
            c.query_row(&format!("SELECT COUNT(*) FROM {}", qi(&t)), [], |r| r.get(0)).map_err(lotlist::sql_err)?
        };
        let cs = if t.is_empty() { vec![] } else { lotlist::dedup(&lotlist::raw_columns(&c, &t)?) };
        let ex = if !col.is_empty() && cs.contains(&col) { Some(pivot::samples_of(&c, &t, &qi(&col), pivot::SAMPLES)?) } else { None };
        Ok((names, t, n, cs, ex))
    })();
    let (names, t, n, cs, ex) = match opened {
        Ok(x) => x,
        Err(e) => return json!({"ok": false, "message": format!("SQLite のファイルとして開けません（{e}）。")}),
    };
    let mtime = crate::lists::py_mtime(meta.modified().unwrap_or(std::time::UNIX_EPOCH));
    let now = crate::lists::py_mtime(std::time::SystemTime::now());
    let age_h = ((now - mtime) / 3600.0).max(0.0);
    let lot = lotlist::lot_column(&cs, None);
    let when = chrono::DateTime::from_timestamp(mtime.floor() as i64, 0)
        .map(|d| d.with_timezone(&chrono::Local).format("%Y/%m/%d %H:%M").to_string())
        .unwrap_or_default();
    let msg = format!(
        "開けました。表 {} 個（一覧に使う表: {}・{}行）・最後の更新 {when}（{age_h:.0}時間前）・{:.1} MB・{:.0} ms",
        names.len(),
        if t.is_empty() { "なし" } else { &t },
        pivot::commas(n),
        meta.len() as f64 / 1024.0 / 1024.0,
        t0.elapsed().as_secs_f64() * 1000.0
    );
    let mut warn = vec![];
    let need_lot = role == "品質";
    if need_lot && lot.is_empty() {
        warn.push(LOT_MISSING);
    }
    if STALE_ROLES.contains(&role) && age_h > STALE_HOURS {
        warn.push(STALE_TEXT);
    }
    let ok = !t.is_empty() && (!lot.is_empty() || !need_lot);
    let mut message = if warn.is_empty() { msg } else { format!("{msg} {}", warn.join(" ")) };
    let mut ok_now = ok;
    if ok && !col.is_empty() {
        match &ex {
            None => {
                ok_now = false;
                message += &format!(" 設備の列「{col}」が表「{t}」にありません。");
            }
            Some(v) => {
                let e = if v.is_empty() { "（空）".to_string() } else { v.join("・") };
                message += &format!(" 設備の列「{col}」の値の例: {e}。");
            }
        }
    }
    json!({"ok": ok_now, "message": message, "detail": {"tables": names, "table": t, "rows": n, "lotColumn": lot, "mtime": mtime}})
}

/// POST /api/sources/check（Python の sources_check）
pub fn check(body: &[u8]) -> Option<Answer> {
    let t = body_of(body)?;
    let g = |k: &str| text_or_num(t.get(k));
    Some((200, check_sqlite(&g("place")?, &g("table")?, &g("role")?, &g("equipColumn")?)))
}

/// 材料: 接続の設定（GET /api/sources の conn）を持つデータ元の並び・効いている作業実績のファイル名の決まり
pub struct ConnInputs<'a> {
    pub items: &'a [Map<String, Value>],
    pub pattern: String,
}

fn ok_msg(ok: bool, message: impl Into<String>) -> Answer {
    (200, json!({"ok": ok, "message": message.into()}))
}

/// POST /api/sources/<key>/conn/check（Python の sources_conn_check）。None は Python に任せる
pub fn conn_check(inp: &ConnInputs, key: &str, body: &[u8]) -> Option<Answer> {
    let t = body_of(body)?;
    let field = text_or_num(t.get("field"))?;
    let Some(s) = inp.items.iter().find(|x| x.get("key").and_then(Value::as_str) == Some(key)) else {
        return Some(err(404, "そのデータ元はありません（ほかの PC が消した可能性があります）。", "unknown"));
    };
    let conn = s.get("conn").and_then(Value::as_array).cloned().unwrap_or_default();
    let Some(f) = conn.iter().find(|x| x.get("id").and_then(Value::as_str) == Some(field.as_str())) else {
        let name = s.get("name").map(py_str).unwrap_or_default();
        return Some(err(400, &format!("「{name}」に「{field}」の設定はありません。"), "invalid"));
    };
    let raw = pyfmt::strip(&text_or_num(t.get("value"))?).to_string();
    let raw = if raw.is_empty() {
        match f.get("default") {
            Some(d) if crate::lotlist::json_truthy(d) => py_str(d),
            _ => String::new(),
        }
    } else {
        raw
    };
    let item = if f["bind"] == "settings" {
        crate::settings_write::item_of(f["item"].as_str().unwrap_or(""))?.clone()
    } else {
        json!({"key": f["item"], "label": f["label"], "kind": f["kind"], "min": f.get("min").cloned().unwrap_or(Value::Null),
               "max": f.get("max").cloned().unwrap_or(Value::Null)})
    };
    // 決まった読み方の無い種類（ロット番号の列 lotcol など）は Python の parse と同じく前後の空白を除いた字
    let plain =
        !["int", "number", "url", "text", "sqlite", "folder", "pattern", "release", "exe"].contains(&item["kind"].as_str().unwrap_or(""));
    let parsed = if plain {
        let s = pyfmt::strip(&raw).to_string();
        Ok((!s.is_empty()).then(|| json!(s)))
    } else {
        crate::settings_write::parse_value(&item, Some(&json!(raw)))
    };
    let value = match parsed {
        Ok(Some(v)) => v,
        Ok(None) => return Some(ok_msg(false, "値を入れてください。")),
        Err(crate::settings_write::Bad::Invalid(m)) => return Some(ok_msg(false, m)),
        Err(crate::settings_write::Bad::Python) => return None,
    };
    let kind = item["kind"].as_str().unwrap_or("");
    let vtext = py_str(&value);
    Some(match kind {
        "sqlite" => {
            let g = |k: &str| match s.get(k) {
                Some(v) if crate::lotlist::json_truthy(v) => py_str(v),
                _ => String::new(),
            };
            (200, check_sqlite(&vtext, &g("table"), &g("role"), ""))
        }
        "folder" => {
            let pat = text_or_num(t.get("pattern"))?;
            let pattern = if pyfmt::strip(&pat).is_empty() {
                inp.pattern.clone()
            } else {
                let it = crate::settings_write::item_of("work_log.pattern")?;
                match crate::settings_write::parse_value(it, Some(&json!(pat))) {
                    Ok(Some(p)) => py_str(&p),
                    Ok(None) => inp.pattern.clone(),
                    Err(crate::settings_write::Bad::Invalid(m)) => return Some(ok_msg(false, m)),
                    Err(crate::settings_write::Bad::Python) => return None,
                }
            };
            (200, folder_check(&vtext, &pattern))
        }
        "url" => {
            let k = item["key"].as_str().unwrap_or("");
            if k == "lotdsp_import.url" {
                let ok = crate::lotdsp_direct::reachable(&crate::lotdsp::rules::site_base(&vtext), 4.0);
                ok_msg(
                    ok,
                    if ok {
                        "LotDsp に届きました（ログインが要るかは「検索」で分かります）。"
                    } else {
                        "LotDsp に届きません（社外・VPN 未接続・場所の間違い）。"
                    },
                )
            } else if k == "schedule.cm3_base_url" {
                cm3_reach(&vtext)
            } else {
                ok_msg(true, "URL の形は正しいです。")
            }
        }
        "exe" => {
            let why = if vtext.is_empty() { String::new() } else { crate::lotdsp_direct::trusted_browser(&vtext) };
            if !why.is_empty() {
                ok_msg(false, why)
            } else {
                match crate::lotdsp_direct::find_browser(&vtext) {
                    Some(found) => {
                        ok_msg(true, format!("使えます: {found}{}", if vtext.is_empty() { "（自動で見つけた場所）" } else { "" }))
                    }
                    None => ok_msg(
                        false,
                        if vtext.is_empty() {
                            "Edge が見つかりません。msedge.exe の場所を入れてください。"
                        } else {
                            "そのファイルがありません。"
                        },
                    ),
                }
            }
        }
        "pattern" => match crate::lists::split_pattern(&vtext) {
            Ok((head, tail)) => ok_msg(true, format!("「{head}設備名{tail}」の形のファイルを探します。")),
            Err(e) => ok_msg(false, e),
        },
        _ => ok_msg(true, "値の形は正しいです。"),
    })
}

/// CM3 に届くか（決め 6。Python の builder.cm3_reach）
fn cm3_reach(url: &str) -> Answer {
    if !CM3_REACH {
        return ok_msg(true, "URL の形は正しいです（つながるかは「スケジュール」のタブで確かめてください）。");
    }
    let ok = crate::lotdsp_direct::reachable(url, 4.0);
    ok_msg(
        ok,
        if ok {
            "CM3 に届きました（設備ごとの予定は「スケジュール」のタブで確かめてください）。"
        } else {
            "CM3 に届きません（社外・VPN 未接続・場所の間違い）。"
        },
    )
}

/// 作業実績のフォルダ: 届くか・決まりに合うファイル（設備）がいくつあるか（Python の _check_folder）
fn folder_check(value: &str, pattern: &str) -> Value {
    let t0 = Instant::now();
    let found = match crate::lists::scan(value, pattern) {
        Ok(f) => f,
        Err(e) => return json!({"ok": false, "message": e}),
    };
    if found.is_empty() {
        return json!({"ok": false, "message": format!("フォルダには届きましたが、{pattern} に合うファイルがありません。場所かファイル名の決まりを確かめてください。")});
    }
    let mut names = found.iter().take(8).map(|f| f.equipment.clone()).collect::<Vec<_>>().join("・");
    if found.len() > 8 {
        names += &format!(" ほか {}", found.len() - 8);
    }
    json!({"ok": true, "message": format!("届きました。設備 {} 台（{names}）・{:.0} ms", found.len(), t0.elapsed().as_secs_f64() * 1000.0),
           "detail": {"files": found.iter().map(|f| f.file.clone()).collect::<Vec<_>>()}})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_are_the_seven_reads() {
        assert_eq!(route_of("GET", "/api/dashboard/fields"), Some(Route::Fields));
        assert_eq!(route_of("POST", "/api/dashboard/fields"), Some(Route::Fields));
        assert_eq!(route_of("GET", "/api/data/columns"), Some(Route::DataColumns));
        assert_eq!(route_of("GET", "/api/sources/wip/columns"), Some(Route::SrcColumns("wip".into())));
        assert_eq!(route_of("POST", "/api/sources/check"), Some(Route::Check));
        assert_eq!(route_of("POST", "/api/sources/join/preview"), Some(Route::JoinPreview));
        assert_eq!(route_of("POST", "/api/sources/wip/conn/check"), Some(Route::ConnCheck("wip".into())));
        // 書く道・別の道・百分率符号は受けない
        for (m, p) in [
            ("DELETE", "/api/sources/check"),
            ("PUT", "/api/sources/wip/conn"),
            ("POST", "/api/sources/wip/columns"),
            ("GET", "/api/sources/a/b/columns"),
            ("GET", "/api/sources/%E7/columns"),
            ("GET", "/api/sources//columns"),
            ("POST", "/api/settings/check"),
        ] {
            assert_eq!(route_of(m, p), None, "{m} {p}");
        }
    }

    #[test]
    fn bodies_like_python() {
        assert!(body_of(b"").is_some() && body_of(b"null").is_some() && body_of(b"[]").is_some());
        assert!(body_of(b"[1]").is_none() && body_of(b"5").is_none() && body_of(br#"{"a": NaN}"#).is_none());
        let t = body_of(br#"{"a": 0, "b": "x", "c": [1], "d": 12, "e": 1.5}"#).unwrap();
        assert_eq!(text_of(t.get("a")), Some(String::new()));
        assert_eq!(text_of(t.get("b")), Some("x".into()));
        assert_eq!(text_of(t.get("c")), None);
        assert_eq!(text_or_num(t.get("d")), Some("12".into()));
        assert_eq!(text_or_num(t.get("e")), Some("1.5".into()));
    }
}
