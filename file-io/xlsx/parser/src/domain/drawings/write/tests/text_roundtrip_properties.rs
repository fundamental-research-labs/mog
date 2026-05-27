use super::common::*;

// -------------------------------------------------------------------------
// 6d: Paragraph properties roundtrip
// -------------------------------------------------------------------------

#[test]
fn roundtrip_paragraph_properties() {
    let para_props = ParagraphProperties {
        align: Some(TextAlign::Center),
        margin_l: Some(457200),
        margin_r: Some(228600),
        indent: Some(-228600),
        line_spacing: Some(TextSpacing::Percent(150000)),
        space_before: Some(TextSpacing::Points(600)),
        space_after: Some(TextSpacing::Points(400)),
        bullet: Some(BulletProperties {
            color: Some(BulletColor::Custom(DrawingColor::SrgbClr {
                val: "00FF00".to_string(),
                transforms: vec![],
            })),
            size: Some(BulletSize::Percent(120000)),
            font: Some(TextFont {
                typeface: "Wingdings".to_string(),
                ..Default::default()
            }),
            bullet_type: Some(BulletType::Char("*".to_string())),
            ..Default::default()
        }),
        def_run_props: Some(Box::new(RunProperties {
            bold: Some(true),
            size: Some(StTextFontSize::new_unchecked(1400)),
            lang: Some("en-US".to_string()),
            ..Default::default()
        })),
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
        level: Some(StTextIndentLevelType::new_unchecked(2)),
        rtl: Some(true),
        def_tab_sz: Some(914400),
        ea_ln_brk: Some(true),
        latin_ln_brk: Some(false),
        hanging_punct: Some(true),
        font_align: Some(TextFontAlignType::Center),
        ext_lst: None,
    };

    let text_body = TextBody {
        body_props: TextBodyProperties::default(),
        list_style: None,
        paragraphs: vec![Paragraph {
            props: para_props,
            runs: vec![TextRunContent::Run(TextRun {
                text: "test paragraph".to_string(),
                props: RunProperties::default(),
            })],
            end_para_rpr: None,
        }],
    };

    let result = roundtrip_text_body(text_body);
    let pp = &result.paragraphs[0].props;

    assert_eq!(pp.align, Some(TextAlign::Center), "align");
    assert_eq!(pp.margin_l, Some(457200), "marL");
    assert_eq!(pp.margin_r, Some(228600), "marR");
    assert_eq!(pp.indent, Some(-228600), "indent");
    assert_eq!(pp.line_spacing, Some(TextSpacing::Percent(150000)), "lnSpc");
    assert_eq!(pp.space_before, Some(TextSpacing::Points(600)), "spcBef");
    assert_eq!(pp.space_after, Some(TextSpacing::Points(400)), "spcAft");
    assert_eq!(
        pp.level,
        Some(StTextIndentLevelType::new_unchecked(2)),
        "lvl"
    );
    assert_eq!(pp.rtl, Some(true), "rtl");
    assert_eq!(pp.def_tab_sz, Some(914400), "defTabSz");
    assert_eq!(pp.ea_ln_brk, Some(true), "eaLnBrk");
    assert_eq!(pp.latin_ln_brk, Some(false), "latinLnBrk");
    assert_eq!(pp.hanging_punct, Some(true), "hangingPunct");
    assert_eq!(pp.font_align, Some(TextFontAlignType::Center), "fontAlgn");

    // Bullet properties
    let bullet = pp.bullet.as_ref().expect("bullet should be present");
    if let Some(BulletColor::Custom(c)) = &bullet.color {
        match c {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "00FF00", "bullet color"),
            other => panic!("Expected SrgbClr, got {other:?}"),
        }
    } else {
        panic!("Expected custom bullet color");
    }
    assert_eq!(
        bullet.size,
        Some(BulletSize::Percent(120000)),
        "bullet size"
    );
    assert_eq!(
        bullet.font.as_ref().map(|f| f.typeface.as_str()),
        Some("Wingdings"),
        "bullet font"
    );
    match &bullet.bullet_type {
        Some(BulletType::Char(c)) => assert_eq!(c, "*", "bullet char"),
        other => panic!("Expected Char bullet, got {:?}", other),
    }

    // Tab stops
    let tabs = pp.tab_list.as_ref().expect("tabs should be present");
    assert_eq!(tabs.len(), 3, "tab count");
    assert_eq!(tabs[0].position, Some(914400));
    assert_eq!(tabs[0].align, Some(TextTabAlignType::Left));
    assert_eq!(tabs[1].position, Some(1828800));
    assert_eq!(tabs[1].align, Some(TextTabAlignType::Center));
    assert_eq!(tabs[2].position, Some(2743200));
    assert_eq!(tabs[2].align, Some(TextTabAlignType::Right));

    // Default run props
    let drp = pp.def_run_props.as_ref().expect("defRPr should be present");
    assert_eq!(drp.bold, Some(true), "defRPr bold");
    assert_eq!(
        drp.size,
        Some(StTextFontSize::new_unchecked(1400)),
        "defRPr size"
    );
    assert_eq!(drp.lang.as_deref(), Some("en-US"), "defRPr lang");
}

