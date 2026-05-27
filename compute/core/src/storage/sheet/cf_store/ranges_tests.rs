use super::test_support::*;
use super::*;

#[test]
fn test_update_ranges() {
    let (storage, sheet_id) = storage_with_sheet();
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        ),
    );
    let new_ranges = vec![rng(10, 10, 20, 20), rng(30, 30, 40, 40)];
    assert!(update_cf_ranges(
        storage.doc(),
        &storage.sheets_ref(),
        "cf1",
        &sheet_id,
        &new_ranges
    ));
    let result =
        get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id).unwrap();
    assert_eq!(result.ranges.len(), 2);
    assert_eq!(result.ranges[0].start_row(), 10);
    assert_eq!(result.ranges[1].start_row(), 30);
}

#[test]
fn test_update_ranges_empty_deletes_format() {
    let (storage, sheet_id) = storage_with_sheet();
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        ),
    );
    assert!(update_cf_ranges(
        storage.doc(),
        &storage.sheets_ref(),
        "cf1",
        &sheet_id,
        &[]
    ));
    assert!(
        get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id).is_none()
    );
}

#[test]
fn test_ranges_overlap() {
    assert!(cf_ranges_overlap(&rng(0, 0, 5, 5), &rng(3, 3, 8, 8)));
    assert!(!cf_ranges_overlap(&rng(0, 0, 5, 5), &rng(6, 0, 10, 5)));
    assert!(cf_ranges_overlap(&rng(0, 0, 5, 5), &rng(0, 0, 5, 5)));
    assert!(cf_ranges_overlap(&rng(0, 0, 5, 5), &rng(5, 5, 10, 10)));
    assert!(!cf_ranges_overlap(&rng(0, 0, 5, 5), &rng(0, 6, 5, 10)));
}

#[test]
fn test_range_contains() {
    assert!(cf_range_contains(&rng(0, 0, 10, 10), &rng(2, 2, 8, 8)));
    assert!(cf_range_contains(&rng(0, 0, 5, 5), &rng(0, 0, 5, 5)));
    assert!(!cf_range_contains(&rng(2, 2, 8, 8), &rng(0, 0, 10, 10)));
    assert!(!cf_range_contains(&rng(0, 0, 5, 5), &rng(3, 3, 8, 8)));
}

#[test]
fn test_subtract_no_overlap() {
    let result = cf_subtract_range(&rng(0, 0, 5, 5), &rng(10, 10, 15, 15));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], rng(0, 0, 5, 5));
}

#[test]
fn test_subtract_full_contain() {
    let result = cf_subtract_range(&rng(2, 2, 8, 8), &rng(0, 0, 10, 10));
    assert!(result.is_empty());
}

#[test]
fn test_subtract_top_strip() {
    let result = cf_subtract_range(&rng(0, 0, 9, 3), &rng(5, 0, 9, 3));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], rng(0, 0, 4, 3));
}

#[test]
fn test_subtract_bottom_strip() {
    let result = cf_subtract_range(&rng(0, 0, 9, 3), &rng(0, 0, 4, 3));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], rng(5, 0, 9, 3));
}

#[test]
fn test_subtract_left_strip() {
    let result = cf_subtract_range(&rng(0, 0, 5, 5), &rng(0, 3, 5, 5));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], rng(0, 0, 5, 2));
}

#[test]
fn test_subtract_right_strip() {
    let result = cf_subtract_range(&rng(0, 0, 5, 5), &rng(0, 0, 5, 2));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], rng(0, 3, 5, 5));
}

#[test]
fn test_subtract_center_produces_4_strips() {
    let result = cf_subtract_range(&rng(0, 0, 9, 3), &rng(4, 1, 7, 2));
    assert_eq!(result.len(), 4);
    assert!(result.contains(&rng(0, 0, 3, 3)));
    assert!(result.contains(&rng(8, 0, 9, 3)));
    assert!(result.contains(&rng(4, 0, 7, 0)));
    assert!(result.contains(&rng(4, 3, 7, 3)));
}

#[test]
fn test_intersect_ranges() {
    assert_eq!(
        cf_intersect_ranges(&rng(0, 0, 5, 5), &rng(3, 3, 8, 8)),
        Some(rng(3, 3, 5, 5))
    );
}

#[test]
fn test_intersect_no_overlap() {
    assert!(cf_intersect_ranges(&rng(0, 0, 5, 5), &rng(10, 10, 15, 15)).is_none());
}

#[test]
fn test_is_valid_range() {
    assert!(cf_is_valid_range(&rng(0, 0, 5, 5)));
    assert!(cf_is_valid_range(&rng(3, 3, 3, 3)));
    // SheetRange::new normalizes inverted coords, so all ranges are valid
    assert!(cf_is_valid_range(&rng(5, 0, 3, 5)));
    assert!(cf_is_valid_range(&rng(0, 5, 5, 3)));
}

#[test]
fn test_cell_in_multiple_ranges() {
    let (storage, sheet_id) = storage_with_sheet();
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 5, 5), rng(10, 10, 15, 15)],
            vec![make_rule("r1", 1)],
        ),
    );
    assert!(has_cf_for_cell(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        3,
        3
    ));
    assert!(has_cf_for_cell(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        12,
        12
    ));
    assert!(!has_cf_for_cell(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        7,
        7
    ));
}

// =====================================================================
// Range-backed CF: cfRules shared rule body store tests
// =====================================================================

#[test]
fn test_geometry_helpers_with_range_extent() {
    let region_a = rng(0, 0, 5, 3);
    let region_b = rng(3, 2, 8, 6);
    assert!(cf_ranges_overlap(&region_a, &region_b));
    assert_eq!(
        cf_intersect_ranges(&region_a, &region_b),
        Some(rng(3, 2, 5, 3))
    );
    let strips = cf_subtract_range(&region_a, &region_b);
    assert!(!strips.is_empty());
    for strip in &strips {
        assert!(cf_is_valid_range(strip));
    }
    assert!(cf_range_contains(&rng(0, 0, 10, 10), &region_a));
    assert!(!cf_range_contains(&region_a, &rng(0, 0, 10, 10)));
}
