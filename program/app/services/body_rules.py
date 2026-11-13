# -*- coding: utf-8 -*-
"""問い合わせの本文の読み方（版 3.104.0。Rust 化の段 ① の A「本文の門」）。窓（desktop/src/body.rs）も同じ決まりを 1 か所に持つ。

本文（バイト）を読む部品は 1 つで、違いは引数（Rules）で分ける:

    GATE_READ  書く道の門（画面が本文を送らないことがある道。空・null は通す）
    GATE_NEED  書く道の門（本文が要る道。空の本文は断る。前は英語の「400 Bad Request: The browser (or proxy)…」）
    LOTDSP     LotDsp の 9 本（版 3.98.0 の read_body。NaN を通す・入れ子 64 段まで・対の無い代用字は U+FFFD に替える）

門で見る順（どの道も同じ。窓も同じ順）: 空 → UTF-8 → 入れ子の段（字の外の [ { を数える）→ JSON（Python の json.loads）→
NaN・Infinity・大きすぎる小数（1e400）→ 対の無い代用字 → 表でない本文（真の値の並び・字・数。偽の値〈null・[]・0・""・false〉は
今までどおり道が {} と読む）。断る言葉は日本語の {error, kind: "body"}（400）。

門を当てる道と、空の本文を断るか（need）通すか（read）は ROUTES（道の型ごと）。表に無い書く道（本文を読まない道・LotDsp の 9 本・
ダッシュボードの問い合わせ）には当てない。窓は tools/body-routes.py が焼いた desktop/src/body_routes.json で同じ道を同じ順に当てる
（tests/test_body_routes.py が古い表と表に無い道を止める）。事例の表は tests/fixtures/body_cases.json（Python と窓が同じ表を読む）。
"""
import json
import math
import re
from typing import NamedTuple


class BodyError(ValueError):
    """本文を読めない（400 kind body）。web.py の道の外の失敗と master_call のどちらでも JSON で答える"""
    kind, status = "body", 400

    def payload(self):
        return {"error": str(self), "kind": self.kind}


E_BLANK = "本文が空です（表で送ってください）。"
E_UTF8 = "本文を UTF-8 として読めません。"
E_DEPTH = "本文の入れ子が深すぎます。"
E_JSON = "本文を JSON として読めません。"
E_NONFINITE = "本文に NaN・Infinity か、大きすぎて読めない数があります（数で送ってください）。"
E_SURROGATE = "本文の字に対の無い代用字（\\ud800 など）があります。"
E_SHAPE = "本文の形が違います（表で送ってください）。"


class Rules(NamedTuple):
    blank_ws: bool       # 空白（JSON の空白 4 字）だけの本文も「空」と読む（偽なら 0 バイトだけが空）
    blank_ok: bool       # 空の本文を通す（None）。偽なら E_BLANK
    max_depth: int       # 入れ子の段の上限（超えたら E_DEPTH）
    allow_nan: bool      # NaN・Infinity・1e400 を通す
    surrogates: str      # 対の無い代用字: "refuse"（E_SURROGATE）か "replace"（U+FFFD）
    falsy_passes: bool   # 偽の値（null・[]・0・""・false）を通す（真なら値のまま返す。偽なら null だけ {}、ほかは E_SHAPE）


# 窓の serde_json は 128 段で読むのをやめる。門はそれより 1 段手前まで読む（版 3.103.0 までの窓の答えと同じ 127 段）
GATE_DEPTH = 127
GATE_READ = Rules(blank_ws=True, blank_ok=True, max_depth=GATE_DEPTH, allow_nan=False, surrogates="refuse", falsy_passes=True)
GATE_NEED = GATE_READ._replace(blank_ok=False)
LOTDSP = Rules(blank_ws=False, blank_ok=True, max_depth=64, allow_nan=True, surrogates="replace", falsy_passes=False)

_SURR = re.compile("[\ud800-\udfff]")


def _depth_ok(text, limit):
    """本文の入れ子が limit 段までか（字の中の括弧は数えない）。"""
    depth, in_str, esc = 0, False, False
    for ch in text:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch in "[{":
            depth += 1
            if depth > limit:
                return False
        elif ch in "]}":
            depth -= 1
    return True


