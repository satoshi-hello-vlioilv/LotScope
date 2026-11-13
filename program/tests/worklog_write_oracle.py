# -*- coding: utf-8 -*-
"""作業実績の登録の道の「正しい答え」を出す係（版 3.91.0。desktop/tests/worklog_write_parity.rs が呼ぶ）。

    python tests/worklog_write_oracle.py 作業フォルダ

場面ごとに同じ中身の置き場を 3 つ（py・rs・pd）作り、py に Python の道（routes/worklog.py の 6 本。門番 _access_guard を含む）で
問い合わせの並びを当てる。窓の試験は rs に同じ並びを本物の窓の道（Lot::handle_body → worklog_route）で当て、答え（状態・本文）と
できたファイルを突き合わせる。窓が答えず Python に任せる歩（delegates）は pd に当てる。
作業実績のフォルダ（実績のファイル）は 3 つの置き場で 1 つを共にする（道は読むだけ。同じファイルなのでファイルID も同じ）。
足す行のキーは Python（work_log.new_key）と窓（Lot::set_new_key）で同じ並び（k001, k002, …）に、古さを測る時刻は
Python（work_log.mark_stale の now）と窓（Lot::set_clock）で同じ NOW に差し替える。ファイルの更新時刻は os.utime で決める。
"""
import json
import logging
import os
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
os.environ.pop("TPA_SHELL", None)
os.environ.pop("TPA_SHELL_SERVES", None)

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import identity, work_log  # noqa: E402
import oracle_gate  # noqa: E402
from oracle_gate import W  # noqa: E402

LOGIN = identity.current_login_id()
NOW = 1_800_000_000.0
# 実績のファイル: 名前 → (大きさ, NOW から何時間前に更新したか〈小数の秒も〉)。決まりに合わない・作業用・空の設備名・フォルダも置く
FILES = {"実績_CR1.sqlite3": (100, 1.25), "実績_cr2.SQLITE3": (2048, 0.0), "実績_L-1.sqlite3": (7, 40.04), "実績_新.sqlite3": (1, 3.0),
         "実績_ANF.sqlite3": (55, 36.0), "実績_X.sqlite3-wal": (1, 0), "実績_.sqlite3": (1, 0), "メモ.txt": (1, 0),
         # ちょうど .25・.35 時間（Python の round は 0.2・0.3）・1970 年より前（負の秒とナノ秒）・ちょうど 1970 年（mtime 0 は古さを言わない）
         "実績_Q1.sqlite3": (3, "0.25"), "実績_Q2.sqlite3": (3, "0.35"), "実績_古.sqlite3": (3, "-0.3"), "実績_零.sqlite3": (3, "0")}


def j(x):
    return json.dumps(x, ensure_ascii=False)


def doc(rows, rev=3):
    return {"schema": 1, "revision": rev, "updated_at": "", "updated_by": {}, "rows": rows}


def perm(role="開発者", edit="編集可"):
    return [{"id": 1, "ログインID": LOGIN, "PC名": "", "権限区分": role, "マスタ編集": edit, "有効": "有", "rev": 1}]


def make_folder(folder):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "実績_D.sqlite3").mkdir(exist_ok=True)
    for name, (size, hours) in FILES.items():
        p = folder / name
        p.write_bytes(b"x" * size)
        # 字の時間は「ちょうど」（字が 0.25・0.35 は NOW からの時間、ほかは 1970 年からの秒）。数は NOW からの時間＋小さなナノ秒
        if isinstance(hours, str):
            t = int((NOW - float(hours) * 3600) * 1e9) if hours.startswith("0.") else int(float(hours) * 1e9)
        else:
            t = int((NOW - hours * 3600) * 1e9) + 123_456_789
        os.utime(p, ns=(t, t))
    return {n: work_log.file_id(os.stat(folder / n)) for n in FILES}


def rows_of(fid):
    """登録の行（同じ名前・大文字と小文字だけ違う名前・名前を変えた〈ファイルID でたどる〉・見つからない・キーの無い行・表示しない行）"""
    return [{"id": 1, "キー": "a1", "設備名": "CR1", "ファイル名": "実績_CR1.sqlite3", "ファイルID": fid["実績_CR1.sqlite3"], "表示": "有",
             "表": "", "備考": "", "並び": "2", "rev": 3},
            {"id": 2, "キー": "b2", "設備名": "CR2", "ファイル名": "実績_CR2.sqlite3", "ファイルID": "", "表示": "", "並び": "1"},
            {"id": 4, "キー": "c3", "設備名": "L-1", "ファイル名": "実績_L1旧.sqlite3", "ファイルID": fid["実績_L-1.sqlite3"], "表示": "有",
             "表": "実績", "備考": "名前が変わった", "並び": "3", "rev": 2},
            {"id": 5, "キー": "d4", "設備名": "消えた", "ファイル名": "実績_消えた.sqlite3", "ファイルID": "9:9", "表示": "無", "並び": "",
             "rev": 1},
            {"id": 7, "キー": "", "設備名": "ANF", "ファイル名": "実績_anf.sqlite3", "ファイルID": "", "並び": " ４ ", "rev": 1},
            {"id": 8, "設備名": "キー無し", "ファイル名": "実績_無い.sqlite3", "並び": "x"}]


