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

/// 場面の中の「今に近い」時刻（この幅の内は今からのずれで持つ・答えの今に近い時刻を @T(形|秒) にする）。焼くとき（tools/bless.py）に、
/// 答え合わせ役の元に今からこの幅の内の固定の日付があれば焼かずに止める（時限の爆弾にしない）
pub const NEAR: i64 = 2 * 24 * 3600;
/// 今に近い時刻の秒の差を許す幅（焼いた時と比べる時の、場面を作ってから答えるまでの時間の違い）
pub const TOL: i64 = 1800;

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

/// アプリの版（心拍と同じ元の program/app/version.py）
pub fn app_version() -> &'static str {
    static V: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    V.get_or_init(|| da_core::update::program_version(&super::program()).unwrap_or_else(|| "?".into()))
}

/// OS の利用者の名前（Python の getpass.getuser と同じ順: LOGNAME・USER・LNAME・USERNAME）
pub fn os_user() -> Option<&'static str> {
    static U: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    U.get_or_init(|| {
        ["LOGNAME", "USER", "LNAME", "USERNAME"].iter().find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty())).or_else(passwd_name)
    })
    .as_deref()
}

/// 環境変数が無いときの名前（getpass.getuser の pwd.getpwuid(os.getuid())）
fn passwd_name() -> Option<String> {
    #[cfg(unix)]
    {
        let s = std::fs::read_to_string("/proc/self/status").ok()?;
        let uid = s.lines().find_map(|l| l.strip_prefix("Uid:"))?.split_whitespace().next()?.to_string();
        let pw = std::fs::read_to_string("/etc/passwd").ok()?;
        return pw.lines().find_map(|l| {
            let f: Vec<&str> = l.split(':').collect();
            (f.len() > 2 && f[2] == uid).then(|| f[0].to_string())
        });
    }
    #[allow(unreachable_code)]
    None
}

/// 置き換える道の字（作業フォルダ @WORK・家 @HOME・作り物のサーバーの URL @URL）。一時フォルダは置き換えない（版 3.115.0 の作った後の直し:
/// 前は @TMP にして、答え合わせ役の固定の字「/tmp/x/../y」と流した PC の一時フォルダを混ぜた）
#[derive(Clone)]
pub struct Ctx {
    pub subs: Vec<(String, String)>,
}

/// 道の字の段の境か（前の字・後ろの字が道の続きでない）
fn path_edge(c: Option<char>) -> bool {
    c.is_none_or(|c| !(c.is_alphanumeric() || matches!(c, '/' | '\\' | '.' | '-' | '_' | '~' | '$' | '%')))
}

/// リポジトリの根（desktop の上。PC ごとに違う: 手元の作業フォルダ・CI の /home/runner/work/…）
pub fn repo_root() -> PathBuf {
    let m = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let up = m.parent().unwrap_or(&m).to_path_buf();
    PathBuf::from(spellings(&up).pop().unwrap_or_default())
}

