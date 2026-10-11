# -*- coding: utf-8 -*-
"""アプリのアイコン（exe・窓・タスクバー）を描く。標準ライブラリだけで書く（作るとき desktop/build.rs が呼ぶ）。

絵（版 3.18.0〜）: 青緑の地に、同じ間隔で立つ 3 つの山（周期の欠陥の信号）と、山の頭の赤い点（欠陥）、その間隔を示すアンバーの寸法線。
「繰り返す欠陥の間隔（ピッチ）からロールを突き止める」というアプリの仕事を、波形で表す。地は青緑（画面の「効いている」の色）にして、
藍の見出し・起動画面の藍の地・タスクバーの暗い地の上でも埋もれないようにした。
決め方: 7 案（ロールと帯・虫めがね・コイルの層・周期の波形・一覧の表・照準・輪のロール）を 256〜16px・暗い地と明るい地で描いて採点し、
1 位でも 80 点に届かなかったので、上位 3 案と複合 4 案で 2 回目を採点して選んだ（program/tools/ui-proposals/2026-10-icon.py・.json）。
版 3.17.0 までの絵（藍の地に寸法線と 3 つの点）は、寝台のようにも見え、藍の地の上で埋もれた。

形は「中心からの距離」（SDF）で書き、縁は 1px の幅でぼかす（どの大きさでも同じ式で描け、縮めて潰れない）。
"""
from __future__ import annotations

import math
import struct
import zlib

SIZES = (16, 20, 24, 32, 40, 48, 64, 256)      # .ico に入れる大きさ（Windows が表示の倍率で選ぶ）


def _hex(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))


TEAL0, TEAL1, PALE, RED, AMBER = _hex("#1f4e63"), _hex("#2f8a80"), _hex("#e8f1f4"), _hex("#e0412c"), _hex("#e6a52e")


def _clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def _rrect(cx, cy, hw, hh, r):
    def d(x, y):
        qx, qy = abs(x - cx) - hw + r, abs(y - cy) - hh + r
        return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r
    return d


def _circle(cx, cy, r):
    return lambda x, y: math.hypot(x - cx, y - cy) - r


def _segment(ax, ay, bx, by, r):
    dx, dy = bx - ax, by - ay
    ll = dx * dx + dy * dy

    def d(x, y):
        h = _clamp(((x - ax) * dx + (y - ay) * dy) / ll)
        return math.hypot(x - ax - dx * h, y - ay - dy * h) - r
    return d


def _ground(x, y):
    t = _clamp((x + y) / 2)
    return tuple(TEAL0[i] + (TEAL1[i] - TEAL0[i]) * t for i in range(3))


def _peaks(xs, base, top, r):
    """同じ間隔の山（xs が山の頭）を線でつなぐ。→ 線分の並び"""
    pts = [(xs[0] - .16, base)]
    for x in xs:
        pts += [(x - .07, base), (x, top), (x + .07, base)]
    pts.append((xs[-1] + .16, base))
    return [(_segment(*pts[i], *pts[i + 1], r), PALE) for i in range(len(pts) - 1)]


# 描く順（後ろほど上）。座標は 0〜1。山の頭（PEAKS）・頭の高さ（TOP）・寸法線の高さ（BAR）は試験 test_app_icon も見る。
# 細い寸法線（太さ約 1/14）は 16px の画素の中心（3.5/16）に置く。画素の境に置くと 16px で 2 画素に割れて濁り、アンバーに見えない
PEAKS, TOP, BAR = (.28, .50, .72), .37, 3.5 / 16
SHAPES = [
    (_rrect(.5, .5, .44, .44, .13), _ground),
    *_peaks(PEAKS, .76, TOP, .045),
    *[(_circle(x, TOP, .062), RED) for x in PEAKS],
    (_segment(PEAKS[0], BAR, PEAKS[-1], BAR, .035), AMBER),
    *[(_segment(x, BAR - .045, x, BAR + .045, .035), AMBER) for x in (PEAKS[0], PEAKS[-1])],
]


def rgba(size: int) -> list[bytes]:
    """size×size の RGBA（行ごと）。"""
    px, rows = 1.0 / size, []
    for j in range(size):
        y, row = (j + .5) / size, bytearray()
        for i in range(size):
            x, r, g, b, a = (i + .5) / size, 0.0, 0.0, 0.0, 0.0
            for dist, color in SHAPES:
                cov = _clamp(.5 - dist(x, y) / px)
                if cov <= 0:
                    continue
                c = color(x, y) if callable(color) else color
                r, g, b, a = c[0] * cov + r * (1 - cov), c[1] * cov + g * (1 - cov), c[2] * cov + b * (1 - cov), cov + a * (1 - cov)
            row += bytes((round(_clamp(r / a) * 255), round(_clamp(g / a) * 255), round(_clamp(b / a) * 255), round(a * 255))) if a else b"\0\0\0\0"
        rows.append(bytes(row))
    return rows


def png(size: int) -> bytes:
    rows = rgba(size)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    raw = b"".join(b"\0" + r for r in rows)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def build() -> bytes:
    """.ico（中身は大きさごとの PNG。Windows Vista 以降が読む形）。"""
    images = [png(s) for s in SIZES]
    head = struct.pack("<HHH", 0, 1, len(images))
    offset, entries = 6 + 16 * len(images), b""
    for s, data in zip(SIZES, images):
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return head + entries + b"".join(images)
