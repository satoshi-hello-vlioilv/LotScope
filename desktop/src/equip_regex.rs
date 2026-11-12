//! 設備グループの「に当たる（正規表現）」の書き方の確かめ（版 3.102.0。Python の services/equip_regex.py と同じ決まり・同じ言葉）。
//!
//! 設備グループの決まりは Python（re）と窓（fancy-regex）の両方で当てる。2 つの読み方が同じ意味になる書き方だけを当て（"ok"）、
//! 窓で写せない書き方（"unsupported"）・読めない書き方（"invalid"）は、保存のときに理由を添えて断り、読むときはその決まりだけ当てない。
//! 事例の表 tests/fixtures/equip_regex_cases.json（program/tools/equip-regex-cases.py が Python の re と仕様から作る）を
//! desktop/tests/equip_regex_cases.rs が読み、判定・言葉・当たりを確かめる。

/// 判定
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Ok,
    Unsupported,
    Invalid,
}

impl Verdict {
    pub fn name(self) -> &'static str {
        match self {
            Verdict::Ok => "ok",
            Verdict::Unsupported => "unsupported",
            Verdict::Invalid => "invalid",
        }
    }
}

const PUNCT: &str = "\\.^$*+?{}[]()|-/#&~%@!'\"`,;:=_ ";
const CTRL: &str = "tnrfva";
const CLASS: &str = "dDwWsS";
const MAX_REPEAT: u64 = 1000;
const POSIX: &str = "[[:…:]] は Python では [ と : の字の組になり、窓とは意味が違います";

fn special(c: char) -> Option<&'static str> {
    Some(match c {
        'Z' => "\\Z は Python と窓で意味が違います（終わりは $ で書いてください）",
        'N' => "\\N{…}（字の名前）は窓で読めません",
        'p' => "\\p{…}（Unicode の種類）は Python の re で読めません",
        'P' => "\\P{…}（Unicode の種類）は Python の re で読めません",
        _ => return None,
    })
}

/// 正規表現の字 → (判定, 理由)。理由は Ok のとき ""
pub fn check(src: &str) -> (Verdict, String) {
    let mut p = Parser { s: src.chars().collect(), i: 0, opened: 0, closed: vec![], names: vec![] };
    match p.run() {
        Ok(()) => (Verdict::Ok, String::new()),
        Err((v, why)) => (v, why),
    }
}

/// 保存・当てるときの理由（当てられる書き方なら ""。Python の why_of と同じ言葉）
pub fn why_of(src: &str) -> String {
    match check(src) {
        (Verdict::Ok, _) => String::new(),
        (Verdict::Unsupported, why) => format!("窓で写せない書き方です（{why}）"),
        (Verdict::Invalid, why) => format!("読めません（{why}）"),
    }
}

type Stop = (Verdict, String);
type P<T> = Result<T, Stop>;

/// 塊の繰り返しやすさ（Python の repeatable: True・False・"look"）
#[derive(Clone, Copy, PartialEq)]
enum Rep {
    Yes,
    No,
    Look,
}

struct Parser {
    s: Vec<char>,
    i: usize,
    opened: usize,
    closed: Vec<usize>,
    /// (名前, 閉じたか)
    names: Vec<(String, bool)>,
}

fn bad<T>(why: impl Into<String>) -> P<T> {
    Err((Verdict::Invalid, why.into()))
}

fn unsup<T>(why: impl Into<String>) -> P<T> {
    Err((Verdict::Unsupported, why.into()))
}

