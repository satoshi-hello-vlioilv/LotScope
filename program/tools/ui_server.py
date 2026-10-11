"""画面だけを確かめるための開発用サーバー（窓 desktop/ の代わり。利用者の起動の道ではない）。

試験用の品質データ（tests/lotlist_fixture.py の 1500 行）と作業実績（設備 4 台ぶん）を作業フォルダに作って参照先にし、アプリ（create_app）を
標準の http.server で配る。program/tools/ui-check.mjs・ui-variants.mjs が撮影と測定に使う（ui-harness.mjs が起こす）。
窓だけが答える /__desktop/* は、撮影の台本（ui-harness.mjs）が Playwright で作り物の答えを返す。

    python -u tools/ui_server.py [ポート] [権限区分]

権限区分（既定は 開発者）は、この PC の名乗りに効く権限を差し替える（マスタ管理の全部のタブ・配布を撮るため。
アクセス権限のマスタは書き換えない）。一般ユーザーの見え方を撮るときは「一般ユーザー」を渡す。

待ち受けを始めたら 1 行出す（台本はそれを待つ）。マスタ・手元の写し・画面の設定の控えは作業フォルダに置くので、
リポジトリ（program/data など）を汚さない。
"""
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
WORK = Path(tempfile.mkdtemp(prefix="tpa-ui-"))
os.environ["TRANSFER_LOCAL_ROOT"] = str(WORK / "local")      # 画面の設定の控え・ログの置き場（create_app より前に決める）
sys.path.insert(0, str(PROGRAM))

import app_env  # noqa: E402
from app import create_app  # noqa: E402
from app.repositories.master_repository import MasterRepository  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from app.services import access, display_formats, work_log  # noqa: E402
from app.services.db_mirror import DbMirror  # noqa: E402
from app.web import serve_http  # noqa: E402
from tests import lotlist_fixture  # noqa: E402


WORK_EQUIPMENT = ("CR1", "CR2", "L-1", "L-2", "TLV", "LS3", "DL2", "CAL", "ANF", "HOT", "SL1")


def as_role(role):
    """この PC の名乗りに効く権限を role（マスタ編集は区分の上限）にする。"""
    def flags(rows, login, pc):
        return {"role": role, "masterEdit": access.master_edit_cap(role), "masterEditStored": "", "matchedId": None}
    access.flags = flags


def seed_formats(repo):
    """共有の書式（作業実績）を 3 つ置いておく（画面の「書式 ▾」を撮るため。中身は作り物）。"""
    std = {"columns": {"order": ["作業日", "開始", "終了", "ロット番号", "作業区分", "作業者"], "hidden": ["備考", "速度"],
                       "names": {"入側板厚": "入側", "出側板厚": "出側"}, "widths": {}, "locks": [], "formats": {}, "aligns": {}, "formulas": {}, "rules": {}},
           "sorts": [{"column": "作業日", "dir": "desc"}], "arrange": {"levels": [{"column": "作業者", "dir": "asc", "lot": False}], "heads": True, "suppress": False}}
    insp = {"slicer": {"cards": [{"column": "作業区分"}, {"column": "作業者"}]},
            "presets": [{"name": "再処理だけ", "filters": [{"column": "作業区分", "op": "equals", "value": "再処理"}], "group": "", "always": False}],
            "sorts": [{"column": "重量", "dir": "desc"}]}
    thin = {"columns": {"order": ["ロット番号", "入側板厚", "出側板厚", "板幅"], "hidden": ["備考", "合金", "調質"], "names": {}, "widths": {},
                        "locks": [], "formats": {}, "aligns": {}, "formulas": {"減面率": "1-[出側板厚]/[入側板厚]"}, "rules": {}}}
    for name, origin, body, note in (("標準", "CR1・実績", std, "全設備の基本の並び"), ("検査用", "L-1・実績", insp, ""),
                                     ("薄板の確認", "CR2・実績", thin, "板厚と減面率")):
        repo.format_create(display_formats.clean_row({"name": name, "source": "work", "table": "実績", "origin": origin, "body": body, "note": note}))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5077
    as_role(sys.argv[2] if len(sys.argv) > 2 else "開発者")
    share = WORK / "share.sqlite3"
    lotlist_fixture.make(str(share), 1500)
    # 作業実績: 設備ごとの実績ファイル（実績_<設備>.sqlite3）を 12 台ぶん。1 台（SL3）は登録のあとにファイルが無くなった形
    folder = WORK / "【New】実績"
    folder.mkdir()
    for eq in WORK_EQUIPMENT + ("SL3",):
        lotlist_fixture.make_work(str(folder / f"実績_{eq}.sqlite3"), eq)
    # 手元のみのマスタは base/data に書く。同梱のマスタを作業フォルダへ写して渡す（画面で直してもリポジトリを汚さない）
    shutil.copytree(PROGRAM / "data", WORK / "base" / "data", ignore=shutil.ignore_patterns("*.sqlite3", "cache", "local"))
    settings = app_env.load_settings(PROGRAM)
    settings["work_log"] = {**settings.get("work_log", {}), "folder": str(folder)}
    app = create_app({"MASTER_STORE": MasterStore(WORK / "base", local_root=WORK / "masters", settings={}),
                      "LOT_MIRROR": DbMirror("lot_list", share, WORK / "cache"), "APP_SETTINGS": settings,
                      "WORK_MIRRORS": work_log.Mirrors(WORK / "cache" / "work_log")})
    # 設備を登録しておく（マスタ管理の「探す」と同じ）
    MasterRepository(app.config["MASTER_STORE"]).work_log_sync(work_log.scan(folder, settings["work_log"]["pattern"]))
    seed_formats(MasterRepository(app.config["MASTER_STORE"]))
    (folder / "実績_SL3.sqlite3").unlink()
    old = time.time() - 80 * 3600                    # 1 台（HOT）は更新が止まった形（80 時間前）
    os.utime(folder / "実績_HOT.sqlite3", (old, old))
    serve_http(app, port=port)


if __name__ == "__main__":
    main()
