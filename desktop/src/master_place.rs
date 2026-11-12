//! マスタの置き場（版 3.101.0。Python の services/master_place.py と routes の GET /api/masters/status・GET /api/masters/place・
//! POST /api/masters/place/check・move）を窓が答える。
//!
//! - GET /api/masters/status … 置き場（手元／共有）・共有へ届くか・錠・各マスタの版（MasterStore.status＋同期フォルダの注意）。
//!   共有を見るのは SHARE_PROBE_SEC（2 秒）まで。終わらなければ写しで答え、reachable は null（確かめ中。保存の手は止めない）。
//!   false は「届かない」と分かったときだけ（版 3.100.0 の決まり）。同じ置き場へ尋ねる糸は 1 本まで
//! - GET /api/masters/place … いまの置き場・この PC の覚え・置き場ごとの使っている PC（using。まとめて 2 秒まで）・変えてよいか
//! - POST /api/masters/place/check … 新しい置き場（上のフォルダ＋名前）へ変えられるか（plan。門番なし: Python と同じ）
//! - POST /api/masters/place/move … 門番（配布の置き場と同じ release_place::gate）→ plan → 写して切り替える
//!
//! 写す係（引っ越し）は窓の 1 つ（sidecar.rs の SERVES に place を名乗り、Python は move を 409 で断る。配布の置き場と同じ型）。
//! 引っ越しは、利用状況の記録（もともと錠の外で書かれる物）を錠の外で先に写し、マスタだけを錠の中で写す。錠は延ばさない
//! （理由は docs/RUST_PORT_PLAN.md の版 3.100.0 の割れ 2）。錠の長さの半分を過ぎたら・読んだマスタが変わったら、切り替えずに止める。
//!
//! 主のセッションの決め（版 3.101.0）:
//!   - 種まき（共有にまだ無いマスタの最初の版を置く・写しの取り直しの係）は Python に任せたまま。窓の status は、種まきの要る形
//!     （共有に届くのにまだ無いマスタがある）を Python に任せる（None）。窓へ移すのは Python を外す段の「⑤ 裏の係」
//!   - status の last_sync・error は Python と同じ意味（このプロセスが最後に共有から写しを取り直した時刻・最後に取り直せなかった理由）
//!   - 同期フォルダの名前の表は今の表のまま（足さない）
//!
//! 置き場を変える部品（名前の確かめ・道のつなぎ方・同じ所と中・読めない理由）は配布の置き場（release_place.rs）と 1 つ。
//! 突き合わせ: desktop/tests/place_parity.rs ← program/tests/place_oracle.py（答え・断る言葉・できたファイル）、
//! desktop/tests/place_cases.rs ← tests/fixtures/place_cases.json（独立の答え tools/place-truth.py と同じ表）。

use crate::master_store::{iso, now_local, write_bytes_atomic, MasterError, Store, LOCK_FILENAME};
use crate::presence::{REVOKE_SUFFIX, SESSIONS_DIR, SETTINGS_FILE, SUBDIR as PRESENCE_DIR};
use crate::pyjson::J;
use crate::release_place::{at, check_name, ignorable, inside, join_for, os_error, py_path, same};
use crate::worksum::py_str;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

/// 置き場の状態（status・place）で共有を見るのにかける秒（まとめて。fs/places と同じ区切り）
pub const SHARE_PROBE_SEC: f64 = 2.0;
/// 利用者の決め（版 3.100.0）: 引っ越しで利用状況の記録（history・sessions・settings.json）と切断の指示（*.revoke.json）も写す
pub const COPY_PRESENCE: bool = true;
pub const PRESENCE_TREES: [&str; 2] = ["history", SESSIONS_DIR];
pub const RECORDS_NOTE: &str = "利用状況の記録と切断の指示も写します。";
/// 錠の長さ（lock_ttl）のうち、錠を持ってマスタを写すのに使ってよい割合
pub const LOCK_SHARE: f64 = 0.5;
pub const MOVED_FILENAME: &str = "_MOVED.json";
pub const OVERRIDE_FILENAME: &str = "master_share.json";
pub const PIN_FILENAME: &str = "want.json";
pub const HISTORY_KEEP: usize = 10;
/// マスタの置き場か（どれかがあれば。Python の MASTER_MARKERS）
pub const MARKERS: [&str; 3] = ["equipment_master.json", "roll_master.json", "path_settings.json"];
/// GET /api/masters/status が答えるマスタ（Python の MasterStore.status の names）
pub const STATUS_NAMES: [&str; 16] = [
    "equipment_master",
    "roll_master",
    "path_settings",
    "access_permissions",
    "work_log_files",
    "display_formats",
    "shift_patterns",
    "pivot_presets",
    "pivot_quick",
    "data_sources",
    "dashboard_settings",
    "dashboards",
    "equipment_groups",
    "conversions",
    "conversion_defaults",
    "tab_access",
];
/// クラウドの同期フォルダ（フォルダ名 → 呼び名。今の表のまま: 版 3.101.0 の主のセッションの決め）
const SYNC_FOLDERS: [(&str, &str); 9] = [
    ("box", "Box"),
    ("boxdrive", "Box"),
    ("onedrive", "OneDrive"),
    ("dropbox", "Dropbox"),
    ("google drive", "Google ドライブ"),
    ("googledrive", "Google ドライブ"),
    ("マイドライブ", "Google ドライブ"),
    ("my drive", "Google ドライブ"),
    ("icloud drive", "iCloud Drive"),
];

// ------------------------------------------------------------------ 小さな部品

/// 同期フォルダの呼び名（Python の sync_folder。共有〈\\サーバー\…・//〉は見ない）
pub fn sync_folder(path: &str) -> &'static str {
    if path.starts_with("\\\\") || path.starts_with("//") {
        return "";
    }
    for part in path.split(['\\', '/']).filter(|p| !p.is_empty()) {
        let low = crate::pyfmt::strip(part).to_lowercase();
        if let Some((_, k)) = SYNC_FOLDERS.iter().find(|(n, _)| *n == low) {
            return k;
        }
        if low.starts_with("onedrive") {
            return "OneDrive";
        }
    }
    ""
}