def _walk(v):
    yield v
    if isinstance(v, list):
        for x in v:
            yield from _walk(x)
    elif isinstance(v, dict):
        for k, x in v.items():
            yield k
            yield from _walk(x)


def _replace(v):
    """字の中の対の無い代用字は U+FFFD にする（窓の字は片割れを持てない）。"""
    if isinstance(v, str):
        return _SURR.sub("�", v)
    if isinstance(v, list):
        return [_replace(x) for x in v]
    if isinstance(v, dict):
        return {_replace(k): _replace(x) for k, x in v.items()}
    return v


def read_body(raw, rules):
    """本文（バイト）→ 値。空は None（blank_ok のとき）。読めなければ BodyError。"""
    raw = bytes(raw or b"")
    if not raw or (rules.blank_ws and not raw.strip(b" \t\n\r")):
        if not rules.blank_ok:
            raise BodyError(E_BLANK)
        return None if rules.falsy_passes else {}
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise BodyError(E_UTF8) from None
    if not _depth_ok(text, rules.max_depth):
        raise BodyError(E_DEPTH)
    try:
        body = json.loads(text)
    except (ValueError, RecursionError):        # JSONDecodeError と、4,300 桁を超える整数（int() の桁の上限）
        raise BodyError(E_JSON) from None
    if not rules.allow_nan and any(isinstance(x, float) and not math.isfinite(x) for x in _walk(body)):
        raise BodyError(E_NONFINITE)
    if rules.surrogates == "refuse":
        if any(isinstance(x, str) and _SURR.search(x) for x in _walk(body)):
            raise BodyError(E_SURROGATE)
    else:
        body = _replace(body)
    if rules.falsy_passes:
        if body and not isinstance(body, dict):
            raise BodyError(E_SHAPE)
        return body
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise BodyError(E_SHAPE)
    return body


