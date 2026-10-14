# -*- coding: utf-8 -*-
"""マスタの置き場（共有フォルダ）を、画面から別の場所・別の名前へ変える。

マスタの置き場はマスタそのものの置き場なので、参照先マスタ（path_settings）には置けない（このマスタ自体が別の場所を見てしまう）。
そこで（配布の置き場を変える services/release_place.py と同じ考え方で）:
  - 確かめる（plan）… 新しい名前がフォルダ名に使えるか・上のフォルダに届くか・いまの置き場と同じ／その中でないか・
                       新しい場所が空か（既にマスタがあれば、写さずに切り替えるだけ）・写す量
  - 変える（move） … いまのマスタ（共有なら共有の写し、手元のみなら同梱の data/）を、新しい場所の隣の一時フォルダへ書き、
                       書き終えてから名前を付ける（ほかの PC が書きかけを読まない）→ この PC を新しい置き場へ切り替えて覚える
                       → 前の置き場に引っ越し先の印（_MOVED.json）を置く。ほかの PC はマスタを読みに行くついでに印を見て移る
                       （MasterStore.follow_moved）。前の置き場のマスタは消さない（戻せる）
"""
from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path

from ..fsio import unquote_path, write_json_atomic
from ..repositories.master_store import MOVED_FILENAME, _iso, _now
from .release_place import _inside, _same, check_name

MASTER_MARKERS = ("equipment_master.json", "roll_master.json", "path_settings.json")   # 既にマスタの置き場か
# クラウドの同期フォルダ（フォルダ名 → 呼び名）。同期フォルダでは錠が PC ごとに別々のファイルになり（同期は後から）、
# 2 人が同時に保存すると片方の変更が消える・衝突のコピーができる（docs/MASTER_SHARE_DESIGN.md「ファイルサーバーを使う」）
SYNC_FOLDERS = {"box": "Box", "boxdrive": "Box", "onedrive": "OneDrive", "dropbox": "Dropbox", "google drive": "Google ドライブ",
                "googledrive": "Google ドライブ", "マイドライブ": "Google ドライブ", "my drive": "Google ドライブ", "icloud drive": "iCloud Drive"}
SYNC_CAUTION = ("{kind} の同期フォルダです。同期フォルダでは、2 人がほぼ同時にマスタを保存すると、片方の変更が消えることがあります"
                "（錠が PC ごとに別々になるため）。マスタは、ファイルサーバーの共有（\\\\サーバー\\共有）に置いてください。")


def sync_folder(path) -> str:
    """path がクラウドの同期フォルダの中なら、その呼び名（Box・OneDrive など）。違えば空。
    OneDrive は「OneDrive - 会社名」のように名前が付くので、前の一致も見る。"""
    for part in re.split(r"[\\/]+", str(path or "")):
        low = part.strip().lower()
        if low in SYNC_FOLDERS:
            return SYNC_FOLDERS[low]
        if low.startswith("onedrive"):
            return "OneDrive"
    return ""


def sync_caution(path) -> str:
    kind = sync_folder(path)
    return SYNC_CAUTION.format(kind=kind) if kind else ""


def is_master_place(folder: Path) -> bool:
    return any((folder / m).is_file() for m in MASTER_MARKERS)


def _docs(store):
    """いま読んでいるマスタ（共有するもの全部）→ {名前: 中身}。共有なら写し、手元のみなら同梱の data/"""
    out = {}
    for name in sorted(store.shared_names):
        doc = store._read_doc(name)
        if doc["rows"] or (store._bundled(name).exists() or (store.share_dir and store._share_file(name).exists())):
            out[name] = doc
    return out


def plan(store, parent, name) -> dict:
    """→ {ok, mode: copy|switch, dest, files, bytes, note, problem}。ok が False なら problem に理由。"""
    try:
        nm = check_name(name)
    except ValueError as e:
        return {"ok": False, "problem": str(e)}
    par = unquote_path(str(parent or "").strip())
    if not par:
        return {"ok": False, "problem": "置く場所（上のフォルダ）を入れてください。"}
    p = Path(par)
    if not p.is_absolute() and not par.startswith("\\\\"):
        return {"ok": False, "problem": "置く場所は、ドライブ（C:\\…）か共有（\\\\サーバー\\…）から書いてください。"}
    if not p.is_dir():
        return {"ok": False, "problem": f"置く場所に届きません: {par}（フォルダがあるか・つながっているかを確かめてください）"}
    dest = p / nm
    cur = store.share_dir
    if cur and _same(dest, cur):
        return {"ok": False, "dest": str(dest), "problem": "いまの置き場と同じです。"}
    if cur and _inside(dest, cur):
        return {"ok": False, "dest": str(dest), "problem": "いまの置き場の中には置けません。"}
    if dest.exists():
        if not dest.is_dir():
            return {"ok": False, "dest": str(dest), "problem": "同じ名前のファイルがあります。別の名前にしてください。"}
        if is_master_place(dest):
            return {"ok": True, "mode": "switch", "dest": str(dest), "files": 0, "bytes": 0, "caution": sync_caution(dest),
                    "note": "既にマスタがある置き場です。写さずに切り替えます（その置き場のマスタを使います）。"}
        if any(dest.iterdir()):
            return {"ok": False, "dest": str(dest), "problem": "フォルダが空ではなく、マスタもありません。空のフォルダか、新しい名前にしてください。"}
    caution = sync_caution(dest)
    docs = _docs(store)
    size = sum(len(json.dumps(d, ensure_ascii=False).encode("utf-8")) for d in docs.values())
    if not os.access(p, os.W_OK):
        return {"ok": False, "dest": str(dest), "problem": f"置く場所に書き込めません: {par}"}
    src = "共有の置き場" if cur else "この PC（手元のみ）"
    return {"ok": True, "mode": "copy", "dest": str(dest), "files": len(docs), "bytes": size, "names": sorted(docs), "caution": caution,
            "note": f"{src}のマスタを写してから切り替えます。"}


def move(store, parent, name) -> dict:
    """置き場を変える（plan が通るときだけ）。→ plan の答え＋{from}。失敗は ValueError（理由）。"""
    pl = plan(store, parent, name)
    if not pl["ok"]:
        raise ValueError(pl["problem"])
    dest, old = Path(pl["dest"]), store.share_dir
    if pl["mode"] == "copy":
        docs = _docs(store)
        tmp = dest.parent / f".{dest.name}.tmp-{uuid.uuid4().hex[:8]}"
        try:
            tmp.mkdir()
            for nm, doc in docs.items():
                write_json_atomic(tmp / f"{nm}.json", doc, indent=1)
            if dest.exists():
                dest.rmdir()          # plan で空と確かめた
            os.replace(tmp, dest)
        except OSError as e:
            for f in tmp.glob("*") if tmp.exists() else []:
                f.unlink(missing_ok=True)
            if tmp.exists():
                tmp.rmdir()
            raise ValueError(f"写せませんでした: {e}") from e
    store.retarget(dest)
    if old and old.is_dir() and not _same(old, dest):
        try:   # 前の置き場に引っ越し先の印（ほかの PC がたどる）
            write_json_atomic(old / MOVED_FILENAME, {"to": str(dest), "at": _iso(_now()), "by": dict(store.who)})
        except OSError:
            pl["warning"] = f"前の置き場（{old}）に引っ越し先の印を置けませんでした。ほかの PC では「置き場を変える」で {dest} を選んでください。"
    pl["from"] = str(old or "")
    return pl
