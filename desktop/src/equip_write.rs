//! 現場のマスタ（設備・ロール）の道（版 3.77.0）。Python の `routes/masters.py` の 8 本を窓が受ける:
//!
//! ```text
//! GET    /api/masters/equipment        … 一覧（行の並び。旧い列名 巻出し方向 は 巻取方向 に読み替える・版の無い行は 1）
//! POST   /api/masters/equipment        … 足す（201・足した行。設備名は必須・1 つずつ・同一工程の名前の確かめ）
//! PUT    /api/masters/equipment/<id>   … 直す（直した行。本文 base_rev は開いたときの行の版）
//! DELETE /api/masters/equipment/<id>   … 消す（{status, id}。?rev= は開いたときの行の版）
//! （/api/masters/rolls も同じ 4 本。設備が必須・一意も確かめも無い）
//! ```
//!
//! 決まりは Python と同じ（評価関数: tests/equip_rows_parity.rs ← program/tests/equip_rows_oracle.py）:
//! - 行の書き方は共通の型（src/master_rows.rs。SPECS["equipment_master"]・["roll_master"]）。値は str(v).strip() の字で置く
//! - 設備の確かめ（equipment_names.check_row の 3 つの言葉）は計算の読み替えと同じ部品（calc::equipment_check）
//! - 本文も版も Content-Type によらず読む（Python も版 3.77.0 から同じ。routes/common.base_rev）
//!
//! 窓が答えず Python に任せる形: 窓が読めない・読みが割れる数のある本文（master_rows::unreadable_u64_ok。版 3.105.0 から u64 に入る整数は答える）・空の本文・足す道の表でない本文・
//! 項目の値が並び・表のとき（Python の str() の書き方〈[1, 2]〉）・置き場の行の項目が並び・表のとき・版の番号に 10 進でない数の字があるとき。

use crate::master_rows::{self, base_rev, Spec};
use crate::master_store::{MasterError, Store};
use crate::pyfmt::PyInt;
use crate::worksum::truthy;
use serde_json::{json, Map, Value};

const EQUIP_FIELDS: [&str; 5] = ["設備名", "巻取方向", "ライン方向", "同一工程", "検査計"];
const ROLL_FIELDS: [&str; 14] = [
    "設備",
    "入出位置",
    "接触面",
    "ロール径MAX",
    "ロール径MIN",
    "ロール面長",
    "材質",
    "硬度",
    "本数",
    "ロール名",
    "ロール使用条件",
    "駆動方式",
    "基準番号",
    "備考",
];
const EQUIP: Spec =
    Spec { name: "equipment_master", fields: &EQUIP_FIELDS, unique: Some("設備名"), renamed: &[("巻出し方向", "巻取方向")] };
const ROLLS: Spec = Spec { name: "roll_master", fields: &ROLL_FIELDS, unique: None, renamed: &[] };

/// どちらのマスタか（routes/masters.MASTER_APIS: 道の名前・必須の列）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Equipment,
    Rolls,
}

impl Kind {
    fn spec(self) -> &'static Spec {
        match self {
            Kind::Equipment => &EQUIP,
            Kind::Rolls => &ROLLS,
        }
    }

    fn required(self) -> &'static str {
        match self {
            Kind::Equipment => "設備名",
            Kind::Rolls => "設備",
        }
    }

    /// 置き場のマスタの名前（access::Place::rows・門番の名前）
    pub fn name(self) -> &'static str {
        self.spec().name
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Route {
    List(Kind),
    Create(Kind),
    Update(Kind, PyInt),
    Delete(Kind, PyInt),
}

impl Route {
    pub fn kind(&self) -> Kind {
        match self {
            Route::List(k) | Route::Create(k) | Route::Update(k, _) | Route::Delete(k, _) => *k,
        }
    }
}

/// 窓が受ける道か（Python の <int:item_id> は数字だけ）
pub fn route_of(method: &str, path: &str) -> Option<Route> {
    let (kind, rest) = match path.strip_prefix("/api/masters/equipment") {
        Some(r) => (Kind::Equipment, r),
        None => (Kind::Rolls, path.strip_prefix("/api/masters/rolls")?),
    };
    match (method, rest) {
        ("GET", "") => Some(Route::List(kind)),
        ("POST", "") => Some(Route::Create(kind)),
        (m @ ("PUT" | "DELETE"), r) => {
            let id = r.strip_prefix('/')?;
            // Python の <int:…>（\d+: 全角・アラビア文字などの数字も）。版 3.108.0 から i64 に入らない id も桁のまま（PyInt）
            let id = crate::pyfmt::path_int(id)?;
            Some(if m == "PUT" { Route::Update(kind, id) } else { Route::Delete(kind, id) })
        }
        _ => None,
    }
}

type Answer = (u16, Value);

/// master_call の答え（MasterError は状態と payload・そのほかの例外は 400 と例外の種類）
fn of_master(e: MasterError) -> Answer {
    (e.status(), e.payload())
}

fn value_error(msg: String) -> Answer {
    (400, json!({"error": msg, "kind": "error", "type": "ValueError"}))
}

/// Python の str() が JSON と違う書き方になる値（並び・表）
fn awkward(v: &Value) -> bool {
    v.is_array() || v.is_object()
}

