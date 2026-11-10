//! 更新と配布の流れ（版 3.95.0。services/release_place.py と routes/settings.py の GET /api/update/settings・/api/release/place/*）を窓が答える。
//!
//! - GET /api/update/settings … 更新の置き場（参照先を重ねた update.source）・だれが（me の login・pc・区分・版を置けるか）・
//!   この PC のマスタの置き場。窓の更新の係（updater.rs）・配布の画面と操作（main.rs の /__desktop/release*）もここから読む
//!   （Python が居なくても更新を確かめ、配布の操作が 503 にならない）
//! - POST /api/release/place/check … 新しい置き場（上のフォルダ＋名前）へ変えられるか（plan。門番なし: Python と同じ）
//! - POST /api/release/place/move … 門番（_release_place_gate と同じ順と言葉）→ plan → 写し始める（Mover）
//! - GET /api/release/place/progress … 写す係の進み具合（Python の Mover.progress と同じ形）
//!
//! 「同じ所・中」は Python の Path.resolve(strict=False)＋os.path.normcase と同じ解き方で比べる。POSIX は posixpath.realpath（3.13）と同じく
//! 道を 1 つずつたどって記号リンクを解く。Windows は ntpath.realpath と同じく字で整えた（abspath・normpath）後、在る所までを OS に解かせ
//! （canonicalize。記号リンク・junction・subst・8.3・割り当てたドライブ。付く \\?\ と \\?\UNC\ は外す）、残り（まだ無い名前）を字でつなぐ。
//! 解けない形（権限で読めない・輪など、無い・届かない以外の誤り）は答えず Python に任せる（move は製品では Python が断る＝置けない側）。
//! 上のフォルダと名前のつなぎ方・Path の字は posixpath.join・ntpath.join・PureWindowsPath（3.13）と同じ（根・ドライブだけ・UNC の形も）。
//! 写す係は 1 つだけ（このプロセスに 1 つ）。窓が受けるので Python の Mover は動かさない（窓は sidecar.rs の SERVES に release を名乗り、
//! Python は move を断る）。写すのは shutil.copy2 と同じく中身・更新時刻・権限（Linux の std::fs::copy は更新時刻を写さない）。名前付きパイプは
//! 開く前に「… is a named pipe」で断る（開くと止まる）。誤りの字は Python の OSError の str と同じ形（[Errno n] 文: '元' -> '先'）。
//! 写している最中に窓を閉じた残り物（一時フォルダ）は、この PC の作業場所の印（release_move.json）を見て次に開いたとき・次に写すときに消す
//! （共有に届かないときは印に残して次の機会に）。
//! 同じ置き場を 2 つの PC が写すと、先に名前を付け替えた方が置き場になり、後の方は空でない置き場を消せずに失敗して自分の写しを片付ける。

use crate::worksum::{py_str, truthy};
use serde_json::{json, Map, Value};
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// 版のフォルダの目印（窓が置く。release.rs が探すのも同じ）
pub const MARKER: &str = "release.json";
/// 置き場の下を何階層まで探すか（置き場\版\release.json が 2 階層目）
pub const MARKER_DEPTH: u32 = 3;
pub const NAME_MAX: usize = 120;
const BAD: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const RESERVED: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];
/// 写しているあいだの一時フォルダの名前の中の印（.<名前>.copying-<pid>-<秒>）
const TMP_MARK: &str = ".copying-";

// ------------------------------------------------------------------ 道（Python の Path と os.path と同じ字）

/// str(Path(x))。win は Windows の決まり（PureWindowsPath）か（事例の表は両方の決まりを 1 つの PC で突き合わせる）
pub fn py_path_for(x: &str, win: bool) -> String {
    if win {
        win_format(&win_parse(x))
    } else {
        crate::bundle::posix_path(x)
    }
}

/// str(Path(x))（この PC の決まり）
fn py_path(x: &str) -> String {
    py_path_for(x, cfg!(windows))
}

/// ntpath.splitroot（Python 3.13）→ (ドライブ, 根, 残り)。/ は \ に読む
fn win_splitroot(p: &str) -> (String, String, String) {
    let n = p.replace('/', "\\");
    let cs: Vec<char> = n.chars().collect();
    let take = |a: usize, b: usize| -> String { cs[a.min(cs.len())..b.min(cs.len())].iter().collect() };
    let find = |from: usize| cs.iter().skip(from).position(|c| *c == '\\').map(|i| i + from);
    if cs.first() == Some(&'\\') {
        if cs.get(1) == Some(&'\\') {
            // UNC（\\server\share・\\?\UNC\server\share）・装置（\\.\device・\\?\device）
            let start = if take(0, 8).to_uppercase() == "\\\\?\\UNC\\" { 8 } else { 2 };
            let Some(i) = find(start) else { return (n, String::new(), String::new()) };
            let Some(j) = find(i + 1) else { return (n, String::new(), String::new()) };
            return (take(0, j), "\\".into(), take(j + 1, cs.len()));
        }
        return (String::new(), "\\".into(), take(1, cs.len()));
    }
    if cs.get(1) == Some(&':') {
        if cs.get(2) == Some(&'\\') {
            return (take(0, 2), "\\".into(), take(3, cs.len()));
        }
        return (take(0, 2), String::new(), take(2, cs.len()));
    }
    (String::new(), String::new(), n)
}

/// PureWindowsPath._parse_path（Python 3.13）→ (ドライブ, 根, 名前の並び)
fn win_parse(x: &str) -> (String, String, Vec<String>) {
    if x.is_empty() {
        return (String::new(), String::new(), vec![]);
    }
    let (drv, mut root, rel) = win_splitroot(x);
    if root.is_empty() && drv.starts_with('\\') && !drv.ends_with('\\') {
        let parts: Vec<&str> = drv.split('\\').collect();
        if (parts.len() == 4 && !"?.".contains(parts[2])) || parts.len() == 6 {
            root = "\\".into(); // //server/share・//?/unc/server/share
        }
    }
    let tail = rel.split('\\').filter(|p| !p.is_empty() && *p != ".").map(String::from).collect();
    (drv, root, tail)
}

/// PureWindowsPath の str（_format_parsed_parts）
fn win_format((drv, root, tail): &(String, String, Vec<String>)) -> String {
    if !drv.is_empty() || !root.is_empty() {
        return format!("{drv}{root}{}", tail.join("\\"));
    }
    let mut t = tail.clone();
    if t.first().is_some_and(|f| !win_splitroot(f).0.is_empty()) {
        t.insert(0, ".".into()); // 先頭の名前がドライブに見える（a:b）
    }
    let s = t.join("\\");
    if s.is_empty() {
        ".".into()
    } else {
        s
    }
}

