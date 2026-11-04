//! 全列の検索の索引（版 3.66.0）。一覧・スライサー・集計・稼働の「検索」は、表の全列に `CStr(列) LIKE '%語%'` を当てる（行 × 列ぶん
//! 字に直して比べるので、品質 20,000 行・40 列で 70〜120 ms）。行ごとに全列を `CStr` でつないだ 1 列の表を、写しとは別のファイルに作っておき、
//! 検索はその 1 列に LIKE を当てて当たる行の番号（rowid）で引く（4〜10 ms）。
//!
//! 答えは今と同じ（評価関数: tests/search_index.rs が語ごとに今の形と突き合わせる）:
//! - 語が `*` `?`（全角の ＊ ？ も。いくつかの字・1 字に当たる印）を使うときは使わない（列の境をまたいで当たりうる。今の形のまま）
//! - 列の間は字 U+001F でつなぐ。語にこの字を含むときも使わない
//! - LIKE は 1 字ずつ大小を同じと見る（ASCII だけ）ので、つないでも当たる行は同じ
//! - rowid で引けない表（ビュー・WITHOUT ROWID）は使わない
//!
//! 索引は、窓の作業場所の `search_index` フォルダに置く（写しの係の片付け〈`{key}.g{N}.sqlite3` を版と見る〉とぶつからない名前）。
//! データのファイルの場所・更新時刻・大きさ・SQLite の書き換えの回数（見出しの file change counter）・-wal の時刻と大きさ・表・列が変われば
//! 別の索引になる。初めて検索したときに作り（その回は作る時間がかかる）、裏で前もっては作らない（起動の直後の問い合わせとぶつからない）。
//! 作った索引は書き切ってから名前を替え（電源が落ちても半端な索引を残さない）、窓を起こしてから初めて使うときに中身を確かめる
//! （quick_check・行の数が表と同じ）。壊れていれば消して作り直し、作れない・読めないときは今の形に戻す（答えは同じ・速さだけ戻る）。
//! 1 つの接続で 2 つの表を検索しても混ざらないよう、つなぐ名前は索引ごとに分ける。置き場は新しい物から 32 個・合わせて 1 GB まで。

use rusqlite::types::Value as SqlValue;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};

/// 索引を置くフォルダ（窓が Lot を作るときに決める。決まっていなければ索引を使わない）
static DIR: OnceLock<PathBuf> = OnceLock::new();
/// 同じ索引を 2 つの問い合わせが同時に作らない（索引ごとの錠。別の索引は並んで作れる）
static BUILD: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = LazyLock::new(Default::default);
/// 窓を起こしてから中身を確かめた索引（索引のファイルの時刻と大きさも。あとで書き換わった物は確かめ直す）
static CHECKED: LazyLock<Mutex<HashSet<(PathBuf, String)>>> = LazyLock::new(Default::default);
/// 残す索引の数と、合わせた大きさ（古い物から消す）
const KEEP: usize = 32;
const KEEP_BYTES: u64 = 1 << 30;
/// つなぐ字（語にこの字を含むときは索引を使わない）
const SEP: char = '\u{1f}';

pub fn set_dir(dir: PathBuf) {
    let _ = DIR.set(dir);
}

fn qi(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// 索引を使える表か（本物の表で、rowid を持つ）
fn has_rowid(c: &Connection, table: &str) -> bool {
    c.query_row("SELECT type, COALESCE(sql, '') FROM sqlite_master WHERE name = ?1", [table], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })
    .map(|(kind, sql)| kind == "table" && !sql.to_ascii_uppercase().replace(char::is_whitespace, "").contains("WITHOUTROWID"))
    .unwrap_or(false)
}

/// ファイルの時刻（ns）と大きさ。無ければ空
fn stamp(p: &Path) -> String {
    std::fs::metadata(p)
        .ok()
        .and_then(|m| Some(format!("{}:{}", m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos(), m.len())))
        .unwrap_or_default()
}

/// SQLite の見出しの書き換えの回数（file change counter。24〜27 バイト目）
fn change_counter(p: &Path) -> Option<u32> {
    let mut b = [0u8; 28];
    std::fs::File::open(p).ok()?.read_exact(&mut b).ok()?;
    Some(u32::from_be_bytes([b[24], b[25], b[26], b[27]]))
}

