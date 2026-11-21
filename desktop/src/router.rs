//! 画面（WebView）からの問い合わせの振り分け。得意なほうが答える:
//!   - /static/…           … Rust がディスク（program/app/static）から直接返す（JS・CSS・three.js。Python を通さず速い）
//!   - 窓そのものの操作      … Rust（終了・窓の情報・自己診断。main.rs が native として渡す）
//!   - それ以外（画面・API） … Python（サイドカー）へそのまま渡す
//!
//! 画面の JS は fetch("/api/...") のまま（同じ置き場への問い合わせ）で、ポートも CORS も要らない。

use crate::sidecar::{Ask, Reply, RequestError, Supervisor};
use da_core::access::ME_HEADER;
use serde_json::json;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::http::{Request, Response};

/// 問い合わせを答えに変える係（試験では作り物に差し替える）。
pub trait Backend: Send + Sync {
    fn ask(&self, ask: &Ask) -> Reply;
    /// 中身（Python）のいまの様子（版 3.111.0。心拍の答えの python・利用状況・/api/health）。待たずに今を答え、
    /// 止まっていれば裏で起こし直しを始める（心拍が呼び続ける。前は alive() の副作用）
    fn python_now(&self) -> da_core::presence::PythonNow {
        da_core::presence::PythonNow::ready()
    }
    /// 中身が準備できたときの知らせ（窓の情報に載せる。版 3.86.0。動いていなければ null）
    fn ready(&self) -> serde_json::Value {
        serde_json::Value::Null
    }
    /// 中身がいま答えられるか（起こしている最中は偽。画面の既定の形を選ぶ。版 3.86.0）
    fn ready_now(&self) -> bool {
        true
    }
    /// 起こせなかった理由を忘れて起こし直す（画面の帯の「もう一度起こす」）
    fn retry(&self) {}
    /// 中身を起こさない形か（版 3.118.0。段 ④: 製品の窓はいつも真。中身へ回さず、振り分けが窓の言葉で断る〈window_unanswered〉）
    fn absent(&self) -> bool {
        false
    }
}

/// 長い問い合わせ（見えない Edge で LotDsp を読む・共有の写し直し）を待てる長さ。
const ASK_WAIT: Duration = Duration::from_secs(600);

impl Backend for Supervisor {
    /// 待たない（版 3.86.0）: 起きている・起こしている最中・止まった（理由）。止まっていれば裏で起こし直しを始める（Supervisor::now）
    fn python_now(&self) -> da_core::presence::PythonNow {
        self.now()
    }
    fn ready(&self) -> serde_json::Value {
        Supervisor::ready(self)
    }
    fn ready_now(&self) -> bool {
        self.up().is_some()
    }
    fn retry(&self) {
        Supervisor::retry(self);
    }
    fn absent(&self) -> bool {
        Supervisor::absent(self)
    }

    fn ask(&self, ask: &Ask) -> Reply {
        // 送る前に止まっていた（Dead）なら起こし直して1度だけ送り直す。送った後に止まったものは送り直さない（二重に書かない）
        for attempt in 0..2 {
            let side = match self.get() {
                Ok(s) => s,
                Err(e) => return error_reply(503, "backend_unavailable", &e),
            };
            match side.request(ask, ASK_WAIT) {
                Ok(r) => return r,
                Err(RequestError::Dead) if attempt == 0 => continue,
                Err(RequestError::Timeout) => {
                    return error_reply(504, "backend_timeout", &format!("アプリの中身が {} 秒たっても答えません。", ASK_WAIT.as_secs()))
                }
                Err(_) => {
                    return error_reply(
                        503,
                        "backend_stopped",
                        "アプリの中身（Python）が途中で止まりました。もう一度お試しください（自動で起こし直します）。",
                    )
                }
            }
        }
        error_reply(503, "backend_stopped", "アプリの中身（Python）を起こし直せませんでした。")
    }
}

pub fn error_reply(status: u16, kind: &str, message: &str) -> Reply {
    Reply {
        status,
        headers: vec![("Content-Type".into(), "application/json".into())],
        body: serde_json::to_vec(&json!({"error": message, "kind": kind})).unwrap_or_default(),
    }
}

/// 窓そのものが答える問い合わせ。None ならほかへ回す。中身（Python）に尋ねたいときは backend を使う
/// （例: 品質異常は設定を Python に尋ねてから Rust が答える・lot.rs）。
pub struct Req<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: &'a str,
    pub body: &'a [u8],
}
pub type Native = Box<dyn Fn(&Req, &dyn Backend) -> Option<Reply> + Send + Sync>;

