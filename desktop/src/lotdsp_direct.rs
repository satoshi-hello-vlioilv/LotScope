//! このアプリで LotDsp の進度情報を読む（見えない Edge・LotDsp の窓）。版 3.98.0 で Python の services/lotdsp_direct.py を写した
//! （窓がただ 1 つの係: 見えない Edge・錠・中止・LotDsp の窓のプロファイルはプロセスに 1 つしか持てないので、Python は答えない）。
//!
//! 写した決まりと、版 3.98.0 で Python と一緒に直した所:
//! - ログインはしない（ログインの欄が見えたら何も押さずに kind login。LotDsp の窓では利用者がログインするのを待つ）
//! - 見えない Edge は一時プロファイル（tpa-lotdsp-*）で動かし、閉じたら消す。窓（lotdsp-window）はプロファイルを残す
//! - 同時に 1 つ（錠）・途中の段（status）・中止（cancel）。中止はどの待ちの間も 0.1 秒ごとに見る（前は届くかの確かめ・
//!   DevToolsActivePort の待ちで最大 15 秒効かなかった）
//! - 閉じる決めは 1 か所（rules::keep_of: 見えない Edge は keep_seconds・窓は window_keep_seconds）。見張りは 1 つで、
//!   ブラウザの世代（gen）が替われば、いまのブラウザの秒数で測り直す（前は見えない Edge の見張りが後から開いた窓を 300 秒で閉じた）
//! - 届くかはプロキシを通さない 1 回だけ。プロキシの答え（407・502・503・504）は届いていない（決め ③）
//! - Windows: 起こした Edge は窓のジョブ（Job Object・閉じると中のプロセスを止める）に入れる（窓が落ちても見えない Edge を残さない。
//!   panic=abort では Drop が走らない）・黒い窓を出さない（CREATE_NO_WINDOW）・起動のときに前の一時プロファイルの残りを消す
//!
//! 作り物の DevTools（program/tests/lotdsp_cdp_fake.py）と差し替えた時計で、Python の係と同じ答え・段・送った命令かを
//! desktop/tests/lotdsp_parity.rs で突き合わせる。

use crate::lotdsp::rules;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// ページの中で動かす手順（Python と同じファイルを焼く）
pub const SCRIPT: &str = include_str!("../../program/app/services/lotdsp_direct.js");
pub const STAGES: [&str; 6] = ["reach", "open", "load", "login", "search", "read"];

const PAGE_STATE: &str = r#"(() => {
  const norm = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, '');
  let lot = '';
  for (const t of document.querySelectorAll('table')) {
    const r = t.rows;
    if (r.length === 2 && r[0].cells.length === 1 && norm(r[0].textContent) === 'ロット番号') { lot = norm(r[1].textContent).toUpperCase(); break; }
  }
  return [location.href, document.readyState, lot];
})()"#;
const LOGIN_SHOWN: &str = r#"(() => {
  const shown = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  return shown(document.querySelector('#input_userId')) || [...document.querySelectorAll('button')].some((b) => shown(b) && /ログイン/.test(b.textContent || ''));
})()"#;
const PREFILL: &str = r#"((lot) => {
  for (const id of ['input_searchLtno', 'common_searchLtno']) {
    const el = document.getElementById(id);
    if (el && !el.value) { el.value = lot; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  return true;
})(__LOT__)"#;
const STATE_Q: &str = "window.__tpaDirect ? [window.__tpaDirect.stage, window.__tpaDirect.result] : null";

#[derive(Debug, Clone, PartialEq)]
pub struct DirectError {
    pub kind: String,
    pub msg: String,
}

fn err<T>(kind: &str, msg: impl Into<String>) -> Result<T, DirectError> {
    Err(DirectError { kind: kind.into(), msg: msg.into() })
}

type R<T> = Result<T, DirectError>;

// ------------------------------------------------------------------ 設定
#[derive(Debug, Clone)]
pub struct Cfg {
    pub enabled: bool,
    pub url: String,
    pub search_url: String,
    pub browser: String,
    pub timeout: f64,
    pub reach_timeout: f64,
    pub start_timeout: f64,
    pub extra_args: Vec<String>,
    pub keep: f64,
    pub login_window: bool,
    pub login_wait: f64,
    pub window_keep: f64,
    pub window_profile: PathBuf,
}

/// fsio.unquote_path: str(value or "").strip().strip('"')
pub fn unquote_path(v: Option<&Value>) -> String {
    let s = crate::lotdsp::py_text(v);
    crate::pyfmt::strip(&s).trim_matches('"').to_string()
}

impl Cfg {
    /// lotdsp_direct.settings_of(effective の lotdsp_import)。読めない数は Err（設定の誤り）
    pub fn from(li: &Value, local_root: &Path) -> Result<Cfg, String> {
        let d = crate::lotdsp::section(li, "direct");
        let url = crate::pyfmt::strip(&crate::lotdsp::py_text(li.get("url"))).to_string();
        let num = |k: &str, def: f64| crate::lotdsp::py_float_of(d.get(k), def).map_err(|e| format!("lotdsp_import.direct.{k}: {e}"));
        let flag = |k: &str| d.get(k).map(|v| crate::lotdsp::truthy(Some(v))).unwrap_or(true);
        let search = crate::lotdsp::py_text(d.get("search_url"));
        let extra = match d.get("extra_args") {
            None | Some(Value::Null) => vec![],
            Some(Value::Array(a)) => a.iter().map(crate::lotdsp::py_str_value).collect(),
            Some(Value::String(s)) => s.chars().map(String::from).collect(),
            Some(Value::Object(o)) => o.keys().cloned().collect(),
            Some(x) if !crate::lotdsp::truthy(Some(x)) => vec![],
            Some(_) => return Err("lotdsp_import.direct.extra_args が並びでない".into()),
        };
        let profile = unquote_path(d.get("window_profile"));
        Ok(Cfg {
            enabled: flag("enabled") && !url.is_empty(),
            search_url: if search.is_empty() { rules::direct_search_url(&url) } else { search },
            url,
            browser: unquote_path(d.get("browser")),
            timeout: num("timeout_seconds", 60.0)?,
            reach_timeout: num("reach_timeout_seconds", 4.0)?,
            start_timeout: num("start_timeout_seconds", 15.0)?,
            extra_args: extra,
            keep: num("keep_seconds", 300.0)?,
            login_window: flag("login_window"),
            login_wait: num("login_wait_seconds", 300.0)?,
            window_keep: num("window_keep_seconds", 1800.0)?,
            window_profile: if profile.is_empty() { local_root.join("lotdsp-window") } else { PathBuf::from(profile) },
        })
    }

    /// rules::keep_of（見えない Edge は keep_seconds・LotDsp の窓は window_keep_seconds）
    pub fn keep_of(&self, visible: bool) -> f64 {
        if visible {
            self.window_keep
        } else {
            self.keep
        }
    }
}

// ------------------------------------------------------------------ ブラウザの場所（版 3.52.1 の決まり）
pub fn browser_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["msedge.exe", "chrome.exe"]
    } else {
        &["msedge", "microsoft-edge", "microsoft-edge-stable", "google-chrome", "chrome", "chromium", "chromium-browser"]
    }
}

fn browser_roots() -> Vec<PathBuf> {
    ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"]
        .iter()
        .filter_map(|k| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from))
        .collect()
}

/// file_name（Windows は / と \ の両方で切る: PureWindowsPath の name）
fn name_of(p: &str) -> String {
    let cut = if cfg!(windows) { p.rsplit(['\\', '/']).next() } else { p.rsplit('/').next() };
    cut.unwrap_or("").to_string()
}

