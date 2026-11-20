# -*- coding: utf-8 -*-
"""CM3 へのシステムのプロキシ（版 3.117.1。段 ③-6。窓は desktop/src/sysproxy.rs が同じ決めで読む）。

読み方は Python の urllib と同じ（利用者の決め 2026-11-17: プロキシは Windows の設定と環境変数から読む・認証は無い・PAC と自動検出は読まない）:
  getproxies()   … 環境変数（<種類>_proxy。小文字が勝つ・空の値は消す・REQUEST_METHOD があれば HTTP_PROXY を捨てる）。
                   1 つも無ければ Windows は HKCU の Internet Settings（ProxyEnable・ProxyServer）
  proxy_bypass() … 環境変数のプロキシが 1 つでもあれば no_proxy（後ろ一致・* はすべて）、無ければ Windows の ProxyOverride（; 区切り・<local>・
                   * ? [ ] の型。Windows は大文字小文字を区別しない）。30x のたびに行き先の名前で決め直す（urllib の ProxyHandler と同じ）
urllib と違えた所（人の決め。事例の表 tests/fixtures/sysproxy_cases.json の decisions）:
  - プロキシの URL の 利用者:合言葉 は送らない（Proxy-Authorization を付けない。窓も送らない）
  - https:// と書いたプロキシも http のプロキシとして使う（TLS でプロキシにはつながない。Windows の既定の種類と同じ）
  - socks などほかの種類と、読めないプロキシの URL は、取りに行く前に理由を言って断る（urllib は「unknown url type」か ValueError の 500）
  - ProxyEnable が 0 で AutoConfigURL があるときは、届かない言葉に「プロキシの自動設定（PAC）には対応していません」を足す
"""
from __future__ import annotations

import os
import re
import urllib.parse
import urllib.request

KEY = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"
PAC_NOTE = "（プロキシの自動設定〈PAC〉には対応していません）"


class ProxyProblem(Exception):
    """使えないプロキシの設定（理由は利用者に見せる言葉）"""


def getproxies():
    """urllib.request.getproxies() のまま（環境変数 → Windows の設定）"""
    return urllib.request.getproxies()


def proxy_bypass(host):
    """urllib.request.proxy_bypass(host) のまま"""
    return urllib.request.proxy_bypass(host)


def unreadable(url_type):
    """読めないプロキシの言葉（値は出さない: 合言葉が入っているかもしれない）"""
    return ProxyProblem(f"CM3に接続できません: {url_type} のプロキシの設定を読めません")


def parse(value, url_type=""):
    """プロキシの URL → (種類, 利用者, 合言葉, 名前:番号)。読めなければ ProxyProblem（urllib の _parse_proxy と同じ読み方）"""
    try:
        return urllib.request._parse_proxy(value)
    except ValueError:
        raise unreadable(url_type) from None


def clean(proxies):
    """ProxyHandler に渡す形: 利用者:合言葉 を外し、https:// は http:// に、読めない値と使えない種類は除く（取りに行く前の check が断る）"""
    out = {}
    for kind, value in proxies.items():
        try:
            scheme, _user, _pw, hostport = parse(value)
        except ProxyProblem:
            continue
        scheme = (scheme or "").lower()
        if scheme in ("", "http", "https"):
            out[kind] = f"http://{hostport}" if scheme else hostport
    return out


def choose(url_type, host, proxies, bypass=proxy_bypass):
    """1 回の問い合わせのプロキシ（urllib の ProxyHandler.proxy_open と同じ選び方）→ 名前:番号 か None（直）。使えない形は ProxyProblem。
    url_type: 'http'・'https'。host: URL の名前:番号（req.host）。種類の名前は小文字にして比べ、後ろの物が勝つ（ProxyHandler の setattr）"""
    value = None
    for k, v in proxies.items():
        if k.lower() == url_type:
            value = v
    if value is None:
        return None
    scheme, _user, _pw, hostport = parse(value, url_type)
    if host and bypass(host):
        return None
    scheme = (scheme or "").lower()
    if scheme not in ("", "http", "https"):
        raise ProxyProblem(f"CM3に接続できません: プロキシの種類 {scheme} には対応していません（http のプロキシだけを使えます）")
    hostport = urllib.parse.unquote(hostport)
    # 名前と番号（http.client の _get_hostport が落ちる形〈数字でない番号・65535 を超える番号・名前が空〉は読めない設定）
    name, port = hostport, ""
    i, j = hostport.rfind(":"), hostport.rfind("]")
    if i > j:
        name, port = hostport[:i], hostport[i + 1:]
    if not name.strip("[]") or (port and not (port.isascii() and port.isdigit() and int(port) <= 65535)):
        raise unreadable(url_type)
    return hostport


def pac_of(nt, env_proxies, reg):
    """PAC の一言の決め（純粋な関数。事例の表 sysproxy_cases.json の pac）。reg: {"ProxyEnable": 値, "AutoConfigURL": 値}（無い値は書かない）か None"""
    if not nt or env_proxies or reg is None:
        return ""
    enable = reg.get("ProxyEnable") or 0
    pac = str(reg.get("AutoConfigURL") or "").strip()
    return PAC_NOTE if (not enable and pac) else ""


def pac_note():
    """ProxyEnable が 0 で AutoConfigURL があれば PAC_NOTE、ほかは ""（Windows だけ。環境変数のプロキシがあれば読まない）"""
    if os.name != "nt":
        return ""
    reg = {}
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, KEY) as k:
            for name in ("ProxyEnable", "AutoConfigURL"):
                try:
                    reg[name] = winreg.QueryValueEx(k, name)[0]
                except OSError:
                    pass
    except (OSError, ImportError):
        reg = None
    return pac_of(True, urllib.request.getproxies_environment(), reg)


def url_type_host(url):
    """URL → (種類の小文字, 名前:番号)（urllib の Request と同じ分け方）"""
    m = re.match(r"([^/:]+):(.*)", url, re.DOTALL)
    if not m:
        return "", ""
    rest = m.group(2)
    host = ""
    if rest.startswith("//"):
        host = re.match(r"//([^/#?]*)", rest).group(1)
    return m.group(1).lower(), urllib.parse.unquote(host)
