//! 変換表の道（版 3.93.0）。Python の `routes/conversions.py` のマスタ管理の 8 本を窓が受ける:
//!
//! ```text
//! GET    /api/masters/conversions               … 一覧（表示順）・比べ方・当て方・標準の名前・標準を差し替えたか・書けるか・共有か・版
//! POST   /api/masters/conversions               … 足す（201・一覧＋created）
//! PUT    /api/masters/conversions/<id>          … 直す（来た物だけ。本文 base_rev は開いたときの行の版）
//! POST   /api/masters/conversions/<id>/preset   … 標準に戻す（標準の同じ名前の表の 入力・判定・その他・当て方 へ）
//! DELETE /api/masters/conversions/<id>          … 消す（?rev= は開いたときの行の版）
//! GET    /api/masters/conversions/export        … 書き出す（?which=defaults は標準）
//! POST   /api/masters/conversions/import        … 取り込む（同じ名前は中身を置き換え・無い名前は足す。asDefault なら標準にも）
//! POST   /api/masters/conversions/defaults      … 標準を決める（from: current か bundled）
//! ```
//!
//! 決まりは services/conversions.py と master_repository の conversion_* と同じ（評価関数: tests/conversions_write_parity.rs ←
//! program/tests/conversions_oracle.py）。本文は送った順の木（src/jsontree.rs）で読み、入力・判定・当て方の字は json.dumps の既定の
//! 区切り（", "・": "）で書く（判定の when の鍵は送った順・同じ鍵は後ろの値を前の位置へ）。値の字は _text（0 → "0"・false → "False"・
//! 小数は Python の repr）。範囲の端は float(str(v).replace(",", "")) と同じ読み方（pyfmt::py_float。「１,000」→ 1000・「-0」→ 0）。
//! 出す値の式は formula::Formula::compile で読む（画面と Python の式と同じ部品）。表示順の無い行は最後（master_rows::next_order）。
//! 一覧の形は bundle::conv_views（画面の埋める物・式の conv と同じ読み方）。標準は conversion_defaults に行があればそれ、無ければ
//! 同梱の app/master_defaults/conversions.json。取り込みで標準にもするときは、Python と同じく 2 回に分けて書く（変換表 → 標準）。
//!
//! 窓が答えず Python に任せる形: 空・読めない本文（Python は get_json(force=True) で 400 の HTML）・表でない真の本文のうち Python が
//! 道の外で落ちる物（直す・標準に戻す・消す・標準を決める。500）・値が並び・表（Python の repr）・inputs が表・apply が並び・op・mode・place が
//! 並び・表（unhashable）・2^63 以上の整数の範囲の端と表示順・式の正規表現が読めない（言葉が Python と割れうる）・入れ子の深い式・
//! 置き場の行を窓が同じに読めない（id・版・値の形・表示順の桁・JSON の字）・標準の行の名前が字でない・標準に戻す中身の列が無い・
//! 置き場のファイルを窓が同じに読めない（master_rows::text_split）・i64 に入らない id・百分率符号の道。

use crate::access::Place;
use crate::jsontree::Tree;
use crate::master_rows::{self, base_rev, Rev, Spec};
use crate::master_store::{next_id, MasterError, Store};
use crate::pyfmt::PyInt;
use crate::pyfmt::{self, strip};
use crate::worksum::{py_str, truthy};
use serde_json::{json, Map, Number, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub const NAME: &str = "conversions";
/// 変換表の標準（版 3.43.0。「標準に戻す」で戻る中身。空なら同梱のプリセット）
pub const DEFAULTS: &str = "conversion_defaults";
const FIELDS: [&str; 6] = ["名前", "入力", "判定", "その他", "当て方", "表示順"];
const SPEC: Spec = Spec { name: NAME, fields: &FIELDS, unique: None, renamed: &[] };
const SPEC_D: Spec = Spec { name: DEFAULTS, fields: &FIELDS, unique: None, renamed: &[] };
const NAME_MAX: usize = 40;
const MAX_INPUTS: usize = 8;
const MAX_ROWS: usize = 300;
const MAX_TESTS: usize = 12;
const MAX_VALUES: usize = 60;
const VALUE_MAX: usize = 100;
const OUT_MAX: usize = 500;
const MAX_IMPORT: usize = 200;
/// 比べ方（conversions.OPS）
const OPS: [(&str, &str); 11] = [
    ("eq", "と同じ"),
    ("ne", "と違う"),
    ("starts", "で始まる"),
    ("nstarts", "で始まらない"),
    ("ends", "で終わる"),
    ("nends", "で終わらない"),
    ("contains", "を含む"),
    ("ncontains", "を含まない"),
    ("empty", "空欄"),
    ("filled", "空欄でない"),
    ("range", "の範囲"),
];
const MODES: [(&str, &str); 2] = [("replace", "列の値を作り替える"), ("add", "列を足す")];
const PLACES: [(&str, &str); 3] = [("left", "いちばん左"), ("after", "元の列の右"), ("end", "右の端")];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    List,
    Create,
    Update(PyInt),
    Preset(PyInt),
    Delete(PyInt),
    Export,
    Import,
    Defaults,
}

/// 窓が受ける道か（<int:item_id> は \d+ と int()。Unicode の数字・先頭の 0 も。i64 に入らない id は Python）
pub fn route_of(method: &str, path: &str) -> Option<Route> {
    let rest = path.strip_prefix("/api/masters/conversions")?;
    match (method, rest) {
        ("GET", "") => Some(Route::List),
        ("POST", "") => Some(Route::Create),
        ("GET", "/export") => Some(Route::Export),
        ("POST", "/import") => Some(Route::Import),
        ("POST", "/defaults") => Some(Route::Defaults),
        ("POST", r) => Some(Route::Preset(crate::worklog_write::id_of(r.strip_prefix('/')?.strip_suffix("/preset")?)?)),
        ("PUT", r) => Some(Route::Update(crate::worklog_write::id_of(r.strip_prefix('/')?)?)),
        ("DELETE", r) => Some(Route::Delete(crate::worklog_write::id_of(r.strip_prefix('/')?)?)),
        _ => None,
    }
}

