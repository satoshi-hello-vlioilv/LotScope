# -*- coding: utf-8 -*-
"""変換表（版 3.42.0。services/conversions.py・式の conv）の評価関数。

利用者の要望（2026-10）: Power Query（M 言語）の条件（サンプル 1〜3）を分解して変換表のマスタに入れ、プリセットにする。
分解した表（同梱の app/master_defaults/conversions.json）が元の M 言語と同じ答えを出すかを、M 言語の if … else if をそのまま写した
「元の式」（下の m_*）と、値の組を総当たりで突き合わせて確かめる。画面の式（list-formula.js の conv）も同じ答えか（node があれば）。
M 言語と分かっていて違う所（数でない値の大小）は m_* の説明に書く。
"""
import itertools
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from app.services import conversions as cv
from app.services import formula as F

ROOT = Path(__file__).resolve().parents[1]
PRESETS = json.loads((ROOT / "app" / "master_defaults" / "conversions.json").read_text(encoding="utf-8"))
TABLES = cv.tables(PRESETS)
# 元の式のまま残した、どの値でも当たらない行（0 から数えた行の番号）。管理分類の 27 行目（板厚 0.33 以下 かつ 3.0 以上）・
# 33 行目（板幅 700 以下は上の 28 行目で決まる）。版 3.42.0 は行のメモに書いていた（版 3.43.0 でメモをやめた）
UNREACHABLE = {"管理分類": (26, 32)}
TOOL = ROOT / "tools" / "formula-parity.mjs"


# ---------------------------------------------------------------- 元の式（M 言語のまま。Text.From → 字、数値型に変換 → 数か None）
def text(v):
    return None if v is None else F.text_of(v)


def start(s, n):
    return None if s is None else s[:n]


def num(v):
    """数値型に変換（カスタム関数）。中身は分からないので「数に読めれば数、読めなければ None」とする。
    M 言語では None との大小は null になり if で止まる（エラー）が、変換表では「当たらない」とする（そのセルだけの違い）"""
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def le(a, b):
    return a is not None and a <= b


def ge(a, b):
    return a is not None and a >= b


def lt(a, b):
    return a is not None and a < b


def gt(a, b):
    return a is not None and a > b


def m_code(pairs):
    def f(v):
        a = text(v)
        for k, out in pairs:
            if a == k:
                return out
        return v
    return f


M_CODES = {
    "ｺﾝﾏ5本区分": m_code([("0", "0:一本口"), ("1", "1:厚別親"), ("2", "2:切別親"), ("3", "3:子ｶｰﾄﾞ"), ("9", "9:0.5本残")]),
    "地取区分": m_code([("0", "0:一般"), ("2", "2:再手配"), ("4", "4:計画生産"), ("5", "5:再地取"), ("6", "6:元板起因による再手配")]),
    "納期符号": m_code([("1", "1:事前約束品"), ("2", "2:顧客指定品"), ("3", "3:短納期品"), ("4", "4:当月売上品"), ("5", "5:顧客在庫品"),
                       ("6", "6:看_敷_中素"), ("C", "C:中間素材"), ("D", "D:HOTﾀﾞﾐｰ"), ("K", "K:皮材"), ("G", "G:技革品"), ("S", "S:予備資材"),
                       ("Y", "Y:原価見積"), ("Z", "Z:ﾏｽﾀｰﾛｯﾄ")]),
    "特急区分": m_code([("0", ""), ("1", "約"), ("2", "特")]),
    "保留区分": m_code([("0", ""), ("1", "工"), ("2", "R"), ("3", "F"), ("4", "A"), ("5", "K"), ("6", "B"), ("7", "ｽｹ"), ("8", "解")]),
}