/// 置き場の行（隔てた行を除く）の項目〈旧い列名も〉の値を窓が Python の str() と同じ字に書けるか（i64・u64 に入らない整数は版 3.108.0 から
/// src/held.rs が桁のまま持つ。残るのは serde が小数に丸めた形だけ。id・版・並び・表は版 3.107.0 から row_check が隔てる）
fn readable(rows: &[Value], spec: &Spec) -> bool {
    let fields: Vec<&str> = spec.fields.iter().copied().chain(spec.renamed.iter().map(|(old, _)| *old)).collect();
    rows.iter().all(|r| r.as_object().is_some_and(|o| fields.iter().all(|k| o.get(*k).is_none_or(master_rows::value_plain_or_container))))
}

/// 必須の列が空か（routes/masters._blank: null も空。0・False は空でない）
fn blank(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(x) => crate::pyfmt::strip(&crate::worksum::py_str(x)).is_empty(),
    }
}

/// 窓が受ける 4 本を答える（門番は呼ぶ側が通した）。rows は書く前の置き場の行（一覧と確かめに使う）。窓が答えない形は None
pub fn handle(store: &Store, route: Route, query: &str, body: &[u8], rows: &[Value]) -> Option<Answer> {
    let kind = route.kind();
    let spec = kind.spec();
    // 表でない行（版 3.102.0 の作った後の採点の割れ 1）: 一覧は読める行だけで答え（Python と同じ。読めない行はマスタの置き場の状態の badRows が言う）、
    // 書く道は断る（前は Python に任せた）
    let bad = master_rows::bad_rows(rows);
    // 読めない行（id・版・項目の型・数でない値）は隔てる（版 3.107.0。前は任せた）。一覧は隔てた行を除いて答え（行の並びのまま。
    // 隔てた行はマスタの置き場の状態の skipped が言う）、書く道は隔てた行に触れる直す・消すだけを断る（master_rows::prepare）
    let mut all = rows.to_vec();
    master_rows::normalize_all(&mut all, spec);
    let iso = crate::row_check::check(spec.name, &all, spec.fields);
    let good: Vec<Value> = crate::row_check::good(spec.name, &all, &iso);
    let rows = good.as_slice();
    if !readable(rows, spec) {
        return None;
    }
    if let Route::List(_) = route {
        return Some((200, Value::Array(good)));
    }
    let blank_body = body.iter().all(|b| b.is_ascii_whitespace());
    // i64・u64 に入らない整数は版 3.108.0 から桁のまま読む（src/held.rs。値は str() の字〈master_rows::clean〉にしか使わない）
    if master_rows::unreadable_held(body) {
        return None;
    }
    let parsed: Value = if blank_body { Value::Null } else { crate::held::body_value(body)? };
    // 直す・消す道は先に routes/common.base_rev が本文を読む: 表でない本文（並び・字・数）は 500（行は書かない。Python も版 3.77.0 から同じ）。
    // 答えの本文は窓では {error, kind}、Python では道の外の例外なので枠の 500 の頁（画面は表でない本文を送らないので画面には出ない）
    if matches!(route, Route::Update(..) | Route::Delete(..)) && truthy(&parsed) && !parsed.is_object() {
        return Some((500, json!({"error": "本文の形が違います", "kind": "error"})));
    }
    let empty = Map::new();
    let obj = parsed.as_object().unwrap_or(&empty);
    let base = match route {
        Route::Update(..) | Route::Delete(..) => base_rev(&parsed, query),
        _ => None,
    };
    let name = spec.name;
    if let Route::Delete(_, id) = &route {
        if let Err(e) = master_rows::refuse_bad_rows(name, &bad) {
            return Some(of_master(e));
        }
        return Some(match master_rows::delete(store, spec, id, base) {
            Ok(()) => (200, json!({"status": "deleted", "id": crate::held::int_value(id)})),
            Err(e) => of_master(e),
        });
    }
    // 足す・直す道の本文は get_json(force=True): 空の本文は Flask の 400、表でない本文は Python の例外（窓は答えない）
    if blank_body || (truthy(&parsed) && !parsed.is_object()) {
        return None;
    }
    if spec.fields.iter().any(|k| obj.get(*k).is_some_and(awkward)) {
        return None;
    }
    let mut data = obj.clone();
    data.remove("base_rev");
    let req = kind.required();
    if (data.contains_key(req) || route == Route::Create(kind)) && blank(data.get(req)) {
        return Some(value_error(format!("{req}は必須です。")));
    }
    let check = |rows: &[Value], d: &Map<String, Value>, self_id: Option<&PyInt>| -> Result<(), MasterError> {
        match kind {
            Kind::Equipment => crate::calc::equipment_check(rows, d, self_id).map_or(Ok(()), |m| Err(MasterError::Invalid(m))),
            Kind::Rolls => Ok(()),
        }
    };
    if let Err(e) = master_rows::refuse_bad_rows(name, &bad) {
        return Some(of_master(e));
    }
    let done = match route {
        Route::Create(_) => master_rows::create(store, spec, &data, &check).map(|v| (201, v)),
        Route::Update(_, id) => master_rows::update(store, spec, &id, &data, base, &check).map(|v| (200, v)),
        _ => unreachable!(),
    };
    Some(done.unwrap_or_else(of_master))
}
