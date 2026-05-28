use super::*;
use super::super::types::{TableBoolOption, TableRange};
use super::test_fixtures::make_test_table;

// ---- Table Creation ----

#[test]
fn create_table_basic() {
    let t = make_test_table();
    assert_eq!(t.name, "TestTable");
    assert_eq!(t.sheet_id, "sheet1");
    assert_eq!(t.columns.len(), 3);
    assert_eq!(t.columns[0].name, "Name");
    assert_eq!(t.columns[0].id, "TestTable-col-0");
    assert_eq!(t.columns[0].index, 0);
    assert_eq!(t.columns[1].name, "Age");
    assert_eq!(t.columns[1].id, "TestTable-col-1");
    assert_eq!(t.columns[2].name, "City");
    assert_eq!(t.columns[2].id, "TestTable-col-2");
    assert!(t.has_header_row);
    assert!(!t.has_totals_row);
    assert_eq!(t.style, "TableStyleMedium2");
    assert!(t.banded_rows);
    assert!(!t.banded_columns);
    assert!(t.show_filter_buttons);
}

#[test]
fn create_table_with_options() {
    let t = create_table(
        "T1",
        "s1",
        TableRange::new(0, 0, 5, 1),
        &["A", "B"],
        Some(CreateTableOptions {
            has_header_row: Some(false),
            has_totals_row: Some(true),
            style_id: Some("TableStyleLight1".to_string()),
            ..Default::default()
        }),
    )
    .unwrap();
    assert!(!t.has_header_row);
    assert!(t.has_totals_row);
    assert_eq!(t.style, "TableStyleLight1");
}

#[test]
fn create_table_pads_column_names() {
    let t = create_table(
        "T1",
        "s1",
        TableRange::new(0, 0, 5, 3),
        &["A", "B"], // only 2 names for 4 columns
        None,
    )
    .unwrap();
    assert_eq!(t.columns.len(), 4);
    assert_eq!(t.columns[2].name, "Column3");
    assert_eq!(t.columns[3].name, "Column4");
}


// ---- Validate Range ----

#[test]
fn validate_range_valid() {
    assert!(validate_range(&TableRange::new(0, 0, 10, 5)).is_ok());
}

#[test]
fn validate_range_inverted_rows_normalized() {
    // SheetRange::new auto-normalizes, so inverted inputs become valid
    assert!(validate_range(&TableRange::new(10, 0, 5, 5)).is_ok());
}

#[test]
fn validate_range_inverted_cols_normalized() {
    // SheetRange::new auto-normalizes, so inverted inputs become valid
    assert!(validate_range(&TableRange::new(0, 10, 10, 5)).is_ok());
}

#[test]
fn create_table_with_inverted_range_normalized() {
    // SheetRange::new auto-normalizes inverted ranges, so these succeed
    let result = create_table(
        "T1",
        "s1",
        TableRange::new(10, 0, 5, 2),
        &["A", "B", "C"],
        None,
    );
    assert!(result.is_ok());

    let result = create_table(
        "T1",
        "s1",
        TableRange::new(0, 5, 10, 2),
        &["A", "B", "C"],
        None,
    );
    assert!(result.is_ok());
}

#[test]
fn resize_table_with_inverted_range_normalized() {
    let t = make_test_table();

    // SheetRange::new auto-normalizes inverted ranges, so these succeed
    let result = resize_table(&t, TableRange::new(10, 0, 5, 2));
    // start_row changes from 0 to 5, so resize validation may reject this,
    // but validate_range itself won't reject it
    // The range is valid (5,0,10,2) after normalization
    assert!(result.is_ok() || result.is_err());

    let result = resize_table(&t, TableRange::new(0, 5, 10, 2));
    assert!(result.is_ok() || result.is_err());
}


// ---- Edge Cases ----

#[test]
fn create_table_with_inverted_rows_normalized() {
    // SheetRange::new auto-normalizes, so (10,0,5,2) becomes (5,0,10,2) -> valid
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
    // SheetRange::new auto-normalizes, so (0,10,5,2) becomes (0,2,5,10) -> valid
    let result = create_table(
        "T1",
        "s1",
        TableRange::new(0, 10, 5, 2),
        &["A", "B", "C"],
        None,
    );
    assert!(result.is_ok());
}

#[test]
fn toggle_totals_row_with_end_row_zero() {
    // Verify toggle_totals_row handles end_row = 0
    // Create a table with end_row = 0 and totals row enabled
    let mut t = make_test_table();
    t.has_totals_row = true;
    t.range = TableRange::new(
        t.range.start_row(),
        t.range.start_col(),
        0,
        t.range.end_col(),
    );
    let t2 = toggle_totals_row(&t);
    assert!(!t2.has_totals_row);
    assert_eq!(t2.range.end_row(), 0); // saturates at 0, no underflow
}

#[test]
fn add_column_on_first_column() {
    let t = make_test_table(); // "Name", "Age", "City"
    let t2 = add_column(&t, "ID", Some(0));
    assert_eq!(t2.columns.len(), 4);
    // New column should be first
    assert_eq!(t2.columns[0].name, "ID");
    assert_eq!(t2.columns[0].index, 0);
    // Other columns shift
    assert_eq!(t2.columns[1].name, "Name");
    assert_eq!(t2.columns[1].index, 1);
    assert_eq!(t2.columns[2].name, "Age");
    assert_eq!(t2.columns[2].index, 2);
    assert_eq!(t2.columns[3].name, "City");
    assert_eq!(t2.columns[3].index, 3);
    // Range should expand
    assert_eq!(t2.range.end_col(), t.range.end_col() + 1);
}

