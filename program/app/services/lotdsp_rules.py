# -*- coding: utf-8 -*-
"""LotDsp の 9 本の道が共にする決まり（版 3.98.0）。窓（desktop/src/lotdsp.rs の rules）も同じ決まりを 1 か所に持つ。

ここにある物は、利用者に決めてもらう事（2026-11-11 に尋ねた。返事が無いあいだは推奨で作る）と、道ごとに書き方が違っていた
誤りを 1 つにそろえた物。利用者の返事で変えるときは、ここと窓の rules を一緒に直す（事例の表 tests/fixtures/lotdsp_rules_cases.json を
両方が読むので、片方だけ直すと試験が止まる）。

    site_base          LotDsp の場所: 字の前後の空白を除き、# から後ろを捨て、末尾の / を除く（API・見えない Edge・届くか・
                       参照先の「確かめる」・画面の虫眼鏡〈lotdsp-url.js の searchBase〉が同じ決まり。前は # の URL で API が
                       問い合わせ先を取り違え、見えない Edge は # を 2 つ重ねた場所を開いた）
    TZ                 API の日時（経過ミリ秒・ずれつきの ISO）を字にする時間帯。日本時間に固定（決め ①。CM3 と同じ。前は PC の時間帯）
    to_number          数の字は字の全体を数として読む（決め ②。「.5」→0.5・全角の「０．５」→0.5・「5e-05」→0.00005・読めない字は None。
                       前は字の中の最初の 10 進の数を拾い、「.5」→5.0 だった）
    round_eq           画面の数（小数 dec 桁）が応答の数を丸めた物か。整数の欄は応答も整数のときだけ（調べる道具と学ぶ方で 1 つ）
    REACH_ONCE         届くかはプロキシを通さない 1 回だけ（決め ③）。HTTP の答えでも、プロキシの答え（PROXY_ANSWERS）は届いていない
    seconds_of         読んだ秒は道の全体で測り、小数 1 桁（前は API が 2 桁で search と組み立てだけ・見えない Edge が 1 桁）
    keep_of            読み終わったブラウザを残す秒（見えない Edge は keep_seconds・LotDsp の窓は window_keep_seconds。見張りも同じ所で決める）
    checked_lot        ロット番号の形（NFKC・大文字にそろえ、英数字 1〜12 字。3 つの道で同じ。前は fetch-lotdsp だけが見た）
    read_body          本文の読み方（UTF-8・JSON・入れ子は MAX_DEPTH 段まで・表であること）。窓も同じ字で断る
    MAX_HTML_CHARS     1 つの HTML の大きさの上限（取込と調べる道具で同じ）
"""
import json
import re
import unicodedata
from datetime import timedelta, timezone

# ------------------------------------------------------------------ 場所
# 前後から除く空白（Python の str.strip と JS の String.prototype.trim のどちらでも空白の字。片方だけの字〈\x1c〜\x1f・\x85・﻿〉は残す）
SITE_SPACES = "\t\n\x0b\x0c\r \xa0                　"
API_PATH = "/service/lotdsp/search//searchAction"
SEARCH_PAGE = "/#/lotdsp"


def site_base(url):
    """設定の LotDsp の URL → 場所（前後の空白を除き、# から後ろを捨て、末尾の / を除く）。"""
    s = str(url or "").strip(SITE_SPACES)
    s = s.split("#", 1)[0]
    return s.rstrip("/")


def api_search_url(url):
    base = site_base(url)
    return base + API_PATH if base else ""


def direct_search_url(url):
    base = site_base(url)
    return base + SEARCH_PAGE if base else ""


# ------------------------------------------------------------------ 時刻
TZ = timezone(timedelta(hours=9), "JST")        # 決め ①: 日本時間に固定（CM3 の cm3_schedule.normalize と同じ）

# ------------------------------------------------------------------ 数
_NUMBER = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", re.ASCII)


def to_number(text):
    """数の字 → float（決め ②: 字の全体が数のときだけ。'1,200.00' → 1200.0・'.5' → 0.5・'０．５' → 0.5・'5e-05' → 5e-05・
    '−5'〈U+2212〉→ -5.0・空・数でない字・'12mm' → None）。数そのもの（API の値）は str() してから読む。"""
    if text is None or isinstance(text, bool):
        return None
    if isinstance(text, (int, float)):
        text = str(text)
    s = unicodedata.normalize("NFKC", str(text)).replace(",", "").replace("−", "-").strip()
    if not _NUMBER.fullmatch(s):
        return None
    v = float(s)
    return v if v == v and v not in (float("inf"), float("-inf")) else None


