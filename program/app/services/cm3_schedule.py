# -*- coding: utf-8 -*-
"""CM3 スケジューリングシステムの作業予定（ScheduleView の cm3_client.py を移した。版 3.57.0）。

  POST <cm3_base_url><init_path>  →  entity.meisaiList（設備ごとの作業予定の行）

行の区分（rowKind）
  lot     … 製造の行
  inspect … 製造の形をしているが、ロット番号か用途名に点検の言葉（既定「点検板」）を含む行（圧延するが点検用）
  stop    … 設備停止の行（時刻と文だけ）

答えの形（normalize）は ScheduleView と同じ。一覧の表に置く形（table_rows）は schedule.py が使う。
標準のライブラリだけで動く（Python の各 PC で追加のパッケージは要らない）。
"""
from __future__ import annotations

import html
import json
import re
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))


class Cm3Error(Exception):
    """CM3 に届かない・CM3 が誤りを返した（理由は利用者に見せる言葉）。"""


# ---------------------------------------------------------------- 問い合わせ
def build_payload(setsubi, term_kbn, client_ip):
    """init の要求の本文（ブラウザの開発ツールで見た形）。"""
    return {
        "ip": client_ip, "userID": None, "termID": None, "setsubiName": setsubi, "useKbn": None, "termKbn": term_kbn,
        "authInfo": None, "result": 0, "error": False, "errorMessage": "", "version": None, "setsubi": "",
        "updateTs": None, "meisaiList": [], "urlSetsubi": setsubi, "urlTermKbn": term_kbn,
    }


def _decode_body(raw, content_type):
    """答えのバイト列 → 字。charset の見出し → UTF-8 → CP932 の順に試す。"""
    m = re.search(r"charset=([\w\-]+)", content_type or "", re.I)
    for enc in ([m.group(1)] if m else []) + ["utf-8", "cp932"]:
        try:
            return raw.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", errors="replace")


def fetch_raw(cfg, setsubi, term_kbn):
    """CM3 の答え（JSON の dict）そのもの。cfg: {cm3_base_url, init_path, client_ip, timeout_sec, use_system_proxy}"""
    base = str(cfg.get("cm3_base_url") or "").rstrip("/")
    if not base:
        raise Cm3Error("CM3 の場所（参照先の「CM3 の URL」）が決まっていません")
    body = json.dumps(build_payload(setsubi, term_kbn, cfg.get("client_ip")), ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(base + str(cfg.get("init_path") or ""), data=body, method="POST", headers={
        "Accept": "application/json, text/plain, */*", "Content-Type": "application/json;charset=UTF-8",
        "Origin": base, "Referer": base + "/Cm3SchWeb/"})
    # プロキシは既定で通さない（社内の CM3 へ直接つなぐ）。use_system_proxy のときは環境変数・Windows の設定のプロキシ
    opener = urllib.request.build_opener() if cfg.get("use_system_proxy") else urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=float(cfg.get("timeout_sec") or 15)) as res:
            text = _decode_body(res.read(), res.headers.get("Content-Type"))
    except urllib.error.HTTPError as e:
        raise Cm3Error(f"CM3がHTTPエラーを返しました: {e.code} {e.reason}") from None
    except urllib.error.URLError as e:
        raise Cm3Error(f"CM3に接続できません: {e.reason}") from None
    except (TimeoutError, OSError) as e:
        raise Cm3Error("CM3の応答がタイムアウトしました" if isinstance(e, TimeoutError) else f"CM3に接続できません: {e}") from None
    try:
        return json.loads(text)
    except ValueError:
        raise Cm3Error("CM3の応答がJSONではありません") from None


# ---------------------------------------------------------------- 字の直し
_JP = re.compile(r"[　-ヿ㐀-鿿！-ﾟ]")
_LATIN_HIGH = re.compile(r"[\u0080-ÿŒ-ƒˆ-˜–-™]")
_TAG = re.compile(r"<[^>]+>")


