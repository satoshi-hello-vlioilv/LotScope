"""凍らせる Python の写しを 1 回だけ作る（版 3.117.3。段 ④ の入口の条件 3。採点 tools/ui-proposals/2026-11-stage3f.json の first_fixes 16）。
app を import しない（標準の部品だけ）。

    python tools/freeze-legacy.py           … program/tests/legacy/<版>/ に写し、MANIFEST.json（ファイルごとの sha256）を書く。
                                              写しが既にあれば何もせずに止める（1 回だけ。git の印〈タグ・コミット〉では代えない:
                                              段 ④ で program/app を消した後も、取り出しだけで凍らせた Python が流れるように）
    python tools/freeze-legacy.py --check   … 写しの中身が MANIFEST.json と同じか（tests/test_baked_tables.py も見る。MANIFEST.json そのものの
                                              指紋は試験に書いてある）

写すもの（段 ④ の配布の間だけ、凍らせた最後の Python を相手にする試験〈desktop/tests の bake::frozen_python〉が要るものだけ）:
- app/ の取り出しのファイル（static/ は除く: 画面の JS・CSS は凍らせた試験が使わず、js-check の範囲に入れないため）
- 上の段の *.py（app_env.py など。app が読む）・config/*.json・data/*（app の既定の置き場）
- tests/ の答え合わせ役のうち凍らせた試験が呼ぶ台本と、その台本が読む部品・事例の表（FROZEN_SCRIPTS から import をたどる）

写しは lint（ruff）の範囲から外す（program/ruff.toml の extend-exclude）: 凍らせた写しは書き換えないので、ruff の版が上がって決まりが
増えても直さない（直すと指紋が変わる）。compileall は写しも確かめる（Python の版が上がって読めなくなれば、凍らせた試験も流れない）。
"""
import ast
import hashlib
import json
import subprocess
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
VERSION = "3.117.3"
DEST = PROGRAM / "tests" / "legacy" / VERSION
MANIFEST = "MANIFEST.json"
# 凍らせた試験（desktop/tests の frozen_python を呼ぶ 10 本と keep の本 share_reader）が呼ぶ答え合わせ役
FROZEN_SCRIPTS = ["share_reader_oracle", "masters_oracle", "mirror_oracle", "place_oracle", "schedule_oracle", "seeds_oracle"]
# 台本が字で読む事例の表・作り物の証明書（import でたどれない物）。fakes_serve は種類の名前で fakes_<種類>.py を読む
EXTRA = ["tests/__init__.py", "tests/fixtures/tls", "tests/fixtures/cm3_timeout_cases.json", "tests/fixtures/seeds_cases.json",
         "tests/fixtures/lotdsp_fake_tables.json"]


def tracked():
    out = subprocess.run(["git", "ls-files", "-z", "app", "config", "data", "tests"], cwd=PROGRAM, capture_output=True, check=True)
    return [x for x in out.stdout.decode("utf-8").split("\0") if x] + [p.name for p in PROGRAM.glob("*.py")]


def closure():
    """凍らせる台本から tests/ の部品を import でたどる（fakes_serve が読む fakes_*.py も）"""
    tests = PROGRAM / "tests"
    seen, stack = set(), FROZEN_SCRIPTS + [p.stem for p in tests.glob("fakes_*.py")]
    while stack:
        m = stack.pop()
        p = tests / f"{m}.py"
        if m in seen or not p.exists():
            continue
        seen.add(m)
        for n in ast.walk(ast.parse(p.read_text(encoding="utf-8"))):
            names = []
            if isinstance(n, ast.Import):
                names = [a.name.split(".") for a in n.names]
            elif isinstance(n, ast.ImportFrom) and n.module:
                mod = n.module.split(".")
                names = [mod + [a.name] if mod == ["tests"] else mod for a in n.names]
            for nm in names:
                stack.append(nm[1] if nm[0] == "tests" and len(nm) > 1 else nm[0])
    return sorted(f"tests/{m}.py" for m in seen)


def wanted():
    files = tracked()
    keep = set(closure())
    out = []
    for rel in files:
        if rel.startswith("app/") and not rel.startswith("app/static/"):
            out.append(rel)
        elif rel.startswith(("config/", "data/")) or ("/" not in rel and rel.endswith(".py")):
            out.append(rel)
        elif rel in keep or any(rel == e or rel.startswith(e + "/") for e in EXTRA):
            out.append(rel)
    return sorted(set(out))


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def listing(root):
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*")
                  if p.is_file() and p.name != MANIFEST and "__pycache__" not in p.parts and p.suffix != ".pyc")


def check(root=DEST):
    """→ 食い違いの言葉の並び（空なら写しは MANIFEST.json と同じ）"""
    m = root / MANIFEST
    if not m.exists():
        return [f"{root}: 写しがありません（python tools/freeze-legacy.py）"]
    man = json.loads(m.read_text(encoding="utf-8"))
    bad = []
    files = man.get("files", {})
    have = listing(root)
    for rel in sorted(set(files) - set(have)):
        bad.append(f"写しから消えた: {rel}")
    for rel in sorted(set(have) - set(files)):
        bad.append(f"写しに増えた: {rel}")
    for rel in sorted(set(files) & set(have)):
        if sha(root / rel) != files[rel]:
            bad.append(f"写しが変わった: {rel}（凍らせた写しは書き換えない）")
    return bad


def main():
    if sys.argv[1:] == ["--check"]:
        bad = check()
        for b in bad:
            print("  ", b)
        print("凍らせた写しは MANIFEST.json と同じです" if not bad else f"凍らせた写しが {len(bad)} か所違います")
        sys.exit(1 if bad else 0)
    if DEST.exists():
        sys.exit(f"{DEST} は既にあります（凍らせる写しは 1 回だけ作る）")
    files = wanted()
    for rel in files:
        d = DEST / rel
        d.parent.mkdir(parents=True, exist_ok=True)
        d.write_bytes((PROGRAM / rel).read_bytes())
    man = {"about": f"凍らせた Python の写し（版 {VERSION}。program/tools/freeze-legacy.py が 1 回だけ作った）。段 ④（Python を外す。3.118.0）の配布の間、"
                    "凍らせた最後の Python を相手にする試験（desktop/tests の bake::frozen_python・books.json の keep の本）がこの写しを相手にする"
                    "（TPA_FROZEN_PY=1。desktop/tests/common.rs の py_program）。書き換えない（tests/test_baked_tables.py が sha256 を見る）",
           "version": VERSION, "files": {rel: sha(DEST / rel) for rel in files}}
    (DEST / MANIFEST).write_text(json.dumps(man, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    size = sum((DEST / r).stat().st_size for r in files)
    print(f"{DEST} に {len(files)} 個（{size / 1e6:.2f} MB）を写しました。MANIFEST.json の sha256: {sha(DEST / MANIFEST)}")


if __name__ == "__main__":
    main()
