use crate::styles::{
    DEFAULT_STYLE_ID, get_all_built_in_styles, get_built_in_style, resolve_table_cell_format,
};
use crate::types::{BorderStyle, Table, TableColumn, TableRange};
use value_types::Color;

fn hex(s: &str) -> Color {
    Color::from_hex(s).unwrap()
}

// -----------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------

/// Create a minimal table for testing.
fn make_table(overrides: Option<TableOverrides>) -> Table {
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

/// Create a 4-column wide table for testing.
fn make_wide_table(overrides: Option<TableOverrides>) -> Table {
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
struct TableOverrides {
    range: Option<TableRange>,
    columns: Option<Vec<TableColumn>>,
    has_header_row: Option<bool>,
    has_totals_row: Option<bool>,
    style: Option<String>,
    banded_rows: Option<bool>,
    banded_columns: Option<bool>,
    emphasize_first_column: Option<bool>,
    emphasize_last_column: Option<bool>,
    show_filter_buttons: Option<bool>,
}

// -----------------------------------------------------------------------
// get_all_built_in_styles — style count
// -----------------------------------------------------------------------

#[test]
fn built_in_styles_count_is_67() {
    let styles = get_all_built_in_styles();
    assert_eq!(styles.len(), 67);
}

#[test]
fn includes_all_light_styles_1_to_28() {
    for i in 1..=28 {
        let id = format!("TableStyleLight{}", i);
        assert!(get_built_in_style(&id).is_some(), "Missing style: {}", id);
    }
}

#[test]
fn includes_all_medium_styles_1_to_28() {
    for i in 1..=28 {
        let id = format!("TableStyleMedium{}", i);
        assert!(get_built_in_style(&id).is_some(), "Missing style: {}", id);
    }
}

#[test]
fn includes_all_dark_styles_1_to_11() {
    for i in 1..=11 {
        let id = format!("TableStyleDark{}", i);
        assert!(get_built_in_style(&id).is_some(), "Missing style: {}", id);
    }
}

#[test]
fn all_style_ids_are_unique() {
    let styles = get_all_built_in_styles();
    let mut ids: Vec<&str> = styles.iter().map(|s| s.id.as_str()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), styles.len());
}

// -----------------------------------------------------------------------
// resolve_table_cell_format — outside table
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// resolve_table_cell_format — header row
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// resolve_table_cell_format — totals row
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// resolve_table_cell_format — banded rows
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// resolve_table_cell_format — banded columns
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// resolve_table_cell_format — first column emphasis
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// resolve_table_cell_format — last column emphasis
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// priority: first column emphasis overrides banding
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// different style presets
// -----------------------------------------------------------------------

#[test]
fn light1_header_colors() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleLight1".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#000000")));
    assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn light1_odd_row_fill() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleLight1".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
}

#[test]
fn light1_even_row_fill() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleLight1".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 4, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#F2F2F2")));
}

#[test]
fn medium1_header_colors() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleMedium1".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
    assert_eq!(fmt.font_color, Some(hex("#000000")));
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn medium1_border_color() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleMedium1".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
    assert_eq!(fmt.border_bottom.as_ref().unwrap().color, hex("#9B9B9B"));
}

#[test]
fn dark1_header_colors() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleDark1".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#000000")));
    assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
}

#[test]
fn dark1_data_row_banding() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleDark1".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#737373"))); // odd
    let fmt2 = resolve_table_cell_format(&table, 4, 2).unwrap();
    assert_eq!(fmt2.fill, Some(hex("#595959"))); // even
}

#[test]
fn dark1_totals_row() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleDark1".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 7, 1).unwrap();
    assert_eq!(fmt.fill, Some(hex("#000000")));
    assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
    assert_eq!(fmt.font_bold, Some(true));
}

// -----------------------------------------------------------------------
// data cell fontColor (dataText)
// -----------------------------------------------------------------------

#[test]
fn dark1_data_cells_have_white_font() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleDark1".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
    assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
    let fmt2 = resolve_table_cell_format(&table, 4, 2).unwrap();
    assert_eq!(fmt2.font_color, Some(hex("#FFFFFF")));
}

