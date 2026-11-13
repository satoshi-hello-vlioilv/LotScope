# -*- coding: utf-8 -*-
"""設備グループ（版 3.39.0。現場のマスタ）: いくつかの設備を 1 つのまとまり（グループ）にして、ダッシュボードのパネルで合算して出す。

1 行＝1 つのグループ {名称, まとめ方, 設備, ルール, 表示順, 備考}。
    まとめ方 … グループの組の名前（例: 「ライン別」に「CR ライン」「L ライン」、「工場別」に「第 1 工場」…）。
               パネルは、まとめ方を 1 つ選ぶと、その中のグループで設備を合算する（groups_for）。同じまとめ方の中で名称は 1 つずつ
    設備   … 設備名のカンマ区切り（勤務体系の適用設備と同じ書き方。services/shifts.py の equipment_list）
    ルール … 名前の決まりで入れる設備（版 3.40.0。JSON {"rules": [{op, value}], "except": [設備名]}）。op は pivot.RULE_OPS
             （で始まる・で終わる・を含む・と同じ・正規表現）。どれか 1 つに当たる設備が入る（設備に書いた設備もいつも入る・except は入らない）。
             名前で決まるので、あとから増えた設備（例: L- で始まる L-4）も、マスタを直さずに入る
パネルの側の決め方（このパネルだけのグループ・選んだ設備を合算）は services/dashboard.py の egroup。数え方は services/pivot.py の EquipGroups。
"""
from __future__ import annotations

import json
import re

from . import equip_regex, formula
from .identity import normalize_part
from .pivot import RULE_OPS, compile_rules
from .shifts import equipment_list

NAME = "equipment_groups"
FIELDS = ["名称", "まとめ方", "設備", "ルール", "表示順", "備考"]
NAME_MAX = 40
MAX_RULES = 12
SET_DEFAULT = "グループ"


class GroupError(ValueError):
    pass


def clean_row(data, partial=False, old=None):
    """画面から来た値（name・set・equipment・rules・except・order・note）→ マスタの行。partial は直すとき（来た物だけ）。
    設備・ルール・除く設備は 1 組で置く（設備とルールのどちらかがあればよい）。直すときに組の一部だけが来たら、残りは前の行（old）の値で組む
    （版 3.94.0。前は rules だけの PUT で設備が消え、equipment だけの PUT でルールが消えた）"""
    out = {}
    if not partial or "name" in data:
        name = str(data.get("name") or "").strip()
        if not name:
            raise GroupError("グループの名称を入れてください。")
        out["名称"] = name[:NAME_MAX]
    if not partial or "set" in data:
        out["まとめ方"] = (str(data.get("set") or "").strip() or SET_DEFAULT)[:NAME_MAX]
    if not partial or any(k in data for k in ("equipment", "rules", "except")):
        def came(k):
            return not partial or k in data
        before = rules_of(old or {}) if partial and not (came("rules") and came("except")) else {"rules": [], "except": []}
        # 当てていない決まり（版 3.102.0）も前の行のまま残す（直すときに黙って消さない）
        # （読めない決まり〈表でない・op が無い・知らない op〉は残さない: 直す画面で見せた上で、組を保存すると外れる）
        kept = before["rules"] + [{"op": u["op"], "value": u["value"]} for u in before.get("unapplied", []) if u["op"] in RULE_OPS]
        eq = equipment_list(data.get("equipment") if came("equipment") else (old or {}).get("設備"))
        rules = clean_rules(data.get("rules")) if came("rules") else kept
        if not eq and not rules:
            raise GroupError("グループに入れる設備を 1 つ以上選ぶか、設備の名前の決まり（ルール）を 1 つ以上入れてください。")
        out["設備"] = ",".join(eq)
        ex = (equipment_list(data.get("except")) if came("except") else before["except"]) if rules else []
        out["ルール"] = json.dumps({"rules": rules, **({"except": ex} if ex else {})}, ensure_ascii=False) if rules else ""
    if "order" in data:
        try:
            out["表示順"] = str(int(data.get("order")))
        except (TypeError, ValueError):
            out["表示順"] = ""
    if not partial or "note" in data:
        out["備考"] = str(data.get("note") or "").strip()[:200]
    return out


def clean_rules(v):
    """画面から来た決まり → [{op, value}]（知らない op・空の値は外す。正規表現は読めなければ断る）"""
    out = []
    for r in (v if isinstance(v, list) else [])[:MAX_RULES]:
        if not isinstance(r, dict) or r.get("op") not in RULE_OPS:
            continue
        val = str(r.get("value") or "").strip()[:80]
        if not val:
            continue
        if r["op"] == "regex":
            # 窓（fancy-regex）と同じ意味になる書き方だけ（版 3.102.0。services/equip_regex.py。窓の desktop/src/equip_regex.rs と同じ決まり）
            why = equip_regex.why_of(val)
            if why:
                raise GroupError(f"正規表現「{val}」は{why}。")
            try:
                re.compile(val)
            except re.error as e:
                raise GroupError(f"正規表現「{val}」が読めません（{e}）。") from None
            why = formula.regex_risk(val)       # 重すぎる形は断る（版 3.52.1。計算列の式と同じ決まり）
            if why:
                raise GroupError(f"正規表現「{val}」: {why}")
        x = {"op": r["op"], "value": val}
        if x not in out:
            out.append(x)
    return out


