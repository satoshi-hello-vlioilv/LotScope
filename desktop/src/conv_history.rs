//! 変換表の履歴（版 3.125.0。利用者の改良依頼 2026-11-17 の 5「間違って同梱版に戻されないか心配・全体と一部の表のバックアップ・
//! いつのデータに戻してどうなるのか」。決め方: program/tools/ui-proposals/2026-11-convbackup.json の案 F）。
//!
//! ```text
//! 置き場  … 変換表（conversions）と同じ置き場の conversions.history/（共有するなら共有のフォルダ、しないなら data/）
//! 時点    … ファイル 1 つ（<年月日-時分秒>-<ミリ秒と通し番号 6 桁>-<印 6 字>-<a|m>.json。a＝自動・m＝手で取った物）。中身は
//!            {kind: "tpa-conversions-point", version: 1, id, at, by: {pc, login}, why, auto, scope: "all" か [表の名前],
//!             conversions: [置き場の行のそのまま], defaults: [標準の行のそのまま（空＝同梱のプリセット）]}
//! 自動    … 変換表・標準を書く道（足す・直す・標準に戻す・消す・取り込む・標準を決める・戻す）が、錠の中で取り直した後・当てる前に
//!            書く直前の全部の表と標準を残す（master_store::with_before_write）。残せなければ書かない。
//!            書く前と書いた後の行の中身（行の版・書いた時刻・書いた人を除く。changes_content）が同じなら残さない
//!            （版 3.127.0。変えずに「この表を保存」を押しても「今と同じ」時点が増えない）。
//!            いちばん新しい自動の時点と中身が同じときも新しく残さない
//! 世代    … 自動は新しい 50 個まで（残した後に古い物から消す）。手で取った物は数えず消さない
//! 読む    … 名前の形・JSON・kind・行の形が違うファイルは読み飛ばし、数だけ返す（unreadable）
//! 2 台    … 時点は 1 つずつ別のファイル（名前に印）なので、2 台が同時に残しても置き換え合わない。追記のファイル（jsonl）は、共有の
//!            フォルダ（SMB）で 2 台が同時に足すと行が混ざる・途中で切れる恐れがあるので使わない（案 F の持ち方から替えた理由）。
//!            古い物を消すのが重なっても、消せない（もう無い）物は飛ばす
//! ```
//!
//! 差（戻すと何が変わるか）は画面の形（bundle::conv_views）の表どうしを比べる（diff_tables）。行は並びの位置で比べる。
//! 評価関数: cargo test --test conv_backup_cases（← program/tests/fixtures/conv_backup_cases.json。人が仕様から書いた事例の表）・
//! lib の conversions_write::tests の履歴の試験・本物の画面の program/tools/ui-eval-convbackup.mjs。

use crate::access::Place;
use crate::master_store::{hex_id, now_local, write_json_atomic};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const DIR: &str = "conversions.history";
pub const KIND: &str = "tpa-conversions-point";
/// 自動の時点を残す数
pub const AUTO_KEEP: usize = 50;
/// 同梱のプリセットの時点の印（ファイルは無い。app/master_defaults/conversions.json から組む）
pub const BUNDLED_ID: &str = "bundled";
/// 標準（自分で決めた表。各表の「標準に戻す」の戻る先）の時点の印（ファイルは無い。conversion_defaults から組む）
pub const STANDARD_ID: &str = "standard";

/// ファイルの無い時点（同梱のプリセット・標準）か。戻すのは時点にある表だけで、ほかの表は消さず、標準も変えない
pub fn is_virtual(id: &str) -> bool {
    id == BUNDLED_ID || id == STANDARD_ID
}

/// 時点の置き場（変換表と同じ所）
pub fn dir(place: &Place) -> PathBuf {
    match &place.share_dir {
        Some(d) if place.shared.iter().any(|n| n == crate::conversions_write::NAME) => d.join(DIR),
        _ => place.data.join(DIR),
    }
}

/// 時点の印として読める字か（英小文字・数字・「-」で 60 字まで。道からフォルダの外を指させない）
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 60 && id.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase() || b == b'-')
}

fn is_auto(id: &str) -> bool {
    id.ends_with("-a")
}

/// 時点の印の並び（新しい順。名前の頭が時刻なので名前の逆順）
pub fn ids(d: &Path) -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_dir(d)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            let id = n.strip_suffix(".json")?.to_string();
            (valid_id(&id) && !is_virtual(&id)).then_some(id)
        })
        .collect();
    out.sort_by(|a, b| b.cmp(a));
    out
}

/// 時点を読む（読めない・形が違えば None）
pub fn read_point(d: &Path, id: &str) -> Option<Value> {
    if !valid_id(id) {
        return None;
    }
    let b = std::fs::read(d.join(format!("{id}.json"))).ok()?;
    let v: Value = serde_json::from_slice(b.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&b)).ok()?;
    let ok = v["kind"] == KIND
        && v["id"] == id
        && v["conversions"].as_array().is_some_and(|a| a.iter().all(Value::is_object))
        && v["defaults"].as_array().is_some_and(|a| a.iter().all(Value::is_object));
    ok.then_some(v)
}

/// 書くたびに変わる印（行の版・書いた時刻・書いた人）。中身の比べには入れない
const STAMP_KEYS: [&str; 3] = ["rev", "updated_at", "updated_by"];

