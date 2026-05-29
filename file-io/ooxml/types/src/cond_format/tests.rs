use super::*;

// -----------------------------------------------------------------------
// CfOperator
// -----------------------------------------------------------------------

#[test]
fn cf_operator_default() {
    assert_eq!(CfOperator::default(), CfOperator::LessThan);
}

#[test]
fn cf_operator_roundtrip() {
    let all = [
        CfOperator::LessThan,
        CfOperator::LessThanOrEqual,
        CfOperator::Equal,
        CfOperator::NotEqual,
        CfOperator::GreaterThanOrEqual,
        CfOperator::GreaterThan,
        CfOperator::Between,
        CfOperator::NotBetween,
        CfOperator::ContainsText,
        CfOperator::NotContains,
        CfOperator::BeginsWith,
        CfOperator::EndsWith,
    ];
    for v in all {
        assert_eq!(
            CfOperator::from_ooxml_token(v.to_ooxml()),
            Some(v),
            "roundtrip failed for {:?}",
            v
        );
    }
}

#[test]
fn cf_operator_unknown_is_none() {
    assert_eq!(CfOperator::from_ooxml_token("bogus"), None);
    assert_eq!(CfOperator::from_ooxml_token(""), None);
}

#[test]
fn cf_operator_to_ooxml_values() {
    assert_eq!(CfOperator::LessThan.to_ooxml(), "lessThan");
    assert_eq!(CfOperator::ContainsText.to_ooxml(), "containsText");
    assert_eq!(CfOperator::EndsWith.to_ooxml(), "endsWith");
}

// -----------------------------------------------------------------------
// CfTimePeriod
// -----------------------------------------------------------------------

#[test]
fn cf_time_period_default() {
    assert_eq!(CfTimePeriod::default(), CfTimePeriod::Today);
}

#[test]
fn cf_time_period_roundtrip() {
    let all = [
        CfTimePeriod::Today,
        CfTimePeriod::Yesterday,
        CfTimePeriod::Tomorrow,
        CfTimePeriod::Last7Days,
        CfTimePeriod::ThisMonth,
        CfTimePeriod::LastMonth,
        CfTimePeriod::NextMonth,
        CfTimePeriod::ThisWeek,
        CfTimePeriod::LastWeek,
        CfTimePeriod::NextWeek,
    ];
    for v in all {
        assert_eq!(
            CfTimePeriod::from_ooxml_token(v.to_ooxml()),
            Some(v),
            "roundtrip failed for {:?}",
            v
        );
    }
}

#[test]
fn cf_time_period_unknown_is_none() {
    assert_eq!(CfTimePeriod::from_ooxml_token("bogus"), None);
    assert_eq!(CfTimePeriod::from_ooxml_token(""), None);
}

#[test]
fn cf_time_period_to_ooxml_values() {
    assert_eq!(CfTimePeriod::Last7Days.to_ooxml(), "last7Days");
    assert_eq!(CfTimePeriod::ThisMonth.to_ooxml(), "thisMonth");
    assert_eq!(CfTimePeriod::NextWeek.to_ooxml(), "nextWeek");
}

// -----------------------------------------------------------------------
// CfvoType
// -----------------------------------------------------------------------

#[test]
fn cfvo_type_default() {
    assert_eq!(CfvoType::default(), CfvoType::Num);
}

#[test]
fn cfvo_type_roundtrip() {
    let all = [
        CfvoType::Num,
        CfvoType::Percent,
        CfvoType::Max,
        CfvoType::Min,
        CfvoType::Formula,
        CfvoType::Percentile,
        CfvoType::AutoMin,
        CfvoType::AutoMax,
    ];
    for v in all {
        assert_eq!(
            CfvoType::from_ooxml_token(v.to_ooxml()),
            Some(v),
            "roundtrip failed for {:?}",
            v
        );
    }
}

