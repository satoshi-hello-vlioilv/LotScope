# -*- coding: utf-8 -*-
"""フォルダ・ファイルの欄の補助（「参照…」の窓・欄の下の「よく使う場所」）。読むだけで、何も書かない。

アプリの中身（Python）は利用者の PC で動く（窓の子プロセス。ポートは開けない）ので、ここで見えるフォルダは
その PC のエクスプローラーで見えるものと同じ（共有 \\\\サーバー\\共有・BOX Drive・ドライブ）。

  browse(path, kind, purpose)  … そのフォルダの中（フォルダ・その欄で選べるファイル）と、区切り（パンくず）。
                                  無いときは、届いた所まで上がってその中を出す（どこまで合っていたかが分かる）
  places(...)                  … よく使う場所: このアプリが使っている場所（マスタ・品質データ・作業実績・配布）と、この PC の場所

印（mark）は欄の目的（purpose）で変わる: マスタの置き場ならマスタのあるフォルダ、配布の置き場なら版のあるフォルダ、
作業実績なら決まりに合うファイルの数、.sqlite3・.exe を選ぶ欄ならそのファイル。
共有・BOX は読むのに時間がかかることがあるので、どれも時間を区切る（届かないときは待たせ続けない）。
"""
from __future__ import annotations

import ntpath
import os
import posixpath
import re
import stat
import string
import threading
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

from ..fsio import unquote_path
from .db_mirror import is_side_file
from .master_place import drive_root, is_master_place
from .release_place import MARKER as RELEASE_MARKER
from .work_log import equipment_of, split_pattern

LIMIT = 400              # 1 つのフォルダで出す数（多いときは「ほか N 件」）
MARK_LIMIT = 120         # 印を付けるために中を覗く数（共有では 1 つ覗くたびに往復する）
TIMEOUT = 4.0            # 1 回の答えにかける秒（届かない共有で待たせ続けない）
PLACE_TIMEOUT = 2.0      # よく使う場所の「届くか」を確かめる秒（全部まとめて）

# 欄の目的 → 選ぶ物（folder / file）・選べるファイルの拡張子
PURPOSES = {
    "master": {"kind": "folder"},
    "release": {"kind": "folder"},
    "worklog": {"kind": "folder"},
    "folder": {"kind": "folder"},
    "sqlite": {"kind": "file", "ext": (".sqlite3", ".sqlite", ".db")},
    "exe": {"kind": "file", "ext": (".exe",)},
}


# ---- 利用者の決め（版 3.100.0。主のセッションが変えられるよう、ここ 1 か所）
NATURAL_SORT = True       # 並びはエクスプローラーと同じ自然な並び（数字の続きは数として比べる: 9 → 10・3.9.0 → 3.10.0）
WORKLOG_MARK = "ファイルのある設備"   # 作業実績のフォルダの印の頭（同じ画面のデータ元のカードの登録の台数と見分ける）
HIDE_ATTRS = True         # Windows の隠し・システムの属性の物は出さない（エクスプローラーの既定と同じ。desktop.ini・Thumbs.db など）
_HIDDEN_BITS = getattr(stat, "FILE_ATTRIBUTE_HIDDEN", 2) | getattr(stat, "FILE_ATTRIBUTE_SYSTEM", 4)


def sort_key(name: str):
    """「参照…」の並び（NATURAL_SORT なら、数字〈0〜9〉の続きは数として・大文字小文字を見ず・同じ所では数字が先。
    かな・全角の字の順はエクスプローラーの言語の並びと違いうる）。事例は tests/fixtures/place_cases.json の sort"""
    if not NATURAL_SORT:
        return name.lower()
    parts = [p for p in re.split(r"([0-9]+)", name) if p]
    return [(0, int(p), "") if p.isdigit() and p.isascii() else (1, 0, p.lower()) for p in parts], name.lower(), name


