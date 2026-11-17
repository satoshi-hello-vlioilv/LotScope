//! 窓が自分の答えを焼く係（bless。版 3.115.0。Rust 化の段 ③ の 4 つ目・案 G の 1 版目）。
//!
//! 段 ④ で Python（program/app）を外すと、突き合わせの試験は答えの元（program/tests/*_oracle.py）を失う。そこで窓の答えを
//! 焼いた表（desktop/tests/baked/<本>.json）に持ち、試験は毎回その表と比べる。
//!
//! 流し方（環境変数）:
//! - 何も付けない（Linux）: 今までどおり答え合わせ役（Python）と比べ、そのうえ焼いた表とも比べる（3 回目の比べ）。表が古ければ落ちる。
//!   Windows は表を posix の答えとして持つので比べない（nt の上書きは 2 版目。Windows の CI は ④ まで Windows の Python と比べ続ける）
//! - TPA_NO_PYTHON=1: Python を呼ばない（段 ④ の後の形）。場面のフォルダは表の宣言（scene）から作り、焼いた答えとだけ比べる
//! - TPA_BLESS=1: 焼く。答え合わせ役と比べて、試験の食い違いが 0 で、そろえた後の窓の答え＝そろえた後の Python の答えのときだけ書く
//! - TPA_BLESS=道の型,…（TPA_NO_PYTHON=1 と一緒に。④ の後）: 範囲を宣言して焼き直す。範囲の外の答えが変わったら書かずに止める
//! - TPA_BAKE_OUT=フォルダ: 表を desktop/tests/baked でなくそこへ書く（tools/bless.py が 2 回目を流して 1 回目と比べるため）
//!
//! そろえる決まり（tests/baked/settle.json）は「鍵の名前の表＋字の形」で、揺れなくても常に当てる。焼いた表と比べるときは、窓の答えも
//! 同じ決まりでそろえてから比べる。独立の答え（tools/*-truth.py）と人が書いた事例の表（tests/fixtures/*_cases.json）は bless が書き換えない
//! 第 2 の線（この係は desktop/tests/baked だけに書く）。
#![allow(dead_code)]

use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 場面の中の「今に近い」時刻（この幅の内は今からのずれで持つ）
const NEAR: i64 = 2 * 24 * 3600;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// Python と比べる（焼いた表とも比べる）
    Python,
    /// Python を呼ばない。表の宣言から場面を作り、焼いた答えと比べる
    Baked,
    /// Python と同じときだけ焼く
    Bless,
    /// 範囲を宣言して焼き直す（Python を呼ばない）
    BlessScope,
}

pub fn baked_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("baked")
}

fn rules() -> &'static Value {
    static R: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    R.get_or_init(|| serde_json::from_str(include_str!("../baked/settle.json")).expect("settle.json"))
}

/// root（uid 0）か。表の答えは root で焼き、root でない利用者で違う歩だけを variants.user に持つ
pub fn variant() -> &'static str {
    #[cfg(unix)]
    {
        let s = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
        let uid = s.lines().find_map(|l| l.strip_prefix("Uid:")).and_then(|l| l.split_whitespace().nth(1)).unwrap_or("0");
        if uid != "0" {
            return "user";
        }
    }
    "root"
}

/// 置き換える道の字（作業フォルダ・一時フォルダ・家）。長い物から
#[derive(Clone)]
pub struct Ctx {
    pub subs: Vec<(String, String)>,
}

impl Ctx {
    pub fn new(base: &Path) -> Ctx {
        let mut subs = vec![(base.to_string_lossy().into_owned(), "@WORK".to_string())];
        let tmp = std::env::temp_dir().to_string_lossy().trim_end_matches('/').to_string();
        if tmp.len() > 1 {
            subs.push((tmp, "@TMP".into()));
        }
        if let Ok(h) = std::env::var("HOME") {
            let h = h.trim_end_matches('/').to_string();
            if h.len() > 1 && Path::new(&h).is_dir() {
                subs.push((h, "@HOME".into()));
            }
        }
        subs.push((da_core::held::mark().to_string(), "@HELD:".into()));
        Ctx { subs }
    }
    fn sub(&self, s: &str) -> String {
        let mut t = s.to_string();
        for (a, b) in &self.subs {
            if t.contains(a.as_str()) {
                t = t.replace(a.as_str(), b);
            }
        }
        t
    }
    /// 置き換えを戻す（作業フォルダ・一時フォルダ。家と印の字は戻さない）
    fn unsub(&self, s: &str) -> String {
        let mut t = s.to_string();
        for (a, b) in self.subs.iter().take(2) {
            t = t.replace(b.as_str(), a);
        }
        t
    }
}

fn map_strings(v: &Value, f: &dyn Fn(&str) -> String) -> Value {
    match v {
        Value::String(s) => Value::String(f(s)),
        Value::Array(a) => Value::Array(a.iter().map(|x| map_strings(x, f)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (f(k), map_strings(x, f))).collect()),
        _ => v.clone(),
    }
}

