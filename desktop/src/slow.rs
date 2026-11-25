//! 試験と撮る道具だけの「遅くする口」（版 3.118.3。段 ④ の 4 つ目。採点 `program/tools/ui-proposals/2026-11-stage4d.json` の案 A）。
//!
//! 待っている所（ダッシュボードの待ちの印・写している間の札）を本物の段の道（GET /api/dashboard/progress）で撮る・確かめるため、
//! Python の開発用サーバー（前の Python の開発用サーバー の slow_down）と**同じ 4 つの差し込み口・同じ鍵**を置く:
//!
//! - `"open": 秒` … 集計の 1 ファイルを開く前（pivot.rs の open_part）に待つ
//! - `"ops": 秒` … 稼働・ABC 分析の 1 設備を読む前（operation.rs の read_ops）に待つ
//! - `"only": [設備名…]` … open・ops をその設備（Part の名前と完全一致）だけに効かせる。**窓では nocache と copy も only に絞る**
//!   （copy は元のファイル名から頭の「実績_」と拡張子を外した名前と完全一致。実績_L-10 は only ["L-1"] に当たらない）。
//!   Python（前の Python の開発用サーバー の slow_down）は nocache・copy で only を見ない。窓だけ絞る理由: lib の試験は 1 つのプロセスで並んで流れるので、
//!   ほかの試験の数え方・写しを遅くしない。Python に合わせて直さないのは、前の Python の開発用サーバー が焼いた本の元で、⑤ で消すため。
//!   **⑤ まで両方の相手で比べる道具は only と nocache・copy を一緒に使わない**（ui-eval-dashwait.mjs は only を使わない＝Python と同じ答え）
//! - `"nocache": true` … ダッシュボードのパネル・稼働の答えの控え（dashboard.rs）を使わない（ファイルが替わった後の数え直しと同じ形）
//! - `"copy": バイト/秒` … 共有から手元へ写す（mirror.rs の copy_shared）のを 16 KB ずつ書いて眠る。名前が「実績_」で始まる元だけ（Python と同じ）
//!
//! **lib は環境変数もファイルも読まない**（first_fixes 2）。設定は開発用サーバー（examples/ui_serve.rs）が `set_source` で渡す関数だけで、
//! 既定は無し（何もしない）。cargo test は製品の bin も feature testing つきで組み直し、窓の通し（verify.py）はその exe を使うので、
//! lib が TPA_UI_SLOW_FILE を読むと窓の通しで口が効いてしまう。mod ごと `cfg(any(test, feature = "testing"))`（lib.rs）で、
//! 配る exe（`cargo build --release --locked`）には入らない。

use serde_json::Value;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::Duration;

/// 口を開いたときに出す印（配る exe に口が無いことを、実行ファイルの字で確かめる: strings で 0 件）
pub const MARK: &str = "tpa-slow-hook";
/// 遅くする写しの 1 回に書く量（Python の slow_down と同じ 16 KB）
pub const COPY_STEP: usize = 16 * 1024;

type Source = Arc<dyn Fn() -> Value + Send + Sync>;
/// 設定がある間に open・ops の口を通った回数（設備の名前ごと。only に無い設備も数える）。試験が壁時計でなく数で見る
/// （版 3.118.3 の作った後の採点の割れ 7: 控えに当たれば口を通らない）。試験はほかの試験と同じにならない設備の名前で読む
static CALLS: Mutex<Vec<(String, usize)>> = Mutex::new(Vec::new());
static SOURCE: RwLock<Option<Source>> = RwLock::new(None);
/// 口を使う試験どうしを 1 本にする（設定の場所は 1 つ。guard を持つ間だけ設定がある）
static TURN: Mutex<()> = Mutex::new(());

/// 設定を読む関数を渡す（開発用サーバーが 1 回。関数は呼ぶたびに今の設定〈JSON の表〉を返す。読めなければ表でない値＝待たない）
pub fn set_source(f: Box<dyn Fn() -> Value + Send + Sync>) {
    eprintln!("{MARK}: 遅くする口を開きました（撮る・採点する道具だけ。配る窓には入りません）");
    *SOURCE.write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::from(f));
}

/// 設定を外す
pub fn clear_source() {
    *SOURCE.write().unwrap_or_else(|e| e.into_inner()) = None;
}

/// 試験だけ: 口を使う間の守り（ほかの口の試験と取り合わない。落としたら設定を外す）
pub struct Guard {
    _turn: MutexGuard<'static, ()>,
}

impl Drop for Guard {
    fn drop(&mut self) {
        clear_source();
    }
}

/// 試験だけ: 決めた設定で口を開く（None なら設定なしのまま順番だけ取る）
pub fn guard(conf: Option<Value>) -> Guard {
    let turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    match conf {
        Some(c) => *SOURCE.write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(move || c.clone())),
        None => clear_source(),
    }
    Guard { _turn: turn }
}

