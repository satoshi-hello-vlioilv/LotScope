"""Python の部品を Rust へ移す順を決めるための評価関数（版 3.58.1。開発用）。

Python に残っている部品（program/app）を「移す単位」ごとに測り、表にする。文章の見立てではなく、数で順を決めるため。

    python tools/rust-port-bench.py [--quality 20000] [--work-rows 2000] [--wip 20000] [--repeat 5] [--json 出力.json] [--static-only]

測る物:
  1. 棚卸し（読むだけ）: モジュールごとの行数（空行・注釈を除く）・中で使う app の部品（import）・試験の数（そのモジュールを読む試験ファイルの test_*）・
     使う標準の部品と、Rust で代わりに要る crate（Cargo.toml に有る物は「済」）・Python の re にしか無い書き方（先読み・後読み・後方参照）・
     画面の JS に同じ処理がある（2 重に持つ）・Rust に同じ処理がある（lotlist.rs・mirror.rs）。依存の段（葉＝ほかの app の部品を使わない＝0）も出す。
  2. 速さ（動かして測る）: 開発用サーバーと同じ試験データ（tools/ui_server.build）を大きくして、引数の無い GET の道すべて・データ元ごとの道・
     ダッシュボードの組み込みの全パネルを、--repeat 回の中央値で測る（ダッシュボードは控え DASH_CACHE を毎回空にした冷えた形）。道は受け持つ routes/* ごとに足す。
  3. Python を通す手間: 中身（sidecar.py）を窓と同じ形で起こして「ready」までの時間・枠 1 往復（/api/health）の時間を、同じ道を中で呼んだ時間と比べる。

Windows（同梱の Python・ウイルス対策）での起動の時間は、この道具では測れない（Linux の数）。終了コードは、測れなかった道があれば 1。
"""
import argparse
import ast
import json
import os
import re
import statistics
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlencode

PROGRAM = Path(__file__).resolve().parents[1]
ROOT = PROGRAM.parent
APP = PROGRAM / "app"
sys.path.insert(0, str(PROGRAM))
sys.path.insert(0, str(PROGRAM / "tools"))

# 標準の部品（使い方まで見る物は「部品.使い方」）→ Rust で代わりに使う crate（Cargo.toml に有れば「済」）。書いていない物は Rust の標準（std）で足りる
CRATES = {
    "re": "regex", "sqlite3": "rusqlite", "json": "serde_json", "datetime": "chrono", "hashlib": "sha2",
    "unicodedata": "unicode-normalization", "urllib.request": "ureq", "urllib.parse": "percent-encoding", "html": "html-escape",
    "uuid": "uuid", "socket.gethostname": "hostname", "socket.getfqdn": "hostname", "socket.create_connection": "tungstenite",
    "base64": "base64", "zlib": "flate2", "decimal": "rust_decimal", "fnmatch": "glob",
    "_winapi": "windows", "msvcrt": "windows", "mimetypes": "mime_guess", "email": "httpdate",
}
# 使い方まで見る標準の部品（import の名前だけでは要る crate が決まらない）
BY_USE = ("socket", "urllib")
# Python の re の先読み・後読み（Rust の regex は持たない。fancy-regex か書き換えが要る）
PY_ONLY_RE = re.compile(r"\(\?<?[=!]")
# 読んで確かめた事柄（自動では見つけにくい物）
NOTES = {
    "services.formula": "利用者が式に書く JavaScript の正規表現（後方参照 \\1・\\k<名前> も）を Python の re に訳して使う。Rust の regex は後方参照・先読みを持たない → fancy-regex",
    "services.lotdsp_direct": "見えない Edge を CDP（WebSocket を手で組む）で動かす",
    "services.lotdsp_api": "社内の LotDsp へ HTTP で問い合わせる",
    "services.cm3_schedule": "社内の CM3 へ HTTP で問い合わせ、HTML の表を読む",
}
# Rust に同じ処理がある部品（突き合わせの試験で同じ答えを示してある。DESKTOP_MIGRATION_DESIGN.md §7・§8）
IN_RUST = {"services.lot_list": "desktop/src/lotlist.rs", "services.db_mirror": "desktop/src/mirror.rs",
           "services.sqlite_ro": "desktop/src/lotlist.rs・pyfmt.rs"}
