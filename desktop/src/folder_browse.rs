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
//! 欄の字は道の門（path_gate.rs。版 3.114.0）が先に決める（~ユーザー名・file: の URL の [ ]・ASCII でないサーバー名・装置の道・NUL・
//! 長すぎる名前。前は答えず Python に任せた）。届くかを尋ねる糸は probe.rs の係の 1 つ（道の根ごとに 1 本）。突き合わせ: desktop/tests/fs_parity.rs ← program/tests/fs_oracle.py、事例の表 place_cases.json の
//! sort・clean・marks・hidden（desktop/tests/place_cases.rs）。

use crate::release_place::{ignorable, join_for, normcase};
use crate::worksum::py_str;
use serde_json::{json, Value};
use std::io;
use std::path::Path;
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

/// ntpath.normpath（Python 3.13。装置の道 \\?\・\\.\ は道の門が先に決める）
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

/// Python の tidy（字の上で整えた道。win はその PC が Windows か）。装置の道（\\?\・\\.\）は道の門（path_gate.rs）が先に
/// 書き直すか断るので、ここへは来ない
pub fn tidy_for(s: &str, win: bool) -> String {
    if s.is_empty() {
        return String::new();
    }
    let cs: Vec<char> = s.chars().collect();
    let unc = s.starts_with("\\\\") || (win && s.starts_with("//"));
    if unc || (cs.len() >= 2 && cs[1] == ':' && cs[0].is_ascii_alphabetic()) {
        let out = nt_normpath(&crate::master_place::drive_root(s));
        let oc: Vec<char> = out.chars().collect();
        if oc.len() == 3 && oc[1] == ':' {
            return out;
        }
        let t = out.trim_end_matches('\\');
        return if t.is_empty() { out.clone() } else { t.to_string() };
    }
    let out = if win { nt_normpath(s) } else { posix_normpath(s) };
    let t = out.trim_end_matches(['\\', '/']);
    if t.is_empty() {
        out.chars().take(1).collect()
    } else {
        t.to_string()
    }
}

