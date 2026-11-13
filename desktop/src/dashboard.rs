//! ダッシュボードのパネルの数（版 3.62.0。Python の routes/dashboard.py の /api/dashboard/query と services/dashboard.py の確かめと同じ答え）。
//!
//! 1 枚のパネル（本文 {panel}。送った順の木で読む）を確かめ（保存の道と同じ layout_clean::clean_panel。版 3.83.0）、段取り（どのファイルを読むか: lists.rs）をして、集計（pivot.rs の query_many）で数え、
//! 形に合わせて組み立てる: 設備の分け方（重ねる series・並べる facet・合算 sum）・別のデータを合わせる（link）・合わせた表（board）。
//! スケジュール（CM3）は版 3.96.0 から窓が係（lists.rs の src_plan_eq → schedule.rs）。窓の束の設定が無い形・係を降りた設定は Python が答える（None）。
//! 材料（データ元・作業実績の登録・勤務体系・設備の名前・設備グループ・試験の「いま」）は、一覧の設定の答え（lists）で受け取る。
//! 答えが同じことは desktop/tests/dash_parity.rs が Python の答え（program/tests/dash_oracle.py）と突き合わせて確かめる。

use crate::formula::{self, Calc, Tables};
use crate::jsontree::Tree;
use crate::layout_clean::{self, Stop};
use crate::lists::{Conf, Lists, Plan, Quality};
use crate::lotlist::{json_str, json_truthy, TABLE_CANDIDATES, WORK_TABLES};
use crate::operation::{self, ReadArgs};
use crate::pivot::{self, Ask, Equip, EquipMatcher, Fail as PFail, Part, Work};
use crate::pyfmt;
use crate::worksum::{self, normalize_part, Clock};
use crate::{aggregate, aggregate::N};
use chrono::NaiveDateTime;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MAX_EQUIPS: usize = 200;
const MAX_FACETS: usize = 24;
/// ダッシュボードが作業実績の最初の写しを待つ長さ（版 3.92.0。前は 30 秒: 遅い設備が混ざると最初の数まで 12 秒かかった。
/// Python の routes/dashboard.py の DASH_FIRST_WAIT_SEC と同じ）。写し終えていない設備は「写しています」で、画面が引き直す
const FIRST_WAIT: Duration = Duration::from_secs(2);
const CACHE_MAX: usize = 96;
const OPS_VISUALS: &[&str] = &["gantt", "abc"];
const BOX_VISUALS: &[&str] = &["box", "violin", "xbar"];

