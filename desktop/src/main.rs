//! LotScope（仕掛・作業実績・品質の見える化）デスクトップ版の窓（Tauri）。設計は program/docs/DESKTOP_MIGRATION_DESIGN.md。
//!
//! 役割の分け方（得意な分野ごと）:
//!   - Rust（この exe）: 窓・起動と終了・1つだけ起動・静的ファイル・中身（Python）の監督と起こし直し・外のリンク
//!   - Python（program/sidecar.py）: 画面と API（計算・LotDsp・マスタ・権限）。標準の部品だけで動く
//!   - 画面（WebView2）: program/app の HTML/JS/CSS。問い合わせは自前の仕組み（tpa）で Rust が受ける
//!
//! ポートを開かないので、プロキシ・ポートの取り合い・古いサーバーの残り・ハートビートによる推し量りが無い。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod brand;
mod frame;
mod lnk;
mod locate;
mod proc;
mod router;
mod sidecar;
mod updater;

use brand::brand;
use da_core::install;
use da_core::lot::Lot;
use da_core::update::{self, Paths};
use router::{error_reply, After, Backend, Guard, Native, Router};
use serde_json::json;
use sidecar::{Ask, Progress, Reply, Supervisor};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use updater::Updater;

/// 自前の仕組みの名前。program/sidecar.py の BASE_URL（http://tpa.localhost/）と同じ（食い違うと URL の組み立てがずれる）。
const SCHEME: &str = "tpa";
const SELFTEST_JS: &str = include_str!("selftest.js");
/// 自己診断が終わらないときの窓の見張り。窓の通し（desktop/bundle/verify.py の WAIT 480 秒）より短く、ふつうの自己診断（CI で約 130 秒・
/// 入れ替えて開き直す段は前の窓の分も含めて約 210 秒）より長く（版 3.99.0: 180 秒だと CI の遅い機械で入れ替えの段が先に切れ、
/// 版の番号の無い「180 秒で終わりませんでした」だけが書かれて、窓の通しの 3・5 段目が落ちた）
const SELFTEST_LIMIT: Duration = Duration::from_secs(400);
/// 終了（/api/shutdown）を受けてから窓を閉じるまで。答えが画面へ届いてから閉じる。
const QUIT_DELAY: Duration = Duration::from_millis(150);
/// 窓を閉じるとき、使い終わり（利用状況の印を消す）を待つ長さ
const LEAVE_WAIT: Duration = Duration::from_millis(500);
/// 品質異常・利用状況の係（窓を閉じるときに使い終わりを書くため）
static LOT: std::sync::OnceLock<Arc<Lot>> = std::sync::OnceLock::new();
/// 窓の × を押したとき（版 3.43.0）: 画面に「保存していない変更」が無いかを聞いてから閉じる（画面が tpa:close-requested を受け、
/// 無ければ・聞いて進むなら /api/shutdown で閉じる）。画面が答えない（読み込み前・止まっている）ときも閉じられるよう、
/// この長さのうちにもう一度 × を押せば、聞かずに閉じる。
const CLOSE_AGAIN: Duration = Duration::from_secs(5);

/// × を押した → 聞かずに閉じてよいか（前に押してから CLOSE_AGAIN のうちなら true）。押した時刻を覚える
fn close_now(last: &Mutex<Option<Instant>>, now: Instant) -> bool {
    let mut l = last.lock().unwrap_or_else(|e| e.into_inner());
    let again = l.is_some_and(|t| now.duration_since(t) < CLOSE_AGAIN);
    *l = Some(now);
    again
}

/// 自己診断のときだけ、画面の読み込みより前に入れる見張り（画面のエラーを残す。selftest.js が読む）。
const ERROR_WATCH_JS: &str = "window.__tpaErrors=[];addEventListener('error',e=>__tpaErrors.push(String(e.message||e.type)));\
addEventListener('unhandledrejection',e=>__tpaErrors.push('promise: '+String(e.reason&&(e.reason.message||e.reason))));";

/// 画面の置き場。Windows（WebView2）は http://tpa.localhost/、ほかは tpa://localhost/ になる（Tauri の決まり）。
fn app_url(path: &str) -> Url {
    let base = if cfg!(windows) { "http://tpa.localhost" } else { "tpa://localhost" };
    Url::parse(&format!("{base}{path}")).expect("app url")
}

fn is_app_url(u: &Url) -> bool {
    // tpa.localhost は http(s) のときだけ（版 3.52.1: file://tpa.localhost/… なども「アプリの中」と見ていた）
    u.scheme() == SCHEME || (matches!(u.scheme(), "http" | "https") && u.host_str() == Some("tpa.localhost"))
}

/// 起動画面（desktop/splash。Tauri が tauri://localhost で出す）
fn is_splash(u: &Url) -> bool {
    u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost")
}

fn selftest_on() -> bool {
    std::env::var_os("TPA_SELFTEST").is_some()
}

/// 窓の記録（この PC の作業場所の logs/desktop.log）。Python の記録（app.log・sidecar_stderr.log）とは別に、
/// 窓が確かめた事実（探した Python・起動の秒・終わり方）だけを残す。
fn log(line: &str) {
    let dir = locate::local_root().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("desktop.log")) {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{t} {line}");
    }
}

type AppRouter = Router<Supervisor>;

/// 起動画面へ伝えること。画面が読み終わる前の分はためておき、読み終わったら流す。
#[derive(Default)]
struct Splash {
    loaded: AtomicBool,
    queue: Mutex<Vec<String>>,
    /// 画面（アプリの頁）へ移った（版 3.86.0: 中身の準備を待たずに開くので、そのあとの知らせは起動画面へ流さない）
    left: AtomicBool,
}

impl Splash {
    fn say(&self, app: &AppHandle, js: String) {
        if self.left.load(Ordering::SeqCst) {
            return; // 画面の中に splash は無い（記録は呼んだ所が残す）
        }
        let mut q = self.queue.lock().unwrap();
        if self.loaded.load(Ordering::SeqCst) {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval(&js);
            }
        } else {
            q.push(js);
        }
    }
    fn flush(&self, w: &WebviewWindow) {
        let mut q = self.queue.lock().unwrap();
        self.loaded.store(true, Ordering::SeqCst);
        for js in q.drain(..) {
            let _ = w.eval(&js);
        }
    }
    fn step(&self, app: &AppHandle, id: &str, state: &str, detail: &str) {
        self.say(app, format!("splash.step(...{})", json!([id, state, detail])));
    }
    /// アプリの中身の版（program/app/version.py）。名乗りの下に出す
    fn version(&self, app: &AppHandle, version: &str) {
        self.say(app, format!("splash.version(...{})", json!([version])));
    }
    /// 窓が画面を開けない失敗（中身の置き場が無い・この PC へ写せない など）。自己診断はここで終える。
    /// 版 3.111.0 から Python の失敗（見つからない・起きない・遅い）ではここへ来ない（画面を開き、帯と心拍の python で見せる）
    fn fail(&self, app: &AppHandle, title: &str, detail: &str) {
        log(&format!("FAIL {title}: {}", detail.replace('\n', " / ")));
        // 画面を開いたあとの帯は、起こした結果の受け手（on_changed・band）が出す
        self.say(app, format!("splash.fail(...{})", json!([title, detail])));
        selftest_finish(app, &json!({"ok": false, "error": format!("{title}: {detail}")}));
    }
}