fn conf() -> Option<Value> {
    let f = SOURCE.read().unwrap_or_else(|e| e.into_inner()).clone()?;
    Some(f()).filter(Value::is_object)
}

fn secs(v: Option<&Value>) -> f64 {
    let n = match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0.0),
        Some(Value::Bool(true)) => 1.0,
        _ => 0.0,
    };
    if n.is_finite() && n > 0.0 {
        n
    } else {
        0.0
    }
}

/// only が無ければどれにも効く。あれば、その名前のどれかに当たるときだけ
fn allowed(c: &Value, names: &[&str]) -> bool {
    match c.get("only").and_then(Value::as_array) {
        None => true,
        Some(only) => only.iter().filter_map(Value::as_str).any(|o| names.contains(&o)),
    }
}

/// 差し込み口 kind（"open"・"ops"）で、設備 part_name の前に待つ秒（待たないなら 0）
pub fn wait_secs(kind: &str, part_name: &str) -> f64 {
    let Some(c) = conf() else { return 0.0 };
    let s = secs(c.get(kind));
    if s > 0.0 && allowed(&c, &[part_name]) {
        s
    } else {
        0.0
    }
}

/// 差し込み口 kind で、設備 part_name の前に待つ
pub fn wait(kind: &str, part_name: &str) {
    if SOURCE.read().unwrap_or_else(|e| e.into_inner()).is_some() {
        let mut c = CALLS.lock().unwrap_or_else(|e| e.into_inner());
        match c.iter_mut().find(|(n, _)| n == part_name) {
            Some(x) => x.1 += 1,
            None => c.push((part_name.to_string(), 1)),
        }
    }
    let s = wait_secs(kind, part_name);
    if s > 0.0 {
        std::thread::sleep(Duration::from_secs_f64(s.min(600.0)));
    }
}

/// 設定がある間に、設備 part_name で open・ops の口を通った回数
pub fn calls(part_name: &str) -> usize {
    CALLS.lock().unwrap_or_else(|e| e.into_inner()).iter().find(|(n, _)| n == part_name).map(|x| x.1).unwrap_or(0)
}

/// 写しの元の名前 → only と比べる名前（頭の「実績_」と拡張子を外す。実績_L-1.sqlite3 → L-1）
fn copy_name(file: &str) -> Option<&str> {
    let rest = file.strip_prefix("実績_")?;
    Some(rest.rsplit_once('.').map(|(a, _)| a).unwrap_or(rest))
}

/// パネルの答えの控えを使わないか（parts はパネルの設備〈Part の名前〉）
pub fn no_cache(parts: &[&str]) -> bool {
    conf().is_some_and(|c| crate::lotlist::json_truthy(c.get("nocache").unwrap_or(&Value::Null)) && allowed(&c, parts))
}

/// 共有の元 remote を写す速さ（バイト/秒）。遅くしないなら None。名前が「実績_」で始まる元だけ（Python と同じ）、only があれば
/// 「実績_」と拡張子を外した名前が only のどれかと同じ元だけ
pub fn copy_rate(remote: &str) -> Option<f64> {
    let c = conf()?;
    let bps = secs(c.get("copy"));
    let file = std::path::Path::new(remote).file_name()?.to_string_lossy().into_owned();
    let name = copy_name(&file)?; // 「実績_」で始まる元だけ（Python と同じ）
    if bps <= 0.0 {
        return None;
    }
    let ok = match c.get("only").and_then(Value::as_array) {
        None => true,
        Some(only) => only.iter().filter_map(Value::as_str).any(|o| o == name),
    };
    ok.then_some(bps)
}

