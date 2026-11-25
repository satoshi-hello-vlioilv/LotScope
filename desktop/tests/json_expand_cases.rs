//! JSON の列の展開（版 3.120.0）: 人が仕様から書いた事例の表 program/tests/fixtures/json_expand_cases.json と、窓の desktop/src/json_expand.rs の
//! 読み（空・壊れた JSON〈理由〉・違う形・形）・見分け（勧める形・形ごとの行の数）・展開（足す列・行・数・合わない行の例）・列の名前を突き合わせる
use da_core::json_expand::{detect, expand, final_names, read, shape_of, suggest_names, Cell, Out, Read, Shape, Spec, SHAPES};
use serde_json::Value;

fn table() -> Value {
    serde_json::from_str(include_str!("../../program/tests/fixtures/json_expand_cases.json")).unwrap()
}

fn same_out(o: &Out, w: &Value) -> bool {
    match (o, w) {
        (Out::Null, Value::Null) => true,
        (Out::Int(i), Value::Number(n)) => n.is_i64() && n.as_i64() == Some(*i),
        (Out::Real(f), Value::Number(n)) => n.is_f64() && n.as_f64() == Some(*f),
        (Out::Text(s), Value::String(t)) => s == t,
        _ => false,
    }
}

#[test]
fn cells_read_like_the_table() {
    let t = table();
    let mut bad = vec![];
    for c in t["read"].as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let got = read(&Cell::from_json(&c["cell"]));
        let ok = match (c["want"].as_str().unwrap(), &got) {
            ("empty", Read::Empty) => true,
            ("broken", Read::Broken(r)) => Some(r.as_str()) == c["reason"].as_str(),
            ("other", Read::Other(r)) => Some(r.as_str()) == c["reason"].as_str(),
            ("value", Read::Value(j)) => Some(shape_of(j)) == c["shape"].as_str(),
            _ => false,
        };
        if !ok {
            bad.push(format!("{name}: {got:?}"));
        }
    }
    assert!(bad.is_empty(), "読みが表と割れる:\n{}", bad.join("\n"));
}

#[test]
fn columns_are_told_like_the_table() {
    let t = table();
    let mut bad = vec![];
    for c in t["detect"].as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let cells: Vec<Cell> = c["cells"].as_array().unwrap().iter().map(Cell::from_json).collect();
        let p = detect(&cells, "");
        let w = &c["want"];
        let fit_ok = SHAPES.iter().enumerate().all(|(i, s)| w["fit"][s.key()].as_u64() == Some(p.fit[i] as u64));
        let got = (p.best.map(Shape::key), p.json, p.empty, p.broken, p.other());
        let want = (
            w["best"].as_str(),
            w["json"].as_bool().unwrap(),
            w["empty"].as_u64().unwrap() as usize,
            w["broken"].as_u64().unwrap() as usize,
            w["other"].as_u64().unwrap() as usize,
        );
        if got != want || !fit_ok {
            bad.push(format!("{name}: 窓 {got:?} fit {:?} / 表 {want:?} {}", p.fit, w["fit"]));
        }
    }
    assert!(bad.is_empty(), "見分けが表と割れる:\n{}", bad.join("\n"));
}

#[test]
fn rows_expand_like_the_table() {
    let t = table();
    let mut bad = vec![];
    for c in t["expand"].as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        let cells: Vec<Cell> = c["cells"].as_array().unwrap().iter().map(Cell::from_json).collect();
        let mut spec = c["spec"].clone();
        spec["列"] = "j".into();
        let spec = Spec::parse(&spec).unwrap();
        let e = expand(&cells, &spec);
        let w = &c["want"];
        let cols: Vec<&str> = w["cols"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
        if e.cols != cols {
            bad.push(format!("{name}: 列 {:?} / 表 {cols:?}", e.cols));
        }
        let flat: Vec<(usize, &Vec<Out>)> = e.rows.iter().enumerate().flat_map(|(i, rs)| rs.iter().map(move |r| (i + 1, r))).collect();
        let want_rows = w["rows"].as_array().unwrap();
        let rows_ok = flat.len() == want_rows.len()
            && flat.iter().zip(want_rows).all(|((i, r), wr)| {
                wr[0].as_u64() == Some(*i as u64)
                    && r.len() == wr[1].as_array().unwrap().len()
                    && r.iter().zip(wr[1].as_array().unwrap()).all(|(o, x)| same_out(o, x))
            });
        if !rows_ok {
            bad.push(format!("{name}: 行 {flat:?}"));
        }
        if e.stats.json() != w["stats"] {
            bad.push(format!("{name}: 数 {} / 表 {}", e.stats.json(), w["stats"]));
        }
        let want_issues = w.get("issues").cloned().unwrap_or(Value::Array(vec![]));
        if e.issues_json() != want_issues {
            bad.push(format!("{name}: 例 {} / 表 {want_issues}", e.issues_json()));
        }
    }
    assert!(bad.is_empty(), "展開が表と割れる:\n{}", bad.join("\n"));
}

#[test]
fn names_like_the_table() {
    let t = table();
    let strs = |v: &Value| -> Vec<String> { v.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect() };
    for c in t["names"].as_array().unwrap() {
        assert_eq!(final_names(&strs(&c["base"]), &strs(&c["new"]), c["col"].as_str().unwrap()), strs(&c["want"]), "{}", c["name"]);
    }
    for c in t["suggest"].as_array().unwrap() {
        let (k, v) = suggest_names(c["col"].as_str().unwrap());
        assert_eq!(vec![k, v], strs(&c["want"]), "{}", c["col"]);
    }
}

#[test]
fn the_table_is_big_enough() {
    let t = table();
    let n: usize = ["read", "detect", "expand", "names", "suggest"].iter().map(|k| t[*k].as_array().unwrap().len()).sum();
    assert!(n >= 50, "事例が少ない（{n}）");
}
