//! 窓が答える問い合わせの振り分け（版 3.118.2。製品の窓〈src/main.rs の native・src/router.rs〉と開発用サーバー〈examples/ui_serve.rs〉が
//! 同じ 1 か所を通る）。窓そのもの（Tauri）に頼る所（/__desktop/*・終了・自己診断の受け口・更新の係）は main.rs に残し、ここは Lot が答える道と
//! 静的ファイル・窓が答えなかった道の断り・Lot の組み立てだけ。中身（Python）の係（src/sidecar.rs）には頼らない（段 ⑤ で消すため）。
//!
//! 順は製品の振り分け（Router::handle）と同じ: answer（窓の係）→ /static/（static_file）→ 門番（Lot::access_check）→ 窓が答えなかった道
//! （window_unanswered）。

use crate::bundle::{Builder, Env};
use crate::lot::Lot;
use crate::presence::PythonNow;
use serde_json::json;
use std::path::{Component, Path};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// 答え（HTTP の答えと同じ中身）。
#[derive(Debug, Clone)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// 窓が受けた問い合わせ（道は送られたまま。百分率符号は戻さない）
pub struct Req<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: &'a str,
    pub body: &'a [u8],
}

/// 振り分けが要る、窓の外の様子（製品は中身の係〈Supervisor〉と desktop.log、開発用サーバーは中身なし）
pub struct Ctx<'a> {
    /// 中身のフォルダ（program。版と更新履歴を読む）
    pub program: &'a Path,
    /// 中身（Python）のいまの様子（待たない。段 ④ から製品はいつも absent）
    pub python_now: &'a dyn Fn() -> PythonNow,
    /// 中身を起こさない形か（段 ④ から製品はいつも真）
    pub absent: bool,
    /// 記録の 1 行（製品は desktop.log）
    pub log: &'a dyn Fn(&str),
}

pub fn error_reply(status: u16, kind: &str, message: &str) -> Reply {
    Reply {
        status,
        headers: vec![("Content-Type".into(), "application/json".into())],
        body: serde_json::to_vec(&json!({"error": message, "kind": kind})).unwrap_or_default(),
    }
}

pub fn json_reply(v: &serde_json::Value) -> Reply {
    Reply {
        status: 200,
        headers: vec![("Content-Type".into(), "application/json".into())],
        // 大きな整数は桁のまま（src/held.rs の持っている値。版 3.108.0。Python の jsonify と同じ）
        body: crate::held::reply_bytes(v),
    }
}

pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

fn engine_python(query: &str) -> bool {
    crate::lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python")
}

