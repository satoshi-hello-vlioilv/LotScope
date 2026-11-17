//! 道の字の門（版 3.114.0。Rust 化の段 ③ の 3 つ目。Python の services/path_rules.py と同じ決まりを 1 か所に持つ）。
//!
//! 道を受ける欄（path_routes.json: 「参照…」の path・配布の置き場の name・parent・from・マスタの置き場の name・parent）の字を、道の頭で
//! 1 回決める: 通す・整えて通す・理由つきで断る。門を通った字だけが道の部品（folder_browse・release_place・master_place）へ届くので、
//! 部品は OS の珍しい形を Python に任せない（版 3.113.0 まで任せていた ~名前・file: の [ ]・NUL・長すぎる名前・Win32 の末尾の整え・
//! ドライブだけの道。予算 11 → 5〈口だけ〉）。
//!
//! 決めは事例の表 tests/fixtures/ospath_cases.json（形 × posix・nt → want と、版 3.113.0 の Python の答え py。人が仕様と OS の決まりから
//! 書いた。desktop/tests/ospath_cases.rs と Python の tests/test_ospath_cases.py が同じ表を読む）と path_rules.py の冒頭:
//! 制御文字（NUL はどの OS も・U+0001〜U+001F は Windows）・装置の道（\\?\X:\・\\?\UNC\ は書き直して通す。後ろに「.」「..」・空白や「.」で
//! 終わる名前があれば断る。そのほかの装置の道は断る）・~名前（Python 3.13 の expanduser。POSIX は /etc/passwd）・file: の [IPv6]
//! （ipv6-literal.net。そのほかの [ ] は断る）・ASCII でないサーバー名（NFKC で区切りの字が出れば断る）・ドライブ（C: は C:\、C:x は断る）・
//! 長さ（名前ごとに POSIX 255 バイト・Windows 255 単位、POSIX は道全体も 4096 バイト未満）・Win32 の段の末尾の整え（Windows だけ。
//! GetFullPathNameW。手で書かない）。門は道の頭（欄の字）だけに当て、保存済みの置き場の読み（束・master_share.json・引っ越しの印）には当てない。

use std::collections::HashMap;
use std::sync::LazyLock;

pub const E_CTRL: &str = "道に使えない字（制御文字）があります。";
pub const E_DEVICE: &str = "装置の道（\\\\.\\… など）は使えません。C:\\… か \\\\サーバー\\共有\\… で書いてください。";
pub const E_DEVICE_TRIM: &str =
    "装置の道（\\\\?\\…）の中に「.」「..」や、最後が空白か「.」の名前があります。C:\\… か \\\\サーバー\\共有\\… で書いてください。";
pub const E_DRIVE_REL: &str = "ドライブの根（C:\\…）から書いてください。";
pub const E_LONG_POSIX: &str = "フォルダの名前が長すぎます（この PC の上限 255 バイト）。";
pub const E_LONG_NT: &str = "フォルダの名前が長すぎます（この PC の上限 255 字）。";
pub const E_PATH_POSIX: &str = "道が長すぎます（この PC の上限 4096 バイト）。";
pub const E_URL_BRACKET: &str = "file: の URL が読めません（サーバー名の [ ]）。";
pub const E_URL_HOST: &str = "file: の URL のサーバー名に使えない字があります。";
pub const E_FULL: &str = "道を整えられません（Windows が読めない形）。";

pub const NAME_BYTES: usize = 255;
pub const NAME_UNITS: usize = 255;
pub const PATH_BYTES: usize = 4096;

/// 欄の種類
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// 「参照…」の欄（file: の URL・~・%VAR% を広げて整えた道）
    Browse,
    /// 上のフォルダ・いまの置き場（書き直しが無ければ字のまま）
    Dir,
    /// フォルダの名前（check_name を通る名前の長さだけ）
    Name,
}

impl Kind {
    pub fn of(s: &str) -> Option<Kind> {
        match s {
            "browse" => Some(Kind::Browse),
            "dir" => Some(Kind::Dir),
            "name" => Some(Kind::Name),
            _ => None,
        }
    }
}

/// 利用者の表（POSIX の ~名前）
#[derive(Debug, Clone)]
pub enum Passwd {
    /// この PC の /etc/passwd（今の利用者は /proc/self/status の Uid）
    System,
    /// 事例の表（名前 → 家、今の利用者の家）
    Table(HashMap<String, String>, Option<String>),
}

