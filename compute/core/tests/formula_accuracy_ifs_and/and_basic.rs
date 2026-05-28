use super::support::{assert_cell_bool, build_snapshot, print_recalc_diagnostics, recalc_snapshot};
use value_types::CellValue;

/// `AND(TRUE, TRUE, TRUE)` should return TRUE.
#[test]
fn test_and_all_true() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("AND(TRUE, TRUE, TRUE)"))],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_and_all_true", &result);

    assert_cell_bool(&result, 0, 0, 0, true, "AND(TRUE, TRUE, TRUE)");
}

/// `AND(TRUE, FALSE, TRUE)` should return FALSE.
#[test]
fn test_and_one_false() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("AND(TRUE, FALSE, TRUE)"))],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_and_one_false", &result);

    assert_cell_bool(&result, 0, 0, 0, false, "AND(TRUE, FALSE, TRUE)");
}

/// `AND(1, 1, 1)` — non-zero numbers are truthy, should return TRUE.
#[test]
fn test_and_with_numbers() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("AND(1, 1, 1)"))],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_and_with_numbers", &result);

    assert_cell_bool(&result, 0, 0, 0, true, "AND(1, 1, 1)");
}

/// `AND(1, 0, 1)` — zero is falsy, should return FALSE.
#[test]
fn test_and_with_zero() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("AND(1, 0, 1)"))],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_and_with_zero", &result);

    assert_cell_bool(&result, 0, 0, 0, false, "AND(1, 0, 1)");
}

/// AND(A1, A2) where A2 is empty (Null). In Excel, AND ignores empty cells
/// in reference arguments, so AND(TRUE, <empty>) => AND(TRUE) => TRUE.
#[test]
fn test_and_with_null_cell() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = TRUE
            (0, 0, CellValue::Boolean(true), None),
            // A2 is empty (not in cells vec)
            // B1 = AND(A1, A2)
            (0, 1, CellValue::Null, Some("AND(A1, A2)")),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_and_with_null_cell", &result);

    // AND ignores empty cells in reference arguments, so AND(TRUE) = TRUE
    assert_cell_bool(&result, 0, 0, 1, true, "AND(TRUE, <empty>) = TRUE");
}
