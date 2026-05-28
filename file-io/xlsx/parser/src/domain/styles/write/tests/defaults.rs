use crate::domain::styles::write::StylesWriter;

use super::fixtures::{assert_contains_all, default_writer_xml};

#[test]
fn test_new_empty_writer() {
    let writer = StylesWriter::new();
    assert!(writer.num_fmts.is_empty());
    assert!(writer.fonts.is_empty());
    assert!(writer.fills.is_empty());
    assert!(writer.borders.is_empty());
    assert!(writer.cell_xfs.is_empty());
    assert!(writer.cell_style_xfs.is_empty());
}

#[test]
fn test_with_defaults() {
    let writer = StylesWriter::with_defaults();

    assert_eq!(writer.fonts.len(), 1);
    assert_eq!(writer.fonts[0].name, Some("Calibri".to_string()));
    assert_eq!(writer.fonts[0].size, Some(11.0));
    assert_eq!(writer.fills.len(), 2);
    assert_eq!(writer.borders.len(), 1);
    assert_eq!(writer.cell_style_xfs.len(), 1);
    assert_eq!(writer.cell_xfs.len(), 1);
}

#[test]
fn test_to_xml_default() {
    let xml = default_writer_xml();

    assert_contains_all(
        &xml,
        &[
            "<?xml version=\"1.0\"",
            "<styleSheet",
            "</styleSheet>",
            "<fonts count=\"1\">",
            "<name val=\"Calibri\"/>",
            "<fills count=\"2\">",
            "patternType=\"none\"",
            "patternType=\"gray125\"",
            "<borders count=\"1\">",
            "<cellStyleXfs count=\"1\">",
            "<cellXfs count=\"1\">",
            "<dxfs count=\"0\"/>",
            "<tableStyles count=\"0\" defaultTableStyle=\"TableStyleMedium2\" defaultPivotStyle=\"PivotStyleLight16\"/>",
        ],
    );
}
