//! 窓の開発用サーバー（版 3.118.2。撮る・採点する道具〈program/tools/ui-harness.mjs〉の相手。利用者の起動の道ではない）。
//!
//!     cargo run --example ui_serve -- 作業フォルダ [ポート] [--stdin]
//!
//! 製品の窓と同じ lib の振り分け（src/shell.rs の dev_route: 製品の native の頭と同じく /__desktop/*・終了 → answer〈窓の絵も〉→ /static/ →
//! 門番 → window_unanswered。main.rs の bin の試験 the_dev_server_route_answers_like_the_product_router が製品の Router::handle と突き合わせる）と
//! Lot の組み立て（shell::lot_for）で、
//! 窓の答えを HTTP で配る。Tauri の窓は作らない（画面は Playwright の Chromium が開く）。場面（作業フォルダの base・local・
//! appsettings.json）は program/tests/ui_window_scene.py が作り、この実行ファイルを起こす。
//!
//! - 中身（Python）は無い形（製品の段 ④ と同じ absent）。起動の初期値（run_seeds）は当てない（Python の開発用サーバーと同じ）
//! - 窓だけが答える /__desktop/* は 404（撮る台本が Playwright で作り物の答えを返す）。POST /api/shutdown は製品と同じく使い終わり
//!   （Lot::leave）の後に 200 で答え、待ち受けは続ける（撮る道具が「終了」を押しても次の頁を開ける）
//! - ポート 0 なら OS が選ぶ。待ち受けを始めたら「LISTEN http://127.0.0.1:ポート」の 1 行を出す
//! - --stdin: 標準入力が閉じたら終わる（起こした台本が落ちても残らない）
//! - 遅くする口（版 3.118.3。`da_core::slow`）: 環境の TPA_UI_SLOW_FILE が指す JSON（open・ops・only・nocache・copy。Python の開発用サーバーの
//!   slow_down と同じ鍵）を、問い合わせのたびに読む関数を lib に渡す。lib は環境変数もファイルも読まない（配る exe・窓の通しの exe では口が効かない）。
//!   ファイルが無い・読めなければ待たない
//! - この PC の中（127.0.0.1）からだけ答える。書き込みは Origin があれば同じ置き場だけ（Python の開発用サーバー web.foreign_request と同じ）
//! - 1 つのつながりに 1 本の糸・keep-alive なし・本文は 8 MB まで。本文は Content-Length で受け、Transfer-Encoding（chunked など）は
//!   411 で断る（黙って空の本文にしない。版 3.118.2 の作った後の採点の割れ C13）

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
    if let Some(file) = std::env::var_os("TPA_UI_SLOW_FILE").filter(|f| !f.is_empty()).map(PathBuf::from) {
        da_core::slow::set_source(Box::new(move || {
            std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(serde_json::Value::Null)
        }));
    }
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
    /// Transfer-Encoding の値（chunked など。あれば 411 で断る）
    encoding: Option<String>,
}

fn read_head(r: &mut impl BufRead) -> Option<Head> {
    let mut line = String::new();
    r.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next()?.to_string(), parts.next()?.to_string());
    let mut head = Head { method, target, host: String::new(), origin: None, length: 0, encoding: None };
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
            "transfer-encoding" => head.encoding = Some(v.to_string()),
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
    let reply = answer_head(&head, port, &mut r, |req| route(lot, req, static_dir, program))?;
    write_reply(&stream, &head.method, reply)
}

/// 見出しを読んだ後: よその頁・Transfer-Encoding（411）・大きすぎる本文（413）を断り、本文を読んで振り分けに渡す
fn answer_head(head: &Head, port: u16, r: &mut impl Read, route: impl Fn(&Req) -> Reply) -> std::io::Result<Reply> {
    if let Some(why) = foreign(head, port) {
        return Ok(Reply {
            status: 403,
            headers: vec![("Content-Type".into(), "text/plain; charset=utf-8".into())],
            body: why.as_bytes().to_vec(),
        });
    }
    if let Some(te) = head.encoding.as_deref().filter(|te| !te.trim().eq_ignore_ascii_case("identity")) {
        return Ok(shell::error_reply(
            411,
            "length_required",
            &format!("本文は Content-Length で送ってください（開発用サーバーは Transfer-Encoding: {te} を読みません）。"),
        ));
    }
    if head.length > BODY_LIMIT {
        return Ok(shell::error_reply(413, "body", "本文が大きすぎます（8 MB まで）。"));
    }
    let mut body = vec![0u8; head.length];
    r.read_exact(&mut body)?;
    let (path, query) = head.target.split_once('?').unwrap_or((head.target.as_str(), ""));
    Ok(route(&Req { method: &head.method, path, query, body: &body }))
}

