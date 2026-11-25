//! 窓が自分の答えを焼く係（bless。版 3.115.0。Rust 化の段 ③ の 4 つ目・案 G の 1 版目）。
//!
//! 段 ④ で Python（program/app）を外すと、突き合わせの試験は答えの元（前の版の答え合わせ役）を失う。そこで窓の答えを
//! 焼いた表（desktop/tests/baked/<本>.json）に持ち、試験は毎回その表と比べる。
//!
//! 流し方（環境変数。版 3.119.0〈段 ⑤〉で答え合わせ役を消し、表だけの形がいつもの形になった）:
//! - 何も付けない（TPA_NO_PYTHON=1 も同じ）: Python（program/app）を呼ばない。場面のフォルダは表の宣言（scene）から作り、焼いた答えとだけ比べる
//! - TPA_BLESS=道の型,…: 範囲を宣言して焼き直す。範囲の外の答えが変わったら書かずに止める
//! - TPA_BAKE_OUT=フォルダ: 表を desktop/tests/baked でなくそこへ書く
//! - TPA_MEASURE=フォルダ（表と比べない PC＝Windows の札 measure の本）: 測るだけ。表と違う歩を落とさずに数えて <フォルダ>/<表>.json に書く
//!   （形は table。試験そのものは表の答えと比べて落ちるので、CI の段は落ちても続ける）
//! - Python と比べる形（Mode::Python）と Python と同じときだけ焼く形（Mode::Bless）は、焼く係そのものの試験（bake_selftest の Bake::with）だけが使う
//!
//! そろえる決まり（tests/baked/settle.json）は「鍵の名前の表＋字の形」で、揺れなくても常に当てる。焼いた表と比べるときは、窓の答えも
//! 同じ決まりでそろえてから比べる。独立の答え（tools/*-truth.py）と人が書いた事例の表（tests/fixtures/*_cases.json）は bless が書き換えない
//! 第 2 の線（この係は desktop/tests/baked だけに書く）。
#![allow(dead_code)]

use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 場面の中の「今に近い」時刻（この幅の内は今からのずれで持つ・答えの今に近い時刻を @T(形|秒) にする）。焼くとき（tools/bless.py）に、
/// 答え合わせ役の元に今からこの幅の内の固定の日付があれば焼かずに止める（時限の爆弾にしない）
pub const NEAR: i64 = 2 * 24 * 3600;
/// 今に近い時刻の秒の差を許す幅（焼いた時と比べる時の、場面を作ってから答えるまでの時間の違い）
pub const TOL: i64 = 1800;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// Python と比べる（焼いた表とも比べる）
    Python,
    /// Python を呼ばない。表の宣言から場面を作り、焼いた答えと比べる
    Baked,
    /// Python と同じときだけ焼く
    Bless,
    /// 範囲を宣言して焼き直す（Python を呼ばない）
    BlessScope,
}

pub fn baked_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("baked")
}

fn rules() -> &'static Value {
    static R: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    R.get_or_init(|| serde_json::from_str(include_str!("../baked/settle.json")).expect("settle.json"))
}

/// root（uid 0）か。表の答えは root で焼き、root でない利用者で違う歩だけを variants.user に持つ
pub fn variant() -> &'static str {
    #[cfg(unix)]
    {
        let s = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
        let uid = s.lines().find_map(|l| l.strip_prefix("Uid:")).and_then(|l| l.split_whitespace().nth(1)).unwrap_or("0");
        if uid != "0" {
            return "user";
        }
    }
    "root"
}

/// 表のどの OS の答えと比べるか（版 3.117.3）: "posix"（焼いた表の本の答え）か "nt"（Windows。本の答えに tests/baked/nt/<表>.json の
/// 上書きを重ねる）。Windows でだけ "nt"
pub fn bake_os() -> &'static str {
    // TPA_BAKE_OS=nt（試験だけ。版 3.117.3 の作った後の直し・割れ 2）: Linux の上で Windows の形を選ぶ（本番と同じ nt の表の読み方・札・
    // 作れない物の数え方を通す。答えは Linux の窓の答えなので、比べて通るのは札が table の本だけ。check-all の段 nt-shape）
    if cfg!(windows) || std::env::var("TPA_BAKE_OS").as_deref() == Ok("nt") {
        "nt"
    } else {
        "posix"
    }
}

fn books() -> &'static Value {
    static B: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    B.get_or_init(|| serde_json::from_str(include_str!("../baked/books.json")).expect("books.json"))
}

/// 本の Windows の札（books.json の windows）: "table" は Windows の表だけの形（TPA_NO_PYTHON=1）でも焼いた表（nt の上書きを重ねた形）と
/// 比べて落とす本、"measure" はまだ測るだけの本（無ければ measure）。版 3.117.3
pub fn windows_status(book: &str) -> &'static str {
    match books()["books"][book]["windows"].as_str() {
        Some("table") => "table",
        _ => "measure",
    }
}

/// Windows の上書きの表（tests/baked/nt/<表>.json。版 3.117.3）: answers（posix と違う歩の Windows の答え）・posix（上書きした posix の答えの
/// 指紋。tools/bless.py --check が今の posix の答えと比べる）・skip（Windows では流さない歩）・unmade（Windows で作れない場面の物）。
/// 書くのは tools/bless.py --take-nt だけ（Windows の測りの記録から取り込む）
pub fn nt_dir() -> PathBuf {
    baked_dir().join("nt")
}

/// アプリの版（心拍と同じ元の program/app/version.py）
pub fn app_version() -> &'static str {
    static V: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    V.get_or_init(|| da_core::update::program_version(&super::program()).unwrap_or_else(|| "?".into()))
}

/// 画面の指紋（meta の tpa-build・静的ファイルの ?v=。app_build.fingerprint と同じ「版-指紋 12 桁」）。program/app のファイルの大きさと
/// 更新時刻から作るので、取り出した PC ごと・プログラムを変えるたびに変わる。答えの字の中のこの字そのものだけを @BUILD にそろえる
/// （版 3.116.0。画面の字〈GET /〉を焼くため。ほかの「版-16 進」の字はそのまま比べる）
pub fn build_stamp() -> &'static str {
    static B: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    B.get_or_init(|| da_core::page::fingerprint(&super::program()))
}

/// この PC の名前（ホスト名）。窓の名乗りの係（bundle::pc_name）を通さず、OS から直に読む（Linux は /proc/sys/kernel/hostname・
/// Windows は COMPUTERNAME）。名乗りを決めていない場面（配った設定の identity が空）の答えの pc はこの名前になるので、焼いた PC の名前を
/// 表に持たないよう @HOST にそろえる（版 3.116.0 の PR #116 の CI の直し: 表に手元の「vm」が入り、CI の runner の名前で落ちた）
pub fn host_name() -> Option<&'static str> {
    static H: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    H.get_or_init(|| {
        let name =
            if cfg!(windows) { std::env::var("COMPUTERNAME").ok() } else { std::fs::read_to_string("/proc/sys/kernel/hostname").ok() };
        name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty())
    })
    .as_deref()
}

/// OS の利用者の名前（Python の getpass.getuser と同じ順: LOGNAME・USER・LNAME・USERNAME）
pub fn os_user() -> Option<&'static str> {
    static U: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    U.get_or_init(|| {
        ["LOGNAME", "USER", "LNAME", "USERNAME"].iter().find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty())).or_else(passwd_name)
    })
    .as_deref()
}

/// 環境変数が無いときの名前（getpass.getuser の pwd.getpwuid(os.getuid())）
fn passwd_name() -> Option<String> {
    #[cfg(unix)]
    {
        let s = std::fs::read_to_string("/proc/self/status").ok()?;
        let uid = s.lines().find_map(|l| l.strip_prefix("Uid:"))?.split_whitespace().next()?.to_string();
        let pw = std::fs::read_to_string("/etc/passwd").ok()?;
        return pw.lines().find_map(|l| {
            let f: Vec<&str> = l.split(':').collect();
            (f.len() > 2 && f[2] == uid).then(|| f[0].to_string())
        });
    }
    #[allow(unreachable_code)]
    None
}

/// 置き換える道の字（作業フォルダ @WORK・家 @HOME・作り物のサーバーの URL @URL）。一時フォルダは置き換えない（版 3.115.0 の作った後の直し:
/// 前は @TMP にして、答え合わせ役の固定の字「/tmp/x/../y」と流した PC の一時フォルダを混ぜた）
#[derive(Clone)]
pub struct Ctx {
    pub subs: Vec<(String, String)>,
    /// 起こしたままの相手（作り物のサーバー）の名前つきの URL（版 3.117.0）: (名前, URL〈種類://番地:ポート〉)。場面・問い合わせ・答えの中の
    /// URL は @URL(名前)、種類の付かない番地:ポート（Host の見出しなど）は @ADDR(名前) にそろえ、作り直すときに今の URL へ戻す。
    /// そろえるのは Bake が起こした（答え合わせ役が urls で名乗った）URL そのものだけ（ほかのポートはそのまま比べ、bless.py --check が残りを落とす）
    pub urls: Vec<(String, String)>,
}

/// URL の番地:ポート（種類:// の後ろ）
fn authority(url: &str) -> &str {
    url.split_once("://").map(|(_, a)| a).unwrap_or(url).trim_end_matches('/')
}

/// 道の字の段の境か（前の字・後ろの字が道の続きでない）
fn path_edge(c: Option<char>) -> bool {
    c.is_none_or(|c| !(c.is_alphanumeric() || matches!(c, '/' | '\\' | '.' | '-' | '_' | '~' | '$' | '%')))
}

/// リポジトリの根（desktop の上。PC ごとに違う: 手元の作業フォルダ・CI の /home/runner/work/…）
pub fn repo_root() -> PathBuf {
    let m = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let up = m.parent().unwrap_or(&m).to_path_buf();
    PathBuf::from(spellings(&up).pop().unwrap_or_default())
}

