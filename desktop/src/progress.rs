//! ダッシュボードのパネルの問い合わせが、いまどの段にいるか（版 3.97.0。利用者の要望 2026-11-11: 待っている間に
//! 「何をしているか・どのデータか・どの計算か・どのくらい待つか」が分かるように）。
//!
//! 画面はパネルの問い合わせ POST /api/dashboard/query?ask=<印> に印を付け、待っている間だけ GET /api/dashboard/progress?ask=a,b,… で
//! 段を尋ねる（窓は 1 つの問い合わせを 1 つの糸で答え、答えは 1 回しか返せないので、途中の知らせは別の道で返す）。
//! 段は問い合わせの糸が書く（糸ごとの「いまの印」〈thread_local〉に書くので、数える係の関数の引数は変えない）。
//!
//! 段（stage）と n/of（円の量と字の n/m は同じこの数から出す。秒やバイトの割合は使わない）:
//!   plan  … 確かめる・段取り（n/of なし）
//!   copy  … 共有から写した設備 n / 設備 of（最初の写しを待っている間）
//!   read  … 読み終えたファイル n / ファイル of（設備ごと）
//!   count … 集計（n/of なし）
//!   gantt … 稼働のガントを組み終えた設備 n / of
//!   abc   … ABC 分析の品種を並べる（n/of なし）
//!   python … 窓が答えない形を Python に任せた（段は分からない。経過だけ）
//!   group … 合わせた表のまとまり・別のデータを合わせるのデータ（k / m 済み。read などと別に持つ）
//! 前回の時間は、組み（送られた本文。ファイルの印は入らない）ごとに、数えた時（控えに当たらなかった時）だけ覚える。
//! 前回と比べる時間（countMs）と覚える時間は「数えている段」（read・count・gantt・abc）にいた時間だけを足した物。写しを待つ（copy）・
//! 準備（plan）・順番待ち（queue。Python）の間は入れない（作った後の採点: 順番を待っているだけのパネルに「前回より長くかかっています」が出た）。
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// 終わった・取り残された段を捨てるまで（画面は答えを受け取れば尋ねない）
const KEEP: Duration = Duration::from_secs(600);
/// 覚える印の数の上限（古い物から捨てる）
const MAX_ASKS: usize = 512;
/// 覚える前回の時間の数の上限
const MAX_TOOK: usize = 2048;
/// 印の字の長さの上限（画面が付けるのは「パネルの id-通し番号」）
const MAX_ASK_LEN: usize = 80;

#[derive(Clone, Debug)]
struct Entry {
    started: Instant,
    stage: &'static str,
    n: usize,
    of: usize,
    group: Option<(usize, usize)>,
    prev_ms: Option<u64>,
    /// いまの段に入った時刻と、それまでに数えている段にいた時間（ミリ秒）
    stage_at: Instant,
    count_ms: u64,
    done: bool,
    counted: bool,
    key: u64,
}

#[derive(Default)]
pub struct Progress {
    asks: Mutex<HashMap<String, Entry>>,
    took: Mutex<HashMap<u64, u64>>,
}

thread_local! {
    static CUR: RefCell<Option<(Arc<Progress>, String)>> = const { RefCell::new(None) };
}

/// 印として受ける字か（英数字と - _ . だけ・長さの上限）
pub fn valid_ask(a: &str) -> bool {
    !a.is_empty() && a.len() <= MAX_ASK_LEN && a.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}

fn key_of(body: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    body.hash(&mut h);
    h.finish()
}

/// 問い合わせの間の印（落ちても drop で糸の印を外す）
pub struct Guard {
    p: Arc<Progress>,
    ask: String,
}

impl Progress {
    /// 問い合わせを始める: 印の段を作り、この糸の「いまの印」にする。印が無い・読めなければ何も記録しない（None）
    pub fn begin(self: &Arc<Self>, ask: &str, body: &[u8]) -> Option<Guard> {
        if !valid_ask(ask) {
            return None;
        }
        let key = key_of(body);
        let prev_ms = self.took.lock().unwrap().get(&key).copied();
        {
            let mut m = self.asks.lock().unwrap();
            prune(&mut m);
            m.insert(
                ask.to_string(),
                Entry {
                    started: Instant::now(),
                    stage: "plan",
                    n: 0,
                    of: 0,
                    group: None,
                    prev_ms,
                    stage_at: Instant::now(),
                    count_ms: 0,
                    done: false,
                    counted: false,
                    key,
                },
            );
        }
        CUR.with(|c| *c.borrow_mut() = Some((self.clone(), ask.to_string())));
        Some(Guard { p: self.clone(), ask: ask.to_string() })
    }

