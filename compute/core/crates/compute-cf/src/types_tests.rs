use super::*;
use value_types::Color;

// =======================================================================
// Wire deserialization: CellValue rule
// =======================================================================

#[test]
fn test_wire_deser_cell_value_rule() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "stopIfTrue": false,
        "operator": "greaterThan",
        "values": ["100"],
        "style": {
            "backgroundColor": "#FF0000",
            "bold": true
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    assert_eq!(wire.rule_type, CFRuleType::CellValue);
    assert_eq!(wire.priority, 1);
    assert!(!wire.stop_if_true);
    assert_eq!(wire.operator, Some(CFOperator::GreaterThan));
    // Typed formula boundary: `values` is now `Vec<CfValue>`. Shorthand JSON string
    // `"100"` deserializes into `CfValue::Text` (the fallback accepts bare
    // strings). Downstream `.as_number()` still extracts 100.0 for the
    // numeric-compare path — covered by the `try_from_wire` tests below.
    assert_eq!(
        wire.values,
        vec![CfValue::Text {
            value: "100".to_string()
        }]
    );

    let style = wire.style.as_ref().unwrap();
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(style.bold, Some(true));
}

#[test]
fn test_wire_to_internal_cell_value_between() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 2,
        "stopIfTrue": true,
        "operator": "between",
        "values": ["10", "20"],
        "style": { "fontColor": "#000000" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    assert_eq!(rule.priority, 2);
    assert!(rule.stop_if_true);
    match &rule.kind {
        CFRuleKind::CellValue { comparison } => match comparison {
            CellValueComparison::Between { low, high } => {
                assert_eq!(*low, 10.0);
                assert_eq!(*high, 20.0);
            }
            _ => panic!("Expected Between variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().font_color,
        Some(Color::from_hex("#000000").unwrap())
    );
}

#[test]
fn test_wire_to_internal_cell_value_single() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "greaterThan",
        "values": ["100"],
        "style": { "bold": true },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::CellValue { comparison, .. } => match comparison {
            CellValueComparison::Single {
                operator,
                threshold,
            } => {
                assert_eq!(*operator, CellValueSingleOp::GreaterThan);
                assert_eq!(threshold.text, "100");
                assert_eq!(threshold.number, Some(100.0));
            }
            _ => panic!("Expected Single variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
}

#[test]
fn test_wire_to_internal_cell_value_single_text() {
    // Non-numeric value
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "equal",
        "values": ["hello"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::CellValue { comparison, .. } => match comparison {
            CellValueComparison::Single {
                operator,
                threshold,
            } => {
                assert_eq!(*operator, CellValueSingleOp::Equal);
                assert_eq!(threshold.text, "hello");
                assert_eq!(threshold.number, None);
            }
            _ => panic!("Expected Single variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
}

#[test]
fn test_wire_to_internal_cell_value_between_sorts_values() {
    // High value first — should be sorted to low/high
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["20", "10"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::CellValue { comparison, .. } => match comparison {
            CellValueComparison::Between { low, high } => {
                assert_eq!(*low, 10.0);
                assert_eq!(*high, 20.0);
            }
            _ => panic!("Expected Between variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
}

// -----------------------------------------------------------------------
// Wire deserialization: Formula rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_formula_rule() {
    let json = r#"{
        "ruleType": "formula",
        "priority": 3,
        "formula": "A1>100",
        "style": { "italic": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::Formula { formula } => {
            assert_eq!(formula, "A1>100");
        }
        _ => panic!("Expected Formula variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().italic, Some(true));
}

// -----------------------------------------------------------------------
// Wire deserialization: ColorScale rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_color_scale_rule() {
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "min", "color": "#FF0000" },
            "midPoint": { "type": "percentile", "value": "50", "color": "#FFFF00" },
            "maxPoint": { "type": "max", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ColorScale(cs) => {
            assert_eq!(cs.min_point.value_type, CFValueType::Min);
            assert_eq!(cs.min_point.color, Color::rgb(255, 0, 0));
            assert!(cs.mid_point.is_some());
            let mid = cs.mid_point.as_ref().unwrap();
            assert_eq!(mid.value_type, CFValueType::Percentile);
            assert_eq!(mid.value, Some(50.0));
            assert_eq!(mid.color, Color::rgb(255, 255, 0));
            assert_eq!(cs.max_point.value_type, CFValueType::Max);
            assert_eq!(cs.max_point.color, Color::rgb(0, 255, 0));
        }
        _ => panic!("Expected ColorScale variant"),
    }
}

// -----------------------------------------------------------------------
// Wire deserialization: DataBar rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_data_bar_rule() {
    let json = r##"{
        "ruleType": "dataBar",
        "priority": 1,
        "dataBar": {
            "minPoint": { "type": "min", "color": "#000000" },
            "maxPoint": { "type": "max", "color": "#000000" },
            "positiveColor": "#638EC6",
            "showBorder": false,
            "gradient": true,
            "direction": "leftToRight",
            "axisPosition": "automatic",
            "showValue": true
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::DataBar(db) => {
            assert_eq!(db.positive_color, Color::from_hex("#638EC6").unwrap());
            assert!(db.gradient);
            assert_eq!(db.direction, CFDataBarDirection::LeftToRight);
            assert_eq!(db.axis_position, CFDataBarAxisPosition::Automatic);
            assert!(db.show_value);
            assert!(!db.show_border);
        }
        _ => panic!("Expected DataBar variant"),
    }
}

// -----------------------------------------------------------------------
// Wire deserialization: IconSet rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_icon_set_rule() {
    let json = r#"{
        "ruleType": "iconSet",
        "priority": 1,
        "iconSet": {
            "iconSetName": "3Arrows",
            "thresholds": [
                { "type": "percent", "value": "33", "operator": "greaterThanOrEqual" },
                { "type": "percent", "value": "67", "operator": "greaterThanOrEqual" }
            ],
            "reverseOrder": false,
            "showIconOnly": true
        },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::IconSet(is) => {
            assert_eq!(is.icon_set_name, CFIconSetName::ThreeArrows);
            assert_eq!(is.thresholds.len(), 2);
            assert!(is.show_icon_only);
            assert!(!is.reverse_order);
            assert_eq!(
                is.thresholds[0].operator,
                CFIconThresholdOperator::GreaterThanOrEqual
            );
            assert_eq!(is.thresholds[0].value, Some(33.0));
            assert_eq!(is.thresholds[1].value, Some(67.0));
        }
        _ => panic!("Expected IconSet variant"),
    }
}

// -----------------------------------------------------------------------
// Wire deserialization: Top10 rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_top10_rule() {
    let json = r##"{
        "ruleType": "top10",
        "priority": 5,
        "rank": 10,
        "percent": true,
        "bottom": false,
        "style": { "backgroundColor": "#FFFF00" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::Top10 {
            rank,
            percent,
            bottom,
        } => {
            assert_eq!(*rank, 10);
            assert!(*percent);
            assert!(!*bottom);
        }
        _ => panic!("Expected Top10 variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#FFFF00").unwrap())
    );
}

// -----------------------------------------------------------------------
// Wire deserialization: AboveAverage rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_above_average_rule() {
    let json = r#"{
        "ruleType": "aboveAverage",
        "priority": 3,
        "above": true,
        "equalAverage": true,
        "stdDev": 2,
        "style": { "bold": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::AboveAverage {
            above,
            equal_average,
            std_dev,
        } => {
            assert!(*above);
            assert!(*equal_average);
            assert_eq!(*std_dev, 2);
        }
        _ => panic!("Expected AboveAverage variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().bold, Some(true));
}

// -----------------------------------------------------------------------
// Wire deserialization: DuplicateValues rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_duplicate_values_rule() {
    let json = r#"{
        "ruleType": "duplicateValues",
        "priority": 1,
        "unique": true,
        "style": { "strikethrough": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::DuplicateValues { unique } => {
            assert!(*unique);
        }
        _ => panic!("Expected DuplicateValues variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().strikethrough, Some(true));
}

// -----------------------------------------------------------------------
// Wire deserialization: ContainsText rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_contains_text_rule() {
    let json = r##"{
        "ruleType": "containsText",
        "priority": 1,
        "textOperator": "beginsWith",
        "text": "hello",
        "style": { "fontColor": "#0000FF" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { operator, text } => {
            assert_eq!(*operator, CFTextOperator::BeginsWith);
            assert_eq!(text, "hello");
        }
        _ => panic!("Expected ContainsText variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().font_color,
        Some(Color::from_hex("#0000FF").unwrap())
    );
}

// -----------------------------------------------------------------------
// Wire deserialization: ContainsBlanks rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_contains_blanks_rule() {
    let json = r##"{
        "ruleType": "containsBlanks",
        "priority": 1,
        "blanks": true,
        "style": { "backgroundColor": "#CCCCCC" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsBlanks { blanks } => {
            assert!(*blanks);
        }
        _ => panic!("Expected ContainsBlanks variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#CCCCCC").unwrap())
    );
}

// -----------------------------------------------------------------------
// Wire deserialization: ContainsErrors rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_contains_errors_rule() {
    let json = r##"{
        "ruleType": "containsErrors",
        "priority": 1,
        "errors": false,
        "style": { "backgroundColor": "#00FF00" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsErrors { errors } => {
            assert!(!*errors);
        }
        _ => panic!("Expected ContainsErrors variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#00FF00").unwrap())
    );
}

// -----------------------------------------------------------------------
// Wire deserialization: TimePeriod rule
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_time_period_rule() {
    let json = r#"{
        "ruleType": "timePeriod",
        "priority": 1,
        "datePeriod": "thisWeek",
        "style": { "italic": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::TimePeriod { period } => {
            assert_eq!(*period, DatePeriod::ThisWeek);
        }
        _ => panic!("Expected TimePeriod variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().italic, Some(true));
}

// -----------------------------------------------------------------------
// Wire deserialization: defaults when optional fields are missing
// -----------------------------------------------------------------------

#[test]
fn test_wire_deser_minimal_cell_value() {
    // Minimal CellValue with explicit operator (operator is required)
    let json = r#"{
        "ruleType": "cellValue",
        "priority": 0,
        "operator": "equal",
        "values": ["test"],
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    assert_eq!(rule.priority, 0);
    assert!(!rule.stop_if_true);
    match &rule.kind {
        CFRuleKind::CellValue { comparison, .. } => match comparison {
            CellValueComparison::Single {
                operator,
                threshold,
            } => {
                assert_eq!(*operator, CellValueSingleOp::Equal);
                assert_eq!(threshold.text, "test");
            }
            _ => panic!("Expected Single variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
}

#[test]
fn test_wire_deser_cell_value_missing_operator_errors() {
    let json = r#"{
        "ruleType": "cellValue",
        "priority": 0,
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("operator"));
}

// -----------------------------------------------------------------------
// RangePos ranges deserialization
// -----------------------------------------------------------------------

#[test]
fn test_range_pos_ranges_deser() {
    use cell_types::SheetId;

    let json = r#"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "equal",
        "values": ["1"],
        "style": {},
        "ranges": [
            {
                "sheet": "550e8400-e29b-41d4-a716-446655440000",
                "start_row": 0,
                "start_col": 0,
                "end_row": 5,
                "end_col": 3
            }
        ]
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    assert_eq!(wire.ranges.len(), 1);

    let range = &wire.ranges[0];
    assert_eq!(
        range.sheet(),
        SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
    );
    assert_eq!(range.start_row(), 0);
    assert_eq!(range.start_col(), 0);
    assert_eq!(range.end_row(), 5);
    assert_eq!(range.end_col(), 3);
}

// -----------------------------------------------------------------------
// Output types
// -----------------------------------------------------------------------

#[test]
fn test_cell_cf_result_has_any() {
    let empty = CellCFResult::default();
    assert!(!empty.has_any());

    let with_style = CellCFResult {
        row: 0,
        col: 0,
        style: Some(CfRenderStyle::default()),
        ..Default::default()
    };
    assert!(with_style.has_any());

    let with_data_bar = CellCFResult {
        row: 1,
        col: 2,
        data_bar: Some(DataBarResult {
            fill_percent: 50.0,
            color: Color::rgba(0, 128, 255, 255),
            gradient: false,
            axis_position: 0.0,
            is_negative: false,
            negative_color: None,
            show_value: true,
            show_axis: false,
            border_color: None,
            negative_border_color: None,
            show_border: false,
            direction: CFDataBarDirection::LeftToRight,
            axis_color: None,
        }),
        ..Default::default()
    };
    assert!(with_data_bar.has_any());

    let with_color_scale = CellCFResult {
        color_scale: Some(ColorScaleResult {
            color: Color::rgb(255, 0, 0),
        }),
        ..Default::default()
    };
    assert!(with_color_scale.has_any());

    let with_icon = CellCFResult {
        icon: Some(IconResult {
            set_name: CFIconSetName::ThreeArrows,
            icon_index: 0,
            show_value: true,
        }),
        ..Default::default()
    };
    assert!(with_icon.has_any());
}

// -----------------------------------------------------------------------
// Output serialization
// -----------------------------------------------------------------------

#[test]
fn test_cell_cf_result_serialization() {
    let result = CellCFResult {
        row: 5,
        col: 3,
        style: Some(CfRenderStyle {
            background_color: Some(Color::from_hex("#FF0000").unwrap()),
            bold: Some(true),
            ..Default::default()
        }),
        data_bar: None,
        color_scale: None,
        icon: None,
    };

    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("\"row\":5"));
    assert!(json.contains("\"col\":3"));
    assert!(json.contains("\"backgroundColor\":\"#ff0000\""));
    assert!(json.contains("\"bold\":true"));
    // None fields should be skipped
    assert!(!json.contains("dataBar"));
    assert!(!json.contains("colorScale"));
    assert!(!json.contains("icon"));
}

// -----------------------------------------------------------------------
// Enum serde round-trips
// -----------------------------------------------------------------------

#[test]
fn test_enum_serde_roundtrip() {
    // CFRuleType
    let rt = CFRuleType::AboveAverage;
    let json = serde_json::to_string(&rt).unwrap();
    assert_eq!(json, "\"aboveAverage\"");
    let rt2: CFRuleType = serde_json::from_str(&json).unwrap();
    assert_eq!(rt, rt2);

    // CFOperator
    let op = CFOperator::GreaterThanOrEqual;
    let json = serde_json::to_string(&op).unwrap();
    assert_eq!(json, "\"greaterThanOrEqual\"");
    let op2: CFOperator = serde_json::from_str(&json).unwrap();
    assert_eq!(op, op2);

    // DatePeriod
    let dp = DatePeriod::Last7Days;
    let json = serde_json::to_string(&dp).unwrap();
    assert_eq!(json, "\"last7Days\"");
    let dp2: DatePeriod = serde_json::from_str(&json).unwrap();
    assert_eq!(dp, dp2);

    // CFValueType
    let vt = CFValueType::Percentile;
    let json = serde_json::to_string(&vt).unwrap();
    assert_eq!(json, "\"percentile\"");
    let vt2: CFValueType = serde_json::from_str(&json).unwrap();
    assert_eq!(vt, vt2);

    // CFDataBarDirection
    let dir = CFDataBarDirection::RightToLeft;
    let json = serde_json::to_string(&dir).unwrap();
    assert_eq!(json, "\"rightToLeft\"");
    let dir2: CFDataBarDirection = serde_json::from_str(&json).unwrap();
    assert_eq!(dir, dir2);

    // CFDataBarAxisPosition
    let ap = CFDataBarAxisPosition::Midpoint;
    let json = serde_json::to_string(&ap).unwrap();
    assert_eq!(json, "\"midpoint\"");
    let ap2: CFDataBarAxisPosition = serde_json::from_str(&json).unwrap();
    assert_eq!(ap, ap2);

    // CFTextOperator
    let to = CFTextOperator::EndsWith;
    let json = serde_json::to_string(&to).unwrap();
    assert_eq!(json, "\"endsWith\"");
    let to2: CFTextOperator = serde_json::from_str(&json).unwrap();
    assert_eq!(to, to2);

    // CFUnderlineType
    let ut = CFUnderlineType::DoubleAccounting;
    let json = serde_json::to_string(&ut).unwrap();
    assert_eq!(json, "\"doubleAccounting\"");
    let ut2: CFUnderlineType = serde_json::from_str(&json).unwrap();
    assert_eq!(ut, ut2);

    // CFBorderStyle
    let bs = CFBorderStyle::Dashed;
    let json = serde_json::to_string(&bs).unwrap();
    assert_eq!(json, "\"dashed\"");
    let bs2: CFBorderStyle = serde_json::from_str(&json).unwrap();
    assert_eq!(bs, bs2);

    // CFIconThresholdOperator
    let ito = CFIconThresholdOperator::GreaterThan;
    let json = serde_json::to_string(&ito).unwrap();
    assert_eq!(json, "\"greaterThan\"");
    let ito2: CFIconThresholdOperator = serde_json::from_str(&json).unwrap();
    assert_eq!(ito, ito2);
}

// -----------------------------------------------------------------------
// CFIconSetName serde round-trip
// -----------------------------------------------------------------------

#[test]
fn test_icon_set_name_serde_roundtrip() {
    let all_variants = vec![
        (CFIconSetName::ThreeArrows, "\"3Arrows\""),
        (CFIconSetName::ThreeArrowsGray, "\"3ArrowsGray\""),
        (CFIconSetName::ThreeFlags, "\"3Flags\""),
        (CFIconSetName::ThreeTrafficLights1, "\"3TrafficLights1\""),
        (CFIconSetName::ThreeTrafficLights2, "\"3TrafficLights2\""),
        (CFIconSetName::ThreeSigns, "\"3Signs\""),
        (CFIconSetName::ThreeSymbols, "\"3Symbols\""),
        (CFIconSetName::ThreeSymbols2, "\"3Symbols2\""),
        (CFIconSetName::ThreeStars, "\"3Stars\""),
        (CFIconSetName::ThreeTriangles, "\"3Triangles\""),
        (CFIconSetName::FourArrows, "\"4Arrows\""),
        (CFIconSetName::FourArrowsGray, "\"4ArrowsGray\""),
        (CFIconSetName::FourRedToBlack, "\"4RedToBlack\""),
        (CFIconSetName::FourRating, "\"4Rating\""),
        (CFIconSetName::FourTrafficLights, "\"4TrafficLights\""),
        (CFIconSetName::FiveArrows, "\"5Arrows\""),
        (CFIconSetName::FiveArrowsGray, "\"5ArrowsGray\""),
        (CFIconSetName::FiveRating, "\"5Rating\""),
        (CFIconSetName::FiveQuarters, "\"5Quarters\""),
        (CFIconSetName::FiveBoxes, "\"5Boxes\""),
        (CFIconSetName::NoIcons, "\"NoIcons\""),
        (CFIconSetName::Custom, "\"Custom\""),
    ];

    for (variant, expected_json) in all_variants {
        let serialized = serde_json::to_string(&variant).unwrap();
        assert_eq!(
            serialized, expected_json,
            "Serialize mismatch for {:?}",
            variant
        );

        let deserialized: CFIconSetName = serde_json::from_str(expected_json).unwrap();
        assert_eq!(
            deserialized, variant,
            "Deserialize mismatch for {}",
            expected_json
        );
    }
}

/// Ensures `CFIconSetName::SERDE_NAMES` matches the actual serde serialization
/// of every variant. If someone adds/removes a variant or changes a serde rename,
/// this test catches the drift.
#[test]
fn test_icon_set_serde_names_matches_enum() {
    let all_variants = [
        CFIconSetName::ThreeArrows,
        CFIconSetName::ThreeArrowsGray,
        CFIconSetName::ThreeFlags,
        CFIconSetName::ThreeTrafficLights1,
        CFIconSetName::ThreeTrafficLights2,
        CFIconSetName::ThreeSigns,
        CFIconSetName::ThreeSymbols,
        CFIconSetName::ThreeSymbols2,
        CFIconSetName::ThreeStars,
        CFIconSetName::ThreeTriangles,
        CFIconSetName::FourArrows,
        CFIconSetName::FourArrowsGray,
        CFIconSetName::FourRedToBlack,
        CFIconSetName::FourRating,
        CFIconSetName::FourTrafficLights,
        CFIconSetName::FiveArrows,
        CFIconSetName::FiveArrowsGray,
        CFIconSetName::FiveRating,
        CFIconSetName::FiveQuarters,
        CFIconSetName::FiveBoxes,
        CFIconSetName::NoIcons,
        CFIconSetName::Custom,
    ];

    assert_eq!(
        CFIconSetName::SERDE_NAMES.len(),
        all_variants.len(),
        "SERDE_NAMES length must match variant count"
    );

    for (i, variant) in all_variants.iter().enumerate() {
        let serialized = serde_json::to_string(variant).unwrap();
        let expected = format!("\"{}\"", CFIconSetName::SERDE_NAMES[i]);
        assert_eq!(
            serialized,
            expected,
            "SERDE_NAMES[{}] ({}) doesn't match serde output for {:?}",
            i,
            CFIconSetName::SERDE_NAMES[i],
            variant
        );
    }
}

// -----------------------------------------------------------------------
// Full wire -> internal round-trip for all rule types
// -----------------------------------------------------------------------

#[test]
fn test_wire_roundtrip_all_rule_types() {
    let rule_types = vec![
        (
            r#"{"ruleType":"cellValue","priority":1,"operator":"notEqual","values":["42"],"style":{},"ranges":[]}"#,
            CFRuleType::CellValue,
        ),
        (
            r#"{"ruleType":"formula","priority":2,"formula":"=A1>0","style":{},"ranges":[]}"#,
            CFRuleType::Formula,
        ),
        (
            r##"{"ruleType":"colorScale","priority":3,"colorScale":{"minPoint":{"type":"min","color":"#FF0000"},"maxPoint":{"type":"max","color":"#00FF00"}},"ranges":[]}"##,
            CFRuleType::ColorScale,
        ),
        (
            r##"{"ruleType":"dataBar","priority":4,"dataBar":{"minPoint":{"type":"min","color":"#000000"},"maxPoint":{"type":"max","color":"#000000"},"positiveColor":"#638EC6","showBorder":false,"gradient":false,"direction":"leftToRight","axisPosition":"automatic","showValue":true},"ranges":[]}"##,
            CFRuleType::DataBar,
        ),
        (
            r#"{"ruleType":"iconSet","priority":5,"iconSet":{"iconSetName":"NoIcons","thresholds":[],"reverseOrder":false,"showIconOnly":false},"ranges":[]}"#,
            CFRuleType::IconSet,
        ),
        (
            r#"{"ruleType":"top10","priority":6,"rank":5,"style":{},"ranges":[]}"#,
            CFRuleType::Top10,
        ),
        (
            r#"{"ruleType":"aboveAverage","priority":7,"above":false,"style":{},"ranges":[]}"#,
            CFRuleType::AboveAverage,
        ),
        (
            r#"{"ruleType":"duplicateValues","priority":8,"style":{},"ranges":[]}"#,
            CFRuleType::DuplicateValues,
        ),
        (
            r#"{"ruleType":"containsText","priority":9,"textOperator":"contains","text":"test","style":{},"ranges":[]}"#,
            CFRuleType::ContainsText,
        ),
        (
            r#"{"ruleType":"containsBlanks","priority":10,"blanks":false,"style":{},"ranges":[]}"#,
            CFRuleType::ContainsBlanks,
        ),
        (
            r#"{"ruleType":"containsErrors","priority":11,"errors":true,"style":{},"ranges":[]}"#,
            CFRuleType::ContainsErrors,
        ),
        (
            r#"{"ruleType":"timePeriod","priority":12,"datePeriod":"tomorrow","style":{},"ranges":[]}"#,
            CFRuleType::TimePeriod,
        ),
    ];

    for (json, expected_type) in rule_types {
        let wire: CFRuleWire = serde_json::from_str(json)
            .unwrap_or_else(|e| panic!("Failed to deserialize {:?}: {}", expected_type, e));
        assert_eq!(wire.rule_type, expected_type);

        let rule: CFRule = CFRule::try_from(wire).unwrap();
        // Verify correct variant was created
        match (&rule.kind, expected_type) {
            (CFRuleKind::CellValue { .. }, CFRuleType::CellValue) => {}
            (CFRuleKind::Formula { .. }, CFRuleType::Formula) => {}
            (CFRuleKind::ColorScale(_), CFRuleType::ColorScale) => {}
            (CFRuleKind::DataBar(_), CFRuleType::DataBar) => {}
            (CFRuleKind::IconSet(_), CFRuleType::IconSet) => {}
            (CFRuleKind::Top10 { .. }, CFRuleType::Top10) => {}
            (CFRuleKind::AboveAverage { .. }, CFRuleType::AboveAverage) => {}
            (CFRuleKind::DuplicateValues { .. }, CFRuleType::DuplicateValues) => {}
            (CFRuleKind::ContainsText { .. }, CFRuleType::ContainsText) => {}
            (CFRuleKind::ContainsBlanks { .. }, CFRuleType::ContainsBlanks) => {}
            (CFRuleKind::ContainsErrors { .. }, CFRuleType::ContainsErrors) => {}
            (CFRuleKind::TimePeriod { .. }, CFRuleType::TimePeriod) => {}
            (kind, expected) => {
                panic!(
                    "Variant mismatch: got {:?} but expected {:?}",
                    std::mem::discriminant(kind),
                    expected
                );
            }
        }
    }
}

// -----------------------------------------------------------------------
// CfRenderStyle serialization with camelCase
// -----------------------------------------------------------------------

#[test]
fn test_cf_style_camel_case_serde() {
    let style = CfRenderStyle {
        background_color: Some(Color::from_hex("#AABBCC").unwrap()),
        font_color: Some(Color::from_hex("#112233").unwrap()),
        bold: Some(true),
        italic: Some(false),
        underline_type: Some(CFUnderlineType::Single),
        strikethrough: Some(true),
        border_color: Some(Color::from_hex("#445566").unwrap()),
        border_style: Some(CFBorderStyle::Thick),
        number_format: None,
        ..Default::default()
    };

    let json = serde_json::to_string(&style).unwrap();
    assert!(json.contains("\"backgroundColor\""));
    assert!(json.contains("\"fontColor\""));
    assert!(json.contains("\"underlineType\""));
    assert!(json.contains("\"borderColor\""));
    assert!(json.contains("\"borderStyle\""));

    // Round-trip
    let parsed: CfRenderStyle = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, style);
}

#[test]
fn test_cf_style_skip_serializing_none_fields() {
    let style = CfRenderStyle {
        background_color: Some(Color::from_hex("#FF0000").unwrap()),
        bold: Some(true),
        ..Default::default()
    };

    let json = serde_json::to_string(&style).unwrap();
    // Present fields should be serialized
    assert!(json.contains("\"backgroundColor\":\"#ff0000\""));
    assert!(json.contains("\"bold\":true"));
    // None fields should be skipped
    assert!(
        !json.contains("fontColor"),
        "fontColor should be skipped when None"
    );
    assert!(
        !json.contains("italic"),
        "italic should be skipped when None"
    );
    assert!(
        !json.contains("underlineType"),
        "underlineType should be skipped when None"
    );
    assert!(
        !json.contains("strikethrough"),
        "strikethrough should be skipped when None"
    );
    assert!(
        !json.contains("borderColor"),
        "borderColor should be skipped when None"
    );
    assert!(
        !json.contains("borderStyle"),
        "borderStyle should be skipped when None"
    );
    assert!(
        !json.contains("numberFormat"),
        "numberFormat should be skipped when None"
    );

    // Round-trip still works
    let parsed: CfRenderStyle = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, style);
}

#[test]
fn test_data_bar_result_skip_serializing_none_option_fields() {
    let result = DataBarResult {
        fill_percent: 50.0,
        color: Color::rgb(255, 0, 0),
        gradient: false,
        axis_position: 0.0,
        is_negative: false,
        negative_color: None,
        show_value: true,
        show_axis: false,
        border_color: None,
        negative_border_color: None,
        show_border: false,
        direction: CFDataBarDirection::LeftToRight,
        axis_color: None,
    };

    let json = serde_json::to_string(&result).unwrap();
    // None Option fields should be skipped
    assert!(
        !json.contains("negativeColor"),
        "negativeColor should be skipped when None"
    );
    assert!(
        !json.contains("borderColor"),
        "borderColor should be skipped when None"
    );
    assert!(
        !json.contains("negativeBorderColor"),
        "negativeBorderColor should be skipped when None"
    );
    assert!(
        !json.contains("axisColor"),
        "axisColor should be skipped when None"
    );
    // Non-option fields should still be present
    assert!(json.contains("\"fillPercent\":50.0"));
    assert!(json.contains("\"showValue\":true"));
}

// -----------------------------------------------------------------------
// DataBarResult serialization
// -----------------------------------------------------------------------

#[test]
fn test_data_bar_result_serialization() {
    let result = DataBarResult {
        fill_percent: 75.5,
        color: Color::rgb(100, 200, 50),
        gradient: true,
        axis_position: 25.0,
        is_negative: false,
        negative_color: Some(Color::rgb(255, 0, 0)),
        show_value: true,
        show_axis: true,
        border_color: None,
        negative_border_color: None,
        show_border: false,
        direction: CFDataBarDirection::LeftToRight,
        axis_color: None,
    };

    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("\"fillPercent\":75.5"));
    assert!(json.contains("\"gradient\":true"));
    assert!(json.contains("\"axisPosition\":25.0"));
    assert!(json.contains("\"isNegative\":false"));
    assert!(json.contains("\"showValue\":true"));
    assert!(json.contains("\"showAxis\":true"));
}

// -----------------------------------------------------------------------
// TryFrom error cases: missing required fields
// -----------------------------------------------------------------------

#[test]
fn test_try_from_color_scale_missing_field() {
    let json = r#"{"ruleType":"colorScale","priority":1,"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("colorScale"));
}

#[test]
fn test_try_from_data_bar_missing_field() {
    let json = r#"{"ruleType":"dataBar","priority":1,"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("dataBar"));
}

#[test]
fn test_try_from_icon_set_missing_field() {
    let json = r#"{"ruleType":"iconSet","priority":1,"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("iconSet"));
}

#[test]
fn test_try_from_contains_text_missing_operator() {
    let json = r#"{"ruleType":"containsText","priority":1,"text":"hello","style":{},"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("textOperator"));
}

#[test]
fn test_try_from_time_period_missing_period() {
    let json = r#"{"ruleType":"timePeriod","priority":1,"style":{},"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("datePeriod"));
}

#[test]
fn test_try_from_formula_empty_string_errors() {
    let json = r#"{"ruleType":"formula","priority":1,"formula":"  ","style":{},"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("formula"));
}

#[test]
fn test_try_from_formula_missing_field_errors() {
    let json = r#"{"ruleType":"formula","priority":1,"style":{},"ranges":[]}"#;
    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("formula"));
}

