# -*- coding: utf-8 -*-
"""ロット一覧（品質データ SQLite の写し）。"""
from ..web import current_app, jsonify, request

from .. import effective_settings, lot_engine, lot_list_params, shell_serves
from ..repositories.master_repository import MasterRepository
from ..services import conversions, lot_list, pivot
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
    デスクトップ版は版 3.61.0 から窓の Rust（desktop/src/pivot.rs）が同じ答えを作る（ここは前の窓・engine=python・答え合わせの相手）。"""
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
    engine: "rust"（既定）か "python"（設定 desktop.lotlist_engine。食い違いに気づいたら Python に戻す）。
    conversions: 計算列の式の conv が引く変換表と版（版 3.59.0。計算列で並べ替える一覧も Rust が答える）。"""
    settings = effective_settings(current_app)
    source, refresh_seconds, stale_hours = lot_list_params(settings)
    ll = settings.get("lot_list") or {}
    engine = lot_engine(current_app.config["APP_SETTINGS"])
    if "lists" not in shell_serves() and (tab_denied("lot") or _lot_col()):
        # 段取りを知らない前の窓（版 3.59.0 まで）: 品質のタブを出さない人・ロット番号の列を決めてある元は Python に任せる
        engine = "python"
    try:
        lists = lists_settings()
    except Exception:
        # 段取りの材料（データ元・作業実績の登録など）が読めない（マスタに届かない など）: 窓は品質の結合・ロット番号の列・タブの権限を
        # 知らずに答えることになるので、Python に任せる（Python は同じ理由の失敗を答える）
        lists, engine = None, "python"
    try:
        # 権限の判定の材料（版 3.65.0。desktop/src/access.rs）: 名乗り（決めるのはまだ Python）と、マスタ・利用状況の置き場。
        # 窓はこの置き場から権限のマスタと切断の指示を自分で読み、me を決めて Python へ渡す（判定は窓の 1 か所）
        place = _access_place()
    except Exception:
        place = None     # 読めない: 窓は me を載せず、Python が自分で決める
    return jsonify(source=source, refresh_seconds=refresh_seconds, stale_hours=stale_hours, table=ll.get("table", ""),
                   page_size=ll.get("page_size", 500), engine=engine, conversions=_conversions(), lists=lists, access=place)


def lists_settings():
    """一覧の段取りに要る物（版 3.60.0。デスクトップ版の Rust が品質・作業実績・データ元の一覧とスライサーを受け持つ: desktop/src/lists.rs）。
    hidden: この PC・このログインに出さないタブ（タブの権限）・sources: データ元の定義（場所・表・件数・ロット番号の列・結合・元）・
    work: 作業実績のフォルダ・決まり・設備の登録・shifts: 勤務体系（設備ごとの直）。マスタの中身を Python が読み、決めるのは Rust"""
    from ..services import shifts, work_log
    from .common import can_write, master_repo, me
    from .sources import all_sources
    try:
        hidden = list(me()["flags"]["hiddenTabs"])
    except Exception:
        hidden = []
    repo = master_repo()
    wl = work_log.params(effective_settings(current_app))
    keep = ("key", "kind", "name", "place", "table", "base", "broken", "api", "lotSet", "joins", "read", "equipColumn", "equipMode")
    from ..services import equip_groups
    from .dashboard import _equipment_names, _now_override
    return {"hidden": hidden,
            # ダッシュボードの段取りの材料（版 3.62.0。desktop/src/dashboard.rs）: 設備の名前（データ元の設備の列の見分け・合わせた表の並び）・
            # 設備グループ（表示順の並びの view）・試験の「いま」（DASHBOARD_NOW。製品では null＝窓の時計）
            "dash": {"equipNames": _equipment_names(repo, repo.work_logs()),
                     "equipGroups": [equip_groups.view(r) for r in equip_groups.ordered(repo.equip_groups())],
                     "now": _now_override()},
            "sources": [{k: s.get(k) for k in keep} for s in all_sources()],
            "work": {**{k: wl[k] for k in ("folder", "pattern", "table", "refresh_seconds", "stale_hours", "page_size")},
                     "rows": [{k: r.get(k) for k in ("キー", "設備名", "ファイル名", "ファイルID", "表示", "表", "並び")} for r in repo.work_logs()],
                     "canEditShifts": can_write(shifts.NAME)},
            "shifts": repo.shift_patterns()}


def _access_place():
    from ..repositories.master_store import DEFAULTS_DIR
    from ..services import identity, presence
    st = current_app.config["MASTER_STORE"]
    st.follow_moved()                    # 置き場の決まり（引っ越し先の印・配る版の覚え）は Python が決め、窓はその答えを読む
    pdir = presence.presence_dir()
    who = identity.current()
    return {"who": {**who, "key": presence.terminal_key(who["login"], who["pc"])},
            "place": {"shareDir": str(st.share_dir) if st.share_dir is not None else "", "shared": sorted(st.shared_names),
                      "data": str(st.base / "data"), "defaults": str(DEFAULTS_DIR), "cache": str(st.cache_dir),
                      "presence": str(pdir) if pdir is not None else ""}}


def _conversions():
    """計算列の式の conv が引く変換表と、その版（版 3.59.0。Rust も式を持ち、計算列で並べ替える一覧に答える。版が同じなら Rust は読み直さない）"""
    st = current_app.config["MASTER_STORE"]
    try:
        return {"rev": st.stamp(conversions.NAME), "tables": conversions.tables(MasterRepository(st).conversions())}
    except Exception:                    # マスタを読めない: 表なし（conv は空。一覧そのものは答える）
        return {"rev": None, "tables": {}}


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
