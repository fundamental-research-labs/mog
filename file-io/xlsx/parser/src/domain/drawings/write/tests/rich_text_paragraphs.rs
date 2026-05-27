use super::common::*;

#[test]
fn test_paragraph_props_spacing_and_bullets() {
    use ooxml_types::drawings::{
        BulletColor, BulletProperties, BulletSize, BulletType, DrawingColor, Paragraph,
        ParagraphProperties, RunProperties, TextAlign, TextBody, TextBodyProperties, TextFont,
        TextFontAlignType, TextRun, TextRunContent, TextSpacing,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "ParaProps".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties::default(),
                paragraphs: vec![Paragraph {
                    props: ParagraphProperties {
                        align: Some(TextAlign::Right),
                        margin_l: Some(457200),
                        margin_r: Some(228600),
                        indent: Some(-228600),
                        level: Some(StTextIndentLevelType::new_unchecked(1)),
                        def_tab_sz: Some(914400),
                        rtl: Some(true),
                        ea_ln_brk: Some(true),
                        font_align: Some(TextFontAlignType::Center),
                        latin_ln_brk: Some(false),
                        hanging_punct: Some(true),
                        line_spacing: Some(TextSpacing::Percent(150000)),
                        space_before: Some(TextSpacing::Points(600)),
                        space_after: Some(TextSpacing::Points(300)),
                        bullet: Some(BulletProperties {
                            color: Some(BulletColor::Custom(DrawingColor::SrgbClr {
                                val: "0000FF".to_string(),
                                transforms: vec![],
                            })),
                            size: Some(BulletSize::Percent(120000)),
                            font: Some(TextFont {
                                typeface: "Wingdings".to_string(),
                                panose: None,
                                pitch_family: None,
                                charset: None,
                            }),
                            bullet_type: Some(BulletType::Char("\u{2022}".to_string())),
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "bullet item".to_string(),
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

    // Paragraph attrs
    assert!(xml_str.contains("algn=\"r\""), "right align");
    assert!(xml_str.contains("marL=\"457200\""), "margin left");
    assert!(xml_str.contains("marR=\"228600\""), "margin right");
    assert!(xml_str.contains("indent=\"-228600\""), "indent");
    assert!(xml_str.contains("lvl=\"1\""), "level");
    assert!(xml_str.contains("defTabSz=\"914400\""), "def tab size");
    assert!(xml_str.contains("rtl=\"1\""), "rtl");
    assert!(xml_str.contains("eaLnBrk=\"1\""), "ea line break");
    assert!(xml_str.contains("fontAlgn=\"ctr\""), "font align");
    assert!(xml_str.contains("latinLnBrk=\"0\""), "latin line break");
    assert!(xml_str.contains("hangingPunct=\"1\""), "hanging punct");

    // Line spacing as percent
    assert!(xml_str.contains("<a:lnSpc>"), "line spacing wrapper");
    assert!(
        xml_str.contains("<a:spcPct val=\"150000\"/>"),
        "line spacing percent"
    );

    // Space before as points
    assert!(xml_str.contains("<a:spcBef>"), "space before wrapper");
    assert!(
        xml_str.contains("<a:spcPts val=\"600\"/>"),
        "space before points"
    );

    // Space after
    assert!(xml_str.contains("<a:spcAft>"), "space after wrapper");

    // Bullet color
    assert!(xml_str.contains("<a:buClr>"), "bullet color wrapper");
    assert!(
        xml_str.contains("<a:srgbClr val=\"0000FF\"/>"),
        "bullet custom color"
    );

    // Bullet size
    assert!(
        xml_str.contains("<a:buSzPct val=\"120000\"/>"),
        "bullet size percent"
    );

    // Bullet font
    assert!(
        xml_str.contains("<a:buFont typeface=\"Wingdings\"/>"),
        "bullet font"
    );

    // Bullet char
    assert!(xml_str.contains("a:buChar char="), "bullet char");
}

#[test]
fn test_paragraph_props_tab_stops() {
    use ooxml_types::drawings::{
        Paragraph, ParagraphProperties, RunProperties, TextBody, TextBodyProperties, TextRun,
        TextRunContent, TextTabAlignType, TextTabStop,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "Tabs".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties::default(),
                paragraphs: vec![Paragraph {
                    props: ParagraphProperties {
                        tab_list: Some(vec![
                            TextTabStop {
                                position: Some(914400),
                                align: Some(TextTabAlignType::Left),
                            },
                            TextTabStop {
                                position: Some(1828800),
                                align: Some(TextTabAlignType::Center),
                            },
                            TextTabStop {
                                position: Some(2743200),
                                align: Some(TextTabAlignType::Right),
                            },
                        ]),
                        ..Default::default()
                    },
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "tabbed".to_string(),
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

    assert!(xml_str.contains("<a:tabLst>"), "tab list start");
    assert!(
        xml_str.contains("<a:tab pos=\"914400\" algn=\"l\"/>"),
        "left tab"
    );
    assert!(
        xml_str.contains("<a:tab pos=\"1828800\" algn=\"ctr\"/>"),
        "center tab"
    );
    assert!(
        xml_str.contains("<a:tab pos=\"2743200\" algn=\"r\"/>"),
        "right tab"
    );
    assert!(xml_str.contains("</a:tabLst>"), "tab list end");
}

#[test]
fn test_end_para_rpr_preserved() {
    use ooxml_types::drawings::{
        Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun, TextRunContent,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "EndRPr".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties::default(),
                paragraphs: vec![Paragraph {
                    props: Default::default(),
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "text".to_string(),
                        props: RunProperties::default(),
                    })],
                    end_para_rpr: Some(RunProperties {
                        lang: Some("en-US".to_string()),
                        size: Some(StTextFontSize::new_unchecked(1800)),
                        dirty: Some(false),
                        ..Default::default()
                    }),
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
        xml_str.contains("<a:endParaRPr lang=\"en-US\" sz=\"1800\" dirty=\"0\"/>"),
        "should have endParaRPr with attrs, got: {}",
        xml_str
    );
}

#[test]
fn test_list_style_with_level_overrides() {
    use ooxml_types::drawings::{
        BulletProperties, BulletType, Paragraph, ParagraphProperties, RunProperties, TextAlign,
        TextBody, TextBodyProperties, TextListStyle, TextRun, TextRunContent, TextSpacing,
    };

    let mut level_ppr: [Option<ParagraphProperties>; 9] = Default::default();
    level_ppr[0] = Some(ParagraphProperties {
        align: Some(TextAlign::Left),
        margin_l: Some(0),
        indent: Some(0),
        bullet: Some(BulletProperties {
            color: None,
            size: None,
            font: None,
            bullet_type: Some(BulletType::Char("\u{2022}".to_string())),
            ..Default::default()
        }),
        ..Default::default()
    });
    level_ppr[1] = Some(ParagraphProperties {
        align: Some(TextAlign::Left),
        margin_l: Some(457200),
        indent: Some(-228600),
        space_before: Some(TextSpacing::Points(400)),
        ..Default::default()
    });

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "ListStyle".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties::default(),
                list_style: Some(TextListStyle {
                    def_ppr: Some(ParagraphProperties {
                        def_run_props: Some(Box::new(RunProperties {
                            size: Some(StTextFontSize::new_unchecked(1400)),
                            ..Default::default()
                        })),
                        ..Default::default()
                    }),
                    level_ppr,
                }),
                paragraphs: vec![Paragraph {
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "list".to_string(),
                        props: RunProperties::default(),
                    })],
                    ..Default::default()
                }],
            }),
            fill: None,
            outline: None,
            style: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<a:lstStyle>"), "list style start");
    assert!(xml_str.contains("<a:defPPr>"), "default ppr");
    assert!(
        xml_str.contains("<a:defRPr sz=\"1400\"/>"),
        "default run props in defPPr"
    );
    assert!(xml_str.contains("</a:defPPr>"), "default ppr end");

    assert!(xml_str.contains("<a:lvl1pPr"), "level 1 ppr");
    assert!(xml_str.contains("a:buChar char="), "level 1 bullet char");
    assert!(xml_str.contains("</a:lvl1pPr>"), "level 1 ppr end");

    assert!(xml_str.contains("<a:lvl2pPr"), "level 2 ppr");
    assert!(xml_str.contains("marL=\"457200\""), "level 2 margin");
    assert!(xml_str.contains("indent=\"-228600\""), "level 2 indent");

    // Should not have levels 3-9
    assert!(!xml_str.contains("<a:lvl3pPr"), "no level 3");
    assert!(!xml_str.contains("<a:lvl9pPr"), "no level 9");

    assert!(xml_str.contains("</a:lstStyle>"), "list style end");
}

#[test]
fn test_text_box_from_plain_backward_compat() {
    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox::from_plain("Simple", "hello world"),
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Should produce well-formed output
    assert!(xml_str.contains("name=\"Simple\""), "name");
    assert!(xml_str.contains("txBox=\"1\""), "txBox flag");
    assert!(xml_str.contains("wrap=\"square\""), "wrap square");
    assert!(xml_str.contains("<a:t>hello world</a:t>"), "text content");
    assert!(xml_str.contains("lang=\"en-US\""), "run props lang");
    assert!(xml_str.contains("<a:lstStyle/>"), "empty list style");
    assert!(xml_str.contains("<a:p>"), "paragraph start");
    assert!(xml_str.contains("<a:r>"), "run start");
}

#[test]
fn test_text_box_absent_body() {
    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "Empty".to_string(),
            text_body: None,
            fill: None,
            outline: None,
            style: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        !xml_str.contains("xdr:txBody"),
        "imported shapes with absent txBody must not gain one"
    );
}

#[test]
fn test_line_break_with_props() {
    use ooxml_types::drawings::{
        Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun, TextRunContent,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "BrProps".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties::default(),
                paragraphs: vec![Paragraph {
                    runs: vec![
                        TextRunContent::Run(TextRun {
                            text: "before".to_string(),
                            props: RunProperties::default(),
                        }),
                        TextRunContent::LineBreak {
                            props: Some(RunProperties {
                                lang: Some("en-US".to_string()),
                                size: Some(StTextFontSize::new_unchecked(1200)),
                                ..Default::default()
                            }),
                        },
                        TextRunContent::Run(TextRun {
                            text: "after".to_string(),
                            props: RunProperties::default(),
                        }),
                    ],
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

    // Line break with props should have opening and closing tags
    assert!(xml_str.contains("<a:br>"), "line break with content");
    assert!(
        xml_str.contains("<a:rPr lang=\"en-US\" sz=\"1200\"/>"),
        "break run props"
    );
    assert!(xml_str.contains("</a:br>"), "line break end");
    assert!(xml_str.contains("<a:t>before</a:t>"), "text before break");
    assert!(xml_str.contains("<a:t>after</a:t>"), "text after break");
}

#[test]
fn test_bullet_type_variants() {
    use ooxml_types::drawings::{
        BulletProperties, BulletSize, BulletType, Paragraph, ParagraphProperties, RunProperties,
        TextAutonumberType, TextBody, TextBodyProperties, TextRun, TextRunContent,
    };

    // BulletType::None
    {
        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "BuNone".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        props: ParagraphProperties {
                            bullet: Some(BulletProperties {
                                color: None,
                                size: None,
                                font: None,
                                bullet_type: Some(BulletType::None),
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "no bullet".to_string(),
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
        let xml_str = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml_str.contains("<a:buNone/>"), "buNone");
    }

    // BulletType::AutoNum
    {
        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "BuAutoNum".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        props: ParagraphProperties {
                            bullet: Some(BulletProperties {
                                color: None,
                                size: Some(BulletSize::Points(1000)),
                                font: None,
                                bullet_type: Some(BulletType::AutoNum {
                                    scheme: TextAutonumberType::ArabicPeriod,
                                    start_at: Some(5),
                                }),
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "numbered".to_string(),
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
        let xml_str = String::from_utf8(writer.to_xml()).unwrap();
        assert!(
            xml_str.contains("<a:buAutoNum type=\"arabicPeriod\" startAt=\"5\"/>"),
            "buAutoNum with start"
        );
        assert!(
            xml_str.contains("<a:buSzPts val=\"1000\"/>"),
            "bullet size points"
        );
    }

    // BulletType::Blip
    {
        let mut writer = DrawingWriter::new();
        writer.add_text_box(
            CellAnchor::default(),
            CellAnchor::default(),
            TextBox {
                original_id: None,
                name: "BuBlip".to_string(),
                text_body: Some(TextBody {
                    body_props: TextBodyProperties::default(),
                    paragraphs: vec![Paragraph {
                        props: ParagraphProperties {
                            bullet: Some(BulletProperties {
                                color: None,
                                size: None,
                                font: None,
                                bullet_type: Some(BulletType::Blip("rId7".to_string())),
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                        runs: vec![TextRunContent::Run(TextRun {
                            text: "image bullet".to_string(),
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
        let xml_str = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml_str.contains("<a:buBlip>"), "buBlip start");
        assert!(xml_str.contains("<a:blip r:embed=\"rId7\"/>"), "blip embed");
        assert!(xml_str.contains("</a:buBlip>"), "buBlip end");
    }
}
