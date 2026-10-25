# -*- coding: utf-8 -*-
"""カードの設計（版 3.55.0。services/card_forms.py・/api/card-forms）: 中身の決まり（方眼・重なり・色は鍵だけ）と、
置き場の決まり（ダッシュボードと同じ: 全員の既定は開発者・全員は書ける人・自分だけは本人。★標準は自分 → 全員 → 全員の既定）。"""
import re
import unittest
from pathlib import Path

from app.services import card_forms
from tests import test_dashboard as _td

SRC = "card:lotlist:仕掛"


def body(**kw):
    b = {"cols": 12, "row": 48, "theme": {"accent": "blue"}, "items": [
        {"id": "a", "kind": "field", "col": "不良名", "x": 0, "y": 0, "w": 4, "h": 2, "st": {"fs": "xl", "bold": True, "color": "red"}},
        {"id": "b", "kind": "combo", "label": "合金・調質", "expr": "[合金] + ' / ' + [調質]", "x": 4, "y": 0, "w": 4, "h": 1},
        {"id": "c", "kind": "section", "text": "検査", "x": 0, "y": 2, "w": 12, "h": 1}]}
    b.update(kw)
    return b


class Body(unittest.TestCase):
    def test_clean_keeps_the_design_and_clamps(self):
        out, _ = card_forms.clean_body(body(cols=99, row=10))
        self.assertEqual((out["cols"], out["row"]), (24, 32), "方眼の列・段の高さは範囲に収める")
        a = out["items"][0]
        self.assertEqual((a["kind"], a["col"], a["st"]["fs"], a["st"]["bold"], a["st"]["color"]), ("field", "不良名", "xl", True, "red"))
        self.assertEqual(out["items"][1]["expr"], "[合金] + ' / ' + [調質]")

    def test_colors_are_keys_only(self):
        out, _ = card_forms.clean_body(body(items=[{"id": "a", "kind": "field", "col": "x", "x": 0, "y": 0, "w": 2, "h": 1,
                                                     "st": {"color": "red;background:url(x)", "bg": "#fff", "align": "evil"}}]))
        st = out["items"][0]["st"]
        self.assertEqual((st["color"], st["bg"], st["align"]), ("", "", "left"), "色は決まった鍵だけ（細工した字を CSS に入れない）")

    def test_label_placements(self):
        # 名前と値の置き方は 8 通り（画面の card-form.js の LAB と同じ鍵）。知らない鍵は既定の「上」
        for k in ("top", "bottom", "left", "spread", "legend", "tag", "inline", "none"):
            out, _ = card_forms.clean_body(body(items=[{"id": "a", "kind": "field", "col": "x", "x": 0, "y": 0, "w": 2, "h": 1, "st": {"lab": k}}]))
            self.assertEqual(out["items"][0]["st"]["lab"], k)
        out, _ = card_forms.clean_body(body(items=[{"id": "a", "kind": "field", "col": "x", "x": 0, "y": 0, "w": 2, "h": 1, "st": {"lab": "float;x"}}]))
        self.assertEqual(out["items"][0]["st"]["lab"], "top")
        js = (Path(__file__).resolve().parents[1] / "app" / "static" / "js" / "card-form.js").read_text(encoding="utf-8")
        keys = re.findall(r'\["(\w+)", "[^"]+", "[^"]+"\]', js[js.index("const LAB"):js.index("const BORDER")])
        self.assertEqual(tuple(keys), card_forms.LAB, "画面とサーバーで置き方の鍵が同じ")

    def test_tabs_fold_and_dates(self):
        # 版 3.56.0: タブ（2 つ以上・項目の tab は有る物だけ・重なりはタブの中で見る）・畳める見出し・日付のまとまり
        b = {"cols": 12, "row": 48, "tabs": [{"id": "t1", "name": "基本"}, {"id": "t2", "name": "  "}, {"id": "t1", "name": "同じ id"}],
             "items": [{"id": "a", "kind": "field", "col": "x", "x": 0, "y": 0, "w": 4, "h": 1, "tab": "t1"},
                       {"id": "b", "kind": "field", "col": "y", "x": 0, "y": 0, "w": 4, "h": 1, "tab": "t2"},     # 同じ所でもタブが違えば重ならない
                       {"id": "c", "kind": "field", "col": "z", "x": 4, "y": 0, "w": 4, "h": 1, "tab": "無い"},   # 無いタブ → 先頭
                       {"id": "s", "kind": "section", "text": "そのほか", "x": 0, "y": 1, "w": 12, "h": 1, "tab": "t1", "fold": True, "shut": True},
                       {"id": "s2", "kind": "section", "text": "畳めない", "x": 0, "y": 2, "w": 12, "h": 1, "tab": "t1", "shut": True},
                       {"id": "d", "kind": "dates", "cols": ["発生日", "", "検査日"], "x": 0, "y": 3, "w": 12, "h": 2, "tab": "t2"}]}
        out, _ = card_forms.clean_body(b)
        self.assertEqual([t["id"] for t in out["tabs"]], ["t1", "t2", "t3"])
        self.assertEqual(out["tabs"][1]["name"], "タブ 2", "空の名前は「タブ n」")
        by = {it["id"]: it for it in out["items"]}
        self.assertEqual((by["a"]["tab"], by["b"]["tab"], by["c"]["tab"]), ("t1", "t2", "t1"))
        self.assertEqual((by["s"]["fold"], by["s"]["shut"], by["s2"]["fold"], by["s2"]["shut"]), (True, True, False, False), "畳めない見出しは畳んでおけない")
        self.assertEqual(by["d"]["cols"], ["発生日", "検査日"])
        with self.assertRaises(card_forms.CardFormError):      # 同じタブで重なる
            card_forms.clean_body({**b, "items": b["items"][:1] + [{"id": "e", "kind": "field", "col": "w", "x": 2, "y": 0, "w": 4, "h": 1, "tab": "t1"}]})
        with self.assertRaises(card_forms.CardFormError):      # 列の無い日付のまとまり
            card_forms.clean_body({"items": [{"kind": "dates", "cols": [], "x": 0, "y": 0, "w": 4, "h": 1}]})
        one, _ = card_forms.clean_body({"tabs": [], "items": [{"id": "a", "kind": "field", "col": "x", "x": 0, "y": 0, "w": 4, "h": 1, "tab": "t1"}]})
        self.assertNotIn("tabs", one)
        self.assertNotIn("tab", one["items"][0])

    def test_overlap_and_missing_are_refused(self):
        with self.assertRaises(card_forms.CardFormError):
            card_forms.clean_body(body(items=[{"kind": "field", "col": "a", "x": 0, "y": 0, "w": 4, "h": 1},
                                              {"kind": "field", "col": "b", "x": 3, "y": 0, "w": 4, "h": 1}]))
        with self.assertRaises(card_forms.CardFormError):
            card_forms.clean_body(body(items=[{"kind": "combo", "x": 0, "y": 0, "w": 4, "h": 1}]))
        with self.assertRaises(card_forms.CardFormError):
            card_forms.clean_body(body(items=[{"kind": "field", "x": 0, "y": 0, "w": 4, "h": 1}]))

    def test_width_never_overflows_the_grid(self):
        out, _ = card_forms.clean_body(body(cols=12, items=[{"kind": "field", "col": "a", "x": 11, "y": 0, "w": 6, "h": 1}]))
        it = out["items"][0]
        self.assertLessEqual(it["x"] + it["w"], 12)

    def test_source_key(self):
        for ok in ("card:lotlist:仕掛", "card:worklog:実績", "card:src:wip:仕掛", "card:lotlist:"):
            self.assertTrue(card_forms.source_ok(ok), ok)
        for bad in ("lotlist:仕掛", "card:dash", "card:src:WIP!:x", "card:lotlist:\n", 3):
            self.assertFalse(card_forms.source_ok(bad), bad)