def fix_text(value):
    """見せる字へ直す: HTML の文字参照（&#12288; &amp;）→ 字・タグ（<br> <span>）→ 除く・
    文字化け（UTF-8／CP932 のバイトを Latin-1／CP1252 で読んだ物）→ 戻す。ふつうの日本語はそのまま。"""
    if not isinstance(value, str) or not value:
        return value
    s = value
    if "<" in s and ">" in s:
        s = _TAG.sub(" ", s)
    if "&" in s:
        s = html.unescape(s)
    if _LATIN_HIGH.search(s):
        for src, dst in (("latin-1", "utf-8"), ("cp1252", "utf-8"), ("latin-1", "cp932"), ("cp1252", "cp932")):
            try:
                t = s.encode(src).decode(dst)
            except (UnicodeEncodeError, UnicodeDecodeError):
                continue
            if _JP.search(t):
                s = t
                break
    return s.replace("　", " ").strip()


# ---------------------------------------------------------------- 行の区分
_LOT_DATA_KEYS = ["zaishitsu", "inItaAtsu", "outItaAtsu", "reienHaba", "seihinItaAtsu", "seihinItaHaba", "keijo", "jiKotei"]
_DIMENSION_KEYS = ["inItaAtsu", "outItaAtsu", "reienHaba", "seihinItaAtsu", "seihinItaHaba"]
LOT_MIN_FIELDS = 4
_NON_TEXT_KEYS = {"rowStyle", "teisiStyle", "ltNoRendered", "lotToiawaseUrl", "yotoMei"}    # 画面の飾り・リンクだけの項目
_DURATION = re.compile(r"^\d+(\.\d+)?\s*(分|h|H|時間)?$")


def _to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _filled(v):
    return v is not None and str(v).strip() != ""


def is_stop_row(m):
    """行の中身の量で見分ける（飾りの印では見分けない）。製造の行: 8 項目のうち 4 つ以上が埋まり、板厚・幅のどれかが数。ほかは停止の行。"""
    filled = sum(1 for k in _LOT_DATA_KEYS if _filled(m.get(k)))
    numeric = sum(1 for k in _DIMENSION_KEYS if _to_float(m.get(k)) is not None)
    return not (filled >= LOT_MIN_FIELDS and numeric >= 1)


def _nfkc(s):
    return unicodedata.normalize("NFKC", str(s or "")).upper()


def is_inspect_row(lot, yoto, keywords):
    """製造の形の行のうち、ロット番号か用途名に点検の言葉を含む行。"""
    text = _nfkc(lot) + " " + _nfkc(yoto)
    return any(k and _nfkc(k) in text for k in (keywords or []))


def _stop_text(m):
    """停止の文を、CM3 の答えの項目の順につなぐ。CM3 は 1 つの停止名を左の列から決まった幅で切って入れる
    （roll="ワークロ" lotNo="ール交換計" zaishitsu="画" → 「ワークロール交換計画」）。切れ端は空白なしでつなぎ、長さ（「7分」）は最後に置く。"""
    name, extra = "", []
    for k in m:
        if k in _NON_TEXT_KEYS or k == "kanryoYotei":
            continue
        v = m.get(k)
        if v is None or isinstance(v, (bool, dict, list)):
            continue
        v = fix_text(str(v))
        if not v:
            continue
        if _DURATION.match(v):
            extra.append(v)
        else:
            name += v
    return " ".join([name] + extra).strip() or "設備停止"


# ---------------------------------------------------------------- 整える
_DATE_TIME = re.compile(r"^\s*(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*$")
_TIME_ONLY = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*$")


def _ts_to_dt(update_ts):
    if update_ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(update_ts) / 1000, tz=JST)
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _reduction(in_t, out_t):
    a, b = _to_float(in_t), _to_float(out_t)
    if not a or b is None:
        return None
    return round((a - b) / a * 100, 1)