/// 道の書き方の候補: 書いたままの字と、長い名前に直した字（canonicalize。Windows の \\?\ の頭は外す）。最後が長い名前
pub fn spellings(p: &Path) -> Vec<String> {
    let mut out = vec![p.to_string_lossy().trim_end_matches(['/', '\\']).to_string()];
    if let Ok(c) = std::fs::canonicalize(p) {
        let c = c.to_string_lossy().into_owned();
        let c = c.strip_prefix(r"\\?\UNC\").map(|r| format!(r"\\{r}")).unwrap_or_else(|| c.strip_prefix(r"\\?\").unwrap_or(&c).to_string());
        if !out.contains(&c) {
            out.push(c);
        }
    }
    out.retain(|s| !s.is_empty());
    out
}

impl Ctx {
    pub fn new(base: &Path) -> Ctx {
        // 家は HOME、無ければ USERPROFILE（Windows。版 3.117.3 の 1 回目の CI の取り込みで見つけた: Windows の「参照…」のよく使う場所の
        // ホーム・デスクトップ・ドキュメントが runner の利用者のフォルダの字のまま答えに残った）
        let home = std::env::var("HOME").ok().filter(|h| !h.is_empty()).or_else(|| {
            if cfg!(windows) {
                std::env::var("USERPROFILE").ok()
            } else {
                None
            }
        });
        Ctx::with_home(base, home.as_deref())
    }

    /// 家を決めて作る（試験: リポジトリが家の下にある PC〈CI〉と同じ形を作る）
    pub fn with_home(base: &Path, home: Option<&str>) -> Ctx {
        // 作業フォルダは書いたままの字と、長い名前に直した字（Windows の一時フォルダは 8.3 の短い名前 RUNNER~1 で来る。Python は長い名前で書く）の
        // 両方を @WORK に。subs[0] は戻すときの字（作業フォルダ）、subs[1] はリポジトリの根
        let repo = repo_root();
        let mut subs =
            vec![(base.to_string_lossy().into_owned(), "@WORK".to_string()), (repo.to_string_lossy().into_owned(), "@REPO".into())];
        for v in spellings(base).into_iter().skip(1) {
            subs.push((v, "@WORK".into()));
        }
        // リポジトリの根は @REPO（版 3.115.0 の 2 回目の直し: 前は置き換えず、手元〈家の外〉で焼いた表の program の道が、リポジトリが家の下にある
        // CI で @HOME/… になって食い違った）。家より先に置き換わるよう、長い字の順で当てる（家の下にあっても @REPO）。
        // 試験は program を desktop/.. でも書く（common::program）。その字も同じ @REPO
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        for v in spellings(&repo)
            .into_iter()
            .skip(1)
            .chain(spellings(&manifest.join("..")))
            .chain(spellings(manifest.parent().unwrap_or(&manifest)))
        {
            subs.push((v, "@REPO".into()));
        }
        if let Some(h) = home {
            let h = h.trim_end_matches(['/', '\\']).to_string();
            // Windows の一時フォルダ（作業フォルダ）は家の下にある（C:\Users\<利用者>\AppData\Local\Temp）。置き換えは長い字から当てるので、
            // 作業フォルダは家より先に @WORK になる（版 3.117.3）
            if h.len() > 3 && Path::new(&h).is_dir() && (!base.starts_with(&h) || cfg!(windows)) {
                subs.extend(spellings(Path::new(&h)).into_iter().map(|v| (v, "@HOME".into())));
            }
        }
        if cfg!(windows) {
            // 「/」の書き方の道も同じ印に（表の宣言から作った場面の道は「/」で書いてある。unsub）
            let more: Vec<(String, String)> =
                subs.iter().filter(|(a, _)| a.contains('\\')).map(|(a, b)| (a.replace('\\', "/"), b.clone())).collect();
            subs.extend(more);
        }
        subs.dedup();
        Ctx { subs, urls: vec![] }
    }

    /// 起こしたままの相手の URL を名前つきで覚える（同じ名前は差し替える）
    pub fn url_named(&mut self, name: &str, url: &str) {
        let url = url.trim_end_matches('/');
        if !url.is_empty() {
            self.urls.retain(|(n, _)| n != name);
            self.urls.push((name.to_string(), url.to_string()));
        }
    }

    /// 名前つきの URL を印に（URL は @URL(名前)。残った番地:ポートは、前が数字・点でなく後ろが数字でない所だけ @ADDR(名前)）
    fn sub_urls(&self, s: &str) -> String {
        let mut t = s.to_string();
        for (name, url) in &self.urls {
            if !t.contains(authority(url)) {
                continue;
            }
            t = replace_bounded(&t, url, &format!("@URL({name})"));
            t = replace_bounded(&t, authority(url), &format!("@ADDR({name})"));
        }
        t
    }

    /// 名前つきの印を今の URL に戻す
    fn unsub_urls(&self, s: &str) -> String {
        if !s.contains("@URL(") && !s.contains("@ADDR(") {
            return s.to_string();
        }
        self.urls.iter().fold(s.to_string(), |t, (name, url)| {
            t.replace(&format!("@URL({name})"), url).replace(&format!("@ADDR({name})"), authority(url))
        })
    }
    /// 作り物のサーバーの URL（組む所の CM3）を @URL にそろえる
    pub fn url(&mut self, url: &str) {
        if !url.is_empty() {
            self.subs.retain(|(_, b)| b != "@URL");
            self.subs.push((url.to_string(), "@URL".into()));
        }
    }
    /// 長い字から、段の境の前後（前の字・後ろの字が道の続きでない）で置き換える（/tmp が /tmp.abc や /x/tmp に当たらない）
    pub fn sub(&self, s: &str) -> String {
        self.sub_with(s, false)
    }

    /// 答えをそろえるとき: 置き換えた後の道の区切りを「/」にそろえる（焼いた表は OS によらず同じ字。Windows の「\」も）。場面の宣言と問い合わせの
    /// 字はそのまま（中身の JSON の \\ を崩さない）
    pub fn sub_slash(&self, s: &str) -> String {
        self.sub_with(s, true)
    }

    fn sub_with(&self, s: &str, slash: bool) -> String {
        let mut subs: Vec<&(String, String)> = self.subs.iter().collect();
        subs.sort_by_key(|(a, _)| std::cmp::Reverse(a.len()));
        let mut t = if self.urls.is_empty() { s.to_string() } else { self.sub_urls(s) };
        for (a, b) in subs {
            if !t.contains(a.as_str()) {
                continue;
            }
            let mut out = String::with_capacity(t.len());
            let mut rest = t.as_str();
            while let Some(i) = rest.find(a.as_str()) {
                let before = if i > 0 { rest[..i].chars().last() } else { out.chars().last() };
                let after = rest[i + a.len()..].chars().next();
                let after_ok =
                    after.is_none_or(|c| matches!(c, '/' | '\\' | '"' | '\'' | ' ' | '\n' | '）' | ')' | ',' | ':' | '」' | '?' | '#'));
                out.push_str(&rest[..i]);
                rest = &rest[i + a.len()..];
                if path_edge(before) && after_ok && slash {
                    out.push_str(b);
                    let end = rest.find(['"', '\'', ' ', '\n', '）', ')', ',', '」', '?', '#', ';']).unwrap_or(rest.len());
                    out.push_str(&rest[..end].replace('\\', "/"));
                    rest = &rest[end..];
                } else if path_edge(before) && after_ok {
                    out.push_str(b);
                } else {
                    out.push_str(a);
                }
            }
            out.push_str(rest);
            t = out;
        }
        t
    }
    /// 置き換えを戻す（作業フォルダとリポジトリの根。家と URL は戻さない: 家は答えの字にだけ出る・URL は作り直す時に新しい物を当てる）
    fn unsub(&self, s: &str) -> String {
        // Windows（表の宣言から場面を作る形。版 3.117.0 の測り）: 戻す道の区切りは「/」にする。場面のファイルの中身（JSON の字）に「\」を
        // 裸で入れると読めない字になる（"D:\a\_temp" の \a・\_）。Windows は「/」も道の区切りに読む。答えの中の「/」の書き方の
        // 作業フォルダも @WORK にそろう（with_home が「/」の書き方も覚える）
        let p = |x: &str| if cfg!(windows) { x.replace('\\', "/") } else { x.to_string() };
        self.unsub_urls(s).replace("@WORK", &p(&self.subs[0].0)).replace("@REPO", &p(&self.subs[1].0))
    }
}

/// a を b に置き換える。ただし前の字が数字・点、後ろの字が数字の所はそのまま（ポート 4123 が 41234 に、番地 127.0.0.1 が 10.127.0.0.1 に当たらない）
fn replace_bounded(s: &str, a: &str, b: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find(a) {
        let before = if i > 0 { rest[..i].chars().last() } else { out.chars().last() };
        let after = rest[i + a.len()..].chars().next();
        out.push_str(&rest[..i]);
        let edge = !before.is_some_and(|c| c.is_ascii_digit() || c == '.') && !after.is_some_and(|c| c.is_ascii_digit());
        out.push_str(if edge { b } else { a });
        rest = &rest[i + a.len()..];
    }
    out.push_str(rest);
    out
}

fn map_strings(v: &Value, f: &dyn Fn(&str) -> String) -> Value {
    match v {
        Value::String(s) => Value::String(f(s)),
        Value::Array(a) => Value::Array(a.iter().map(|x| map_strings(x, f)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (f(k), map_strings(x, f))).collect()),
        _ => v.clone(),
    }
}

fn compiled() -> &'static (Vec<(regex::Regex, String)>, regex::Regex) {
    static C: std::sync::OnceLock<(Vec<(regex::Regex, String)>, regex::Regex)> = std::sync::OnceLock::new();
    C.get_or_init(|| {
        let forms = rules()["forms"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| (regex::Regex::new(f["re"].as_str().unwrap()).unwrap(), f["to"].as_str().unwrap().to_string()))
            .collect();
        (forms, regex::Regex::new(r"(\d{4})([-/])(\d{2})([-/])(\d{2})").unwrap())
    })
}

/// 鍵の名前の表（settle.json の nameKeys: 利用者の名前を書く欄。版 3.115.0 の作った後の直し: 前は値の字の一致で当て、場面の人の名前とも重なった）
fn name_keys() -> Vec<&'static str> {
    rules()["nameKeys"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default()
}

/// 日時の字の形（今に近いかを見る）: 年-月-日 時:分〔:秒〔.小数〕〕 と、文の中の 年/月/日 時:分〔:秒〕
fn dt_any() -> &'static regex::Regex {
    static R: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| regex::Regex::new(r"(\d{4})([-/])(\d{1,2})[-/](\d{1,2})([T ])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?").unwrap())
}

/// 字の中の今に近い日時（±NEAR）を「@T(形|今からの秒)」にする。遠い日時・日時でない字はそのまま（版 3.115.0 の作った後の直し:
/// 前は鍵の名前と字の形でどの日時も @T にし、窓の時刻の読み書きの誤りを表との比べが見なかった）。形は区切り・桁（Ts・Tf6・/m など）
fn near_times(t: &str) -> String {
    if !t.contains(':') {
        return t.to_string();
    }
    let now = chrono::Local::now().naive_local();
    dt_any()
        .replace_all(t, |c: &regex::Captures| {
            let p = |i: usize| c.get(i).map(|m| m.as_str().parse::<u32>().unwrap_or(0));
            let d = chrono::NaiveDate::from_ymd_opt(p(1).unwrap() as i32, p(3).unwrap(), p(4).unwrap())
                .and_then(|d| d.and_hms_opt(p(6).unwrap(), p(7).unwrap(), p(8).unwrap_or(0)));
            let Some(d) = d else { return c[0].to_string() };
            let off = (d - now).num_seconds();
            if off.abs() > NEAR {
                return c[0].to_string();
            }
            let prec = match (c.get(8), c.get(9)) {
                (None, _) => "m".to_string(),
                (Some(_), None) => "s".to_string(),
                (Some(_), Some(f)) => format!("f{}", f.as_str().len()),
            };
            format!("@T({}{}{prec}|{off})", &c[2], &c[5])
        })
        .into_owned()
}

/// 時刻の数（秒・ミリ秒の 1970 年からの数）が今に近ければ「@T(epoch|今からの秒)」
fn near_epoch(x: f64) -> Option<String> {
    let now = now_secs();
    if (x - now).abs() <= NEAR as f64 {
        return Some(format!("@T(epoch|{})", (x - now).round() as i64));
    }
    if (x / 1000.0 - now).abs() <= NEAR as f64 {
        return Some(format!("@T(epoch-ms|{})", (x / 1000.0 - now).round() as i64));
    }
    None
}

/// そろえる（tests/baked/settle.json の字の形と、今に近い時刻・道の字・大きな整数の印・利用者の名前の欄・アプリの版）。extra_keys は本ごとに足す
/// 時刻の鍵。TPA_SETTLE_DROP=決まり（形の置き換えの字・鍵の名前・near）で 1 つ外して流せる（変異: 外すと焼きの 2 回目・表との比べが落ちる）
pub fn settle(v: &Value, ctx: &Ctx, extra_keys: &[String]) -> Value {
    static DROP: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    let drop = DROP.get_or_init(|| std::env::var("TPA_SETTLE_DROP").ok().filter(|s| !s.is_empty()));
    settle_with(v, ctx, extra_keys, drop.as_deref())
}

/// settle の決まりを 1 つ外した形（drop: 形の置き換えの字か、鍵の名前か、"near"〈今に近い時刻〉）
pub fn settle_with(v: &Value, ctx: &Ctx, extra_keys: &[String], drop: Option<&str>) -> Value {
    let r = rules();
    let keys: Vec<&str> = r["timeKeys"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .chain(extra_keys.iter().map(String::as_str))
        .filter(|k| Some(*k) != drop)
        .collect();
    let names: Vec<&str> = name_keys().into_iter().filter(|k| Some(*k) != drop).collect();
    let (all, day_re) = compiled();
    let forms: Vec<&(regex::Regex, String)> = all.iter().filter(|(_, to)| Some(to.as_str()) != drop).collect();
    let near = drop != Some("near");
    let stamp = drop != Some("@BUILD");
    // 名乗りの表（{key, pc, …}）の鍵は「端末@利用者」（使えない字があれば _ にして sha1 の 6 字を足す。bundle::terminal_key）。
    // 鍵が「OS の利用者の名前と、となりの pc」から作った字そのもののときだけ、利用者を @USER にして作り直した字にそろえる
    let who_key = drop != Some("who.key");
    // 名乗りの表の pc がこの PC の名前（ホスト名）そのもののときだけ @HOST に（名乗りを決めていない場面。鍵も @HOST で作り直す）
    let host = drop != Some("@HOST");
    let today = chrono::Local::now().date_naive();
    let s = |t: &str| -> String {
        // 大きな整数の印（起動ごとの乱数つき）は @HELD: に。書いた人の言葉の「PC／名前 が」の名前は @USER に
        let mut t = ctx.sub_slash(t).replace(da_core::held::mark(), "@HELD:");
        if stamp && t.contains(build_stamp()) {
            t = t.replace(build_stamp(), "@BUILD");
            // 画面の字（指紋のある字）の中のアプリの版（見出しの札「VER3.116.0」）も @VERSION に（版を上げるたびに表が古くならないように。
            // 値がアプリの版そのものの欄は下の go が @VERSION にする）。前後が数字・点でない所だけ。指紋の無い字の中の版はそのまま比べる
            let ver = super::re(&format!(r"(^|[^0-9.]){}([^0-9.]|$)", regex::escape(app_version())));
            t = ver.replace_all(&t, "${1}@VERSION${2}").into_owned();
        }
        if let Some(u) = os_user() {
            if t.contains(&format!("／{u} ")) {
                t = t.replace(&format!("／{u} "), "／@USER ");
            }
        }
        for (re, to) in &forms {
            if re.is_match(&t) {
                t = re.replace_all(&t, to.as_str()).into_owned();
            }
        }
        if near {
            t = near_times(&t);
        }
        // 今日から 3 日の内の日付だけの字は今日からのずれで持つ（作業日・前日の答え）
        day_re
            .replace_all(&t, |c: &regex::Captures| {
                let d = chrono::NaiveDate::from_ymd_opt(c[1].parse().unwrap_or(0), c[3].parse().unwrap_or(0), c[5].parse().unwrap_or(0));
                match d {
                    Some(d) if near && (d - today).num_days().abs() <= 3 => format!("@DAY{:+}{}", (d - today).num_days(), &c[2]),
                    _ => c[0].to_string(),
                }
            })
            .into_owned()
    };
    struct Cx<'a> {
        keys: &'a [&'a str],
        names: &'a [&'a str],
        who_key: bool,
        host: bool,
        near: bool,
        s: &'a dyn Fn(&str) -> String,
    }
    fn go(v: &Value, key: &str, cx: &Cx) -> Value {
        match v {
            // 値の字だけ（鍵は替えない）: アプリの版は @VERSION（版を上げるたびに表が古くならないように）
            Value::String(t) if t == app_version() => json!("@VERSION"),
            // 利用者の名前を書く欄（nameKeys）の OS の利用者の名前は @USER（root で焼き、CI の runner でも同じ表）
            Value::String(t) if cx.names.contains(&key) && (os_user() == Some(t.as_str()) || t == "@USER@") => json!("@USER"),
            Value::String(t) => Value::String((cx.s)(t)),
            // 時刻の鍵の今に近い数（1970 年からの秒・ミリ秒）だけ。遠い数はそのまま
            Value::Number(n) if cx.near && cx.keys.contains(&key) => {
                n.as_f64().and_then(near_epoch).map(Value::String).unwrap_or_else(|| v.clone())
            }
            Value::Array(a) => {
                let out: Vec<Value> = a.iter().map(|x| go(x, key, cx)).collect();
                above_crumbs(out)
            }
            Value::Object(o) => {
                let mut out: Map<String, Value> = o.iter().map(|(k, x)| ((cx.s)(k), go(x, k, cx))).collect();
                // この PC の名前（ホスト名）そのものの pc は @HOST（表の「pc」の欄だけ。ほかの欄・ほかの名前はそのまま比べる）
                let pc = o.get("pc").and_then(Value::as_str);
                let is_host = cx.host && pc.is_some() && pc == host_name();
                if is_host {
                    out.insert("pc".into(), json!("@HOST"));
                }
                if let (true, Some(k), Some(pc), Some(u)) = (cx.who_key, o.get("key").and_then(Value::as_str), pc, os_user()) {
                    if k == da_core::bundle::terminal_key(u, pc) {
                        out.insert("key".into(), json!(da_core::bundle::terminal_key("@USER", if is_host { "@HOST" } else { pc })));
                    }
                }
                Value::Object(out)
            }
            _ => v.clone(),
        }
    }
    go(v, "", &Cx { keys: &keys, names: &names, who_key, host, near, s: &s })
}