def S(method, path, body=None, query=""):
    return {"method": method, "path": path, "query": query, "body": body if isinstance(body, str) or body is None else j(body)}


M, F = "/api/masters/worklog", "/api/worklog/files"
READS = [S("GET", M), S("GET", M, query="fresh=1"), S("GET", F), S("GET", F, query="all=1"), S("GET", F, query="fresh=1&all=1")]
SCENARIOS = [
    {"name": "見る・探す・結ぶ", "mode": "shared", "steps": READS + [
        S("POST", f"{M}/scan"),
        S("GET", M),
        S("POST", f"{M}/scan"),
        S("GET", F),
    ], "delegates": [
        S("PUT", f"{M}/order", "壊れた本文"),
        S("PUT", f"{M}/order", ""),
        S("PUT", f"{M}/order", "[1]"),
        S("PUT", f"{M}/order", {"keys": [["a1"]]}),
        S("PUT", f"{M}/order", '{"keys": ["a1", NaN]}'),
    ]},
    {"name": "並べ替え", "mode": "shared", "steps": [
        S("PUT", f"{M}/order", {"keys": ["c3", "a1"]}),
        S("PUT", f"{M}/order", {"keys": ["c3", "a1"]}),
        S("PUT", f"{M}/order", {"keys": ["a1", "a1", "無いキー", "b2", 5]}),
        S("PUT", f"{M}/order", {"keys": []}),
        S("PUT", f"{M}/order", {"keys": "a1"}),
        S("PUT", f"{M}/order", {}),
        S("PUT", f"{M}/order", "0"),
        S("GET", F),
    ]},
    {"name": "直す・結び直す・消す・行の版", "mode": "shared", "steps": [
        S("PUT", f"{M}/1", {"設備名": " CR1 改 ", "表示": " 無 ", "表": "作業実績", "備考": 12, "キー": "変えない", "知らない列": "x",
                            "base_rev": 3}),
        S("PUT", f"{M}/1", {"設備名": "古い版", "base_rev": 3}),
        S("PUT", f"{M}/1", {"設備名": "全角の版", "base_rev": "４"}),
        S("PUT", f"{M}/2", {"設備名": "  "}),
        S("PUT", f"{M}/2", {"表示": "なし"}),
        S("PUT", f"{M}/5", {"ファイル名": "実績_新.SQLITE3"}),
        S("PUT", f"{M}/5", {"ファイル名": "実績_無い.sqlite3"}),
        S("PUT", f"{M}/5", {"ファイル名": None}),
        S("PUT", f"{M}/99", {"設備名": "x"}),
        S("PUT", f"{M}/99", {"設備名": "x", "base_rev": 1}),
        S("PUT", f"{M}/０7", {"備考": "全角の id"}),
        S("PUT", f"{M}/8", "0"),
        S("DELETE", f"{M}/4", query="rev=1"),
        S("DELETE", f"{M}/4", query="rev=2"),
        S("DELETE", f"{M}/4"),
        S("DELETE", f"{M}/4", query="rev=2"),
        S("DELETE", f"{M}/2", query="rev=x"),
        S("GET", M),
    ], "delegates": [
        S("PUT", f"{M}/1", "[1]"),
        S("PUT", f"{M}/1", "壊れた本文"),
        S("PUT", f"{M}/1", ""),
        W(S("PUT", f"{M}/1", {"設備名": "x", "base_rev": "²"})),
        S("PUT", f"{M}/1", {"備考": [1, 2]}),
        S("PUT", f"{M}/1", {"ファイル名": ["実績_新.sqlite3"]}),
        S("PUT", f"{M}/99999999999999999999", {"設備名": "x"}),
        S("DELETE", f"{M}/1", "[1]"),
        W(S("DELETE", f"{M}/1", query="rev=²")),
    ]},
    {"name": "フォルダに届かない", "mode": "shared", "folder": "無いフォルダ", "steps": READS + [
        S("POST", f"{M}/scan"),
        S("PUT", f"{M}/5", {"ファイル名": "実績_新.sqlite3"}),
        S("PUT", f"{M}/5", {"設備名": "届かなくても直せる"}),
    ]},
    {"name": "ファイル名の決まりが壊れた・古さの警告が字", "mode": "shared", "pattern": "実績.sqlite3", "stale": "0", "steps": READS + [
        S("POST", f"{M}/scan"),
        S("PUT", f"{M}/5", {"ファイル名": "実績_新.sqlite3"}),
    ]},
    {"name": "同じファイル名の行が 2 つ（一覧は並びの順・探し直しは登録の順で結ぶ）", "mode": "shared", "dup": True, "steps": [
        S("GET", M), S("POST", f"{M}/scan"), S("GET", M)]},
    # 作った後の採点で見つけた割れ（版 3.91.0）: 39 桁を超える並び（窓は書く前・読む前に Python に任せる）
    {"name": "39 桁を超える並びが 2 行", "mode": "shared", "big": True, "steps": [S("DELETE", f"{M}/5", query="rev=1")], "delegates": [
        S("GET", M), S("GET", F), S("PUT", f"{M}/order", {"keys": ["c3", "a1"]}), S("POST", f"{M}/scan")]},
    # 配った設定の古さの時間が数でない（参照先は数に直すが、配った設定はそのまま束に入る）。版 3.106.0 から Python（work_log.params）も
    # 窓（bundle の work）も既定の 36 時間で続け、settingsWarn で知らせる（前は Python が float() の 400・500、窓は任せていた）
    {"name": "配った設定の古さが abc（フォルダに届く）", "mode": "shared", "cfg_stale": "abc", "steps": [
        S("PUT", f"{M}/1", {"備考": "直せる"}), S("DELETE", f"{M}/5")], "delegates": [
        W(S("GET", M)), W(S("GET", F)), W(S("POST", f"{M}/scan")), W(S("PUT", f"{M}/order", {"keys": ["c3", "a1"]}))]},
    {"name": "配った設定の古さが abc（フォルダに届かない）", "mode": "shared", "cfg_stale": "abc", "folder": "無いフォルダ", "steps": [
        S("PUT", f"{M}/1", {"備考": "直せる"})], "delegates": [W(S("POST", f"{M}/scan")), W(S("PUT", f"{M}/order", {"keys": ["c3", "a1"]}))]},
    {"name": "配った設定の古さが全角の数・表・空（版 3.106.0）", "mode": "shared", "cfg_stale": "１２", "steps": [S("GET", M), S("GET", F, query="all=1")]},
    {"name": "古さの警告の時間（字の 12.5）", "mode": "shared", "stale": "12.5", "steps": [S("GET", F, query="all=1")]},
    {"name": "書ける段と門番", "mode": "shared", "perm": perm("一般ユーザー", "部分的編集可"), "steps": [
        S("GET", M),
        S("GET", F),
        S("POST", f"{M}/scan"),
        S("PUT", f"{M}/order", {"keys": ["a1"]}),
        S("PUT", f"{M}/1", {"設備名": "x"}),
        S("DELETE", f"{M}/1"),
    ]},
    {"name": "手元だけ（共有しない PC）", "mode": "local", "steps": [
        S("GET", M),
        S("POST", f"{M}/scan"),
        S("PUT", f"{M}/order", {"keys": ["c3", "b2"]}),
        S("PUT", f"{M}/1", {"備考": "手元で直した", "base_rev": 3}),
        S("DELETE", f"{M}/5"),
    ]},
    {"name": "共有に届かない（写しから）", "mode": "unreachable", "steps": [
        S("GET", M),
        S("POST", f"{M}/scan"),
        S("PUT", f"{M}/1", {"備考": "x"}),
    ]},
    {"name": "ほかの PC が保存している途中（錠）", "mode": "shared", "lock": True, "steps": [
        S("POST", f"{M}/scan"),
        S("PUT", f"{M}/order", {"keys": ["a1"]}),
        S("PUT", f"{M}/1", {"備考": "x"}),
        S("DELETE", f"{M}/1"),
    ]},
    {"name": "登録がまだ無い", "mode": "empty", "steps": READS + [
        S("POST", f"{M}/scan"),
        S("PUT", f"{M}/order", {"keys": ["k002", "k001"]}),
        S("GET", F),
    ]},
]


