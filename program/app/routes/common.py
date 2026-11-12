# -*- coding: utf-8 -*-
"""ルートが共通で使う部品（Blueprint・マスタの窓口・失敗の返し方・この PC の名乗りと権限）。"""
import time

from ..web import Blueprint, current_app, jsonify, request

import app_env

from .. import effective_settings
from ..repositories.master_repository import MasterRepository
from ..repositories.master_store import MasterError
from ..services import access, body_rules, identity, lotdsp_api, presence
from ..services.calculator import Calculator

bp = Blueprint("main", __name__)


def master_repo():
    return MasterRepository(current_app.config["MASTER_STORE"])


def calculator():
    return Calculator(current_app.config["APP_SETTINGS"], master_repo())


def api_settings():
    """LotDsp の API の設定（参照先マスタで変えた値を重ねる）。"""
    return lotdsp_api.settings_of(effective_settings(current_app).get("lotdsp_import"))


def api_map():
    """LotDsp の API の項目名の対応（この PC の作業場所。アプリで1つ）。
    窓が LotDsp を受け持つとき（shell_serves に lotdsp。版 3.98.0）、書き手は窓の 1 つ: 尋ねるたびにファイルから読む（古い学びを見せない）"""
    from .. import shell_serves
    if "lotdsp" in shell_serves() and current_app.config.get("LOTDSP_API_MAP") is None:
        return lotdsp_api.KeyMap(app_env.local_root() / "lotdsp_api_map.json")
    km = current_app.config.get("LOTDSP_API_MAP")
    if km is None:
        km = current_app.config["LOTDSP_API_MAP"] = lotdsp_api.KeyMap(app_env.local_root() / "lotdsp_api_map.json")
    return km


def error(message, status, kind=None, **extra):
    """画面が読める失敗の形 {error, kind?, ...}。kind は画面が理由を見分けるための短い名前。"""
    body = {"error": message, **({"kind": kind} if kind else {}), **extra}
    return jsonify(body), status


def exception_error(e, status=400, **extra):
    """思いがけない失敗（例外の種類も返す。画面は error を出す）。"""
    return error(str(e), status, type=type(e).__name__, **extra)


class Forbidden(MasterError):
    """権限の決まり（services/access.py）で断る。"""
    kind, status = "forbidden", 403


def body_gate():
    """本文の門（版 3.104.0。services/body_rules.py）: 門を当てる道（ROUTES）なら、道の前に本文を 1 つの読み方で読む。
    読めない本文（UTF-8・JSON・入れ子・NaN・対の無い代用字・表でない・本文が要る道の空）は 400 {error, kind: body} で断る。
    門番（routes/access._access_guard）より先に見る（窓〈desktop/src/body.rs・Lot::handle_body〉も同じ順）"""
    rule = current_app.rule_for(request.method, request.path)
    mode = body_rules.mode_of(request.method, rule.pattern) if rule else None
    if mode is None:
        return None
    try:
        value = body_rules.read_body(request.data, body_rules.rules_of(mode))
    except body_rules.BodyError as e:
        return error(str(e), e.status, e.kind)
    request.gated, request.gated_body = True, value
    return None


def req_body_value():
    """門が読んだ本文の値（空は None。偽の値〈[]・0 など〉もそのまま）。門を当てない道では、読めない本文を None と読む"""
    return request.get_json(force=True, silent=True)


def req_body():
    """門が読んだ本文の表（空・偽の値は {}）。書く道の本文はこれで読む（版 3.104.0。前は道ごとに get_json の silent の有無が違った）"""
    return req_body_value() or {}


def base_rev():
    """画面が開いたときの行の版（無ければ確かめない）。PUT は本文の base_rev、DELETE は ?rev=。
    本文は門（body_gate）が読んだ物（表でない本文は門が断る。版 3.104.0。前はここで TypeError の 500）"""
    v = req_body().get("base_rev", request.args.get("rev"))
    try:
        return None if v in (None, "") else int(v)
    except (TypeError, ValueError):
        return None


def master_call(fn, ok_status=200):
    """マスタの読み書きの失敗を、画面が読める形（kind と理由）で返す。"""
    try:
        return jsonify(fn()), ok_status
    except MasterError as e:
        return jsonify(e.payload()), e.status
    except Exception as e:
        return exception_error(e, kind="error")


