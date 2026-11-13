# -*- coding: utf-8 -*-
"""置き場の読めない行を行ごとに隔てる決まり（版 3.107.0。Rust 化の段 ① の 4 歩目・案 E3＋E4）。

前は、置き場のファイルに読めない行が 1 行あるだけで、窓（Rust）はそのマスタの道を全部 Python に任せ、Python の答えにも誤りがあった
（NaN の行で一覧が JSON でなくなる・名前が数の行で一覧が 500・版の読めない行で PUT は「見つかりません」・DELETE は書かずに {ok: true}）。
ここは「どの行を隔てるか」と理由の言葉だけを持つ（窓の desktop/src/row_check.rs と同じ決まり。事例は tests/fixtures/row_cases.json）:

- 表でない行（版 3.102.0。読むときは飛ばし、書く道はマスタごと止める）
- id が数（int。真偽も）でない（字の "4"・小数・null・並び）
- 版（rev）が int() で読めない（"二"・null・"3.5"・並び）
- 置く項目の値が並び・表・数でない値（NaN・Infinity）。字だけを置く列（STR_COLS）は字でなければ・名前の列（NAME_COLS）は字か null でなければ
- 中身の列（CONTENT_COLS。JSON の字）に、数でない値（NaN・Infinity・1e400）・対の無い代用字・入れ子 128 段以上

読まない値（知らない鍵・ほかの元の行の値）は隔てない（Python はそのまま持って書き戻す。窓は pyjson の J のまま持って同じ字で書き戻す）。
隔てた行は一覧に出さず、答えの skipped（{row: 何行目, why: 理由}）で知らせる。書く道は、隔てた行に触れる直す・消すだけを止め
（MasterUnreadable）、足すは通す。次の id と名前の重なりの確かめは隔てた行も数え、隔てた行はそのまま書き戻す。
権限の 2 つ（STRICT）は読みは今どおりで、隔てる形の行があれば書く道を全部止める（黙って権限が変わらないように）。
"""
import json
import math

# 名前の列（字か null でなければ隔てる。一覧が名前で並べ替える・比べる列）
NAME_COLS = {
    "equipment_master": "設備名", "roll_master": "設備", "path_settings": "項目", "access_permissions": "ログインID", "tab_access": "タブ",
    "work_log_files": "設備名", "display_formats": "名前", "shift_patterns": "名称", "equipment_groups": "名称", "conversions": "名前",
    "conversion_defaults": "名前", "pivot_presets": "名前", "pivot_quick": "ログインID", "data_sources": "キー",
    "dashboard_settings": "キー", "dashboards": "名前",
}
_PRESET = ("名前", "元", "範囲", "ログインID", "標準", "中身", "備考")
# 字だけを置く列（字でなければ隔てる。null も。プリセットの行の形は、元・範囲・標準を字で比べて組を決める）
STR_COLS = {"dashboards": _PRESET, "pivot_presets": _PRESET, "display_formats": ("名前", "元", "表", "作った所", "中身", "備考"),
            "pivot_quick": ("ログインID", "元", "並び")}
# 中身の列（JSON の字）
CONTENT_COLS = {"dashboards": ("中身",), "pivot_presets": ("中身",), "display_formats": ("中身",), "pivot_quick": ("並び",),
                "equipment_groups": ("ルール",), "conversions": ("入力", "判定", "当て方"),
                "conversion_defaults": ("入力", "判定", "当て方"), "shift_patterns": ("区分",), "data_sources": ("結合",),
                "dashboard_settings": ("条件",)}
# 行を丸ごと答える（一覧が行をそのまま返す）マスタ: 知らない鍵の数でない値も答えに出る（答えが JSON でなくなる）ので隔てる
RAW = frozenset({"equipment_master", "roll_master"})
STRICT = frozenset({"access_permissions", "tab_access"})
# マスタの置き場の状態（status）で隔てた行を知らせるマスタ: 一覧が隔てる物・権限の 2 つ・参照先（触れる書きを断る）。
# ほかのマスタ（データ元・作業実績の登録・変換表の標準）は、まだ一覧も書く道も行を隔てない（窓の row_check::STATUS と同じ）
STATUS = frozenset({"equipment_master", "roll_master", "shift_patterns", "equipment_groups", "conversions", "display_formats", "pivot_presets",
                    "pivot_quick", "dashboards", "dashboard_settings", "path_settings"}) | STRICT