fn compiled() -> &'static (Vec<(regex::Regex, String)>, regex::Regex) {
    static C: std::sync::OnceLock<(Vec<(regex::Regex, String)>, regex::Regex)> = std::sync::OnceLock::new();
    C.get_or_init(|| {
        let forms = rules()["forms"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| (regex::Regex::new(f["re"].as_str().unwrap()).unwrap(), f["to"].as_str().unwrap().to_string()))
            .collect();
        (forms, regex::Regex::new(r"(\d{4})([-/])(\d{2})([-/])(\d{2})").unwrap())
    })
}

/// そろえる（鍵の名前の表＋字の形。tests/baked/settle.json）。extra_keys は本ごとに足す鍵
pub fn settle(v: &Value, ctx: &Ctx, extra_keys: &[String]) -> Value {
    let r = rules();
    let keys: Vec<&str> = r["timeKeys"].as_array().unwrap().iter().filter_map(Value::as_str).chain(extra_keys.iter().map(String::as_str)).collect();
    let (forms, day_re) = compiled();
    let today = chrono::Local::now().date_naive();
    let s = |t: &str| -> String {
        let mut t = ctx.sub(t);
        for (re, to) in forms {
            if re.is_match(&t) {
                t = re.replace_all(&t, to.as_str()).into_owned();
            }
        }
        // 今日に近い日付（±3 日）は今日からのずれで持つ（作業日・前日の答え）
        day_re
            .replace_all(&t, |c: &regex::Captures| {
                let d = chrono::NaiveDate::from_ymd_opt(c[1].parse().unwrap_or(0), c[3].parse().unwrap_or(0), c[5].parse().unwrap_or(0));
                match d {
                    Some(d) if (d - today).num_days().abs() <= 3 => format!("@DAY{:+}{}", (d - today).num_days(), &c[2]),
                    _ => c[0].to_string(),
                }
            })
            .into_owned()
    };
    fn go(v: &Value, keys: &[&str], s: &dyn Fn(&str) -> String) -> Value {
        match v {
            Value::String(t) => Value::String(s(t)),
            Value::Array(a) => Value::Array(a.iter().map(|x| go(x, keys, s)).collect()),
            Value::Object(o) => Value::Object(
                o.iter()
                    .map(|(k, x)| {
                        let timed = keys.contains(&k.as_str())
                            && (x.as_str().is_some_and(|t| !t.is_empty()) || (x.is_number() && x.as_f64().is_some_and(|f| f.abs() > 1e8)));
                        (s(k), if timed { json!("@T") } else { go(x, keys, s) })
                    })
                    .collect(),
            ),
            _ => v.clone(),
        }
    }
    go(v, &keys, &s)
}

// ------------------------------------------------------------------ 場面の宣言（フォルダの写し）

fn b64(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for (i, sh) in [18, 12, 6, 0].iter().enumerate() {
            o.push(if i <= c.len() { T[(n >> sh & 63) as usize] as char } else { '=' });
        }
    }
    o
}

fn unb64(s: &str) -> Vec<u8> {
    let val = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        _ => 63,
    };
    let mut o = vec![];
    for c in s.as_bytes().chunks(4) {
        let pad = c.iter().filter(|&&x| x == b'=').count();
        let n = c.iter().fold(0u32, |n, &x| n << 6 | if x == b'=' { 0 } else { val(x) as u32 });
        let bytes = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        o.extend_from_slice(&bytes[..3 - pad]);
    }
    o
}

fn now_secs() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64()
}

fn ns_of(t: SystemTime) -> i64 {
    match t.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_nanos() as i64,
        Err(e) => -(e.duration().as_nanos() as i64),
    }
}

fn time_of_ns(ns: i64) -> SystemTime {
    if ns >= 0 {
        UNIX_EPOCH + Duration::from_nanos(ns as u64)
    } else {
        UNIX_EPOCH - Duration::from_nanos(ns.unsigned_abs())
    }
}

/// 更新時刻: 今に近ければ今からのずれ（ms）、遠ければ ns
fn mtime_decl(t: SystemTime) -> Value {
    let ns = ns_of(t);
    let off = ns / 1_000_000 - (now_secs() * 1000.0) as i64;
    if off.abs() <= NEAR * 1000 {
        json!(format!("@NOW({off}ms)"))
    } else {
        json!(ns)
    }
}

fn mtime_of_decl(v: &Value) -> Option<SystemTime> {
    if let Some(ns) = v.as_i64() {
        return Some(time_of_ns(ns));
    }
    let s = v.as_str()?;
    let ms: i64 = s.strip_prefix("@NOW(")?.strip_suffix("ms)")?.parse().ok()?;
    Some(time_of_ns(((now_secs() * 1000.0) as i64 + ms) * 1_000_000))
}

fn dt_re() -> regex::Regex {
    regex::Regex::new(r"(\d{4})-(\d{2})-(\d{2})([T ])(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?").unwrap()
}

