use super::*;

// TextUnderlineType
// -----------------------------------------------------------------------

#[test]
fn text_underline_type_default_is_none() {
    assert_eq!(TextUnderlineType::default(), TextUnderlineType::None);
}

#[test]
fn text_underline_type_roundtrip() {
    let variants = [
        TextUnderlineType::None,
        TextUnderlineType::Words,
        TextUnderlineType::Single,
        TextUnderlineType::Double,
        TextUnderlineType::Heavy,
        TextUnderlineType::Dotted,
        TextUnderlineType::DottedHeavy,
        TextUnderlineType::Dash,
        TextUnderlineType::DashHeavy,
        TextUnderlineType::DashLong,
        TextUnderlineType::DashLongHeavy,
        TextUnderlineType::DotDash,
        TextUnderlineType::DotDashHeavy,
        TextUnderlineType::DotDotDash,
        TextUnderlineType::DotDotDashHeavy,
        TextUnderlineType::Wavy,
        TextUnderlineType::WavyHeavy,
        TextUnderlineType::WavyDouble,
    ];
    for v in variants {
        assert_eq!(
            TextUnderlineType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_underline_type_from_ooxml_unknown_defaults_to_none() {
    assert_eq!(TextUnderlineType::from_ooxml(""), TextUnderlineType::None);
    assert_eq!(
        TextUnderlineType::from_ooxml("bogus"),
        TextUnderlineType::None
    );
}

#[test]
fn text_underline_type_specific_ooxml_values() {
    assert_eq!(TextUnderlineType::Single.to_ooxml(), "sng");
    assert_eq!(TextUnderlineType::Double.to_ooxml(), "dbl");
    assert_eq!(TextUnderlineType::WavyDouble.to_ooxml(), "wavyDbl");
}

// -----------------------------------------------------------------------
// TextStrikeType
// -----------------------------------------------------------------------

#[test]
fn text_strike_type_default_is_no_strike() {
    assert_eq!(TextStrikeType::default(), TextStrikeType::NoStrike);
}

#[test]
fn text_strike_type_roundtrip() {
    let variants = [
        TextStrikeType::NoStrike,
        TextStrikeType::SingleStrike,
        TextStrikeType::DoubleStrike,
    ];
    for v in variants {
        assert_eq!(
            TextStrikeType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_strike_type_from_ooxml_unknown_defaults_to_no_strike() {
    assert_eq!(TextStrikeType::from_ooxml(""), TextStrikeType::NoStrike);
    assert_eq!(
        TextStrikeType::from_ooxml("bogus"),
        TextStrikeType::NoStrike
    );
}

#[test]
fn text_strike_type_specific_ooxml_values() {
    assert_eq!(TextStrikeType::SingleStrike.to_ooxml(), "sngStrike");
    assert_eq!(TextStrikeType::DoubleStrike.to_ooxml(), "dblStrike");
}

// -----------------------------------------------------------------------
// TextCapsType
// -----------------------------------------------------------------------

#[test]
fn text_caps_type_default_is_none() {
    assert_eq!(TextCapsType::default(), TextCapsType::None);
}

#[test]
fn text_caps_type_roundtrip() {
    let variants = [TextCapsType::None, TextCapsType::Small, TextCapsType::All];
    for v in variants {
        assert_eq!(
            TextCapsType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_caps_type_from_ooxml_unknown_defaults_to_none() {
    assert_eq!(TextCapsType::from_ooxml(""), TextCapsType::None);
    assert_eq!(TextCapsType::from_ooxml("bogus"), TextCapsType::None);
}

// -----------------------------------------------------------------------
// TextVerticalType
// -----------------------------------------------------------------------

#[test]
fn text_vertical_type_default_is_horizontal() {
    assert_eq!(TextVerticalType::default(), TextVerticalType::Horizontal);
}

#[test]
fn text_vertical_type_roundtrip() {
    let variants = [
        TextVerticalType::Horizontal,
        TextVerticalType::Vertical,
        TextVerticalType::Vertical270,
        TextVerticalType::WordArtVert,
        TextVerticalType::EastAsianVert,
        TextVerticalType::MongolianVert,
        TextVerticalType::WordArtVertRtl,
    ];
    for v in variants {
        assert_eq!(
            TextVerticalType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_vertical_type_from_ooxml_unknown_defaults_to_horizontal() {
    assert_eq!(
        TextVerticalType::from_ooxml(""),
        TextVerticalType::Horizontal
    );
    assert_eq!(
        TextVerticalType::from_ooxml("bogus"),
        TextVerticalType::Horizontal
    );
}

#[test]
fn text_vertical_type_specific_ooxml_values() {
    assert_eq!(TextVerticalType::Horizontal.to_ooxml(), "horz");
    assert_eq!(TextVerticalType::EastAsianVert.to_ooxml(), "eaVert");
    assert_eq!(
        TextVerticalType::WordArtVertRtl.to_ooxml(),
        "wordArtVertRtl"
    );
}

// -----------------------------------------------------------------------
// TextVertOverflow
// -----------------------------------------------------------------------

#[test]
fn text_vert_overflow_default_is_overflow() {
    assert_eq!(TextVertOverflow::default(), TextVertOverflow::Overflow);
}

#[test]
fn text_vert_overflow_roundtrip() {
    let variants = [
        TextVertOverflow::Overflow,
        TextVertOverflow::Ellipsis,
        TextVertOverflow::Clip,
    ];
    for v in variants {
        assert_eq!(
            TextVertOverflow::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_vert_overflow_from_ooxml_unknown_defaults_to_overflow() {
    assert_eq!(TextVertOverflow::from_ooxml(""), TextVertOverflow::Overflow);
    assert_eq!(
        TextVertOverflow::from_ooxml("bogus"),
        TextVertOverflow::Overflow
    );
}

// -----------------------------------------------------------------------
// TextHorzOverflow
// -----------------------------------------------------------------------

#[test]
fn text_horz_overflow_default_is_overflow() {
    assert_eq!(TextHorzOverflow::default(), TextHorzOverflow::Overflow);
}

#[test]
fn text_horz_overflow_roundtrip() {
    let variants = [TextHorzOverflow::Overflow, TextHorzOverflow::Clip];
    for v in variants {
        assert_eq!(
            TextHorzOverflow::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_horz_overflow_from_ooxml_unknown_defaults_to_overflow() {
    assert_eq!(TextHorzOverflow::from_ooxml(""), TextHorzOverflow::Overflow);
    assert_eq!(
        TextHorzOverflow::from_ooxml("bogus"),
        TextHorzOverflow::Overflow
    );
}

// -----------------------------------------------------------------------
// TextAutofit
// -----------------------------------------------------------------------

#[test]
fn text_autofit_default_is_no_autofit() {
    assert_eq!(TextAutofit::default(), TextAutofit::NoAutofit);
}

#[test]
fn text_autofit_normal_with_fields() {
    let af = TextAutofit::NormalAutofit {
        font_scale: Some(75000),
        line_space_reduction: Some(20000),
    };
    match af {
        TextAutofit::NormalAutofit {
            font_scale,
            line_space_reduction,
        } => {
            assert_eq!(font_scale, Some(75000));
            assert_eq!(line_space_reduction, Some(20000));
        }
        _ => panic!("expected NormalAutofit"),
    }
}

// -----------------------------------------------------------------------
// TextFontAlignType
// -----------------------------------------------------------------------

#[test]
fn text_font_align_type_default_is_auto() {
    assert_eq!(TextFontAlignType::default(), TextFontAlignType::Auto);
}

#[test]
fn text_font_align_type_roundtrip() {
    let variants = [
        TextFontAlignType::Auto,
        TextFontAlignType::Top,
        TextFontAlignType::Center,
        TextFontAlignType::Baseline,
        TextFontAlignType::Bottom,
    ];
    for v in variants {
        assert_eq!(
            TextFontAlignType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_font_align_type_from_ooxml_unknown_defaults_to_auto() {
    assert_eq!(TextFontAlignType::from_ooxml(""), TextFontAlignType::Auto);
    assert_eq!(
        TextFontAlignType::from_ooxml("bogus"),
        TextFontAlignType::Auto
    );
}

#[test]
fn text_font_align_type_specific_ooxml_values() {
    assert_eq!(TextFontAlignType::Top.to_ooxml(), "t");
    assert_eq!(TextFontAlignType::Center.to_ooxml(), "ctr");
    assert_eq!(TextFontAlignType::Baseline.to_ooxml(), "base");
    assert_eq!(TextFontAlignType::Bottom.to_ooxml(), "b");
}

// -----------------------------------------------------------------------
// TextAutonumberType
// -----------------------------------------------------------------------

#[test]
fn text_autonumber_type_default_is_arabic_period() {
    assert_eq!(
        TextAutonumberType::default(),
        TextAutonumberType::ArabicPeriod
    );
}

#[test]
fn text_autonumber_type_roundtrip() {
    let variants = [
        TextAutonumberType::AlphaLcParenBoth,
        TextAutonumberType::AlphaUcParenBoth,
        TextAutonumberType::AlphaLcParenR,
        TextAutonumberType::AlphaUcParenR,
        TextAutonumberType::AlphaLcPeriod,
        TextAutonumberType::AlphaUcPeriod,
        TextAutonumberType::ArabicParenBoth,
        TextAutonumberType::ArabicParenR,
        TextAutonumberType::ArabicPeriod,
        TextAutonumberType::ArabicPlain,
        TextAutonumberType::RomanLcParenBoth,
        TextAutonumberType::RomanUcParenBoth,
        TextAutonumberType::RomanLcParenR,
        TextAutonumberType::RomanUcParenR,
        TextAutonumberType::RomanLcPeriod,
        TextAutonumberType::RomanUcPeriod,
        TextAutonumberType::CircleNumDbPlain,
        TextAutonumberType::CircleNumWdBlackPlain,
        TextAutonumberType::CircleNumWdWhitePlain,
        TextAutonumberType::ArabicDbPeriod,
        TextAutonumberType::ArabicDbPlain,
        TextAutonumberType::Ea1ChsPeriod,
        TextAutonumberType::Ea1ChsPlain,
        TextAutonumberType::Ea1ChtPeriod,
        TextAutonumberType::Ea1ChtPlain,
        TextAutonumberType::Ea1JpnChsDbPeriod,
        TextAutonumberType::Ea1JpnKorPlain,
        TextAutonumberType::Ea1JpnKorPeriod,
        TextAutonumberType::Arabic1Minus,
        TextAutonumberType::Arabic2Minus,
        TextAutonumberType::Hebrew2Minus,
        TextAutonumberType::ThaiAlphaPeriod,
        TextAutonumberType::ThaiAlphaParenR,
        TextAutonumberType::ThaiAlphaParenBoth,
        TextAutonumberType::ThaiNumPeriod,
        TextAutonumberType::ThaiNumParenR,
        TextAutonumberType::ThaiNumParenBoth,
        TextAutonumberType::HindiAlphaPeriod,
        TextAutonumberType::HindiNumPeriod,
        TextAutonumberType::HindiNumParenR,
        TextAutonumberType::HindiAlpha1Period,
    ];
    for v in variants {
        assert_eq!(
            TextAutonumberType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_autonumber_type_from_ooxml_unknown_defaults_to_arabic_period() {
    assert_eq!(
        TextAutonumberType::from_ooxml(""),
        TextAutonumberType::ArabicPeriod
    );
    assert_eq!(
        TextAutonumberType::from_ooxml("bogus"),
        TextAutonumberType::ArabicPeriod
    );
}

// -----------------------------------------------------------------------
// TextTabAlignType
// -----------------------------------------------------------------------

#[test]
fn text_tab_align_type_default_is_left() {
    assert_eq!(TextTabAlignType::default(), TextTabAlignType::Left);
}

#[test]
fn text_tab_align_type_roundtrip() {
    let variants = [
        TextTabAlignType::Left,
        TextTabAlignType::Center,
        TextTabAlignType::Right,
        TextTabAlignType::Decimal,
    ];
    for v in variants {
        assert_eq!(
            TextTabAlignType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_tab_align_type_from_ooxml_unknown_defaults_to_left() {
    assert_eq!(TextTabAlignType::from_ooxml(""), TextTabAlignType::Left);
    assert_eq!(
        TextTabAlignType::from_ooxml("bogus"),
        TextTabAlignType::Left
    );
}

#[test]
fn text_tab_align_type_specific_ooxml_values() {
    assert_eq!(TextTabAlignType::Left.to_ooxml(), "l");
    assert_eq!(TextTabAlignType::Center.to_ooxml(), "ctr");
    assert_eq!(TextTabAlignType::Right.to_ooxml(), "r");
    assert_eq!(TextTabAlignType::Decimal.to_ooxml(), "dec");
}

// -----------------------------------------------------------------------
// TextFont
// -----------------------------------------------------------------------

#[test]
fn text_font_default() {
    let f = TextFont::default();
    assert_eq!(f.typeface, "");
    assert!(f.panose.is_none());
    assert!(f.pitch_family.is_none());
    assert!(f.charset.is_none());
}

// -----------------------------------------------------------------------
// TextSpacing
// -----------------------------------------------------------------------

#[test]
fn text_spacing_percent() {
    let s = TextSpacing::Percent(100_000);
    match s {
        TextSpacing::Percent(v) => assert_eq!(v, 100_000),
        _ => panic!("expected Percent"),
    }
}

#[test]
fn text_spacing_points() {
    let s = TextSpacing::Points(1200);
    match s {
        TextSpacing::Points(v) => assert_eq!(v, 1200),
        _ => panic!("expected Points"),
    }
}

// -----------------------------------------------------------------------
// TextTabStop
// -----------------------------------------------------------------------

#[test]
fn text_tab_stop_default() {
    let t = TextTabStop::default();
    assert!(t.position.is_none());
    assert!(t.align.is_none());
}

// -----------------------------------------------------------------------
// BulletProperties
// -----------------------------------------------------------------------

#[test]
fn bullet_properties_default() {
    let b = BulletProperties::default();
    assert!(b.color.is_none());
    assert!(b.size.is_none());
    assert!(b.font.is_none());
    assert!(b.bullet_type.is_none());
}

#[test]
fn bullet_type_char() {
    let bt = BulletType::Char("\u{2022}".to_string());
    match bt {
        BulletType::Char(c) => assert_eq!(c, "\u{2022}"),
        _ => panic!("expected Char"),
    }
}

#[test]
fn bullet_type_auto_num() {
    let bt = BulletType::AutoNum {
        scheme: TextAutonumberType::ArabicPeriod,
        start_at: Some(1),
    };
    match bt {
        BulletType::AutoNum { scheme, start_at } => {
            assert_eq!(scheme, TextAutonumberType::ArabicPeriod);
            assert_eq!(start_at, Some(1));
        }
        _ => panic!("expected AutoNum"),
    }
}

// -----------------------------------------------------------------------
// Hyperlink defaults
// -----------------------------------------------------------------------

#[test]
fn hyperlink_defaults() {
    let h = Hyperlink::default();
    assert!(h.url.is_none());
    assert!(h.tooltip.is_none());
    assert!(h.action.is_none());
    assert!(h.r_id.is_none());
    // Additional Hyperlink fields also default to None
    assert!(h.tgt_frame.is_none());
    assert!(h.invalid_url.is_none());
    assert!(h.history.is_none());
    assert!(h.highlight_click.is_none());
    assert!(h.end_snd.is_none());
}

// -----------------------------------------------------------------------
// ExtensionList
// -----------------------------------------------------------------------

#[test]
fn extension_list_default() {
    let e = ExtensionList::default();
    assert!(e.raw_xml.is_none());
}

// -----------------------------------------------------------------------
// UnderlineLine and UnderlineFill
// -----------------------------------------------------------------------

#[test]
fn underline_line_follow_text() {
    let ul = UnderlineLine::FollowText;
    assert_eq!(ul, UnderlineLine::FollowText);
}

#[test]
fn underline_fill_follow_text() {
    let uf = UnderlineFill::FollowText;
    assert_eq!(uf, UnderlineFill::FollowText);
}

// -----------------------------------------------------------------------
// TextRunContent
// -----------------------------------------------------------------------

#[test]
fn text_run_content_run() {
    let content = TextRunContent::Run(TextRun {
        text: "hello".to_string(),
        props: RunProperties::default(),
    });
    match content {
        TextRunContent::Run(r) => assert_eq!(r.text, "hello"),
        _ => panic!("expected Run"),
    }
}

#[test]
fn text_run_content_line_break() {
    let content = TextRunContent::LineBreak { props: None };
    match content {
        TextRunContent::LineBreak { props } => assert!(props.is_none()),
        _ => panic!("expected LineBreak"),
    }
}

#[test]
fn text_run_content_field() {
    let content = TextRunContent::Field {
        id: "{12345}".to_string(),
        field_type: Some("slidenum".to_string()),
        text: Some("1".to_string()),
        run_props: None,
        para_props: None,
    };
    match content {
        TextRunContent::Field {
            id,
            field_type,
            text,
            run_props,
            ..
        } => {
            assert_eq!(id, "{12345}");
            assert_eq!(field_type.as_deref(), Some("slidenum"));
            assert_eq!(text.as_deref(), Some("1"));
            assert!(run_props.is_none());
        }
        _ => panic!("expected Field"),
    }
}

// -----------------------------------------------------------------------
// TextListStyle
// -----------------------------------------------------------------------

#[test]
fn text_list_style_default() {
    let ls = TextListStyle::default();
    assert!(ls.def_ppr.is_none());
    for level in &ls.level_ppr {
        assert!(level.is_none());
    }
}

// -----------------------------------------------------------------------
