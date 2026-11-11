# -*- coding: utf-8 -*-
"""マスタの置き場（共有フォルダ）を、画面から別の場所・別の名前へ変える。

マスタの置き場はマスタそのものの置き場なので、参照先マスタ（path_settings）には置けない（このマスタ自体が別の場所を見てしまう）。
そこで（配布の置き場を変える services/release_place.py と同じ考え方で）:
  - 確かめる（plan）… 新しい名前がフォルダ名に使えるか・上のフォルダに届くか・いまの置き場と同じ／その中でないか・
                       新しい場所が空か（既にマスタがあれば、写さずに切り替えるだけ）・写す量
  - 変える（move） … いまのマスタ（共有なら共有の写し、手元のみなら同梱の data/）を、新しい場所の隣の一時フォルダへ書き、
                       書き終えてから名前を付ける（ほかの PC が書きかけを読まない）→ この PC を新しい置き場へ切り替えて覚える
                       （版 3.100.0: 共有なら、錠を持ったまま前の置き場の全部のマスタ〈この PC が共有しない名前も〉と利用状況の記録・
                       切断の指示を、ファイルのまま写す。前は手元の写し〈5 秒に 1 回の取り直し〉から写し、ほかの PC が直前に保存した行を落とした）
                       → 前の置き場に引っ越し先の印（_MOVED.json）を置く。ほかの PC はマスタを読みに行くついでに印を見て移る
                       （MasterStore.follow_moved）。前の置き場のマスタは消さない（戻せる）
"""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path

from ..fsio import open_shared_read, unquote_path, write_json_atomic
from ..repositories.master_store import LOCK_FILENAME, MASTER_MARKERS, MOVED_FILENAME, _iso, _now
from .presence import REVOKE_SUFFIX, SESSIONS_DIR, SETTINGS_FILE, SUBDIR as PRESENCE_DIR
from .release_place import _inside, _same, check_name, unreadable

SHARE_PROBE_SEC = 2.0     # 置き場の状態（GET /api/masters/status・place）で共有を見るのにかける秒（まとめて。fs/places と同じ区切り。版 3.100.0）

# ---- 利用者の決め（版 3.100.0。主のセッションが変えられるよう、ここ 1 か所）
# 引っ越しで、利用状況の記録（presence_tpa の history・sessions・settings.json）と切断の指示（*.revoke.json）も写す（データを落とさない側）。
# 心拍（presence_tpa 直下のほかの *.json）は写さない（写すと、まだ移っていない PC が新しい置き場で使っているように見える）
COPY_PRESENCE = True
PRESENCE_TREES = ("history", SESSIONS_DIR)
RECORDS_NOTE = "利用状況の記録と切断の指示も写します。"

# クラウドの同期フォルダ（フォルダ名 → 呼び名）。同期フォルダでは錠が PC ごとに別々のファイルになり（同期は後から）、
# 2 人が同時に保存すると片方の変更が消える・衝突のコピーができる（docs/MASTER_SHARE_DESIGN.md「ファイルサーバーを使う」）
SYNC_FOLDERS = {"box": "Box", "boxdrive": "Box", "onedrive": "OneDrive", "dropbox": "Dropbox", "google drive": "Google ドライブ",
                "googledrive": "Google ドライブ", "マイドライブ": "Google ドライブ", "my drive": "Google ドライブ", "icloud drive": "iCloud Drive"}
SYNC_CAUTION = ("{kind} の同期フォルダです。同期フォルダでは、2 人がほぼ同時にマスタを保存すると、片方の変更が消えることがあります"
                "（錠が PC ごとに別々になるため）。マスタは、ファイルサーバーの共有（\\\\サーバー\\共有）に置いてください。")


def sync_folder(path) -> str:
    """path がクラウドの同期フォルダの中なら、その呼び名（Box・OneDrive など）。違えば空。
    OneDrive は「OneDrive - 会社名」のように名前が付くので、前の一致も見る。共有（\\サーバー\…）は同期フォルダではないので見ない
    （版 3.100.0。前は共有の中の「box」という名前のフォルダにも注意を出し、勧めた先〈ファイルサーバーの共有〉に警告が出た）"""
    s = str(path or "")
    if s[:2] in ("\\\\", "//"):
        return ""
    for part in re.split(r"[\\/]+", s):
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


