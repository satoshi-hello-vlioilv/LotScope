//! 突き合わせの試験の共通: Python（program/tests の「正しい答えを出す係」）を呼ぶ。
#![allow(dead_code)]

use std::path::PathBuf;
use std::process::Command;

#[path = "common/bake.rs"]
pub mod bake;

/// 正規表現は形ごとに 1 度だけ組んで覚える（版 3.115.0 の CI の時間の直し: debug の regex は組むのに 1 回 約 10 ms かかる。焼く係と試験の
/// そろえる所が呼ぶたびに組み、焼いた 21 本の試験が 332 → 939 秒に延びた）。試験の中の正規表現はどれもここを通す
pub fn re(pattern: &str) -> &'static regex::Regex {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, &'static regex::Regex>>> =
        std::sync::OnceLock::new();
    let mut m = CACHE.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    if let Some(r) = m.get(pattern) {
        return r;
    }
    let r: &'static regex::Regex = Box::leak(Box::new(regex::Regex::new(pattern).unwrap_or_else(|e| panic!("正規表現 {pattern}: {e}"))));
    m.insert(pattern.to_string(), r);
    r
}

pub fn program() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program")
}

/// 凍らせた Python の写しの版（program/tests/legacy/<版>。tools/freeze-legacy.py が 1 回だけ作った。版 3.117.3）
pub const FROZEN_VERSION: &str = "3.117.3";

/// 凍らせた Python の写しを相手にするか（TPA_FROZEN_PY=1。段 ④ で program/app を消した後、凍らせた最後の Python を相手にする試験
/// 〈bake::frozen_python〉と keep の本が、この写しの app と答え合わせ役を流す）
pub fn frozen_py() -> bool {
    std::env::var("TPA_FROZEN_PY").is_ok_and(|v| !v.is_empty() && v != "0")
}

/// 答え合わせ役（app を import する Python の台本）を流す置き場: いつもは program、TPA_FROZEN_PY=1 なら凍らせた写し
/// program/tests/legacy/<版>（中は program と同じ形: app/・tests/・config/・data/）
pub fn py_program() -> PathBuf {
    if frozen_py() {
        program().join("tests").join("legacy").join(FROZEN_VERSION)
    } else {
        program()
    }
}

/// 場面のフォルダの道の書き方の候補（版 3.117.3）: 書いたままの字・長い名前（canonicalize。Windows の一時フォルダは 8.3 の短い名前
/// RUNNER~1 で来る）と、それぞれの「/」と「\」の書き方。長い字から（短い字が長い字の頭に当たらないように）。
/// 表の宣言から作った場面（Windows の表だけの形）は道を「/」で書き、窓は「\」や長い名前で答えるので、1 つの書き方で置き換えると当たらない
/// （3.117.1 の Windows の測りの「届かない共有」の py／rs 12 歩・place の @ROOT 40 歩）。Linux では書いたままの字 1 つ
pub fn path_forms(p: &str) -> Vec<String> {
    if !cfg!(windows) {
        return vec![p.to_string()];
    }
    let mut out: Vec<String> = bake::spellings(std::path::Path::new(p));
    if !out.iter().any(|s| s == p) {
        out.push(p.to_string());
    }
    {
        let more: Vec<String> = out.iter().flat_map(|s| [s.replace('\\', "/"), s.replace('/', "\\")]).collect();
        out.extend(more);
    }
    out.retain(|s| !s.is_empty());
    out.sort_by_key(|s| std::cmp::Reverse(s.len()));
    out.dedup();
    out
}

/// JSON の字（本文）の中の場面のフォルダ from を to に（どの書き方も。JSON の字として逃がした形どうしで置き換える）
pub fn swap_path_json(text: &str, from: &str, to: &str) -> String {
    let esc = |s: &str| {
        let t = serde_json::to_string(s).unwrap();
        t[1..t.len() - 1].to_string()
    };
    let to = esc(to);
    path_forms(from).iter().fold(text.to_string(), |t, f| t.replace(&esc(f), &to))
}

