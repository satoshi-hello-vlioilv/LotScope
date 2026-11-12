//! フォルダ・ファイルの欄の補助（版 3.101.0。Python の services/folder_browse.py と routes/settings.py の POST /api/fs/browse・
//! GET /api/fs/places）を窓が答える。読むだけで、何も書かない。
//!
//! - POST /api/fs/browse … そのフォルダの中（フォルダ・その欄で選べるファイル・目的ごとの印）と区切り（パンくず）。
//!   無いときは届いた所まで上がってその中を出す。1 回の答えは TIMEOUT（4 秒）まで（届かない共有で待たせ続けない）
//! - GET /api/fs/places … よく使う場所（このアプリが使っている場所と、この PC の場所。届くかはまとめて PLACE_TIMEOUT〈2 秒〉まで）
//!
//! 門番は Python の _browse_gate と同じ（参照先〈管理のマスタ〉を書ける PC だけ）。利用者の決め（版 3.100.0）は Python と同じ定数:
//! NATURAL_SORT（エクスプローラーと同じ自然な並び）・WORKLOG_MARK（作業実績の印の頭）・HIDE_ATTRS（Windows の隠し・システムの属性は出さない）。
//! 道の字は Python の字の上の整え（tidy: ntpath・posixpath の normpath。記号リンクは解かない）と、Path の anchor・parts（crumbs）と同じ。
//! 窓が Python と同じ字にできない形（~ユーザー名・file: の URL の [ ]・ASCII でないサーバー名・\\?\ の道・欄の値が並び・表）は
//! 答えず Python に任せる。突き合わせ: desktop/tests/fs_parity.rs ← program/tests/fs_oracle.py、事例の表 place_cases.json の
//! sort・clean・marks・hidden（desktop/tests/place_cases.rs）。

use crate::release_place::{ignorable, join_for, normcase};
use crate::worksum::py_str;
use serde_json::{json, Value};
use std::io;
use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const LIMIT: usize = 400;
pub const MARK_LIMIT: usize = 120;
pub const TIMEOUT: f64 = 4.0;
pub const PLACE_TIMEOUT: f64 = 2.0;
pub const NATURAL_SORT: bool = true;
pub const WORKLOG_MARK: &str = "ファイルのある設備";
pub const HIDE_ATTRS: bool = true;
const RELEASE_MARKER: &str = crate::release_place::MARKER;