# 画面の JS に同じ処理がある部品（画面とサーバーで同じ答えかを突き合わせている）
IN_JS = {"services.formula": "list-formula.js", "services.num_expr": "num-format.js"}


# ================================================================ 1. 棚卸し
def code_lines(text):
    """空行・注釈・説明文（docstring）を除いた行の数。"""
    tree = ast.parse(text)
    doc = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.body:
            first = n.body[0]
            if isinstance(first, ast.Expr) and isinstance(getattr(first, "value", None), ast.Constant) and isinstance(first.value.value, str):
                doc.update(range(first.lineno, first.end_lineno + 1))
    return sum(1 for i, line in enumerate(text.splitlines(), 1) if line.strip() and not line.strip().startswith("#") and i not in doc)


def module_name(path):
    rel = path.relative_to(APP).with_suffix("")
    parts = [p for p in rel.parts if p != "__init__"]
    return ".".join(parts) or "__init__"


def resolve(mod, level, name):
    """相対の import → app の中の名前（app の外なら None）。"""
    if level == 0:
        return name[4:] if name and name.startswith("app.") else ("__init__" if name == "app" else None)
    base = mod.split(".")
    pkg = base[:-1] if not (APP / Path(*base) / "__init__.py").exists() else base
    pkg = pkg[: len(pkg) - (level - 1)] if level > 1 else pkg
    return ".".join([*pkg, name] if name else pkg) or "__init__"


def inventory():
    std = set(sys.stdlib_module_names)
    mods = {}
    for p in sorted(APP.rglob("*.py")):
        if "__pycache__" in p.parts:
            continue
        text = p.read_text(encoding="utf-8")
        tree = ast.parse(text)
        name = module_name(p)
        uses, stdlib = set(), set()
        for n in ast.walk(tree):                        # 使い方まで見る部品: socket.gethostname・urllib.request など
            if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id in BY_USE:
                stdlib.add(f"{n.value.id}.{n.attr}")
            elif isinstance(n, ast.Attribute) and isinstance(n.value, ast.Attribute) and isinstance(n.value.value, ast.Name) and n.value.value.id in BY_USE:
                stdlib.add(f"{n.value.value.id}.{n.value.attr}")
            elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module and n.module.split(".")[0] in BY_USE:
                stdlib.update(f"{n.module}.{a.name}" if "." not in n.module else n.module for a in n.names)
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                for a in n.names:
                    top = a.name.split(".")[0]
                    if top in std:
                        stdlib.add(top)
                    elif top == "app":
                        uses.add(resolve(name, 0, a.name))
            elif isinstance(n, ast.ImportFrom):
                if n.level == 0 and n.module and n.module.split(".")[0] in std:
                    stdlib.add(n.module.split(".")[0])
                    continue
                target = resolve(name, n.level, n.module) if (n.level or (n.module or "").startswith("app")) else None
                if target is None:
                    continue
                for a in n.names:               # from .services import pivot → services.pivot
                    sub = f"{target}.{a.name}" if target != "__init__" else a.name
                    uses.add(sub if (APP / Path(*sub.split("."))).with_suffix(".py").exists() or (APP / Path(*sub.split(".")) / "__init__.py").exists() else target)
        strings = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        py_only = sum(1 for s in strings if "re" in stdlib and PY_ONLY_RE.search(s))
        mods[name] = {"file": str(p.relative_to(ROOT)), "lines": code_lines(text), "uses": sorted(u for u in uses if u and u != name),
                      "stdlib": sorted(stdlib - {"__future__", *BY_USE}), "pyOnlyRegex": py_only}
    known = set(mods)
    for m in mods.values():
        m["uses"] = [u for u in m["uses"] if u in known]
    # 使われる側
    for name, m in mods.items():
        m["usedBy"] = sorted(k for k, v in mods.items() if name in v["uses"])
    # 依存の段（葉 = 0。輪があれば輪の中は同じ段）
    level = {}

    def depth(n, seen=()):
        if n in level:
            return level[n]
        if n in seen:
            return 0
        d = 1 + max((depth(u, (*seen, n)) for u in mods[n]["uses"]), default=-1)
        level[n] = d
        return d
    for n in mods:
        depth(n)
    # 試験: 試験ファイルが読むモジュール ← その試験ファイルの test_* の数
    tests = defaultdict(int)
    for p in sorted((PROGRAM / "tests").glob("test_*.py")):
        tree = ast.parse(p.read_text(encoding="utf-8"))
        n_tests = sum(1 for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith("test"))
        reads = set()
        for n in ast.walk(tree):
            if isinstance(n, ast.ImportFrom) and n.module and n.module.startswith("app"):
                base = n.module[4:] if n.module != "app" else ""
                for a in n.names:
                    cand = f"{base}.{a.name}" if base else a.name
                    reads.add(cand if cand in known else (base or "__init__"))
            elif isinstance(n, ast.Import):
                reads.update(a.name[4:] for a in n.names if a.name.startswith("app."))
        for r in reads:
            if r in known:
                tests[r] += n_tests
    cargo = (ROOT / "desktop" / "Cargo.toml").read_text(encoding="utf-8")
    for name, m in mods.items():
        m["level"] = level[name]
        m["tests"] = tests.get(name, 0)
        need = sorted({CRATES[s] for s in m["stdlib"] if s in CRATES})
        m["crates"] = [{"crate": c, "have": bool(re.search(rf"^{re.escape(c)}\s*=", cargo, re.M))} for c in need]
        m["inRust"] = IN_RUST.get(name, "")
        m["inJs"] = IN_JS.get(name, "")
        m["note"] = NOTES.get(name, "")
    return mods