#[test]
fn cfvo_type_unknown_is_none() {
    assert_eq!(CfvoType::from_ooxml_token("bogus"), None);
    assert_eq!(CfvoType::from_ooxml_token(""), None);
}

#[test]
fn cfvo_type_to_ooxml_values() {
    assert_eq!(CfvoType::Percent.to_ooxml(), "percent");
    assert_eq!(CfvoType::AutoMin.to_ooxml(), "autoMin");
    assert_eq!(CfvoType::AutoMax.to_ooxml(), "autoMax");
}

// -----------------------------------------------------------------------
// DataBarDirection
// -----------------------------------------------------------------------

#[test]
fn data_bar_direction_default() {
    assert_eq!(DataBarDirection::default(), DataBarDirection::Context);
}

#[test]
fn data_bar_direction_roundtrip() {
    let all = [
        DataBarDirection::Context,
        DataBarDirection::LeftToRight,
        DataBarDirection::RightToLeft,
    ];
    for v in all {
        assert_eq!(
            DataBarDirection::from_ooxml_token(v.to_ooxml()),
            Some(v),
            "roundtrip failed for {:?}",
            v
        );
    }
}

#[test]
fn data_bar_direction_unknown_is_none() {
    assert_eq!(DataBarDirection::from_ooxml_token("bogus"), None);
    assert_eq!(DataBarDirection::from_ooxml_token(""), None);
}

#[test]
fn data_bar_direction_to_ooxml_values() {
    assert_eq!(DataBarDirection::LeftToRight.to_ooxml(), "leftToRight");
    assert_eq!(DataBarDirection::RightToLeft.to_ooxml(), "rightToLeft");
}

// -----------------------------------------------------------------------
// DataBarAxisPosition
// -----------------------------------------------------------------------

#[test]
fn data_bar_axis_position_default() {
    assert_eq!(
        DataBarAxisPosition::default(),
        DataBarAxisPosition::Automatic
    );
}

#[test]
fn data_bar_axis_position_roundtrip() {
    let all = [
        DataBarAxisPosition::Automatic,
        DataBarAxisPosition::Middle,
        DataBarAxisPosition::None,
    ];
    for v in all {
        assert_eq!(
            DataBarAxisPosition::from_ooxml_token(v.to_ooxml()),
            Some(v),
            "roundtrip failed for {:?}",
            v
        );
    }
}

#[test]
fn data_bar_axis_position_unknown_is_none() {
    assert_eq!(DataBarAxisPosition::from_ooxml_token("bogus"), None);
    assert_eq!(DataBarAxisPosition::from_ooxml_token(""), None);
}

#[test]
fn data_bar_axis_position_to_ooxml_values() {
    assert_eq!(DataBarAxisPosition::Automatic.to_ooxml(), "automatic");
    assert_eq!(DataBarAxisPosition::Middle.to_ooxml(), "middle");
    assert_eq!(DataBarAxisPosition::None.to_ooxml(), "none");
}

// -----------------------------------------------------------------------
// IconSetType
// -----------------------------------------------------------------------

#[test]
fn icon_set_type_default() {
    assert_eq!(IconSetType::default(), IconSetType::ThreeTrafficLights1);
}

#[test]
fn icon_set_type_roundtrip() {
    let all = [
        IconSetType::ThreeTrafficLights1,
        IconSetType::ThreeArrows,
        IconSetType::ThreeArrowsGray,
        IconSetType::ThreeFlags,
        IconSetType::ThreeTrafficLights2,
        IconSetType::ThreeSigns,
        IconSetType::ThreeSymbols,
        IconSetType::ThreeSymbols2,
        IconSetType::FourArrows,
        IconSetType::FourArrowsGray,
        IconSetType::FourRedToBlack,
        IconSetType::FourRating,
        IconSetType::FourTrafficLights,
        IconSetType::FiveArrows,
        IconSetType::FiveArrowsGray,
        IconSetType::FiveRating,
        IconSetType::FiveQuarters,
        IconSetType::ThreeStars,
        IconSetType::ThreeTriangles,
        IconSetType::FiveBoxes,
        IconSetType::NoIcons,
    ];
    for v in all {
        assert_eq!(
            IconSetType::from_ooxml_token(v.to_ooxml()),
            Some(v),
            "roundtrip failed for {:?}",
            v
        );
    }
}