// ------------------------------------------------------------------ Python の字の扱い
fn s_or(v: Option<&Value>) -> String {
    match v {
        Some(x) if json_truthy(x) => json_str(x),
        _ => String::new(),
    }
}
fn cut(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
fn strip(s: &str) -> String {
    pyfmt::strip(s).to_string()
}
fn arr(v: Option<&Value>) -> &[Value] {
    v.and_then(Value::as_array).map(|a| a.as_slice()).unwrap_or(&[])
}

// ------------------------------------------------------------------ 確かめ（services/dashboard.py）

fn names(v: Option<&Value>, n: usize) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for x in arr(v).iter().take(n) {
        let t = cut(&strip(&s_or(Some(x))), 120);
        if !t.is_empty() && !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

pub(crate) fn is_screen_source(s: &str) -> bool {
    s == "lot"
        || s == "work"
        || s.strip_prefix("src:")
            .is_some_and(|k| (1..=16).contains(&k.len()) && k.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// 画面から来たパネル → 数える形。確かめは保存の道と同じ 1 か所（layout_clean::clean_panel。Python も services/dashboard.py の
/// clean_panel を問い合わせと保存の両方で使う。版 3.83.0 で 1 つにした）。Err(None) は窓が Python と同じに読めない形（Python に任せる）
fn clean_panel(p: &Tree) -> Result<Map<String, Value>, Option<String>> {
    match layout_clean::clean_panel(p, 0, layout_clean::ROWS_MAX) {
        Ok(mut m) => {
            keep_calc_order(&mut m, p);
            Ok(m)
        }
        Err(Stop::Layout(e)) => Err(Some(e)),
        Err(Stop::Py) => Err(None),
    }
}

/// 確かめた計算列（calc）を、送られた字（送った順）に替える（版 3.83.0 の作った後の採点で直した）。確かめの答えは serde の値で鍵が字の順に
/// 並び直るが、Python は送った順の dict のまま使う: 同じ表示名を 2 つの列に付けたときの後勝ち（names）・設備の式と共通の式を合わせた
/// 先頭 40 個（calc_for）が順に効く。formula::clean_calc は送った順のまま同じ確かめ（数と長さの上限・空白）をするので、字を渡す。
/// 置き場はパネル・合わせるデータ（link.sides）・合わせた表のまとまり（groups）。確かめは並びを落とさないので、番目は送った物と同じ
fn keep_calc_order(m: &mut Map<String, Value>, raw: &Tree) {
    fn put(slot: Option<&mut Value>, raw: Option<&Tree>) {
        if let (Some(slot @ Value::Object(_)), Some(t @ Tree::Obj(_))) = (slot, raw) {
            *slot = Value::String(t.dumps(", ", ": "));
        }
    }
    let items = |t: Option<&Tree>| match t {
        Some(Tree::Arr(a)) => a.clone(),
        _ => vec![],
    };
    put(m.get_mut("calc"), raw.get("calc"));
    let sides = items(raw.get("link").and_then(|l| l.get("sides")));
    if let Some(Value::Array(xs)) = m.get_mut("link").and_then(|l| l.get_mut("sides")) {
        for (x, r) in xs.iter_mut().zip(&sides) {
            put(x.get_mut("calc"), r.get("calc"));
        }
    }
    let groups = items(raw.get("groups"));
    if let Some(Value::Array(xs)) = m.get_mut("groups") {
        for (x, r) in xs.iter_mut().zip(&groups) {
            put(x.get_mut("calc"), r.get("calc"));
        }
    }
}

/// 計算列の値（送った順の字か、表）→ 計算列
fn calc_of(v: &Value) -> Option<Calc> {
    match v {
        Value::String(t) => formula::clean_calc(t),
        other => formula::clean_calc(&other.to_string()),
    }
}

// ------------------------------------------------------------------ 稼働・ABC 分析の線（確かめた後の ops を読む。確かめは layout_clean の clean_ops）
const ABC_A: f64 = 70.0;
const ABC_B: f64 = 90.0;
const ABC_LIMS_MAX: usize = 50;

/// Python の _float（読めない・NaN・無限は None）
fn float_of(v: &Value) -> Option<f64> {
    let f = match v {
        Value::Bool(b) => *b as i64 as f64,
        Value::Number(n) => n.as_f64()?,
        Value::String(t) => pyfmt::py_float(t).ok()?,
        _ => return None,
    };
    f.is_finite().then_some(f)
}

/// ABC の線（Python の abc_lims）
fn abc_lims(v: &Map<String, Value>) -> Vec<f64> {
    let raw: Vec<Value> = match v.get("lims") {
        Some(Value::Array(a)) => a.clone(),
        _ => vec![v.get("a").cloned().unwrap_or(json!(ABC_A)), v.get("b").cloned().unwrap_or(json!(ABC_B))],
    };
    let mut xs: Vec<f64> = raw.iter().filter_map(float_of).filter(|x| *x > 0.0).map(|x| aggregate::py_round(x.min(100.0), 4)).collect();
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    xs.dedup();
    xs.truncate(ABC_LIMS_MAX);
    if xs.is_empty() {
        vec![ABC_A, ABC_B]
    } else {
        xs
    }
}

// ------------------------------------------------------------------ 材料（一覧の設定の答えの dash）
struct Dash<'a> {
    conf: &'a Conf<'a>,
}

impl Dash<'_> {
    fn names(&self) -> Vec<String> {
        arr(self.conf.v["dash"].get("equipNames")).iter().map(json_str).collect()
    }
    fn groups(&self) -> &[Value] {
        arr(self.conf.v["dash"].get("equipGroups"))
    }
    /// まとめ方 set のグループ（Python の equip_groups.groups_for）
    fn groups_for(&self, set: &str) -> Vec<Value> {
        let key = normalize_part(set);
        self.groups()
            .iter()
            .filter(|g| normalize_part(&s_or(g.get("set"))) == key)
            .map(|g| {
                let mut x = json!({"name": g["name"], "members": g["equipment"]});
                if arr(g.get("rules")).iter().next().is_some() {
                    x["rules"] = g["rules"].clone();
                    x["except"] = g["except"].clone();
                }
                x
            })
            .collect()
    }
    /// まとめ方の並び（Python の equip_groups.sets）→ [(名前, [グループ])]
    fn sets(&self) -> Vec<(String, Vec<&Value>)> {
        let mut out: Vec<(String, Vec<&Value>)> = vec![];
        for g in self.groups() {
            let s = s_or(g.get("set"));
            match out.iter_mut().find(|(n, _)| *n == s) {
                Some((_, v)) => v.push(g),
                None => out.push((s, vec![g])),
            }
        }
        out
    }
    fn source(&self, key: &str) -> Option<&Value> {
        self.conf.source(key)
    }
}

/// グループに入る設備（Python の equip_groups.members_in）
pub(crate) fn members_in(g: &Value, names: &[String]) -> Vec<String> {
    let test = pivot::compile_rules(g.get("rules"));
    let ex: Vec<String> = arr(g.get("except")).iter().map(|x| normalize_part(&json_str(x))).collect();
    let mine: Vec<String> = arr(g.get("equipment")).iter().map(|x| normalize_part(&json_str(x))).collect();
    names
        .iter()
        .filter(|n| {
            let k = normalize_part(n);
            mine.contains(&k) || (!ex.contains(&k) && pivot::rules_hit(&test, &k))
        })
        .cloned()
        .collect()
}

// ------------------------------------------------------------------ 数える
/// 答えの控え（Python の DASH_CACHE と同じ: 同じ組み・同じ写し・同じ「今日」なら前の答え。古い物から捨てる）
#[derive(Default)]
pub struct Cache {
    at: HashMap<String, Value>,
    order: VecDeque<String>,
}

impl Cache {
    fn get(&mut self, k: &str) -> Option<Value> {
        let v = self.at.get(k).cloned()?;
        self.order.retain(|x| x != k);
        self.order.push_back(k.to_string());
        Some(v)
    }
    fn put(&mut self, k: String, v: Value) {
        self.order.retain(|x| *x != k);
        self.order.push_back(k.clone());
        self.at.insert(k, v);
        while self.order.len() > CACHE_MAX {
            if let Some(old) = self.order.pop_front() {
                self.at.remove(&old);
            }
        }
    }
}

/// 窓が答える係の持ち物（数えるたびに使う）
pub struct Ctx<'a> {
    pub lists: &'a Lists,
    pub conf: &'a Conf<'a>,
    pub q: &'a Quality<'a>,
    pub now: NaiveDateTime,
    pub conv: &'a Arc<Tables>,
    pub cache: &'a Mutex<Cache>,
}

/// 段取りの失敗（Python の _fail）→ {error, kind, status}
fn fail_of((status, v): &(u16, Value)) -> Value {
    let e = v.get("error").and_then(Value::as_str).filter(|e| !e.is_empty()).unwrap_or("読めませんでした。");
    let k = v.get("kind").and_then(Value::as_str).filter(|k| !k.is_empty()).unwrap_or("error");
    json!({"error": e, "kind": k, "status": status})
}

struct Parts {
    parts: Vec<Part>,
    failed: Vec<Value>,
    name: String,
    mirrors: Vec<Value>,
    /// 写している設備ごとの途中の様子（まだ写し始めていない設備は None。版 3.97.0）
    copying: Vec<Option<crate::mirror::CopyProgress>>,
}

/// 段取りの答え: Ok(Some) 数える物・Ok(None) Python へ回す（スケジュールを窓が答えない形）・Err 失敗の答え
type Planned = Result<Option<Parts>, Value>;

impl Ctx<'_> {
    fn dash(&self) -> Dash<'_> {
        Dash { conf: self.conf }
    }

    fn equip_of(&self, def: Option<&Value>) -> Option<Equip> {
        let def = def?;
        let col = s_or(def.get("equipColumn"));
        if col.is_empty() {
            return None;
        }
        Some(Equip::Column(col, EquipMatcher::new(&self.dash().names(), &s_or(def.get("equipMode")))))
    }

    fn part(
        &self,
        plan: &Plan,
        candidates: &'static [&'static str],
        work: Option<Work>,
        equip: Option<Equip>,
        name: &str,
        lot: Option<String>,
    ) -> Part {
        Part {
            path: plan.path.clone().unwrap_or_default(),
            table: String::new(),
            preferred_table: plan.table.clone(),
            candidates,
            work,
            equip,
            name: name.into(),
            lot_col: lot.filter(|l| !l.is_empty()),
        }
    }

    /// パネルのデータ → 数えるファイルの並び（Python の panel_parts）
    fn panel_parts(&self, source: &str, equip: &str, basis: &str, equips: &[String]) -> Planned {
        self.panel_parts_wait(source, equip, basis, equips, FIRST_WAIT).map_err(|(v, _)| v)
    }

    /// 組む所の読み（版 3.99.0。src/builder.rs）: パネルのデータ → (数えるファイル, 読めなかった設備, データの名前)。
    /// 作業実績の最初の写しを wait まで待つ（札・当てる列は Python の db_mirror.FIRST_WAIT_SEC と同じ 30 秒。パネルの数は 2 秒）。
    /// Ok(None) は Python に任せる形（スケジュールを窓が答えない）・Err は失敗の答え {error, kind, status}
    /// Err は段取りの失敗の答えそのもの（状態・本文。Python の _Fail の resp）
    #[allow(clippy::type_complexity)]
    pub(crate) fn parts_for(
        &self,
        source: &str,
        equip: &str,
        equips: &[String],
        wait: Duration,
    ) -> Result<Option<(Vec<Part>, Vec<Value>, String)>, (u16, Value)> {
        Ok(self.panel_parts_wait(source, equip, "work", equips, wait).map_err(|(_, raw)| raw)?.map(|p| (p.parts, p.failed, p.name)))
    }

    /// 設備グループのまとめ方の名前（Python の equip_groups.sets の name）
    pub(crate) fn set_names(&self) -> Vec<String> {
        self.dash().sets().into_iter().map(|(n, _)| n).collect()
    }

    /// パネルのデータの名前（Python の source_items: データ元の並び。作業実績・品質はそのキー・ほかは src:キー）
    pub(crate) fn source_keys(&self) -> Vec<(String, Value)> {
        arr(self.conf.v.get("sources"))
            .iter()
            .map(|d| {
                let k = s_or(d.get("key"));
                (if k == "lot" || k == "work" { k } else { format!("src:{k}") }, d.get("name").cloned().unwrap_or(Value::Null))
            })
            .collect()
    }

    /// panel_parts の本体。Err は (パネルの中に出す失敗 {error, kind, status}, 段取りの失敗の答えそのもの)
    fn panel_parts_wait(
        &self,
        source: &str,
        equip: &str,
        basis: &str,
        equips: &[String],
        wait: Duration,
    ) -> Result<Option<Parts>, (Value, (u16, Value))> {
        let (lists, conf, q) = (self.lists, self.conf, self.q);
        let def_of = |k: &str| self.dash().source(k).cloned();
        if source == "work" {
            let pick: Vec<String> = equips.iter().map(|x| normalize_part(x)).collect();
            let wl = conf.work();
            let mut all: Vec<&Value> = arr(wl.get("rows")).iter().collect();
            // 並びは Python の int と同じく大きな数も桁で比べる（版 3.104.0 の作った後の採点: 前は i64 の端へ丸め、端を超える 2 行の順が変わった）
            let num = |r: &Value| pyfmt::py_int(&strip(&s_or(r.get("並び")))).ok();
            let mut idx: Vec<usize> = (0..all.len()).collect();
            idx.sort_by_cached_key(|&i| (num(all[i]).is_none(), num(all[i]).unwrap_or(pyfmt::PyInt::Small(0)), i));
            all = idx.into_iter().map(|i| all[i]).collect();
            let rows: Vec<&Value> = all
                .into_iter()
                .filter(|r| {
                    let v = s_or(r.get("表示"));
                    v != "無"
                })
                .filter(|r| equip.is_empty() || r["キー"] == equip)
                .filter(|r| pick.is_empty() || pick.contains(&normalize_part(&s_or(r.get("設備名")))))
                .collect();
            if rows.is_empty() {
                let e = "数える設備がありません（「マスタ管理」の「データ元」の「実績」で表示する設備を決めてください）。";
                return Err((json!({"error": e, "kind": "unknown", "status": 404}), (404, json!({"error": e, "kind": "unknown"}))));
            }
            let work_def = def_of("work");
            let lot = work_def.as_ref().map(|d| s_or(d.get("lotSet")));
            // 全部の設備の写しを一度に始めて、まとめて待つ（Python の start_mirrors）
            let mut keys = vec![];
            for r in &rows {
                let key = s_or(r.get("キー"));
                match lists.work_plan_wait(conf, q, &key, true, false, false) {
                    Ok(_) => keys.push(key),
                    Err((_, v)) if v["kind"] == "copying" => keys.push(key),
                    Err(_) => {}
                }
            }
            // 共有から写した設備 n / 設備 of（最初の写しを待つ間。版 3.97.0）
            let ready = |keys: &[String]| keys.iter().filter(|k| lists.work.peek(k).is_some_and(|m| m.first_done())).count();
            crate::progress::step("copy", ready(&keys), keys.len());
            // 待つ間も間をおいて数え直す（版 3.99.0。パネルの 2 秒の待ちも札の 30 秒の待ちも同じ部品）
            lists.work.wait_first_tick(&keys, wait, &|| crate::progress::step("copy", ready(&keys), keys.len()));
            crate::progress::step("copy", ready(&keys), keys.len());
            let shifts = conf.shifts();
            let (mut parts, mut failed, mut mirrors) = (Vec::<Part>::new(), Vec::<Value>::new(), Vec::<Value>::new());
            let mut copying = vec![];
            let mut first: Option<(Value, String, (u16, Value))> = None; // 1 つも読めないときの答え（写し中を先に選ぶ）
            for r in &rows {
                let name = s_or(r.get("設備名"));
                match lists.work_plan_wait(conf, q, &s_or(r.get("キー")), true, true, false) {
                    Err(f) => {
                        let fv = fail_of(&f);
                        let kind = fv["kind"].as_str().unwrap_or("").to_string();
                        if kind == "copying" {
                            copying.push(lists.work.peek(&s_or(r.get("キー"))).and_then(|m| m.copy_progress()));
                        }
                        let mut x = json!({"name": name});
                        x.as_object_mut().unwrap().extend(fv.as_object().unwrap().clone());
                        failed.push(x);
                        if !first.as_ref().is_some_and(|(_, k, _)| k == "copying") {
                            first = Some((fv, kind, f));
                        }
                    }
                    Ok(plan) => {
                        let pat = worksum::pattern_for(&shifts, &name);
                        let work = Work {
                            clock: Clock::new(pat.map(|p| p.segments).unwrap_or_default()),
                            basis: basis.into(),
                            start: String::new(),
                        };
                        parts.push(self.part(&plan, WORK_TABLES, Some(work), Some(Equip::Name(name.clone())), &name, lot.clone()));
                        // 前の写しで数えた設備（最初の写し直しが済んでいない）: 写しの様子に印（Python と同じ。画面は引き直す）
                        let mut src = plan.source.clone();
                        if lists.work.peek(&s_or(r.get("キー"))).is_some_and(|m| !m.first_done()) {
                            src["refreshing"] = json!(true);
                        }
                        mirrors.push(src);
                    }
                }
            }
            let name = work_def.map(|d| s_or(d.get("name"))).unwrap_or_else(|| "作業実績".into());
            if parts.is_empty() {
                // 1 台も写し終えていない: 失敗の答えにも写しの様子（台・バイト・あと何秒）を付ける（版 3.97.0）
                let copying_now = first.as_ref().is_some_and(|(_, k, _)| k == "copying");
                let raw = first.as_ref().map(|(_, _, r)| r.clone()).unwrap_or((500, Value::Null));
                let mut f = first.map(|(f, _, _)| f).unwrap_or(Value::Null);
                if copying_now && f.is_object() {
                    if let Some(c) = copy_of(&Parts {
                        parts: vec![],
                        failed: failed.clone(),
                        name: name.clone(),
                        mirrors: mirrors.clone(),
                        copying: copying.clone(),
                    }) {
                        f["copy"] = c;
                    }
                }
                return Err((f, raw));
            }
            return Ok(Some(Parts { parts, failed, name, mirrors, copying }));
        }
        if source == "lot" {
            let plan = lists.lot_plan(conf, q, true).map_err(|f| (fail_of(&f), f))?;
            let d = def_of("lot");
            let named = d.as_ref().and_then(|d| d.get("name")).map(|n| s_or(Some(n)));
            let lot = d.as_ref().map(|d| s_or(d.get("lotSet")));
            let part = self.part(&plan, TABLE_CANDIDATES, None, self.equip_of(d.as_ref()), &named.clone().unwrap_or_default(), lot);
            return Ok(Some(Parts {
                copying: vec![],
                parts: vec![part],
                failed: vec![],
                name: named.unwrap_or_else(|| "品質データ".into()),
                mirrors: vec![plan.source],
            }));
        }
        let key = source.strip_prefix("src:").unwrap_or("");
        let plan = match lists.src_plan(conf, q, key, true, true) {
            Ok(None) => return Ok(None), // スケジュールを窓が答えない形（設定を組めない・係を降りた）は Python
            Ok(Some(p)) => p,
            Err(f) => return Err((fail_of(&f), f)),
        };
        let d = def_of(key);
        let name = d.as_ref().map(|d| s_or(d.get("name"))).unwrap_or_default();
        let lot = d.as_ref().map(|d| s_or(d.get("lotSet")));
        let part = self.part(&plan, TABLE_CANDIDATES, None, self.equip_of(d.as_ref()), &name, lot);
        Ok(Some(Parts { parts: vec![part], failed: vec![], name, mirrors: vec![plan.source], copying: vec![] }))
    }

    /// パネルの設備のまとめ → 数える形（Python の resolve_egroup）
    fn resolve_egroup(&self, p: &Map<String, Value>) -> Value {
        let Some(eg) = p.get("egroup").filter(|e| e.is_object()) else { return Value::Null };
        match eg["mode"].as_str().unwrap_or("") {
            "sum" => {
                json!({"groups": [{"name": eg["name"], "members": p.get("equips").cloned().unwrap_or(json!([]))}], "rest": "other", "other": eg["name"]})
            }
            mode => {
                let groups = if mode == "panel" { arr(eg.get("groups")).to_vec() } else { self.dash().groups_for(&s_or(eg.get("set"))) };
                if groups.is_empty() {
                    Value::Null
                } else {
                    json!({"groups": groups, "rest": eg["rest"]})
                }
            }
        }
    }

    /// 設備グループの段のまとめ方 → グループ（Python の _group_sets）
    fn group_sets(&self, p: &Map<String, Value>) -> Value {
        let b = &p["body"];
        let mut names: Vec<String> = vec![];
        for d in arr(b.get("rows")).iter().chain(arr(b.get("cols"))) {
            if d["column"] == pivot::EGROUP_DIM {
                let n = s_or(d.get("part"));
                if !names.contains(&n) {
                    names.push(n);
                }
            }
        }
        if names.is_empty() {
            return Value::Null;
        }
        let mut out = Map::new();
        for n in names {
            let v = if n == pivot::PANEL_SET || n.is_empty() {
                let eg = p.get("egroup").cloned().unwrap_or(json!({}));
                if eg["mode"] == "panel" {
                    json!(arr(eg.get("groups"))
                        .iter()
                        .map(|g| json!({"name": g["name"], "members": g.get("members").cloned().unwrap_or(json!([]))}))
                        .collect::<Vec<_>>())
                } else {
                    json!([])
                }
            } else {
                json!(self.dash().groups_for(&n))
            };
            out.insert(n, v);
        }
        Value::Object(out)
    }

    fn box_column(p: &Map<String, Value>) -> String {
        if !BOX_VISUALS.contains(&p["visual"].as_str().unwrap_or("")) {
            return String::new();
        }
        arr(p["body"].get("measures"))
            .iter()
            .find(|m| m.get("column").and_then(Value::as_str).is_some_and(|c| !c.is_empty()) && m["agg"] != "distinct")
            .map(|m| s_or(m.get("column")))
            .unwrap_or_default()
    }

    fn stamp(&self) -> String {
        self.now.format("%Y-%m-%d %H:%M:%S").to_string()
    }

    /// 1 つの組みの数 → 答え（Python の _answer）。Ok(None) は Python へ回す
    fn answer(&self, p: &Map<String, Value>) -> Option<Value> {
        let s = |k: &str| s_or(p.get(k));
        let equips = names(p.get("equips"), MAX_EQUIPS);
        let got = match self.panel_parts(&s("source"), &s("equip"), &s("basis"), &equips) {
            Ok(None) => return None,
            Ok(Some(x)) => x,
            Err(f) => return Some(f),
        };
        let egroups = self.resolve_egroup(p);
        let sets = self.group_sets(p);
        let stamp = self.stamp();
        let days: Vec<String> =
            got.parts.iter().map(|x| x.work.as_ref().map(|w| w.clock.place(&stamp, &w.basis).0).unwrap_or_default()).collect();
        let sig = file_sigs(&got.parts);
        let failed_names: Vec<Value> = got.failed.iter().map(|f| f["name"].clone()).collect();
        let key = json!([p, egroups, sets, sig, days, self.now.date().to_string(), failed_names]).to_string();
        let hit = self.cache.lock().unwrap().get(&key);
        let hit = match hit {
            Some(h) => h,
            None => {
                crate::progress::counted();
                let h = self.count(p, got.parts.clone(), &egroups, &sets);
                if h.get("error").is_some() {
                    return Some(h);
                }
                self.cache.lock().unwrap().put(key, h.clone());
                h
            }
        };
        let eg = p.get("egroup");
        let note = if eg.is_some_and(|e| e["mode"] == "master") && egroups.is_null() {
            format!(
                "設備のまとめのマスタ「{}」にグループがありません（マスタ管理の「設備グループ」）。",
                s_or(eg.and_then(|e| e.get("set")))
            )
        } else {
            String::new()
        };
        let mut out = with_eorder(hit, p);
        out["sourceName"] = json!(got.name);
        out["mirrors"] = json!(got.mirrors);
        out["failed"] = json!(got.failed);
        if let Some(c) = copy_of(&got) {
            out["copy"] = c;
        }
        out["now"] = json!(stamp);
        if !note.is_empty() {
            let old = s_or(out.get("note"));
            out["note"] = json!([old, note].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join(" "));
        }
        Some(out)
    }

    /// 数える（Python の _count）。数えられなければ {error, kind, status}
    fn count(&self, p: &Map<String, Value>, parts: Vec<Part>, egroups: &Value, sets: &Value) -> Value {
        let b = &p["body"];
        let (rows, cols, measures) = (b["rows"].to_string(), b["cols"].to_string(), b["measures"].to_string());
        let (search, filters) = (s_or(p.get("search")), p.get("filters").cloned().unwrap_or(json!([])).to_string());
        let calc = p.get("calc").and_then(calc_of);
        let equips = names(p.get("equips"), MAX_EQUIPS);
        let bx = Self::box_column(p);
        let period = p.get("period").filter(|x| !x.is_null());
        let ask = Ask {
            search: &search,
            filters: &filters,
            rows: &rows,
            cols: &cols,
            measures: &measures,
            today: self.now.date(),
            month: "",
            box_col: &bx,
            period,
            now: self.now,
            calc: calc.as_ref(),
            conv: self.conv,
            equips: &equips,
            egroups: Some(egroups).filter(|e| !e.is_null()),
            sets: Some(sets).filter(|e| !e.is_null()),
            bases: b.get("bases").filter(|x| !x.is_null()),
        };
        match pivot::query_many(parts, &ask) {
            Ok(v) => v,
            Err(PFail::Invalid(e)) => json!({"error": e, "kind": "invalid", "status": 400}),
            Err(PFail::Down(e)) => json!({"error": e, "kind": "error", "status": 503}),
        }
    }

    fn equip_ok(&self, source: &str) -> bool {
        if source == "work" {
            return true;
        }
        let key = if source == "lot" { "lot" } else { source.strip_prefix("src:").unwrap_or("") };
        self.dash().source(key).is_some_and(|d| !s_or(d.get("equipColumn")).is_empty())
    }

    /// 設備の分け方を当てて数える（Python の _split_answer）
    fn split_answer(&self, p: &Map<String, Value>) -> Option<Value> {
        let mut sp = if self.equip_ok(&s_or(p.get("source"))) { split_of(p) } else { String::new() };
        let b = p["body"].clone();
        let nrows = arr(b.get("rows")).len();
        let ncols = arr(b.get("cols")).len();
        if sp == "series" && (p["visual"] == "kpi" || ncols >= pivot::MAX_DIMS) {
            sp = "facet".into();
        }
        let eqd = json!({"column": pivot::EQUIP_DIM, "part": ""});
        let with_body = |body: Value| {
            let mut q = p.clone();
            q.insert("body".into(), body);
            q
        };
        if sp == "series" {
            let mut body = b.clone();
            body["cols"] = json!(std::iter::once(eqd).chain(arr(b.get("cols")).iter().cloned()).collect::<Vec<_>>());
            let mut a = self.answer(&with_body(body))?;
            if a.get("cells").is_some() {
                a["esplit"] = json!("series");
            }
            return Some(a);
        }
        if sp != "facet" || nrows >= pivot::MAX_DIMS {
            let mut a = self.answer(p)?;
            let eg_sum = p.get("egroup").is_some_and(|e| e["mode"] == "sum");
            let told = sp == "sum" && (p.get("esplit").is_some_and(json_truthy) || names(p.get("equips"), MAX_EQUIPS).len() >= 2 || eg_sum);
            if a.get("cells").is_some() && told {
                a["esplit"] = json!(sp);
            }
            return Some(a);
        }
        let ms: Vec<Value> = arr(b.get("measures")).to_vec();
        let mut body = b.clone();
        body["rows"] = json!(std::iter::once(eqd).chain(arr(b.get("rows")).iter().cloned()).collect::<Vec<_>>());
        body["measures"] = json!(ms
            .iter()
            .map(|m| {
                let mut m = m.clone();
                m.as_object_mut().unwrap().remove("show");
                m
            })
            .collect::<Vec<_>>());
        let mut a = self.answer(&with_body(body))?;
        if a.get("cells").is_none() {
            return Some(a);
        }
        let f = facets_of(&a, &ms);
        a["esplit"] = json!("facet");
        a["facets"] = json!(f);
        Some(a)
    }

    /// 別のデータを合わせる（Python の _link_answer）
    fn link_answer(&self, p: &Map<String, Value>) -> Option<Value> {
        let link = &p["link"];
        let sides = arr(link.get("sides"));
        let mut answers = vec![];
        for i in 0..sides.len() {
            crate::progress::group(i, sides.len()); // 合わせるデータ i / n 済み（版 3.97.0）
            answers.push(self.answer(&side_query(link, i, p))?);
        }
        crate::progress::group(sides.len(), sides.len());
        if answers.iter().all(|a| a.get("cells").is_none()) {
            return Some(answers.swap_remove(0));
        }
        let mut keys: HashMap<String, HashMap<usize, Value>> = HashMap::new();
        let mut labels = Map::new();
        let mut first: Vec<String> = vec![];
        for (i, a) in answers.iter().enumerate() {
            if a.get("cells").is_none() {
                continue;
            }
            for k in arr(a["orders"].get(0)) {
                let k = json_str(k);
                if k.is_empty() {
                    continue;
                }
                let ck = link_key(&k);
                if !keys.contains_key(&ck) {
                    keys.insert(ck.clone(), HashMap::new());
                    labels.insert(ck.clone(), a["labels"][0].get(&k).cloned().unwrap_or(json!(k)));
                    first.push(ck.clone());
                }
                let v = arr(a.get("cells"))
                    .iter()
                    .find(|c| c["r"] == json!([k]) && arr(c.get("c")).is_empty())
                    .map(|c| c["v"][0].clone())
                    .unwrap_or(Value::Null);
                keys.get_mut(&ck).unwrap().insert(i, v);
            }
        }
        let is_day = |k: &str| {
            let b = k.as_bytes();
            let d4 = b.len() >= 4 && b[..4].iter().all(u8::is_ascii_digit);
            let rest = &b[4.min(b.len())..];
            d4 && (rest.is_empty()
                || (rest.len().is_multiple_of(3)
                    && rest.len() <= 6
                    && rest.chunks(3).all(|c| c[0] == b'-' && c[1].is_ascii_digit() && c[2].is_ascii_digit())))
        };
        let mut order = first.clone();
        if !first.is_empty() && first.iter().all(|k| is_day(k)) {
            order.sort();
        }
        let mut vals: HashMap<String, Vec<Value>> = order
            .iter()
            .map(|k| (k.clone(), (0..sides.len()).map(|i| keys[k].get(&i).cloned().unwrap_or(Value::Null)).collect()))
            .collect();
        let num = |v: &Value| match v {
            Value::Number(n) => Some(n.as_i64().map(N::I).unwrap_or_else(|| N::F(n.as_f64().unwrap_or(0.0)))),
            _ => None,
        };
        let mut grand: Vec<Value> = vec![];
        for (i, x) in sides.iter().enumerate() {
            if x["build"] == "cum" {
                let mut run = N::I(0);
                for k in &order {
                    if let Some(v) = num(&vals[k][i]) {
                        run = add(run, v);
                    }
                    vals.get_mut(k).unwrap()[i] = run.json();
                }
                grand.push(if order.is_empty() { Value::Null } else { run.json() });
            } else {
                grand.push(
                    arr(answers[i].get("cells"))
                        .iter()
                        .find(|c| arr(c.get("r")).is_empty() && arr(c.get("c")).is_empty())
                        .map(|c| c["v"][0].clone())
                        .unwrap_or(Value::Null),
                );
            }
        }
        let ti = sides.iter().position(|x| x["role"] == "target");
        let ai = sides.iter().position(|x| x["role"] == "actual");
        let extra: Vec<String> = if ti.is_some() && ai.is_some() { arr(link.get("extra")).iter().map(json_str).collect() } else { vec![] };
        let extras = |v: &[Value]| -> Vec<Value> {
            let (t, r) = (ti.and_then(|i| num(&v[i])), ai.and_then(|i| num(&v[i])));
            extra
                .iter()
                .map(|e| match (t, r) {
                    (Some(t), Some(r)) if e == "diff" => sub(r, t).json(),
                    (Some(t), Some(r)) if t.f() != 0.0 => json!(aggregate::py_round(r.f() / t.f() * 100.0, 4)),
                    _ => Value::Null,
                })
                .collect()
        };
        let role_name = |r: &str| match r {
            "target" => "目標",
            "actual" => "実績",
            _ => "",
        };
        let mut names_: Vec<String> = vec![];
        for (i, x) in sides.iter().enumerate() {
            let title = s_or(x.get("title"));
            let base = if title.is_empty() {
                format!("{}の{}", s_or(answers[i].get("sourceName")), aggregate_name(&x["measure"], &s_or(x.get("source"))))
            } else {
                title
            };
            let role = s_or(x.get("role"));
            names_.push(if role.is_empty() { base } else { format!("{}：{base}", role_name(&role)) });
        }
        let mut ms: Vec<Value> = sides
            .iter()
            .enumerate()
            .map(|(i, x)| {
                let mut m = x["measure"].clone();
                m["name"] = json!(format!("{}{}", names_[i], if x["build"] == "cum" { "（積み上げ）" } else { "" }));
                m["role"] = x["role"].clone();
                m["side"] = json!(i);
                m
            })
            .collect();
        for e in &extra {
            ms.push(json!({"agg": "sum", "name": if e == "diff" { "差（実績−目標）" } else { "達成率（実績÷目標 %）" }, "role": e}));
        }
        let mut cells: Vec<Value> = order
            .iter()
            .map(|k| {
                let v = &vals[k];
                json!({"r": [k], "c": [], "v": v.iter().cloned().chain(extras(v)).collect::<Vec<_>>()})
            })
            .collect();
        cells.push(json!({"r": [], "c": [], "v": grand.iter().cloned().chain(extras(&grand)).collect::<Vec<_>>()}));
        let ok: Vec<&Value> = answers.iter().filter(|a| a.get("cells").is_some()).collect();
        let note: Vec<String> = answers
            .iter()
            .enumerate()
            .filter(|(_, a)| a.get("cells").is_none())
            .map(|(i, a)| format!("{}: {}", names_[i], s_or(a.get("error"))))
            .collect();
        let notes: Vec<String> =
            std::iter::once(note.join("　")).chain(ok.iter().map(|a| s_or(a.get("note")))).filter(|x| !x.is_empty()).collect();
        let uniq = |it: Vec<String>| -> Vec<String> {
            let mut out: Vec<String> = vec![];
            for x in it {
                if !out.contains(&x) {
                    out.push(x);
                }
            }
            out
        };
        let key0 = sides[0]["key"].clone();
        let mut row0 = key0.clone();
        row0["name"] =
            json!(uniq(sides.iter().map(|x| pivot::dim_name_of(&s_or(x["key"].get("column")), &s_or(x["key"].get("part")))).collect())
                .join("・"));
        let mut ignored: Vec<String> = ok.iter().flat_map(|a| arr(a.get("ignoredFilters")).iter().map(json_str)).collect();
        ignored.sort();
        ignored.dedup();
        let link_sides: Vec<Value> = sides
            .iter()
            .enumerate()
            .map(|(i, x)| {
                let mut v = json!({"role": x["role"], "build": x["build"], "name": names_[i], "sourceName": s_or(answers[i].get("sourceName")),
                                   "keyName": pivot::dim_name_of(&s_or(x["key"].get("column")), &s_or(x["key"].get("part")))});
                if answers[i].get("cells").is_none() {
                    v["error"] = answers[i]["error"].clone();
                }
                v
            })
            .collect();
        let copy = first_copy(&answers);
        let mut out = json!({
            "table": "", "count": ok.iter().map(|a| a["count"].as_i64().unwrap_or(0)).sum::<i64>(), "lotsBy": "", "start": "", "bins": [], "stats": {},
            "box": "", "boxes": [], "dims": {"rows": [row0], "cols": []}, "measures": ms, "orders": [order], "labels": [labels], "cells": cells,
            "truncated": {"rows": false, "cols": false}, "months": [], "month": "", "ignoredFilters": ignored,
            "equipIgnored": ok.iter().any(|a| a["equipIgnored"] == true), "note": notes.join(" "),
            "sourceName": uniq(ok.iter().map(|a| s_or(a.get("sourceName"))).collect()).join("・"),
            "mirrors": ok.iter().flat_map(|a| arr(a.get("mirrors")).to_vec()).collect::<Vec<_>>(),
            "failed": ok.iter().flat_map(|a| arr(a.get("failed")).to_vec()).collect::<Vec<_>>(), "now": self.stamp(),
            "link": {"sides": link_sides},
        });
        if let Some(c) = copy {
            out["copy"] = c;
        }
        Some(out)
    }

    /// 設備グループのまとめ方ごとに、names の設備がどのグループに入るか（Python の equip_tree）
    fn equip_tree(&self, names: &[String], set_name: &str) -> Vec<Value> {
        self.dash()
            .sets()
            .into_iter()
            .filter(|(n, _)| set_name.is_empty() || n == set_name)
            .map(|(n, gs)| json!({"name": n, "groups": gs.iter().map(|g| json!({"name": g["name"], "members": members_in(g, names)})).collect::<Vec<_>>()}))
            .collect()
    }
}

