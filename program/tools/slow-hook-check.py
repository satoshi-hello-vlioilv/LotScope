"""配る窓に「遅くする口」（desktop/src/slow.rs。試験と撮る道具だけ）が入っていないかを確かめる（版 3.118.3 の作った後の採点の割れ 2）。

    python program/tools/slow-hook-check.py --exe 窓の実行ファイル [--build-json cargo の --message-format=json の出力]

- exe の中に口の印の字（slow.rs の MARK「tpa-slow-hook」）があれば落とす（終了コード 1）
- --build-json があれば、組んだ記録の da_core・LotScope の features に testing があれば落とす（features の default に testing を足した形など）
- --expect-mark は逆に、印が有ることを確かめる（開発用サーバー examples/ui_serve。この道具が印を見つけられることの確かめ）

check-all.sh の段 no-slow-hook（debug の窓）と Windows の CI（desktop.yml の windows-exe。release の窓）が流す。標準の部品だけ。
"""

import argparse
import json
import sys
from pathlib import Path

MARK = b"tpa-slow-hook"
WATCH = ("da_core", "LotScope")


def marks_in(exe: Path) -> int:
    """exe の中の印の数（大きな exe でも 1 MB ずつ読み、区切りにまたがる印も数える）"""
    n, tail = 0, b""
    with open(exe, "rb") as f:
        while True:
            chunk = f.read(1 << 20)
            if not chunk:
                break
            buf = tail + chunk
            n += buf.count(MARK)
            # 区切りにまたがる印を次の塊で数えるため、印より 1 字短い尻尾を残す（尻尾だけで印にはならないので 2 度数えない）
            tail = buf[-(len(MARK) - 1):]
    return n


def features_of(build_json: Path) -> dict:
    """cargo の --message-format=json の記録 → {target の名前: features}（見張る target だけ）"""
    out = {}
    for line in build_json.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("reason") == "compiler-artifact" and d.get("target", {}).get("name") in WATCH:
            out[d["target"]["name"]] = d.get("features") or []
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--build-json")
    ap.add_argument("--expect-mark", action="store_true")
    a = ap.parse_args(argv)
    bad = []
    exe = Path(a.exe)
    if not exe.is_file():
        print(f"FAIL 実行ファイルがありません: {exe}")
        return 1
    n = marks_in(exe)
    if a.expect_mark:
        if n == 0:
            bad.append(f"{exe.name} に口の印 {MARK.decode()} がありません（開発用サーバーなら有るはず）")
    elif n:
        bad.append(f"{exe.name} に口の印 {MARK.decode()} が {n} 件あります（配る窓に遅くする口が入っている）")
    if a.build_json:
        feats = features_of(Path(a.build_json))
        missing = [t for t in WATCH if t not in feats]
        if missing:
            bad.append(f"組んだ記録に {', '.join(missing)} がありません（--message-format=json の出力か）")
        for t, f in feats.items():
            if "testing" in f:
                bad.append(f"{t} の features に testing があります: {f}")
        print(f"features: {json.dumps(feats, ensure_ascii=False)}")
    print(f"{exe}: 印 {n} 件")
    for b in bad:
        print(f"FAIL {b}")
    print("OK" if not bad else f"NG {len(bad)} 件")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
