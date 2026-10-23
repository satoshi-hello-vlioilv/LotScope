# -*- coding: utf-8 -*-
"""起動したときに一度だけ当てるマスタの初期値（共有フォルダのマスタにも届けるため）。

同梱の data/ は、共有フォルダにそのマスタがまだ無いときの最初の版にしか使われない（MasterStore._seed）。
すでに共有にあるマスタへ、配った版で決めた初期値を届けるのがここ。
    - 当てたことは共有のマスタ `app_seeds` に記録し、**2回目からは当てない**（あとで人が直した値を戻さない）。
    - 当てる中身も「まだ決まっていないときだけ」にしてある（記録が消えても、人の決めた値を上書きしない）。
    - 共有に届かなければ記録しない（次の起動でまた試す）。
server.py が起動のときに裏で呼ぶ（画面を待たせない）。試験・評価のアプリ（create_app）では呼ばない。
"""
import logging

from ..repositories.master_store import next_id as _next_id
from .identity import normalize_part

log = logging.getLogger(__name__)
SEEDS_MASTER = "app_seeds"


def _inspection_meter(rows, stamp):
    """検査計のある設備（2026-09-29 利用者）: LS3・LS4・DL2・TLV・NS1。空のときだけ「有」。無い設備は足す。"""
    want = ["LS3", "LS4", "DL2", "TLV", "NS1"]
    have = {normalize_part(r.get("設備名")): r for r in rows}
    for name in want:
        r = have.get(normalize_part(name))
        if r is None:
            rows.append({"id": _next_id(rows), "設備名": name, "巻取方向": "", "ライン方向": "", "同一工程": "", "検査計": "有",
                         "rev": 1, **stamp})
        elif not str(r.get("検査計") or "").strip():
            r["検査計"] = "有"
            r["rev"] = int(r.get("rev") or 1) + 1
            r.update(stamp)


def _first_developer(rows, stamp):
    """最初の管理者（2026-09-29 利用者）: ログインID satoshi-harada を開発者に。その ID の行がまだ無いときだけ。"""
    if any(normalize_part(r.get("ログインID")) == normalize_part("satoshi-harada") for r in rows):
        return
    rows.append({"id": _next_id(rows), "ログインID": "satoshi-harada", "PC名": "", "権限区分": "開発者", "マスタ編集": "編集可",
                 "有効": "有", "備考": "最初の管理者（配った版で登録）", "rev": 1, **stamp})


def _kama_date_table(rows, stamp):
    """変換表「釜番日付」（版 3.51.2。2026-10-23 利用者）: 同梱の既定の表を、すでに共有にある変換表へ足す。同じ名前の表があれば触らない
    （一度だけ当てるので、あとで人が消した・直した表は戻さない）"""
    import json
    from ..repositories.master_store import DEFAULTS_DIR
    if any(str(r.get("名前") or "") == "釜番日付" for r in rows):
        return
    bundled = json.loads((DEFAULTS_DIR / "conversions.json").read_text(encoding="utf-8"))
    src = next((r for r in bundled if r.get("名前") == "釜番日付"), None)
    if src is None:
        return
    top = max((int(r.get("表示順") or 0) for r in rows if str(r.get("表示順") or "").lstrip("-").isdigit()), default=0)
    rows.append({"id": _next_id(rows), **{k: src.get(k, "") for k in ("名前", "入力", "判定", "その他", "当て方")}, "表示順": str(top + 10),
                 "rev": 1, **stamp})


SEEDS = [
    ("2026-09-29-inspection-meter", "equipment_master", _inspection_meter),
    ("2026-09-29-first-developer", "access_permissions", _first_developer),
    ("2026-10-23-kama-date-table", "conversions", _kama_date_table),
]


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
            store.write(name, lambda rows, stamp, fn=fn: fn(rows, stamp))
            store.write(SEEDS_MASTER, lambda rows, stamp, sid=sid: rows.append({"id": _next_id(rows), "seed": sid, **stamp}))
            applied.append(sid)
            log.info("MASTER_SEED_APPLIED id=%s master=%s", sid, name)
        except Exception as e:
            log.info("MASTER_SEED_RETRY_LATER id=%s reason=%s", sid, e)
            break
    return applied
