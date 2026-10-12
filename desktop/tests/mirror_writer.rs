//! 写しの係（src/mirror.rs）が、共有の書き手（DataRelay）と干渉しないか。Python の program/tests/test_mirror_writer.py と同じ筋書き。
//! DataRelay の公開: 隠しファイル .<名前>.<番号>.incoming を書き切り、置き換え（Windows の MoveFileEx・os.replace と同じ）で
//! 丸ごと入れ替える。ほかが開いていると「使用中」で拒まれ、20 秒粘ってだめなら .pending_ に保留する。
//! Windows の本物の規則は CI（desktop.yml の cargo test）で確かめる。

mod common;

use da_core::mirror::{open_shared, writer_marks, DbMirror};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::time::Duration;

const REPLACE_DEADLINE: f64 = 20.0;
const BACKOFF: [f64; 6] = [0.25, 0.5, 1.0, 1.5, 2.0, 3.0];

fn make_version(path: &Path, n: i64, mb: usize) {
    let _ = std::fs::remove_file(path);
    let mut c = Connection::open(path).unwrap();
    let t = c.transaction().unwrap();
    t.execute_batch("CREATE TABLE V (n INTEGER); CREATE TABLE pad (b BLOB);").unwrap();
    t.execute("INSERT INTO V VALUES (?1)", [n]).unwrap();
    let blob = vec![7u8; 4000];
    for _ in 0..mb * 250 {
        t.execute("INSERT INTO pad VALUES (?1)", [&blob]).unwrap();
    }
    t.commit().unwrap();
}

fn version_of(path: &Path) -> i64 {
    Connection::open(path).unwrap().query_row("SELECT n FROM V", [], |r| r.get(0)).unwrap()
}

/// DataRelay の publish と同じ手順（書きかけを置き、置き換えで入れ替える。だめなら間を空けて粘り、20 秒でだめなら保留）を、
/// 1 回ずつ試せる形にした物（入れ替えの合間に、試験が読み手を動かせるように）。Python の Publish と同じ。
struct Publish {
    incoming: PathBuf,
    dst: PathBuf,
    attempts: usize,
    waited: f64,
}

impl Publish {
    fn new(built: &Path, dst: &Path) -> Publish {
        let incoming = dst.with_file_name(format!(".{}.{}.incoming", dst.file_name().unwrap().to_string_lossy(), std::process::id()));
        std::fs::copy(built, &incoming).unwrap();
        Publish { incoming, dst: dst.to_path_buf(), attempts: 0, waited: 0.0 }
    }
    /// 1 回入れ替えを試す。→ Some(true) 入れ替えた／None まだ（間を空けた。次を試す）／Some(false) 20 秒粘っても入れ替わらず保留した
    fn attempt(&mut self) -> Option<bool> {
        self.attempts += 1;
        if std::fs::rename(&self.incoming, &self.dst).is_ok() {
            return Some(true);
        }
        let wait = BACKOFF[(self.attempts - 1).min(BACKOFF.len() - 1)];
        std::thread::sleep(Duration::from_secs_f64(wait));
        self.waited += wait;
        if self.waited < REPLACE_DEADLINE {
            return None;
        }
        let _ = std::fs::remove_file(&self.incoming);
        Some(false)
    }
    fn run(&mut self) -> bool {
        loop {
            if let Some(done) = self.attempt() {
                return done;
            }
        }
    }
}

#[test]
fn does_not_copy_while_the_writer_is_publishing() {
    let work = common::work("mirror-writer-mark");
    let share = work.join("share");
    std::fs::create_dir_all(&share).unwrap();
    let dst = share.join("実績_CR1.sqlite3");
    make_version(&dst, 0, 1);
    let mark = share.join(".実績_CR1.sqlite3.4242.incoming");
    std::fs::write(&mark, b"x").unwrap();
    let m = DbMirror::new("work_log_CR1", &dst.display().to_string(), &work.join("cache"), 60, 36.0);
    let r = m.refresh();
    assert_eq!((r["busy"].as_bool(), r["updated"].as_bool()), (Some(true), Some(false)), "{r}");
    assert!(m.read_path().is_none(), "写さない・共有も読まない");
    std::fs::remove_file(&mark).unwrap();
    assert_eq!(m.refresh()["updated"], true);
    assert_eq!(version_of(&m.read_path().unwrap()), 0);
    let _ = std::fs::remove_dir_all(&work);
}

/// 写しと DataRelay の公開がぶつかる場面を、毎回同じ順に必ず起こす（6 回とも、読み手が元を開いて写している最中に入れ替えを試みる）。
/// 前はスレッドで休まず写し続けて入れ替えとぶつけていたが、入れ替えが「開いていない一瞬」に当たるかどうかが時の運で、
/// Windows では 20 秒のうちに一度も当たらずに保留になり、落ちることがあった（Python 版で起きた）。順を決めれば時間に左右されない。
#[test]
fn publishing_never_goes_pending_and_copies_are_whole() {
    use std::io::Read;
    let work = common::work("mirror-writer");
    let share = work.join("share");
    std::fs::create_dir_all(&share).unwrap();
    let dst = share.join("実績_CR1.sqlite3");
    make_version(&dst, 0, 1);
    let remote = dst.display().to_string();
    let m = DbMirror::new("work_log_CR1", &remote, &work.join("cache"), 60, 36.0);
    assert_eq!(m.refresh()["updated"], true);
    let mut replaced_while_open = 0;
    for n in 1..=6 {
        let built = work.join(format!("built{n}.sqlite3"));
        make_version(&built, n, 1 + n as usize); // 版ごとに大きさを変える（元の印が必ず変わる）
        let before = std::fs::read(&dst).unwrap();
        let mut reader = open_shared(&remote).unwrap(); // 写しの係と同じ開き方で、写している最中
        let mut got = vec![0u8; before.len() / 2];
        reader.read_exact(&mut got).unwrap();
        let mut p = Publish::new(&built, &dst); // 書き手が書きかけを置いた
        let r = m.refresh();
        assert_eq!(r["updated"], false, "版 {n}: 公開の最中は写さない: {r}");
        let first = p.attempt() == Some(true); // 読み手が開いている最中に入れ替えを試みる
        if !cfg!(windows) {
            assert!(first, "Windows のほかでは、開いていても入れ替えられる");
        }
        reader.read_to_end(&mut got).unwrap();
        drop(reader); // 読み手が写し終えて閉じる
        replaced_while_open += first as usize;
        assert!(got == before, "版 {n}: 写している最中に入れ替わっても、写した物は前の版のまま欠けない");
        assert!(first || p.run(), "版 {n}: 読み手が閉じた後は入れ替わり、保留にならない（{} 回）", p.attempts);
        let r = m.refresh();
        assert_eq!(r["updated"], true, "版 {n}: {r}");
        assert_eq!(version_of(&m.read_path().unwrap()), n, "書き切った版を写す");
    }
    println!(
        "公開 6 回（読み手が開いている最中に入れ替えられた {replaced_while_open} 回・閉じるのを待った {} 回）",
        6 - replaced_while_open
    );
    assert!(writer_marks(&remote).is_empty(), "書きかけが残らない");
    let _ = std::fs::remove_dir_all(&work);
}
