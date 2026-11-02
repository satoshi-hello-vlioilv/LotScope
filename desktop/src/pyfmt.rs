//! Python と同じに値を文字にする・読む（品質データの一覧を Python と同じ答えにするため）。
//!
//! 一覧の問い合わせは SQL の中で Access 風の CStr・Val・ToDate を呼ぶ。Python 版（program/app/services/sqlite_ro.py）は
//! それぞれ Python の str()・正規表現（\d・\s は Unicode）・float() で書いてあるので、ここも同じ決まりで書く:
//!   - 小数は Python の repr（2.73→"2.73"・1e16→"1e+16"・1.0→"1.0"・1e-05→"1e-05"・-0.0→"-0.0"）
//!   - バイナリは Python の bytes の repr（b'\x00\x01'）
//!   - 数字は Unicode の 10 進数字（全角の「１２」も 12）、空白は Python の isspace（U+001C〜001F・全角の空白も）
//!
//! 突き合わせは desktop/tests/lotlist_parity.rs（Python の答えと 42 通りで比べる）。

/// Python の str.isspace()（正規表現の \s と同じ）に当たる文字の範囲（Python 3.11.15 の unicodedata から作った）。
const SPACES: &[(u32, u32)] = &[
    (0x9, 0xD),
    (0x1C, 0x20),
    (0x85, 0x85),
    (0xA0, 0xA0),
    (0x1680, 0x1680),
    (0x2000, 0x200A),
    (0x2028, 0x2029),
    (0x202F, 0x202F),
    (0x205F, 0x205F),
    (0x3000, 0x3000),
];
/// Python の正規表現の \d（Unicode の 10 進数字）に当たる文字の範囲。どれも 0 から始まる 10 文字ずつの並び。
const DIGITS: &[(u32, u32)] = &[
    (0x30, 0x39),
    (0x660, 0x669),
    (0x6F0, 0x6F9),
    (0x7C0, 0x7C9),
    (0x966, 0x96F),
    (0x9E6, 0x9EF),
    (0xA66, 0xA6F),
    (0xAE6, 0xAEF),
    (0xB66, 0xB6F),
    (0xBE6, 0xBEF),
    (0xC66, 0xC6F),
    (0xCE6, 0xCEF),
    (0xD66, 0xD6F),
    (0xDE6, 0xDEF),
    (0xE50, 0xE59),
    (0xED0, 0xED9),
    (0xF20, 0xF29),
    (0x1040, 0x1049),
    (0x1090, 0x1099),
    (0x17E0, 0x17E9),
    (0x1810, 0x1819),
    (0x1946, 0x194F),
    (0x19D0, 0x19D9),
    (0x1A80, 0x1A89),
    (0x1A90, 0x1A99),
    (0x1B50, 0x1B59),
    (0x1BB0, 0x1BB9),
    (0x1C40, 0x1C49),
    (0x1C50, 0x1C59),
    (0xA620, 0xA629),
    (0xA8D0, 0xA8D9),
    (0xA900, 0xA909),
    (0xA9D0, 0xA9D9),
    (0xA9F0, 0xA9F9),
    (0xAA50, 0xAA59),
    (0xABF0, 0xABF9),
    (0xFF10, 0xFF19),
    (0x104A0, 0x104A9),
    (0x10D30, 0x10D39),
    (0x11066, 0x1106F),
    (0x110F0, 0x110F9),
    (0x11136, 0x1113F),
    (0x111D0, 0x111D9),
    (0x112F0, 0x112F9),
    (0x11450, 0x11459),
    (0x114D0, 0x114D9),
    (0x11650, 0x11659),
    (0x116C0, 0x116C9),
    (0x11730, 0x11739),
    (0x118E0, 0x118E9),
    (0x11950, 0x11959),
    (0x11C50, 0x11C59),
    (0x11D50, 0x11D59),
    (0x11DA0, 0x11DA9),
    (0x16A60, 0x16A69),
    (0x16AC0, 0x16AC9),
    (0x16B50, 0x16B59),
    (0x1D7CE, 0x1D7FF),
    (0x1E140, 0x1E149),
    (0x1E2F0, 0x1E2F9),
    (0x1E950, 0x1E959),
    (0x1FBF0, 0x1FBF9),
];