def drive_root(text: str) -> str:
    """ドライブだけ（C:）はその根（C:\\）。Windows では「C:」はドライブごとの今のフォルダの意味になり、ドライブを入れた人に
    「ドライブから書いてください」と断っていた（版 3.100.0）"""
    return text + "\\" if len(text) == 2 and text[1] == ":" and text[0].isascii() and text[0].isalpha() else text


def payload(doc) -> bytes:
    """マスタの中身を書く字（数えるのも書くのもこの字。版 3.100.0。前は字下げの無い字で数え、字下げ 1 で書いたので、画面の写す量が 1 割強少なかった）"""
    return (json.dumps(doc, ensure_ascii=False, indent=1) + "\n").encode("utf-8")


def _docs(store):
    """この PC が読んでいるマスタ（共有するもの全部）→ {名前: 中身}。手元のみなら同梱の data/、共有に届かないなら写し"""
    out = {}
    for name in sorted(store.shared_names):
        doc = store._read_doc(name)
        if doc["rows"] or (store._bundled(name).exists() or (store.share_dir and store._share_file(name).exists())):
            out[name] = doc
    return out


def _share_files(share: Path) -> list:
    """前の置き場から写す物 → [(相対の道〈/ 区切り〉, ファイル)]（名前の順）。直下の *.json（「.」で始まる一時ファイル・錠・引っ越しの印を除く）と、
    利用状況の記録と切断の指示（COPY_PRESENCE）。独立の答えは tools/place-truth.py の copied_names"""
    out = []
    for e in os.scandir(share):
        if e.name.endswith(".json") and not e.name.startswith(".") and e.name not in (LOCK_FILENAME, MOVED_FILENAME) and e.is_file():
            out.append((e.name, Path(e.path)))
    pres = share / PRESENCE_DIR
    if COPY_PRESENCE and pres.is_dir():
        for e in os.scandir(pres):
            if not e.name.startswith(".") and (e.name == SETTINGS_FILE or e.name.endswith(REVOKE_SUFFIX)) and e.is_file():
                out.append((f"{PRESENCE_DIR}/{e.name}", Path(e.path)))
        for sub in PRESENCE_TREES:
            for root, dirs, files in os.walk(pres / sub):
                dirs[:] = [d for d in dirs if not d.startswith(".")]
                for f in files:
                    if not f.startswith("."):
                        p = Path(root) / f
                        out.append((p.relative_to(share).as_posix(), p))
    return sorted(out)


def _sources(store):
    """写す物 → (どこから〈share|mirror|local〉, [(相対の道, 大きさ, 読む関数)])。
    共有に届けば共有のファイルそのもの（錠を持って読むので、ほかの PC の直前の保存も入る）。届かなければこの PC の写し、手元のみなら data/"""
    cur = store.share_dir
    if cur is not None and store.share_reachable():
        out = []
        for rel, p in _share_files(cur):
            try:
                out.append((rel, os.stat(p).st_size, (lambda p=p: _read_bytes(p))))
            except FileNotFoundError:
                if not rel.startswith(PRESENCE_DIR + "/"):
                    raise
                # 利用状況は錠の外でほかの PC が書く・片付ける（古い履歴を消す）。見つけた後に消えた物は写さない
        return "share", out
    docs = {f"{n}.json": payload(d) for n, d in _docs(store).items()}
    return ("mirror" if cur is not None else "local"), [(rel, len(b), (lambda b=b: b)) for rel, b in docs.items()]


def _read_bytes(path: Path) -> bytes:
    with open_shared_read(path) as f:
        return f.read()


def _write_file(path: Path, data: bytes):
    """写す 1 つのファイル（バイトのまま。Windows でも改行を変えない）"""
    with open(path, "wb") as f:
        f.write(data)


def _can_write(folder: Path, name: str) -> str:
    """そこに書けるか: 試しの一時フォルダを作って消す（版 3.100.0。Windows の os.access はフォルダの ACL を見ず、いつも書ける扱いだった）。
    → 書けなければ理由の字"""
    probe = folder / f".{name}.probe-{uuid.uuid4().hex[:8]}"
    try:
        os.mkdir(probe)
    except OSError as e:
        return getattr(e, "strerror", None) or str(e)
    try:
        os.rmdir(probe)
    except OSError:
        pass
    return ""


