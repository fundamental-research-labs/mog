use super::support::{assert_cell_text, build_snapshot, print_recalc_diagnostics, recalc_snapshot};
use value_types::CellValue;

/// IFS formula on Sheet1 referencing cells on Sheet2:
///   Sheet1!A1 = IFS(AND(Sheet2!A1>0, Sheet2!B1>0), "both pos", TRUE, "no")
///   Sheet2!A1 = 5, Sheet2!B1 = 10
#[test]
fn test_ifs_and_cross_sheet() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(
                0,
                0,
                CellValue::Null,
                Some("IFS(AND(Sheet2!A1>0, Sheet2!B1>0), \"both pos\", TRUE, \"no\")"),
            )],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![
                // A1 = 5
                (0, 0, CellValue::number(5.0), None),
                // B1 = 10
                (0, 1, CellValue::number(10.0), None),
            ],
        ),
    ]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_and_cross_sheet", &result);

    assert_cell_text(
        &result,
        0,
        0,
        0,
        "both pos",
        "Cross-sheet IFS(AND(Sheet2!A1>0,Sheet2!B1>0),...)",
    );
}

/// Simulates a more realistic scenario with data in rows and a formula row:
///   Row 1: data values
///   Row 2: IFS formula referencing row 1 cells
///
///   A1=100, B1=50, C1="Active"
///   A2 = IFS(AND(A1>=100, B1>=50, C1="Active"), "Qualified",
///            AND(A1>=50, B1>=25), "Partial",
///            TRUE, "Not qualified")
/// Expected: "Qualified"
#[test]
fn test_ifs_and_corpus_like_pattern() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 100
            (0, 0, CellValue::number(100.0), None),
            // B1 = 50
            (0, 1, CellValue::number(50.0), None),
            // C1 = "Active"
            (0, 2, CellValue::Text("Active".into()), None),
            // A2 = IFS(AND(A1>=100,B1>=50,C1="Active"),"Qualified",AND(A1>=50,B1>=25),"Partial",TRUE,"Not qualified")
            (
                1,
                0,
                CellValue::Null,
                Some(
                    "IFS(AND(A1>=100,B1>=50,C1=\"Active\"),\"Qualified\",AND(A1>=50,B1>=25),\"Partial\",TRUE,\"Not qualified\")",
                ),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_and_corpus_like_pattern", &result);

    assert_cell_text(
        &result,
        0,
        1,
        0,
        "Qualified",
        "Corpus-like IFS(AND(>=100,>=50,=\"Active\"),...)",
    );
}

/// A1=75, B1=30, C1="Inactive"
/// First AND: AND(75>=100, 30>=50, "Inactive"="Active") = AND(FALSE,...) = FALSE
/// Second AND: AND(75>=50, 30>=25) = AND(TRUE, TRUE) = TRUE => "Partial"
#[test]
fn test_ifs_and_corpus_like_second_branch() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::number(75.0), None),
            (0, 1, CellValue::number(30.0), None),
            (0, 2, CellValue::Text("Inactive".into()), None),
            (
                1,
                0,
                CellValue::Null,
                Some(
                    "IFS(AND(A1>=100,B1>=50,C1=\"Active\"),\"Qualified\",AND(A1>=50,B1>=25),\"Partial\",TRUE,\"Not qualified\")",
                ),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_and_corpus_like_second_branch", &result);

    assert_cell_text(&result, 0, 1, 0, "Partial", "Corpus-like IFS second branch");
}

/// A1=10, B1=5, C1="Gone"
/// First AND: FALSE (10<100)
/// Second AND: AND(10>=50, 5>=25) = AND(FALSE, FALSE) = FALSE
/// Falls to TRUE => "Not qualified"
#[test]
fn test_ifs_and_corpus_like_fallthrough() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (0, 1, CellValue::number(5.0), None),
            (0, 2, CellValue::Text("Gone".into()), None),
            (
                1,
                0,
                CellValue::Null,
                Some(
                    "IFS(AND(A1>=100,B1>=50,C1=\"Active\"),\"Qualified\",AND(A1>=50,B1>=25),\"Partial\",TRUE,\"Not qualified\")",
                ),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_ifs_and_corpus_like_fallthrough", &result);

    assert_cell_text(
        &result,
        0,
        1,
        0,
        "Not qualified",
        "Corpus-like IFS fallthrough to TRUE",
    );
}