// -----------------------------------------------------------------------
// Serde defaults: DataBar wire with minimal fields
// -----------------------------------------------------------------------

#[test]
fn test_data_bar_wire_deser_minimal() {
    let json = r##"{
        "ruleType": "dataBar",
        "priority": 1,
        "dataBar": {
            "minPoint": { "type": "min", "color": "#000000" },
            "maxPoint": { "type": "max", "color": "#000000" },
            "positiveColor": "#638EC6"
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::DataBar(db) => {
            assert_eq!(db.positive_color, Color::from_hex("#638EC6").unwrap());
            assert!(!db.show_border);
            assert!(!db.gradient);
            assert_eq!(db.direction, CFDataBarDirection::LeftToRight);
            assert_eq!(db.axis_position, CFDataBarAxisPosition::Automatic);
            assert!(db.show_value);
            assert_eq!(db.min_length, 10);
            assert_eq!(db.max_length, 90);
            assert!(db.negative_color.is_none());
            assert!(db.border_color.is_none());
            assert!(db.axis_color.is_none());
        }
        _ => panic!("Expected DataBar variant"),
    }
}

#[test]
fn test_icon_set_wire_deser_minimal() {
    // NoIcons has icon_count == 0, so empty thresholds are valid
    let json = r#"{
        "ruleType": "iconSet",
        "priority": 1,
        "iconSet": {
            "iconSetName": "NoIcons",
            "thresholds": []
        },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::IconSet(is) => {
            assert_eq!(is.icon_set_name, CFIconSetName::NoIcons);
            assert!(!is.reverse_order);
            assert!(!is.show_icon_only);
        }
        _ => panic!("Expected IconSet variant"),
    }
}