/// Python の isspace。
pub fn is_space(c: char) -> bool {
    let n = c as u32;
    SPACES.iter().any(|&(a, b)| a <= n && n <= b)
}

/// Unicode の 10 進数字なら その値（Python の \d・int()・float() が数字と読む字）。
pub fn digit(c: char) -> Option<u32> {
    let n = c as u32;
    DIGITS.iter().find(|&&(a, b)| a <= n && n <= b).map(|&(a, _)| (n - a) % 10)
}

/// Python の str.strip()。
pub fn strip(s: &str) -> &str {
    s.trim_matches(is_space)
}

/// SQLite の値（Python の sqlite3 が渡す形と同じ種類）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Py<'a> {
    None,
    Int(i64),
    Float(f64),
    Text(&'a str),
    Blob(&'a [u8]),
}

impl Py<'_> {
    /// Python の真偽（None・0・0.0・空の字・空のバイナリは偽）。
    pub fn truthy(&self) -> bool {
        match *self {
            Py::None => false,
            Py::Int(i) => i != 0,
            Py::Float(f) => f != 0.0,
            Py::Text(s) => !s.is_empty(),
            Py::Blob(b) => !b.is_empty(),
        }
    }

    /// Python の str(値)（None は "None"。CStr は None を "" にする: cstr()）。
    pub fn py_str(&self) -> String {
        match *self {
            Py::None => "None".into(),
            Py::Int(i) => i.to_string(),
            Py::Float(f) => float_repr(f),
            Py::Text(s) => s.to_string(),
            Py::Blob(b) => bytes_repr(b),
        }
    }

    /// SQL の CStr(値)。
    pub fn cstr(&self) -> String {
        if *self == Py::None {
            String::new()
        } else {
            self.py_str()
        }
    }
}

/// Python の repr(float)（いちばん短く元へ戻る数字で、小数点の位置が -4〜16 の外なら指数で書く）。
pub fn float_repr(f: f64) -> String {
    if f.is_nan() {
        return "nan".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "inf".into() } else { "-inf".into() };
    }
    let e = format!("{:e}", f.abs()); // いちばん短く戻る数字（例 "1.2345e3"）
    let (mant, exp) = e.split_once('e').unwrap();
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let exp: i32 = exp.parse().unwrap();
    let decpt = exp + 1; // 0.d1d2… × 10^decpt
    let sign = if f.is_sign_negative() { "-" } else { "" };
    let n = digits.len() as i32;
    let body = if -4 < decpt && decpt <= 16 {
        if decpt <= 0 {
            format!("0.{}{}", "0".repeat((-decpt) as usize), digits)
        } else if decpt >= n {
            format!("{}{}.0", digits, "0".repeat((decpt - n) as usize))
        } else {
            format!("{}.{}", &digits[..decpt as usize], &digits[decpt as usize..])
        }
    } else {
        let m = if n > 1 { format!("{}.{}", &digits[..1], &digits[1..]) } else { digits.clone() };
        let x = decpt - 1;
        format!("{m}e{}{:02}", if x < 0 { '-' } else { '+' }, x.abs())
    };
    format!("{sign}{body}")
}

/// Python の repr(bytes)。
pub fn bytes_repr(b: &[u8]) -> String {
    let quote = if b.contains(&b'\'') && !b.contains(&b'"') { '"' } else { '\'' };
    let mut out = format!("b{quote}");
    for &c in b {
        match c {
            b'\\' => out.push_str("\\\\"),
            b'\t' => out.push_str("\\t"),
            b'\n' => out.push_str("\\n"),
            b'\r' => out.push_str("\\r"),
            _ if c as char == quote => {
                out.push('\\');
                out.push(quote)
            }
            0x20..=0x7e => out.push(c as char),
            _ => out.push_str(&format!("\\x{c:02x}")),
        }
    }
    out.push(quote);
    out
}

