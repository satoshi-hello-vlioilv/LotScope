# -*- coding: utf-8 -*-
"""直（勤務体系・勤務区分）。WaveLog の勤務体系マスタ（backend/repositories/schedule_repo.py の勤務体系・勤務区分・日付補正）と、
作業スケジュールの「日付＋勤務」のまとめ方（backend/schedule_calc.py の resolve_shift_info・_assign_work_dates）を移したもの。

現場の言い方どおりの 2 階層:
    日勤              → 日勤 08:15〜17:05
    交替勤務(1,2,3直) → 1直 07:00〜15:00 / 2直 15:00〜23:00 / 3直 23:00〜翌07:00
    交替勤務(4,5直)   → 4直 11:00〜19:10 / 5直 21:20〜翌05:45

置き場: MasterStore のマスタ `shift_patterns`（共有フォルダがあれば共有。全員で 1 つ）。
    行: {id, 名称, 適用設備, 区分, 表示順, 備考, rev, updated_at, updated_by}
    適用設備 … 設備名をカンマ区切り。空＝全設備共通（設備を書いた体系があれば、その設備ではそちらが先）
    区分     … [{name, start, end, dayOffset}] の JSON（並びが表示順）

日付補正（現場歴。WaveLog §9.195）
    日を跨ぐ区分（終了 <= 開始）の「跨いだ後の時間帯」にだけ当てる日数。未設定は -1（3直 23:00〜翌7:00 の翌2:00 は「その日の3直」）。
    こうすると 1 回の 3直が暦をまたいでも同じ日付になり、「日付＋直」でまとめたときに 1 つの塊になる。
    跨がない区分には効かない（当てる時間帯が無い）ので持たせない。日付の演算をここに埋め込まない（マスタの 1 列で直せる形）。
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta

from .identity import normalize_part

NAME = "shift_patterns"
FIELDS = ["名称", "適用設備", "区分", "表示順", "備考"]
DAYOFF_DEFAULT = -1
DAYOFF_LIMIT = 7
NAME_MAX = 40
SEGMENTS_MAX = 12
# よくある勤務体系（マスタ管理でひと押しで入れる。WaveLog の SHIFT_TEMPLATES と同じ）
TEMPLATES = [
    {"label": "日勤", "segments": [{"name": "日勤", "start": "08:15", "end": "17:05"}]},
    {"label": "交替勤務(1,2,3直)", "segments": [
        {"name": "1直", "start": "07:00", "end": "15:00"}, {"name": "2直", "start": "15:00", "end": "23:00"},
        {"name": "3直", "start": "23:00", "end": "07:00", "dayOffset": -1}]},
    {"label": "交替勤務(4,5直)", "segments": [
        {"name": "4直", "start": "11:00", "end": "19:10"}, {"name": "5直", "start": "21:20", "end": "05:45", "dayOffset": -1}]},
]
_HM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
_EQ_SPLIT = re.compile(r"[,、，\n]+")


class ShiftError(ValueError):
    pass


def hm(v):
    """'8:15' → 495（0 時からの分）。読めなければ None。"""
    m = _HM.match(str(v or "").strip())
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def pad_hm(v):
    """'8:15' → '08:15'（HH:MM へそろえて置く。画面の input[type=time] は 2 桁の時しか読まない）。"""
    m = hm(v)
    return f"{m // 60:02d}:{m % 60:02d}" if m is not None else str(v or "").strip()


def crosses_midnight(start, end):
    """日を跨ぐ区分か（終了 <= 開始）。判定はここ 1 か所。"""
    a, b = hm(start), hm(end)
    return a is not None and b is not None and b <= a


def day_offset(start, end, raw):
    """この区分の「跨いだ後の時間帯」に当てる日付補正。跨がない区分は必ず 0。未設定は -1。"""
    if not crosses_midnight(start, end):
        return 0
    if raw in (None, ""):
        return DAYOFF_DEFAULT
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return DAYOFF_DEFAULT
    return max(-DAYOFF_LIMIT, min(DAYOFF_LIMIT, n))


def clean_segments(segments):
    """画面から来た区分 → 置く形 [{name, start, end, dayOffset}]。合わなければ ShiftError（理由つき）。"""
    if isinstance(segments, str):
        try:
            segments = json.loads(segments or "[]")
        except ValueError as e:
            raise ShiftError("勤務区分の形が読めません。") from e
    if not isinstance(segments, list):
        raise ShiftError("勤務区分の形が違います（区分の並び）。")
    if len(segments) > SEGMENTS_MAX:
        raise ShiftError(f"勤務区分は {SEGMENTS_MAX} までです。")
    out, names = [], set()
    for seg in segments:
        seg = seg if isinstance(seg, dict) else {}
        name = str(seg.get("name") or "").strip()[:NAME_MAX]
        start, end = str(seg.get("start") or "").strip(), str(seg.get("end") or "").strip()
        if not name:
            raise ShiftError("勤務区分の名称を入れてください。")
        if name in names:
            raise ShiftError(f"勤務区分「{name}」が 2 つあります。名前を分けてください。")
        names.add(name)
        if hm(start) is None or hm(end) is None:
            raise ShiftError(f"「{name}」の時刻は HH:MM（00:00〜23:59）で入れてください。")
        if hm(start) == hm(end):
            raise ShiftError(f"「{name}」の開始と終了が同じです。")
        raw = seg.get("dayOffset")
        off = None
        if raw not in (None, "") and crosses_midnight(start, end):      # 跨がない区分には持たせない（効かない値を置かない）
            try:
                off = max(-DAYOFF_LIMIT, min(DAYOFF_LIMIT, int(raw)))
            except (TypeError, ValueError) as e:
                raise ShiftError(f"「{name}」の日付の数え方は整数（日数）で入れてください。") from e
        out.append({"name": name, "start": pad_hm(start), "end": pad_hm(end), "dayOffset": off})
    return out


def equipment_list(v):
    """適用設備（カンマ区切りの字・並び）→ 設備名の並び（前後の空白を除き、同じ名前は 1 つ）。"""
    items = v if isinstance(v, list) else _EQ_SPLIT.split(str(v or ""))
    out = []
    for x in items:
        s = str(x or "").strip()
        if s and all(normalize_part(s) != normalize_part(y) for y in out):
            out.append(s)
    return out


def clean_row(data, partial=False):
    """画面から来た値（name・equipment・segments・order・note）→ マスタの行。partial は直すとき（来た物だけ）。"""
    out = {}
    if not partial or "name" in data:
        name = str(data.get("name") or "").strip()
        if not name:
            raise ShiftError("勤務体系の名称を入れてください。")
        out["名称"] = name[:NAME_MAX]
    if not partial or "equipment" in data:
        out["適用設備"] = ",".join(equipment_list(data.get("equipment")))
    if not partial or "segments" in data:
        segs = clean_segments(data.get("segments"))
        if not segs:
            raise ShiftError("勤務区分を 1 つ以上入れてください（テンプレートから入れられます）。")
        out["区分"] = json.dumps(segs, ensure_ascii=False, separators=(",", ":"))
    if "order" in data:
        try:
            out["表示順"] = str(int(data.get("order")))
        except (TypeError, ValueError):
            out["表示順"] = ""
    if not partial or "note" in data:
        out["備考"] = str(data.get("note") or "").strip()[:200]
    return out


def segments_of(row):
    """行の区分 → [{name, start, end, dayOffset（効いている値）}]。壊れた区分は飛ばす（読むだけなので止めない）。"""
    try:
        raw = json.loads(row.get("区分") or "[]")
    except (TypeError, ValueError):
        raw = []
    out = []
    for seg in raw if isinstance(raw, list) else []:
        if isinstance(seg, dict) and hm(seg.get("start")) is not None and hm(seg.get("end")) is not None and seg.get("name"):
            s, e = pad_hm(seg["start"]), pad_hm(seg["end"])
            out.append({"name": str(seg["name"]), "start": s, "end": e, "dayOffset": day_offset(s, e, seg.get("dayOffset")),
                        "crosses": crosses_midnight(s, e)})
    return out


def _order(row):
    try:
        return int(row.get("表示順") or 0)
    except (TypeError, ValueError):
        return 0


def view(row):
    """画面へ出す形。"""
    eq = equipment_list(row.get("適用設備"))
    return {"id": row.get("id"), "name": row.get("名称") or "", "equipment": eq, "equipmentText": "・".join(eq) or "全設備共通",
            "segments": segments_of(row), "order": _order(row), "note": row.get("備考") or "", "rev": row.get("rev", 1),
            "updated_at": row.get("updated_at", ""), "updated_by": row.get("updated_by") or {}}


def pattern_for(rows, equipment):
    """その設備で使う勤務体系（view の形）。設備名を書いた体系が先、無ければ全設備共通。同じ段に複数あれば表示順で最初。無ければ None。"""
    ordered = sorted(rows, key=lambda r: (_order(r), int(r.get("id") or 0)))
    key = normalize_part(equipment or "")
    if key:
        for r in ordered:
            if any(normalize_part(x) == key for x in equipment_list(r.get("適用設備"))) and segments_of(r):
                return view(r)
    for r in ordered:
        if not equipment_list(r.get("適用設備")) and segments_of(r):
            return view(r)
    return None


# ------------------------------------------------------------------ 時刻 → 直・現場歴の日付
OUTSIDE = -1      # 時刻はあるが、どの区分にも入らない（直の間の空き時間など）
NO_TIME = -2      # 時刻が無い（日付だけ）


class Clock:
    """区分の並び → 時刻（分）から（区分の番号, 日付補正）を答える係（WaveLog の resolve_shift_info と同じ決め方）。"""

    def __init__(self, segments):
        self.segments = list(segments or [])
        self._spans = [(hm(s["start"]), hm(s["end"]), s["dayOffset"]) for s in self.segments]

    def resolve(self, minute):
        """→ (区分の番号 or OUTSIDE, 日付補正)。跨ぐ区分は、開始より後は補正 0・終了より前（跨いだ後）は日付補正。"""
        for i, (s, e, off) in enumerate(self._spans):
            if e <= s:
                if minute >= s:
                    return i, 0
                if minute < e:
                    return i, off
            elif s <= minute < e:
                return i, 0
        return OUTSIDE, 0

    def place(self, stamp, basis="work"):
        """日時の字（'YYYY-MM-DD[ HH:MM:SS]'）→ (日付 'YYYY-MM-DD', 区分の番号)。
        basis="work" は現場歴（日付補正を当てる）、"cal" は太陽暦（暦の日付のまま。直は同じ）。読めなければ ("", NO_TIME)。"""
        if not stamp:
            return "", NO_TIME
        day = stamp[:10]
        if len(stamp) < 16:
            return day, NO_TIME
        idx, off = self.resolve(int(stamp[11:13]) * 60 + int(stamp[14:16])) if self.segments else (OUTSIDE, 0)
        if off and basis == "work":
            day = (date.fromisoformat(day) + timedelta(days=off)).isoformat()
        return day, idx
