use super::*;
use ooxml_types::drawings::{
    StAngle, StPercentage, StTextFontSize, StTextIndentLevelType, StTextNonNegativePoint,
    StTextPoint, TextAutonumberType,
};

#[test]
fn parse_prst_tx_warp_with_one_guide() {
    let xml = b"<a:bodyPr><a:prstTxWarp prst=\"textWave1\"><a:avLst><a:gd name=\"adj\" fmla=\"val 12500\"/></a:avLst></a:prstTxWarp></a:bodyPr>";
    let props = parse_body_props(xml);
    let warp = props.prst_tx_warp.unwrap();
    assert_eq!(
        warp.preset,
        ooxml_types::drawings::TextWarpPreset::TextWave1
    );
    assert_eq!(warp.adjust_values.len(), 1);
    assert_eq!(warp.adjust_values[0].name, "adj");
    assert_eq!(warp.adjust_values[0].fmla, "val 12500");
}

#[test]
fn parse_prst_tx_warp_arch_up_large_value() {
    let xml = b"<a:bodyPr><a:prstTxWarp prst=\"textArchUp\"><a:avLst><a:gd name=\"adj\" fmla=\"val 10800000\"/></a:avLst></a:prstTxWarp></a:bodyPr>";
    let props = parse_body_props(xml);
    let warp = props.prst_tx_warp.unwrap();
    assert_eq!(
        warp.preset,
        ooxml_types::drawings::TextWarpPreset::TextArchUp
    );
    assert_eq!(warp.adjust_values[0].fmla, "val 10800000");
}

#[test]
fn parse_prst_tx_warp_self_closing_no_avlst() {
    let xml = b"<a:bodyPr><a:prstTxWarp prst=\"textPlain\"/></a:bodyPr>";
    let props = parse_body_props(xml);
    let warp = props.prst_tx_warp.unwrap();
    assert_eq!(
        warp.preset,
        ooxml_types::drawings::TextWarpPreset::TextPlain
    );
    assert!(warp.adjust_values.is_empty());
}

#[test]
fn parse_prst_tx_warp_empty_avlst() {
    let xml = b"<a:bodyPr><a:prstTxWarp prst=\"textCurveUp\"><a:avLst/></a:prstTxWarp></a:bodyPr>";
    let props = parse_body_props(xml);
    let warp = props.prst_tx_warp.unwrap();
    assert_eq!(
        warp.preset,
        ooxml_types::drawings::TextWarpPreset::TextCurveUp
    );
    assert!(warp.adjust_values.is_empty());
}

#[test]
fn parse_prst_tx_warp_two_guides() {
    let xml = b"<a:bodyPr><a:prstTxWarp prst=\"textInflate\"><a:avLst><a:gd name=\"adj\" fmla=\"val 18750\"/><a:gd name=\"adj2\" fmla=\"val 50000\"/></a:avLst></a:prstTxWarp></a:bodyPr>";
    let props = parse_body_props(xml);
    let warp = props.prst_tx_warp.unwrap();
    assert_eq!(warp.adjust_values.len(), 2);
    assert_eq!(warp.adjust_values[0].name, "adj");
    assert_eq!(warp.adjust_values[1].name, "adj2");
}

#[test]
fn parse_no_prst_tx_warp() {
    let xml = b"<a:bodyPr wrap=\"square\"/>";
    let props = parse_body_props(xml);
    assert!(props.prst_tx_warp.is_none());
}

#[test]
fn parse_body_props_uses_direct_children_only() {
    let xml = br#"<a:bodyPr>
            <a:extLst>
                <a:ext>
                    <a:spAutoFit/>
                    <a:prstTxWarp prst="textWave1">
                        <a:avLst><a:gd name="nested" fmla="val 1"/></a:avLst>
                    </a:prstTxWarp>
                </a:ext>
            </a:extLst>
            <a:noAutofit/>
            <a:prstTxWarp prst="textPlain">
                <a:avLst>
                    <a:ext><a:gd name="nestedGuide" fmla="val 2"/></a:ext>
                    <a:gd name="directGuide" fmla="val 3"/>
                </a:avLst>
            </a:prstTxWarp>
        </a:bodyPr>"#;

    let props = parse_body_props(xml);

    assert_eq!(props.autofit, Some(TextAutofit::NoAutofit));
    let warp = props.prst_tx_warp.expect("direct warp");
    assert_eq!(
        warp.preset,
        ooxml_types::drawings::TextWarpPreset::TextPlain
    );
    assert_eq!(warp.adjust_values.len(), 1);
    assert_eq!(warp.adjust_values[0].name, "directGuide");
    assert!(
        props
            .ext_lst
            .as_ref()
            .unwrap()
            .raw_xml
            .as_ref()
            .unwrap()
            .contains("spAutoFit")
    );
}

#[test]
fn parse_ext_lst_captures_root_element_only() {
    let xml = br#"<a:extLst>
            <a:ext>
                <a:extLst><a:ext uri="nested"/></a:extLst>
            </a:ext>
        </a:extLst>
        <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>"#;

    let raw = parse_ext_lst(xml)
        .expect("extension list")
        .raw_xml
        .expect("raw xml");

    assert!(raw.contains("nested"));
    assert!(raw.ends_with("</a:extLst>"));
    assert!(!raw.contains("solidFill"));
}

#[test]
fn parse_ext_lst_captures_self_closing_root() {
    let xml = br#"<a:extLst/> <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>"#;

    let raw = parse_ext_lst(xml)
        .expect("extension list")
        .raw_xml
        .expect("raw xml");

    assert_eq!(raw, "<a:extLst/>");
}

