# -*- coding: utf-8 -*-
"""組む所の読みの本（desktop/tests/builder_parity.rs）の作り物の CM3 とプロキシ（版 3.117.1 の作った後の直し・割れ 2。標準の部品だけ。app を import しない）。

参照先・データ元の「確かめる」（CM3 に届くか）が問い合わせる相手: どの道にも 404 を答える CM3 の http（cm3）・作り物の CA の証明書の https（cm3tls）・
信頼しない CA の https（cm3bad）と、プロキシ（中継 relay・CONNECT を 403 で断る deny・407 で認証を求める auth）。
起こすのは tests/fakes_serve.py（python tests/fakes_serve.py builder）と、前の版の答え合わせ役 builder。https は
tests/fixtures/tls の作り物の証明書（試験は SSL_CERT_FILE で作り物の CA を信頼させる。Windows の CI は LocalMachine\\Root に入れる）。
"""
import fakes_schedule  # （標準の部品だけ）
import schedule_fixture as fx  # （標準の部品だけ）


def _404(scene, req, k):
    return fx.reply(404, "Not Found", b"", [])


def start():
    cm3 = fx.Cm3Server(_404)
    tls = fx.Cm3Server(_404, tls=fakes_schedule.tls_files("server"), share=cm3)
    bad = fx.Cm3Server(_404, tls=fakes_schedule.tls_files("untrusted"), share=cm3)
    proxies = {"relay": fakes_schedule.Proxy("relay"), "deny": fakes_schedule.Proxy("deny"), "auth": fakes_schedule.Proxy("auth")}

    def close():
        for x in (cm3, tls, bad, *proxies.values()):
            x.close()
    urls = {"cm3": cm3.url, "cm3tls": tls.url, "cm3bad": bad.url, **{k: p.url for k, p in proxies.items()}}
    return {"urls": urls, "close": close, "ask": None}