/// 中身（Python）へ回す前に窓が見る（版 3.65.0。src/access.rs の権限の判定と書き込みの門番）。Ok(Some(字)) は見出し X-TPA-Me に
/// 載せる me・Ok(None) は載せない（Python が自分で決める）・Err は回さずに断る答え。
pub type Guard = Box<dyn Fn(&Req, &dyn Backend) -> Result<Option<String>, Reply> + Send + Sync>;

/// Python が答えたあとに窓が見る（終了ボタンのあと、中身が片付けて終わったら窓も閉じる等）。
pub type After = Box<dyn Fn(&str, &str, u16) + Send + Sync>;

pub struct Router<B: Backend> {
    pub static_dir: PathBuf,
    pub backend: B,
    pub native: Native,
    pub guard: Guard,
    pub after: After,
}

impl<B: Backend> Router<B> {
    pub fn handle(&self, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let uri = req.uri();
        let path = uri.path();
        let query = uri.query().unwrap_or("");
        let method = req.method().as_str();
        let (reply, by) = if let Some(r) = (self.native)(&Req { method, path, query, body: req.body() }, &self.backend) {
            (r, "shell")
        } else if let (true, Some(rest)) = (method == "GET" || method == "HEAD", path.strip_prefix("/static/")) {
            (static_file(&self.static_dir, rest, query), "shell")
        } else {
            // 画面から来た X-TPA-Me は必ず捨てる（画面が権限を名乗れない。載せるのは窓が決めた me だけ）
            let mut headers: Vec<(String, String)> = req
                .headers()
                .iter()
                .filter(|(k, _)| !k.as_str().eq_ignore_ascii_case(ME_HEADER))
                .filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string())))
                .collect();
            // 門番と後始末は、Python が道を合わせる形（百分率符号を戻した道。web.App.handle の unquote）で見る
            // （生の道で見ると /api/masters/%61ccess が門番を抜け、Python では /api/masters/access の書き込みになる）
            let decoded = percent_decode(path);
            match (self.guard)(&Req { method, path: &decoded, query, body: req.body() }, &self.backend) {
                Err(no) => (no, "shell"),
                // 段 ④（版 3.118.0）: 中身を起こさない窓は中身へ回さず、窓の言葉で断る（503 window_unanswered。戻したキーに / がある道は 404）。
                // 回数は形の名前ごとに数える（利用状況のいま使っている印の unanswered。src/delegate.rs）
                Ok(_) if self.backend.absent() => (window_unanswered(method, path, &decoded, query), "shell"),
                Ok(me) => {
                    headers.extend(me.map(|m| (ME_HEADER.to_string(), m)));
                    // 窓が答えず Python へ回した回数を、道の型ごとに数える（版 3.102.0 の作った後の採点の足りない所。src/delegate.rs。
                    // 形の名前は道の型だけ〈数・キー・字の段は {n}・{key}・{s}〉で、引数・本文・PC 名・ログイン ID は書かない）
                    da_core::delegate::note(&delegate_form(method, &decoded, query));
                    let r = self.backend.ask(&Ask { method, path, query, headers, body: req.body() });
                    (self.after)(method, &decoded, r.status);
                    (r, "python")
                }
            }
        };
        to_response(reply, by)
    }
}

/// 窓が答えなかった問い合わせの答え（版 3.118.0。段 ④ の中身へ回していた道の落ち先の 1 か所）。raw は画面が送った道・decoded は百分率符号を
/// 戻した道。戻すと段が増える道（/api/sources/a%2Fb/columns: 戻したキーに / がある）は道なしの 404（前は Python が道なしの 404 で答えた）。
/// ほかは 503 {error, kind: window_unanswered, route: 道の型, why}。回数を数える（形の名前 unanswered <道の型>）
pub fn window_unanswered(method: &str, raw: &str, decoded: &str, query: &str) -> Reply {
    if raw.split('/').count() != decoded.split('/').count() {
        // 形の名前は送った道の型（戻した字は書かない）
        let route = delegate_form(method, raw, query).replacen("python ", "", 1);
        da_core::delegate::note(&format!("unanswered_404 {route}"));
        return error_reply(404, "not_found", "ありません。");
    }
    let route = delegate_form(method, decoded, query).replacen("python ", "", 1);
    da_core::delegate::note(&format!("unanswered {route}"));
    let mut v = json!({
        "error": "この問い合わせには、まだ窓が答えられません（版 3.118.0 からアプリの中身〈Python〉に回しません）。画面を開き直しても続くときは、配る人に知らせてください。",
        "kind": "window_unanswered",
        "route": route,
        "why": "窓の係が答えない形でした（比べる口 engine=python・窓がまだ同じに読めない形）",
    });
    if route.starts_with("engine_python") {
        v["why"] = json!("engine=python は Python と比べる口です（段 ④ から中身を起こさないので答えません）");
    }
    Reply {
        status: 503,
        headers: vec![("Content-Type".into(), "application/json".into())],
        body: serde_json::to_vec(&v).unwrap_or_default(),
    }
}

