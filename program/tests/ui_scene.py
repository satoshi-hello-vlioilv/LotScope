# -*- coding: utf-8 -*-
"""開発用サーバー（前の Python の開発用サーバー）と稼働の評価関数（tools/ops-bench.py）の場面の台本（版 3.117.2。標準の部品だけ。app を import しない）。

    python tests/ui_scene.py 作業フォルダ 本        … 本は routes・pivot・dashboard・ops（場面を作り直す）

場面は作業フォルダの下に作る（前は 前の Python の開発用サーバーの build・ops-bench.build が /tmp/tpa-ui-*・/tmp/tpa-ops-* に作った）。更新時刻は台本を流した時刻で、
更新が止まった 1 台（HOT）だけ 40 時間前（前は 80 時間前）。作るのは SQLite の元のファイルとフォルダ・置き物のファイルまでで、マスタの登録（作業実績の
設備・勤務体系・データ元など）は答え合わせ役と開発用サーバーが app で書く（焼いた表は登録の後のマスタのファイルを場面の宣言に持つ）。

答え合わせ役（前の版の答え合わせ役 routes・前の版の答え合わせ役 pivot・前の版の答え合わせ役 dashboard・前の版の答え合わせ役 ops）は、登録をはさんで make → finish → 本ごとの手直し の
順に同じ関数を呼ぶ。Python 無しの形（TPA_NO_PYTHON=1）の窓の試験は、登録の後の形（同じ関数を続けて呼んだ物）をこの台本で作り、
焼いた表は SQLite の指紋だけを持つ（desktop/tests/common/bake.rs の script・sceneMade）。どちらも同じ関数なので、作り方は 1 か所。

ファイルの番号の使い回し（版 3.117.2 の採点 first_fixes 6）: 登録の後に「見つからない」にする SL3 のファイルは消さずに、場面の外
（作業フォルダの keep/）へ名前を替えて握ったままにする。前は消した SL3 のファイル番号（inode）を、後で作る BAD がファイル系によって使い回し、
「探す」が BAD を名前の変わった SL3 とたどって、問い合わせの答え（SL3 は 404・BAD は 503）が ext4 と tmpfs で入れ替わった。
"""
import hashlib
import json
import math
import os
import random
import sqlite3
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))

from tests import lotlist_fixture, scene_files, schedule_fixture  # noqa: E402  （標準の部品だけ）

WORK_EQUIPMENT = ("CR1", "CR2", "L-1", "L-2", "TLV", "LS3", "DL2", "CAL", "ANF", "HOT", "SL1")
FOLDER = "【New】実績"
QUALITY_TABLE = "仕掛"            # lotlist_fixture.make の表（品質の候補で選ばれる表。答え合わせ役が lot_list.pick_table と同じかを見る）
# 更新が止まった 1 台（HOT）の更新時刻: 台本を流した時の 40 時間前（古さのしきい 36 時間を越え、焼いた表の「今に近い」2 日の内）。
# 前は 80 時間前で、2 日の外なので答えの時刻（at。ダッシュボードの 135 葉）が今からのずれでそろえられず、流すたびに替わった。
# 決めた日付（暦の日）にしない: 答えの古さの時間（ageHours）は窓も Python も本当の今から数えるので、決めた日付では流す日ごとに替わる
# （測った: 2026-09-30 02:00 にすると、51 日後に流した ageHours が 1239.5。80 時間前の形は 80.0）
HOT_STALE_HOURS = 40


def key_makers():
    """作業実績の設備のキー（work_log.new_key）とデータ元のキー（data_sources.new_key）の代わり（呼んだ順の番号から決める。版 3.117.2 の
    採点 first_fixes 7 (a)）。呼ぶ順は登録の名前の順で、ファイル系によらない。形は元と同じ（12 字の 16 進・s＋8 字の 16 進）。
    uuid4 全部は差し替えない（一時ファイルの名前や錠の印まで決めてしまう）。道具（前の Python の開発用サーバーの fixed_keys・ops-bench）が app の 2 つに当てる"""
    n = {"w": 0, "s": 0}

    def work_key():
        n["w"] += 1
        return hashlib.sha256(f"work-{n['w']}".encode()).hexdigest()[:12]

    def source_key():
        n["s"] += 1
        return "s" + hashlib.sha256(f"source-{n['s']}".encode()).hexdigest()[:8]
    return work_key, source_key


# ------------------------------------------------------------------ 開発用サーバーの場面（routes・pivot・dashboard）

