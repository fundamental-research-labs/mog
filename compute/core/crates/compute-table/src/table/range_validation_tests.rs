use super::super::types::TableRange;
use super::*;

#[test]
fn validate_range_valid() {
    assert!(validate_range(&TableRange::new(0, 0, 10, 5)).is_ok());
}

#[test]
fn validate_range_inverted_rows_normalized() {
    assert!(validate_range(&TableRange::new(10, 0, 5, 5)).is_ok());
}

#[test]
fn validate_range_inverted_cols_normalized() {
    assert!(validate_range(&TableRange::new(0, 10, 10, 5)).is_ok());
}

#[test]
fn create_table_with_inverted_range_normalized() {
    let row_inverted = create_table(
        "T1",
        "s1",
        TableRange::new(10, 0, 5, 2),
        &["A", "B", "C"],
        None,
    );
    assert!(row_inverted.is_ok());

    let col_inverted = create_table(
        "T1",
        "s1",
        TableRange::new(0, 5, 10, 2),
        &["A", "B", "C"],
        None,
    );
    assert!(col_inverted.is_ok());
}

#[test]
fn create_table_with_inverted_rows_normalized() {
    let result = create_table(
        "T1",
        "s1",
        TableRange::new(10, 0, 5, 2),
        &["A", "B", "C"],
        None,
    );
    assert!(result.is_ok());
}

#[test]
fn create_table_with_inverted_cols_normalized() {
    let result = create_table(
        "T1",
        "s1",
        TableRange::new(0, 10, 5, 2),
        &["A", "B", "C"],
        None,
    );
    assert!(result.is_ok());
}
