# -*- coding: utf-8 -*-
"""マスタ(設備 / ロール)の中身の決まり（列・必須・同じ名前の重複・行の版）。

置き場（手元の data/ か共有フォルダか）と、書き込みの錠・取り直しは `master_store.MasterStore` の1箇所。
ここは「どの行をどう直すか」だけを持つ。

行の版（`rev`）: 行を直すたびに1つ上がる。画面は開いたときの `rev` を `base_rev` として送り、
保存の時点で違えば、ほかの PC（または同じ PC の別の画面）が先に直したとして `RowConflict` で断る
（黙って上書きしない）。`base_rev` を送らない古い呼び出しは確かめない。
"""
import json
from pathlib import Path

from ..services import conversions, dashboard, data_sources, display_formats, equip_groups, equipment_names, pivot_presets, row_check, shifts, work_log
from ..services.identity import normalize_part as _key     # 名前の比べ方（NFKC・前後の空白を除く・大文字）は1箇所
from ..services.row_order import next_order
from .master_store import DuplicateKey, MasterError, MasterStore, MasterUnreadable, NotFound, RowConflict, next_id


class InvalidRow(MasterError):
    """行の中身が決まりに合わない（例: 同一工程の名前がほかの設備の名前に当たる）。"""
    kind, status = "invalid", 400

# 同一工程: この設備と同じ工程とみなす名前（ANF, ANI* など。読み方は services/equipment_names.py）
EQUIPMENT_FIELDS = ["設備名", "巻取方向", "ライン方向", "同一工程", "検査計"]   # 検査計: "有" or 空（発見設備の自動選択の候補）
# 旧い列名 -> 正しい列名。Excel から移植した際に「巻取方向」を「巻出し方向」と
# 誤って名付けていた。利用者の PC に旧名で保存されたマスタも読むときに読み替える。
EQUIPMENT_RENAMED = {"巻出し方向": "巻取方向"}
ROLL_FIELDS = [
    "設備", "入出位置", "接触面", "ロール径MAX", "ロール径MIN", "ロール面長",
    "材質", "硬度", "本数", "ロール名", "ロール使用条件", "駆動方式", "基準番号", "備考",
]

# マスタごとの決まり: 列・旧い列名・同じ値を2行に持てない列（名前で引くマスタだけ）
SPECS = {
    "equipment_master": {"fields": EQUIPMENT_FIELDS, "renamed": EQUIPMENT_RENAMED, "unique": "設備名"},
    "roll_master": {"fields": ROLL_FIELDS, "renamed": {}, "unique": None},
    # 参照先（読みに行く場所）。項目ごとに1行（services/path_settings.py の ITEMS）
    "path_settings": {"fields": ["項目", "値"], "renamed": {}, "unique": "項目"},
    # アクセス権限（services/access.py）。ログインID・PC名の組は1行だけ（_check_row）
    "access_permissions": {"fields": ["ログインID", "PC名", "権限区分", "マスタ編集", "有効", "備考", "タブの例外"], "renamed": {}, "unique": None},
    # 見出しのタブの権限（版 3.58.0。services/access.py）。タブごとに 1 行: 出さない権限区分（・区切り）
    "tab_access": {"fields": ["タブ", "出さない区分"], "renamed": {}, "unique": "タブ"},
    # 作業実績の設備（services/work_log.py）。ファイルごとに1行。表示ルールは変わらないキーに結ぶ
    "work_log_files": {"fields": work_log.FIELDS, "renamed": {}, "unique": "キー"},
    # 共有の書式（services/display_formats.py）。名前は元（品質異常・作業実績）ごとに 1 つ（_check_row）
    "display_formats": {"fields": display_formats.FIELDS, "renamed": {}, "unique": None},
    # 勤務体系（services/shifts.py）。名称は 1 つずつ。区分は JSON の字
    "shift_patterns": {"fields": shifts.FIELDS, "renamed": {}, "unique": "名称"},
    # 設備グループ（services/equip_groups.py。版 3.39.0）。名称はまとめ方ごとに 1 つ（_check_row）
    "equipment_groups": {"fields": equip_groups.FIELDS, "renamed": {}, "unique": None},
    # 変換表（services/conversions.py。版 3.42.0）。名前は 1 つずつ（式の conv('名前', …) で引く。_check_row）
    "conversions": {"fields": conversions.FIELDS, "renamed": {}, "unique": None},
    # 変換表の標準（版 3.43.0）。「標準に戻す」で戻る中身。取り込んだ表を標準にすると置き、空なら同梱のプリセット
    "conversion_defaults": {"fields": conversions.FIELDS, "renamed": {}, "unique": None},
    # 集計表・グラフの組み方のプリセット（services/pivot_presets.py）。名前は (元・範囲・持ち主) ごとに 1 つ（_check_row）・標準は組ごとに 1 つ
    "pivot_presets": {"fields": pivot_presets.FIELDS, "renamed": {}, "unique": None},
    # すぐに見るの選び（ログイン ID・元ごとに 1 行。並びは組み方の id の JSON。quick_set が 1 行にまとめる）
    "pivot_quick": {"fields": pivot_presets.QUICK_FIELDS, "renamed": {}, "unique": None},
    # データ元（services/data_sources.py）。キーごとに 1 行（決まった元は、変えたときだけ行がある）
    "data_sources": {"fields": data_sources.FIELDS, "renamed": {}, "unique": "キー"},
    # ダッシュボードの条件（services/dashboard.py）。パネルごとに 1 行
    "dashboard_settings": {"fields": dashboard.FIELDS, "renamed": {}, "unique": "キー"},
    # ダッシュボードの組み（services/dashboard.py の LAYOUT_*）。列と決まりは組み方のプリセットと同じ（名前は範囲・持ち主ごとに 1 つ・標準は 1 つ）
    "dashboards": {"fields": pivot_presets.FIELDS, "renamed": {}, "unique": None},
}