/// Windows の道を比べる形（\\?\ を除き、区切りを \ に、大小を見ない）
#[cfg(any(windows, test))]
fn win_key(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    let s = s.strip_prefix("\\\\?\\UNC\\").map(|x| format!("\\\\{x}")).unwrap_or(s);
    let s = s.strip_prefix("\\\\?\\").map(str::to_string).unwrap_or(s);
    s.trim_end_matches('\\').to_lowercase()
}

/// real が root の下か（Windows の is_relative_to: 区切りの段ごと・大小を見ない）
#[cfg(any(windows, test))]
fn win_under(real: &Path, root: &Path) -> bool {
    let (a, b) = (win_key(real), win_key(root));
    a == b || a.starts_with(&format!("{b}\\"))
}

/// 設定のブラウザを起こしてよいか → 理由（よければ ""）
pub fn trusted_browser(path: &str) -> String {
    let names = browser_names();
    if !names.contains(&name_of(path).to_lowercase().as_str()) {
        return format!("ブラウザは {} だけを指せます（安全のため、ほかの実行ファイルは起こしません）。", names.join("・"));
    }
    #[cfg(windows)]
    {
        if path.starts_with("\\\\") || path.starts_with("//") {
            return "ネットワークの場所のブラウザは起こしません（この PC の Program Files にある物を指してください）。".into();
        }
        let resolve = |p: &Path| std::fs::canonicalize(p).or_else(|_| std::path::absolute(p));
        let Ok(real) = resolve(Path::new(path)) else { return "そのファイルがありません。".into() };
        if !browser_roots().iter().any(|r| resolve(r).map(|r| win_under(&real, &r)).unwrap_or(false)) {
            return "Program Files か、この人の AppData の下にあるブラウザだけを指せます。".into();
        }
    }
    String::new()
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for cand in [dir.join(name), dir.join(format!("{name}.exe"))] {
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

/// 使うブラウザ（設定があればそれ〈Edge・Chrome の決まった形だけ〉、無ければ Edge → Chrome の既知の場所）
pub fn find_browser(configured: &str) -> Option<String> {
    if !configured.is_empty() {
        return (trusted_browser(configured).is_empty() && Path::new(configured).is_file()).then(|| configured.to_string());
    }
    if let Ok(env) = std::env::var("TPA_LOTDSP_BROWSER") {
        if !env.is_empty() && Path::new(&env).is_file() {
            return Some(env);
        }
    }
    let mut cands: Vec<PathBuf> = vec![];
    if cfg!(windows) {
        for base in browser_roots() {
            cands.push(base.join("Microsoft").join("Edge").join("Application").join("msedge.exe"));
            cands.push(base.join("Google").join("Chrome").join("Application").join("chrome.exe"));
        }
    }
    for name in ["msedge", "microsoft-edge", "microsoft-edge-stable", "google-chrome", "chromium", "chromium-browser"] {
        if let Some(w) = which(name) {
            cands.push(w);
        }
    }
    cands.into_iter().find(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned())
}

/// LotDsp のサイトへ届くか（プロキシを通さない 1 回だけ。HTTP の答えでもプロキシの答えは届いていない）
pub fn reachable(url: &str, timeout: f64) -> bool {
    if timeout.is_nan() || timeout <= 0.0 {
        return false;
    }
    match crate::cm3_http::get_once(url, Duration::from_secs_f64(timeout.min(3600.0))) {
        Ok(r) => rules::reached_status(r.status as i64),
        Err(_) => false,
    }
}

// ------------------------------------------------------------------ WebSocket（DevTools 用の最小限）
fn mask_key() -> [u8; 4] {
    let mut m = [0u8; 4];
    let _ = getrandom::fill(&mut m);
    m
}

fn b64(data: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let n = chunk.iter().fold(0u32, |acc, x| (acc << 8) | *x as u32) << (8 * (3 - chunk.len()));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(A[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// 枠を作る（送る側は必ずマスクする）
pub fn frame(opcode: u8, payload: &[u8], mask: [u8; 4]) -> Vec<u8> {
    let mut f = vec![0x80 | opcode];
    let n = payload.len();
    if n < 126 {
        f.push(0x80 | n as u8);
    } else if n < 65536 {
        f.push(0x80 | 126);
        f.extend_from_slice(&(n as u16).to_be_bytes());
    } else {
        f.push(0x80 | 127);
        f.extend_from_slice(&(n as u64).to_be_bytes());
    }
    f.extend_from_slice(&mask);
    f.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
    f
}

/// 揃った枠を 1 つ取り出す → (fin, opcode, payload)。揃っていなければ None（読んだ途中の字は捨てない）
pub fn take_frame(buf: &mut Vec<u8>) -> Option<(bool, u8, Vec<u8>)> {
    if buf.len() < 2 {
        return None;
    }
    let (b1, b2) = (buf[0], buf[1]);
    let (mut n, mut at) = ((b2 & 0x7F) as u64, 2usize);
    if n == 126 {
        if buf.len() < 4 {
            return None;
        }
        n = u16::from_be_bytes([buf[2], buf[3]]) as u64;
        at = 4;
    } else if n == 127 {
        if buf.len() < 10 {
            return None;
        }
        n = u64::from_be_bytes(buf[2..10].try_into().unwrap());
        at = 10;
    }
    let mask = if b2 & 0x80 != 0 {
        if buf.len() < at + 4 {
            return None;
        }
        let m = [buf[at], buf[at + 1], buf[at + 2], buf[at + 3]];
        at += 4;
        Some(m)
    } else {
        None
    };
    let n = usize::try_from(n).ok()?;
    if buf.len() < at + n {
        return None;
    }
    let mut payload: Vec<u8> = buf[at..at + n].to_vec();
    if let Some(m) = mask {
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= m[i % 4];
        }
    }
    buf.drain(..at + n);
    Some((b1 & 0x80 != 0, b1 & 0x0F, payload))
}

pub struct Ws {
    sock: TcpStream,
    buf: Vec<u8>,
    parts: Vec<u8>,
    pub url: String,
}

impl Ws {
    pub fn connect(url: &str, timeout: f64) -> R<Ws> {
        let rest = url
            .strip_prefix("ws://")
            .ok_or(DirectError { kind: "browser".into(), msg: "ブラウザのページに接続できませんでした".into() })?;
        let (hostport, path) = rest.split_once('/').map(|(a, b)| (a, format!("/{b}"))).unwrap_or((rest, "/".into()));
        let addr = std::net::ToSocketAddrs::to_socket_addrs(hostport)
            .ok()
            .and_then(|mut a| a.next())
            .ok_or(DirectError { kind: "browser".into(), msg: "ブラウザのページに接続できませんでした".into() })?;
        let t = Duration::from_secs_f64(timeout.max(0.1));
        let mut sock = TcpStream::connect_timeout(&addr, t)
            .map_err(|_| DirectError { kind: "browser".into(), msg: "ブラウザのページに接続できませんでした".into() })?;
        let _ = sock.set_nodelay(true);
        let mut key = [0u8; 16];
        let _ = getrandom::fill(&mut key);
        let req = format!(
            "GET {path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {}\r\nSec-WebSocket-Version: 13\r\n\r\n",
            b64(&key)
        );
        let _ = sock.set_write_timeout(Some(t));
        sock.write_all(req.as_bytes())
            .map_err(|_| DirectError {
                kind: "browser".into(), msg: "ブラウザとの接続が切れました（DevTools の握手）".into()
            })?;
        let _ = sock.set_read_timeout(Some(t));
        let mut head: Vec<u8> = vec![];
        let mut chunk = [0u8; 4096];
        while !head.windows(4).any(|w| w == b"\r\n\r\n") {
            match sock.read(&mut chunk) {
                Ok(0) | Err(_) => return err("browser", "ブラウザとの接続が切れました（DevTools の握手）"),
                Ok(n) => head.extend_from_slice(&chunk[..n]),
            }
        }
        let end = head.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let first = head[..end].split(|b| *b == b'\n').next().unwrap_or(&[]);
        if !first.windows(5).any(|w| w == b" 101 ") {
            return err("browser", "ブラウザが DevTools の接続を断りました（管理者の設定で止められている可能性があります）");
        }
        Ok(Ws { sock, buf: head[end + 4..].to_vec(), parts: vec![], url: url.to_string() })
    }

    pub fn send(&mut self, text: &str) -> R<()> {
        self.sock
            .write_all(&frame(0x1, text.as_bytes(), mask_key()))
            .map_err(|_| DirectError { kind: "browser".into(), msg: "ブラウザとの接続が切れました".into() })
    }

    /// 1 つの文を受ける。deadline（時計の秒）を過ぎたら Ok(None)。待つ間は 0.1 秒ごとに check（中止）を見る
    pub fn recv(&mut self, deadline: f64, now: &dyn Fn() -> f64, check: &dyn Fn() -> R<()>) -> R<Option<String>> {
        loop {
            match take_frame(&mut self.buf) {
                None => {
                    check()?;
                    if now() > deadline {
                        return Ok(None);
                    }
                    let _ = self.sock.set_read_timeout(Some(Duration::from_millis(100)));
                    let mut chunk = vec![0u8; 65536];
                    match self.sock.read(&mut chunk) {
                        Ok(0) => return err("browser", "ブラウザとの接続が切れました"),
                        Ok(n) => self.buf.extend_from_slice(&chunk[..n]),
                        Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
                        Err(_) => return err("browser", "ブラウザとの接続が切れました"),
                    }
                }
                Some((fin, opcode, payload)) => match opcode {
                    0x9 => {
                        let _ = self.sock.write_all(&frame(0xA, &payload[..payload.len().min(125)], mask_key()));
                    }
                    0x8 => return err("browser", "ブラウザが接続を閉じました"),
                    0x0..=0x2 => {
                        self.parts.extend_from_slice(&payload);
                        if fin {
                            let all = std::mem::take(&mut self.parts);
                            return Ok(Some(String::from_utf8_lossy(&all).into_owned()));
                        }
                    }
                    _ => {}
                },
            }
        }
    }

    pub fn close(&mut self) {
        let _ = self.sock.shutdown(std::net::Shutdown::Both);
    }
}

// ------------------------------------------------------------------ ページ（DevTools Protocol）
/// 1 つのページへの呼び出し（試験は作り物に差し替える）
pub trait Page: Send {
    /// 呼んで答え（result）を待つ。timeout 秒で screen「時間切れ」。cancellable なら待つ間に中止を見る
    fn call(&mut self, method: &str, params: Value, timeout: f64, cancellable: bool, cx: &Cx) -> R<Value>;
    fn close(&mut self);
    fn url(&self) -> String;
}

/// 時計と中止（呼ぶ側の文脈）
pub struct Cx<'a> {
    pub now: &'a (dyn Fn() -> f64 + Send + Sync),
    pub cancel: &'a dyn Fn() -> R<()>,
}

pub struct Cdp {
    ws: Ws,
    next_id: u64,
}

impl Cdp {
    pub fn connect(ws_url: &str, timeout: f64) -> R<Cdp> {
        Ok(Cdp { ws: Ws::connect(ws_url, timeout)?, next_id: 0 })
    }
}

impl Page for Cdp {
    fn call(&mut self, method: &str, params: Value, timeout: f64, cancellable: bool, cx: &Cx) -> R<Value> {
        self.next_id += 1;
        let mid = self.next_id;
        let body = json!({"id": mid, "method": method, "params": if params.is_null() { json!({}) } else { params }});
        self.ws.send(&body.to_string())?;
        let deadline = (cx.now)() + timeout;
        let none = || Ok(());
        let check: &dyn Fn() -> R<()> = if cancellable { cx.cancel } else { &none };
        loop {
            let Some(text) = self.ws.recv(deadline, cx.now, check)? else {
                return err("screen", "ロット問い合わせの画面の応答がありません（時間切れ）");
            };
            let Ok(msg) = serde_json::from_str::<Value>(&text) else { return err("browser", "ブラウザの答えを読めません") };
            if msg.get("id").and_then(Value::as_u64) == Some(mid) {
                if let Some(e) = msg.get("error") {
                    let m = e.get("message").map(crate::lotdsp::py_str_value).unwrap_or_default();
                    return err("browser", format!("ブラウザの操作に失敗しました（{m}）"));
                }
                return Ok(match msg.get("result") {
                    Some(r) if crate::lotdsp::truthy(Some(r)) => r.clone(),
                    _ => json!({}),
                });
            }
        }
    }

    fn close(&mut self) {
        self.ws.close();
    }

    fn url(&self) -> String {
        self.ws.url.clone()
    }
}

/// Runtime.evaluate（returnByValue）→ 値。ページの中の誤りは screen
pub fn eval(p: &mut dyn Page, expr: &str, timeout: f64, cx: &Cx) -> R<Value> {
    let r = p.call("Runtime.evaluate", json!({"expression": expr, "returnByValue": true, "awaitPromise": false}), timeout, true, cx)?;
    if let Some(d) = r.get("exceptionDetails").filter(|d| crate::lotdsp::truthy(Some(d))) {
        let desc = d.get("exception").and_then(|e| e.get("description")).filter(|x| crate::lotdsp::truthy(Some(x))).or(d.get("text"));
        let t = desc.map(crate::lotdsp::py_str_value).unwrap_or_else(|| "None".into());
        return err("screen", format!("ページの中の手順が止まりました（{t}）"));
    }
    Ok(r.get("result").and_then(|x| x.get("value")).cloned().unwrap_or(Value::Null))
}

// ------------------------------------------------------------------ 起こしたブラウザ
/// 起こしたプロセス（試験は作り物）
pub trait Proc: Send {
    fn alive(&mut self) -> bool;
    /// secs 秒まで終わるのを待つ（終われば true）
    fn wait(&mut self, secs: f64) -> bool;
    fn kill(&mut self);
}

pub struct Child(pub std::process::Child);

impl Proc for Child {
    fn alive(&mut self) -> bool {
        matches!(self.0.try_wait(), Ok(None))
    }
    fn wait(&mut self, secs: f64) -> bool {
        let end = std::time::Instant::now() + Duration::from_secs_f64(secs.max(0.0));
        loop {
            if !self.alive() {
                return true;
            }
            if std::time::Instant::now() >= end {
                return false;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    fn kill(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub struct Browser {
    pub exe: String,
    pub extra: Vec<String>,
    pub visible: bool,
    keep_profile: bool,
    pub profile: PathBuf,
    proc: Option<Box<dyn Proc>>,
    pub page: Option<Box<dyn Page>>,
    pub used: f64,
    pub gen: u64,
}

impl Browser {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        exe: &str,
        extra: &[String],
        visible: bool,
        profile: PathBuf,
        keep_profile: bool,
        proc: Box<dyn Proc>,
        page: Box<dyn Page>,
        now: f64,
    ) -> Browser {
        Browser {
            exe: exe.into(),
            extra: extra.to_vec(),
            visible,
            keep_profile,
            profile,
            proc: Some(proc),
            page: Some(page),
            used: now,
            gen: 0,
        }
    }

    pub fn alive(&mut self) -> bool {
        self.proc.as_mut().is_some_and(|p| p.alive())
    }

    pub fn close(&mut self, cx: &Cx) {
        let polite = self.page.is_some();
        if let Some(mut p) = self.page.take() {
            let _ = p.call("Browser.close", json!({}), 3.0, false, cx);
            p.close();
        }
        if let Some(mut proc) = self.proc.take() {
            // DevTools につながる前（起動を待つ間の中止など）は、閉じてと頼めないのですぐ止める
            if !proc.wait(if polite { 5.0 } else { 0.1 }) {
                proc.kill();
            }
        }
        if !self.keep_profile {
            remove_profile(&self.profile);
        }
    }

    fn page(&mut self) -> &mut dyn Page {
        self.page.as_mut().expect("ページ").as_mut()
    }
}

fn remove_profile(p: &Path) {
    for _ in 0..10 {
        let _ = std::fs::remove_dir_all(p);
        if !p.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(300)); // Windows ではブラウザが消えるまでファイルが掴まれている
    }
}

/// 起動のときに、前に落ちた窓が残した一時プロファイル（tpa-lotdsp-*。1 分より前に書いた物）を消す
pub fn sweep_profiles() {
    let Ok(rd) = std::fs::read_dir(std::env::temp_dir()) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|d| d > Duration::from_secs(60));
        if name.starts_with("tpa-lotdsp-") && old && e.path().is_dir() {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

/// ブラウザを起こす係（試験は作り物の DevTools・作り物のプロセス）
pub trait Launch: Send + Sync {
    fn launch(
        &self,
        exe: &str,
        extra: &[String],
        visible: bool,
        profile: &Path,
        start_timeout: f64,
        cx: &Cx,
    ) -> R<(Box<dyn Proc>, Box<dyn Page>)>;
    fn find_browser(&self, configured: &str) -> Option<String> {
        find_browser(configured)
    }
    fn reachable(&self, url: &str, timeout: f64) -> bool {
        reachable(url, timeout)
    }
}

/// 本物のブラウザ（Edge・Chrome）を起こす
pub struct RealLaunch;

#[cfg(windows)]
fn job_assign(child: &std::process::Child) {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    // 窓のプロセスに 1 つのジョブ。閉じる（窓が終わる・落ちる）と、中のプロセス（起こした Edge とその子）を止める
    static JOB: OnceLock<usize> = OnceLock::new();
    let h = *JOB.get_or_init(|| unsafe {
        let Ok(h) = CreateJobObjectW(None, windows::core::PCWSTR::null()) else { return 0 };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let _ = SetInformationJobObject(
            h,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        h.0 as usize
    });
    if h != 0 {
        unsafe {
            let _ = AssignProcessToJobObject(HANDLE(h as *mut std::ffi::c_void), HANDLE(child.as_raw_handle()));
        }
    }
}

fn devtools_port(profile: &Path, proc: &mut dyn Proc, timeout: f64, cx: &Cx) -> R<u16> {
    let f = profile.join("DevToolsActivePort");
    let end = (cx.now)() + timeout;
    while (cx.now)() < end {
        (cx.cancel)()?;
        if !proc.alive() {
            return err(
                "browser",
                "ブラウザがすぐに終わりました（管理者の設定でヘッドレス起動・DevTools が止められている可能性があります）",
            );
        }
        if let Ok(t) = std::fs::read_to_string(&f) {
            if let Some(Ok(p)) = t.lines().next().map(crate::pyfmt::py_int) {
                if p != 0 && (1..=65535).contains(&p) {
                    return Ok(p as u16);
                }
            }
        }
        nap(0.1, cx)?;
    }
    err(
        "browser",
        format!(
            "ブラウザの DevTools が開きませんでした（{} 秒待ちました。管理者の設定で止められているか、起動に時間がかかっている可能性があります）",
            crate::lotdsp::py_g(timeout, 6)
        ),
    )
}

/// /json/list のページの口（skip の口は飛ばす）
fn page_ws(port: u16, timeout: f64, skip: &[String], cx: &Cx) -> R<String> {
    let end = (cx.now)() + timeout;
    while (cx.now)() < end {
        if let Ok(r) = crate::cm3_http::get_once(&format!("http://127.0.0.1:{port}/json/list"), Duration::from_secs(3)) {
            if let Ok(Value::Array(list)) = serde_json::from_slice::<Value>(&r.body) {
                let pages: Vec<String> = list
                    .iter()
                    .filter(|t| t.get("type").and_then(Value::as_str) == Some("page"))
                    .filter_map(|t| t.get("webSocketDebuggerUrl").and_then(Value::as_str).filter(|u| !u.is_empty()).map(String::from))
                    .filter(|u| !skip.contains(u))
                    .collect();
                if let Some(p) = pages.into_iter().next() {
                    return Ok(p);
                }
            }
        }
        nap(0.1, cx)?;
    }
    err("browser", "ブラウザのページに接続できませんでした")
}

impl Launch for RealLaunch {
    fn launch(
        &self,
        exe: &str,
        extra: &[String],
        visible: bool,
        profile: &Path,
        start_timeout: f64,
        cx: &Cx,
    ) -> R<(Box<dyn Proc>, Box<dyn Page>)> {
        let mut args: Vec<String> = if visible {
            vec!["--app=about:blank".into(), "--window-size=1280,900".into()]
        } else {
            vec!["--headless=new".into(), "--disable-gpu".into(), "--window-size=1600,1000".into()]
        };
        args.extend([
            "--remote-debugging-port=0".to_string(),
            format!("--user-data-dir={}", profile.display()),
            "--no-first-run".into(),
            "--no-default-browser-check".into(),
            "--disable-extensions".into(),
            "--disable-sync".into(),
            "--disable-background-networking".into(),
            "--disable-component-update".into(),
        ]);
        args.extend(extra.iter().cloned());
        if !visible {
            args.push("about:blank".into());
        }
        let mut cmd = std::process::Command::new(exe);
        cmd.args(&args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: 黒い窓を出さない
        }
        let child = cmd.spawn().map_err(|e| DirectError {
            kind: "browser".into(),
            msg: format!("ブラウザを起こせません（{}）", crate::cm3_http::os_text(&e)),
        })?;
        #[cfg(windows)]
        job_assign(&child);
        let mut proc: Box<dyn Proc> = Box::new(Child(child));
        let started = (|| {
            let port = devtools_port(profile, proc.as_mut(), start_timeout, cx)?;
            // ページが出るまで待つ長さも起動を待つ長さにそろえる（版 3.52.1）
            let page_timeout = start_timeout.max(10.0);
            let mut skip: Vec<String> = vec![];
            loop {
                let mut cdp = Cdp::connect(&page_ws(port, page_timeout, &skip, cx)?, 10.0)?;
                if !visible || skip.len() >= 5 {
                    return Ok(cdp);
                }
                // LotDsp の窓は、窓に属するページを選ぶ（chrome://newtab-footer などの部品のページは窓を持たない）
                match cdp.call("Browser.getWindowForTarget", json!({}), 5.0, true, cx) {
                    Ok(_) => return Ok(cdp),
                    Err(e) if e.kind == "cancelled" => return Err(e),
                    Err(_) => {
                        skip.push(cdp.url());
                        Page::close(&mut cdp);
                    }
                }
            }
        })();
        match started {
            Ok(cdp) => Ok((proc, Box::new(cdp))),
            Err(e) => {
                if !proc.wait(0.1) {
                    proc.kill();
                }
                Err(e)
            }
        }
    }
}

// ------------------------------------------------------------------ 待つ
/// secs 秒待つ（0.1 秒ごとに中止を見る）
pub fn nap(secs: f64, cx: &Cx) -> R<()> {
    let end = (cx.now)() + secs;
    loop {
        (cx.cancel)()?;
        let left = end - (cx.now)();
        if left <= 0.0 {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs_f64(left.min(0.1)));
    }
}

// ------------------------------------------------------------------ 本体（このプロセスに 1 つ）
#[derive(Default)]
struct Status {
    lot: String,
    stage: String,
    since: f64,
    reused: bool,
}

/// 時計（秒）。試験は差し替える
pub type Clock = Arc<dyn Fn() -> f64 + Send + Sync>;
/// 見張りの眠り（秒）。試験は差し替えた時計に合わせる
pub type Sleep = Arc<dyn Fn(f64) + Send + Sync>;

pub fn system_clock() -> Clock {
    Arc::new(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0))
}

struct WatchState {
    alive: bool,
    cfg: Option<Cfg>,
}

pub struct Direct {
    busy: AtomicBool,
    turn: Mutex<()>,
    status: Mutex<Status>,
    cancel: AtomicBool,
    session: Mutex<Option<Browser>>,
    gen: AtomicU64,
    watch: Mutex<WatchState>,
    wake: (Mutex<bool>, Condvar),
    clock: Clock,
    sleep: Sleep,
    launch: Box<dyn Launch>,
    /// 見えない Edge の一時プロファイルを作る所（既定は OS の一時フォルダ。試験は場面ごとのフォルダに替える）
    temp: Mutex<PathBuf>,
}

/// 読んだ結果（HTML か理由つきの誤り）
pub type Fetch = R<String>;

impl Direct {
    pub fn new(launch: Box<dyn Launch>, clock: Clock, sleep: Sleep) -> Arc<Direct> {
        Arc::new(Direct {
            busy: AtomicBool::new(false),
            turn: Mutex::new(()),
            status: Mutex::default(),
            cancel: AtomicBool::new(false),
            session: Mutex::new(None),
            gen: AtomicU64::new(0),
            watch: Mutex::new(WatchState { alive: false, cfg: None }),
            wake: (Mutex::new(false), Condvar::new()),
            clock,
            sleep,
            launch,
            temp: Mutex::new(std::env::temp_dir()),
        })
    }

    pub fn real() -> Arc<Direct> {
        sweep_profiles();
        Direct::new(Box::new(RealLaunch), system_clock(), Arc::new(|s| std::thread::sleep(Duration::from_secs_f64(s.max(0.0)))))
    }

    fn now(&self) -> f64 {
        (self.clock)()
    }

    /// 一時プロファイルを作る所を替える（試験: ほかの試験の一時プロファイルと混ざらないように）
    pub fn set_temp(&self, dir: &Path) {
        *self.temp.lock().unwrap() = dir.to_path_buf();
    }

    fn check_cancel(&self) -> R<()> {
        if self.cancel.load(Ordering::SeqCst) && self.busy.load(Ordering::SeqCst) {
            return err("cancelled", "中止しました");
        }
        Ok(())
    }

    fn stage(&self, name: &str) -> R<()> {
        self.status.lock().unwrap().stage = name.into();
        self.check_cancel()
    }

    /// いまの途中経過 {busy, lot, stage, seconds, reused}
    pub fn status(&self) -> Value {
        let busy = self.busy.load(Ordering::SeqCst);
        let s = self.status.lock().unwrap();
        let secs = if busy { rules::seconds_of(s.since, self.now()) } else { 0.0 };
        json!({"busy": busy, "lot": if busy { s.lot.clone() } else { String::new() }, "stage": if busy { s.stage.clone() } else { String::new() },
               "seconds": if busy { json!(secs) } else { json!(0) }, "reused": s.reused})
    }

    /// 「中止」: 読んでいる途中なら止める
    pub fn cancel(&self) -> bool {
        if self.busy.load(Ordering::SeqCst) {
            self.cancel.store(true, Ordering::SeqCst);
            return true;
        }
        false
    }

    fn cx_close(&self) -> impl Fn() -> R<()> + '_ {
        || Ok(())
    }

    /// 使い回しているブラウザを閉じる（アプリの終了・読めなかったとき）
    pub fn shutdown(&self) {
        // 読んでいる途中なら中止を頼み、3 秒まで錠を待つ（窓の終わりを止めない。Windows では窓のジョブも Edge を止める）
        if self.busy.load(Ordering::SeqCst) {
            self.cancel.store(true, Ordering::SeqCst);
        }
        let end = std::time::Instant::now() + Duration::from_secs(3);
        let mut guard = loop {
            match self.session.try_lock() {
                Ok(g) => break g,
                Err(std::sync::TryLockError::Poisoned(p)) => break p.into_inner(),
                Err(std::sync::TryLockError::WouldBlock) if std::time::Instant::now() < end => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                Err(std::sync::TryLockError::WouldBlock) => return,
            }
        };
        let b = guard.take();
        drop(guard);
        self.bump();
        if let Some(mut b) = b {
            let none = self.cx_close();
            b.close(&Cx { now: &*self.clock, cancel: &none });
        }
    }

    fn bump(&self) {
        self.gen.fetch_add(1, Ordering::SeqCst);
        let (m, cv) = &self.wake;
        *m.lock().unwrap() = true;
        cv.notify_all();
    }

    /// 見張り（1 つ）を起こす
    fn idle_watch(self: &Arc<Self>, cfg: &Cfg) {
        {
            let mut w = self.watch.lock().unwrap();
            w.cfg = Some(cfg.clone());
            if w.alive {
                return;
            }
            w.alive = true;
        }
        let me = self.clone();
        let _ = std::thread::Builder::new().name("lotdsp-idle".into()).spawn(move || me.watch_loop());
    }

    fn watch_loop(&self) {
        loop {
            // 起きるたびに、いまのブラウザ（世代）をその種類の秒数で測る。読んでいる最中（錠）は閉じない
            let (keep, gone) = {
                let Ok(mut s) = self.session.try_lock() else {
                    (self.sleep)(1.0);
                    continue;
                };
                let cfg = self.watch.lock().unwrap().cfg.clone();
                let keep = match (s.as_ref(), cfg) {
                    (Some(b), Some(c)) => c.keep_of(b.visible),
                    _ => 0.0,
                };
                if s.is_none() || keep <= 0.0 {
                    self.watch.lock().unwrap().alive = false;
                    return;
                }
                let idle = !self.busy.load(Ordering::SeqCst) && self.now() - s.as_ref().unwrap().used > keep;
                (keep, if idle { s.take() } else { None })
            };
            if let Some(mut b) = gone {
                self.bump();
                let none = self.cx_close();
                b.close(&Cx { now: &*self.clock, cancel: &none });
                continue;
            }
            // 1 秒ずつ待ち、ブラウザが替わったら（wake）すぐ測り直す
            let end = self.now() + (keep / 4.0).clamp(5.0, 30.0);
            loop {
                {
                    let mut w = self.wake.0.lock().unwrap();
                    if *w {
                        *w = false;
                        break;
                    }
                }
                let left = end - self.now();
                if left <= 0.0 {
                    break;
                }
                (self.sleep)(left.min(1.0));
            }
        }
    }

    /// ロット番号で LotDsp を検索し、進度情報を描き終わった画面の HTML を返す
    pub fn fetch(self: &Arc<Self>, lot_no: &str, cfg: &Cfg, window: bool) -> Fetch {
        if !cfg.enabled {
            return err("disabled", "このアプリだけで LotDsp を読む設定が切ってあります（lotdsp_import.direct.enabled）");
        }
        let Ok(_turn) = self.turn.try_lock() else {
            return err("busy", "いまほかのロットを LotDsp から読んでいます。終わってからもう一度押してください");
        };
        self.busy.store(true, Ordering::SeqCst);
        self.cancel.store(false, Ordering::SeqCst);
        *self.status.lock().unwrap() = Status { lot: lot_no.into(), stage: String::new(), since: self.now(), reused: false };
        let out = (|| {
            let visible = window && cfg.login_window;
            let mut slot = self.session.lock().unwrap();
            let html = self.drive(&mut slot, cfg, lot_no, visible)?;
            // 閉じるかは、使ったブラウザの種類の秒数で決める（見張りと同じ keep_of）
            if let Some(b) = slot.as_ref() {
                if cfg.keep_of(b.visible) <= 0.0 {
                    let mut b = slot.take().unwrap();
                    drop(slot);
                    self.bump();
                    let none = self.cx_close();
                    b.close(&Cx { now: &*self.clock, cancel: &none });
                }
            }
            Ok(html)
        })();
        self.status.lock().unwrap().stage = String::new();
        self.busy.store(false, Ordering::SeqCst);
        out
    }

    fn close_slot(&self, slot: &mut Option<Browser>) {
        if let Some(mut b) = slot.take() {
            self.bump();
            let none = self.cx_close();
            b.close(&Cx { now: &*self.clock, cancel: &none });
        }
    }

    fn drive(self: &Arc<Self>, slot: &mut Option<Browser>, cfg: &Cfg, lot: &str, visible: bool) -> Fetch {
        let cancel = || self.check_cancel();
        let cx = Cx { now: &*self.clock, cancel: &cancel };
        for attempt in 0..2 {
            let alive = slot.as_mut().is_some_and(|b| b.alive());
            if !alive {
                self.stage("reach")?;
                if !self.reach_or_cancel(&rules::site_base(&cfg.url), cfg.reach_timeout)? {
                    return err("unreachable", format!("LotDsp（{}）に届きません（社外・VPN 未接続・サイトの停止）", cfg.url));
                }
            }
            let Some(exe) = self.launch.find_browser(&cfg.browser) else {
                return err(
                    "no_browser",
                    "LotDsp を裏で開くブラウザ（Edge）が見つかりません（「マスタ管理」の「参照先」で場所を入れられます）",
                );
            };
            let reused = self.session_for(slot, cfg, &exe, visible, &cx)?;
            self.status.lock().unwrap().reused = reused;
            let r = (|| {
                let b = slot.as_mut().unwrap();
                self.open_search_page(b, cfg, lot, reused, &cx)?;
                self.run(b, cfg, lot, visible, &cx)
            })();
            match r {
                Ok(html) => {
                    if let Some(b) = slot.as_mut() {
                        b.used = self.now();
                    }
                    return Ok(html);
                }
                Err(e) => {
                    if e.kind == "not_found" {
                        if let Some(b) = slot.as_mut() {
                            b.used = self.now(); // 該当なしは正しい答え。ページはそのまま次に使える
                        }
                        return Err(e);
                    }
                    self.close_slot(slot); // ログインが要る・中止・壊れた ときは残さない
                    if matches!(e.kind.as_str(), "login" | "cancelled" | "browser" | "unreachable") || !reused || attempt == 1 {
                        return Err(e);
                    }
                    // 使い回しのページが想定外の画面だった → 1 度だけ起こし直してやり直す
                }
            }
        }
        unreachable!("2 回目は必ず返す")
    }

    /// 届くかを裏の糸で確かめ、待つ間も 0.1 秒ごとに中止を見る（中止なら糸を置いて返す）
    fn reach_or_cancel(self: &Arc<Self>, url: &str, timeout: f64) -> R<bool> {
        let (tx, rx) = std::sync::mpsc::channel();
        let (me, u) = (self.clone(), url.to_string());
        let _ = std::thread::Builder::new().name("lotdsp-reach".into()).spawn(move || {
            let _ = tx.send(me.launch.reachable(&u, timeout));
        });
        loop {
            self.check_cancel()?;
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(v) => {
                    self.check_cancel()?;
                    return Ok(v);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => return Ok(false),
            }
        }
    }

    fn session_for(self: &Arc<Self>, slot: &mut Option<Browser>, cfg: &Cfg, exe: &str, visible: bool, cx: &Cx) -> R<bool> {
        if let Some(b) = slot.as_mut() {
            if b.alive() && b.exe == exe && b.extra == cfg.extra_args && (b.visible || !visible) {
                return Ok(true);
            }
        }
        self.close_slot(slot);
        self.stage("open")?;
        let (profile, keep) = if visible {
            let p = cfg.window_profile.clone();
            let _ = std::fs::create_dir_all(&p);
            let _ = std::fs::remove_file(p.join("DevToolsActivePort")); // 前に開いたときのポートを読まない
            (p, true)
        } else {
            (temp_profile(&self.temp.lock().unwrap()), false)
        };
        let (proc, page) = match self.launch.launch(exe, &cfg.extra_args, visible, &profile, cfg.start_timeout, cx) {
            Ok(x) => x,
            Err(e) => {
                if !keep {
                    remove_profile(&profile);
                }
                return Err(e);
            }
        };
        let mut b = Browser::new(exe, &cfg.extra_args, visible, profile, keep, proc, page, self.now());
        b.gen = self.gen.fetch_add(1, Ordering::SeqCst) + 1;
        *slot = Some(b);
        self.bump();
        self.window(slot.as_mut().unwrap(), "minimized", cx); // 窓はログインが要るときだけ前に出す
        if cfg.keep_of(visible) > 0.0 {
            self.idle_watch(cfg);
        }
        Ok(false)
    }

    /// LotDsp の窓を出し入れする（normal: 前に出す・minimized: しまう）。できなくても読むのは続ける
    fn window(&self, b: &mut Browser, state: &str, cx: &Cx) {
        if !b.visible {
            return;
        }
        let p = b.page();
        let Ok(r) = p.call("Browser.getWindowForTarget", json!({}), 5.0, true, cx) else { return };
        let wid = r.get("windowId").cloned().unwrap_or(Value::Null);
        if p.call("Browser.setWindowBounds", json!({"windowId": wid, "bounds": {"windowState": state}}), 5.0, true, cx).is_err() {
            return;
        }
        if state == "normal" {
            let _ = p.call("Page.bringToFront", json!({}), 5.0, true, cx);
        }
    }

    fn open_search_page(&self, b: &mut Browser, cfg: &Cfg, lot: &str, reused: bool, cx: &Cx) -> R<()> {
        let site = rules::site_base(&cfg.url);
        let mut here = false;
        if reused {
            let st = eval(b.page(), PAGE_STATE, 5.0, cx).ok().filter(|v| crate::lotdsp::truthy(Some(v)));
            let (href, ready, shown) = match st.as_ref().and_then(Value::as_array) {
                Some(a) => (
                    a.first().map(crate::lotdsp::py_str_value).unwrap_or_default(),
                    a.get(1).map(crate::lotdsp::py_str_value).unwrap_or_default(),
                    a.get(2).map(crate::lotdsp::py_str_value).unwrap_or_default(),
                ),
                None => (String::new(), String::new(), String::new()),
            };
            // 設定の最初の画面と同じ場所（# より前）にいるときだけ続けて使う
            here = href.split('#').next() == cfg.search_url.split('#').next() && ready != "loading";
            if here && shown != lot {
                return Ok(());
            }
        }
        self.stage("load")?;
        b.page().call("Page.navigate", json!({"url": cfg.search_url}), 20.0, true, cx)?;
        if here {
            // 同じロットを出している: 読み込み直す（同じ URL へ移るだけだと古い結果を検索の結果と取り違える）
            b.page().call("Page.reload", json!({"ignoreCache": false}), 20.0, true, cx)?;
        }
        let end = self.now() + 20.0;
        loop {
            let st = match eval(b.page(), "[location.href, document.readyState]", 5.0, cx) {
                Ok(v) => Some(v),
                Err(e) if e.kind == "cancelled" => return Err(e),
                Err(_) => None, // 移る途中は評価できないことがある
            };
            if let Some(Value::Array(a)) = &st {
                let href = a.first().map(crate::lotdsp::py_str_value).unwrap_or_default();
                let ready = a.get(1).map(crate::lotdsp::py_str_value).unwrap_or_default();
                if href.starts_with(&site) && ready != "loading" {
                    return Ok(());
                }
            }
            if self.now() > end {
                return err("unreachable", "LotDsp のページを開けませんでした（時間切れ）");
            }
            self.stage("load")?;
            nap(0.2, cx)?;
        }
    }

    fn eval_quiet(&self, b: &mut Browser, expr: &str, cx: &Cx) -> R<Option<Value>> {
        match eval(b.page(), expr, 5.0, cx) {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.kind == "cancelled" => Err(e),
            Err(_) => Ok(None),
        }
    }

    fn login_deadline(&self, cfg: &Cfg, end: f64) -> R<()> {
        if self.now() > end {
            return err("login", format!("LotDsp の窓でのログインを {} 秒待ちましたが、終わりませんでした", cfg.login_wait.trunc() as i64));
        }
        Ok(())
    }

    fn run(&self, b: &mut Browser, cfg: &Cfg, lot: &str, wait_login: bool, cx: &Cx) -> Fetch {
        if !wait_login {
            return self.run_once(b, cfg, lot, cx);
        }
        let end = self.now() + cfg.login_wait;
        let mut asked = false;
        loop {
            if asked {
                // 利用者がログインし終えるのを待つ（欄が消えるまで）。消えたら、利用者が押した検索が落ち着くのを少し待つ
                while self.eval_quiet(b, LOGIN_SHOWN, cx)? != Some(Value::Bool(false)) {
                    self.login_deadline(cfg, end)?;
                    self.stage("login")?;
                    nap(1.0, cx)?;
                }
                nap(1.5, cx)?;
            }
            match self.run_once(b, cfg, lot, cx) {
                Ok(html) => {
                    if asked {
                        self.window(b, "minimized", cx);
                    }
                    return Ok(html);
                }
                Err(e) => {
                    if e.kind != "login" && e.kind != "swapped" {
                        return Err(e);
                    }
                    if e.kind == "login" && !asked {
                        asked = true;
                        self.window(b, "normal", cx);
                        // ロット番号だけ欄に入れておく（ID・パスワードの欄には触れない）
                        let _ = self.eval_quiet(b, &PREFILL.replace("__LOT__", &json!(lot).to_string()), cx)?;
                    }
                    self.login_deadline(cfg, end)?;
                }
            }
            self.stage("login")?;
            nap(1.0, cx)?;
        }
    }

    fn run_once(&self, b: &mut Browser, cfg: &Cfg, lot: &str, cx: &Cx) -> Fetch {
        self.stage("search")?;
        let total_ms = ((cfg.timeout - 5.0).max(10.0) * 1000.0).trunc() as i64;
        let js = SCRIPT.replace("__LOT__", &crate::lotdsp::json_ascii(lot)).replace("__TOTAL_MS__", &total_ms.to_string());
        eval(b.page(), &js, 10.0, cx)?;
        let end = self.now() + cfg.timeout;
        loop {
            let st = match eval(b.page(), STATE_Q, 10.0, cx) {
                Ok(v) => v,
                Err(e) if e.kind != "screen" || e.msg.contains("時間切れ") => return Err(e),
                Err(_) => Value::Null, // 移る途中で評価できなかった
            };
            if !crate::lotdsp::truthy(Some(&st)) {
                return err("swapped", "ロット問い合わせの画面が途中で入れ替わりました");
            }
            let a = st.as_array().cloned().unwrap_or_default();
            let (stage, res) = (a.first().cloned().unwrap_or(Value::Null), a.get(1).cloned().unwrap_or(Value::Null));
            if crate::lotdsp::truthy(Some(&res)) {
                if !crate::lotdsp::truthy(res.get("ok")) {
                    let kind = res.get("kind").and_then(Value::as_str).filter(|k| !k.is_empty()).unwrap_or("screen");
                    let msg = res
                        .get("error")
                        .filter(|x| crate::lotdsp::truthy(Some(x)))
                        .map(crate::lotdsp::py_str_value)
                        .unwrap_or_else(|| "進度情報を読めませんでした".into());
                    return err(kind, msg);
                }
                return Ok(res.get("html").map(crate::lotdsp::py_str_value).unwrap_or_default());
            }
            if let Some(s) = stage.as_str().filter(|s| STAGES.contains(s)) {
                self.stage(s)?;
            }
            self.check_cancel()?;
            if self.now() > end {
                return err("screen", "ロット問い合わせの画面の応答がありません（時間切れ）");
            }
            nap(0.25, cx)?;
        }
    }
}

fn temp_profile(base: &Path) -> PathBuf {
    let mut r = [0u8; 6];
    let _ = getrandom::fill(&mut r);
    let name: String = r.iter().map(|b| format!("{b:02x}")).collect();
    let p = base.join(format!("tpa-lotdsp-{name}"));
    let _ = std::fs::create_dir_all(&p);
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        for n in [0usize, 5, 125, 126, 65535, 65536, 70000] {
            let data = vec![7u8; n];
            let mut f = frame(0x1, &data, [1, 2, 3, 4]);
            f.extend_from_slice(b"rest");
            let (fin, op, p) = take_frame(&mut f).unwrap();
            assert!(fin && op == 1 && p == data, "{n}");
            assert_eq!(f, b"rest");
        }
        let mut short = frame(0x1, b"abc", [0; 4]);
        short.pop();
        assert!(take_frame(&mut short).is_none(), "揃わない枠は待つ");
        assert_eq!(b64(b"abcd"), "YWJjZA==");
    }

    #[test]
    fn windows_paths_compare_without_the_long_prefix() {
        assert!(win_under(Path::new(r"\\?\C:\Program Files\Microsoft\Edge\msedge.exe"), Path::new(r"C:\Program Files")));
        assert!(win_under(Path::new(r"c:/program files/x/msedge.exe"), Path::new(r"\\?\C:\Program Files\")));
        assert!(!win_under(Path::new(r"C:\Program FilesX\msedge.exe"), Path::new(r"C:\Program Files")));
        assert!(!win_under(Path::new(r"\\?\UNC\srv\share\msedge.exe"), Path::new(r"C:\Program Files")));
    }

    // ---------------------------------------------------------------- 差し替えた時計と作り物のブラウザ
    struct FakeTime {
        now: Mutex<f64>,
        cv: Condvar,
    }

    impl FakeTime {
        fn advance(&self, s: f64) {
            *self.now.lock().unwrap() += s;
            self.cv.notify_all();
            std::thread::sleep(Duration::from_millis(300)); // 見張りが起きて片付けるのを待つ（本物の時計）
        }
    }

    type Made = Arc<Mutex<Vec<(bool, Arc<AtomicBool>)>>>;
    type Fake = (Arc<Direct>, Arc<FakeTime>, Arc<AtomicBool>, Made, Cfg);

    struct FakeProc(Arc<AtomicBool>);

    impl Proc for FakeProc {
        fn alive(&mut self) -> bool {
            self.0.load(Ordering::SeqCst)
        }
        fn wait(&mut self, _secs: f64) -> bool {
            self.0.store(false, Ordering::SeqCst);
            true
        }
        fn kill(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }

    /// ページ: 見えない Edge はログインが要る（login が真のとき）、窓は読める
    struct FakePage {
        visible: bool,
        login: Arc<AtomicBool>,
    }

    impl Page for FakePage {
        fn call(&mut self, method: &str, params: Value, _t: f64, _c: bool, _cx: &Cx) -> R<Value> {
            if method != "Runtime.evaluate" {
                return Ok(json!({"windowId": 1}));
            }
            let e = params["expression"].as_str().unwrap_or("");
            let v = if e.starts_with("[location.href") {
                json!(["http://x/LotDspWeb/#/lotdsp", "complete"])
            } else if e.starts_with("window.__tpaDirect ?") {
                if !self.visible && self.login.load(Ordering::SeqCst) {
                    json!(["search", {"ok": false, "kind": "login", "error": "ログインが要ります"}])
                } else {
                    json!(["read", {"ok": true, "html": "<html/>"}])
                }
            } else {
                json!(false)
            };
            Ok(json!({"result": {"value": v}}))
        }
        fn close(&mut self) {}
        fn url(&self) -> String {
            String::new()
        }
    }

    struct FakeLaunch {
        login: Arc<AtomicBool>,
        made: Made,
    }

    impl Launch for FakeLaunch {
        fn launch(&self, _exe: &str, _extra: &[String], visible: bool, _p: &Path, _t: f64, _cx: &Cx) -> R<(Box<dyn Proc>, Box<dyn Page>)> {
            let alive = Arc::new(AtomicBool::new(true));
            self.made.lock().unwrap().push((visible, alive.clone()));
            Ok((Box::new(FakeProc(alive)), Box::new(FakePage { visible, login: self.login.clone() })))
        }
        fn find_browser(&self, _c: &str) -> Option<String> {
            Some("/fake/msedge".into())
        }
        fn reachable(&self, _u: &str, _t: f64) -> bool {
            true
        }
    }

    fn fake(keep: f64, window_keep: f64) -> Fake {
        let t = Arc::new(FakeTime { now: Mutex::new(1_000_000.0), cv: Condvar::new() });
        let (tc, ts) = (t.clone(), t.clone());
        let clock: Clock = Arc::new(move || *tc.now.lock().unwrap());
        let sleep: Sleep = Arc::new(move |s| {
            let g = ts.now.lock().unwrap();
            let target = *g + s;
            let _ = ts.cv.wait_timeout_while(g, Duration::from_secs(5), |n| *n < target);
        });
        let login = Arc::new(AtomicBool::new(true));
        let made = Arc::new(Mutex::new(vec![]));
        let d = Direct::new(Box::new(FakeLaunch { login: login.clone(), made: made.clone() }), clock, sleep);
        let tmp = std::env::temp_dir().join(format!("da-lotdsp-watch-{}-{}", std::process::id(), (keep * 10.0) as i64));
        let li = json!({"url": "http://x/LotDspWeb/", "direct": {"keep_seconds": keep, "window_keep_seconds": window_keep,
                        "window_profile": tmp.join("win").to_string_lossy()}});
        (d, t, login, made, Cfg::from(&li, &tmp).unwrap())
    }

    #[test]
    fn the_window_after_the_headless_stays_for_window_keep_seconds() {
        // 見えない → ログインが要る → 窓: 600 秒たっても窓は残り、1800 秒で閉じる（前は見えない Edge の見張りが 300 秒で閉じた）
        let (d, t, _login, made, cfg) = fake(300.0, 1800.0);
        assert_eq!(d.fetch("L7150C0", &cfg, false).unwrap_err().kind, "login");
        assert_eq!(d.fetch("L7150C0", &cfg, true).unwrap(), "<html/>");
        let win = made.lock().unwrap().last().unwrap().1.clone();
        t.advance(600.0);
        assert!(win.load(Ordering::SeqCst), "600 秒では窓を閉じない");
        assert!(d.session.lock().unwrap().is_some());
        t.advance(1250.0);
        assert!(!win.load(Ordering::SeqCst), "1800 秒使わなければ閉じる");
        assert!(d.session.lock().unwrap().is_none());
        assert!(!d.watch.lock().unwrap().alive, "閉じたら見張りも終わる");
    }

    #[test]
    fn keep_zero_closes_the_headless_but_not_the_window() {
        let (d, _t, login, made, cfg) = fake(0.0, 1800.0);
        login.store(false, Ordering::SeqCst);
        d.fetch("L7150C0", &cfg, false).unwrap();
        assert!(d.session.lock().unwrap().is_none(), "見えない Edge は毎回閉じる");
        d.fetch("L7150C0", &cfg, true).unwrap();
        assert!(d.session.lock().unwrap().as_ref().is_some_and(|b| b.visible), "窓は残す（前は窓も閉じた）");
        assert!(made.lock().unwrap().last().unwrap().1.load(Ordering::SeqCst));
        d.shutdown();
    }

    #[test]
    fn one_watcher_and_the_headless_closes_after_keep_seconds() {
        let (d, t, login, _made, cfg) = fake(300.0, 1800.0);
        login.store(false, Ordering::SeqCst);
        for _ in 0..3 {
            d.fetch("L7150C0", &cfg, false).unwrap();
            d.shutdown();
        }
        d.fetch("L7150C0", &cfg, false).unwrap();
        assert!(d.watch.lock().unwrap().alive, "見張りが 1 つ");
        t.advance(301.0);
        assert!(d.session.lock().unwrap().is_none(), "見えない Edge は keep_seconds で閉じる");
    }

    #[test]
    fn cancel_is_seen_while_checking_reach() {
        // 中止は届くかの確かめを待つ間も 0.1 秒ごとに見る（前は最大 4 秒効かなかった）
        struct Slow;
        impl Launch for Slow {
            fn launch(&self, _: &str, _: &[String], _: bool, _: &Path, _: f64, _: &Cx) -> R<(Box<dyn Proc>, Box<dyn Page>)> {
                err("browser", "起こさない")
            }
            fn reachable(&self, _: &str, _: f64) -> bool {
                std::thread::sleep(Duration::from_secs(4));
                true
            }
        }
        let d = Direct::new(Box::new(Slow), system_clock(), Arc::new(|s| std::thread::sleep(Duration::from_secs_f64(s))));
        let cfg = Cfg::from(&json!({"url": "http://x/LotDspWeb/"}), Path::new("/tmp")).unwrap();
        let d2 = d.clone();
        let th = std::thread::spawn(move || {
            let t0 = std::time::Instant::now();
            (d2.fetch("L7150C0", &cfg, false), t0.elapsed())
        });
        std::thread::sleep(Duration::from_millis(300));
        assert!(d.cancel());
        let (r, took) = th.join().unwrap();
        assert_eq!(r.unwrap_err().kind, "cancelled");
        assert!(took < Duration::from_millis(1500), "{took:?}");
        assert!(!d.cancel(), "読んでいないときは何もしない");
    }

    #[test]
    fn names_of_browsers() {
        assert!(trusted_browser("/tmp/not_edge.sh").contains("だけを指せます"));
        if !cfg!(windows) {
            assert_eq!(trusted_browser(&format!("/usr/bin/{}", browser_names()[0])), "");
        }
    }
}
