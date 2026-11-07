//! 画面と最初の画面の読む道（版 3.85.0）: 窓（src/page.rs・bundle.rs の config・dashboard.rs の sources_answer・equip_tree_answer）が、
//! Python の道（routes/system.py の index・config、routes/dashboard.py の dashboard_sources・dashboard_equip_tree）と同じ答えを返すか。
//! program/tests/settings_oracle.py が束の場面と同じフォルダで Python に尋ねた答え（reads）と突き合わせる。窓の Lot には Python が居ない
//! （設定を尋ねると失敗する）形で尋ね、窓が自分で答えた物は 1 字（JSON は値）も違わないこと、答えなかった物（Python に任せる）は
//! Python が答えられない・窓が同じに読めない形だけであることを見る。画面の印（nonce）は @NONCE@ に揃えて比べる。

mod common;

use da_core::bundle::{Builder, Env};
use da_core::lot::Lot;
use serde_json::Value;
use std::path::PathBuf;

const READS: [&str; 5] = ["/", "/api/config", "/api/dashboard/sources", "/api/dashboard/equip-tree", "/api/sources"];

/// 窓が答えない（Python に任せる）場面と道（Python が落ちる・窓が同じ字にできない・窓が同じに読めない形）
const MUST_DELEGATE: [(&str, &str); 13] = [
    // 版 3.87.0: ブラウザの欄は Python が trusted_browser で確かめる
    ("ブラウザの欄に値がある", "/api/sources"),
    // 作った後の採点（版 3.85.0）の割れ
    ("画面の控えの rev が i64 に入らない", "/"),
    ("画面の控えの rev が字の大きな整数", "/"),
    ("画面の控えに対の無い代用字", "/"),
    ("画面の控えに入れ子 130 段", "/"),
    ("LotDsp の学びの cols が null", "/api/config"),
    ("LotDsp の学びの cols が並び", "/api/config"),
    ("大きな数・全角の並べ替え", "/"), // 変換表の表示順が i64 に入らない（窓の JSON の数では書けない）
    ("心拍の段が null（Python は /api/config で落ちる）", "/api/config"),
    ("max_rows が int() で読めない", "/api/config"),
    ("LotDsp の待つ秒が読めない", "/api/config"),
    ("LotDsp の学びの形が違う", "/api/config"),
    ("初期設定が共有にまだ無い", "/"),
];

fn short(v: &Value) -> String {
    v.to_string().chars().take(400).collect()
}

