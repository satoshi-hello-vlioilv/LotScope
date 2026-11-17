# -*- coding: utf-8 -*-
r"""道の字の門（版 3.114.0。Rust 化の段 ③ の 3 つ目）。窓（desktop/src/path_gate.rs）も同じ決まりを 1 か所に持つ。

道を受ける欄（ROUTES: 「参照…」の path・配布の置き場の name・parent・from・マスタの置き場の name・parent）の字を、道の頭で 1 回決める:
通す・整えて通す・理由つきで断る。門を通った字だけが各道の部品（folder_browse・release_place・master_place）へ届くので、部品は OS の
珍しい形（NUL・長すぎる名前・~名前・file: の [ ]・装置の道・Win32 の末尾の整え・ドライブ相対）を考えなくてよい。

決め（事例の表 tests/fixtures/ospath_cases.json に形 × OS〈posix・nt〉ごとに want と、版 3.113.0 の Python の答え py を書いた。
窓と Python が同じ表を読む: desktop/tests/ospath_cases.rs・tests/test_ospath_cases.py）:

- 制御文字: NUL はどの OS でも断る（道に置けない）。U+0001〜U+001F は Windows では断り（名前に使えない）、Linux では通す（名前の字）
- 装置の道: \\?\X:\… は X:\…、\\?\UNC\サーバー\共有\… は \\サーバー\共有\… に書き直して通す（Windows の Python が今開ける形を
  後戻りさせない）。その後ろに「.」「..」・最後が空白か「.」の名前があれば断る（書き直すと Win32 が削って別のフォルダを指す）。
  \\.\…・\\?\Volume{…}・\\?\GLOBALROOT など、そのほかの装置の道は断る。POSIX では \ の形だけを装置の道と読む（// は POSIX の道）
- ~ と ~名前（「参照…」だけ）: Python 3.13 の os.path.expanduser と同じ。Windows は ~ が USERPROFILE、~名前 は USERNAME と
  basename(USERPROFILE) が同じときだけ dirname(USERPROFILE)＋名前（違えば字のまま。相対の道として「ドライブ…から」と断られる）。
  POSIX は利用者の表（窓は /etc/passwd を読む。NSS だけの利用者は窓では字のまま: 開発用の差）
- file: の URL: サーバー名に [ ] があれば、ちょうど [IPv6] の形だけを Microsoft の IPv6 の UNC（0--1.ipv6-literal.net）に書き直す。
  閉じない [ ・IP でない [zz]・ゾーン ID（%）・口の番号・IPv4 の書き方は断る（前は Python が 500）。ASCII でないサーバー名は、
  NFKC で区切りの字（/ ? # @ :）が出てくるときだけ断る（Python の urlsplit が ValueError にする形）
- ドライブ（Windows・欄の道だけ）: C: は C:\、C:x（ドライブ相対）は断る（プロセスごとの今のフォルダを混ぜない）
- 長さ: 名前（段）ごとに POSIX は UTF-8 の 255 バイト、Windows は UTF-16 の 255 単位。POSIX は道全体も 4096 バイト未満
  （前は Python の Path.is_dir が ENAMETOOLONG で 500）。Windows の MAX_PATH（260）を超える道全体の長さは、この版では決めない
- Win32 の段の末尾の整え（Windows だけ）: 段が空白か「.」で終わる道は、GetFullPathNameW（Python の nt._getfullpathname と同じ関数）で
  整えた字にする。手で書かない（Windows の CI で事例ごとに want と比べる）。相対の道は今のフォルダ（cwd）につないでから整える

門は道の頭（欄の字）だけに当て、保存済みの置き場の読み（束・master_share.json・引っ越しの印）には当てない。
"""
from __future__ import annotations

import ipaddress
import ntpath
import os
import posixpath
import re
import unicodedata

try:
    from nt import _getfullpathname as _FULL     # Windows だけ（GetFullPathNameW）
except ImportError:                              # pragma: no cover - POSIX
    _FULL = None


class PathRefused(ValueError):
    """欄の字を道の門が断った（str は画面に出す理由）"""


E_CTRL = "道に使えない字（制御文字）があります。"
E_DEVICE = "装置の道（\\\\.\\… など）は使えません。C:\\… か \\\\サーバー\\共有\\… で書いてください。"
E_DEVICE_TRIM = ("装置の道（\\\\?\\…）の中に「.」「..」や、最後が空白か「.」の名前があります。"
                 "C:\\… か \\\\サーバー\\共有\\… で書いてください。")
