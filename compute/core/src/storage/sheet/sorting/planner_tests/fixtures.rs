use domain_types::CellFormat;

pub(super) fn fmt_fill(color: &str) -> CellFormat {
    CellFormat {
        background_color: Some(color.to_string()),
        ..Default::default()
    }
}

pub(super) fn fmt_font(color: &str) -> CellFormat {
    CellFormat {
        font_color: Some(color.to_string()),
        ..Default::default()
    }
}