/// 区切り（crumbs: {name, path} の並び）のうち作業フォルダより上の段は 1 つの @ABOVE にまとめる（作業フォルダの深さ〈一時フォルダの場所〉に頼らない）
fn above_crumbs(v: Vec<Value>) -> Value {
    let crumb =
        |x: &Value| x.as_object().is_some_and(|o| o.len() == 2 && o.contains_key("name") && o.get("path").is_some_and(Value::is_string));
    if v.is_empty() || !v.iter().all(crumb) || !v.iter().any(|x| x["path"].as_str().unwrap().starts_with("@WORK")) {
        return Value::Array(v);
    }
    let mut out = vec![json!({"name": "@ABOVE", "path": "@ABOVE"})];
    out.extend(v.into_iter().filter(|x| x["path"].as_str().unwrap().starts_with("@WORK")));
    Value::Array(out)
}

/// 今からの秒を抜いた形（試験そのものの比べと、2 回の焼きの比べ）
fn offset_re() -> &'static regex::Regex {
    static R: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    R.get_or_init(|| regex::Regex::new(r"@T\(([^|)]*)\|(-?\d+)\)").unwrap())
}

/// 答え合わせ役が窓に渡す設定の答え（/api/lotlist/settings）の変換表の版の印（conversions.rev）を決めた字にする（版 3.117.2。表の問い合わせ用）。
/// 版の印は同梱の変換表のファイルの更新時刻（取り出した時刻）から作るので、取り出した PC ごとに違う。窓はこの印を変換表の控えの鍵にだけ使う
/// （同じ印なら同じ表）。Python と比べる形は本物の印のまま渡し、表には決めた字を持つ
pub fn fixed_conv_rev(v: &mut Value) {
    match v {
        Value::Object(o) => {
            if let Some(Value::Object(c)) = o.get_mut("conversions") {
                if c.get("rev").is_some_and(Value::is_string) {
                    c.insert("rev".into(), json!("@REV"));
                }
            }
            o.values_mut().for_each(fixed_conv_rev);
        }
        Value::Array(a) => a.iter_mut().for_each(fixed_conv_rev),
        _ => {}
    }
}

pub fn without_offsets(v: &Value) -> Value {
    let re = offset_re();
    map_strings(v, &|s| if s.contains("@T(") { re.replace_all(s, "@T($1)").into_owned() } else { s.to_string() })
}

/// 錠の「あと約 n 秒」（言葉の「あと約n秒」と鍵 remaining の数）で許す差。錠の残りは「期限 − 今」の秒を切って 1 を足した数（窓の
/// master_store::wait・Python の MasterLocked）で、期限は秒まで・今は小数なので、錠を置いた時刻の秒の端数と、置いてから断られるまでの
/// わずかな時間で、同じ錠が 20 にも 19 にもなる（版 3.115.0 の PR #115 の CI の直し: masters の「丸ごと扱う間の中の書き込み」が
/// 手元で焼いた 20 に対し CI で 19 になって落ちた。Python と比べる試験は前から ±1 を許している〈masters_parity の same_remaining〉。
/// 焼いた表との比べだけが 1 字まで比べていた）。2 より大きい差・持ち主の名前・ほかの数は許さない
const WAIT_TOL: i64 = 1;

fn wait_re() -> &'static regex::Regex {
    super::re(r"あと約(\d+)秒")
}

/// 時刻の印（@T(形|秒)）の秒の差（TOL 秒の内）と、錠の「あと約 n 秒」の差（WAIT_TOL の内）を許して比べる。最初の違いの道
pub fn diff_tol(a: &Value, b: &Value, path: &str) -> Option<String> {
    let re = offset_re();
    match (a, b) {
        (Value::String(x), Value::String(y))
            if x != y && (x.contains("@T(") || y.contains("@T(") || (x.contains("あと約") && y.contains("あと約"))) =>
        {
            let w = wait_re();
            let shape = |t: &str| w.replace_all(&re.replace_all(t, "@T($1)"), "あと約#秒").into_owned();
            let nums = |t: &str, r: &regex::Regex, i: usize| -> Vec<i64> { r.captures_iter(t).filter_map(|c| c[i].parse().ok()).collect() };
            let near = |p: Vec<i64>, q: Vec<i64>, tol: i64| p.len() == q.len() && p.iter().zip(&q).all(|(m, n)| (m - n).abs() <= tol);
            let close = near(nums(x, re, 2), nums(y, re, 2), TOL) && near(nums(x, w, 1), nums(y, w, 1), WAIT_TOL);
            (shape(x) != shape(y) || !close).then(|| format!("{path}: {x} / {y}"))
        }
        // 錠の残りの数（鍵 remaining）
        (Value::Number(x), Value::Number(y)) if x != y && path.ends_with(".remaining") => {
            let close = matches!((x.as_i64(), y.as_i64()), (Some(p), Some(q)) if (p - q).abs() <= WAIT_TOL);
            (!close).then(|| format!("{path}: {x} / {y}"))
        }
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys()) {
                match (x.get(k), y.get(k)) {
                    (Some(p), Some(q)) => {
                        if let Some(d) = diff_tol(p, q, &format!("{path}.{k}")) {
                            return Some(d);
                        }
                    }
                    (p, q) => return Some(format!("{path}.{k}: {p:?} / {q:?}")),
                }
            }
            None
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{path}: 長さ {} / {}", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().find_map(|(i, (p, q))| diff_tol(p, q, &format!("{path}[{i}]")))
        }
        _ => super::diff(a, b, path),
    }
}

// ------------------------------------------------------------------ 詰める形（版 3.116.0。大きい本の表）

/// これより長い字（JSON の字の長さ）で、表の中に 2 回以上出る部分（表・並び・字）は参照にする
pub const PACK_MIN: usize = 120;
/// これより長く同じ単位が続く所のある字は作り方（間の字と [単位, 数] の並び）で持つ
pub const REP_MIN: usize = 2000;
const MARKS: [&str; 3] = ["@same", "@rep", "@lit"];

/// 指紋を取る字（中身の字。大きな整数・NaN は桁のまま）
fn canon(v: &Value) -> String {
    if da_core::held::has_held(v) || da_core::held::has_nonfinite(v) || da_core::held::has_lone(v) {
        da_core::held::to_text(v, None)
    } else {
        serde_json::to_string(v).unwrap()
    }
}

fn print_of(text: &str) -> String {
    use sha2::Digest;
    format!("{:x}", sha2::Sha256::digest(text.as_bytes()))[..12].to_string()
}

/// 詰める印と同じ形の表（鍵が 1 つで @same・@rep・@lit）か
fn marked(o: &Map<String, Value>) -> bool {
    o.len() == 1 && o.keys().next().is_some_and(|k| MARKS.contains(&k.as_str()))
}

/// 長い字の作り方: 同じ単位（1〜64 字）が REP_MIN 字より長く続く所を [単位, 数] にし、間の字はそのまま並べる
/// （{"@rep": ["頭", ["あ", 1000000], "間", ["い", 500000], "尾"]}）。続く所が無ければ None
fn rep_of(s: &str) -> Option<Value> {
    let c: Vec<char> = s.chars().collect();
    if c.len() <= REP_MIN {
        return None;
    }
    let mut covered = vec![false; c.len()];
    let mut runs: Vec<(usize, usize, usize)> = vec![];
    for u in 1..=64usize {
        // 残りに REP_MIN 字より長い続きが入る所が無ければ終わり
        let (mut free, mut best) = (0usize, 0usize);
        for x in &covered {
            free = if *x { 0 } else { free + 1 };
            best = best.max(free);
        }
        if best < REP_MIN {
            break;
        }
        let mut i = 0;
        while i + u < c.len() {
            if covered[i] || covered[i + u] || c[i] != c[i + u] {
                i += 1;
                continue;
            }
            let (l, mut r) = (i, i);
            while r + u < c.len() && c[r] == c[r + u] && !covered[r + u] {
                r += 1;
            }
            let n = (r + u - l) / u;
            if n * u >= REP_MIN {
                runs.push((l, u, n));
                covered[l..l + n * u].iter_mut().for_each(|x| *x = true);
                i = l + n * u;
            } else {
                i = r + 1;
            }
        }
    }
    if runs.is_empty() {
        return None;
    }
    runs.sort();
    let text = |a: usize, b: usize| c[a..b].iter().collect::<String>();
    let (mut segs, mut at) = (vec![], 0);
    for (l, u, n) in runs {
        if l > at {
            segs.push(json!(text(at, l)));
        }
        segs.push(json!([text(l, l + u), n]));
        at = l + n * u;
    }
    if at < c.len() {
        segs.push(json!(text(at, c.len())));
    }
    Some(json!({"@rep": segs}))
}

/// 詰める: sections（表の answers・oracle・scene・variants）の中で 2 回以上出る部分を {"@same": 中身の指紋 12 桁} にし、中身は parts
/// （指紋 → 中身。scene.blobs と同じ形）に 1 つだけ置く。参照は通し番号でも初出の位置でもなく中身の指紋なので、1 歩が変わっても
/// ほかの歩の行は動かない（PR の差分と、範囲を決めた焼き直しの「範囲の外が変わった」が誤って当たらない）。長い繰り返しの字は作り方
/// {"@rep": [字, [単位, 数], …]}。印と同じ形の表は {"@lit": …} で包む。比べるのはいつも開いた後（unpack）
pub fn pack(sections: &mut [&mut Value]) -> Map<String, Value> {
    use std::collections::HashMap;
    fn scan(v: &Value, counts: &mut HashMap<String, u32>) {
        match v {
            Value::Array(a) => a.iter().for_each(|x| scan(x, counts)),
            Value::Object(o) => o.values().for_each(|x| scan(x, counts)),
            _ => {}
        }
        if matches!(v, Value::Array(_) | Value::Object(_) | Value::String(_)) {
            let t = canon(v);
            if t.len() > PACK_MIN {
                *counts.entry(print_of(&t)).or_default() += 1;
            }
        }
    }
    fn go(v: &Value, counts: &HashMap<String, u32>, parts: &mut BTreeMap<String, Value>, texts: &mut HashMap<String, String>) -> Value {
        let inner = match v {
            Value::Array(a) => Value::Array(a.iter().map(|x| go(x, counts, parts, texts)).collect()),
            Value::Object(o) => {
                let m: Map<String, Value> = o.iter().map(|(k, x)| (k.clone(), go(x, counts, parts, texts))).collect();
                if marked(o) {
                    json!({"@lit": m})
                } else {
                    Value::Object(m)
                }
            }
            Value::String(s) => rep_of(s).unwrap_or_else(|| v.clone()),
            _ => return v.clone(),
        };
        let t = canon(v);
        if t.len() <= PACK_MIN {
            return inner;
        }
        let h = print_of(&t);
        if counts.get(&h).copied().unwrap_or(0) < 2 {
            return inner;
        }
        match texts.get(&h) {
            Some(old) => assert!(*old == t, "指紋 {h} が 2 つの中身に当たりました"),
            None => {
                texts.insert(h.clone(), t);
                parts.insert(h.clone(), inner);
            }
        }
        json!({"@same": h})
    }
    let mut counts = HashMap::new();
    sections.iter().for_each(|s| scan(s, &mut counts));
    let (mut parts, mut texts) = (BTreeMap::new(), HashMap::new());
    for s in sections.iter_mut() {
        **s = go(s, &counts, &mut parts, &mut texts);
    }
    parts.into_iter().collect()
}

/// 開く（pack の逆）。参照の先が parts に無ければ分かる言葉で落とす
pub fn unpack(v: &Value, parts: &Map<String, Value>) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(|x| unpack(x, parts)).collect()),
        Value::Object(o) if marked(o) => {
            let (k, x) = o.iter().next().unwrap();
            match k.as_str() {
                "@same" => {
                    let h = x.as_str().unwrap_or("");
                    unpack(parts.get(h).unwrap_or_else(|| panic!("詰めた表の参照 {h} の中身が parts にありません")), parts)
                }
                "@rep" => Value::String(
                    x.as_array()
                        .map(|segs| {
                            segs.iter()
                                .map(|s| match s {
                                    Value::String(t) => t.clone(),
                                    s => s[0].as_str().unwrap_or("").repeat(s[1].as_u64().unwrap_or(0) as usize),
                                })
                                .collect::<String>()
                        })
                        .unwrap_or_default(),
                ),
                _ => {
                    Value::Object(x.as_object().map(|m| m.iter().map(|(k, y)| (k.clone(), unpack(y, parts))).collect()).unwrap_or_default())
                }
            }
        }
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), unpack(x, parts))).collect()),
        _ => v.clone(),
    }
}

/// 表を開いた形にする（parts を外す。詰めていない表はそのまま）
pub fn unpack_table(t: &Value) -> Value {
    let Some(parts) = t.get("parts").and_then(Value::as_object) else { return t.clone() };
    let mut out = Map::new();
    for (k, v) in t.as_object().unwrap() {
        if k != "parts" {
            out.insert(k.clone(), if PACKED.contains(&k.as_str()) { unpack(v, parts) } else { v.clone() });
        }
    }
    Value::Object(out)
}

/// 詰める段（表の上の鍵）
const PACKED: [&str; 4] = ["oracle", "scene", "answers", "variants"];

/// 表を詰めた形にする（PACKED の段を詰め、parts を足す。2 回出る部分が無くても空の parts を付ける＝詰めた表の印）
pub fn pack_table(t: &Value) -> Value {
    let mut t = unpack_table(t);
    let o = t.as_object_mut().unwrap();
    let mut held: Vec<(String, Value)> = PACKED.iter().filter_map(|k| o.get(*k).map(|v| (k.to_string(), v.clone()))).collect();
    let parts = {
        let mut refs: Vec<&mut Value> = held.iter_mut().map(|(_, v)| v).collect();
        pack(&mut refs)
    };
    for (k, v) in held {
        o.insert(k, v);
    }
    // parts はいつも付ける（空でも。詰めた表の印: 開く側は parts があれば開く。版 3.116.0 の作った後の直し: 前は 2 回出る部分が
    // 無いと付けず、長い繰り返しの字 @rep・印と同じ形の表 @lit だけがある表が開かれなかった）
    o.insert("parts".into(), Value::Object(parts));
    t
}

// ------------------------------------------------------------------ 場面の宣言（フォルダの写し）

fn b64(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for (i, sh) in [18, 12, 6, 0].iter().enumerate() {
            o.push(if i <= c.len() { T[(n >> sh & 63) as usize] as char } else { '=' });
        }
    }
    o
}

fn unb64(s: &str) -> Vec<u8> {
    let val = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        _ => 63,
    };
    let mut o = vec![];
    for c in s.as_bytes().chunks(4) {
        let pad = c.iter().filter(|&&x| x == b'=').count();
        let n = c.iter().fold(0u32, |n, &x| n << 6 | if x == b'=' { 0 } else { val(x) as u32 });
        let bytes = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        o.extend_from_slice(&bytes[..3 - pad]);
    }
    o
}

