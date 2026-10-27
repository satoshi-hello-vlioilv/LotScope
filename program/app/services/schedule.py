# -*- coding: utf-8 -*-
"""スケジュール（CM3 の設備ごとの作業予定。ScheduleView を移した。版 3.57.0）。

ScheduleView は「CM3 の作業予定」と「仕掛台帳（LOTNOW.sqlite3）」を自前で写して突き合わせていた。LotScope では、
仕掛はすでにデータ元「仕掛」（wip）として手元へ写して読んでいるので、写しも突合せも共通の仕組みに乗せる:

  CM3 ──(cm3_schedule.py: 取得・整形)──▶ 設備ごとの表「予定」（この PC の作業場所の db_cache/schedule。手元の SQLite）
                                              │  データ元「スケジュール」（sch）の結合（data_join.py。既定: ロットNo = 仕掛のロット番号）
                                              ▼
                                         一覧・スライサー・集計表・ダッシュボード・Excel（今までと同じ仕組みが読む）
  HOT コイル作業順 … HOT の設備（既定 L-1・L-2・L-3）の結合した答えから、前工程が HOT で次の設備がその設備の 1 パス目を
                    完了予定の順に並べた表「HOT」（build_hot）

設定（配った設定 config/appsettings.json の schedule。CM3 の URL・端末の IP・設備・点検の言葉は参照先マスタで直せる）:
  cm3_base_url・init_path・client_ip・timeout_sec・use_system_proxy … CM3 への問い合わせ
  cm3_view_url_template … 「CM3 の画面を開く」（{base}・{setsubi}・{termkbn}）
  equipments            … 設備のタブ（「L-1, L-2, L-3」。端末区分が違う設備は「L-9:2」のように : の後ろに書く。既定は term_kbn）
  inspect_keywords      … 点検の行の言葉（「点検板」。「、」「,」で区切って複数）
  cache_sec             … 同じ設備を続けて取りに行かない秒（ScheduleView と同じ 10 秒）
  auto_refresh_sec      … 画面を開いている間、CM3 を取り直す間隔（既定 60 秒。画面は新しい予定が来たら自分で出し直す）
  hot                   … HOT コイル作業順（title・equipments〈空なら全設備〉・prev_value・result_course_column・
                          remain_course_column・kama_column）

置き方: 中身が変わったときだけ、新しい世代のファイル（<設備>.g<番号>.sqlite3）に書く（Windows では読んでいる途中のファイルを
置き換えられないため。db_mirror.py と同じ考え）。古い世代は次に書くときに消す（消せなければその次）。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import cm3_schedule
from .cm3_schedule import Cm3Error
from .sqlite_ro import connect_ro, qi

HOT_KEY = "__HOT__"
TABLE = "予定"
HOT_TABLE = "HOT"
DEFAULTS = {
    "cm3_base_url": "http://nlmfangyweb1a:9085",
    "init_path": "/Cm3SchWeb/service/schapp/cmschview/init",
    "cm3_view_url_template": "{base}/Cm3SchWeb/#/schapp/cmschview?termkbn={termkbn}&setsubi={setsubi}",
    "client_ip": "150.150.107.35",
    "equipments": "L-1, L-2, L-3",
    "term_kbn": "4",
    "inspect_keywords": "点検板",
    "timeout_sec": 15,
    "use_system_proxy": False,
    "cache_sec": 10,
    "auto_refresh_sec": 60,
    "hot": {"title": "HOTコイル作業順", "equipments": "", "prev_value": "HOT", "result_course_column": "実績_設備ｺｰｽ",
            "remain_course_column": "残仕掛設備ｺｰｽ", "kama_column": "設計_PIT炉番炉順"},
}
_SPLIT = re.compile(r"[,、，\s]+")


def _words(v):
    if isinstance(v, (list, tuple)):
        v = ",".join(str(x) for x in v)
    return [w for w in _SPLIT.split(str(v or "")) if w]


def config(settings):
    """設定 schedule を既定に重ねた形（設備・点検の言葉・HOT の設備は並びにする）。"""
    raw = dict((settings or {}).get("schedule") or {})
    cfg = {**DEFAULTS, **{k: v for k, v in raw.items() if v not in (None, "") and k != "hot"}}
    cfg["hot"] = {**DEFAULTS["hot"], **{k: v for k, v in (raw.get("hot") or {}).items() if v not in (None, "")}}
    eqs = []
    for w in _words(cfg["equipments"]):
        code, _, kbn = w.partition(":")
        if code and code not in [e["code"] for e in eqs]:
            eqs.append({"code": code, "name": code, "term_kbn": kbn or str(cfg["term_kbn"])})
    cfg["equipments"] = eqs
    cfg["inspect_keywords"] = _words(cfg["inspect_keywords"])
    codes = [e["code"] for e in eqs]
    hot = cfg["hot"]
    hot["equipments"] = [e for e in (_words(hot["equipments"]) or codes) if e in codes]
    return cfg


def view_url(cfg, code):
    """「CM3 の画面を開く」の URL（HOT のときは空）。"""
    e = next((x for x in cfg["equipments"] if x["code"] == code), None)
    if e is None:
        return ""
    from urllib.parse import quote
    return str(cfg["cm3_view_url_template"]).replace("{base}", str(cfg["cm3_base_url"]).rstrip("/")) \
        .replace("{setsubi}", quote(code)).replace("{termkbn}", quote(str(e["term_kbn"])))


def norm_name(s):
    """列名の比べ方（ScheduleView と同じ: 全角半角・大小・区切りの _ - . ・ 空白を見ない）。"""
    return re.sub(r"[\s_\-\.・]", "", unicodedata.normalize("NFKC", str(s or "")).upper())


def norm_key(v):
    """値の比べ方（ScheduleView と同じ: NFKC・大文字・空白を除く・数は数で）。"""
    if v is None:
        return ""
    s = re.sub(r"\s", "", unicodedata.normalize("NFKC", str(v)).upper())
    if re.fullmatch(r"[+-]?\d+(\.\d+)?", s):
        return ("%.6f" % float(s)).rstrip("0").rstrip(".")
    return s


def find_column(cols, name):
    """表の列のうち name に当たる物（そのまま → 比べ方をそろえて）。無ければ ""。"""
    if name in cols:
        return name
    n = norm_name(name)
    return next((c for c in cols if norm_name(c) == n), "")


def _safe(code):
    return re.sub(r"[^0-9A-Za-z_\-]", "_", code) + "-" + hashlib.sha1(code.encode("utf-8")).hexdigest()[:6]


class Schedules:
    """設備ごとの予定を覚え、手元の表に置く係（アプリに 1 つ）。同じ設備を同時に取りに行かない（先に取りに行った答えを待って使う）。"""

    def __init__(self, root, fetch=cm3_schedule.get_schedule):
        self.root = Path(root)
        self.fetch = fetch                  # 試験は作り物に差し替える
        self._lock = threading.Lock()
        self._eq_locks = {}
        self._state = {}                    # 設備 → {data, path, sig, fetchedAt, changedAt, checkedAt, error, gen}
        self._bg = set()                    # 裏で取りに行っている設備

    # ------------------------------------------------------------ 取る
    def _eq_lock(self, code):
        with self._lock:
            return self._eq_locks.setdefault(code, threading.Lock())

    def peek(self, code):
        with self._lock:
            return dict(self._state.get(code) or {})

    def _age(self, code):
        st = self.peek(code)
        return time.time() - st["checkedAt"] if st.get("checkedAt") else None

    def ensure(self, cfg, code, *, max_age=None, force=False):
        """設備 code の予定を、max_age 秒より古ければ取り直して表に置く → 覚え（peek の形）。
        取れなかったら、前に取れた答えがあればそれを使い続ける（error に理由）。一度も取れていなければ Cm3Error。"""
        e = next((x for x in cfg["equipments"] if x["code"] == code), None)
        if e is None:
            raise Cm3Error(f"未登録の設備です: {code}")
        max_age = cfg["cache_sec"] if max_age is None else max_age
        lk = self._eq_lock(code)
        with lk:                                     # 同じ設備は 1 本ずつ（後から来た問い合わせは、先の答えを待って使う）
            age = self._age(code)
            st = self.peek(code)
            if not force and st.get("path") and age is not None and age < max_age:
                return st
            now = time.time()
            try:
                data = self.fetch(cfg, code, e["term_kbn"], cfg["inspect_keywords"])
            except Cm3Error as err:
                with self._lock:
                    cur = self._state.setdefault(code, {})
                    cur.update(checkedAt=now, error=str(err))
                    st = dict(cur)
                if not st.get("path"):
                    raise
                return st
            data["fetchedAt"] = time.strftime("%Y/%m/%d %H:%M:%S", time.localtime(now))
            self._store(code, data, now)
            return self.peek(code)

    def ensure_many(self, cfg, codes, *, max_age=None, force=False):
        """いくつかの設備を同時に取りに行く（待ちはいちばん遅い設備の分だけ）→ {設備: 覚え か Cm3Error}"""
        def one(c):
            try:
                return self.ensure(cfg, c, max_age=max_age, force=force)
            except Cm3Error as err:
                return err
        if len(codes) <= 1:
            return {c: one(c) for c in codes}
        with ThreadPoolExecutor(max_workers=min(8, len(codes))) as ex:
            return dict(zip(codes, ex.map(one, codes)))

    def refresh_later(self, cfg, codes):
        """古くなった設備を裏で取り直す（画面の鮮度の問い合わせから。答えは待たない）。"""
        due = [c for c in codes if (self._age(c) is None or self._age(c) >= cfg["auto_refresh_sec"]) and c not in self._bg]
        for c in due:
            with self._lock:
                if c in self._bg:
                    continue
                self._bg.add(c)

            def run(c=c):
                try:
                    self.ensure(cfg, c, max_age=cfg["auto_refresh_sec"])
                except Exception:
                    pass
                finally:
                    with self._lock:
                        self._bg.discard(c)
            threading.Thread(target=run, name=f"schedule-{c}", daemon=True).start()
        return due

    # ------------------------------------------------------------ 置く
    def _store(self, code, data, now):
        rows = cm3_schedule.table_rows(data)
        sig = hashlib.sha1(json.dumps(rows, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()
        with self._lock:
            cur = dict(self._state.get(code) or {})
        if cur.get("sig") != sig or not cur.get("path") or not Path(cur["path"]).exists():
            gen = int(cur.get("gen") or 0) + 1
            path = self.root / f"{_safe(code)}.g{gen}.sqlite3"
            write_table(path, TABLE, cm3_schedule.COLUMN_NAMES, rows)
            cur.update(path=str(path), sig=sig, gen=gen, changedAt=now)
            self._sweep(code, path)
        cur.update(data=data, fetchedAt=now, checkedAt=now, error="")
        with self._lock:
            self._state[code] = cur

    def _sweep(self, code, keep):
        """古い世代を消す（読んでいて消せなければ次の機会に）。"""
        for p in self.root.glob(f"{_safe(code)}.g*.sqlite3"):
            if p != keep:
                try:
                    p.unlink()
                except OSError:
                    pass

    # ------------------------------------------------------------ HOT コイル作業順
    def build_hot(self, cfg, parts, errors=()):
        """parts: [(設備, 結合した答えのファイル, 表)] → (HOT の表のファイル, 情報)。中身が前と同じならファイルは書き直さない。
        errors: 取れなかった設備の理由（「L-2: CM3に接続できません…」。情報に載せる）"""
        hot = cfg["hot"]
        items, cols_all, per, errors = [], [], {}, list(errors)
        counts = {"lots": 0, "noMaster": 0, "otherNext": 0, "laterPass": 0}
        found = {"resultColumn": "", "remainColumn": "", "kamaColumn": ""}
        prev_value = norm_key(hot["prev_value"])
        for code, path, table in parts:
            per[code] = 0
            with connect_ro(Path(path), timeout=5) as c:
                cur = c.execute(f"SELECT * FROM {qi(table)}")
                cols = [d[0] for d in cur.description]
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            for col in cols:
                if col not in cols_all:
                    cols_all.append(col)
            res = find_column(cols, hot["result_course_column"])
            rem = find_column(cols, hot["remain_course_column"])
            kama = find_column(cols, hot["kama_column"])
            found = {"resultColumn": found["resultColumn"] or res, "remainColumn": found["remainColumn"] or rem,
                     "kamaColumn": found["kamaColumn"] or kama}
            for r in rows:
                if r.get("区分") != cm3_schedule.KIND_LABEL["lot"]:
                    continue
                counts["lots"] += 1
                # 仕掛に当たったか: 仕掛から持ってきた HOT の列のどれかに値がある（当たらなかった行は相手の列が空）
                if not res or all(r.get(x) in (None, "") for x in (res, rem, kama) if x):
                    counts["noMaster"] += 1
                    continue
                hist = str(r.get(res) or "").split()
                prev = hist[-1] if hist else ""
                if norm_key(prev) != prev_value:
                    continue
                if rem:
                    nxt = str(r.get(rem) or "").split()
                    if nxt and norm_key(nxt[0]) != norm_key(code):     # 同じロットが別の線にも予定されている: HOT の直後の線だけ
                        counts["otherNext"] += 1
                        continue
                if (r.get("パス") or 1) != 1:                          # 2 パス目からは、この線の後（HOT の直後ではない）
                    counts["laterPass"] += 1
                    continue
                items.append({**r, "前工程": prev, "釜番": r.get(kama) if kama else None})
                per[code] += 1
        order = {e: i for i, e in enumerate(hot["equipments"])}
        items.sort(key=lambda r: (r.get("完了予定日時") or "9999", order.get(r.get("設備"), 99), r.get("No") or 0))
        lead = ["HOT順", "設備", "開始予定", "完了予定", "No", "ロットNo", "パス", "前工程", "釜番"]
        cols = lead + [c for c in cols_all if c not in lead]
        out = [[i if c == "HOT順" else r.get(c) for c in cols] for i, r in enumerate(items, 1)]
        sig = hashlib.sha1(json.dumps([cols, out], ensure_ascii=False, default=str).encode("utf-8")).hexdigest()
        with self._lock:
            cur = dict(self._state.get(HOT_KEY) or {})
        now = time.time()
        if cur.get("sig") != sig or not cur.get("path") or not Path(cur["path"]).exists():
            gen = int(cur.get("gen") or 0) + 1
            path = self.root / f"{_safe(HOT_KEY)}.g{gen}.sqlite3"
            write_table(path, HOT_TABLE, cols, out)
            cur.update(path=str(path), sig=sig, gen=gen, changedAt=now)
            self._sweep(HOT_KEY, path)
        info = {"title": hot["title"], "equipments": hot["equipments"], "prevValue": hot["prev_value"], **found,
                "kamaConfigured": hot["kama_column"], "perEquipment": per, "counts": counts, "errors": errors}
        cur.update(info=info, checkedAt=now)
        with self._lock:
            self._state[HOT_KEY] = cur
        return cur["path"], info


def write_table(path, table, cols, rows):
    """表を 1 つだけ持つ SQLite を書き切る（一時ファイルに書いて置き換える。読んでいる途中の画面に半端な物を見せない）。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.stem}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.unlink(missing_ok=True)
    c = sqlite3.connect(str(tmp))
    try:
        c.execute("PRAGMA journal_mode=OFF")
        c.execute(f"CREATE TABLE {qi(table)} ({', '.join(qi(x) for x in cols)})")
        if rows:
            c.executemany(f"INSERT INTO {qi(table)} VALUES ({', '.join('?' for _ in cols)})", rows)
        c.commit()
    finally:
        c.close()
    os.replace(tmp, path)


