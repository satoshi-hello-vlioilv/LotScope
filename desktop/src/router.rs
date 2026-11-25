//! 画面（WebView）からの問い合わせの振り分け。どれも窓（Rust）が答える（版 3.119.0。段 ⑤ で中身〈Python〉へ回す枝を消した）:
//!   - 窓そのものの操作と Lot が答える道 … main.rs が native として渡す（終了・窓の情報・自己診断・画面・API）
//!   - /static/…                          … ディスク（program/app/static）から直接返す（JS・CSS・three.js）
//!   - それ以外                            … 門番（src/access.rs）を通し、窓の言葉で断る（503 window_unanswered。戻したキーに / がある道は 404）。
//!     回数は形の名前ごとに数える（利用状況のいま使っている印の unanswered。src/delegate.rs。404 にするかの材料: 利用者の決めの既定 (2)）
//!
//! 画面の JS は fetch("/api/...") のまま（同じ置き場への問い合わせ）で、ポートも CORS も要らない。

// 答えの形・静的ファイル・窓が答えなかった道の断りは lib の 1 か所（版 3.118.2。開発用サーバー examples/ui_serve.rs も同じ物を通る）
pub use da_core::shell::{error_reply, percent_decode, static_file, window_unanswered, Reply, Req};
use std::path::PathBuf;
use tauri::http::{Request, Response};

/// 窓そのものが答える問い合わせ。None なら静的ファイルか、門番を通して窓の言葉で断る。
pub type Native = Box<dyn Fn(&Req) -> Option<Reply> + Send + Sync>;

/// 窓が答えない道を断る前に見る門番（版 3.65.0。src/access.rs の書き込みの門番）。Err は門番の断り（403 など）。
pub type Guard = Box<dyn Fn(&Req) -> Result<(), Reply> + Send + Sync>;

pub struct Router {
    pub static_dir: PathBuf,
    pub native: Native,
    pub guard: Guard,
}

impl Router {
    pub fn handle(&self, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let uri = req.uri();
        let path = uri.path();
        let query = uri.query().unwrap_or("");
        let method = req.method().as_str();
        let reply = if let Some(r) = (self.native)(&Req { method, path, query, body: req.body() }) {
            r
        } else if let (true, Some(rest)) = (method == "GET" || method == "HEAD", path.strip_prefix("/static/")) {
            static_file(&self.static_dir, rest, query)
        } else {
            // 門番は百分率符号を戻した道で見る（生の道で見ると /api/masters/%61ccess が門番を抜ける）
            let decoded = percent_decode(path);
            match (self.guard)(&Req { method, path: &decoded, query, body: req.body() }) {
                Err(no) => no,
                Ok(()) => window_unanswered(method, path, &decoded, query),
            }
        };
        to_response(reply, "shell")
    }
}

