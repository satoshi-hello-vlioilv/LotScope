//! 品質異常の 3 つの問い合わせに窓（Rust）が答える係: 一覧（GET /api/lotlist）・データの時刻（GET /api/lotlist/source）・
//! 再読込（POST /api/lotlist/refresh）。答えの形は Python 版（program/app/routes/lotlist.py）と同じ。
//!
//! - 設定（元ファイル・写す間隔・古さのしきい・既定の表と件数・係）は Python に尋ねる（GET /api/lotlist/settings。参照先マスタは
//!   共有のマスタにあるため）。10 秒覚え、参照先を保存したら（invalidate）すぐ尋ね直す
//! - 設定の係（desktop.lotlist_engine）が "python" なら答えない（Python が写しも一覧も受け持つ）。問い合わせに engine=python を
//!   付けたときも、その1回だけ Python に任せる（自己診断の突き合わせ・食い違いの切り分け）
//! - 写しの係（mirror.rs）は 1 つだけ。Python は窓が lotlist を受け持つと名乗ると写さず、同じ台帳を読む

use crate::access::Gate;
use crate::dashboard;
use crate::formula::Tables;
use crate::lists::{Conf, Lists, Quality};
use crate::lotlist::{self, Args};
use crate::mirror::DbMirror;
use crate::pivot;
use crate::worksum::{self, Grouping};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// 設定を覚える長さ（ほかの PC が参照先を直したときも、遅くともこれで切り替わる）。
pub const SETTINGS_TTL: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq)]
pub struct Settings {
    pub source: String,
    pub refresh_seconds: i64,
    pub stale_hours: f64,
    pub table: String,
    pub page_size: i64,
    pub engine: String,
    /// 計算列の式の conv が引く変換表（マスタ「変換表」）と、その版（版が変わったときだけ読み直す）
    pub conversions_rev: String,
    pub conversions: Value,
    /// 一覧の段取りの材料（版 3.60.0。データ元・作業実績の登録・勤務体系・出さないタブ。Python の lotlist.lists_settings）
    pub lists: Value,
    /// 権限の判定の材料（版 3.65.0。名乗りとマスタ・利用状況の置き場。Python の lotlist._access_place・src/access.rs）
    pub access: Value,
}

impl Settings {
    pub fn from_json(v: &Value) -> Settings {
        let num = |k: &str, d: f64| v.get(k).and_then(Value::as_f64).unwrap_or(d);
        Settings {
            source: v["source"].as_str().unwrap_or("").into(),
            refresh_seconds: num("refresh_seconds", 60.0) as i64,
            stale_hours: num("stale_hours", 36.0),
            table: v["table"].as_str().unwrap_or("").into(),
            page_size: num("page_size", 500.0) as i64,
            engine: v["engine"].as_str().unwrap_or("rust").into(),
            conversions_rev: v["conversions"]["rev"].to_string(),
            conversions: v["conversions"]["tables"].clone(),
            lists: v["lists"].clone(),
            access: v["access"].clone(),
        }
    }
}

/// 設定を尋ねる手段（窓では Python への問い合わせ。試験では作り物）。
pub type AskSettings<'a> = &'a dyn Fn() -> Result<Value, String>;

pub struct Lot {
    cache_dir: PathBuf,
    lists: Lists,
    mirror: Mutex<Option<Arc<DbMirror>>>,
    settings: Mutex<Option<(Instant, Settings)>>,
    tables: Mutex<Option<(String, Arc<Tables>)>>,
    /// ダッシュボードのパネルの答えの控え（版 3.62.0。src/dashboard.rs）
    dash: Mutex<dashboard::Cache>,
    /// 権限の判定と書き込みの門番（版 3.65.0。src/access.rs）。マスタを書いた後（after_python）に覚えを捨てる
    gate: Gate,
}

impl Lot {
    pub fn new(cache_dir: PathBuf) -> Lot {
        Lot {
            lists: Lists::new(&cache_dir),
            cache_dir,
            mirror: Mutex::default(),
            settings: Mutex::default(),
            tables: Mutex::default(),
            dash: Mutex::default(),
            gate: Gate::default(),
        }
    }

    /// 中身（Python）が答えた書き込みが、一覧の設定（段取りの材料）に効くマスタを変えたか（版 3.60.0。main.rs の after が見て invalidate する）。
    /// 参照先・データ元・作業実績の登録・勤務体系・権限・タブの権限・変換表・マスタの置き場。画面の状態の保存・生存の知らせのような
    /// 頻繁な書き込みでは尋ね直さない
    pub fn changes_settings(method: &str, path: &str, status: u16) -> bool {
        const LIST_MASTERS: &[&str] = &[
            "/api/settings/",
            "/api/sources",
            "/api/masters/worklog",
            "/api/masters/shifts",
            "/api/masters/access",
            "/api/masters/tabaccess",
            "/api/masters/conversions",
            "/api/masters/place",
            "/api/masters/equipment",
            "/api/masters/equipgroups",
        ];
        method != "GET" && method != "HEAD" && (200..300).contains(&status) && LIST_MASTERS.iter().any(|p| path.starts_with(p))
    }

    /// 中身（Python）が答えたあと（main.rs の after）: 一覧の設定に効くマスタを書いたなら、次の問い合わせで設定を尋ね直す
    pub fn after_python(&self, method: &str, path: &str, status: u16) {
        if Self::changes_settings(method, path, status) {
            self.invalidate();
            self.gate.forget(); // 権限・タブの権限・置き場を書いた: 次の問い合わせで me を読み直す
        }
    }