#[test]
fn parse_prst_tx_warp_unknown_preset() {
    let xml = b"<a:bodyPr><a:prstTxWarp prst=\"textUnknownXYZ\"/></a:bodyPr>";
    let props = parse_body_props(xml);
    assert!(props.prst_tx_warp.is_none());
}

#[test]
fn parse_all_41_presets() {
    let all_presets = [
        "textNoShape",
        "textPlain",
        "textStop",
        "textTriangle",
        "textTriangleInverted",
        "textChevron",
        "textChevronInverted",
        "textRingInside",
        "textRingOutside",
        "textArchUp",
        "textArchDown",
        "textCircle",
        "textButton",
        "textArchUpPour",
        "textArchDownPour",
        "textCirclePour",
        "textButtonPour",
        "textCurveUp",
        "textCurveDown",
        "textCanUp",
        "textCanDown",
        "textWave1",
        "textWave2",
        "textDoubleWave1",
        "textWave4",
        "textInflate",
        "textDeflate",
        "textInflateBottom",
        "textDeflateBottom",
        "textInflateTop",
        "textDeflateTop",
        "textDeflateInflate",
        "textDeflateInflateDeflate",
        "textFadeRight",
        "textFadeLeft",
        "textFadeUp",
        "textFadeDown",
        "textSlantUp",
        "textSlantDown",
        "textCascadeUp",
        "textCascadeDown",
    ];
    for preset_name in &all_presets {
        let xml = format!(
            "<a:bodyPr><a:prstTxWarp prst=\"{}\"/></a:bodyPr>",
            preset_name
        );
        let props = parse_body_props(xml.as_bytes());
        let warp = props
            .prst_tx_warp
            .unwrap_or_else(|| panic!("Failed to parse preset: {}", preset_name));
        assert_eq!(
            warp.preset.to_ooxml(),
            *preset_name,
            "Roundtrip failed for {}",
            preset_name
        );
    }
}

// ── Roundtrip validation tests ────────────────────────────────

/// Helper: given a PresetTextWarp, produce the XML a writer would emit and verify parse roundtrip
fn roundtrip_warp(warp: &ooxml_types::drawings::PresetTextWarp) {
    // Build XML similar to what the writer emits
    let mut xml = String::new();
    xml.push_str("<a:bodyPr wrap=\"square\" rtlCol=\"0\">");
    xml.push_str(&format!(
        "<a:prstTxWarp prst=\"{}\"",
        warp.preset.to_ooxml()
    ));
    if warp.adjust_values.is_empty() {
        xml.push_str("/>");
    } else {
        xml.push_str("><a:avLst>");
        for gd in &warp.adjust_values {
            xml.push_str(&format!(
                "<a:gd name=\"{}\" fmla=\"{}\"/>",
                gd.name, gd.fmla
            ));
        }
        xml.push_str("</a:avLst></a:prstTxWarp>");
    }
    xml.push_str("</a:bodyPr>");

    // Parse it back
    let props = parse_body_props(xml.as_bytes());
    let parsed = props
        .prst_tx_warp
        .expect("prst_tx_warp should be Some after roundtrip");
    assert_eq!(
        parsed.preset,
        warp.preset,
        "preset mismatch for {}",
        warp.preset.to_ooxml()
    );
    assert_eq!(
        parsed.adjust_values.len(),
        warp.adjust_values.len(),
        "adjust count mismatch"
    );
    for (i, (expected, actual)) in warp
        .adjust_values
        .iter()
        .zip(parsed.adjust_values.iter())
        .enumerate()
    {
        assert_eq!(actual.name, expected.name, "guide[{}] name mismatch", i);
        assert_eq!(actual.fmla, expected.fmla, "guide[{}] fmla mismatch", i);
    }
}

#[test]
fn roundtrip_all_41_presets_no_adjusts() {
    use ooxml_types::drawings::{PresetTextWarp, TextWarpPreset};
    let all = [
        TextWarpPreset::TextNoShape,
        TextWarpPreset::TextPlain,
        TextWarpPreset::TextStop,
        TextWarpPreset::TextTriangle,
        TextWarpPreset::TextTriangleInverted,
        TextWarpPreset::TextChevron,
        TextWarpPreset::TextChevronInverted,
        TextWarpPreset::TextRingInside,
        TextWarpPreset::TextRingOutside,
        TextWarpPreset::TextArchUp,
        TextWarpPreset::TextArchDown,
        TextWarpPreset::TextCircle,
        TextWarpPreset::TextButton,
        TextWarpPreset::TextArchUpPour,
        TextWarpPreset::TextArchDownPour,
        TextWarpPreset::TextCirclePour,
        TextWarpPreset::TextButtonPour,
        TextWarpPreset::TextCurveUp,
        TextWarpPreset::TextCurveDown,
        TextWarpPreset::TextCanUp,
        TextWarpPreset::TextCanDown,
        TextWarpPreset::TextWave1,
        TextWarpPreset::TextWave2,
        TextWarpPreset::TextDoubleWave1,
        TextWarpPreset::TextWave4,
        TextWarpPreset::TextInflate,
        TextWarpPreset::TextDeflate,
        TextWarpPreset::TextInflateBottom,
        TextWarpPreset::TextDeflateBottom,
        TextWarpPreset::TextInflateTop,
        TextWarpPreset::TextDeflateTop,
        TextWarpPreset::TextDeflateInflate,
        TextWarpPreset::TextDeflateInflateDeflate,
        TextWarpPreset::TextFadeRight,
        TextWarpPreset::TextFadeLeft,
        TextWarpPreset::TextFadeUp,
        TextWarpPreset::TextFadeDown,
        TextWarpPreset::TextSlantUp,
        TextWarpPreset::TextSlantDown,
        TextWarpPreset::TextCascadeUp,
        TextWarpPreset::TextCascadeDown,
    ];
    assert_eq!(all.len(), 41);
    for preset in &all {
        let warp = PresetTextWarp {
            preset: *preset,
            adjust_values: vec![],
        };
        roundtrip_warp(&warp);
    }
}

