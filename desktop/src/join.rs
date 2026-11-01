//! データ元の結合（版 3.60.0 で Python の app/services/data_join.py から移した。決まり・答えのファイル・数は同じ）。
//!
//! あるデータ元の表に、ほかのデータ元の列を、自由に組んだ鍵（1 つ以上の「この列 = 相手の列」）で合わせる。
//! 写し（手元のファイル）どうしを合わせた答えを、この PC の作業場所の db_cache/joins に 1 つのファイルとして組み、
//! 一覧・スライサーは今までと同じ仕組みでそのファイルを読む。元の写しのどれかが変わった（大きさ・時刻）・決まりが変わったときだけ組み直す。
//! 答えのファイルの名前・覚え（.json）は Python と同じ形なので、どちらが組んだ物も互いに使い回す（集計表・ダッシュボードは Python が読む）。

use crate::lotlist::{qi, sort_key, sql_err};
use crate::pyfmt::{self, Py};
use crate::worksum::normalize_part;
use rusqlite::functions::FunctionFlags;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// 当たらなかった鍵の見本の数
const SAMPLE: usize = 5;
/// 相手の行がこれより多いときは「相手の当たった数」を数えない（重い）
const RIGHT_HIT_LIMIT: i64 = 200_000;

/// 結合の決まり 1 つ（Python の parse の形: {with, how, on: [[この列, 相手の列]], cols}）
#[derive(Debug, Clone)]
pub struct Join {
    pub with: String,
    pub how: String,
    pub on: Vec<(String, String)>,
    pub cols: Vec<String>,
}

impl Join {
    /// 決まりの並び（JSON）→ Join の並び。形の合わない物は飛ばす（Python の parse で整えた後の形を受ける）
    pub fn list(v: &Value) -> Vec<Join> {
        v.as_array()
            .into_iter()
            .flatten()
            .filter_map(|j| {
                let s = |x: &Value| x.as_str().map(|t| pyfmt::strip(t).to_string()).unwrap_or_default();
                let on = j["on"]
                    .as_array()?
                    .iter()
                    .filter_map(|p| Some((s(p.get(0)?), s(p.get(1)?))))
                    .filter(|(a, b)| !a.is_empty() && !b.is_empty())
                    .collect();
                let how = j["how"].as_str().filter(|h| ["left", "inner", "right", "full"].contains(h)).unwrap_or("left");
                Some(Join {
                    with: s(&j["with"]),
                    how: how.into(),
                    on,
                    cols: j["cols"].as_array().into_iter().flatten().map(s).filter(|c| !c.is_empty()).collect(),
                })
            })
            .collect()
    }

    fn json(&self) -> Value {
        json!({"with": self.with, "how": self.how, "on": self.on.iter().map(|(a, b)| json!([a, b])).collect::<Vec<_>>(), "cols": self.cols})
    }
}

/// 結合の決まりが表に合わない（列が無い・表が無い）。理由は利用者に見せる言葉
#[derive(Debug)]
pub enum JoinError {
    Rule(String),
    Other(String),
}

impl std::fmt::Display for JoinError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JoinError::Rule(s) | JoinError::Other(s) => f.write_str(s),
        }
    }
}

fn other(e: rusqlite::Error) -> JoinError {
    JoinError::Other(sql_err(e))
}

/// 鍵の比べ方（SQL では JoinKey(列)）: 一覧の「同じ値」（SortKey）と同じ考え。空欄は NULL（どれにも当たらない）、
/// 数と数に読める字は数（" 54"・"054"・54.0 は同じ "54"）、字は NFKC・前後の空白を除く・大文字
pub fn join_key(v: &Py) -> Option<String> {
    match sort_key(v) {
        SqlValue::Null => None,
        SqlValue::Real(f) if f.is_finite() && f.fract() == 0.0 => Some(if f == 0.0 { "0".into() } else { format!("{f:.0}") }),
        SqlValue::Real(f) => Some(pyfmt::float_repr(f)),
        SqlValue::Integer(i) => Some(i.to_string()),
        SqlValue::Text(s) => Some(normalize_part(&s)).filter(|k| !k.is_empty()),
        SqlValue::Blob(_) => None,
    }
}