/// 道の書き方の候補: 書いたままの字と、長い名前に直した字（canonicalize。Windows の \\?\ の頭は外す）。最後が長い名前
pub fn spellings(p: &Path) -> Vec<String> {
    let mut out = vec![p.to_string_lossy().trim_end_matches(['/', '\\']).to_string()];
    if let Ok(c) = std::fs::canonicalize(p) {
        let c = c.to_string_lossy().into_owned();
        let c = c.strip_prefix(r"\\?\UNC\").map(|r| format!(r"\\{r}")).unwrap_or_else(|| c.strip_prefix(r"\\?\").unwrap_or(&c).to_string());
        if !out.contains(&c) {
            out.push(c);
        }
    }
    out.retain(|s| !s.is_empty());
    out
}

impl Ctx {
    pub fn new(base: &Path) -> Ctx {
        Ctx::with_home(base, std::env::var("HOME").ok().as_deref())
    }

    /// 家を決めて作る（試験: リポジトリが家の下にある PC〈CI〉と同じ形を作る）
    pub fn with_home(base: &Path, home: Option<&str>) -> Ctx {
        // 作業フォルダは書いたままの字と、長い名前に直した字（Windows の一時フォルダは 8.3 の短い名前 RUNNER~1 で来る。Python は長い名前で書く）の
        // 両方を @WORK に。subs[0] は戻すときの字（作業フォルダ）、subs[1] はリポジトリの根
        let repo = repo_root();
        let mut subs =
            vec![(base.to_string_lossy().into_owned(), "@WORK".to_string()), (repo.to_string_lossy().into_owned(), "@REPO".into())];
        for v in spellings(base).into_iter().skip(1) {
            subs.push((v, "@WORK".into()));
        }
        // リポジトリの根は @REPO（版 3.115.0 の 2 回目の直し: 前は置き換えず、手元〈家の外〉で焼いた表の program の道が、リポジトリが家の下にある
        // CI で @HOME/… になって食い違った）。家より先に置き換わるよう、長い字の順で当てる（家の下にあっても @REPO）。
        // 試験は program を desktop/.. でも書く（common::program）。その字も同じ @REPO
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        for v in spellings(&repo)
            .into_iter()
            .skip(1)
            .chain(spellings(&manifest.join("..")))
            .chain(spellings(manifest.parent().unwrap_or(&manifest)))
        {
            subs.push((v, "@REPO".into()));
        }
        if let Some(h) = home {
            let h = h.trim_end_matches(['/', '\\']).to_string();
            if h.len() > 3 && Path::new(&h).is_dir() && !base.starts_with(&h) {
                subs.extend(spellings(Path::new(&h)).into_iter().map(|v| (v, "@HOME".into())));
            }
        }
        subs.dedup();
        Ctx { subs }
    }
    /// 作り物のサーバーの URL（組む所の CM3）を @URL にそろえる
    pub fn url(&mut self, url: &str) {
        if !url.is_empty() {
            self.subs.retain(|(_, b)| b != "@URL");
            self.subs.push((url.to_string(), "@URL".into()));
        }
    }
    /// 長い字から、段の境の前後（前の字・後ろの字が道の続きでない）で置き換える（/tmp が /tmp.abc や /x/tmp に当たらない）
    pub fn sub(&self, s: &str) -> String {
        self.sub_with(s, false)
    }

    /// 答えをそろえるとき: 置き換えた後の道の区切りを「/」にそろえる（焼いた表は OS によらず同じ字。Windows の「\」も）。場面の宣言と問い合わせの
    /// 字はそのまま（中身の JSON の \\ を崩さない）
    pub fn sub_slash(&self, s: &str) -> String {
        self.sub_with(s, true)
    }

    fn sub_with(&self, s: &str, slash: bool) -> String {
        let mut subs: Vec<&(String, String)> = self.subs.iter().collect();
        subs.sort_by_key(|(a, _)| std::cmp::Reverse(a.len()));
        let mut t = s.to_string();
        for (a, b) in subs {
            if !t.contains(a.as_str()) {
                continue;
            }
            let mut out = String::with_capacity(t.len());
            let mut rest = t.as_str();
            while let Some(i) = rest.find(a.as_str()) {
                let before = if i > 0 { rest[..i].chars().last() } else { out.chars().last() };
                let after = rest[i + a.len()..].chars().next();
                let after_ok =
                    after.is_none_or(|c| matches!(c, '/' | '\\' | '"' | '\'' | ' ' | '\n' | '）' | ')' | ',' | ':' | '」' | '?' | '#'));
                out.push_str(&rest[..i]);
                rest = &rest[i + a.len()..];
                if path_edge(before) && after_ok && slash {
                    out.push_str(b);
                    let end = rest.find(['"', '\'', ' ', '\n', '）', ')', ',', '」', '?', '#', ';']).unwrap_or(rest.len());
                    out.push_str(&rest[..end].replace('\\', "/"));
                    rest = &rest[end..];
                } else if path_edge(before) && after_ok {
                    out.push_str(b);
                } else {
                    out.push_str(a);
                }
            }
            out.push_str(rest);
            t = out;
        }
        t
    }
    /// 置き換えを戻す（作業フォルダとリポジトリの根。家と URL は戻さない: 家は答えの字にだけ出る・URL は作り直す時に新しい物を当てる）
    fn unsub(&self, s: &str) -> String {
        s.replace("@WORK", &self.subs[0].0).replace("@REPO", &self.subs[1].0)
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

/// 鍵の名前の表（settle.json の nameKeys: 利用者の名前を書く欄。版 3.115.0 の作った後の直し: 前は値の字の一致で当て、場面の人の名前とも重なった）
fn name_keys() -> Vec<&'static str> {
    rules()["nameKeys"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default()
}

/// 日時の字の形（今に近いかを見る）: 年-月-日 時:分〔:秒〔.小数〕〕 と、文の中の 年/月/日 時:分〔:秒〕
fn dt_any() -> &'static regex::Regex {
    static R: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| regex::Regex::new(r"(\d{4})([-/])(\d{1,2})[-/](\d{1,2})([T ])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?").unwrap())
}

/// 字の中の今に近い日時（±NEAR）を「@T(形|今からの秒)」にする。遠い日時・日時でない字はそのまま（版 3.115.0 の作った後の直し:
/// 前は鍵の名前と字の形でどの日時も @T にし、窓の時刻の読み書きの誤りを表との比べが見なかった）。形は区切り・桁（Ts・Tf6・/m など）
fn near_times(t: &str) -> String {
    if !t.contains(':') {
        return t.to_string();
    }
    let now = chrono::Local::now().naive_local();
    dt_any()
        .replace_all(t, |c: &regex::Captures| {
            let p = |i: usize| c.get(i).map(|m| m.as_str().parse::<u32>().unwrap_or(0));
            let d = chrono::NaiveDate::from_ymd_opt(p(1).unwrap() as i32, p(3).unwrap(), p(4).unwrap())
                .and_then(|d| d.and_hms_opt(p(6).unwrap(), p(7).unwrap(), p(8).unwrap_or(0)));
            let Some(d) = d else { return c[0].to_string() };
            let off = (d - now).num_seconds();
            if off.abs() > NEAR {
                return c[0].to_string();
            }
            let prec = match (c.get(8), c.get(9)) {
                (None, _) => "m".to_string(),
                (Some(_), None) => "s".to_string(),
                (Some(_), Some(f)) => format!("f{}", f.as_str().len()),
            };
            format!("@T({}{}{prec}|{off})", &c[2], &c[5])
        })
        .into_owned()
}

/// 時刻の数（秒・ミリ秒の 1970 年からの数）が今に近ければ「@T(epoch|今からの秒)」
fn near_epoch(x: f64) -> Option<String> {
    let now = now_secs();
    if (x - now).abs() <= NEAR as f64 {
        return Some(format!("@T(epoch|{})", (x - now).round() as i64));
    }
    if (x / 1000.0 - now).abs() <= NEAR as f64 {
        return Some(format!("@T(epoch-ms|{})", (x / 1000.0 - now).round() as i64));
    }
    None
}

/// そろえる（tests/baked/settle.json の字の形と、今に近い時刻・道の字・大きな整数の印・利用者の名前の欄・アプリの版）。extra_keys は本ごとに足す
/// 時刻の鍵。TPA_SETTLE_DROP=決まり（形の置き換えの字・鍵の名前・near）で 1 つ外して流せる（変異: 外すと焼きの 2 回目・表との比べが落ちる）
pub fn settle(v: &Value, ctx: &Ctx, extra_keys: &[String]) -> Value {
    static DROP: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    let drop = DROP.get_or_init(|| std::env::var("TPA_SETTLE_DROP").ok().filter(|s| !s.is_empty()));
    settle_with(v, ctx, extra_keys, drop.as_deref())
}

/// settle の決まりを 1 つ外した形（drop: 形の置き換えの字か、鍵の名前か、"near"〈今に近い時刻〉）
pub fn settle_with(v: &Value, ctx: &Ctx, extra_keys: &[String], drop: Option<&str>) -> Value {
    let r = rules();
    let keys: Vec<&str> = r["timeKeys"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .chain(extra_keys.iter().map(String::as_str))
        .filter(|k| Some(*k) != drop)
        .collect();
    let names: Vec<&str> = name_keys().into_iter().filter(|k| Some(*k) != drop).collect();
    let (all, day_re) = compiled();
    let forms: Vec<&(regex::Regex, String)> = all.iter().filter(|(_, to)| Some(to.as_str()) != drop).collect();
    let near = drop != Some("near");
    let today = chrono::Local::now().date_naive();
    let s = |t: &str| -> String {
        // 大きな整数の印（起動ごとの乱数つき）は @HELD: に。書いた人の言葉の「PC／名前 が」の名前は @USER に
        let mut t = ctx.sub_slash(t).replace(da_core::held::mark(), "@HELD:");
        if let Some(u) = os_user() {
            if t.contains(&format!("／{u} ")) {
                t = t.replace(&format!("／{u} "), "／@USER ");
            }
        }
        for (re, to) in &forms {
            if re.is_match(&t) {
                t = re.replace_all(&t, to.as_str()).into_owned();
            }
        }
        if near {
            t = near_times(&t);
        }
        // 今日から 3 日の内の日付だけの字は今日からのずれで持つ（作業日・前日の答え）
        day_re
            .replace_all(&t, |c: &regex::Captures| {
                let d = chrono::NaiveDate::from_ymd_opt(c[1].parse().unwrap_or(0), c[3].parse().unwrap_or(0), c[5].parse().unwrap_or(0));
                match d {
                    Some(d) if near && (d - today).num_days().abs() <= 3 => format!("@DAY{:+}{}", (d - today).num_days(), &c[2]),
                    _ => c[0].to_string(),
                }
            })
            .into_owned()
    };
    struct Cx<'a> {
        keys: &'a [&'a str],
        names: &'a [&'a str],
        near: bool,
        s: &'a dyn Fn(&str) -> String,
    }
    fn go(v: &Value, key: &str, cx: &Cx) -> Value {
        match v {
            // 値の字だけ（鍵は替えない）: アプリの版は @VERSION（版を上げるたびに表が古くならないように）
            Value::String(t) if t == app_version() => json!("@VERSION"),
            // 利用者の名前を書く欄（nameKeys）の OS の利用者の名前は @USER（root で焼き、CI の runner でも同じ表）
            Value::String(t) if cx.names.contains(&key) && (os_user() == Some(t.as_str()) || t == "@USER@") => json!("@USER"),
            Value::String(t) => Value::String((cx.s)(t)),
            // 時刻の鍵の今に近い数（1970 年からの秒・ミリ秒）だけ。遠い数はそのまま
            Value::Number(n) if cx.near && cx.keys.contains(&key) => {
                n.as_f64().and_then(near_epoch).map(Value::String).unwrap_or_else(|| v.clone())
            }
            Value::Array(a) => {
                let out: Vec<Value> = a.iter().map(|x| go(x, key, cx)).collect();
                above_crumbs(out)
            }
            Value::Object(o) => Value::Object(o.iter().map(|(k, x)| ((cx.s)(k), go(x, k, cx))).collect()),
            _ => v.clone(),
        }
    }
    go(v, "", &Cx { keys: &keys, names: &names, near, s: &s })
}