#[test]
fn icon_set_type_unknown_is_none() {
    assert_eq!(IconSetType::from_ooxml_token("bogus"), None);
    assert_eq!(IconSetType::from_ooxml_token(""), None);
}

#[test]
fn icon_set_type_to_ooxml_values() {
    assert_eq!(IconSetType::ThreeArrows.to_ooxml(), "3Arrows");
    assert_eq!(IconSetType::FiveBoxes.to_ooxml(), "5Boxes");
    assert_eq!(IconSetType::NoIcons.to_ooxml(), "NoIcons");
}

#[test]
fn icon_set_type_num_icons() {
    // 3-icon sets
    assert_eq!(IconSetType::ThreeArrows.num_icons(), 3);
    assert_eq!(IconSetType::ThreeFlags.num_icons(), 3);
    assert_eq!(IconSetType::ThreeTrafficLights1.num_icons(), 3);
    assert_eq!(IconSetType::ThreeStars.num_icons(), 3);
    assert_eq!(IconSetType::ThreeTriangles.num_icons(), 3);
    // 4-icon sets
    assert_eq!(IconSetType::FourArrows.num_icons(), 4);
    assert_eq!(IconSetType::FourRating.num_icons(), 4);
    assert_eq!(IconSetType::FourTrafficLights.num_icons(), 4);
    // 5-icon sets
    assert_eq!(IconSetType::FiveArrows.num_icons(), 5);
    assert_eq!(IconSetType::FiveQuarters.num_icons(), 5);
    assert_eq!(IconSetType::FiveBoxes.num_icons(), 5);
    // No icons
    assert_eq!(IconSetType::NoIcons.num_icons(), 0);
}

// -----------------------------------------------------------------------
// CfRuleType
// -----------------------------------------------------------------------

#[test]
fn cf_rule_type_default() {
    assert_eq!(CfRuleType::default(), CfRuleType::Expression);
}

#[test]
fn cf_rule_type_roundtrip() {
    let all = [
        CfRuleType::Expression,
        CfRuleType::CellIs,
        CfRuleType::ColorScale,
        CfRuleType::DataBar,
        CfRuleType::IconSet,
        CfRuleType::Top10,
        CfRuleType::UniqueValues,
        CfRuleType::DuplicateValues,
        CfRuleType::ContainsText,
        CfRuleType::NotContainsText,
        CfRuleType::BeginsWith,
        CfRuleType::EndsWith,
        CfRuleType::ContainsBlanks,
        CfRuleType::NotContainsBlanks,
        CfRuleType::ContainsErrors,
        CfRuleType::NotContainsErrors,
        CfRuleType::TimePeriod,
        CfRuleType::AboveAverage,
    ];
    for v in all {
        assert_eq!(
            CfRuleType::from_ooxml(v.to_ooxml()),
            v,
            "roundtrip failed for {:?}",
            v
        );
    }
}

#[test]
fn cf_rule_type_unknown_fallback() {
    assert_eq!(CfRuleType::from_ooxml("bogus"), CfRuleType::Expression);
    assert_eq!(CfRuleType::from_ooxml(""), CfRuleType::Expression);
}

#[test]
fn cf_rule_type_to_ooxml_values() {
    assert_eq!(CfRuleType::CellIs.to_ooxml(), "cellIs");
    assert_eq!(CfRuleType::ColorScale.to_ooxml(), "colorScale");
    assert_eq!(CfRuleType::DataBar.to_ooxml(), "dataBar");
    assert_eq!(CfRuleType::Top10.to_ooxml(), "top10");
    assert_eq!(CfRuleType::ContainsText.to_ooxml(), "containsText");
    assert_eq!(CfRuleType::AboveAverage.to_ooxml(), "aboveAverage");
}