/// 索引のファイルの名前（データ・表・列が変われば別の名前）
fn index_name(c: &Connection, table: &str, cs: &[String]) -> Option<String> {
    let db = PathBuf::from(c.path()?);
    let main = stamp(&db);
    if main.is_empty() {
        return None;
    }
    let wal = stamp(Path::new(&format!("{}-wal", db.display())));
    let mut h = Sha256::new();
    h.update(
        format!("{}\u{1e}{main}\u{1e}{:?}\u{1e}{wal}\u{1e}{table}\u{1e}{}", db.display(), change_counter(&db), cs.join("\u{1e}"))
            .as_bytes(),
    );
    Some(h.finalize().iter().take(12).map(|b| format!("{b:02x}")).collect())
}

/// 索引のファイル（無ければ作る）
fn index_file(c: &Connection, table: &str, cs: &[String], name: &str) -> Option<PathBuf> {
    let dir = DIR.get()?;
    let file = dir.join(format!("search_{name}.sqlite3"));
    if file.exists() {
        return Some(file);
    }
    let lock = BUILD.lock().ok()?.entry(file.clone()).or_default().clone();
    let _guard = lock.lock().ok()?;
    if !file.exists() {
        build(c, table, cs, dir, &file).ok()?;
        prune(dir);
    }
    if let Ok(mut m) = BUILD.lock() {
        m.remove(&file);
    }
    Some(file)
}

fn build(c: &Connection, table: &str, cs: &[String], dir: &Path, file: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = file.with_extension(format!("tmp{}", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    let res = (|| -> rusqlite::Result<()> {
        let mut out = Connection::open(&tmp)?;
        out.execute_batch(
            "PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
             CREATE TABLE b (rid INTEGER PRIMARY KEY, b TEXT NOT NULL); CREATE TABLE m (n INTEGER NOT NULL, src TEXT, stamp TEXT);",
        )?;
        let cat = cs.iter().map(|x| format!("CStr({})", qi(x))).collect::<Vec<_>>().join(&format!(" || char({}) || ", SEP as u32));
        let mut st = c.prepare(&format!("SELECT rowid, {cat} FROM {}", qi(table)))?;
        let mut rows = st.query([])?;
        let tx = out.transaction()?;
        let mut n: i64 = 0;
        {
            let mut ins = tx.prepare("INSERT INTO b (rid, b) VALUES (?1, ?2)")?;
            while let Some(r) = rows.next()? {
                ins.execute(rusqlite::params![r.get::<_, i64>(0)?, r.get::<_, String>(1)?])?;
                n += 1;
            }
        }
        // 行の数は最後に書く（書き終えた印。使う前に表の行の数と比べる）。元のファイルと時刻は片付けで使う
        let src = c.path().unwrap_or_default().to_string();
        tx.execute("INSERT INTO m (n, src, stamp) VALUES (?1, ?2, ?3)", rusqlite::params![n, src, stamp(Path::new(&src))])?;
        tx.commit()?;
        Ok(())
    })();
    let done = res.map_err(|e| e.to_string()).and_then(|()| {
        // 書き切ってから名前を替える（電源が落ちても半端な索引を残さない）
        std::fs::File::open(&tmp).and_then(|f| f.sync_all()).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, file).map_err(|e| e.to_string())
    });
    if done.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    done
}

/// 索引の元のファイルが消えた・変わったか（写しの係が古い版を片付けた後の索引）。中の印（m）を読めない索引（壊れた）も片付ける
fn orphan(file: &Path) -> bool {
    let Ok(c) = Connection::open_with_flags(file, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else { return true };
    c.query_row("SELECT src, stamp FROM m", [], |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?)))
        .map(|(src, st)| matches!((src, st), (Some(src), Some(st)) if !src.is_empty() && stamp(Path::new(&src)) != st))
        .unwrap_or(true)
}

/// 古い索引を消す（元のファイルが消えた・変わった物と、新しい物から KEEP 個・KEEP_BYTES を超えた物。いちばん新しい 1 つは残す）。
/// 落ちた作りかけ（tmp）は 10 分たてば消す
fn prune(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let now = std::time::SystemTime::now();
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = vec![];
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some((t, len)) = e.metadata().ok().and_then(|m| Some((m.modified().ok()?, m.len()))) else { continue };
        if !name.starts_with("search_") {
            continue;
        }
        if name.ends_with(".sqlite3") {
            files.push((t, len, e.path()));
        } else if now.duration_since(t).map(|d| d.as_secs() > 600).unwrap_or(false) {
            let _ = std::fs::remove_file(e.path());
        }
    }
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    let mut total = 0;
    for (i, (_, len, p)) in files.into_iter().enumerate() {
        total += len;
        if i > 0 && (i >= KEEP || total > KEEP_BYTES || orphan(&p)) {
            let _ = std::fs::remove_file(&p);
            if let Ok(mut s) = CHECKED.lock() {
                s.retain(|(f, _)| f != &p);
            }
        }
    }
}