/// Lot が答える道（版 3.118.2 に main.rs の native から移した。振る舞いは前のまま）。None はほかへ回す（/static/・門番・window_unanswered）
pub fn answer(lot: &Lot, req: &Req, ctx: &Ctx) -> Option<Reply> {
    match (req.method, req.path) {
        // 版と更新履歴（版 3.88.0。src/small_reads.rs）: Python の準備を待たずに答える。?engine=python・焼いた更新履歴の版が中身と
        // 違う・無いときは Python に任せる
        (method @ ("GET" | "HEAD"), path @ ("/api/build" | "/api/changelog")) => {
            crate::small_reads::reply(method, path, req.query, ctx.program).map(|(headers, body)| Reply { status: 200, headers, body })
        }
        // 生きているか（版 3.102.0。主のセッションの決め 5）: 窓が答え、Python の様子を添える（?engine=python は Python の道＝Python が答えているかの印）
        ("GET", "/api/health") if !engine_python(req.query) => Some(json_reply(&crate::small_reads::health((ctx.python_now)().state))),
        // 心拍（版 3.71.0。利用状況を書き〈裏の糸〉、古い版か・切断されているかを返す。中身が止まっていれば 503＝画面は「未接続」）
        // 版 3.111.0: 中身の様子では断らない（窓が生きていれば 200。python に様子を添える）。様子を尋ねるたびに止まった中身の起こし直しも
        // 始める（Backend::python_now）。最初の心拍は「画面の JS が起きた」合図（入れ替えた直後の確かめ。src/boot.rs）
        ("POST", "/api/heartbeat") => lot.heartbeat(ctx.python_now).map(|(status, v)| Reply { status, ..json_reply(&v) }),
        // 画面（版 3.85.0。src/page.rs）: Python が答えなくても画面の HTML は窓が描く。描けない形は Python へ回す
        // （?engine=python は Python が描く。自己診断が 2 つの画面を突き合わせる）
        (method @ ("GET" | "HEAD"), "/") if !engine_python(req.query) => {
            let py = || (ctx.python_now)().state;
            let mut r = lot.page(method == "HEAD", &py);
            // 束の材料を組めない設定で中身を起こしている最中（版 3.111.0 の作った後の採点の割れ 4）: 3.110.0 と同じく中身の準備を待ち、
            // 起きたら Python に描かせる・止まったら窓が既定の形で描く（前は起動の最初はいつも既定の形〈空の変換表〉で描いた）
            if r.is_none() && lot.page_why().starts_with("束の材料") {
                let t = Instant::now();
                while (ctx.python_now)().state == "starting" && t.elapsed() < Duration::from_secs(130) {
                    std::thread::sleep(Duration::from_millis(200));
                }
                r = lot.page(method == "HEAD", &py);
            }
            let r = r.map(|h| Reply { status: 200, headers: h.headers, body: h.body });
            if r.is_none() {
                (ctx.log)(&format!("PAGE python {}", lot.page_why())); // 窓が画面を描けなかった理由（Python が描く）
                crate::delegate::note("page");
                // 段 ④（版 3.118.0）: 中身は起こさないので、描けない理由を窓の言葉で答える（JSON の 503 でなく、画面に出る字）
                if ctx.absent {
                    let text = format!(
                        "<!doctype html><meta charset=utf-8><title>画面を描けません</title><p>画面を描けません（{}）。開き直しても続くときは、配る人に知らせてください。</p>",
                        html_escape(&lot.page_why())
                    );
                    return Some(Reply {
                        status: 500,
                        headers: vec![("Content-Type".into(), "text/html; charset=utf-8".into())],
                        body: text.into_bytes(),
                    });
                }
            }
            r
        }
        // LotDsp の調べる道具の画面（版 3.98.0）: 窓がただ 1 つの係（Python に任せない。型を描けなければ 500）
        (method @ ("GET" | "HEAD"), "/lotdsp-link") => Some(match lot.lotdsp_page(method == "HEAD") {
            Some(h) => Reply { status: 200, headers: h.headers, body: h.body },
            None => Reply {
                status: 500, ..json_reply(&json!({"error": "調べる道具の画面を描けません（型が読めません）。"}))
            },
        }),
        // 権限の読む 2 本（版 3.76.0。窓の me から答える。中身が答えなければ Python へ回す＝前と同じ失敗）
        // 版 3.111.0: 中身（Python）が止まっていても窓の me で答える（出さないタブ・権限の札・マスタ管理の入口が Python に依らない）
        (method @ "GET", path @ ("/api/access/me" | "/api/masters/access")) => {
            lot.access_read(method, path).map(|(status, v)| Reply { status, ..json_reply(&v) })
        }
        // データ元の並び（版 3.87.0。src/sources_list.rs）: 見出しのタブを Python の準備を待たずに描く
        ("GET", "/api/sources") => lot.sources_list(req.query).map(|(status, v)| Reply { status, ..json_reply(&v) }),
        (method, path) => lot.handle_body(method, path, req.query, req.body).map(|(status, v)| Reply { status, ..json_reply(&v) }),
    }
}

