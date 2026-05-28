use super::*;

// EMU Constants
// -----------------------------------------------------------------------

#[test]
fn emu_constants() {
    assert_eq!(EMUS_PER_INCH, 914_400);
    assert_eq!(EMUS_PER_CM, 360_000);
    assert_eq!(EMUS_PER_POINT, 12_700);
}

// -----------------------------------------------------------------------
// EditAs
// -----------------------------------------------------------------------

#[test]
fn edit_as_default_is_two_cell() {
    assert_eq!(EditAs::default(), EditAs::TwoCell);
}

#[test]
fn edit_as_roundtrip() {
    let variants = [EditAs::TwoCell, EditAs::OneCell, EditAs::Absolute];
    for v in variants {
        assert_eq!(
            EditAs::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn edit_as_from_ooxml_known() {
    assert_eq!(EditAs::from_ooxml("twoCell"), EditAs::TwoCell);
    assert_eq!(EditAs::from_ooxml("oneCell"), EditAs::OneCell);
    assert_eq!(EditAs::from_ooxml("absolute"), EditAs::Absolute);
}

#[test]
fn edit_as_from_ooxml_unknown_defaults_to_two_cell() {
    assert_eq!(EditAs::from_ooxml(""), EditAs::TwoCell);
    assert_eq!(EditAs::from_ooxml("bogus"), EditAs::TwoCell);
}

// -----------------------------------------------------------------------
// ShapePreset
// -----------------------------------------------------------------------

#[test]
fn shape_preset_default_is_rect() {
    assert_eq!(ShapePreset::default(), ShapePreset::Rect);
}

#[test]
fn shape_preset_roundtrip_all_variants() {
    let variants = ShapePreset::all_variants();
    assert_eq!(variants.len(), SHAPE_PRESET_COUNT);
    for &v in variants {
        let ooxml = v.to_ooxml();
        let parsed = ShapePreset::from_ooxml(ooxml);
        assert_eq!(
            parsed,
            Some(v),
            "roundtrip failed for {v:?} (ooxml={ooxml})"
        );
    }
}

#[test]
fn shape_preset_all_variants_are_unique() {
    let mut seen = std::collections::HashSet::new();
    for &v in ShapePreset::all_variants() {
        assert!(seen.insert(v), "duplicate ShapePreset variant: {v:?}");
    }
}

#[test]
fn shape_preset_canonical_tokens_are_unique() {
    let mut seen = std::collections::HashSet::new();
    for &v in ShapePreset::all_variants() {
        let token = v.to_ooxml();
        assert!(seen.insert(token), "duplicate ShapePreset token: {token}");
        assert_eq!(
            ShapePreset::from_ooxml(token),
            Some(v),
            "canonical token did not parse back to {v:?}"
        );
    }
}

#[test]
fn shape_preset_from_ooxml_unknown_returns_none() {
    assert_eq!(ShapePreset::from_ooxml(""), None);
    assert_eq!(ShapePreset::from_ooxml("bogus"), None);
    assert_eq!(ShapePreset::from_ooxml("Rect"), None);
    assert_eq!(ShapePreset::from_ooxml("RECT"), None);
    assert_eq!(ShapePreset::from_ooxml(" rect"), None);
    assert_eq!(ShapePreset::from_ooxml("rect "), None);
}

#[test]
fn shape_preset_plus_and_math_plus() {
    // "plus" (cross shape) and "mathPlus" (math operator) are distinct shapes.
    assert_eq!(ShapePreset::from_ooxml("plus"), Some(ShapePreset::Plus));
    assert_eq!(
        ShapePreset::from_ooxml("mathPlus"),
        Some(ShapePreset::MathPlus)
    );
    assert_eq!(ShapePreset::Plus.to_ooxml(), "plus");
    assert_eq!(ShapePreset::MathPlus.to_ooxml(), "mathPlus");
}

#[test]
fn shape_preset_flowchart_data_alias() {
    // Historical: "flowChartData" maps to FlowChartInputOutput.
    assert_eq!(
        ShapePreset::from_ooxml("flowChartData"),
        Some(ShapePreset::FlowChartInputOutput)
    );
    // Canonical name roundtrips correctly.
    assert_eq!(
        ShapePreset::FlowChartInputOutput.to_ooxml(),
        "flowChartInputOutput"
    );
    assert_ne!(
        ShapePreset::FlowChartInputOutput.to_ooxml(),
        "flowChartData"
    );
    assert!(
        !ShapePreset::all_variants()
            .iter()
            .any(|v| v.to_ooxml() == "flowChartData"),
        "read alias must not appear in canonical shape presets"
    );
}

#[test]
fn shape_preset_specific_ooxml_values() {
    // Verify specific OOXML strings that differ from variant names.
    assert_eq!(ShapePreset::RightTriangle.to_ooxml(), "rtTriangle");
    assert_eq!(ShapePreset::Lightning.to_ooxml(), "lightningBolt");
    assert_eq!(ShapePreset::Brace.to_ooxml(), "bracePair");
    assert_eq!(ShapePreset::Bracket.to_ooxml(), "bracketPair");
    assert_eq!(ShapePreset::UTurnArrow.to_ooxml(), "uturnArrow");
}

#[test]
fn shape_preset_serde_roundtrip() {
    // Verify serde serialization matches OOXML names.
    for &v in ShapePreset::all_variants() {
        let json = serde_json::to_string(&v).unwrap();
        // JSON string includes quotes, strip them to get raw name.
        let serde_name = json.trim_matches('"');
        let ooxml_name = v.to_ooxml();
        assert_eq!(
            serde_name, ooxml_name,
            "serde name mismatch for {v:?}: serde={serde_name}, ooxml={ooxml_name}"
        );
        // Deserialize back.
        let deserialized: ShapePreset = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, v, "serde roundtrip failed for {v:?}");
    }
}

#[test]
fn shape_preset_serde_deserializes_all_canonical_tokens() {
    for &v in ShapePreset::all_variants() {
        let json = format!("\"{}\"", v.to_ooxml());
        let deserialized: ShapePreset = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, v, "serde deserialize failed for {json}");
    }
}

#[test]
fn shape_preset_serde_rejects_read_alias() {
    assert!(serde_json::from_str::<ShapePreset>("\"flowChartData\"").is_err());
}

#[test]
fn shape_preset_spec_xml_roundtrip() {
    // Read the OOXML spec XML and verify all shape names are covered.
    let spec_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../spec/ecma-376/part1/presetShapeDefinitions.xml"
    );
    let spec_path = std::path::Path::new(spec_path);
    if !spec_path.exists() {
        eprintln!("skipping shape preset spec coverage check; internal ECMA-376 corpus is absent");
        return;
    }
    let xml =
        std::fs::read_to_string(spec_path).expect("presetShapeDefinitions.xml should be readable");

    // Extract top-level element names: lines matching `<someName ` or `<someName>`
    // that are direct children of <presetShapeDefinitons>.
    let mut spec_names: Vec<&str> = Vec::new();
    for line in xml.lines() {
        let trimmed = line.trim();
        // Top-level shape elements start with `<` followed by a lowercase letter,
        // and are indented exactly 2 spaces (direct children of root).
        if line.starts_with("  <") && !line.starts_with("  </") && !line.starts_with("  <?") {
            if let Some(name) = trimmed.strip_prefix('<') {
                // Extract the element name (up to space, >, or /)
                let end = name
                    .find(|c: char| c == ' ' || c == '>' || c == '/')
                    .unwrap_or(name.len());
                let name = &name[..end];
                // Only lowercase-starting names (skip XML processing instructions etc.)
                if name.starts_with(|c: char| c.is_ascii_lowercase()) {
                    spec_names.push(name);
                }
            }
        }
    }

    // Deduplicate (upDownArrow appears twice in the spec XML).
    spec_names.sort();
    spec_names.dedup();

    assert_eq!(
        spec_names.len(),
        187,
        "Expected 187 unique OOXML shape names in spec XML, got {}",
        spec_names.len()
    );

    // Verify every spec name roundtrips through from_ooxml/to_ooxml.
    for name in &spec_names {
        let variant = ShapePreset::from_ooxml(name)
            .unwrap_or_else(|| panic!("from_ooxml({name:?}) returned None — missing variant"));
        let back = variant.to_ooxml();
        assert_eq!(back, *name, "to_ooxml() mismatch for {name}: got {back}");
    }
}