#[test]
fn page_and_first_reads_are_like_python() {
    let work = common::work("page");
    let o = common::python_json("settings_oracle.py", &[work.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut same, mut delegated) = (std::collections::BTreeMap::<&str, usize>::new(), 0);
    for sc in o["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let saved: Vec<(String, Option<String>)> =
            sc["vars"].as_object().unwrap().keys().map(|k| (k.clone(), std::env::var(k).ok())).collect();
        for (k, v) in sc["vars"].as_object().unwrap() {
            // SAFETY: この試験の糸だけが環境を変える（ほかの試験はこの名前を読まない）
            unsafe { std::env::set_var(k, v.as_str().unwrap()) };
        }
        let e = &sc["env"];
        let p = |k: &str| PathBuf::from(e[k].as_str().unwrap());
        let lot = Lot::new(p("local").join("db_cache"));
        lot.set_bundle(Builder::new(Env {
            base: p("base"),
            program: p("program"),
            local: p("local"),
            config: p("config"),
            now: e["now"].as_str().map(String::from),
        }));
        let ask = || -> Result<Value, String> { Err("Python は居ない".into()) };
        for path in READS {
            let py = &sc["reads"][path];
            let got: Option<(u16, String, Value)> = if path == "/" {
                lot.page(false, &|| true).map(|h| {
                    let csp = h.headers.iter().find(|(k, _)| k == "Content-Security-Policy").map(|(_, v)| v.clone()).unwrap_or_default();
                    let nonce = csp.split("nonce-").nth(1).and_then(|x| x.split('\'').next()).unwrap_or("").to_string();
                    let body = String::from_utf8(h.body).unwrap();
                    let heads: serde_json::Map<String, Value> =
                        h.headers.into_iter().map(|(k, v)| (k, Value::String(v.replace(&nonce, "@NONCE@")))).collect();
                    (200, body.replace(&nonce, "@NONCE@"), Value::Object(heads))
                })
            } else if path == "/api/sources" {
                // スケジュールのカードは Python が起きていない形（起こした直後と同じ。場面の Python も CM3 を見に行っていない）
                lot.sources_list("", &ask, &|| None).map(|(st, v)| (st, String::new(), v))
            } else {
                lot.handle_body("GET", path, "", b"", &ask).map(|(st, v)| (st, String::new(), v))
            };
            let must_delegate = MUST_DELEGATE.contains(&(name, path));
            let Some((status, html, v)) = got else {
                delegated += 1;
                // 窓が答えないのは、Python も答えられない・尋ねていない・窓が Python と同じに読めない形（束を組めない場面など）
                if !must_delegate && sc["expect"] == "same" && py.get("status") == Some(&Value::from(200)) && !name.contains("NaN") {
                    bad.push(format!("{name} {path}: 窓が答えない（Python は 200）"));
                }
                continue;
            };
            if must_delegate {
                bad.push(format!("{name} {path}: 窓が答えた（Python に任せるはず）"));
                continue;
            }
            if py.is_null() {
                // 尋ねていない設備の木。スケジュールの元に場所があれば窓は Python に任せるはず（窓は CM3 を数えない）
                let sch = sc["answer"]["lists"]["sources"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|d| d["key"] == "sch" && d["place"].as_str().is_some_and(|p| !p.is_empty()));
                if sch {
                    bad.push(format!("{name} {path}: スケジュールの場所がある設備の木を窓が答えた（Python に任せるはず）"));
                }
                continue;
            }
            if py["status"] != 200 || status != 200 {
                bad.push(format!("{name} {path}: 状態 窓 {status} / Python {}", py["status"]));
                continue;
            }
            *same.entry(path).or_default() += 1;
            let text = py["body"].as_str().unwrap();
            if path == "/" {
                if html != text {
                    let at = html.chars().zip(text.chars()).take_while(|(a, b)| a == b).count();
                    let near = |s: &str| s.chars().skip(at.saturating_sub(40)).take(120).collect::<String>();
                    bad.push(format!("{name} /: 画面の字が違う（{at} 字目）\n  窓     {}\n  Python {}", near(&html), near(text)));
                }
                for (k, want) in py["headers"].as_object().unwrap() {
                    if v.get(k) != Some(want) {
                        bad.push(format!("{name} /: 見出し {k} 窓 {:?} / Python {want}", v.get(k)));
                    }
                }
                continue;
            }
            match serde_json::from_str::<Value>(text) {
                Ok(mut want) => {
                    let mut v = v;
                    if path == "/api/sources" {
                        // 写しの様子のうち、見に行った時刻で決まる物（確かめた・写した時刻・届かない理由・いまからの古さ）は比べない。
                        // 場面の Python は尋ねたときに共有を見に行き、窓の写しの係は場面ごとに起こし直さない。元の場所・写したか・元の時刻・
                        // 間隔・古さのしきいは比べる（窓が写しを受け持つ製品では、窓の写しの係の値が答え）
                        // Python の写しの様子（と行の数）は、そのプロセスが開いた元だけ（ほかは null）。窓はまだ開いていない元も台帳から
                        // 様子を読むので、Python が null の元は窓の答えを比べない（窓がより多く答える）
                        let py_items = want["items"].as_array().cloned().unwrap_or_default();
                        for (i, it) in v["items"].as_array_mut().into_iter().flatten().enumerate() {
                            if py_items.get(i).is_some_and(|p| p["mirror"].is_null()) && it["key"] != "lot" {
                                it["mirror"] = Value::Null;
                                it["rows"] = py_items[i]["rows"].clone();
                            }
                        }
                        for x in [&mut want, &mut v] {
                            for it in x["items"].as_array_mut().into_iter().flatten() {
                                if let Some(m) = it.get_mut("mirror").and_then(Value::as_object_mut) {
                                    for k in ["checkedAt", "copiedAt", "unreachable", "reason", "ageHours"] {
                                        m.remove(k);
                                    }
                                }
                            }
                        }
                    }
                    if let Some(d) = common::diff(&want, &v, "") {
                        bad.push(format!("{name} {path}: {d}\n  窓     {}\n  Python {}", short(&v), short(&want)));
                    }
                }
                Err(_) => bad.push(format!("{name} {path}: Python の答えが JSON でないのに窓が答えた")),
            }
        }
        for (k, v) in &saved {
            match v {
                Some(v) => unsafe { std::env::set_var(k, v) },
                None => unsafe { std::env::remove_var(k) },
            }
        }
    }
    eprintln!("窓が同じに答えた数: {same:?}・Python に任せた数: {delegated}");
    for (path, n) in [("/", 15), ("/api/config", 15), ("/api/dashboard/sources", 15), ("/api/dashboard/equip-tree", 2)] {
        assert!(same.get(path).copied().unwrap_or(0) >= n, "{path} を窓が答えた場面が足りません: {same:?}");
    }
    assert!(bad.is_empty(), "{} か所違います:\n{}", bad.len(), bad.join("\n"));
}