/// 中身の字の今に近い日時を「@NOW(ずれ ms,区切り,桁)」にする（作る時に今からのずれで書き戻す。ほかの PC の錠の時刻など）
fn text_decl(t: &str, ctx: &Ctx) -> String {
    let now = chrono::Local::now().naive_local();
    let t = ctx.sub(t);
    dt_re()
        .replace_all(&t, |c: &regex::Captures| {
            let p = |i: usize| c.get(i).map(|m| m.as_str().parse::<u32>().unwrap_or(0));
            let frac = c.get(8).map(|m| m.as_str());
            let d = chrono::NaiveDate::from_ymd_opt(p(1).unwrap() as i32, p(2).unwrap(), p(3).unwrap())
                .and_then(|d| d.and_hms_opt(p(5).unwrap(), p(6).unwrap(), p(7).unwrap_or(0)));
            let Some(mut d) = d else { return c[0].to_string() };
            if let Some(f) = frac {
                let ns: u32 = format!("{f:0<9}").parse().unwrap_or(0);
                d += chrono::Duration::nanoseconds(ns as i64);
            }
            let off = (d - now).num_milliseconds();
            if off.abs() > NEAR * 1000 {
                return c[0].to_string();
            }
            let prec = match (c.get(7), frac) {
                (None, _) => "m".to_string(),
                (Some(_), None) => "s".to_string(),
                (Some(_), Some(f)) => format!("f{}", f.len()),
            };
            format!("@NOW({off}ms,{},{prec})", &c[4])
        })
        .into_owned()
}

fn text_of_decl(t: &str, ctx: &Ctx) -> String {
    let re = regex::Regex::new(r"@NOW\((-?\d+)ms,([T ]),(m|s|f\d)\)").unwrap();
    let now = chrono::Local::now().naive_local();
    let t = re.replace_all(t, |c: &regex::Captures| {
        let d = now + chrono::Duration::milliseconds(c[1].parse().unwrap());
        let sep = &c[2];
        match &c[3] {
            "m" => d.format(&format!("%Y-%m-%d{sep}%H:%M")).to_string(),
            "s" => d.format(&format!("%Y-%m-%d{sep}%H:%M:%S")).to_string(),
            f => {
                let n: usize = f[1..].parse().unwrap();
                let frac = format!("{:09}", d.and_utc().timestamp_subsec_nanos());
                format!("{}.{}", d.format(&format!("%Y-%m-%d{sep}%H:%M:%S")), &frac[..n])
            }
        }
    });
    ctx.unsub(&t)
}

#[cfg(unix)]
fn mode_of(m: &std::fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    m.permissions().mode() & 0o7777
}
#[cfg(not(unix))]
fn mode_of(_: &std::fs::Metadata) -> u32 {
    0
}

/// 場面のフォルダを宣言に写す（files・dirs・links と中身 blobs〈同じ中身は 1 つ〉）。exclude の名前の段（Python だけの写し py・pd）は除く
pub fn snapshot(base: &Path, ctx: &Ctx, exclude: &[&str]) -> Value {
    use sha2::Digest;
    let (mut files, mut dirs, mut links, mut blobs) = (Map::new(), Map::new(), Map::new(), Map::new());
    fn walk(d: &Path, rel: &str, out: &mut Vec<(String, PathBuf)>, exclude: &[&str]) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        let mut es: Vec<_> = rd.flatten().collect();
        es.sort_by_key(|e| e.file_name());
        for e in es {
            let n = e.file_name().to_string_lossy().into_owned();
            if exclude.contains(&n.as_str()) {
                continue;
            }
            let r = if rel.is_empty() { n.clone() } else { format!("{rel}/{n}") };
            out.push((r.clone(), e.path()));
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                walk(&e.path(), &r, out, exclude);
            }
        }
    }
    let mut all = vec![];
    walk(base, "", &mut all, exclude);
    for (rel, p) in all {
        let Ok(m) = std::fs::symlink_metadata(&p) else { continue };
        if m.file_type().is_symlink() {
            links.insert(rel, json!(ctx.sub(&std::fs::read_link(&p).unwrap().to_string_lossy())));
            continue;
        }
        let mut e = Map::new();
        if let Ok(t) = m.modified() {
            e.insert("mtime".into(), mtime_decl(t));
        }
        let md = mode_of(&m);
        if m.is_dir() {
            if md != 0o755 && cfg!(unix) {
                e.insert("mode".into(), json!(md));
            }
            dirs.insert(rel, Value::Object(e));
            continue;
        }
        if md != 0o644 && cfg!(unix) {
            e.insert("mode".into(), json!(md));
        }
        let b = std::fs::read(&p).unwrap_or_default();
        let blob = match std::str::from_utf8(&b) {
            Ok(t) if !t.contains('\0') => json!({"text": text_decl(t, ctx)}),
            _ => json!({"b64": b64(&b)}),
        };
        let h = format!("{:x}", sha2::Sha256::digest(blob.to_string().as_bytes()));
        let h = h[..16].to_string();
        blobs.insert(h.clone(), blob);
        e.insert("blob".into(), json!(h));
        files.insert(rel, Value::Object(e));
    }
    json!({"files": files, "dirs": dirs, "links": links, "blobs": blobs})
}

