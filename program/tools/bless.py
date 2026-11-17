"""窓が自分の答えを焼く（bless。版 3.115.0。Rust 化の段 ③ の 4 つ目・案 G の 1 版目）。app を import しない（標準の部品だけ）。

    python tools/bless.py 本 …            … 本ごとに TPA_BLESS=1 で窓の突き合わせの試験を流して焼き（Python と同じときだけ書く）、
                                            時刻の境（次の分）をまたいでからもう 1 度焼いて、1 回目と同じかを見る（違えば元の表に戻して止める）
    python tools/bless.py --all           … 3.115.0 の本すべて（desktop/tests/baked/books.json の phase）
    python tools/bless.py --user 本 …     … root でない利用者（nobody）で試験の実行ファイルを流し、root と違う歩を variants.user に焼く（fs・place・release_place）
    python tools/bless.py --no-python 本 … … TPA_NO_PYTHON=1 で流す（段 ④ の後の形: 表の宣言から場面を作り、焼いた答えとだけ比べる）
    python tools/bless.py --check         … cargo を流さずに、焼いた表の形と、焼いた時の元（答え合わせ役など）の指紋が今の元と同じかを見る（古さを止める。
                                            tests/test_baked_tables.py からも流れる）。違えば終了コード 1
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
PHASE = "3.115.0"


def sources_of(book):
    """焼いた時の元の指紋（desktop/tests/common/bake.rs の sources_of と同じ: \\r を除いた sha256 の頭 16 字）"""
    out = {}
    for rel in BOOKS[book]["sources"]:
        b = (PROGRAM / rel).read_bytes().replace(b"\r", b"") if (PROGRAM / rel).exists() else b""
        out[rel] = hashlib.sha256(b).hexdigest()[:16]
    return out


def check():
    """→ 食い違いの言葉の並び（空なら古くない）"""
    bad = []
    for book, b in sorted(BOOKS.items()):
        p = BAKED / f"{book}.json"
        if b["phase"] != PHASE:
            if p.exists():
                bad.append(f"{book}: 焼く版でない本（phase {b['phase']}）に表がある")
            continue
        if not p.exists():
            bad.append(f"{book}: 焼いた表がありません（python tools/bless.py {book}）")
            continue
        t = json.loads(p.read_text(encoding="utf-8"))
        for k in ("book", "os", "oracle", "scene", "answers", "routes", "sources"):
            if k not in t:
                bad.append(f"{book}: 表に {k} がありません")
        if t.get("book") != book:
            bad.append(f"{book}: 表の本の名前が {t.get('book')}")
        now = sources_of(book)
        for rel, h in now.items():
            if t.get("sources", {}).get(rel) != h:
                bad.append(f"{book}: 元 {rel} が焼いた時と違う（表が古い。python tools/bless.py {book} で焼き直す）")
        for rel in set(t.get("sources", {})) - set(now):
            bad.append(f"{book}: 表に知らない元 {rel}")
        scene = t.get("scene", {})
        for rel, e in scene.get("files", {}).items():
            if not e.get("fifo") and e.get("blob") not in scene.get("blobs", {}):
                bad.append(f"{book}: 場面のファイル {rel} の中身が無い")
        if set(t.get("answers", {})) != set(t.get("routes", {})):
            bad.append(f"{book}: 答えと道の型の鍵が合わない")
    return bad


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
    sc = t["scene"]
    files = {rel: {**e, "blob": sc["blobs"].get(e["blob"])} for rel, e in sc["files"].items()}
    s = json.dumps({"oracle": t["oracle"], "answers": t["answers"], "files": files, "dirs": sc["dirs"], "links": sc["links"],
                    "variants": t.get("variants")}, ensure_ascii=False, sort_keys=True)
    # 今からのずれと、Python が場面を作るときに引く乱数（instance_id の uuid4 の 32 字）は比べない
    return json.loads(re.sub(r"\b[0-9a-f]{32}\b", "@HEX32", re.sub(r"@NOW\(-?\d+ms", "@NOW(~", s)))


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
    keep = {b: (BAKED / f"{b}.json").read_bytes() for b in books if (BAKED / f"{b}.json").exists()}
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
            one, two = (json.loads((d / f"{b}.json").read_text(encoding="utf-8")) for d in (BAKED, Path(out)))
            d = first_diff(comparable(one), comparable(two))
            if d:
                bad.append(f"{b}: 1 回目と 2 回目が違う（そろえる決まりが足りない）: {d}")
        if bad:
            restore(books, keep)
            sys.exit("\n".join(bad) + "\n元の表に戻しました")
    print("2 回の焼きが同じです:", " ".join(books))


def restore(books, keep):
    for b in books:
        p = BAKED / f"{b}.json"
        if b in keep:
            p.write_bytes(keep[b])
        elif p.exists():
            p.unlink()


def test_bins(tests):
    r = subprocess.run(["cargo", "test", "--locked", "--no-run", "--message-format=json"] + [x for t in tests for x in ("--test", t)],
                       cwd=DESKTOP, capture_output=True, text=True, check=True)
    out = {}
    for line in r.stdout.splitlines():
        m = json.loads(line)
        if m.get("reason") == "compiler-artifact" and m.get("executable") and m["target"]["kind"] == ["test"]:
            out[m["target"]["name"]] = m["executable"]
    return out


def bless_user(books):
    """root でない利用者で流して、root と違う歩を variants.user に焼く（root で焼いた答えは変えない）"""
    if os.geteuid() != 0:
        sys.exit("--user は root で流す（nobody に替えて流す）")
    home = Path(tempfile.mkdtemp(prefix="bless-nobody-"))
    out = home / "out"
    out.mkdir()
    for d in (home, out):
        os.chmod(d, 0o777)
    bins = test_bins(tests_of(books))
    for t in tests_of(books):
        env = ["env", f"HOME={home}", "USER=nobody", "LOGNAME=nobody", "TPA_BLESS=1", f"TPA_BAKE_OUT={out}", f"TPA_PYTHON={shutil.which('python3')}", "PYTHONDONTWRITEBYTECODE=1"]
        r = subprocess.run(["runuser", "-u", "nobody", "--"] + env + [bins[t], "--test-threads=1"], cwd=DESKTOP, capture_output=True, text=True)
        sys.stderr.write(r.stderr[-3000:])
        if r.returncode:
            sys.exit(f"{t}: root でない利用者で止まりました")
    for b in books:
        if (out / f"{b}.json").exists():
            shutil.copyfile(out / f"{b}.json", BAKED / f"{b}.json")
            n = len(json.loads((BAKED / f"{b}.json").read_text(encoding="utf-8")).get("variants", {}).get("user", {}))
            print(f"{b}: root でない利用者で違う歩 {n}")
    shutil.rmtree(home, ignore_errors=True)


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
        print(f"焼いた表は古くありません（{sum(1 for b in BOOKS.values() if b['phase'] == PHASE)} 本）")
        return
    books = [b for b, v in BOOKS.items() if v["phase"] == PHASE] if "--all" in args else [a for a in args if not a.startswith("--")]
    if args[0] == "--scope":
        scope, books = args[1], args[2:]
        sys.exit(cargo(tests_of(books), {"TPA_NO_PYTHON": "1", "TPA_BLESS": scope}))
    unknown = [b for b in books if b not in BOOKS or BOOKS[b]["phase"] != PHASE]
    if unknown:
        sys.exit(f"焼く本ではありません: {unknown}")
    if "--user" in args:
        bless_user(books)
    elif "--no-python" in args:
        sys.exit(cargo(tests_of(books), {"TPA_NO_PYTHON": "1"}))
    else:
        bless(books)


if __name__ == "__main__":
    main()