def m_keijo(hyo, kei, you):
    """サンプル 1 の形状区分"""
    You1, Kei1, Hyo1 = start(text(you), 1), start(text(kei), 1), start(text(hyo), 1)
    if Hyo1 == "1":
        return "HOT"
    if Hyo1 == "2":
        return "2HI"
    if Hyo1 == "4" and Kei1 == "3":
        return "箔" if You1 == "E" else "4HIｺｲﾙ"
    if Hyo1 == "4" and Kei1 == "2":
        return "4HIｻｰｸﾙ"
    if Hyo1 == "4" and Kei1 == "1":
        return "4HI板"
    return "その他"


def m_kanri(kei, zai, cho, atsu, haba, you):
    """サンプル 2 の管理分類（元の式の並び・かっこのまま）。Text.Start(null, n) <> "T" は M 言語で真（null <> "T"）"""
    OD材質, OD調質, OD板厚, OD板幅, 形状分類, 用途 = text(zai), text(cho), num(atsu), num(haba), text(kei), text(you)
    s = lambda x, n: start(x, n)       # noqa: E731
    if 形状分類 == "箔":
        return "並純箔" if OD材質 in ("NFCE", "NSCR") else "PH対策材"
    if 形状分類 in ("HOT", "2HI"):
        if 形状分類 == "HOT" and OD調質 == "R" and ge(OD板厚, 8) and le(OD板厚, 10):
            return "8･10mm"
        if s(OD調質, 1) != "T" and le(OD板厚, 30):
            return "ﾊﾟｲﾗｰ材"
        if 形状分類 == "HOT" and s(OD調質, 1) != "T" and gt(OD板厚, 30) and le(OD板厚, 75):
            return "ｸﾚｰﾝ材"
        if 形状分類 == "HOT":
            return "ﾄﾝｸﾞ･極厚材"
        if 形状分類 == "2HI" and OD材質 == "61S" and s(OD調質, 1) == "T" and le(OD板厚, 30):
            return "61S_8-30mm"
        if OD材質 == "61S" and s(OD調質, 1) == "T" and gt(OD板厚, 30):
            return "61S_31mm以上"
        if OD材質 == "17S" and s(OD調質, 1) == "T" and le(OD板厚, 30):
            return "17S_8-30mm"
        if OD材質 == "17S" and s(OD調質, 1) == "T" and gt(OD板厚, 30):
            return "17S_31mm以上"
        return "その他2HI"
    if 形状分類 == "4HIｻｰｸﾙ":
        return "ｻｰｸﾙ材"
    if 形状分類 == "4HI板":
        if OD材質 == "52S" and le(OD板厚, 1.6):
            return "52S_1.6mm以下"
        if OD材質 == "52S" and ge(OD板厚, 2) and le(OD板厚, 3):
            return "52S_2.0-3.0mm(押加工焼鈍)"
        if OD材質 == "NK01" and le(OD板厚, 3):
            return "NK01_3.0mm以下"
        if s(OD調質, 1) != "T" and ge(OD板厚, 6):
            return "ST2ｺｰｽ"
        if 用途 != "H259" and s(OD調質, 1) != "T" and ge(OD板厚, 3.1) and lt(OD板厚, 6):
            return "TULｺｰｽ"
        if s(OD調質, 1) == "T":
            return "焼入材"
        if s(OD調質, 1) == "O" and le(OD板厚, 3):
            return "その他O材"
        if s(OD調質, 3) == "H24" and le(OD板厚, 3):
            return "H24_板材"
        return "その他4HI板"
    if 形状分類 == "4HIｺｲﾙ":
        if OD材質 == "MFX2":
            if OD板幅 in (26, 32, 56):
                return "NS1ｺｰｽ"
            if le(OD板幅, 700):
                return "MFX2条割り品"
            return "その他ｺｲﾙ"
        if le(OD板幅, 700) and le(OD板厚, 0.32):
            return "薄物ｽﾘｯﾄ品"
        if le(OD板幅, 700) and ge(OD板厚, 3.1):
            return "厚物ｽﾘｯﾄ品"
        if le(OD板幅, 700) and (le(OD板厚, 0.33) and ge(OD板厚, 3.0)) and (OD調質 == "O" or s(OD調質, 2) == "H2"):
            return "厚物ｽﾘｯﾄ品"
        if le(OD板幅, 700):
            return "その他条割ｺｰｽ"
        if s(用途, 3) == "K13":
            return "NP材(元ｺｲﾙ)(K131)"
        if s(用途, 3) != "K13" and OD材質 == "NK01" or OD材質 == "1100":
            return "NK01/1100ﾊﾟﾈﾙ材"
        if 用途 in ("F975", "F976", "F982", "F978", "F989"):
            return "ｸﾘﾔｰ材"
        if le(OD板幅, 700):
            return "その他条割ｺｰｽ"
        if OD材質 in ("NP56", "N532") or s(OD材質, 3) == "5MB" or (OD材質 or "")[-3:] == "52S":
            return "5XXX系･ｸﾘﾔｰ以外"
        return "その他ｺｲﾙ"
    return "その他"


