use super::*;

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