    /// 参照先を保存したとき: 次の問い合わせで設定を尋ね直す。
    pub fn invalidate(&self) {
        *self.settings.lock().unwrap() = None;
    }

    fn settings(&self, ask: AskSettings) -> Result<Settings, String> {
        if let Some((at, s)) = self.settings.lock().unwrap().as_ref() {
            if at.elapsed() < SETTINGS_TTL {
                return Ok(s.clone());
            }
        }
        let s = Settings::from_json(&ask()?);
        *self.settings.lock().unwrap() = Some((Instant::now(), s.clone()));
        Ok(s)
    }

    /// 段取りの材料（lists）に、窓が決めた権限を重ねた物（版 3.65.1。順 5 の 1 段目 b）: 出さないタブ（hidden）と勤務体系を直せるか
    /// （work.canEditShifts）は、Python が自分の me から作った値ではなく、門番と同じ窓の me から決める（判定の元を 1 つに）。
    /// 窓が me を決められない（名乗り・権限の表を読めない）ときは、Python が作った値のまま（Python が自分で決めたときと同じ）
    pub fn lists_of(&self, s: &Settings) -> Value {
        let mut v = s.lists.clone();
        let Some(m) = s.access.is_object().then(|| self.gate.me(&s.access).ok()).flatten() else {
            return v;
        };
        if let Some(o) = v.as_object_mut() {
            o.insert("hidden".into(), m["flags"]["hiddenTabs"].clone());
            if let Some(w) = o.get_mut("work").and_then(Value::as_object_mut) {
                w.insert("canEditShifts".into(), json!(crate::access::can_write(&m, "shift_patterns")));
            }
        }
        v
    }

    /// 中身（Python）へ回す前の権限の判定と門番（access::Gate::check）。材料（名乗り・置き場）は一覧の設定と一緒に 10 秒覚える。
    /// 道（path）は百分率符号を戻した物を渡す（Python も戻してから道を合わせる）
    pub fn access_check(&self, method: &str, path: &str, ask: AskSettings) -> Result<Option<String>, (u16, &'static str, String)> {
        let conf = self.settings(ask).ok().map(|s| s.access).filter(Value::is_object);
        self.gate.check(method, path, conf.as_ref())
    }

    /// 変換表（設定の版が前と同じなら読み解いた表を使い回す）
    fn tables(&self, s: &Settings) -> Arc<Tables> {
        let mut cur = self.tables.lock().unwrap();
        if let Some((rev, t)) = cur.as_ref() {
            if *rev == s.conversions_rev {
                return t.clone();
            }
        }
        let t = Arc::new(Tables::from_json(&s.conversions));
        *cur = Some((s.conversions_rev.clone(), t.clone()));
        t
    }

    /// 設定に合わせた写しの係（無ければ作り、変わっていれば切り替えて、背景の周回を始める）。
    fn mirror(&self, s: &Settings) -> Arc<DbMirror> {
        let mut cur = self.mirror.lock().unwrap();
        let m = match cur.as_ref() {
            Some(m) => {
                m.reconfigure(&s.source, s.refresh_seconds, s.stale_hours);
                m.clone()
            }
            None => {
                let m = DbMirror::new("lot_list", &s.source, &self.cache_dir, s.refresh_seconds, s.stale_hours);
                *cur = Some(m.clone());
                m
            }
        };
        m.start();
        m
    }

    /// 起動の直後: 設定を尋ねて写し始める（一覧を開いたときに待たせない）。
    pub fn warm(&self, ask: AskSettings) {
        if let Ok(s) = self.settings(ask) {
            if s.engine == "rust" {
                self.mirror(&s);
            }
        }
    }

    /// 受け身の Python からの知らせ（作業実績・データ元の「写して」。版 3.60.0）
    pub fn notice(&self, v: &Value) {
        self.lists.notice(v);
    }

    /// ダッシュボードの答えの控えを空にする（測る道具 examples/dash_bench.rs が、数える時間を測るため）
    pub fn forget_dashboard(&self) {
        *self.dash.lock().unwrap() = dashboard::Cache::default();
    }

    /// 本文のある問い合わせも見る入口（main.rs）。ダッシュボードのパネルの数（POST /api/dashboard/query。版 3.62.0）は本文 {panel} で答え、
    /// ほかは handle と同じ
    pub fn handle_body(&self, method: &str, path: &str, query: &str, body: &[u8], ask: AskSettings) -> Option<(u16, Value)> {
        if (method, path) != ("POST", "/api/dashboard/query") {
            return self.handle(method, path, query, ask);
        }
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        let s = self.settings(ask).ok()?;
        if s.engine != "rust" || s.lists.get("dash").is_none_or(Value::is_null) {
            return None; // ダッシュボードの材料を答えない中身（前の版の Python）は、Python が答える
        }
        let body: Value = serde_json::from_slice(body).unwrap_or_default();
        let m = self.mirror(&s);
        let lists = self.lists_of(&s);
        let conf = Conf { v: &lists };
        let q = Quality { mirror: m, table: &s.table, page_size: s.page_size };
        let cx = dashboard::Ctx {
            lists: &self.lists,
            conf: &conf,
            q: &q,
            now: dashboard::now_of(&conf),
            conv: &self.tables(&s),
            cache: &self.dash,
        };
        dashboard::query(&cx, &body)
    }