/// ファイルID（Python の work_log.file_id と同じ「装置:inode」の形。窓の same_fid で比べる）
pub fn fid_of(p: &Path) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(m) = std::fs::metadata(p) {
            return format!("{}:{}", m.dev(), m.ino());
        }
    }
    let _ = p;
    String::new()
}

/// @FID(場面の道) を今のファイルID に
fn fid_unsub(s: &str, base: &Path) -> String {
    if !s.contains("@FID(") {
        return s.to_string();
    }
    let re = regex::Regex::new(r"@FID\(([^)]*)\)").unwrap();
    re.replace_all(s, |c: &regex::Captures| fid_of(&base.join(&c[1]))).into_owned()
}

/// 宣言から場面のフォルダを作る（snapshot の逆）
pub fn materialize(decl: &Value, base: &Path, ctx: &Ctx) {
    std::fs::create_dir_all(base).unwrap();
    let dirs = decl["dirs"].as_object().unwrap();
    for rel in dirs.keys() {
        std::fs::create_dir_all(base.join(rel)).unwrap();
    }
    // ファイルID を指す中身（@FID(道)）は、指すファイルを作った後に書く
    let mut fs: Vec<_> = decl["files"].as_object().unwrap().iter().collect();
    fs.sort_by_key(|(_, e)| decl["blobs"][e["blob"].as_str().unwrap()]["text"].as_str().is_some_and(|t| t.contains("@FID(")));
    for (rel, e) in fs {
        let p = base.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        let blob = &decl["blobs"][e["blob"].as_str().unwrap()];
        let bytes = match blob["text"].as_str() {
            Some(t) => fid_unsub(&text_of_decl(t, ctx), base).into_bytes(),
            None => unb64(blob["b64"].as_str().unwrap()),
        };
        std::fs::write(&p, bytes).unwrap();
        if let Some(t) = mtime_of_decl(&e["mtime"]) {
            let _ = std::fs::File::options().write(true).open(&p).and_then(|f| f.set_modified(t));
        }
    }
    for (rel, t) in decl["links"].as_object().unwrap() {
        #[cfg(unix)]
        {
            let _ = std::os::unix::fs::symlink(ctx.unsub(t.as_str().unwrap()), base.join(rel));
        }
        let _ = (rel, t);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for (rel, e) in decl["files"].as_object().unwrap() {
            if let Some(m) = e["mode"].as_u64() {
                let _ = std::fs::set_permissions(base.join(rel), std::fs::Permissions::from_mode(m as u32));
            }
        }
        // 段の深い順に: 更新時刻を当ててから権限（読めないフォルダの中は先に作り終える）
        let mut ds: Vec<_> = dirs.iter().collect();
        ds.sort_by_key(|(r, _)| std::cmp::Reverse(r.matches('/').count()));
        for (rel, e) in ds {
            if let Some(t) = mtime_of_decl(&e["mtime"]) {
                let _ = std::fs::File::open(base.join(rel)).and_then(|f| f.set_modified(t));
            }
            if let Some(m) = e["mode"].as_u64() {
                let _ = std::fs::set_permissions(base.join(rel), std::fs::Permissions::from_mode(m as u32));
            }
        }
    }
}

/// 宣言を比べられる形に（今からのずれは流すたびに変わるので形だけ残す）
fn decl_cmp(v: &Value) -> Value {
    let re = regex::Regex::new(r"@NOW\(-?\d+ms").unwrap();
    // 中身は指紋（blobs の鍵）でなく中身そのもので比べる（指紋は今からのずれを含む）
    let mut files = v["files"].clone();
    if let Some(o) = files.as_object_mut() {
        for e in o.values_mut() {
            let b = v["blobs"][e["blob"].as_str().unwrap_or("")].clone();
            e["blob"] = b;
        }
    }
    let w = json!({"files": files, "dirs": v["dirs"], "links": v["links"]});
    map_strings(&w, &|s| re.replace_all(s, "@NOW(~").into_owned())
}

// ------------------------------------------------------------------ 焼く係

pub struct Bake {
    pub book: String,
    pub mode: Mode,
    scope: Vec<String>,
    /// 焼いた表と比べるか（posix の表。Windows は比べない）
    check: bool,
    table: Option<Value>,
    base: PathBuf,
    pub ctx: Ctx,
    /// 本ごとに足すそろえる鍵
    pub keys: Vec<String>,
    /// 答え合わせ役の答えの中で、歩の答え（焼かない欄。表は窓の答えを answers に持つ）
    pub strip: Vec<String>,
    /// 場面の宣言から除く名前（Python だけの写し）
    pub exclude: Vec<&'static str>,
    /// 答え合わせ役の答えの中の「ファイルID → 名前」の表の鍵（作業実績）。場面と答え合わせ役の答えのファイルID を @FID(道) にする
    pub fid_key: Option<&'static str>,
    oracle: Value,
    scene: Value,
    answers: BTreeMap<String, Value>,
    routes: BTreeMap<String, String>,
    bad: Vec<String>,
}