E_DRIVE_REL = "ドライブの根（C:\\…）から書いてください。"
E_LONG_POSIX = "フォルダの名前が長すぎます（この PC の上限 255 バイト）。"
E_LONG_NT = "フォルダの名前が長すぎます（この PC の上限 255 字）。"
E_PATH_POSIX = "道が長すぎます（この PC の上限 4096 バイト）。"
E_URL_BRACKET = "file: の URL が読めません（サーバー名の [ ]）。"
E_URL_HOST = "file: の URL のサーバー名に使えない字があります。"
E_FULL = "道を整えられません（Windows が読めない形）。"

NAME_BYTES = 255           # POSIX の NAME_MAX（UTF-8 のバイト）
NAME_UNITS = 255           # NTFS の名前の上限（UTF-16 の単位）
PATH_BYTES = 4096          # POSIX の PATH_MAX（終わりの NUL を含む）

# 道を受ける欄（道の型 → [(欄, 種類)]。見る順もこの並び〈名前 → 上のフォルダ → いまの置き場: plan が先に見る順〉）。
# 窓へは tools/path-routes.py が desktop/src/path_routes.json に焼く（tests/test_path_routes.py が古い表と表に無い道を止める）
_RELEASE = (("name", "name"), ("parent", "dir"), ("from", "dir"))
_MASTER = (("name", "name"), ("parent", "dir"))
ROUTES = {
    ("POST", "/api/fs/browse"): (("path", "browse"),),
    ("POST", "/api/release/place/check"): _RELEASE,
    ("POST", "/api/release/place/move"): _RELEASE,
    ("POST", "/api/masters/place/check"): _MASTER,
    ("POST", "/api/masters/place/move"): _MASTER,
}
# 道の字を受けるが、この版では門を当てない道（理由）
SKIP = {
    ("POST", "/api/settings/check"): "参照先の値の読み方（空・既定・項目ごとの parse）と確かめる順を変えない（束と参照先の読みの順は page_parity・"
                                     "settings_write_parity が見る）。次の版で項目の種類ごとに決める",
    ("PUT", "/api/settings/<path:key>"): "同上（保存する値は path_settings.parse が読む。保存済みの値の読みには門を当てない）",
    ("PUT", "/api/sources/<key>/conn"): "データ元の接続の欄は参照先の項目と同じ読み（path_settings.parse）。参照先と一緒に決める",
    ("POST", "/api/sources/<key>/conn/check"): "同上（確かめるは参照先の settings/check と同じ入口 check_entry）",
}
# 道の字を受ける部品（試験 tests/test_path_routes.py が、これを呼ぶ道は ROUTES か SKIP に決めてあるかを見る）
CONSUMERS = ("folder_browse.browse", "release_place.plan", "master_place.plan", "master_place.move", "path_settings.parse",
             "path_settings.check")


def fields_of(method: str, rule: str):
    return ROUTES.get((method, rule), ())


# ---------------------------------------------------------------- 小さな部品

def _ctrl(s: str, nt: bool):
    if "\x00" in s or (nt and any(ord(c) < 32 for c in s)):
        raise PathRefused(E_CTRL)


def _drive(s: str) -> bool:
    return len(s) >= 2 and s[1] == ":" and s[0].isascii() and s[0].isalpha()


def _absolute(s: str, nt: bool) -> bool:
    """ドライブ＋根か、共有（\\\\…）か（Windows）。POSIX は / から"""
    if not nt:
        return s.startswith("/")
    t = s.replace("/", "\\")
    return t.startswith("\\\\") or (_drive(t) and t[2:3] == "\\")


def device(s: str, nt: bool) -> str:
    r"""装置の道（\\?\・\\.\）→ ふつうの形に書き直すか、断る（PathRefused）。装置の道でなければそのまま"""
    t = s.replace("/", "\\") if nt else s
    if t.startswith("\\\\.\\"):
        raise PathRefused(E_DEVICE)
    if not t.startswith("\\\\?\\"):
        return s
    rest = t[4:]
    if rest[:4].upper() == "UNC\\":
        new, body = "\\\\" + rest[4:], rest[4:]
        parts = body.split("\\")[2:]       # サーバー・共有の後ろ
    elif _drive(rest) and (len(rest) == 2 or rest[2] == "\\"):
        new, body = rest[:2] + "\\" + rest[3:], rest[3:]
        parts = body.split("\\")
    else:
        raise PathRefused(E_DEVICE)
    if any(p in (".", "..") or (p and p[-1] in " .") for p in parts):
        raise PathRefused(E_DEVICE_TRIM)
    return new


def _seps(nt):
    return "\\/" if nt else "/"


def _lengths(s: str, nt: bool, name_only=False):
    parts = [s] if name_only else re.split("[\\\\/]" if nt else "/", s)
    for p in parts:
        n = len(p.encode("utf-16-le", "surrogatepass")) // 2 if nt else len(p.encode("utf-8", "surrogatepass"))
        if n > (NAME_UNITS if nt else NAME_BYTES):
            raise PathRefused(E_LONG_NT if nt else E_LONG_POSIX)
    if not nt and not name_only and len(s.encode("utf-8", "surrogatepass")) >= PATH_BYTES:
        raise PathRefused(E_PATH_POSIX)


