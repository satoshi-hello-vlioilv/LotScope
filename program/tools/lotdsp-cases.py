# -*- coding: utf-8 -*-
"""LotDsp の HTML の表の読み方の事例の表を焼く（版 3.98.0）。

    python program/tools/lotdsp-cases.py            # tests/fixtures/lotdsp_html_cases.json を作り直す（DOM の答えは前の表から持ち越す）
    node program/tools/lotdsp-dom-cases.mjs         # DOM（Chromium の DOMParser）の答えを足す（独立の答え。Python を使わない）

表の中身: {"python": "3.13.18"（焼いた Python の修正版）, "cases": {名前: {"html", "python": 入れ子の無い表, "dom": DOM の表,
"dom_differs": DOM と違う理由（違わなければ無い）}}}。Python（tests/test_lotdsp_html_cases.py）は自分の版が焼いた版と同じかを
確かめてから答えを比べ（違えば止まる: html.parser は修正版で答えが変わる）、窓（desktop/tests/lotdsp_cases.rs の html_cases）は
desktop/src/lotdsp_html.rs の答えを python の答えと、DOM の答えを dom_differs の無い事例で比べる。
"""
import json
import platform
import sys
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))

from app.services.lotdsp_progress import inner_tables  # noqa: E402

OUT = PROGRAM / "tests" / "fixtures" / "lotdsp_html_cases.json"

CASES = {
    # 採点の前の棚卸しで比べた 24 例（scratchpad の html_cases.py と同じ）
    "普通": "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
    "閉じない td": "<table><tr><td>a<td>b<tr><td>c</table>",
    "注釈の中の td": "<table><tr><td>a<!-- <td>x</td> --></td><td>b</td></tr></table>",
    "script の中の </td>": "<table><tr><td>a<script>var s='</td><td>z';</script></td><td>b</td></tr></table>",
    "文字参照": "<table><tr><td>&nbsp;1&amp;2&#12288;3&copy4&lt;</td></tr></table>",
    "br": "<table><tr><td>a<br>b<br/>c</td></tr></table>",
    "入れ子": "<table><tr><td><table><tr><td>in</td></tr></table></td><td>out</td></tr></table>",
    "caption と p": "<table><caption>題</caption><tr><td>a<p>b</p></td></tr></table>",
    "表の外の td": "<td>x</td><table><tr><td>y</td></tr></table>",
    "select の字": "<table><tr><td><select><option>甲</option><option>乙</option></select></td></tr></table>",
    "textarea": "<table><tr><td><textarea><td>t</td></textarea></td></tr></table>",
    "template": "<table><tr><td>a</td></tr></table><template><table><tr><td>T</td></tr></table></template>",
    "大文字のタグ": "<TABLE><TR><TD>A</TD></TR></TABLE>",
    "属性の中の >": "<table><tr><td title='a>b'>c</td></tr></table>",
    "noscript": "<table><tr><td><noscript>n</noscript>v</td></tr></table>",
    "表の中の地の字": "<table>地<tr><td>a</td></tr></table>",
    "style の中": "<table><tr><td><style>td{}</style>s</td></tr></table>",
    "全角空白と nbsp": "<table><tr><td>　a  b\t</td></tr></table>",
    "tr の外の td": "<table><td>a</td><td>b</td></table>",
    "閉じない table": "<table><tr><td>a</td></tr>",
    "空の行": "<table><tr><td> </td></tr><tr><td>x</td></tr></table>",
    "CDATA": "<table><tr><td><![CDATA[c]]>d</td></tr></table>",
    "plaintext": "<table><tr><td>a</td></tr></table><xmp><table><tr><td>X</td></tr></table></xmp>",
    "ng-hide の span": "<table><tr><td><span class='ng-hide'>旧</span><span>新</span></td></tr></table>",
    # 3.13 の修正版で読み方が替わった形（閉じない注釈・--!>・RCDATA〈textarea・title〉の中の </td>・script の中の </script 系）
    "閉じない注釈": "<table><tr><td>a</td><td>b<!-- c</td></tr></table>",
    "--!> で閉じる注釈": "<table><tr><td>a<!-- x --!>b</td></tr></table>",
    "すぐ閉じる注釈 <!-->": "<table><tr><td>a<!-->b</td></tr></table>",
    "すぐ閉じる注釈 <!--->": "<table><tr><td>a<!--->b</td></tr></table>",
    "title の中の </td>": "<table><tr><td><title>x</td>y</title>z</td></tr></table>",
    "textarea の中の文字参照": "<table><tr><td><textarea>&lt;&amp;</textarea></td></tr></table>",
    "script の中の </scriptx>": "<table><tr><td>a<script>1</scriptx>2</script>b</td></tr></table>",
    "script の中の </SCRIPT >": "<table><tr><td>a<script>1</SCRIPT >b</td></tr></table>",
    "閉じない script": "<table><tr><td>a</td></tr></table><script>var x = '<table><tr><td>z</td></tr></table>",
    "iframe の中": "<table><tr><td>a<iframe><td>i</td></iframe>b</td></tr></table>",
    "noembed の中": "<table><tr><td>a<noembed>n</noembed>b</td></tr></table>",
    "plaintext の後": "<table><tr><td>a</td></tr></table><plaintext><table><tr><td>P</td></tr></table>",
    "閉じない属性の引用符": "<table><tr><td>a</td></tr></table><table><tr><td title='x>b</td></tr></table><table><tr><td>c</td></tr></table>",
    "< だけ": "<table><tr><td>1 < 2</td></tr></table>",
    "</> と </ 1>": "<table><tr><td>a</>b</ 1>c</td></tr></table>",
    "<? 処理命令": "<table><tr><td>a<?php echo 1 ?>b</td></tr></table>",
    "doctype と <!x>": "<!DOCTYPE html><table><tr><td>a<!x>b</td></tr></table>",
    "<td/> と <table/>": "<table><tr><td/>a<td>b</td></tr></table><table/>",
    "<script/>": "<table><tr><td>a<script/>b</td></tr></table>",
    "大きな数の参照": "<table><tr><td>&#x110000;&#0;&#128;&#xD800;&#9;x&#99999999999;</td></tr></table>",
    "名前の参照の切り方": "<table><tr><td>&amp &ampx &notin; &notit; &copyX &;&#;&#x;</td></tr></table>",
    "地の終わりの &": "<table><tr><td>a</td></tr></table>x &amp",
    "Python だけの空白": "<table><tr><td>a\x1cb\x1dc\x1ed\x1fe\x85f</td></tr></table>",
    "JS だけの空白": "<table><tr><td>a﻿b</td></tr></table>",
    "改行と空白の並び": "<table><tr><td>\n  a\r\n\t b  \n</td></tr></table>",
    "属性に / と =": "<table><tr><td a=b/ c / d=\"e\">x</td></tr></table>",
    "タグ名に日本語": "<table><tr><td>a<span表>b</span表>c</td></tr></table>",
    "th と td の混ざり": "<table><tr><th>見出し</th><td>値</td></tr><tr><td>1</td><th>2</th></tr></table>",
    "tbody と thead": "<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>",
    "入れ子の 3 段": "<table><tr><td><table><tr><td><table><tr><td>deep</td></tr></table></td><td>mid</td></tr></table></td></tr></table>",
    "閉じない tr の空の表": "<table><tr><td></td></tr><tr></table>",
}
# 本物の画面の見本（ファイルの名前で持つ。中身は tests/fixtures の物）
FILES = {"見本 L7150C0（10 BOX）": "lotdsp_progress_L7150C0.html"}