#[test]
fn all_dark_styles_set_font_color_on_data_cells() {
    for i in 1..=11 {
        let table = make_table(Some(TableOverrides {
            style: Some(format!("TableStyleDark{}", i)),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
        assert!(fmt.font_color.is_some(), "Dark{} missing fontColor", i);
    }
}

#[test]
fn dark_white_data_text_styles() {
    let white_styles = [1, 2, 3, 8, 9, 10, 11];
    for i in white_styles {
        let table = make_table(Some(TableOverrides {
            style: Some(format!("TableStyleDark{}", i)),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
        assert_eq!(
            fmt.font_color,
            Some(hex("#FFFFFF")),
            "Dark{} should have white data font",
            i
        );
    }
}

#[test]
fn dark_black_data_text_styles() {
    let black_styles = [4, 5, 6, 7];
    for i in black_styles {
        let table = make_table(Some(TableOverrides {
            style: Some(format!("TableStyleDark{}", i)),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
        assert_eq!(
            fmt.font_color,
            Some(hex("#000000")),
            "Dark{} should have black data font",
            i
        );
    }
}

#[test]
fn light1_data_cells_have_black_font() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleLight1".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
    assert_eq!(fmt.font_color, Some(hex("#000000")));
}

#[test]
fn medium2_data_cells_have_black_font() {
    let table = make_table(Some(TableOverrides {
        style: Some("TableStyleMedium2".to_string()),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
    assert_eq!(fmt.font_color, Some(hex("#000000")));
}

// -----------------------------------------------------------------------
// no header row
// -----------------------------------------------------------------------

#[test]
fn no_header_first_row_is_data() {
    let table = make_table(Some(TableOverrides {
        has_header_row: Some(false),
        has_totals_row: Some(true),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 2, 2).unwrap();
    assert_eq!(fmt.fill, Some(hex("#FFFFFF"))); // odd row fill
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

// -----------------------------------------------------------------------
// no totals row
// -----------------------------------------------------------------------

#[test]
fn no_totals_last_row_is_data() {
    let table = make_table(Some(TableOverrides {
        has_header_row: Some(true),
        has_totals_row: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 7, 2).unwrap();
    // data row index = 7 - 3 = 4, 4 % 2 == 0 -> oddRowFill
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

// -----------------------------------------------------------------------
// both banding off — BUG FIX test
// -----------------------------------------------------------------------

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
    // BUG FIX: When banding is OFF, fill should be None
    assert!(fmt3.fill.is_none());
    assert!(fmt4.fill.is_none());
    assert!(fmt5.fill.is_none());
}

// -----------------------------------------------------------------------
// unknown style falls back to default
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// edge cases
// -----------------------------------------------------------------------

#[test]
fn single_cell_table() {
    let table = make_table(Some(TableOverrides {
        range: Some(TableRange::new(0, 0, 0, 0)),
        columns: Some(vec![TableColumn {
            id: "c".to_string(),
            name: "X".to_string(),
            index: 0,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        }]),
        has_header_row: Some(false),
        has_totals_row: Some(false),
        ..Default::default()
    }));
    let fmt = resolve_table_cell_format(&table, 0, 0);
    assert!(fmt.is_some());
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
    // Data row at row 1
    let fmt = resolve_table_cell_format(&table, 1, 0).unwrap();
    // First column emphasis takes precedence (applied after last column)
    assert_eq!(fmt.fill, Some(hex("#4472C4")));
    assert_eq!(fmt.font_bold, Some(true));
}

#[test]
fn table_at_non_zero_origin() {
    let table = make_table(Some(TableOverrides {
        range: Some(TableRange::new(100, 50, 105, 52)),
        has_header_row: Some(true),
        has_totals_row: Some(false),
        ..Default::default()
    }));
    assert!(resolve_table_cell_format(&table, 0, 0).is_none());
    let fmt = resolve_table_cell_format(&table, 100, 50).unwrap();
    assert_eq!(fmt.font_bold, Some(true));
    let fmt_data = resolve_table_cell_format(&table, 101, 51);
    assert!(fmt_data.is_some());
    assert!(fmt_data.unwrap().fill.is_some());
}

// -----------------------------------------------------------------------
// dual banding (rows + columns)
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// column banding with last column emphasis
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Light 22-28 (new styles)
// -----------------------------------------------------------------------

#[test]
fn light22_style_exists() {
    let style = get_built_in_style("TableStyleLight22").unwrap();
    assert_eq!(style.header_fill, Some(hex("#4472C4")));
    assert_eq!(style.header_font_color, Some(hex("#FFFFFF")));
    assert_eq!(style.odd_row_fill, Some(hex("#FFFFFF")));
    assert_eq!(style.even_row_fill, Some(hex("#D6E4F0")));
    assert_eq!(style.border_color, Some(hex("#8FAADC")));
}

#[test]
fn light28_style_exists() {
    let style = get_built_in_style("TableStyleLight28").unwrap();
    assert_eq!(style.header_fill, Some(hex("#264478")));
    assert_eq!(style.header_font_color, Some(hex("#FFFFFF")));
    assert_eq!(style.odd_row_fill, Some(hex("#FFFFFF")));
    assert_eq!(style.even_row_fill, Some(hex("#B4C6E7")));
    assert_eq!(style.border_color, Some(hex("#8DB4E2")));
}

// -----------------------------------------------------------------------
// DEFAULT_STYLE_ID
// -----------------------------------------------------------------------

#[test]
fn default_style_id_is_medium2() {
    assert_eq!(DEFAULT_STYLE_ID, "TableStyleMedium2");
}

// -----------------------------------------------------------------------
// pathological: 1-row range with header + totals (data_end_row underflow)
// -----------------------------------------------------------------------

#[test]
fn one_row_range_with_header_and_totals_returns_none_for_data() {
    // A 1-row range where both has_header_row and has_totals_row are true
    // means the header *is* the totals row (row 0 is claimed by header).
    // data_start_row = 0 + 1 = 1, data_end_row = saturating_sub(0, 1) = 0.
    // So there is NO valid data area. Querying row 0 should match header,
    // not panic from u32 underflow.
    let table = make_table(Some(TableOverrides {
        range: Some(TableRange::new(0, 0, 0, 0)),
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
        ..Default::default()
    }));

    // Row 0 is the header row (header takes priority over totals).
    let fmt = resolve_table_cell_format(&table, 0, 0);
    assert!(fmt.is_some());
    // It must be treated as header (bold, header fill)
    let fmt = fmt.unwrap();
    assert_eq!(fmt.font_bold, Some(true));

    // Outside the table: no format
    assert!(resolve_table_cell_format(&table, 1, 0).is_none());
}
