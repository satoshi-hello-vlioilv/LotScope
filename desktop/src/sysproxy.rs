//! CM3 へのシステムのプロキシ（版 3.117.1。段 ③-6。Python の services/sysproxy.py〈urllib の getproxies・proxy_bypass〉と同じ読み方）。
//!
//! 利用者の決め（2026-11-17）: プロキシは環境変数と Windows の設定（HKCU の Internet Settings の ProxyEnable・ProxyServer・ProxyOverride）から読む。
//! 認証は無い（利用者:合言葉 は送らない）。PAC と自動検出は読まない（ProxyEnable が 0 で AutoConfigURL があれば、届かない言葉に一言足す）。
//! 決めは人が書いた事例の表 program/tests/fixtures/sysproxy_cases.json（cargo test --test sysproxy_cases・Python は tests/test_sysproxy_cases.py）。
//! 読み方の決めは純粋な関数（環境変数の並びとレジストリの値を受ける）で、OS から読むのは [`System::read`] だけ。Windows の決め（環境変数の名前は大文字・
//! ProxyOverride は大文字小文字を区別しない）は `nt` で選ぶので、Linux の試験も Windows の決めを流せる。

/// レジストリの値（Python の winreg が返す形を str() と真偽で持つ）
#[derive(Debug, Clone, PartialEq)]
pub enum RegVal {
    /// REG_DWORD・REG_QWORD（int）
    Int(i64),
    /// REG_SZ・REG_EXPAND_SZ（str。展開しない）
    Str(String),
}

impl RegVal {
    fn truthy(&self) -> bool {
        match self {
            RegVal::Int(n) => *n != 0,
            RegVal::Str(s) => !s.is_empty(),
        }
    }
    fn text(&self) -> String {
        match self {
            RegVal::Int(n) => n.to_string(),
            RegVal::Str(s) => s.clone(),
        }
    }
}

/// HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings の値（読めない・無い値は None。ほかの型〈REG_BINARY・REG_MULTI_SZ〉も None）
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Reg {
    pub enable: Option<RegVal>,
    pub server: Option<RegVal>,
    pub overrides: Option<RegVal>,
    pub autoconfig: Option<RegVal>,
}

/// 読んだプロキシの設定（1 回の問い合わせ〈30x をたどる間〉に 1 回読む。Python は opener を作るときに getproxies を 1 回、
/// 行き先ごとに proxy_bypass で環境変数とレジストリを読み直す）
#[derive(Debug, Clone, Default)]
pub struct System {
    /// 環境変数（名前・値。OS の並び）
    pub env: Vec<(String, String)>,
    /// Windows の設定（Windows でないか、鍵が無ければ None）
    pub reg: Option<Reg>,
    /// Windows の決めか
    pub nt: bool,
}

/// プロキシの選び（1 回の問い合わせ）
#[derive(Debug, Clone, PartialEq)]
pub enum Choice {
    Direct,
    /// 名前:番号（百分率符号を戻した字）
    Proxy(String),
}

/// 環境変数の名前（Windows の Python の os.environ は名前を大文字にした dict: 大文字にして同じ名前になれば、前の場所のまま後ろの値が勝つ。
/// 版 3.117.1 の作った後の直し・割れ 1: 前は同じ名前を 2 つ残し、「HTTP_PROXY と空の http_proxy」で Windows の Python と割れた）
fn names(env: &[(String, String)], nt: bool) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = vec![];
    for (k, v) in env {
        let k = if nt { k.to_uppercase() } else { k.clone() };
        put(&mut out, &k, v.clone());
    }
    out
}

/// 並びの表（Python の dict: 同じ鍵は前の場所のまま値だけ替わる）
fn put(m: &mut Vec<(String, String)>, k: &str, v: String) {
    match m.iter_mut().find(|(x, _)| x == k) {
        Some(e) => e.1 = v,
        None => m.push((k.to_string(), v)),
    }
}