// -----------------------------------------------------------------------
// OOXML serde aliases for CFRuleType
// -----------------------------------------------------------------------

#[test]
fn test_ooxml_alias_expression_deserializes_as_formula() {
    let json: CFRuleType = serde_json::from_str(r#""expression""#).unwrap();
    assert_eq!(json, CFRuleType::Formula);
}

#[test]
fn test_ooxml_alias_not_contains_text() {
    let json: CFRuleType = serde_json::from_str(r#""notContainsText""#).unwrap();
    assert_eq!(json, CFRuleType::NotContainsText);
}

#[test]
fn test_ooxml_alias_begins_with() {
    let json: CFRuleType = serde_json::from_str(r#""beginsWith""#).unwrap();
    assert_eq!(json, CFRuleType::BeginsWith);
}

#[test]
fn test_ooxml_alias_ends_with() {
    let json: CFRuleType = serde_json::from_str(r#""endsWith""#).unwrap();
    assert_eq!(json, CFRuleType::EndsWith);
}

// -----------------------------------------------------------------------
// New rule type deserialization
// -----------------------------------------------------------------------

#[test]
fn test_deser_not_contains_blanks() {
    let json: CFRuleType = serde_json::from_str(r#""notContainsBlanks""#).unwrap();
    assert_eq!(json, CFRuleType::NotContainsBlanks);
}

#[test]
fn test_deser_not_contains_errors() {
    let json: CFRuleType = serde_json::from_str(r#""notContainsErrors""#).unwrap();
    assert_eq!(json, CFRuleType::NotContainsErrors);
}

// -----------------------------------------------------------------------
// New CFBorderStyle variants
// -----------------------------------------------------------------------

#[test]
fn test_new_border_style_variants_serde() {
    let variants = vec![
        (CFBorderStyle::None, "\"none\""),
        (CFBorderStyle::Double, "\"double\""),
        (CFBorderStyle::Hair, "\"hair\""),
        (CFBorderStyle::MediumDashed, "\"mediumDashed\""),
        (CFBorderStyle::DashDot, "\"dashDot\""),
        (CFBorderStyle::MediumDashDot, "\"mediumDashDot\""),
        (CFBorderStyle::DashDotDot, "\"dashDotDot\""),
        (CFBorderStyle::MediumDashDotDot, "\"mediumDashDotDot\""),
        (CFBorderStyle::SlantDashDot, "\"slantDashDot\""),
    ];

    for (variant, expected_json) in variants {
        let serialized = serde_json::to_string(&variant).unwrap();
        assert_eq!(
            serialized, expected_json,
            "Serialize mismatch for {:?}",
            variant
        );

        let deserialized: CFBorderStyle = serde_json::from_str(expected_json).unwrap();
        assert_eq!(
            deserialized, variant,
            "Deserialize mismatch for {}",
            expected_json
        );
    }
}

// -----------------------------------------------------------------------
// TryFrom for new rule types
// -----------------------------------------------------------------------

#[test]
fn test_try_from_not_contains_text() {
    let json = r#"{
        "ruleType": "notContainsText",
        "priority": 1,
        "text": "HELLO",
        "style": { "bold": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { operator, text } => {
            assert_eq!(*operator, CFTextOperator::NotContains);
            assert_eq!(text, "hello");
        }
        _ => panic!("Expected ContainsText variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().bold, Some(true));
}

#[test]
fn test_try_from_begins_with() {
    let json = r#"{
        "ruleType": "beginsWith",
        "priority": 1,
        "text": "Prefix",
        "style": {},
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { operator, text, .. } => {
            assert_eq!(*operator, CFTextOperator::BeginsWith);
            assert_eq!(text, "prefix");
        }
        _ => panic!("Expected ContainsText variant"),
    }
}

#[test]
fn test_try_from_ends_with() {
    let json = r#"{
        "ruleType": "endsWith",
        "priority": 1,
        "text": "Suffix",
        "style": {},
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { operator, text, .. } => {
            assert_eq!(*operator, CFTextOperator::EndsWith);
            assert_eq!(text, "suffix");
        }
        _ => panic!("Expected ContainsText variant"),
    }
}

#[test]
fn test_try_from_not_contains_blanks() {
    let json = r##"{
        "ruleType": "notContainsBlanks",
        "priority": 1,
        "style": { "backgroundColor": "#00FF00" },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsBlanks { blanks } => {
            assert!(!*blanks);
        }
        _ => panic!("Expected ContainsBlanks variant"),
    }
    assert_eq!(
        rule.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#00FF00").unwrap())
    );
}

#[test]
fn test_try_from_not_contains_errors() {
    let json = r#"{
        "ruleType": "notContainsErrors",
        "priority": 1,
        "style": { "italic": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsErrors { errors } => {
            assert!(!*errors);
        }
        _ => panic!("Expected ContainsErrors variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().italic, Some(true));
}

// -----------------------------------------------------------------------
// Text pre-lowercasing in TryFrom
// -----------------------------------------------------------------------

#[test]
fn test_contains_text_pre_lowercases() {
    let json = r##"{
        "ruleType": "containsText",
        "priority": 1,
        "textOperator": "contains",
        "text": "HELLO",
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { text, .. } => {
            assert_eq!(text, "hello");
        }
        _ => panic!("Expected ContainsText variant"),
    }
}

#[test]
fn test_contains_text_mixed_case_lowercased() {
    let json = r##"{
        "ruleType": "containsText",
        "priority": 1,
        "textOperator": "contains",
        "text": "HeLLo WoRLd",
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ContainsText { text, .. } => {
            assert_eq!(text, "hello world");
        }
        _ => panic!("Expected ContainsText variant"),
    }
}

// -----------------------------------------------------------------------
// OOXML alias wire -> internal round-trip (expression alias)
// -----------------------------------------------------------------------

#[test]
fn test_expression_alias_wire_to_internal() {
    let json = r#"{
        "ruleType": "expression",
        "priority": 1,
        "formula": "=B1>0",
        "style": { "bold": true },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    assert_eq!(wire.rule_type, CFRuleType::Formula);

    let rule: CFRule = CFRule::try_from(wire).unwrap();
    match &rule.kind {
        CFRuleKind::Formula { formula } => {
            assert_eq!(formula, "=B1>0");
        }
        _ => panic!("Expected Formula variant"),
    }
    assert_eq!(rule.style.as_ref().unwrap().bold, Some(true));
}

// -----------------------------------------------------------------------
// std::error::Error impl for CFRuleValidationError
// -----------------------------------------------------------------------

#[test]
fn test_cf_rule_validation_error_is_std_error() {
    let err: Box<dyn std::error::Error> = Box::new(CFRuleValidationError::MissingOperator);
    assert!(err.to_string().contains("operator"));
}

// =======================================================================
// NEW validation error tests
// =======================================================================

#[test]
fn test_invalid_color_error() {
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "min", "color": "not-a-color" },
            "maxPoint": { "type": "max", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::InvalidColor(c) => assert_eq!(c, "not-a-color"),
        _ => panic!("Expected InvalidColor, got {:?}", err),
    }
    assert!(err.to_string().contains("not-a-color"));
}

#[test]
fn test_invalid_threshold_value_error() {
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "number", "value": "abc", "color": "#FF0000" },
            "maxPoint": { "type": "max", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::InvalidThresholdValue(v) => assert_eq!(v, "abc"),
        _ => panic!("Expected InvalidThresholdValue, got {:?}", err),
    }
}

#[test]
fn test_cell_value_arity_between_needs_2() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["10"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::InvalidCellValueArity {
            operator,
            expected,
            got,
        } => {
            assert_eq!(*operator, CFOperator::Between);
            assert_eq!(*expected, 2);
            assert_eq!(*got, 1);
        }
        _ => panic!("Expected InvalidCellValueArity, got {:?}", err),
    }
}

#[test]
fn test_cell_value_arity_single_needs_1() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "greaterThan",
        "values": [],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::InvalidCellValueArity {
            operator,
            expected,
            got,
        } => {
            assert_eq!(*operator, CFOperator::GreaterThan);
            assert_eq!(*expected, 1);
            assert_eq!(*got, 0);
        }
        _ => panic!("Expected InvalidCellValueArity, got {:?}", err),
    }
}