/// 欄の字 → 道（Python の clean）。版 3.114.0 から道の門（path_gate.rs の Browse。事例の表 ospath_cases.json）: Err は断る理由
pub fn clean(text: &str) -> Result<String, String> {
    let cwd = std::env::current_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    crate::path_gate::gate(crate::path_gate::Kind::Browse, text, &crate::path_gate::Env::here(&cwd))
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

/// ファイルの道 → それを入れたフォルダ（字の上で。Python の parent_of）。道の門が断る字は空
pub fn parent_of(text: &str) -> String {
    clean(text).map(|c| parent(&c)).unwrap_or_default()
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

/// Path.is_dir()・is_file()（「無い」でない誤りは例外）
fn kind_e(p: &str) -> io::Result<(bool, bool)> {
    match std::fs::metadata(p) {
        Ok(m) => Ok((m.is_dir(), m.is_file())),
        Err(e) if ignorable(&e) => Ok((false, false)),
        Err(e) => Err(e),
    }
}

fn answer(asked: &str, purpose: &str) -> Value {
    let kind = purpose_of(purpose).map(|p| p.0).unwrap_or("folder");
    json!({"asked": asked, "path": "", "exists": false, "file": "", "crumbs": [], "parent": "", "entries": [], "more": 0,
           "others": 0, "mark": null, "problem": "", "kind": kind})
}

/// 道の門が断った欄の答え（asked は打った字を前後の空白と引用符を外した字・problem に理由。Python の folder_browse.refused と同じ）
pub fn refused(text: &str, purpose: &str, why: &str) -> Value {
    let purpose = if purpose_of(purpose).is_some() { purpose } else { "folder" };
    let asked = crate::pyfmt::strip(&crate::lists::unquote_path(text)).trim_matches('\'').to_string();
    let mut out = answer(&asked, purpose);
    out["problem"] = json!(why);
    out
}

/// POST /api/fs/browse の答え（Python の browse）
pub fn browse(text: &str, purpose: &str, pattern: &str, timeout: f64) -> Value {
    match clean(text) {
        Ok(asked) => browse_asked(&asked, purpose, pattern, timeout),
        Err(why) => refused(text, purpose, &why),
    }
}

/// 道の門を通った字（clean の答え）で browse。届くかを尋ねる糸は probe の係の 1 つ（道の根ごとに 1 本。版 3.114.0）
pub fn browse_asked(asked: &str, purpose: &str, pattern: &str, timeout: f64) -> Value {
    let purpose = if purpose_of(purpose).is_some() { purpose } else { "folder" };
    let mut out = answer(asked, purpose);
    if asked.is_empty() {
        return out;
    }
    if !(asked.starts_with("\\\\") || Path::new(asked).is_absolute()) {
        out["problem"] = json!("ドライブ（C:\\…）か共有（\\\\サーバー\\共有\\…）から書いてください。");
        return out;
    }
    let a = asked.to_string();
    let find = move || -> Result<(String, String), String> {
        let mut cur = a;
        while !cur.is_empty() {
            let (d, f) = kind_e(&cur).map_err(|e| crate::builder::strerror(&e))?;
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
    let key = crate::probe::root_key("browse", asked);
    let probes = &crate::probe::PROBES;
    let (here, file) = match probes.ask(&key, None, Duration::from_secs_f64(timeout), true, find) {
        None => {
            out["problem"] = json!(fail_time);
            return out;
        }
        Some(Err(e)) => {
            out["problem"] = json!(format!("読めません: {asked}（{e}）"));
            return out;
        }
        Some(Ok(x)) => x,
    };
    if here.is_empty() {
        out["problem"] = json!(format!("届きません: {asked}（つながっているか・名前が合っているかを確かめてください）"));
        return out;
    }
    let (h, p, pat) = (here.clone(), purpose.to_string(), pattern.to_string());
    // Python は 2 回目も timeout 秒を待つ（_bounded を 2 度呼ぶ）
    let listed = match probes
        .ask(&key, None, Duration::from_secs_f64(timeout), true, move || list(&h, &p, &pat).map_err(|e| crate::builder::strerror(&e)))
    {
        None => {
            out["problem"] = json!(fail_time);
            return out;
        }
        Some(Err(e)) => {
            out["problem"] = json!(format!("読めません: {asked}（{e}）"));
            return out;
        }
        Some(Ok(v)) => v,
    };
    let exact = normcase(&here) == normcase(asked) || !file.is_empty();
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
        out["problem"] = json!(format!("「{}」が見つかりません。届いた所: {here}", if rest.is_empty() { asked } else { rest }));
    }
    out
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

/// GET /api/fs/places の答え（Python の places）。app_paths: [(鍵, 名前, 道〈「;」で区切って複数も〉)]。道の門が断る字の場所は出さない。
/// 届くかは probe の係（道の根ごとに 1 本・まとめて timeout 秒まで。終わらなかった物は reach null。覚えは 2 秒）
pub fn places(app_paths: &[(String, String, String)], timeout: f64) -> Value {
    places_with(&crate::probe::PROBES, app_paths, timeout)
}

/// 試験だけ: その道で届くかを尋ねるのにかかる時間を足す（止まる共有の形。製品では None）
#[doc(hidden)]
pub static TEST_SLOW: std::sync::Mutex<Option<(String, u64)>> = std::sync::Mutex::new(None);

/// places（尋ねる係を渡す: 試験は上限の小さな係で、止まる行の後ろの行が答えるかを見る）
pub fn places_with(probes: &crate::probe::Probes, app_paths: &[(String, String, String)], timeout: f64) -> Value {
    let mut seen: Vec<String> = vec![];
    let mut rows: Vec<Value> = vec![];
    for (key, label, raw) in app_paths {
        for one in raw.split(';') {
            let Ok(p) = clean(one) else { continue };
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
    let tickets: Vec<_> = rows
        .iter()
        .map(|r| {
            let p = r["path"].as_str().unwrap_or("").to_string();
            let memo = format!("reach:{}", normcase(&p));
            let slow = TEST_SLOW.lock().unwrap_or_else(|e| e.into_inner()).clone().filter(|(x, _)| *x == p).map(|(_, ms)| ms);
            probes.start(&crate::probe::root_key("reach", &p), Some(&memo), move || {
                if let Some(ms) = slow {
                    std::thread::sleep(Duration::from_millis(ms));
                }
                match kind_e(&p) {
                    Ok((d, f)) => d || f,
                    Err(_) => false,
                }
            })
        })
        .collect();
    // まとめて待つ（版 3.114.0 の作った後の採点の割れ 1: 行の順に待つと、止まる行の後ろの行が締め切りの後に起こされて消えた）
    let end = Instant::now() + Duration::from_secs_f64(timeout);
    for (r, reach) in rows.iter_mut().zip(probes.wait_all(tickets, end)) {
        if let Some(reach) = reach {
            r["reach"] = json!(reach);
        }
    }
    json!({"items": rows.into_iter().filter(|r| r["group"] == "app" || r["reach"] == json!(true)).collect::<Vec<_>>()})
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
            // 道の欄は道の門（path_gate.rs。版 3.114.0）を通す。断る形は欄の知らせ（problem）に理由
            let cwd = std::env::current_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
            let mut v = std::collections::HashMap::from([("path".to_string(), path.clone())]);
            Some((
                200,
                match crate::path_gate::apply("POST", "/api/fs/browse", &mut v, &crate::path_gate::Env::here(&cwd)) {
                    Ok(()) => browse_asked(&v["path"], &purpose, &pattern, TIMEOUT),
                    Err(why) => refused(&path, &purpose, &why),
                },
            ))
        }
        Route::Places => Some((200, places(&app_paths()?, PLACE_TIMEOUT))),
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
        assert_eq!(tidy_for("C:", true), "C:\\");
        assert_eq!(tidy_for("/", false), "/");
        assert_eq!(crate::path_gate::percent_decode("a%20b%E5%AD%97%zz%"), "a b字%zz%");
    }

    /// 版 3.114.0 の作った後の採点の割れ 1: よく使う場所の 1 行目（共有）が止まり、上限で待った後ろの共有の行も、締め切りの中で答える
    /// （前は行の順に待ち、後ろの行が締め切りの後に起こされて reach null になり、この PC の場所は一覧から消えた）
    #[test]
    fn places_rows_behind_a_stuck_share_still_answer() {
        let probes = crate::probe::Probes::new(2);
        let stuck = "\\\\stuck-srv\\share".to_string();
        *TEST_SLOW.lock().unwrap() = Some((stuck.clone(), 4000));
        let mut paths = vec![("master".to_string(), "マスタの置き場".to_string(), stuck.clone())];
        for i in 0..6 {
            paths.push((format!("k{i}"), format!("共有 {i}"), format!("\\\\srv{i}\\s")));
        }
        let t0 = Instant::now();
        let v = places_with(&probes, &paths, 1.0);
        *TEST_SLOW.lock().unwrap() = None;
        assert!(t0.elapsed() < Duration::from_secs(2), "締め切りで答える");
        let items = v["items"].as_array().unwrap();
        assert_eq!(items[0]["reach"], Value::Null, "止まる行は確かめ中: {v}");
        for it in &items[1..7] {
            assert_eq!(it["reach"], json!(false), "後ろの共有の行も答える: {it}");
        }
        let home = home();
        if !home.is_empty() {
            assert!(items.iter().any(|x| x["key"] == "pc" && x["label"] == "ホーム"), "この PC の場所が消えない: {v}");
        }
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
