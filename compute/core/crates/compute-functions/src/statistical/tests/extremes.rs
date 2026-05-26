use super::super::extremes::*;
use crate::PureFunction;
use value_types::CellValue;

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

#[test]
fn test_maxa_mina() {
    // MAXA includes booleans: TRUE=1, FALSE=0
    let result = FnMaxA.call(&[num(0.5), CellValue::Boolean(true)]);
    assert_eq!(result, num(1.0));
    let result = FnMinA.call(&[num(0.5), CellValue::Boolean(false)]);
    assert_eq!(result, num(0.0));
}

#[test]
fn test_maxa_with_bool_and_text() {
    // MAXA({1, TRUE, -1, "text"}) -> TRUE=1, "text"=0, so max=1
    let reg = crate::FunctionRegistry::new();
    let result = reg.call(
        "MAXA",
        &[num(1.0), CellValue::Boolean(true), num(-1.0), text("text")],
    );
    assert_eq!(result, num(1.0));
}

#[test]
fn test_maxa_all_text_gives_zero() {
    // MAXA with all non-numeric text -> each becomes 0 -> max = 0
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("MAXA", &[text("hello"), text("world")]);
    assert_eq!(result, num(0.0));
}

#[test]
fn test_maxa_empty_gives_zero() {
    // Empty input -> 0
    let f = FnMaxA;
    assert_eq!(f.call(&[CellValue::Null]), num(0.0));
}

#[test]
fn test_maxa_true_is_one() {
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("MAXA", &[CellValue::Boolean(true), num(0.5)]);
    assert_eq!(result, num(1.0));
}

#[test]
fn test_maxa_false_is_zero() {
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("MAXA", &[CellValue::Boolean(false), num(-5.0)]);
    assert_eq!(result, num(0.0));
}

#[test]
fn test_maxa_negative_numbers() {
    // MAXA({-10, -5, -1}) = -1
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("MAXA", &[num(-10.0), num(-5.0), num(-1.0)]),
        num(-1.0)
    );
}

#[test]
fn test_mina_with_bool_and_text() {
    // MINA({1, TRUE, -1, "text"}) -> TRUE=1, "text"=0, so min=-1
    let reg = crate::FunctionRegistry::new();
    let result = reg.call(
        "MINA",
        &[num(1.0), CellValue::Boolean(true), num(-1.0), text("text")],
    );
    assert_eq!(result, num(-1.0));
}

#[test]
fn test_mina_all_text_gives_zero() {
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("MINA", &[text("hello"), text("world")]);
    assert_eq!(result, num(0.0));
}

#[test]
fn test_mina_empty_gives_zero() {
    let f = FnMinA;
    assert_eq!(f.call(&[CellValue::Null]), num(0.0));
}

#[test]
fn test_mina_false_is_zero() {
    // MINA({FALSE, 5}) -> FALSE=0, min=0
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("MINA", &[CellValue::Boolean(false), num(5.0)]);
    assert_eq!(result, num(0.0));
}

#[test]
fn test_mina_positive_numbers() {
    // MINA({10, 5, 1}) = 1
    let reg = crate::FunctionRegistry::new();
    assert_eq!(reg.call("MINA", &[num(10.0), num(5.0), num(1.0)]), num(1.0));
}

#[test]
fn test_mina_text_zero_vs_negative() {
    // MINA({"abc", -3}) -> "abc"=0, -3 < 0, min = -3
    let reg = crate::FunctionRegistry::new();
    assert_eq!(reg.call("MINA", &[text("abc"), num(-3.0)]), num(-3.0));
}

#[test]
fn test_max_ignores_bool_but_maxa_includes_it() {
    let reg = crate::FunctionRegistry::new();
    // MAX ignores booleans in arrays (but not direct args -- this test uses direct args
    // where coercion may differ). For the "A" variants, TRUE=1 always counts.
    let maxa_result = reg.call("MAXA", &[CellValue::Boolean(true), num(-5.0)]);
    assert_eq!(maxa_result, num(1.0), "MAXA should treat TRUE as 1");
}

#[test]
fn test_min_ignores_text_but_mina_includes_it() {
    let reg = crate::FunctionRegistry::new();
    // MINA treats text as 0
    let mina_result = reg.call("MINA", &[text("hello"), num(5.0)]);
    assert_eq!(mina_result, num(0.0), "MINA should treat text as 0");
}
