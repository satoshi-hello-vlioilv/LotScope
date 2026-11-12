# -*- coding: utf-8 -*-
"""置き場と設定 8 本（版 3.100.0。GET /api/masters/tabaccess・status・place・POST place/check・move・fs/browse・GET fs/places・
POST settings/check）の「Python に頼らない独立の答え」。app を import しない（os.walk・os.scandir・os.stat・json・re・ntpath・posixpath だけ）。

    python tools/place-truth.py [事例の表.json]      # 事例の表（tests/fixtures/place_cases.json）を独立の答えで確かめ直す

決まり（仕様から書いた。app のコードは読まない）:
- フォルダの名前 … Microsoft「Naming Files, Paths, and Namespaces」の決まり（Python 3.13 の ntpath.isreserved が写した物: 予約名 CON・PRN・AUX・NUL・
  COM1〜9・COM¹²³・LPT1〜9・LPT¹²³・CONIN$・CONOUT$。拡張子と、拡張子の前の空白を除いて大文字で比べる・末尾の「.」と空白・使えない字
  <>:"/\\|? * と制御文字）に、このアプリの決まり（空・120 字まで・「.」「..」・先頭が「.」の名前〈「参照…」に出ない〉）を重ねる
- 引っ越しで写す物 … 前の置き場の直下の *.json（名前が「.」で始まる物・錠 master.lock.json・引っ越しの印 _MOVED.json を除く）と、
  利用状況 presence_tpa の記録（history・sessions の下の全部・settings.json）と切断の指示（*.revoke.json）。心拍（presence_tpa 直下の
  ほかの *.json）は写さない（写すと、まだ移っていない PC が新しい置き場で使っているように見える）。写した物は錠を取った時の中身と同じ字
- 写す量 … 書いた後のファイルの大きさ（os.stat の st_size）の計
- 引っ越しの途中のほかの PC の保存 … 引っ越しが錠の長さを超えても、ほかの PC の行は、その PC が印をたどった先の置き場に必ずある（row_ids・followed）
- 作業実績のフォルダの印 … ファイル名の決まり（* をちょうど 1 つ）に、大文字小文字を見ずに頭と尾が合い、* の所の前後の空白を除いて空でない、
  書き手の作業用でない（「.」で始まる・.pending_ を含む・-journal・-wal・-shm・.incoming で終わる）ファイル（フォルダは数えない）の数。[ ] ? は字のまま
- ファイルを選ぶ欄の印 … 数えた拡張子ごとの数（大文字小文字を見ない。「.」「~$」で始まる物は出さないので数えない）
- 並び … エクスプローラーと同じ自然な並び（数字の続きは数として比べる・大文字小文字を見ない・同じ所では数字が先）
- 欄の字 → 道 … 字の上で整える（ntpath.normpath。Windows の形〈ドライブ・\\\\〉でない字は posixpath.normpath）。記号リンクは解かない。
  ドライブだけ（C:）はその根（C:\\）
- 同期フォルダの注意 … 手元のドライブの中の各社の既定の名前の段（共有 \\\\サーバー\\… は同期フォルダではないので見ない）
"""
import json
import ntpath
import os
import posixpath
import re
import sys
from pathlib import Path

NAME_MAX = 120
LOCK = "master.lock.json"
MOVED = "_MOVED.json"
PRESENCE = "presence_tpa"
SYNC = {"box": "Box", "boxdrive": "Box", "onedrive": "OneDrive", "dropbox": "Dropbox", "google drive": "Google ドライブ",
        "googledrive": "Google ドライブ", "マイドライブ": "Google ドライブ", "my drive": "Google ドライブ", "icloud drive": "iCloud Drive"}


# ---------------------------------------------------------------- フォルダの名前
def name_ok(name) -> bool:
    """その字を（前後の空白を除いて）フォルダの名前に使えるか"""
    s = str(name).strip()
    if not s or len(s) > NAME_MAX or s in (".", "..") or s.startswith("."):
        return False
    if any(c in '<>:"/\\|?*' or ord(c) < 32 for c in s):   # isreserved は区切り・ドライブで段に分けて見るので、使えない字は別に断る
        return False
    return not ntpath.isreserved(s)


