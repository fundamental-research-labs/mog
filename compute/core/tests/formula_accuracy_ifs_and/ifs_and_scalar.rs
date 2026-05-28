use super::support::{
    assert_cell_number, assert_cell_text, build_snapshot, print_recalc_diagnostics, recalc_snapshot,
};
use value_types::CellValue;

/// IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
/// A1=5, B1=3 => AND(5>0, 3>0) = AND(TRUE, TRUE) = TRUE => "both positive"
#[test]
fn test_ifs_with_and_both_positive() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 5
            (0, 0, CellValue::number(5.0), None),
            // B1 = 3
            (0, 1, CellValue::number(3.0), None),
            // C1 = IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
            (
                0,
                2,
                CellValue::Null,
                Some("IFS(AND(A1>0, B1>0), \"both positive\", TRUE, \"fallback\")"),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_with_and_both_positive", &result);

    assert_cell_text(
        &result,
        0,
        0,
        2,
        "both positive",
        "IFS(AND(A1>0,B1>0),...) with A1=5,B1=3",
    );
}

/// IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
/// A1=5, B1=-1 => AND(TRUE, FALSE) = FALSE => skip to TRUE => "fallback"
#[test]
fn test_ifs_with_and_false_falls_through() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 5
            (0, 0, CellValue::number(5.0), None),
            // B1 = -1
            (0, 1, CellValue::number(-1.0), None),
            // C1 = IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
            (
                0,
                2,
                CellValue::Null,
                Some("IFS(AND(A1>0, B1>0), \"both positive\", TRUE, \"fallback\")"),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_with_and_false_falls_through", &result);

    assert_cell_text(
        &result,
        0,
        0,
        2,
        "fallback",
        "IFS(AND(A1>0,B1>0),...) with A1=5,B1=-1",
    );
}

/// A multi-branch IFS where each condition uses AND with cell references:
///   D1 = IFS(
///     AND(A1>10, B1>10), "both large",
///     AND(A1>0, B1>0),   "both positive",
///     TRUE,              "fallback"
///   )
/// With A1=5, B1=3: first AND is false (5<10), second AND is true => "both positive"
#[test]
fn test_ifs_multiple_and_conditions() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 5
            (0, 0, CellValue::number(5.0), None),
            // B1 = 3
            (0, 1, CellValue::number(3.0), None),
            // C1 (not used, placeholder)
            // D1 = IFS(AND(A1>10,B1>10),"both large",AND(A1>0,B1>0),"both positive",TRUE,"fallback")
            (
                0,
                3,
                CellValue::Null,
                Some(
                    "IFS(AND(A1>10,B1>10),\"both large\",AND(A1>0,B1>0),\"both positive\",TRUE,\"fallback\")",
                ),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_multiple_and_conditions", &result);

    assert_cell_text(
        &result,
        0,
        0,
        3,
        "both positive",
        "IFS with multiple AND branches",
    );
}

/// Tests AND where the comparisons involve text. This is a common corpus pattern:
///   IFS(AND(A1="yes", B1="yes"), "both yes", TRUE, "not both")
#[test]
fn test_ifs_and_with_text_comparisons() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = "yes"
            (0, 0, CellValue::Text("yes".into()), None),
            // B1 = "yes"
            (0, 1, CellValue::Text("yes".into()), None),
            // C1 = IFS(AND(A1="yes",B1="yes"),"both yes",TRUE,"not both")
            (
                0,
                2,
                CellValue::Null,
                Some("IFS(AND(A1=\"yes\",B1=\"yes\"),\"both yes\",TRUE,\"not both\")"),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_and_with_text_comparisons", &result);

    assert_cell_text(
        &result,
        0,
        0,
        2,
        "both yes",
        "IFS(AND(A1=\"yes\",B1=\"yes\"),...)",
    );
}

/// IFS can return numeric values, not just text:
///   IFS(AND(A1>0, B1>0), A1+B1, TRUE, 0)
/// A1=10, B1=20 => AND is true => return A1+B1 = 30
#[test]
fn test_ifs_and_with_numeric_results() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 10
            (0, 0, CellValue::number(10.0), None),
            // B1 = 20
            (0, 1, CellValue::number(20.0), None),
            // C1 = IFS(AND(A1>0, B1>0), A1+B1, TRUE, 0)
            (
                0,
                2,
                CellValue::Null,
                Some("IFS(AND(A1>0, B1>0), A1+B1, TRUE, 0)"),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_and_with_numeric_results", &result);

    assert_cell_number(
        &result,
        0,
        0,
        2,
        30.0,
        "IFS(AND(A1>0,B1>0), A1+B1,...) with A1=10,B1=20",
    );
}

/// IFS(AND(A1>0, OR(B1>5, C1>5)), "match", TRUE, "no match")
/// A1=10, B1=2, C1=8 => A1>0=TRUE, OR(FALSE, TRUE)=TRUE, AND(TRUE,TRUE)=TRUE => "match"
#[test]
fn test_ifs_and_or_nested() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 10
            (0, 0, CellValue::number(10.0), None),
            // B1 = 2
            (0, 1, CellValue::number(2.0), None),
            // C1 = 8
            (0, 2, CellValue::number(8.0), None),
            // D1 = IFS(AND(A1>0, OR(B1>5, C1>5)), "match", TRUE, "no match")
            (
                0,
                3,
                CellValue::Null,
                Some("IFS(AND(A1>0, OR(B1>5, C1>5)), \"match\", TRUE, \"no match\")"),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_and_or_nested", &result);

    assert_cell_text(
        &result,
        0,
        0,
        3,
        "match",
        "IFS(AND(A1>0, OR(B1>5,C1>5)),...)",
    );
}
