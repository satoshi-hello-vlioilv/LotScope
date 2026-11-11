# -*- coding: utf-8 -*-
"""スケジュール（CM3 の設備ごとの作業予定。ScheduleView を移した。版 3.57.0）。

ScheduleView は「CM3 の作業予定」と「仕掛台帳（LOTNOW.sqlite3）」を自前で写して突き合わせていた。LotScope では、
仕掛はすでにデータ元「仕掛」（wip）として手元へ写して読んでいるので、写しも突合せも共通の仕組みに乗せる:

  CM3 ──(cm3_schedule.py: 取得・整形)──▶ 設備ごとの表「予定」（この PC の作業場所の db_cache/schedule。手元の SQLite）
                                              │  データ元「スケジュール」（sch）の結合（data_join.py。既定: ロットNo = 仕掛のロット番号）
                                              ▼
                                         一覧・スライサー・集計表・ダッシュボード・Excel（今までと同じ仕組みが読む）
  HOT コイル作業順 … HOT の設備（既定 L-1・L-2・L-3）の結合した答えから、前工程が HOT で次の設備がその設備の 1 パス目を
                    完了予定の順に並べた表「HOT」（build_hot）

設定（配った設定 config/appsettings.json の schedule。CM3 の URL・端末の IP・設備・点検の言葉は参照先マスタで直せる）:
  cm3_base_url・init_path・client_ip・timeout_sec・use_system_proxy … CM3 への問い合わせ
  cm3_view_url_template … 「CM3 の画面を開く」（{base}・{setsubi}・{termkbn}）
  equipments            … 設備のタブ（「L-1, L-2, L-3」。端末区分が違う設備は「L-9:2」のように : の後ろに書く。既定は term_kbn）
  inspect_keywords      … 点検の行の言葉（「点検板」。「、」「,」で区切って複数）
  cache_sec             … 同じ設備を続けて取りに行かない秒（ScheduleView と同じ 10 秒）
  auto_refresh_sec      … 画面を開いている間、CM3 を取り直す間隔（既定 60 秒。画面は新しい予定が来たら自分で出し直す）
  hot                   … HOT コイル作業順（title・equipments〈空なら全設備〉・prev_value・result_course_column・
                          remain_course_column・kama_column）

置き方: 中身が変わったときだけ、新しい世代のファイル（<設備>.g<番号>.<書き手>.sqlite3）に書く（Windows では読んでいる途中のファイルを
置き換えられないため。db_mirror.py と同じ考え）。古い世代は次に書くときに消す（1 つ前は残す。消せなければその次）。
版 3.96.0: デスクトップ版は窓（desktop/src/schedule.rs）がただ 1 つの係で、ここは受け身（Schedules の説明）。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import cm3_schedule
from .cm3_schedule import Cm3Error
from .sqlite_ro import connect_ro, qi

HOT_KEY = "__HOT__"
# 受け身の Python が、窓が知らせを受けた印（<設備>.taken.json）を待つ秒（版 3.96.0。窓が答えないときに timeout × 2 × 11 秒待たない。
# 窓は知らせを受けた糸ですぐ印を書く）
TAKE_WAIT = 5.0
TABLE = "予定"
HOT_TABLE = "HOT"
DEFAULTS = {
    "cm3_base_url": "http://nlmfangyweb1a:9085",
    "init_path": "/Cm3SchWeb/service/schapp/cmschview/init",
    "cm3_view_url_template": "{base}/Cm3SchWeb/#/schapp/cmschview?termkbn={termkbn}&setsubi={setsubi}",
    "client_ip": "150.150.107.35",
    "equipments": "L-1, L-2, L-3",
    "term_kbn": "4",
    "inspect_keywords": "点検板",
    "timeout_sec": 15,
    "use_system_proxy": False,
    "cache_sec": 10,
    "auto_refresh_sec": 60,
    "hot": {"title": "HOTコイル作業順", "equipments": "", "prev_value": "HOT", "result_course_column": "実績_設備ｺｰｽ",
            "remain_course_column": "残仕掛設備ｺｰｽ", "kama_column": "設計_PIT炉番炉順"},
}
_SPLIT = re.compile(r"[,、，\s]+")


def _words(v):
    if isinstance(v, (list, tuple)):
        v = ",".join(str(x) for x in v)
    return [w for w in _SPLIT.split(str(v or "")) if w]


def config(settings):
    """設定 schedule を既定に重ねた形（設備・点検の言葉・HOT の設備は並びにする）。"""
    raw = dict((settings or {}).get("schedule") or {})
    cfg = {**DEFAULTS, **{k: v for k, v in raw.items() if v not in (None, "") and k != "hot"}}
    cfg["hot"] = {**DEFAULTS["hot"], **{k: v for k, v in (raw.get("hot") or {}).items() if v not in (None, "")}}
    eqs = []
    for w in _words(cfg["equipments"]):
        code, _, kbn = w.partition(":")
        if code and code not in [e["code"] for e in eqs]:
            eqs.append({"code": code, "name": code, "term_kbn": kbn or str(cfg["term_kbn"])})
    cfg["equipments"] = eqs
    cfg["inspect_keywords"] = _words(cfg["inspect_keywords"])
    codes = [e["code"] for e in eqs]
    hot = cfg["hot"]
    hot["equipments"] = [e for e in (_words(hot["equipments"]) or codes) if e in codes]
    return cfg


def view_url(cfg, code):
    """「CM3 の画面を開く」の URL（HOT のときは空）。"""
    e = next((x for x in cfg["equipments"] if x["code"] == code), None)
    if e is None:
        return ""
    from urllib.parse import quote
    return str(cfg["cm3_view_url_template"]).replace("{base}", str(cfg["cm3_base_url"]).rstrip("/")) \
        .replace("{setsubi}", quote(code)).replace("{termkbn}", quote(str(e["term_kbn"])))


def norm_name(s):
    """列名の比べ方（ScheduleView と同じ: 全角半角・大小・区切りの _ - . ・ 空白を見ない）。"""
    return re.sub(r"[\s_\-\.・]", "", unicodedata.normalize("NFKC", str(s or "")).upper())


def norm_key(v):
    """値の比べ方（ScheduleView と同じ: NFKC・大文字・空白を除く・数は数で）。"""
    if v is None:
        return ""
    s = re.sub(r"\s", "", unicodedata.normalize("NFKC", str(v)).upper())
    if re.fullmatch(r"[+-]?\d+(\.\d+)?", s):
        return ("%.6f" % float(s)).rstrip("0").rstrip(".")
    return s


def find_column(cols, name):
    """表の列のうち name に当たる物（そのまま → 比べ方をそろえて）。無ければ ""。"""
    if name in cols:
        return name
    n = norm_name(name)
    return next((c for c in cols if norm_name(c) == n), "")


def _safe(code):
    return re.sub(r"[^0-9A-Za-z_\-]", "_", code) + "-" + hashlib.sha1(code.encode("utf-8")).hexdigest()[:6]


def fetch_conf(cfg):
    """取りに行く設定（状態の resigned.for と、窓への知らせに載せる。窓が降りた設定と比べる）"""
    return {k: cfg.get(k) for k in ("cm3_base_url", "init_path", "client_ip", "timeout_sec", "use_system_proxy")}


def _sig(rows):
    """表の行の指紋（窓 desktop/src/schedule.rs の sig_of と同じ字。版 3.96.0 の作った後の直し: 書き手によらず比べられるので、
    相手の置いた世代を覚えに取り込んだ後も、中身が同じなら置き直さない＝changedAt が Python だけの形と同じ）"""
    h = []
    for r in rows:
        for v in r:
            if v is None:
                h.append("N")
            elif isinstance(v, (bool, int)):
                h.append(f"I{int(v)}")
            elif isinstance(v, float):
                h.append("R" + repr(v))
            else:
                h.append("T" + json.dumps(v if isinstance(v, str) else str(v), ensure_ascii=False))
            h.append("\x01")
        h.append("\n")
    return hashlib.sha1("".join(h).encode("utf-8", "surrogatepass")).hexdigest()


def _sendable(cfg):
    """知らせの枠に載せられる設定か（NaN・無限は窓が JSON として読めない。そのときは窓に頼まず、ここが取る＝Python と同じ誤り）"""
    try:
        json.dumps(fetch_conf(cfg), allow_nan=False, default=str)
        return True
    except ValueError:
        return False


def _gen_of(name, head):
    """<safe>.g<番号>[.<書き手>].sqlite3 → (番号, 書き手〈無ければ ""〉)。合わなければ None"""
    if not (name.startswith(head) and name.endswith(".sqlite3")):
        return None
    n, _, w = name[len(head):-len(".sqlite3")].partition(".")
    return (int(n), w) if n.isascii() and n.isdigit() else None


class Schedules:
    """設備ごとの予定を覚え、手元の表に置く係（アプリに 1 つ）。同じ設備を同時に取りに行かない（先に取りに行った答えを待って使う）。

    版 3.96.0: デスクトップ版で窓が schedule を名乗ると受け身（passive）。窓（desktop/src/schedule.rs）がただ 1 つの係で、
    ここは窓の状態のファイル（<設備>.state.json）と世代を読むだけ。取りに行く要るときは notify（知らせ {"event": "schedule", …}。
    効いている設定 fetch・端末区分・点検の言葉を載せる）で窓に頼み、状態の seq が変わるまで待つ（窓の接続＋読みの timeout より長く）。
    窓が取れない設定・整えられない答えで係を降りた（状態の resigned.for がこちらの設定と同じ）設備は、ここが取りに行って置く（書き手 py）。
    世代の番号は置き場にある最大＋1（書き手を名前に入れ、片付けるのは自分の書いた物だけ）。状態のファイルは一時ファイルから置き換える。"""

    def __init__(self, root, fetch=cm3_schedule.get_schedule, passive=False, notify=None, writer="py"):
        self.root = Path(root)
        self.fetch = fetch                  # 試験は作り物に差し替える
        self.passive = passive
        self.notify = notify
        self.writer = writer
        self._lock = threading.Lock()
        self._eq_locks = {}
        self._state = {}                    # 設備 → {data, path, sig, fetchedAt, changedAt, checkedAt, error, gen}
        self._seq = {}                      # 設備 → 済んだ回数（錠を待っていた問い合わせが、先に済んだ結果を使う）
        self._bg = set()                    # 裏で取りに行っている設備
        self._cleaned = passive             # 受け身は片付けない（係の窓が片付ける）

    # ------------------------------------------------------------ 状態のファイル
    def _state_path(self, code):
        return self.root / f"{_safe(code)}.state.json"

    def read_state(self, code, busy=None):
        """状態のファイル（無ければ {}）。書き手が置き換えている途中で読めない（Windows の共有違反・半端な中身）ときは、少し待って読み直し、
        それでも読めなければ busy（既定 {}）"""
        for i in range(5):
            try:
                v = json.loads(self._state_path(code).read_text(encoding="utf-8"))
                return v if isinstance(v, dict) else {}
            except FileNotFoundError:
                return {}
            except (OSError, ValueError):
                time.sleep(0.02 * (i + 1))
        return {} if busy is None else busy

    def _write_state(self, code):
        """状態のファイルを書く（seq はファイルの seq＋1。降りた印は、1 回だけの物を消し、設定の物は残す）"""
        had = self.read_state(code)
        res = had.get("resigned")
        keep = res if isinstance(res, dict) and res.get("once") is False else None
        with self._lock:
            st = dict(self._state.get(code) or {})
        v = {"code": code, "writer": self.writer, "seq": int(had.get("seq") or 0) + 1, "path": st.get("path"), "sig": st.get("sig", ""),
             "gen": st.get("gen", 0), "fetchedAt": st.get("fetchedAt"), "changedAt": st.get("changedAt"), "checkedAt": st.get("checkedAt"),
             "error": st.get("error", ""), "data": st.get("data"), "resigned": keep}
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.root / f"{_safe(code)}.state.{os.getpid()}.{threading.get_ident()}.tmp"
        tmp.write_text(json.dumps(v, ensure_ascii=False, default=str), encoding="utf-8")
        _replace(tmp, self._state_path(code))

    def _clean_once(self):
        """起こしてから初めて使うとき（係のときだけ）: 前の状態を読まず、状態のファイルと自分の書いた世代を片付ける"""
        with self._lock:
            if self._cleaned:
                return
            self._cleaned = True
        for p in self.root.glob("*.state.json"):
            try:
                p.unlink()
            except OSError:
                pass
        for p in self.root.glob("*.g*.sqlite3"):
            m = _gen_of(p.name, p.name[:p.name.rfind(".g") + 2])
            if m and m[1] in ("", self.writer):
                try:
                    p.unlink()
                except OSError:
                    pass

    def _adopt(self, code):
        """受け身で係になったとき: 状態のファイルの書き手が自分でなければ（窓が係の間に取った・窓が起こし直して消した）、ファイルの方を覚えにする。
        前に自分が係だったときの古い覚え（消えたかもしれない世代）を答えない（版 3.96.0 の作った後の直し。窓の adopt と対）"""
        st = self.read_state(code)
        if st.get("writer") == self.writer:
            return
        with self._lock:
            self._state[code] = {k: st[k] for k in ("data", "path", "sig", "gen", "fetchedAt", "changedAt", "checkedAt", "error")
                                 if k in st and st[k] is not None}

    def keeps(self, cfg, code):
        """受け身でも、この設備はここが係か（窓が係を降りた印の設定がこちらの設定と同じ）"""
        if not self.passive:
            return True
        r = self.read_state(code).get("resigned")
        return isinstance(r, dict) and r.get("for") == fetch_conf(cfg)

    # ------------------------------------------------------------ 取る
    def _eq_lock(self, code):
        with self._lock:
            return self._eq_locks.setdefault(code, threading.Lock())

    def peek(self, code):
        if self.passive and code != HOT_KEY:
            st = self.read_state(code)
            return {k: st[k] for k in ("data", "path", "sig", "gen", "fetchedAt", "changedAt", "checkedAt", "error") if k in st and st[k] is not None}
        with self._lock:
            return dict(self._state.get(code) or {})

    def _age(self, code):
        st = self.peek(code)
        return time.time() - st["checkedAt"] if st.get("checkedAt") else None

    def ensure(self, cfg, code, *, max_age=None, force=False):
        """設備 code の予定を、max_age 秒より古ければ取り直して表に置く → 覚え（peek の形）。
        取れなかったら、前に取れた答えがあればそれを使い続ける（error に理由）。一度も取れていなければ Cm3Error。
        錠を待っている間に先の取り直しが済んでいれば、その結果を失敗も含めて使う（版 3.96.0。同じ設備の問い合わせが重なっても、
        届かない CM3 を 1 本ずつ timeout 秒待ち直さない）"""
        e = next((x for x in cfg["equipments"] if x["code"] == code), None)
        if e is None:
            raise Cm3Error(f"未登録の設備です: {code}")
        max_age = cfg["cache_sec"] if max_age is None else max_age
        if self.passive and not self.keeps(cfg, code) and _sendable(cfg):
            return self._ensure_passive(cfg, e, max_age, force)
        self._clean_once()
        with self._lock:
            seq0 = self._seq.get(code, 0)
        lk = self._eq_lock(code)
        with lk:                                     # 同じ設備は 1 本ずつ（後から来た問い合わせは、先の答えを待って使う）
            if self.passive:
                self._adopt(code)
            with self._lock:
                st = dict(self._state.get(code) or {})
                waited = self._seq.get(code, 0) != seq0
            if waited:
                if st.get("path"):
                    return st
                if st.get("error"):
                    raise Cm3Error(st["error"])
            age = time.time() - st["checkedAt"] if st.get("checkedAt") else None
            if not force and st.get("path") and age is not None and age < max_age:
                return st
            now = time.time()
            try:
                data = self.fetch(cfg, code, e["term_kbn"], cfg["inspect_keywords"])
            except Cm3Error as err:
                with self._lock:
                    cur = self._state.setdefault(code, {})
                    cur.update(checkedAt=now, error=str(err))
                    st = dict(cur)
                    self._seq[code] = self._seq.get(code, 0) + 1
                self._write_state(code)
                if not st.get("path"):
                    raise
                return st
            data["fetchedAt"] = time.strftime("%Y/%m/%d %H:%M:%S", time.localtime(now))
            self._store(code, data, now)
            with self._lock:
                self._seq[code] = self._seq.get(code, 0) + 1
            self._write_state(code)
            with self._lock:
                return dict(self._state.get(code) or {})

    def _ensure_passive(self, cfg, e, max_age, force):
        """受け身: 窓の状態が新しければそれ。古ければ窓に知らせて、状態の seq が変わるまで待つ"""
        code = e["code"]
        st = self.read_state(code)
        age = time.time() - st["checkedAt"] if isinstance(st.get("checkedAt"), (int, float)) else None
        if not force and st.get("path") and age is not None and age < max_age:
            return self.peek(code)
        seq0 = st.get("seq") or 0
        try:                                         # 窓の最悪の時間: 30x を 10 回たどる 11 本 × （接続＋読み の timeout）
            wait = float(cfg.get("timeout_sec") or 15) * 2 * 11 + 5
        except (TypeError, ValueError):
            wait = 335.0
        self._tell(cfg, e, max_age, force, seq0)
        start = time.monotonic()
        end = start + max(min(wait, 600.0), 5.0)
        taken = False
        while time.monotonic() < end:
            time.sleep(0.03)
            st = self.read_state(code, busy={"seq": seq0})
            if (st.get("seq") or 0) != seq0:
                break
            if not taken:                            # 窓が知らせを受けたか（受けた印の seq）。受けなければ TAKE_WAIT 秒で待つのをやめる
                taken = self._taken(code) == seq0
                if not taken and time.monotonic() - start > TAKE_WAIT:
                    break
        else:
            st = self.read_state(code)
            if st.get("path"):
                return self.peek(code)
            raise Cm3Error("CM3の応答がタイムアウトしました")
        if self.keeps(cfg, code):                    # 窓が係を降りた: ここが取りに行く
            return self.ensure(cfg, code, max_age=max_age, force=force)
        st = self.peek(code)
        if not st.get("path"):
            raise Cm3Error(st.get("error") or "CM3の応答がタイムアウトしました")
        return st

    def _taken(self, code):
        """窓が受けた知らせの seq（<設備>.taken.json。無い・読めなければ None）"""
        try:
            return json.loads((self.root / f"{_safe(code)}.taken.json").read_text(encoding="utf-8")).get("seq")
        except (OSError, ValueError, AttributeError):
            return None

    def _tell(self, cfg, e, max_age, force, seq=0):
        if self.notify is None:
            return
        self.notify(equip=e["code"], termKbn=e["term_kbn"], inspect=list(cfg["inspect_keywords"]), fetch=fetch_conf(cfg),
                    maxAge=max_age, force=bool(force), seq=seq)

    def ensure_many(self, cfg, codes, *, max_age=None, force=False):
        """いくつかの設備を同時に取りに行く（待ちはいちばん遅い設備の分だけ）→ {設備: 覚え か Cm3Error}"""
        def one(c):
            try:
                return self.ensure(cfg, c, max_age=max_age, force=force)
            except Cm3Error as err:
                return err
        if len(codes) <= 1:
            return {c: one(c) for c in codes}
        with ThreadPoolExecutor(max_workers=min(8, len(codes))) as ex:
            return dict(zip(codes, ex.map(one, codes)))

    def refresh_later(self, cfg, codes):
        """古くなった設備を裏で取り直す（画面の鮮度の問い合わせから。答えは待たない）。受け身は窓に知らせるだけ"""
        due = [c for c in codes if (self._age(c) is None or self._age(c) >= cfg["auto_refresh_sec"]) and c not in self._bg]
        for c in due:
            if self.passive and not self.keeps(cfg, c):
                e = next((x for x in cfg["equipments"] if x["code"] == c), None)
                if e is not None:
                    self._tell(cfg, e, cfg["auto_refresh_sec"], False, self.read_state(c).get("seq") or 0)
                continue
            with self._lock:
                if c in self._bg:
                    continue
                self._bg.add(c)

            def run(c=c):
                try:
                    self.ensure(cfg, c, max_age=cfg["auto_refresh_sec"])
                except Exception:
                    pass
                finally:
                    with self._lock:
                        self._bg.discard(c)
            threading.Thread(target=run, name=f"schedule-{c}", daemon=True).start()
        return due

    # ------------------------------------------------------------ 置く
    def _max_gen(self, code):
        head = f"{_safe(code)}.g"
        gens = [m[0] for m in (_gen_of(p.name, head) for p in self.root.glob(f"{_safe(code)}.g*.sqlite3")) if m]
        return max(gens, default=0)

    def _new_path(self, code, cur):
        gen = max(int(cur.get("gen") or 0), self._max_gen(code)) + 1
        return gen, self.root / f"{_safe(code)}.g{gen}.{self.writer}.sqlite3"

    def _store(self, code, data, now):
        rows = cm3_schedule.table_rows(data)
        sig = _sig(rows)
        with self._lock:
            cur = dict(self._state.get(code) or {})
        if cur.get("sig") != sig or not cur.get("path") or not Path(cur["path"]).exists():
            gen, path = self._new_path(code, cur)
            write_table(path, TABLE, cm3_schedule.COLUMN_NAMES, rows)
            self._sweep(code, (path, cur.get("path")))
            cur.update(path=str(path), sig=sig, gen=gen, changedAt=now)
        cur.update(data=data, fetchedAt=now, checkedAt=now, error="")
        with self._lock:
            self._state[code] = cur

    def _sweep(self, code, keep):
        """自分の書いた古い世代を消す（読んでいて消せなければ次の機会に）。keep: 残すファイル（新しい世代と 1 つ前）。
        1 つ前を残すのは、裏の取り直しが新しい世代を置いた直後に、前の世代のパスを受け取った問い合わせが
        まだ開いていない（結合を組む前の）ことがあるため。消すと「unable to open database」になる（版 3.57.1）。
        ほかの書き手（窓 rs）の世代は消さない（版 3.96.0: 相手の今の世代を消し合わない）"""
        keep = {Path(k) for k in keep if k}
        head = f"{_safe(code)}.g"
        for p in self.root.glob(f"{_safe(code)}.g*.sqlite3"):
            m = _gen_of(p.name, head)
            if m and m[1] in ("", self.writer) and p not in keep:
                try:
                    p.unlink()
                except OSError:
                    pass

    # ------------------------------------------------------------ HOT コイル作業順
    def build_hot(self, cfg, parts, errors=()):
        """parts: [(設備, 結合した答えのファイル, 表)] → (HOT の表のファイル, 情報)。中身が前と同じならファイルは書き直さない。
        errors: 取れなかった設備の理由（「L-2: CM3に接続できません…」。情報に載せる）"""
        hot = cfg["hot"]
        items, cols_all, per, errors = [], [], {}, list(errors)
        counts = {"lots": 0, "noMaster": 0, "otherNext": 0, "laterPass": 0}
        found = {"resultColumn": "", "remainColumn": "", "kamaColumn": ""}
        prev_value = norm_key(hot["prev_value"])
        for code, path, table in parts:
            per[code] = 0
            with connect_ro(Path(path), timeout=5) as c:
                cur = c.execute(f"SELECT * FROM {qi(table)}")
                cols = [d[0] for d in cur.description]
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            for col in cols:
                if col not in cols_all:
                    cols_all.append(col)
            res = find_column(cols, hot["result_course_column"])
            rem = find_column(cols, hot["remain_course_column"])
            kama = find_column(cols, hot["kama_column"])
            found = {"resultColumn": found["resultColumn"] or res, "remainColumn": found["remainColumn"] or rem,
                     "kamaColumn": found["kamaColumn"] or kama}
            for r in rows:
                if r.get("区分") != cm3_schedule.KIND_LABEL["lot"]:
                    continue
                counts["lots"] += 1
                # 仕掛に当たったか: 仕掛から持ってきた HOT の列のどれかに値がある（当たらなかった行は相手の列が空）
                if not res or all(r.get(x) in (None, "") for x in (res, rem, kama) if x):
                    counts["noMaster"] += 1
                    continue
                hist = str(r.get(res) or "").split()
                prev = hist[-1] if hist else ""
                if norm_key(prev) != prev_value:
                    continue
                if rem:
                    nxt = str(r.get(rem) or "").split()
                    if nxt and norm_key(nxt[0]) != norm_key(code):     # 同じロットが別の線にも予定されている: HOT の直後の線だけ
                        counts["otherNext"] += 1
                        continue
                if (r.get("パス") or 1) != 1:                          # 2 パス目からは、この線の後（HOT の直後ではない）
                    counts["laterPass"] += 1
                    continue
                items.append({**r, "前工程": prev, "釜番": r.get(kama) if kama else None})
                per[code] += 1
        order = {e: i for i, e in enumerate(hot["equipments"])}
        items.sort(key=lambda r: (r.get("完了予定日時") or "9999", order.get(r.get("設備"), 99), r.get("No") or 0))
        lead = ["HOT順", "設備", "開始予定", "完了予定", "No", "ロットNo", "パス", "前工程", "釜番"]
        cols = lead + [c for c in cols_all if c not in lead]
        out = [[i if c == "HOT順" else r.get(c) for c in cols] for i, r in enumerate(items, 1)]
        sig = hashlib.sha1(json.dumps([cols, out], ensure_ascii=False, default=str).encode("utf-8")).hexdigest()
        with self._lock:
            cur = dict(self._state.get(HOT_KEY) or {})
        now = time.time()
        if cur.get("sig") != sig or not cur.get("path") or not Path(cur["path"]).exists():
            gen, path = self._new_path(HOT_KEY, cur)
            write_table(path, HOT_TABLE, cols, out)
            self._sweep(HOT_KEY, (path, cur.get("path")))
            cur.update(path=str(path), sig=sig, gen=gen, changedAt=now)
        info = {"title": hot["title"], "equipments": hot["equipments"], "prevValue": hot["prev_value"], **found,
                "kamaConfigured": hot["kama_column"], "perEquipment": per, "counts": counts, "errors": errors}
        cur.update(info=info, checkedAt=now)
        with self._lock:
            self._state[HOT_KEY] = cur
        return cur["path"], info


def write_table(path, table, cols, rows):
    """表を 1 つだけ持つ SQLite を書き切る（一時ファイルに書いて置き換える。読んでいる途中の画面に半端な物を見せない）。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.stem}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.unlink(missing_ok=True)
    c = sqlite3.connect(str(tmp))
    try:
        c.execute("PRAGMA journal_mode=OFF")
        c.execute(f"CREATE TABLE {qi(table)} ({', '.join(qi(x) for x in cols)})")
        if rows:
            c.executemany(f"INSERT INTO {qi(table)} VALUES ({', '.join('?' for _ in cols)})", rows)
        c.commit()
    finally:
        c.close()
    _replace(tmp, path)


