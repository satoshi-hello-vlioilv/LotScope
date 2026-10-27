# -*- coding: utf-8 -*-
"""スケジュール（CM3 の作業予定）の作り物（試験・開発用サーバー・撮影。版 3.57.0）。

本物で確かめた形（ScheduleView の program/docs/CM3_API_spec.md）をなぞる:
  日付の付く行（"10/03 08:12"）と時刻だけの行（"     08:40"）・日付の繰り上がり（時刻だけの行が前より早い＝翌日）・
  同じロットの 2 パス・設備停止の行（停止名を左の項目から決まった幅で切って入れ、長さ「7分」を別の項目に）・点検板・
  文字化け（UTF-8 を Latin-1 で読んだ字）・HTML の文字参照（&#12288;）・仕掛に無いロット・前工程が HOT のロット。
ロットは仕掛の作り物（lotlist_fixture.make_wip）から、残仕掛設備ｺｰｽ の先頭がその設備の物を選ぶ（突き合わせが当たる）。
乱数の種は固定（何度作っても同じ物）。
"""
from __future__ import annotations

import json
import random
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

JST = timezone(timedelta(hours=9))
EQUIPMENTS = ("L-1", "L-2", "L-3")
STOPS = [("ワークロール交換計画", "7分"), ("定期点検（油圧）", "30分"), ("段取り替え", "15分")]


def _mojibake(s):
    """UTF-8 のバイトを Latin-1 で読んだ字（CM3 の古い画面で起きる文字化け）。"""
    return s.encode("utf-8").decode("latin-1")


def wip_lots(wip_path):
    """仕掛の作り物 → [(ロット番号, 実績_設備ｺｰｽ, 残仕掛設備ｺｰｽ)]"""
    c = sqlite3.connect(str(wip_path))
    try:
        cols = [r[1] for r in c.execute("PRAGMA table_info(仕掛)")]
        lot = "ロット番号" if "ロット番号" in cols else "ﾛｯﾄ番号"
        return [tuple(r) for r in c.execute(f"SELECT [{lot}], [実績_設備ｺｰｽ], [残仕掛設備ｺｰｽ] FROM 仕掛")]
    finally:
        c.close()


def add_kama(wip_path):
    """仕掛の作り物に釜番の列（設計_PIT炉番炉順）を足す（ほかの列・値は変えない。値は行の番号で決める: 4 本ずつ同じ釜）。"""
    c = sqlite3.connect(str(wip_path))
    try:
        cols = [r[1] for r in c.execute("PRAGMA table_info(仕掛)")]
        if "設計_PIT炉番炉順" not in cols:
            c.execute("ALTER TABLE 仕掛 ADD COLUMN [設計_PIT炉番炉順]")
            c.execute("UPDATE 仕掛 SET [設計_PIT炉番炉順] = 'P' || ((rowid / 4) % 9 + 1) || '-' || printf('%02d', (rowid / 4) % 23 + 1)")
            c.commit()
    finally:
        c.close()


def _row(kanryo, **kw):
    base = {"kanryoYotei": kanryo, "roll": "", "lotNo": "", "zaishitsu": "", "inItaAtsu": "", "outItaAtsu": "", "reienHaba": "",
            "seihinItaAtsu": "", "seihinItaHaba": "", "keijo": "", "yotoMei": "", "yotoMeiFull": "", "jiKotei": "",
            "rowStyle": "cmschview-data-white", "teisiStyle": None}
    base.update(kw)
    return base


