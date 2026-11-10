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
use crate::master_store::{Config as StoreConfig, Store};
use crate::mirror::DbMirror;
use crate::pivot;
use crate::presence::{self, Presence};
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
    /// 転写距離・ピッチ計算の設定（版 3.72.0。配った設定の calculation。src/calc.rs）。答えに無い（前の版の Python）ときは None
    pub calculation: Option<Value>,
    /// 一覧の表示の設定の範囲（版 3.78.0。services/ui_defaults.PROFILE_KEYS。src/ui_defaults.rs）。答えに無い（前の版の Python）ときは None
    pub ui_profile_keys: Option<Vec<String>>,
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
            calculation: v.get("calculation").cloned(),
            ui_profile_keys: v
                .get("uiProfileKeys")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()),
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
    /// マスタの書く係（版 3.68.0。src/master_store.rs）。置き場と名乗りごとに 1 つ作って長く持つ（錠の残り秒を最初に見てからの経過で測るため）
    store: Mutex<Option<(String, Arc<Store>)>>,
    /// 利用状況・使用の履歴・心拍（版 3.71.0。src/presence.rs。書き手は窓の 1 つ）
    presence: Arc<Presence>,
    /// この PC の作業場所（画面の設定の控え ui_state.json・配る版の覚え want.json の置き場）
    local_root: PathBuf,
    /// 設定の束を自分で組む係（版 3.84.0。src/bundle.rs）。窓（main.rs）が入れる。無い・組めないときは Python に尋ねる
    bundle: Mutex<Option<Arc<crate::bundle::Builder>>>,
    /// 画面（GET /）を描く係（版 3.85.0。src/page.rs）。型と指紋を覚える
    page: crate::page::Page,
    /// 足すデータ元のキーを作る係（版 3.90.0。既定は sources_write::new_key。突き合わせの試験は Python と同じ並びに差し替える）
    new_key: Mutex<Option<NewKey>>,
    /// 画面（GET /）を最後に Python に任せた理由（記録: main.rs が desktop.log に書く）
    page_why: Mutex<String>,
    /// いまの時刻（秒。版 3.91.0: 作業実績の登録の古さ〈mark_stale〉。突き合わせの試験は Python と同じ時刻に差し替える）
    clock: Mutex<Option<Clock>>,
    /// 配布の置き場を写す係（版 3.95.0。src/release_place.rs。このプロセスに 1 つ。写している印はこの PC の作業場所の release_move.json）
    release: crate::release_place::Mover,
}

/// いまの時刻（秒）を答える係
pub type Clock = Arc<dyn Fn() -> f64 + Send + Sync>;

/// 足すデータ元のキーを作る係
pub type NewKey = Arc<dyn Fn() -> String + Send + Sync>;

impl Lot {
    pub fn new(cache_dir: PathBuf) -> Lot {
        // 全列の検索の索引の置き場（版 3.66.0。src/search_index.rs。写しの係の片付けとぶつからない下のフォルダ）
        crate::search_index::set_dir(cache_dir.join("search_index"));
        let local_root = cache_dir.parent().map(PathBuf::from).unwrap_or_else(|| cache_dir.clone());
        Lot {
            release: crate::release_place::Mover::new(Some(local_root.join("release_move.json"))),
            presence: Arc::new(Presence::new(local_root.clone(), presence::system_clock())),
            local_root,
            lists: Lists::new(&cache_dir),
            cache_dir,
            mirror: Mutex::default(),
            settings: Mutex::default(),
            tables: Mutex::default(),
            dash: Mutex::default(),
            gate: Gate::default(),
            store: Mutex::default(),
            bundle: Mutex::default(),
            page: crate::page::Page::default(),
            new_key: Mutex::default(),
            page_why: Mutex::default(),
            clock: Mutex::default(),
        }
    }

    /// 足すデータ元のキーの作り方を差し替える（試験: Python の data_sources.new_key と同じ並び）
    pub fn set_new_key(&self, f: NewKey) {
        *self.new_key.lock().unwrap() = Some(f);
    }

    /// いまの時刻の係を差し替える（試験: Python の time.time と同じ時刻）
    pub fn set_clock(&self, f: Clock) {
        *self.clock.lock().unwrap() = Some(f);
    }