type Answer = (u16, Value);

/// 確かめで止まる理由: Python に任せる（Delegate）か、変換表の誤り（ConversionError の言葉）
enum Bad {
    Delegate,
    Conv(String),
}
type C<T> = Result<T, Bad>;

fn conv<T>(m: impl Into<String>) -> C<T> {
    Err(Bad::Conv(m.into()))
}

/// master_call の exception_error（ConversionError）
fn conv_error(m: String) -> Answer {
    (400, json!({"error": m, "kind": "error", "type": "ConversionError"}))
}

pub(crate) fn of_master(e: MasterError) -> Answer {
    match e {
        MasterError::Error(m) => master_rows::error_answer(&m),
        e => (e.status(), e.payload()),
    }
}

// ------------------------------------------------------------------ 値の字（Python の str()）
fn is_none(t: Option<&Tree>) -> bool {
    matches!(t, None | Some(Tree::Null))
}

fn t_truthy(t: Option<&Tree>) -> bool {
    t.is_some_and(|t| truthy(&t.to_value()))
}

/// str(v)（並び・表は Python の repr が要るので任せる。i64・u64 に入らない整数は版 3.108.0 から印の字〈Tree::Str〉で、py_str が桁の字にする）
fn scalar(t: &Tree) -> C<String> {
    match t {
        Tree::Arr(_) | Tree::Obj(_) => Err(Bad::Delegate),
        // 本文は版 3.108.0 から大きな整数を印の字で読む（strict・Tree::parse）ので、残る小数は本当の小数（str() は float の repr: 1e+25）
        t => Ok(py_str(&t.to_value())),
    }
}

/// _text: str(v if v is not None else "").strip()[:size]（code point で切る）
fn text(v: Option<&Tree>, size: usize) -> C<String> {
    match v {
        None | Some(Tree::Null) => Ok(String::new()),
        Some(t) => Ok(strip(&scalar(t)?).chars().take(size).collect()),
    }
}

/// _j: 並び・表はそのまま、空でない字は JSON として読み、型が既定と違えば既定（list は並びが既定）
fn j(v: Option<&Tree>, list: bool) -> C<Tree> {
    let dflt = if list { Tree::Arr(vec![]) } else { Tree::Obj(vec![]) };
    match v {
        Some(x @ (Tree::Arr(_) | Tree::Obj(_))) => Ok(x.clone()),
        Some(Tree::Str(s)) if !strip(s).is_empty() => {
            // 整数の -0 は Python と同じ 0 と読む（版 3.107.0。読み手は master_rows::inner_text の 1 つ）
            if master_rows::text_split_py(s) {
                return Err(Bad::Delegate);
            }
            Ok(match Tree::parse(&master_rows::inner_text(s)) {
                Some(x @ Tree::Arr(_)) if list => x,
                Some(x @ Tree::Obj(_)) if !list => x,
                _ => dflt,
            })
        }
        _ => Ok(dflt),
    }
}

fn label(table: &[(&'static str, &'static str)], v: Option<&Tree>) -> C<Option<&'static str>> {
    match v {
        Some(Tree::Str(s)) => Ok(table.iter().find(|(k, _)| *k == s.as_str()).map(|(k, _)| *k)),
        Some(Tree::Arr(_) | Tree::Obj(_)) => Err(Bad::Delegate), // unhashable type（Python の TypeError）
        _ => Ok(None),
    }
}

fn s(x: &str) -> Tree {
    Tree::Str(x.to_string())
}

// ------------------------------------------------------------------ 確かめ（conversions.clean_*）
/// clean_inputs → (置く並び, 入力の名前)
fn clean_inputs(v: Option<&Tree>) -> C<(Vec<Tree>, Vec<String>)> {
    let items = match j(v, true)? {
        Tree::Arr(a) => a,
        _ => return Err(Bad::Delegate), // 表の inputs は items[:9] が KeyError（Python の言葉）
    };
    let (mut out, mut seen) = (vec![], Vec::<String>::new());
    for x in items.iter().take(MAX_INPUTS + 1) {
        if !matches!(x, Tree::Obj(_)) {
            continue;
        }
        let name = text(x.get("name"), NAME_MAX)?;
        if name.is_empty() {
            return conv("入力の名前を入れてください。");
        }
        if seen.contains(&name) {
            return conv(format!("入力の名前「{name}」が 2 つあります。"));
        }
        seen.push(name.clone());
        let mut cols = vec![];
        if let Some(Tree::Arr(cs)) = x.get("columns") {
            for c in cs {
                let c = text(Some(c), 200)?;
                if !c.is_empty() {
                    cols.push(c);
                }
            }
        }
        cols.truncate(12);
        if cols.is_empty() {
            cols.push(name.clone());
        }
        let typ = if x.get("type") == Some(&s("num")) { "num" } else { "text" };
        out.push(Tree::Obj(vec![
            ("name".into(), s(&name)),
            ("type".into(), s(typ)),
            ("columns".into(), Tree::Arr(cols.iter().map(|c| s(c)).collect())),
        ]));
    }
    if out.is_empty() {
        return conv("入力を 1 つ以上入れてください（読み替える列・判定に使う列）。");
    }
    if out.len() > MAX_INPUTS {
        return conv(format!("入力は {MAX_INPUTS} つまでです。"));
    }
    Ok((out, seen))
}

/// _num_or_blank: 空なら None、数なら整数（is_integer）か小数
fn num_or_blank(v: Option<&Tree>) -> C<Option<Tree>> {
    let raw = match v {
        None | Some(Tree::Null) => return Ok(None),
        Some(Tree::Str(x)) if strip(x).is_empty() => return Ok(None),
        Some(t) => scalar(t)?,
    };
    let bad = || conv(format!("範囲の端は数で入れてください（{raw}）。"));
    let f = match pyfmt::py_float(strip(&raw.replace(',', ""))) {
        Ok(f) if f.is_finite() => f,
        _ => return bad(),
    };
    if f.fract() == 0.0 {
        // int(f): 2^63 以上も Python の int と同じく桁のまま（版 3.108.0。i64・u64 に入らなければ src/held.rs の印の字で、書くときに桁に戻る）
        let n = pyfmt::py_int_of(pyfmt::IntArg::Num(&Number::from_f64(f).ok_or(Bad::Delegate)?)).map_err(|_| Bad::Delegate)?;
        return Ok(Some(Tree::from_value(&crate::held::int_value(&n))));
    }
    Ok(Some(Tree::Num(Number::from_f64(f).ok_or(Bad::Delegate)?)))
}

