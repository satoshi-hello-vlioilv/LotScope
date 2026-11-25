//! CM3 に届かないときの言葉（src/cm3_net.rs）が、人が書いた事例の表 program/tests/fixtures/cm3_net_cases.json と同じか（版 3.117.1）。
//! Python は tests/test_cm3_net_cases.py が同じ表を app/services/cm3_net.py に当てる。

use da_core::cm3_net::{self, Kind};
use serde_json::Value;

fn cases() -> Value {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../program/tests/fixtures/cm3_net_cases.json");
    serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap()
}

fn kind(v: &Value) -> Kind {
    Kind::of_name(v.as_str().unwrap()).unwrap_or_else(|| panic!("知らない種類 {v}"))
}

fn hex(v: &Value) -> u32 {
    u32::from_str_radix(v.as_str().unwrap().trim_start_matches("0x"), 16).unwrap()
}

#[test]
fn words_like_the_table() {
    let t = cases();
    let mut bad = vec![];
    assert_eq!(cm3_net::HINT, t["hint"]);
    assert_eq!(da_core::sysproxy::PAC_NOTE, t["pac"]);
    for c in t["messages"].as_array().unwrap() {
        let got = cm3_net::message(kind(&c["kind"]), c["detail"].as_str().unwrap(), c["note"].as_str().unwrap());
        if got != c["want"] {
            bad.push(format!("messages {}: 表 {} / 窓 {got}", c["kind"], c["want"]));
        }
    }
    for c in t["openssl"].as_array().unwrap() {
        let got = cm3_net::kind_of_openssl(c["text"].as_str().unwrap());
        if got != kind(&c["kind"]) {
            bad.push(format!("openssl {}: 表 {} / 窓 {}", c["name"], c["kind"], got.name()));
        }
    }
    for c in t["schannel"].as_array().unwrap() {
        let got = cm3_net::kind_of_schannel(hex(&c["code"]));
        if got != kind(&c["kind"]) {
            bad.push(format!("schannel {}: 表 {} / 窓 {}", c["name"], c["kind"], got.name()));
        }
    }
    for c in t["schannelText"].as_array().unwrap() {
        let got = cm3_net::os_error_code(c["text"].as_str().unwrap()).map(|n| n as u32);
        let want = (!c["code"].is_null()).then(|| hex(&c["code"]));
        if got != want {
            bad.push(format!("schannelText {}: 表 {want:?} / 窓 {got:?}", c["name"]));
        }
    }
    // 検証の番号ごとの字（OpenSSL 3 と 1.1）が表の種類になる。窓の持つ字の表は、表の verify の節に全部ある（割れ 4）
    let verify = t["verify"].as_array().unwrap();
    for c in verify {
        for k in ["text", "text11"] {
            let Some(text) = c[k].as_str() else { continue };
            let full = format!("error:0A000086:SSL routines:tls_post_process_server_certificate:certificate verify failed:x.c:1: ({text})");
            let got = cm3_net::kind_of_openssl(&full);
            if got != kind(&c["kind"]) {
                bad.push(format!("verify {} {text}: 表 {} / 窓 {}", c["code"], c["kind"], got.name()));
            }
        }
    }
    for (text, k) in cm3_net::OPENSSL_VERIFY {
        let hit = verify
            .iter()
            .any(|c| ["text", "text11"].iter().any(|f| c[*f].as_str().is_some_and(|x| x.to_lowercase() == text)) && kind(&c["kind"]) == k);
        if !hit {
            bad.push(format!("OPENSSL_VERIFY の「{text}」{} が表の verify に無い", k.name()));
        }
    }
    // 窓の持つ schannel の番号の表は、事例の表に全部ある（足すなら表にも）
    for (code, k) in cm3_net::SCHANNEL {
        let hit = t["schannel"].as_array().unwrap().iter().any(|c| hex(&c["code"]) == code && kind(&c["kind"]) == k);
        if !hit {
            bad.push(format!("schannel 0x{code:08X} {} が表に無い", k.name()));
        }
    }
    assert!(bad.is_empty(), "{} 件の食い違い:\n{}", bad.len(), bad.join("\n"));
}

