"""利用者に見える字で、予定を配る元を「CM3」と呼ばない（版 3.117.3。利用者の決め 2026-11-21: 「CM3 は設備の名前です。『予定の元』に替えてください」）。

現場では CM3 は設備（CM1・CM2・CM3）の名前で、予定を配るサーバーの名前としては通じない。利用者に見える字（画面の JS・templates・Python の app の
字の定数・窓の desktop/src の字・焼いた決まりの表・同梱のマスタの既定・更新履歴・人の事例の表の言葉）に、大文字の「CM3」が残っていないかを見る。
見ないもの: コメント・docstring（作り手向け）・内部の名前（kind "cm3"・cm3_base_url・関数・ファイル名。大文字の CM3 でない、または語の続き）。
設備の名前としての CM3 は、許す所を理由つきの並び ALLOWED に書く（字の中にその並びの字があれば許す）。
"""
import ast
import json
import re
import unittest
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
REPO = PROGRAM.parent
WORD = re.compile(r"(?<![A-Za-z0-9_])CM3(?![A-Za-z0-9_])")

# 設備の名前として CM3 を書く字（理由つき）。予定の元の意味の CM3 はここに足さない
ALLOWED = {
    "CM1・CM2・CM3": "設備の名前の並び（予定の元ではない）",
}


def py_strings(p):
    """Python の字の定数（docstring は除く）→ [(行, 字)]"""
    tree = ast.parse(p.read_text(encoding="utf-8"))
    docs = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and n.body:
            first = n.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                docs.add(id(first.value))
    return [(n.lineno, n.value) for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docs]


def code_without_comments(text, rust=False):
    """JS・Rust の字からコメントを外す（字の中の // や /* は残す）→ 行ごとの字の並び"""
    out, i, n = [], 0, len(text)
    quote = None
    while i < n:
        c = text[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            seg = text[i:n if j < 0 else j + 2]
            out.append("\n" * seg.count("\n"))
            i = n if j < 0 else j + 2
            continue
        if rust and c == "'":
            # 字の 1 字（'x'・'\n'）か寿命（'a）。字の 1 字だけを飛ばす
            m = re.match(r"'(\\.|[^\\'])'", text[i:i + 12])
            if m:
                out.append(m.group(0))
                i += len(m.group(0))
                continue
            out.append(c)
            i += 1
            continue
        if c in "\"'`" and not (rust and c == "`"):
            quote = c
        out.append(c)
        i += 1
    return "".join(out).split("\n")


def json_strings(v, path=""):
    if isinstance(v, str):
        yield path, v
    elif isinstance(v, dict):
        for k, x in v.items():
            yield from json_strings(k, path + "/<鍵>")
            yield from json_strings(x, f"{path}/{k}")
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from json_strings(x, f"{path}[{i}]")


def allowed(text):
    t = text
    for a in ALLOWED:
        t = t.replace(a, "")
    return not WORD.search(t)


def found():
    hits = []
    app = PROGRAM / "app"
    for p in sorted(app.rglob("*.py")):
        if "__pycache__" in p.parts:
            continue
        for line, s in py_strings(p):
            if WORD.search(s) and not allowed(s):
                hits.append(f"{p.relative_to(REPO)}:{line}: {s[:80]}")
    js = sorted((app / "static" / "js").glob("*.js")) + sorted((REPO / "desktop" / "src").glob("*.js"))
    rs = sorted((REPO / "desktop" / "src").rglob("*.rs"))
    for p in js + rs:
        for i, line in enumerate(code_without_comments(p.read_text(encoding="utf-8"), rust=p.suffix == ".rs"), 1):
            if WORD.search(line) and not allowed(line):
                hits.append(f"{p.relative_to(REPO)}:{i}: {line.strip()[:80]}")
    for p in sorted((app / "templates").glob("*.html")):
        for i, line in enumerate(p.read_text(encoding="utf-8").split("\n"), 1):
            if WORD.search(line) and not allowed(line):
                hits.append(f"{p.relative_to(REPO)}:{i}: {line.strip()[:80]}")
    jsons = [REPO / "desktop" / "src" / "bundle_tables.json", app / "changelog.json", *sorted((app / "master_defaults").glob("*.json"))]
    jsons += [PROGRAM / "tests" / "fixtures" / f for f in ("cm3_net_cases.json", "cm3_timeout_cases.json", "sysproxy_cases.json", "schedule_golden.json")]
    for p in jsons:
        if not p.exists():
            continue
        for path, s in json_strings(json.loads(p.read_text(encoding="utf-8"))):
            if WORD.search(s) and not allowed(s):
                hits.append(f"{p.relative_to(REPO)}{path}: {s[:80]}")
    return hits


class ScheduleSourceWords(unittest.TestCase):
    def test_the_schedule_source_is_not_called_cm3(self):
        hits = found()
        self.assertEqual(hits, [], f"利用者に見える字に、予定の元の意味の「CM3」が {len(hits)} か所（「予定の元」に）:\n" + "\n".join(hits[:60]))

    def test_the_scanner_sees_strings_and_skips_comments(self):
        """変異: 字の中の CM3 は見つけ、コメント・内部の名前・設備の名前の並びは見つけない"""
        js = 'const a = "予定を CM3 から"; // CM3 の注\n/* CM3 */ const b = `sd-cm3 ${x} CM3_REACH`; const c = "CM1・CM2・CM3";\n'
        lines = code_without_comments(js)
        self.assertTrue(WORD.search(lines[0]) and not allowed(lines[0]))
        self.assertTrue(all(allowed(x) for x in lines[1:]), lines)
        rs = "let s = \"CM3 に届きません\"; // CM3\nlet c = 'x'; fn f<'a>() {} // \"CM3\"\n"
        lines = code_without_comments(rs, rust=True)
        self.assertFalse(allowed(lines[0]))
        self.assertTrue(allowed(lines[1]), lines)
        tmp = PROGRAM / "tests" / "_cm3_words_probe.py"
        try:
            tmp.write_text('"""CM3 の docstring"""\nX = "CM3 に届きません"\n# CM3\nY = "cm3"\n', encoding="utf-8")
            self.assertEqual([s for _, s in py_strings(tmp) if WORD.search(s)], ["CM3 に届きません"])
        finally:
            tmp.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