def make(work, quality=1500, work_rows=400, wip=1200):
    """開発用サーバーの試験データ（作業実績の登録の前の形）→ {名前: 場所}。quality・work_rows・wip は品質データの行・設備 1 台の作業実績の行・
    仕掛のロットの数（既定は撮影の形）"""
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    share = work / "share.sqlite3"
    lotlist_fixture.make(str(share), quality)
    # 作業実績: 設備ごとの実績ファイル（実績_<設備>.sqlite3）を 12 台ぶん。1 台（SL3）は登録のあとにファイルが無くなる形（finish）
    folder = work / FOLDER
    folder.mkdir()
    for eq in WORK_EQUIPMENT + ("SL3",):
        lotlist_fixture.make_work(str(folder / f"実績_{eq}.sqlite3"), eq, n=work_rows)
    # 焼鈍炉（ANF。版 3.47.0）: 1 回の作業が 20〜50 時間・作業終了の時刻は年月日時分秒の列（14 桁）だけ・書き忘れ 2 回・いま炉の中
    lotlist_fixture.make_work_box(str(folder / "実績_ANF.sqlite3"), "ANF")
    # 手元のみのマスタは base/data に書く。同梱のマスタを作業フォルダへ写して渡す（取り出しの更新時刻と権限は写さない）
    import shutil
    scene_files.copy_tree(PROGRAM / "data", work / "base" / "data", ignore=shutil.ignore_patterns("*.sqlite3", "cache", "local"))
    # フォルダ・ファイルの欄の補助（参照… の窓・よく使う場所）を撮るための共有の形: 品質データの元ファイル・前のマスタの置き場・配布の置き場
    shared = work / "共有"
    for sub in ("検査データ", "旧_2025", "台帳"):
        (shared / sub).mkdir(parents=True)
    shutil.copyfile(share, shared / "台帳" / "SIKADEF.sqlite3")
    wip_path = shared / "台帳" / "LOTNOW.sqlite3"
    lotlist_fixture.make_wip(str(wip_path), n=wip)       # 仕掛（データ元 wip の既定と同じ名前）
    # スケジュール（版 3.57.0）: 仕掛に釜番の列を足す（ほかの列・値は変えない）
    schedule_fixture.add_kama(wip_path)
    (shared / "Masters_旧").mkdir()
    (shared / "Masters_旧" / "path_settings.json").write_text('{"rows": []}', encoding="utf-8")
    (shared / "配布" / "LotScope" / "3.27.0").mkdir(parents=True)
    (shared / "配布" / "LotScope" / "3.27.0" / "release.json").write_text("{}", encoding="utf-8")
    # マスタのデータ元（版 3.53.0）: 製造条件マスタ（材質＋質別）と設備マスタ（設備名）
    masters = lotlist_fixture.make_masters(shared / "マスタ")
    # 配る版の覚えの写し（窓が作業場所へ写す want.json）: 全員のマスタの置き場（ui-harness.mjs の RELEASE と同じ。この PC は手元のみ＝ずれた形）
    (work / "masters").mkdir(parents=True, exist_ok=True)
    (work / "masters" / "want.json").write_text(json.dumps({"schema": 1, "version": "3.12.0", "masters": {
        "dir": "\\\\nlmsrvngy03\\工場内共有\\検査データ\\Masters", "setAt": "2026-10-15T14:30:00", "setBy": "user", "setPc": "PC-01"}},
        ensure_ascii=False), encoding="utf-8")
    return {"share": share, "folder": folder, "shared": shared, "quality": shared / "台帳" / "SIKADEF.sqlite3", "wip": wip_path,
            "update": shared / "配布" / "LotScope", "masters": masters}


def finish(work):
    """作業実績の登録の後: SL3 のファイルを場面の外（keep/）へ握ったまま移す（ファイルの番号を空けない）・HOT の更新時刻を 40 時間前に"""
    work = Path(work)
    folder = work / FOLDER
    (work / "keep").mkdir(exist_ok=True)
    os.replace(folder / "実績_SL3.sqlite3", work / "keep" / "実績_SL3.sqlite3")
    stale(folder / "実績_HOT.sqlite3")


def stale(path):
    """更新が止まった形にする（更新時刻を今の HOT_STALE_HOURS 時間前に）"""
    old = time.time() - HOT_STALE_HOURS * 3600
    os.utime(path, (old, old))