/// Python の repr(str)（誤りの文に使う。引用符の選び方と、よく出る逃がしだけ）。
pub fn str_repr(s: &str) -> String {
    let quote = if s.contains('\'') && !s.contains('"') { '"' } else { '\'' };
    let mut out = String::from(quote);
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ if c == quote => {
                out.push('\\');
                out.push(c)
            }
            _ => out.push(c),
        }
    }
    out.push(quote);
    out
}

/// 数字の並び（Unicode の 10 進数字・あいだに _ を1つずつ挟んでよい）を ASCII の数字にする。合わなければ None。
fn ascii_digits(s: &str, underscores: bool) -> Option<String> {
    let mut out = String::new();
    let mut prev_digit = false;
    let cs: Vec<char> = s.chars().collect();
    for (i, &c) in cs.iter().enumerate() {
        if let Some(d) = digit(c) {
            out.push(char::from_digit(d, 10).unwrap());
            prev_digit = true;
        } else if underscores && c == '_' && prev_digit && cs.get(i + 1).and_then(|n| digit(*n)).is_some() {
            prev_digit = false;
        } else {
            return None;
        }
    }
    (!out.is_empty()).then_some(out)
}

/// Python の int(文字)（10 進）。読めなければ Python と同じ文の誤り。
pub fn py_int(s: &str) -> Result<i64, String> {
    let bad = || format!("invalid literal for int() with base 10: {}", str_repr(s));
    let t = strip(s);
    let (neg, rest) = match t.chars().next() {
        Some('-') => (true, &t[1..]),
        Some('+') => (false, &t[1..]),
        _ => (false, t),
    };
    let d = ascii_digits(rest, true).ok_or_else(bad)?;
    let v: i128 = d.parse::<i128>().unwrap_or(i128::MAX);
    let v = if neg { -v } else { v };
    Ok(v.clamp(i64::MIN as i128, i64::MAX as i128) as i64)
}

/// Python の float(文字)。読めなければ Python と同じ文の誤り。
pub fn py_float(s: &str) -> Result<f64, String> {
    let bad = || format!("could not convert string to float: {}", str_repr(s));
    let t = strip(s);
    let (neg, rest) = match t.chars().next() {
        Some('-') => (true, &t[1..]),
        Some('+') => (false, &t[1..]),
        _ => (false, t),
    };
    let lower = rest.to_ascii_lowercase();
    let v = if lower == "inf" || lower == "infinity" {
        f64::INFINITY
    } else if lower == "nan" {
        f64::NAN
    } else {
        // 仮数（整数部・小数部のどちらかは要る）と指数
        let (mant, exp) = match rest.find(['e', 'E']) {
            Some(i) => (&rest[..i], Some(&rest[i + 1..])),
            None => (rest, None),
        };
        let (ip, fp) = match mant.split_once('.') {
            Some((a, b)) => (a, Some(b)),
            None => (mant, None),
        };
        let ip = if ip.is_empty() { Some(String::new()) } else { ascii_digits(ip, true) };
        let fp = match fp {
            Some("") => Some(String::new()),
            Some(f) => ascii_digits(f, true),
            None => Some(String::new()),
        };
        let (Some(ip), Some(fp)) = (ip, fp) else { return Err(bad()) };
        if ip.is_empty() && fp.is_empty() {
            return Err(bad());
        }
        let mut text = format!("{}.{}", if ip.is_empty() { "0" } else { &ip }, if fp.is_empty() { "0" } else { &fp });
        if let Some(e) = exp {
            let (es, er) = match e.chars().next() {
                Some(c @ ('-' | '+')) => (c.to_string(), &e[1..]),
                _ => (String::new(), e),
            };
            let ed = ascii_digits(er, true).ok_or_else(bad)?;
            text = format!("{text}e{es}{ed}");
        }
        text.parse::<f64>().map_err(|_| bad())?
    };
    Ok(if neg { -v } else { v })
}

