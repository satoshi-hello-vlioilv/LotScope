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
}


def mode_of(method, pattern):
    """道の型の門（NEED・READ・None）"""
    return ROUTES.get((method, pattern))


def rules_of(mode):
    return GATE_NEED if mode == NEED else GATE_READ