#[test]
fn roundtrip_single_adjust() {
    use ooxml_types::drawings::{GeomGuide, PresetTextWarp, TextWarpPreset};
    let warp = PresetTextWarp {
        preset: TextWarpPreset::TextWave1,
        adjust_values: vec![GeomGuide {
            name: "adj".to_string(),
            fmla: "val 12500".to_string(),
        }],
    };
    roundtrip_warp(&warp);
}

#[test]
fn roundtrip_two_adjusts() {
    use ooxml_types::drawings::{GeomGuide, PresetTextWarp, TextWarpPreset};
    let warp = PresetTextWarp {
        preset: TextWarpPreset::TextArchUpPour,
        adjust_values: vec![
            GeomGuide {
                name: "adj".to_string(),
                fmla: "val 10800000".to_string(),
            },
            GeomGuide {
                name: "adj2".to_string(),
                fmla: "val 50000".to_string(),
            },
        ],
    };
    roundtrip_warp(&warp);
}

#[test]
fn roundtrip_zero_adjusts_explicit() {
    use ooxml_types::drawings::{PresetTextWarp, TextWarpPreset};
    let warp = PresetTextWarp {
        preset: TextWarpPreset::TextPlain,
        adjust_values: vec![],
    };
    roundtrip_warp(&warp);
}

#[test]
fn roundtrip_complex_formula() {
    use ooxml_types::drawings::{GeomGuide, PresetTextWarp, TextWarpPreset};
    let warp = PresetTextWarp {
        preset: TextWarpPreset::TextInflate,
        adjust_values: vec![GeomGuide {
            name: "adj".to_string(),
            fmla: "val 25000".to_string(),
        }],
    };
    roundtrip_warp(&warp);
}

#[test]
fn roundtrip_text_no_shape() {
    use ooxml_types::drawings::{PresetTextWarp, TextWarpPreset};
    let warp = PresetTextWarp {
        preset: TextWarpPreset::TextNoShape,
        adjust_values: vec![],
    };
    roundtrip_warp(&warp);
}

#[test]
fn roundtrip_longest_name() {
    use ooxml_types::drawings::{PresetTextWarp, TextWarpPreset};
    let warp = PresetTextWarp {
        preset: TextWarpPreset::TextDeflateInflateDeflate,
        adjust_values: vec![],
    };
    roundtrip_warp(&warp);
}

#[test]
fn roundtrip_none_warp() {
    // No prstTxWarp element → None
    let xml = b"<a:bodyPr wrap=\"square\" rtlCol=\"0\"/>";
    let props = parse_body_props(xml);
    assert!(props.prst_tx_warp.is_none());
}

#[test]
fn roundtrip_warp_with_other_body_props() {
    // bodyPr with rot, wrap, insets AND prstTxWarp
    let xml = b"<a:bodyPr rot=\"5400000\" wrap=\"square\" lIns=\"91440\" tIns=\"45720\" rIns=\"91440\" bIns=\"45720\"><a:prstTxWarp prst=\"textArchUp\"><a:avLst><a:gd name=\"adj\" fmla=\"val 10800000\"/></a:avLst></a:prstTxWarp></a:bodyPr>";
    let props = parse_body_props(xml);
    // Verify other props are preserved
    assert_eq!(props.rot, Some(StAngle::new(5400000)));
    assert_eq!(props.wrap, Some(super::TextWrap::Square));
    assert_eq!(props.l_ins, Some(91440));
    // Verify warp is preserved
    let warp = props.prst_tx_warp.unwrap();
    assert_eq!(
        warp.preset,
        ooxml_types::drawings::TextWarpPreset::TextArchUp
    );
    assert_eq!(warp.adjust_values.len(), 1);
}

// ── Body properties expansion tests ───────────────────────────

#[test]
fn parse_body_props_vert_type() {
    let xml = b"<a:bodyPr vert=\"vert270\"/>";
    let props = parse_body_props(xml);
    assert_eq!(props.vert, Some(TextVerticalType::Vertical270));
}

#[test]
fn parse_body_props_overflow_modes() {
    let xml = b"<a:bodyPr vertOverflow=\"clip\" horzOverflow=\"clip\"/>";
    let props = parse_body_props(xml);
    assert_eq!(props.vert_overflow, Some(TextVertOverflow::Clip));
    assert_eq!(props.horz_overflow, Some(TextHorzOverflow::Clip));
}

#[test]
fn parse_body_props_anchor_ctr() {
    let xml = b"<a:bodyPr anchorCtr=\"1\"/>";
    let props = parse_body_props(xml);
    assert_eq!(props.anchor_ctr, Some(true));
}

#[test]
fn parse_body_props_multi_column() {
    let xml = b"<a:bodyPr numCol=\"3\" spcCol=\"91440\"/>";
    let props = parse_body_props(xml);
    assert_eq!(props.num_col, Some(3));
    assert_eq!(props.spc_col, Some(91440));
}