/// str(Path(base) / name)（posixpath.join・ntpath.join の決まり。base は Path の字に整えた上のフォルダ、name は区切りもドライブも
/// 含まない名前〈check_name を通った物〉）。根（/・//・C:\）・ドライブだけ（C:）・UNC の根で、字でつなぐのと違う
pub fn join_for(base: &str, name: &str, win: bool) -> String {
    if !win {
        let j = if base.ends_with('/') { format!("{base}{name}") } else { format!("{base}/{name}") };
        return py_path_for(&j, false);
    }
    let (drive, root, mut path) = win_splitroot(base);
    if !path.is_empty() && !path.ends_with(['\\', '/']) {
        path.push('\\');
    }
    path.push_str(name);
    let j = if root.is_empty() && !drive.is_empty() && !drive.ends_with([':', '\\', '/']) {
        format!("{drive}\\{path}") // UNC と根の無い道のあいだに区切りを足す（ntpath.join と同じ）
    } else {
        format!("{drive}{root}{path}")
    };
    py_path_for(&j, true)
}

/// fsio.unquote_path: str(value or "").strip().strip('"')
fn unquote(x: &str) -> String {
    crate::pyfmt::strip(x).trim_matches('"').to_string()
}

/// os.path.normcase（Windows は小文字と \。POSIX はそのまま）
fn normcase(s: &str) -> String {
    if cfg!(windows) {
        s.replace('/', "\\").to_lowercase()
    } else {
        s.to_string()
    }
}

/// Windows（Win32）は道の各段の末尾の空白と「.」を黙って削る（「 」は空の名前・「a. 」は「a」になる）。Python は字のまま
/// os.stat に渡し、窓は今のフォルダにつないでから見るので、削られた後の道が食い違う（版 3.95.0 の Windows の CI で、上のフォルダ
/// 「" "」を Python は「届きません」、窓は今のフォルダとして通した）。そういう段を含む道は、窓は答えず Python に任せる
fn win_trims(p: &str) -> bool {
    p.split(['\\', '/']).any(|seg| seg != "." && seg != ".." && (seg.ends_with(' ') || seg.ends_with('.')))
}

/// 道を字のまま Python の今のフォルダ（cwd）から見た道にする（Path(相対).is_dir() は Python の今のフォルダから見る）
fn at(cwd: &Path, p: &str) -> PathBuf {
    let q = Path::new(p);
    if q.is_absolute() {
        q.to_path_buf()
    } else {
        cwd.join(q)
    }
}

/// Path(x).resolve()（strict=False）の字。POSIX は posixpath.realpath（Python 3.13）と同じたどり方。Windows は ntpath.realpath と同じく
/// 字で整えた（abspath・normpath）後、在る所までを OS に解かせ（記号リンク・junction・subst・8.3・割り当てたドライブ）、残りを字でつなぐ。
/// None は窓が Python と同じに解けない形（権限で読めない・届かない以外の誤り）: 呼ぶ側は答えず Python に任せる
pub fn py_resolve(x: &str, cwd: &Path) -> Option<String> {
    let p = py_path(x);
    if cfg!(windows) {
        let (drive, root, _) = win_splitroot(&p);
        if drive.ends_with(':') && root.is_empty() {
            return None; // ドライブだけの道（C:x）は Python がドライブごとの今のフォルダで解く（GetFullPathName）。窓は任せる
        }
        resolve_by_prefix(&win_abspath(&p, cwd), true).ok()
    } else {
        let base = if cwd.is_absolute() { realpath_posix(&cwd.to_string_lossy(), "/") } else { "/".to_string() };
        Some(realpath_posix(&p, &base))
    }
}

/// 在る所までを canonicalize で解き、残り（まだ無い名前）を字でつなぐ（ntpath.realpath の _getfinalpathname_nonstrict と同じ向き）。
/// canonicalize は Windows では \\?\ と \\?\UNC\ を付けるので外す。無い・届かない（ファイル・道が無い・名前が読めない・ネットワークの道）
/// のときだけ 1 つ上へ。ほかの誤り（権限・輪など）は Err
fn resolve_by_prefix(abs: &str, win: bool) -> Result<String, ()> {
    let sep = if win { '\\' } else { '/' };
    let missing = |e: &io::Error| match e.raw_os_error() {
        Some(n) if win => matches!(n, 2 | 3 | 21 | 53 | 67 | 123 | 161 | 1005),
        Some(n) => matches!(n, 2 | 20),
        None => e.kind() == io::ErrorKind::NotFound,
    };
    let mut head = abs.to_string();
    let mut tail: Vec<String> = vec![];
    loop {
        match std::fs::canonicalize(&head) {
            Ok(c) => {
                let c = c.to_string_lossy().into_owned();
                let c = if let Some(r) = c.strip_prefix("\\\\?\\UNC\\") {
                    format!("\\\\{r}")
                } else if let Some(r) = c.strip_prefix("\\\\?\\") {
                    r.to_string()
                } else {
                    c
                };
                if tail.is_empty() {
                    return Ok(c);
                }
                tail.reverse();
                let base = c.trim_end_matches(sep);
                return Ok(format!("{base}{sep}{}", tail.join(&sep.to_string())));
            }
            Err(e) if missing(&e) => match head.rfind(sep) {
                Some(i) if i + 1 < head.len() => {
                    tail.push(head[i + 1..].to_string());
                    // 根（/・C:\・\\server\share\）の区切りは残す
                    let parent = &head[..i];
                    head = if parent.is_empty()
                        || parent.ends_with(':')
                        || (win && parent.starts_with("\\\\") && parent.matches('\\').count() <= 3)
                    {
                        head[..=i].to_string()
                    } else {
                        parent.to_string()
                    };
                }
                _ => return Ok(abs.to_string()), // 根まで無い（届かないドライブ・共有）: 字のまま
            },
            Err(_) => return Err(()),
        }
    }
}

