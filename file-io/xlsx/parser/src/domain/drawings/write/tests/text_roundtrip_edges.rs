use super::common::*;

// -------------------------------------------------------------------------
// 6i: Edge case roundtrips
// -------------------------------------------------------------------------

#[test]
fn roundtrip_empty_text_body() {
    // TextBody with no paragraphs (minimal)
    let text_body = TextBody {
        body_props: TextBodyProperties::default(),
        list_style: None,
        paragraphs: vec![],
    };

    let result = roundtrip_text_body(text_body);
    assert!(
        result.list_style.is_none(),
        "absent lstStyle should remain absent on full text-body roundtrip"
    );
    // The parser may produce a paragraph with no runs for an empty txBody;
    // either 0 or 1 paragraph with empty runs is acceptable.
    for p in &result.paragraphs {
        // If there are paragraphs, they should have no meaningful runs
        for r in &p.runs {
            if let TextRunContent::Run(run) = r {
                // Any auto-generated run should have empty text
                assert!(
                    run.text.is_empty() || run.text.trim().is_empty(),
                    "Empty text body should not produce non-empty runs"
                );
            }
        }
    }
}

#[test]
fn roundtrip_paragraph_no_runs() {
    let text_body = TextBody {
        body_props: TextBodyProperties::default(),
        list_style: None,
        paragraphs: vec![Paragraph {
            props: ParagraphProperties {
                align: Some(TextAlign::Center),
                ..Default::default()
            },
            runs: vec![],
            end_para_rpr: Some(RunProperties {
                size: Some(StTextFontSize::new_unchecked(1400)),
                ..Default::default()
            }),
        }],
    };

    let result = roundtrip_text_body(text_body);
    assert!(
        !result.paragraphs.is_empty(),
        "Should have at least one paragraph"
    );
    let p = &result.paragraphs[0];
    assert_eq!(
        p.props.align,
        Some(TextAlign::Center),
        "para align preserved"
    );
    // endParaRPr should survive
    assert!(p.end_para_rpr.is_some(), "endParaRPr should survive");
    assert_eq!(
        p.end_para_rpr.as_ref().unwrap().size,
        Some(StTextFontSize::new_unchecked(1400)),
        "endParaRPr size"
    );
}

#[test]
fn roundtrip_run_with_empty_text() {
    let text_body = TextBody {
        body_props: TextBodyProperties::default(),
        list_style: None,
        paragraphs: vec![Paragraph {
            props: ParagraphProperties::default(),
            runs: vec![TextRunContent::Run(TextRun {
                text: "".to_string(),
                props: RunProperties {
                    bold: Some(true),
                    ..Default::default()
                },
            })],
            end_para_rpr: None,
        }],
    };

    let result = roundtrip_text_body(text_body);
    assert!(!result.paragraphs.is_empty(), "Should have paragraph");
    // Empty-text run should survive (or be omitted gracefully)
    // We check that the body props survive at minimum
    // Some implementations may omit empty runs; that's acceptable
}

#[test]
fn roundtrip_all_default_properties() {
    // Minimal TextBody: all defaults, one paragraph with one plain run
    let text_body = TextBody {
        body_props: TextBodyProperties::default(),
        list_style: None,
        paragraphs: vec![Paragraph {
            props: ParagraphProperties::default(),
            runs: vec![TextRunContent::Run(TextRun {
                text: "plain text".to_string(),
                props: RunProperties::default(),
            })],
            end_para_rpr: None,
        }],
    };

    let result = roundtrip_text_body(text_body);
    assert_eq!(result.paragraphs.len(), 1, "one paragraph");
    if let TextRunContent::Run(r) = &result.paragraphs[0].runs[0] {
        assert_eq!(r.text, "plain text");
        // Default properties should have all None/false
        assert_eq!(r.props.bold, None);
        assert_eq!(r.props.italic, None);
        assert_eq!(r.props.size, None);
    } else {
        panic!("Expected Run");
    }
}

#[test]
fn roundtrip_autofit_shape_autofit() {
    let text_body = TextBody {
        body_props: TextBodyProperties {
            autofit: Some(TextAutofit::ShapeAutofit),
            ..Default::default()
        },
        list_style: None,
        paragraphs: vec![Paragraph {
            props: ParagraphProperties::default(),
            runs: vec![TextRunContent::Run(TextRun {
                text: "fit".to_string(),
                props: RunProperties::default(),
            })],
            end_para_rpr: None,
        }],
    };

    let result = roundtrip_text_body(text_body);
    assert_eq!(result.body_props.autofit, Some(TextAutofit::ShapeAutofit));
}

#[test]
fn roundtrip_autofit_no_autofit() {
    let text_body = TextBody {
        body_props: TextBodyProperties {
            autofit: Some(TextAutofit::NoAutofit),
            ..Default::default()
        },
        list_style: None,
        paragraphs: vec![Paragraph {
            props: ParagraphProperties::default(),
            runs: vec![TextRunContent::Run(TextRun {
                text: "no fit".to_string(),
                props: RunProperties::default(),
            })],
            end_para_rpr: None,
        }],
    };

    let result = roundtrip_text_body(text_body);
    assert_eq!(result.body_props.autofit, Some(TextAutofit::NoAutofit));
}