/// 中身（Python）を起こした結果を画面へ知らせる（版 3.111.0。2026-11-stage2b-ui.json で決めた I）。画面（app.js の setPython）が見出しのすぐ下の
/// 知らせの段・見出しの札「中身 停止」を描く（前は窓が画面の下に赤い 2 段の帯を差し込み、表の下の行を覆った）。心拍を待たずに知らせ、
/// 読み込み前の頁のためには window.__tpaPython にも置く。reason が None なら起きた
fn band(w: &WebviewWindow, reason: Option<&str>) {
    let detail = match reason {
        Some(e) => json!({"state": "stopped", "why": e}),
        None => json!({"state": "ready", "why": ""}),
    };
    let _ = w.eval(format!("window.__tpaPython={detail};window.dispatchEvent(new CustomEvent('tpa:python',{{detail:{detail}}}))"));
}

/// 中身の起こし直しの係（画面を読み直したときに帯を出し直す。版 3.86.0）
static SUP: OnceLock<Supervisor> = OnceLock::new();
/// 画面の JS が最初の心拍を送った時刻（版 3.111.0。入れ替えた直後の確かめの合図。src/boot.rs）
static FIRST_BEAT: OnceLock<Instant> = OnceLock::new();

/// 自己診断の結果を書いて終わる（TPA_SELFTEST が無ければ何もしない）。
fn selftest_finish(app: &AppHandle, result: &serde_json::Value) {
    if let Some(path) = std::env::var_os("TPA_SELFTEST") {
        let _ = std::fs::write(&path, serde_json::to_vec_pretty(result).unwrap_or_default());
        let code = if result["ok"] == true { 0 } else { 1 };
        app.exit(code);
    }
}

/// 窓そのものが答える問い合わせ（終了・窓の情報・自己診断の受け口・品質異常）。
fn native(app: AppHandle, info: serde_json::Value, lot: Arc<Lot>, upd: Arc<Updater>) -> Native {
    Box::new(move |req, backend| match (req.method, req.path) {
        // 画面の「終了」・版が混ざったときの「再起動する」。答えてから閉じる（中身の Python は入力が閉じて自分で終わる）
        ("POST", "/api/shutdown") => {
            let app = app.clone();
            // 使い終わり（いま使っているの印を消し、記録を最後まで書く。版 3.71.0）。共有が遅くても終わるのは待たない（QUIT_DELAY が上限）
            let bye = lot.clone();
            std::thread::spawn(move || bye.leave());
            std::thread::spawn(move || {
                std::thread::sleep(QUIT_DELAY);
                log("EXIT 画面の終了");
                app.exit(0);
            });
            Some(json_reply(&json!({"ok": true})))
        }
        // 中身の準備の知らせ（backend）は、問い合わせのたびに今の物（版 3.86.0: 画面は中身の準備を待たずに開く）
        // 画面の帯の「もう一度起こす」（版 3.86.0）
        ("POST", "/__desktop/backend/retry") => {
            backend.retry();
            Some(json_reply(&json!({"ok": true})))
        }
        // 版と更新履歴（版 3.88.0。src/small_reads.rs）: Python の準備を待たずに答える。?engine=python・焼いた更新履歴の版が中身と
        // 違う・無いときは Python に任せる
        (method @ ("GET" | "HEAD"), path @ ("/api/build" | "/api/changelog")) => {
            let program = std::path::PathBuf::from(info["program"].as_str().unwrap_or(""));
            da_core::small_reads::reply(method, path, req.query, &program).map(|(headers, body)| Reply { status: 200, headers, body })
        }
        // 生きているか（版 3.102.0。主のセッションの決め 5）: 窓が答え、Python の様子を添える（?engine=python は Python の道＝Python が答えているかの印）
        ("GET", "/api/health") if !da_core::lotlist::parse_query(req.query).iter().any(|(k, v)| k == "engine" && v == "python") => {
            Some(json_reply(&da_core::small_reads::health(backend.python_now().state)))
        }
        // program_version（版 3.111.0）は窓が読んだ中身の版（app/version.py）。Python が起きていなくても載る（自己診断・verify.py が使う）
        ("GET", "/__desktop/info") => {
            let mut v = info.clone();
            v["backend"] = backend.ready();
            v["python_state"] = json!(backend.python_now().state);
            Some(json_reply(&v))
        }
        // 更新の係（updater.rs）
        ("GET", "/__desktop/update") => Some(json_reply(&upd.status())),
        ("POST", "/__desktop/update/check") => {
            upd.wake();
            Some(json_reply(&json!({"ok": true})))
        }
        ("POST", "/__desktop/update/probe") => {
            let v: serde_json::Value = serde_json::from_slice(req.body).unwrap_or_default();
            Some(json_reply(&Updater::probe(v["value"].as_str().unwrap_or(""))))
        }
        // ショートカット（da_core::install・lnk.rs）
        ("GET", "/__desktop/install") => {
            Some(json_reply(&install::status(&upd.paths, &lnk::places(), &lnk::OsLinks, &names(), upd.installed)))
        }
        ("POST", "/__desktop/shortcut") => {
            Some(reply_of(install::make(&upd.paths, &lnk::places(), &lnk::OsLinks, &names()).map_err(|e| (400, e))))
        }
        ("POST", "/__desktop/shortcut/decline") => Some(reply_of(install::decline(&upd.paths).map_err(|e| (500, e)))),
        // 配布の画面（da_core::distribute・updater.rs）。置き場とだれが置いてよいかは窓が読む（版 3.95.0。Lot::update_settings。
        // 窓が同じ字にできない形だけ Python に尋ねる）
        // cached=1: 覚えた答え（裏の確認・前に開いたときにたどった物）をすぐ返す。画面はそのあと cached なしで確かめ直す
        ("GET", "/__desktop/release") => {
            let cached = da_core::lotlist::parse_query(req.query).iter().any(|(k, v)| k == "cached" && v == "1");
            Some(match update_settings(&lot, backend) {
                Ok(s) => json_reply(&upd.release_view(&s, cached)),
                Err(e) => Reply { status: 503, ..json_reply(&json!({"error": e})) },
            })
        }
        ("GET", "/__desktop/release/progress") => Some(json_reply(&upd.place_progress())),
        ("POST", "/__desktop/release/place") => {
            let name = da_core::lotlist::parse_query(req.query).into_iter().find(|(k, _)| k == "name").map(|(_, v)| v).unwrap_or_default();
            Some(reply_of(update_settings(&lot, backend).map_err(|e| (503, e)).and_then(|s| upd.place(&s, &name, req.body)).map(|r| {
                upd.wake();
                json!({"version": r["version"], "bytes": r["bytes"]})
            })))
        }
        ("POST", "/__desktop/release/distribute") => {
            let v: serde_json::Value = serde_json::from_slice(req.body).unwrap_or_default();
            let version = v["version"].as_str().unwrap_or("").to_string();
            Some(reply_of(update_settings(&lot, backend).map_err(|e| (503, e)).and_then(|s| upd.distribute(&s, &version))))
        }
        ("POST", "/__desktop/release/masters") => {
            let v: serde_json::Value = serde_json::from_slice(req.body).unwrap_or_default();
            let dir = v["dir"].as_str().unwrap_or("").to_string();
            Some(reply_of(update_settings(&lot, backend).map_err(|e| (503, e)).and_then(|s| upd.set_masters(&s, &dir))))
        }
        ("POST", "/__desktop/release/recommend") => {
            let v: serde_json::Value = serde_json::from_slice(req.body).unwrap_or_default();
            let (version, on, note) =
                (v["version"].as_str().unwrap_or("").to_string(), v["on"] == true, v["note"].as_str().unwrap_or("").to_string());
            Some(reply_of(update_settings(&lot, backend).map_err(|e| (503, e)).and_then(|s| upd.set_recommended(&s, &version, on, &note))))
        }
        ("POST", "/__desktop/release/remove") => {
            let v: serde_json::Value = serde_json::from_slice(req.body).unwrap_or_default();
            let version = v["version"].as_str().unwrap_or("").to_string();
            Some(reply_of(update_settings(&lot, backend).map_err(|e| (503, e)).and_then(|s| upd.remove(&s, &version))))
        }
        ("POST", "/__desktop/update/apply") => {
            if upd.status()["state"] != "ready" || !upd.installed {
                return Some(Reply {
                    status: 409, ..json_reply(&json!({"error": "開き直して入れ替える版がありません。"}))
                });
            }
            let ready = upd.status()["ready"].clone();
            log(&format!("UPDATE 開き直して {ready} にします"));
            Some(match relaunch(&app, &upd.paths) {
                Ok(()) => json_reply(&json!({"ok": true})),
                Err(e) => Reply { status: 500, ..json_reply(&json!({"error": e})) },
            })
        }
        // 版が混ざった画面が、押させずに開き直す（入口から開き直す。この PC の app が無い開発の形では開き直せない）
        ("POST", "/__desktop/restart") => {
            if !upd.installed {
                return Some(Reply {
                    status: 409,
                    ..json_reply(&json!({"error": "この PC のアプリ（app）から開いていないので、開き直せません。"}))
                });
            }
            log("RESTART 版が混ざったので開き直します");
            Some(reply_of(relaunch(&app, &upd.paths).map(|_| json!({"ok": true})).map_err(|e| (500, e))))
        }
        // 書き出したファイルの入ったフォルダを開き、そのファイルを選んだ状態にする（保存の案内の「フォルダを開く」）
        ("POST", "/__desktop/reveal") => {
            use tauri_plugin_opener::OpenerExt;
            let path = serde_json::from_slice::<serde_json::Value>(req.body)
                .ok()
                .and_then(|v| v["path"].as_str().map(str::to_string))
                .unwrap_or_default();
            if path.is_empty() || !std::path::Path::new(&path).exists() {
                return Some(Reply {
                    status: 404,
                    ..json_reply(&json!({"error": "そのファイルが見つかりません（移したか消したかもしれません）。"}))
                });
            }
            Some(match app.opener().reveal_item_in_dir(&path) {
                Ok(()) => json_reply(&json!({"ok": true})),
                Err(e) => Reply { status: 500, ..json_reply(&json!({"error": e.to_string()})) },
            })
        }
        ("GET", "/__desktop/downloads") => Some(json_reply(&json!(downloads().lock().map(|v| v.clone()).unwrap_or_default()))),
        ("POST", "/__desktop/selftest") => {
            let result: serde_json::Value =
                serde_json::from_slice(req.body).unwrap_or_else(|e| json!({"ok": false, "error": e.to_string()}));
            selftest_finish(&app, &result);
            Some(json_reply(&json!({"received": true})))
        }
        // 心拍（版 3.71.0。利用状況を書き〈裏の糸〉、古い版か・切断されているかを返す。中身が止まっていれば 503＝画面は「未接続」）
        // 版 3.111.0: 中身の様子では断らない（窓が生きていれば 200。python に様子を添える）。様子を尋ねるたびに止まった中身の起こし直しも
        // 始める（Backend::python_now）。最初の心拍は「画面の JS が起きた」合図（入れ替えた直後の確かめ。src/boot.rs）
        ("POST", "/api/heartbeat") => {
            if FIRST_BEAT.set(Instant::now()).is_ok() {
                log("BEAT 画面の最初の心拍");
            }
            lot.heartbeat(&|| lot_settings(backend), &|| backend.python_now()).map(|(status, v)| Reply { status, ..json_reply(&v) })
        }
        // 画面（版 3.85.0。src/page.rs）: Python が答えなくても画面の HTML は窓が描く。描けない形は Python へ回す
        // （?engine=python は Python が描く。自己診断が 2 つの画面を突き合わせる）
        (method @ ("GET" | "HEAD"), "/")
            if !da_core::lotlist::parse_query(req.query).iter().any(|(k, v)| k == "engine" && v == "python") =>
        {
            let r = lot.page(method == "HEAD", &|| backend.ready_now()).map(|h| Reply { status: 200, headers: h.headers, body: h.body });
            if r.is_none() {
                log(&format!("PAGE python {}", lot.page_why())); // 窓が画面を描けなかった理由（Python が描く）
                da_core::delegate::note("page");
            }
            r
        }
        // LotDsp の調べる道具の画面（版 3.98.0）: 窓がただ 1 つの係（Python に任せない。型を描けなければ 500）
        (method @ ("GET" | "HEAD"), "/lotdsp-link") => Some(match lot.lotdsp_page(method == "HEAD") {
            Some(h) => Reply { status: 200, headers: h.headers, body: h.body },
            None => Reply {
                status: 500, ..json_reply(&json!({"error": "調べる道具の画面を描けません（型が読めません）。"}))
            },
        }),
        // 権限の読む 2 本（版 3.76.0。窓の me から答える。中身が答えなければ Python へ回す＝前と同じ失敗）
        // 版 3.111.0: 中身（Python）が止まっていても窓の me で答える（出さないタブ・権限の札・マスタ管理の入口が Python に依らない）
        (method @ "GET", path @ ("/api/access/me" | "/api/masters/access")) => {
            lot.access_read(method, path, &|| lot_settings(backend)).map(|(status, v)| Reply { status, ..json_reply(&v) })
        }
        // データ元の並び（版 3.87.0。src/sources_list.rs）: 見出しのタブを Python の準備を待たずに描く。スケジュールのカードは
        // Python の覚え（プロセスのメモリ）なので、中身が起きているときだけ尋ねる（起きていなければ起こした直後と同じ形）
        ("GET", "/api/sources") => lot.sources_list(req.query).map(|(status, v)| Reply { status, ..json_reply(&v) }),
        (method, path) => lot.handle_body(method, path, req.query, req.body, &|| lot_settings(backend)).map(|(status, v)| {
            // 参照先の更新の置き場を窓が書いた（版 3.89.0。Python が書いたときの after と同じ）: すぐ確かめる
            if method == "PUT" && status == 200 && path.starts_with("/api/settings/update.") {
                upd.wake();
            }
            Reply { status, ..json_reply(&v) }
        }),
    })
}