DEEP = 128          # 中身の入れ子の段（窓の serde は 128 段で読むのをやめる。Python は読むが、同じ答えにするため隔てる）
SHORT = 30          # 理由に添える値の字の長さ


def short(v):
    """理由に添える値（repr。30 字を超えれば … で切る）"""
    t = repr(v)
    return t if len(t) <= SHORT else t[:SHORT - 1] + "…"


def as_int(v):
    """int(v) が読めればその数、読めなければ None（次の id・行の id の当たり・版を数えるとき）"""
    try:
        return int(v)
    except (ValueError, TypeError, OverflowError):
        return None


def json_depth(text):
    """JSON の字の、字の外の [ { の入れ子のいちばん深い段（窓の master_rows::json_depth と同じ数え方）"""
    depth = deepest = 0
    in_str = esc = False
    for c in text:
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c in "[{":
            depth += 1
            deepest = max(deepest, depth)
        elif c in "]}":
            depth = max(0, depth - 1)
    return deepest


def lone(v):
    """対の無い代用字があるか（字・鍵・並び・表の中まで）"""
    if isinstance(v, str):
        return any("\ud800" <= c <= "\udfff" for c in v)
    if isinstance(v, list):
        return any(lone(x) for x in v)
    if isinstance(v, dict):
        return any(lone(k) or lone(x) for k, x in v.items())
    return False


def nonfinite(v):
    """数でない値（NaN・Infinity）があるか（並び・表の中まで）"""
    if isinstance(v, float):
        return not math.isfinite(v)
    if isinstance(v, list):
        return any(nonfinite(x) for x in v)
    if isinstance(v, dict):
        return any(nonfinite(x) for x in v.values())
    return False


def content_problem(col, text):
    """中身の列の字の理由（隔てないなら None）。JSON として読めない字は隔てない（道が今どおりに読む・断る）"""
    if not isinstance(text, str) or not text:
        return None
    if json_depth(text) >= DEEP:
        return f"「{col}」の入れ子が深すぎます（{DEEP} 段以上）"
    odd = []

    def flt(s):
        f = float(s)
        if not math.isfinite(f):
            odd.append(s)
        return f
    try:
        v = json.loads(text, parse_constant=lambda c: odd.append(c) or 0.0, parse_float=flt)
    except (ValueError, RecursionError):
        return None
    if odd:
        return f"「{col}」に数でない値（NaN・Infinity）があります"
    if lone(v):
        return f"「{col}」に対の無い代用字があります"
    return None


def problem(name, r, fields):
    """行の理由（隔てないなら None）。fields はそのマスタの置く項目（master_repository の SPECS）"""
    if not isinstance(r, dict):
        return "表でない行"
    if "id" in r and (isinstance(r["id"], float) or not isinstance(r["id"], int)):
        return f"id が数ではありません（{short(r['id'])}）"
    if "rev" in r and as_int(r["rev"]) is None:
        return f"版（rev）が読めません（{short(r['rev'])}）"
    name_col = NAME_COLS.get(name)
    strs = STR_COLS.get(name, ())
    cols = list(fields) + ([name_col] if name_col and name_col not in fields else [])
    for k in cols:
        if k not in r:
            continue
        v = r[k]
        if isinstance(v, (list, dict)):
            return f"「{k}」が並び・表です（{short(v)}）"
        if isinstance(v, float) and not math.isfinite(v):
            return f"「{k}」が数でない値です（{short(v)}）"
        if k in strs and not isinstance(v, str):
            return f"「{k}」が字ではありません（{short(v)}）"
        if k == name_col and v is not None and not isinstance(v, str):
            return f"「{k}」が字ではありません（{short(v)}）"
    for k in CONTENT_COLS.get(name, ()):
        why = content_problem(k, r.get(k))
        if why:
            return why
    if name in RAW and nonfinite(r):
        return "数でない値（NaN・Infinity）があります"
    return None


def skipped_text(name, skipped):
    """隔てた行の知らせの言葉（画面の帯の札・書く道の断り。5 行まで）"""
    head = skipped[:3]
    rows = "・".join(f"{s['row']} 行目（{s['why']}）" for s in head)
    more = f" ほか {len(skipped) - len(head)} 行" if len(skipped) > len(head) else ""
    return f"{name}.json の {rows}{more}が読めません"