/// 門が読む PC の様子（事例の表は値を書いて渡す: CI の利用者名や今のフォルダに頼らない）
#[derive(Debug, Clone)]
pub struct Env {
    /// Windows の決まりか
    pub nt: bool,
    /// 環境変数（HOME・USERPROFILE・USERNAME・HOMEDRIVE・HOMEPATH。有る物だけ）
    pub vars: HashMap<String, String>,
    pub passwd: Passwd,
    /// 相対の道の見方（Python の今のフォルダ）
    pub cwd: String,
    /// GetFullPathNameW を呼べるか（Windows の本物の PC だけ）
    pub win32: bool,
}

impl Env {
    /// この PC の様子
    pub fn here(cwd: &str) -> Env {
        let vars = ["HOME", "USERPROFILE", "USERNAME", "HOMEDRIVE", "HOMEPATH"]
            .iter()
            .filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v)))
            .collect();
        Env { nt: cfg!(windows), vars, passwd: Passwd::System, cwd: cwd.to_string(), win32: cfg!(windows) }
    }

    fn home_of(&self, name: Option<&str>) -> Option<String> {
        match &self.passwd {
            Passwd::Table(t, uid) => match name {
                Some(n) => t.get(n).cloned(),
                None => uid.clone(),
            },
            Passwd::System => system_passwd(name),
        }
    }
}

/// /etc/passwd の家（name: None は今の利用者〈/proc/self/status の実の Uid〉）。最初に当たった行
fn system_passwd(name: Option<&str>) -> Option<String> {
    let uid = match name {
        Some(_) => None,
        None => {
            let st = std::fs::read_to_string("/proc/self/status").ok()?;
            Some(st.lines().find_map(|l| l.strip_prefix("Uid:"))?.split_whitespace().next()?.to_string())
        }
    };
    let text = std::fs::read_to_string("/etc/passwd").ok()?;
    for line in text.lines() {
        let f: Vec<&str> = line.split(':').collect();
        if f.len() < 7 {
            continue;
        }
        let hit = match (name, uid.as_deref()) {
            (Some(n), _) => f[0] == n,
            (None, Some(u)) => f[2] == u,
            _ => false,
        };
        if hit {
            return Some(f[5].to_string());
        }
    }
    None
}

// ------------------------------------------------------------------ ntpath の部品（Python 3.13）

fn chars(s: &str) -> Vec<char> {
    s.chars().collect()
}

/// ntpath.splitroot（元の字を返す。/ は \ と読む）
pub fn nt_splitroot(p: &str) -> (String, String, String) {
    let cs = chars(p);
    let n: Vec<char> = cs.iter().map(|&c| if c == '/' { '\\' } else { c }).collect();
    let take = |a: usize, b: usize| -> String { cs[a.min(cs.len())..b.min(cs.len())].iter().collect() };
    let find = |from: usize| n.iter().skip(from).position(|&c| c == '\\').map(|i| i + from);
    if n.first() == Some(&'\\') {
        if n.get(1) == Some(&'\\') {
            let upper: String = n.iter().take(8).collect::<String>().to_uppercase();
            let start = if upper == "\\\\?\\UNC\\" { 8 } else { 2 };
            let Some(i) = find(start) else { return (p.to_string(), String::new(), String::new()) };
            let Some(j) = find(i + 1) else { return (p.to_string(), String::new(), String::new()) };
            return (take(0, j), take(j, j + 1), take(j + 1, cs.len()));
        }
        return (String::new(), take(0, 1), take(1, cs.len()));
    }
    if n.get(1) == Some(&':') {
        if n.get(2) == Some(&'\\') {
            return (take(0, 2), take(2, 3), take(3, cs.len()));
        }
        return (take(0, 2), String::new(), take(2, cs.len()));
    }
    (String::new(), String::new(), p.to_string())
}