/// posixpath.realpath(filename, strict=False)。getcwd は symlink を解いた今のフォルダ
fn realpath_posix(filename: &str, getcwd: &str) -> String {
    enum Item {
        Part(String),
        Mark,
    }
    let mut rest: Vec<Item> = filename.split('/').rev().map(|s| Item::Part(s.to_string())).collect();
    let mut part_count = rest.len();
    let mut path = if filename.starts_with('/') { "/".to_string() } else { getcwd.to_string() };
    let mut seen: std::collections::HashMap<String, Option<String>> = Default::default();
    while part_count > 0 {
        let name = match rest.pop() {
            Some(Item::Mark) => {
                if let Some(Item::Part(p)) = rest.pop() {
                    seen.insert(p, Some(path.clone()));
                }
                continue;
            }
            Some(Item::Part(n)) => n,
            None => break,
        };
        part_count -= 1;
        if name.is_empty() || name == "." {
            continue;
        }
        if name == ".." {
            path = path[..path.rfind('/').unwrap_or(0)].to_string();
            if path.is_empty() {
                path = "/".into();
            }
            continue;
        }
        let newpath = if path == "/" { format!("/{name}") } else { format!("{path}/{name}") };
        match std::fs::symlink_metadata(&newpath) {
            Ok(m) if m.file_type().is_symlink() => {}
            _ => {
                path = newpath; // 記号リンクでない・無い（strict でないので無い道のまま続ける）
                continue;
            }
        }
        if let Some(v) = seen.get(&newpath) {
            path = v.clone().unwrap_or(newpath); // 解いた先を使う。解いている途中（輪）なら道のまま
            continue;
        }
        let Ok(target) = std::fs::read_link(&newpath) else {
            path = newpath;
            continue;
        };
        let target = target.to_string_lossy().into_owned();
        if target.starts_with('/') {
            path = "/".into();
        }
        seen.insert(newpath.clone(), None);
        rest.push(Item::Part(newpath));
        rest.push(Item::Mark);
        let parts: Vec<Item> = target.split('/').rev().map(|s| Item::Part(s.to_string())).collect();
        part_count += parts.len();
        rest.extend(parts);
    }
    path
}

/// ntpath.abspath の字（今のフォルダからの道にして normpath。ntpath.realpath も最初に normpath する）
fn win_abspath(p: &str, cwd: &Path) -> String {
    let p = p.replace('/', "\\");
    let abs = if p.starts_with("\\\\") || (p.len() >= 3 && p.as_bytes()[1] == b':' && p.as_bytes()[2] == b'\\') {
        p
    } else if p.starts_with('\\') {
        // 根からの道（ドライブは今のフォルダの物）
        let c = cwd.to_string_lossy().replace('/', "\\");
        format!("{}{p}", c.get(..2).unwrap_or(""))
    } else {
        format!("{}\\{p}", cwd.to_string_lossy().replace('/', "\\").trim_end_matches('\\'))
    };
    // normpath: . を外し、.. で 1 つ戻る（根より上へは戻らない）
    let (root, body) = if let Some(r) = abs.strip_prefix("\\\\") {
        let mut it = r.splitn(3, '\\');
        let (server, share, rest) = (it.next().unwrap_or(""), it.next().unwrap_or(""), it.next().unwrap_or(""));
        (format!("\\\\{server}\\{share}\\"), rest.to_string())
    } else {
        (abs.get(..3).unwrap_or("").to_string(), abs.get(3..).unwrap_or("").to_string())
    };
    let mut parts: Vec<&str> = vec![];
    for s in body.split('\\') {
        match s {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            x => parts.push(x),
        }
    }
    format!("{root}{}", parts.join("\\"))
}

/// release_place._same（resolve と normcase で比べる）。None は窓が解けない形（Python に任せる）
fn same(a: &str, b: &str, cwd: &Path) -> Option<bool> {
    Some(normcase(&py_resolve(a, cwd)?) == normcase(&py_resolve(b, cwd)?))
}

/// release_place._inside: c.startswith(p.rstrip("\\/") + os.sep)
fn inside(child: &str, parent: &str, cwd: &Path) -> Option<bool> {
    let (c, p) = (normcase(&py_resolve(child, cwd)?), normcase(&py_resolve(parent, cwd)?));
    let sep = if cfg!(windows) { '\\' } else { '/' };
    Some(c.starts_with(&format!("{}{sep}", p.trim_end_matches(['\\', '/']))))
}

// ------------------------------------------------------------------ 名前・目印・写す量

/// check_name: フォルダの名前（Windows で使えるもの）。合わなければ理由
pub fn check_name(name: &str) -> Result<String, String> {
    let s = crate::pyfmt::strip(name).to_string();
    if s.is_empty() {
        return Err("フォルダの名前を入れてください。".into());
    }
    if s.chars().count() > NAME_MAX {
        return Err(format!("フォルダの名前は {NAME_MAX} 字までにしてください。"));
    }
    let mut bad: Vec<char> = s.chars().filter(|c| BAD.contains(c) || (*c as u32) < 32).collect();
    bad.sort();
    bad.dedup();
    if !bad.is_empty() {
        let shown: String = bad.iter().map(|c| if (*c as u32) < 32 { "（制御文字）".to_string() } else { c.to_string() }).collect();
        return Err(format!("フォルダの名前に使えない字があります: {shown}（\\ / : * ? \" < > | は使えません）"));
    }
    if s.ends_with(['.', ' ']) {
        return Err("フォルダの名前の最後に「.」や空白は付けられません。".into());
    }
    let head = s.split('.').next().unwrap_or("").to_uppercase();
    let numbered = |p: &str| head.strip_prefix(p).is_some_and(|d| d.len() == 1 && matches!(d.as_bytes()[0], b'1'..=b'9'));
    if RESERVED.contains(&head.as_str()) || numbered("COM") || numbered("LPT") {
        return Err(format!("「{s}」は Windows が使う名前なので、フォルダの名前にできません。"));
    }
    Ok(s)
}

/// Path.stat の誤りのうち、Python 3.13 の Path.exists・is_dir・is_file が「無い」とみなす物（pathlib._abc._ignore_error）。
/// ほかの誤り（名前が長すぎる・権限が無い）は Python では例外になる
fn ignorable(e: &io::Error) -> bool {
    match e.raw_os_error() {
        // CPython が ENOENT に読み替える物（FILE_NOT_FOUND・PATH_NOT_FOUND・INVALID_DRIVE・NO_MORE_FILES・BAD_NETPATH・BAD_NET_NAME・
        // BAD_PATHNAME・FILENAME_EXCED_RANGE）・EBADF（INVALID_HANDLE）・ENOTDIR（DIRECTORY）と、pathlib が見る NOT_READY・INVALID_NAME・
        // CANT_RESOLVE_FILENAME
        Some(n) if cfg!(windows) => matches!(n, 2 | 3 | 15 | 18 | 53 | 67 | 161 | 206 | 6 | 267 | 21 | 123 | 1921),
        // ENOENT・EBADF・ENOTDIR・ELOOP（Linux 40・macOS 62）
        Some(n) => matches!(n, 2 | 9 | 20) || n == if cfg!(target_os = "macos") { 62 } else { 40 },
        None => e.kind() == io::ErrorKind::NotFound,
    }
}

/// Path.stat（記号リンクは先をたどる）: Ok(Some) 有る・Ok(None) 無い・Err は Python が落ちる形
fn py_stat(p: &Path) -> Result<Option<std::fs::Metadata>, ()> {
    match std::fs::metadata(p) {
        Ok(m) => Ok(Some(m)),
        Err(e) if ignorable(&e) => Ok(None),
        Err(_) => Err(()),
    }
}