# ---------------------------------------------------------------- 引っ越し
def copied_names(share: Path) -> list:
    """前の置き場 → 写す物の相対の道（/ 区切り・名前の順）"""
    out = []
    for e in os.scandir(share):
        if e.is_file() and e.name.endswith(".json") and not e.name.startswith(".") and e.name not in (LOCK, MOVED):
            out.append(e.name)
    pres = share / PRESENCE
    if pres.is_dir():
        for e in os.scandir(pres):
            if e.is_file() and not e.name.startswith(".") and (e.name == "settings.json" or e.name.endswith(".revoke.json")):
                out.append(f"{PRESENCE}/{e.name}")
        for sub in ("history", "sessions"):
            for root, dirs, files in os.walk(pres / sub):
                dirs[:] = [d for d in dirs if not d.startswith(".")]
                for f in files:
                    if not f.startswith("."):
                        out.append((Path(root) / f).relative_to(share).as_posix())
    return sorted(out)


def row_ids(folder: Path, master: str) -> set:
    """置き場のマスタの行の id（無ければ空）。引っ越しの場面で、ほかの PC の保存が消えていないかを見る"""
    p = Path(folder) / f"{master}.json"
    if not p.is_file():
        return set()
    doc = json.loads(p.read_bytes().decode("utf-8-sig"))
    rows = doc["rows"] if isinstance(doc, dict) else doc
    return {r.get("id") for r in rows if isinstance(r, dict)}


def followed(start: Path, hops: int = 5) -> Path:
    """引っ越しの印（_MOVED.json の to）をたどった先（ほかの PC が移る置き場）"""
    cur = Path(start)
    for _ in range(hops):
        m = cur / MOVED
        if not m.is_file():
            break
        nxt = Path(json.loads(m.read_bytes().decode("utf-8-sig")).get("to") or "")
        if not nxt.is_dir():
            break
        cur = nxt
    return cur


def tree_bytes(folder: Path) -> dict:
    """フォルダの中のファイル → {相対の道: 中身のバイト}"""
    out = {}
    for root, _, files in os.walk(folder):
        for f in files:
            p = Path(root) / f
            out[p.relative_to(folder).as_posix()] = p.read_bytes()
    return out


def tree_size(folder: Path):
    """→ (ファイルの数, os.stat の st_size の計)"""
    n = size = 0
    for root, _, files in os.walk(folder):
        for f in files:
            n += 1
            size += os.stat(Path(root) / f).st_size
    return n, size


def same_json(a: bytes, b: bytes) -> bool:
    return json.loads(a.decode("utf-8-sig")) == json.loads(b.decode("utf-8-sig"))


# ---------------------------------------------------------------- 印
def equipment_count(folder: Path, pattern: str):
    """作業実績のフォルダの印の数（決まりが読めなければ None）"""
    if str(pattern).count("*") != 1:
        return None
    head, tail = str(pattern).strip().split("*")
    h, t = head.lower(), tail.lower()
    n = 0
    for e in os.scandir(folder):
        low = e.name.lower()
        if low.startswith(".") or ".pending_" in low or low.endswith(("-journal", "-wal", "-shm", ".incoming")):
            continue
        if len(e.name) <= len(head) + len(tail) or not low.startswith(h) or not low.endswith(t):
            continue
        if not e.name[len(head):len(e.name) - len(tail)].strip() or not e.is_file():
            continue
        n += 1
    return n


def ext_counts(folder: Path, exts) -> list:
    """[(拡張子, 数)]（数えた物だけ。exts の順）"""
    got = {x: 0 for x in exts}
    for e in os.scandir(folder):
        if e.name.startswith((".", "~$")) or not e.is_file():
            continue
        low = e.name.lower()
        for x in exts:              # 長い拡張子から見ないと .sqlite3 を .sqlite と数えうるが、尾の一致なので重ならない
            if low.endswith(x):
                got[x] += 1
                break
    return [(x, n) for x, n in got.items() if n]


# ---------------------------------------------------------------- 並び・道の字・同期フォルダ
def natural_key(name: str):
    parts = [p for p in re.split(r"([0-9]+)", name) if p]
    return [(0, int(p), "") if p.isdigit() and p.isascii() else (1, 0, p.lower()) for p in parts], name.lower(), name


def windows_shaped(s: str) -> bool:
    return s.startswith("\\\\") or (os.name == "nt" and s.startswith("//")) or (len(s) >= 2 and s[1] == ":" and s[0].isascii() and s[0].isalpha())


def tidy(s: str) -> str:
    """字の上で整えた道（記号リンクは解かない）"""
    if not s:
        return s
    if windows_shaped(s):
        if len(s) == 2:
            return s + "\\"
        out = ntpath.normpath(s)
        return out if (len(out) == 3 and out[1] == ":") else out.rstrip("\\") or out
    out = posixpath.normpath(s)
    return out.rstrip("/") or out[:1]