/// ntpath.join(a, b)
pub fn nt_join(a: &str, b: &str) -> String {
    let seps = ['\\', '/'];
    let (mut rd, mut rr, mut rp) = nt_splitroot(a);
    let (pd, pr, pp) = nt_splitroot(b);
    if !pr.is_empty() {
        if !pd.is_empty() || rd.is_empty() {
            rd = pd;
        }
        rr = pr;
        rp = pp;
    } else if !pd.is_empty() && pd != rd {
        if pd.to_lowercase() != rd.to_lowercase() {
            rd = pd;
            rr = pr;
            rp = pp;
            return finish_join(rd, rr, rp);
        }
        rd = pd;
        if !rp.is_empty() && !rp.ends_with(seps) {
            rp.push('\\');
        }
        rp.push_str(&pp);
    } else {
        if !rp.is_empty() && !rp.ends_with(seps) {
            rp.push('\\');
        }
        rp.push_str(&pp);
    }
    finish_join(rd, rr, rp)
}

fn finish_join(rd: String, rr: String, rp: String) -> String {
    if !rp.is_empty() && rr.is_empty() && !rd.is_empty() && !rd.ends_with([':', '\\', '/']) {
        return format!("{rd}\\{rp}");
    }
    format!("{rd}{rr}{rp}")
}

/// ntpath.split → (dirname, basename)
fn nt_split(p: &str) -> (String, String) {
    let (d, r, rest) = nt_splitroot(p);
    let cs = chars(&rest);
    let mut i = cs.len();
    while i > 0 && !matches!(cs[i - 1], '\\' | '/') {
        i -= 1;
    }
    let head: String = cs[..i].iter().collect();
    let tail: String = cs[i..].iter().collect();
    (format!("{d}{r}{}", head.trim_end_matches(['\\', '/'])), tail)
}

// ------------------------------------------------------------------ 小さな部品

fn drive(s: &str) -> bool {
    let mut it = s.chars();
    matches!((it.next(), it.next()), (Some(c), Some(':')) if c.is_ascii_alphabetic())
}

fn absolute(s: &str, nt: bool) -> bool {
    if !nt {
        return s.starts_with('/');
    }
    let t = s.replace('/', "\\");
    t.starts_with("\\\\") || (drive(&t) && t.chars().nth(2) == Some('\\'))
}

fn ctrl(s: &str, nt: bool) -> Result<(), String> {
    if s.contains('\0') || (nt && s.chars().any(|c| (c as u32) < 32)) {
        return Err(E_CTRL.into());
    }
    Ok(())
}

/// 装置の道（\\?\・\\.\）→ ふつうの形に書き直すか、断る。装置の道でなければそのまま（POSIX は \ の形だけ）
pub fn device(s: &str, nt: bool) -> Result<String, String> {
    let t = if nt { s.replace('/', "\\") } else { s.to_string() };
    if t.starts_with("\\\\.\\") {
        return Err(E_DEVICE.into());
    }
    let Some(rest) = t.strip_prefix("\\\\?\\") else { return Ok(s.to_string()) };
    let (new, parts): (String, Vec<String>) = if rest.get(..4).is_some_and(|h| h.eq_ignore_ascii_case("UNC\\")) {
        let body = &rest[4..];
        (format!("\\\\{body}"), body.split('\\').skip(2).map(String::from).collect())
    } else if drive(rest) && (rest.chars().count() == 2 || rest.chars().nth(2) == Some('\\')) {
        let body: String = rest.chars().skip(3).collect();
        let head: String = rest.chars().take(2).collect();
        (format!("{head}\\{body}"), body.split('\\').map(String::from).collect())
    } else {
        return Err(E_DEVICE.into());
    };
    if parts.iter().any(|p| p == "." || p == ".." || p.ends_with([' ', '.'])) {
        return Err(E_DEVICE_TRIM.into());
    }
    Ok(new)
}

fn lengths(s: &str, nt: bool, name_only: bool) -> Result<(), String> {
    let parts: Vec<&str> = if name_only {
        vec![s]
    } else if nt {
        s.split(['\\', '/']).collect()
    } else {
        s.split('/').collect()
    };
    for p in parts {
        let n = if nt { p.encode_utf16().count() } else { p.len() };
        if n > if nt { NAME_UNITS } else { NAME_BYTES } {
            return Err(if nt { E_LONG_NT } else { E_LONG_POSIX }.into());
        }
    }
    if !nt && !name_only && s.len() >= PATH_BYTES {
        return Err(E_PATH_POSIX.into());
    }
    Ok(())
}

