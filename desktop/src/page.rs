//! 画面（GET /）を窓が描く（版 3.85.0。Python の routes/system.py の index と web.py の小さな型を写した物）。
//! Python が答えなくても、画面の HTML は窓が出す（最初の画面が尋ねる /api/config・/api/dashboard/sources も窓。lot.rs）。
//!
//! 決まりは Python と同じ（評価関数: tests/page_parity.rs ← program/tests/settings_oracle.py の reads）:
//! - 型（app/templates/index.html）は {{ 式 }} だけ（式: 名前・名前.名前・url_for('static', filename='…')・字と数）と |tojson・|safe。
//!   {% %}・{# #}・知らない式・知らないフィルタは描かずに Python に任せる（None）。値は & < > " ' を逃がす。最後の改行 1 つは出さない
//! - |tojson は web.dumps（鍵を並べる・日本語は \u・区切り ", " ": "）のあと < > & ' を \u003c などに替えた字
//! - build は app_build.fingerprint（版＋app/ の下の .py .html .js .css .json の名前・大きさ・mtime_ns の sha1 の頭 12 字）。
//!   窓は ?v= の付いたファイルを長く覚えるので、Python と 1 字も違えない。プログラムの置き場ごとに 1 度だけ数える（Python も起動のときに 1 度）
//! - csp_nonce は暗号の乱数（secrets.token_urlsafe(16) と同じ 16 バイト・base64url・詰め字なし）。CSP の見出しは web.csp と同じ字

use crate::bundle::Py;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

type R<T> = Result<T, Py>;

fn tables() -> &'static Value {
    crate::bundle::tables()
}