def m_ka(設備):
    """サンプル 3 の ConvertToDepartment（設備が空の字のときも「不明」にする: 変換表は空欄を null と同じに見る）"""
    設備 = None if 設備 is None or text(設備).strip() == "" else text(設備)
    括弧Check = 設備[:1] if 設備 is not None else ""
    tmp = 設備.replace("(", "").replace(")", "") if 設備 is not None and 括弧Check == "(" else 設備
    if 設備 is None:
        return "不明"
    if 括弧Check == "(":
        return "(" + tmp + ")"
    c = lambda x: x in tmp          # noqa: E731
    for test, out in [(c("生産管理"), "生産管理"), (tmp[:1] == "G", "外注"), (tmp[:3] == "TPA", "物流"), (c("技術室"), "技術室"), (c("INS"), "試験室")]:
        if test:
            return out
    for k in ("AIM", "VC", "KEN", "TUP", "TUK", "CTS", "CTL", "LL7", "CS"):
        if c(k):
            return "梱包課"
    if tmp[:1] == "P":
        return "梱包課"
    for ks, out in [(("TUL", "HOT", "2HI", "QF"), "熱延課"), (("CAS", "SSW", "SCA"), "鋳造課"), (("PSW", "TUR", "ST2", "RSW"), "熱延課"),
                    (("L-", "RG"), "冷延課"), (("LS", "TLV", "CA", "FS", "DL"), "仕上課")]:
        if any(c(k) for k in ks):
            return out
    if tmp in ("ANF", "ANI", "CF", "CL"):
        return "仕上課"
    if c("NS1"):
        return "仕上課"
    return "その他"


# ---------------------------------------------------------------- 値の組
KEI = ["箔", "HOT", "2HI", "4HIｻｰｸﾙ", "4HI板", "4HIｺｲﾙ", "その他", ""]
ZAI = ["NFCE", "NSCR", "61S", "17S", "52S", "NK01", "MFX2", "1100", "NP56", "N532", "5MB1", "A52S", "A1100", ""]
CHO = ["R", "T4", "O", "H24", "H22", "H14", ""]
ATSU = [0.2, 0.32, 0.33, 1.6, 1.7, 2, "3", 3.05, 3.1, 5.9, 6, 8, 10, 30, 30.5, 75, 76, "", "x"]
HABA = [26, "32", 56.0, 700, 701, ""]
YOU = ["E123", "H259", "K131", "F975", "F989", "A100", ""]
EQUIP = [None, "", "(LS3)", "(TU(L))", "生産管理A", "G01", "TPA2", "TPX", "技術室", "INS1", "AIM", "VC2", "CTS1", "LL7", "CS3", "P12", "TUL", "HOT",
         "2HI", "QF1", "CAS1", "SSW", "SCA2", "CA1", "PSW", "TUR", "ST2", "RSW", "L-1", "RG2", "LS3", "TLV", "FS1", "DL2", "ANF", "ANI", "CF", "CL",
         "CLX", "NS1", "XYZ", "ca"]
