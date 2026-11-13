//! 起動の決め（版 3.111.0。段 ② の S11・案 B「窓の準備に置き換える」と F の純粋な決め）。
//!
//! 入れ替えた直後の版（update\applied.json が残る起動）を確かめ・直し・片付け・戻すかを、Python の準備ではなく窓の準備で決める:
//!
//! - 窓の準備（window_ready）: 新しい program のうち**窓が読む物だけ**で版の壊れを見る。
//!   (a) app/version.py の版を読める・(d) brand.json の app_id が窓と同じ・(b) 画面の型（templates/index.html）を窓が描け、
//!   型が指す部品（static）と指紋がある・(c) 同梱の既定（app/master_defaults の各 JSON・config/appsettings.example.json）を束の決まりで読める。
//!   作業場所・共有・配った設定（config/appsettings.json・TRANSFER_APP_CONFIG）・権限の表は**読まない**（読むと「環境」の失敗が混ざり、
//!   共有が落ちた朝に全員の PC が前の版へ戻る）。Python も見ない（Python が無い・遅い・すぐ終わる版でも戻さない）。
//! - 画面の合図: 窓の準備だけで確かめ終えると、画面の JS が壊れた版（static の構文の誤り）を見ない。画面の JS が最初の心拍を送った
//!   （頁が起きた）ことを確かめの印を消す条件にし、BEAT_LIMIT のうちに来なければ戻す。ただし Python を起こしている最中は待つ
//!   （画面の JS は一覧の設定〈/api/config〉を読み終えてから心拍を始める。窓が設定を組めない形では、その答えが Python の準備を待つ）。
//! - 決め（decide）: 事実 → 行うこと の純粋な関数。どれが「戻す」でどれが「戻さない」かは、仕様から人が書いた事例の表
//!   tests/fixtures/boot_cases.json（desktop/tests/boot_cases.rs が読む。Python には頼らない。独立の答えは表そのもの）。
//!
//! 範囲外（3.111.0 では変えない）: exe が替わって開き直した新しい窓そのものが起動の途中で落ちる形（Rust の panic）は、
//! 窓が決めに着く前に終わるので今も戻らない。validate_dist・revert・dist_root が program/sidecar.py を「中身がある」の印に使う所は
//! 段 ④ で窓の準備の印に替える（program/docs/RUST_PORT_PLAN.md）。

use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

/// 画面の JS が最初の心拍を送るまで待つ長さ（入れ替えた直後だけ）。過ぎても Python を起こしている最中なら待ち続ける
pub const BEAT_LIMIT: Duration = Duration::from_secs(60);

/// 版の壊れ（窓の準備で見つけた物）。kind は事例の表の window の字
#[derive(Debug, Clone, PartialEq)]
pub struct Broken {
    pub kind: &'static str,
    pub detail: String,
}

impl Broken {
    fn new(kind: &'static str, detail: impl Into<String>) -> Broken {
        Broken { kind, detail: detail.into() }
    }
}

impl std::fmt::Display for Broken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}（{}）", self.detail, self.kind)
    }
}

/// 型が指す部品（url_for('static', filename='…')）
fn static_refs(source: &str) -> Vec<String> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r#"url_for\(\s*['"]static['"]\s*,\s*filename\s*=\s*['"]([^'"]+)['"]\s*\)"#).unwrap());
    re.captures_iter(source).map(|c| c[1].to_string()).collect()
}