/// urllib.request.getproxies_environment
pub fn env_proxies(env: &[(String, String)], nt: bool) -> Vec<(String, String)> {
    let env = names(env, nt);
    let mut out: Vec<(String, String)> = vec![];
    let mut seen: Vec<(String, String, String)> = vec![];
    for (name, value) in &env {
        let c: Vec<char> = name.chars().collect();
        let n = c.len();
        if n > 5 && c[n - 6] == '_' && c[n - 5..].iter().collect::<String>().to_lowercase() == "proxy" {
            let kind = c[..n - 6].iter().collect::<String>().to_lowercase();
            seen.push((name.clone(), value.clone(), kind.clone()));
            if !value.is_empty() {
                put(&mut out, &kind, value.clone());
            }
        }
    }
    if env.iter().any(|(k, _)| k == "REQUEST_METHOD") {
        out.retain(|(k, _)| k != "http");
    }
    for (name, value, kind) in &seen {
        if name.ends_with("_proxy") {
            if value.is_empty() {
                out.retain(|(k, _)| k != kind);
            } else {
                put(&mut out, kind, value.clone());
            }
        }
    }
    out
}

/// re.match('(?:[^/:]+)://', s)
fn has_type(s: &str) -> bool {
    match s.find("://") {
        Some(i) if i > 0 => !s[..i].contains(['/', ':']),
        _ => false,
    }
}

/// urllib.request.getproxies_registry（途中で読めない段があれば、そこまでに読めた物）
pub fn reg_proxies(reg: &Reg) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = vec![];
    let Some(enable) = &reg.enable else { return out };
    if !enable.truthy() {
        return out;
    }
    let Some(server) = &reg.server else { return out };
    let mut s = server.text();
    if !s.contains('=') && !s.contains(';') {
        s = format!("http={s};https={s};ftp={s}");
    }
    for p in s.split(';') {
        let Some((protocol, address)) = p.split_once('=') else { return out };
        let mut address = address.to_string();
        if !has_type(&address) {
            if matches!(protocol, "http" | "https" | "ftp") {
                address = format!("http://{address}");
            } else if protocol == "socks" {
                address = format!("socks://{address}");
            }
        }
        put(&mut out, protocol, address);
    }
    if let Some((_, socks)) = out.iter().find(|(k, _)| k == "socks").cloned() {
        if !socks.is_empty() {
            let address = match socks.strip_prefix("socks://") {
                Some(r) => format!("socks4://{r}"),
                None => socks,
            };
            for k in ["http", "https"] {
                let cur = out.iter().find(|(x, _)| x == k).map(|x| x.1.clone()).unwrap_or_default();
                put(&mut out, k, if cur.is_empty() { address.clone() } else { cur });
            }
        }
    }
    out
}

/// urllib.request.getproxies（環境変数 → Windows はそれが空ならレジストリ）
pub fn proxies(sys: &System) -> Vec<(String, String)> {
    let e = env_proxies(&sys.env, sys.nt);
    if !e.is_empty() || !sys.nt {
        return e;
    }
    sys.reg.as_ref().map(reg_proxies).unwrap_or_default()
}

/// urllib の _splitport（「名前:数字」の数字を外す。数字が空なら名前だけ）
fn split_port(host: &str) -> &str {
    match host.rfind(':') {
        Some(i) if host[i + 1..].bytes().all(|b| b.is_ascii_digit()) => &host[..i],
        _ => host,
    }
}

/// urllib.request.proxy_bypass_environment
pub fn bypass_env(host: &str, proxies: &[(String, String)]) -> bool {
    let Some((_, no)) = proxies.iter().find(|(k, _)| k == "no") else { return false };
    if no == "*" {
        return true;
    }
    let host = host.to_lowercase();
    let only = split_port(&host);
    for name in no.split(',') {
        let name = crate::pyfmt::strip(name);
        if name.is_empty() {
            continue;
        }
        let name = name.trim_start_matches('.').to_lowercase();
        if only == name || host == name {
            return true;
        }
        let dotted = format!(".{name}");
        if only.ends_with(&dotted) || host.ends_with(&dotted) {
            return true;
        }
    }
    false
}

