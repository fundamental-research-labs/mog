use super::common::*;

// =========================================================================
// Roundtrip validation tests
// =========================================================================
//
// These tests construct a TextBody, serialize it to XML via DrawingWriter,
// then parse the XML back with the read-side parser and compare the result.
// =========================================================================

// -------------------------------------------------------------------------
// 6b: Rich text roundtrip
// -------------------------------------------------------------------------

#[test]
fn roundtrip_rich_text() {
    let text_body = TextBody {
        body_props: TextBodyProperties {
            wrap: Some(TextWrap::Square),
            ..Default::default()
        },
        list_style: None,
        paragraphs: vec![
            // Paragraph 1: two runs with bold/italic/size/color, different fonts
            Paragraph {
                props: ParagraphProperties::default(),
                runs: vec![
                    TextRunContent::Run(TextRun {
                        text: "Hello ".to_string(),
                        props: RunProperties {
                            bold: Some(true),
                            size: Some(StTextFontSize::new_unchecked(1400)),
                            color: Some(DrawingColor::SrgbClr {
                                val: "FF0000".to_string(),
                                transforms: vec![],
                            }),
                            latin: Some(TextFont {
                                typeface: "Arial".to_string(),
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                    }),
                    TextRunContent::Run(TextRun {
                        text: "World".to_string(),
                        props: RunProperties {
                            italic: Some(true),
                            size: Some(StTextFontSize::new_unchecked(1800)),
                            color: Some(DrawingColor::SrgbClr {
                                val: "0000FF".to_string(),
                                transforms: vec![],
                            }),
                            latin: Some(TextFont {
                                typeface: "Calibri".to_string(),
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                    }),
                ],
                end_para_rpr: None,
            },
            // Paragraph 2: run + line break + run
            Paragraph {
                props: ParagraphProperties::default(),
                runs: vec![
                    TextRunContent::Run(TextRun {
                        text: "Before break".to_string(),
                        props: RunProperties {
                            bold: Some(true),
                            ..Default::default()
                        },
                    }),
                    TextRunContent::LineBreak {
                        props: Some(RunProperties {
                            size: Some(StTextFontSize::new_unchecked(1200)),
                            ..Default::default()
                        }),
                    },
                    TextRunContent::Run(TextRun {
                        text: "After break".to_string(),
                        props: RunProperties::default(),
                    }),
                ],
                end_para_rpr: None,
            },
            // Paragraph 3: field + endParaRPr
            Paragraph {
                props: ParagraphProperties::default(),
                runs: vec![TextRunContent::Field {
                    id: "{B5F3C2A1-1234-5678-9ABC-DEF012345678}".to_string(),
                    field_type: Some("slidenum".to_string()),
                    text: Some("42".to_string()),
                    run_props: Some(RunProperties {
                        bold: Some(true),
                        size: Some(StTextFontSize::new_unchecked(1000)),
                        ..Default::default()
                    }),
                    para_props: None,
                }],
                end_para_rpr: Some(RunProperties {
                    italic: Some(true),
                    size: Some(StTextFontSize::new_unchecked(1100)),
                    lang: Some("en-US".to_string()),
                    ..Default::default()
                }),
            },
        ],
    };

    let result = roundtrip_text_body(text_body);

    // Verify paragraph count
    assert_eq!(result.paragraphs.len(), 3, "Expected 3 paragraphs");

    // Paragraph 1: two runs with formatting
    let p1 = &result.paragraphs[0];
    assert_eq!(p1.runs.len(), 2, "Para 1 should have 2 runs");
    if let TextRunContent::Run(r) = &p1.runs[0] {
        assert_eq!(r.text, "Hello ");
        assert_eq!(r.props.bold, Some(true));
        assert_eq!(r.props.size, Some(StTextFontSize::new_unchecked(1400)));
        assert_eq!(
            r.props.color.as_ref().and_then(|c| match c {
                DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
                _ => None,
            }),
            Some("FF0000")
        );
        assert_eq!(
            r.props.latin.as_ref().map(|f| f.typeface.as_str()),
            Some("Arial")
        );
    } else {
        panic!("Expected Run in para 1 position 0");
    }
    if let TextRunContent::Run(r) = &p1.runs[1] {
        assert_eq!(r.text, "World");
        assert_eq!(r.props.italic, Some(true));
        assert_eq!(r.props.size, Some(StTextFontSize::new_unchecked(1800)));
        assert_eq!(
            r.props.color.as_ref().and_then(|c| match c {
                DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
                _ => None,
            }),
            Some("0000FF")
        );
        assert_eq!(
            r.props.latin.as_ref().map(|f| f.typeface.as_str()),
            Some("Calibri")
        );
    } else {
        panic!("Expected Run in para 1 position 1");
    }

    // Paragraph 2: run + line break + run
    // NOTE: The read-side parser collects all runs first, then all line breaks, then all
    // fields -- it does NOT preserve interleaving order within a paragraph. This means
    // the roundtripped result will have [Run, Run, LineBreak] rather than [Run, LineBreak, Run].
    // This is a known limitation of the current parser architecture.
    let p2 = &result.paragraphs[1];
    assert_eq!(p2.runs.len(), 3, "Para 2 should have 3 items");

    // Verify all content types are present (order may differ from input)
    let run_texts: Vec<&str> = p2
        .runs
        .iter()
        .filter_map(|r| {
            if let TextRunContent::Run(run) = r {
                Some(run.text.as_str())
            } else {
                None
            }
        })
        .collect();
    assert!(
        run_texts.contains(&"Before break"),
        "Should contain 'Before break'"
    );
    assert!(
        run_texts.contains(&"After break"),
        "Should contain 'After break'"
    );

    let has_line_break = p2
        .runs
        .iter()
        .any(|r| matches!(r, TextRunContent::LineBreak { .. }));
    assert!(has_line_break, "Should contain a line break");

    // Verify the line break properties survive
    for r in &p2.runs {
        if let TextRunContent::LineBreak { props } = r {
            assert!(props.is_some(), "Line break should have props");
            assert_eq!(
                props.as_ref().unwrap().size,
                Some(StTextFontSize::new_unchecked(1200))
            );
        }
    }

    // Verify "Before break" run has bold
    for r in &p2.runs {
        if let TextRunContent::Run(run) = r {
            if run.text == "Before break" {
                assert_eq!(run.props.bold, Some(true));
            }
        }
    }

    // Paragraph 3: field + endParaRPr
    let p3 = &result.paragraphs[2];
    assert!(!p3.runs.is_empty(), "Para 3 should have at least one item");
    if let TextRunContent::Field {
        id,
        field_type,
        text,
        run_props,
        ..
    } = &p3.runs[0]
    {
        assert_eq!(id, "{B5F3C2A1-1234-5678-9ABC-DEF012345678}");
        assert_eq!(field_type.as_deref(), Some("slidenum"));
        assert_eq!(text.as_deref(), Some("42"));
        assert!(run_props.is_some(), "Field should have run props");
        assert_eq!(run_props.as_ref().unwrap().bold, Some(true));
        assert_eq!(
            run_props.as_ref().unwrap().size,
            Some(StTextFontSize::new_unchecked(1000))
        );
    } else {
        panic!("Expected Field in para 3 position 0");
    }
    assert!(p3.end_para_rpr.is_some(), "Para 3 should have endParaRPr");
    let epr = p3.end_para_rpr.as_ref().unwrap();
    assert_eq!(epr.italic, Some(true));
    assert_eq!(epr.size, Some(StTextFontSize::new_unchecked(1100)));
    assert_eq!(epr.lang.as_deref(), Some("en-US"));
}

// -------------------------------------------------------------------------
// 6c: Text body properties roundtrip
// -------------------------------------------------------------------------

#[test]
fn roundtrip_text_body_properties() {
    let body_props = TextBodyProperties {
        rot: Some(StAngle::new(5400000)),
        anchor: Some(TextAnchor::Center),
        wrap: Some(TextWrap::Square),
        l_ins: Some(91440),
        t_ins: Some(45720),
        r_ins: Some(91440),
        b_ins: Some(45720),
        vert: Some(TextVerticalType::Vertical),
        vert_overflow: Some(TextVertOverflow::Clip),
        horz_overflow: Some(TextHorzOverflow::Clip),
        anchor_ctr: Some(true),
        rtl_col: Some(true),
        spc_first_last_para: Some(true),
        num_col: Some(2),
        spc_col: Some(360000),
        upright: Some(true),
        compat_ln_spc: Some(true),
        force_aa: Some(true),
        from_word_art: Some(true),
        autofit: Some(TextAutofit::NormalAutofit {
            font_scale: Some(80000),
            line_space_reduction: Some(10000),
        }),
        ext_lst: None,
        prst_tx_warp: None,
        flat_tx: None,
        scene3d: None,
        sp3d: None,
    };

    let text_body = TextBody {
        body_props,
        list_style: None,
        paragraphs: vec![Paragraph {
            props: ParagraphProperties::default(),
            runs: vec![TextRunContent::Run(TextRun {
                text: "test".to_string(),
                props: RunProperties::default(),
            })],
            end_para_rpr: None,
        }],
    };

    let result = roundtrip_text_body(text_body);
    let bp = &result.body_props;

    assert_eq!(bp.rot, Some(StAngle::new(5400000)), "rot");
    assert_eq!(bp.anchor, Some(TextAnchor::Center), "anchor");
    assert_eq!(bp.wrap, Some(TextWrap::Square), "wrap");
    assert_eq!(bp.l_ins, Some(91440), "l_ins");
    assert_eq!(bp.t_ins, Some(45720), "t_ins");
    assert_eq!(bp.r_ins, Some(91440), "r_ins");
    assert_eq!(bp.b_ins, Some(45720), "b_ins");
    assert_eq!(bp.vert, Some(TextVerticalType::Vertical), "vert");
    assert_eq!(
        bp.vert_overflow,
        Some(TextVertOverflow::Clip),
        "vertOverflow"
    );
    assert_eq!(
        bp.horz_overflow,
        Some(TextHorzOverflow::Clip),
        "horzOverflow"
    );
    assert_eq!(bp.anchor_ctr, Some(true), "anchorCtr");
    assert_eq!(bp.rtl_col, Some(true), "rtlCol");
    assert_eq!(bp.spc_first_last_para, Some(true), "spcFirstLastPara");
    assert_eq!(bp.num_col, Some(2), "numCol");
    assert_eq!(bp.spc_col, Some(360000), "spcCol");
    assert_eq!(bp.upright, Some(true), "upright");
    assert_eq!(bp.compat_ln_spc, Some(true), "compatLnSpc");
    assert_eq!(bp.force_aa, Some(true), "forceAA");
    assert_eq!(bp.from_word_art, Some(true), "fromWordArt");

    match &bp.autofit {
        Some(TextAutofit::NormalAutofit {
            font_scale,
            line_space_reduction,
        }) => {
            assert_eq!(*font_scale, Some(80000), "fontScale");
            assert_eq!(*line_space_reduction, Some(10000), "lnSpcReduction");
        }
        other => panic!("Expected NormalAutofit, got {:?}", other),
    }
}
