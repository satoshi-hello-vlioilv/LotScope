# -*- coding: utf-8 -*-
"""ロットの取り込み（LotDsp）と計算。"""
import functools
import logging
import time

from ..web import current_app, jsonify, render_template, request

from ..services import lotdsp_api, lotdsp_direct, lotdsp_link, lotdsp_progress, lotdsp_rules
from ..version import APP_VERSION
from .common import api_map, bp, calculator, error, exception_error


# 窓（デスクトップ版の Rust）が LotDsp を受け持つと名乗ったとき（TPA_SHELL_SERVES に lotdsp。版 3.98.0。desktop/src/lotdsp.rs）、
# この 9 本は答えない（見えない Edge・錠・中止・学びの覚えはプロセスに 1 つしか持てないので、係を 2 つにしない）。窓はどの形も
# 自分で答えるので、ここへは来ない。来たら誤りの印（409 kind shell）を返し、来た数を数える（試験が 0 回を確かめる）
SHELL_HITS = 0


def _shell_serves():
    from .. import shell_serves
    return "lotdsp" in shell_serves()


def _shell_answer():
    global SHELL_HITS
    SHELL_HITS += 1
    logging.getLogger(__name__).error("LotDsp の道が Python に来ました（窓が答えるはずの道）: %s %s", request.method, request.path)
    return error("LotDsp はデスクトップ版の窓が読みます（この道は窓が答えます）。", 409, "shell")


def lotdsp_route(fn):
    """LotDsp の 9 本の入口: 窓が受け持つなら答えない・本文の読み方の誤り（lotdsp_rules.BodyError）は 400 invalid。"""
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        if _shell_serves():
            return _shell_answer()
        try:
            return fn(*a, **kw)
        except lotdsp_rules.BodyError as e:
            return error(str(e), 400, "invalid")
        except lotdsp_rules.LotShapeError as e:
            return error(str(e), 400, "invalid")
        except SettingsError as e:
            return error(f"LotDsp の設定・設備マスタを読めません（{e}）。", 503, "settings")
    return wrapper


def _body():
    return lotdsp_rules.read_body(request.get_data())


class SettingsError(Exception):
    """LotDsp の道の材料（参照先・設備マスタ）を読めない（503 kind settings。版 3.98.0: 窓〈lotdsp.rs〉と同じ。前は取込が 400・
    API の道が 500 で、参照先は黙って配った設定に戻った）"""


def _inputs():
    """LotDsp の道の材料: (参照先を重ねた lotdsp_import, 設備マスタの行)。読む順は窓の bundle.rs の lotdsp_inputs と同じ（参照先 → 設備マスタ）"""
    from ..repositories.master_repository import MasterRepository
    from ..services import path_settings
    repo = MasterRepository(current_app.config["MASTER_STORE"])
    try:
        rows = repo.path_settings()
    except Exception:
        raise SettingsError("参照先") from None
    try:
        equipment = repo.equipment()
    except Exception:
        raise SettingsError("設備マスタ") from None
    return path_settings.effective(current_app.config["APP_SETTINGS"], rows)[0].get("lotdsp_import"), equipment


def read_lot(html, expect_lot="", inputs=None):
    """進度情報の HTML → (Lot, report)。どの道（見えない Edge・LotDsp の窓・貼り付け）で読んでも同じ。
    読めたら、同じロットを LotDsp の API でも引いて項目名を学ぶ（lotdsp_api.learn_later。裏で・失敗しても取込は済んでいる）。"""
    li, equipment = inputs or _inputs()
    read_cfg = current_app.config["APP_SETTINGS"].get("lotdsp_import")
    lot, report = lotdsp_progress.read_lot(html, equipment, read_cfg, expect_lot)
    cfg = lotdsp_api.settings_of(li)
    if current_app.config.get("LOTDSP_API_SYNC"):        # 試験: 学ぶのを待つ（使わない設定・ロット番号なしは learn_later と同じく学ばない）
        if cfg["enabled"] and lot.lot_no:
            lotdsp_api.learn_from_html(api_map(), cfg, html, lot.lot_no, read_cfg)
    else:
        lotdsp_api.learn_later(api_map(), cfg, html, lot.lot_no, read_cfg)
    return lot, report


