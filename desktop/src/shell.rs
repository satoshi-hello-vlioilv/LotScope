//! 窓が答える問い合わせの振り分け（版 3.118.2。製品の窓〈src/main.rs の native・src/router.rs〉と開発用サーバー〈examples/ui_serve.rs〉が
//! 同じ 1 か所を通る）。窓そのもの（Tauri）に頼る所（/__desktop/*・終了・自己診断の受け口・更新の係）は main.rs に残し、ここは Lot が答える道と
//! 静的ファイル・窓が答えなかった道の断り・Lot の組み立てだけ（中身〈Python〉の係は版 3.119.0〈段 ⑤〉で消した）。
//!
//! 順は製品の振り分け（Router::handle）と同じ: answer（窓の係）→ /static/（static_file）→ 門番（Lot::access_check）→ 窓が答えなかった道
//! （window_unanswered）。

use crate::bundle::{Builder, Env};
use crate::lot::Lot;
use crate::presence::PythonNow;
use serde_json::json;
use std::path::{Component, Path};
use std::sync::Arc;

/// 枠の約束の版（/__desktop/info の protocol。版 3.119.0 で中身の係から移した。前の版の配布の画面と CI が読むので値を残す）
pub const PROTOCOL: u64 = 1;
/// 窓が受け持つこと（/__desktop/info の serves。版 3.119.0 で中身の係から移した。版 3.119.0 から窓が全部を受け持つが、前の版の読み手のために
/// 前と同じ並びを載せる）
pub const SERVES: &[&str] =
    &["lotlist", "lists", "access", "presence", "ui_state", "bundle", "release", "schedule", "lotdsp", "place", "seeds"];

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

