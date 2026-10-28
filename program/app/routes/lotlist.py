# -*- coding: utf-8 -*-
"""ロット一覧（品質データ SQLite の写し）。"""
from ..web import current_app, jsonify, request

from .. import effective_settings, lot_engine, lot_list_params
from ..services import lot_list, pivot
from .common import bp, error, tab_denied


def lot_mirror():
    """参照先マスタの今の値に合わせてから返す（ほかの PC が参照先を直したら、次の問い合わせで切り替わる）。
    → (写しの係, いまのロット一覧の設定)。設定は1回の問い合わせで1回だけ読む（共有のマスタを読みに行くため）。"""
    settings = effective_settings(current_app)
    m = current_app.config["LOT_MIRROR"]
    want = lot_list_params(settings)
    # 参照先が「前に当てた値」から変わったときだけ切り替える（起動時の値は create_app が当てている）
    if want != current_app.config.get("LOT_APPLIED"):
        m.reconfigure(remote=want[0], interval_sec=want[1], stale_hours=want[2])
        current_app.config["LOT_APPLIED"] = want
    m.start()   # サーバー起動時に始まっていなければ、ここで始める（何度呼んでもよい）
    return m, settings.get("lot_list") or {}


def lotlist_plan(joined=True):
    """一覧を読む前の段取り → (段取り, 失敗の答え)。どちらか一方が None。
    段取り: 読むファイル（写しがあれば写し）・既定の表・既定の件数・いつのデータか。
    joined: データ元の結合を当てる（版 3.53.0。結合があれば、合わせた答えのファイルを読む。デスクトップ版の画面は engine=python を付けて Python に尋ねる）"""
    denied = tab_denied("lot", "品質") if joined else None       # タブの権限（版 3.58.0）: 出さない元は読ませない
    if denied:
        return None, denied
    m, ll = lot_mirror()
    if not m.enabled:
        return None, error("品質の元ファイルが決まっていません。「マスタ管理」の「データ元」で品質の場所を入れてください。", 400,
                           source=m.source_info())
    path = m.read_path()
    if not path:      # 写しがまだ無い（共有は直接読まない）。画面は写し終えたら引き直す
        return None, error(m.not_ready_text(), 503, "copying", source=m.source_info())
    plan = {"path": str(path), "table": ll.get("table", ""), "page_size": ll.get("page_size", 500), "source": m.source_info()}
    if not joined:
        return plan, None
    from .sources import source_def, with_joins
    s = source_def("lot")
    return with_joins(plan, s) if s else (plan, None)


def _lot_col():
    from .sources import lot_col_of
    return lot_col_of("lot")


@bp.get("/api/lotlist")
def lotlist():
    """WaveLog の /api/table と同じ引数（page, page_size, search, filters, sorts）で、写しから引く。
    group=1 はロット番号でまとめる（lot_list.grouped_rows）。デスクトップ版は Rust が同じ答えを作る（desktop/src/lotlist.rs）。"""
    plan, fail = lotlist_plan()
    if fail:
        return fail
    a = request.args
    try:
        out = lot_list.query(plan["path"], table=a.get("table", ""), preferred_table=plan["table"],
                             page=a.get("page", 1), page_size=a.get("page_size", plan["page_size"]),
                             search=a.get("search", ""), filters=a.get("filters", ""), sorts=a.get("sorts", ""), marks=a.get("marks", ""), calc=a.get("calc", ""),
                             group=a.get("group") == "1", lot_col=_lot_col())
    except Exception as e:
        return error(str(e), 503, source=plan["source"])
    out["source"] = plan["source"]
    return jsonify(out)


@bp.get("/api/lotlist/slicer")
def lotlist_slicer():
    """スライサーに並べる値（column の重複なしの値と件数。columns なら計算列の値の組）。filters・search は、このスライサー自身を除いた今の絞り込み。
    デスクトップ版は Rust が同じ答えを作る（desktop/src/lotlist.rs の slicer）。"""
    plan, fail = lotlist_plan()
    if fail:
        return fail
    a = request.args
    try:
        out = lot_list.slicer_answer(plan["path"], a, preferred_table=plan["table"])
    except ValueError as e:
        return error(str(e), 400)
    except Exception as e:
        return error(str(e), 503, source=plan["source"])
    return jsonify(out)


@bp.get("/api/lotlist/pivot")
def lotlist_pivot():
    """ピボット集計（services/pivot.py）。一覧と同じ絞り込みに当たる全件を数える。fields=1 なら左のカラムの札の手がかり。
    デスクトップ版でも Python が答える（窓の Rust は一覧・スライサーだけを受け持ち、写しの台帳は同じ物を読む）。"""
    plan, fail = lotlist_plan()
    if fail:
        return fail
    a = request.args
    try:
        if a.get("fields") == "1":
            return jsonify(pivot.fields(plan["path"], table=a.get("table", ""), preferred_table=plan["table"]))
        out = pivot.query(plan["path"], table=a.get("table", ""), preferred_table=plan["table"], search=a.get("search", ""),
                          filters=a.get("filters", ""), rows=a.get("rows", ""), cols=a.get("cols", ""), measures=a.get("measures", ""),
                          month=a.get("month", ""), box=a.get("box", ""), lot_col=_lot_col())
    except pivot.PivotError as e:
        return error(str(e), 400)
    except Exception as e:
        return error(str(e), 503, source=plan["source"])
    return jsonify(out)


@bp.get("/api/lotlist/settings")
def lotlist_settings():
    """デスクトップ版の Rust が尋ねる、いまの一覧の設定（参照先マスタで変えた値を重ねたもの）。写しと問い合わせは Rust が受け持つ。
    engine: "rust"（既定）か "python"（設定 desktop.lotlist_engine。食い違いに気づいたら Python に戻す）。"""
    settings = effective_settings(current_app)
    source, refresh_seconds, stale_hours = lot_list_params(settings)
    ll = settings.get("lot_list") or {}
    # 品質のタブを出さない人（版 3.58.0）: Rust に答えさせず Python に任せる（Python が権限で断る。Rust は権限を知らない）
    # ロット番号の列を決めてある（自動でない）ときも Python（版 3.58.0。Rust は名前で探す決まりしか知らない）
    engine = "python" if tab_denied("lot") or _lot_col() else lot_engine(current_app.config["APP_SETTINGS"])
    return jsonify(source=source, refresh_seconds=refresh_seconds, stale_hours=stale_hours, table=ll.get("table", ""),
                   page_size=ll.get("page_size", 500), engine=engine)


@bp.get("/api/lotlist/source")
def lotlist_source():
    """いま読んでいるデータはいつのものか（共有は見に行かない）。"""
    return jsonify(lot_mirror()[0].source_info())


@bp.post("/api/lotlist/refresh")
def lotlist_refresh():
    """「再読込」: 共有に新しい版があるかを今すぐ確かめ、あれば取り込む（変わっていなければ写さない・SHARED_READ.md の R2）。"""
    m, _ = lot_mirror()
    res = m.refresh()
    return jsonify(result=res, source=m.source_info())