/// 品質異常の設定を中身（Python）に尋ねる（lot.rs が 10 秒覚える）。
fn lot_settings(backend: &dyn Backend) -> Result<serde_json::Value, String> {
    let r = backend.ask(&Ask { method: "GET", path: "/api/lotlist/settings", query: "", headers: vec![], body: &[] });
    if r.status != 200 {
        return Err(format!("一覧の設定を読めません（{}）", r.status));
    }
    serde_json::from_slice(&r.body).map_err(|e| e.to_string())
}

/// 更新の置き場の設定（置き場・だれが・マスタの置き場）。版 3.95.0 から窓が読む（src/release_place.rs・Lot::update_settings。
/// Python が起きていなくても更新を確かめ、配布の操作が 503 にならない）。窓が同じ字にできない形だけ中身（Python）に尋ねる
fn update_settings(lot: &Lot, backend: &dyn Backend) -> Result<serde_json::Value, String> {
    match lot.update_settings() {
        Some(v) => Ok(v),
        None => {
            da_core::delegate::note("update_settings"); // 窓が同じ字にできない更新の置き場（版 3.102.0。形の名前と回数だけ数える）
            ask_update_settings(backend)
        }
    }
}

/// 更新の置き場の設定を中身（Python）に尋ねる（窓が組めない形）
fn ask_update_settings(backend: &dyn Backend) -> Result<serde_json::Value, String> {
    let r = backend.ask(&Ask { method: "GET", path: "/api/update/settings", query: "", headers: vec![], body: &[] });
    if r.status != 200 {
        return Err(format!("更新の設定を読めません（{}）", r.status));
    }
    serde_json::from_slice(&r.body).map_err(|e| e.to_string())
}