// -------------------------------------------------------------------------
// 6e: Run properties roundtrip
// -------------------------------------------------------------------------

#[test]
fn roundtrip_run_properties() {
    let run_props = RunProperties {
        size: Some(StTextFontSize::new_unchecked(2400)),
        bold: Some(true),
        italic: Some(true),
        underline: Some(TextUnderlineType::Double),
        strike: Some(TextStrikeType::SingleStrike),
        latin: Some(TextFont {
            typeface: "Times New Roman".to_string(),
            panose: Some("02020603050405020304".to_string()),
            pitch_family: Some(StPitchFamily::new(18)),
            charset: Some(0),
        }),
        ea: Some(TextFont {
            typeface: "MS Gothic".to_string(),
            ..Default::default()
        }),
        cs: Some(TextFont {
            typeface: "Arial".to_string(),
            ..Default::default()
        }),
        sym: Some(TextFont {
            typeface: "Symbol".to_string(),
            ..Default::default()
        }),
        color: Some(DrawingColor::SrgbClr {
            val: "336699".to_string(),
            transforms: vec![],
        }),
        lang: Some("en-US".to_string()),
        alt_lang: Some("ja-JP".to_string()),
        kern: Some(StTextNonNegativePoint::new_unchecked(1200)),
        cap: Some(TextCapsType::Small),
        spacing: Some(StTextPoint::new(200)),
        baseline: Some(StPercentage::new(30000)),
        highlight: None,   // Highlight roundtrip depends on writer support
        hlink_click: None, // Hyperlink roundtrip depends on r:id handling
        hlink_mouse_over: None,
        text_fill: None, // Fill roundtrip tested separately (6f)
        text_outline: None,
        underline_line: None,
        underline_fill: None,
        kumimoji: Some(true),
        normalize_h: Some(true),
        no_proof: Some(true),
        dirty: Some(true),
        err: Some(true),
        smt_clean: Some(true),
        smt_id: Some(42),
        bmk: Some("bookmark1".to_string()),
        rtl: None, // NOTE: The writer currently does not emit rtl for run properties
        effects: None,
        ext_lst: None,
    };

    let text_body = TextBody {
        body_props: TextBodyProperties::default(),
        list_style: None,
        paragraphs: vec![Paragraph {
            props: ParagraphProperties::default(),
            runs: vec![TextRunContent::Run(TextRun {
                text: "styled text".to_string(),
                props: run_props,
            })],
            end_para_rpr: None,
        }],
    };

    let result = roundtrip_text_body(text_body);
    let r = match &result.paragraphs[0].runs[0] {
        TextRunContent::Run(r) => &r.props,
        other => panic!("Expected Run, got {:?}", other),
    };

    assert_eq!(r.size, Some(StTextFontSize::new_unchecked(2400)), "size");
    assert_eq!(r.bold, Some(true), "bold");
    assert_eq!(r.italic, Some(true), "italic");
    assert_eq!(r.underline, Some(TextUnderlineType::Double), "underline");
    assert_eq!(r.strike, Some(TextStrikeType::SingleStrike), "strike");

    // Latin font with full attributes
    let latin = r.latin.as_ref().expect("latin font");
    assert_eq!(latin.typeface, "Times New Roman");
    assert_eq!(latin.panose.as_deref(), Some("02020603050405020304"));
    assert_eq!(latin.pitch_family, Some(StPitchFamily::new(18)));
    assert_eq!(latin.charset, Some(0));

    // Other font slots
    assert_eq!(
        r.ea.as_ref().map(|f| f.typeface.as_str()),
        Some("MS Gothic"),
        "ea font"
    );
    assert_eq!(
        r.cs.as_ref().map(|f| f.typeface.as_str()),
        Some("Arial"),
        "cs font"
    );
    assert_eq!(
        r.sym.as_ref().map(|f| f.typeface.as_str()),
        Some("Symbol"),
        "sym font"
    );

    // Color
    assert_eq!(
        r.color.as_ref().and_then(|c| match c {
            DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
            _ => None,
        }),
        Some("336699"),
        "color"
    );

    // Language
    assert_eq!(r.lang.as_deref(), Some("en-US"), "lang");
    assert_eq!(r.alt_lang.as_deref(), Some("ja-JP"), "altLang");

    // Text properties
    assert_eq!(
        r.kern,
        Some(StTextNonNegativePoint::new_unchecked(1200)),
        "kern"
    );
    assert_eq!(r.cap, Some(TextCapsType::Small), "cap");
    assert_eq!(r.spacing, Some(StTextPoint::new(200)), "spacing");
    assert_eq!(r.baseline, Some(StPercentage::new(30000)), "baseline");

    // Boolean flags
    assert_eq!(r.kumimoji, Some(true), "kumimoji");
    assert_eq!(r.normalize_h, Some(true), "normalizeH");
    assert_eq!(r.no_proof, Some(true), "noProof");
    assert_eq!(r.dirty, Some(true), "dirty");
    assert_eq!(r.err, Some(true), "err");
    assert_eq!(r.smt_clean, Some(true), "smtClean");
    assert_eq!(r.smt_id, Some(42), "smtId");
    assert_eq!(r.bmk.as_deref(), Some("bookmark1"), "bmk");
}

