//! 大きな整数の事例の表（program/tests/fixtures/bigint_cases.json。版 3.108.0・Rust 化の段 ① の 5 歩目・案 H2）を窓が同じに答えるか。
//! 表は Python 3 の int で焼いた答え（program/tools/bigint-cases.py。Python は tests/test_bigint_cases.py が古い表を止める）。
//! 比べ方・並べ方（pyfmt::PyInt の Ord）・+1 と +10（succ・master_rows::add_small）・int(小数)（pyfmt::py_int_of）・
//! 次の id（master_store::next_id）・次の表示順（master_rows::next_order）・読んで書き戻す字（held::parse → held::reply_bytes）

use da_core::pyfmt::{py_int, py_int_of, IntArg, PyInt};
use serde_json::Value;

fn table() -> Value {
    serde_json::from_str(include_str!("../../program/tests/fixtures/bigint_cases.json")).unwrap()
}

fn strs(v: &Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
}

#[test]
fn big_ints_compare_sort_and_count_like_python() {
    let t = table();
    let ints: Vec<PyInt> = strs(&t["ints"]).iter().map(|s| py_int(s).unwrap()).collect();
    let mut idx: Vec<usize> = (0..ints.len()).collect();
    idx.sort_by(|a, b| ints[*a].cmp(&ints[*b]));
    let want: Vec<usize> = t["sorted"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as usize).collect();
    assert_eq!(idx, want, "並べる順");
    for (i, n) in ints.iter().enumerate() {
        assert_eq!(n.succ().text(), t["succ"][i].as_str().unwrap(), "{} + 1", n.text());
        assert_eq!(da_core::master_rows::add_small(n, 10).text(), t["plus10"][i].as_str().unwrap(), "{} + 10", n.text());
        assert_eq!(n.to_string(), n.text(), "str(int)");
    }
    for c in t["floats"].as_array().unwrap() {
        let f: f64 = c["f"].as_str().unwrap().parse().unwrap();
        let n = py_int_of(IntArg::Num(&serde_json::Number::from_f64(f).unwrap())).unwrap();
        assert_eq!(n.text(), c["int"].as_str().unwrap(), "int({f})");
    }
}

#[test]
fn next_id_next_order_and_written_text_are_like_python() {
    let t = table();
    let rows = |s: &str| -> Vec<Value> {
        match da_core::held::parse(s).unwrap() {
            Value::Array(a) => a,
            _ => panic!("行の並び"),
        }
    };
    for c in t["next_id"].as_array().unwrap() {
        let got = da_core::held::reply_bytes(&da_core::master_store::next_id(&rows(c["rows"].as_str().unwrap())));
        assert_eq!(String::from_utf8(got).unwrap(), c["want"].as_str().unwrap(), "next_id {}", c["rows"]);
    }
    for c in t["next_order"].as_array().unwrap() {
        let got = da_core::master_rows::next_order(&rows(c["rows"].as_str().unwrap())).unwrap();
        assert_eq!(
            got,
            c["want"].as_str().unwrap(),
            "next_order {}",
            &c["rows"].as_str().unwrap()[..60.min(c["rows"].as_str().unwrap().len())]
        );
    }
    for c in t["json"].as_array().unwrap() {
        let v = da_core::held::parse(c["text"].as_str().unwrap()).unwrap();
        let want = c["want"].as_str().unwrap();
        // 書き戻す字（json.dumps と同じ区切り）と、画面へ返す答え（区切りは詰めた字。読めば同じ値）
        assert_eq!(da_core::held::to_j(&v).dumps(None), want, "{}", c["text"]);
        let reply = String::from_utf8(da_core::held::reply_bytes(&v)).unwrap();
        assert_eq!(da_core::held::parse(&reply).unwrap(), da_core::held::parse(want).unwrap(), "{reply}");
    }
}

/// 印の字（src/held.rs の持っている値の頭）と同じ頭（NUL・J・:）で始まる利用者の字（版 3.108.0 の作った後の採点の割れ 1）: 大きな整数・NaN と
/// 取り違えず、字のまま読み・書き戻し（ファイル・答え）、str() は字のまま、int() は Python と同じ誤り
#[test]
fn user_text_that_looks_like_a_held_value_stays_text() {
    let t = table();
    for c in t["marks"].as_array().unwrap() {
        let text = c["text"].as_str().unwrap();
        let v = da_core::held::parse(text).unwrap();
        let a = &v["a"];
        assert!(!da_core::held::is_held(a) && da_core::held::is_text(a), "字のまま: {text}");
        assert_eq!(a.as_str(), c["str"].as_str(), "{text}");
        assert_eq!(da_core::worksum::py_str(a), c["str"].as_str().unwrap(), "str(): {text}");
        let err = py_int_of(a.into()).err();
        assert_eq!(err.as_deref(), c["int_err"].as_str(), "int(): {text}");
        let want = c["want"].as_str().unwrap();
        assert_eq!(da_core::held::to_j(&v).dumps(None), want, "書き戻す字: {text}");
        let pretty = String::from_utf8(da_core::held::to_pretty(&v).unwrap()).unwrap();
        assert_eq!(da_core::held::parse(&pretty).unwrap(), v, "ファイルの字: {pretty}");
        let reply = String::from_utf8(da_core::held::reply_bytes(&v)).unwrap();
        assert_eq!(da_core::held::parse(&reply).unwrap(), v, "答えの字: {reply}");
        // serde で読んだ字（大きな整数の無いファイル・本文の速い道）も同じ
        let fast: Value = serde_json::from_str(text).unwrap();
        assert_eq!(String::from_utf8(da_core::held::to_pretty(&fast).unwrap()).unwrap(), pretty, "{text}");
        assert_eq!(da_core::worksum::py_str(&fast["a"]), c["str"].as_str().unwrap());
    }
}

/// float(int)（版 3.109.0 の作った後の採点の割れ 6）: 丸めは Python の float(int) と同じ・f64 に入らない桁は同じ OverflowError の文
#[test]
fn float_of_int_is_like_python() {
    let t = table();
    for c in t["float_of_int"].as_array().unwrap() {
        let d = c["int"].as_str().unwrap();
        let got = da_core::pyfmt::py_float_of_int(d);
        match (c["float"].as_str(), c["error"].as_str()) {
            (Some(f), _) => assert_eq!(got.map(da_core::pyfmt::float_repr), Ok(f.to_string()), "float({d})"),
            (_, Some(e)) => assert_eq!(got, Err(e.to_string()), "float({d})"),
            _ => panic!("表の形"),
        }
    }
}
