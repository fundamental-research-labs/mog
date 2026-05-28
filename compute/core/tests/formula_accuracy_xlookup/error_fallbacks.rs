use crate::support::{assert_number, recalc_snapshot, single_sheet_lookup_snapshot};

#[test]
fn test_iferror_xlookup_fallback() {
    let snapshot = single_sheet_lookup_snapshot(vec![
        (0, 2, "IFERROR(XLOOKUP(20,A1:A3,B1:B3),0)"),
        (1, 2, "IFERROR(XLOOKUP(99,A1:A3,B1:B3),0)"),
    ]);

    let result = recalc_snapshot(snapshot);

    assert_number(
        &result,
        0,
        0,
        2,
        200.0,
        "IFERROR should pass through a successful XLOOKUP",
    );
    assert_number(
        &result,
        0,
        1,
        2,
        0.0,
        "IFERROR should convert an uncaught XLOOKUP #N/A miss to zero",
    );
}
