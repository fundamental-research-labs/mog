use super::fixtures::*;
use super::*;

#[test]
fn test_find_sibling_by_value() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // From East/Gadget (row 1), find "Widget" at depth 1 -> East/Widget (row 0)
    let found = hierarchy.find_sibling_by_value(1, 1, &rows, &CellValue::Text("Widget".into()));
    assert_eq!(found, Some(0));

    // From East/Widget (row 0), find "Gadget" at depth 1 -> East/Gadget (row 1)
    let found = hierarchy.find_sibling_by_value(0, 1, &rows, &CellValue::Text("Gadget".into()));
    assert_eq!(found, Some(1));
}

#[test]
fn test_find_sibling_by_value_not_found() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // From East/Widget (row 0), find "Nonexistent" at depth 1 -> None
    let found =
        hierarchy.find_sibling_by_value(0, 1, &rows, &CellValue::Text("Nonexistent".into()));
    assert_eq!(found, None);
}

#[test]
fn test_find_sibling_by_value_scoped_to_parent() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // From West/Widget (row 3), find "Gadget" at depth 1 -> None
    // Gadget only exists under East, not under West.
    let found = hierarchy.find_sibling_by_value(3, 1, &rows, &CellValue::Text("Gadget".into()));
    assert_eq!(found, None);
}

// ---- subtotal_at_depth ----

#[test]
fn test_find_sibling_by_value_unicode_case_insensitive() {
    // "MÜNCHEN" vs "münchen" — Unicode to_lowercase should match.
    // ASCII-only eq_ignore_ascii_case would NOT match the ü/Ü pair.
    let (rows, field_names) = build_single_level_rows(vec![
        CellValue::Text("MÜNCHEN".into()),
        CellValue::Text("Berlin".into()),
    ]);
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Search from row 1 (Berlin) for "münchen" at depth 0.
    let found = hierarchy.find_sibling_by_value(1, 0, &rows, &CellValue::Text("münchen".into()));
    assert_eq!(
        found,
        Some(0),
        "Unicode case-insensitive match should find MÜNCHEN"
    );
}

#[test]
fn test_find_sibling_by_value_blank_unification() {
    // CellValue::Null should equal CellValue::Text("") under cell_value_eq
    // (blank unification), but NOT under PartialEq.
    let (rows, field_names) =
        build_single_level_rows(vec![CellValue::Null, CellValue::Text("Something".into())]);
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Search from row 1 for Text("") at depth 0 — should find the Null row.
    let found = hierarchy.find_sibling_by_value(1, 0, &rows, &CellValue::Text("".into()));
    assert_eq!(
        found,
        Some(0),
        "Blank unification: Null should match empty Text"
    );
}

#[test]
fn test_find_sibling_by_value_epsilon_float() {
    // 1.0000000000001 vs 1.0 — within 1e-12 relative epsilon.
    // Exact bitwise comparison would NOT match.
    let (rows, field_names) = build_single_level_rows(vec![
        CellValue::number(1.0000000000001),
        CellValue::number(999.0),
    ]);
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Search from row 1 for Number(1.0) at depth 0.
    let found = hierarchy.find_sibling_by_value(1, 0, &rows, &CellValue::number(1.0));
    assert_eq!(
        found,
        Some(0),
        "Epsilon float: 1.0000000000001 should match 1.0"
    );
}
