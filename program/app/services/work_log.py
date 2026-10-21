# -*- coding: utf-8 -*-
"""作業実績（設備ごとの実績 SQLite）。フォルダを探して設備を見つけ、設備ごとの登録（表示する・しない）と結び、手元へ写して読む。

元の形
    フォルダ（参照先 work_log.folder。既定 \\\\Nlmsrvngy03\\Read\\【New】実績）に、設備ごとに 1 つのファイル
    「実績_<設備名>.sqlite3」（名前の決まり work_log.pattern。* の所が設備名）がある。

登録（マスタ work_log_files。共有のマスタ・管理のマスタ）
    行: {id, キー, 設備名, ファイル名, ファイルID, 表示, 表, 備考}
    - キー        … 行を作ったときに決める変わらない名前。画面の表示ルール（表示列・並び・条件など）はこのキーに結ぶ
                    （`worklog:<キー>:<表>`）。ファイルの名前が変わっても、行を消して足し直しても取り違えない（id は使い回されうる）
    - ファイル名  … いま結んでいるファイル（フォルダの中の名前）
    - ファイルID  … ファイルそのものの見分け（OS のファイル番号。名前を変えても同じ）。名前が変わったファイルをたどるのに使う
    - 表示        … "有"（作業実績のタブで選べる）／"無"（選べない）。新しく見つけたファイルは "有"
    - 並び        … 作業実績のタブ・マスタ管理の一覧の並び（1 から。版 3.28.0〜。全員で 1 つ）。空の行は、番号のある行の後ろに登録の順で
                    （新しく見つけた設備は最後に付く）。並べ替えは order_keys（タブを引く・マスタ管理の ⋮⋮ を引く・Alt＋矢印）

ファイルの名前が変わったとき
    1. 同じ名前のファイル → そのまま
    2. 名前が無くなったら、同じファイルID のファイルを探す（名前を変えただけなら OS のファイル番号は変わらない）
       → 読むときはそのファイルを読み（resolve）、「探し直す」で登録の名前も書き換える（reconcile）
    3. それでも見つからない（別のファイルに置き換えられた等）行は「見つからない」として残し、マスタ管理で結び直す
       （推し量って勝手に別のファイルへ結ばない。表示ルールを取り違えないため）

写し
    設備ごとに DbMirror（品質異常と同じ方式）。置き場は db_cache/work_log（台帳は品質異常と分ける。
    デスクトップ版では品質異常の台帳を窓（Rust）が書くので、同じ台帳を 2 つの係で書き合わない）。
    写すのは画面がその設備を開いたときから（全部の設備を起動のたびに写さない）。
"""
from __future__ import annotations

import os
import threading
import time
import uuid
from pathlib import Path

from ..fsio import unquote_path
from .db_mirror import DbMirror, is_side_file

NAME = "work_log_files"
FIELDS = ["キー", "設備名", "ファイル名", "ファイルID", "表示", "表", "備考", "並び"]
DEFAULTS = {"folder": "\\\\Nlmsrvngy03\\Read\\【New】実績", "pattern": "実績_*.sqlite3", "table": "",
            "refresh_seconds": 60, "stale_hours": 36, "page_size": 500}
# 表の既定（指定が無いとき）: 実績・作業実績 → 名前に含む表 → 最初の表
TABLE_CANDIDATES = ["実績", "作業実績"]
LIST_TTL_SEC = 10.0          # フォルダの中身を覚える長さ（タブを開くたびに共有を読み直さない）


def params(settings):
    """設定（参照先で変えた値を重ねた物）から、作業実績の設定（足りない項目は既定）。"""
    wl = dict(DEFAULTS)
    wl.update({k: v for k, v in ((settings or {}).get("work_log") or {}).items() if v not in (None, "")})
    wl["folder"] = unquote_path(wl["folder"])
    return wl


# ------------------------------------------------------------------ 名前の決まり
def split_pattern(pattern):
    """「実績_*.sqlite3」→ ("実績_", ".sqlite3")。* はちょうど 1 つ（設備名の所）。違えば ValueError。"""
    p = str(pattern or "").strip()
    if p.count("*") != 1:
        raise ValueError(f"ファイル名の決まり「{p}」には、設備名の所に * をちょうど 1 つ書いてください（例: 実績_*.sqlite3）。")
    head, tail = p.split("*")
    return head, tail


def equipment_of(name, pattern):
    """ファイル名が決まりに合えば、* の所（設備名）。合わなければ None。大文字・小文字は区別しない（Windows と同じ）。"""
    head, tail = split_pattern(pattern)
    low, h, t = name.lower(), head.lower(), tail.lower()
    if len(name) <= len(head) + len(tail) or not low.startswith(h) or not low.endswith(t):
        return None
    mid = name[len(head):len(name) - len(tail)].strip()
    return mid or None


