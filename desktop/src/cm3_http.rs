//! CM3 への問い合わせ（版 3.96.0。Python の cm3_schedule.fetch_raw〈urllib.request・ProxyHandler({})〉を std の TcpStream で写した）。
//!
//! 送る物は urllib と同じ: 要求の行と見出しの並び（Accept-Encoding: identity・Content-Length・Host・User-Agent・Accept・Content-Type・
//! Origin・Referer・Connection: close）と本文（json.dumps(…, ensure_ascii=False) の UTF-8）。受ける物は http.client と同じ:
//! HTTP/1.0 と 1.1・Content-Length・chunked・閉じるまで・100 Continue を飛ばす。30x は urllib の HTTPRedirectHandler と同じ
//! （POST の 301・302・303 は本文なしの GET、307・308 は HTTP の誤り。同じ URL は 4 回・全部で 10 回まで）。timeout は 1 回の接続・
//! 読み・書きごと（合計ではない）。誤りの字は Python の言葉（接続の timeout は「CM3に接続できません: timed out」、読みの timeout は
//! 「CM3の応答がタイムアウトしました」、OS の誤りは Python の OSError の str の形〈Linux は [Errno n] 理由、Windows は [WinError n] 文〉）。
//!
//! 窓が取れない設定（ftp など・URL に空白や ASCII でない字）と、Python が落ちる答え
//! （壊れた状態の行・途中で切れた本文・壊れた chunked）は Fail::Python（schedule.rs が係を降りて Python に任せる）。
//!
//! 版 3.117.1（段 ③-6）: スケジュールは https（native-tls。Linux は OpenSSL・Windows は schannel と OS の証明書の置き場）とシステムのプロキシ
//! （src/sysproxy.rs。http は「POST http://… HTTP/1.1」、https は CONNECT の中継）も取る。届かない言葉は種類ごとに決めた字（src/cm3_net.rs）。
//! LotDsp の 3 本（post_plain・get_once）は前のまま（http の直だけ・前の言葉）。

use crate::cm3::{Fail, R};
use crate::cm3_net::Kind;
use crate::sysproxy::{Choice, System};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

/// 問い合わせの途中の誤り: 言葉の決まった物（F）か、届かない形（N: 種類・中身と、LotDsp の前の言葉）
#[derive(Debug)]
enum X {
    F(Fail),
    N { kind: Kind, detail: String, legacy: Fail },
}

impl From<Fail> for X {
    fn from(f: Fail) -> X {
        X::F(f)
    }
}

type H<T> = Result<T, X>;

/// LotDsp の形（前の言葉）
fn legacy<T>(r: H<T>) -> R<T> {
    r.map_err(|e| match e {
        X::F(f) => f,
        X::N { legacy, .. } => legacy,
    })
}

fn net(kind: Kind, detail: String, legacy: Fail) -> X {
    X::N { kind, detail, legacy }
}

/// urllib の User-Agent（Python-urllib/<版>。製品の Python と同じ版の字）
pub const USER_AGENT: &str = "Python-urllib/3.13";
const MAXLINE: usize = 65536;

fn py<T, E: From<Fail>>(why: &'static str) -> Result<T, E> {
    Err(Fail::Python(why).into())
}

fn connect_err(reason: String) -> Fail {
    Fail::Cm3(format!("予定の元に接続できません: {reason}"))
}

fn timeout_err() -> Fail {
    Fail::Cm3("予定の元の応答がタイムアウトしました".into())
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
pub(crate) fn win_message(n: i32) -> String {
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

/// 問い合わせ先（http・https の URL を urllib と同じに分けた物）
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
    /// https か
    pub tls: bool,
    /// 「#」の後ろ（プロキシ越しの http の要求の行は urllib の full_url の字＝「#」の後ろも送る）
    pub frag: Option<String>,
}

impl Target {
    fn scheme(&self) -> &'static str {
        if self.tls {
            "https"
        } else {
            "http"
        }
    }
}

