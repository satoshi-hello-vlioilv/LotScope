//! この PC の作業場所の名前を変える（版 3.19.0・利用者の決めたこと 2026-10-11: TransferPitchAnalyzer → LotScope）。
//!
//! - どちらを作業場所とするか（choose）: 新しい場所に app があれば新しい場所。無くて前の場所があれば前の場所（移し終えるまで）。
//!   どちらも無ければ新しい場所（新しい PC）。Python（`app_env.local_root`）も同じ決まり。
//! - 移す（move_home）: 前の場所の中身を、1 つずつ名前の付け替えで新しい場所へ移す（写さないので、写しが大きくても一瞬）。
//!   `desktop`（版ごとに写した exe。いま動いている物もある）は移さず、前の場所ごと消す。
//!   app を移せなければ（Python がまだ掴んでいるなど）移した物を前の場所へ戻し、前の場所のまま開く（半端な形で開かない）。
//!   新しい場所に同じ名前の物が既にあれば、前の場所の物は触らずに残す（前の場所は消さない）。

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// 動いている exe の写し（版ごと）。移さない。
const SKIP: &str = "desktop";

/// 作業場所を決める。new＝いまの名前の場所、legacy＝前の名前の場所（新しい順でなくてよい）。
pub fn choose(new: &Path, legacy: &[PathBuf]) -> PathBuf {
    if new.join("app").is_dir() {
        return new.to_path_buf();
    }
    legacy.iter().find(|d| d.is_dir()).cloned().unwrap_or_else(|| new.to_path_buf())
}

/// 名前を付け替える（使用中で断られたら patience のあいだ待ってやり直す）。
fn rename_waiting(from: &Path, to: &Path, patience: Duration) -> std::io::Result<()> {
    let end = Instant::now() + patience;
    loop {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if Instant::now() < end && e.kind() != std::io::ErrorKind::NotFound => {
                let _ = e;
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e),
        }
    }
}

/// 前の場所 from の中身を新しい場所 to へ移す。→ 残した物（新しい場所に同じ名前が既にあった）。
/// app を移せなければ、移した物を戻して Err（前の場所のまま使う）。移し終えたら前の場所を消す（消せなければ次の起動で）。
pub fn move_home(from: &Path, to: &Path, patience: Duration) -> Result<Vec<String>, String> {
    move_with(from, to, &|a, b| rename_waiting(a, b, patience))
}

/// move_home の中身（名前の付け替えを試験で差し替える）。
fn move_with(from: &Path, to: &Path, rename: &dyn Fn(&Path, &Path) -> std::io::Result<()>) -> Result<Vec<String>, String> {
    std::fs::create_dir_all(to).map_err(|e| format!("{} を作れません: {e}", to.display()))?;
    let mut names: Vec<_> = std::fs::read_dir(from)
        .map_err(|e| format!("{} を読めません: {e}", from.display()))?
        .flatten()
        .map(|e| e.file_name())
        .filter(|n| n != SKIP)
        .collect();
    // app を先に（いちばん大事。移せなければ何も移さない）
    names.sort_by_key(|n| n != "app");
    let (mut moved, mut kept) = (vec![], vec![]);
    for n in names {
        let (src, dst) = (from.join(&n), to.join(&n));
        if dst.exists() {
            kept.push(format!("{}（{} に同じ名前があるので残しました）", src.display(), to.display()));
            continue;
        }
        match rename(&src, &dst) {
            Ok(()) => moved.push(n),
            Err(e) => {
                for m in moved.iter().rev() {
                    let _ = std::fs::rename(to.join(m), from.join(m));
                }
                return Err(format!("{} を {} へ移せません（使用中かもしれません）: {e}", src.display(), to.display()));
            }
        }
    }
    if kept.is_empty() {
        let _ = std::fs::remove_dir_all(from);
    }
    Ok(kept)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("da-home-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn choose_new_once_it_has_the_app() {
        let d = tmp("choose");
        let (new, old) = (d.join("LotScope"), d.join("Old"));
        assert_eq!(choose(&new, std::slice::from_ref(&old)), new, "どちらも無い（新しい PC）: 新しい場所");
        std::fs::create_dir_all(old.join("app")).unwrap();
        assert_eq!(choose(&new, std::slice::from_ref(&old)), old, "移す前: 前の場所");
        std::fs::create_dir_all(new.join("desktop")).unwrap();
        assert_eq!(choose(&new, std::slice::from_ref(&old)), old, "移している途中（app がまだ無い）: 前の場所");
        std::fs::create_dir_all(new.join("app")).unwrap();
        assert_eq!(choose(&new, &[old]), new, "app が移れば新しい場所");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn moves_everything_but_the_running_copies_and_removes_the_old_place() {
        let d = tmp("move");
        let (new, old) = (d.join("LotScope"), d.join("Old"));
        for (p, body) in [("app/program/sidecar.py", "#"), ("db_cache/a.sqlite3", "db"), ("install.json", "{}"), ("desktop/1-2/x.exe", "x")]
        {
            let f = old.join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, body).unwrap();
        }
        std::fs::create_dir_all(new.join("desktop")).unwrap(); // 移す係の写しが動いている
        let kept = move_home(&old, &new, Duration::from_millis(10)).unwrap();
        assert!(kept.is_empty(), "{kept:?}");
        assert_eq!(std::fs::read_to_string(new.join("db_cache/a.sqlite3")).unwrap(), "db", "中身はそのまま移る");
        assert!(new.join("app/program/sidecar.py").is_file() && new.join("install.json").is_file());
        assert!(!new.join("desktop/1-2").exists(), "版ごとの写しは移さない");
        assert!(!old.exists(), "前の場所は消す");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn keeps_what_the_new_place_already_has_and_the_old_place_with_it() {
        let d = tmp("keep");
        let (new, old) = (d.join("LotScope"), d.join("Old"));
        std::fs::create_dir_all(old.join("app")).unwrap();
        std::fs::write(old.join("ui_state.json"), "old").unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(new.join("ui_state.json"), "new").unwrap();
        let kept = move_home(&old, &new, Duration::from_millis(10)).unwrap();
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert_eq!(std::fs::read_to_string(new.join("ui_state.json")).unwrap(), "new", "新しい場所の物は上書きしない");
        assert!(old.join("ui_state.json").is_file(), "残した物があれば前の場所は消さない");
        assert!(new.join("app").is_dir());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_failure_puts_back_what_was_moved() {
        let d = tmp("fail");
        let (new, old) = (d.join("LotScope"), d.join("Old"));
        std::fs::create_dir_all(old.join("app")).unwrap();
        std::fs::write(old.join("install.json"), "{}").unwrap();
        // app は移せるが、install.json は使用中で断られる
        let busy = |a: &Path, b: &Path| {
            if a.ends_with("install.json") {
                Err(std::io::Error::other("使用中"))
            } else {
                std::fs::rename(a, b)
            }
        };
        let e = move_with(&old, &new, &busy).unwrap_err();
        assert!(e.contains("install.json") && e.contains("使用中"), "{e}");
        assert!(old.join("app").is_dir() && old.join("install.json").is_file(), "移した app は前の場所へ戻す");
        assert!(!new.join("app").exists());
        assert_eq!(choose(&new, std::slice::from_ref(&old)), old, "前の場所のまま使う（次の起動でまた移す）");
        let _ = std::fs::remove_dir_all(&d);
    }
}