fn env_on(k: &str) -> bool {
    std::env::var(k).is_ok_and(|v| !v.is_empty() && v != "0")
}

impl Bake {
    pub fn open(book: &str, base: &Path) -> Bake {
        let bless = std::env::var("TPA_BLESS").unwrap_or_default();
        let no_py = env_on("TPA_NO_PYTHON");
        let mode = match (bless.as_str(), no_py) {
            ("" | "0", false) => Mode::Python,
            ("" | "0", true) => Mode::Baked,
            (_, false) => Mode::Bless,
            (_, true) => Mode::BlessScope,
        };
        let scope = if mode == Mode::BlessScope { bless.split(',').map(|s| s.trim().to_string()).collect() } else { vec![] };
        let path = baked_dir().join(format!("{book}.json"));
        let table = std::fs::read(&path).ok().map(|b| super::json_keep(&b).unwrap_or_else(|| panic!("{} が読めません", path.display())));
        let check = cfg!(unix) && mode != Mode::Bless;
        if (mode == Mode::Baked || mode == Mode::BlessScope) && table.is_none() {
            panic!("焼いた表 {} がありません（TPA_BLESS=1 で焼く）", path.display());
        }
        Bake {
            book: book.into(),
            mode,
            scope,
            check,
            table,
            base: base.to_path_buf(),
            ctx: Ctx::new(base),
            keys: vec![],
            strip: vec!["status".into(), "json".into()],
            exclude: vec!["py", "pd"],
            fid_key: None,
            oracle: Value::Null,
            scene: Value::Null,
            answers: BTreeMap::new(),
            routes: BTreeMap::new(),
            bad: vec![],
        }
    }

    pub fn python(&self) -> bool {
        matches!(self.mode, Mode::Python | Mode::Bless)
    }

    /// 比べるときにそろえる（Python で流しているときはそのまま。焼いた表と比べるときは両方をそろえる）
    pub fn s(&self, v: &Value) -> Value {
        if self.python() {
            v.clone()
        } else {
            settle(v, &self.ctx, &self.keys)
        }
    }

    fn strip_answers(&self, v: &Value) -> Value {
        match v {
            Value::Object(o) => Value::Object(
                o.iter()
                    .filter(|(k, _)| !(o.contains_key("method") && self.strip.contains(k)))
                    .map(|(k, x)| (k.clone(), self.strip_answers(x)))
                    .collect(),
            ),
            Value::Array(a) => Value::Array(a.iter().map(|x| self.strip_answers(x)).collect()),
            _ => v.clone(),
        }
    }

    /// 答え合わせ役の答え（Python）か、焼いた表から作り直した物（場面のフォルダも作る）
    pub fn oracle(&mut self, script: &str, args: &[&str]) -> Value {
        if self.python() {
            let v = super::python_json(script, args);
            self.took(&v);
            v
        } else {
            self.from_table()
        }
    }

    /// 起こしたままにする答え合わせ役（common::Live）。焼いた表で流すときは None
    pub fn live(&mut self, script: &str, args: &[&str]) -> (Option<super::Live>, Value) {
        if self.python() {
            let (l, v) = super::Live::start(script, args);
            self.took(&v);
            (Some(l), v)
        } else {
            (None, self.from_table())
        }
    }

    /// Python の答えを受けた直後: 場面を写し、表の宣言・問い合わせと比べる（表が古いか）
    pub fn took(&mut self, v: &Value) {
        let ex: Vec<&str> = self.exclude.clone();
        self.scene = snapshot(&self.base, &self.ctx, &ex);
        let ctx = self.ctx.clone();
        self.oracle = map_strings(&self.strip_answers(v), &|s| ctx.sub(s));
        if let Some(k) = self.fid_key {
            // ファイルID（装置の番号と inode）は作り直すと変わるので、場面の中身と答え合わせ役の答えでは @FID(場面の道) にする
            let mut pairs = vec![];
            for (fid, name) in v[k].as_object().cloned().unwrap_or_default() {
                let name = name.as_str().unwrap_or("").to_string();
                let rel = self.scene["files"].as_object().unwrap().keys().chain(self.scene["dirs"].as_object().unwrap().keys())
                    .find(|r| r.rsplit('/').next() == Some(name.as_str()))
                    .cloned();
                if let Some(rel) = rel {
                    pairs.push((fid, format!("@FID({rel})")));
                }
            }
            let f = |s: &str| pairs.iter().fold(s.to_string(), |t, (a, b)| if t == *a || t.contains(&format!("\"{a}\"")) { t.replace(a.as_str(), b) } else { t });
            self.scene = map_strings(&self.scene, &f);
            self.oracle = map_strings(&self.oracle, &f);
        }
        if self.mode == Mode::Python && self.check {
            let Some(t) = &self.table else {
                self.bad.push(format!("焼いた表 tests/baked/{}.json がありません（TPA_BLESS=1 で焼く）", self.book));
                return;
            };
            let (a, b) = (settle(&t["oracle"], &self.ctx, &self.keys), settle(&self.oracle, &self.ctx, &self.keys));
            if let Some(d) = super::diff(&a, &b, "oracle") {
                self.bad.push(format!("表が古い（答え合わせ役の場面・歩が変わった。tools/bless.py で焼き直す）: {d}"));
            }
            if variant() == "root" {
                if let Some(d) = super::diff(&decl_cmp(&t["scene"]), &decl_cmp(&self.scene), "scene") {
                    self.bad.push(format!("表が古い（場面のフォルダが表の宣言と違う）: {}", cut(&d)));
                }
            }
        }
    }