class Api(unittest.TestCase):
    # 置き場の試験の段取り（利用者・権限・共有の置き場）はダッシュボードの試験と同じ物を使う（試験の中身は引き継がない）
    setUp, tearDown, as_ = _td.Layouts.setUp, _td.Layouts.tearDown, _td.Layouts.as_

    def test_scopes_and_standard(self):
        r = self.c.post("/api/card-forms", json={"name": "わたしの", "source": SRC, "scope": "me", "body": body()})
        self.assertEqual(r.status_code, 201, r.get_json())
        mine = r.get_json()
        self.assertEqual((mine["scope"], mine["body"]["items"][1]["kind"]), ("me", "combo"))
        # 全員の既定は開発者だけ
        self.assertEqual(self.c.post("/api/card-forms", json={"name": "標準", "source": SRC, "scope": "default", "standard": True, "body": body()}).status_code, 403)
        self.as_("dev")
        d = self.c.post("/api/card-forms", json={"name": "標準", "source": SRC, "scope": "default", "standard": True, "body": body()})
        self.assertEqual(d.status_code, 201, d.get_json())
        self.as_("taro")
        got = self.c.get(f"/api/card-forms?source={SRC}").get_json()
        self.assertEqual(got["standardId"], d.get_json()["id"], "自分の★が無ければ全員の既定の★")
        self.assertEqual({x["name"] for x in got["items"]}, {"わたしの", "標準"})
        self.assertEqual(self.c.put(f"/api/card-forms/{mine['id']}", json={"standard": True, "base_rev": mine["rev"]}).status_code, 200)
        self.assertEqual(self.c.get(f"/api/card-forms?source={SRC}").get_json()["standardId"], mine["id"], "自分の★が先")
        # ほかの表には出ない・ダッシュボードの一覧にも出ない
        self.assertEqual(self.c.get("/api/card-forms?source=card:lotlist:品質").get_json()["items"], [])
        self.assertFalse(any(x["name"] == "わたしの" for x in self.c.get("/api/dashboards").get_json()["items"]))
        # ほかの人の自分だけは見えない・直せない
        self.as_("jiro")
        self.assertEqual([x["name"] for x in self.c.get(f"/api/card-forms?source={SRC}").get_json()["items"]], ["標準"])
        self.assertEqual(self.c.delete(f"/api/card-forms/{mine['id']}").status_code, 403)
        self.as_("taro")
        self.assertEqual(self.c.delete(f"/api/card-forms/{mine['id']}").status_code, 200)
        self.assertEqual(self.c.get("/api/card-forms?source=bad").status_code, 400)

    def test_bad_body_is_a_reason(self):
        r = self.c.post("/api/card-forms", json={"name": "x", "source": SRC, "scope": "me",
                                                 "body": body(items=[{"kind": "field", "col": "a", "x": 0, "y": 0, "w": 4, "h": 1},
                                                                     {"kind": "field", "col": "b", "x": 0, "y": 0, "w": 4, "h": 1}])})
        self.assertEqual(r.status_code, 400)
        self.assertIn("重なっています", r.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