/// Python へ回した問い合わせの形の名前（"python GET /api/masters/shifts/{n}" など。?engine=python は自己診断・突き合わせの口なので別の名前）
pub fn delegate_form(method: &str, path: &str, query: &str) -> String {
    if da_core::lotlist::parse_query(query).iter().any(|(k, v)| k == "engine" && v == "python") {
        return format!("engine_python {method}");
    }
    let mut out: Vec<String> = vec![];
    let mut after_src = false;
    for seg in path.split('/') {
        let t = if after_src && !seg.is_empty() {
            "{key}".to_string()
        } else if !seg.is_empty() && seg.chars().all(|c| c.is_ascii_digit()) {
            "{n}".to_string()
        } else if seg.len() > 32 || !seg.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
            "{s}".to_string()
        } else {
            seg.to_string()
        };
        after_src = seg == "src" && out.last().is_some_and(|x| x == "api");
        out.push(t);
    }
    format!("python {method} {}", out.join("/"))
}

pub fn to_response(r: Reply, by: &str) -> Response<Vec<u8>> {
    let mut b = Response::builder().status(r.status);
    for (k, v) in &r.headers {
        b = b.header(k.as_str(), v.as_str());
    }
    // どちらが答えたか（自己診断・不具合の切り分けに使う）
    b = b.header("X-TPA-By", by);
    b.body(r.body).unwrap_or_else(|_| Response::builder().status(500).body(Vec::new()).unwrap())
}

/// /static/ の下のファイル。static フォルダの外へは出ない（.. や絶対パスは断る）。
pub fn static_file(root: &Path, rest: &str, query: &str) -> Reply {
    let decoded = percent_decode(rest);
    let rel = Path::new(&decoded);
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return error_reply(404, "not_found", "ありません。");
    }
    match std::fs::read(root.join(rel)) {
        Ok(body) => {
            // 指紋の付いた URL（?v=プログラムの指紋。画面の型の url_for が付ける・app_build.fingerprint）は、
            // 中身が変われば指紋も変わるので長く使い回す。指紋の無い URL は毎回確かめる（Python の答えと同じ no-cache）
            let cache = if query.split('&').any(|kv| kv.starts_with("v=")) { "public, max-age=31536000, immutable" } else { "no-cache" };
            Reply {
                status: 200,
                headers: vec![("Content-Type".into(), mime(&decoded).into()), ("Cache-Control".into(), cache.into())],
                body,
            }
        }
        Err(_) => error_reply(404, "not_found", "ありません。"),
    }
}

