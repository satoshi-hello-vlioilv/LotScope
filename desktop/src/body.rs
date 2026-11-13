//! 問い合わせの本文の読み方と、書く道の本文の門（版 3.104.0。Rust 化の段 ① の A）。Python の services/body_rules.py と同じ決まりを 1 か所に持つ。
//!
//! 本文（バイト）を読む部品は 1 つ（read）で、違いは引数（Rules）で分ける:
//! - GATE_READ … 書く道の門（空・null は通す。Python は前の get_json(silent=True) の道）
//! - GATE_NEED … 書く道の門（本文が要る道。空は断る。前の get_json(force=True) の道）
//! - LOTDSP    … LotDsp の 9 本（版 3.98.0 の read_body。NaN を通す・入れ子 64 段まで・対の無い代用字は U+FFFD）
//!
//! 見る順: 空 → UTF-8 → 入れ子の段（字の外の [ {）→ JSON（pyjson::loads。Python の json.loads と同じ・4,300 桁を超える整数は断る）→
//! NaN・Infinity・1e400 → 対の無い代用字 → 表でない本文。断る言葉は日本語の {error, kind: "body"}（400）。
//!
//! 門を当てる道は src/body_routes.json（Python の services/body_rules.py の ROUTES を tools/body-routes.py が Python の道の並びのまま焼いた表）。
//! 門は Lot::handle_body のいちばん前（Python は前の係〈門番〉の列のいちばん前）。通った本文は、整数の -0 を 0 に書き直す
//! （Python の json.loads は int の 0、serde_json は小数の -0.0 に読むので、前は窓が任せていた）。i64 に入らない整数は書き直さず、
//! 部品が今までどおり任せる（部品の値〈serde_json〉が桁を持てない）。
//! 評価関数: cargo test --test body_cases（← program/tests/fixtures/body_cases.json。仕様から人が書いた事例の表を Python と同じに読む）・
//! 本文の門を当てた道の *_parity。

use crate::pyjson::{self, J};
use serde_json::{json, Value};
use std::borrow::Cow;
use std::sync::OnceLock;

pub const E_BLANK: &str = "本文が空です（表で送ってください）。";
pub const E_UTF8: &str = "本文を UTF-8 として読めません。";
pub const E_DEPTH: &str = "本文の入れ子が深すぎます。";
pub const E_JSON: &str = "本文を JSON として読めません。";
pub const E_NONFINITE: &str = "本文に NaN・Infinity か、大きすぎて読めない数があります（数で送ってください）。";
pub const E_SURROGATE: &str = "本文の字に対の無い代用字（\\ud800 など）があります。";
pub const E_SHAPE: &str = "本文の形が違います（表で送ってください）。";

/// 読み方の引数（Python の body_rules.Rules と同じ名前）
#[derive(Debug, Clone, Copy)]
pub struct Rules {
    /// 空白（JSON の空白 4 字）だけの本文も空と読む（偽なら 0 バイトだけが空）
    pub blank_ws: bool,
    /// 空の本文を通す（偽なら E_BLANK）
    pub blank_ok: bool,
    /// 入れ子の段の上限
    pub max_depth: usize,
    /// NaN・Infinity・1e400 を通す
    pub allow_nan: bool,
    /// 対の無い代用字を断る（偽なら U+FFFD に替えて通す）
    pub refuse_surrogates: bool,
    /// 偽の値（null・[]・0・""・false）をそのまま通す（偽なら null だけ {}、ほかは E_SHAPE）
    pub falsy_passes: bool,
}

/// 門の入れ子の上限（serde_json が読むのをやめる 128 段の 1 段手前。版 3.103.0 までの窓が Python と同じに答えた段）
pub const GATE_DEPTH: usize = 127;
pub const GATE_READ: Rules =
    Rules { blank_ws: true, blank_ok: true, max_depth: GATE_DEPTH, allow_nan: false, refuse_surrogates: true, falsy_passes: true };
