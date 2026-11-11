//! LotDsp の画面（HTML）の表を読む（版 3.98.0）。Python の lotdsp_progress.inner_tables（html.parser の HTMLParser〈convert_charrefs〉に
//! 表を集める係を載せた物）の写し。答えは事例の表 program/tests/fixtures/lotdsp_html_cases.json（焼いた Python の修正版〈3.13.18〉の答えと、
//! 独立の答え〈Chromium の DOM〉）と desktop/tests/lotdsp_cases.rs で突き合わせる。
//!
//! 写した決まり（CPython 3.13.18 の Lib/html/parser.py の goahead・parse_starttag・parse_endtag・parse_comment・parse_html_declaration と、
//! 1 回の feed のあとの close。1 回の feed と close は、終わりまで読む goahead(1) を 1 回流したのと同じ答え）:
//! - 地の字は「<」までをまとめて html.unescape（cm3::unescape。10 進の参照が 4300 桁を超えると Python は落ちる＝同じ字で断る）
//! - script・style・xmp・iframe・noembed・noframes の中は生の字、textarea・title の中は字の参照だけ読み替える、plaintext の後は全部が字
//! - 閉じない開きタグ（引用符が閉じない属性など）・閉じない注釈・閉じない宣言は、そこから後ろを読まない
//! - 表を集める係: script・style の中は読まない・br は空白・入れ子の表は別の表・空白は Python の \s（29 字: pyfmt::is_space）で縮める・
//!   終わりまで閉じなかった欄も読む（版 3.98.0 で Python も直した）・空の行と、入れ子を持つ表は出さない

use crate::pyfmt;

/// 表の 3 段（表 → 行 → 欄の字）
pub type Tables = Vec<Vec<Vec<String>>>;

/// 読めない（Python が落ちる）形: 4300 桁を超える 10 進の文字参照。字は Python の ValueError と同じ
pub fn unescape(s: &str) -> Result<String, String> {
    // 10 進の参照の桁（先頭の 0 も数える）
    let b = s.as_bytes();
    let mut i = 0;
    while let Some(p) = s[i..].find("&#") {
        let st = i + p + 2;
        let n = b[st..].iter().take_while(|c| c.is_ascii_digit()).count();
        if n > 4300 {
            return Err(format!(
                "Exceeds the limit (4300 digits) for integer string conversion: value has {n} digits; use sys.set_int_max_str_digits() to increase the limit"
            ));
        }
        i = st + n;
        if i >= s.len() {
            break;
        }
    }
    crate::cm3::unescape(s).map_err(|_| "html.unescape が読めない字".to_string())
}

#[derive(Default)]
struct Table {
    rows: Vec<Vec<String>>,
    has_child: bool,
    cell: Option<String>,
}

/// _TableCollector
#[derive(Default)]
struct Collector {
    tables: Vec<Table>,
    stack: Vec<usize>,
    skip: usize,
}

impl Collector {
    fn start(&mut self, tag: &str) {
        if tag == "script" || tag == "style" {
            self.skip += 1;
            return;
        }
        if tag == "table" {
            if let Some(&top) = self.stack.last() {
                self.tables[top].has_child = true;
            }
            self.tables.push(Table::default());
            self.stack.push(self.tables.len() - 1);
            return;
        }
        let Some(&top) = self.stack.last() else { return };
        match tag {
            "tr" => {
                self.close_cell();
                self.tables[top].rows.push(vec![]);
            }
            "td" | "th" => {
                self.close_cell();
                let t = &mut self.tables[top];
                if t.rows.is_empty() {
                    t.rows.push(vec![]);
                }
                t.cell = Some(String::new());
            }
            "br" => self.data(" "),
            _ => {}
        }
    }

    fn end(&mut self, tag: &str) {
        if tag == "script" || tag == "style" {
            self.skip = self.skip.saturating_sub(1);
            return;
        }
        if self.stack.is_empty() {
            return;
        }
        match tag {
            "table" => {
                self.close_cell();
                self.stack.pop();
            }
            "td" | "th" | "tr" => self.close_cell(),
            _ => {}
        }
    }