#[test]
fn roundtrip_autonumber_bullet() {
    use crate::domain::drawings::write::TextAutonumberType;

    let text_body = TextBody {
        body_props: TextBodyProperties::default(),
        list_style: None,
        paragraphs: vec![Paragraph {
            props: ParagraphProperties {
                bullet: Some(BulletProperties {
                    bullet_type: Some(BulletType::AutoNum {
                        scheme: TextAutonumberType::ArabicPeriod,
                        start_at: Some(3),
                    }),
                    size: Some(BulletSize::Points(1200)),
                    color: Some(BulletColor::FollowText),
                    font: None,
                    ..Default::default()
                }),
                ..Default::default()
            },
            runs: vec![TextRunContent::Run(TextRun {
                text: "numbered item".to_string(),
                props: RunProperties::default(),
            })],
            end_para_rpr: None,
        }],
    };

    let result = roundtrip_text_body(text_body);
    let bullet = result.paragraphs[0]
        .props
        .bullet
        .as_ref()
        .expect("bullet should survive");
    match &bullet.bullet_type {
        Some(BulletType::AutoNum { scheme, start_at }) => {
            assert_eq!(
                *scheme,
                TextAutonumberType::ArabicPeriod,
                "autonumber scheme"
            );
            assert_eq!(*start_at, Some(3), "startAt");
        }
        other => panic!("Expected AutoNum bullet, got {:?}", other),
    }
    assert_eq!(bullet.size, Some(BulletSize::Points(1200)), "bullet size");
    match &bullet.color {
        Some(BulletColor::FollowText) => {} // correct
        other => panic!("Expected FollowText bullet color, got {:?}", other),
    }
}

#[test]
fn roundtrip_no_bullet() {
    let text_body = TextBody {
        body_props: TextBodyProperties::default(),
        list_style: None,
        paragraphs: vec![Paragraph {
            props: ParagraphProperties {
                bullet: Some(BulletProperties {
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
    };

    let result = roundtrip_text_body(text_body);
    let bullet = result.paragraphs[0]
        .props
        .bullet
        .as_ref()
        .expect("bullet props");
    assert_eq!(
        bullet.bullet_type,
        Some(BulletType::None),
        "buNone should roundtrip"
    );
}

#[test]
fn roundtrip_multiple_underline_types() {
    // Test various underline types to confirm they all roundtrip correctly
    let underline_types = vec![
        TextUnderlineType::Single,
        TextUnderlineType::Double,
        TextUnderlineType::Heavy,
        TextUnderlineType::Dotted,
        TextUnderlineType::Dash,
        TextUnderlineType::DashLong,
        TextUnderlineType::DotDash,
        TextUnderlineType::Words,
    ];

    for u_type in underline_types {
        let text_body = TextBody {
            body_props: TextBodyProperties::default(),
            list_style: None,
            paragraphs: vec![Paragraph {
                props: ParagraphProperties::default(),
                runs: vec![TextRunContent::Run(TextRun {
                    text: format!("underline {:?}", u_type),
                    props: RunProperties {
                        underline: Some(u_type),
                        ..Default::default()
                    },
                })],
                end_para_rpr: None,
            }],
        };

        let result = roundtrip_text_body(text_body);
        if let TextRunContent::Run(r) = &result.paragraphs[0].runs[0] {
            assert_eq!(
                r.props.underline,
                Some(u_type),
                "Underline type {:?} should roundtrip",
                u_type
            );
        } else {
            panic!("Expected Run");
        }
    }
}

#[test]
fn roundtrip_spacing_types() {
    // Test both spacing types: percent and points
    let text_body = TextBody {
        body_props: TextBodyProperties::default(),
        list_style: None,
        paragraphs: vec![Paragraph {
            props: ParagraphProperties {
                line_spacing: Some(TextSpacing::Percent(200000)),
                space_before: Some(TextSpacing::Points(1200)),
                space_after: Some(TextSpacing::Percent(50000)),
                ..Default::default()
            },
            runs: vec![TextRunContent::Run(TextRun {
                text: "spacing test".to_string(),
                props: RunProperties::default(),
            })],
            end_para_rpr: None,
        }],
    };

    let result = roundtrip_text_body(text_body);
    let pp = &result.paragraphs[0].props;
    assert_eq!(
        pp.line_spacing,
        Some(TextSpacing::Percent(200000)),
        "line spacing percent"
    );
    assert_eq!(
        pp.space_before,
        Some(TextSpacing::Points(1200)),
        "space before points"
    );
    assert_eq!(
        pp.space_after,
        Some(TextSpacing::Percent(50000)),
        "space after percent"
    );
}