    fn from_table(&mut self) -> Value {
        let t = self.table.clone().unwrap();
        materialize(&t["scene"], &self.base, &self.ctx);
        self.scene = t["scene"].clone();
        self.oracle = t["oracle"].clone();
        let ctx = self.ctx.clone();
        let base = self.base.clone();
        map_strings(&t["oracle"], &|s| fid_unsub(&ctx.unsub(s), &base))
    }

    /// 場面が置いた物か（作業フォルダの中の道）
    pub fn in_scene(&self, p: &Path) -> bool {
        let rel = p.strip_prefix(&self.base).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        self.scene["files"].get(&rel).is_some() || self.scene["dirs"].get(&rel).is_some()
    }

    fn table_answer(&self, key: &str) -> Option<Value> {
        let t = self.table.as_ref()?;
        if variant() == "user" {
            if let Some(v) = t["variants"]["user"].get(key) {
                return Some(v.clone());
            }
        }
        t["answers"].get(key).cloned()
    }

    /// 比べる相手の答え: Python で流しているときは py()、焼いた表で流すときは表の答え（そろえた形）
    pub fn want(&self, key: &str, py: impl FnOnce() -> Value) -> Value {
        if self.python() {
            py()
        } else {
            self.table_answer(key).unwrap_or_else(|| json!({"<表に無い歩>": key}))
        }
    }

    /// (状態, 本文) の形の want
    pub fn want_step(&self, key: &str, st: &Value) -> (i64, Value) {
        let w = self.want(key, || json!({"status": st["status"], "json": st["json"]}));
        (w["status"].as_i64().unwrap_or(-1), w["json"].clone())
    }

    /// 窓の答えを 1 つ記す（route は道の型。範囲の宣言と要約に使う）。want は want() の答え
    pub fn note(&mut self, key: &str, route: &str, got: &Value, want: &Value) {
        let mut key = key.to_string();
        while self.answers.contains_key(&key) {
            key.push('~');
        }
        let g = settle(got, &self.ctx, &self.keys);
        if self.mode == Mode::Bless {
            let w = settle(want, &self.ctx, &self.keys);
            if let Some(d) = super::diff(&w, &g, &key) {
                self.bad.push(format!("そろえた後の窓の答えが Python と違う（焼かない）: {}", cut(&d)));
            }
        }
        if self.check && self.table.is_some() && self.mode != Mode::BlessScope {
            match self.table_answer(&key) {
                None => self.bad.push(format!("表に無い歩（表が古い。tools/bless.py で焼き直す）: {key}")),
                Some(t) => {
                    if let Some(d) = super::diff(&t, &g, &key) {
                        self.bad.push(format!("焼いた表と違う: {}", cut(&d)));
                    }
                }
            }
        }
        self.routes.insert(key.clone(), route.to_string());
        self.answers.insert(key, g);
    }

    /// 終わった後のファイルの表（Python は読むたびに写しを取り直すので、Python と同じかは試験そのものの決まりで見る。ここでは焼く・表と比べるだけ）
    pub fn note_files(&mut self, key: &str, got: &Value, want: &Value) {
        let mode = self.mode;
        if mode == Mode::Bless {
            self.mode = Mode::Python;
        }
        let check = self.check;
        self.check = check && mode != Mode::Bless;
        self.note(key, "files", got, want);
        self.mode = mode;
        self.check = check;
    }

    /// (状態, 本文) の形の note
    pub fn note_step(&mut self, key: &str, st: &Value, status: impl Into<i64>, got: &Value, want: &(i64, Value)) {
        let route = route_of(st);
        self.note(key, &route, &json!({"status": status.into(), "json": got}), &json!({"status": want.0, "json": want.1}));
    }