# ------------------------------------------------------------------ 門を当てる道（道の型 → need | read）
# need: 本文が要る（空は断る。前は get_json(force=True) で英語の 400）。read: 空・null は道が {} と読む（前は get_json(silent=True)）。
NEED, READ = "need", "read"
ROUTES = {
    # 変換表
    ("POST", "/api/masters/conversions"): NEED,
    ("PUT", "/api/masters/conversions/<int:item_id>"): NEED,
    ("POST", "/api/masters/conversions/import"): NEED,
    ("POST", "/api/masters/conversions/defaults"): NEED,
    ("POST", "/api/masters/conversions/<int:item_id>/preset"): READ,
    ("DELETE", "/api/masters/conversions/<int:item_id>"): READ,
    # 設備グループ
    ("POST", "/api/masters/equipgroups"): NEED,
    ("PUT", "/api/masters/equipgroups/<int:item_id>"): NEED,
    ("DELETE", "/api/masters/equipgroups/<int:item_id>"): READ,
    # 設備・ロール
    ("POST", "/api/masters/equipment"): NEED,
    ("PUT", "/api/masters/equipment/<int:item_id>"): NEED,
    ("DELETE", "/api/masters/equipment/<int:item_id>"): READ,
    ("POST", "/api/masters/rolls"): NEED,
    ("PUT", "/api/masters/rolls/<int:item_id>"): NEED,
    ("DELETE", "/api/masters/rolls/<int:item_id>"): READ,
    ("POST", "/api/equipment/inspection"): READ,
    # 勤務体系
    ("POST", "/api/masters/shifts"): NEED,
    ("PUT", "/api/masters/shifts/<int:item_id>"): NEED,
    ("DELETE", "/api/masters/shifts/<int:item_id>"): READ,
    # 作業実績の登録
    ("PUT", "/api/masters/worklog/order"): NEED,
    ("PUT", "/api/masters/worklog/<int:item_id>"): NEED,
    ("DELETE", "/api/masters/worklog/<int:item_id>"): READ,
    # 共有の書式
    ("POST", "/api/masters/formats"): NEED,
    ("PUT", "/api/masters/formats/<int:item_id>"): NEED,
    ("DELETE", "/api/masters/formats/<int:item_id>"): READ,
    # ダッシュボード・セット・カード・組み方
    ("POST", "/api/dashboards"): NEED,
    ("PUT", "/api/dashboards/<int:item_id>"): NEED,
    ("DELETE", "/api/dashboards/<int:item_id>"): READ,
    ("PUT", "/api/dashboards-hidden"): NEED,
    ("POST", "/api/dashboard-sets"): NEED,
    ("PUT", "/api/dashboard-sets/<int:item_id>"): NEED,
    ("DELETE", "/api/dashboard-sets/<int:item_id>"): READ,
    ("POST", "/api/card-forms"): NEED,
    ("PUT", "/api/card-forms/<int:item_id>"): NEED,
    ("DELETE", "/api/card-forms/<int:item_id>"): READ,
    ("POST", "/api/pivot-presets"): NEED,
    ("PUT", "/api/pivot-presets/<int:item_id>"): NEED,
    ("DELETE", "/api/pivot-presets/<int:item_id>"): READ,
    ("PUT", "/api/pivot-quick"): NEED,
    # 計算
    ("POST", "/api/calculate"): NEED,
    # 権限・利用状況
    ("POST", "/api/masters/access"): READ,
    ("PUT", "/api/masters/access/<int:item_id>"): READ,
    ("DELETE", "/api/masters/access/<int:item_id>"): READ,
    ("PUT", "/api/masters/tabaccess"): READ,
    ("POST", "/api/presence/disconnect"): READ,
    ("POST", "/api/presence/allow"): READ,
    ("POST", "/api/presence/forget"): READ,
    ("POST", "/api/presence/retention"): READ,
    # 置き場・参照先・フォルダ・配布の置き場
    ("POST", "/api/masters/place/check"): READ,
    ("POST", "/api/masters/place/move"): READ,
    ("POST", "/api/release/place/check"): READ,
    ("POST", "/api/release/place/move"): READ,
    ("POST", "/api/fs/browse"): READ,
    ("POST", "/api/settings/check"): READ,
    ("PUT", "/api/settings/<path:key>"): READ,
    # データ元
    ("POST", "/api/sources"): READ,
    ("PUT", "/api/sources/<key>"): READ,
    ("DELETE", "/api/sources/<key>"): READ,
    ("POST", "/api/sources/<key>/quick"): READ,
    ("PUT", "/api/sources/<key>/conn"): READ,
    ("POST", "/api/sources/<key>/conn/check"): READ,
    ("POST", "/api/sources/check"): READ,
    ("POST", "/api/sources/order"): READ,
    ("POST", "/api/sources/groups"): READ,
    ("POST", "/api/sources/join/preview"): READ,
    # 画面の設定
    ("PUT", "/api/ui-defaults"): READ,
    ("POST", "/api/ui-state"): READ,
}
# 門を当てない書く道（本文を読まない・自分の読み方を持つ）。表に無い書く道があれば試験が止める（tests/test_body_routes.py）
SKIP = {
    ("POST", "/api/lots/fetch-lotdsp"): "LotDsp の 9 本（LOTDSP の読み方）",
    ("POST", "/api/lots/fetch-lotdsp-api"): "LotDsp の 9 本（LOTDSP の読み方）",
    ("POST", "/api/lots/import-lotdsp"): "LotDsp の 9 本（LOTDSP の読み方）",
    ("POST", "/api/lots/lotdsp-api/link"): "LotDsp の 9 本（LOTDSP の読み方）",
    ("POST", "/api/lots/fetch-lotdsp/cancel"): "LotDsp の 9 本（本文を読まない）",
    ("POST", "/api/dashboard/query"): "ダッシュボードの問い合わせ（読む道。本文は段の記録にも使う）",
    ("POST", "/api/dashboard/fields"): "ダッシュボードの札（読む道。本文は段の記録にも使う）",
    ("POST", "/api/heartbeat"): "本文を読まない",
    ("POST", "/api/lotlist/refresh"): "本文を読まない",
    ("POST", "/api/worklog/refresh"): "本文を読まない",
    ("POST", "/api/masters/worklog/scan"): "本文を読まない",
    ("POST", "/api/presence/prune"): "本文を読まない",
    ("POST", "/api/src/<key>/refresh"): "本文を読まない",
    ("DELETE", "/api/masters/rows/<name>/<int:row>"): "本文を読まない（何行目と要約は道と ?summary=。版 3.108.0）",
}