    /// 尋ねられた印の段（GET /api/dashboard/progress?ask=a,b）。知らない印は返さない
    pub fn answer(&self, query: &str) -> Value {
        let asks: Vec<String> = crate::lotlist::parse_query(query)
            .into_iter()
            .filter(|(k, _)| k == "ask")
            .flat_map(|(_, v)| v.split(',').map(str::to_string).collect::<Vec<_>>())
            .filter(|a| valid_ask(a))
            .take(64)
            .collect();
        let m = self.asks.lock().unwrap();
        let mut out = Map::new();
        for a in asks {
            if let Some(e) = m.get(&a) {
                out.insert(a, entry_json(e));
            }
        }
        json!({"asks": out})
    }

    #[cfg(test)]
    fn took_of(&self, body: &[u8]) -> Option<u64> {
        self.took.lock().unwrap().get(&key_of(body)).copied()
    }
}

fn entry_json(e: &Entry) -> Value {
    let mut v = json!({
        "stage": e.stage,
        "elapsedMs": e.started.elapsed().as_millis() as u64,
        "countMs": count_ms(e),
        "prevMs": e.prev_ms,
        "done": e.done,
    });
    if e.of > 0 {
        v["n"] = json!(e.n.min(e.of));
        v["of"] = json!(e.of);
    }
    if let Some((k, m)) = e.group {
        v["group"] = json!([k.min(m), m]);
    }
    v
}

/// 数えている段（前回と比べる時間に入れる段）
pub fn counting(stage: &str) -> bool {
    matches!(stage, "read" | "count" | "gantt" | "abc")
}

/// 数えている段にいた時間（ミリ秒。いまその段にいれば、入ってからの時間も足す）
fn count_ms(e: &Entry) -> u64 {
    e.count_ms + if !e.done && counting(e.stage) { e.stage_at.elapsed().as_millis() as u64 } else { 0 }
}

fn prune(m: &mut HashMap<String, Entry>) {
    m.retain(|_, e| e.started.elapsed() < KEEP);
    while m.len() >= MAX_ASKS {
        let Some(old) = m.iter().min_by_key(|(_, e)| e.started).map(|(k, _)| k.clone()) else { break };
        m.remove(&old);
    }
}

impl Guard {
    /// 窓は答えなかった（Python に任せる）: 段は分からないので python（経過だけ）
    pub fn python(self) {
        self.edit(|e| {
            e.count_ms = count_ms(e);
            e.stage_at = Instant::now();
            e.stage = "python";
            e.n = 0;
            e.of = 0;
            e.group = None;
        });
    }

    fn edit(&self, f: impl FnOnce(&mut Entry)) {
        if let Some(e) = self.p.asks.lock().unwrap().get_mut(&self.ask) {
            f(e);
        }
    }
}

impl Drop for Guard {
    /// 答え終えた: 段を「済み」に。数えた（控えに当たらなかった）時だけ、かかった時間を前回として覚える
    fn drop(&mut self) {
        CUR.with(|c| *c.borrow_mut() = None);
        let mut m = self.p.asks.lock().unwrap();
        let Some(e) = m.get_mut(&self.ask) else { return };
        if e.stage == "python" {
            return; // Python が答えるまで、経過を数え続ける（画面は答えを受け取れば尋ねない）
        }
        let ms = count_ms(e);
        e.count_ms = ms;
        e.stage_at = Instant::now();
        e.done = true;
        if e.counted {
            let key = e.key;
            drop(m);
            let mut t = self.p.took.lock().unwrap();
            if t.len() >= MAX_TOOK && !t.contains_key(&key) {
                t.clear(); // 上限を超えたら捨てて覚え直す（前回が無い初回と同じ見せ方になるだけ）
            }
            t.insert(key, ms);
        }
    }
}

fn with_cur(f: impl FnOnce(&mut Entry)) {
    CUR.with(|c| {
        if let Some((p, ask)) = c.borrow().as_ref() {
            if let Some(e) = p.asks.lock().unwrap().get_mut(ask) {
                f(e);
            }
        }
    });
}

/// いまの印の段を替える（印の無い問い合わせ・印の無い糸では何もしない）
pub fn step(stage: &'static str, n: usize, of: usize) {
    with_cur(|e| {
        if e.stage != stage {
            e.count_ms = count_ms(e);
            e.stage_at = Instant::now();
        }
        e.stage = stage;
        e.n = n;
        e.of = of;
    });
}

/// 合わせた表のまとまり・別のデータを合わせるのデータの k / m 済み
pub fn group(k: usize, m: usize) {
    with_cur(|e| e.group = Some((k, m)));
}