fn now_secs() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64()
}

fn ns_of(t: SystemTime) -> i64 {
    match t.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_nanos() as i64,
        Err(e) => -(e.duration().as_nanos() as i64),
    }
}

fn time_of_ns(ns: i64) -> SystemTime {
    if ns >= 0 {
        UNIX_EPOCH + Duration::from_nanos(ns as u64)
    } else {
        UNIX_EPOCH - Duration::from_nanos(ns.unsigned_abs())
    }
}

/// 更新時刻: 今に近ければ今からのずれ（ms）、遠ければ ns
fn mtime_decl(t: SystemTime) -> Value {
    let ns = ns_of(t);
    let off = ns / 1_000_000 - (now_secs() * 1000.0) as i64;
    if off.abs() <= NEAR * 1000 {
        json!(format!("@NOW({off}ms)"))
    } else {
        json!(ns)
    }
}

fn mtime_of_decl(v: &Value) -> Option<SystemTime> {
    if let Some(ns) = v.as_i64() {
        return Some(time_of_ns(ns));
    }
    let s = v.as_str()?;
    let ms: i64 = s.strip_prefix("@NOW(")?.strip_suffix("ms)")?.parse().ok()?;
    Some(time_of_ns(((now_secs() * 1000.0) as i64 + ms) * 1_000_000))
}

fn dt_re() -> &'static regex::Regex {
    super::re(r"(\d{4})-(\d{2})-(\d{2})([T ])(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?")
}

/// 中身の字の今に近い日時を「@NOW(ずれ ms,区切り,桁)」にする（作る時に今からのずれで書き戻す。ほかの PC の錠の時刻など）
/// 中身の字の、利用者の名前を書く欄（settle.json の nameKeys）の OS の利用者の名前を "@USER@" に（場面の権限の行・錠の持ち主・書いた人は
/// 流した利用者の名前。版 3.115.0 の作った後の直し: 前は値の字の一致で当て、場面の人の名前とも重なった）
fn user_decl(t: &str) -> String {
    let Some(u) = os_user() else { return t.to_string() };
    if !t.contains(&format!("\"{u}\"")) {
        return t.to_string();
    }
    let keys: Vec<String> = name_keys().iter().map(|k| regex::escape(k)).collect();
    // 利用者の名前で形が変わるので、形の字ごとに覚える（super::re）
    let re = super::re(&format!(r#"("(?:{})"\s*:\s*)"{}""#, keys.join("|"), regex::escape(u)));
    re.replace_all(t, "${1}\"@USER@\"").into_owned()
}

/// 答え合わせ役の答えの、利用者の名前を書く欄の OS の利用者の名前を @USER@ に。名乗りの表（{key, pc}）の鍵が OS の利用者の名前と
/// となりの pc から作った字（bundle::terminal_key）そのものなら @USERKEY@ に（版 3.117.2: ops の答え合わせ役は名乗りを決めない設定の答え
/// access.who を窓に渡すので、root で焼いた表の鍵「PC-ORACLE@root」が root でない利用者で流すと古いと読まれた。作り直す時に今の利用者で作り直す）
pub fn named_users(v: &Value, key: &str) -> Value {
    match v {
        Value::String(s) if name_keys().contains(&key) && os_user() == Some(s.as_str()) => json!("@USER@"),
        Value::Array(a) => Value::Array(a.iter().map(|x| named_users(x, key)).collect()),
        Value::Object(o) => {
            let mut out: Map<String, Value> = o.iter().map(|(k, x)| (k.clone(), named_users(x, k))).collect();
            if let (Some(k), Some(pc), Some(u)) = (o.get("key").and_then(Value::as_str), o.get("pc").and_then(Value::as_str), os_user()) {
                if k == da_core::bundle::terminal_key(u, pc) {
                    out.insert("key".into(), json!("@USERKEY@"));
                }
            }
            Value::Object(out)
        }
        _ => v.clone(),
    }
}

/// named_users の逆（作り直す時に今の OS の利用者へ）: "@USER@" は今の利用者の名前、名乗りの表の鍵 "@USERKEY@" は今の利用者と pc から作り直す
pub fn unnamed_users(v: &Value) -> Value {
    match v {
        Value::String(s) if s == "@USER@" => json!(os_user().unwrap_or("")),
        Value::Array(a) => Value::Array(a.iter().map(unnamed_users).collect()),
        Value::Object(o) => {
            let mut out: Map<String, Value> = o.iter().map(|(k, x)| (k.clone(), unnamed_users(x))).collect();
            if o.get("key").and_then(Value::as_str) == Some("@USERKEY@") {
                let pc = o.get("pc").and_then(Value::as_str).unwrap_or("");
                out.insert("key".into(), json!(da_core::bundle::terminal_key(os_user().unwrap_or(""), pc)));
            }
            Value::Object(out)
        }
        _ => v.clone(),
    }
}

fn text_decl(t: &str, ctx: &Ctx) -> String {
    let now = chrono::Local::now().naive_local();
    let t = user_decl(&ctx.sub(t));
    dt_re()
        .replace_all(&t, |c: &regex::Captures| {
            let p = |i: usize| c.get(i).map(|m| m.as_str().parse::<u32>().unwrap_or(0));
            let frac = c.get(8).map(|m| m.as_str());
            let d = chrono::NaiveDate::from_ymd_opt(p(1).unwrap() as i32, p(2).unwrap(), p(3).unwrap())
                .and_then(|d| d.and_hms_opt(p(5).unwrap(), p(6).unwrap(), p(7).unwrap_or(0)));
            let Some(mut d) = d else { return c[0].to_string() };
            if let Some(f) = frac {
                let ns: u32 = format!("{f:0<9}").parse().unwrap_or(0);
                d += chrono::Duration::nanoseconds(ns as i64);
            }
            let off = (d - now).num_milliseconds();
            if off.abs() > NEAR * 1000 {
                return c[0].to_string();
            }
            let prec = match (c.get(7), frac) {
                (None, _) => "m".to_string(),
                (Some(_), None) => "s".to_string(),
                (Some(_), Some(f)) => format!("f{}", f.len()),
            };
            format!("@NOW({off}ms,{},{prec})", &c[4])
        })
        .into_owned()
}

fn text_of_decl(t: &str, ctx: &Ctx) -> String {
    let re = super::re(r"@NOW\((-?\d+)ms,([T ]),(m|s|f\d)\)");
    let now = chrono::Local::now().naive_local();
    let t = re.replace_all(t, |c: &regex::Captures| {
        let d = now + chrono::Duration::milliseconds(c[1].parse().unwrap());
        let sep = &c[2];
        match &c[3] {
            "m" => d.format(&format!("%Y-%m-%d{sep}%H:%M")).to_string(),
            "s" => d.format(&format!("%Y-%m-%d{sep}%H:%M:%S")).to_string(),
            f => {
                let n: usize = f[1..].parse().unwrap();
                let frac = format!("{:09}", d.and_utc().timestamp_subsec_nanos());
                format!("{}.{}", d.format(&format!("%Y-%m-%d{sep}%H:%M:%S")), &frac[..n])
            }
        }
    });
    let t = match os_user() {
        Some(u) if t.contains("\"@USER@\"") => t.replace("\"@USER@\"", &format!("\"{u}\"")),
        _ => t.into_owned(),
    };
    ctx.unsub(&t)
}

#[cfg(unix)]
fn mode_of(m: &std::fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    m.permissions().mode() & 0o7777
}
#[cfg(not(unix))]
fn mode_of(_: &std::fs::Metadata) -> u32 {
    0
}

/// 場面の台本（標準の部品だけの Python）が作ったファイルの指紋: SQLite は作った SQLite の版によらない形（sqlite_logical）の字、
/// ほかはバイトの sha256 の頭 16 字。焼いた表はこの指紋だけを持ち（中身は持たない）、台本が作り直した物と比べる
pub fn made_print(p: &Path) -> String {
    use sha2::Digest;
    let b = std::fs::read(p).unwrap_or_default();
    let text = sqlite_logical(&b).map(|v| v.to_string().into_bytes()).unwrap_or(b);
    format!("{:x}", sha2::Sha256::digest(&text))[..16].to_string()
}

/// 場面のフォルダを宣言に写す（files・dirs・links と中身 blobs〈同じ中身は 1 つ〉）。exclude の名前の段（Python だけの写し py・pd）は除く
pub fn snapshot(base: &Path, ctx: &Ctx, exclude: &[&str]) -> Value {
    snapshot_with(base, ctx, exclude, &[])
}

/// snapshot と同じだが、made（場面の台本が作るファイルの相対の道）は中身でなく指紋（made_print）で持つ（版 3.116.0。大きな SQLite を
/// 表に入れない。Python 無しの形では台本が作り直し、指紋が表と同じかを見る）
pub fn snapshot_with(base: &Path, ctx: &Ctx, exclude: &[&str], made: &[String]) -> Value {
    use sha2::Digest;
    let (mut files, mut dirs, mut links, mut blobs) = (Map::new(), Map::new(), Map::new(), Map::new());
    fn walk(d: &Path, rel: &str, out: &mut Vec<(String, PathBuf)>, exclude: &[&str]) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        let mut es: Vec<_> = rd.flatten().collect();
        es.sort_by_key(|e| e.file_name());
        for e in es {
            let n = e.file_name().to_string_lossy().into_owned();
            if exclude.contains(&n.as_str()) {
                continue;
            }
            let r = if rel.is_empty() { n.clone() } else { format!("{rel}/{n}") };
            out.push((r.clone(), e.path()));
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                walk(&e.path(), &r, out, exclude);
            }
        }
    }
    let mut all = vec![];
    walk(base, "", &mut all, exclude);
    for (rel, p) in all {
        let Ok(m) = std::fs::symlink_metadata(&p) else { continue };
        if m.file_type().is_symlink() {
            links.insert(rel, json!(ctx.sub(&std::fs::read_link(&p).unwrap().to_string_lossy())));
            continue;
        }
        let mut e = Map::new();
        if let Ok(t) = m.modified() {
            e.insert("mtime".into(), mtime_decl(t));
        }
        let md = mode_of(&m);
        if !m.is_dir() && !m.is_file() {
            // 名前付きパイプなど（読むと止まる）は種類だけ持つ
            #[cfg(unix)]
            {
                use std::os::unix::fs::FileTypeExt;
                if m.file_type().is_fifo() {
                    e.insert("fifo".into(), json!(true));
                    if md != 0o644 {
                        e.insert("mode".into(), json!(md));
                    }
                    files.insert(rel, Value::Object(e));
                }
            }
            continue;
        }
        if m.is_dir() {
            if md != 0o755 && cfg!(unix) {
                e.insert("mode".into(), json!(md));
            }
            dirs.insert(rel, Value::Object(e));
            continue;
        }
        if md != 0o644 && cfg!(unix) {
            e.insert("mode".into(), json!(md));
        }
        if made.contains(&rel) {
            // 台本が作るファイル: 指紋だけ（更新時刻は台本を流した時刻なので持たない）
            e.remove("mtime");
            e.insert("made".into(), json!(made_print(&p)));
            files.insert(rel, Value::Object(e));
            continue;
        }
        let b = std::fs::read(&p).unwrap_or_default();
        let blob = match std::str::from_utf8(&b) {
            Ok(t) if !t.contains('\0') => json!({"text": text_decl(t, ctx)}),
            _ => json!({"b64": b64(&b)}),
        };
        let h = format!("{:x}", sha2::Sha256::digest(blob.to_string().as_bytes()));
        let h = h[..16].to_string();
        blobs.insert(h.clone(), blob);
        e.insert("blob".into(), json!(h));
        files.insert(rel, Value::Object(e));
    }
    json!({"files": files, "dirs": dirs, "links": links, "blobs": blobs})
}

/// 何を尋ねられても 404 を答える作り物のサーバー（組む所の CM3。前の版の答え合わせ役 builder の _Cm3 と同じ）→ URL
pub fn serve_404() -> String {
    use std::io::{Read, Write};
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}", l.local_addr().unwrap().port());
    std::thread::spawn(move || {
        for c in l.incoming().flatten() {
            std::thread::spawn(move || {
                let mut c = c;
                let _ = c.set_read_timeout(Some(Duration::from_secs(5)));
                let (mut buf, mut got) = ([0u8; 4096], vec![]);
                while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                    match c.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => got.extend_from_slice(&buf[..n]),
                    }
                }
                let _ = c.write_all(b"HTTP/1.0 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            });
        }
    });
    url
}

/// ファイルID（Python の work_log.file_id と同じ形。窓の same_fid で比べる）。窓の lists::file_id をそのまま呼ぶ（版 3.117.2 の作った後の
/// 採点の割れ 2: 前は試験に unix の「装置:inode」の写しだけを持ち、Windows では空を返して、表だけの形で名前を変えた HOT を同じファイルID で
/// たどる歩が落ちる形だった。Windows は窓と同じ「巻の番号:ファイル番号:作った時刻 ns」。bake_selftest の
/// the_scene_file_id_is_the_window_file_id）
pub fn fid_of(p: &Path) -> String {
    da_core::lists::file_id(p)
}

/// @FID(場面の道) を今のファイルID に
fn fid_unsub(s: &str, base: &Path) -> String {
    if !s.contains("@FID(") {
        return s.to_string();
    }
    let re = super::re(r"@FID\(([^)]*)\)");
    re.replace_all(s, |c: &regex::Captures| fid_of(&base.join(&c[1]))).into_owned()
}

/// 宣言から場面のフォルダを作る（snapshot の逆）。宣言どおりに作れない物があれば落とす（版 3.117.3 の作った後の直し・割れ 4 (e): 前は
/// Windows で作れない物を黙って捨てた。作り方は materialize_os の 1 つ）
pub fn materialize(decl: &Value, base: &Path, ctx: &Ctx) {
    let unmade = materialize_os(decl, base, ctx, if cfg!(windows) { "nt" } else { "posix" });
    assert!(unmade.is_empty(), "場面を宣言どおりに作れません（Windows で作れない物は nt の表の unmade に持つ）: {unmade:?}");
}

/// Windows で使えない名前の段か（制御文字・< > : " / \ | ? *・最後が空白か「.」・予約の名前 CON・PRN・AUX・NUL・COM0〜9・LPT0〜9〈拡張子つきも〉）
pub fn windows_bad_name(seg: &str) -> bool {
    let stem = seg.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem[3..].chars().all(|c| c.is_ascii_digit() || "¹²³".contains(c)));
    seg.chars().any(|c| (c as u32) < 32 || "<>:\"/\\|?*".contains(c)) || seg.ends_with([' ', '.']) || reserved
}