pub fn sync_caution(path: &str) -> String {
    match sync_folder(path) {
        "" => String::new(),
        k => format!(
            "{k} の同期フォルダです。同期フォルダでは、2 人がほぼ同時にマスタを保存すると、片方の変更が消えることがあります\
             （錠が PC ごとに別々になるため）。マスタは、ファイルサーバーの共有（\\\\サーバー\\共有）に置いてください。"
        ),
    }
}

/// ドライブだけ（C:）はその根（C:\）（Python の drive_root）
pub fn drive_root(text: &str) -> String {
    let cs: Vec<char> = text.chars().collect();
    if cs.len() == 2 && cs[1] == ':' && cs[0].is_ascii_alphabetic() {
        format!("{text}\\")
    } else {
        text.to_string()
    }
}

/// Python の format(f, "g")（有効 6 桁・後ろの 0 を外す。錠の長さ・秒の言葉）
pub fn py_g(f: f64) -> String {
    if f == 0.0 || !f.is_finite() {
        return if f.is_nan() {
            "nan".into()
        } else if f.is_infinite() {
            if f > 0.0 { "inf" } else { "-inf" }.into()
        } else {
            "0".into()
        };
    }
    let sci = format!("{f:.5e}");
    let (mant, e) = sci.split_once('e').unwrap_or((&sci, "0"));
    let e: i32 = e.parse().unwrap_or(0);
    let trim = |x: &str| -> String {
        if x.contains('.') {
            x.trim_end_matches('0').trim_end_matches('.').to_string()
        } else {
            x.to_string()
        }
    };
    if !(-4..6).contains(&e) {
        format!("{}e{}{:02}", trim(mant), if e < 0 { '-' } else { '+' }, e.abs())
    } else {
        trim(&format!("{:.*}", (5 - e).max(0) as usize, f))
    }
}

/// Path.is_file()（Python 3.13: 「無い」でない誤りは例外）
fn is_file_e(p: &Path) -> io::Result<bool> {
    match std::fs::metadata(p) {
        Ok(m) => Ok(m.is_file()),
        Err(e) if ignorable(&e) => Ok(false),
        Err(e) => Err(e),
    }
}

/// Path.is_dir()（同上）
fn is_dir_e(p: &Path) -> io::Result<bool> {
    match std::fs::metadata(p) {
        Ok(m) => Ok(m.is_dir()),
        Err(e) if ignorable(&e) => Ok(false),
        Err(e) => Err(e),
    }
}