/// SQL の Val(値): 先頭の数（空白・符号・数字・小数）を読む。読めなければ 0。
pub fn val(v: &Py) -> f64 {
    let s = if v.truthy() { v.py_str() } else { String::new() };
    let cs: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < cs.len() && is_space(cs[i]) {
        i += 1;
    }
    let mut text = String::new();
    if i < cs.len() && (cs[i] == '+' || cs[i] == '-') {
        text.push(cs[i]);
        i += 1;
    }
    let start = i;
    while i < cs.len() && digit(cs[i]).is_some() {
        text.push(char::from_digit(digit(cs[i]).unwrap(), 10).unwrap());
        i += 1;
    }
    if i == start {
        return 0.0;
    }
    if i + 1 < cs.len() && cs[i] == '.' && digit(cs[i + 1]).is_some() {
        text.push('.');
        i += 1;
        while i < cs.len() && digit(cs[i]).is_some() {
            text.push(char::from_digit(digit(cs[i]).unwrap(), 10).unwrap());
            i += 1;
        }
    }
    text.parse().unwrap_or(0.0)
}

/// 数字を n 文字（Unicode の数字）読む → 値。
fn take_digits(cs: &[char], at: usize, n: usize) -> Option<u32> {
    let mut v = 0;
    for k in 0..n {
        v = v * 10 + digit(*cs.get(at + k)?)?;
    }
    Some(v)
}

fn no_newline(cs: &[char]) -> bool {
    !cs.contains(&'\n')
}

/// 年・区切り・月(1〜2桁)・区切り・日(1〜2桁)・(空白か T で始まる続き)。→ (年, 月, 日)
fn sep_date(cs: &[char], year_digits: usize) -> Option<(u32, u32, u32)> {
    let y = take_digits(cs, 0, year_digits)?;
    let sep = |c: Option<&char>| matches!(c, Some('/' | '-' | '.'));
    if !sep(cs.get(year_digits)) {
        return None;
    }
    let m0 = year_digits + 1;
    for ml in [2, 1] {
        let Some(m) = take_digits(cs, m0, ml) else { continue };
        if !sep(cs.get(m0 + ml)) {
            continue;
        }
        let d0 = m0 + ml + 1;
        for dl in [2, 1] {
            let Some(d) = take_digits(cs, d0, dl) else { continue };
            let tail = &cs[d0 + dl..];
            if tail.is_empty() || (matches!(tail[0], ' ' | 'T') && no_newline(&tail[1..])) {
                return Some((y, m, d));
            }
        }
    }
    None
}

/// 2026年9月28日（月・日は 1〜2 桁・あいだに空白があってよい・後ろは何でもよい）
fn kanji_date(cs: &[char]) -> Option<(u32, u32, u32)> {
    let y = take_digits(cs, 0, 4)?;
    if cs.get(4) != Some(&'年') {
        return None;
    }
    let skip = |mut i: usize| {
        while i < cs.len() && is_space(cs[i]) {
            i += 1;
        }
        i
    };
    let m0 = skip(5);
    for ml in [2, 1] {
        let Some(m) = take_digits(cs, m0, ml) else { continue };
        if cs.get(m0 + ml) != Some(&'月') {
            continue;
        }
        let d0 = skip(m0 + ml + 1);
        for dl in [2, 1] {
            let Some(d) = take_digits(cs, d0, dl) else { continue };
            if cs.get(d0 + dl) == Some(&'日') && no_newline(&cs[d0 + dl + 1..]) {
                return Some((y, m, d));
            }
        }
    }
    None
}

/// 20260928（8桁・後ろは空白で始まる続きならよい）
fn compact_date(cs: &[char]) -> Option<(u32, u32, u32)> {
    let (y, m, d) = (take_digits(cs, 0, 4)?, take_digits(cs, 4, 2)?, take_digits(cs, 6, 2)?);
    let tail = &cs[8..];
    (tail.is_empty() || (is_space(tail[0]) && no_newline(&tail[1..]))).then_some((y, m, d))
}