/// 区切り（crumbs: {name, path} の並び）のうち作業フォルダより上の段は 1 つの @ABOVE にまとめる（作業フォルダの深さ〈一時フォルダの場所〉に頼らない）
fn above_crumbs(v: Vec<Value>) -> Value {
    let crumb =
        |x: &Value| x.as_object().is_some_and(|o| o.len() == 2 && o.contains_key("name") && o.get("path").is_some_and(Value::is_string));
    if v.is_empty() || !v.iter().all(crumb) || !v.iter().any(|x| x["path"].as_str().unwrap().starts_with("@WORK")) {
        return Value::Array(v);
    }
    let mut out = vec![json!({"name": "@ABOVE", "path": "@ABOVE"})];
    out.extend(v.into_iter().filter(|x| x["path"].as_str().unwrap().starts_with("@WORK")));
    Value::Array(out)
}

/// 今からの秒を抜いた形（試験そのものの比べと、2 回の焼きの比べ）
fn offset_re() -> &'static regex::Regex {
    static R: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| regex::Regex::new(r"@T\(([^|)]*)\|(-?\d+)\)").unwrap())
}

pub fn without_offsets(v: &Value) -> Value {
    let re = offset_re();
    map_strings(v, &|s| if s.contains("@T(") { re.replace_all(s, "@T($1)").into_owned() } else { s.to_string() })
}

