use super::super::normalize_rgb_color;
use crate::output::results::FontOutput;

#[test]
fn test_normalize_rgb_color() {
    assert_eq!(normalize_rgb_color("#FF0000"), "#FF0000");
    assert_eq!(normalize_rgb_color("FF0000"), "#FF0000");
    assert_eq!(normalize_rgb_color("FFFF0000"), "#FF0000"); // ARGB
}

#[test]
fn font_charset_survives_semantic_style_conversion() {
    let font = FontOutput {
        name: "MS Gothic".to_string(),
        size: 11.0,
        bold: false,
        italic: false,
        underline: None,
        strikethrough: false,
        color: None,
        family: Some(3),
        charset: Some(128),
        scheme: None,
        vert_align: None,
        condense: None,
        extend: None,
        outline: None,
        shadow: None,
    };

    let input = super::super::styles::convert_font_to_input(&font);

    assert_eq!(input.charset, Some(128));
    assert_eq!(input.family, Some(3));
}