pub fn to_response(r: Reply, by: &str) -> Response<Vec<u8>> {
    let mut b = Response::builder().status(r.status);
    for (k, v) in &r.headers {
        b = b.header(k.as_str(), v.as_str());
    }
    // どちらが答えたか（自己診断・不具合の切り分けに使う。版 3.119.0 からいつも shell）
    b = b.header("X-TPA-By", by);
    b.body(r.body).unwrap_or_else(|_| Response::builder().status(500).body(Vec::new()).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn req(method: &str, uri: &str, body: &[u8]) -> Request<Vec<u8>> {
        Request::builder().method(method).uri(uri).body(body.to_vec()).unwrap()
    }

    fn router(dir: &Path) -> Router {
        Router {
            static_dir: dir.to_path_buf(),
            native: Box::new(|r| (r.method == "GET" && r.path == "/__desktop/info").then(|| error_reply(200, "info", "窓"))),
            guard: Box::new(|r| match r.path {
                "/api/masters/access" if r.method == "POST" => Err(error_reply(403, "forbidden", "書けません")),
                _ => Ok(()),
            }),
        }
    }

    #[test]
    fn each_kind_goes_to_its_place() {
        let dir = std::env::temp_dir().join(format!("da-router-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("js")).unwrap();
        std::fs::write(dir.join("js").join("app.js"), "x=1").unwrap();
        std::fs::write(dir.join("js").join("日本.css"), "a{}").unwrap();
        let r = router(&dir);

        let s = r.handle(&req("GET", "tpa://localhost/static/js/app.js?v=123", b""));
        assert_eq!((s.status().as_u16(), s.body().as_slice()), (200, b"x=1".as_slice()));
        assert_eq!(s.headers()["content-type"], "text/javascript; charset=utf-8");
        assert_eq!(s.headers()["x-tpa-by"], "shell", "静的ファイルは Rust");
        assert!(s.headers()["cache-control"].to_str().unwrap().contains("immutable"), "版付きは使い回す");
        assert_eq!(r.handle(&req("GET", "tpa://localhost/static/js/app.js", b"")).headers()["cache-control"], "no-cache");
        assert_eq!(r.handle(&req("GET", "tpa://localhost/static/js/%E6%97%A5%E6%9C%AC.css", b"")).status(), 200, "日本語の名前");
        for bad in ["/static/../secret.txt", "/static/js/%2e%2e/%2e%2e/x", "/static//etc/passwd", "/static/js/none.js"] {
            assert_eq!(r.handle(&req("GET", &format!("tpa://localhost{bad}"), b"")).status(), 404, "{bad}");
        }
        let n = r.handle(&req("GET", "tpa://localhost/__desktop/info", b""));
        assert_eq!((n.status().as_u16(), n.headers()["x-tpa-by"].to_str().unwrap()), (200, "shell"), "窓のことは Rust");
        let p = r.handle(&req("POST", "tpa://localhost/static/js/app.js", b""));
        assert_eq!(
            (p.status().as_u16(), p.headers()["x-tpa-by"].to_str().unwrap()),
            (503, "shell"),
            "/static でも GET・HEAD 以外は窓の言葉で断る"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 窓が答えない道（版 3.118.0 から。段 ⑤〈版 3.119.0〉で中身の係そのものを消した）: 窓の言葉の 503 と道の型、戻したキーに / がある道は 404。
    /// 門番は前のまま先に見る（百分率符号で書いても抜けない）。回数は形の名前ごとに数える
    #[test]
    fn an_absent_backend_is_never_asked_and_the_window_answers_why() {
        let r = router(&std::env::temp_dir());
        for (m, p) in [("GET", "/api/lotlist/settings"), ("GET", "/api/dashboard/fields?source=lot&engine=python"), ("POST", "/api/x/12")] {
            let a = r.handle(&req(m, &format!("tpa://localhost{p}"), b"{}"));
            let v: serde_json::Value = serde_json::from_slice(a.body()).unwrap();
            assert_eq!((a.status().as_u16(), a.headers()["x-tpa-by"].to_str().unwrap()), (503, "shell"), "{p}");
            assert_eq!(v["kind"], "window_unanswered", "{p} {v}");
            assert!(v["error"].as_str().unwrap().contains("窓"), "窓の言葉: {v}");
            assert!(!v["error"].as_str().unwrap().contains("起こし直"), "中身を起こし直すとは言わない: {v}");
            assert!(!v["error"].as_str().unwrap().contains("Python"), "中身（Python）の名を出さない: {v}");
        }
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(r.handle(&req("POST", "tpa://localhost/api/x/12", b"")).body()).unwrap()["route"],
            "POST /api/x/{n}",
            "道の型だけ（引数は書かない）"
        );
        let slash = r.handle(&req("GET", "tpa://localhost/api/sources/a%2Fb/columns", b""));
        assert_eq!(
            (slash.status().as_u16(), slash.headers()["x-tpa-by"].to_str().unwrap()),
            (404, "shell"),
            "戻したキーに / がある道は道なしの 404"
        );
        for p in ["/api/masters/access", "/api/masters/%61ccess", "/api/m%61sters/%61ccess", "/api/masters/acces%73"] {
            let no = r.handle(&req("POST", &format!("tpa://localhost{p}"), b"{}"));
            assert_eq!(
                (no.status().as_u16(), no.headers()["x-tpa-by"].to_str().unwrap()),
                (403, "shell"),
                "門番が断る（百分率符号で書いても）: {p}"
            );
        }
        let n = da_core::delegate::counts();
        assert!(n["unanswered GET /api/lotlist/settings"].as_u64().unwrap_or(0) >= 1, "回数を数える: {n}");
        assert!(n["unanswered_404 GET /api/sources/{s}/columns"].as_u64().unwrap_or(0) >= 1, "{n}");
    }
}