fn add(a: N, b: N) -> N {
    match (a, b) {
        (N::I(x), N::I(y)) => x.checked_add(y).map(N::I).unwrap_or(N::F(x as f64 + y as f64)),
        (x, y) => N::F(x.f() + y.f()),
    }
}
fn sub(a: N, b: N) -> N {
    match (a, b) {
        (N::I(x), N::I(y)) => x.checked_sub(y).map(N::I).unwrap_or(N::F(x as f64 - y as f64)),
        (x, y) => N::F(x.f() - y.f()),
    }
}

/// 軸の鍵 → そろえる鍵（Python の _link_key）
fn link_key(k: &str) -> String {
    let k = k.strip_prefix(['$', '#']).unwrap_or(k);
    normalize_part(k)
}

/// 値の名前（ロット数は作業実績なら実績本数。Python の aggregate_name）
fn aggregate_name(m: &Value, source: &str) -> String {
    if m["agg"] == "lots" {
        return if source == "work" { "実績本数" } else { "ロット数" }.into();
    }
    m.as_object().map(aggregate::name).unwrap_or_default()
}

/// パネルの設備の分け方（Python の split_of）
fn split_of(p: &Map<String, Value>) -> String {
    let b = &p["body"];
    if p.get("link").is_some()
        || arr(b.get("rows")).iter().chain(arr(b.get("cols"))).any(|d| d["column"] == pivot::EQUIP_DIM || d["column"] == pivot::EGROUP_DIM)
    {
        return String::new();
    }
    let mode = p.get("egroup").map(|e| s_or(e.get("mode"))).unwrap_or_default();
    if mode == "sum" {
        return "sum".into();
    }
    let want = s_or(p.get("esplit"));
    if !want.is_empty() {
        return want;
    }
    if names(p.get("equips"), MAX_EQUIPS).len() >= 2 || mode == "panel" || mode == "master" {
        "series".into()
    } else {
        "sum".into()
    }
}

