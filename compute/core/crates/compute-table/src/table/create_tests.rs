use super::super::types::TableRange;
use super::test_fixtures::make_test_table;
use super::*;

// ---- Table Creation ----

#[test]
fn create_table_basic() {
    let t = make_test_table();
    assert_eq!(t.name, "TestTable");
    assert_eq!(t.id, "TestTable");
    assert_eq!(t.display_name, "TestTable");
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
    assert!(t.auto_expand);
    assert!(t.auto_calculated_columns);
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
