"""数の設定（写し直す間隔・古さの警告の時間）の読み方（版 3.106.0。作った後の採点の割れ 1・2）。

配った設定・参照先・データ元の行に書いた数の設定は、どこで読んでもこの 1 つの部品で読む:
work_log.params（作業実績）・__init__.lot_list_params（品質の写し）・data_sources.read_params と conn_of（データ元の写しと「接続」の段）。
窓は desktop/src/bundle.rs の num_setting（同じ決まり）。

決まり: None・空の字は既定（知らせない）。Python の float() で読める値（数・真偽・「12.5」「１２」「 36 」など）はそのまま返す。
読めない値（「abc」・空白だけ・並び・表）は既定に替え、知らせの言葉（warn）を返す。前は品質の古さが「abc」だと float() の ValueError で
起動できず、作業実績の画面が 400・500 になり、窓は黙って既定で答えていた。
"""

# 欄の名前と単位（言葉の決まりの 1 か所。データ元の「接続」の段の欄の名前〈data_sources.CONN_SPECS〉・見出しの札・「直すこと」・知らせは
# どれもここから出す。版 3.106.0 の作った後の採点: 前は同じ状態を 4 つの言葉で呼んでいた）。キーは接続の欄の id
LABELS = {"stale": ("古さの警告（時間）", "時間"), "refresh": ("確かめる間隔（秒）", "秒")}
# 読めなかった値の出どころ（版 3.107.0。前は「既定の値」と言い、欄の空の字「既定: 36」〈いま効いている値〉と同じ言葉で別の物を指していた。
# 知らせは値が書かれた所を言う: 配った設定〈全員の PC が読む設定ファイル〉の値）
SOURCE = "全員の設定ファイル"
# 設定の項目の名前 → 接続の欄の id
FIELD_OF = {"stale_hours": "stale", "refresh_seconds": "refresh", "stale": "stale", "refresh": "refresh"}


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
    """読めなかった値の知らせ（画面の「直すこと」・「接続」の段に出す。技術の鍵は書かない。出どころ〈SOURCE〉を言い、「既定」は
    画面の欄の空の字「既定: …」〈いま効いている値〉だけに使う。版 3.107.0）"""
    label, unit = LABELS[FIELD_OF[key]]
    return f"{SOURCE}の{label}の値「{value}」が数ではないので、{default} {unit}で見ています。"


def warn_item(key, value, default):
    """知らせの 1 件 {field, label, text}（画面の札は「{label}が数でない」）"""
    f = FIELD_OF[key]
    return {"field": f, "label": LABELS[f][0], "text": warn(key, value, default)}