def _blanks(db, n, values):
    ids = [r[0] for r in db.execute(f'SELECT rowid FROM "{QUALITY_TABLE}" ORDER BY rowid LIMIT {n}')]
    for i, v in zip(ids, values * (n // len(values) + 1)):
        db.execute(f'UPDATE "{QUALITY_TABLE}" SET 備考 = ? WHERE rowid = ?', (v, i))
    return ids


def routes(work):
    """一覧の道（前の版の答え合わせ役 routes）の手直し: 空白で埋まる値・カラムの札の見本・名前の変わったファイル（HOT）・設備ごとの表（TLV）・
    中身が SQLite でない設備（BAD。SL3 を keep/ へ移した後に作る）"""
    work = Path(work)
    folder = work / FOLDER
    # 空白で埋まる値（版 3.51.1 の空欄の決まり: 前後の半角・全角の空白・タブを除いて空なら空欄。一覧・スライサー・集計で同じ）
    qdb = sqlite3.connect(work / "共有" / "台帳" / "SIKADEF.sqlite3")
    _blanks(qdb, 32, ["  ", "　", "\t", " ﾃｽﾄ ", "ﾃｽﾄ", "", None, " 　 "])
    # カラムの札の見本の数（先頭 300 個の空でない値がみな数なら数の列）: 100 行目の長さを字にする（30 個しか見ないと数の列に見える）
    qdb.execute(f'UPDATE "{QUALITY_TABLE}" SET 長さ = ? WHERE rowid = (SELECT rowid FROM "{QUALITY_TABLE}" ORDER BY rowid LIMIT 1 OFFSET 100)', ("約 3m",))
    qdb.commit()
    qdb.close()
    # 名前の変わったファイル（HOT: 登録のあとに名前を変えた。同じファイルID でたどる）。品質の候補の「仕掛」の表も置く
    hdb = sqlite3.connect(folder / "実績_HOT.sqlite3")
    hdb.execute("CREATE TABLE 仕掛 AS SELECT ロット番号, 合金 FROM 実績 LIMIT 3")
    hdb.commit()
    hdb.close()
    # 書いた後も更新が止まった形のまま（版 3.117.2 の作った後の採点の割れ 1: 一覧の写しの様子の stale を名前つきの歩で比べる）
    stale(folder / "実績_HOT.sqlite3")
    (folder / "実績_HOT.sqlite3").rename(folder / "実績_HOT_2026.sqlite3")
    # 設備ごとの表（TLV は「別表」を読む）
    db = sqlite3.connect(folder / "実績_TLV.sqlite3")
    db.execute("CREATE TABLE 別表 AS SELECT ロット番号, 作業者, 重量, 合金, 調質 FROM 実績 WHERE 作業者 = '作業者A'")
    db.commit()
    db.close()
    # 写しを作れない設備（中身が SQLite でない）
    (folder / "実績_BAD.sqlite3").write_text("SQLite ではない中身", encoding="utf-8")


def quantiles(values):
    """(q1, q3)（app の pivot.describe と同じ線形の補間。答え合わせ役が describe と同じかを確かめる）"""
    xs = sorted(values)
    n = len(xs)

    def q(p):
        i = (n - 1) * p
        lo = math.floor(i)
        return xs[lo] + (xs[min(lo + 1, n - 1)] - xs[lo]) * (i - lo)
    return q(0.25), q(0.75)


def number(v):
    """数に読める値 → float（app の work_summary.num と同じ読み方。読めなければ None）"""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(v) else None
    s = str(v).replace(",", "").strip()
    if not s:
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def pivot(work):
    """集計（前の版の答え合わせ役 pivot）の手直し: 品質の空白・設備の書きゆれ・外れ値・区間の境・ひげの端の近く。集計の境の表・日付と時刻が別の列の作業実績"""
    work = Path(work)
    t = QUALITY_TABLE
    db = sqlite3.connect(work / "共有" / "台帳" / "SIKADEF.sqlite3")
    ids = _blanks(db, 40, ["  ", "　", "\t", " ﾃｽﾄ ", "ﾃｽﾄ", "", None, "  　 ", "\n", "\r\n"])
    for i, v in zip(ids, ["CR2 1号", "cr1", "L-1 南", "ＣＲ２", "謎の設備 A", " ", None, "TLV", "L-10 1号", "l-10", " L-9 ", "L-9", "　", "謎の設備　B", "CL-1"] * 3):
        db.execute(f'UPDATE "{t}" SET 設備 = ? WHERE rowid = ?', (v, i))
    # 外れ値（箱ひげのひげの端・外れ値の見せる数 30 の上限）: 40 行の重量を飛び離れた大きな値に
    far = [r[0] for r in db.execute(f'SELECT rowid FROM "{t}" ORDER BY rowid DESC LIMIT 40')]
    for k, i in enumerate(far):
        db.execute(f'UPDATE "{t}" SET 重量 = ? WHERE rowid = ?', (90000 + k * 1700.5, i))
    # 下の側の外れ値（ひげの下の端が最小値でないこと）
    for k, i in enumerate([r[0] for r in db.execute(f'SELECT rowid FROM "{t}" ORDER BY rowid LIMIT 8 OFFSET 200')]):
        db.execute(f'UPDATE "{t}" SET 重量 = ? WHERE rowid = ?', (-50000 - k * 333.25, i))
    # 値の少ない区間の自動の幅（段数の下限 5 が効く広がり 130）・区間の境ちょうどの小数（0.3 ÷ 0.1）・10 桁で丸める数の鍵
    for i, (w, g, th) in zip(ids[:6], [(1000, 0.3, "1.2345678"), (1030, 0.6, "1.2345678"), (1050, 0.7, "2.0000000001"), (1080, 0.3, " 3 "),
                                       (1100, 0.9, "1e-7"), (1130, 0.6, "1.2345678")]):
        db.execute(f'UPDATE "{t}" SET 板幅 = ?, 比重 = ?, 板厚 = ? WHERE rowid = ?', (w, g, th, i))
    # ひげの端の近く（四分位の範囲の 1.5〜1.6 倍の間）の値: 段なしの箱ひげで、1.5 倍の外・1.6 倍の内に入る
    for _ in range(3):
        q1, q3 = quantiles([f for f in (number(r[0]) for r in db.execute(f'SELECT 重量 FROM "{t}"')) if f is not None])
        db.execute(f'UPDATE "{t}" SET 重量 = ? WHERE rowid IN (SELECT rowid FROM "{t}" ORDER BY rowid LIMIT 3 OFFSET 100)', (q3 + 1.55 * (q3 - q1),))
    db.commit()
    db.close()
    # 作った表（2,400 行）: 種類が 1,000 を超える列（カラムの札の「1000+」の境）・値の無いまとまり（前との差）・同じ値（順位）
    bdb = sqlite3.connect(work / "集計の境.sqlite3")
    bdb.execute("CREATE TABLE 境 (区分 TEXT, 値 REAL, 鍵 TEXT, 小 INTEGER, 千 TEXT)")
    bdb.executemany("INSERT INTO 境 VALUES (?, ?, ?, ?, ?)",
                    [("ABCDE"[i % 5], None if i % 5 == 2 else (i % 7) * 1.5, f"K{i:05d}", i % 3, f"T{i % 1000}") for i in range(2400)])
    bdb.commit()
    bdb.close()
    # 作業開始の日付と時刻が別の列の作業実績（2 直だけの勤務体系: 23 時〜7 時は直の外・時刻の無い行・作業開始の無い行）
    tdb = sqlite3.connect(work / "実績_時刻別.sqlite3")
    tdb.execute("CREATE TABLE 実績 (ロット番号 TEXT, BOX実績_作業開始_日付 TEXT, BOX実績_作業開始_時刻 TEXT, 重量 REAL)")
    rows = []
    for k, (d, tm) in enumerate([(d, tm) for d in ("2025/12/31", "2026/09/29", "2026/09/30", "2026/10/01")
                                 for tm in ("06:30", "07:00", "14:59", "15:00", "22:59", "23:30", "", None)] + [(None, "08:00"), ("", "09:00")]):
        rows.append((f"T{k:03d}" if k % 4 else "T000", d, tm, 100 + k))
    tdb.executemany("INSERT INTO 実績 VALUES (?, ?, ?, ?)", rows)
    tdb.commit()
    tdb.close()


def dashboard(work):
    """ダッシュボード（前の版の答え合わせ役 dashboard）の手直し: 品質の設備の書きゆれと 30 を超える設備・全角の合金・中身が SQLite でない設備（BAD）・
    設備ごとの表（TLV）・仕掛の設備の列（前方一致）・壊れたビューの元"""
    work = Path(work)
    folder = work / FOLDER
    t = QUALITY_TABLE
    qdb = sqlite3.connect(work / "共有" / "台帳" / "SIKADEF.sqlite3")
    ids = [r[0] for r in qdb.execute(f'SELECT rowid FROM "{t}" ORDER BY rowid')]
    vals = ["CR2 1号", "cr1", "L-1 南", "ＣＲ２", " ", None, "TLV", "l-10", " L-9 ", "　"] + [f"X-{i:02d}" for i in range(1, 33)]
    for i, v in zip(ids[::3], vals * 6):
        qdb.execute(f'UPDATE "{t}" SET 設備 = ? WHERE rowid = ?', (v, i))
    qdb.commit()
    qdb.close()
    db = sqlite3.connect(folder / "実績_CAL.sqlite3")
    db.execute("UPDATE 実績 SET 合金 = 'Ａ５０５２' WHERE 合金 = 'A5052' AND rowid % 2 = 0")
    db.commit()
    db.close()
    (folder / "実績_BAD.sqlite3").write_text("SQLite ではない中身", encoding="utf-8")
    db = sqlite3.connect(folder / "実績_TLV.sqlite3")
    db.execute("CREATE TABLE 別表 AS SELECT ロット番号, 作業者, 重量, 合金, 調質, 作業区分 FROM 実績")
    db.commit()
    db.close()
    wdb = sqlite3.connect(work / "共有" / "台帳" / "LOTNOW.sqlite3")
    wids = [r[0] for r in wdb.execute("SELECT rowid FROM 仕掛 ORDER BY rowid")]
    for i, v in zip(wids[::4], ["CR1 南", "L-1 2号", "ＣＲ２-東", "謎の設備", "", None, " "] * 20):
        wdb.execute("UPDATE 仕掛 SET BOX設計_設備名 = ? WHERE rowid = ?", (v, i))
    wdb.commit()
    wdb.close()
    bdb = sqlite3.connect(work / "共有" / "壊れたビュー.sqlite3")
    bdb.executescript("CREATE TABLE 元 (ロット番号 TEXT, 合金 TEXT); CREATE TABLE 残る (a); INSERT INTO 残る VALUES (1);"
                      "CREATE VIEW 見る AS SELECT * FROM 元; DROP TABLE 元;")
    bdb.close()


UI_BOOKS = {"routes": routes, "pivot": pivot, "dashboard": dashboard}


def made_files(work):
    """台本が作るファイル（場面の相対の道。焼いた表は指紋だけを持ち、Python 無しの形では台本が作り直した物と比べる）: 作業フォルダの下の
    *.sqlite3（中身が SQLite でない BAD も）。答え合わせ役（Python）だけの写し・控え（cache・local）は場面に持たない"""
    work = Path(work)
    return sorted(p.relative_to(work).as_posix() for p in work.rglob("*.sqlite3") if p.is_file() and p.relative_to(work).parts[0] not in PYTHON_ONLY)


PYTHON_ONLY = ("cache", "local")


def fid_names(work, file_id):
    """場面のファイルのファイルID → 名前（答え合わせ役の答えの fids。焼いた表は登録のマスタの中のファイルID を @FID(場面の道) にする）。
    file_id は app の work_log.file_id（os.stat の答え → 字）"""
    return {file_id(os.stat(work / rel)): Path(rel).name for rel in made_files(work)}


# ------------------------------------------------------------------ 稼働の評価関数の場面（ops）

OPS_NOW = datetime(2026, 10, 3, 10, 0)                       # 前日（現場歴）は 10/2。交替勤務で 10/2 7:00〜10/3 7:00
OPS_FIRST = datetime(2026, 9, 22, 7, 0)                      # 作業を並べ始める時刻
KINDS = ("STD", "YMDHMS", "ONLY14", "AMPM", "SERIAL", "TIMECOL", "FURNACE", "NIGHT", "BLANKEND")
S0, E0, S14, E14 = "BOX実績_作業開始_日付", "BOX実績_作業終了_日付", "BOX実績_作業開始_年月日時分秒", "BOX実績_作業終了_年月日時分秒"
ST, ET = "BOX実績_作業開始_時刻", "BOX実績_作業終了_時刻"


def ops_of(kind, seed=3):
    """正しい作業の並び [(作業開始, 作業終了 か None, 分割の本数, 合金)]（作業開始の順。前の作業の終わりの後に次を始める）"""
    r = random.Random(f"{seed}-{kind}")
    out, t = [], OPS_FIRST
    while t < OPS_NOW - timedelta(hours=3):
        dur = timedelta(minutes=r.randint(20 * 60, 60 * 60) if kind == "FURNACE" else r.randint(25, 170))
        end = None if kind == "BLANKEND" and r.random() < 0.3 else t + dur
        out.append((t, end, r.choice([1, 1, 1, 2, 3]), r.choice(["A1100", "A5052", "A3004"])))
        t = t + dur + timedelta(minutes=r.randint(3, 50))
    # いま（OPS_NOW）より後に終わる作業は、いま作業中（作業終了がまだ無い）。その後ろは無い
    return [(s, e if e is None or e < OPS_NOW else None, k, a) for s, e, k, a in out if s < OPS_NOW]


def _jp(t):
    return f"{t:%Y/%m/%d} {t.hour}:{t.minute:02d}:00"


def _ampm(t):
    return f"{t:%Y/%m/%d} {'午前' if t.hour < 12 else '午後'} {t.hour % 12}:{t.minute:02d}:00"


def _serial(t):
    return (t - datetime(1899, 12, 30)).total_seconds() / 86400


def cells(kind, s, e):
    """書き方ごとの列と値 → {列: 値}"""
    if kind in ("STD", "FURNACE", "BLANKEND"):
        return {S0: _jp(s), E0: _jp(e) if e else ""}
    if kind == "YMDHMS":
        return {S0: f"{s:%Y/%m/%d}", E0: f"{e:%Y/%m/%d}" if e else "", S14: f"{s:%Y%m%d%H%M%S}", E14: f"{e:%Y%m%d%H%M%S}" if e else ""}
    if kind == "ONLY14":
        return {S14: f"{s:%Y%m%d%H%M%S}", E14: f"{e:%Y%m%d%H%M%S}" if e else ""}
    if kind == "AMPM":
        return {S0: _ampm(s), E0: _ampm(e) if e else ""}
    if kind == "SERIAL":
        return {S0: _serial(s), E0: _serial(e) if e else None}
    if kind == "TIMECOL":
        return {S0: f"{s:%Y/%m/%d}", ST: f"{s:%H:%M:%S}", E0: f"{e:%Y/%m/%d}" if e else "", ET: f"{e:%H:%M:%S}" if e else ""}
    if kind == "NIGHT":
        return {S0: _jp(s), E0: f"{s:%Y/%m/%d} {e.hour}:{e.minute:02d}:00" if e else ""}
    raise ValueError(kind)


def write_ops(path, kind, ops):
    rows = []
    n = 0
    for s, e, k, alloy in ops:
        for _ in range(k):
            n += 1
            rows.append({"ロット番号": f"L{n:05d}", **cells(kind, s, e), "合金": alloy})
    cols = list(dict.fromkeys(c for r in rows for c in r))
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE 実績 (" + ",".join(f"[{x}]" for x in cols) + ")")
    c.executemany("INSERT INTO 実績 VALUES (" + ",".join("?" * len(cols)) + ")", [[r.get(x) for x in cols] for r in rows])
    c.commit()
    c.close()


def ops_bench(work):
    """ops-bench.py の 9 つの書き方の設備（作業フォルダの「実績」）→ {書き方: 正しい作業の並び}"""
    folder = Path(work) / "実績"
    folder.mkdir(parents=True)
    truth = {}
    for kind in KINDS:
        truth[kind] = ops_of(kind)
        write_ops(folder / f"実績_{kind}.sqlite3", kind, truth[kind])
    return truth


def mk(path, cols, rows):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE 実績 (" + ",".join(f"[{x}]" for x in cols) + ")")
    c.executemany("INSERT INTO 実績 VALUES (" + ",".join("?" * len(cols)) + ")", rows)
    c.commit()
    c.close()


def add_columns(path, i):
    """調質（品種の組み合わせ）・重量（量の列）・色の列（棒の色）を足す"""
    c = sqlite3.connect(path)
    for col, typ in (("調質", "TEXT"), ("重量", "REAL"), ("色", "TEXT")):
        c.execute(f"ALTER TABLE 実績 ADD COLUMN [{col}] {typ}")
    c.execute("UPDATE 実績 SET 調質 = CASE rowid % 3 WHEN 0 THEN 'H14' WHEN 1 THEN 'O' ELSE 'H24' END, "
              f"重量 = (rowid * 37 + {i}) % 900 / 10.0 + 1, 色 = CASE WHEN rowid % 4 = 0 THEN '' ELSE '色' || (rowid % 3) END")
    c.commit()
    c.close()


def edge_rows():
    """EDGE の行: (ロット, 作業開始, 作業終了, 合金)。前日（10/2 7:00〜10/3 7:00）に入れる"""
    d = "2026/10/02"
    return [
        ("E01", f"{d} 8:00:00", f"{d} 9:00:00", "A1100"),
        ("E02", f"{d} 8:00:00", f"{d} 9:30:00", "A1100"),          # 同じ作業開始の分割ロット（作業終了は遅い方）
        ("E03", f"{d} 10:00:00", "", "A5052"),                     # 空
        ("E04", f"{d} 11:00:00", f"{d}", "A5052"),                 # 時刻が無い
        ("E05", f"{d} 12:00:00", "あいう", "A3004"),               # 読めない
        ("E06", f"{d} 13:00:00", f"{d} 12:00:00", "A3004"),        # 作業開始より前（同じ日の前の時刻は翌日と読む → 24 時間後）
        ("E07", f"{d} 14:00:00", "2026/10/02 13:59:00x", "A1100"),
        ("E08", "2026/09/25 14:00:00", f"{d} 14:00:00", "A1100"),  # 7 日（168 時間）ちょうど（期間より前から続く）
        ("E09", "2026/09/25 13:59:00", f"{d} 14:00:00", "A1100"),  # 168 時間を 1 分超える
        ("E10", "あとで", f"{d} 15:00:00", "A5052"),               # 作業開始が読めない
        ("E11", "", "", "A5052"),                                  # 作業開始が空
        ("E12", "20261002160000", "20261002170000", "A3004"),      # 14 桁の字
        ("E13", "46297.75", "46297.79166667", "A3004"),            # 日時の数の字（18:00〜19:00）
        ("E14", f"{d} 20:00:00", "2026/10/01 21:00:00", "A1100"),  # 作業終了が前の日（作業開始より前）
        ("E15", f"{d} 23:00:00", f"{d} 1:30:00", "A1100"),         # 日跨ぎ（作業終了の日付が作業開始の日のまま）
        ("E16", "2026/10/03 6:00:00", "", "A5052"),                # 作業日の最後の作業（いまは 10/3 10:00。前日の作業日の中）
    ]


def write_rows(path, rows):
    c = sqlite3.connect(path)
    c.execute(f"CREATE TABLE 実績 (ロット番号, [{S0}], [{E0}], 合金)")
    c.executemany("INSERT INTO 実績 VALUES (?, ?, ?, ?)", rows)
    c.commit()
    c.close()




def ops_base(work):
    """前の版の答え合わせ役 ops の分かれ道の設備（EDGE・MANY・NOSTART・NOEND・BAD）と、どの設備にも足す 調質・重量・色の列（ops_bench の後・最初の登録の前）"""
    folder = Path(work) / "実績"
    write_rows(folder / "実績_EDGE.sqlite3", edge_rows())
    t, rows = datetime(2026, 9, 26, 7, 0), []
    while t < OPS_NOW:
        rows.append((f"M{len(rows):05d}", f"{t:%Y/%m/%d %H:%M:%S}", f"{t + timedelta(minutes=4):%Y/%m/%d %H:%M:%S}", ["A1100", "A5052"][len(rows) % 2]))
        t += timedelta(minutes=5)
    write_rows(folder / "実績_MANY.sqlite3", rows)
    c = sqlite3.connect(folder / "実績_NOSTART.sqlite3")
    c.executescript("CREATE TABLE 実績 (ロット番号, 合金); INSERT INTO 実績 VALUES ('N1', 'A1100');")
    c.close()
    c = sqlite3.connect(folder / "実績_NOEND.sqlite3")
    c.executescript(f"CREATE TABLE 実績 (ロット番号, [{S0}], 合金); INSERT INTO 実績 VALUES ('N1', '2026/10/02 8:00:00', 'A1100');")
    c.close()
    (folder / "実績_BAD.sqlite3").write_text("SQLite ではない中身", encoding="utf-8")
    for i, f in enumerate(sorted(folder.glob("実績_*.sqlite3"))):
        if f.stem not in ("実績_NOSTART", "実績_NOEND", "実績_BAD"):
            add_columns(f, i)


# ---------------------------------------------------------------- 足した設備（版 3.63.0 の作った後の採点で足した組）
LONGCOL = "長い列名" + "あ" * 140          # 144 字（列名は 200 字まで）
LONGV = "品種" + "い" * 70                 # 72 字（基準の値は 120 字まで）
COL200 = "列" * 200                        # 列名の上限ちょうど
VAL120 = "値" * 120                        # 基準の値の上限ちょうど
HUGE_ROWS = 400_001                        # 当たる行の上限（400,000）を 1 行超える


def ops_added(work):
    """足す設備の表（勤務体系は答え合わせ役が書く。前の組の「すべての設備」の意味を変えないよう、前の組を答えてから足す）"""
    work = Path(work)
    f, d = work / "実績", "2026/10/02"
    mk(f / "実績_TXT.sqlite3", ["ロット番号", S0, E0, "合金", "重量字", LONGCOL], [       # 字の数・ロット番号の空白と空・長い列名と品種
        ("T001 ", f"{d} 8:00:00", f"{d} 9:00:00", "A1100", "12.5", "x1"),
        ("T002", f"{d} 9:30:00", f"{d} 11:00:00", "A5052", " 30 ", "x2"),
        (None, f"{d} 12:00:00", f"{d} 13:00:00", "A5052", "7", "x3"),
        ("", f"{d} 14:00:00", f"{d} 15:30:00", LONGV, "1e1", "x4"),
        ("T005", f"{d} 16:00:00", f"{d} 23:30:00", LONGV, "abc", "x5")])
    mk(f / "実績_TXT2.sqlite3", ["ロット番号", S0, E0, "合金", "重量字"], [               # 同じロットの後の工程
        ("T001", f"{d} 10:00:00", f"{d} 12:00:00", "A1100", "1"),
        ("T002", f"{d} 13:00:00", f"{d} 14:00:00", "A5052", "2"),
        (None, f"{d} 15:00:00", f"{d} 16:00:00", "A5052", "3")])
    mk(f / "実績_DATEONLY.sqlite3", ["ロット番号", S0, E0, "合金"], [                       # 作業開始が日付だけ（同じ字の行が 3 つ）
        ("D1", d, f"{d} 9:00:00", "A1100"), ("D2", d, f"{d} 10:00:00", "A1100"), ("D3", d, f"{d} 11:00:00", "A5052"),
        ("D4", f"{d} 12:00:00", f"{d} 13:00:00", "A5052")])
    mk(f / "実績_INTSER.sqlite3", ["ロット番号", S0, E0, "合金"], [                         # 整数の日時の数（真夜中）
        ("I1", 46297, 46297.25, "A1100"), ("I2", 46297.5, 46298, "A5052")])
    mk(f / "実績_SERTIME.sqlite3", ["ロット番号", S0, ST, E0, ET, "合金"], [          # 日時の数と時刻の列
        ("S1", 46297.0, "08:00:00", 46297.0, "09:30:00", "A1100"), ("S2", 46297.0, "10:00:00", 46297.0, "12:00:00", "A5052")])
    mk(f / "実績_TXTSER.sqlite3", ["ロット番号", S0, E0, "合金"], [                         # 日時の数の字で .0
        ("X1", "46297.0", "46297.5", "A1100"), ("X2", "46297.5", "46298.0", "A5052")])
    mk(f / "実績_NOLOT.sqlite3", [S0, E0, "合金"], [(f"{d} 8:00:00", f"{d} 9:00:00", "A1100"), (f"{d} 10:00:00", f"{d} 12:00:00", "A5052")])
    mk(f / "実績_LASTNT.sqlite3", ["ロット番号", S0, E0, "合金"], [                         # 最後の作業の作業終了が日付だけ
        ("N1", "2026/10/03 7:30:00", "2026/10/03 8:00:00", "A1100"), ("N2", "2026/10/03 8:30:00", "2026/10/03", "A5052")])
    mk(f / "実績_LA.sqlite3", ["ロット番号", S0, E0, "合金"], [                             # 設備をまたぐロット（期間の 3 日以上後の工程）
        ("Z1", "2026-09-26 10:00:00", "2026-09-26 11:00:00", "A1100"), ("Z2", "2026-09-26 12:00:00", "2026-09-26 13:00:00", "A1100"),
        ("Z3", "2026-09-20 12:00:00", "2026-09-20 13:00:00", "A5052")])
    mk(f / "実績_LB.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("Z1", "2026-10-01 10:00:00", "2026-10-01 11:00:00", "A1100"), ("Z3", "2026-09-26 15:00:00", "2026-09-26 16:00:00", "A5052")])
    mk(f / "実績_BIGNAME.sqlite3", ["ロット番号", S0, E0, COL200], [                        # 列名 200 字・値 120 字
        ("B1", f"{d} 8:00:00", f"{d} 9:00:00", VAL120), ("B2", f"{d} 9:00:00", f"{d} 11:00:00", VAL120),
        ("B3", f"{d} 12:00:00", f"{d} 12:30:00", "短い")])
    mk(f / "実績_HUGE.sqlite3", ["ロット番号", S0, E0, "合金"],                              # 当たる行が上限を 1 行超える（X を除けばちょうど）
         [("X" if i == 0 else f"H{i}", f"{d} 8:00:00", f"{d} 9:00:00", "A1100") for i in range(HUGE_ROWS)])
    # 2 回目の採点で足した組: 整数の量と品種・空白だけの作業終了・重なる作業・名前に作業開始／作業終了の無い列を選ぶ・作業終了_日時・
    # 作業終了＝作業開始・秒のある時刻・いちばん多い品種の作業時間が分からない
    mk(f / "実績_INTQ.sqlite3", ["ロット番号", S0, E0, "合金", "本数", "板厚"], [
        ("Q1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100", 3, 2), ("Q2", f"{d} 9:30:00", f"{d} 11:00:00", "A5052", 5, 3),
        ("Q3", f"{d} 12:00:00", f"{d} 13:00:00", "A5052", 7, 3), ("Q4", f"{d} 14:00:00", f"{d} 15:00:00", "A1100", 1, None)])
    mk(f / "実績_SPACE.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("W1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100"), ("W2", f"{d} 10:00:00", "   ", "A5052"), ("W3", "2026/10/03 8:00:00", " ", "A1100")])
    mk(f / "実績_OVER.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("O1", f"{d} 8:00:00", f"{d} 12:00:00", "A1100"), ("O2", f"{d} 9:00:00", f"{d} 10:00:00", "A5052"),
        ("O3", f"{d} 11:00:00", f"{d} 13:00:00", "A1100"), ("O4", f"{d} 18:00:00", "2026/10/03 9:00:00", "A5052")])
    mk(f / "実績_TWOEND.sqlite3", ["ロット番号", S0, E0, "炉出日時", "合金"], [
        ("T1", f"{d} 8:00:00", f"{d} 9:00:00", f"{d} 10:00:00", "A1100"), ("T2", f"{d} 11:00:00", f"{d} 12:00:00", f"{d} 14:30:00", "A5052")])
    mk(f / "実績_ENDDT.sqlite3", ["ロット番号", "作業開始日時", "作業終了_日時", "合金"], [
        ("U1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100"), ("U2", f"{d} 10:00:00", f"{d} 12:00:00", "A5052")])
    mk(f / "実績_SAME.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("S1", f"{d} 8:00:00", f"{d} 8:00:00", "A1100"), ("S2", f"{d} 9:00:00", f"{d} 10:00:00", "A5052")])
    mk(f / "実績_SEC.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("C1", f"{d} 8:00:20", f"{d} 9:01:45", "A1100"), ("C2", f"{d} 9:30:10", f"{d} 11:02:59", "A1100"), ("C3", f"{d} 12:00:07", f"{d} 12:41:00", "A5052")])
    mk(f / "実績_TWOSTART.sqlite3", ["ロット番号", S0, "炉入日時", E0, "合金"], [
        ("V1", f"{d} 8:00:00", f"{d} 8:40:00", f"{d} 10:00:00", "A1100"), ("V2", f"{d} 11:00:00", f"{d} 12:10:00", f"{d} 14:00:00", "A5052")])
    mk(f / "実績_NOTIME.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("Y1", f"{d} 8:00:00", "", "A3004"), ("Y2", f"{d} 9:00:00", "", "A3004"), ("Y3", f"{d} 10:00:00", "", "A3004"),
        ("Y4", f"{d} 11:00:00", f"{d} 12:00:00", "A1100"), ("Y5", f"{d} 13:00:00", f"{d} 13:30:00", "A5052")])
    # 3 回目の採点で足した組: リードタイムの後の工程が期間の終わりのちょうど 62 日後（入る）と 63 日後（入らない）・
    # 作業開始が日付だけの同じロットが 2 つの設備に（値が違う）・工程ごとに値が変わるロット（値は最初の工程の行）
    mk(f / "実績_GA.sqlite3", ["ロット番号", S0, E0, "合金"], [("L4", "2026/07/01 8:00:00", "2026/07/01 9:00:00", "A1100"),
                                                           ("L5", "2026/07/01 10:00:00", "2026/07/01 12:00:00", "A5052")])
    mk(f / "実績_GB.sqlite3", ["ロット番号", S0, E0, "合金"], [("L4", "2026/09/01 8:00:00", "2026/09/01 9:00:00", "A1100"),
                                                           ("L5", "2026/09/02 8:00:00", "2026/09/02 9:00:00", "A5052")])
    mk(f / "実績_LE.sqlite3", ["ロット番号", S0, E0, "合金", "重量"], [("J1", d, f"{d} 9:00:00", "A1100", 5.0)])
    mk(f / "実績_LF.sqlite3", ["ロット番号", S0, E0, "合金", "重量"], [("J1", d, f"{d} 15:00:00", "A5052", 9.0)])
    mk(f / "実績_LC.sqlite3", ["ロット番号", S0, E0, "合金", "調質", "重量"], [
        ("K1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100", "O", 10.0), ("K2", f"{d} 9:00:00", f"{d} 10:00:00", "A5052", "O", 20.0)])
    mk(f / "実績_LD.sqlite3", ["ロット番号", S0, E0, "合金", "調質", "重量"], [
        ("K1", f"{d} 12:00:00", f"{d} 13:00:00", "A1100", "H14", 7.5), ("K2", f"{d} 14:00:00", f"{d} 16:00:00", "A5052", "H24", 18.0)])
    # 4 回目の採点で足した組（P…）
    # P1: 点で区切った日付の字（作業開始・作業終了）
    mk(f / "実績_DOT.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("D1", "2026.10.02 8:00", "2026.10.02 9:00", "A1100"), ("D2", f"{d} 10:00:00", "2026.10.02", "A1100"),
        ("D3", f"{d} 11:00:00", "2026.10.02 12:30:00", "A5052"), ("D4", f"{d} 13:00:00", "2026.10.2", "A5052")])
    # P2: 同じ作業開始の分割ロットで、作業終了の読めなさが行ごとに違う
    mk(f / "実績_WHYMIX.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("W1", f"{d} 8:00:00", "", "A1100"), ("W2", f"{d} 8:00:00", "あいう", "A1100"),
        ("W3", f"{d} 9:00:00", "あいう", "A1100"), ("W4", f"{d} 9:00:00", d, "A1100"),
        ("W5", f"{d} 10:00:00", d, "A5052"), ("W6", f"{d} 10:00:00", "あいう", "A5052"),
        ("W7", f"{d} 11:00:00", "あいう", "A5052"), ("W8", f"{d} 11:00:00", "", "A5052"),
        ("W9", f"{d} 12:00:00", None, "A5052"), ("WA", f"{d} 12:00:00", "あいう", "A5052")])
    # P3: 作業開始に「開始」の無い列（炉入日時）を選び、作業終了は見つけさせる
    mk(f / "実績_FURNO.sqlite3", ["ロット番号", "炉入日時", "炉出日時", "作業終了_日付", "合金"], [
        ("F1", f"{d} 8:00:00", f"{d} 9:00:00", f"{d} 9:30:00", "A1100"), ("F2", f"{d} 10:00:00", f"{d} 12:00:00", f"{d} 12:30:00", "A5052")])
    # P4: 作業終了の列が見つからない（完了日時）
    mk(f / "実績_NOEND2.sqlite3", ["ロット番号", "作業開始日時", "完了日時", "合金"], [
        ("G1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100")])
    # P5: 字の列（調質）が片方の設備にだけある
    mk(f / "実績_LB1.sqlite3", ["ロット番号", S0, E0, "合金", "調質"], [("K1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100", "O")])
    mk(f / "実績_LB2.sqlite3", ["ロット番号", S0, E0, "合金"], [("K2", f"{d} 8:00:00", f"{d} 9:00:00", "A1100")])
    # P6: 作業開始が日付だけのロットが、期間の前・中・後の設備に（値が違う）
    mk(f / "実績_DC1.sqlite3", ["ロット番号", S0, E0, "合金"], [("C9", "2026/09/30", "2026/09/30 9:00:00", "A1100"),
                                                          ("C7", "2026/10/02 8:00:00", "2026/10/02 9:00:00", "A1100")])
    mk(f / "実績_DC2.sqlite3", ["ロット番号", S0, E0, "合金"], [("C9", "2026/10/03", "2026/10/03 9:00:00", "A5052"),
                                                          ("C8", "2026/10/03", "2026/10/03 9:00:00", "A5052")])
    mk(f / "実績_DC3.sqlite3", ["ロット番号", S0, E0, "合金"], [("C8", "2026/10/09", "2026/10/09 9:00:00", "A3004"),
                                                          ("C7", "2026/10/09 8:00:00", "2026/10/09 9:00:00", "A3004")])
    # P7: いまちょうど始まった作業（いまは 10/3 10:00）
    mk(f / "実績_RN.sqlite3", ["ロット番号", S0, E0, "合金"], [("R0", "2026/10/03 8:00:00", "2026/10/03 9:00:00", "A1100"),
                                                         ("R1", "2026/10/03 10:00:00", "", "A1100")])
    # P8: 2 工程のロットで最後の工程の作業終了が空
    mk(f / "実績_LT1.sqlite3", ["ロット番号", S0, E0, "合金"], [("Q1", f"{d} 8:00:00", f"{d} 9:00:00", "A1100"),
                                                          ("Q3", f"{d} 8:30:00", f"{d} 9:00:00", "A5052")])
    mk(f / "実績_LT2.sqlite3", ["ロット番号", S0, E0, "合金"], [("Q1", f"{d} 10:00:00", "", "A1100"), ("Q2", f"{d} 11:00:00", "", "A5052"),
                                                          ("Q3", f"{d} 11:30:00", "あいう", "A5052")])
    mk(f / "実績_LT3.sqlite3", ["ロット番号", S0, E0, "合金"], [("Q3", f"{d} 13:00:00", "", "A5052")])
    # P14: 作業終了が NULL（SQLite の空のセル）。今日の最後の作業は いま動いている
    mk(f / "実績_NULLEND.sqlite3", ["ロット番号", S0, E0, "合金"], [("N1", f"{d} 8:00:00", None, "A1100"), ("N3", f"{d} 9:00:00", f"{d} 10:00:00", "A1100"),
                                                              ("N2", "2026/10/03 9:00:00", None, "A5052")])
    # P17: ロット番号の列が無い設備だけでリードタイム
    mk(f / "実績_LOTLESS.sqlite3", [S0, E0, "合金"], [(f"{d} 8:00:00", f"{d} 9:00:00", "A1100")])
    # P18: 本数の順と占有時間の順が逆（占有時間の計の足し方）
    mk(f / "実績_OCC.sqlite3", ["ロット番号", S0, E0, "合金"], [
        ("O1", f"{d} 8:00:00", f"{d} 8:00:06", "A1100"), ("O2", f"{d} 8:10:00", f"{d} 8:10:06", "A1100"), ("O3", f"{d} 8:20:00", f"{d} 8:20:06", "A1100"),
        ("O4", f"{d} 9:00:00", "2026/10/05 13:00:18", "A5052"), ("O5", f"{d} 9:30:00", f"{d} 9:30:42", "A3004")])


def main():
    work, book = Path(sys.argv[1]), sys.argv[2]
    if book == "ops":
        ops_bench(work)
        ops_base(work)
        ops_added(work)
        return
    make(work, quality=600, work_rows=150, wip=400)
    finish(work)
    UI_BOOKS[book](work)


if __name__ == "__main__":
    main()
