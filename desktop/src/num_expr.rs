//! 値の計算（四則演算。Python の services/num_expr.py・画面の num-format.js の expr と同じ読み方・同じ答え）。
//!
//! 値は x（「値」「X」も同じ）。演算子から書けば前に値を置く（「÷1000」＝x÷1000・「×100」・「+5」・「-3」）。
//! 使える物: 数・小数点・＋ − × ÷ ^（累乗）・かっこ・全角の字。集計の値ごとの計算（aggregate の expr）が使う。
//! 答えが同じことは事例の表 program/tests/fixtures/num_expr_cases.json で確かめる（下の試験・Python の tests/test_num_expr.py）。
//! 計算の失敗は Python と同じ所で「答え無し」: 0 で割る・0 の負の累乗・負の数の小数の累乗（Python は複素数になる）・有限の数の累乗のあふれ。

#[derive(Debug, Clone)]
enum Node {
    Num(f64),
    X,
    Neg(Box<Node>),
    Bin(char, Box<Node>, Box<Node>),
}

/// 読んだ式（compile の答え）
#[derive(Debug, Clone)]
pub struct Expr {
    node: Node,
    /// 読んだ式の見せ方（÷1000 → 値÷1000）
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    N(f64),
    O(char),
}

fn zen(c: char) -> char {
    const FROM: &str = "０１２３４５６７８９．（）＋－＊／＾";
    const TO: &str = "0123456789.()+-*/^";
    match FROM.chars().position(|x| x == c) {
        Some(i) => TO.chars().nth(i).unwrap_or(c),
        None => c,
    }
}

/// 書いた式 → 読む形（Python の normalize と同じ）
pub fn normalize(src: &str) -> String {
    let s = crate::pyfmt::strip(src);
    if s.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for c in s.chars().map(zen) {
        match c {
            '×' | '✕' => out.push('*'),
            '÷' => out.push('/'),
            '−' | '–' => out.push('-'),
            '値' | 'ｘ' | 'Ｘ' | 'X' => out.push('x'),
            c if crate::pyfmt::is_space(c) => {}
            c => out.push(c),
        }
    }
    if out.starts_with(['*', '/', '+', '^']) || (out.starts_with('-') && !out.contains('x')) {
        out.insert(0, 'x');
    }
    out
}

/// 字句（Python の _TOKEN: (\d+\.?\d*|\.\d+)|([x+\-*/^()])）→ (字句, 読めなかった字)
fn tokens(s: &str) -> (Vec<Tok>, String) {
    let cs: Vec<char> = s.chars().collect();
    let (mut out, mut bad, mut i) = (vec![], String::new(), 0);
    let digit = |c: char| c.is_ascii_digit();
    while i < cs.len() {
        let c = cs[i];
        if digit(c) || (c == '.' && cs.get(i + 1).is_some_and(|d| digit(*d))) {
            let st = i;
            if c == '.' {
                i += 1;
                while i < cs.len() && digit(cs[i]) {
                    i += 1;
                }
            } else {
                while i < cs.len() && digit(cs[i]) {
                    i += 1;
                }
                if i < cs.len() && cs[i] == '.' {
                    i += 1;
                    while i < cs.len() && digit(cs[i]) {
                        i += 1;
                    }
                }
            }
            let t: String = cs[st..i].iter().collect();
            out.push(Tok::N(t.parse().unwrap_or(0.0)));
            continue;
        }
        if "x+-*/^()".contains(c) {
            out.push(Tok::O(c));
        } else {
            bad.push(c);
        }
        i += 1;
    }
    (out, bad)
}

fn num_text(n: f64) -> String {
    if n == n.trunc() && n.is_finite() {
        format!("{n:.0}")
    } else {
        crate::pyfmt::float_repr(n)
    }
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
    uses_x: bool,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }
    fn eat(&mut self, o: char) -> bool {
        if self.peek() == Some(&Tok::O(o)) {
            self.pos += 1;
            return true;
        }
        false
    }
    fn chain(&mut self, next: fn(&mut Parser) -> Result<Node, String>, ops: &[char]) -> Result<Node, String> {
        let mut a = next(self)?;
        loop {
            let Some(o) = ops.iter().copied().find(|o| self.eat(*o)) else { return Ok(a) };
            a = Node::Bin(o, Box::new(a), Box::new(next(self)?));
        }
    }
    fn total(&mut self) -> Result<Node, String> {
        self.chain(Parser::prod, &['+', '-'])
    }
    fn prod(&mut self) -> Result<Node, String> {
        self.chain(Parser::power, &['*', '/'])
    }
    fn power(&mut self) -> Result<Node, String> {
        let a = self.unary()?;
        if self.eat('^') {
            let b = self.power()?;
            return Ok(Node::Bin('^', Box::new(a), Box::new(b)));
        }
        Ok(a)
    }
    fn unary(&mut self) -> Result<Node, String> {
        if self.eat('-') {
            return Ok(Node::Neg(Box::new(self.unary()?)));
        }
        if self.eat('+') {
            return self.unary();
        }
        self.atom()
    }
    fn atom(&mut self) -> Result<Node, String> {
        let t = self.peek().cloned().ok_or_else(|| "式が途中で終わっています".to_string())?;
        if let Tok::N(n) = t {
            self.pos += 1;
            return Ok(Node::Num(n));
        }
        if self.eat('x') {
            self.uses_x = true;
            return Ok(Node::X);
        }
        if self.eat('(') {
            let a = self.total()?;
            if !self.eat(')') {
                return Err("かっこが閉じていません".into());
            }
            return Ok(a);
        }
        let Tok::O(o) = t else { unreachable!() };
        Err(format!("「{o}」の前に数か値がありません"))
    }
}