// ------------------------------------------------------------------ JSON の字（web.dumps と _tojson）
/// json.dumps(v, ensure_ascii=True, sort_keys=True)（区切りは既定の ", " と ": "）
pub fn dumps_ascii(v: &Value) -> String {
    let mut out = String::new();
    for c in crate::join::py_dumps(v).chars() {
        // 字の外は ASCII だけなので、~ より上の字（0x7f も）を \u で書けば ensure_ascii と同じ
        if (c as u32) > 0x7e {
            let mut buf = [0u16; 2];
            for u in c.encode_utf16(&mut buf) {
                out.push_str(&format!("\\u{u:04x}"));
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// web._tojson: HTML の中に置いても安全な JSON
pub fn tojson(v: &Value) -> String {
    dumps_ascii(v).replace('<', "\\u003c").replace('>', "\\u003e").replace('&', "\\u0026").replace('\'', "\\u0027")
}

/// web._escape
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&#34;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// urllib.parse.quote_plus（url_for の ?v=）
fn quote_plus(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'-' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            b => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Path.read_text と同じ改行の読み方（\r\n と \r を \n に。Windows で取り出した型は CRLF のことがある）
pub fn universal_newlines(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n")
}

// ------------------------------------------------------------------ 型（web.Template）
#[derive(Debug, Clone, PartialEq)]
enum Expr {
    Str(String),
    Int(i64),
    /// 名前.名前.…
    Path(Vec<String>),
    /// url_for('static', filename=式)
    Static(Box<Expr>),
}

#[derive(Debug, Clone)]
enum Part {
    Text(String),
    Tag(Expr, bool, bool), // 式・tojson・safe
}

#[derive(Debug, Clone)]
pub struct Template {
    parts: Vec<Part>,
}

fn is_ident(s: &str) -> bool {
    let mut cs = s.chars();
    cs.next().is_some_and(|c| c == '_' || c.is_ascii_alphabetic()) && cs.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

/// Python の字の値（'…' か "…"。逃がしの無い物だけ）
fn str_lit(s: &str) -> Option<String> {
    let q = s.chars().next()?;
    if (q != '\'' && q != '"') || s.len() < 2 || !s.ends_with(q) {
        return None;
    }
    let inner = &s[1..s.len() - 1];
    (!inner.contains(q) && !inner.contains('\\') && !inner.contains('\n')).then(|| inner.to_string())
}

/// 窓が読める式だけ（ほかは None＝Python に任せる）
fn parse_expr(e: &str) -> Option<Expr> {
    let e = e.trim();
    if let Some(s) = str_lit(e) {
        return Some(Expr::Str(s));
    }
    if !e.is_empty() && e.bytes().all(|b| b.is_ascii_digit()) && (e == "0" || !e.starts_with('0')) {
        return e.parse().ok().map(Expr::Int);
    }
    if let Some(args) = e.strip_prefix("url_for(").and_then(|x| x.strip_suffix(')')) {
        let (first, rest) = args.split_once(',')?;
        if str_lit(first.trim())? != "static" {
            return None;
        }
        let (k, v) = rest.split_once('=')?;
        if k.trim() != "filename" || v.contains(',') {
            return None;
        }
        return Some(Expr::Static(Box::new(parse_expr(v)?)));
    }
    let names: Vec<String> = e.split('.').map(|x| x.trim().to_string()).collect();
    // url_for を呼ばずに名前だけ書くと Python は関数の repr を出す（窓は描かない）
    names.iter().all(|n| is_ident(n) && !["None", "True", "False", "url_for"].contains(&n.as_str())).then_some(Expr::Path(names))
}

impl Template {
    /// 型の字 → 型。窓が読めない書き方なら None
    pub fn parse(source: &str) -> Option<Template> {
        if source.contains("{%") || source.contains("{#") {
            return None;
        }
        static TAG: OnceLock<Regex> = OnceLock::new();
        let tag = TAG.get_or_init(|| Regex::new(r"(?s)\{\{(.*?)\}\}").unwrap());
        let mut parts = vec![];
        let mut pos = 0;
        for m in tag.captures_iter(source) {
            let all = m.get(0).unwrap();
            parts.push(Part::Text(source[pos..all.start()].to_string()));
            let mut it = m[1].split('|').map(str::trim);
            let expr = parse_expr(it.next().unwrap_or(""))?;
            let (mut j, mut s) = (false, false);
            for f in it {
                match f {
                    "tojson" => j = true,
                    "safe" => s = true,
                    _ => return None,
                }
            }
            parts.push(Part::Tag(expr, j, s));
            pos = all.end();
        }
        let tail = &source[pos..];
        parts.push(Part::Text(tail.strip_suffix('\n').unwrap_or(tail).to_string()));
        Some(Template { parts })
    }

    /// 描く。名前は ctx の値（無ければ空の字＝_Undefined）。窓が Python と同じ字にできない値（表を字にする など）は None
    pub fn render(&self, ctx: &Map<String, Value>, build: &str) -> Option<String> {
        let mut out = String::new();
        for p in &self.parts {
            match p {
                Part::Text(t) => out.push_str(t),
                Part::Tag(e, j, s) => {
                    let (v, safe) = eval(e, ctx, build)?;
                    match v {
                        None if *j => return None, // _Undefined を JSON にできない（Python は落ちる）
                        None => {}
                        Some(v) if *j => out.push_str(&tojson(&v)),
                        Some(v) => {
                            let t = py_str(&v)?;
                            out.push_str(&if *s || safe { t } else { escape(&t) });
                        }
                    }
                }
            }
        }
        Some(out)
    }
}

/// str(値)（字・数・真偽・None だけ。表や並びは repr の字になるので窓は描かない）
fn py_str(v: &Value) -> Option<String> {
    Some(match v {
        Value::String(s) => s.clone(),
        Value::Null => "None".into(),
        Value::Bool(b) => (if *b { "True" } else { "False" }).into(),
        Value::Number(n) => crate::join::py_number(n),
        _ => return None,
    })
}

/// 式の値 → (値〈None は _Undefined〉, 逃がし済みか)。窓が同じに読めない式は None
type Evaled = (Option<Value>, bool);
fn eval(e: &Expr, ctx: &Map<String, Value>, build: &str) -> Option<Evaled> {
    Some(match e {
        Expr::Str(s) => (Some(json!(s)), false),
        Expr::Int(n) => (Some(json!(n)), false),
        Expr::Path(names) => {
            let mut cur = ctx.get(&names[0]).cloned();
            for n in &names[1..] {
                cur = match cur {
                    None => None,
                    Some(Value::Object(o)) => o.get(n).cloned(),
                    Some(_) => return None, // 字の属性（getattr）は窓では読まない
                };
            }
            (cur, false)
        }
        Expr::Static(f) => {
            let (v, _) = eval(f, ctx, build)?;
            let name = match v {
                Some(v) => py_str(&v)?,
                None => String::new(),
            };
            (Some(json!(escape(&format!("/static/{name}?v={}", quote_plus(build))))), true)
        }
    })
}

// ------------------------------------------------------------------ 指紋（app_build.fingerprint）
/// app/version.py の APP_VERSION（app_build.app_version と同じ読み方。読めなければ空）
pub fn app_version(program: &Path) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r#"APP_VERSION\s*=\s*"([^"]+)""#).unwrap());
    crate::small_reads::version_py(program) // 更新時刻と大きさで覚えた字（版 3.88.0）
        .and_then(|t| re.captures(&t).map(|c| c[1].to_string()))
        .unwrap_or_default()
}

fn walk(root: &Path, dir: &Path, exts: &[String], skip: &[String], items: &mut Vec<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut dirs = vec![];
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let path = e.path();
        // os.walk: 道を指す印（シンボリックリンク）のフォルダは名前に数えるが降りない。ファイルの印は先のファイルの大きさと時刻
        let is_link = e.file_type().is_ok_and(|t| t.is_symlink());
        let is_dir = std::fs::metadata(&path).is_ok_and(|m| m.is_dir());
        if is_dir {
            if !is_link && !skip.contains(&name) {
                dirs.push(path);
            }
            continue;
        }
        if !exts.iter().any(|x| name.ends_with(x.as_str())) {
            continue;
        }
        let Ok(m) = std::fs::metadata(&path) else { continue };
        let ns = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
        let rel = path.strip_prefix(root).unwrap_or(&path).components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>();
        items.push(format!("{}|{}|{}", rel.join("/"), m.len(), ns));
    }
    for d in dirs {
        walk(root, &d, exts, skip, items);
    }
}

/// app_build.fingerprint(program)
pub fn fingerprint(program: &Path) -> String {
    let f = &tables()["fingerprint"];
    let list = |k: &str| f[k].as_array().into_iter().flatten().filter_map(Value::as_str).map(String::from).collect::<Vec<_>>();
    let ver = app_version(program);
    let root = program.join("app");
    let mut items = vec![];
    walk(&root, &root, &list("exts"), &list("skipDirs"), &mut items);
    items.sort();
    let mut data = ver.as_bytes().to_vec();
    for it in &items {
        data.extend_from_slice(it.as_bytes());
    }
    format!("{ver}-{}", &crate::bundle::sha1_hex(&data)[..12])
}

// ------------------------------------------------------------------ 印（CSP の nonce）
/// secrets.token_urlsafe(16)
pub fn nonce() -> Option<String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).ok()?;
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in b.chunks(3) {
        let n = chunk.iter().fold(0u32, |acc, x| (acc << 8) | *x as u32) << (8 * (3 - chunk.len()));
        for i in 0..=chunk.len() {
            out.push(A[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    Some(out)
}

/// web.csp
pub fn csp(nonce: &str) -> String {
    format!("script-src 'self' 'nonce-{nonce}'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
}

// ------------------------------------------------------------------ 画面
/// 画面に埋める材料（routes/system.py の index の中身）
pub struct Parts {
    pub ui_state: Value,
    pub ui_profile: Value,
    pub conversions: Value,
}

/// 型のファイルの印（大きさ・書いた時刻）と読んだ型（窓が読めない型は None）
type Cached = (Option<(u64, u128)>, Option<Template>);

/// 画面の係（型と指紋をプログラムの置き場ごとに覚える）
#[derive(Default)]
pub struct Page {
    templates: Mutex<HashMap<PathBuf, Cached>>,
    builds: Mutex<HashMap<PathBuf, String>>,
}

fn sig(p: &Path) -> Option<(u64, u128)> {
    let m = std::fs::metadata(p).ok()?;
    Some((m.len(), m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos()))
}

/// 画面の答え（見出しと本文）
pub struct Html {
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Page {
    pub fn build(&self, program: &Path) -> String {
        let mut b = self.builds.lock().unwrap();
        b.entry(program.to_path_buf()).or_insert_with(|| fingerprint(program)).clone()
    }

    fn template(&self, program: &Path) -> Option<Template> {
        let path = program.join("app").join("templates").join("index.html");
        let s = sig(&path);
        let mut t = self.templates.lock().unwrap();
        if let Some((old, tpl)) = t.get(&path) {
            if *old == s && s.is_some() {
                return tpl.clone();
            }
        }
        let tpl = std::fs::read_to_string(&path).ok().and_then(|src| Template::parse(&universal_newlines(&src)));
        t.insert(path, (s, tpl.clone()));
        tpl
    }

    /// GET /（HEAD は本文なし）。窓が描けなければ None（Python に任せる）
    pub fn index(&self, program: &Path, parts: Parts, head: bool) -> Option<Html> {
        let tpl = self.template(program)?;
        let brand: Value = serde_json::from_slice(&std::fs::read(program.join("app").join("brand.json")).ok()?).ok()?;
        let brand: Map<String, Value> =
            brand.as_object()?.iter().filter(|(k, _)| !k.starts_with('_')).map(|(k, v)| (k.clone(), v.clone())).collect();
        let build = self.build(program);
        let nonce = nonce()?;
        let mut ctx = Map::new();
        ctx.insert("csp_nonce".into(), json!(nonce));
        ctx.insert("brand".into(), Value::Object(brand));
        ctx.insert("app_version".into(), json!(app_version(program)));
        ctx.insert("build".into(), json!(build));
        ctx.insert("ui_state".into(), parts.ui_state);
        ctx.insert("ui_profile".into(), parts.ui_profile);
        ctx.insert("conversions".into(), parts.conversions);
        let body = tpl.render(&ctx, &build)?.into_bytes();
        let mut headers = vec![
            ("Content-Type".to_string(), "text/html; charset=utf-8".to_string()),
            ("Cache-Control".to_string(), "no-store".to_string()),
            ("Content-Security-Policy".to_string(), csp(&nonce)),
        ];
        if head {
            headers.push(("Content-Length".into(), body.len().to_string()));
        }
        Some(Html { headers, body: if head { vec![] } else { body } })
    }
}

/// 変換表の画面の形（conversions.view を ordered の順に）と版。読めない形は Err（Python に任せる）
pub fn conversion_views(rows: &[Value], revision: i64) -> R<Value> {
    Ok(json!({"items": crate::bundle::conv_views(rows)?, "revision": revision}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn template_reads_only_the_small_syntax() {
        assert!(Template::parse("a {% if x %} b").is_none());
        assert!(Template::parse("{# x #}").is_none());
        assert!(Template::parse("{{ x|upper }}").is_none());
        assert!(Template::parse("{{ f(x) }}").is_none());
        assert!(Template::parse("{{ url_for }}").is_none());
        assert!(Template::parse("{{ url_for('other', filename='a') }}").is_none());
        let t = Template::parse("<p>{{ brand.name }}</p>{{ v|tojson }}{{ h|safe }}{{ nope }}{{ url_for('static', filename='js/a.js') }}\n")
            .unwrap();
        let got = t
            .render(&ctx(json!({"brand": {"name": "A&B<\"'>"}, "v": {"b": "</script>字", "a": [1, 2.0]}, "h": "<b>"})), "3.0-x y")
            .unwrap();
        assert_eq!(
            got,
            "<p>A&amp;B&lt;&#34;&#39;&gt;</p>{\"a\": [1, 2.0], \"b\": \"\\u003c/script\\u003e\\u5b57\"}<b>/static/js/a.js?v=3.0-x+y"
        );
        // CRLF の型（Windows で取り出した物）も Python の read_text と同じ字になる
        assert_eq!(universal_newlines("a\r\nb\rc\n"), "a\nb\nc\n");
        assert_eq!(Template::parse(&universal_newlines("x\r\n")).unwrap().render(&Map::new(), "").unwrap(), "x");
        // 最後の改行は 1 つだけ落とす
        assert_eq!(Template::parse("x\n\n").unwrap().render(&Map::new(), "").unwrap(), "x\n");
        // 表を字にする・字の属性・_Undefined を JSON にするのは Python に任せる
        assert!(Template::parse("{{ v }}").unwrap().render(&ctx(json!({"v": {}})), "").is_none());
        assert!(Template::parse("{{ v.upper }}").unwrap().render(&ctx(json!({"v": "x"})), "").is_none());
        assert!(Template::parse("{{ v|tojson }}").unwrap().render(&Map::new(), "").is_none());
    }

    #[test]
    fn json_is_like_python_ensure_ascii() {
        // json.dumps({"z": "😀\x7f", "a": -0.0, "b": 1e16, "c": None}, ensure_ascii=True, sort_keys=True)
        assert_eq!(
            dumps_ascii(&json!({"z": "😀\u{7f}", "a": -0.0, "b": 1e16, "c": null})),
            r#"{"a": -0.0, "b": 1e+16, "c": null, "z": "\ud83d\ude00\u007f"}"#
        );
        assert_eq!(tojson(&json!("<&'>")), r#""\u003c\u0026\u0027\u003e""#);
    }

    #[test]
    fn nonce_is_22_urlsafe_chars() {
        let a = nonce().unwrap();
        assert_eq!(a.len(), 22);
        assert!(a.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_ne!(a, nonce().unwrap());
        assert_eq!(csp("N"), "script-src 'self' 'nonce-N'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    }
}
