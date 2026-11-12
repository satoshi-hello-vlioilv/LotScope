//! 値の計算（四則演算。Python の services/num_expr.py・画面の num-format.js の expr と同じ読み方・同じ答え）。
//!
//! 値は x（「値」「X」も同じ）。演算子から書けば前に値を置く（「÷1000」＝x÷1000・「×100」・「+5」・「-3」）。
//! 使える物: 数・小数点・＋ − × ÷ ^（累乗）・かっこ・全角の字。集計の値ごとの計算（aggregate の expr）が使う。
//! 答えが同じことは事例の表 program/tests/fixtures/num_expr_cases.json で確かめる（下の試験・Python の tests/test_num_expr.py）。
//! 基準の数（版 3.103.0）: ［稼働直］のように角かっこで名前を書く（中の字は値 x に読み替えない）。compile_with に使える名前を渡す。
//! 計算の失敗は Python と同じ所で「答え無し」: 0 で割る・0 の負の累乗・負の数の小数の累乗（Python は複素数になる）・有限の数の累乗のあふれ。

#[derive(Debug, Clone)]
enum Node {
    Num(f64),
    X,
    Var(String),
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
    V(String),
}

fn zen(c: char) -> char {
    const FROM: &str = "０１２３４５６７８９．（）＋－＊／＾［］";
    const TO: &str = "0123456789.()+-*/^[]";
    match FROM.chars().position(|x| x == c) {
        Some(i) => TO.chars().nth(i).unwrap_or(c),
        None => c,
    }
}

/// 書いた式 → 読む形（Python の normalize と同じ）
/// 式の字を角かっこの外と中（基準の数の名前）に分ける（Python の _PIECES.split: 偶数番が外・奇数番が「[名前]」）
fn pieces(s: &str) -> Vec<String> {
    let cs: Vec<char> = s.chars().collect();
    let (mut out, mut cur, mut i) = (vec![], String::new(), 0);
    while i < cs.len() {
        if cs[i] == '[' {
            if let Some(j) = cs[i + 1..].iter().position(|c| *c == '[' || *c == ']') {
                if cs[i + 1 + j] == ']' {
                    out.push(std::mem::take(&mut cur));
                    out.push(cs[i..=i + 1 + j].iter().collect());
                    i += j + 2;
                    continue;
                }
            }
        }
        cur.push(cs[i]);
        i += 1;
    }
    out.push(cur);
    out
}

/// 読む形の式（normalize の答え）の ［名前］ の名前の並び（Python の capacity._vars_in）
pub fn var_names(s: &str) -> Vec<String> {
    pieces(s).into_iter().skip(1).step_by(2).map(|p| p[1..p.len() - 1].to_string()).collect()
}

/// 式の見せ方（読めるかは見ない。Python の show_text）
pub fn show_text(src: &str) -> String {
    let s = normalize(src);
    pieces(&s)
        .iter()
        .enumerate()
        .map(|(k, p)| if k % 2 == 1 { p.clone() } else { p.replace('*', "×").replace('/', "÷").replace('x', "値") })
        .collect()
}

pub fn normalize(src: &str) -> String {
    normalize_with(src, true)
}

/// allow_x=false（基準の数を作る式）は前に x を置かない
pub fn normalize_with(src: &str, allow_x: bool) -> String {
    let s = crate::pyfmt::strip(src);
    if s.is_empty() {
        return String::new();
    }
    let z: String = s.chars().map(zen).collect();
    let mut out = String::new();
    for (k, piece) in pieces(&z).iter().enumerate() {
        if k % 2 == 1 {
            out.push('[');
            out.push_str(crate::pyfmt::strip(&piece[1..piece.len() - 1]));
            out.push(']');
            continue;
        }
        for c in piece.chars() {
            match c {
                '×' | '✕' => out.push('*'),
                '÷' => out.push('/'),
                '−' | '–' => out.push('-'),
                '値' | 'ｘ' | 'Ｘ' | 'X' => out.push('x'),
                c if crate::pyfmt::is_space(c) => {}
                c => out.push(c),
            }
        }
    }
    let outside: String = pieces(&out).iter().step_by(2).map(String::as_str).collect();
    if allow_x && (out.starts_with(['*', '/', '+', '^']) || (out.starts_with('-') && !outside.contains('x'))) {
        out.insert(0, 'x');
    }
    out
}

