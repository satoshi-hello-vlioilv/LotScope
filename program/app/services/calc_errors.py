"""転写距離・ピッチ計算の誤りの言葉（版 3.115.0。Rust 化の段 ③ の 4 つ目・採点の first_fixes 6）。

前は計算の部品の Python の例外の字をそのまま答えた（{"error": "'thickness'", "type": "KeyError"}・"invalid literal for int() with base 10: 'x'"）。
段 ④ で窓が答えの元になると、この字が窓の仕様として残るので、例外の種類（type）と字（str(e)）から日本語の言葉にする。
"type" の欄（例外のクラスの名前）は API の名残で、画面は読まない（今のまま答える）。

窓は desktop/src/calc.rs の error_message（同じ決まり）。事例の表は tests/fixtures/calc_error_cases.json（人が書いた。Python は
tests/test_calc_errors.py、窓は cargo test --test calc_error_cases が同じ表を読む）。
"""
import re

# 例外の種類 → 言葉の形
KINDS = {"KeyError": "missing", "ValueError": "number", "IndexError": "short", "AttributeError": "text", "TypeError": "text"}
_LITERAL = re.compile(r": '(.*)'$", re.S)


def message(type_name, text):
    """例外の種類の名前と str(e) → 言葉（知らない種類は str(e) のまま）"""
    kind = KINDS.get(type_name)
    if kind == "missing":
        key = text[1:-1] if len(text) >= 2 and text[0] == text[-1] and text[0] in "'\"" else text
        return f"計算の入力に「{key}」がありません。"
    if kind == "number":
        m = _LITERAL.search(text)
        return f"計算の入力に数で読めない値「{m.group(1)}」があります（整数で書いてください）。" if m else "計算の入力に数で読めない値があります。"
    if kind == "short":
        return "計算の入力の並び（工程・候補）が足りません。"
    if kind == "text":
        return "計算の入力に字でない値があります（字で送ってください）。"
    return text


def of(e):
    return message(type(e).__name__, str(e))
