"""画面の改良案の評価関数（開発用。決め方は CLAUDE.md の「UI/UX を変えるときは…」。元は Inventor の同じ名前の道具）。

    python program/tools/ui_score.py program/tools/ui-proposals/比較.json

採点は、案を画像にして（ui-variants.mjs）直接見比べてから付ける。採点のファイル（JSON）:

    {"title": "…", "rounds": [
      {"name": "1 回目", "proposals": {"A 案の名前": [7 基準の点（10 段階）], …}, "seen": {"A 案の名前": "画像で見えたこと"},
       "added": ["F 案の名前", "G 案の名前"],
       "baseline": {"現状": [7 基準の点]}},
      {"name": "2 回目", "proposals": {…}, "essence": {"複合案の名前": "どの案のどのエッセンスを組んだか"}}]}
    "added" は 1 回目の 5 案を見直して、偏りを崩すために足した方向の違う 2 案。
    "baseline" は比べるための今の画面（案ではないので順位に入れない。どれだけ良くなるかを見る）。
    "record" を書いたファイルは、いまの決まりの前の記録（回の組み方は確かめない）。

決め方（2 回で必ず 1 案に決める）:
  1 回目は 7 案（まず 5 案を出し、方向が偏っていないかを見て、方向の違う 2 案を足す）。
  1 位が十分に良く（GOOD 点以上）、2 位と僅差でなければ 1 位を選ぶ。
  1 位でも点が低いか、2 位と僅差なら、案のエッセンスを抜き出して組み直した複合案を 4 つ作り、
  1 回目の上位 3 案と合わせた 7 案で 2 回目を採点し、1 位に決める（同じ点なら、重い基準の点が高い方）。
僅差の幅: 各基準の採点に ±1 段階のぶれがあるとすると、1 案の合計のぶれは σ1 = √Σ(w/10)²、2 案の差のぶれは
σd = σ1·√2。差が 2σd 未満なら、採点のぶれで順位が入れ替わりうる。
十分に良い（GOOD）: 全基準 8 段階（有料の製品として出せる水準）に当たる 80 点。
"""

import json
import math
import sys

CRITERIA = [  # (名前, 重み)。並びは重い順（同じ点のときは、前の基準の点が高い方を上にする）
    ("次の行動がすぐ分かる", 20),
    ("状態と進み具合が見える", 15),
    ("読む量・判断の数が少ない", 15),
    ("どこに何があるかが一定", 15),
    ("見栄え・視覚の階層", 15),
    ("一覧・3D の見やすさ・操作の短さ", 10),  # Inventor では「3D の…」。このアプリの主役は異常ロット一覧と計算の 3D
    ("作り直しの確かさ・保守性", 10),
]
WEIGHTS = [w for _, w in CRITERIA]
SIGMA1 = math.sqrt(sum((w / 10) ** 2 for w in WEIGHTS))
MARGIN = 2 * SIGMA1 * math.sqrt(2)
GOOD = 80  # 1 回目で選んでよい 1 位の点の下限
FIRST = 5  # 1 回目に最初に出す案の数
ADDED = 2  # 偏りを崩すために足す、方向の違う案の数
PROPOSALS = FIRST + ADDED  # 1 回目・2 回目の案の数
COMPOSITES = 4  # 2 回目に作る複合案の数
KEEP = PROPOSALS - COMPOSITES  # 2 回目に残す 1 回目の案の数（上位から）


def total(scores):
    """10 段階の採点 → 100 点満点"""
    if len(scores) != len(WEIGHTS) or not all(0 <= s <= 10 for s in scores):
        raise ValueError(f"採点は 0〜10 の {len(WEIGHTS)} 個: {scores}")
    return round(sum(w * s / 10 for w, s in zip(WEIGHTS, scores)), 1)


def rank(proposals):
    """[(合計, 名前, 採点)] を高い順に（同じ点なら重い基準の点が高い方）。1 位と 2 位が僅差か"""
    rows = sorted(((total(s), name, s) for name, s in proposals.items()), key=lambda r: (-r[0], [-v for v in r[2]], r[1]))
    return rows, rows[0][0] - rows[1][0] < MARGIN


