use super::support::{assert_cell_text, build_snapshot, print_recalc_diagnostics, recalc_snapshot};
use value_types::CellValue;

/// The XLSX corpus uses `_xlfn.IFS(...)`. The parser strips `_xlfn.` prefix,
/// so this should work identically to plain `IFS(...)`.
#[test]
fn test_xlfn_ifs_prefix_stripped() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(
            0,
            0,
            CellValue::Null,
            Some("_xlfn.IFS(TRUE, \"yes\", TRUE, \"no\")"),
        )],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_xlfn_ifs_prefix_stripped", &result);

    assert_cell_text(
        &result,
        0,
        0,
        0,
        "yes",
        "_xlfn.IFS(TRUE, \"yes\", TRUE, \"no\")",
    );
}

/// This is the closest reproduction of the corpus pattern:
///   _xlfn.IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
/// Tests that the _xlfn. prefix is correctly stripped AND the IFS+AND combo works.
#[test]
fn test_xlfn_ifs_with_and_condition() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 = 5
            (0, 0, CellValue::number(5.0), None),
            // B1 = 3
            (0, 1, CellValue::number(3.0), None),
            // C1 = _xlfn.IFS(AND(A1>0, B1>0), "both positive", TRUE, "fallback")
            (
                0,
                2,
                CellValue::Null,
                Some("_xlfn.IFS(AND(A1>0, B1>0), \"both positive\", TRUE, \"fallback\")"),
            ),
        ],
    )]);

    let result = recalc_snapshot(snapshot);

    print_recalc_diagnostics("test_xlfn_ifs_with_and_condition", &result);

    assert_cell_text(
        &result,
        0,
        0,
        2,
        "both positive",
        "_xlfn.IFS(AND(A1>0,B1>0),...) with A1=5,B1=3",
    );
}
