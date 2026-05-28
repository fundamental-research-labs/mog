use value_types::CellValue;

use crate::helpers::criteria::parse_criteria;

// -----------------------------------------------------------------------
// PENDING FIXES — COUNTIF wildcard and mixed-type edge cases
//
// These tests encode the CORRECT Excel behavior for open bugs. They are
// marked #[ignore] so `cargo test` stays green; run them explicitly with:
//   cargo test -p compute-functions --lib -- --ignored test_pending_fix_
// Each test MUST start passing once the documented fix lands; the
// existing "current-buggy-behavior" tests above will need to be updated
// or removed as part of that fix.
// -----------------------------------------------------------------------

/// FT-017 — Excel's mixed-type ordering: any Text is "greater than" any
/// Number. So `COUNTIF(range, ">-999%")` must count Text cells (e.g. "—")
/// as matching. Current code hard-codes `Text(_) => false` at
/// `criteria.rs:244-249` for the `>` numeric branch.
#[test]
#[ignore = "pending resolution: text-vs-number in COUNTIF is inconsistent across corpus files"]
fn test_pending_fix_gt_numeric_matches_text_cells() {
    // ">-999%" parses to "> -9.99". Excel type ordering: text > any number.
    let crit = parse_criteria(&CellValue::Text(">-999%".into()));
    // Text cells MUST match (Excel counts them).
    assert!(
        crit(&CellValue::Text("—".into())),
        "FT-017: Text(\"—\") must match \">-999%\" (text > any number)"
    );
    assert!(
        crit(&CellValue::Text("hello".into())),
        "FT-017: any Text must match \">-999%\" (text > any number)"
    );
    assert!(
        crit(&CellValue::Text("".into())),
        "FT-017: even empty Text must match \">-999%\" (text > any number)"
    );
    // Numeric participants still behave normally.
    assert!(crit(&CellValue::number(0.0)));
    assert!(!crit(&CellValue::number(-100.0)));
}

/// FT-017 — same bug, `>=` numeric branch.
#[test]
#[ignore = "pending resolution: text-vs-number in COUNTIF is inconsistent across corpus files"]
fn test_pending_fix_gte_numeric_matches_text_cells() {
    let crit = parse_criteria(&CellValue::Text(">=0".into()));
    assert!(
        crit(&CellValue::Text("hello".into())),
        "FT-017: Text must match \">=0\" (text > any number)"
    );
    assert!(
        crit(&CellValue::Text("—".into())),
        "FT-017: Text(\"—\") must match \">=0\" (text > any number)"
    );
}

/// FT-016 — Excel's `COUNTIF(range, "<>0")` counts empty (Null) cells as
/// matching. Current code at `criteria.rs:213` in the `strip_prefix("<>")`
/// branch returns `false` for Null (non-participation).
#[test]
#[ignore = "pending fix: COUNTIF numeric not-equal should match empty cells"]
fn test_pending_fix_ne_numeric_matches_null() {
    // "<>0" must count empty cells (they are "not equal to 0" in Excel).
    let crit = parse_criteria(&CellValue::Text("<>0".into()));
    assert!(
        crit(&CellValue::Null),
        "FT-016: Null must match \"<>0\" (empty ≠ 0 in Excel COUNTIF)"
    );

    // Also applies to other numeric comparands.
    let crit = parse_criteria(&CellValue::Text("<>5".into()));
    assert!(
        crit(&CellValue::Null),
        "FT-016: Null must match \"<>5\" (empty ≠ 5 in Excel COUNTIF)"
    );
}

/// FT-022 — `SUMPRODUCT((range<=0)*1)` off by one because empty cells
/// aren't counted. The criteria predicate for `"<=0"` must match Null
/// (Excel treats empty as 0, and 0 <= 0 is true). Encoded at the
/// criteria-predicate layer; the SUMPRODUCT call path uses the same
/// family of comparisons (see operators.rs cell_value_cmp, which already
/// coerces Null→0, but the COUNTIF/range-flatten path drops Nulls).
#[test]
#[ignore = "pending fix: COUNTIF/SUMPRODUCT numeric less-than-or-equal should match empty cells"]
fn test_pending_fix_lte_numeric_matches_null() {
    // "<=0" must match empty cells (empty coerces to 0, 0 <= 0 is true).
    let crit = parse_criteria(&CellValue::Text("<=0".into()));
    assert!(
        crit(&CellValue::Null),
        "FT-022: Null must match \"<=0\" (empty coerces to 0)"
    );

    // And for "<=N" with N >= 0.
    let crit = parse_criteria(&CellValue::Text("<=5".into()));
    assert!(
        crit(&CellValue::Null),
        "FT-022: Null must match \"<=5\" (empty coerces to 0, 0 <= 5)"
    );
}