fn py_of(v: ValueRef<'_>) -> Py<'_> {
    match v {
        ValueRef::Null => Py::None,
        ValueRef::Integer(i) => Py::Int(i),
        ValueRef::Real(f) => Py::Float(f),
        ValueRef::Text(t) => Py::Text(std::str::from_utf8(t).unwrap_or("")),
        ValueRef::Blob(b) => Py::Blob(b),
    }
}

/// path を SQLite の URI（file:…?mode=ro）にする（ATTACH は主の接続を URI で開いたときだけ URI と読む）
pub fn ro_uri(path: &Path) -> String {
    let abs = if path.is_absolute() { path.to_path_buf() } else { std::env::current_dir().unwrap_or_default().join(path) };
    let text = abs.to_string_lossy().replace('\\', "/");
    let mut out = String::from("file:");
    if !text.starts_with('/') {
        out.push_str("///"); // C:/… → file:///C:/…
    } else if !text.starts_with("//") {
        out.push_str("//");
    }
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~/:".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out + "?mode=ro"
}

fn columns(c: &Connection, schema: &str, table: &str) -> Result<Vec<String>, JoinError> {
    let mut st = c.prepare(&format!("PRAGMA {schema}.table_info({})", qi(table))).map_err(other)?;
    let rows = st.query_map([], |r| r.get::<_, String>(1)).map_err(other)?;
    rows.collect::<Result<_, _>>().map_err(other)
}

fn count(c: &Connection, sql: &str) -> Result<i64, JoinError> {
    c.query_row(sql, [], |r| r.get::<_, i64>(0)).map_err(other)
}

/// 持ってくる相手の列（並びは相手の表の並び）。指定が無ければ、鍵の相手の列を除いた全部
fn brought(j: &Join, right_cols: &[String]) -> Vec<String> {
    if !j.cols.is_empty() {
        let want: HashSet<&String> = j.cols.iter().collect();
        return right_cols.iter().filter(|c| want.contains(c)).cloned().collect();
    }
    let keys: HashSet<&String> = j.on.iter().map(|(_, b)| b).collect();
    right_cols.iter().filter(|c| !keys.contains(c)).cloned().collect()
}

/// 出す列の名前（同じ名前があれば「列（相手の名前）」・それもあれば番号）
fn out_name(col: &str, taken: &HashSet<String>, side: &str) -> String {
    if !taken.contains(col) {
        return col.into();
    }
    let mut name = format!("{col}（{side}）");
    let mut n = 2;
    while taken.contains(&name) {
        name = format!("{col}（{side}{n}）");
        n += 1;
    }
    name
}

fn json_of(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::from(format!("（バイナリ {} バイト）", b.len())),
    }
}