/// 時刻の印（@T(形|秒)）の秒の差を許して比べる（TOL 秒の内なら同じ）。最初の違いの道
pub fn diff_tol(a: &Value, b: &Value, path: &str) -> Option<String> {
    let re = offset_re();
    match (a, b) {
        (Value::String(x), Value::String(y)) if x.contains("@T(") || y.contains("@T(") => {
            let (sx, sy) = (re.replace_all(x, "@T($1)"), re.replace_all(y, "@T($1)"));
            let ox: Vec<i64> = re.captures_iter(x).map(|c| c[2].parse().unwrap()).collect();
            let oy: Vec<i64> = re.captures_iter(y).map(|c| c[2].parse().unwrap()).collect();
            let close = ox.len() == oy.len() && ox.iter().zip(&oy).all(|(p, q)| (p - q).abs() <= TOL);
            (sx != sy || !close).then(|| format!("{path}: {x} / {y}"))
        }
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys()) {
                match (x.get(k), y.get(k)) {
                    (Some(p), Some(q)) => {
                        if let Some(d) = diff_tol(p, q, &format!("{path}.{k}")) {
                            return Some(d);
                        }
                    }
                    (p, q) => return Some(format!("{path}.{k}: {p:?} / {q:?}")),
                }
            }
            None
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{path}: 長さ {} / {}", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().find_map(|(i, (p, q))| diff_tol(p, q, &format!("{path}[{i}]")))
        }
        _ => super::diff(a, b, path),
    }
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
/// 中身の字の、利用者の名前を書く欄（settle.json の nameKeys）の OS の利用者の名前を "@USER@" に（場面の権限の行・錠の持ち主・書いた人は
/// 流した利用者の名前。版 3.115.0 の作った後の直し: 前は値の字の一致で当て、場面の人の名前とも重なった）
fn user_decl(t: &str) -> String {
    let Some(u) = os_user() else { return t.to_string() };
    if !t.contains(&format!("\"{u}\"")) {
        return t.to_string();
    }
    let keys: Vec<String> = name_keys().iter().map(|k| regex::escape(k)).collect();
    let re = regex::Regex::new(&format!(r#"("(?:{})"\s*:\s*)"{}""#, keys.join("|"), regex::escape(u))).unwrap();
    re.replace_all(t, "${1}\"@USER@\"").into_owned()
}

/// 答え合わせ役の答えの、利用者の名前を書く欄の OS の利用者の名前を @USER@ に
fn named_users(v: &Value, key: &str) -> Value {
    match v {
        Value::String(s) if name_keys().contains(&key) && os_user() == Some(s.as_str()) => json!("@USER@"),
        Value::Array(a) => Value::Array(a.iter().map(|x| named_users(x, key)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), named_users(x, k))).collect()),
        _ => v.clone(),
    }
}

fn text_decl(t: &str, ctx: &Ctx) -> String {
    let now = chrono::Local::now().naive_local();
    let t = user_decl(&ctx.sub(t));
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
    let t = match os_user() {
        Some(u) if t.contains("\"@USER@\"") => t.replace("\"@USER@\"", &format!("\"{u}\"")),
        _ => t.into_owned(),
    };
    ctx.unsub(&t)
}

/// 値の字だけを替える（鍵は替えない）
fn map_values(v: &Value, f: &dyn Fn(&str) -> String) -> Value {
    match v {
        Value::String(s) => Value::String(f(s)),
        Value::Array(a) => Value::Array(a.iter().map(|x| map_values(x, f)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), map_values(x, f))).collect()),
        _ => v.clone(),
    }
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
        if !m.is_dir() && !m.is_file() {
            // 名前付きパイプなど（読むと止まる）は種類だけ持つ
            #[cfg(unix)]
            {
                use std::os::unix::fs::FileTypeExt;
                if m.file_type().is_fifo() {
                    e.insert("fifo".into(), json!(true));
                    if md != 0o644 {
                        e.insert("mode".into(), json!(md));
                    }
                    files.insert(rel, Value::Object(e));
                }
            }
            continue;
        }
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

