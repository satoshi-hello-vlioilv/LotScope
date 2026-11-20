# -*- coding: utf-8 -*-
"""スケジュール（CM3）の正しい答えを出す係（版 3.96.0。desktop/tests/schedule_parity.rs が呼ぶ）。

  python tests/schedule_oracle.py serve <置き場>     … 作り物の CM3（schedule_fixture.Cm3Server）を起こし、場面ごとに Python の道
                                                      （窓の無い形＝Python が係）で問い合わせの並びを当てた答え・置いた世代と状態のファイル・
                                                      CM3 が受けた要求を JSON の 1 行で書き、標準入力が閉じるまで CM3 を起こしたままにする
                                                      （窓が同じ作り物に問い合わせる。道の頭 /py/・/rs/ で数えを分ける）
  python tests/schedule_oracle.py passive <置き場> <URL> [設定に足す JSON]  … 受け身の Python の係（窓が名乗った形）。標準入力の 1 行ごとに
                                                      「p」で取り直しを頼み（知らせは {"event": "schedule", …} の行で書く）、答えを {"result": …} の行で書く
  python tests/schedule_oracle.py codecs               … CP932・Shift_JIS・CP1252・UTF-8 の 1・2 バイトの全部と、乱れたバイト列の読み、
                                                      charset の名前の引き方の答え（窓の焼いた表とその読み方を Python と比べる）

場面: 届く（一覧・スライサー・集計・データの時刻・再読込・HOT・釜番・仕掛との結合・設備の木・ダッシュボードのパネル・結合した表）・
届かない・黙る・接続の timeout・名前が引けない・断る（500）・30x（302 の GET・301 の絶対の URL・307・ぐるぐる）・chunked と HTTP/1.1・
HTTP/1.0 の閉じるまで・charset（Shift_JIS・cp932・引用符つき・無し・ISO-8859-1）・JSON でない・文字化けと HTML の壊れ方・
答えの形の端（status・entity・errorMessage・年の境・全角の数字・読めない日付・数の値）・中身が変わる（世代）・
Python に任せる形（窓の持たない charset・NaN の答え・https・システムのプロキシ・数でない timeout）。
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import sys
import threading
from datetime import timedelta, timezone
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))

from app import create_app  # noqa: E402
from app.repositories.master_store import MasterStore  # noqa: E402
from tests import fakes_serve, lotlist_fixture, schedule_fixture as fx  # noqa: E402
from tests.equipgroups_oracle import LOGIN, doc, j, perm  # noqa: E402

JST = timezone(timedelta(hours=9))
WINDOWS = os.name == "nt"           # Windows でだけ窓が Python に任せる歩
SCH = "/api/src/sch"


def S(path, query="", method="GET", body="", delegate=False, windows_only=False):
    """windows_only: Windows でだけ窓が任せる歩の印（版 3.115.0。tools/delegate-count.py が Linux でも「Windows だけ」の欄に数える）"""
    st = {"method": method, "path": path, "query": query, "body": body, "delegate": delegate or (windows_only and WINDOWS)}
    if windows_only:
        st["windowsOnly"] = True
    return st


def place(root, cfg_schedule, sources_rows=None, wip=None):
    share, data = root / "share", root / "base" / "data"
    for d in (share, data, root / "local"):
        d.mkdir(parents=True, exist_ok=True)
    (root / "local" / "instance_id").write_text("inst1", encoding="utf-8")
    masters = {"access_permissions": perm(), "equipment_groups": [], "work_log_files": [], "equipment_master": [],
               "data_sources": sources_rows or [], "path_settings": [], "conversions": [], "shift_patterns": []}
    for name, rows in masters.items():
        (share / f"{name}.json").write_text(j(doc(rows)), encoding="utf-8")
    cfg = {"lot_list": {"source": str(root / "無い品質.sqlite3"), "table": ""}, "desktop": {"lotlist_engine": "rust"},
           "identity": {"pc_name": "PC-ORACLE"}, "schedule": cfg_schedule,
           "sources": {"wip": {"source": str(wip), "table": "仕掛"}},
           "master_share": {"dir": str(share), "refresh_seconds": 0}}
    (root / "config.json").write_text(j(cfg), encoding="utf-8")


VIEW = [{"キー": "v1", "表示名": "予定と仕掛", "役割": "その他", "場所": "", "表": "", "設備の列": "", "設備の取り出し方": "", "画面": "有",
         "並び": "", "備考": "", "グループ": "", "元": "sch", "確かめる間隔": "", "古さの警告": "", "ロット番号の列": "", "id": 1, "rev": 1,
         "結合": json.dumps([{"with": "wip", "how": "inner", "on": [["ロットNo", "ﾛｯﾄ番号"]], "cols": ["実績_設備ｺｰｽ"]}], ensure_ascii=False)}]

PANEL = {"id": "t1", "title": "", "visual": "bar", "source": "src:sch",
         "body": {"rows": [{"column": "区分", "part": ""}], "cols": [], "measures": [{"agg": "count"}]}}
BOARD = {"id": "b9", "title": "表", "visual": "board",
         "groups": [{"source": "src:sch", "cols": [{"column": "区分", "part": ""}], "measures": [{"agg": "count"}]},
                    {"source": "src:sch", "cols": [{"column": "材質", "part": ""}], "measures": [{"agg": "count"}]}]}
KPI = {"id": "k1", "title": "", "visual": "kpi", "source": "src:sch", "body": {"rows": [], "cols": [], "measures": [{"agg": "count"}]}}

LIST_STEPS = [S("/api/schedule"), S("/api/schedule/card"), S(SCH, "equip=L-1"), S(SCH, "equip=L-2&page=1&page_size=10"),
              S(f"{SCH}/slicer", "equip=L-1&column=区分"), S(f"{SCH}/pivot", "equip=L-1&fields=1"),
              S(f"{SCH}/source", "equip=L-1"), S(SCH, "equip=__HOT__"), S(f"{SCH}/source", "equip=__HOT__"), S("/api/schedule/card"),
              S("/api/schedule"), S(f"{SCH}/refresh", "equip=L-1", "POST"), S(SCH), S(SCH, "equip=ZZ"), S(f"{SCH}/source", "equip=ZZ"),
              S("/api/dashboard/equip-tree"), S("/api/dashboard/query", method="POST", body=j({"panel": PANEL})),
              S("/api/dashboard/query", method="POST", body=j({"panel": BOARD})), S("/api/dashboard/query", method="POST", body=j({"panel": KPI})),
              S("/api/src/v1"), S("/api/src/v1/source"), S("/api/src/v1/refresh", method="POST"),
              S(SCH, "equip=__HOT__&search=HOT"), S(f"{SCH}/pivot", "equip=__HOT__&fields=1")]
ONE = [S(SCH, "equip=L-1"), S(SCH, "equip=L-1"), S(f"{SCH}/source", "equip=L-1"), S("/api/schedule/card")]
SHAPES = [S(SCH, f"equip={e}") for e in ("S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "SA", "SB")] + \
         [S("/api/schedule/card"), S(f"{SCH}/source", "equip=S9"), S(f"{SCH}/source", "equip=S7")]


def scenes(urls):
    """場面: (名前, 設定の schedule, 歩, データ元の行, この場面の環境変数〈プロキシ。{relay}・{relayhp}・{silent}・{deny} は走る係ごとの作り物〉)"""
    world_port = int(urls["cm3"].rsplit(":", 1)[1])
    blackhole = int(urls["hole"].rsplit(":", 1)[1])
    u = lambda name: f"http://127.0.0.1:{world_port}/{{runner}}/{name}"  # noqa: E731
    t = lambda name, which="tls": f"{urls[which]}/{{runner}}/{name}"  # noqa: E731
    P = {"use_system_proxy": True}
    base = {"equipments": "L-1, L-2, L-3", "timeout_sec": 2, "auto_refresh_sec": 60}
    out = [
        ("届く（一覧・HOT・釜番・結合・設備の木・パネル・結合した表）", {**base, "cm3_base_url": u("ok")}, LIST_STEPS, VIEW),
        ("中身が変わる（世代）", {**base, "cm3_base_url": u("change")},
         [S(SCH, "equip=L-1"), S(f"{SCH}/refresh", "equip=L-1", "POST"), S(f"{SCH}/refresh", "equip=L-1", "POST"),
          S(f"{SCH}/refresh", "equip=L-1", "POST"), S(SCH, "equip=L-1"), S(SCH, "equip=__HOT__"), S(f"{SCH}/refresh", "equip=__HOT__", "POST"),
          S(SCH, "equip=__HOT__")], None),
        # 断られる口: Windows は断られるまで 2 秒ほど取り直すので、timeout は長く（接続の timeout にならないように）
        ("届かない（断られる）", {**base, "timeout_sec": 10, "cm3_base_url": "http://127.0.0.1:1"}, ONE + [S(SCH, "equip=__HOT__"), S("/api/dashboard/equip-tree"),
                                                                                     S(f"{SCH}/refresh", "equip=L-2", "POST")], None),
        ("黙る（読みの timeout）", {**base, "timeout_sec": 1, "cm3_base_url": u("silent")}, ONE[:1] + [S(f"{SCH}/source", "equip=L-1")], None),
        ("接続の timeout", {**base, "timeout_sec": 1, "cm3_base_url": f"http://127.0.0.1:{blackhole}"}, ONE[:1], None),
        ("名前が引けない", {**base, "cm3_base_url": "http://nonexistent.invalid:9085"}, ONE[:1], None),
        ("何も言わずに閉じる", {**base, "cm3_base_url": u("closed")}, ONE[:1], None),
        ("断る（500・404）", {**base, "cm3_base_url": u("e500")}, ONE[:1] + [S("/api/schedule")], None),
        ("404 と理由の空白", {**base, "cm3_base_url": u("e404")}, ONE[:1], None),
        ("JSON でない", {**base, "cm3_base_url": u("nojson")}, ONE[:1], None),
        ("302 → GET の JSON", {**base, "cm3_base_url": u("r302json")}, ONE, None),
        ("302 → HTML", {**base, "cm3_base_url": u("r302html")}, ONE[:1], None),
        ("301 の絶対の URL・chunked", {**base, "cm3_base_url": u("r301abs")}, ONE[:1], None),
        ("303 → 307（GET はたどる）", {**base, "cm3_base_url": u("r303then307")}, ONE[:1], None),
        ("307（POST はたどらない）", {**base, "cm3_base_url": u("r307")}, ONE[:1], None),
        ("30x のぐるぐる", {**base, "cm3_base_url": u("rloop")}, ONE[:1], None),
        ("30x の行き先が無い", {**base, "cm3_base_url": u("rnoloc")}, ONE[:1], None),
        ("chunked・HTTP/1.1", {**base, "cm3_base_url": u("chunk11")}, ONE[:1], None),
        ("HTTP/1.0・閉じるまで", {**base, "cm3_base_url": u("http10")}, ONE[:1], None),
        ("charset=Shift_JIS（～ は 〜）", {**base, "cm3_base_url": u("sjis")}, ONE[:1], None),
        ("charset 無しの CP932", {**base, "cm3_base_url": u("cp932")}, ONE[:1], None),
        ("charset=Windows-31J", {**base, "cm3_base_url": u("winj")}, ONE[:1], None),
        ("引用符つきの charset", {**base, "cm3_base_url": u("quoted")}, ONE[:1], None),
        ("charset=ISO-8859-1（文字化けを戻す）", {**base, "cm3_base_url": u("latin")}, ONE[:1], None),
        ("文字化けと HTML の壊れ方", {**base, "equipments": "L-1", "cm3_base_url": u("html")}, ONE[:1], None),
        ("答えの形の端", {**base, "equipments": "S1 S2 S3 S4 S5 S6 S7 S8 S9 SA SB", "inspect_keywords": "点検板、Y7",
                       "cm3_base_url": u("shapes")}, SHAPES, None),
        # 1970 年より前・3000 年から後の更新時刻（版 3.117.1: 読む範囲を 1970-01-01〜3000-12-31 UTC に決め、範囲の外はどの OS でも「更新時刻なし」。
        # 前は Windows の gmtime_s が受けるかを決められず、Windows では窓が答えず Python に任せた）
        ("1970 年より前・3000 年から後の更新時刻", {**base, "equipments": "SC SD SE", "cm3_base_url": u("shapes")},
         [S(SCH, "equip=SC"), S(SCH, "equip=SD"), S(SCH, "equip=SE")], None),
        ("URL に種類が無い", {**base, "cm3_base_url": "nlmfangyweb1a:9085"}, ONE[:1], None),
        ("URL が決まっていない", {**base, "cm3_base_url": "", "init_path": "", "client_ip": 0}, ONE[:1], None),
        ("設備が無い", {**base, "equipments": "、", "cm3_base_url": u("ok")}, [S(SCH), S("/api/schedule"), S("/api/schedule/card")], None),
        # 版 3.115.0 から窓も答える（前は任せた）: 窓の持たない codec の charset は引けない名前と同じに飛ばす（Python の CODECS）・
        # NaN の答えは「JSON ではありません」・数でない timeout は既定の 15 秒（num_setting）
        ("窓の持たない charset（EUC-JP）", {**base, "cm3_base_url": u("eucjp")}, [S(SCH, "equip=L-1")], None),
        ("NaN の答え", {**base, "cm3_base_url": u("nan")}, [S(SCH, "equip=L-1")], None),
        # 段 ③-6（版 3.117.1）: https とシステムのプロキシも窓が取る（前は Python に任せた）。証明書は tests/fixtures/tls の作り物
        # （試験は SSL_CERT_FILE で作り物の CA を信頼させる）。プロキシは場面の環境変数（use_system_proxy が真のときだけ読む）
        ("https（直）", {**base, "cm3_base_url": t("tls")}, ONE + [S(SCH, "equip=__HOT__")], None),
        ("https の証明書が信頼できない", {**base, "cm3_base_url": t("tlsbad", "tlsbad")}, ONE[:1], None),
        ("https の証明書の名前が違う", {**base, "cm3_base_url": t("tlsname", "tlsname")}, ONE[:1], None),
        ("https で TLS でない口", {**base, "cm3_base_url": urls["plain"]}, ONE[:1], None),
        ("http → https の 302", {**base, "cm3_base_url": u("rtls")}, ONE[:1], None),
        ("https が断られる", {**base, "cm3_base_url": "https://127.0.0.1:1", "timeout_sec": 10}, ONE[:1], None),
        ("プロキシ越しの http", {**base, **P, "cm3_base_url": u("phttp")}, ONE, None, {"http_proxy": "{relay}"}),
        ("プロキシ越しの https（CONNECT）", {**base, **P, "cm3_base_url": t("ptls")}, ONE + [S(SCH, "equip=__HOT__")], None,
         {"https_proxy": "{relay}"}),
        ("プロキシの 利用者:合言葉 は送らない", {**base, **P, "cm3_base_url": u("pcred")}, ONE[:1], None,
         {"http_proxy": "http://user:p%40ss@{relayhp}", "https_proxy": "http://user:pw@{relayhp}"}),
        ("https:// と書いたプロキシは http のプロキシ", {**base, **P, "cm3_base_url": t("phttps")}, ONE[:1], None,
         {"HTTPS_PROXY": "https://{relayhp}"}),
        ("小文字の環境変数が勝つ・空の値は消す", {**base, **P, "cm3_base_url": u("pnone")}, ONE[:1], None,
         {"HTTP_PROXY": "{silent}", "http_proxy": ""}),
        ("no_proxy で直", {**base, **P, "cm3_base_url": u("pbypass")}, ONE[:1], None,
         {"http_proxy": "{silent}", "no_proxy": "example.com, .0.0.1"}),
        ("30x のたびにプロキシを決め直す", {**base, **P, "cm3_base_url": f"http://localhost:{world_port}/{{runner}}/rbyp"}, ONE[:1], None,
         {"http_proxy": "{relay}", "no_proxy": "localhost"}),
        ("use_system_proxy が偽ならプロキシを読まない", {**base, "cm3_base_url": u("pnone2")}, ONE[:1], None, {"http_proxy": "{silent}"}),
        ("黙るプロキシ（http）", {**base, **P, "timeout_sec": 1, "cm3_base_url": u("psil")}, ONE[:1], None, {"http_proxy": "{silent}"}),
        ("黙るプロキシ（https の CONNECT）", {**base, **P, "timeout_sec": 1, "cm3_base_url": t("psil2")}, ONE[:1], None,
         {"https_proxy": "{silent}"}),
        ("CONNECT を断るプロキシ", {**base, **P, "cm3_base_url": t("pdeny")}, ONE[:1], None, {"https_proxy": "{deny}"}),
        ("http を断るプロキシ（403）", {**base, **P, "cm3_base_url": u("pdeny2")}, ONE[:1], None, {"http_proxy": "{deny}"}),
        ("socks のプロキシ", {**base, **P, "cm3_base_url": u("pkind")}, ONE[:1], None, {"http_proxy": "socks4://127.0.0.1:1080"}),
        ("読めないプロキシの URL", {**base, **P, "cm3_base_url": u("pbad")}, ONE[:1], None, {"http_proxy": "http:/x"}),
        ("番号の読めないプロキシ", {**base, **P, "cm3_base_url": u("pbad2")}, ONE[:1], None, {"http_proxy": "http://127.0.0.1:x9"}),
        ("断られるプロキシ", {**base, **P, "timeout_sec": 10, "cm3_base_url": u("pref")}, ONE[:1], None, {"http_proxy": "http://127.0.0.1:1"}),
        # 戻り道（版 3.117.1。配った設定の schedule.fetch_engine が "python"）: 窓は答えず、状態に「係を降りた」を書く（受け身の Python が取る）。
        # 段 ④ まで残す（任せる歩の予算の envExtra に数える）
        ("戻り道（fetch_engine が python）", {**base, "fetch_engine": "python", "cm3_base_url": u("engine")},
         [S(SCH, "equip=L-1", delegate=True), S(f"{SCH}/source", "equip=L-1", delegate=True)], None),
        # 場面の名前を分ける（版 3.115.0。CM3 が受けた要求は場面ごとに比べる。「ok」はシステムのプロキシの場面〈Python だけが取る〉と共にする）
        ("数でない timeout", {**base, "timeout_sec": "abc", "cm3_base_url": u("timeout")}, [S(SCH, "equip=__HOT__")], None),
        # 版 3.115.0 の作った後の直し: timeout の数の端（0・"0"・負・nan・inf・1 ミリ秒未満・1 日を超える数）は 15 秒（cm3_schedule.timeout_of）。
        # PR #115 の Windows の CI の直し: 前の上限「1 年」は 1e7 秒で割れた（poll の無い Windows の Python はミリ秒が INT_MAX を超える
        # timeout を OverflowError で断る。Linux の Python と窓は受けた）。上限を 1 日にし、境の値（下限・上限ちょうどと外・INT_MAX ミリ秒の前後）を
        # どの OS でも Python と窓が同じに答える形で見る。秒そのものは事例の表 tests/fixtures/cm3_timeout_cases.json が両方で見る
        *[(f"timeout が {t!r}", {**base, "timeout_sec": t, "cm3_base_url": u("timeout")}, [S(SCH, "equip=L-1")], None)
          for t in (0, "0", -1, "nan", "inf", "-inf", 1e-9, 0.0009, 86400, "86400", 86401, 86400.001, 2147483, 2147484, 1e7, 1e300,
                    2 ** 63, 10 ** 20)],
    ]
    return out


def proxy_env(env, urls, runner):
    """場面の環境変数の作り物の URL（走る係ごとの中継・黙る・断るプロキシ）"""
    relay = urls[f"relay_{runner}"]
    rep = {"{relay}": relay, "{relayhp}": relay.split("://", 1)[1], "{silent}": urls["silent"], "{deny}": urls["deny"]}
    out = {}
    for k, v in env.items():
        for a, b in rep.items():
            v = v.replace(a, b)
        out[k] = v
    return out


def run(root, steps, runner):
    os.environ["TRANSFER_APP_CONFIG"] = str(root / "config.json")
    os.environ["TRANSFER_LOCAL_ROOT"] = str(root / "local")
    cfg = json.loads((root / "config.json").read_text(encoding="utf-8"))
    store = MasterStore(root / "base", local_root=root / "local", settings=cfg.get("master_share"), who={"pc": "PC-ORACLE", "login": LOGIN})
    app = create_app({"TESTING": True, "MASTER_STORE": store})
    c = app.test_client()
    out = []
    for st in steps:
        path = st["path"] + (f"?{st['query']}" if st["query"] else "")
        try:
            r = c.open(path, method=st["method"], data=st["body"].encode("utf-8"), content_type="application/json")
            try:
                body = r.get_json()
            except Exception:
                body = None
            out.append({**st, "status": r.status_code, "json": body})
        except Exception as e:      # 道の外で落ちた（本番は 500）
            out.append({**st, "status": 500, "json": {"error": f"{type(e).__name__}: {e}"}})
    return out


def files(root):
    """置き場の世代（表の中身）と状態のファイル（書き手の印は rs/py を「w」にそろえる）"""
    import sqlite3
    d = root / "local" / "db_cache" / "schedule"
    out = {}
    for p in sorted(d.glob("*")) if d.exists() else []:
        name = p.name.replace(".py.", ".w.").replace(".rs.", ".w.")
        if p.name.endswith(".sqlite3"):
            c = sqlite3.connect(str(p))
            try:
                t = c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchone()[0]
                cur = c.execute(f'SELECT * FROM "{t}"')
                cols = [x[0] for x in cur.description]
                rows = [[[type(v).__name__, v] for v in r] for r in cur.fetchall()]
            finally:
                c.close()
            out[name] = {"table": t, "cols": cols, "rows": rows}
        elif p.name.endswith(".state.json"):
            out[name] = json.loads(p.read_text(encoding="utf-8"))
    return out


def serve(base):
    logging.disable(logging.WARNING)
    if base.exists():
        shutil.rmtree(base)
    base.mkdir(parents=True)
    wip = base / "LOTNOW.sqlite3"
    lotlist_fixture.make_wip(str(wip), n=400)
    fx.add_kama(wip)
    # 作り物の CM3（場面ごとの答え）と接続を受けない口は、app を import しない台本 tests/fakes_serve.py（種類 schedule＝tests/fakes_schedule.py）が起こす
    # （版 3.117.0。Python 無しの形の窓の試験も同じ台本を起こせる）
    fake = fakes_serve.start("schedule", str(wip))
    srv = fake["srv"]
    urls = fake["urls"]
    # https の作り物の CA を信頼する（窓の試験も同じ SSL_CERT_FILE を置く）。この PC のプロキシは読まない（場面ごとに置く）
    os.environ["SSL_CERT_FILE"] = str(Path(__file__).resolve().parent / "fixtures" / "tls" / "ca.pem")
    for k in list(os.environ):
        if k.lower().endswith("_proxy"):
            del os.environ[k]
    out = []
    for i, sc_def in enumerate(scenes(urls)):
        name, sched, steps, src_rows = sc_def[:4]
        env = sc_def[4] if len(sc_def) > 4 else {}
        py, rs = base / f"s{i}" / "py", base / f"s{i}" / "rs"
        for r, runner in ((py, "py"), (rs, "rs")):
            sc = {k: (v.replace("{runner}", runner) if isinstance(v, str) else v) for k, v in sched.items()}
            place(r, sc, src_rows, wip)
        pe = proxy_env(env, urls, "py")
        os.environ.update(pe)
        try:
            got = run(py, steps, "py")
        finally:
            for k in pe:
                os.environ.pop(k, None)
        scene = sched.get("cm3_base_url", "").split("/")[-1] if "{runner}" in str(sched.get("cm3_base_url")) else ""
        out.append({"name": name, "py": str(py), "rs": str(rs), "scene": scene, "steps": got, "files": files(py),
                    "requests": srv.requests("py", scene) if scene else [], "proxyEnv": proxy_env(env, urls, "rs"),
                    "proxylog": fake["ask"]("proxylog relay_py"),
                    "env": {"base": str(rs / "base"), "program": str(PROGRAM), "local": str(rs / "local"), "config": str(rs / "config.json")}})
    # urls: 作り物の URL（名前つき。cm3・hole）。焼いた表では @URL(名前) にそろえる
    sys.stdout.write(json.dumps({"scenarios": out, "cm3": srv.url, "port": srv.port, "urls": fake["urls"]}, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()
    # 窓が同じ作り物に問い合わせる間は起こしておく。窓の側の要求は「requests rs <場面>」「count rs <場面>」で尋ねられる（作り物の ask）
    for line in sys.stdin:
        if line.split()[:1] in (["requests"], ["count"], ["proxylog"]):
            sys.stdout.write(json.dumps(fake["ask"](line), ensure_ascii=False, default=str) + "\n")
            sys.stdout.flush()
    fake["close"]()


def passive(root, url, extra="{}"):
    """受け身の Python の係（窓が schedule を名乗った形）。p で取り直しを頼み、窓が状態を書くのを待つ。
    extra: 設定に足す項目（JSON。use_system_proxy なら、この試験の環境のプロキシは外す＝作り物の CM3 に直に届く）"""
    from app.services import schedule
    more = json.loads(extra)
    if more.get("use_system_proxy"):
        for k in list(os.environ):
            if k.lower().endswith("_proxy"):
                del os.environ[k]
    lock = threading.Lock()

    def say(v):
        with lock:
            sys.stdout.write(json.dumps(v, ensure_ascii=False, default=str) + "\n")
            sys.stdout.flush()
    s = schedule.Schedules(Path(root), passive=True, notify=lambda **kw: say({"event": "schedule", **kw}))
    cfg = schedule.config({"schedule": {"cm3_base_url": url, "equipments": "L-1, L-2, L-3", "timeout_sec": 2, "auto_refresh_sec": 60, **more}})
    say({"ready": True})
    for line in sys.stdin:
        if line.strip() != "p":
            continue
        try:
            st = s.ensure(cfg, "L-1", max_age=0, force=True)
            say({"result": {"path": st.get("path"), "error": st.get("error", "")}})
        except Exception as e:
            say({"result": {"error": f"{type(e).__name__}: {e}"}})


def codecs_answer():
    """字の読みの全部（窓の焼いた表の読み方と比べる）"""
    import codecs
    import random
    out = {}
    for enc in ("cp932", "shift_jis", "cp1252"):
        one = []
        for b in range(256):
            try:
                one.append(bytes([b]).decode(enc))
            except UnicodeDecodeError:
                one.append(None)
        two = {}
        if enc != "cp1252":
            for lead in range(0x80, 0x100):
                row = []
                for t in range(0x100):
                    try:
                        row.append(bytes([lead, t]).decode(enc))
                    except UnicodeDecodeError:
                        row.append(None)
                two[f"{lead:02X}"] = row
        out[enc] = {"one": one, "two": two}
    r = random.Random(3)
    samples = [bytes(r.randrange(256) for _ in range(r.randrange(1, 12))) for _ in range(4000)]
    samples += [b"\xe3\x81", b"\xf0\x9f\x98", b"\xed\xa0\x80", b"\xc0\xaf", b"a\xffb\xfe", b"\xe3\x81\x82\xe3"]
    out["utf8"] = [[s.hex(), (lambda: s.decode("utf-8"))() if _ok(s) else None, s.decode("utf-8", errors="replace")] for s in samples]
    names = ["UTF-8", "utf8", "u8", "Shift_JIS", "SJIS", "x-sjis", "MS932", "Windows-31J", "cp-932", "CP932", "ISO-8859-1", "latin1",
             "L1", "US-ASCII", "ascii", "EUC-JP", "utf-16", "utf_8_sig", "utf--8", "_utf8", "utf8_", "Ütf8", "utf_é8", "ksc5601", "koi8-r",
             "ShiftJIS", "s_jis", "ISO_8859_1", "8859", "iso-2022-jp", "windows-1252", "cp1252", "big5", "x"]
    lk = {}
    for n in names:
        try:
            lk[n] = codecs.lookup(n).name
        except LookupError:
            lk[n] = None
    out["lookup"] = lk
    import re
    cts = ["application/json;charset=UTF-8", "text/html; Charset=Shift_JIS", "a; charset=;charset=euc-jp", 'x; charset="utf-8"',
           "charset=ÿé-x", "CHARSET=utf_8 ;", "charset", "", "a;charset=µx"]
    out["charset"] = {c: (m.group(1) if (m := re.search(r"charset=([\w\-]+)", c, re.I)) else None) for c in cts}
    return out


def _ok(s):
    try:
        s.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def main():
    mode = sys.argv[1]
    if mode == "serve":
        serve(Path(sys.argv[2]))
    elif mode == "passive":
        passive(sys.argv[2], sys.argv[3], *sys.argv[4:5])
    elif mode == "codecs":
        sys.stdout.write(json.dumps(codecs_answer(), ensure_ascii=False))


if __name__ == "__main__":
    main()