/// マスタの置き場か（どれかの目印がある）
pub fn is_master_place(folder: &Path) -> io::Result<bool> {
    for m in MARKERS {
        if is_file_e(&folder.join(m))? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// e.strerror（OS の言葉。Windows は FormatMessage の字）
fn strerror(e: &io::Error) -> String {
    crate::builder::strerror(e)
}

/// 新しい場所の中を読めないとき（権限など）の理由（Python の release_place.unreadable）
pub fn unreadable(e: &io::Error) -> String {
    format!("新しい場所を読めません（{}）。権限か、つながりを確かめてください。", strerror(e))
}

/// DirEntry.is_file()（記号リンクは先をたどる。読めなければ偽）
fn entry_is_file(e: &std::fs::DirEntry) -> bool {
    match e.file_type() {
        Ok(t) if t.is_symlink() => std::fs::metadata(e.path()).is_ok_and(|m| m.is_file()),
        Ok(t) => t.is_file(),
        Err(_) => false,
    }
}

/// マスタの中身を書く字（json.dumps(doc, ensure_ascii=False, indent=1) + 改行。数えるのも書くのもこの字）
pub fn payload(doc: &J) -> Vec<u8> {
    let mut s = doc.dumps(Some(1));
    s.push('\n');
    s.into_bytes()
}

fn read_json_j(p: &Path) -> Option<J> {
    let b = std::fs::read(p).ok()?;
    let b = b.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&b);
    crate::pyjson::loads(std::str::from_utf8(b).ok()?).ok()
}

/// _as_doc（送った順のまま）。読めない形・版の番号が整数でない（Python の int() の字）は None（Python に任せる）
fn as_doc(raw: J) -> Option<J> {
    let (rev, at, by, rows) = match raw {
        J::Arr(rows) => (0, J::Str(String::new()), J::obj(), J::Arr(rows)),
        J::Obj(o) => {
            let get = |k: &str| o.iter().rev().find(|(n, _)| n == k).map(|(_, v)| v.clone());
            let rows = match get("rows") {
                Some(r @ J::Arr(_)) => r,
                _ => return None,
            };
            let rev = match get("revision") {
                None => 0,
                Some(J::Int(i)) => i,
                Some(J::Bool(b)) => b as i64,
                _ => return None,
            };
            let by = match get("updated_by") {
                Some(v) if v.truthy() => v,
                _ => J::obj(),
            };
            (rev, get("updated_at").unwrap_or(J::Str(String::new())), by, rows)
        }
        _ => return None,
    };
    Some(J::Obj(vec![
        ("schema".into(), J::Int(1)),
        ("revision".into(), J::Int(rev)),
        ("updated_at".into(), at),
        ("updated_by".into(), by),
        ("rows".into(), rows),
    ]))
}

// ------------------------------------------------------------------ 写す物

/// 写す物の 1 つ
pub struct Item {
    /// 前の置き場からの相対の道（/ 区切り）
    pub rel: String,
    pub size: u64,
    /// 共有のファイル（写し・手元のみは None で、中身は bytes）
    pub path: Option<PathBuf>,
    bytes: Vec<u8>,
}

/// 写す物を集められない
pub enum Fail {
    /// OSError（道があれば Python の str と同じ字にする）
    Os(io::Error, Option<PathBuf>),
    /// Python も落ちる・窓が同じに読めない形（Python に任せる）
    Py,
}

impl Fail {
    fn text(&self) -> String {
        match self {
            Fail::Os(e, p) => os_error(e, p.as_deref(), None),
            Fail::Py => String::new(),
        }
    }
}

fn presence_rel(rel: &str) -> bool {
    rel.starts_with(&format!("{PRESENCE_DIR}/"))
}

/// os.walk（上から・「.」で始まるフォルダには入らない・記号リンクのフォルダには入らない・読めないフォルダは飛ばす）→ (相対の道, ファイル)
fn walk_files(top: &Path, rel: &str, out: &mut Vec<(String, PathBuf)>) {
    let Ok(rd) = std::fs::read_dir(top) else { return };
    let (mut dirs, mut files) = (vec![], vec![]);
    for e in rd {
        let Ok(e) = e else { return };
        let name = e.file_name().to_string_lossy().into_owned();
        let (dir, _) = crate::release_place::entry_kind(&e);
        if dir {
            dirs.push(name);
        } else {
            files.push(name);
        }
    }
    for f in files.into_iter().filter(|f| !f.starts_with('.')) {
        out.push((format!("{rel}/{f}"), top.join(&f)));
    }
    for d in dirs.into_iter().filter(|d| !d.starts_with('.')) {
        let p = top.join(&d);
        if !std::fs::symlink_metadata(&p).is_ok_and(|m| m.file_type().is_symlink()) {
            walk_files(&p, &format!("{rel}/{d}"), out);
        }
    }
}

/// 前の置き場から写す物（Python の _share_files）→ [(相対の道, ファイル)]（名前の順）
pub fn share_files(share: &Path) -> Result<Vec<(String, PathBuf)>, Fail> {
    let mut out = vec![];
    let os = |e: io::Error, p: &Path| Fail::Os(e, Some(p.to_path_buf()));
    for e in std::fs::read_dir(share).map_err(|e| os(e, share))? {
        let e = e.map_err(|e| os(e, share))?;
        let name = e.file_name().to_string_lossy().into_owned();
        if name.ends_with(".json") && !name.starts_with('.') && name != LOCK_FILENAME && name != MOVED_FILENAME && entry_is_file(&e) {
            out.push((name, e.path()));
        }
    }
    let pres = share.join(PRESENCE_DIR);
    if COPY_PRESENCE && is_dir_e(&pres).map_err(|e| os(e, &pres))? {
        for e in std::fs::read_dir(&pres).map_err(|e| os(e, &pres))? {
            let e = e.map_err(|e| os(e, &pres))?;
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.starts_with('.') && (name == SETTINGS_FILE || name.ends_with(REVOKE_SUFFIX)) && entry_is_file(&e) {
                out.push((format!("{PRESENCE_DIR}/{name}"), e.path()));
            }
        }
        for sub in PRESENCE_TREES {
            walk_files(&pres.join(sub), &format!("{PRESENCE_DIR}/{sub}"), &mut out);
        }
    }
    out.sort();
    Ok(out)
}

/// この PC が読んでいるマスタ（共有するもの全部。Python の _docs）→ [(名前, 書く字)]
fn docs(store: &Store) -> Result<Vec<(String, Vec<u8>)>, Fail> {
    let mut out = vec![];
    for name in store.shared_names() {
        if store.is_shared(&name) {
            store.refresh(&name); // _read_doc の取り直し（届かなければ覚えるだけ）
        }
        let mirror = store.mirror(&name);
        let path = if store.is_shared(&name) && mirror.exists() { mirror } else { store.initial_file(&name) };
        let doc =
            if path.exists() { as_doc(read_json_j(&path).ok_or(Fail::Py)?).ok_or(Fail::Py)? } else { as_doc(J::Arr(vec![])).unwrap() };
        let has_rows = matches!(doc.get("rows"), Some(J::Arr(a)) if !a.is_empty());
        let in_share = match store.share_file(&name) {
            Some(p) => crate::release_place::py_stat(&p).map_err(|_| Fail::Py)?.is_some(),
            None => false,
        };
        if has_rows || store.bundled_file(&name).exists() || in_share {
            out.push((name, payload(&doc)));
        }
    }
    Ok(out)
}

/// 写す物（Python の _sources）→ (どこから〈share|mirror|local〉, 写す物)。共有に届けば共有のファイルそのもの（錠を持って読むので、
/// ほかの PC の直前の保存も入る）。届かなければこの PC の写し、手元のみなら data/
pub fn sources(store: &Store) -> Result<(&'static str, Vec<Item>), Fail> {
    if let Some(cur) = store.share_dir().filter(|_| store.share_reachable()) {
        let mut out = vec![];
        for (rel, p) in share_files(cur)? {
            match std::fs::metadata(&p) {
                Ok(m) => out.push(Item { rel, size: m.len(), path: Some(p), bytes: vec![] }),
                // 利用状況は錠の外でほかの PC が書く・片付ける。見つけた後に消えた物は写さない
                Err(e) if e.kind() == io::ErrorKind::NotFound && presence_rel(&rel) => {}
                Err(e) => return Err(Fail::Os(e, Some(p))),
            }
        }
        return Ok(("share", out));
    }
    let items =
        docs(store)?.into_iter().map(|(n, b)| Item { rel: format!("{n}.json"), size: b.len() as u64, path: None, bytes: b }).collect();
    Ok((if store.share_dir().is_some() { "mirror" } else { "local" }, items))
}

/// 共有のファイルを読む（試験は遅い共有を差し替える）
pub type Reader<'a> = &'a (dyn Fn(&Path) -> io::Result<Vec<u8>> + Sync);

pub fn read_file(p: &Path) -> io::Result<Vec<u8>> {
    std::fs::read(p)
}

/// そこに書けるか: 試しの一時フォルダを作って消す（Windows の os.access はフォルダの ACL を見ない）→ 書けなければ理由の字
fn can_write(folder: &Path, name: &str) -> String {
    let probe = folder.join(format!(".{name}.probe-{}", &crate::master_store::hex_id()[..8]));
    if let Err(e) = std::fs::create_dir(&probe) {
        return strerror(&e);
    }
    let _ = std::fs::remove_dir(&probe);
    String::new()
}

// ------------------------------------------------------------------ 確かめる（plan）

fn fail(problem: impl Into<String>) -> Value {
    json!({"ok": false, "problem": problem.into()})
}

fn fail_at(dest: &str, problem: impl Into<String>) -> Value {
    json!({"ok": false, "dest": dest, "problem": problem.into()})
}

/// \\サーバー だけか（Python の re.fullmatch(r"\\\\[^\\/]+", par)）
fn server_only(par: &str) -> bool {
    par.strip_prefix("\\\\").is_some_and(|r| !r.is_empty() && !r.contains(['\\', '/']))
}

/// plan: 新しい置き場（parent\name）へ変えられるか → {ok, mode: copy|switch, dest, files, bytes, names, caution, note} / {ok: false, problem}。
/// cwd は Python の今のフォルダ（相対の道の見方）。None は窓が Python と同じに答えられない形（Python に任せる）
pub fn plan(store: &Store, parent: &str, name: &str, cwd: &Path) -> Option<Value> {
    let nm = match check_name(name) {
        Ok(n) => n,
        Err(e) => return Some(fail(e)),
    };
    let par = drive_root(&crate::lists::unquote_path(parent));
    if par.is_empty() {
        return Some(fail("置く場所（上のフォルダ）を入れてください。"));
    }
    if server_only(&par) {
        return share_root(store, &par, &nm, cwd);
    }
    let p = py_path(&par);
    if !Path::new(&p).is_absolute() && !par.starts_with("\\\\") {
        return Some(fail("置く場所は、ドライブ（C:\\…）か共有（\\\\サーバー\\…）から書いてください。"));
    }
    if cfg!(windows) && crate::release_place::win_trims(&p) {
        return None; // Win32 が段の末尾の空白・「.」を削る道。Python に任せる
    }
    if !crate::release_place::py_is_dir(&at(cwd, &p)).ok()? {
        return Some(fail(format!("置く場所に届きません: {par}（フォルダがあるか・つながっているかを確かめてください）")));
    }
    let dest = join_for(&p, &nm, cfg!(windows));
    if let Some(cur) = store.share_dir().map(|c| c.to_string_lossy().into_owned()) {
        if same(&dest, &cur, cwd)? {
            return Some(fail_at(&dest, "いまの置き場と同じです。"));
        }
        if inside(&dest, &cur, cwd)? {
            return Some(fail_at(&dest, "いまの置き場の中には置けません。"));
        }
    }
    let d = at(cwd, &dest);
    let found = (|| -> io::Result<Option<Value>> {
        match std::fs::metadata(&d) {
            Err(e) if ignorable(&e) => return Ok(None),
            Err(e) => return Err(e),
            Ok(_) => {}
        }
        if !is_dir_e(&d)? {
            return Ok(Some(fail_at(&dest, "同じ名前のファイルがあります。別の名前にしてください。")));
        }
        if is_master_place(&d)? {
            return Ok(Some(json!({"ok": true, "mode": "switch", "dest": dest, "files": 0, "bytes": 0, "caution": sync_caution(&dest),
                                  "note": "既にマスタがある置き場です。写さずに切り替えます（その置き場のマスタを使います）。"})));
        }
        if std::fs::read_dir(&d)?.next().transpose()?.is_some() {
            return Ok(Some(fail_at(&dest, "フォルダが空ではなく、マスタもありません。空のフォルダか、新しい名前にしてください。")));
        }
        Ok(None)
    })();
    match found {
        Ok(Some(v)) => return Some(v),
        Ok(None) => {}
        Err(e) => return Some(fail_at(&dest, unreadable(&e))),
    }
    let why = can_write(&at(cwd, &p), &nm);
    if !why.is_empty() {
        return Some(fail_at(&dest, format!("置く場所に書き込めません: {par}（{why}）")));
    }
    let (place, items) = match sources(store) {
        Ok(x) => x,
        Err(Fail::Py) => return None,
        Err(Fail::Os(e, _)) => return Some(fail_at(&dest, format!("いまの置き場を読めません（{}）。", strerror(&e)))),
    };
    let note = match place {
        "share" => format!("共有の置き場のマスタを写してから切り替えます。{}", if COPY_PRESENCE { RECORDS_NOTE } else { "" }),
        "mirror" => {
            "共有の置き場に届かないので、この PC の写しから写して切り替えます（ほかの PC の最近の保存が入らないことがあります）。".into()
        }
        _ => "この PC（手元のみ）のマスタを写してから切り替えます。".into(),
    };
    let mut names: Vec<String> = items
        .iter()
        .filter(|i| !i.rel.contains('/'))
        .map(|i| i.rel.chars().take(i.rel.chars().count().saturating_sub(5)).collect())
        .collect();
    names.sort();
    Some(json!({"ok": true, "mode": "copy", "dest": dest, "files": items.len(), "bytes": items.iter().map(|i| i.size).sum::<u64>(),
                "names": names, "caution": sync_caution(&dest), "note": note}))
}

/// 上のフォルダがサーバーだけ（\\サーバー）＝置き場が共有の根（\\サーバー\共有）。既にマスタがある置き場へ切り替えるだけができる
fn share_root(store: &Store, server: &str, name: &str, cwd: &Path) -> Option<Value> {
    let dest = py_path(&format!("{server}\\{name}"));
    let found = match is_master_place(&at(cwd, &dest)) {
        Ok(f) => f,
        Err(e) => return Some(fail_at(&dest, unreadable(&e))),
    };
    if !found {
        return Some(fail_at(
            &dest,
            format!("共有の根（{dest}）には、既にマスタがある置き場へ切り替えることだけができます。写して作るときは、共有の中のフォルダを置く場所に選んでください。"),
        ));
    }
    if let Some(cur) = store.share_dir().map(|c| c.to_string_lossy().into_owned()) {
        if same(&dest, &cur, cwd)? {
            return Some(fail_at(&dest, "いまの置き場と同じです。"));
        }
    }
    Some(json!({"ok": true, "mode": "switch", "dest": dest, "files": 0, "bytes": 0, "caution": sync_caution(&dest),
                "note": "既にマスタがある置き場です。写さずに切り替えます（その置き場のマスタを使います）。"}))
}

// ------------------------------------------------------------------ 変える（move）

/// 写すのが止まった（ValueError の理由）か、窓が答えない（Python に任せる）か、書く係が断った（錠など）か
pub enum MoveError {
    Invalid(String),
    Master(MasterError),
    Py,
}

fn copy_into(tmp: &Path, items: &[&Item], read: Reader, done: &mut (u64, u64), deadline: Option<(Instant, &str)>) -> Result<(), MoveError> {
    let bad = |e: io::Error, p: &Path| MoveError::Invalid(format!("写せませんでした: {}", os_error(&e, Some(p), None)));
    for it in items {
        let data = match &it.path {
            Some(p) => match read(p) {
                Ok(d) => d,
                Err(e) if e.kind() == io::ErrorKind::NotFound && presence_rel(&it.rel) => continue,
                Err(e) => return Err(bad(e, p)),
            },
            None => it.bytes.clone(),
        };
        let target = it.rel.split('/').fold(tmp.to_path_buf(), |p, s| p.join(s));
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| bad(e, parent))?;
        }
        std::fs::write(&target, &data).map_err(|e| bad(e, &target))?;
        done.0 += 1;
        done.1 += data.len() as u64;
        if let Some((end, why)) = deadline {
            if Instant::now() > end {
                return Err(MoveError::Invalid(why.into()));
            }
        }
    }
    Ok(())
}

