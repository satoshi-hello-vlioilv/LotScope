# -*- coding: utf-8 -*-
"""2026-10 アプリのアイコンの案（1 回目 7 案・2 回目 上位 3 案＋複合 4 案）を、アプリと同じ描き方（app/app_icon.py の SDF）で描き、
256〜16px を暗い地・藍の地・明るい地に並べた比べる頁を書き出す（採点は 2026-10-icon.json）。

    python program/tools/ui-proposals/2026-10-icon.py 出力フォルダ

書き出した icon-round1.html・icon-round2.html をブラウザで開いて（撮って）見比べる。選んだ C3 は app/app_icon.py の SHAPES になった。
"""
import base64
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from app import app_icon as A  # noqa: E402

H = A._hex
NAVY, BLUE, TEAL, MINT, AMBER, RED, WHITE, PALE = (H(c) for c in ("#1c3550", "#2b5f79", "#2f7d78", "#7fd3c9", "#e6a52e", "#e0412c", "#ffffff", "#e8f1f4"))
SIZES = (256, 48, 32, 24, 16)


def ring(cx, cy, r, w):
    c = A._circle(cx, cy, r)
    return lambda x, y: abs(c(x, y)) - w


def grad(c0, c1):
    def f(x, y):
        t = A._clamp((x + y) / 2)
        return tuple(c0[i] + (c1[i] - c0[i]) * t for i in range(3))
    return f


def peaks(xs, base, top, w, color):
    pts = [(xs[0] - .16, base)]
    for x in xs:
        pts += [(x - .07, base), (x, top), (x + .07, base)]
    pts.append((xs[-1] + .16, base))
    return [(A._segment(*pts[i], *pts[i + 1], w), color) for i in range(len(pts) - 1)]


TILE = A._rrect(.5, .5, .44, .44, .13)
BG, BG_T, TEAL_BG = (TILE, grad(NAVY, BLUE)), (TILE, grad(H("#16324a"), TEAL)), (TILE, grad(H("#1f4e63"), H("#2f8a80")))
WAVE = [(.14, .62), (.26, .62), (.32, .30), (.38, .62), (.50, .62), (.56, .30), (.62, .62), (.74, .62), (.80, .30), (.86, .62)]
D45 = math.sqrt(.5)

