//! CM3 に届かないときの言葉（版 3.117.1。段 ③-6。Python の services/cm3_net.py と同じ言葉）。
//!
//! 届かない理由を種類（[`Kind`]）に分け、種類ごとに決めた言葉にする。種類を決める材料は、窓の TLS（Linux は OpenSSL の字、Windows は schannel の
//! 誤りの番号）と io の誤りの種類。決めと言葉は人が書いた事例の表 program/tests/fixtures/cm3_net_cases.json（cargo test --test cm3_net_cases・
//! Python は tests/test_cm3_net_cases.py）。

pub const HINT: &str = "（社内 LAN か VPN につながっているか確かめてください）";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Timeout,
    Os,
    Dns,
    TlsUntrusted,
    TlsName,
    TlsNot,
    TlsOther,
    ProxyRefused,
    ProxyAuth,
    ProxyUnreachable,
    Text,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Timeout => "timeout",
            Kind::Os => "os",
            Kind::Dns => "dns",
            Kind::TlsUntrusted => "tls_untrusted",
            Kind::TlsName => "tls_name",
            Kind::TlsNot => "tls_not",
            Kind::TlsOther => "tls_other",
            Kind::ProxyRefused => "proxy_refused",
            Kind::ProxyAuth => "proxy_auth",
            Kind::ProxyUnreachable => "proxy_unreachable",
            Kind::Text => "text",
        }
    }

    pub fn of_name(s: &str) -> Option<Kind> {
        [
            Kind::Timeout,
            Kind::Os,
            Kind::Dns,
            Kind::TlsUntrusted,
            Kind::TlsName,
            Kind::TlsNot,
            Kind::TlsOther,
            Kind::ProxyRefused,
            Kind::ProxyAuth,
            Kind::ProxyUnreachable,
            Kind::Text,
        ]
        .into_iter()
        .find(|k| k.name() == s)
    }

    /// 届かない形か（後ろに PAC の一言を足す）
    fn reach(self) -> bool {
        !matches!(self, Kind::Text | Kind::TlsNot | Kind::ProxyAuth)
    }
}

/// 種類 → 言葉（detail は os・proxy_refused・text の中身。note は届かない形に足す一言）
pub fn message(kind: Kind, detail: &str, note: &str) -> String {
    let body = match kind {
        Kind::Timeout => format!("CM3の応答がタイムアウトしました{HINT}"),
        Kind::Os => format!("CM3に接続できません: {detail}{HINT}"),
        Kind::Dns => format!("CM3に接続できません: サーバーの名前を引けません{HINT}"),
        Kind::TlsUntrusted => format!("CM3に接続できません: 証明書を確かめられません（信頼できる発行元の証明書ではありません）{HINT}"),
        Kind::TlsName => format!("CM3に接続できません: 証明書の名前が URL の名前と合いません{HINT}"),
        Kind::TlsNot => "CM3に接続できません: https で答えない口です（URL の http と https を確かめてください）".to_string(),
        Kind::TlsOther => format!("CM3に接続できません: 暗号の通信（TLS）を始められません{HINT}"),
        Kind::ProxyRefused => format!("CM3に接続できません: プロキシが中継を断りました（{detail}）{HINT}"),
        Kind::ProxyAuth => {
            "CM3に接続できません: プロキシが認証を求めています（このアプリは認証つきのプロキシに対応していません）".to_string()
        }
        Kind::ProxyUnreachable => format!("CM3に接続できません: プロキシ（{detail}）に届きません{HINT}"),
        Kind::Text => format!("CM3に接続できません: {detail}"),
    };
    if kind.reach() {
        format!("{body}{note}")
    } else {
        body
    }
}

/// OpenSSL の検証の結果の字（X509_verify_cert_error_string。native-tls の誤りの字の末尾の「(…)」）→ 種類
const OPENSSL_VERIFY: [(&str, Kind); 9] = [
    ("unable to get local issuer certificate", Kind::TlsUntrusted),
    ("self-signed certificate in certificate chain", Kind::TlsUntrusted),
    ("self signed certificate in certificate chain", Kind::TlsUntrusted),
    ("self-signed certificate", Kind::TlsUntrusted),
    ("self signed certificate", Kind::TlsUntrusted),
    ("unable to get issuer certificate", Kind::TlsUntrusted),
    ("unable to verify the first certificate", Kind::TlsUntrusted),
    ("hostname mismatch", Kind::TlsName),
    ("ip address mismatch", Kind::TlsName),
];

/// OpenSSL の理由の字（平文の答えを TLS の記録として読んだ）
const OPENSSL_NOT_TLS: [&str; 5] =
    ["wrong version number", "record layer failure", "packet length too long", "http request", "unknown protocol"];

/// Linux（OpenSSL）の TLS の誤りの字 → 種類
pub fn kind_of_openssl(text: &str) -> Kind {
    let t = text.to_lowercase();
    if let Some(open) = t.rfind(" (") {
        let tail = t[open + 2..].trim_end_matches(')');
        if let Some((_, k)) = OPENSSL_VERIFY.iter().find(|(s, _)| tail == *s) {
            return *k;
        }
    }
    if OPENSSL_NOT_TLS.iter().any(|s| t.contains(s)) {
        return Kind::TlsNot;
    }
    Kind::TlsOther
}

/// schannel の誤りの番号（HRESULT を u32 で）→ 種類
pub const SCHANNEL: [(u32, Kind); 10] = [
    (0x800B_0109, Kind::TlsUntrusted), // CERT_E_UNTRUSTEDROOT
    (0x8009_0325, Kind::TlsUntrusted), // SEC_E_UNTRUSTED_ROOT
    (0x800B_010A, Kind::TlsUntrusted), // CERT_E_CHAINING
    (0x8009_2012, Kind::TlsOther),     // CRYPT_E_NO_REVOCATION_CHECK
    (0x800B_010F, Kind::TlsName),      // CERT_E_CN_NO_MATCH
    (0x8009_0322, Kind::TlsName),      // SEC_E_WRONG_PRINCIPAL
    (0x8009_0326, Kind::TlsNot),       // SEC_E_ILLEGAL_MESSAGE
    (0x8009_0308, Kind::TlsNot),       // SEC_E_INVALID_TOKEN
    (0x8009_0331, Kind::TlsNot),       // SEC_E_ALGORITHM_MISMATCH（平文の答えで出ることがある）
    (0x8009_2013, Kind::TlsOther),     // CRYPT_E_REVOCATION_OFFLINE
];

/// Windows（schannel）の誤りの番号 → 種類
pub fn kind_of_schannel(code: u32) -> Kind {
    SCHANNEL.iter().find(|(c, _)| *c == code).map(|x| x.1).unwrap_or(Kind::TlsOther)
}

/// io の誤りの字の「(os error n)」の n（native-tls の schannel の誤りの字）
pub fn os_error_code(text: &str) -> Option<i64> {
    let i = text.rfind("(os error ")?;
    text[i + 10..].trim_end_matches(')').trim().parse().ok()
}