#[test]
fn parse_body_props_bool_attrs() {
    let xml = b"<a:bodyPr rtlCol=\"1\" spcFirstLastPara=\"true\" upright=\"1\" compatLnSpc=\"true\" forceAA=\"1\" fromWordArt=\"true\"/>";
    let props = parse_body_props(xml);
    assert_eq!(props.rtl_col, Some(true));
    assert_eq!(props.spc_first_last_para, Some(true));
    assert_eq!(props.upright, Some(true));
    assert_eq!(props.compat_ln_spc, Some(true));
    assert_eq!(props.force_aa, Some(true));
    assert_eq!(props.from_word_art, Some(true));
}

#[test]
fn parse_body_props_autofit_no_autofit() {
    let xml = b"<a:bodyPr><a:noAutofit/></a:bodyPr>";
    let props = parse_body_props(xml);
    assert_eq!(props.autofit, Some(TextAutofit::NoAutofit));
}

#[test]
fn parse_body_props_autofit_normal() {
    let xml = b"<a:bodyPr><a:normAutofit fontScale=\"90000\" lnSpcReduction=\"10000\"/></a:bodyPr>";
    let props = parse_body_props(xml);
    assert_eq!(
        props.autofit,
        Some(TextAutofit::NormalAutofit {
            font_scale: Some(90000),
            line_space_reduction: Some(10000),
        })
    );
}

#[test]
fn parse_body_props_autofit_shape() {
    let xml = b"<a:bodyPr><a:spAutoFit/></a:bodyPr>";
    let props = parse_body_props(xml);
    assert_eq!(props.autofit, Some(TextAutofit::ShapeAutofit));
}

#[test]
fn parse_body_props_all_vert_types() {
    let cases = [
        ("horz", TextVerticalType::Horizontal),
        ("vert", TextVerticalType::Vertical),
        ("vert270", TextVerticalType::Vertical270),
        ("wordArtVert", TextVerticalType::WordArtVert),
        ("eaVert", TextVerticalType::EastAsianVert),
        ("mongolianVert", TextVerticalType::MongolianVert),
        ("wordArtVertRtl", TextVerticalType::WordArtVertRtl),
    ];
    for (val, expected) in &cases {
        let xml = format!("<a:bodyPr vert=\"{}\"/>", val);
        let props = parse_body_props(xml.as_bytes());
        assert_eq!(props.vert, Some(*expected), "Failed for vert=\"{}\"", val);
    }
}

// ── Run properties expansion tests ────────────────────────────

#[test]
fn parse_run_props_kerning() {
    let xml = b"<a:rPr kern=\"1200\"/>";
    let props = parse_run_props(xml);
    assert_eq!(
        props.kern,
        Some(StTextNonNegativePoint::new_unchecked(1200))
    );
}

#[test]
fn parse_run_props_caps() {
    let xml = b"<a:rPr cap=\"all\"/>";
    let props = parse_run_props(xml);
    assert_eq!(props.cap, Some(TextCapsType::All));
}

#[test]
fn parse_run_props_spacing_baseline() {
    let xml = b"<a:rPr spc=\"200\" baseline=\"30000\"/>";
    let props = parse_run_props(xml);
    assert_eq!(props.spacing, Some(StTextPoint::new(200)));
    assert_eq!(props.baseline, Some(StPercentage::new(30000)));
}

#[test]
fn parse_run_props_lang() {
    let xml = b"<a:rPr lang=\"en-US\" altLang=\"ja-JP\"/>";
    let props = parse_run_props(xml);
    assert_eq!(props.lang, Some("en-US".to_string()));
    assert_eq!(props.alt_lang, Some("ja-JP".to_string()));
}

#[test]
fn parse_run_props_fonts_all() {
    let xml = br#"<a:rPr><a:latin typeface="Calibri" panose="020F0502020204030204"/><a:ea typeface="MS Gothic"/><a:cs typeface="Arial" charset="0"/><a:sym typeface="Symbol"/></a:rPr>"#;
    let props = parse_run_props(xml);
    let latin = props.latin.unwrap();
    assert_eq!(latin.typeface, "Calibri");
    assert_eq!(latin.panose, Some("020F0502020204030204".to_string()));
    let ea = props.ea.unwrap();
    assert_eq!(ea.typeface, "MS Gothic");
    let cs = props.cs.unwrap();
    assert_eq!(cs.typeface, "Arial");
    assert_eq!(cs.charset, Some(0));
    let sym = props.sym.unwrap();
    assert_eq!(sym.typeface, "Symbol");
}

#[test]
fn parse_run_props_hyperlink() {
    let xml = br#"<a:rPr><a:hlinkClick r:id="rId1" tooltip="Click me"/></a:rPr>"#;
    let props = parse_run_props(xml);
    let hlink = props.hlink_click.unwrap();
    assert_eq!(hlink.r_id, Some("rId1".to_string()));
    assert_eq!(hlink.tooltip, Some("Click me".to_string()));
}

#[test]
fn parse_run_props_hyperlink_mouse_over() {
    let xml = br#"<a:rPr><a:hlinkMouseOver r:id="rId2" action="ppaction://hlinksldjump"/></a:rPr>"#;
    let props = parse_run_props(xml);
    let hlink = props.hlink_mouse_over.unwrap();
    assert_eq!(hlink.r_id, Some("rId2".to_string()));
    assert_eq!(hlink.action, Some("ppaction://hlinksldjump".to_string()));
}