ROUND1 = {
    "I1 ロールが帯に跡を残す": [
        BG_T, (A._rrect(.5, .70, .40, .085, .04), PALE), (A._circle(.33, .40, .215), PALE), (A._circle(.33, .40, .075), NAVY),
        (A._circle(.33, .615, .052), RED), *[(A._circle(x, .70, .05), RED) for x in (.55, .77)],
        (A._segment(.55, .87, .77, .87, .028), AMBER), (A._segment(.55, .83, .55, .91, .028), AMBER), (A._segment(.77, .83, .77, .91, .028), AMBER)],
    "I2 虫めがねで繰り返す点を見る": [
        BG, (A._rrect(.5, .40, .40, .09, .04), PALE), *[(A._circle(x, .40, .045), RED) for x in (.20, .42, .64)],
        (ring(.55, .45, .21, .045), WHITE), (A._segment(.70, .60, .86, .78, .06), AMBER)],
    "I3 コイルの層を貫く跡": [
        BG, (ring(.5, .5, .32, .035), PALE), (ring(.5, .5, .22, .035), PALE), (A._circle(.5, .5, .09), PALE),
        (A._segment(.5, .5, .78, .22, .022), AMBER), *[(A._circle(.5 + r * D45, .5 - r * D45, .055), RED) for r in (.22, .32)]],
    "I4 周期の波形": [
        BG, *[(A._segment(*WAVE[i], *WAVE[i + 1], .035), MINT) for i in range(len(WAVE) - 1)], *[(A._circle(x, .30, .05), RED) for x in (.32, .56, .80)],
        (A._segment(.32, .80, .56, .80, .028), AMBER), (A._segment(.56, .80, .80, .80, .028), AMBER),
        *[(A._segment(x, .76, x, .84, .028), AMBER) for x in (.32, .56, .80)]],
    "I5 一覧の表と異常の印": [
        BG, (A._rrect(.5, .52, .34, .32, .05), PALE), (A._rrect(.5, .27, .34, .07, .04), AMBER),
        *[(A._segment(.30, y, .72, y, .022), H("#9fb2c1")) for y in (.45, .58, .71)], *[(A._circle(.24, y, .04), RED) for y in (.45, .71)]],
    "I6 照準で突き止める": [
        BG_T, (A._rrect(.5, .55, .44, .08, .0), PALE), *[(A._circle(x, .55, .04), RED) for x in (.16, .84)], (ring(.5, .55, .19, .035), AMBER),
        (A._segment(.5, .28, .5, .40, .03), AMBER), (A._segment(.5, .70, .5, .82, .03), AMBER), (A._circle(.5, .55, .06), RED)],
    "I7 輪のロールと帯の跡": [
        BG_T, (A._rrect(.5, .74, .42, .09, .045), PALE), (ring(.36, .40, .20, .05), PALE), (A._circle(.36, .40, .05), PALE),
        (A._circle(.36, .60, .055), RED), *[(A._circle(x, .74, .055), RED) for x in (.36, .62, .86)]],
}
ROUND2 = {
    **{k: v for k, v in ROUND1.items() if k[:2] in ("I4", "I2", "I6")},
    "C1 虫めがねの中に周期の山": [
        BG, *peaks([.30, .52], .56, .30, .032, MINT), *[(A._circle(x, .30, .045), RED) for x in (.30, .52)],
        (ring(.42, .44, .25, .045), WHITE), (A._segment(.60, .62, .82, .84, .065), AMBER)],
    "C2 帯の上に周期の山": [
        BG_T, (A._rrect(.5, .74, .40, .075, .035), PALE), *peaks([.30, .54, .78], .66, .30, .036, MINT),
        *[(A._circle(x, .30, .052), RED) for x in (.30, .54, .78)], (A._segment(.30, .17, .54, .17, .026), AMBER), (A._segment(.54, .17, .78, .17, .026), AMBER)],
    "C3 大きな 3 つの山（青緑の地）": A.SHAPES,        # 選んだ案（アプリのアイコン）
    "C4 照準で山を突き止める": [
        BG, *peaks([.26, .50, .74], .68, .34, .036, MINT), *[(A._circle(x, .34, .045), RED) for x in (.26, .74)],
        (ring(.50, .40, .15, .035), AMBER), (A._circle(.50, .34, .055), RED), (A._segment(.50, .16, .50, .23, .03), AMBER), (A._segment(.50, .57, .50, .62, .03), AMBER)],
}


def render(shapes, size):
    keep = A.SHAPES
    A.SHAPES = shapes
    try:
        return base64.b64encode(A.png(size)).decode()
    finally:
        A.SHAPES = keep


def page(designs):
    tile = []
    for name, shapes in designs.items():
        img = {s: render(shapes, s) for s in SIZES}
        small = "".join(f"<img src='data:image/png;base64,{img[s]}' width={s}>" for s in SIZES[1:])
        tile.append(f"<figure><b>{name}</b><div class=row><img src='data:image/png;base64,{img[256]}' width=160><div>"
                    f"<div class=dark>{small}</div><div class=navy>{small}</div><div class=light>{small}</div></div></div></figure>")
    return ("<!doctype html><meta charset=utf-8><style>body{margin:0;padding:16px;font:14px 'Yu Gothic UI',sans-serif;background:#e9edf2}"
            "main{display:grid;grid-template-columns:repeat(4,420px);gap:14px}figure{margin:0;background:#fff;border-radius:8px;padding:10px}"
            ".row{display:flex;gap:10px}.dark,.navy,.light{padding:6px;border-radius:6px;display:flex;gap:8px;align-items:center;margin-bottom:6px}"
            ".dark{background:#1f2328}.navy{background:#1c3550}.light{background:#f3f3f3}</style><main>" + "".join(tile) + "</main>")


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "icon-proposals")
    out.mkdir(parents=True, exist_ok=True)
    (out / "icon-round1.html").write_text(page(ROUND1), encoding="utf-8")     # 今の絵（I0）は app_icon の前の版（版 3.17.0 まで）
    (out / "icon-round2.html").write_text(page(ROUND2), encoding="utf-8")
    print(f"{out}/icon-round1.html・icon-round2.html を書きました")