/// Win32 が整える段がある（段が空白か「.」で終わる。「.」「..」と共有の根〈\\サーバー\共有〉の 2 段は除く: Win32 も整えない）
pub fn trims(s: &str) -> bool {
    let parts: Vec<&str> = s.split(['\\', '/']).collect();
    let skip = if s.starts_with("\\\\") || s.starts_with("//") { 4 } else { 0 };
    parts.iter().skip(skip).any(|p| *p != "." && *p != ".." && p.ends_with([' ', '.']))
}

/// GetFullPathNameW（Windows だけ。Python の nt._getfullpathname と同じ関数）
#[cfg(windows)]
pub fn full_path_name(p: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetFullPathNameW;
    let wide: Vec<u16> = p.encode_utf16().chain(std::iter::once(0)).collect();
    let mut buf = vec![0u16; 512];
    loop {
        let n = unsafe { GetFullPathNameW(PCWSTR::from_raw(wide.as_ptr()), Some(&mut buf), None) } as usize;
        if n == 0 {
            return None;
        }
        if n < buf.len() {
            return Some(String::from_utf16_lossy(&buf[..n]));
        }
        buf.resize(n + 1, 0);
    }
}

#[cfg(not(windows))]
pub fn full_path_name(_p: &str) -> Option<String> {
    None
}

/// Win32 の整え（相対の道は cwd につないでから）
fn full(s: &str, env: &Env) -> Result<String, String> {
    if !env.win32 {
        return Err(E_FULL.into());
    }
    let p = if absolute(s, true) { s.to_string() } else { nt_join(&env.cwd, s) };
    full_path_name(&p).ok_or_else(|| E_FULL.to_string())
}

// ------------------------------------------------------------------ ~ と ~名前

/// os.path.expanduser（Python 3.13。nt は ntpath、ほかは posixpath）
pub fn expanduser(s: &str, env: &Env) -> String {
    if !s.starts_with('~') {
        return s.to_string();
    }
    let cs = chars(s);
    if env.nt {
        let mut i = 1;
        while i < cs.len() && !matches!(cs[i], '\\' | '/') {
            i += 1;
        }
        let home = if let Some(h) = env.vars.get("USERPROFILE") {
            h.clone()
        } else if let Some(hp) = env.vars.get("HOMEPATH") {
            nt_join(env.vars.get("HOMEDRIVE").map(String::as_str).unwrap_or(""), hp)
        } else {
            return s.to_string();
        };
        let mut home = home;
        if i != 1 {
            let target: String = cs[1..i].iter().collect();
            let current = env.vars.get("USERNAME");
            if Some(&target) != current {
                let (dir, base) = nt_split(&home);
                if current != Some(&base) {
                    return s.to_string();
                }
                home = nt_join(&dir, &target);
            }
        }
        return format!("{home}{}", cs[i..].iter().collect::<String>());
    }
    let i = s[1..].find('/').map(|i| i + 1).unwrap_or(s.len());
    let home = if i == 1 {
        match env.vars.get("HOME") {
            Some(h) => Some(h.clone()),
            None => env.home_of(None),
        }
    } else {
        env.home_of(Some(&s[1..i]))
    };
    let Some(home) = home else { return s.to_string() };
    let out = format!("{}{}", home.trim_end_matches('/'), &s[i..]);
    if out.is_empty() {
        "/".into()
    } else {
        out
    }
}

// ------------------------------------------------------------------ file: の URL

/// urllib.parse.unquote（UTF-8・置き換え）
pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::new();
    let mut run: Vec<u8> = vec![];
    let mut i = 0;
    let hex = |c: u8| (c as char).to_digit(16);
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                run.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        if !run.is_empty() {
            out.push_str(&String::from_utf8_lossy(&run));
            run.clear();
        }
        let ch = s[i..].chars().next().unwrap_or('\u{fffd}');
        out.push(ch);
        i += ch.len_utf8();
    }
    if !run.is_empty() {
        out.push_str(&String::from_utf8_lossy(&run));
    }
    out
}

fn ipv6_literal(addr: &str) -> Result<String, String> {
    if addr.contains(['%', '.']) {
        return Err(E_URL_BRACKET.into());
    }
    let ip: std::net::Ipv6Addr = addr.parse().map_err(|_| E_URL_BRACKET.to_string())?;
    let text = ip.to_string();
    if text.contains('.') {
        return Err(E_URL_BRACKET.into());
    }
    let mut t = text.replace(':', "-");
    if t.starts_with('-') {
        t.insert(0, '0');
    }
    if t.ends_with('-') {
        t.push('0');
    }
    Ok(format!("{t}.ipv6-literal.net"))
}