/// clean_test
fn clean_test(t: &Tree) -> C<Tree> {
    if !matches!(t, Tree::Obj(_)) {
        return conv("比べ方が分かりません。");
    }
    let Some(op) = label(&OPS, t.get("op"))? else { return conv("比べ方が分かりません。") };
    if op == "empty" || op == "filled" {
        return Ok(Tree::Obj(vec![("op".into(), s(op))]));
    }
    if op == "range" {
        let lo = num_or_blank(t.get("min"))?;
        let hi = num_or_blank(t.get("max"))?;
        if lo.is_none() && hi.is_none() {
            return conv("範囲は、下か上の端を 1 つ以上入れてください。");
        }
        let mut out = vec![("op".to_string(), s(op))];
        if let Some(lo) = lo {
            out.push(("min".into(), lo));
            if t.get("minInc") == Some(&Tree::Bool(false)) {
                out.push(("minInc".into(), Tree::Bool(false)));
            }
        }
        if let Some(hi) = hi {
            out.push(("max".into(), hi));
            if t.get("maxInc") == Some(&Tree::Bool(false)) {
                out.push(("maxInc".into(), Tree::Bool(false)));
            }
        }
        return Ok(Tree::Obj(out));
    }
    let raw: Vec<&Tree> = match t.get("v") {
        Some(Tree::Arr(a)) => a.iter().collect(),
        Some(x) => vec![x],
        None => vec![],
    };
    let mut vs: Vec<String> = vec![];
    for x in raw.into_iter().filter(|x| !is_none(Some(x))) {
        let x = text(Some(x), VALUE_MAX)?;
        if (!x.is_empty() || op == "eq" || op == "ne") && !vs.contains(&x) {
            vs.push(x);
        }
    }
    vs.truncate(MAX_VALUES);
    if vs.is_empty() {
        let what = OPS.iter().find(|(k, _)| *k == op).map(|(_, l)| *l).unwrap_or("");
        return conv(format!("「{what}」の値を入れてください。"));
    }
    Ok(Tree::Obj(vec![("op".into(), s(op)), ("v".into(), Tree::Arr(vs.iter().map(|x| s(x)).collect()))]))
}

/// 式の入れ子の上限（版 3.106.0。Python の conversions.NEST_MAX と同じ）: 字と列の名前の外の「(」・単項の「-」・語の not の数の合計
/// （formula::nest_count）。Python の再帰の上限と窓の段の数（formula.rs の MAX_DEPTH 200）は境が違うので、どちらも同じ数え方で先に断る。
/// 90 は、かっこだけを重ねても両方が読める段（Python の道の中で約 120・窓は 99 まで）より手前。同梱の変換表の式はいちばん多くて 5
pub const NEST_MAX: usize = 90;

/// 式の入れ子の数え方（Python の conversions.nest_count → formula.nest_count）
pub fn nest_count(src: &str) -> usize {
    crate::formula::nest_count(src)
}

/// 式の読めない理由の言葉（Python の conversions._formula_error）: 正規表現の読めない理由は、re の言葉（位置など）を出さない
fn formula_error(m: &str) -> &str {
    const CUT: &str = "の正規表現として読めません";
    match m.find(CUT) {
        Some(i) => &m[..i + CUT.len()],
        None => m,
    }
}

/// 入れ子の深さで断った言葉か（窓の段の数と Python の再帰の上限は境が違うので、この種類の失敗は Python に任せる）
fn depth_error(m: &str) -> bool {
    m.contains("深すぎ")
}

/// _check_out: 出す値（= で始まれば式。式は入力の名前だけを [ ] で読める）。答えは str(o)[:500]（前後の空白は置くときに除く）
fn check_out(o: Option<&Tree>, names: &[String], place: &str) -> C<String> {
    let t: String = match o {
        None | Some(Tree::Null) => String::new(),
        Some(x) => scalar(x)?.chars().take(OUT_MAX).collect(),
    };
    if let Some(src) = t.strip_prefix('=') {
        // 式の正規表現の「読めるか」が Python の re と割れうる形（後読み）は任せる（formula::regex_split。版 3.106.0 の作った後の採点の割れ 4）
        if crate::formula::regex_split(src) {
            return Err(Bad::Delegate);
        }
        if nest_count(src) > NEST_MAX {
            return conv(format!("{place}の式の入れ子が深すぎます（かっこ・負の符号・not は合わせて {NEST_MAX} までです）。"));
        }
        match crate::formula::Formula::compile(src) {
            Err(e) => {
                let m = e.message();
                // 片割れの代用字は言葉が割れる。上限の内で窓の段の数に当たった式（起きないはず）も任せる
                if m.contains('\u{FFFD}') || depth_error(&m) {
                    return Err(Bad::Delegate);
                }
                return conv(format!("{place}の式が読めません: {}", formula_error(&m)));
            }
            Ok(f) => {
                let extra: Vec<&str> = f.columns.iter().filter(|c| !names.contains(c)).map(String::as_str).collect();
                if !extra.is_empty() {
                    return conv(format!("{place}の式は入力の名前だけを [ ] で読めます（{} は入力にありません）。", extra.join("・")));
                }
            }
        }
    }
    Ok(t)
}