/// 遅くして写す（COPY_STEP ずつ書いて、書いた量 ÷ 速さ だけ眠る。済んだバイト＝一時ファイルの大きさが刻みごとに増える）
pub fn copy_slowly(src: &mut impl std::io::Read, dst: &mut std::fs::File, bps: f64) -> std::io::Result<()> {
    use std::io::Write;
    let mut buf = vec![0u8; COPY_STEP];
    loop {
        let n = src.read(&mut buf)?;
        if n == 0 {
            return Ok(());
        }
        dst.write_all(&buf[..n])?;
        dst.flush()?;
        std::thread::sleep(Duration::from_secs_f64((n as f64 / bps).min(60.0)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn without_a_source_nothing_waits_and_the_lib_never_reads_the_environment() {
        // first_fixes 2（版 3.118.3 の作った後の採点の割れ 6 で、環境変数を置いて確かめる形をやめた: 並んで流れる lib の試験の中の set_var は
        // ほかの糸の getenv と同時に走ると未定義）。set_source が無ければ待たない。lib のこの部品の字（試験の外）は環境変数もファイルも読まない
        let _g = guard(None);
        let t = std::time::Instant::now();
        wait("open", "SLOWENV");
        wait("ops", "SLOWENV");
        assert_eq!((wait_secs("open", "SLOWENV"), calls("SLOWENV")), (0.0, 0), "設定が無ければ数えも待ちもしない");
        assert!(t.elapsed() < Duration::from_millis(500));
        assert!(!no_cache(&["CR1"]));
        assert_eq!(copy_rate("/x/実績_CR1.sqlite3"), None);
        let src = include_str!("slow.rs");
        let body = &src[..src.find("#[cfg(test)]").unwrap()];
        for word in ["std::env", "env::var", "var_os", "TPA_UI_SLOW_FILE\"", "fs::read", "File::open"] {
            assert!(!body.contains(word), "slow.rs（試験の外）に {word}");
        }
    }

    #[test]
    fn only_limits_every_mouth_and_unknown_values_do_not_wait() {
        let _g = guard(Some(json!({"open": 0.25, "ops": "0.5", "only": ["SLOWQ"], "nocache": true, "copy": 1000})));
        assert_eq!(wait_secs("open", "SLOWQ"), 0.25);
        assert_eq!(wait_secs("ops", "SLOWQ"), 0.5);
        assert_eq!(wait_secs("open", "CR1"), 0.0, "only に無い設備は待たない");
        assert_eq!(wait_secs("gantt", "SLOWQ"), 0.0, "知らない口");
        assert!(no_cache(&["CR1", "SLOWQ"]) && !no_cache(&["CR1"]), "nocache も only に絞る（ほかの試験の控えを外さない）");
        assert_eq!(copy_rate("/x/実績_SLOWQ.sqlite3"), Some(1000.0));
        assert_eq!(copy_rate("/x/実績_CR1.sqlite3"), None);
        assert_eq!(copy_rate("/x/SLOWQ.sqlite3"), None, "実績_ で始まる元だけ（Python と同じ）");
        assert_eq!(copy_rate("/x/実績_SLOWQX.sqlite3"), None, "名前は完全一致（部分一致にしない）");
        drop(_g);
        let _g = guard(Some(json!({"copy": 1000, "only": ["L-1"]})));
        assert_eq!(copy_rate("/x/実績_L-1.sqlite3"), Some(1000.0));
        assert_eq!(copy_rate("/x/実績_L-10.sqlite3"), None, "実績_L-10 は only [\"L-1\"] に当たらない");
        assert_eq!(copy_rate("/x/実績_X.L-1.sqlite3"), None);
        assert_eq!(copy_name("実績_A.b.sqlite3"), Some("A.b"));
        assert_eq!(copy_name("実績_A"), Some("A"));
        drop(_g);
        let _g = guard(Some(json!({"open": -1, "ops": "abc", "nocache": 0})));
        assert_eq!((wait_secs("open", "A"), wait_secs("ops", "A")), (0.0, 0.0));
        assert!(!no_cache(&["A"]));
        drop(_g);
        let _g = guard(Some(json!([1, 2])));
        assert_eq!(wait_secs("open", "A"), 0.0, "表でない設定は待たない");
    }

    #[test]
    fn copying_slowly_moves_the_copied_bytes_in_many_steps() {
        // first_fixes 4: 速さがあるとき copy_progress の done（写しかけの一時ファイルの大きさ）が 4 刻み以上で単調に増える
        let dir = std::env::temp_dir().join(format!("da-slow-copy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("共有")).unwrap();
        let remote = dir.join("共有").join("実績_SLOWC.sqlite3");
        let c = rusqlite::Connection::open(&remote).unwrap();
        c.execute_batch("CREATE TABLE t (b BLOB);").unwrap();
        c.execute("INSERT INTO t VALUES (?1)", [vec![7u8; 200 * 1024]]).unwrap();
        drop(c);
        let size = std::fs::metadata(&remote).unwrap().len();
        let _g = guard(Some(json!({"copy": 400.0 * 1024.0, "only": ["SLOWC"]})));
        let m = crate::mirror::DbMirror::new("slowc", &remote.display().to_string(), &dir.join("cache"), 60, 36.0);
        let seen = std::thread::scope(|s| {
            let h = s.spawn(|| m.refresh());
            let mut seen = vec![];
            while !h.is_finished() {
                if let Some(p) = m.copy_progress() {
                    if seen.last() != Some(&p.done) {
                        seen.push(p.done);
                    }
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            assert_eq!(h.join().unwrap()["updated"], true);
            seen
        });
        assert!(seen.len() >= 4, "4 刻み以上: {seen:?}");
        assert!(seen.windows(2).all(|w| w[0] <= w[1]), "単調に増える: {seen:?}");
        assert!(seen.iter().all(|&d| d <= size));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
