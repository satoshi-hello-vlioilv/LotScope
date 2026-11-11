//! CM3 への問い合わせ（版 3.96.0。Python の cm3_schedule.fetch_raw〈urllib.request・ProxyHandler({})〉を std の TcpStream で写した）。
//!
//! 送る物は urllib と同じ: 要求の行と見出しの並び（Accept-Encoding: identity・Content-Length・Host・User-Agent・Accept・Content-Type・
//! Origin・Referer・Connection: close）と本文（json.dumps(…, ensure_ascii=False) の UTF-8）。受ける物は http.client と同じ:
//! HTTP/1.0 と 1.1・Content-Length・chunked・閉じるまで・100 Continue を飛ばす。30x は urllib の HTTPRedirectHandler と同じ
//! （POST の 301・302・303 は本文なしの GET、307・308 は HTTP の誤り。同じ URL は 4 回・全部で 10 回まで）。timeout は 1 回の接続・
//! 読み・書きごと（合計ではない）。誤りの字は Python の言葉（接続の timeout は「CM3に接続できません: timed out」、読みの timeout は
//! 「CM3の応答がタイムアウトしました」、OS の誤りは Python の OSError の str の形〈Linux は [Errno n] 理由、Windows は [WinError n] 文〉）。
//!
//! 窓が取れない設定（https・システムのプロキシ・ftp など・URL に空白や ASCII でない字・数でない timeout）と、Python が落ちる答え
//! （壊れた状態の行・途中で切れた本文・壊れた chunked）は Fail::Python（schedule.rs が係を降りて Python に任せる）。

use crate::cm3::{Fail, R};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

/// urllib の User-Agent（Python-urllib/<版>。製品の Python と同じ版の字）
pub const USER_AGENT: &str = "Python-urllib/3.13";
const MAXLINE: usize = 65536;

fn py<T>(why: &'static str) -> R<T> {
    Err(Fail::Python(why))
}

fn connect_err(reason: String) -> Fail {
    Fail::Cm3(format!("CM3に接続できません: {reason}"))
}

fn timeout_err() -> Fail {
    Fail::Cm3("CM3の応答がタイムアウトしました".into())
}

/// Python の str(OSError)
pub fn os_text(e: &std::io::Error) -> String {
    use std::io::ErrorKind::*;
    if matches!(e.kind(), TimedOut | WouldBlock) {
        return "timed out".into();
    }
    match e.raw_os_error() {
        Some(n) => {
            #[cfg(windows)]
            {
                format!("[WinError {n}] {}", win_message(n))
            }
            #[cfg(not(windows))]
            {
                let full = e.to_string();
                let msg = full.strip_suffix(&format!(" (os error {n})")).unwrap_or(&full).to_string();
                format!("[Errno {n}] {msg}")
            }
        }
        None => full_text(e),
    }
}

/// Windows の誤りの文（CPython の PyErr_SetExcFromWindowsErr と同じ: FormatMessageW を言語 MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT)
/// ＝0x0400 で引き、末尾の「' ' 以下の字」と「.」を切る。引けなければ「Windows Error 0x<16 進>」）。Rust の io::Error の文は言語 0 で引き
/// （スレッドの UI の言語が先）、切り方も違うので使わない（版 3.96.0。Windows の CI の後に、推して書いた所を CPython のソースに合わせた）
#[cfg(windows)]
fn win_message(n: i32) -> String {
    use windows::Win32::System::Diagnostics::Debug::{FormatMessageW, FORMAT_MESSAGE_FROM_SYSTEM, FORMAT_MESSAGE_IGNORE_INSERTS};
    let mut buf = vec![0u16; 8192];
    // SAFETY: buf は nsize 字ぶん確保してある。挿入（arguments）は使わない
    let len = unsafe {
        FormatMessageW(
            FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
            None,
            n as u32,
            0x0400,
            windows::core::PWSTR(buf.as_mut_ptr()),
            buf.len() as u32,
            None,
        )
    } as usize;
    if len == 0 {
        return format!("Windows Error 0x{:x}", n as u32);
    }
    let mut w = &buf[..len.min(buf.len())];
    while let Some((&last, rest)) = w.split_last() {
        if last <= u16::from(b' ') || last == u16::from(b'.') {
            w = rest;
        } else {
            break;
        }
    }
    String::from_utf16_lossy(w)
}

fn full_text(e: &std::io::Error) -> String {
    e.to_string()
}

