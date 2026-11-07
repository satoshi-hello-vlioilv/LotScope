//! 小さい読む道（版 3.88.0。routes/system.py の build・changelog）を窓が答える。
//!
//! - GET /api/build … `{"version": APP_VERSION}`（Python の jsonify と同じ字: 詰めた区切り・改行）
//! - GET /api/changelog … app/changelog.json（`python app_build.py --release` が app/version.py の CHANGELOG を、jsonify と 1 バイトも
//!   違わない形で焼く）を字のまま返す。焼いた版が中身（program）の版と同じときだけ。無い・読めない・版が違う（前の版へ戻した形など）は
//!   Python に任せる（None）
//! - GET /api/health は窓が答えない（Python が答えているかを確かめる印のまま。窓が ok を返すと、Python が止まっても ok になる）
//!
//! app/version.py（約 200 KB）と changelog.json は、ファイルの更新時刻と大きさで覚える（問い合わせのたびに読まない）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

type Stamp = (Option<SystemTime>, u64);
type Memo = Mutex<HashMap<PathBuf, (Stamp, Arc<Vec<u8>>)>>;

fn stamp(path: &Path) -> Option<Stamp> {
    let m = std::fs::metadata(path).ok()?;
    Some((m.modified().ok(), m.len()))
}

/// ファイルの中身（更新時刻と大きさが同じあいだは覚えた物）
fn read_memo(memo: &'static OnceLock<Memo>, path: &Path) -> Option<Arc<Vec<u8>>> {
    let st = stamp(path)?;
    let m = memo.get_or_init(Mutex::default);
    if let Some((had, bytes)) = m.lock().unwrap().get(path) {
        if *had == st {
            return Some(bytes.clone());
        }
    }
    let bytes = Arc::new(std::fs::read(path).ok()?);
    let mut g = m.lock().unwrap();
    if g.len() > 16 {
        g.clear();
    }
    g.insert(path.to_path_buf(), (st, bytes.clone()));
    Some(bytes)
}

/// app/version.py の字（窓の版の読み手 update::program_version・page::app_version が使う 1 か所）
pub fn version_py(program: &Path) -> Option<String> {
    static MEMO: OnceLock<Memo> = OnceLock::new();
    let bytes = read_memo(&MEMO, &program.join("app").join("version.py"))?;
    String::from_utf8(bytes.to_vec()).ok()
}

/// GET /api/build の答えの字（読めない版は None）
pub fn build(program: &Path) -> Option<Vec<u8>> {
    let v = crate::update::program_version(program)?;
    Some(format!("{{\"version\":{}}}\n", serde_json::to_string(&v).ok()?).into_bytes())
}

/// GET /api/changelog の答えの字（焼いた版が中身の版と同じときだけ）
pub fn changelog(program: &Path) -> Option<Vec<u8>> {
    static MEMO: OnceLock<Memo> = OnceLock::new();
    let bytes = read_memo(&MEMO, &program.join("app").join("changelog.json"))?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let want = crate::update::program_version(program)?;
    (v["version"].as_str() == Some(want.as_str()) && v["entries"].is_array()).then(|| bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn program(name: &str, version: &str, baked: Option<&str>) -> PathBuf {
        let d = std::env::temp_dir().join(format!("da-small-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("app")).unwrap();
        std::fs::write(d.join("app").join("version.py"), format!("APP_VERSION = \"{version}\"\n")).unwrap();
        if let Some(b) = baked {
            std::fs::write(d.join("app").join("changelog.json"), b).unwrap();
        }
        d
    }

    #[test]
    fn build_is_like_jsonify() {
        let p = program("build", "3.88.0", None);
        assert_eq!(build(&p).unwrap(), b"{\"version\":\"3.88.0\"}\n");
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn changelog_only_when_the_baked_version_is_the_program_version() {
        let body = "{\"entries\":[{\"date\":\"2026-11-07\",\"notes\":[\"\\u7a93\"],\"version\":\"3.88.0\"}],\"version\":\"3.88.0\"}\n";
        let p = program("ok", "3.88.0", Some(body));
        assert_eq!(changelog(&p).unwrap(), body.as_bytes(), "焼いた字をそのまま");
        // 版が違う（前の版へ戻した形）・無い・読めない は Python に任せる
        let old = program("old", "3.87.0", Some(body));
        assert!(changelog(&old).is_none());
        let none = program("none", "3.88.0", None);
        assert!(changelog(&none).is_none());
        let bad = program("bad", "3.88.0", Some("{"));
        assert!(changelog(&bad).is_none());
        // 書き直すと覚えた物を捨てる（大きさが変わる）
        std::fs::write(p.join("app").join("version.py"), "APP_VERSION = \"3.88.10\"\n").unwrap();
        assert!(changelog(&p).is_none(), "中身の版が変わった");
        for d in [p, old, none, bad] {
            let _ = std::fs::remove_dir_all(&d);
        }
    }
}