// -----------------------------------------------------------------------
// DashStyle
// -----------------------------------------------------------------------

#[test]
fn dash_style_default_is_solid() {
    assert_eq!(DashStyle::default(), DashStyle::Solid);
}

#[test]
fn dash_style_roundtrip() {
    let variants = [
        DashStyle::Solid,
        DashStyle::Dot,
        DashStyle::Dash,
        DashStyle::DashDot,
        DashStyle::LongDash,
        DashStyle::LongDashDot,
        DashStyle::LongDashDotDot,
        DashStyle::SystemDash,
        DashStyle::SystemDot,
        DashStyle::SystemDashDot,
        DashStyle::SystemDashDotDot,
    ];
    for v in variants {
        assert_eq!(
            DashStyle::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn dash_style_from_ooxml_unknown_defaults_to_solid() {
    assert_eq!(DashStyle::from_ooxml(""), DashStyle::Solid);
    assert_eq!(DashStyle::from_ooxml("bogus"), DashStyle::Solid);
}

#[test]
fn dash_style_specific_ooxml_values() {
    assert_eq!(DashStyle::LongDash.to_ooxml(), "lgDash");
    assert_eq!(DashStyle::LongDashDot.to_ooxml(), "lgDashDot");
    assert_eq!(DashStyle::LongDashDotDot.to_ooxml(), "lgDashDotDot");
    assert_eq!(DashStyle::SystemDash.to_ooxml(), "sysDash");
    assert_eq!(DashStyle::SystemDot.to_ooxml(), "sysDot");
    assert_eq!(DashStyle::SystemDashDot.to_ooxml(), "sysDashDot");
    assert_eq!(DashStyle::SystemDashDotDot.to_ooxml(), "sysDashDotDot");
}

// -----------------------------------------------------------------------
// CompoundLine
// -----------------------------------------------------------------------

#[test]
fn compound_line_default_is_single() {
    assert_eq!(CompoundLine::default(), CompoundLine::Single);
}

#[test]
fn compound_line_roundtrip() {
    let variants = [
        CompoundLine::Single,
        CompoundLine::Double,
        CompoundLine::ThickThin,
        CompoundLine::ThinThick,
        CompoundLine::Triple,
    ];
    for v in variants {
        assert_eq!(
            CompoundLine::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn compound_line_from_ooxml_unknown_defaults_to_single() {
    assert_eq!(CompoundLine::from_ooxml(""), CompoundLine::Single);
    assert_eq!(CompoundLine::from_ooxml("bogus"), CompoundLine::Single);
}

#[test]
fn compound_line_specific_ooxml_values() {
    assert_eq!(CompoundLine::Single.to_ooxml(), "sng");
    assert_eq!(CompoundLine::Double.to_ooxml(), "dbl");
    assert_eq!(CompoundLine::Triple.to_ooxml(), "tri");
}

// -----------------------------------------------------------------------
// LineCap
// -----------------------------------------------------------------------

#[test]
fn line_cap_default_is_flat() {
    assert_eq!(LineCap::default(), LineCap::Flat);
}

#[test]
fn line_cap_roundtrip() {
    let variants = [LineCap::Flat, LineCap::Square, LineCap::Round];
    for v in variants {
        assert_eq!(
            LineCap::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn line_cap_from_ooxml_unknown_defaults_to_flat() {
    assert_eq!(LineCap::from_ooxml(""), LineCap::Flat);
    assert_eq!(LineCap::from_ooxml("bogus"), LineCap::Flat);
}

#[test]
fn line_cap_specific_ooxml_values() {
    assert_eq!(LineCap::Square.to_ooxml(), "sq");
    assert_eq!(LineCap::Round.to_ooxml(), "rnd");
}

// -----------------------------------------------------------------------
// CompressionState
// -----------------------------------------------------------------------

#[test]
fn compression_state_default_is_none() {
    assert_eq!(CompressionState::default(), CompressionState::None);
}

#[test]
fn compression_state_roundtrip() {
    let variants = [
        CompressionState::None,
        CompressionState::Print,
        CompressionState::Screen,
        CompressionState::Email,
    ];
    for v in variants {
        assert_eq!(
            CompressionState::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn compression_state_from_ooxml_unknown_defaults_to_none() {
    assert_eq!(CompressionState::from_ooxml(""), CompressionState::None);
    assert_eq!(
        CompressionState::from_ooxml("bogus"),
        CompressionState::None
    );
}

// -----------------------------------------------------------------------
// TextAnchor
// -----------------------------------------------------------------------

#[test]
fn text_anchor_default_is_top() {
    assert_eq!(TextAnchor::default(), TextAnchor::Top);
}

#[test]
fn text_anchor_roundtrip() {
    let variants = [
        TextAnchor::Top,
        TextAnchor::Center,
        TextAnchor::Bottom,
        TextAnchor::Justified,
        TextAnchor::Distributed,
    ];
    for v in variants {
        assert_eq!(
            TextAnchor::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_anchor_from_ooxml_unknown_defaults_to_top() {
    assert_eq!(TextAnchor::from_ooxml(""), TextAnchor::Top);
    assert_eq!(TextAnchor::from_ooxml("bogus"), TextAnchor::Top);
}

#[test]
fn text_anchor_specific_ooxml_values() {
    assert_eq!(TextAnchor::Top.to_ooxml(), "t");
    assert_eq!(TextAnchor::Center.to_ooxml(), "ctr");
    assert_eq!(TextAnchor::Bottom.to_ooxml(), "b");
    assert_eq!(TextAnchor::Justified.to_ooxml(), "just");
    assert_eq!(TextAnchor::Distributed.to_ooxml(), "dist");
}

// -----------------------------------------------------------------------
// TextWrap
// -----------------------------------------------------------------------

#[test]
fn text_wrap_default_is_none() {
    assert_eq!(TextWrap::default(), TextWrap::None);
}

#[test]
fn text_wrap_roundtrip() {
    let variants = [TextWrap::None, TextWrap::Square];
    for v in variants {
        assert_eq!(
            TextWrap::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_wrap_from_ooxml_unknown_defaults_to_none() {
    assert_eq!(TextWrap::from_ooxml(""), TextWrap::None);
    assert_eq!(TextWrap::from_ooxml("tight"), TextWrap::None);
}

// -----------------------------------------------------------------------
// TextAlign
// -----------------------------------------------------------------------

#[test]
fn text_align_default_is_left() {
    assert_eq!(TextAlign::default(), TextAlign::Left);
}

#[test]
fn text_align_roundtrip() {
    let variants = [
        TextAlign::Left,
        TextAlign::Center,
        TextAlign::Right,
        TextAlign::Justify,
        TextAlign::JustifyLow,
        TextAlign::Distributed,
        TextAlign::ThaiDistributed,
    ];
    for v in variants {
        assert_eq!(
            TextAlign::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn text_align_from_ooxml_unknown_defaults_to_left() {
    assert_eq!(TextAlign::from_ooxml(""), TextAlign::Left);
    assert_eq!(TextAlign::from_ooxml("bogus"), TextAlign::Left);
}

#[test]
fn text_align_specific_ooxml_values() {
    assert_eq!(TextAlign::Left.to_ooxml(), "l");
    assert_eq!(TextAlign::Center.to_ooxml(), "ctr");
    assert_eq!(TextAlign::Right.to_ooxml(), "r");
    assert_eq!(TextAlign::Justify.to_ooxml(), "just");
    assert_eq!(TextAlign::JustifyLow.to_ooxml(), "justLow");
    assert_eq!(TextAlign::Distributed.to_ooxml(), "dist");
    assert_eq!(TextAlign::ThaiDistributed.to_ooxml(), "thaiDist");
}

// -----------------------------------------------------------------------
// SchemeColor
// -----------------------------------------------------------------------

#[test]
fn scheme_color_default_is_dk1() {
    assert_eq!(SchemeColor::default(), SchemeColor::Dk1);
}

#[test]
fn scheme_color_roundtrip() {
    let variants = [
        SchemeColor::Dk1,
        SchemeColor::Lt1,
        SchemeColor::Dk2,
        SchemeColor::Lt2,
        SchemeColor::Accent1,
        SchemeColor::Accent2,
        SchemeColor::Accent3,
        SchemeColor::Accent4,
        SchemeColor::Accent5,
        SchemeColor::Accent6,
        SchemeColor::Hlink,
        SchemeColor::FolHlink,
    ];
    for v in variants {
        let ooxml = v.to_ooxml();
        assert_eq!(
            SchemeColor::from_ooxml(ooxml),
            Some(v),
            "roundtrip failed for {v:?}"
        );
    }
}

#[test]
fn scheme_color_from_ooxml_unknown_returns_none() {
    assert_eq!(SchemeColor::from_ooxml(""), None);
    assert_eq!(SchemeColor::from_ooxml("bogus"), None);
}

#[test]
fn scheme_color_theme_index_roundtrip() {
    for idx in 0..12 {
        let color = SchemeColor::from_theme_index(idx).unwrap();
        assert_eq!(color.to_theme_index(), idx);
    }
    assert_eq!(SchemeColor::from_theme_index(12), None);
    assert_eq!(SchemeColor::from_theme_index(u32::MAX), None);
}

#[test]
fn scheme_color_theme_index_values() {
    assert_eq!(SchemeColor::Dk1.to_theme_index(), 0);
    assert_eq!(SchemeColor::Lt1.to_theme_index(), 1);
    assert_eq!(SchemeColor::Accent1.to_theme_index(), 4);
    assert_eq!(SchemeColor::FolHlink.to_theme_index(), 11);
}

// -----------------------------------------------------------------------