def _clean(v):
    return ("" if v is None else str(v)).strip()


def _cell(v):
    """行へ置く字（_clean。並びは JSON の字: 結合〈data_join.clean と同じ json.dumps(ensure_ascii=False)・空なら ""〉。
    版 3.90.0: 並べ替え・グループで行の無い組み込みの元に行を作るとき、row_of の結合の並びが str() の repr の字になり、
    スケジュールの既定の結合〈仕掛と合わせる〉が読めずに消えた）"""
    if isinstance(v, list):
        return json.dumps(v, ensure_ascii=False) if v else ""
    return _clean(v)


def _normalize(row, spec):
    """読むときの形をそろえる（旧い列名の読み替え・版が無い行は1）。"""
    for old, new in spec["renamed"].items():
        if old in row:
            row.setdefault(new, row.pop(old))
    row.setdefault("rev", 1)
    return row


STRICT_ROWS = frozenset({"access_permissions", "tab_access"})


def bad_rows(rows):
    """表でない行の番号（1 から。版 3.102.0）"""
    return [i + 1 for i, r in enumerate(rows) if not isinstance(r, dict)]


def bad_rows_text(name, bad):
    """表でない行の理由の言葉（窓の desktop/src/bundle.rs の bad_rows_text と同じ）"""
    return f"{name}.json の {'・'.join(map(str, bad[:5]))}{' ほか' if len(bad) > 5 else ''} 行目が読めません（表でない行）"


def _name_of(spec):
    return next((k for k, v in SPECS.items() if v is spec), "マスタ")


def _normalize_all(rows, spec):
    """書く前に形をそろえる。表でない行があれば書かない（その行を消さない。版 3.102.0。前は AttributeError で HTML の 500）。
    → 隔てた行（版 3.107.0。row_check.problem）: id(行) → (何行目, 理由)。権限の 2 つは隔てる形の行があれば書かない"""
    name = _name_of(spec)
    bad = bad_rows(rows)
    if bad:
        raise MasterUnreadable(f"{bad_rows_text(name, bad)}。ファイルを直すまで保存しません。")
    for r in rows:
        _normalize(r, spec)
    iso = isolated(name, rows)
    if iso and name in STRICT_ROWS:
        raise MasterUnreadable(f"{row_check.skipped_text(name, skipped_of(iso))}。ファイルを直すまで保存しません。")
    return iso


# 組ごとの中身の確かめ（版 3.107.0。窓が同じに扱えない中身の形。隔てる）。dashboards はカードの設計の行だけ（元 card:…）


def _dashboards_extra(r):
    from ..services import card_forms
    return card_forms.row_problem(r) if str(r.get("元") or "").startswith(card_forms.SOURCE_PREFIX) else None


EXTRA_CHECKS = {"display_formats": display_formats.row_problem, "pivot_presets": pivot_presets.row_problem, "dashboards": _dashboards_extra,
                "dashboard_settings": dashboard.settings_problem, "equipment_groups": equip_groups.row_problem}


def isolated(name, rows):
    """隔てた行（表でない行も）: id(行) → (何行目, 理由)"""
    fields = SPECS[name]["fields"] if name in SPECS else ()
    extra = EXTRA_CHECKS.get(name)
    out = {}
    for i, r in enumerate(rows):
        why = row_check.problem(name, r, fields) or (extra(r) if extra else None)
        if why:
            out[id(r)] = (i + 1, why)
    return out


def row_key(name, r):
    """読めない行の目印（版 3.108.0 の作った後の採点の割れ 4）: 形をそろえた行の全部の字（json.dumps の ensure_ascii・sort_keys）の sha1 の頭 16 字。
    何行目かで消す道が、要約だけでなく行の中身まで同じかを確かめる（ほかの PC が前の行を消して位置がずれても、別の行を消さない）。
    窓の row_check::row_key と同じ字"""
    import hashlib
    norm = _normalize(dict(r), SPECS[name]) if isinstance(r, dict) and name in SPECS else r
    return hashlib.sha1(json.dumps(norm, ensure_ascii=True, sort_keys=True).encode("ascii")).hexdigest()[:16]


def skipped_of(iso, name=None, rows=None):
    """隔てた行の知らせ（答えの skipped: [{row, why, summary?, source?}]。行の順）。rows を渡すと、生の値の要約（summary: id と名前の列）と、
    元の列が字なら source（今の面の元に当たる行だけを札の数にする。版 3.107.0 の割れ 7）を添える"""
    by = {id(r): r for r in rows} if rows is not None else {}
    out = []
    for key, (n, why) in sorted(iso.items(), key=lambda kv: kv[1]):
        x = {"row": n, "why": why}
        r = by.get(key)
        if rows is not None:
            x["summary"] = row_check.summary(name, r)
            x["key"] = row_key(name, r)
            if isinstance(r, dict) and isinstance(r.get("元"), str):
                x["source"] = r["元"]
            # 道の id（int() が読めて i64 に入れば。知らせの面がその行を消す道に使う）
            v = row_check.as_int(r.get("id")) if isinstance(r, dict) and "id" in r else None
            if v is not None and -2 ** 63 <= v < 2 ** 63:
                x["id"] = v
        out.append(x)
    return out


def isolated_hit(rows, iso, item_id):
    """道の id が int() で当たる隔てた行（無ければ None）"""
    return next((r for r in rows if id(r) in iso and isinstance(r, dict) and row_check.as_int(r.get("id")) == item_id), None)