/// 一時表 acc に相手の表 rt を 1 つ合わせる（Python の _step と同じ SQL）。→ (新しい一時表, 列)。stats に数を足す
#[allow(clippy::too_many_arguments)]
fn step(
    c: &Connection,
    acc: &str,
    acc_cols: &[String],
    j: &Join,
    rt: &str,
    right_cols: &[String],
    side: &str,
    stats: &mut Vec<Value>,
) -> Result<(String, Vec<String>), JoinError> {
    let missing: Vec<&str> = j.on.iter().filter(|(a, _)| !acc_cols.contains(a)).map(|(a, _)| a.as_str()).collect();
    if !missing.is_empty() {
        return Err(JoinError::Rule(format!("「{side}」との鍵の列「{}」がこの元にありません。", missing.join("・"))));
    }
    let missing: Vec<&str> = j.on.iter().filter(|(_, b)| !right_cols.contains(b)).map(|(_, b)| b.as_str()).collect();
    if !missing.is_empty() {
        return Err(JoinError::Rule(format!("鍵の相手の列「{}」が「{side}」にありません。", missing.join("・"))));
    }
    let bring = brought(j, right_cols);
    let n = stats.len();
    let ks: Vec<String> = (0..j.on.len()).map(|i| format!("_k{i}")).collect();
    let (rk, out) = (format!("_tpa_r{n}"), format!("_tpa_acc{}", n + 1));
    // 相手: 鍵を比べ方の値にした一時表と索引
    let mut carry: Vec<String> = vec![];
    for col in bring.iter().chain(j.on.iter().map(|(_, b)| b)) {
        if !carry.contains(col) {
            carry.push(col.clone());
        }
    }
    let keys_sel = j.on.iter().zip(&ks).map(|((_, b), k)| format!("JoinKey({}) AS {k}", qi(b))).collect::<Vec<_>>().join(", ");
    let carry_sel = carry.iter().map(|col| format!("{} AS {}", qi(col), qi(&format!("r_{col}")))).collect::<Vec<_>>().join(", ");
    let sel = if carry.is_empty() && j.on.is_empty() { keys_sel } else { format!("{keys_sel}, {carry_sel}") };
    c.execute_batch(&format!("CREATE TEMP TABLE {rk} AS SELECT {sel} FROM r{n}.{}", qi(rt))).map_err(other)?;
    c.execute_batch(&format!("CREATE INDEX temp.{rk}_ix ON {rk}({})", ks.join(", "))).map_err(other)?;
    let mut taken: HashSet<String> = acc_cols.iter().cloned().collect();
    let mut names = vec![];
    for col in &bring {
        let nm = out_name(col, &taken, side);
        taken.insert(nm.clone());
        names.push(nm);
    }
    let cond = j.on.iter().zip(&ks).map(|((a, _), k)| format!("JoinKey(a.{}) = r.{k}", qi(a))).collect::<Vec<_>>().join(" AND ");
    let key_of: HashMap<&String, &String> = j.on.iter().map(|(a, b)| (a, b)).collect();
    let left_sel = acc_cols.iter().map(|col| format!("a.{0} AS {0}", qi(col))).collect::<Vec<_>>().join(", ");
    let right_sel =
        bring.iter().zip(&names).map(|(col, nm)| format!("r.{} AS {}", qi(&format!("r_{col}")), qi(nm))).collect::<Vec<_>>().join(", ");
    let sel = if right_sel.is_empty() { left_sel } else { format!("{left_sel}, {right_sel}") };
    let kind = if j.how == "inner" || j.how == "right" { "JOIN" } else { "LEFT JOIN" };
    let mut body = format!("SELECT {sel} FROM {acc} AS a {kind} {rk} AS r ON {cond}");
    if j.how == "right" || j.how == "full" {
        let ak = format!("_tpa_a{n}");
        let distinct = j.on.iter().zip(&ks).map(|((a, _), k)| format!("JoinKey({}) AS {k}", qi(a))).collect::<Vec<_>>().join(", ");
        c.execute_batch(&format!("CREATE TEMP TABLE {ak} AS SELECT DISTINCT {distinct} FROM {acc}")).map_err(other)?;
        c.execute_batch(&format!("CREATE INDEX temp.{ak}_ix ON {ak}({})", ks.join(", "))).map_err(other)?;
        let only_left = acc_cols
            .iter()
            .map(|col| match key_of.get(col) {
                Some(b) => format!("r.{} AS {}", qi(&format!("r_{b}")), qi(col)),
                None => format!("NULL AS {}", qi(col)),
            })
            .collect::<Vec<_>>()
            .join(", ");
        let tail = if right_sel.is_empty() { String::new() } else { format!(", {right_sel}") };
        let not_null = ks.iter().map(|k| format!("r.{k} IS NOT NULL")).collect::<Vec<_>>().join(" AND ");
        let same = ks.iter().map(|k| format!("x.{k} = r.{k}")).collect::<Vec<_>>().join(" AND ");
        body = format!(
            "{body} UNION ALL SELECT {only_left}{tail} FROM {rk} AS r WHERE {not_null} AND NOT EXISTS (SELECT 1 FROM {ak} AS x WHERE {same})"
        );
    }
    c.execute_batch(&format!("CREATE TEMP TABLE {out} AS {body}")).map_err(other)?;
    // 数（画面の「当たった・当たらない」と、相手の鍵の重なり）
    let total = count(c, &format!("SELECT COUNT(*) FROM {acc}"))?;
    let hit = count(c, &format!("SELECT COUNT(*) FROM {acc} AS a WHERE EXISTS (SELECT 1 FROM {rk} AS r WHERE {cond})"))?;
    let rtotal = count(c, &format!("SELECT COUNT(*) FROM {rk}"))?;
    let nn = ks.iter().map(|k| format!("{k} IS NOT NULL")).collect::<Vec<_>>().join(" AND ");
    let rdup = count(c, &format!("SELECT COUNT(*) FROM (SELECT 1 FROM {rk} WHERE {nn} GROUP BY {} HAVING COUNT(*) > 1)", ks.join(", ")))?;
    let rhit = if rtotal <= RIGHT_HIT_LIMIT {
        Some(count(c, &format!("SELECT COUNT(*) FROM {rk} AS r WHERE EXISTS (SELECT 1 FROM {acc} AS a WHERE {cond})"))?)
    } else {
        None
    };
    let lefts = j.on.iter().map(|(a, _)| format!("a.{}", qi(a))).collect::<Vec<_>>().join(", ");
    let mut st = c
        .prepare(&format!("SELECT DISTINCT {lefts} FROM {acc} AS a WHERE NOT EXISTS (SELECT 1 FROM {rk} AS r WHERE {cond}) LIMIT {SAMPLE}"))
        .map_err(other)?;
    let width = j.on.len();
    let mut q = st.query([]).map_err(other)?;
    let mut miss = vec![];
    while let Some(r) = q.next().map_err(other)? {
        miss.push(Value::Array((0..width).map(|i| r.get_ref(i).map(json_of).unwrap_or(Value::Null)).collect()));
    }
    let rows = count(c, &format!("SELECT COUNT(*) FROM {out}"))?;
    stats.push(json!({
        "with": j.with, "name": side, "how": j.how, "rows": total, "hit": hit, "miss": total - hit,
        "rightRows": rtotal, "rightHit": rhit, "rightOnly": rhit.map(|h| rtotal - h), "rightDup": rdup,
        "out": rows, "columns": names, "missSample": miss,
    }));
    let mut cols = acc_cols.to_vec();
    cols.extend(names);
    Ok((out, cols))
}