#[test]
fn parse_run_props_bool_flags() {
    let xml = b"<a:rPr kumimoji=\"1\" normalizeH=\"true\" noProof=\"1\" dirty=\"0\" err=\"1\" smtClean=\"true\" smtId=\"42\" bmk=\"bookmark1\"/>";
    let props = parse_run_props(xml);
    assert_eq!(props.kumimoji, Some(true));
    assert_eq!(props.normalize_h, Some(true));
    assert_eq!(props.no_proof, Some(true));
    assert_eq!(props.dirty, Some(false));
    assert_eq!(props.err, Some(true));
    assert_eq!(props.smt_clean, Some(true));
    assert_eq!(props.smt_id, Some(42));
    assert_eq!(props.bmk, Some("bookmark1".to_string()));
}

#[test]
fn parse_run_props_underline_types() {
    let cases = [
        ("sng", TextUnderlineType::Single),
        ("dbl", TextUnderlineType::Double),
        ("heavy", TextUnderlineType::Heavy),
        ("dotted", TextUnderlineType::Dotted),
        ("dash", TextUnderlineType::Dash),
        ("wavyHeavy", TextUnderlineType::WavyHeavy),
    ];
    for (val, expected) in &cases {
        let xml = format!("<a:rPr u=\"{}\"/>", val);
        let props = parse_run_props(xml.as_bytes());
        assert_eq!(props.underline, Some(*expected), "Failed for u=\"{}\"", val);
    }
}

#[test]
fn parse_run_props_strike_types() {
    let xml_single = b"<a:rPr strike=\"sngStrike\"/>";
    let props_single = parse_run_props(xml_single);
    assert_eq!(props_single.strike, Some(TextStrikeType::SingleStrike));

    let xml_double = b"<a:rPr strike=\"dblStrike\"/>";
    let props_double = parse_run_props(xml_double);
    assert_eq!(props_double.strike, Some(TextStrikeType::DoubleStrike));
}

#[test]
fn parse_run_props_highlight() {
    let xml = br#"<a:rPr><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr>"#;
    let props = parse_run_props(xml);
    let hl = props.highlight.unwrap();
    match &hl {
        DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FFFF00"),
        other => panic!("Expected SrgbClr, got {other:?}"),
    }
}

#[test]
fn parse_run_props_underline_line_follow_text() {
    let xml = b"<a:rPr><a:uLnTx/></a:rPr>";
    let props = parse_run_props(xml);
    assert!(matches!(
        props.underline_line,
        Some(UnderlineLine::FollowText)
    ));
}

#[test]
fn parse_run_props_underline_fill_follow_text() {
    let xml = b"<a:rPr><a:uFillTx/></a:rPr>";
    let props = parse_run_props(xml);
    assert!(matches!(
        props.underline_fill,
        Some(UnderlineFill::FollowText)
    ));
}

#[test]
fn parse_run_props_uses_direct_children_only() {
    let xml = br#"<a:rPr>
            <a:extLst>
                <a:ext>
                    <a:latin typeface="Nested"/>
                    <a:solidFill><a:srgbClr val="111111"/></a:solidFill>
                    <a:hlinkClick r:id="nested"/>
                    <a:uLnTx/>
                    <a:uFillTx/>
                    <a:rtl val="1"/>
                </a:ext>
            </a:extLst>
            <a:latin typeface="Direct"/>
            <a:ln><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:ln>
            <a:solidFill><a:srgbClr val="333333"/></a:solidFill>
            <a:highlight><a:srgbClr val="444444"/></a:highlight>
            <a:hlinkClick r:id="rId1"/>
            <a:rtl val="0"/>
        </a:rPr>"#;

    let props = parse_run_props(xml);

    assert_eq!(props.latin.unwrap().typeface, "Direct");
    assert!(props.text_outline.is_some());
    match props.color.as_ref().unwrap() {
        DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "333333"),
        other => panic!("expected text color from direct solidFill, got {other:?}"),
    }
    match props.text_fill.as_ref().unwrap() {
        Fill::Solid(fill) => match &fill.color {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "333333"),
            other => panic!("expected text fill from direct solidFill, got {other:?}"),
        },
        other => panic!("expected direct solid text fill, got {other:?}"),
    }
    match props.highlight.as_ref().unwrap() {
        DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "444444"),
        other => panic!("expected direct highlight, got {other:?}"),
    }
    assert_eq!(props.hlink_click.unwrap().r_id.as_deref(), Some("rId1"));
    assert_eq!(props.rtl, Some(false));
    assert!(props.underline_line.is_none());
    assert!(props.underline_fill.is_none());
    assert!(props.ext_lst.is_some());
}

// ── Paragraph properties expansion tests ─────────────────────

#[test]
fn parse_para_props_all_alignments() {
    let cases = [
        ("l", TextAlign::Left),
        ("ctr", TextAlign::Center),
        ("r", TextAlign::Right),
        ("just", TextAlign::Justify),
        ("justLow", TextAlign::JustifyLow),
        ("dist", TextAlign::Distributed),
        ("thaiDist", TextAlign::ThaiDistributed),
    ];
    for (val, expected) in &cases {
        let xml = format!("<a:pPr algn=\"{}\"/>", val);
        let props = parse_para_props(xml.as_bytes());
        assert_eq!(props.align, Some(*expected), "Failed for algn=\"{}\"", val);
    }
}

#[test]
fn parse_para_props_level_rtl() {
    let xml = b"<a:pPr lvl=\"2\" rtl=\"1\"/>";
    let props = parse_para_props(xml);
    assert_eq!(props.level, Some(StTextIndentLevelType::new_clamped(2)));
    assert_eq!(props.rtl, Some(true));
}

