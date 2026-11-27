//! 変換表の履歴（版 3.125.0）の「戻すと何が変わるか」を、窓（src/conv_history.rs の diff_tables）が人の書いた答えと同じに数えるか（評価関数）。
//! 事例の表は program/tests/fixtures/conv_backup_cases.json（人が仕様から書いた: 表ごとの st・行の数・行ごとの add/del/chg と出す値）。
//! 本物の画面と道の側は program/tools/ui-eval-convbackup.mjs が、サーバーの答えと画面とは別に数えた答えを比べる。

use da_core::conv_history::diff_tables;
use serde_json::Value;

const CASES: &str = include_str!("../../program/tests/fixtures/conv_backup_cases.json");

#[test]
fn diff_matches_the_hand_written_cases() {
    let t: Value = serde_json::from_str(CASES).expect("事例の表を読めません");
    let cases = t["cases"].as_array().expect("cases");
    assert!(cases.len() >= 9, "事例が少ない: {}", cases.len());
    let mut bad = vec![];
    for c in cases {
        let only: Option<Vec<String>> = c["only"].as_array().map(|a| a.iter().map(|x| x.as_str().unwrap().to_string()).collect());
        let got = diff_tables(c["now"].as_array().unwrap(), c["then"].as_array().unwrap(), only.as_deref(), c["full"].as_bool().unwrap());
        let got = Value::Array(got);
        if got != c["want"] {
            bad.push(format!("{}\n  答え {}\n  窓   {}", c["name"], c["want"], got));
        }
    }
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 時点の置き場の決まり: 自動は同じ中身なら増えず・50 個まで・読めない名前と中身は読み飛ばす・手で取った物は消さない
#[test]
fn points_keep_generations_and_skip_broken_files() {
    use da_core::conv_history::{ids, read_point, write_point, AUTO_KEEP};
    use serde_json::json;
    let d = std::env::temp_dir().join(format!("tpa-convhist-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    let by = json!({"pc": "PC-01", "login": "u"});
    let row = |n: i64| json!({"id": 1, "名前": "A", "判定": format!("[{{\"when\": {{}}, \"out\": \"{n}\"}}]")});
    let m = write_point(&d, &by, "手で", false, json!("all"), &[row(0)], &[]).unwrap();
    let a1 = write_point(&d, &by, "自動", true, json!(["A"]), &[row(1)], &[]).unwrap();
    let again = write_point(&d, &by, "自動", true, json!(["A"]), &[row(1)], &[]).unwrap();
    assert_eq!(a1, again, "同じ中身の自動の時点は増やさない");
    for n in 2..(AUTO_KEEP as i64 + 10) {
        write_point(&d, &by, "自動", true, json!(["A"]), &[row(n)], &[]).unwrap();
    }
    let all = ids(&d);
    assert_eq!(all.iter().filter(|i| i.ends_with("-a")).count(), AUTO_KEEP, "自動は {AUTO_KEEP} 個まで");
    assert!(all.contains(&m), "手で取った物は消さない");
    assert!(!all.contains(&a1), "古い自動の時点は消える");
    // 壊れたファイル・形の違うファイル・名前の読めないファイルは読み飛ばす
    std::fs::write(d.join("20990101-000000-000000-ffffff-a.json"), b"{not json").unwrap();
    std::fs::write(d.join("20990101-000000-001000-eeeeee-a.json"), br#"{"kind":"other"}"#).unwrap();
    std::fs::write(d.join("Bad Name.json"), b"{}").unwrap();
    assert!(read_point(&d, "20990101-000000-000000-ffffff-a").is_none());
    assert!(read_point(&d, "20990101-000000-001000-eeeeee-a").is_none());
    assert!(read_point(&d, "../x").is_none(), "フォルダの外は指せない");
    assert!(!ids(&d).iter().any(|i| i.contains(' ')));
    assert!(read_point(&d, &m).is_some());
    let _ = std::fs::remove_dir_all(&d);
}

/// 保存で自動の時点を残すか（版 3.127.0）: 中身（行の版・書いた時刻・書いた人を除く）が変わる保存だけ残す。
/// 変えずに「この表を保存」を押すと「今と同じ」時点が並びの頭を占めていた（3.125.0 の作った後の採点の指摘）
#[test]
fn saving_without_changes_keeps_no_point() {
    use da_core::conv_history::changes_content;
    let t: Value = serde_json::from_str(CASES).expect("事例の表を読めません");
    let cases = t["keep"].as_array().expect("keep");
    assert!(cases.len() >= 6, "事例が少ない: {}", cases.len());
    let mut bad = vec![];
    for c in cases {
        let got = changes_content(c["before"].as_array().unwrap(), c["after"].as_array().unwrap());
        if Value::Bool(got) != c["want"] {
            bad.push(format!("{}: 答え {} 窓 {got}", c["name"], c["want"]));
        }
    }
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}
