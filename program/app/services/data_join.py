# -*- coding: utf-8 -*-
"""データ元の結合（版 3.53.0。マスタ管理の「データ元」の「結合」）。

あるデータ元（品質データ・作業実績・仕掛・足した元）の表に、ほかのデータ元（製造条件のマスタ など）の列を、
自由に組んだ鍵（1 つ以上の「この列 = 相手の列」）で合わせる。どの元でも同じ仕組み（ロット番号に決め打ちしない）。

  結合の決まり（データ元の行の「結合」に JSON で置く。並びの順に、前の結合の答えへ重ねる）
    [{"with": 相手のキー, "how": "left" | "inner" | "right" | "full",
      "on": [[この列, 相手の列], ...],          … 鍵（全部が同じ値の行どうしを合わせる）
      "cols": [相手の列, ...]}]                 … 持ってくる列（空なら、鍵の相手の列〈この元の鍵と同じ値〉を除いた全部）

  方式（画面はベン図で見せる）
    inner  内部結合     … 両方にある行だけ
    left   左外部結合   … この元の行は全部残す（相手が無い行は相手の列が空）。既定
    right  右外部結合   … 相手の行は全部残す（この元に無い行は、この元の列が空。鍵の列には相手の値を入れる）
    full   完全外部結合 … 両方の行を全部残す

  鍵の比べ方（join_key）: 一覧の「同じ値」（並べ替えの鍵 SortKey）と同じ考え。空欄は当たらない、数と数に読める字は数
    （" 54"・"054"・54.0 は同じ）、字は NFKC・前後の空白を除く・大文字（「Ａ１」と「a1」は同じ）。

  答え方: 写し（手元のファイル）どうしを合わせた答えを、この PC の作業場所へ 1 つのファイルとして組む（db_cache/joins）。
  一覧・スライサー・集計表・ダッシュボードは、そのファイルを今までと同じ仕組みで読む（速さは今までと同じ）。
  元の写しのどれかが変わった（版・大きさ・時刻）・決まりが変わったときだけ組み直す。表は元の表と同じ名前
  （表示列・並び・条件などの覚えは離れない）。
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
from pathlib import Path

from .identity import normalize_part
from .sqlite_ro import file_uri, qi, ro_uri, sort_key

HOWS = ["left", "inner", "right", "full"]
HOW_LABELS = {"inner": "内部結合", "left": "左外部結合", "right": "右外部結合", "full": "完全外部結合"}
MAX_JOINS = 6           # 1 つの元に重ねる結合の数
MAX_KEYS = 8            # 1 つの結合の鍵の数
SAMPLE = 5              # 当たらなかった鍵の見本の数


class JoinError(ValueError):
    """結合の決まりが合わない（相手が無い・列が無い・鍵が無い）。理由は利用者に見せる言葉。"""


def join_key(v):
    """鍵の比べ方（SQL では JoinKey(列)）。空欄は None（どれにも当たらない）。"""
    k = sort_key(v)
    if k is None:
        return None
    if isinstance(k, float):
        return str(int(k)) if k.is_integer() else repr(k)
    if isinstance(k, int):
        return str(k)
    return normalize_part(k) or None


def _s(v):
    return ("" if v is None else str(v)).strip()


def parse(text):
    """行の「結合」（JSON の字か並び）→ 決まりの並び（形だけ整える。相手・列があるかは resolve で見る）。読めなければ []。"""
    if isinstance(text, list):
        items = text
    else:
        try:
            items = json.loads(text) if _s(text) else []
        except (TypeError, ValueError):
            return []
    out = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        on = []
        for p in it.get("on") or []:
            if isinstance(p, (list, tuple)) and len(p) == 2 and _s(p[0]) and _s(p[1]):
                on.append([_s(p[0]), _s(p[1])])
        out.append({"with": _s(it.get("with")), "how": it.get("how") if it.get("how") in HOWS else "left",
                    "on": on[:MAX_KEYS], "cols": [_s(c) for c in it.get("cols") or [] if _s(c)]})
    return out[:MAX_JOINS]


def clean(text, self_key, known):
    """画面から来た「結合」→ 置く字（JSON）。合わなければ JoinError。known: 合わせられる相手のキー → 表示名。"""
    items = parse(text)
    for i, j in enumerate(items, 1):
        if not j["with"]:
            raise JoinError(f"{i} つ目の結合の相手を選んでください。")
        if j["with"] == self_key:
            raise JoinError(f"{i} つ目の結合: 同じデータ元どうしは合わせられません。")
        if j["with"] not in known:
            raise JoinError(f"{i} つ目の結合の相手（{j['with']}）がありません。作業実績（設備ごとのファイル）は相手にできません。")
        if not j["on"]:
            raise JoinError(f"{i} つ目の結合（{known[j['with']]}）の鍵を 1 つ以上決めてください（この列 = 相手の列）。")
    return json.dumps(items, ensure_ascii=False) if items else ""


def describe(items, names):
    """人の読む 1 行（カードの要約）。例: 「製造条件マスタ を左外部結合（合金 = 合金・調質 = 質別）」"""
    return "・".join(f"{names.get(j['with'], j['with'])} を{HOW_LABELS[j['how']]}（{'・'.join(f'{a} = {b}' for a, b in j['on'])}）" for j in items)


# ---------------------------------------------------------------- 組む
def _connect_out(path):
    # URI で開く（uri=True）。ATTACH に渡す file:…?mode=ro は、主の接続を URI で開いたときだけ URI と読まれる。
    # Linux の SQLite は既定で URI を読む（SQLITE_USE_URI）が、Windows の Python に付く SQLite は読まず、
    # 「file:///C:/…?mode=ro」という名前のファイルを探して「unable to open database」になっていた（版 3.57.1）
    c = sqlite3.connect(file_uri(path, "rwc"), uri=True, timeout=30)
    c.execute("PRAGMA journal_mode=OFF")
    c.execute("PRAGMA synchronous=OFF")
    c.execute("PRAGMA temp_store=MEMORY")
    c.create_function("JoinKey", 1, join_key, deterministic=True)
    return c


def _columns(c, schema, table):
    return [r[1] for r in c.execute(f"PRAGMA {schema}.table_info({qi(table)})").fetchall()]


def _brought(j, right_cols):
    """持ってくる相手の列（並びは相手の表の並び）。指定が無ければ、鍵の相手の列（この元の鍵と同じ値）を除いた全部。"""
    if j["cols"]:
        want = set(j["cols"])
        return [c for c in right_cols if c in want]
    keys = {b for _, b in j["on"]}
    return [c for c in right_cols if c not in keys]


def _out_name(col, taken, side_name):
    """出す列の名前（同じ名前があれば「列（相手の名前）」・それもあれば番号）。"""
    if col not in taken:
        return col
    name = f"{col}（{side_name}）"
    n = 2
    while name in taken:
        name, n = f"{col}（{side_name}{n}）", n + 1
    return name


def _step(c, acc, acc_cols, j, rt, right_cols, side_name, stats):
    """acc（いまの答えの一時表）に相手 r の表 rt を 1 つ合わせ、新しい一時表の名前と列を返す。stats に数を足す。"""
    on = j["on"]
    missing = [a for a, _ in on if a not in acc_cols]
    if missing:
        raise JoinError(f"「{side_name}」との鍵の列「{'・'.join(missing)}」がこの元にありません。")
    missing = [b for _, b in on if b not in right_cols]
    if missing:
        raise JoinError(f"鍵の相手の列「{'・'.join(missing)}」が「{side_name}」にありません。")
    bring = _brought(j, right_cols)
    n = len(stats)
    ks = [f"_k{i}" for i in range(len(on))]
    rk, out = f"_tpa_r{n}", f"_tpa_acc{n + 1}"
    # 相手: 鍵を比べ方の値にした一時表と索引（この元の行ごとに索引で引く）
    c.execute(f"CREATE TEMP TABLE {rk} AS SELECT "
              + ", ".join(f"JoinKey({qi(b)}) AS {k}" for (_, b), k in zip(on, ks))
              + (", " + ", ".join(f"{qi(col)} AS {qi('r_' + col)}" for col in dict.fromkeys(bring + [b for _, b in on])) if bring or on else "")
              + f" FROM r{n}.{qi(rt)}")
    c.execute(f"CREATE INDEX temp.{rk}_ix ON {rk}({', '.join(ks)})")
    taken = set(acc_cols)
    names = []
    for col in bring:
        nm = _out_name(col, taken, side_name)
        taken.add(nm)
        names.append(nm)
    cond = " AND ".join(f"JoinKey(a.{qi(a)}) = r.{k}" for (a, _), k in zip(on, ks))
    key_of = {a: b for a, b in on}
    left_sel = ", ".join(f"a.{qi(col)} AS {qi(col)}" for col in acc_cols)
    right_sel = ", ".join(f"r.{qi('r_' + col)} AS {qi(nm)}" for col, nm in zip(bring, names))
    sel = left_sel + (", " + right_sel if right_sel else "")
    # 内部・右外部は当たった行だけ（右外部は下で相手だけの行を足す）、左外部・完全外部はこの元の行を全部残す
    kind = "JOIN" if j["how"] in ("inner", "right") else "LEFT JOIN"
    body = f"SELECT {sel} FROM {acc} AS a {kind} {rk} AS r ON {cond}"
    if j["how"] in ("right", "full"):
        # 相手だけの行: この元の列は空（鍵の列だけ相手の値）。この元の鍵の一時表で「無い」を索引で見る
        ak = f"_tpa_a{n}"
        c.execute(f"CREATE TEMP TABLE {ak} AS SELECT DISTINCT " + ", ".join(f"JoinKey({qi(a)}) AS {k}" for (a, _), k in zip(on, ks)) + f" FROM {acc}")
        c.execute(f"CREATE INDEX temp.{ak}_ix ON {ak}({', '.join(ks)})")
        only_left = ", ".join((f"r.{qi('r_' + key_of[col])}" if col in key_of else "NULL") + f" AS {qi(col)}" for col in acc_cols)
        only = (f"SELECT {only_left}{', ' + right_sel if right_sel else ''} FROM {rk} AS r WHERE "
                + " AND ".join(f"r.{k} IS NOT NULL" for k in ks)
                + f" AND NOT EXISTS (SELECT 1 FROM {ak} AS x WHERE " + " AND ".join(f"x.{k} = r.{k}" for k in ks) + ")")
        body = f"{body} UNION ALL {only}"
    c.execute(f"CREATE TEMP TABLE {out} AS {body}")
    # 数（画面の「当たった・当たらない」と、相手の鍵の重なり）
    total = c.execute(f"SELECT COUNT(*) FROM {acc}").fetchone()[0]
    hit = c.execute(f"SELECT COUNT(*) FROM {acc} AS a WHERE EXISTS (SELECT 1 FROM {rk} AS r WHERE {cond})").fetchone()[0]
    rtotal = c.execute(f"SELECT COUNT(*) FROM {rk}").fetchone()[0]
    rdup = c.execute(f"SELECT COUNT(*) FROM (SELECT 1 FROM {rk} WHERE {' AND '.join(f'{k} IS NOT NULL' for k in ks)} "
                     f"GROUP BY {', '.join(ks)} HAVING COUNT(*) > 1)").fetchone()[0]
    rhit = c.execute(f"SELECT COUNT(*) FROM {rk} AS r WHERE EXISTS (SELECT 1 FROM {acc} AS a WHERE {cond})").fetchone()[0] if rtotal <= 200000 else None
    miss = [list(r) for r in c.execute(f"SELECT DISTINCT {', '.join('a.' + qi(a) for a, _ in on)} FROM {acc} AS a "
                                       f"WHERE NOT EXISTS (SELECT 1 FROM {rk} AS r WHERE {cond}) LIMIT {SAMPLE}")]
    rows = c.execute(f"SELECT COUNT(*) FROM {out}").fetchone()[0]
    stats.append({"with": j["with"], "name": side_name, "how": j["how"], "rows": total, "hit": hit, "miss": total - hit,
                  "rightRows": rtotal, "rightHit": rhit, "rightOnly": None if rhit is None else rtotal - rhit, "rightDup": rdup,
                  "out": rows, "columns": names, "missSample": miss})
    return out, acc_cols + names


def build(dest, base_path, base_table, items, rights):
    """結合した答えを dest（.sqlite3）に組む。rights: 結合ごとの (相手のファイル, 相手の表, 相手の名前)。→ 数の並び（結合ごと）。
    組み終えてから置き換える（読んでいる途中の画面に半端なファイルを見せない）。"""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f"{dest.stem}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.unlink(missing_ok=True)
    stats = []
    c = _connect_out(tmp)
    try:
        c.execute("ATTACH DATABASE ? AS b", (ro_uri(base_path),))
        acc_cols = _columns(c, "b", base_table)
        if not acc_cols:
            raise JoinError(f"表「{base_table}」が見つかりません。")
        c.execute(f"CREATE TEMP TABLE _tpa_acc0 AS SELECT * FROM b.{qi(base_table)}")
        acc = "_tpa_acc0"
        for n, (j, (rpath, rtable, rname)) in enumerate(zip(items, rights)):
            c.execute(f"ATTACH DATABASE ? AS r{n}", (ro_uri(rpath),))
            rcols = _columns(c, f"r{n}", rtable)
            if not rcols:
                raise JoinError(f"「{rname}」の表「{rtable}」が見つかりません。")
            acc, acc_cols = _step(c, acc, acc_cols, j, rtable, rcols, rname, stats)
        c.execute(f"CREATE TABLE main.{qi(base_table)} AS SELECT * FROM {acc}")
        c.commit()
    except Exception:
        c.close()
        tmp.unlink(missing_ok=True)
        raise
    c.close()
    os.replace(tmp, dest)
    return stats


def _stamp(path):
    try:
        st = os.stat(path)
        return [str(path), st.st_size, st.st_mtime_ns]
    except OSError:
        return [str(path), None, None]


class Joiner:
    """結合した答えのファイルの係（この PC の作業場所の db_cache/joins）。同じ元・同じ決まりは 1 つのファイルを使い回す。
    元の写しのどれかが変わったとき・決まりが変わったときだけ組み直す（組むのは 1 つずつ。同じファイルを 2 人で組まない）。"""

    def __init__(self, root):
        self.root = Path(root)
        self._locks = {}
        self._guard = threading.Lock()
        self.last = {}          # キー → {"stats", "builtAt", "seconds", "items"}（画面の「当たった・当たらない」に使う）

    def _lock(self, name):
        with self._guard:
            return self._locks.setdefault(name, threading.Lock())

    def path_for(self, key, base_path, base_table, items, rights):
        """結合した答えのファイル（無い・古ければ組む）→ (ファイル, 数)。"""
        spec = json.dumps({"base": [str(base_path), base_table], "items": items, "rights": [[str(p), t] for p, t, _ in rights]},
                          ensure_ascii=False, sort_keys=True)
        name = f"{key}_{hashlib.sha1(spec.encode('utf-8')).hexdigest()[:12]}"
        dest = self.root / f"{name}.sqlite3"
        meta = self.root / f"{name}.json"
        want = [_stamp(base_path)] + [_stamp(p) for p, _, _ in rights]
        with self._lock(name):
            try:
                had = json.loads(meta.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                had = {}
            if dest.exists() and had.get("stamps") == want:
                self.last[key] = {"stats": had.get("stats") or [], "builtAt": had.get("builtAt"), "seconds": had.get("seconds"), "items": items}
                return dest, had.get("stats") or []
            t0 = time.time()
            stats = build(dest, base_path, base_table, items, rights)
            info = {"stamps": want, "stats": stats, "builtAt": time.time(), "seconds": round(time.time() - t0, 3)}
            meta.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
            self.last[key] = {**{k: info[k] for k in ("stats", "builtAt", "seconds")}, "items": items}
            self._sweep(key, keep=name)
            return dest, stats

    def _sweep(self, key, keep):
        """同じ元の前の決まりのファイルを消す（読んでいて消せない物は次の機会に）。"""
        for p in self.root.glob(f"{key}_*"):
            if not p.name.startswith(keep):
                try:
                    p.unlink()
                except OSError:
                    pass
