use super::common::*;

#[test]
fn test_underline_line_and_fill_variants() {
    use ooxml_types::drawings::{
        DrawingColor, Outline, Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun,
        TextRunContent, UnderlineFill, UnderlineLine,
    };

    // FollowText variants
    {
        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "ULFollow".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "follow".to_string(),
                            props: RunProperties {
                                underline_line: Some(UnderlineLine::FollowText),
                                underline_fill: Some(UnderlineFill::FollowText),
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
        let xml_str = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml_str.contains("<a:uLnTx/>"), "underline line follow text");
        assert!(
            xml_str.contains("<a:uFillTx/>"),
            "underline fill follow text"
        );
    }

    // Custom underline line
    {
        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "ULCustom".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "custom".to_string(),
                            props: RunProperties {
                                underline_line: Some(UnderlineLine::Custom(Outline {
                                    width: Some(12700),
                                    fill: Some(LineFill::Solid(SolidFill {
                                        color: DrawingColor::SrgbClr {
                                            val: "00FF00".to_string(),
                                            transforms: vec![],
                                        },
                                    })),
                                    dash: None,
                                    cap: None,
                                    compound: None,
                                    head_end: None,
                                    tail_end: None,
                                    join: None,
                                    align: None,
                                })),
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
        let xml_str = String::from_utf8(writer.to_xml()).unwrap();
        assert!(
            xml_str.contains("<a:uLn w=\"12700\">"),
            "custom underline line"
        );
        assert!(
            xml_str.contains("<a:srgbClr val=\"00FF00\"/>"),
            "underline color"
        );
        assert!(xml_str.contains("</a:uLn>"), "underline line end");
    }
}

#[test]
fn test_run_props_rtl_as_child_element() {
    use ooxml_types::drawings::{
        Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun, TextRunContent,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "RTL".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties::default(),
                paragraphs: vec![Paragraph {
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "rtl text".to_string(),
                        props: RunProperties {
                            rtl: Some(true),
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

    // RTL is emitted as a child element, not an attribute
    assert!(
        xml_str.contains("<a:rtl val=\"1\"/>"),
        "rtl as child element"
    );
    assert!(
        xml_str.contains("</a:rPr>"),
        "rPr should have closing tag for children"
    );
}

#[test]
fn test_extension_list_in_body_props() {
    use ooxml_types::drawings::{
        ExtensionList, Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun,
        TextRunContent,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "ExtLst".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties {
                    ext_lst: Some(ExtensionList {
                        raw_xml: Some(
                            "<a:ext uri=\"{test-guid}\"><custom:data/></a:ext>".to_string(),
                        ),
                    }),
                    ..Default::default()
                },
                paragraphs: vec![Paragraph {
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "ext".to_string(),
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

    assert!(xml_str.contains("<a:extLst>"), "ext list start");
    assert!(
        xml_str.contains("<a:ext uri=\"{test-guid}\"><custom:data/></a:ext>"),
        "raw ext content"
    );
    assert!(xml_str.contains("</a:extLst>"), "ext list end");
    assert!(
        xml_str.contains("</a:bodyPr>"),
        "bodyPr should have closing tag"
    );
}

#[test]
fn test_bullet_color_follow_text_and_size_follow_text() {
    use ooxml_types::drawings::{
        BulletColor, BulletProperties, BulletSize, BulletType, Paragraph, ParagraphProperties,
        RunProperties, TextBody, TextBodyProperties, TextRun, TextRunContent,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "BuFollow".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties::default(),
                paragraphs: vec![Paragraph {
                    props: ParagraphProperties {
                        bullet: Some(BulletProperties {
                            color: Some(BulletColor::FollowText),
                            size: Some(BulletSize::FollowText),
                            font: None,
                            bullet_type: Some(BulletType::Char("-".to_string())),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "dash".to_string(),
                        props: RunProperties::default(),
                    })],
                    end_para_rpr: None,
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

    assert!(xml_str.contains("<a:buClrTx/>"), "bullet color follow text");
    assert!(xml_str.contains("<a:buSzTx/>"), "bullet size follow text");
    assert!(
        xml_str.contains("<a:buChar char=\"-\"/>"),
        "dash bullet char"
    );
}

#[test]
fn test_paragraph_default_run_props() {
    use ooxml_types::drawings::{
        Paragraph, ParagraphProperties, RunProperties, TextBody, TextBodyProperties, TextRun,
        TextRunContent,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "DefRPr".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties::default(),
                paragraphs: vec![Paragraph {
                    props: ParagraphProperties {
                        def_run_props: Some(Box::new(RunProperties {
                            size: Some(StTextFontSize::new_unchecked(1400)),
                            bold: Some(true),
                            lang: Some("en-US".to_string()),
                            ..Default::default()
                        })),
                        ..Default::default()
                    },
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "inherited".to_string(),
                        props: RunProperties::default(),
                    })],
                    end_para_rpr: None,
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

    assert!(
        xml_str.contains("<a:defRPr lang=\"en-US\" sz=\"1400\" b=\"1\"/>"),
        "default run props in paragraph, got: {}",
        xml_str
    );
}
