//! 起動の初期値（版 3.110.0。Python の services/master_seeds.py を写した。段 ② の 1 歩目）。
//!
//! 配った版で決めたマスタの初期値を、共有のマスタへ一度だけ当て、当てたことを共有のマスタ app_seeds に記録する（2 回目からは当てない。
//! あとで人が直した値を戻さない）。当てる中身も「まだ決まっていないときだけ」（記録が消えても人の決めた値を上書きしない）。
//!
//! 係は窓の 1 つ（sidecar.rs の SERVES に seeds を名乗り、Python の boot.start は名乗られると当てない。engine の設定によらない）。
//! 窓は置き場が決まってから（束の材料 bundle::Builder::inputs が引っ越しの印をたどった後）裏の糸で 1 回だけ走らせる（main.rs・
//! Lot::run_seeds）。書くのは種まきと同じ書く係（master_store::shared_store。同じ置き場・同じ名乗りで 1 つ。この窓の書き込みと
//! serialized で 1 本）。手元のみの PC は Store::write_changed → write_local（data/ に行の配列）で当てる。
//!
//! 決まりは事例の表 program/tests/fixtures/seeds_cases.json に全部書いてある（人が仕様から書いた。Python も同じ表で確かめる）:
//!   - 当てる順は 検査計 → 最初の管理者 → 釜番日付。1 つ失敗したら（共有に届かない・錠が 5 回とも取れない・読めない値）後ろは当てずに
//!     次の起動へ（記録しない）
//!   - 検査計: 設備名を access::normalize_part（NFKC・前後の空白・大文字。数も字に）で比べ、同じ名前の行が 2 つなら後の行だけに当たる。
//!     検査計の欄の str(v or "").strip() が空（0・false・[]・空白も空）なら「有」にして rev を int(rev or 1)+1（「abc」は int() が
//!     読めないので、この初期値と後ろを当てずに次の起動へ。1.5 は 1・true は 1・i64 に入らない数は桁のまま PyInt）
//!   - 最初の管理者: ログインID を normalize_part で比べ、無ければ足す
//!   - 釜番日付: 名前は normalize しない str(v or "") の完全一致。同梱の表に無ければ何もしない（記録はする）。同梱の表が読めなければ次の起動へ
//!   - id は master_store::next_id、表示順は master_rows::next_order（字の "n"）
//!   - 表でない行（Python の r.get が AttributeError）がそのマスタにあれば、その初期値と後ろを当てずに次の起動へ（人が直すまで当てない）。
//!     3.107.0 で一覧が隔てる行（id が字・版が読めない・NaN など）も表なので、ほかの行と同じに比べる（版が読めない行に当たれば上の rev の決まり）
//!   - 錠の中で読み直した行で決め、当てる中身が無ければ書かない（版を上げない）。app_seeds も同じ seed（str() で比べる）がもうあれば足さない
//!     （前は 2 つの PC が app_seeds を読んだ直後に当てると、記録が seed ごとに 2 行・中身の版が空の書き込みで上がった）
//!   - 錠（ほかの係が保存中）に当たったら 1 秒おきに 5 回まで待つ（待つのは裏の糸だけ。画面の問い合わせの道では待たない）

use crate::access::normalize_part;
use crate::master_store::{next_id, MasterError, Store};
use serde_json::{json, Map, Value};
use std::time::Duration;

pub const SEEDS_MASTER: &str = "app_seeds";
pub const LOCKED_TRIES: usize = 5;
pub const LOCKED_WAIT: Duration = Duration::from_secs(1);

/// (id, マスタ)。当てる順
pub const SEEDS: [(&str, &str); 3] = [
    ("2026-09-29-inspection-meter", "equipment_master"),
    ("2026-09-29-first-developer", "access_permissions"),
    ("2026-10-23-kama-date-table", "conversions"),
];

/// 検査計のある設備（2026-09-29 利用者）
pub const METERS: [&str; 5] = ["LS3", "LS4", "DL2", "TLV", "NS1"];
pub const FIRST_DEVELOPER: &str = "satoshi-harada";
pub const KAMA_TABLE: &str = "釜番日付";

/// 当て方の結果（Err は Python が例外で止まる形: この初期値と後ろを当てずに次の起動へ）
pub type Step = Result<bool, String>;

/// Python の r.get(k)（表でない行は AttributeError）
fn get<'a>(r: &'a Value, k: &str) -> Result<Option<&'a Value>, String> {
    match r {
        Value::Object(o) => Ok(o.get(k)),
        _ => Err(format!("'{}' object has no attribute 'get'", py_type(r))),
    }
}

