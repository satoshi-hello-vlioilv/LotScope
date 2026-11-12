"""突き合わせの答えの元（*_oracle.py）が共にする、窓が答えるようになった任せる歩の分け方（版 3.104.0。Rust 化の段 ① の A・B）。

前は窓が答えずに Python に任せていた歩（場面の "delegates"）のうち、窓が答えるようになった物を、窓が答える歩（"steps"）の後ろへ移す:
- 本文の門が断る歩（services/body_rules.py の決まり。窓の src/body.rs は同じ表〈desktop/src/body_routes.json〉・同じ順で同じ言葉を答える。
  ?engine=python は窓が門を当てずに Python に任せる）
- W() で印を付けた歩（int() の部品〈pyfmt::py_int_of〉で窓が読むようになった字・全角の id の道・整数の -0 など。場面を書いた所で 1 つずつ印を付ける）
移した歩は、窓と Python の両方で、窓が答える歩と同じ写し（py・rs）に当たる（答え・断る言葉・ファイルを突き合わせる）。
"""
import logging

from app.services import body_rules

_APP = None


def _app():
    global _APP
    if _APP is None:
        level = logging.root.manager.disable
        logging.disable(logging.CRITICAL)
        from app import create_app
        _APP = create_app({"TESTING": True})
        logging.disable(level)
    return _APP


def W(step):
    """版 3.104.0 から窓が答える任せる歩（本文の門のほかの理由で）の印"""
    return {**step, "window": True}


def gate_refuses(step):
    """本文の門が断る歩か（Python の routes/common.body_gate と同じ当て方）"""
    if "engine=python" in (step.get("query") or ""):
        return False
    method, path = step.get("method"), step.get("path")
    if not method or not path:
        return False
    from urllib.parse import unquote
    rule = _app().rule_for(method, unquote(path))
    mode = body_rules.mode_of(method, rule.pattern) if rule else None
    if mode is None:
        return False
    body = step.get("body")
    try:
        body_rules.read_body((body or "").encode("utf-8") if isinstance(body, str) or body is None else body, body_rules.rules_of(mode))
    except body_rules.BodyError:
        return True
    return False


def answered(step):
    return isinstance(step, dict) and (step.get("window") is True or gate_refuses(step))


def split(steps, delegates):
    """(窓が答える歩〈前の steps ＋ 移した歩〉, まだ Python に任せる歩)"""
    moved = [x for x in delegates if answered(x)]
    rest = [x for x in delegates if not answered(x)]
    return list(steps) + moved, rest


def seq(steps, delegates):
    """前の形（steps の後ろに delegate=True の歩を並べた 1 本）"""
    s, d = split(steps, delegates)
    return s + [dict(x, delegate=True) for x in d]
