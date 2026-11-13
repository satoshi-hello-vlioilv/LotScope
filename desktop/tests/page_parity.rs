//! 画面と最初の画面の読む道（版 3.85.0。版 3.95.0 から GET /api/update/settings〈src/release_place.rs〉も）: 窓（src/page.rs・bundle.rs の config・dashboard.rs の sources_answer・equip_tree_answer）が、
//! Python の道（routes/system.py の index・config、routes/dashboard.py の dashboard_sources・dashboard_equip_tree）と同じ答えを返すか。
//! program/tests/settings_oracle.py が束の場面と同じフォルダで Python に尋ねた答え（reads）と突き合わせる。窓の Lot には Python が居ない
//! （設定を尋ねると失敗する）形で尋ね、窓が自分で答えた物は 1 字（JSON は値）も違わないこと、答えなかった物（Python に任せる）は
//! Python が答えられない・窓が同じに読めない形だけであることを見る。画面の印（nonce）は @NONCE@ に揃えて比べる。

mod common;

use da_core::bundle::{Builder, Env};
use da_core::lot::Lot;
use serde_json::Value;
use std::path::PathBuf;

const READS: [&str; 7] =
    ["/", "/api/config", "/api/dashboard/sources", "/api/dashboard/equip-tree", "/api/sources", "/api/settings", "/api/update/settings"];

/// 窓が答えない（Python に任せる）場面と道（Python が落ちる・窓が同じ字にできない・窓が同じに読めない形）
// 版 3.98.0: ブラウザの欄（版 3.87.0 から Python に任せていた）は窓も trusted_browser で確かめて答える（場面「ブラウザの欄に値がある」は突き合わせる）
const MUST_DELEGATE: [(&str, &str); 11] = [
    // 版 3.89.0（作った後の採点）: 参照先の値を重ねる配った設定の段が表でない（Python の _set が落ちる）
    ("更新の段が null で参照先に更新の置き場", "/api/settings"),
    // 作った後の採点（版 3.85.0）の割れ
    ("画面の控えの rev が i64 に入らない", "/"),
    ("画面の控えの rev が字の大きな整数", "/"),
    ("画面の控えに対の無い代用字", "/"),
    ("画面の控えに入れ子 130 段", "/"),
    ("LotDsp の学びの cols が null", "/api/config"),
    ("LotDsp の学びの cols が並び", "/api/config"),
    // 版 3.108.0（H2）: 「大きな数・全角の並べ替え」の画面は窓も桁のまま書く（前は変換表の表示順が i64 に入らないので任せた）
    ("心拍の段が null（Python は /api/config で落ちる）", "/api/config"),
    ("max_rows が int() で読めない", "/api/config"),
    ("LotDsp の待つ秒が読めない", "/api/config"),
    ("LotDsp の学びの形が違う", "/api/config"),
    // 版 3.105.0: 「初期設定が共有にまだ無い」の画面は、窓も読むときに最初の版を置いて答える（前は任せた）
];

fn short(v: &Value) -> String {
    v.to_string().chars().take(400).collect()
}

#[test]
fn page_and_first_reads_are_like_python() {
    let work = common::work("page");
    let o = common::python_json("settings_oracle.py", &[work.to_str().unwrap()]);
    let mut bad = vec![];
    let (mut same, mut delegated, mut refused) = (std::collections::BTreeMap::<&str, usize>::new(), 0, 0);
    for sc in o["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        // 配った設定のファイル（GET /api/settings の config_file）: 場面の Python と同じく TRANSFER_APP_CONFIG で指す（版 3.89.0）
        let mut vars = sc["vars"].as_object().unwrap().clone();
        vars.insert("TRANSFER_APP_CONFIG".into(), sc["env"]["config"].clone());
        let saved: Vec<(String, Option<String>)> = vars.keys().map(|k| (k.clone(), std::env::var(k).ok())).collect();
        for (k, v) in &vars {
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
            if py.is_null() {
                // 尋ねていない読み（設備の木は tree の場面だけ）。窓にも尋ねない（版 3.96.0: スケジュールの元に場所がある場面では窓が CM3 へ
                // 取りに行くので、Windows では届かない名前の引きで 1 場面 2 秒ほどかかり、44 場面で CI の時間を 100 秒延ばした）
                continue;
            }
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
                lot.sources_list("").map(|(st, v)| (st, String::new(), v))
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
            // 版 3.102.0: 束の組めない節を使う道は、窓が理由（どのファイル・どの行）を添えて 503 kind settings で断る（ほかの道は答え続ける）。
            // Python は表でない行を飛ばす・窓の読めない字を読むので 200 のことがある。断るのは窓の束に組めない節があるときだけ
            if status == 503 && v["kind"] == "settings" {
                let own = lot.own_bundle().and_then(Result::ok).unwrap_or_default();
                let broken = own["broken"].as_object().cloned().unwrap_or_default();
                let named = v["broken"]
                    .as_array()
                    .is_some_and(|a| !a.is_empty() && a.iter().all(|k| broken.contains_key(k.as_str().unwrap_or(""))));
                if !named || !v["error"].as_str().is_some_and(|e| e.contains("設定を組めません")) {
                    bad.push(format!("{name} {path}: 窓が断ったが束の組めない節と合わない: {} / {}", short(&v), own["broken"]));
                }
                refused += 1;
                continue;
            }
            if must_delegate {
                bad.push(format!("{name} {path}: 窓が答えた（Python に任せるはず）"));
                continue;
            }
            if py.is_null() {
                // 尋ねていない設備の木（tree の場面だけ尋ねる。版 3.96.0 からスケジュールの元に場所があっても窓が答える）
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
            // 大きな整数は窓と同じく桁のまま読む（版 3.108.0。common::json_keep）
            match common::json_keep(text.as_bytes()).ok_or(()) {
                Ok(mut want) => {
                    let mut v = v;
                    if path == "/api/sources" {
                        // 場面の Python は、どの元にも受け身の写しの係を作ってから尋ねる（settings_oracle.py）ので、どの元も写しの様子を比べる
                        // （Python が null・窓が答える、は割れ）。見に行った時刻で決まる物（確かめた・写した時刻・届かない理由・いまからの古さ）
                        // だけは比べない: 窓の写しの係は場面の前の道（画面・設備の木）で動き始めていることがあり、動いている係の値が答え。
                        // 周回の様子のファイル（state.json）を受け身の係が読むことは lot::tests::the_window_answers_the_sources_list
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
    eprintln!("窓が同じに答えた数: {same:?}・Python に任せた数: {delegated}・組めない節で断った数: {refused}");
    for (path, n) in [
        ("/", 15),
        ("/api/config", 15),
        ("/api/dashboard/sources", 15),
        ("/api/dashboard/equip-tree", 2),
        ("/api/settings", 30),
        ("/api/update/settings", 30),
    ] {
        assert!(same.get(path).copied().unwrap_or(0) >= n, "{path} を窓が答えた場面が足りません: {same:?}");
    }
    assert!(bad.is_empty(), "{} か所違います:\n{}", bad.len(), bad.join("\n"));
}
