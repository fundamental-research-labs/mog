use super::fixtures::*;
use super::*;

fn fmt_fill(hex: &str) -> CellFormat {
    CellFormat {
        background_color: Some(hex.to_string()),
        ..CellFormat::default()
    }
}

fn fmt_font(hex: &str) -> CellFormat {
    CellFormat {
        font_color: Some(hex.to_string()),
        ..CellFormat::default()
    }
}

fn fmt_default() -> CellFormat {
    CellFormat::default()
}

/// When the caller doesn't supply per-row formats, color filters fall back to
/// all-pass. This is the historical "engine doesn't have format access" path —
/// kept for the pure FFI bridge that doesn't carry format context.
#[test]
fn test_color_filter_no_formats_is_all_pass() {
    let criteria = FilterCriteria::Color(TableColorFilter {
        cell_color: Some(Color::rgb(255, 0, 0)),
        font_color: None,
    });
    let data = vec![cv_num(1.0), cv_text("hello"), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1]);
}

/// Yellow fill matches yellow request; white fill does not.
#[test]
fn test_color_filter_fill_matches_only_same_hex() {
    let criteria = FilterCriteria::Color(TableColorFilter {
        cell_color: Some(Color::rgb(0xff, 0xff, 0x00)),
        font_color: None,
    });
    let data = vec![cv_num(1.0), cv_num(2.0), cv_num(3.0)];
    let formats = vec![
        fmt_fill("#FFFF00"), // yellow uppercase
        fmt_fill("#ffff00"), // yellow lowercase — case-insensitive match
        fmt_fill("#FFFFFF"), // white — does not match
    ];
    assert_eq!(eval_color(&criteria, &data, &formats), vec![1, 1, 0]);
}

/// Font-color filter is independent of fill: a yellow-fill cell with black
/// font should not match a request for red font.
#[test]
fn test_color_filter_font_independent_of_fill() {
    let criteria = FilterCriteria::Color(TableColorFilter {
        cell_color: None,
        font_color: Some(Color::rgb(0xff, 0x00, 0x00)),
    });
    let data = vec![cv_text("a"), cv_text("b"), cv_text("c")];
    let formats = vec![
        // Yellow fill but no font color — should not match red-font request
        fmt_fill("#FFFF00"),
        // Red font, no fill — should match
        fmt_font("#FF0000"),
        // Red fill, no font — should not match a font filter
        fmt_fill("#FF0000"),
    ];
    assert_eq!(eval_color(&criteria, &data, &formats), vec![0, 1, 0]);
}

/// A cell with no fill set (default white background) is *not* a wildcard for
/// any non-default request. Excel filters by the displayed color; an unstyled
/// cell does not match a "yellow fill" filter.
#[test]
fn test_color_filter_default_fill_is_distinct() {
    let criteria = FilterCriteria::Color(TableColorFilter {
        cell_color: Some(Color::rgb(0xff, 0xff, 0x00)),
        font_color: None,
    });
    let data = vec![cv_num(1.0), cv_num(2.0)];
    let formats = vec![
        fmt_default(), // unstyled — must not match
        fmt_fill("#FFFF00"),
    ];
    assert_eq!(eval_color(&criteria, &data, &formats), vec![0, 1]);
}