// -----------------------------------------------------------------------
// Cfvo
// -----------------------------------------------------------------------

#[test]
fn cfvo_default_gte_true() {
    let cfvo = Cfvo::default();
    assert!(cfvo.gte, "Cfvo default gte should be true per ECMA-376");
    assert_eq!(cfvo.cfvo_type, CfvoType::Num);
    assert!(cfvo.val.is_none());
}

#[test]
fn cfvo_with_value() {
    let cfvo = Cfvo {
        cfvo_type: CfvoType::Percent,
        val: Some("50".to_string()),
        gte: false,
        ext_lst_xml: None,
    };
    assert_eq!(cfvo.cfvo_type, CfvoType::Percent);
    assert_eq!(cfvo.val.as_deref(), Some("50"));
    assert!(!cfvo.gte);
}

// -----------------------------------------------------------------------
// CfColor
// -----------------------------------------------------------------------

#[test]
fn cf_color_default_all_none() {
    let c = CfColor::default();
    assert!(c.rgb.is_none());
    assert!(c.theme.is_none());
    assert!(c.indexed.is_none());
    assert!(c.tint.is_none());
    assert!(!c.auto);
}

#[test]
fn cf_color_rgb() {
    let c = CfColor {
        rgb: Some("FF00FF00".to_string()),
        ..Default::default()
    };
    assert_eq!(c.rgb.as_deref(), Some("FF00FF00"));
}

#[test]
fn cf_color_theme_with_tint() {
    let c = CfColor {
        theme: Some(4),
        tint: Some(-0.25),
        ..Default::default()
    };
    assert_eq!(c.theme, Some(4));
    assert_eq!(c.tint, Some(-0.25));
}

// -----------------------------------------------------------------------
// ColorScale
// -----------------------------------------------------------------------

#[test]
fn color_scale_two_color() {
    let cs = ColorScale {
        cfvo: vec![
            Cfvo {
                cfvo_type: CfvoType::Min,
                val: None,
                gte: true,
                ext_lst_xml: None,
            },
            Cfvo {
                cfvo_type: CfvoType::Max,
                val: None,
                gte: true,
                ext_lst_xml: None,
            },
        ],
        colors: vec![
            CfColor {
                rgb: Some("FFFF0000".to_string()),
                ..Default::default()
            },
            CfColor {
                rgb: Some("FF00FF00".to_string()),
                ..Default::default()
            },
        ],
    };
    assert_eq!(cs.cfvo.len(), 2);
    assert_eq!(cs.colors.len(), 2);
}

#[test]
fn color_scale_three_color() {
    let cs = ColorScale {
        cfvo: vec![
            Cfvo {
                cfvo_type: CfvoType::Min,
                val: None,
                gte: true,
                ext_lst_xml: None,
            },
            Cfvo {
                cfvo_type: CfvoType::Percentile,
                val: Some("50".to_string()),
                gte: true,
                ext_lst_xml: None,
            },
            Cfvo {
                cfvo_type: CfvoType::Max,
                val: None,
                gte: true,
                ext_lst_xml: None,
            },
        ],
        colors: vec![
            CfColor {
                rgb: Some("FFFF0000".to_string()),
                ..Default::default()
            },
            CfColor {
                rgb: Some("FFFFFF00".to_string()),
                ..Default::default()
            },
            CfColor {
                rgb: Some("FF00FF00".to_string()),
                ..Default::default()
            },
        ],
    };
    assert_eq!(cs.cfvo.len(), 3);
    assert_eq!(cs.colors.len(), 3);
}

// -----------------------------------------------------------------------
// DataBar
// -----------------------------------------------------------------------