/// 中身へ回す前: 権限を決めて門番に通し、決めた me を見出しに載せる（版 3.65.0。src/access.rs・Lot::access_check）
fn guard(lot: Arc<Lot>) -> Guard {
    Box::new(move |req, backend| {
        lot.access_check(req.method, req.path, &|| lot_settings(backend))
            .map_err(|(status, kind, message)| error_reply(status, kind, &message))
    })
}

/// 中身が答えたあとに窓が見ること: 一覧の設定に効くマスタを保存したら、一覧の設定と権限の覚えを捨てる（元ファイル・間隔・段取りの材料・権限をすぐ当て直す）。
/// 更新の置き場を保存したら、すぐ確かめる。
fn after(lot: Arc<Lot>, upd: Arc<Updater>) -> After {
    Box::new(move |method, path, status| {
        lot.after_python(method, path, status);
        if method == "PUT" && status == 200 && path.starts_with("/api/settings/update.") {
            upd.wake();
        }
    })
}

/// 入口（この PC の app の exe）で開き直して、この窓を閉じる。入口はこの窓が終わるのを待ってから、版ごとの写しへ渡す。
fn relaunch(app: &AppHandle, paths: &Paths) -> Result<(), String> {
    let entry = paths.app().join(&brand().exe);
    std::process::Command::new(&entry)
        .args(["--wait-pid", &std::process::id().to_string()])
        .current_dir(paths.app())
        .spawn()
        .map_err(|e| format!("開き直せません（{}）: {e}", entry.display()))?;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_DELAY);
        log("EXIT 開き直す（入口へ渡した）");
        app.exit(0);
    });
    Ok(())
}

/// 結果 → 答え（失敗は状態と {error}）。
fn reply_of(r: Result<serde_json::Value, (u16, String)>) -> Reply {
    match r {
        Ok(v) => json_reply(&v),
        Err((status, e)) => Reply { status, ..json_reply(&json!({"error": e})) },
    }
}

/// ショートカットの名前（いまのアプリ名と、前の名前: brand.json の legacy_names）とアイコン。
fn names() -> install::Names<'static> {
    let b = brand();
    install::Names { name: &b.name, exe: &b.exe, description: &b.subtitle, legacy: &b.legacy_names, icon: shortcut_icon().clone() }
}

/// exe に入れたアイコンの絵（build.rs が program/app/app_icon.py で描く）。
const ICON: &[u8] = include_bytes!("../icons/icon.ico");

/// ショートカットが指すアイコン: 作業場所の icon\<絵の指紋>.ico（絵が変わると場所も変わり、Windows が古い絵を出し続けない）。
/// 書けなければ、これまでどおり app の exe の中の絵。
fn shortcut_icon() -> &'static std::path::PathBuf {
    static I: OnceLock<std::path::PathBuf> = OnceLock::new();
    I.get_or_init(|| {
        let p = Paths::new(&locate::local_root());
        install::icon_file(&p, ICON).unwrap_or_else(|e| {
            log(&format!("SHORTCUT アイコンを書き出せません（exe の絵を使います）: {e}"));
            p.app().join(&brand().exe)
        })
    })
}

fn json_reply(v: &serde_json::Value) -> Reply {
    Reply {
        status: 200,
        headers: vec![("Content-Type".into(), "application/json".into())],
        // 大きな整数は桁のまま（src/held.rs の持っている値。版 3.108.0。Python の jsonify と同じ）
        body: da_core::held::reply_bytes(v),
    }
}

