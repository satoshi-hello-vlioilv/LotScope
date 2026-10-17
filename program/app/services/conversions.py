# -*- coding: utf-8 -*-
"""変換表（版 3.42.0。現場のマスタ）: コードの読み替え・いくつかの列から区分を決める判定表に名前を付けて置き、
一覧の表示列（計算列を足す・列の値を作り替える）・ダッシュボード・スライサーから、式 conv('表の名前', 値…) で使い回す。

利用者の要望（2026-10）: Power Query（M 言語）で書いていた条件（ｺﾝﾏ5本区分・地取区分・納期符号・特急区分・保留区分の読み替え、
形状区分・管理分類の判定、設備から課名）を分解してマスタに入れ、汎用的に計算列の追加や列の作り替えに使えるプリセットにする。
最初の中身（プリセット）は同梱の app/master_defaults/conversions.json（共有にまだ無いとき、最初の版として置く: master_store._seed）。
「標準に戻す」はその同梱の中身へ戻す（preset_of）。

1 行＝1 つの表 {名前, 入力, 判定, その他, 当て方, 表示順}（入力・判定・当て方は JSON の字。版 3.43.0 で備考と行のメモをやめた）
    入力   … [{name, type, columns}]。name は表の中の呼び名（判定の when の鍵・出す値の式の [名前]）。type は text か num
              （num は 数で比べる: 26 と 26.0 は同じ・範囲）。columns はその入力に当てる列の名前の候補（当てるとき、
              一覧の列から探す。半角・全角の違いは見ない: match_column）
    判定   … [{when: {入力の名前: [試し…]}, out}]。上から順に見て、最初に当たった行の out を出す。試しの形は
              static/js/list-formula.js の conv の説明（eq・ne・starts・nstarts・ends・nends・contains・ncontains・empty・filled・range）
    その他 … どの行にも当たらないときに出す値。out と同じ書き方（= で始まれば式。=[入力] なら元の値のまま。空なら空欄）
    当て方 … 一覧へ当てるときの形 {mode, column, place}。mode: replace（入力の列の値を作り替える）・add（列を足す）。
              column: 足す列の名前（{列} は当てた入力の列の名前。例: {列}_課）。place: left（いちばん左）・after（入力の列の右）・end（右の端）
式の計算は services/formula.py の conv（画面の list-formula.js と同じ答え。試験 tests/test_formula_parity.py）。
"""
from __future__ import annotations

import json
import math
import re
import time
import unicodedata

from .formula import FormulaError, compile_formula

NAME = "conversions"
FIELDS = ["名前", "入力", "判定", "その他", "当て方", "表示順"]
NAME_MAX = 40
MAX_INPUTS = 8
MAX_ROWS = 300
MAX_TESTS = 12
MAX_VALUES = 60
VALUE_MAX = 100
OUT_MAX = 500
MAX_IMPORT = 200
OPS = {"eq": "と同じ", "ne": "と違う", "starts": "で始まる", "nstarts": "で始まらない", "ends": "で終わる", "nends": "で終わらない",
       "contains": "を含む", "ncontains": "を含まない", "empty": "空欄", "filled": "空欄でない", "range": "の範囲"}
LIST_OPS = {"eq", "ne", "starts", "nstarts", "ends", "nends", "contains", "ncontains"}
MODES = {"replace": "列の値を作り替える", "add": "列を足す"}
PLACES = {"left": "いちばん左", "after": "元の列の右", "end": "右の端"}


class ConversionError(ValueError):
    pass


def _j(v, default):
    if isinstance(v, (list, dict)):
        return v
    try:
        x = json.loads(v) if isinstance(v, str) and v.strip() else default
    except ValueError:
        return default
    return x if isinstance(x, type(default)) else default


def norm_name(s):
    """列の名前を比べる形（半角カナ・全角英数の違い、空白、大小を見ない）"""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(s or ""))).upper()


def match_column(candidates, columns):
    """入力の列の候補 → 一覧の列のうち最初に当たる物（無ければ ""）。候補の順が先（同じ名前 → 半角・全角の違いを見ない）"""
    cols = [str(c) for c in columns]
    for cand in candidates or []:
        if cand in cols:
            return cand
    by = {}
    for c in cols:
        by.setdefault(norm_name(c), c)
    for cand in candidates or []:
        hit = by.get(norm_name(cand))
        if hit:
            return hit
    return ""


# ---------------------------------------------------------------- 確かめ
def _text(v, size):
    return str(v if v is not None else "").strip()[:size]