/// URL を分ける（http だけ。LotDsp の形）。http でない URL のうち urllib に係の無い物は「unknown url type」、https・ftp・file・data は窓が取れない
pub fn target(url: &str) -> R<Target> {
    target_with(url, false)
}

/// URL を分ける。https: https も取るか（スケジュール。版 3.117.1）
pub fn target_with(url: &str, https: bool) -> R<Target> {
    if !url.chars().all(|c| ('\x21'..='\x7e').contains(&c)) {
        return py("URL に空白・制御文字・ASCII でない字（urllib が落ちるか、窓と読みが違う）");
    }
    // urllib の _splittag（最後の「#」で分ける）
    let (full, frag) = match url.rsplit_once('#') {
        Some((a, f)) => (a.to_string(), Some(f.to_string())),
        None => (url.to_string(), None),
    };
    // _splittype: ([^/:]+):(.*)
    let Some(colon) = full.find(':').filter(|i| *i > 0 && !full[..*i].contains('/')) else {
        return py("URL に種類が無い（urllib は ValueError）");
    };
    let scheme = full[..colon].to_ascii_lowercase();
    let rest = &full[colon + 1..];
    let tls = match scheme.as_str() {
        "http" => false,
        "https" if https => true,
        "https" | "ftp" | "file" | "data" => return py("http でない（https・ftp など。窓は http だけを取る）"),
        _ => return Err(connect_err(format!("unknown url type: {scheme}"))),
    };
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
    let default = if tls { 443 } else { 80 };
    let (host, port) = match netloc.rsplit_once(':') {
        Some((h, "")) => (h.to_string(), default),
        Some((h, p)) if p.bytes().all(|b| b.is_ascii_digit()) => match p.parse::<u32>() {
            Ok(n) if n <= 65535 => (h.to_string(), n as u16),
            _ => return py("ポートが 65535 を超える（Python は OverflowError）"),
        },
        Some(_) => return py("ポートが数字でない（http.client は InvalidURL）"),
        None => (netloc.clone(), default),
    };
    let selector = if path.is_empty() { "/".to_string() } else { path };
    Ok(Target { netloc, host, port, selector, full, tls, frag })
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

/// 平文か TLS の流れ
enum Stream {
    Plain(TcpStream),
    Tls(Box<native_tls::TlsStream<TcpStream>>),
}

impl Read for Stream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Stream::Plain(s) => s.read(buf),
            Stream::Tls(s) => s.read(buf),
        }
    }
}

impl Write for Stream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            Stream::Plain(s) => s.write(buf),
            Stream::Tls(s) => s.write(buf),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Stream::Plain(s) => s.flush(),
            Stream::Tls(s) => s.flush(),
        }
    }
}

struct Conn<S: Read> {
    r: BufReader<S>,
}

impl<S: Read> Conn<S> {
    /// 1 行（\n まで）。長すぎれば Python は LineTooLong で落ちる
    fn line(&mut self) -> H<Vec<u8>> {
        let mut buf = vec![];
        let n = (&mut self.r).take((MAXLINE + 1) as u64).read_until(b'\n', &mut buf).map_err(read_err)?;
        if n > MAXLINE {
            return py("見出しの行が長すぎる（http.client は LineTooLong）");
        }
        Ok(buf)
    }