/// getaddrinfo の誤り（Python の socket.gaierror の str）
fn gai_text(e: &std::io::Error) -> String {
    if cfg!(windows) {
        if let Some(n) = e.raw_os_error() {
            return format!("[Errno {n}] getaddrinfo failed");
        }
    }
    let s = e.to_string();
    let msg = s.strip_prefix("failed to lookup address information: ").unwrap_or(&s);
    // glibc の gai_strerror → EAI_* の番号（Python は [Errno 番号] 文）
    let code = match msg {
        "Bad value for ai_flags" => Some(-1),
        "Name or service not known" => Some(-2),
        "Temporary failure in name resolution" => Some(-3),
        "Non-recoverable failure in name resolution" => Some(-4),
        "No address associated with hostname" => Some(-5),
        "ai_family not supported" => Some(-6),
        "ai_socktype not supported" => Some(-7),
        "Servname not supported for ai_socktype" => Some(-8),
        "Address family for hostname not supported" => Some(-9),
        "Memory allocation failure" => Some(-10),
        "Argument buffer overflow" => Some(-12),
        _ => None,
    };
    match (code, e.raw_os_error()) {
        (Some(c), _) => format!("[Errno {c}] {msg}"),
        (None, Some(_)) => os_text(e),
        (None, None) => msg.to_string(),
    }
}

/// 問い合わせ先（http の URL を urllib と同じに分けた物）
#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    /// Host の見出しに書く字（URL の netloc のまま）
    pub netloc: String,
    pub host: String,
    pub port: u16,
    /// 要求の行の道（道＋問い合わせ）
    pub selector: String,
    /// urllib の full_url（「#」の後ろを除いた URL）
    pub full: String,
}

/// URL を分ける。http でない URL のうち urllib に係の無い物は「unknown url type」、https・ftp・file・data は窓が取れない
pub fn target(url: &str) -> R<Target> {
    if !url.chars().all(|c| ('\x21'..='\x7e').contains(&c)) {
        return py("URL に空白・制御文字・ASCII でない字（urllib が落ちるか、窓と読みが違う）");
    }
    let full = url.rsplit_once('#').map(|(a, _)| a).unwrap_or(url).to_string();
    // _splittype: ([^/:]+):(.*)
    let Some(colon) = full.find(':').filter(|i| *i > 0 && !full[..*i].contains('/')) else {
        return py("URL に種類が無い（urllib は ValueError）");
    };
    let scheme = full[..colon].to_ascii_lowercase();
    let rest = &full[colon + 1..];
    match scheme.as_str() {
        "http" => {}
        "https" | "ftp" | "file" | "data" => return py("http でない（https・ftp など。窓は http だけを取る）"),
        _ => return Err(connect_err(format!("unknown url type: {scheme}"))),
    }
    // _splithost: //([^/#?]*)(.*)
    let (netloc, path) = match rest.strip_prefix("//") {
        Some(r) => {
            let end = r.find(['/', '?']).unwrap_or(r.len());
            let mut path = r[end..].to_string();
            if !path.is_empty() && !path.starts_with('/') {
                path = format!("/{path}");
            }
            (r[..end].to_string(), path)
        }
        None => (String::new(), rest.to_string()),
    };
    if netloc.is_empty() {
        return Err(connect_err("no host given".into()));
    }
    if netloc.contains(['%', '@', '[', ']']) {
        return py("Host に % @ [ ]（urllib の unquote・IPv6・利用者の名前）");
    }
    let (host, port) = match netloc.rsplit_once(':') {
        Some((h, "")) => (h.to_string(), 80),
        Some((h, p)) if p.bytes().all(|b| b.is_ascii_digit()) => match p.parse::<u32>() {
            Ok(n) if n <= 65535 => (h.to_string(), n as u16),
            _ => return py("ポートが 65535 を超える（Python は OverflowError）"),
        },
        Some(_) => return py("ポートが数字でない（http.client は InvalidURL）"),
        None => (netloc.clone(), 80),
    };
    let selector = if path.is_empty() { "/".to_string() } else { path };
    Ok(Target { netloc, host, port, selector, full })
}