/// 相手 1 つ（写しのファイル・表・名前）
pub struct Right {
    pub path: PathBuf,
    pub table: String,
    pub name: String,
}

/// 結合した答えを dest（.sqlite3）に組む。→ 数の並び（結合ごと）。組み終えてから置き換える（読んでいる途中に半端なファイルを見せない）
pub fn build(dest: &Path, base: &Path, base_table: &str, items: &[Join], rights: &[Right]) -> Result<Vec<Value>, JoinError> {
    if let Some(d) = dest.parent() {
        std::fs::create_dir_all(d).map_err(|e| JoinError::Other(e.to_string()))?;
    }
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let stem = dest.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dest.with_file_name(format!("{stem}.{}.{nanos}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    let run = || -> Result<Vec<Value>, JoinError> {
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_URI;
        let c = Connection::open_with_flags(&tmp, flags).map_err(other)?;
        let _ = c.busy_timeout(std::time::Duration::from_secs(30));
        c.execute_batch("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY;").map_err(other)?;
        let det = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
        c.create_scalar_function("JoinKey", 1, det, |ctx| {
            Ok(join_key(&py_of(ctx.get_raw(0))).map(SqlValue::Text).unwrap_or(SqlValue::Null))
        })
        .map_err(other)?;
        c.execute("ATTACH DATABASE ? AS b", [ro_uri(base)]).map_err(other)?;
        let mut acc_cols = columns(&c, "b", base_table)?;
        if acc_cols.is_empty() {
            return Err(JoinError::Rule(format!("表「{base_table}」が見つかりません。")));
        }
        c.execute_batch(&format!("CREATE TEMP TABLE _tpa_acc0 AS SELECT * FROM b.{}", qi(base_table))).map_err(other)?;
        let mut acc = "_tpa_acc0".to_string();
        let mut stats = vec![];
        for (n, (j, r)) in items.iter().zip(rights).enumerate() {
            c.execute(&format!("ATTACH DATABASE ? AS r{n}"), [ro_uri(&r.path)]).map_err(other)?;
            let rcols = columns(&c, &format!("r{n}"), &r.table)?;
            if rcols.is_empty() {
                return Err(JoinError::Rule(format!("「{}」の表「{}」が見つかりません。", r.name, r.table)));
            }
            let (a, cols) = step(&c, &acc, &acc_cols, j, &r.table, &rcols, &r.name, &mut stats)?;
            acc = a;
            acc_cols = cols;
        }
        c.execute_batch(&format!("CREATE TABLE main.{} AS SELECT * FROM {acc}", qi(base_table))).map_err(other)?;
        drop(c);
        Ok(stats)
    };
    let stats = match run() {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    };
    replace(&tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        JoinError::Other(format!("答えのファイルを置き換えられませんでした: {e}"))
    })?;
    Ok(stats)
}

/// 置き換え（開かれている間は Windows で拒まれるので、少し待ってやり直す）
fn replace(tmp: &Path, dest: &Path) -> std::io::Result<()> {
    let mut wait = 0.05;
    let end = Instant::now() + std::time::Duration::from_secs(2);
    loop {
        match std::fs::rename(tmp, dest) {
            Ok(()) => return Ok(()),
            Err(e) if Instant::now() >= end => return Err(e),
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_secs_f64(wait));
                wait = (wait * 2.0).min(0.5);
            }
        }
    }
}

/// Python の json.dumps(v, ensure_ascii=False, sort_keys=True) と同じ字（区切りは ", " と ": "）
pub fn py_dumps(v: &Value) -> String {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            let body = keys.iter().map(|k| format!("{}: {}", py_dumps(&Value::String((*k).clone())), py_dumps(&m[*k]))).collect::<Vec<_>>();
            format!("{{{}}}", body.join(", "))
        }
        Value::Array(a) => format!("[{}]", a.iter().map(py_dumps).collect::<Vec<_>>().join(", ")),
        Value::String(s) => {
            let mut out = String::from("\"");
            for ch in s.chars() {
                match ch {
                    '"' => out.push_str("\\\""),
                    '\\' => out.push_str("\\\\"),
                    '\n' => out.push_str("\\n"),
                    '\r' => out.push_str("\\r"),
                    '\t' => out.push_str("\\t"),
                    '\u{8}' => out.push_str("\\b"),
                    '\u{c}' => out.push_str("\\f"),
                    c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
                    c => out.push(c),
                }
            }
            out + "\""
        }
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
    }
}