    fn exact(&mut self, n: usize) -> H<Vec<u8>> {
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

    /// 見出しの並び（空の行まで）
    fn headers(&mut self) -> H<Vec<(String, String)>> {
        let mut hs: Vec<(String, String)> = vec![];
        loop {
            let l = self.line()?;
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
        Ok(hs)
    }

    /// 状態の行（http.client の _read_status。100 Continue は呼ぶ側が飛ばす）→ (版, 番号, 理由)
    fn status(&mut self) -> H<(String, u16, String)> {
        let line = self.line()?;
        if line.is_empty() {
            return Err(net(
                Kind::Os,
                "Remote end closed connection without response".into(),
                connect_err("Remote end closed connection without response".into()),
            ));
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
        Ok((version, code, crate::pyfmt::strip(&reason).to_string()))
    }
}

/// 読みの誤り（timeout は「応答がタイムアウト」、ほかは接続できません: OSError）
fn read_err(e: std::io::Error) -> X {
    use std::io::ErrorKind::*;
    if matches!(e.kind(), TimedOut | WouldBlock) {
        net(Kind::Timeout, String::new(), timeout_err())
    } else {
        let t = os_text(&e);
        net(Kind::Os, t.clone(), connect_err(t))
    }
}

/// 送る・つなぐ途中の誤り（urllib が URLError に包む。timeout も「接続できません: timed out」が前の言葉）
fn send_err(e: &std::io::Error) -> X {
    use std::io::ErrorKind::*;
    let t = os_text(e);
    let kind = if matches!(e.kind(), TimedOut | WouldBlock) { Kind::Timeout } else { Kind::Os };
    net(kind, if kind == Kind::Os { t.clone() } else { String::new() }, connect_err(t))
}

/// つなぐ先（直か、プロキシ）
#[derive(Debug, Clone, PartialEq)]
pub enum Route {
    Direct,
    /// プロキシの名前:番号
    Proxy(String),
}

/// 名前:番号 → (名前, 番号)（http.client の _get_hostport。番号が無ければ既定）
fn host_port(hp: &str, default: u16) -> (String, u16) {
    let (i, j) = (hp.rfind(':'), hp.rfind(']'));
    let (name, port) = match (i, j) {
        (Some(i), j) if j.is_none_or(|j| i > j) => (&hp[..i], hp[i + 1..].parse::<u16>().unwrap_or(default)),
        _ => (hp, default),
    };
    (name.trim_start_matches('[').trim_end_matches(']').to_string(), port)
}

/// TCP でつなぐ
fn connect(host: &str, port: u16, timeout: Duration) -> H<TcpStream> {
    let addrs: Vec<_> = (host, port).to_socket_addrs().map_err(|e| net(Kind::Dns, String::new(), connect_err(gai_text(&e))))?.collect();
    let mut last: Option<std::io::Error> = None;
    for a in addrs {
        match TcpStream::connect_timeout(&a, timeout) {
            Ok(s) => {
                let _ = s.set_read_timeout(Some(timeout));
                let _ = s.set_write_timeout(Some(timeout));
                return Ok(s);
            }
            Err(e) => last = Some(e),
        }
    }
    match last {
        Some(e) => Err(send_err(&e)),
        None => Err(net(Kind::Dns, String::new(), connect_err("getaddrinfo returns an empty list".into()))),
    }
}

/// 握手の途中で相手が閉じた印（X::N の detail。言葉の TlsOther は detail を使わない）
const TLS_EOF: &str = "eof";

/// TLS の握手の誤り → 種類（io の誤りなら io の種類。ほかは OS の TLS の材料: Linux は OpenSSL の字、Windows は schannel の番号）
fn tls_err(e: &native_tls::Error) -> X {
    let mut src: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(e);
    while let Some(s) = src {
        if let Some(io) = s.downcast_ref::<std::io::Error>() {
            if cfg!(windows) && io.raw_os_error().is_some_and(|n| n < 0) {
                break; // schannel の誤り（HRESULT）
            }
            return send_err(io);
        }
        src = s.source();
    }
    let text = e.to_string();
    // 握手の途中で相手が閉じた（OpenSSL の「unexpected eof while reading」・schannel の「unexpected EOF during handshake」。Python は
    // ssl.SSLEOFError）: 直ならそのほか、プロキシ越しなら「その先で切れました」（印 TLS_EOF を once が見る）
    if text.to_lowercase().contains("unexpected eof") {
        return net(Kind::TlsOther, TLS_EOF.into(), connect_err(text));
    }
    let kind = if cfg!(windows) {
        match crate::cm3_net::os_error_code(&text) {
            // 番号が正なら Winsock の誤り（握手の途中で切られた など）: ほかの所と同じ OS の誤りの字
            Some(n) if n > 0 => return send_err(&std::io::Error::from_raw_os_error(n as i32)),
            Some(n) => crate::cm3_net::kind_of_schannel(n as u32),
            None => Kind::TlsOther,
        }
    } else {
        crate::cm3_net::kind_of_openssl(&text)
    };
    net(kind, String::new(), connect_err(text))
}

fn tls_connector() -> H<&'static native_tls::TlsConnector> {
    static C: std::sync::OnceLock<Result<native_tls::TlsConnector, String>> = std::sync::OnceLock::new();
    match C.get_or_init(|| native_tls::TlsConnector::new().map_err(|e| e.to_string())) {
        Ok(c) => Ok(c),
        Err(e) => Err(net(Kind::TlsOther, String::new(), connect_err(e.clone()))),
    }
}

/// つないで、要求を送れる流れにする（プロキシ越しの https は CONNECT で中継してから TLS）。
/// プロキシへの TCP がつながる前の OS の誤り・名前を引けないは「プロキシに届きません」（ProxyUnreachable）、CONNECT の答えが読めない
/// （状態の行・見出しの行が長い・見出しが 100 を超える）は「プロキシの答えを読めません」（ProxyBad）。つながった後の OS の誤りは
/// [`once`] が「その先で切れました」（ProxyCut）にする（版 3.117.1 の作った後の直し・割れ 5・7。Python は cm3_schedule の _Hop）
fn open(t: &Target, route: &Route, timeout: Duration) -> H<Stream> {
    let tcp = match route {
        Route::Direct => connect(&t.host, t.port, timeout)?,
        Route::Proxy(hp) => {
            let (h, p) = host_port(hp, if t.tls { 443 } else { 80 });
            connect(&h, p, timeout).map_err(|e| match e {
                X::N { kind: Kind::Os | Kind::Dns, legacy, .. } => net(Kind::ProxyUnreachable, hp.clone(), legacy),
                x => x,
            })?
        }
    };
    if !t.tls {
        return Ok(Stream::Plain(tcp));
    }
    let tcp = if matches!(route, Route::Proxy(_)) {
        // http.client の _tunnel: CONNECT 名前:番号 HTTP/1.1・Host: 名前:番号
        let hp = format!("{}:{}", t.host, t.port);
        let mut w = tcp.try_clone().map_err(|e| send_err(&e))?;
        w.write_all(format!("CONNECT {hp} HTTP/1.1\r\nHost: {hp}\r\n\r\n").as_bytes()).map_err(|e| send_err(&e))?;
        // 答えの行と見出しだけを読む（本文は読まない）。1 バイトずつ読み、TLS の始まりを飲み込まない
        let mut c = Conn { r: BufReader::with_capacity(1, tcp.try_clone().map_err(|e| send_err(&e))?) };
        let hp = match route {
            Route::Proxy(hp) => hp.clone(),
            Route::Direct => String::new(),
        };
        // 読めない答え（Python の _tunnel は http.client の HTTPException）は ProxyBad。中継の答えを読む前の timeout も、ほかの所と同じ時間切れ
        let bad = |e: X| match e {
            X::F(Fail::Python(why)) => net(Kind::ProxyBad, hp.clone(), Fail::Python(why)),
            X::N { kind: Kind::Timeout, legacy, .. } => net(Kind::Timeout, String::new(), legacy),
            x => x,
        };
        let (_v, code, reason) = c.status().map_err(bad)?;
        c.headers().map_err(bad)?;
        if code != 200 {
            let d = format!("{code} {reason}");
            let kind = if code == 407 { Kind::ProxyAuth } else { Kind::ProxyRefused };
            return Err(net(kind, d.clone(), connect_err(format!("Tunnel connection failed: {d}"))));
        }
        tcp
    } else {
        tcp
    };
    match tls_connector()?.connect(&t.host, tcp) {
        Ok(s) => Ok(Stream::Tls(Box::new(s))),
        Err(native_tls::HandshakeError::WouldBlock(_)) => Err(net(Kind::Timeout, String::new(), connect_err("timed out".into()))),
        Err(native_tls::HandshakeError::Failure(e)) => Err(tls_err(&e)),
    }
}

/// 1 回の問い合わせ（30x はたどらない）。read_body: 2xx・たどる 30x の本文を読むか（確かめるは読まない: Python の urlopen も読まない）。
/// プロキシ越しで、プロキシへの TCP がつながった後の OS の誤り（CONNECT の 200 の後・要求を送った後に切れた・答えずに閉じた）と、
/// TLS の握手の途中で相手が閉じた形（CONNECT の 200 の後にすぐ閉じる）は ProxyCut
fn once(
    t: &Target,
    route: &Route,
    method: &str,
    headers: &[(String, String)],
    body: Option<&[u8]>,
    timeout: Duration,
    read_body: bool,
) -> H<Resp> {
    once_raw(t, route, method, headers, body, timeout, read_body).map_err(|e| match (route, e) {
        (Route::Proxy(hp), X::N { kind: Kind::Os, legacy, .. }) => net(Kind::ProxyCut, hp.clone(), legacy),
        (Route::Proxy(hp), X::N { kind: Kind::TlsOther, detail, legacy }) if detail == TLS_EOF => net(Kind::ProxyCut, hp.clone(), legacy),
        (_, e) => e,
    })
}

fn once_raw(
    t: &Target,
    route: &Route,
    method: &str,
    headers: &[(String, String)],
    body: Option<&[u8]>,
    timeout: Duration,
    read_body: bool,
) -> H<Resp> {
    let mut stream = open(t, route, timeout)?;
    // 要求（http.client: 要求の行 → Accept-Encoding: identity → 渡した見出しの順）。プロキシ越しの http は URL の全体（urllib の set_proxy）
    let target = match (route, t.tls) {
        (Route::Proxy(_), false) => match &t.frag {
            Some(f) => format!("{}#{f}", t.full),
            None => t.full.clone(),
        },
        _ => t.selector.clone(),
    };
    let mut req = format!("{method} {target} HTTP/1.1\r\nAccept-Encoding: identity\r\n").into_bytes();
    for (k, v) in headers {
        req.extend(format!("{k}: {v}\r\n").bytes());
    }
    req.extend(b"\r\n");
    if let Some(b) = body {
        req.extend_from_slice(b);
    }
    if let Err(e) = stream.write_all(&req).and_then(|_| stream.flush()) {
        // 送る途中の誤りは urllib が URLError に包む（timeout も「接続できません: timed out」）
        return Err(send_err(&e));
    }
    let mut c = Conn { r: BufReader::new(stream) };
    // 状態の行（100 Continue は飛ばす）
    let (version, status, reason) = loop {
        let (version, code, reason) = c.status()?;
        if code != 100 {
            break (version, code, reason);
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
    let hs = c.headers()?;
    let mut resp = Resp { status, reason, headers: hs, body: vec![] };
    let chunked = resp.header("transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked"));
    let length = if chunked {
        None
    } else {
        resp.header("content-length").and_then(|v| crate::pyfmt::py_int(v).ok().map(|n| n.saturating())).filter(|n| *n >= 0)
    };
    let length = if status == 204 || status == 304 || (100..200).contains(&status) { Some(0) } else { length };
    // urllib が本文を読むのは 2xx と、たどる 30x（行き先のある物）だけ。誤りの答えの本文は読まない
    let redirect = matches!(status, 301 | 302 | 303 | 307 | 308) && (resp.header("location").is_some() || resp.header("uri").is_some());
    if (!(200..300).contains(&status) && !redirect) || !read_body {
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

/// 30x の行き先（urllib と同じに組める形だけ。ほかは Python に任せる）。https: https の行き先もたどるか
fn redirect_url(cur: &Target, loc: &str, https: bool) -> H<String> {
    if !loc.chars().all(|c| ('\x21'..='\x7e').contains(&c)) {
        return py("30x の行き先に空白・ASCII でない字（urllib は % で逃がす）");
    }
    let lower = loc.to_ascii_lowercase();
    let abs = if lower.starts_with("http://") {
        Some(("http", 7))
    } else if https && lower.starts_with("https://") {
        Some(("https", 8))
    } else {
        None
    };
    if let Some((scheme, n)) = abs {
        let rest = &loc[n..];
        let has_path = rest.contains(['/', '?', '#']);
        let url = if has_path { loc.to_string() } else { format!("{loc}/") };
        let (u, _) = url.split_once('#').map(|(a, b)| (a.to_string(), b)).unwrap_or((url.clone(), ""));
        if u[n..].split(['?']).next().unwrap_or("").contains("/.") {
            return py("30x の行き先の道に . の段（urljoin が畳む）");
        }
        return Ok(format!("{scheme}://{}", &url[n..]));
    }
    if loc.starts_with('/') && !loc.starts_with("//") {
        if loc.split(['?', '#']).next().unwrap_or("").contains("/.") {
            return py("30x の行き先の道に . の段（urljoin が畳む）");
        }
        return Ok(format!("{}://{}{loc}", cur.scheme(), cur.netloc));
    }
    py("30x の行き先が http の URL でも絶対の道でもない（urllib は urljoin・ほかの種類）")
}

/// スケジュールの問い合わせの仕方（版 3.117.1）
#[derive(Debug, Clone, Default)]
pub struct Net {
    /// システムのプロキシ（use_system_proxy。None は直）
    pub proxy: Option<System>,
}

/// 取った道（最初の問い合わせ。状態と GET /api/schedule に書く）
#[derive(Debug, Clone, PartialEq)]
pub struct Via {
    pub tls: bool,
    pub proxy: Option<String>,
}

/// 行き先ごとのつなぐ先（Python の ProxyHandler: 30x のたびに行き先の名前で決め直す）
fn route_of(t: &Target, n: &Net, proxies: &[(String, String)]) -> H<Route> {
    let Some(sys) = &n.proxy else { return Ok(Route::Direct) };
    let host = t.netloc.clone();
    match crate::sysproxy::choose(t.scheme(), &host, proxies, &|h| sys.bypass(h)) {
        Ok(Choice::Direct) => Ok(Route::Direct),
        Ok(Choice::Proxy(hp)) => Ok(Route::Proxy(hp)),
        Err(m) => Err(X::F(Fail::Cm3(m))),
    }
}

/// CM3 へ POST して答えを受ける（30x をたどり、2xx でなければ HTTP の誤り）。http の直だけ（前の形。試験と LotDsp の部品のため）
pub fn post(url: &str, base: &str, body: &[u8], timeout: Duration) -> R<Resp> {
    let r = legacy(follow(url, body, timeout, &|t, b| headers_for(t, b, base), false, &Net::default(), &mut None))?;
    if (200..300).contains(&r.status) {
        return Ok(r);
    }
    Err(Fail::Cm3(format!("予定の元がHTTPエラーを返しました: {} {}", r.status, r.reason)))
}

/// スケジュールの CM3 への POST（版 3.117.1: https とシステムのプロキシ。届かない言葉は cm3_net の種類ごとの字に、PAC の一言 note を足す）
pub fn post_cm3(url: &str, base: &str, body: &[u8], timeout: Duration, n: &Net) -> (R<Resp>, Option<Via>) {
    let mut via = None;
    let note = n.proxy.as_ref().map(crate::sysproxy::pac_note).unwrap_or("");
    let r = follow(url, body, timeout, &|t, b| headers_for(t, b, base), true, n, &mut via);
    let r = match r {
        Ok(r) if (200..300).contains(&r.status) => Ok(r),
        // プロキシの認証（利用者の決め: 認証は無い。対応していない）
        Ok(r) if r.status == 407 => Err(Fail::Cm3(crate::cm3_net::message(Kind::ProxyAuth, "", ""))),
        Ok(r) => Err(Fail::Cm3(format!("予定の元がHTTPエラーを返しました: {} {}", r.status, r.reason))),
        // 設定の誤り（unknown url type・no host given）と Python に任せる形は前のまま
        Err(X::F(f)) => Err(f),
        // プロキシの言葉（届かない・その先で切れた・答えを読めない）は、その問い合わせ（30x の行き先ごと）のプロキシで open・once が決めた
        // （版 3.117.1 の作った後の直し・割れ 5: 前は最初の問い合わせにプロキシがあれば、届いた後の誤りも 30x の後の直の誤りも「届きません」）
        Err(X::N { kind, detail, .. }) => Err(Fail::Cm3(crate::cm3_net::message(kind, &detail, note))),
    };
    (r, via)
}

/// LotDsp の API へ POST する（版 3.98.0。src/lotdsp.rs。urllib.request の Request〈data・Accept・Content-Type〉と同じ見出し:
/// Origin・Referer は付けない）。2xx でない答えも Ok（呼ぶ側が HTTPError の扱いをする）
pub fn post_plain(url: &str, body: &[u8], timeout: Duration) -> R<Resp> {
    legacy(follow(
        url,
        body,
        timeout,
        &|t, b| {
            let mut h = headers_for(t, b, "");
            h.retain(|(k, _)| k != "Origin" && k != "Referer");
            h
        },
        false,
        &Net::default(),
        &mut None,
    ))
}

/// GET を 1 回（版 3.98.0。LotDsp に届くかの確かめ。30x はたどらない: 答えが返れば届いている）
pub fn get_once(url: &str, timeout: Duration) -> R<Resp> {
    let t = target(url)?;
    let h = vec![
        ("Host".to_string(), t.netloc.clone()),
        ("User-Agent".to_string(), USER_AGENT.to_string()),
        ("Connection".to_string(), "close".to_string()),
    ];
    legacy(once(&t, &Route::Direct, "GET", &h, None, timeout, true))
}

/// 確かめるの言葉（Python の cm3_schedule.REACH_NOT_HTTP・REACH_UNKNOWN）
pub const REACH_NOT_HTTP: &str = "予定の元の URL は http:// か https:// で始めてください。";
pub const REACH_UNKNOWN: &str = "予定の元に届きません（社外・VPN 未接続・場所の間違い）。";

/// CM3 に届くか（参照先・データ元の「確かめる」。版 3.117.1 の作った後の直し・割れ 2。Python の cm3_schedule.reach と同じ）: スケジュールを
/// 取る道と同じ取り手（https・システムのプロキシ・届かない言葉）で GET を 1 回（30x はたどらない・本文は読まない）。HTTP の答えが返れば
/// 届いている（プロキシの答え 407・502・503・504 は届いていない: lotdsp::rules::reached_status）。Err は届かない言葉。
/// 前は LotDsp の get_once（プロキシを通さない http だけ）で、https の CM3 にいつも「届きません」と言った
pub fn reach(url: &str, timeout: Duration, n: &Net) -> Result<(), String> {
    // 種類（urllib の Request の分け方: ([^/:]+):）が http・https でなければ確かめない
    let scheme = url.find(':').filter(|i| *i > 0 && !url[..*i].contains('/')).map(|i| url[..i].to_ascii_lowercase());
    if !matches!(scheme.as_deref(), Some("http" | "https")) {
        return Err(REACH_NOT_HTTP.into());
    }
    let note = n.proxy.as_ref().map(crate::sysproxy::pac_note).unwrap_or("");
    let said = |e: X| match e {
        X::F(Fail::Cm3(m)) => m,
        X::F(Fail::Python(_)) => REACH_UNKNOWN.to_string(),
        X::N { kind, detail, .. } => crate::cm3_net::message(kind, &detail, note),
    };
    let t = target_with(url, true).map_err(|f| said(X::F(f)))?;
    let proxies = n.proxy.as_ref().map(System::proxies).unwrap_or_default();
    let route = route_of(&t, n, &proxies).map_err(said)?;
    let h = vec![
        ("Host".to_string(), t.netloc.clone()),
        ("User-Agent".to_string(), USER_AGENT.to_string()),
        ("Connection".to_string(), "close".to_string()),
    ];
    let r = once(&t, &route, "GET", &h, None, timeout, false).map_err(said)?;
    if crate::lotdsp::rules::reached_status(r.status as i64) {
        Ok(())
    } else if r.status == 407 {
        Err(crate::cm3_net::message(Kind::ProxyAuth, "", ""))
    } else {
        Err(format!("予定の元がHTTPエラーを返しました: {} {}", r.status, r.reason))
    }
}

type Heads<'a> = &'a dyn Fn(&Target, Option<&[u8]>) -> Vec<(String, String)>;

/// POST して 30x をたどる（urllib の HTTPRedirectHandler と同じ）。たどった後の答え（2xx でなければ HTTP の誤りの答え）。
/// https: https の URL も取るか。via: 最初の問い合わせの道を書く
fn follow(url: &str, body: &[u8], timeout: Duration, heads: Heads, https: bool, n: &Net, via: &mut Option<Via>) -> H<Resp> {
    let mut t = target_with(url, https)?;
    // getproxies は opener を作るときに 1 回（Python の build_opener）
    let proxies = n.proxy.as_ref().map(System::proxies).unwrap_or_default();
    let mut method = "POST";
    let mut visited: Vec<(String, u32)> = vec![];
    loop {
        let route = route_of(&t, n, &proxies)?;
        if via.is_none() {
            *via = Some(Via {
                tls: t.tls,
                proxy: match &route {
                    Route::Proxy(hp) => Some(hp.clone()),
                    Route::Direct => None,
                },
            });
        }
        let post_body = (method == "POST").then_some(body);
        let mut r = once(&t, &route, method, &heads(&t, post_body), post_body, timeout, true)?;
        if (200..300).contains(&r.status) || !matches!(r.status, 301 | 302 | 303 | 307 | 308) {
            return Ok(r);
        }
        let Some(loc) = r.header("location").or_else(|| r.header("uri")).map(str::to_string) else {
            return Ok(r);
        };
        let low = loc.to_ascii_lowercase();
        let scheme = low.find(':').map(|i| &low[..i]).filter(|s| !s.contains(['/', '?', '#']));
        if scheme.is_some_and(|s| !matches!(s, "http" | "https" | "ftp")) {
            return py("30x の行き先が許されない種類（urllib は HTTPError の文に URL を入れる）");
        }
        // POST の 307・308 は urllib がたどらない（行き先の種類を見た後・行き先を組む前）
        if method == "POST" && matches!(r.status, 307 | 308) {
            return Ok(r);
        }
        if scheme.is_some_and(|s| s == "ftp" || (s == "https" && !https)) {
            return py("30x の行き先が https・ftp");
        }
        let new_url = redirect_url(&t, &loc, https)?;
        let seen = visited.iter().find(|(u, _)| *u == new_url).map(|x| x.1).unwrap_or(0);
        if seen >= 4 || visited.len() >= 10 {
            r.reason = format!("{INF_MSG}{}", r.reason);
            return Ok(r);
        }
        match visited.iter_mut().find(|(u, _)| *u == new_url) {
            Some(x) => x.1 += 1,
            None => visited.push((new_url.clone(), 1)),
        }
        if method == "POST" {
            method = "GET";
        }
        t = target_with(&new_url, https)?;
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
        assert_eq!(target("nlmfangyweb1a:9085/x"), Err(Fail::Cm3("予定の元に接続できません: unknown url type: nlmfangyweb1a".into())));
        assert_eq!(target("http:///x"), Err(Fail::Cm3("予定の元に接続できません: no host given".into())));
        assert!(matches!(target("https://h/x"), Err(Fail::Python(_))));
        assert!(matches!(target("nohost"), Err(Fail::Python(_))));
        assert!(matches!(target("http://h:99999/"), Err(Fail::Python(_))));
        assert_eq!(split3("HTTP/1.1  200   OK  then "), ["HTTP/1.1", "200", "OK  then "]);
    }
}