/// 予定の元の答えを窓が読めない形の言葉（版 3.118.0 の作った後の採点の割れ 2）: cm3.rs・cm3_http.rs の py の字が全部、表の unread にあり、
/// 頭（cm3::Unread の種類）をつけた言葉が表と同じ。理由にも言葉にも作り手向けの名前（Python・urllib・http.client・sqlite3 など）が無い
#[test]
fn unread_words_like_the_table() {
    use da_core::cm3::{windowed, Fail, Unread};
    let t = cases();
    let rows = t["unread"].as_array().expect("unread の節");
    let src = |f: &str| std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(f)).unwrap();
    let mut whys: Vec<String> = vec![];
    for f in ["cm3.rs", "cm3_http.rs"] {
        let text = src(f);
        for part in text.split("py(\"").skip(1) {
            let w = part.split('"').next().unwrap().to_string();
            if !whys.contains(&w) {
                whys.push(w);
            }
        }
    }
    let mut bad = vec![];
    let dev = ["Python", "urllib", "http.client", "sqlite3", "Error", "urljoin", "int()", "OverflowError", "ValueError", "窓が"];
    for w in &whys {
        if !rows.iter().any(|r| r["why"] == w.as_str()) {
            bad.push(format!("表に無い理由: {w}"));
        }
    }
    for r in rows {
        let why: &'static str = Box::leak(r["why"].as_str().unwrap().to_string().into_boxed_str());
        let kind = match r["kind"].as_str().unwrap() {
            "url" => Unread::Url,
            "answer" => Unread::Answer,
            "text" => Unread::Text,
            "shape" => Unread::Shape,
            "table" => Unread::Table,
            k => panic!("知らない種類 {k}"),
        };
        let got = windowed(Fail::Unreadable(why), kind).text();
        if got != r["want"].as_str().unwrap() {
            bad.push(format!("{why}: 表 {} / 窓 {got}", r["want"]));
        }
        if let Some(d) = dev.iter().find(|d| got.contains(**d)) {
            bad.push(format!("{why}: 作り手向けの名前「{d}」"));
        }
        if !whys.iter().any(|w| w == why) {
            bad.push(format!("表にあるが窓の字に無い理由: {why}"));
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
    let n = da_core::delegate::counts();
    assert!(n.as_object().unwrap().keys().any(|k| k.starts_with("unanswered schedule ")), "断った回数を数える: {n}");
}

/// 30x の行き先の組み方（版 3.118.0 の作った後の採点の割れ 2）: 表の joins（Python 3.13 の urllib の手順の答え）と窓の cm3_http::join_location が同じ。
/// [IPv6] の名前の URL も分けられる
#[test]
fn joins_like_urllib() {
    let t = cases();
    let mut bad = vec![];
    for c in t["joins"].as_array().expect("joins の節") {
        let (base, loc, want) = (c["base"].as_str().unwrap(), c["loc"].as_str().unwrap(), c["want"].as_str().unwrap());
        let got = da_core::cm3_http::join_location(base, loc);
        if got.as_deref() != Some(want) {
            bad.push(format!("{base} + {loc:?}: Python {want} / 窓 {got:?}"));
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
    let t6 = da_core::cm3_http::target_with("http://[::1]:9085/a?b=1", true).expect("[IPv6] の名前");
    assert_eq!((t6.host.as_str(), t6.port, t6.netloc.as_str(), t6.selector.as_str()), ("::1", 9085, "[::1]:9085", "/a?b=1"));
    let t6 = da_core::cm3_http::target_with("http://[fe80::1]/", true).unwrap();
    assert_eq!((t6.host.as_str(), t6.port), ("fe80::1", 80));
    for bad in ["http://[::1/", "http://[zz]/", "http://[::1]x/", "http://[::1]:99999/"] {
        assert!(da_core::cm3_http::target_with(bad, true).is_err(), "{bad}");
    }
}