/// Path.is_dir()（Err は Python が落ちる形）
fn py_is_dir(p: &Path) -> Result<bool, ()> {
    py_stat(p).map(|m| m.is_some_and(|m| m.is_dir()))
}

/// DirEntry.is_dir()（記号リンクは先をたどる。読めなければ偽）と、記号リンクか
fn entry_kind(e: &std::fs::DirEntry) -> (bool, bool) {
    let link = e.file_type().is_ok_and(|t| t.is_symlink());
    let dir = if link { std::fs::metadata(e.path()).is_ok_and(|m| m.is_dir()) } else { e.file_type().is_ok_and(|t| t.is_dir()) };
    (dir, link)
}

/// has_release: その下（depth 階層まで）に版の目印があるか。Path.iterdir は中身を先に読み切る。どこで誤っても（try の中）偽
pub fn has_release(folder: &Path, depth: u32) -> bool {
    match py_stat(&folder.join(MARKER)) {
        Ok(Some(m)) if m.is_file() => return true,
        Err(()) => return false,
        _ => {}
    }
    if depth == 0 {
        return false;
    }
    let Ok(rd) = std::fs::read_dir(folder) else { return false };
    let mut paths = vec![];
    for e in rd {
        let Ok(e) = e else { return false };
        paths.push(e.path());
    }
    for p in paths {
        match py_is_dir(&p) {
            Ok(true) if has_release(&p, depth - 1) => return true,
            Ok(_) => {}
            Err(()) => return false, // p.is_dir() の例外は外の try が受ける（この階層は偽）
        }
    }
    false
}

/// os.walk（上から・記号リンクのフォルダには入らない・読めないフォルダは黙って飛ばす）。f は (フォルダ, 中のファイルの名前)
fn walk(top: &Path, f: &mut dyn FnMut(&Path, &[OsString]) -> io::Result<()>) -> io::Result<()> {
    let Ok(rd) = std::fs::read_dir(top) else { return Ok(()) };
    let (mut dirs, mut names) = (vec![], vec![]);
    for e in rd {
        let Ok(e) = e else { return Ok(()) }; // 中身の途中で読めない（onerror が無い）: このフォルダは出さない
        let (dir, link) = entry_kind(&e);
        if dir {
            dirs.push((e.file_name(), link));
        } else {
            names.push(e.file_name());
        }
    }
    f(top, &names)?;
    for (d, link) in dirs {
        let p = top.join(&d);
        // islink(new_path) はいま見直す（lstat）
        if !link && !std::fs::symlink_metadata(&p).is_ok_and(|m| m.file_type().is_symlink()) {
            walk(&p, f)?;
        }
    }
    Ok(())
}

/// _tree_size: (ファイルの数, バイト)。stat できないファイルは数えない
pub fn tree_size(folder: &Path) -> (u64, u64) {
    let (mut files, mut size) = (0u64, 0u64);
    let _ = walk(folder, &mut |root, names| {
        for n in names {
            if let Ok(m) = std::fs::metadata(root.join(n)) {
                size += m.len();
                files += 1;
            }
        }
        Ok(())
    });
    (files, size)
}

// ------------------------------------------------------------------ 確かめる（plan）

fn with(out: &Map<String, Value>, more: Value) -> Value {
    let mut o = out.clone();
    for (k, v) in more.as_object().into_iter().flatten() {
        o.insert(k.clone(), v.clone());
    }
    Value::Object(o)
}

/// plan: 新しい置き場（parent\name）へ変えられるか。cwd は Python の今のフォルダ（相対の道の見方。中身のフォルダ）。
/// None は Python が落ちる形（Path.exists・is_dir・iterdir の「無い」でない誤り。窓は答えず Python に任せる）
pub fn plan(src: &str, parent: &str, name: &str, copy: bool, cwd: &Path) -> Option<Value> {
    let name = match check_name(name) {
        Ok(n) => n,
        Err(e) => return Some(json!({"ok": false, "problem": e})),
    };
    let up = unquote(parent);
    if up.is_empty() {
        return Some(json!({"ok": false, "problem": "置く場所（上のフォルダ）を入れてください。"}));
    }
    let base = py_path(&up);
    if cfg!(windows) && win_trims(&base) {
        return None; // Win32 が段の末尾の空白・「.」を削る道（win_trims）。Python に任せる
    }
    if !py_is_dir(&at(cwd, &base)).ok()? {
        return Some(
            json!({"ok": false, "problem": format!("上のフォルダに届きません: {up}（場所・BOX の同期・権限を確かめてください）")}),
        );
    }
    let dest = join_for(&base, &name, cfg!(windows));
    let mut out = Map::new();
    out.insert("ok".into(), json!(true));
    out.insert("dest".into(), json!(dest));
    out.insert("name".into(), json!(name));
    out.insert("parent".into(), json!(base));
    let s = unquote(src);
    let srcp = (!s.is_empty()).then(|| py_path(&s));
    if cfg!(windows) && srcp.as_deref().is_some_and(win_trims) {
        return None;
    }
    let src_dir = match srcp.as_deref() {
        Some(p) => py_is_dir(&at(cwd, p)).ok()?,
        None => false,
    };
    if let (Some(sp), true) = (srcp.as_deref(), src_dir) {
        if same(sp, &dest, cwd)? {
            return Some(with(&out, json!({"ok": false, "problem": "いまの置き場と同じ場所・名前です。"})));
        }
        if inside(&dest, sp, cwd)? {
            return Some(with(
                &out,
                json!({"ok": false, "problem": "いまの置き場の中には置けません（置き場の外のフォルダを選んでください）。"}),
            ));
        }
        if inside(sp, &dest, cwd)? {
            return Some(with(&out, json!({"ok": false, "problem": "いまの置き場を含むフォルダは選べません。"})));
        }
    }
    let d = at(cwd, &dest);
    let st = py_stat(&d).ok()?;
    let exists = st.is_some();
    if st.is_some_and(|m| !m.is_dir()) {
        return Some(with(&out, json!({"ok": false, "problem": "同じ名前のファイルがあります。別の名前にしてください。"})));
    }
    let dest_release = exists && has_release(&d, MARKER_DEPTH);
    // not any(dest.iterdir())（読めないフォルダは Python では例外）
    let dest_empty = if exists {
        let mut r = std::fs::read_dir(&d).ok()?;
        match r.next() {
            None => true,
            Some(Ok(_)) => false,
            Some(Err(_)) => return None,
        }
    } else {
        true
    };
    if dest_release {
        return Some(with(
            &out,
            json!({"mode": "switch", "note": "新しい場所は既に配布の置き場です（版があります）。写さずに切り替えます。"}),
        ));
    }
    if !dest_empty {
        return Some(with(
            &out,
            json!({"ok": false, "problem": "新しい場所に、配布と関係の無い物が入っています。空のフォルダか、まだ無い名前を選んでください。"}),
        ));
    }
    if !copy {
        return Some(with(
            &out,
            json!({"mode": "empty", "note": "写さずに切り替えます。新しい置き場に版を置いて配るまで、各 PC はいまの版のまま開きます。"}),
        ));
    }
    let Some(sp) = srcp.filter(|_| src_dir) else {
        return Some(with(
            &out,
            json!({"ok": false, "problem": "いまの置き場に届かないので写せません。「写さずに切り替える」を選ぶか、届くときにやり直してください。"}),
        ));
    };
    let (files, size) = tree_size(&at(cwd, &sp));
    Some(with(
        &out,
        json!({"mode": "copy", "src": sp, "files": files, "bytes": size,
               "note": format!("いまの置き場（{files} ファイル）を写してから切り替えます。前の置き場は消さずに残します。")}),
    ))
}

