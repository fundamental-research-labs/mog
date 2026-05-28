use super::*;

fn all_scheme_colors() -> &'static [(SchemeColor, &'static str)] {
    &[
        (SchemeColor::Dk1, "dk1"),
        (SchemeColor::Lt1, "lt1"),
        (SchemeColor::Dk2, "dk2"),
        (SchemeColor::Lt2, "lt2"),
        (SchemeColor::Accent1, "accent1"),
        (SchemeColor::Accent2, "accent2"),
        (SchemeColor::Accent3, "accent3"),
        (SchemeColor::Accent4, "accent4"),
        (SchemeColor::Accent5, "accent5"),
        (SchemeColor::Accent6, "accent6"),
        (SchemeColor::Hlink, "hlink"),
        (SchemeColor::FolHlink, "folHlink"),
        (SchemeColor::Bg1, "bg1"),
        (SchemeColor::Bg2, "bg2"),
        (SchemeColor::Tx1, "tx1"),
        (SchemeColor::Tx2, "tx2"),
        (SchemeColor::PhClr, "phClr"),
    ]
}

#[test]
fn scheme_color_contract() {
    assert_eq!(SchemeColor::default(), SchemeColor::Dk1);

    for &(variant, token) in all_scheme_colors() {
        assert_eq!(variant.to_ooxml(), token);
        assert_eq!(SchemeColor::from_ooxml(token), Some(variant));
        assert_eq!(SchemeColor::from_ooxml(variant.to_ooxml()), Some(variant));
    }

    assert_eq!(
        SchemeColor::from_ooxml("folHlink"),
        Some(SchemeColor::FolHlink)
    );
    assert_eq!(SchemeColor::from_ooxml("phClr"), Some(SchemeColor::PhClr));

    for token in ["", "bogus", "DK1", " dk1"] {
        assert_eq!(SchemeColor::from_ooxml(token), None);
    }

    let indexed = [
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
    for (idx, expected) in indexed.into_iter().enumerate() {
        assert_eq!(SchemeColor::from_theme_index(idx as u32), Some(expected));
    }
    assert_eq!(SchemeColor::from_theme_index(12), None);
    assert_eq!(SchemeColor::from_theme_index(u32::MAX), None);

    assert_eq!(SchemeColor::Bg1.to_theme_index(), 1);
    assert_eq!(SchemeColor::Bg2.to_theme_index(), 3);
    assert_eq!(SchemeColor::Tx1.to_theme_index(), 0);
    assert_eq!(SchemeColor::Tx2.to_theme_index(), 2);
    assert_eq!(SchemeColor::PhClr.to_theme_index(), 12);
}

fn all_color_transforms(val: i32) -> Vec<(ColorTransform, &'static str, Option<i32>)> {
    vec![
        (ColorTransform::Alpha { val }, "alpha", Some(val)),
        (ColorTransform::AlphaOff { val }, "alphaOff", Some(val)),
        (ColorTransform::AlphaMod { val }, "alphaMod", Some(val)),
        (ColorTransform::Hue { val }, "hue", Some(val)),
        (ColorTransform::HueOff { val }, "hueOff", Some(val)),
        (ColorTransform::HueMod { val }, "hueMod", Some(val)),
        (ColorTransform::Sat { val }, "sat", Some(val)),
        (ColorTransform::SatOff { val }, "satOff", Some(val)),
        (ColorTransform::SatMod { val }, "satMod", Some(val)),
        (ColorTransform::Lum { val }, "lum", Some(val)),
        (ColorTransform::LumOff { val }, "lumOff", Some(val)),
        (ColorTransform::LumMod { val }, "lumMod", Some(val)),
        (ColorTransform::Red { val }, "red", Some(val)),
        (ColorTransform::RedOff { val }, "redOff", Some(val)),
        (ColorTransform::RedMod { val }, "redMod", Some(val)),
        (ColorTransform::Green { val }, "green", Some(val)),
        (ColorTransform::GreenOff { val }, "greenOff", Some(val)),
        (ColorTransform::GreenMod { val }, "greenMod", Some(val)),
        (ColorTransform::Blue { val }, "blue", Some(val)),
        (ColorTransform::BlueOff { val }, "blueOff", Some(val)),
        (ColorTransform::BlueMod { val }, "blueMod", Some(val)),
        (ColorTransform::Tint { val }, "tint", Some(val)),
        (ColorTransform::Shade { val }, "shade", Some(val)),
        (ColorTransform::Comp, "comp", None),
        (ColorTransform::Inv, "inv", None),
        (ColorTransform::Gray, "gray", None),
        (ColorTransform::Gamma, "gamma", None),
        (ColorTransform::InvGamma, "invGamma", None),
    ]
}

#[test]
fn color_transform_contract() {
    for (transform, name, val) in all_color_transforms(12345) {
        assert_eq!(transform.to_ooxml_name(), name);
        assert_eq!(transform.val(), val);
    }

    let defaults = [
        ("alpha", ColorTransform::Alpha { val: 100000 }),
        ("alphaOff", ColorTransform::AlphaOff { val: 0 }),
        ("alphaMod", ColorTransform::AlphaMod { val: 100000 }),
        ("hue", ColorTransform::Hue { val: 0 }),
        ("hueOff", ColorTransform::HueOff { val: 0 }),
        ("hueMod", ColorTransform::HueMod { val: 100000 }),
        ("sat", ColorTransform::Sat { val: 100000 }),
        ("satOff", ColorTransform::SatOff { val: 0 }),
        ("satMod", ColorTransform::SatMod { val: 100000 }),
        ("lum", ColorTransform::Lum { val: 100000 }),
        ("lumOff", ColorTransform::LumOff { val: 0 }),
        ("lumMod", ColorTransform::LumMod { val: 100000 }),
        ("red", ColorTransform::Red { val: 0 }),
        ("redOff", ColorTransform::RedOff { val: 0 }),
        ("redMod", ColorTransform::RedMod { val: 100000 }),
        ("green", ColorTransform::Green { val: 0 }),
        ("greenOff", ColorTransform::GreenOff { val: 0 }),
        ("greenMod", ColorTransform::GreenMod { val: 100000 }),
        ("blue", ColorTransform::Blue { val: 0 }),
        ("blueOff", ColorTransform::BlueOff { val: 0 }),
        ("blueMod", ColorTransform::BlueMod { val: 100000 }),
        ("tint", ColorTransform::Tint { val: 100000 }),
        ("shade", ColorTransform::Shade { val: 100000 }),
        ("comp", ColorTransform::Comp),
        ("inv", ColorTransform::Inv),
        ("gray", ColorTransform::Gray),
        ("gamma", ColorTransform::Gamma),
        ("invGamma", ColorTransform::InvGamma),
    ];
    for (name, expected) in defaults {
        assert_eq!(ColorTransform::from_ooxml(name, None), Some(expected));
    }

    for name in ["comp", "inv", "gray", "gamma", "invGamma"] {
        assert_eq!(
            ColorTransform::from_ooxml(name, Some(777)).unwrap().val(),
            None
        );
    }
    for name in ["", "bogus", "ALPHA", " alpha"] {
        assert_eq!(ColorTransform::from_ooxml(name, None), None);
    }

    for transform in [ColorTransform::Tint { val: 40000 }, ColorTransform::Gray] {
        let json = serde_json::to_string(&transform).unwrap();
        let round_trip: ColorTransform = serde_json::from_str(&json).unwrap();
        assert_eq!(round_trip, transform);
    }
}

fn all_system_colors() -> &'static [(SystemColorVal, &'static str)] {
    &[
        (SystemColorVal::ScrollBar, "scrollBar"),
        (SystemColorVal::Background, "background"),
        (SystemColorVal::ActiveCaption, "activeCaption"),
        (SystemColorVal::InactiveCaption, "inactiveCaption"),
        (SystemColorVal::Menu, "menu"),
        (SystemColorVal::Window, "window"),
        (SystemColorVal::WindowFrame, "windowFrame"),
        (SystemColorVal::MenuText, "menuText"),
        (SystemColorVal::WindowText, "windowText"),
        (SystemColorVal::CaptionText, "captionText"),
        (SystemColorVal::ActiveBorder, "activeBorder"),
        (SystemColorVal::InactiveBorder, "inactiveBorder"),
        (SystemColorVal::AppWorkspace, "appWorkspace"),
        (SystemColorVal::Highlight, "highlight"),
        (SystemColorVal::HighlightText, "highlightText"),
        (SystemColorVal::BtnFace, "btnFace"),
        (SystemColorVal::BtnShadow, "btnShadow"),
        (SystemColorVal::GrayText, "grayText"),
        (SystemColorVal::BtnText, "btnText"),
        (SystemColorVal::InactiveCaptionText, "inactiveCaptionText"),
        (SystemColorVal::BtnHighlight, "btnHighlight"),
        (SystemColorVal::ThreeDDkShadow, "3dDkShadow"),
        (SystemColorVal::ThreeDLight, "3dLight"),
        (SystemColorVal::InfoText, "infoText"),
        (SystemColorVal::InfoBk, "infoBk"),
        (SystemColorVal::HotLight, "hotLight"),
        (
            SystemColorVal::GradientActiveCaption,
            "gradientActiveCaption",
        ),
        (
            SystemColorVal::GradientInactiveCaption,
            "gradientInactiveCaption",
        ),
        (SystemColorVal::MenuHighlight, "menuHighlight"),
        (SystemColorVal::MenuBar, "menuBar"),
    ]
}

