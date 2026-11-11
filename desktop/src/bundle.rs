//! 設定の束（版 3.84.0。Python の GET /api/lotlist/settings の答え）を窓が自分で組む。
//!
//! 前は窓が 10 秒ごとに Python へ束を尋ね、窓が受け持つ道（一覧・集計・ダッシュボード・保存の道・権限・使用の履歴・計算）も、
//! Python が答えないと全部 Python へ回していた（lot.rs の settings が Err）。この部品は同じ束を、配った設定（config/appsettings.json）と
//! マスタの置き場から組む。決まりの元は Python の 1 か所で、窓は Python から焼いた表（bundle_tables.json。program/tools/bundle-tables.py が焼き、
//! 古い表は tests/test_bundle_tables.py が止める）と、ここに写した組み方を持つ。答えが Python と同じことは desktop/tests/bundle_parity.rs が
//! program/tests/settings_oracle.py と突き合わせて確かめる。
//!
//! 組む物（routes/lotlist.py の lotlist_settings・lists_settings・_access_place・_conversions と同じ）:
//! - source・refresh_seconds・stale_hours・table・page_size … 配った設定に参照先マスタ（path_settings）を重ねた lot_list（path_settings.effective）
//! - engine … 配った設定の desktop.lotlist_engine（既定 rust）
//! - conversions … 変換表の表（conversions.tables）と版の印（窓が読み直すかを決める字。Python の字とは別の形で、比べない）
//! - lists … hidden・work.canEditShifts は窓が権限を受け持つので null。dash（設備の名前・設備グループ・試験の「いま」）・sources（データ元の並び）・
//!   work（作業実績の決まりと登録）・shifts（勤務体系）
//! - access … who（名乗り。services/identity.py と同じ順）と place（マスタ・利用状況の置き場）。置き場の引っ越しの印をたどる係は窓の 1 つ
//!   （follow_moved。Python は窓が名乗ると印をたどらず、この PC の覚え master_share.json を読み直すだけ）
//! - calculation・uiProfileKeys
//!
//! 窓が Python と同じに組めない形は None（Python に尋ねる。前と同じ）: 配った設定・マスタのファイルが窓の読めない字（NaN・大きな数・深い入れ子）・
//! 共有のフォルダにまだ無いマスタ（Python は読むだけで写しから最初の版を作る）・Python が束を作れずに落ちる形（データ元の行の間隔が inf・nan、
//! 設定の段が表でない など）・設備グループの正規表現の決まり（Python の re で確かめる）。

use crate::access::Place;
use crate::pyfmt;
use crate::worksum::{equipment_list, py_str};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

static TABLES: LazyLock<Value> = LazyLock::new(|| serde_json::from_str(include_str!("bundle_tables.json")).expect("bundle_tables.json"));

/// Python から焼いた決まりの表（page.rs も使う）
pub fn tables() -> &'static Value {
    &TABLES
}

fn t(path: &[&str]) -> &'static Value {
    let mut v: &Value = &TABLES;
    for k in path {
        v = &v[*k];
    }
    v
}

/// 束を組めない（Python に尋ねる）
#[derive(Debug, Clone, PartialEq)]
pub struct Py(pub &'static str);
type R<T> = Result<T, Py>;

// ------------------------------------------------------------------ Python の字の扱い
/// Python の str(v).strip()（None は ""。表・並びは Python の repr と字が違うので組まない）
fn s(v: Option<&Value>) -> R<String> {
    match v {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::Array(_) | Value::Object(_)) => Err(Py("字にする表・並び")),
        Some(x) => Ok(pyfmt::strip(&py_str(x)).to_string()),
    }
}

/// Python の真偽（bool(v)。窓のほかの部品が使う: sources_list.rs）
pub fn py_truthy(v: &Value) -> bool {
    truthy(Some(v))
}

/// Python の真偽（bool(v)）
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(x)) => !x.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
    }
}

/// `v or {}` を表として（真で表でなければ Python は .get で落ちる）
fn dict_or_empty(v: Option<&Value>) -> R<Map<String, Value>> {
    match v {
        Some(Value::Object(o)) => Ok(o.clone()),
        x if !truthy(x) => Ok(Map::new()),
        _ => Err(Py("表でない段")),
    }
}

/// Python の _get(d, "a.b.c")（表の中だけをたどる。無ければ None）
fn dotted<'a>(d: &'a Value, key: &str) -> Option<&'a Value> {
    let mut cur = d;
    for part in key.split('.') {
        cur = cur.as_object()?.get(part)?;
    }
    Some(cur)
}

/// Python の `v not in (None, "")`
fn present(v: Option<&Value>) -> bool {
    !matches!(v, None | Some(Value::Null)) && v != Some(&Value::String(String::new()))
}

/// fsio.unquote_path: str(v or "").strip().strip('"')
fn unquote(x: &str) -> String {
    pyfmt::strip(x).trim_matches('"').to_string()
}

/// Python の int(字)（10 進。前後の空白・符号・数字の間の _。大きな数も並べ替えに使えるよう i128 で持つ。読めなければ None）
/// Python の int(字)（窓のほかの部品が使う。page.rs・presence.rs）
pub fn wide_int_text(x: &str) -> Option<i128> {
    wide_int_str(x)
}

fn wide_int_str(x: &str) -> Option<i128> {
    let t = pyfmt::strip(x);
    let (neg, rest) = match t.chars().next() {
        Some('-') => (true, &t[1..]),
        Some('+') => (false, &t[1..]),
        _ => (false, t),
    };
    let cs: Vec<char> = rest.chars().collect();
    if cs.is_empty() || cs[0] == '_' || cs[cs.len() - 1] == '_' {
        return None;
    }
    let mut v: i128 = 0;
    let mut prev_us = false;
    for c in cs {
        if c == '_' {
            if prev_us {
                return None;
            }
            prev_us = true;
            continue;
        }
        prev_us = false;
        let d = pyfmt::digit(c)? as i128;
        v = v.saturating_mul(10).saturating_add(d);
    }
    Some(if neg { -v } else { v })
}

/// Python の int(値)（JSON の値: 真偽は 0・1、小数は 0 の向きへ切る、字は int(字)）。読めなければ None（Python は落ちる）
fn wide_int(v: &Value) -> Option<i128> {
    match v {
        Value::Bool(b) => Some(*b as i128),
        Value::Number(n) => match (n.as_i64(), n.as_u64(), n.as_f64()) {
            (Some(i), _, _) => Some(i as i128),
            (_, Some(u), _) => Some(u as i128),
            (_, _, Some(f)) if f.is_finite() => Some(f.trunc() as i128),
            _ => None,
        },
        Value::String(x) => wide_int_str(x),
        _ => None,
    }
}

/// int(x)（JSON の値。読めなければ Python は落ちる）
fn int_of(v: Option<&Value>) -> R<i128> {
    match v {
        None | Some(Value::Null) => Ok(0),
        Some(x) => wide_int(x).ok_or(Py("int() で読めない値")),
    }
}

/// Python の str(v or "")（空白は落とさない。表・並びは Python の repr と字が違うので組まない）
fn pstr(v: Option<&Value>) -> R<String> {
    match v {
        x if !truthy(x) => Ok(String::new()),
        Some(Value::Array(_) | Value::Object(_)) => Err(Py("字にする表・並び")),
        Some(x) => Ok(py_str(x)),
        None => Ok(String::new()),
    }
}