// ------------------------------------------------------------------ 写す係（Mover）

fn now() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

/// Python の repr(str)（OSError の字の道。引用符の選び方・\\ と制御文字・印字できない字〈空白の仲間・書式の字・私用の字〉の逃がし）
pub fn py_repr(s: &str) -> String {
    let quote = if s.contains('\'') && !s.contains('"') { '"' } else { '\'' };
    let mut out = String::from(quote);
    for c in s.chars() {
        let n = c as u32;
        let hidden = n < 0x20
            || (0x7f..=0xa0).contains(&n)
            || matches!(n, 0xad | 0x1680 | 0x180e | 0x2000..=0x200f | 0x2028..=0x202f | 0x205f..=0x2064 | 0x2066..=0x206f | 0x3000 | 0xfeff)
            || (0xe000..=0xf8ff).contains(&n)
            || (0xfff9..=0xfffb).contains(&n);
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ if c == quote => {
                out.push('\\');
                out.push(c)
            }
            _ if hidden && n < 0x100 => out.push_str(&format!("\\x{n:02x}")),
            _ if hidden => out.push_str(&format!("\\u{n:04x}")),
            _ => out.push(c),
        }
    }
    out.push(quote);
    out
}

/// OSError の str（[Errno n] 文: 'a' -> 'b'。道が無ければ [Errno n] 文。Windows は WinError）。code は OS の番号、msg は OS の文
pub fn py_oserror(code: Option<i32>, msg: &str, p1: Option<&str>, p2: Option<&str>) -> String {
    let head = match code {
        Some(n) if cfg!(windows) => format!("[WinError {n}] {msg}"),
        Some(n) => format!("[Errno {n}] {msg}"),
        None => msg.to_string(),
    };
    match (p1, p2) {
        (Some(a), Some(b)) => format!("{head}: {} -> {}", py_repr(a), py_repr(b)),
        (Some(a), None) => format!("{head}: {}", py_repr(a)),
        _ => head,
    }
}

/// io::Error → OSError の str（道は 0〜2 つ）
fn os_error(e: &io::Error, p1: Option<&Path>, p2: Option<&Path>) -> String {
    let text = e.to_string();
    let msg = match text.rfind(" (os error ") {
        Some(i) => text[..i].to_string(),
        None => text.clone(),
    };
    let (a, b) = (p1.map(|p| p.to_string_lossy().into_owned()), p2.map(|p| p.to_string_lossy().into_owned()));
    py_oserror(e.raw_os_error(), &msg, a.as_deref(), b.as_deref())
}

/// 名前付きパイプか（shutil.copyfile は os.stat〈先をたどる〉で見て SpecialFileError にする。開くと止まるので開く前に見る）
fn is_fifo(m: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileTypeExt;
        m.file_type().is_fifo()
    }
    #[cfg(not(unix))]
    {
        let _ = m;
        false
    }
}

/// Path.mkdir(parents=True, exist_ok=True): 無ければ上から作る。誤りの道は os.mkdir が失敗した道
fn py_mkdir(p: &Path) -> Result<(), String> {
    match std::fs::create_dir(p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            match p.parent().filter(|q| !q.as_os_str().is_empty() && *q != p) {
                Some(q) => py_mkdir(q)?,
                None => return Err(os_error(&e, Some(p), None)),
            }
            match std::fs::create_dir(p) {
                Ok(()) => Ok(()),
                Err(e) if p.is_dir() => {
                    let _ = e;
                    Ok(())
                }
                Err(e) => Err(os_error(&e, Some(p), None)),
            }
        }
        Err(_) if p.is_dir() => Ok(()), // exist_ok
        Err(e) => Err(os_error(&e, Some(p), None)),
    }
}

/// shutil.copy2: 中身・更新時刻（と触れた時刻）・権限を写す。同じ手で時刻を付けてから権限を付ける（読むだけのファイルも時刻が付く）。
/// 誤りの道は Python と同じ: 開けない元・先は 1 つ、写す途中は「元 -> 先」（sendfile の誤り。何も写せずに失敗したときは
/// copyfileobj へ移って道の無い誤り。容量切れは必ず 2 つ）、時刻・権限は先
fn copy2(s: &Path, d: &Path) -> Result<u64, String> {
    if std::fs::metadata(s).is_ok_and(|m| is_fifo(&m)) {
        return Err(format!("`{}` is a named pipe", s.to_string_lossy()));
    }
    let mut from = std::fs::File::open(s).map_err(|e| os_error(&e, Some(s), None))?;
    let mut to = std::fs::File::create(d).map_err(|e| os_error(&e, Some(d), None))?;
    let mut buf = vec![0u8; 1 << 20];
    let mut copied = 0u64;
    loop {
        use std::io::{Read, Write};
        let step = from.read(&mut buf).and_then(|n| to.write_all(&buf[..n]).map(|_| n));
        match step {
            Ok(0) => break,
            Ok(n) => copied += n as u64,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => {
                let both = copied > 0 || e.raw_os_error() == Some(if cfg!(windows) { 112 } else { 28 });
                return Err(if both { os_error(&e, Some(s), Some(d)) } else { os_error(&e, None, None) });
            }
        }
    }
    let m = std::fs::metadata(s).map_err(|e| os_error(&e, Some(s), None))?;
    let mut times = std::fs::FileTimes::new();
    if let Ok(t) = m.modified() {
        times = times.set_modified(t);
    }
    if let Ok(t) = m.accessed() {
        times = times.set_accessed(t);
    }
    to.set_times(times).map_err(|e| os_error(&e, Some(d), None))?;
    to.set_permissions(m.permissions()).map_err(|e| os_error(&e, Some(d), None))?;
    Ok(m.len())
}

#[derive(Default)]
struct Inner {
    p: Mutex<Map<String, Value>>,
}

/// 置き場を丸ごと写す係（1 つずつ。画面は progress を尋ねて進み具合を出す）
pub struct Mover {
    inner: Arc<Inner>,
    /// この PC の「写している」印（写している最中に閉じたとき、次に開いたら一時フォルダを片付ける）
    record: Option<PathBuf>,
}

