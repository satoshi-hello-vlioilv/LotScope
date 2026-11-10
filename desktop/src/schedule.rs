//! スケジュール（CM3 の設備ごとの作業予定。版 3.96.0。Python の services/schedule.py を写した）。
//!
//! 係はただ 1 つ（窓）。窓は sidecar.rs の SERVES に schedule を名乗り、CM3 へ取りに行く・世代のファイルを置く・状態のファイルを書く。
//! Python の Schedules は受け身（窓の状態のファイルと世代を読むだけ。取りに行く要るときは知らせ {"event": "schedule", …} で窓に頼んで待つ）。
//!
//! 置き場（この PC の作業場所の db_cache/schedule。Python と同じ）:
//!   <設備>.g<番号>.<書き手>.sqlite3 … 世代（表「予定」）。番号は置き場にある最大＋1（プロセスごとに 1 から数えない。
//!                                    書き手〈rs＝窓・py＝Python〉を名前に入れ、相手の今の世代を消さない。窓は自分の世代を置いた後に、
//!                                    係を降りていた間に Python が置いた古い世代も片付ける〈新しい世代と 1 つ前は残す〉）
//!   <設備>.state.json             … 状態（書き手・seq〈済むたびに 1 増える〉・path・sig・gen・時刻・error・整えた答え data・resigned）。
//!                                    一時ファイルから置き換える
//!
//! 窓が取れない設定（https・システムのプロキシ・数でない timeout など）のあいだは、窓は状態の resigned に「係を降りた」と書き
//! （for: その設定、once: false）、受け身の Python が自分で取りに行って置く（書き手 py）。窓が同じに整えられない答え（窓の持たない
//! charset・Python が落ちる形）は、その 1 回だけ降りる（once: true。Python が取り終えたら消す）。降りたことのある設備では、答える前に
//! 状態のファイルを読み、Python が取って置いていればその答えと世代を覚えにする（adopt。戻った窓が古い予定を答えない）。
//!
//! 錠を待っていた問い合わせは、待っている間に済んだ取り直しの結果を失敗も含めて使う（同じ設備の問い合わせが重なっても、
//! 届かない CM3 を 1 本ずつ timeout 秒待ち直さない。Python も同じ）。窓を起こし直したときは前の状態を読まない（今の答えのまま。
//! 状態のファイルと自分の書いた世代は最初に使うときに片付ける）。

use crate::cm3::{self, Cell, Fail, R};
use crate::jsontree::Tree;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const HOT_KEY: &str = "__HOT__";
pub const TABLE: &str = "予定";
pub const HOT_TABLE: &str = "HOT";
/// 窓の書き手の印（世代の名前・状態のファイル）
pub const WRITER: &str = "rs";

// ------------------------------------------------------------------ 設定（schedule.config）
#[derive(Debug, Clone)]
pub struct Equip {
    pub code: String,
    pub name: String,
    pub term_kbn: String,
}

#[derive(Debug, Clone)]
pub struct Hot {
    pub title: Value,
    pub equipments: Vec<String>,
    pub prev_value: Value,
    pub result_col: Value,
    pub remain_col: Value,
    pub kama_col: Value,
}

/// 既定に重ねた設定（Python の schedule.config の答え）
#[derive(Debug, Clone)]
pub struct Cfg {
    pub m: Map<String, Value>,
    pub equipments: Vec<Equip>,
    pub inspect: Vec<String>,
    pub hot: Hot,
}

fn defaults() -> Map<String, Value> {
    json!({
        "cm3_base_url": "http://nlmfangyweb1a:9085",
        "init_path": "/Cm3SchWeb/service/schapp/cmschview/init",
        "cm3_view_url_template": "{base}/Cm3SchWeb/#/schapp/cmschview?termkbn={termkbn}&setsubi={setsubi}",
        "client_ip": "150.150.107.35",
        "equipments": "L-1, L-2, L-3",
        "term_kbn": "4",
        "inspect_keywords": "点検板",
        "timeout_sec": 15,
        "use_system_proxy": false,
        "cache_sec": 10,
        "auto_refresh_sec": 60,
    })
    .as_object()
    .unwrap()
    .clone()
}

fn hot_defaults() -> Map<String, Value> {
    json!({"title": "HOTコイル作業順", "equipments": "", "prev_value": "HOT", "result_course_column": "実績_設備ｺｰｽ",
           "remain_course_column": "残仕掛設備ｺｰｽ", "kama_column": "設計_PIT炉番炉順"})
    .as_object()
    .unwrap()
    .clone()
}

/// Python の str(値)。窓が同じ字にできなければ None
pub fn pstr(v: &Value) -> Option<String> {
    cm3::py_str(&Tree::from_value(v)).ok()
}

fn truthy(v: &Value) -> bool {
    crate::lotlist::json_truthy(v)
}

/// v not in (None, "")
fn present(v: &Value) -> bool {
    !(v.is_null() || v == "")
}

/// _words: 「,」「、」「，」・空白で区切る（並びは「,」でつなぐ）
fn words(v: &Value) -> Option<Vec<String>> {
    let text = match v {
        Value::Array(a) => a.iter().map(pstr).collect::<Option<Vec<_>>>()?.join(","),
        x if !truthy(x) => String::new(),
        x => pstr(x)?,
    };
    Some(
        text.split(|c: char| matches!(c, ',' | '、' | '，') || crate::pyfmt::is_space(c))
            .filter(|w| !w.is_empty())
            .map(String::from)
            .collect(),
    )
}