# ------------------------------------------------------------------ 欄の型（版 3.106.0。Rust 化の段 ① の D2・A2）
# 道ごとに、本文の欄の道 → 許す型（並びで書く。見る順もこの並び）。窓は tools/body-routes.py が焼いた desktop/src/body_routes.json の
# "types" で同じ順に当てる（tests/test_body_routes.py が古い表を止める）。表に無い欄は見ない。欄の道の書き方:
#   "name"（表の鍵）・"rules[]"（並びの各値）・"rows[].when.*[].op"（「*」は表の全部の値）。
# 型（どれも「断る物」で決める。前の版で窓が答えていた数・真偽・null は、字の欄でも今どおり str() で受ける）:
#   s  字の欄: 並び・表を断る（Python は str() で repr の字〈['x']〉を置いていた。窓は答えずに任せていた）
#   l  並びの欄: 数・真偽・表を断る（字・null は今どおり道が読む）
#   o  表の欄: 並びを断る
#   j  中身の欄（表か JSON の字）: 字なら門と同じ決まり（入れ子・NaN・Infinity・1e400・対の無い代用字）で中身を読み、
#      読めた中身にこの後ろの欄の道を当てる（JSON として読めない字は、今どおり道が自分の言葉で断る）
# 画面が字の欄に字でない物を送る所（タブの例外〈表〉・データ元の結合〈並び〉・presence の days〈字〉・勤務体系の dayOffset・
# 設備グループの rules[] の知らない鍵）は表に入れない（2026-11-delegates-3106.md の 2 節。ui-eval の全部を記録だけの形で流して確かめる）。
S, L, OBJ, J = "s", "l", "o", "j"
TYPE_NAMES = {S: "字", L: "並び", OBJ: "表", J: "中身"}
_PRESET = [("name", S), ("note", S), ("scope", S), ("source", S)]
_CARD = [("body", J), ("body.tabs[].id", S), ("body.tabs[].name", S),
         *[(f"body.items[].{k}", S) for k in ("id", "label", "col", "expr", "text", "tab")], ("body.items[].cols[]", S)]
_PIVOT = [("body", J), ("body.rows[].part", S), ("body.cols[].part", S), ("body.measures[].column", S), ("body.measures[].expr", S)]
# 版 3.106.0 の作った後の採点の割れ 5: 字で送る inputs・rows・apply は中身の欄（j）で中まで見る。apply.column・apply.place も字の欄
# （前は apply.place に並びで Python が TypeError の 500）
_CONV = [("name", S), ("other", S), ("inputs", J), ("inputs", L), ("inputs[].name", S), ("inputs[].type", S), ("inputs[].columns[]", S),
         ("rows", J), ("rows", L), ("rows[].out", S), ("rows[].when.*[].op", S), ("rows[].when.*[].v[]", S), ("rows[].when.*[].min", S),
         ("rows[].when.*[].max", S), ("apply", J), ("apply", OBJ), ("apply.mode", S), ("apply.column", S), ("apply.place", S)]
_EGROUP = [("name", S), ("set", S), ("note", S), ("equipment", L), ("equipment[]", S), ("except", L), ("except[]", S),
           ("rules", L), ("rules[].op", S), ("rules[].value", S)]
_EQUIP = [("設備名", S), ("巻取方向", S), ("ライン方向", S), ("同一工程", S), ("検査計", S)]
_ROLL = [(k, S) for k in ("設備", "入出位置", "接触面", "ロール径MAX", "ロール径MIN", "ロール面長", "材質", "硬度", "本数", "ロール名",
                          "ロール使用条件", "駆動方式", "基準番号", "備考")]
_SHIFT = [("name", S), ("note", S), ("equipment", L), ("equipment[]", S), ("segments", L), ("segments[].name", S),
          ("segments[].start", S), ("segments[].end", S)]
