//! 窓の開発用サーバー（版 3.118.2。撮る・採点する道具〈program/tools/ui-harness.mjs〉の相手。利用者の起動の道ではない）。
//!
//!     cargo run --example ui_serve -- 作業フォルダ [ポート] [--stdin]
//!
//! 製品の窓と同じ lib の振り分け（src/shell.rs: answer → /static/ → 門番 → window_unanswered）と Lot の組み立て（shell::lot_for）で、
//! 窓の答えを HTTP で配る。Tauri の窓は作らない（画面は Playwright の Chromium が開く）。場面（作業フォルダの base・local・
//! appsettings.json）は program/tests/ui_window_scene.py が作り、この実行ファイルを起こす。
//!
//! - 中身（Python）は無い形（製品の段 ④ と同じ absent）。起動の初期値（run_seeds）は当てない（Python の開発用サーバーと同じ）
//! - 窓だけが答える /__desktop/* は 404（撮る台本が Playwright で作り物の答えを返す）。POST /api/shutdown は 200 で答え、待ち受けは続ける
//!   （撮る道具が「終了」を押しても次の頁を開ける）
//! - ポート 0 なら OS が選ぶ。待ち受けを始めたら「LISTEN http://127.0.0.1:ポート」の 1 行を出す
//! - --stdin: 標準入力が閉じたら終わる（起こした台本が落ちても残らない）
//! - この PC の中（127.0.0.1）からだけ答える。書き込みは Origin があれば同じ置き場だけ（Python の開発用サーバー web.foreign_request と同じ）
//! - 1 つのつながりに 1 本の糸・keep-alive なし・本文は 8 MB まで

use da_core::bundle::Env;
use da_core::presence::PythonNow;
use da_core::shell::{self, Ctx, Reply, Req};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const BODY_LIMIT: usize = 8 * 1024 * 1024;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let stdin_watch = args.iter().any(|a| a == "--stdin");
    let rest: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let Some(work) = rest.first().map(PathBuf::from) else {
        eprintln!("使い方: ui_serve 作業フォルダ [ポート] [--stdin]");
        std::process::exit(2);
    };
    let port: u16 = rest.get(1).and_then(|p| p.parse().ok()).unwrap_or(0);
    let program = std::env::var_os("TPA_UI_PROGRAM")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("program"));
    let program = std::fs::canonicalize(&program).unwrap_or(program);
    let env = Env {
        base: work.join("base"),
        program: program.clone(),
        local: work.join("local"),
        config: work.join("appsettings.json"),
        now: std::env::var("TPA_DASHBOARD_NOW").ok().filter(|v| !v.is_empty()),
    };
    let (lot, retired) = shell::lot_for(env, &program);
    for r in retired {
        eprintln!("SETTINGS 効かない設定です: {r}");
    }
    let listener = TcpListener::bind(("127.0.0.1", port)).unwrap_or_else(|e| {
        eprintln!("待ち受けられません（127.0.0.1:{port}）: {e}");
        std::process::exit(1);
    });
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    println!("LISTEN http://127.0.0.1:{port}");
    let _ = std::io::stdout().flush();
    if stdin_watch {
        std::thread::spawn(|| {
            let mut sink = [0u8; 256];
            let mut stdin = std::io::stdin();
            while matches!(stdin.read(&mut sink), Ok(n) if n > 0) {}
            std::process::exit(0);
        });
    }
    let static_dir = Arc::new(da_core::page::static_dir(&program));
    let program = Arc::new(program);
    for stream in listener.incoming().flatten() {
        let (lot, static_dir, program) = (lot.clone(), static_dir.clone(), program.clone());
        std::thread::spawn(move || {
            let _ = serve(stream, port, &lot, &static_dir, &program);
        });
    }
}

struct Head {
    method: String,
    target: String,
    host: String,
    origin: Option<String>,
    length: usize,
}