def rules_of(row):
    """マスタの行 → ({rules, except, unapplied?})（無い・壊れていれば空）。
    読めない・重い・窓で写せない決まりは、その決まりだけを当てず unapplied（{op, value, why}）に理由を添えて残す。ほかの決まりと除く設備は残す
    （版 3.102.0。前は 1 つでも断る決まりがあるとグループの決まりと除く設備が全部黙って消えた。pivot.compile_rules と同じく決まりごと）"""
    try:
        d = json.loads(row.get("ルール") or "{}")
    except (TypeError, ValueError):
        d = {}
    d = d if isinstance(d, dict) else {}
    rules, unapplied = [], []
    for r in (d.get("rules") if isinstance(d.get("rules"), list) else [])[:MAX_RULES]:
        # 読めない決まりも黙って外さず、理由を添えて残す（版 3.102.0 の作った後の採点の割れ 4）
        if not isinstance(r, dict):
            unapplied.append({"op": None, "value": "", "why": "読めない決まりです（表でない）。"})
            continue
        if r.get("op") is None or r.get("op") == "":
            unapplied.append({"op": None, "value": str(r.get("value") or "").strip()[:80], "why": "読めない決まりです（比べ方〈op〉がありません）。"})
            continue
        if r["op"] not in RULE_OPS:
            unapplied.append({"op": r["op"], "value": str(r.get("value") or "").strip()[:80], "why": f"読めない決まりです（知らない比べ方「{r['op']}」）。"})
            continue
        try:
            got = clean_rules([r])
        except GroupError as e:
            unapplied.append({"op": r["op"], "value": str(r.get("value") or "").strip()[:80], "why": str(e)})
            continue
        for x in got:
            if x not in rules:
                rules.append(x)
    out = {"rules": rules, "except": equipment_list(d.get("except")) if rules or unapplied else []}
    if unapplied:
        out["unapplied"] = unapplied
    return out


def members_in(group, names):
    """グループ（view の形）に入る設備（names の中で。書いた設備＋決まりに当たる設備〈除く設備は外す〉）"""
    test, ex = compile_rules(group.get("rules")), {normalize_part(x) for x in group.get("except") or []}
    mine = {normalize_part(x) for x in group.get("equipment") or []}
    return [n for n in names if normalize_part(n) in mine or (normalize_part(n) not in ex and test(normalize_part(n)))]


def check_unique(rows, data, self_id=None):
    """同じまとめ方の中で同じ名称を 2 つ持たない → 重なれば理由の字（無ければ ""）"""
    key = (normalize_part(data.get("まとめ方")), normalize_part(data.get("名称")))
    for r in rows:
        if r.get("id") != self_id and (normalize_part(r.get("まとめ方") or SET_DEFAULT), normalize_part(r.get("名称"))) == key:
            return f"まとめ方「{data.get('まとめ方')}」には、グループ「{data.get('名称')}」がもうあります。"
    return ""


def _order(row):
    try:
        return int(row.get("表示順") or 0)
    except (TypeError, ValueError):
        return 0


def ordered(rows):
    return sorted(rows, key=lambda r: (_order(r), int(r.get("id") or 0)))


def row_problem(row):
    """まとめ方が字でない行の理由（版 3.107.0。隔てる。窓の equipgroups_write::row_problem と同じ。前は値のまま組に分けていた）"""
    v = row.get("まとめ方")
    if v and not isinstance(v, str):
        from .row_check import short
        return f"「まとめ方」が字ではありません（{short(v)}）"
    return None


def view(row):
    """画面へ出す形"""
    return {"id": row.get("id"), "name": row.get("名称") or "", "set": row.get("まとめ方") or SET_DEFAULT,
            "equipment": equipment_list(row.get("設備")), **rules_of(row), "order": _order(row), "note": row.get("備考") or "", "rev": row.get("rev", 1),
            "updated_at": row.get("updated_at", ""), "updated_by": row.get("updated_by") or {}}


def sets(rows):
    """まとめ方の並び（表示順の最初のグループの順）→ [{name, groups: [view]}]"""
    out = {}
    for r in ordered(rows):
        v = view(r)
        out.setdefault(v["set"], []).append(v)
    return [{"name": k, "groups": v} for k, v in out.items()]


def groups_for(rows, set_name):
    """まとめ方 set_name のグループ → [{name, members, rules, except}]（pivot.EquipGroups の形）。無ければ空"""
    key = normalize_part(set_name)
    return [{"name": v["name"], "members": v["equipment"], **({"rules": v["rules"], "except": v["except"]} if v["rules"] else {})}
            for v in map(view, ordered(rows)) if normalize_part(v["set"]) == key]