/// clean_rows
fn clean_rows(v: Option<&Tree>, names: &[String]) -> C<Vec<Tree>> {
    let items = match j(v, true)? {
        Tree::Arr(a) => a,
        // 表のまま来た rows: Python は len と鍵（字）を数えるだけ（表でない行は飛ばす）
        Tree::Obj(m) => {
            if m.len() > MAX_ROWS {
                return conv(format!("判定の行は {MAX_ROWS} 行までです。"));
            }
            return Ok(vec![]);
        }
        _ => vec![],
    };
    if items.len() > MAX_ROWS {
        return conv(format!("判定の行は {MAX_ROWS} 行までです。"));
    }
    let mut out = vec![];
    for (i, r) in items.iter().enumerate() {
        if !matches!(r, Tree::Obj(_)) {
            continue;
        }
        let mut when: Vec<(String, Tree)> = vec![];
        if let Some(Tree::Obj(w)) = r.get("when") {
            for (k, ts) in w {
                if !names.contains(k) {
                    return conv(format!("{} 行目の条件の「{k}」は入力にありません。", i + 1));
                }
                let mut tests = vec![];
                if let Tree::Arr(ts) = ts {
                    for t in ts {
                        tests.push(clean_test(t)?);
                    }
                }
                tests.truncate(MAX_TESTS);
                if !tests.is_empty() {
                    when.push((k.clone(), Tree::Arr(tests)));
                }
            }
        }
        let o = check_out(r.get("out"), names, &format!("{} 行目の出す値", i + 1))?;
        out.push(Tree::Obj(vec![("when".into(), Tree::Obj(when)), ("out".into(), Tree::Str(o))]));
    }
    Ok(out)
}

/// clean_apply
fn clean_apply(v: Option<&Tree>) -> C<Tree> {
    let a = match j(v, false)? {
        x @ Tree::Obj(_) => x,
        _ => return Err(Bad::Delegate), // 並びの apply は a.get が AttributeError（Python の言葉）
    };
    let mode = label(&MODES, a.get("mode"))?.unwrap_or("add");
    let mut out = vec![("mode".to_string(), s(mode))];
    if mode == "add" {
        out.push(("column".into(), Tree::Str(text(a.get("column"), NAME_MAX * 2)?)));
        out.push(("place".into(), s(label(&PLACES, a.get("place"))?.unwrap_or("end"))));
    }
    Ok(Tree::Obj(out))
}

/// 表示順（str(int(order))。読めなければ ""。master_rows::py_int_text の 1 つ）
fn order_text(v: Option<&Tree>) -> C<String> {
    master_rows::py_int_text(v.map(Tree::to_value).as_ref()).ok_or(Bad::Delegate)
}

/// json.dumps(x, ensure_ascii=False)（既定の区切り）
fn dumps(x: Tree) -> String {
    x.dumps(", ", ": ")
}

/// clean_row: 画面から来た値（name・inputs・rows・other・apply・order）→ マスタの行。partial は直すとき（来た物だけ）
fn clean_row(data: &Tree, partial: bool) -> C<Map<String, Value>> {
    let has = |k: &str| data.get(k).is_some();
    let mut out = Map::new();
    if !partial || has("name") {
        let name = text(data.get("name"), NAME_MAX)?;
        if name.is_empty() {
            return conv("変換表の名前を入れてください。");
        }
        if name.contains('\'') && name.contains('"') {
            return conv("名前に ' と \" を両方は使えません（式の中で名前を書けなくなります）。");
        }
        out.insert("名前".into(), json!(name));
    }
    if !partial || has("inputs") || has("rows") || has("other") {
        let (inputs, names) = clean_inputs(data.get("inputs"))?;
        out.insert("入力".into(), json!(dumps(Tree::Arr(inputs))));
        out.insert("判定".into(), json!(dumps(Tree::Arr(clean_rows(data.get("rows"), &names)?))));
        out.insert("その他".into(), json!(check_out(data.get("other"), &names, "どれにも当たらないときの値")?));
    }
    if !partial || has("apply") {
        out.insert("当て方".into(), json!(dumps(clean_apply(data.get("apply"))?)));
    }
    if has("order") {
        out.insert("表示順".into(), json!(order_text(data.get("order"))?));
    }
    Ok(out)
}

/// clean_import: 書き出したファイルの表の並び → マスタの行の並び（1 つでも誤りがあれば断る・ファイルの中の同じ名前も断る）
fn clean_import(items: Option<&Tree>) -> C<Vec<Map<String, Value>>> {
    let items = match items {
        Some(Tree::Arr(a)) if !a.is_empty() => a,
        _ => return conv("取り込む変換表がありません。"),
    };
    if items.len() > MAX_IMPORT {
        return conv(format!("取り込めるのは {MAX_IMPORT} 表までです。"));
    }
    let (mut out, mut seen) = (vec![], Vec::<String>::new());
    for (i, x) in items.iter().enumerate() {
        if !matches!(x, Tree::Obj(_)) {
            return conv(format!("{} つ目は変換表の形ではありません。", i + 1));
        }
        let sub = Tree::Obj(
            ["name", "inputs", "rows", "other", "apply"].iter().map(|k| (k.to_string(), x.get(k).cloned().unwrap_or(Tree::Null))).collect(),
        );
        let row = match clean_row(&sub, false) {
            Ok(r) => r,
            Err(Bad::Delegate) => return Err(Bad::Delegate),
            Err(Bad::Conv(e)) => {
                let head = match x.get("name") {
                    n if t_truthy(n) => scalar(n.unwrap_or(&Tree::Null))?,
                    _ => format!("{} つ目", i + 1),
                };
                return conv(format!("「{head}」: {e}"));
            }
        };
        let name = row["名前"].as_str().unwrap_or("").to_string();
        if seen.contains(&name) {
            return conv(format!("ファイルの中に「{name}」が 2 つあります。"));
        }
        seen.push(name);
        out.push(row);
    }
    Ok(out)
}

/// str(v or "")（並び・表は rows_plain で前に断った）
fn s_or(v: Option<&Value>) -> String {
    v.filter(|x| truthy(x)).map(py_str).unwrap_or_default()
}

/// 名前は 1 つずつ（master_repository._check_row の conversions: 字そのままで比べる。言葉は来た名前）
fn check(rows: &[Value], data: &Map<String, Value>, self_id: Option<&PyInt>) -> Result<(), MasterError> {
    if !data.contains_key("名前") {
        return Ok(());
    }
    let name = s_or(data.get("名前"));
    if rows.iter().any(|r| !master_rows::is_self(r, self_id) && s_or(r.get("名前")) == name) {
        return Err(MasterError::Duplicate(format!("変換表「{name}」はもうあります。別の名前にしてください。")));
    }
    Ok(())
}