/// 欄の目的 → (選ぶ物, 選べるファイルの拡張子)
fn purpose_of(p: &str) -> Option<(&'static str, &'static [&'static str])> {
    Some(match p {
        "master" | "release" | "worklog" | "folder" => ("folder", &[]),
        "sqlite" => ("file", &[".sqlite3", ".sqlite", ".db"]),
        "exe" => ("file", &[".exe"]),
        _ => return None,
    })
}

// ------------------------------------------------------------------ 並び

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Part {
    /// 数字の続き（値で比べる: 先頭の 0 を除いた桁の数・字）
    Num(usize, String),
    Text(String),
}

/// 「参照…」の並び（Python の sort_key。数字〈0〜9〉の続きは数として・大文字小文字を見ず・同じ所では数字が先）
pub fn sort_key(name: &str) -> (Vec<Part>, String, String) {
    let low = name.to_lowercase();
    if !NATURAL_SORT {
        return (vec![], low, String::new());
    }
    let mut parts = vec![];
    let mut cur = String::new();
    let mut digits = false;
    let flush = |cur: &mut String, digits: bool, parts: &mut Vec<Part>| {
        if cur.is_empty() {
            return;
        }
        if digits {
            let v = cur.trim_start_matches('0').to_string();
            parts.push(Part::Num(v.len(), v));
        } else {
            parts.push(Part::Text(cur.to_lowercase()));
        }
        cur.clear();
    };
    for c in name.chars() {
        let d = c.is_ascii_digit();
        if d != digits {
            flush(&mut cur, digits, &mut parts);
            digits = d;
        }
        cur.push(c);
    }
    flush(&mut cur, digits, &mut parts);
    (parts, low, name.to_string())
}

/// 並べた答え（事例の表 sort）
pub fn sorted(names: &[String]) -> Vec<String> {
    let mut v = names.to_vec();
    v.sort_by_cached_key(|n| sort_key(n));
    v
}

// ------------------------------------------------------------------ 字の整え（clean・tidy・crumbs）

/// posixpath.normpath（Python 3.13）
fn posix_normpath(s: &str) -> String {
    if s.is_empty() {
        return ".".into();
    }
    let initial = if s.starts_with("//") && !s.starts_with("///") {
        "//"
    } else if s.starts_with('/') {
        "/"
    } else {
        ""
    };
    let mut comps: Vec<&str> = vec![];
    for c in s.split('/') {
        if c.is_empty() || c == "." {
            continue;
        }
        if c != ".." || (initial.is_empty() && comps.is_empty()) || comps.last() == Some(&"..") {
            comps.push(c);
        } else if !comps.is_empty() {
            comps.pop();
        }
    }
    let out = format!("{initial}{}", comps.join("/"));
    if out.is_empty() {
        ".".into()
    } else {
        out
    }
}

/// ntpath.splitroot（Python 3.13）→ (ドライブ, 根, 残り)。/ は \ に読む
fn nt_splitroot(p: &str) -> (String, String, String) {
    let p = p.replace('/', "\\");
    let cs: Vec<char> = p.chars().collect();
    let s = |a: usize, b: usize| cs[a.min(cs.len())..b.min(cs.len())].iter().collect::<String>();
    if cs.first() == Some(&'\\') {
        if cs.get(1) == Some(&'\\') {
            // UNC（\\server\share）・装置（\\?\…）
            let upper: String = s(0, 8).to_uppercase();
            let start = if upper == "\\\\?\\UNC\\" { 8 } else { 2 };
            let index = cs[start..].iter().position(|&c| c == '\\').map(|i| i + start);
            let Some(index) = index else { return (p.clone(), String::new(), String::new()) };
            let index2 = cs[index + 1..].iter().position(|&c| c == '\\').map(|i| i + index + 1);
            let Some(index2) = index2 else { return (p.clone(), String::new(), String::new()) };
            return (s(0, index2), s(index2, index2 + 1), s(index2 + 1, cs.len()));
        }
        return (String::new(), s(0, 1), s(1, cs.len()));
    }
    if cs.get(1) == Some(&':') {
        if cs.get(2) == Some(&'\\') {
            return (s(0, 2), s(2, 3), s(3, cs.len()));
        }
        return (s(0, 2), String::new(), s(2, cs.len()));
    }
    (String::new(), String::new(), p)
}

/// ntpath.normpath（Python 3.13。装置の道 \\?\・\\.\ は呼ぶ側が Python に任せる）
fn nt_normpath(s: &str) -> String {
    let (drive, root, rest) = nt_splitroot(s);
    let mut comps: Vec<&str> = vec![];
    for c in rest.split('\\') {
        if c.is_empty() || c == "." {
            continue;
        }
        if c == ".." {
            if comps.last().is_some_and(|l| *l != "..") {
                comps.pop();
            } else if root.is_empty() {
                comps.push(c);
            }
        } else {
            comps.push(c);
        }
    }
    let prefix = format!("{drive}{root}");
    if prefix.is_empty() && comps.is_empty() {
        return ".".into();
    }
    format!("{prefix}{}", comps.join("\\"))
}

/// 装置の道（\\?\・\\.\。ntpath.normpath が別に扱う）
fn device_path(s: &str) -> bool {
    let t = s.replace('/', "\\");
    t.starts_with("\\\\?\\") || t.starts_with("\\\\.\\")
}

/// Python の tidy（字の上で整えた道。win はその PC が Windows か）。None は窓が Python と同じ字にできない形
pub fn tidy_for(s: &str, win: bool) -> Option<String> {
    if s.is_empty() {
        return Some(String::new());
    }
    let cs: Vec<char> = s.chars().collect();
    let unc = s.starts_with("\\\\") || (win && s.starts_with("//"));
    if unc || (cs.len() >= 2 && cs[1] == ':' && cs[0].is_ascii_alphabetic()) {
        if device_path(s) {
            return None;
        }
        let out = nt_normpath(&crate::master_place::drive_root(s));
        let oc: Vec<char> = out.chars().collect();
        if oc.len() == 3 && oc[1] == ':' {
            return Some(out);
        }
        let t = out.trim_end_matches('\\');
        return Some(if t.is_empty() { out.clone() } else { t.to_string() });
    }
    if win && device_path(s) {
        return None;
    }
    let out = if win { nt_normpath(s) } else { posix_normpath(s) };
    let t = out.trim_end_matches(['\\', '/']);
    Some(if t.is_empty() { out.chars().take(1).collect() } else { t.to_string() })
}

/// urllib.parse.unquote（UTF-8・置き換え）
fn percent_decode(s: &str) -> String {
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
        let ch = s[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    if !run.is_empty() {
        out.push_str(&String::from_utf8_lossy(&run));
    }
    out
}

/// file: の URL → 道（Python の clean の urlparse の所）。None は窓が同じに読めない形
fn from_file_url(s: &str) -> Option<String> {
    // urlsplit: タブ・改行は取り除く。scheme は「file」（呼ぶ側が見た）
    let u: String = s.chars().filter(|c| !matches!(c, '\t' | '\r' | '\n')).collect();
    let i = u.find(':')?;
    let mut rest = &u[i + 1..];
    let mut netloc = "";
    if let Some(r) = rest.strip_prefix("//") {
        let end = r.find(['/', '?', '#']).unwrap_or(r.len());
        netloc = &r[..end];
        rest = &r[end..];
        if netloc.contains(['[', ']']) || !netloc.is_ascii() {
            return None; // IPv6 の [ ]・NFKC の確かめ（Python は ValueError もある）
        }
    }
    let rest = rest.split('#').next().unwrap_or("");
    let path = rest.split('?').next().unwrap_or("");
    let body = percent_decode(path);
    let bc: Vec<char> = body.chars().collect();
    Some(if !netloc.is_empty() && netloc.to_lowercase() != "localhost" {
        format!("\\\\{netloc}{}", body.replace('/', "\\"))
    } else if bc.len() > 2 && bc[0] == '/' && bc[2] == ':' {
        bc[1..].iter().collect::<String>().replace('/', "\\")
    } else {
        body
    })
}

/// os.path.expanduser（~ と ~/… だけ。~ユーザー名は None＝Python に任せる）
fn expanduser(s: &str) -> Option<String> {
    if !s.starts_with('~') {
        return Some(s.to_string());
    }
    let seps: &[char] = if cfg!(windows) { &['/', '\\'] } else { &['/'] };
    let i = s[1..].find(seps).map(|i| i + 1).unwrap_or(s.len());
    if i != 1 {
        return None;
    }
    let home = if cfg!(windows) {
        match std::env::var("USERPROFILE") {
            Ok(h) => h,
            Err(_) => match std::env::var("HOMEPATH") {
                Ok(hp) => format!("{}{hp}", std::env::var("HOMEDRIVE").unwrap_or_default()),
                Err(_) => return Some(s.to_string()),
            },
        }
    } else {
        let h = std::env::var("HOME").ok()?;
        let t = h.trim_end_matches('/').to_string();
        let out = format!("{t}{}", &s[i..]);
        return Some(if out.is_empty() { "/".into() } else { out });
    };
    Some(format!("{home}{}", &s[i..]))
}

/// 欄の字 → 道（Python の clean）。None は窓が同じ字にできない形
pub fn clean(text: &str) -> Option<String> {
    let s = crate::lists::unquote_path(text);
    let s = crate::pyfmt::strip(&s).trim_matches('\'').to_string();
    let s = if s.to_lowercase().starts_with("file:") { from_file_url(&s)? } else { s };
    let s = if s.is_empty() { s } else { crate::bundle::expandvars(&expanduser(&s)?) };
    tidy_for(&s, cfg!(windows))
}

/// 区切り（パンくず）→ [{name, path}]（Python の crumbs。共有は \\サーバー\共有 を 1 つ目）
pub fn crumbs_for(path: &str, win: bool) -> Vec<Value> {
    if path.is_empty() {
        return vec![];
    }
    if let Some(r) = path.strip_prefix("\\\\") {
        let parts: Vec<&str> = r.split('\\').filter(|x| !x.is_empty()).collect();
        if parts.len() < 2 {
            return vec![json!({"name": path, "path": path})];
        }
        let head = format!("\\\\{}\\{}", parts[0], parts[1]);
        let mut out = vec![json!({"name": head, "path": head})];
        let mut cur = head.clone();
        for x in &parts[2..] {
            cur = format!("{cur}\\{x}");
            out.push(json!({"name": x, "path": cur}));
        }
        return out;
    }
    // Path(path) の anchor と parts（POSIX: 先頭がちょうど // は「//」。Windows: ドライブ＋根）
    let (anchor, sep, rest): (String, char, String) = if win {
        let (d, r, rest) = nt_splitroot(path);
        (format!("{d}{r}"), '\\', rest)
    } else {
        let a = if path.starts_with("//") && !path.starts_with("///") {
            "//"
        } else if path.starts_with('/') {
            "/"
        } else {
            ""
        };
        (a.to_string(), '/', path.trim_start_matches('/').to_string())
    };
    let seps: &[char] = if win { &['\\', '/'] } else { &['/'] };
    let parts: Vec<&str> = rest.split(seps).filter(|x| !x.is_empty() && *x != ".").collect();
    let mut out = vec![];
    if !anchor.is_empty() {
        let t = anchor.trim_end_matches(['\\', '/']);
        out.push(json!({"name": if t.is_empty() { anchor.clone() } else { t.to_string() }, "path": anchor}));
    }
    let mut cur = anchor.clone();
    for x in parts {
        // Path(cur) / x: 根の後・ドライブだけ（C: は C:x）・POSIX の // はそのままつなぐ
        let drive_only = win && cur.chars().count() == 2 && cur.ends_with(':');
        cur =
            if cur.is_empty() || cur.ends_with(sep) || cur == "//" || drive_only { format!("{cur}{x}") } else { format!("{cur}{sep}{x}") };
        out.push(json!({"name": x, "path": cur}));
    }
    out
}

fn crumbs(path: &str) -> Vec<Value> {
    crumbs_for(path, cfg!(windows))
}

fn parent(path: &str) -> String {
    let c = crumbs(path);
    if c.len() > 1 {
        c[c.len() - 2]["path"].as_str().unwrap_or("").to_string()
    } else {
        String::new()
    }
}

/// ファイルの道 → それを入れたフォルダ（字の上で。Python の parent_of）
pub fn parent_of(text: &str) -> Option<String> {
    Some(parent(&clean(text)?))
}

// ------------------------------------------------------------------ 中を見る

/// datetime.fromtimestamp(st_mtime).isoformat(timespec="minutes")
fn mtime_text(m: &std::fs::Metadata) -> String {
    let Ok(t) = m.modified() else { return String::new() };
    let secs = match t.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_secs_f64(),
        Err(e) => -e.duration().as_secs_f64(),
    };
    // fromtimestamp: 小数の秒をマイクロ秒へ丸める（偶数へ）
    let (whole, frac) = (secs.trunc(), secs - secs.trunc());
    let mut us = (frac * 1e6).round_ties_even() as i64;
    let mut s = whole as i64;
    if us >= 1_000_000 {
        s += 1;
        us -= 1_000_000;
    } else if us < 0 {
        s -= 1;
        us += 1_000_000;
    }
    chrono::DateTime::from_timestamp(s, (us * 1000) as u32)
        .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%dT%H:%M").to_string())
        .unwrap_or_default()
}

/// 出さない物（名前が「.」「~$」で始まる・ごみ箱と System Volume Information・Windows の隠し・システムの属性）
pub fn hidden(e: &std::fs::DirEntry) -> bool {
    let name = e.file_name().to_string_lossy().into_owned();
    if name.starts_with('.') || name.starts_with("~$") || name == "$RECYCLE.BIN" || name == "System Volume Information" {
        return true;
    }
    #[cfg(windows)]
    if HIDE_ATTRS {
        use std::os::windows::fs::MetadataExt;
        // FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM（DirEntry の metadata は記号リンクをたどらない: follow_symlinks=False）
        return e.metadata().is_ok_and(|m| m.file_attributes() & (0x2 | 0x4) != 0);
    }
    false
}

/// DirEntry.is_dir()・is_file()（記号リンクは先をたどる。読めなければ偽）
fn entry_dir_file(e: &std::fs::DirEntry) -> (bool, bool) {
    match e.file_type() {
        Ok(t) if t.is_symlink() => match std::fs::metadata(e.path()) {
            Ok(m) => (m.is_dir(), m.is_file()),
            Err(_) => (false, false),
        },
        Ok(t) => (t.is_dir(), t.is_file()),
        Err(_) => (false, false),
    }
}

fn names_of(folder: &Path) -> io::Result<Vec<std::fs::DirEntry>> {
    let mut out = vec![];
    for e in std::fs::read_dir(folder)? {
        out.push(e?);
    }
    Ok(out)
}

/// 配布の置き場か: すぐ下のフォルダ（版）に目印（release.json）がある
fn has_versions(folder: &Path) -> io::Result<bool> {
    for e in names_of(folder)? {
        if entry_dir_file(&e).0 {
            match std::fs::metadata(e.path().join(RELEASE_MARKER)) {
                Ok(m) if m.is_file() => return Ok(true),
                Ok(_) => {}
                Err(x) if ignorable(&x) => {}
                Err(x) => return Err(x),
            }
        }
    }
    Ok(false)
}

/// 作業実績のフォルダの印の数（work_log.scan と同じ決まり）。決まりが読めなければ None
pub fn equipment_count(folder: &Path, pattern: &str) -> io::Result<Option<usize>> {
    let Ok((head, tail)) = crate::lists::split_pattern(pattern) else { return Ok(None) };
    let mut n = 0;
    for e in names_of(folder)? {
        let name = e.file_name().to_string_lossy().into_owned();
        if !crate::lists::is_side_file(&name) && crate::lists::equipment_of(&name, &head, &tail).is_some() && entry_dir_file(&e).1 {
            n += 1;
        }
    }
    Ok(Some(n))
}

/// [(拡張子, 数)]（数えた物だけ・exts の順。「参照…」に出さない物は数えない）
pub fn ext_counts(folder: &Path, exts: &[&str]) -> io::Result<Vec<(String, usize)>> {
    let mut got: Vec<(String, usize)> = exts.iter().map(|x| (x.to_string(), 0)).collect();
    for e in names_of(folder)? {
        if hidden(&e) || !entry_dir_file(&e).1 {
            continue;
        }
        let low = e.file_name().to_string_lossy().to_lowercase();
        if let Some(slot) = got.iter_mut().find(|(x, _)| low.ends_with(x.as_str())) {
            slot.1 += 1;
        }
    }
    Ok(got.into_iter().filter(|(_, n)| *n > 0).collect())
}

/// そのフォルダの印（目的ごと）→ {text, tone} か null
pub fn mark_dir(folder: &Path, purpose: &str, pattern: &str) -> Value {
    let r = (|| -> io::Result<Value> {
        match purpose {
            "master" => {
                return Ok(if crate::master_place::is_master_place(folder)? {
                    json!({"text": "マスタあり", "tone": "ok"})
                } else {
                    Value::Null
                })
            }
            "release" => return Ok(if has_versions(folder)? { json!({"text": "版の置き場", "tone": "ok"}) } else { Value::Null }),
            "worklog" => {
                let pat = if pattern.is_empty() { "*.sqlite3" } else { pattern };
                return Ok(match equipment_count(folder, pat)? {
                    Some(n) if n > 0 => json!({"text": format!("{WORKLOG_MARK} {n} 台"), "tone": "ok"}),
                    _ => Value::Null,
                });
            }
            _ => {}
        }
        let ext = purpose_of(purpose).map(|p| p.1).unwrap_or(&[]);
        if !ext.is_empty() {
            let text = ext_counts(folder, ext)?.iter().map(|(x, n)| format!("{x} が {n} 個")).collect::<Vec<_>>().join("・");
            return Ok(if text.is_empty() { Value::Null } else { json!({"text": text, "tone": "info"}) });
        }
        Ok(Value::Null)
    })();
    r.unwrap_or(Value::Null)
}

fn list(folder: &str, purpose: &str, pattern: &str) -> io::Result<Value> {
    let ext = purpose_of(purpose).unwrap_or(("folder", &[])).1;
    let fp = Path::new(folder);
    let (mut dirs, mut files, mut others) = (vec![], vec![], 0usize);
    for e in names_of(fp)? {
        if hidden(&e) {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let Ok(st) = std::fs::metadata(e.path()) else { continue };
        let is_dir = entry_dir_file(&e).0;
        let path = join_for(folder, &name, cfg!(windows));
        if is_dir {
            dirs.push((name, json!({"name": e.file_name().to_string_lossy(), "path": path, "dir": true, "mtime": mtime_text(&st)})));
        } else if !ext.is_empty() && ext.iter().any(|x| name.to_lowercase().ends_with(x)) {
            files.push((
                name,
                json!({"name": e.file_name().to_string_lossy(), "path": path, "dir": false, "mtime": mtime_text(&st), "size": st.len()}),
            ));
        } else {
            others += 1;
        }
    }
    dirs.sort_by_cached_key(|(n, _)| sort_key(n));
    files.sort_by_cached_key(|(n, _)| sort_key(n));
    let mut entries: Vec<Value> = vec![];
    for (i, (_, mut d)) in dirs.into_iter().enumerate() {
        if i < MARK_LIMIT {
            let m = mark_dir(Path::new(d["path"].as_str().unwrap_or("")), purpose, pattern);
            if !m.is_null() {
                d["mark"] = m;
            }
        }
        entries.push(d);
    }
    entries.extend(files.into_iter().map(|(_, f)| f));
    let more = entries.len().saturating_sub(LIMIT);
    entries.truncate(LIMIT);
    Ok(json!({"entries": entries, "more": more, "others": others, "mark": mark_dir(fp, purpose, pattern)}))
}

/// f を別の糸で動かし、seconds 秒で打ち切る（届かない共有の読みは OS の待ちが長い。糸は裏で終わるのを待つ）。None は時間切れ
fn bounded<T: Send + 'static>(seconds: f64, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(Duration::from_secs_f64(seconds)).ok()
}

/// Path.is_dir()・is_file()（「無い」でない誤りは例外）
fn kind_e(p: &str) -> io::Result<(bool, bool)> {
    match std::fs::metadata(p) {
        Ok(m) => Ok((m.is_dir(), m.is_file())),
        Err(e) if ignorable(&e) => Ok((false, false)),
        Err(e) => Err(e),
    }
}

/// POST /api/fs/browse の答え（Python の browse）。None は窓が同じ字にできない形
pub fn browse(text: &str, purpose: &str, pattern: &str, timeout: f64) -> Option<Value> {
    let purpose = if purpose_of(purpose).is_some() { purpose } else { "folder" };
    let asked = clean(text)?;
    let kind = purpose_of(purpose).map(|p| p.0).unwrap_or("folder");
    let mut out = json!({"asked": asked, "path": "", "exists": false, "file": "", "crumbs": [], "parent": "", "entries": [], "more": 0,
                         "others": 0, "mark": null, "problem": "", "kind": kind});
    if asked.is_empty() {
        return Some(out);
    }
    if !(asked.starts_with("\\\\") || Path::new(&asked).is_absolute()) {
        out["problem"] = json!("ドライブ（C:\\…）か共有（\\\\サーバー\\共有\\…）から書いてください。");
        return Some(out);
    }
    let a = asked.clone();
    let find = move || -> io::Result<(String, String)> {
        let mut cur = a;
        while !cur.is_empty() {
            let (d, f) = kind_e(&cur)?;
            if d {
                return Ok((cur, String::new()));
            }
            if f {
                let p = Path::new(&cur);
                let par = parent(&cur);
                let par = if par.is_empty() { p.parent().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default() } else { par };
                return Ok((par, p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
            }
            let nxt = parent(&cur);
            if nxt.is_empty() || nxt == cur {
                return Ok((String::new(), String::new()));
            }
            cur = nxt;
        }
        Ok((String::new(), String::new()))
    };
    let fail_time = format!("{} 秒で読めませんでした: {asked}（共有・BOX に届いているかを確かめてください）", timeout.round() as i64);
    let (here, file) = match bounded(timeout, find) {
        None => {
            out["problem"] = json!(fail_time);
            return Some(out);
        }
        Some(Err(e)) => {
            out["problem"] = json!(format!("読めません: {asked}（{}）", crate::builder::strerror(&e)));
            return Some(out);
        }
        Some(Ok(x)) => x,
    };
    if here.is_empty() {
        out["problem"] = json!(format!("届きません: {asked}（つながっているか・名前が合っているかを確かめてください）"));
        return Some(out);
    }
    let (h, p, pat) = (here.clone(), purpose.to_string(), pattern.to_string());
    // Python は 2 回目も timeout 秒を待つ（_bounded を 2 度呼ぶ）
    let listed = match bounded(timeout, move || list(&h, &p, &pat)) {
        None => {
            out["problem"] = json!(fail_time);
            return Some(out);
        }
        Some(Err(e)) => {
            out["problem"] = json!(format!("読めません: {asked}（{}）", crate::builder::strerror(&e)));
            return Some(out);
        }
        Some(Ok(v)) => v,
    };
    let exact = normcase(&here) == normcase(&asked) || !file.is_empty();
    for k in ["entries", "more", "others", "mark"] {
        out[k] = listed[k].clone();
    }
    out["path"] = json!(here);
    out["exists"] = json!(exact);
    out["file"] = json!(file);
    out["crumbs"] = json!(crumbs(&here));
    out["parent"] = json!(parent(&here));
    if !exact {
        let rest: String = asked.chars().skip(here.chars().count()).collect();
        let rest = rest.trim_start_matches(['\\', '/']);
        out["problem"] = json!(format!("「{}」が見つかりません。届いた所: {here}", if rest.is_empty() { asked.as_str() } else { rest }));
    }
    Some(out)
}

/// Path.home()
fn home() -> String {
    if cfg!(windows) {
        std::env::var("USERPROFILE")
            .ok()
            .or_else(|| std::env::var("HOMEPATH").ok().map(|hp| format!("{}{hp}", std::env::var("HOMEDRIVE").unwrap_or_default())))
            .unwrap_or_default()
    } else {
        std::env::var("HOME").unwrap_or_default()
    }
}

fn user_dirs() -> Vec<(String, String)> {
    let h = crate::release_place::py_path(&home());
    let j = |n: &str| join_for(&h, n, cfg!(windows));
    let mut out = vec![
        ("デスクトップ".to_string(), j("Desktop")),
        ("ドキュメント".to_string(), j("Documents")),
        ("BOX".to_string(), j("Box")),
        ("BOX".to_string(), crate::release_place::py_path("C:/boxdrive/Box")),
        ("ホーム".to_string(), h.clone()),
    ];
    if cfg!(windows) {
        for c in 'C'..='Z' {
            out.push((format!("{c}: ドライブ"), format!("{c}:\\")));
        }
    }
    out
}

/// GET /api/fs/places の答え（Python の places）。app_paths: [(鍵, 名前, 道〈「;」で区切って複数も〉)]。None は窓が同じ字にできない形
pub fn places(app_paths: &[(String, String, String)], timeout: f64) -> Option<Value> {
    let mut seen: Vec<String> = vec![];
    let mut rows: Vec<Value> = vec![];
    for (key, label, raw) in app_paths {
        for one in raw.split(';') {
            let p = clean(one)?;
            if p.is_empty() {
                continue;
            }
            let k = normcase(&p);
            if seen.contains(&k) {
                continue;
            }
            seen.push(k);
            rows.push(json!({"group": "app", "key": key, "label": label, "path": p, "reach": null}));
        }
    }
    for (label, p) in user_dirs() {
        let k = normcase(&p);
        if !seen.contains(&k) {
            seen.push(k);
            rows.push(json!({"group": "pc", "key": "pc", "label": label, "path": p, "reach": null}));
        }
    }
    let (tx, rx) = mpsc::channel();
    for (i, r) in rows.iter().enumerate() {
        let (tx, p) = (tx.clone(), r["path"].as_str().unwrap_or("").to_string());
        std::thread::spawn(move || {
            let reach = match kind_e(&p) {
                Ok((d, f)) => d || f,
                Err(_) => false,
            };
            let _ = tx.send((i, reach));
        });
    }
    drop(tx);
    let end = Instant::now() + Duration::from_secs_f64(timeout);
    let mut got = 0;
    while got < rows.len() {
        let left = end.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok((i, reach)) => {
                rows[i]["reach"] = json!(reach);
                got += 1;
            }
            Err(_) => break,
        }
    }
    Some(json!({"items": rows.into_iter().filter(|r| r["group"] == "app" || r["reach"] == json!(true)).collect::<Vec<_>>()}))
}

// ------------------------------------------------------------------ 道と門番

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Browse,
    Places,
}

pub fn route_of(method: &str, path: &str) -> Option<Route> {
    match (method, path) {
        ("POST", "/api/fs/browse") => Some(Route::Browse),
        ("GET", "/api/fs/places") => Some(Route::Places),
        _ => None,
    }
}

/// _browse_gate: 見てよいか（参照先〈管理のマスタ〉を書ける PC だけ）。断るなら (状態, 答え)
pub fn gate(me: &Result<Value, String>) -> Option<(u16, Value)> {
    let m = match me {
        Ok(m) => m,
        Err(e) => {
            return Some((503, json!({"error": format!("権限を読めないので、フォルダを見られません（{e}）。"), "kind": "unavailable"})))
        }
    };
    if crate::worksum::truthy(&m["revoked"]) {
        return Some((403, json!({"error": "この PC は一時的に切断されています。", "kind": "revoked"})));
    }
    let lv = py_str(&m["flags"]["masterEdit"]);
    if !crate::access::master_edit_can(&lv, "write", crate::access::master_scope("path_settings")) {
        return Some((
            403,
            json!({"error": format!("この PC のマスタ編集（{lv}）では、参照先を変えられないため、フォルダを見る補助は使えません。"), "kind": "forbidden"}),
        ));
    }
    None
}

/// 本文の path・purpose・pattern（Python: b.get("path", "")・str(b.get("purpose") or "folder")・str(b.get("pattern") or "")）
fn browse_args(body: &[u8]) -> Option<(String, String, String)> {
    let b = crate::master_rows::py_body(body)?;
    let text = |k: &str| -> Option<String> {
        match b.get(k) {
            None => Some(String::new()),
            Some(v) if !crate::worksum::truthy(v) => Some(String::new()),
            Some(Value::String(s)) => Some(s.clone()),
            Some(v @ Value::Bool(_)) => Some(py_str(v)),
            Some(v @ Value::Number(n)) if n.as_i64().is_some() || n.is_f64() => Some(py_str(v)),
            _ => None,
        }
    };
    let purpose = text("purpose")?;
    Some((text("path")?, if purpose.is_empty() { "folder".into() } else { purpose }, text("pattern")?))
}

/// 2 本の答え（?engine=python は Python）。app_paths は GET /api/fs/places のこのアプリの場所（呼ぶ側が設定から組む）
pub fn handle(
    route: Route,
    query: &str,
    body: &[u8],
    me: &dyn Fn() -> Result<Value, String>,
    app_paths: &dyn Fn() -> Option<Vec<(String, String, String)>>,
) -> Option<(u16, Value)> {
    if crate::lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
        return None;
    }
    if let Some(no) = gate(&me()) {
        return Some(no);
    }
    match route {
        Route::Browse => {
            let (path, purpose, pattern) = browse_args(body)?;
            browse(&path, &purpose, &pattern, TIMEOUT).map(|v| (200, v))
        }
        Route::Places => places(&app_paths()?, PLACE_TIMEOUT).map(|v| (200, v)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normpaths_like_python() {
        assert_eq!(posix_normpath("//tmp/x/../y"), "//tmp/y");
        assert_eq!(posix_normpath("///a/../.."), "/");
        assert_eq!(posix_normpath("a/../../b"), "../b");
        assert_eq!(nt_normpath("C:\\a\\..\\..\\b"), "C:\\b");
        assert_eq!(nt_normpath("C:a\\..\\..\\b"), "C:..\\b");
        assert_eq!(nt_normpath("\\\\srv\\share\\c\\..\\d"), "\\\\srv\\share\\d");
        assert_eq!(tidy_for("C:", true).unwrap(), "C:\\");
        assert_eq!(tidy_for("/", false).unwrap(), "/");
        assert_eq!(percent_decode("a%20b%E5%AD%97%zz%"), "a b字%zz%");
    }

    #[test]
    fn crumbs_have_anchor_and_parts() {
        let c = crumbs_for("//tmp/y", false);
        assert_eq!(c[0]["path"], "//");
        assert_eq!(c[1]["path"], "//tmp");
        assert_eq!(c[2]["path"], "//tmp/y");
        let c = crumbs_for("C:\\a\\b", true);
        assert_eq!((c[0]["name"].clone(), c[0]["path"].clone(), c[2]["path"].clone()), (json!("C:"), json!("C:\\"), json!("C:\\a\\b")));
    }
}
