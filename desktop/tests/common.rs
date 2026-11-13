//! 突き合わせの試験の共通: Python（program/tests の「正しい答えを出す係」）を呼ぶ。
#![allow(dead_code)]

use std::path::PathBuf;
use std::process::Command;

pub fn program() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program")
}

pub fn work(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("da-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// program/tests/<script> を引数つきで呼び、標準出力の JSON を返す（Python は TPA_PYTHON か python3／python）。
pub fn python_json(script: &str, args: &[&str]) -> serde_json::Value {
    let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
    let out = Command::new(&py)
        .arg(program().join("tests").join(script))
        .args(args)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .current_dir(program())
        .output()
        .unwrap_or_else(|e| panic!("{py} を起こせません: {e}"));
    assert!(out.status.success(), "{script} が失敗しました:\n{}", String::from_utf8_lossy(&out.stderr));
    let v: serde_json::Value = json_keep(&out.stdout).expect("Python の答えが JSON ではありません");
    check_budget(script, args, &v);
    v
}

/// 窓が答えず Python に任せる歩の数（版 3.102.0。program/tools/delegate-count.py と同じ数え方: "delegates" の並びの中身・
/// "delegate": true の歩・"expect": "delegate" の場面）
pub fn delegate_count(v: &serde_json::Value) -> usize {
    use serde_json::Value;
    match v {
        Value::Object(o) => {
            let me =
                usize::from(o.get("expect").and_then(Value::as_str) == Some("delegate") || o.get("delegate") == Some(&Value::Bool(true)));
            me + o
                .iter()
                .map(|(k, x)| match (k.as_str(), x) {
                    ("delegates", Value::Array(a)) => a.len(),
                    (_, Value::Object(_) | Value::Array(_)) => delegate_count(x),
                    _ => 0,
                })
                .sum::<usize>()
        }
        Value::Array(a) => a.iter().map(delegate_count).sum(),
        _ => 0,
    }
}

/// 任せる歩の予算（program/tests/fixtures/delegates_budget.json。答えの元ごとの上限）を超えていないか。作業フォルダを 1 つ渡す形だけ見る
fn check_budget(script: &str, args: &[&str], v: &serde_json::Value) {
    let budget: serde_json::Value = serde_json::from_str(include_str!("../../program/tests/fixtures/delegates_budget.json")).unwrap();
    let name = script.trim_end_matches(".py");
    let Some(max) = budget["per"][name].as_u64() else { return };
    // 環境で増える歩（root でない利用者・Windows でだけ任せる形。理由は envWhy）。per は手元で数えた数なので、その分を足して上限にする
    let max = max + budget["envExtra"][name].as_u64().unwrap_or(0);
    if args.len() != 1 || args[0].starts_with("--") {
        return;
    }
    let n = delegate_count(v) as u64;
    assert!(
        n <= max,
        "{script}: Python に任せる歩が {n}（予算 {max}）。新しく任せる歩を足すときは理由を書いて tests/fixtures/delegates_budget.json を上げる（数えるのは python tools/delegate-count.py）"
    );
}

/// 2つの JSON の違い（最初の 1 か所の道筋）。数は値で比べる（1.0 と 1 は別・整数と小数の書き分けも見る）。
pub fn diff(a: &serde_json::Value, b: &serde_json::Value, path: &str) -> Option<String> {
    use serde_json::Value::*;
    match (a, b) {
        (Object(x), Object(y)) => {
            for k in x.keys().chain(y.keys()) {
                match (x.get(k), y.get(k)) {
                    (Some(p), Some(q)) => {
                        if let Some(d) = diff(p, q, &format!("{path}.{k}")) {
                            return Some(d);
                        }
                    }
                    (p, q) => return Some(format!("{path}.{k}: {p:?} / {q:?}")),
                }
            }
            None
        }
        (Array(x), Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{path}: 長さ {} / {}", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().find_map(|(i, (p, q))| diff(p, q, &format!("{path}[{i}]")))
        }
        (Number(p), Number(q)) => {
            let same = match (p.as_i64(), q.as_i64()) {
                (Some(i), Some(j)) => i == j,
                (None, None) => p.as_f64() == q.as_f64(),
                _ => false,
            };
            (!same).then(|| format!("{path}: {p} / {q}"))
        }
        _ => (a != b).then(|| format!("{path}: {a} / {b}")),
    }
}

/// program/tests/<script> を起こしたままにする係（版 3.96.0。作り物のサーバーを起こしておく oracle）。
/// 最初の 1 行（JSON）を答えとして読み、あとは ask で 1 行ずつ尋ねる。落とすと標準入力を閉じて終わりを待つ
pub struct Live {
    child: std::process::Child,
    stdin: Option<std::process::ChildStdin>,
    out: std::io::BufReader<std::process::ChildStdout>,
}

impl Live {
    pub fn start(script: &str, args: &[&str]) -> (Live, serde_json::Value) {
        use std::io::BufRead;
        let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
        let mut child = Command::new(&py)
            .arg(program().join("tests").join(script))
            .args(args)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .current_dir(program())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("{py} を起こせません: {e}"));
        let stdin = child.stdin.take();
        let mut out = std::io::BufReader::new(child.stdout.take().unwrap());
        let mut line = String::new();
        out.read_line(&mut line).unwrap();
        assert!(!line.is_empty(), "{script} が答えずに終わりました");
        let v = json_keep(line.as_bytes()).expect("Python の答えが JSON ではありません");
        (Live { child, stdin, out }, v)
    }

    /// 1 行を送る
    pub fn send(&mut self, line: &str) {
        use std::io::Write;
        let w = self.stdin.as_mut().unwrap();
        writeln!(w, "{line}").unwrap();
        w.flush().unwrap();
    }

    /// 1 行を読む（JSON）
    pub fn read(&mut self) -> serde_json::Value {
        use std::io::BufRead;
        let mut line = String::new();
        self.out.read_line(&mut line).unwrap();
        json_keep(line.as_bytes()).unwrap_or(serde_json::Value::Null)
    }

    /// 1 行を送って 1 行を読む
    pub fn ask(&mut self, line: &str) -> serde_json::Value {
        self.send(line);
        self.read()
    }
}

impl Drop for Live {
    fn drop(&mut self) {
        self.stdin.take();
        let _ = self.child.wait();
    }
}

/// 書く道の本文の門（版 3.104.0。src/body.rs）。本物の道（Lot::handle_body）と同じく、部品より先に当てる。Err は窓が断る答え
pub fn gate(method: &str, path: &str, body: &[u8]) -> Result<Vec<u8>, (u16, serde_json::Value)> {
    match da_core::body::gate(method, path, body) {
        da_core::body::Gate::Pass(b) => Ok(b.into_owned()),
        da_core::body::Gate::Refuse(status, v) => Err((status, v)),
    }
}

/// 置き場のファイルの中身（版 3.107.0）: serde で読めなければ Python の json.loads と同じ J で読む（NaN・Infinity は src/held.rs の印の字。
/// 前は "<読めない>" で、NaN を持ったまま書き戻したファイルを Python と突き合わせられなかった）
pub fn file_value(b: &[u8]) -> serde_json::Value {
    let b = b.strip_prefix(b"\xef\xbb\xbf").unwrap_or(b);
    json_keep(b).unwrap_or_else(|| {
        std::str::from_utf8(b).ok().and_then(|t| da_core::held::parse(t).ok()).unwrap_or_else(|| serde_json::json!("<読めない>"))
    })
}

/// JSON の字（Python の答え・置き場のファイル）を読む。i64・u64 に入らない整数があれば、窓と同じく src/held.rs の印の字で桁のまま持つ
/// （版 3.108.0。前は serde が小数に丸め、桁の違う 2 つの大きな数を同じと見ていた）
pub fn json_keep(b: &[u8]) -> Option<serde_json::Value> {
    if da_core::master_store::has_wide_int(b) {
        return da_core::held::parse(std::str::from_utf8(b).ok()?.trim_end()).ok();
    }
    serde_json::from_slice(b).ok()
}

/// 起動の初期値の試験の置き場（版 3.110.0。seeds_cases・seeds_parity）: root に base/data・local（作業場所）を作り、共有 share の書く係を作る
pub fn seeds_store_at(root: &std::path::Path, share: Option<PathBuf>, who: &str) -> da_core::master_store::Store {
    use da_core::master_store::{Config, Store, SHARED_ALWAYS};
    let (base, local) = (root.join("base"), root.join("local"));
    for d in [base.join("data"), local.join("master_cache")] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::write(local.join("instance_id"), format!("inst-{who}")).unwrap();
    let mut shared: Vec<String> = SHARED_ALWAYS.iter().map(|s| s.to_string()).collect();
    shared.extend(["roll_master".to_string(), "equipment_master".to_string()]);
    Store::new(Config {
        data: base.join("data"),
        defaults: program().join("app").join("master_defaults"),
        share_dir: share,
        shared,
        cache: local.join("master_cache"),
        local_root: local,
        pc: format!("PC-{who}"),
        login: who.into(),
        role: "rs".into(),
        lock_ttl: 20.0,
    })
}

/// 事例の表の走らせる形（{place: share・local・unreachable, masters}）の置き場を root に作る
pub fn seeds_store(root: &std::path::Path, run: &serde_json::Value, who: &str) -> da_core::master_store::Store {
    let share = match run["place"].as_str().unwrap() {
        "share" => {
            let s = root.join("share");
            std::fs::create_dir_all(&s).unwrap();
            for (name, doc) in run["masters"].as_object().unwrap() {
                std::fs::write(s.join(format!("{name}.json")), doc.to_string()).unwrap();
            }
            if run["lock"].is_object() {
                // ほかの PC の生きた錠（版 3.110.0 の作った後の採点の割れ 3）
                std::fs::write(s.join(da_core::master_store::LOCK_FILENAME), run["lock"].to_string()).unwrap();
            }
            Some(s)
        }
        "unreachable" => Some(root.join("無い共有")),
        _ => {
            let data = root.join("base").join("data");
            std::fs::create_dir_all(&data).unwrap();
            for (name, doc) in run["masters"].as_object().unwrap() {
                std::fs::write(data.join(format!("{name}.json")), doc["rows"].to_string()).unwrap();
            }
            None
        }
    };
    seeds_store_at(root, share, who)
}

/// 走らせた後のマスタ（共有なら共有の文書、手元のみなら data/ の行の配列）。名前 → 中身
pub fn seeds_files(root: &std::path::Path, run: &serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
    let dir = if run["place"] == "share" { root.join("share") } else { root.join("base").join("data") };
    let mut out = serde_json::Map::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "json") {
                out.insert(p.file_stem().unwrap().to_string_lossy().into_owned(), file_value(&std::fs::read(&p).unwrap()));
            }
        }
    }
    out
}