    /// 終わり: 焼く・表と比べた食い違いを知らせる。test_bad は試験そのものの食い違い（Python と比べた分）
    pub fn finish(mut self, test_bad: &[String]) {
        if let Some(t) = &self.table {
            if self.check && self.mode != Mode::BlessScope {
                let mut missing: Vec<&String> =
                    t["answers"].as_object().map(|o| o.keys().filter(|k| !self.answers.contains_key(*k)).collect()).unwrap_or_default();
                missing.truncate(5);
                for k in missing {
                    self.bad.push(format!("表にあるのに窓が答えなかった歩（表が古い）: {k}"));
                }
            }
        }
        match self.mode {
            Mode::Bless => {
                if !test_bad.is_empty() || !self.bad.is_empty() {
                    panic!(
                        "{}: Python との食い違いがあるので焼きません（試験 {} 件・そろえた後 {} 件）:\n{}",
                        self.book,
                        test_bad.len(),
                        self.bad.len(),
                        self.bad.iter().chain(test_bad).take(20).cloned().collect::<Vec<_>>().join("\n")
                    );
                }
                self.write();
            }
            Mode::BlessScope => {
                let old = self.table.as_ref().unwrap()["answers"].as_object().cloned().unwrap_or_default();
                let mut out = vec![];
                for (k, g) in &self.answers {
                    if old.get(k) != Some(g) {
                        let r = &self.routes[k];
                        if !self.scope.iter().any(|s| s == "all" || r == s || r.starts_with(&format!("{s} ")) || k.starts_with(s.as_str())) {
                            out.push(format!("範囲の外の答えが変わった: {k}（{r}）"));
                        }
                    }
                }
                if !out.is_empty() {
                    panic!("{}: 範囲（{}）の外が変わったので焼きません:\n{}", self.book, self.scope.join(","), out.join("\n"));
                }
                self.write();
            }
            _ => {
                if !self.bad.is_empty() {
                    self.dump_diff();
                    panic!(
                        "{}: 焼いた表との食い違い {} 件（窓の今の答えは target/tmp/bless-diff/{}.json）:\n{}",
                        self.book,
                        self.bad.len(),
                        self.book,
                        self.bad.iter().take(20).cloned().collect::<Vec<_>>().join("\n")
                    );
                }
            }
        }
    }

    fn dump_diff(&self) {
        let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("bless-diff");
        let _ = std::fs::create_dir_all(&d);
        let v = json!({"book": self.book, "bad": self.bad, "answers": self.answers});
        let _ = std::fs::write(d.join(format!("{}.json", self.book)), serde_json::to_string_pretty(&v).unwrap());
    }

    fn write(&self) {
        let out_dir = std::env::var("TPA_BAKE_OUT").map(PathBuf::from).unwrap_or_else(|_| baked_dir());
        std::fs::create_dir_all(&out_dir).unwrap();
        let path = out_dir.join(format!("{}.json", self.book));
        let old = self.table.clone().unwrap_or(Value::Null);
        let answers: Map<String, Value> = self.answers.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        let routes: Map<String, Value> = self.routes.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
        let mut t = if variant() == "user" && old.is_object() {
            // root でない利用者: 本の答え（root で焼いた）は変えず、違う歩だけを variants.user に持つ
            let mut t = old.clone();
            let base = old["answers"].as_object().cloned().unwrap_or_default();
            let user: Map<String, Value> = answers.iter().filter(|(k, v)| base.get(*k) != Some(*v)).map(|(k, v)| (k.clone(), v.clone())).collect();
            t["variants"]["user"] = Value::Object(user);
            t
        } else {
            let mut t = json!({
                "about": format!("窓が焼いた答え（版 3.115.0 の bless。desktop/tests/common/bake.rs）。本 {}。作り直すのは python program/tools/bless.py {}", self.book, self.book),
                "book": self.book,
                "os": "posix",
                "variant": variant(),
                "oracle": self.oracle,
                "scene": self.scene,
                "answers": answers,
                "routes": routes,
            });
            if let Some(u) = old.get("variants") {
                t["variants"] = u.clone();
            }
            t
        };
        t["sources"] = sources_of(&self.book);
        let text = lines(&t, 0) + "\n";
        std::fs::write(&path, text).unwrap();
        // 変わった葉の要約（道の型ごとの数・鍵・前 → 後の見本 3）。PR の説明に貼る
        eprintln!("{}", summary(&self.book, &old, &t).lines().map(|l| format!("bless| {l}")).collect::<Vec<_>>().join("\n"));
        eprintln!("bless| {} に書きました", path.display());
    }
}