/// fnmatch.fnmatchcase（* ? [ ] [! ]）
pub fn fnmatch(name: &[char], pat: &[char]) -> bool {
    if pat.is_empty() {
        return name.is_empty();
    }
    match pat[0] {
        '*' => (0..=name.len()).any(|i| fnmatch(&name[i..], &pat[1..])),
        '?' => !name.is_empty() && fnmatch(&name[1..], &pat[1..]),
        '[' => {
            // 閉じの ]（[ の直後の ! と ] は中身）
            let mut j = 1;
            if j < pat.len() && pat[j] == '!' {
                j += 1;
            }
            if j < pat.len() && pat[j] == ']' {
                j += 1;
            }
            while j < pat.len() && pat[j] != ']' {
                j += 1;
            }
            if j >= pat.len() {
                return !name.is_empty() && name[0] == '[' && fnmatch(&name[1..], &pat[1..]);
            }
            let set = &pat[1..j];
            if name.is_empty() {
                return false;
            }
            let (neg, set) = if set.first() == Some(&'!') { (true, &set[1..]) } else { (false, set) };
            if set.is_empty() {
                // [] は無い（Python は (?!)）・[!] は何か 1 字
                return neg && fnmatch(&name[1..], &pat[j + 1..]);
            }
            let c = name[0];
            let mut hit = false;
            let mut k = 0;
            while k < set.len() {
                if k + 2 < set.len() && set[k + 1] == '-' {
                    if set[k] <= set[k + 2] && set[k] <= c && c <= set[k + 2] {
                        hit = true;
                    }
                    k += 3;
                } else {
                    if set[k] == c {
                        hit = true;
                    }
                    k += 1;
                }
            }
            hit != neg && fnmatch(&name[1..], &pat[j + 1..])
        }
        c => !name.is_empty() && name[0] == c && fnmatch(&name[1..], &pat[1..]),
    }
}

/// ntpath.normcase（Windows の fnmatch。大文字小文字を区別しない・/ は \）
fn normcase(s: &str, nt: bool) -> Vec<char> {
    if nt {
        s.replace('/', "\\").to_lowercase().chars().collect()
    } else {
        s.chars().collect()
    }
}

/// urllib.request._proxy_bypass_winreg_override（; 区切り・前後の空白・<local> は . の無い名前）
pub fn bypass_override(host: &str, overrides: &str, nt: bool) -> bool {
    let host = split_port(host);
    for test in overrides.split(';') {
        let test = crate::pyfmt::strip(test);
        if test == "<local>" {
            if !host.contains('.') {
                return true;
            }
        } else if fnmatch(&normcase(host, nt), &normcase(test, nt)) {
            return true;
        }
    }
    false
}

/// urllib.request.proxy_bypass（Windows は環境変数のプロキシがあればそれ、無ければ ProxyOverride。ほかの OS は環境変数）
pub fn bypass(host: &str, sys: &System) -> bool {
    let e = env_proxies(&sys.env, sys.nt);
    if !sys.nt || !e.is_empty() {
        return bypass_env(host, &e);
    }
    let Some(reg) = &sys.reg else { return false };
    match (&reg.enable, &reg.overrides) {
        (Some(en), Some(ov)) if en.truthy() && ov.truthy() => bypass_override(host, &ov.text(), sys.nt),
        _ => false,
    }
}

