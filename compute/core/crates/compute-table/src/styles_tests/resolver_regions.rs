use super::fixtures::{TableOverrides, hex, make_table};
use crate::styles::resolve_table_cell_format;
use crate::types::BorderStyle;

#[test]
fn outside_table_row_above() {
    let table = make_table(None);
    assert!(resolve_table_cell_format(&table, 1, 1).is_none());
}

#[test]
fn outside_table_row_below() {
    let table = make_table(None);
    assert!(resolve_table_cell_format(&table, 8, 1).is_none());
}

#[test]
fn outside_table_col_left() {
    let table = make_table(None);
    assert!(resolve_table_cell_format(&table, 3, 0).is_none());
}

#[test]
fn outside_table_col_right() {
    let table = make_table(None);
    assert!(resolve_table_cell_format(&table, 3, 4).is_none());
}

#[test]
fn outside_table_diagonal() {
    let table = make_table(None);
    assert!(resolve_table_cell_format(&table, 0, 0).is_none());
}

#[test]
fn header_fill_and_font_color() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleMedium2".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
}

#[test]
fn header_is_bold() {
    let table = make_table(None);
    let fmt = resolve_table_cell_format(&table, 2, 2).unwrap();
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn header_has_medium_bottom_border() {
    let table = make_table(None);
    let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
    assert!(fmt.border_bottom.is_some());
    assert_eq!(
        fmt.border_bottom.as_ref().unwrap().style,
        BorderStyle::Medium
    );
}

#[test]
fn header_has_top_border() {
    let table = make_table(None);
    let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
    assert!(fmt.border_top.is_some());
}

#[test]
fn header_first_col_has_left_border() {
    let table = make_table(None);
    let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
    assert!(fmt.border_left.is_some());
}

#[test]
fn header_last_col_has_right_border() {
    let table = make_table(None);
    let fmt = resolve_table_cell_format(&table, 2, 3).unwrap();
    assert!(fmt.border_right.is_some());
}

#[test]
fn totals_fill_and_font_color() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleMedium2".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 7, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
}

#[test]
fn totals_is_bold() {
    let table = make_table(None);
    let fmt = resolve_table_cell_format(&table, 7, 2).unwrap();
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn totals_has_medium_top_border() {
    let table = make_table(None);
    let fmt = resolve_table_cell_format(&table, 7, 1).unwrap();
    assert!(fmt.border_top.is_some());
    assert_eq!(fmt.border_top.as_ref().unwrap().style, BorderStyle::Medium);
}

#[test]
fn totals_has_bottom_border() {
    let table = make_table(None);
    let fmt = resolve_table_cell_format(&table, 7, 1).unwrap();
    assert!(fmt.border_bottom.is_some());
}