/// 窓の準備: 新しい program のうち窓が読む物だけで版の壊れを見る → 版。作業場所・共有・配った設定・Python は見ない
pub fn window_ready(program: &Path, app_id: &str) -> Result<String, Broken> {
    let app = program.join("app");
    // (a) 版
    let version = crate::update::program_version(program).ok_or_else(|| Broken::new("version", "app/version.py の版を読めません"))?;
    // (d) 名乗り
    let brand = crate::update::read_json(&app.join("brand.json"));
    let id = brand.as_ref().and_then(|b| b["app_id"].as_str());
    if id != Some(app_id) {
        return Err(Broken::new("app_id", format!("brand.json の app_id が窓と違います（{}）", id.unwrap_or("読めません"))));
    }
    if !brand.as_ref().is_some_and(Value::is_object) {
        return Err(Broken::new("app_id", "brand.json が表ではありません"));
    }
    // (b) 画面の型・型が指す部品・指紋
    let tpl = app.join("templates").join("index.html");
    let source = std::fs::read_to_string(&tpl)
        .map_err(|e| Broken::new("template", format!("画面の型 app/templates/index.html を読めません: {e}")))?;
    if crate::page::Template::parse(&crate::page::universal_newlines(&source)).is_none() {
        return Err(Broken::new("template", "画面の型 app/templates/index.html が窓の読めない書き方です"));
    }
    for f in static_refs(&source) {
        if !app.join("static").join(&f).is_file() {
            return Err(Broken::new("fingerprint", format!("画面の型が指す部品 static/{f} がありません（指紋を付けられません）")));
        }
    }
    let fp = crate::page::fingerprint(program);
    if !fp.strip_prefix(&version).is_some_and(|r| r.len() == 13 && r.starts_with('-')) {
        return Err(Broken::new("fingerprint", format!("画面の指紋を作れません（{fp}）")));
    }
    let parts = crate::page::Parts {
        ui_state: json!({"rev": 0, "keys": {}}),
        ui_profile: json!({"keys": [], "defaults": {}, "updatedAt": "", "updatedBy": {}}),
        conversions: json!({"items": [], "revision": null}),
    };
    if crate::page::Page::default().index(program, parts, false).is_none() {
        return Err(Broken::new("template", "画面を描けません（型の名前・brand.json の形）"));
    }
    // (c) 同梱の既定（作業場所・共有・配った設定は読まない）
    let defaults = app.join("master_defaults");
    let rd =
        std::fs::read_dir(&defaults).map_err(|e| Broken::new("defaults", format!("同梱の既定 app/master_defaults を読めません: {e}")))?;
    let mut names: Vec<_> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
    names.sort();
    for p in names {
        let raw = std::fs::read(&p).map_err(|e| Broken::new("defaults", format!("同梱の既定 {} を読めません: {e}", p.display())))?;
        if crate::master_store::parse_master(&raw, &p).is_err() {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            return Err(Broken::new("defaults", format!("同梱の既定 app/master_defaults/{name} が壊れています")));
        }
    }
    let example = program.join("config").join("appsettings.example.json");
    let ok = crate::bundle::read_config(&example).and_then(|t| serde_json::from_str::<Value>(&t).ok()).is_some_and(|v| v.is_object());
    if !ok {
        return Err(Broken::new("defaults", "設定の見本 config/appsettings.example.json を読めません"));
    }
    Ok(version)
}

/// 画面（頁）の様子
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Page {
    /// まだ画面を開いていない（起動の最初）
    NotOpened,
    /// 開いた。最初の心拍を待っている（BEAT_LIMIT の内）
    Waiting,
    /// 画面の JS が最初の心拍を送った
    Beat,
    /// BEAT_LIMIT を過ぎても来ない
    Late,
}

/// 中身（Python）の様子。決めは Python を理由に戻さない（遅い・終わった・無いは環境か Python だけの壊れ）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Python {
    Starting,
    Ready,
    /// 起こせなかった（すぐ終わった・120 秒で準備できない）
    Down,
    /// PC に Python が見つからない
    Missing,
}

/// 決めの材料
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Facts {
    /// この PC の app で動いている
    pub installed: bool,
    /// 入れ替えた直後の印（update\applied.json）が残っている
    pub applied: bool,
    /// 窓の準備が通った
    pub window_ok: bool,
    pub page: Page,
    pub python: Python,
}

/// 行うこと（並べた順に行う）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Act {
    /// 控え（直前の版）へ戻して開き直す（FAILED に印）
    Revert,
    /// 画面を開く
    Open,
    /// 画面の最初の心拍を待つ（入れ替えた直後の印を消すのはその後）
    AwaitBeat,
    /// 入れ替えた直後の印を消す（update::confirm）
    Confirm,
    /// ショートカットの指す先・作業フォルダ・アイコンを直す（install::maintain）
    Maintain,
    /// 古い版ごとの exe の写しを消す（update::cleanup_copies）
    Cleanup,
}