impl Cfg {
    /// 設定の schedule の段（effective_settings(app).get("schedule")）→ 設定。Python が落ちる形・窓が同じに読めない形は Err
    pub fn from_section(section: Option<&Value>) -> Result<Cfg, &'static str> {
        let raw = match section {
            None => Map::new(),
            Some(x) if !truthy(x) => Map::new(),
            Some(Value::Object(o)) => o.clone(),
            Some(_) => return Err("schedule の段が表でない"),
        };
        let mut m = defaults();
        for (k, v) in &raw {
            if present(v) && k != "hot" {
                m.insert(k.clone(), v.clone());
            }
        }
        let mut hm = hot_defaults();
        match raw.get("hot") {
            Some(x) if !truthy(x) => {}
            None => {}
            Some(Value::Object(o)) => {
                for (k, v) in o {
                    if present(v) {
                        hm.insert(k.clone(), v.clone());
                    }
                }
            }
            Some(_) => return Err("schedule.hot が表でない（Python は落ちる）"),
        }
        for k in ["cache_sec", "auto_refresh_sec"] {
            if !(m[k].is_number() || m[k].is_boolean()) {
                return Err("取り直しの秒が数でない（Python は比べる所で落ちる）");
            }
        }
        let term = pstr(&m["term_kbn"]).ok_or("端末区分の字")?;
        let mut eqs: Vec<Equip> = vec![];
        for w in words(&m["equipments"]).ok_or("設備の字")? {
            let (code, kbn) = w.split_once(':').unwrap_or((&w, ""));
            if !code.is_empty() && !eqs.iter().any(|e| e.code == code) {
                eqs.push(Equip { code: code.into(), name: code.into(), term_kbn: if kbn.is_empty() { term.clone() } else { kbn.into() } });
            }
        }
        let inspect = words(&m["inspect_keywords"]).ok_or("点検の言葉の字")?;
        let codes: Vec<String> = eqs.iter().map(|e| e.code.clone()).collect();
        let hw = words(&hm["equipments"]).ok_or("HOT の設備の字")?;
        let hot_eqs = (if hw.is_empty() { codes.clone() } else { hw }).into_iter().filter(|e| codes.contains(e)).collect();
        let hot = Hot {
            title: hm["title"].clone(),
            equipments: hot_eqs,
            prev_value: hm["prev_value"].clone(),
            result_col: hm["result_course_column"].clone(),
            remain_col: hm["remain_course_column"].clone(),
            kama_col: hm["kama_column"].clone(),
        };
        Ok(Cfg { m, equipments: eqs, inspect, hot })
    }

    /// Python の受け身の知らせ（{"fetch": {…}, "equip", "termKbn", "inspect"}）から（取りに行くのに要る所だけ）
    pub fn from_notice(v: &Value) -> Option<Cfg> {
        let mut m = defaults();
        for (k, x) in v["fetch"].as_object()? {
            m.insert(k.clone(), x.clone());
        }
        let code = v["equip"].as_str()?.to_string();
        let term = v["termKbn"].as_str()?.to_string();
        let inspect = v["inspect"].as_array()?.iter().map(|x| x.as_str().map(String::from)).collect::<Option<Vec<_>>>()?;
        let hot = Hot {
            title: Value::Null,
            equipments: vec![],
            prev_value: Value::Null,
            result_col: Value::Null,
            remain_col: Value::Null,
            kama_col: Value::Null,
        };
        Some(Cfg { m, equipments: vec![Equip { code: code.clone(), name: code, term_kbn: term }], inspect, hot })
    }

    /// 取りに行く設定（状態の resigned.for。Python の受け身の係が自分の設定と比べる）
    pub fn fetch_conf(&self) -> Value {
        let mut o = Map::new();
        for k in ["cm3_base_url", "init_path", "client_ip", "timeout_sec", "use_system_proxy"] {
            o.insert(k.into(), self.m.get(k).cloned().unwrap_or(Value::Null));
        }
        Value::Object(o)
    }

    pub fn equip(&self, code: &str) -> Option<&Equip> {
        self.equipments.iter().find(|e| e.code == code)
    }

    pub fn auto_refresh(&self) -> f64 {
        num(&self.m["auto_refresh_sec"])
    }

    pub fn base_text(&self) -> String {
        pstr(&self.m["cm3_base_url"]).unwrap_or_default()
    }

    /// 窓が取りに行ける設定か（取りに行く前に分かる物。Python は https・プロキシ・数でない timeout などを自分で取る）
    pub fn fetch_plan(&self) -> R<(String, String, Duration)> {
        let base_v = &self.m["cm3_base_url"];
        let base = if truthy(base_v) { cm3::py_str(&Tree::from_value(base_v))? } else { String::new() };
        let base = base.trim_end_matches('/').to_string();
        if base.is_empty() {
            return Err(Fail::Cm3("CM3 の場所（参照先の「CM3 の URL」）が決まっていません".into()));
        }
        if truthy(&self.m["use_system_proxy"]) {
            return Err(Fail::Python("システムのプロキシ（環境変数・Windows の設定。窓は読まない）"));
        }
        let iv = &self.m["init_path"];
        let init = if truthy(iv) { cm3::py_str(&Tree::from_value(iv))? } else { String::new() };
        let t = &self.m["timeout_sec"];
        let secs = if !truthy(t) {
            15.0
        } else {
            match t {
                Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
                Value::Bool(b) => f64::from(u8::from(*b)),
                Value::String(s) => {
                    crate::pyfmt::py_float(s).map_err(|_| Fail::Python("timeout_sec が数でない（Python は ValueError）"))?
                }
                _ => return Err(Fail::Python("timeout_sec が並び・表")),
            }
        };
        if !secs.is_finite() || secs <= 0.0 || secs > 1e6 {
            return Err(Fail::Python("timeout_sec が正の有限の数でない"));
        }
        let url = format!("{base}{init}");
        crate::cm3_http::target(&url)?;
        Ok((url, base, Duration::from_secs_f64(secs)))
    }
}

fn num(v: &Value) -> f64 {
    match v {
        Value::Bool(b) => f64::from(u8::from(*b)),
        x => x.as_f64().unwrap_or(0.0),
    }
}

