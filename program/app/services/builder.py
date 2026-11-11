# -*- coding: utf-8 -*-
"""組む所の読み 7 本（版 3.99.0）の決まりと、確かめるの部品。

道: GET・POST /api/dashboard/fields（パネルを組む所の左のカラムの札）・GET /api/data/columns（変換表の当てる列）・
GET /api/sources/<key>/columns（結合の欄の列）・POST /api/sources/check（データ元の場所の「確かめる」）・
POST /api/sources/join/preview（結合の「試す」）・POST /api/sources/<key>/conn/check（接続の設定の 1 項目の「確かめる」）。
デスクトップ版は窓（desktop/src/builder.rs）が同じ答えを返す（desktop/tests/builder_parity.rs が突き合わせる）。

決め（主のセッションが決めた。利用者の要望「計算ロジック・表示の間違いをしっかり直す」に沿って直す側に。変えるときはここと
窓の desktop/src/builder.rs の同じ名前の定数を一緒に変える。builder_parity が両方の値を突き合わせる）:
  1 KINDS_UNION … すべての設備の札の種類は、設備ごとの最大ではなく、値を合わせた本当の数（和集合）
  2 EQUIP_LIMIT … 合わせる設備の上限（None は全部。前は 12 台で、13 台目からの列は札にも当てる列にも出なかった）
  3 種類はスライサー・集計と同じ見分け（SortKey: 空欄を 1 つ・0 と '0' を同じ）で数える（pivot.field_sets・merge_fields の 1 か所）
  4 JOIN_ALL_EQUIPS … 作業実績の結合の「試す」と列は、表示する全部の設備で数える（設備ごとの内訳 byEquip と、読めなかった設備 failed を答えに書く）
  5 STALE_ROLES … 「最後の更新が古いファイルです」の警告を出す役割（マスタなど更新の少ない役割には出さない）
  6 CM3_REACH … スケジュール（CM3）の URL の確かめは、CM3 に届くかまで見る（LotDsp と同じ reachable: プロキシを通さない 1 回の GET）
  7 札を待つ間は、ダッシュボードの待ちの段（GET /api/dashboard/progress。版 3.97.0）に写した・読んだ設備 n/m で載せる（?ask=）
  SQLite の英語の誤りの字（「file is not a database」など）は答えを変えない（日本語に読み替えるかは分からない。計画書に書いた）

数え方の決まり（tools/builder-truth.py が app を使わずに同じ答えを出す）:
- 空欄 … NULL か、字にして前後の空白を除くと空。同じ値 … SortKey（数と数の字は数として 1 つ・ほかは前後の空白を除いた字）
- 種類 … 合わせた全部のファイルの値の集合の大きさ。空欄があり値もあれば「（空欄）」を 1 つ足す。1,001 で止める（1,000 を超えたら many）。
  空欄だけの列は 0 種類と blankOnly
- 数 … 値のあったファイルの全部で、空欄でない値の先頭 300 個がみな数（値の無いファイルは数えない）。日付 … どれかのファイルで日付
- 列の並び … 元の列をファイルの順に初めて出た順 → 計算列。計算列の式が読めない設備は brokenIn に名前（全部で読めなければ error）
- 値の見本 … 空欄を除き表の行の順に、見せる字（生の値の str。空白も残す）が同じ物を 1 つにして 3 つまで（pivot.samples_of の 1 か所）
- 確かめる … 一覧が読むのと同じ表（欄の表 → 役割の候補 → 候補を含む名前 → 最初の表）を数える。場所は入口で 1 回 " を外す。
  更新時刻が PC の時計より先なら 0 時間前
"""
import os
import sqlite3
import time
from pathlib import Path

from ..fsio import unquote_path

KINDS_UNION = True
EQUIP_LIMIT = None
JOIN_ALL_EQUIPS = True
STALE_ROLES = ("品質", "仕掛", "実績")
CM3_REACH = True
STALE_HOURS = 36            # 古さの警告を出すまでの時間（確かめるの言葉）
LOT_MISSING = "ロット番号の列が見つかりません（ロット番号・ﾛｯﾄ番号・ロット№・LTNO）。"
STALE_TEXT = "最後の更新が古いファイルです。名前の違う別のファイルではないか確かめてください。"


def decisions():
    """決めの値（builder_parity が窓の値と突き合わせる）"""
    return {"kindsUnion": KINDS_UNION, "equipLimit": EQUIP_LIMIT, "joinAllEquips": JOIN_ALL_EQUIPS, "staleRoles": list(STALE_ROLES),
            "cm3Reach": CM3_REACH, "staleHours": STALE_HOURS}


def use_parts(parts):
    """合わせる部品（決め 2: 上限が無ければ全部）"""
    return list(parts) if EQUIP_LIMIT is None else list(parts)[:EQUIP_LIMIT]


def candidates_of(role):
    """確かめるが表を探す候補（一覧と同じ: 品質は品質データの候補・ほかはデータ元の候補）"""
    from . import data_sources, lot_list
    return lot_list.TABLE_CANDIDATES if role == "品質" else data_sources.TABLE_CANDIDATES