/// urllib の _parse_proxy → (種類〈小文字〉, 名前:番号)。読めなければ None（ValueError）。
/// _splittype が当たらない値（種類の無い値）も、値が「/」で始まれば URL として読む（「//名前:番号」は authority・「/x」は読めない。
/// 版 3.117.1 の作った後の直し・割れ 3: 前は種類の無い値をいつも authority とし、「//proxy:3128」を名前「//proxy」と読んだ）
pub fn parse_proxy(proxy: &str) -> Option<(Option<String>, String)> {
    // _splittype: ([^/:]+):(.*)（当たらなければ種類は無く、残りは値そのもの）
    let typed = proxy.find(':').filter(|i| *i > 0 && !proxy[..*i].contains('/'));
    let (scheme, r_scheme) = match typed {
        Some(i) => (Some(proxy[..i].to_lowercase()), &proxy[i + 1..]),
        None => (None, proxy),
    };
    let (scheme, authority) = if r_scheme.starts_with('/') {
        // URL（authority は // の後ろ。@ があればその後ろの最初の / まで、無ければ 2 字目から後ろの最初の / まで）
        if !r_scheme.starts_with("//") {
            return None;
        }
        let end = match r_scheme.find('@') {
            Some(at) => r_scheme[at..].find('/').map(|x| x + at),
            None => r_scheme[2..].find('/').map(|x| x + 2),
        };
        (scheme, r_scheme[2..end.unwrap_or(r_scheme.len())].to_string())
    } else {
        // authority（種類があっても「名前:番号」の形。urllib は種類を None にする）
        (None, proxy.to_string())
    };
    // _splituser: rpartition('@')
    let hostport = match authority.rfind('@') {
        Some(at) => authority[at + 1..].to_string(),
        None => authority,
    };
    Some((scheme, hostport))
}

/// urllib.parse.unquote（UTF-8・読めない並びは U+FFFD）
fn unquote(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let b = s.as_bytes();
    let mut out: Vec<u8> = vec![];
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            out.push(u8::from_str_radix(&s[i + 1..i + 3], 16).unwrap_or(0));
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 読めないプロキシの言葉（値は出さない: 合言葉が入っているかもしれない）
fn unreadable(url_type: &str) -> String {
    format!("CM3に接続できません: {url_type} のプロキシの設定を読めません")
}

/// 1 回の問い合わせのプロキシ（Python の sysproxy.choose。urllib の ProxyHandler.proxy_open と同じ選び方に、利用者の決めを足した物）。
/// Err は使えないプロキシの言葉。url_type は 'http'・'https'、host は URL の名前:番号（百分率符号を戻した字）
pub fn choose(url_type: &str, host: &str, proxies: &[(String, String)], bypass: &dyn Fn(&str) -> bool) -> Result<Choice, String> {
    let Some(value) = proxies.iter().filter(|(k, _)| k.to_lowercase() == url_type).map(|x| x.1.clone()).next_back() else {
        return Ok(Choice::Direct);
    };
    let Some((scheme, hostport)) = parse_proxy(&value) else { return Err(unreadable(url_type)) };
    if !host.is_empty() && bypass(host) {
        return Ok(Choice::Direct);
    }
    let scheme = scheme.unwrap_or_default();
    if !matches!(scheme.as_str(), "" | "http" | "https") {
        return Err(format!("CM3に接続できません: プロキシの種類 {scheme} には対応していません（http のプロキシだけを使えます）"));
    }
    let hostport = unquote(&hostport);
    let (i, j) = (hostport.rfind(':').map(|x| x as i64).unwrap_or(-1), hostport.rfind(']').map(|x| x as i64).unwrap_or(-1));
    let (name, port) = if i > j { (&hostport[..i as usize], &hostport[i as usize + 1..]) } else { (hostport.as_str(), "") };
    let port_ok = port.is_empty() || (port.bytes().all(|b| b.is_ascii_digit()) && port.parse::<u32>().is_ok_and(|n| n <= 65535));
    if name.trim_matches(['[', ']']).is_empty() || !port_ok {
        return Err(unreadable(url_type));
    }
    Ok(Choice::Proxy(hostport))
}

/// 届かない言葉の後ろに足す一言（Python の sysproxy.pac_note）: Windows で環境変数のプロキシが無く、ProxyEnable が 0 で AutoConfigURL がある
pub fn pac_note(sys: &System) -> &'static str {
    if !sys.nt || !env_proxies(&sys.env, sys.nt).is_empty() {
        return "";
    }
    let Some(reg) = &sys.reg else { return "" };
    let enabled = reg.enable.as_ref().is_some_and(RegVal::truthy);
    let pac = reg.autoconfig.as_ref().map(|v| crate::pyfmt::strip(&v.text()).to_string()).unwrap_or_default();
    if !enabled && !pac.is_empty() {
        PAC_NOTE
    } else {
        ""
    }
}

