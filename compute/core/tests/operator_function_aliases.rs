//! Production-path tests for Google Sheets operator function aliases.

#![allow(dead_code)]
mod stress_common;
use stress_common::*;

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use value_types::{CellError, CellValue};

fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

fn value_at(mirror: &CellMirror, row: u32, col: u32) -> CellValue {
    mirror
        .get_cell_value_at(&sid(0), cell_types::SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

fn assert_value_eq(actual: &CellValue, expected: &CellValue) {
    match (actual, expected) {
        (CellValue::Number(a), CellValue::Number(e)) => {
            assert!(
                (a.get() - e.get()).abs() < 1e-9,
                "expected {e:?}, got {a:?}"
            );
        }
        (CellValue::Text(a), CellValue::Text(e)) => assert_eq!(a.as_ref(), e.as_ref()),
        (CellValue::Boolean(a), CellValue::Boolean(e)) => assert_eq!(a, e),
        (CellValue::Null, CellValue::Null) => {}
        (CellValue::Error(a, _), CellValue::Error(e, _)) => assert_eq!(a, e),
        _ => panic!("expected {expected:?}, got {actual:?}"),
    }
}

#[test]
fn value_aliases_match_operator_formulas() {
    let formulas = [
        ("ADD(A1,B1)", "A1+B1", CellValue::number(9.0)),
        ("MINUS(A1,B1)", "A1-B1", CellValue::number(3.0)),
        ("MULTIPLY(A1,B1)", "A1*B1", CellValue::number(18.0)),
        ("DIVIDE(A1,B1)", "A1/B1", CellValue::number(2.0)),
        ("POW(A1,B1)", "A1^B1", CellValue::number(216.0)),
        ("EQ(A1,B1)", "A1=B1", CellValue::Boolean(false)),
        ("NE(A1,B1)", "A1<>B1", CellValue::Boolean(true)),
        ("GT(A1,B1)", "A1>B1", CellValue::Boolean(true)),
        ("GTE(A1,B1)", "A1>=B1", CellValue::Boolean(true)),
        ("LT(A1,B1)", "A1<B1", CellValue::Boolean(false)),
        ("LTE(A1,B1)", "A1<=B1", CellValue::Boolean(false)),
        ("UMINUS(A1)", "-A1", CellValue::number(-6.0)),
        ("UPLUS(A1)", "+A1", CellValue::number(6.0)),
        ("UNARY_PERCENT(A1)", "A1%", CellValue::number(0.06)),
    ];

    let mut cells = vec![
        (0, 0, CellValue::number(6.0), None),
        (0, 1, CellValue::number(3.0), None),
    ];
    for (idx, (alias, operator, _)) in formulas.iter().enumerate() {
        let row = idx as u32;
        cells.push((row, 2, CellValue::Null, Some(*alias)));
        cells.push((row, 3, CellValue::Null, Some(*operator)));
    }

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    core.init_from_snapshot(&mut mirror, build_snapshot(vec![("Sheet1", 40, 8, cells)]))
        .unwrap();

    for (idx, (_, _, expected)) in formulas.iter().enumerate() {
        let row = idx as u32;
        let alias_value = value_at(&mirror, row, 2);
        let operator_value = value_at(&mirror, row, 3);
        assert_value_eq(&alias_value, &operator_value);
        assert_value_eq(&alias_value, expected);
    }
}

#[test]
fn aliases_inherit_coercion_errors_and_case_insensitive_dispatch() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        20,
        10,
        vec![
            (0, 0, text("5"), None),
            (0, 1, CellValue::Boolean(true), None),
            (0, 2, CellValue::Null, None),
            (0, 3, text("x"), None),
            (1, 0, CellValue::Null, Some("add(A1,B1)")),
            (1, 1, CellValue::Null, Some("A1+B1")),
            (2, 0, CellValue::Null, Some("UPLUS(D1)")),
            (2, 1, CellValue::Null, Some("+D1")),
            (3, 0, CellValue::Null, Some("UPLUS(C1)")),
            (3, 1, CellValue::Null, Some("+C1")),
            (4, 0, CellValue::Null, Some("Gt(A1,B1)")),
            (4, 1, CellValue::Null, Some("A1>B1")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    for row in 1..=4 {
        assert_value_eq(&value_at(&mirror, row, 0), &value_at(&mirror, row, 1));
    }
    assert_value_eq(&value_at(&mirror, 1, 0), &CellValue::number(6.0));
    assert_value_eq(&value_at(&mirror, 2, 0), &text("x"));
    assert_value_eq(&value_at(&mirror, 3, 0), &CellValue::number(0.0));
    assert_value_eq(&value_at(&mirror, 4, 0), &CellValue::Boolean(false));
}

#[test]
fn wrong_arity_is_value_error_before_argument_evaluation() {
    let cases = [
        "ADD()",
        "ADD(1)",
        "ADD(1,2,3)",
        "ADD(1/0)",
        "ADD(1,2,1/0)",
        "ADD(UNKNOWN_NAME)",
        "UMINUS()",
        "UMINUS(1,2)",
        "UMINUS(1/0,2)",
    ];
    let cells = cases
        .iter()
        .enumerate()
        .map(|(idx, formula)| (idx as u32, 0, CellValue::Null, Some(*formula)))
        .collect();

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    core.init_from_snapshot(&mut mirror, build_snapshot(vec![("Sheet1", 20, 4, cells)]))
        .unwrap();

    for idx in 0..cases.len() as u32 {
        assert_mirror_error(&mirror, 0, idx, 0, CellError::Value);
    }
}

#[test]
fn array_returning_aliases_spill_like_operator_formulas() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        20,
        10,
        vec![
            (0, 0, CellValue::number(1.0), None),
            (1, 0, CellValue::number(2.0), None),
            (2, 0, CellValue::number(3.0), None),
            (0, 1, CellValue::number(10.0), None),
            (1, 1, CellValue::number(20.0), None),
            (2, 1, CellValue::number(30.0), None),
            (0, 2, CellValue::Null, Some("ADD(A1:A3,1)")),
            (0, 3, CellValue::Null, Some("A1:A3+1")),
            (0, 4, CellValue::Null, Some("MULTIPLY(A1:A3,B1:B3)")),
            (0, 5, CellValue::Null, Some("A1:A3*B1:B3")),
            (0, 6, CellValue::Null, Some("GT(B1:B3,15)")),
            (0, 7, CellValue::Null, Some("B1:B3>15")),
            (0, 8, CellValue::Null, Some("UMINUS(A1:A3)")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    for row in 0..3 {
        assert_value_eq(&value_at(&mirror, row, 2), &value_at(&mirror, row, 3));
        assert_value_eq(&value_at(&mirror, row, 4), &value_at(&mirror, row, 5));
        assert_value_eq(&value_at(&mirror, row, 6), &value_at(&mirror, row, 7));
    }
    assert_pos_number(&mirror, 0, 0, 2, 2.0);
    assert_pos_number(&mirror, 0, 1, 2, 3.0);
    assert_pos_number(&mirror, 0, 2, 2, 4.0);
    assert_pos_number(&mirror, 0, 0, 8, -1.0);
    assert_pos_number(&mirror, 0, 1, 8, -2.0);
    assert_pos_number(&mirror, 0, 2, 8, -3.0);
}

#[test]
fn pow_alias_uses_caret_operator_semantics() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        20,
        8,
        vec![
            (0, 0, CellValue::Null, Some("POW(-8,1/3)")),
            (0, 1, CellValue::Null, Some("(-8)^(1/3)")),
            (1, 0, CellValue::Null, Some("POW(0,0)")),
            (1, 1, CellValue::Null, Some("0^0")),
            (2, 0, CellValue::Null, Some("POW(10,400)")),
            (2, 1, CellValue::Null, Some("10^400")),
            (3, 0, CellValue::Null, Some("POW(0,-1)")),
            (3, 1, CellValue::Null, Some("0^-1")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    for row in 0..=3 {
        assert_value_eq(&value_at(&mirror, row, 0), &value_at(&mirror, row, 1));
    }
    assert_pos_number(&mirror, 0, 0, 0, -2.0);
    assert_mirror_error(&mirror, 0, 1, 0, CellError::Num);
    assert_mirror_error(&mirror, 0, 2, 0, CellError::Num);
    assert_mirror_error(&mirror, 0, 3, 0, CellError::Div0);
}

#[test]
fn concat_keeps_existing_variadic_text_function_contract() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        20,
        10,
        vec![
            (0, 0, text("a"), None),
            (0, 1, text("b"), None),
            (1, 0, CellValue::number(1.0), None),
            (1, 1, CellValue::Boolean(true), None),
            (2, 0, CellValue::Null, Some("CONCAT(A1,B1)")),
            (2, 1, CellValue::Null, Some("A1&B1")),
            (3, 0, CellValue::Null, Some("CONCAT(\"a\")")),
            (4, 0, CellValue::Null, Some("CONCAT(\"a\",\"b\",\"c\")")),
            (5, 0, CellValue::Null, Some("CONCAT(A1:B1)")),
            (6, 0, CellValue::Null, Some("CONCAT(A2,B2)")),
            (6, 1, CellValue::Null, Some("A2&B2")),
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_value_eq(&value_at(&mirror, 2, 0), &value_at(&mirror, 2, 1));
    assert_value_eq(&value_at(&mirror, 6, 0), &value_at(&mirror, 6, 1));
    assert_mirror_text(&mirror, 0, 3, 0, "a");
    assert_mirror_text(&mirror, 0, 4, 0, "abc");
    assert_mirror_text(&mirror, 0, 5, 0, "ab");
}