# ================================================================ 2. 速さ
def median_ms(fn, repeat):
    out = []
    for _ in range(repeat):
        t = time.perf_counter()
        r = fn()
        out.append((time.perf_counter() - t) * 1000)
    return statistics.median(out), max(out), r


def split(fn):
    """1 回だけ cProfile の下で呼び、時間を SQLite の中・JSON に書く・Python の手に分ける（ms）。
    Rust に移して縮みうるのは Python の手の分だけ（SQLite の中は Rust でも同じ。JSON は serde でも書く）。
    カーソルを for で回す時間は呼んだ側（Python の手）に入るので、Python の手は多めに出る（上限として読む）。"""
    import cProfile
    import pstats
    pr = cProfile.Profile()
    t = time.perf_counter()
    pr.enable()
    fn()
    pr.disable()
    total = (time.perf_counter() - t) * 1000
    st = pstats.Stats(pr).stats
    sql = sum(v[2] for (f, _, name), v in st.items() if f == "~" and "sqlite3." in name and any(m in name for m in ("execute", "fetch", "close", "commit")))
    js = sum(v[3] for (f, _, name), v in st.items() if f.replace("\\", "/").endswith("json/__init__.py") and name == "dumps")
    sql, js = sql * 1000, js * 1000
    return {"totalMs": round(total, 2), "sqliteMs": round(sql, 2), "jsonMs": round(js, 2), "pythonMs": round(max(0.0, total - sql - js), 2)}


def copying(r):
    try:
        d = r.get_json()
    except Exception:
        return False
    if not isinstance(d, dict):
        return False
    return r.status_code == 503 and d.get("kind") == "copying" or any(g.get("kind") == "copying" for g in (d.get("groups") or []) if isinstance(g, dict))


def settle(fn, limit=60.0):
    """写しを終えるまで待つ（写す時間は測らない。写しは Rust の mirror.rs が受け持てる仕事）。"""
    end = time.time() + limit
    r = fn()
    while copying(r) and time.time() < end:
        time.sleep(0.05)
        r = fn()
    return r


