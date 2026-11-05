//! マスタの行を書く共通の型（版 3.75.0）。Python の repositories/master_repository の汎用（SPECS と _create／_update／_delete・
//! _check_rev・_check_unique）と同じ決まりを、窓の 1 か所に持つ。組ごとの決まり（_check_row・表示順）は呼ぶ側が渡す。
//! 使う組: 権限（src/access_write.rs）・勤務体系（src/shifts_write.rs）。版の番号の読み方（Python の int()）もここ。

use crate::access::normalize_part;
use crate::master_store::{next_id, MasterError, Store};
use crate::worksum::py_str;
use serde_json::{json, Map, Value};

/// 画面が開いたときの版（Python の int() の答え）。Big は i64 に入らない整数（どの行の版とも合わない＝行の衝突）
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Rev {
    Small(i64),
    Big,
    /// 10 進の数字でない数の字（「²」・「½」など。Python の int() も読まない）。窓は答えず Python に任せる
    Unknown,
}

/// Unicode の 10 進の数字の値（Python の int() が読む字。版 3.75.0 から pyfmt の 1 つの表〈Python 3.13・Unicode 15.1 の 68 系統〉。
/// 前はここに 18 系統の別の表を持ち、モンゴルの数字などを窓だけ読めなかった）
pub(crate) fn digit_of(c: char) -> Option<u32> {
    crate::pyfmt::digit(c)
}

/// Python の int(v)（数・小数〈切り捨て〉・真偽・字〈前後の空白・数字の間の _・Unicode の数字〉）。読めなければ None（版を確かめない）
pub(crate) fn py_rev(v: &Value) -> Option<Rev> {
    match v {
        Value::Bool(b) => Some(Rev::Small(*b as i64)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                return Some(Rev::Small(i));
            }
            if n.is_u64() {
                return Some(Rev::Big);
            }
            let f = n.as_f64()?;
            if !f.is_finite() {
                return None;
            }
            let t = f.trunc();
            Some(if t.abs() < 9.2e18 { Rev::Small(t as i64) } else { Rev::Big })
        }
        Value::String(s) => {
            let t = s.trim();
            let (neg, body) = match t.chars().next() {
                Some('-') => (true, &t[1..]),
                Some('+') => (false, &t[1..]),
                _ => (false, t),
            };
            if body.is_empty() || body.starts_with('_') || body.ends_with('_') || body.contains("__") {
                return None;
            }
            let mut acc: i128 = 0;
            let mut big = false;
            for c in body.chars() {
                if c == '_' {
                    continue;
                }
                let Some(d) = digit_of(c) else {
                    return c.is_numeric().then_some(Rev::Unknown);
                };
                let d = d as i128;
                acc = match acc.checked_mul(10).and_then(|x| x.checked_add(d)) {
                    Some(x) => x,
                    None => {
                        big = true;
                        0
                    }
                };
            }
            let v = if neg { -acc } else { acc };
            Some(if big || v > i64::MAX as i128 || v < i64::MIN as i128 { Rev::Big } else { Rev::Small(v as i64) })
        }
        _ => None,
    }
}

/// 行に入っている版（数として読む。Python の int(row.get("rev", 1))）
pub(crate) fn py_int(v: &Value) -> Option<i64> {
    match py_rev(v)? {
        Rev::Small(i) => Some(i),
        Rev::Big | Rev::Unknown => None,
    }
}

/// 画面が開いたときの行の版（routes/common.base_rev: PUT は本文の base_rev、DELETE は ?rev=。無い・読めないなら確かめない）
pub(crate) fn base_rev(body: &Value, query: &str) -> Option<Rev> {
    let v = match body.get("base_rev") {
        Some(v) => v.clone(),
        None => match crate::lotlist::parse_query(query).into_iter().find(|(k, _)| k == "rev") {
            Some((_, v)) => json!(v),
            None => return None,
        },
    };
    if v.is_null() || v == json!("") {
        return None;
    }
    py_rev(&v)
}

/// 行の形をそろえる（版の無い行は 1。master_repository._normalize。書き戻すので、ファイルの中の行にも入る）
pub(crate) fn normalize_all(rows: &mut [Value], default_rev: i64) {
    for r in rows.iter_mut() {
        if let Some(o) = r.as_object_mut() {
            o.entry("rev").or_insert(json!(default_rev));
        }
    }
}

pub(crate) fn same_id(r: &Value, id: i64) -> bool {
    match &r["id"] {
        Value::Number(n) => n.as_i64() == Some(id) || n.as_f64() == Some(id as f64),
        Value::Bool(b) => (*b as i64) == id,
        _ => false,
    }
}

/// 行の版を確かめる（_check_rev）
pub(crate) fn check_rev(row: &Value, base: Option<Rev>) -> Result<(), MasterError> {
    if let Some(b) = base {
        let Rev::Small(b) = b else { return Err(MasterError::Conflict(Some(row.clone()))) };
        let rev = row
            .get("rev")
            .map(|v| py_int(v).ok_or_else(|| MasterError::Error(format!("invalid literal for int(): {}", py_str(v)))))
            .transpose()?
            .unwrap_or(1);
        if rev != b {
            return Err(MasterError::Conflict(Some(row.clone())));
        }
    }
    Ok(())
}