fn sigs(items: &[&Item]) -> Vec<(String, Option<(u128, u64)>)> {
    items.iter().filter_map(|i| i.path.as_ref().map(|p| (i.rel.clone(), crate::master_store::stat_sig(p)))).collect()
}

/// 置き場を変えた覚え（Python の retarget(persist=True, chosen=True)。この PC の作業場所の master_share.json）
fn remember(store: &Store, old: Option<&str>, new: &str) -> io::Result<()> {
    let now = iso(now_local());
    let who = J::from_value(&store.who());
    let path = store.local_root().join(OVERRIDE_FILENAME);
    let mut hist = vec![J::Obj(vec![
        ("dir".into(), J::Str(old.unwrap_or("").into())),
        ("until".into(), J::Str(now.clone())),
        ("by".into(), who.clone()),
    ])];
    if let Some(J::Obj(o)) = read_json_j(&path) {
        if let Some((_, J::Arr(h))) = o.iter().rev().find(|(k, _)| k == "history") {
            hist.extend(h.iter().filter(|x| x.is_obj()).cloned());
        }
    }
    hist.truncate(HISTORY_KEEP);
    let doc = J::Obj(vec![
        ("dir".into(), J::Str(new.into())),
        ("at".into(), J::Str(now.clone())),
        ("by".into(), who),
        ("history".into(), J::Arr(hist)),
        ("chosenAt".into(), J::Str(now)),
    ]);
    let mut body = doc.dumps(Some(2));
    body.push('\n');
    write_bytes_atomic(&path, body.as_bytes())
}

