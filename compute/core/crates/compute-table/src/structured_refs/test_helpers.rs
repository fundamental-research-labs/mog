//! Shared test fixtures for structured reference tests.

use super::super::types::{Table, TableColumn, TableRange};

/// Standard test table: "Sales"
///
/// Grid layout (start_row=2, start_col=1):
///   Row 2 (header):  | Product | Region | Amount | Quantity |
///   Row 3 (data):    | ...     | ...    | ...    | ...      |
///   Row 4 (data):    | ...     | ...    | ...    | ...      |
///   Row 5 (data):    | ...     | ...    | ...    | ...      |
///   Row 6 (totals):  | ...     | ...    | ...    | ...      |
pub fn sales_table() -> Table {
    Table {
        id: "tbl-sales".to_string(),
        name: "Sales".to_string(),
        display_name: "Sales".to_string(),
        sheet_id: "sheet1".to_string(),
        range: TableRange::new(2, 1, 6, 4),
        columns: vec![
            TableColumn {
                id: "col-1".to_string(),
                name: "Product".to_string(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
            TableColumn {
                id: "col-2".to_string(),
                name: "Region".to_string(),
                index: 1,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
            TableColumn {
                id: "col-3".to_string(),
                name: "Amount".to_string(),
                index: 2,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
            TableColumn {
                id: "col-4".to_string(),
                name: "Quantity".to_string(),
                index: 3,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
        ],
        has_header_row: true,
        has_totals_row: true,
        style: "TableStyleMedium2".to_string(),
        banded_rows: true,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: true,
        auto_expand: true,
        auto_calculated_columns: true,
        ..Default::default()
    }
}

/// Table without header or totals rows: "Data"
///
/// Grid layout (start_row=0, start_col=0):
///   Row 0 (data): | A | B | C |
///   Row 1 (data): | A | B | C |
///   Row 2 (data): | A | B | C |
pub fn bare_table() -> Table {
    Table {
        id: "tbl-bare".to_string(),
        name: "Data".to_string(),
        display_name: "Data".to_string(),
        sheet_id: "sheet1".to_string(),
        range: TableRange::new(0, 0, 2, 2),
        columns: vec![
            TableColumn {
                id: "col-a".to_string(),
                name: "A".to_string(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
            TableColumn {
                id: "col-b".to_string(),
                name: "B".to_string(),
                index: 1,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
            TableColumn {
                id: "col-c".to_string(),
                name: "C".to_string(),
                index: 2,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
        ],
        has_header_row: false,
        has_totals_row: false,
        style: "TableStyleLight1".to_string(),
        banded_rows: false,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: false,
        auto_expand: true,
        auto_calculated_columns: true,
        ..Default::default()
    }
}

/// Table with special column names
pub fn special_table() -> Table {
    Table {
        id: "tbl-special".to_string(),
        name: "My_Table".to_string(),
        display_name: "My_Table".to_string(),
        sheet_id: "sheet1".to_string(),
        range: TableRange::new(0, 0, 5, 2),
        columns: vec![
            TableColumn {
                id: "col-s1".to_string(),
                name: "First Name".to_string(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
            TableColumn {
                id: "col-s2".to_string(),
                name: "Last Name".to_string(),
                index: 1,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
            TableColumn {
                id: "col-s3".to_string(),
                name: "Score".to_string(),
                index: 2,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
        ],
        has_header_row: true,
        has_totals_row: true,
        style: "TableStyleLight1".to_string(),
        banded_rows: false,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: false,
        auto_expand: true,
        auto_calculated_columns: true,
        ..Default::default()
    }
}

/// Table with header + totals but only 2 rows total (so no data rows).
/// Used to test the empty data area bug fix.
pub fn empty_data_table() -> Table {
    Table {
        id: "tbl-empty".to_string(),
        name: "Empty".to_string(),
        display_name: "Empty".to_string(),
        sheet_id: "sheet1".to_string(),
        range: TableRange::new(0, 0, 1, 2),
        columns: vec![
            TableColumn {
                id: "col-e1".to_string(),
                name: "X".to_string(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
            TableColumn {
                id: "col-e2".to_string(),
                name: "Y".to_string(),
                index: 1,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
            TableColumn {
                id: "col-e3".to_string(),
                name: "Z".to_string(),
                index: 2,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            },
        ],
        has_header_row: true,
        has_totals_row: true,
        style: "TableStyleLight1".to_string(),
        banded_rows: false,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: false,
        auto_expand: true,
        auto_calculated_columns: true,
        ..Default::default()
    }
}
