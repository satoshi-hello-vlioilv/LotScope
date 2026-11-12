# -*- coding: utf-8 -*-
"""基準の数（稼働直・稼働日・換算稼働日・稼働率・直あたり重量）の独立の答え（版 3.103.0）。

app を import しない（sqlite3・json・datetime だけ）。作業実績のファイルを自分で読み、作業開始の日時から勤務体系で作業日と直を決め
（日を跨ぐ直の跨いだ後は日付補正。未設定は -1）、設備 × 作業日 × 直を数えて、仕様（services/capacity.py の冒頭・利用者に見せる定義）どおりに
数を出す。Python の集計（pivot.query_many）・窓（desktop/src/capacity.rs）の答えと比べる係（tests/test_capacity.py・tools/ui-eval-capacity.mjs）。

    python tools/capacity-truth.py 入力.json      → 答えの JSON を標準出力へ

入力: {"now": "YYYY-MM-DD HH:MM:SS",
       "equipment": [{"name", "path", "table"（省けば最初の表）, "start": 作業開始の列, "weight": 重量の列, "segments": [{"name", "start", "end", "dayOffset"}]}],
       "views": [{"id", "kind": "equip" | "equip_month" | "day" | "equip_shift", "period": {"kind": "days"|"yesterday"|"days_before", "n"} | null}]}
作業開始の字は「YYYY/MM/DD H:MM[:SS]」「YYYY-MM-DD HH:MM[:SS]」だけを読む（読めない行の数を unread に出す。試験はそれが 0 のデータで比べる）。
答え: {"unread": n, "views": {id: {"cells": [{"r": [鍵…], "稼働直", "稼働日", "1日の直数", "期間の日数", "期間の直数", "換算稼働日", "稼働率",
       "重量", "重量/稼働直", "重量/換算稼働日", "行"}]}}}  鍵は equip → [設備名]・equip_month → [設備名, 年月]（設備名 "" は総計）・
       day → [作業日]・equip_shift → [設備名, 直の名前]。[] は総計
"""
import json
import re
import sqlite3
import sys
from datetime import date, datetime, timedelta

STAMP = re.compile(r"^\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*$")


def minutes(hm):
    h, m = hm.split(":")
    return int(h) * 60 + int(m)


def place(segs, stamp):
    """日時 → (作業日, 直の番号か -1)。勤務体系の決め方を仕様から書いたもの（WaveLog の resolve_shift_info と同じ考え）"""
    d = date(stamp.year, stamp.month, stamp.day)
    m = stamp.hour * 60 + stamp.minute
    for i, s in enumerate(segs):
        a, b = minutes(s["start"]), minutes(s["end"])
        if b <= a:                                  # 日を跨ぐ直
            off = s.get("dayOffset")
            off = -1 if off is None else int(off)
            if m >= a:
                return d.isoformat(), i
            if m < b:
                return (d + timedelta(days=off)).isoformat(), i
        elif a <= m < b:
            return d.isoformat(), i
    return d.isoformat(), -1


def read(eq):
    c = sqlite3.connect(f"file:{eq['path']}?mode=ro", uri=True)
    table = eq.get("table") or c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY rowid").fetchone()[0]   # 表が 1 つのファイル
    rows = c.execute(f'SELECT "{eq["start"]}", "{eq["weight"]}" FROM "{table}"').fetchall()
    c.close()
    out, bad = [], 0
    for st, w in rows:
        m = STAMP.match(str(st or ""))
        if not m:
            bad += 1
            continue
        y, mo, d, h, mi, s = m.groups()
        t = datetime(int(y), int(mo), int(d), int(h), int(mi), int(s or 0))
        day, idx = place(eq["segments"], t)
        try:
            wf = float(w)
        except (TypeError, ValueError):
            wf = None
        out.append({"day": day, "shift": idx, "w": wf})
    return out, bad


def period_of(eq, p, now):
    if not p:
        return None
    today, _ = place(eq["segments"], now)
    t = date.fromisoformat(today)
    n = int(p.get("n") or 7)
    if p["kind"] == "days":
        return (t - timedelta(days=n - 1)).isoformat(), today
    if p["kind"] == "yesterday":
        y = (t - timedelta(days=1)).isoformat()
        return y, y
    if p["kind"] == "days_before":
        return (t - timedelta(days=n)).isoformat(), (t - timedelta(days=1)).isoformat()
    raise ValueError(p["kind"])


def span_days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days + 1