    fn data(&mut self, d: &str) {
        if self.skip > 0 {
            return;
        }
        let Some(&top) = self.stack.last() else { return };
        if let Some(c) = self.tables[top].cell.as_mut() {
            c.push_str(d);
        }
    }

    fn close_cell(&mut self) {
        let Some(&top) = self.stack.last() else { return };
        let t = &mut self.tables[top];
        let Some(cell) = t.cell.take() else { return };
        t.rows.last_mut().unwrap().push(squeeze(&cell));
    }
}

/// re.sub(r"\s+", " ", s).strip()（Python の \s・strip の空白は 29 字）
pub fn squeeze(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut sp = false;
    for c in s.chars() {
        if pyfmt::is_space(c) {
            sp = true;
        } else {
            if sp && !out.is_empty() {
                out.push(' ');
            }
            sp = false;
            out.push(c);
        }
    }
    out
}

const CDATA: [&str; 6] = ["script", "style", "xmp", "iframe", "noembed", "noframes"];
const RCDATA: [&str; 2] = ["textarea", "title"];

fn is_tag_ws(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r' | '\x0c' | ' ')
}

/// html.parser の読み方（入力は字の並び。添字は Python の str の添字と同じ＝コードポイント）
struct Parser<'a> {
    s: &'a [char],
    out: &'a mut Collector,
    cdata: Option<String>,
    escapable: bool,
}

