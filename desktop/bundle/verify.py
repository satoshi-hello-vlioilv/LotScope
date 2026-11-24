# -*- coding: utf-8 -*-
"""配る形と更新の通しを、本物の窓で確かめる（評価関数・設計書「更新（B+）」）。Windows の CI と、手元の Linux（xvfb-run の下）で流す。

    python verify.py update --exe <作った exe> [--work <作業フォルダ>] [--keep]
    python verify.py local --exe <作った exe> [--work <作業フォルダ>] [--keep]   作業場所の窓だけ・Python の無い PC（版 3.111.0。版 3.112.0 から
                                                                              配った設定に NaN の形も。版 3.118.1 から 3 窓目 admin-work:
                                                                              作業実績 3 台・開発者の名乗り・共有のマスタを書かない）
    python verify.py rename --old-exe <前の版の exe> --old-repo <前の版のリポジトリ> --exe <作った exe> [--work …] [--keep]

利用者の PC を真似る: 作業場所（TRANSFER_LOCAL_ROOT）はまっさら、配る形は共有を真似たフォルダ、更新の置き場は BOX を真似たフォルダ。
窓は自己診断（TPA_SELFTEST）で起こし、結果のファイル（selftest.js が更新の係の状態と、動いている exe・program を添える）を読む。

  1. 共有の exe を開く → この PC の app へ写り、版ごとの写しの窓で開く。使っている間に置き場の次の版（+1）を取り込む（ready）。置き場を控える
  1b. 配った設定に NaN があり lot_list が字の PC（別の作業場所）でも、使っている間に +1 を取り込む・配布の画面の係が答える（版 3.112.0）
  2. app の exe（ショートカットの行き先）を開く → 起動の最初に +1 へ入れ替わり、その版で開く。直前の版は控えに
  3. 閉じている間に次の版（+2）を置く → ショートカットから 1 回開くだけで +2 になる（起動の最初に取り込んで入れ替える・版 3.38.0）
  4. 窓が描けない版（+3。templates/index.html を消した）を置く。取り込みは窓の準備で断る（版 3.111.0）。前の版の窓が取り込んだ形
     （update の stage に直に置く）で 1 回開く → +3 へ入れ替えるが窓の準備が通らず、画面を開く前に控え（+2）へ戻して開き直す。+3 には印（理由つき）
  4b. Python の無い PC（段 ④・版 3.118.0。+4）→ 入れ替えて、その版のまま開く。心拍 200・python absent・窓だけの自己診断の項目が通る・
     利用状況のいま使っている印に python が無い（前の版の配布の画面が「中身の起きない PC」と数えない）・確かめの印は画面の最初の心拍で消える
     （前の 4b「Python だけ壊れた版」・4c「Python が遅い版」は、窓が中身を起こさないので意味が無くなった。4c は外した）
  4d. 入れ替えた直後に配った設定が JSON でない（+6。環境の失敗）→ 戻さない。窓は画面を既定の形で描き、画面の JS が心拍を送る
  4e. 画面の JS（app.js）が壊れた版（+7）→ 画面の JS が設定を尋ねもせず心拍も来ないので、60 秒で控え（+6）へ戻す（自己診断の心拍は数えない）
  5. 配る版を前の版（+1。distribute.json）に戻す → 1 回開くだけで配る版になり、配る版を作業場所に覚える（want.json）
  6. 新しい PC（まっさらな作業場所）が配る入口を開くだけで、配る版をこの PC へ入れて開き、入口の置き場を控える
  ショートカット: 無ければ画面が尋ねる・共有を指すショートカットは次の起動でこの PC の app（作業フォルダも）に直す
  あわせて: 共有の配る形は 1 ファイルも変わらない・終わったあと Python が残らない。
  版 3.118.0（段 ④）: いまの窓を開く段（update・local）は、PATH から Python の入ったフォルダを外し TPA_PYTHON を無い道にして開き、
  窓の記録（desktop.log）に中身を起こした印（READY・PID）が 1 度も無いことを見る（Python が 1 度も起きていない）。

    python verify.py --no-python-path                                  いまの PATH から Python の入ったフォルダを外した字（CI の自己診断）
    python verify.py prev --old-zip <前の版の配る ZIP> --exe <作った exe> [--work …] [--keep]
      前の版（GitHub の Releases の v3.117.x。Python を起こす）の本物の窓で始めた PC が、いまの版を取り込み・入れ替え・開き直し
      （Python の無い PATH で開く）、配る版を前の版に戻すと前の版で開く（前の版は Python を起こすので、戻す段は Python のある PATH）。
      Windows の CI（desktop.yml の windows-exe）で流す。前の版の Linux の exe は Releases に無いので、手元の Linux は 4 の前の版の窓の形
      （stage_by_old_window）で代える
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
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

# 自己診断の項目の名前（版 3.118.1。selftest.js の okw と part の名前の 1 か所: desktop/bundle/selftest_names.json。test_bundle.py が
# selftest.js と過不足なく同じかを見る）。どれも窓だけの項目（版 3.118.1 から中身〈Python〉を通す項目は無い）
NAMES = json.loads((HERE / "selftest_names.json").read_text(encoding="utf-8"))["items"]
# 必ず出る項目（local・4b・prev 2 の窓は、これが全部あって通る）
WINDOW_ONLY = [x["name"] for x in NAMES if "maybe" not in x]
# 試す形によって出ない物（品質の元が無い PC だけ・版を置けない人だけ・例外のときだけ）
WINDOW_MAYBE = {x["name"] for x in NAMES if "maybe" in x}
# 1b（配った設定の lot_list が字・作業実績の古さが NaN）で落ちてよい項目と理由（版 3.112.0 の作った後の採点の割れ 6c。版 3.118.1 で
# 書き直した項目を実物の 1b で流して合わせ直した）。どれも品質（lot_list）の節を使う道で、窓は「設定を組めません: …」の 503 で断る
NAN_EXPECTED = {x["name"]: x["nan"] for x in NAMES if "nan" in x}
# 数えない項目（試験の版は program の版だけを書き換えるので「窓の版と中身の版が同じ」は通らない）
EXCEPT = {x["name"] for x in NAMES if "except" in x}
# 門番が断った印（版 3.118.1 の作った後の採点の割れ 5）: selftest.js の info は「門番 403」（項目ごとの決めた答え）と「<道の名前> 403 門番」
# （節の中の並び: 試す・参照…・よく使う場所など）の 2 つの形で書く。どちらもこの 1 つの正規表現で拾う（test_bundle.py が selftest.js の形と合わせる）
GATE = re.compile(r"門番 403|\b403 門番")


def gate_names(results: list) -> list:
    """門番（403）が断ったと info に書いた項目の名前"""
    return [x["name"] for x in results if GATE.search(x.get("info", "") or "")]


def window_only_ok(r: dict, label: str) -> tuple[bool, str]:
    """Python が居ない通しの自己診断: 必ず出る項目が全部あって通り、余分が無く、飛ばした項目が無い（版 3.118.1 から skipped は 0）"""
    res = r.get("results", [])
    names = [x["name"] for x in res]
    missing = [n for n in WINDOW_ONLY if n not in names]
    extra = [n for n in names if n not in WINDOW_ONLY and n not in WINDOW_MAYBE]
    bad = [x["name"] for x in res if not x["ok"] and x["name"] not in EXCEPT]
    # 版 3.118.0（段 ④）: 製品の窓は中身を起こさない（python absent。止まった stopped とは別の様子）
    good = r.get("python") == "absent" and r.get("skipped", 0) == 0 and not missing and not extra and not bad
    return good, f"python={r.get('python')} 項目 {len(res)}・飛ばした {r.get('skipped')}・無い {missing}・余分 {extra}・通らない {bad}"


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
    broken: "window"＝窓が描けない版（画面の型を消す）・"js"＝画面の JS（app.js）が読み込みで落ちる版
    （版 3.118.0 から "python"・"slow"〈Python だけ壊れた・遅い版〉は外した: 窓は中身を起こさない）"""
    b = bundle.brand()
    work = Path(tempfile.mkdtemp(prefix="da-variant-"))
    try:
        top = work / b["name"]
        shutil.copytree(stage, top)
        vp = top / "program" / "app" / "version.py"
        text = vp.read_text(encoding="utf-8")
        old = bundle.app_version(top / "program")
        vp.write_text(text.replace(f'APP_VERSION = "{old}"', f'APP_VERSION = "{version}"', 1), encoding="utf-8")
        if broken == "window":   # 窓が描けない版（取り込みの窓の準備で断る・起動の窓の準備で戻す）
            (top / "program" / "app" / "templates" / "index.html").unlink()
        elif broken == "js":   # 画面の JS が構文の誤りで落ちる版（窓の準備は JS を読まないので通る。画面の最初の心拍で戻す）
            js = top / "program" / "app" / "static" / "js" / "app.js"
            js.write_text(js.read_text(encoding="utf-8") + "\nfunction ( {\n", encoding="utf-8")
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
        # 試験の版は program の版だけを書き換えた物（窓の exe は元の版のまま）なので、「窓の版と中身の版が同じ」は数えない（EXCEPT）。
        # 本物の配る形では、窓と中身は同じ版で作る（bundle.py・test_version.py）
        res = [x for x in r.get("results", []) if x["name"] not in EXCEPT]
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
        # 配る形の根（program/app/version.py の 3 つ上。凍らせた写し program/tests/legacy/…/app は program の下の app でないので選ばない）
        root = next(p.parents[2] for p in tmp.rglob("version.py") if p.parent.name == "app" and p.parents[1].name == "program")
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
    """作業フォルダの program を動かしている Python（sidecar.py）が残っていないか（Linux は /proc、Windows は Win32_Process の CommandLine）。"""
    out = []
    if os.name == "nt":
        ps = ("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*sidecar.py*' } | "
              "ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }")
        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, encoding="utf-8", errors="replace",
                           check=False)
        return [x[:160] for x in r.stdout.splitlines() if x.strip() and str(root).lower() in x.lower()]
    for d in Path("/proc").iterdir():
        if d.name.isdigit():
            try:
                cmd = (d / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
            except OSError:
                continue
            if "sidecar.py" in cmd and str(root) in cmd:
                out.append(f"{d.name}: {cmd[:120]}")
    return out


def no_python_path(path: str) -> str:
    """PATH から Python の入ったフォルダ（python・python3・python.exe・Microsoft Store の入口のある所）を外す（版 3.118.0。採点の first_fixes 9）。
    いまの窓を開くときだけ使う（道具の Python は外さない）。py ランチャー（C:\\Windows\\py.exe）の置き場は外さない（Windows の置き場ごと外れる。
    段 ④ の窓は Python を探さないので、起きたかは記録と走っているプロセスで見る）"""
    names = ("python", "python3", "python.exe", "python3.exe")
    keep = [d for d in path.split(os.pathsep) if d and not any((Path(d) / n).exists() for n in names)]
    return os.pathsep.join(keep)


def without_python(env: dict, work: Path) -> dict:
    """いまの窓を Python の無い PC の形で開く env（PATH から外し、TPA_PYTHON を無い道に）"""
    return {**env, "PATH": no_python_path(env.get("PATH", "")), "TPA_PYTHON": str(work / "どこにも無い" / "python3")}


def python_started(local: Path, since: int = 0) -> list[str]:
    """窓が中身（Python）を起こした・起こそうとした印（版 3.118.0。採点の割れ 3）。段 ④ の窓では空。見る物は窓が持つ物だけ:
    - 窓を閉じるときの記録「EXIT 窓を閉じた python_attempts=N」（Supervisor の起こそうとした回数）が 0 でない・その行が 1 つも無い
    - 中身を起こすと必ず作られる作業場所の logs/sidecar_stderr.log がある
    since は desktop.log の何行目から見るか（前の版の窓が先に書いた行を外す: prev）"""
    lines = desktop_log(local)[since:]
    out = [line[:160] for line in lines if "python_attempts=" in line and "python_attempts=0" not in line]
    if not any("python_attempts=" in line for line in lines):
        out.append("窓を閉じた記録（EXIT … python_attempts=）がありません")
    if since == 0 and (local / "logs" / "sidecar_stderr.log").exists():
        out.append("logs/sidecar_stderr.log がある（中身を起こした）")
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
    # 版 3.118.0: 1 段目は Python のある PATH のまま開き（PATH に Python があっても起こさない。採点の割れ 3）、2 段目から Python の無い PATH で開く
    run = Run(work, env)
    env = without_python(env, work)
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
    # 1b. 配った設定に NaN があり lot_list が表でない PC（版 3.112.0。採点の指摘 1・10）: 窓は束を Python に尋ねず、更新の置き場は
    # update.source の段だけで決まるので、別の作業場所で同じ共有の exe を開いても、使っている間に次の版を取り込む（品質の一覧の項目は
    # 理由つきの 503 で通らないので、自己診断の全部は見ない）
    nan_conf = work / "appsettings-nan.json"
    bad = json.loads(conf.read_text(encoding="utf-8"))
    bad["lot_list"] = "設定ファイルを手で壊した字"
    bad.setdefault("work_log", {})["stale_hours"] = float("nan")
    nan_conf.write_text(json.dumps(bad, ensure_ascii=False, allow_nan=True), encoding="utf-8")
    local_nan = work / "local-nan"
    r = Run(work, {**env, "TRANSFER_APP_CONFIG": str(nan_conf), "TRANSFER_LOCAL_ROOT": str(local_nan),
                   "TPA_LINK_DIRS": os.pathsep.join(str(work / "links-nan" / n) for n in ("Desktop", "Programs"))}).open(share_exe, "nan-config")
    upd_nan = r.get("update") or {}
    ok &= check(upd_nan.get("state") == "ready" and upd_nan.get("ready") == v1,
                f"1b. 配った設定に NaN・lot_list が字でも、使っている間に {v1} を取り込んだ（更新の置き場を見失わない）", json.dumps(upd_nan, ensure_ascii=False)[:300])
    rel = next((x for x in r.get("results", []) if x["name"] == "配布の画面の係が答える（置き場に届くか・権限）"), {})
    ok &= check(rel.get("ok") is True, "1b. 配布の画面の係が答える（窓が置き場を読む）", rel.get("info"))
    # 版 3.112.0 の作った後の採点の割れ 6c: lot_list の節を使う項目だけが落ちてよい（窓が理由つきの 503 で断る。NAN_EXPECTED に理由）。
    # ほかの項目が落ちたら割れ（前は 1b の 2 項目しか見ず、断り過ぎ・Python の HTML の 500 を見逃した）
    failed = [x for x in r.get("results", []) if not x["ok"] and x["name"] not in EXCEPT]
    unexpected = [f"{x['name']} -- {x['info'][:120]}" for x in failed if x["name"] not in NAN_EXPECTED]
    ok &= check(not unexpected, "1b. lot_list が字の PC で落ちるのは品質の節を使う項目だけ（理由つきの 503）", unexpected)
    # 版 3.118.1 の作った後の採点の割れ 2: 一覧の nan の名前は、出た物が全部落ちる（落ちずに通った nan の名前は、品質の節を見ずに素通りした割れ）
    passed = [x["name"] for x in r.get("results", []) if x["ok"] and x["name"] in NAN_EXPECTED]
    ok &= check(not passed, "1b. selftest_names.json の nan の項目は、出たら全部落ちる（品質の節を使う確かめが素通りしない）", passed)
    ok &= check(all("503" in x["info"] or "設定を組めません" in x["info"] for x in failed), "1b. 落ちた項目はどれも窓の理由つきの 503",
                [x["info"][:80] for x in failed])
    sc = ((info.get("install") or {}).get("shortcut") or {})
    ok &= check(sc.get("ask") is True and not sc.get("links"), "1. ショートカットが無いので画面が尋ねる", sc)
    # 人が作った、共有の exe を指し作業フォルダも共有のショートカット（次の起動で直る）
    lnk = links[0] / f"{b['name']}.lnk"
    make_link(lnk, share_exe, share_app)

    ok &= check(not python_started(local), "1. PATH に Python がある PC でも窓は中身を起こさない（python_attempts=0・sidecar_stderr.log が無い）",
                python_started(local))
    run = Run(work, env)    # 2 段目から Python の無い PATH

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

    # 4b. Python の無い PC（段 ④・版 3.118.0。採点の first_fixes 10）: v4 に入れ替えて、その版のまま開く。窓だけの項目が通り、確かめの印は
    #     画面の最初の心拍で消え、利用状況のいま使っている印に python が無い（版 3.117.x の配布の画面は「書かない＝起きている」と読む）
    v4 = bump(v0, 4)
    place(Path(built["stage"]), v4, rel_root)
    make_link(lnk, share_exe, share_app)    # 直す物を作っておく（共有を指すショートカット）
    r = run.open(app / b["exe"], "no-python")
    info = r.get("info") or {}
    good, why = window_only_ok(r, "no-python")
    ok &= check(info.get("version") == v4, f"4b. Python の無い PC で {v4} に入れ替えて開く", info.get("version"))
    ok &= check(good, "4b. 心拍 200・python absent・自己診断の項目が全部あって通る（飛ばした項目が無い）", why)
    ok &= check(not (local / "update" / "applied.json").exists() and boot_log_has(local, "BOOT 入れ替えた版を確かめた"),
                "4b. 確かめの印は画面の最初の心拍で消えた")
    fj = json.loads((local / "update" / "FAILED.json").read_text(encoding="utf-8"))
    ok &= check(fj.get("versions") == [v3], f"4b. {v4} に印を付けない", fj.get("versions"))
    # いま使っている印は窓を閉じると消えるので、開いている間に自己診断が読んだ物で見る（absent は書かない: info は「… null」）
    pres = next((x for x in r.get("results", []) if x["name"].startswith("利用状況のいま使っている印")), {})
    ok &= check(pres.get("ok") is True and '"stopped"' not in pres.get("info", "") and '"absent"' not in pres.get("info", ""),
                "4b. 利用状況のいま使っている印に python が無い（中身の起きない PC と数えない）", pres.get("info"))
    got = read_link(lnk)
    ok &= check(bool(got) and same(got[0], app / b["exe"]), "4b. ショートカットも直った", got)
    # 4c（Python が遅い版）は外した（版 3.118.0: 窓は中身を起こさないので、Python の準備の速さは確かめの印に関わらない）

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
    ok &= check(r.get("python") == "absent" and errs and "before initialization" not in errs.get("info", "") and "ReferenceError" not in errs.get("info", ""),
                "4d. 中身を起こさない窓でも画面の JS は落ちない", f"python={r.get('python')} {errs.get('info', '')[:200]}")

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
    started = python_started(local) + python_started(local_nan) + python_started(local2)
    ok &= check(not started, "Python が 1 度も起きていない（窓の記録に中身を起こした印が無い。段 ④）", started)
    return ok


def local(exe: Path, work: Path) -> bool:
    """作業場所の窓だけ（この PC の app でない・開発の形）を、Python の無い PC で開く（版 3.111.0）: TPA_PYTHON を無い道にし、PATH からも
    Python を外す（版 3.118.0 から窓は Python を探さない）。窓は画面を開き、心拍 200・python absent・窓だけの自己診断の項目が通る。
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
    ok &= check(good, "local. 心拍 200・python absent・自己診断の項目が全部あって通る（飛ばした項目が無い）", why)
    tabs = next((x for x in r.get("results", []) if x["name"].startswith("出さないタブを出さない")), {})
    ok &= check(tabs.get("ok") is True and '"calc"' in tabs.get("info", ""), "local. Python が居なくても出さないタブ（計算）を出さない", tabs.get("info"))
    ok &= check(boot_log_has(work / "local", "python=（段 ④: 起こさない）") and boot_log_has(work / "local", "OPEN 画面を開きます")
                and not python_started(work / "local"), "local. 窓の記録: 画面を開き、中身は起こさない（Python が 1 度も起きていない）", "")
    ok &= check((r.get("info") or {}).get("version") == bundle.app_version(), "local. 中身の版は窓が読んだ program_version", r.get("info"))
    # 版 3.112.0（採点の指摘 10）: 配った設定に NaN（Python の json.loads は読む・窓の serde は読めない）があっても、Python の無い PC で
    # 窓だけの項目が全部通る（前は窓が束を Python に尋ね、心拍・一覧・配布の画面など 8 項目が落ちた）
    s = json.loads(conf.read_text(encoding="utf-8"))
    s["lot_list"]["page_size"] = float("nan")
    s.setdefault("presence", {})["heartbeat_interval_seconds"] = float("inf")
    conf.write_text(json.dumps(s, ensure_ascii=False, allow_nan=True), encoding="utf-8")
    r = Run(work, {**env, "TRANSFER_LOCAL_ROOT": str(work / "local-nan")}).open(exe, "no-python-nan")
    good, why = window_only_ok(r, "no-python-nan")
    ok &= check(r.get("ok") is True and good, "local. 配った設定に NaN・Infinity があっても、窓だけの項目が全部通る（窓は束を Python に尋ねない）", why)
    ok &= admin_work(exe, work, env, conf)
    left = leftover_python(work)
    ok &= check(not left, "終わったあと Python が残らない", left)
    return ok


def masters_digest(share: Path) -> dict:
    """共有のマスタのファイル（置き場の直下の *.json。利用状況の presence_tpa は窓が書くので除く）→ sha256"""
    return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(share.glob("*.json"))}


def admin_work(exe: Path, work: Path, env: dict, conf: Path) -> bool:
    """3 窓目 admin-work（版 3.118.1。採点の first_fixes 10）: 作業実績 3 台に届き、この PC の利用者が開発者・編集可の場面。
    書く道の「無い行・知らない項目を窓の言葉で断る」の枝と、作業実績の一覧・集計・パネルの値が流れる（CI の自己診断の段は一般ユーザー・0 台）。
    どれも書かずに確かめる道（id 987654321・selftest-none・名前が空の引っ越し）なので、流した後の共有のマスタは前と 1 バイトも同じ。
    selftest_config.py・lotlist_fixture.py は変えない（verify prev の前の版の自己診断は今の場面のまま）"""
    import getpass
    admin = work / "admin"
    folder = admin / "work"
    folder.mkdir(parents=True)
    equip = ["L-1", "TLV", "CR1"]
    code = ("import sys; sys.path.insert(0, sys.argv[1]); import lotlist_fixture as f\n"
            "for e in sys.argv[3:]: f.make_work(f'{sys.argv[2]}/実績_{e}.sqlite3', e)")
    subprocess.run([sys.executable, "-c", code, str(REPO / "program" / "tests"), str(folder), *equip], check=True)
    share = admin / "masters"
    # tab_access.json は写さない（版 3.118.1 の作った後の採点の割れ 9。first_fixes 10: 1 窓目の「計算を出さない」とぶつかる）。
    # 共有に無いので、窓が最初に読むときに同梱の最初の版を種まきする（下の sha256 の確かめは、この 1 つが新しく置かれるのだけを許す）
    unseeded = ("tab_access.json",)
    shutil.copytree(work / "masters", share, ignore=shutil.ignore_patterns("presence_tpa", *unseeded))
    def rows(items):
        return json.dumps({"schema": 1, "revision": 1, "rows": items}, ensure_ascii=False, indent=1)
    (share / "access_permissions.json").write_text(rows([{"id": 1, "ログインID": getpass.getuser(), "PC名": "", "権限区分": "開発者",
                                                          "マスタ編集": "編集可", "有効": "有", "備考": "verify の admin-work", "rev": 1}]), encoding="utf-8")
    (share / "work_log_files.json").write_text(rows([{"id": i + 1, "キー": f"w{i + 1}", "設備名": e, "ファイル名": f"実績_{e}.sqlite3", "表示": "有",
                                                      "表": "", "備考": "", "rev": 1} for i, e in enumerate(equip)]), encoding="utf-8")
    s = json.loads(conf.read_text(encoding="utf-8"))
    s["lot_list"]["page_size"] = 500
    s.setdefault("presence", {}).pop("heartbeat_interval_seconds", None)
    s["master_share"]["dir"] = str(share)
    s.setdefault("work_log", {})["folder"] = str(folder)
    aconf = admin / "appsettings.json"
    aconf.write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
    before = masters_digest(share)
    r = Run(work, {**env, "TRANSFER_APP_CONFIG": str(aconf), "TRANSFER_LOCAL_ROOT": str(work / "local-admin")}).open(exe, "admin-work")
    good, why = window_only_ok(r, "admin-work")
    ok = check(r.get("ok") is True and good, "local. 作業実績 3 台・開発者の名乗りでも、自己診断の項目が全部あって通る", why)
    res = {x["name"]: x for x in r.get("results", [])}
    wl = res.get("作業実績・データ元の一覧は窓が答え、答えの形と失敗の種類（8 通り・作業でまとめる・ページ・失敗の答え）", {})
    gate = gate_names(r.get("results", []))
    ok &= check(wl.get("ok") is True and "設備 " in wl.get("info", "") and "設備なし" not in wl.get("info", "") and not gate,
                "local. admin-work では作業実績の一覧が流れ、書く道は門番でなく窓の言葉で断る", f"{wl.get('info', '')[:80]}・門番 {gate}")
    after = masters_digest(share)
    changed = sorted(k for k in before if before.get(k) != after.get(k))
    added = sorted(set(after) - set(before))
    ok &= check(not changed and set(added) <= set(unseeded), "local. admin-work の自己診断は共有のマスタを書かない（前からあるマスタの sha256 が同じ・"
                "新しく置かれたのは写さなかった tab_access.json の種まきだけ）", f"変わった {changed}・置かれた {added}")
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


def prev(old_zip: Path, exe: Path, work: Path) -> bool:
    """前の版と新しい版の境の通し（版 3.118.0。採点の first_fixes 10・14）。前の版（GitHub の Releases の v3.117.x の配る ZIP。Python を起こす）の
    本物の窓で始めた PC が、置き場のいまの版（段 ④: Python を起こさない）を取り込み・入れ替え・開き直す。そのあと配る版を前の版に戻すと、
    1 回開くだけで前の版で開く（前の版は Python を起こすので、戻した段は Python のある PATH。PC の Python は段 ⑤ まで消さない）"""
    b = bundle.brand()
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    share = work / "share"
    with zipfile.ZipFile(old_zip) as z:
        z.extractall(share)
        old_rel_names = z.namelist()
    top = next(n.split("/")[0] for n in old_rel_names if n.endswith("/program/app/version.py") and n.count("/") == 3)
    share_app = share / top
    old_v = bundle.app_version(share_app / "program")
    share_exe = share_app / b["exe"]
    built = bundle.build(exe, work / "out")
    v_new = built["version"]
    for f in [share_exe, *(Path(built["stage"]).glob("*.exe"))]:
        if os.name != "nt":
            f.chmod(0o755)
    rel_root = work / "Releases"
    place(Path(built["stage"]), v_new, rel_root)
    # 前の版も置き場に並べる（配る版を前の版に戻すときに選ぶ）: 前の版の ZIP をそのまま置く
    old_dest = rel_root / b["name"] / old_v
    old_dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(old_zip, old_dest / old_zip.name)
    (old_dest / "release.json").write_text(json.dumps(bundle.release_json(b, old_v, old_zip.name, bundle.sha256_file(old_zip)), ensure_ascii=False, indent=1),
                                           encoding="utf-8")
    fixture = work / "q.sqlite3"
    subprocess.run([sys.executable, str(REPO / "program" / "tests" / "lotlist_fixture.py"), str(fixture), "300"], check=True, capture_output=True)
    conf = work / "appsettings.json"
    subprocess.run([sys.executable, str(REPO / "program" / "tests" / "selftest_config.py"), str(fixture), str(conf), str(rel_root)], check=True)
    local = work / "local"
    app = local / "app"
    env = {k: v for k, v in os.environ.items() if k not in ("TPA_NO_HANDOFF", "TPA_PROGRAM_DIR", "TPA_SELFTEST", "TPA_PYTHON")}
    env.update({"TRANSFER_APP_CONFIG": str(conf), "TRANSFER_LOCAL_ROOT": str(local),
                "TPA_LINK_DIRS": os.pathsep.join(str(work / "links" / n) for n in ("Desktop", "Programs"))})
    with_py, no_py = Run(work, env), Run(work, without_python(env, work))
    ok = True
    # 1. 前の版の共有の exe（Python のある PATH）→ この PC の app へ写り、使っている間にいまの版を取り込む
    r = with_py.open(share_exe, "old-share")
    info, upd = r.get("info") or {}, r.get("update") or {}
    ok &= check(r.get("ok") is True and info.get("version") == old_v, f"prev 1. 前の版 {old_v} で開き、自己診断が通る", r.get("error", "") or info.get("version"))
    ok &= check(upd.get("state") == "ready" and upd.get("ready") == v_new, f"prev 1. 前の版の窓が {v_new} を取り込んだ（sidecar.py の印を受ける）",
                json.dumps(upd, ensure_ascii=False)[:300])
    # 2. Python の無い PATH で app の exe（前の版の入口）を開く → 前の窓が入れ替えて開き直し、いまの窓が Python を起こさずに開く
    before = len(desktop_log(local))
    r = no_py.open(app / b["exe"], "new")
    info = r.get("info") or {}
    good, why = window_only_ok(r, "new")
    ok &= check(info.get("version") == v_new and good, f"prev 2. 入れ替えて開き直すと {v_new}（python absent・自己診断の項目が全部あって通る）", why)
    ok &= check(not (local / "update" / "applied.json").exists(), "prev 2. 確かめの印は画面の最初の心拍で消えた")
    started = python_started(local, before)
    ok &= check(not started, "prev 2. いまの窓は Python を 1 度も起こさない（python_attempts=0）", started)
    # 3. 配る版を前の版に戻す → いまの窓が 1 回開くだけで前の版を取り込み・入れ替え・開き直す（前の版は Python を起こすので Python のある PATH）
    (rel_root / b["name"] / "distribute.json").write_text(json.dumps(
        {"schema": 1, "app_id": b["app_id"], "version": old_v, "entry": b["exe"], "setAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
         "setBy": "verify", "setPc": "verify", "previous": v_new}, ensure_ascii=False), encoding="utf-8")
    r = with_py.open(app / b["exe"], "back")
    info = r.get("info") or {}
    ok &= check(r.get("ok") is True and info.get("version") == old_v and r.get("python") == "ready",
                f"prev 3. 配る版を {old_v} に戻すと、1 回の起動で前の版（Python を起こす）で開く", f"{info.get('version')} python={r.get('python')} {r.get('error', '')}")
    left = leftover_python(work)
    ok &= check(not left, "終わったあと Python が残らない", left)
    return ok


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["--no-python-path"]:    # CI の自己診断の段が、窓を起こすときだけ使う PATH（版 3.118.0）
        print(no_python_path(os.environ.get("PATH", "")))
        return
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
    s = sub.add_parser("prev")
    s.add_argument("--old-zip", required=True, type=Path, help="前の版の配る ZIP（GitHub の Releases の v3.117.x）")
    s.add_argument("--exe", required=True, type=Path)
    s.add_argument("--work", type=Path, default=Path(tempfile.gettempdir()) / "da-verify-prev")
    s.add_argument("--keep", action="store_true")
    s = sub.add_parser("rename")
    s.add_argument("--old-exe", required=True, type=Path, help="前の版の窓（old-repo で作った物）")
    s.add_argument("--old-repo", required=True, type=Path, help="前の版のリポジトリ（git worktree など。その program で配る形にする）")
    s.add_argument("--exe", required=True, type=Path)
    s.add_argument("--work", type=Path, default=Path(tempfile.gettempdir()) / "da-verify-rename")
    s.add_argument("--keep", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "prev":
        ok = prev(a.old_zip.resolve(), a.exe.resolve(), a.work.resolve())
    elif a.cmd == "rename":
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