def plan(store, parent, name) -> dict:
    """→ {ok, mode: copy|switch, dest, files, bytes, note, problem}。ok が False なら problem に理由。"""
    try:
        nm = check_name(name)
    except ValueError as e:
        return {"ok": False, "problem": str(e)}
    par = drive_root(unquote_path(str(parent or "").strip()))
    if not par:
        return {"ok": False, "problem": "置く場所（上のフォルダ）を入れてください。"}
    if re.fullmatch(r"\\\\[^\\/]+", par):
        return _share_root(store, par, nm)
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
    try:
        if dest.exists():
            if not dest.is_dir():
                return {"ok": False, "dest": str(dest), "problem": "同じ名前のファイルがあります。別の名前にしてください。"}
            if is_master_place(dest):
                return {"ok": True, "mode": "switch", "dest": str(dest), "files": 0, "bytes": 0, "caution": sync_caution(dest),
                        "note": "既にマスタがある置き場です。写さずに切り替えます（その置き場のマスタを使います）。"}
            if any(dest.iterdir()):
                return {"ok": False, "dest": str(dest), "problem": "フォルダが空ではなく、マスタもありません。空のフォルダか、新しい名前にしてください。"}
    except OSError as e:
        return {"ok": False, "dest": str(dest), "problem": unreadable(e)}
    why = _can_write(p, nm)
    if why:
        return {"ok": False, "dest": str(dest), "problem": f"置く場所に書き込めません: {par}（{why}）"}
    try:
        where, items = _sources(store)
    except OSError as e:
        return {"ok": False, "dest": str(dest), "problem": f"いまの置き場を読めません（{getattr(e, 'strerror', None) or e}）。"}
    note = {"share": f"共有の置き場のマスタを写してから切り替えます。{RECORDS_NOTE if COPY_PRESENCE else ''}",
            "mirror": "共有の置き場に届かないので、この PC の写しから写して切り替えます（ほかの PC の最近の保存が入らないことがあります）。",
            "local": "この PC（手元のみ）のマスタを写してから切り替えます。"}[where]
    return {"ok": True, "mode": "copy", "dest": str(dest), "files": len(items), "bytes": sum(n for _, n, _ in items),
            "names": sorted(rel[:-5] for rel, _, _ in items if "/" not in rel), "caution": sync_caution(dest), "note": note}


def _share_root(store, server, name) -> dict:
    """上のフォルダがサーバーだけ（\\サーバー）＝置き場が共有の根（\\サーバー\共有）。サーバーはフォルダではないので「届きません」と
    断っていた（版 3.100.0。疑い 8: 全員の置き場へ「この PC をそろえる」が、置き場を上のフォルダと名前に分けて送る）。
    共有の根へは、既にマスタがある置き場へ切り替えるだけができる（共有の根に写して作ることはしない）"""
    dest = Path(f"{server}\\{name}")
    try:
        found = is_master_place(dest)
    except OSError as e:
        return {"ok": False, "dest": str(dest), "problem": unreadable(e)}
    if not found:
        return {"ok": False, "dest": str(dest), "problem": f"共有の根（{dest}）には、既にマスタがある置き場へ切り替えることだけができます。"
                "写して作るときは、共有の中のフォルダを置く場所に選んでください。"}
    if store.share_dir and _same(dest, store.share_dir):
        return {"ok": False, "dest": str(dest), "problem": "いまの置き場と同じです。"}
    return {"ok": True, "mode": "switch", "dest": str(dest), "files": 0, "bytes": 0, "caution": sync_caution(dest),
            "note": "既にマスタがある置き場です。写さずに切り替えます（その置き場のマスタを使います）。"}


def move(store, parent, name) -> dict:
    """置き場を変える（plan が通るときだけ）。→ plan の答え＋{from}。失敗は ValueError（理由）。"""
    pl = plan(store, parent, name)
    if not pl["ok"]:
        raise ValueError(pl["problem"])
    with store.exclusive():     # 写す・切り替える・印を置くまで、この PC の保存を止め、前の置き場の錠を持つ（途中の保存を前の置き場に落とさない）
        return _move_locked(store, pl)