/// 合わせるデータ i → ふつうのパネルと同じ形（Python の side_query）
fn side_query(link: &Value, i: usize, panel: &Map<String, Value>) -> Map<String, Value> {
    let x = &link["sides"][i];
    let mut out = Map::new();
    for k in ["source", "equip", "search", "period", "basis"] {
        if let Some(v) = x.get(k) {
            out.insert(k.into(), v.clone());
        }
    }
    if x.get("calc").is_some_and(json_truthy) {
        out.insert("calc".into(), x["calc"].clone());
    }
    let pe = panel.get("equips").filter(|e| json_truthy(e));
    if let Some(e) = pe.or_else(|| x.get("equips").filter(|e| json_truthy(e))) {
        out.insert("equips".into(), e.clone());
    }
    out.insert("filters".into(), json!(arr(x.get("filters")).iter().chain(arr(panel.get("filters"))).cloned().collect::<Vec<_>>()));
    out.insert("visual".into(), json!("none"));
    out.insert("body".into(), json!({"rows": [x["key"]], "cols": [], "measures": [x["measure"]]}));
    out
}

/// 合わせた表の列のまとまり i → ふつうのパネルと同じ形（Python の board_query）
fn board_query(board: &Map<String, Value>, i: usize) -> Map<String, Value> {
    let g = &board["groups"][i];
    let mut out = Map::new();
    for k in ["source", "equip", "search", "period", "basis"] {
        if let Some(v) = g.get(k) {
            out.insert(k.into(), v.clone());
        }
    }
    if g.get("calc").is_some_and(json_truthy) {
        out.insert("calc".into(), g["calc"].clone());
    }
    if g.get("equips").is_some_and(json_truthy) {
        out.insert("equips".into(), g["equips"].clone());
    }
    for k in ["equips", "egroup"] {
        if let Some(v) = board.get(k).filter(|v| json_truthy(v)) {
            out.insert(k.into(), v.clone());
        }
    }
    out.insert("filters".into(), json!(arr(g.get("filters")).iter().chain(arr(board.get("filters"))).cloned().collect::<Vec<_>>()));
    out.insert("visual".into(), json!("none"));
    out.insert("body".into(), json!({"rows": [board["rows"]], "cols": g["cols"], "measures": [g["measure"]], "sub": false, "grand": true}));
    out
}