/// 何を尋ねられても 404 を答える作り物のサーバー（組む所の CM3。答え合わせ役 builder_oracle.py の _Cm3 と同じ）→ URL
pub fn serve_404() -> String {
    use std::io::{Read, Write};
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}", l.local_addr().unwrap().port());
    std::thread::spawn(move || {
        for c in l.incoming().flatten() {
            std::thread::spawn(move || {
                let mut c = c;
                let _ = c.set_read_timeout(Some(Duration::from_secs(5)));
                let (mut buf, mut got) = ([0u8; 4096], vec![]);
                while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                    match c.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => got.extend_from_slice(&buf[..n]),
                    }
                }
                let _ = c.write_all(b"HTTP/1.0 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            });
        }
    });
    url
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
    fs.sort_by_key(|(_, e)| decl["blobs"][e["blob"].as_str().unwrap_or("")]["text"].as_str().is_some_and(|t| t.contains("@FID(")));
    for (rel, e) in fs {
        let p = base.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        if e["fifo"] == true {
            let _ = std::process::Command::new("mkfifo").arg(&p).status();
            continue;
        }
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
    // 読めない段（権限に読む印の無いフォルダ）の中と、読めないファイルの中身は比べない（root でない利用者は写せない。版 3.115.0 の作った後の直し:
    // 前は root のときだけ宣言を比べ、CI〈root でない runner〉では場面の古さを見なかった）
    let locked: Vec<String> = v["dirs"]
        .as_object()
        .map(|o| o.iter().filter(|(_, e)| e["mode"].as_u64().is_some_and(|m| m & 0o444 == 0)).map(|(r, _)| format!("{r}/")).collect())
        .unwrap_or_default();
    if let Some(o) = files.as_object_mut() {
        o.retain(|r, _| !locked.iter().any(|l| r.starts_with(l.as_str())));
        for e in o.values_mut() {
            if e["mode"].as_u64().is_some_and(|m| m & 0o444 == 0) {
                e["blob"] = json!("<読めない>");
            }
        }
    }
    let mut dirs = v["dirs"].clone();
    if let Some(o) = dirs.as_object_mut() {
        o.retain(|r, _| !locked.iter().any(|l| r.starts_with(l.as_str())));
        // フォルダの更新時刻は中を作るたびに変わり、読めない段の上は root でない利用者で写せない形もあるので比べない
        for e in o.values_mut() {
            if let Some(m) = e.as_object_mut() {
                m.remove("mtime");
            }
        }
    }
    let w = json!({"files": files, "dirs": dirs, "links": v["links"]});
    // Python が場面を作るときに引く乱数（instance_id の uuid4 の 32 字）は比べない
    let hex = regex::Regex::new(r"\b[0-9a-f]{32}\b").unwrap();
    map_strings(&w, &|s| hex.replace_all(&re.replace_all(s, "@NOW(~"), "@HEX32").into_owned())
}

// ------------------------------------------------------------------ 焼く係

pub struct Bake {
    /// 表を書くフォルダ（None は TPA_BAKE_OUT か tests/baked）
    pub out: Option<PathBuf>,
    pub book: String,
    /// 表のファイルの名前（本の名前か「本.部分」。1 つの試験のファイルに焼く試験が 2 つ以上あるとき）
    file: String,
    pub mode: Mode,
    scope: Vec<String>,
    /// 焼いた表と比べるか（posix の表。Windows は比べない。試験の変異は明示して true にする）
    pub check: bool,
    /// 表のどの答えを読み書きするか（"root": 本の答え・"user": root でない利用者で違う歩〈variants.user〉）。open_part は流している
    /// 利用者から決め、with（試験の変異）は "root" に決める（版 3.115.0 の CI の直し: 前は書く・読む所が流している利用者を直に見て、
    /// root でない CI の runner では範囲を決めた焼き直しの試験が本の答えを変えず variants.user にだけ書いた）
    pub variant: &'static str,
    table: Option<Value>,
    base: PathBuf,
    pub ctx: Ctx,
    /// 本ごとに足すそろえる鍵
    pub keys: Vec<String>,
    /// 答え合わせ役の答えの中で、歩の答え（焼かない欄。表は窓の答えを answers に持つ）
    pub strip: Vec<String>,
    /// strip を当てる表の印の鍵（歩の表は method を持つ）
    pub strip_in: Vec<&'static str>,
    /// 場面の宣言から除く名前（Python だけの写し）
    pub exclude: Vec<&'static str>,
    /// 答え合わせ役の答えの中の「ファイルID → 名前」の表の鍵（作業実績）。場面と答え合わせ役の答えのファイルID を @FID(道) にする
    pub fid_key: Option<&'static str>,
    /// 答え合わせ役が起こした作り物のサーバーの URL の鍵（組む所の CM3）。焼いた表では @URL にし、Python 無しでは窓の側で 404 を答える作り物を起こす
    pub url_key: Option<&'static str>,
    /// 答え合わせ役の答えの上の段で、焼かない鍵（root で流したか など利用者で変わる印）
    pub drop: Vec<&'static str>,
    oracle: Value,
    scene: Value,
    answers: BTreeMap<String, Value>,
    routes: BTreeMap<String, String>,
    bad: Vec<String>,
}

/// 段 ④ の配布の間だけ凍らせた最後の Python を相手にする試験（競い合い・受け身・前の版の読み手）か。TPA_NO_PYTHON=1（④ の後の形）では
/// 流さない（配布が終わった版で試験ごと消す。決めは tools/ui-proposals/2026-11-stage3d.json の frozen_python）
/// 流さなかった試験は target/tmp/frozen-skipped.txt に 1 行ずつ書く（版 3.115.0 の作った後の直し: 前は中身を流さずに ok と出るだけだった。
/// tools/bless.py --no-python が流す前に消し、流した後に「流さなかった試験 n 本」を test result の数と別に出す）
pub fn frozen_python(why: &str) -> bool {
    if env_on("TPA_NO_PYTHON") {
        eprintln!("凍らせた Python を相手にする試験なので流しません（TPA_NO_PYTHON）: {why}");
        use std::io::Write;
        let p = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("frozen-skipped.txt");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{why}");
        }
        return false;
    }
    true
}

