use super::super::types::TableRange;
use super::test_fixtures::make_test_table;
use super::*;

#[test]
fn is_in_header_row_true() {
    let t = make_test_table();
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

#[test]
fn is_in_totals_row_true() {
    let mut t = make_test_table();
    t.has_totals_row = true;
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

#[test]
fn is_in_data_range_true() {
    let t = make_test_table();
    assert!(is_in_data_range(&t, 1, 0));
    assert!(is_in_data_range(&t, 5, 1));
    assert!(is_in_data_range(&t, 10, 2));
}

#[test]
fn is_in_data_range_false_header() {
    let t = make_test_table();
    assert!(!is_in_data_range(&t, 0, 0));
}

#[test]
fn is_in_data_range_false_totals() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    assert!(!is_in_data_range(&t, 10, 0));
}

#[test]
fn is_in_data_range_false_outside() {
    let t = make_test_table();
    assert!(!is_in_data_range(&t, 5, 3));
    assert!(!is_in_data_range(&t, 11, 0));
}