impl Mover {
    /// record はこの PC の作業場所の印のファイル。前に写している最中に閉じた残り物（一時フォルダ）があれば裏で片付ける
    pub fn new(record: Option<PathBuf>) -> Mover {
        let inner = Arc::new(Inner::default());
        inner.p.lock().unwrap().insert("state".into(), json!("idle"));
        if let Some(r) = record.clone().filter(|r| r.exists()) {
            let _ = std::thread::Builder::new().name("release-move-sweep".into()).spawn(move || sweep(&r));
        }
        Mover { inner, record }
    }

    pub fn progress(&self) -> Value {
        let mut p = self.inner.p.lock().unwrap().clone();
        if let Some(s) = p.get("started").and_then(Value::as_f64).filter(|s| *s != 0.0) {
            p.insert("elapsed".into(), json!(((now() - s) * 10.0).round() / 10.0));
        }
        Value::Object(p)
    }

    /// 写し始める（裏の糸）。写している最中なら false。src・dest は plan の字（進み具合にそのまま出す）、cwd は相対の道の見方
    pub fn start(&self, src: &str, dest: &str, total_files: u64, total_bytes: u64, cwd: &Path) -> bool {
        {
            let mut p = self.inner.p.lock().unwrap();
            if p.get("state") == Some(&json!("running")) {
                return false;
            }
            *p = json!({"state": "running", "src": src, "dest": dest, "files": 0, "totalFiles": total_files,
                        "done": 0, "total": total_bytes, "started": now()})
            .as_object()
            .cloned()
            .unwrap_or_default();
        }
        let (inner, record, s, d) = (self.inner.clone(), self.record.clone(), at(cwd, src), at(cwd, dest));
        let spawned = std::thread::Builder::new().name("release-move".into()).spawn(move || run(&inner, record.as_deref(), &s, &d));
        if let Err(e) = spawned {
            let mut p = self.inner.p.lock().unwrap();
            p.insert("state".into(), json!("failed"));
            p.insert("error".into(), json!(format!("写せませんでした: {e}")));
        }
        true
    }

    /// 試験用: 写している最中の形にする（true）・何もしていない形へ戻す（false）。忙しい（409）の形を Python と突き合わせる
    pub fn hold(&self, running: bool) {
        let v = if running { json!({"state": "running", "files": 0, "done": 0}) } else { json!({"state": "idle"}) };
        *self.inner.p.lock().unwrap() = v.as_object().cloned().unwrap_or_default();
    }

    /// 試験用: その場で写す（start と同じ流れ。Python の run_sync と同じく数えの欄は files・done だけ）
    pub fn run_sync(&self, src: &str, dest: &str) -> Value {
        *self.inner.p.lock().unwrap() = json!({"state": "running", "src": src, "dest": dest, "files": 0, "done": 0, "started": now()})
            .as_object()
            .cloned()
            .unwrap_or_default();
        run(&self.inner, self.record.as_deref(), Path::new(src), Path::new(dest));
        self.progress()
    }
}

/// 写している印（この PC の作業場所の release_move.json）を読み書きする錠（片付けの糸と写す糸がぶつからない）
static RECORD_LOCK: Mutex<()> = Mutex::new(());

/// 印の一時フォルダの並び（前の版の形 {"tmp": 道} も読む）
fn record_tmps(record: &Path) -> Vec<String> {
    let v = std::fs::read(record).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(Value::Null);
    let mut out: Vec<String> = v["tmps"].as_array().into_iter().flatten().filter_map(|x| x.as_str().map(String::from)).collect();
    if let Some(t) = v["tmp"].as_str() {
        out.push(t.to_string());
    }
    out
}

fn record_write(record: &Path, tmps: &[String]) {
    if tmps.is_empty() {
        let _ = std::fs::remove_file(record);
    } else {
        let _ = std::fs::write(record, json!({"tmps": tmps}).to_string());
    }
}

/// 前に写している最中に閉じた残り物（一時フォルダ）を消す。印の名前の形のフォルダだけ消し、上のフォルダ（共有）に届かない物は
/// 印に残して次の機会（次に開いたとき・次に写すとき）に片付ける
fn sweep(record: &Path) {
    let _g = RECORD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut keep = vec![];
    for t in record_tmps(record) {
        let tp = PathBuf::from(&t);
        let named = tp.file_name().map(|n| n.to_string_lossy().into_owned()).is_some_and(|n| n.starts_with('.') && n.contains(TMP_MARK));
        if !named {
            continue;
        }
        let reachable = tp.parent().is_some_and(|q| q.is_dir());
        if !reachable {
            keep.push(t);
            continue;
        }
        if tp.exists() && std::fs::remove_dir_all(&tp).is_err() && tp.exists() {
            keep.push(t); // 消せなかった（開いているファイル・権限）: 次の機会に
        }
    }
    record_write(record, &keep);
}

fn record_add(record: &Path, tmp: &Path) {
    let _g = RECORD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut tmps = record_tmps(record);
    tmps.push(tmp.to_string_lossy().into_owned());
    record_write(record, &tmps);
}

fn record_remove(record: &Path, tmp: &Path) {
    let _g = RECORD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = tmp.to_string_lossy();
    let tmps: Vec<String> = record_tmps(record).into_iter().filter(|x| *x != t).collect();
    record_write(record, &tmps);
}