def round_eq(shown, dec, raw):
    """画面の数（小数 dec 桁）が、応答の数 raw を丸めた物か。整数の欄（dec 0）は応答も整数のときだけ（2.73 が 3 に当たらない）。"""
    if abs(shown - raw) > 0.5 * 10 ** -dec + 1e-9:
        return False
    return dec > 0 or abs(raw - round(raw)) < 1e-9


# ------------------------------------------------------------------ 届くか
REACH_ONCE = True                                  # 決め ③: プロキシを通さない 1 回だけ（PC のプロキシで 2 回目を試さない）
PROXY_ANSWERS = (407, 502, 503, 504)               # プロキシが返す答え（相手には届いていない）


def reached_status(code):
    """HTTP の答えの状態から、LotDsp に届いたと数えるか（401・403・404 などは届いている。プロキシの答えは届いていない）。"""
    return int(code) not in PROXY_ANSWERS


# ------------------------------------------------------------------ 秒・残す長さ
def seconds_of(t0, t1):
    """道の全体の秒（小数 1 桁）。"""
    return round(max(0.0, t1 - t0), 1)


def keep_of(cfg, visible):
    """読み終わったブラウザを残す秒。見えない Edge は keep_seconds、LotDsp の窓は window_keep_seconds（0 以下は毎回閉じる）。"""
    return float(cfg.get("window_keep_seconds", 0) if visible else cfg.get("keep_seconds", 0))


# ------------------------------------------------------------------ ロット番号
LOT_MAX = 12
_LOT = re.compile(r"[A-Z0-9]{1,%d}" % LOT_MAX, re.ASCII)


class LotShapeError(ValueError):
    pass


def norm_lot(value):
    """ロット番号の字をそろえる（NFKC・前後の空白・大文字）。字でなければ LotShapeError。"""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise LotShapeError("ロット番号は字で送ってください。")
    return unicodedata.normalize("NFKC", value).strip().upper()


def checked_lot(value):
    """ロット番号（英数字 1〜12 字）。違えば LotShapeError（kind invalid）。"""
    lot = norm_lot(value)
    if not _LOT.fullmatch(lot):
        raise LotShapeError(f"ロット番号の形が違います（{lot or '空'}）")
    return lot


# ------------------------------------------------------------------ BOX の№・分割の数
BOX_MAX = 1e9            # |値| がこれ以上の№・分割の数は読まない（版 3.98.0。前は巨大な整数をそのまま答えに書いた）


def box_of(f):
    """int(f)（有限で |f| < BOX_MAX のときだけ。ほかは None）"""
    if f is None or f != f or f in (float("inf"), float("-inf")) or abs(f) >= BOX_MAX:
        return None
    return int(f)


# ------------------------------------------------------------------ 本文
MAX_HTML_CHARS = 5_000_000
MAX_DEPTH = 64                                     # 本文の入れ子の段（表と並び）の上限。超えたら読まない（窓も同じ）


class BodyError(ValueError):
    pass


def _depth_ok(text):
    """本文の入れ子が MAX_DEPTH 段までか（字の中の括弧は数えない）。"""
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
            if depth > MAX_DEPTH:
                return False
        elif ch in "]}":
            depth -= 1
    return True


def _clean(v):
    """字の中の片割れの代用字は U+FFFD にする（窓の字は片割れを持てない）。"""
    if isinstance(v, str):
        return re.sub("[\ud800-\udfff]", "�", v)
    if isinstance(v, list):
        return [_clean(x) for x in v]
    if isinstance(v, dict):
        return {_clean(k): _clean(x) for k, x in v.items()}
    return v


def read_body(raw):
    """本文（バイト）→ 表（dict）。空は {}。読めなければ BodyError（400 invalid）。"""
    if not raw:
        return {}
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise BodyError("本文を UTF-8 として読めません。") from None
    if not _depth_ok(text):
        raise BodyError("本文の入れ子が深すぎます。") from None
    try:
        body = json.loads(text)
    except (ValueError, RecursionError):
        raise BodyError("本文を JSON として読めません。") from None
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise BodyError("本文の形が違います（表で送ってください）。")
    return _clean(body)


def html_of(body, key="html"):
    """本文の HTML（無い・null は空の字）。字でなければ BodyError。"""
    v = body.get(key)
    if v is None:
        return ""
    if not isinstance(v, str):
        raise BodyError("HTML は字で送ってください。")
    return v


def flag_of(body, key):
    """真偽の欄（true のときだけ真）。"""
    return body.get(key) is True