def _num_or_blank(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return ""
    try:
        f = float(str(v).replace(",", "").strip())
    except ValueError:
        raise ConversionError(f"範囲の端は数で入れてください（{v}）。") from None
    if not math.isfinite(f):
        raise ConversionError(f"範囲の端は数で入れてください（{v}）。")
    return int(f) if f.is_integer() else f


def clean_inputs(v):
    items = _j(v, [])
    out, seen = [], set()
    for x in items[:MAX_INPUTS + 1]:
        if not isinstance(x, dict):
            continue
        name = _text(x.get("name"), NAME_MAX)
        if not name:
            raise ConversionError("入力の名前を入れてください。")
        if name in seen:
            raise ConversionError(f"入力の名前「{name}」が 2 つあります。")
        seen.add(name)
        cols = [c for c in (_text(c, 200) for c in (x.get("columns") if isinstance(x.get("columns"), list) else [])) if c][:12]
        out.append({"name": name, "type": "num" if x.get("type") == "num" else "text", "columns": cols or [name]})
    if not out:
        raise ConversionError("入力を 1 つ以上入れてください（読み替える列・判定に使う列）。")
    if len(out) > MAX_INPUTS:
        raise ConversionError(f"入力は {MAX_INPUTS} つまでです。")
    return out


def clean_test(t):
    if not isinstance(t, dict) or t.get("op") not in OPS:
        raise ConversionError("比べ方が分かりません。")
    op = t["op"]
    if op in ("empty", "filled"):
        return {"op": op}
    if op == "range":
        lo, hi = _num_or_blank(t.get("min")), _num_or_blank(t.get("max"))
        if lo == "" and hi == "":
            raise ConversionError("範囲は、下か上の端を 1 つ以上入れてください。")
        out = {"op": op}
        if lo != "":
            out["min"] = lo
            if t.get("minInc") is False:
                out["minInc"] = False
        if hi != "":
            out["max"] = hi
            if t.get("maxInc") is False:
                out["maxInc"] = False
        return out
    vs = [_text(x, VALUE_MAX) for x in (t.get("v") if isinstance(t.get("v"), list) else [t.get("v")]) if x is not None]
    vs = list(dict.fromkeys(x for x in vs if x != "" or op in ("eq", "ne")))[:MAX_VALUES]
    if not vs:
        raise ConversionError(f"「{OPS[op]}」の値を入れてください。")
    return {"op": op, "v": vs}


def _check_out(o, names, where):
    t = "" if o is None else str(o)[:OUT_MAX]
    if t.startswith("="):
        try:
            f = compile_formula(t[1:])
        except FormulaError as e:
            raise ConversionError(f"{where}の式が読めません: {e}") from None
        extra = [c for c in f.columns if c not in names]
        if extra:
            raise ConversionError(f"{where}の式は入力の名前だけを [ ] で読めます（{'・'.join(extra)} は入力にありません）。")
    return t


def clean_rows(v, inputs):
    names = [x["name"] for x in inputs]
    items = _j(v, [])
    if len(items) > MAX_ROWS:
        raise ConversionError(f"判定の行は {MAX_ROWS} 行までです。")
    out = []
    for i, r in enumerate(items):
        if not isinstance(r, dict):
            continue
        when = {}
        for k, ts in (r.get("when") if isinstance(r.get("when"), dict) else {}).items():
            if k not in names:
                raise ConversionError(f"{i + 1} 行目の条件の「{k}」は入力にありません。")
            tests = [clean_test(t) for t in (ts if isinstance(ts, list) else [])][:MAX_TESTS]
            if tests:
                when[k] = tests
        out.append({"when": when, "out": _check_out(r.get("out"), names, f"{i + 1} 行目の出す値")})
    return out


def clean_apply(v):
    a = _j(v, {})
    mode = a.get("mode") if a.get("mode") in MODES else "add"
    out = {"mode": mode}
    if mode == "add":
        out["column"] = _text(a.get("column"), NAME_MAX * 2) or ""
        out["place"] = a.get("place") if a.get("place") in PLACES else "end"
    return out


def clean_row(data, partial=False):
    """画面から来た値（name・inputs・rows・other・apply・order）→ マスタの行。partial は直すとき（来た物だけ）。"""
    out = {}
    if not partial or "name" in data:
        name = _text(data.get("name"), NAME_MAX)
        if not name:
            raise ConversionError("変換表の名前を入れてください。")
        if "'" in name and '"' in name:
            raise ConversionError("名前に ' と \" を両方は使えません（式の中で名前を書けなくなります）。")
        out["名前"] = name
    if not partial or "inputs" in data or "rows" in data or "other" in data:
        inputs = clean_inputs(data.get("inputs"))
        names = [x["name"] for x in inputs]
        out["入力"] = json.dumps(inputs, ensure_ascii=False)
        out["判定"] = json.dumps(clean_rows(data.get("rows"), inputs), ensure_ascii=False)
        out["その他"] = _check_out(data.get("other"), names, "どれにも当たらないときの値")
    if not partial or "apply" in data:
        out["当て方"] = json.dumps(clean_apply(data.get("apply")), ensure_ascii=False)
    if "order" in data:
        try:
            out["表示順"] = str(int(data.get("order")))
        except (TypeError, ValueError):
            out["表示順"] = ""
    return out


def clean_import(items):
    """書き出したファイルの表の並び（画面の形 {name, inputs, rows, other, apply}）→ マスタの行の並び（版 3.43.0）。
    1 つでも誤りがあれば、どの表の何が違うかを言って断る（半分だけ取り込まない）。ファイルの中で同じ名前が 2 つあっても断る"""
    if not isinstance(items, list) or not items:
        raise ConversionError("取り込む変換表がありません。")
    if len(items) > MAX_IMPORT:
        raise ConversionError(f"取り込めるのは {MAX_IMPORT} 表までです。")
    out, seen = [], set()
    for i, x in enumerate(items):
        if not isinstance(x, dict):
            raise ConversionError(f"{i + 1} つ目は変換表の形ではありません。")
        try:
            row = clean_row({k: x.get(k) for k in ("name", "inputs", "rows", "other", "apply")})
        except ConversionError as e:
            raise ConversionError(f"「{x.get('name') or f'{i + 1} つ目'}」: {e}") from None
        if row["名前"] in seen:
            raise ConversionError(f"ファイルの中に「{row['名前']}」が 2 つあります。")
        seen.add(row["名前"])
        out.append(row)
    return out


def export_items(rows):
    """マスタの行 → 書き出す形（画面の形から id・版・表示順を除いた物。表示順は並びの順で表す）"""
    return [{k: v for k, v in view(r).items() if k not in ("id", "order")} for r in ordered(rows)]


def check_unique(rows, row, self_id=None):
    """名前は 1 つずつ（式の conv('名前', …) で引くため）。重なればその文、無ければ ""。"""
    name = str(row.get("名前") or "")
    for r in rows:
        if r.get("id") != self_id and str(r.get("名前") or "") == name:
            return f"変換表「{name}」はもうあります。別の名前にしてください。"
    return ""


# ---------------------------------------------------------------- 読む
def _rows(v):
    """判定の行は when と out だけを読む（版 3.42.0 の共有のマスタに残る行のメモ note は見せない）"""
    return [{"when": x.get("when") if isinstance(x.get("when"), dict) else {}, "out": x.get("out", "")} for x in _j(v, []) if isinstance(x, dict)]


def view(r):
    """マスタの行 → 画面・計算の形 {id, name, inputs, rows, other, apply, order}"""
    def order(x):
        try:
            return int(x)
        except (TypeError, ValueError):
            return 0
    return {"id": r.get("id"), "name": str(r.get("名前") or ""), "inputs": _j(r.get("入力"), []), "rows": _rows(r.get("判定")),
            "other": str(r.get("その他") or ""), "apply": _j(r.get("当て方"), {}), "order": order(r.get("表示順"))}


def ordered(rows):
    return sorted(rows, key=lambda r: (view(r)["order"], int(r.get("id") or 0)))


def tables(rows):
    """マスタの行 → {名前: 表}（式の conv が引く形。services/formula.py の use_tables へ渡す）"""
    out = {}
    for r in ordered(rows):
        v = view(r)
        if v["name"] and v["name"] not in out:
            out[v["name"]] = {"inputs": v["inputs"], "rows": v["rows"], "other": v["other"]}
    return out


def preset_of(bundled_rows, name):
    """同梱のプリセット（app/master_defaults/conversions.json）のうち、その名前の行（標準に戻す）。無ければ None"""
    for r in bundled_rows or []:
        if str(r.get("名前") or "") == name:
            return r
    return None


class TableSource:
    """式の conv が引く表（名前 → 表）。マスタを読み直すのは、前に読んでから REFRESH 秒たったときだけ
    （conv は一覧・集計の行ごとに呼ばれるので、行ごとにマスタを読まない）。版が同じなら読み解いた表を使い回す"""

    REFRESH = 2.0

    def __init__(self, read_rows, read_revision, clock=None):
        self._rows, self._rev, self._clock = read_rows, read_revision, clock or time.monotonic
        self._at, self._seen, self._tables = -1e9, None, {}

    def get(self, name):
        now = self._clock()
        if now - self._at >= self.REFRESH:
            self._at = now
            try:
                rev = self._rev()
                if rev != self._seen:
                    self._tables, self._seen = tables(self._rows()), rev
            except Exception:       # マスタを読めないときは、前に読んだ表のまま
                pass
        return self._tables.get(name)