/// 振り分けが要る、窓の外の様子（製品は desktop.log、開発用サーバーは標準エラー）。中身（Python）の様子は版 3.119.0（段 ⑤）からいつも absent
/// （心拍・/api/health・/__desktop/info の python は前の版の配布の画面と CI が読むので値を残す: presence::PythonNow::absent）
pub struct Ctx<'a> {
    /// 中身のフォルダ（program。版と更新履歴を読む）
    pub program: &'a Path,
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
        // 窓の絵（版 3.118.1。版 3.118.2 の作った後の採点の割れ C5 で main.rs の window_reads からここへ）: WebView2・Chromium が頁ごとに
        // 自分で尋ねる。版 3.117.3 の Python と同じ 404 の画面で答える（窓が答えなかった数に入れない）。開発用サーバーも同じ答え
        (method @ ("GET" | "HEAD"), "/favicon.ico") => {
            crate::small_reads::favicon(method, "/favicon.ico").map(|(headers, body)| Reply { status: 404, headers, body })
        }
        // 版と更新履歴（版 3.88.0。src/small_reads.rs）。?engine=python・焼いた更新履歴の版が中身と違う・無いときは答えない（窓の言葉で断る）
        (method @ ("GET" | "HEAD"), path @ ("/api/build" | "/api/changelog")) => {
            crate::small_reads::reply(method, path, req.query, ctx.program).map(|(headers, body)| Reply { status: 200, headers, body })
        }
        // 生きているか（版 3.102.0）: 窓が答え、中身の様子 absent を添える（前の版の読み手のため。?engine=python は前の版の比べる口で答えない）
        ("GET", "/api/health") if !engine_python(req.query) => Some(json_reply(&crate::small_reads::health(PythonNow::absent().state))),
        // 心拍（版 3.71.0。利用状況を書き〈裏の糸〉、古い版か・切断されているかを返す）。版 3.111.0 から窓が生きていれば 200 で、python に
        // 様子（版 3.119.0 からいつも absent）を添える。最初の心拍は「画面の JS が起きた」合図（入れ替えた直後の確かめ。src/boot.rs）
        ("POST", "/api/heartbeat") => lot.heartbeat(&PythonNow::absent).map(|(status, v)| Reply { status, ..json_reply(&v) }),
        // 画面（版 3.85.0。src/page.rs）: 窓が描く。描けない形は理由を窓の言葉で答える（JSON の 503 でなく、画面に出る字）
        // （?engine=python は前の版の比べる口で答えない）
        (method @ ("GET" | "HEAD"), "/") if !engine_python(req.query) => {
            let py = || PythonNow::absent().state;
            let r = lot.page(method == "HEAD", &py).map(|h| Reply { status: 200, headers: h.headers, body: h.body });
            if r.is_none() {
                (ctx.log)(&format!("PAGE {}", lot.page_why())); // 窓が画面を描けなかった理由
                crate::delegate::note("page");
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

/// 開発用サーバー（examples/ui_serve.rs。撮る・採点する道具の相手）の振り分け（版 3.118.2 の作った後の採点の割れ C5・C6・C12 で
/// example から lib へ。試験〈下の tests と main.rs の bin の試験〉が製品の振り分けと突き合わせる）。製品の native の頭と同じ順:
/// 窓そのもの（Tauri）だけが答える /__desktop/* は 404（撮る台本が Playwright で作り物を返す）・POST /api/shutdown は使い終わり
/// （Lot::leave: いま使っているの印を消し、記録を書き切る。製品と同じ）の後に 200 で答え、待ち受けは続ける（撮る道具が「終了」を押しても
/// 次の頁を開ける）→ answer（窓の係。窓の絵も）→ /static/ → refuse（門番 → window_unanswered）。答えた係はいつも "shell"（X-TPA-By）
pub fn dev_route(lot: &Lot, req: &Req, ctx: &Ctx, static_dir: &Path) -> Reply {
    if req.path.starts_with("/__desktop/") {
        return error_reply(404, "not_found", "開発用サーバーは窓の操作に答えません。");
    }
    if (req.method, req.path) == ("POST", "/api/shutdown") {
        lot.leave();
        return json_reply(&json!({"ok": true}));
    }
    if let Some(r) = answer(lot, req, ctx) {
        return r;
    }
    if let (true, Some(rest)) = (req.method == "GET" || req.method == "HEAD", req.path.strip_prefix("/static/")) {
        return static_file(static_dir, rest, req.query);
    }
    refuse(lot, req)
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
        let route = delegate_form(method, raw, query);
        crate::delegate::note(&format!("unanswered_404 {route}"));
        return error_reply(404, "not_found", "ありません。");
    }
    let route = delegate_form(method, decoded, query);
    crate::delegate::note(&format!("unanswered {route}"));
    let mut v = json!({
        "error": "この問い合わせには、アプリの窓が答えられません。画面を開き直しても続くときは、配る人に知らせてください。",
        "kind": "window_unanswered",
        "route": route,
        "why": "窓の係が答えない形でした（窓に無い道・窓が読めない形）",
    });
    if route.starts_with("engine_python") {
        v["why"] = json!("engine=python は前の版の比べる口です（版 3.119.0 で中身を消したので答えません）");
    }
    Reply {
        status: 503,
        headers: vec![("Content-Type".into(), "application/json".into())],
        body: serde_json::to_vec(&v).unwrap_or_default(),
    }
}

/// 窓が答えなかった問い合わせの形の名前（"GET /api/masters/shifts/{n}" など。?engine=python は前の版の比べる口なので別の名前）
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
    format!("{method} {}", out.join("/"))
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
        assert_eq!(delegate_form("PUT", "/api/masters/shifts/12", ""), "PUT /api/masters/shifts/{n}");
        assert_eq!(delegate_form("GET", "/api/src/仕掛/slicer", "column=a"), "GET /api/src/{key}/slicer");
        assert_eq!(delegate_form("GET", "/api/sources/秘密の名前/columns", ""), "GET /api/sources/{s}/columns");
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
        let lines = std::sync::Mutex::new(vec![]);
        let log = |l: &str| lines.lock().unwrap().push(l.to_string());
        let ctx = Ctx { program: &program, log: &log };
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

    /// 版 3.118.2 の作った後の採点の割れ C5・C6: 開発用サーバーの振り分け（dev_route）は、窓の絵を製品と同じ 404 の画面で答えて
    /// 窓が答えなかった数に入れず、POST /api/shutdown で使い終わり（Lot::leave: いま使っているの印を消す）をしてから 200 で答え、
    /// /__desktop/* は 404（撮る台本の作り物が答える）
    #[test]
    fn the_dev_route_answers_the_favicon_and_leaves_on_shutdown() {
        let work = std::env::temp_dir().join(format!("da-shell-dev-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        for d in [work.join("local"), work.join("base").join("data")] {
            std::fs::create_dir_all(d).unwrap();
        }
        let program = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program");
        let cfg = work.join("config.json");
        std::fs::write(&cfg, json!({"master_share": {"dir": ""}}).to_string()).unwrap();
        let env = Env { base: work.join("base"), program: program.clone(), local: work.join("local"), config: cfg, now: None };
        let (lot, _) = lot_for(env, &program);
        let log = |_: &str| {};
        let ctx = Ctx { program: &program, log: &log };
        let sd = crate::page::static_dir(&program);
        let go = |method: &str, path: &str| dev_route(&lot, &Req { method, path, query: "", body: b"{}" }, &ctx, &sd);
        let icon = go("GET", "/favicon.ico");
        assert_eq!(
            (icon.status, icon.body),
            (404, crate::small_reads::favicon("GET", "/favicon.ico").unwrap().1),
            "窓の絵は製品と同じ画面"
        );
        assert!(!crate::delegate::unanswered_map().as_object().unwrap().keys().any(|k| k.contains("favicon")), "窓の絵は数えない");
        assert_eq!(go("GET", "/__desktop/install").status, 404);
        // いま使っているの印（利用状況の置き場の <鍵>.json）が心拍で置かれ、終了で消える
        let marks = || -> Vec<std::path::PathBuf> {
            let mut out = vec![];
            let mut stack = vec![work.clone()];
            while let Some(d) = stack.pop() {
                for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        stack.push(p);
                    } else if p.parent().is_some_and(|d| d.ends_with("presence")) && p.extension().is_some_and(|x| x == "json") {
                        out.push(p);
                    }
                }
            }
            out
        };
        assert_eq!(go("POST", "/api/heartbeat").status, 200);
        // 利用状況は裏の糸が書く（版 3.71.0）
        let t = std::time::Instant::now();
        while marks().is_empty() && t.elapsed() < std::time::Duration::from_secs(10) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let before = marks();
        assert!(
            !before.is_empty(),
            "心拍でいま使っているの印: {:?}",
            std::fs::read_dir(work.join("local")).map(|d| d.flatten().map(|e| e.path()).collect::<Vec<_>>())
        );
        let bye = go("POST", "/api/shutdown");
        assert_eq!((bye.status, serde_json::from_slice::<serde_json::Value>(&bye.body).unwrap()), (200, json!({"ok": true})));
        let gone: Vec<_> = before.iter().filter(|p| !p.exists()).collect();
        assert!(!gone.is_empty(), "終了で印を消す（使い終わり）: 前 {before:?} 後 {:?}", marks());
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
