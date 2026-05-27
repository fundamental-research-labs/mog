use super::common::*;

// -------------------------------------------------------------------------
// Gradient angle, pattern fill, outline compound/cap, shape style
// -------------------------------------------------------------------------

#[test]
fn test_gradient_fill_with_nonzero_angle() {
    let mut writer = DrawingWriter::new();
    writer.add_shape(
        CellAnchor::default(),
        CellAnchor::default(),
        ShapeProps {
            original_id: None,
            name: "Angled Gradient".to_string(),
            preset: ShapePreset::Rect,
            fill: Some(DrawingFill::Gradient(GradientFill {
                stops: vec![
                    GradientStop {
                        position: StPositiveFixedPercentageDecimal::new_unchecked(0),
                        color: rgb("FF0000"),
                    },
                    GradientStop {
                        position: StPositiveFixedPercentageDecimal::new_unchecked(100000),
                        color: rgb("0000FF"),
                    },
                ],
                lin_ang: Some(StAngle::new(5_400_000)), // 90 degrees in 60000ths
                ..Default::default()
            })),
            outline: None,
            text: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("ang=\"5400000\""),
        "Should have 90-degree angle: {}",
        xml_str
    );
    assert!(
        xml_str.contains("scaled=\"1\""),
        "Should have scaled attribute"
    );
    assert!(
        xml_str.contains("val=\"FF0000\""),
        "Should have first stop color"
    );
    assert!(
        xml_str.contains("val=\"0000FF\""),
        "Should have second stop color"
    );
}

#[test]
fn test_gradient_fill_default_angle() {
    let mut writer = DrawingWriter::new();
    writer.add_shape(
        CellAnchor::default(),
        CellAnchor::default(),
        ShapeProps {
            original_id: None,
            name: "Default Angle Gradient".to_string(),
            preset: ShapePreset::Rect,
            fill: Some(DrawingFill::Gradient(GradientFill {
                stops: vec![
                    GradientStop {
                        position: StPositiveFixedPercentageDecimal::new_unchecked(0),
                        color: rgb("FFFFFF"),
                    },
                    GradientStop {
                        position: StPositiveFixedPercentageDecimal::new_unchecked(100000),
                        color: rgb("000000"),
                    },
                ],
                ..Default::default() // No lin_ang: should default to no lin element
            })),
            outline: None,
            text: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // When angle is None, no <a:lin> element is emitted
    assert!(
        !xml_str.contains("<a:lin"),
        "Should not have lin element when angle is None: {}",
        xml_str
    );
}

#[test]
fn test_pattern_fill() {
    let mut writer = DrawingWriter::new();
    writer.add_shape(
        CellAnchor::default(),
        CellAnchor::default(),
        ShapeProps {
            original_id: None,
            name: "Pattern Shape".to_string(),
            preset: ShapePreset::Rect,
            fill: Some(DrawingFill::Pattern(PatternFill {
                preset: Some(ooxml_types::drawings::PresetPatternVal::LtDnDiag),
                fg_color: Some(rgb("FF0000")),
                bg_color: Some(rgb("FFFFFF")),
            })),
            outline: None,
            text: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("<a:pattFill prst=\"ltDnDiag\">"),
        "Should have pattFill: {}",
        xml_str
    );
    assert!(xml_str.contains("<a:fgClr>"), "Should have fgClr");
    assert!(xml_str.contains("<a:bgClr>"), "Should have bgClr");
    assert!(xml_str.contains("</a:pattFill>"), "Should close pattFill");
}

#[test]
fn test_pattern_fill_no_colors() {
    let mut writer = DrawingWriter::new();
    writer.add_shape(
        CellAnchor::default(),
        CellAnchor::default(),
        ShapeProps {
            original_id: None,
            name: "Pattern No Colors".to_string(),
            preset: ShapePreset::Rect,
            fill: Some(DrawingFill::Pattern(PatternFill {
                preset: Some(ooxml_types::drawings::PresetPatternVal::DkHorz),
                fg_color: None,
                bg_color: None,
            })),
            outline: None,
            text: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("<a:pattFill prst=\"dkHorz\">"),
        "Should have pattFill: {}",
        xml_str
    );
    assert!(
        !xml_str.contains("<a:fgClr>"),
        "Should not have fgClr when None"
    );
    assert!(
        !xml_str.contains("<a:bgClr>"),
        "Should not have bgClr when None"
    );
}

#[test]
fn test_outline_with_compound_and_cap() {
    let mut writer = DrawingWriter::new();
    writer.add_shape(
        CellAnchor::default(),
        CellAnchor::default(),
        ShapeProps {
            original_id: None,
            name: "Compound Outline".to_string(),
            preset: ShapePreset::Rect,
            fill: None,
            outline: Some(Outline {
                width: Some(19050),
                fill: Some(line_solid("0070C0")),
                compound: Some(CompoundLine::Double),
                cap: Some(LineCap::Round),
                ..Default::default()
            }),
            text: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("cmpd=\"dbl\""),
        "Should have compound attribute: {}",
        xml_str
    );
    assert!(
        xml_str.contains("cap=\"rnd\""),
        "Should have cap attribute: {}",
        xml_str
    );
    assert!(xml_str.contains("w=\"19050\""), "Should have width");
}

#[test]
fn test_outline_without_compound_cap_backward_compat() {
    // Verify that outlines without the new fields produce identical output
    let mut writer = DrawingWriter::new();
    writer.add_shape(
        CellAnchor::default(),
        CellAnchor::default(),
        ShapeProps {
            original_id: None,
            name: "Simple Outline".to_string(),
            preset: ShapePreset::Rect,
            fill: None,
            outline: Some(Outline {
                width: Some(12700),
                fill: Some(line_solid("000000")),
                dash: Some(LineDash::Preset(DashStyle::Solid)),
                ..Default::default()
            }),
            text: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Should NOT contain cmpd or cap attributes
    assert!(!xml_str.contains("cmpd="), "Should not have cmpd when None");
    assert!(!xml_str.contains("cap="), "Should not have cap when None");
    // Should still have basic outline
    assert!(
        xml_str.contains("<a:ln w=\"12700\">"),
        "Should have width: {}",
        xml_str
    );
}

#[test]
fn test_shape_style_refs_with_scheme_color() {
    let writer = DrawingWriter::new();
    let mut w = crate::write::xml_writer::XmlWriter::new();

    let style = ShapeStyle {
        line_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(2),
            color: Some(DrawingColor::SchemeClr {
                val: ooxml_types::drawings::SchemeColor::Accent1,
                transforms: vec![],
            }),
        },
        fill_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(1),
            color: Some(DrawingColor::SchemeClr {
                val: ooxml_types::drawings::SchemeColor::Accent1,
                transforms: vec![],
            }),
        },
        effect_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(0),
            color: None,
        },
        font_ref: ooxml_types::drawings::FontReference {
            idx: ooxml_types::drawings::FontCollectionIndex::None,
            color: Some(DrawingColor::SrgbClr {
                val: "FF0000".to_string(),
                transforms: vec![],
            }),
        },
    };

    writer.write_shape_style(&mut w, &style);
    let xml_bytes = w.finish();
    let xml_str = String::from_utf8(xml_bytes).unwrap();

    assert!(xml_str.contains("<xdr:style>"), "Should have style element");
    assert!(
        xml_str.contains("<a:lnRef idx=\"2\">"),
        "Should have lnRef idx=2"
    );
    assert!(
        xml_str.contains("<a:schemeClr val=\"accent1\"/>"),
        "Should have accent1 scheme color: {}",
        xml_str
    );
    assert!(
        xml_str.contains("<a:fillRef idx=\"1\">"),
        "Should have fillRef idx=1"
    );
    assert!(
        xml_str.contains("<a:effectRef idx=\"0\"/>"),
        "Should have self-closing effectRef"
    );
    assert!(
        xml_str.contains("<a:fontRef idx=\"none\">"),
        "Should have fontRef with color"
    );
    assert!(
        xml_str.contains("<a:srgbClr val=\"FF0000\"/>"),
        "Should have RGB color in fontRef"
    );
    assert!(
        xml_str.contains("</xdr:style>"),
        "Should close style element"
    );
}

#[test]
fn test_shape_style_refs_empty() {
    let writer = DrawingWriter::new();
    let mut w = crate::write::xml_writer::XmlWriter::new();

    let style = ShapeStyle {
        line_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(0),
            color: None,
        },
        fill_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(0),
            color: None,
        },
        effect_ref: StyleRef {
            idx: StStyleMatrixColumnIndex::new(0),
            color: None,
        },
        font_ref: ooxml_types::drawings::FontReference::default(),
    };

    writer.write_shape_style(&mut w, &style);
    let xml_bytes = w.finish();
    let xml_str = String::from_utf8(xml_bytes).unwrap();

    assert!(xml_str.contains("<xdr:style>"), "Should have style element");
    assert!(
        xml_str.contains("</xdr:style>"),
        "Should close style element"
    );
    // All refs are present with idx=0 and no color (self-closing)
    assert!(
        xml_str.contains("<a:lnRef idx=\"0\"/>"),
        "Should have self-closing lnRef"
    );
    assert!(
        xml_str.contains("<a:fillRef idx=\"0\"/>"),
        "Should have self-closing fillRef"
    );
}