#[test]
fn system_color_contract() {
    for &(variant, token) in all_system_colors() {
        assert_eq!(variant.to_ooxml(), token);
        assert_eq!(SystemColorVal::from_ooxml(token), variant);
        assert_eq!(SystemColorVal::from_ooxml(variant.to_ooxml()), variant);
    }
    assert_eq!(
        SystemColorVal::from_ooxml("3dDkShadow"),
        SystemColorVal::ThreeDDkShadow
    );
    assert_eq!(
        SystemColorVal::from_ooxml("3dLight"),
        SystemColorVal::ThreeDLight
    );
    for token in ["", "bogus", "WINDOW", " window"] {
        assert_eq!(SystemColorVal::from_ooxml(token), SystemColorVal::Window);
    }
}

fn all_preset_colors() -> &'static [(PresetColorVal, &'static str)] {
    &[
        (PresetColorVal::AliceBlue, "aliceBlue"),
        (PresetColorVal::AntiqueWhite, "antiqueWhite"),
        (PresetColorVal::Aqua, "aqua"),
        (PresetColorVal::Aquamarine, "aquamarine"),
        (PresetColorVal::Azure, "azure"),
        (PresetColorVal::Beige, "beige"),
        (PresetColorVal::Bisque, "bisque"),
        (PresetColorVal::Black, "black"),
        (PresetColorVal::BlanchedAlmond, "blanchedAlmond"),
        (PresetColorVal::Blue, "blue"),
        (PresetColorVal::BlueViolet, "blueViolet"),
        (PresetColorVal::Brown, "brown"),
        (PresetColorVal::BurlyWood, "burlyWood"),
        (PresetColorVal::CadetBlue, "cadetBlue"),
        (PresetColorVal::Chartreuse, "chartreuse"),
        (PresetColorVal::Chocolate, "chocolate"),
        (PresetColorVal::Coral, "coral"),
        (PresetColorVal::CornflowerBlue, "cornflowerBlue"),
        (PresetColorVal::Cornsilk, "cornsilk"),
        (PresetColorVal::Crimson, "crimson"),
        (PresetColorVal::Cyan, "cyan"),
        (PresetColorVal::DkBlue, "dkBlue"),
        (PresetColorVal::DkCyan, "dkCyan"),
        (PresetColorVal::DkGoldenrod, "dkGoldenrod"),
        (PresetColorVal::DkGray, "dkGray"),
        (PresetColorVal::DkGreen, "dkGreen"),
        (PresetColorVal::DkKhaki, "dkKhaki"),
        (PresetColorVal::DkMagenta, "dkMagenta"),
        (PresetColorVal::DkOliveGreen, "dkOliveGreen"),
        (PresetColorVal::DkOrange, "dkOrange"),
        (PresetColorVal::DkOrchid, "dkOrchid"),
        (PresetColorVal::DkRed, "dkRed"),
        (PresetColorVal::DkSalmon, "dkSalmon"),
        (PresetColorVal::DkSeaGreen, "dkSeaGreen"),
        (PresetColorVal::DkSlateBlue, "dkSlateBlue"),
        (PresetColorVal::DkSlateGray, "dkSlateGray"),
        (PresetColorVal::DkTurquoise, "dkTurquoise"),
        (PresetColorVal::DkViolet, "dkViolet"),
        (PresetColorVal::DeepPink, "deepPink"),
        (PresetColorVal::DeepSkyBlue, "deepSkyBlue"),
        (PresetColorVal::DimGray, "dimGray"),
        (PresetColorVal::DodgerBlue, "dodgerBlue"),
        (PresetColorVal::Firebrick, "firebrick"),
        (PresetColorVal::FloralWhite, "floralWhite"),
        (PresetColorVal::ForestGreen, "forestGreen"),
        (PresetColorVal::Fuchsia, "fuchsia"),
        (PresetColorVal::Gainsboro, "gainsboro"),
        (PresetColorVal::GhostWhite, "ghostWhite"),
        (PresetColorVal::Gold, "gold"),
        (PresetColorVal::Goldenrod, "goldenrod"),
        (PresetColorVal::Gray, "gray"),
        (PresetColorVal::Green, "green"),
        (PresetColorVal::GreenYellow, "greenYellow"),
        (PresetColorVal::Honeydew, "honeydew"),
        (PresetColorVal::HotPink, "hotPink"),
        (PresetColorVal::IndianRed, "indianRed"),
        (PresetColorVal::Indigo, "indigo"),
        (PresetColorVal::Ivory, "ivory"),
        (PresetColorVal::Khaki, "khaki"),
        (PresetColorVal::Lavender, "lavender"),
        (PresetColorVal::LavenderBlush, "lavenderBlush"),
        (PresetColorVal::LawnGreen, "lawnGreen"),
        (PresetColorVal::LemonChiffon, "lemonChiffon"),
        (PresetColorVal::LtBlue, "ltBlue"),
        (PresetColorVal::LtCoral, "ltCoral"),
        (PresetColorVal::LtCyan, "ltCyan"),
        (PresetColorVal::LtGoldenrodYellow, "ltGoldenrodYellow"),
        (PresetColorVal::LtGray, "ltGray"),
        (PresetColorVal::LtGreen, "ltGreen"),
        (PresetColorVal::LtPink, "ltPink"),
        (PresetColorVal::LtSalmon, "ltSalmon"),
        (PresetColorVal::LtSeaGreen, "ltSeaGreen"),
        (PresetColorVal::LtSkyBlue, "ltSkyBlue"),
        (PresetColorVal::LtSlateGray, "ltSlateGray"),
        (PresetColorVal::LtSteelBlue, "ltSteelBlue"),
        (PresetColorVal::LtYellow, "ltYellow"),
        (PresetColorVal::Lime, "lime"),
        (PresetColorVal::LimeGreen, "limeGreen"),
        (PresetColorVal::Linen, "linen"),
        (PresetColorVal::Magenta, "magenta"),
        (PresetColorVal::Maroon, "maroon"),
        (PresetColorVal::MedAquamarine, "medAquamarine"),
        (PresetColorVal::MedBlue, "medBlue"),
        (PresetColorVal::MedOrchid, "medOrchid"),
        (PresetColorVal::MedPurple, "medPurple"),
        (PresetColorVal::MedSeaGreen, "medSeaGreen"),
        (PresetColorVal::MedSlateBlue, "medSlateBlue"),
        (PresetColorVal::MedSpringGreen, "medSpringGreen"),
        (PresetColorVal::MedTurquoise, "medTurquoise"),
        (PresetColorVal::MedVioletRed, "medVioletRed"),
        (PresetColorVal::MidnightBlue, "midnightBlue"),
        (PresetColorVal::MintCream, "mintCream"),
        (PresetColorVal::MistyRose, "mistyRose"),
        (PresetColorVal::Moccasin, "moccasin"),
        (PresetColorVal::NavajoWhite, "navajoWhite"),
        (PresetColorVal::Navy, "navy"),
        (PresetColorVal::OldLace, "oldLace"),
        (PresetColorVal::Olive, "olive"),
        (PresetColorVal::OliveDrab, "oliveDrab"),
        (PresetColorVal::Orange, "orange"),
        (PresetColorVal::OrangeRed, "orangeRed"),
        (PresetColorVal::Orchid, "orchid"),
        (PresetColorVal::PaleGoldenrod, "paleGoldenrod"),
        (PresetColorVal::PaleGreen, "paleGreen"),
        (PresetColorVal::PaleTurquoise, "paleTurquoise"),
        (PresetColorVal::PaleVioletRed, "paleVioletRed"),
        (PresetColorVal::PapayaWhip, "papayaWhip"),
        (PresetColorVal::PeachPuff, "peachPuff"),
        (PresetColorVal::Peru, "peru"),
        (PresetColorVal::Pink, "pink"),
        (PresetColorVal::Plum, "plum"),
        (PresetColorVal::PowderBlue, "powderBlue"),
        (PresetColorVal::Purple, "purple"),
        (PresetColorVal::Red, "red"),
        (PresetColorVal::RosyBrown, "rosyBrown"),
        (PresetColorVal::RoyalBlue, "royalBlue"),
        (PresetColorVal::SaddleBrown, "saddleBrown"),
        (PresetColorVal::Salmon, "salmon"),
        (PresetColorVal::SandyBrown, "sandyBrown"),
        (PresetColorVal::SeaGreen, "seaGreen"),
        (PresetColorVal::SeaShell, "seaShell"),
        (PresetColorVal::Sienna, "sienna"),
        (PresetColorVal::Silver, "silver"),
        (PresetColorVal::SkyBlue, "skyBlue"),
        (PresetColorVal::SlateBlue, "slateBlue"),
        (PresetColorVal::SlateGray, "slateGray"),
        (PresetColorVal::Snow, "snow"),
        (PresetColorVal::SpringGreen, "springGreen"),
        (PresetColorVal::SteelBlue, "steelBlue"),
        (PresetColorVal::Tan, "tan"),
        (PresetColorVal::Teal, "teal"),
        (PresetColorVal::Thistle, "thistle"),
        (PresetColorVal::Tomato, "tomato"),
        (PresetColorVal::Turquoise, "turquoise"),
        (PresetColorVal::Violet, "violet"),
        (PresetColorVal::Wheat, "wheat"),
        (PresetColorVal::White, "white"),
        (PresetColorVal::WhiteSmoke, "whiteSmoke"),
        (PresetColorVal::Yellow, "yellow"),
        (PresetColorVal::YellowGreen, "yellowGreen"),
    ]
}