HYO = ["1", "11", 2, "4", "41", "5", "", None]
KEI_CODE = ["1", "2", "3", 31, "4", "", None]
YOU2 = ["E1", "e1", "F2", "", None]
CODES = ["0", 0, "1", 2, "2.0", "3", "4", "5", "6", "7", "8", "9", "C", "D", "K", "G", "S", "Y", "Z", "X", "", None, " 1 "]


_FORMULAS = {}


def conv(name, *vals, tables=None):
    """変換表 name に値を渡した答え（式 conv('name', [v0], …)。式は 1 度だけ読む）"""
    key = (name, len(vals))
    if key not in _FORMULAS:
        _FORMULAS[key] = F.Formula(f"conv('{name}', " + ", ".join(f"[v{i}]" for i in range(len(vals))) + ")")
    F.use_tables((tables or TABLES).get)
    try:
        return _FORMULAS[key].run(lambda c: vals[int(c[1:])])
    finally:
        F.use_tables(None)


def norm(v):
    """M 言語の答えと比べる形（空は None と "" を同じに・数は字に。一覧は字で見せる）"""
    return "" if v is None else F.text_of(v)


def kanri_cases():
    """管理分類の値の組（全部で 62 万通りを 11 おきに。11 はどの段の値の数〈8・14・7・19・6・7〉とも互いに素なので、どの段の値もまんべんなく出る）"""
    return list(itertools.product(KEI, ZAI, CHO, ATSU, HABA, YOU))[::11]


def cases():
    """(表, 値の組, 元の式の答え)"""
    out = []
    for name, f in M_CODES.items():
        # 変換表は前後の空白を除いて比べる（M 言語は除かない。「 1 」は M 言語では読み替えず、変換表は「1」として読み替える）
        for v in CODES:
            w = f(v.strip() if isinstance(v, str) else v)
            out.append((name, (v,), v if isinstance(v, str) and w == v.strip() else w))     # 当たらなければ元の値のまま（空白も）
    out += [("形状区分", t, m_keijo(*t)) for t in itertools.product(HYO, KEI_CODE, YOU2)]
    out += [("管理分類", t, m_kanri(*t)) for t in kanri_cases()]
    out += [("課名", (e,), m_ka(e)) for e in EQUIP]
    return out


class PresetsMatchTheMCode(unittest.TestCase):
    def test_presets_are_clean(self):
        self.assertEqual([r["名前"] for r in PRESETS], ["ｺﾝﾏ5本区分", "地取区分", "納期符号", "特急区分", "保留区分", "形状区分", "管理分類", "課名"])
        for r in PRESETS:
            again = cv.clean_row(cv.view(r) | {"order": cv.view(r)["order"]})
            self.assertEqual({k: again[k] for k in ("名前", "入力", "判定", "その他", "当て方")}, {k: r[k] for k in ("名前", "入力", "判定", "その他", "当て方")},
                             f"{r['名前']}: 確かめに通しても変わらない")

    def test_each_table_gives_the_m_answer(self):
        bad = []
        for name, vals, want in cases():
            got = conv(name, *vals)
            # コードの読み替えで「元の値のまま」のときは、前後の空白も元のまま（M 言語も同じ）
            if norm(got) != norm(want):
                bad.append((name, vals, want, got))
        self.assertFalse(bad, f"{len(bad)} 件が M 言語と食い違い。最初の 8 件:\n" + "\n".join(f"  {n} {v!r}: M={w!r} 表={g!r}" for n, v, w, g in bad[:8]))
        self.assertGreater(len(cases()), 50000, "管理分類は値の組を 5 万通り以上試す")

    def test_every_row_is_reached_or_marked(self):
        """管理分類・課名の行は、どれも試した値のどれかで当たる（当たらない行は UNREACHABLE に書いた行だけ）。
        出す値を行の番号にした表で、最初に当たった行を調べる"""
        for name, combos in (("管理分類", kanri_cases()), ("課名", [(e,) for e in EQUIP])):
            tb = TABLES[name]
            numbered = {name: {**tb, "rows": [{**r, "out": str(i)} for i, r in enumerate(tb["rows"])], "other": "-"}}
            hits = {conv(name, *vals, tables=numbered) for vals in combos}
            marked = {str(i) for i in UNREACHABLE.get(name, ())}
            missed = {str(i) for i in range(len(tb["rows"]))} - hits - marked
            self.assertFalse(missed, f"{name}: 試した値で当たらない行 {sorted(int(i) + 1 for i in missed)}")
            self.assertFalse(marked & hits, f"{name}: 当たらないと書いた行が当たった {sorted(int(i) + 1 for i in marked & hits)}")