/// 置き場を変える（plan が通るときだけ）→ plan の答え＋{from}（と warning）。read は共有のファイルの読み方（試験は遅い共有を差し替える）
pub fn move_to(store: &Store, parent: &str, name: &str, cwd: &Path, read: Reader) -> Result<Value, MoveError> {
    let mut pl = plan(store, parent, name, cwd).ok_or(MoveError::Py)?;
    if pl["ok"] != json!(true) {
        return Err(MoveError::Invalid(pl["problem"].as_str().unwrap_or("").into()));
    }
    let dest = pl["dest"].as_str().unwrap_or("").to_string();
    let destp = at(cwd, &dest);
    let mut done = (0u64, 0u64);
    let mut tmp = None;
    if pl["mode"] == "copy" {
        let dname = destp.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let t = destp.parent().unwrap_or(Path::new(".")).join(format!(".{dname}.tmp-{}", &crate::master_store::hex_id()[..8]));
        if let Err(e) = std::fs::create_dir(&t) {
            return Err(MoveError::Invalid(format!("写せませんでした: {}", os_error(&e, Some(&t), None))));
        }
        tmp = Some(t.clone());
        let first = (|| {
            let (_, items) = sources(store).map_err(|f| match f {
                Fail::Py => MoveError::Py,
                f => MoveError::Invalid(format!("写せませんでした: {}", f.text())),
            })?;
            let pres: Vec<&Item> = items.iter().filter(|i| presence_rel(&i.rel)).collect();
            copy_into(&t, &pres, read, &mut done, None)
        })();
        if let Err(e) = first {
            let _ = std::fs::remove_dir_all(&t);
            return Err(e);
        }
    }
    struct Clean(Option<PathBuf>);
    impl Drop for Clean {
        fn drop(&mut self) {
            if let Some(t) = &self.0 {
                if t.exists() {
                    let _ = std::fs::remove_dir_all(t); // 途中で止めたときの片付け（名前を付けた後は無い）
                }
            }
        }
    }
    let _clean = Clean(tmp.clone());
    let mut inner = Err(MoveError::Py);
    let r = store.exclusive(|| {
        inner = locked(store, &mut pl, tmp.as_deref(), &mut done, &dest, &destp, cwd, read);
        Ok(())
    });
    if let Err(e) = r {
        return Err(MoveError::Master(e));
    }
    inner.map(|_| pl)
}