/// 答え
#[derive(Debug, Clone)]
pub struct Resp {
    pub status: u16,
    pub reason: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Resp {
    /// 見出し（名前の大小を見ない。同じ名前は最初の物: email.message の get）
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

/// Python の str.split(None, 2)（空白は Python の isspace。latin-1 で読んだ字）
fn split3(line: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    let mut rest = line;
    while out.len() < 2 {
        rest = rest.trim_start_matches(crate::pyfmt::is_space);
        if rest.is_empty() {
            return out;
        }
        let end = rest.find(crate::pyfmt::is_space).unwrap_or(rest.len());
        out.push(rest[..end].to_string());
        rest = &rest[end..];
    }
    let tail = rest.trim_start_matches(crate::pyfmt::is_space);
    if !tail.is_empty() {
        out.push(tail.to_string());
    }
    out
}

fn latin1(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

struct Conn {
    r: BufReader<TcpStream>,
}

impl Conn {
    /// 1 行（\n まで）。長すぎれば Python は LineTooLong で落ちる
    fn line(&mut self) -> R<Vec<u8>> {
        let mut buf = vec![];
        let n = (&mut self.r).take((MAXLINE + 1) as u64).read_until(b'\n', &mut buf).map_err(read_err)?;
        if n > MAXLINE {
            return py("見出しの行が長すぎる（http.client は LineTooLong）");
        }
        Ok(buf)
    }

    fn exact(&mut self, n: usize) -> R<Vec<u8>> {
        let mut buf = vec![0u8; n];
        let mut got = 0;
        while got < n {
            match self.r.read(&mut buf[got..]) {
                Ok(0) => return py("本文が途中で切れた（http.client は IncompleteRead）"),
                Ok(k) => got += k,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(e) => return Err(read_err(e)),
            }
        }
        Ok(buf)
    }
}

/// 読みの誤り（timeout は「応答がタイムアウト」、ほかは接続できません: OSError）
fn read_err(e: std::io::Error) -> Fail {
    use std::io::ErrorKind::*;
    if matches!(e.kind(), TimedOut | WouldBlock) {
        timeout_err()
    } else {
        connect_err(os_text(&e))
    }
}

/// 1 回の問い合わせ（30x はたどらない）
fn once(t: &Target, method: &str, headers: &[(String, String)], body: Option<&[u8]>, timeout: Duration) -> R<Resp> {
    let addrs: Vec<_> = (t.host.as_str(), t.port).to_socket_addrs().map_err(|e| connect_err(gai_text(&e)))?.collect();
    let mut last: Option<std::io::Error> = None;
    let mut stream = None;
    for a in addrs {
        match TcpStream::connect_timeout(&a, timeout) {
            Ok(s) => {
                stream = Some(s);
                break;
            }
            Err(e) => last = Some(e),
        }
    }
    let Some(stream) = stream else {
        return Err(connect_err(last.map(|e| os_text(&e)).unwrap_or_else(|| "getaddrinfo returns an empty list".into())));
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    // 要求（http.client: 要求の行 → Accept-Encoding: identity → 渡した見出しの順）
    let mut req = format!("{method} {} HTTP/1.1\r\nAccept-Encoding: identity\r\n", t.selector).into_bytes();
    for (k, v) in headers {
        req.extend(format!("{k}: {v}\r\n").bytes());
    }
    req.extend(b"\r\n");
    if let Some(b) = body {
        req.extend_from_slice(b);
    }
    let mut w = stream.try_clone().map_err(|e| connect_err(os_text(&e)))?;
    if let Err(e) = w.write_all(&req) {
        // 送る途中の誤りは urllib が URLError に包む（timeout も「接続できません: timed out」）
        return Err(connect_err(os_text(&e)));
    }
    let mut c = Conn { r: BufReader::new(stream) };
    // 状態の行（100 Continue は飛ばす）
    let (version, status, reason) = loop {
        let line = c.line()?;
        if line.is_empty() {
            return Err(connect_err("Remote end closed connection without response".into()));
        }
        let text = latin1(&line);
        let parts = split3(&text);
        let (version, status, reason) = match parts.len() {
            3 => (parts[0].clone(), parts[1].clone(), parts[2].clone()),
            2 => (parts[0].clone(), parts[1].clone(), String::new()),
            _ => return py("状態の行が読めない（BadStatusLine）"),
        };
        if !version.starts_with("HTTP/") || status.len() != 3 || !status.bytes().all(|b| b.is_ascii_digit()) {
            return py("状態の行が読めない（BadStatusLine）");
        }
        let code: u16 = status.parse().unwrap_or(0);
        if code < 100 {
            return py("状態の番号が 100 より小さい（BadStatusLine）");
        }
        if code != 100 {
            break (version, code, crate::pyfmt::strip(&reason).to_string());
        }
        loop {
            let l = c.line()?;
            if matches!(l.as_slice(), b"\r\n" | b"\n" | b"") {
                break;
            }
        }
    };
    if version != "HTTP/1.0" && !version.starts_with("HTTP/1.") {
        return py("知らない HTTP の版（UnknownProtocol）");
    }
    // 見出し
    let mut hs: Vec<(String, String)> = vec![];
    loop {
        let l = c.line()?;
        if matches!(l.as_slice(), b"\r\n" | b"\n" | b"") {
            break;
        }
        if hs.len() >= 100 {
            return py("見出しが 100 を超える（http.client が落ちる）");
        }
        let text = latin1(&l);
        let text = text.trim_end_matches(['\r', '\n']);
        if text.starts_with([' ', '\t']) {
            if let Some(last) = hs.last_mut() {
                last.1.push_str(text);
            }
            continue;
        }
        if let Some((k, v)) = text.split_once(':') {
            hs.push((k.to_string(), v.trim_start_matches([' ', '\t']).to_string()));
        }
    }
    let mut resp = Resp { status, reason, headers: hs, body: vec![] };
    let chunked = resp.header("transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked"));
    let length = if chunked { None } else { resp.header("content-length").and_then(|v| crate::pyfmt::py_int(v).ok()).filter(|n| *n >= 0) };
    let length = if status == 204 || status == 304 || (100..200).contains(&status) { Some(0) } else { length };
    // urllib が本文を読むのは 2xx と、たどる 30x（行き先のある物）だけ。誤りの答えの本文は読まない
    let redirect = matches!(status, 301 | 302 | 303 | 307 | 308) && (resp.header("location").is_some() || resp.header("uri").is_some());
    if !(200..300).contains(&status) && !redirect {
        return Ok(resp);
    }
    if chunked {
        loop {
            let l = c.line()?;
            let head = &l[..l.iter().position(|b| *b == b';').unwrap_or(l.len())];
            let txt = crate::pyfmt::strip(&latin1(head)).to_string();
            let txt = txt.strip_prefix("0x").or_else(|| txt.strip_prefix("0X")).unwrap_or(&txt).to_string();
            if txt.is_empty() || !txt.bytes().all(|b| b.is_ascii_hexdigit()) || txt.len() > 15 {
                return py("chunked の大きさが読めない（http.client が落ちる）");
            }
            let n = usize::from_str_radix(&txt, 16).unwrap_or(0);
            if n == 0 {
                // 後ろの見出し（trailer）を捨てる
                loop {
                    let t = c.line()?;
                    if matches!(t.as_slice(), b"\r\n" | b"\n" | b"") {
                        break;
                    }
                }
                break;
            }
            resp.body.extend(c.exact(n)?);
            c.exact(2)?;
        }
    } else if let Some(n) = length {
        resp.body = c.exact(n as usize)?;
    } else {
        let mut all = vec![];
        c.r.read_to_end(&mut all).map_err(read_err)?;
        resp.body = all;
    }
    Ok(resp)
}

/// 送る見出し（urllib の並び。Host は先の netloc）
fn headers_for(t: &Target, post: Option<&[u8]>, base: &str) -> Vec<(String, String)> {
    let mut h = vec![];
    if let Some(b) = post {
        h.push(("Content-Length".into(), b.len().to_string()));
    }
    h.push(("Host".into(), t.netloc.clone()));
    h.push(("User-Agent".into(), USER_AGENT.into()));
    h.push(("Accept".into(), "application/json, text/plain, */*".into()));
    if post.is_some() {
        h.push(("Content-Type".into(), "application/json;charset=UTF-8".into()));
    }
    h.push(("Origin".into(), base.into()));
    h.push(("Referer".into(), format!("{base}/Cm3SchWeb/")));
    h.push(("Connection".into(), "close".into()));
    h
}

const INF_MSG: &str = "The HTTP server returned a redirect error that would lead to an infinite loop.\nThe last 30x error message was:\n";

/// 30x の行き先（urllib と同じに組める形だけ。ほかは Python に任せる）
fn redirect_url(cur: &Target, loc: &str) -> R<String> {
    if !loc.chars().all(|c| ('\x21'..='\x7e').contains(&c)) {
        return py("30x の行き先に空白・ASCII でない字（urllib は % で逃がす）");
    }
    let lower = loc.to_ascii_lowercase();
    if lower.starts_with("http://") {
        let rest = &loc[7..];
        let has_path = rest.contains(['/', '?', '#']);
        let url = if has_path { loc.to_string() } else { format!("{loc}/") };
        let (u, _) = url.split_once('#').map(|(a, b)| (a.to_string(), b)).unwrap_or((url.clone(), ""));
        if u[7..].split(['?']).next().unwrap_or("").contains("/.") {
            return py("30x の行き先の道に . の段（urljoin が畳む）");
        }
        return Ok(format!("http://{}", &url[7..]));
    }
    if loc.starts_with('/') && !loc.starts_with("//") {
        if loc.split(['?', '#']).next().unwrap_or("").contains("/.") {
            return py("30x の行き先の道に . の段（urljoin が畳む）");
        }
        return Ok(format!("http://{}{loc}", cur.netloc));
    }
    py("30x の行き先が http の URL でも絶対の道でもない（urllib は urljoin・ほかの種類）")
}

/// CM3 へ POST して答えを受ける（30x をたどり、2xx でなければ HTTP の誤り）
pub fn post(url: &str, base: &str, body: &[u8], timeout: Duration) -> R<Resp> {
    let mut t = target(url)?;
    let mut method = "POST";
    let mut visited: Vec<(String, u32)> = vec![];
    loop {
        let post_body = (method == "POST").then_some(body);
        let r = once(&t, method, &headers_for(&t, post_body, base), post_body, timeout)?;
        if (200..300).contains(&r.status) {
            return Ok(r);
        }
        if !matches!(r.status, 301 | 302 | 303 | 307 | 308) {
            return Err(Fail::Cm3(format!("CM3がHTTPエラーを返しました: {} {}", r.status, r.reason)));
        }
        let Some(loc) = r.header("location").or_else(|| r.header("uri")).map(str::to_string) else {
            return Err(Fail::Cm3(format!("CM3がHTTPエラーを返しました: {} {}", r.status, r.reason)));
        };
        let low = loc.to_ascii_lowercase();
        let scheme = low.find(':').map(|i| &low[..i]).filter(|s| !s.contains(['/', '?', '#']));
        if scheme.is_some_and(|s| !matches!(s, "http" | "https" | "ftp")) {
            return py("30x の行き先が許されない種類（urllib は HTTPError の文に URL を入れる）");
        }
        // POST の 307・308 は urllib がたどらない（行き先の種類を見た後・行き先を組む前）
        if method == "POST" && matches!(r.status, 307 | 308) {
            return Err(Fail::Cm3(format!("CM3がHTTPエラーを返しました: {} {}", r.status, r.reason)));
        }
        if scheme.is_some_and(|s| matches!(s, "https" | "ftp")) {
            return py("30x の行き先が https・ftp");
        }
        let new_url = redirect_url(&t, &loc)?;
        let seen = visited.iter().find(|(u, _)| *u == new_url).map(|x| x.1).unwrap_or(0);
        if seen >= 4 || visited.len() >= 10 {
            return Err(Fail::Cm3(format!("CM3がHTTPエラーを返しました: {} {INF_MSG}{}", r.status, r.reason)));
        }
        match visited.iter_mut().find(|(u, _)| *u == new_url) {
            Some(x) => x.1 += 1,
            None => visited.push((new_url.clone(), 1)),
        }
        if method == "POST" {
            method = "GET";
        }
        t = target(&new_url)?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_like_urllib() {
        let t = target("http://127.0.0.1:9085/Cm3SchWeb/service/x#frag").unwrap();
        assert_eq!(
            (t.netloc.as_str(), t.host.as_str(), t.port, t.selector.as_str()),
            ("127.0.0.1:9085", "127.0.0.1", 9085, "/Cm3SchWeb/service/x")
        );
        assert_eq!(target("HTTP://h").unwrap().selector, "/");
        assert_eq!(target("http://h:").unwrap().port, 80);
        assert_eq!(target("nlmfangyweb1a:9085/x"), Err(Fail::Cm3("CM3に接続できません: unknown url type: nlmfangyweb1a".into())));
        assert_eq!(target("http:///x"), Err(Fail::Cm3("CM3に接続できません: no host given".into())));
        assert!(matches!(target("https://h/x"), Err(Fail::Python(_))));
        assert!(matches!(target("nohost"), Err(Fail::Python(_))));
        assert!(matches!(target("http://h:99999/"), Err(Fail::Python(_))));
        assert_eq!(split3("HTTP/1.1  200   OK  then "), ["HTTP/1.1", "200", "OK  then "]);
    }
}