#[test]
fn parse_para_props_line_spacing_percent() {
    let xml = b"<a:pPr><a:lnSpc><a:spcPct val=\"150000\"/></a:lnSpc></a:pPr>";
    let props = parse_para_props(xml);
    assert_eq!(props.line_spacing, Some(TextSpacing::Percent(150000)));
}

#[test]
fn parse_para_props_line_spacing_points() {
    let xml = b"<a:pPr><a:lnSpc><a:spcPts val=\"1200\"/></a:lnSpc></a:pPr>";
    let props = parse_para_props(xml);
    assert_eq!(props.line_spacing, Some(TextSpacing::Points(1200)));
}

#[test]
fn parse_para_props_space_before_after() {
    let xml = b"<a:pPr><a:spcBef><a:spcPts val=\"600\"/></a:spcBef><a:spcAft><a:spcPct val=\"50000\"/></a:spcAft></a:pPr>";
    let props = parse_para_props(xml);
    assert_eq!(props.space_before, Some(TextSpacing::Points(600)));
    assert_eq!(props.space_after, Some(TextSpacing::Percent(50000)));
}

#[test]
fn parse_para_props_bullet_char() {
    let xml = br#"<a:pPr><a:buChar char="&#x2022;"/></a:pPr>"#;
    let props = parse_para_props(xml);
    let bullet = props.bullet.unwrap();
    assert!(matches!(bullet.bullet_type, Some(BulletType::Char(_))));
}

#[test]
fn parse_para_props_bullet_auto_num() {
    let xml = br#"<a:pPr><a:buAutoNum type="arabicPeriod" startAt="5"/></a:pPr>"#;
    let props = parse_para_props(xml);
    let bullet = props.bullet.unwrap();
    match bullet.bullet_type {
        Some(BulletType::AutoNum { scheme, start_at }) => {
            assert_eq!(scheme, TextAutonumberType::ArabicPeriod);
            assert_eq!(start_at, Some(5));
        }
        _ => panic!("Expected AutoNum bullet"),
    }
}

#[test]
fn parse_para_props_bullet_none() {
    let xml = b"<a:pPr><a:buNone/></a:pPr>";
    let props = parse_para_props(xml);
    let bullet = props.bullet.unwrap();
    assert!(matches!(bullet.bullet_type, Some(BulletType::None)));
}

#[test]
fn parse_para_props_bullet_color_size() {
    let xml =
        br#"<a:pPr><a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buSzPct val="75000"/></a:pPr>"#;
    let props = parse_para_props(xml);
    let bullet = props.bullet.unwrap();
    match &bullet.color {
        Some(BulletColor::Custom(c)) => match c {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
            other => panic!("Expected SrgbClr, got {other:?}"),
        },
        _ => panic!("Expected custom bullet color"),
    }
    assert_eq!(bullet.size, Some(BulletSize::Percent(75000)));
}

#[test]
fn parse_para_props_bullet_follow_text() {
    let xml = b"<a:pPr><a:buClrTx/><a:buSzTx/></a:pPr>";
    let props = parse_para_props(xml);
    let bullet = props.bullet.unwrap();
    assert!(matches!(bullet.color, Some(BulletColor::FollowText)));
    assert!(matches!(bullet.size, Some(BulletSize::FollowText)));
}

#[test]
fn parse_para_props_def_run_props() {
    let xml = b"<a:pPr><a:defRPr sz=\"1400\" b=\"1\"/></a:pPr>";
    let props = parse_para_props(xml);
    let drp = props.def_run_props.unwrap();
    assert_eq!(drp.size, Some(StTextFontSize::new_unchecked(1400)));
    assert_eq!(drp.bold, Some(true));
}

#[test]
fn parse_para_props_tab_stops() {
    let xml = br#"<a:pPr><a:tabLst><a:tab pos="914400" algn="ctr"/><a:tab pos="1828800" algn="r"/></a:tabLst></a:pPr>"#;
    let props = parse_para_props(xml);
    let tabs = props.tab_list.unwrap();
    assert_eq!(tabs.len(), 2);
    assert_eq!(tabs[0].position, Some(914400));
    assert_eq!(tabs[0].align, Some(TextTabAlignType::Center));
    assert_eq!(tabs[1].position, Some(1828800));
    assert_eq!(tabs[1].align, Some(TextTabAlignType::Right));
}

#[test]
fn parse_para_props_uses_direct_children_only() {
    let xml = br#"<a:pPr>
            <a:extLst>
                <a:ext>
                    <a:lnSpc><a:spcPct val="50000"/></a:lnSpc>
                    <a:buChar char="x"/>
                    <a:defRPr sz="999"/>
                    <a:tabLst><a:tab pos="1"/></a:tabLst>
                </a:ext>
            </a:extLst>
            <a:spcBef><a:spcPts val="600"/></a:spcBef>
            <a:defRPr sz="1400"/>
            <a:tabLst><a:tab pos="914400" algn="ctr"/></a:tabLst>
        </a:pPr>"#;

    let props = parse_para_props(xml);

    assert_eq!(props.line_spacing, None);
    assert_eq!(props.space_before, Some(TextSpacing::Points(600)));
    assert!(props.bullet.is_none());
    assert_eq!(
        props.def_run_props.unwrap().size,
        Some(StTextFontSize::new_unchecked(1400))
    );
    let tabs = props.tab_list.unwrap();
    assert_eq!(tabs.len(), 1);
    assert_eq!(tabs[0].position, Some(914400));
    assert_eq!(tabs[0].align, Some(TextTabAlignType::Center));
    assert!(props.ext_lst.is_some());
}