/// 名前の並び → 手で並べた順（Python の order_names）
fn order_names(names: &[Value], eorder: &[String]) -> Vec<Value> {
    if eorder.is_empty() {
        return names.to_vec();
    }
    let at: HashMap<String, usize> = eorder.iter().enumerate().map(|(i, n)| (normalize_part(n), i)).collect();
    let mut v: Vec<(usize, &Value)> = names.iter().enumerate().collect();
    v.sort_by_key(|(_, n)| match at.get(&normalize_part(&json_str(n))) {
        Some(i) => (0, *i),
        None => (1, 0),
    });
    v.into_iter().map(|(_, n)| n.clone()).collect()
}

/// 設備の段の鍵の並びを、パネルの手で並べた順に（Python の with_eorder）
fn with_eorder(mut a: Value, p: &Map<String, Value>) -> Value {
    let eo = names(p.get("eorder"), MAX_EQUIPS);
    if eo.is_empty() || a.get("orders").is_none() {
        return a;
    }
    let dims: Vec<Value> = arr(a["dims"].get("rows")).iter().chain(arr(a["dims"].get("cols"))).cloned().collect();
    let orders: Vec<Value> =
        arr(a.get("orders"))
            .iter()
            .enumerate()
            .map(|(i, o)| {
                if dims.get(i).is_some_and(|d| d["column"] == pivot::EQUIP_DIM) {
                    json!(order_names(arr(Some(o)), &eo))
                } else {
                    o.clone()
                }
            })
            .collect();
    a["orders"] = json!(orders);
    a
}

/// 行の段の頭が設備の答え → 設備ごとの答え（Python の facets_of）
fn facets_of(a: &Value, measures: &[Value]) -> Vec<Value> {
    let nr = arr(a["dims"].get("rows")).len().saturating_sub(1);
    let orders = arr(a.get("orders"));
    let mut out = vec![];
    for k in arr(orders.first()).iter().filter(|x| *x != "").take(MAX_FACETS) {
        let mine: Vec<&Value> = arr(a.get("cells")).iter().filter(|c| arr(c.get("r")).first() == Some(k)).collect();
        let mut cells: Vec<aggregate::OutCell> = mine
            .iter()
            .map(|c| aggregate::OutCell {
                r: arr(c.get("r")).iter().skip(1).map(json_str).collect(),
                c: arr(c.get("c")).iter().map(json_str).collect(),
                v: arr(c.get("v"))
                    .iter()
                    .map(|v| match v {
                        Value::Number(n) => Some(n.as_i64().map(N::I).unwrap_or_else(|| N::F(n.as_f64().unwrap_or(0.0)))),
                        _ => None,
                    })
                    .collect(),
            })
            .collect();
        let sub_orders: Vec<Vec<String>> = orders
            .iter()
            .skip(1)
            .take(nr)
            .enumerate()
            .map(|(i, o)| arr(Some(o)).iter().map(json_str).filter(|x| cells.iter().any(|c| c.r.get(i) == Some(x))).collect())
            .chain(orders.iter().skip(nr + 1).map(|o| arr(Some(o)).iter().map(json_str).collect()))
            .collect();
        let ms: Vec<Map<String, Value>> = measures.iter().filter_map(|m| m.as_object().cloned()).collect();
        aggregate::apply_show(&mut cells, &ms, nr, &sub_orders);
        let mut sub = Map::new();
        for x in ["table", "lotsBy", "start", "bins", "stats", "box", "truncated", "months", "month", "shifts"] {
            if let Some(v) = a.get(x) {
                sub.insert(x.into(), v.clone());
            }
        }
        sub.insert(
            "dims".into(),
            json!({"rows": arr(a["dims"].get("rows")).iter().skip(1).cloned().collect::<Vec<_>>(), "cols": a["dims"]["cols"]}),
        );
        sub.insert(
            "measures".into(),
            json!(ms
                .iter()
                .map(|m| {
                    let mut x = m.clone();
                    x.insert("name".into(), json!(aggregate::name(m)));
                    Value::Object(x)
                })
                .collect::<Vec<_>>()),
        );
        sub.insert("orders".into(), json!(sub_orders));
        sub.insert("labels".into(), json!(arr(a.get("labels")).iter().skip(1).cloned().collect::<Vec<_>>()));
        sub.insert(
            "cells".into(),
            json!(cells
                .iter()
                .map(|c| json!({"r": c.r, "c": c.c, "v": c.v.iter().map(|v| v.map(N::json).unwrap_or(Value::Null)).collect::<Vec<_>>()}))
                .collect::<Vec<_>>()),
        );
        sub.insert("count".into(), Value::Null);
        sub.insert(
            "boxes".into(),
            json!(arr(a.get("boxes"))
                .iter()
                .filter(|x| arr(x.get("r")).first() == Some(k))
                .map(|x| {
                    let mut x = x.clone();
                    x["r"] = json!(arr(x.get("r")).iter().skip(1).cloned().collect::<Vec<_>>());
                    x
                })
                .collect::<Vec<_>>()),
        );
        out.push(json!({"key": k, "name": a["labels"][0].get(json_str(k)).cloned().unwrap_or(k.clone()), "answer": sub}));
    }
    out
}

/// 本文の字 → 確かめに渡すパネル（Python の body = get_json(silent=True) or {}・body.get("panel") or {}）。中身は送った順の木で読む
/// （色・系列の先頭 40 個を残す所が送った順に効く）。None は窓が Python と同じに読めない本文（NaN・大きな数・入れ子の深い字・
/// 表でない真の本文〈Python は .get で落ちる〉）で、Python に任せる
fn panel_of(body: &[u8]) -> Option<Tree> {
    if crate::master_rows::unreadable(body) {
        return None;
    }
    let empty = Tree::Obj(vec![]);
    if body.iter().all(|b| b.is_ascii_whitespace()) {
        return Some(empty);
    }
    // J で読む（版 3.109.0。serde から直に読むと u64 を超える整数を小数に丸める。Tree::parse_bytes の 1 つ）
    let t: Tree = Tree::parse_bytes(body)?;
    match &t {
        Tree::Obj(_) => {}
        x if !layout_clean::truthy(x) => return Some(empty),
        _ => return None,
    }
    Some(t.get("panel").filter(|p| layout_clean::truthy(p)).cloned().unwrap_or(empty))
}

/// 1 枚のパネルの数（本文 {panel}。Python の dashboard_query）。None は Python へ回す（スケジュールを窓が答えない形・読めない本文）
/// GET /api/dashboard/sources（routes/dashboard.py の dashboard_sources・source_items）: パネルに使えるデータの並びと、作業実績の表示する設備・
/// 期間の種類・設備グループのまとめ方。材料は一覧の設定の答え（lists）。役割（role）の無い答え（前の版の Python）なら None（Python に任せる）
pub fn sources_answer(conf: &Conf, periods: &Value) -> Option<Value> {
    let work_rows = arr(conf.v["work"].get("rows"));
    let shown: Vec<&Value> = crate::bundle::work_order(
        work_rows.iter().filter(|r| r.get("表示").filter(|v| json_truthy(v)).map(json_str).as_deref() != Some("無")).collect(),
    )?;
    let mut items = vec![];
    for d in arr(conf.v.get("sources")) {
        let key = d["key"].as_str()?;
        let k = if key == "lot" || key == "work" { key.to_string() } else { format!("src:{key}") };
        let mut x = json!({"key": k, "name": d["name"], "role": d.get("role").filter(|r| crate::held::is_text(r))?.clone(),
                           "equip": json_truthy(&d["equipColumn"]) || key == "work", "place": json_truthy(&d["place"])});
        if key == "work" {
            x["equips"] = Value::Array(
                shown.iter().map(|r| json!({"key": r.get("キー").cloned().unwrap_or(Value::Null), "name": r.get("設備名").cloned().unwrap_or(Value::Null)})).collect(),
            );
        }
        items.push(x);
    }
    let sets: Vec<Value> =
        Dash { conf }.sets().into_iter().map(|(n, gs)| json!({"name": n, "groups": gs.into_iter().cloned().collect::<Vec<_>>()})).collect();
    Some(json!({"items": items, "periods": periods, "egroupSets": sets}))
}