/// 窓を作る（主の窓・別の窓で同じ決まり: 外のリンクはいつものブラウザで開く）。
fn window(app: &AppHandle, label: &str, url: WebviewUrl, splash: Arc<Splash>) -> tauri::Result<WebviewWindow> {
    let handle = app.clone();
    let nav = app.clone();
    let b = brand();
    let builder = WebviewWindowBuilder::new(app, label, url)
        .title(format!("{} — {}", b.name, b.subtitle))
        .inner_size(1600.0, 1000.0)
        .min_inner_size(1100.0, 700.0)
        .maximized(label == "main")
        // 起動画面・画面の見出しと同じ藍（開いた瞬間の白い光りを出さない）
        .background_color(tauri::window::Color(0x1c, 0x35, 0x50, 0xff))
        // 画面がファイルのドロップを読めるように（Tauri は既定で窓へのドロップを横取りする）
        .disable_drag_drop_handler()
        .on_navigation(move |u| {
            let inside = is_app_url(u) || is_splash(u) || matches!(u.scheme(), "about" | "blob" | "data");
            if !inside {
                open_outside(&nav, u);
            }
            inside
        })
        .on_new_window(move |u, _features| {
            if is_app_url(&u) {
                let app = handle.clone();
                let s = Arc::new(Splash::default());
                let label =
                    format!("w{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
                // 窓は作り終えてから（呼ばれている最中に作ると止まることがある）
                std::thread::spawn(move || {
                    let _ = window(&app, &label, WebviewUrl::External(u), s);
                });
            } else {
                open_outside(&handle, &u);
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |w, p| {
            if p.event() != PageLoadEvent::Finished {
                return;
            }
            if is_splash(p.url()) {
                splash.flush(&w);
            } else if is_app_url(p.url()) && p.url().path() == "/" {
                // 中身を起こせなかったままなら、読み直した画面にも知らせる（知らせの段）
                if let Some(e) = SUP.get().and_then(|s| s.down_reason()) {
                    band(&w, Some(&e));
                }
                if selftest_on() {
                    let _ = w.eval(SELFTEST_JS);
                }
            }
        });
    // 保存（書き出し）を見届け、置いた場所を画面へ知らせる（画面が「保存しました・フォルダを開く」を出す）。
    // WebView2 の既定の保存の案内は小さくすぐ消え、どこに置いたか分からなかったため。自己診断のときは画面のエラーも残す
    let builder = builder.on_download(|wv, ev| on_download(&wv, ev));
    let builder = if selftest_on() { builder.initialization_script(ERROR_WATCH_JS) } else { builder };
    builder.build()
}

/// LotDsp など外のページは、いつものブラウザ（Edge）で開く（ログインはそちらにある）。
/// 開くのは http・https・mailto だけ（版 3.52.1。脆弱性: file: を許すと、画面で JS が動いたときに
/// 共有フォルダの exe・.bat などを ShellExecute で開かせられた。フォルダを開くのは /__desktop/reveal が受け持つ）
fn open_outside(app: &AppHandle, u: &Url) {
    if outside_ok(u) {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_url(u.as_str(), None::<&str>);
    }
}

/// 保存（ダウンロード）の記録。自己診断のとき、`/__desktop/downloads` が自己診断へ渡す。
fn downloads() -> &'static Mutex<Vec<serde_json::Value>> {
    static D: OnceLock<Mutex<Vec<serde_json::Value>>> = OnceLock::new();
    D.get_or_init(Mutex::default)
}

/// 保存の始まりと終わり。終わったら置いた場所を画面へ知らせる（tpa:saved。shared.js が受けて案内を出す）。
/// 保存先は変えない（既定の「ダウンロード」）。自己診断のときは、置いた先・大きさ・先頭4バイトを記録する。
fn on_download<R: tauri::Runtime>(wv: &tauri::Webview<R>, ev: DownloadEvent<'_>) -> bool {
    if let DownloadEvent::Finished { path, success, .. } = &ev {
        let detail = json!({"path": path.as_ref().map(|p| p.display().to_string()), "ok": *success});
        let _ = wv.eval(format!("window.dispatchEvent(new CustomEvent('tpa:saved', {{detail: {detail}}}))"));
    }
    if selftest_on() {
        record_download(ev);
    }
    true
}

fn record_download(ev: DownloadEvent<'_>) -> bool {
    let row = match ev {
        DownloadEvent::Requested { url, destination } => {
            json!({"state": "requested", "url": url.as_str(), "path": destination.display().to_string()})
        }
        DownloadEvent::Finished { url, path, success } => {
            let body = path.as_ref().and_then(|p| std::fs::read(p).ok()).unwrap_or_default();
            let head: String = body.iter().take(4).map(|b| format!("{b:02x}")).collect();
            json!({"state": "finished", "url": url.as_str(), "path": path.map(|p| p.display().to_string()),
                   "success": success, "bytes": body.len(), "head": head})
        }
        _ => return true,
    };
    log(&format!("DOWNLOAD {row}"));
    if let Ok(mut v) = downloads().lock() {
        v.push(row);
    }
    true
}

/// 中身（program）を見つけ、入れ替えた直後なら窓の準備で確かめ（src/boot.rs）、中身（Python）を裏で起こし始めて、待たずに主の窓を画面へ
/// 切り替える（裏の糸で。窓は先に出しておく）。版 3.111.0 から Python が見つからない・起きない・遅いときも画面を開く。
fn start(app: AppHandle, slot: Arc<OnceLock<AppRouter>>, splash: Arc<Splash>) {
    if let Some(j) = job().get() {
        if run_job(&app, &splash, j) {
            return;
        }
    }
    let program = match locate::program_dir() {
        Ok(p) => p,
        Err(e) => return splash.fail(&app, "アプリの中身が見つかりません", &e),
    };
    splash.step(&app, "program", "ok", &program.display().to_string());
    // この PC のアプリ（app）で動いているなら、取り込み済みの版で入れ替える（Python を起こす前・updater.rs / update.rs）
    let paths = Paths::new(&locate::local_root());
    let installed = same_dir(&program, &paths.app().join("program"));
    let mut notes = vec![];
    if installed {
        launch_update(&app, &splash, &paths, &mut notes);
        match update::apply_staged(&paths, &brand().exe) {
            Ok(Some(a)) => {
                log(&format!("UPDATE {} → {} に入れ替えました", a.from, a.to));
                splash.step(&app, "program", "ok", &format!("版 {} → {} に入れ替えました", a.from, a.to));
                if a.exe_changed {
                    splash.step(&app, "open", "now", "窓も新しくなったので、開き直しています…");
                    if relaunch(&app, &paths).is_ok() {
                        return;
                    }
                }
            }
            Ok(None) => {}
            Err(e) => {
                log(&format!("UPDATE 入れ替えられません: {e}"));
                notes.push(format!("新しい版に入れ替えられませんでした（次に開いたときにもう一度試します）: {e}"));
            }
        }
    }
    // 版は入れ替えたあとの物（中身を起こす前に、名乗りの下へ）
    let program_version = update::program_version(&program);
    if let Some(v) = &program_version {
        splash.version(&app, v);
    }
    // 窓の準備（版 3.111.0。src/boot.rs）: 入れ替えた直後の版を、Python の準備ではなく窓が読む物だけで確かめる（数 ms）。
    // 入れ替えた直後の印が残っている（前の起動が確かめる前に閉じた）起動も同じ。通らなければ画面を開く前に控えへ戻して開き直す
    let applied = installed && paths.applied().exists();
    let window = da_core::boot::window_ready(&program, &brand().app_id);
    if let Err(b) = &window {
        log(&format!("BOOT 窓の準備が通りません: {b}"));
    }
    let plan = da_core::boot::decide(&da_core::boot::Facts {
        installed,
        applied,
        window_ok: window.is_ok(),
        page: da_core::boot::Page::NotOpened,
        python: da_core::boot::Python::Starting,
    });
    if applied || window.is_err() {
        log(&format!("BOOT installed={installed} applied={applied} → {}", plan.iter().map(|a| a.name()).collect::<Vec<_>>().join(",")));
    }
    if plan.contains(&da_core::boot::Act::Revert) {
        let why = window.as_ref().err().map(|b| b.detail.clone()).unwrap_or_default();
        if let Some(back) = update::revert(&paths, &why) {
            log(&format!("UPDATE 版 {} は窓が開けないので {} に戻しました: {why}", back.from, back.to));
            splash.step(&app, "program", "warn", &format!("版 {} は開けないので、前の版 {} に戻して開き直します", back.from, back.to));
            if relaunch(&app, &paths).is_ok() {
                return;
            }
        }
        log("BOOT 控えへ戻せないので、この版のまま開きます");
    }
    // Python（版 3.111.0: 見つからなくても画面は開く。中身の係は理由を持って Down になり、帯と心拍の python: stopped で見せる）
    let py = locate::python();
    let py_text = match &py {
        Ok(p) => {
            let t = format!("{} {}", p.exe.display(), p.args.join(" ")).trim().to_string();
            splash.step(&app, "python", "ok", &t);
            t
        }
        Err(e) => {
            splash.step(&app, "python", "warn", "見つかりません（画面は開きます。中身の要る所だけ使えません）");
            format!("（見つかりません） {}", e.lines().next().unwrap_or(""))
        }
    };
    log(&format!("START program={} python={py_text}", program.display()));
    splash.step(&app, "backend", "now", "Python でアプリの中身を読み込んでいます…");
    let (app_p, splash_p) = (app.clone(), splash.clone());
    let progress: Progress = Arc::new(move |h| {
        let text = h["text"].as_str().unwrap_or("起動前の確認をしています");
        splash_p.step(&app_p, "backend", if h["bad"] == true { "warn" } else { "now" }, text);
    });
    let version = program_version.clone().unwrap_or_else(|| "?".into());
    let sup = Supervisor::new(py, program.clone(), locate::local_root().join("logs"), progress);
    let _ = SUP.set(sup.clone());
    let sup_for_boot = sup.clone();
    let t0 = Instant::now();
    // 起こした結果（最初・止まったあとの起こし直し・「もう一度」）: 記録に残し、画面を開いたあとは帯を出す・消す
    let (app_c, splash_c) = (app.clone(), splash.clone());
    sup.on_changed(Arc::new(move |r| {
        match r {
            Ok(ready) => log(&format!(
                "READY version={} elapsed={:.2} spawn_ms={}",
                ready["version"].as_str().unwrap_or("?"),
                ready["elapsed"].as_f64().unwrap_or(0.0),
                t0.elapsed().as_millis()
            )),
            Err(e) => log(&format!("BACKEND 起こせません: {}", e.replace('\n', " / "))),
        }
        if splash_c.left.load(Ordering::SeqCst) {
            if let Some(w) = app_c.get_webview_window("main") {
                band(&w, r.err());
            }
        }
    }));
    // 中身（Python）は裏の糸で起こし、準備を待たずに画面を開く（版 3.86.0。版 3.111.0 から入れ替えた直後も待たない）
    let s2 = sup.clone();
    let _ = std::thread::Builder::new().name("sidecar-first".into()).spawn(move || {
        if s2.get().is_ok() {
            // 起こした物と本物が違えば、入口（別名の python.exe）を通っている（止めるときは本物を待つ）
            if let Some((spawned, Some(real))) = s2.up().map(|s| s.pids()) {
                log(&format!("PID 起こした {spawned}・本物の Python {real}"));
            }
        }
    });

    let info = json!({
        "shell": "tauri", "app_id": brand().app_id, "shell_version": env!("CARGO_PKG_VERSION"), "commit": env!("TPA_BUILD_COMMIT"), "protocol": sidecar::PROTOCOL,
        "serves": sidecar::SERVES, "program": program, "python": py_text, "local_root": locate::local_root(),
        "exe": std::env::current_exe().unwrap_or_default(), "backend": null, "url": app_url("/").as_str(),
        "installed": installed, "app": paths.app(), "program_version": program_version,
        "window_ready": window.as_ref().err().map(|b| b.to_string()),
    });
    let upd = Updater::new(paths.clone(), installed, version.clone(), notes);
    let static_dir = program.join("app").join("static");
    // 品質異常（写しは作業場所の db_cache・Python と同じ台帳）
    let lot = Arc::new(Lot::new(locate::local_root().join("db_cache")));
    // 窓が Python に任せた・断った回数（形の名前と回数だけ。版 3.102.0。src/delegate.rs）
    da_core::delegate::set_dir(locate::local_root().join("logs"));
    lot.set_program(program.clone()); // 利用状況に書く版（中身の版。更新で入れ替わる）
                                      // 設定の束は窓が組む（版 3.84.0。src/bundle.rs）。組めない形だけ中身（Python）に尋ねる
    lot.set_bundle(da_core::bundle::Builder::new(da_core::bundle::Env::production(&program, &locate::local_root())));
    let _ = LOT.set(lot.clone()); // 窓を閉じるときの使い終わり（RunEvent::Exit）
                                  // 起動の初期値（版 3.110.0。src/seeds.rs）: 置き場が決まってから（束の材料が引っ越しの印をたどった後）、裏の糸で 1 回だけ当てる。
                                  // 錠を 1 秒おきに 5 回まで待つのはこの糸だけ（画面の問い合わせの道では待たない）。Python に尋ねない
    let seeds_lot = lot.clone();
    let _ = std::thread::Builder::new().name("seeds".into()).spawn(move || match seeds_lot.run_seeds(&std::thread::sleep) {
        Ok(o) => log(&format!("SEEDS applied={:?} stopped={:?} skipped={:?}", o.applied, o.stopped, o.skipped)),
        Err(e) => log(&format!("SEEDS 当てずに次の起動へ: {e}")),
    });
    std::thread::spawn(da_core::lotdsp_direct::sweep_profiles); // 前に落ちた窓が残した見えない Edge の一時プロファイルを消す（版 3.98.0）
                                                                // 受け身の Python からの「写して」（作業実績・データ元の写しが要るとき。版 3.60.0）
    let told = lot.clone();
    sup.on_notice(Arc::new(move |h| told.notice(h)));
    let _ = slot.set(Router {
        static_dir,
        backend: sup,
        native: native(app.clone(), info, lot.clone(), upd.clone()),
        guard: guard(lot.clone()),
        after: after(lot.clone(), upd.clone()),
    });
    // 更新の係: 使っている間に置き場を確かめ、新しい版を取り込んでおく（入れ替えは次の起動の最初。起動の最初にも確かめる: launch_update）
    // 置き場は窓が読む（版 3.95.0）。窓が組めない形だけ中身に尋ねる（起きるまでは「起動中です」）
    let (ask_slot, upd_lot) = (slot.clone(), lot.clone());
    upd.run(
        move || match upd_lot.update_settings() {
            Some(v) => Ok(v),
            None => {
                da_core::delegate::note("update_settings");
                ask_slot.get().ok_or("起動中です".to_string()).and_then(|r| ask_update_settings(&r.backend))
            }
        },
        log,
    );
    // 起動の直後から写し始める（一覧を開いたときに待たせない）
    let warm = slot.clone();
    std::thread::spawn(move || {
        if let Some(r) = warm.get() {
            lot.warm(&|| lot_settings(&r.backend));
        }
    });
    splash.step(&app, "open", "now", "画面を開いています…");
    if let Some(w) = app.get_webview_window("main") {
        // 画面を開いたあとは、起動前の確認の進み具合を起動画面へ流さない（画面の中で splash は動かない）
        splash.left.store(true, Ordering::SeqCst);
        log(&format!(
            "OPEN 画面を開きます ms={} backend={}",
            t0.elapsed().as_millis(),
            if slot.get().is_some_and(|r| r.backend.ready_now()) { "ready" } else { "starting" }
        ));
        let _ = w.navigate(app_url("/"));
    }
    // 入れ替えた直後: 画面の最初の心拍を待って確かめる。そうでなければ手入れはすぐ（版 3.111.0。前は Python の準備のあと）
    if plan.contains(&da_core::boot::Act::AwaitBeat) {
        let (a, s3) = (app.clone(), sup_for_boot);
        let opened = Instant::now();
        let _ = std::thread::Builder::new().name("boot-beat".into()).spawn(move || await_beat(a, paths, s3, opened));
    } else {
        settle(&paths, &plan);
    }
}

/// 入れ替えた直後の確かめ（版 3.111.0。src/boot.rs の decide）: 画面を開いたあと、画面の JS の最初の心拍を待つ。来れば確かめの印を消し・
/// ショートカットを直し・写しを片付ける。BEAT_LIMIT を過ぎても来なければ（Python を起こしている最中を除き）控えへ戻して開き直す
fn await_beat(app: AppHandle, paths: Paths, sup: Supervisor, opened: Instant) {
    use da_core::boot::{decide, Act, Facts, Page};
    loop {
        let page = if FIRST_BEAT.get().is_some() {
            Page::Beat
        } else if opened.elapsed() < da_core::boot::BEAT_LIMIT {
            Page::Waiting
        } else {
            Page::Late
        };
        let python = python_fact(&sup);
        let acts = decide(&Facts { installed: true, applied: paths.applied().exists(), window_ok: true, page, python });
        if acts == [Act::AwaitBeat] {
            std::thread::sleep(Duration::from_millis(250));
            continue;
        }
        if !acts.is_empty() {
            log(&format!(
                "BOOT 画面 {page:?}・Python {} ms={} → {}",
                python.name(),
                opened.elapsed().as_millis(),
                acts.iter().map(|a| a.name()).collect::<Vec<_>>().join(",")
            ));
        }
        if acts.contains(&Act::Revert) {
            let why = format!("画面の JS が {} 秒たっても起きません（最初の心拍が来ません）", da_core::boot::BEAT_LIMIT.as_secs());
            if let Some(back) = update::revert(&paths, &why) {
                log(&format!("UPDATE 版 {} は画面が起きないので {} に戻しました", back.from, back.to));
                if relaunch(&app, &paths).is_ok() {
                    return;
                }
            }
            log("BOOT 控えへ戻せないので、この版のまま使います");
            return;
        }
        settle(&paths, &acts);
        return;
    }
}

/// 決めの材料の Python の様子（起こし直しはしない）
fn python_fact(sup: &Supervisor) -> da_core::boot::Python {
    use da_core::boot::Python;
    if sup.up().is_some() {
        Python::Ready
    } else if sup.starting() {
        Python::Starting
    } else if !sup.has_python() {
        Python::Missing
    } else {
        Python::Down
    }
}

/// 決めた手入れ（確かめの印を消す・ショートカット・写しの片付け）を行う
fn settle(paths: &Paths, acts: &[da_core::boot::Act]) {
    use da_core::boot::Act;
    if acts.contains(&Act::Confirm) {
        update::confirm(paths);
        log("BOOT 入れ替えた版を確かめた（画面の最初の心拍）");
    }
    if acts.contains(&Act::Maintain) {
        // ショートカットの指す先・作業フォルダ・アイコンを直す（共有の exe を指す物・前の名前の物・前の絵の物。消された物は作り直さない）
        std::thread::spawn(|| {
            let p = Paths::new(&locate::local_root());
            for f in install::maintain(&p, &lnk::places(), &lnk::pinned(), &lnk::OsLinks, &names()) {
                log(&format!("SHORTCUT {f}"));
            }
        });
    }
    if acts.contains(&Act::Cleanup) {
        if let Ok(me) = std::env::current_exe() {
            std::thread::spawn(move || update::cleanup_copies(&Paths::new(&locate::local_root()), &me));
        }
    }
}

/// 起動の最初に置き場を確かめるとき、置き場に届くのを待つ長さ（過ぎたら待たずに開き、裏の確かめに任せる）。
const LAUNCH_CHECK_WAIT: Duration = Duration::from_secs(8);

/// 起動の最初（中身を起こす前）: 控えた置き場に新しい版（配る版）があれば、その場で取り込む（このあと apply_staged が入れ替える）。
/// 起動していない間に配った版も、ショートカットから 1 回開くだけで入る（以前は 1 回目で取り込み、2 回目で入れ替わった）。
fn launch_update(app: &AppHandle, splash: &Splash, paths: &Paths, notes: &mut Vec<String>) {
    let source = updater::source_with_entry(paths, &update::remembered_source(paths).unwrap_or_default());
    if source.trim().is_empty() {
        return;
    }
    let current = update::program_version(&paths.app().join("program")).unwrap_or_default();
    splash.step(app, "program", "now", "新しい版が配られていないか確かめています…");
    let progress = |t: &str| splash.step(app, "program", "now", &format!("{t}…"));
    match update::launch_check(paths, &source, &brand().app_id, &current, LAUNCH_CHECK_WAIT, &progress) {
        update::Launch::Staged(v) => log(&format!("UPDATE 起動の最初に版 {v} を取り込みました")),
        update::Launch::Nothing(why) => log(&format!("UPDATE 起動の最初の確かめ: {why}")),
        update::Launch::Slow => {
            log(&format!("UPDATE 起動の最初の確かめ: 置き場に {} 秒で届かないので、裏で確かめます", LAUNCH_CHECK_WAIT.as_secs()))
        }
        update::Launch::Failed(e) => {
            log(&format!("UPDATE 起動の最初の確かめ: {e}"));
            notes.push(format!("{e}（使っている間に、もう一度試します）"));
        }
    }
}

fn same_dir(a: &std::path::Path, b: &std::path::Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// 引数 `--name <数>`。
/// 作業場所の名前を変えた版（3.19.0。brand.json の legacy_data_dir）: 前の名前の場所から中身を移す（da_core::home）。
/// 前の場所から動いている exe は自分のいる場所を動かせないので、新しい場所へ自分を写し、写した物（--moved-from）に移してもらう。
/// 移す係は移し終えたら（移せなければ前の場所のまま --no-move で）この PC のアプリを開いて終わる。→ 自分は終わるか
fn settle_home(me: &std::path::Path) -> bool {
    let Some((new, legacy)) = locate::home_roots() else { return false };
    let mover = arg_str("--moved-from").is_some();
    let pid = std::process::id().to_string();
    if !std::env::args().any(|a| a == "--no-move") {
        let inside = |d: &std::path::Path| {
            me.starts_with(d) || std::fs::canonicalize(me).is_ok_and(|m| std::fs::canonicalize(d).is_ok_and(|d| m.starts_with(d)))
        };
        for old in legacy.iter().filter(|d| d.is_dir()) {
            if inside(old) {
                let copy = new.join("desktop").join(format!("move-{pid}")).join(me.file_name().unwrap_or_default());
                let spawned =
                    std::fs::create_dir_all(copy.parent().unwrap_or(&new)).and_then(|_| std::fs::copy(me, &copy)).and_then(|_| {
                        std::process::Command::new(&copy)
                            .args(["--moved-from", &old.display().to_string(), "--wait-pid", &pid])
                            .current_dir(copy.parent().unwrap_or(&new))
                            .spawn()
                    });
                match spawned {
                    Ok(_) => {
                        log(&format!("HOME {} から {} へ移すため、写した exe へ渡しました", old.display(), new.display()));
                        return true;
                    }
                    Err(e) => log(&format!("HOME 移す係を起こせないので、{} のまま開きます: {e}", old.display())),
                }
                continue;
            }
            match da_core::home::move_home(old, &new, Duration::from_secs(20)) {
                Ok(kept) => {
                    log(&format!("HOME {} の中身を {} へ移しました", old.display(), new.display()));
                    for k in kept {
                        log(&format!("HOME 残した物: {k}"));
                    }
                }
                Err(e) => log(&format!("HOME 移せないので、{} のまま開きます（次の起動でまた移します）: {e}", old.display())),
            }
        }
    }
    if !mover {
        return false;
    }
    // 移す係: この PC のアプリ（移せていれば新しい場所・移せなければ前の場所）を開いて終わる
    let app = Paths::new(&locate::local_root()).app();
    let names = [brand().exe.clone(), me.file_name().unwrap_or_default().to_string_lossy().to_string()];
    let Some(entry) = names.iter().map(|n| app.join(n)).find(|e| e.is_file()) else {
        log(&format!("HOME 開くアプリが {} にありません", app.display()));
        return false;
    };
    let moved = app.starts_with(&new);
    let mut args = vec!["--wait-pid".to_string(), pid];
    if !moved {
        args.push("--no-move".into());
    }
    std::process::Command::new(&entry).args(&args).current_dir(&app).spawn().is_ok()
}

fn arg_str(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn arg_u32(name: &str) -> Option<u32> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok())
}

/// 開発の作業ツリー（program の隣に .git）・引き継がない指定（--here・TPA_NO_HANDOFF）。この PC へ写さず、そのまま動く。
fn dev_mode() -> bool {
    std::env::args().any(|a| a == "--here")
        || std::env::var_os("TPA_NO_HANDOFF").is_some()
        || locate::program_dir().is_ok_and(|p| p.parent().is_some_and(|r| r.join(".git").exists()))
}

/// 起動のはじめ（窓を作る前）: 入口なら版ごとの写しへ渡し、共有などの配る形ならこの PC へ写してから入口を開く。
/// 渡したら true（この exe は終わる）。
/// 窓の中で（起動画面に段を出しながら）する、この PC へ写す仕事。
#[derive(Debug)]
enum Job {
    /// 共有・BOX・展開したフォルダの配る形をこの PC の app へ写す
    Localize(std::path::PathBuf),
    /// 配る入口（置き場のアプリのフォルダ）から、配る版を取り込んで app に据える
    Entry(std::path::PathBuf),
}

fn job() -> &'static OnceLock<Job> {
    static J: OnceLock<Job> = OnceLock::new();
    &J
}

/// app の exe（入口）を、この exe が終わるのを待つ印つきで起こす。
fn spawn_entry(paths: &Paths) -> Result<(), String> {
    let entry = paths.app().join(&brand().exe);
    std::process::Command::new(&entry)
        .args(["--wait-pid", &std::process::id().to_string()])
        .current_dir(paths.app())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("この PC のアプリを開けません（{}）: {e}", entry.display()))
}