def _hidden(entry) -> bool:
    """出さない物: 名前が「.」「~$」で始まる・ごみ箱と System Volume Information・（Windows）隠し・システムの属性"""
    if entry.name.startswith((".", "~$")) or entry.name in ("$RECYCLE.BIN", "System Volume Information"):
        return True
    if HIDE_ATTRS and os.name == "nt":
        try:
            return bool(getattr(entry.stat(follow_symlinks=False), "st_file_attributes", 0) & _HIDDEN_BITS)
        except OSError:
            return False
    return False


class Timeout(Exception):
    pass


def _bounded(fn, seconds=TIMEOUT):
    """fn() を別の糸で動かし、seconds 秒で打ち切る（届かない共有の読みは OS の待ちが長い。糸は裏で終わるのを待つ）。"""
    box = {}

    def run():
        try:
            box["value"] = fn()
        except Exception as e:  # noqa: BLE001 呼んだ側へそのまま渡す
            box["error"] = e

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(seconds)
    if t.is_alive():
        raise Timeout()
    if "error" in box:
        raise box["error"]
    return box.get("value")


def clean(text) -> str:
    """欄の字 → パス。前後の空白・"…"・file:///・%USERPROFILE% などを整え、末尾の区切りを外す（ドライブの根 C:\\ は残す）。"""
    s = unquote_path(str(text or "")).strip().strip("'")
    if s.lower().startswith("file:"):
        u = urlparse(s)
        body = unquote(u.path)
        if u.netloc and u.netloc.lower() != "localhost":           # file://サーバー/共有/… → \\サーバー\共有\…
            s = "\\\\" + u.netloc + body.replace("/", "\\")
        elif len(body) > 2 and body[0] == "/" and body[2] == ":":  # file:///C:/… → C:\…
            s = body[1:].replace("/", "\\")
        else:
            s = body
    s = os.path.expandvars(os.path.expanduser(s)) if s else s
    return tidy(s)


def tidy(s: str) -> str:
    r"""字の上で整えた道（版 3.100.0: 「..」「.」・重ねた区切りを除く。記号リンクは解かない。Windows の形〈ドライブ・\\〉は ntpath、
    ほかは posixpath の normpath）。ドライブだけ（C:）はその根（C:\）、末尾の区切りは外す（ドライブの根 C:\ と / は残す）"""
    if not s:
        return s
    unc = s.startswith("\\\\") or (os.name == "nt" and s.startswith("//"))     # POSIX の //tmp は POSIX の道
    if unc or (len(s) >= 2 and s[1] == ":" and s[0].isascii() and s[0].isalpha()):
        out = ntpath.normpath(drive_root(s))
        return out if len(out) == 3 and out[1] == ":" else (out.rstrip("\\") or out)
    out = posixpath.normpath(s) if os.name != "nt" else ntpath.normpath(s)
    return out.rstrip("\\/") or out[:1]


def crumbs(path: str) -> list:
    """区切り（パンくず）→ [{name, path}]。共有は \\\\サーバー\\共有 を 1 つ目にする（サーバーの中は一覧できない）。"""
    if not path:
        return []
    if path.startswith("\\\\"):
        parts = [x for x in path[2:].split("\\") if x]
        if len(parts) < 2:
            return [{"name": path, "path": path}]
        head = "\\\\" + parts[0] + "\\" + parts[1]
        out = [{"name": head, "path": head}]
        cur = head
        for x in parts[2:]:
            cur += "\\" + x
            out.append({"name": x, "path": cur})
        return out
    p = Path(path)
    anchor = p.anchor
    out = [{"name": anchor.rstrip("\\/") or anchor, "path": anchor}] if anchor else []
    cur = Path(anchor) if anchor else Path()
    for x in p.parts[1 if anchor else 0:]:
        cur = cur / x
        out.append({"name": x, "path": str(cur)})
    return out


def _parent(path: str) -> str:
    c = crumbs(path)
    return c[-2]["path"] if len(c) > 1 else ""


def parent_of(text) -> str:
    """ファイルのパス → それを入れたフォルダ（字の上で。読みに行かない）。"""
    return _parent(clean(text))