impl Parser<'_> {
    fn n(&self) -> usize {
        self.s.len()
    }

    fn starts(&self, i: usize, w: &str) -> bool {
        w.chars().enumerate().all(|(x, c)| self.s.get(i + x) == Some(&c))
    }

    fn find(&self, from: usize, c: char) -> Option<usize> {
        (from..self.n()).find(|&k| self.s[k] == c)
    }

    fn find_str(&self, from: usize, w: &str) -> Option<usize> {
        (from..self.n()).find(|&k| self.starts(k, w))
    }

    fn text(&self, a: usize, b: usize) -> String {
        self.s[a..b].iter().collect()
    }

    fn data(&mut self, a: usize, b: usize, escape: bool) -> Result<(), String> {
        let t = self.text(a, b);
        let t = if escape { unescape(&t)? } else { t };
        self.out.data(&t);
        Ok(())
    }

    /// locatetagend.match(rawdata, at).end()
    fn locate_tag_end(&self, at: usize) -> usize {
        let (s, n) = (self.s, self.n());
        let mut j = at;
        if j < n && s[j].is_ascii_alphabetic() {
            j += 1;
            while j < n && !matches!(s[j], '\t' | '\n' | '\r' | '\x0c' | ' ' | '/' | '>') {
                j += 1;
            }
        } else {
            return at;
        }
        loop {
            while j < n && matches!(s[j], '\t' | '\n' | '\r' | '\x0c' | ' ' | '/') {
                j += 1;
            }
            // 属性の名前（前の字が引用符・空白・/ のときだけ）
            if j < n
                && matches!(s[j - 1], '\'' | '"' | '\t' | '\n' | '\r' | '\x0c' | ' ' | '/')
                && !matches!(s[j], '\t' | '\n' | '\r' | '\x0c' | ' ' | '/' | '>')
            {
                j += 1;
                while j < n && !matches!(s[j], '\t' | '\n' | '\r' | '\x0c' | ' ' | '/' | '=' | '>') {
                    j += 1;
                }
                j = self.attr_value(j);
            } else {
                break;
            }
        }
        if j < n && s[j] == '>' {
            j += 1;
        }
        j
    }

    /// 属性の値の部分（[\t\n\r\f ]*=[\t\n\r\f ]*(…)）。合わなければ元の位置
    fn attr_value(&self, at: usize) -> usize {
        let (s, n) = (self.s, self.n());
        let mut j = at;
        while j < n && is_tag_ws(s[j]) {
            j += 1;
        }
        if j >= n || s[j] != '=' {
            return at;
        }
        j += 1;
        while j < n && is_tag_ws(s[j]) {
            j += 1;
        }
        if j < n && (s[j] == '\'' || s[j] == '"') {
            match self.find(j + 1, s[j]) {
                Some(e) => e + 1,
                None => at,
            }
        } else {
            while j < n && !matches!(s[j], '>' | '\t' | '\n' | '\r' | '\x0c' | ' ') {
                j += 1;
            }
            j
        }
    }

    /// tagfind_tolerant: (名前, 終わり)
    fn tagfind(&self, at: usize) -> (String, usize) {
        let (s, n) = (self.s, self.n());
        let mut j = at + 1;
        while j < n && !matches!(s[j], '\t' | '\n' | '\r' | '\x0c' | ' ' | '/' | '>') {
            j += 1;
        }
        let name: String = s[at..j].iter().collect::<String>().to_lowercase();
        while j < n && (is_tag_ws(s[j]) || (s[j] == '/' && s.get(j + 1) != Some(&'>'))) {
            j += 1;
        }
        (name, j)
    }

    /// attrfind_tolerant を繰り返した後の位置
    fn attrs_end(&self, mut k: usize, endpos: usize) -> usize {
        let (s, n) = (self.s, self.n());
        while k < endpos {
            if !(k > 0
                && matches!(s[k - 1], '\'' | '"' | '\t' | '\n' | '\r' | '\x0c' | ' ' | '/')
                && k < n
                && !matches!(s[k], '\t' | '\n' | '\r' | '\x0c' | ' ' | '/' | '>'))
            {
                break;
            }
            k += 1;
            while k < n && !matches!(s[k], '\t' | '\n' | '\r' | '\x0c' | ' ' | '/' | '=' | '>') {
                k += 1;
            }
            k = self.attr_value(k);
            while k < n && (is_tag_ws(s[k]) || (s[k] == '/' && s.get(k + 1) != Some(&'>'))) {
                k += 1;
            }
        }
        k
    }

    /// parse_starttag。閉じなければ None
    fn starttag(&mut self, i: usize) -> Result<Option<usize>, String> {
        let endpos = self.locate_tag_end(i + 1);
        if endpos == 0 || self.s[endpos - 1] != '>' {
            return Ok(None);
        }
        let (tag, k) = self.tagfind(i + 1);
        let k = self.attrs_end(k, endpos);
        let rest = self.text(k.min(endpos), endpos);
        let rest = pyfmt::strip(&rest);
        if rest != ">" && rest != "/>" {
            self.data(i, endpos, false)?;
            return Ok(Some(endpos));
        }
        if rest.ends_with("/>") {
            self.out.start(&tag);
            self.out.end(&tag);
        } else {
            self.out.start(&tag);
            if CDATA.contains(&tag.as_str()) || tag == "plaintext" {
                self.cdata = Some(tag);
                self.escapable = false;
            } else if RCDATA.contains(&tag.as_str()) {
                self.cdata = Some(tag);
                self.escapable = true;
            }
        }
        Ok(Some(endpos))
    }

    /// parse_endtag。閉じなければ None
    fn endtag(&mut self, i: usize) -> Option<usize> {
        self.find(i + 2, '>')?;
        if !self.s.get(i + 2).is_some_and(char::is_ascii_alphabetic) {
            if self.s.get(i + 2) == Some(&'>') {
                return Some(i + 3);
            }
            return self.find(i + 2, '>').map(|p| p + 1); // 偽の注釈
        }
        let j = self.locate_tag_end(i + 2);
        if self.s[j - 1] != '>' {
            return None;
        }
        let (tag, _) = self.tagfind(i + 2);
        self.out.end(&tag);
        self.cdata = None;
        self.escapable = true;
        Some(j)
    }

    /// parse_comment（<!--）
    fn comment(&self, i: usize) -> Option<usize> {
        let a = i + 4;
        if self.s.get(a) == Some(&'>') {
            return Some(a + 1);
        }
        if self.starts(a, "->") {
            return Some(a + 2);
        }
        let mut p = a;
        while p + 2 < self.n() + 1 {
            if self.starts(p, "-->") {
                return Some(p + 3);
            }
            if self.starts(p, "--!>") {
                return Some(p + 4);
            }
            p += 1;
            if p >= self.n() {
                break;
            }
        }
        None
    }

    /// parse_html_declaration（<! のうち <!-- でない物）
    fn declaration(&self, i: usize) -> Option<usize> {
        if self.starts(i, "<![CDATA[") {
            return self.find_str(i + 9, "]]>").map(|j| j + 3);
        }
        let head: String = self.s[i..(i + 9).min(self.n())].iter().collect();
        if head.eq_ignore_ascii_case("<!doctype") {
            return self.find(i + 9, '>').map(|g| g + 1);
        }
        self.find(i + 2, '>').map(|p| p + 1)
    }

    /// cdata の中の終わりの印（</名前 の後に空白・/・>）。ASCII の大文字小文字は同じ
    fn cdata_end(&self, from: usize, elem: &str) -> Option<usize> {
        if elem == "plaintext" {
            return Some(self.n());
        }
        let e: Vec<char> = elem.chars().collect();
        let mut k = from;
        while k + 2 + e.len() < self.n() + 1 {
            if self.s[k] == '<'
                && self.s.get(k + 1) == Some(&'/')
                && e.iter().enumerate().all(|(x, c)| self.s.get(k + 2 + x).is_some_and(|d| d.to_ascii_lowercase() == *c))
                && self.s.get(k + 2 + e.len()).is_some_and(|c| matches!(c, '\t' | '\n' | '\r' | '\x0c' | ' ' | '/' | '>'))
            {
                return Some(k);
            }
            k += 1;
        }
        None
    }

    /// goahead(1)
    fn run(&mut self) -> Result<(), String> {
        let n = self.n();
        let mut i = 0;
        while i < n {
            let j = match self.cdata.clone() {
                None => self.find(i, '<').unwrap_or(n),
                Some(elem) => match self.cdata_end(i, &elem) {
                    Some(j) => j,
                    None => break,
                },
            };
            if i < j {
                let esc = self.escapable;
                self.data(i, j, esc)?;
            }
            i = j;
            if i == n {
                break;
            }
            // ここでは rawdata[i] は「<」
            let k = if self.s.get(i + 1).is_some_and(char::is_ascii_alphabetic) {
                self.starttag(i)?
            } else if self.starts(i, "</") {
                self.endtag(i)
            } else if self.starts(i, "<!--") {
                self.comment(i)
            } else if self.starts(i, "<?") {
                self.find(i + 2, '>').map(|p| p + 1)
            } else if self.starts(i, "<!") {
                self.declaration(i)
            } else {
                self.out.data("<");
                Some(i + 1)
            };
            i = match k {
                Some(k) => k,
                None => {
                    // 終わりまで閉じない: 「</」だけで終わるときは字、ほかは（注釈・宣言・閉じないタグ）そこから後ろを読まない
                    if !self.s.get(i + 1).is_some_and(char::is_ascii_alphabetic) && self.starts(i, "</") && i + 2 == n {
                        self.out.data("</");
                    }
                    n
                }
            };
        }
        if i < n {
            let esc = self.escapable;
            self.data(i, n, esc)?;
        }
        Ok(())
    }
}

/// inner_tables(html): 入れ子を持たない表だけを、空行を除いた行で。読めない（Python が落ちる）形は Err（ValueError の字）
pub fn inner_tables(html: &str) -> Result<Tables, String> {
    let chars: Vec<char> = html.chars().collect();
    let mut c = Collector::default();
    let mut p = Parser { s: &chars, out: &mut c, cdata: None, escapable: true };
    p.run()?;
    while !c.stack.is_empty() {
        c.close_cell();
        c.stack.pop();
    }
    Ok(c.tables
        .into_iter()
        .filter(|t| !t.has_child)
        .map(|t| t.rows.into_iter().filter(|r| r.iter().any(|x| !x.is_empty())).collect::<Vec<_>>())
        .filter(|rows| !rows.is_empty())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_tables() {
        let t = inner_tables("<table><tr><th>A</th><td> 1 &amp; 2 </td></tr><tr><td></td></tr></table>").unwrap();
        assert_eq!(t, vec![vec![vec!["A".to_string(), "1 & 2".to_string()]]]);
        assert!(inner_tables(&format!("<table><tr><td>&#{};</td></tr></table>", "1".repeat(4301))).unwrap_err().contains("4301 digits"));
    }
}