/// Python の json.loads と同じに読む（NaN・Infinity も読む。この PC の覚え・配る版の覚え・引っ越しの印・配った設定の置き場の段のため）。
/// NaN などは null に読み替える（これらのファイルで使う値〈dir・to・at・setAt・chosenAt・master_share〉には効かない）
fn lenient_json(t: &str) -> Option<Value> {
    if let Ok(v) = serde_json::from_str(t) {
        return Some(v);
    }
    let mut out = String::with_capacity(t.len());
    let (mut in_str, mut esc) = (false, false);
    let mut rest = t;
    while let Some(c) = rest.chars().next() {
        if in_str {
            out.push(c);
            if esc {
                esc = false;
            } else if c == '\\' {
                esc = true;
            } else if c == '"' {
                in_str = false;
            }
            rest = &rest[c.len_utf8()..];
            continue;
        }
        if c == '"' {
            in_str = true;
        }
        let tok = ["-Infinity", "Infinity", "NaN"].into_iter().find(|k| rest.starts_with(k));
        if let Some(k) = tok {
            out.push_str("null");
            rest = &rest[k.len()..];
            continue;
        }
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    serde_json::from_str(&out).ok()
}

// ------------------------------------------------------------------ 道（pathlib の str(Path(x))）
/// str(Path(x))。POSIX は区切りの重なりと「.」を除き、末尾の / を外す（先頭がちょうど // は残す）。Windows は / を \ にそろえ、
/// ドライブ・UNC の根を残して同じに整える（Windows の字が同じかは verify.py の通しで見る）
pub fn py_path(x: &str) -> String {
    if cfg!(windows) {
        win_path(x)
    } else {
        posix_path(x)
    }
}

/// str(PurePosixPath(x))（release_place の事例の表が両方の決まりを使う）
pub fn posix_path(x: &str) -> String {
    if x.is_empty() {
        return ".".into();
    }
    let root = if x.starts_with("//") && !x.starts_with("///") {
        "//"
    } else if x.starts_with('/') {
        "/"
    } else {
        ""
    };
    let parts: Vec<&str> = x.split('/').filter(|p| !p.is_empty() && *p != ".").collect();
    let body = parts.join("/");
    if root.is_empty() && body.is_empty() {
        ".".into()
    } else {
        format!("{root}{body}")
    }
}

/// str(PureWindowsPath(x))
pub fn win_path(x: &str) -> String {
    let x = x.replace('/', "\\");
    if x.is_empty() {
        return ".".into();
    }
    let (root, rest): (String, &str) = if let Some(r) = x.strip_prefix("\\\\") {
        // UNC: \\server\share が根
        let mut it = r.splitn(3, '\\');
        let server = it.next().unwrap_or("");
        let share = it.next().unwrap_or("");
        let rest = it.next().unwrap_or("");
        (format!("\\\\{server}\\{share}\\"), rest)
    } else if x.len() >= 2 && x.as_bytes()[1] == b':' {
        let drive = &x[..2];
        let r = &x[2..];
        match r.strip_prefix('\\') {
            Some(r) => (format!("{drive}\\"), r),
            None => (drive.to_string(), r),
        }
    } else if let Some(r) = x.strip_prefix('\\') {
        ("\\".into(), r)
    } else {
        (String::new(), x.as_str())
    };
    let parts: Vec<&str> = rest.split('\\').filter(|p| !p.is_empty() && *p != ".").collect();
    let body = parts.join("\\");
    if root.is_empty() && body.is_empty() {
        ".".into()
    } else {
        format!("{root}{body}")
    }
}

/// os.path.expandvars（POSIX: $NAME・${NAME}。Windows: さらに %NAME%。無い名前はそのまま残す）
pub fn expandvars(x: &str) -> String {
    if !x.contains('$') && !(cfg!(windows) && x.contains('%')) {
        return x.into();
    }
    let cs: Vec<char> = x.chars().collect();
    let is_name = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut out = String::new();
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if c == '%' && cfg!(windows) {
            if let Some(j) = cs[i + 1..].iter().position(|&d| d == '%') {
                let name: String = cs[i + 1..i + 1 + j].iter().collect();
                if j == 0 {
                    out.push('%'); // %% は % 1 つ
                } else if let Ok(v) = std::env::var(&name) {
                    out.push_str(&v);
                } else {
                    out.push('%');
                    out.push_str(&name);
                    out.push('%');
                }
                i += j + 2;
                continue;
            }
        }
        if c == '$' {
            if cs.get(i + 1) == Some(&'{') {
                if let Some(j) = cs[i + 2..].iter().position(|&d| d == '}') {
                    let name: String = cs[i + 2..i + 2 + j].iter().collect();
                    match std::env::var(&name) {
                        Ok(v) if !name.is_empty() => out.push_str(&v),
                        _ => out.extend(&cs[i..i + 3 + j]),
                    }
                    i += j + 3;
                    continue;
                }
            } else {
                let n = cs[i + 1..].iter().take_while(|&&d| is_name(d)).count();
                if n > 0 {
                    let name: String = cs[i + 1..i + 1 + n].iter().collect();
                    match std::env::var(&name) {
                        Ok(v) => out.push_str(&v),
                        Err(_) => out.extend(&cs[i..i + 1 + n]),
                    }
                    i += n + 1;
                    continue;
                }
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

// ------------------------------------------------------------------ 名乗り（services/identity.py）
/// SHA-1（presence.terminal_key の 6 字に使う。依存を増やさないためにここで数える）
pub fn sha1_hex(data: &[u8]) -> String {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let mut msg = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for (i, word) in chunk.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let tmp = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = tmp;
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e]) {
            *x = x.wrapping_add(y);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

/// presence.terminal_key: 「PC@ログイン」。ファイル名に使えない字・空白は _（101 字目から切る）、変えたら sha1 の頭 6 字を足す
pub fn terminal_key(login: &str, pc: &str) -> String {
    let raw = format!("{}@{}", if pc.is_empty() { "?" } else { pc }, if login.is_empty() { "?" } else { login });
    let safe: String = raw.chars().map(|c| if "\\/:*?\"<>|".contains(c) || pyfmt::is_space(c) { '_' } else { c }).take(100).collect();
    if safe == raw {
        safe
    } else {
        format!("{safe}-{}", &sha1_hex(raw.as_bytes())[..6])
    }
}

fn env_nonempty(k: &str) -> Option<String> {
    std::env::var(k).ok().map(|v| pyfmt::strip(&v).to_string()).filter(|v| !v.is_empty())
}

/// identity.current_login_id: os.getlogin → getpass.getuser（LOGNAME・USER・LNAME・USERNAME → この利用者の名前）→ USERNAME → USER → LOGNAME
pub fn login_id() -> String {
    if let Some(v) = os_login() {
        return v;
    }
    // getpass.getuser: 空でない（空白だけでも）最初の環境の値。無ければ利用者の名前。その答えを strip して空なら次へ
    let user = ["LOGNAME", "USER", "LNAME", "USERNAME"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
        .or_else(account_name)
        .unwrap_or_default();
    let user = pyfmt::strip(&user).to_string();
    if !user.is_empty() {
        return user;
    }
    ["USERNAME", "USER", "LOGNAME"].iter().find_map(|k| env_nonempty(k)).unwrap_or_default()
}

#[cfg(windows)]
fn os_login() -> Option<String> {
    // os.getlogin は Windows では GetUserNameW
    use windows::core::PWSTR;
    use windows::Win32::System::WindowsProgramming::GetUserNameW;
    let mut buf = vec![0u16; 257];
    let mut n = buf.len() as u32;
    unsafe { GetUserNameW(Some(PWSTR(buf.as_mut_ptr())), &mut n) }.ok()?;
    let v = String::from_utf16_lossy(&buf[..n.saturating_sub(1) as usize]);
    Some(pyfmt::strip(&v).to_string()).filter(|v| !v.is_empty())
}

#[cfg(not(windows))]
fn os_login() -> Option<String> {
    // os.getlogin（utmp）は端末の無い窓では読めない（OSError）ことが多い。窓は環境と利用者の名前で同じ順をたどる
    None
}

#[cfg(windows)]
fn account_name() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn account_name() -> Option<String> {
    // getpass.getuser の最後: pwd.getpwuid(os.getuid())
    use std::os::unix::fs::MetadataExt;
    let uid = std::fs::metadata("/proc/self").ok()?.uid();
    let text = std::fs::read_to_string("/etc/passwd").ok()?;
    text.lines().find_map(|l| {
        let f: Vec<&str> = l.split(':').collect();
        (f.len() > 2 && f[2] == uid.to_string()).then(|| f[0].to_string())
    })
}

fn usable(v: &str) -> String {
    let v = pyfmt::strip(v);
    let low = v.to_lowercase();
    if t(&["uselessPcNames"]).as_array().is_some_and(|a| a.iter().any(|x| x.as_str() == Some(low.as_str()))) {
        String::new()
    } else {
        v.chars().take(80).collect()
    }
}

#[cfg(windows)]
fn host_name() -> String {
    // socket.gethostname（CPython の Windows: GetComputerNameExW(ComputerNamePhysicalDnsHostname)）
    use windows::core::PWSTR;
    use windows::Win32::System::SystemInformation::{ComputerNamePhysicalDnsHostname, GetComputerNameExW};
    let mut n: u32 = 0;
    let _ = unsafe { GetComputerNameExW(ComputerNamePhysicalDnsHostname, None, &mut n) };
    let mut buf = vec![0u16; n.max(1) as usize];
    if unsafe { GetComputerNameExW(ComputerNamePhysicalDnsHostname, Some(PWSTR(buf.as_mut_ptr())), &mut n) }.is_err() {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..n as usize])
}

#[cfg(not(windows))]
fn host_name() -> String {
    std::fs::read_to_string("/proc/sys/kernel/hostname").map(|x| x.trim_end_matches('\n').to_string()).unwrap_or_default()
}

/// 設定の値ごとに覚えた PC 名（設定の値 → (名前, どこから)）
type PcCache = (String, (String, String));

/// identity.resolve_pc_name: 設定（この端末の名前）→ ホスト名 → COMPUTERNAME → platform.node → HOSTNAME → FQDN → /etc/hostname
/// （使えない名前〈localhost など〉は飛ばし、80 字まで）→ (名前, どこから)
pub fn pc_name(over: &str) -> (String, String) {
    static CACHE: LazyLock<Mutex<Vec<PcCache>>> = LazyLock::new(Mutex::default);
    let key = pyfmt::strip(over).to_string();
    if let Some((_, v)) = CACHE.lock().unwrap().iter().find(|(k, _)| *k == key) {
        return v.clone();
    }
    let etc = || std::fs::read_to_string("/etc/hostname").map(|x| pyfmt::strip(&x).to_string()).unwrap_or_default();
    let host = host_name();
    let cands: Vec<(&str, String)> = vec![
        ("設定（この端末の名前）", key.clone()),
        ("ホスト名", host.clone()),
        ("COMPUTERNAME", std::env::var("COMPUTERNAME").unwrap_or_default()),
        ("platform.node", host.clone()),
        ("HOSTNAME", std::env::var("HOSTNAME").unwrap_or_default()),
        ("FQDN", host.split('.').next().unwrap_or("").to_string()),
        ("/etc/hostname", if cfg!(windows) { String::new() } else { etc() }),
    ];
    let got = cands.into_iter().find_map(|(label, v)| {
        let u = usable(&v);
        (!u.is_empty()).then(|| (u, label.to_string()))
    });
    let v = got.unwrap_or_default();
    CACHE.lock().unwrap().push((key, v.clone()));
    v
}

// ------------------------------------------------------------------ 置き場（repositories/master_store.py の MasterStore）
/// 束を組む材料の置き場。base は MasterStore の base（data/ の親。製品では program）・program は同梱の最初の中身
/// （app/master_defaults）と配った設定の置き場・local はこの PC の作業場所（master_share.json・want.json・master_cache）
#[derive(Debug, Clone)]
pub struct Env {
    pub base: PathBuf,
    pub program: PathBuf,
    pub local: PathBuf,
    /// 配った設定のファイル（TRANSFER_APP_CONFIG があればそれ・無ければ config/appsettings.json・それも無ければ見本）
    pub config: PathBuf,
    /// 試験の「いま」（TPA_DASHBOARD_NOW。Python の DASHBOARD_NOW。製品では無い）
    pub now: Option<String>,
}

impl Env {
    /// 製品の形（窓が中身〈program〉と作業場所から決める。app_env.config_path と同じ順）
    pub fn production(program: &Path, local: &Path) -> Env {
        // 相対の道は中身のフォルダから（Python は中身のフォルダで動く: sidecar.rs の current_dir）
        let config = std::env::var_os("TRANSFER_APP_CONFIG")
            .map(|v| program.join(v))
            .unwrap_or_else(|| program.join("config").join("appsettings.json"));
        let config = if config.exists() { config } else { program.join("config").join("appsettings.example.json") };
        // create_app の base は Path(__file__).resolve() の親（道を解いた形）
        let program = resolved(program);
        Env {
            base: program.clone(),
            program: program.clone(),
            local: local.to_path_buf(),
            config,
            now: std::env::var("TPA_DASHBOARD_NOW").ok().filter(|v| !v.is_empty()),
        }
    }
}

/// Path.resolve() と同じく道を解く（Windows の \\?\ の頭は外す）。解けなければそのまま
fn resolved(p: &Path) -> PathBuf {
    let Ok(c) = std::fs::canonicalize(p) else { return p.to_path_buf() };
    let t = c.to_string_lossy().into_owned();
    if let Some(r) = t.strip_prefix("\\\\?\\UNC\\") {
        PathBuf::from(format!("\\\\{r}"))
    } else if let Some(r) = t.strip_prefix("\\\\?\\") {
        PathBuf::from(r)
    } else {
        c
    }
}

fn join(a: &str, b: &str) -> String {
    py_path(&format!("{a}{}{b}", if cfg!(windows) { "\\" } else { "/" }))
}

/// 置き場の見分け（master_store._norm）
fn norm(p: &str) -> String {
    p.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

fn read_json(p: &Path) -> Option<Value> {
    let b = std::fs::read(p).ok()?;
    let b = b.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&b);
    lenient_json(std::str::from_utf8(b).ok()?)
}

fn py_float(v: Option<&Value>) -> R<f64> {
    let f = match v {
        Some(Value::Number(n)) => n.as_f64().ok_or(Py("数"))?,
        Some(Value::Bool(b)) => *b as i64 as f64,
        Some(Value::String(x)) => pyfmt::py_float(x).map_err(|_| Py("float() で読めない字"))?,
        _ => return Err(Py("float() で読めない値")),
    };
    if f.is_finite() {
        Ok(f)
    } else {
        Err(Py("有限でない数"))
    }
}

#[derive(Debug, Clone)]
struct Store {
    share: Option<String>,
    shared: Vec<String>,
    lock_ttl: f64,
    refresh: f64,
}

/// 束を組む係（窓に 1 つ。置き場の引っ越しの印をたどる係も兼ねる）
pub struct Builder {
    pub env: Env,
    moved_checked: Mutex<Option<Instant>>,
    /// この版で束を組めなかった理由（記録・試験）
    pub last_skip: Mutex<Option<&'static str>>,
}

impl Builder {
    pub fn new(env: Env) -> Builder {
        Builder { env, moved_checked: Mutex::default(), last_skip: Mutex::default() }
    }

    fn local(&self, name: &str) -> PathBuf {
        self.env.local.join(name)
    }

    fn store(&self, settings: &Value) -> R<Store> {
        let cfg = dict_or_empty(settings.get("master_share"))?;
        let raw = match cfg.get("dir") {
            Some(v) if truthy(Some(v)) => s(Some(v))?,
            _ => String::new(),
        };
        let mut share = (!raw.is_empty()).then(|| py_path(&expandvars(&raw)));
        let masters = cfg.get("masters").filter(|m| truthy(Some(m))).cloned().unwrap_or_else(|| t(&["store", "sharedDefault"]).clone());
        let mut shared: Vec<String> = match masters {
            Value::Array(a) => a.iter().map(|x| x.as_str().map(String::from).ok_or(Py("共有の名前が字でない"))).collect::<R<_>>()?,
            Value::String(x) => x.chars().map(String::from).collect(), // set("abc") は字ごと
            _ => return Err(Py("共有の名前の並びが読めない")),
        };
        for n in t(&["store", "sharedAlways"]).as_array().into_iter().flatten() {
            shared.push(n.as_str().unwrap_or("").into());
        }
        shared.sort();
        shared.dedup();
        let lock_ttl = match cfg.get("lock_ttl_seconds") {
            None => t(&["store", "lockTtl"]).as_f64().unwrap_or(20.0),
            v => py_float(v)?,
        };
        let refresh = match cfg.get("refresh_seconds") {
            None => t(&["store", "refresh"]).as_f64().unwrap_or(5.0),
            v => py_float(v)?,
        };
        // この PC が覚えた置き場（画面で変えた・引っ越し先をたどった）があれば、設定ファイルの値より先に使う
        if let Some(Value::Object(o)) = read_json(&self.local(t(&["store", "override"]).as_str().unwrap_or("master_share.json"))) {
            if let Some(v) = o.get("dir").filter(|v| truthy(Some(v))) {
                let ov = s(Some(v))?;
                if !ov.is_empty() {
                    share = Some(py_path(&ov));
                }
            }
        }
        Ok(Store { share, shared, lock_ttl, refresh })
    }

    fn override_doc(&self) -> Map<String, Value> {
        match read_json(&self.local(t(&["store", "override"]).as_str().unwrap_or(""))) {
            Some(Value::Object(o)) => o,
            _ => Map::new(),
        }
    }

    /// 配る版の覚えの置き場へ移るべきなら、その場所（master_store._pin_target）
    fn pin_target(&self) -> Option<String> {
        let pin = match read_json(&self.local(t(&["store", "pin"]).as_str().unwrap_or("want.json")))? {
            Value::Object(o) => o.get("masters")?.as_object()?.clone(),
            _ => return None,
        };
        let dir = s(pin.get("dir")).ok().filter(|d| !d.is_empty())?;
        let chosen = pstr(self.override_doc().get("chosenAt")).unwrap_or_default();
        if !chosen.is_empty() && pstr(pin.get("setAt")).unwrap_or_default() <= chosen {
            return None;
        }
        let d = py_path(&dir);
        let p = Path::new(&d);
        let marked = t(&["store", "markers"]).as_array().into_iter().flatten().any(|m| p.join(m.as_str().unwrap_or("")).is_file());
        (p.is_dir() && marked).then_some(d)
    }

    fn moved_to(folder: &str) -> Option<Map<String, Value>> {
        match read_json(&Path::new(folder).join(t(&["store", "moved"]).as_str().unwrap_or("_MOVED.json")))? {
            Value::Object(o) if s(o.get("to")).is_ok_and(|x| !x.is_empty()) => Some(o),
            _ => None,
        }
    }

    /// 引っ越しの印をたどる（master_store.follow_moved。窓が名乗ったときの係は窓の 1 つ。Python はこの PC の覚えを読み直すだけ）。
    /// 数秒（refresh_seconds）に 1 回だけ見る。移ったら新しい置き場を覚えて（master_share.json）、その置き場を返す
    fn follow_moved(&self, st: &Store, who: &Value) -> Option<String> {
        {
            let mut last = self.moved_checked.lock().unwrap();
            if last.is_some_and(|l| l.elapsed().as_secs_f64() < st.refresh) {
                return None;
            }
            *last = Some(Instant::now());
        }
        if let Some(pin) = self.pin_target() {
            if st.share.as_ref().is_some_and(|sh| norm(&pin) == norm(sh)) {
                return None;
            }
            self.retarget(st, &pin, who);
            return Some(pin);
        }
        let share = st.share.clone()?;
        let (mut cur, mut hops, mut last_at) = (share.clone(), 0, None::<String>);
        let mut seen = vec![norm(&share)];
        while hops < t(&["store", "movedHops"]).as_i64().unwrap_or(5) {
            let Some(m) = Self::moved_to(&cur) else { break };
            let at = pstr(m.get("at")).unwrap_or_default();
            if last_at.as_ref().is_some_and(|l| at <= *l) {
                break;
            }
            let nxt = py_path(&s(m.get("to")).unwrap_or_default());
            if !Path::new(&nxt).is_dir() || norm(&nxt) == norm(&cur) {
                break;
            }
            cur = nxt;
            hops += 1;
            last_at = Some(at);
            if seen.contains(&norm(&cur)) {
                break;
            }
            seen.push(norm(&cur));
        }
        if hops == 0 || norm(&cur) == norm(&share) {
            return None;
        }
        self.retarget(st, &cur, who);
        Some(cur)
    }

    /// 置き場を new に切り替えたことを、この PC に覚える（master_store.retarget(persist=True)。履歴は新しい順に 10 個）
    fn retarget(&self, st: &Store, new: &str, who: &Value) {
        let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let by = json!({"pc": who["pc"], "login": who["login"]});
        let old = self.override_doc();
        let mut hist = vec![json!({"dir": st.share.clone().unwrap_or_default(), "until": now, "by": by})];
        if let Some(Value::Array(h)) = old.get("history") {
            hist.extend(h.iter().filter(|x| x.is_object()).cloned());
        }
        hist.truncate(t(&["store", "historyKeep"]).as_u64().unwrap_or(10) as usize);
        let mut doc = json!({"dir": new, "at": now, "by": by, "history": hist});
        if let Some(c) = old.get("chosenAt").filter(|c| truthy(Some(c))) {
            doc["chosenAt"] = c.clone();
        }
        let _ = crate::master_store::write_json_atomic(&self.local(t(&["store", "override"]).as_str().unwrap_or("")), &doc);
    }
}

// ------------------------------------------------------------------ 参照先の重ね（services/path_settings.py の effective・parse）
/// 画面から来た字 → その項目の値（Ok(None) は空・合わない値で、既定のまま。Python の parse の ValueError と同じ）。
/// 読み方は書く道と同じ 1 つの関数（settings_write::parse_value。版 3.89.0）。ブラウザの欄・並びの値は Python に任せる
fn parse_item(item: &Value, raw: Option<&Value>) -> R<Option<Value>> {
    use crate::settings_write::{parse_value, Bad};
    match parse_value(item, raw) {
        Ok(v) => Ok(v),
        Err(Bad::Invalid(_)) => Ok(None),
        Err(Bad::Python) => Err(Py("参照先の値は Python が読む（ブラウザの欄・表・並び）")),
    }
}

fn set_dotted(d: &mut Value, key: &str, v: Value) -> R<()> {
    let parts: Vec<&str> = key.split('.').collect();
    let mut cur = d;
    for p in &parts[..parts.len() - 1] {
        let o = cur.as_object_mut().ok_or(Py("設定の段が表でない"))?;
        cur = o.entry(p.to_string()).or_insert_with(|| json!({}));
    }
    cur.as_object_mut().ok_or(Py("設定の段が表でない"))?.insert(parts[parts.len() - 1].into(), v);
    Ok(())
}

/// 配った設定に、参照先マスタで変えた値を重ねた設定（束に出る項目だけ。path_settings.effective）
/// 参照先マスタを配った設定に重ねる（path_settings.effective）。重ねる項目は焼いた表の items（束は pathItems、/api/config は configItems も）
fn effective(settings: &Value, rows: &[Value], items: &[&str]) -> R<Value> {
    let mut by: Vec<(String, &Value)> = vec![];
    for r in rows {
        let o = r.as_object().ok_or(Py("参照先の行が表でない"))?;
        let k = if truthy(o.get("項目")) { s(o.get("項目"))? } else { String::new() };
        // str(r.get("項目") or "")。strip しない（Python の by_key と同じ）
        let k = if truthy(o.get("項目")) { o.get("項目").map(py_str).unwrap_or(k) } else { k };
        match by.iter_mut().find(|(n, _)| *n == k) {
            Some(slot) => slot.1 = r,
            None => by.push((k, r)),
        }
    }
    // 束に出ない項目も Python は重ねる。その段が表でない設定に重ねると Python は落ちる（_set の setdefault）ので、窓も組まない
    for key in t(&["otherItems"]).as_array().into_iter().flatten().filter_map(Value::as_str) {
        let Some((_, row)) = by.iter().find(|(n, _)| n == key) else { continue };
        let raw = match row.get("値") {
            None | Some(Value::Null) => String::new(),
            Some(x) => pyfmt::strip(&py_str(x)).to_string(),
        };
        if raw.is_empty() {
            continue;
        }
        let parts: Vec<&str> = key.split('.').collect();
        let mut cur = settings;
        for p in &parts[..parts.len() - 1] {
            match cur.as_object().and_then(|o| o.get(*p)) {
                None => break,
                Some(x) if x.is_object() => cur = x,
                Some(_) => return Err(Py("束に出ない項目の段が表でない（Python は重ねるときに落ちる）")),
            }
        }
    }
    let mut eff = settings.clone();
    for item in items.iter().flat_map(|k| t(&[k]).as_array().into_iter().flatten()) {
        let key = item["key"].as_str().unwrap_or("");
        if let Some((_, row)) = by.iter().find(|(n, _)| n == key) {
            if let Some(v) = parse_item(item, row.get("値"))? {
                set_dotted(&mut eff, key, v)?;
            }
        }
    }
    Ok(eff)
}

// ------------------------------------------------------------------ データ元の並び（services/data_sources.py の sources）
fn num_of(v: Option<&Value>, dflt: &Value) -> R<Value> {
    let x = s(v)?;
    let Ok(n) = pyfmt::py_float(&x) else { return Ok(dflt.clone()) };
    if !n.is_finite() {
        return Err(Py("データ元の行の間隔が inf・nan（Python は int() で落ちる）"));
    }
    // int(n) if n == int(n) else n（Python の int は桁に限りが無い。i64・u64 に入らない整数は JSON で同じに渡せないので組まない）
    if n.fract() != 0.0 {
        return Ok(json!(n));
    }
    if n.abs() < 9.223_372_036_854_775e18 {
        Ok(json!(n as i64))
    } else if (0.0..1.844_674_407_370_955_2e19).contains(&n) {
        Ok(json!(n as u64))
    } else {
        Err(Py("データ元の行の間隔が u64 に入らない整数"))
    }
}

/// 写し直す間隔・古いとみなす時間・1 頁の件数（data_sources.read_params）
fn read_params(settings: &Value, key: &str, row: &Map<String, Value>) -> R<Value> {
    let src = dict_or_empty(settings.get("sources"))?;
    let mut out = t(&["sources", "readDefaults"]).as_object().cloned().unwrap_or_default();
    for layer in [src.get("defaults"), src.get(key)] {
        for (k, v) in dict_or_empty(layer)? {
            if out.contains_key(&k) && present(Some(&v)) {
                out.insert(k, v);
            }
        }
    }
    let bind = t(&["sources", "connBind", key]);
    for (k, field) in [("refresh_seconds", "refresh"), ("stale_hours", "stale")] {
        let b = bind.get(field).and_then(Value::as_str);
        let col = t(&["sources", "rowRead", k]).as_str().unwrap_or("");
        if let Some(v) = b.and_then(|b| dotted(settings, b)).filter(|v| present(Some(v))) {
            out.insert(k.into(), v.clone());
        } else if !row.is_empty() && !s(row.get(col))?.is_empty() {
            let d = out[k].clone();
            out.insert(k.into(), num_of(row.get(col), &d)?);
        }
    }
    Ok(Value::Object(out))
}

/// 並びの字（Python の `it.get(k) or []` を回す: 字は 1 字ずつ・表は鍵・数と真は落ちる）
fn py_iter(v: Option<&Value>) -> R<Vec<Value>> {
    match v {
        x if !truthy(x) => Ok(vec![]),
        Some(Value::Array(a)) => Ok(a.clone()),
        Some(Value::String(x)) => Ok(x.chars().map(|c| json!(c.to_string())).collect()),
        Some(Value::Object(o)) => Ok(o.keys().map(|k| json!(k)).collect()),
        _ => Err(Py("回せない値")),
    }
}

/// 行の「結合」→ 決まりの並び（data_join.parse）
fn joins_of(v: Option<&Value>) -> R<Value> {
    let items: Vec<Value> = match v {
        Some(Value::Array(a)) => a.clone(),
        Some(Value::String(x)) if !pyfmt::strip(x).is_empty() => {
            if crate::master_rows::text_split(x) {
                return Err(Py("結合の字が窓の読めない JSON"));
            }
            match serde_json::from_str(x) {
                Ok(Value::Array(a)) => a,
                _ => vec![],
            }
        }
        _ => vec![],
    };
    let hows = t(&["join", "hows"]).as_array().cloned().unwrap_or_default();
    let max_keys = t(&["join", "maxKeys"]).as_u64().unwrap_or(8) as usize;
    let max_joins = t(&["join", "maxJoins"]).as_u64().unwrap_or(6) as usize;
    let mut out = vec![];
    for it in items {
        let Value::Object(it) = it else { continue };
        let mut on = vec![];
        for p in py_iter(it.get("on"))? {
            if let Value::Array(p) = p {
                if p.len() == 2 {
                    let (a, b) = (s(Some(&p[0]))?, s(Some(&p[1]))?);
                    if !a.is_empty() && !b.is_empty() {
                        on.push(json!([a, b]));
                    }
                }
            }
        }
        on.truncate(max_keys);
        let how = it.get("how").filter(|h| hows.contains(h)).cloned().unwrap_or(json!("left"));
        let mut cols = vec![];
        for c in py_iter(it.get("cols"))? {
            let c = s(Some(&c))?;
            if !c.is_empty() {
                cols.push(json!(c));
            }
        }
        out.push(json!({"with": s(it.get("with"))?, "how": how, "on": on, "cols": cols}));
    }
    out.truncate(max_joins);
    Ok(Value::Array(out))
}

/// 並べる鍵（並びの番号・組み込みが先・id）と元
type Keyed = ((i128, i128, i128), Map<String, Value>);

fn order_of(v: &str) -> i128 {
    let x = if v.is_empty() { "1000000" } else { v };
    wide_int_str(x).unwrap_or(1_000_000)
}

/// いま効いているデータ元の並び（data_sources.sources）を、束に出す鍵だけにした物
fn sources(settings: &Value, rows: &[Value]) -> R<Vec<Value>> {
    // role（版 3.85.0）: ダッシュボードのデータの並び（/api/dashboard/sources）を窓が束から答える
    const KEEP: [&str; 14] =
        ["key", "kind", "name", "role", "place", "table", "base", "broken", "api", "lotSet", "joins", "read", "equipColumn", "equipMode"];
    Ok(sources_all(settings, rows, false)?
        .into_iter()
        .map(|d| Value::Object(KEEP.iter().map(|k| (k.to_string(), d.get(*k).cloned().unwrap_or(Value::Null))).collect()))
        .collect())
}

/// data_sources.sources の全部の鍵（版 3.87.0。GET /api/sources: src/sources_list.rs）
pub(crate) fn sources_full(settings: &Value, rows: &[Value]) -> R<Vec<Map<String, Value>>> {
    sources_all(settings, rows, true)
}

/// data_sources.sources。full でなければ束に出す鍵の材料だけを作る（束は備考などの字を読まない: 読めない字で束を組めなくしない）
fn sources_all(settings: &Value, rows: &[Value], full: bool) -> R<Vec<Map<String, Value>>> {
    let mut by: Vec<(String, Map<String, Value>)> = vec![];
    for r in rows {
        let o = r.as_object().ok_or(Py("データ元の行が表でない"))?;
        let k = s(o.get("キー"))?;
        match by.iter_mut().find(|(n, _)| *n == k) {
            Some(slot) => slot.1 = o.clone(),
            None => by.push((k, o.clone())),
        }
    }
    let builtins = t(&["sources", "builtins"]).as_array().cloned().unwrap_or_default();
    let mut out: Vec<Map<String, Value>> = vec![];
    for b in &builtins {
        let bk = b["key"].as_str().unwrap_or("");
        let row = by.iter().find(|(n, _)| n == bk).map(|(_, r)| r.clone()).unwrap_or_default();
        let mut d = b.as_object().cloned().unwrap_or_default();
        d.insert("builtin".into(), json!(true));
        if full {
            d.insert("id".into(), row.get("id").cloned().unwrap_or(Value::Null));
            d.insert("rev".into(), row.get("rev").cloned().unwrap_or(Value::Null));
            d.insert("note".into(), json!(s(row.get("備考"))?));
            d.insert("storage".into(), json!(if b["settings"].is_object() { "settings" } else { "master" }));
            d.insert("pattern".into(), json!(""));
        }
        let dflt: Map<String, Value>;
        if b["kind"] == "cm3" {
            let place = s(b["settings"]["place"].as_str().and_then(|k| dotted(settings, k)))?;
            d.insert("place".into(), json!(place));
            d.insert("table".into(), json!(""));
            dflt = json!({"equip_column": b["equipColumn"], "equip_mode": b["equipMode"]}).as_object().cloned().unwrap();
        } else if b["settings"].is_object() {
            let keys = &b["settings"];
            let get = |k: &str| keys[k].as_str().and_then(|k| dotted(settings, k));
            d.insert("place".into(), json!(unquote(&s(get("place"))?)));
            d.insert("table".into(), json!(s(get("table"))?));
            if full && keys.get("pattern").is_some_and(|p| truthy(Some(p))) {
                d.insert("pattern".into(), json!(s(get("pattern"))?));
            }
            dflt = json!({"equip_column": b["equipColumn"], "equip_mode": b["equipMode"]}).as_object().cloned().unwrap();
        } else {
            let mut m = t(&["sources", "wipDefault"]).as_object().cloned().unwrap_or_default();
            let src = dict_or_empty(settings.get("sources"))?;
            m.extend(dict_or_empty(src.get(bk))?);
            let place = {
                let p = s(row.get("場所"))?;
                if p.is_empty() {
                    s(m.get("source"))?
                } else {
                    p
                }
            };
            let table = {
                let p = s(row.get("表"))?;
                if p.is_empty() {
                    s(m.get("table"))?
                } else {
                    p
                }
            };
            d.insert("place".into(), json!(unquote(&place)));
            d.insert("table".into(), json!(table));
            if full {
                d.insert("placeDefault".into(), json!(unquote(&s(m.get("source"))?)));
            }
            dflt = m;
        }
        let has_row = !row.is_empty();
        let ec = if has_row { s(row.get("設備の列"))? } else { s(dflt.get("equip_column"))? };
        d.insert("equipColumn".into(), json!(ec));
        let mut em = if has_row { s(row.get("設備の取り出し方"))? } else { String::new() };
        if em.is_empty() {
            em = s(dflt.get("equip_mode"))?;
        }
        if em.is_empty() {
            em = "そのまま".into();
        }
        d.insert("equipMode".into(), json!(em));
        let name = s(row.get("表示名"))?;
        d.insert("name".into(), if name.is_empty() { b["name"].clone() } else { json!(name) });
        d.insert("read".into(), read_params(settings, bk, &row)?);
        d.insert("lotSet".into(), json!(s(row.get("ロット番号の列"))?));
        let joins = if b["kind"] == "cm3" && !has_row {
            joins_of(Some(&Value::Array(vec![t(&["sources", "scheduleJoin"]).clone()])))?
        } else {
            joins_of(row.get("結合"))?
        };
        d.insert("joins".into(), joins);
        d.insert("order".into(), json!(s(row.get("並び"))?));
        d.insert("id".into(), row.get("id").cloned().unwrap_or(Value::Null));
        if full {
            if b["kind"] == "cm3" && !has_row {
                d.insert("joinsDefault".into(), json!(true));
            }
            d.insert("listed".into(), json!(matches!(bk, "lot" | "work") || s(row.get("画面"))? != "無"));
            d.insert("rowRead".into(), row_read(&row)?);
            let groupable = t(&["sources", "groupable"]).as_array().is_some_and(|g| g.iter().any(|x| x.as_str() == Some(bk)));
            d.insert("groupSet".into(), json!(if groupable { s(row.get("グループ"))? } else { String::new() }));
        }
        out.push(d);
    }
    // 足した元は行の順（同じキーの行が 2 つあれば 2 つとも。Python の added は rows を回す）
    for r in rows {
        let r = r.as_object().ok_or(Py("データ元の行が表でない"))?;
        let k = &s(r.get("キー"))?;
        if k.is_empty() || builtins.iter().any(|b| b["key"].as_str() == Some(k)) {
            continue;
        }
        let name = s(r.get("表示名"))?;
        let mode = s(r.get("設備の取り出し方"))?;
        let role = s(r.get("役割"))?;
        let mut d = json!({"key": k, "name": if name.is_empty() { k.clone() } else { name }, "kind": "file",
                       "role": if role.is_empty() { "その他".to_string() } else { role },
                       "place": unquote(&s(r.get("場所"))?), "table": s(r.get("表"))?, "equipColumn": s(r.get("設備の列"))?,
                       "equipMode": if mode.is_empty() { "そのまま".to_string() } else { mode }, "builtin": false,
                       "api": format!("/api/src/{k}"), "id": r.get("id").cloned().unwrap_or(Value::Null),
                       "read": read_params(settings, k, r)?, "lotSet": s(r.get("ロット番号の列"))?, "joins": joins_of(r.get("結合"))?,
                       "order": s(r.get("並び"))?, "base": s(r.get("元"))?});
        if full {
            let o = d.as_object_mut().unwrap();
            o.insert("pattern".into(), json!(""));
            o.insert("screen".into(), json!(format!("src:{k}")));
            o.insert("listed".into(), json!(s(r.get("画面"))? != "無"));
            o.insert("storage".into(), json!("master"));
            o.insert("settings".into(), Value::Null);
            o.insert("rev".into(), r.get("rev").cloned().unwrap_or(Value::Null));
            o.insert("note".into(), json!(s(r.get("備考"))?));
            o.insert("rowRead".into(), row_read(r)?);
            o.insert("groupSet".into(), json!(s(r.get("グループ"))?));
        }
        out.push(d.as_object().cloned().unwrap());
    }
    let rest = out.split_off(2.min(out.len()));
    let mut keyed: Vec<Keyed> = vec![];
    for d in rest {
        let builtin = d["builtin"] == true;
        let order = d["order"].as_str().unwrap_or("").to_string();
        let a = if !order.is_empty() || !builtin {
            order_of(&order)
        } else if d.get("last") == Some(&json!(true)) {
            10_000_000
        } else {
            0
        };
        let id = if truthy(d.get("id")) { int_of(d.get("id"))? } else { 0 };
        keyed.push(((a, if builtin { 0 } else { 1 }, id), d));
    }
    keyed.sort_by_key(|x| x.0);
    out.extend(keyed.into_iter().map(|(_, d)| d));
    // 結合した表: 場所・表は元の物
    let snapshot = out.clone();
    for d in out.iter_mut() {
        let base = d.get("base").and_then(Value::as_str).unwrap_or("").to_string();
        if base.is_empty() {
            continue;
        }
        match snapshot.iter().rev().find(|x| x["key"].as_str() == Some(base.as_str())) {
            Some(b) if !b.get("base").and_then(Value::as_str).is_some_and(|x| !x.is_empty()) && b["kind"] == "file" => {
                d.insert("kind".into(), json!("view"));
                d.insert("place".into(), b["place"].clone());
                d.insert("table".into(), b["table"].clone());
                if full {
                    d.insert("baseName".into(), b["name"].clone());
                }
            }
            _ => {
                d.insert("kind".into(), json!("view"));
                d.insert("place".into(), json!(""));
                d.insert("table".into(), json!(""));
                d.insert("broken".into(), json!(true));
            }
        }
    }
    if full {
        groups_and_uses(&mut out);
    }
    Ok(out)
}

/// 行の「確かめる間隔」「古さの警告」の字（data_sources の rowRead）
fn row_read(row: &Map<String, Value>) -> R<Value> {
    let mut o = Map::new();
    for (_, col) in t(&["sources", "rowRead"]).as_object().into_iter().flatten() {
        let col = col.as_str().unwrap_or("");
        o.insert(col.into(), json!(s(row.get(col))?));
    }
    Ok(Value::Object(o))
}

/// グループ（見出しのタブのまとまり）・結合の要約（data_join.describe）・使っている元（usedBy）
fn groups_and_uses(out: &mut [Map<String, Value>]) {
    let tl = &t(&["sourcesList"]);
    let (no_group, master) = (tl["noGroup"].as_str().unwrap_or("-"), tl["masterRole"].as_str().unwrap_or("マスタ"));
    let mut names: Vec<(String, Value)> = vec![];
    for d in out.iter() {
        let k = d["key"].as_str().unwrap_or("").to_string();
        match names.iter_mut().find(|(n, _)| *n == k) {
            Some(slot) => slot.1 = d["name"].clone(),
            None => names.push((k, d["name"].clone())),
        }
    }
    let snapshot: Vec<Map<String, Value>> = out.to_vec();
    for (i, d) in out.iter_mut().enumerate() {
        let set = d["groupSet"].as_str().unwrap_or("").to_string();
        let group = if set == no_group {
            String::new()
        } else if !set.is_empty() {
            set
        } else if d["role"].as_str() == Some(master) && d["api"].as_str().is_some_and(|a| a.starts_with("/api/src/")) {
            master.to_string()
        } else {
            String::new()
        };
        d.insert("group".into(), json!(group));
        let text: Vec<String> = d["joins"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|j| {
                let w = j["with"].as_str().unwrap_or("");
                let name = names.iter().find(|(n, _)| n == w).map(|(_, v)| py_str(v)).unwrap_or_else(|| w.to_string());
                let how = tl["howLabels"][j["how"].as_str().unwrap_or("")].as_str().unwrap_or("");
                let on: Vec<String> = j["on"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|p| format!("{} = {}", p[0].as_str().unwrap_or(""), p[1].as_str().unwrap_or("")))
                    .collect();
                format!("{name} を{how}（{}）", on.join("・"))
            })
            .collect();
        d.insert("joinText".into(), json!(text.join("・")));
        let key = d["key"].clone();
        let used: Vec<Value> = snapshot
            .iter()
            .enumerate()
            .filter(|(j, x)| {
                *j != i && (x.get("base") == Some(&key) || x["joins"].as_array().into_iter().flatten().any(|jn| jn["with"] == key))
            })
            .map(|(_, x)| x["key"].clone())
            .collect();
        d.insert("usedBy".into(), Value::Array(used));
    }
}

// ------------------------------------------------------------------ 設備グループ（services/equip_groups.py の view・ordered）
pub(crate) fn group_rules(row: &Map<String, Value>) -> R<(Value, Value)> {
    let text = if truthy(row.get("ルール")) { row.get("ルール").cloned().unwrap() } else { json!("{}") };
    let d: Value = match &text {
        Value::String(x) => {
            if crate::master_rows::text_split(x) {
                return Err(Py("設備グループのルールが窓の読めない JSON"));
            }
            serde_json::from_str(x).unwrap_or(json!({}))
        }
        _ => json!({}), // json.loads(数・表) は TypeError → {}
    };
    let d = if d.is_object() { d } else { json!({}) };
    let ops = t(&["equipGroups", "ruleOps"]).as_array().cloned().unwrap_or_default();
    let max = t(&["equipGroups", "maxRules"]).as_u64().unwrap_or(12) as usize;
    let mut rules: Vec<Value> = vec![];
    if let Some(Value::Array(a)) = d.get("rules") {
        for r in a.iter().take(max) {
            let Some(o) = r.as_object() else { continue };
            if matches!(o.get("op"), Some(Value::Array(_) | Value::Object(_))) {
                return Err(Py("設備グループのルールの op が並び・表（Python は in で落ちる）"));
            }
            let Some(op) = o.get("op").filter(|op| ops.contains(op)) else { continue };
            if op == "regex" {
                return Err(Py("設備グループの正規表現（Python の re で確かめる）"));
            }
            let raw = if truthy(o.get("value")) { s(o.get("value"))? } else { String::new() };
            let val: String = pyfmt::strip(&raw).chars().take(80).collect();
            if val.is_empty() {
                continue;
            }
            let x = json!({"op": op, "value": val});
            if !rules.contains(&x) {
                rules.push(x);
            }
        }
    }
    let ex = if rules.is_empty() { vec![] } else { eq_list(d.get("except"))? };
    Ok((json!(rules), json!(ex)))
}

/// 設備の並び（shifts.equipment_list）。並びの中の並び・表は Python の repr の字になるので組まない
fn eq_list(v: Option<&Value>) -> R<Vec<String>> {
    if let Some(Value::Array(a)) = v {
        if a.iter().any(|x| x.is_array() || x.is_object()) {
            return Err(Py("設備の並びの中に並び・表"));
        }
    }
    if matches!(v, Some(Value::Object(o)) if !o.is_empty()) {
        return Err(Py("設備の並びが表"));
    }
    Ok(equipment_list(v))
}

fn order_i64(n: i128) -> R<i64> {
    i64::try_from(n).map_err(|_| Py("表示順が i64 に入らない（JSON で同じに渡せない）"))
}

fn group_order(row: &Map<String, Value>) -> i128 {
    if !truthy(row.get("表示順")) {
        return 0;
    }
    wide_int(&row["表示順"]).unwrap_or(0)
}

pub(crate) fn group_views(rows: &[Value]) -> R<Vec<Value>> {
    let mut keyed = vec![];
    for r in rows {
        let o = r.as_object().ok_or(Py("設備グループの行が表でない"))?;
        let id = if truthy(o.get("id")) { int_of(o.get("id"))? } else { 0 };
        keyed.push(((group_order(o), id), o));
    }
    keyed.sort_by_key(|x| x.0);
    let set_default = t(&["equipGroups", "setDefault"]).clone();
    let mut out = vec![];
    for (_, o) in keyed {
        let (rules, ex) = group_rules(o)?;
        let pick = |k: &str, d: Value| o.get(k).filter(|v| truthy(Some(v))).cloned().unwrap_or(d);
        out.push(json!({"id": o.get("id").cloned().unwrap_or(Value::Null), "name": pick("名称", json!("")), "set": pick("まとめ方", set_default.clone()),
                        "equipment": eq_list(o.get("設備"))?, "rules": rules, "except": ex, "order": order_i64(group_order(o))?,
                        "note": pick("備考", json!("")), "rev": o.get("rev").cloned().unwrap_or(json!(1)),
                        "updated_at": o.get("updated_at").cloned().unwrap_or(json!("")), "updated_by": pick("updated_by", json!({}))}));
    }
    Ok(out)
}

// ------------------------------------------------------------------ 変換表（services/conversions.py の tables）
/// conversions._j: 並び・表はそのまま、空でない字は JSON として読み、型が既定と違えば既定
fn conv_j(v: Option<&Value>, list: bool) -> R<Value> {
    let dflt = if list { json!([]) } else { json!({}) };
    let x = match v {
        Some(x @ (Value::Array(_) | Value::Object(_))) => return Ok(x.clone()),
        Some(Value::String(t)) if !pyfmt::strip(t).is_empty() => {
            if crate::master_rows::text_split(t) {
                return Err(Py("変換表の字が窓の読めない JSON"));
            }
            match serde_json::from_str::<Value>(t) {
                Ok(x) => x,
                Err(_) => return Ok(dflt),
            }
        }
        _ => return Ok(dflt),
    };
    Ok(if x.is_array() == list && (x.is_array() || x.is_object()) { x } else { dflt })
}

fn conv_order(o: &Map<String, Value>) -> i128 {
    match o.get("表示順") {
        None | Some(Value::Null) => 0,
        Some(x) => wide_int(x).unwrap_or(0),
    }
}

/// conversions.ordered の順（表示順 → id。同じなら元の順）の行の位置（版 3.93.0 から変換表の道〈src/conversions_write.rs〉も使う）
pub fn conv_order_index(rows: &[Value]) -> R<Vec<usize>> {
    let mut keyed = vec![];
    for (i, r) in rows.iter().enumerate() {
        let o = r.as_object().ok_or(Py("変換表の行が表でない"))?;
        let id = if truthy(o.get("id")) { int_of(o.get("id"))? } else { 0 };
        keyed.push(((conv_order(o), id), i));
    }
    keyed.sort_by_key(|x| x.0);
    Ok(keyed.into_iter().map(|(_, i)| i).collect())
}

/// 変換表の行（conversions.view の表示順を除いた形）を ordered（表示順 → id）の順に
fn conv_rows(rows: &[Value]) -> R<Vec<(i128, Value)>> {
    let mut out = vec![];
    for i in conv_order_index(rows)? {
        let o = rows[i].as_object().ok_or(Py("変換表の行が表でない"))?;
        let order = conv_order(o);
        let rows = match conv_j(o.get("判定"), true)? {
            Value::Array(a) => a
                .into_iter()
                .filter_map(|x| x.as_object().cloned())
                .map(|x| json!({"when": x.get("when").filter(|w| w.is_object()).cloned().unwrap_or(json!({})), "out": x.get("out").cloned().unwrap_or(json!(""))}))
                .collect(),
            _ => vec![],
        };
        let other = match o.get("その他") {
            x if !truthy(x) => String::new(),
            Some(Value::Array(_) | Value::Object(_)) => return Err(Py("変換表のその他が表・並び")),
            Some(x) => py_str(x),
            None => String::new(),
        };
        out.push((
            order,
            json!({"id": o.get("id").cloned().unwrap_or(Value::Null), "name": pstr(o.get("名前"))?, "inputs": conv_j(o.get("入力"), true)?,
                                "rows": rows, "other": other, "apply": conv_j(o.get("当て方"), false)?}),
        ));
    }
    Ok(out)
}

/// 変換表の画面の形（conversions.view。表示順も）を ordered の順に。表示順が JSON の数（i64）に入らなければ Err（画面は Python が描く）
pub fn conv_views(rows: &[Value]) -> R<Vec<Value>> {
    conv_rows(rows)?
        .into_iter()
        .map(|(order, mut v)| {
            v["order"] = json!(i64::try_from(order).map_err(|_| Py("変換表の表示順が大きすぎる"))?);
            Ok(v)
        })
        .collect()
}

/// 式の conv が引く形（conversions.tables: 名前ごとに最初の表）
fn conv_tables(rows: &[Value]) -> R<Value> {
    let mut out = Map::new();
    for (_, v) in conv_rows(rows)? {
        let name = v["name"].as_str().unwrap_or("").to_string();
        if name.is_empty() || out.contains_key(&name) {
            continue;
        }
        out.insert(name, json!({"inputs": v["inputs"], "rows": v["rows"], "other": v["other"]}));
    }
    Ok(Value::Object(out))
}

// ------------------------------------------------------------------ LotDsp の API の学び（services/lotdsp_api.py の KeyMap と status）
/// KeyMap.key が真の値を返すか（窓は値を使わず、真か偽かだけを見る。Python が落ちる形は Err）
fn km_key(data: &Map<String, Value>, name: &str, col: &str) -> R<bool> {
    let sec = match data.get(name) {
        x if !truthy(x) => return Ok(false),
        Some(Value::Object(o)) => o,
        _ => return Err(Py("学びの段が表でない")),
    };
    let cols = match sec.get("cols") {
        None => return Ok(false),
        Some(Value::Object(o)) => o,
        _ => return Err(Py("学びの列が表でない")),
    };
    let c = match cols.get(col) {
        x if !truthy(x) => return Ok(false),
        Some(Value::Object(o)) => o,
        _ => return Err(Py("学びの列の形が違う")),
    };
    let cands = match c.get("cands") {
        x if !truthy(x) => return Ok(false),
        Some(Value::Array(a)) => a,
        _ => return Err(Py("候補が並びでない")),
    };
    let seen = match c.get("seen") {
        None => 0.0,
        Some(Value::Number(n)) => n.as_f64().ok_or(Py("数"))?,
        Some(Value::Bool(b)) => *b as i64 as f64,
        _ => return Err(Py("seen が数でない")),
    };
    let tie = t(&["lotdsp", "tieSeen"]).as_f64().unwrap_or(3.0);
    let min = t(&["lotdsp", "minSeen"]).as_f64().unwrap_or(2.0);
    Ok(if cands.len() > 1 {
        name == "lot" && seen >= tie && truthy(cands.first())
    } else {
        (truthy(c.get("trusted")) || seen >= min) && truthy(cands.first())
    })
}

/// lotdsp_api.status(KeyMap(作業場所の lotdsp_api_map.json), settings)。学びのファイルは尋ねるたびに読む（Python が裏で書く）
pub fn lotdsp_status(path: &Path, enabled: bool) -> R<Value> {
    let data = match std::fs::read_to_string(path) {
        Err(_) => Map::new(),
        Ok(text) => {
            if crate::master_rows::text_split(&text) {
                return Err(Py("学びのファイルが窓の読めない JSON"));
            }
            match serde_json::from_str::<Value>(&text) {
                Ok(Value::Object(o)) => o,
                _ => Map::new(),
            }
        }
    };
    let req = t(&["lotdsp", "required"]).as_object().cloned().unwrap_or_default();
    let mut missing = vec![];
    for (name, cols) in &req {
        let sec = match data.get(name) {
            x if !truthy(x) => Map::new(),
            Some(Value::Object(o)) => o.clone(),
            _ => return Err(Py("学びの段が表でない")),
        };
        if name != "lot" && !truthy(sec.get("list")) {
            missing.push(format!("{name}.（並び）"));
            continue;
        }
        for c in cols.as_array().into_iter().flatten().filter_map(Value::as_str) {
            if !km_key(&data, name, c)? {
                missing.push(format!("{name}.{c}"));
            }
        }
    }
    let density_seen = match data.get("lot") {
        Some(Value::Object(l)) => match l.get("cols") {
            Some(Value::Object(cols)) => match cols.get("density") {
                x if !truthy(x) => false,
                Some(Value::Object(d)) => truthy(d.get("seen")),
                _ => return Err(Py("比重の学びの形が違う")),
            },
            None => false,
            _ => return Err(Py("学びの列が表でない")),
        },
        x if !truthy(x) => false,
        _ => return Err(Py("学びの段が表でない")),
    };
    if density_seen && !km_key(&data, "lot", "density")? {
        missing.push("lot.density".into());
    }
    // (data.get(s) or {}).get("cols", {}) を回す: 段が真で表でない・cols が有って表でない（null も）と Python は落ちる
    let mut learned = 0;
    for name in ["actual", "design", "lot"] {
        let sec = match data.get(name) {
            x if !truthy(x) => continue,
            Some(Value::Object(o)) => o,
            _ => return Err(Py("学びの段が表でない")),
        };
        let cols = match sec.get("cols") {
            None => continue,
            Some(Value::Object(o)) => o,
            _ => return Err(Py("学びの列が表でない")),
        };
        for c in cols.keys() {
            learned += km_key(&data, name, c)? as i64;
        }
    }
    Ok(json!({"enabled": enabled, "ready": !data.is_empty() && missing.is_empty(), "missing": missing,
              "login_free": data.get("login_free").cloned().unwrap_or(Value::Null),
              "last_error": data.get("last_error").cloned().unwrap_or(Value::Null),
              "probe": if truthy(data.get("probe")) { data["probe"].clone() } else { json!({}) }, "learned": learned}))
}

// ------------------------------------------------------------------ 束を組む
/// 束に使うマスタ（MasterStore の写しの名前）
const MASTERS: [&str; 7] =
    ["path_settings", "data_sources", "work_log_files", "equipment_master", "equipment_groups", "conversions", "shift_patterns"];

/// work_log.ordered を、選んだ行（ダッシュボードの表示する設備など）に。並びが字にできなければ None
pub fn work_order(rows: Vec<&Value>) -> Option<Vec<&Value>> {
    let mut keyed = vec![];
    for (i, r) in rows.into_iter().enumerate() {
        let n = wide_int_str(&pstr(r.get("並び")).ok()?);
        keyed.push(((n.is_none(), n.unwrap_or(0), i), r));
    }
    keyed.sort_by_key(|x| x.0);
    Some(keyed.into_iter().map(|(_, r)| r).collect())
}

/// work_log.ordered: 並びの番号 → 番号の無い行は登録の順で後ろに
fn work_ordered(rows: &[Value]) -> R<Vec<&Value>> {
    let mut keyed = vec![];
    for (i, r) in rows.iter().enumerate() {
        let raw = pstr(r.get("並び"))?;
        let n = wide_int_str(&raw);
        keyed.push(((n.is_none(), n.unwrap_or(0), i), r));
    }
    keyed.sort_by_key(|x| x.0);
    Ok(keyed.into_iter().map(|(_, r)| r).collect())
}

fn name_of(r: &Value, k: &str) -> R<String> {
    match r.get(k) {
        x if !truthy(x) => Ok(String::new()),
        Some(Value::Array(_) | Value::Object(_)) => Err(Py("名前が表・並び")),
        Some(x) => Ok(py_str(x)),
        None => Ok(String::new()),
    }
}

/// 束・画面・/api/config の材料（Builder::inputs）
pub struct Inputs {
    /// 配った設定（APP_SETTINGS）
    pub settings: Value,
    /// 参照先マスタを重ねた設定（effective_settings。束に出る項目だけ）
    pub eff: Value,
    pub who: Value,
    /// マスタの置き場（束の access.place）
    pub place: Value,
    p: Place,
}

impl Inputs {
    /// 窓が Python と同じに読めないマスタ（読めない字・共有にまだ無い）は組まない
    pub fn check(&self, name: &str) -> R<()> {
        if self.p.split_file(name) {
            return Err(Py("マスタのファイルが窓の読めない字"));
        }
        if self.p.share_absent(name) {
            return Err(Py("共有にまだ無いマスタ（Python が写しから最初の版を作る）"));
        }
        Ok(())
    }

    /// マスタの行（MasterRepository の読み方: 前の名前の列を今の名前へ・版の無い行は 1）。行が表でなければ Err
    pub fn rows(&self, name: &str) -> R<Vec<Value>> {
        let mut rows = self.p.rows(name).map_err(|_| Py("マスタが読めない"))?;
        if !rows.iter().all(Value::is_object) {
            return Err(Py("マスタの行が表でない（Python の _normalize が落ちる）"));
        }
        let renamed = t(&["renamed", name]).as_object().cloned().unwrap_or_default();
        for r in rows.iter_mut() {
            let Some(o) = r.as_object_mut() else { continue };
            for (old, new) in &renamed {
                if let Some(v) = o.remove(old) {
                    let new = new.as_str().unwrap_or("").to_string();
                    o.entry(new).or_insert(v);
                }
            }
            o.entry("rev").or_insert(json!(1));
        }
        Ok(rows)
    }

    /// マスタの版の番号（MasterStore.revision。読めなければ Err）
    pub fn revision(&self, name: &str) -> R<i64> {
        self.p.revision(name).map_err(|_| Py("マスタの版が読めない"))
    }

    /// 参照先の項目ごとの答え（GET /api/settings の items。path_settings.effective の items。版 3.89.0）。Python と同じに組めなければ Err
    pub fn settings_items(&self) -> R<Vec<Value>> {
        self.check("path_settings")?;
        effective_items(&self.settings, &self.rows("path_settings")?)
    }

    /// 更新の置き場（GET /api/update/settings の source。版 3.95.0）: `str((effective_settings(app).get("update") or {}).get("source") or "")`。
    /// 参照先が読めない（行が表でない・ファイルが読めない）ときは配った設定で動く（effective_settings と同じ）。Python が落ちる形
    /// （値を重ねる段・update の段が表でない）・窓が同じ字にできない値（並び・表・大きな整数）・窓の読めない参照先は Err（Python に任せる）
    pub fn update_source(&self) -> R<String> {
        self.check("path_settings")?;
        let rows = self.rows("path_settings").unwrap_or_default();
        let v = update_source_of(&self.settings, &rows)?;
        match &v {
            x if !truthy(Some(x)) => Ok(String::new()),
            Value::String(x) => Ok(x.clone()),
            Value::Number(n) if n.as_i64().is_some() || n.is_f64() => Ok(py_str(&v)),
            Value::Bool(_) => Ok(py_str(&v)),
            _ => Err(Py("更新の置き場が字・数でない（Python は repr の字）")),
        }
    }
}

/// effective_settings の update.source（path_settings.effective を全部の項目で通した後の値）。Python の effective は、どの項目も
/// 読めた値を配った設定の段へ重ねる（_set）ので、値のある項目の段が表でなければ落ちる。ブラウザの欄（Python が trusted_browser で
/// 確かめる）は値になるか分からないが、段が表なら落ちず update.source にも効かない
fn update_source_of(settings: &Value, rows: &[Value]) -> R<Value> {
    use crate::settings_write::{parse_value, Bad};
    let mut by: Vec<(String, &Value)> = vec![];
    for r in rows {
        let k = pstr(r.get("項目"))?;
        match by.iter_mut().find(|(n, _)| *n == k) {
            Some(slot) => slot.1 = r, // dict の内包表記と同じく後ろの行が勝つ
            None => by.push((k, r)),
        }
    }
    let mut master = None;
    for it in t(&["settingsItems"]).as_array().into_iter().flatten() {
        let key = it["key"].as_str().unwrap_or("");
        let Some((_, row)) = by.iter().find(|(n, _)| n == key) else { continue };
        let value = match parse_value(it, row.get("値")) {
            Ok(v) => v,
            Err(Bad::Invalid(_)) => None,
            Err(Bad::Python) if key != "update.source" && sections_ok(settings, key) => None,
            Err(Bad::Python) => return Err(Py("値を重ねる段が表でない項目の値を Python が読む")),
        };
        if value.is_some() && !sections_ok(settings, key) {
            return Err(Py("値を重ねる配った設定の段が表でない（Python の _set が落ちる）"));
        }
        if key == "update.source" {
            master = value;
        }
    }
    if let Some(v) = master {
        return Ok(v);
    }
    match settings.get("update") {
        x if !truthy(x) => Ok(Value::Null),
        Some(Value::Object(o)) => Ok(o.get("source").cloned().unwrap_or(Value::Null)),
        _ => Err(Py("update の段が表でない（Python は .get で落ちる）")),
    }
}

/// GET /api/sources のうち、マスタと設定から決まる部分（版 3.87.0。写しの様子・行の数・結合の数・スケジュールのカードは src/sources_list.rs）
pub struct SourcesParts {
    /// データ元の並び（data_sources.sources の全部の鍵）に conn・placeChanged・shellLists・equipCount を足した物
    pub items: Vec<Map<String, Value>>,
    pub others: Vec<Value>,
    pub new_conn: Value,
    /// スケジュールの設備の数（schedule.config の equipments。カードを Python に尋ねられないとき）
    pub schedule_equips: usize,
}

/// 参照先の値を配った設定に重ねられるか（path_settings._set: 途中の段が無ければ作り、表なら下りる。表でない段〈字・null・並び〉は Python が落ちる）
pub fn sections_ok(settings: &Value, key: &str) -> bool {
    let parts: Vec<&str> = key.split('.').collect();
    let mut cur = settings;
    for p in &parts[..parts.len() - 1] {
        match cur.get(p) {
            None => return true,
            Some(v) if v.is_object() => cur = v,
            Some(_) => return false,
        }
    }
    true
}

/// path_settings.effective の items（項目ごとの答え: 既定・マスタの値・効いている値・版）
fn effective_items(settings: &Value, rows: &[Value]) -> R<Vec<Value>> {
    let mut by: Vec<(String, &Value)> = vec![];
    for r in rows {
        let k = pstr(r.get("項目"))?;
        match by.iter_mut().find(|(n, _)| *n == k) {
            Some(slot) => slot.1 = r,
            None => by.push((k, r)),
        }
    }
    let mut out = vec![];
    for it in t(&["settingsItems"]).as_array().into_iter().flatten() {
        let key = it["key"].as_str().unwrap_or("");
        let default = dotted(settings, key).cloned().unwrap_or(Value::Null);
        let row = by.iter().find(|(n, _)| n == key).map(|(_, r)| *r);
        let value = match row {
            Some(r) => parse_item(it, r.get("値"))?,
            None => None,
        };
        let mut o = it.as_object().cloned().unwrap_or_default();
        let has = value.is_some();
        if has && !sections_ok(settings, key) {
            return Err(Py("値を重ねる配った設定の段が表でない（Python の _set が落ちる）"));
        }
        o.insert("default".into(), default.clone());
        o.insert("value".into(), value.clone().unwrap_or(Value::Null));
        o.insert("effective".into(), value.unwrap_or(default));
        o.insert("source".into(), json!(if has { "master" } else { "default" }));
        for k in ["id", "rev", "updated_at", "updated_by"] {
            o.insert(k.into(), row.and_then(|r| r.get(k)).cloned().unwrap_or(Value::Null));
        }
        out.push(Value::Object(o));
    }
    Ok(out)
}

/// data_sources.conn_bind（項目 → 置き場。並びは答えの順）
fn conn_bind(item: &Map<String, Value>) -> Vec<(String, String)> {
    let tl = &t(&["sourcesList"]);
    let pairs = |v: &Value| -> Vec<(String, String)> {
        v.as_array()
            .into_iter()
            .flatten()
            .map(|p| (p[0].as_str().unwrap_or("").to_string(), p[1].as_str().unwrap_or("").to_string()))
            .collect()
    };
    if item.get("kind").and_then(Value::as_str) == Some("view") || truthy(item.get("base")) {
        return vec![("lot".into(), "row:ロット番号の列".into())];
    }
    let key = item.get("key").and_then(Value::as_str).unwrap_or("");
    let bound = &tl["connBind"][key];
    if bound.is_array() {
        pairs(bound)
    } else if item.get("kind").and_then(Value::as_str) == Some("file") {
        pairs(&tl["connFile"])
    } else {
        vec![]
    }
}

/// data_sources.conn_of（接続の設定の欄の並び）
fn conn_of(item: &Map<String, Value>, row: Option<&Map<String, Value>>, items: &[Value], defaults: &Map<String, Value>) -> R<Value> {
    let specs = &t(&["sourcesList", "connSpecs"]);
    let mut out = vec![];
    for (field, place) in conn_bind(item) {
        let mut o = Map::new();
        o.insert("id".into(), json!(field));
        o.extend(specs[field.as_str()].as_object().cloned().unwrap_or_default());
        if let Some(col) = place.strip_prefix("row:") {
            let v = s(row.and_then(|r| r.get(col)))?;
            let dflt = defaults.get(&field).cloned().unwrap_or(json!(""));
            let eff = if v.is_empty() { dflt.clone() } else { json!(v) };
            let rev = row.and_then(|r| r.get("rev")).filter(|x| truthy(Some(x))).cloned().unwrap_or(json!(0));
            o.extend([
                ("bind".into(), json!("row")),
                ("item".into(), json!(col)),
                ("value".into(), json!(v)),
                ("default".into(), dflt),
                ("effective".into(), eff),
                ("rev".into(), rev),
            ]);
        } else {
            let it =
                items.iter().find(|i| i["key"].as_str() == Some(place.as_str())).and_then(Value::as_object).cloned().unwrap_or_default();
            if !it.is_empty() {
                for k in ["kind", "min", "max", "hint", "check_url"] {
                    if let Some(v) = it.get(k) {
                        o.insert(k.into(), v.clone());
                    }
                }
            }
            let blank = |k: &str| it.get(k).filter(|x| !x.is_null()).cloned().unwrap_or(json!(""));
            let rev = it.get("rev").filter(|x| truthy(Some(x))).cloned().unwrap_or(json!(0));
            o.extend([
                ("bind".into(), json!("settings")),
                ("item".into(), json!(place)),
                ("value".into(), blank("value")),
                ("default".into(), blank("default")),
                ("effective".into(), it.get("effective").cloned().unwrap_or(Value::Null)),
                ("rev".into(), rev),
            ]);
        }
        out.push(Value::Object(o));
    }
    Ok(Value::Array(out))
}

/// schedule.config の設備の数（「、」「,」「，」・空白で区切り、「:」の前が設備。同じ設備は 1 つ）
fn schedule_equips(eff: &Value) -> R<usize> {
    let raw = dict_or_empty(eff.get("schedule"))?;
    if truthy(raw.get("hot")) && !raw.get("hot").is_some_and(Value::is_object) {
        return Err(Py("schedule.hot が表でない（Python は落ちる）"));
    }
    let v = match raw.get("equipments") {
        Some(v) if present(Some(v)) => v.clone(),
        _ => t(&["sourcesList", "schedule", "equipments"]).clone(),
    };
    let text = match &v {
        Value::Array(a) => {
            let mut parts = vec![];
            for x in a {
                if x.is_array() || x.is_object() {
                    return Err(Py("設備の並びに表・並び"));
                }
                parts.push(py_str(x));
            }
            parts.join(",")
        }
        Value::Object(_) => return Err(Py("設備が表")),
        x if !truthy(Some(x)) => String::new(),
        x => py_str(x),
    };
    let mut codes: Vec<String> = vec![];
    for w in text.split(|c: char| matches!(c, ',' | '、' | '，') || pyfmt::is_space(c)).filter(|w| !w.is_empty()) {
        let code = w.split(':').next().unwrap_or("").to_string();
        if !code.is_empty() && !codes.contains(&code) {
            codes.push(code);
        }
    }
    Ok(codes.len())
}

impl Inputs {
    /// GET /api/sources のマスタと設定から決まる部分（routes/sources.py の sources_list）。Python と同じに組めなければ Err
    pub fn sources_parts(&self) -> R<SourcesParts> {
        for name in ["path_settings", "data_sources", "work_log_files"] {
            self.check(name)?;
        }
        let ps_rows = self.rows("path_settings")?;
        let ds_rows = self.rows("data_sources")?;
        let wl_rows = self.rows("work_log_files")?;
        let mut changed: Vec<String> = vec![];
        for r in &ps_rows {
            if !pyfmt::strip(&pstr(r.get("値"))?).is_empty() {
                changed.push(pstr(r.get("項目"))?);
            }
        }
        let mut shown = 0;
        for r in &wl_rows {
            let v = if truthy(r.get("表示")) { pstr(r.get("表示"))? } else { "有".into() };
            if v != "無" {
                shown += 1;
            }
        }
        let items_ps = effective_items(&self.settings, &ps_rows)?;
        let engine_rust = match self.settings.get("desktop") {
            Some(Value::Object(o)) => o.get("lotlist_engine").map(|v| v == "rust").unwrap_or(true),
            x if !truthy(x) => true,
            _ => return Err(Py("desktop が表でない")),
        };
        let mut items = sources_full(&self.eff, &ds_rows)?;
        for x in items.iter_mut() {
            let key = x["key"].as_str().unwrap_or("").to_string();
            let mut row = None;
            for r in &ds_rows {
                if pstr(r.get("キー"))? == key {
                    row = r.as_object();
                    break;
                }
            }
            let dr = read_params(&self.eff, &key, &Map::new())?;
            let mut defaults = Map::new();
            defaults.insert("place".into(), x.get("placeDefault").cloned().unwrap_or(json!("")));
            defaults.insert("refresh".into(), dr["refresh_seconds"].clone());
            defaults.insert("stale".into(), dr["stale_hours"].clone());
            let conn = conn_of(x, row, &items_ps, &defaults)?;
            x.insert("conn".into(), conn);
            if key == "lot" {
                x.insert("placeChanged".into(), json!(changed.iter().any(|c| c == "lot_list.source" || c == "lot_list.table")));
                x.insert("shellLists".into(), json!(engine_rust));
            }
            if x.get("kind").and_then(Value::as_str) == Some("folder") {
                x.insert("equipCount".into(), json!(shown));
            }
        }
        let others: Vec<Value> = items_ps.iter().filter(|i| !truthy(i.get("page"))).cloned().collect();
        let dr = read_params(&self.eff, "+", &Map::new())?;
        let mut defaults = Map::new();
        defaults.insert("refresh".into(), dr["refresh_seconds"].clone());
        defaults.insert("stale".into(), dr["stale_hours"].clone());
        let plus = json!({"key": "+", "kind": "file"});
        let new_conn = conn_of(plus.as_object().unwrap(), None, &items_ps, &defaults)?;
        Ok(SourcesParts { items, others, new_conn, schedule_equips: schedule_equips(&self.eff)? })
    }
}

impl Builder {
    /// 名乗り（identity.current と terminal_key）。PC 名は設定の「この端末の名前」があればそれ
    pub fn who(settings: &Value) -> R<Value> {
        let over = match settings.get("identity") {
            Some(Value::Object(o)) => match o.get("pc_name") {
                x if !truthy(x) => String::new(),
                Some(x) => s(Some(x))?,
                None => String::new(),
            },
            x if !truthy(x) => String::new(),
            _ => return Err(Py("identity が表でない")),
        };
        let login = login_id();
        let (pc, source) = pc_name(&over);
        Ok(json!({"login": login, "pc": pc, "pcSource": source, "key": terminal_key(&login, &pc)}))
    }

    /// 作業場所（この PC の ui_state.json・lotdsp_api_map.json の置き場）とプログラムの置き場
    pub fn env(&self) -> &Env {
        &self.env
    }

    /// GET /api/config（routes/system.py の config）。Python が落ちる形・窓が同じに読めない形は Err（Python に任せる）
    pub fn config(&self) -> R<Value> {
        let inp = self.inputs()?;
        inp.check("path_settings")?;
        let eff = effective(&inp.settings, &inp.rows("path_settings").unwrap_or_default(), &["pathItems", "configItems"])?;
        let li = match eff.get("lotdsp_import") {
            x if !truthy(x) => Map::new(),
            Some(Value::Object(o)) => o.clone(),
            _ => return Err(Py("lotdsp_import が表でない")),
        };
        let sub = |k: &str| -> R<Map<String, Value>> {
            match li.get(k) {
                x if !truthy(x) => Ok(Map::new()),
                Some(Value::Object(o)) => Ok(o.clone()),
                _ => Err(Py("lotdsp_import の段が表でない")),
            }
        };
        let (a, d) = (sub("api")?, sub("direct")?);
        let url = if truthy(li.get("url")) { s(li.get("url"))? } else { String::new() };
        let flag = |m: &Map<String, Value>, k: &str| m.get(k).map(|v| truthy(Some(v))).unwrap_or(true);
        // lotdsp_api.settings_of・lotdsp_direct.settings_of が読む値（float・並び）を Python と同じに読めるか（読めなければ Python は落ちる）
        let num = |m: &Map<String, Value>, k: &str| -> R<()> { m.get(k).map(|v| py_float(Some(v)).map(|_| ())).unwrap_or(Ok(())) };
        num(&a, "timeout_seconds")?;
        if truthy(a.get("request_fields")) && !a.get("request_fields").is_some_and(Value::is_object) {
            return Err(Py("request_fields が表でない"));
        }
        for k in [
            "timeout_seconds",
            "reach_timeout_seconds",
            "start_timeout_seconds",
            "keep_seconds",
            "login_wait_seconds",
            "window_keep_seconds",
        ] {
            num(&d, k)?;
        }
        if truthy(d.get("extra_args")) && !d.get("extra_args").is_some_and(|v| v.is_array() || v.is_object() || v.is_string()) {
            return Err(Py("extra_args が並びでない"));
        }
        for k in ["search_url", "entity_path", "candidates_path", "detail_path"] {
            if a.get(k).is_some_and(|v| v.is_array() || v.is_object()) {
                return Err(Py("LotDsp の道の字が表・並び"));
            }
        }
        let api_on = flag(&a, "enabled") && (!url.is_empty() || truthy(a.get("search_url")));
        let direct_on = flag(&d, "enabled") && !url.is_empty();
        let section = |k: &str| -> R<Map<String, Value>> {
            match eff.get(k) {
                None => Ok(Map::new()),
                Some(Value::Object(o)) => Ok(o.clone()),
                _ => Err(Py("設定の段が表でない")),
            }
        };
        let (beat, ui) = (section("presence")?, section("ui_defaults")?);
        let max_rows = match ui.get("max_rows") {
            None => 25,
            Some(v) => i64::try_from(wide_int(v).ok_or(Py("max_rows が int() で読めない"))?).map_err(|_| Py("max_rows が大きすぎる"))?,
        };
        let interval = match beat.get("heartbeat_interval_seconds") {
            None => 3.0,
            Some(v) => py_float(Some(v))?,
        };
        let km = crate::bundle::lotdsp_status(&self.env.local.join("lotdsp_api_map.json"), api_on)?;
        let brand = read_json(&self.env.program.join("app").join("brand.json")).ok_or(Py("brand.json が読めない"))?;
        Ok(json!({"lotdsp_url": li.get("url").cloned().unwrap_or(json!("")), "lotdsp_direct": direct_on,
                  "lotdsp_login_window": direct_on && flag(&d, "login_window"), "lotdsp_api": km,
                  "default_unwind": t(&["defaultUnwind"]), "defaults": eff.get("ui_defaults").cloned().unwrap_or(json!({})),
                  "max_rows": max_rows, "heartbeat_interval_seconds": interval,
                  "app": {"name": brand["name"], "subtitle": brand["subtitle"]}}))
    }

    /// 束（Python の GET /api/lotlist/settings と同じ形）。組めなければ Err（窓は Python に尋ねる）
    pub fn build(&self) -> R<Value> {
        let r = self.build_inner();
        *self.last_skip.lock().unwrap() = r.as_ref().err().map(|e| e.0);
        r
    }

    /// 配った設定のファイル（app_env.config_path を問い合わせのたびに: TRANSFER_APP_CONFIG か config/appsettings.json。無ければ見本。
    /// 基の置き場は create_app の BASE_DIR〈中身を解いた道〉）。GET /api/settings の config_file（版 3.89.0）
    pub fn config_file(&self) -> String {
        let base = resolved(&self.env.program);
        // str(Path(字)) は字のまま（相対の道も）。有るかは Python の今のフォルダ＝中身のフォルダ（sidecar.rs の current_dir）から見る
        let (text, at) = match std::env::var_os("TRANSFER_APP_CONFIG") {
            Some(v) => (PathBuf::from(&v), base.join(&v)),
            None => {
                let p = base.join("config").join("appsettings.json");
                (p.clone(), p)
            }
        };
        let p = if at.exists() { text } else { base.join("config").join("appsettings.example.json") };
        py_path(&p.to_string_lossy())
    }

    /// LotDsp の道の材料（版 3.98.0。src/lotdsp.rs）: (配った lotdsp_import, 参照先を重ねた lotdsp_import, 設備マスタの行)。
    /// 読めなければ Err の字（「設定の束」「参照先」「設備マスタ」。道は 503 kind settings で断る。Python の routes/lots._inputs と同じ順・同じ字。
    /// 作った後の採点の割れ 4: 前は黙って空の設備マスタ・配った設定に戻り、誤った理由で断った）
    pub fn lotdsp_inputs(&self) -> Result<(Value, Value, Vec<Value>), &'static str> {
        let inp = self.inputs().map_err(|_| "設定の束")?;
        if inp.p.split_file("path_settings") {
            return Err("参照先");
        }
        let rows = inp.rows("path_settings").map_err(|_| "参照先")?;
        if inp.p.split_file("equipment_master") {
            return Err("設備マスタ");
        }
        let equipment = inp.rows("equipment_master").map_err(|_| "設備マスタ")?;
        let eff = effective(&inp.settings, &rows, &["pathItems", "configItems"]).map_err(|_| "参照先")?;
        let app = inp.settings.get("lotdsp_import").cloned().unwrap_or(Value::Null);
        let eff_li = eff.get("lotdsp_import").cloned().unwrap_or(Value::Null);
        Ok((app, eff_li, equipment))
    }

    /// 束・画面・/api/config が使う材料（配った設定・参照先を重ねた設定・名乗り・マスタの置き場）。組めなければ Err（Python に尋ねる）
    pub fn inputs(&self) -> R<Inputs> {
        let text = std::fs::read_to_string(&self.env.config).map_err(|_| Py("配った設定が読めない"))?;
        // 引っ越しの印をたどる係は窓の 1 つ（Python は窓が名乗るとたどらない）なので、束を組めない設定（NaN など）でも、
        // Python と同じに読める置き場の段（master_share）と名乗りから先にたどる
        let loose = lenient_json(&text).filter(Value::is_object);
        let mut st = None;
        if let Some(l) = &loose {
            if let (Ok(who), Ok(store)) = (Self::who(l), self.store(l)) {
                let mut store = store;
                if let Some(moved) = self.follow_moved(&store, &who) {
                    store.share = Some(moved);
                }
                st = Some(store);
            }
        }
        if crate::master_rows::text_split(&text) {
            return Err(Py("配った設定が窓の読めない JSON"));
        }
        let settings: Value = serde_json::from_str(&text).map_err(|_| Py("配った設定が JSON でない"))?;
        if !settings.is_object() {
            return Err(Py("配った設定が表でない"));
        }
        let who = Self::who(&settings)?;
        let st = st.ok_or(Py("置き場の段が読めない"))?;
        let base = py_path(&self.env.base.to_string_lossy());
        // 同梱の最初の中身は master_store.DEFAULTS_DIR（Path(__file__).resolve() から決まる。道を解いた形）
        let program = py_path(&resolved(&self.env.program).to_string_lossy());
        let local = py_path(&self.env.local.to_string_lossy());
        let cache = join(&local, "master_cache");
        let presence = match &st.share {
            Some(sh) => join(sh, t(&["store", "presenceSubdir"]).as_str().unwrap_or("presence_tpa")),
            None => join(&local, "presence"),
        };
        let place = json!({"shareDir": st.share.clone().unwrap_or_default(), "shared": st.shared, "data": join(&base, "data"),
                           "defaults": join(&join(&program, "app"), "master_defaults"), "cache": cache, "presence": presence,
                           "lockTtl": st.lock_ttl});
        let p = Place::from_json(&place);
        let mut inp = Inputs { settings, eff: Value::Null, who, place, p };
        // 参照先が読めなくても配った設定で動く（effective_settings と同じ）
        inp.eff = effective(&inp.settings, &inp.rows("path_settings").unwrap_or_default(), &["pathItems"])?;
        Ok(inp)
    }

    fn build_inner(&self) -> R<Value> {
        let inp = self.inputs()?;
        for name in MASTERS {
            inp.check(name)?;
        }
        let (settings, eff, who, place) = (&inp.settings, &inp.eff, inp.who.clone(), inp.place.clone());
        let rows = |name: &str| inp.rows(name);
        let ll = dict_or_empty(eff.get("lot_list"))?;
        let get = |k: &str, d: Value| ll.get(k).cloned().unwrap_or(d);
        let wl_rows = rows("work_log_files")?;
        if !wl_rows.iter().all(Value::is_object) {
            return Err(Py("作業実績の登録の行が表でない"));
        }
        // 作業実績の決まり（work_log.params）
        let mut wl = t(&["workDefaults"]).as_object().cloned().unwrap_or_default();
        for (k, v) in dict_or_empty(eff.get("work_log"))? {
            if present(Some(&v)) {
                wl.insert(k, v);
            }
        }
        let folder = match wl.get("folder") {
            x if !truthy(x) => String::new(),
            x => unquote(&s(x)?),
        };
        wl.insert("folder".into(), json!(folder));
        let work = json!({"folder": wl["folder"], "pattern": wl["pattern"], "table": wl["table"], "refresh_seconds": wl["refresh_seconds"],
                          "stale_hours": wl["stale_hours"], "page_size": wl["page_size"],
                          "rows": wl_rows.iter().map(|r| Value::Object(["キー", "設備名", "ファイル名", "ファイルID", "表示", "表", "並び"].iter()
                              .map(|k| (k.to_string(), r.get(*k).cloned().unwrap_or(Value::Null))).collect())).collect::<Vec<_>>(),
                          "canEditShifts": null});
        // 設備の名前（作業実績の設備 → 設備マスタ）
        let eq_rows = rows("equipment_master")?;
        let mut names: Vec<String> = vec![];
        for r in work_ordered(&wl_rows)?.into_iter().chain(eq_rows.iter()) {
            let n = name_of(r, "設備名")?;
            if !pyfmt::strip(&n).is_empty() && !names.contains(&n) {
                names.push(n);
            }
        }
        let groups = group_views(&rows("equipment_groups")?)?;
        let srcs = sources(eff, &rows("data_sources")?)?;
        let tables = conv_tables(&rows("conversions")?)?;
        let conv_rev = format!("rs:{}", &sha1_hex(tables.to_string().as_bytes())[..16]);
        let shifts = rows("shift_patterns")?;
        let lists = json!({"hidden": null,
                           "dash": {"equipNames": names, "equipGroups": groups, "now": self.env.now},
                           "sources": srcs, "work": work, "shifts": shifts});
        let engine = match settings.get("desktop") {
            Some(Value::Object(o)) => o.get("lotlist_engine").cloned().unwrap_or(json!("rust")),
            x if !truthy(x) => json!("rust"),
            _ => return Err(Py("desktop が表でない")),
        };
        Ok(json!({"source": get("source", json!("")), "refresh_seconds": get("refresh_seconds", json!(60)),
                  "stale_hours": get("stale_hours", json!(36)), "table": get("table", json!("")), "page_size": get("page_size", json!(500)),
                  "engine": engine, "conversions": {"rev": conv_rev, "tables": tables}, "lists": lists,
                  "access": {"who": who, "place": place},
                  "calculation": settings.get("calculation").cloned().unwrap_or(json!({})),
                  "uiProfileKeys": t(&["uiProfileKeys"])}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha1_matches_known_digests() {
        assert_eq!(sha1_hex(b""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(sha1_hex(b"abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(sha1_hex("PC 1@山田".as_bytes()).len(), 40);
        let long = vec![b'a'; 1000];
        assert_eq!(sha1_hex(&long), "291e9a6c66994949b57ba5e650361e98fc36b1ba");
    }

    #[test]
    fn terminal_keys_are_like_python() {
        assert_eq!(terminal_key("yamada", "PC01"), "PC01@yamada");
        // 名乗れないときの「?」もファイル名に使えない字なので「_」にして sha1 を足す（Python の presence.terminal_key の答え）
        assert_eq!(terminal_key("", ""), "_@_-06d90d");
        assert_eq!(terminal_key("a b", "C:1"), "C_1@a_b-b5ea73");
    }

    #[test]
    fn paths_are_like_pathlib() {
        if cfg!(windows) {
            assert_eq!(py_path("C:/a//b/"), "C:\\a\\b");
            assert_eq!(py_path("\\\\srv\\share\\x\\"), "\\\\srv\\share\\x");
        } else {
            assert_eq!(py_path("/a//b/./c/"), "/a/b/c");
            assert_eq!(py_path("//a/b"), "//a/b");
            assert_eq!(py_path("///a"), "/a");
            assert_eq!(py_path(""), ".");
        }
    }
}
