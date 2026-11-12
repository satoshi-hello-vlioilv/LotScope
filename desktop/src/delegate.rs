//! 窓が Python に任せた・断った回数を、形の名前ごとにこの PC の記録に数える（版 3.102.0。主のセッションの決め 4）。
//!
//! 残っている Python 頼みの形（束の種まき・束の材料・更新の置き場の設定 など）が、現場で実際に何回起きているかを知り、移す順を決めるため。
//! 書くのは**形の名前と日ごとの回数だけ**（PC 名・ログイン ID・道の引数・ファイルの中身は書かない。外へは送らない）。
//! 置き場はこの PC の作業場所の logs/delegations.json（{"days": {"YYYY-MM-DD": {形: 回数}}}。30 日分）。書くのは 60 秒に 1 回まで。

use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 記録に残す日数
pub const KEEP_DAYS: usize = 30;
const FLUSH_EVERY: Duration = Duration::from_secs(60);

struct State {
    dir: Option<PathBuf>,
    /// まだ書いていない数（日 → 形 → 回数）
    pending: BTreeMap<String, BTreeMap<String, u64>>,
    /// このプロセスで数えた数（試験と自己診断）
    total: BTreeMap<String, u64>,
    flushed: Option<Instant>,
}

static STATE: Mutex<State> = Mutex::new(State { dir: None, pending: BTreeMap::new(), total: BTreeMap::new(), flushed: None });

/// 記録の置き場（この PC の作業場所の logs）。入れなければ数えるだけで書かない（試験）
pub fn set_dir(dir: PathBuf) {
    STATE.lock().unwrap_or_else(|e| e.into_inner()).dir = Some(dir);
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// 形 kind を 1 回数える（名前は短い英字。例: bundle_seed）
pub fn note(kind: &str) {
    let mut st = STATE.lock().unwrap_or_else(|e| e.into_inner());
    *st.pending.entry(today()).or_default().entry(kind.to_string()).or_default() += 1;
    *st.total.entry(kind.to_string()).or_default() += 1;
    if st.dir.is_some() && st.flushed.is_none_or(|t| t.elapsed() >= FLUSH_EVERY) {
        flush_locked(&mut st);
    }
}

/// このプロセスで数えた数（形 → 回数）
pub fn counts() -> Value {
    let st = STATE.lock().unwrap_or_else(|e| e.into_inner());
    json!(st.total)
}

/// まだ書いていない数を書く（使い終わりにも呼ぶ）
pub fn flush() {
    let mut st = STATE.lock().unwrap_or_else(|e| e.into_inner());
    flush_locked(&mut st);
}

fn flush_locked(st: &mut State) {
    st.flushed = Some(Instant::now());
    let Some(dir) = st.dir.clone() else { return };
    if st.pending.is_empty() {
        return;
    }
    let path = dir.join("delegations.json");
    let mut days: Map<String, Value> = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.get("days").and_then(Value::as_object).cloned())
        .unwrap_or_default();
    for (day, kinds) in std::mem::take(&mut st.pending) {
        let d = days.entry(day).or_insert_with(|| json!({}));
        if !d.is_object() {
            *d = json!({});
        }
        for (k, n) in kinds {
            let cur = d[&k].as_u64().unwrap_or(0);
            d[&k] = json!(cur + n);
        }
    }
    let mut keys: Vec<String> = days.keys().cloned().collect();
    keys.sort();
    for old in keys.iter().take(keys.len().saturating_sub(KEEP_DAYS)) {
        days.remove(old);
    }
    let _ = std::fs::create_dir_all(&dir);
    let tmp = dir.join("delegations.json.tmp");
    let body = serde_json::to_vec_pretty(&json!({"days": days})).unwrap_or_default();
    if std::fs::write(&tmp, body).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_kinds_and_counts_are_written() {
        let d = std::env::temp_dir().join(format!("tpa-delegate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        set_dir(d.clone());
        note("bundle_seed");
        note("bundle_seed");
        flush();
        let v: Value = serde_json::from_slice(&std::fs::read(d.join("delegations.json")).unwrap()).unwrap();
        let day = &v["days"][today()];
        assert!(day["bundle_seed"].as_u64().unwrap() >= 2, "{v}");
        let text = std::fs::read_to_string(d.join("delegations.json")).unwrap();
        let who = crate::bundle::login_id();
        assert!(who.is_empty() || !text.contains(&who), "ログイン ID は書かない");
        assert!(counts()["bundle_seed"].as_u64().unwrap() >= 2);
        let _ = std::fs::remove_dir_all(&d);
    }
}
