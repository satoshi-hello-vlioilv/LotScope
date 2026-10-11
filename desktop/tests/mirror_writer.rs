//! 写しの係（src/mirror.rs）が、共有の書き手（DataRelay）と干渉しないか。Python の program/tests/test_mirror_writer.py と同じ筋書き。
//! DataRelay の公開: 隠しファイル .<名前>.<番号>.incoming を書き切り、置き換え（Windows の MoveFileEx・os.replace と同じ）で
//! 丸ごと入れ替える。ほかが開いていると「使用中」で拒まれ、20 秒粘ってだめなら .pending_ に保留する。
//! Windows の本物の規則は CI（desktop.yml の cargo test）で確かめる。

mod common;

use da_core::mirror::{copy_shared, DbMirror};
use rusqlite::Connection;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

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

/// DataRelay の publish と同じ手順。→ (入れ替えた, 試した回数)
fn publish(built: &Path, dst: &Path) -> (bool, usize) {
    let incoming = dst.with_file_name(format!(".{}.{}.incoming", dst.file_name().unwrap().to_string_lossy(), std::process::id()));
    std::fs::copy(built, &incoming).unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut attempts = 0;
    while Instant::now() < deadline {
        attempts += 1;
        if std::fs::rename(&incoming, dst).is_ok() {
            return (true, attempts);
        }
        std::thread::sleep(Duration::from_secs_f64(BACKOFF[(attempts - 1).min(BACKOFF.len() - 1)]));
    }
    let _ = std::fs::remove_file(&incoming);
    (false, attempts)
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

#[test]
fn publishing_never_goes_pending_and_copies_are_whole() {
    let work = common::work("mirror-writer");
    let share = work.join("share");
    std::fs::create_dir_all(&share).unwrap();
    let dst = share.join("実績_CR1.sqlite3");
    make_version(&dst, 0, 1);
    let built: Vec<_> = (1..=6)
        .map(|n| {
            let p = work.join(format!("built{n}.sqlite3"));
            make_version(&p, n, 4);
            p
        })
        .collect();
    let m = DbMirror::new("work_log_CR1", &dst.display().to_string(), &work.join("cache"), 60, 36.0);
    let stop = Arc::new(AtomicBool::new(false));
    let (d2, s2) = (dst.clone(), stop.clone());
    let th = std::thread::spawn(move || {
        let out: Vec<(bool, usize)> = built
            .iter()
            .map(|p| {
                let r = publish(p, &d2);
                std::thread::sleep(Duration::from_millis(200));
                r
            })
            .collect();
        s2.store(true, Ordering::SeqCst);
        out
    });
    let (mut seen, mut busy) = (std::collections::BTreeSet::new(), 0);
    let (remote, scratch) = (dst.display().to_string(), work.join("hammer.bin"));
    while !stop.load(Ordering::SeqCst) {
        let r = m.refresh();
        busy += r["busy"].as_bool().unwrap_or(false) as usize;
        if r["updated"] == true {
            seen.insert(version_of(&m.read_path().unwrap()));
        }
        // 「再読込」は元が変わったときしか写さない（SHARED_READ.md の R2）ので、同じ開き方で写すのを試験の側で
        // 休まず続け、入れ替えとぶつけ続ける（入れ替えの一瞬に開けないことはある。そのときは次の回）
        let _ = copy_shared(&remote, &scratch);
    }
    let results = th.join().unwrap();
    m.refresh();
    seen.insert(version_of(&m.read_path().unwrap()));
    let pending = results.iter().filter(|(ok, _)| !ok).count();
    let retried = results.iter().filter(|(_, a)| *a > 1).count();
    println!(
        "公開 {} 回（入れ替えをやり直した {retried} 回・保留 {pending} 回）・写しで見送った {busy} 回・写した版 {seen:?}",
        results.len()
    );
    assert_eq!(pending, 0, "公開が保留にならない（20 秒のうちに必ず入れ替わる）");
    assert!(seen.iter().all(|n| (0..=6).contains(n)), "書き切った版だけを写す: {seen:?}");
    assert!(seen.contains(&6), "最後の版まで写る");
    let _ = std::fs::remove_dir_all(&work);
}
