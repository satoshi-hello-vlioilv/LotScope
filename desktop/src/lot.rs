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
}

impl Lot {
    pub fn new(cache_dir: PathBuf) -> Lot {
        // 全列の検索の索引の置き場（版 3.66.0。src/search_index.rs。写しの係の片付けとぶつからない下のフォルダ）
        crate::search_index::set_dir(cache_dir.join("search_index"));
        let local_root = cache_dir.parent().map(PathBuf::from).unwrap_or_else(|| cache_dir.clone());
        Lot {
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
        }
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
            ("GET", "/api/ui-state") => return Some((200, presence::ui_state::load(&self.local_root))),
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
        if let Some(route) = crate::access_write::route_of(method, path) {
            return self.access_write(method, path, route, query, body, ask);
        }
        if crate::calc::is_route(method, path) {
            return self.calc_route(path, query, body, ask);
        }
        if let Some(route) = crate::shifts_write::route_of(method, path) {
            return self.shifts_route(method, path, route, query, body, ask);
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
        if let Some(route) = crate::formats_write::route_of(method, path) {
            return self.formats_route(method, path, route, query, body, ask);
        }
        if presence::is_route(method, path) || path == "/api/ui-state" {
            return self.presence_route(method, path, query, body, ask);
        }
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
            Route::Src(key, Kind::Source | Kind::Refresh) if raw.source(key).is_some_and(|d| d["kind"] == "cm3") => return None,
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