fn ident(name: &str) -> bool {
    let mut cs = name.chars();
    match cs.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    name.is_ascii() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_hex(c: char) -> bool {
    c.is_ascii_hexdigit()
}

impl Parser {
    fn peek(&self, k: usize) -> Option<char> {
        self.s.get(self.i + k).copied()
    }

    fn at(&self, k: usize, c: char) -> bool {
        self.peek(k) == Some(c)
    }

    fn find(&self, from: usize, c: char) -> Option<usize> {
        (from..self.s.len()).find(|&j| self.s[j] == c)
    }

    fn text(&self, a: usize, b: usize) -> String {
        self.s[a.min(self.s.len())..b.min(self.s.len())].iter().collect()
    }

    fn run(&mut self) -> P<()> {
        if self.s.starts_with(&['(', '?', 'i', ')']) {
            self.i = 4;
        }
        self.alt(true)?;
        if self.i < self.s.len() {
            return bad("かっこ ( ) の数が合いません");
        }
        Ok(())
    }

    /// 枝の並び（|）→ 幅（決まった長さなら Some）
    fn alt(&mut self, top: bool) -> P<Option<u64>> {
        let mut widths = vec![self.seq()?];
        while self.at(0, '|') {
            self.i += 1;
            widths.push(self.seq()?);
        }
        if !top && !self.at(0, ')') {
            return bad("かっこ ( ) の数が合いません");
        }
        Ok(if widths.iter().all(|w| *w == widths[0]) { widths[0] } else { None })
    }

    fn seq(&mut self) -> P<Option<u64>> {
        let mut total = Some(0u64);
        while let Some(c) = self.peek(0) {
            if c == '|' || c == ')' {
                break;
            }
            let (mut w, rep) = self.atom()?;
            let q = self.peek(0);
            if matches!(q, Some('*' | '+' | '?')) || (q == Some('{') && self.is_quant()) {
                if rep == Rep::Look {
                    return unsup("先読み・後読みの繰り返し");
                }
                if rep == Rep::No {
                    return bad("繰り返し（* + ? {}）の前に繰り返せる字がありません");
                }
                w = self.quant(w)?;
            }
            total = match (total, w) {
                (Some(a), Some(b)) => Some(a + b),
                _ => None,
            };
        }
        Ok(total)
    }

    fn digits_end(&self, from: usize) -> usize {
        let mut k = from;
        while k < self.s.len() && self.s[k].is_ascii_digit() {
            k += 1;
        }
        k
    }

    fn is_quant(&self) -> bool {
        let j = self.i + 1;
        let k = self.digits_end(j);
        let has_a = k > j;
        match self.s.get(k) {
            Some('}') => has_a,
            Some(',') => {
                let m = self.digits_end(k + 1);
                self.s.get(m) == Some(&'}') && (has_a || m > k + 1)
            }
            _ => false,
        }
    }

    fn quant(&mut self, w: Option<u64>) -> P<Option<u64>> {
        let c = self.peek(0);
        self.i += 1;
        let fixed = if c == Some('{') {
            let j = self.find(self.i, '}').unwrap_or(self.s.len());
            let body = self.text(self.i, j);
            self.i = j + 1;
            let (lo, hi, comma) = match body.split_once(',') {
                Some((a, b)) => (a.to_string(), b.to_string(), true),
                None => (body.clone(), String::new(), false),
            };
            // 桁の多い数（u64 に入らない）も上限を超える数として扱う（Python の int は桁を問わない）
            let num = |t: &str| -> u64 { t.parse::<u64>().unwrap_or(u64::MAX) };
            let lo_n = if lo.is_empty() { 0 } else { num(&lo) };
            let mut hi_n = if hi.is_empty() { None } else { Some(num(&hi)) };
            if lo_n > MAX_REPEAT || hi_n.is_some_and(|h| h > MAX_REPEAT) {
                return unsup(format!("繰り返しの数は {MAX_REPEAT} までにしてください"));
            }
            if !comma {
                hi_n = Some(lo_n);
            }
            if hi_n.is_some_and(|h| h < lo_n) {
                return bad("繰り返しの数 {n,m} の n が m より大きい");
            }
            match (w, hi_n) {
                (Some(w), Some(h)) if h == lo_n => Some(w * lo_n),
                _ => None,
            }
        } else {
            None
        };
        if self.at(0, '?') {
            self.i += 1;
        }
        if self.at(0, '+') {
            return unsup("後ろの + （取り戻さない繰り返し）");
        }
        if matches!(self.peek(0), Some('*' | '+' | '?')) || (self.at(0, '{') && self.is_quant()) {
            return bad("繰り返し（* + ? {}）が 2 つ続いています");
        }
        Ok(fixed)
    }

    fn atom(&mut self) -> P<(Option<u64>, Rep)> {
        let c = self.peek(0).unwrap_or('\0');
        match c {
            '(' => self.group(),
            '[' => {
                self.klass()?;
                Ok((Some(1), Rep::Yes))
            }
            '\\' => self.escape(),
            '*' | '+' | '?' => bad("繰り返し（* + ? {}）の前に繰り返せる字がありません"),
            '{' | '}' => unsup("{ } は \\{ \\} と書いてください（{n} {n,m} の繰り返しのほか）"),
            '^' | '$' => {
                self.i += 1;
                Ok((Some(0), Rep::No))
            }
            _ => {
                self.i += 1;
                Ok((Some(1), Rep::Yes))
            }
        }
    }

    /// \x \u \U の後ろの 16 進 → 字の番号
    fn hex(&mut self, c: char) -> P<u32> {
        let n = match c {
            'x' => 2,
            'u' => 4,
            _ => 8,
        };
        let h = self.text(self.i, self.i + n);
        if h.chars().count() != n || !h.chars().all(is_hex) {
            return unsup(format!("\\{c} の後ろは 16 進の {n} 字にしてください"));
        }
        let v = u32::from_str_radix(&h, 16).unwrap_or(u32::MAX);
        if c == 'U' && v > 0x10FFFF {
            return bad(format!("\\U{h} は字の範囲の外です"));
        }
        self.i += n;
        Ok(v)
    }

    fn escape(&mut self) -> P<(Option<u64>, Rep)> {
        self.i += 1;
        let Some(c) = self.peek(0) else { return bad("最後の \\ の後ろに字がありません") };
        self.i += 1;
        if let Some(why) = special(c) {
            return unsup(why);
        }
        if CLASS.contains(c) {
            return Ok((Some(1), Rep::Yes));
        }
        if matches!(c, 'b' | 'B' | 'A') {
            return Ok((Some(0), Rep::No));
        }
        if PUNCT.contains(c) || CTRL.contains(c) {
            return Ok((Some(1), Rep::Yes));
        }
        if c == '0' {
            if self.peek(0).is_some_and(|d| d.is_ascii_digit()) {
                return unsup("\\0 の後ろの数（8 進の字）");
            }
            return Ok((Some(1), Rep::Yes));
        }
        if c.is_ascii_digit() {
            if self.peek(0).is_some_and(|d| d.is_ascii_digit()) {
                return unsup("2 桁の \\ の数（Python は 8 進の字・組の番号、窓は組の番号）");
            }
            let k = c.to_digit(10).unwrap_or(0) as usize;
            if !self.closed.contains(&k) {
                return bad(format!("\\{c} が指す組がまだありません（閉じた組だけ指せます）"));
            }
            return Ok((None, Rep::Yes));
        }
        if matches!(c, 'x' | 'u' | 'U') {
            self.hex(c)?;
            return Ok((Some(1), Rep::Yes));
        }
        unsup(format!("\\{c} は Python と窓で読み方が違う・読めない書き方です"))
    }

    fn close(&mut self) {
        self.i += 1; // alt が「)」で止まっている
    }

    fn group(&mut self) -> P<(Option<u64>, Rep)> {
        self.i += 1;
        if !self.at(0, '?') {
            self.opened += 1;
            let no = self.opened;
            let w = self.alt(false)?;
            self.close();
            self.closed.push(no);
            return Ok((w, Rep::Yes));
        }
        self.i += 1;
        let c = self.peek(0);
        match c {
            Some(':') => {
                self.i += 1;
                let w = self.alt(false)?;
                self.close();
                Ok((w, Rep::Yes))
            }
            Some('=' | '!') => {
                self.i += 1;
                self.alt(false)?;
                self.close();
                Ok((Some(0), Rep::Look))
            }
            Some('<') if matches!(self.peek(1), Some('=' | '!')) => {
                self.i += 2;
                let w = self.alt(false)?;
                self.close();
                if w.is_none() {
                    return bad("後読み (?<= ) (?<! ) の中は長さの決まった形にしてください");
                }
                Ok((Some(0), Rep::Look))
            }
            Some('#') => match self.find(self.i, ')') {
                None => bad("かっこ ( ) の数が合いません"),
                Some(j) => {
                    self.i = j + 1;
                    Ok((Some(0), Rep::No))
                }
            },
            Some('P') if self.at(1, '<') => {
                let j = self.find(self.i + 2, '>');
                let name = j.map(|j| self.text(self.i + 2, j)).unwrap_or_default();
                let Some(j) = j.filter(|_| ident(&name)) else {
                    return unsup("組の名前は英字・数字・_ にしてください（(?P<名前>…)）");
                };
                if self.names.iter().any(|(n, _)| *n == name) {
                    return bad(format!("組の名前「{name}」が 2 つあります"));
                }
                self.names.push((name.clone(), false));
                self.i = j + 1;
                self.opened += 1;
                let no = self.opened;
                let w = self.alt(false)?;
                self.close();
                self.closed.push(no);
                if let Some(x) = self.names.iter_mut().find(|(n, _)| *n == name) {
                    x.1 = true;
                }
                Ok((w, Rep::Yes))
            }
            Some('P') if self.at(1, '=') => {
                let j = self.find(self.i + 2, ')');
                let name = j.map(|j| self.text(self.i + 2, j)).unwrap_or_default();
                let Some(j) = j.filter(|_| ident(&name)) else {
                    return unsup("組の名前は英字・数字・_ にしてください（(?P=名前)）");
                };
                if !self.names.iter().any(|(n, done)| *n == name && *done) {
                    return bad(format!("(?P={name}) が指す組がまだありません（閉じた組だけ指せます）"));
                }
                self.i = j + 1;
                Ok((None, Rep::Yes))
            }
            _ => unsup("(? の書き方（(?: ) (?= ) (?! ) (?<= ) (?<! ) (?P<名前> ) (?P=名前) (?# ) と最初の (?i) のほか）"),
        }
    }

    fn klass(&mut self) -> P<()> {
        self.i += 1;
        if self.at(0, '^') {
            self.i += 1;
        }
        let mut first = true;
        let mut prev_single = false;
        loop {
            let Some(c) = self.peek(0) else { return bad("[ ] が閉じていません") };
            if c == ']' && !first {
                self.i += 1;
                return Ok(());
            }
            first = false;
            if c == '[' {
                if self.at(1, ':') {
                    return unsup(POSIX);
                }
                return unsup("[ ] の中の [ は \\[ と書いてください");
            }
            if matches!(c, '&' | '~' | '|') && self.at(1, c) {
                return unsup(format!("[ ] の中の {c}{c} は Python と窓で意味が違います"));
            }
            if c == '-' && self.at(1, '-') {
                return unsup("[ ] の中の -- は Python と窓で意味が違います");
            }
            let range_next = |p: &Parser| p.at(0, '-') && !matches!(p.peek(1), Some(']') | None);
            if c == '-' && prev_single && !matches!(self.peek(1), Some(']') | None) {
                return bad("[ ] の中の範囲の書き方が読めません");
            }
            let single = self.class_item()?;
            if range_next(self) {
                let Some(lo) = single else { return unsup("[ ] の中の範囲の端に \\d などは書けません") };
                self.i += 1;
                if self.at(0, '[') {
                    return unsup("[ ] の中の [ は \\[ と書いてください");
                }
                let Some(hi) = self.class_item()? else { return unsup("[ ] の中の範囲の端に \\d などは書けません") };
                if hi < lo {
                    return bad("[ ] の中の範囲が逆です");
                }
                prev_single = false;
                continue;
            }
            prev_single = single.is_some();
        }
    }

    /// [ ] の中の 1 つ → 字の番号（\d などは None）
    fn class_item(&mut self) -> P<Option<u32>> {
        let Some(c) = self.peek(0) else { return bad("[ ] が閉じていません") };
        if c != '\\' {
            self.i += 1;
            return Ok(Some(c as u32));
        }
        self.i += 1;
        let Some(c) = self.peek(0) else { return bad("[ ] が閉じていません") };
        self.i += 1;
        if let Some(why) = special(c) {
            return unsup(why);
        }
        if CLASS.contains(c) {
            return Ok(None);
        }
        if c == 'b' {
            return Ok(Some(8));
        }
        if CTRL.contains(c) {
            return Ok(Some(match c {
                't' => 9,
                'n' => 10,
                'r' => 13,
                'f' => 12,
                'v' => 11,
                _ => 7,
            }));
        }
        if PUNCT.contains(c) {
            return Ok(Some(c as u32));
        }
        if matches!(c, 'x' | 'u' | 'U') {
            return self.hex(c).map(Some);
        }
        unsup(format!("[ ] の中の \\{c} は Python と窓で読み方が違う・読めない書き方です"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_four_forms_found_before_are_not_applied() {
        for p in ["^L-[0-9]\\Z", "[[:alpha:]]", "\\p{Han}", "\\N{DIGIT ONE}"] {
            assert_eq!(check(p).0, Verdict::Unsupported, "{p}");
        }
        assert_eq!(check("^L-\\d+$").0, Verdict::Ok);
        assert_eq!(why_of("(a+)"), "");
    }
}