@bp.post("/api/lots/import-lotdsp")
@lotdsp_route
def lot_import_lotdsp():
    """ロット問い合わせ（LotDsp）「進度情報」の HTML からロットを読む。

    呼ぶのはこのアプリ自身の画面だけ（HTML は Edge 拡張・保存ファイル・貼り付けのどれかで画面が受け取る）。
    本文 {html: 字, lot_no: 字}（版 3.98.0: 字でなければ 400 invalid。ロット番号は空でもよい＝画面のロット番号を使う）
    """
    payload = _body()
    inputs = _inputs()
    html = lotdsp_rules.html_of(payload)
    lot_no = lotdsp_rules.norm_lot(payload.get("lot_no"))
    try:
        lot, report = read_lot(html, lot_no, inputs)
        return jsonify(lot=lot.to_dict(), report=report)
    except Exception as e:
        return exception_error(e)


# 読めなかった理由 → 状態コード（ここに無いもの: unreachable・no_browser・browser・screen・disabled は 503）
_DIRECT_STATUS = {"login": 409, "busy": 409, "cancelled": 409, "not_found": 404, "invalid": 400}


@bp.post("/api/lots/fetch-lotdsp")
@lotdsp_route
def lot_fetch_lotdsp():
    """このアプリで LotDsp を読んで取り込む（社内のログイン不要な範囲は見えない Edge・ログインが要れば LotDsp の窓）。

    読めなければ kind で理由を返す。画面はそれを見て、ログインが要る（VPN）なら
    LotDsp の窓（login_window: true。利用者がその窓でログインし、続きをアプリが読む）へ回す。
      login 409 ／ not_found 404 ／ busy 409 ／ invalid 400 ／ unreachable・no_browser・browser・screen・disabled 503
    秒（seconds）は道の全体で測り、小数 1 桁（版 3.98.0。lotdsp_rules.seconds_of。report.seconds も同じ値）
    """
    t0 = time.perf_counter()
    payload = _body()
    inputs = _inputs()
    lot_no = lotdsp_rules.checked_lot(payload.get("lot_no"))
    cfg = lotdsp_direct.settings_of(inputs[0])
    try:
        html = lotdsp_direct.fetch_progress_html(lot_no, cfg, window=lotdsp_rules.flag_of(payload, "login_window"))
    except lotdsp_direct.DirectError as e:
        return error(str(e), _DIRECT_STATUS.get(e.kind, 503), e.kind)
    try:
        lot, report = read_lot(html, lot_no, inputs)
    except Exception as e:
        return error(str(e), 400, "parse")
    report["seconds"] = lotdsp_rules.seconds_of(t0, time.perf_counter())
    return jsonify(lot=lot.to_dict(), report=report, seconds=report["seconds"])


# API で読めなかった理由 → 状態コード（ここに無いもの: unreachable・timeout・http・invalid・business・mismatch は 502）
_API_STATUS = {"not_ready": 409, "disabled": 409, "not_found": 404}


@bp.post("/api/lots/fetch-lotdsp-api")
@lotdsp_route
def lot_fetch_lotdsp_api():
    """LotDsp の API で、ログインなしで読む（LotSearch と同じ道）。項目名を学び終えるまでは not_ready（409）。
    画面はこれを最初に試し、読めなければ（not_found 以外）今までの道（見えない Edge・LotDsp の窓・貼り付け）へ回す。"""
    t0 = time.perf_counter()
    payload = _body()
    li, equipment = _inputs()
    lot_no = lotdsp_rules.checked_lot(payload.get("lot_no"))
    try:
        lot, report = lotdsp_api.read_lot(api_map(), lotdsp_api.settings_of(li), lot_no, equipment,
                                          current_app.config["APP_SETTINGS"].get("lotdsp_import"))
    except lotdsp_api.ApiError as e:
        return error(str(e), _API_STATUS.get(e.kind, 502), e.kind)
    except LookupError as e:
        return error(str(e), 400, "parse")
    report["seconds"] = lotdsp_rules.seconds_of(t0, time.perf_counter())
    return jsonify(lot=lot.to_dict(), report=report, seconds=report["seconds"])


