"""窓が自分の答えを焼く（bless。版 3.115.0。Rust 化の段 ③ の 4 つ目・案 G の 1 版目）。app を import しない（標準の部品だけ）。

    python tools/bless.py 本 …            … 本ごとに TPA_BLESS=1 で窓の突き合わせの試験を流して焼き（Python と同じときだけ書く）、
                                            時刻の境（次の分）をまたいでからもう 1 度焼いて、1 回目と同じかを見る（違えば元の表に戻して止める）。
                                            2 回目は「別の PC の形」で流す（版 3.117.0。tools/ci-shape.py の runner の形: PC の名前を替えた名前空間・
                                            TMPDIR は別のファイル系・SQLite の版が違う Python・取り出しは 5 日前の 775/664・プロキシと TLS の根の
                                            環境変数。利用者は root のまま）。焼いた PC に頼る葉があれば、CI でなく焼くときに止まる。
                                            同じだったら、焼いた表を runner の形の root でない利用者（daemon）で表と比べるだけでもう 1 度流す
                                            （3 回目。版 3.117.0 の作った後の直し: 利用者に頼る葉〈名前を書く欄の利用者の名前など〉を焼くときに止める。落ちたら元の表に戻す）。
                                            流せない PC（root でない・unshare が無い）では焼かない。終わりに焼いた PC の指紋が表に無いかも見る
    python tools/bless.py --all           … 焼く本すべて（desktop/tests/baked/books.json の phase が 3.115.0・3.116.0）
    python tools/bless.py --stats [--base 版] … 本ごとの表の大きさ（UTF-8 のバイト）・歩・葉・そろえた印（@T・@URL・@WORK など）の数を出す
                                            （--base は git の版〈例 origin/main〉。前の表から増えた分も出す。PR の説明に貼る）
    python tools/bless.py --user 本 …     … root でない利用者（nobody）で試験の実行ファイルを流し、root と違う歩を variants.user に焼く（fs・place・release_place）
    python tools/bless.py --no-python 本 … … TPA_NO_PYTHON=1 で流す（段 ④ の後の形: 表の宣言から場面を作り、焼いた答えとだけ比べる）
    python tools/bless.py --check         … cargo を流さずに、焼いた表の形と、焼いた時の元（答え合わせ役など）の指紋が今の元と同じかを見る（古さを止める。
                                            tests/test_baked_tables.py からも流れる）。焼いた PC の指紋（名乗りの欄の PC の名前・名前を書く欄の利用者の名前・
                                            一時フォルダ・ポート・ファイルID）も見る。違えば終了コード 1
    python tools/bless.py --measured フォルダ … [--json] … Windows の測るだけの仕事（.github/workflows/desktop.yml の TPA_MEASURE）が残した記録を読み、
                                            本ごとに「焼いた表（posix）と違う歩」の数と、違う葉の鍵・見本を出す（落とさない。終了コード 0）。
                                            フォルダは流した形ごと（Python と比べる形・表だけの形〈TPA_NO_PYTHON=1。段 ④ の後の形〉）で、形ごとに別の行で出す。
                                            --json は記録そのものを 1 表 1 行（「measure-json| 」で始まる行）でも出す（成果物を取れないときは仕事の記録から読む）。
                                            焼いた表の一覧と比べ、形ごとに「記録の無い表 n（名前）」も出す（--skip-test 試験,… で流さなかった試験だけが焼く表は除く）
    python tools/bless.py --from-log 記録 出力フォルダ … 仕事の記録（--json の行）から測りの記録を <出力フォルダ>/<形>/<表>.json に戻す（読めなかった行の数も言う）
    python tools/bless.py --no-python --all --skip-test 試験,… … Python 無しの形で流すが、名前を挙げた試験は流さない（Windows の測り: route_reach は長い）
    python tools/bless.py --scope 道の型 本 … … 段 ④ の後: 範囲を宣言して焼き直す（TPA_NO_PYTHON=1・TPA_BLESS=道の型）。範囲の外が変わったら書かない

焼いた表は desktop/tests/baked/<本>.json。焼くのは窓の試験（desktop/tests/common/bake.rs）で、この道具はそれを流して確かめるだけ。
独立の答え（tools/*-truth.py）と人が書いた事例の表（tests/fixtures/*_cases.json）は書き換えない（第 2 の線）。
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PROGRAM = Path(__file__).resolve().parents[1]
DESKTOP = PROGRAM.parent / "desktop"
BAKED = DESKTOP / "tests" / "baked"
_BOOKS_JSON = json.loads((BAKED / "books.json").read_text(encoding="utf-8"))
BOOKS = _BOOKS_JSON["books"]
# 焼いてある本の phase（books.json の bakedPhases。3.115.0 の 21 本・3.116.0 の 7 本・3.117.0 の本）。それより先の版（3.117.1・3.117.2）は、
# まだ焼いていない本。並びは books.json の 1 か所（ci-shape.py・tests/test_baked_tables.py も読む）
PHASES = tuple(_BOOKS_JSON["bakedPhases"])
# 表の大きさの上限（UTF-8 のバイト。版 3.116.0 の採点の first_fixes 3）: 本ごと（books.json の maxMB。無ければ 1.5 MB）と全部の計
MAX_MB = 1.5
MAX_TOTAL_MB = 40.0
# そろえた印（desktop/tests/common/bake.rs の settle が答えに置く字）。本ごとに数えて、そろえすぎを数で見せる（first_fixes 12）
STAMPS = ("@T(", "@URL", "@MS", "@WORK", "@REPO", "@HOME", "@USER", "@HELD:", "@VERSION", "@BUILD", "@HOST", "@DAY", "@ABOVE", "@PID", "@FID(")
STAMP_SHARE = 0.2      # 印のある葉が答えの葉のこの割合を超える本は知らせる（守りが薄い表）
# 場面のファイルの更新時刻「今からのずれ」がこれより大きい物は知らせる（ms。版 3.116.0 の作った後の直し）: 答え合わせ役が作ったファイルは
# 焼いた時の今（ずれは数秒）。大きいずれは、取り出しのファイルの時刻をそのまま写した（＝取り出してからの日数に頼る表）か、場面が
# わざと置いた時刻（books.json の sceneTimesWhy に理由を書いた本は知らせない）
NOW_OFFSET_MS = 10 * 60 * 1000
NOW_RE = re.compile(r"@NOW\((-?\d+)ms\)")


def baked(book):
    return BOOKS[book]["phase"] in PHASES


MARKS = ("@same", "@rep", "@lit")


def unpack(v, parts):
    """詰めた形を開く（desktop/tests/common/bake.rs の unpack と同じ: 参照 @same・繰り返しの字 @rep・印と同じ形の表 @lit）"""
    if isinstance(v, list):
        return [unpack(x, parts) for x in v]
    if isinstance(v, dict):
        if len(v) == 1 and next(iter(v)) in MARKS:
            k, x = next(iter(v.items()))
            if k == "@same":
                if x not in parts:
                    raise KeyError(f"詰めた表の参照 {x} の中身が parts にありません")
                return unpack(parts[x], parts)
            if k == "@rep":
                return "".join(s if isinstance(s, str) else s[0] * s[1] for s in x)
            return {kk: unpack(y, parts) for kk, y in x.items()}
        return {k: unpack(x, parts) for k, x in v.items()}
    return v


def unpack_table(t):
    """表を開いた形に（parts を外す。詰めていない表はそのまま）"""
    if "parts" not in t:
        return t
    parts = t["parts"]
    return {k: (unpack(v, parts) if k in ("oracle", "scene", "answers", "variants") else v) for k, v in t.items() if k != "parts"}


def leaves(v):
    if isinstance(v, dict):
        for x in v.values():
            yield from leaves(x)
    elif isinstance(v, list):
        for x in v:
            yield from leaves(x)
    else:
        yield v


def stats_of(path):
    """表 1 つの数: 大きさ（UTF-8 のバイト）・歩・答えの葉・印のある葉・印ごとの数"""
    raw = path.read_bytes()
    t = unpack_table(json.loads(raw))
    n = stamped = 0
    by = {}
    for x in leaves(t.get("answers", {})):
        n += 1
        if isinstance(x, str) and "@" in x:
            hit = [s for s in STAMPS if s in x]
            stamped += bool(hit)
            for s in hit:
                by[s] = by.get(s, 0) + x.count(s)
    return {"bytes": len(raw), "steps": len(t.get("answers", {})), "leaves": n, "stamped": stamped, "stamps": by}


def sources_of(book):
    """焼いた時の元の指紋（desktop/tests/common/bake.rs の sources_of と同じ: \\r を除いた sha256 の頭 16 字）"""
    out = {}
    for rel in BOOKS[book]["sources"]:
        b = (PROGRAM / rel).read_bytes().replace(b"\r", b"") if (PROGRAM / rel).exists() else b""
        out[rel] = hashlib.sha256(b).hexdigest()[:16]
    return out


def tables(baked=None):
    """tests/baked の焼いた表（books.json・settle.json の外の *.json）→ {表のファイルの名前: 本}。本は名前の頭（本.部分）"""
    baked = baked or BAKED
    return {p.stem: p.stem.split(".")[0] for p in sorted(baked.glob("*.json")) if p.name not in ("books.json", "settle.json")}


def files_of(book, baked=None):
    """本の表のファイル（本.json と、部分の 本.部分.json）"""
    return [(baked or BAKED) / f"{name}.json" for name, b in tables(baked).items() if b == book]


DATE = re.compile(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)")


def near_dates(book, days=3):
    """答え合わせ役の元に書いた固定の日付のうち、今日から days 日の内の物（焼くと「今に近い時刻」と読まれ、日がたつと表が古くなる時限の爆弾）"""
    import datetime as dt
    today = dt.date.today()
    out = []
    for rel in BOOKS[book]["sources"]:
        p = PROGRAM / rel
        for m in DATE.finditer(p.read_text(encoding="utf-8")) if p.exists() else []:
            try:
                d = dt.date(int(m[1]), int(m[2]), int(m[3]))
            except ValueError:
                continue
            if abs((d - today).days) <= days:
                out.append(f"{rel}: {m[0]}")
    return out


def local_paths():
    """焼いた PC ごとに違う道（リポジトリの根・家・cargo の作業フォルダ）。焼いた表に字のまま残っていてはいけない（版 3.115.0 の 2 回目の直し:
    手元〈家の外〉で焼いた表の program の道が、リポジトリが家の下にある CI で食い違った）"""
    out = [("リポジトリの根", str(PROGRAM.parent.resolve()))]
    home = os.environ.get("HOME", "")
    if len(home.rstrip("/")) > 1:
        out.append(("家", home.rstrip("/")))
    target = os.environ.get("CARGO_TARGET_DIR") or str(DESKTOP / "target")
    out.append(("cargo の作業フォルダ", str(Path(target).resolve())))
    return out


# PC の名前を引く係（DNS）の様子で変わる言葉。焼いた表の答えに残っていてはいけない（版 3.115.0 の PR #115 の CI の直し: builder の場面が
# 既定の社内の名前のまま CM3 を引きに行き、手元は「Name or service not known」、CI は「Temporary failure in name resolution」で食い違った。
# 場面は本物の名前を引かない形〈この PC の中の閉じた口〉にする。引けない名前の言葉そのものを突き合わせる本は、焼く前に決めを足す）
RESOLVER_WORDS = ("Name or service not known", "Temporary failure in name resolution", "No address associated with hostname",
                  "getaddrinfo failed", "nodename nor servname provided")


# 焼いた PC の指紋（版 3.117.0。採点の K2・first_fixes 8。測りで実際に表に残りかけた 4 種）。焼いた表に字のまま残っていてはいけない:
# - この PC の名前（ホスト名）: 名乗りを決めていない場面の pc は @HOST にそろえる（PR #116 は表に手元の「vm」が入り、CI の runner の名前で落ちた）
# - 一時フォルダの下の作業フォルダ（試験の da-名前-番号・開発用サーバーの tpa-ui-*・tpa-ops-*）: 作業フォルダは @WORK、場面は作業フォルダの下に作る
# - 流すたびに変わるポート（作り物のサーバーの 127.0.0.1:番号）: 名前つきの @URL(名前) にそろえる。場面が決めた閉じた口（:1 など 4 桁に
#   届かない番号）はそのまま
# - ファイルID（装置:inode）: @FID(場面の道) にそろえる
# 名前と一時フォルダは「今の PC」の値なので、焼いた PC で流したとき（焼いた直後の bless と、手元の py-tests）に効く。ポートとファイルID は字の形
PC_PORT = re.compile(r"(?:127\.0\.0\.1|localhost):(\d{4,5})(?!\d)")
PC_FID = re.compile(r"(?<![\d:.T\- /])(\d{2,6}):(\d{3,})(?![\d:.])")
PC_TMP = r"/(?:da|tpa|ci-shape|bless)-[A-Za-z0-9_.-]+"


# 名乗りの欄（版 3.117.0 の作った後の直し・割れ 1）: この PC の名前を探すのは、窓が名乗りに書く所だけ（表の「pc」の欄・名乗りの鍵
# 「端末@利用者」の頭・書いた人の言葉「PC 名前 が」）。前は表の字の全部から探し、localhost・desktop・root・PC-1 など場面の言葉と重なる
# 名前の PC では、どの表にも「指紋が残っている」と言った
PC_FIELDS = (r'"pc"\s*:\s*"{h}"', r'"key"\s*:\s*"{h}@', r'PC {h} ?が')
# 利用者の名前を書く欄（desktop/tests/baked/settle.json の nameKeys。割れ 2）: 焼いた利用者の名前が @USER でなく字のまま残っていてはいけない
NAME_KEYS = tuple(json.loads((BAKED / "settle.json").read_text(encoding="utf-8")).get("nameKeys", ()))


def os_user():
    """この PC の利用者の名前（desktop/tests/common/bake.rs の os_user と同じ順: LOGNAME・USER・LNAME・USERNAME・pwd）"""
    import getpass
    try:
        return getpass.getuser()
    except Exception:
        return ""


def spoken(text, book=None):
    """場面が決めた名前の言葉: 表の問い合わせ（oracle）と場面（scene）の字と、本の元（答え合わせ役など）の字。そこに出る名前は、
    答え合わせ役が場面に決めた名前（焼いた PC の指紋ではない）"""
    try:
        t = unpack_table(json.loads(text))
        asked = json.dumps([t.get("oracle"), t.get("scene")], ensure_ascii=False) if isinstance(t, dict) else ""
    except (ValueError, KeyError, TypeError, AttributeError):
        asked = ""
    src = ""
    for rel in BOOKS.get(book, {}).get("sources", []) if book else []:
        f = PROGRAM / rel
        src += f.read_text(encoding="utf-8", errors="replace") + "\n" if f.exists() else ""
    return asked, src


def pc_marks(text, host=None, tmp=None, user=None, book=None):
    """表の字（ファイルの中身）に残った焼いた PC の指紋 → [(種類, 見本)]。host・tmp・user は試験が決める（無ければこの PC の名前・一時フォルダ・利用者）。
    名前（PC の名前・利用者）は名乗りの欄だけを見て、場面が決めた名前（問い合わせと場面の字に出る・本の元に字〈"名前"〉で書いてある）は飛ばす
    （版 3.117.0 の作った後の直し・割れ 1・2）。book は表の本（check が渡す）"""
    import socket
    host = socket.gethostname() if host is None else host
    user = os_user() if user is None else user
    tmps = {"/tmp", "/dev/shm", "/var/tmp", (tempfile.gettempdir() if tmp is None else tmp).rstrip("/")}
    out = []
    said = []

    def hit(why, m):
        out.append((why, text[max(0, m.start() - 40):m.end() + 20].replace("\n", " ")))

    def named(pats, name):
        h = re.escape(json.dumps(name)[1:-1])
        m = next((m for pat in pats for m in [re.search(pat.format(h=h), text)] if m), None)
        if not m:
            return None
        if not said:
            said.extend(spoken(text, book))
        asked, src = said
        if re.search(r"(?<![A-Za-z0-9_.-])" + h + r"(?![A-Za-z0-9_.-])", asked) or re.search(r"([\"'])" + re.escape(name) + r"\1", src):
            return None
        return m
    if len(host) >= 2:
        m = named(PC_FIELDS, host)
        if m:
            hit(f"この PC の名前（{host}。@HOST にそろえるか、場面で identity.pc_name を決める）", m)
    if user and user != "@USER":
        m = named(tuple(r'"' + re.escape(k) + r'"\s*:\s*"{h}"' for k in NAME_KEYS), user)
        if m:
            hit(f"焼いた利用者の名前（{user}。名前を書く欄 nameKeys は @USER にそろえる。root でない利用者で流すと違う）", m)
    m = re.search("(?:" + "|".join(re.escape(json.dumps(t)[1:-1]) for t in sorted(tmps) if t) + ")" + PC_TMP, text)
    if m:
        hit("一時フォルダの下の作業フォルダ（@WORK にそろえるか、場面を作業フォルダの下に作る）", m)
    m = PC_PORT.search(text)
    if m:
        hit("流すたびに変わるポート（作り物のサーバーは名前つきの @URL(名前) にそろえる）", m)
    m = PC_FID.search(text)
    if m:
        hit("ファイルID（装置:inode。@FID(場面の道) にそろえる）", m)
    return out


def check(baked=None):
    """→ 食い違いの言葉の並び（空なら古くない）。tests/baked の表を全部（部分の表も）確かめる（版 3.115.0 の作った後の直し: 前は 本.json だけを見た）"""
    bad = []
    size = {}
    tabs = tables(baked)
    for name, book in tabs.items():
        if book not in BOOKS:
            bad.append(f"{name}: 知らない本の表（books.json に無い）")
            continue
        if BOOKS[book]["phase"] not in PHASES:
            bad.append(f"{name}: 焼く版でない本（phase {BOOKS[book]['phase']}）に表がある")
            continue
        text = ((baked or BAKED) / f"{name}.json").read_text(encoding="utf-8")
        size[book] = size.get(book, 0) + len(text.encode("utf-8"))
        for why, path in local_paths():
            if re.search(re.escape(json.dumps(path)[1:-1]) + r"(?=[/\\\\\"]|$)", text):
                bad.append(f"{name}: 焼いた PC の{why}（{path}）が字のまま残っている（@REPO・@WORK・@HOME にそろえて焼き直す）")
        for why, sample in pc_marks(text, book=book):
            bad.append(f"{name}: 焼いた PC の指紋が表に残っている: {why} …{sample}…")
        for w in RESOLVER_WORDS:
            if w in text:
                bad.append(f"{name}: PC の名前を引く係の様子で変わる言葉（{w}）が表にある（場面が本物の名前を引いている。引かない形にして焼き直す）")
        try:
            t = unpack_table(json.loads(text))
        except KeyError as e:
            bad.append(f"{name}: {e.args[0]}")
            continue
        for k in ("book", "os", "oracle", "scene", "answers", "routes", "sources"):
            if k not in t:
                bad.append(f"{name}: 表に {k} がありません")
        if t.get("book") != book or t.get("file", name) != name:
            bad.append(f"{name}: 表の本の名前が {t.get('book')}・{t.get('file')}")
        now = sources_of(book)
        for rel, h in now.items():
            if t.get("sources", {}).get(rel) != h:
                bad.append(f"{name}: 元 {rel} が焼いた時と違う（表が古い。python tools/bless.py {book} で焼き直す）")
        for rel in set(t.get("sources", {})) - set(now):
            bad.append(f"{name}: 表に知らない元 {rel}")
        scene = t.get("scene", {})
        for k in ("files", "dirs", "links", "blobs"):
            if not isinstance(scene.get(k), dict):
                bad.append(f"{name}: 場面の宣言に {k} がありません")
        for rel, e in scene.get("files", {}).items():
            if not e.get("fifo") and not e.get("made") and e.get("blob") not in scene.get("blobs", {}):
                bad.append(f"{name}: 場面のファイル {rel} の中身が無い")
        if not isinstance(t.get("answers"), dict) or set(t.get("answers", {})) != set(t.get("routes", {})):
            bad.append(f"{name}: 答えと道の型の鍵が合わない")
        elif not t["answers"] and not name.endswith(".shared"):
            bad.append(f"{name}: 答えが 1 つもありません")
    for book, b in sorted(BOOKS.items()):
        if b["phase"] in PHASES and book not in tabs.values():
            bad.append(f"{book}: 焼いた表がありません（python tools/bless.py {book}）")
    # 大きさの上限（UTF-8 のバイト）: 本ごと・全部の計。越えたら、場面と事例を減らすか、books.json の maxMB を理由つきで上げる
    for book, n in sorted(size.items()):
        cap = BOOKS[book].get("maxMB", MAX_MB)
        if n > cap * 1e6:
            bad.append(f"{book}: 表が大きい（{n / 1e6:.2f} MB > 上限 {cap} MB）")
    if sum(size.values()) > MAX_TOTAL_MB * 1e6:
        bad.append(f"焼いた表の計が大きい（{sum(size.values()) / 1e6:.1f} MB > 上限 {MAX_TOTAL_MB} MB）")
    return bad


def notices(baked=None):
    """知らせ（落とさない）: 印のある葉が答えの葉の STAMP_SHARE を超える本（そろえすぎで守りが薄い表）"""
    out = []
    for name, book in tables(baked).items():
        t = unpack_table(json.loads(((baked or BAKED) / f"{name}.json").read_text(encoding="utf-8")))
        far = [rel for rel, e in t.get("scene", {}).get("files", {}).items()
               if (m := NOW_RE.fullmatch(str(e.get("mtime", "")))) and abs(int(m[1])) > NOW_OFFSET_MS]
        if far and not BOOKS.get(book, {}).get("sceneTimesWhy"):
            out.append(f"{name}: 場面のファイル {len(far)} 個の更新時刻が今から 10 分より離れている（例 {far[0]}）。取り出しのファイルの時刻を"
                       "写していないか（tests/scene_files.py を通して写す）。場面がわざと置いた時刻なら books.json の sceneTimesWhy に理由を書く")
    for name in tables(baked):
        s = stats_of((baked or BAKED) / f"{name}.json")
        if s["leaves"] and s["stamped"] > STAMP_SHARE * s["leaves"]:
            out.append(f"{name}: そろえた印のある葉が {s['stamped']}/{s['leaves']}（{STAMP_SHARE:.0%} を超える。守りが薄い）")
    return out


def stats(base=None):
    """本ごとの表の大きさ・歩・葉・印の数（--base の版の表から増えた分も）"""
    rows, total, total0 = [], 0, 0
    for name in tables():
        s = stats_of(BAKED / f"{name}.json")
        old = None
        if base:
            r = subprocess.run(["git", "show", f"{base}:desktop/tests/baked/{name}.json"], cwd=PROGRAM.parent, capture_output=True)
            old = len(r.stdout) if r.returncode == 0 else 0
            total0 += old
        total += s["bytes"]
        marks = " ".join(f"{k}{v}" for k, v in sorted(s["stamps"].items()))
        grew = "" if old is None else f" 前 {old / 1e6:.2f} MB（{(s['bytes'] - old) / 1e6:+.2f}）"
        rows.append(f"{name}: {s['bytes'] / 1e6:.2f} MB{grew}・歩 {s['steps']}・葉 {s['leaves']}・印のある葉 {s['stamped']}（{marks or '無し'}）")
    print("\n".join(rows))
    print(f"計 {total / 1e6:.2f} MB" + (f"（前 {total0 / 1e6:.2f} MB）" if base else "") + f"・{len(rows)} ファイル")


def tests_of(books):
    out = []
    for b in books:
        for t in BOOKS[b]["tests"]:
            if t not in out:
                out.append(t)
    return out


def cargo(tests, env, filt=None):
    cmd = ["cargo", "test", "--locked", "--no-fail-fast"] + [x for t in tests for x in ("--test", t)]
    cmd += ["--", "--nocapture"] + ([filt] if filt else [])
    r = subprocess.run(cmd, cwd=DESKTOP, env={**os.environ, **env}, capture_output=True, text=True, encoding="utf-8", errors="replace")
    sys.stderr.write("\n".join(line for line in (r.stdout + r.stderr).splitlines() if line.startswith(("bless|", "test result", "thread"))) + "\n")
    if r.returncode != 0:
        sys.stderr.write(r.stdout[-6000:] + r.stderr[-6000:])
    return r.returncode


def sqlite_logical(data):
    """SQLite のファイルの中身を、作った SQLite の版によらない形（頭の決め・表の定義・行）にする（desktop/tests/common/bake.rs の sqlite_logical と
    同じ考え）。SQLite のファイルの頭には、最後に書いた SQLite の版の番号と、その版が数えた変更の数が入る。2 回目の焼きは SQLite の版が違う Python
    （/usr/bin/python3）で流すので、答え合わせ役が作る場面の SQLite はバイトが違う（版 3.117.0。別の PC の形の 2 回目で初めて見えた）。
    SQLite として開けない物は None（バイトのまま比べる）"""
    import sqlite3
    if not data.startswith(b"SQLite format 3\0") or len(data) < 100:
        return None
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "x.sqlite3"
        f.write_bytes(data)
        try:
            c = sqlite3.connect(f"file:{f}?mode=ro", uri=True)
            try:
                schema = c.execute("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid").fetchall()
                rows = {name: [[x.hex() if isinstance(x, bytes) else x for x in r] for r in c.execute('SELECT * FROM "' + name.replace('"', '""') + '"')]
                        for kind, name, _t, _s in schema if kind == "table"}
                pragmas = [c.execute(f"PRAGMA {n}").fetchall() for n in ("user_version", "application_id")]
            finally:
                c.close()
        except sqlite3.Error:
            return None
    return {"sqlite": {"schema": schema, "rows": rows, "pragmas": pragmas}, "head": (data[16:24] + data[56:60]).hex()}


def comparable(t):
    """2 回の焼きを比べる形（場面の今からのずれは流すたびに変わる。中身は指紋でなく中身で比べる。SQLite のファイルは作った SQLite の版に
    よらない形で比べる）"""
    import base64
    t = unpack_table(t)
    sc = t["scene"]

    def blob(e):
        b = sc["blobs"].get(e.get("blob"))
        logical = sqlite_logical(base64.b64decode(b["b64"])) if isinstance(b, dict) and "b64" in b else None
        return logical or b
    files = {rel: {**e, "blob": blob(e)} for rel, e in sc["files"].items()}
    s = json.dumps({"oracle": t["oracle"], "answers": t["answers"], "files": files, "dirs": sc["dirs"], "links": sc["links"],
                    "variants": t.get("variants")}, ensure_ascii=False, sort_keys=True)
    # 今からのずれ（場面の @NOW と答えの @T の秒）と、Python が場面を作るときに引く乱数（instance_id の uuid4 の 32 字）は比べない
    s = re.sub(r"@T\(([^|)]*)\|-?\d+\)", r"@T(\1|~)", re.sub(r"@NOW\(-?\d+ms", "@NOW(~", s))
    return json.loads(re.sub(r"\b[0-9a-f]{32}\b", "@HEX32", s))


def first_diff(a, b, p=""):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                return f"{p}.{k}: {'無い' if k not in a else '…'} / {'無い' if k not in b else '…'}"
            d = first_diff(a[k], b[k], f"{p}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{p}: 長さ {len(a)} / {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, f"{p}[{i}]")
            if d:
                return d
        return None
    return None if a == b else f"{p}: {str(a)[:200]} / {str(b)[:200]}"


def ci_shape():
    """tools/ci-shape.py（名前空間の作りはそこの 1 つ。名前に - があるので場所から読む）"""
    import importlib.util
    spec = importlib.util.spec_from_file_location("ci_shape", PROGRAM / "tools" / "ci-shape.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def second_pass(tests, out):
    """2 回目の焼き: 別の PC の形（ci-shape の runner の形・利用者は root のまま）で試験の実行ファイルを流し、表を out へ書く → 落ちた試験の並び"""
    ci = ci_shape()
    logs = Path(tempfile.mkdtemp(prefix="bless-pass2-"))
    extra = {"TPA_BLESS": "1", "TPA_BAKE_OUT": str(out)}
    if os.environ.get("TPA_SETTLE_DROP"):
        extra["TPA_SETTLE_DROP"] = os.environ["TPA_SETTLE_DROP"]       # 変異（そろえる決まりを 1 つ外して焼く）は 2 回目にも渡す
    bins = {t: exe for t, exe in ci.test_bins(tests).items() if t in tests}
    _, failed, why = ci.run_shape("runner", bins, logs, False, extra, as_root=True)
    if why:
        sys.exit(f"2 回目の焼き（別の PC の形）を流せません（{why}）")
    for t in failed:
        sys.stderr.write((logs / f"runner-{t}.log").read_text(encoding="utf-8", errors="replace")[-6000:])
    shutil.rmtree(logs, ignore_errors=True)
    return failed


def user_pass(tests):
    """3 回目（版 3.117.0 の作った後の直し・割れ 2）: 焼いた表を、ci-shape の runner の形で root でない利用者（daemon）のまま、
    表と比べるだけ（TPA_BLESS なし）で流す → 落ちた試験の並び。2 回目までは利用者が root のままなので、利用者に頼る葉
    （名前を書く欄の利用者の名前・家の道・権限）は、ここで止める"""
    ci = ci_shape()
    logs = Path(tempfile.mkdtemp(prefix="bless-pass3-"))
    os.chmod(logs, 0o755)
    extra = {k: os.environ[k] for k in ("TPA_SETTLE_DROP",) if os.environ.get(k)}
    bins = {t: exe for t, exe in ci.test_bins(tests).items() if t in tests}
    _, failed, why = ci.run_shape("runner", bins, logs, False, extra)
    if why:
        sys.exit(f"3 回目（root でない利用者の形）を流せません（{why}）")
    for t in failed:
        sys.stderr.write((logs / f"runner-{t}.log").read_text(encoding="utf-8", errors="replace")[-6000:])
    shutil.rmtree(logs, ignore_errors=True)
    return failed


def bless(books):
    tests = tests_of(books)
    why = ci_shape().cannot_run()
    if why:
        sys.exit(f"焼きません: 2 回目の焼きを別の PC の形（tools/ci-shape.py の runner の形）で流せない PC です（{why}）。root で流してください")
    near = [x for b in books for x in near_dates(b)]
    if near:
        sys.exit("答え合わせ役の元に今日から 3 日の内の固定の日付があります（焼くと今に近い時刻と読まれ、日がたつと表が古くなる）。遠い日付に替えてください:\n"
                 + "\n".join(near))
    keep = {p.name: p.read_bytes() for b in books for p in files_of(b)}
    if cargo(tests, {"TPA_BLESS": "1"}):
        restore(books, keep)
        sys.exit("1 回目の焼きが止まりました（Python と違う・試験の食い違い）。元の表に戻しました")
    # 2 回目は時刻の境（次の分）をまたいでから（同じ分の 2 回では時刻の揺れを見落とす。採点の指摘 3）
    wait = 62 - time.time() % 60
    print(f"時刻の境をまたぐまで {wait:.0f} 秒待ちます", flush=True)
    time.sleep(wait)
    with tempfile.TemporaryDirectory() as out:
        os.chmod(out, 0o755)
        failed = second_pass(tests, out)
        if failed:
            restore(books, keep)
            sys.exit(f"2 回目の焼き（別の PC の形）が止まりました: {' '.join(failed)}。元の表に戻しました")
        bad = []
        for b in books:
            for p in files_of(b):
                if not (Path(out) / p.name).exists():
                    bad.append(f"{p.stem}: 2 回目の表がありません")
                    continue
                one, two = (json.loads(f.read_text(encoding="utf-8")) for f in (p, Path(out) / p.name))
                d = first_diff(comparable(one), comparable(two))
                if d:
                    bad.append(f"{p.stem}: 1 回目と 2 回目（別の PC の形）が違う（焼いた PC かその瞬間に頼る葉がある。場面で決めるか、"
                               f"そろえる決まりを狭く足す）: {d}")
        if bad:
            restore(books, keep)
            sys.exit("\n".join(bad) + "\n元の表に戻しました")
    # 焼いた PC の指紋（PC の名前・一時フォルダの下の作業フォルダ・流すたびに変わるポート・ファイルID）が表に残っていないか
    names = {p.stem for b in books for p in files_of(b)}
    left = [x for x in check() if x.split(":")[0] in names and "焼いた PC" in x]
    if left:
        restore(books, keep)
        sys.exit("\n".join(left) + "\n元の表に戻しました")
    # 3 回目: root でない利用者（ci-shape の runner の形・表と比べるだけ）。落ちたら表を戻す
    failed = user_pass(tests)
    if failed:
        restore(books, keep)
        sys.exit(f"焼いた表を root でない利用者（ci-shape の runner の形）で比べると落ちました: {' '.join(failed)}"
                 "（利用者に頼る葉がある。名前を書く欄は settle.json の nameKeys で @USER にそろえる）。元の表に戻しました")
    print("2 回の焼き（2 回目は別の PC の形）が同じで、root でない利用者の形でも表と同じです:", " ".join(books))
    print("続けて、CI に似せたほかの形（nopy・nodns）でも流してください: python program/tools/ci-shape.py --shape nopy,nodns --book " + ",".join(books))


def restore(books, keep):
    for b in books:
        for p in files_of(b):
            if p.name not in keep:
                p.unlink()
    for name, data in keep.items():
        (BAKED / name).write_bytes(data)


def test_bins(tests):
    r = subprocess.run(["cargo", "test", "--locked", "--no-run", "--message-format=json"] + [x for t in tests for x in ("--test", t)],
                       cwd=DESKTOP, capture_output=True, text=True, check=True)
    out = {}
    for line in r.stdout.splitlines():
        m = json.loads(line)
        if m.get("reason") == "compiler-artifact" and m.get("executable") and m["target"]["kind"] == ["test"]:
            out[m["target"]["name"]] = m["executable"]
    return out


# root でない利用者で焼くときの一時の利用者（版 3.115.0 の作った後の直し: 前は nobody で流し、場面の login「nobody」と名前の置き換えが重なった）
BLESS_USER = "tpabless"


def bless_user(books):
    """root でない利用者（場面に出ない名前の一時の利用者 tpabless。無ければ作り、終わったら消す）で流して、root と違う歩を variants.user に焼く
    （root で焼いた答えは変えない）"""
    if os.geteuid() != 0:
        sys.exit("--user は root で流す（一時の利用者に替えて流す）")
    for b in books:
        for rel in BOOKS[b]["sources"]:
            if BLESS_USER in (PROGRAM / rel).read_text(encoding="utf-8"):
                sys.exit(f"一時の利用者の名前 {BLESS_USER} が場面に出ます（{rel}）。名前を替えてください")
    made = subprocess.run(["id", BLESS_USER], capture_output=True).returncode != 0
    if made:
        subprocess.run(["useradd", "-M", "-r", "-s", "/usr/sbin/nologin", BLESS_USER], check=True)
    try:
        _bless_user(books)
    finally:
        if made:
            subprocess.run(["userdel", BLESS_USER], check=False)


def _bless_user(books):
    home = Path(tempfile.mkdtemp(prefix="bless-user-"))
    out = home / "out"
    out.mkdir()
    for d in (home, out):
        os.chmod(d, 0o777)
    bins = test_bins(tests_of(books))
    for t in tests_of(books):
        env = ["env", f"HOME={home}", f"USER={BLESS_USER}", f"LOGNAME={BLESS_USER}", "TPA_BLESS=1", f"TPA_BAKE_OUT={out}", f"TPA_PYTHON={shutil.which('python3')}", "PYTHONDONTWRITEBYTECODE=1"]
        r = subprocess.run(["runuser", "-u", BLESS_USER, "--"] + env + [bins[t], "--test-threads=1"], cwd=DESKTOP, capture_output=True, text=True)
        sys.stderr.write(r.stderr[-3000:])
        if r.returncode:
            sys.exit(f"{t}: root でない利用者で止まりました")
    for b in books:
        for p in files_of(b):
            if (out / p.name).exists():
                shutil.copyfile(out / p.name, p)
                n = len(json.loads(p.read_text(encoding="utf-8")).get("variants", {}).get("user", {}))
                print(f"{p.stem}: root でない利用者で違う歩 {n}")
    shutil.rmtree(home, ignore_errors=True)


FORMS = {"python": "Python と比べる形（その PC の Python が場面を作る）", "table": "表だけの形（TPA_NO_PYTHON=1。表の宣言から場面を作る。段 ④ の後の形）"}
JSON_LINE = "measure-json| "


def expected_tables(skip=()):
    """測りの記録があるはずの表（焼いた表の全部から、試験を全部 skip した本の表を除く）。skip は流さなかった試験（--skip-test）"""
    return sorted(n for n, b in tables().items() if not all(t in skip for t in BOOKS.get(b, {}).get("tests", [])))


def measured(folders, as_json=False, skip=()):
    """測るだけの仕事の記録（desktop/tests/common/bake.rs が TPA_MEASURE のフォルダに書いた <表>.json）のまとめ。落とさない。
    フォルダは流した形ごと（記録の form: python・table）。形ごとに別の行で出す（版 3.117.0）。
    焼いた表の一覧と比べ、記録の無い表（段が上限で切れた・試験が Bake を開く前に落ちた）を名前で出す（版 3.117.0 の作った後の直し・割れ 3。
    skip は流さなかった試験〈--skip-test〉で、その試験だけが焼く本の表は数えない）"""
    want = expected_tables(skip)
    for folder in folders:
        files = sorted(Path(folder).glob("*.json")) if Path(folder).is_dir() else []
        if not files:
            print(f"測りの記録がありません（{folder}）。焼いた本の試験が TPA_MEASURE つきで流れていません（記録の無い表 {len(want)}）")
            continue
        absent = [n for n in want if n not in {f.stem for f in files}]
        steps = differ = unanswered = 0
        noscene, cut_short, forms = [], [], set()
        rows = []
        for f in files:
            try:
                m = json.loads(f.read_text(encoding="utf-8"))
            except ValueError as e:
                rows.append(f"{f.stem}: 記録が読めません（{e}）")
                continue
            forms.add(m.get("form", "python"))
            d = m.get("differing", [])
            steps += m.get("steps", 0)
            differ += len(d)
            unanswered += len(m.get("missing", []))
            keys = {}
            for x in d:
                k = re.split(r"[.\[]", x.get("diff", "").split(":")[0])[-1].rstrip("]") or "?"
                keys[k] = keys.get(k, 0) + 1
            top = " ".join(f"{k}×{n}" for k, n in sorted(keys.items(), key=lambda kv: -kv[1])[:8])
            extra = "".join(f"・{name} が違う" for name in ("oracle", "scene") if m.get(name))
            if m.get("sceneError"):
                noscene.append(f.stem)
                extra += "・場面を作れなかった"
            if m.get("finished") is False:
                cut_short.append(f.stem)
                extra += "・終わりまで流れなかった（そこまでの歩の数）"
            rows.append(f"{f.stem}（{m.get('os', '?')}）: 歩 {m.get('steps', 0)}・表と違う歩 {len(d)}・表にあって答えない歩 {len(m.get('missing', []))}{extra}"
                        + (f"・違う葉の鍵 {top}" if top else ""))
            for name in ("sceneError", "scene", "oracle"):
                if m.get(name):
                    rows.append(f"    {name}: {str(m[name])[:300]}")
            for x in d[:3]:
                rows.append(f"    {x.get('key', '')}（{x.get('route', '')}）: {x.get('diff', '')[:300]}")
        form = " / ".join(FORMS.get(x, x) for x in sorted(forms)) or "?"
        print(f"== {form}（{folder}）")
        print("\n".join(rows))
        print(f"計（{form}）: 表 {len(files)} つ・歩 {steps}・焼いた表（posix）と違う歩 {differ}・表にあって答えない歩 {unanswered}"
              f"・場面を作れなかった表 {len(noscene)}" + (f"（{' '.join(noscene)}）" if noscene else "")
              + f"・終わりまで流れなかった表 {len(cut_short)}" + (f"（{' '.join(cut_short)}）" if cut_short else "")
              + f"・記録の無い表 {len(absent)}" + (f"（{' '.join(absent)}）" if absent else "")
              + "（違う歩が 0 の表は Windows でもそのまま表と比べられる。記録の無い表は数に入っていない）")
    if as_json:
        # 記録そのもの（1 表 1 行）。成果物の置き場に届かない所からでも、仕事の記録（log）から --from-log で戻せる
        for folder in folders:
            for f in sorted(Path(folder).glob("*.json")) if Path(folder).is_dir() else []:
                try:
                    m = json.loads(f.read_text(encoding="utf-8"))
                except ValueError:
                    continue
                print(JSON_LINE + json.dumps(m, ensure_ascii=True, separators=(",", ":")))


def from_log(log, out):
    """仕事の記録（--measured … --json の行）から、測りの記録を <out>/<形>/<表>.json に戻す → (戻した数, 読めなかった行の数)
    （版 3.117.0 の作った後の直し・割れ 3: 前は読めない行〈切れた・壊れた〉を数えずに飛ばした）"""
    n = bad = 0
    for line in Path(log).read_text(encoding="utf-8", errors="replace").splitlines():
        i = line.find(JSON_LINE)
        if i < 0:
            continue
        try:
            m = json.loads(line[i + len(JSON_LINE):])
            if not isinstance(m, dict) or not isinstance(m.get("file"), str):
                raise ValueError("file が無い")
        except ValueError:
            bad += 1
            continue
        d = Path(out) / m.get("form", "python")
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{m['file']}.json").write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
        n += 1
    return n, bad


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == "--check":
        bad = check()
        for line in bad:
            print("  ", line)
        if bad:
            sys.exit(1)
        for line in notices():
            print("  知らせ:", line)
        print(f"焼いた表は古くありません（{sum(1 for b in BOOKS if baked(b))} 本・{len(tables())} ファイル）")
        return
    skip = []
    if "--skip-test" in args:
        i = args.index("--skip-test")
        skip = [x for x in args[i + 1].split(",") if x]
        del args[i:i + 2]
    if args[0] == "--measured":
        measured([a for a in args[1:] if not a.startswith("--")] or [""], "--json" in args, skip)
        return
    if args[0] == "--from-log":
        n, bad = from_log(args[1], args[2])
        print(f"測りの記録 {n} 個を {args[2]} に戻しました" + (f"（読めなかった行 {bad}）" if bad else "・読めなかった行 0"))
        return
    if args[0] == "--stats":
        stats(args[args.index("--base") + 1] if "--base" in args else None)
        return
    books = [b for b in BOOKS if baked(b)] if "--all" in args else [a for a in args if not a.startswith("--")]
    if args[0] == "--scope":
        scope, books = args[1], args[2:]
        sys.exit(cargo(tests_of(books), {"TPA_NO_PYTHON": "1", "TPA_BLESS": scope}))
    unknown = [b for b in books if b not in BOOKS or not baked(b)]
    if unknown:
        sys.exit(f"焼く本ではありません: {unknown}")
    if "--user" in args:
        bless_user(books)
    elif "--no-python" in args:
        # Python 無し＝program/app を使わない形（独立の答え tools/*-truth.py の標準の Python は残す）。凍らせた Python を相手にする試験は流さず、
        # その名前を test result の数と別に出す（desktop/tests/common/bake.rs の frozen_python が target/tmp/frozen-skipped.txt に書く）
        skipped = Path(os.environ.get("CARGO_TARGET_DIR", DESKTOP / "target")) / "tmp" / "frozen-skipped.txt"
        skipped.unlink(missing_ok=True)
        rc = cargo([t for t in tests_of(books) if t not in skip], {"TPA_NO_PYTHON": "1"})
        # 1 行に 1 つ（窓の試験が 1 回の write で書く）。同じ名前は 1 本に数える
        names = list(dict.fromkeys(x.strip() for x in skipped.read_text(encoding="utf-8").splitlines() if x.strip())) if skipped.exists() else []
        print(f"流さなかった試験（凍らせた Python を相手にする） {len(names)} 本: " + " ".join(names))
        sys.exit(rc)
    else:
        bless(books)


if __name__ == "__main__":
    main()