/// 実際に出てくる設備（Python の routes/dashboard.equipment_seen。版 3.94.0 から設備の木と設備グループの一覧の 1 か所）→
/// [{name, from: [どこで見たか], n: 件数（データ元の行の数）}]。known は先に並べる設備とその出どころ（作業実績の設備〈表示しない設備も〉→
/// 設備マスタ。出どころが空なら from に入れない）。続けて、データ元の設備の列の値から見分けた設備（ダッシュボードの「設備」と同じ見分け方・
/// 数え方）。名前は前後の空白を除き、同じ名前（NFKC・大文字）は最初の書き方に 1 つ。窓が数えられない元（スケジュールを窓が答えない形）があれば None
pub fn equipment_seen(cx: &Ctx, known: &[(String, &str)]) -> Option<Vec<Value>> {
    let mut seen: Vec<(String, String, Vec<String>, Value)> = vec![]; // (鍵, 名前, 出どころ, 件数)
    let mut add = |name: &str, from: &str, n: Option<&Value>| {
        let name = strip(name);
        if name.is_empty() {
            return;
        }
        let k = normalize_part(&name);
        let i = match seen.iter().position(|x| x.0 == k) {
            Some(i) => i,
            None => {
                seen.push((k, name, vec![], json!(0)));
                seen.len() - 1
            }
        };
        let x = &mut seen[i];
        if !from.is_empty() && !x.2.iter().any(|f| f == from) {
            x.2.push(from.to_string());
        }
        // x["n"] += n or 0（整数どうしは整数。小数が混ざれば小数）
        if let Some(n) = n.filter(|n| json_truthy(n)) {
            x.3 = match (x.3.as_i64(), n.as_i64()) {
                (Some(a), Some(b)) => a.checked_add(b).map(Value::from).unwrap_or_else(|| json!(a as f64 + b as f64)),
                _ => json!(x.3.as_f64().unwrap_or(0.0) + n.as_f64().unwrap_or(0.0)),
            };
        }
    };
    for (n, from) in known {
        add(n, from, None);
    }
    for d in arr(cx.conf.v.get("sources")) {
        if !json_truthy(&d["equipColumn"]) || !json_truthy(&d["place"]) {
            continue;
        }
        let key = d["key"].as_str()?;
        let src = if key == "lot" { "lot".to_string() } else { format!("src:{key}") };
        let panel = json!({"visual": "none", "source": src, "body": {"rows": [{"column": pivot::EQUIP_DIM, "part": ""}], "measures": [{"agg": "count"}]}});
        let p = clean_panel(&Tree::from_value(&panel)).ok()?;
        let a = cx.answer(&p)?;
        if a.get("cells").is_none() {
            continue; // 写している最中・読めない元は飛ばす（Python と同じ）
        }
        // {c["r"][0]: c["v"][0] for c in cells if len(c["r"]) == 1}（同じ鍵は後ろ）
        let cells = arr(a.get("cells"));
        let from = s_or(d.get("name"));
        for k in arr(a["orders"].get(0)) {
            if !json_truthy(k) {
                continue;
            }
            let n = cells.iter().rev().find(|c| arr(c.get("r")).len() == 1 && c["r"][0] == *k).and_then(|c| arr(c.get("v")).first());
            let ks = json_str(k);
            add(&a["labels"][0].get(&ks).map(json_str).unwrap_or(ks), &from, n);
        }
    }
    Some(seen.into_iter().map(|(_, name, from, n)| json!({"name": name, "from": from, "n": n})).collect())
}

/// GET /api/dashboard/equip-tree（dashboard_equip_tree）: 実際に出てくる設備（equipment_seen。作業実績の設備 → 設備マスタは一覧の設定の
/// 設備の名前の並び）と、設備グループのまとめ方ごとの入り方。窓が数えられない元（スケジュールを窓が答えない形）があれば None（Python に任せる）
pub fn equip_tree_answer(cx: &Ctx) -> Option<Value> {
    let known: Vec<(String, &str)> = cx.dash().names().into_iter().map(|n| (n, "")).collect();
    let names: Vec<String> = equipment_seen(cx, &known)?.iter().map(|x| json_str(&x["name"])).collect();
    let sets = cx.equip_tree(&names, "");
    Some(json!({"names": names, "sets": sets}))
}

/// 写している最中の数え方（版 3.97.0）: そのデータ元の設備のうち、写し終えた設備 done / 写す設備 total。
/// 画面はこれをそのまま「写した done/total 台の分」と言う（前は合わせた表・合わせるで、ほかのデータの写しまで足して 6/12 と数えていた）
/// 写している設備は並べて写す（設備ごとに写しの係の糸）ので、あと何秒は「いちばん遅く終わる設備」の残り（済んだバイト÷経過＝その設備の速さ）。
/// どれかの設備がまだ写し始めていない・0.5 秒たっていない・まだ 1 バイトも写していない間は、見込みを出さない（left は null）
fn copy_of(got: &Parts) -> Option<Value> {
    let cop = got.failed.iter().filter(|f| f["kind"] == "copying").count();
    if cop == 0 {
        return None;
    }
    let mut c = json!({"name": got.name, "done": got.mirrors.len(), "total": got.mirrors.len() + cop});
    let ps: Vec<_> = got.copying.iter().flatten().collect();
    if !ps.is_empty() {
        let (done, total) = (ps.iter().map(|p| p.done).sum::<u64>(), ps.iter().map(|p| p.total).sum::<u64>());
        let secs = ps.iter().map(|p| p.secs).fold(0.0, f64::max);
        c["bytes"] = json!([done, total]);
        if secs >= 0.5 && done > 0 {
            c["rate"] = json!((done as f64 / secs * 10.0).round() / 10.0); // バイト/秒（いま写している設備を合わせた速さ）
        }
        let known = got.copying.len() == cop && got.copying.iter().all(|p| p.is_some_and(|p| p.secs >= 0.5 && p.done > 0));
        if known {
            let left = ps.iter().map(|p| (p.total.saturating_sub(p.done)) as f64 / (p.done as f64 / p.secs)).fold(0.0, f64::max);
            c["leftSec"] = json!((left * 10.0).round() / 10.0);
        }
    }
    Some(c)
}

/// いくつかの答え（合わせた表のまとまり・合わせるのデータ）のうち、写している最初のデータの数え方
fn first_copy(answers: &[Value]) -> Option<Value> {
    answers.iter().find_map(|a| a.get("copy").filter(|c| c.is_object()).cloned())
}

pub fn query(cx: &Ctx, body: &[u8]) -> Option<(u16, Value)> {
    let p = match clean_panel(&panel_of(body)?) {
        Ok(p) => p,
        Err(Some(e)) => return Some((400, json!({"error": e}))),
        Err(None) => return None,
    };
    if p["visual"] == "board" {
        let n = arr(p.get("groups")).len();
        let mut groups = vec![];
        for i in 0..n {
            crate::progress::group(i, n); // 合わせた表のまとまり i / n 済み（版 3.97.0）
            groups.push(cx.answer(&board_query(&p, i))?);
        }
        crate::progress::group(n, n);
        let mut out = json!({"groups": groups, "equipOrder": cx.dash().names(), "now": cx.stamp()});
        if let Some(c) = first_copy(&groups) {
            out["copy"] = c;
        }
        let tree = s_or(p["order"].get("tree"));
        if !tree.is_empty() {
            let mut keys: Vec<String> = vec![];
            for a in groups.iter().filter(|a| a.get("orders").is_some()) {
                for k in arr(a["orders"].get(0)) {
                    let k = json_str(k);
                    if k.is_empty() {
                        continue;
                    }
                    let lab = a["labels"][0].get(&k).map(json_str).unwrap_or(k);
                    if !keys.contains(&lab) {
                        keys.push(lab);
                    }
                }
            }
            let t = cx.equip_tree(&keys, &tree);
            out["tree"] = t.first().map(|x| x["groups"].clone()).unwrap_or(json!([]));
        }
        return Some((200, out));
    }
    let a = if OPS_VISUALS.contains(&p["visual"].as_str().unwrap_or("")) {
        cx.ops_answer(&p)?
    } else if p.get("link").is_some() {
        cx.link_answer(&p)?
    } else {
        cx.split_answer(&p)?
    };
    if a.get("status").is_some() && a.get("cells").is_none() {
        let st = a["status"].as_u64().unwrap_or(503) as u16;
        let mut e = json!({"error": a["error"], "kind": a["kind"]});
        if let Some(c) = a.get("copy").filter(|c| c.is_object()) {
            e["copy"] = c.clone(); // 1 台も写し終えていない: 写しの様子も返す（版 3.97.0）
        }
        return Some((st, e));
    }
    Some((200, a))
}

/// 数えるファイルの印（控えの鍵: 場所・書いた時刻・大きさ。Python の _file_sig）
fn file_sigs(parts: &[Part]) -> Vec<Value> {
    parts
        .iter()
        .map(|x| {
            let m = std::fs::metadata(&x.path).ok();
            let mt = m
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            json!([x.path.display().to_string(), mt.to_string(), m.map(|m| m.len()).unwrap_or(0)])
        })
        .collect()
}

/// 数える設備のファイルを手で並べた順に（Python の order_parts）
fn order_parts(parts: Vec<Part>, eorder: &[String]) -> Vec<Part> {
    if eorder.is_empty() {
        return parts;
    }
    let names = order_names(&parts.iter().map(|x| json!(x.name)).collect::<Vec<_>>(), eorder);
    let mut v = parts;
    v.sort_by_key(|x| names.iter().position(|n| n == &json!(x.name)).unwrap_or(usize::MAX));
    v
}

/// ガントの既定の期間（前日）
fn gantt_period() -> Value {
    json!({"column": "@workday", "kind": "yesterday", "n": 1})
}

/// N を JSON の数から（整数か小数か）
fn n_of(v: &Value) -> N {
    match v {
        Value::Number(n) => n.as_i64().map(N::I).unwrap_or_else(|| N::F(n.as_f64().unwrap_or(0.0))),
        _ => N::I(0),
    }
}

/// 1 回の ABC 分析の答え（Python の _abc_pass の答え）
struct AbcPass {
    equips: Vec<Map<String, Value>>,
    all: Map<String, Value>,
    skipped: Vec<Value>,
    range: Option<(String, String)>,
    start: String,
    end: String,
}