#[test]
fn data_bar_defaults() {
    let db = DataBar::default();
    assert_eq!(db.min_length, 10);
    assert_eq!(db.max_length, 90);
    assert!(db.show_value);
    assert!(db.gradient);
    assert!(db.negative_bar_color_same_as_positive);
    assert!(db.negative_bar_border_color_same_as_positive);
    assert_eq!(db.direction, DataBarDirection::Context);
    assert_eq!(db.axis_position, DataBarAxisPosition::Automatic);
    assert!(db.cfvo.is_empty());
    assert!(db.axis_color.is_none());
    assert!(db.border_color.is_none());
    assert!(db.negative_fill_color.is_none());
    assert!(db.negative_border_color.is_none());
}

// -----------------------------------------------------------------------
// IconSet
// -----------------------------------------------------------------------

#[test]
fn icon_set_struct_defaults() {
    let is = IconSet::default();
    assert_eq!(is.icon_set, IconSetType::ThreeTrafficLights1);
    assert!(is.show_value);
    assert!(is.percent);
    assert!(!is.reverse);
    assert!(is.cfvo.is_empty());
    assert!(!is.custom);
    assert!(is.cf_icon.is_empty());
}

#[test]
fn icon_set_with_custom_icons() {
    let is = IconSet {
        icon_set: IconSetType::ThreeArrows,
        show_value: false,
        percent: true,
        percent_attr_present: false,
        reverse: false,
        cfvo: vec![
            Cfvo {
                cfvo_type: CfvoType::Percent,
                val: Some("0".to_string()),
                gte: true,
                ext_lst_xml: None,
            },
            Cfvo {
                cfvo_type: CfvoType::Percent,
                val: Some("33".to_string()),
                gte: true,
                ext_lst_xml: None,
            },
            Cfvo {
                cfvo_type: CfvoType::Percent,
                val: Some("67".to_string()),
                gte: true,
                ext_lst_xml: None,
            },
        ],
        custom: true,
        cf_icon: vec![
            CfIcon {
                icon_set: IconSetType::ThreeFlags,
                icon_id: 0,
            },
            CfIcon {
                icon_set: IconSetType::ThreeFlags,
                icon_id: 1,
            },
            CfIcon {
                icon_set: IconSetType::ThreeFlags,
                icon_id: 2,
            },
        ],
    };
    assert!(is.custom);
    assert_eq!(is.cf_icon.len(), 3);
    assert_eq!(is.cf_icon[0].icon_set, IconSetType::ThreeFlags);
}

// -----------------------------------------------------------------------
// CfRule
// -----------------------------------------------------------------------

#[test]
fn cf_rule_defaults() {
    let rule = CfRule::default();
    assert_eq!(rule.rule_type, CfRuleType::Expression);
    assert_eq!(rule.priority, 0);
    assert!(rule.dxf_id.is_none());
    assert!(!rule.stop_if_true);
    assert!(rule.operator.is_none());
    assert!(rule.text.is_none());
    assert!(rule.time_period.is_none());
    assert!(rule.rank.is_none());
    assert!(!rule.percent);
    assert!(!rule.bottom);
    assert!(rule.above_average, "above_average defaults to true");
    assert!(rule.std_dev.is_none());
    assert!(!rule.equal_average);
    assert!(rule.formulas.is_empty());
    assert!(rule.color_scale.is_none());
    assert!(rule.data_bar.is_none());
    assert!(rule.icon_set.is_none());
}

// -----------------------------------------------------------------------
// ConditionalFormatting
// -----------------------------------------------------------------------

#[test]
fn conditional_formatting_with_cell_is_rule() {
    let cf = ConditionalFormatting {
        sqref: "A1:A10".to_string(),
        pivot: false,
        rules: vec![CfRule {
            rule_type: CfRuleType::CellIs,
            priority: 1,
            dxf_id: Some(0),
            operator: Some(CfOperator::GreaterThan),
            formulas: vec!["100".to_string()],
            ..Default::default()
        }],
    };
    assert_eq!(cf.sqref, "A1:A10");
    assert_eq!(cf.rules.len(), 1);
    assert_eq!(cf.rules[0].rule_type, CfRuleType::CellIs);
    assert_eq!(cf.rules[0].operator, Some(CfOperator::GreaterThan));
}