def _replace(tmp, path):
    """置き換える（Windows で読んでいる途中なら少し待って取り直す。版 3.96.0）"""
    for i in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if i == 19:
                raise
            time.sleep(0.025 * (i + 1))


def summary(state, joined=None):
    """設備の表の上の数（ScheduleView の札と同じ: 製造件数・ロット数・点検・設備停止・仕掛と一致・先頭と最終の完了予定・CM3 の更新と取得）。
    joined: 結合の数（data_join の stats の 1 つ目。仕掛と当たった行の数）"""
    data = state.get("data") or {}
    items = data.get("items") or []
    lots = [i for i in items if i.get("rowKind") == "lot"]
    times = [i.get("kanryoYotei") for i in items if i.get("kanryoYotei")]
    hit = None
    if joined:
        hit = joined.get("hit")
    stop = next((i for i in items if i.get("rowKind") == "stop"), None)
    return {"count": len(lots), "lots": len({i.get("lotNo") for i in lots}), "inspect": data.get("inspectCount", 0),
            "stop": data.get("stopCount", 0), "hit": hit, "first": times[0] if times else "", "last": times[-1] if times else "",
            "nextStop": {"time": stop.get("kanryoYotei") or "", "text": stop.get("stopText") or ""} if stop else None,
            "updateTime": data.get("updateTime"), "fetchedAt": data.get("fetchedAt"), "error": state.get("error") or ""}