def month_span(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    nxt = date(y + m // 12, m % 12 + 1, 1)
    return f"{ym}-01", (nxt - timedelta(days=1)).isoformat()


def cell(eqs, data, ranges, keep, members, clip=None, shift_name=None):
    """1 つのセルの数。keep(設備, 行) → その行がセルに入るか。members … 足す設備の名前。clip … 期間を切る日の範囲。shift_name … 直の段の名前"""
    per = []
    days_all = []
    for e in eqs:
        if e["name"] not in members:
            continue
        rows = [r for r in data[e["name"]] if keep(e, r)]
        sh = {(r["day"], r["shift"]) for r in rows if r["shift"] >= 0}
        dy = {r["day"] for r in rows}
        days_all += [r["day"] for r in rows]
        spd = len(e["segments"]) if shift_name is None else sum(1 for s in e["segments"] if s["name"] == shift_name)
        rng = ranges[e["name"]]
        if rng and clip:
            rng = (max(rng[0], clip[0]), min(rng[1], clip[1]))
        per.append({"e": e["name"], "sh": len(sh), "dy": len(dy), "spd": spd, "rng": rng,
                    "w": sum(r["w"] for r in rows if r["w"] is not None), "n": len(rows)})
    cell_span = span_days(min(days_all), max(days_all)) if days_all else 0
    for x in per:
        x["pd"] = (span_days(*x["rng"]) if x["rng"][0] <= x["rng"][1] else 0) if x["rng"] else cell_span
    if any(x["rng"] for x in per):
        days = set()
        for x in per:
            if x["rng"] and x["rng"][0] <= x["rng"][1]:
                d0 = date.fromisoformat(x["rng"][0])
                days |= {d0 + timedelta(days=k) for k in range(span_days(*x["rng"]))}
        pdays = len(days)
    else:
        pdays = cell_span
    sh, dy = sum(x["sh"] for x in per), sum(x["dy"] for x in per)
    spds = {x["spd"] for x in per}
    psh = sum(x["pd"] * x["spd"] for x in per)
    cdy = sum(x["sh"] / x["spd"] for x in per) if all(x["spd"] for x in per) else None
    w = sum(x["w"] for x in per)
    return {"稼働直": sh, "稼働日": dy, "1日の直数": spds.pop() if len(spds) == 1 else None, "期間の日数": pdays, "期間の直数": psh,
            "換算稼働日": cdy, "稼働率": sh / psh * 100 if psh else None, "重量": w, "重量/稼働直": w / sh if sh else None,
            "重量/換算稼働日": w / cdy if cdy else None, "行": sum(x["n"] for x in per)}


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    now = datetime.fromisoformat(spec["now"])
    eqs = spec["equipment"]
    data, unread = {}, 0
    for e in eqs:
        data[e["name"]], bad = read(e)
        unread += bad
    names = {e["name"] for e in eqs}
    out = {}
    for v in spec["views"]:
        ranges = {e["name"]: period_of(e, v.get("period"), now) for e in eqs}

        def inside(e, r, ranges=ranges):
            g = ranges[e["name"]]
            return not g or g[0] <= r["day"] <= g[1]
        cells = []
        if v["kind"] == "equip":
            for e in eqs:
                if any(inside(e, r) for r in data[e["name"]]):
                    cells.append({"r": [e["name"]], **cell(eqs, data, ranges, inside, {e["name"]})})
            cells.append({"r": [], **cell(eqs, data, ranges, inside, names)})
        elif v["kind"] == "equip_month":
            months = sorted({r["day"][:7] for e in eqs for r in data[e["name"]]})
            for ym in months:
                def keep(e, r, ym=ym):
                    return r["day"][:7] == ym
                for e in eqs:
                    if any(keep(e, r) for r in data[e["name"]]):
                        cells.append({"r": [e["name"], ym], **cell(eqs, data, ranges, keep, {e["name"]})})
                cells.append({"r": ["", ym], **cell(eqs, data, ranges, keep, names)})
            for e in eqs:
                cells.append({"r": [e["name"], ""], **cell(eqs, data, ranges, lambda e2, r: True, {e["name"]})})
            cells.append({"r": [], **cell(eqs, data, ranges, lambda e2, r: True, names)})
        elif v["kind"] == "day":
            days = sorted({r["day"] for e in eqs for r in data[e["name"]] if inside(e, r)})
            for d in days:
                cells.append({"r": [d], **cell(eqs, data, ranges, lambda e, r, d=d: inside(e, r) and r["day"] == d, names, clip=(d, d))})
            cells.append({"r": [], **cell(eqs, data, ranges, inside, names)})
        elif v["kind"] == "equip_shift":
            for e in eqs:
                for i, s in enumerate(e["segments"]):
                    def keep(e2, r, i=i):
                        return inside(e2, r) and r["shift"] == i
                    if any(keep(e, r) for r in data[e["name"]]):
                        cells.append({"r": [e["name"], s["name"]], **cell(eqs, data, ranges, keep, {e["name"]}, shift_name=s["name"])})
        out[v["id"]] = {"cells": cells}
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump({"unread": unread, "views": out}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