def _move_locked(store, pl) -> dict:
    dest, old = Path(pl["dest"]), store.share_dir
    if pl["mode"] == "copy":
        tmp = dest.parent / f".{dest.name}.tmp-{uuid.uuid4().hex[:8]}"
        try:
            _, items = _sources(store)      # **錠を取ってから**読み直す（plan の後にほかの PC が保存した分も写す）
            tmp.mkdir()
            files = size = 0
            for rel, _, read in items:
                try:
                    data = read()
                except FileNotFoundError:
                    if rel.startswith(PRESENCE_DIR + "/"):
                        continue            # 利用状況の片付けで消えた（錠の外）
                    raise
                target = tmp / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                _write_file(target, data)
                files, size = files + 1, size + len(data)
            pl["files"], pl["bytes"] = files, size    # 写した量（plan の後に保存があれば、確かめた時の量と違う）
            if dest.exists():
                dest.rmdir()          # plan で空と確かめた
            os.replace(tmp, dest)
        except OSError as e:
            shutil.rmtree(tmp, ignore_errors=True)
            raise ValueError(f"写せませんでした: {e}") from e
    # 戻した先（前に使っていた置き場）に残っている引っ越し先の印は、もう古い。残すとほかの PC がたどって輪になる（版 3.34.0）
    try:
        (dest / MOVED_FILENAME).unlink(missing_ok=True)
    except OSError:
        pl["warning"] = f"切り替えた置き場（{dest}）に残っていた前の引っ越し先の印を消せませんでした。"
    store.retarget(dest, chosen=True)
    if old and old.is_dir() and not _same(old, dest):
        try:   # 前の置き場に引っ越し先の印（ほかの PC がたどる）
            write_json_atomic(old / MOVED_FILENAME, {"to": str(dest), "at": _iso(_now()), "by": dict(store.who)})
        except OSError:
            pl["warning"] = f"前の置き場（{old}）に引っ越し先の印を置けませんでした。ほかの PC では「置き場を変える」で {dest} を選んでください。"
    pl["from"] = str(old or "")
    return pl


# ---- 置き場の状態（GET /api/masters/status・/api/masters/place）。共有を見るのは SHARE_PROBE_SEC まで（版 3.100.0。疑い 2:
# 届かない SMB は 1 か所数十秒待つことがあり、画面は 5 秒ごとに尋ねる）。終わらなければ写しで答え、届かないとする（画面は真偽で読む）
_PROBES = {}
_PROBES_LOCK = threading.Lock()


def _bounded(key, fn, seconds):
    """fn() を別の糸で動かし、seconds 秒まで待つ → (終わったか, 答え)。同じ key の前の糸がまだ終わっていなければ、新しい糸は起こさない
    （届かない共有へ尋ねるたびに糸が積み上がらない）"""
    with _PROBES_LOCK:
        th = _PROBES.get(key)
        if th is not None and th.is_alive():
            return False, None
        box = {}

        def run():
            try:
                box["value"] = fn()
            except Exception as e:  # noqa: BLE001 呼んだ側へ渡す
                box["error"] = e
        th = threading.Thread(target=run, daemon=True)
        _PROBES[key] = th
        th.start()
    th.join(seconds)
    if th.is_alive():
        return False, None
    if "error" in box:
        raise box["error"]
    return True, box.get("value")


def status(store) -> dict:
    """GET /api/masters/status の答え（MasterStore.status＋同期フォルダの注意）。共有を見るのは SHARE_PROBE_SEC まで"""
    if store.share_dir is None:
        st = store.status()
    else:
        done, st = _bounded(("status", id(store)), store.status, SHARE_PROBE_SEC)
        if not done:
            st = store.status(peek=True)
            st.update(reachable=False, lock=None,
                      error=f"共有の置き場が {SHARE_PROBE_SEC:g} 秒で答えません（前に取り込んだ写しで表示しています）: {store.share_dir}")
    st["caution"] = sync_caution(st["dir"]) if st["mode"] == "shared" else ""
    return st


def using(dirs, online_in) -> list:
    """置き場ごとに、いま使っている PC → [{dir, reachable, pcs}]。届くかはまとめて SHARE_PROBE_SEC まで（終わらなければ届かない）"""
    out, seen = [], set()
    for d in dirs:
        key = d.replace("/", "\\").rstrip("\\").lower()
        if not d or key in seen:
            continue
        seen.add(key)
        out.append({"dir": d, "reachable": False, "pcs": []})
    boxes = [{} for _ in out]

    def probe(row, box):
        try:
            box["pcs"] = online_in(row["dir"])
        except Exception:  # noqa: BLE001 届かない
            box["pcs"] = None
    threads = [threading.Thread(target=probe, args=(r, b), daemon=True) for r, b in zip(out, boxes)]
    for t in threads:
        t.start()
    end = time.monotonic() + SHARE_PROBE_SEC
    for t in threads:
        t.join(max(0.0, end - time.monotonic()))
    for row, box in zip(out, boxes):
        if "pcs" in box:
            row.update(reachable=box["pcs"] is not None, pcs=box["pcs"] or [])
    return out