def trims(s: str) -> bool:
    """Win32 が整える段がある（段が空白か「.」で終わる。「.」「..」と、共有の根〈\\\\サーバー\\共有〉の 2 段は除く: Win32 も整えない）"""
    parts = re.split(r"[\\/]", s)
    if s[:2] in ("\\\\", "//"):
        parts = parts[4:]
    return any(p not in (".", "..") and p[-1:] in (" ", ".") for p in parts)


def nt_join(a: str, b: str) -> str:
    """ntpath.join(a, b)（Python 3.13。窓の path_gate::nt_join と同じ）"""
    return ntpath.join(a, b)


def _full(s: str, cwd: str, full) -> str:
    """Win32 の整え（GetFullPathNameW）。相対の道は cwd につないでから"""
    if full is None:
        raise PathRefused(E_FULL)
    p = s if _absolute(s, True) else nt_join(cwd, s)
    try:
        return full(p)
    except (OSError, ValueError):
        raise PathRefused(E_FULL) from None


# ---------------------------------------------------------------- ~ と ~名前

def expanduser(s: str, nt: bool, env, passwd) -> str:
    """os.path.expanduser（Python 3.13）。env は環境変数（表）、passwd は名前 → 家（None は今の利用者。無ければ None）"""
    if not s.startswith("~"):
        return s
    if nt:
        i, n = 1, len(s)
        while i < n and s[i] not in "\\/":
            i += 1
        if "USERPROFILE" in env:
            home = env["USERPROFILE"]
        elif "HOMEPATH" not in env:
            return s
        else:
            home = ntpath.join(env.get("HOMEDRIVE", ""), env["HOMEPATH"])
        if i != 1:
            target, current = s[1:i], env.get("USERNAME")
            if target != current:
                if current != ntpath.basename(home):
                    return s
                home = ntpath.join(ntpath.dirname(home), target)
        return home + s[i:]
    i = s.find("/", 1)
    if i < 0:
        i = len(s)
    if i == 1:
        home = env["HOME"] if "HOME" in env else passwd(None)
    else:
        home = passwd(s[1:i])
    if home is None:
        return s
    home = home.rstrip("/")
    return (home + s[i:]) or "/"


def _passwd(name):
    try:
        import pwd
    except ImportError:          # pragma: no cover - Windows
        return None
    try:
        return pwd.getpwuid(os.getuid()).pw_dir if name is None else pwd.getpwnam(name).pw_dir
    except KeyError:
        return None


# ---------------------------------------------------------------- file: の URL

_URL_DROP = ("\t", "\r", "\n")


def _ipv6_literal(addr: str) -> str:
    if "%" in addr or "." in addr:
        raise PathRefused(E_URL_BRACKET)
    try:
        text = ipaddress.IPv6Address(addr).compressed
    except ValueError:
        raise PathRefused(E_URL_BRACKET) from None
    if "." in text:
        raise PathRefused(E_URL_BRACKET)
    t = text.replace(":", "-")
    if t.startswith("-"):
        t = "0" + t
    if t.endswith("-"):
        t += "0"
    return t + ".ipv6-literal.net"


def _netloc_ok(netloc: str):
    """urllib.parse._checknetloc と同じ（NFKC で区切りの字が出てくる ASCII でないサーバー名は断る）"""
    if not netloc or netloc.isascii():
        return
    n = netloc.replace("@", "").replace(":", "").replace("#", "").replace("?", "")
    n2 = unicodedata.normalize("NFKC", n)
    if n != n2 and any(c in n2 for c in "/?#@:"):
        raise PathRefused(E_URL_HOST)


def _unquote(s: str) -> str:
    from urllib.parse import unquote
    return unquote(s)


def file_url(s: str) -> str:
    """file: の URL → 道（urllib.parse.urlparse と同じ切り方。サーバー名の [ ] は上の決め）"""
    u = s
    for c in _URL_DROP:
        u = u.replace(c, "")
    i = u.find(":")
    rest = u[i + 1:]
    netloc = ""
    if rest[:2] == "//":
        ends = [j for j in (rest.find(c, 2) for c in "/?#") if j >= 0]
        end = min(ends) if ends else len(rest)
        netloc, rest = rest[2:end], rest[end:]
        if "[" in netloc or "]" in netloc:
            m = re.fullmatch(r"\[([^\[\]@]*)\]", netloc)
            if not m:
                raise PathRefused(E_URL_BRACKET)
            netloc = _ipv6_literal(m.group(1))
    _netloc_ok(netloc)
    if "#" in rest:
        rest = rest.split("#", 1)[0]
    if "?" in rest:
        rest = rest.split("?", 1)[0]
    body = _unquote(rest)
    if netloc and netloc.lower() != "localhost":            # file://サーバー/共有/… → \\サーバー\共有\…
        return "\\\\" + netloc + body.replace("/", "\\")
    if len(body) > 2 and body[0] == "/" and body[2] == ":":  # file:///C:/… → C:\…
        return body[1:].replace("/", "\\")
    return body