#[test]
fn preset_color_contract() {
    let mut canonical_tokens = Vec::new();
    for &(variant, token) in all_preset_colors() {
        assert_eq!(variant.to_ooxml(), token);
        assert_eq!(PresetColorVal::from_ooxml(token), variant);
        assert_eq!(PresetColorVal::from_ooxml(variant.to_ooxml()), variant);
        canonical_tokens.push(token);
    }
    canonical_tokens.sort_unstable();
    canonical_tokens.dedup();
    assert_eq!(canonical_tokens.len(), all_preset_colors().len());

    for token in ["", "bogus", "RED", " red"] {
        assert_eq!(PresetColorVal::from_ooxml(token), PresetColorVal::Black);
    }

    for &(alias, expected) in &[
        ("darkBlue", PresetColorVal::DkBlue),
        ("darkCyan", PresetColorVal::DkCyan),
        ("darkGoldenrod", PresetColorVal::DkGoldenrod),
        ("darkGray", PresetColorVal::DkGray),
        ("darkGreen", PresetColorVal::DkGreen),
        ("darkKhaki", PresetColorVal::DkKhaki),
        ("darkMagenta", PresetColorVal::DkMagenta),
        ("darkOliveGreen", PresetColorVal::DkOliveGreen),
        ("darkOrange", PresetColorVal::DkOrange),
        ("darkOrchid", PresetColorVal::DkOrchid),
        ("darkRed", PresetColorVal::DkRed),
        ("darkSalmon", PresetColorVal::DkSalmon),
        ("darkSeaGreen", PresetColorVal::DkSeaGreen),
        ("darkSlateBlue", PresetColorVal::DkSlateBlue),
        ("darkSlateGray", PresetColorVal::DkSlateGray),
        ("darkTurquoise", PresetColorVal::DkTurquoise),
        ("darkViolet", PresetColorVal::DkViolet),
        ("lightBlue", PresetColorVal::LtBlue),
        ("lightCoral", PresetColorVal::LtCoral),
        ("lightCyan", PresetColorVal::LtCyan),
        ("lightGoldenrodYellow", PresetColorVal::LtGoldenrodYellow),
        ("lightGray", PresetColorVal::LtGray),
        ("lightGreen", PresetColorVal::LtGreen),
        ("lightPink", PresetColorVal::LtPink),
        ("lightSalmon", PresetColorVal::LtSalmon),
        ("lightSeaGreen", PresetColorVal::LtSeaGreen),
        ("lightSkyBlue", PresetColorVal::LtSkyBlue),
        ("lightSlateGray", PresetColorVal::LtSlateGray),
        ("lightSteelBlue", PresetColorVal::LtSteelBlue),
        ("lightYellow", PresetColorVal::LtYellow),
        ("mediumAquamarine", PresetColorVal::MedAquamarine),
        ("mediumBlue", PresetColorVal::MedBlue),
        ("mediumOrchid", PresetColorVal::MedOrchid),
        ("mediumPurple", PresetColorVal::MedPurple),
        ("mediumSeaGreen", PresetColorVal::MedSeaGreen),
        ("mediumSlateBlue", PresetColorVal::MedSlateBlue),
        ("mediumSpringGreen", PresetColorVal::MedSpringGreen),
        ("mediumTurquoise", PresetColorVal::MedTurquoise),
        ("mediumVioletRed", PresetColorVal::MedVioletRed),
        ("grey", PresetColorVal::Gray),
        ("dimGrey", PresetColorVal::DimGray),
        ("dkGrey", PresetColorVal::DkGray),
        ("dkSlateGrey", PresetColorVal::DkSlateGray),
        ("ltGrey", PresetColorVal::LtGray),
        ("ltSlateGrey", PresetColorVal::LtSlateGray),
        ("slateGrey", PresetColorVal::SlateGray),
        ("darkGrey", PresetColorVal::DkGray),
        ("darkSlateGrey", PresetColorVal::DkSlateGray),
        ("lightGrey", PresetColorVal::LtGray),
        ("lightSlateGrey", PresetColorVal::LtSlateGray),
    ] {
        let parsed = PresetColorVal::from_ooxml(alias);
        assert_eq!(parsed, expected);
        assert_ne!(parsed.to_ooxml(), alias);
    }
}