/// 製品の振り分けと同じ順（lib の shell::dev_route。窓そのもの〈Tauri〉だけが答える道は作り物）
fn route(lot: &da_core::lot::Lot, req: &Req, static_dir: &Path, program: &Path) -> Reply {
    let python_now = PythonNow::absent;
    let log = |line: &str| eprintln!("{line}");
    let ctx = Ctx { program, python_now: &python_now, absent: true, log: &log };
    shell::dev_route(lot, req, &ctx, static_dir)
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
        405 => "Method Not Allowed",
        409 => "Conflict",
        411 => "Length Required",
        412 => "Precondition Failed",
        413 => "Payload Too Large",
        422 => "Unprocessable Entity",
        423 => "Locked",
        428 => "Precondition Required",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Status",
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

#[cfg(test)]
mod tests {
    use super::*;

    fn head_of(text: &str) -> Head {
        read_head(&mut BufReader::new(text.as_bytes())).expect("見出しを読める")
    }

    /// 版 3.118.2 の作った後の採点の割れ C13: Transfer-Encoding: chunked の本文を黙って空にせず 411 で断る（振り分けへ渡さない）。
    /// Content-Length の本文はそのまま渡す。よその頁・大きすぎる本文も前と同じに断る
    #[test]
    fn chunked_bodies_are_refused_with_411_and_lengths_are_read() {
        let never = |_: &Req| -> Reply { panic!("振り分けへ渡さない") };
        let h = head_of("POST /api/ui-state HTTP/1.1\r\nHost: 127.0.0.1:9\r\nTransfer-Encoding: chunked\r\n\r\n");
        let r = answer_head(&h, 9, &mut "5\r\nhello\r\n0\r\n\r\n".as_bytes(), never).unwrap();
        assert_eq!(r.status, 411);
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&r.body).unwrap()["kind"], "length_required");
        assert_eq!(reason(411), "Length Required");
        let h = head_of("POST /api/x?a=1 HTTP/1.1\r\nHost: localhost:9\r\nContent-Length: 5\r\n\r\n");
        let r = answer_head(&h, 9, &mut "hello".as_bytes(), |req| {
            assert_eq!((req.method, req.path, req.query, req.body), ("POST", "/api/x", "a=1", &b"hello"[..]));
            shell::json_reply(&serde_json::json!({"ok": true}))
        })
        .unwrap();
        assert_eq!(r.status, 200);
        let h = head_of("POST /api/x HTTP/1.1\r\nHost: 127.0.0.1:9\r\nTransfer-Encoding: identity\r\nContent-Length: 0\r\n\r\n");
        assert_eq!(answer_head(&h, 9, &mut "".as_bytes(), |_| shell::json_reply(&serde_json::json!({}))).unwrap().status, 200);
        let h = head_of("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n");
        assert_eq!(answer_head(&h, 9, &mut "".as_bytes(), never).unwrap().status, 403);
        let h = head_of("POST /api/x HTTP/1.1\r\nHost: 127.0.0.1:9\r\nOrigin: http://evil.example\r\nContent-Length: 0\r\n\r\n");
        assert_eq!(answer_head(&h, 9, &mut "".as_bytes(), never).unwrap().status, 403);
        let h = head_of(&format!("POST /api/x HTTP/1.1\r\nHost: 127.0.0.1:9\r\nContent-Length: {}\r\n\r\n", BODY_LIMIT + 1));
        assert_eq!(answer_head(&h, 9, &mut "".as_bytes(), never).unwrap().status, 413);
        for s in [200, 201, 204, 304, 400, 403, 404, 405, 409, 411, 413, 422, 423, 428, 500, 503] {
            assert!(!reason(s).is_empty(), "{s} の理由句");
        }
    }
}