#[test]
fn parse_para_props_font_align() {
    let xml = b"<a:pPr fontAlgn=\"ctr\"/>";
    let props = parse_para_props(xml);
    assert_eq!(props.font_align, Some(TextFontAlignType::Center));
}

#[test]
fn parse_para_props_ea_ln_brk() {
    let xml = b"<a:pPr eaLnBrk=\"1\" latinLnBrk=\"0\" hangingPunct=\"1\"/>";
    let props = parse_para_props(xml);
    assert_eq!(props.ea_ln_brk, Some(true));
    assert_eq!(props.latin_ln_brk, Some(false));
    assert_eq!(props.hanging_punct, Some(true));
}

#[test]
fn parse_para_props_def_tab_sz() {
    let xml = b"<a:pPr defTabSz=\"914400\"/>";
    let props = parse_para_props(xml);
    assert_eq!(props.def_tab_sz, Some(914400));
}

// ── Paragraph content expansion tests ────────────────────────

#[test]
fn parse_paragraph_line_break() {
    let xml = b"<a:p><a:br><a:rPr sz=\"1200\"/></a:br></a:p>";
    let para = parse_paragraph(xml).unwrap();
    assert_eq!(para.runs.len(), 1);
    match &para.runs[0] {
        TextRunContent::LineBreak { props } => {
            assert_eq!(
                props.as_ref().unwrap().size,
                Some(StTextFontSize::new_unchecked(1200))
            );
        }
        _ => panic!("Expected LineBreak"),
    }
}

#[test]
fn parse_paragraph_field() {
    let xml = br#"<a:p><a:fld id="{B5C1F7C2-1234-5678-ABCD-123456789ABC}" type="slidenum"><a:rPr lang="en-US"/><a:t>42</a:t></a:fld></a:p>"#;
    let para = parse_paragraph(xml).unwrap();
    let found_field = para
        .runs
        .iter()
        .any(|r| matches!(r, TextRunContent::Field { .. }));
    assert!(found_field, "Expected a Field run");
    for run in &para.runs {
        if let TextRunContent::Field {
            id,
            field_type,
            text,
            run_props,
            ..
        } = run
        {
            assert_eq!(id, "{B5C1F7C2-1234-5678-ABCD-123456789ABC}");
            assert_eq!(field_type.as_deref(), Some("slidenum"));
            assert_eq!(text.as_deref(), Some("42"));
            assert!(run_props.is_some());
        }
    }
}

#[test]
fn parse_paragraph_end_para_rpr() {
    let xml = b"<a:p><a:endParaRPr lang=\"en-US\" sz=\"1100\"/></a:p>";
    let para = parse_paragraph(xml).unwrap();
    let epr = para.end_para_rpr.unwrap();
    assert_eq!(epr.lang, Some("en-US".to_string()));
    assert_eq!(epr.size, Some(StTextFontSize::new_unchecked(1100)));
}

#[test]
fn parse_paragraph_uses_direct_children_only() {
    let xml = br#"<a:p>
            <a:pPr algn="ctr"/>
            <a:r><a:t>Visible</a:t></a:r>
            <a:extLst>
                <a:ext>
                    <a:r><a:t>Nested</a:t></a:r>
                    <a:br/>
                    <a:endParaRPr sz="999"/>
                </a:ext>
            </a:extLst>
            <a:br><a:rPr sz="1200"/></a:br>
            <a:endParaRPr lang="en-US"/>
        </a:p>"#;

    let para = parse_paragraph(xml).unwrap();

    assert_eq!(para.props.align, Some(TextAlign::Center));
    assert_eq!(para.runs.len(), 2);
    let TextRunContent::Run(run) = &para.runs[0] else {
        panic!("expected first direct run");
    };
    assert_eq!(run.text, "Visible");
    let TextRunContent::LineBreak { props } = &para.runs[1] else {
        panic!("expected direct line break");
    };
    assert_eq!(
        props.as_ref().unwrap().size,
        Some(StTextFontSize::new_unchecked(1200))
    );
    assert_eq!(para.end_para_rpr.unwrap().lang.as_deref(), Some("en-US"));
}

#[test]
fn parse_text_run_uses_direct_children_only() {
    let xml = br#"<a:p>
            <a:r>
                <a:extLst>
                    <a:ext>
                        <a:rPr sz="999"/>
                        <a:t>Nested</a:t>
                    </a:ext>
                </a:extLst>
                <a:rPr sz="1200"/>
                <a:t>Visible</a:t>
            </a:r>
        </a:p>"#;

    let para = parse_paragraph(xml).unwrap();

    let TextRunContent::Run(run) = &para.runs[0] else {
        panic!("expected text run");
    };
    assert_eq!(run.text, "Visible");
    assert_eq!(run.props.size, Some(StTextFontSize::new_unchecked(1200)));
}

// ── List style tests ─────────────────────────────────────────

#[test]
fn parse_list_style_basic() {
    let xml = br#"<a:lstStyle><a:defPPr algn="ctr"><a:defRPr sz="1200"/></a:defPPr><a:lvl1pPr algn="l"/><a:lvl2pPr algn="r"/></a:lstStyle>"#;
    let style = parse_list_style(xml).unwrap();
    let def = style.def_ppr.unwrap();
    assert_eq!(def.align, Some(TextAlign::Center));
    let drp = def.def_run_props.unwrap();
    assert_eq!(drp.size, Some(StTextFontSize::new_unchecked(1200)));
    let lvl1 = style.level_ppr[0].as_ref().unwrap();
    assert_eq!(lvl1.align, Some(TextAlign::Left));
    let lvl2 = style.level_ppr[1].as_ref().unwrap();
    assert_eq!(lvl2.align, Some(TextAlign::Right));
    assert!(style.level_ppr[2].is_none());
}