fn stamp(path: &Path) -> Value {
    match std::fs::metadata(path) {
        Ok(m) => {
            let ns = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos() as u64);
            json!([path.display().to_string(), m.len(), ns])
        }
        Err(_) => json!([path.display().to_string(), null, null]),
    }
}

/// 結合した答えのファイルの係（db_cache/joins。Python の data_join.Joiner と同じ名前・同じ覚え）
pub struct Joiner {
    root: PathBuf,
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl Joiner {
    pub fn new(root: PathBuf) -> Joiner {
        Joiner { root, locks: Mutex::default() }
    }

    /// 結合した答えのファイル（無い・古ければ組む）→ (ファイル, 数)
    pub fn path_for(
        &self,
        key: &str,
        base: &Path,
        base_table: &str,
        items: &[Join],
        rights: &[Right],
    ) -> Result<(PathBuf, Value), JoinError> {
        let items_json: Vec<Value> = items.iter().map(Join::json).collect();
        let spec = json!({
            "base": [base.display().to_string(), base_table], "items": items_json,
            "rights": rights.iter().map(|r| json!([r.path.display().to_string(), r.table])).collect::<Vec<_>>(),
        });
        let hash = Sha256::digest(py_dumps(&spec).as_bytes());
        let name = format!("{key}_{}", hash.iter().take(6).map(|b| format!("{b:02x}")).collect::<String>());
        let dest = self.root.join(format!("{name}.sqlite3"));
        let meta = self.root.join(format!("{name}.json"));
        let want: Vec<Value> = std::iter::once(stamp(base)).chain(rights.iter().map(|r| stamp(&r.path))).collect();
        let lock = self.locks.lock().unwrap().entry(name.clone()).or_default().clone();
        let _one = lock.lock().unwrap_or_else(|e| e.into_inner());
        let had: Value = std::fs::read(&meta).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
        if dest.exists() && had["stamps"] == Value::Array(want.clone()) {
            return Ok((dest, had.get("stats").cloned().unwrap_or(json!([]))));
        }
        let t0 = Instant::now();
        let stats = build(&dest, base, base_table, items, rights)?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0);
        let mut info = Map::new();
        info.insert("stamps".into(), Value::Array(want));
        info.insert("stats".into(), Value::Array(stats.clone()));
        info.insert("builtAt".into(), json!(now));
        info.insert("seconds".into(), json!((t0.elapsed().as_secs_f64() * 1000.0).round() / 1000.0));
        info.insert("items".into(), Value::Array(items_json));
        let _ = std::fs::write(&meta, serde_json::to_vec(&Value::Object(info)).unwrap_or_default());
        self.sweep(key, &name);
        Ok((dest, Value::Array(stats)))
    }

    /// 同じ元の前の決まりのファイルを消す（読んでいて消せない物は次の機会に）
    fn sweep(&self, key: &str, keep: &str) {
        let head = format!("{key}_");
        for e in std::fs::read_dir(&self.root).into_iter().flatten().flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if n.starts_with(&head) && !n.starts_with(keep) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_like_python() {
        let k = |v: Py| join_key(&v);
        assert_eq!((k(Py::Text(" 054 ")), k(Py::Int(54)), k(Py::Float(54.0))), (Some("54".into()), Some("54".into()), Some("54".into())));
        assert_eq!(k(Py::Text("Ａ１ ")), Some("A1".into()), "NFKC・大文字");
        assert_eq!(k(Py::Text("a1")), Some("A1".into()));
        assert_eq!((k(Py::Text("  ")), k(Py::None)), (None, None), "空欄は当たらない");
        assert_eq!(k(Py::Float(2.5)), Some("2.5".into()));
        assert_eq!(k(Py::Float(-0.0)), Some("0".into()));
        assert_eq!(k(Py::Float(1e20)), Some("100000000000000000000".into()));
    }

    #[test]
    fn dumps_like_python() {
        let v = json!({"b": [1, "x\"\n\u{1}"], "a": {"日本": null, "z": true}});
        assert_eq!(py_dumps(&v), r#"{"a": {"z": true, "日本": null}, "b": [1, "x\"\n\u0001"]}"#);
    }
}