class TableRules(unittest.TestCase):
    def one(self, rows, other="", inputs=None, *vals):
        tb = {"inputs": inputs or [{"name": "x", "type": "text"}], "rows": rows, "other": other}
        F.use_tables({"t": tb}.get)
        try:
            return F.Formula("conv('t', " + ", ".join(f"[v{i}]" for i in range(len(vals))) + ")").run(lambda c: vals[int(c[1:])])
        finally:
            F.use_tables(None)

    def test_tests(self):
        r = lambda *ts: [{"when": {"x": list(ts)}, "out": "当"}]   # noqa: E731
        self.assertEqual(self.one(r({"op": "eq", "v": ["a", "b"]}), "外", None, " b "), "当", "前後の空白を除いて比べる・どれか")
        self.assertEqual(self.one(r({"op": "eq", "v": ["A"]}), "外", None, "a"), "外", "大小は区別する")
        self.assertEqual(self.one(r({"op": "ne", "v": ["a", "b"]}), "外", None, "c"), "当")
        self.assertEqual(self.one(r({"op": "nstarts", "v": ["T"]}), "外", None, None), "当", "空は T で始まらない")
        self.assertEqual(self.one(r({"op": "starts", "v": [""]}), "外", None, "x"), "外", "空の値は始まる・含むに使わない")
        self.assertEqual(self.one(r({"op": "range", "min": 3, "max": 6, "maxInc": False}), "外", None, "6"), "外", "未満")
        self.assertEqual(self.one(r({"op": "range", "min": 3}), "外", None, "1,000"), "当", "3 桁区切りも数")
        self.assertEqual(self.one(r({"op": "range", "max": 3}), "外", None, ""), "外", "空は範囲に当たらない")
        self.assertEqual(self.one(r({"op": "empty"}), "外", None, "  "), "当")
        num = [{"name": "x", "type": "num"}]
        self.assertEqual(self.one(r({"op": "eq", "v": ["26"]}), "外", num, 26.0), "当", "数の入力は数で比べる")
        self.assertEqual(self.one(r({"op": "eq", "v": ["26"]}), "外", None, "26.0"), "外", "字の入力は字で比べる")

    def test_rows_other_and_formulas(self):
        rows = [{"when": {}, "out": "=[x] + '!'"}]
        self.assertEqual(self.one(rows, "", None, "a"), "a!", "条件の無い行は必ず当たる・= で始まれば式")
        self.assertEqual(self.one([], "=[x]", None, 7), 7, "どれにも当たらなければその他（元の値のまま）")
        self.assertIsNone(self.one([{"when": {}, "out": "=[x"}], "", None, "a"), "読めない式は空")
        F.use_tables(None)
        self.assertIsNone(F.Formula("conv('無い表', 1)").run(lambda c: None), "表が無ければ空")
        self.assertEqual(F.check("conv('t')")["ok"], False, "値が 1 つも無ければ読めない")