/// 字の中の場面のフォルダ root を印 mark に（どの書き方も）。Windows では印の後ろの道の区切りも「/」に（焼く係のそろえる決まりが
/// @WORK の後ろでするのと同じ。窓は Windows の道を「\」で答える）。Linux では前と同じ置き換え
pub fn mark_path(s: &str, root: &str, mark: &str) -> String {
    let mut t = s.to_string();
    for f in path_forms(root) {
        if !t.contains(&f) {
            continue;
        }
        if !cfg!(windows) {
            t = t.replace(&f, mark);
            continue;
        }
        let mut out = String::with_capacity(t.len());
        let mut rest = t.as_str();
        while let Some(i) = rest.find(&f) {
            out.push_str(&rest[..i]);
            out.push_str(mark);
            rest = &rest[i + f.len()..];
            let end = rest.find(['"', '\'', ' ', '\n', '）', ')', ',', '」', '?', '#', ';']).unwrap_or(rest.len());
            out.push_str(&rest[..end].replace('\\', "/"));
            rest = &rest[end..];
        }
        out.push_str(rest);
        t = out;
    }
    t
}

/// 流す PC の環境変数のうち、答えを PC ごとに変える物を試験の頭で外す（版 3.117.0。採点の K3 (e)）: プロキシ（名前が _proxy で終わる物。
/// Python の urllib.request.getproxies_environment と同じ見つけ方）と、TLS の信じる根の置き場（SSL_CERT_FILE・SSL_CERT_DIR）。
/// 手元の PC には https_proxy・HTTPS_PROXY・no_proxy などがあり、CI の runner には無い。システムのプロキシを使う場面
/// （schedule.use_system_proxy。③-6 で窓が取る）や、プロキシを決めずに urllib を使う答え合わせ役の答えが、流す PC で変わる。
/// プロキシの場面は、場面が決めた値だけを入れる。試験はどれも最初に work() を呼ぶので、そこで 1 度だけ外す（答え合わせ役〈子の
/// プロセス〉は外した後の環境変数を受け継ぐ。起こす所でも外す）。手元の確かめは tools/ci-shape.py（プロキシと根の置き場を置いた形）
///
/// あわせて umask を 022 に決める（Linux）。場面のファイル（答え合わせ役が書く・表の宣言から作る）と、窓が作るフォルダ・ファイルの権限は
/// umask で変わり、権限を答える歩（配布の置き場の写した後の中身など）が流す PC の umask に頼る。時差を UTC に決めるのと同じ扱い
/// （ci-shape の nopy の形は umask 077 で流す）
pub fn clean_env() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        for k in pc_env_names() {
            // SAFETY: 試験の最初（窓・答え合わせ役を起こす前）に 1 度だけ。同じ実行ファイルのほかの試験も同じ値（無い）にするだけ
            unsafe { std::env::remove_var(&k) };
        }
        #[cfg(target_os = "linux")]
        {
            unsafe extern "C" {
                fn umask(mask: u32) -> u32;
            }
            // SAFETY: 引数は権限の数だけ。プロセスの umask を決めるだけで失敗しない
            unsafe { umask(0o022) };
        }
    });
}

/// 今の環境変数のうち、答えを PC ごとに変える物の名前（clean_env が外す。子のプロセスを起こす所は env_remove で外す）
pub fn pc_env_names() -> Vec<String> {
    std::env::vars_os()
        .filter_map(|(k, _)| k.into_string().ok())
        .filter(|k| k.to_ascii_lowercase().ends_with("_proxy") || k == "SSL_CERT_FILE" || k == "SSL_CERT_DIR")
        .collect()
}

/// 答え合わせ役・場面の台本を起こす Command から、答えを PC ごとに変える環境変数を外す
pub fn clean_command(c: &mut Command) -> &mut Command {
    for k in pc_env_names() {
        c.env_remove(k);
    }
    c
}

/// https の作り物の CA を信頼する（program/tests/fixtures/tls/ca.pem。答え合わせ役の Python も同じ SSL_CERT_FILE を置く。
/// Windows の窓は schannel で証明書ストアだけを見る: CI の段が LocalMachine\Root に入れる）
pub fn trust_test_ca() {
    let ca = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("program").join("tests").join("fixtures").join("tls").join("ca.pem");
    // SAFETY: 試験の最初（TLS を使う前）。この試験の実行ファイルのほかの試験は TLS を使わない
    unsafe { std::env::set_var("SSL_CERT_FILE", ca) };
}

/// 場面の環境変数（プロキシ）を置き、手放すときに外す（答え合わせ役の場面の proxyEnv）
pub struct ProxyEnv(Vec<String>);

