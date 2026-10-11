# -*- coding: utf-8 -*-
"""確認の窓を出さない流れ（版 3.19.0・利用者の決めたこと 2026-10-11）。

終了・版の入れ替え（更新して開き直す・配る版を決める／戻す・置き場を変える・版が混ざったときの開き直し）は、
押せばそのまま動く。どれも取り返しがつく（開き直せば戻る・前の版へは同じ一覧で選び直すだけ・前の置き場は消さずに残す）
か、押す前に画面が結果を見せている（変えたあとのフォルダの木）ので、確かめの窓で手を止めない。
確かめの窓（confirm・alert・prompt と、答えを待つ窓）が戻ってきたら、ここが止める。
"""
import re
import unittest
from pathlib import Path

JS = Path(__file__).resolve().parents[1] / "app" / "static" / "js"
DIALOG = re.compile(r"(?<![\w.])(?:window\.)?(confirm|alert|prompt)\s*\(")


def body(src: str, start: str) -> str:
    """start（関数の頭・代入の左辺）から、対になる閉じ括弧 } までの中身。"""
    i = src.index(start)
    i = src.index("{", i)
    depth = 0
    for j in range(i, len(src)):
        depth += {"{": 1, "}": -1}.get(src[j], 0)
        if depth == 0:
            return src[i:j + 1]
    raise AssertionError(f"{start} の終わりが見つかりません")


# (ファイル, 流れの頭)。ここに並ぶ流れは、確かめの窓を出さない
FLOWS = [
    ("app.js", '$("#quitBtn").onclick'),        # 終了
    ("app.js", "function checkPageBuild"),      # 版が混ざったとき（自分で開き直す）
    ("app.js", "async function applyUpdate"),   # 更新して開き直す
    ("app.js", "function onVerNew"),            # 見出しの「更新あり」（押せば開き直す）
    ("master.js", "async function distributeRelease"),   # 配る版を決める・戻す
    ("master.js", "async function moveReleasePlace"),    # 更新の置き場を変える
    ("master.js", "async function moveMasterPlace"),     # マスタの置き場を変える
    ("master.js", "function armRemove"),                 # 版を消す（その場の 2 回押しで確かめる）
    ("master.js", "async function removeRelease"),
]


class NoDialogs(unittest.TestCase):
    def test_flows_do_not_ask(self):
        for name, start in FLOWS:
            with self.subTest(flow=start):
                found = DIALOG.findall(body((JS / name).read_text(encoding="utf-8"), start))
                self.assertEqual(found, [], f"{name} の {start} が確かめの窓を出しています")

    def test_stale_build_restarts_by_itself(self):
        b = body((JS / "app.js").read_text(encoding="utf-8"), "function checkPageBuild")
        self.assertIn("/__desktop/restart", b, "版が混ざったら、押させずに窓が開き直す")

    def test_ready_update_opens_again_in_one_press(self):
        b = body((JS / "app.js").read_text(encoding="utf-8"), "function onVerNew")
        self.assertIn("applyUpdate", b, "取り込み済みの版は「更新あり」を押すだけで開き直す（更新履歴の窓を挟まない）")


if __name__ == "__main__":
    unittest.main()