def _mtime(st) -> str:
    try:
        return datetime.fromtimestamp(st.st_mtime).isoformat(timespec="minutes")
    except (OSError, OverflowError, ValueError):
        return ""


def _has_versions(folder: Path) -> bool:
    """配布の置き場か: すぐ下のフォルダ（版）に目印（release.json）がある。版のフォルダそのものには付けない。"""
    return any(e.is_dir() and (Path(e.path) / RELEASE_MARKER).is_file() for e in os.scandir(folder))


def equipment_count(folder: Path, pattern: str):
    """作業実績のフォルダの印の数: work_log.scan と同じ決まり（equipment_of・書き手の作業用を除く・ファイルだけ。[ ] ? は字のまま）。
    決まりが読めなければ None（版 3.100.0。前は fnmatch で数え、確かめるの「設備 n 台」と違う数を出した）"""
    try:
        split_pattern(pattern)
    except ValueError:
        return None
    return sum(1 for e in os.scandir(folder) if not is_side_file(e.name) and equipment_of(e.name, pattern) and e.is_file())


def ext_counts(folder: Path, exts) -> list:
    """[(拡張子, 数)]（数えた物だけ・exts の順。「参照…」に出さない物は数えない）"""
    got = dict.fromkeys(exts, 0)
    for e in os.scandir(folder):
        if _hidden(e) or not e.is_file():
            continue
        low = e.name.lower()
        hit = next((x for x in exts if low.endswith(x)), None)
        if hit:
            got[hit] += 1
    return [(x, n) for x, n in got.items() if n]


def _mark_dir(folder: Path, purpose: str, pattern: str):
    """そのフォルダの印（目的ごと）→ {text, tone} か None。tone: ok（その欄で選ぶ物）・info（参考）"""
    try:
        if purpose == "master":
            return {"text": "マスタあり", "tone": "ok"} if is_master_place(folder) else None
        if purpose == "release":
            return {"text": "版の置き場", "tone": "ok"} if _has_versions(folder) else None
        if purpose == "worklog":
            n = equipment_count(folder, pattern or "*.sqlite3")
            # 参照先の「確かめる」と同じ数。登録の台数（データ元のカードの「n 台」）と見分けて「ファイルのある設備」（版 3.100.0・主のセッションの決め）
            return {"text": f"{WORKLOG_MARK} {n} 台", "tone": "ok"} if n else None
        ext = PURPOSES.get(purpose, {}).get("ext")
        if ext:
            text = "・".join(f"{x} が {n} 個" for x, n in ext_counts(folder, ext))   # 数えた拡張子の名前（版 3.100.0）
            return {"text": text, "tone": "info"} if text else None
    except OSError:
        return None
    return None


def _list(folder: Path, purpose: str, pattern: str) -> dict:
    spec = PURPOSES.get(purpose) or PURPOSES["folder"]
    ext = spec.get("ext")
    dirs, files, others = [], [], 0
    with os.scandir(folder) as it:
        for e in it:
            if _hidden(e):
                continue
            try:
                is_dir = e.is_dir()
                st = e.stat()
            except OSError:
                continue
            if is_dir:
                dirs.append({"name": e.name, "path": str(folder / e.name), "dir": True, "mtime": _mtime(st)})
            elif ext and e.name.lower().endswith(ext):
                files.append({"name": e.name, "path": str(folder / e.name), "dir": False, "mtime": _mtime(st), "size": st.st_size})
            else:
                others += 1
    key = lambda x: sort_key(x["name"])  # noqa: E731
    dirs.sort(key=key)
    files.sort(key=key)
    for d in dirs[:MARK_LIMIT]:
        m = _mark_dir(Path(d["path"]), purpose, pattern)
        if m:
            d["mark"] = m
    entries = dirs + files
    return {"entries": entries[:LIMIT], "more": max(0, len(entries) - LIMIT), "others": others,
            "mark": _mark_dir(folder, purpose, pattern)}


