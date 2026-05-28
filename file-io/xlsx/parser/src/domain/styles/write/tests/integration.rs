use crate::domain::styles::write::{
    AlignmentDef, BorderDef, CellXfDef, FontDef, HorizontalAlign, StylesWriter, VerticalAlign,
};

use super::fixtures::{assert_contains_all, indexed, solid_fill, thin_side, xml_string};

#[test]
fn test_complete_styles_xml_output() {
    let mut writer = StylesWriter::with_defaults();

    let num_fmt_id = writer.add_num_fmt("#,##0.00");

    let font_id = writer.add_font(FontDef {
        name: Some("Calibri".to_string()),
        size: Some(11.0),
        bold: Some(true),
        color: Some(crate::domain::styles::write::ColorDef::Rgb {
            val: "FFFF0000".to_string(),
            tint: None,
        }),
        ..Default::default()
    });

    let fill_id = writer.add_fill(solid_fill("FFFFFF00"));

    let border_id = writer.add_border(BorderDef {
        left: Some(thin_side(Some(indexed(64)))),
        right: Some(thin_side(Some(indexed(64)))),
        top: Some(thin_side(Some(indexed(64)))),
        bottom: Some(thin_side(Some(indexed(64)))),
        ..Default::default()
    });

    let xf = CellXfDef {
        num_fmt_id: Some(num_fmt_id),
        font_id: Some(font_id),
        fill_id: Some(fill_id),
        border_id: Some(border_id),
        xf_id: Some(0),
        alignment: Some(AlignmentDef {
            horizontal: Some(HorizontalAlign::Center),
            vertical: Some(VerticalAlign::Center),
            wrap_text: Some(true),
            ..Default::default()
        }),
        apply_number_format: Some(true),
        apply_font: Some(true),
        apply_fill: Some(true),
        apply_border: Some(true),
        apply_alignment: Some(true),
        ..Default::default()
    };

    writer.add_cell_xf(xf);

    let xml = xml_string(&writer);

    assert!(xml.starts_with("<?xml version=\"1.0\""));
    assert!(xml.contains("<styleSheet xmlns="));
    assert_contains_all(
        &xml,
        &[
            "<numFmts count=\"1\">",
            "numFmtId=\"164\"",
            "<fonts count=\"2\">",
            "<b/>",
            "<fills count=\"3\">",
            "patternType=\"solid\"",
            "<borders count=\"2\">",
            "<cellXfs count=\"2\">",
            "applyNumberFormat=\"1\"",
            "applyFont=\"1\"",
            "applyFill=\"1\"",
            "applyBorder=\"1\"",
            "applyAlignment=\"1\"",
            "<alignment",
            "horizontal=\"center\"",
            "wrapText=\"1\"",
        ],
    );
}