/// _clean: ("" if v is None else str(v)).strip()
pub(crate) fn clean(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(x) => crate::pyfmt::strip(&py_str(x)).to_string(),
    }
}

pub(crate) fn stamped(row: &mut Map<String, Value>, stamp: &Value) {
    for (k, v) in stamp.as_object().into_iter().flatten() {
        row.insert(k.clone(), v.clone());
    }
}

/// マスタの組（repositories/master_repository の SPECS: 名前・置く項目・名前が 1 つずつの列）
pub(crate) struct Spec {
    pub name: &'static str,
    pub fields: &'static [&'static str],
    pub unique: Option<&'static str>,
}

/// 行の確かめ（_check_row の組ごとの決まり。無ければ何もしない）。(並び, 確かめる行, 直す行の id)
pub(crate) type CheckRow<'a> = &'a dyn Fn(&[Value], &Map<String, Value>, Option<i64>) -> Result<(), MasterError>;

/// 名前が 1 つずつの列（_check_unique。NFKC・前後の空白を除く・大文字で比べる）
fn check_unique(rows: &[Value], spec: &Spec, data: &Map<String, Value>, self_id: Option<i64>) -> Result<(), MasterError> {
    let Some(col) = spec.unique else { return Ok(()) };
    if !data.contains_key(col) {
        return Ok(());
    }
    let k = normalize_part(data.get(col));
    for r in rows {
        if !self_id.is_some_and(|id| same_id(r, id)) && !k.is_empty() && normalize_part(r.get(col)) == k {
            return Err(MasterError::Duplicate(format!(
                "{col}「{}」はもう登録されています（ほかの PC が先に追加した可能性があります）。",
                clean(data.get(col))
            )));
        }
    }
    Ok(())
}

/// 足す（_create: 版の無い行は 1・一意・行の確かめ・次の id・置く項目は字で前後の空白を除く・版 1・書いた人と時刻）
pub(crate) fn create(store: &Store, spec: &Spec, data: &Map<String, Value>, check: CheckRow) -> Result<Value, MasterError> {
    store.write(spec.name, |rows, stamp| {
        normalize_all(rows, 1);
        check_unique(rows, spec, data, None)?;
        check(rows, data, None)?;
        let mut row = Map::new();
        row.insert("id".into(), json!(next_id(rows)));
        for k in spec.fields {
            row.insert((*k).into(), json!(clean(data.get(*k))));
        }
        row.insert("rev".into(), json!(1));
        stamped(&mut row, stamp);
        rows.push(Value::Object(row.clone()));
        Ok(Value::Object(row))
    })
}

/// 直す（_update: 無い行は 404〈版を添えたなら 409〉・行の版・一意・行の確かめは直した後の形で・来た項目だけ・版を 1 つ上げる）
pub(crate) fn update(
    store: &Store,
    spec: &Spec,
    id: i64,
    data: &Map<String, Value>,
    base: Option<Rev>,
    check: CheckRow,
) -> Result<Value, MasterError> {
    store.write(spec.name, |rows, stamp| {
        normalize_all(rows, 1);
        let Some(i) = rows.iter().position(|r| same_id(r, id)) else {
            return Err(if base.is_some() {
                MasterError::Conflict(None)
            } else {
                MasterError::NotFound(format!("id={id} が見つかりません。"))
            });
        };
        check_rev(&rows[i], base)?;
        check_unique(rows, spec, data, Some(id))?;
        let mut merged = rows[i].as_object().cloned().unwrap_or_default();
        for (k, v) in data {
            merged.insert(k.clone(), v.clone());
        }
        check(rows, &merged, Some(id))?;
        let row = rows[i].as_object_mut().ok_or_else(|| MasterError::Error("行の形が違います".into()))?;
        for k in spec.fields {
            if data.contains_key(*k) {
                row.insert((*k).into(), json!(clean(data.get(*k))));
            }
        }
        let rev = row.get("rev").and_then(py_int).unwrap_or(1);
        row.insert("rev".into(), json!(rev + 1));
        stamped(row, stamp);
        Ok(Value::Object(row.clone()))
    })
}

/// 消す（_delete: 無い行は 404〈版を添えたならもう消えている＝望みどおり〉・行の版）
pub(crate) fn delete(store: &Store, spec: &Spec, id: i64, base: Option<Rev>) -> Result<(), MasterError> {
    store.write(spec.name, |rows, _stamp| {
        normalize_all(rows, 1);
        let Some(i) = rows.iter().position(|r| same_id(r, id)) else {
            return if base.is_some() { Ok(()) } else { Err(MasterError::NotFound(format!("id={id} が見つかりません。"))) };
        };
        check_rev(&rows[i], base)?;
        rows.remove(i);
        Ok(())
    })
}

/// 行の確かめの無い組
pub(crate) fn no_check(_: &[Value], _: &Map<String, Value>, _: Option<i64>) -> Result<(), MasterError> {
    Ok(())
}
