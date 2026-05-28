use crate::domain::styles::write::{
    ColorDef, FillDef, GradientStop, GradientType, PatternType, StylesWriter,
};

use super::fixtures::{assert_contains_all, assert_in_order, indexed, rgb, solid_fill, xml_string};

#[test]
fn test_add_fill_solid() {
    let mut writer = StylesWriter::new();

    let id = writer.add_fill(solid_fill("FFFFFF00"));

    assert_eq!(id, 0);
    assert_eq!(writer.fills.len(), 1);
}

#[test]
fn test_fill_deduplication() {
    let mut writer = StylesWriter::new();

    let id1 = writer.add_fill(solid_fill("FFFFFF00"));
    let id2 = writer.add_fill(solid_fill("FFFFFF00"));

    assert_eq!(id1, id2);
    assert_eq!(writer.fills.len(), 1);
}

#[test]
fn test_add_fill_pattern() {
    let mut writer = StylesWriter::new();

    let fill = FillDef::Pattern {
        pattern_type: Some(PatternType::Gray125),
        fg_color: Some(indexed(64)),
        bg_color: None,
    };

    let id = writer.add_fill(fill);
    assert_eq!(id, 0);
}

#[test]
fn test_add_fill_gradient() {
    let mut writer = StylesWriter::new();

    let fill = FillDef::Gradient {
        gradient_type: GradientType::Linear,
        degree: Some(90.0),
        stops: vec![
            GradientStop {
                position: 0.0,
                color: rgb("FFFFFFFF"),
            },
            GradientStop {
                position: 1.0,
                color: rgb("FF000000"),
            },
        ],
        left: None,
        right: None,
        top: None,
        bottom: None,
    };

    let id = writer.add_fill(fill);
    assert_eq!(id, 0);
}

#[test]
fn test_to_xml_with_solid_fill() {
    let mut writer = StylesWriter::with_defaults();

    writer.add_fill(solid_fill("FFFFFF00"));

    let xml = xml_string(&writer);

    assert_contains_all(
        &xml,
        &[
            "<fills count=\"3\">",
            "patternType=\"solid\"",
            "<fgColor rgb=\"FFFFFF00\"/>",
        ],
    );
}

#[test]
fn test_to_xml_with_gradient_fill() {
    let mut writer = StylesWriter::with_defaults();

    writer.add_fill(FillDef::Gradient {
        gradient_type: GradientType::Linear,
        degree: Some(90.0),
        stops: vec![
            GradientStop {
                position: 0.0,
                color: rgb("FFFFFFFF"),
            },
            GradientStop {
                position: 1.0,
                color: rgb("FF000000"),
            },
        ],
        left: None,
        right: None,
        top: None,
        bottom: None,
    });

    let xml = xml_string(&writer);

    assert_contains_all(
        &xml,
        &[
            "<gradientFill",
            "type=\"linear\"",
            "degree=\"90\"",
            "<stop",
            "position=\"0\"",
            "position=\"1\"",
        ],
    );
}

#[test]
fn test_pattern_type_values() {
    assert_eq!(PatternType::None.to_ooxml(), "none");
    assert_eq!(PatternType::Solid.to_ooxml(), "solid");
    assert_eq!(PatternType::Gray125.to_ooxml(), "gray125");
    assert_eq!(PatternType::Gray0625.to_ooxml(), "gray0625");
    assert_eq!(PatternType::DarkGray.to_ooxml(), "darkGray");
    assert_eq!(PatternType::MediumGray.to_ooxml(), "mediumGray");
    assert_eq!(PatternType::LightGray.to_ooxml(), "lightGray");
}

#[test]
fn pattern_fill_without_pattern_type_omits_attribute() {
    let mut writer = StylesWriter::with_defaults();
    writer.add_fill(FillDef::Pattern {
        pattern_type: None,
        fg_color: Some(ColorDef::rgb("FFFF0000")),
        bg_color: Some(indexed(64)),
    });

    let xml = xml_string(&writer);
    assert!(xml.contains(
        "<patternFill><fgColor rgb=\"FFFF0000\"/><bgColor indexed=\"64\"/></patternFill>"
    ));
}

#[test]
fn gradient_stop_order_is_preserved() {
    let mut writer = StylesWriter::with_defaults();
    writer.add_fill(FillDef::Gradient {
        gradient_type: GradientType::Linear,
        degree: None,
        stops: vec![
            GradientStop {
                position: 0.25,
                color: rgb("FF111111"),
            },
            GradientStop {
                position: 0.75,
                color: rgb("FFEEEEEE"),
            },
        ],
        left: None,
        right: None,
        top: None,
        bottom: None,
    });

    let xml = xml_string(&writer);
    assert_in_order(
        &xml,
        &[
            "position=\"0.25\"",
            "<color rgb=\"FF111111\"/>",
            "position=\"0.75\"",
            "<color rgb=\"FFEEEEEE\"/>",
        ],
    );
}