#[test]
fn test_between_values_not_numeric() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["10", "abc"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "abc");
        }
        _ => panic!("Expected BetweenValuesNotNumeric, got {:?}", err),
    }
}

#[test]
fn test_between_rejects_nan() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["NaN", "10"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "NaN");
        }
        _ => panic!("Expected BetweenValuesNotNumeric, got {:?}", err),
    }
}

#[test]
fn test_between_rejects_infinity() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["10", "Infinity"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "Infinity");
        }
        _ => panic!("Expected BetweenValuesNotNumeric, got {:?}", err),
    }
}

#[test]
fn test_not_between_rejects_negative_infinity() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "notBetween",
        "values": ["-Infinity", "10"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "-Infinity");
        }
        _ => panic!("Expected BetweenValuesNotNumeric, got {:?}", err),
    }
}

#[test]
fn test_data_bar_min_length_exceeds_max() {
    let json = r##"{
        "ruleType": "dataBar",
        "priority": 1,
        "dataBar": {
            "minPoint": { "type": "min", "color": "#000000" },
            "maxPoint": { "type": "max", "color": "#000000" },
            "positiveColor": "#638EC6",
            "minLength": 95,
            "maxLength": 10
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::DataBarMinLengthExceedsMax {
            min_length,
            max_length,
        } => {
            assert_eq!(*min_length, 95);
            assert_eq!(*max_length, 10);
        }
        _ => panic!("Expected DataBarMinLengthExceedsMax, got {:?}", err),
    }
}