/// 事実 → 行うこと（純粋な関数。Python の様子で戻すことは無い）
pub fn decide(f: &Facts) -> Vec<Act> {
    use Act::*;
    let fresh = f.installed && f.applied;
    match f.page {
        Page::NotOpened if fresh && !f.window_ok => vec![Revert],
        Page::NotOpened if fresh => vec![Open, AwaitBeat],
        // 入れ替えた直後でなければ戻す物が無い: 窓の準備が通らなくても開く（画面は Python が描けるかもしれない）
        Page::NotOpened if f.installed => vec![Open, Maintain, Cleanup],
        Page::NotOpened => vec![Open],
        _ if !fresh => vec![],
        Page::Beat => vec![Confirm, Maintain, Cleanup],
        Page::Waiting => vec![AwaitBeat],
        // 画面の JS が起きない。Python を起こしている最中は、画面が設定の答えを待っているだけかもしれないので待つ
        Page::Late if f.python == Python::Starting => vec![AwaitBeat],
        Page::Late => vec![Revert],
    }
}

impl Act {
    pub fn name(self) -> &'static str {
        match self {
            Act::Revert => "revert",
            Act::Open => "open",
            Act::AwaitBeat => "await_beat",
            Act::Confirm => "confirm",
            Act::Maintain => "maintain",
            Act::Cleanup => "cleanup",
        }
    }
}

impl Page {
    pub fn of(s: &str) -> Option<Page> {
        Some(match s {
            "not_opened" => Page::NotOpened,
            "waiting" => Page::Waiting,
            "beat" => Page::Beat,
            "late" => Page::Late,
            _ => return None,
        })
    }
}

impl Python {
    pub fn of(s: &str) -> Option<Python> {
        Some(match s {
            "starting" => Python::Starting,
            "ready" => Python::Ready,
            "down" => Python::Down,
            "missing" => Python::Missing,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Python::Starting => "starting",
            Python::Ready => "ready",
            Python::Down => "down",
            Python::Missing => "missing",
        }
    }
}

/// 起動できなかった版の印（update\FAILED.json）が、その版の取り込みを止めるか。
/// 3.110.0 までの窓が Python の失敗で付けた理由の無い印も止める: その版（3.110.0 まで）へ戻すと、その版の窓が前の決まり（Python の準備）で
/// 確かめ直し、同じ失敗で戻す → 3.111.0 の窓がまた取り込む、を起動のたびに繰り返すため。3.111.0 からの窓は窓の準備と画面の合図でだけ
/// 印を付け、理由（why）を添える
pub fn failed_blocks(file: &Value, version: &str) -> bool {
    file["versions"].as_array().into_iter().flatten().any(|v| v.as_str() == Some(version))
}

/// 試験の配る形が窓の準備を通る最小の中身（program からの相対の道, 字）。update.rs・distribute.rs の試験が使う
#[cfg(test)]
pub(crate) fn min_program_files() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "app/templates/index.html",
            "<title>{{ brand.name }}</title><script src=\"{{ url_for('static', filename='js/app.js') }}\"></script>\n",
        ),
        ("app/static/js/app.js", "// 試験\n"),
        ("app/master_defaults/conversions.json", "[]"),
        ("config/appsettings.example.json", "{}"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_never_reverts() {
        // どの画面の様子でも、Python の様子だけを替えて戻すことにはならない（Starting の待ちを除き、決めは同じ）
        for page in [Page::NotOpened, Page::Waiting, Page::Beat] {
            for w in [true, false] {
                let base = decide(&Facts { installed: true, applied: true, window_ok: w, page, python: Python::Ready });
                for py in [Python::Starting, Python::Down, Python::Missing] {
                    assert_eq!(decide(&Facts { installed: true, applied: true, window_ok: w, page, python: py }), base, "{page:?} {py:?}");
                }
            }
        }
    }

    #[test]
    fn static_refs_are_read() {
        assert_eq!(
            static_refs(
                r#"<link href="{{ url_for('static', filename='css/a.css') }}"><script src="{{ url_for("static", filename="js/b.js") }}">"#
            ),
            vec!["css/a.css".to_string(), "js/b.js".to_string()]
        );
    }
}
