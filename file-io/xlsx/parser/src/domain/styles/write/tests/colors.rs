use crate::domain::styles::write::{ColorDef, ColorsDef, StylesWriter};

use super::fixtures::{
    assert_contains_all, assert_in_order, indexed_tint, rgb_tint, theme, xml_string,
};

#[test]
fn test_write_colors() {
    let mut writer = StylesWriter::with_defaults();
    writer.colors = Some(ColorsDef {
        indexed_colors: vec!["FF000000".to_string(), "FFFFFFFF".to_string()],
        mru_colors: vec![ColorDef::rgb("FFFF0000")],
    });
    let xml = xml_string(&writer);
    assert_contains_all(
        &xml,
        &[
            "<colors>",
            "<indexedColors>",
            "rgb=\"FF000000\"",
            "<mruColors>",
            "rgb=\"FFFF0000\"",
        ],
    );
}

#[test]
fn test_write_colors_empty_not_emitted() {
    let mut writer = StylesWriter::with_defaults();
    writer.colors = Some(ColorsDef {
        indexed_colors: vec![],
        mru_colors: vec![],
    });
    let xml = xml_string(&writer);
    assert!(!xml.contains("<colors>"));
}

#[test]
fn test_write_colors_indexed_only() {
    let mut writer = StylesWriter::with_defaults();
    writer.colors = Some(ColorsDef {
        indexed_colors: vec!["FF000000".to_string()],
        mru_colors: vec![],
    });
    let xml = xml_string(&writer);
    assert!(xml.contains("<indexedColors>"));
    assert!(!xml.contains("<mruColors>"));
}

#[test]
fn color_tint_attributes_are_written_for_all_color_kinds() {
    let mut writer = StylesWriter::with_defaults();
    writer.colors = Some(ColorsDef {
        indexed_colors: vec![],
        mru_colors: vec![
            indexed_tint(64, "0.1"),
            rgb_tint("FFFF0000", "0.2"),
            theme(2, Some("0.3")),
            ColorDef::Auto {
                tint: Some("0.4".to_string()),
            },
        ],
    });

    let xml = xml_string(&writer);
    assert_contains_all(
        &xml,
        &[
            "<color indexed=\"64\" tint=\"0.1\"/>",
            "<color rgb=\"FFFF0000\" tint=\"0.2\"/>",
            "<color theme=\"2\" tint=\"0.3\"/>",
            "<color auto=\"1\" tint=\"0.4\"/>",
        ],
    );
}

#[test]
fn colors_are_written_after_table_styles() {
    let mut writer = StylesWriter::with_defaults();
    writer.colors = Some(ColorsDef {
        indexed_colors: vec!["FF000000".to_string()],
        mru_colors: vec![],
    });

    let xml = xml_string(&writer);
    assert_in_order(&xml, &["<tableStyles", "<colors>"]);
}