    /// 窓が答える問い合わせなら (状態, 答え)。Python に任せるなら None。
    /// 品質（/api/lotlist）・作業実績（/api/worklog）・データ元（/api/src/<キー>）の一覧・スライサー・データの時刻・再読込（版 3.60.0 から
    /// 作業実績・データ元も。段取りは src/lists.rs）
    pub fn handle(&self, method: &str, path: &str, query: &str, ask: AskSettings) -> Option<(u16, Value)> {
        let route = Route::of(method, path)?;
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        let s = match self.settings(ask) {
            Ok(s) => s,
            // 設定を尋ねられない（Python が止まっている等）→ Python に任せる（同じ理由の答えが返る）
            Err(_) => return None,
        };
        // 段取りの材料（lists）を答えない中身（前の版の Python）とは、品質だけを今までどおり受け持つ
        if s.engine != "rust" || (s.lists.is_null() && !matches!(route, Route::Lot(_))) {
            return None;
        }
        let m = self.mirror(&s);
        let lists_v = self.lists_of(&s);
        let conf = Conf { v: &lists_v };
        let q = Quality { mirror: m.clone(), table: &s.table, page_size: s.page_size };
        let qs = lotlist::parse_query(query);
        let arg = |k: &str| qs.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()).unwrap_or_default();
        let lists = &self.lists;
        let (what, plan) = match &route {
            Route::Lot(Kind::Source) => return Some((200, m.source_info())),
            Route::Lot(Kind::Refresh) => {
                let r = m.refresh();
                return Some((200, json!({"result": r, "source": m.source_info()})));
            }
            Route::Work(Kind::Source) => {
                return Some(match lists.work.peek(&arg("equip")) {
                    None => (404, json!({"error": "まだ開いていない設備です。", "kind": "unknown"})),
                    Some(w) => (200, w.source_info()),
                })
            }
            Route::Src(key, Kind::Source | Kind::Refresh) if conf.source(key).is_some_and(|d| d["kind"] == "cm3") => return None,
            Route::Src(key, Kind::Source) => {
                let d = conf.source(key);
                let k = d.and_then(|d| d["base"].as_str()).filter(|b| !b.is_empty()).unwrap_or(key).to_string();
                let mm = if k == "lot" { Some(m.clone()) } else { lists.src.peek(&k) };
                return Some(match mm {
                    None => (404, json!({"error": "まだ開いていないデータ元です。", "kind": "unknown"})),
                    Some(x) => (200, x.source_info()),
                });
            }
            Route::Lot(k) => (*k, lists.lot_plan(&conf, &q, true)),
            Route::Work(k) => (*k, lists.work_plan(&conf, &q, &arg("equip"), *k != Kind::Refresh, true)),
            Route::Src(key, k) => {
                let refresh = *k == Kind::Refresh;
                match lists.src_plan(&conf, &q, key, !refresh, !refresh) {
                    Ok(None) => return None, // スケジュール（CM3）は Python
                    Ok(Some(p)) => (*k, Ok(p)),
                    Err(f) => (*k, Err(f)),
                }
            }
        };
        let plan = match plan {
            Ok(p) => p,
            Err(f) => return Some(f),
        };
        let source = plan.source.clone();
        if what == Kind::Refresh {
            let mm = plan.mirror.clone().or_else(|| match &route {
                Route::Src(key, _) => lists.src.peek(key),
                _ => None,
            });
            return Some(match mm {
                None => (404, json!({"error": "まだ開いていないデータ元です。", "kind": "unknown"})),
                Some(x) => {
                    let r = x.refresh();
                    (200, json!({"result": r, "source": x.source_info()}))
                }
            });
        }
        let path = plan.path.clone()?;
        let today = chrono::Local::now().date_naive();
        let opts = plan.opts();
        let args = Args::from_query(query);
        if what == Kind::Slicer {
            // columns があれば計算列の値の組（式が使う列）、無ければ列の値（Python の slicer_answer と同じ振り分け）
            let cols = arg("columns");
            let answer = if cols.is_empty() {
                lotlist::slicer(&path, &args, &arg("column"), &arg("key"), &opts, today)
            } else {
                lotlist::slicer_combos(&path, &args, &cols, &opts, today)
            };
            return Some(match answer {
                Ok(v) => (200, v),
                Err((400, e)) => (400, json!({"error": e})),
                Err((st, e)) => (st, json!({"error": e, "source": source})),
            });
        }
        if what == Kind::Pivot {
            return Some(self.pivot(&route, &plan, &conf, &s, &qs, path, today));
        }
        // 作業でまとめる（work=1。作業実績だけ）: 直はその設備の勤務体系
        let pattern = plan.equip.as_ref().and_then(|e| e["name"].as_str()).map(|n| worksum::pattern_for(&conf.shifts(), n));
        let mut grouping = match (&route, pattern) {
            (Route::Work(_), Some(p)) => Grouping::from_query(&qs, p.as_ref()),
            _ => None,
        };
        Some(match lotlist::query(&path, &args, &opts, today, &self.tables(&s), grouping.as_mut()) {
            Ok(mut v) => {
                v["source"] = source;
                if let Some(e) = &plan.equip {
                    v["equip"] = e.clone();
                    if let Some(w) = v.get_mut("work").and_then(Value::as_object_mut) {
                        w.insert("canEditShifts".into(), json!(conf.work()["canEditShifts"].as_bool().unwrap_or(false)));
                    }
                }
                (200, v)
            }
            Err(e) => {
                let mut v = json!({"error": e, "source": source});
                if let Some(eq) = &plan.equip {
                    v["equip"] = eq.clone();
                }
                (503, v)
            }
        })
    }
}