fn iso(y: u32, m: u32, d: u32) -> Option<String> {
    let leap = (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400);
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    ((1..=9999).contains(&y) && (1..=12).contains(&m) && d >= 1 && d <= days[(m - 1) as usize]).then(|| format!("{y:04}-{m:02}-{d:02}"))
}

/// SQL の ToDate(値): 日付と読めれば "YYYY-MM-DD"、読めなければ None。読み方は Python の to_date と同じ順に試し、
/// 最初に形が合った読み方で決める（形が合って日付として無い日なら None）。
pub fn to_date(v: &Py) -> Option<String> {
    if *v == Py::None {
        return None;
    }
    let s = v.py_str();
    let cs: Vec<char> = strip(&s).chars().collect();
    if cs.is_empty() {
        return None;
    }
    if let Some((y, m, d)) = sep_date(&cs, 4) {
        return iso(y, m, d);
    }
    if let Some((y, m, d)) = kanji_date(&cs) {
        return iso(y, m, d);
    }
    if let Some((y, m, d)) = compact_date(&cs) {
        return iso(y, m, d);
    }
    if let Some((y, m, d)) = sep_date(&cs, 2) {
        return iso(y + 2000, m, d);
    }
    None
}

/// 字の数字の並び（Python の \d の 1 字ずつ）→ 値。数字でない字があれば None
fn digits_value(cs: &[char]) -> Option<u32> {
    cs.iter().try_fold(0u32, |v, c| Some(v.saturating_mul(10).saturating_add(digit(*c)?)))
}

/// 位置 at から数字が続く数（上限 max）
fn run_of_digits(cs: &[char], at: usize, max: usize) -> usize {
    cs.iter().skip(at).take(max).take_while(|c| digit(**c).is_some()).count()
}

/// Python の sqlite_ro.to_minutes: 値の終わりの時刻（8:15・08:15:30・1899/12/30 8:15:00 の時刻の所・8:15 PM）→ (時, 分, 秒)。
/// 正規表現 (?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(?:[AaPp]\.?[Mm]\.?)?\s*$ を左から探すのと同じ（最初に当たった所で決める）
pub fn to_minutes(v: &Py) -> Option<(u32, u32, u32)> {
    if *v == Py::None {
        return None;
    }
    let s = v.py_str();
    let cs: Vec<char> = strip(&s).chars().collect();
    let tail_ok = |mut i: usize| {
        if cs.get(i) == Some(&'.') && cs.get(i + 1).is_some_and(|c| digit(*c).is_some()) {
            i += 1;
            while cs.get(i).is_some_and(|c| digit(*c).is_some()) {
                i += 1;
            }
        }
        while cs.get(i).is_some_and(|c| is_space(*c)) {
            i += 1;
        }
        if cs.get(i).is_some_and(|c| "AaPp".contains(*c)) {
            let mut j = i + 1;
            if cs.get(j) == Some(&'.') {
                j += 1;
            }
            if cs.get(j).is_some_and(|c| "Mm".contains(*c)) {
                i = j + 1;
                if cs.get(i) == Some(&'.') {
                    i += 1;
                }
            }
        }
        while cs.get(i).is_some_and(|c| is_space(*c)) {
            i += 1;
        }
        i == cs.len()
    };
    let at = |p: usize| -> Option<(u32, u32, u32)> {
        let hl = run_of_digits(&cs, p, 2);
        if hl == 0 || cs.get(p + hl) != Some(&':') || run_of_digits(&cs, p + hl + 1, 2) != 2 {
            return None;
        }
        let (h, mi) = (digits_value(&cs[p..p + hl])?, digits_value(&cs[p + hl + 1..p + hl + 3])?);
        let mut i = p + hl + 3;
        let mut sec = 0;
        if cs.get(i) == Some(&':') && run_of_digits(&cs, i + 1, 2) == 2 && tail_ok(i + 3) {
            sec = digits_value(&cs[i + 1..i + 3])?;
            i += 3;
        } else if !tail_ok(i) {
            return None;
        }
        let _ = i;
        Some((h, mi, sec))
    };
    // 始まりの候補: 先頭（^）と、空白か T の次。左から最初に当たった所の値（範囲の外なら None。先へは探さない）
    let starts = std::iter::once(0).chain((0..cs.len()).filter(|&i| cs[i] == ' ' || cs[i] == 'T').map(|i| i + 1));
    for p in starts {
        if let Some((h, mi, sec)) = at(p) {
            return (h < 24 && mi < 60 && sec < 60).then_some((h, mi, sec));
        }
    }
    None
}