def check_sqlite(value, table="", role="品質", equip_column=""):
    """「確かめる」（.sqlite3 の場所）: 届くか・SQLite として開けるか・一覧に使う表（欄の表 → 役割の候補 → 最初の表）と行数・
    ロット番号の列（品質だけ要る）・最後の更新（PC の時計より先なら 0 時間前）・大きさ。設備の列を書いたら、その列があるか・値の例（空欄を除いて 3 つ）。
    -> {ok, message, detail{tables, table, rows, lotColumn, mtime}}"""
    from . import lot_list, pivot
    from .sqlite_ro import connect_ro, qi
    p = unquote_path(str(value or "").strip())
    if not p:
        return {"ok": False, "message": "ファイルの場所を入れてください。"}
    t0 = time.perf_counter()
    try:
        st = os.stat(p)
    except OSError as e:
        return {"ok": False, "message": f"ファイルに届きません（{getattr(e, 'strerror', None) or e}）。場所・名前・共有フォルダへの接続を確かめてください。"}
    col = str(equip_column or "").strip()
    ex = None
    try:
        with connect_ro(Path(p), timeout=5) as c:
            names = lot_list.tables(c)
            t = lot_list.pick_table(names, str(table or ""), candidates_of(role))
            n = c.execute(f"SELECT COUNT(*) FROM {qi(t)}").fetchone()[0] if t else 0
            cs = lot_list.columns(c, t) if t else []
            if col and col in cs:
                ex = pivot.samples_of(c, t, qi(col))
    except (sqlite3.Error, RuntimeError, FileNotFoundError) as e:
        return {"ok": False, "message": f"SQLite のファイルとして開けません（{e}）。"}
    age_h = max(0.0, (time.time() - st.st_mtime) / 3600)
    lot = lot_list.lot_column(cs)
    msg = (f"開けました。表 {len(names)} 個（一覧に使う表: {t or 'なし'}・{n:,}行）・"
           f"最後の更新 {time.strftime('%Y/%m/%d %H:%M', time.localtime(st.st_mtime))}（{age_h:.0f}時間前）・"
           f"{st.st_size / 1024 / 1024:.1f} MB・{(time.perf_counter() - t0) * 1000:.0f} ms")
    warn = []
    need_lot = role == "品質"
    if need_lot and not lot:
        warn.append(LOT_MISSING)
    if role in STALE_ROLES and age_h > STALE_HOURS:
        warn.append(STALE_TEXT)
    ok = bool(t) and (bool(lot) or not need_lot)
    out = {"ok": ok, "message": msg + ("" if not warn else " " + " ".join(warn)),
           "detail": {"tables": names, "table": t, "rows": n, "lotColumn": lot, "mtime": st.st_mtime}}
    if ok and col:
        if col not in cs:
            out.update(ok=False, message=out["message"] + f" 設備の列「{col}」が表「{t}」にありません。")
        else:
            out["message"] += f" 設備の列「{col}」の値の例: {'・'.join(ex) or '（空）'}。"
    return out


def try_each(joiner, lefts, items, rights, source_name):
    """作業実績の「試す」（決め 4）: 設備ごとに結合を組んで数え、足す（版 3.99.0）。組めない設備（その設備にだけ鍵の列が無い など）は
    failed（設備名と理由・kind join）に入れて飛ばし、ほかの設備で数える。前は 1 台が組めないと全体が 400 になった（作った後の採点）。
    lefts: [(設備名, キー, 読むファイル, 表)]・items: 結合の決まり・rights: 相手の [(ファイル, 表, 名前)]。
    → (答え〈数えた設備が 1 台も無ければ None〉, 組めなかった設備 [{name, error, kind}], 最初の失敗の状態〈400 か 503〉)。窓は builder.rs の try_each"""
    from . import data_join
    per, failed, table, status = [], [], "", None
    for name, key, path, tbl in lefts:
        try:
            _, stats = joiner.path_for(f"try-work-{key}", path, tbl, items, rights)
        except Exception as e:      # 決まりがこの設備の表に合わない（列が無い など）: 理由を言い、ほかの設備で数える
            failed.append({"name": name, "error": f"「{source_name}」の結合を組めませんでした: {e}", "kind": "join"})
            status = status or (400 if isinstance(e, data_join.JoinError) else 503)
            continue
        table = table or tbl
        per.append({"name": name, "key": key, "stats": stats})
    if not per:
        return None, failed, status
    return {"stats": sum_stats([x["stats"] for x in per]), "table": table, "equip": None, "byEquip": per, "counted": len(per)}, failed, status


def sum_stats(per):
    """設備ごとの結合の数 [[段ごとの数]] → 足した数（版 3.99.0。決め 4）。行・当たった・当たらない・答えの行・相手の行・相手の当たった・
    相手だけは足す（一覧は設備ごとに結合するので、全部の設備の一覧に出る数と同じ）。相手の鍵の重なりは相手の表の数（同じ）。当たらない鍵の見本は
    設備の順に重ならない物を data_join.SAMPLE まで。相手の数を数えなかった（大きい）設備があれば相手の当たった・相手だけは None"""
    from . import data_join
    out = []
    for i, first in enumerate(per[0]):
        steps = [p[i] for p in per]
        x = dict(first)
        for k in ("rows", "hit", "miss", "out", "rightRows"):
            x[k] = sum(int(st.get(k) or 0) for st in steps)
        for k in ("rightHit", "rightOnly"):
            x[k] = None if any(st.get(k) is None for st in steps) else sum(int(st[k]) for st in steps)
        x["rightDup"] = max(int(st.get("rightDup") or 0) for st in steps)
        miss = []
        for st in steps:
            for m in st.get("missSample") or []:
                if m not in miss and len(miss) < data_join.SAMPLE:
                    miss.append(m)
        x["missSample"] = miss
        out.append(x)
    return out


def cm3_reach(url):
    """CM3 に届くか（決め 6）→ {ok, message}"""
    from .lotdsp_direct import reachable
    ok = reachable(url, 4)
    return {"ok": ok, "message": "CM3 に届きました（設備ごとの予定は「スケジュール」のタブで確かめてください）。" if ok
            else "CM3 に届きません（社外・VPN 未接続・場所の間違い）。"}