@bp.get("/api/lots/lotdsp-api/survey")
@lotdsp_route
def lot_lotdsp_api_survey():
    """調査用: LotDsp の API の応答に入っている項目をすべて一覧にする（?lot=ロット番号。?values=1 で値も入れる＝この PC の画面で見るだけ）。
    同じ問い合わせ先（searchAction）を1回呼ぶだけで、何も覚えず・書き換えない。"""
    li, _ = _inputs()
    raw = request.args.get("lot") or ""
    if not raw.strip():
        return error("ロット番号を付けてください（例: …/survey?lot=L7150C0）。", 400, "invalid")
    lot_no = lotdsp_rules.checked_lot(raw)
    cfg = lotdsp_api.settings_of(li)
    try:
        result = lotdsp_api.call(lot_no, cfg)
        lotdsp_api.entity_of(result, cfg, lot_no)          # 該当なしは、ほかの道と同じ言い方で返す
    except lotdsp_api.ApiError as e:
        return error(str(e), _API_STATUS.get(e.kind, 502), e.kind)
    out = lotdsp_api.survey(result, api_map(), cfg, values=request.args.get("values") == "1")
    return jsonify(lot=lot_no, **out)


@bp.post("/api/lots/lotdsp-api/link")
@lotdsp_route
def lot_lotdsp_api_link():
    """調査用: 保存した LotDsp の画面（タブごとの HTML）と、同じロットの API の応答を値で照らし、項目 ↔ 画面の見出し を紐づける。
    body: {files: [{name, html}]}。同じタブをロット違いで2つ以上渡すと絞れる。出力に値は含まない。"""
    payload = _body()
    li, _ = _inputs()
    files = payload.get("files")
    if files is not None and not isinstance(files, list):
        return error("files は並びで送ってください。", 400, "invalid")
    files = [f for f in (files or []) if isinstance(f, dict)]
    if not files:
        return error("画面（保存した HTML）を1つ以上渡してください。", 400, "invalid")
    if len(files) > 40:
        return error("一度に渡せるのは 40 ファイルまでです。", 400, "invalid")
    return jsonify(lotdsp_link.link_files(files, api_map(), lotdsp_api.settings_of(li)))


@bp.get("/lotdsp-link")
@lotdsp_route
def lotdsp_link_page():
    """調査用の画面: 保存した LotDsp の画面を選んで、項目 ↔ 見出し の紐づけを見る。"""
    resp = current_app.make_response(render_template("lotdsp_link.html", app_version=APP_VERSION))
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.get("/api/lots/lotdsp-api/status")
@lotdsp_route
def lot_lotdsp_api_status():
    """API を使えるか（学び終えたか）・まだ決まらない列・ログインなしで応答した最後の記録。"""
    li, _ = _inputs()
    return jsonify(lotdsp_api.status(api_map(), lotdsp_api.settings_of(li)))


@bp.get("/api/lots/fetch-lotdsp/status")
@lotdsp_route
def lot_fetch_lotdsp_status():
    """読んでいる途中の段階（画面のモーダルが 0.5 秒ごとに尋ねる）。{busy, lot, stage, seconds, reused}"""
    return jsonify(lotdsp_direct.status())


@bp.post("/api/lots/fetch-lotdsp/cancel")
@lotdsp_route
def lot_fetch_lotdsp_cancel():
    """モーダルの「中止」。読んでいる途中なら止める。"""
    return jsonify(cancelled=lotdsp_direct.cancel())


@bp.post("/api/calculate")
def calculate():
    try:
        payload = request.get_json(force=True) or {}
        if not payload.get("lot"):
            return error("計算するロット（lot）がありません。", 400)
        return jsonify(calculator().calculate(payload["lot"], payload["inputs"]))
    except Exception as e:
        return exception_error(e)
