use super::super::types::TableRange;
use super::test_fixtures::make_test_table;
use super::*;

// ---- Range Queries ----

#[test]
fn get_header_range_with_header() {
    let t = make_test_table(); // header row, range 0-10
    let r = get_header_range(&t).unwrap();
    assert_eq!(r.start_row(), 0);
    assert_eq!(r.end_row(), 0);
    assert_eq!(r.start_col(), 0);
    assert_eq!(r.end_col(), 2);
}

#[test]
fn get_header_range_no_header() {
    let t = create_table(
        "T1",
        "s1",
        TableRange::new(0, 0, 5, 1),
        &["A", "B"],
        Some(CreateTableOptions {
            has_header_row: Some(false),
            ..Default::default()
        }),
    )
    .unwrap();
    assert!(get_header_range(&t).is_none());
}

#[test]
fn get_data_range_basic() {
    let t = make_test_table(); // header at row 0, no totals, range 0-10
    let r = get_data_range(&t).unwrap();
    assert_eq!(r.start_row(), 1); // after header
    assert_eq!(r.end_row(), 10);
    assert_eq!(r.start_col(), 0);
    assert_eq!(r.end_col(), 2);
}

#[test]
fn get_data_range_with_totals() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    // Range row 0-10: header at 0, totals at 10, data 1-9
    let r = get_data_range(&t).unwrap();
    assert_eq!(r.start_row(), 1);
    assert_eq!(r.end_row(), 9);
}

#[test]
fn get_data_range_header_plus_totals_only_returns_none() {
    // BUG FIX TEST: table with header + totals but no data rows should return None
    let t = create_table(
        "T1",
        "s1",
        TableRange::new(0, 0, 1, 1),
        &["A", "B"],
        Some(CreateTableOptions {
            has_header_row: Some(true),
            has_totals_row: Some(true),
            ..Default::default()
        }),
    )
    .unwrap();
    // header at row 0, totals at row 1, data would be row 1..0 which is inverted
    assert!(get_data_range(&t).is_none());
}

#[test]
fn get_data_range_no_header_no_totals() {
    let t = create_table(
        "T1",
        "s1",
        TableRange::new(5, 2, 15, 4),
        &["A", "B", "C"],
        Some(CreateTableOptions {
            has_header_row: Some(false),
            has_totals_row: Some(false),
            ..Default::default()
        }),
    )
    .unwrap();
    let r = get_data_range(&t).unwrap();
    assert_eq!(r.start_row(), 5);
    assert_eq!(r.end_row(), 15);
}

#[test]
fn get_totals_range_with_totals() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    let r = get_totals_range(&t).unwrap();
    assert_eq!(r.start_row(), 10);
    assert_eq!(r.end_row(), 10);
}

#[test]
fn get_totals_range_no_totals() {
    let t = make_test_table();
    assert!(get_totals_range(&t).is_none());
}

#[test]
fn get_column_range_basic() {
    let t = make_test_table();
    let r = get_column_range(&t, "TestTable-col-1").unwrap();
    assert_eq!(r.start_row(), 0);
    assert_eq!(r.end_row(), 10);
    assert_eq!(r.start_col(), 1);
    assert_eq!(r.end_col(), 1);
}

#[test]
fn get_column_range_not_found() {
    let t = make_test_table();
    assert!(get_column_range(&t, "nonexistent").is_none());
}

#[test]
fn get_column_data_range_basic() {
    let t = make_test_table();
    let r = get_column_data_range(&t, "TestTable-col-1").unwrap();
    assert_eq!(r.start_row(), 1); // after header
    assert_eq!(r.end_row(), 10);
    assert_eq!(r.start_col(), 1);
    assert_eq!(r.end_col(), 1);
}

#[test]
fn get_column_data_range_not_found() {
    let t = make_test_table();
    assert!(get_column_data_range(&t, "nonexistent").is_none());
}