pub fn mime(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn percent_decode(s: &str) -> String {
    let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h << 4 | l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod delegate_form_tests {
    use super::delegate_form;

    #[test]
    fn forms_name_only_the_route() {
        assert_eq!(delegate_form("PUT", "/api/masters/shifts/12", ""), "python PUT /api/masters/shifts/{n}");
        assert_eq!(delegate_form("GET", "/api/src/仕掛/slicer", "column=a"), "python GET /api/src/{key}/slicer");
        assert_eq!(delegate_form("GET", "/api/sources/秘密の名前/columns", ""), "python GET /api/sources/{s}/columns");
        assert_eq!(delegate_form("GET", "/api/lotlist", "engine=python&page=2"), "engine_python GET");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Echo(Mutex<Vec<String>>, Mutex<Vec<Vec<(String, String)>>>);
    impl Backend for Echo {
        fn ask(&self, a: &Ask) -> Reply {
            self.0.lock().unwrap().push(format!("{} {}?{} {}", a.method, a.path, a.query, String::from_utf8_lossy(a.body)));
            self.1.lock().unwrap().push(a.headers.clone());
            Reply { status: 201, headers: vec![("Content-Type".into(), "text/plain".into())], body: b"py".to_vec() }
        }
    }

    fn router(dir: &Path) -> Router<Echo> {
        Router {
            static_dir: dir.to_path_buf(),
            backend: Echo(Mutex::default(), Mutex::default()),
            native: Box::new(|r, _| (r.method == "GET" && r.path == "/__desktop/info").then(|| error_reply(200, "info", "窓"))),
            guard: Box::new(|r, _| match r.path {
                "/api/masters/access" if r.method == "POST" => Err(error_reply(403, "forbidden", "書けません")),
                "/api/lost" => Ok(None),
                _ => Ok(Some("{\"flags\":{}}".into())),
            }),
            after: Box::new(|_, _, _| {}),
        }
    }

    /// 準備に時間がかかる中身（版 3.86.0 の作った後の採点: 窓の道が中身を待たずに答えるか）
    struct Slow;
    impl Backend for Slow {
        fn ask(&self, _: &Ask) -> Reply {
            std::thread::sleep(Duration::from_millis(500));
            error_reply(200, "py", "中身")
        }
        fn python_now(&self) -> da_core::presence::PythonNow {
            da_core::presence::PythonNow { state: "starting", why: String::new() }
            // 起こしている最中
        }
        fn ready_now(&self) -> bool {
            false
        }
    }

    #[test]
    fn the_window_answers_while_the_backend_is_slow() {
        let dir = std::env::temp_dir().join(format!("da-router-slow-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("js")).unwrap();
        std::fs::write(dir.join("js").join("app.js"), "x=1").unwrap();
        let r = std::sync::Arc::new(Router {
            static_dir: dir.clone(),
            backend: Slow,
            native: Box::new(|q, b| {
                (q.path == "/__desktop/info").then(|| error_reply(200, if b.ready_now() { "ready" } else { "starting" }, "窓"))
            }),
            guard: Box::new(|_, _| Ok(None)),
            after: Box::new(|_, _, _| {}),
        });
        let r1 = r.clone();
        let py = std::thread::spawn(move || r1.handle(&req("GET", "tpa://localhost/api/schedule", b"")));
        std::thread::sleep(Duration::from_millis(50));
        let at = std::time::Instant::now();
        let info = r.handle(&req("GET", "tpa://localhost/__desktop/info", b""));
        let js = r.handle(&req("GET", "tpa://localhost/static/js/app.js", b""));
        assert!(at.elapsed() < Duration::from_millis(200), "窓の道は中身を待たない: {:?}", at.elapsed());
        assert_eq!((info.headers()["x-tpa-by"].to_str().unwrap(), js.status().as_u16()), ("shell", 200));
        assert!(String::from_utf8_lossy(info.body()).contains("starting"));
        let py = py.join().unwrap();
        assert_eq!(py.headers()["x-tpa-by"], "python", "中身の道は準備のあとに答える");
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn req(method: &str, uri: &str, body: &[u8]) -> Request<Vec<u8>> {
        Request::builder().method(method).uri(uri).body(body.to_vec()).unwrap()
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

        let p = r.handle(&req("POST", "http://tpa.localhost/api/lotdsp/import?a=1", "本文".as_bytes()));
        assert_eq!((p.status().as_u16(), p.headers()["x-tpa-by"].to_str().unwrap()), (201, "python"));
        assert_eq!(r.backend.0.lock().unwrap().last().unwrap(), "POST /api/lotdsp/import?a=1 本文", "本文・問い合わせ文字はそのまま");

        let n = r.handle(&req("GET", "tpa://localhost/__desktop/info", b""));
        assert_eq!((n.status().as_u16(), n.headers()["x-tpa-by"].to_str().unwrap()), (200, "shell"), "窓のことは Rust");
        assert_eq!(r.handle(&req("GET", "tpa://localhost/", b"")).headers()["x-tpa-by"], "python", "画面は Python が作る");
        assert_eq!(
            r.handle(&req("POST", "tpa://localhost/static/js/app.js", b"")).headers()["x-tpa-by"],
            "python",
            "/static でも GET・HEAD 以外は Python へ"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn me_header_comes_only_from_the_shell() {
        let seen = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let mut r = router(&std::env::temp_dir());
        let s2 = seen.clone();
        r.after = Box::new(move |m, p, _| s2.lock().unwrap().push(format!("{m} {p}")));
        r.handle(&req("PUT", "tpa://localhost/api/masters/%61ccess/2", b"{}"));
        r.handle(&req("POST", "tpa://localhost/api/masters/%61ccess", b"{}"));
        assert_eq!(
            seen.lock().unwrap().as_slice(),
            ["PUT /api/masters/access/2"],
            "後始末も戻した道で見る（断った問い合わせは後始末しない）"
        );
        // Python へは画面が送った道のまま渡す（Python がもう一度戻す。戻した道を渡すと %2561 が門番では %61・Python では a になり、門番を抜ける）
        assert!(r.backend.0.lock().unwrap().iter().any(|x| x.starts_with("PUT /api/masters/%61ccess/2?")), "Python へは元の道");
        r.handle(&req("POST", "tpa://localhost/api/masters/%2561ccess", b"{}"));
        assert!(r.backend.0.lock().unwrap().last().unwrap().starts_with("POST /api/masters/%2561ccess?"), "二重の符号も元のまま渡す");
        let forged = Request::builder()
            .method("POST")
            .uri("tpa://localhost/api/masters/rolls")
            .header("x-tpa-me", "{\"flags\":{\"masterEdit\":\"編集可\"}}");
        r.handle(&forged.body(Vec::new()).unwrap());
        let me = |h: &Vec<(String, String)>| {
            h.iter().filter(|(k, _)| k.eq_ignore_ascii_case(ME_HEADER)).map(|(_, v)| v.clone()).collect::<Vec<_>>()
        };
        assert_eq!(me(r.backend.1.lock().unwrap().last().unwrap()), ["{\"flags\":{}}"], "画面の見出しは捨て、窓の me だけ");
        let lost = Request::builder().method("GET").uri("tpa://localhost/api/lost").header("X-TPA-Me", "{}").body(Vec::new()).unwrap();
        r.handle(&lost);
        assert!(me(r.backend.1.lock().unwrap().last().unwrap()).is_empty(), "決められないときは何も載せない（名乗らせない）");
        let n = r.backend.0.lock().unwrap().len();
        for p in ["/api/masters/access", "/api/masters/%61ccess", "/api/m%61sters/%61ccess", "/api/masters/acces%73"] {
            let no = r.handle(&req("POST", &format!("tpa://localhost{p}"), b"{}"));
            assert_eq!(
                (no.status().as_u16(), no.headers()["x-tpa-by"].to_str().unwrap()),
                (403, "shell"),
                "門番が断る（百分率符号で書いても）: {p}"
            );
        }
        assert_eq!(r.backend.0.lock().unwrap().len(), n, "断った問い合わせは Python へ回さない");
    }

    /// 中身を起こさない窓（版 3.118.0。段 ④）: 中身の道は答えを作り物に回さない
    struct Absent(Mutex<u32>);
    impl Backend for Absent {
        fn ask(&self, _: &Ask) -> Reply {
            *self.0.lock().unwrap() += 1;
            error_reply(200, "py", "中身")
        }
        fn absent(&self) -> bool {
            true
        }
        fn python_now(&self) -> da_core::presence::PythonNow {
            da_core::presence::PythonNow::absent()
        }
    }

    #[test]
    fn an_absent_backend_is_never_asked_and_the_window_answers_why() {
        let r = Router {
            static_dir: std::env::temp_dir(),
            backend: Absent(Mutex::new(0)),
            native: Box::new(|_, _| None),
            guard: Box::new(|r, _| match r.path {
                "/api/masters/access" if r.method == "POST" => Err(error_reply(403, "forbidden", "書けません")),
                _ => Ok(None),
            }),
            after: Box::new(|_, _, _| panic!("中身が答えていないので後始末しない")),
        };
        for (m, p) in [("GET", "/api/lotlist/settings"), ("GET", "/api/dashboard/fields?source=lot&engine=python"), ("POST", "/api/x/12")] {
            let a = r.handle(&req(m, &format!("tpa://localhost{p}"), b"{}"));
            let v: serde_json::Value = serde_json::from_slice(a.body()).unwrap();
            assert_eq!((a.status().as_u16(), a.headers()["x-tpa-by"].to_str().unwrap()), (503, "shell"), "{p}");
            assert_eq!(v["kind"], "window_unanswered", "{p} {v}");
            assert!(v["error"].as_str().unwrap().contains("窓"), "窓の言葉: {v}");
            assert!(!v["error"].as_str().unwrap().contains("起こし直"), "中身を起こし直すとは言わない: {v}");
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
        assert_eq!(r.handle(&req("POST", "tpa://localhost/api/masters/access", b"{}")).status(), 403, "門番は前のまま");
        assert_eq!(*r.backend.0.lock().unwrap(), 0, "中身へ 1 度も回さない");
        let n = da_core::delegate::counts();
        assert!(n["unanswered GET /api/lotlist/settings"].as_u64().unwrap_or(0) >= 1, "回数を数える: {n}");
        assert!(n["unanswered_404 GET /api/sources/{s}/columns"].as_u64().unwrap_or(0) >= 1, "{n}");
    }

    #[test]
    fn decode() {
        assert_eq!(percent_decode("a%20b%E6%97%A5"), "a b日");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(percent_decode("%日本"), "%日本", "% の後ろが文字でも落ちない");
        assert_eq!(percent_decode("a%4"), "a%4");
    }
}
