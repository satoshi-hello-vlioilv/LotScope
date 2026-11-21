# -*- coding: utf-8 -*-
"""CM3 に届かないときの言葉（版 3.117.1。段 ③-6 の採点の first_fixes 13。窓は desktop/src/cm3_net.rs が同じ言葉を出す）。

届かない理由を種類（kind）に分け、種類ごとに決めた言葉にする。種類を決める材料（Python の例外の型・OpenSSL の検証の番号と理由・
窓の OpenSSL の字・schannel の誤りの番号）と言葉は人が書いた事例の表 tests/fixtures/cm3_net_cases.json（Python は
tests/test_cm3_net_cases.py、窓は cargo test --test cm3_net_cases）。決め:
  - 時間切れは、つなぐ・プロキシの CONNECT・TLS の握手・答えを読む のどこでも同じ 1 つの言葉（前は urllib が「接続できません: timed out」と
    「応答がタイムアウト」に割れ、TLS の握手は Python の組み立ての行番号〈_ssl.c:NNN〉まで字に入った）
  - 名前が引けないは OS の字を使わない（前は PC の DNS で「Name or service not known」「Temporary failure in name resolution」に割れた）
  - TLS は 信頼できない発行元・名前が違う・TLS でない口 の 3 つと、そのほか（OpenSSL・schannel の字は出さない）
  - 届かない言葉の後ろに「社内 LAN か VPN につながっているか」を促す一言（利用者の決め 2026-11-17: CM3 は社内 LAN か VPN からだけ使う）
  - プロキシ越しにつなげない（断られた・名前を引けない）は「プロキシ（名前:番号）に届きません」、407（CONNECT の答えも HTTP の答えも）は
    「認証を求めています（対応していません）」（利用者の決め: プロキシに認証は無い）
  - 版 3.117.1 の作った後の直し（割れ 5・7）: プロキシの言葉はその問い合わせ（30x の行き先ごと）のプロキシで決め、プロキシへの TCP が
    つながる前の誤りだけを「届きません」（proxy_unreachable）、つながった後の OS の誤り（CONNECT の 200 の後・要求を送った後に切れた・
    答えずに閉じた）は「届きましたが、その先で接続が切れました」（proxy_cut）、CONNECT の答えが読めない（状態の行・見出しが長い・
    100 を超える）は「答えを読めません」（proxy_bad。前は窓が係を降り、Python は 500）。直の問い合わせの誤りはプロキシと言わない
"""
from __future__ import annotations

import socket
import ssl

HINT = "（社内 LAN か VPN につながっているか確かめてください）"
MESSAGES = {
    "timeout": "予定の元の応答がタイムアウトしました{hint}",
    "os": "予定の元に接続できません: {os}{hint}",
    "dns": "予定の元に接続できません: サーバーの名前を引けません{hint}",
    "tls_untrusted": "予定の元に接続できません: 証明書を確かめられません（信頼できる発行元の証明書ではありません）{hint}",
    "tls_name": "予定の元に接続できません: 証明書の名前が URL の名前と合いません{hint}",
    "tls_not": "予定の元に接続できません: https で答えない口です（URL の http と https を確かめてください）",
    "tls_other": "予定の元に接続できません: 暗号の通信（TLS）を始められません{hint}",
    "proxy_refused": "予定の元に接続できません: プロキシが中継を断りました（{status}）{hint}",
    "proxy_auth": "予定の元に接続できません: プロキシが認証を求めています（このアプリは認証つきのプロキシに対応していません）",
    "proxy_unreachable": "予定の元に接続できません: プロキシ（{proxy}）に届きません{hint}",
    "proxy_cut": "予定の元に接続できません: プロキシ（{proxy}）には届きましたが、その先で接続が切れました{hint}",
    "proxy_bad": "予定の元に接続できません: プロキシ（{proxy}）の答えを読めません{hint}",
    "text": "予定の元に接続できません: {text}",
}
# 足す一言（PAC）を付ける種類（届かない形。設定の誤り text・https でない口 tls_not には付けない）
REACH = {"timeout", "os", "dns", "tls_untrusted", "tls_name", "tls_other", "proxy_refused", "proxy_unreachable", "proxy_cut", "proxy_bad"}

# OpenSSL の検証の番号（X509_V_ERR_*）→ 種類（決めは事例の表の verify の節。窓の Linux は cm3_net.rs の OPENSSL_VERIFY の字で同じ種類）
VERIFY_UNTRUSTED = {2, 18, 19, 20, 21, 27, 29, 30, 79}
VERIFY_NAME = {62, 63, 64}
# OpenSSL の理由（SSLError.reason）→ TLS でない口（平文の答えを TLS の記録として読んだ）
REASON_NOT_TLS = {"WRONG_VERSION_NUMBER", "RECORD_LAYER_FAILURE", "PACKET_LENGTH_TOO_LONG", "HTTP_REQUEST", "UNKNOWN_PROTOCOL"}
TUNNEL = "Tunnel connection failed: "


class ProxyBadAnswer(OSError):
    """プロキシの CONNECT の答えが読めない（http.client の _tunnel が HTTPException で落ちた。cm3_schedule の接続が包む）"""


def kind_of(reason):
    """urllib の URLError.reason（か fetch の途中の例外）→ (種類, 中身)"""
    if isinstance(reason, str):
        return "text", reason
    if isinstance(reason, ProxyBadAnswer):
        return "proxy_bad", ""
    if isinstance(reason, TimeoutError):
        return "timeout", ""
    if isinstance(reason, ssl.SSLCertVerificationError):
        code = getattr(reason, "verify_code", None)
        if code in VERIFY_UNTRUSTED:
            return "tls_untrusted", ""
        if code in VERIFY_NAME:
            return "tls_name", ""
        return "tls_other", ""
    if isinstance(reason, ssl.SSLError):
        return ("tls_not" if getattr(reason, "reason", None) in REASON_NOT_TLS else "tls_other"), ""
    if isinstance(reason, socket.gaierror):
        return "dns", ""
    text = str(reason)
    if isinstance(reason, OSError) and text.startswith(TUNNEL):
        status = text[len(TUNNEL):]
        return ("proxy_auth", "") if status.split(" ", 1)[0] == "407" else ("proxy_refused", status)
    return "os", text


def message(kind, detail="", note=""):
    """種類 → 言葉。note は届かない形の後ろに足す一言（PAC）"""
    tpl = MESSAGES[kind]
    text = tpl.format(hint=HINT, os=detail, status=detail, text=detail, proxy=detail)
    return text + (note if kind in REACH else "")


def message_of(reason, note="", proxy=None, connected=False):
    """proxy: その問い合わせ（30x の行き先ごと）のプロキシ（名前:番号。直は None）。connected: プロキシへの TCP がつながったか。
    つながる前の OS の誤り・名前を引けないは「プロキシに届きません」、つながった後の OS の誤りは「その先で切れました」"""
    kind, detail = kind_of(reason)
    if proxy:
        if kind in ("os", "dns") and not connected:
            kind, detail = "proxy_unreachable", proxy
        elif kind == "os" or (connected and isinstance(reason, ssl.SSLEOFError)):
            # つながった後に切れた（TLS の握手の途中で相手が閉じた形も。窓は OpenSSL・schannel の「unexpected eof」の字）
            kind, detail = "proxy_cut", proxy
        elif kind == "proxy_bad":
            detail = proxy
    return message(kind, detail, note=note)
