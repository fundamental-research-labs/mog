use super::fixtures::{TableOverrides, hex, make_table, make_wide_table};
use crate::styles::resolve_table_cell_format;
use crate::types::{TableColumn, TableRange};

#[test]
fn first_column_emphasis_fill() {
    let table = make_table(Some(TableOverrides {
        emphasize_first_column: Some(true),
        banded_rows: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 4, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn non_first_column_keeps_banding() {
    let table = make_table(Some(TableOverrides {
        emphasize_first_column: Some(true),
        banded_rows: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 4, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
    assert!(fmt.font_bold.is_none());
}

#[test]
fn last_column_emphasis_fill() {
    let table = make_table(Some(TableOverrides {
        emphasize_last_column: Some(true),
        banded_rows: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 4, 3).unwrap();
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn non_last_column_keeps_banding() {
    let table = make_table(Some(TableOverrides {
        emphasize_last_column: Some(true),
        banded_rows: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 4, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
    assert!(fmt.font_bold.is_none());
}

#[test]
fn first_col_emphasis_overrides_odd_row_banding() {
    let table = make_table(Some(TableOverrides {
        emphasize_first_column: Some(true),
        banded_rows: Some(true),
        banded_columns: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 3, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn first_col_emphasis_overrides_even_row_banding() {
    let table = make_table(Some(TableOverrides {
        emphasize_first_column: Some(true),
        banded_rows: Some(true),
        banded_columns: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 4, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn both_first_last_emphasis_single_column() {
    let table = make_table(Some(TableOverrides {
        range: Some(TableRange::new(0, 0, 3, 0)),
        columns: Some(vec![TableColumn {
            id: "c".to_string(),
            name: "X".to_string(),
            index: 0,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        }]),
        has_header_row: Some(true),
        has_totals_row: Some(true),
        emphasize_first_column: Some(true),
        emphasize_last_column: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 1, 0).unwrap();
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn col_banding_with_last_col_emphasis_col0() {
    let table = make_wide_table(Some(TableOverrides {
        banded_rows: Some(false),
        banded_columns: Some(true),
        emphasize_last_column: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 1, 0).unwrap();
    assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
}

#[test]
fn col_banding_with_last_col_emphasis_col1() {
    let table = make_wide_table(Some(TableOverrides {
        banded_rows: Some(false),
        banded_columns: Some(true),
        emphasize_last_column: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 1, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
}

#[test]
fn col_banding_with_last_col_emphasis_last_col() {
    let table = make_wide_table(Some(TableOverrides {
        banded_rows: Some(false),
        banded_columns: Some(true),
        emphasize_last_column: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 1, 3).unwrap();
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_bold, Some(true));
}