// ------------------------------------------------------------------ 読む
/// 読む物（置き場から。書く前に、窓が Python と同じに読めるかを確かめた物）
struct Read {
    /// 隔てた行を除いた行（版 3.107.0。一覧・書き出し・標準にする今の表）
    rows: Vec<Value>,
    /// 形をそろえた全部の行（表示順を数える・名前の重なり）と隔てた行
    all: Vec<Value>,
    iso: master_rows::Iso,
    unreadable: Option<String>,
    own: Vec<Value>,
    bundled: Vec<Value>,
}

impl Read {
    /// 標準（conversion_presets: 取り込んで標準にした表があればそれ、無ければ同梱のプリセット）
    fn presets(&self) -> &[Value] {
        if self.own.is_empty() {
            &self.bundled
        } else {
            &self.own
        }
    }
}

/// 同梱のプリセット（conversion_bundled: 読めない・無いなら []）。窓が同じに読めない形は None
fn bundled(place: &Place) -> Option<Vec<Value>> {
    let Ok(b) = std::fs::read(place.defaults.join(format!("{NAME}.json"))) else { return Some(vec![]) };
    // read_text(utf-8) と json.loads: BOM・UTF-8 でない字は ValueError（[]）
    let Ok(t) = std::str::from_utf8(&b) else { return Some(vec![]) };
    if t.starts_with('\u{FEFF}') {
        return Some(vec![]);
    }
    if master_rows::text_split_py(t) {
        return None;
    }
    let Ok(v) = serde_json::from_str::<Value>(&master_rows::inner_text(t)) else { return Some(vec![]) };
    let Value::Array(mut rows) = v else { return None }; // 表は鍵を _normalize して落ちる（Python の例外）
    if !rows.iter().all(Value::is_object) {
        return None;
    }
    master_rows::normalize_all(&mut rows, &SPEC);
    Some(rows)
}

/// 共有にまだ無いマスタに、Python が読むときと同じく最初の版を置く（MasterStore._maybe_refresh → _seed。置けなければ写しで続ける）。
/// 置くのは、Python のその道がそのマスタを読む所だけ（作った後の採点: 前はどの道でも 2 つとも置き、書き出し・断る道で Python と割れた）
pub(crate) fn seed(store: &Store, place: &Place, name: &str) {
    if place.share_absent(name) {
        store.seed_absent(&[name]);
    }
}

/// 置き場から読む（窓が同じに読めない形は None）。共有にまだ無いファイルは置かずに、写し・同梱の data/・最初の中身から読む
/// （置く版の中身と同じ。置くのは道ごとに seed で）
fn read(place: &Place) -> Option<Read> {
    // i64・u64 に入らない整数のファイルも版 3.108.0 から読む（src/held.rs が桁のまま持つ。前は Place::split_file で任せた）
    // 種はまかずに読む（Python が読む歩でだけ道ごとの seed で置く。版 3.105.0 から Place::rows は読むときに置くので rows_peek）
    let mut all = place.rows_peek(NAME).ok()?;
    let own_all = place.rows_peek(DEFAULTS).ok()?;
    // 標準の読めない行も版 3.108.0 から隔てる（Python の _list と同じ row_check::FILTERED。前は Python に任せた）
    let mut own: Vec<Value> = {
        let mut norm = own_all.clone();
        crate::row_check::normalize_like_specs(DEFAULTS, &mut norm);
        let iso = crate::row_check::check(DEFAULTS, &norm, crate::row_check::fields_of(DEFAULTS));
        own_all.into_iter().enumerate().filter(|(i, r)| r.is_object() && !crate::row_check::is_isolated(&iso, *i)).map(|(_, r)| r).collect()
    };
    master_rows::normalize_all(&mut all, &SPEC);
    // 読めない行（id・版・名前の型・判定の NaN・入れ子）は版 3.107.0 から隔てる（前は任せた）。i64 に入らない数の値は版 3.108.0 から桁のまま
    // （中身の字も bundle::conv_views が src/held.rs で読む）。標準の読めない行も隔てる（上の own。row_check::FILTERED）
    let iso = crate::row_check::check(NAME, &all, &FIELDS);
    let rows: Vec<Value> = crate::row_check::good(NAME, &all, &iso);
    let plain = |rows: &[Value]| {
        rows.iter().all(|r| r.as_object().is_some_and(|o| FIELDS.iter().all(|k| o.get(*k).is_none_or(master_rows::value_plain))))
    };
    if !plain(&rows) || !master_rows::rows_plain(DEFAULTS, &own, &FIELDS) {
        return None;
    }
    master_rows::normalize_all(&mut own, &SPEC_D);
    crate::bundle::conv_views(&rows).ok()?;
    // 標準は名前で引く・名前の集まりにするだけ（Python も並べない）。並べる道（書き出し・標準にする）は export_items が確かめて任せる
    // （版 3.108.0 の作った後の採点の割れ 3: 前は標準の字の id の行で、並べない道まで全部 Python に任せた）
    let r = Read { rows, all, iso, unreadable: place.share_problem(NAME), own, bundled: bundled(place)? };
    // 標準の名前の集まり（{r["名前"]}・sorted）: 名前の無い・字でない行は Python が落ちる
    if !r.presets().iter().all(|p| p.get("名前").is_some_and(crate::held::is_text)) {
        return None;
    }
    Some(r)
}

