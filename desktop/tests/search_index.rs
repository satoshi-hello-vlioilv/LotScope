//! 全列の検索の索引（版 3.66.0。src/search_index.rs）が、今の形（表の全列に CStr LIKE）と同じ行に当たるか。
//! 試験の品質データ（tests/lotlist_fixture.py）の実際の値から切り出した語・日本語・大小・数・% _ \ * ?（全角も）・~*・つなぎの字で、
//! 当たる行の番号の並びを突き合わせる。索引が使われる語では索引の式になること、ビュー・WITHOUT ROWID の表は今の形に戻ること、
//! データが書き換わったら索引を作り直すことも確かめる。

mod common;

use da_core::lotlist;
use rusqlite::types::Value as SqlValue;
use rusqlite::Connection;
use std::path::Path;

fn columns(c: &Connection, t: &str) -> Vec<String> {
    c.prepare(&format!("PRAGMA table_info(\"{t}\")"))
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .map(|x| x.unwrap())
        .collect()
}

fn rows(c: &Connection, t: &str, w: &str, p: &[SqlValue]) -> Vec<i64> {
    let sql = format!("SELECT rowid FROM \"{t}\" WHERE {w} ORDER BY rowid");
    c.prepare(&sql).unwrap().query_map(rusqlite::params_from_iter(p.iter()), |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect()
}

/// rowid の無い表（ビュー）も比べられる形: 当たった行の全列の字の並び
fn row_texts(c: &Connection, t: &str, cs: &[String], w: &str, p: &[SqlValue]) -> Vec<String> {
    let cat = cs.iter().map(|x| format!("CStr(\"{x}\")")).collect::<Vec<_>>().join(" || '|' || ");
    let sql = format!("SELECT {cat} FROM \"{t}\" WHERE {w} ORDER BY 1");
    c.prepare(&sql).unwrap().query_map(rusqlite::params_from_iter(p.iter()), |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect()
}

/// 今の形（全列に CStr LIKE。索引を使わない）
fn plain(cs: &[String], q: &str) -> (String, Vec<SqlValue>) {
    let pat = lotlist::like_pattern(q, "contains").0;
    (
        format!("({})", cs.iter().map(|x| format!("CStr(\"{x}\") LIKE ? ESCAPE '\\'")).collect::<Vec<_>>().join(" OR ")),
        cs.iter().map(|_| SqlValue::Text(pat.clone())).collect(),
    )
}

fn check(db: &Path, t: &str, terms: &[String], expect_index: bool, bad: &mut Vec<String>) -> usize {
    let c = lotlist::connect_ro(db).unwrap();
    let cs = columns(&c, t);
    let mut used = 0;
    for q in terms {
        let (w, p) = lotlist::search_part(&c, t, &cs, q);
        let (w0, p0) = plain(&cs, q);
        let (a, b) = (row_texts(&c, t, &cs, &w, &p), row_texts(&c, t, &cs, &w0, &p0));
        if w.contains("rowid IN") {
            used += 1;
        }
        if a != b {
            bad.push(format!("{t} 「{q}」: 索引 {} 行 / 今の形 {} 行", a.len(), b.len()));
        }
        if !expect_index && w.contains("rowid IN") {
            bad.push(format!("{t} 「{q}」: 索引を使えない表で索引を使った"));
        }
    }
    used
}

#[test]
fn search_index_finds_the_same_rows() {
    let dir = common::work("search-index");
    da_core::search_index::set_dir(dir.join("search_index"));
    let db = dir.join("q.sqlite3");
    let out = std::process::Command::new(std::env::var("TPA_PYTHON").unwrap_or_else(|_| {
        if cfg!(windows) {
            "python".into()
        } else {
            "python3".into()
        }
    }))
    .arg(common::program().join("tests").join("lotlist_fixture.py"))
    .arg(&db)
    .arg("3000")
    .output()
    .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let t = "仕掛";
    // 実際の値から語を切り出す（列ごとに先頭の 40 行から、2〜4 字の部分）
    let mut terms: Vec<String> = vec![];
    {
        let c = Connection::open(&db).unwrap();
        // 空欄・数・大小・記号の行を足す（NULL・数の書き方・% _ \ * ? を含む値）
        c.execute_batch(&format!(
            "UPDATE \"{t}\" SET 備考 = NULL WHERE rowid % 7 = 0;
             UPDATE \"{t}\" SET 備考 = 'Abc 100% ok_1 \\ a*b c?d ＊全角' WHERE rowid % 11 = 0;
             UPDATE \"{t}\" SET 備考 = 1.5 WHERE rowid % 13 = 0;
             UPDATE \"{t}\" SET 備考 = 20 WHERE rowid % 17 = 0;"
        ))
        .unwrap();
        let cs = columns(&c, t);
        for col in &cs {
            let vals: Vec<String> = c
                .prepare(&format!("SELECT CAST(\"{col}\" AS TEXT) FROM \"{t}\" WHERE \"{col}\" IS NOT NULL LIMIT 40"))
                .unwrap()
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .flatten()
                .collect();
            for (i, v) in vals.iter().enumerate().step_by(9) {
                let ch: Vec<char> = v.chars().collect();
                let n = 2 + i % 3;
                if ch.len() >= n {
                    terms.push(ch[ch.len() / 3..(ch.len() / 3 + n).min(ch.len())].iter().collect());
                }
            }
        }
    }
    for x in [
        "汚れ",
        "A5052",
        "a5052",
        "ABC",
        "abc",
        "100%",
        "ok_1",
        "\\",
        "%",
        "_",
        "1.5",
        ".5",
        "20",
        "0",
        "a*b",
        "c?d",
        "＊全角",
        "~*",
        "a~*b",
        "全角",
        "缶材",
        "存在しない語",
        "\u{1f}",
        "a\u{1f}b",
        "ｃ",
        "Ｃ",
    ] {
        terms.push(x.to_string());
    }
    terms.sort();
    terms.dedup();
    let mut bad = vec![];
    let used = check(&db, t, &terms, true, &mut bad);
    assert!(used * 2 > terms.len(), "多くの語で索引を使う（{used} / {}）", terms.len());
    // * ? を使う語・つなぎの字の語は索引を使わない（今の形）
    {
        let c = lotlist::connect_ro(&db).unwrap();
        let cs = columns(&c, t);
        for q in ["a*b", "c?d", "＊全角", "a\u{1f}b"] {
            assert!(!lotlist::search_part(&c, t, &cs, q).0.contains("rowid IN"), "「{q}」は今の形");
        }
        assert!(lotlist::search_part(&c, t, &cs, "汚れ").0.contains("rowid IN"), "字そのものの語は索引");
    }
    // ビュー・WITHOUT ROWID の表は今の形に戻す（答えは同じ）
    {
        let c = Connection::open(&db).unwrap();
        c.execute_batch(&format!(
            "CREATE VIEW v AS SELECT * FROM \"{t}\";
             CREATE TABLE w (k TEXT PRIMARY KEY, 備考 TEXT) WITHOUT ROWID;
             INSERT INTO w SELECT 'k' || rowid, 備考 FROM \"{t}\";"
        ))
        .unwrap();
    }
    let few: Vec<String> = terms.iter().take(30).cloned().collect();
    check(&db, "v", &few, false, &mut bad);
    {
        let c = lotlist::connect_ro(&db).unwrap();
        let cs = columns(&c, "w");
        for q in &few {
            let (w, _) = lotlist::search_part(&c, "w", &cs, q);
            if w.contains("rowid IN") {
                bad.push(format!("WITHOUT ROWID の表で索引を使った: {q}"));
            }
        }
    }
    // データが書き換わったら索引を作り直す（古い索引の答えを使わない）
    {
        let c = Connection::open(&db).unwrap();
        c.execute(&format!("UPDATE \"{t}\" SET 備考 = '書き換えた語XYZ' WHERE rowid IN (1, 2, 3)"), []).unwrap();
    }
    std::thread::sleep(std::time::Duration::from_millis(20));
    check(&db, t, &["書き換えた語XYZ".to_string(), "汚れ".to_string()], true, &mut bad);
    let c = lotlist::connect_ro(&db).unwrap();
    let cs = columns(&c, t);
    let (w, p) = lotlist::search_part(&c, t, &cs, "書き換えた語XYZ");
    assert_eq!(rows(&c, t, &w, &p), vec![1, 2, 3], "書き換えた後の行に当たる");
    drop(c);
    // 同じ大きさで書き換えて時刻を戻しても、書き換えの回数（見出し）で作り直す
    {
        let before = std::fs::metadata(&db).unwrap().modified().unwrap();
        let c = Connection::open(&db).unwrap();
        c.execute(&format!("UPDATE \"{t}\" SET 備考 = '書き換えた語ABC' WHERE rowid IN (1, 2, 3)"), []).unwrap();
        drop(c);
        std::fs::File::options().write(true).open(&db).unwrap().set_modified(before).unwrap();
        let c = lotlist::connect_ro(&db).unwrap();
        let (w, p) = lotlist::search_part(&c, t, &cs, "書き換えた語ABC");
        assert_eq!(rows(&c, t, &w, &p), vec![1, 2, 3], "時刻を戻しても新しい中身に当たる");
    }
    // 壊れた索引（中を潰した・0 バイト）は消して作り直す（検索が失敗し続けない）
    let idx = dir.join("search_index");
    for how in ["潰す", "空", "半分"] {
        // 新しい列の組で索引を作ってから壊す（電源が落ちた・ディスクの傷の形）
        let sub: Vec<String> = cs.iter().filter(|x| x.as_str() != "備考").cloned().collect();
        let sub: Vec<String> = match how {
            "潰す" => sub,
            "空" => sub[1..].to_vec(),
            _ => sub[2..].to_vec(),
        };
        let c = lotlist::connect_ro(&db).unwrap();
        let before: Vec<_> = std::fs::read_dir(&idx).unwrap().flatten().map(|e| e.path()).collect();
        let (w, _) = lotlist::search_part(&c, t, &sub, "汚れ");
        assert!(w.contains("rowid IN"));
        let made = std::fs::read_dir(&idx).unwrap().flatten().map(|e| e.path()).find(|p| !before.contains(p)).expect("新しい索引");
        drop(c);
        if how == "潰す" {
            let mut b = std::fs::read(&made).unwrap();
            for x in b.iter_mut().skip(4096).take(4096 * 20) {
                *x = 0xA5;
            }
            std::fs::write(&made, b).unwrap();
        } else if how == "空" {
            std::fs::write(&made, b"").unwrap();
        } else {
            let b = std::fs::read(&made).unwrap();
            std::fs::write(&made, &b[..b.len() / 2]).unwrap();
        }
        let c = lotlist::connect_ro(&db).unwrap();
        let (w, p) = lotlist::search_part(&c, t, &sub, "汚れ");
        let (w0, p0) = plain(&sub, "汚れ");
        let n = |w: &str, p: &[SqlValue]| -> i64 {
            c.query_row(&format!("SELECT COUNT(*) FROM \"{t}\" WHERE {w}"), rusqlite::params_from_iter(p.iter()), |r| r.get(0)).unwrap()
        };
        assert_eq!(n(&w, &p), n(&w0, &p0), "{how}: 壊れた索引でも同じ答え");
        assert!(w.contains("rowid IN"), "{how}: 壊れた索引は作り直して使う");
    }
    // 1 つの接続で 2 つの表を検索しても混ざらない
    {
        let c = Connection::open(&db).unwrap();
        c.execute_batch(&format!("CREATE TABLE q2 AS SELECT * FROM \"{t}\" WHERE rowid % 2 = 0;")).unwrap();
        drop(c);
        let c = lotlist::connect_ro(&db).unwrap();
        let cs2 = columns(&c, "q2");
        let (w1, p1) = lotlist::search_part(&c, t, &cs, "汚れ");
        let (w2, p2) = lotlist::search_part(&c, "q2", &cs2, "汚れ");
        for (tt, ccs, w, p) in [(t, &cs, &w1, &p1), ("q2", &cs2, &w2, &p2)] {
            let (w0, p0) = plain(ccs, "汚れ");
            assert_eq!(row_texts(&c, tt, ccs, w, p), row_texts(&c, tt, ccs, &w0, &p0), "{tt}: 2 つ目の表の索引で混ざらない");
        }
    }
    // ATTACH の上限に当たっても、ほかの接続が使える索引を消さない（今の形に戻るだけ）
    {
        let c = lotlist::connect_ro(&db).unwrap();
        let (w, _) = lotlist::search_part(&c, t, &cs, "汚れ");
        assert!(w.contains("rowid IN"));
        drop(c);
        let n_before = std::fs::read_dir(&idx).unwrap().count();
        let c = lotlist::connect_ro(&db).unwrap();
        for i in 0..10 {
            c.execute(&format!("ATTACH DATABASE ':memory:' AS full{i}"), []).unwrap();
        }
        let (w, p) = lotlist::search_part(&c, t, &cs, "汚れ");
        assert!(!w.contains("rowid IN"), "つなげなければ今の形");
        let (w0, p0) = plain(&cs, "汚れ");
        assert_eq!(row_texts(&c, t, &cs, &w, &p), row_texts(&c, t, &cs, &w0, &p0));
        assert_eq!(std::fs::read_dir(&idx).unwrap().count(), n_before, "索引を消さない");
    }
    // 元のファイルが消えた・変わった索引は、次に索引を作るときに片付ける（写しの係が古い版を消した後）
    {
        let gone = dir.join("gone.sqlite3");
        std::fs::copy(&db, &gone).unwrap();
        let c = lotlist::connect_ro(&gone).unwrap();
        let before: Vec<_> = std::fs::read_dir(&idx).unwrap().flatten().map(|e| e.path()).collect();
        assert!(lotlist::search_part(&c, t, &cs, "汚れ").0.contains("rowid IN"));
        let made = std::fs::read_dir(&idx).unwrap().flatten().map(|e| e.path()).find(|p| !before.contains(p)).expect("新しい索引");
        drop(c);
        std::fs::remove_file(&gone).unwrap();
        let c = lotlist::connect_ro(&db).unwrap();
        let sub: Vec<String> = cs[2..].to_vec();
        assert!(lotlist::search_part(&c, t, &sub, "汚れ").0.contains("rowid IN"));
        assert!(!made.exists(), "元が消えた索引を片付けた");
        assert!(std::fs::read_dir(&idx).unwrap().count() >= 2, "使える索引は残す");
    }
    std::fs::remove_dir_all(&dir).ok();
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// カラムの札を覚える（版 3.66.0。pivot::fields）: 2 回目は覚えた答え（数え直さない）・データが書き換われば数え直す・計算列のある札は覚えない
#[test]
fn fields_are_remembered_per_data_file() {
    use da_core::formula::{Calc, Tables};
    use da_core::pivot::{self, Part};
    use std::sync::Arc;
    let dir = common::work("fields-memo");
    let db = dir.join("f.sqlite3");
    {
        let c = Connection::open(&db).unwrap();
        c.execute_batch("CREATE TABLE 仕掛 (ロット番号 TEXT, 合金 TEXT, 重量 REAL); INSERT INTO 仕掛 VALUES ('L1','A5052',1.5),('L2','A1100',2.0),('L3',NULL,3);").unwrap();
    }
    let part = || Part {
        path: db.clone(),
        table: "仕掛".into(),
        preferred_table: String::new(),
        candidates: &[],
        work: None,
        equip: None,
        name: "試験".into(),
        lot_col: None,
    };
    let conv = Arc::new(Tables::from_json(&serde_json::json!({})));
    let kinds = |v: &serde_json::Value, col: &str| {
        v["fields"].as_array().unwrap().iter().find(|x| x["column"] == col).map(|x| x["kinds"].as_i64().unwrap()).unwrap()
    };
    let first = pivot::fields(&part(), None, &conv, 300).unwrap();
    assert_eq!(kinds(&first, "合金"), 3, "A5052・A1100・NULL");
    // 覚えた答えを返す
    let meta = std::fs::metadata(&db).unwrap();
    let again = pivot::fields(&part(), None, &conv, 300).unwrap();
    assert_eq!(again, first, "2 回目は覚えた答え");
    // データが書き換われば（大きさ・時刻が変わる）数え直す
    std::thread::sleep(std::time::Duration::from_millis(20));
    {
        let c = Connection::open(&db).unwrap();
        c.execute_batch("INSERT INTO 仕掛 VALUES ('L4','A3004',4); INSERT INTO 仕掛 SELECT ロット番号, 合金, 重量 FROM 仕掛;").unwrap();
    }
    assert_ne!(std::fs::metadata(&db).unwrap().modified().unwrap(), meta.modified().unwrap(), "書き換えでファイルの時刻が変わった");
    let after = pivot::fields(&part(), None, &conv, 300).unwrap();
    assert_eq!(kinds(&after, "合金"), 4, "書き換えた後は数え直す（A3004 が増えた）");
    // 計算列のある札は覚えない（式で変わる）
    let calc = |f: &str| Calc { formulas: vec![("倍".into(), f.into())], names: vec![] };
    let a = pivot::fields(&part(), Some(&calc("[重量] * 2")), &conv, 300).unwrap();
    let b = pivot::fields(&part(), Some(&calc("[ロット番号]")), &conv, 300).unwrap();
    assert_ne!(a, b, "式が違えば答えも違う（覚えた答えを使わない）");
    std::fs::remove_dir_all(&dir).ok();
}
