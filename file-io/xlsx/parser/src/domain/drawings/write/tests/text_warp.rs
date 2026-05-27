use super::common::*;

// -------------------------------------------------------------------------
// Preset text warp (WordArt) tests
// -------------------------------------------------------------------------

#[test]
fn test_text_box_with_warp_preset_and_one_guide() {
    use ooxml_types::drawings::{
        GeomGuide, Paragraph, PresetTextWarp, RunProperties, TextBody, TextBodyProperties, TextRun,
        TextRunContent, TextWarpPreset, TextWrap,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "WordArt 1".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties {
                    wrap: Some(TextWrap::None),
                    prst_tx_warp: Some(PresetTextWarp {
                        preset: TextWarpPreset::TextWave1,
                        adjust_values: vec![GeomGuide {
                            name: "adj".to_string(),
                            fmla: "val 12500".to_string(),
                        }],
                    }),
                    ..Default::default()
                },
                paragraphs: vec![Paragraph {
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "Curved text".to_string(),
                        props: RunProperties {
                            lang: Some("en-US".to_string()),
                            ..Default::default()
                        },
                    })],
                    ..Default::default()
                }],
                ..Default::default()
            }),
            fill: None,
            outline: None,
            style: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<a:prstTxWarp prst=\"textWave1\">"));
    assert!(xml_str.contains("<a:avLst>"));
    assert!(xml_str.contains("<a:gd name=\"adj\" fmla=\"val 12500\"/>"));
    assert!(xml_str.contains("</a:avLst>"));
    assert!(xml_str.contains("</a:prstTxWarp>"));
    assert!(xml_str.contains("</a:bodyPr>"));
}

#[test]
fn test_text_box_with_warp_preset_no_guides() {
    use ooxml_types::drawings::{
        Paragraph, PresetTextWarp, RunProperties, TextBody, TextBodyProperties, TextRun,
        TextRunContent, TextWarpPreset, TextWrap,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "WordArt 2".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties {
                    wrap: Some(TextWrap::Square),
                    prst_tx_warp: Some(PresetTextWarp {
                        preset: TextWarpPreset::TextArchUp,
                        adjust_values: vec![],
                    }),
                    ..Default::default()
                },
                paragraphs: vec![Paragraph {
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "Plain warp".to_string(),
                        props: RunProperties {
                            lang: Some("en-US".to_string()),
                            ..Default::default()
                        },
                    })],
                    ..Default::default()
                }],
                ..Default::default()
            }),
            fill: None,
            outline: None,
            style: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Self-closing prstTxWarp when no adjust values
    assert!(xml_str.contains("<a:prstTxWarp prst=\"textArchUp\"/>"));
    // bodyPr should still have a closing tag (contains prstTxWarp child)
    assert!(xml_str.contains("</a:bodyPr>"));
    // Should NOT contain avLst
    assert!(!xml_str.contains("<a:avLst>"));
}

#[test]
fn test_text_box_with_warp_preset_two_guides() {
    use ooxml_types::drawings::{
        GeomGuide, Paragraph, PresetTextWarp, RunProperties, TextBody, TextBodyProperties, TextRun,
        TextRunContent, TextWarpPreset, TextWrap,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "WordArt 3".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties {
                    wrap: Some(TextWrap::None),
                    prst_tx_warp: Some(PresetTextWarp {
                        preset: TextWarpPreset::TextDoubleWave1,
                        adjust_values: vec![
                            GeomGuide {
                                name: "adj1".to_string(),
                                fmla: "val 6500".to_string(),
                            },
                            GeomGuide {
                                name: "adj2".to_string(),
                                fmla: "val 0".to_string(),
                            },
                        ],
                    }),
                    ..Default::default()
                },
                paragraphs: vec![Paragraph {
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "Double adj".to_string(),
                        props: RunProperties {
                            lang: Some("en-US".to_string()),
                            ..Default::default()
                        },
                    })],
                    ..Default::default()
                }],
                ..Default::default()
            }),
            fill: None,
            outline: None,
            style: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<a:prstTxWarp prst=\"textDoubleWave1\">"));
    assert!(xml_str.contains("<a:gd name=\"adj1\" fmla=\"val 6500\"/>"));
    assert!(xml_str.contains("<a:gd name=\"adj2\" fmla=\"val 0\"/>"));
}

#[test]
fn test_text_box_without_warp_backward_compat() {
    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox::from_plain("Plain", "No warp"),
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // bodyPr should self-close (no prstTxWarp child)
    assert!(xml_str.contains("<a:bodyPr wrap=\"square\"/>"));
    // Should NOT contain prstTxWarp
    assert!(!xml_str.contains("prstTxWarp"));
}

#[test]
fn test_outline_without_dash() {
    let mut writer = DrawingWriter::new();
    writer.add_shape(
        CellAnchor::default(),
        CellAnchor::default(),
        ShapeProps {
            original_id: None,
            name: "Test".to_string(),
            preset: ShapePreset::Rect,
            fill: None,
            outline: Some(Outline {
                width: Some(25400),
                fill: Some(line_solid("FF0000")),
                ..Default::default()
            }),
            text: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<a:ln w=\"25400\">"));
    assert!(xml_str.contains("val=\"FF0000\""));
    // Should not contain prstDash element
    assert!(!xml_str.contains("<a:prstDash"));
}