#[allow(clippy::too_many_arguments)]
fn locked(
    store: &Store,
    pl: &mut Value,
    tmp: Option<&Path>,
    done: &mut (u64, u64),
    dest: &str,
    destp: &Path,
    cwd: &Path,
    read: Reader,
) -> Result<(), MoveError> {
    let old = store.share_dir().map(|p| p.to_path_buf());
    if let Some(tmp) = tmp {
        let slow = format!(
            "共有が遅く、錠の長さ（{} 秒）の半分のうちにマスタを写し終えられませんでした。前の置き場のまま変えていません。\
             共有が空いているときに、もう一度やり直してください。",
            py_g(store.lock_ttl())
        );
        let end = Instant::now() + Duration::from_secs_f64(store.lock_ttl() * LOCK_SHARE);
        let os = |e: io::Error, a: &Path, b: Option<&Path>| MoveError::Invalid(format!("写せませんでした: {}", os_error(&e, Some(a), b)));
        // **錠を取ってから**読み直す（plan の後にほかの PC が保存した分も写す）
        let (place, items) = sources(store).map_err(|f| match f {
            Fail::Py => MoveError::Py,
            f => MoveError::Invalid(format!("写せませんでした: {}", f.text())),
        })?;
        let masters: Vec<&Item> = items.iter().filter(|i| !presence_rel(&i.rel)).collect();
        let before = sigs(&masters);
        copy_into(tmp, &masters, read, done, Some((end, &slow)))?;
        if place == "share" {
            let now_names: Vec<String> = match old.as_deref().map(share_files) {
                Some(Ok(v)) => v.into_iter().map(|(r, _)| r).filter(|r| !presence_rel(r)).collect(),
                Some(Err(f)) => return Err(MoveError::Invalid(format!("写せませんでした: {}", f.text()))),
                None => vec![],
            };
            let mut had: Vec<String> = masters.iter().map(|i| i.rel.clone()).collect();
            had.sort();
            if sigs(&masters) != before || now_names != had {
                return Err(MoveError::Invalid(
                    "写している間に、ほかの PC がマスタを保存しました（錠の長さを超えた）。前の置き場のまま変えていません。もう一度やり直してください。"
                        .into(),
                ));
            }
        }
        if Instant::now() > end {
            return Err(MoveError::Invalid(slow));
        }
        pl["files"] = json!(done.0);
        pl["bytes"] = json!(done.1);
        if destp.exists() {
            std::fs::remove_dir(destp).map_err(|e| os(e, destp, None))?; // plan で空と確かめた
        }
        std::fs::rename(tmp, destp).map_err(|e| os(e, tmp, Some(destp)))?;
    }
    // 戻した先（前に使っていた置き場）に残っている引っ越し先の印は、もう古い（残すとほかの PC がたどって輪になる）
    match std::fs::remove_file(destp.join(MOVED_FILENAME)) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(_) => pl["warning"] = json!(format!("切り替えた置き場（{dest}）に残っていた前の引っ越し先の印を消せませんでした。")),
    }
    let old_s = old.as_ref().map(|p| p.to_string_lossy().into_owned());
    if let Err(e) = remember(store, old_s.as_deref(), dest) {
        // Python の retarget は書けないと例外（500）。窓は理由を返して前の置き場のまま（写した置き場は残る）
        return Err(MoveError::Invalid(format!("この PC に新しい置き場を覚えられませんでした: {}", os_error(&e, None, None))));
    }
    if let Some(o) = old_s.as_deref() {
        let op = at(cwd, o);
        if op.is_dir() && same(o, dest, cwd) != Some(true) {
            let mark = J::Obj(vec![
                ("to".into(), J::Str(dest.into())),
                ("at".into(), J::Str(iso(now_local()))),
                ("by".into(), J::from_value(&store.who())),
            ]);
            let mut body = mark.dumps(Some(2));
            body.push('\n');
            if write_bytes_atomic(&op.join(MOVED_FILENAME), body.as_bytes()).is_err() {
                pl["warning"] = json!(format!(
                    "前の置き場（{o}）に引っ越し先の印を置けませんでした。ほかの PC では「置き場を変える」で {dest} を選んでください。"
                ));
            }
        }
    }
    pl["from"] = json!(old_s.unwrap_or_default());
    Ok(())
}

// ------------------------------------------------------------------ 置き場の状態（status・place）

/// 置き場の状態の材料のうち、書く係の外にある物（配った設定の置き場・この PC の覚え・配る版の覚え）
#[derive(Debug, Clone, Default)]
pub struct Local {
    /// 設定ファイルの master_share.dir（展開した字。無ければ ""）
    pub configured: String,
    /// この PC の作業場所（master_share.json・want.json）
    pub root: PathBuf,
}

impl Local {
    fn override_doc(&self) -> Option<Map<String, Value>> {
        let b = std::fs::read(self.root.join(OVERRIDE_FILENAME)).ok()?;
        let b = b.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&b);
        match serde_json::from_slice::<Value>(b).ok()? {
            Value::Object(o) => Some(o),
            _ => None,
        }
    }

    /// 配る版の覚えにある、全員が使うマスタの置き場（Python の pinned）
    pub fn pin(&self) -> Value {
        let Ok(b) = std::fs::read(self.root.join(PIN_FILENAME)) else { return Value::Null };
        let b = b.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&b);
        match serde_json::from_slice::<Value>(b) {
            Ok(Value::Object(o)) => match o.get("masters") {
                Some(m @ Value::Object(mo)) if !crate::pyfmt::strip(&mo.get("dir").map(py_str).unwrap_or_default()).is_empty() => m.clone(),
                _ => Value::Null,
            },
            _ => Value::Null,
        }
    }

    /// この PC が前に使っていた置き場（新しい順。Python の history）
    pub fn history(&self) -> Vec<Value> {
        match self.override_doc().and_then(|o| o.get("history").cloned()) {
            Some(Value::Array(a)) => a.into_iter().filter(Value::is_object).collect(),
            _ => vec![],
        }
    }
}

/// 試験だけ: その置き場で共有を見るのにかかる時間を足す（遅い共有・届かない SMB の形。製品では None）
#[doc(hidden)]
pub static TEST_SLOW: Mutex<Option<(PathBuf, u64)>> = Mutex::new(None);