fn py_type(v: &Value) -> &'static str {
    match v {
        Value::Null => "NoneType",
        Value::Bool(_) => "bool",
        Value::Number(n) if n.is_f64() => "float",
        Value::Number(_) => "int",
        Value::String(_) => "str",
        Value::Array(_) => "list",
        Value::Object(_) => "dict",
    }
}

/// str(v or "")
fn text_or_empty(v: Option<&Value>) -> String {
    crate::access::text(v)
}

/// 行に stamp（updated_at・updated_by）を重ねる
fn stamped(mut row: Map<String, Value>, stamp: &Value) -> Value {
    if let Some(s) = stamp.as_object() {
        for (k, v) in s {
            row.insert(k.clone(), v.clone());
        }
    }
    Value::Object(row)
}

/// 検査計のある設備（Python の _inspection_meter）
pub fn inspection_meter(rows: &mut Vec<Value>, stamp: &Value) -> Step {
    // have = {normalize_part(r.get("設備名")): r for r in rows}（同じ名前は後の行）
    let mut have: Vec<(String, usize)> = vec![];
    for (i, r) in rows.iter().enumerate() {
        let key = normalize_part(get(r, "設備名")?);
        match have.iter_mut().find(|(k, _)| *k == key) {
            Some(x) => x.1 = i,
            None => have.push((key, i)),
        }
    }
    let mut changed = false;
    for name in METERS {
        let want = normalize_part(Some(&json!(name)));
        match have.iter().find(|(k, _)| *k == want).map(|(_, i)| *i) {
            None => {
                let id = next_id(rows);
                let mut row = Map::new();
                for (k, v) in [
                    ("id", id),
                    ("設備名", json!(name)),
                    ("巻取方向", json!("")),
                    ("ライン方向", json!("")),
                    ("同一工程", json!("")),
                    ("検査計", json!("有")),
                    ("rev", json!(1)),
                ] {
                    row.insert(k.into(), v);
                }
                rows.push(stamped(row, stamp));
                changed = true;
            }
            Some(i) => {
                let r = &rows[i];
                if !crate::pyfmt::strip(&text_or_empty(get(r, "検査計")?)).is_empty() {
                    continue;
                }
                // int(r.get("rev") or 1) + 1
                let rev = match get(r, "rev")? {
                    Some(v) if crate::worksum::truthy(v) => crate::pyfmt::py_int_of(v.into())?,
                    _ => crate::pyfmt::PyInt::Small(1),
                };
                let o = rows[i].as_object_mut().expect("表の行");
                o.insert("検査計".into(), json!("有"));
                o.insert("rev".into(), crate::held::int_value(&rev.succ()));
                if let Some(s) = stamp.as_object() {
                    for (k, v) in s {
                        o.insert(k.clone(), v.clone());
                    }
                }
                changed = true;
            }
        }
    }
    Ok(changed)
}

/// 最初の管理者（Python の _first_developer）
pub fn first_developer(rows: &mut Vec<Value>, stamp: &Value) -> Step {
    let want = normalize_part(Some(&json!(FIRST_DEVELOPER)));
    for r in rows.iter() {
        if normalize_part(get(r, "ログインID")?) == want {
            return Ok(false);
        }
    }
    let mut row = Map::new();
    for (k, v) in [
        ("id", next_id(rows)),
        ("ログインID", json!(FIRST_DEVELOPER)),
        ("PC名", json!("")),
        ("権限区分", json!("開発者")),
        ("マスタ編集", json!("編集可")),
        ("有効", json!("有")),
        ("備考", json!("最初の管理者（配った版で登録）")),
        ("rev", json!(1)),
    ] {
        row.insert(k.into(), v);
    }
    rows.push(stamped(row, stamp));
    Ok(true)
}

/// 変換表「釜番日付」（Python の _kama_date_table）。bundled は同梱の master_defaults/conversions.json の中身（読めなければ Err）
pub fn kama_date_table(rows: &mut Vec<Value>, stamp: &Value, bundled: Result<Value, String>) -> Step {
    for r in rows.iter() {
        if text_or_empty(get(r, "名前")?) == KAMA_TABLE {
            return Ok(false);
        }
    }
    let bundled = bundled?;
    // for r in bundled（表なら鍵の字を回すので r.get が AttributeError）
    let items: Vec<Value> = match bundled {
        Value::Array(a) => a,
        Value::Object(o) => o.keys().map(|k| json!(k)).collect(),
        v => return Err(format!("'{}' object is not iterable", py_type(&v))),
    };
    let mut src = None;
    for r in &items {
        if get(r, "名前")? == Some(&json!(KAMA_TABLE)) {
            src = Some(r.clone());
            break;
        }
    }
    let Some(src) = src else { return Ok(false) };
    let mut row = Map::new();
    row.insert("id".into(), next_id(rows));
    for k in ["名前", "入力", "判定", "その他", "当て方"] {
        row.insert(k.into(), src.get(k).cloned().unwrap_or(json!("")));
    }
    row.insert("表示順".into(), json!(crate::master_rows::next_order(rows).unwrap_or_else(|| "10".into())));
    row.insert("rev".into(), json!(1));
    rows.push(stamped(row, stamp));
    Ok(true)
}