fn tokens(s: &str, vars: bool) -> (Vec<Tok>, String) {
    let cs: Vec<char> = s.chars().collect();
    let (mut out, mut bad, mut i) = (vec![], String::new(), 0);
    let digit = |c: char| c.is_ascii_digit();
    while i < cs.len() {
        let c = cs[i];
        if vars && c == '[' {
            if let Some(j) = cs[i + 1..].iter().position(|c| *c == '[' || *c == ']') {
                if cs[i + 1 + j] == ']' {
                    out.push(Tok::V(cs[i + 1..i + 1 + j].iter().collect()));
                    i += j + 2;
                    continue;
                }
            }
        }
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
    uses_v: bool,
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
        if let Tok::V(v) = t {
            self.pos += 1;
            self.uses_v = true;
            return Ok(Node::Var(v));
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
        // （V は上で返している）
        Err(format!("「{o}」の前に数か値がありません"))
    }
}

/// 式 → Ok(Some(読んだ式))・空なら Ok(None)・読めなければ Err(理由)（Python の compile_expr と同じ）
pub fn compile(src: &str) -> Result<Option<Expr>, String> {
    compile_with(src, None, true)
}

/// names … 使える基準の数の名前（None なら角かっこは使えない字）・need_x=false は基準の数を作る式（Python の compile_expr と同じ）
pub fn compile_with(src: &str, names: Option<&[String]>, need_x: bool) -> Result<Option<Expr>, String> {
    let s = normalize_with(src, need_x);
    if s.is_empty() {
        return Ok(None);
    }
    let (toks, bad) = tokens(&s, names.is_some());
    if !bad.is_empty() {
        let mut seen: Vec<char> = vec![];
        for c in bad.chars() {
            if !seen.contains(&c) {
                seen.push(c);
            }
        }
        return Err(format!("使えない字です: {}", seen.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" ")));
    }
    if let Some(names) = names {
        if let Some(u) = toks.iter().find_map(|t| match t {
            Tok::V(v) if !names.iter().any(|n| n == v) => Some(v.clone()),
            _ => None,
        }) {
            return Err(if u.is_empty() {
                "［］の中に基準の数の名前がありません".into()
            } else {
                format!("「{u}」という基準の数はありません")
            });
        }
    }
    let mut p = Parser { toks, pos: 0, uses_x: false, uses_v: false };
    let node = p.total()?;
    if let Some(t) = p.toks.get(p.pos) {
        let txt = match t {
            Tok::O(o) => o.to_string(),
            Tok::N(n) => num_text(*n),
            Tok::V(v) => format!("[{v}]"),
        };
        return Err(format!("「{txt}」の前に演算子がありません"));
    }
    if need_x && !p.uses_x {
        return Err("値（x）を使っていません。例: ÷1000・x×100".into());
    }
    if !need_x && p.uses_x {
        return Err("基準の数の式に値（x）は使えません".into());
    }
    if !need_x && !p.uses_v {
        return Err("基準の数（［稼働直］など）を使っていません".into());
    }
    let text = pieces(&s)
        .iter()
        .enumerate()
        .map(|(k, p)| if k % 2 == 1 { p.clone() } else { p.replace('*', "×").replace('/', "÷").replace('x', "値") })
        .collect();
    Ok(Some(Expr { node, text }))
}

fn eval(n: &Node, x: f64, env: &dyn Fn(&str) -> Option<f64>) -> Option<f64> {
    Some(match n {
        Node::Num(v) => *v,
        Node::X => x,
        Node::Var(k) => env(k)?,
        Node::Neg(a) => -eval(a, x, env)?,
        Node::Bin(o, a, b) => {
            let (a, b) = (eval(a, x, env)?, eval(b, x, env)?);
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
        self.apply_env(x, &|_| None)
    }
    /// 基準の数を env（名前 → そのセルの数。決まらなければ None）で読む
    pub fn apply_env(&self, x: f64, env: &dyn Fn(&str) -> Option<f64>) -> Option<f64> {
        eval(&self.node, x, env).filter(|v| v.is_finite())
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

    /// 基準の数（版 3.103.0）: Python・画面と同じ表（varCases・baseCases・texts）
    #[test]
    fn variables_same_as_python_and_screen() {
        let t: Value = serde_json::from_str(include_str!("../../program/tests/fixtures/num_expr_cases.json")).unwrap();
        let run = |src: &str, x: f64, env: &Value, want: &Value, need_x: bool| {
            let names: Vec<String> = env.as_object().unwrap().keys().cloned().collect();
            let got = compile_with(src, Some(&names), need_x);
            let look = |k: &str| env.get(k).and_then(Value::as_f64);
            match want.as_str() {
                Some("err") => assert!(got.is_err(), "{src}"),
                Some("none") => assert!(matches!(got, Ok(None)), "{src}"),
                _ => {
                    let e = got.unwrap_or_else(|e| panic!("{src}: {e}")).unwrap();
                    match want.as_f64() {
                        None => assert_eq!(e.apply_env(x, &look), None, "{src}"),
                        Some(w) => {
                            let v = e.apply_env(x, &look).unwrap_or_else(|| panic!("{src}"));
                            assert!((v - w).abs() < 1e-9_f64.max(w.abs() * 1e-12), "{src}: {v} / {w}");
                        }
                    }
                }
            }
        };
        for c in t["varCases"].as_array().unwrap() {
            run(c[0].as_str().unwrap(), c[1].as_f64().unwrap(), &c[2], &c[3], true);
        }
        for c in t["baseCases"].as_array().unwrap() {
            run(c[0].as_str().unwrap(), 0.0, &c[1], &c[2], false);
        }
        for c in t["texts"].as_array().unwrap() {
            let names: Vec<String> = c[1].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
            assert_eq!(compile_with(c[0].as_str().unwrap(), Some(&names), true).unwrap().unwrap().text, c[2].as_str().unwrap());
        }
        assert!(compile("÷[稼働直]").unwrap_err().starts_with("使えない字です"));
    }
}