/// MasterStore.status（peek は共有を見ない）。種まきの要る形・読めないマスタは None（Python に任せる）
fn status_of(store: &Store, local: &Local, peek: bool) -> Option<Value> {
    let shared = store.share_dir().is_some();
    let mut out = json!({"mode": if shared { "shared" } else { "local" },
                         "dir": store.share_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
                         "configured": local.configured, "override": local.root.join(OVERRIDE_FILENAME).exists(), "pin": local.pin(),
                         "who": store.who(), "masters": {}});
    if shared && !peek {
        let slow = TEST_SLOW.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let Some((dir, ms)) = slow.filter(|(d, _)| Some(d.as_path()) == store.share_dir()) {
            let _ = dir;
            std::thread::sleep(Duration::from_millis(ms)); // 試験だけ: 遅い共有の形（その置き場だけ）
        }
        if store.needs_seed(&STATUS_NAMES) {
            return None; // 種まき（共有へ最初の版を書く）は Python の係（版 3.101.0 の主のセッションの決め）
        }
        for n in STATUS_NAMES.iter().filter(|n| store.is_shared(n)) {
            store.refresh(n);
        }
        let reachable = store.share_reachable();
        out["reachable"] = json!(reachable);
        out["lock"] = if reachable { store.lock_status().unwrap_or(Value::Null) } else { Value::Null };
    }
    if shared {
        let (sync, error) = store.sync_state();
        out["last_sync"] = json!(sync);
        out["error"] = json!(error);
    }
    for n in STATUS_NAMES {
        let (doc, src) = store.read_doc(n, true).ok()?;
        out["masters"][n] = json!({"revision": doc.revision, "rows": doc.rows.len(), "updated_at": doc.updated_at,
                                   "updated_by": doc.updated_by, "source": src});
    }
    Some(out)
}

/// 同じ置き場へ尋ねている糸（1 本まで）
/// 糸の答えを置く所（None はまだ。Some(None) は窓が答えない形）
type Slot<T> = Arc<Mutex<Option<Option<T>>>>;
static PROBES: LazyLock<Mutex<HashMap<String, Slot<Value>>>> = LazyLock::new(Default::default);