/// app_seeds に当てたことを書く（同じ seed がもうあれば足さない）
pub fn record(rows: &mut Vec<Value>, stamp: &Value, sid: &str) -> Step {
    for r in rows.iter() {
        let v = get(r, "seed")?.cloned().unwrap_or(Value::Null);
        if crate::worksum::py_str(&v) == sid {
            return Ok(false);
        }
    }
    let mut row = Map::new();
    row.insert("id".into(), next_id(rows));
    row.insert("seed".into(), json!(sid));
    rows.push(stamped(row, stamp));
    Ok(true)
}

/// 同梱の変換表（master_defaults/conversions.json）を読む
pub fn read_bundled(store: &Store) -> Result<Value, String> {
    let p = store.defaults_dir().join("conversions.json");
    let raw = std::fs::read(&p).map_err(|e| e.to_string())?;
    crate::master_store::parse_master(&raw, &p).map_err(|_| format!("{} が読めません", p.display()))
}

/// 1 つの初期値を中身に当てる（seed の id → 当て方）
pub fn apply(sid: &str, rows: &mut Vec<Value>, stamp: &Value, bundled: &dyn Fn() -> Result<Value, String>) -> Step {
    match sid {
        "2026-09-29-inspection-meter" => inspection_meter(rows, stamp),
        "2026-09-29-first-developer" => first_developer(rows, stamp),
        "2026-10-23-kama-date-table" => kama_date_table(rows, stamp, bundled()),
        _ => Ok(false),
    }
}

/// 走らせた結果（記録と試験）
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Outcome {
    /// 当て終えた（中身と記録の 2 つを済ませた）初期値
    pub applied: Vec<String>,
    /// 止めた初期値と理由（後ろは次の起動へ）
    pub stopped: Option<(String, String)>,
    /// app_seeds を読めず、何もしなかった理由
    pub skipped: Option<String>,
}

/// 錠（ほかの係が保存中）に当たったら wait おきに LOCKED_TRIES 回までやり直す
fn write_retry(store: &Store, name: &str, wait: &dyn Fn(Duration), f: &dyn Fn(&mut Vec<Value>, &Value) -> Step) -> Result<(), String> {
    for i in 0..LOCKED_TRIES {
        let r = store.write_changed(name, |rows, stamp| match f(rows, stamp) {
            Ok(changed) => Ok(((), changed)),
            Err(e) => Err(MasterError::Error(e)),
        });
        match r {
            Ok(()) => return Ok(()),
            Err(MasterError::Locked { .. }) if i + 1 < LOCKED_TRIES => wait(LOCKED_WAIT),
            Err(e) => return Err(e.message()),
        }
    }
    Ok(())
}

/// まだ当てていない初期値を当てる（Python の master_seeds.run）。共有に届かない・錠が取れない・読めない値のときは投げずに次の起動へ回す。
/// wait は錠を待つ間（試験は待たずに数える）
pub fn run(store: &Store, wait: &dyn Fn(Duration)) -> Outcome {
    run_with(store, wait, &|| {})
}

/// run と同じ。after_read は app_seeds を読んだ直後に呼ぶ（試験が 2 つの係をここで待ち合わせ、同じ時に当てる形を起こす）
pub fn run_with(store: &Store, wait: &dyn Fn(Duration), after_read: &dyn Fn()) -> Outcome {
    let mut out = Outcome::default();
    let done: Vec<String> = match store.read_doc(SEEDS_MASTER, false) {
        Err(e) => {
            out.skipped = Some(e.message());
            return out;
        }
        Ok((doc, _)) => {
            let mut v = vec![];
            for r in &doc.rows {
                match get(r, "seed") {
                    Ok(x) => v.push(crate::worksum::py_str(x.unwrap_or(&Value::Null))),
                    Err(e) => {
                        out.skipped = Some(e);
                        return out;
                    }
                }
            }
            v
        }
    };
    after_read();
    let bundled = || read_bundled(store);
    for (sid, name) in SEEDS {
        if done.iter().any(|d| d == sid) {
            continue;
        }
        let r = write_retry(store, name, wait, &|rows, stamp| apply(sid, rows, stamp, &bundled))
            .and_then(|_| write_retry(store, SEEDS_MASTER, wait, &|rows, stamp| record(rows, stamp, sid)));
        match r {
            Ok(()) => out.applied.push(sid.to_string()),
            Err(e) => {
                out.stopped = Some((sid.to_string(), e));
                break;
            }
        }
    }
    out
}