/// 書く前の行 `before` と書いた後の行 `after` で、中身が変わるか（版 3.127.0）。行の数・順・各行の項目を比べ、
/// 書くたびに変わる印（STAMP_KEYS）は除く。変わらなければ自動の時点を残さない（事例の表 conv_backup_cases.json の keep）
pub fn changes_content(before: &[Value], after: &[Value]) -> bool {
    let strip = |v: &Value| match v {
        Value::Object(m) => {
            Value::Object(m.iter().filter(|(k, _)| !STAMP_KEYS.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect())
        }
        x => x.clone(),
    };
    before.len() != after.len() || before.iter().zip(after).any(|(a, b)| strip(a) != strip(b))
}

/// 時点を残す。自動で、いちばん新しい自動の時点と表・標準が同じなら残さずその印を返す。自動は残した後に古い物を消す
pub fn write_point(
    d: &Path,
    by: &Value,
    why: &str,
    auto: bool,
    scope: Value,
    conversions: &[Value],
    defaults: &[Value],
) -> std::io::Result<String> {
    std::fs::create_dir_all(d)?;
    if auto {
        if let Some(last) = ids(d).into_iter().filter(|i| is_auto(i)).find_map(|i| read_point(d, &i)) {
            if last["conversions"].as_array().map(Vec::as_slice) == Some(conversions)
                && last["defaults"].as_array().map(Vec::as_slice) == Some(defaults)
            {
                return Ok(last["id"].as_str().unwrap_or_default().to_string());
            }
        }
    }
    let now = now_local();
    // 同じミリ秒に残しても名前の順が残した順になるよう、この PC の通し番号を添える（ほかの PC とは印で分ける）
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % 1000;
    let id = format!(
        "{}-{:03}{seq:03}-{}-{}",
        now.format("%Y%m%d-%H%M%S"),
        now.and_utc().timestamp_subsec_millis(),
        &hex_id()[..6],
        if auto { "a" } else { "m" }
    );
    let v = json!({"kind": KIND, "version": 1, "id": id, "at": crate::master_store::iso(now), "by": by, "why": why, "auto": auto,
                   "scope": scope, "conversions": conversions, "defaults": defaults});
    write_json_atomic(&d.join(format!("{id}.json")), &v)?;
    if auto {
        for old in ids(d).into_iter().filter(|i| is_auto(i)).skip(AUTO_KEEP) {
            let _ = std::fs::remove_file(d.join(format!("{old}.json"))); // ほかの PC が先に消していれば飛ばす
        }
    }
    Ok(id)
}

/// 出す値の字（字でなければ JSON の字）
fn out_text(v: &Value) -> Value {
    match v {
        Value::String(_) | Value::Null => v.clone(),
        x => json!(x.to_string()),
    }
}

/// 戻すと何が変わるか（表ごと）。now・then は画面の形の表 {name, inputs, rows: [{when, out}], other, apply} の並び。
/// only … この名前の表だけ（None は then の全部）。full … 時点に無い今の表も「消える」として並べる（全体を戻すとき）。
/// 表: {name, st: same|chg|back|gone, now: 行の数か null, then: 行の数か null, setup: 入力・当て方・どれにも当たらないときが変わるか,
///      rows: [{i: 0 から, kind: add|del|chg, now: 今の出す値, then: 戻した出す値}], del, add, chg}
pub fn diff_tables(now: &[Value], then: &[Value], only: Option<&[String]>, full: bool) -> Vec<Value> {
    let name = |t: &Value| t["name"].as_str().unwrap_or_default().to_string();
    let want = |n: &str| only.is_none_or(|o| o.iter().any(|x| x == n));
    let empty = vec![];
    let mut out = vec![];
    for t in then.iter().filter(|t| want(&name(t))) {
        let tr = t["rows"].as_array().unwrap_or(&empty);
        let Some(n) = now.iter().find(|x| name(x) == name(t)) else {
            out.push(json!({"name": name(t), "st": "back", "now": null, "then": tr.len(), "setup": false, "rows": [], "del": 0, "add": tr.len(), "chg": 0}));
            continue;
        };
        let nr = n["rows"].as_array().unwrap_or(&empty);
        let mut rows = vec![];
        let (mut del, mut add, mut chg) = (0, 0, 0);
        for i in 0..nr.len().max(tr.len()) {
            match (nr.get(i), tr.get(i)) {
                (Some(a), None) => {
                    del += 1;
                    rows.push(json!({"i": i, "kind": "del", "now": out_text(&a["out"]), "then": null}));
                }
                (None, Some(b)) => {
                    add += 1;
                    rows.push(json!({"i": i, "kind": "add", "now": null, "then": out_text(&b["out"])}));
                }
                (Some(a), Some(b)) if a != b => {
                    chg += 1;
                    rows.push(json!({"i": i, "kind": "chg", "now": out_text(&a["out"]), "then": out_text(&b["out"])}));
                }
                _ => {}
            }
        }
        let setup = ["inputs", "other", "apply"].iter().any(|k| n[*k] != t[*k]);
        let st = if rows.is_empty() && !setup { "same" } else { "chg" };
        out.push(json!({"name": name(t), "st": st, "now": nr.len(), "then": tr.len(), "setup": setup, "rows": rows,
                        "del": del, "add": add, "chg": chg}));
    }
    for n in now.iter().filter(|n| want(&name(n)) && (full || only.is_some()) && !then.iter().any(|t| name(t) == name(n))) {
        let nr = n["rows"].as_array().map(Vec::len).unwrap_or(0);
        out.push(
            json!({"name": name(n), "st": "gone", "now": nr, "then": null, "setup": false, "rows": [], "del": nr, "add": 0, "chg": 0}),
        );
    }
    out
}

/// 標準の言葉（空なら同梱のプリセット）
pub fn standard_label(defaults: &[Value]) -> String {
    if defaults.is_empty() {
        "同梱のプリセット".into()
    } else {
        format!("自分で決めた {} 表", defaults.len())
    }
}
