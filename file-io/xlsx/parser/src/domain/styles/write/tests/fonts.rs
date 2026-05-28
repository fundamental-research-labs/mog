use crate::domain::styles::write::{
    ColorDef, FontDef, StylesWriter, UnderlineStyle, VerticalAlignRun,
};

use super::fixtures::{assert_contains_all, assert_in_order, rgb, theme, xml_string};

#[test]
fn test_add_font() {
    let mut writer = StylesWriter::new();

    let font = FontDef {
        name: Some("Arial".to_string()),
        size: Some(12.0),
        bold: Some(true),
        ..Default::default()
    };

    let id = writer.add_font(font);
    assert_eq!(id, 0);
    assert_eq!(writer.fonts.len(), 1);
}

#[test]
fn test_font_deduplication() {
    let mut writer = StylesWriter::new();

    let font1 = FontDef {
        name: Some("Arial".to_string()),
        size: Some(12.0),
        bold: Some(true),
        ..Default::default()
    };

    let font2 = FontDef {
        name: Some("Arial".to_string()),
        size: Some(12.0),
        bold: Some(true),
        ..Default::default()
    };

    let id1 = writer.add_font(font1);
    let id2 = writer.add_font(font2);

    assert_eq!(id1, id2);
    assert_eq!(writer.fonts.len(), 1);
}

#[test]
fn test_font_with_all_properties() {
    let mut writer = StylesWriter::with_defaults();

    let font = FontDef {
        name: Some("Calibri".to_string()),
        size: Some(14.0),
        bold: Some(true),
        italic: Some(true),
        underline: Some(UnderlineStyle::Double),
        strikethrough: Some(true),
        color: Some(rgb("FFFF0000")),
        family: Some(2),
        scheme: None,
        ..Default::default()
    };

    let id = writer.add_font(font);
    assert_eq!(id, 1);
}

#[test]
fn test_to_xml_with_bold_font() {
    let mut writer = StylesWriter::with_defaults();

    writer.add_font(FontDef {
        name: Some("Arial".to_string()),
        size: Some(12.0),
        bold: Some(true),
        ..Default::default()
    });

    let xml = xml_string(&writer);

    assert_contains_all(
        &xml,
        &["<fonts count=\"2\">", "<b/>", "<name val=\"Arial\"/>"],
    );
}

#[test]
fn test_to_xml_with_theme_color() {
    let mut writer = StylesWriter::new();

    writer.fonts.push(FontDef {
        name: Some("Calibri".to_string()),
        size: Some(11.0),
        color: Some(theme(1, Some("0.5"))),
        ..Default::default()
    });

    writer
        .fills
        .push(crate::domain::styles::write::FillDef::None);
    writer
        .borders
        .push(crate::domain::styles::write::BorderDef::default());
    writer
        .cell_style_xfs
        .push(crate::domain::styles::write::CellXfDef::default());
    writer
        .cell_xfs
        .push(crate::domain::styles::write::CellXfDef::default());

    let xml = xml_string(&writer);

    assert_contains_all(&xml, &["theme=\"1\"", "tint=\"0.5\""]);
}

#[test]
fn test_underline_style_values() {
    assert_eq!(UnderlineStyle::Single.to_ooxml(), "single");
    assert_eq!(UnderlineStyle::Double.to_ooxml(), "double");
    assert_eq!(
        UnderlineStyle::SingleAccounting.to_ooxml(),
        "singleAccounting"
    );
    assert_eq!(
        UnderlineStyle::DoubleAccounting.to_ooxml(),
        "doubleAccounting"
    );
    assert_eq!(UnderlineStyle::None.to_ooxml(), "none");
}

#[test]
fn vertical_align_run_values() {
    assert_eq!(VerticalAlignRun::Baseline.to_ooxml(), "baseline");
    assert_eq!(VerticalAlignRun::Superscript.to_ooxml(), "superscript");
    assert_eq!(VerticalAlignRun::Subscript.to_ooxml(), "subscript");
}

#[test]
fn font_boolean_false_markers_are_emitted() {
    let mut writer = StylesWriter::with_defaults();
    writer.add_font(FontDef {
        bold: Some(false),
        italic: Some(false),
        strikethrough: Some(false),
        condense: Some(false),
        extend: Some(false),
        outline: Some(false),
        shadow: Some(false),
        ..Default::default()
    });

    let xml = xml_string(&writer);
    assert_contains_all(
        &xml,
        &[
            "<b val=\"0\"/>",
            "<i val=\"0\"/>",
            "<strike val=\"0\"/>",
            "<condense val=\"0\"/>",
            "<extend val=\"0\"/>",
            "<outline val=\"0\"/>",
            "<shadow val=\"0\"/>",
        ],
    );
}

#[test]
fn font_child_order_is_stable() {
    let mut writer = StylesWriter::with_defaults();
    writer.add_font(FontDef {
        bold: Some(false),
        italic: Some(false),
        strikethrough: Some(false),
        condense: Some(false),
        extend: Some(false),
        outline: Some(false),
        shadow: Some(false),
        underline: Some(UnderlineStyle::Double),
        vert_align: Some(VerticalAlignRun::Superscript),
        size: Some(12.0),
        color: Some(ColorDef::rgb("FFFF0000")),
        name: Some("Arial".to_string()),
        family: Some(2),
        charset: Some(1),
        scheme: Some(crate::domain::styles::write::FontScheme::Minor),
    });

    let xml = xml_string(&writer);
    assert_in_order(
        &xml,
        &[
            "<b val=\"0\"/>",
            "<i val=\"0\"/>",
            "<strike val=\"0\"/>",
            "<condense val=\"0\"/>",
            "<extend val=\"0\"/>",
            "<outline val=\"0\"/>",
            "<shadow val=\"0\"/>",
            "<u val=\"double\"/>",
            "<vertAlign val=\"superscript\"/>",
            "<sz val=\"12\"/>",
            "<color rgb=\"FFFF0000\"/>",
            "<name val=\"Arial\"/>",
            "<family val=\"2\"/>",
            "<charset val=\"1\"/>",
            "<scheme val=\"minor\"/>",
        ],
    );
}

#[test]
fn test_known_fonts_false_does_not_emit_x14ac() {
    let mut writer = StylesWriter::with_defaults();
    writer.known_fonts = false;
    let xml = xml_string(&writer);

    assert!(
        !xml.contains("x14ac"),
        "x14ac should not appear when known_fonts is false"
    );
    assert!(
        !xml.contains("mc:Ignorable"),
        "mc:Ignorable should not appear when known_fonts is false"
    );
    assert!(
        !xml.contains("knownFonts"),
        "knownFonts should not appear when known_fonts is false"
    );
}

#[test]
fn test_known_fonts_true_emits_x14ac_namespace_and_attribute() {
    let mut writer = StylesWriter::with_defaults();
    writer.known_fonts = true;
    let xml = xml_string(&writer);

    assert_contains_all(
        &xml,
        &[
            "xmlns:x14ac=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac\"",
            "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\"",
            "mc:Ignorable=\"x14ac\"",
            "x14ac:knownFonts=\"1\"",
        ],
    );
}
