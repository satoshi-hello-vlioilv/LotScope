"""答え合わせ役が、取り出しのファイル（program/data など）を場面へ写すときの共通の部品（版 3.116.0 の作った後の採点の割れ 1）。標準の部品だけ。

shutil.copytree・shutil.copy は取り出しの更新時刻と権限も写す（copy2・copystat・copymode）。場面の宣言（焼いた表 desktop/tests/baked の
scene）は場面のファイルの更新時刻と権限を持つので、そのまま写すと「取り出してからの日数」（今から 2 日の内かで宣言の形が替わる）と
「取り出しの権限」（umask 002 の取り出しは 775/664）に頼る表になり、古い取り出しの PC で落ちる。ここを通して写すと、写した物は
今の時刻・フォルダ 755・ファイル 644 になる（中身だけを写す）。取り出しから場面へ写す所は、みなここを通す
（tests/test_baked_tables.py が答え合わせ役の元を見て、直に写す所が残っていれば落とす）。
"""
import os
import shutil
from pathlib import Path

DIR_MODE, FILE_MODE = 0o755, 0o644


def settle(root):
    """root（フォルダかファイル）の下を、今の時刻・755/644 にそろえる（記号リンクはたどらない）"""
    root = Path(root)
    paths = [root]
    if root.is_dir() and not root.is_symlink():
        for d, dirs, files in os.walk(root):
            paths += [Path(d) / n for n in dirs + files]
    for p in paths:
        if p.is_symlink():
            continue
        os.chmod(p, DIR_MODE if p.is_dir() else FILE_MODE)
        os.utime(p, None)
    return root


def copy_tree(src, dst, ignore=None):
    """取り出しのフォルダを場面へ写す（中身だけ。更新時刻と権限は写さない）"""
    shutil.copytree(src, dst, ignore=ignore, copy_function=shutil.copyfile)
    return settle(dst)


def copy_file(src, dst):
    """取り出しのファイルを場面へ写す（中身だけ）"""
    shutil.copyfile(src, dst)
    return settle(dst)