def guard(name, rows, iso, item_id):
    """直す行が隔てた行なら書かない（版 3.107.0。前は版の読めない行で英語の 400・id が字の行で「見つかりません」）。
    消すのは通す（値を読まずに行を除くだけ。割れ 1: 前に画面で消せた行は今も消せる。_delete）"""
    r = isolated_hit(rows, iso, item_id)
    if r is not None:
        n, why = iso[id(r)]
        raise MasterUnreadable(f"{name}.json の {n} 行目が読めません（{why}）。直すにはファイルを直すか、行を消してください。")


# 何行目かで読めない行を消せるマスタ（版 3.108.0。id で引けない行〈id が字〉・表でない行も画面の知らせの面から消す。窓の
# master_rows::ROW_DELETE と同じ）。権限の 2 つは消すと権限が変わるので入れない（ファイルを直す）。ダッシュボード・組み方・すぐに見るは
# 行ごとの持ち主で書ける人が決まるので入れない（id で引ける行は今どおりそれぞれの道で消す）
ROW_DELETE = ("equipment_master", "roll_master", "shift_patterns", "equipment_groups", "conversions", "display_formats", "path_settings",
              "data_sources", "work_log_files", "conversion_defaults")


def key_guard(name, rows, iso, col, key):
    """キーで引く行（data_sources のキー・作業実績の登録のキー）が隔てた行なら書かない（版 3.108.0。guard のキーの形。
    前はデータ元・作業実績の登録の行を隔てず、版の読めない行で英語の 400 だった。窓の row_check::key_guard と同じ）"""
    r = next((r for r in rows if id(r) in iso and isinstance(r, dict) and r.get(col) == key), None)
    if r is not None:
        n, why = iso[id(r)]
        raise MasterUnreadable(f"{name}.json の {n} 行目が読めません（{why}）。直すにはファイルを直すか、行を消してください。")


def dup_checked(name, rows, iso, fn):
    """名前の重なり・行の確かめ（fn(行の並び) が断る）を、読める行で当ててから隔てた行と 1 つずつ当てる。隔てた行と当たったら、
    何行目の読めない行と重なるかを言う（版 3.107.0 の割れ 3。前は見えない行と「もうあります」と言った。窓の row_check::dup_checked と同じ）"""
    fn([r for r in rows if id(r) not in iso])
    for r in rows:
        if id(r) in iso and isinstance(r, dict):
            try:
                fn([r])
            except (DuplicateKey, InvalidRow):
                n, why = iso[id(r)]
                raise DuplicateKey(f"{name}.json の {n} 行目の読めない行（{why}）と名前が重なります。その行を消すか、ファイルを直してください。") from None


# 隔てた行の覚え（割れ 5: 一覧・状態のたびに数え直さない）: (置き場, 名前) → (中身の目印, [(行の位置, 何行目, 理由)])
_ISO_MEMO = {}


def isolated_memo(store, name, rows):
    """isolated と同じ答えを、ファイルの目印（版・時刻・大きさ。MasterStore.stamp）で覚えて使い回す"""
    try:
        stamp = store.stamp(name)
    except Exception:
        stamp = None
    key = (id(store), name)
    hit = _ISO_MEMO.get(key)
    if stamp is not None and hit and hit[0] == stamp and all(i < len(rows) for i, _, _ in hit[1]):
        return {id(rows[i]): (n, why) for i, n, why in hit[1]}
    iso = isolated(name, rows)
    pos = {id(r): i for i, r in enumerate(rows)}
    if stamp is not None:
        _ISO_MEMO[key] = (stamp, [(pos[k], n, why) for k, (n, why) in iso.items()])
    return iso


