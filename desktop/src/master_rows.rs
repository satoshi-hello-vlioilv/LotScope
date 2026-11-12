//! マスタの行を書く共通の型（版 3.75.0）。Python の repositories/master_repository の汎用（SPECS と _create／_update／_delete・
//! _check_rev・_check_unique）と同じ決まりを、窓の 1 か所に持つ。組ごとの決まり（_check_row・表示順）は呼ぶ側が渡す。
//! 使う組: 権限（src/access_write.rs）・勤務体系（src/shifts_write.rs）・設備・ロール（src/equip_write.rs。版 3.77.0）。
//! 版の番号の読み方（Python の int()）と、窓が答えず Python に任せる本文の判定（unreadable）もここ。

use crate::access::normalize_part;
use crate::master_store::{next_id, MasterError, Store};
use crate::worksum::py_str;
use serde_json::{json, Map, Value};

/// 画面が開いたときの版（Python の int() の答え）。Big は i64 に入らない整数（どの行の版とも合わない＝行の衝突）
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Rev {
    Small(i64),
    Big,
}

/// Python の int(v)（pyfmt::py_int_of。版 3.104.0 から窓の int() の写しは 1 つ）。読めなければ None（版を確かめない）。
/// 前は「²」「½」のような数の字を Unknown にして Python に任せていた（Python の int() も ValueError で、base_rev は確かめない）
pub(crate) fn py_rev(v: &Value) -> Option<Rev> {
    match crate::pyfmt::py_int_of(v.into()).ok()? {
        crate::pyfmt::PyInt::Small(i) => Some(Rev::Small(i)),
        crate::pyfmt::PyInt::Big(_) => Some(Rev::Big),
    }
}