/// 独立の答え（tools/*-truth.py。app を import しない標準の Python の台本）を流す Python。TPA_NO_PYTHON は「program/app を使わない」形で、
/// 標準の Python は独立の答えにだけ要る（段 ④ の後も残す）。起こせなければ分かる言葉で落とす
pub fn stdlib_python() -> String {
    let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
    let ok = std::process::Command::new(&py).arg("-c").arg("import sys; sys.exit(0)").output().is_ok_and(|o| o.status.success());
    assert!(
        ok,
        "独立の答え（program/tools/*-truth.py）に標準の Python（{py}）が要ります。TPA_NO_PYTHON は program/app を使わない形で、標準の Python は残します"
    );
    py
}

fn env_on(k: &str) -> bool {
    std::env::var(k).is_ok_and(|v| !v.is_empty() && v != "0")
}

impl Bake {
    pub fn open(book: &str, base: &Path) -> Bake {
        Bake::open_part(book, "", base)
    }

    /// 本の部分（表は tests/baked/<本>.<部分>.json）
    pub fn open_part(book: &str, part: &str, base: &Path) -> Bake {
        let file = if part.is_empty() { book.to_string() } else { format!("{book}.{part}") };
        // 焼く・比べるときの時差は UTC に決める（版 3.115.0 の作った後の直し: 答え合わせ役の場面の地方時の日時〈fs の 2026-01-01〉が、焼いた PC と
        // 比べる PC の時差で違う更新時刻になった）。窓も答え合わせ役（子のプロセス）も同じ TZ で流れる
        if std::env::var("TZ").as_deref() != Ok("UTC") {
            // SAFETY: 焼く係を開くのは試験の最初（窓・答え合わせ役を起こす前）。同じ試験の実行ファイルのほかの試験も同じ値にするだけ
            unsafe { std::env::set_var("TZ", "UTC") };
        }
        let bless = std::env::var("TPA_BLESS").unwrap_or_default();
        let no_py = env_on("TPA_NO_PYTHON");
        let mode = match (bless.as_str(), no_py) {
            ("" | "0", false) => Mode::Python,
            ("" | "0", true) => Mode::Baked,
            (_, false) => Mode::Bless,
            (_, true) => Mode::BlessScope,
        };
        let scope = if mode == Mode::BlessScope { bless.split(',').map(|s| s.trim().to_string()).collect() } else { vec![] };
        let path = baked_dir().join(format!("{file}.json"));
        let table = std::fs::read(&path).ok().map(|b| super::json_keep(&b).unwrap_or_else(|| panic!("{} が読めません", path.display())));
        if (mode == Mode::Baked || mode == Mode::BlessScope) && table.is_none() {
            panic!("焼いた表 {} がありません（TPA_BLESS=1 で焼く）", path.display());
        }
        let mut bk = Bake::with(book, &file, mode, scope, table, base);
        bk.variant = variant();
        bk
    }

    /// 流し方と表を決めて作る（試験の変異で使う。open_part は環境変数と tests/baked から決める）
    pub fn with(book: &str, file: &str, mode: Mode, scope: Vec<String>, table: Option<Value>, base: &Path) -> Bake {
        let check = cfg!(unix) && mode != Mode::Bless;
        Bake {
            out: None,
            book: book.into(),
            file: file.into(),
            mode,
            scope,
            check,
            variant: "root",
            table,
            base: base.to_path_buf(),
            ctx: Ctx::new(base),
            keys: vec![],
            strip: vec!["status".into(), "json".into()],
            strip_in: vec!["method"],
            exclude: vec!["py", "pd"],
            fid_key: None,
            url_key: None,
            drop: vec!["rootUser"],
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
            without_offsets(&settle(v, &self.ctx, &self.keys))
        }
    }

