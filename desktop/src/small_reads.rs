//! 小さい読む道（版 3.88.0。routes/system.py の build・changelog）を窓が答える。
//!
//! - GET /api/build … `{"version": APP_VERSION}`（Python の jsonify と同じ字: 詰めた区切り・改行）
//! - GET /api/changelog … app/changelog.json（`python app_build.py --release` が app/version.py の CHANGELOG を、jsonify と 1 バイトも
//!   違わない形で焼く）を字のまま返す。焼いた版が中身（program）の版と同じで、字が jsonify の形（LF の改行で終わる。Windows の
//!   checkout で CRLF にされていない。.gitattributes の -text）のときだけ。無い・読めない・版が違う（前の版へ戻した形など）は Python に任せる
//! - GET /api/health は窓が答えない（Python が答えているかを確かめる印のまま。窓が ok を返すと、Python が止まっても ok になる）
//! - ?engine=python は Python。HEAD は本文なしで Content-Length（Python と同じ）
//!
//! app/version.py（約 200 KB）と changelog.json は、ファイルの更新時刻と大きさで覚える。書いた直後（RACY 秒以内）の覚えは使わない
//! （刻みの粗い置き場で、同じ大きさの書き直しを古いまま答えない。git の racy と同じ考え）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

type Stamp = (Option<SystemTime>, u64);
/// 覚えた中身（字・焼いた版）
type Memo = Mutex<HashMap<PathBuf, (Stamp, Arc<Read>)>>;
const RACY: Duration = Duration::from_secs(2);

pub struct Read {
    pub bytes: Vec<u8>,
    /// changelog.json の version（version.py では None）
    pub baked: Option<String>,
}

fn stamp(path: &Path) -> Option<Stamp> {
    let m = std::fs::metadata(path).ok()?;
    Some((m.modified().ok(), m.len()))
}

/// ファイルの中身（更新時刻と大きさが同じで、書いてから RACY 秒より経っているあいだは覚えた物）
fn read_memo(memo: &'static OnceLock<Memo>, path: &Path, parse: fn(Vec<u8>) -> Read) -> Option<Arc<Read>> {
    let st = stamp(path)?;
    let settled = st.0.and_then(|t| SystemTime::now().duration_since(t).ok()).is_some_and(|age| age > RACY);
    let m = memo.get_or_init(Mutex::default);
    if settled {
        if let Some((had, r)) = m.lock().unwrap().get(path) {
            if *had == st {
                return Some(r.clone());
            }
        }
    }
    let r = Arc::new(parse(std::fs::read(path).ok()?));
    let mut g = m.lock().unwrap();
    if g.len() > 16 {
        g.clear();
    }
    g.insert(path.to_path_buf(), (st, r.clone()));
    Some(r)
}

/// app/version.py の字（窓の版の読み手 app_version が使う 1 か所）
fn version_py(program: &Path) -> Option<Arc<Read>> {
    static MEMO: OnceLock<Memo> = OnceLock::new();
    read_memo(&MEMO, &program.join("app").join("version.py"), |b| Read { bytes: b, baked: None })
}

/// app/version.py の APP_VERSION の字（行の頭の `APP_VERSION = "…"`。窓の版の読み手はここ 1 つ: update::program_version・
/// page::app_version・/api/build）。読めなければ None
pub fn app_version(program: &Path) -> Option<String> {
    let r = version_py(program)?;
    let text = std::str::from_utf8(&r.bytes).ok()?;
    text.lines().find_map(|l| {
        let rest = l.strip_prefix("APP_VERSION")?.trim_start().strip_prefix('=')?.trim();
        let q = rest.chars().next().filter(|c| *c == '\'' || *c == '"')?;
        let v = &rest[1..];
        Some(v[..v.find(q)?].to_string())
    })
}

/// GET /api/build の答えの字（読めない版は None）
pub fn build(program: &Path) -> Option<Vec<u8>> {
    let v = crate::update::program_version(program)?;
    Some(format!("{{\"version\":{}}}\n", serde_json::to_string(&v).ok()?).into_bytes())
}

/// GET /api/changelog の答えの字（焼いた版が中身の版と同じ・jsonify の形のときだけ）
pub fn changelog(program: &Path) -> Option<Vec<u8>> {
    static MEMO: OnceLock<Memo> = OnceLock::new();
    let r = read_memo(&MEMO, &program.join("app").join("changelog.json"), |b| {
        // jsonify の形: LF の改行 1 つで終わり、\r を含まない（ensure_ascii なので字の中に生の改行は無い）
        let shaped = b.ends_with(b"}\n") && !b.contains(&b'\r');
        let v: Option<serde_json::Value> = if shaped { serde_json::from_slice(&b).ok() } else { None };
        let baked = v.filter(|v| v["entries"].is_array()).and_then(|v| v["version"].as_str().map(String::from));
        Read { bytes: b, baked }
    })?;
    let want = crate::update::program_version(program)?;
    (r.baked.as_deref() == Some(want.as_str())).then(|| r.bytes.clone())
}