def browse(text, purpose="folder", pattern="", timeout=TIMEOUT) -> dict:
    """→ {path, asked, exists, file, crumbs, parent, entries, more, others, mark, problem}
    path: 中を出したフォルダ。asked が無ければ、届いた所まで上がった所（problem に理由）。file: 欄の値がファイルならその名前。"""
    purpose = purpose if purpose in PURPOSES else "folder"
    asked = clean(text)
    out = {"asked": asked, "path": "", "exists": False, "file": "", "crumbs": [], "parent": "", "entries": [], "more": 0,
           "others": 0, "mark": None, "problem": "", "kind": PURPOSES[purpose]["kind"]}
    if not asked:
        return out
    if not (asked.startswith("\\\\") or Path(asked).is_absolute()):
        out["problem"] = "ドライブ（C:\\…）か共有（\\\\サーバー\\共有\\…）から書いてください。"
        return out

    def find():
        cur = asked
        while cur:
            p = Path(cur)
            if p.is_dir():
                return cur, ""
            if p.is_file():
                return _parent(cur) or str(p.parent), p.name
            nxt = _parent(cur)
            if not nxt or nxt == cur:
                return "", ""
            cur = nxt
        return "", ""

    try:
        here, file = _bounded(find, timeout)
        if not here:
            out["problem"] = f"届きません: {asked}（つながっているか・名前が合っているかを確かめてください）"
            return out
        listed = _bounded(lambda: _list(Path(here), purpose, pattern), timeout)
    except Timeout:
        out["problem"] = f"{timeout:.0f} 秒で読めませんでした: {asked}（共有・BOX に届いているかを確かめてください）"
        return out
    except OSError as e:
        out["problem"] = f"読めません: {asked}（{e.strerror or e}）"
        return out
    exact = os.path.normcase(here) == os.path.normcase(asked) or bool(file)
    out.update(listed, path=here, exists=exact, file=file, crumbs=crumbs(here), parent=_parent(here))
    if not exact:
        out["problem"] = f"「{asked[len(here):].lstrip(chr(92) + '/') or asked}」が見つかりません。届いた所: {here}"
    return out


def _user_dirs():
    home = Path.home()
    out = [("デスクトップ", home / "Desktop"), ("ドキュメント", home / "Documents")]
    for box in (home / "Box", Path("C:/boxdrive/Box")):
        out.append(("BOX", box))
    out.append(("ホーム", home))
    if os.name == "nt":
        out += [(f"{c}: ドライブ", Path(f"{c}:\\")) for c in string.ascii_uppercase if c not in "AB"]
    return out


def places(app_paths, timeout=PLACE_TIMEOUT) -> list:
    """よく使う場所 → [{group: app|pc, key, label, path, reach: True|False|None}]。
    app_paths: [(鍵, 名前, パス)]（このアプリが使っている場所。ファイルならそのフォルダ。「;」で区切って複数も）。届くかはまとめて timeout 秒まで確かめる
    （確かめ終わらなかった物は reach=None）。この PC の場所は、届く物だけ出す。"""
    seen, rows = set(), []
    for key, label, raw in app_paths:
        for one in str(raw or "").split(";"):
            p = clean(one)
            if not p:
                continue
            k = os.path.normcase(p)
            if k in seen:
                continue
            seen.add(k)
            rows.append({"group": "app", "key": key, "label": label, "path": p, "reach": None})
    for label, p in _user_dirs():
        k = os.path.normcase(str(p))
        if k not in seen:
            seen.add(k)
            rows.append({"group": "pc", "key": "pc", "label": label, "path": str(p), "reach": None})

    def probe(row):
        try:
            p = Path(row["path"])
            row["reach"] = p.is_dir() or p.is_file()
        except OSError:
            row["reach"] = False

    threads = [threading.Thread(target=probe, args=(r,), daemon=True) for r in rows]
    for t in threads:
        t.start()
    deadline = time.monotonic() + timeout
    for t in threads:
        t.join(max(0.0, deadline - time.monotonic()))
    return [r for r in rows if r["group"] == "app" or r["reach"]]
