"""焼いた本を CI に似せた形で流す（版 3.116.0。採点の first_fixes 8）。app を import しない（標準の部品だけ）。

    python program/tools/ci-shape.py [記録のフォルダ] [--shape 名前,…] [--book 本,…] [--keep]

版 3.115.0 は、手元（root・リポジトリが家の外・ext4 の /tmp・手元の Python の SQLite・名前を引ける）と CI の違いで 4 回落ちた。
ここでは焼いた本の試験の実行ファイル（desktop/tests/baked/books.json の焼いた本の tests と bake_selftest）を、手元と違う形で流す:

    runner … root でない利用者（daemon。名前は runner）・家は新しい一時フォルダ・TMPDIR は別のファイル系（/dev/shm）・
              Python は /usr/bin/python3（SQLite の版が違う）・Python と比べる形
    nopy   … root でない利用者・リポジトリが家の下（HOME=リポジトリの 2 つ上）・TZ=Asia/Tokyo・TMPDIR は /dev/shm・TPA_NO_PYTHON=1。
              Python の呼び出しを記録し、呼ばれた台本が program/app を import しない物（独立の答え tools/*-truth.py と場面の台本）だけかを見る。
              PATH の先には偽の python（呼ぶと記録して 127 で落ちる）を置く（TPA_PYTHON を通らない呼び出しを見つける）
    nodns  … 名前を引く先に届かない名前空間（unshare -m で /etc/resolv.conf を差し替える）・TPA_NO_PYTHON=1

どれも試験の実行ファイルを直に流す（--test-threads=1）。落ちた本があれば終了コード 1。root で流す（利用者を替える・名前空間を作るため）。
root でない・runuser や unshare が無い PC では、流せない形を「流せない」と書いて飛ばす（終了コードは流せた形だけで決める）。
check-all.sh の段 ci-shape から流れる。
"""
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
REPO = PROGRAM.parent
DESKTOP = REPO / "desktop"
BOOKS = json.loads((DESKTOP / "tests" / "baked" / "books.json").read_text(encoding="utf-8"))["books"]
PHASES = ("3.115.0", "3.116.0")
SHAPES = ("runner", "nopy", "nodns")
USER = "daemon"
BAD = re.compile(r"test result: FAILED|panicked at|表が古い|焼いた表と違う|食い違い")
IMPORT_APP = re.compile(r"^\s*(?:from\s+app[\s.]|import\s+app\b)", re.M)
LOCAL_IMPORT = re.compile(r"^\s*(?:from\s+(?:tests|tools)\s+import\s+([\w, ]+)|from\s+(?:tests\.|tools\.)?(\w+)\s+import|import\s+(\w+))", re.M)


def tests_of(books):
    out = ["bake_selftest"]
    for b, v in BOOKS.items():
        if v["phase"] in PHASES and (not books or b in books):
            out += [t for t in v["tests"] if t not in out]
    return out


def test_bins(tests):
    """試験の実行ファイル（組んでから場所を聞く）→ {試験の名前: 場所}"""
    cmd = ["cargo", "test", "--locked", "--no-run", "--message-format=json"] + [x for t in tests for x in ("--test", t)]
    r = subprocess.run(cmd, cwd=DESKTOP, capture_output=True, text=True)
    if r.returncode:
        sys.exit("試験を組めません:\n" + r.stderr[-3000:])
    out = {}
    for line in r.stdout.splitlines():
        try:
            m = json.loads(line)
        except ValueError:
            continue
        if m.get("reason") == "compiler-artifact" and m.get("executable") and m["target"]["kind"] == ["test"]:
            out[m["target"]["name"]] = m["executable"]
    return out


def imports_app(path, seen=None):
    """台本と、そこから読む program/tests・program/tools の台本が program/app を import するか（するなら、その台本の名前）"""
    seen = seen if seen is not None else set()
    path = Path(path)
    if path in seen or not path.exists():
        return None
    seen.add(path)
    text = path.read_text(encoding="utf-8")
    if IMPORT_APP.search(text):
        return path.name
    for m in LOCAL_IMPORT.finditer(text):
        for name in re.split(r"[,\s]+", next(g for g in m.groups() if g)):
            for d in (PROGRAM / "tests", PROGRAM / "tools"):
                hit = imports_app(d / f"{name}.py", seen) if name else None
                if hit:
                    return hit
    return None


def script_of(args):
    """python の引数 → 流す台本（-c・-m は None）"""
    it = iter(args)
    for a in it:
        if a in ("-c", "-m"):
            return None
        if a in ("-X", "-W"):
            next(it, None)
        elif not a.startswith("-"):
            return a
    return None


def python_calls_ok(log):
    """Python 無しの形で呼ばれた Python: TPA_PYTHON を通った台本は app を import しない物だけ・PATH の python は呼ばれない → 食い違いの並び"""
    bad = []
    for line in log.read_text(encoding="utf-8").splitlines() if log.exists() else []:
        how, _, rest = line.partition("\t")
        args = rest.split("\t")
        if how == "PATH":
            bad.append(f"PATH の python が呼ばれた（TPA_PYTHON を通らない）: {' '.join(args)[:200]}")
            continue
        s = script_of(args)
        hit = imports_app(s) if s else None
        if hit:
            bad.append(f"Python 無しの形で program/app を import する台本が呼ばれた: {s}（{hit}）")
    return bad