def families(c):
    """データの道の組（品質・実績の設備 1 台・足したデータ元）→ [(名前, 道の頭, いつも付ける引数, まとめる引数)]。"""
    out = [("品質", "/api/lotlist", {}, {"group": "1"})]
    rows = (c.get("/api/masters/worklog").get_json() or {}).get("items") or []
    def total(r):                                        # その設備の行の数（ファイルの大きさは列の数にも依るので使わない）
        d = settle(lambda: c.get("/api/worklog?" + urlencode({"equip": r["key"], "page_size": 1}))).get_json() or {}
        return d.get("count") or 0
    eq = max((r for r in rows if r.get("key") and r.get("state") == "ok"), key=total, default=None)   # いちばん行の多い設備
    if eq:
        out.append((f"実績（{eq.get('name') or eq['key']}）", "/api/worklog", {"equip": eq["key"]}, {"work": "1"}))
    for s in (c.get("/api/sources").get_json() or {}).get("items", []):
        k = s.get("key")
        if k and settle(lambda k=k: c.get(f"/api/src/{k}")).status_code == 200:      # 品質・実績は上の道で引く（/api/src では 404）
            out.append((s.get("name") or s.get("label") or k, f"/api/src/{k}", {}, {"group": "1"}))
    return out


def scenarios(c, name, base, extra, grouping):
    """画面と同じ形の問い合わせ: 一覧・まとめ・検索・カラムの札・スライサー・集計（列はカラムの札の答えから選ぶ）。"""
    qs = lambda **kw: "?" + urlencode({**extra, **kw})       # noqa: E731
    asks = [(f"{name}／一覧 500 行", base + qs(page_size=500)), (f"{name}／まとめ", base + qs(page_size=500, **grouping)),
            (f"{name}／検索「1」", base + qs(page_size=500, search="1")), (f"{name}／カラムの札", base + "/pivot" + qs(fields=1))]
    f = settle(lambda: c.get(base + "/pivot" + qs(fields=1)))
    cols = f.get_json() if f.status_code == 200 else []
    cols = cols if isinstance(cols, list) else (cols or {}).get("fields", [])
    cat = sorted((x for x in cols if not x.get("numeric") and not x.get("calc") and (x.get("kinds") or 0) > 1), key=lambda x: x["kinds"])
    num = next((x["column"] for x in cols if x.get("numeric") and not x.get("calc")), "")
    if cat:
        col = cat[0]["column"]
        ms = [{"agg": "count"}] + ([{"agg": "sum", "column": num}] if num else [])
        asks += [(f"{name}／スライサー（{col}）", base + "/slicer" + qs(column=col)),
                 (f"{name}／集計（{col}{'・' + num + 'の計' if num else ''}）", base + "/pivot" + qs(rows=json.dumps([{"column": col}]), measures=json.dumps(ms)))]
    return asks