def file_id(st):
    """ファイルそのものの見分け（装置の番号:ファイル番号[:作った時刻]）。名前を変えても変わらない。OS が答えない（0）ときは ""。
    作った時刻（Windows・Python 3.12 から st_birthtime）も足す: 消した後に同じ番号を使い回したファイルを、同じファイルと見ない
    （NTFS のファイル番号は使い回しの回数を含むので起きにくいが、置き場の種類によっては番号だけでは足りない）。"""
    ino = int(getattr(st, "st_ino", 0) or 0)
    if not ino:
        return ""
    birth = getattr(st, "st_birthtime_ns", None) or getattr(st, "st_birthtime", None)
    return f"{int(getattr(st, 'st_dev', 0) or 0)}:{ino}" + (f":{int(birth)}" if birth else "")


# ------------------------------------------------------------------ フォルダを探す
class FolderError(Exception):
    """フォルダに届かない・読めない（理由つき）。"""


def scan(folder, pattern):
    """フォルダの中で決まりに合うファイル → [{file, equipment, size, mtime, fid}]（名前の順）。届かなければ FolderError。"""
    folder = unquote_path(folder)
    if not folder:
        raise FolderError("作業実績のフォルダが決まっていません。「マスタ管理」の「作業実績」でフォルダを入れてください。")
    split_pattern(pattern)
    out = []
    try:
        with os.scandir(folder) as it:
            for e in it:
                if is_side_file(e.name):      # 書き手の作業用（DataRelay の .pending_・隠しの .incoming など）は設備にしない
                    continue
                eq = equipment_of(e.name, pattern)
                if not eq:
                    continue
                try:
                    if not e.is_file():
                        continue
                    st = os.stat(e.path)     # scandir の stat は Windows でファイル番号を持たないので、開いて読む
                except OSError:
                    continue
                out.append({"file": e.name, "equipment": eq, "size": st.st_size, "mtime": st.st_mtime, "fid": file_id(st)})
    except OSError as e:
        raise FolderError(f"作業実績のフォルダに届きません（{getattr(e, 'strerror', None) or e}）: {folder}") from e
    out.sort(key=lambda f: f["file"].lower())
    return out


class Listing:
    """フォルダの中身を少しのあいだ覚える（タブの切り替え・一覧の問い合わせのたびに共有を読まない）。"""

    def __init__(self, ttl=LIST_TTL_SEC):
        self.ttl = ttl
        self._lock = threading.Lock()
        self._mem = {}           # (folder, pattern) -> (時刻, 答え or FolderError)

    def get(self, folder, pattern, fresh=False):
        key = (unquote_path(folder), str(pattern))
        with self._lock:
            hit = self._mem.get(key)
            if hit and not fresh and time.monotonic() - hit[0] < self.ttl:
                if isinstance(hit[1], FolderError):
                    raise hit[1]
                return hit[1]
        try:
            res = scan(*key)
        except FolderError as e:
            with self._lock:
                self._mem[key] = (time.monotonic(), e)
            raise
        with self._lock:
            self._mem[key] = (time.monotonic(), res)
        return res

    def forget(self):
        with self._lock:
            self._mem.clear()


# ------------------------------------------------------------------ 登録と見つけたファイルを結ぶ
def match(rows, found):
    """登録の行と、フォルダで見つけたファイルを結ぶ（書き換えない。決めるだけ）。
    → {"linked": [(行, ファイル)], "renamed": [(行, ファイル)], "new": [ファイル], "missing": [行]}
    1. 同じ名前のファイル（大文字・小文字は区別しない） 2. 名前が無ければ同じファイルID のファイル（名前を変えた）
    3. どちらも無い行は missing、どの行とも結ばれないファイルは new。"""
    files = {f["file"].lower(): f for f in found}
    taken, linked, renamed, missing = set(), [], [], []
    for r in rows:
        f = files.get(str(r.get("ファイル名") or "").lower())
        if f and f["file"].lower() not in taken:
            taken.add(f["file"].lower())
            linked.append((r, f))
    done = {id(r) for r, _ in linked}
    for r in rows:
        if id(r) in done:
            continue
        fid = str(r.get("ファイルID") or "")
        f = next((x for x in found if fid and x["fid"] == fid and x["file"].lower() not in taken), None)
        if f:
            taken.add(f["file"].lower())
            renamed.append((r, f))
        else:
            missing.append(r)
    new = [f for f in found if f["file"].lower() not in taken]
    return {"linked": linked, "renamed": renamed, "new": new, "missing": missing}


def new_key():
    return uuid.uuid4().hex[:12]


def ordered(rows):
    """並びの順（並びの番号 → 番号の無い行は登録の順で後ろに）。元の rows は変えない"""
    def num(r):
        try:
            return int(str(r.get("並び") or "").strip())
        except ValueError:
            return None
    return [r for _, r in sorted(enumerate(rows), key=lambda x: (num(x[1]) is None, num(x[1]) or 0, x[0]))]