/// 窓の係も /static/ も答えなかった道（中身を起こさない形）: 門番（Lot::access_check。百分率符号を戻した道で見る）を通してから、
/// 窓の言葉で断る（window_unanswered）。製品の Router::handle の中身なしの枝と同じ順（中身へ回す形は Router に残す）
pub fn refuse(lot: &Lot, req: &Req) -> Reply {
    let decoded = percent_decode(req.path);
    match lot.access_check(req.method, &decoded) {
        Err((status, kind, message)) => error_reply(status, kind, &message),
        Ok(_) => window_unanswered(req.method, req.path, &decoded, req.query),
    }
}

/// 窓が答えなかった問い合わせの答え（版 3.118.0。段 ④ の中身へ回していた道の落ち先の 1 か所）。raw は画面が送った道・decoded は百分率符号を
/// 戻した道。戻すと段が増える道（/api/sources/a%2Fb/columns: 戻したキーに / がある）は道なしの 404（前は Python が道なしの 404 で答えた）。
/// ほかは 503 {error, kind: window_unanswered, route: 道の型, why}。回数を数える（形の名前 unanswered <道の型>）
pub fn window_unanswered(method: &str, raw: &str, decoded: &str, query: &str) -> Reply {
    if raw.split('/').count() != decoded.split('/').count() {
        // 形の名前は送った道の型（戻した字は書かない）
        let route = delegate_form(method, raw, query).replacen("python ", "", 1);
        crate::delegate::note(&format!("unanswered_404 {route}"));
        return error_reply(404, "not_found", "ありません。");
    }
    let route = delegate_form(method, decoded, query).replacen("python ", "", 1);
    crate::delegate::note(&format!("unanswered {route}"));
    let mut v = json!({
        "error": "この問い合わせには、まだ窓が答えられません（版 3.118.0 からアプリの中身〈Python〉に回しません）。画面を開き直しても続くときは、配る人に知らせてください。",
        "kind": "window_unanswered",
        "route": route,
        "why": "窓の係が答えない形でした（比べる口 engine=python・窓がまだ同じに読めない形）",
    });
    if route.starts_with("engine_python") {
        v["why"] = json!("engine=python は Python と比べる口です（段 ④ から中身を起こさないので答えません）");
    }
    Reply {
        status: 503,
        headers: vec![("Content-Type".into(), "application/json".into())],
        body: serde_json::to_vec(&v).unwrap_or_default(),
    }
}

/// Python へ回した問い合わせの形の名前（"python GET /api/masters/shifts/{n}" など。?engine=python は自己診断・突き合わせの口なので別の名前）
pub fn delegate_form(method: &str, path: &str, query: &str) -> String {
    if engine_python(query) {
        return format!("engine_python {method}");
    }
    let mut out: Vec<String> = vec![];
    let mut after_src = false;
    for seg in path.split('/') {
        let t = if after_src && !seg.is_empty() {
            "{key}".to_string()
        } else if !seg.is_empty() && seg.chars().all(|c| c.is_ascii_digit()) {
            "{n}".to_string()
        } else if seg.len() > 32 || !seg.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
            "{s}".to_string()
        } else {
            seg.to_string()
        };
        after_src = seg == "src" && out.last().is_some_and(|x| x == "api");
        out.push(t);
    }
    format!("python {method} {}", out.join("/"))
}

/// /static/ の下のファイル。static フォルダの外へは出ない（.. や絶対パスは断る）。
pub fn static_file(root: &Path, rest: &str, query: &str) -> Reply {
    let decoded = percent_decode(rest);
    let rel = Path::new(&decoded);
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return error_reply(404, "not_found", "ありません。");
    }
    match std::fs::read(root.join(rel)) {
        Ok(body) => {
            // 指紋の付いた URL（?v=プログラムの指紋。画面の型の url_for が付ける・app_build.fingerprint）は、
            // 中身が変われば指紋も変わるので長く使い回す。指紋の無い URL は毎回確かめる（Python の答えと同じ no-cache）
            let cache = if query.split('&').any(|kv| kv.starts_with("v=")) { "public, max-age=31536000, immutable" } else { "no-cache" };
            Reply {
                status: 200,
                headers: vec![("Content-Type".into(), mime(&decoded).into()), ("Cache-Control".into(), cache.into())],
                body,
            }
        }
        Err(_) => error_reply(404, "not_found", "ありません。"),
    }
}