class CleanRow(unittest.TestCase):
    def base(self, **kw):
        return {"name": "表", "inputs": [{"name": "x"}], "rows": [{"when": {"x": [{"op": "eq", "v": ["1"]}]}, "out": "一"}], "other": "=[x]", **kw}

    def test_errors(self):
        for kw, word in [({"name": ""}, "名前"), ({"inputs": []}, "入力を 1 つ以上"), ({"inputs": [{"name": "x"}, {"name": "x"}]}, "2 つあります"),
                         ({"rows": [{"when": {"y": [{"op": "eq", "v": ["1"]}]}}]}, "入力にありません"),
                         ({"rows": [{"when": {"x": [{"op": "??"}]}}]}, "比べ方"), ({"rows": [{"when": {"x": [{"op": "range"}]}}]}, "端を"),
                         ({"rows": [{"when": {"x": [{"op": "range", "min": "a"}]}}]}, "数で"), ({"other": "=[y]"}, "入力にありません"),
                         ({"other": "=(1"}, "読めません")]:
            with self.subTest(kw=kw), self.assertRaises(cv.ConversionError) as e:
                cv.clean_row(self.base(**kw))
            self.assertIn(word, str(e.exception))

    def test_shape(self):
        r = cv.clean_row(self.base(apply={"mode": "add", "column": "{列}_読", "place": "after"}, order=20, note=" メモ "))
        self.assertNotIn("備考", r, "備考は持たない（版 3.43.0）")
        self.assertEqual(json.loads(r["入力"]), [{"name": "x", "type": "text", "columns": ["x"]}], "列の候補が無ければ入力の名前")
        self.assertEqual(json.loads(r["当て方"]), {"mode": "add", "column": "{列}_読", "place": "after"})
        self.assertEqual(r["表示順"], "20")
        self.assertEqual(cv.check_unique([{"id": 1, "名前": "表"}], r, None)[:5], "変換表「表")
        self.assertEqual(cv.check_unique([{"id": 1, "名前": "表"}], r, 1), "")

    def test_match_column(self):
        cols = ["ﾛｯﾄ番号", "ｵｰﾀﾞｰ板幅", "用途ｺｰﾄﾞ", "表面"]
        self.assertEqual(cv.match_column(["ｵｰﾀﾞｰ板幅"], cols), "ｵｰﾀﾞｰ板幅")
        self.assertEqual(cv.match_column(["オーダー板幅"], cols), "ｵｰﾀﾞｰ板幅", "半角・全角の違いは見ない")
        self.assertEqual(cv.match_column(["用途コード"], cols), "用途ｺｰﾄﾞ")
        self.assertEqual(cv.match_column(["形状", "形状コード"], cols), "")