/// 窓の中でする仕事（写す・取り込む）。済めば入口を開いて窓を閉じ true。写せなければ理由を出す。
fn run_job(app: &AppHandle, splash: &Splash, job: &Job) -> bool {
    let b = brand();
    let paths = Paths::new(&locate::local_root());
    let result = match job {
        Job::Localize(dist) => {
            let version = update::validate_dist(dist, &b.exe, &b.app_id, None).unwrap_or_default();
            if !update::should_localize(&paths, &version) {
                Ok(format!("この PC のアプリ（{}）で開きます", paths.app().display()))
            } else {
                splash.step(app, "program", "now", &format!("この PC へ写しています（{} → {}）…", dist.display(), paths.app().display()));
                update::localize(&paths, dist, &b.exe, &b.app_id).map(|v| {
                    log(&format!("INSTALL {} からこの PC へ写しました（版 {v}）", dist.display()));
                    format!("版 {v} をこの PC へ写しました")
                })
            }
        }
        Job::Entry(folder) => {
            splash.step(app, "program", "now", &format!("配る版を確かめています（{}）…", folder.display()));
            let (a, s) = (app.clone(), splash);
            da_core::distribute::install_from_entry(&paths, folder, &b.app_id, &|t| s.step(&a, "program", "now", t)).map(|v| {
                log(&format!("INSTALL 配る入口（{}）から版 {v} をこの PC へ据えました", folder.display()));
                format!("配る版 {v} をこの PC へ写しました")
            })
        }
    };
    match result {
        Ok(text) => {
            splash.step(app, "program", "ok", &text);
            splash.step(app, "open", "now", "この PC のアプリで開いています…");
            match spawn_entry(&paths) {
                Ok(()) => {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(QUIT_DELAY);
                        app.exit(0);
                    });
                    true
                }
                Err(e) => {
                    splash.fail(app, "この PC のアプリを開けません", &e);
                    true
                }
            }
        }
        Err(e) if matches!(job, Job::Localize(_)) => {
            // 写せない（作業場所に書けない等）: 共有のまま開き、理由を更新履歴の窓へ出す
            log(&format!("INSTALL この PC へ写せないので、共有のまま開きます: {e}"));
            false
        }
        Err(e) => {
            splash.fail(app, "配る版を取り込めません", &e);
            true
        }
    }
}