def verdict(rows, close):
    """1 回目の結果で選んでよいか。選べなければ理由"""
    if rows[0][0] < GOOD:
        return f"1 位でも {rows[0][0]:.1f} 点（{GOOD} 点に届かない）"
    if close:
        return f"1 位と 2 位が僅差（差 {rows[0][0] - rows[1][0]:.1f} 点 < {MARGIN:.1f} 点）"
    return None


def check_round(i, rnd, previous):
    """回の組み方が決まりどおりか（違えば理由の文）"""
    proposals = rnd["proposals"]
    if len(proposals) != PROPOSALS:
        return f"案は {PROPOSALS} 案（いま {len(proposals)} 案）"
    if i == 0:
        added = rnd.get("added", [])
        if len(added) != ADDED or not set(added) <= set(proposals):
            return f"1 回目は 5 案に、方向の違う {ADDED} 案を足す（\"added\" に、足した {ADDED} 案の名前を書く）"
        return None
    if i > 1:
        return "回は 2 回まで（2 回目で必ず決める）"
    kept = [name for _, name, _ in previous[:KEEP]]
    missing = [name for name in kept if name not in proposals]
    new = [name for name in proposals if name not in {n for _, n, _ in previous}]
    if missing:
        return f"1 回目の上位 {KEEP} 案（{'・'.join(missing)}）が入っていない"
    if len(new) != COMPOSITES:
        return f"複合案は {COMPOSITES} つ（いま {len(new)} つ）"
    return None


def decide(rounds, strict=True):
    """回を順に判定する。返り値: ("選ぶ", 名前, 順位) か ("比べ直す", 残す案, 順位)。
    strict: 回の組み方を確かめる（決まりの前の記録では確かめない）"""
    previous = None
    for i, rnd in enumerate(rounds):
        problem = check_round(i, rnd, previous)
        if problem and strict:
            raise ValueError(f"{rnd['name']}: {problem}")
        rows, close = rank(rnd["proposals"])
        if i > 0 or not verdict(rows, close):
            return "選ぶ", rows[0][1], rows
        previous = rows
    return "比べ直す", [name for _, name, _ in previous[:KEEP]], previous


def report(data):
    print(f"# {data['title']}")
    if data.get("record"):
        print(f"（記録: {data['record']}）")
    print(f"σ1 = {SIGMA1:.2f}、僅差の幅 2σd = {MARGIN:.1f} 点、選んでよい点 {GOOD} 点")
    seen = {}  # 前の回から持ち越した案は、前の回で見えたことを出す
    for i, rnd in enumerate(data["rounds"]):
        rows, close = rank(rnd["proposals"])
        print(f"== {rnd['name']}（{len(rows)} 案）")
        seen.update(rnd.get("seen", {}))
        notes = {**seen, **{k: f"［組み方］{v}" for k, v in rnd.get("essence", {}).items() if k not in seen}}
        for t, name, s in rows:
            mark = "＋" if name in rnd.get("added", []) else " "
            print(f" {mark}{name:16s} {t:5.1f}  {s}  {notes.get(name, '')}")
        for name, s in rnd.get("baseline", {}).items():
            print(f"  （{name}）{'':{max(0, 14 - len(name))}s} {total(s):5.1f}  {s}  {rnd.get('seen', {}).get(name, '')}")
        why = verdict(rows, close)
        print(f"  1 位と 2 位の差 {rows[0][0] - rows[1][0]:.1f} 点 → {'僅差' if close else '差あり'}" + (f"・{why}" if i == 0 and why else ""))
    kind, who, rows = decide(data["rounds"], strict=not data.get("record"))
    if data.get("record"):
        print("（以下は、いまの決まりで判定したら、の参考）")
    if kind == "選ぶ":
        note = "（2 回目で決める）" if len(data["rounds"]) > 1 else ""
        print(f"→ 選ぶ{note}: {who}（{rows[0][0]:.1f} 点）")
    else:
        print(f"→ まだ選ばない。案のエッセンスを抜き出して組み直した複合案を {COMPOSITES} つ作り、"
              f"1 回目の上位 {KEEP} 案（{'・'.join(who)}）と合わせた {PROPOSALS} 案を画像にして 2 回目を採点する")
    return kind, who


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("使い方: python program/tools/ui_score.py 採点.json")
    with open(sys.argv[1], encoding="utf-8") as f:
        report(json.load(f))
