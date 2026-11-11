"""ダッシュボードのパネルの問い合わせが、いまどの段にいるか（版 3.97.0。窓の desktop/src/progress.rs と同じ形）。

画面はパネルの問い合わせ POST /api/dashboard/query?ask=<印> に印を付け、待っている間だけ GET /api/dashboard/progress?ask=a,b,… で段を尋ねる。
デスクトップ版は窓が自分の覚えから答える（窓が Python に任せた問い合わせは「python」と経過だけ）。ここは Python だけで動かすとき
（開発用サーバー・窓の無い形）の同じ道。段は問い合わせの糸が書く（糸ごとの「いまの印」に書くので、数える関数の引数は変えない）。

段（stage）と n/of（円の量と字の n/m は同じこの数から出す）: plan・copy（写した設備 n / of）・read（読み終えたファイル n / of）・count・
gantt（組み終えた設備 n / of）・abc（品種を並べる）・python・queue（Python はパネルを 1 つずつ数えるので、ほかのパネルの集計が済むのを待っている。窓は並べて数えるので使わない）。group … 合わせた表のまとまり・合わせるのデータ k / m 済み。
前回の時間は組み（送られた本文）ごとに、数えた時（控えに当たらなかった時）だけ覚える。
前回と比べる時間（countMs）と覚える時間は、数えている段（read・count・gantt・abc）にいた時間だけを足した物。写しを待つ・準備・
順番待ち（queue）の間は入れない（作った後の採点: 順番を待っているだけのパネルに「前回より長くかかっています」が出た）。
"""
import hashlib
import re
import threading
import time

KEEP_SEC = 600
MAX_ASKS = 512
MAX_TOOK = 2048
_ASK = re.compile(r"[A-Za-z0-9._-]{1,80}")

_lock = threading.Lock()
_asks = {}
_took = {}
_local = threading.local()
COUNTING = ("read", "count", "gantt", "abc")


def counting(stage):
    return stage in COUNTING


def _count_ms(e, now):
    return e["count_ms"] + (int((now - e["stage_at"]) * 1000) if not e["done"] and counting(e["stage"]) else 0)


def valid_ask(a):
    return isinstance(a, str) and bool(_ASK.fullmatch(a))


def _key(body):
    return hashlib.sha1(body or b"").hexdigest()


def _prune():
    now = time.monotonic()
    for k in [k for k, e in _asks.items() if now - e["started"] >= KEEP_SEC]:
        del _asks[k]
    while len(_asks) >= MAX_ASKS:
        del _asks[min(_asks, key=lambda k: _asks[k]["started"])]


def begin(ask, body):
    """問い合わせを始める（印の段を作り、この糸の「いまの印」にする）。印が無い・読めなければ None"""
    if not valid_ask(ask):
        _local.cur = None
        return None
    key = _key(body)
    with _lock:
        _prune()
        now = time.monotonic()
        _asks[ask] = {"started": now, "stage": "plan", "n": 0, "of": 0, "group": None, "stage_at": now, "count_ms": 0,
                      "prev": _took.get(key), "done": False, "counted": False, "key": key}
    _local.cur = ask
    return ask


def finish(ask):
    """答え終えた: 段を済みに。数えた時だけ、かかった時間を前回として覚える"""
    _local.cur = None
    if not ask:
        return
    with _lock:
        e = _asks.get(ask)
        if e is None:
            return
        now = time.monotonic()
        e["count_ms"], e["stage_at"] = _count_ms(e, now), now
        e["done"] = True
        if e["counted"]:
            if len(_took) >= MAX_TOOK and e["key"] not in _took:
                _took.clear()
            _took[e["key"]] = e["count_ms"]


def _edit(**kw):
    ask = getattr(_local, "cur", None)
    if not ask:
        return
    with _lock:
        e = _asks.get(ask)
        if e is not None:
            e.update(kw)


def step(stage, n=0, of=0):
    ask = getattr(_local, "cur", None)
    if not ask:
        return
    with _lock:
        e = _asks.get(ask)
        if e is None:
            return
        if e["stage"] != stage:
            now = time.monotonic()
            e["count_ms"], e["stage_at"] = _count_ms(e, now), now
        e.update(stage=stage, n=n, of=of)


def group(k, m):
    _edit(group=(k, m))


def counted():
    _edit(counted=True)


def answer(asks):
    """尋ねられた印の段（知らない印は返さない）"""
    out = {}
    with _lock:
        now = time.monotonic()
        for a in [x for x in asks if valid_ask(x)][:64]:
            e = _asks.get(a)
            if e is None:
                continue
            v = {"stage": e["stage"], "elapsedMs": int((now - e["started"]) * 1000), "countMs": _count_ms(e, now), "prevMs": e["prev"], "done": e["done"]}
            if e["of"] > 0:
                v["n"], v["of"] = min(e["n"], e["of"]), e["of"]
            if e["group"]:
                v["group"] = [min(*e["group"]), e["group"][1]]
            out[a] = v
    return {"asks": out}