def find_row(rows, item_id):
    return next((r for r in rows if r.get("id") == item_id), None)


# ---------------- この PC の名乗りと権限（services/access.py が答える。ここは渡すだけ） ----------------
_REVOKE_CACHE = {"at": 0.0, "key": "", "value": None}


ME_HEADER = "X-TPA-Me"     # 窓（desktop/src/access.rs）が決めた me（版 3.65.0。窓は画面から来た同じ名前の見出しを捨ててから載せる）


def me():
    """この PC・このログインの名乗りと権限。{login, pc, pcSource, key, rows, flags, caps, revoked}
    デスクトップ版で窓が権限を受け持つとき（shell_serves に access）は、窓が決めて問い合わせに載せた me を使う（判定は窓の 1 か所）"""
    shell = _shell_me()
    if shell is not None:
        return shell
    who = identity.current()
    rows = master_repo().access_permissions()
    f = access.flags(rows, who["login"], who["pc"])
    row = next((r for r in rows if f["matchedId"] is not None and r.get("id") == f["matchedId"]), None)
    try:
        f["hiddenTabs"] = access.hidden_tabs(master_repo().tab_access(), row, f["role"])
    except Exception:          # タブの権限を読めないときは出す（止めない。マスタの共有に届かないときと同じ）
        f["hiddenTabs"] = []
    key = presence.terminal_key(who["login"], who["pc"])
    # 切断の指示は 5 秒だけ覚える（読めなければ切断されていないものとして続ける＝止めない）
    now = time.monotonic()
    if _REVOKE_CACHE["key"] != key or now - _REVOKE_CACHE["at"] > 5:
        try:
            _REVOKE_CACHE.update(value=presence.revocation(key))
        except Exception:
            _REVOKE_CACHE.update(value=None)
        _REVOKE_CACHE.update(at=now, key=key)
    return {**who, "key": key, "rows": rows, "flags": f, "caps": access.capabilities(f), "revoked": _REVOKE_CACHE["value"]}


def _shell_me():
    from .. import shell_serves
    if "access" not in shell_serves():
        return None
    try:
        raw = request.headers.get(ME_HEADER)
    except RuntimeError:                 # 問い合わせの外（起動・裏の糸）
        return None
    if not raw:
        return None
    import json
    try:
        m = json.loads(raw)
    except ValueError:
        return None
    return m if isinstance(m, dict) and isinstance(m.get("flags"), dict) else None


def roles_from(rows):
    """(ログインID, PC名) の組 → 登録上の区分、を答える関数（読み終えた権限の行を使う。表を何度も読みに行かない）。"""
    return lambda pairs: access.registered_roles(rows, pairs)


def can_write(name):
    """この PC・このログインが、マスタ name を書けるか（画面がボタンを出すかを決める。書くときは門番 routes/access.py も確かめる）。"""
    try:
        m = me()
    except Exception:
        return False
    return not m["revoked"] and access.master_edit_can(m["flags"]["masterEdit"], "write", access.master_scope(name))


_TAB_CACHE = {"key": None, "at": 0.0, "value": ()}


def tab_denied(tab, name=""):
    """その PC・そのログインに出さないタブなら、断る答え（版 3.58.0。一覧・集計・ダッシュボードのパネルの問い合わせ）。出すなら None。
    ダッシュボードは 1 回に何十も問い合わせるので、答えを 2 秒だけ覚える。"""
    who = identity.current()
    key = (who["login"], who["pc"])
    now = time.monotonic()
    if _TAB_CACHE["key"] != key or now - _TAB_CACHE["at"] > 2:
        try:
            hidden = tuple(me()["flags"]["hiddenTabs"])
        except Exception:
            hidden = ()
        _TAB_CACHE.update(key=key, at=now, value=hidden)
    if tab not in _TAB_CACHE["value"]:
        return None
    return error(f"「{name or tab}」を見る権限がありません（アクセス権限のタブの決まり）。必要なら管理する人に頼んでください。", 403, "forbidden")


def forget_tab_cache():
    _TAB_CACHE.update(key=None)