fn hand_off() -> bool {
    if let Some(pid) = arg_u32("--wait-pid") {
        proc::wait_gone(pid, Duration::from_secs(30));
    }
    let Ok(me) = std::env::current_exe() else { return false };
    if !dev_mode() && settle_home(&me) {
        return true;
    }
    let b = brand();
    let paths = Paths::new(&locate::local_root());
    // 配る入口（置き場のアプリのフォルダの exe）: 配る版を取り込むのは窓の中で（起動画面に段を出す）
    if !dev_mode() {
        if let Some(folder) = da_core::distribute::entry_folder(&me, &b.app_id) {
            let _ = job().set(Job::Entry(folder));
            return false;
        }
    }
    let spawn = |exe: &std::path::Path, args: &[String]| {
        std::process::Command::new(exe).args(args).current_dir(exe.parent().unwrap_or(std::path::Path::new("."))).spawn().is_ok()
    };
    let pid = std::process::id().to_string();
    match update::plan(&paths, &me, &b.exe, dev_mode()) {
        update::Step::Stay => false,
        update::Step::Handoff => match update::copy_for_run(&paths, &me) {
            Ok(copy) => {
                let program = paths.app().join("program").display().to_string();
                spawn(&copy, &["--program".into(), program, "--wait-pid".into(), pid])
            }
            Err(e) => {
                log(&format!("START 版ごとの写しを作れないので、入口のまま開きます: {e}"));
                false
            }
        },
        // 写すのは窓の中で（起動画面に段を出す）
        update::Step::Localize(dist) => {
            let _ = job().set(Job::Localize(dist));
            false
        }
    }
}