def normalize(raw, own_setsubi, inspect_keywords=None):
    """CM3 の答え → 画面の形（行は items）。完了予定は日付の付く行（"10/19 14:05"）と時刻だけの行（"     14:27"）があり、
    時刻だけの行は前の行の日付を引き継ぐ（前の行より早い時刻なら翌日）。開始予定は前の行の完了予定（推定）。"""
    if not isinstance(raw, dict):
        raise Cm3Error("CM3応答の形式が不正です")
    if raw.get("status") != "SUCCESS":
        raise Cm3Error(f"CM3応答 status={raw.get('status')}")
    entity = raw.get("entity") or {}
    if entity.get("error"):
        raise Cm3Error(f"CM3エラー: {fix_text(entity.get('errorMessage')) or '詳細不明'}")

    update_dt = _ts_to_dt(entity.get("updateTs"))
    base_year = (update_dt or datetime.now(JST)).year
    cur_month = update_dt.month if update_dt else None
    cur_day = update_dt.day if update_dt else None
    prev_dt = prev_end = None
    lot_count, items = {}, []

    for idx, m in enumerate(entity.get("meisaiList") or [], start=1):
        raw_kanryo = fix_text(m.get("kanryoYotei") or "")
        kanryo_dt = None
        md, mt = _DATE_TIME.match(raw_kanryo), _TIME_ONLY.match(raw_kanryo)
        if md:
            cur_month, cur_day = int(md.group(1)), int(md.group(2))
            hh, mm = int(md.group(3)), int(md.group(4))
        elif mt:
            hh, mm = int(mt.group(1)), int(mt.group(2))
        else:
            hh = mm = None
        if hh is not None and cur_month is not None:
            year = base_year
            if update_dt and cur_month < update_dt.month - 6:        # 12 月に見た 1 月の予定は翌年
                year += 1
            try:
                kanryo_dt = datetime(year, cur_month, cur_day, hh, mm, tzinfo=JST)
                if prev_dt and kanryo_dt < prev_dt and not md:
                    kanryo_dt += timedelta(days=1)
                    cur_month, cur_day = kanryo_dt.month, kanryo_dt.day
                prev_dt = kanryo_dt
            except ValueError:
                kanryo_dt = None

        item = {
            "seq": idx, "setsubi": own_setsubi, "kanryoYoteiRaw": raw_kanryo,
            "kanryoYotei": kanryo_dt.strftime("%m/%d %H:%M") if kanryo_dt else raw_kanryo,
            "kanryoYoteiIso": kanryo_dt.isoformat() if kanryo_dt else None,
            "startYotei": prev_end.strftime("%m/%d %H:%M") if prev_end else "",
            "startYoteiIso": prev_end.isoformat() if prev_end else None,
            "teisiStyle": m.get("teisiStyle"), "rowStyle": m.get("rowStyle"), "passNo": None, "passTotal": None,
        }
        if kanryo_dt:
            prev_end = kanryo_dt
        if is_stop_row(m):
            item.update({"rowKind": "stop", "isStop": True, "stopText": _stop_text(m), "lotNo": "", "zaishitsu": "", "inItaAtsu": "",
                         "outItaAtsu": "", "reductionRate": None, "reienHaba": "", "seihinItaAtsu": "", "seihinItaHaba": "",
                         "keijo": "", "yotoMei": "", "jiKotei": "", "selfNext": False})
        else:
            lot = fix_text(m.get("lotNo") or "")
            yoto = fix_text(m.get("yotoMeiFull") or m.get("yotoMei") or "")
            ji_kotei = fix_text(m.get("jiKotei") or "")
            kind = "inspect" if is_inspect_row(lot, yoto, inspect_keywords) else "lot"
            if kind == "lot":
                lot_count[lot] = lot_count.get(lot, 0) + 1
                item["passNo"] = lot_count[lot]
            item.update({"rowKind": kind, "isStop": False, "stopText": "", "lotNo": lot,
                         "zaishitsu": fix_text(m.get("zaishitsu") or ""), "inItaAtsu": fix_text(m.get("inItaAtsu") or ""),
                         "outItaAtsu": fix_text(m.get("outItaAtsu") or ""), "reductionRate": _reduction(m.get("inItaAtsu"), m.get("outItaAtsu")),
                         "reienHaba": fix_text(m.get("reienHaba") or ""), "seihinItaAtsu": fix_text(m.get("seihinItaAtsu") or ""),
                         "seihinItaHaba": fix_text(m.get("seihinItaHaba") or ""), "keijo": fix_text(m.get("keijo") or ""),
                         "yotoMei": yoto, "jiKotei": ji_kotei, "selfNext": ji_kotei == own_setsubi})
        items.append(item)
    for it in items:
        if it["rowKind"] == "lot":
            it["passTotal"] = lot_count.get(it["lotNo"], 1)
    return {
        "setsubi": entity.get("setsubiName") or own_setsubi, "termKbn": entity.get("termKbn"), "updateTs": entity.get("updateTs"),
        "updateTime": update_dt.strftime("%Y/%m/%d %H:%M:%S") if update_dt else None,
        "count": sum(1 for i in items if i["rowKind"] == "lot"),
        "inspectCount": sum(1 for i in items if i["rowKind"] == "inspect"),
        "stopCount": sum(1 for i in items if i["rowKind"] == "stop"),
        "items": items,
    }