# DOM（ブラウザ）と答えが違う事例と、その理由（取込は Python〈と同じ答えの窓〉の読み方を正とする。LotDsp の画面には出ない形）
DOM_DIFFERS = {
    "template": "Python は <template> の中の表も読む（DOM は template の中身を文書の外に持つ）",
    "<td/> と <table/>": "Python は自己終了の <td/> を空の欄として閉じる（DOM は / を無視して続きの字を欄に入れる）",
    "<script/>": "Python は自己終了の <script/> の後ろを地の字として読む（DOM は script の中身として読まない）",
    "Python だけの空白": "空白は Python の \\s（29 字。\\x1c〜\\x1f・\\x85 を含む）で縮める（JS の \\s は 25 字で、これらを含まない）",
    "JS だけの空白": "\\ufeff は Python の空白ではない（JS の \\s は含む）",
}


def main():
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"cases": {}}
    out = {"note": __doc__.strip().splitlines()[0], "python": platform.python_version(), "cases": {}}
    items = [(n, {"html": h}, h) for n, h in CASES.items()]
    items += [(n, {"file": f}, (PROGRAM / "tests" / "fixtures" / f).read_text(encoding="utf-8")) for n, f in FILES.items()]
    for name, src, html in items:
        prev = old["cases"].get(name) or {}
        c = {**src, "python": inner_tables(html)}
        if name in DOM_DIFFERS:
            c["dom_differs"] = DOM_DIFFERS[name]
        if prev.get("html") == src.get("html") and prev.get("file") == src.get("file"):
            for k in ("dom",):
                if k in prev:
                    c[k] = prev[k]
        out["cases"][name] = c
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(items)} 例を焼きました（Python {out['python']}）→ {OUT}")


if __name__ == "__main__":
    main()