def missing_lots(path, table, brought):
    """結合した答えで、仕掛に当たらなかった製造の行のロットNo（区分の札「仕掛に無い」で絞る）。brought: 仕掛から持ってきた列"""
    if not brought:
        return []
    cond = " AND ".join(f"{qi(c)} IS NULL" for c in brought)
    with connect_ro(Path(path), timeout=5) as c:
        return sorted({r[0] for r in c.execute(f"SELECT {qi('ロットNo')} FROM {qi(table)} WHERE {qi('区分')} = ? AND {cond}",
                                               (cm3_schedule.KIND_LABEL["lot"],)) if r[0]})


def source_info(cfg, state, code):
    """一覧の「元データ」の札の答え（db_mirror.source_info と同じ形）。at は CM3 の更新、copiedAt は中身が変わって置き直した時刻。"""
    data = state.get("data") or {}
    ts = data.get("updateTs")
    at = None
    try:
        at = int(ts) / 1000 if ts is not None else None
    except (TypeError, ValueError):
        at = None
    return {"remote": view_url(cfg, code) or str(cfg["cm3_base_url"]), "at": at, "mirrored": bool(state.get("path")),
            "copiedAt": state.get("changedAt"), "checkedAt": state.get("checkedAt"), "unreachable": bool(state.get("error")),
            "reason": state.get("error") or "", "interval_sec": cfg["auto_refresh_sec"], "staleHours": 0, "ageHours": None,
            "stale": False, "kind": "cm3"}