#[test]
fn test_icon_set_threshold_count_mismatch() {
    // 3Arrows needs 2 thresholds (icon_count - 1 = 3 - 1 = 2)
    let json = r#"{
        "ruleType": "iconSet",
        "priority": 1,
        "iconSet": {
            "iconSetName": "3Arrows",
            "thresholds": [
                { "type": "percent", "value": "33", "operator": "greaterThanOrEqual" }
            ],
            "reverseOrder": false,
            "showIconOnly": false
        },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_err());
    let err = result.unwrap_err();
    match &err {
        CFRuleValidationError::IconSetThresholdCountMismatch { expected, got } => {
            assert_eq!(*expected, 2);
            assert_eq!(*got, 1);
        }
        _ => panic!("Expected IconSetThresholdCountMismatch, got {:?}", err),
    }
}

#[test]
fn test_icon_set_no_icons_allows_empty_thresholds() {
    let json = r#"{
        "ruleType": "iconSet",
        "priority": 1,
        "iconSet": {
            "iconSetName": "NoIcons",
            "thresholds": [],
            "reverseOrder": false,
            "showIconOnly": false
        },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_ok());
}

#[test]
fn test_icon_set_custom_allows_any_thresholds() {
    let json = r#"{
        "ruleType": "iconSet",
        "priority": 1,
        "iconSet": {
            "iconSetName": "Custom",
            "thresholds": [
                { "type": "percent", "value": "50", "operator": "greaterThanOrEqual" }
            ],
            "reverseOrder": false,
            "showIconOnly": false
        },
        "ranges": []
    }"#;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);
    assert!(result.is_ok());
}

