use super::*;
use crate::write::from_parse_output::styles::build_styles;
use ooxml_types::styles::{FillDef, PatternType};

fn lowered_fill(fill: FillFormat) -> FillDef {
    let writer = build_styles(&[DocumentFormat {
        fill: Some(fill),
        ..Default::default()
    }]);
    let fill_id = writer.cell_xfs[0]
        .fill_id
        .expect("cell XF must have fillId") as usize;
    writer.fills[fill_id].clone()
}

#[test]
fn explicit_none_lowers_to_no_fill_even_with_stale_colors() {
    let fill = lowered_fill(FillFormat {
        pattern_type: Some("none".to_string()),
        background_color: Some("#112233".to_string()),
        pattern_foreground_color: Some("#445566".to_string()),
        ..Default::default()
    });

    assert_eq!(fill, FillDef::None);
}

#[test]
fn background_color_without_pattern_is_solid_shorthand() {
    let fill = lowered_fill(FillFormat {
        background_color: Some("#112233".to_string()),
        background_color_tint: Some(0.25),
        ..Default::default()
    });

    assert_eq!(
        fill,
        FillDef::Solid {
            fg_color: ColorDef::Rgb {
                val: "FF112233".to_string(),
                tint: Some("0.25".to_string()),
            },
        }
    );
}

#[test]
fn explicit_solid_maps_domain_background_to_ooxml_foreground() {
    let fill = lowered_fill(FillFormat {
        pattern_type: Some("solid".to_string()),
        background_color: Some("#112233".to_string()),
        background_color_tint: Some(-0.2),
        // This field belongs only to patterned fills and must not displace the
        // visible solid background color.
        pattern_foreground_color: Some("#AABBCC".to_string()),
        pattern_foreground_color_tint: Some(0.4),
        ..Default::default()
    });

    assert_eq!(
        fill,
        FillDef::Solid {
            fg_color: ColorDef::Rgb {
                val: "FF112233".to_string(),
                tint: Some("-0.2".to_string()),
            },
        }
    );
}

#[test]
fn every_non_solid_pattern_maps_foreground_and_background_roles() {
    let patterns = [
        ("mediumGray", PatternType::MediumGray),
        ("darkGray", PatternType::DarkGray),
        ("lightGray", PatternType::LightGray),
        ("darkHorizontal", PatternType::DarkHorizontal),
        ("darkVertical", PatternType::DarkVertical),
        ("darkDown", PatternType::DarkDown),
        ("darkUp", PatternType::DarkUp),
        ("darkGrid", PatternType::DarkGrid),
        ("darkTrellis", PatternType::DarkTrellis),
        ("lightHorizontal", PatternType::LightHorizontal),
        ("lightVertical", PatternType::LightVertical),
        ("lightDown", PatternType::LightDown),
        ("lightUp", PatternType::LightUp),
        ("lightGrid", PatternType::LightGrid),
        ("lightTrellis", PatternType::LightTrellis),
        ("gray125", PatternType::Gray125),
        ("gray0625", PatternType::Gray0625),
    ];

    for (token, pattern_type) in patterns {
        let fill = lowered_fill(FillFormat {
            pattern_type: Some(token.to_string()),
            pattern_foreground_color: Some("#112233".to_string()),
            pattern_foreground_color_tint: Some(0.25),
            background_color: Some("#AABBCC".to_string()),
            background_color_tint: Some(-0.2),
            ..Default::default()
        });

        assert_eq!(
            fill,
            FillDef::Pattern {
                pattern_type: Some(pattern_type),
                fg_color: Some(ColorDef::Rgb {
                    val: "FF112233".to_string(),
                    tint: Some("0.25".to_string()),
                }),
                bg_color: Some(ColorDef::Rgb {
                    val: "FFAABBCC".to_string(),
                    tint: Some("-0.2".to_string()),
                }),
            },
            "incorrect lowering for {token}"
        );
    }
}

#[test]
fn unknown_explicit_pattern_never_falls_back_to_solid() {
    let fill = lowered_fill(FillFormat {
        pattern_type: Some("futurePattern".to_string()),
        pattern_foreground_color: Some("#112233".to_string()),
        background_color: Some("#AABBCC".to_string()),
        ..Default::default()
    });

    assert_eq!(
        fill,
        FillDef::Pattern {
            pattern_type: None,
            fg_color: Some(ColorDef::Rgb {
                val: "FF112233".to_string(),
                tint: None,
            }),
            bg_color: Some(ColorDef::Rgb {
                val: "FFAABBCC".to_string(),
                tint: None,
            }),
        }
    );
}

#[test]
fn pattern_foreground_without_pattern_does_not_infer_solid() {
    let fill = lowered_fill(FillFormat {
        pattern_foreground_color: Some("#112233".to_string()),
        ..Default::default()
    });

    assert!(matches!(
        fill,
        FillDef::Pattern {
            pattern_type: None,
            fg_color: Some(_),
            bg_color: None,
        }
    ));
}
