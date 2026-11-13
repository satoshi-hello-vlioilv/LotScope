# -*- coding: utf-8 -*-
"""配る形と更新の通しを、本物の窓で確かめる（評価関数・設計書「更新（B+）」）。Windows の CI と、手元の Linux（xvfb-run の下）で流す。

    python verify.py update --exe <作った exe> [--work <作業フォルダ>] [--keep]
    python verify.py local --exe <作った exe> [--work <作業フォルダ>] [--keep]   作業場所の窓だけ・Python の無い PC（版 3.111.0）
    python verify.py rename --old-exe <前の版の exe> --old-repo <前の版のリポジトリ> --exe <作った exe> [--work …] [--keep]

利用者の PC を真似る: 作業場所（TRANSFER_LOCAL_ROOT）はまっさら、配る形は共有を真似たフォルダ、更新の置き場は BOX を真似たフォルダ。
窓は自己診断（TPA_SELFTEST）で起こし、結果のファイル（selftest.js が更新の係の状態と、動いている exe・program を添える）を読む。

  1. 共有の exe を開く → この PC の app へ写り、版ごとの写しの窓で開く。使っている間に置き場の次の版（+1）を取り込む（ready）。置き場を控える
  2. app の exe（ショートカットの行き先）を開く → 起動の最初に +1 へ入れ替わり、その版で開く。直前の版は控えに
  3. 閉じている間に次の版（+2）を置く → ショートカットから 1 回開くだけで +2 になる（起動の最初に取り込んで入れ替える・版 3.38.0）
  4. 窓が描けない版（+3。templates/index.html を消した）を置く。取り込みは窓の準備で断る（版 3.111.0）。前の版の窓が取り込んだ形
     （update の stage に直に置く）で 1 回開く → +3 へ入れ替えるが窓の準備が通らず、画面を開く前に控え（+2）へ戻して開き直す。+3 には印（理由つき）
  4b. Python だけ壊れた版（+4。sidecar.py を壊した）→ 戻さず、その版のまま開く。心拍 200・python stopped・窓だけの自己診断の項目が通る・
     利用状況に中身の様子・確かめの印は画面の最初の心拍で消える
  4c. Python が遅い版（+5。sidecar.py の頭で 30 秒眠る）→ 画面は待たずに開き、確かめの印は数秒で消え（Python の準備より前）、ショートカットも直る
  4d. 入れ替えた直後に配った設定が JSON でない（+6。環境の失敗）→ 戻さない。Python はすぐ終わるが、窓は画面を既定の形で描き、画面の JS が心拍を送る
  4e. 画面の JS（app.js）が壊れた版（+7）→ 画面の JS が設定を尋ねもせず心拍も来ないので、60 秒で控え（+6）へ戻す（自己診断の心拍は数えない）
  5. 配る版を前の版（+1。distribute.json）に戻す → 1 回開くだけで配る版になり、配る版を作業場所に覚える（want.json）
  6. 新しい PC（まっさらな作業場所）が配る入口を開くだけで、配る版をこの PC へ入れて開き、入口の置き場を控える
  ショートカット: 無ければ画面が尋ねる・共有を指すショートカットは次の起動でこの PC の app（作業フォルダも）に直す
  あわせて: 共有の配る形は 1 ファイルも変わらない・終わったあと Python が残らない。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import bundle

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
# 1 回開いて結果のファイルが置かれるまで待つ秒。自己診断だけで約 130 秒（手元・CI とも）、そこへ起動の最初の取り込み（150 MB の zip を
# 確かめて解く）と入れ替え・新しい PC の据え付けが乗る。手元では開いてから結果まで約 160 秒だが、CI の Linux はファイルを写すのが
# 約 3.5 倍遅く（6 段目の据え付け: 手元 22 秒・CI 約 76 秒）、3・5 段目が 240 秒の際にあった（版 3.98.0 の CI も 2〜5 段目にかかった
# 時間は版 3.99.0 で 240 秒切れになったときとほぼ同じ）。版 3.99.0 の CI で 3 段目が切れ、切れた窓が動いたまま 4・5 段目を開いて
# 続けて落ちた。待つ秒を延ばし、段ごとにかかった秒と空きを書く（際に近づいたら記録で分かる）。切れたら窓の記録を出し、窓を止めてから進む
WAIT = 480

# 窓だけの自己診断の項目（版 3.111.0。selftest.js の okw）。Python が居ない通し（local・4b）で、これが全部あって通り、ほかの項目は
# 「中身（Python）を通す項目」の包みに数えて飛ばしたことを見る。selftest.js の okw と食い違えば local の通しが落ちる
WINDOW_ONLY = [
    "起動が終わる（設定と権限を読み終える）", "画面の題（窓が描いた HTML・アプリの名前）", "画面の JS が動いている（TPA の共通部品）",
    "部品は Rust が返す（指紋付きは長く使い回す）", "指紋の無い部品は毎回確かめる（no-cache）", "大きな部品（three.js）も Rust が返す",
    "画面は窓が描く（使い回さない・CSP の印）", "窓が答える誤り（画面の設定の控え）",
    "心拍は窓が答える（中身の様子を添える。版 3.111.0 から中身が止まっていても 200）",
    "安全な文脈（クリップボードへ写せる）", "localStorage が使える", "IndexedDB が使える", "保存: CSV が日本語の名前どおり・中身どおりに届く",
    "一覧は Rust が答える", "データの時刻は Rust が答える（共有を見に行かない）", "配布の画面の係が答える（置き場に届くか・権限）",
    "配布の画面: 覚えた答えをすぐ返す（cached=1）",
    "権限: 窓が決めた名乗りで答え（版 3.76.0 から窓が答える）、画面が名乗った見出しは効かない",
    "出さないタブを出さない・権限の札とマスタ管理の入口は窓の名乗り（中身が止まっていても）",
    "利用状況のいま使っている印に中身の様子（起きていなければ stopped・起きていれば無い）", "画面のエラーが無い",
    "更新の係が答える（取り込めない理由が無い）", "中身（Python）を通す項目",
]
# 窓だけの項目のうち、試す形によって出ない物（版を置けない人だけ・例外のときだけ）
WINDOW_MAYBE = {"版を置けない人は理由つきで断られる", "例外", "更新の係が答える"}


def window_only_ok(r: dict, label: str) -> tuple[bool, str]:
    """Python が居ない通しの自己診断: 窓だけの項目が全部あって通り、ほかは包みに数えた（飛ばした）か"""
    res = r.get("results", [])
    names = [x["name"] for x in res]
    missing = [n for n in WINDOW_ONLY if n not in names]
    extra = [n for n in names if n not in WINDOW_ONLY and n not in WINDOW_MAYBE]
    bad = [x["name"] for x in res if not x["ok"]]
    good = r.get("python") == "stopped" and r.get("skipped", 0) > 0 and not missing and not extra and not bad
    return good, f"python={r.get('python')} 飛ばした {r.get('skipped')}・無い {missing}・余分 {extra}・通らない {bad}"


def bump(v: str, n: int) -> str:
    a, b, c = (int(x) for x in v.split("."))
    return f"{a}.{b}.{c + n}"


def tree_digest(root: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(x for x in root.rglob("*") if x.is_file()):
        h.update(p.relative_to(root).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def place(stage: Path, version: str, rel_root: Path, broken: str = "") -> None:
    """配る形 stage の版を書き換えて ZIP にし、置き場の <アプリ>/<版>/ に release.json と並べて置く。
    broken: "window"＝窓が描けない版（画面の型を消す）・"python"＝Python だけ起きない版・"slow"＝Python が 30 秒遅い版・
    "js"＝画面の JS（app.js）が読み込みで落ちる版"""
    b = bundle.brand()
    work = Path(tempfile.mkdtemp(prefix="da-variant-"))
    try:
        top = work / b["name"]
        shutil.copytree(stage, top)
        vp = top / "program" / "app" / "version.py"
        text = vp.read_text(encoding="utf-8")
        old = bundle.app_version(top / "program")
        vp.write_text(text.replace(f'APP_VERSION = "{old}"', f'APP_VERSION = "{version}"', 1), encoding="utf-8")
        side = top / "program" / "sidecar.py"
        if broken == "window":   # 窓が描けない版（取り込みの窓の準備で断る・起動の窓の準備で戻す）
            (top / "program" / "app" / "templates" / "index.html").unlink()
        elif broken == "python":   # 中身（Python）だけが起動できない版（窓の準備は通る。戻さない）
            side.write_text('raise SystemExit("試験のために壊した版")\n', encoding="utf-8")
        elif broken == "js":   # 画面の JS が構文の誤りで落ちる版（窓の準備は JS を読まないので通る。画面の最初の心拍で戻す）
            js = top / "program" / "app" / "static" / "js" / "app.js"
            js.write_text(js.read_text(encoding="utf-8") + "\nfunction ( {\n", encoding="utf-8")
        elif broken == "slow":   # 中身の準備が 30 秒遅い版（Windows の Defender の走査・遅いディスクの見立て）
            head = "from __future__ import annotations\n"     # __future__ の行より前には書けない
            text = side.read_text(encoding="utf-8")
            assert head in text, "sidecar.py の頭が変わった"
            side.write_text(text.replace(head, head + "import time as _verify_time\n_verify_time.sleep(30)\n", 1), encoding="utf-8")
        dest = rel_root / b["name"] / version
        dest.mkdir(parents=True, exist_ok=True)
        zip_name = f"{b['name']}-{version}-windows.zip"
        bundle.zip_dir(top, b["name"], dest / zip_name)
        rel = bundle.release_json(b, version, zip_name, bundle.sha256_file(dest / zip_name))
        (dest / "release.json").write_text(json.dumps(rel, ensure_ascii=False, indent=1), encoding="utf-8")
    finally:
        shutil.rmtree(work, ignore_errors=True)


class Run:
    def __init__(self, work: Path, env: dict):
        self.work, self.env, self.n = work, env, 0

    def open(self, exe: Path, label: str) -> dict:
        """exe を開き、自己診断の結果を待つ（入口・写し・開き直しの窓をたどった先の窓が書く）。"""
        self.n += 1
        out = self.work / f"selftest-{self.n}-{label}.json"
        env = {**self.env, "TPA_SELFTEST": str(out)}
        subprocess.Popen([str(exe)], cwd=str(exe.parent), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        t0 = time.time()
        end = t0 + WAIT
        while time.time() < end and not out.exists():
            time.sleep(1)
        took = time.time() - t0
        time.sleep(3)    # 窓と Python が終わるのを待つ
        print(f"  [{label}] 開いてから結果まで {took:.0f} 秒（待つのは {WAIT} 秒まで）・空き {free_gb(self.work):.1f} GB")
        if not out.exists():
            self.tell_timeout(label)
            return {"ok": False, "error": f"{WAIT} 秒たっても結果がありません（{label}）"}
        r = json.loads(out.read_text(encoding="utf-8"))
        # 試験の版は program の版だけを書き換えた物（窓の exe は元の版のまま）なので、「窓の版と中身の版が同じ」は数えない。
        # 本物の配る形では、窓と中身は同じ版で作る（bundle.py・test_version.py）
        res = [x for x in r.get("results", []) if x["name"] != "窓の版と中身の版が同じ"]
        for x in res:
            if not x["ok"]:
                print(f"  [{label}] FAIL {x['name']} -- {x['info']}")
        if r.get("error"):    # 窓が自己診断の前に書いた誤り（見張りの時間切れ・起動の失敗）。前は出さず、版の無い FAIL だけが見えた
            print(f"  [{label}] ERROR {r['error']}")
        if "results" in r:
            r["ok"] = bool(res) and all(x["ok"] for x in res)
        return r


    def tell_timeout(self, label: str) -> None:
        """結果が来なかった段: 作業場所の窓・Python の記録の終わりを出し（CI で何が止まったか分かるように）、その段の窓を止める
        （動いたまま次の段を開くと、同じ app を 2 つの窓が使い、次の段も続けて落ちる。版 3.99.0 の CI の 4・5 段目）"""
        logs = Path(self.env.get("TRANSFER_LOCAL_ROOT", "")) / "logs"
        for name in ("desktop.log", "app.log", "sidecar_stderr.log"):
            f = logs / name
            if f.is_file():
                tail = f.read_text(encoding="utf-8", errors="replace").splitlines()[-25:]
                print(f"  [{label}] {name} の終わり:")
                for line in tail:
                    print(f"    {line[:300]}")
        stopped = stop_leftovers(self.work)
        if stopped:
            print(f"  [{label}] 残っていた窓・Python を止めた: {stopped}")


def free_gb(path: Path) -> float:
    try:
        return shutil.disk_usage(path).free / 1e9
    except OSError:
        return -1.0


def stop_leftovers(root: Path) -> list[str]:
    """作業フォルダの窓・Python を止める（Linux は /proc。Windows は省く）"""
    if os.name == "nt":
        return []
    import signal
    out = []
    for d in Path("/proc").iterdir():
        if d.name.isdigit() and int(d.name) != os.getpid():
            try:
                cmd = (d / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
            except OSError:
                continue
            if str(root) in cmd and "verify.py" not in cmd:
                try:
                    os.kill(int(d.name), signal.SIGKILL)
                    out.append(f"{d.name}: {cmd[:120]}")
                except OSError:
                    pass
    if out:
        time.sleep(2)
    return out


def check(cond: bool, what: str, info="") -> bool:
    print(("PASS " if cond else "FAIL ") + what + (f" -- {info}" if info else ""))
    return cond


def make_link(link: Path, target: Path, workdir: Path) -> None:
    """人が作ったショートカットを真似る（Windows は WScript.Shell、ほかは窓の lnk.rs と同じ小さな JSON）。"""
    link.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{link}');$s.TargetPath='{target}';"
              f"$s.WorkingDirectory='{workdir}';$s.Save()")
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
    else:
        link.write_text(json.dumps({"target": str(target), "workdir": str(workdir), "description": ""}), encoding="utf-8")


def read_link(link: Path):
    """→ (指す先, 作業フォルダ)。無ければ None。"""
    if not link.exists():
        return None
    if os.name == "nt":
        ps = f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{link}');$s.TargetPath;$s.WorkingDirectory"
        out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True).stdout.splitlines()
        return (Path(out[0]), Path(out[1])) if len(out) >= 2 else None
    v = json.loads(link.read_text(encoding="utf-8"))
    return Path(v["target"]), Path(v["workdir"])


def stage_by_old_window(rel_dir: Path, local: Path, version: str) -> None:
    """前の版の窓（取り込みで窓の準備を見ない）が取り込んだ形: 置き場の ZIP を update の stage に直に解き、stage.json を書く"""
    rel = json.loads((rel_dir / "release.json").read_text(encoding="utf-8"))
    tmp = Path(tempfile.mkdtemp(prefix="da-oldstage-"))
    try:
        with zipfile.ZipFile(rel_dir / rel["zip"]) as z:
            z.extractall(tmp)
        root = next(p.parent for p in tmp.rglob("sidecar.py") if p.parent.name == "program").parent
        stage = local / "update" / "stage"
        shutil.rmtree(stage, ignore_errors=True)
        shutil.copytree(root, stage)
        if os.name != "nt":
            (stage / rel["exe"]).chmod(0o755)
        (local / "update" / "stage.json").write_text(json.dumps({"version": version, "exe": rel["exe"], "sha256": rel["sha256"],
                                                                 "from": str(rel_dir / rel["zip"]), "at": "verify"}), encoding="utf-8")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def desktop_log(local: Path) -> list[str]:
    f = local / "logs" / "desktop.log"
    return f.read_text(encoding="utf-8", errors="replace").splitlines() if f.is_file() else []


def boot_log_has(local: Path, text: str) -> bool:
    return any(text in line for line in desktop_log(local))


def boot_ms(local: Path, text: str):
    """最後の起動（START の行のあと）で text の行が書かれたのは、起動してから何 ms か（行の秒の差。READY は spawn_ms）"""
    lines = desktop_log(local)
    start = max((i for i, line in enumerate(lines) if " START " in line), default=None)
    if start is None:
        return None
    t0 = int(lines[start].split(" ", 1)[0])
    for line in lines[start:]:
        if text in line:
            if "spawn_ms=" in line:
                return int(line.split("spawn_ms=")[1].split()[0])
            return (int(line.split(" ", 1)[0]) - t0) * 1000
    return None


def same(a, b) -> bool:
    return os.path.normcase(os.path.realpath(str(a))) == os.path.normcase(os.path.realpath(str(b)))


def leftover_python(root: Path) -> list[str]:
    """作業フォルダの program を動かしている Python が残っていないか（Linux は /proc、Windows は wmic の代わりに tasklist では見えないので省く）。"""
    if os.name == "nt":
        return []
    out = []
    for d in Path("/proc").iterdir():
        if d.name.isdigit():
            try:
                cmd = (d / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
            except OSError:
                continue
            if "sidecar.py" in cmd and str(root) in cmd:
                out.append(f"{d.name}: {cmd[:120]}")
    return out


def update(exe: Path, work: Path) -> bool:
    b = bundle.brand()
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    built = bundle.build(exe, work / "out")
    v0 = built["version"]
    v1, v2 = bump(v0, 1), bump(v0, 2)
    share = work / "share"
    with zipfile.ZipFile(built["path"]) as z:
        z.extractall(share)
    share_app = share / b["name"]
    share_exe = share_app / b["exe"]
    if os.name != "nt":
        share_exe.chmod(0o755)
    share_digest = tree_digest(share_app)
    rel_root = work / "Releases"
    place(Path(built["stage"]), v0, rel_root)     # 置き場には配った版も並ぶ（配る版を前の版に戻すときに選ぶ）
    place(Path(built["stage"]), v1, rel_root)
    fixture = work / "q.sqlite3"
    subprocess.run([sys.executable, str(REPO / "program" / "tests" / "lotlist_fixture.py"), str(fixture), "300"], check=True, capture_output=True)
    conf = work / "appsettings.json"
    subprocess.run([sys.executable, str(REPO / "program" / "tests" / "selftest_config.py"), str(fixture), str(conf), str(rel_root)], check=True)
    local = work / "local"
    links = [work / "links" / "Desktop", work / "links" / "Programs"]
    env = {k: v for k, v in os.environ.items() if k not in ("TPA_NO_HANDOFF", "TPA_PROGRAM_DIR", "TPA_SELFTEST")}
    env.update({"TRANSFER_APP_CONFIG": str(conf), "TRANSFER_LOCAL_ROOT": str(local), "TPA_LINK_DIRS": os.pathsep.join(map(str, links))})
    run = Run(work, env)
    app = local / "app"
    ok = True

    # 1. 共有の exe を開く
    r = run.open(share_exe, "share")
    info, upd = r.get("info") or {}, r.get("update") or {}
    ok &= check(r.get("ok") is True, "1. 共有の exe で開くと自己診断が通る", r.get("error", ""))
    ok &= check(Path(info.get("program", "")).resolve() == (app / "program").resolve(), "1. この PC の app の program で動く", info.get("program"))
    ok &= check(str(local / "desktop") in str(info.get("exe", "")), "1. 窓は版ごとの写しで動く（app を掴まない）", info.get("exe"))
    ok &= check(info.get("installed") is True and info.get("version") == v0, f"1. 版 {v0}", json.dumps(info, ensure_ascii=False))
    ok &= check(upd.get("state") == "ready" and upd.get("ready") == v1, f"1. 使っている間に {v1} を取り込んだ", json.dumps(upd, ensure_ascii=False)[:300])
    ok &= check(bundle.app_version(app / "program") == v0, "1. 取り込んでも動いている app はそのまま")
    sc = ((info.get("install") or {}).get("shortcut") or {})
    ok &= check(sc.get("ask") is True and not sc.get("links"), "1. ショートカットが無いので画面が尋ねる", sc)
    # 人が作った、共有の exe を指し作業フォルダも共有のショートカット（次の起動で直る）
    lnk = links[0] / f"{b['name']}.lnk"
    make_link(lnk, share_exe, share_app)

    # 2. ショートカットの行き先（app の exe）で開く → 入れ替わる
    r = run.open(app / b["exe"], "app")
    info, upd = r.get("info") or {}, r.get("update") or {}
    ok &= check(r.get("ok") is True, "2. app の exe で開くと自己診断が通る", r.get("error", ""))
    ok &= check(info.get("version") == v1, f"2. 起動の最初に {v1} へ入れ替わった", info.get("version"))
    ok &= check(bundle.app_version(local / "update" / "old" / "program") == v0, f"2. 直前の版 {v0} は控えに")
    ok &= check(upd.get("state") == "latest", "2. 置き場の最新を使っている", upd.get("state"))
    got = read_link(lnk)
    ok &= check(bool(got) and same(got[0], app / b["exe"]) and same(got[1], app),
                "2. 共有を指していたショートカットを、この PC の app（作業フォルダも app）に直した", got)

    ok &= check((local / "update" / "source.json").is_file(), "2. 更新の置き場を控えた（次の起動の最初に、中身を起こす前に確かめる）")

    # 3. 閉じている間に次の版を置く → ショートカットから 1 回開くだけで入れ替わる（要望 2026-10: 以前は 2 回開く必要があった）
    v3 = bump(v0, 3)
    place(Path(built["stage"]), v2, rel_root)
    r = run.open(app / b["exe"], "closed-new")
    info, upd = r.get("info") or {}, r.get("update") or {}
    ok &= check(r.get("ok") is True and info.get("version") == v2, f"3. 閉じている間に置いた {v2} に、1 回の起動で入れ替わった", info.get("version"))
    ok &= check(upd.get("state") == "latest", "3. 開いたあとは置き場の最新を使っている", upd.get("state"))

    # 4. 窓が描けない版（v3）: 置き場に置いても取り込みで断る（窓の準備。版 3.111.0）。前の版の窓が取り込んだ形（update の stage に直に置く）で
    #    1 回開く → 入れ替えるが窓の準備が通らず、画面を開く前に控え（v2）へ戻して開き直す。v3 には理由つきの印
    place(Path(built["stage"]), v3, rel_root, broken="window")
    stage_by_old_window(rel_root / b["name"] / v3, local, v3)
    r = run.open(app / b["exe"], "revert")
    info, upd = r.get("info") or {}, r.get("update") or {}
    ok &= check(r.get("ok") is True and info.get("version") == v2, f"4. {v3} は窓の準備が通らず、{v2} に戻して開き直した", info.get("version"))
    fj = json.loads((local / "update" / "FAILED.json").read_text(encoding="utf-8")) if (local / "update" / "FAILED.json").exists() else {}
    failed = fj.get("versions", [])
    ok &= check(failed == [v3], f"4. {v3} に起動できなかった印", failed)
    ok &= check("画面の型" in json.dumps((fj.get("why") or {}).get(v3, {}), ensure_ascii=False), "4. 印に理由（窓の準備: 画面の型）", fj.get("why"))
    ok &= check(upd.get("state") == "latest" and v3 in (upd.get("failed") or []), "4. 起動できなかった版はもう取り込まない", json.dumps(upd, ensure_ascii=False)[:300])
    ok &= check(boot_log_has(local, "窓の準備が通りません"), "4. 窓の記録に窓の準備の失敗", "")

    # 4b. Python だけ壊れた版（v4）→ 取り込み・入れ替え、戻さず開く（Python の失敗は帯と心拍の python で見せる）
    v4, v5 = bump(v0, 4), bump(v0, 5)
    place(Path(built["stage"]), v4, rel_root, broken="python")
    r = run.open(app / b["exe"], "python-broken")
    info = r.get("info") or {}
    good, why = window_only_ok(r, "python-broken")
    ok &= check(info.get("version") == v4, f"4b. Python だけ壊れた {v4} は戻さず、その版で開く", info.get("version"))
    ok &= check(good, "4b. 心拍 200・python stopped・窓だけの自己診断の項目が通り、Python を通す項目は包みに数えた", why)
    ok &= check(not (local / "update" / "applied.json").exists(), "4b. 確かめの印は画面の最初の心拍で消えた（Python を待たない）")
    fj = json.loads((local / "update" / "FAILED.json").read_text(encoding="utf-8"))
    ok &= check(fj.get("versions") == [v3], f"4b. {v4} に印を付けない", fj.get("versions"))
    # いま使っている印は窓を閉じると消えるので、開いている間に自己診断が読んだ物で見る
    pres = next((x for x in r.get("results", []) if x["name"].startswith("利用状況のいま使っている印")), {})
    ok &= check(pres.get("ok") is True and '"stopped"' in pres.get("info", ""), "4b. 利用状況のいま使っている印に中身の様子（stopped）", pres.get("info"))

    # 4c. Python が遅い版（v5）→ 画面は待たずに開き、確かめの印は数秒で消え（Python の準備より前）、ショートカットも直る
    place(Path(built["stage"]), v5, rel_root, broken="slow")
    make_link(lnk, share_exe, share_app)    # 直す物を作っておく（共有を指すショートカット）
    r = run.open(app / b["exe"], "python-slow")
    info = r.get("info") or {}
    ok &= check(r.get("ok") is True and info.get("version") == v5 and r.get("python") == "ready", f"4c. Python が遅い {v5} で開き、自己診断が通る",
                f"{info.get('version')} python={r.get('python')} {r.get('error', '')}")
    confirm_ms, ready_ms = boot_ms(local, "BOOT 入れ替えた版を確かめた"), boot_ms(local, "READY")
    ok &= check(confirm_ms is not None and confirm_ms < 15000 and (ready_ms is None or confirm_ms < ready_ms),
                "4c. 確かめの印は画面の最初の心拍で消えた（数秒・Python の準備より前）", f"確かめ {confirm_ms} ms・Python の準備 {ready_ms} ms")
    got = read_link(lnk)
    ok &= check(bool(got) and same(got[0], app / b["exe"]), "4c. ショートカットも直った（Python の準備を待たない）", got)

    # 4d. 入れ替えた直後に、配った設定が JSON でない（環境の失敗）→ 戻さない（版 3.111.0 の作った後の採点の割れ 1・5）
    v6, v7 = bump(v0, 6), bump(v0, 7)
    place(Path(built["stage"]), v6, rel_root)
    good_conf = conf.read_text(encoding="utf-8")
    conf.write_text("{ 試験のために壊した配った設定", encoding="utf-8")
    try:
        r = run.open(app / b["exe"], "badconf")
    finally:
        conf.write_text(good_conf, encoding="utf-8")
    info = r.get("info") or {}
    fj = json.loads((local / "update" / "FAILED.json").read_text(encoding="utf-8"))
    ok &= check(info.get("version") == v6 and fj.get("versions") == [v3], f"4d. 配った設定が JSON でなくても {v6} を戻さない", f"{info.get('version')} {fj.get('versions')}")
    ok &= check(not (local / "update" / "applied.json").exists() and boot_log_has(local, "BOOT 入れ替えた版を確かめた"),
                "4d. 画面の JS が心拍を送り、確かめの印が消えた", "")
    # 配った設定が読めないので一覧などは 503 で答える（窓だけの項目のうち設定の要る物は通らない）。見るのは、画面の JS が読み込みで落ちないこと
    errs = next((x for x in r.get("results", []) if x["name"] == "画面のエラーが無い"), {})
    ok &= check(r.get("python") == "stopped" and errs and "before initialization" not in errs.get("info", "") and "ReferenceError" not in errs.get("info", ""),
                "4d. Python は止まったが画面の JS は落ちない（読み込みの途中に中身が止まった知らせが来ても）", f"python={r.get('python')} {errs.get('info', '')[:200]}")

    # 4e. 画面の JS が壊れた版 → 60 秒で戻す（自己診断の心拍は合図に数えない）
    place(Path(built["stage"]), v7, rel_root, broken="js")
    r = run.open(app / b["exe"], "js-broken")
    info = r.get("info") or {}
    fj = json.loads((local / "update" / "FAILED.json").read_text(encoding="utf-8"))
    ok &= check(r.get("ok") is True and info.get("version") == v6, f"4e. 画面の JS が壊れた {v7} は {v6} に戻して開き直した", info.get("version"))
    ok &= check(fj.get("versions") == [v3, v7] and "画面の JS が起きません" in json.dumps((fj.get("why") or {}).get(v7, {}), ensure_ascii=False),
                f"4e. {v7} に理由つきの印（画面の JS が起きません）", fj)

    # 5. 配る版を前の版（v1）に戻す → 1 回開くだけで配る版になり、配る版を作業場所に覚える
    (rel_root / b["name"] / "distribute.json").write_text(json.dumps(
        {"schema": 1, "app_id": b["app_id"], "version": v1, "entry": b["exe"], "setAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
         "setBy": "verify", "setPc": "verify", "previous": v2}, ensure_ascii=False), encoding="utf-8")
    r = run.open(app / b["exe"], "distribute-down")
    info, upd = r.get("info") or {}, r.get("update") or {}
    want = json.loads((local / "want.json").read_text(encoding="utf-8")) if (local / "want.json").exists() else {}
    ok &= check(r.get("ok") is True and info.get("version") == v1, f"5. 配る版を {v1} に戻すと、1 回の起動でその版になる", info.get("version"))
    ok &= check(want.get("version") == v1, "5. 配る版を作業場所に覚えた（Python の利用状況が最新版に使う）", want)
    ok &= check(upd.get("state") == "latest", "5. 開いたあとは配る版を使っている", json.dumps(upd, ensure_ascii=False)[:300])

    # 6. 新しい PC: 配る入口（置き場のアプリのフォルダの exe）を開くだけで、配る版を取り込んでこの PC で開く
    entry = rel_root / b["name"] / b["exe"]
    shutil.copy2(share_exe, entry)
    local2 = work / "local-new-pc"
    run2 = Run(work, {**env, "TRANSFER_LOCAL_ROOT": str(local2), "TPA_LINK_DIRS": os.pathsep.join(str(work / "links2" / n) for n in ("Desktop", "Programs"))})
    r = run2.open(entry, "entry")
    info = r.get("info") or {}
    ok &= check(r.get("ok") is True and info.get("version") == v1 and info.get("installed") is True,
                f"6. 配る入口を開くと、配る版 {v1} をこの PC の app に入れて開く", json.dumps(info, ensure_ascii=False)[:300])
    ok &= check(Path(info.get("program", "")).resolve() == (local2 / "app" / "program").resolve(), "6. 動くのはこの PC の app", info.get("program"))
    remembered = json.loads((local2 / "entry.json").read_text(encoding="utf-8")).get("dir") if (local2 / "entry.json").exists() else None
    ok &= check(remembered and same(remembered, rel_root / b["name"]), "6. 入口の置き場を控えた（参照先の置き場が見えない PC でも更新が届く）", remembered)

    ok &= check(tree_digest(share_app) == share_digest, "共有の配る形は 1 ファイルも変わらない")
    left = leftover_python(work)
    ok &= check(not left, "終わったあと Python が残らない", left)
    return ok


def local(exe: Path, work: Path) -> bool:
    """作業場所の窓だけ（この PC の app でない・開発の形）を、Python の無い PC で開く（版 3.111.0）: TPA_PYTHON を無い道にし、PATH からも
    Python を外す（窓は PATH の python3 へ落ちる）。窓は画面を開き、心拍 200・python stopped・窓だけの自己診断の項目が通る。
    Windows では窓が PATH の外の py ランチャー（WINDIR\\py.exe）も探すので、Linux（CI の ci.yml・check-all.sh --verify）で流す"""
    if os.name == "nt":
        print("local: Windows では py ランチャーが PATH の外にあるので流さない（Linux で流す）")
        return True
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    fixture = work / "q.sqlite3"
    subprocess.run([sys.executable, str(REPO / "program" / "tests" / "lotlist_fixture.py"), str(fixture), "300"], check=True, capture_output=True)
    conf = work / "appsettings.json"
    subprocess.run([sys.executable, str(REPO / "program" / "tests" / "selftest_config.py"), str(fixture), str(conf), str(work / "Releases")], check=True)
    empty = work / "no-python-bin"
    empty.mkdir()
    # 出さないタブを決めておく（一般ユーザーに「計算」を出さない）: Python が居なくても窓の名乗りで隠すかを見る
    masters = work / "masters"
    masters.mkdir(exist_ok=True)
    (masters / "tab_access.json").write_text(json.dumps({"schema": 1, "revision": 1, "rows": [
        {"id": 1, "タブ": "calc", "出さない区分": "一般ユーザー・メンテナンス者・設備作業者"}]}, ensure_ascii=False), encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k not in ("TPA_PROGRAM_DIR", "TPA_SELFTEST", "TPA_PYTHON")}
    env.update({"TRANSFER_APP_CONFIG": str(conf), "TRANSFER_LOCAL_ROOT": str(work / "local"), "TPA_PROGRAM_DIR": str(REPO / "program"),
                "TPA_PYTHON": str(work / "どこにも無い" / "python3"), "PATH": str(empty), "TPA_NO_HANDOFF": "1",
                "TPA_LINK_DIRS": str(work / "links")})
    r = Run(work, env).open(exe, "no-python")
    ok = check(r.get("ok") is True, "local. Python の無い PC でも窓は画面を開き、自己診断が通る", r.get("error", ""))
    good, why = window_only_ok(r, "no-python")
    ok &= check(good, "local. 心拍 200・python stopped・窓だけの項目が全部通り、Python を通す項目は包みに数えた", why)
    tabs = next((x for x in r.get("results", []) if x["name"].startswith("出さないタブを出さない")), {})
    ok &= check(tabs.get("ok") is True and '"calc"' in tabs.get("info", ""), "local. Python が居なくても出さないタブ（計算）を出さない", tabs.get("info"))
    ok &= check(boot_log_has(work / "local", "BACKEND 起こせません") and boot_log_has(work / "local", "OPEN 画面を開きます"),
                "local. 窓の記録: 画面を開き、中身は理由つきで起こせない", "")
    ok &= check((r.get("info") or {}).get("version") == bundle.app_version(), "local. 中身の版は窓が読んだ program_version", r.get("info"))
    left = leftover_python(work)
    ok &= check(not left, "終わったあと Python が残らない", left)
    return ok


def rename(old_exe: Path, old_repo: Path, exe: Path, work: Path) -> bool:
    """名前を変えた版へ移る通し（版 3.19.0: Defect-Analyzer → LotScope・作業場所 TransferPitchAnalyzer → LotScope）。
    前の版の本物の窓（old_exe。old_repo の program と一緒に配る形にする）で始めた PC が、置き場のいまの版を取り込み、開き直すと:
    いまの名前の窓で開く・作業場所が新しい名前へ移り前の場所が消える・前の名前のショートカットがいまの名前で作り直される・以後はいまの名前の exe で開く。
    作業場所の名前で決まるので、TRANSFER_LOCAL_ROOT ではなく LOCALAPPDATA を差し替える。"""
    b = bundle.brand()
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    old_out = work / "old-out"
    subprocess.run([sys.executable, str(old_repo / "desktop" / "bundle" / "bundle.py"), "build", "--exe", str(old_exe), "--out", str(old_out)],
                   check=True, capture_output=True)
    old_zip = next(old_out.glob("*-windows.zip"))
    old_rel = json.loads((old_out / "release.json").read_text(encoding="utf-8"))
    share = work / "share"
    with zipfile.ZipFile(old_zip) as z:
        z.extractall(share)
    share_exe = share / old_rel["name"] / old_rel["exe"]
    built = bundle.build(exe, work / "out")
    v_new = built["version"]
    for f in [share_exe, *(Path(built["stage"]).glob("*.exe"))]:
        if os.name != "nt":
            f.chmod(0o755)
    rel_root = work / "Releases"
    place(Path(built["stage"]), v_new, rel_root)
    fixture = work / "q.sqlite3"
    subprocess.run([sys.executable, str(REPO / "program" / "tests" / "lotlist_fixture.py"), str(fixture), "300"], check=True, capture_output=True)
    conf = work / "appsettings.json"
    subprocess.run([sys.executable, str(REPO / "program" / "tests" / "selftest_config.py"), str(fixture), str(conf), str(rel_root)], check=True)
    lad = work / "LocalAppData"
    olds = [lad / d for d in b.get("legacy_data_dir", [])]
    old_root, new_root = olds[-1], lad / b["data_dir"]
    links = [work / "links" / "Desktop", work / "links" / "Programs"]
    env = {k: v for k, v in os.environ.items() if k not in ("TPA_NO_HANDOFF", "TPA_PROGRAM_DIR", "TPA_SELFTEST", "TRANSFER_LOCAL_ROOT")}
    env.update({"TRANSFER_APP_CONFIG": str(conf), "LOCALAPPDATA": str(lad), "TPA_LINK_DIRS": os.pathsep.join(map(str, links))})
    run = Run(work, env)
    ok = True

    # 1. 前の版の共有の exe で始める → 前の作業場所へ写り、使っている間にいまの版を取り込む
    r = run.open(share_exe, "old-share")
    info, upd = r.get("info") or {}, r.get("update") or {}
    ok &= check(r.get("ok") is True and info.get("version") == old_rel["version"], f"1. 前の版 {old_rel['version']}（{old_rel['name']}）で開く",
                r.get("error", "") or info.get("version"))
    ok &= check((old_root / "app" / old_rel["exe"]).is_file(), f"1. 前の作業場所 {old_root.name} に入った")
    ok &= check(upd.get("state") == "ready" and upd.get("ready") == v_new, f"1. 使っている間に {v_new}（{b['name']}）を取り込んだ",
                json.dumps(upd, ensure_ascii=False)[:300])
    old_link = links[0] / f"{old_rel['name']}.lnk"
    make_link(old_link, old_root / "app" / old_rel["exe"], old_root / "app")

    # 2. 前の名前のショートカットの行き先（前の版の入口）で開く → 入れ替え・開き直し・作業場所を移す・ショートカットを作り直す
    r = run.open(old_root / "app" / old_rel["exe"], "old-entry")
    info = r.get("info") or {}
    ok &= check(r.get("ok") is True and info.get("version") == v_new, f"2. 開き直すと {v_new} で開く", r.get("error", "") or info.get("version"))
    ok &= check(same(info.get("local_root", ""), new_root), f"2. 作業場所は {new_root.name}", info.get("local_root"))
    ok &= check((new_root / "app" / b["exe"]).is_file() and (new_root / "update").is_dir(), "2. 入れたアプリと更新の記録が新しい作業場所へ移った")
    ok &= check(not old_root.exists(), f"2. 前の作業場所 {old_root.name} は消えた", sorted(p.name for p in old_root.iterdir()) if old_root.exists() else "")
    time.sleep(3)    # ショートカットの確かめは窓が開いたあと裏で流れる
    new_link = links[0] / f"{b['name']}.lnk"
    got = read_link(new_link)
    ok &= check(not old_link.exists(), f"2. 前の名前のショートカット（{old_link.name}）は消えた")
    ok &= check(bool(got) and same(got[0], new_root / "app" / b["exe"]) and same(got[1], new_root / "app"),
                f"2. {new_link.name} で作り直し、新しい作業場所の {b['exe']} を指す", got)

    # 3. いまの名前のショートカットの行き先で開く
    r = run.open(new_root / "app" / b["exe"], "new-entry")
    info = r.get("info") or {}
    sc = ((info.get("install") or {}).get("shortcut") or {})
    ok &= check(r.get("ok") is True and info.get("version") == v_new and same(info.get("local_root", ""), new_root),
                f"3. {b['exe']} で {v_new} が開く", r.get("error", "") or info.get("version"))
    ok &= check(sc.get("ask") is False and len(sc.get("links") or []) >= 1, "3. ショートカットがあるので尋ねない", sc)
    left = leftover_python(work)
    ok &= check(not left, "終わったあと Python が残らない", left)
    return ok


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("update")
    s.add_argument("--exe", required=True, type=Path)
    s.add_argument("--work", type=Path, default=Path(tempfile.gettempdir()) / "da-verify")
    s.add_argument("--keep", action="store_true")
    s = sub.add_parser("local")
    s.add_argument("--exe", required=True, type=Path)
    s.add_argument("--work", type=Path, default=Path(tempfile.gettempdir()) / "da-verify-local")
    s.add_argument("--keep", action="store_true")
    s = sub.add_parser("rename")
    s.add_argument("--old-exe", required=True, type=Path, help="前の版の窓（old-repo で作った物）")
    s.add_argument("--old-repo", required=True, type=Path, help="前の版のリポジトリ（git worktree など。その program で配る形にする）")
    s.add_argument("--exe", required=True, type=Path)
    s.add_argument("--work", type=Path, default=Path(tempfile.gettempdir()) / "da-verify-rename")
    s.add_argument("--keep", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "rename":
        ok = rename(a.old_exe.resolve(), a.old_repo.resolve(), a.exe.resolve(), a.work.resolve())
    elif a.cmd == "local":
        ok = local(a.exe.resolve(), a.work.resolve())
    else:
        ok = update(a.exe.resolve(), a.work.resolve())
    if not a.keep and ok:
        shutil.rmtree(a.work, ignore_errors=True)
    print("OK" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