class MasterRepository:
    def __init__(self, store):
        # 昔の呼び方（アプリのフォルダを渡す）は「手元のみ」の置き場として扱う
        self.store = store if isinstance(store, MasterStore) else MasterStore(Path(store))

    # -------------------------------------------------- 汎用
    def _list(self, name):
        spec = SPECS[name]
        # 表でない行は飛ばして読む（版 3.102.0。前は AttributeError で HTML の 500。束は bad_rows でその節を「読めない」と言う）。
        # 権限の 2 つは飛ばさずに断る（壊れた行を黙って飛ばすと、その人の権限が黙って変わる。門番は前と同じく 503。窓の access.rs も断る）
        rows = self.store.read(name)
        if name in STRICT_ROWS:
            bad = bad_rows(rows)
            if bad:
                raise MasterUnreadable(bad_rows_text(name, bad))
        rows = [_normalize(r, spec) if isinstance(r, dict) else r for r in rows]
        # 一覧が隔てる行は、束・ダッシュボードの問い合わせ・式の変換表・直の当て方でも使わない（版 3.107.0 の割れ 2。窓の Place::rows と同じ）
        iso = isolated_memo(self.store, name, rows) if name in row_check.FILTERED else {}
        return [r for r in rows if isinstance(r, dict) and id(r) not in iso]

    def bad_rows(self, name):
        """表でない行の番号（束が節を組めるかを見る）"""
        return bad_rows(self.store.read(name))

    def _viewed(self, name):
        spec = SPECS[name]
        rows = [_normalize(r, spec) if isinstance(r, dict) else r for r in self.store.read(name)]
        return rows, isolated_memo(self.store, name, rows)

    def view(self, name):
        """一覧に出す行（名前の列の字でない値は str() で読む: row_check.coerce）と、隔てた行の知らせ（版 3.107.0）→ (行, skipped)"""
        rows, iso = self._viewed(name)
        return [row_check.coerce(name, r) for r in rows if isinstance(r, dict) and id(r) not in iso], skipped_of(iso, name, rows)

    def find(self, name, item_id, delete=False):
        """道の id の行（一覧と同じく str() で読んだ写し）。無ければ None。隔てた行は、消すとき（delete）はその行を返し（値を読まずに消せる）、
        直すときは MasterUnreadable で書かない"""
        rows, iso = self._viewed(name)
        if delete:
            hit = isolated_hit(rows, iso, item_id)
            if hit is not None:
                return row_check.coerce(name, hit)
        guard(name, rows, iso, item_id)
        hit = next((r for r in rows if isinstance(r, dict) and id(r) not in iso and r.get("id") == item_id), None)
        return row_check.coerce(name, hit) if hit is not None else None

    def delete_unreadable_row(self, name, n, summary, key=""):
        """読めない行（隔てた行・表でない行）を、何行目（n。1 から）と生の値の要約（summary）と行の目印（key。row_key。知らせの skipped と同じ字）
        で消す（版 3.108.0）。その行がもう読めない行でない・要約か目印が違う（開いた後にほかの PC が直した・消した・並びが変わった）なら消さずに NotFound。
        ほかの行は形をそろえずにそのまま書き戻す。→ {row, why}"""
        spec = SPECS[name]
        extra = EXTRA_CHECKS.get(name)

        def mutate(rows, stamp):
            r = rows[n - 1] if 1 <= n <= len(rows) else None
            why = None
            if 1 <= n <= len(rows):
                norm = _normalize(dict(r), spec) if isinstance(r, dict) else r
                why = row_check.problem(name, norm, spec["fields"]) or (extra(norm) if extra and isinstance(norm, dict) else None)
            if not why or row_check.summary(name, r) != summary or row_key(name, r) != key:
                raise NotFound(f"{name}.json の {n} 行目は、開いたあとに変わりました（ほかの PC が直した・消した可能性があります）。画面を開き直してください。")
            rows.pop(n - 1)
            return {"row": n, "why": why}
        return self.store.write(name, mutate)

    def share_problem(self, name):
        """共有のファイルが読めない理由（読めれば・共有しなければ None。一覧の帯）"""
        return self.store.share_problem(name)

    @staticmethod
    def _find(rows, item_id):
        for i, r in enumerate(rows):
            if r.get("id") == item_id:
                return i, r
        return -1, None

    @staticmethod
    def _check_rev(row, base_rev):
        if base_rev is not None and int(row.get("rev", 1)) != int(base_rev):
            raise RowConflict(dict(row))

    @staticmethod
    def _check_unique(rows, spec, data, self_id=None):
        col = spec["unique"]
        if not col or col not in data:
            return
        k = _key(data.get(col))
        for r in rows:
            if r.get("id") != self_id and k and _key(r.get(col)) == k:
                raise DuplicateKey(f"{col}「{_clean(data.get(col))}」はもう登録されています（ほかの PC が先に追加した可能性があります）。")

    @staticmethod
    def _check_row(name, rows, data, self_id=None):
        if name == "access_permissions":
            key = (_key(data.get("ログインID")), _key(data.get("PC名")))
            for r in rows:
                if r.get("id") != self_id and (_key(r.get("ログインID")), _key(r.get("PC名"))) == key:
                    raise DuplicateKey(f"ログインID「{data.get('ログインID') or '（空）'}」・PC名「{data.get('PC名') or '（空）'}」の組はもう登録してあります。その行を直してください。")
        if name == "display_formats":
            key = (_key(data.get("名前")), data.get("元"))
            for r in rows:
                if r.get("id") != self_id and (_key(r.get("名前")), r.get("元")) == key:
                    raise DuplicateKey(f"書式「{data.get('名前')}」はもうあります。上書きするか、別の名前にしてください。")
        if name in ("pivot_presets", "dashboards"):
            g = pivot_presets.group_of(data)
            for r in rows:
                if r.get("id") != self_id and pivot_presets.group_of(r) == g and _key(r.get("名前")) == _key(data.get("名前")):
                    # 組の言葉（版 3.106.0: カードの設計・セットも同じ置き場なので、前は「ダッシュボード」と言っていた）
                    src = str(data.get("元") or "")
                    what = ("組み方" if name == "pivot_presets" else "カードの設計" if src.startswith("card:")
                            else "セット" if src == "dashset" else "ダッシュボード")
                    raise DuplicateKey(f"{what}「{data.get('名前')}」はもうあります。上書きするか、別の名前にしてください。")
        if name == "equipment_groups" and ("名称" in data or "まとめ方" in data):
            old = next((r for r in rows if r.get("id") == self_id), {})
            msg = equip_groups.check_unique(rows, {**old, **data}, self_id)
            if msg:
                raise DuplicateKey(msg)
        if name == "conversions" and "名前" in data:
            msg = conversions.check_unique(rows, data, self_id)
            if msg:
                raise DuplicateKey(msg)
        if name == "equipment_master":
            msg = equipment_names.check_row(rows, data, self_id)
            if msg:
                raise InvalidRow(msg)

    def _create(self, name, data):
        spec = SPECS[name]

        def mutate(rows, stamp):
            iso = _normalize_all(rows, spec)
            dup_checked(name, rows, iso, lambda rs: (self._check_unique(rs, spec, data), self._check_row(name, rs, data)))
            row = {"id": next_id(rows)}
            row.update({k: _clean(data.get(k)) for k in spec["fields"]})
            row.update(rev=1, **stamp)
            rows.append(row)
            return dict(row)
        return self.store.write(name, mutate)

    def _update(self, name, item_id, data, base_rev=None):
        spec = SPECS[name]

        def mutate(rows, stamp):
            iso = _normalize_all(rows, spec)
            guard(name, rows, iso, item_id)
            _, row = self._find(rows, item_id)
            if row is None:
                if base_rev is not None:
                    raise RowConflict(None)
                raise NotFound(f"id={item_id} が見つかりません。")
            self._check_rev(row, base_rev)
            dup_checked(name, rows, iso, lambda rs: (self._check_unique(rs, spec, data, self_id=item_id),
                                                    self._check_row(name, rs, {**row, **data}, self_id=item_id)))
            for k in spec["fields"]:
                if k in data:
                    row[k] = _clean(data.get(k))
            row.update(rev=int(row.get("rev", 1)) + 1, **stamp)
            return dict(row)
        return self.store.write(name, mutate)

    def _delete(self, name, item_id, base_rev=None):
        spec = SPECS[name]

        def mutate(rows, stamp):
            iso = _normalize_all(rows, spec)
            hit = isolated_hit(rows, iso, item_id)
            if hit is not None:      # 隔てた行は値を読まずに消す（版は確かめない。版 3.107.0 の割れ 1）
                rows.pop(next(i for i, r in enumerate(rows) if r is hit))
                return None
            i, row = self._find(rows, item_id)
            if row is None:
                if base_rev is not None:
                    return None            # もう消えている＝望みどおり
                raise NotFound(f"id={item_id} が見つかりません。")
            self._check_rev(row, base_rev)
            rows.pop(i)
            return None
        self.store.write(name, mutate)

    # -------------------------------------------------- 設備マスタ
    def equipment(self):
        return self._list("equipment_master")

    def equipment_create(self, data):
        return self._create("equipment_master", data)

    def equipment_update(self, item_id, data, base_rev=None):
        return self._update("equipment_master", item_id, data, base_rev)

    def equipment_delete(self, item_id, base_rev=None):
        self._delete("equipment_master", item_id, base_rev)

    def equipment_resolver(self):
        """同一工程の名前も含めて、設備名 → 設備マスタの行を引く係。"""
        return equipment_names.EquipmentResolver(self.equipment())

    def inspection_of(self, names):
        """設備名ごとに「検査計がある設備か」（同一工程の名前も読み替えて引く）。発見設備の自動選択の候補。"""
        res = self.equipment_resolver()
        out = {}
        for n in names:
            r, _, _ = res.resolve(n)
            out[n] = bool(r) and str(r.get("検査計") or "").strip() == "有"
        return out

    def equipment_map(self):
        out = {}
        for r in self.equipment():
            key = (r.get("設備名") or "").strip()
            if key:
                out[key] = {
                    "rewind": (r.get("巻取方向") or "").strip(),
                    "line_direction": (r.get("ライン方向") or "").strip(),
                }
        return out

    # -------------------------------------------------- 参照先マスタ
    # ---- アクセス権限（中身の判定は services/access.py。ここは行の読み書きだけ）
    def access_permissions(self):
        return self._list("access_permissions")

    def tab_access(self):
        return self._list("tab_access")

    def tab_access_put(self, rules):
        """タブの権限を 1 回の錠の中で置き換える。rules: {タブ: 出さない区分の並び}（空の並びのタブは行を消す。書いていないタブはそのまま）。"""
        spec = SPECS["tab_access"]

        def mutate(rows, stamp):
            _normalize_all(rows, spec)
            by = {r.get("タブ"): r for r in rows}
            for tab, roles in rules.items():
                text = "・".join(roles)
                row = by.get(tab)
                if not roles:
                    if row is not None:
                        rows.remove(row)
                    continue
                if row is None:
                    row = {"id": next_id(rows), "rev": 0, "タブ": tab}
                    rows.append(row)
                elif _clean(row.get("出さない区分")) == text:
                    continue
                row["出さない区分"] = text
                row.update(rev=int(row.get("rev", 0)) + 1, **stamp)
            return None
        self.store.write("tab_access", mutate)

    def access_permissions_create(self, data):
        return self._create("access_permissions", data)

    def access_permissions_update(self, item_id, data, base_rev=None):
        return self._update("access_permissions", item_id, data, base_rev)

    def access_permissions_delete(self, item_id, base_rev=None):
        return self._delete("access_permissions", item_id, base_rev)

    def path_settings(self):
        return self._list("path_settings")

    def path_setting_put(self, key, value, base_rev=None):
        """項目 key の値を置く（value が None なら行を消して既定へ戻す）。1回の錠の中で「有れば直す・無ければ足す」。
        base_rev: 画面が開いたときの行の版（行が無かったときは 0）。違えば RowConflict（ほかの PC が先に直した）。"""
        spec = SPECS["path_settings"]

        def mutate(rows, stamp):
            iso = _normalize_all(rows, spec)
            i = next((k for k, r in enumerate(rows) if r.get("項目") == key), -1)
            row = rows[i] if i >= 0 else None
            if row is not None and id(row) in iso:      # 隔てた行は直さない・消さない（版 3.107.0。前は版の読めない行で英語の 400）
                n, why = iso[id(row)]
                raise MasterUnreadable(f"path_settings.json の {n} 行目が読めません（{why}）。ファイルを直すまで保存しません。")
            if base_rev is not None:
                have = int(row.get("rev", 1)) if row else 0
                if have != int(base_rev):
                    raise RowConflict(dict(row) if row else None)
            if value is None:
                if row is not None:
                    rows.pop(i)
                return None
            if row is None:
                row = {"id": next_id(rows), "項目": key, "rev": 0}
                rows.append(row)
            row["値"] = str(value)
            row.update(rev=int(row.get("rev", 0)) + 1, **stamp)
            return dict(row)
        return self.store.write("path_settings", mutate)

    # -------------------------------------------------- データ元（中身の決まりは services/data_sources.py）
    def data_source_rows(self):
        return self._list("data_sources")

    def data_source_put(self, key, data, base_rev=None):
        """キー key の行を置く（有れば直す・無ければ足す。1 回の錠の中で）。data は clean_row 済みの行。
        base_rev: 画面が開いたときの行の版（行が無かったときは 0）。違えば RowConflict（ほかの PC が先に直した）。"""
        spec = SPECS["data_sources"]

        def mutate(rows, stamp):
            iso = _normalize_all(rows, spec)
            # 読めない行は隔てる（版 3.108.0。キーの当たる隔てた行は書かない・名前の重なりは隔てた行と 1 つずつ）
            row = next((r for r in rows if id(r) not in iso and r.get("キー") == key), None)
            if row is None:
                key_guard("data_sources", rows, iso, "キー", key)
            if base_rev is not None and (int(row.get("rev", 1)) if row else 0) != int(base_rev):
                raise RowConflict(dict(row) if row else None)
            if row is None:
                dup_checked("data_sources", rows, iso, lambda rs: self._check_unique(rs, spec, {"キー": key}))
                row = {"id": next_id(rows), "rev": 0}
                rows.append(row)
            row.update({k: _clean(data.get(k)) for k in spec["fields"]})
            row["キー"] = key
            row.update(rev=int(row.get("rev", 0)) + 1, **stamp)
            return dict(row)
        return self.store.write("data_sources", mutate)

    def data_source_order(self, rows, fields=("並び",)):
        """並び（版 3.54.0）・グループ（版 3.58.0）を 1 回の錠の中で置く。rows: キー → 行（clean 済みでなくてよい。
        fields の列だけを変え、行が無ければこの行で足す）。"""
        spec = SPECS["data_sources"]

        def mutate(have, stamp):
            iso = _normalize_all(have, spec)
            by = {r.get("キー"): r for r in have if id(r) not in iso}      # 隔てた行は並べない（版 3.108.0。キーが当たれば書かない）
            for key in rows:
                if key not in by:
                    key_guard("data_sources", have, iso, "キー", key)
            for key, data in rows.items():
                row = by.get(key)
                if row is None:
                    row = {"id": next_id(have), "rev": 0, **{k: _cell(data.get(k)) for k in spec["fields"]}, "キー": key}
                    have.append(row)
                elif all(_clean(row.get(f)) == _clean(data.get(f)) for f in fields):
                    continue
                row.update({f: _clean(data.get(f)) for f in fields})
                row.update(rev=int(row.get("rev", 0)) + 1, **stamp)
            return None
        self.store.write("data_sources", mutate)

    def data_source_delete(self, key, base_rev=None):
        """キー key の行を消す（決まった元なら既定へ戻す・足した元なら消す）。もう無ければ何もしない。"""
        spec = SPECS["data_sources"]

        def mutate(rows, stamp):
            iso = _normalize_all(rows, spec)
            i = next((k for k, r in enumerate(rows) if r.get("キー") == key), -1)
            if i < 0:
                return None
            if id(rows[i]) not in iso:       # 隔てた行は値を読まずに消す（版 3.108.0。_delete と同じ）
                self._check_rev(rows[i], base_rev)
            rows.pop(i)
            return None
        self.store.write("data_sources", mutate)

    # -------------------------------------------------- ダッシュボードの条件（版 3.36.0。読むだけ: 合わせた表へ引き継ぐ。services/dashboard.py）
    def dashboard_rows(self):
        return self._list("dashboard_settings")

    # -------------------------------------------------- 作業実績の設備（中身の決まりは services/work_log.py）
    def work_logs(self):
        return self._list("work_log_files")

    def work_log_update(self, item_id, data, base_rev=None):
        """設備名・表示・表・備考と、結ぶファイル（ファイル名・ファイルID）を直す。キーは変えない（表示ルールが離れるため）。"""
        data = {k: v for k, v in data.items() if k in work_log.FIELDS and k != "キー"}
        if "表示" in data:
            data["表示"] = "無" if str(data["表示"]).strip() == "無" else "有"
        if "設備名" in data and not _clean(data["設備名"]):
            raise InvalidRow("設備名を入れてください。")
        return self._update("work_log_files", item_id, data, base_rev)

    def work_log_delete(self, item_id, base_rev=None):
        self._delete("work_log_files", item_id, base_rev)

    def work_log_order(self, keys):
        """設備の並びを keys（キーの並び）の順にする（1 回の書き込みで全部の行の番号を振り直す。決まりは work_log.order_keys）。
        番号が変わった行だけ版を上げる。→ 並び替えたあとの行（並びの順）"""
        spec = SPECS["work_log_files"]

        def mutate(rows, stamp):
            iso = _normalize_all(rows, spec)
            good = [r for r in rows if id(r) not in iso]     # 隔てた行は並べず、そのまま書き戻す（版 3.108.0）
            for r, n in work_log.order_numbers(good, keys):
                if str(r.get("並び") or "") != n:
                    r.update({"並び": n, "rev": int(r.get("rev", 1)) + 1, **stamp})
            return [dict(r) for r in work_log.ordered(good)]
        return self.store.write("work_log_files", mutate)

    def work_log_sync(self, found):
        """フォルダで見つけたファイルを登録に当てる（1回の錠の中で）: 名前が変わったファイルは登録の名前を書き換え、
        ファイルID の無い行には入れ、新しいファイルは行を足す（表示は "有"・設備名はファイル名の * の所）。見つからない行は消さない。
        → {"added": [行], "renamed": [{id, from, to}], "missing": [行]}"""
        spec = SPECS["work_log_files"]

        def mutate(rows, stamp):
            iso = _normalize_all(rows, spec)
            # 隔てた行には結ばず、その行のファイルも新しい設備として足さない（版 3.108.0。行はそのまま書き戻す）
            # 名前でも、ファイルID でも（名前を変えたファイル）当たれば足さない（版 3.108.0 の作った後の採点の割れ 6）
            bad = [r for r in rows if id(r) in iso and isinstance(r, dict)]
            held = {str(r.get("ファイル名") or "").lower() for r in bad}
            fids = [str(r.get("ファイルID") or "") for r in bad if r.get("ファイルID")]
            m = work_log.match([r for r in rows if id(r) not in iso], found)
            m["new"] = [f for f in m["new"] if f["file"].lower() not in held and not any(work_log.same_fid(f["fid"], x) for x in fids)]
            out = {"added": [], "renamed": [], "missing": [dict(r) for r in m["missing"]]}
            for r, f in m["linked"] + m["renamed"]:
                changed = {}
                if r.get("ファイル名") != f["file"]:
                    changed["ファイル名"] = f["file"]
                    out["renamed"].append({"id": r.get("id"), "from": r.get("ファイル名"), "to": f["file"]})
                if f["fid"] and not work_log.same_fid(r.get("ファイルID"), f["fid"]):
                    changed["ファイルID"] = f["fid"]
                if not r.get("キー"):
                    changed["キー"] = work_log.new_key()
                if changed:
                    r.update(changed)
                    r.update(rev=int(r.get("rev", 1)) + 1, **stamp)
            for f in m["new"]:
                row = {"id": next_id(rows), "キー": work_log.new_key(), "設備名": f["equipment"], "ファイル名": f["file"],
                       "ファイルID": f["fid"], "表示": "有", "表": "", "備考": "", "rev": 1, **stamp}
                rows.append(row)
                out["added"].append(dict(row))
            return out
        return self.store.write("work_log_files", mutate)

    # -------------------------------------------------- 共有の書式
    def formats(self):
        return self._list("display_formats")

    def format_create(self, data):
        return self._create("display_formats", data)

    def format_update(self, item_id, data, base_rev=None):
        """名前・中身・備考を直す（元・表・作った所は作ったときのまま）。"""
        return self._update("display_formats", item_id, {k: v for k, v in data.items() if k in ("名前", "中身", "備考")}, base_rev)

    def format_delete(self, item_id, base_rev=None):
        self._delete("display_formats", item_id, base_rev)

    # -------------------------------------------------- 集計表・グラフの組み方のプリセット（中身の決まりは services/pivot_presets.py）
    def pivot_presets(self):
        return self._list("pivot_presets")

    def _preset_write(self, item_id, data, base_rev=None, name="pivot_presets"):
        """作る（item_id が None）・直す。標準にしたら、同じ組（元・範囲・持ち主）のほかの標準を外す（1 回の書き込みで）。
        name … pivot_presets（組み方）か dashboards（ダッシュボード。列と決まりが同じ）"""
        spec = SPECS[name]

        def mutate(rows, stamp):
            iso = _normalize_all(rows, spec)
            guard(name, rows, iso, item_id)
            if item_id is None:
                row = {"id": next_id(rows), **{k: "" for k in spec["fields"]}}
                dup_checked(name, rows, iso, lambda rs: self._check_row(name, rs, data))
                rows.append(row)
                row["rev"] = 0
            else:
                _, row = self._find(rows, item_id)
                if row is None:
                    if base_rev is not None:
                        raise RowConflict(None)
                    raise NotFound(f"id={item_id} が見つかりません。")
                self._check_rev(row, base_rev)
                dup_checked(name, rows, iso, lambda rs: self._check_row(name, rs, {**row, **data}, self_id=item_id))
            for k in spec["fields"]:
                if k in data:
                    row[k] = _clean(data.get(k))
            row.update(rev=int(row.get("rev", 0)) + 1, **stamp)
            if row.get("標準") == "1":
                g = pivot_presets.group_of(row)
                for r in rows:
                    if r is row or r.get("標準") != "1" or pivot_presets.group_of(r) != g:
                        continue
                    if id(r) in iso:
                        # 隔てた行の★だけを外す（ほかの値・版はそのまま書き戻す。版 3.107.0 の割れ 4: 前は同じ組に★が 2 つ残り、
                        # ファイルを直した後にどちらが標準になるかが並び次第だった。断ると★を付けられなくなるので、外す方に決めた）
                        r["標準"] = ""
                        continue
                    r.update(標準="", rev=int(r.get("rev", 1)) + 1, **stamp)
            return dict(row)
        return self.store.write(name, mutate)

    def preset_create(self, data):
        return self._preset_write(None, data)

    def preset_update(self, item_id, data, base_rev=None):
        """名前・中身（上書き）・標準・備考を直す（元・範囲・持ち主は作ったときのまま）。"""
        return self._preset_write(item_id, {k: v for k, v in data.items() if k in ("名前", "中身", "標準", "備考")}, base_rev)

    def preset_delete(self, item_id, base_rev=None):
        self._delete("pivot_presets", item_id, base_rev)

    # -------------------------------------------------- ダッシュボードの組み（列と決まりは組み方のプリセットと同じ。中身は services/dashboard.py）
    def dashboards(self):
        return self._list("dashboards")

    def dashboard_create(self, data):
        return self._preset_write(None, data, name="dashboards")

    def dashboard_update(self, item_id, data, base_rev=None):
        return self._preset_write(item_id, {k: v for k, v in data.items() if k in ("名前", "中身", "標準", "備考")}, base_rev, name="dashboards")

    def dashboard_delete(self, item_id, base_rev=None):
        self._delete("dashboards", item_id, base_rev)

    def pivot_quick(self):
        return self._list("pivot_quick")

    def quick_set(self, login, source, keys):
        """この ID・この元のすぐに見るの並びを置く（keys が None なら行を消して既定に戻す）。1 回の書き込みで行を 1 つにまとめる。"""
        spec = SPECS["pivot_quick"]

        def mutate(rows, stamp):
            iso = _normalize_all(rows, spec)
            mine = [r for r in rows if id(r) not in iso and r.get("ログインID") == login and r.get("元") == source]
            for r in mine[1:] + (mine[:1] if keys is None else []):
                rows.remove(r)
            if keys is None:
                return None
            row = mine[0] if mine else None
            if row is None:
                row = {"id": next_id(rows), "ログインID": login, "元": source, "rev": 0}
                rows.append(row)
            row.update(並び=json.dumps(keys, ensure_ascii=False), rev=int(row.get("rev", 0)) + 1, **stamp)
            return dict(row)
        return self.store.write("pivot_quick", mutate)

    # -------------------------------------------------- 勤務体系（中身の決まりは services/shifts.py）
    def shift_patterns(self):
        return self._list("shift_patterns")

    def shift_create(self, data):
        """data はマスタの行の形（shifts.clean_row の答え）。表示順が無ければ最後（いまの最大 + 10）。"""
        if not str(data.get("表示順") or "").strip():
            data = {**data, "表示順": next_order(self.shift_patterns())}
        return self._create("shift_patterns", data)

    def shift_update(self, item_id, data, base_rev=None):
        return self._update("shift_patterns", item_id, data, base_rev)

    def shift_delete(self, item_id, base_rev=None):
        self._delete("shift_patterns", item_id, base_rev)

    # -------------------------------------------------- 設備グループ（中身の決まりは services/equip_groups.py）
    def equip_groups(self):
        return self._list("equipment_groups")

    def equip_group_create(self, data):
        """data はマスタの行の形（equip_groups.clean_row の答え）。表示順が無ければ最後（いまの最大 + 10）。"""
        if not str(data.get("表示順") or "").strip():
            data = {**data, "表示順": next_order(self.equip_groups())}
        return self._create("equipment_groups", data)

    def equip_group_update(self, item_id, data, base_rev=None):
        return self._update("equipment_groups", item_id, data, base_rev)

    def equip_group_delete(self, item_id, base_rev=None):
        self._delete("equipment_groups", item_id, base_rev)

    # -------------------------------------------------- 変換表（中身の決まりは services/conversions.py）
    def conversions(self):
        return self._list("conversions")

    def conversion_create(self, data):
        """data はマスタの行の形（conversions.clean_row の答え）。表示順が無ければ最後（いまの最大 + 10）。"""
        if not str(data.get("表示順") or "").strip():
            data = {**data, "表示順": next_order(self.conversions())}
        return self._create("conversions", data)

    def conversion_update(self, item_id, data, base_rev=None):
        return self._update("conversions", item_id, data, base_rev)

    def conversion_delete(self, item_id, base_rev=None):
        self._delete("conversions", item_id, base_rev)

    def conversion_bundled(self):
        """同梱のプリセット（app/master_defaults/conversions.json。最初の中身）"""
        try:
            return [_normalize(r, SPECS["conversions"]) for r in json.loads(self.store.defaults("conversions").read_text(encoding="utf-8"))]
        except (OSError, ValueError):
            return []

    def conversion_presets(self):
        """標準（「標準に戻す」で戻る中身）。取り込んで標準にした表があればそれ、無ければ同梱のプリセット（版 3.43.0）"""
        own = self._list("conversion_defaults")
        return own if own else self.conversion_bundled()

    def conversion_defaults_custom(self):
        return bool(self._list("conversion_defaults"))

    def conversion_defaults_set(self, rows):
        """標準を、この表の並び（マスタの行の形）に置き換える。空の並びなら同梱のプリセットに戻る"""
        spec = SPECS["conversion_defaults"]

        def mutate(cur, stamp):
            cur.clear()
            for i, data in enumerate(rows, 1):
                cur.append({"id": i, **{k: _clean(data.get(k)) for k in spec["fields"]}, "rev": 1, **stamp})
            return len(cur)
        return self.store.write("conversion_defaults", mutate)

    def conversion_import(self, rows):
        """取り込む（マスタの行の形の並び）。同じ名前の表は中身を置き換え（版を 1 つ上げる）、無い名前は後ろに足す。1 回の書き込みで行う。
        → {"added": 足した数, "replaced": 置き換えた数}"""
        spec = SPECS["conversions"]

        def mutate(cur, stamp):
            iso = _normalize_all(cur, spec)
            # 隔てた行と同じ名前の表は取り込まない（触れる書き。版 3.107.0。窓の import_rows と同じ）
            by = {str(r.get("名前") or ""): r for r in cur if id(r) not in iso}
            blocked = {str(r.get("名前") or ""): iso[id(r)] for r in cur if id(r) in iso}
            hit = next((blocked[k] for k in (str(d.get("名前") or "") for d in rows) if k in blocked), None)
            if hit:
                raise MasterUnreadable(f"conversions.json の {hit[0]} 行目が読めません（{hit[1]}）。ファイルを直すまで保存しません。")
            top = int(next_order(cur)) - 10
            added = replaced = 0
            for data in rows:
                old = by.get(str(data.get("名前") or ""))
                if old is not None:
                    for k in spec["fields"]:
                        if k in data and k != "表示順":
                            old[k] = _clean(data.get(k))
                    old.update(rev=int(old.get("rev", 1)) + 1, **stamp)
                    replaced += 1
                else:
                    top += 10
                    row = {"id": next_id(cur), **{k: _clean(data.get(k)) for k in spec["fields"]}, "rev": 1, **stamp}
                    row["表示順"] = str(top)
                    cur.append(row)
                    by[row["名前"]] = row
                    added += 1
            return {"added": added, "replaced": replaced}
        return self.store.write("conversions", mutate)

    # -------------------------------------------------- ロールマスタ
    def rolls(self):
        return self._list("roll_master")

    def rolls_create(self, data):
        return self._create("roll_master", data)

    def rolls_update(self, item_id, data, base_rev=None):
        return self._update("roll_master", item_id, data, base_rev)

    def rolls_delete(self, item_id, base_rev=None):
        self._delete("roll_master", item_id, base_rev)