def speed(quality, work_rows, wip, repeat):
    import ui_server
    t0 = time.perf_counter()
    app = ui_server.build(quality=quality, work_rows=work_rows, wip=wip)
    built = time.perf_counter() - t0
    c = app.test_client()
    fam = families(c)
    data_heads = {b for _, b, _, _ in fam} | {"/api/src/lot", "/api/src/work"}
    skip = {"/api/lots/lotdsp-api/survey"}                 # LotDsp（社内のサーバー）へ問い合わせる道は測らない
    asks = []
    for rule in app.url_map.iter_rules():                   # 引数の無い GET（データの道は下で画面と同じ形に組む）
        if "GET" in rule.methods and "<" not in rule.rule and rule.rule not in skip and not rule.rule.startswith("/static") \
                and not any(rule.rule == h or rule.rule.startswith(h + "/") for h in data_heads):
            asks.append((rule.fn.__module__, "GET", rule.rule, None, ""))
    for name, base, extra, grouping in fam:
        module = {"/api/lotlist": "app.routes.lotlist", "/api/worklog": "app.routes.worklog"}.get(base, "app.routes.sources")
        for title, path in scenarios(c, name, base, extra, grouping):
            asks.append((module, "GET", path, None, title))
    dash = c.get("/api/dashboards").get_json() or {}
    seen = set()
    for item in dash.get("items", []):
        for p in (item.get("body") or {}).get("panels", []):
            sig = json.dumps(p, sort_keys=True, ensure_ascii=False)
            if sig in seen:
                continue
            seen.add(sig)
            asks.append(("app.routes.dashboard", "POST", "/api/dashboard/query", {"panel": p}, f"{item.get('name')}／{p.get('title') or p.get('visual')}"))
    rows, failed, refused = [], [], []
    for module, method, path, body, title in asks:
        def call(method=method, path=path, body=body):
            if method == "POST":
                app.config.pop("DASH_CACHE", None)       # 冷えた形（パネルの答えの控えを使わない）
                return c.post(path, json=body)
            return c.get(path)
        try:
            settle(call)
            med, worst, r = median_ms(call, repeat)
        except Exception as e:                            # 測れなかった道（理由を残す）
            failed.append({"path": path, "title": title, "error": f"{type(e).__name__}: {e}"})
            continue
        row = {"module": module.replace("app.", ""), "method": method, "path": path, "title": title, "status": r.status_code,
               "bytes": len(r.data), "ms": round(med, 2), "maxMs": round(worst, 2)}
        if r.status_code < 400:
            row["split"] = split(call)
        (rows if r.status_code < 400 else refused).append(row)
    by = defaultdict(lambda: {"routes": 0, "ms": 0.0, "max": 0.0, "slowest": "", "sqlite": 0.0, "json": 0.0, "python": 0.0})
    for r in rows:
        b = by[r["module"]]
        b["routes"] += 1
        b["ms"] = round(b["ms"] + r["ms"], 2)
        sp = r["split"]                                  # 割合を中央値の時間に当てて足す（cProfile の下は遅くなるため）
        for k in ("sqlite", "json", "python"):
            b[k] = round(b[k] + r["ms"] * sp[k + "Ms"] / sp["totalMs"] if sp["totalMs"] else 0.0, 2)
        if r["ms"] > b["max"]:
            b["max"], b["slowest"] = r["ms"], (r["title"] or r["path"])
    return {"data": {"quality": quality, "workRows": work_rows, "workEquipment": len(ui_server.WORK_EQUIPMENT) + 1, "wip": wip,
                     "buildSeconds": round(built, 1)}, "routes": rows, "byModule": dict(by), "failed": failed, "refused": refused}


# ================================================================ 3. Python を通す手間
def sidecar_cost(repeat, rounds=200):
    import tempfile
    work = Path(tempfile.mkdtemp(prefix="tpa-port-"))
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "TPA_SHELL": "desktop", "TPA_SHELL_SERVES": "lotlist",
           "TRANSFER_LOCAL_ROOT": str(work)}
    starts, inner = [], []
    bare = []
    for _ in range(repeat):
        t = time.perf_counter()
        subprocess.run([sys.executable, "-X", "utf8", "-c", "pass"], check=True)
        bare.append((time.perf_counter() - t) * 1000)
    trips = []
    for i in range(repeat):
        t = time.perf_counter()
        p = subprocess.Popen([sys.executable, "-X", "utf8", "-X", f"pycache_prefix={work / 'pycache'}", str(PROGRAM / "sidecar.py")],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, cwd=str(PROGRAM))
        head = json.loads(p.stdout.readline())
        starts.append((time.perf_counter() - t) * 1000)
        inner.append(float(head.get("elapsed") or 0) * 1000)
        if i == repeat - 1:                              # 最後の 1 つで枠の往復を測る
            for n in range(1, rounds + 1):
                t = time.perf_counter()
                p.stdin.write(json.dumps({"id": n, "method": "GET", "path": "/api/health", "query": "", "headers": {}, "len": 0}).encode() + b"\n")
                p.stdin.flush()
                h = json.loads(p.stdout.readline())
                if h.get("len"):
                    p.stdout.read(h["len"])
                trips.append((time.perf_counter() - t) * 1000)
        p.stdin.close()
        p.wait(timeout=10)
    from app import create_app
    app = create_app({"TESTING": True})
    c = app.test_client()
    direct = []
    for _ in range(rounds):
        t = time.perf_counter()
        c.get("/api/health")
        direct.append((time.perf_counter() - t) * 1000)
    return {"pythonBareMs": round(statistics.median(bare), 1), "readyMs": round(statistics.median(starts), 1),
            "readyInsideMs": round(statistics.median(inner), 1), "tripMs": round(statistics.median(trips), 3),
            "directMs": round(statistics.median(direct), 3), "rounds": rounds}


