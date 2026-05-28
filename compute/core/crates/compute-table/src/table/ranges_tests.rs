use super::*;
use super::super::types::{Table, TableRange};
use super::test_fixtures::make_test_table;

fn tables_overlap(a: &Table, b: &Table) -> bool {
    if a.range.end_col() < b.range.start_col() || a.range.start_col() > b.range.end_col() {
        return false;
    }
    if a.range.end_row() < b.range.start_row() || a.range.start_row() > b.range.end_row() {
        return false;
    }
    true
}

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


// ---- Hit Testing ----

#[test]
fn is_position_in_table_inside() {
    let t = make_test_table(); // range (0,0)-(10,2)
    assert!(is_position_in_table(&t, 0, 0));
    assert!(is_position_in_table(&t, 5, 1));
    assert!(is_position_in_table(&t, 10, 2));
}

#[test]
fn is_position_in_table_outside() {
    let t = make_test_table();
    assert!(!is_position_in_table(&t, 11, 0));
    assert!(!is_position_in_table(&t, 0, 3));
}

#[test]
fn get_column_at_position_valid() {
    let t = make_test_table(); // range starts at col 0
    let col = get_column_at_position(&t, 1).unwrap();
    assert_eq!(col.name, "Age");
}

#[test]
fn get_column_at_position_outside() {
    let t = make_test_table();
    assert!(get_column_at_position(&t, 5).is_none());
}


// ---- is_in_header_row ----

#[test]
fn is_in_header_row_true() {
    let t = make_test_table(); // header at row 0
    assert!(is_in_header_row(&t, 0));
}

#[test]
fn is_in_header_row_false_data_row() {
    let t = make_test_table();
    assert!(!is_in_header_row(&t, 1));
    assert!(!is_in_header_row(&t, 5));
}

#[test]
fn is_in_header_row_false_no_header() {
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
    assert!(!is_in_header_row(&t, 0));
}


// ---- is_in_totals_row ----

#[test]
fn is_in_totals_row_true() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    // end_row is 10
    assert!(is_in_totals_row(&t, 10));
}

#[test]
fn is_in_totals_row_false_no_totals() {
    let t = make_test_table();
    assert!(!is_in_totals_row(&t, 10));
}

#[test]
fn is_in_totals_row_false_wrong_row() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    assert!(!is_in_totals_row(&t, 5));
}


// ---- is_in_data_range ----

#[test]
fn is_in_data_range_true() {
    let t = make_test_table(); // header at 0, data 1-10, cols 0-2
    assert!(is_in_data_range(&t, 1, 0));
    assert!(is_in_data_range(&t, 5, 1));
    assert!(is_in_data_range(&t, 10, 2));
}

#[test]
fn is_in_data_range_false_header() {
    let t = make_test_table();
    assert!(!is_in_data_range(&t, 0, 0)); // header row
}

#[test]
fn is_in_data_range_false_totals() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    // data is now 1-9, totals at 10
    assert!(!is_in_data_range(&t, 10, 0));
}

#[test]
fn is_in_data_range_false_outside() {
    let t = make_test_table();
    assert!(!is_in_data_range(&t, 5, 3)); // col 3 is outside
    assert!(!is_in_data_range(&t, 11, 0)); // row 11 is outside
}


// ---- tables_overlap ----

#[test]
fn tables_overlap_true() {
    let a = create_table(
        "A",
        "s1",
        TableRange::new(0, 0, 5, 3),
        &["A", "B", "C", "D"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange::new(3, 2, 8, 5),
        &["E", "F", "G", "H"],
        None,
    )
    .unwrap();
    assert!(tables_overlap(&a, &b));
    assert!(tables_overlap(&b, &a)); // symmetric
}

#[test]
fn tables_overlap_false_no_col_overlap() {
    let a = create_table(
        "A",
        "s1",
        TableRange::new(0, 0, 5, 2),
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange::new(0, 3, 5, 5),
        &["D", "E", "F"],
        None,
    )
    .unwrap();
    assert!(!tables_overlap(&a, &b));
}

#[test]
fn tables_overlap_false_no_row_overlap() {
    let a = create_table(
        "A",
        "s1",
        TableRange::new(0, 0, 5, 2),
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange::new(6, 0, 10, 2),
        &["D", "E", "F"],
        None,
    )
    .unwrap();
    assert!(!tables_overlap(&a, &b));
}

#[test]
fn tables_overlap_adjacent_not_overlapping() {
    // Tables sharing an edge (row 5/row 5) but not actually overlapping
    // since end_row == start_row is touching, which IS overlap
    let a = create_table(
        "A",
        "s1",
        TableRange::new(0, 0, 5, 2),
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange::new(5, 0, 10, 2),
        &["D", "E", "F"],
        None,
    )
    .unwrap();
    // They share row 5, so this IS an overlap
    assert!(tables_overlap(&a, &b));
}