def sync_kind(path: str) -> str:
    s = str(path or "")
    if s[:2] in ("\\\\", "//"):
        return ""
    for part in re.split(r"[\\/]+", s):
        low = part.strip().lower()
        if low in SYNC:
            return SYNC[low]
        if low.startswith("onedrive"):
            return "OneDrive"
    return ""


# ---------------------------------------------------------------- 事例の表を確かめ直す
def _make_marks(d: Path, cs):
    for n in cs.get("files", []):
        (d / n).write_bytes(b"x")
    for n in cs.get("dirs", []):
        (d / n).mkdir()


def check_table(cases) -> list:
    """事例の表を独立の答えで確かめる → 食い違いの字の並び"""
    import tempfile
    bad = []
    for cs in cases["names"]:
        if name_ok(cs["name"]) != cs["ok"]:
            bad.append(f"名前 {cs['name']!r}: 事例 {cs['ok']} / 独立の答え {not cs['ok']}")
    for cs in cases["sort"]:
        if sorted(cs, key=natural_key) != cs or sorted(reversed(cs), key=natural_key) != cs:
            bad.append(f"並び {cs}: 独立の答え {sorted(cs, key=natural_key)}")
    for cs in cases["clean"]:
        if (cs.get("os") and cs["os"] != os.name) or cs["text"].lower().startswith("file:"):
            continue              # file:// の読み替えは字の整えの前の決まり（事例の答えだけで見る）
        got = tidy(cs["text"].strip().strip('"').strip())
        if got != cs["want"]:
            bad.append(f"道の字 {cs['text']!r}: 事例 {cs['want']!r} / 独立の答え {got!r}")
    for cs in cases["sync"]:
        if sync_kind(cs["path"]) != cs["kind"]:
            bad.append(f"同期 {cs['path']!r}: 事例 {cs['kind']!r} / 独立の答え {sync_kind(cs['path'])!r}")
    with tempfile.TemporaryDirectory() as t:
        for i, cs in enumerate(cases["marks"]):
            if cs.get("os") and cs["os"] != os.name:
                continue
            d = Path(t) / f"m{i}"
            d.mkdir()
            _make_marks(d, cs)
            if cs["purpose"] == "worklog":
                n = equipment_count(d, cs["pattern"])
                got = f"ファイルのある設備 {n} 台" if n else None
            elif cs["purpose"] in ("sqlite", "exe"):
                exts = (".sqlite3", ".sqlite", ".db") if cs["purpose"] == "sqlite" else (".exe",)
                got = "・".join(f"{x} が {n} 個" for x, n in ext_counts(d, exts)) or None
            else:
                continue
            if got != cs["want"]:
                bad.append(f"印 {cs['name']}: 事例 {cs['want']!r} / 独立の答え {got!r}")
        for i, cs in enumerate(cases["moves"]):
            d = Path(t) / f"v{i}"
            for rel, body in cs["share"].items():
                p = d / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(body if isinstance(body, str) else json.dumps(body, ensure_ascii=False), encoding="utf-8")
            if copied_names(d) != sorted(cs["copied"]):
                bad.append(f"写す物 {cs['name']}: 事例 {sorted(cs['copied'])} / 独立の答え {copied_names(d)}")
    return bad


def ask(argv):
    """窓の試験（desktop/tests/place_cases.rs。版 3.101.0）が独立の答えを尋ねる: --copied 置き場・--followed 置き場・--rows 置き場 マスタ・
    --tree-size フォルダ → JSON"""
    cmd, args = argv[0], argv[1:]
    if cmd == "--copied":
        return copied_names(Path(args[0]))
    if cmd == "--followed":
        return str(followed(Path(args[0])))
    if cmd == "--rows":
        return sorted(row_ids(Path(args[0]), args[1]), key=repr)
    if cmd == "--tree-size":
        return list(tree_size(Path(args[0])))
    raise SystemExit(f"知らない問い: {cmd}")


def main():
    if len(sys.argv) > 1 and sys.argv[1].startswith("--"):
        sys.stdout.write(json.dumps(ask(sys.argv[1:]), ensure_ascii=False))
        return 0
    table = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "place_cases.json"
    bad = check_table(json.loads(table.read_text(encoding="utf-8")))
    for b in bad:
        print("✕", b)
    print("OK" if not bad else f"{len(bad)} 件の食い違い")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