def get_schedule(cfg, setsubi, term_kbn, inspect_keywords=None):
    return normalize(fetch_raw(cfg, setsubi, term_kbn), setsubi, inspect_keywords)


# ---------------------------------------------------------------- 一覧の表の形
KIND_LABEL = {"lot": "製造", "inspect": "点検", "stop": "設備停止"}
# 一覧の表（予定）の列: (列名, 答えの項目)。並びは ScheduleView の既定の列の並び（No・完了予定・ロットNo・パス…）に、
# 区分（製造・点検・設備停止）・総パス・停止内容と、日時で並べる・期間で絞る（タイムライン）ための 完了予定日時・開始予定日時 を足す
COLUMNS = [
    ("No", "seq"), ("完了予定", "kanryoYotei"), ("区分", "rowKind"), ("ロットNo", "lotNo"), ("パス", "passNo"), ("総パス", "passTotal"),
    ("材質", "zaishitsu"), ("入側板厚", "inItaAtsu"), ("出側板厚", "outItaAtsu"), ("圧下率", "reductionRate"), ("冷延幅", "reienHaba"),
    ("製品板厚", "seihinItaAtsu"), ("製品幅", "seihinItaHaba"), ("形状", "keijo"), ("用途名", "yotoMei"), ("次工程", "jiKotei"),
    ("停止内容", "stopText"), ("設備", "setsubi"), ("開始予定", "startYotei"), ("完了予定日時", "kanryoYoteiIso"), ("開始予定日時", "startYoteiIso"),
]
COLUMN_NAMES = [c for c, _ in COLUMNS]
def _iso_local(v):
    """"2026-10-19T14:05:00+09:00" → "2026-10-19 14:05"（現場の時刻のまま。日付として読める形）"""
    return str(v)[:16].replace("T", " ") if v else None


def table_rows(data):
    """整えた答え → 表の行（列の並びは COLUMNS）。板厚・幅は CM3 の字のまま（"0.300"。並べ替え・比べる所は一覧が数として扱う）、
    No・パス・総パス・圧下率は数。空の字は空欄（NULL）"""
    out = []
    for it in data.get("items") or []:
        row = []
        for _, key in COLUMNS:
            v = it.get(key)
            if key == "rowKind":
                v = KIND_LABEL.get(v, "")
            elif key in ("kanryoYoteiIso", "startYoteiIso"):
                v = _iso_local(v)
            if v == "":
                v = None
            row.append(v)
        out.append(row)
    return out