pub fn mime(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

pub fn percent_decode(s: &str) -> String {
    let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h << 4 | l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Lot の組み立て（版 3.118.2 に main.rs から移した。製品と開発用サーバーが同じ順で当てる）: 写しは作業場所の db_cache・窓が任せた／断った
/// 回数の記録は作業場所の logs・利用状況に書く版は中身（program）・設定の束は窓が組む（env）。起動の初期値（run_seeds）と見えない Edge の
/// 片付けは製品の窓だけが当てる（開発用サーバーは Python の開発用サーバーと同じく当てない）。
/// 返す 2 つ目は、効かなくなった設定（desktop.lotlist_engine・schedule.fetch_engine の python。記録に 1 行ずつ書く）
pub fn lot_for(env: Env, program: &Path) -> (Arc<Lot>, Vec<String>) {
    let local = env.local.clone();
    // 品質異常（写しは作業場所の db_cache・Python と同じ台帳）
    let lot = Arc::new(Lot::new(local.join("db_cache")));
    // 窓が Python に任せた・断った回数（形の名前と回数だけ。版 3.102.0。src/delegate.rs）
    crate::delegate::set_dir(local.join("logs"));
    lot.set_program(program.to_path_buf()); // 利用状況に書く版（中身の版。更新で入れ替わる）
    let builder = Builder::new(env);
    // Python へ戻す設定（desktop.lotlist_engine・schedule.fetch_engine の python）は段 ④（版 3.118.0）から効かない（利用者の決め: 黙って窓が係・記録に 1 行）
    let retired = crate::bundle::retired_settings(&builder.read_settings().0);
    lot.set_bundle(builder);
    (lot, retired)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn forms_name_only_the_route() {
        assert_eq!(delegate_form("PUT", "/api/masters/shifts/12", ""), "python PUT /api/masters/shifts/{n}");
        assert_eq!(delegate_form("GET", "/api/src/仕掛/slicer", "column=a"), "python GET /api/src/{key}/slicer");
        assert_eq!(delegate_form("GET", "/api/sources/秘密の名前/columns", ""), "python GET /api/sources/{s}/columns");
        assert_eq!(delegate_form("GET", "/api/lotlist", "engine=python&page=2"), "engine_python GET");
    }

    /// 版 3.118.2（採点 first_fixes 2・3）: 振り分けの 1 か所が、移す前の main.rs の native と同じ道を同じ係へ回し、Lot の組み立ての
    /// 作業場所（Env.local）と画面の控えの置き場（Lot の local_root）が同じ（POST /api/ui-state の後に GET / の TPA_UI_STATE に載る）
    #[test]
    fn the_shell_answers_the_window_routes_and_lot_for_keeps_one_local_root() {
        let work = std::env::temp_dir().join(format!("da-shell-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        for d in [work.join("local"), work.join("base").join("data")] {
            std::fs::create_dir_all(d).unwrap();
        }
        let program = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        std::fs::write(&cfg, json!({"master_share": {"dir": ""}, "desktop": {"lotlist_engine": "python"}}).to_string()).unwrap();
        let env = Env { base: work.join("base"), program: program.clone(), local: work.join("local"), config: cfg, now: None };
        let (lot, retired) = lot_for(env, &program);
        assert_eq!(retired.len(), 1, "効かなくなった設定を 1 行: {retired:?}");
        let python_now = PythonNow::absent;
        let lines = std::sync::Mutex::new(vec![]);
        let log = |l: &str| lines.lock().unwrap().push(l.to_string());
        let ctx = Ctx { program: &program, python_now: &python_now, absent: true, log: &log };
        let ask = |method: &str, path: &str, query: &str, body: &[u8]| answer(&lot, &Req { method, path, query, body }, &ctx);
        // 版と更新履歴・生きているか・心拍・画面・調べる道具・権限の読む 2 本・データ元の並び・窓の読む道（handle_body）
        for (method, path, query, status, ctype) in [
            ("GET", "/api/build", "", 200, "application/json"),
            ("GET", "/api/health", "", 200, "application/json"),
            ("POST", "/api/heartbeat", "", 200, "application/json"),
            ("GET", "/", "", 200, "text/html; charset=utf-8"),
            ("HEAD", "/", "", 200, "text/html; charset=utf-8"),
            ("GET", "/lotdsp-link", "", 200, "text/html; charset=utf-8"),
            ("GET", "/api/access/me", "", 200, "application/json"),
            ("GET", "/api/masters/access", "", 200, "application/json"),
            ("GET", "/api/sources", "", 200, "application/json"),
            ("GET", "/api/config", "", 200, "application/json"),
            ("GET", "/api/ui-state", "", 200, "application/json"),
        ] {
            let r = ask(method, path, query, b"").unwrap_or_else(|| panic!("{method} {path} は窓が答える"));
            let ct = r.headers.iter().find(|(k, _)| k == "Content-Type").map(|(_, v)| v.as_str()).unwrap_or("");
            assert_eq!(
                (r.status, ct),
                (status, ctype),
                "{method} {path}: {}",
                String::from_utf8_lossy(&r.body).chars().take(200).collect::<String>()
            );
            if method == "HEAD" {
                assert!(r.body.is_empty(), "HEAD は本文なし");
            }
        }
        // ?engine=python の生きているか・画面は窓の係ではない（ほかへ回す: refuse が 503 window_unanswered）
        assert!(ask("GET", "/api/health", "engine=python", b"").is_none());
        assert!(ask("GET", "/", "engine=python", b"").is_none());
        let no = refuse(&lot, &Req { method: "GET", path: "/api/no-such-route", query: "", body: b"" });
        assert_eq!(no.status, 503);
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&no.body).unwrap()["kind"], "window_unanswered");
        let slash = refuse(&lot, &Req { method: "GET", path: "/api/sources/a%2Fb/columns", query: "", body: b"" });
        assert_eq!(slash.status, 404, "戻したキーに / がある道は道なしの 404");
        // 静的ファイル（置き場は page::static_dir の 1 か所）
        let js = static_file(&crate::page::static_dir(&program), "js/app.js", "v=1");
        assert_eq!((js.status, js.headers[0].1.as_str()), (200, "text/javascript; charset=utf-8"));
        assert_eq!(static_file(&crate::page::static_dir(&program), "../templates/index.html", "").status, 404, "static の外へ出ない");
        // 画面の控え: 書いた控えが、同じ Lot の画面（GET /）の TPA_UI_STATE に載る（Env.local と local_root が同じ）
        let body = br#"{"changed": {"tpa.shell.v1": "{\"a\": 1}"}, "removed": []}"#;
        assert_eq!(ask("POST", "/api/ui-state", "", body).map(|r| r.status), Some(200));
        assert!(work.join("local").join("ui_state.json").exists(), "控えは Env.local の下");
        let page = String::from_utf8(ask("GET", "/", "", b"").unwrap().body).unwrap();
        assert!(page.contains("tpa.shell.v1"), "画面の TPA_UI_STATE に載る");
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn decode() {
        assert_eq!(percent_decode("a%20b%E6%97%A5"), "a b日");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(percent_decode("%日本"), "%日本", "% の後ろが文字でも落ちない");
        assert_eq!(percent_decode("a%4"), "a%4");
    }
}