/// つないだ結果
enum Attach {
    /// つないだ（もうつながっていた）
    Ok,
    /// つなげない（ATTACH の上限・一時の錠・同じ名前が別の索引）。索引は消さない
    Busy,
    /// 索引のファイルが壊れている・SQLite のファイルでない（半分に切れた など）。消して作り直す
    Bad,
}

/// 索引をこの接続につなぐ（同じ名前でもうつながっていれば何もしない）
fn attach(c: &Connection, file: &Path, alias: &str) -> Attach {
    let now: Option<String> = c
        .prepare("PRAGMA database_list")
        .and_then(|mut st| {
            let rows = st.query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
            Ok(rows.flatten().find(|(n, _)| n == alias).map(|(_, f)| f))
        })
        .ok()
        .flatten();
    match now {
        Some(f) if Path::new(&f) == file => Attach::Ok,
        Some(_) => Attach::Busy,
        None => match c.execute(&format!("ATTACH DATABASE ?1 AS {alias}"), [file.display().to_string()]) {
            Ok(_) => Attach::Ok,
            Err(rusqlite::Error::SqliteFailure(e, _))
                if matches!(e.code, rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase) =>
            {
                Attach::Bad
            }
            Err(_) => Attach::Busy,
        },
    }
}

/// 索引の中身を確かめる（壊れていない・書き終えている・行の数が表と同じ）。窓を起こしてから索引ごとに 1 回（書き換わればもう 1 回）
fn sound(c: &Connection, table: &str, file: &Path, alias: &str) -> bool {
    let key = (file.to_path_buf(), stamp(file));
    if CHECKED.lock().map(|s| s.contains(&key)).unwrap_or(false) {
        return true;
    }
    let ok = c.query_row(&format!("PRAGMA {alias}.quick_check(1)"), [], |r| r.get::<_, String>(0)).map(|x| x == "ok").unwrap_or(false)
        && match (
            c.query_row(&format!("SELECT n FROM {alias}.m"), [], |r| r.get::<_, i64>(0)),
            c.query_row(&format!("SELECT COUNT(*) FROM {alias}.b"), [], |r| r.get::<_, i64>(0)),
            c.query_row(&format!("SELECT COUNT(*) FROM {}", qi(table)), [], |r| r.get::<_, i64>(0)),
        ) {
            (Ok(n), Ok(b), Ok(t)) => n == b && b == t,
            _ => false,
        };
    if ok {
        if let Ok(mut s) = CHECKED.lock() {
            s.insert(key);
        }
    }
    ok
}

/// 全列の検索の式。索引を使えれば (`表.rowid IN (…)`, 値 1 つ)、使えなければ None（呼ぶ側が今の形を使う）。
/// pattern は今の形と同じ LIKE の型（`like_pattern(語, "contains")`）、wild はその型が * ?（全角も）を使ったか、escape は ESCAPE の句
pub fn clause(
    c: &Connection,
    table: &str,
    cs: &[String],
    q: &str,
    pattern: &str,
    wild: bool,
    escape: &str,
) -> Option<(String, Vec<SqlValue>)> {
    if wild || q.contains(SEP) || cs.is_empty() || DIR.get().is_none() || !has_rowid(c, table) {
        return None;
    }
    let name = index_name(c, table, cs)?;
    let alias = format!("tpa_s{}", &name[..12]);
    // 索引をつなぎ、中身を確かめる。壊れていれば外して消し、1 度だけ作り直す。
    // つなげないだけ（ATTACH の上限・一時の錠）なら、ほかの接続が使える索引を消さずに今の形へ戻す
    let mut ok = false;
    for _ in 0..2 {
        let file = index_file(c, table, cs, &name)?;
        match attach(c, &file, &alias) {
            Attach::Busy => return None,
            Attach::Ok if sound(c, table, &file, &alias) => {
                ok = true;
                break;
            }
            Attach::Ok => {
                let _ = c.execute(&format!("DETACH DATABASE {alias}"), []);
            }
            Attach::Bad => {}
        }
        let _ = std::fs::remove_file(&file);
    }
    if !ok {
        return None;
    }
    Some((format!("{}.rowid IN (SELECT rid FROM {alias}.b WHERE b LIKE ? {escape})", qi(table)), vec![SqlValue::Text(pattern.to_string())]))
}