/// 権限の数が Windows で表せない差か（版 3.117.3 の作った後の直し・割れ 1）: Windows の場面は権限を当てない（持ち主はいつも読み書きできる）ので、
/// 持ち主が読めない・書けない（m & 0o600 != 0o600。読めないフォルダ 0o000・読むだけ 0o444・0o555 など）物だけが宣言と違う。
/// 実行の印・組と他人の印（0o644・0o755・0o700・0o775 など）は Windows では意味が無く、答えも変わらないので数えない
/// （前は権限の数のある物を全部数え、札が table の access の 41 件〈0o755〉で必ず落ちる形だった）
pub fn windows_bad_mode(m: u64) -> bool {
    m & 0o600 != 0o600
}

/// 宣言から決まる「Windows で宣言どおりに作れない物」（os が nt のとき。版 3.117.3）: 名前付きパイプ・使えない名前（その下の物も）・
/// 表せない権限。cfg でなく os の値で選ぶので、Linux の上でも Windows の形の数え方を試せる（TPA_BAKE_OS=nt）。記号リンクを作れるかは
/// 流す PC で決まる（作れなければ materialize_os が足す）
pub fn predicted_unmade(decl: &Value, os: &str) -> Vec<String> {
    let mut out = vec![];
    if os != "nt" {
        return out;
    }
    let bad_path = |rel: &str| rel.split('/').any(windows_bad_name);
    for (rel, e) in decl["dirs"].as_object().into_iter().flatten() {
        if bad_path(rel) {
            out.push(format!("dir {rel}"));
        } else if e["mode"].as_u64().is_some_and(windows_bad_mode) {
            out.push(format!("mode {rel}"));
        }
    }
    for (rel, e) in decl["files"].as_object().into_iter().flatten() {
        if bad_path(rel) {
            out.push(format!("file {rel}"));
        } else if e["fifo"] == true {
            out.push(format!("fifo {rel}"));
        } else if e["mode"].as_u64().is_some_and(windows_bad_mode) {
            out.push(format!("mode {rel}"));
        }
    }
    for rel in decl["links"].as_object().into_iter().flatten().map(|(r, _)| r) {
        if bad_path(rel) {
            out.push(format!("link {rel}"));
        }
    }
    out.sort();
    out
}

/// 宣言から場面のフォルダを作り、宣言どおりに作れなかった物を返す（版 3.117.3。os は bake_os。返す字は「種類 道」）:
/// os が nt なら、宣言から決まる作れない物（predicted_unmade）は作らずに返し、そのほかに作るのが OS の誤りになった物・記号リンクを作れなかった物を足す
/// （Windows の本物で。Linux の上の Windows の形〈TPA_BAKE_OS=nt〉では起きない）。os が posix なら、作れなければ OS の誤りの字で落とす。
/// 焼いた表の nt の側（tests/baked/nt/<表>.json の unmade）がこの並びを持ち、増えても減っても落とす（Bake::rebuild_inner）
pub fn materialize_os(decl: &Value, base: &Path, ctx: &Ctx, os: &str) -> Vec<String> {
    let nt = os == "nt";
    let mut unmade: Vec<String> = predicted_unmade(decl, os);
    let skipped = |kind: &str, rel: &str, unmade: &[String]| unmade.iter().any(|u| u == &format!("{kind} {rel}"));
    fn fail(nt: bool, unmade: &mut Vec<String>, kind: &str, rel: &str, e: std::io::Error) {
        if nt {
            unmade.push(format!("{kind} {rel}"));
        } else {
            panic!("場面の {kind} {rel} を作れません: {e}");
        }
    }
    std::fs::create_dir_all(base).unwrap();
    let dirs = decl["dirs"].as_object().unwrap();
    for rel in dirs.keys() {
        if skipped("dir", rel, &unmade) {
            continue;
        }
        if let Err(e) = std::fs::create_dir_all(base.join(rel)) {
            fail(nt, &mut unmade, "dir", rel, e);
        }
    }
    // ファイルID を指す中身（@FID(道)）は、指すファイルを作った後に書く
    let mut fs: Vec<_> = decl["files"].as_object().unwrap().iter().collect();
    fs.sort_by_key(|(_, e)| decl["blobs"][e["blob"].as_str().unwrap_or("")]["text"].as_str().is_some_and(|t| t.contains("@FID(")));
    for (rel, e) in fs {
        if skipped("file", rel, &unmade) || skipped("fifo", rel, &unmade) {
            continue;
        }
        let p = base.join(rel);
        if let Err(e) = std::fs::create_dir_all(p.parent().unwrap()) {
            fail(nt, &mut unmade, "file", rel, e);
            continue;
        }
        if e.get("made").is_some() {
            // 場面の台本が作った物（指紋は呼ぶ側 rebuild_from_table が確かめる）
            continue;
        }
        if e["fifo"] == true {
            let _ = std::process::Command::new("mkfifo").arg(&p).status();
            continue;
        }
        let blob = &decl["blobs"][e["blob"].as_str().unwrap()];
        let bytes = match blob["text"].as_str() {
            Some(t) => fid_unsub(&text_of_decl(t, ctx), base).into_bytes(),
            None => unb64(blob["b64"].as_str().unwrap()),
        };
        if let Err(e) = std::fs::write(&p, bytes) {
            fail(nt, &mut unmade, "file", rel, e);
            continue;
        }
        if let Some(t) = mtime_of_decl(&e["mtime"]) {
            let _ = std::fs::File::options().write(true).open(&p).and_then(|f| f.set_modified(t));
        }
    }
    for (rel, t) in decl["links"].as_object().unwrap() {
        if skipped("link", rel, &unmade) {
            continue;
        }
        let target = ctx.unsub(t.as_str().unwrap());
        #[cfg(unix)]
        {
            let _ = std::os::unix::fs::symlink(&target, base.join(rel));
        }
        #[cfg(windows)]
        {
            // Windows の記号リンク（版 3.117.3）: GitHub の runner は管理者なので作れる（Windows の Python の os.symlink も作る。3.117.1 の測りで、
            // Python と比べる形の fs は 18 件・表だけの形は 17 件だった）。区切りは「\」に（相対のリンクの「/」は Windows がたどらない）。
            // 指す先がフォルダなら symlink_dir（作った後にフォルダ）、ほかは symlink_file（壊れたリンクも）
            let target = target.replace('/', "\\");
            let link = base.join(rel);
            let at = link.parent().map(|d| d.join(&target)).unwrap_or_else(|| PathBuf::from(&target));
            let is_dir = (std::path::Path::new(&target).is_absolute() && std::path::Path::new(&target).is_dir()) || at.is_dir();
            let r =
                if is_dir { std::os::windows::fs::symlink_dir(&target, &link) } else { std::os::windows::fs::symlink_file(&target, &link) };
            if r.is_err() {
                unmade.push(format!("link {rel}"));
            }
        }
        let _ = (rel, target);
    }
    // 権限: Windows の形では当てない（表せない差は predicted_unmade が数えた）
    #[cfg(unix)]
    if !nt {
        use std::os::unix::fs::PermissionsExt;
        for (rel, e) in decl["files"].as_object().unwrap() {
            if let Some(m) = e["mode"].as_u64() {
                let _ = std::fs::set_permissions(base.join(rel), std::fs::Permissions::from_mode(m as u32));
            }
        }
    }
    // 段の深い順に: 更新時刻を当ててから権限（読めないフォルダの中は先に作り終える）。Windows もフォルダの更新時刻を当てる（版 3.117.3:
    // 前は Linux だけで、表だけの形の fs の「参照…」の答えのフォルダの時刻が今の時刻になった）
    let mut ds: Vec<_> = dirs.iter().filter(|(r, _)| !skipped("dir", r, &unmade)).collect();
    ds.sort_by_key(|(r, _)| std::cmp::Reverse(r.matches('/').count()));
    for (rel, e) in ds {
        if let Some(t) = mtime_of_decl(&e["mtime"]) {
            let _ = open_dir_for_times(&base.join(rel)).and_then(|f| f.set_modified(t));
        }
        #[cfg(unix)]
        if let (Some(m), false) = (e["mode"].as_u64(), nt) {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(base.join(rel), std::fs::Permissions::from_mode(m as u32));
        }
    }
    unmade.sort();
    unmade.dedup();
    unmade
}

/// フォルダの更新時刻を当てるために開く（Linux は読む形で開ける。Windows はフォルダを開く印 FILE_FLAG_BACKUP_SEMANTICS と、
/// 時刻を書く権利 FILE_WRITE_ATTRIBUTES で開く）
fn open_dir_for_times(p: &Path) -> std::io::Result<std::fs::File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_WRITE_ATTRIBUTES: u32 = 0x0100;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        return std::fs::OpenOptions::new().access_mode(FILE_WRITE_ATTRIBUTES).custom_flags(FILE_FLAG_BACKUP_SEMANTICS).open(p);
    }
    #[allow(unreachable_code)]
    std::fs::File::open(p)
}