def run_shape(shape, bins, out, keep):
    """→ (流した数, 落ちた試験の名前の並び, 流せなかった理由)"""
    root = os.geteuid() == 0
    if not root or not shutil.which("runuser"):
        return 0, [], "root でない・runuser が無い"
    if shape == "nodns" and not shutil.which("unshare"):
        return 0, [], "unshare が無い"
    work = Path(tempfile.mkdtemp(prefix=f"ci-shape-{shape}-", dir="/dev/shm" if Path("/dev/shm").is_dir() else None))
    os.chmod(work, 0o755)
    tmp, home = work / "tmp", work / "home"
    for d in (tmp, home):
        d.mkdir()
        os.chmod(d, 0o1777)
    env = {"PATH": os.environ.get("PATH", ""), "TMPDIR": str(tmp), "USER": "runner", "LOGNAME": "runner", "PYTHONDONTWRITEBYTECODE": "1"}
    pre, user = [], USER
    log = work / "python-calls.log"
    if shape == "runner":
        env.update(HOME=str(home), TPA_PYTHON="/usr/bin/python3" if Path("/usr/bin/python3").exists() else sys.executable)
    else:
        # Python の呼び出しを記録する（TPA_PYTHON は記録してから本物へ。PATH の python は記録して 127）
        real = shutil.which("python3") or sys.executable
        fake = work / "bin"
        fake.mkdir()
        rec = work / "pyrec"
        rec.write_text(f'#!/bin/sh\n{{ printf "TPA"; for a in "$@"; do printf "\\t%s" "$a"; done; echo; }} >> "{log}"\nexec "{real}" "$@"\n')
        for name in ("python", "python3"):
            (fake / name).write_text(f'#!/bin/sh\n{{ printf "PATH"; for a in "$@"; do printf "\\t%s" "$a"; done; echo; }} >> "{log}"\nexit 127\n')
        for f in (rec, fake / "python", fake / "python3"):
            f.chmod(f.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        log.touch()
        log.chmod(0o666)
        env.update(TPA_NO_PYTHON="1", TPA_PYTHON=str(rec), PATH=f"{fake}:{env['PATH']}")
        if shape == "nopy":
            # リポジトリが家の下にある PC（CI の /home/runner/work/…）と、時差のある PC
            env.update(HOME=str(REPO.parent.parent), TZ="Asia/Tokyo")
        else:
            env.update(HOME=str(home))
            dead = work / "resolv.conf"
            dead.write_text("nameserver 192.0.2.1\noptions timeout:1 attempts:1\n")
            pre, user = ["unshare", "-m", "sh", "-c", f'mount --bind "{dead}" /etc/resolv.conf && exec "$@"', "sh"], None
    failed, ran = [], 0
    for name, exe in bins.items():
        cmd = ["env", "-i"] + [f"{k}={v}" for k, v in env.items()] + [exe, "--test-threads=1"]
        if user:
            cmd = ["runuser", "-u", user, "--"] + cmd
        t0 = time.time()
        r = subprocess.run(pre + cmd, cwd=DESKTOP, capture_output=True, text=True, encoding="utf-8", errors="replace")
        ran += 1
        text = r.stdout + r.stderr
        (out / f"{shape}-{name}.log").write_text(text, encoding="utf-8")
        ok = r.returncode == 0 and "test result: ok" in text and not re.search(r"test result: FAILED|panicked at", text)
        print(f"  [{shape}] {'ok' if ok else 'NG'} {name}（{time.time() - t0:.0f} 秒）", flush=True)
        if not ok:
            failed.append(name)
            for line in [x for x in text.splitlines() if BAD.search(x)][:6]:
                print("      " + line[:260])
    if shape != "runner":
        calls = python_calls_ok(log)
        shutil.copyfile(log, out / f"{shape}-python-calls.log")
        for c in calls:
            print(f"  [{shape}] NG {c}")
        if calls:
            failed.append("python-calls")
    if not keep:
        subprocess.run(["chmod", "-R", "u+rwx", str(work)], capture_output=True)
        shutil.rmtree(work, ignore_errors=True)
    return ran, failed, ""


def main():
    args = sys.argv[1:]

    def opt(name):
        return [x for x in args[args.index(name) + 1].split(",") if x] if name in args else []
    rest = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] not in ("--shape", "--book"))]
    out = Path(rest[0]) if rest else Path(tempfile.mkdtemp(prefix="ci-shape-log-"))
    out.mkdir(parents=True, exist_ok=True)
    shapes = opt("--shape") or list(SHAPES)
    unknown = [s for s in shapes if s not in SHAPES]
    if unknown:
        sys.exit(f"知らない形: {unknown}（{', '.join(SHAPES)}）")
    bins = test_bins(tests_of(opt("--book")))
    print(f"焼いた本の試験 {len(bins)} 本を CI に似せた形で流します（記録 {out}）", flush=True)
    rc = 0
    for s in shapes:
        ran, failed, why = run_shape(s, bins, out, "--keep" in args)
        if why:
            print(f"[{s}] 流せない（{why}）")
            continue
        print(f"[{s}] 流した {ran} 本・落ちた {len(failed)} 本" + (f": {' '.join(failed)}" if failed else ""), flush=True)
        rc |= bool(failed)
    print("ci-shape: " + ("落ちた形があります" if rc else "すべて通りました"))
    sys.exit(rc)


if __name__ == "__main__":
    main()