#[test]
fn conditional_formatting_with_color_scale() {
    let cf = ConditionalFormatting {
        sqref: "B1:B20".to_string(),
        pivot: false,
        rules: vec![CfRule {
            rule_type: CfRuleType::ColorScale,
            priority: 1,
            color_scale: Some(ColorScale {
                cfvo: vec![
                    Cfvo {
                        cfvo_type: CfvoType::Min,
                        val: None,
                        gte: true,
                        ext_lst_xml: None,
                    },
                    Cfvo {
                        cfvo_type: CfvoType::Max,
                        val: None,
                        gte: true,
                        ext_lst_xml: None,
                    },
                ],
                colors: vec![
                    CfColor {
                        rgb: Some("FFFF0000".to_string()),
                        ..Default::default()
                    },
                    CfColor {
                        rgb: Some("FF00FF00".to_string()),
                        ..Default::default()
                    },
                ],
            }),
            ..Default::default()
        }],
    };
    assert_eq!(cf.rules[0].rule_type, CfRuleType::ColorScale);
    assert!(cf.rules[0].color_scale.is_some());
}

#[test]
fn conditional_formatting_with_data_bar() {
    let cf = ConditionalFormatting {
        sqref: "C1:C50".to_string(),
        pivot: false,
        rules: vec![CfRule {
            rule_type: CfRuleType::DataBar,
            priority: 1,
            data_bar: Some(DataBar {
                cfvo: vec![
                    Cfvo {
                        cfvo_type: CfvoType::Min,
                        val: None,
                        gte: true,
                        ext_lst_xml: None,
                    },
                    Cfvo {
                        cfvo_type: CfvoType::Max,
                        val: None,
                        gte: true,
                        ext_lst_xml: None,
                    },
                ],
                color: CfColor {
                    rgb: Some("FF638EC6".to_string()),
                    ..Default::default()
                },
                ..Default::default()
            }),
            ..Default::default()
        }],
    };
    assert_eq!(cf.rules[0].rule_type, CfRuleType::DataBar);
    let db = cf.rules[0].data_bar.as_ref().unwrap();
    assert_eq!(db.cfvo.len(), 2);
    assert_eq!(db.color.rgb.as_deref(), Some("FF638EC6"));
}

// -----------------------------------------------------------------------
// CfRuleX14
// -----------------------------------------------------------------------

#[test]
fn cf_rule_x14_with_data_bar() {
    let rule = CfRuleX14 {
        rule_type: CfRuleType::DataBar,
        priority: 1,
        dxf_id: None,
        id: "{00000000-0000-0000-0000-000000000001}".to_string(),
        color_scale: None,
        data_bar: Some(DataBar {
            gradient: false,
            direction: DataBarDirection::LeftToRight,
            ..Default::default()
        }),
        icon_set: None,
    };
    assert_eq!(rule.rule_type, CfRuleType::DataBar);
    assert!(!rule.data_bar.as_ref().unwrap().gradient);
}

#[test]
fn cf_rule_signed_priority_and_std_dev() {
    let rule = CfRule {
        rule_type: CfRuleType::AboveAverage,
        priority: -1,
        std_dev: Some(-2),
        ..Default::default()
    };
    assert_eq!(rule.priority, -1);
    assert_eq!(rule.std_dev, Some(-2));
}

#[test]
fn conditional_formatting_x14_default() {
    let cf = ConditionalFormattingX14::default();
    assert!(cf.id.is_empty());
    assert!(cf.sqref.is_empty());
    assert!(cf.rules.is_empty());
}

