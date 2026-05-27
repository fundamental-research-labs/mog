use super::common::*;

// =========================================================================
// Rich text body comprehensive tests
// =========================================================================

#[test]
fn test_rich_text_body_multiple_paragraphs_mixed_content() {
    use ooxml_types::drawings::{
        Paragraph, ParagraphProperties, RunProperties, TextAlign, TextBody, TextBodyProperties,
        TextRun, TextRunContent, TextWrap,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "RichText".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties {
                    wrap: Some(TextWrap::Square),
                    ..Default::default()
                },
                paragraphs: vec![
                    // Paragraph 1: run + line break + run
                    Paragraph {
                        props: ParagraphProperties {
                            align: Some(TextAlign::Center),
                            ..Default::default()
                        },
                        runs: vec![
                            TextRunContent::Run(TextRun {
                                text: "Hello".to_string(),
                                props: RunProperties {
                                    lang: Some("en-US".to_string()),
                                    bold: Some(true),
                                    ..Default::default()
                                },
                            }),
                            TextRunContent::LineBreak { props: None },
                            TextRunContent::Run(TextRun {
                                text: "World".to_string(),
                                props: RunProperties {
                                    lang: Some("en-US".to_string()),
                                    italic: Some(true),
                                    ..Default::default()
                                },
                            }),
                        ],
                        end_para_rpr: None,
                    },
                    // Paragraph 2: field
                    Paragraph {
                        props: ParagraphProperties::default(),
                        runs: vec![TextRunContent::Field {
                            id: "{B1C3F4A0-1234-5678-9ABC-DEF012345678}".to_string(),
                            field_type: Some("slidenum".to_string()),
                            text: Some("1".to_string()),
                            run_props: Some(RunProperties {
                                lang: Some("en-US".to_string()),
                                ..Default::default()
                            }),
                            para_props: None,
                        }],
                        end_para_rpr: None,
                    },
                ],
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

    // Paragraph 1 with alignment
    assert!(
        xml_str.contains("<a:pPr"),
        "should have paragraph properties"
    );
    assert!(xml_str.contains("algn=\"ctr\""), "should have center align");

    // Bold run
    assert!(xml_str.contains("b=\"1\""), "should have bold");
    assert!(
        xml_str.contains("<a:t>Hello</a:t>"),
        "should have Hello text"
    );

    // Line break
    assert!(xml_str.contains("<a:br/>"), "should have line break");

    // Italic run
    assert!(xml_str.contains("i=\"1\""), "should have italic");
    assert!(
        xml_str.contains("<a:t>World</a:t>"),
        "should have World text"
    );

    // Field
    assert!(
        xml_str.contains("<a:fld id=\"{B1C3F4A0-1234-5678-9ABC-DEF012345678}\" type=\"slidenum\">"),
        "should have field element"
    );
    assert!(xml_str.contains("<a:t>1</a:t>"), "should have field text");

    // Two paragraphs
    let para_count = xml_str.matches("<a:p>").count();
    assert_eq!(para_count, 2, "should have 2 paragraphs");
}

#[test]
fn test_body_props_all_attributes() {
    use ooxml_types::drawings::{
        Paragraph, RunProperties, TextAnchor, TextBody, TextBodyProperties, TextHorzOverflow,
        TextRun, TextRunContent, TextVertOverflow, TextVerticalType, TextWrap,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "BodyPropsAll".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties {
                    rot: Some(StAngle::new(5400000)),
                    spc_first_last_para: Some(true),
                    vert_overflow: Some(TextVertOverflow::Clip),
                    horz_overflow: Some(TextHorzOverflow::Overflow),
                    vert: Some(TextVerticalType::Vertical270),
                    wrap: Some(TextWrap::Square),
                    l_ins: Some(91440),
                    t_ins: Some(45720),
                    r_ins: Some(91440),
                    b_ins: Some(45720),
                    num_col: Some(2),
                    spc_col: Some(36000),
                    rtl_col: Some(false),
                    from_word_art: Some(true),
                    anchor: Some(TextAnchor::Center),
                    anchor_ctr: Some(true),
                    force_aa: Some(false),
                    upright: Some(true),
                    compat_ln_spc: Some(true),
                    ..Default::default()
                },
                paragraphs: vec![Paragraph {
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "test".to_string(),
                        props: RunProperties::default(),
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

    assert!(xml_str.contains("rot=\"5400000\""), "rotation");
    assert!(xml_str.contains("spcFirstLastPara=\"1\""), "spc first last");
    assert!(xml_str.contains("vertOverflow=\"clip\""), "vert overflow");
    assert!(
        xml_str.contains("horzOverflow=\"overflow\""),
        "horz overflow"
    );
    assert!(xml_str.contains("vert=\"vert270\""), "vertical type");
    assert!(xml_str.contains("wrap=\"square\""), "wrap");
    assert!(xml_str.contains("lIns=\"91440\""), "left inset");
    assert!(xml_str.contains("tIns=\"45720\""), "top inset");
    assert!(xml_str.contains("rIns=\"91440\""), "right inset");
    assert!(xml_str.contains("bIns=\"45720\""), "bottom inset");
    assert!(xml_str.contains("numCol=\"2\""), "num columns");
    assert!(xml_str.contains("spcCol=\"36000\""), "space between cols");
    assert!(xml_str.contains("rtlCol=\"0\""), "rtl column");
    assert!(xml_str.contains("fromWordArt=\"1\""), "from word art");
    assert!(xml_str.contains("anchor=\"ctr\""), "anchor");
    assert!(xml_str.contains("anchorCtr=\"1\""), "anchor center");
    assert!(xml_str.contains("forceAA=\"0\""), "force anti-alias");
    assert!(xml_str.contains("upright=\"1\""), "upright");
    assert!(xml_str.contains("compatLnSpc=\"1\""), "compat line spacing");
}

#[test]
fn test_autofit_variants() {
    use ooxml_types::drawings::{
        Paragraph, RunProperties, TextAutofit, TextBody, TextBodyProperties, TextRun,
        TextRunContent,
    };

    // NoAutofit
    {
        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "NoAF".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties {
                        autofit: Some(TextAutofit::NoAutofit),
                        ..Default::default()
                    },
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "x".to_string(),
                            props: RunProperties::default(),
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
        let xml_str = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml_str.contains("<a:noAutofit/>"), "should have noAutofit");
        assert!(
            xml_str.contains("</a:bodyPr>"),
            "bodyPr should have closing tag"
        );
    }

    // NormalAutofit with params
    {
        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "NormAF".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties {
                        autofit: Some(TextAutofit::NormalAutofit {
                            font_scale: Some(75000),
                            line_space_reduction: Some(20000),
                        }),
                        ..Default::default()
                    },
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "x".to_string(),
                            props: RunProperties::default(),
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
        let xml_str = String::from_utf8(writer.to_xml()).unwrap();
        assert!(
            xml_str.contains("<a:normAutofit fontScale=\"75000\" lnSpcReduction=\"20000\"/>"),
            "should have normAutofit with params, got: {}",
            xml_str
        );
    }

    // ShapeAutofit
    {
        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "ShpAF".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties {
                        autofit: Some(TextAutofit::ShapeAutofit),
                        ..Default::default()
                    },
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "x".to_string(),
                            props: RunProperties::default(),
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
        let xml_str = String::from_utf8(writer.to_xml()).unwrap();
        assert!(
            xml_str.contains("<a:spAutoFit/>"),
            "should have shape autofit"
        );
    }
}