// -----------------------------------------------------------------------
// Color point parsing for Formula value type
// -----------------------------------------------------------------------

#[test]
fn test_color_point_formula_type_non_numeric_value() {
    // Formula type with non-numeric value should not error (value=None)
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "formula", "value": "=A1+B1", "color": "#FF0000" },
            "maxPoint": { "type": "max", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ColorScale(cs) => {
            assert_eq!(cs.min_point.value_type, CFValueType::Formula);
            assert_eq!(cs.min_point.value, None); // formula string doesn't parse as f64
        }
        _ => panic!("Expected ColorScale variant"),
    }
}

#[test]
fn test_color_point_formula_type_numeric_value() {
    // Formula type with numeric value should parse successfully
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "formula", "value": "42.5", "color": "#FF0000" },
            "maxPoint": { "type": "max", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ColorScale(cs) => {
            assert_eq!(cs.min_point.value_type, CFValueType::Formula);
            assert_eq!(cs.min_point.value, Some(42.5));
        }
        _ => panic!("Expected ColorScale variant"),
    }
}

// -----------------------------------------------------------------------
// NotBetween
// -----------------------------------------------------------------------

#[test]
fn test_wire_to_internal_cell_value_not_between() {
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "notBetween",
        "values": ["5", "15"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::CellValue { comparison, .. } => match comparison {
            CellValueComparison::NotBetween { low, high } => {
                assert_eq!(*low, 5.0);
                assert_eq!(*high, 15.0);
            }
            _ => panic!("Expected NotBetween variant"),
        },
        _ => panic!("Expected CellValue variant"),
    }
}

