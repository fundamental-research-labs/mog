use domain_types::CellFormat;

/// Excel "Normal" style defaults -- the lowest-priority layer in format
/// inheritance. Any property not overridden at column, row, or cell level
/// resolves to these values.
pub fn default_format() -> CellFormat {
    CellFormat {
        font_family: Some("Calibri".to_string()),
        font_size: Some(domain_types::FontSize::from_millipoints(11000)),
        font_color: Some("#000000".to_string()),
        bold: Some(false),
        italic: Some(false),
        underline_type: Some(ooxml_types::styles::UnderlineStyle::None),
        strikethrough: Some(false),
        horizontal_align: Some(ooxml_types::styles::HorizontalAlign::General),
        vertical_align: Some(domain_types::CellVerticalAlign::Bottom),
        wrap_text: Some(false),
        locked: Some(true),
        hidden: Some(false),
        ..Default::default()
    }
}