/// GET /api/masters/status の答え（Python の master_place.status）。共有を見るのは SHARE_PROBE_SEC まで（終わらなければ reachable null）
pub fn status(store: &Arc<Store>, local: &Local) -> Option<Value> {
    let Some(dir) = store.share_dir().map(|d| d.to_string_lossy().into_owned()) else {
        let mut st = status_of(store, local, false)?;
        st["caution"] = json!("");
        return Some(st);
    };
    let got = {
        let mut probes = PROBES.lock().unwrap_or_else(|e| e.into_inner());
        let busy = probes.get(&dir).is_some_and(|b| b.lock().unwrap_or_else(|e| e.into_inner()).is_none());
        if busy {
            None // 前の糸がまだ終わっていない（届かない共有へ尋ねるたびに糸を積まない）
        } else {
            let slot = Arc::new(Mutex::new(None));
            probes.insert(dir.clone(), slot.clone());
            let (st, lc, sl) = (store.clone(), local.clone(), slot.clone());
            std::thread::spawn(move || {
                let v = status_of(&st, &lc, false);
                *sl.lock().unwrap_or_else(|e| e.into_inner()) = Some(v);
            });
            Some(slot)
        }
    };
    let end = Instant::now() + Duration::from_secs_f64(SHARE_PROBE_SEC);
    let mut answer = None;
    if let Some(slot) = got {
        loop {
            if let Some(v) = slot.lock().unwrap_or_else(|e| e.into_inner()).clone() {
                answer = Some(v);
                break;
            }
            if Instant::now() >= end {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    let mut st = match answer {
        Some(v) => v?,
        None => {
            let mut st = status_of(store, local, true)?;
            st["reachable"] = Value::Null;
            st["lock"] = Value::Null;
            st["error"] = json!(format!(
                "共有の置き場が {} 秒で答えません（確かめています。前に取り込んだ写しで表示しています）: {dir}",
                py_g(SHARE_PROBE_SEC)
            ));
            st
        }
    };
    st["caution"] = json!(if st["mode"] == "shared" { sync_caution(st["dir"].as_str().unwrap_or("")) } else { String::new() });
    Some(st)
}

/// 置き場ごとに、いま使っている PC → [{dir, reachable, pcs}]。届くかはまとめて SHARE_PROBE_SEC まで（終わらなければ reachable null）
pub fn using(dirs: &[String], now: chrono::NaiveDateTime) -> Vec<Value> {
    let mut rows: Vec<String> = vec![];
    let mut seen: Vec<String> = vec![];
    for d in dirs {
        let key = d.replace('/', "\\").trim_end_matches('\\').to_lowercase();
        if d.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.push(key);
        rows.push(d.clone());
    }
    let boxes: Vec<Slot<Vec<Value>>> = rows.iter().map(|_| Arc::new(Mutex::new(None))).collect();
    for (d, b) in rows.iter().zip(&boxes) {
        let (d, b) = (PathBuf::from(d), b.clone());
        std::thread::spawn(move || {
            let pcs = crate::presence::online_in(&d, now);
            *b.lock().unwrap_or_else(|e| e.into_inner()) = Some(pcs);
        });
    }
    let end = Instant::now() + Duration::from_secs_f64(SHARE_PROBE_SEC);
    while Instant::now() < end && boxes.iter().any(|b| b.lock().unwrap_or_else(|e| e.into_inner()).is_none()) {
        std::thread::sleep(Duration::from_millis(5));
    }
    rows.iter()
        .zip(&boxes)
        .map(|(d, b)| match b.lock().unwrap_or_else(|e| e.into_inner()).clone() {
            Some(pcs) => json!({"dir": d, "reachable": pcs.is_some(), "pcs": pcs.unwrap_or_default()}),
            None => json!({"dir": d, "reachable": null, "pcs": []}),
        })
        .collect()
}

/// GET /api/masters/place の答え（Python の master_place_get）
pub fn place_answer(store: &Arc<Store>, local: &Local, me: &Result<Value, String>, now: chrono::NaiveDateTime) -> Option<Value> {
    let s = status(store, local)?;
    let denied = crate::release_place::gate(me);
    let history = local.history();
    let mut dirs = vec![
        s["pin"].get("dir").filter(|v| crate::worksum::truthy(v)).map(py_str).unwrap_or_default(),
        store.share_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
    ];
    dirs.extend(history.iter().map(|h| h.get("dir").filter(|v| crate::worksum::truthy(v)).map(py_str).unwrap_or_default()));
    Some(json!({"mode": s["mode"], "dir": s["dir"], "configured": s["configured"], "override": s["override"],
                "reachable": s.get("reachable").cloned().unwrap_or(json!(true)), "history": history, "pin": s["pin"],
                "using": using(&dirs, now), "canChange": denied.is_none(),
                "why": denied.map(|(_, v)| v["error"].clone()).unwrap_or(json!(""))}))
}

// ------------------------------------------------------------------ 道

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Status,
    Place,
    Check,
    Move,
}

pub fn route_of(method: &str, path: &str) -> Option<Route> {
    match (method, path) {
        ("GET", "/api/masters/status") => Some(Route::Status),
        ("GET", "/api/masters/place") => Some(Route::Place),
        ("POST", "/api/masters/place/check") => Some(Route::Check),
        ("POST", "/api/masters/place/move") => Some(Route::Move),
        _ => None,
    }
}

/// 本文の parent・name（Python の _master_place_args: b.get("parent", "")・b.get("name", "")。どちらも str(x or "") で読まれる）。
/// 窓が同じ字にできない値（並び・表）・表でない真の本文は None
fn args_of(body: &[u8]) -> Option<(String, String)> {
    let a = crate::release_place::args_of(body)?;
    Some((a.parent, a.name))
}

/// 4 本の答え。None は Python に任せる（?engine=python も。move は製品では Python が断る: 写す係は窓の 1 つ）
pub fn handle(
    route: Route,
    query: &str,
    body: &[u8],
    store: &Arc<Store>,
    local: &Local,
    me: &dyn Fn() -> Result<Value, String>,
    cwd: &Path,
) -> Option<(u16, Value)> {
    if crate::lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
        return None;
    }
    match route {
        Route::Status => status(store, local).map(|v| (200, v)),
        Route::Place => place_answer(store, local, &me(), now_local()).map(|v| (200, v)),
        Route::Check => {
            let (parent, name) = args_of(body)?;
            plan(store, &parent, &name, cwd).map(|v| (200, v))
        }
        Route::Move => {
            if let Some(no) = crate::release_place::gate(&me()) {
                return Some(no);
            }
            let (parent, name) = args_of(body)?;
            match move_to(store, &parent, &name, cwd, &read_file) {
                Ok(v) => Some((200, v)),
                Err(MoveError::Invalid(m)) => Some((400, json!({"error": m, "kind": "invalid"}))),
                Err(MoveError::Master(e)) => Some((e.status(), e.payload())),
                Err(MoveError::Py) => None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_and_drive() {
        assert_eq!(sync_folder("C:\\Users\\u\\OneDrive - 会社\\M"), "OneDrive");
        assert_eq!(sync_folder("\\\\srv\\box\\M"), "");
        assert_eq!(drive_root("C:"), "C:\\");
        assert_eq!(drive_root("字:"), "字:");
        assert!(server_only("\\\\srv") && !server_only("\\\\srv\\s") && !server_only("\\\\"));
        for (f, w) in
            [(20.0, "20"), (1.0, "1"), (0.5, "0.5"), (2.0, "2"), (1234567.0, "1.23457e+06"), (0.0001, "0.0001"), (1.5e-5, "1.5e-05")]
        {
            assert_eq!(py_g(f), w);
        }
    }

    #[test]
    fn a_slow_share_is_checking_not_down() {
        // 共有が SHARE_PROBE_SEC で答えなければ、写しで答えて reachable は null（確かめ中。保存の手は止めない）。false にしない。
        // 前の糸が終わるまでは新しい糸を起こさない（尋ねるたびに積まない）。終われば届くと答える
        let d = std::env::temp_dir().join(format!("da-mplace-slow-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let share = d.join("share");
        std::fs::create_dir_all(&share).unwrap();
        std::fs::create_dir_all(d.join("local")).unwrap();
        for n in STATUS_NAMES {
            std::fs::write(share.join(format!("{n}.json")), r#"{"schema": 1, "revision": 2, "rows": [{"id": 1}]}"#).unwrap();
        }
        let conf = json!({"who": {"pc": "P", "login": "u"}, "place": {"shareDir": share, "data": d.join("data"), "defaults": d.join("defaults"),
                          "cache": d.join("local").join("master_cache"), "shared": STATUS_NAMES, "lockTtl": 20.0}});
        let store = Arc::new(Store::from_access(&conf, "rs").unwrap());
        let local = Local { configured: String::new(), root: d.join("local") };
        *TEST_SLOW.lock().unwrap() = Some((share.clone(), 3500));
        let t0 = Instant::now();
        let v = status(&store, &local).unwrap();
        let took = t0.elapsed().as_secs_f64();
        assert!((SHARE_PROBE_SEC..SHARE_PROBE_SEC + 1.0).contains(&took), "区切った秒で答える: {took}");
        assert_eq!((v["reachable"].clone(), v["lock"].clone()), (Value::Null, Value::Null), "{v}");
        assert!(v["error"].as_str().unwrap().starts_with("共有の置き場が 2 秒で答えません（確かめています。"), "{v}");
        assert_eq!(v["masters"]["tab_access"]["source"], "bundled-fallback", "写しがまだ無ければ同梱の物で答える");
        let t1 = Instant::now();
        let v2 = status(&store, &local).unwrap();
        assert!(t1.elapsed().as_secs_f64() < 0.5 && v2["reachable"].is_null(), "前の糸が終わるまでは待たずに写しで答える");
        std::thread::sleep(Duration::from_millis(1800));
        *TEST_SLOW.lock().unwrap() = None;
        let v3 = status(&store, &local).unwrap();
        assert_eq!((v3["reachable"].clone(), v3["masters"]["tab_access"]["revision"].clone()), (json!(true), json!(2)), "{v3}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn docs_keep_the_order_and_count_what_is_written() {
        let d = as_doc(crate::pyjson::loads(r#"{"rows": [{"b": 1, "a": "字"}], "revision": 3, "updated_by": null}"#).unwrap()).unwrap();
        let b = String::from_utf8(payload(&d)).unwrap();
        assert_eq!(
            b,
            "{\n \"schema\": 1,\n \"revision\": 3,\n \"updated_at\": \"\",\n \"updated_by\": {},\n \"rows\": [\n  {\n   \"b\": 1,\n   \"a\": \"字\"\n  }\n ]\n}\n"
        );
        assert!(as_doc(crate::pyjson::loads(r#"{"rows": [], "revision": "3"}"#).unwrap()).is_none(), "int(\"3\") は Python に任せる");
    }
}