#[test]
fn parse_list_style_empty() {
    let xml = b"<a:lstStyle/>";
    let style = parse_list_style(xml);
    // Empty lstStyle is still Some (preserves the element for round-trip)
    assert!(style.is_some());
    let s = style.unwrap();
    assert!(s.def_ppr.is_none());
    assert!(s.level_ppr.iter().all(|l| l.is_none()));
}

#[test]
fn parse_list_style_uses_direct_children_only() {
    let xml = br#"<a:lstStyle>
            <a:extLst>
                <a:ext>
                    <a:defPPr algn="r"/>
                    <a:lvl1pPr algn="r"/>
                </a:ext>
            </a:extLst>
            <a:defPPr algn="ctr"/>
            <a:lvl1pPr algn="l"/>
        </a:lstStyle>"#;

    let style = parse_list_style(xml).unwrap();

    assert_eq!(style.def_ppr.unwrap().align, Some(TextAlign::Center));
    assert_eq!(
        style.level_ppr[0].as_ref().unwrap().align,
        Some(TextAlign::Left)
    );
    assert!(style.level_ppr[1].is_none());
}

// ── Text body integration tests ──────────────────────────────

#[test]
fn parse_text_body_with_list_style() {
    let xml = br#"<a:txBody><a:bodyPr wrap="square"/><a:lstStyle><a:lvl1pPr algn="ctr"/></a:lstStyle><a:p><a:r><a:t>Hello</a:t></a:r></a:p></a:txBody>"#;
    let body = parse_text_body(xml).unwrap();
    assert!(body.list_style.is_some());
    let style = body.list_style.unwrap();
    assert_eq!(
        style.level_ppr[0].as_ref().unwrap().align,
        Some(TextAlign::Center)
    );
    assert_eq!(body.paragraphs.len(), 1);
}

#[test]
fn parse_text_body_uses_direct_children_only() {
    let xml = br#"<a:txBody>
            <a:bodyPr wrap="square"/>
            <a:p><a:r><a:t>Visible</a:t></a:r></a:p>
            <a:extLst><a:ext><a:p><a:r><a:t>Nested</a:t></a:r></a:p></a:ext></a:extLst>
        </a:txBody><a:p><a:r><a:t>Sibling</a:t></a:r></a:p>"#;

    let body = parse_text_body(xml).unwrap();

    assert_eq!(body.body_props.wrap, Some(TextWrap::Square));
    assert_eq!(body.paragraphs.len(), 1);
    let TextRunContent::Run(run) = &body.paragraphs[0].runs[0] else {
        panic!("expected text run");
    };
    assert_eq!(run.text, "Visible");
}

// ── Edge case tests ──────────────────────────────────────────

#[test]
fn parse_run_props_empty_element() {
    let xml = b"<a:rPr/>";
    let props = parse_run_props(xml);
    assert!(props.size.is_none());
    assert!(props.bold.is_none());
    assert!(props.latin.is_none());
    assert!(props.color.is_none());
}

#[test]
fn parse_para_props_empty_element() {
    let xml = b"<a:pPr/>";
    let props = parse_para_props(xml);
    assert!(props.align.is_none());
    assert!(props.bullet.is_none());
    assert!(props.line_spacing.is_none());
}

#[test]
fn parse_body_props_empty_element() {
    let xml = b"<a:bodyPr/>";
    let props = parse_body_props(xml);
    assert!(props.rot.is_none());
    assert!(props.vert.is_none());
    assert!(props.autofit.is_none());
}

#[test]
fn parse_paragraph_empty() {
    let xml = b"<a:p></a:p>";
    let para = parse_paragraph(xml).unwrap();
    assert!(para.runs.is_empty());
    assert!(para.end_para_rpr.is_none());
}

#[test]
fn parse_run_props_text_fill_solid() {
    let xml = br#"<a:rPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr>"#;
    let props = parse_run_props(xml);
    // color should be set from solidFill
    match props.color.as_ref().unwrap() {
        DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
        other => panic!("Expected SrgbClr, got {other:?}"),
    }
    // text_fill should also be set
    match &props.text_fill {
        Some(Fill::Solid(sf)) => match &sf.color {
            DrawingColor::SrgbClr { val, .. } => assert_eq!(val, "FF0000"),
            other => panic!("Expected SrgbClr, got {other:?}"),
        },
        _ => panic!("Expected solid text fill"),
    }
}

#[test]
fn parse_run_props_no_fill() {
    let xml = b"<a:rPr><a:noFill/></a:rPr>";
    let props = parse_run_props(xml);
    assert!(matches!(props.text_fill, Some(Fill::NoFill)));
}

#[test]
fn parse_bullet_size_points() {
    let xml = b"<a:pPr><a:buSzPts val=\"1600\"/><a:buChar char=\"-\"/></a:pPr>";
    let props = parse_para_props(xml);
    let bullet = props.bullet.unwrap();
    assert_eq!(bullet.size, Some(BulletSize::Points(1600)));
}

#[test]
fn parse_bullet_font() {
    let xml = br#"<a:pPr><a:buFont typeface="Wingdings"/><a:buChar char="q"/></a:pPr>"#;
    let props = parse_para_props(xml);
    let bullet = props.bullet.unwrap();
    let font = bullet.font.unwrap();
    assert_eq!(font.typeface, "Wingdings");
}