impl Lot {
    /// 集計表・グラフ（Python の lotlist_pivot・worklog_pivot・src_pivot と同じ答え・同じ失敗）。
    /// 作業実績は、作業日・直・ロット数をその設備の勤務体系・作業開始の列（start）・日付の数え方（basis）で決める
    #[allow(clippy::too_many_arguments)]
    fn pivot(
        &self,
        route: &Route,
        plan: &crate::lists::Plan,
        conf: &Conf,
        s: &Settings,
        qs: &[(String, String)],
        path: PathBuf,
        today: chrono::NaiveDate,
    ) -> (u16, Value) {
        let arg = |k: &str| qs.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()).unwrap_or_default();
        let opts = plan.opts();
        let pattern = match route {
            Route::Work(_) => {
                Some(plan.equip.as_ref().and_then(|e| e["name"].as_str()).and_then(|n| worksum::pattern_for(&conf.shifts(), n)))
            }
            _ => None,
        };
        let work = pattern.as_ref().map(|p| pivot::Work {
            clock: worksum::Clock::new(p.as_ref().map(|x| x.segments.clone()).unwrap_or_default()),
            basis: if qs.iter().any(|(k, _)| k == "basis") { arg("basis") } else { "work".into() },
            start: arg("start"),
        });
        let part = pivot::Part {
            path,
            table: arg("table"),
            preferred_table: opts.table.clone(),
            candidates: opts.candidates,
            work,
            equip: None,
            name: String::new(),
            lot_col: opts.lot_col.clone(),
        };
        let tables = self.tables(s);
        let got = if arg("fields") == "1" {
            pivot::fields(&part, None, &tables, 300)
        } else {
            let (search, filters, rows, cols, measures, month, bx) =
                (arg("search"), arg("filters"), arg("rows"), arg("cols"), arg("measures"), arg("month"), arg("box"));
            let ask = pivot::Ask {
                search: &search,
                filters: &filters,
                rows: &rows,
                cols: &cols,
                measures: &measures,
                today,
                month: &month,
                box_col: &bx,
                period: None,
                now: chrono::Local::now().naive_local(),
                calc: None,
                conv: &tables,
                equips: &[],
                egroups: None,
                sets: None,
            };
            pivot::query(part, &ask).map(|mut v| {
                if let Some(p) = &pattern {
                    v["shiftPattern"] = json!(p.as_ref().map(|x| x.name.clone()).unwrap_or_default());
                }
                v
            })
        };
        match got {
            Ok(v) => (200, v),
            Err(pivot::Fail::Invalid(e)) => (400, json!({"error": e})),
            Err(pivot::Fail::Down(e)) => (503, json!({"error": e, "source": plan.source})),
        }
    }
}

/// 問い合わせの種類（一覧・スライサー・集計・データの時刻・再読込）
#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    List,
    Slicer,
    /// 集計表・グラフ（版 3.61.0。fields=1 は左のカラムの札。src/pivot.rs）
    Pivot,
    Source,
    Refresh,
}

/// 窓が受け持つ道（品質・作業実績・データ元）
enum Route {
    Lot(Kind),
    Work(Kind),
    Src(String, Kind),
}

impl Route {
    fn of(method: &str, path: &str) -> Option<Route> {
        let kind = |rest: &str| match (method, rest) {
            ("GET", "") => Some(Kind::List),
            ("GET", "/slicer") => Some(Kind::Slicer),
            ("GET", "/pivot") => Some(Kind::Pivot),
            ("GET", "/source") => Some(Kind::Source),
            ("POST", "/refresh") => Some(Kind::Refresh),
            _ => None,
        };
        if let Some(rest) = path.strip_prefix("/api/lotlist") {
            return kind(rest).map(Route::Lot);
        }
        if let Some(rest) = path.strip_prefix("/api/worklog") {
            return kind(rest).map(Route::Work);
        }
        let rest = path.strip_prefix("/api/src/")?;
        let (key, tail) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        let key = percent_decode(key);
        (!key.is_empty()).then_some(())?;
        kind(tail).map(|k| Route::Src(key, k))
    }
}