def summary(state, joined=None):
    """設備の表の上の数（ScheduleView の札と同じ: 製造件数・ロット数・点検・設備停止・仕掛と一致・先頭と最終の完了予定・CM3 の更新と取得）。
    joined: 結合の数（data_join の stats の 1 つ目。仕掛と当たった行の数）"""
    data = state.get("data") or {}
    items = data.get("items") or []
    lots = [i for i in items if i.get("rowKind") == "lot"]
    times = [i.get("kanryoYotei") for i in items if i.get("kanryoYotei")]
    hit = None
    if joined:
        hit = joined.get("hit")
    stop = next((i for i in items if i.get("rowKind") == "stop"), None)
    return {"count": len(lots), "lots": len({i.get("lotNo") for i in lots}), "inspect": data.get("inspectCount", 0),
            "stop": data.get("stopCount", 0), "hit": hit, "first": times[0] if times else "", "last": times[-1] if times else "",
            "nextStop": {"time": stop.get("kanryoYotei") or "", "text": stop.get("stopText") or ""} if stop else None,
            "updateTime": data.get("updateTime"), "fetchedAt": data.get("fetchedAt"), "error": state.get("error") or ""}


def missing_lots(path, table, brought):
    """結合した答えで、仕掛に当たらなかった製造の行のロットNo（区分の札「仕掛に無い」で絞る）。brought: 仕掛から持ってきた列"""
    if not brought:
        return []
    cond = " AND ".join(f"{qi(c)} IS NULL" for c in brought)
    with connect_ro(Path(path), timeout=5) as c:
        return sorted({r[0] for r in c.execute(f"SELECT {qi('ロットNo')} FROM {qi(table)} WHERE {qi('区分')} = ? AND {cond}",
                                               (cm3_schedule.KIND_LABEL["lot"],)) if r[0]})


def source_info(cfg, state, code):
    """一覧の「元データ」の札の答え（db_mirror.source_info と同じ形）。at は CM3 の更新、copiedAt は中身が変わって置き直した時刻。"""
    data = state.get("data") or {}
    ts = data.get("updateTs")
    at = None
    try:
        at = int(ts) / 1000 if ts is not None else None
    except (TypeError, ValueError):
        at = None
    return {"remote": view_url(cfg, code) or str(cfg["cm3_base_url"]), "at": at, "mirrored": bool(state.get("path")),
            "copiedAt": state.get("changedAt"), "checkedAt": state.get("checkedAt"), "unreachable": bool(state.get("error")),
            "reason": state.get("error") or "", "interval_sec": cfg["auto_refresh_sec"], "staleHours": 0, "ageHours": None,
            "stale": False, "kind": "cm3"}