/// urllib.parse.quote(s)（safe は「/」）
fn quote(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"_.-~/".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// 「CM3 の画面を開く」の URL（設備でなければ空）
pub fn view_url(cfg: &Cfg, code: &str) -> String {
    let Some(e) = cfg.equip(code) else { return String::new() };
    let tpl = pstr(&cfg.m["cm3_view_url_template"]).unwrap_or_default();
    tpl.replace("{base}", cfg.base_text().trim_end_matches('/'))
        .replace("{setsubi}", &quote(code))
        .replace("{termkbn}", &quote(&e.term_kbn))
}

/// 列名の比べ方（NFKC・大文字・\s _ - . ・ を除く）
pub fn norm_name(s: &str) -> String {
    cm3::nfkc_upper(s).chars().filter(|c| !(crate::pyfmt::is_space(*c) || matches!(c, '_' | '-' | '.' | '・'))).collect()
}

/// 値の比べ方（NFKC・大文字・空白を除く・数は数で）
pub fn norm_key(s: &str) -> String {
    let t: String = cm3::nfkc_upper(s).chars().filter(|c| !crate::pyfmt::is_space(*c)).collect();
    // [+-]?\d+(\.\d+)?（\d は Unicode の数字）
    let body = t.strip_prefix(['+', '-']).unwrap_or(&t);
    let (ip, fp) = match body.split_once('.') {
        Some((a, b)) => (a, Some(b)),
        None => (body, None),
    };
    let digits = |x: &str| !x.is_empty() && x.chars().all(|c| crate::pyfmt::digit(c).is_some());
    if digits(ip) && fp.is_none_or(digits) {
        if let Ok(f) = crate::pyfmt::py_float(&t) {
            let s = format!("{f:.6}");
            return s.trim_end_matches('0').trim_end_matches('.').to_string();
        }
    }
    t
}

/// 表の列のうち name に当たる物（そのまま → 比べ方をそろえて）
pub fn find_column(cols: &[String], name: &Value) -> String {
    let n = match name {
        x if !truthy(x) => String::new(),
        x => pstr(x).unwrap_or_default(),
    };
    if let Some(Value::String(s)) = Some(name) {
        if cols.contains(s) {
            return s.clone();
        }
    }
    let k = norm_name(&n);
    cols.iter().find(|c| norm_name(c) == k).cloned().unwrap_or_default()
}

/// 置き場の名前（英数字と _ - のほかを _ に・sha1 の頭 6 字）
pub fn safe(code: &str) -> String {
    let head: String = code.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
    format!("{head}-{}", &crate::bundle::sha1_hex(code.as_bytes())[..6])
}

// ------------------------------------------------------------------ 覚え
/// 設備の覚え（Python の _state の 1 つ。peek の形）
#[derive(Debug, Clone, Default)]
pub struct St {
    pub data: Option<Value>,
    pub path: Option<PathBuf>,
    pub sig: String,
    pub gen: u64,
    pub fetched_at: Option<f64>,
    pub changed_at: Option<f64>,
    pub checked_at: Option<f64>,
    pub error: String,
    /// HOT の情報（build_hot の info）
    pub info: Option<Value>,
}

fn now() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

/// time.strftime("%Y/%m/%d %H:%M:%S", time.localtime(t))
fn local_text(t: f64) -> String {
    use chrono::TimeZone;
    chrono::Local.timestamp_opt(t.floor() as i64, 0).single().map(|d| d.format("%Y/%m/%d %H:%M:%S").to_string()).unwrap_or_default()
}

/// 1 つの表だけを持つ SQLite を書き切る（一時ファイルに書いて置き換える）
pub fn write_table(path: &Path, table: &str, cols: &[String], rows: &[Vec<Cell>]) -> Result<(), String> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tmp = path.with_file_name(format!("{stem}.{}.{nanos}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    let q = crate::lotlist::qi;
    let run = || -> rusqlite::Result<()> {
        let mut c = rusqlite::Connection::open(&tmp)?;
        c.execute_batch("PRAGMA journal_mode=OFF")?;
        c.execute_batch(&format!("CREATE TABLE {} ({})", q(table), cols.iter().map(|x| q(x)).collect::<Vec<_>>().join(", ")))?;
        let tx = c.transaction()?;
        {
            let mut st = tx.prepare(&format!("INSERT INTO {} VALUES ({})", q(table), vec!["?"; cols.len()].join(", ")))?;
            for r in rows {
                st.execute(rusqlite::params_from_iter(r.iter().map(Cell::to_sql)))?;
            }
        }
        tx.commit()
    };
    if let Err(e) = run() {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    replace(&tmp, path)
}

/// 置き換える（Windows で読んでいる途中なら少し待って取り直す）
fn replace(tmp: &Path, dest: &Path) -> Result<(), String> {
    let mut last = String::new();
    for i in 0..20 {
        match std::fs::rename(tmp, dest) {
            Ok(()) => return Ok(()),
            Err(e) => last = e.to_string(),
        }
        std::thread::sleep(Duration::from_millis(25 * (i + 1)));
    }
    let _ = std::fs::remove_file(tmp);
    Err(last)
}

/// 置き場の世代のファイル（<safe>.g<番号>[.<書き手>].sqlite3）→ (番号, 書き手〈無ければ ""〉)
fn gen_of(name: &str, head: &str) -> Option<(u64, String)> {
    let rest = name.strip_prefix(head)?.strip_suffix(".sqlite3")?;
    let (n, w) = rest.split_once('.').unwrap_or((rest, ""));
    (!n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())).then(|| (n.parse().ok(), w.to_string())).and_then(|(n, w)| n.map(|n| (n, w)))
}

/// 設備ごとの錠と、済んだ回数
#[derive(Default)]
struct Inner {
    state: HashMap<String, St>,
    seq: HashMap<String, u64>,
    locks: HashMap<String, Arc<Mutex<()>>>,
    bg: HashSet<String>,
    /// その 1 回だけ Python に任せた設備（Python が取り終えて状態の resigned を消すまで）
    py_once: HashSet<String>,
    /// 係を降りたことのある設備（降りていた間に Python が状態と世代を置いたかもしれない。答える前に状態のファイルを確かめる）
    foreign: HashSet<String>,
    cleaned: bool,
}

/// 窓の係（Lot に 1 つ）
pub struct Schedules {
    root: PathBuf,
    inner: Mutex<Inner>,
}

impl Schedules {
    pub fn new(root: PathBuf) -> Schedules {
        Schedules { root, inner: Mutex::default() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 起こしてから初めて使うとき: 前の状態を読まず、状態のファイルと自分の書いた世代（と前の版の名前の世代）を片付ける
    fn clean_once(&self) {
        {
            let mut g = self.inner.lock().unwrap();
            if g.cleaned {
                return;
            }
            g.cleaned = true;
        }
        for e in std::fs::read_dir(&self.root).into_iter().flatten().flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            let own_gen = n.ends_with(".sqlite3")
                && n.rsplit_once(".g").is_some_and(|(_, r)| {
                    let w = r.trim_end_matches(".sqlite3").split_once('.').map(|x| x.1).unwrap_or("");
                    w.is_empty() || w == WRITER
                });
            if n.ends_with(".state.json") || own_gen {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }

    /// 状態のファイルから読んだ覚え（いま係の書き手〈窓か、降りたときの Python〉の物。画面の札・カード・データの時刻。
    /// 受け身の Python の peek と同じ所を読む）
    pub fn shared(&self, code: &str) -> St {
        self.clean_once();
        st_of(&self.read_state(code))
    }

    /// その設備の係を降りているか（窓の取れない設定・1 回だけ任せた答え）
    pub fn resigned(&self, cfg: &Cfg, code: &str) -> bool {
        matches!(cfg.fetch_plan(), Err(Fail::Python(_))) || self.python_keeps(code)
    }

    /// 状態の seq だけを 1 つ進める（中身はそのまま。知らせを待つ Python を起こす）
    fn bump(&self, code: &str) {
        let mut v = self.read_state(code);
        if !v.is_object() {
            self.write_state(code, None);
            return;
        }
        v["seq"] = json!(v["seq"].as_u64().unwrap_or(0) + 1);
        let tmp = self.root.join(format!("{}.state.{}.b.tmp", safe(code), std::process::id()));
        if std::fs::write(&tmp, serde_json::to_vec(&v).unwrap_or_default()).is_ok() {
            let _ = replace(&tmp, &self.state_path(code));
        }
    }

    pub fn peek(&self, code: &str) -> St {
        self.inner.lock().unwrap().state.get(code).cloned().unwrap_or_default()
    }

    fn eq_lock(&self, code: &str) -> Arc<Mutex<()>> {
        self.inner.lock().unwrap().locks.entry(code.into()).or_default().clone()
    }

    fn seq(&self, code: &str) -> u64 {
        self.inner.lock().unwrap().seq.get(code).copied().unwrap_or(0)
    }

    fn state_path(&self, code: &str) -> PathBuf {
        self.root.join(format!("{}.state.json", safe(code)))
    }

    /// 状態のファイル（無ければ Null）。置き換えている途中で読めない（Windows の共有違反・半端な中身）ときは少し待って読み直す
    fn read_state(&self, code: &str) -> Value {
        for i in 0..5 {
            match std::fs::read(self.state_path(code)) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Value::Null,
                Ok(b) => {
                    if let Ok(v) = serde_json::from_slice(&b) {
                        return v;
                    }
                }
                Err(_) => {}
            }
            std::thread::sleep(Duration::from_millis(20 * (i + 1)));
        }
        Value::Null
    }

    /// 状態のファイルを書く（seq はファイルの seq＋1。一時ファイルから置き換える）
    fn write_state(&self, code: &str, resigned: Option<Value>) {
        let st = self.peek(code);
        let had = self.read_state(code);
        let seq = had["seq"].as_u64().unwrap_or(0) + 1;
        let v = json!({
            "code": code, "writer": WRITER, "seq": seq,
            "path": st.path.as_ref().map(|p| p.display().to_string()), "sig": st.sig, "gen": st.gen,
            "fetchedAt": st.fetched_at, "changedAt": st.changed_at, "checkedAt": st.checked_at, "error": st.error,
            "data": st.data, "resigned": resigned,
        });
        let _ = std::fs::create_dir_all(&self.root);
        let dest = self.state_path(code);
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let tmp = self.root.join(format!("{}.state.{}.{nanos}.tmp", safe(code), std::process::id()));
        if std::fs::write(&tmp, serde_json::to_vec(&v).unwrap_or_default()).is_ok() {
            let _ = replace(&tmp, &dest);
        }
    }

    fn done(&self, code: &str) {
        *self.inner.lock().unwrap().seq.entry(code.into()).or_insert(0) += 1;
    }

    /// 係を降りる（状態の resigned に書く）。once は答えを窓が整えられなかったその 1 回だけ
    fn resign(&self, cfg: &Cfg, code: &str, why: &str, once: bool) {
        let want = json!({"for": cfg.fetch_conf(), "why": why, "once": once});
        self.inner.lock().unwrap().foreign.insert(code.into());
        let had = self.read_state(code);
        if once {
            self.inner.lock().unwrap().py_once.insert(code.into());
        } else if had["resigned"]["for"] == want["for"] && had["resigned"]["once"] == json!(false) {
            return; // もう降りている（Python が係）
        }
        self.done(code);
        if had["writer"] == "py" {
            // Python が係の状態を、印だけ替えて書き直す（中身は Python の物のまま）
            let mut v = had;
            v["resigned"] = want;
            v["seq"] = json!(v["seq"].as_u64().unwrap_or(0) + 1);
            let tmp = self.root.join(format!("{}.state.{}.r.tmp", safe(code), std::process::id()));
            if std::fs::write(&tmp, serde_json::to_vec(&v).unwrap_or_default()).is_ok() {
                let _ = replace(&tmp, &self.state_path(code));
            }
            return;
        }
        self.write_state(code, Some(want));
    }

    /// その設備は Python が係か（1 回だけ任せた答えを Python がまだ取り終えていない）
    fn python_keeps(&self, code: &str) -> bool {
        if !self.inner.lock().unwrap().py_once.contains(code) {
            return false;
        }
        let st = self.read_state(code);
        if st["resigned"]["once"] == json!(true) {
            return true;
        }
        self.inner.lock().unwrap().py_once.remove(code);
        false
    }

    /// 係を降りていた間に Python が取って置いた（状態の書き手が py）なら、その世代・答え・時刻を覚えにする（版 3.96.0 の作った後の採点の割れ 1:
    /// 戻った窓が自分の覚えの古い予定を答え、カード〈状態のファイル〉と食い違った）。Python だけの形と同じく、いちばん新しく取った答えを使う
    fn adopt(&self, code: &str) {
        if !self.inner.lock().unwrap().foreign.contains(code) {
            return;
        }
        let v = self.read_state(code);
        if v["writer"] != "py" {
            return;
        }
        let f = st_of(&v);
        let mut g = self.inner.lock().unwrap();
        let cur = g.state.entry(code.into()).or_default();
        if cur.path != f.path || cur.sig != f.sig || cur.gen != f.gen || cur.checked_at != f.checked_at || cur.error != f.error {
            *cur = St { info: cur.info.take(), ..f };
        }
    }

    /// 設備 code の予定を、max_age 秒より古ければ取り直して表に置く → 覚え。
    /// 取れなければ前の答えがあればそれ（error に理由）、一度も取れていなければ Cm3。窓が取れない・整えられない形は Python
    pub fn ensure(&self, cfg: &Cfg, code: &str, max_age: f64, force: bool) -> R<St> {
        self.clean_once();
        let Some(e) = cfg.equip(code).cloned() else { return Err(Fail::Cm3(format!("未登録の設備です: {code}"))) };
        if self.python_keeps(code) {
            return Err(Fail::Python("この答えは Python が取る（1 回だけ任せた）"));
        }
        let plan = match cfg.fetch_plan() {
            Err(Fail::Python(why)) => {
                self.resign(cfg, code, why, false);
                return Err(Fail::Python(why));
            }
            x => x,
        };
        let seq0 = self.seq(code);
        let lk = self.eq_lock(code);
        let _one = lk.lock().unwrap_or_else(|x| x.into_inner());
        self.adopt(code);
        let st = self.peek(code);
        if self.seq(code) != seq0 {
            // 錠を待っている間に先の取り直しが済んだ: その結果を使う（失敗も）
            if st.path.is_none() && !st.error.is_empty() {
                return Err(Fail::Cm3(st.error));
            }
            if st.path.is_some() {
                return Ok(st);
            }
        }
        let age = st.checked_at.map(|t| now() - t);
        if !force && st.path.is_some() && age.is_some_and(|a| a < max_age) {
            return Ok(st);
        }
        let t = now();
        let got = plan.and_then(|(url, base, timeout)| self.fetch(cfg, &e, &url, &base, timeout));
        let got = got.and_then(|mut data| {
            data["fetchedAt"] = json!(local_text(t));
            let rows = cm3::table_rows(&data)?;
            Ok((data, rows))
        });
        match got {
            Err(Fail::Cm3(msg)) => {
                let st = {
                    let mut g = self.inner.lock().unwrap();
                    let cur = g.state.entry(code.into()).or_default();
                    cur.checked_at = Some(t);
                    cur.error = msg.clone();
                    cur.clone()
                };
                self.done(code);
                self.write_state(code, None);
                if st.path.is_none() {
                    return Err(Fail::Cm3(msg));
                }
                Ok(st)
            }
            Err(Fail::Python(why)) => {
                self.resign(cfg, code, why, true);
                Err(Fail::Python(why))
            }
            Ok((data, rows)) => {
                if let Err(e) = self.store(code, data, rows, t) {
                    // 置けない（置き場に書けない）: Python の _store は OSError で落ちる
                    let _ = e;
                    self.done(code);
                    return Err(Fail::Python("世代のファイルを置けない"));
                }
                self.done(code);
                self.write_state(code, None);
                Ok(self.peek(code))
            }
        }
    }

    /// CM3 に問い合わせて整える
    fn fetch(&self, cfg: &Cfg, e: &Equip, url: &str, base: &str, timeout: Duration) -> R<Value> {
        let payload = Tree::Obj(vec![
            ("ip".into(), Tree::from_value(&cfg.m["client_ip"])),
            ("userID".into(), Tree::Null),
            ("termID".into(), Tree::Null),
            ("setsubiName".into(), Tree::Str(e.code.clone())),
            ("useKbn".into(), Tree::Null),
            ("termKbn".into(), Tree::Str(e.term_kbn.clone())),
            ("authInfo".into(), Tree::Null),
            ("result".into(), Tree::Num(0.into())),
            ("error".into(), Tree::Bool(false)),
            ("errorMessage".into(), Tree::Str(String::new())),
            ("version".into(), Tree::Null),
            ("setsubi".into(), Tree::Str(String::new())),
            ("updateTs".into(), Tree::Null),
            ("meisaiList".into(), Tree::Arr(vec![])),
            ("urlSetsubi".into(), Tree::Str(e.code.clone())),
            ("urlTermKbn".into(), Tree::Str(e.term_kbn.clone())),
        ]);
        let body = payload.dumps(", ", ": ");
        let r = crate::cm3_http::post(url, base, body.as_bytes(), timeout)?;
        let text = cm3::decode_body(&r.body, r.header("Content-Type"))?;
        let first = text.trim_start_matches([' ', '\t', '\n', '\r']).chars().next();
        if first.is_some_and(|c| "{[\"-0123456789tfnNI".contains(c)) && crate::master_rows::text_split(&text) {
            return Err(Fail::Python("JSON の読みが Python と割れる（NaN・大きな整数・深い入れ子）"));
        }
        let Some(raw) = Tree::parse(&text) else { return Err(Fail::Cm3("CM3の応答がJSONではありません".into())) };
        cm3::normalize(&raw, &e.code, &cfg.inspect)
    }

    fn sig_of(rows: &[Vec<Cell>]) -> String {
        let mut s = String::new();
        for r in rows {
            for c in r {
                s.push_str(&c.sig_text());
                s.push('\u{1}');
            }
            s.push('\n');
        }
        crate::bundle::sha1_hex(s.as_bytes())
    }

    /// 置き場にある最大の番号（書き手によらず）
    fn max_gen(&self, code: &str) -> u64 {
        let head = format!("{}.g", safe(code));
        std::fs::read_dir(&self.root)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| gen_of(&e.file_name().to_string_lossy(), &head).map(|x| x.0))
            .max()
            .unwrap_or(0)
    }

    /// 古い世代を消す（残す: 新しい世代と 1 つ前。読んでいて消せなければ次の機会に）。窓が自分の世代を置いた後に呼ぶ。
    /// 係を降りていた間に Python が置いた世代（.py.）も消す（版 3.96.0 の作った後の採点の割れ 2: 受け身の Python は片付けないので、降りるたびに残った）。
    /// Python が今読んでいるかもしれない物は残す: 戻った窓は Python の今の世代を覚えに取り込んでいる（adopt）ので、それが「1 つ前」になる
    /// （版 3.57.1 の「unable to open database」を戻さない）。それより古い Python の世代は、Python だけの形でも Python の _sweep が消す物
    fn sweep(&self, code: &str, keep: &[Option<&PathBuf>]) {
        let head = format!("{}.g", safe(code));
        for e in std::fs::read_dir(&self.root).into_iter().flatten().flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            let Some((_, w)) = gen_of(&n, &head) else { continue };
            if (w == WRITER || w == "py" || w.is_empty()) && !keep.iter().flatten().any(|k| **k == e.path()) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }

    fn store(&self, code: &str, data: Value, rows: Vec<Vec<Cell>>, t: f64) -> Result<(), String> {
        let sig = Self::sig_of(&rows);
        let mut cur = self.peek(code);
        if cur.sig != sig || cur.path.as_ref().is_none_or(|p| !p.exists()) {
            let gen = cur.gen.max(self.max_gen(code)) + 1;
            let path = self.root.join(format!("{}.g{gen}.{WRITER}.sqlite3", safe(code)));
            let cols: Vec<String> = cm3::COLUMNS.iter().map(|(c, _)| c.to_string()).collect();
            write_table(&path, TABLE, &cols, &rows)?;
            self.sweep(code, &[Some(&path), cur.path.as_ref()]);
            cur.path = Some(path);
            cur.sig = sig;
            cur.gen = gen;
            cur.changed_at = Some(t);
        }
        cur.data = Some(data);
        cur.fetched_at = Some(t);
        cur.checked_at = Some(t);
        cur.error = String::new();
        self.inner.lock().unwrap().state.insert(code.into(), cur);
        Ok(())
    }

    /// いくつかの設備を同時に取りに行く（8 本まで）→ 設備ごとの答え（並びは codes の順）
    pub fn ensure_many(self: &Arc<Self>, cfg: &Cfg, codes: &[String], max_age: f64, force: bool) -> Vec<(String, R<St>)> {
        if codes.len() <= 1 {
            return codes.iter().map(|c| (c.clone(), self.ensure(cfg, c, max_age, force))).collect();
        }
        let mut out: Vec<Option<R<St>>> = vec![None; codes.len()];
        for chunk in (0..codes.len()).collect::<Vec<_>>().chunks(8) {
            let hs: Vec<_> = chunk
                .iter()
                .map(|&i| {
                    let (me, cfg, c) = (self.clone(), cfg.clone(), codes[i].clone());
                    (i, std::thread::spawn(move || me.ensure(&cfg, &c, max_age, force)))
                })
                .collect();
            for (i, h) in hs {
                out[i] = Some(h.join().unwrap_or(Err(Fail::Python("取りに行く糸が落ちた"))));
            }
        }
        codes.iter().cloned().zip(out.into_iter().map(Option::unwrap)).collect()
    }

    /// 古くなった設備を裏で取り直す（画面の鮮度の問い合わせから。答えは待たない）
    pub fn refresh_later(self: &Arc<Self>, cfg: &Cfg, codes: &[String]) {
        let ttl = cfg.auto_refresh();
        for c in codes {
            self.adopt(c);
            let st = self.peek(c);
            let due = st.checked_at.is_none_or(|t| now() - t >= ttl);
            if !due || !self.inner.lock().unwrap().bg.insert(c.clone()) {
                continue;
            }
            let (me, cfg, c) = (self.clone(), cfg.clone(), c.clone());
            std::thread::spawn(move || {
                let _ = me.ensure(&cfg, &c, ttl, false);
                me.inner.lock().unwrap().bg.remove(&c);
            });
        }
    }

    /// 受け身の Python からの「取って」（{"event": "schedule", "equip", "termKbn", "inspect", "fetch", "maxAge", "force", "seq"}）。
    /// 済んだら状態の seq が必ず 1 つ増える（新しくて取らなかったときも。Python は seq が変わるまで待つ）
    pub fn on_notice(&self, v: &Value) {
        let Some(cfg) = Cfg::from_notice(v) else { return };
        let code = cfg.equipments[0].code.clone();
        let seq0 = v["seq"].as_u64().unwrap_or(0);
        let max_age = v["maxAge"].as_f64().unwrap_or(cfg.auto_refresh());
        let _ = self.ensure(&cfg, &code, max_age, v["force"].as_bool().unwrap_or(false));
        if self.read_state(&code)["seq"].as_u64().unwrap_or(0) == seq0 {
            self.bump(&code);
        }
    }

    // ------------------------------------------------------------ HOT コイル作業順
    /// parts: (設備, 結合した答えのファイル, 表) → (HOT の表のファイル, 情報)。中身が前と同じならファイルは書き直さない
    pub fn build_hot(&self, cfg: &Cfg, parts: &[(String, PathBuf, String)], errors: &[String]) -> Result<(PathBuf, Value), String> {
        let hot = &cfg.hot;
        let mut items: Vec<HashMap<String, Cell>> = vec![];
        let mut cols_all: Vec<String> = vec![];
        let mut per: Vec<(String, i64)> = vec![];
        let (mut lots, mut no_master, mut other_next, mut later_pass) = (0, 0, 0, 0);
        let (mut f_res, mut f_rem, mut f_kama) = (String::new(), String::new(), String::new());
        // norm_key(hot["prev_value"])（None は ""）
        let prev_value = if hot.prev_value.is_null() { String::new() } else { norm_key(&pstr(&hot.prev_value).unwrap_or_default()) };
        for (code, path, table) in parts {
            per.push((code.clone(), 0));
            let (cols, rows) = read_rows(path, table)?;
            for c in &cols {
                if !cols_all.contains(c) {
                    cols_all.push(c.clone());
                }
            }
            let res = find_column(&cols, &hot.result_col);
            let rem = find_column(&cols, &hot.remain_col);
            let kama = find_column(&cols, &hot.kama_col);
            if f_res.is_empty() {
                f_res = res.clone();
            }
            if f_rem.is_empty() {
                f_rem = rem.clone();
            }
            if f_kama.is_empty() {
                f_kama = kama.clone();
            }
            for r in rows {
                if r.get("区分") != Some(&Cell::Text("製造".into())) {
                    continue;
                }
                lots += 1;
                let empty = |x: &str| matches!(r.get(x), None | Some(Cell::Null)) || r.get(x) == Some(&Cell::Text(String::new()));
                if res.is_empty() || [&res, &rem, &kama].iter().filter(|x| !x.is_empty()).all(|x| empty(x)) {
                    no_master += 1;
                    continue;
                }
                let hist = cell_text(r.get(&res));
                let words: Vec<&str> = hist.split(crate::pyfmt::is_space).filter(|w| !w.is_empty()).collect();
                let prev = words.last().copied().unwrap_or("").to_string();
                if norm_key(&prev) != prev_value {
                    continue;
                }
                if !rem.is_empty() {
                    let nx = cell_text(r.get(&rem));
                    if let Some(first) = nx.split(crate::pyfmt::is_space).find(|w| !w.is_empty()) {
                        if norm_key(first) != norm_key(code) {
                            other_next += 1;
                            continue;
                        }
                    }
                }
                let pass_one = match r.get("パス") {
                    None | Some(Cell::Null) => true,
                    Some(Cell::Int(i)) => *i == 1 || *i == 0,
                    Some(Cell::Real(f)) => *f == 1.0 || *f == 0.0,
                    Some(Cell::Text(s)) => s.is_empty(),
                };
                if !pass_one {
                    later_pass += 1;
                    continue;
                }
                let mut it = r.clone();
                it.insert("前工程".into(), Cell::Text(prev));
                it.insert("釜番".into(), if kama.is_empty() { Cell::Null } else { r.get(&kama).cloned().unwrap_or(Cell::Null) });
                items.push(it);
                per.last_mut().unwrap().1 += 1;
            }
        }
        let order: HashMap<&str, usize> = hot.equipments.iter().enumerate().map(|(i, e)| (e.as_str(), i)).collect();
        let sort_key = |r: &HashMap<String, Cell>| -> Result<(String, usize, i64), String> {
            let at = match r.get("完了予定日時") {
                None | Some(Cell::Null) => "9999".to_string(),
                Some(Cell::Text(s)) if s.is_empty() => "9999".to_string(),
                Some(Cell::Text(s)) => s.clone(),
                _ => return Err("完了予定日時が字でない".into()),
            };
            let eq = match r.get("設備") {
                Some(Cell::Text(s)) => order.get(s.as_str()).copied().unwrap_or(99),
                _ => 99,
            };
            let no = match r.get("No") {
                Some(Cell::Int(i)) => *i,
                None | Some(Cell::Null) => 0,
                _ => return Err("No が整数でない".into()),
            };
            Ok((at, eq, no))
        };
        let mut keyed = items.into_iter().map(|r| sort_key(&r).map(|k| (k, r))).collect::<Result<Vec<_>, String>>()?;
        keyed.sort_by(|a, b| a.0.cmp(&b.0));
        let lead = ["HOT順", "設備", "開始予定", "完了予定", "No", "ロットNo", "パス", "前工程", "釜番"];
        let mut cols: Vec<String> = lead.iter().map(|s| s.to_string()).collect();
        cols.extend(cols_all.iter().filter(|c| !lead.contains(&c.as_str())).cloned());
        let out: Vec<Vec<Cell>> = keyed
            .iter()
            .enumerate()
            .map(|(i, (_, r))| {
                cols.iter().map(|c| if c == "HOT順" { Cell::Int(i as i64 + 1) } else { r.get(c).cloned().unwrap_or(Cell::Null) }).collect()
            })
            .collect();
        let mut sig_src = cols.join("\u{1}");
        sig_src.push('\n');
        sig_src.push_str(&Self::sig_of(&out));
        let sig = crate::bundle::sha1_hex(sig_src.as_bytes());
        let mut cur = self.peek(HOT_KEY);
        let t = now();
        if cur.sig != sig || cur.path.as_ref().is_none_or(|p| !p.exists()) {
            let gen = cur.gen.max(self.max_gen(HOT_KEY)) + 1;
            let path = self.root.join(format!("{}.g{gen}.{WRITER}.sqlite3", safe(HOT_KEY)));
            write_table(&path, HOT_TABLE, &cols, &out)?;
            self.sweep(HOT_KEY, &[Some(&path), cur.path.as_ref()]);
            cur.path = Some(path);
            cur.sig = sig;
            cur.gen = gen;
            cur.changed_at = Some(t);
        }
        let mut perm = Map::new();
        for (k, n) in &per {
            perm.insert(k.clone(), json!(n));
        }
        let info = json!({
            "title": hot.title, "equipments": hot.equipments, "prevValue": hot.prev_value,
            "resultColumn": f_res, "remainColumn": f_rem, "kamaColumn": f_kama, "kamaConfigured": hot.kama_col,
            "perEquipment": perm, "counts": {"lots": lots, "noMaster": no_master, "otherNext": other_next, "laterPass": later_pass},
            "errors": errors,
        });
        cur.info = Some(info.clone());
        cur.checked_at = Some(t);
        let path = cur.path.clone().unwrap();
        self.inner.lock().unwrap().state.insert(HOT_KEY.into(), cur);
        Ok((path, info))
    }

    /// データ元の一覧の行の様子（最後に取った設備の時刻・設備の数。CM3 は見に行かない）
    pub fn card(&self, cfg: &Cfg) -> Value {
        let sts: Vec<(String, St)> = cfg.equipments.iter().map(|e| (e.code.clone(), self.shared(&e.code))).collect();
        let got = sts.iter().filter(|(_, st)| st.path.is_some()).fold(None::<&(String, St)>, |best, x| match best {
            Some(b) if b.1.checked_at.unwrap_or(0.0) >= x.1.checked_at.unwrap_or(0.0) => Some(b),
            _ => Some(x),
        });
        match got {
            None => json!({"mirror": null, "equipCount": sts.len()}),
            Some((k, st)) => json!({"mirror": source_info(cfg, st, k), "equipCount": sts.len()}),
        }
    }

    /// GET /api/schedule（設備のタブと画面が使う設定）
    pub fn meta(&self, cfg: &Cfg) -> Value {
        let eqs: Vec<Value> = cfg
            .equipments
            .iter()
            .map(|e| {
                json!({"key": e.code, "name": e.name, "termKbn": e.term_kbn, "viewUrl": view_url(cfg, &e.code),
                       "state": if self.shared(&e.code).path.is_some() { "ok" } else { "unknown" }})
            })
            .collect();
        let h = &cfg.hot;
        json!({"equipments": eqs, "hot": {"key": HOT_KEY, "title": h.title, "equipments": h.equipments, "prevValue": h.prev_value},
               "autoRefreshSec": cfg.m["auto_refresh_sec"], "inspectKeywords": cfg.inspect, "cm3": cfg.base_text()})
    }
}

/// 状態のファイルの中身 → 覚え
pub fn st_of(v: &Value) -> St {
    let f = |k: &str| v[k].as_f64();
    St {
        data: v.get("data").filter(|d| d.is_object()).cloned(),
        path: v["path"].as_str().map(PathBuf::from),
        sig: v["sig"].as_str().unwrap_or("").into(),
        gen: v["gen"].as_u64().unwrap_or(0),
        fetched_at: f("fetchedAt"),
        changed_at: f("changedAt"),
        checked_at: f("checkedAt"),
        error: v["error"].as_str().unwrap_or("").into(),
        info: None,
    }
}

/// SQLite の値の str(v or "")
fn cell_text(c: Option<&Cell>) -> String {
    match c {
        None | Some(Cell::Null) => String::new(),
        Some(Cell::Int(0)) => String::new(),
        Some(Cell::Int(i)) => i.to_string(),
        Some(Cell::Real(f)) if *f == 0.0 => String::new(),
        Some(Cell::Real(f)) => crate::pyfmt::float_repr(*f),
        Some(Cell::Text(s)) => s.clone(),
    }
}

/// 表の全部の行（列名 → 値）
/// 表の行（列名 → 値）
type Rows = Vec<HashMap<String, Cell>>;

fn read_rows(path: &Path, table: &str) -> Result<(Vec<String>, Rows), String> {
    use rusqlite::types::ValueRef;
    let c = crate::lotlist::connect_ro(path)?;
    let mut st = c.prepare(&format!("SELECT * FROM {}", crate::lotlist::qi(table))).map_err(|e| e.to_string())?;
    let cols: Vec<String> = st.column_names().iter().map(|s| s.to_string()).collect();
    let mut q = st.query([]).map_err(|e| e.to_string())?;
    let mut out = vec![];
    while let Some(r) = q.next().map_err(|e| e.to_string())? {
        let mut m = HashMap::new();
        for (i, name) in cols.iter().enumerate() {
            let v = match r.get_ref(i).map_err(|e| e.to_string())? {
                ValueRef::Null => Cell::Null,
                ValueRef::Integer(i) => Cell::Int(i),
                ValueRef::Real(f) => Cell::Real(f),
                ValueRef::Text(t) => Cell::Text(String::from_utf8_lossy(t).into_owned()),
                ValueRef::Blob(_) => return Err("表にバイナリ（窓は str(bytes) を写さない）".into()),
            };
            m.insert(name.clone(), v);
        }
        out.push(m);
    }
    Ok((cols, out))
}

/// 一覧の「元データ」の札（db_mirror.source_info と同じ形）。at は CM3 の更新、copiedAt は中身が変わって置き直した時刻
pub fn source_info(cfg: &Cfg, st: &St, code: &str) -> Value {
    let ts = st.data.as_ref().and_then(|d| d.get("updateTs")).cloned().unwrap_or(Value::Null);
    let at = cm3::ms_to_seconds(&Tree::from_value(&ts)).ok().flatten();
    let remote = {
        let v = view_url(cfg, code);
        if v.is_empty() {
            cfg.base_text()
        } else {
            v
        }
    };
    json!({"remote": remote, "at": at, "mirrored": st.path.is_some(), "copiedAt": st.changed_at, "checkedAt": st.checked_at,
           "unreachable": !st.error.is_empty(), "reason": st.error, "interval_sec": cfg.m["auto_refresh_sec"], "staleHours": 0,
           "ageHours": null, "stale": false, "kind": "cm3"})
}

/// source_info が Python で落ちる形か（updateTs の int(ts)/1000 が OverflowError）
pub fn source_info_falls(st: &St) -> bool {
    let ts = st.data.as_ref().and_then(|d| d.get("updateTs")).cloned().unwrap_or(Value::Null);
    cm3::ms_to_seconds(&Tree::from_value(&ts)).is_err()
}

/// lotNo の集まりの数（Python の set: 1 == 1.0 == True）
fn distinct_count(vals: &[&Value]) -> usize {
    let mut seen: Vec<String> = vec![];
    for v in vals {
        let k = match v {
            Value::Bool(b) => format!("n{}", u8::from(*b)),
            Value::Number(n) => match n.as_i64() {
                Some(i) => format!("n{i}"),
                None => {
                    let f = n.as_f64().unwrap_or(0.0);
                    if f.fract() == 0.0 && f.abs() < 9e15 {
                        format!("n{}", f as i64)
                    } else {
                        format!("f{f}")
                    }
                }
            },
            x => format!("v{x}"),
        };
        if !seen.contains(&k) {
            seen.push(k);
        }
    }
    seen.len()
}

/// 設備の表の上の数（製造件数・ロット数・点検・設備停止・仕掛と一致・先頭と最終の完了予定・CM3 の更新と取得）
pub fn summary(st: &St, joined: Option<&Value>) -> Value {
    let empty = json!({});
    let data = st.data.as_ref().unwrap_or(&empty);
    let items = data["items"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let lots: Vec<&Value> = items.iter().filter(|i| i["rowKind"] == "lot").collect();
    let times: Vec<&Value> = items.iter().map(|i| &i["kanryoYotei"]).filter(|v| truthy(v)).collect();
    let hit = joined.map(|j| j.get("hit").cloned().unwrap_or(Value::Null)).unwrap_or(Value::Null);
    let stop = items.iter().find(|i| i["rowKind"] == "stop");
    let or_empty = |v: &Value| if truthy(v) { v.clone() } else { json!("") };
    json!({
        "count": lots.len(), "lots": distinct_count(&lots.iter().map(|i| &i["lotNo"]).collect::<Vec<_>>()),
        "inspect": data.get("inspectCount").cloned().unwrap_or(json!(0)), "stop": data.get("stopCount").cloned().unwrap_or(json!(0)),
        "hit": hit, "first": times.first().map(|v| (*v).clone()).unwrap_or(json!("")), "last": times.last().map(|v| (*v).clone()).unwrap_or(json!("")),
        "nextStop": stop.map(|s| json!({"time": or_empty(&s["kanryoYotei"]), "text": or_empty(&s["stopText"])})),
        "updateTime": data.get("updateTime").cloned().unwrap_or(Value::Null), "fetchedAt": data.get("fetchedAt").cloned().unwrap_or(Value::Null),
        "error": st.error,
    })
}

/// 結合した答えで、仕掛に当たらなかった製造の行のロットNo（並べた値）。字と数が混ざれば None（Python の sorted が落ちる）
pub fn missing_lots(path: &Path, table: &str, brought: &[String]) -> Result<Option<Vec<Value>>, String> {
    if brought.is_empty() {
        return Ok(Some(vec![]));
    }
    let q = crate::lotlist::qi;
    let cond = brought.iter().map(|c| format!("{} IS NULL", q(c))).collect::<Vec<_>>().join(" AND ");
    let c = crate::lotlist::connect_ro(path)?;
    let mut st =
        c.prepare(&format!("SELECT {} FROM {} WHERE {} = ? AND {cond}", q("ロットNo"), q(table), q("区分"))).map_err(|e| e.to_string())?;
    let mut rows = st.query(["製造"]).map_err(|e| e.to_string())?;
    // sorted({r[0] for r in rows if r[0]})（同じ値は最初の物。字と数が混ざれば Python の sorted が落ちる）
    let (mut texts, mut nums): (Vec<String>, Vec<(f64, Value)>) = (vec![], vec![]);
    while let Some(r) = rows.next().map_err(|e| e.to_string())? {
        match r.get_ref(0).map_err(|e| e.to_string())? {
            rusqlite::types::ValueRef::Text(t) if !t.is_empty() => {
                let s = String::from_utf8_lossy(t).into_owned();
                if !texts.contains(&s) {
                    texts.push(s);
                }
            }
            rusqlite::types::ValueRef::Integer(i) if i != 0 => {
                if !nums.iter().any(|x| x.0 == i as f64) {
                    nums.push((i as f64, json!(i)));
                }
            }
            rusqlite::types::ValueRef::Real(f) if f != 0.0 => {
                if !nums.iter().any(|x| x.0 == f) {
                    nums.push((f, json!(f)));
                }
            }
            rusqlite::types::ValueRef::Blob(_) => return Ok(None),
            _ => {}
        }
    }
    if !texts.is_empty() && !nums.is_empty() {
        return Ok(None);
    }
    texts.sort();
    nums.sort_by(|a, b| a.0.total_cmp(&b.0));
    Ok(Some(if nums.is_empty() { texts.into_iter().map(Value::String).collect() } else { nums.into_iter().map(|x| x.1).collect() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_like_python() {
        let c =
            Cfg::from_section(Some(&json!({"equipments": "L-1, L-9:2、L-1", "hot": {"equipments": "L-9 X"}, "client_ip": ""}))).unwrap();
        assert_eq!(c.equipments.iter().map(|e| (e.code.as_str(), e.term_kbn.as_str())).collect::<Vec<_>>(), [("L-1", "4"), ("L-9", "2")]);
        assert_eq!(c.hot.equipments, ["L-9"]);
        assert_eq!(c.m["client_ip"], "150.150.107.35", "空の字は既定のまま");
        assert_eq!(view_url(&c, "L-9"), "http://nlmfangyweb1a:9085/Cm3SchWeb/#/schapp/cmschview?termkbn=2&setsubi=L-9");
        assert!(Cfg::from_section(Some(&json!({"hot": [1]}))).is_err());
        assert_eq!(safe("L-1"), format!("L-1-{}", &crate::bundle::sha1_hex(b"L-1")[..6]));
        assert_eq!(safe("ライン1"), format!("___1-{}", &crate::bundle::sha1_hex("ライン1".as_bytes())[..6]));
    }

    #[test]
    fn keys_and_names_like_python() {
        assert_eq!(norm_key("ＨＯＴ "), "HOT");
        assert_eq!(norm_key("1.500"), "1.5");
        assert_eq!(norm_key("-3"), "-3");
        assert_eq!(norm_key("１２"), "12");
        assert_eq!(norm_name("実績_設備ｺｰｽ"), norm_name("実績 設備コース"));
        assert_eq!(gen_of("L-1-abc123.g12.rs.sqlite3", "L-1-abc123.g"), Some((12, "rs".into())));
        assert_eq!(gen_of("L-1-abc123.g3.sqlite3", "L-1-abc123.g"), Some((3, String::new())));
        assert_eq!(gen_of("L-1-abc123.gx.sqlite3", "L-1-abc123.g"), None);
    }
}