/// 表の字: 段 2 までは 1 項目 1 行（歩ごと・ファイルごとの差分が読める）、その下は詰めて書く（oracle は場面ごとに 1 行）
pub fn lines(v: &Value, depth: usize) -> String {
    let pad = |d: usize| " ".repeat(d);
    let deep = |k: &str| match k {
        "oracle" => 4,
        "scene" => 3,
        _ => 2,
    };
    fn inner(v: &Value, depth: usize, max: usize, pad: &dyn Fn(usize) -> String) -> String {
        match v {
            Value::Object(o) if depth < max && !o.is_empty() => {
                let items: Vec<String> = o
                    .iter()
                    .map(|(k, x)| format!("{}{}: {}", pad(depth + 1), serde_json::to_string(k).unwrap(), inner(x, depth + 1, max, pad)))
                    .collect();
                format!("{{\n{}\n{}}}", items.join(",\n"), pad(depth))
            }
            Value::Array(a) if depth < max && !a.is_empty() => {
                let items: Vec<String> = a.iter().map(|x| format!("{}{}", pad(depth + 1), inner(x, depth + 1, max, pad))).collect();
                format!("[\n{}\n{}]", items.join(",\n"), pad(depth))
            }
            _ => serde_json::to_string(v).unwrap(),
        }
    }
    match v {
        Value::Object(o) => {
            let items: Vec<String> =
                o.iter().map(|(k, x)| format!("{}{}: {}", pad(depth + 1), serde_json::to_string(k).unwrap(), inner(x, depth + 1, deep(k), &pad))).collect();
            format!("{{\n{}\n}}", items.join(",\n"))
        }
        _ => serde_json::to_string(v).unwrap(),
    }
}

/// 表を焼いた時の元（答え合わせ役と、その場面に効く道具）の指紋。tools/bless.py --check が今の元と比べる（古さを止める）
pub fn sources_of(book: &str) -> Value {
    use sha2::Digest;
    let books: Value = serde_json::from_str(include_str!("../baked/books.json")).unwrap();
    let prog = super::program();
    let mut out = Map::new();
    for s in books["books"][book]["sources"].as_array().cloned().unwrap_or_default() {
        let rel = s.as_str().unwrap();
        let b = std::fs::read(prog.join(rel)).unwrap_or_default();
        // 改行の違い（Windows の取り出し）で変わらないように \r を除いて数える
        let b: Vec<u8> = b.into_iter().filter(|&c| c != b'\r').collect();
        out.insert(rel.into(), json!(format!("{:x}", sha2::Sha256::digest(&b))[..16].to_string()));
    }
    Value::Object(out)
}

/// 道の型（"POST /api/x"。数の id は {n}）
pub fn route_of(st: &Value) -> String {
    let m = st["method"].as_str().unwrap_or("");
    let p = st["path"].as_str().unwrap_or("");
    let re = regex::Regex::new(r"/[0-9０-９]+$").unwrap();
    format!("{m} {}", re.replace(p, "/{n}"))
}

fn cut(s: &str) -> String {
    if s.chars().count() > 400 {
        s.chars().take(400).collect::<String>() + "…"
    } else {
        s.to_string()
    }
}

/// 葉の道と値
fn leaves(v: &Value, p: &str, out: &mut BTreeMap<String, Value>) {
    match v {
        Value::Object(o) => o.iter().for_each(|(k, x)| leaves(x, &format!("{p}.{k}"), out)),
        Value::Array(a) => a.iter().enumerate().for_each(|(i, x)| leaves(x, &format!("{p}[{i}]"), out)),
        _ => {
            out.insert(p.to_string(), v.clone());
        }
    }
}

/// 変わった葉の要約: 道の型ごとに、変わった葉の数・鍵・前 → 後の見本 3
pub fn summary(book: &str, old: &Value, new: &Value) -> String {
    let (oa, na) = (old["answers"].as_object().cloned().unwrap_or_default(), new["answers"].as_object().cloned().unwrap_or_default());
    let mut by: BTreeMap<String, (usize, std::collections::BTreeSet<String>, Vec<String>)> = BTreeMap::new();
    for k in oa.keys().chain(na.keys()).collect::<std::collections::BTreeSet<_>>() {
        let route = new["routes"][k.as_str()].as_str().or(old["routes"][k.as_str()].as_str()).unwrap_or("?").to_string();
        let (mut a, mut b) = (BTreeMap::new(), BTreeMap::new());
        if let Some(x) = oa.get(k) {
            leaves(x, "", &mut a);
        }
        if let Some(x) = na.get(k) {
            leaves(x, "", &mut b);
        }
        for p in a.keys().chain(b.keys()).collect::<std::collections::BTreeSet<_>>() {
            if a.get(p) != b.get(p) {
                let e = by.entry(route.clone()).or_default();
                e.0 += 1;
                e.1.insert(p.rsplit(['.', '[']).next().unwrap_or("").trim_end_matches(']').to_string());
                if e.2.len() < 3 {
                    e.2.push(format!("{k}{p}: {} → {}", a.get(p).map(|v| cut(&v.to_string())).unwrap_or("（無し）".into()), b.get(p).map(|v| cut(&v.to_string())).unwrap_or("（無し）".into())));
                }
            }
        }
    }
    if old.is_null() {
        return format!("== {book}: 新しく焼いた（歩 {}）", na.len());
    }
    let mut s = format!("== {book}: 変わった葉（道の型ごと） {} 型", by.len());
    for (r, (n, keys, samples)) in by {
        s += &format!("\n  {r}: {n} 葉・鍵 {}", keys.into_iter().collect::<Vec<_>>().join(" "));
        for x in samples {
            s += &format!("\n    {x}");
        }
    }
    s
}