def order_keys(rows, keys):
    """並び替え: keys（キーの並び）に入っている行だけを、その行たちがいま占めている所へ keys の順で入れ直し、全部に 1 から番号を振る。
    keys に無い行（タブに出していない「表示しない」設備など）は、いまの所から動かない。知らないキー・重なりは無視。→ {キー: 新しい番号}"""
    cur = [r.get("キー") for r in ordered(rows)]
    seen, want = set(), []
    for k in (str(k) for k in keys):
        if k in cur and k not in seen:
            seen.add(k)
            want.append(k)
    it = iter(want)
    new = [next(it) if k in seen else k for k in cur]
    return {k: str(i + 1) for i, k in enumerate(new)}


def view(rows, found, folder_error=""):
    """マスタ管理・作業実績のタブへ出す形: 行ごとに、いま読むファイル（名前が変わっていればたどった先）と状態。
    state: "ok"（ある）・"renamed"（名前が変わったファイルをたどった）・"missing"（見つからない）・"unknown"（フォルダに届かない）"""
    items = []
    rows = ordered(rows)
    m = match(rows, found) if not folder_error else {"linked": [], "renamed": [], "new": [], "missing": list(rows)}
    where = {id(r): ("ok", f) for r, f in m["linked"]}
    where.update({id(r): ("renamed", f) for r, f in m["renamed"]})
    for r in rows:
        state, f = where.get(id(r), ("unknown" if folder_error else "missing", None))
        items.append({"id": r.get("id"), "key": r.get("キー") or "", "name": r.get("設備名") or "", "file": r.get("ファイル名") or "",
                      "visible": str(r.get("表示") or "有") != "無", "table": r.get("表") or "", "note": r.get("備考") or "",
                      "rev": r.get("rev", 1), "state": state, "now": f["file"] if f else "",
                      "size": f["size"] if f else None, "mtime": f["mtime"] if f else None,
                      "updated_at": r.get("updated_at", ""), "updated_by": r.get("updated_by") or {}})
    return {"items": items, "new": [{"file": f["file"], "equipment": f["equipment"], "size": f["size"], "mtime": f["mtime"]} for f in m["new"]],
            "error": folder_error}


def mark_stale(items, stale_hours, now=None):
    """行ごとに、ファイルの最後の更新が古いか（stale_hours 時間より前。0 以下なら言わない）と、何時間前か（ageHours）を入れる。"""
    now = time.time() if now is None else now
    for x in items:
        age = (now - x["mtime"]) / 3600 if x.get("mtime") else None
        x["ageHours"] = None if age is None else round(age, 1)
        x["stale"] = bool(age is not None and float(stale_hours or 0) > 0 and age > float(stale_hours))
    return items


def resolve(row, folder, found):
    """その行で読むファイルの場所（名前が変わっていれば同じファイルID の物）。見つからなければ None。"""
    m = match([row], found)
    pair = (m["linked"] or m["renamed"] or [None])[0]
    return Path(unquote_path(folder)) / pair[1]["file"] if pair else None


# ------------------------------------------------------------------ 設備ごとの写し
class Mirrors:
    """設備ごとの写しの係（キー → DbMirror）。アプリに 1 つ。画面がその設備を開いたときに作って写し始める。
    データ元（data_sources.py）の 1 ファイルの元も同じ係で写す（prefix="src"・置き場 db_cache/sources）。"""

    def __init__(self, cache_dir, passive=False, prefix="work_log"):
        self.cache_dir = Path(cache_dir)
        self.passive = passive
        self.prefix = prefix          # 写しの名前の頭（作業実績 work_log_<キー>・データ元 src_<キー>）
        self._lock = threading.Lock()
        self._all = {}

    def get(self, key, remote, interval_sec, stale_hours):
        with self._lock:
            m = self._all.get(key)
            if m is None:
                m = self._all[key] = DbMirror(f"{self.prefix}_{key}", str(remote), self.cache_dir, interval_sec=interval_sec,
                                              stale_hours=stale_hours, passive=self.passive)
            else:
                m.reconfigure(remote=str(remote), interval_sec=interval_sec, stale_hours=stale_hours)
        m.start()
        return m

    def wait_first(self, keys, timeout):
        """keys の設備の写しの係が、最初の写しを済ませるまで待つ（全部で timeout 秒まで。1 台ずつ timeout 秒ずつ待たない）。
        版 3.46.0（利用者の要望 2026-10-21 の 6: 入れた直後の作業実績が不安定）: ダッシュボードが全部の設備を数えるとき、
        1 台目の写しを待ってから 2 台目の写しを始めていた（11 台なら写す時間の 11 倍待った）。先に全部の係を起こしてから、まとめて待つ"""
        end = time.monotonic() + timeout
        for k in keys:
            m = self.peek(k)
            if m is not None:
                m.wait_first(end - time.monotonic())

    def peek(self, key):
        with self._lock:
            return self._all.get(key)