fn read_head(r: &mut BufReader<&TcpStream>) -> Option<Head> {
    let mut line = String::new();
    r.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next()?.to_string(), parts.next()?.to_string());
    let mut head = Head { method, target, host: String::new(), origin: None, length: 0 };
    loop {
        let mut h = String::new();
        if r.read_line(&mut h).ok()? == 0 {
            break;
        }
        let h = h.trim_end_matches(['\r', '\n']);
        if h.is_empty() {
            break;
        }
        let Some((k, v)) = h.split_once(':') else { continue };
        let v = v.trim();
        match k.trim().to_ascii_lowercase().as_str() {
            "host" => head.host = v.to_string(),
            "origin" => head.origin = Some(v.to_string()),
            "content-length" => head.length = v.parse().unwrap_or(0),
            _ => {}
        }
    }
    Some(head)
}

/// よその頁からの問い合わせか → 断る理由（Python の開発用サーバー web.foreign_request と同じ決め）
fn foreign(head: &Head, port: u16) -> Option<&'static str> {
    let ok = [format!("127.0.0.1:{port}"), format!("localhost:{port}"), format!("[::1]:{port}")];
    if !ok.contains(&head.host.trim().to_ascii_lowercase()) {
        return Some("この PC の中（127.0.0.1）からだけ答えます。");
    }
    let write = !matches!(head.method.to_ascii_uppercase().as_str(), "GET" | "HEAD" | "OPTIONS");
    if let Some(o) = head.origin.as_deref().map(|o| o.trim().to_ascii_lowercase()) {
        if write && !o.is_empty() && !ok.iter().any(|h| o == format!("http://{h}")) {
            return Some("ほかの頁からの書き込みは受け付けません。");
        }
    }
    None
}

fn serve(stream: TcpStream, port: u16, lot: &da_core::lot::Lot, static_dir: &Path, program: &Path) -> std::io::Result<()> {
    let mut r = BufReader::new(&stream);
    let Some(head) = read_head(&mut r) else { return Ok(()) };
    let reply = if let Some(why) = foreign(&head, port) {
        Reply { status: 403, headers: vec![("Content-Type".into(), "text/plain; charset=utf-8".into())], body: why.as_bytes().to_vec() }
    } else if head.length > BODY_LIMIT {
        shell::error_reply(413, "body", "本文が大きすぎます（8 MB まで）。")
    } else {
        let mut body = vec![0u8; head.length];
        r.read_exact(&mut body)?;
        let (path, query) = head.target.split_once('?').unwrap_or((head.target.as_str(), ""));
        route(lot, &Req { method: &head.method, path, query, body: &body }, static_dir, program)
    };
    write_reply(&stream, &head.method, reply)
}

/// 製品の振り分け（Router::handle の中身なしの枝）と同じ順。窓そのもの（Tauri）だけが答える道は作り物
fn route(lot: &da_core::lot::Lot, req: &Req, static_dir: &Path, program: &Path) -> Reply {
    if req.path.starts_with("/__desktop/") {
        return shell::error_reply(404, "not_found", "開発用サーバーは窓の操作に答えません。");
    }
    if (req.method, req.path) == ("POST", "/api/shutdown") {
        return shell::json_reply(&serde_json::json!({"ok": true}));
    }
    let python_now = PythonNow::absent;
    let log = |line: &str| eprintln!("{line}");
    let ctx = Ctx { program, python_now: &python_now, absent: true, log: &log };
    if let Some(r) = shell::answer(lot, req, &ctx) {
        return r;
    }
    if let (true, Some(rest)) = (req.method == "GET" || req.method == "HEAD", req.path.strip_prefix("/static/")) {
        return shell::static_file(static_dir, rest, req.query);
    }
    shell::refuse(lot, req)
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        304 => "Not Modified",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "",
    }
}

fn write_reply(mut stream: &TcpStream, method: &str, r: Reply) -> std::io::Result<()> {
    let mut out = format!("HTTP/1.1 {} {}\r\n", r.status, reason(r.status));
    for (k, v) in &r.headers {
        if !k.eq_ignore_ascii_case("content-length") && !k.eq_ignore_ascii_case("connection") {
            out.push_str(&format!("{k}: {v}\r\n"));
        }
    }
    out.push_str(&format!("X-TPA-By: shell\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", r.body.len()));
    stream.write_all(out.as_bytes())?;
    if method != "HEAD" {
        stream.write_all(&r.body)?;
    }
    stream.flush()
}