fn run(inner: &Inner, record: Option<&Path>, src: &Path, dest: &Path) {
    let parent = dest.parent().map(Path::to_path_buf).unwrap_or_default();
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let secs = now() as u64;
    let tmp = parent.join(format!(".{name}{TMP_MARK}{}-{secs}", std::process::id()));
    if let Some(r) = record {
        sweep(r); // 前に届かなかった残り物も、届くようになっていれば片付ける
        record_add(r, &tmp);
    }
    let r = (|| -> Result<(), String> {
        let mut copy_dir = |root: &Path, names: &[OsString]| -> io::Result<()> {
            // tmp / Path(root).relative_to(src)（いちばん上は tmp そのもの。末尾に区切りを付けない）
            let to = match root.strip_prefix(src) {
                Ok(rel) if !rel.as_os_str().is_empty() => tmp.join(rel),
                _ => tmp.clone(),
            };
            py_mkdir(&to).map_err(io::Error::other)?;
            for n in names {
                let size = copy2(&root.join(n), &to.join(n)).map_err(io::Error::other)?;
                let mut p = inner.p.lock().unwrap();
                let files = p.get("files").and_then(Value::as_u64).unwrap_or(0) + 1;
                let done = p.get("done").and_then(Value::as_u64).unwrap_or(0) + size;
                p.insert("files".into(), json!(files));
                p.insert("done".into(), json!(done));
            }
            Ok(())
        };
        walk(src, &mut copy_dir).map_err(|e| e.to_string())?;
        // dest.exists()（「無い」でない誤りは例外）→ 確かめたときは空（空でなければ dest.rmdir() で失敗し、写した物は片付ける）
        let there = match std::fs::metadata(dest) {
            Ok(_) => true,
            Err(e) if ignorable(&e) => false,
            Err(e) => return Err(os_error(&e, Some(dest), None)),
        };
        if there {
            std::fs::remove_dir(dest).map_err(|e| os_error(&e, Some(dest), None))?;
        }
        // 写し終えてから名前を付ける（各 PC は写しかけを見ない）
        std::fs::rename(&tmp, dest).map_err(|e| os_error(&e, Some(&tmp), Some(dest)))
    })();
    {
        let mut p = inner.p.lock().unwrap();
        match r {
            Ok(()) => {
                p.insert("state".into(), json!("done"));
                p.insert("finished".into(), json!(now()));
            }
            Err(e) => {
                let _ = std::fs::remove_dir_all(&tmp); // 届かない・権限・容量: 写しかけを片付けて理由を返す
                p.insert("state".into(), json!("failed"));
                p.insert("error".into(), json!(format!("写せませんでした: {e}")));
            }
        }
    }
    if let Some(r) = record {
        if !tmp.exists() {
            record_remove(r, &tmp); // 片付けられなかった写しかけは印に残す（次の機会に消す）
        }
    }
}

// ------------------------------------------------------------------ 道と門番

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// GET /api/update/settings
    Settings,
    Check,
    Move,
    Progress,
}

pub fn route_of(method: &str, path: &str) -> Option<Route> {
    match (method, path) {
        ("GET", "/api/update/settings") => Some(Route::Settings),
        ("POST", "/api/release/place/check") => Some(Route::Check),
        ("POST", "/api/release/place/move") => Some(Route::Move),
        ("GET", "/api/release/place/progress") => Some(Route::Progress),
        _ => None,
    }
}

/// 本文の 4 つ（_release_place_args: str(b.get(k) or "")・copy は「is not False」）
#[derive(Debug, Clone, PartialEq)]
pub struct Args {
    pub from: String,
    pub parent: String,
    pub name: String,
    pub copy: bool,
}

/// 本文 → Args（get_json(force=True, silent=True) or {}）。窓が Python と同じ字にできない値（並び・表〈Python は repr の字〉・
/// 読みの割れる数）・表でない真の本文（Python は .get で落ちる）は None（Python に任せる）
pub fn args_of(body: &[u8]) -> Option<Args> {
    let b = crate::master_rows::py_body(body)?;
    let text = |k: &str| -> Option<String> {
        match b.get(k) {
            None => Some(String::new()),
            Some(v) if !truthy(v) => Some(String::new()),
            Some(Value::String(s)) => Some(s.clone()),
            Some(v @ Value::Bool(_)) => Some(py_str(v)),
            Some(v @ Value::Number(n)) if n.as_i64().is_some() || n.is_f64() => Some(py_str(v)),
            _ => None,
        }
    };
    Some(Args { from: text("from")?, parent: text("parent")?, name: text("name")?, copy: b.get("copy") != Some(&json!(false)) })
}

fn err(status: u16, kind: &str, msg: String) -> (u16, Value) {
    (status, json!({"error": msg, "kind": kind}))
}

/// _release_place_gate: 置き場を変えてよいか（版を置く・配る版を決められ、参照先〈管理のマスタ〉を書ける PC だけ）。断るなら (状態, 答え)
pub fn gate(me: &Result<Value, String>) -> Option<(u16, Value)> {
    let m = match me {
        Ok(m) => m,
        Err(e) => return Some(err(503, "unavailable", format!("権限を読めないので、置き場を変えられません（{e}）。"))),
    };
    if truthy(&m["revoked"]) {
        return Some(err(403, "revoked", "この PC は一時的に切断されています。".into()));
    }
    if !truthy(&m["caps"]["canRelease"]) {
        return Some(err(
            403,
            "forbidden",
            format!("配布の置き場を変えられるのは、開発者・メンテナンス者だけです（この PC は「{}」）。", py_str(&m["flags"]["role"])),
        ));
    }
    let lv = py_str(&m["flags"]["masterEdit"]);
    if !crate::access::master_edit_can(&lv, "write", crate::access::master_scope("path_settings")) {
        return Some(err(403, "forbidden", format!("この PC のマスタ編集（{lv}）では、参照先（更新の置き場）を書き換えられません。")));
    }
    None
}

/// GET /api/update/settings の答え（source・who・masters）。me を決められないときは Python の except と同じ形（置き場は読む）
pub fn settings_answer(source: &str, me: &Result<Value, String>, share_dir: &str) -> Value {
    let who = match me {
        Ok(m) => json!({"login": m["login"], "pc": m["pc"], "role": m["flags"]["role"],
                        "canRelease": truthy(&m["caps"]["canRelease"]) && !truthy(&m["revoked"])}),
        Err(e) => json!({"login": "", "pc": "", "role": "", "canRelease": false, "error": e}),
    };
    json!({"source": source, "who": who, "masters": {"dir": share_dir}})
}