pub const GATE_NEED: Rules = Rules { blank_ok: false, ..GATE_READ };
pub const LOTDSP: Rules =
    Rules { blank_ws: false, blank_ok: true, max_depth: 64, allow_nan: true, refuse_surrogates: false, falsy_passes: false };

/// 本文の入れ子が limit 段までか（字の中の括弧は数えない）
pub fn depth_ok(text: &str, limit: usize) -> bool {
    let (mut depth, mut in_str, mut esc) = (0i64, false, false);
    for ch in text.chars() {
        if in_str {
            if esc {
                esc = false;
            } else if ch == '\\' {
                esc = true;
            } else if ch == '"' {
                in_str = false;
            }
        } else if ch == '"' {
            in_str = true;
        } else if ch == '[' || ch == '{' {
            depth += 1;
            if depth > limit as i64 {
                return false;
            }
        } else if ch == ']' || ch == '}' {
            depth -= 1;
        }
    }
    true
}

fn nonfinite(v: &J) -> bool {
    match v {
        J::Float(f) => !f.is_finite(),
        J::Arr(a) => a.iter().any(nonfinite),
        J::Obj(m) => m.iter().any(|(_, x)| nonfinite(x)),
        _ => false,
    }
}

/// 本文（バイト）→ 値（Python の body_rules.read_body）。空は J::Null（falsy_passes のとき。ほかは {}）。読めなければ断る言葉
pub fn read(raw: &[u8], r: &Rules) -> Result<J, &'static str> {
    if raw.is_empty() || (r.blank_ws && raw.iter().all(|b| matches!(b, b' ' | b'\t' | b'\n' | b'\r'))) {
        if !r.blank_ok {
            return Err(E_BLANK);
        }
        return Ok(if r.falsy_passes { J::Null } else { J::obj() });
    }
    let Ok(text) = std::str::from_utf8(raw) else { return Err(E_UTF8) };
    if !depth_ok(text, r.max_depth) {
        return Err(E_DEPTH);
    }
    let (v, lone) = pyjson::loads_flagged(text).map_err(|_| E_JSON)?;
    if !r.allow_nan && nonfinite(&v) {
        return Err(E_NONFINITE);
    }
    if r.refuse_surrogates && lone {
        return Err(E_SURROGATE);
    }
    if r.falsy_passes {
        if v.truthy() && !v.is_obj() {
            return Err(E_SHAPE);
        }
        return Ok(v);
    }
    match v {
        J::Null => Ok(J::obj()),
        J::Obj(_) => Ok(v),
        _ => Err(E_SHAPE),
    }
}

// ------------------------------------------------------------------ 書く道の門

/// 門の答え: 通す（部品へ渡す本文。整数の -0 を書き直したときだけ新しい字）か、断る（状態・答え）
pub enum Gate<'a> {
    Pass(Cow<'a, [u8]>),
    Refuse(u16, Value),
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Lit(Vec<char>),
    /// <int:…>（Python の \d+: Unicode の 10 進数字）
    Int,
    /// <…>・<string:…>（[^/]+）
    Seg,
    /// <path:…>（[^/].*?。1 字目は / 以外〈改行も当たる〉、2 字目から先は改行以外〈Python の re の . 〉）
    Path,
}

struct RouteRule {
    toks: Vec<Tok>,
    /// 方法 → need・read・skip
    modes: Vec<(String, String)>,
    /// 方法 → 欄の型の並び（[欄の道, 型]。版 3.106.0。Python の body_rules.TYPES を焼いた物）
    types: Vec<(String, Vec<(String, String)>)>,
}

fn tokens(pattern: &str) -> Vec<Tok> {
    let mut out = vec![];
    let mut lit = vec![];
    let cs: Vec<char> = pattern.chars().collect();
    let mut i = 0;
    while i < cs.len() {
        if cs[i] == '<' {
            if let Some(j) = cs[i..].iter().position(|c| *c == '>') {
                if !lit.is_empty() {
                    out.push(Tok::Lit(std::mem::take(&mut lit)));
                }
                let inner: String = cs[i + 1..i + j].iter().collect();
                out.push(match inner.split_once(':').map(|(k, _)| k) {
                    Some("int") => Tok::Int,
                    Some("path") => Tok::Path,
                    _ => Tok::Seg,
                });
                i += j + 1;
                continue;
            }
        }
        lit.push(cs[i]);
        i += 1;
    }
    if !lit.is_empty() {
        out.push(Tok::Lit(lit));
    }
    out
}