fn main() {
    if hand_off() {
        return;
    }
    let slot: Arc<OnceLock<AppRouter>> = Arc::default();
    let splash: Arc<Splash> = Arc::default();
    let proto_slot = slot.clone();

    let app = tauri::Builder::default()
        // 2つめを起こしたら、前の窓を前に出すだけ（ポートを見て止め直す仕組みが要らない）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        // 画面からの問い合わせ（tpa）。1つずつ別の糸で答える（長い問い合わせが画面を止めない）
        .register_asynchronous_uri_scheme_protocol(SCHEME, move |_ctx, req, responder| {
            let slot = proto_slot.clone();
            std::thread::spawn(move || {
                let resp = match slot.get() {
                    Some(r) => r.handle(&req),
                    None => router::to_response(error_reply(503, "starting", "起動中です。"), "shell"),
                };
                responder.respond(resp);
            });
        })
        .setup({
            let slot = slot.clone();
            let splash = splash.clone();
            move |app| {
                let handle = app.handle().clone();
                window(&handle, "main", WebviewUrl::App("index.html".into()), splash.clone())?;
                splash.say(&handle, format!("splash.brand(...{})", json!([brand().name, brand().subtitle])));
                if selftest_on() {
                    let h = handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(SELFTEST_LIMIT);
                        selftest_finish(&h, &json!({"ok": false, "error": format!("{} 秒で終わりませんでした", SELFTEST_LIMIT.as_secs())}));
                    });
                }
                std::thread::spawn(move || start(handle, slot, splash));
                Ok(())
            }
        })
        .build(tauri::generate_context!())
        .expect("起動できません");

    let last_close: Mutex<Option<Instant>> = Mutex::new(None);
    app.run(move |app, event| match event {
        // 窓の ×: 画面が出ていれば、先に画面へ聞く（保存していない変更。画面が閉じる）。もう一度押せば聞かずに閉じる
        RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if label == "main" => {
            let Some(w) = app.get_webview_window("main") else { return };
            let shown = w.url().map(|u| is_app_url(&u)).unwrap_or(false);
            if shown && !close_now(&last_close, Instant::now()) {
                api.prevent_close();
                let _ = w.eval("window.dispatchEvent(new CustomEvent('tpa:close-requested'))");
            }
        }
        RunEvent::Exit => {
            // 使い回している見えない Edge・LotDsp の窓を閉じる（版 3.98.0。Windows では窓のジョブも Edge を止める）
            if let Some(lot) = LOT.get() {
                lot.lotdsp.shutdown();
            }
            // 使い終わり（窓の × で閉じたときも。版 3.71.0）。共有が遅くても閉じるのを待たせない（LEAVE_WAIT が上限）
            if let Some(lot) = LOT.get() {
                let (tx, rx) = std::sync::mpsc::channel();
                let bye = lot.clone();
                std::thread::spawn(move || {
                    bye.leave();
                    let _ = tx.send(());
                });
                let _ = rx.recv_timeout(LEAVE_WAIT);
            }
            // 中身の Python を止める（入力を閉じる → 片付けて自分で終わる。終わらなければ止める）
            if let Some(r) = slot.get() {
                r.backend.stop();
            }
            log("EXIT 窓を閉じた");
        }
        _ => {}
    });
}

fn outside_ok(u: &Url) -> bool {
    matches!(u.scheme(), "http" | "https" | "mailto")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_asks_first_then_closes_on_a_second_press() {
        let last = Mutex::new(None);
        let t0 = Instant::now();
        assert!(!close_now(&last, t0), "1 回目は画面に聞く");
        assert!(close_now(&last, t0 + Duration::from_secs(2)), "5 秒のうちにもう一度押せば閉じる");
        assert!(!close_now(&last, t0 + Duration::from_secs(20)), "間が空けば、また聞く");
    }

    #[test]
    fn urls_of_the_app_and_the_splash() {
        assert!(is_app_url(&app_url("/api/build")), "自分の画面");
        assert!(is_app_url(&Url::parse("http://tpa.localhost/x").unwrap()), "Windows（WebView2）の形");
        assert!(is_app_url(&Url::parse("tpa://localhost/x").unwrap()), "ほかの OS の形");
        assert!(!is_app_url(&Url::parse("http://lotdsp.example/").unwrap()), "外のページ");
        assert!(!is_app_url(&Url::parse("file://tpa.localhost/x").unwrap()), "名前が同じでも file: はアプリの中ではない");
        assert!(outside_ok(&Url::parse("https://lotdsp.example/").unwrap()));
        assert!(outside_ok(&Url::parse("mailto:a@example.com").unwrap()));
        assert!(!outside_ok(&Url::parse("file://///server/share/x.exe").unwrap()), "file: は外へ渡さない（exe を開かせない）");
        assert!(!outside_ok(&Url::parse("file:///C:/Windows/System32/calc.exe").unwrap()));
        assert!(is_splash(&Url::parse("tauri://localhost/index.html").unwrap()));
        assert!(is_splash(&Url::parse("http://tauri.localhost/index.html").unwrap()));
    }
}