# ================================================================ 4. 見積もりの確かめ（既に Rust にある一覧で）
def calibrate(rows, repeat):
    """一覧（lot_list.query）は Python と Rust（desktop/examples/lotbench.rs）の両方にある。同じ問い合わせで
    Python の時間・Python の手の割合（split）・Rust の実際の時間を並べ、「Python の手」がどれだけ縮んだかを出す。
    Rust の時間は、組んだ lotbench（cargo build --release --example lotbench）があるときだけ。"""
    import tempfile
    from datetime import date

    from app.services import lot_list
    from tests import lotlist_bench, lotlist_fixture
    db = Path(tempfile.mkdtemp(prefix="tpa-cal-")) / "q.sqlite3"
    lotlist_fixture.make(str(db), rows)
    today = date(2026, 10, 2)
    out = []
    for name, kw in lotlist_bench.CASES:
        call = lambda kw=kw: json.dumps(lot_list.query(str(db), today=today, **kw), ensure_ascii=True, sort_keys=True)   # noqa: E731
        call()
        med, _, _ = median_ms(call, repeat)
        out.append({"case": name, "pythonMs": round(med, 1), "split": split(call)})
    exe = ROOT / "desktop" / "target" / "release" / "examples" / ("lotbench.exe" if os.name == "nt" else "lotbench")
    if exe.exists():
        text = subprocess.run([str(exe), str(db)], capture_output=True, text=True, encoding="utf-8", timeout=600).stdout
        rust = dict(line.rsplit("\t", 1) for line in text.splitlines() if "\t" in line)
        for r in out:
            v = rust.get(r["case"])
            r["rustMs"] = float(v) if v not in (None, "") else None
    return {"rows": rows, "rustExe": str(exe.relative_to(ROOT)) if exe.exists() else "", "cases": out}


# ================================================================ 表
def units(mods):
    """移す単位: services・repositories の部品 1 つずつ。道（routes/*）・枠（web.py など）は、使う部品を移した後に移す物として別に出す。"""
    return {k: v for k, v in mods.items() if k.startswith(("services.", "repositories."))}