pub const PAC_NOTE: &str = "（プロキシの自動設定〈PAC〉には対応していません）";

impl System {
    /// この PC の設定（環境変数と、Windows は HKCU のレジストリ）
    pub fn read() -> System {
        System {
            env: std::env::vars_os().map(|(k, v)| (k.to_string_lossy().into_owned(), v.to_string_lossy().into_owned())).collect(),
            reg: read_reg(),
            nt: cfg!(windows),
        }
    }

    pub fn proxies(&self) -> Vec<(String, String)> {
        proxies(self)
    }

    pub fn bypass(&self, host: &str) -> bool {
        bypass(host, self)
    }
}

#[cfg(not(windows))]
fn read_reg() -> Option<Reg> {
    None
}

/// HKCU の Internet Settings（Python の winreg.QueryValueEx と同じ値の型だけを読む: DWORD・QWORD は数、SZ・EXPAND_SZ は字〈展開しない〉）
#[cfg(windows)]
fn read_reg() -> Option<Reg> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_DWORD, REG_EXPAND_SZ, REG_QWORD, REG_SZ,
        REG_VALUE_TYPE,
    };
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let path = wide(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings");
    let mut key = HKEY::default();
    // SAFETY: 道は 0 で終わる UTF-16。key は開けたときだけ閉じる
    let opened = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(path.as_ptr()), Some(0), KEY_READ, &mut key) };
    if opened.is_err() {
        return None;
    }
    let value = |name: &str| -> Option<RegVal> {
        let n = wide(name);
        let mut ty = REG_VALUE_TYPE::default();
        let mut len: u32 = 0;
        // SAFETY: 大きさだけを尋ねる（data は None）
        let r = unsafe { RegQueryValueExW(key, PCWSTR(n.as_ptr()), None, Some(&mut ty), None, Some(&mut len)) };
        if r.is_err() {
            return None;
        }
        let mut buf = vec![0u8; len as usize + 2];
        let mut len2 = len;
        // SAFETY: buf は len2 バイト以上
        let r = unsafe { RegQueryValueExW(key, PCWSTR(n.as_ptr()), None, Some(&mut ty), Some(buf.as_mut_ptr()), Some(&mut len2)) };
        if r.is_err() {
            return None;
        }
        let data = &buf[..len2 as usize];
        match ty {
            t if t == REG_DWORD && data.len() >= 4 => {
                Some(RegVal::Int(i64::from(u32::from_le_bytes([data[0], data[1], data[2], data[3]]))))
            }
            t if t == REG_QWORD && data.len() >= 8 => {
                let mut b = [0u8; 8];
                b.copy_from_slice(&data[..8]);
                Some(RegVal::Int(u64::from_le_bytes(b) as i64))
            }
            t if t == REG_SZ || t == REG_EXPAND_SZ => {
                let w: Vec<u16> = data.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
                let end = w.iter().position(|&c| c == 0).unwrap_or(w.len());
                Some(RegVal::Str(String::from_utf16_lossy(&w[..end])))
            }
            _ => None,
        }
    };
    let reg = Reg {
        enable: value("ProxyEnable"),
        server: value("ProxyServer"),
        overrides: value("ProxyOverride"),
        autoconfig: value("AutoConfigURL"),
    };
    // SAFETY: 開けた鍵を閉じる
    unsafe {
        let _ = RegCloseKey(key);
    }
    Some(reg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnmatch_like_python() {
        let m = |n: &str, p: &str| fnmatch(&n.chars().collect::<Vec<_>>(), &p.chars().collect::<Vec<_>>());
        assert!(m("cm3.corp", "*.corp"));
        assert!(m("a", "?"));
        assert!(!m("ab", "?"));
        assert!(m("b", "[abc]"));
        assert!(!m("b", "[!abc]"));
        assert!(m("q", "[a-z]"));
        assert!(m("[x", "[x"));
        assert!(!m("a", "[]"));
        assert!(m("[!]", "[!]"));
        assert!(!m("a", "[!]"));
    }
}