/// 一覧（routes/conversions._listing。標準 → 変換表の順に読む）
fn listing(store: &Store, me: &Value, place: &Place, r: &Read) -> Option<Value> {
    seed(store, place, DEFAULTS);
    seed(store, place, NAME);
    let presets: std::collections::BTreeSet<String> =
        r.presets().iter().filter_map(|p| p.get("名前").and_then(Value::as_str).map(String::from)).collect();
    let views = crate::bundle::conv_views(&r.rows).ok()?;
    let idx = crate::bundle::conv_order_index(&r.rows).ok()?;
    let items: Vec<Value> = views
        .into_iter()
        .zip(idx)
        .map(|(mut v, i)| {
            v["rev"] = r.rows[i].get("rev").cloned().unwrap_or(json!(1));
            v["preset"] = json!(v["name"].as_str().is_some_and(|n| presets.contains(n)));
            v
        })
        .collect();
    let map = |t: &[(&str, &str)]| Value::Object(t.iter().map(|(k, v)| (k.to_string(), json!(v))).collect());
    let mut out = json!({"items": items, "ops": map(&OPS), "modes": map(&MODES), "places": map(&PLACES),
                         "presets": presets.into_iter().collect::<Vec<_>>(), "customDefaults": !r.own.is_empty(),
                         "canEdit": crate::access::can_write(me, NAME), "shared": store.is_shared(NAME), "revision": store.revision(NAME)});
    crate::row_check::notes(out.as_object_mut().unwrap(), NAME, &r.all, &r.iso, r.unreadable.clone());
    Some(out)
}

/// export_items（view から id と order を除いた物を ordered の順に）
fn export_items(rows: &[Value]) -> Option<Vec<Value>> {
    let views = crate::bundle::conv_views(rows).ok()?;
    Some(
        views
            .into_iter()
            .map(|mut v| {
                if let Some(o) = v.as_object_mut() {
                    o.remove("id");
                    o.remove("order");
                }
                v
            })
            .collect(),
    )
}

// ------------------------------------------------------------------ 本文
/// 本文の読み方（get_json(force=True)〈silent でない〉 or {}）。空・読めない本文は Python（400 の HTML）。
/// 表でない真の本文は、Python が道の外で落ちる道（other_500）では任せ、master_call の中で落ちる道（足す・取り込む）は同じ答え
pub(crate) fn strict(body: &[u8], other_500: bool) -> Option<Result<Tree, Answer>> {
    // i64・u64 に入らない整数は版 3.108.0 から桁のまま読む（src/held.rs の印の字。前は Python に任せた）
    if body.iter().all(|b| b.is_ascii_whitespace()) || master_rows::unreadable_held(body) {
        return None;
    }
    let v: Value = crate::held::body_value(body)?;
    if !truthy(&v) {
        return Some(Ok(Tree::Obj(vec![])));
    }
    if v.is_object() {
        return Some(Ok(Tree::parse_bytes(body)?));
    }
    if other_500 {
        return None;
    }
    let ty = match &v {
        Value::Array(_) => "list",
        Value::String(_) => "str",
        Value::Bool(_) => "bool",
        Value::Number(n) if n.is_f64() => "float",
        _ => "int",
    };
    Some(Err((400, json!({"error": format!("'{ty}' object has no attribute 'get'"), "kind": "error", "type": "AttributeError"}))))
}

/// 開いたときの行の版（routes/common.base_rev: 本文を silent で読む・表でない真の本文は道の外で 500）。読めない版の字は None（任せる）
pub(crate) fn rev_of(body: &[u8], query: &str) -> Option<Option<Rev>> {
    let parsed = master_rows::py_body_held(body)?;
    Some(base_rev(&parsed, query))
}

// ------------------------------------------------------------------ 書く
/// 取り込みと標準の 2 回の書き込みの間に呼ぶ係（試験だけが差し替える: 後ろの書き込みを錠で止めた形を作る）
type Between = Arc<dyn Fn() + Send + Sync>;
static BETWEEN: Mutex<Option<Between>> = Mutex::new(None);

/// 試験: 取り込みで標準にもするとき、変換表を書いた後・標準を書く前に呼ぶ係を差し替える（None で外す）
pub fn set_between_writes(f: Option<Between>) {
    *BETWEEN.lock().unwrap_or_else(|e| e.into_inner()) = f;
}

/// conversion_defaults_set: 標準をこの並びに置き換える（id は 1 から・版 1・書いた人と時刻。空なら同梱のプリセットに戻る）
fn defaults_set(store: &Store, rows: &[Map<String, Value>]) -> Result<usize, MasterError> {
    store.write(DEFAULTS, |cur, stamp| {
        cur.clear();
        for (i, data) in rows.iter().enumerate() {
            let mut row = Map::new();
            row.insert("id".into(), json!(i + 1));
            for k in FIELDS {
                row.insert(k.into(), json!(master_rows::clean(data.get(k))));
            }
            row.insert("rev".into(), json!(1));
            master_rows::stamped(&mut row, stamp);
            cur.push(Value::Object(row));
        }
        Ok(cur.len())
    })
}

/// conversion_import: 同じ名前の表は中身を置き換え（表示順と位置は残し、版を 1 つ上げる）、無い名前は後ろに足す。1 回の書き込みで行う
fn import_rows(store: &Store, rows: &[Map<String, Value>]) -> Result<(usize, usize), MasterError> {
    store.write(NAME, |cur, stamp| {
        let iso = master_rows::prepare(cur, &SPEC)?;
        // {str(名前 or ""): 行}: ファイルの後ろの行が勝つ。隔てた行と同じ名前の表は取り込まない（触れる書き。版 3.107.0）
        let mut by: HashMap<String, usize> = HashMap::new();
        let mut blocked: HashMap<String, (usize, String)> = HashMap::new();
        for (i, r) in cur.iter().enumerate() {
            match iso.iter().find(|(j, _, _)| *j == i) {
                Some((_, n, why)) => {
                    blocked.insert(s_or(r.get("名前")), (*n, why.clone()));
                }
                None => {
                    by.insert(s_or(r.get("名前")), i);
                }
            }
        }
        if let Some((n, why)) = rows.iter().find_map(|d| blocked.get(&s_or(d.get("名前")))) {
            return Err(crate::row_check::refuse_row(NAME, *n, why));
        }
        let bad = |m: &str| MasterError::Error(m.to_string());
        let mut top: i128 =
            master_rows::next_order(cur).and_then(|t| t.parse::<i128>().ok()).ok_or_else(|| bad("表示順が読めません"))? - 10;
        let (mut added, mut replaced) = (0, 0);
        for data in rows {
            let name = s_or(data.get("名前"));
            if let Some(&i) = by.get(&name) {
                let old = cur[i].as_object_mut().ok_or_else(|| bad("行の形が違います"))?;
                for k in FIELDS {
                    if data.contains_key(k) && k != "表示順" {
                        old.insert(k.into(), json!(master_rows::clean(data.get(k))));
                    }
                }
                let rev = old.get("rev").map(|v| master_rows::py_int(v).ok_or_else(|| bad("版が読めません"))).transpose()?.unwrap_or(1);
                old.insert("rev".into(), json!(rev + 1));
                master_rows::stamped(old, stamp);
                replaced += 1;
            } else {
                top += 10;
                let mut row = Map::new();
                row.insert("id".into(), json!(next_id(cur)));
                for k in FIELDS {
                    row.insert(k.into(), json!(master_rows::clean(data.get(k))));
                }
                row.insert("表示順".into(), json!(top.to_string()));
                row.insert("rev".into(), json!(1));
                master_rows::stamped(&mut row, stamp);
                cur.push(Value::Object(row));
                by.insert(name, cur.len() - 1);
                added += 1;
            }
        }
        Ok((added, replaced))
    })
}