def report(mods, sp, side, cal=None):
    out = []
    w = out.append
    total = sum(m["lines"] for m in mods.values())
    w(f"# 棚卸し（program/app。{len(mods)} 個・{total:,} 行。行は空行・注釈・説明文を除く）")
    w("")
    w("| 段 | 部品 | 行 | 試験 | 使う部品 | 使われる | 要る crate（済=Cargo.toml に有る） | re の先読み・後読み | 既に・注 |")
    w("|---:|---|---:|---:|---:|---:|---|---:|---|")
    for k, m in sorted(units(mods).items(), key=lambda kv: (kv[1]["level"], -kv[1]["lines"])):
        crates = "・".join(f"{c['crate']}{'（済）' if c['have'] else ''}" for c in m["crates"]) or "std だけ"
        have = "・".join(x for x in (m["inRust"] and f"Rust: {m['inRust']}", m["inJs"] and f"JS: {m['inJs']}", m["note"]) if x)
        w(f"| {m['level']} | {k} | {m['lines']} | {m['tests']} | {len(m['uses'])} | {len(m['usedBy'])} | {crates} | {m['pyOnlyRegex'] or ''} | {have} |")
    rest = {k: v for k, v in mods.items() if k not in units(mods)}
    w("")
    w(f"道と枠（{sum(m['lines'] for m in rest.values()):,} 行）: " + "・".join(f"{k} {m['lines']}" for k, m in sorted(rest.items(), key=lambda kv: -kv[1]["lines"])))
    if sp:
        d = sp["data"]
        w("")
        w(f"# 速さ（品質 {d['quality']:,} 行・作業実績 {d['workEquipment']} 台 × {d['workRows']:,} 行・仕掛 {d['wip']:,} ロット。中央値 ms）")
        w("")
        w("| 道の集まり | 道の数 | 合計 ms | SQLite の中 | JSON に書く | Python の手（移して縮みうる上限） | いちばん遅い道 | その ms |")
        w("|---|---:|---:|---:|---:|---:|---|---:|")
        pct = lambda a, b: f"{a:.1f}（{a / b * 100:.0f}%）" if b else "0"          # noqa: E731
        for k, b in sorted(sp["byModule"].items(), key=lambda kv: -kv[1]["ms"]):
            w(f"| {k} | {b['routes']} | {b['ms']:.1f} | {pct(b['sqlite'], b['ms'])} | {pct(b['json'], b['ms'])} | {pct(b['python'], b['ms'])} | {b['slowest']} | {b['max']:.1f} |")
        w("")
        w("遅い道 20（中央値 ms・SQLite／JSON／Python の手の割合）:")
        for r in sorted(sp["routes"], key=lambda r: -r["ms"])[:20]:
            x = r["split"]
            share = "／".join(f"{x[k] / x['totalMs'] * 100:.0f}%" if x["totalMs"] else "-" for k in ("sqliteMs", "jsonMs", "pythonMs"))
            w(f"- {r['ms']:.1f} ms（最大 {r['maxMs']:.1f}・{share}）{r['method']} {r['title'] or r['path']} → {r['bytes']:,} B")
        if sp["refused"]:
            w("")
            w(f"引数が要る・この PC では答えない道（測った数に入れない）{len(sp['refused'])}: " + "・".join(f"{r['path']} {r['status']}" for r in sp["refused"]))
        if sp["failed"]:
            w("")
            w("測れなかった道: " + "・".join(f"{f['title'] or f['path']}（{f['error']}）" for f in sp["failed"]))
    if cal:
        w("")
        w(f"# 見積もりの確かめ: 既に Rust にある一覧（品質 {cal['rows']:,} 行・中央値 ms）")
        w("")
        w("| 問い合わせ | Python | Python の手の割合 | 手を 0 にした下限 | Rust（実際） | 速さの比 |")
        w("|---|---:|---:|---:|---:|---:|")
        for r in cal["cases"]:
            x = r["split"]
            hand = x["pythonMs"] / x["totalMs"] if x["totalMs"] else 0
            rust = r.get("rustMs")
            rust_text = "" if rust is None else f"{rust:.0f}"
            ratio = f"{r['pythonMs'] / rust:.1f} 倍" if rust else ""
            w(f"| {r['case']} | {r['pythonMs']:.0f} | {hand * 100:.0f}% | {r['pythonMs'] * (1 - hand):.0f} | {rust_text} | {ratio} |")
        if not cal["rustExe"]:
            w("（Rust の lotbench を組んでいないので、Rust の列は空。cd desktop && cargo build --release --example lotbench）")
    if side:
        w("")
        w("# Python を通す手間（Linux）")
        w(f"- Python だけを起こす: {side['pythonBareMs']} ms／中身（sidecar.py）が ready を返すまで: {side['readyMs']} ms（中で数えた {side['readyInsideMs']} ms）")
        w(f"- 枠 1 往復（/api/health・{side['rounds']} 回の中央値）: {side['tripMs']} ms／同じ道を中で呼ぶ: {side['directMs']} ms")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quality", type=int, default=20000)
    ap.add_argument("--work-rows", type=int, default=2000)
    ap.add_argument("--wip", type=int, default=20000)
    ap.add_argument("--repeat", type=int, default=5)
    ap.add_argument("--json")
    ap.add_argument("--static-only", action="store_true", help="棚卸しだけ（動かさない）")
    ap.add_argument("--calibrate", type=int, default=0, metavar="行", help="既に Rust にある一覧で見積もりを確かめる（品質データの行の数）")
    a = ap.parse_args()
    mods = inventory()
    sp = side = None
    if not a.static_only:
        side = sidecar_cost(a.repeat)
        sp = speed(a.quality, a.work_rows, a.wip, a.repeat)
    cal = calibrate(a.calibrate, a.repeat) if a.calibrate else None
    print(report(mods, sp, side, cal))
    if a.json:
        Path(a.json).write_text(json.dumps({"modules": mods, "speed": sp, "sidecar": side, "calibrate": cal}, ensure_ascii=False, indent=1), encoding="utf-8")
    return 1 if sp and sp["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