/// 配布の置き場の 3 本（check・move・progress）。me は move の門番だけが読む。None は Python に任せる（?engine=python も。
/// 製品では Python は move で写さずに断る: 写す係は窓の 1 つ）
pub fn handle(
    route: Route,
    query: &str,
    body: &[u8],
    me: &dyn Fn() -> Result<Value, String>,
    mover: &Mover,
    cwd: &Path,
) -> Option<(u16, Value)> {
    if crate::lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
        return None;
    }
    match route {
        Route::Settings => None,
        Route::Progress => Some((200, mover.progress())),
        Route::Check => {
            let a = args_of(body)?;
            Some((200, plan(&a.from, &a.parent, &a.name, a.copy, cwd)?))
        }
        Route::Move => {
            if let Some(no) = gate(&me()) {
                return Some(no);
            }
            let a = args_of(body)?;
            let pl = plan(&a.from, &a.parent, &a.name, a.copy, cwd)?;
            if pl["ok"] != json!(true) {
                let msg = pl["problem"].as_str().filter(|s| !s.is_empty()).unwrap_or("変えられません。").to_string();
                return Some((400, json!({"error": msg, "kind": "invalid", "plan": pl})));
            }
            if pl["mode"] != json!("copy") {
                return Some((200, json!({"mode": pl["mode"], "dest": pl["dest"], "started": false})));
            }
            let (src, dest) = (pl["src"].as_str().unwrap_or(""), pl["dest"].as_str().unwrap_or(""));
            let (files, bytes) = (pl["files"].as_u64().unwrap_or(0), pl["bytes"].as_u64().unwrap_or(0));
            if !mover.start(src, dest, files, bytes, cwd) {
                return Some(err(409, "busy", "ほかの置き場を写している最中です。終わってからやり直してください。".into()));
            }
            Some((200, json!({"mode": "copy", "dest": pl["dest"], "started": true})))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("da-relplace-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn win32_trimmed_parts_are_found() {
        for p in [" ", "  ", "a ", "a.", "C:\\x\\ ", "\\\\srv\\share\\d.\\e", "x/y ./z"] {
            assert!(win_trims(p), "{p:?}");
        }
        for p in ["", ".", "..", "a", "C:\\x\\y", "..\\a", "./a", "\\\\srv\\share\\d", "a b\\c"] {
            assert!(!win_trims(p), "{p:?}");
        }
    }

    #[test]
    fn names() {
        for ok in ["Defect-Analyzer", "配布 2026", "TPA.releases", "COM0", "LPT10", "CONSOLE"] {
            assert_eq!(check_name(&format!("  {ok} ")).as_deref(), Ok(ok));
        }
        for bad in ["", "a/b", "a\\b", "a:b", "a*", "a?", "a\"", "a<", "a|", "end.", "CON", "com1.txt", "\u{1}"] {
            assert!(check_name(bad).is_err(), "{bad:?}");
        }
        assert!(check_name(&"x".repeat(121)).is_err() && check_name(&"字".repeat(120)).is_ok(), "字の数で数える");
        assert_eq!(
            check_name("a\u{1}b\u{2}:").unwrap_err(),
            "フォルダの名前に使えない字があります: （制御文字）（制御文字）:（\\ / : * ? \" < > | は使えません）"
        );
    }

    #[cfg(unix)]
    #[test]
    fn realpath_follows_links_like_python() {
        let d = tmp("real");
        std::fs::create_dir_all(d.join("a/b")).unwrap();
        std::os::unix::fs::symlink(d.join("a"), d.join("l")).unwrap();
        std::os::unix::fs::symlink("l2", d.join("l1")).unwrap();
        std::os::unix::fs::symlink("l1", d.join("l2")).unwrap();
        let r = |x: &str| py_resolve(&format!("{}/{x}", d.display()), Path::new("/")).unwrap();
        let real = realpath_posix(&d.to_string_lossy(), "/");
        assert_eq!(r("l/b/../b/無い/x"), format!("{real}/a/b/無い/x"));
        assert_eq!(r("l1/x"), format!("{real}/l1/x"), "輪は道のまま（strict でない）");
        assert_eq!(py_resolve("rel/x", &d).unwrap(), format!("{real}/rel/x"));
        // Windows の解き方（在る所までを canonicalize し、残りを字でつなぐ）も、記号リンクの道で realpath と同じ所へ着く
        // （Windows は先に字で .. を畳むので、.. を含まない道で比べる）
        for x in ["l/b/無い/x", "l/b", "l", "a/b/c/d", "無い", "l/無い/もっと"] {
            let abs = format!("{real}/{x}");
            assert_eq!(resolve_by_prefix(&abs, false), Ok(realpath_posix(&abs, "/")), "{x}");
        }
        assert_eq!(resolve_by_prefix(&format!("{real}/l1/x"), false), Err(()), "輪は解けない: Python に任せる");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn windows_paths_and_joins() {
        // PureWindowsPath の字と ntpath.join（事例の全部は release_parity の joined_paths_match_python）
        for (x, want) in
            [("C:", "C:"), ("c:/A//b/", "c:\\A\\b"), ("//srv/share", "\\\\srv\\share\\"), ("//tmp", "\\\\tmp"), ("a:b", ".\\a:b")]
        {
            if x == "a:b" {
                assert_eq!(win_format(&(String::new(), String::new(), vec!["a:b".into()])), want);
                continue;
            }
            assert_eq!(py_path_for(x, true), want, "{x}");
        }
        assert_eq!(join_for("C:", "n", true), "C:n");
        assert_eq!(join_for("C:\\", "n", true), "C:\\n");
        assert_eq!(join_for("\\\\tmp", "n", true), "\\\\tmp\\n\\");
        assert_eq!(join_for("/", "n", false), "/n");
        assert_eq!(join_for("//", "n", false), "//n");
    }

    #[test]
    fn mover_copies_times_and_cleans_up() {
        let d = tmp("mover");
        let src = d.join("src");
        std::fs::create_dir_all(src.join("v1")).unwrap();
        std::fs::write(src.join("v1").join("release.json"), "{}").unwrap();
        std::fs::write(src.join("a.bin"), vec![7u8; 1000]).unwrap();
        let old = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
        std::fs::File::options().write(true).open(src.join("a.bin")).unwrap().set_modified(old).unwrap();
        let rec = d.join("release_move.json");
        let m = Mover::new(Some(rec.clone()));
        let p = m.run_sync(&src.to_string_lossy(), &d.join("new").to_string_lossy());
        assert_eq!((p["state"].clone(), p["files"].clone(), p["done"].clone()), (json!("done"), json!(2), json!(1002)), "{p}");
        assert_eq!(std::fs::metadata(d.join("new").join("a.bin")).unwrap().modified().unwrap(), old, "copy2 と同じく更新時刻を写す");
        assert!(!rec.exists(), "写し終えたら印を消す");
        // 2 つ目の PC が先に置き場を作った（空でない）: 失敗して自分の写しを片付ける
        let p = m.run_sync(&src.to_string_lossy(), &d.join("new").to_string_lossy());
        assert_eq!(p["state"], "failed", "{p}");
        let left: Vec<String> = std::fs::read_dir(&d).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(!left.iter().any(|n| n.contains(TMP_MARK)), "{left:?}");
        // 写している最中に閉じた残り物: 次に開いたとき消す（印の無いほかの PC の一時フォルダは消さない）
        let mine = d.join(format!(".x{TMP_MARK}1-2"));
        let other = d.join(format!(".y{TMP_MARK}3-4"));
        std::fs::create_dir_all(mine.join("v")).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(&rec, json!({"tmp": mine}).to_string()).unwrap();
        sweep(&rec);
        assert!(!mine.exists() && other.exists() && !rec.exists());
        // 上のフォルダ（共有）に届かない残り物は、印に残して次の機会に片付ける
        let far = d.join("届かない共有").join(format!(".z{TMP_MARK}5-6"));
        std::fs::write(&rec, json!({"tmps": [far, mine]}).to_string()).unwrap();
        sweep(&rec);
        assert_eq!(record_tmps(&rec), vec![far.to_string_lossy().into_owned()]);
        std::fs::create_dir_all(&far).unwrap();
        sweep(&rec);
        assert!(!far.exists() && !rec.exists(), "届くようになったら消して印も消す");
        let _ = std::fs::remove_dir_all(&d);
    }
}
