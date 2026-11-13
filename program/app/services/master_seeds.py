# -*- coding: utf-8 -*-
"""起動したときに一度だけ当てるマスタの初期値（共有フォルダのマスタにも届けるため）。

同梱の data/ は、共有フォルダにそのマスタがまだ無いときの最初の版にしか使われない（MasterStore._seed）。
すでに共有にあるマスタへ、配った版で決めた初期値を届けるのがここ。
    - 当てたことは共有のマスタ `app_seeds` に記録し、**2回目からは当てない**（あとで人が直した値を戻さない）。
    - 当てる中身も「まだ決まっていないときだけ」にしてある（記録が消えても、人の決めた値を上書きしない）。
    - 共有に届かなければ記録しない（次の起動でまた試す）。
server.py が起動のときに裏で呼ぶ（画面を待たせない）。試験・評価のアプリ（create_app）では呼ばない。
版 3.110.0 から係は窓（desktop/src/seeds.rs。sidecar.rs の SERVES に seeds）。窓が名乗ると boot.start はここを呼ばない。
名乗らない形（開発用サーバー・前の版の窓）は今のまま。決まりは事例の表 tests/fixtures/seeds_cases.json に全部書いてあり、窓も同じ表で確かめる。
    - 錠の中で読み直した行で決め、当てる中身が無ければ書かない（版を上げない）。app_seeds も、同じ seed がもう記録にあれば足さない
      （版 3.110.0。前は 2 つの PC が app_seeds を読んだ直後に当てると、記録が seed ごとに 2 行・中身の版が空の書き込みで上がった）
"""
import logging
import time

from ..repositories.master_store import MasterLocked
from ..repositories.master_store import next_id as _next_id
from .identity import normalize_part
from .row_order import next_order

log = logging.getLogger(__name__)
SEEDS_MASTER = "app_seeds"
# 錠に当たったときのやり直し（版 3.105.0）: 起動の同じ瞬間に、同じ PC の窓（係 rs）が最初の問い合わせで共有に種をまいて錠を持つと、
# 前は MasterLocked で止めて次の起動へ回した（初期値が起動 1 回ぶん遅れた）。種まきの錠はすぐ外れるので、1 秒おきに 5 回まで待つ。
# 窓の種まきの側で待つ形にしなかったのは、窓は画面の問い合わせの途中で種をまく（待つと答えが遅れる）が、ここは起動の裏で一度だけ動く係だから
LOCKED_TRIES = 5
LOCKED_WAIT_SEC = 1.0


class _Same(Exception):
    """当てる中身がもう決まっている（錠の中で読み直した行で決める）。書かずに抜ける（版を上げない。版 3.110.0）"""


def _inspection_meter(rows, stamp):
    """検査計のある設備（2026-09-29 利用者）: LS3・LS4・DL2・TLV・NS1。空のときだけ「有」。無い設備は足す。"""
    want = ["LS3", "LS4", "DL2", "TLV", "NS1"]
    have = {normalize_part(r.get("設備名")): r for r in rows}
    changed = False
    for name in want:
        r = have.get(normalize_part(name))
        if r is None:
            rows.append({"id": _next_id(rows), "設備名": name, "巻取方向": "", "ライン方向": "", "同一工程": "", "検査計": "有",
                         "rev": 1, **stamp})
            changed = True
        elif not str(r.get("検査計") or "").strip():
            r["検査計"] = "有"
            r["rev"] = int(r.get("rev") or 1) + 1
            r.update(stamp)
            changed = True
    return changed


def _first_developer(rows, stamp):
    """最初の管理者（2026-09-29 利用者）: ログインID satoshi-harada を開発者に。その ID の行がまだ無いときだけ。"""
    if any(normalize_part(r.get("ログインID")) == normalize_part("satoshi-harada") for r in rows):
        return False
    rows.append({"id": _next_id(rows), "ログインID": "satoshi-harada", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可",
                 "有効": "有", "備考": "最初の管理者（配った版で登録）", "rev": 1, **stamp})
    return True


def _kama_date_table(rows, stamp):
    """変換表「釜番日付」（版 3.51.2。2026-10-23 利用者）: 同梱の既定の表を、すでに共有にある変換表へ足す。同じ名前の表があれば触らない
    （一度だけ当てるので、あとで人が消した・直した表は戻さない）"""
    import json
    from ..repositories.master_store import DEFAULTS_DIR
    if any(str(r.get("名前") or "") == "釜番日付" for r in rows):
        return False
    bundled = json.loads((DEFAULTS_DIR / "conversions.json").read_text(encoding="utf-8"))
    src = next((r for r in bundled if r.get("名前") == "釜番日付"), None)
    if src is None:
        return False
    rows.append({"id": _next_id(rows), **{k: src.get(k, "") for k in ("名前", "入力", "判定", "その他", "当て方")}, "表示順": next_order(rows),
                 "rev": 1, **stamp})
    return True


SEEDS = [
    ("2026-09-29-inspection-meter", "equipment_master", _inspection_meter),
    ("2026-09-29-first-developer", "access_permissions", _first_developer),
    ("2026-10-23-kama-date-table", "conversions", _kama_date_table),
]


def _write(store, name, fn):
    """store.write。錠（MasterLocked）に当たったら LOCKED_WAIT_SEC おきに LOCKED_TRIES 回まで やり直す。
    fn が何も変えなければ（False）書かない（版 3.110.0）"""
    def mutate(rows, stamp):
        if not fn(rows, stamp):
            raise _Same
    for i in range(LOCKED_TRIES):
        try:
            return store.write(name, mutate)
        except _Same:
            return None
        except MasterLocked:
            if i == LOCKED_TRIES - 1:
                raise
            time.sleep(LOCKED_WAIT_SEC)


def _record(rows, stamp, sid):
    """app_seeds に当てたことを書く。錠の中で読み直した記録に同じ seed がもうあれば足さない（版 3.110.0）"""
    if any(str(r.get("seed")) == sid for r in rows):
        return False
    rows.append({"id": _next_id(rows), "seed": sid, **stamp})
    return True


def run(store):
    """まだ当てていない初期値を当てる。→ 当てた id の一覧。共有に届かない・錠が取れないときは投げずに次の起動へ回す。"""
    applied = []
    try:
        done = {str(r.get("seed")) for r in store.read(SEEDS_MASTER)}
    except Exception as e:
        log.info("MASTER_SEEDS_SKIP reason=%s", e)
        return applied
    for sid, name, fn in SEEDS:
        if sid in done:
            continue
        try:
            _write(store, name, lambda rows, stamp, fn=fn: fn(rows, stamp))
            _write(store, SEEDS_MASTER, lambda rows, stamp, sid=sid: _record(rows, stamp, sid))
            applied.append(sid)
            log.info("MASTER_SEED_APPLIED id=%s master=%s", sid, name)
        except Exception as e:
            log.info("MASTER_SEED_RETRY_LATER id=%s reason=%s", sid, e)
            break
    return applied