/// 控えに当たらず数えた（前回の時間として覚える）
pub fn counted() {
    with_cur(|e| e.counted = true);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(p: &Progress, ask: &str) -> Value {
        p.answer(&format!("ask={ask}"))["asks"][ask].clone()
    }

    #[test]
    fn steps_are_recorded_for_the_ask_of_this_thread_only() {
        let p = Arc::new(Progress::default());
        {
            let _g = p.begin("w1-1", b"{\"panel\":1}").unwrap();
            step("read", 3, 11);
            let v = get(&p, "w1-1");
            assert_eq!(
                (v["stage"].as_str(), v["n"].as_u64(), v["of"].as_u64(), v["done"].as_bool()),
                (Some("read"), Some(3), Some(11), Some(false))
            );
            assert!(v["prevMs"].is_null(), "初回は前回が無い");
            // ほかの糸の段は、この印に入らない
            std::thread::spawn(|| step("count", 0, 0)).join().unwrap();
            assert_eq!(get(&p, "w1-1")["stage"], "read");
            group(1, 2);
            assert_eq!(get(&p, "w1-1")["group"], json!([1, 2]));
            step("count", 0, 0);
            assert!(get(&p, "w1-1").get("n").is_none(), "n/of の無い段は n を返さない");
        }
        let v = get(&p, "w1-1");
        assert_eq!(v["done"], true);
        // 控えに当たった（数えていない）時は、前回として覚えない
        assert_eq!(p.took_of(b"{\"panel\":1}"), None);
        // 印の無い糸では何もしない
        step("read", 1, 2);
        assert_eq!(get(&p, "w1-1")["stage"], "count");
    }

    #[test]
    fn previous_time_is_kept_per_body_only_when_counted() {
        let p = Arc::new(Progress::default());
        {
            let _g = p.begin("a-1", b"X").unwrap();
            step("count", 0, 0);
            counted();
            std::thread::sleep(Duration::from_millis(30));
        }
        let t = p.took_of(b"X").unwrap();
        assert!(t >= 30, "数えた時間を覚える: {t}");
        {
            let _g = p.begin("a-2", b"X").unwrap();
            assert_eq!(get(&p, "a-2")["prevMs"].as_u64(), Some(t), "同じ組みの次の問い合わせは前回を持つ");
        }
        {
            let _g = p.begin("b-1", b"Y").unwrap();
            assert!(get(&p, "b-1")["prevMs"].is_null(), "違う組みは前回を持たない");
        }
    }

    #[test]
    fn waiting_before_counting_is_not_compared_or_remembered() {
        // 作った後の採点（版 3.97.0）: 写しを待つ・準備の間は「前回と比べる時間」に入れない。覚える前回も数えている段の時間だけ
        let p = Arc::new(Progress::default());
        {
            let _g = p.begin("c-1", b"W").unwrap();
            step("copy", 0, 3);
            std::thread::sleep(Duration::from_millis(120));
            let v = get(&p, "c-1");
            assert!(v["countMs"].as_u64().unwrap() < 20, "写しを待つ間は数えていない: {v}");
            assert!(v["elapsedMs"].as_u64().unwrap() >= 120);
            step("read", 0, 3);
            counted();
            std::thread::sleep(Duration::from_millis(40));
            assert!(get(&p, "c-1")["countMs"].as_u64().unwrap() >= 40);
        }
        let took = p.took_of(b"W").unwrap();
        assert!((40..120).contains(&took), "前回は数えた時間だけ（写しを待った 120ms は入れない）: {took}");
        assert!(counting("abc") && counting("gantt") && !counting("queue") && !counting("copy") && !counting("python"));
    }

    #[test]
    fn python_keeps_counting_and_unknown_asks_are_not_answered() {
        let p = Arc::new(Progress::default());
        let g = p.begin("py-1", b"Z").unwrap();
        step("read", 2, 5);
        g.python();
        let v = get(&p, "py-1");
        assert_eq!(v["stage"], "python");
        assert!(v.get("n").is_none(), "Python に任せた形は n/m を推して作らない");
        assert_eq!(v["done"], false);
        assert_eq!(p.answer("ask=nope,py-1")["asks"].as_object().unwrap().len(), 1);
        assert!(p.begin("bad ask", b"Z").is_none());
        assert!(p.begin(&"x".repeat(81), b"Z").is_none());
        assert_eq!(p.answer("ask=%3Cscript%3E")["asks"], json!({}));
    }

    #[test]
    fn many_asks_are_bounded() {
        let p = Arc::new(Progress::default());
        for i in 0..(MAX_ASKS + 20) {
            let _g = p.begin(&format!("k-{i}"), b"B");
        }
        assert!(p.asks.lock().unwrap().len() <= MAX_ASKS);
    }
}