/// 式 → Ok(Some(読んだ式))・空なら Ok(None)・読めなければ Err(理由)（Python の compile_expr と同じ）
pub fn compile(src: &str) -> Result<Option<Expr>, String> {
    let s = normalize(src);
    if s.is_empty() {
        return Ok(None);
    }
    let (toks, bad) = tokens(&s);
    if !bad.is_empty() {
        let mut seen: Vec<char> = vec![];
        for c in bad.chars() {
            if !seen.contains(&c) {
                seen.push(c);
            }
        }
        return Err(format!("使えない字です: {}", seen.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" ")));
    }
    let mut p = Parser { toks, pos: 0, uses_x: false };
    let node = p.total()?;
    if let Some(t) = p.toks.get(p.pos) {
        let txt = match t {
            Tok::O(o) => o.to_string(),
            Tok::N(n) => num_text(*n),
        };
        return Err(format!("「{txt}」の前に演算子がありません"));
    }
    if !p.uses_x {
        return Err("値（x）を使っていません。例: ÷1000・x×100".into());
    }
    Ok(Some(Expr { node, text: s.replace('*', "×").replace('/', "÷").replace('x', "値") }))
}

fn eval(n: &Node, x: f64) -> Option<f64> {
    Some(match n {
        Node::Num(v) => *v,
        Node::X => x,
        Node::Neg(a) => -eval(a, x)?,
        Node::Bin(o, a, b) => {
            let (a, b) = (eval(a, x)?, eval(b, x)?);
            match o {
                '+' => a + b,
                '-' => a - b,
                '*' => a * b,
                '/' => {
                    if b == 0.0 {
                        return None; // Python: ZeroDivisionError
                    }
                    a / b
                }
                _ => {
                    if a == 0.0 && b < 0.0 {
                        return None; // ZeroDivisionError
                    }
                    if a < 0.0 && b.is_finite() && b != b.trunc() {
                        return None; // 複素数
                    }
                    let r = a.powf(b);
                    if a.is_finite() && b.is_finite() && r.is_infinite() {
                        return None; // OverflowError
                    }
                    r
                }
            }
        }
    })
}

impl Expr {
    /// 値に当てる（答えが数でなければ None）
    pub fn apply(&self, x: f64) -> Option<f64> {
        eval(&self.node, x).filter(|v| v.is_finite())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn same_answers_as_screen() {
        let cases: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/num_expr_cases.json")).unwrap();
        for c in cases["cases"].as_array().unwrap() {
            let (src, x, want) = (c[0].as_str().unwrap(), c[1].as_f64().unwrap_or(0.0), &c[2]);
            let got = compile(src);
            match want.as_str() {
                Some("err") => assert!(got.is_err(), "{src}"),
                Some("none") => assert!(matches!(got, Ok(None)), "{src}"),
                _ => {
                    let e = got.unwrap_or_else(|e| panic!("{src}: {e}")).unwrap();
                    match want.as_f64() {
                        None => assert_eq!(e.apply(x), None, "{src}"),
                        Some(w) => {
                            let v = e.apply(x).unwrap_or_else(|| panic!("{src}"));
                            assert!((v - w).abs() < 1e-9_f64.max(w.abs() * 1e-12), "{src}: {v} / {w}");
                        }
                    }
                }
            }
        }
        assert_eq!(compile("÷1000").unwrap().unwrap().text, "値÷1000");
        assert_eq!(compile("x+").unwrap_err(), "式が途中で終わっています");
        assert_eq!(compile("1/0").unwrap_err(), "値（x）を使っていません。例: ÷1000・x×100");
        assert_eq!(compile("x 2").unwrap_err(), "「2」の前に演算子がありません");
        assert_eq!(compile("x+a+a").unwrap_err(), "使えない字です: a");
        // Python で例外になる所（0 で割る・あふれ）は、後で有限に戻っても答え無し
        assert_eq!(compile("1/(x/0)").unwrap().unwrap().apply(3.0), None);
        assert_eq!(compile("(-8)^0.5").ok().flatten().and_then(|e| e.apply(1.0)), None);
        assert_eq!(compile("x^1000").unwrap().unwrap().apply(10.0), None);
    }
}