# ---------------------------------------------------------------- 整え（「参照…」の字）

def drive_root(text: str) -> str:
    return text + "\\" if len(text) == 2 and _drive(text) else text


def tidy(s: str, nt: bool) -> str:
    r"""字の上で整えた道（folder_browse.tidy。nt は Windows の決まりか）"""
    if not s:
        return s
    unc = s.startswith("\\\\") or (nt and s.startswith("//"))     # POSIX の //tmp は POSIX の道
    if unc or _drive(s):
        out = ntpath.normpath(drive_root(s))
        return out if len(out) == 3 and out[1] == ":" else (out.rstrip("\\") or out)
    out = ntpath.normpath(s) if nt else posixpath.normpath(s)
    return out.rstrip("\\/") or out[:1]


# ---------------------------------------------------------------- 門

class Env:
    """門が読む PC の様子（nt: Windows の決まりか・env: 環境変数・passwd: 名前 → 家・cwd: 相対の道の見方・full: GetFullPathNameW）。
    事例の表は値を書いて渡す（CI の利用者名や今のフォルダに頼らない）"""

    def __init__(self, nt=None, env=None, passwd=None, cwd=None, full=None):
        self.nt = (os.name == "nt") if nt is None else nt
        self.env = os.environ if env is None else env
        self.passwd = _passwd if passwd is None else passwd
        self.cwd = os.getcwd() if cwd is None else cwd
        self.full = full if full is not None else (_FULL if self.nt else None)


def here() -> Env:
    """この PC の様子（環境変数・利用者の表・今のフォルダ・GetFullPathNameW）"""
    return Env()


def gate(kind: str, text, env: Env | None = None) -> str:
    """欄の字 → 門を通った字（PathRefused で断る）。kind: browse（「参照…」の欄: file: の URL・~・%VAR% を広げて整えた道）・
    dir（上のフォルダ・いまの置き場。書き直しが無ければ字のまま）・name（フォルダの名前。check_name を通る名前の長さだけ）"""
    e = env or here()
    nt = e.nt
    if kind == "name":
        from .release_place import check_name
        try:
            s = check_name(text)
        except ValueError:
            return text          # 名前の誤りは plan が check_name の言葉で答える
        _lengths(s, nt, name_only=True)
        return text
    if kind == "browse":
        from ..fsio import unquote_path
        s = unquote_path(str(text or "")).strip().strip("'")
        if s.lower().startswith("file:"):
            s = file_url(s)
        _ctrl(s, nt)
        s = device(s, nt)
        if s:
            s = (ntpath if nt else posixpath).expandvars(expanduser(s, nt, e.env, e.passwd))
        out = tidy(s, nt)
        _lengths(out, nt)
        if nt and _absolute(out, True) and trims(out):
            out = tidy(_full(out, e.cwd, e.full), nt)
        return out
    # dir
    from ..fsio import unquote_path
    raw = str(text or "")
    s = unquote_path(raw)
    if not s:
        return text
    _ctrl(s, nt)
    t = device(s, nt)
    if nt and _drive(t) and t[2:3] not in ("\\", "/"):
        if len(t) > 2:
            raise PathRefused(E_DRIVE_REL)
        t = t + "\\"
    _lengths(t, nt)
    if nt and trims(t):
        t = _full(t, e.cwd, e.full)
    return text if t == s else t


def stops(kind: str, text) -> bool:
    """この欄で門を止めるか: 道の部品が先に自分の言葉で答える欄（check_name が断る名前・空の上のフォルダ）。後ろの欄は見ない
    （plan が名前 → 上のフォルダ → いまの置き場の順に見るのと同じ順で、最初の誤りを答える）"""
    if kind == "name":
        from .release_place import check_name
        try:
            check_name(text)
        except ValueError:
            return True
        return False
    if kind == "dir":
        from ..fsio import unquote_path
        return not unquote_path(str(text or ""))
    return False


def apply(method: str, rule: str, values: dict, env: Env | None = None) -> dict:
    """道の欄（ROUTES）を表の順に門へ通す → 通った字の表。どれかが断られたら PathRefused（最初の理由）"""
    out = dict(values)
    for field, kind in fields_of(method, rule):
        if stops(kind, out.get(field, "")):
            break
        out[field] = gate(kind, out.get(field, ""), env)
    return out
