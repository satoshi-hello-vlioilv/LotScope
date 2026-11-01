//! 異常ロット一覧の速さを測る（Rust）。program/tests/lotlist_bench.py（Python）と同じ問い合わせ・同じ回数。
//!     cargo run --release --example lotbench -- <品質データ.sqlite3>
use da_core::formula::Tables;
use da_core::lotlist::{query, Args, Opts};
use std::sync::Arc;
use std::time::Instant;

/// 計算列で並べ替える問い合わせ（版 3.59.0。式の 5 つの形。program/tests/lotlist_bench.py の CALC と同じ）
const CALC: [(&str, &str); 5] = [
    ("計算列で並べ替え: 四則", "[重量] * 2 + 1"),
    ("計算列で並べ替え: 条件", "if([重量] > 3000, '重', '軽')"),
    ("計算列で並べ替え: 字", "left([ロット番号], 3) + '-' + upper([合金])"),
    ("計算列で並べ替え: 正規表現", "extract([ロット番号], '[0-9]+')"),
    ("計算列で並べ替え: 日付", "datediff([発生日], '2026/10/02', 'd')"),
];

fn main() {
    let db = std::env::args().nth(1).expect("品質データの場所");
    let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 2).unwrap();
    let f = |c: &str, o: &str, v: &str| format!(r#"[{{"column":"{c}","op":"{o}","value":"{v}"}}]"#);
    let cases: Vec<(&str, Args)> = vec![
        ("1ページ目（500行）", Args::default()),
        ("検索「汚れ」（全列）", Args { search: "汚れ".into(), ..Default::default() }),
        (
            "条件2つ（等しい・90日以内）",
            Args {
                filters: r#"[{"column":"不良名","op":"eq","value":"汚れ"},{"column":"発生日","op":"within_days","value":"90"}]"#.into(),
                ..Default::default()
            },
        ),
        ("並べ替え", Args { sorts: r#"[{"column":"重量","dir":"desc"}]"#.into(), ..Default::default() }),
        ("並べ替え（字の列）", Args { sorts: r#"[{"column":"ロット番号","dir":"desc"}]"#.into(), ..Default::default() }),
        ("ロット番号でまとめる＋並べ替え", Args { group: true, sorts: r#"[{"column":"重量","dir":"desc"}]"#.into(), ..Default::default() }),
        ("数で絞る", Args { filters: f("重量", "gte", "3000"), ..Default::default() }),
        (
            "0件（日付の手がかり）",
            Args {
                filters: r#"[{"column":"発生日","op":"within_days","value":"0"},{"column":"設備","op":"eq","value":"無い"}]"#.into(),
                ..Default::default()
            },
        ),
    ];
    let mut cases: Vec<(String, Args)> = cases.into_iter().map(|(n, a)| (n.to_string(), a)).collect();
    for (name, f) in CALC {
        let calc = serde_json::json!({"formulas": {"計": f}, "names": {}}).to_string();
        cases.push((name.into(), Args { calc, sorts: r#"[{"column":"計","dir":"desc"}]"#.into(), ..Default::default() }));
    }
    let tables = Arc::new(Tables::default());
    for (name, a) in &cases {
        let _ = query(db.as_ref(), a, &Opts::quality("", 500), today, &tables, None); // 1回目（日付の列の見分け・OS のキャッシュ）は数えない
        let mut ms: Vec<f64> = (0..5)
            .map(|_| {
                let t = Instant::now();
                let v = query(db.as_ref(), a, &Opts::quality("", 500), today, &tables, None).unwrap();
                let _ = serde_json::to_vec(&v).unwrap();
                t.elapsed().as_secs_f64() * 1000.0
            })
            .collect();
        ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("{name}\t{:.0}", ms[2]);
    }
}