// -------------------------------------------------------------------------
// 6g: List style roundtrip
// -------------------------------------------------------------------------

#[test]
fn roundtrip_list_style() {
    let list_style = TextListStyle {
        def_ppr: Some(ParagraphProperties {
            align: Some(TextAlign::Left),
            def_run_props: Some(Box::new(RunProperties {
                size: Some(StTextFontSize::new_unchecked(1200)),
                ..Default::default()
            })),
            ..Default::default()
        }),
        level_ppr: {
            let mut levels: [Option<ParagraphProperties>; 9] = Default::default();
            levels[0] = Some(ParagraphProperties {
                align: Some(TextAlign::Left),
                margin_l: Some(228600),
                indent: Some(-228600),
                bullet: Some(BulletProperties {
                    bullet_type: Some(BulletType::Char("-".to_string())),
                    ..Default::default()
                }),
                ..Default::default()
            });
            levels[1] = Some(ParagraphProperties {
                align: Some(TextAlign::Center),
                margin_l: Some(457200),
                indent: Some(-228600),
                ..Default::default()
            });
            levels[2] = Some(ParagraphProperties {
                align: Some(TextAlign::Right),
                margin_l: Some(685800),
                ..Default::default()
            });
            levels
        },
    };

    let text_body = TextBody {
        body_props: TextBodyProperties::default(),
        list_style: Some(list_style),
        paragraphs: vec![Paragraph {
            props: ParagraphProperties::default(),
            runs: vec![TextRunContent::Run(TextRun {
                text: "list item".to_string(),
                props: RunProperties::default(),
            })],
            end_para_rpr: None,
        }],
    };

    let result = roundtrip_text_body(text_body);
    let ls = result
        .list_style
        .as_ref()
        .expect("list_style should survive roundtrip");

    // Check defPPr
    let def = ls.def_ppr.as_ref().expect("defPPr should be present");
    assert_eq!(def.align, Some(TextAlign::Left), "defPPr align");
    assert!(def.def_run_props.is_some(), "defPPr should have defRPr");
    assert_eq!(
        def.def_run_props.as_ref().unwrap().size,
        Some(StTextFontSize::new_unchecked(1200)),
        "defPPr defRPr size"
    );

    // Check level 1
    let lvl1 = ls.level_ppr[0].as_ref().expect("lvl1pPr should be present");
    assert_eq!(lvl1.align, Some(TextAlign::Left), "lvl1 align");
    assert_eq!(lvl1.margin_l, Some(228600), "lvl1 marL");
    assert_eq!(lvl1.indent, Some(-228600), "lvl1 indent");
    let b = lvl1.bullet.as_ref().expect("lvl1 bullet");
    match &b.bullet_type {
        Some(BulletType::Char(c)) => assert_eq!(c, "-"),
        other => panic!("Expected Char bullet, got {:?}", other),
    }

    // Check level 2
    let lvl2 = ls.level_ppr[1].as_ref().expect("lvl2pPr should be present");
    assert_eq!(lvl2.align, Some(TextAlign::Center), "lvl2 align");
    assert_eq!(lvl2.margin_l, Some(457200), "lvl2 marL");

    // Check level 3
    let lvl3 = ls.level_ppr[2].as_ref().expect("lvl3pPr should be present");
    assert_eq!(lvl3.align, Some(TextAlign::Right), "lvl3 align");
    assert_eq!(lvl3.margin_l, Some(685800), "lvl3 marL");

    // Levels 4-9 should be None
    for i in 3..9 {
        assert!(ls.level_ppr[i].is_none(), "level {} should be None", i + 1);
    }
}