_SOURCE = [(k, S) for k in ("キー", "表示名", "役割", "場所", "表", "設備の列", "設備の取り出し方", "画面", "並び", "備考", "グループ", "元",
                            "確かめる間隔", "古さの警告", "ロット番号の列")] + [
    ("結合", J), ("結合[].with", S), ("結合[].how", S), ("結合[].on", L), ("結合[].cols", L), ("結合[].cols[]", S)]
_PLACE = [("parent", S), ("name", S)]
TYPES = {
    ("POST", "/api/card-forms"): _PRESET + _CARD,
    ("PUT", "/api/card-forms/<int:item_id>"): _PRESET + _CARD,
    ("POST", "/api/pivot-presets"): _PRESET + _PIVOT,
    ("PUT", "/api/pivot-presets/<int:item_id>"): _PRESET + _PIVOT,
    ("POST", "/api/dashboards"): _PRESET + [("body", J)],
    ("PUT", "/api/dashboards/<int:item_id>"): _PRESET + [("body", J)],
    ("PUT", "/api/dashboards-hidden"): [("scope", S), ("keys", L), ("keys[]", S)],
    ("POST", "/api/dashboard-sets"): _PRESET + [("body", J)],
    ("PUT", "/api/dashboard-sets/<int:item_id>"): _PRESET + [("body", J)],
    ("PUT", "/api/pivot-quick"): [("source", S), ("keys", L), ("keys[]", S)],
    ("POST", "/api/masters/formats"): [("name", S), ("note", S), ("source", S), ("table", S), ("origin", S), ("body", J)],
    ("PUT", "/api/masters/formats/<int:item_id>"): [("name", S), ("note", S), ("source", S), ("table", S), ("origin", S), ("body", J)],
    ("POST", "/api/masters/conversions"): _CONV,
    ("PUT", "/api/masters/conversions/<int:item_id>"): _CONV,
    # 取り込み（利用者の前の版のファイル）: 字の欄の数・真偽・null は今どおり str() で受け、並び・表だけを断る（s の決まりのまま）
    # 取り込みの中の字の欄（inputs・rows・apply を字で書いた物）は中まで見ない（中身の欄 j は表の上の段だけ。道が今どおり読む）
    ("POST", "/api/masters/conversions/import"): [("items", L)] + [(f"items[].{p}", t) for p, t in _CONV if t != J],
    ("POST", "/api/masters/equipgroups"): _EGROUP,
    ("PUT", "/api/masters/equipgroups/<int:item_id>"): _EGROUP,
    ("POST", "/api/masters/equipment"): _EQUIP,
    ("PUT", "/api/masters/equipment/<int:item_id>"): _EQUIP,
    ("POST", "/api/masters/rolls"): _ROLL,
    ("PUT", "/api/masters/rolls/<int:item_id>"): _ROLL,
    ("POST", "/api/masters/shifts"): _SHIFT,
    ("PUT", "/api/masters/shifts/<int:item_id>"): _SHIFT,
    ("PUT", "/api/masters/worklog/order"): [("keys", L), ("keys[]", S)],
    ("PUT", "/api/masters/worklog/<int:item_id>"): [(k, S) for k in ("設備名", "ファイル名", "ファイルID", "表示", "表", "備考", "並び")],
    ("POST", "/api/sources"): _SOURCE,
    ("PUT", "/api/sources/<key>"): _SOURCE,
    ("POST", "/api/sources/<key>/quick"): [("表示名", S), ("画面", S), ("グループ", S)],
    ("PUT", "/api/sources/<key>/conn"): [("field", S), ("value", S)],
    ("POST", "/api/sources/order"): [("keys", L), ("keys[]", S)],
    ("POST", "/api/sources/groups"): [("from", S), ("to", S)],
    ("PUT", "/api/settings/<path:key>"): [("value", S)],
    ("POST", "/api/fs/browse"): [("path", S), ("purpose", S), ("pattern", S)],
    ("POST", "/api/masters/place/check"): _PLACE,
    ("POST", "/api/masters/place/move"): _PLACE,
    ("POST", "/api/release/place/check"): [("from", S)] + _PLACE,
    ("POST", "/api/release/place/move"): [("from", S)] + _PLACE,
}
# 記録だけの形（開発用。版 3.106.0 の入れ方: 断る前に画面の評価関数を全部流し、表に無い型が 0 件かを見る）。この環境変数にファイルの道を
# 置くと、欄の型の違いを断らずに 1 行ずつ書く（中身の欄 j の門は今どおり断る）。窓は記録の形を持たない（いつも断る）
TYPES_LOG_ENV = "TPA_BODY_TYPES_LOG"