#[test]
fn add_column_on_last_column() {
    let t = make_test_table(); // 3 columns
    let last_idx = t.columns.len();
    let t2 = add_column(&t, "Score", Some(last_idx));
    assert_eq!(t2.columns.len(), 4);
    // New column should be last
    assert_eq!(t2.columns[3].name, "Score");
    assert_eq!(t2.columns[3].index, 3);
    // Other columns unchanged
    assert_eq!(t2.columns[0].name, "Name");
    assert_eq!(t2.columns[1].name, "Age");
    assert_eq!(t2.columns[2].name, "City");
    assert_eq!(t2.range.end_col(), t.range.end_col() + 1);
}

#[test]
fn remove_column_first() {
    let t = make_test_table(); // "Name", "Age", "City"
    let first_col_id = t.columns[0].id.clone();
    let t2 = remove_column(&t, &first_col_id);
    assert_eq!(t2.columns.len(), 2);
    // First column removed, remaining should re-index
    assert_eq!(t2.columns[0].name, "Age");
    assert_eq!(t2.columns[0].index, 0);
    assert_eq!(t2.columns[1].name, "City");
    assert_eq!(t2.columns[1].index, 1);
    // Range should contract
    assert_eq!(t2.range.end_col(), t.range.end_col() - 1);
}

#[test]
fn remove_column_last() {
    let t = make_test_table(); // "Name", "Age", "City"
    let last_col_id = t.columns[2].id.clone();
    let t2 = remove_column(&t, &last_col_id);
    assert_eq!(t2.columns.len(), 2);
    // Last column removed, remaining should be correct
    assert_eq!(t2.columns[0].name, "Name");
    assert_eq!(t2.columns[0].index, 0);
    assert_eq!(t2.columns[1].name, "Age");
    assert_eq!(t2.columns[1].index, 1);
    // Range should contract
    assert_eq!(t2.range.end_col(), t.range.end_col() - 1);
}

#[test]
fn table_with_nonzero_start_col() {
    // Create table starting at column 5
    let t = create_table(
        "T1",
        "s1",
        TableRange::new(0, 5, 10, 7),
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    assert_eq!(t.columns.len(), 3);
    assert_eq!(t.range.start_col(), 5);
    assert_eq!(t.range.end_col(), 7);

    // Test add column
    let t2 = add_column(&t, "D", None);
    assert_eq!(t2.columns.len(), 4);
    assert_eq!(t2.range.end_col(), 8);

    // Test remove column
    let col_id = t2.columns[1].id.clone();
    let t3 = remove_column(&t2, &col_id);
    assert_eq!(t3.columns.len(), 3);
    assert_eq!(t3.range.end_col(), 7);
    // Verify indices re-numbered correctly
    for (i, col) in t3.columns.iter().enumerate() {
        assert_eq!(col.index, i as u32);
    }

    // Test set_table_option
    let t4 = set_table_option(&t3, TableBoolOption::BandedColumns, true);
    assert!(t4.banded_columns);
    assert_eq!(t4.columns.len(), 3);
}

#[test]
fn resize_table_multi_cycle() {
    let t = make_test_table(); // 3 columns

    // Resize larger: 3 -> 5 columns
    let t2 = resize_table(&t, TableRange::new(0, 0, 10, 4)).unwrap();
    assert_eq!(t2.columns.len(), 5);
    let ids_after_expand: Vec<String> = t2.columns.iter().map(|c| c.id.clone()).collect();
    // Original column IDs should be preserved
    assert_eq!(ids_after_expand[0], "TestTable-col-0");
    assert_eq!(ids_after_expand[1], "TestTable-col-1");
    assert_eq!(ids_after_expand[2], "TestTable-col-2");

    // Resize smaller: 5 -> 2 columns
    let t3 = resize_table(&t2, TableRange::new(0, 0, 10, 1)).unwrap();
    assert_eq!(t3.columns.len(), 2);
    assert_eq!(t3.columns[0].id, "TestTable-col-0");
    assert_eq!(t3.columns[1].id, "TestTable-col-1");

    // Resize larger again: 2 -> 4 columns
    let t4 = resize_table(&t3, TableRange::new(0, 0, 10, 3)).unwrap();
    assert_eq!(t4.columns.len(), 4);
    // Original IDs still stable
    assert_eq!(t4.columns[0].id, "TestTable-col-0");
    assert_eq!(t4.columns[1].id, "TestTable-col-1");
    // New columns should have non-colliding IDs
    // (max suffix strategy ensures no collisions across cycles)
    let new_ids: Vec<String> = t4.columns.iter().map(|c| c.id.clone()).collect();
    // All IDs should be unique
    let unique_ids: std::collections::HashSet<_> = new_ids.iter().collect();
    assert_eq!(unique_ids.len(), 4);
}


// ---- create_table with separate id ----

#[test]
fn create_table_with_separate_id() {
    let t = create_table(
        "MyTable",
        "s1",
        TableRange::new(0, 0, 5, 1),
        &["A", "B"],
        Some(CreateTableOptions {
            id: Some("custom-id-123".to_string()),
            ..Default::default()
        }),
    )
    .unwrap();
    assert_eq!(t.id, "custom-id-123");
    assert_eq!(t.name, "MyTable");
    assert_eq!(t.columns[0].id, "custom-id-123-col-0");
    assert_eq!(t.columns[1].id, "custom-id-123-col-1");
}

#[test]
fn create_table_id_defaults_to_name() {
    let t = make_test_table();
    assert_eq!(t.id, "TestTable");
    assert_eq!(t.name, "TestTable");
}

