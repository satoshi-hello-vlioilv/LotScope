# -*- coding: utf-8 -*-
"""配布の置き場を変える 3 本（POST /api/release/place/check・move・GET /api/release/place/progress）と写す係（Mover）の
「正しい答え」を出す係（版 3.95.0。desktop/tests/release_parity.rs が呼ぶ）。

    python tests/release_place_oracle.py 作業フォルダ

場面ごとに同じ中身のフォルダを 2 つ（py・rs）作り、py に Python の道（routes/settings.py。門番 _release_place_gate を含む）で
問い合わせの並びを当てる。道・本文の字の中の「@ROOT」は場面のフォルダ（py か rs）。窓の試験は rs に同じ並びを窓の道
（desktop/src/release_place.rs の handle。Lot と同じ順）で当て、答え（状態・本文。断る言葉も 1 字まで）と、終わった後のフォルダの中身
（ファイルの中身・大きさ・更新時刻・権限）を突き合わせる。写し始めた歩は、写し終えるまで待った後の進み具合（final）も比べる。
窓が答えず Python に任せる歩（delegates）は別の写し（pd）に当てる（形は settings_write_oracle.py と同じ）。
歩の形: hold（写す係を「写している最中」にしてから尋ねる。忙しい 409）・sync（写す係をその場で動かす: 2 つの PC が同じ置き場を写す形）。
GET /api/update/settings は page_parity.rs（settings_oracle.py の reads）が突き合わせ、ここでは名乗り（who）を 4 人と権限を読めない形で見る。
版 3.95.0 の作った後の採点（61.4 点）で見つけた割れの場面も入れた: 根の上のフォルダ（/・//・///・C:）・一時フォルダを作れない（ファイルが邪魔をする）・
名前付きパイプ・採点者の場面（記号リンク・権限 0・改行の名前・名前と本文の字）。
権限の場面（読めないファイル・フォルダ・書けない上のフォルダ）は root では意味を持たない（root は権限を見ずに読み書きできるので写せる答えどうしを比べる）。
CI は root でない利用者で動くので、そこで Python の PermissionError の答えと写しかけの片付けを必ず突き合わせる（出力の "root" を見て release_parity.rs が数を確かめる）。`--tables` は事例の表だけ（Path(上)/名前 の字を POSIX と Windows の
決まりで・OSError の str）を出す。
"""
import hashlib
import json
import logging
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from unittest import mock

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)
os.environ.pop("TPA_SHELL_SERVES", None)

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import identity, presence, release_place  # noqa: E402
import oracle_gate  # noqa: E402

