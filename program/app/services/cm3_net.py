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
"""
from __future__ import annotations

import socket
import ssl

HINT = "（社内 LAN か VPN につながっているか確かめてください）"
MESSAGES = {
    "timeout": "CM3の応答がタイムアウトしました{hint}",
    "os": "CM3に接続できません: {os}{hint}",
    "dns": "CM3に接続できません: サーバーの名前を引けません{hint}",
    "tls_untrusted": "CM3に接続できません: 証明書を確かめられません（信頼できる発行元の証明書ではありません）{hint}",
    "tls_name": "CM3に接続できません: 証明書の名前が URL の名前と合いません{hint}",
    "tls_not": "CM3に接続できません: https で答えない口です（URL の http と https を確かめてください）",
    "tls_other": "CM3に接続できません: 暗号の通信（TLS）を始められません{hint}",
    "proxy_refused": "CM3に接続できません: プロキシが中継を断りました（{status}）{hint}",
    "text": "CM3に接続できません: {text}",
}
# 足す一言（PAC）を付ける種類（届かない形。設定の誤り text・https でない口 tls_not には付けない）
REACH = {"timeout", "os", "dns", "tls_untrusted", "tls_name", "tls_other", "proxy_refused"}

# OpenSSL の検証の番号（X509_V_ERR_*）→ 種類
VERIFY_UNTRUSTED = {2, 18, 19, 20, 21, 27, 29, 30, 79}
VERIFY_NAME = {62, 63, 64}
# OpenSSL の理由（SSLError.reason）→ TLS でない口（平文の答えを TLS の記録として読んだ）
REASON_NOT_TLS = {"WRONG_VERSION_NUMBER", "RECORD_LAYER_FAILURE", "PACKET_LENGTH_TOO_LONG", "HTTP_REQUEST", "UNKNOWN_PROTOCOL"}
TUNNEL = "Tunnel connection failed: "


def kind_of(reason):
    """urllib の URLError.reason（か fetch の途中の例外）→ (種類, 中身)"""
    if isinstance(reason, str):
        return "text", reason
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
        return "proxy_refused", text[len(TUNNEL):]
    return "os", text


def message(kind, detail="", note=""):
    """種類 → 言葉。note は届かない形の後ろに足す一言（PAC）"""
    tpl = MESSAGES[kind]
    text = tpl.format(hint=HINT, os=detail, status=detail, text=detail)
    return text + (note if kind in REACH else "")


def message_of(reason, note=""):
    return message(*kind_of(reason), note=note)