def schedule_rows(eq, lots, start, seed):
    """1 設備の予定の行（CM3 の meisaiList の形）。start: 最初の行の完了予定（現場の時刻）。"""
    r = random.Random(seed)
    t, prev_day, out, rolled = start, None, [], False

    def stamp(dt):
        # 日付は最初の行・9 行ごと・日替わりに付く。ただし最初の日替わりは時刻だけ（前の行より早い時刻＝翌日と読む所を試す）
        nonlocal prev_day, rolled
        day = (dt.month, dt.day)
        dated = prev_day is None or len(out) % 9 == 0 or (day != prev_day and rolled)
        if day != prev_day and prev_day is not None and not rolled:
            rolled, dated = True, False
        prev_day = day
        return f"{dt.month:02d}/{dt.day:02d} {dt.hour:02d}:{dt.minute:02d}" if dated else f"     {dt.hour:02d}:{dt.minute:02d}"

    mine = [x for x in lots if str(x[2] or "").split()[:1] == [eq]]
    if len(mine) < 40:                              # 仕掛の作り物に少ない設備（L-3）は、ほかのロットで埋める（次の設備は違うが突き合わせは当たる）
        mine += [x for x in lots if x not in mine][: 40 - len(mine)]
    hot = [x for x in mine if str(x[1] or "").split()[-1:] == ["HOT"]]
    others = [x for x in mine if x not in hot]
    picks = hot[:6] + others[: 40 - min(6, len(hot))]
    r.shuffle(picks)
    picks.insert(5, ("Z9999X0", "", ""))            # 仕掛に無いロット
    style = 0
    for i, (lot, _res, rem) in enumerate(picks):
        if i in (7, 21):                           # 設備停止（停止名は左の項目から 4 文字ずつ切って入る）
            name, dur = STOPS[(i // 7) % len(STOPS)]
            t += timedelta(minutes=int(dur.rstrip("分")))
            out.append(_row(stamp(t), roll=name[:4], lotNo=name[4:9], zaishitsu=name[9:], inItaAtsu=dur,
                            rowStyle="cmschview-data-white", teisiStyle="cmschview-teisi"))
            continue
        if i == 12:                                 # 点検板（圧延するが点検用）
            t += timedelta(minutes=9)
            out.append(_row(stamp(t), lotNo="点検板", zaishitsu="A1100", inItaAtsu="1.200", outItaAtsu="1.000", reienHaba="1000",
                            seihinItaAtsu="1.000", seihinItaHaba="1000", keijo="C", yotoMei="点検板", jiKotei=""))
        passes = 2 if i % 11 == 3 else 1
        th_in = r.choice([2.6, 1.8, 1.2, 0.9, 0.6])
        width = r.choice([1040, 1250, 1270, 1525])
        nxt = (str(rem or "").split()[1:2] or [""])[0]
        yoto = r.choice(["缶材", "一般用材", "箔地"])
        for p in range(passes):
            t += timedelta(minutes=r.randint(14, 34))   # 1 設備で 20 時間ほど（日を跨ぐ）
            th_out = round(th_in * r.uniform(0.55, 0.8), 3)
            out.append(_row(stamp(t), lotNo=lot, zaishitsu=r.choice(["A1100", "A5052", "A3004"]), inItaAtsu=f"{th_in:.3f}",
                            outItaAtsu=f"{th_out:.3f}", reienHaba=str(width), seihinItaAtsu=f"{th_out:.3f}", seihinItaHaba=str(width - 10),
                            keijo=r.choice(["C", "S"]), jiKotei=eq if p + 1 < passes else nxt,
                            yotoMei=_mojibake(yoto) if i == 9 else ("缶&#12288;材" if i == 10 else yoto),
                            rowStyle="cmschview-data-palegreen" if style % 2 else "cmschview-data-white"))
            th_in = th_out
        style += 1
    return out


def responses(wip_path, update=None, equipments=EQUIPMENTS):
    """設備ごとの CM3 の答え（{設備: dict}）。update: CM3 の更新の時刻（既定 2026/10/03 08:05 現場の時刻）。"""
    update = update or datetime(2026, 10, 3, 8, 5, tzinfo=JST)
    lots = wip_lots(wip_path)
    out = {}
    for k, eq in enumerate(equipments):
        rows = schedule_rows(eq, lots, update + timedelta(minutes=7 + 3 * k), 20261003 + k)
        out[eq] = {"status": "SUCCESS", "entity": {"setsubiName": eq, "termKbn": "4", "updateTs": int(update.timestamp() * 1000),
                                                   "error": False, "errorMessage": "", "meisaiList": rows}}
    return out


def serve(answers, port=0):
    """作り物の CM3（init だけ）を起こす → (サーバー, URL)。要求の setsubiName の答えを返す。知らない設備は 404。
    answers は後から差し替えられる（dict の中身を変えると次の問い合わせから効く）。"""
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 (http.server の決まりの名前)
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            try:
                eq = json.loads(body.decode("utf-8")).get("setsubiName") or ""
            except ValueError:
                eq = ""
            got = answers.get(eq)
            if got is None or "/init" not in self.path:
                self.send_response(404)
                self.end_headers()
                return
            data = json.dumps(got, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json;charset=UTF-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"
