use super::support::{
    assert_cell_error, assert_cell_text, build_snapshot, print_recalc_diagnostics, recalc_snapshot,
};
use value_types::CellValue;

/// `IFS(TRUE, "yes", TRUE, "no")` should return "yes" (first matching pair).
#[test]
fn test_ifs_basic_true_condition() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1: =IFS(TRUE, "yes", TRUE, "no")
            (
                0,
                0,
                CellValue::Null,
                Some("IFS(TRUE, \"yes\", TRUE, \"no\")"),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_basic_true_condition", &result);

    assert_cell_text(&result, 0, 0, 0, "yes", "IFS(TRUE, \"yes\", TRUE, \"no\")");
}

/// `IFS(FALSE, "a", TRUE, "b")` should return "b" (skip first, take second).
#[test]
fn test_ifs_first_false_second_true() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("IFS(FALSE, \"a\", TRUE, \"b\")"),
        )],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_first_false_second_true", &result);

    assert_cell_text(&result, 0, 0, 0, "b", "IFS(FALSE, \"a\", TRUE, \"b\")");
}

/// `IFS(FALSE, "a", FALSE, "b")` — no condition matches, should return #N/A.
#[test]
fn test_ifs_all_false_returns_na() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("IFS(FALSE, \"a\", FALSE, \"b\")"),
        )],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_all_false_returns_na", &result);

    assert_cell_error(&result, 0, 0, 0, "IFS all false -> #N/A");
}

/// `IFS(1/0, "a", TRUE, "b")` — first condition is #DIV/0!, should propagate.
#[test]
fn test_ifs_error_in_condition_propagates() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("IFS(1/0, \"a\", TRUE, \"b\")"))],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_error_in_condition_propagates", &result);

    assert_cell_error(&result, 0, 0, 0, "IFS(1/0, ...) -> #DIV/0!");
}

/// IFS(1, "one is truthy") — the number 1 should coerce to TRUE for IFS.
#[test]
fn test_ifs_numeric_condition_coercion() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("IFS(1, \"one is truthy\")"))],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_numeric_condition_coercion", &result);

    assert_cell_text(
        &result,
        0,
        0,
        0,
        "one is truthy",
        "IFS(1, \"one is truthy\")",
    );
}

/// IFS(0, "zero", TRUE, "fallback") — 0 coerces to FALSE, should skip to fallback.
#[test]
fn test_ifs_zero_condition_is_false() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("IFS(0, \"zero\", TRUE, \"fallback\")"),
        )],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_zero_condition_is_false", &result);

    assert_cell_text(
        &result,
        0,
        0,
        0,
        "fallback",
        "IFS(0, \"zero\", TRUE, \"fallback\")",
    );
}
