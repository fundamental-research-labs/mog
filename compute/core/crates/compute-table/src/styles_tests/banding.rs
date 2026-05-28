use super::fixtures::{TableOverrides, hex, make_table, make_wide_table};
use crate::styles::resolve_table_cell_format;
use crate::types::BorderStyle;

#[test]
fn banded_rows_first_data_row_odd_fill() {
    let table = make_table(Some(TableOverrides {
        banded_rows: Some(true),
        banded_columns: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
}

#[test]
fn banded_rows_second_data_row_even_fill() {
    let table = make_table(Some(TableOverrides {
        banded_rows: Some(true),
        banded_columns: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 4, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
}

#[test]
fn banded_rows_third_data_row_odd_fill() {
    let table = make_table(Some(TableOverrides {
        banded_rows: Some(true),
        banded_columns: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 5, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
}

#[test]
fn banded_rows_fourth_data_row_even_fill() {
    let table = make_table(Some(TableOverrides {
        banded_rows: Some(true),
        banded_columns: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 6, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
}

#[test]
fn banded_columns_col_index_0_odd() {
    let table = make_table(Some(TableOverrides {
        banded_rows: Some(false),
        banded_columns: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 3, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
}

#[test]
fn banded_columns_col_index_1_even() {
    let table = make_table(Some(TableOverrides {
        banded_rows: Some(false),
        banded_columns: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
}

#[test]
fn banded_columns_col_index_2_odd() {
    let table = make_table(Some(TableOverrides {
        banded_rows: Some(false),
        banded_columns: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 3, 3).unwrap();
    assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
}

#[test]
fn both_banding_off_data_cells_have_no_fill() {
    let table = make_table(Some(TableOverrides {
        banded_rows: Some(false),
        banded_columns: Some(false),
        ..Default::default()
    }));
    let fmt3 = resolve_table_cell_format(&table, 3, 2).unwrap();
    let fmt4 = resolve_table_cell_format(&table, 4, 2).unwrap();
    let fmt5 = resolve_table_cell_format(&table, 5, 2).unwrap();
    assert!(fmt3.fill.is_none());
    assert!(fmt4.fill.is_none());
    assert!(fmt5.fill.is_none());
}

#[test]
fn dual_banding_data_cells_get_row_banding_fill() {
    let table = make_wide_table(Some(TableOverrides {
        banded_rows: Some(true),
        banded_columns: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 1, 0).unwrap();
    assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
    let fmt2 = resolve_table_cell_format(&table, 2, 0).unwrap();
    assert_eq!(fmt2.fill, Some(hex("#D6DCE5")));
}

#[test]
fn dual_banding_even_row_fill_all_columns() {
    let table = make_wide_table(Some(TableOverrides {
        banded_rows: Some(true),
        banded_columns: Some(true),
        ..Default::default()
    }));
    for c in 0..=3 {
        let fmt = resolve_table_cell_format(&table, 2, c).unwrap();
        assert_eq!(fmt.fill, Some(hex("#D6DCE5")), "col {} mismatch", c);
    }
}

#[test]
fn dual_banding_column_transition_border() {
    let table = make_wide_table(Some(TableOverrides {
        banded_rows: Some(true),
        banded_columns: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 1, 1).unwrap();
    assert!(fmt.border_left.is_some());
    assert_eq!(fmt.border_left.as_ref().unwrap().style, BorderStyle::Thin);
    assert_eq!(fmt.border_left.as_ref().unwrap().color, hex("#8FAADC"));
}

#[test]
fn dual_banding_col3_transition_border() {
    let table = make_wide_table(Some(TableOverrides {
        banded_rows: Some(true),
        banded_columns: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 1, 3).unwrap();
    assert!(fmt.border_left.is_some());
    assert_eq!(fmt.border_left.as_ref().unwrap().style, BorderStyle::Thin);
}

#[test]
fn dual_banding_odd_columns_no_band_border() {
    let table = make_wide_table(Some(TableOverrides {
        banded_rows: Some(true),
        banded_columns: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 1, 2).unwrap();
    assert!(fmt.border_left.is_none());
}
