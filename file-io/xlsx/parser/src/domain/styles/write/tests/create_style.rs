use crate::domain::styles::write::{
    AlignmentDef, BorderDef, FontDef, HorizontalAlign, StylesWriter, VerticalAlign,
};

use super::fixtures::{solid_fill, thin_side};

#[test]
fn test_create_style_simple() {
    let mut writer = StylesWriter::with_defaults();

    let style_id = writer.create_style(None, None, None, None, None);

    assert_eq!(style_id, 1);
    assert_eq!(writer.cell_xfs[style_id as usize].font_id, Some(0));
    assert_eq!(writer.cell_xfs[style_id as usize].fill_id, Some(0));
    assert_eq!(writer.cell_xfs[style_id as usize].border_id, Some(0));
    assert_eq!(writer.cell_xfs[style_id as usize].xf_id, Some(0));
}

#[test]
fn test_create_style_with_font() {
    let mut writer = StylesWriter::with_defaults();

    let font = FontDef {
        name: Some("Arial".to_string()),
        size: Some(12.0),
        bold: Some(true),
        ..Default::default()
    };

    let style_id = writer.create_style(Some(font), None, None, None, None);

    assert_eq!(style_id, 1);
    assert_eq!(writer.fonts.len(), 2);
    assert_eq!(writer.cell_xfs[style_id as usize].font_id, Some(1));
    assert_eq!(writer.cell_xfs[style_id as usize].apply_font, Some(true));
}

#[test]
fn test_create_style_with_all_components() {
    let mut writer = StylesWriter::with_defaults();

    let font = FontDef {
        name: Some("Arial".to_string()),
        size: Some(14.0),
        bold: Some(true),
        ..Default::default()
    };

    let border = BorderDef {
        left: Some(thin_side(None)),
        ..Default::default()
    };

    let alignment = AlignmentDef {
        horizontal: Some(HorizontalAlign::Center),
        vertical: Some(VerticalAlign::Center),
        wrap_text: Some(true),
        ..Default::default()
    };

    let style_id = writer.create_style(
        Some(font),
        Some(solid_fill("FFFFFF00")),
        Some(border),
        Some("#,##0.00"),
        Some(alignment),
    );

    assert_eq!(style_id, 1);
    assert_eq!(writer.fonts.len(), 2);
    assert_eq!(writer.fills.len(), 3);
    assert_eq!(writer.borders.len(), 2);
    assert_eq!(writer.num_fmts.len(), 1);

    let xf = &writer.cell_xfs[style_id as usize];
    assert_eq!(xf.num_fmt_id, Some(164));
    assert_eq!(xf.font_id, Some(1));
    assert_eq!(xf.fill_id, Some(2));
    assert_eq!(xf.border_id, Some(1));
    assert_eq!(xf.xf_id, Some(0));
    assert_eq!(xf.apply_number_format, Some(true));
    assert_eq!(xf.apply_font, Some(true));
    assert_eq!(xf.apply_fill, Some(true));
    assert_eq!(xf.apply_border, Some(true));
    assert_eq!(xf.apply_alignment, None);
    assert_eq!(
        xf.alignment.as_ref().unwrap().horizontal,
        Some(HorizontalAlign::Center)
    );
}

#[test]
fn create_style_reuses_default_component_ids_without_apply_flags() {
    let mut writer = StylesWriter::with_defaults();

    let style_id = writer.create_style(None, None, None, None, None);
    let xf = &writer.cell_xfs[style_id as usize];

    assert_eq!(xf.num_fmt_id, Some(0));
    assert_eq!(xf.font_id, Some(0));
    assert_eq!(xf.fill_id, Some(0));
    assert_eq!(xf.border_id, Some(0));
    assert_eq!(xf.apply_number_format, None);
    assert_eq!(xf.apply_font, None);
    assert_eq!(xf.apply_fill, None);
    assert_eq!(xf.apply_border, None);
    assert_eq!(xf.apply_alignment, None);
}