def place(root, sc, folder, fid):
    share, data = root / "share", root / "base" / "data"
    for d in (share, data, root / "local"):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    ps = [{"id": 1, "項目": "work_log.folder", "値": str(folder.parent / sc["folder"]) if sc.get("folder") else str(folder), "rev": 1},
          {"id": 2, "項目": "work_log.pattern", "値": "実績_*.sqlite3", "rev": 1}]
    if sc.get("pattern"):       # 参照先は読めない決まりを受けないので、配った設定に置く
        ps.pop()
    if sc.get("stale"):
        ps.append({"id": 3, "項目": "work_log.stale_hours", "値": sc["stale"], "rev": 1})
    wl = [] if sc["mode"] == "empty" else rows_of(fid)
    if sc.get("big"):
        wl[0]["並び"], wl[1]["並び"] = "2" + "0" * 40, "1" + "0" * 40
    if sc.get("dup"):
        wl.append({"id": 9, "キー": "e9", "設備名": "CR1 の 2 つ目", "ファイル名": "実績_cr1.sqlite3", "並び": "0", "rev": 1})
    masters = {"access_permissions": sc.get("perm") or perm(), "work_log_files": wl,
               "path_settings": ps}
    for n in ("data_sources", "equipment_master", "equipment_groups", "conversions", "shift_patterns"):
        masters[n] = []
    for name, rows in masters.items():
        if sc["mode"] == "local":
            (data / f"{name}.json").write_text(j(rows), encoding="utf-8")
        elif sc["mode"] == "unreachable":       # 共有のフォルダが無い（届かない）: 写しだけがある
            cache = root / "local" / "master_cache"
            cache.mkdir(parents=True, exist_ok=True)
            (cache / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
        else:
            (share / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
    if sc.get("lock"):
        n = datetime.now()
        (share / "master.lock.json").write_text(j({"token": "t", "holder_pc": "PC-8", "holder_login": "u8", "holder_instance": "z:1",
                                                   "acquired_at": n.isoformat(timespec="seconds"),
                                                   "expires_at": (n + timedelta(seconds=600)).isoformat(timespec="seconds")}), encoding="utf-8")
    cfg = {"lot_list": {"source": "/配った/品質.sqlite3", "table": ""}, "desktop": {"lotlist_engine": "rust"},
           "identity": {"pc_name": "PC-ORACLE"}, "work_log": {**({"pattern": sc["pattern"]} if sc.get("pattern") else {}),
                                                                  **({"stale_hours": sc["cfg_stale"]} if sc.get("cfg_stale") else {})},
           "master_share": {} if sc["mode"] == "local" else {"dir": str(root / "届かない共有" if sc["mode"] == "unreachable" else share),
                                                               "refresh_seconds": 0}}
    (root / "config.json").write_text(j(cfg), encoding="utf-8")


def run(root, steps):
    os.environ["TRANSFER_APP_CONFIG"] = str(root / "config.json")
    os.environ["TRANSFER_LOCAL_ROOT"] = str(root / "local")
    cfg = json.loads((root / "config.json").read_text(encoding="utf-8"))
    store = MasterStore(root / "base", local_root=root / "local", settings=cfg.get("master_share"), who={"pc": "PC-ORACLE", "login": LOGIN})
    app = create_app({"TESTING": True, "MASTER_STORE": store})
    c = app.test_client()
    n = {"i": 0}

    def key():
        n["i"] += 1
        return f"k{n['i']:03d}"
    stale = work_log.mark_stale
    out = []
    import app.routes as routes
    from app.routes.common import forget_tab_cache
    with mock.patch.object(work_log, "new_key", key), \
            mock.patch.object(work_log, "mark_stale", lambda items, hours, now=None: stale(items, hours, NOW)):
        for st in steps:
            routes._REVOKE_CACHE.update(at=0.0, key="")
            forget_tab_cache()
            path = st["path"] + (f"?{st['query']}" if st["query"] else "")
            try:
                r = c.open(path, method=st["method"], data=(st["body"] or "").encode("utf-8"), content_type="application/json")
                try:
                    body = r.get_json()
                except Exception:
                    body = None
                out.append({**st, "status": r.status_code, "json": body})
            except Exception as e:      # 道の外で落ちた（試験の接続は投げ返す。本番は 500 で答え、書かない）
                out.append({**st, "status": 500, "json": {"error": f"{type(e).__name__}: {e}", "kind": "error"}})
    return out


def main():
    logging.disable(logging.WARNING)
    base = Path(sys.argv[1])
    if base.exists():
        shutil.rmtree(base)
    folder = base / "work" / "実績"
    fid = make_folder(folder)
    out = []
    for i, sc in enumerate(SCENARIOS):
        py, rs, pd = (base / f"s{i}" / x for x in ("py", "rs", "pd"))
        for r in (py, rs, pd):
            place(r, sc, folder, fid)
        mine, theirs = oracle_gate.split(sc["steps"], sc.get("delegates", []))
        steps = run(py, mine)
        dele = run(pd, theirs)
        out.append({"name": sc["name"], "py": str(py), "rs": str(rs), "steps": steps, "delegates": dele,
                    "env": {"base": str(rs / "base"), "program": str(PROGRAM), "local": str(rs / "local"), "config": str(rs / "config.json")}})
    sys.stdout.write(json.dumps({"now": NOW, "fids": {v: k for k, v in fid.items() if v}, "scenarios": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
