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
    serde_json::from_slice(&out.stdout).expect("Python の答えが JSON ではありません")
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
        let v = serde_json::from_str(&line).expect("Python の答えが JSON ではありません");
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
        serde_json::from_str(&line).unwrap_or(serde_json::Value::Null)
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
