"""窓が自分の答えを焼く（bless。版 3.115.0。Rust 化の段 ③ の 4 つ目・案 G の 1 版目）。app を import しない（標準の部品だけ）。

    python tools/bless.py 本 …            … 本ごとに TPA_BLESS=1 で窓の突き合わせの試験を流して焼き（Python と同じときだけ書く）、
                                            時刻の境（次の分）をまたいでからもう 1 度焼いて、1 回目と同じかを見る（違えば元の表に戻して止める）
    python tools/bless.py --all           … 焼く本すべて（desktop/tests/baked/books.json の phase が 3.115.0・3.116.0）
    python tools/bless.py --stats [--base 版] … 本ごとの表の大きさ（UTF-8 のバイト）・歩・葉・そろえた印（@T・@URL・@WORK など）の数を出す
                                            （--base は git の版〈例 origin/main〉。前の表から増えた分も出す。PR の説明に貼る）
    python tools/bless.py --user 本 …     … root でない利用者（nobody）で試験の実行ファイルを流し、root と違う歩を variants.user に焼く（fs・place・release_place）
    python tools/bless.py --no-python 本 … … TPA_NO_PYTHON=1 で流す（段 ④ の後の形: 表の宣言から場面を作り、焼いた答えとだけ比べる）
    python tools/bless.py --check         … cargo を流さずに、焼いた表の形と、焼いた時の元（答え合わせ役など）の指紋が今の元と同じかを見る（古さを止める。
                                            tests/test_baked_tables.py からも流れる）。違えば終了コード 1
    python tools/bless.py --measured フォルダ … [--json] … Windows の測るだけの仕事（.github/workflows/desktop.yml の TPA_MEASURE）が残した記録を読み、
                                            本ごとに「焼いた表（posix）と違う歩」の数と、違う葉の鍵・見本を出す（落とさない。終了コード 0）。
                                            フォルダは流した形ごと（Python と比べる形・表だけの形〈TPA_NO_PYTHON=1。段 ④ の後の形〉）で、形ごとに別の行で出す。
                                            --json は記録そのものを 1 表 1 行（「measure-json| 」で始まる行）でも出す（成果物を取れないときは仕事の記録から読む）
    python tools/bless.py --from-log 記録 出力フォルダ … 仕事の記録（--json の行）から測りの記録を <出力フォルダ>/<形>/<表>.json に戻す
    python tools/bless.py --no-python --all --skip-test 試験,… … Python 無しの形で流すが、名前を挙げた試験は流さない（Windows の測り: route_reach は長い）
    python tools/bless.py --scope 道の型 本 … … 段 ④ の後: 範囲を宣言して焼き直す（TPA_NO_PYTHON=1・TPA_BLESS=道の型）。範囲の外が変わったら書かない

焼いた表は desktop/tests/baked/<本>.json。焼くのは窓の試験（desktop/tests/common/bake.rs）で、この道具はそれを流して確かめるだけ。
独立の答え（tools/*-truth.py）と人が書いた事例の表（tests/fixtures/*_cases.json）は書き換えない（第 2 の線）。
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
DESKTOP = PROGRAM.parent / "desktop"
BAKED = DESKTOP / "tests" / "baked"
BOOKS = json.loads((BAKED / "books.json").read_text(encoding="utf-8"))["books"]
# 焼いてある本の phase（3.115.0 の 21 本・3.116.0 に焼いた本）。それより先の版（3.117.0 など）は、まだ焼いていない本
PHASES = ("3.115.0", "3.116.0")
# 表の大きさの上限（UTF-8 のバイト。版 3.116.0 の採点の first_fixes 3）: 本ごと（books.json の maxMB。無ければ 1.5 MB）と全部の計
MAX_MB = 1.5
MAX_TOTAL_MB = 40.0
# そろえた印（desktop/tests/common/bake.rs の settle が答えに置く字）。本ごとに数えて、そろえすぎを数で見せる（first_fixes 12）
STAMPS = ("@T(", "@URL", "@MS", "@WORK", "@REPO", "@HOME", "@USER", "@HELD:", "@VERSION", "@BUILD", "@HOST", "@DAY", "@ABOVE", "@PID", "@UI", "@FID(")
STAMP_SHARE = 0.2      # 印のある葉が答えの葉のこの割合を超える本は知らせる（守りが薄い表）
# 場面のファイルの更新時刻「今からのずれ」がこれより大きい物は知らせる（ms。版 3.116.0 の作った後の直し）: 答え合わせ役が作ったファイルは
# 焼いた時の今（ずれは数秒）。大きいずれは、取り出しのファイルの時刻をそのまま写した（＝取り出してからの日数に頼る表）か、場面が
# わざと置いた時刻（books.json の sceneTimesWhy に理由を書いた本は知らせない）
NOW_OFFSET_MS = 10 * 60 * 1000
NOW_RE = re.compile(r"@NOW\((-?\d+)ms\)")


def baked(book):
    return BOOKS[book]["phase"] in PHASES


MARKS = ("@same", "@rep", "@lit")


def unpack(v, parts):
    """詰めた形を開く（desktop/tests/common/bake.rs の unpack と同じ: 参照 @same・繰り返しの字 @rep・印と同じ形の表 @lit）"""
    if isinstance(v, list):
        return [unpack(x, parts) for x in v]
    if isinstance(v, dict):
        if len(v) == 1 and next(iter(v)) in MARKS:
            k, x = next(iter(v.items()))
            if k == "@same":
                if x not in parts:
                    raise KeyError(f"詰めた表の参照 {x} の中身が parts にありません")
                return unpack(parts[x], parts)
            if k == "@rep":
                return "".join(s if isinstance(s, str) else s[0] * s[1] for s in x)
            return {kk: unpack(y, parts) for kk, y in x.items()}
        return {k: unpack(x, parts) for k, x in v.items()}
    return v


def unpack_table(t):
    """表を開いた形に（parts を外す。詰めていない表はそのまま）"""
    if "parts" not in t:
        return t
    parts = t["parts"]
    return {k: (unpack(v, parts) if k in ("oracle", "scene", "answers", "variants") else v) for k, v in t.items() if k != "parts"}


def leaves(v):
    if isinstance(v, dict):
        for x in v.values():
            yield from leaves(x)
    elif isinstance(v, list):
        for x in v:
            yield from leaves(x)
    else:
        yield v


def stats_of(path):
    """表 1 つの数: 大きさ（UTF-8 のバイト）・歩・答えの葉・印のある葉・印ごとの数"""
    raw = path.read_bytes()
    t = unpack_table(json.loads(raw))
    n = stamped = 0
    by = {}
    for x in leaves(t.get("answers", {})):
        n += 1
        if isinstance(x, str) and "@" in x:
            hit = [s for s in STAMPS if s in x]
            stamped += bool(hit)
            for s in hit:
                by[s] = by.get(s, 0) + x.count(s)
    return {"bytes": len(raw), "steps": len(t.get("answers", {})), "leaves": n, "stamped": stamped, "stamps": by}


def sources_of(book):
    """焼いた時の元の指紋（desktop/tests/common/bake.rs の sources_of と同じ: \\r を除いた sha256 の頭 16 字）"""
    out = {}
    for rel in BOOKS[book]["sources"]:
        b = (PROGRAM / rel).read_bytes().replace(b"\r", b"") if (PROGRAM / rel).exists() else b""
        out[rel] = hashlib.sha256(b).hexdigest()[:16]
    return out


def tables(baked=None):
    """tests/baked の焼いた表（books.json・settle.json の外の *.json）→ {表のファイルの名前: 本}。本は名前の頭（本.部分）"""
    baked = baked or BAKED
    return {p.stem: p.stem.split(".")[0] for p in sorted(baked.glob("*.json")) if p.name not in ("books.json", "settle.json")}


def files_of(book, baked=None):
    """本の表のファイル（本.json と、部分の 本.部分.json）"""
    return [(baked or BAKED) / f"{name}.json" for name, b in tables(baked).items() if b == book]


DATE = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")


def near_dates(book, days=3):
    """答え合わせ役の元に書いた固定の日付のうち、今日から days 日の内の物（焼くと「今に近い時刻」と読まれ、日がたつと表が古くなる時限の爆弾）"""
    import datetime as dt
    today = dt.date.today()
    out = []
    for rel in BOOKS[book]["sources"]:
        p = PROGRAM / rel
        for m in DATE.finditer(p.read_text(encoding="utf-8")) if p.exists() else []:
            try:
                d = dt.date(int(m[1]), int(m[2]), int(m[3]))
            except ValueError:
                continue
            if abs((d - today).days) <= days:
                out.append(f"{rel}: {m[0]}")
    return out


def local_paths():
    """焼いた PC ごとに違う道（リポジトリの根・家・cargo の作業フォルダ）。焼いた表に字のまま残っていてはいけない（版 3.115.0 の 2 回目の直し:
    手元〈家の外〉で焼いた表の program の道が、リポジトリが家の下にある CI で食い違った）"""
    out = [("リポジトリの根", str(PROGRAM.parent.resolve()))]
    home = os.environ.get("HOME", "")
    if len(home.rstrip("/")) > 1:
        out.append(("家", home.rstrip("/")))
    target = os.environ.get("CARGO_TARGET_DIR") or str(DESKTOP / "target")
    out.append(("cargo の作業フォルダ", str(Path(target).resolve())))
    return out


# PC の名前を引く係（DNS）の様子で変わる言葉。焼いた表の答えに残っていてはいけない（版 3.115.0 の PR #115 の CI の直し: builder の場面が
# 既定の社内の名前のまま CM3 を引きに行き、手元は「Name or service not known」、CI は「Temporary failure in name resolution」で食い違った。
# 場面は本物の名前を引かない形〈この PC の中の閉じた口〉にする。引けない名前の言葉そのものを突き合わせる本は、焼く前に決めを足す）
RESOLVER_WORDS = ("Name or service not known", "Temporary failure in name resolution", "No address associated with hostname",
                  "getaddrinfo failed", "nodename nor servname provided")


def check(baked=None):
    """→ 食い違いの言葉の並び（空なら古くない）。tests/baked の表を全部（部分の表も）確かめる（版 3.115.0 の作った後の直し: 前は 本.json だけを見た）"""
    bad = []
    size = {}
    tabs = tables(baked)
    for name, book in tabs.items():
        if book not in BOOKS:
            bad.append(f"{name}: 知らない本の表（books.json に無い）")
            continue
        if BOOKS[book]["phase"] not in PHASES:
            bad.append(f"{name}: 焼く版でない本（phase {BOOKS[book]['phase']}）に表がある")
            continue
        text = ((baked or BAKED) / f"{name}.json").read_text(encoding="utf-8")
        size[book] = size.get(book, 0) + len(text.encode("utf-8"))
        for why, path in local_paths():
            if re.search(re.escape(json.dumps(path)[1:-1]) + r"(?=[/\\\\\"]|$)", text):
                bad.append(f"{name}: 焼いた PC の{why}（{path}）が字のまま残っている（@REPO・@WORK・@HOME にそろえて焼き直す）")
        for w in RESOLVER_WORDS:
            if w in text:
                bad.append(f"{name}: PC の名前を引く係の様子で変わる言葉（{w}）が表にある（場面が本物の名前を引いている。引かない形にして焼き直す）")
        try:
            t = unpack_table(json.loads(text))
        except KeyError as e:
            bad.append(f"{name}: {e.args[0]}")
            continue
        for k in ("book", "os", "oracle", "scene", "answers", "routes", "sources"):
            if k not in t:
                bad.append(f"{name}: 表に {k} がありません")
        if t.get("book") != book or t.get("file", name) != name:
            bad.append(f"{name}: 表の本の名前が {t.get('book')}・{t.get('file')}")
        now = sources_of(book)
        for rel, h in now.items():
            if t.get("sources", {}).get(rel) != h:
                bad.append(f"{name}: 元 {rel} が焼いた時と違う（表が古い。python tools/bless.py {book} で焼き直す）")
        for rel in set(t.get("sources", {})) - set(now):
            bad.append(f"{name}: 表に知らない元 {rel}")
        scene = t.get("scene", {})
        for k in ("files", "dirs", "links", "blobs"):
            if not isinstance(scene.get(k), dict):
                bad.append(f"{name}: 場面の宣言に {k} がありません")
        for rel, e in scene.get("files", {}).items():
            if not e.get("fifo") and not e.get("made") and e.get("blob") not in scene.get("blobs", {}):
                bad.append(f"{name}: 場面のファイル {rel} の中身が無い")
        if not isinstance(t.get("answers"), dict) or set(t.get("answers", {})) != set(t.get("routes", {})):
            bad.append(f"{name}: 答えと道の型の鍵が合わない")
        elif not t["answers"] and not name.endswith(".shared"):
            bad.append(f"{name}: 答えが 1 つもありません")
    for book, b in sorted(BOOKS.items()):
        if b["phase"] in PHASES and book not in tabs.values():
            bad.append(f"{book}: 焼いた表がありません（python tools/bless.py {book}）")
    # 大きさの上限（UTF-8 のバイト）: 本ごと・全部の計。越えたら、場面と事例を減らすか、books.json の maxMB を理由つきで上げる
    for book, n in sorted(size.items()):
        cap = BOOKS[book].get("maxMB", MAX_MB)
        if n > cap * 1e6:
            bad.append(f"{book}: 表が大きい（{n / 1e6:.2f} MB > 上限 {cap} MB）")
    if sum(size.values()) > MAX_TOTAL_MB * 1e6:
        bad.append(f"焼いた表の計が大きい（{sum(size.values()) / 1e6:.1f} MB > 上限 {MAX_TOTAL_MB} MB）")
    return bad


def notices(baked=None):
    """知らせ（落とさない）: 印のある葉が答えの葉の STAMP_SHARE を超える本（そろえすぎで守りが薄い表）"""
    out = []
    for name, book in tables(baked).items():
        t = unpack_table(json.loads(((baked or BAKED) / f"{name}.json").read_text(encoding="utf-8")))
        far = [rel for rel, e in t.get("scene", {}).get("files", {}).items()
               if (m := NOW_RE.fullmatch(str(e.get("mtime", "")))) and abs(int(m[1])) > NOW_OFFSET_MS]
        if far and not BOOKS.get(book, {}).get("sceneTimesWhy"):
            out.append(f"{name}: 場面のファイル {len(far)} 個の更新時刻が今から 10 分より離れている（例 {far[0]}）。取り出しのファイルの時刻を"
                       "写していないか（tests/scene_files.py を通して写す）。場面がわざと置いた時刻なら books.json の sceneTimesWhy に理由を書く")
    for name in tables(baked):
        s = stats_of((baked or BAKED) / f"{name}.json")
        if s["leaves"] and s["stamped"] > STAMP_SHARE * s["leaves"]:
            out.append(f"{name}: そろえた印のある葉が {s['stamped']}/{s['leaves']}（{STAMP_SHARE:.0%} を超える。守りが薄い）")
    return out


def stats(base=None):
    """本ごとの表の大きさ・歩・葉・印の数（--base の版の表から増えた分も）"""
    rows, total, total0 = [], 0, 0
    for name in tables():
        s = stats_of(BAKED / f"{name}.json")
        old = None
        if base:
            r = subprocess.run(["git", "show", f"{base}:desktop/tests/baked/{name}.json"], cwd=PROGRAM.parent, capture_output=True)
            old = len(r.stdout) if r.returncode == 0 else 0
            total0 += old
        total += s["bytes"]
        marks = " ".join(f"{k}{v}" for k, v in sorted(s["stamps"].items()))
        grew = "" if old is None else f" 前 {old / 1e6:.2f} MB（{(s['bytes'] - old) / 1e6:+.2f}）"
        rows.append(f"{name}: {s['bytes'] / 1e6:.2f} MB{grew}・歩 {s['steps']}・葉 {s['leaves']}・印のある葉 {s['stamped']}（{marks or '無し'}）")
    print("\n".join(rows))
    print(f"計 {total / 1e6:.2f} MB" + (f"（前 {total0 / 1e6:.2f} MB）" if base else "") + f"・{len(rows)} ファイル")


def tests_of(books):
    out = []
    for b in books:
        for t in BOOKS[b]["tests"]:
            if t not in out:
                out.append(t)
    return out


def cargo(tests, env, filt=None):
    cmd = ["cargo", "test", "--locked", "--no-fail-fast"] + [x for t in tests for x in ("--test", t)]
    cmd += ["--", "--nocapture"] + ([filt] if filt else [])
    r = subprocess.run(cmd, cwd=DESKTOP, env={**os.environ, **env}, capture_output=True, text=True, encoding="utf-8", errors="replace")
    sys.stderr.write("\n".join(line for line in (r.stdout + r.stderr).splitlines() if line.startswith(("bless|", "test result", "thread"))) + "\n")
    if r.returncode != 0:
        sys.stderr.write(r.stdout[-6000:] + r.stderr[-6000:])
    return r.returncode


def comparable(t):
    """2 回の焼きを比べる形（場面の今からのずれは流すたびに変わる。中身は指紋でなく中身で比べる）"""
    t = unpack_table(t)
    sc = t["scene"]
    files = {rel: {**e, "blob": sc["blobs"].get(e.get("blob"))} for rel, e in sc["files"].items()}
    s = json.dumps({"oracle": t["oracle"], "answers": t["answers"], "files": files, "dirs": sc["dirs"], "links": sc["links"],
                    "variants": t.get("variants")}, ensure_ascii=False, sort_keys=True)
    # 今からのずれ（場面の @NOW と答えの @T の秒）と、Python が場面を作るときに引く乱数（instance_id の uuid4 の 32 字）は比べない
    s = re.sub(r"@T\(([^|)]*)\|-?\d+\)", r"@T(\1|~)", re.sub(r"@NOW\(-?\d+ms", "@NOW(~", s))
    return json.loads(re.sub(r"\b[0-9a-f]{32}\b", "@HEX32", s))


def first_diff(a, b, p=""):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                return f"{p}.{k}: {'無い' if k not in a else '…'} / {'無い' if k not in b else '…'}"
            d = first_diff(a[k], b[k], f"{p}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{p}: 長さ {len(a)} / {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, f"{p}[{i}]")
            if d:
                return d
        return None
    return None if a == b else f"{p}: {str(a)[:200]} / {str(b)[:200]}"


def bless(books):
    tests = tests_of(books)
    near = [x for b in books for x in near_dates(b)]
    if near:
        sys.exit("答え合わせ役の元に今日から 3 日の内の固定の日付があります（焼くと今に近い時刻と読まれ、日がたつと表が古くなる）。遠い日付に替えてください:\n"
                 + "\n".join(near))
    keep = {p.name: p.read_bytes() for b in books for p in files_of(b)}
    if cargo(tests, {"TPA_BLESS": "1"}):
        restore(books, keep)
        sys.exit("1 回目の焼きが止まりました（Python と違う・試験の食い違い）。元の表に戻しました")
    # 2 回目は時刻の境（次の分）をまたいでから（同じ分の 2 回では時刻の揺れを見落とす。採点の指摘 3）
    wait = 62 - time.time() % 60
    print(f"時刻の境をまたぐまで {wait:.0f} 秒待ちます", flush=True)
    time.sleep(wait)
    with tempfile.TemporaryDirectory() as out:
        if cargo(tests, {"TPA_BLESS": "1", "TPA_BAKE_OUT": out}):
            restore(books, keep)
            sys.exit("2 回目の焼きが止まりました。元の表に戻しました")
        bad = []
        for b in books:
            for p in files_of(b):
                if not (Path(out) / p.name).exists():
                    bad.append(f"{p.stem}: 2 回目の表がありません")
                    continue
                one, two = (json.loads(f.read_text(encoding="utf-8")) for f in (p, Path(out) / p.name))
                d = first_diff(comparable(one), comparable(two))
                if d:
                    bad.append(f"{p.stem}: 1 回目と 2 回目が違う（そろえる決まりが足りない）: {d}")
        if bad:
            restore(books, keep)
            sys.exit("\n".join(bad) + "\n元の表に戻しました")
    print("2 回の焼きが同じです:", " ".join(books))


def restore(books, keep):
    for b in books:
        for p in files_of(b):
            if p.name not in keep:
                p.unlink()
    for name, data in keep.items():
        (BAKED / name).write_bytes(data)


def test_bins(tests):
    r = subprocess.run(["cargo", "test", "--locked", "--no-run", "--message-format=json"] + [x for t in tests for x in ("--test", t)],
                       cwd=DESKTOP, capture_output=True, text=True, check=True)
    out = {}
    for line in r.stdout.splitlines():
        m = json.loads(line)
        if m.get("reason") == "compiler-artifact" and m.get("executable") and m["target"]["kind"] == ["test"]:
            out[m["target"]["name"]] = m["executable"]
    return out


# root でない利用者で焼くときの一時の利用者（版 3.115.0 の作った後の直し: 前は nobody で流し、場面の login「nobody」と名前の置き換えが重なった）
BLESS_USER = "tpabless"


def bless_user(books):
    """root でない利用者（場面に出ない名前の一時の利用者 tpabless。無ければ作り、終わったら消す）で流して、root と違う歩を variants.user に焼く
    （root で焼いた答えは変えない）"""
    if os.geteuid() != 0:
        sys.exit("--user は root で流す（一時の利用者に替えて流す）")
    for b in books:
        for rel in BOOKS[b]["sources"]:
            if BLESS_USER in (PROGRAM / rel).read_text(encoding="utf-8"):
                sys.exit(f"一時の利用者の名前 {BLESS_USER} が場面に出ます（{rel}）。名前を替えてください")
    made = subprocess.run(["id", BLESS_USER], capture_output=True).returncode != 0
    if made:
        subprocess.run(["useradd", "-M", "-r", "-s", "/usr/sbin/nologin", BLESS_USER], check=True)
    try:
        _bless_user(books)
    finally:
        if made:
            subprocess.run(["userdel", BLESS_USER], check=False)


def _bless_user(books):
    home = Path(tempfile.mkdtemp(prefix="bless-user-"))
    out = home / "out"
    out.mkdir()
    for d in (home, out):
        os.chmod(d, 0o777)
    bins = test_bins(tests_of(books))
    for t in tests_of(books):
        env = ["env", f"HOME={home}", f"USER={BLESS_USER}", f"LOGNAME={BLESS_USER}", "TPA_BLESS=1", f"TPA_BAKE_OUT={out}", f"TPA_PYTHON={shutil.which('python3')}", "PYTHONDONTWRITEBYTECODE=1"]
        r = subprocess.run(["runuser", "-u", BLESS_USER, "--"] + env + [bins[t], "--test-threads=1"], cwd=DESKTOP, capture_output=True, text=True)
        sys.stderr.write(r.stderr[-3000:])
        if r.returncode:
            sys.exit(f"{t}: root でない利用者で止まりました")
    for b in books:
        for p in files_of(b):
            if (out / p.name).exists():
                shutil.copyfile(out / p.name, p)
                n = len(json.loads(p.read_text(encoding="utf-8")).get("variants", {}).get("user", {}))
                print(f"{p.stem}: root でない利用者で違う歩 {n}")
    shutil.rmtree(home, ignore_errors=True)


FORMS = {"python": "Python と比べる形（その PC の Python が場面を作る）", "table": "表だけの形（TPA_NO_PYTHON=1。表の宣言から場面を作る。段 ④ の後の形）"}
JSON_LINE = "measure-json| "


def measured(folders, as_json=False):
    """測るだけの仕事の記録（desktop/tests/common/bake.rs が TPA_MEASURE のフォルダに書いた <表>.json）のまとめ。落とさない。
    フォルダは流した形ごと（記録の form: python・table）。形ごとに別の行で出す（版 3.117.0）"""
    for folder in folders:
        files = sorted(Path(folder).glob("*.json")) if Path(folder).is_dir() else []
        if not files:
            print(f"測りの記録がありません（{folder}）。焼いた本の試験が TPA_MEASURE つきで流れていません")
            continue
        steps = differ = unanswered = 0
        noscene, cut_short, forms = [], [], set()
        rows = []
        for f in files:
            try:
                m = json.loads(f.read_text(encoding="utf-8"))
            except ValueError as e:
                rows.append(f"{f.stem}: 記録が読めません（{e}）")
                continue
            forms.add(m.get("form", "python"))
            d = m.get("differing", [])
            steps += m.get("steps", 0)
            differ += len(d)
            unanswered += len(m.get("missing", []))
            keys = {}
            for x in d:
                k = re.split(r"[.\[]", x.get("diff", "").split(":")[0])[-1].rstrip("]") or "?"
                keys[k] = keys.get(k, 0) + 1
            top = " ".join(f"{k}×{n}" for k, n in sorted(keys.items(), key=lambda kv: -kv[1])[:8])
            extra = "".join(f"・{name} が違う" for name in ("oracle", "scene") if m.get(name))
            if m.get("sceneError"):
                noscene.append(f.stem)
                extra += "・場面を作れなかった"
            if m.get("finished") is False:
                cut_short.append(f.stem)
                extra += "・終わりまで流れなかった（そこまでの歩の数）"
            rows.append(f"{f.stem}（{m.get('os', '?')}）: 歩 {m.get('steps', 0)}・表と違う歩 {len(d)}・表にあって答えない歩 {len(m.get('missing', []))}{extra}"
                        + (f"・違う葉の鍵 {top}" if top else ""))
            for name in ("sceneError", "scene", "oracle"):
                if m.get(name):
                    rows.append(f"    {name}: {str(m[name])[:300]}")
            for x in d[:3]:
                rows.append(f"    {x.get('key', '')}（{x.get('route', '')}）: {x.get('diff', '')[:300]}")
        form = " / ".join(FORMS.get(x, x) for x in sorted(forms)) or "?"
        print(f"== {form}（{folder}）")
        print("\n".join(rows))
        print(f"計（{form}）: 表 {len(files)} つ・歩 {steps}・焼いた表（posix）と違う歩 {differ}・表にあって答えない歩 {unanswered}"
              f"・場面を作れなかった表 {len(noscene)}" + (f"（{' '.join(noscene)}）" if noscene else "")
              + f"・終わりまで流れなかった表 {len(cut_short)}" + (f"（{' '.join(cut_short)}）" if cut_short else "")
              + "（違う歩が 0 の表は Windows でもそのまま表と比べられる）")
    if as_json:
        # 記録そのもの（1 表 1 行）。成果物の置き場に届かない所からでも、仕事の記録（log）から --from-log で戻せる
        for folder in folders:
            for f in sorted(Path(folder).glob("*.json")) if Path(folder).is_dir() else []:
                try:
                    m = json.loads(f.read_text(encoding="utf-8"))
                except ValueError:
                    continue
                print(JSON_LINE + json.dumps(m, ensure_ascii=True, separators=(",", ":")))


def from_log(log, out):
    """仕事の記録（--measured … --json の行）から、測りの記録を <out>/<形>/<表>.json に戻す → 戻した数"""
    n = 0
    for line in Path(log).read_text(encoding="utf-8", errors="replace").splitlines():
        i = line.find(JSON_LINE)
        if i < 0:
            continue
        try:
            m = json.loads(line[i + len(JSON_LINE):])
        except ValueError:
            continue
        d = Path(out) / m.get("form", "python")
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{m['file']}.json").write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
        n += 1
    return n


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == "--check":
        bad = check()
        for line in bad:
            print("  ", line)
        if bad:
            sys.exit(1)
        for line in notices():
            print("  知らせ:", line)
        print(f"焼いた表は古くありません（{sum(1 for b in BOOKS if baked(b))} 本・{len(tables())} ファイル）")
        return
    if args[0] == "--measured":
        measured([a for a in args[1:] if not a.startswith("--")] or [""], "--json" in args)
        return
    if args[0] == "--from-log":
        print(f"測りの記録 {from_log(args[1], args[2])} 個を {args[2]} に戻しました")
        return
    if args[0] == "--stats":
        stats(args[args.index("--base") + 1] if "--base" in args else None)
        return
    skip = []
    if "--skip-test" in args:
        i = args.index("--skip-test")
        skip = [x for x in args[i + 1].split(",") if x]
        del args[i:i + 2]
    books = [b for b in BOOKS if baked(b)] if "--all" in args else [a for a in args if not a.startswith("--")]
    if args[0] == "--scope":
        scope, books = args[1], args[2:]
        sys.exit(cargo(tests_of(books), {"TPA_NO_PYTHON": "1", "TPA_BLESS": scope}))
    unknown = [b for b in books if b not in BOOKS or not baked(b)]
    if unknown:
        sys.exit(f"焼く本ではありません: {unknown}")
    if "--user" in args:
        bless_user(books)
    elif "--no-python" in args:
        # Python 無し＝program/app を使わない形（独立の答え tools/*-truth.py の標準の Python は残す）。凍らせた Python を相手にする試験は流さず、
        # その名前を test result の数と別に出す（desktop/tests/common/bake.rs の frozen_python が target/tmp/frozen-skipped.txt に書く）
        skipped = Path(os.environ.get("CARGO_TARGET_DIR", DESKTOP / "target")) / "tmp" / "frozen-skipped.txt"
        skipped.unlink(missing_ok=True)
        rc = cargo([t for t in tests_of(books) if t not in skip], {"TPA_NO_PYTHON": "1"})
        names = skipped.read_text(encoding="utf-8").split() if skipped.exists() else []
        print(f"流さなかった試験（凍らせた Python を相手にする） {len(names)} 本: " + " ".join(names))
        sys.exit(rc)
    else:
        bless(books)


if __name__ == "__main__":
    main()