def type_message(path, kind):
    if kind == S:
        return f"本文の「{path}」は字で送ってください（並び・表は送れません）。"
    if kind == L:
        return f"本文の「{path}」は並びで送ってください。"
    return f"本文の「{path}」は表で送ってください（並びは送れません）。"


def _type_bad(v, kind):
    if kind == S:
        return isinstance(v, (list, dict))
    if kind == L:
        return isinstance(v, (bool, int, float, dict))
    if kind == OBJ:
        return isinstance(v, list)
    return False


def _values(root, path):
    """欄の道に当たる値（文書の順）"""
    cur = [root]
    for seg in path.split("."):
        arr = seg.endswith("[]")
        name = seg[:-2] if arr else seg
        nxt = []
        for c in cur:
            if not isinstance(c, dict):
                continue
            vals = list(c.values()) if name == "*" else ([c[name]] if name in c else [])
            for v in vals:
                if arr:
                    if isinstance(v, list):
                        nxt.extend(v)
                else:
                    nxt.append(v)
        cur = nxt
    return cur


def read_inner(text):
    """中身の欄の JSON の字 → 値（JSON として読めなければ None＝道に任せる）。門と同じ決まりで断る（BodyError）。
    整数の -0 は Python の json.loads が int の 0 に読む（窓は字の中の -0 を 0 に書き直してから部品へ渡す）"""
    if not _depth_ok(text, GATE_DEPTH):
        raise BodyError(E_DEPTH)
    try:
        v = json.loads(text)
    except (ValueError, RecursionError):
        return None
    if any(isinstance(x, float) and not math.isfinite(x) for x in _walk(v)):
        raise BodyError(E_NONFINITE)
    if any(isinstance(x, str) and _SURR.search(x) for x in _walk(v)):
        raise BodyError(E_SURROGATE)
    return v


def check_types(method, pattern, body, log=None):
    """欄の型（TYPES）と中身の欄の門を当てる。違えば BodyError（log があれば型の違いは断らずに log へ渡す）"""
    spec = TYPES.get((method, pattern))
    if not spec or not isinstance(body, dict):
        return
    view = dict(body)
    for path, kind in spec:
        if kind == J:
            if "." not in path and "[" not in path and isinstance(view.get(path), str):
                inner = read_inner(view[path])
                if inner is not None:
                    view[path] = inner
            continue
        for v in _values(view, path):
            if _type_bad(v, kind):
                if log is not None:
                    log({"method": method, "rule": pattern, "path": path, "type": kind, "got": type(v).__name__})
                    break
                raise BodyError(type_message(path, kind))


def types_log():
    """記録だけの形の書き手（環境変数が無ければ None）"""
    import os
    dest = os.environ.get(TYPES_LOG_ENV)
    if not dest:
        return None

    def write(entry):
        with open(dest, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return write


def mode_of(method, pattern):
    """道の型の門（NEED・READ・None）"""
    return ROUTES.get((method, pattern))


def rules_of(mode):
    return GATE_NEED if mode == NEED else GATE_READ


def gate(method, pattern, raw, log=None):
    """書く道の門の全部（本文を読む → 欄の型と中身の欄）。門を当てない道は (False, None)。読めなければ BodyError。
    Python の routes/common.body_gate と突き合わせの答えの元（tests/oracle_gate.py）が使う。窓は src/body.rs の gate"""
    mode = mode_of(method, pattern)
    if mode is None:
        return False, None
    value = read_body(raw, rules_of(mode))
    check_types(method, pattern, value, log)
    return True, value
