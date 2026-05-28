use crate::domain::styles::write::{BorderDef, BorderSideDef, BorderStyle, StylesWriter};

use super::fixtures::{assert_contains_all, assert_in_order, indexed, rgb, thin_side, xml_string};

#[test]
fn test_add_border_empty() {
    let mut writer = StylesWriter::new();

    let border = BorderDef::default();
    let id = writer.add_border(border);

    assert_eq!(id, 0);
    assert_eq!(writer.borders.len(), 1);
}

#[test]
fn test_add_border_thin() {
    let mut writer = StylesWriter::new();

    let border = BorderDef {
        left: Some(thin_side(Some(indexed(64)))),
        right: Some(thin_side(Some(indexed(64)))),
        top: Some(thin_side(Some(indexed(64)))),
        bottom: Some(thin_side(Some(indexed(64)))),
        ..Default::default()
    };

    let id = writer.add_border(border);
    assert_eq!(id, 0);
}

#[test]
fn test_border_deduplication() {
    let mut writer = StylesWriter::new();

    let border1 = BorderDef {
        left: Some(thin_side(None)),
        ..Default::default()
    };

    let border2 = BorderDef {
        left: Some(thin_side(None)),
        ..Default::default()
    };

    let id1 = writer.add_border(border1);
    let id2 = writer.add_border(border2);

    assert_eq!(id1, id2);
    assert_eq!(writer.borders.len(), 1);
}

#[test]
fn test_border_with_diagonal() {
    let mut writer = StylesWriter::new();

    let border = BorderDef {
        diagonal: Some(thin_side(Some(rgb("FFFF0000")))),
        diagonal_up: Some(true),
        diagonal_down: Some(true),
        ..Default::default()
    };

    let id = writer.add_border(border);
    assert_eq!(id, 0);
}

#[test]
fn test_to_xml_with_borders() {
    let mut writer = StylesWriter::with_defaults();

    writer.add_border(BorderDef {
        left: Some(thin_side(Some(indexed(64)))),
        right: Some(BorderSideDef {
            style: BorderStyle::Medium,
            color: None,
        }),
        top: Some(BorderSideDef {
            style: BorderStyle::Thick,
            color: Some(rgb("FF000000")),
        }),
        bottom: Some(BorderSideDef {
            style: BorderStyle::Double,
            color: None,
        }),
        ..Default::default()
    });

    let xml = xml_string(&writer);

    assert_contains_all(
        &xml,
        &[
            "<borders count=\"2\">",
            "<left style=\"thin\">",
            "<right style=\"medium\">",
            "<top style=\"thick\">",
            "<bottom style=\"double\">",
            "indexed=\"64\"",
        ],
    );
}

#[test]
fn test_border_style_values() {
    assert_eq!(BorderStyle::None.to_ooxml(), "none");
    assert_eq!(BorderStyle::Thin.to_ooxml(), "thin");
    assert_eq!(BorderStyle::Medium.to_ooxml(), "medium");
    assert_eq!(BorderStyle::Thick.to_ooxml(), "thick");
    assert_eq!(BorderStyle::Dashed.to_ooxml(), "dashed");
    assert_eq!(BorderStyle::Dotted.to_ooxml(), "dotted");
    assert_eq!(BorderStyle::Double.to_ooxml(), "double");
    assert_eq!(BorderStyle::Hair.to_ooxml(), "hair");
    assert_eq!(BorderStyle::MediumDashed.to_ooxml(), "mediumDashed");
    assert_eq!(BorderStyle::DashDot.to_ooxml(), "dashDot");
    assert_eq!(BorderStyle::MediumDashDot.to_ooxml(), "mediumDashDot");
    assert_eq!(BorderStyle::DashDotDot.to_ooxml(), "dashDotDot");
    assert_eq!(BorderStyle::MediumDashDotDot.to_ooxml(), "mediumDashDotDot");
    assert_eq!(BorderStyle::SlantDashDot.to_ooxml(), "slantDashDot");
}

#[test]
fn border_side_order_and_optional_sides_are_stable() {
    let mut writer = StylesWriter::with_defaults();
    writer.add_border(BorderDef {
        left: Some(thin_side(None)),
        right: Some(BorderSideDef::default()),
        top: Some(thin_side(None)),
        bottom: Some(thin_side(None)),
        diagonal: Some(thin_side(None)),
        start: Some(thin_side(None)),
        end: Some(thin_side(None)),
        vertical: Some(thin_side(None)),
        horizontal: Some(thin_side(None)),
        outline: Some(false),
        ..Default::default()
    });

    let xml = xml_string(&writer);
    assert!(xml.contains("<border outline=\"0\">"));
    assert!(xml.contains("<right/>"));
    assert_in_order(
        &xml,
        &[
            "<left style=\"thin\"/>",
            "<right/>",
            "<top style=\"thin\"/>",
            "<bottom style=\"thin\"/>",
            "<diagonal style=\"thin\"/>",
            "<start style=\"thin\"/>",
            "<end style=\"thin\"/>",
            "<vertical style=\"thin\"/>",
            "<horizontal style=\"thin\"/>",
        ],
    );
}
