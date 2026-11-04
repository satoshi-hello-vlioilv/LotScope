"""マスタの書く係の答え合わせの見本（版 3.67.0。順 5 の 2 段目 a）。

    python program/tests/masters_oracle.py 作業フォルダ
    python program/tests/masters_oracle.py --hammer 作業フォルダ 回数 shared|local   … 係 py として同時に書く（窓と取り合う試験）

同じ手順（SCENARIOS）を Python の MasterStore（係 rs を名乗らせる）に当て、答え・断る言葉・できたファイルを JSON で出す。
窓（Rust）の書く係 `desktop/src/master_store.rs` は `desktop/tests/masters_parity.rs` で同じ手順を当て、この答えと突き合わせる。

手順の言葉（両方の書く係で同じに読む）:
    {"op": "write", "name": マスタ, "do": [当てる物…]}   … 当てる物: {"append": 行} / {"set": [id, 鍵, 値]} / {"delete": id} /
                                                          {"raise": "not_found"|"conflict"|"duplicate"} / {"touch": 置き場の中の道} / {"steal": true}
    {"op": "exclusive", "do": [手順…]}   {"op": "pull", "name": マスタ}   {"op": "lock", "holder": "other"|"sibling"|"mine"|"legacy"|"broken", "left": 秒, "local": 真偽}
    {"op": "unshare"} / {"op": "reshare"} / {"op": "sleep", "sec": 秒} / {"op": "file", "path": 置き場の中の道, "json": 中身}
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.repositories import master_store as ms  # noqa: E402

WHO = {"pc": "PC1", "login": "u1"}
INSTANCE = "inst1"
MASTERS = ["equipment_master", "roll_master"]
EQ = "equipment_master"
ROWS = [{"id": 1, "name": "CR1", "rev": 1}, {"id": 2, "name": "CR2", "rev": 1}]

SCENARIOS = [
    {"name": "共有: 足す・直す・消す", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 3, "rows": ROWS}},
     "steps": [{"op": "write", "name": EQ, "do": [{"append": {"name": "L-1"}}]},
               {"op": "write", "name": EQ, "do": [{"set": [2, "name", "CR2改"]}]},
               {"op": "write", "name": EQ, "do": [{"delete": 1}]}]},
    {"name": "共有: 共有にまだ無い（写し → seed）", "shared": True, "files": {"local/master_cache/equipment_master.json": {"schema": 1, "revision": 7, "rows": ROWS}},
     "steps": [{"op": "write", "name": EQ, "do": [{"append": {"name": "X"}}]}]},
    {"name": "共有: 共有にも写しにも無い（同梱の data/ → seed）", "shared": True, "files": {"data/equipment_master.json": ROWS},
     "steps": [{"op": "pull", "name": EQ}, {"op": "write", "name": EQ, "do": [{"append": {"name": "Y"}}]}]},
    {"name": "共有: どこにも無い（空で始める）", "shared": True, "files": {},
     "steps": [{"op": "write", "name": EQ, "do": [{"append": {"name": "Z"}}]}]},
    {"name": "手元だけ: data/ に行の配列で書く", "shared": False, "files": {"data/equipment_master.json": ROWS},
     "steps": [{"op": "write", "name": EQ, "do": [{"append": {"name": "L-2"}}]}, {"op": "write", "name": EQ, "do": [{"delete": 2}]}]},
    {"name": "共有しない名前は手元（共有の設定でも）", "shared": True, "files": {"data/card_forms.json": [{"id": 1, "name": "a"}]},
     "steps": [{"op": "write", "name": "card_forms", "do": [{"append": {"name": "b"}}]}]},
    {"name": "断る: 見つからない・行の衝突・同じ名前", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "write", "name": EQ, "do": [{"set": [9, "name", "x"]}]},
               {"op": "write", "name": EQ, "do": [{"raise": "conflict"}]},
               {"op": "write", "name": EQ, "do": [{"raise": "duplicate"}]},
               {"op": "write", "name": EQ, "do": [{"append": {"name": "後"}}]}]},
    {"name": "錠: ほかの PC の生きた錠", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "lock", "holder": "other", "left": 15}, {"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]}]},
    {"name": "錠: 同じ PC のもう 1 つの係（py）の錠", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "lock", "holder": "sibling", "left": 15}, {"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]}]},
    {"name": "錠: 自分の残した錠は引き継ぐ", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "lock", "holder": "mine", "left": 15}, {"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]}]},
    {"name": "錠: 係の無い錠（版 3.63.0 まで）は Python の物", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "lock", "holder": "legacy", "left": 15}, {"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]}]},
    {"name": "錠: 切れた錠は見てからの経過でどける", "shared": True, "ttl": 0.3, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "lock", "holder": "other", "left": -5}, {"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]},
               {"op": "sleep", "sec": 0.45}, {"op": "write", "name": EQ, "do": [{"append": {"name": "y"}}]}]},
    {"name": "錠: 時計の進んだ PC の錠（期限が錠の長さより先）", "shared": True, "ttl": 0.3, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "lock", "holder": "other", "left": 3600}, {"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]},
               {"op": "sleep", "sec": 0.45}, {"op": "write", "name": EQ, "do": [{"append": {"name": "y"}}]}]},
    {"name": "錠: 壊れた錠", "shared": True, "ttl": 0.3, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "lock", "holder": "broken"}, {"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]},
               {"op": "sleep", "sec": 0.45}, {"op": "write", "name": EQ, "do": [{"append": {"name": "y"}}]}]},
    {"name": "錠: 空の錠 {}・印の無い錠・印が null・印が数（切れた後にどける）", "shared": True, "ttl": 0.3,
     "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "lock", "holder": "empty"}, {"op": "write", "name": EQ, "do": [{"append": {"name": "a"}}]},
               {"op": "sleep", "sec": 0.45}, {"op": "write", "name": EQ, "do": [{"append": {"name": "b"}}]},
               {"op": "lock", "holder": "notoken", "left": -5}, {"op": "sleep", "sec": 0.45}, {"op": "write", "name": EQ, "do": [{"append": {"name": "c"}}]},
               {"op": "lock", "holder": "nulltoken", "left": -5}, {"op": "sleep", "sec": 0.45}, {"op": "write", "name": EQ, "do": [{"append": {"name": "d"}}]},
               {"op": "lock", "holder": "numtoken", "left": -5}, {"op": "write", "name": EQ, "do": [{"append": {"name": "e"}}]},
               {"op": "sleep", "sec": 0.45}, {"op": "write", "name": EQ, "do": [{"append": {"name": "f"}}]},
               {"op": "lock", "holder": "bigtoken", "left": -5}, {"op": "sleep", "sec": 0.45}, {"op": "write", "name": EQ, "do": [{"append": {"name": "g"}}]}]},
    {"name": "錠: 手元の data/ の錠（もう 1 つの係）", "shared": False, "files": {"data/equipment_master.json": ROWS},
     "steps": [{"op": "lock", "holder": "sibling", "left": 15, "local": True}, {"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]}]},
    {"name": "置き換える直前: 共有が変わった", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}, {"touch": "share/equipment_master.json"}]}]},
    {"name": "置き換える直前: 錠を取られた", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}, {"steal": True}]}]},
    {"name": "置き換える直前: 手元のファイルが変わった", "shared": False, "files": {"data/equipment_master.json": ROWS},
     "steps": [{"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}, {"touch": "data/equipment_master.json"}]}]},
    {"name": "共有に届かない", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "pull", "name": EQ}, {"op": "unshare"}, {"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]},
               {"op": "pull", "name": EQ}, {"op": "reshare"}, {"op": "write", "name": EQ, "do": [{"append": {"name": "y"}}]}]},
    {"name": "丸ごと扱う間（exclusive）の中の書き込み", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "exclusive", "do": [{"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]},
                                          {"op": "write", "name": "roll_master", "do": [{"append": {"name": "r"}}]}]}]},
    {"name": "丸ごと扱う間: 共有に届かなければ data/ の錠", "shared": True, "files": {"data/equipment_master.json": ROWS},
     "steps": [{"op": "unshare"}, {"op": "exclusive", "do": []}, {"op": "lock", "holder": "other", "left": 15, "local": True},
               {"op": "exclusive", "do": []}]},
    {"name": "丸ごと扱う間: ほかの PC の錠", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "lock", "holder": "other", "left": 15}, {"op": "exclusive", "do": []}]},
    {"name": "写しだけが変わっていても、書く前に共有から取り直す", "shared": True, "files": {"share/equipment_master.json": {"schema": 1, "revision": 1, "rows": ROWS}},
     "steps": [{"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]},
               {"op": "file", "path": "local/master_cache/equipment_master.json", "json": {"schema": 1, "revision": 50, "rows": []}},
               {"op": "write", "name": EQ, "do": [{"append": {"name": "y"}}]}]},
    {"name": "版の字・BOM・昔の形の写し", "shared": True,
     "files": {"share/equipment_master.json": {"schema": 1, "revision": "4", "rows": ROWS, "updated_by": None, "extra": 1},
               "bom:share/roll_master.json": ROWS},
     "steps": [{"op": "write", "name": EQ, "do": [{"append": {"name": "x"}}]}, {"op": "write", "name": "roll_master", "do": [{"set": [1, "name", "R"]}]}]},
]


def lock_body(holder, left, instance=INSTANCE):
    now = datetime.now()
    inst = {"other": "otherpc:py", "sibling": f"{instance}:py", "mine": f"{instance}:rs", "legacy": instance}[holder]
    pc = "PC9" if holder == "other" else WHO["pc"]
    return {"token": f"t-{holder}", "holder_pc": pc, "holder_login": "u9" if holder == "other" else WHO["login"], "holder_instance": inst,
            "acquired_at": now.isoformat(timespec="seconds"), "expires_at": (now + timedelta(seconds=left)).isoformat(timespec="seconds")}


def setup(work, sc):
    for d in ("data", "share", "local/master_cache", "defaults"):
        (work / d).mkdir(parents=True, exist_ok=True)
    (work / "local" / "instance_id").write_text(INSTANCE, encoding="utf-8")
    for rel, body in sc["files"].items():
        bom = rel.startswith("bom:")
        p = work / rel.removeprefix("bom:")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes((b"\xef\xbb\xbf" if bom else b"") + json.dumps(body, ensure_ascii=False).encode("utf-8"))


def config(work, sc):
    """両方の書く係に渡す置き場（Rust は同じ鍵を読む）"""
    shared = sorted(set(MASTERS) | ms.SHARED_ALWAYS)
    return {"data": str(work / "data"), "defaults": str(work / "defaults"), "share": str(work / "share") if sc["shared"] else "",
            "shared": shared, "cache": str(work / "local" / "master_cache"), "local": str(work / "local"),
            "pc": WHO["pc"], "login": WHO["login"], "role": "rs", "ttl": sc.get("ttl", 20.0)}


def store_of(work, sc):
    st = ms.MasterStore(work, local_root=work / "local",
                        settings={"dir": str(work / "share")} if sc["shared"] else {}, who=dict(WHO), role="rs")
    st.shared_names = set(MASTERS) | ms.SHARED_ALWAYS
    st.lock_ttl = float(sc.get("ttl", 20.0))
    st.cache_dir = work / "local" / "master_cache"
    ms.DEFAULTS_DIR = work / "defaults"
    return st


def mutate_of(work, st, actions):
    def mutate(rows, stamp):
        for a in actions:
            if "append" in a:
                rows.append({**a["append"], "id": ms.next_id(rows), **stamp})
            elif "set" in a:
                rid, key, val = a["set"]
                row = next((r for r in rows if r.get("id") == rid), None)
                if row is None:
                    raise ms.NotFound("その行がありません")
                row.update({key: val, **stamp})
            elif "delete" in a:
                rows[:] = [r for r in rows if r.get("id") != a["delete"]]
            elif "raise" in a:
                raise {"not_found": ms.NotFound("その行がありません"), "conflict": ms.RowConflict(rows[0]),
                       "duplicate": ms.DuplicateKey("同じ名前があります")}[a["raise"]]
            elif "touch" in a:
                p = work / a["touch"]
                time.sleep(0.02)
                p.write_text(json.dumps({"schema": 1, "revision": 99, "rows": []}), encoding="utf-8")
            elif "steal" in a:
                p = st._lock_file()
                tmp = p.with_name("steal.tmp")
                tmp.write_text(json.dumps(lock_body("other", 15)), encoding="utf-8")
                os.replace(tmp, p)
        return len(rows)
    return mutate


def run_steps(work, st, steps, out):
    for s in steps:
        op = s["op"]
        try:
            if op == "write":
                out.append({"ok": st.write(s["name"], mutate_of(work, st, s["do"]))})
            elif op == "pull":
                out.append({"ok": st._pull(s["name"], force=True)})
            elif op == "exclusive":
                inner = []
                with st.exclusive():
                    run_steps(work, st, s["do"], inner)
                out.append({"ok": inner})
            elif op == "lock":
                d = work / ("data" if s.get("local") else "share")
                p = d / ms.LOCK_FILENAME
                if s["holder"] == "broken":
                    p.write_text('{"token": "half', encoding="utf-8")
                elif s["holder"] == "empty":
                    p.write_text("{}", encoding="utf-8")
                elif s["holder"] == "bigtoken":
                    p.write_text(json.dumps(lock_body("other", s.get("left", 15))).replace('"t-other"', "123456789012345678901234"), encoding="utf-8")
                elif s["holder"] in ("notoken", "nulltoken", "numtoken"):
                    body = lock_body("other", s.get("left", 15))
                    if s["holder"] == "notoken":
                        del body["token"]
                    else:
                        body["token"] = None if s["holder"] == "nulltoken" else 5
                    p.write_text(json.dumps(body), encoding="utf-8")
                else:
                    p.write_text(json.dumps(lock_body(s["holder"], s.get("left", 15))), encoding="utf-8")
                out.append({"ok": None})
            elif op == "unshare":
                (work / "share").rename(work / "share_away")
                out.append({"ok": None})
            elif op == "reshare":
                (work / "share_away").rename(work / "share")
                out.append({"ok": None})
            elif op == "sleep":
                time.sleep(s["sec"])
                out.append({"ok": None})
            elif op == "file":
                p = work / s["path"]
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(s["json"], ensure_ascii=False), encoding="utf-8")
                out.append({"ok": None})
        except ms.MasterError as e:
            out.append({"err": e.payload(), "status": e.status})
        except Exception as e:   # noqa: BLE001 - 読めない・書けないは種類だけ比べる（言葉は OS と言語で違う）
            out.append({"err": {"kind": "error"}, "status": 500, "type": type(e).__name__})


def hammer(work, n, shared):
    """係 py として n 回足す（断られたら少し待って送り直す）。窓（係 rs）と同時に同じ置き場へ書いて、保存が消えないかを見る"""
    st = ms.MasterStore(work, local_root=work / "local", settings={"dir": str(work / "share")} if shared else {}, who=dict(WHO), role="py")
    ok = 0
    (work / "py_started").write_text("1", encoding="utf-8")   # 窓はこの印を見てから書き始める（本当に同時に書く）
    while ok < n:
        try:
            st.write(EQ, lambda rows, stamp: rows.append({"id": ms.next_id(rows), "by": "py", **stamp}))
            ok += 1
        except ms.MasterLocked:
            time.sleep(0.003)
    print(json.dumps({"ok": ok}))
    return 0


def main(argv):
    if argv[1:2] == ["--hammer"]:
        return hammer(Path(argv[2]), int(argv[3]), argv[4] == "shared")
    base = Path(argv[1])
    if base.exists():
        shutil.rmtree(base)
    out = []
    for i, sc in enumerate(SCENARIOS):
        work = base / f"s{i}"
        setup(work, sc)
        st = store_of(work, sc)
        res = []
        run_steps(work, st, sc["steps"], res)
        out.append({"scenario": sc, "work": str(work), "config": config(work, sc), "results": res})
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