impl Ctx<'_> {
    /// 稼働（gantt）・ABC 分析（abc）のパネル（Python の _ops_answer）
    fn ops_answer(&self, p: &Map<String, Value>) -> Option<Value> {
        let s = |k: &str| s_or(p.get(k));
        let equips = names(p.get("equips"), MAX_EQUIPS);
        let got = match self.panel_parts(&s("source"), &s("equip"), &s("basis"), &equips) {
            Ok(None) => return None,
            Ok(Some(x)) => x,
            Err(f) => return Some(f),
        };
        let gantt = p["visual"] == "gantt";
        let period = match p.get("period").filter(|x| !x.is_null()) {
            Some(x) => x.clone(),
            None if gantt => gantt_period(),
            None => Value::Null,
        };
        let stamp = self.stamp();
        let days: Vec<String> =
            got.parts.iter().map(|x| x.work.as_ref().map(|w| w.clock.place(&stamp, &w.basis).0).unwrap_or_default()).collect();
        let failed_names: Vec<Value> = got.failed.iter().map(|f| f["name"].clone()).collect();
        let hour = if gantt { self.now.format("%H").to_string() } else { "0".into() };
        let key = json!(["ops", p, period, file_sigs(&got.parts), days, self.now.date().to_string(), hour, failed_names]).to_string();
        let hit = self.cache.lock().unwrap().get(&key);
        let hit = match hit {
            Some(h) => h,
            None => {
                crate::progress::counted();
                let h = self.ops_count(p, got.parts.clone(), &period);
                if h.get("error").is_some() {
                    return Some(h);
                }
                self.cache.lock().unwrap().put(key, h.clone());
                h
            }
        };
        let mut out = hit;
        let mut failed = got.failed.clone();
        failed.extend(arr(out.get("skipped")).iter().cloned());
        out["failed"] = json!(failed);
        out["sourceName"] = json!(got.name);
        out["mirrors"] = json!(got.mirrors);
        out["now"] = json!(stamp);
        if let Some(c) = copy_of(&got) {
            out["copy"] = c;
        }
        Some(out)
    }

    fn read_args<'b>(
        &'b self,
        p: &'b Map<String, Value>,
        o: &'b Value,
        period: Option<&'b Value>,
        filters: &'b str,
        calc: Option<&'b Calc>,
    ) -> ReadArgs<'b> {
        ReadArgs {
            search: p.get("search").and_then(Value::as_str).unwrap_or(""),
            filters,
            today: self.now.date(),
            calc,
            conv: self.conv,
            period,
            now: self.now,
            end: o.get("end").and_then(Value::as_str).unwrap_or(""),
            start: o.get("start").and_then(Value::as_str).unwrap_or(""),
            cols: vec![],
            reach: false,
            lots: false,
            around: 0,
        }
    }

    /// 稼働のパネルを数える（Python の _ops_count）
    fn ops_count(&self, p: &Map<String, Value>, parts: Vec<Part>, period: &Value) -> Value {
        let o = p.get("ops").cloned().unwrap_or(json!({}));
        let filters = p.get("filters").cloned().unwrap_or(json!([])).to_string();
        let calc = p.get("calc").and_then(calc_of);
        let per = Some(period).filter(|x| !x.is_null());
        if p["visual"] == "abc" {
            return self.abc_count(p, parts, &o, per, &filters, calc.as_ref());
        }
        let shifts = self.conf.shifts();
        let (label, color) = (s_or(o.get("label")), s_or(o.get("color")));
        let eorder = names(p.get("eorder"), MAX_EQUIPS);
        let (mut equips, mut skipped): (Vec<Value>, Vec<Value>) = (vec![], vec![]);
        let (mut rng, mut start_col, mut end_col): (Option<(String, String)>, String, String) = (None, String::new(), String::new());
        let total = parts.len();
        for (i, part) in order_parts(parts, &eorder).into_iter().enumerate() {
            crate::progress::step("gantt", i, total); // 稼働のガントを組み終えた設備 i / total（版 3.97.0）
            let mut args = self.read_args(p, &o, per, &filters, calc.as_ref());
            args.cols = [label.clone(), color.clone()].into_iter().filter(|c| !c.is_empty()).collect();
            args.reach = true;
            let r = match operation::read_ops(&part, &args) {
                Ok(r) => r,
                Err(e) => {
                    skipped.push(json!({"name": part.name, "error": e.text()}));
                    equips.push(
                        json!({"name": part.name, "error": e.text(), "ops": [], "windows": [], "view": null, "rate": null, "shiftMin": 0,
                                       "busyMin": 0, "outsideMin": 0, "byShift": [], "noEnd": 0, "why": {}, "count": 0, "carry": 0,
                                       "truncated": false, "pattern": ""}),
                    );
                    continue;
                }
            };
            if start_col.is_empty() {
                start_col = r.start.clone();
            }
            if end_col.is_empty() {
                end_col = r.end.clone();
            }
            if rng.is_none() {
                rng = r.range.clone();
            }
            if let Some((a, b)) = &r.range {
                let span = chrono::NaiveDate::parse_from_str(b, "%Y-%m-%d").ok().zip(chrono::NaiveDate::parse_from_str(a, "%Y-%m-%d").ok());
                if span.is_some_and(|(b, a)| (b - a).num_days() + 1 > operation::MAX_DAYS) {
                    return json!({"error": format!("ガントチャートの期間は {} 日までです（期間を短くしてください）。", operation::MAX_DAYS),
                                  "kind": "invalid", "status": 400});
                }
            }
            let pat = worksum::pattern_for(&shifts, &part.name);
            let basis = part.work.as_ref().map(|w| w.basis.clone()).unwrap_or_else(|| "work".into());
            let segs = pat.as_ref().map(|x| x.segments.clone()).unwrap_or_default();
            let wins = match (&pat, &r.range) {
                (Some(_), Some((a, b))) => operation::shift_windows(&segs, a, b, &basis),
                _ => vec![],
            };
            let days = match &r.range {
                Some((a, b)) => operation::work_days(&segs, a, b, &basis),
                None => vec![],
            };
            let lab = if !label.is_empty() { label.clone() } else { r.lot.clone() };
            let mut g = operation::gantt(&part.name, &r, &wins, &lab, &color, &days);
            g.insert("pattern".into(), json!(pat.map(|x| x.name).unwrap_or_default()));
            equips.push(Value::Object(g));
        }
        if !equips.iter().any(|e| e.get("error").is_none()) {
            return no_equips(&skipped);
        }
        let sm = N::sum(equips.iter().map(|e| n_of(&e["shiftMin"])));
        let bm = N::sum(equips.iter().map(|e| n_of(&e["busyMin"])));
        let no_pattern: Vec<Value> =
            equips.iter().filter(|e| e["pattern"] == "" && e.get("error").is_none()).map(|e| e["name"].clone()).collect();
        let no_end: i64 = equips.iter().map(|e| e["noEnd"].as_i64().unwrap_or(0)).sum();
        let mut out = ops_head(p, per, &rng, &start_col, &end_col, equips, &skipped);
        out["total"] = json!({"shiftMin": sm.round(2).json(), "busyMin": bm.round(2).json(),
                              "rate": if sm.f() != 0.0 { json!(aggregate::py_round(bm.f() / sm.f(), 4)) } else { Value::Null },
                              "noPattern": no_pattern, "noEnd": no_end});
        out
    }

    /// ABC 分析を 1 つの期間で数える（Python の _abc_pass）。数えられなければ Err(答え)
    #[allow(clippy::too_many_arguments)]
    fn abc_pass(
        &self,
        p: &Map<String, Value>,
        parts: &[Part],
        o: &Value,
        period: Option<&Value>,
        filters: &str,
        calc: Option<&Calc>,
    ) -> Result<AbcPass, Value> {
        let qty = qty_of(o);
        let cls = operation::cls_list(o.get("cls"));
        let mut cols = cls.clone();
        cols.push(if operation::QTYS.contains(&qty.as_str()) { String::new() } else { qty.clone() });
        let lead = o.get("span").and_then(Value::as_str) == Some("lead");
        let base = {
            let b = s_or(o.get("base"));
            if b.is_empty() {
                "avg".to_string()
            } else {
                b
            }
        };
        let lims = abc_lims(o.as_object().unwrap_or(&Map::new()));
        let each = o.get("rankBy").and_then(Value::as_str) == Some("each");
        let eorder = names(p.get("eorder"), MAX_EQUIPS);
        let (mut equips, mut skipped, mut every, mut reads) = (vec![], vec![], vec![], vec![]);
        let (mut rng, mut start_col, mut end_col): (Option<(String, String)>, String, String) = (None, String::new(), String::new());
        let total = parts.len();
        for (i, part) in order_parts(parts.to_vec(), &eorder).into_iter().enumerate() {
            crate::progress::step("read", i, total); // ABC 分析: 読み終えた設備 i / total（版 3.97.0）
            let mut args = self.read_args(p, o, period, filters, calc);
            args.cols = cols.iter().filter(|c| !c.is_empty()).cloned().collect();
            args.lots = lead;
            args.around = if lead && period.is_some() { operation::LEAD_AROUND_DAYS } else { 0 };
            let r = match operation::read_ops(&part, &args) {
                Ok(r) => r,
                Err(e) => {
                    skipped.push(json!({"name": part.name, "error": e.text()}));
                    continue;
                }
            };
            if start_col.is_empty() {
                start_col = r.start.clone();
            }
            if end_col.is_empty() {
                end_col = r.end.clone();
            }
            if rng.is_none() {
                rng = r.range.clone();
            }
            let mine: Vec<operation::Op> = r.ops.iter().filter(|x| !x.carry && !x.after).cloned().collect();
            let mut e = Map::new();
            e.insert("name".into(), json!(part.name));
            e.extend(operation::abc(&mine, &cls, &qty, &base, &lims, each));
            equips.push(e);
            every.extend(mine);
            reads.push(r);
        }
        if equips.is_empty() {
            return Err(no_equips(&skipped));
        }
        if lead && !reads.iter().any(|r| !r.lot.is_empty()) {
            return Err(
                json!({"error": "ロット番号の列が無いので、リードタイム（同じロットの最初の作業開始〜最後の作業終了）を出せません。",
                              "kind": "invalid", "status": 400}),
            );
        }
        crate::progress::step("abc", 0, 0); // 品種を並べる（n/of なし）
        let ops = if lead { operation::lead_ops(&reads) } else { every };
        let all = operation::abc(&ops, &cls, &qty, &base, &lims, each);
        Ok(AbcPass { equips, all, skipped, range: rng, start: start_col, end: end_col })
    }

    /// ABC 分析と換算係数（基準の期間で換算も。Python の _abc_count）
    fn abc_count(
        &self,
        p: &Map<String, Value>,
        parts: Vec<Part>,
        o: &Value,
        period: Option<&Value>,
        filters: &str,
        calc: Option<&Calc>,
    ) -> Value {
        let mut got = match self.abc_pass(p, &parts, o, period, filters, calc) {
            Ok(g) => g,
            Err(e) => return e,
        };
        if let Some(rf) = o.get("refPeriod").filter(|r| json_truthy(r)) {
            let a = match self.abc_pass(p, &parts, o, Some(rf), filters, calc) {
                Ok(a) => a,
                Err(mut e) => {
                    e["error"] = json!(format!("基準の期間（地点 A）: {}", s_or(e.get("error"))));
                    return e;
                }
            };
            let empty = Map::new();
            for e in got.equips.iter_mut() {
                let name = e["name"].clone();
                let by = a.equips.iter().find(|x| x["name"] == name).unwrap_or(&empty);
                operation::apply_ref(e, by, a.range.as_ref());
            }
            operation::apply_ref(&mut got.all, &a.all, a.range.as_ref());
        }
        let qty = qty_of(o);
        let cls = operation::cls_list(o.get("cls"));
        let equips: Vec<Value> = got.equips.into_iter().map(Value::Object).collect();
        let mut out = ops_head(p, period, &got.range, &got.start, &got.end, equips, &got.skipped);
        out["all"] = Value::Object(got.all);
        out["span"] = json!(if o.get("span").and_then(Value::as_str) == Some("lead") { "lead" } else { "sum" });
        out["cls"] = json!(cls.join(operation::KEY_SEP));
        out["clsList"] = json!(cls);
        out["qty"] = json!(qty);
        out
    }
}