/// 日付と時分秒 → 'YYYY-MM-DD HH:MM:SS'
fn stamp_of(d: &str, hms: (u32, u32, u32)) -> String {
    format!("{d} {:02}:{:02}:{:02}", hms.0, hms.1, hms.2)
}

/// Python の sqlite_ro.to_datetime（作業実績の作業開始・終了の読み方）: 日時と読めれば 'YYYY-MM-DD HH:MM:SS'（時刻が無ければ
/// 'YYYY-MM-DD'）、日付と読めなければ None。time_value は時刻が別の列にあるとき（値に時刻が無いときだけ使う。None は Py::None）。
/// 年月日時分秒の 14 桁と、午前・午後（AM・PM）の書き方も読む。形が合った字の数字は、Python と同じく合った字のまま入る所がある
pub fn to_datetime(v: &Py, time_value: &Py) -> Option<String> {
    let out = to_datetime_raw(v, time_value)?;
    let texty = matches!(v, Py::Text(_)) || matches!(time_value, Py::Text(_));
    Some(if out.chars().count() == 19 && texty { meridiem(&out, v, time_value) } else { out })
}

fn to_datetime_raw(v: &Py, time_value: &Py) -> Option<String> {
    let owned;
    let v = match *v {
        Py::Int(i) if (10_000_000_000_000..100_000_000_000_000).contains(&i) => {
            owned = i.to_string();
            Py::Text(&owned)
        }
        x => x,
    };
    if let Py::Text(t) = v {
        let cs: Vec<char> = strip(t).chars().collect();
        if cs.len() == 14 && cs.iter().all(|c| digit(*c).is_some()) {
            let n = |a: usize, b: usize| digits_value(&cs[a..b]).unwrap_or(0);
            let txt = |a: usize, b: usize| cs[a..b].iter().collect::<String>();
            let d = iso(n(0, 4), n(4, 6), n(6, 8))?;
            return (n(8, 10) < 24 && n(10, 12) < 60 && n(12, 14) < 60)
                .then(|| format!("{d} {}:{}:{}", txt(8, 10), txt(10, 12), txt(12, 14)));
        }
        if let Some((d, hms)) = fast_datetime(&cs) {
            let d = d?;
            match hms {
                Some((h, mi, sec)) if h.0 < 24 && mi.0 < 60 && sec < 60 => return Some(format!("{d} {:02}:{}:{:02}", h.0, mi.1, sec)),
                Some(_) => {}
                None if *time_value != Py::None => return Some(to_minutes(time_value).map(|x| stamp_of(&d, x)).unwrap_or(d)),
                None => return Some(d),
            }
        }
    }
    let d = to_date(&v)?;
    let hms = to_minutes(&v).or_else(|| if *time_value != Py::None { to_minutes(time_value) } else { None });
    Some(hms.map(|x| stamp_of(&d, x)).unwrap_or(d))
}

type Hm = (u32, String);