impl ProxyEnv {
    pub fn set(v: &serde_json::Value) -> ProxyEnv {
        let mut keys = vec![];
        for (k, x) in v.as_object().into_iter().flatten() {
            // SAFETY: 場面の歩を当てる糸の前（窓の糸は歩の中で読む）
            unsafe { std::env::set_var(k, x.as_str().unwrap_or("")) };
            keys.push(k.clone());
        }
        ProxyEnv(keys)
    }
}

impl Drop for ProxyEnv {
    fn drop(&mut self) {
        for k in &self.0 {
            // SAFETY: 場面の歩が済んだ後
            unsafe { std::env::remove_var(k) };
        }
    }
}

pub fn work(name: &str) -> PathBuf {
    clean_env();
    let d = std::env::temp_dir().join(format!("da-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// program/tests/<script> を引数つきで呼び、標準出力の JSON を返す（Python は TPA_PYTHON か python3／python）。
pub fn python_json(script: &str, args: &[&str]) -> serde_json::Value {
    let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
    let out = clean_command(&mut Command::new(&py))
        .arg(py_program().join("tests").join(script))
        .args(args)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .current_dir(py_program())
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
        Live::start_with(&[], script, args)
    }

    /// app を import しない台本（起こしたままの相手 tests/fakes_serve.py）を、標準の Python で起こしたままにする（python -I。
    /// Python 無しの形〈TPA_NO_PYTHON=1〉でも使う: 標準の Python は独立の答えと同じく段 ④ の後も残す）
    pub fn start_stdlib(script: &str, args: &[&str]) -> (Live, serde_json::Value) {
        bake::stdlib_python();
        Live::start_with(&["-I"], script, args)
    }

    fn start_with(flags: &[&str], script: &str, args: &[&str]) -> (Live, serde_json::Value) {
        use std::io::BufRead;
        let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
        // app を import する台本は凍らせた写しを相手にできる（py_program）。標準の部品だけの台本（-I）は program のまま（④ の後も残る）
        let root = if flags.contains(&"-I") { program() } else { py_program() };
        let mut child = clean_command(&mut Command::new(&py))
            .args(flags)
            .arg(root.join("tests").join(script))
            .args(args)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .current_dir(&root)
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
    // 対の無い代用字の \udXXX（画面の控えの字。版 3.113.0）は serde が読めないので J で読む（窓と同じ持ち方）
    serde_json::from_slice(b).ok().or_else(|| da_core::held::parse(std::str::from_utf8(b).ok()?.trim_end()).ok())
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

/// 写しの様子（一覧の source・ダッシュボードの mirrors の 1 つ）のうち、窓と Python と焼いた表で同じになるはずの所（routes・dash・ops の試験）:
/// 元の場所・間隔・古さのしきい・写したか・古いか（stale）・届かないか（unreachable）・理由。時刻（at・checkedAt・copiedAt）と古さの時間の数
/// （ageHours）は流すまでの秒で動くので比べない（古いかは stale の真偽で比べる）。版 3.117.2 の作った後の採点の割れ 1: 前は stale・unreachable・
/// reason も落とし、更新が止まった HOT の「古い」を窓のしきいを読み違えても表が素通りした
pub fn mirror_part(v: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({"remote": v["remote"], "interval_sec": v["interval_sec"], "staleHours": v["staleHours"], "mirrored": v["mirrored"],
                       "stale": v["stale"], "unreachable": v["unreachable"], "reason": mirror_reason(&v["reason"])})
}

/// 写しの様子の reason のうち「この問い合わせで写し直したか」だけで変わる言葉（版 3.117.3 の 1 回目の Windows の CI の直し）。
/// 写しが元と同じ所に着いたことは同じで、写し直したか（「写しを更新しました」）・確かめて同じだったか（「元ファイルは変わっていません」）は、
/// Python と窓のどちらが先に確かめたか・更新時刻の刻み（NTFS）で入れ替わる（PR #120 の Windows で ops_parity の「勤務体系が無い」3 歩が
/// 「元ファイルは変わっていません / 写しを更新しました」で落ちた。Linux の ext4 と PR #119 の Windows では揃っていた）。この 2 つだけを
/// 「@写しは元と同じ」にし、届かない・見送った・写せない理由はそのまま比べる（stale・unreachable も）
pub const MIRROR_SAME: [&str; 2] = ["写しを更新しました", "元ファイルは変わっていません"];

pub fn mirror_reason(r: &serde_json::Value) -> serde_json::Value {
    match r.as_str() {
        Some(s) if MIRROR_SAME.contains(&s) => serde_json::json!("@写しは元と同じ"),
        _ => r.clone(),
    }
}
