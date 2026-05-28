use super::fixtures::{TableOverrides, hex, make_table};
use crate::styles::{get_built_in_style, resolve_table_cell_format};

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
    assert_eq!(fmt.fill, Some(hex("#737373")));
    let fmt2 = resolve_table_cell_format(&table, 4, 2).unwrap();
    assert_eq!(fmt2.fill, Some(hex("#595959")));
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