/// よくある形の近道（Python の _FAST_DT の fullmatch）: 年4桁・区切り・月・区切り・日・([ T]時:分(:秒)?(.小数)?)?
/// → Some((日付 or 無い日の None, Some(((時, 時の字), (分, 分の字), 秒)) か時刻なし None))。形が合わなければ None
#[allow(clippy::type_complexity)]
fn fast_datetime(cs: &[char]) -> Option<(Option<String>, Option<(Hm, Hm, u32)>)> {
    let sep = |i: usize| matches!(cs.get(i), Some('/' | '-' | '.'));
    if run_of_digits(cs, 0, 4) != 4 || !sep(4) {
        return None;
    }
    let ml = run_of_digits(cs, 5, 2);
    if ml == 0 || !sep(5 + ml) {
        return None;
    }
    let d0 = 6 + ml;
    let dl = run_of_digits(cs, d0, 2);
    if dl == 0 {
        return None;
    }
    let num = |a: usize, b: usize| digits_value(&cs[a..b]).unwrap_or(0);
    let day = iso(num(0, 4), num(5, 5 + ml), num(d0, d0 + dl));
    let mut i = d0 + dl;
    if i == cs.len() {
        return Some((day, None));
    }
    if !matches!(cs[i], ' ' | 'T') {
        return None;
    }
    i += 1;
    let hl = run_of_digits(cs, i, 2);
    if hl == 0 || cs.get(i + hl) != Some(&':') || run_of_digits(cs, i + hl + 1, 2) != 2 {
        return None;
    }
    let h = (num(i, i + hl), cs[i..i + hl].iter().collect::<String>());
    let m0 = i + hl + 1;
    let mi = (num(m0, m0 + 2), cs[m0..m0 + 2].iter().collect::<String>());
    i = m0 + 2;
    let mut sec = 0;
    if cs.get(i) == Some(&':') {
        if run_of_digits(cs, i + 1, 2) != 2 {
            return None;
        }
        sec = num(i + 1, i + 3);
        i += 3;
    }
    if cs.get(i) == Some(&'.') {
        let fl = run_of_digits(cs, i + 1, usize::MAX);
        if fl == 0 {
            return None;
        }
        i += 1 + fl;
    }
    (i == cs.len()).then_some((day, Some((h, mi, sec))))
}

/// 'YYYY-MM-DD HH:MM:SS' の時を、元の字の午前・午後（AM・PM）で 24 時の形に直す（Python の _meridiem と同じ）
fn meridiem(stamp: &str, v: &Py, time_value: &Py) -> String {
    let pm = [v, time_value].into_iter().find_map(|t| match t {
        Py::Text(s) => meridiem_of(s),
        _ => None,
    });
    let Some(pm) = pm else { return stamp.to_string() };
    let cs: Vec<char> = stamp.chars().collect();
    let Some(h) = digits_value(&cs[11..13]) else { return stamp.to_string() };
    if h > 12 {
        return stamp.to_string();
    }
    let h = h % 12 + if pm { 12 } else { 0 };
    format!("{}{h:02}{}", cs[..11].iter().collect::<String>(), cs[13..].iter().collect::<String>())
}