fn percent_decode(s: &str) -> String {
    lotlist::parse_query(&format!("k={}", s.replace('+', "%2B"))).first().map(|(_, v)| v.clone()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::time::Duration;

    fn fixture(dir: &std::path::Path) -> PathBuf {
        let p = dir.join("src.sqlite3");
        let c = rusqlite::Connection::open(&p).unwrap();
        c.execute_batch("CREATE TABLE [仕掛] ([ロット番号] TEXT, [重量] REAL); INSERT INTO [仕掛] VALUES ('L1', 1.5), ('L2', 2.0);")
            .unwrap();
        p
    }

    #[test]
    fn answers_with_the_mirror_and_follows_the_engine() {
        let dir = std::env::temp_dir().join(format!("da-lot-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = fixture(&dir);
        let lot = Lot::new(dir.join("cache"));
        let asked = Cell::new(0);
        let engine = Mutex::new("rust");
        let ask = || {
            asked.set(asked.get() + 1);
            Ok(json!({"source": src.display().to_string(), "refresh_seconds": 60, "stale_hours": 36, "table": "", "page_size": 500,
                      "engine": *engine.lock().unwrap()}))
        };
        let (st, v) = lot.handle("GET", "/api/lotlist", "page=1", &ask).expect("Rust が答える");
        assert_eq!((st, v["count"].as_i64(), v["source"]["mirrored"].as_bool()), (200, Some(2), Some(true)), "写してから引く: {v}");
        let (_, s) = lot.handle("GET", "/api/lotlist/source", "", &ask).unwrap();
        assert_eq!(s["mirrored"], true);
        assert_eq!(asked.get(), 1, "設定は覚えている間は1回だけ尋ねる");
        // 再読込は今すぐ確かめるだけ: 変わっていない元は写さず、変わった元は写す（SHARED_READ.md の R2）
        let (_, r) = lot.handle("POST", "/api/lotlist/refresh", "", &ask).unwrap();
        assert_eq!(
            (r["result"]["updated"].as_bool(), r["result"]["skipped"].as_bool()),
            (Some(false), Some(true)),
            "変わっていない元は写さない: {r}"
        );
        let mtime = std::fs::metadata(&src).unwrap().modified().unwrap() + std::time::Duration::from_secs(1);
        std::fs::File::options().write(true).open(&src).unwrap().set_modified(mtime).unwrap();
        let (_, r) = lot.handle("POST", "/api/lotlist/refresh", "", &ask).unwrap();
        assert_eq!(r["result"]["updated"], true, "変わった元は写す: {r}");
        assert!(lot.handle("GET", "/api/lotlist", "engine=python", &ask).is_none(), "engine=python はその1回だけ Python");
        assert!(lot.handle("GET", "/api/lotlist/settings", "", &ask).is_none(), "設定そのものは Python");
        *engine.lock().unwrap() = "python";
        lot.invalidate();
        assert!(lot.handle("GET", "/api/lotlist", "", &ask).is_none(), "設定の係が python なら Python に任せる");
        assert_eq!(asked.get(), 2, "保存のあとは尋ね直す");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn calc_sorts_with_the_conversion_tables_of_the_settings() {
        // 計算列で並べ替える一覧（版 3.59.0）: 式の conv は設定の答えの変換表を引く。版が同じ間は読み解いた表を使い回し、版が変われば読み直す
        let dir = std::env::temp_dir().join(format!("da-lot4-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = fixture(&dir);
        let lot = Lot::new(dir.join("cache"));
        let table = |out_l1: &str| json!({"t": {"inputs": [{"name": "x", "type": "text"}], "rows": [{"when": {"x": [{"op": "eq", "v": ["L1"]}]}, "out": out_l1}], "other": "b"}});
        let conv = Mutex::new((json!(1), table("c")));
        let ask = || {
            let (rev, tables) = conv.lock().unwrap().clone();
            Ok(json!({"source": src.display().to_string(), "engine": "rust", "conversions": {"rev": rev, "tables": tables}}))
        };
        let enc = |t: &str| {
            t.bytes().map(|b| if b.is_ascii_alphanumeric() { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>()
        };
        let q = format!(
            "calc={}&sorts={}",
            enc(r#"{"formulas": {"k": "conv('t', [ロット番号])"}}"#),
            enc(r#"[{"column": "k", "dir": "asc"}]"#)
        );
        let order = |v: &Value| {
            v["rows"].as_array().unwrap().iter().map(|r| r["ロット番号"].as_str().unwrap_or("").to_string()).collect::<Vec<_>>()
        };
        let (st, v) = lot.handle("GET", "/api/lotlist", &q, &ask).expect("計算列も Rust が答える");
        assert_eq!((st, order(&v)), (200, vec!["L2".to_string(), "L1".to_string()]), "L1→c・L2→b の順（b < c）: {v}");
        assert_eq!(v["sorts"][0]["column"], "k", "計算列で並べた");
        // 版が同じ間は、表が変わっていても読み直さない（設定を尋ね直しても同じ表）
        *conv.lock().unwrap() = (json!(1), table("a"));
        lot.invalidate();
        let (_, v) = lot.handle("GET", "/api/lotlist", &q, &ask).unwrap();
        assert_eq!(order(&v), ["L2", "L1"], "版が同じなら前に読み解いた表");
        *conv.lock().unwrap() = (json!(2), table("a"));
        lot.invalidate();
        let (_, v) = lot.handle("GET", "/api/lotlist", &q, &ask).unwrap();
        assert_eq!(order(&v), ["L1", "L2"], "版が変われば新しい表（L1→a < L2→b）");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hidden_tabs_unknown_sources_and_window_copies() {
        // 版 3.60.0: 出さないタブは 403・知らない元は 404・スケジュールは Python・前の版の中身（lists が無い）とは品質だけ
        let dir = std::env::temp_dir().join(format!("da-lot5-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = fixture(&dir);
        let lot = Lot::new(dir.join("cache"));
        // 読めない表（無い表を引く view。集計の中で読めない＝503 と元の様子。Python の src_pivot のほかの例外と同じ）
        let empty = dir.join("broken.sqlite3");
        rusqlite::Connection::open(&empty)
            .unwrap()
            .execute_batch("CREATE TABLE t (a); INSERT INTO t VALUES (1); CREATE VIEW v AS SELECT * FROM missing;")
            .unwrap();
        let lists = json!({"hidden": ["lot", "wip"], "sources": [
            {"key": "lot", "kind": "file", "name": "品質", "api": "/api/lotlist", "joins": [], "read": {}},
            {"key": "wip", "kind": "file", "name": "仕掛", "api": "/api/src/wip", "place": src.display().to_string(), "joins": [], "read": {}},
            {"key": "m1", "kind": "file", "name": "マスタ", "api": "/api/src/m1", "place": src.display().to_string(), "joins": [], "read": {}},
            {"key": "e1", "kind": "file", "name": "空", "api": "/api/src/e1", "place": empty.display().to_string(), "joins": [], "read": {}},
            {"key": "sch", "kind": "cm3", "name": "スケジュール", "api": "/api/src/sch", "joins": [], "read": {}}],
            "work": {"rows": []}, "shifts": []});
        let ask = || Ok(json!({"source": src.display().to_string(), "engine": "rust", "lists": lists.clone()}));
        let (st, v) = lot.handle("GET", "/api/lotlist", "", &ask).unwrap();
        assert_eq!((st, v["kind"].as_str()), (403, Some("forbidden")), "{v}");
        assert!(v["error"].as_str().unwrap().starts_with("「品質」を見る権限がありません"));
        assert_eq!(lot.handle("GET", "/api/src/wip", "", &ask).unwrap().0, 403);
        let (st, v) = lot.handle("GET", "/api/src/m1", "", &ask).unwrap();
        assert_eq!((st, v["count"].as_i64(), v["table"].as_str()), (200, Some(2), Some("仕掛")), "{v}");
        assert_eq!(lot.handle("GET", "/api/src/%E7%84%A1", "", &ask).unwrap().0, 404, "知らない元");
        assert!(lot.handle("GET", "/api/src/sch", "", &ask).is_none() && lot.handle("GET", "/api/src/sch/source", "", &ask).is_none());
        // 集計表（版 3.61.0 から窓が答える）: 行の無い組みは件数の総計だけ・出さないタブは 403・組み方の誤りは 400
        let (st, v) = lot.handle("GET", "/api/src/m1/pivot", "", &ask).expect("集計表も窓が答える");
        assert_eq!((st, v["cells"][0]["v"][0].as_i64(), v["count"].as_i64()), (200, Some(2), Some(2)), "{v}");
        assert_eq!(lot.handle("GET", "/api/src/wip/pivot", "", &ask).unwrap().0, 403);
        let (st, v) = lot.handle("GET", "/api/src/m1/pivot", "rows=%5B%7B%22column%22%3A%22%E7%84%A1%22%7D%5D", &ask).unwrap();
        assert_eq!((st, v["error"].as_str()), (400, Some("列「無」がありません。")));
        let (st, v) = lot.handle("GET", "/api/src/m1/pivot", "fields=1", &ask).unwrap();
        assert!(st == 200 && v["fields"].as_array().is_some_and(|f| !f.is_empty()), "{v}");
        assert!(lot.handle("GET", "/api/src/sch/pivot", "", &ask).is_none(), "スケジュールの集計は Python");
        let (st, v) = lot.handle("GET", "/api/src/e1/pivot", "table=v", &ask).unwrap();
        assert_eq!((st, v["error"].as_str()), (503, Some("no such table: main.missing")), "{v}");
        assert!(v["source"].is_object(), "読めないときは元の様子も返す: {v}");
        let (st, v) = lot.handle("GET", "/api/worklog", "equip=x", &ask).unwrap();
        assert_eq!((st, v["kind"].as_str()), (404, Some("unknown")));
        // 受け身の Python からの「写して」: 窓が作業実績の写しを始める
        lot.notice(&json!({"id": 0, "event": "mirror", "prefix": "work_log", "key": "k1", "remote": src.display().to_string(), "interval": 60, "stale": 36}));
        let m = lot.lists.work.peek("k1").expect("知らせで写しの係ができる");
        assert!(m.read_path().is_some(), "最初の周回で写す");
        assert!(dir.join("cache").join("work_log").join("work_log_k1.state.json").exists(), "周回の様子を置く");
        // 前の版の中身（lists が無い）とは、品質だけを受け持つ
        let old = || Ok(json!({"source": src.display().to_string(), "engine": "rust"}));
        let lot = Lot::new(dir.join("cache2"));
        assert_eq!(lot.handle("GET", "/api/lotlist", "", &old).unwrap().0, 200);
        assert!(lot.handle("GET", "/api/src/m1", "", &old).is_none() && lot.handle("GET", "/api/worklog", "equip=k", &old).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn work_logs_follow_renames_and_fall_back_to_the_last_copy() {
        // 作業実績の段取り（版 3.60.0）: 名前が変わったファイルは同じファイルID でたどる（renamed）・設備ごとの表・
        // フォルダに届かなくなっても前に写した物で見せる（fail-open）・写していない設備は届かない理由の 503
        let dir = std::env::temp_dir().join(format!("da-lot6-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let folder = dir.join("実績");
        std::fs::create_dir_all(&folder).unwrap();
        let c = rusqlite::Connection::open(folder.join("実績_A.sqlite3")).unwrap();
        c.execute_batch("CREATE TABLE 実績 (ロット番号 TEXT); INSERT INTO 実績 VALUES ('L1'); CREATE TABLE 別表 (ロット番号 TEXT); INSERT INTO 別表 VALUES ('X1'), ('X2');").unwrap();
        drop(c);
        std::fs::copy(folder.join("実績_A.sqlite3"), folder.join("実績_B.sqlite3")).unwrap();
        std::fs::write(folder.join("実績_D.sqlite3"), "SQLite ではない中身").unwrap(); // 写しを作れない設備
        let fid = |n: &str| crate::lists::file_id(&folder.join(n));
        let lists = json!({"hidden": [], "sources": [], "shifts": [], "work": {"folder": folder.display().to_string(), "pattern": "実績_*.sqlite3",
            "table": "", "refresh_seconds": 60, "stale_hours": 36, "page_size": 500, "canEditShifts": false, "rows": [
            {"キー": "a", "設備名": "A", "ファイル名": "実績_OLD.sqlite3", "ファイルID": fid("実績_A.sqlite3"), "表示": "有", "表": ""},
            {"キー": "b", "設備名": "B", "ファイル名": "実績_b.SQLITE3", "ファイルID": "", "表示": "有", "表": "別表"},
            {"キー": "c", "設備名": "C", "ファイル名": "実績_C.sqlite3", "ファイルID": "", "表示": "有", "表": ""},
            {"キー": "d", "設備名": "D", "ファイル名": "実績_D.sqlite3", "ファイルID": "", "表示": "有", "表": ""}]}});
        let mut lot = Lot::new(dir.join("cache"));
        lot.lists.list_ttl = Duration::ZERO;
        let ask = || Ok(json!({"source": "", "engine": "rust", "lists": lists.clone()}));
        let (st, v) = lot.handle("GET", "/api/worklog", "equip=a", &ask).unwrap();
        assert_eq!((st, v["equip"]["renamed"].as_bool(), v["equip"]["file"].as_str()), (200, Some(true), Some("実績_A.sqlite3")), "{v}");
        let (st, v) = lot.handle("GET", "/api/worklog", "equip=b", &ask).unwrap();
        assert_eq!(
            (st, v["table"].as_str(), v["count"].as_i64()),
            (200, Some("別表"), Some(2)),
            "大文字小文字の違う登録名・設備ごとの表: {v}"
        );
        let (st, v) = lot.handle("GET", "/api/worklog", "equip=c", &ask).unwrap();
        assert_eq!((st, v["kind"].as_str()), (404, Some("missing")), "{v}");
        let (st, v) = lot.handle("GET", "/api/worklog", "equip=d", &ask).unwrap();
        assert_eq!((st, v["kind"].as_str()), (503, Some("copying")), "写しを作れない設備は写し待ち: {v}");
        std::fs::rename(&folder, dir.join("退避")).unwrap();
        let (st, v) = lot.handle("GET", "/api/worklog", "equip=a", &ask).unwrap();
        assert_eq!((st, v["count"].as_i64()), (200, Some(1)), "届かなくなっても前に写した物で見せる: {v}");
        let (st, v) = lot.handle("GET", "/api/worklog", "equip=c", &ask).unwrap();
        assert_eq!((st, v["kind"].as_str()), (503, Some("unreachable")), "写していない設備は届かない理由: {v}");
        assert!(v["error"].as_str().unwrap().starts_with("作業実績のフォルダに届きません（"));
        let (st, v) = lot.handle("GET", "/api/worklog", "equip=d", &ask).unwrap();
        assert_eq!((st, v["kind"].as_str()), (503, Some("unreachable")), "写し終えていない係では見せない（前の写しが無い）: {v}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_real_paths_use_the_shell_me_for_tabs_and_shifts() {
        // 版 3.65.1（順 5 の 1 段目 b）: 窓が答える本物の道（一覧 handle・ダッシュボード handle_body）が、出さないタブと勤務体系を直せるかを
        // Python の答えた値でなく窓の me から決める（lists_of を通る）。Python の値はわざと逆にしておく
        let dir = std::env::temp_dir().join(format!("da-lot-access-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (folder, share, pres) = (dir.join("実績"), dir.join("share"), dir.join("presence"));
        for d in [&folder, &share, &pres] {
            std::fs::create_dir_all(d).unwrap();
        }
        let c = rusqlite::Connection::open(folder.join("実績_A.sqlite3")).unwrap();
        c.execute_batch("CREATE TABLE 実績 (ロット番号 TEXT, 作業日 TEXT); INSERT INTO 実績 VALUES ('L1', '2026-11-04');").unwrap();
        drop(c);
        let perms = |rows: Value| std::fs::write(share.join("access_permissions.json"), json!({"rows": rows}).to_string()).unwrap();
        std::fs::write(share.join("tab_access.json"), json!({"rows": [{"タブ": "work", "出さない区分": "設備作業者"}]}).to_string())
            .unwrap();
        let lists = json!({"hidden": [], "sources": [], "shifts": [], "dash": {"now": "2026-11-04 10:00:00"},
            "work": {"folder": folder.display().to_string(), "pattern": "実績_*.sqlite3", "table": "", "refresh_seconds": 60, "stale_hours": 36,
                     "page_size": 500, "canEditShifts": false, "rows": [{"キー": "a", "設備名": "A", "ファイル名": "実績_A.sqlite3", "ファイルID": "", "表示": "有", "表": ""}]}});
        let access = json!({"who": {"login": "u1", "pc": "PC-1", "pcSource": "", "key": "PC-1@u1"},
            "place": {"shareDir": share, "shared": ["access_permissions", "tab_access"], "data": dir.join("data"),
                      "defaults": dir.join("defaults"), "cache": dir.join("mcache"), "presence": pres}});
        let ask = || Ok(json!({"source": "", "engine": "rust", "lists": lists.clone(), "access": access.clone()}));
        let mut lot = Lot::new(dir.join("cache"));
        lot.lists.list_ttl = Duration::ZERO;
        let admin = json!({"id": 9, "ログインID": "boss", "PC名": "", "権限区分": "開発者"});
        let work = |lot: &Lot| lot.handle("GET", "/api/worklog", "equip=a&work=1", &ask).unwrap();
        let shifts = |v: &Value| v["work"]["canEditShifts"].clone();
        let renew = |lot: &Lot| lot.after_python("PUT", "/api/masters/access/1", 200); // 権限を書いた後と同じく覚えを捨てる
                                                                                       // ① 設備作業者: 区分の決まりで実績を出さない（Python の hidden は空なのに、窓が断る）。ダッシュボードの実績のパネルも
        perms(json!([admin, {"id": 1, "ログインID": "u1", "PC名": "", "権限区分": "設備作業者"}]));
        let (st, v) = work(&lot);
        assert_eq!((st, v["kind"].as_str()), (403, Some("forbidden")), "一覧は窓の me の出さないタブで断る: {v}");
        let body = serde_json::to_vec(&json!({"panel": {"id": "p", "visual": "kpi", "source": "work", "equips": ["a"]}})).unwrap();
        let (st, v) = lot.handle_body("POST", "/api/dashboard/query", "", &body, &ask).unwrap();
        assert_eq!(st, 403, "ダッシュボードのパネルも窓の me の出さないタブで断る: {v}");
        // ② メンテナンス者（現場のマスタを書ける）: 実績を出し、勤務体系を直せる（Python の値は false）
        perms(json!([admin, {"id": 1, "ログインID": "u1", "PC名": "", "権限区分": "メンテナンス者"}]));
        renew(&lot);
        let (st, v) = work(&lot);
        assert_eq!((st, shifts(&v)), (200, json!(true)), "勤務体系は現場のマスタ（部分的編集可でも書ける）: {v}");
        // ③ 部分的編集可: 勤務体系（現場のマスタ）は直せる。管理のマスタと取り違えると false になる
        perms(json!([admin, {"id": 1, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "部分的編集可"}]));
        renew(&lot);
        assert_eq!(shifts(&work(&lot).1), json!(true), "部分的編集可でも勤務体系は直せる");
        // ④ 閲覧のみ: 直せない
        perms(json!([admin, {"id": 1, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ"}]));
        renew(&lot);
        assert_eq!(shifts(&work(&lot).1), json!(false), "閲覧のみは直せない");
        // ⑤ 切断されている: 編集可でも直せない（ボタンを出さない）
        perms(json!([admin, {"id": 1, "ログインID": "u1", "PC名": "", "権限区分": "メンテナンス者"}]));
        let at = chrono::Local::now().naive_local().format("%Y-%m-%dT%H:%M:%S").to_string();
        std::fs::write(pres.join("PC-1@u1.revoke.json"), json!({"by": "boss", "at": at}).to_string()).unwrap();
        let lot2 = {
            let mut l = Lot::new(dir.join("cache2"));
            l.lists.list_ttl = Duration::ZERO;
            l
        };
        assert_eq!(shifts(&work(&lot2).1), json!(false), "切断されている間は直せない");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_master_writes_ask_the_settings_again() {
        for (m, p, s) in [
            ("PUT", "/api/settings/lot_list.source", 200),
            ("POST", "/api/sources", 201),
            ("PUT", "/api/sources/wip/conn", 200),
            ("PUT", "/api/masters/worklog/3", 200),
            ("POST", "/api/masters/shifts", 201),
            ("PUT", "/api/masters/tabaccess", 200),
            ("PUT", "/api/masters/access/2", 200),
            ("PUT", "/api/masters/conversions/x", 200),
            ("POST", "/api/masters/place", 200),
            // ダッシュボードの材料（版 3.62.0）: 設備グループ・設備マスタ
            ("POST", "/api/masters/equipgroups", 201),
            ("DELETE", "/api/masters/equipgroups/4", 200),
            ("PUT", "/api/masters/equipment/1", 200),
        ] {
            assert!(Lot::changes_settings(m, p, s), "{m} {p}");
        }
        for (m, p, s) in [
            ("PUT", "/api/ui-state", 200),
            ("POST", "/api/heartbeat", 200),
            ("POST", "/api/dashboard/query", 200),
            ("GET", "/api/sources", 200),
            ("PUT", "/api/sources/wip", 409),
            ("POST", "/api/masters/formats", 201),
        ] {
            assert!(!Lot::changes_settings(m, p, s), "{m} {p} {s}");
        }
        // つなぎ（after_python）: マスタを書いたあとは設定を尋ね直し、画面の状態の保存では尋ね直さない
        let dir = std::env::temp_dir().join(format!("da-lot7-{}", std::process::id()));
        let lot = Lot::new(dir.join("cache"));
        let asked = Cell::new(0);
        let ask = || {
            asked.set(asked.get() + 1);
            Ok(json!({"source": "", "engine": "rust"}))
        };
        lot.handle("GET", "/api/lotlist", "", &ask);
        lot.after_python("PUT", "/api/ui-state", 200);
        lot.handle("GET", "/api/lotlist", "", &ask);
        assert_eq!(asked.get(), 1, "画面の状態の保存では尋ね直さない");
        lot.after_python("PUT", "/api/sources/wip", 200);
        lot.handle("GET", "/api/lotlist", "", &ask);
        assert_eq!(asked.get(), 2, "データ元を書いたら尋ね直す");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_source_is_a_reasoned_400_and_a_dead_python_is_left_to_python() {
        let lot = Lot::new(std::env::temp_dir().join(format!("da-lot2-{}", std::process::id())));
        let ask = || Ok(json!({"source": "", "engine": "rust"}));
        let (st, v) = lot.handle("GET", "/api/lotlist", "", &ask).unwrap();
        assert_eq!((st, v["error"].as_str()), (400, Some(crate::lists::NO_SOURCE)));
        let lot = Lot::new(std::env::temp_dir().join("da-lot3"));
        let dead = || Err("止まっています".to_string());
        assert!(lot.handle("GET", "/api/lotlist", "", &dead).is_none());
    }
}