// -----------------------------------------------------------------------
// DataBar with all color fields
// -----------------------------------------------------------------------

#[test]
fn test_data_bar_full_colors() {
    let json = r##"{
        "ruleType": "dataBar",
        "priority": 1,
        "dataBar": {
            "minPoint": { "type": "min", "color": "#000000" },
            "maxPoint": { "type": "max", "color": "#FFFFFF" },
            "positiveColor": "#638EC6",
            "negativeColor": "#FF0000",
            "borderColor": "#333333",
            "negativeBorderColor": "#990000",
            "axisColor": "#808080",
            "showBorder": true,
            "gradient": true,
            "direction": "rightToLeft",
            "axisPosition": "midpoint",
            "showValue": false,
            "minLength": 5,
            "maxLength": 95
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::DataBar(db) => {
            assert_eq!(db.positive_color, Color::from_hex("#638EC6").unwrap());
            assert_eq!(db.negative_color, Some(Color::from_hex("#FF0000").unwrap()));
            assert_eq!(db.border_color, Some(Color::from_hex("#333333").unwrap()));
            assert_eq!(
                db.negative_border_color,
                Some(Color::from_hex("#990000").unwrap())
            );
            assert_eq!(db.axis_color, Some(Color::from_hex("#808080").unwrap()));
            assert!(db.show_border);
            assert!(db.gradient);
            assert_eq!(db.direction, CFDataBarDirection::RightToLeft);
            assert_eq!(db.axis_position, CFDataBarAxisPosition::Midpoint);
            assert!(!db.show_value);
            assert_eq!(db.min_length, 5);
            assert_eq!(db.max_length, 95);
        }
        _ => panic!("Expected DataBar variant"),
    }
}

// -----------------------------------------------------------------------
// Output type PartialEq
// -----------------------------------------------------------------------

#[test]
fn test_output_types_partial_eq() {
    let db1 = DataBarResult {
        fill_percent: 50.0,
        color: Color::rgb(255, 0, 0),
        gradient: false,
        axis_position: 0.0,
        is_negative: false,
        negative_color: None,
        show_value: true,
        show_axis: false,
        border_color: None,
        negative_border_color: None,
        show_border: false,
        direction: CFDataBarDirection::LeftToRight,
        axis_color: None,
    };
    let db2 = db1.clone();
    assert_eq!(db1, db2);

    let cs1 = ColorScaleResult {
        color: Color::rgb(128, 128, 128),
    };
    let cs2 = cs1.clone();
    assert_eq!(cs1, cs2);

    let icon1 = IconResult {
        set_name: CFIconSetName::ThreeArrows,
        icon_index: 1,
        show_value: true,
    };
    let icon2 = icon1.clone();
    assert_eq!(icon1, icon2);
}

// -----------------------------------------------------------------------
// All CellValueSingleOp variants via wire
// -----------------------------------------------------------------------

#[test]
fn test_all_single_ops() {
    let ops = vec![
        ("greaterThan", CellValueSingleOp::GreaterThan),
        ("lessThan", CellValueSingleOp::LessThan),
        ("greaterThanOrEqual", CellValueSingleOp::GreaterThanOrEqual),
        ("lessThanOrEqual", CellValueSingleOp::LessThanOrEqual),
        ("equal", CellValueSingleOp::Equal),
        ("notEqual", CellValueSingleOp::NotEqual),
    ];

    for (op_str, expected_op) in ops {
        let json = format!(
            r#"{{"ruleType":"cellValue","priority":1,"operator":"{}","values":["42"],"style":{{}},"ranges":[]}}"#,
            op_str
        );
        let wire: CFRuleWire = serde_json::from_str(&json).unwrap();
        let rule: CFRule = CFRule::try_from(wire).unwrap();

        match &rule.kind {
            CFRuleKind::CellValue { comparison, .. } => match comparison {
                CellValueComparison::Single { operator, .. } => {
                    assert_eq!(*operator, expected_op, "Mismatch for op '{}'", op_str);
                }
                _ => panic!("Expected Single variant for op '{}'", op_str),
            },
            _ => panic!("Expected CellValue variant for op '{}'", op_str),
        }
    }
}

// -----------------------------------------------------------------------
// Validation error Display coverage
// -----------------------------------------------------------------------

#[test]
fn test_validation_error_display_all_variants() {
    let errors: Vec<CFRuleValidationError> = vec![
        CFRuleValidationError::MissingOperator,
        CFRuleValidationError::MissingFormula,
        CFRuleValidationError::MissingColorScale,
        CFRuleValidationError::MissingDataBar,
        CFRuleValidationError::MissingIconSet,
        CFRuleValidationError::MissingTimePeriod,
        CFRuleValidationError::MissingTextOperator,
        CFRuleValidationError::InvalidColor("bad".to_string()),
        CFRuleValidationError::InvalidThresholdValue("xyz".to_string()),
        CFRuleValidationError::InvalidCellValueArity {
            operator: CFOperator::Between,
            expected: 2,
            got: 1,
        },
        CFRuleValidationError::BetweenValuesNotNumeric {
            value: "abc".to_string(),
        },
        CFRuleValidationError::DataBarMinLengthExceedsMax {
            min_length: 95,
            max_length: 10,
        },
        CFRuleValidationError::IconSetThresholdCountMismatch {
            expected: 2,
            got: 1,
        },
    ];

    for err in errors {
        // Just verify Display doesn't panic and produces non-empty output
        let msg = err.to_string();
        assert!(!msg.is_empty(), "Empty display for {:?}", err);
    }
}

// -----------------------------------------------------------------------
// CFMatchResult::into_cell_result
// -----------------------------------------------------------------------

