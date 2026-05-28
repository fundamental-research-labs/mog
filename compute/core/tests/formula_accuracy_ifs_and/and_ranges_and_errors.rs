use super::support::{
    assert_cell_bool, assert_cell_error, assert_cell_text, build_snapshot, find_changed_value,
    print_recalc_diagnostics, recalc_snapshot,
};
use value_types::CellValue;

/// AND can take a range: AND(A1:A3) where all cells are truthy.
/// A1=1, A2=1, A3=1 => AND(1,1,1) = TRUE
/// This tests eval_and_flatten with range arguments.
#[test]
fn test_and_with_cell_range() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 1
            (0, 0, CellValue::number(1.0), None),
            // A2 = 1
            (1, 0, CellValue::number(1.0), None),
            // A3 = 1
            (2, 0, CellValue::number(1.0), None),
            // B1 = AND(A1:A3)
            (0, 1, CellValue::Null, Some("AND(A1:A3)")),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_and_with_cell_range", &result);

    assert_cell_bool(&result, 0, 0, 1, true, "AND(A1:A3) with all 1s");
}

/// AND(A1:A3) where A2=0 => FALSE
#[test]
fn test_and_with_range_containing_zero() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 1
            (0, 0, CellValue::number(1.0), None),
            // A2 = 0
            (1, 0, CellValue::number(0.0), None),
            // A3 = 1
            (2, 0, CellValue::number(1.0), None),
            // B1 = AND(A1:A3)
            (0, 1, CellValue::Null, Some("AND(A1:A3)")),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_and_with_range_containing_zero", &result);

    assert_cell_bool(&result, 0, 0, 1, false, "AND(A1:A3) with A2=0");
}

/// AND(A1:A3) where A2 has a static error value => should propagate the error.
/// Uses a static CellValue::Error rather than a formula to avoid dependency
/// ordering issues.
#[test]
fn test_and_with_range_containing_static_error() {
    use value_types::CellError;

    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 1
            (0, 0, CellValue::number(1.0), None),
            // A2 = #DIV/0! (static error value, no formula)
            (1, 0, CellValue::Error(CellError::Div0, None), None),
            // A3 = 1
            (2, 0, CellValue::number(1.0), None),
            // B1 = AND(A1:A3)
            (0, 1, CellValue::Null, Some("AND(A1:A3)")),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_and_with_range_containing_static_error", &result);

    assert_cell_error(&result, 0, 0, 1, "AND(A1:A3) with static error in A2");
}

/// AND(A1:A3) where A2 has a FORMULA that produces #DIV/0!
/// BUG: If the scheduler evaluates B1 (AND formula) before A2 (1/0 formula),
/// the range A1:A3 sees Null for A2 instead of the computed error. This
/// causes AND to return FALSE (Null coerces to false) instead of #DIV/0!.
/// This test documents this potential dependency ordering issue.
#[test]
fn test_and_with_range_containing_formula_error() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 1
            (0, 0, CellValue::number(1.0), None),
            // A2 = 1/0 (formula producing #DIV/0!)
            (1, 0, CellValue::Null, Some("1/0")),
            // A3 = 1
            (2, 0, CellValue::number(1.0), None),
            // B1 = AND(A1:A3)
            (0, 1, CellValue::Null, Some("AND(A1:A3)")),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_and_with_range_containing_formula_error", &result);

    // Ideally AND should propagate the #DIV/0! error from A2.
    // If the scheduler correctly orders A2 before B1, this will be Error(Div0).
    // If there's a dependency ordering bug, it may return Boolean(false) because
    // the range sees Null for A2 before A2's formula is evaluated.
    let val = find_changed_value(&result, 0, 0, 1);
    match val {
        Some(CellValue::Error(..)) => {
            println!("PASS: AND correctly propagated the error from A2's formula");
        }
        Some(CellValue::Boolean(false)) => {
            // This indicates a dependency ordering issue: B1 was evaluated before
            // A2's formula, so the range saw Null instead of #DIV/0!.
            // This is a known issue that may contribute to the IFS+AND corpus errors.
            panic!(
                "BUG: AND(A1:A3) returned FALSE instead of propagating A2's #DIV/0! error. \
                 This suggests the scheduler evaluated B1 before A2, so the range saw \
                 Null for A2 instead of the computed #DIV/0! error. This dependency \
                 ordering issue may be the root cause of the IFS+AND corpus errors."
            );
        }
        other => panic!(
            "AND(A1:A3) with formula error in A2: unexpected result {:?}",
            other
        ),
    }
}

/// IFS(AND(A1:A3), "all true", TRUE, "not all")
/// A1=TRUE, A2=TRUE, A3=TRUE => AND is true => "all true"
#[test]
fn test_ifs_and_with_range_argument() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = TRUE
            (0, 0, CellValue::Boolean(true), None),
            // A2 = TRUE
            (1, 0, CellValue::Boolean(true), None),
            // A3 = TRUE
            (2, 0, CellValue::Boolean(true), None),
            // B1 = IFS(AND(A1:A3), "all true", TRUE, "not all")
            (
                0,
                1,
                CellValue::Null,
                Some("IFS(AND(A1:A3), \"all true\", TRUE, \"not all\")"),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_and_with_range_argument", &result);

    assert_cell_text(
        &result,
        0,
        0,
        1,
        "all true",
        "IFS(AND(A1:A3),...) with all TRUE",
    );
}

/// IFS(AND(A1>0, B1>0), "ok", TRUE, "fallback")
/// A1=5, B1=#DIV/0! => AND evaluates B1>0 which should propagate the error,
/// and IFS should propagate it through.
#[test]
fn test_ifs_with_and_error_propagation() {
    use value_types::CellError;

    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 5
            (0, 0, CellValue::number(5.0), None),
            // B1 = 1/0 (formula that produces #DIV/0!)
            (0, 1, CellValue::Null, Some("1/0")),
            // C1 = IFS(AND(A1>0, B1>0), "ok", TRUE, "fallback")
            (
                0,
                2,
                CellValue::Null,
                Some("IFS(AND(A1>0, B1>0), \"ok\", TRUE, \"fallback\")"),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_with_and_error_propagation", &result);

    // B1 should be #DIV/0!
    let b1_val = find_changed_value(&result, 0, 0, 1);
    match b1_val {
        Some(CellValue::Error(CellError::Div0, None)) => { /* expected */ }
        other => panic!("B1 should be #DIV/0!, got {:?}", other),
    }

    // C1: AND(A1>0, B1>0) where B1 is an error.
    // The comparison B1>0 should propagate the #DIV/0! error through AND,
    // and IFS should propagate it further.
    let err = assert_cell_error(&result, 0, 0, 2, "IFS+AND error propagation");
    match err {
        CellValue::Error(CellError::Div0, None) => { /* correct: #DIV/0! propagated */ }
        CellValue::Error(other, _) => {
            // The error propagated but was a different type — still note it
            println!(
                "NOTE: Expected #DIV/0! but got a different error: {:?}",
                other
            );
        }
        _ => unreachable!(),
    }
}
