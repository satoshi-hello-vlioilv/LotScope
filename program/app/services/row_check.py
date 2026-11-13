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
# 一覧と同じく、束・ダッシュボードの問い合わせ・式の変換表・直の当て方でも隔てた行を使わないマスタ（master_repository._list。
# 窓の access::Place::rows と同じ。版 3.107.0 の割れ 2）。版 3.108.0 から変換表の標準も。権限・参照先は入れない（参照先は触れる書きだけを断る）。
# データ元・作業実績の登録（実績の設備）も参照先と同じく入れない（版 3.108.0 の作った後の採点: 隔てると見出しのタブ・設備がまるごと消える。
# 読むのは今どおり使い、キー・id の当たる直す・並べ替え・探し直しの書きだけを断る〈master_repository の key_guard・work_log_order・work_log_sync〉）
FILTERED = frozenset({"equipment_master", "roll_master", "shift_patterns", "equipment_groups", "conversions", "display_formats", "pivot_presets",
                      "pivot_quick", "dashboards", "dashboard_settings", "conversion_defaults"})
# マスタの置き場の状態（status）で隔てた行を知らせるマスタ: 一覧が隔てる物・権限の 2 つ・参照先とデータ元・実績の設備（触れる書きを断る）
# （窓の row_check::STATUS と同じ）
STATUS = FILTERED | {"path_settings", "data_sources", "work_log_files"} | STRICT
# 行を id で引かないマスタ（データ元はキーで引く・変換表の標準は丸ごと置き換える）: id の型は見ない（版 3.108.0。読めない値ではないので
# 隔てると、前に使えた元が消える。窓の row_check::ID_FREE と同じ）
ID_FREE = frozenset({"data_sources", "conversion_defaults"})
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
        if v.isascii():
            return False
        try:
            v.encode("utf-8")       # 対の無い代用字だけが UTF-8 にできない（字ごとに見るより速い）
            return False
        except UnicodeEncodeError:
            return True
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
    if text.count("[") + text.count("{") >= DEEP and json_depth(text) >= DEEP:   # 括弧が 128 に満たなければ数えない（速さ。割れ 5）
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
    """行の理由（隔てないなら None）。fields はそのマスタの置く項目（master_repository の SPECS）。
    版 3.107.0 の作った後の採点の割れ 1（機能を減らさない）: 隔てるのは、値を読めない・書き戻すと壊れる形だけ（表でない行・数でない id・
    読めない版・数でない値〈NaN・Infinity〉・中身の字の数でない値・深い入れ子・対の無い代用字）。型だけが違う値（名前が数・字の列が並び）は
    隔てず、一覧では str() で読む（coerce）。前は名前が数の書式・設備名が数の設備を隔て、画面で直せなくしていた"""
    if not isinstance(r, dict):
        return "表でない行"
    if "id" in r and name not in ID_FREE and (isinstance(r["id"], float) or not isinstance(r["id"], int)):
        return f"id が数ではありません（{short(r['id'])}）"
    if "rev" in r and as_int(r["rev"]) is None:
        return f"版（rev）が読めません（{short(r['rev'])}）"
    name_col = NAME_COLS.get(name)
    cols = list(fields) + ([name_col] if name_col and name_col not in fields else [])
    for k in cols:
        if k in r and nonfinite(r[k]):
            return f"「{k}」に数でない値（NaN・Infinity）があります"
        # 権限の 2 つは型の違う値も今どおり止める（書く道を断る。読みは今どおり。黙って権限が変わらないように）
        if name in STRICT and k in r and isinstance(r[k], (list, dict)):
            return f"「{k}」が並び・表です（{short(r[k])}）"
        if name in STRICT and k == name_col and r.get(k) is not None and not isinstance(r[k], str):
            return f"「{k}」が字ではありません（{short(r[k])}）"
    for k in CONTENT_COLS.get(name, ()):
        why = content_problem(k, r.get(k))
        if why:
            return why
    if lone(r):
        return "対の無い代用字があります"
    if name in RAW and nonfinite(r):
        return "数でない値（NaN・Infinity）があります"
    return None


def coerce(name, r):
    """一覧に出す行（写し）: 名前の列・字だけの列の、字でない値（数・並び・表・真偽）を Python の str() の字にする（版 3.107.0 の割れ 1。
    前は名前が数の行で一覧の並べ替えが TypeError の 500。窓の row_check::coerce と同じ）。null はそのまま"""
    cols = set(STR_COLS.get(name, ())) | ({NAME_COLS[name]} if name in NAME_COLS else set())
    out = dict(r)
    for k in cols:
        v = out.get(k)
        if v is not None and not isinstance(v, str):
            out[k] = str(v)
    return out


def summary(name, r):
    """読めない行の生の値の要約（知らせの面に出す: id と名前の列。鍵の順によらない）"""
    if not isinstance(r, dict):
        return short(r)
    col = NAME_COLS.get(name)
    parts = [f"id {short(r.get('id'))}"] if "id" in r else []
    if col and col in r:
        parts.append(f"{col} {short(r.get(col))}")
    return "・".join(parts)


def skipped_text(name, skipped):
    """隔てた行の知らせの言葉（画面の帯の札・書く道の断り。5 行まで）"""
    head = skipped[:3]
    rows = "・".join(f"{s['row']} 行目（{s['why']}）" for s in head)
    more = f" ほか {len(skipped) - len(head)} 行" if len(skipped) > len(head) else ""
    return f"{name}.json の {rows}{more}が読めません"
