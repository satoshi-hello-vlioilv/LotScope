# -*- coding: utf-8 -*-
"""HTTP の道（Blueprint "main"）。関心ごとに分けたモジュールが同じ bp へ登録する。

    common   … 共通の部品（bp・マスタの窓口・失敗の返し方・この PC の名乗りと権限）
    system   … 画面・版・起動の確認・画面の設定・心拍と終了
    access   … アクセス権限・利用状況・書き込みの門番
    lots     … ロットの取り込み（LotDsp）と計算
    masters  … 現場のマスタ（設備・ロール）
    lotlist  … ロット一覧
    settings … 参照先マスタ
    worklog  … 作業実績（設備ごとの実績）と、その設備の登録
    formats  … 共有の書式（一覧の表示ルールを名前を付けて共有に置く）
    shifts   … 勤務体系（直の時間帯。作業実績を日＋直で数える決まり）
    presets  … 集計表・グラフの組み方のプリセット（共通と ID ごと・標準）
"""
from . import access, formats, lots, lotlist, masters, presets, settings, shifts, system, worklog  # 読み込むと bp へ登録される
from .common import _REVOKE_CACHE, bp  # _REVOKE_CACHE はテストが切断の覚えを消すため

__all__ = ["bp", "_REVOKE_CACHE", "access", "formats", "lots", "lotlist", "masters", "presets", "settings", "shifts", "system", "worklog"]
