"""数の設定（写し直す間隔・古さの警告の時間）の読み方（版 3.106.0。作った後の採点の割れ 1・2）。

配った設定・参照先・データ元の行に書いた数の設定は、どこで読んでもこの 1 つの部品で読む:
work_log.params（作業実績）・__init__.lot_list_params（品質の写し）・data_sources.read_params と conn_of（データ元の写しと「接続」の段）。
窓は desktop/src/bundle.rs の num_setting（同じ決まり）。

決まり: None・空の字は既定（知らせない）。Python の float() で読める値（数・真偽・「12.5」「１２」「 36 」など）はそのまま返す。
読めない値（「abc」・空白だけ・並び・表）は既定に替え、知らせの言葉（warn）を返す。前は品質の古さが「abc」だと float() の ValueError で
起動できず、作業実績の画面が 400・500 になり、窓は黙って既定で答えていた。
"""

# 知らせの言葉に使う、設定の名前と単位（キーは設定の項目の名前・接続の欄の id のどちらでも引ける）
LABELS = {"stale_hours": ("古さの警告の時間", "時間"), "stale": ("古さの警告の時間", "時間"),
          "refresh_seconds": ("確かめる間隔", "秒"), "refresh": ("確かめる間隔", "秒")}


def read(value, default):
    """→ (値, 読めたか)。読めなければ (既定, False)"""
    if value is None or (isinstance(value, str) and value == ""):
        return default, True
    try:
        float(value)
    except (TypeError, ValueError):
        return default, False
    return value, True


def warn(key, value, default):
    """読めなかった値の知らせ（画面の「直すこと」・「接続」の段に出す。技術の鍵は書かない）"""
    label, unit = LABELS[key]
    return f"配った設定の{label}「{value}」が数ではないので、既定の {default} {unit}で見ています。"


def read_warn(value, default, key):
    """→ (値, 知らせ〈読めたら ""〉)"""
    v, ok = read(value, default)
    return v, ("" if ok else warn(key, value, default))