/// 行に入っている版（数として読む。Python の int(row.get("rev", 1))）
pub(crate) fn py_int(v: &Value) -> Option<i64> {
    match py_rev(v)? {
        Rev::Small(i) => Some(i),
        Rev::Big => None,
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

/// 行の形をそろえる（master_repository._normalize: 旧い列名を新しい列名へ〈新しい列名が無いときだけ値を移す〉・版の無い行は 1。
/// 書き戻すので、ファイルの中の行にも入る）
pub(crate) fn normalize(r: &mut Value, spec: &Spec) {
    if let Some(o) = r.as_object_mut() {
        for (old, new) in spec.renamed {
            if let Some(v) = o.remove(*old) {
                o.entry(*new).or_insert(v);
            }
        }
        o.entry("rev").or_insert(json!(1));
    }
}

pub(crate) fn normalize_all(rows: &mut [Value], spec: &Spec) {
    for r in rows.iter_mut() {
        normalize(r, spec);
    }
}

/// 本文の数の字のうち、Python の json.loads と窓の serde_json で読みが割れる物があるか（版 3.77.0。字の中は見ない）:
/// 整数の -0（Python は int の 0、serde は小数の -0.0）・i64 に入らない整数（Python の int は桁のまま、serde は u64 か小数）。
/// 事例の表 tests/fixtures/jsonnum_cases.json（Python 3.13 の json.loads と str()）で突き合わせる
pub(crate) fn split_number(body: &[u8]) -> bool {
    split_number_in(body, false)
}

/// split_number の決まりで、wide なら i64 を超えて u64 に入る整数は割れない物として見る（serde は u64 で正確に持ち、
/// worksum::py_str は桁のまま書く。版 3.105.0）。u64 を超える整数（serde は小数に読む）と整数の -0 は wide でも割れる
fn split_number_in(body: &[u8], wide: bool) -> bool {
    let (mut i, mut in_str) = (0usize, false);
    while i < body.len() {
        let b = body[i];
        if in_str {
            match b {
                b'\\' => i += 1,
                b'"' => in_str = false,
                _ => {}
            }
            i += 1;
            continue;
        }
        if b == b'"' {
            in_str = true;
            i += 1;
            continue;
        }
        if b == b'-' || b.is_ascii_digit() {
            let start = i;
            while i < body.len() && matches!(body[i], b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E') {
                i += 1;
            }
            let tok = std::str::from_utf8(&body[start..i]).unwrap_or("");
            if !tok.contains(['.', 'e', 'E']) && (tok == "-0" || (tok.parse::<i64>().is_err() && !(wide && tok.parse::<u64>().is_ok()))) {
                return true;
            }
            continue;
        }
        i += 1;
    }
    false
}

/// JSON の字の、字の外の [ { の入れ子のいちばん深い段（serde_json は 128 段で読むのをやめる。Python の json は読む）
pub(crate) fn json_depth(t: &[u8]) -> usize {
    let (mut depth, mut deepest, mut in_str, mut esc) = (0usize, 0usize, false, false);
    for &b in t {
        if in_str {
            match (esc, b) {
                (true, _) => esc = false,
                (false, b'\\') => esc = true,
                (false, b'"') => in_str = false,
                _ => {}
            }
            continue;
        }
        match b {
            b'"' => in_str = true,
            b'[' | b'{' => {
                depth += 1;
                deepest = deepest.max(depth);
            }
            b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    deepest
}

/// serde_json が読むのをやめる入れ子の段（これ以上の字は窓が答えず Python に任せる）
pub(crate) const SERDE_DEPTH: usize = 128;

/// 字の JSON を Python の json.loads と窓の serde で読みが割れるか（割れるなら Python に任せる）。serde が読める字は数の割れ
/// （split_number: -0・i64 に入らない整数）だけを見る。serde が読めない字は、Python だけが読む形（NaN・Infinity・
/// 1e400 のような指数の数・片割れの代用字の \u）が入っていそうなら割れる、入っていなければ Python も読めない（どちらも「読めない」で同じ）
pub fn text_split(t: &str) -> bool {
    // serde_json は入れ子 128 段で読むのをやめる（Python は読む）。字の外の [ { の深さで見る
    if json_depth(t.as_bytes()) >= SERDE_DEPTH {
        return true;
    }
    if serde_json::from_str::<Value>(t).is_ok() {
        return split_number(t.as_bytes());
    }
    let b = t.as_bytes();
    t.contains("NaN")
        || t.contains("Infinity")
        || t.contains("\\u")
        || b.windows(2).any(|w| w[0].is_ascii_digit() && matches!(w[1], b'e' | b'E'))
}

/// 窓では Python と同じに読めない本文か（空でない本文を serde_json が読めない〈NaN・Infinity・1e400・片割れの代用字など〉か、
/// 読みが割れる数がある）。そのときは窓は答えず Python に任せる。書く道の組（権限・勤務体系・設備・ロール）はみなこれを使う
pub fn unreadable(body: &[u8]) -> bool {
    !body.iter().all(|b| b.is_ascii_whitespace()) && (serde_json::from_slice::<Value>(body).is_err() || split_number(body))
}

/// unreadable と同じだが、i64 を超えて u64 に入る整数は窓が答える（版 3.105.0。焼いた表で確かめて外す G）。使うのは、本文の数を
/// str() の字か、版（int() の Big）か、送った順の木（jsontree::Tree。u64 は桁のまま書く）にしか使わない道だけ:
/// 共有の書式（formats_write）・ダッシュボードのセット（dash_sets）・設備とロール（equip_write）。事例は jsonnum_cases.json と
/// pyfloat_cases.json の fields（cargo test --test jsonnum_cases・pyfloat_cases）
pub fn unreadable_u64_ok(body: &[u8]) -> bool {
    !body.iter().all(|b| b.is_ascii_whitespace()) && (serde_json::from_slice::<Value>(body).is_err() || split_number_in(body, true))
}

pub(crate) fn same_id(r: &Value, id: i64) -> bool {
    match &r["id"] {
        Value::Number(n) => n.as_i64() == Some(id) || n.as_f64() == Some(id as f64),
        Value::Bool(b) => (*b as i64) == id,
        _ => false,
    }
}

/// 比べる相手から除く自分の行か（Python の `r.get("id") != self_id` の否定: 足すとき〈self_id が None〉は id の無い・null の行が自分）。
/// 一意の確かめ（_check_unique）と行の確かめ（_check_row）のどれもこれで見分ける（版 3.77.0。前は足すとき id の無い行とも比べた）
pub(crate) fn is_self(r: &Value, self_id: Option<i64>) -> bool {
    match self_id {
        None => r.get("id").is_none_or(Value::is_null),
        Some(id) => same_id(r, id),
    }
}

/// 置き場の行を窓が Python と同じに読めるか（版 3.77.0）: id は無い・null・真偽・i64 に入る数（next_id の int()。真偽は 1・0。字や大きな数は Python に任せる）、
/// 版は無いか Python の int() が読める物（読めなければ Python は master_call の中の例外で 400、窓は答えない）
pub(crate) fn row_readable(r: &Map<String, Value>) -> bool {
    let id_ok = match r.get("id") {
        None | Some(Value::Null | Value::Bool(_)) => true,
        Some(Value::Number(n)) => n.as_i64().is_some() || n.as_f64().is_some_and(|f| f.is_finite() && f.abs() < 9.0e15),
        _ => false,
    };
    id_ok && r.get("rev").is_none_or(|v| py_int(v).is_some())
}

/// 項目の値を窓が Python の str() と同じ字に書けるか（版 3.77.0）: 並び・表は Python では ['x']・{'a': 1} の形、
/// i64 に入らない整数は Python では桁のまま（窓は 1e+19 の形）になるので、書けない（そのときは Python に任せる）
pub(crate) fn value_plain(v: &Value) -> bool {
    match v {
        Value::Array(_) | Value::Object(_) => false,
        Value::Number(n) => n.as_i64().is_some() || n.as_f64().is_some_and(|f| !(f.fract() == 0.0 && f.abs() >= 9.2e18)),
        _ => true,
    }
}

/// 置き場の行の id・版が読め（row_readable）、決めた項目の値がどれも value_plain か
pub(crate) fn rows_plain(rows: &[Value], fields: &[&str]) -> bool {
    rows.iter().all(|r| r.as_object().is_some_and(|o| row_readable(o) && fields.iter().all(|k| o.get(*k).is_none_or(value_plain))))
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
    /// 旧い列名 → 正しい列名（SPECS の renamed。設備マスタの 巻出し方向 → 巻取方向）
    pub renamed: &'static [(&'static str, &'static str)],
}

/// 行の確かめ（_check_row の組ごとの決まり。無ければ何もしない）。(並び, 確かめる行, 直す行の id)
pub(crate) type CheckRow<'a> = &'a dyn Fn(&[Value], &Map<String, Value>, Option<i64>) -> Result<(), MasterError>;

/// 名前が 1 つずつの列（_check_unique。NFKC・前後の空白を除く・大文字で比べる）
pub(crate) fn check_unique(rows: &[Value], spec: &Spec, data: &Map<String, Value>, self_id: Option<i64>) -> Result<(), MasterError> {
    let Some(col) = spec.unique else { return Ok(()) };
    if !data.contains_key(col) {
        return Ok(());
    }
    let k = normalize_part(data.get(col));
    for r in rows {
        if !is_self(r, self_id) && !k.is_empty() && normalize_part(r.get(col)) == k {
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
        normalize_all(rows, spec);
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
        normalize_all(rows, spec);
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
        normalize_all(rows, spec);
        let Some(i) = rows.iter().position(|r| same_id(r, id)) else {
            return if base.is_some() { Ok(()) } else { Err(MasterError::NotFound(format!("id={id} が見つかりません。"))) };
        };
        check_rev(&rows[i], base)?;
        rows.remove(i);
        Ok(())
    })
}

/// 表示順を書かずに足す行の表示順（row_order.next_order: いまの最大 + 10。版 3.93.0 から勤務体系と変換表の 1 つ）。
/// 各行の str(表示順 or 0).strip() を int() で読み、読めない行（小数の字・「²」・並び）は数えない。Python の int は桁のまま数えるので、
/// 38 桁を超える表示順の行があれば None（窓は答えず Python に任せる）
pub(crate) fn next_order(rows: &[Value]) -> Option<String> {
    let mut best: i128 = 0;
    for r in rows {
        let n = match r.get("表示順").filter(|v| crate::worksum::truthy(v)) {
            None => Some(0),
            Some(Value::Number(n)) => n.as_i64().map(i128::from).or_else(|| n.as_u64().map(i128::from)),
            Some(Value::String(s)) => {
                if s.chars().filter(|c| crate::pyfmt::digit(*c).is_some()).count() > 38 {
                    return None;
                }
                crate::bundle::wide_int_text(s)
            }
            Some(_) => None, // 真偽・並び・表の字（True・[1]）は int() が読めない
        };
        if let Some(n) = n {
            best = best.max(n);
        }
    }
    Some((best + 10).to_string())
}

/// 表示順の字（Python の `str(int(v))`。読めなければ ""）: 真偽・整数・小数（切り捨て）・字（前後の空白・数字の間の _・Unicode の数字）。
/// 版 3.94.0 から変換表と設備グループの 1 つ。i64 に入らない数・38 桁を超える字は None（Python の int は桁のまま。窓は答えず任せる）
pub(crate) fn py_int_text(v: Option<&Value>) -> Option<String> {
    // 版 3.104.0 から pyfmt::py_int_of の 1 つ。並び・表・null・読めない字は ""（前と同じ）
    Some(match v {
        None | Some(Value::Null | Value::Array(_) | Value::Object(_)) => String::new(),
        Some(Value::Number(n)) if n.as_i64().is_none() && n.as_f64().is_some_and(|f| f.trunc().abs() >= 9.2e18) => return None,
        Some(x) => match crate::pyfmt::py_int_of(x.into()) {
            Ok(n) if n.text().trim_start_matches('-').len() > 38 => return None,
            Ok(n) => n.text(),
            Err(_) => String::new(),
        },
    })
}

/// 行の確かめの無い組
pub(crate) fn no_check(_: &[Value], _: &Map<String, Value>, _: Option<i64>) -> Result<(), MasterError> {
    Ok(())
}

/// 鍵の列で行を置く（master_repository.path_setting_put。版 3.89.0）: 鍵の列の値が key と同じ最初の行を直し、無ければ足す。
/// value が None なら行を消す（無ければ何もしない）。base は開いたときの行の版（行が無かったときは 0。違えば行の衝突）。
/// 足す行は {id, 鍵, rev: 0} に値を書いてから版を 1 つ上げる（Python と同じ項目の順）。答えは書いた行（消したときは null）
pub(crate) fn put_by_key(
    store: &Store,
    spec: &Spec,
    key_col: &str,
    key: &str,
    value: Option<&str>,
    value_col: &str,
    base: Option<Rev>,
) -> Result<Value, MasterError> {
    store.write(spec.name, |rows, stamp| {
        normalize_all(rows, spec);
        let i = rows.iter().position(|r| r.get(key_col).and_then(Value::as_str) == Some(key));
        if let Some(b) = base {
            let have = match i {
                Some(i) => py_int(rows[i].get("rev").unwrap_or(&json!(1))),
                None => Some(0),
            };
            if !matches!((have, b), (Some(h), Rev::Small(b)) if h == b) {
                return Err(MasterError::Conflict(i.map(|i| rows[i].clone())));
            }
        }
        let Some(value) = value else {
            if let Some(i) = i {
                rows.remove(i);
            }
            return Ok(Value::Null);
        };
        let i = match i {
            Some(i) => i,
            None => {
                let mut row = Map::new();
                row.insert("id".into(), json!(next_id(rows)));
                row.insert(key_col.into(), json!(key));
                row.insert("rev".into(), json!(0));
                rows.push(Value::Object(row));
                rows.len() - 1
            }
        };
        let row = rows[i].as_object_mut().ok_or_else(|| MasterError::Error("行の形が違います".into()))?;
        row.insert(value_col.into(), json!(value));
        let rev = row.get("rev").map(|v| py_int(v).ok_or_else(|| MasterError::Error("版が読めません".into()))).transpose()?.unwrap_or(0);
        row.insert("rev".into(), json!(rev + 1));
        stamped(row, stamp);
        Ok(Value::Object(row.clone()))
    })
}

/// 書く道の本文（routes の request.get_json(force=True, silent=True) or {}）。版 3.90.0 から参照先の項目・データ元の書く道の 1 か所。
/// 読めない本文は {}（Python と同じ）。Python だけが読む字・読みの割れる数・表でない真の本文（Python は 400 か 500）は None（Python に任せる）
pub(crate) fn py_body(body: &[u8]) -> Option<Value> {
    let v = match serde_json::from_slice::<Value>(body) {
        _ if body.iter().all(|b| b.is_ascii_whitespace()) => Value::Null,
        Ok(_) if split_number(body) => return None,
        Ok(v) => v,
        Err(_) => match std::str::from_utf8(body) {
            Ok(t) if text_split(t) => return None,
            _ => Value::Null,
        },
    };
    if crate::worksum::truthy(&v) && !v.is_object() {
        return None;
    }
    Some(if v.is_object() { v } else { json!({}) })
}

/// 書く係の思いがけない失敗（ファイルの読み書き）の答え（master_call の exception_error: 400・kind error・type は例外の種類）。
/// 言葉は OS の言葉なので Python と同じ字にはできない（状態・種類は同じ）
pub(crate) fn error_answer(m: &str) -> (u16, Value) {
    let kind = if m.contains("os error 13") || m.contains("os error 5)") {
        "PermissionError"
    } else if m.contains("os error 2)") || m.contains("os error 3)") {
        "FileNotFoundError"
    } else {
        "OSError"
    };
    (400, json!({"error": m, "kind": "error", "type": kind}))
}

/// 表でない行の番号（1 から。版 3.102.0 の作った後の採点の割れ 1。Python の master_repository.bad_rows と同じ）
pub fn bad_rows(rows: &[Value]) -> Vec<usize> {
    rows.iter().enumerate().filter(|(_, r)| !r.is_object()).map(|(i, _)| i + 1).collect()
}

/// 表でない行のあるマスタは書かない（行もファイルも消さない）。Python の _normalize_all の MasterUnreadable と同じ言葉・503
pub fn refuse_bad_rows(name: &str, bad: &[usize]) -> Result<(), MasterError> {
    if bad.is_empty() {
        return Ok(());
    }
    Err(MasterError::Unreadable(format!("{}。ファイルを直すまで保存しません。", crate::bundle::bad_rows_text(name, bad))))
}