/// 道の形に全部が当たるか（Python の Rule.regex と同じ。変数の段は短い順に試す）
fn matches(toks: &[Tok], s: &[char]) -> bool {
    let Some((t, rest)) = toks.split_first() else { return s.is_empty() };
    match t {
        Tok::Lit(l) => s.starts_with(l) && matches(rest, &s[l.len()..]),
        Tok::Int => (1..=s.len()).take_while(|k| crate::pyfmt::digit(s[k - 1]).is_some()).any(|k| matches(rest, &s[k..])),
        Tok::Seg => (1..=s.len()).take_while(|k| s[k - 1] != '/').any(|k| matches(rest, &s[k..])),
        // 版 3.104.0 の作った後の採点: 前は 2 字目から先の改行にも当てていた（Python は門を当てず門番が 403、窓は門が 400）
        Tok::Path => {
            !s.is_empty() && s[0] != '/' && (1..=s.len()).take_while(|k| *k == 1 || s[k - 1] != '\n').any(|k| matches(rest, &s[k..]))
        }
    }
}

fn table() -> &'static [RouteRule] {
    static T: OnceLock<Vec<RouteRule>> = OnceLock::new();
    T.get_or_init(|| {
        let v: Value = serde_json::from_str(include_str!("body_routes.json")).expect("body_routes.json");
        v["rules"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|r| RouteRule {
                        toks: tokens(r["rule"].as_str().unwrap_or("")),
                        modes: r["modes"]
                            .as_object()
                            .map(|m| m.iter().map(|(k, x)| (k.clone(), x.as_str().unwrap_or("skip").to_string())).collect())
                            .unwrap_or_default(),
                        types: r["types"]
                            .as_object()
                            .map(|m| {
                                m.iter()
                                    .map(|(k, x)| {
                                        let pairs = x
                                            .as_array()
                                            .into_iter()
                                            .flatten()
                                            .filter_map(|p| Some((p.get(0)?.as_str()?.to_string(), p.get(1)?.as_str()?.to_string())));
                                        (k.clone(), pairs.collect())
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// 百分率符号を戻した道（Python の web.App.handle の urllib.parse.unquote: UTF-8 として読めないバイトは U+FFFD）
pub fn unquote(path: &str) -> String {
    let b = path.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        // 「%」の後ろの 16 進の 2 字だけを戻す（Python の unquote。前は u8::from_str_radix が「+1」を 1 と読んだ）
        if b[i] == b'%' && i + 2 < b.len() && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            let h = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|x| u8::from_str_radix(x, 16).ok());
            if let Some(x) = h {
                out.push(x);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// この道に当たる表の行（表の並びで、形と方法が合う最初の道。Python の dispatch と同じ）
fn rule_of(method: &str, path: &str) -> Option<&'static RouteRule> {
    let s: Vec<char> = unquote(path).chars().collect();
    table().iter().find(|r| r.modes.iter().any(|(k, _)| k == method) && matches(&r.toks, &s))
}

/// この道に当てる門（"need"・"read"。当てない道は None）。道の当たり方は Python の dispatch と同じ（表の並びで、形と方法が合う最初の道）
pub fn mode_of(method: &str, path: &str) -> Option<&'static str> {
    let r = rule_of(method, path)?;
    match r.modes.iter().find(|(k, _)| k == method)?.1.as_str() {
        "need" => Some("need"),
        "read" => Some("read"),
        _ => None,
    }
}

// ------------------------------------------------------------------ 欄の型と中身の欄（版 3.106.0。Python の body_rules.TYPES・check_types）

/// 欄の型の違いの言葉（Python の type_message）
pub fn type_message(path: &str, kind: &str) -> String {
    match kind {
        "s" => format!("本文の「{path}」は字で送ってください（並び・表は送れません）。"),
        "l" => format!("本文の「{path}」は並びで送ってください。"),
        _ => format!("本文の「{path}」は表で送ってください（並びは送れません）。"),
    }
}

fn type_bad(v: &J, kind: &str) -> bool {
    match kind {
        "s" => matches!(v, J::Arr(_) | J::Obj(_)),
        "l" => matches!(v, J::Bool(_) | J::Int(_) | J::Big(_) | J::Float(_) | J::Obj(_)),
        "o" => matches!(v, J::Arr(_)),
        _ => false,
    }
}

/// 欄の道に当たる値（文書の順。Python の _values と同じ: 「a」は表の鍵・「a[]」は並びの各値・「*」は表の全部の値）
fn values<'a>(root: &'a J, path: &str) -> Vec<&'a J> {
    let mut cur: Vec<&J> = vec![root];
    for seg in path.split('.') {
        let (name, arr) = match seg.strip_suffix("[]") {
            Some(n) => (n, true),
            None => (seg, false),
        };
        let mut next = vec![];
        for c in cur {
            let J::Obj(m) = c else { continue };
            let vals: Vec<&J> = if name == "*" { m.iter().map(|(_, v)| v).collect() } else { c.get(name).into_iter().collect() };
            for v in vals {
                if arr {
                    if let J::Arr(a) = v {
                        next.extend(a.iter());
                    }
                } else {
                    next.push(v);
                }
            }
        }
        cur = next;
    }
    cur
}

/// 中身の欄の JSON の字 → 値（Python の read_inner。JSON として読めなければ Ok(None)＝道に任せる）。門と同じ決まりで断る
pub fn read_inner(text: &str) -> Result<Option<J>, &'static str> {
    if !depth_ok(text, GATE_DEPTH) {
        return Err(E_DEPTH);
    }
    let Ok((v, lone)) = pyjson::loads_flagged(text) else { return Ok(None) };
    if nonfinite(&v) {
        return Err(E_NONFINITE);
    }
    if lone {
        return Err(E_SURROGATE);
    }
    Ok(Some(v))
}

/// 欄の型と中身の欄の門（Python の check_types）。通れば、中身の欄の字に整数の -0 があったか（窓は 0 に書き直して部品へ渡す）
fn check_types(spec: &[(String, String)], body: &mut J) -> Result<bool, String> {
    let J::Obj(_) = body else { return Ok(false) };
    let mut view = body.clone();
    let mut rewrote = false;
    for (path, kind) in spec {
        if kind == "j" {
            if path.contains('.') || path.contains('[') {
                continue;
            }
            let Some(J::Str(s)) = view.get(path).cloned() else { continue };
            if let Some(inner) = read_inner(&s).map_err(str::to_string)? {
                if crate::master_rows::has_int_minus_zero(s.as_bytes()) {
                    // 中身の字の中の整数の -0（Python の json.loads は int の 0）: 部品へ渡す字を 0 に書き直す（字の中・-0.0 は替えない）
                    body.set(path, J::Str(crate::master_rows::inner_text(&s).into_owned()));
                    rewrote = true;
                }
                view.set(path, inner);
            }
            continue;
        }
        if values(&view, path).iter().any(|v| type_bad(v, kind)) {
            return Err(type_message(path, kind));
        }
    }
    Ok(rewrote)
}

/// この道・方法の欄の型の並び（表に無ければ None）
fn types_of(method: &str, path: &str) -> Option<&'static [(String, String)]> {
    let r = rule_of(method, path)?;
    r.types.iter().find(|(k, _)| k == method).map(|(_, v)| v.as_slice())
}

fn has_big(v: &J) -> bool {
    match v {
        J::Big(_) => true,
        J::Arr(a) => a.iter().any(has_big),
        J::Obj(m) => m.iter().any(|(_, x)| has_big(x)),
        _ => false,
    }
}

/// 書く道の門（Python の routes/common.body_gate）
pub fn gate<'a>(method: &str, path: &str, body: &'a [u8]) -> Gate<'a> {
    let Some(mode) = mode_of(method, path) else { return Gate::Pass(Cow::Borrowed(body)) };
    let rules = if mode == "need" { GATE_NEED } else { GATE_READ };
    match read(body, &rules) {
        Err(msg) => Gate::Refuse(400, json!({"error": msg, "kind": "body"})),
        Ok(mut v) => {
            // 欄の型と中身の欄（版 3.106.0）。窓は記録だけの形（Python の TPA_BODY_TYPES_LOG）を持たない（いつも断る）
            let inner = match types_of(method, path).map(|spec| check_types(spec, &mut v)) {
                Some(Err(msg)) => return Gate::Refuse(400, json!({"error": msg, "kind": "body"})),
                Some(Ok(r)) => r,
                None => false,
            };
            if (inner || crate::master_rows::has_int_minus_zero(body)) && !has_big(&v) {
                Gate::Pass(Cow::Owned(v.dumps(None).into_bytes()))
            } else {
                Gate::Pass(Cow::Borrowed(body))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_match_like_python() {
        assert_eq!(mode_of("POST", "/api/card-forms"), Some("need"));
        assert_eq!(mode_of("PUT", "/api/card-forms/12"), Some("need"));
        assert_eq!(mode_of("PUT", "/api/card-forms/４"), Some("need"), "Python の \\d は全角の数字にも当たる");
        assert_eq!(mode_of("DELETE", "/api/card-forms/١"), Some("read"));
        assert_eq!(mode_of("PUT", "/api/card-forms/x"), None);
        assert_eq!(mode_of("GET", "/api/card-forms"), None);
        assert_eq!(mode_of("PUT", "/api/settings/lot_list.table"), Some("read"));
        assert_eq!(mode_of("PUT", "/api/settings/lot%5Flist.table"), Some("read"), "百分率符号を戻して当てる");
        assert_eq!(mode_of("POST", "/api/sources/order"), Some("read"));
        assert_eq!(mode_of("POST", "/api/sources/s4/quick"), Some("read"));
        assert_eq!(mode_of("POST", "/api/sources/s4/conn/check"), Some("read"));
        assert_eq!(mode_of("POST", "/api/heartbeat"), None, "本文を読まない道");
        assert_eq!(mode_of("POST", "/api/lots/fetch-lotdsp"), None, "LotDsp は自分の読み方");
        assert_eq!(unquote("/a%2Fb%zz%e3%81%82"), "/a/b%zzあ");
        // 版 3.104.0 の作った後の採点で見つかった割れ
        assert_eq!(unquote("/a%+1b%-2"), "/a%+1b%-2", "16 進の 2 字だけ（Python の unquote）");
        assert_eq!(mode_of("PUT", "/api/settings/a%0Ab"), None, "<path:…> の 2 字目から先の改行には当たらない（Python は門番へ）");
        assert_eq!(mode_of("PUT", "/api/settings/%0Ab"), Some("read"), "1 字目の改行は [^/] に当たる");
        assert_eq!(mode_of("PUT", "/api/settings/ab%0A"), None, "\\Z の前の改行にも当たらない");
    }

    #[test]
    fn minus_zero_is_rewritten() {
        match gate("POST", "/api/masters/rolls", br#"{"a": -0, "s": "-0", "f": -0.0}"#) {
            Gate::Pass(b) => assert_eq!(std::str::from_utf8(&b).unwrap(), r#"{"a": 0, "s": "-0", "f": -0.0}"#),
            Gate::Refuse(..) => panic!("断った"),
        }
        match gate("POST", "/api/masters/rolls", br#"{"a": -0, "b": 99999999999999999999}"#) {
            Gate::Pass(b) => assert!(matches!(b, Cow::Borrowed(_)), "大きな整数は部品が任せる"),
            Gate::Refuse(..) => panic!("断った"),
        }
    }
}