// -----------------------------------------------------------------------
// Serde <-> OOXML token equivalence
//
// Domain-types CF enum fields are typed as these ooxml enums directly
// instead of `String` fields holding OOXML tokens. The JSON / Yrs wire
// format produced by `serde::Serialize` must remain byte-identical to the
// legacy `String` content, which was `to_ooxml().to_string()`. These tests
// lock that invariant.
// -----------------------------------------------------------------------

#[test]
fn cf_operator_serde_matches_ooxml_token() {
    let all = [
        CfOperator::LessThan,
        CfOperator::LessThanOrEqual,
        CfOperator::Equal,
        CfOperator::NotEqual,
        CfOperator::GreaterThanOrEqual,
        CfOperator::GreaterThan,
        CfOperator::Between,
        CfOperator::NotBetween,
        CfOperator::ContainsText,
        CfOperator::NotContains,
        CfOperator::BeginsWith,
        CfOperator::EndsWith,
    ];
    for v in all {
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
        let back: CfOperator = serde_json::from_str(&json).unwrap();
        assert_eq!(back, v);
    }
}

#[test]
fn cf_time_period_serde_matches_ooxml_token() {
    let all = [
        CfTimePeriod::Today,
        CfTimePeriod::Yesterday,
        CfTimePeriod::Tomorrow,
        CfTimePeriod::Last7Days,
        CfTimePeriod::ThisMonth,
        CfTimePeriod::LastMonth,
        CfTimePeriod::NextMonth,
        CfTimePeriod::ThisWeek,
        CfTimePeriod::LastWeek,
        CfTimePeriod::NextWeek,
    ];
    for v in all {
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
        let back: CfTimePeriod = serde_json::from_str(&json).unwrap();
        assert_eq!(back, v);
    }
}

#[test]
fn cfvo_type_serde_matches_ooxml_token() {
    let all = [
        CfvoType::Num,
        CfvoType::Percent,
        CfvoType::Max,
        CfvoType::Min,
        CfvoType::Formula,
        CfvoType::Percentile,
        CfvoType::AutoMin,
        CfvoType::AutoMax,
    ];
    for v in all {
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
        let back: CfvoType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, v);
    }
}

#[test]
fn data_bar_direction_serde_matches_ooxml_token() {
    let all = [
        DataBarDirection::Context,
        DataBarDirection::LeftToRight,
        DataBarDirection::RightToLeft,
    ];
    for v in all {
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
        let back: DataBarDirection = serde_json::from_str(&json).unwrap();
        assert_eq!(back, v);
    }
}

#[test]
fn data_bar_axis_position_serde_matches_ooxml_token() {
    let all = [
        DataBarAxisPosition::Automatic,
        DataBarAxisPosition::Middle,
        DataBarAxisPosition::None,
    ];
    for v in all {
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
        let back: DataBarAxisPosition = serde_json::from_str(&json).unwrap();
        assert_eq!(back, v);
    }
}

#[test]
fn icon_set_type_serde_matches_ooxml_token() {
    let all = [
        IconSetType::ThreeTrafficLights1,
        IconSetType::ThreeArrows,
        IconSetType::ThreeArrowsGray,
        IconSetType::ThreeFlags,
        IconSetType::ThreeTrafficLights2,
        IconSetType::ThreeSigns,
        IconSetType::ThreeSymbols,
        IconSetType::ThreeSymbols2,
        IconSetType::FourArrows,
        IconSetType::FourArrowsGray,
        IconSetType::FourRedToBlack,
        IconSetType::FourRating,
        IconSetType::FourTrafficLights,
        IconSetType::FiveArrows,
        IconSetType::FiveArrowsGray,
        IconSetType::FiveRating,
        IconSetType::FiveQuarters,
        IconSetType::ThreeStars,
        IconSetType::ThreeTriangles,
        IconSetType::FiveBoxes,
        IconSetType::NoIcons,
    ];
    for v in all {
        let json = serde_json::to_string(&v).unwrap();
        assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
        let back: IconSetType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, v);
    }
}