BOSS, MAINT, VIEW, CUT = ("boss", "PC-1"), ("m1", "PC-2"), ("v1", "PC-3"), ("c1", "PC-4")
PERM = [{"id": 1, "ログインID": "boss", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有", "rev": 1},
        {"id": 2, "ログインID": "m1", "PC名": "", "権限区分": "メンテナンス者", "マスタ編集": "部分的編集可", "有効": "有"},
        {"id": 3, "ログインID": "v1", "PC名": "", "権限区分": "一般ユーザー", "マスタ編集": "閲覧のみ", "有効": "有"},
        {"id": 4, "ログインID": "c1", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可", "有効": "有"}]
CAN_LINK = True
T0 = 1_700_000_000_123_456_789          # 作った物の更新時刻（py と rs で同じにする。写した物は元の時刻を持つこと）


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


def S(who, method, path, body=None, query="", **kw):
    return {"who": list(who), "method": method, "path": path, "query": query,
            "body": body if isinstance(body, str) or body is None else j(body), **kw}


C, M, P = "/api/release/place/check", "/api/release/place/move", "/api/release/place/progress"
U = "/api/update/settings"
SRC = "@ROOT/rel/LotScope"


def A(parent, name, src=SRC, copy=True):
    return {"from": src, "parent": parent, "name": name, "copy": copy}


def place_files(root: Path, versions=("3.6.0", "3.7.0")):
    """窓が作る置き場に似た形（版のフォルダ・release.json・ZIP・配る版の覚え・入口の exe）"""
    for v in versions:
        (root / v).mkdir(parents=True, exist_ok=True)
        (root / v / "release.json").write_text(j({"version": v}), encoding="utf-8")
        (root / v / f"LotScope-{v}-windows.zip").write_bytes(b"z" * 1000 + v.encode())
    (root / "distribute.json").write_text(j({"version": versions[-1]}), encoding="utf-8")
    (root / "LotScope.exe").write_bytes(b"MZ" + b"0" * 200)
    (root / "空のフォルダ").mkdir(exist_ok=True)


def setup_plan(r: Path):
    global CAN_LINK
    place_files(r / "rel" / "LotScope")
    if os.name != "nt":
        os.chmod(r / "rel" / "LotScope" / "distribute.json", 0o444)    # 読むだけのファイルも写す（copy2 は権限も写す）
    (r / "new" / "occupied").mkdir(parents=True)
    (r / "new" / "occupied" / "x.txt").write_text("関係の無い物", encoding="utf-8")
    (r / "new" / "already" / "3.5.0").mkdir(parents=True)
    (r / "new" / "already" / "3.5.0" / "release.json").write_text("{}", encoding="utf-8")
    (r / "new" / "depth3" / "a" / "b").mkdir(parents=True)
    (r / "new" / "depth3" / "a" / "b" / "release.json").write_text("{}", encoding="utf-8")
    (r / "new" / "deep" / "a" / "b" / "c").mkdir(parents=True)
    (r / "new" / "deep" / "a" / "b" / "c" / "release.json").write_text("{}", encoding="utf-8")
    (r / "new" / "marker_dir" / "release.json").mkdir(parents=True)     # 目印の名前のフォルダ（ファイルでない）は目印にならない
    (r / "new" / "marker_dir" / "release.json" / "x").write_text("x", encoding="utf-8")
    (r / "new" / "empty_dir").mkdir()
    (r / "file.txt").write_text("ファイル", encoding="utf-8")
    try:
        os.symlink(r / "rel", r / "link", target_is_directory=True)
        os.symlink(r / "new" / "already", r / "new" / "linked", target_is_directory=True)
    except (OSError, NotImplementedError):
        CAN_LINK = False


def setup_broken(r: Path):
    place_files(r / "rel" / "LotScope")
    (r / "new").mkdir()
    (r / "rel" / "LotScope" / "sub").mkdir()
    os.symlink(r / "無い", r / "rel" / "LotScope" / "sub" / "broken")   # 写すときに読めない（copy2 は先をたどる）


def setup_two_pcs(r: Path):
    place_files(r / "rel" / "LotScope")
    (r / "new" / "first" / "3.9.9").mkdir(parents=True)                  # ほかの PC が先に写し終えた置き場（空でない）
    (r / "new" / "first" / "3.9.9" / "release.json").write_text("{}", encoding="utf-8")
    (r / "new" / "made_empty").mkdir(parents=True)                       # ほかの PC が空のフォルダだけ作った


def setup_probe(r: Path):
    """作った後の採点（版 3.95.0・61.4 点）の場面: 記号リンク（壊れた・空のフォルダへ・ファイルへ・輪）・空のファイル・権限 0・改行の名前"""
    setup_plan(r)
    n = r / "new"
    os.symlink(r / "無い", n / "brokenlink")
    (n / "e2").mkdir()
    os.symlink(n / "e2", n / "linkempty", target_is_directory=True)
    os.symlink(r / "file.txt", n / "linkfile")
    os.symlink(r / "loop2", r / "loop1")
    os.symlink(r / "loop1", r / "loop2")
    os.symlink(r / "file.txt", r / "pfile")
    s = r / "rel" / "LotScope"
    (s / "deepdir" / "x").mkdir(parents=True)
    os.symlink(s / "3.6.0", s / "dirlink", target_is_directory=True)
    os.symlink(s / "distribute.json", s / "filelink")
    (s / "zero.bin").write_bytes(b"")
    (s / "m000.bin").write_bytes(b"abc")
    os.chmod(s / "m000.bin", 0)
    (s / "改行\nの名前.txt").write_text("x", encoding="utf-8")


def setup_fifo(r: Path):
    """名前付きパイプ（Linux）: copy2 は開く前に「… is a named pipe」で断り、写しかけを片付ける"""
    place_files(r / "rel" / "LotScope")
    (r / "new").mkdir()
    os.mkfifo(r / "rel" / "LotScope" / "pipe")


def setup_unreadable(r: Path):
    place_files(r / "rel" / "LotScope")
    (r / "new").mkdir()


def scenarios():
    out = [
        {"name": "確かめる（名前・上のフォルダ・同じ所・中・既にある・空でない・写す量）", "setup": setup_plan, "steps": [
            S(BOSS, "POST", C, A("@ROOT/new", "")),
            S(BOSS, "POST", C, A("@ROOT/new", "  ")),
            S(BOSS, "POST", C, A("@ROOT/new", "a/b")),
            S(BOSS, "POST", C, A("@ROOT/new", "a\\b")),
            S(BOSS, "POST", C, A("@ROOT/new", "CON")),
            S(BOSS, "POST", C, A("@ROOT/new", "lpt9.old")),
            S(BOSS, "POST", C, A("@ROOT/new", "COM0")),
            S(BOSS, "POST", C, A("@ROOT/new", "end.")),
            S(BOSS, "POST", C, A("@ROOT/new", "\x01x:\x1f<")),
            S(BOSS, "POST", C, A("@ROOT/new", "x" * 121)),
            *([S(BOSS, "POST", C, A("@ROOT/new", "字" * 120))] if os.name == "nt" else []),
            S(BOSS, "POST", C, A("", "x")),
            # 空白だけの上のフォルダ: Windows（Win32）は段の末尾の空白を削るので、窓は答えず Python に任せる（release_place::win_trims）
            *([] if os.name == "nt" else [S(BOSS, "POST", C, A(' " " ', "x"))]),
            S(BOSS, "POST", C, A("@ROOT/無い", "x")),
            S(BOSS, "POST", C, A(' "@ROOT/new" ', "fresh")),
            S(BOSS, "POST", C, A("@ROOT/new", "fresh", copy=False)),
            S(BOSS, "POST", C, A("@ROOT/new", "fresh", src="")),
            S(BOSS, "POST", C, A("@ROOT/new", "fresh", src="@ROOT/無い置き場")),
            S(BOSS, "POST", C, A("@ROOT/new", "fresh", src="@ROOT/file.txt")),
            S(BOSS, "POST", C, A("@ROOT/rel", "LotScope")),
            S(BOSS, "POST", C, A("@ROOT/rel/LotScope", "sub")),
            S(BOSS, "POST", C, A("@ROOT/rel/LotScope/3.6.0", "x")),
            S(BOSS, "POST", C, A("@ROOT", "rel")),
            S(BOSS, "POST", C, A("@ROOT", "file.txt")),
            S(BOSS, "POST", C, A("@ROOT/new", "already")),
            S(BOSS, "POST", C, A("@ROOT/new", "already", copy=False)),
            S(BOSS, "POST", C, A("@ROOT/new", "occupied")),
            S(BOSS, "POST", C, A("@ROOT/new", "depth3")),
            S(BOSS, "POST", C, A("@ROOT/new", "deep")),
            S(BOSS, "POST", C, A("@ROOT/new", "marker_dir")),
            S(BOSS, "POST", C, A("@ROOT/new", "empty_dir")),
            S(BOSS, "POST", C, A("@ROOT/new/", " fresh2 ")),
            S(BOSS, "POST", C, A("@ROOT//new/./", "x")),
            S(BOSS, "POST", C, A("@ROOT/new/../new", "x")),
            S(BOSS, "POST", C, A("@ROOT/rel", "LotScope", src="@ROOT/rel/../rel/LotScope")),
            S(BOSS, "POST", C, A("@ROOT/rel/", "LotScope", src=' "@ROOT/rel/LotScope/" ')),
            S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": "c0", "copy": 0}),
            S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": "cs", "copy": "false"}),
            S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": "cn", "copy": None}),
            S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": "cf", "copy": False}),
            S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": 123}),
            S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": True}),
            S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": 1.5}),
            S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": 1e16}),
            S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": 0}),
            S(BOSS, "POST", C, {"from": False, "parent": "@ROOT/new", "name": "nf"}),
            S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": "x", "extra": [1]}),
            S(BOSS, "POST", C, ""),
            S(BOSS, "POST", C, "null"),
            S(BOSS, "POST", C, "0"),
            S(BOSS, "POST", C, "[]"),
            S(BOSS, "POST", C, "{壊れた"),
            S(VIEW, "POST", C, A("@ROOT/new", "見るだけの人も確かめられる")),
        ], "delegates": [
            *([S(BOSS, "POST", C, A(' " " ', "x"))] if os.name == "nt" else []),
            # 名前が 255 バイトを超える（Linux）: Python 3.13 の Path.exists は ENAMETOOLONG で落ちる（500）。窓は答えない
            *([] if os.name == "nt" else [S(BOSS, "POST", C, A("@ROOT/new", "字" * 120))]),
            S(BOSS, "POST", C, "[1]"),
            S(BOSS, "POST", C, '"x"'),
            S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": ["a"]}),
            S(BOSS, "POST", C, {"from": SRC, "parent": {"a": 1}, "name": "x"}),
            S(BOSS, "POST", C, '{"name": NaN, "parent": "x"}'),
            oracle_gate.W(S(BOSS, "POST", C, '{"name": 99999999999999999999, "parent": "x"}')),     # 版 3.108.0（H2）: 窓も桁のまま読む
            oracle_gate.W(S(BOSS, "POST", C, '{"from": "@ROOT/rel/LotScope", "parent": "@ROOT/new", "name": 10000000000000000000}')),
            S(BOSS, "POST", C, A("@ROOT/new", "fresh"), query="engine=python"),
            S(BOSS, "GET", P, query="engine=python"),
        ]},
        {"name": "写す（move と進み具合・写した後は既に置き場・忙しい）", "setup": setup_plan, "steps": [
            S(BOSS, "GET", P),
            S(BOSS, "POST", M, A("@ROOT/new", "fresh"), wait=True),
            S(BOSS, "GET", P, wait=True),
            S(BOSS, "POST", C, A("@ROOT/new", "fresh")),
            S(BOSS, "POST", M, A("@ROOT/new", "fresh")),
            S(BOSS, "POST", M, A("@ROOT/new", "empty1", copy=False)),
            S(BOSS, "POST", M, A("@ROOT/new", "already")),
            S(BOSS, "POST", M, A("@ROOT/new", "a:b")),
            S(BOSS, "POST", M, A("@ROOT/rel", "LotScope")),
            S(BOSS, "POST", M, A("@ROOT/new", "fresh3", src="")),
            S(BOSS, "POST", M, A("@ROOT/new", "fresh4"), hold=True),
            S(BOSS, "POST", M, A("@ROOT/new", "already"), hold=True),
            S(BOSS, "POST", M, A("@ROOT/new/fresh", "中には置けない", src="@ROOT/new/fresh")),
            S(BOSS, "POST", M, A("@ROOT/new", "fresh5", src="@ROOT/new/fresh"), wait=True),
            S(BOSS, "POST", M, ""),
        ], "delegates": [
            S(BOSS, "POST", M, {"from": SRC, "parent": "@ROOT/new", "name": ["a"]}),
            S(BOSS, "POST", M, "[1]"),
            S(BOSS, "POST", M, A("@ROOT/new", "py"), query="engine=python"),
        ]},
        {"name": "門番（版を置けない・参照先を書けない・切断・確かめと進み具合は門番なし）", "setup": setup_plan, "revoke": CUT, "steps": [
            S(VIEW, "POST", M, A("@ROOT/new", "fresh")),
            S(MAINT, "POST", M, A("@ROOT/new", "fresh")),
            S(CUT, "POST", M, A("@ROOT/new", "fresh")),
            S(VIEW, "POST", M, {"name": ["門番が先"]}),
            S(VIEW, "POST", M, "[1]"),
            S(MAINT, "POST", C, A("@ROOT/new", "fresh")),
            S(CUT, "POST", C, A("@ROOT/new", "fresh")),
            S(VIEW, "GET", P),
        ]},
        {"name": "権限を読めない（門番は 503）", "setup": setup_unreadable, "perm": ["表でない行"], "steps": [
            S(BOSS, "POST", M, A("@ROOT/new", "fresh")),
            S(BOSS, "POST", C, A("@ROOT/new", "fresh")),
        ]},
        {"name": "2 つの PC が同じ置き場を写す（先に置き場ができた・空のフォルダだけ）", "setup": setup_two_pcs, "steps": [
            {"sync": {"src": SRC, "dest": "@ROOT/new/first"}},
            {"sync": {"src": SRC, "dest": "@ROOT/new/made_empty"}},
            {"sync": {"src": "@ROOT/無い置き場", "dest": "@ROOT/new/none"}},
        ]},
    ]
    # 名乗り（GET /api/update/settings の who）: 権限の表のある 4 人（開発者・メンテナンス者〈部分的編集可〉・一般ユーザー・切断された開発者）
    out.append({"name": "名乗り（4 人・切断）", "setup": setup_unreadable, "revoke": CUT, "steps": [S(w, "GET", U) for w in (BOSS, MAINT, VIEW, CUT)]})
    out.append({"name": "名乗り（権限を読めない）", "setup": setup_unreadable, "perm": ["表でない行"], "steps": [S(BOSS, "GET", U)]})
    # 上のフォルダが根・ファイルが邪魔をする（写す係の一時フォルダを作れない）・上が無い（作ってから写す）
    if os.name != "nt":
        out.append(perm_scenario())
    # 根の上のフォルダ（/・//・///）は POSIX の場面（Windows の / は今のドライブの根・// は UNC で、意味が違う。Windows の根・ドライブ・UNC の
    # 字は事例の表 joined_paths_match_python で両方の決まりを突き合わせる）。ドライブだけの上のフォルダ（C:）は、Python がドライブごとの
    # 今のフォルダで解くので窓は答えず任せる（Windows）。一時フォルダを作れない形（ファイルが邪魔をする）・上が無い形はどちらでも
    drive = os.path.splitdrive(str(Path.cwd()))[0]
    out.append({"name": "根の上のフォルダ・一時フォルダを作れない", "setup": setup_two_pcs, "steps": [
        S(BOSS, "POST", C, A(x, "relprobe-nonexist-q9")) for x in (("/", "//", "///", "//tmp", "/tmp/", " / ") if os.name != "nt" else ())] + [
        {"sync": {"src": SRC, "dest": "@ROOT/new/first/release.json/under"}},
        {"sync": {"src": SRC, "dest": "@ROOT/new/無い/上/置き場"}},
    ], "delegates": [S(BOSS, "POST", C, A(drive, "relprobe-nonexist-q9"))] if os.name == "nt" and drive else []})
    if os.name != "nt":
        out.append(probe_scenario())
        out.append({"name": "名前付きパイプ（開く前に断る・写しかけを片付ける・次の move は忙しくない）", "setup": setup_fifo, "steps": [
            S(BOSS, "POST", C, A("@ROOT/new", "fresh")),
            S(BOSS, "POST", M, A("@ROOT/new", "fresh"), wait=True),
            S(BOSS, "GET", P),
            S(BOSS, "POST", M, A("@ROOT/new", "fresh2"), wait=True),
            {"sync": {"src": SRC, "dest": "@ROOT/new/fresh3"}},
        ]})
        out.append({"name": "写せない（読めないファイル）: 写しかけを片付ける", "setup": setup_broken, "steps": [
            S(BOSS, "POST", C, A("@ROOT/new", "fresh")),
            S(BOSS, "POST", M, A("@ROOT/new", "fresh"), wait=True),
            S(BOSS, "GET", P, wait=True),
        ]})
    return out


ROOT = os.name != "nt" and os.geteuid() == 0


def setup_perm(r: Path):
    place_files(r / "rel" / "LotScope")
    (r / "rel" / "LotScope" / "zz.bin").write_bytes(b"zz")
    (r / "rel" / "LotScope" / "secret").mkdir()
    (r / "rel" / "LotScope" / "secret" / "s.txt").write_text("s", encoding="utf-8")
    (r / "rel2" / "LotScope").mkdir(parents=True)
    (r / "rel2" / "LotScope" / "only").mkdir()
    (r / "rel2" / "LotScope" / "only" / "a.txt").write_text("a", encoding="utf-8")
    (r / "rel2" / "LotScope" / "hidden").mkdir()
    (r / "rel2" / "LotScope" / "hidden" / "h.txt").write_text("h", encoding="utf-8")
    (r / "new" / "ro").mkdir(parents=True)
    (r / "new" / "noread").mkdir()
    (r / "new" / "noread" / "x").write_text("x", encoding="utf-8")


def lock_perm(r: Path):
    os.chmod(r / "rel" / "LotScope" / "zz.bin", 0)               # 読めないファイル（写すと PermissionError）
    os.chmod(r / "rel2" / "LotScope" / "hidden", 0)              # 読めないフォルダ（os.walk は黙って飛ばす・写す量に数えない）
    os.chmod(r / "new" / "ro", 0o555)                             # 書けない上のフォルダ（一時フォルダを作れない）
    os.chmod(r / "new" / "noread", 0)                             # 中を読めない置き場（iterdir が落ちる: Python は 500）


def perm_scenario():
    """権限の場面（POSIX）。root は権限を見ずに読み書きできるので、root で流すと読めない・書けない形にならず、写せる答えどうしを比べる。
    CI（root でない利用者）では Python の PermissionError の答えと、写しかけの片付けを突き合わせる（release_parity.rs が数を確かめる）"""
    noread = S(BOSS, "POST", C, A("@ROOT/new", "noread"))
    return {"name": "権限（読めないファイル・読めないフォルダ・書けない上のフォルダ・中を読めない置き場）", "setup": setup_perm, "lock": lock_perm,
            "steps": [S(BOSS, "POST", C, A("@ROOT/new", "fresh")),
                      S(BOSS, "POST", M, A("@ROOT/new", "fresh"), wait=True),
                      S(BOSS, "POST", C, A("@ROOT/new", "only", src="@ROOT/rel2/LotScope")),
                      S(BOSS, "POST", M, A("@ROOT/new", "only", src="@ROOT/rel2/LotScope"), wait=True),
                      S(BOSS, "POST", C, A("@ROOT/new/ro", "x", src="@ROOT/rel2/LotScope")),
                      S(BOSS, "POST", M, A("@ROOT/new/ro", "x", src="@ROOT/rel2/LotScope"), wait=True),
                      {"sync": {"src": "@ROOT/rel2/LotScope", "dest": "@ROOT/new/ro/y"}},
                      *([noread] if ROOT else []),
                      S(BOSS, "GET", P)],
            "delegates": [] if ROOT else [noread]}


def probe_scenario():
    """作った後の採点者の場面（scratchpad/built-rel/probe_oracle.py。Linux）"""
    names = ["　x　", "\x1fabc\x1c", "x\x85", "\xa0x", "x\x7f", "Com1", "nul.tar.gz", "lpt1 .txt", "COM¹",
             "a" * 120 + "　", "x\u200b", "x ", ".", "..", " .x", "conı", "ＣＯＮ", "x\t", "\x1b", "x　.", "AUX ",
             "Con.", "LPT0", "lpt²"]
    vals = [5e-324, -1.5e-7, 1.0, 1e100, 123456789012345678, -0.0, "0", [], {}, 0.0, 1e22, 1e-5, 0.1, 2.5e15]
    steps = [*[S(BOSS, "POST", C, A("@ROOT/new", n)) for n in names],
             *[S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": v}) for v in vals],
             *[S(BOSS, "POST", C, {"from": SRC, "parent": "@ROOT/new", "name": "cp", "copy": v}) for v in ["", [], {}, None, 0.0, "False"]],
             S(BOSS, "POST", C, '{"from": "@ROOT/rel/LotScope", "parent": "@ROOT/new", "name": "a", "name": "b:"}'),
             S(BOSS, "POST", C, {"from": ".", "parent": "..", "name": "program"}),
             S(BOSS, "POST", C, {"from": "tests", "parent": ".", "name": "tests"}),
             S(BOSS, "POST", C, {"from": "..", "parent": "@ROOT/new", "name": "y", "copy": False}),
             S(BOSS, "POST", C, {"from": "@ROOT/rel/LotScope", "parent": ".", "name": "zz-probe-nonexist"}),
             S(BOSS, "POST", C, A("@ROOT/link/../rel", "LotScope")),
             S(BOSS, "POST", C, A("@ROOT/loop1", "x")),
             S(BOSS, "POST", C, A("@ROOT/new", "x", src="@ROOT/loop1/x")),
             S(BOSS, "POST", C, A("@ROOT/new", "brokenlink")),
             S(BOSS, "POST", C, A("@ROOT/new", "linkempty")),
             S(BOSS, "POST", C, A("@ROOT/new", "linkfile")),
             S(BOSS, "POST", C, A("@ROOT/pfile", "x")),
             S(BOSS, "POST", C, A("@ROOT/rel", "LotScope", src="@ROOT/rel/LotScope/3.6.0/..")),
             S(BOSS, "POST", C, A("@ROOT/rel/LotScope", "sub", src="@ROOT/rel/LotScope/../LotScope")),
             # 空白だけの上のフォルダ: Windows（Win32）は段の末尾の空白を削るので、窓は答えず Python に任せる（release_place::win_trims）
             *([] if os.name == "nt" else [S(BOSS, "POST", C, A(' "  " ', "x"))]),
             S(BOSS, "POST", C, A("@ROOT/new/../rel/../link", "LotScope")),
             S(BOSS, "POST", C, A("@ROOT/new", "LotScope", src="@ROOT/rel/LotScope/")),
             S(BOSS, "POST", C, A("@ROOT/new", "linked/")),
             S(BOSS, "POST", C, A("@ROOT/new", "fresh", src="@ROOT/rel/LotScope/dirlink/..")),
             S(BOSS, "GET", U), S(MAINT, "GET", U), S(VIEW, "GET", U), S(CUT, "GET", U),
             S(BOSS, "POST", M, A("@ROOT/new", "fresh"), wait=True),
             S(BOSS, "POST", M, A("@ROOT/new", "brokenlink"), wait=True),
             S(BOSS, "POST", M, A("@ROOT/new", "linkempty"), wait=True),
             S(BOSS, "POST", M, A("@ROOT/new", "x　"), wait=True),
             {"sync": {"src": SRC, "dest": "@ROOT/file.txt/under"}},
             {"sync": {"src": SRC, "dest": "@ROOT/new/occupied/x/y"}}]
    nul = [S(BOSS, "POST", C, A("@ROOT/new\u0000x", "x")),
           S(BOSS, "POST", C, A("@ROOT/new", "x", src="@ROOT/rel\u0000")),
           S(BOSS, "POST", M, A("@ROOT/new\u0000x", "x")),
           *([S(BOSS, "POST", C, A(' "  " ', "x")), S(BOSS, "POST", C, A("@ROOT/new. ", "x")),
              S(BOSS, "POST", C, A("@ROOT/new", "x", src="@ROOT/rel/LotScope. "))] if os.name == "nt" else [])]
    return {"name": "採点者: 確かめる・名乗り・写す", "setup": setup_probe, "revoke": CUT, "steps": steps, "delegates": nul}


JOIN_PARENTS = ["/", "//", "///", "//tmp", "/tmp/", "/a//b/", "a", ".", "./a/..", "C:", "C:\\", "C:/x/", "C:x", "\\", "\\x",
                "\\\\srv\\share", "\\\\srv\\share\\", "\\\\srv\\share\\d", "//srv/share", "\\\\srv", " \"/q\" ", "c:/A/B/"]


def joins():
    """str(Path(上のフォルダ) / 名前) の事例の表（POSIX と Windows の決まり。窓は release_place::join_for で両方を突き合わせる）"""
    from pathlib import PurePosixPath, PureWindowsPath
    from app.fsio import unquote_path
    out = []
    for x in JOIN_PARENTS:
        for name in ("n", "名前.v"):
            up = unquote_path(x)
            out.append({"parent": x, "name": name, "posix": str(PurePosixPath(up) / name), "win": str(PureWindowsPath(up) / name),
                        "posixBase": str(PurePosixPath(up)), "winBase": str(PureWindowsPath(up))})
    return out


def oserrors():
    """OSError の str の事例の表（Linux の errno と文。道は 0〜2 つ・引用符・\\・改行・印字できない字）"""
    if os.name == "nt":
        return []
    import errno
    paths = ["/a/b", "/x'y", "/x\"y", "/x'\"y", "C:\\a", "/改行\nの名前", "/\x1f\x7f\x85\xa0", "/\u3000\u200b\ue000\ufeff", "/タブ\t"]
    out = []
    for n in (errno.ENOENT, errno.ENOTDIR, errno.ENOTEMPTY, errno.ENOSPC, errno.EACCES, errno.ENXIO, errno.EISDIR):
        for a, b in [(None, None), (paths[0], None)] + [(x, None) for x in paths[1:]] + [(paths[0], x) for x in paths[1:3]]:
            e = OSError(n, os.strerror(n), a, None, b) if b else OSError(n, os.strerror(n), a) if a else OSError(n, os.strerror(n))
            out.append({"errno": n, "a": a, "b": b, "str": str(e)})
    return out


def link_steps():
    """記号リンク（作れる PC だけ）: リンクをたどると同じ所・既に置き場"""
    return [S(BOSS, "POST", C, A("@ROOT/rel", "LotScope", src="@ROOT/link/LotScope")),
            S(BOSS, "POST", C, A("@ROOT/link", "LotScope")),
            S(BOSS, "POST", C, A("@ROOT/link/LotScope", "x")),
            S(BOSS, "POST", C, A("@ROOT/new", "linked"))]


def fix_times(root: Path):
    """作った物の更新時刻をそろえる（道の字の順に 1 秒ずつ。py と rs で同じ）"""
    files = sorted(p for p in root.rglob("*") if p.is_file() and not p.is_symlink())
    for i, p in enumerate(files):
        t = T0 + i * 1_000_000_000
        if os.utime in os.supports_follow_symlinks:       # POSIX（記号リンクは上で除いているが、念のためたどらない）
            os.utime(p, ns=(t, t), follow_symlinks=False)
        else:                                            # Windows は follow_symlinks を渡せない（記号リンクは上で除いた）
            os.utime(p, ns=(t, t))


def listing(root: Path):
    """フォルダの中身（道 → 形）。写しかけの一時フォルダが残っていないかも見る"""
    out = {}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith(("app/", "local/", "share/")) or rel in ("app", "local", "share"):
            continue
        if p.is_symlink():
            out[rel] = {"type": "link"}
        elif p.is_dir():
            out[rel] = {"type": "dir"}
        elif not p.is_file():
            out[rel] = {"type": "special"}       # 名前付きパイプなど（読むと止まる）
        else:
            st = p.stat()
            try:
                sha = hashlib.sha1(p.read_bytes()).hexdigest()
            except OSError:
                sha = "<読めない>"                # 権限の無いファイル（root でない利用者。CI）
            out[rel] = {"type": "file", "size": st.st_size, "mtimeNs": str(st.st_mtime_ns),
                        "sha1": sha, **({"mode": oct(st.st_mode & 0o777)} if os.name != "nt" else {})}
    return out


def place_masters(root: Path, sc):
    share = root / "share"
    for d in (root / "app" / "data", root / "local" / "master_cache", share):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    (share / "access_permissions.json").write_text(j(doc(sc.get("perm", PERM))), encoding="utf-8")


def store_of(root: Path):
    return MasterStore(root / "app", local_root=root / "local", settings={"refresh_seconds": 0, "dir": str(root / "share")})


def sub(x, root):
    """道の字の @ROOT → 場面のフォルダ"""
    return x.replace("@ROOT", str(root))


def sub_json(x, root):
    """本文（JSON の字）の @ROOT → 場面のフォルダ（JSON の字として逃がす: Windows の \\）"""
    return x.replace("@ROOT", json.dumps(str(root), ensure_ascii=False)[1:-1])


def wait_done(mv):
    end = time.time() + 60
    while time.time() < end and mv.progress().get("state") == "running":
        time.sleep(0.02)
    return mv.progress()


def main():
    logging.disable(logging.WARNING)
    if sys.argv[1] == "--tables":         # 事例の表だけ（道のつなぎ方・OSError の字）
        sys.stdout.write(json.dumps({"joins": joins(), "oserrors": oserrors()}, ensure_ascii=False))
        return
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    import app.routes as routes
    from app.routes.common import forget_tab_cache
    from app.routes.lotlist import _access_place
    from app.web import Request, _app_var, _request_var
    who = {"login": "", "pc": ""}
    patches = [mock.patch.object(identity, "current_login_id", lambda: who["login"]),
               mock.patch.object(identity, "resolve_pc_name", lambda override="", force=False: {"name": who["pc"], "source": "試験", "tried": []})]
    for p in patches:
        p.start()
    out = []
    try:
        for i, sc in enumerate(scenarios()):
            roots = {k: base / f"s{i}" / k for k in ("py", "rs", "pd")}
            for r in roots.values():
                r.mkdir(parents=True)
                place_masters(r, sc)
                sc["setup"](r)
                fix_times(r)
                if sc.get("lock"):           # 権限を落とすのは時刻をそろえた後（読めないフォルダの中の時刻もそろえる）
                    sc["lock"](r)
            # 記号リンクの歩は POSIX だけ（Windows の CI は記号リンクを作れないことがある。壊れた記号リンクは ntpath の _readlink_deep が
            # 先をたどるが、窓は在る所までしか解かないので違いうる: 残す差。release_place.rs の冒頭）
            steps_def = list(sc["steps"]) + (link_steps() if CAN_LINK and os.name != "nt" and sc["setup"] is setup_plan and i == 0 else [])
            confs = {}
            apps = {}
            for k, r in roots.items():
                apps[k] = create_app({"TESTING": True, "MASTER_STORE": store_of(r)})
                t1, t2 = _app_var.set(apps[k]), _request_var.set(Request("GET", "/api/lotlist/settings"))
                try:
                    confs[k] = _access_place()
                finally:
                    _request_var.reset(t2)
                    _app_var.reset(t1)
                pdir = r / "share" / presence.SUBDIR
                if sc.get("revoke"):        # 切断の指示（冷却のあいだ効く）
                    pdir.mkdir(parents=True, exist_ok=True)
                    key = presence.terminal_key(*sc["revoke"])
                    (pdir / f"{key}{presence.REVOKE_SUFFIX}").write_text(
                        j({"by": "boss", "byPc": "PC-1", "reason": "点検", "at": datetime.now().isoformat(timespec="seconds")}), encoding="utf-8")
            steps, dele = [], []
            for st in oracle_gate.seq(steps_def, sc.get("delegates", [])):
                k = "pd" if st.get("delegate") else "py"
                root, app = roots[k], apps[k]
                presence.configure(root / "share" / presence.SUBDIR)
                mv = app.config.get("RELEASE_MOVER")
                if mv is None:
                    mv = app.config["RELEASE_MOVER"] = release_place.Mover()
                if "sync" in st:
                    p = release_place.Mover().run_sync(sub(st["sync"]["src"], root), sub(st["sync"]["dest"], root))
                    steps.append({**st, "status": None, "json": p})
                    continue
                who.update(login=st["who"][0], pc=st["who"][1])
                routes._REVOKE_CACHE.update(at=0.0, key="")
                forget_tab_cache()
                if st.get("hold"):
                    mv._p = {"state": "running", "files": 0, "done": 0}
                path = st["path"] + (f"?{st['query']}" if st["query"] else "")
                body = sub_json(st["body"] or "", root)
                try:
                    r = app.test_client().open(path, method=st["method"], data=body.encode("utf-8"), content_type="application/json")
                    try:
                        js = r.get_json()
                    except Exception:
                        js = None
                    rec = {**st, "status": r.status_code, "json": js}
                except Exception as e:      # 道の外で落ちた（本番は 500 で答える）
                    rec = {**st, "status": 500, "json": {"error": f"{type(e).__name__}: {e}"}}
                if st.get("hold"):
                    mv._p = {"state": "idle"}
                if st.get("wait"):
                    rec["final"] = wait_done(mv)
                (dele if st.get("delegate") else steps).append(rec)
            out.append({"name": sc["name"], "roots": {k: str(v) for k, v in roots.items()}, "conf": confs["rs"],
                        "steps": steps, "delegates": dele, "files": listing(roots["py"]), "filesPd": listing(roots["pd"])})
    finally:
        for p in patches:
            p.stop()
    sys.stdout.write(json.dumps({"scenarios": out, "canLink": CAN_LINK, "root": ROOT, "joins": joins(), "oserrors": oserrors()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
