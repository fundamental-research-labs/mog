use crate::types::{Table, TableColumn, TableRange};
use value_types::Color;

pub(super) fn hex(s: &str) -> Color {
    Color::from_hex(s).unwrap()
}

pub(super) fn make_table(overrides: Option<TableOverrides>) -> Table {
    let o = overrides.unwrap_or_default();
    let cols = o.columns.unwrap_or_else(|| {
        vec![
            TableColumn {
                id: "col-0".to_string(),
                name: "Name".to_string(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            TableColumn {
                id: "col-1".to_string(),
                name: "Value".to_string(),
                index: 1,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            TableColumn {
                id: "col-2".to_string(),
                name: "Score".to_string(),
                index: 2,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
        ]
    });

    Table {
        id: "test-table".to_string(),
        name: "TestTable".to_string(),
        display_name: "TestTable".to_string(),
        sheet_id: "sheet1".to_string(),
        range: o.range.unwrap_or(TableRange::new(2, 1, 7, 3)),
        columns: cols,
        has_header_row: o.has_header_row.unwrap_or(true),
        has_totals_row: o.has_totals_row.unwrap_or(true),
        style: o.style.unwrap_or_else(|| "TableStyleMedium2".to_string()),
        banded_rows: o.banded_rows.unwrap_or(true),
        banded_columns: o.banded_columns.unwrap_or(false),
        emphasize_first_column: o.emphasize_first_column.unwrap_or(false),
        emphasize_last_column: o.emphasize_last_column.unwrap_or(false),
        show_filter_buttons: o.show_filter_buttons.unwrap_or(true),
        auto_expand: true,
        auto_calculated_columns: true,
    }
}

pub(super) fn make_wide_table(overrides: Option<TableOverrides>) -> Table {
    let o = overrides.unwrap_or_default();
    let cols = vec![
        TableColumn {
            id: "col-0".to_string(),
            name: "A".to_string(),
            index: 0,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        },
        TableColumn {
            id: "col-1".to_string(),
            name: "B".to_string(),
            index: 1,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        },
        TableColumn {
            id: "col-2".to_string(),
            name: "C".to_string(),
            index: 2,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        },
        TableColumn {
            id: "col-3".to_string(),
            name: "D".to_string(),
            index: 3,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        },
    ];

    Table {
        id: "wide-table".to_string(),
        name: "WideTable".to_string(),
        display_name: "WideTable".to_string(),
        sheet_id: "sheet1".to_string(),
        range: o.range.unwrap_or(TableRange::new(0, 0, 6, 3)),
        columns: cols,
        has_header_row: o.has_header_row.unwrap_or(true),
        has_totals_row: o.has_totals_row.unwrap_or(true),
        style: o.style.unwrap_or_else(|| "TableStyleMedium2".to_string()),
        banded_rows: o.banded_rows.unwrap_or(true),
        banded_columns: o.banded_columns.unwrap_or(false),
        emphasize_first_column: o.emphasize_first_column.unwrap_or(false),
        emphasize_last_column: o.emphasize_last_column.unwrap_or(false),
        show_filter_buttons: o.show_filter_buttons.unwrap_or(true),
        auto_expand: true,
        auto_calculated_columns: true,
    }
}

#[derive(Default)]
pub(super) struct TableOverrides {
    pub(super) range: Option<TableRange>,
    pub(super) columns: Option<Vec<TableColumn>>,
    pub(super) has_header_row: Option<bool>,
    pub(super) has_totals_row: Option<bool>,
    pub(super) style: Option<String>,
    pub(super) banded_rows: Option<bool>,
    pub(super) banded_columns: Option<bool>,
    pub(super) emphasize_first_column: Option<bool>,
    pub(super) emphasize_last_column: Option<bool>,
    pub(super) show_filter_buttons: Option<bool>,
}