/// 字の中の最初の 午前・午後・AM・PM（前後が英字でない A/P＋.?＋M）→ 午後・PM なら true
fn meridiem_of(s: &str) -> Option<bool> {
    let cs: Vec<char> = s.chars().collect();
    let letter = |i: Option<usize>| i.and_then(|i| cs.get(i)).is_some_and(|c| c.is_ascii_alphabetic());
    for i in 0..cs.len() {
        if cs[i] == '午' && matches!(cs.get(i + 1), Some('前' | '後')) {
            return Some(cs[i + 1] == '後');
        }
        if "AaPp".contains(cs[i]) && !letter(i.checked_sub(1)) {
            let j = if cs.get(i + 1) == Some(&'.') { i + 2 } else { i + 1 };
            if cs.get(j).is_some_and(|c| "Mm".contains(*c)) && (cs.get(j + 1) == Some(&'.') || !letter(Some(j + 1))) {
                return Some("Pp".contains(cs[i]));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floats_like_python_repr() {
        for (f, s) in [
            (2.73, "2.73"),
            (1e16, "1e+16"),
            (1.0, "1.0"),
            (1e-5, "1e-05"),
            (0.0001, "0.0001"),
            (-0.0, "-0.0"),
            (0.1 + 0.2, "0.30000000000000004"),
            (1234567890123456.0, "1234567890123456.0"),
            (12345678901234567.0, "1.2345678901234568e+16"),
            (1.5e300, "1.5e+300"),
            (123.456, "123.456"),
            (f64::INFINITY, "inf"),
        ] {
            assert_eq!(float_repr(f), s, "{f}");
        }
    }

    #[test]
    fn bytes_and_strings_like_python_repr() {
        assert_eq!(bytes_repr(b"\x00\x01"), "b'\\x00\\x01'");
        assert_eq!(bytes_repr(b"a'b"), "b\"a'b\"");
        assert_eq!(bytes_repr(b"\t\\\xff"), "b'\\t\\\\\\xff'");
        assert_eq!(str_repr("x"), "'x'");
        assert_eq!(str_repr("it's"), "\"it's\"");
    }

    #[test]
    fn val_reads_the_leading_number() {
        let t = |s| val(&Py::Text(s));
        assert_eq!(t("  12.5kg"), 12.5);
        assert_eq!(t("-3"), -3.0);
        assert_eq!(t("１２"), 12.0, "全角の数字");
        assert_eq!(t("1."), 1.0, "小数点の後ろに数字が無ければ整数まで");
        assert_eq!(t("abc"), 0.0);
        assert_eq!(t("\u{1c}7"), 7.0, "Python の空白（U+001C）");
        assert_eq!(val(&Py::Float(1e-5)), 1.0, "1e-05 の先頭の 1");
        assert_eq!(val(&Py::Int(0)), 0.0);
    }

    #[test]
    fn dates_like_python() {
        let t = |s| to_date(&Py::Text(s));
        assert_eq!(t("2026/09/28 10:00").as_deref(), Some("2026-09-28"));
        assert_eq!(t("2026-9-5").as_deref(), Some("2026-09-05"));
        assert_eq!(t("2026.09.28").as_deref(), Some("2026-09-28"));
        assert_eq!(t("2026-09-28T10:00").as_deref(), Some("2026-09-28"));
        assert_eq!(t("2026年9月28日").as_deref(), Some("2026-09-28"));
        assert_eq!(t("2026年 9月 28日（月）").as_deref(), Some("2026-09-28"));
        assert_eq!(t("20260928").as_deref(), Some("2026-09-28"));
        assert_eq!(t("26/09/28 23:48:54").as_deref(), Some("2026-09-28"));
        assert_eq!(t("２０２６/０９/２８").as_deref(), Some("2026-09-28"), "全角の数字");
        assert_eq!(t("2026/02/30"), None, "形は合うが無い日");
        assert_eq!(t("2026/09/28x"), None);
        assert_eq!(t("2026/09/28 10:00\nx"), None, "続きに改行");
        assert_eq!(t("不明"), None);
        assert_eq!(to_date(&Py::Int(20260928)).as_deref(), Some("2026-09-28"));
        assert_eq!(to_date(&Py::Float(20260928.0)), None, "\"20260928.0\" は読まない");
        assert_eq!(t("0000/01/01"), None, "0 年は無い");
    }

    #[test]
    fn int_and_float_like_python() {
        assert_eq!(py_int(" 3 "), Ok(3));
        assert_eq!(py_int("1_0"), Ok(10));
        assert_eq!(py_int("３"), Ok(3));
        assert_eq!(py_int("abc"), Err("invalid literal for int() with base 10: 'abc'".into()));
        assert!(py_int("2.0").is_err());
        assert_eq!(py_float(" 1e3 "), Ok(1000.0));
        assert_eq!(py_float(".5"), Ok(0.5));
        assert_eq!(py_float("5."), Ok(5.0));
        assert!(py_float("nan").unwrap().is_nan());
        assert_eq!(py_float("x"), Err("could not convert string to float: 'x'".into()));
        assert!(py_float(".").is_err() && py_float("1e").is_err() && py_float("_1").is_err());
    }
}