/// urllib.parse._checknetloc（NFKC で区切りの字が出てくる ASCII でないサーバー名は断る）
fn netloc_ok(netloc: &str) -> Result<(), String> {
    if netloc.is_empty() || netloc.is_ascii() {
        return Ok(());
    }
    let n: String = netloc.chars().filter(|c| !matches!(c, '@' | ':' | '#' | '?')).collect();
    let n2 = crate::access::py_nfkc(&n);
    if n != n2 && n2.contains(['/', '?', '#', '@', ':']) {
        return Err(E_URL_HOST.into());
    }
    Ok(())
}

/// file: の URL → 道（urllib.parse.urlparse と同じ切り方。サーバー名の [ ] は門の決め）
pub fn file_url(s: &str) -> Result<String, String> {
    let u: String = s.chars().filter(|c| !matches!(c, '\t' | '\r' | '\n')).collect();
    let i = u.find(':').unwrap_or(0);
    let mut rest = u[i + 1..].to_string();
    let mut netloc = String::new();
    if let Some(r) = rest.strip_prefix("//") {
        let end = r.find(['/', '?', '#']).unwrap_or(r.len());
        netloc = r[..end].to_string();
        rest = r[end..].to_string();
        if netloc.contains(['[', ']']) {
            let inner = netloc.strip_prefix('[').and_then(|x| x.strip_suffix(']'));
            match inner {
                Some(a) if !a.contains(['[', ']', '@']) => netloc = ipv6_literal(a)?,
                _ => return Err(E_URL_BRACKET.into()),
            }
        }
    }
    netloc_ok(&netloc)?;
    let rest = rest.split('#').next().unwrap_or("");
    let path = rest.split('?').next().unwrap_or("");
    let body = percent_decode(path);
    let bc = chars(&body);
    Ok(if !netloc.is_empty() && netloc.to_lowercase() != "localhost" {
        format!("\\\\{netloc}{}", body.replace('/', "\\"))
    } else if bc.len() > 2 && bc[0] == '/' && bc[2] == ':' {
        bc[1..].iter().collect::<String>().replace('/', "\\")
    } else {
        body
    })
}

// ------------------------------------------------------------------ 門

/// 欄の字 → 門を通った字（Err は断る理由）。Browse は整えた道、Dir・Name は書き直しが無ければ字のまま
pub fn gate(kind: Kind, text: &str, env: &Env) -> Result<String, String> {
    let nt = env.nt;
    match kind {
        Kind::Name => {
            if let Ok(s) = crate::release_place::check_name(text) {
                lengths(&s, nt, true)?;
            }
            Ok(text.to_string())
        }
        Kind::Browse => {
            let s = crate::lists::unquote_path(text);
            let mut s = crate::pyfmt::strip(&s).trim_matches('\'').to_string();
            if s.to_lowercase().starts_with("file:") {
                s = file_url(&s)?;
            }
            ctrl(&s, nt)?;
            let s = device(&s, nt)?;
            let s = if s.is_empty() { s } else { crate::bundle::expandvars(&expanduser(&s, env)) };
            let mut out = crate::folder_browse::tidy_for(&s, nt);
            lengths(&out, nt, false)?;
            if nt && absolute(&out, true) && trims(&out) {
                out = crate::folder_browse::tidy_for(&full(&out, env)?, nt);
            }
            Ok(out)
        }
        Kind::Dir => {
            let s = crate::lists::unquote_path(text);
            if s.is_empty() {
                return Ok(text.to_string());
            }
            ctrl(&s, nt)?;
            let mut t = device(&s, nt)?;
            if nt && drive(&t) && !matches!(t.chars().nth(2), Some('\\' | '/')) {
                if t.chars().count() > 2 {
                    return Err(E_DRIVE_REL.into());
                }
                t.push('\\');
            }
            lengths(&t, nt, false)?;
            if nt && trims(&t) {
                t = full(&t, env)?;
            }
            Ok(if t == s { text.to_string() } else { t })
        }
    }
}

