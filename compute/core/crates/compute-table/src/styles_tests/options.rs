use super::fixtures::{TableOverrides, hex, make_table};
use crate::styles::resolve_table_cell_format;

#[test]
fn no_header_first_row_is_data() {
    let table = make_table(Some(TableOverrides {
        has_header_row: Some(false),
        has_totals_row: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 2, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
    assert!(fmt.font_bold.is_none());
}

#[test]
fn no_header_totals_still_works() {
    let table = make_table(Some(TableOverrides {
        has_header_row: Some(false),
        has_totals_row: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 7, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn no_header_banding_starts_from_first_row() {
    let table = make_table(Some(TableOverrides {
        has_header_row: Some(false),
        has_totals_row: Some(true),
        ..Default::default()
    }));
    let fmt2 = resolve_table_cell_format(&table, 2, 2).unwrap();
    let fmt3 = resolve_table_cell_format(&table, 3, 2).unwrap();
    assert_eq!(fmt2.fill, Some(hex("#FFFFFF")));
    assert_eq!(fmt3.fill, Some(hex("#D6DCE5")));
}

#[test]
fn no_totals_last_row_is_data() {
    let table = make_table(Some(TableOverrides {
        has_header_row: Some(true),
        has_totals_row: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 7, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
    assert!(fmt.font_bold.is_none());
}

#[test]
fn no_totals_last_data_row_has_bottom_border() {
    let table = make_table(Some(TableOverrides {
        has_header_row: Some(true),
        has_totals_row: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 7, 2).unwrap();
    assert!(fmt.border_bottom.is_some());
}

#[test]
fn no_totals_header_still_works() {
    let table = make_table(Some(TableOverrides {
        has_header_row: Some(true),
        has_totals_row: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 2, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn unknown_style_falls_back_to_medium2() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleNonExistent99".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
}

#[test]
fn header_fill_resolves_short_contract_style_ids() {
    let short_style_table = make_table(Some(TableOverrides {
        style: Some("medium4".to_string()),
        ..Default::default()
    }));
    let canonical_style_table = make_table(Some(TableOverrides {
        style: Some("TableStyleMedium4".to_string()),
        ..Default::default()
    }));

    let short_fmt = resolve_table_cell_format(&short_style_table, 2, 1).unwrap();
    let canonical_fmt = resolve_table_cell_format(&canonical_style_table, 2, 1).unwrap();

    assert_eq!(short_fmt.fill, canonical_fmt.fill);
    assert_eq!(short_fmt.font_color, canonical_fmt.font_color);
    assert_eq!(short_fmt.font_bold, canonical_fmt.font_bold);
    assert_eq!(short_fmt.fill, Some(hex("#A5A5A5")));
}