/// 窓の受け口（main.rs の native）: 窓が答えるなら (見出し, 本文)。Python に任せるなら None
pub fn reply(method: &str, path: &str, query: &str, program: &Path) -> Option<(Vec<(String, String)>, Vec<u8>)> {
    if !matches!(method, "GET" | "HEAD") || crate::lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
        return None;
    }
    let body = match path {
        "/api/build" => build(program)?,
        "/api/changelog" => changelog(program)?,
        _ => return None,
    };
    let headers =
        vec![("Content-Type".to_string(), "application/json".to_string()), ("Content-Length".to_string(), body.len().to_string())];
    Some((headers, if method == "HEAD" { vec![] } else { body }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn program(name: &str, version: &str, baked: Option<&str>) -> PathBuf {
        let d = std::env::temp_dir().join(format!("da-small-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("app")).unwrap();
        std::fs::write(d.join("app").join("version.py"), format!("\"\"\"APP_VERSION は版\"\"\"\nAPP_VERSION = \"{version}\"\n")).unwrap();
        if let Some(b) = baked {
            std::fs::write(d.join("app").join("changelog.json"), b).unwrap();
        }
        d
    }

    const BODY: &str = "{\"entries\":[{\"date\":\"2026-11-07\",\"notes\":[\"\\u7a93\"],\"version\":\"3.88.0\"}],\"version\":\"3.88.0\"}\n";

    #[test]
    fn build_is_like_jsonify() {
        let p = program("build", "3.88.0", None);
        assert_eq!(build(&p).unwrap(), b"{\"version\":\"3.88.0\"}\n");
        assert_eq!(app_version(&p).as_deref(), Some("3.88.0"), "説明の中の APP_VERSION の字は読まない（行の頭だけ）");
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn changelog_only_when_the_baked_version_is_the_program_version() {
        let p = program("ok", "3.88.0", Some(BODY));
        assert_eq!(changelog(&p).unwrap(), BODY.as_bytes(), "焼いた字をそのまま");
        // 版が違う（前の版へ戻した形）・無い・読めない・CRLF にされた（Windows の checkout）は Python に任せる
        let old = program("old", "3.87.0", Some(BODY));
        assert!(changelog(&old).is_none());
        let none = program("none", "3.88.0", None);
        assert!(changelog(&none).is_none());
        let bad = program("bad", "3.88.0", Some("{"));
        assert!(changelog(&bad).is_none());
        let crlf = program("crlf", "3.88.0", Some(&BODY.replace('\n', "\r\n")));
        assert!(changelog(&crlf).is_none(), "CRLF の字は Python と 1 バイト違う");
        // 中身の版が変わった（書いた直後は覚えを使わない）
        std::fs::write(p.join("app").join("version.py"), "APP_VERSION = \"3.88.1\"\n").unwrap();
        assert!(changelog(&p).is_none(), "中身の版が変わった");
        for d in [p, old, none, bad, crlf] {
            let _ = std::fs::remove_dir_all(&d);
        }
    }

    #[test]
    fn the_window_reply_is_like_python() {
        // 受け口: Python の準備によらず答える・HEAD は本文なしで Content-Length・?engine=python と /api/health は Python
        let p = program("reply", "3.88.0", Some(BODY));
        let (h, b) = reply("GET", "/api/changelog", "", &p).expect("窓が答える");
        assert_eq!(b, BODY.as_bytes());
        assert!(
            h.contains(&("Content-Length".into(), BODY.len().to_string()))
                && h.contains(&("Content-Type".into(), "application/json".into()))
        );
        let (h, b) = reply("HEAD", "/api/build", "", &p).unwrap();
        assert!(b.is_empty() && h.contains(&("Content-Length".into(), "21".into())), "{h:?}");
        assert!(reply("GET", "/api/build", "engine=python", &p).is_none());
        assert!(reply("GET", "/api/health", "", &p).is_none(), "生きているかは Python");
        assert!(reply("POST", "/api/build", "", &p).is_none());
        std::fs::remove_file(p.join("app").join("changelog.json")).unwrap();
        assert!(reply("GET", "/api/changelog", "", &p).is_none(), "焼いていなければ Python");
        let _ = std::fs::remove_dir_all(&p);
    }
}