#[test]
fn drawing_color_contract() {
    assert_eq!(
        DrawingColor::default(),
        DrawingColor::SrgbClr {
            val: String::new(),
            transforms: Vec::new(),
        }
    );

    let colors = [
        DrawingColor::SrgbClr {
            val: "112233".to_string(),
            transforms: Vec::new(),
        },
        DrawingColor::SchemeClr {
            val: SchemeColor::Accent1,
            transforms: vec![ColorTransform::Tint { val: 40000 }],
        },
        DrawingColor::HslClr {
            hue: 60000,
            sat: 70000,
            lum: 80000,
            transforms: Vec::new(),
        },
        DrawingColor::SysClr {
            val: SystemColorVal::WindowText,
            last_clr: Some("ABCDEF".to_string()),
            transforms: vec![ColorTransform::LumMod { val: 75000 }],
        },
        DrawingColor::PrstClr {
            val: PresetColorVal::Red,
            transforms: Vec::new(),
        },
        DrawingColor::ScrgbClr {
            r: 10000,
            g: 20000,
            b: 30000,
            transforms: Vec::new(),
        },
    ];

    for color in colors {
        let json = serde_json::to_string(&color).unwrap();
        let round_trip: DrawingColor = serde_json::from_str(&json).unwrap();
        assert_eq!(round_trip, color);
    }

    let empty_transforms = serde_json::to_value(DrawingColor::SrgbClr {
        val: "FFFFFF".to_string(),
        transforms: Vec::new(),
    })
    .unwrap();
    assert!(empty_transforms.get("transforms").is_none());

    let ordered = DrawingColor::SrgbClr {
        val: "FFFFFF".to_string(),
        transforms: vec![
            ColorTransform::Tint { val: 10000 },
            ColorTransform::Shade { val: 20000 },
        ],
    };
    let round_trip: DrawingColor =
        serde_json::from_str(&serde_json::to_string(&ordered).unwrap()).unwrap();
    assert_eq!(round_trip, ordered);
}