/// 窓が受ける 8 本を答える（門番は呼ぶ側が通した）。窓が答えない形は None
pub fn handle(store: &Store, me: &Value, place: &Place, route: Route, query: &str, body: &[u8]) -> Option<Answer> {
    let r = read(place)?;
    // 書いた後の一覧（読み直せなければ、書いたことだけを知らせる。None を返すと Python がもう一度書く）
    let done = |status: u16, extra: Value| -> Option<Answer> {
        let Some(mut v) = read(place).and_then(|now| listing(store, me, place, &now)) else {
            return Some((
                503,
                json!({"error": "保存しましたが、読み直せませんでした。画面を開き直してください。", "kind": "reread", "saved": true}),
            ));
        };
        for (k, x) in extra.as_object().into_iter().flatten() {
            v[k] = x.clone();
        }
        Some((status, v))
    };
    match route {
        Route::List => Some((200, listing(store, me, place, &r)?)),
        Route::Export => {
            let q = crate::lotlist::parse_query(query);
            let which = q.iter().find(|(k, _)| k == "which").map(|(_, v)| v.as_str());
            let defaults = which == Some("defaults");
            let rows = if defaults { r.presets() } else { &r.rows };
            let items = export_items(rows)?;
            seed(store, place, if defaults { DEFAULTS } else { NAME }); // which で読むマスタは 1 つ
            Some((200, json!({"items": items})))
        }
        Route::Create => {
            let d = match strict(body, false)? {
                Ok(d) => d,
                Err(a) => return Some(a),
            };
            let mut row = match clean_row(&d, false) {
                Ok(row) => row,
                Err(Bad::Delegate) => return None,
                Err(Bad::Conv(m)) => return Some(conv_error(m)),
            };
            if strip(&s_or(row.get("表示順"))).is_empty() {
                let order = master_rows::next_order(&r.all)?; // 隔てた行の表示順も数える（Python の next_order(self.conversions())）
                seed(store, place, NAME); // conversion_create は表示順を数えるために変換表を読む
                row.insert("表示順".into(), json!(order));
            }
            match master_rows::create(store, &SPEC, &row, &check) {
                Ok(made) => done(201, json!({"created": made.get("id").cloned().unwrap_or(Value::Null)})),
                Err(e) => Some(of_master(e)),
            }
        }
        Route::Update(id) => {
            let base = rev_of(body, query)?;
            let d = strict(body, true)?.ok()?;
            let d = match d {
                Tree::Obj(m) => Tree::Obj(m.into_iter().filter(|(k, _)| k != "base_rev").collect()),
                x => x,
            };
            let row = match clean_row(&d, true) {
                Ok(row) => row,
                Err(Bad::Delegate) => return None,
                Err(Bad::Conv(m)) => return Some(conv_error(m)),
            };
            match master_rows::update(store, &SPEC, &id, &row, base, &check) {
                Ok(_) => done(200, json!({})),
                Err(e) => Some(of_master(e)),
            }
        }
        Route::Preset(id) => {
            let base = rev_of(body, query)?;
            seed(store, place, NAME); // 行を探す（repo.find: 隔てた行なら書かない）
            if let Err(e) = crate::row_check::guard(NAME, &r.all, &r.iso, &id) {
                return Some(of_master(e));
            }
            let Some(row) = r.rows.iter().find(|x| master_rows::same_id(x, &id)) else {
                return Some((
                    404,
                    json!({"error": "その変換表はもうありません（ほかの PC が消した可能性があります）。", "kind": "not_found"}),
                ));
            };
            let raw = row.get("名前").cloned().unwrap_or(Value::Null);
            seed(store, place, DEFAULTS); // 標準を読む（conversion_presets）
            let preset = match &raw {
                Value::String(n) => r.presets().iter().find(|p| s_or(p.get("名前")) == *n),
                _ => None,
            };
            let Some(preset) = preset else {
                return Some((
                    400,
                    json!({"error": format!("「{}」は同梱のプリセットにありません（標準に戻せるのはプリセットの表だけです）。", py_str(&raw))}),
                ));
            };
            let mut data = Map::new();
            for k in ["入力", "判定", "その他", "当て方"] {
                let v = preset.get(k)?; // 列の無い標準は Python が道の外で落ちる（KeyError）
                if !master_rows::value_plain(v) {
                    return None;
                }
                data.insert(k.into(), v.clone());
            }
            match master_rows::update(store, &SPEC, &id, &data, base, &check) {
                Ok(_) => done(200, json!({})),
                Err(e) => Some(of_master(e)),
            }
        }
        Route::Delete(id) => {
            let base = rev_of(body, query)?;
            match master_rows::delete(store, &SPEC, &id, base) {
                Ok(()) => done(200, json!({})),
                Err(e) => Some(of_master(e)),
            }
        }
        Route::Import => {
            let d = match strict(body, false)? {
                Ok(d) => d,
                Err(a) => return Some(a),
            };
            let rows = match clean_import(d.get("items")) {
                Ok(rows) => rows,
                Err(Bad::Delegate) => return None,
                Err(Bad::Conv(m)) => return Some(conv_error(m)),
            };
            master_rows::next_order(&r.all)?; // 書く前に、窓が表示順を Python と同じに数えられるか
            let (added, replaced) = match import_rows(store, &rows) {
                Ok(x) => x,
                Err(e) => return Some(of_master(e)),
            };
            if t_truthy(d.get("asDefault")) {
                let hook = BETWEEN.lock().unwrap_or_else(|e| e.into_inner()).clone();
                if let Some(f) = hook {
                    f();
                }
                // 後ろ（標準）が書けなければ、前（変換表）は書けたまま断りを返す（Python と同じ 2 回の書き込み）
                if let Err(e) = defaults_set(store, &rows) {
                    return Some(of_master(e));
                }
            }
            done(200, json!({"added": added, "replaced": replaced}))
        }
        Route::Defaults => {
            let d = strict(body, true)?.ok()?;
            let which = match d.get("from") {
                Some(Tree::Str(w)) if w == "current" || w == "bundled" => w.clone(),
                _ => return Some((400, json!({"error": "from は current か bundled です。"}))),
            };
            let rows: Vec<Map<String, Value>> = if which == "current" {
                crate::bundle::conv_order_index(&r.rows)
                    .ok()?
                    .into_iter()
                    .map(|i| FIELDS.iter().filter_map(|k| r.rows[i].get(*k).map(|v| (k.to_string(), v.clone()))).collect())
                    .collect()
            } else {
                vec![]
            };
            if which == "current" {
                seed(store, place, NAME); // 今の表を読む（repo.conversions()）
            }
            match defaults_set(store, &rows) {
                Ok(_) => done(200, json!({})),
                Err(e) => Some(of_master(e)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_and_ids_are_like_python() {
        assert_eq!(route_of("GET", "/api/masters/conversions"), Some(Route::List));
        assert_eq!(route_of("GET", "/api/masters/conversions/export"), Some(Route::Export));
        assert_eq!(route_of("POST", "/api/masters/conversions/import"), Some(Route::Import));
        assert_eq!(route_of("POST", "/api/masters/conversions/defaults"), Some(Route::Defaults));
        assert_eq!(route_of("PUT", "/api/masters/conversions/０7"), Some(Route::Update(PyInt::Small(7))));
        assert_eq!(route_of("POST", "/api/masters/conversions/3/preset"), Some(Route::Preset(PyInt::Small(3))));
        assert_eq!(route_of("DELETE", "/api/masters/conversions/12"), Some(Route::Delete(PyInt::Small(12))));
        assert_eq!(route_of("PUT", "/api/masters/conversions/export"), None);
        assert_eq!(route_of("POST", "/api/masters/conversions/3"), None);
        assert_eq!(route_of("GET", "/api/masters/conversions/3"), None);
        assert_eq!(
            route_of("PUT", "/api/masters/conversions/99999999999999999999"),
            Some(Route::Update(PyInt::Big("99999999999999999999".into()))),
            "i64 に入らない id も桁のまま（版 3.108.0）"
        );
    }

    #[test]
    fn rows_keep_the_sent_order_and_python_text() {
        // Python: json.dumps(clean_rows(…), ensure_ascii=False)。when の鍵は送った順・同じ鍵は後ろの値を前の位置へ
        let body = Tree::parse(
            r#"{"name": " 表 ", "inputs": [{"name": "b"}, {"name": "a", "type": "num", "columns": ["A列", "", 5, false]}],
                "rows": [{"when": {"b": [{"op": "eq", "v": [0, false, "", 1.0, "x", "x"]}], "a": [{"op": "range", "min": "１,000", "max": "-0", "maxInc": false}],
                          "b": [{"op": "empty"}]}, "out": 1e16}, 5],
                "other": " =[a] ", "apply": {"mode": "add", "column": 0, "place": "x"}, "order": "１２"}"#,
        )
        .unwrap();
        let row = clean_row(&body, false).ok().unwrap();
        assert_eq!(row["名前"], json!("表"));
        assert_eq!(
            row["入力"],
            json!(r#"[{"name": "b", "type": "text", "columns": ["b"]}, {"name": "a", "type": "num", "columns": ["A列", "5", "False"]}]"#)
        );
        assert_eq!(
            row["判定"],
            json!(
                r#"[{"when": {"b": [{"op": "empty"}], "a": [{"op": "range", "min": 1000, "max": 0, "maxInc": false}]}, "out": "1e+16"}]"#
            )
        );
        assert_eq!(row["その他"], json!(" =[a] "), "出す値は切らずに置く（置くときに前後の空白を除く）");
        assert_eq!(row["当て方"], json!(r#"{"mode": "add", "column": "0", "place": "end"}"#));
        assert_eq!(row["表示順"], json!("12"));
        let eq = Tree::parse(r#"{"op": "eq", "v": [0, false, "", 1.0, "x", "x", null]}"#).unwrap();
        assert_eq!(clean_test(&eq).ok().unwrap().dumps(", ", ": "), r#"{"op": "eq", "v": ["0", "False", "", "1.0", "x"]}"#);
        let bad = |t: &str| match clean_test(&Tree::parse(t).unwrap()) {
            Err(Bad::Conv(m)) => m,
            Err(Bad::Delegate) => "任せる".into(),
            Ok(x) => x.dumps(", ", ": "),
        };
        assert_eq!(bad(r#"{"op": "range", "min": true}"#), "範囲の端は数で入れてください（True）。");
        assert_eq!(bad(r#"{"op": "range", "min": "nan"}"#), "範囲の端は数で入れてください（nan）。");
        // 2^63 以上の整数も Python の int と同じく桁のまま（版 3.108.0。前は任せた）
        assert_eq!(bad(r#"{"op": "range", "min": "1e19"}"#), r#"{"op": "range", "min": 10000000000000000000}"#);
        assert_eq!(bad(r#"{"op": "range", "min": "1e20"}"#), r#"{"op": "range", "min": 100000000000000000000}"#);
        assert_eq!(bad(r#"{"op": ["eq"]}"#), "任せる", "unhashable は Python");
        assert_eq!(bad(r#"{"op": "starts", "v": ["", null]}"#), "「で始まる」の値を入れてください。");
    }
}