    fn now(&self) -> f64 {
        match self.clock.lock().unwrap().clone() {
            Some(f) => f(),
            None => std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0),
        }
    }

    /// 作業実績の登録の 6 本（版 3.91.0。src/worklog_write.rs）を窓が受ける。フォルダの中身は一覧の段取りと同じ覚え（lists.found_fresh）、
    /// 書く道は権限を読み直して門番に通し、窓の書く係で書く。書いたら一覧の設定（作業実績の行）と権限の覚えを捨てる。組めない・窓が答えない形は None
    fn worklog_route(
        &self,
        method: &str,
        path: &str,
        route: crate::worklog_write::Route,
        query: &str,
        body: &[u8],
        ask: AskSettings,
    ) -> Option<(u16, Value)> {
        use crate::worklog_write::{Route, NAME};
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        // 窓が束を組める形だけ（データ元の書く道と同じ）。束が Python から来た形（窓が置き場を同じに読めない）は Python に任せる
        let builder = self.bundle.lock().unwrap().clone()?;
        let inp = builder.inputs().ok()?;
        for name in [NAME, "path_settings"] {
            inp.check(name).ok()?;
        }
        let s = self.settings(ask).ok()?;
        let work = &s.lists["work"];
        if !s.access.is_object() || !work.is_object() {
            return None;
        }
        let writes = !matches!(route, Route::Get | Route::Files);
        if writes {
            self.gate.forget(); // 書く前は、いまの権限の表で決める
        }
        let me = self.gate.me(&s.access).ok()?;
        if let Some((status, kind, msg)) = crate::access::guard(method, path, &me) {
            return Some((status, json!({"error": msg, "kind": kind})));
        }
        let rows = crate::access::Place::from_json(&s.access["place"]).rows(NAME).ok()?;
        let store = self.store_for(&s.access)?;
        let (folder, pattern) = (work["folder"].as_str()?.to_string(), work["pattern"].as_str()?.to_string());
        let cx = crate::worklog_write::Ctx {
            rows: &rows,
            work,
            found: &|fresh| self.lists.found_fresh(&folder, &pattern, fresh),
            can_edit: crate::access::can_write(&me, NAME),
            now: self.now(),
            new_key: &|| match self.new_key.lock().unwrap().clone() {
                Some(f) => Some(f()),
                None => crate::worklog_write::new_key(),
            },
        };
        let (status, v) = crate::worklog_write::handle(&store, route, query, body, &cx)?;
        if writes && (200..300).contains(&status) {
            self.invalidate(); // 一覧の設定（作業実績の行・設備の名前）を次の問い合わせで組み直す
            self.gate.forget();
        }
        Some((status, v))
    }

    /// 変換表の 8 本（版 3.93.0。src/conversions_write.rs）を窓が受ける。材料は窓の束の材料（名乗り・置き場。Python が居なくても読める）、
    /// 書く道は権限を読み直して門番に通し、窓の書く係で書く。書いたら一覧の設定（式の conv の表・画面の埋める物）を捨てる
    /// （Python が書いたときの after_python と同じ。書けずに断った答えでも、取り込みは前の書き込みが残りうるので捨てる）。
    /// 組めない・窓が答えない形は None（Python が答える）
    fn conversions_route(
        &self,
        method: &str,
        path: &str,
        route: crate::conversions_write::Route,
        query: &str,
        body: &[u8],
    ) -> Option<(u16, Value)> {
        use crate::conversions_write::Route;
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        let builder = self.bundle.lock().unwrap().clone()?;
        let inp = builder.inputs().ok()?;
        let access = json!({"who": inp.who, "place": inp.place});
        let writes = !matches!(route, Route::List | Route::Export);
        if writes {
            self.gate.forget(); // 書く前は、いまの権限の表で決める
        }
        let me = self.gate.me(&access).ok()?;
        if let Some((status, kind, msg)) = crate::access::guard(method, path, &me) {
            return Some((status, json!({"error": msg, "kind": kind})));
        }
        let store = self.store_for(&access)?;
        let place = crate::access::Place::from_json(&inp.place);
        let (status, v) = crate::conversions_write::handle(&store, &me, &place, route, query, body)?;
        if writes {
            self.invalidate(); // 一覧の設定（変換表の表と版の印）を次の問い合わせで組み直す
        }
        Some((status, v))
    }

    /// 設備グループの 4 本（版 3.94.0。src/equipgroups_write.rs）を窓が受ける。材料は変換表と同じ（窓の束の材料: 名乗り・置き場）。
    /// 選べる設備（実際に出てくる設備）は設備の木と同じ dashboard::equipment_seen で数える（作業実績の設備〈表示しない設備も〉と設備マスタは
    /// 置き場から読み、データ元の設備の列はダッシュボードの数え方で数える）。書いたら一覧の設定（ダッシュボードの設備グループ）を捨てる。
    /// 組めない・窓が答えない・選べる設備を数えられない形は None（Python が答える）
    fn equipgroups_route(
        &self,
        method: &str,
        path: &str,
        route: crate::equipgroups_write::Route,
        query: &str,
        body: &[u8],
        ask: AskSettings,
    ) -> Option<(u16, Value)> {
        use crate::equipgroups_write::Route;
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        let builder = self.bundle.lock().unwrap().clone()?;
        let inp = builder.inputs().ok()?;
        let access = json!({"who": inp.who, "place": inp.place});
        let writes = route != Route::List;
        if writes {
            self.gate.forget(); // 書く前は、いまの権限の表で決める
        }
        let me = self.gate.me(&access).ok()?;
        if let Some((status, kind, msg)) = crate::access::guard(method, path, &me) {
            return Some((status, json!({"error": msg, "kind": kind})));
        }
        let store = self.store_for(&access)?;
        let place = crate::access::Place::from_json(&inp.place);
        // 作業実績の設備（work_log.ordered の順・表示しない設備も）→ 設備マスタ（行の順）。名前が並び・表・大きな数なら任せる
        let known = || -> Option<Vec<(String, &'static str)>> {
            let work = place.rows("work_log_files").ok()?;
            let equip = place.rows("equipment_master").ok()?;
            let mut out = vec![];
            for (rows, from) in [(crate::bundle::work_order(work.iter().collect())?, "作業実績"), (equip.iter().collect(), "設備マスタ")]
            {
                for r in rows {
                    let n = r.get("設備名").filter(|v| worksum::truthy(v));
                    if n.is_some_and(|v| !crate::master_rows::value_plain(v)) {
                        return None;
                    }
                    out.push((n.map(worksum::py_str).unwrap_or_default(), from));
                }
            }
            Some(out)
        };
        let seen = || -> Option<Vec<Value>> {
            let known = known()?;
            self.with_dash(ask, |cx| dashboard::equipment_seen(cx, &known))
        };
        let (status, v) = crate::equipgroups_write::handle(&store, &me, &place, route, query, body, &seen)?;
        if writes {
            self.invalidate(); // 一覧の設定（ダッシュボードの設備グループ）を次の問い合わせで組み直す
        }
        Some((status, v))
    }

    /// 設定の束を窓が組む（版 3.84.0）。入れると、束は窓が組み、組めない形だけ Python に尋ねる
    pub fn set_bundle(&self, b: crate::bundle::Builder) {
        *self.bundle.lock().unwrap() = Some(Arc::new(b));
        self.invalidate();
    }

    /// 窓が組んだ束（組めなければ None）。試験と記録のため
    pub fn own_bundle(&self) -> Option<Result<Value, &'static str>> {
        let b = self.bundle.lock().unwrap().clone()?;
        Some(b.build().map_err(|e| e.0))
    }

    /// 画面（GET /・HEAD /。版 3.85.0）を窓が描く。束を組む係が無い・窓が Python と同じに描けない形は None（Python に任せる）。
    /// 中身（Python）が答えないとき（alive が偽）は、窓が同じに読めない埋める物（画面の控え・初期設定・変換表）を Python の except と同じ
    /// 既定の形（空の控え・既定の見せ方・空の変換表）に落として描く（画面は開く。作った後の採点の指摘 7）
    pub fn page(&self, head: bool, alive: &dyn Fn() -> bool) -> Option<crate::page::Html> {
        let why = |w: String| {
            *self.page_why.lock().unwrap() = w;
            None
        };
        let Some(b) = self.bundle.lock().unwrap().clone() else { return why("束を組む係が無い".into()) };
        let inp = match b.inputs() {
            Ok(i) => i,
            Err(e) => return why(format!("束の材料: {}", e.0)),
        };
        let profile: Vec<String> = crate::bundle::tables()["uiProfileKeys"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|x| x.as_str().map(String::from))
            .collect();
        let ui_state = presence::ui_state::load_exact(&b.env().local);
        let ui_profile = inp
            .check("ui_defaults")
            .ok()
            .and_then(|_| inp.rows("ui_defaults").ok())
            .and_then(|r| crate::ui_defaults::profile_of(&r, &profile));
        let conversions = inp
            .check("conversions")
            .ok()
            .and_then(|_| crate::page::conversion_views(&inp.rows("conversions").ok()?, inp.revision("conversions").ok()?).ok());
        let parts = match (ui_state, ui_profile, conversions) {
            (Some(ui_state), Some(ui_profile), Some(conversions)) => crate::page::Parts { ui_state, ui_profile, conversions },
            (s, p, c) if !alive() => crate::page::Parts {
                ui_state: s.unwrap_or_else(|| json!({"rev": 0, "keys": {}})),
                ui_profile: p.unwrap_or_else(|| json!({"keys": profile, "defaults": {}, "updatedAt": "", "updatedBy": {}})),
                conversions: c.unwrap_or_else(|| json!({"items": [], "revision": null})),
            },
            (s, p, c) => {
                let mut miss = vec![];
                if s.is_none() {
                    miss.push("画面の控え".to_string());
                }
                if p.is_none() {
                    miss.push(format!("初期設定（{}）", inp.check("ui_defaults").err().map(|e| e.0).unwrap_or("読めない")));
                }
                if c.is_none() {
                    miss.push(format!("変換表（{}）", inp.check("conversions").err().map(|e| e.0).unwrap_or("読めない")));
                }
                return why(miss.join("・"));
            }
        };
        let html = self.page.index(&b.env().program, parts, head);
        if html.is_none() {
            return why("画面の型・指紋".into());
        }
        html
    }

    /// 画面を最後に Python に任せた理由（記録）
    pub fn page_why(&self) -> String {
        self.page_why.lock().unwrap().clone()
    }

    /// GET /api/config（版 3.85.0）。束を組む係が無い・組めない形は None
    fn config_route(&self) -> Option<(u16, Value)> {
        let b = self.bundle.lock().unwrap().clone()?;
        b.config().ok().map(|v| (200, v))
    }

    /// ダッシュボードの数える係の持ち物を組んで f に渡す（POST /api/dashboard/query・GET /api/dashboard/equip-tree）
    fn with_dash<T>(&self, ask: AskSettings, f: impl FnOnce(&dashboard::Ctx) -> Option<T>) -> Option<T> {
        let s = self.settings(ask).ok()?;
        if s.engine != "rust" || s.lists.get("dash").is_none_or(Value::is_null) {
            return None; // ダッシュボードの材料を答えない中身（前の版の Python）は、Python が答える
        }
        let m = self.mirror(&s);
        let lists = self.lists_of(&s)?; // 窓が権限を決められない: Python に任せる
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
        f(&cx)
    }

    /// 置き場の答え（一覧の設定の access）に合わせた書く係（置き場か名乗りが変われば作り直す）
    fn store_for(&self, conf: &Value) -> Option<Arc<Store>> {
        let key = format!("{}|{}", conf["place"], conf["who"]);
        let mut cur = self.store.lock().unwrap();
        if let Some((k, s)) = cur.as_ref() {
            if *k == key {
                return Some(s.clone());
            }
        }
        let p = &conf["place"];
        let path = |k: &str| p[k].as_str().filter(|s| !s.is_empty()).map(PathBuf::from);
        let cache = path("cache")?;
        let s = Arc::new(Store::new(StoreConfig {
            data: path("data")?,
            defaults: path("defaults")?,
            share_dir: path("shareDir"),
            shared: p["shared"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(),
            local_root: cache.parent()?.to_path_buf(),
            cache,
            pc: conf["who"]["pc"].as_str().unwrap_or("").into(),
            login: conf["who"]["login"].as_str().unwrap_or("").into(),
            role: "rs".into(),
            lock_ttl: p["lockTtl"].as_f64().unwrap_or(crate::master_store::LOCK_TTL_DEFAULT),
        }));
        *cur = Some((key, s.clone()));
        Some(s)
    }

    /// 権限のマスタを書く 4 本（版 3.68.0。src/access_write.rs）を窓が受ける。権限を読み直して門番に通し、窓の書く係で書く。
    /// 判定の材料（access）が無い・me を決められないときは None（Python が答える）
    fn access_write(
        &self,
        method: &str,
        path: &str,
        route: crate::access_write::Route,
        query: &str,
        body: &[u8],
        ask: AskSettings,
    ) -> Option<(u16, Value)> {
        let s = self.settings(ask).ok()?;
        if !s.access.is_object() || crate::access_write::needs_python(body) {
            return None;
        }
        self.gate.forget(); // 書く前は、いまの権限の表で決める
        let me = self.gate.me(&s.access).ok()?;
        if let Some((status, kind, msg)) = crate::access::guard(method, path, &me) {
            return Some((status, json!({"error": msg, "kind": kind})));
        }
        let store = self.store_for(&s.access)?;
        let tabs = crate::access::Place::from_json(&s.access["place"]).rows("tab_access").ok()?;
        let (status, v) = crate::access_write::handle(&store, &me, route, query, body, &tabs)?;
        if (200..300).contains(&status) {
            self.invalidate(); // 一覧の設定（出さないタブ）と権限の覚えを捨てる
            self.gate.forget();
        }
        Some((status, v))
    }

    /// 権限の読む 2 本（版 3.76.0。GET /api/access/me・/api/masters/access）を窓の me から答える（main.rs。心拍と同じく中身が生きているかを見る）。
    /// 判定の材料（access）が無い・中身の版が分からない・me を決められない・中身（Python）が答えないときは None
    /// （Python へ回す。止まっていれば前と同じく失敗する）。版は心拍・利用状況と同じ元（program の version.py）
    pub fn access_read(&self, method: &str, path: &str, ask: AskSettings, alive: &dyn Fn() -> bool) -> Option<(u16, Value)> {
        let route = crate::access::read_route(method, path)?;
        let s = self.settings(ask).ok()?;
        if !s.access.is_object() {
            return None;
        }
        let version = self.presence.app_version();
        if version.is_empty() {
            return None;
        }
        let me = self.gate.me(&s.access).ok()?;
        if !alive() {
            return None;
        }
        Some((200, crate::access::read_answer(route, &me, &version)))
    }

    /// 勤務体系の 4 本（版 3.75.0。src/shifts_write.rs）を窓が受ける。書く道は権限を読み直して門番に通し、窓の書く係で書く。
    /// 判定の材料（access）が無い・me を決められない・マスタを読めない・窓が答えない形は None（Python が答える）
    fn shifts_route(
        &self,
        method: &str,
        path: &str,
        route: crate::shifts_write::Route,
        query: &str,
        body: &[u8],
        ask: AskSettings,
    ) -> Option<(u16, Value)> {
        let s = self.settings(ask).ok()?;
        if !s.access.is_object() {
            return None;
        }
        let writes = route != crate::shifts_write::Route::List;
        if writes {
            self.gate.forget(); // 書く前は、いまの権限の表で決める
        }
        let me = self.gate.me(&s.access).ok()?;
        if let Some((status, kind, msg)) = crate::access::guard(method, path, &me) {
            return Some((status, json!({"error": msg, "kind": kind})));
        }
        let place = crate::access::Place::from_json(&s.access["place"]);
        let read = || -> Option<crate::shifts_write::Read> {
            Some(crate::shifts_write::Read {
                shifts: place.rows(crate::shifts_write::NAME).ok()?,
                work_logs: place.rows("work_log_files").ok()?,
            })
        };
        let store = self.store_for(&s.access)?;
        let (status, v) = crate::shifts_write::handle(&store, &me, route, query, body, &read()?, &read)?;
        if writes && ((200..300).contains(&status) || v["saved"] == json!(true)) {
            self.invalidate(); // 一覧の設定（勤務体系を直せるか・作業実績のまとめの直）を捨てる（書いて読み直せなかった 503 も）
        }
        Some((status, v))
    }

    /// 設備・ロールのマスタの 8 本（版 3.77.0。src/equip_write.rs）を窓が受ける。書く道は門番を通し、窓の書く係で書く。
    /// 判定の材料（access）が無い・me を決められない・マスタを読めない・窓が答えない形は None（Python が答える）
    fn equip_route(
        &self,
        method: &str,
        path: &str,
        route: crate::equip_write::Route,
        query: &str,
        body: &[u8],
        ask: AskSettings,
    ) -> Option<(u16, Value)> {
        let s = self.settings(ask).ok()?;
        if !s.access.is_object() {
            return None;
        }
        let me = self.gate.me(&s.access).ok()?;
        if let Some((status, kind, msg)) = crate::access::guard(method, path, &me) {
            return Some((status, json!({"error": msg, "kind": kind})));
        }
        let rows = crate::access::Place::from_json(&s.access["place"]).rows(route.kind().name()).ok()?;
        let store = self.store_for(&s.access)?;
        let (status, v) = crate::equip_write::handle(&store, route, query, body, &rows)?;
        if method != "GET" && (200..300).contains(&status) {
            self.invalidate(); // 一覧の設定（設備名の読み替え）を捨てる（Python が書いたときの after_python と同じ）
        }
        Some((status, v))
    }

    /// 一覧の表示の初期設定の 2 本（版 3.78.0。src/ui_defaults.rs）を窓が受ける。置けるのは開発者だけ（route が見る。門番の外）。
    /// 判定の材料（access）・範囲の名前が無い・me を決められない・置き場を読めない・窓が答えない形は None（Python が答える）
    fn ui_defaults_route(&self, route: crate::ui_defaults::Route, body: &[u8], ask: AskSettings) -> Option<(u16, Value)> {
        let s = self.settings(ask).ok()?;
        let profile = s.ui_profile_keys.clone()?;
        if !s.access.is_object() {
            return None;
        }
        if route == crate::ui_defaults::Route::Put {
            self.gate.forget(); // 書く前は、いまの権限の表で決める（ほかの書く道と同じ）
        }
        let me = self.gate.me(&s.access).ok()?;
        let rows = crate::access::Place::from_json(&s.access["place"]).rows(crate::ui_defaults::NAME).ok()?;
        let store = self.store_for(&s.access)?;
        crate::ui_defaults::handle(&store, &me, route, body, &rows, &profile)
    }

    /// ダッシュボードのセットの 4 本（版 3.79.0。src/dash_sets.rs）。設定・権限・置き場が無い・窓が答えない形は Python が答える
    fn dash_sets_route(&self, route: crate::dash_sets::Route, query: &str, body: &[u8], ask: AskSettings) -> Option<(u16, Value)> {
        let s = self.settings(ask).ok()?;
        if !s.access.is_object() {
            return None;
        }
        if route != crate::dash_sets::Route::List {
            self.gate.forget(); // 書く前は、いまの権限の表で決める（ほかの書く道と同じ）
        }
        let me = self.gate.me(&s.access).ok()?;
        let place = crate::access::Place::from_json(&s.access["place"]);
        let store = self.store_for(&s.access)?;
        crate::dash_sets::answer(&store, &me, route, query, body, &place)
    }

    /// ダッシュボードの 5 本（版 3.82.0。src/dashboards_write.rs）。書けるかは範囲で決める（セットと同じ。門番の外）
    fn dashboards_route(&self, route: crate::dashboards_write::Route, query: &str, body: &[u8], ask: AskSettings) -> Option<(u16, Value)> {
        let s = self.settings(ask).ok()?;
        if !s.access.is_object() {
            return None;
        }
        if route != crate::dashboards_write::Route::List {
            self.gate.forget(); // 書く前は、いまの権限の表で決める（ほかの書く道と同じ）
        }
        let me = self.gate.me(&s.access).ok()?;
        let place = crate::access::Place::from_json(&s.access["place"]);
        let store = self.store_for(&s.access)?;
        crate::dashboards_write::answer(&store, &me, route, query, body, &place)
    }

    /// 集計表・グラフの組み方のプリセットの 5 本（版 3.81.0。src/pivot_presets.rs）。書けるかは範囲で決める（セットと同じ。門番の外）
    fn presets_route(&self, route: crate::pivot_presets::Route, query: &str, body: &[u8], ask: AskSettings) -> Option<(u16, Value)> {
        let s = self.settings(ask).ok()?;
        if !s.access.is_object() {
            return None;
        }
        if route != crate::pivot_presets::Route::List {
            self.gate.forget(); // 書く前は、いまの権限の表で決める（ほかの書く道と同じ）
        }
        let me = self.gate.me(&s.access).ok()?;
        let place = crate::access::Place::from_json(&s.access["place"]);
        let store = self.store_for(&s.access)?;
        crate::pivot_presets::answer(&store, &me, route, query, body, &place)
    }

    /// カードの設計の 4 本（版 3.80.0。src/card_forms.rs）。書けるかは範囲で決める（セットと同じ。門番の外）
    fn cards_route(&self, route: crate::card_forms::Route, query: &str, body: &[u8], ask: AskSettings) -> Option<(u16, Value)> {
        let s = self.settings(ask).ok()?;
        if !s.access.is_object() {
            return None;
        }
        if route != crate::card_forms::Route::List {
            self.gate.forget(); // 書く前は、いまの権限の表で決める（ほかの書く道と同じ）
        }
        let me = self.gate.me(&s.access).ok()?;
        let place = crate::access::Place::from_json(&s.access["place"]);
        let store = self.store_for(&s.access)?;
        crate::card_forms::answer(&store, &me, route, query, body, &place)
    }

    /// 共有の書式の 4 本（版 3.80.0。src/formats_write.rs）。書くのは門番（現場のマスタと同じ権限）を通す。設定・権限・置き場が無い・
    /// 窓が答えない形は Python が答える
    fn formats_route(
        &self,
        method: &str,
        path: &str,
        route: crate::formats_write::Route,
        query: &str,
        body: &[u8],
        ask: AskSettings,
    ) -> Option<(u16, Value)> {
        let s = self.settings(ask).ok()?;
        if !s.access.is_object() {
            return None;
        }
        if route != crate::formats_write::Route::List {
            self.gate.forget(); // 書く前は、いまの権限の表で決める（ほかの書く道と同じ）
        }
        let me = self.gate.me(&s.access).ok()?;
        if let Some((status, kind, msg)) = crate::access::guard(method, path, &me) {
            return Some((status, json!({"error": msg, "kind": kind})));
        }
        let place = crate::access::Place::from_json(&s.access["place"]);
        let store = self.store_for(&s.access)?;
        crate::formats_write::answer(&store, &me, route, query, body, &place)
    }

    /// データ元の並び（版 3.87.0。GET /api/sources: src/sources_list.rs）。窓の束を組めない・権限や置き場を決められない・
    /// Python と同じに組めない形は Python が答える。card はスケジュールのカード（中身が起きていれば Python の答え）
    /// 名乗り・置き場・設定は、この道が読む材料（Builder::inputs）から取る（束全体を組めない PC〈共有にまだ設備マスタなどの最初の版が
    /// 無い〉でも答える。束を Python に尋ねた答えと、この道で読んだ並びの 2 つの時点を混ぜない）
    pub fn sources_list(&self, query: &str, _ask: AskSettings, card: &dyn Fn() -> Option<Value>) -> Option<(u16, Value)> {
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        let builder = self.bundle.lock().unwrap().clone()?;
        let inp = builder.inputs().ok()?;
        // 品質の写しを Python が受け持つ設定（desktop.lotlist_engine = python）は、ほかの道と同じく Python に任せる
        let engine = match inp.settings.get("desktop") {
            Some(Value::Object(o)) => o.get("lotlist_engine").cloned().unwrap_or(json!("rust")),
            None | Some(Value::Null) => json!("rust"),
            Some(_) => return None,
        };
        if engine != "rust" {
            return None;
        }
        let access = json!({"who": inp.who, "place": inp.place});
        let me = self.gate.me(&access).ok()?;
        let store = self.store_for(&access)?;
        // スケジュールのカード（版 3.96.0）: 窓の係の状態のファイルから（受け身の Python の答えと同じ所を読む）。設定を組めなければ中身に尋ねる
        let cfg = crate::schedule::Cfg::from_section(inp.eff.get("schedule")).ok();
        let own = || cfg.as_ref().map(|c| self.lists.sched.card(c)).or_else(card);
        let live = crate::sources_list::Live {
            lot: self.mirror.lock().unwrap().clone(),
            cache: self.cache_dir.clone(),
            src: &self.lists.src,
            joins: self.cache_dir.join("joins"),
            card: &own,
        };
        crate::sources_list::answer(&inp, &me, &store, &live).map(|v| (200, v))
    }

    /// 参照先の項目の 2 本（版 3.89.0。src/settings_write.rs）を窓が受ける。材料は窓の束の材料（Inputs。Python が居なくても読める）、
    /// 書く道は権限を読み直して門番に通し、窓の書く係で書く。書いたら一覧の設定を捨て、品質の元・実績のフォルダを当て直す
    /// （Python の put_setting と同じ。更新の置き場は main.rs が更新の係を起こす）。組めない・窓が答えない形は None（Python が答える）
    pub fn settings_route(&self, route: crate::settings_write::Route, query: &str, body: &[u8], ask: AskSettings) -> Option<(u16, Value)> {
        use crate::settings_write::{Route, NAME};
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        let builder = self.bundle.lock().unwrap().clone()?;
        let inp = builder.inputs().ok()?;
        inp.check(NAME).ok()?;
        let access = json!({"who": inp.who, "place": inp.place});
        let (method, path) = match &route {
            Route::Get => ("GET", "/api/settings".to_string()),
            Route::Put(k) => ("PUT", format!("/api/settings/{k}")),
        };
        if method != "GET" {
            self.gate.forget(); // 書く前は、いまの権限の表で決める
        }
        let me = self.gate.me(&access).ok()?;
        if let Some((status, kind, msg)) = crate::access::guard(method, &path, &me) {
            return Some((status, json!({"error": msg, "kind": kind})));
        }
        let store = self.store_for(&access)?;
        match route {
            Route::Get => {
                let items = inp.settings_items().ok()?;
                let share = inp.place["shareDir"].as_str().unwrap_or("");
                Some((200, crate::settings_write::get_answer(items, &store, share, &builder.config_file())))
            }
            Route::Put(key) => {
                // 書いた後に Python が配った設定へ重ねて落ちる形（段が表でない）は、Python に任せて同じ答えにする（作った後の採点で見つけた）
                inp.settings_items().ok()?;
                if !crate::bundle::sections_ok(&inp.settings, &key) {
                    return None;
                }
                let rows = crate::access::Place::from_json(&inp.place).rows(NAME).ok()?;
                let (status, v) = crate::settings_write::put(&store, &key, query, body, &rows)?;
                if (200..300).contains(&status) {
                    self.invalidate(); // 一覧の設定（元ファイル・間隔・しきい・実績の決まり）を次の問い合わせで組み直す
                    match crate::settings_write::after_of(&key) {
                        "lot_list." => self.warm(ask), // 品質の写しを、起動し直さずに新しい元・間隔へ切り替える（lot_mirror と同じ）
                        "work_log." => self.lists.forget_listing(), // 実績のフォルダ・決まりを変えた → 次は探し直す
                        _ => {}
                    }
                }
                Some((status, v))
            }
        }
    }

    /// 更新と配布の流れの 4 本（版 3.95.0。src/release_place.rs）: GET /api/update/settings・POST /api/release/place/check・move・
    /// GET progress。材料は窓の束の材料（Python が居なくても読める）。?engine=python は Python（move は Python が断る: 写す係は窓の 1 つ）。
    /// 束の材料を組めない形は、更新の置き場は Python に任せ、move の門番は「権限を読めない」で断る（Python の Mover を動かさない）
    pub fn release_route(&self, route: crate::release_place::Route, query: &str, body: &[u8]) -> Option<(u16, Value)> {
        use crate::release_place::Route;
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        if route == Route::Settings {
            return self.update_settings().map(|v| (200, v));
        }
        let builder = self.bundle.lock().unwrap().clone();
        // Python の今のフォルダ（中身のフォルダ。sidecar.rs の current_dir）から相対の道を見る
        let cwd = builder.as_ref().map(|b| b.env().program.clone()).unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
        let me = || -> Result<Value, String> {
            let b = builder.as_ref().ok_or("設定の束を組む係がありません")?;
            let inp = b.inputs().map_err(|e| format!("配った設定・マスタの置き場を読めません: {}", e.0))?;
            self.gate.forget(); // 置き場を変える前は、いまの権限の表で決める
            self.gate.me(&json!({"who": inp.who, "place": inp.place}))
        };
        crate::release_place::handle(route, query, body, &me, &self.release, &cwd)
    }

    /// GET /api/update/settings の答え（版 3.95.0。更新の係・配布の画面と操作〈main.rs〉もここから読む）。束の材料を組めない・
    /// 更新の置き場を Python と同じ字にできない形は None（Python に尋ねる）
    pub fn update_settings(&self) -> Option<Value> {
        let builder = self.bundle.lock().unwrap().clone()?;
        let inp = builder.inputs().ok()?;
        let source = inp.update_source().ok()?;
        let me = self.gate.me(&json!({"who": inp.who, "place": inp.place}));
        let share = inp.place["shareDir"].as_str().unwrap_or("").to_string();
        Some(crate::release_place::settings_answer(&source, &me, &share))
    }

    /// データ元の書く道の 7 本（版 3.90.0。src/sources_write.rs）を窓が受ける。材料は窓の束の材料（GET /api/sources と同じ並び）、
    /// 書く道は権限を読み直して門番に通し、窓の書く係で書く。書いたら一覧の設定と権限の覚えを捨てる（Python が書いたときの after_python と同じ）。
    /// 接続の設定で参照先の項目を書いたときは、参照先を書いたときと同じ後始末（品質の写し・実績のフォルダの覚え）。組めない・窓が答えない形は None
    pub fn sources_write_route(
        &self,
        method: &str,
        path: &str,
        route: crate::sources_write::Route,
        query: &str,
        body: &[u8],
        ask: AskSettings,
    ) -> Option<(u16, Value)> {
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        let builder = self.bundle.lock().unwrap().clone()?;
        let inp = builder.inputs().ok()?;
        for name in ["data_sources", "path_settings"] {
            inp.check(name).ok()?;
        }
        let parts = inp.sources_parts().ok()?;
        let access = json!({"who": inp.who, "place": inp.place});
        self.gate.forget(); // 書く前は、いまの権限の表で決める
        let me = self.gate.me(&access).ok()?;
        if let Some((status, kind, msg)) = crate::access::guard(method, path, &me) {
            return Some((status, json!({"error": msg, "kind": kind})));
        }
        let store = self.store_for(&access)?;
        let place = crate::access::Place::from_json(&inp.place);
        let rows = place.rows(crate::sources_write::NAME).ok()?;
        let ps_rows = place.rows(crate::settings_write::NAME).ok()?;
        let settings = inp.settings.clone();
        let settings_ok = |k: &str| crate::bundle::sections_ok(&settings, k);
        let cx = crate::sources_write::Ctx {
            items: &parts.items,
            rows: &rows,
            ps_rows: &ps_rows,
            new_key: &|| match self.new_key.lock().unwrap().clone() {
                Some(f) => Some(f()),
                None => crate::sources_write::new_key(),
            },
            settings_ok: &settings_ok,
        };
        let done = crate::sources_write::handle(&store, &route, query, body, &cx)?;
        let (status, v) = done.answer;
        if (200..300).contains(&status) {
            self.invalidate(); // 一覧の設定（データ元の並び・場所・結合）を次の問い合わせで組み直す
            self.gate.forget(); // データ元を書いた: 次の問い合わせで me を読み直す（after_python と同じ）
            match done.setting.as_deref().map(crate::settings_write::after_of) {
                Some("lot_list.") => self.warm(ask),
                Some("work_log.") => self.lists.forget_listing(),
                _ => {}
            }
        }
        Some((status, v))
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
                                // 参照先・データ元の接続を Python が書いた（実績のフォルダ・決まりかもしれない）: フォルダの覚えも捨てる
                                // （版 3.91.0。Python の _listing が参照先の印で捨てるのと同じ。A → B → A と置き直した 10 秒の内に古い中身を返さない）
            if path.starts_with("/api/settings/") || path.starts_with("/api/sources") || path.starts_with("/api/masters/place") {
                self.lists.forget_listing();
            }
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
        // 窓が組めれば窓の束（Python が起きていなくても答えられる）。組めない形（bundle.rs の Py）だけ Python に尋ねる
        let b = self.bundle.lock().unwrap().clone();
        let own = b.as_ref().and_then(|b| b.build().ok());
        let mine = own.is_some();
        let mut v = match own {
            Some(v) => v,
            None => ask()?,
        };
        // スケジュールの設定（版 3.96.0）: 窓の束の材料の schedule の段（effective_settings と同じ重ね方）。Python に尋ねた設定には
        // 入れない（窓は設定を組めないので、スケジュールの道は Python が答え、知らせに設定を載せて窓に取らせる）
        if mine {
            if let (Some(inp), Some(l)) = (b.and_then(|b| b.inputs().ok()), v.get_mut("lists").and_then(Value::as_object_mut)) {
                l.insert("scheduleConf".into(), inp.eff.get("schedule").cloned().unwrap_or(Value::Null));
            }
        }
        let s = Settings::from_json(&v);
        *self.settings.lock().unwrap() = Some((Instant::now(), s.clone()));
        Ok(s)
    }

    /// 段取りの材料（lists）に、窓が決めた権限を重ねた物（版 3.65.1。順 5 の 1 段目 b）: 出さないタブ（hidden）と勤務体系を直せるか
    /// （work.canEditShifts）は、門番と同じ窓の me から決める（判定の元を 1 つに。窓が権限を受け持つとき、Python はこの 2 つを決めず null で返す）。
    /// None なら窓は答えず Python に任せる: 判定の材料（access）があるのに窓が me を決められない（権限の表を読めない）・材料が無く Python も
    /// 決めていない（hidden が null）。材料が無く Python が決めた値がある（窓が権限を受け持たない前の版の Python）ときは、その値のまま
    pub fn lists_of(&self, s: &Settings) -> Option<Value> {
        let mut v = s.lists.clone();
        if !s.access.is_object() {
            let python_decided = v.is_null() || v["hidden"].is_array();
            return python_decided.then_some(v);
        }
        let m = self.gate.me(&s.access).ok()?;
        if let Some(o) = v.as_object_mut() {
            o.insert("hidden".into(), m["flags"]["hiddenTabs"].clone());
            if let Some(w) = o.get_mut("work").and_then(Value::as_object_mut) {
                w.insert("canEditShifts".into(), json!(crate::access::can_write(&m, "shift_patterns")));
            }
        }
        Some(v)
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

    /// 利用状況に書く版を、中身（program）の置き場から読む（main.rs）
    pub fn set_program(&self, program: PathBuf) {
        self.presence.set_program(program);
    }

    /// 使い終わり（終了ボタン。main.rs）: いま使っているの印を消し、記録を最後まで書く
    pub fn leave(&self) {
        self.presence.leave();
    }

    /// 心拍（POST /api/heartbeat。版 3.71.0）。先に me を決め（設定を尋ねる＝止まった中身を起こし直しうる）、次に中身が生きているかを見る。
    /// 止まっていれば 503（画面は答えが来たかで「接続 ●」と計算のやり直しを決める）。me を決められなければ書かずに空の答え
    /// （Python と同じ）。設定を尋ねられないが中身は生きている・判定の材料が無い（前の版の Python）ときは None（Python が答える。書かない）
    pub fn heartbeat(&self, ask: AskSettings, alive: &dyn Fn() -> bool) -> Option<(u16, Value)> {
        let down = || Some((503, json!({"error": "アプリの中身（Python）が答えません。", "kind": "backend_unavailable"})));
        let s = match self.settings(ask) {
            Ok(s) => s,
            Err(_) => return if alive() { None } else { down() },
        };
        if !s.access.is_object() {
            return None;
        }
        let me = self.gate.me(&s.access);
        if !alive() {
            return down();
        }
        self.presence.configure(crate::access::Place::from_json(&s.access["place"]).presence);
        Some((
            200,
            match me {
                Ok(m) => {
                    self.presence.beat_async(&m);
                    self.presence.answer(&m)
                }
                Err(_) => json!({"version": null, "revoked": null}),
            },
        ))
    }

    /// 利用状況の 7 本と画面の設定の控え（版 3.71.0）。me を決められないとき・engine=python（窓の自己診断が Python との枠を確かめる）は
    /// None（Python が答える）
    fn presence_route(&self, method: &str, path: &str, query: &str, body: &[u8], ask: AskSettings) -> Option<(u16, Value)> {
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        match (method, path) {
            ("GET", "/api/ui-state") => return presence::ui_state::load_exact(&self.local_root).map(|v| (200, v)),
            ("POST", "/api/ui-state") => return presence::ui_state::post(&self.local_root, body),
            _ => {}
        }
        let s = self.settings(ask).ok()?;
        if !s.access.is_object() {
            return None;
        }
        let me = self.gate.me(&s.access).ok()?;
        self.presence.handle_with_place(&me, &crate::access::Place::from_json(&s.access["place"]), method, path, query, body)
    }

    /// 転写距離・ピッチ計算と検査計の有無（版 3.72.0。src/calc.rs）。設定の calculation・置き場が無い・マスタを読めない・
    /// engine=python・窓が答えない形（calc::handle が None）は Python が答える
    fn calc_route(&self, path: &str, query: &str, body: &[u8], ask: AskSettings) -> Option<(u16, Value)> {
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        let s = self.settings(ask).ok()?;
        let calculation = s.calculation.as_ref()?;
        if !s.access.is_object() {
            return None;
        }
        let place = crate::access::Place::from_json(&s.access["place"]);
        let masters = crate::calc::Masters::new(place.rows("equipment_master").ok()?, place.rows("roll_master").ok()?)?;
        crate::calc::handle(path, body, calculation, &masters)
    }

    /// 本文のある問い合わせも見る入口（main.rs）。ダッシュボードのパネルの数（POST /api/dashboard/query。版 3.62.0）は本文 {panel} で答え、
    /// ほかは handle と同じ
    pub fn handle_body(&self, method: &str, path: &str, query: &str, body: &[u8], ask: AskSettings) -> Option<(u16, Value)> {
        if let Some(route) = crate::release_place::route_of(method, path) {
            return self.release_route(route, query, body);
        }
        if let Some(route) = crate::access_write::route_of(method, path) {
            return self.access_write(method, path, route, query, body, ask);
        }
        if crate::calc::is_route(method, path) {
            return self.calc_route(path, query, body, ask);
        }
        if let Some(route) = crate::shifts_write::route_of(method, path) {
            return self.shifts_route(method, path, route, query, body, ask);
        }
        if let Some(route) = crate::settings_write::route_of(method, path) {
            return self.settings_route(route, query, body, ask);
        }
        if let Some(route) = crate::sources_write::route_of(method, path) {
            return self.sources_write_route(method, path, route, query, body, ask);
        }
        if let Some(route) = crate::worklog_write::route_of(method, path) {
            return self.worklog_route(method, path, route, query, body, ask);
        }
        if let Some(route) = crate::conversions_write::route_of(method, path) {
            return self.conversions_route(method, path, route, query, body);
        }
        if let Some(route) = crate::equipgroups_write::route_of(method, path) {
            return self.equipgroups_route(method, path, route, query, body, ask);
        }
        if let Some(route) = crate::equip_write::route_of(method, path) {
            return self.equip_route(method, path, route, query, body, ask);
        }
        if let Some(route) = crate::ui_defaults::route_of(method, path) {
            return self.ui_defaults_route(route, body, ask);
        }
        if let Some(route) = crate::dash_sets::route_of(method, path) {
            return self.dash_sets_route(route, query, body, ask);
        }
        if let Some(route) = crate::card_forms::route_of(method, path) {
            return self.cards_route(route, query, body, ask);
        }
        if let Some(route) = crate::pivot_presets::route_of(method, path) {
            return self.presets_route(route, query, body, ask);
        }
        if let Some(route) = crate::dashboards_write::route_of(method, path) {
            return self.dashboards_route(route, query, body, ask);
        }
        if let Some(route) = crate::formats_write::route_of(method, path) {
            return self.formats_route(method, path, route, query, body, ask);
        }
        if presence::is_route(method, path) || path == "/api/ui-state" {
            return self.presence_route(method, path, query, body, ask);
        }
        // 最初の画面が尋ねる読む道（版 3.85.0）: 画面の設定・ダッシュボードのデータの並び・設備の木
        match (method, path) {
            ("GET", "/api/config") => return self.config_route(),
            ("GET", "/api/dashboard/sources") => {
                let s = self.settings(ask).ok()?;
                if s.engine != "rust" || s.lists.get("dash").is_none_or(Value::is_null) {
                    return None;
                }
                let lists = self.lists_of(&s)?;
                return dashboard::sources_answer(&Conf { v: &lists }, &crate::bundle::tables()["periods"]).map(|v| (200, v));
            }
            ("GET", "/api/dashboard/equip-tree") => return self.with_dash(ask, dashboard::equip_tree_answer).map(|v| (200, v)),
            // スケジュールの設備のタブと設定・データ元の一覧の行の様子（版 3.96.0。Python の schedule_meta・schedule_card）
            ("GET", "/api/schedule" | "/api/schedule/card") => {
                if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
                    return None;
                }
                let s = self.settings(ask).ok()?;
                if s.engine != "rust" {
                    return None;
                }
                let cfg = crate::schedule::Cfg::from_section(Some(s.lists.get("scheduleConf")?)).ok()?;
                return Some((200, if path == "/api/schedule" { self.lists.sched.meta(&cfg) } else { self.lists.sched.card(&cfg) }));
            }
            _ => {}
        }
        if (method, path) != ("POST", "/api/dashboard/query") {
            return self.handle(method, path, query, ask);
        }
        if lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
            return None;
        }
        self.with_dash(ask, |cx| dashboard::query(cx, body))
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
        let qs = lotlist::parse_query(query);
        let arg = |k: &str| qs.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()).unwrap_or_default();
        let lists = &self.lists;
        // データの時刻・再読込は出さないタブを見ない（前の版から）: 権限を決める前に答える（窓が me を決められなくても窓の写しの係が答え、
        // Python に回して同じ台帳に写しの係を 2 つ動かさない）
        let raw = Conf { v: &s.lists };
        match &route {
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
            // スケジュール（版 3.96.0 から窓が係）: データの時刻は覚えから答えて古い設備を裏で取り直し、再読込は今すぐ取り直す
            // （Python の src_source・src_refresh の cm3。出さないタブは見ない）
            Route::Src(key, Kind::Source) if raw.source(key).is_some_and(|d| d["kind"] == "cm3") => {
                return lists.sch_source(&raw, &arg("equip"));
            }
            Route::Src(key, Kind::Refresh) if raw.source(key).is_some_and(|d| d["kind"] == "cm3") => {
                let q = Quality { mirror: m.clone(), table: &s.table, page_size: s.page_size };
                return lists.sch_refresh(&raw, &q, key, &arg("equip"));
            }
            Route::Src(key, Kind::Source) => {
                let d = raw.source(key);
                let k = d.and_then(|d| d["base"].as_str()).filter(|b| !b.is_empty()).unwrap_or(key).to_string();
                let mm = if k == "lot" { Some(m.clone()) } else { lists.src.peek(&k) };
                return Some(match mm {
                    None => (404, json!({"error": "まだ開いていないデータ元です。", "kind": "unknown"})),
                    Some(x) => (200, x.source_info()),
                });
            }
            _ => {}
        }
        let lists_v = self.lists_of(&s)?; // 窓が権限を決められない: Python に任せる（出さないタブを見る道）
        let conf = Conf { v: &lists_v };
        let q = Quality { mirror: m.clone(), table: &s.table, page_size: s.page_size };
        let (what, plan) = match &route {
            Route::Lot(k) => (*k, lists.lot_plan(&conf, &q, true)),
            Route::Work(k) => (*k, lists.work_plan(&conf, &q, &arg("equip"), *k != Kind::Refresh, true)),
            Route::Src(key, k) => {
                let refresh = *k == Kind::Refresh;
                match lists.src_plan_eq(&conf, &q, key, !refresh, !refresh, &arg("equip"), false) {
                    Ok(None) => return None, // 窓が答えない形（スケジュールの設定を組めない・係を降りた）は Python
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
        // スケジュールの答えに添える数（設備の札・HOT の札。Python の schedule_extra）。組めなければ Python に任せる
        let extra = match plan.sched {
            Some(_) => Some(lists.sch_extra(&plan)?),
            None => None,
        };
        Some(match lotlist::query(&path, &args, &opts, today, &self.tables(&s), grouping.as_mut()) {
            Ok(mut v) => {
                v["source"] = source;
                if let Some(x) = extra {
                    v["schedule"] = x;
                }
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
    fn the_window_answers_ui_defaults() {
        // 版 3.78.0: 一覧の表示の初期設定の 2 本は窓が受ける（本物の道: Lot::handle_body → ui_defaults_route）。範囲の名前は一覧の設定の答え
        // （uiProfileKeys）から。答えに無い（前の版の Python）・判定の材料が無い・窓が読めない本文は Python に任せる
        let dir = std::env::temp_dir().join(format!("da-lot-uidef-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (share, local) = (dir.join("share"), dir.join("local"));
        for d in [&share, &local, &dir.join("data")] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(local.join("instance_id"), "inst1").unwrap();
        let perm = json!([{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "rev": 1},
                          {"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー", "rev": 1}]);
        std::fs::write(share.join("access_permissions.json"), json!({"schema": 1, "revision": 1, "rows": perm}).to_string()).unwrap();
        let conf = |login: &str| {
            json!({"who": {"login": login, "pc": "PC-1", "pcSource": "", "key": format!("PC-1@{login}")},
                   "place": {"shareDir": share, "shared": ["access_permissions", "tab_access", "ui_defaults"], "data": dir.join("data"),
                             "defaults": dir.join("defaults"), "cache": local.join("master_cache"), "presence": "", "lockTtl": 20.0}})
        };
        let (boss, u1) = (conf("boss"), conf("u1"));
        let keys = json!(["tpa.lotlist.layout.v1", "tpa.lotlist.pageSize.v1"]);
        let ask_boss =
            || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": boss.clone(), "uiProfileKeys": keys.clone()}));
        let ask_u1 =
            || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": u1.clone(), "uiProfileKeys": keys.clone()}));
        let lot = Lot::new(dir.join("cache"));
        let (st, v) = lot.handle_body("GET", "/api/ui-defaults", "", b"", &ask_boss).expect("窓が受ける");
        assert_eq!(
            (st, v["canPublish"].clone(), v["keys"].clone(), v["defaults"].clone()),
            (200, json!(true), keys.clone(), json!({})),
            "{v}"
        );
        let body = serde_json::to_vec(&json!({"keys": {"tpa.lotlist.pageSize.v1": "50", "知らない": "x"}})).unwrap();
        let (st, v) = lot.handle_body("PUT", "/api/ui-defaults", "", &body, &ask_boss).unwrap();
        assert_eq!((st, v["count"].clone(), v["defaults"].clone()), (200, json!(1), json!({"tpa.lotlist.pageSize.v1": "50"})), "{v}");
        let d: Value = serde_json::from_slice(&std::fs::read(share.join("ui_defaults.json")).unwrap()).unwrap();
        assert_eq!(d["rows"][0]["名前"], json!("tpa.lotlist.pageSize.v1"), "共有に置く");
        assert_eq!(lot.handle_body("PUT", "/api/ui-defaults", "", b"[1]", &ask_boss).unwrap().0, 400, "表でない本文は 400");
        let lot_u1 = Lot::new(dir.join("cache-u1"));
        assert_eq!(lot_u1.handle_body("GET", "/api/ui-defaults", "", b"", &ask_u1).unwrap().1["canPublish"], json!(false));
        assert_eq!(lot_u1.handle_body("PUT", "/api/ui-defaults", "", &body, &ask_u1).unwrap().0, 403, "開発者でなければ置けない");
        // Python に任せる: 範囲の名前が無い・判定の材料が無い・窓が読めない本文・ほかの方法
        let old = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": boss.clone()}));
        assert!(Lot::new(dir.join("c2")).handle_body("GET", "/api/ui-defaults", "", b"", &old).is_none(), "前の版の Python");
        let none = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "uiProfileKeys": keys.clone()}));
        assert!(Lot::new(dir.join("c3")).handle_body("GET", "/api/ui-defaults", "", b"", &none).is_none());
        assert!(lot.handle_body("PUT", "/api/ui-defaults", "", br#"{"keys": {}, "x": NaN}"#, &ask_boss).is_none());
        assert!(lot.handle_body("POST", "/api/ui-defaults", "", b"{}", &ask_boss).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_window_answers_dashboard_sets() {
        // 版 3.79.0: ダッシュボードのセットの 4 本は窓が受ける（本物の道: Lot::handle_body → dash_sets_route）。判定の材料が無い・
        // 窓が Python と同じに書けない本文（小数の名前・NaN）・置き場の行の形が違う・ASCII でない id の道は Python に任せる
        let dir = std::env::temp_dir().join(format!("da-lot-sets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (share, local) = (dir.join("share"), dir.join("local"));
        for d in [&share, &local, &dir.join("data")] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(local.join("instance_id"), "inst1").unwrap();
        let perm = json!([{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "rev": 1}]);
        let doc = |rows: Value| json!({"schema": 1, "revision": 1, "rows": rows}).to_string();
        std::fs::write(share.join("access_permissions.json"), doc(perm)).unwrap();
        let dash = json!([{"id": 1, "名前": "標準", "元": "dash", "範囲": "共通デフォルト", "ログインID": "", "標準": "1", "中身": "{}", "備考": "", "rev": 1}]);
        std::fs::write(share.join("dashboards.json"), doc(dash)).unwrap();
        let conf = json!({"who": {"login": "boss", "pc": "PC-1", "pcSource": "", "key": "PC-1@boss"},
                          "place": {"shareDir": share, "shared": ["access_permissions", "tab_access", "dashboards"], "data": dir.join("data"),
                                    "defaults": dir.join("defaults"), "cache": local.join("master_cache"), "presence": "", "lockTtl": 20.0}});
        let ask = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": conf.clone()}));
        let lot = Lot::new(dir.join("cache"));
        let (st, v) = lot.handle_body("GET", "/api/dashboard-sets", "", b"", &ask).expect("窓が受ける");
        assert_eq!((st, v["items"].clone(), v["max"].clone(), v["standardId"].clone()), (200, json!([]), json!(12), Value::Null), "{v}");
        let body = serde_json::to_vec(&json!({"name": "朝", "scope": "me", "standard": true, "body": {"items": ["1", "b:standard", "1"]}}))
            .unwrap();
        let (st, v) = lot.handle_body("POST", "/api/dashboard-sets", "", &body, &ask).unwrap();
        assert_eq!(
            (st, v["id"].clone(), v["body"].clone(), v["standard"].clone()),
            (201, json!(2), json!({"items": ["1", "b:standard"]}), json!(true)),
            "{v}"
        );
        let d: Value = serde_json::from_slice(&std::fs::read(share.join("dashboards.json")).unwrap()).unwrap();
        assert_eq!(d["rows"][1]["中身"], json!(r#"{"items": ["1", "b:standard"]}"#), "置く字は json.dumps と同じ");
        assert_eq!(d["rows"][0]["標準"], json!("1"), "ほかの元（ダッシュボード）の★は外さない");
        let (st, v) = lot.handle_body("GET", "/api/dashboard-sets", "", b"", &ask).unwrap();
        assert_eq!((st, v["standardId"].clone(), v["items"][0]["name"].clone()), (200, json!(2), json!("朝")), "{v}");
        let (st, _) = lot.handle_body("PUT", "/api/dashboard-sets/2", "", r#"{"name": "朝 2", "base_rev": 9}"#.as_bytes(), &ask).unwrap();
        assert_eq!(st, 409, "開いてから変わった行は直さない");
        assert_eq!(lot.handle_body("PUT", "/api/dashboard-sets/1", "", br#"{"name": "x"}"#, &ask).unwrap().0, 400, "セットでない行");
        assert_eq!(lot.handle_body("DELETE", "/api/dashboard-sets/2", "rev=1", b"", &ask).unwrap(), (200, json!({"ok": true})));
        // Python に任せる: 判定の材料が無い・書けない本文・ASCII でない id
        let none = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}}));
        assert!(Lot::new(dir.join("c2")).handle_body("GET", "/api/dashboard-sets", "", b"", &none).is_none());
        assert!(lot
            .handle_body("POST", "/api/dashboard-sets", "", br#"{"name": 1.5, "scope": "me", "body": {"items": ["1"]}}"#, &ask)
            .is_none());
        assert!(lot.handle_body("POST", "/api/dashboard-sets", "", br#"{"name": "a", "x": NaN}"#, &ask).is_none());
        assert!(lot.handle_body("PUT", "/api/dashboard-sets/２", "", b"{}", &ask).is_none());
        assert!(lot.handle_body("PATCH", "/api/dashboard-sets/2", "", b"{}", &ask).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_window_answers_formats_and_card_forms() {
        // 版 3.80.0: 共有の書式とカードの設計の 4 本ずつは窓が受ける（本物の道: Lot::handle_body → formats_route・cards_route）。
        // 書式は門番を通し、中身は送った順のまま置く。窓が Python と同じに書けない本文・数の字・ASCII でない id の道は Python に任せる
        let dir = std::env::temp_dir().join(format!("da-lot-fmtcard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (share, local) = (dir.join("share"), dir.join("local"));
        for d in [&share, &local, &dir.join("data")] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(local.join("instance_id"), "inst1").unwrap();
        let perm = json!([{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "rev": 1}]);
        let doc = |rows: Value| json!({"schema": 1, "revision": 1, "rows": rows}).to_string();
        std::fs::write(share.join("access_permissions.json"), doc(perm)).unwrap();
        std::fs::write(share.join("display_formats.json"), doc(json!([]))).unwrap();
        std::fs::write(share.join("dashboards.json"), doc(json!([]))).unwrap();
        let conf = json!({"who": {"login": "boss", "pc": "PC-1", "pcSource": "", "key": "PC-1@boss"},
                          "place": {"shareDir": share, "shared": ["access_permissions", "tab_access", "dashboards", "display_formats"],
                                    "data": dir.join("data"), "defaults": dir.join("defaults"), "cache": local.join("master_cache"),
                                    "presence": "", "lockTtl": 20.0}});
        let ask = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": conf.clone()}));
        let lot = Lot::new(dir.join("cache"));
        // 共有の書式: 中身の鍵は送った順のまま（serde の Map の字の順ではない）
        let body = r#"{"name": "朝", "source": "lot", "body": {"sorts": [{"col": "b"}], "adhoc": {"z": 1, "a": 2}}}"#.as_bytes();
        let (st, v) = lot.handle_body("POST", "/api/masters/formats", "", body, &ask).expect("窓が受ける");
        assert_eq!((st, v["name"].clone()), (201, json!("朝")), "{v}");
        let d: Value = serde_json::from_slice(&std::fs::read(share.join("display_formats.json")).unwrap()).unwrap();
        assert_eq!(d["rows"][0]["中身"], json!(r#"{"sorts":[{"col":"b"}],"adhoc":{"z":1,"a":2}}"#), "置く字は送った順の json.dumps");
        let (st, v) = lot.handle_body("GET", "/api/masters/formats", "source=lot", b"", &ask).unwrap();
        assert_eq!((st, v["items"].as_array().map(Vec::len)), (200, Some(1)), "{v}");
        assert!(lot.handle_body("POST", "/api/masters/formats", "", br#"{"name": "a", "source": "lot", "x": NaN}"#, &ask).is_none());
        assert!(lot.handle_body("PUT", "/api/masters/formats/１", "", b"{}", &ask).is_none());
        // カードの設計
        let card = br#"{"name": "c", "source": "card:lotlist:T", "scope": "me", "body": {"items": [{"col": "a", "w": "4"}]}}"#;
        let (st, v) = lot.handle_body("POST", "/api/card-forms", "", card, &ask).unwrap();
        assert_eq!((st, v["body"]["items"][0]["w"].clone()), (201, json!(4)), "{v}");
        let (st, v) = lot.handle_body("GET", "/api/card-forms", "source=card%3Alotlist%3AT", b"", &ask).unwrap();
        assert_eq!((st, v["items"][0]["name"].clone()), (200, json!("c")), "{v}");
        assert_eq!(lot.handle_body("GET", "/api/card-forms", "source=bad", b"", &ask).unwrap().0, 400);
        let full = r#"{"name": "d", "source": "card:lotlist:T", "scope": "me", "body": {"items": [{"col": "a", "w": "４"}]}}"#;
        assert!(lot.handle_body("POST", "/api/card-forms", "", full.as_bytes(), &ask).is_none(), "全角の数の字は Python の int()");
        let none = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}}));
        assert!(Lot::new(dir.join("c2")).handle_body("GET", "/api/card-forms", "source=card%3Alotlist%3AT", b"", &none).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_window_answers_pivot_presets() {
        // 版 3.81.0: 組み方のプリセットの 5 本は窓が受ける（本物の道: Lot::handle_body → presets_route）。組み込みの組み方は焼いた表から。
        // 窓が Python と同じに読めない形（ASCII でないすぐに見るの id・NaN の本文・ASCII でない id の道）は Python に任せる
        let dir = std::env::temp_dir().join(format!("da-lot-presets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (share, local) = (dir.join("share"), dir.join("local"));
        for d in [&share, &local, &dir.join("data")] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(local.join("instance_id"), "inst1").unwrap();
        let doc = |rows: Value| json!({"schema": 1, "revision": 1, "rows": rows}).to_string();
        let perm = json!([{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "rev": 1}]);
        std::fs::write(share.join("access_permissions.json"), doc(perm)).unwrap();
        std::fs::write(share.join("pivot_presets.json"), doc(json!([]))).unwrap();
        std::fs::write(share.join("pivot_quick.json"), doc(json!([]))).unwrap();
        let conf = json!({"who": {"login": "boss", "pc": "PC-1", "pcSource": "", "key": "PC-1@boss"},
                          "place": {"shareDir": share, "shared": ["access_permissions", "tab_access", "pivot_presets", "pivot_quick"],
                                    "data": dir.join("data"), "defaults": dir.join("defaults"), "cache": local.join("master_cache"),
                                    "presence": "", "lockTtl": 20.0}});
        let ask = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": conf.clone()}));
        let lot = Lot::new(dir.join("cache"));
        let (st, v) = lot.handle_body("GET", "/api/pivot-presets", "source=lot", b"", &ask).expect("窓が受ける");
        assert_eq!((st, v["items"].as_array().map(Vec::len), v["quickCustom"].clone()), (200, Some(9), json!(false)), "{v}");
        let body = r#"{"name": "朝", "source": "lot", "scope": "me", "standard": true, "body": {"rows": [{"column": "工程"}], "measures": [{"agg": "sum", "column": "w", "dec": 2.5}]}}"#;
        let (st, v) = lot.handle_body("POST", "/api/pivot-presets", "", body.as_bytes(), &ask).unwrap();
        assert_eq!((st, v["body"]["measures"][0]["dec"].clone()), (201, json!(2)), "桁は偶数へ丸める: {v}");
        let (st, v) = lot.handle_body("PUT", "/api/pivot-quick", "", br#"{"source": "lot", "keys": ["1", "b:hist", "1"]}"#, &ask).unwrap();
        assert_eq!((st, v["quick"].clone()), (200, json!(["1", "b:hist"])), "{v}");
        let (_, v) = lot.handle_body("GET", "/api/pivot-presets", "source=lot", b"", &ask).unwrap();
        assert_eq!((v["quick"].clone(), v["standardId"].clone()), (json!(["1", "b:hist"]), json!(1)), "{v}");
        let q = "{\"source\": \"lot\", \"keys\": [\"\u{b2}\"]}";
        assert!(lot.handle_body("PUT", "/api/pivot-quick", "", q.as_bytes(), &ask).is_none(), "「²」は Python の isdigit");
        assert!(lot.handle_body("POST", "/api/pivot-presets", "", br#"{"name": "a", "x": NaN}"#, &ask).is_none());
        assert!(lot.handle_body("DELETE", "/api/pivot-presets/\u{ff11}", "", b"", &ask).is_none());
        assert_eq!(lot.handle_body("DELETE", "/api/pivot-presets/1", "rev=1", b"", &ask).unwrap(), (200, json!({"ok": true})));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_window_builds_the_settings_bundle_itself() {
        // 版 3.84.0: 束は窓が組む（Python が答えなくても窓の道が答える）。組めない形だけ Python に尋ねる
        let work = std::env::temp_dir().join(format!("da-lot-bundle-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(work.join("local")).unwrap();
        std::fs::create_dir_all(work.join("base")).unwrap();
        let program = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        std::fs::write(&cfg, r#"{"lot_list": {"source": "/q.sqlite3", "refresh_seconds": 30}, "master_share": {}}"#).unwrap();
        let env = crate::bundle::Env { base: work.join("base"), program, local: work.join("local"), config: cfg.clone(), now: None };
        let lot = Lot::new(work.join("local").join("db_cache"));
        lot.set_bundle(crate::bundle::Builder::new(env));
        let down = || -> Result<Value, String> { Err("中身（Python）が答えません".into()) };
        let s = lot.settings(&down).expect("Python が答えなくても束がある");
        assert_eq!((s.source.as_str(), s.refresh_seconds), ("/q.sqlite3", 30));
        assert!(s.access["who"]["key"].is_string() && s.lists["sources"].as_array().is_some_and(|a| a.len() >= 4), "{:?}", s.lists);
        // 組めない形（配った設定が読めない JSON）は Python に尋ねる
        std::fs::write(&cfg, r#"{"lot_list": {"page_size": NaN}}"#).unwrap();
        lot.invalidate();
        assert!(lot.settings(&down).is_err(), "組めず Python も答えなければ前と同じ失敗");
        let py = || -> Result<Value, String> { Ok(json!({"source": "/py.sqlite3"})) };
        assert_eq!(lot.settings(&py).unwrap().source, "/py.sqlite3");
        assert_eq!(lot.own_bundle().unwrap().unwrap_err(), "配った設定が窓の読めない JSON");
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn the_window_draws_the_page_without_python() {
        // 版 3.85.0: 画面と最初の画面の読む道は、中身（Python）が答えなくても窓が答える（本物の道: Lot::page・handle_body）
        let work = std::env::temp_dir().join(format!("da-lot-page-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        let share = work.join("share");
        for d in [work.join("local"), work.join("base"), share.clone()] {
            std::fs::create_dir_all(d).unwrap();
        }
        let program = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        std::fs::write(&cfg, json!({"master_share": {"dir": share}, "presence": {"heartbeat_interval_seconds": 5}}).to_string()).unwrap();
        let env = crate::bundle::Env { base: work.join("base"), program, local: work.join("local"), config: cfg, now: None };
        let lot = Lot::new(work.join("local").join("db_cache"));
        lot.set_bundle(crate::bundle::Builder::new(env));
        let down = || -> Result<Value, String> { Err("中身（Python）が答えません".into()) };
        // 共有にまだ初期設定・変換表が無い（Python が写しから最初の版を作る形）: Python が生きていれば Python に任せる
        assert!(lot.page(false, &|| true).is_none(), "Python が生きていれば、窓が同じに描けない形は Python");
        // Python が答えないときは既定の形に落として窓が描く（画面は開く）
        let h = lot.page(false, &|| false).expect("Python が答えなくても画面は窓が描く");
        let body = String::from_utf8(h.body).unwrap();
        assert!(body.contains(r#"window.TPA_CONVERSIONS = {"items": [], "revision": null};"#), "空の変換表");
        assert!(body.contains(r#""defaults": {}"#), "既定の見せ方");
        let csp = &h.headers.iter().find(|(k, _)| k == "Content-Security-Policy").unwrap().1;
        let nonce = csp.split("nonce-").nth(1).unwrap().split('\'').next().unwrap();
        assert_eq!(body.matches(&format!("nonce=\"{nonce}\"")).count(), 4, "見出しの印と同じ印を 4 つの <script> に");
        let head = lot.page(true, &|| false).unwrap();
        assert!(head.body.is_empty() && head.headers.iter().any(|(k, v)| k == "Content-Length" && v.parse::<usize>().unwrap() > 1000));
        // 共有に置けば Python が生きていても窓が描く
        let doc = json!({"schema": 1, "revision": 4, "rows": []}).to_string();
        for n in ["ui_defaults", "conversions"] {
            std::fs::write(share.join(format!("{n}.json")), &doc).unwrap();
        }
        assert!(String::from_utf8(lot.page(false, &|| true).unwrap().body).unwrap().contains(r#""revision": 4"#));
        // /api/config・ダッシュボードのデータの並びも Python 無しで（束に使うマスタが共有にある形。無ければ Python が最初の版を作るので任せる）
        assert!(lot.handle_body("GET", "/api/config", "", b"", &down).is_none(), "共有にまだ参照先が無い: Python に任せる");
        for n in ["path_settings", "data_sources", "work_log_files", "equipment_master", "equipment_groups", "shift_patterns"] {
            std::fs::write(share.join(format!("{n}.json")), &doc).unwrap();
        }
        lot.invalidate();
        let (st, c) = lot.handle_body("GET", "/api/config", "", b"", &down).expect("/api/config は窓");
        assert_eq!((st, c["heartbeat_interval_seconds"].as_f64(), c["max_rows"].as_i64()), (200, Some(5.0), Some(25)));
        let (_, d) = lot.handle_body("GET", "/api/dashboard/sources", "", b"", &down).expect("データの並びは窓");
        assert_eq!(d["items"][0]["key"], "lot");
        assert!(d["periods"]["today"].is_string());
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn the_window_answers_the_work_log_registration() {
        // 版 3.91.0: 作業実績の登録の 6 本は Python が起きていなくても窓が答える（本物の道: Lot::handle_body → worklog_route）。
        // 探し直して足した行・並べ替えは一覧の設定（束の work.rows）に効く（invalidate）。答えの古さは差し替えた時刻で測る。
        // 門番（書けない人は 403）・?engine=python・読めない本文は Python に任せる
        let work = std::env::temp_dir().join(format!("da-lot-worklog-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        let (share, folder) = (work.join("share"), work.join("実績"));
        for d in [work.join("local"), work.join("base"), share.clone(), folder.clone()] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(work.join("local").join("instance_id"), "inst1").unwrap();
        for n in ["実績_A.sqlite3", "実績_B.sqlite3"] {
            std::fs::write(folder.join(n), b"x").unwrap();
        }
        let program = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        std::fs::write(&cfg, json!({"master_share": {"dir": share}, "work_log": {"folder": folder, "stale_hours": 1}}).to_string())
            .unwrap();
        let login = crate::bundle::login_id();
        let perm = |role: &str, edit: &str| json!({"schema": 1, "revision": 1, "rows": [{"id": 1, "ログインID": login, "PC名": "", "権限区分": role, "マスタ編集": edit, "rev": 1}]});
        std::fs::write(share.join("access_permissions.json"), perm("開発者", "編集可").to_string()).unwrap();
        let doc = json!({"schema": 1, "revision": 4, "rows": []}).to_string();
        for n in
            ["path_settings", "data_sources", "work_log_files", "equipment_master", "equipment_groups", "shift_patterns", "conversions"]
        {
            std::fs::write(share.join(format!("{n}.json")), &doc).unwrap();
        }
        let env = crate::bundle::Env { base: work.join("base"), program, local: work.join("local"), config: cfg.clone(), now: None };
        let lot = Lot::new(work.join("local").join("db_cache"));
        lot.set_bundle(crate::bundle::Builder::new(env));
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64() + 7200.0;
        lot.set_clock(Arc::new(move || now));
        let down = || -> Result<Value, String> { Err("中身（Python）が答えません".into()) };
        let (st, v) = lot.handle_body("GET", "/api/masters/worklog", "", b"", &down).expect("Python が起きていなくても窓が答える");
        assert_eq!(
            (st, v["items"].as_array().unwrap().len(), v["new"].as_array().unwrap().len(), v["canEdit"].clone()),
            (200, 0, 2, json!(true))
        );
        let (st, v) = lot.handle_body("POST", "/api/masters/worklog/scan", "", b"", &down).unwrap();
        assert_eq!((st, v["result"]["added"].clone()), (200, json!(["A", "B"])), "{v}");
        assert_eq!(
            (v["items"][0]["stale"].clone(), v["items"][0]["ageHours"].as_f64().map(|h| h >= 2.0)),
            (json!(true), Some(true)),
            "差し替えた時刻で 2 時間前"
        );
        let names = |lot: &Lot| -> Vec<Value> {
            lot.settings(&down).unwrap().lists["work"]["rows"].as_array().unwrap().iter().map(|r| r["設備名"].clone()).collect()
        };
        assert_eq!(names(&lot), vec![json!("A"), json!("B")], "足した行は一覧の設定に効く");
        let keys: Vec<Value> = v["items"].as_array().unwrap().iter().map(|x| x["key"].clone()).collect();
        let body = json!({"keys": [keys[1], keys[0]]}).to_string();
        let (st, v) = lot.handle_body("PUT", "/api/masters/worklog/order", "", body.as_bytes(), &down).unwrap();
        assert_eq!((st, v["items"][0]["name"].clone()), (200, json!("B")));
        let (_, files) = lot.handle_body("GET", "/api/worklog/files", "", b"", &down).unwrap();
        assert_eq!(files["items"][0]["name"], json!("B"), "並べ替えは作業実績のタブの並びに効く");
        // Python に任せる形
        assert!(lot.handle_body("GET", "/api/masters/worklog", "engine=python", b"", &down).is_none());
        assert!(lot.handle_body("PUT", "/api/masters/worklog/order", "", b"", &down).is_none(), "空の本文は Python（400 の HTML）");
        assert!(lot.handle_body("PUT", "/api/masters/worklog/1", "", b"[1]", &down).is_none());
        // 書けない人は門番が断る（読むのは誰でも・canEdit は偽）
        std::fs::write(share.join("access_permissions.json"), perm("一般ユーザー", "部分的編集可").to_string()).unwrap();
        lot.invalidate();
        let (st, v) = lot.handle_body("DELETE", "/api/masters/worklog/1", "", b"", &down).unwrap();
        assert_eq!((st, v["kind"].clone()), (403, json!("forbidden")), "{v}");
        let (st, v) = lot.handle_body("GET", "/api/worklog/files", "", b"", &down).unwrap();
        assert_eq!((st, v["canEdit"].clone()), (200, json!(false)));
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn the_window_answers_conversions() {
        // 版 3.93.0: 変換表の 8 本は Python が起きていなくても窓が答える（本物の道: Lot::handle_body → conversions_route）。
        // 足した表・取り込んだ表は一覧の設定（式の conv が引く表）に効く（invalidate）。共有にまだ無い標準は最初の版を置いてから読む。
        // 門番（書けない人は 403）・?engine=python・空の本文は Python に任せる
        let work = std::env::temp_dir().join(format!("da-lot-conv-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        let share = work.join("share");
        for d in [work.join("local"), work.join("base"), share.clone()] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(work.join("local").join("instance_id"), "inst1").unwrap();
        let program = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        std::fs::write(&cfg, json!({"master_share": {"dir": share}}).to_string()).unwrap();
        let login = crate::bundle::login_id();
        let perm = |edit: &str| json!({"schema": 1, "revision": 1, "rows": [{"id": 1, "ログインID": login, "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": edit, "rev": 1}]});
        std::fs::write(share.join("access_permissions.json"), perm("部分的編集可").to_string()).unwrap();
        let doc = json!({"schema": 1, "revision": 4, "rows": []}).to_string();
        for n in
            ["path_settings", "data_sources", "work_log_files", "equipment_master", "equipment_groups", "shift_patterns", "conversions"]
        {
            std::fs::write(share.join(format!("{n}.json")), &doc).unwrap();
        }
        let env = crate::bundle::Env { base: work.join("base"), program, local: work.join("local"), config: cfg.clone(), now: None };
        let lot = Lot::new(work.join("local").join("db_cache"));
        lot.set_bundle(crate::bundle::Builder::new(env));
        let down = || -> Result<Value, String> { Err("中身（Python）が答えません".into()) };
        let (st, v) = lot.handle_body("GET", "/api/masters/conversions", "", b"", &down).expect("Python が起きていなくても窓が答える");
        assert_eq!((st, v["items"].as_array().unwrap().len(), v["canEdit"].clone()), (200, 0, json!(true)));
        assert_eq!(v["presets"].as_array().unwrap().len(), 9, "標準は同梱のプリセット");
        assert!(share.join("conversion_defaults.json").exists(), "共有にまだ無い標準は、Python が読むときと同じく最初の版を置く");
        let table = json!({"name": "課", "inputs": [{"name": "設備"}], "rows": [{"when": {"設備": [{"op": "starts", "v": ["L-"]}]}, "out": "L 課"}]});
        let (st, v) = lot.handle_body("POST", "/api/masters/conversions", "", table.to_string().as_bytes(), &down).unwrap();
        assert_eq!((st, v["created"].clone(), v["items"][0]["order"].clone()), (201, json!(1), json!(10)), "{v}");
        let tables = |lot: &Lot| lot.settings(&down).unwrap().conversions;
        assert_eq!(tables(&lot)["課"]["rows"][0]["out"], json!("L 課"), "足した表は式の conv が引く表に効く");
        let body = json!({"items": [{"name": "形", "inputs": [{"name": "a"}], "rows": []}], "asDefault": true}).to_string();
        let (st, v) = lot.handle_body("POST", "/api/masters/conversions/import", "", body.as_bytes(), &down).unwrap();
        assert_eq!(
            (st, v["added"].clone(), v["customDefaults"].clone(), v["presets"].clone()),
            (200, json!(1), json!(true), json!(["形"]))
        );
        assert!(tables(&lot).get("形").is_some(), "取り込んだ表も効く");
        let (st, v) = lot.handle_body("POST", "/api/masters/conversions/1/preset", "", b"", &down).unwrap();
        assert_eq!(
            (st, v["error"].as_str().unwrap_or("")),
            (400, "「課」は同梱のプリセットにありません（標準に戻せるのはプリセットの表だけです）。")
        );
        let (st, v) = lot.handle_body("GET", "/api/masters/conversions/export", "which=defaults", b"", &down).unwrap();
        assert_eq!((st, v["items"][0]["name"].clone()), (200, json!("形")));
        // Python に任せる形
        assert!(lot.handle_body("GET", "/api/masters/conversions", "engine=python", b"", &down).is_none());
        assert!(lot.handle_body("POST", "/api/masters/conversions", "", b"", &down).is_none(), "空の本文は Python（400 の HTML）");
        assert!(lot.handle_body("PUT", "/api/masters/conversions/1", "", b"[1]", &down).is_none(), "表でない真の本文は Python（500）");
        // 書けない人は門番が断る（読むのは誰でも・canEdit は偽）
        std::fs::write(share.join("access_permissions.json"), perm("閲覧のみ").to_string()).unwrap();
        lot.invalidate();
        let (st, v) = lot.handle_body("DELETE", "/api/masters/conversions/1", "", b"", &down).unwrap();
        assert_eq!((st, v["kind"].clone()), (403, json!("forbidden")), "{v}");
        let (st, v) = lot.handle_body("GET", "/api/masters/conversions", "", b"", &down).unwrap();
        assert_eq!((st, v["canEdit"].clone(), v["items"].as_array().unwrap().len()), (200, json!(false), 2));
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn the_window_answers_equipment_groups() {
        // 版 3.94.0: 設備グループの 4 本は Python が起きていなくても窓が答える（本物の道: Lot::handle_body → equipgroups_route）。
        // 選べる設備は設備の木と同じ数え方（作業実績 → 設備マスタ。出どころつき）。足したグループはダッシュボードの設備グループ（一覧の設定・
        // 設備の木）に効く（invalidate）。一部だけの直しは残りを今の行から。正規表現・門番・?engine=python・空の本文は Python に任せる
        let work = std::env::temp_dir().join(format!("da-lot-egroups-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        let share = work.join("share");
        for d in [work.join("local"), work.join("base"), share.clone()] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(work.join("local").join("instance_id"), "inst1").unwrap();
        let program = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        std::fs::write(&cfg, json!({"master_share": {"dir": share}}).to_string()).unwrap();
        let login = crate::bundle::login_id();
        let perm = |edit: &str| json!({"schema": 1, "revision": 1, "rows": [{"id": 1, "ログインID": login, "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": edit, "rev": 1}]});
        std::fs::write(share.join("access_permissions.json"), perm("部分的編集可").to_string()).unwrap();
        let doc = |rows: Value| json!({"schema": 1, "revision": 4, "rows": rows}).to_string();
        for n in ["path_settings", "data_sources", "equipment_groups", "shift_patterns", "conversions"] {
            std::fs::write(share.join(format!("{n}.json")), doc(json!([]))).unwrap();
        }
        let wl = json!([{"id": 1, "キー": "w1", "設備名": "L-1", "表示": "無"}, {"id": 2, "キー": "w2", "設備名": "CR1"}]);
        std::fs::write(share.join("work_log_files.json"), doc(wl)).unwrap();
        std::fs::write(share.join("equipment_master.json"), doc(json!([{"id": 1, "設備名": "cr1 "}, {"id": 2, "設備名": "TLV"}]))).unwrap();
        let env = crate::bundle::Env { base: work.join("base"), program, local: work.join("local"), config: cfg.clone(), now: None };
        let lot = Lot::new(work.join("local").join("db_cache"));
        lot.set_bundle(crate::bundle::Builder::new(env));
        let down = || -> Result<Value, String> { Err("中身（Python）が答えません".into()) };
        let e = "/api/masters/equipgroups";
        let (st, v) = lot.handle_body("GET", e, "", b"", &down).expect("Python が起きていなくても窓が答える");
        assert_eq!((st, v["items"].as_array().unwrap().len(), v["canEdit"].clone()), (200, 0, json!(true)));
        assert_eq!(
            v["seen"],
            json!([{"name": "L-1", "from": ["作業実績"], "n": 0}, {"name": "CR1", "from": ["作業実績", "設備マスタ"], "n": 0},
                   {"name": "TLV", "from": ["設備マスタ"], "n": 0}]),
            "作業実績（表示しない設備も）→ 設備マスタ。同じ設備は最初の書き方に 1 つ"
        );
        assert_eq!(v["ruleOps"]["prefix"], json!("で始まる"));
        let body = json!({"name": "L ライン", "set": "ライン別", "equipment": ["X-1"], "rules": [{"op": "prefix", "value": "l-"}]});
        let (st, v) = lot.handle_body("POST", e, "", body.to_string().as_bytes(), &down).unwrap();
        assert_eq!((st, v["created"].clone(), v["items"][0]["matched"].clone()), (201, json!(1), json!(["L-1", "X-1"])), "{v}");
        assert_eq!(v["equipments"], json!(["L-1", "CR1", "TLV", "X-1"]), "グループに書いた設備も選べる");
        let groups = |lot: &Lot| lot.settings(&down).unwrap().lists["dash"]["equipGroups"].clone();
        assert_eq!(groups(&lot)[0]["name"], json!("L ライン"), "足したグループはダッシュボードの設備グループに効く");
        let (_, tree) = lot.handle_body("GET", "/api/dashboard/equip-tree", "", b"", &down).unwrap();
        assert_eq!(tree["sets"][0]["groups"][0]["members"], json!(["L-1"]), "{tree}");
        // ルールだけの直しで設備は消えない（版 3.94.0 で Python も直した）
        let (st, v) = lot.handle_body("PUT", &format!("{e}/1"), "", br#"{"rules": [{"op": "suffix", "value": "1"}]}"#, &down).unwrap();
        assert_eq!(
            (st, v["items"][0]["equipment"].clone(), v["items"][0]["matched"].clone()),
            (200, json!(["X-1"]), json!(["L-1", "CR1", "X-1"]))
        );
        let (st, v) = lot
            .handle_body("POST", e, "", json!({"name": "L ライン", "set": "ﾗｲﾝ別", "equipment": "A"}).to_string().as_bytes(), &down)
            .unwrap();
        assert_eq!((st, v["error"].as_str().unwrap_or("")), (409, "まとめ方「ﾗｲﾝ別」には、グループ「L ライン」がもうあります。"));
        // Python に任せる形
        let regex = json!({"name": "R", "rules": [{"op": "regex", "value": "^C"}]}).to_string();
        assert!(lot.handle_body("POST", e, "", regex.as_bytes(), &down).is_none(), "正規表現は Python（re の言葉と重さの決まり）");
        assert!(lot.handle_body("GET", e, "engine=python", b"", &down).is_none());
        assert!(lot.handle_body("POST", e, "", b"", &down).is_none(), "空の本文は Python（400 の HTML）");
        assert!(lot.handle_body("PUT", &format!("{e}/1"), "", b"[1]", &down).is_none(), "表でない真の本文は Python（500）");
        // 配る設定の形（CI の自己診断・製品）: CM3 の場所と設備があると、組み込みのスケジュールの元が設備の列を持つ。選べる設備は CM3 に
        // 届くかで決まる（版 3.94.0 は一覧と書ける歩を Python に任せた）。版 3.96.0 から窓がスケジュールの係なので、一覧も書ける歩も窓が答える
        // （届かない CM3 はスケジュールを数えない。Python と同じ）
        std::fs::write(
            &cfg,
            json!({"master_share": {"dir": share}, "schedule": {"cm3_base_url": "http://127.0.0.1:1", "equipments": "L-1"}}).to_string(),
        )
        .unwrap();
        lot.invalidate();
        let (st, v) = lot.handle_body("GET", e, "", b"", &down).expect("スケジュールの元があっても一覧は窓");
        assert_eq!(st, 200);
        assert!(!v["seen"].to_string().contains("スケジュール"), "届かない CM3 は数えない: {}", v["seen"]);
        assert!(lot.handle_body("GET", "/api/dashboard/equip-tree", "", b"", &down).is_some(), "設備の木も窓");
        let (st, _) = lot.handle_body("PUT", &format!("{e}/1"), "", br#"{"note": "x"}"#, &down).expect("書ける歩も窓");
        assert_eq!(st, 200);
        let (st, v) = lot.handle_body("PUT", &format!("{e}/987654321"), "", br#"{"note": "x"}"#, &down).unwrap();
        assert_eq!((st, v["error"].clone()), (404, json!("id=987654321 が見つかりません。")));
        let (st, _) = lot.handle_body("DELETE", &format!("{e}/987654321"), "", b"", &down).unwrap();
        assert_eq!(st, 404);
        let (st, v) = lot.handle_body("PUT", &format!("{e}/1"), "rev=99", br#"{"note": "x"}"#, &down).unwrap();
        assert_eq!((st, v["kind"].clone()), (409, json!("conflict")), "{v}");
        let (st, _) = lot
            .handle_body("POST", e, "", json!({"name": "L ライン", "set": "ライン別", "equipment": "A"}).to_string().as_bytes(), &down)
            .unwrap();
        assert_eq!(st, 409, "名前の重なりも数えずに断る");
        assert!(
            lot.handle_body("DELETE", &format!("{e}/987654321"), "rev=1", b"", &down).is_some(),
            "版を添えた無い行は一覧を返す（版 3.96.0 から窓）"
        );
        // 書けない人は門番が断る（読むのは誰でも・canEdit は偽）
        std::fs::write(&cfg, json!({"master_share": {"dir": share}}).to_string()).unwrap();
        std::fs::write(share.join("access_permissions.json"), perm("閲覧のみ").to_string()).unwrap();
        lot.invalidate();
        let (st, v) = lot.handle_body("DELETE", &format!("{e}/1"), "", b"", &down).unwrap();
        assert_eq!((st, v["kind"].clone()), (403, json!("forbidden")), "{v}");
        let (st, v) = lot.handle_body("GET", e, "", b"", &down).unwrap();
        assert_eq!((st, v["canEdit"].clone(), v["items"].as_array().unwrap().len()), (200, json!(false), 1));
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn the_window_answers_path_settings() {
        // 版 3.89.0: 参照先の項目の 2 本（GET /api/settings・PUT /api/settings/<key>）は Python が起きていなくても窓が答える
        // （本物の道: Lot::handle_body → settings_route。材料は窓の束の材料）。書いたら一覧の設定を捨てて組み直し、次の束・GET に効く。
        // 門番（書けない人は 403）・知らない項目・誤りの言葉・行の版・ブラウザの欄（Python に任せる）・?engine=python
        let work = std::env::temp_dir().join(format!("da-lot-pathset-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        let share = work.join("share");
        for d in [work.join("local"), work.join("base"), share.clone()] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(work.join("local").join("instance_id"), "inst1").unwrap();
        let program = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        std::fs::write(&cfg, json!({"master_share": {"dir": share}, "lot_list": {"table": "既定の表"}}).to_string()).unwrap();
        let login = crate::bundle::login_id();
        let perm =
            json!({"schema": 1, "revision": 1, "rows": [{"id": 1, "ログインID": login, "PC名": "", "権限区分": "開発者", "rev": 1}]});
        std::fs::write(share.join("access_permissions.json"), perm.to_string()).unwrap();
        let doc = json!({"schema": 1, "revision": 4, "rows": []}).to_string();
        for n in
            ["path_settings", "data_sources", "work_log_files", "equipment_master", "equipment_groups", "shift_patterns", "conversions"]
        {
            std::fs::write(share.join(format!("{n}.json")), &doc).unwrap();
        }
        let env = crate::bundle::Env { base: work.join("base"), program, local: work.join("local"), config: cfg.clone(), now: None };
        let lot = Lot::new(work.join("local").join("db_cache"));
        lot.set_bundle(crate::bundle::Builder::new(env));
        let down = || -> Result<Value, String> { Err("中身（Python）が答えません".into()) };
        let item = |v: &Value, k: &str| v["items"].as_array().unwrap().iter().find(|i| i["key"] == k).unwrap().clone();
        let (st, v) = lot.handle_body("GET", "/api/settings", "", b"", &down).expect("Python が起きていなくても窓が答える");
        let t = item(&v, "lot_list.table");
        assert_eq!(
            (st, t["default"].clone(), t["effective"].clone(), t["source"].clone()),
            (200, json!("既定の表"), json!("既定の表"), json!("default"))
        );
        assert_eq!((v["shared"].clone(), v["revision"].clone()), (json!(true), json!(4)), "{v}");
        assert!(v["config_file"].as_str().is_some_and(|c| !c.is_empty()), "{v}");
        // 書く: 行を足す → GET と一覧の設定（束）に効く
        let (st, v) = lot
            .handle_body("PUT", "/api/settings/lot_list.table", "", r#"{"value": " 窓の表 ", "base_rev": 0}"#.as_bytes(), &down)
            .unwrap();
        assert_eq!((st, v["row"]["値"].clone(), v["row"]["rev"].clone()), (200, json!("窓の表"), json!(1)), "{v}");
        let (_, v) = lot.handle_body("GET", "/api/settings", "", b"", &down).unwrap();
        assert_eq!(
            (item(&v, "lot_list.table")["effective"].clone(), item(&v, "lot_list.table")["source"].clone()),
            (json!("窓の表"), json!("master"))
        );
        assert_eq!(lot.settings(&down).unwrap().table, "窓の表", "書いたら一覧の設定を組み直す（invalidate）");
        // 行の版・誤りの言葉・知らない項目・消す
        let (st, v) = lot.handle_body("PUT", "/api/settings/lot_list.table", "", br#"{"value": "x", "base_rev": 0}"#, &down).unwrap();
        assert_eq!((st, v["kind"].clone()), (409, json!("conflict")), "{v}");
        let (st, v) = lot.handle_body("PUT", "/api/settings/lot_list.refresh_seconds", "", br#"{"value": "10.5"}"#, &down).unwrap();
        assert_eq!((st, v), (400, json!({"error": "「品質の元ファイルを確かめる間隔（秒）」は整数で入れてください。", "kind": "invalid"})));
        assert_eq!(lot.handle_body("PUT", "/api/settings/x", "", b"{}", &down).unwrap().0, 400);
        let (st, v) = lot.handle_body("PUT", "/api/settings/lot_list.table", "", br#"{"value": ""}"#, &down).unwrap();
        assert_eq!((st, v), (200, json!({"row": null})));
        assert_eq!(lot.settings(&down).unwrap().table, "既定の表", "既定へ戻した");
        // Python に任せる: ブラウザの欄・?engine=python・表でない本文
        assert!(lot.handle_body("PUT", "/api/settings/lotdsp_import.direct.browser", "", br#"{"value": "C:\\x.exe"}"#, &down).is_none());
        assert!(lot.handle_body("GET", "/api/settings", "engine=python", b"", &down).is_none());
        assert!(lot.handle_body("PUT", "/api/settings/lot_list.table", "", b"[1]", &down).is_none());
        // 門番: 閲覧の人は書けない（読むことはできる）
        std::fs::write(share.join("access_permissions.json"), json!({"schema": 1, "revision": 2, "rows": [{"id": 1, "ログインID": login, "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "rev": 1}]}).to_string()).unwrap();
        let (st, v) = lot.handle_body("PUT", "/api/settings/lot_list.table", "", br#"{"value": "y"}"#, &down).unwrap();
        assert_eq!((st, v["kind"].clone()), (403, json!("forbidden")), "{v}");
        // 作った後の採点で見つけた形: 値を重ねる配った設定の段が表でない（Python の _set が落ちる）は、読む道も書く道も Python に任せる
        std::fs::write(share.join("access_permissions.json"), perm.to_string()).unwrap();
        std::fs::write(&cfg, json!({"master_share": {"dir": share}, "update": null}).to_string()).unwrap();
        lot.invalidate();
        assert!(lot.handle_body("PUT", "/api/settings/update.source", "", br#"{"value": "C:/x"}"#, &down).is_none(), "書くと落ちる段");
        assert!(lot.handle_body("GET", "/api/settings", "", b"", &down).is_some(), "まだ重ねる行が無ければ落ちない");
        let ps = json!({"schema": 1, "revision": 5, "rows": [{"id": 1, "項目": "update.source", "値": "C:/x", "rev": 1}]});
        std::fs::write(share.join("path_settings.json"), ps.to_string()).unwrap();
        assert!(lot.handle_body("GET", "/api/settings", "", b"", &down).is_none(), "重ねる行があると Python は落ちる");
        assert!(lot.handle_body("PUT", "/api/settings/lot_list.table", "", br#"{"value": "y"}"#, &down).is_none());
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn the_window_answers_update_and_release_place() {
        // 版 3.95.0: 更新の置き場（GET /api/update/settings）と配布の置き場の 3 本は Python が起きていなくても窓が答える
        // （本物の道: Lot::handle_body → release_route。材料は窓の束の材料）。更新の係・配布の画面（main.rs）が読む update_settings も同じ答え。
        // 参照先を窓が書くと次の答えに効く・写す（裏の糸・進み具合・更新時刻）・忙しい・門番・?engine=python・Python が落ちる段
        let work = std::env::temp_dir().join(format!("da-lot-release-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        let share = work.join("share");
        for d in [work.join("local"), work.join("base"), share.clone(), work.join("new")] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(work.join("local").join("instance_id"), "inst1").unwrap();
        let rel = work.join("rel").join("LotScope");
        std::fs::create_dir_all(rel.join("3.7.0")).unwrap();
        std::fs::write(rel.join("3.7.0").join("release.json"), "{}").unwrap();
        std::fs::write(rel.join("distribute.json"), "{\"version\": \"3.7.0\"}").unwrap();
        let old = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_650_000_000);
        std::fs::File::options().write(true).open(rel.join("distribute.json")).unwrap().set_modified(old).unwrap();
        let program = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        std::fs::write(&cfg, json!({"master_share": {"dir": share}, "update": {"source": "C:/既定の置き場"}}).to_string()).unwrap();
        let login = crate::bundle::login_id();
        let perm = |role: &str| {
            json!({"schema": 1, "revision": 1, "rows": [{"id": 1, "ログインID": login, "PC名": "", "権限区分": role, "マスタ編集": "編集可", "rev": 1}]})
                .to_string()
        };
        std::fs::write(share.join("access_permissions.json"), perm("開発者")).unwrap();
        let doc = json!({"schema": 1, "revision": 4, "rows": []}).to_string();
        for n in
            ["path_settings", "data_sources", "work_log_files", "equipment_master", "equipment_groups", "shift_patterns", "conversions"]
        {
            std::fs::write(share.join(format!("{n}.json")), &doc).unwrap();
        }
        let env = crate::bundle::Env { base: work.join("base"), program, local: work.join("local"), config: cfg.clone(), now: None };
        let lot = Lot::new(work.join("local").join("db_cache"));
        lot.set_bundle(crate::bundle::Builder::new(env));
        let down = || -> Result<Value, String> { Err("中身（Python）が答えません".into()) };
        let (st, v) = lot.handle_body("GET", "/api/update/settings", "", b"", &down).expect("Python が起きていなくても窓が答える");
        assert_eq!(
            (st, v["source"].clone(), v["masters"]["dir"].clone()),
            (200, json!("C:/既定の置き場"), json!(share.to_string_lossy())),
            "{v}"
        );
        assert_eq!(
            (v["who"]["login"].clone(), v["who"]["role"].clone(), v["who"]["canRelease"].clone()),
            (json!(login), json!("開発者"), json!(true))
        );
        assert_eq!(lot.update_settings(), Some(v), "更新の係・配布の画面が読む答えも同じ");
        // 参照先の更新の置き場を窓が書く → 次の答えに効く（「;」の候補は字のまま）
        let (st, _) = lot
            .handle_body("PUT", "/api/settings/update.source", "", r#"{"value": " \"D:/a\" ; E:/b ", "base_rev": 0}"#.as_bytes(), &down)
            .unwrap();
        assert_eq!(st, 200);
        assert_eq!(lot.update_settings().unwrap()["source"], "D:/a;E:/b");
        // 確かめる・写す（裏の糸）→ 進み具合 → 写した物は元の更新時刻
        let body = json!({"from": rel, "parent": work.join("new"), "name": "LotScope", "copy": true}).to_string();
        let (st, v) = lot.handle_body("POST", "/api/release/place/check", "", body.as_bytes(), &down).unwrap();
        assert_eq!((st, v["mode"].clone(), v["files"].clone()), (200, json!("copy"), json!(2)), "{v}");
        assert_eq!(lot.handle_body("GET", "/api/release/place/progress", "", b"", &down).unwrap().1, json!({"state": "idle"}));
        lot.release.hold(true);
        let (st, v) = lot.handle_body("POST", "/api/release/place/move", "", body.as_bytes(), &down).unwrap();
        assert_eq!((st, v["kind"].clone()), (409, json!("busy")), "写す係は 1 つ: {v}");
        lot.release.hold(false);
        let (st, v) = lot.handle_body("POST", "/api/release/place/move", "", body.as_bytes(), &down).unwrap();
        assert_eq!((st, v["started"].clone()), (200, json!(true)), "{v}");
        let end = Instant::now() + Duration::from_secs(30);
        let p = loop {
            let (_, p) = lot.handle_body("GET", "/api/release/place/progress", "", b"", &down).unwrap();
            if p["state"] != "running" || Instant::now() > end {
                break p;
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        assert_eq!((p["state"].clone(), p["files"].clone(), p["totalFiles"].clone()), (json!("done"), json!(2), json!(2)), "{p}");
        let copied = work.join("new").join("LotScope").join("distribute.json");
        assert_eq!(std::fs::metadata(copied).unwrap().modified().unwrap(), old, "copy2 と同じく更新時刻を写す");
        assert!(!work.join("local").join("release_move.json").exists(), "写し終えたら写している印を消す");
        let (_, v) = lot.handle_body("POST", "/api/release/place/move", "", body.as_bytes(), &down).unwrap();
        assert_eq!((v["mode"].clone(), v["started"].clone()), (json!("switch"), json!(false)), "写した後は既に置き場: {v}");
        // Python に任せる: ?engine=python（move も: 製品の Python は写さずに断る）・並びの名前
        for (m, p) in [
            ("GET", "/api/update/settings"),
            ("POST", "/api/release/place/check"),
            ("POST", "/api/release/place/move"),
            ("GET", "/api/release/place/progress"),
        ] {
            assert!(lot.handle_body(m, p, "engine=python", body.as_bytes(), &down).is_none(), "{p}");
        }
        assert!(lot.handle_body("POST", "/api/release/place/check", "", br#"{"name": ["a"], "parent": "x"}"#, &down).is_none());
        // 門番: 版を置けない人は move を断る（確かめるは門番なし）。だれが（who）も canRelease が偽
        std::fs::write(share.join("access_permissions.json"), perm("一般ユーザー")).unwrap();
        let (st, v) = lot.handle_body("POST", "/api/release/place/move", "", body.as_bytes(), &down).unwrap();
        assert_eq!(
            (st, v),
            (
                403,
                json!({"error": "配布の置き場を変えられるのは、開発者・メンテナンス者だけです（この PC は「一般ユーザー」）。", "kind": "forbidden"})
            )
        );
        assert_eq!(lot.handle_body("POST", "/api/release/place/check", "", body.as_bytes(), &down).unwrap().0, 200);
        std::thread::sleep(Duration::from_millis(2100)); // me の覚え（2 秒）が切れるのを待つ
        assert_eq!(lot.update_settings().unwrap()["who"]["canRelease"], false);
        // Python が落ちる段（update が字）・窓が同じ字にできない置き場（並び）は Python に尋ねる（main.rs は中身に尋ねる）
        for up in [json!("x"), json!({"source": ["a"]})] {
            std::fs::write(&cfg, json!({"master_share": {"dir": share}, "update": up}).to_string()).unwrap();
            std::fs::write(share.join("path_settings.json"), &doc).unwrap();
            assert!(lot.update_settings().is_none(), "{up}");
        }
        std::fs::write(&cfg, json!({"master_share": {"dir": share}, "update": {"source": 12}}).to_string()).unwrap();
        assert_eq!(lot.update_settings().unwrap()["source"], "12", "str(12)");
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn the_window_writes_data_sources_and_rebuilds() {
        // 版 3.90.0: データ元の書く道は Python が起きていなくても窓が答え（本物の道: Lot::handle_body → sources_write_route）、
        // 書いた直後の並び（GET /api/sources）と一覧の設定（束）は新しい行で組み直す。?engine=python・門番
        let work = std::env::temp_dir().join(format!("da-lot-srcw-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        let share = work.join("share");
        for d in [work.join("local"), work.join("base"), share.clone()] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(work.join("local").join("instance_id"), "inst1").unwrap();
        let program = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        std::fs::write(&cfg, json!({"master_share": {"dir": share}, "sources": {"wip": {"source": "/w.sqlite3"}}}).to_string()).unwrap();
        let login = crate::bundle::login_id();
        let perm =
            json!({"schema": 1, "revision": 1, "rows": [{"id": 1, "ログインID": login, "PC名": "", "権限区分": "開発者", "rev": 1}]});
        std::fs::write(share.join("access_permissions.json"), perm.to_string()).unwrap();
        let doc = json!({"schema": 1, "revision": 4, "rows": []}).to_string();
        for n in
            ["path_settings", "data_sources", "work_log_files", "equipment_master", "equipment_groups", "shift_patterns", "conversions"]
        {
            std::fs::write(share.join(format!("{n}.json")), &doc).unwrap();
        }
        let env = crate::bundle::Env { base: work.join("base"), program, local: work.join("local"), config: cfg, now: None };
        let lot = Lot::new(work.join("local").join("db_cache"));
        lot.set_bundle(crate::bundle::Builder::new(env));
        let down = || -> Result<Value, String> { Err("中身（Python）が答えません".into()) };
        let listed = |lot: &Lot| {
            let (_, v) = lot.sources_list("", &down, &|| None).unwrap();
            v["items"].as_array().unwrap().iter().find(|d| d["key"] == "wip").unwrap()["listed"].clone()
        };
        assert_eq!(listed(&lot), json!(true));
        let _ = lot.settings(&down).unwrap(); // 束を覚えさせる（書いた後に捨てるかを見る）
        let (st, v) = lot
            .handle_body("POST", "/api/sources/wip/quick", "", r#"{"画面": "無", "表示名": "仕掛2", "base_rev": 0}"#.as_bytes(), &down)
            .unwrap();
        assert_eq!((st, v["row"]["画面"].clone()), (200, json!("無")), "{v}");
        assert_eq!(listed(&lot), json!(false), "書いた直後の並びに効く");
        let lists = lot.settings(&down).unwrap().lists;
        let wip = lists["sources"].as_array().unwrap().iter().find(|d| d["key"] == "wip").unwrap().clone();
        assert_eq!(wip["name"], json!("仕掛2"), "一覧の設定（束）も組み直す: {wip}");
        let (st, v) =
            lot.handle_body("POST", "/api/sources", "", r#"{"表示名": "足した", "場所": "/a.sqlite3"}"#.as_bytes(), &down).unwrap();
        assert_eq!(st, 201, "{v}");
        let key = v["row"]["キー"].as_str().unwrap().to_string();
        assert!(key.len() == 9 && key.starts_with('s'), "{key}");
        assert!(lot.handle_body("POST", "/api/sources", "engine=python", b"{}", &down).is_none(), "?engine=python は Python");
        // 門番: 閲覧の人は書けない
        std::fs::write(share.join("access_permissions.json"), json!({"schema": 1, "revision": 2, "rows": [{"id": 1, "ログインID": login, "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "rev": 1}]}).to_string()).unwrap();
        let (st, v) = lot.handle_body("DELETE", &format!("/api/sources/{key}"), "", b"", &down).unwrap();
        assert_eq!((st, v["kind"].clone()), (403, json!("forbidden")), "{v}");
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn the_window_answers_the_sources_list() {
        // 版 3.87.0: データ元の並び（GET /api/sources）は Python が起きていなくても窓が待たずに答える（見出しのタブを先に描く）。
        // スケジュールのカードは Python の覚えなので、中身が起きていれば尋ね、起きていなければ起こした直後と同じ形。
        // まだ開いていない元も写しの様子を台帳から読み、窓が写した元は行の数も言う
        let work = std::env::temp_dir().join(format!("da-lot-srclist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        let share = work.join("share");
        for d in [work.join("local"), work.join("base"), share.clone()] {
            std::fs::create_dir_all(d).unwrap();
        }
        let wip = work.join("仕掛.sqlite3");
        let c = rusqlite::Connection::open(&wip).unwrap();
        c.execute_batch("CREATE TABLE 仕掛 (ﾛｯﾄ番号 TEXT); INSERT INTO 仕掛 VALUES ('A'), ('B'), ('C');").unwrap();
        drop(c);
        let program = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        std::fs::write(&cfg, json!({"master_share": {"dir": share}, "sources": {"wip": {"source": wip}}}).to_string()).unwrap();
        let doc = json!({"schema": 1, "revision": 4, "rows": []}).to_string();
        for n in
            ["path_settings", "data_sources", "work_log_files", "equipment_master", "equipment_groups", "shift_patterns", "conversions"]
        {
            std::fs::write(share.join(format!("{n}.json")), &doc).unwrap();
        }
        let env = crate::bundle::Env { base: work.join("base"), program, local: work.join("local"), config: cfg, now: None };
        let lot = Lot::new(work.join("local").join("db_cache"));
        lot.set_bundle(crate::bundle::Builder::new(env));
        let down = || -> Result<Value, String> { Err("中身（Python）が答えません".into()) };
        // 周回の様子のファイル（窓のほかの係が置いた物）: 仕掛は今の元の様子として読む
        let srcs = work.join("local").join("db_cache").join("sources");
        std::fs::create_dir_all(&srcs).unwrap();
        std::fs::write(
            srcs.join("src_wip.state.json"),
            json!({"remote": wip, "at": 1.5, "unreachable": true, "reason": "届きません"}).to_string(),
        )
        .unwrap();
        let t0 = Instant::now();
        let (st, v) = lot.sources_list("", &down, &|| None).expect("Python が起きていなくても窓が答える");
        assert!(t0.elapsed() < Duration::from_secs(2), "待たない: {:?}", t0.elapsed());
        let keys: Vec<&str> = v["items"].as_array().unwrap().iter().filter_map(|d| d["key"].as_str()).collect();
        assert_eq!((st, keys), (200, vec!["lot", "work", "wip", "sch"]));
        let sch = &v["items"][3];
        assert_eq!(
            (sch["mirror"].clone(), sch["equipCount"].clone(), sch["rows"].clone()),
            (Value::Null, json!(3), Value::Null),
            "既定の 3 設備"
        );
        let wipd = &v["items"][2];
        assert_eq!((wipd["mirror"]["mirrored"].clone(), wipd["rows"].clone()), (json!(false), Value::Null), "まだ写していない: {wipd}");
        assert_eq!(wipd["mirror"]["remote"], json!(wip.to_string_lossy()));
        assert_eq!(
            (wipd["mirror"]["unreachable"].clone(), wipd["mirror"]["reason"].clone(), wipd["mirror"]["checkedAt"].clone()),
            (json!(true), json!("届きません"), json!(1.5)),
            "受け身の係は周回の様子のファイルを読む"
        );
        // 品質の写しを Python が受け持つ設定（desktop.lotlist_engine = python）は Python に任せる
        let conf = |engine: &str| json!({"master_share": {"dir": share}, "sources": {"wip": {"source": wip}}, "desktop": {"lotlist_engine": engine}});
        std::fs::write(work.join("config.json"), conf("python").to_string()).unwrap();
        lot.invalidate();
        assert!(lot.sources_list("", &down, &|| None).is_none(), "engine = python");
        std::fs::write(work.join("config.json"), conf("rust").to_string()).unwrap();
        lot.invalidate();
        // 品質の写しの係が最初の周回の途中でも待たない（届かない共有を指す係を動かしてから尋ねる）
        lot.warm(&down);
        let t1 = Instant::now();
        assert!(lot.sources_list("", &down, &|| None).is_some());
        assert!(t1.elapsed() < Duration::from_secs(2), "周回の途中でも待たない: {:?}", t1.elapsed());
        assert!(v["roles"].is_array() && v["newConn"].as_array().is_some_and(|a| a.len() == 5) && v["revision"] == json!(4), "{v}");
        // スケジュールのカードは窓の係の状態から（版 3.96.0。前は中身が起きていれば Python の覚え）。中身に尋ねる係は使わない
        let card = || Some(json!({"mirror": {"kind": "cm3", "mirrored": true}, "equipCount": 5}));
        let (_, v) = lot.sources_list("", &down, &card).unwrap();
        assert_eq!((v["items"][3]["mirror"].clone(), v["items"][3]["equipCount"].clone()), (Value::Null, json!(3)), "{}", v["items"][3]);
        // 窓が写した元は行の数も言う
        let _ = lot.handle("GET", "/api/src/wip", "", &down);
        lot.lists.src.wait_first(&["wip".to_string()], Duration::from_secs(10));
        let (_, v) = lot.sources_list("", &down, &|| None).unwrap();
        assert_eq!(
            (v["items"][2]["mirror"]["mirrored"].clone(), v["items"][2]["rows"].clone()),
            (json!(true), json!(3)),
            "{}",
            v["items"][2]
        );
        assert!(lot.sources_list("engine=python", &down, &|| None).is_none(), "?engine=python は Python");
        // 束全体は組めない（共有にまだ設備マスタ・設備グループの最初の版が無い）PC でも、データ元の並びは窓が答える（自己診断の共有の exe の形）
        for n in ["equipment_master", "equipment_groups"] {
            std::fs::remove_file(share.join(format!("{n}.json"))).unwrap();
        }
        lot.invalidate();
        assert!(lot.own_bundle().unwrap().is_err(), "束は組めない");
        assert_eq!(lot.sources_list("", &down, &|| None).map(|(st, _)| st), Some(200), "データ元の並びは答える");
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn the_window_answers_dashboards() {
        // 版 3.82.0: ダッシュボードの 5 本は窓が受ける（本物の道: Lot::handle_body → dashboards_route）。組み込みは焼いた表から、
        // 組み込みと同じ名前は中身に replaces。窓が Python と同じに読めない形・まだ無い前の版の条件のマスタは Python に任せる
        let dir = std::env::temp_dir().join(format!("da-lot-dashboards-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (share, local) = (dir.join("share"), dir.join("local"));
        for d in [&share, &local, &dir.join("data")] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(local.join("instance_id"), "inst1").unwrap();
        let doc = |rows: Value| json!({"schema": 1, "revision": 1, "rows": rows}).to_string();
        let perm = json!([{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "rev": 1}]);
        std::fs::write(share.join("access_permissions.json"), doc(perm)).unwrap();
        std::fs::write(share.join("dashboards.json"), doc(json!([]))).unwrap();
        let conf = json!({"who": {"login": "boss", "pc": "PC-1", "pcSource": "", "key": "PC-1@boss"},
                          "place": {"shareDir": share, "shared": ["access_permissions", "tab_access", "dashboards", "dashboard_settings"],
                                    "data": dir.join("data"), "defaults": dir.join("defaults"), "cache": local.join("master_cache"),
                                    "presence": "", "lockTtl": 20.0}});
        let ask = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": conf.clone()}));
        let lot = Lot::new(dir.join("cache"));
        assert!(
            lot.handle_body("GET", "/api/dashboards", "", b"", &ask).is_none(),
            "前の版の条件のマスタがまだ無い（読むだけで作るのは Python）"
        );
        std::fs::write(share.join("dashboard_settings.json"), doc(json!([]))).unwrap();
        let (st, v) = lot.handle_body("GET", "/api/dashboards", "", b"", &ask).expect("窓が受ける");
        assert_eq!((st, v["items"][0]["id"].clone(), v["standardId"].clone()), (200, json!("b:standard"), json!("b:standard")), "{v}");
        let body = r#"{"name": "標準", "scope": "me", "body": {"rows": 8, "panels": []}}"#;
        let (st, v) = lot.handle_body("POST", "/api/dashboards", "", body.as_bytes(), &ask).unwrap();
        assert_eq!((st, v["body"]["replaces"].clone()), (201, json!("standard")), "組み込みと同じ名前は入れ替え: {v}");
        let (_, v) = lot.handle_body("GET", "/api/dashboards", "", b"", &ask).unwrap();
        assert_eq!((v["items"].as_array().map(Vec::len), v["items"][0]["replaces"].clone()), (Some(1), json!("b:standard")), "{v}");
        let (st, v) = lot.handle_body("PUT", "/api/dashboards-hidden", "", br#"{"scope": "me", "keys": ["standard"]}"#, &ask).unwrap();
        assert_eq!((st, v["keys"].clone()), (200, json!(["standard"])), "{v}");
        assert!(lot.handle_body("POST", "/api/dashboards", "", br#"{"name": "a", "scope": "me", "body": {"rows": NaN}}"#, &ask).is_none());
        assert!(lot.handle_body("PUT", "/api/dashboards-hidden", "", b"", &ask).is_none());
        assert!(lot.handle_body("DELETE", "/api/dashboards/\u{ff11}", "", b"", &ask).is_none());
        assert_eq!(lot.handle_body("DELETE", "/api/dashboards/1", "rev=1", b"", &ask).unwrap(), (200, json!({"ok": true})));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_window_writes_equipment_and_rolls() {
        // 版 3.77.0: 設備・ロールの 8 本は窓が受ける（本物の道: Lot::handle_body → equip_route）。読むのは門番なし、書くのは門番を通し、
        // 書いたら一覧の設定を捨てる。窓が Python と同じに読めない本文・行（整数の -0・並びの値・並びの項目の行）は Python に任せる
        let dir = std::env::temp_dir().join(format!("da-lot-equip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (share, local) = (dir.join("share"), dir.join("local"));
        for d in [&share, &local, &dir.join("data")] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(local.join("instance_id"), "inst1").unwrap();
        let perm = json!([{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "rev": 1},
                          {"id": 2, "ログインID": "v1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "rev": 1}]);
        let doc = |rows: Value| json!({"schema": 1, "revision": 1, "rows": rows}).to_string();
        std::fs::write(share.join("access_permissions.json"), doc(perm)).unwrap();
        std::fs::write(
            share.join("equipment_master.json"),
            doc(json!([{"id": 1, "設備名": "ANF", "巻出し方向": "下", "同一工程": "ANI*"}])),
        )
        .unwrap();
        std::fs::write(share.join("roll_master.json"), doc(json!([]))).unwrap();
        let conf = |login: &str| {
            json!({"who": {"login": login, "pc": "PC-1", "pcSource": "", "key": format!("PC-1@{login}")},
                   "place": {"shareDir": share, "shared": ["access_permissions", "tab_access", "equipment_master", "roll_master"],
                             "data": dir.join("data"), "defaults": dir.join("defaults"), "cache": local.join("master_cache"),
                             "presence": "", "lockTtl": 20.0}})
        };
        let (boss, v1) = (conf("boss"), conf("v1"));
        let asked = std::cell::Cell::new(0);
        let ask_boss = || {
            asked.set(asked.get() + 1);
            Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": boss.clone()}))
        };
        let ask_v1 = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": v1.clone()}));
        let lot = Lot::new(dir.join("cache"));
        // ① 読む: 旧い列名は読み替え・版の無い行は 1
        let (st, v) = lot.handle_body("GET", "/api/masters/equipment", "", b"", &ask_boss).expect("窓が受ける");
        assert_eq!((st, v[0]["巻取方向"].clone(), v[0]["rev"].clone(), v[0].get("巻出し方向")), (200, json!("下"), json!(1), None), "{v}");
        // ② 足す: 確かめの言葉（同一工程の名前に当たる）・必須の null・足せる形。書いたら一覧の設定を尋ね直す
        let post = |b: Value| lot.handle_body("POST", "/api/masters/equipment", "", &serde_json::to_vec(&b).unwrap(), &ask_boss).unwrap();
        let (st, v) = post(json!({"設備名": "ani3"}));
        assert_eq!((st, v["kind"].as_str()), (400, Some("invalid")), "{v}");
        let (st, v) = post(json!({"設備名": null}));
        assert_eq!((st, v["error"].as_str()), (400, Some("設備名は必須です。")), "{v}");
        let before = asked.get();
        let (st, v) = post(json!({"設備名": " L-1 ", "巻取方向": 1.5}));
        assert_eq!((st, v["設備名"].as_str(), v["巻取方向"].as_str()), (201, Some("L-1"), Some("1.5")), "{v}");
        lot.handle_body("GET", "/api/masters/rolls", "", b"", &ask_boss).unwrap();
        assert_eq!(asked.get(), before + 1, "書いたら一覧の設定を尋ね直す");
        // ③ ロールを直す・消す（表でない本文の消す道は書かない）
        let (st, r) = lot.handle_body("POST", "/api/masters/rolls", "", r#"{"設備": "L-1", "本数": 4}"#.as_bytes(), &ask_boss).unwrap();
        assert_eq!((st, r["本数"].as_str()), (201, Some("4")), "{r}");
        let (st, _) = lot.handle_body("DELETE", "/api/masters/rolls/1", "rev=1", b"[1]", &ask_boss).unwrap();
        assert_eq!(st, 500, "表でない本文は書かない");
        let (st, v) = lot.handle_body("DELETE", "/api/masters/rolls/1", "rev=1", b"", &ask_boss).unwrap();
        assert_eq!((st, v["status"].as_str()), (200, Some("deleted")), "{v}");
        // ④ 閲覧のみは門番が断る（読むのはよい）
        let lot_v1 = Lot::new(dir.join("cache-v1"));
        assert_eq!(lot_v1.handle_body("GET", "/api/masters/rolls", "", b"", &ask_v1).unwrap().0, 200);
        let (st, v) = lot_v1.handle_body("POST", "/api/masters/rolls", "", r#"{"設備": "x"}"#.as_bytes(), &ask_v1).unwrap();
        assert_eq!((st, v["kind"].as_str()), (403, Some("forbidden")), "{v}");
        // ⑤ Python に任せる: 整数の -0・並びの値・判定の材料が無い・百分率符号の道
        assert!(lot.handle_body("POST", "/api/masters/equipment", "", r#"{"設備名": "z", "検査計": -0}"#.as_bytes(), &ask_boss).is_none());
        assert!(lot.handle_body("POST", "/api/masters/rolls", "", r#"{"設備": "z", "本数": [1]}"#.as_bytes(), &ask_boss).is_none());
        let ask_none = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}}));
        assert!(Lot::new(dir.join("c3")).handle_body("GET", "/api/masters/equipment", "", b"", &ask_none).is_none());
        assert!(lot.handle_body("GET", "/api/masters/%65quipment", "", b"", &ask_boss).is_none());
        // ⑥ 置き場の行の項目が並び（Python の str() の書き方）なら、一覧も書く道も Python に任せる
        std::fs::write(share.join("roll_master.json"), doc(json!([{"id": 9, "設備": ["L-1"]}]))).unwrap();
        assert!(lot.handle_body("GET", "/api/masters/rolls", "", b"", &ask_boss).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_window_answers_shift_masters() {
        // 版 3.75.0: 勤務体系の 4 本は窓が受ける（本物の道: Lot::handle_body → shifts_route）。読むのは門番なし、書くのは門番を通し、
        // 書いたら一覧の設定を捨てる。窓が Python と同じに読めない形（字の id・大きすぎる表示順・NaN の区分・表の適用設備）は Python に任せる
        let dir = std::env::temp_dir().join(format!("da-lot-shifts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (share, local) = (dir.join("share"), dir.join("local"));
        for d in [&share, &local, &dir.join("data")] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(local.join("instance_id"), "inst1").unwrap();
        let perm = json!([{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "rev": 1},
                          {"id": 2, "ログインID": "v1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "rev": 1}]);
        let doc = |rows: Value| json!({"schema": 1, "revision": 1, "rows": rows}).to_string();
        std::fs::write(share.join("access_permissions.json"), doc(perm)).unwrap();
        std::fs::write(share.join("work_log_files.json"), doc(json!([{"id": 1, "キー": "a", "設備名": "CR1"}]))).unwrap();
        std::fs::write(share.join("shift_patterns.json"), doc(json!([{"id": 1, "名称": "古い", "区分": [{"name": "x"}], "rev": 1}])))
            .unwrap();
        let conf = |login: &str| {
            json!({"who": {"login": login, "pc": "PC-1", "pcSource": "", "key": format!("PC-1@{login}")},
                   "place": {"shareDir": share, "shared": ["access_permissions", "tab_access", "shift_patterns", "work_log_files"],
                             "data": dir.join("data"), "defaults": dir.join("defaults"), "cache": local.join("master_cache"),
                             "presence": "", "lockTtl": 20.0}})
        };
        let (boss, v1) = (conf("boss"), conf("v1"));
        let ask_boss = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": boss.clone()}));
        let ask_v1 = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": v1.clone()}));
        let lot = Lot::new(dir.join("cache"));
        // ① 読む: 区分が字でない行は区分なし（Python の json.loads と同じ）・選べる設備は作業実績の登録から
        let (st, v) = lot.handle_body("GET", "/api/masters/shifts", "", b"", &ask_boss).expect("窓が受ける");
        assert_eq!(
            (st, v["items"][0]["segments"].clone(), v["equipments"].clone(), v["canEdit"].clone()),
            (200, json!([]), json!(["CR1"]), json!(true)),
            "{v}"
        );
        // ② 足す: 窓が書き、一覧＋created
        let body = serde_json::to_vec(&json!({"name": "日勤", "segments": [{"name": "日勤", "start": "8:15", "end": "17:05"}]})).unwrap();
        let (st, v) = lot.handle_body("POST", "/api/masters/shifts", "", &body, &ask_boss).unwrap();
        assert_eq!((st, v["created"].clone(), v["items"].as_array().unwrap().len()), (201, json!(2), 2), "{v}");
        let d: Value = serde_json::from_slice(&std::fs::read(share.join("shift_patterns.json")).unwrap()).unwrap();
        assert_eq!(
            d["rows"][1]["区分"],
            json!(r#"[{"name":"日勤","start":"08:15","end":"17:05","dayOffset":null}]"#),
            "区分の字は json.dumps と同じ"
        );
        // ③ 閲覧のみは門番が断る（読むのはよい）
        let lot_v1 = Lot::new(dir.join("cache-v1")); // 一覧の設定（名乗り）は Lot が覚えるので、人ごとに別の Lot
        let (st, v) = lot_v1.handle_body("GET", "/api/masters/shifts", "", b"", &ask_v1).unwrap();
        assert_eq!((st, v["canEdit"].clone()), (200, json!(false)));
        let (st, _) = lot_v1.handle_body("DELETE", "/api/masters/shifts/2", "", b"", &ask_v1).unwrap();
        assert_eq!(st, 403);
        // ④ 窓が Python と同じに読めない形は Python に任せる
        assert!(
            lot.handle_body("POST", "/api/masters/shifts", "", br#"{"name": "a", "equipment": {"a": 1}}"#, &ask_boss).is_none(),
            "表の適用設備"
        );
        assert!(lot.handle_body("PUT", "/api/masters/shifts/2", "", br#"{"base_rev": NaN}"#, &ask_boss).is_none(), "窓が読めない本文");
        // 2 回目の採点で見つけた形: 区分の字の中の NaN（Python は 400 で断る）・適用設備の大きな整数（Python は桁のまま置く）
        let nan = br#"{"name": "s1", "segments": "[{\"name\":\"b\",\"start\":\"23:00\",\"end\":\"7:00\",\"dayOffset\":NaN}]"}"#;
        assert!(lot.handle_body("POST", "/api/masters/shifts", "", nan, &ask_boss).is_none(), "区分の字の NaN");
        for eq in [r#"99999999999999999999"#, r#"[12345678901234567890]"#, r#"["CR1", 9223372036854775808]"#] {
            let b = format!(r#"{{"name": "大", "equipment": {eq}, "segments": [{{"name": "a", "start": "7:00", "end": "8:00"}}]}}"#);
            assert!(lot.handle_body("POST", "/api/masters/shifts", "", b.as_bytes(), &ask_boss).is_none(), "{eq}");
        }
        let (st, _) = lot.handle_body("DELETE", "/api/masters/shifts/2", "rev=1", b"[1]", &ask_boss).unwrap();
        assert_eq!(st, 500, "表でない本文は書かない");
        for bad in [
            json!({"id": "x", "名称": "字の id"}),
            json!({"id": 9, "名称": "大", "表示順": "99999999999999999999"}),
            json!({"id": 9, "名称": "数の大", "表示順": 99999999999999999999.0_f64}),
            json!({"id": 9, "名称": "NaN", "区分": "[{\"name\":\"a\",\"start\":\"23:00\",\"end\":\"7:00\",\"dayOffset\":NaN}]"}),
        ] {
            std::fs::write(share.join("shift_patterns.json"), doc(json!([bad.clone()]))).unwrap();
            assert!(lot.handle_body("GET", "/api/masters/shifts", "", b"", &ask_boss).is_none(), "{bad}");
        }
        assert!(lot.handle_body("GET", "/api/masters/%73hifts", "", b"", &ask_boss).is_none(), "百分率符号で書いた道は Python");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_window_writes_access_masters() {
        // 版 3.68.0（順 5 の 2 段目 b）: 権限のマスタを書く 4 本は窓が受ける（Python へ回さない）。門番を通し、窓の書く係で共有と写しを書き、
        // 書いたら権限の覚えを捨てる。判定の材料が無いときと、百分率符号で書いた道は Python に任せる
        let dir = std::env::temp_dir().join(format!("da-lot-awrite-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (share, local) = (dir.join("share"), dir.join("local"));
        for d in [&share, &local, &dir.join("data")] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(local.join("instance_id"), "inst1").unwrap();
        let admin = json!({"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "rev": 1});
        let op = json!({"id": 2, "ログインID": "u1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "部分的編集可", "rev": 1});
        std::fs::write(share.join("access_permissions.json"), json!({"schema": 1, "revision": 1, "rows": [admin, op]}).to_string())
            .unwrap();
        let conf = |login: &str| {
            json!({"who": {"login": login, "pc": "PC-1", "pcSource": "", "key": format!("PC-1@{login}")},
                   "place": {"shareDir": share, "shared": ["access_permissions", "tab_access"], "data": dir.join("data"),
                             "defaults": dir.join("defaults"), "cache": local.join("master_cache"), "presence": "", "lockTtl": 20.0}})
        };
        let boss = conf("boss");
        let ask_boss = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": boss.clone()}));
        let lot = Lot::new(dir.join("cache"));
        let before = lot.gate.me(&boss).unwrap();
        assert_eq!(before["rows"].as_array().unwrap().len(), 2);
        // ① 足す: 窓が答える（201）。共有と写しに入り、権限の覚えを捨てる（次の me に新しい行）
        let body = serde_json::to_vec(&json!({"ログインID": "n1", "権限区分": "メンテナンス者"})).unwrap();
        let (st, v) = lot.handle_body("POST", "/api/masters/access", "", &body, &ask_boss).expect("窓が受ける");
        assert_eq!((st, v["ログインID"].as_str()), (201, Some("n1")), "{v}");
        for f in [share.join("access_permissions.json"), local.join("master_cache/access_permissions.json")] {
            let d: Value = serde_json::from_slice(&std::fs::read(&f).unwrap()).unwrap();
            assert_eq!(d["rows"].as_array().unwrap().len(), 3, "{}", f.display());
            assert_eq!(d["revision"], json!(2));
        }
        assert_eq!(lot.gate.me(&boss).unwrap()["rows"].as_array().unwrap().len(), 3, "書いたら権限の覚えを捨てる");
        // ② タブの権限
        let body = serde_json::to_vec(&json!({"rules": {"work": ["設備作業者"]}})).unwrap();
        let (st, v) = lot.handle_body("PUT", "/api/masters/tabaccess", "", &body, &ask_boss).unwrap();
        assert_eq!((st, v["ok"].clone()), (200, json!(true)), "{v}");
        // ③ 消す・行の版
        let (st, _) = lot.handle_body("DELETE", "/api/masters/access/3", "rev=1", b"", &ask_boss).unwrap();
        assert_eq!(st, 200);
        // ④ 門番: 部分的編集可は管理のマスタを書けない（Python へ回さずに窓が断る）
        let u1 = conf("u1");
        let ask_u1 = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": u1.clone()}));
        let lot_u1 = Lot::new(dir.join("cache-u1"));
        let (st, v) = lot_u1.handle_body("PUT", "/api/masters/access/2", "", b"{}", &ask_u1).unwrap();
        assert_eq!((st, v["kind"].as_str()), (403, Some("forbidden")), "{v}");
        // ⑤ 判定の材料が無い（前の版の Python）・百分率符号で書いた道・知らない道は Python に任せる
        let ask_none = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}}));
        assert!(Lot::new(dir.join("c3")).handle_body("POST", "/api/masters/access", "", b"{}", &ask_none).is_none());
        assert!(lot.handle_body("POST", "/api/masters/%61ccess", "", b"{}", &ask_boss).is_none());
        assert!(lot.handle_body("PUT", "/api/masters/access/x", "", b"{}", &ask_boss).is_none());
        // 読む 2 本（版 3.76.0。main.rs が Lot::access_read へ渡す）: 中身の版（心拍と同じ program の version.py）が分かり、
        // 中身（Python）が答えるときだけ窓の me から答える。handle_body は受けない（Python へ回す）
        assert!(lot.handle_body("GET", "/api/masters/access", "", b"", &ask_boss).is_none(), "handle_body は受けない");
        let (up, down) = (|| true, || false);
        // 覚える長さは時計に頼らない（遅い CI で 2 秒を越えても「覚えている間」を確かめられる）
        let mut lot_v = Lot::new(dir.join("cache-v"));
        lot_v.gate = crate::access::Gate::with_ttl(std::time::Duration::from_secs(3600), std::time::Duration::from_secs(3600));
        assert!(lot_v.access_read("GET", "/api/access/me", &ask_boss, &up).is_none(), "中身の版が分からなければ Python");
        lot_v.presence.set_version("3.76.0");
        assert!(lot_v.access_read("GET", "/api/access/me", &ask_boss, &down).is_none(), "中身が答えなければ Python へ回す（前と同じ失敗）");
        let (st, v) = lot_v.access_read("GET", "/api/masters/access", &ask_boss, &up).expect("窓が答える");
        assert_eq!((st, v["items"].as_array().map(Vec::len), v["matchedId"].clone()), (200, Some(2), json!(1)), "{v}");
        assert_eq!(v["masterEditByRole"]["設備作業者"], json!(["非表示"]), "{v}");
        let (st, v) = lot_v.access_read("GET", "/api/access/me", &ask_boss, &up).expect("窓が答える");
        assert_eq!(
            (st, v["loginId"].as_str(), v["version"].as_str(), v["role"].as_str()),
            (200, Some("boss"), Some("3.76.0"), Some("開発者")),
            "{v}"
        );
        // 窓が書いたら、次の読みに新しい行（覚えた me を捨てる）
        let body = serde_json::to_vec(&json!({"ログインID": "n2", "権限区分": "一般ユーザー"})).unwrap();
        assert_eq!(lot_v.handle_body("POST", "/api/masters/access", "", &body, &ask_boss).unwrap().0, 201);
        let n_rows = |l: &Lot| l.access_read("GET", "/api/masters/access", &ask_boss, &up).unwrap().1["items"].as_array().map(Vec::len);
        let after_window = n_rows(&lot_v).unwrap();
        // Python が書いた（窓は書いていない）: 覚えている 2 秒のあいだは前の行、after_python の後は読み直す
        let doc: Value = serde_json::from_slice(&std::fs::read(share.join("access_permissions.json")).unwrap()).unwrap();
        let mut doc2 = doc.clone();
        doc2["rows"].as_array_mut().unwrap().push(json!({"id": 99, "ログインID": "py", "PC名": "", "権限区分": "一般ユーザー", "rev": 1}));
        std::fs::write(share.join("access_permissions.json"), doc2.to_string()).unwrap();
        assert_eq!(n_rows(&lot_v), Some(after_window), "覚えている間は前の答え（Python も同じ覚えの me で答える）");
        lot_v.after_python("POST", "/api/masters/access", 201);
        assert_eq!(n_rows(&lot_v), Some(after_window + 1), "Python が書いた後は読み直す");
        std::fs::write(share.join("access_permissions.json"), doc.to_string()).unwrap();
        lot_v.after_python("DELETE", "/api/masters/access/99", 200);
        assert!(lot_v.access_read("POST", "/api/access/me", &ask_boss, &up).is_none(), "読む道は GET だけ");
        assert!(lot_v.access_read("GET", "/api/access/me/", &ask_boss, &up).is_none(), "ほかの字の道は Python");
        // 名乗りを読めない（me を決められない）・判定の材料が無いときは Python
        let ask_bad = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": {"place": boss["place"]}}));
        let lot_b = Lot::new(dir.join("cache-b"));
        lot_b.presence.set_version("3.76.0");
        assert!(lot_b.access_read("GET", "/api/access/me", &ask_bad, &up).is_none());
        assert!(Lot::new(dir.join("cache-c")).access_read("GET", "/api/access/me", &ask_none, &up).is_none());
        assert!(
            lot.handle_body("POST", "/api/masters/access", "", r#"{"ログインID": "n", "x": NaN}"#.as_bytes(), &ask_boss).is_none(),
            "窓が読めない数の本文は Python"
        );
        assert!(lot.handle_body("POST", "/api/masters/access", "", r#"{"ログインID": "n", "x": 1e400}"#.as_bytes(), &ask_boss).is_none());
        assert!(lot.handle_body("POST", "/api/masters/access", "", br#"{"x": "\ud800"}"#, &ask_boss).is_none(), "片割れの代用字");
        let (st, _) = lot.handle_body("DELETE", "/api/masters/access/1", "rev=1", b"[1]", &ask_boss).unwrap();
        assert_eq!(st, 500, "表でない本文は書かない");
        // 版 3.77.0: タブの権限の行を窓が読めない（版が字）なら、タブの権限を書く道は Python に任せる（窓はタブの権限の行を置き場から読む）
        let tabs_before = std::fs::read(share.join("tab_access.json")).ok();
        std::fs::write(
            share.join("tab_access.json"),
            json!({"rows": [{"id": 1, "タブ": "work", "出さない区分": "", "rev": "x"}]}).to_string(),
        )
        .unwrap();
        let body = serde_json::to_vec(&json!({"rules": {"dash": ["一般ユーザー"]}})).unwrap();
        assert!(
            Lot::new(dir.join("cache-t")).handle_body("PUT", "/api/masters/tabaccess", "", &body, &ask_boss).is_none(),
            "読めない版のタブの権限の行"
        );
        match tabs_before {
            Some(b) => std::fs::write(share.join("tab_access.json"), b).unwrap(),
            None => std::fs::remove_file(share.join("tab_access.json")).unwrap(),
        }
        // 数学の太字の 5（𝟓）は Python の int() も 5 と読む: 版 3.75.0 から窓も同じ表で読んで答える（前は窓の表に無く Python へ回した）
        assert!(
            lot.handle_body("DELETE", "/api/masters/access/1", "rev=%F0%9D%9F%93", b"", &ask_boss).is_some(),
            "Python と同じく版の番号 5 と読んで窓が答える"
        );
        assert!(
            lot.handle_body("DELETE", "/api/masters/access/1", "rev=%C2%B2", b"", &ask_boss).is_none(),
            "10 進でない数の字（²）は Python"
        );
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
        // ⑥ 設備作業者でマスタ編集が空: 保存した段は既定の「編集可」でも、効く段は区分の上限で「非表示」＝直せない
        //   （実績のタブは出すように区分の決まりを外しておく）
        std::fs::write(share.join("tab_access.json"), json!({"rows": []}).to_string()).unwrap();
        perms(json!([admin, {"id": 1, "ログインID": "u1", "PC名": "", "権限区分": "設備作業者", "マスタ編集": ""}]));
        renew(&lot);
        let (st, v) = work(&lot);
        assert_eq!((st, shifts(&v)), (200, json!(false)), "効く段（区分の上限を掛けた後）で決める: {v}");
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
        // ⑦ 窓が me を決められない（権限の表も写しも読めない）: 窓は答えず Python に任せる（Python が自分の me で答える）
        std::fs::write(share.join("access_permissions.json"), "{").unwrap();
        std::fs::create_dir_all(dir.join("mcache")).unwrap();
        std::fs::write(dir.join("mcache").join("access_permissions.json"), "[").unwrap();
        let lot3 = Lot::new(dir.join("cache3"));
        assert!(lot3.handle("GET", "/api/worklog", "equip=a&work=1", &ask).is_none(), "一覧は Python に任せる");
        assert!(lot3.handle_body("POST", "/api/dashboard/query", "", &body, &ask).is_none(), "ダッシュボードも Python に任せる");
        // データの時刻・再読込は出さないタブを見ないので、窓が答え続ける（Python に回すと同じ台帳に写しの係が 2 つ動く）
        assert_eq!(lot3.handle("GET", "/api/lotlist/source", "", &ask).map(|r| r.0), Some(200), "品質のデータの時刻は窓");
        assert_eq!(lot3.handle("POST", "/api/lotlist/refresh", "", &ask).map(|r| r.0), Some(200), "品質の再読込は窓");
        assert!(lot3.handle("GET", "/api/worklog/source", "equip=a", &ask).is_some(), "作業実績のデータの時刻は窓");
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

    #[test]
    fn the_window_answers_the_heartbeat_and_presence() {
        // 版 3.71.0（順 5 の 3 段目）: 心拍・利用状況の 7 本・画面の設定の控えは窓が答える（書き手は窓の 1 つ）。
        // 中身（Python）が止まっていれば心拍は 503（画面の「接続 ●」を今と同じに）。判定の材料が無いときは Python に任せる
        let dir = std::env::temp_dir().join(format!("da-lot-presence-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (share, local) = (dir.join("share"), dir.join("local"));
        for d in [&share, &local, &dir.join("data")] {
            std::fs::create_dir_all(d).unwrap();
        }
        let admin = json!({"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者"});
        std::fs::write(share.join("access_permissions.json"), json!({"schema": 1, "revision": 1, "rows": [admin]}).to_string()).unwrap();
        let conf = json!({"who": {"login": "boss", "pc": "PC-1", "pcSource": "", "key": "PC-1@boss"},
                          "place": {"shareDir": share, "shared": ["access_permissions", "tab_access"], "data": dir.join("data"),
                                    "defaults": dir.join("defaults"), "cache": local.join("master_cache"),
                                    "presence": share.join("presence_tpa"), "lockTtl": 20.0}});
        let ask = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": conf.clone()}));
        let lot = Lot::new(local.join("db_cache"));
        lot.presence.set_version("3.71.0");
        let (st, v) = lot.heartbeat(&ask, &|| false).unwrap();
        assert_eq!((st, v["kind"].as_str()), (503, Some("backend_unavailable")), "中身が止まっていれば未接続");
        let (st, v) = lot.heartbeat(&ask, &|| true).unwrap();
        assert_eq!((st, v["revoked"].clone()), (200, Value::Null), "{v}");
        let mine = share.join("presence_tpa").join("PC-1@boss.json");
        let t0 = Instant::now();
        while !mine.exists() && t0.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(20));
        }
        let d: Value = serde_json::from_slice(&std::fs::read(&mine).expect("裏の糸が書く")).unwrap();
        assert_eq!((d["version"].as_str(), d["role"].as_str()), (Some("3.71.0"), Some("開発者")));
        let (st, v) = lot.handle_body("GET", "/api/presence", "", b"", &ask).expect("窓が答える");
        assert_eq!((st, v["fleet"]["total"].as_i64(), v["me"].as_str()), (200, Some(1), Some("PC-1@boss")), "{v}");
        let (st, v) = lot.handle_body("POST", "/api/ui-state", "", br#"{"changed": {"tpa.a": "1"}}"#, &ask).unwrap();
        assert_eq!((st, v["rev"].as_i64()), (200, Some(1)));
        assert_eq!(lot.handle_body("GET", "/api/ui-state", "", b"", &ask).unwrap().1["keys"]["tpa.a"], "1");
        assert!(local.join("ui_state.json").exists(), "作業場所に書く（Python と同じファイル）");
        assert!(lot.handle_body("POST", "/api/ui-state", "", br#"{"x": "\ud800"}"#, &ask).is_none(), "読めない本文は Python に任せる");
        lot.leave();
        assert!(!mine.exists(), "使い終わり: いま使っているの印を消す");
        // 判定の材料（access）が無い前の版の Python: 心拍も利用状況も Python が答える
        let old = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}}));
        let lot2 = Lot::new(dir.join("c2").join("db_cache"));
        assert!(lot2.heartbeat(&old, &|| true).is_none());
        assert!(lot2.handle_body("GET", "/api/presence", "", b"", &old).is_none());
        // 設定を尋ねられないが中身は生きている: Python が答える（書かない）／止まっている: 503
        let fail = || Err("x".to_string());
        let lot3 = Lot::new(dir.join("c3").join("db_cache")); // 設定を覚えていない窓
        assert!(lot3.heartbeat(&fail, &|| true).is_none());
        assert_eq!(lot3.heartbeat(&fail, &|| false).unwrap().0, 503);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_window_answers_the_schedule() {
        // 版 3.96.0: スケジュール（CM3）は窓がただ 1 つの係（本物の道: Lot::handle_body → lists.src_plan_eq → schedule.rs）。Python が
        // 起きていなくても一覧・設備のタブ・カード・データの時刻・再読込を答え、世代と状態のファイルを置く。受け身の Python の知らせ
        // （event: schedule）でも取り、状態の seq を進める。窓が取れない設定（https）は答えず、状態に「係を降りた」と書く
        use std::io::{Read, Write};
        let work = std::env::temp_dir().join(format!("da-lot-schedule-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        let share = work.join("share");
        for d in [work.join("local"), work.join("base"), share.clone()] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(work.join("local").join("instance_id"), "inst1").unwrap();
        let srv = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = srv.local_addr().unwrap().port();
        let hits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let h2 = hits.clone();
        std::thread::spawn(move || {
            for c in srv.incoming().flatten() {
                let mut c = c;
                let mut buf = vec![0u8; 65536];
                let _ = c.read(&mut buf);
                h2.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let body = json!({"status": "SUCCESS", "entity": {"setsubiName": "L-1", "updateTs": 1790982300000_i64, "meisaiList": [
                    {"kanryoYotei": "10/03 08:30", "lotNo": "A1", "zaishitsu": "A1100", "inItaAtsu": "1.0", "outItaAtsu": "0.5", "reienHaba": "1", "keijo": "C", "yotoMei": "缶&#12288;材"},
                    {"kanryoYotei": "     07:10", "lotNo": "ロール", "zaishitsu": "交換", "inItaAtsu": "7分"}]}})
                .to_string();
                let _ = c.write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json;charset=UTF-8\r\nContent-Length: {}\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                );
            }
        });
        let program = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        let conf = |url: &str| {
            json!({"master_share": {"dir": share}, "schedule": {"cm3_base_url": url, "equipments": "L-1", "timeout_sec": 2}}).to_string()
        };
        std::fs::write(&cfg, conf(&format!("http://127.0.0.1:{port}"))).unwrap();
        let login = crate::bundle::login_id();
        let doc = |rows: Value| json!({"schema": 1, "revision": 4, "rows": rows}).to_string();
        std::fs::write(
            share.join("access_permissions.json"),
            doc(json!([{"id": 1, "ログインID": login, "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "rev": 1}])),
        )
        .unwrap();
        for n in ["path_settings", "equipment_groups", "shift_patterns", "conversions", "work_log_files", "equipment_master"] {
            std::fs::write(share.join(format!("{n}.json")), doc(json!([]))).unwrap();
        }
        // スケジュールの行（結合なし）。仕掛と合わせない形
        std::fs::write(share.join("data_sources.json"), doc(json!([{"id": 1, "キー": "sch", "結合": "", "rev": 1}]))).unwrap();
        let env = crate::bundle::Env { base: work.join("base"), program, local: work.join("local"), config: cfg.clone(), now: None };
        let lot = Lot::new(work.join("local").join("db_cache"));
        lot.set_bundle(crate::bundle::Builder::new(env));
        let down = || -> Result<Value, String> { Err("中身（Python）が答えません".into()) };
        let (st, v) = lot.handle_body("GET", "/api/src/sch", "equip=L-1", b"", &down).expect("Python が起きていなくても窓が答える");
        assert_eq!((st, v["count"].clone(), v["schedule"]["summary"]["count"].clone()), (200, json!(2), json!(1)), "{v}");
        assert_eq!(v["rows"][0]["用途名"], json!("缶 材"), "HTML の文字参照を直す");
        assert_eq!(v["rows"][1]["停止内容"], json!("ロール交換 7分"));
        assert_eq!(v["rows"][1]["完了予定"], json!("10/04 07:10"), "時刻だけの行が前より早ければ翌日");
        let root = work.join("local").join("db_cache").join("schedule");
        let state_file = root.join(format!("{}.state.json", crate::schedule::safe("L-1")));
        let state = |f: &std::path::Path| serde_json::from_slice::<Value>(&std::fs::read(f).unwrap()).unwrap();
        let s1 = state(&state_file);
        assert_eq!((s1["writer"].clone(), s1["seq"].clone()), (json!("rs"), json!(1)));
        assert!(s1["path"].as_str().unwrap().ends_with(".g1.rs.sqlite3"));
        let (_, m) = lot.handle_body("GET", "/api/schedule", "", b"", &down).unwrap();
        assert_eq!(m["equipments"][0]["state"], json!("ok"));
        let (_, card) = lot.handle_body("GET", "/api/schedule/card", "", b"", &down).unwrap();
        assert_eq!((card["mirror"]["kind"].clone(), card["equipCount"].clone()), (json!("cm3"), json!(1)));
        let (st, src) = lot.handle_body("GET", "/api/src/sch/source", "equip=L-1", b"", &down).unwrap();
        assert_eq!((st, src["at"].clone()), (200, json!(1790982300.0)));
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1, "新しい間は取り直さない");
        let (st, _) = lot.handle_body("POST", "/api/src/sch/refresh", "equip=L-1", b"", &down).unwrap();
        assert_eq!((st, hits.load(std::sync::atomic::Ordering::SeqCst)), (200, 2), "再読込は今すぐ取り直す");
        assert_eq!(state(&state_file)["path"], s1["path"], "中身が同じなら置き直さない");
        assert!(lot.handle_body("GET", "/api/src/sch", "engine=python&equip=L-1", b"", &down).is_none());
        // 受け身の Python の知らせ: 窓が取って状態の seq を進める
        let seq = state(&state_file)["seq"].as_u64().unwrap();
        lot.notice(&json!({"event": "schedule", "equip": "L-1", "termKbn": "4", "inspect": ["点検板"], "maxAge": 0, "force": true, "seq": seq,
                           "fetch": {"cm3_base_url": format!("http://127.0.0.1:{port}"), "init_path": "/x", "client_ip": "1.2.3.4", "timeout_sec": 2, "use_system_proxy": false}}));
        let t0 = Instant::now();
        while state(&state_file)["seq"].as_u64().unwrap() == seq && t0.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 3);
        // 窓が取れない設定（https）: 答えず（Python が取る）、状態に係を降りたと書く
        std::fs::write(&cfg, conf("https://cm3.example")).unwrap();
        lot.invalidate();
        assert!(lot.handle_body("GET", "/api/src/sch", "equip=L-1", b"", &down).is_none(), "https は Python");
        assert!(lot.handle_body("GET", "/api/src/sch/source", "equip=L-1", b"", &down).is_none(), "降りた設備のデータの時刻も Python");
        let s2 = state(&state_file);
        assert_eq!(
            (s2["resigned"]["once"].clone(), s2["resigned"]["for"]["cm3_base_url"].clone()),
            (json!(false), json!("https://cm3.example"))
        );
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 3, "降りたら取りに行かない");
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn the_window_answers_the_calculation() {
        // 版 3.72.0（順 6 の 1 段目）: POST /api/calculate と POST /api/equipment/inspection は窓が答える（マスタは置き場から読む）。
        // 設定に calculation が無い（前の版の Python）・engine=python・読めない本文は Python に任せる
        let dir = std::env::temp_dir().join(format!("da-lot-calc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let data = dir.join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("equipment_master.json"),
            json!([{"id": 1, "設備名": "TLV", "巻出し方向": "上", "ライン方向": "←", "検査計": "有"}, {"id": 2, "設備名": "L-1", "巻取方向": "下"}]).to_string()).unwrap();
        std::fs::write(
            data.join("roll_master.json"),
            json!([{"id": 1, "設備": "TLV", "入出位置": "出側", "ロール径MAX": "194", "ロール名": "R"}]).to_string(),
        )
        .unwrap();
        let place = json!({"shareDir": "", "shared": [], "data": data, "defaults": dir.join("defaults"), "cache": dir.join("cache"), "presence": "", "lockTtl": 20.0});
        let conf = json!({"who": {"login": "u", "pc": "PC", "key": "PC@u"}, "place": place});
        let ask = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": conf.clone(), "calculation": {}}));
        let lot = Lot::new(dir.join("local").join("db_cache"));
        let body = json!({"lot": {"density": 2.7, "processes": [
            {"no": 1, "equipment": "L-1", "thickness": 1.0, "width": 1000, "weight": 5000, "unwind": "上"},
            {"no": 2, "equipment": "TLV", "thickness": 0.5, "width": 1000, "weight": 4900, "unwind": "下"}]},
            "inputs": {"found_equipment": "2:TLV", "found_pitch_mm": 610, "soil_a_m": 100, "soil_b_m": 103, "tolerance_percent": 5}});
        let b = serde_json::to_vec(&body).unwrap();
        let (st, v) = lot.handle_body("POST", "/api/calculate", "", &b, &ask).expect("窓が答える");
        assert_eq!((st, v["actual_transfer_distance_m"].as_f64()), (200, Some(3.0)), "{v}");
        assert_eq!(v["processes"][1]["auto_rewind_master"], "上", "旧い列名（巻出し方向）を巻取方向に読み替える");
        assert_eq!(v["processes"][1]["roll_candidates"][0]["name"], "R");
        let (st, v) = lot.handle_body("POST", "/api/equipment/inspection", "", br#"{"names": ["TLV", "L-1", "x"]}"#, &ask).unwrap();
        assert_eq!((st, v["inspection"].clone()), (200, json!({"TLV": true, "L-1": false, "x": false})));
        let (st, v) = lot.handle_body("POST", "/api/calculate", "", br#"{"inputs": {}}"#, &ask).unwrap();
        assert_eq!((st, v["error"].as_str()), (400, Some("計算するロット（lot）がありません。")));
        assert!(lot.handle_body("POST", "/api/calculate", "engine=python", &b, &ask).is_none(), "engine=python は Python");
        assert!(lot.handle_body("POST", "/api/calculate", "", b"{\"lot\": NaN}", &ask).is_none(), "読めない本文は Python");
        let old = || Ok(json!({"source": "", "engine": "rust", "lists": {"hidden": []}, "access": conf.clone()}));
        assert!(
            Lot::new(dir.join("l2").join("db_cache")).handle_body("POST", "/api/calculate", "", &b, &old).is_none(),
            "calculation の無い前の版の Python"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