/// この欄で門を止めるか: 道の部品が先に自分の言葉で答える欄（check_name が断る名前・空の上のフォルダ）。後ろの欄は見ない
/// （plan が名前 → 上のフォルダ → いまの置き場の順に見るのと同じ順で、最初の誤りを答える。Python の path_rules.stops と同じ）
pub fn stops(kind: Kind, text: &str) -> bool {
    match kind {
        Kind::Name => crate::release_place::check_name(text).is_err(),
        Kind::Dir => crate::lists::unquote_path(text).is_empty(),
        Kind::Browse => false,
    }
}

// ------------------------------------------------------------------ 欄の表（path_routes.json）

/// 道 → [(欄, 種類)]（tools/path-routes.py が Python の path_rules.ROUTES から焼いた表）
/// (方法, 道の型, [(欄, 種類)])
pub type Route = (String, String, Vec<(String, Kind)>);

pub static ROUTES: LazyLock<Vec<Route>> = LazyLock::new(|| {
    let v: serde_json::Value = serde_json::from_str(include_str!("path_routes.json")).expect("path_routes.json");
    v["routes"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| {
            let fields = r["fields"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|f| (f[0].as_str().unwrap_or("").to_string(), Kind::of(f[1].as_str().unwrap_or("")).expect("欄の種類")))
                .collect();
            (r["method"].as_str().unwrap_or("").to_string(), r["rule"].as_str().unwrap_or("").to_string(), fields)
        })
        .collect()
});

pub fn fields_of(method: &str, path: &str) -> &'static [(String, Kind)] {
    ROUTES.iter().find(|(m, r, _)| m == method && r == path).map(|(_, _, f)| f.as_slice()).unwrap_or(&[])
}

/// 道の欄を表の順に門へ通す（values の字を通った字に替える）。Err は最初の理由（Python の path_rules.apply と同じ）
pub fn apply(method: &str, path: &str, values: &mut HashMap<String, String>, env: &Env) -> Result<(), String> {
    for (field, kind) in fields_of(method, path) {
        let v = values.get(field).cloned().unwrap_or_default();
        if stops(*kind, &v) {
            break;
        }
        values.insert(field.clone(), gate(*kind, &v, env)?);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nt_join_like_python() {
        // ntpath.join（Python 3.13）の答え
        for (a, b, w) in [
            ("C:\\work", "x", "C:\\work\\x"),
            ("C:\\work\\", "x", "C:\\work\\x"),
            ("C:\\work", "\\w\\a.", "C:\\w\\a."),
            ("C:", "\\Users\\h", "C:\\Users\\h"),
            ("C:", "Users", "C:Users"),
            ("", "\\Users\\h", "\\Users\\h"),
            ("\\\\srv\\share", "x", "\\\\srv\\share\\x"),
            ("C:\\a", "D:b", "D:b"),
            ("C:\\a", "c:b", "c:\\a\\b"),
            ("C:\\Users", "taro", "C:\\Users\\taro"),
        ] {
            assert_eq!(nt_join(a, b), w, "{a:?} {b:?}");
        }
        assert_eq!(nt_split("C:\\Users\\taro"), ("C:\\Users".into(), "taro".into()));
        assert_eq!(nt_split("C:\\"), ("C:\\".into(), "".into()));
    }

    #[test]
    fn win32_trimmed_parts_are_found() {
        // 版 3.113.0 の release_place::win_trims の事例（共有の根〈\\サーバー\共有〉の 2 段は Win32 も整えないので見ない）
        for p in [" ", "  ", "a ", "a.", "C:\\x\\ ", "\\\\srv\\share\\d.\\e", "x/y ./z"] {
            assert!(trims(p), "{p:?}");
        }
        for p in ["", ".", "..", "a", "C:\\x\\y", "..\\a", "./a", "\\\\srv\\share\\d", "a b\\c", "\\\\srv\\share. \\d"] {
            assert!(!trims(p), "{p:?}");
        }
    }

    #[test]
    fn routes_are_read() {
        let f = fields_of("POST", "/api/release/place/check");
        assert_eq!(f.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(), ["name", "parent", "from"]);
        assert_eq!(fields_of("POST", "/api/fs/browse")[0].1, Kind::Browse);
        assert!(fields_of("POST", "/api/settings/check").is_empty(), "SKIP の道は門を当てない");
    }
}