class Api(unittest.TestCase):
    """マスタ「変換表」の API（最初は同梱のプリセット・足す・直す・標準に戻す・消す）と、一覧の並べ替えで conv を使う所"""

    def setUp(self):
        from app import create_app
        from app.repositories.master_store import MasterStore
        from tests.test_lot_list import make_db
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "app" / "data").mkdir(parents=True)
        for n in ("equipment_master", "roll_master", "path_settings"):
            shutil.copy(ROOT / "data" / f"{n}.json", self.tmp / "app" / "data" / f"{n}.json")
        self.db = self.tmp / "q.sqlite3"
        make_db(self.db)
        store = MasterStore(self.tmp / "app", local_root=self.tmp / "local", settings={"refresh_seconds": 0}, who={"pc": "PC-A", "login": "a"})
        self.app = create_app({"MASTER_STORE": store, "APP_SETTINGS": {"lot_list": {"source": ""}}})
        self.c = self.app.test_client()

    def tearDown(self):
        F.use_tables(None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def items(self):
        return {x["name"]: x for x in self.c.get("/api/masters/conversions").get_json()["items"]}

    def test_presets_then_edit(self):
        d = self.c.get("/api/masters/conversions").get_json()
        self.assertEqual(list(self.items())[:2], ["ｺﾝﾏ5本区分", "地取区分"], "最初は同梱のプリセット（表示順）")
        self.assertTrue(d["canEdit"] and all(x["preset"] for x in d["items"]) and "range" in d["ops"])
        r = self.c.post("/api/masters/conversions", json={"name": "異常の重さ", "inputs": [{"name": "異常"}],
                                                          "rows": [{"when": {"異常": [{"op": "eq", "v": ["ロール疵"]}]}, "out": "重"},
                                                                   {"when": {"異常": [{"op": "contains", "v": ["疵"]}]}, "out": "中"}], "other": "軽"})
        self.assertEqual(r.status_code, 201, r.get_json())
        mine = self.items()["異常の重さ"]
        self.assertFalse(mine["preset"])
        self.assertEqual(mine["order"], 90, "表示順は最後（いまの最大＋10）")
        self.assertEqual(self.c.post("/api/masters/conversions", json={"name": "異常の重さ", "inputs": [{"name": "x"}]}).status_code, 409, "同じ名前は置かない")
        self.assertEqual(self.c.post("/api/masters/conversions", json={"name": "x", "inputs": []}).status_code, 400)
        # 一覧の並べ替えで使う（アプリが式の conv にマスタの表を渡している: app/__init__.py）
        from app.services import lot_list
        calc = json.dumps({"formulas": {"重さ": "conv('異常の重さ', [異常内容])"}, "names": {}})
        got = lot_list.query(self.db, sorts=json.dumps([{"column": "重さ", "dir": "asc"}, {"column": "ロット番号", "dir": "asc"}]), calc=calc)
        self.assertEqual([r["ロット番号"] for r in got["rows"]], ["L6183D0", "L6183D1", "L6183D2", "L7150C0", "M0001A0"], "中（押し疵）→ 軽（汚れ）→ 重（ロール疵）の字の順")
        # 直す（版が違えば断る）・標準に戻す（プリセットだけ）・消す
        ji = self.items()["地取区分"]
        r = self.c.put(f"/api/masters/conversions/{ji['id']}", json={"inputs": ji["inputs"], "rows": ji["rows"][:1], "other": "", "base_rev": ji["rev"]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(self.c.put(f"/api/masters/conversions/{ji['id']}", json={"name": ji["name"], "base_rev": ji["rev"]}).status_code, 409, "古い版からは直さない")
        now = self.items()["地取区分"]
        self.assertEqual((len(now["rows"]), now["other"]), (1, ""))
        r = self.c.post(f"/api/masters/conversions/{now['id']}/preset", json={"base_rev": now["rev"]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual((len(self.items()["地取区分"]["rows"]), self.items()["地取区分"]["other"]), (5, "=[地取区分]"), "標準に戻す")
        self.assertEqual(self.c.post(f"/api/masters/conversions/{mine['id']}/preset", json={}).status_code, 400, "プリセットでない表は戻せない")
        self.assertEqual(self.c.delete(f"/api/masters/conversions/{mine['id']}?rev={self.items()['異常の重さ']['rev']}").status_code, 200)
        self.assertNotIn("異常の重さ", self.items())

    def test_export_import_defaults(self):
        """書き出す → 中身を変えて取り込む（同じ名前は置き換え・無い名前は足す）→ 標準にする → 標準に戻すと取り込んだ中身 → 同梱に戻す（版 3.43.0）"""
        out = self.c.get("/api/masters/conversions/export").get_json()["items"]
        self.assertEqual(out[0]["name"], "ｺﾝﾏ5本区分")
        self.assertFalse({"id", "order", "note"} & set(out[0]), "書き出す形に id・表示順・メモは入れない")
        ji = next(x for x in out if x["name"] == "地取区分")
        mine = {**ji, "rows": ji["rows"][:2], "other": ""}
        new = {"name": "新しい表", "inputs": [{"name": "x"}], "rows": [{"when": {"x": [{"op": "eq", "v": ["1"]}]}, "out": "一"}], "other": ""}
        bad = {"name": "壊れた表", "inputs": [], "rows": [], "other": ""}
        r = self.c.post("/api/masters/conversions/import", json={"items": [mine, bad]})
        self.assertEqual(r.status_code, 400, "1 つでも壊れていれば何も取り込まない")
        self.assertIn("壊れた表", r.get_json()["error"])
        self.assertEqual(len(self.items()["地取区分"]["rows"]), 5)
        self.assertEqual(self.c.post("/api/masters/conversions/import", json={"items": [mine, mine]}).status_code, 400, "同じ名前が 2 つ")
        r = self.c.post("/api/masters/conversions/import", json={"items": [mine, new], "asDefault": True})
        self.assertEqual(r.status_code, 200, r.get_json())
        d = r.get_json()
        self.assertEqual((d["added"], d["replaced"], d["customDefaults"]), (1, 1, True))
        now = self.items()
        self.assertEqual((len(now["地取区分"]["rows"]), now["地取区分"]["other"]), (2, ""), "同じ名前は置き換え")
        self.assertEqual(list(now)[-1], "新しい表", "無い名前は後ろに足す")
        self.assertTrue(now["新しい表"]["preset"] and not now["ｺﾝﾏ5本区分"]["preset"], "標準は取り込んだ表だけ")
        self.assertEqual([x["name"] for x in self.c.get("/api/masters/conversions/export?which=defaults").get_json()["items"]], ["地取区分", "新しい表"])
        # 直してから標準に戻すと、取り込んだ中身へ戻る
        ji = self.items()["地取区分"]
        self.c.put(f"/api/masters/conversions/{ji['id']}", json={"other": "x", "inputs": ji["inputs"], "rows": [], "base_rev": ji["rev"]})
        self.c.post(f"/api/masters/conversions/{ji['id']}/preset", json={})
        self.assertEqual((len(self.items()["地取区分"]["rows"]), self.items()["地取区分"]["other"]), (2, ""))
        # 今の表をすべて標準にする → 同梱に戻す
        self.assertTrue(all(x["preset"] for x in self.c.post("/api/masters/conversions/defaults", json={"from": "current"}).get_json()["items"]))
        d = self.c.post("/api/masters/conversions/defaults", json={"from": "bundled"}).get_json()
        self.assertFalse(d["customDefaults"])
        self.assertFalse(self.items()["新しい表"]["preset"], "同梱のプリセットに無い表は標準に戻せない")
        self.assertEqual(self.c.post("/api/masters/conversions/defaults", json={"from": "x"}).status_code, 400)

    def test_table_source_refreshes(self):
        t = [0.0]
        rows = [{"id": 1, "名前": "a", "入力": "[]", "判定": "[]", "その他": "1"}]
        rev = [1]
        src = cv.TableSource(lambda: rows, lambda: rev[0], clock=lambda: t[0])
        self.assertEqual(src.get("a")["other"], "1")
        rows[0]["その他"], rev[0] = "2", 2
        self.assertEqual(src.get("a")["other"], "1", "すぐには読み直さない（行ごとにマスタを読まない）")
        t[0] = 3.0
        self.assertEqual(src.get("a")["other"], "2", "時間がたてば新しい版")


@unittest.skipUnless(shutil.which("node"), "node がありません")
class ScreenGivesTheSameAnswer(unittest.TestCase):
    def test_list_formula_conv(self):
        cs = cases()[::37]
        items = [{"expr": f"conv('{n}', " + ", ".join(f"[v{i}]" for i in range(len(v))) + ")", "row": {f"v{i}": x for i, x in enumerate(v)}} for n, v, _ in cs]
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "cases.json"
            src.write_text(json.dumps({"cases": items, "tables": TABLES}, ensure_ascii=False), encoding="utf-8")
            r = subprocess.run(["node", str(TOOL), str(src)], capture_output=True, text=True, encoding="utf-8", timeout=180)
        self.assertEqual(r.returncode, 0, r.stderr)
        js = json.loads(r.stdout)
        bad = [(n, v, j, conv(n, *v)) for (n, v, _), j in zip(cs, js) if not j["ok"] or norm(j["value"]) != norm(conv(n, *v))]
        self.assertFalse(bad, f"{len(bad)} 件が画面とサーバーで食い違い。最初の 5 件:\n" + "\n".join(f"  {n} {v!r}: 画面={j!r} サーバー={p!r}" for n, v, j, p in bad[:5]))


if __name__ == "__main__":
    unittest.main()