#[test]
fn test_cf_match_result_into_cell_result_full() {
    // CFMatchResult carries style + visual results without position info.
    // into_cell_result() should stamp row/col and transfer all fields.
    let style = CfRenderStyle {
        background_color: Some(Color::from_hex("#FF0000").unwrap()),
        bold: Some(true),
        ..Default::default()
    };
    let data_bar = DataBarResult {
        fill_percent: 75.0,
        color: Color::rgba(0, 128, 255, 255),
        gradient: true,
        axis_position: 0.0,
        is_negative: false,
        negative_color: None,
        show_value: true,
        show_axis: false,
        border_color: None,
        negative_border_color: None,
        show_border: false,
        direction: CFDataBarDirection::LeftToRight,
        axis_color: None,
    };

    let match_result = CFMatchResult {
        style: Some(style.clone()),
        data_bar: Some(data_bar.clone()),
        color_scale: Some(ColorScaleResult {
            color: Color::rgb(255, 128, 0),
        }),
        icon: Some(IconResult {
            set_name: CFIconSetName::ThreeArrows,
            icon_index: 2,
            show_value: false,
        }),
    };

    let cell_result = match_result.into_cell_result(7, 3);

    // Position must be stamped
    assert_eq!(cell_result.row, 7);
    assert_eq!(cell_result.col, 3);

    // All fields must transfer
    assert_eq!(cell_result.style.as_ref().unwrap().bold, Some(true));
    assert_eq!(
        cell_result.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(cell_result.data_bar.as_ref().unwrap().fill_percent, 75.0);
    assert!(cell_result.data_bar.as_ref().unwrap().gradient);
    assert_eq!(
        cell_result.color_scale.as_ref().unwrap().color,
        Color::rgb(255, 128, 0)
    );
    assert_eq!(cell_result.icon.as_ref().unwrap().icon_index, 2);
    assert!(!cell_result.icon.as_ref().unwrap().show_value);
}

#[test]
fn test_cf_match_result_into_cell_result_empty() {
    // An empty CFMatchResult (no rules matched) should produce an empty CellCFResult
    let match_result = CFMatchResult::default();
    let cell_result = match_result.into_cell_result(0, 0);

    assert_eq!(cell_result.row, 0);
    assert_eq!(cell_result.col, 0);
    assert!(!cell_result.has_any());
}

// -----------------------------------------------------------------------
// Wire conversion: Number-type point with missing value returns Ok(None)
// -----------------------------------------------------------------------

#[test]
fn test_wire_color_scale_number_point_missing_value() {
    // A Number-type color point with no value should convert successfully
    // with value = None rather than erroring, since the wire format allows
    // it and the runtime can fall back to defaults.
    let json = r##"{
        "ruleType": "colorScale",
        "priority": 1,
        "colorScale": {
            "minPoint": { "type": "number", "color": "#FF0000" },
            "maxPoint": { "type": "number", "value": "100", "color": "#00FF00" }
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::ColorScale(cs) => {
            // minPoint has type=Number but no value — should be None
            assert_eq!(cs.min_point.value_type, CFValueType::Number);
            assert_eq!(cs.min_point.value, None);
            // maxPoint has value=100
            assert_eq!(cs.max_point.value_type, CFValueType::Number);
            assert_eq!(cs.max_point.value, Some(100.0));
        }
        _ => panic!("Expected ColorScale variant"),
    }
}

#[test]
fn test_wire_data_bar_percentile_point_missing_value() {
    // Same test for data bar: a Percentile-type point with no value
    let json = r##"{
        "ruleType": "dataBar",
        "priority": 1,
        "dataBar": {
            "minPoint": { "type": "percentile", "color": "#000000" },
            "maxPoint": { "type": "percentile", "value": "90", "color": "#000000" },
            "positiveColor": "#638EC6",
            "showBorder": false,
            "gradient": true,
            "direction": "leftToRight",
            "axisPosition": "automatic",
            "showValue": true
        },
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let rule: CFRule = CFRule::try_from(wire).unwrap();

    match &rule.kind {
        CFRuleKind::DataBar(db) => {
            assert_eq!(db.min_point.value_type, CFValueType::Percentile);
            assert_eq!(db.min_point.value, None);
            assert_eq!(db.max_point.value, Some(90.0));
        }
        _ => panic!("Expected DataBar variant"),
    }
}

// -----------------------------------------------------------------------
// Between with non-numeric values produces BetweenValuesNotNumeric error
// -----------------------------------------------------------------------

#[test]
fn test_wire_between_non_numeric_first_value() {
    // In Excel, Between/NotBetween CF rules require numeric thresholds.
    // Non-numeric values like "abc" should produce a validation error.
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["abc", "100"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);

    assert!(result.is_err());
    match result.unwrap_err() {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "abc");
        }
        other => panic!("Expected BetweenValuesNotNumeric, got {:?}", other),
    }
}

#[test]
fn test_wire_between_non_numeric_second_value() {
    // Second value is non-numeric
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "between",
        "values": ["10", "xyz"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);

    assert!(result.is_err());
    match result.unwrap_err() {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            assert_eq!(value, "xyz");
        }
        other => panic!("Expected BetweenValuesNotNumeric, got {:?}", other),
    }
}

#[test]
fn test_wire_not_between_non_numeric_values() {
    // NotBetween operator should also reject non-numeric values
    let json = r##"{
        "ruleType": "cellValue",
        "priority": 1,
        "operator": "notBetween",
        "values": ["hello", "world"],
        "style": {},
        "ranges": []
    }"##;

    let wire: CFRuleWire = serde_json::from_str(json).unwrap();
    let result = CFRule::try_from(wire);

    assert!(result.is_err());
    match result.unwrap_err() {
        CFRuleValidationError::BetweenValuesNotNumeric { value } => {
            // First non-numeric value should be reported
            assert_eq!(value, "hello");
        }
        other => panic!("Expected BetweenValuesNotNumeric, got {:?}", other),
    }
}

// =========================================================================
// Typed formula boundary: non-ASCII regression (CfValue boundary)
// =========================================================================

#[test]
fn test_wire_cell_value_non_ascii_text_round_trip() {
    // Greek / CJK / emoji CF text-compare thresholds must round-trip
    // through `CFRuleWire.values: Vec<CfValue>` and land in the
    // internal `CellValueComparison` shape without byte-boundary
    // surprises. Before W8, `json_value_to_string` collapsed these
    // to strings and `.parse::<f64>()` yielded NaN on the numeric
    // path; W8's typed `CfValue::Text` preserves the text directly.
    for threshold in [
        "Πλήρης_Εκτύπωση", // Greek
        "日本語",          // CJK
        "🚀 rocket",       // emoji + Latin mix
        "μμμμμμ",          // multi-byte UTF-8 repeat
    ] {
        let json = format!(
            r##"{{
                "ruleType": "cellValue",
                "priority": 1,
                "operator": "equal",
                "values": ["{threshold}"],
                "style": {{}},
                "ranges": []
            }}"##
        );

        let wire: CFRuleWire = serde_json::from_str(&json).unwrap();
        let rule: CFRule = CFRule::try_from(wire).unwrap();

        match &rule.kind {
            CFRuleKind::CellValue { comparison, .. } => match comparison {
                CellValueComparison::Single {
                    operator,
                    threshold: t,
                } => {
                    assert_eq!(*operator, CellValueSingleOp::Equal);
                    assert_eq!(t.text, threshold);
                    assert_eq!(t.number, None);
                }
                _ => panic!("Expected Single variant for threshold {threshold:?}"),
            },
            _ => panic!("Expected CellValue variant for threshold {threshold:?}"),
        }
    }
}