/// SQLite のファイルの中身を、作った SQLite の版によらない形（頭の決め・表の定義・行）にする（宣言を比べるとき）。
/// SQLite のファイルの頭には、最後に書いた SQLite の版の番号（96〜99 バイト目）と、その版が数えた変更の数（24〜27・92〜95）が入る。
/// 答え合わせ役（Python）が作る場面の SQLite は、Python に付く SQLite の版でバイトが変わる（版 3.115.0 の PR #115 の CI の直し: 手元の
/// Python は SQLite 3.53.1、CI の Python は別の版で、builder・mirror・seed_reads の 3 本が「場面のフォルダが表の宣言と違う」で落ちた。
/// /usr/bin/python3〈SQLite 3.45.1〉を TPA_PYTHON にして再現）。表の定義・行・頭の決め（ページの大きさ・書式の版・字の符号）は比べる。
/// SQLite として開けない物（頭だけ SQLite の壊れたファイル）は None で、バイトのまま比べる
pub fn sqlite_logical(bytes: &[u8]) -> Option<Value> {
    use rusqlite::types::Value as Cell;
    if !bytes.starts_with(b"SQLite format 3\0") || bytes.len() < 100 {
        return None;
    }
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    // 一時のファイルはその利用者が必ず書ける一時フォルダに置く（cargo の作業フォルダは root でない利用者が書けないことがある）
    let p = std::env::temp_dir().join(format!("da-decl-{}-{n}.sqlite3", std::process::id()));
    std::fs::write(&p, bytes).ok()?;
    let cell = |c: Cell| match c {
        Cell::Null => Value::Null,
        Cell::Integer(i) => json!(i),
        Cell::Real(f) => json!({"real": format!("{f:?}")}),
        Cell::Text(t) => json!(t),
        Cell::Blob(b) => json!({"blob": b64(&b)}),
    };
    let dump = || -> rusqlite::Result<Value> {
        let c = rusqlite::Connection::open_with_flags(&p, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let rows = |sql: &str| -> rusqlite::Result<Vec<Value>> {
            let mut st = c.prepare(sql)?;
            let n = st.column_count();
            let mut out = vec![];
            let mut q = st.query([])?;
            while let Some(r) = q.next()? {
                out.push(Value::Array((0..n).map(|i| r.get::<_, Cell>(i).map(cell)).collect::<rusqlite::Result<Vec<_>>>()?));
            }
            Ok(out)
        };
        let schema = rows("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid")?;
        let mut tables = Map::new();
        for s in &schema {
            if s[0] == "table" {
                let name = s[1].as_str().unwrap_or("");
                tables.insert(name.to_string(), Value::Array(rows(&format!("SELECT * FROM \"{}\"", name.replace('"', "\"\"")))?));
            }
        }
        let pragma = |n: &str| rows(&format!("PRAGMA {n}")).map(Value::Array);
        Ok(json!({"schema": schema, "rows": tables, "user_version": pragma("user_version")?, "application_id": pragma("application_id")?}))
    };
    let out = dump().ok();
    let _ = std::fs::remove_file(&p);
    // 頭の決め: ページの大きさ（16〜17）・書式の版（18〜19）・予約と詰め方（20〜23）・字の符号（56〜59）。版の番号と変更の数は入れない
    let head: String = bytes[16..24].iter().chain(&bytes[56..60]).map(|b| format!("{b:02x}")).collect();
    out.map(|d| json!({"sqlite": d, "head": head}))
}

/// 宣言を比べられる形に（今からのずれは流すたびに変わるので形だけ残す）
pub fn decl_cmp(v: &Value) -> Value {
    let re = super::re(r"@NOW\(-?\d+ms");
    // 中身は指紋（blobs の鍵）でなく中身そのもので比べる（指紋は今からのずれを含む）
    let mut files = v["files"].clone();
    if let Some(o) = files.as_object_mut() {
        for e in o.values_mut() {
            let b = v["blobs"][e["blob"].as_str().unwrap_or("")].clone();
            // SQLite のファイルは、作った SQLite の版によらない形で比べる（sqlite_logical）
            let logical = b["b64"].as_str().and_then(|t| sqlite_logical(&unb64(t)));
            e["blob"] = logical.unwrap_or(b);
        }
    }
    // 読めない段（権限に読む印の無いフォルダ）の中と、読めないファイルの中身は比べない（root でない利用者は写せない。版 3.115.0 の作った後の直し:
    // 前は root のときだけ宣言を比べ、CI〈root でない runner〉では場面の古さを見なかった）
    let locked: Vec<String> = v["dirs"]
        .as_object()
        .map(|o| o.iter().filter(|(_, e)| e["mode"].as_u64().is_some_and(|m| m & 0o444 == 0)).map(|(r, _)| format!("{r}/")).collect())
        .unwrap_or_default();
    if let Some(o) = files.as_object_mut() {
        o.retain(|r, _| !locked.iter().any(|l| r.starts_with(l.as_str())));
        for e in o.values_mut() {
            if e["mode"].as_u64().is_some_and(|m| m & 0o444 == 0) {
                e["blob"] = json!("<読めない>");
            }
        }
    }
    let mut dirs = v["dirs"].clone();
    if let Some(o) = dirs.as_object_mut() {
        o.retain(|r, _| !locked.iter().any(|l| r.starts_with(l.as_str())));
        // フォルダの更新時刻は中を作るたびに変わり、読めない段の上は root でない利用者で写せない形もあるので比べない
        for e in o.values_mut() {
            if let Some(m) = e.as_object_mut() {
                m.remove("mtime");
            }
        }
    }
    let w = json!({"files": files, "dirs": dirs, "links": v["links"]});
    // Python が場面を作るときに引く乱数（instance_id の uuid4 の 32 字）は比べない
    let hex = super::re(r"\b[0-9a-f]{32}\b");
    map_strings(&w, &|s| hex.replace_all(&re.replace_all(s, "@NOW(~"), "@HEX32").into_owned())
}

// ------------------------------------------------------------------ 焼く係

pub struct Bake {
    /// 表を書くフォルダ（None は TPA_BAKE_OUT か tests/baked）
    pub out: Option<PathBuf>,
    pub book: String,
    /// 表のファイルの名前（本の名前か「本.部分」。1 つの試験のファイルに焼く試験が 2 つ以上あるとき）
    file: String,
    pub mode: Mode,
    scope: Vec<String>,
    /// 焼いた表と比べるか（posix の表。Windows は比べない。試験の変異は明示して true にする）
    pub check: bool,
    /// 表のどの答えを読み書きするか（"root": 本の答え・"user": root でない利用者で違う歩〈variants.user〉）。open_part は流している
    /// 利用者から決め、with（試験の変異）は "root" に決める（版 3.115.0 の CI の直し: 前は書く・読む所が流している利用者を直に見て、
    /// root でない CI の runner では範囲を決めた焼き直しの試験が本の答えを変えず variants.user にだけ書いた）
    pub variant: &'static str,
    table: Option<Value>,
    base: PathBuf,
    pub ctx: Ctx,
    /// 本ごとに足すそろえる鍵
    pub keys: Vec<String>,
    /// 答え合わせ役の答えの中で、歩の答え（焼かない欄。表は窓の答えを answers に持つ）
    pub strip: Vec<String>,
    /// strip を当てる表の印の鍵（歩の表は method を持つ）
    pub strip_in: Vec<&'static str>,
    /// 場面の宣言から除く名前（Python だけの写し）
    pub exclude: Vec<&'static str>,
    /// 答え合わせ役の答えの中の「ファイルID → 名前」の表の鍵（作業実績）。場面と答え合わせ役の答えのファイルID を @FID(道) にする
    pub fid_key: Option<&'static str>,
    /// 答え合わせ役が起こした作り物のサーバーの URL の鍵（組む所の CM3）。焼いた表では @URL にし、Python 無しでは窓の側で 404 を答える作り物を起こす
    pub url_key: Option<&'static str>,
    /// 答え合わせ役の答えの上の段で、焼かない鍵（root で流したか など利用者で変わる印）
    pub drop: Vec<&'static str>,
    /// 表を詰めた形（pack_table）で書くか（版 3.116.0 の大きい本。小さい 21 本は今の形のまま）
    pub pack: bool,
    /// 場面の台本（標準の部品だけの Python。program/tests からの相対の道と引数。版 3.116.0）。Python 無しの形では、表の宣言から場面を
    /// 作る前にこれを流す。台本が作るファイルは、答え合わせ役の答えの "sceneMade"（場面の相対の道の並び）で知る
    pub script: Option<(&'static str, Vec<String>)>,
    /// 起こしたままの相手の台本（app を import しない標準の Python。program/tests からの相対の道と引数。版 3.117.0）。Python 無しの形では、
    /// 答え合わせ役の代わりにこれを起こしたままにする（live）。最初の 1 行の {"urls": {名前: URL}} を名前つきの URL として覚える。
    /// Python と比べる形では、答え合わせ役が同じ台本の関数で同じ作り物を起こし、答えの "urls" で名乗る
    pub fakes: Option<(&'static str, Vec<String>)>,
    /// 測るだけ（版 3.116.0。環境変数 TPA_MEASURE=フォルダ）: 焼いた表と比べない PC（Windows。表は posix の答え）で、窓の答えが表と違う歩を
    /// 試験を落とさずに数え、終わりに <フォルダ>/<表>.json へ書く（.github/workflows/desktop.yml の Windows の仕事が成果物に置き、
    /// tools/bless.py --measured がまとめる）。違う歩が少なければ Windows の上書き（variants.nt）を作って Windows でも表と比べる。
    /// 版 3.117.0: 表の宣言から場面を作る形（Mode::Baked。段 ④ の後の形）でも測る。その形では試験そのものが表の答えと比べて落ちるので、
    /// 記録は finish に届かなくても（途中で落ちても）手放すとき（Drop）に書く。場面を作れなかった表は sceneError に理由を書く
    pub measure: Option<PathBuf>,
    /// 測りの記録を finish で書いたか（書いていなければ Drop が「終わりまで流れなかった」形で書く）
    measure_done: bool,
    /// 表のどの OS の答えと比べるか（bake_os。試験の変異は "nt" にして Windows の形を Linux で流す）
    pub os: &'static str,
    /// Windows の上書きの表（nt_dir の <表>.json。os が nt のときだけ読む）
    pub nt: Option<Value>,
    /// nt の表の answers と skip を当てるか（Windows の本物と、試験の変異の apply_os。Linux の上の Windows の形〈TPA_BAKE_OS=nt〉では当てない）
    pub nt_answers: bool,
    /// 場面を宣言どおりに作れなかった物（materialize_os。Windows の表だけの形）
    unmade: Vec<String>,
    /// 測りの記録に書く、比べた表のファイルの指紋（tools/bless.py --take-nt が、取り込む記録が今の表で取った物かを見る）
    table_sha: String,
    nt_sha: String,
    measured: Vec<Value>,
    measured_decl: Map<String, Value>,
    oracle: Value,
    scene: Value,
    answers: BTreeMap<String, Value>,
    routes: BTreeMap<String, String>,
    bad: Vec<String>,
}

/// 独立の答え（tools/*-truth.py。app を import しない標準の Python の台本）を流す Python。TPA_NO_PYTHON は「program/app を使わない」形で、
/// 標準の Python は独立の答えにだけ要る（段 ④ の後も残す）。起こせなければ分かる言葉で落とす
pub fn stdlib_python() -> String {
    let py = std::env::var("TPA_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
    let ok = std::process::Command::new(&py).arg("-c").arg("import sys; sys.exit(0)").output().is_ok_and(|o| o.status.success());
    assert!(
        ok,
        "独立の答え（program/tools/*-truth.py）に標準の Python（{py}）が要ります。TPA_NO_PYTHON は program/app を使わない形で、標準の Python は残します"
    );
    py
}

/// ファイルのバイトの sha256 の頭 16 字（無ければ空）
fn file_sha(p: &Path) -> String {
    use sha2::Digest;
    std::fs::read(p).map(|b| format!("{:x}", sha2::Sha256::digest(&b))[..16].to_string()).unwrap_or_default()
}

fn env_on(k: &str) -> bool {
    std::env::var(k).is_ok_and(|v| !v.is_empty() && v != "0")
}

impl Bake {
    pub fn open(book: &str, base: &Path) -> Bake {
        Bake::open_part(book, "", base)
    }

    /// 本の部分（表は tests/baked/<本>.<部分>.json）
    pub fn open_part(book: &str, part: &str, base: &Path) -> Bake {
        let file = if part.is_empty() { book.to_string() } else { format!("{book}.{part}") };
        super::clean_env();
        // 焼く・比べるときの時差は UTC に決める（版 3.115.0 の作った後の直し: 答え合わせ役の場面の地方時の日時〈fs の 2026-01-01〉が、焼いた PC と
        // 比べる PC の時差で違う更新時刻になった）。窓も答え合わせ役（子のプロセス）も同じ TZ で流れる
        if std::env::var("TZ").as_deref() != Ok("UTC") {
            // SAFETY: 焼く係を開くのは試験の最初（窓・答え合わせ役を起こす前）。同じ試験の実行ファイルのほかの試験も同じ値にするだけ
            unsafe { std::env::set_var("TZ", "UTC") };
        }
        // 版 3.119.0（段 ⑤）: 答え合わせ役（Python の道）を消したので、いつも表だけの形（TPA_NO_PYTHON の有る無しによらない）。
        // TPA_BLESS=道の型,… なら範囲を宣言して焼き直す（範囲の外が変わったら書かない）。Python と比べる形・Python と同じときだけ焼く形は
        // 試験の変異（Bake::with）だけが使う
        let bless = std::env::var("TPA_BLESS").unwrap_or_default();
        let mode = if matches!(bless.as_str(), "" | "0") { Mode::Baked } else { Mode::BlessScope };
        let scope = if mode == Mode::BlessScope { bless.split(',').map(|s| s.trim().to_string()).collect() } else { vec![] };
        let path = baked_dir().join(format!("{file}.json"));
        let table = std::fs::read(&path)
            .ok()
            .map(|b| unpack_table(&super::json_keep(&b).unwrap_or_else(|| panic!("{} が読めません", path.display()))));
        if (mode == Mode::Baked || mode == Mode::BlessScope) && table.is_none() {
            panic!("焼いた表 {} がありません（TPA_BLESS=1 で焼く）", path.display());
        }
        let mut bk = Bake::with(book, &file, mode, scope, table, base);
        bk.variant = variant();
        bk.measure = std::env::var("TPA_MEASURE").ok().filter(|s| !s.is_empty()).map(PathBuf::from);
        bk.table_sha = file_sha(&path);
        bk.apply_os(bake_os(), &nt_dir().join(format!("{file}.json")), windows_status(book));
        // Linux の上の Windows の形（TPA_BAKE_OS=nt）: 窓の答えは Linux の答えなので、nt の答え（answers）と流さない歩（skip）は当てない。
        // 当てるのは nt の表の読み方・札・作れない場面の物（unmade）だけ（Windows の答えそのものは Windows の CI が守る）
        bk.nt_answers = cfg!(windows);
        bk
    }

    /// 比べる OS の形を決める（本番の読み方の 1 か所。試験の変異も同じ口を通す。版 3.117.3 の作った後の直し・割れ 2）。
    /// Windows の形（os が nt）: nt の表（nt_file。無ければ上書きなし）を読み、表だけの形は札（status）が table の本だけ焼いた表
    /// （nt の上書きを重ねた形）と比べて落とす。Python と比べる形は ④ まで Windows の Python と比べ、表とは比べない（測るだけ）。
    /// 札が measure の本は表だけの形でも測るだけ。posix の形は何も変えない
    pub fn apply_os(&mut self, os: &'static str, nt_file: &Path, status: &str) {
        self.os = os;
        if os != "nt" {
            return;
        }
        self.nt_answers = true;
        self.nt_sha = file_sha(nt_file);
        self.nt = std::fs::read(nt_file).ok().map(|b| super::json_keep(&b).unwrap_or_else(|| panic!("{} が読めません", nt_file.display())));
        self.check = self.mode == Mode::Baked && status == "table";
    }

    /// 流し方と表を決めて作る（試験の変異で使う。open_part は環境変数と tests/baked から決める）
    pub fn with(book: &str, file: &str, mode: Mode, scope: Vec<String>, table: Option<Value>, base: &Path) -> Bake {
        let check = cfg!(unix) && mode != Mode::Bless;
        Bake {
            out: None,
            book: book.into(),
            file: file.into(),
            mode,
            scope,
            check,
            variant: "root",
            table,
            base: base.to_path_buf(),
            ctx: Ctx::new(base),
            keys: vec![],
            strip: vec!["status".into(), "json".into()],
            strip_in: vec!["method"],
            exclude: vec!["py", "pd"],
            fid_key: None,
            url_key: None,
            drop: vec!["rootUser"],
            pack: false,
            script: None,
            fakes: None,
            measure: None,
            measure_done: false,
            // 試験の変異（with）は posix の形で始め、Windows の形は apply_os で選ぶ（版 3.117.3 の 1 回目の Windows の CI の直し: 前は
            // bake_os にして、Windows では焼く決めを見る bake_selftest の 4 本が「Windows では焼きません」に当たった）。open_part は apply_os(bake_os())
            os: "posix",
            nt: None,
            nt_answers: false,
            unmade: vec![],
            table_sha: String::new(),
            nt_sha: String::new(),
            measured: vec![],
            measured_decl: Map::new(),
            oracle: Value::Null,
            scene: Value::Null,
            answers: BTreeMap::new(),
            routes: BTreeMap::new(),
            bad: vec![],
        }
    }

    pub fn python(&self) -> bool {
        matches!(self.mode, Mode::Python | Mode::Bless)
    }

    /// 比べるときにそろえる（Python で流しているときはそのまま。焼いた表と比べるときは両方をそろえる）
    pub fn s(&self, v: &Value) -> Value {
        if self.python() {
            v.clone()
        } else {
            without_offsets(&settle(v, &self.ctx, &self.keys))
        }
    }

    fn strip_answers(&self, v: &Value) -> Value {
        match v {
            Value::Object(o) => Value::Object(
                o.iter()
                    .filter(|(k, _)| !(self.strip_in.iter().any(|m| o.contains_key(*m)) && self.strip.contains(k)))
                    .map(|(k, x)| (k.clone(), self.strip_answers(x)))
                    .collect(),
            ),
            Value::Array(a) => Value::Array(a.iter().map(|x| self.strip_answers(x)).collect()),
            _ => v.clone(),
        }
    }

    /// 焼いた表の問い合わせと場面（版 3.119.0。答え合わせ役を消したので、突き合わせの試験はいつもこれ: 表の宣言から場面のフォルダを作る）
    pub fn table_oracle(&mut self) -> Value {
        assert!(!self.python(), "答え合わせ役（Python の道）は版 3.119.0 で消した。表だけの形で流す");
        self.rebuild_from_table()
    }

    /// 起こしたままの相手（作り物の台本 fakes。app を import しない）を起こし、焼いた表の問い合わせと場面を作る（版 3.119.0）
    pub fn live_table(&mut self) -> (Option<super::Live>, Value) {
        assert!(!self.python(), "答え合わせ役（Python の道）は版 3.119.0 で消した。表だけの形で流す");
        self.live("", &[])
    }

    /// 答え合わせ役の答え（Python）か、焼いた表から作り直した物（場面のフォルダも作る）
    pub fn oracle(&mut self, script: &str, args: &[&str]) -> Value {
        if self.python() {
            let v = super::python_json(script, args);
            self.took(&v);
            v
        } else {
            self.rebuild_from_table()
        }
    }

    /// oracle と同じだが、表の問い合わせ（oracle）には keep で残した形だけを持つ（Python の答えそのもの〈expected・終わった後のファイル〉や
    /// 焼かない事例を除く。版 3.116.0）。返すのは答え合わせ役の答えの全部（Python と比べるのに使う）。焼いた表で流すときは表の形
    pub fn oracle_with(&mut self, script: &str, args: &[&str], keep: impl Fn(&Value) -> Value) -> Value {
        if self.python() {
            let v = super::python_json(script, args);
            self.took(&keep(&v));
            v
        } else {
            self.rebuild_from_table()
        }
    }

    /// 起こしたままにする答え合わせ役（common::Live）。焼いた表で流すときは、起こしたままの相手の台本（fakes。app を import しない）を
    /// 起こしたままにする（fakes が無ければ None）。どちらも作り物の URL を名前つきで覚えてから、場面と問い合わせを写す・作り直す
    pub fn live(&mut self, script: &str, args: &[&str]) -> (Option<super::Live>, Value) {
        if self.python() {
            let (l, v) = super::Live::start(script, args);
            self.name_urls(&v);
            self.took(&v);
            (Some(l), v)
        } else if let Some((fakes, fargs)) = self.fakes.clone() {
            let fargs: Vec<&str> = fargs.iter().map(String::as_str).collect();
            let (l, v) = super::Live::start_stdlib(fakes, &fargs);
            self.name_urls(&v);
            (Some(l), self.rebuild_from_table())
        } else {
            (None, self.rebuild_from_table())
        }
    }

    /// 答えの "urls"（{名前: URL}）を名前つきの URL として覚える
    fn name_urls(&mut self, v: &Value) {
        for (name, url) in v["urls"].as_object().into_iter().flatten() {
            if let Some(u) = url.as_str() {
                self.ctx.url_named(name, u);
            }
        }
    }

    /// Python の答えを受けた直後: 場面を写し、表の宣言・問い合わせと比べる（表が古いか）
    pub fn took(&mut self, v: &Value) {
        let ex: Vec<&str> = self.exclude.clone();
        // 場面の台本が作ったファイル（答え合わせ役が同じ台本を呼んで作り、その相対の道を sceneMade で答える）
        let made: Vec<String> =
            v["sceneMade"].as_array().map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
        self.scene = snapshot_with(&self.base, &self.ctx, &ex, &made);
        let ctx = self.ctx.clone();
        // 今に近い時刻（答え合わせ役の now・錠や切断の指示の時刻）は場面と同じく今からのずれで持つ（作り直す時に今へずらす）
        self.oracle = map_strings(&self.strip_answers(v), &|s| text_decl(s, &ctx));
        // 答え合わせ役の答えの、利用者の名前を書く欄の OS の利用者の名前（Python の書いた人・名乗り）は @USER@（作り直す時に今の利用者へ）
        self.oracle = named_users(&self.oracle, "");
        if let Some(o) = self.oracle.as_object_mut() {
            o.retain(|k, _| !self.drop.contains(&k.as_str()));
        }
        if let Some(url) = self.url_key.and_then(|k| v[k].as_str()).filter(|u| !u.is_empty()) {
            let url = url.to_string();
            self.ctx.url(&url);
            self.oracle = map_strings(&self.oracle, &|s| s.replace(url.as_str(), "@URL"));
        }
        if let Some(k) = self.fid_key {
            // ファイルID（装置の番号と inode）は作り直すと変わるので、場面の中身と答え合わせ役の答えでは @FID(場面の道) にする
            let mut pairs = vec![];
            for (fid, name) in v[k].as_object().cloned().unwrap_or_default() {
                let name = name.as_str().unwrap_or("").to_string();
                let rel = self.scene["files"]
                    .as_object()
                    .unwrap()
                    .keys()
                    .chain(self.scene["dirs"].as_object().unwrap().keys())
                    .find(|r| r.rsplit('/').next() == Some(name.as_str()))
                    .cloned();
                if let Some(rel) = rel {
                    pairs.push((fid, format!("@FID({rel})")));
                }
            }
            let f = |s: &str| {
                pairs
                    .iter()
                    .fold(s.to_string(), |t, (a, b)| if t == *a || t.contains(&format!("\"{a}\"")) { t.replace(a.as_str(), b) } else { t })
            };
            self.scene = map_strings(&self.scene, &f);
            self.oracle = map_strings(&self.oracle, &f);
        }
        if self.mode == Mode::Python && !self.check && self.measure.is_some() {
            // 測るだけ: 場面と問い合わせが表と違うか（落とさない。比べる途中で落ちても試験は続ける）
            if let Some(t) = self.table.clone() {
                let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let now_free = |v: &Value| {
                        let re = super::re(r"@NOW\(-?\d+ms");
                        settle(&map_strings(v, &|s| re.replace_all(s, "@NOW(~").into_owned()), &self.ctx, &self.keys)
                    };
                    (
                        diff_tol(&now_free(&t["oracle"]), &now_free(&self.oracle), "oracle"),
                        super::diff(&decl_cmp(&t["scene"]), &decl_cmp(&self.scene), "scene"),
                    )
                }));
                let (o, s) = r.unwrap_or((Some("（測りが落ちた）".into()), Some("（測りが落ちた）".into())));
                if let Some(d) = o {
                    self.measured_decl.insert("oracle".into(), json!(cut(&d)));
                }
                if let Some(d) = s {
                    self.measured_decl.insert("scene".into(), json!(cut(&d)));
                }
            }
        }
        if self.mode == Mode::Python && self.check {
            let Some(t) = &self.table else {
                self.bad.push(format!("焼いた表 tests/baked/{}.json がありません（TPA_BLESS=1 で焼く）", self.file));
                return;
            };
            let now_free = |v: &Value| {
                let re = super::re(r"@NOW\(-?\d+ms");
                settle(&map_strings(v, &|s| re.replace_all(s, "@NOW(~").into_owned()), &self.ctx, &self.keys)
            };
            let (a, b) = (now_free(&t["oracle"]), now_free(&self.oracle));
            if let Some(d) = diff_tol(&a, &b, "oracle") {
                self.bad.push(format!("表が古い（答え合わせ役の場面・歩が変わった。tools/bless.py で焼き直す）: {d}"));
            }
            // どの利用者でも比べる（読めない段の中は decl_cmp が除く）
            if let Some(d) = super::diff(&decl_cmp(&t["scene"]), &decl_cmp(&self.scene), "scene") {
                self.bad.push(format!("表が古い（場面のフォルダが表の宣言と違う）: {}", cut(&d)));
            }
        }
    }

    /// 表の宣言から場面を作り、問い合わせを返す。測るだけの形（表と比べない PC）では、場面を作れなかった理由を記録に書いてから落とす
    fn rebuild_from_table(&mut self) -> Value {
        if self.measure.is_none() || self.check {
            return self.rebuild_inner();
        }
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.rebuild_inner())) {
            Ok(v) => v,
            Err(e) => {
                let why =
                    e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
                self.measured_decl.insert("sceneError".into(), json!(cut(&why)));
                std::panic::resume_unwind(e)
            }
        }
    }

    fn rebuild_inner(&mut self) -> Value {
        let t = self.table.clone().unwrap();
        if let Some((script, args)) = &self.script {
            // 場面の台本（app を import しない標準の Python。独立の答えと同じく段 ④ の後も残す）
            let py = stdlib_python();
            let out = super::clean_command(&mut std::process::Command::new(&py))
                .arg("-I")
                .arg(super::program().join("tests").join(script))
                .args(args)
                .env("PYTHONIOENCODING", "utf-8")
                .env("PYTHONDONTWRITEBYTECODE", "1")
                .current_dir(super::program())
                .output()
                .unwrap_or_else(|e| panic!("{py} を起こせません: {e}"));
            assert!(out.status.success(), "場面の台本 {script} が失敗しました:\n{}", String::from_utf8_lossy(&out.stderr));
        }
        self.unmade = if self.os == "nt" && !self.nt_answers {
            // Linux の上の Windows の形: 場面は Linux の形で作り（答えを posix の表と比べられる）、作れない物は Windows の決めで数える
            let _ = materialize_os(&t["scene"], &self.base, &self.ctx, "posix");
            predicted_unmade(&t["scene"], "nt")
        } else {
            materialize_os(&t["scene"], &self.base, &self.ctx, self.os)
        };
        if self.os == "nt" && self.check {
            // Windows で作れない場面の物は nt の表の unmade と同じ並び（増えても減っても落とす。版 3.117.3）
            let want: Vec<String> = self.nt_list("unmade");
            if self.unmade != want {
                let (more, less): (Vec<&String>, Vec<&String>) = (
                    self.unmade.iter().filter(|x| !want.contains(x)).collect(),
                    want.iter().filter(|x| !self.unmade.contains(x)).collect(),
                );
                self.bad.push(format!(
                    "Windows で作れない場面の物が nt の表と違う（tests/baked/nt/{}.json の unmade。増えた {more:?}・減った {less:?}）",
                    self.file
                ));
            }
        }
        for (rel, e) in t["scene"]["files"].as_object().unwrap() {
            if let Some(want) = e["made"].as_str() {
                let got = made_print(&self.base.join(rel));
                assert!(
                    got == want,
                    "場面の台本が作ったファイル {rel} が表の指紋と違います（{got} / 表 {want}）。台本か Python の版（乱数の並び）が変わりました。\
                     場面と表を同時に焼き直します: python program/tools/bless.py {}",
                    self.book
                );
            }
        }
        self.scene = t["scene"].clone();
        self.oracle = t["oracle"].clone();
        let ctx = self.ctx.clone();
        let base = self.base.clone();
        let url = if self.url_key.is_some() { serve_404() } else { String::new() };
        self.ctx.url(&url);
        let o = map_strings(&t["oracle"], &|s| fid_unsub(&text_of_decl(s, &ctx), &base).replace("@URL", &url));
        unnamed_users(&o)
    }

    /// 場面が置いた物か（作業フォルダの中の道）
    pub fn in_scene(&self, p: &Path) -> bool {
        let rel = p.strip_prefix(&self.base).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        self.scene["files"].get(&rel).is_some() || self.scene["dirs"].get(&rel).is_some()
    }

    /// nt の表の並び（skip・unmade）
    fn nt_list(&self, k: &str) -> Vec<String> {
        self.nt
            .as_ref()
            .and_then(|n| n[k].as_array())
            .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default()
    }

    /// 表の歩の名前（本の答えと、Windows なら nt の答えの歩）
    fn table_keys(&self) -> Vec<String> {
        let mut keys: Vec<String> =
            self.table.as_ref().and_then(|t| t["answers"].as_object()).map(|o| o.keys().cloned().collect()).unwrap_or_default();
        if self.os == "nt" && self.nt_answers {
            for k in self.nt.as_ref().and_then(|n| n["answers"].as_object()).into_iter().flat_map(|o| o.keys()) {
                if !keys.contains(k) {
                    keys.push(k.clone());
                }
            }
        }
        keys
    }

    /// 表の答え。Windows（os が nt）は nt の表の上書きを先に見る（posix と違う歩の Windows の答え。読む所はここ 1 か所）
    fn table_answer(&self, key: &str) -> Option<Value> {
        let t = self.table.as_ref()?;
        if self.os == "nt" && self.nt_answers {
            if let Some(v) = self.nt.as_ref().and_then(|n| n["answers"].get(key)) {
                return Some(v.clone());
            }
        }
        if self.variant == "user" {
            if let Some(v) = t["variants"]["user"].get(key) {
                return Some(v.clone());
            }
        }
        t["answers"].get(key).cloned()
    }

    /// 比べる相手の答え: Python で流しているときは py()、焼いた表で流すときは表の答え（そろえた形）
    pub fn want(&self, key: &str, py: impl FnOnce() -> Value) -> Value {
        if self.python() {
            py()
        } else {
            self.table_answer(key).unwrap_or_else(|| json!({"<表に無い歩>": key}))
        }
    }

    /// (状態, 本文) の形の want
    pub fn want_step(&self, key: &str, st: &Value) -> (i64, Value) {
        let w = self.want(key, || json!({"status": st["status"], "json": st["json"]}));
        (w["status"].as_i64().unwrap_or(-1), w["json"].clone())
    }

    /// 窓の答えを 1 つ記す（route は道の型。範囲の宣言と要約に使う）。want は want() の答え
    pub fn note(&mut self, key: &str, route: &str, got: &Value, want: &Value) {
        let mut key = key.to_string();
        while self.answers.contains_key(&key) {
            key.push('~');
        }
        let g = settle(got, &self.ctx, &self.keys);
        if self.mode == Mode::Bless {
            let w = settle(want, &self.ctx, &self.keys);
            if let Some(d) = diff_tol(&w, &g, &key) {
                self.bad.push(format!("そろえた後の窓の答えが Python と違う（焼かない）: {}", cut(&d)));
            }
        }
        if !self.check && self.measure.is_some() && self.table.is_some() && matches!(self.mode, Mode::Python | Mode::Baked) {
            // 測るだけ（表と比べない PC）: 表と違う歩を記す（ここでは落とさない。表だけの形〈Baked〉は試験そのものの比べが落とす）
            let d = match self.table_answer(&key) {
                None => Some("<表に無い歩>".to_string()),
                Some(t) => diff_tol(&t, &g, ""),
            };
            if let Some(d) = d {
                // got: そろえた後の窓の答えそのもの（版 3.117.3。tools/bless.py --take-nt が nt の表の答えに取り込む）
                self.measured.push(json!({"key": key, "route": route, "diff": cut(&d), "got": g}));
            }
        }
        if self.os == "nt" && self.nt_answers && self.check && self.nt_list("skip").contains(&key) {
            self.bad.push(format!("Windows では流さない歩（tests/baked/nt/{}.json の skip）を窓が答えた: {key}", self.file));
        }
        if self.check && self.table.is_some() && self.mode != Mode::BlessScope {
            match self.table_answer(&key) {
                None => self.bad.push(format!("表に無い歩（表が古い。tools/bless.py で焼き直す）: {key}")),
                Some(t) => {
                    if let Some(d) = diff_tol(&t, &g, &key) {
                        self.bad.push(format!("焼いた表と違う: {}", cut(&d)));
                    }
                }
            }
        }
        self.routes.insert(key.clone(), route.to_string());
        self.answers.insert(key, g);
    }

    /// 終わった後のファイルの表（Python は読むたびに写しを取り直すので、Python と同じかは試験そのものの決まりで見る。ここでは焼く・表と比べるだけ）
    pub fn note_files(&mut self, key: &str, got: &Value, want: &Value) {
        let mode = self.mode;
        if mode == Mode::Bless {
            self.mode = Mode::Python;
        }
        let check = self.check;
        self.check = check && mode != Mode::Bless;
        self.note(key, "files", got, want);
        self.mode = mode;
        self.check = check;
    }

    /// (状態, 本文) の形の note
    pub fn note_step(&mut self, key: &str, st: &Value, status: impl Into<i64>, got: &Value, want: &(i64, Value)) {
        let route = route_of(st);
        self.note(key, &route, &json!({"status": status.into(), "json": got}), &json!({"status": want.0, "json": want.1}));
    }

    /// 終わり: 焼く・表と比べた食い違いを知らせる。test_bad は試験そのものの食い違い（Python と比べた分）
    pub fn finish(mut self, test_bad: &[String]) {
        self.write_measure(true);
        if self.os == "nt" && matches!(self.mode, Mode::Bless | Mode::BlessScope) {
            panic!(
                "{}: Windows では焼きません（posix の表は Linux で焼き、Windows の答えは tools/bless.py --take-nt で nt の表に取り込む）",
                self.file
            );
        }
        if let Some(t) = &self.table {
            if self.check && self.mode != Mode::BlessScope {
                let skip = if self.os == "nt" && self.nt_answers { self.nt_list("skip") } else { vec![] };
                let mut missing: Vec<String> =
                    self.table_keys().into_iter().filter(|k| !self.answers.contains_key(k) && !skip.contains(k)).collect();
                missing.truncate(5);
                for k in missing {
                    self.bad.push(format!("表にあるのに窓が答えなかった歩（表が古い）: {k}"));
                }
                // nt の skip は表の歩（本の答えか nt の答え）だけ
                let keys = self.table_keys();
                for k in skip.iter().filter(|k| !keys.contains(k)) {
                    self.bad.push(format!("Windows では流さない歩（nt の skip）が表に無い歩: {k}"));
                }
                let _ = t;
            }
        }
        match self.mode {
            Mode::Bless => {
                if !test_bad.is_empty() || !self.bad.is_empty() {
                    panic!(
                        "{}: Python との食い違いがあるので焼きません（試験 {} 件・そろえた後 {} 件）:\n{}",
                        self.file,
                        test_bad.len(),
                        self.bad.len(),
                        self.bad.iter().chain(test_bad).take(20).cloned().collect::<Vec<_>>().join("\n")
                    );
                }
                self.write();
            }
            Mode::BlessScope => {
                // 比べる前の答えは、この利用者が読む答え（root でなければ variants.user を重ねた形）
                let t = self.table.as_ref().unwrap();
                let mut old = t["answers"].as_object().cloned().unwrap_or_default();
                if self.variant == "user" {
                    if let Some(u) = t["variants"]["user"].as_object() {
                        old.extend(u.iter().map(|(k, v)| (k.clone(), v.clone())));
                    }
                }
                let mut out = vec![];
                let routes = self.table.as_ref().unwrap()["routes"].clone();
                let in_scope = |k: &str, r: &str| {
                    self.scope.iter().any(|s| s == "all" || r == s || r.starts_with(&format!("{s} ")) || k.starts_with(s.as_str()))
                };
                for (k, g) in &self.answers {
                    let same = old.get(k).is_some_and(|o| diff_tol(o, g, k).is_none());
                    if !same {
                        let r = &self.routes[k];
                        if !in_scope(k, r) {
                            out.push(format!("範囲の外の答えが変わった: {k}（{r}）"));
                        }
                    }
                }
                // 前の表にあって今回の答えに無い歩も、範囲の外なら止める（版 3.115.0 の作った後の直し: 前は書いた表から黙って落ちた）
                for k in old.keys().filter(|k| !self.answers.contains_key(*k)) {
                    let r = routes[k.as_str()].as_str().unwrap_or("?");
                    if !in_scope(k, r) {
                        out.push(format!("範囲の外の歩が消えた: {k}（{r}）"));
                    }
                }
                if !out.is_empty() {
                    panic!("{}: 範囲（{}）の外が変わったので焼きません:\n{}", self.file, self.scope.join(","), out.join("\n"));
                }
                self.write();
            }
            _ => {
                if !self.bad.is_empty() {
                    self.dump_diff();
                    panic!(
                        "{}: 焼いた表との食い違い {} 件（窓の今の答えは target/tmp/bless-diff/{}.json）:\n{}",
                        self.file,
                        self.bad.len(),
                        self.file,
                        self.bad.iter().take(20).cloned().collect::<Vec<_>>().join("\n")
                    );
                }
            }
        }
    }

    /// 測るだけの記録を書く（TPA_MEASURE のフォルダ。表と比べない PC だけ。書けなくても試験は続ける）。form は流した形
    /// （python: Python と比べる形・table: 表の宣言から場面を作る形）、finished は試験が finish まで流れたか（途中で落ちた試験は
    /// そこまでの歩だけを数えている。Drop が書く）
    fn write_measure(&mut self, finished: bool) {
        if self.measure_done {
            return;
        }
        let (Some(dir), Some(t), false, Mode::Python | Mode::Baked) = (&self.measure, &self.table, self.check, self.mode) else { return };
        let mut missing: Vec<String> = self.table_keys().into_iter().filter(|k| !self.answers.contains_key(k)).collect();
        missing.sort();
        let form = if self.mode == Mode::Baked { "table" } else { "python" };
        let mut v = json!({"file": self.file, "book": self.book, "os": std::env::consts::OS, "form": form, "finished": finished,
                           "steps": self.answers.len(),
                           "tableSteps": t["answers"].as_object().map(|o| o.len()).unwrap_or(0),
                           "differing": self.measured, "missing": missing,
                           // 版 3.117.3: 場面を宣言どおりに作れなかった物・比べた表と nt の表の指紋（tools/bless.py --take-nt）
                           "unmade": self.unmade, "tableSha": self.table_sha, "ntSha": self.nt_sha});
        for (k, d) in &self.measured_decl {
            v[k.as_str()] = d.clone();
        }
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::write(dir.join(format!("{}.json", self.file)), serde_json::to_string_pretty(&v).unwrap_or_default());
        self.measure_done = true;
    }

    fn dump_diff(&self) {
        let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("bless-diff");
        let _ = std::fs::create_dir_all(&d);
        let v = json!({"book": self.file, "bad": self.bad, "answers": self.answers});
        let _ = std::fs::write(d.join(format!("{}.json", self.file)), serde_json::to_string_pretty(&v).unwrap());
    }

    fn write(&self) {
        let out_dir = self.out.clone().or_else(|| std::env::var("TPA_BAKE_OUT").ok().map(PathBuf::from)).unwrap_or_else(baked_dir);
        std::fs::create_dir_all(&out_dir).unwrap();
        let path = out_dir.join(format!("{}.json", self.file));
        let old = self.table.clone().unwrap_or(Value::Null);
        let answers: Map<String, Value> = self.answers.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        let routes: Map<String, Value> = self.routes.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
        let mut t = if self.variant == "user" && old.is_object() {
            // root でない利用者: 本の答え（root で焼いた）は変えず、違う歩だけを variants.user に持つ
            let mut t = old.clone();
            let base = old["answers"].as_object().cloned().unwrap_or_default();
            let user: Map<String, Value> = answers
                .iter()
                .filter(|(k, v)| base.get(*k).is_none_or(|b| diff_tol(b, v, k).is_some()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            t["variants"]["user"] = Value::Object(user);
            t
        } else {
            let mut t = json!({
                "about": format!("窓が焼いた答え（版 3.115.0 の bless。desktop/tests/common/bake.rs）。本 {}。作り直すのは python program/tools/bless.py {}", self.file, self.file),
                "book": self.book,
                "file": self.file,
                "os": "posix",
                "variant": self.variant,
                "oracle": self.oracle,
                "scene": self.scene,
                "answers": answers,
                "routes": routes,
            });
            if let Some(u) = old.get("variants") {
                t["variants"] = u.clone();
            }
            t
        };
        t["sources"] = sources_of(&self.book);
        // 大きい本（版 3.116.0）は詰めた形で書く。前の表が詰めてあれば同じく詰める。要約は開いた形で出す
        let plain = t.clone();
        if self.pack {
            t = pack_table(&t);
        }
        let text = lines(&t, 0) + "\n";
        std::fs::write(&path, text).unwrap();
        // 変わった葉の要約（道の型ごとの数・鍵・前 → 後の見本 3）。PR の説明に貼る
        eprintln!("{}", summary(&self.file, &old, &plain).lines().map(|l| format!("bless| {l}")).collect::<Vec<_>>().join("\n"));
        eprintln!("bless| {} に書きました", path.display());
    }
}

impl Drop for Bake {
    /// finish に届かなかった試験（途中で落ちた）も、測りの記録は残す（そこまでの歩と、場面を作れなかった理由）
    fn drop(&mut self) {
        self.write_measure(false);
    }
}

/// 表の字: 段 2 までは 1 項目 1 行（歩ごと・ファイルごとの差分が読める）、その下は詰めて書く（oracle は場面ごとに 1 行）
pub fn lines(v: &Value, depth: usize) -> String {
    let pad = |d: usize| " ".repeat(d);
    // 詰めた表（parts がある）の oracle は場面ごとの歩が参照になっているので、1 段深く 1 項目 1 行にする
    let packed = v.get("parts").is_some();
    let deep = |k: &str| match k {
        "oracle" if packed => 5,
        "oracle" => 4,
        "scene" => 3,
        _ => 2,
    };
    fn inner(v: &Value, depth: usize, max: usize, pad: &dyn Fn(usize) -> String) -> String {
        match v {
            Value::Object(o) if depth < max && !o.is_empty() => {
                let items: Vec<String> = o
                    .iter()
                    .map(|(k, x)| format!("{}{}: {}", pad(depth + 1), serde_json::to_string(k).unwrap(), inner(x, depth + 1, max, pad)))
                    .collect();
                format!("{{\n{}\n{}}}", items.join(",\n"), pad(depth))
            }
            Value::Array(a) if depth < max && !a.is_empty() => {
                let items: Vec<String> = a.iter().map(|x| format!("{}{}", pad(depth + 1), inner(x, depth + 1, max, pad))).collect();
                format!("[\n{}\n{}]", items.join(",\n"), pad(depth))
            }
            // 大きな整数（held の印の字）は桁のまま書く（読み戻すと common::json_keep が同じ印にする）
            _ if da_core::held::has_held(v) || da_core::held::has_nonfinite(v) || da_core::held::has_lone(v) => {
                da_core::held::to_text(v, None)
            }
            _ => serde_json::to_string(v).unwrap(),
        }
    }
    match v {
        Value::Object(o) => {
            let items: Vec<String> = o
                .iter()
                .map(|(k, x)| format!("{}{}: {}", pad(depth + 1), serde_json::to_string(k).unwrap(), inner(x, depth + 1, deep(k), &pad)))
                .collect();
            format!("{{\n{}\n}}", items.join(",\n"))
        }
        _ => serde_json::to_string(v).unwrap(),
    }
}

/// 表を焼いた時の元（答え合わせ役と、その場面に効く道具）の指紋。tools/bless.py --check が今の元と比べる（古さを止める）
pub fn sources_of(book: &str) -> Value {
    use sha2::Digest;
    let books: Value = serde_json::from_str(include_str!("../baked/books.json")).unwrap();
    let prog = super::program();
    let mut out = Map::new();
    for s in books["books"][book]["sources"].as_array().cloned().unwrap_or_default() {
        let rel = s.as_str().unwrap();
        let b = std::fs::read(prog.join(rel)).unwrap_or_default();
        // 改行の違い（Windows の取り出し）で変わらないように \r を除いて数える
        let b: Vec<u8> = b.into_iter().filter(|&c| c != b'\r').collect();
        out.insert(rel.into(), json!(format!("{:x}", sha2::Sha256::digest(&b))[..16].to_string()));
    }
    Value::Object(out)
}

/// 道の型（"POST /api/x"。数の id は {n}）
pub fn route_of(st: &Value) -> String {
    let m = st["method"].as_str().unwrap_or("");
    let p = st["path"].as_str().unwrap_or("");
    let re = super::re(r"/[0-9０-９]+$");
    format!("{m} {}", re.replace(p, "/{n}"))
}

fn cut(s: &str) -> String {
    if s.chars().count() > 400 {
        s.chars().take(400).collect::<String>() + "…"
    } else {
        s.to_string()
    }
}

/// 葉の道と値
fn leaves(v: &Value, p: &str, out: &mut BTreeMap<String, Value>) {
    match v {
        Value::Object(o) => o.iter().for_each(|(k, x)| leaves(x, &format!("{p}.{k}"), out)),
        Value::Array(a) => a.iter().enumerate().for_each(|(i, x)| leaves(x, &format!("{p}[{i}]"), out)),
        _ => {
            out.insert(p.to_string(), v.clone());
        }
    }
}

/// 変わった葉の要約: 道の型ごとに、変わった葉の数・鍵・前 → 後の見本 3
pub fn summary(book: &str, old: &Value, new: &Value) -> String {
    let (old, new) = (&without_offsets(old), &without_offsets(new));
    let (oa, na) = (old["answers"].as_object().cloned().unwrap_or_default(), new["answers"].as_object().cloned().unwrap_or_default());
    let mut by: BTreeMap<String, (usize, std::collections::BTreeSet<String>, Vec<String>)> = BTreeMap::new();
    for k in oa.keys().chain(na.keys()).collect::<std::collections::BTreeSet<_>>() {
        let route = new["routes"][k.as_str()].as_str().or(old["routes"][k.as_str()].as_str()).unwrap_or("?").to_string();
        let (mut a, mut b) = (BTreeMap::new(), BTreeMap::new());
        if let Some(x) = oa.get(k) {
            leaves(x, "", &mut a);
        }
        if let Some(x) = na.get(k) {
            leaves(x, "", &mut b);
        }
        for p in a.keys().chain(b.keys()).collect::<std::collections::BTreeSet<_>>() {
            if a.get(p) != b.get(p) {
                let e = by.entry(route.clone()).or_default();
                e.0 += 1;
                e.1.insert(p.rsplit(['.', '[']).next().unwrap_or("").trim_end_matches(']').to_string());
                if e.2.len() < 3 {
                    e.2.push(format!(
                        "{k}{p}: {} → {}",
                        a.get(p).map(|v| cut(&v.to_string())).unwrap_or("（無し）".into()),
                        b.get(p).map(|v| cut(&v.to_string())).unwrap_or("（無し）".into())
                    ));
                }
            }
        }
    }
    if old.is_null() {
        return format!("== {book}: 新しく焼いた（歩 {}）", na.len());
    }
    let mut s = format!("== {book}: 変わった葉（道の型ごと） {} 型", by.len());
    for (r, (n, keys, samples)) in by {
        s += &format!("\n  {r}: {n} 葉・鍵 {}", keys.into_iter().collect::<Vec<_>>().join(" "));
        for x in samples {
            s += &format!("\n    {x}");
        }
    }
    s
}
