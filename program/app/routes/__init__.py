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
    equipgroups … 設備グループ（ダッシュボードで設備を合算する組）
    conversions … 変換表（コードの読み替え・判定表。式の conv）
    presets  … 集計表・グラフの組み方のプリセット（共通と ID ごと・標準）
    sources  … データ元（品質データ・作業実績・仕掛・足した元）と、1 ファイルの元の一覧
    dashboard… ダッシュボード（設備別の仕掛ロット数・前日の実績本数）と集計対象の条件
"""
from . import access, conversions, dashboard, equipgroups, formats, lots, lotlist, masters, presets, settings, shifts, sources, system, worklog  # 読み込むと bp へ登録される
from .common import _REVOKE_CACHE, bp  # _REVOKE_CACHE はテストが切断の覚えを消すため

__all__ = ["bp", "_REVOKE_CACHE", "access", "conversions", "dashboard", "equipgroups", "formats", "lots", "lotlist", "masters", "presets", "settings", "shifts", "sources", "system", "worklog"]