/// ABC の量（clean_ops の既定と同じく、空なら本数）
fn qty_of(o: &Value) -> String {
    let q = s_or(o.get("qty"));
    if q.is_empty() {
        "lots".to_string()
    } else {
        q
    }
}

fn no_equips(skipped: &[Value]) -> Value {
    let why: String = skipped.iter().take(3).map(|x| format!(" {}: {}", s_or(x.get("name")), s_or(x.get("error")))).collect();
    json!({"error": format!("数えられる設備がありません。{why}"), "kind": "invalid", "status": 400})
}

/// 稼働の答えの頭（Python の _ops_head）
fn ops_head(
    p: &Map<String, Value>,
    period: Option<&Value>,
    rng: &Option<(String, String)>,
    start: &str,
    end: &str,
    equips: Vec<Value>,
    skipped: &[Value],
) -> Value {
    let per = period.map(|x| {
        let mut m = x.as_object().cloned().unwrap_or_default();
        let kind = s_or(x.get("kind"));
        m.insert("name".into(), json!(pivot::PERIODS.iter().find(|(k, _)| *k == kind).map(|(_, n)| *n).unwrap_or("")));
        m.insert("ranges".into(), json!(rng.iter().map(|(a, b)| json!({"from": a, "to": b})).collect::<Vec<_>>()));
        Value::Object(m)
    });
    json!({"kind": p["visual"], "equips": equips, "skipped": skipped, "range": rng.as_ref().map(|(a, b)| json!([a, b])),
           "startColumn": start, "endColumn": end, "period": per, "basis": p["basis"]})
}

/// 試験の「いま」（一覧の設定の答えの dash.now。無ければ窓の時計）
pub fn now_of(conf: &Conf) -> NaiveDateTime {
    conf.v["dash"]["now"]
        .as_str()
        .and_then(|t| NaiveDateTime::parse_from_str(t, "%Y-%m-%d %H:%M:%S").ok())
        .unwrap_or_else(|| chrono::Local::now().naive_local())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copying_is_counted_within_one_data_source() {
        // 版 3.97.0: 写している最中の数え方は、そのデータ元の設備だけ（作業実績 11 台のうち 5 台を写し終えた → 5/11）。
        // 前は画面が合わせた表のまとまりの写しを全部足して、仕掛の写し 1 つまで数えて 6/12 と言った
        let cop = |n: &str| json!({"name": n, "kind": "copying", "error": "写しています", "status": 503});
        let work = Parts {
            parts: vec![],
            failed: vec![cop("CR2"), cop("L-2"), cop("LS3"), cop("CAL"), cop("HOT"), cop("SL1"), json!({"name": "SL3", "kind": "unknown"})],
            name: "作業実績".into(),
            mirrors: (0..5).map(|i| json!({"remote": i})).collect(),
            copying: vec![],
        };
        assert_eq!(copy_of(&work), Some(json!({"name": "作業実績", "done": 5, "total": 11})), "読めない設備（SL3）は数えない");
        let wip = Parts { parts: vec![], failed: vec![], name: "仕掛".into(), mirrors: vec![json!({})], copying: vec![] };
        assert_eq!(copy_of(&wip), None, "写し終えた元は数え方を持たない");
        let groups = vec![json!({"cells": []}), json!({"cells": [], "copy": copy_of(&work)})];
        assert_eq!(
            first_copy(&groups),
            Some(json!({"name": "作業実績", "done": 5, "total": 11})),
            "合わせた表は写しているまとまりの数え方"
        );
        assert_eq!(first_copy(&[json!({"cells": []})]), None);
    }

    #[test]
    fn copying_left_time_comes_from_bytes_of_each_equipment() {
        // 版 3.97.0: 写している設備ごとの済んだバイト÷経過で速さを出し、いちばん遅く終わる設備の残りを「あと何秒」にする
        use crate::mirror::CopyProgress as P;
        let cop = |n: &str| json!({"name": n, "kind": "copying"});
        let mut got =
            Parts {
                parts: vec![], failed: vec![cop("A"), cop("B")], name: "作業実績".into(), mirrors: vec![json!({})], copying: vec![]
            };
        got.copying =
            vec![Some(P { done: 2_000_000, total: 4_000_000, secs: 2.0 }), Some(P { done: 1_000_000, total: 4_000_000, secs: 2.0 })];
        let c = copy_of(&got).unwrap();
        assert_eq!((c["done"].as_u64(), c["total"].as_u64()), (Some(1), Some(3)), "円と字の n/m は台のまま");
        assert_eq!(c["bytes"], json!([3_000_000, 8_000_000]));
        assert_eq!(c["rate"].as_f64(), Some(1_500_000.0));
        assert_eq!(c["leftSec"].as_f64(), Some(6.0), "B は 3MB 残り・0.5MB/秒で 6 秒（A は 2 秒）: {c}");
        got.copying = vec![Some(P { done: 2_000_000, total: 4_000_000, secs: 2.0 }), None];
        assert!(copy_of(&got).unwrap().get("leftSec").is_none(), "まだ写し始めていない設備があれば見込みを出さない");
        got.copying = vec![Some(P { done: 0, total: 4_000_000, secs: 0.2 }), Some(P { done: 10, total: 4_000_000, secs: 0.3 })];
        let c = copy_of(&got).unwrap();
        assert!(c.get("leftSec").is_none() && c.get("rate").is_none(), "速さがまだ分からない間は経過だけ: {c}");
    }

    #[test]
    fn query_body_is_read_like_python() {
        // Python の get_json(silent=True) or {}・body.get("panel") or {}（版 3.83.0。本文は送った順の木で読む）
        assert_eq!(panel_of(b""), Some(Tree::Obj(vec![])));
        assert_eq!(panel_of(b"null"), Some(Tree::Obj(vec![])));
        assert_eq!(panel_of(b"[]"), Some(Tree::Obj(vec![])));
        assert_eq!(panel_of(br#"{"panel": 0}"#), Some(Tree::Obj(vec![])));
        assert_eq!(panel_of(br#"{"panel": {"id": "a"}}"#), Tree::parse(r#"{"id": "a"}"#));
        assert_eq!(panel_of(b"[1]"), None, "表でない真の本文は Python が .get で落ちる: Python に任せる");
        assert_eq!(panel_of(b"\"x\""), None);
        assert_eq!(panel_of(br#"{"panel": {"top": NaN}}"#), None, "NaN は Python だけが読む");
        assert_eq!(panel_of(b"{"), None, "読めない本文");
        // 数の字は Python の int() と同じに読む（4,300 桁を超える数・\x1c〜\x1f は読めず既定。全角の空白は外す。字の読み方は pyfmt::py_int_of）
        let top = |v: Value| clean_panel(&Tree::from_value(&json!({"visual": "kpi", "source": "lot", "top": v}))).map(|p| p["top"].clone());
        assert_eq!(top(json!("9".repeat(5000))), Ok(json!(0)));
        assert_eq!(top(json!("5\u{1c}")), Ok(json!(0)), "Python の int('5\\x1c') は ValueError（既定の値）。版 3.104.0 から窓も同じに読む");
        assert_eq!(top(json!("\u{3000}5")), Ok(json!(5)), "全角の空白は int() が外す");
        assert_eq!(top(json!("7")), Ok(json!(7)));
    }

    #[test]
    fn clean_panel_messages_like_python() {
        let e = |p: Value| clean_panel(&Tree::from_value(&p)).unwrap_err().unwrap();
        assert_eq!(e(json!(1)), "パネルの形が違います。");
        assert_eq!(e(json!({"title": "t", "source": "x"})), "パネル「t」のデータ（lot・work・src:<キー>）が違います。");
        assert_eq!(
            e(json!({"id": "a1", "visual": "bar", "source": "lot"})),
            "パネル「a1」は行の段が要ります（大きな数にするなら「数字」の形を選んでください）。"
        );
        assert_eq!(e(json!({"visual": "board", "groups": [1, 2, 3, 4, 5]})), "パネル「p1」の列のまとまりは 4 つまでです。");
        let g = clean_panel(&Tree::from_value(&json!({"visual": "gantt", "source": "work"}))).unwrap();
        assert!(g["ops"].is_object() && g.get("egroup").is_none(), "{g:?}");
        assert_eq!(
            e(json!({"title": "t", "visual": "abc", "source": "lot"})),
            "パネル「t」の稼働・ABC 分析は、作業実績（作業開始と作業終了がある）で使えます。"
        );
        let p = clean_panel(&Tree::from_value(
            &json!({"visual": "kpi", "source": "src:wip", "period": {"column": "@workday", "kind": "days", "n": "99999"}}),
        ))
        .unwrap();
        assert_eq!(p["period"]["n"], 3660);
        assert_eq!(p["body"]["measures"], json!([{"agg": "lots"}]));
        assert_eq!(link_key("$Ａ1"), "A1");
        assert_eq!(order_names(&[json!("b"), json!("a"), json!("c")], &["C".into(), "B".into()]), vec![json!("c"), json!("b"), json!("a")]);
    }
}