    fn strip_answers(&self, v: &Value) -> Value {
        match v {
            Value::Object(o) => Value::Object(
                o.iter()
                    .filter(|(k, _)| !(self.strip_in.iter().any(|m| o.contains_key(*m)) && self.strip.contains(k)))
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
            self.rebuild_from_table()
        }
    }

    /// 起こしたままにする答え合わせ役（common::Live）。焼いた表で流すときは None
    pub fn live(&mut self, script: &str, args: &[&str]) -> (Option<super::Live>, Value) {
        if self.python() {
            let (l, v) = super::Live::start(script, args);
            self.took(&v);
            (Some(l), v)
        } else {
            (None, self.rebuild_from_table())
        }
    }

    /// Python の答えを受けた直後: 場面を写し、表の宣言・問い合わせと比べる（表が古いか）
    pub fn took(&mut self, v: &Value) {
        let ex: Vec<&str> = self.exclude.clone();
        self.scene = snapshot(&self.base, &self.ctx, &ex);
        let ctx = self.ctx.clone();
        // 今に近い時刻（答え合わせ役の now・錠や切断の指示の時刻）は場面と同じく今からのずれで持つ（作り直す時に今へずらす）
        self.oracle = map_strings(&self.strip_answers(v), &|s| text_decl(s, &ctx));
        // 答え合わせ役の答えの、利用者の名前を書く欄の OS の利用者の名前（Python の書いた人・名乗り）は @USER@（作り直す時に今の利用者へ）
        self.oracle = named_users(&self.oracle, "");
        if let Some(o) = self.oracle.as_object_mut() {
            o.retain(|k, _| !self.drop.contains(&k.as_str()));
        }
        if let Some(url) = self.url_key.and_then(|k| v[k].as_str()).filter(|u| !u.is_empty()) {
            let url = url.to_string();
            self.ctx.url(&url);
            self.oracle = map_strings(&self.oracle, &|s| s.replace(url.as_str(), "@URL"));
        }
        if let Some(k) = self.fid_key {
            // ファイルID（装置の番号と inode）は作り直すと変わるので、場面の中身と答え合わせ役の答えでは @FID(場面の道) にする
            let mut pairs = vec![];
            for (fid, name) in v[k].as_object().cloned().unwrap_or_default() {
                let name = name.as_str().unwrap_or("").to_string();
                let rel = self.scene["files"]
                    .as_object()
                    .unwrap()
                    .keys()
                    .chain(self.scene["dirs"].as_object().unwrap().keys())
                    .find(|r| r.rsplit('/').next() == Some(name.as_str()))
                    .cloned();
                if let Some(rel) = rel {
                    pairs.push((fid, format!("@FID({rel})")));
                }
            }
            let f = |s: &str| {
                pairs
                    .iter()
                    .fold(s.to_string(), |t, (a, b)| if t == *a || t.contains(&format!("\"{a}\"")) { t.replace(a.as_str(), b) } else { t })
            };
            self.scene = map_strings(&self.scene, &f);
            self.oracle = map_strings(&self.oracle, &f);
        }
        if self.mode == Mode::Python && self.check {
            let Some(t) = &self.table else {
                self.bad.push(format!("焼いた表 tests/baked/{}.json がありません（TPA_BLESS=1 で焼く）", self.file));
                return;
            };
            let now_free = |v: &Value| {
                let re = regex::Regex::new(r"@NOW\(-?\d+ms").unwrap();
                settle(&map_strings(v, &|s| re.replace_all(s, "@NOW(~").into_owned()), &self.ctx, &self.keys)
            };
            let (a, b) = (now_free(&t["oracle"]), now_free(&self.oracle));
            if let Some(d) = diff_tol(&a, &b, "oracle") {
                self.bad.push(format!("表が古い（答え合わせ役の場面・歩が変わった。tools/bless.py で焼き直す）: {d}"));
            }
            // どの利用者でも比べる（読めない段の中は decl_cmp が除く）
            if let Some(d) = super::diff(&decl_cmp(&t["scene"]), &decl_cmp(&self.scene), "scene") {
                self.bad.push(format!("表が古い（場面のフォルダが表の宣言と違う）: {}", cut(&d)));
            }
        }
    }

    fn rebuild_from_table(&mut self) -> Value {
        let t = self.table.clone().unwrap();
        materialize(&t["scene"], &self.base, &self.ctx);
        self.scene = t["scene"].clone();
        self.oracle = t["oracle"].clone();
        let ctx = self.ctx.clone();
        let base = self.base.clone();
        let url = if self.url_key.is_some() { serve_404() } else { String::new() };
        self.ctx.url(&url);
        let o = map_strings(&t["oracle"], &|s| fid_unsub(&text_of_decl(s, &ctx), &base).replace("@URL", &url));
        map_values(&o, &|s| if s == "@USER@" { os_user().unwrap_or("").to_string() } else { s.to_string() })
    }

    /// 場面が置いた物か（作業フォルダの中の道）
    pub fn in_scene(&self, p: &Path) -> bool {
        let rel = p.strip_prefix(&self.base).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        self.scene["files"].get(&rel).is_some() || self.scene["dirs"].get(&rel).is_some()
    }

    fn table_answer(&self, key: &str) -> Option<Value> {
        let t = self.table.as_ref()?;
        if self.variant == "user" {
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
            if let Some(d) = diff_tol(&w, &g, &key) {
                self.bad.push(format!("そろえた後の窓の答えが Python と違う（焼かない）: {}", cut(&d)));
            }
        }
        if self.check && self.table.is_some() && self.mode != Mode::BlessScope {
            match self.table_answer(&key) {
                None => self.bad.push(format!("表に無い歩（表が古い。tools/bless.py で焼き直す）: {key}")),
                Some(t) => {
                    if let Some(d) = diff_tol(&t, &g, &key) {
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
                        self.file,
                        test_bad.len(),
                        self.bad.len(),
                        self.bad.iter().chain(test_bad).take(20).cloned().collect::<Vec<_>>().join("\n")
                    );
                }
                self.write();
            }
            Mode::BlessScope => {
                // 比べる前の答えは、この利用者が読む答え（root でなければ variants.user を重ねた形）
                let t = self.table.as_ref().unwrap();
                let mut old = t["answers"].as_object().cloned().unwrap_or_default();
                if self.variant == "user" {
                    if let Some(u) = t["variants"]["user"].as_object() {
                        old.extend(u.iter().map(|(k, v)| (k.clone(), v.clone())));
                    }
                }
                let mut out = vec![];
                let routes = self.table.as_ref().unwrap()["routes"].clone();
                let in_scope = |k: &str, r: &str| {
                    self.scope.iter().any(|s| s == "all" || r == s || r.starts_with(&format!("{s} ")) || k.starts_with(s.as_str()))
                };
                for (k, g) in &self.answers {
                    let same = old.get(k).is_some_and(|o| diff_tol(o, g, k).is_none());
                    if !same {
                        let r = &self.routes[k];
                        if !in_scope(k, r) {
                            out.push(format!("範囲の外の答えが変わった: {k}（{r}）"));
                        }
                    }
                }
                // 前の表にあって今回の答えに無い歩も、範囲の外なら止める（版 3.115.0 の作った後の直し: 前は書いた表から黙って落ちた）
                for k in old.keys().filter(|k| !self.answers.contains_key(*k)) {
                    let r = routes[k.as_str()].as_str().unwrap_or("?");
                    if !in_scope(k, r) {
                        out.push(format!("範囲の外の歩が消えた: {k}（{r}）"));
                    }
                }
                if !out.is_empty() {
                    panic!("{}: 範囲（{}）の外が変わったので焼きません:\n{}", self.file, self.scope.join(","), out.join("\n"));
                }
                self.write();
            }
            _ => {
                if !self.bad.is_empty() {
                    self.dump_diff();
                    panic!(
                        "{}: 焼いた表との食い違い {} 件（窓の今の答えは target/tmp/bless-diff/{}.json）:\n{}",
                        self.file,
                        self.bad.len(),
                        self.file,
                        self.bad.iter().take(20).cloned().collect::<Vec<_>>().join("\n")
                    );
                }
            }
        }
    }

    fn dump_diff(&self) {
        let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("bless-diff");
        let _ = std::fs::create_dir_all(&d);
        let v = json!({"book": self.file, "bad": self.bad, "answers": self.answers});
        let _ = std::fs::write(d.join(format!("{}.json", self.file)), serde_json::to_string_pretty(&v).unwrap());
    }

    fn write(&self) {
        let out_dir = self.out.clone().or_else(|| std::env::var("TPA_BAKE_OUT").ok().map(PathBuf::from)).unwrap_or_else(baked_dir);
        std::fs::create_dir_all(&out_dir).unwrap();
        let path = out_dir.join(format!("{}.json", self.file));
        let old = self.table.clone().unwrap_or(Value::Null);
        let answers: Map<String, Value> = self.answers.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        let routes: Map<String, Value> = self.routes.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
        let mut t = if self.variant == "user" && old.is_object() {
            // root でない利用者: 本の答え（root で焼いた）は変えず、違う歩だけを variants.user に持つ
            let mut t = old.clone();
            let base = old["answers"].as_object().cloned().unwrap_or_default();
            let user: Map<String, Value> = answers
                .iter()
                .filter(|(k, v)| base.get(*k).is_none_or(|b| diff_tol(b, v, k).is_some()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            t["variants"]["user"] = Value::Object(user);
            t
        } else {
            let mut t = json!({
                "about": format!("窓が焼いた答え（版 3.115.0 の bless。desktop/tests/common/bake.rs）。本 {}。作り直すのは python program/tools/bless.py {}", self.file, self.file),
                "book": self.book,
                "file": self.file,
                "os": "posix",
                "variant": self.variant,
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
        eprintln!("{}", summary(&self.file, &old, &t).lines().map(|l| format!("bless| {l}")).collect::<Vec<_>>().join("\n"));
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
            // 大きな整数（held の印の字）は桁のまま書く（読み戻すと common::json_keep が同じ印にする）
            _ if da_core::held::has_held(v) || da_core::held::has_nonfinite(v) || da_core::held::has_lone(v) => {
                da_core::held::to_text(v, None)
            }
            _ => serde_json::to_string(v).unwrap(),
        }
    }
    match v {
        Value::Object(o) => {
            let items: Vec<String> = o
                .iter()
                .map(|(k, x)| format!("{}{}: {}", pad(depth + 1), serde_json::to_string(k).unwrap(), inner(x, depth + 1, deep(k), &pad)))
                .collect();
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
    let (old, new) = (&without_offsets(old), &without_offsets(new));
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
                    e.2.push(format!(
                        "{k}{p}: {} → {}",
                        a.get(p).map(|v| cut(&v.to_string())).unwrap_or("（無し）".into()),
                        b.get(p).map(|v| cut(&v.to_string())).unwrap_or("（無し）".into())
                    ));
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
