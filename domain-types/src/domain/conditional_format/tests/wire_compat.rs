use super::*;

/// Locks the wire-compat invariant: the on-wire form of the
/// `operator` field is the OOXML token string `"greaterThan"`, not a
/// Rust variant name or PascalCase rendering.
#[test]
fn cell_value_operator_wire_shape() {
    let rule = CFRule::CellValue {
        id: "r1".into(),
        priority: 1,
        stop_if_true: None,
        operator: CfOperator::GreaterThan,
        value1: serde_json::json!(100),
        value2: None,
        style: CFStyle::default(),
        text: None,
    };
    let v: serde_json::Value = serde_json::to_value(&rule).unwrap();
    assert_eq!(v["operator"], "greaterThan");
}

/// Locks the wire-compat invariant for ContainsText: the `operator`
/// field serializes to the OOXML token string (e.g. `"containsText"`),
/// not a Rust variant name.
#[test]
fn contains_text_operator_wire_shape() {
    let rule = CFRule::ContainsText {
        id: "r9".into(),
        priority: 9,
        stop_if_true: None,
        operator: CfOperator::ContainsText,
        text: "hello".into(),
        style: CFStyle::default(),
        formula: None,
    };
    let v: serde_json::Value = serde_json::to_value(&rule).unwrap();
    assert_eq!(v["operator"], "containsText");
}

/// Locks the wire-compat invariant for TimePeriod: the
/// `time_period` field serializes to the OOXML token string, and reads
/// back as the same enum variant.
#[test]
fn time_period_wire_shape() {
    let rule = CFRule::TimePeriod {
        id: "r12".into(),
        priority: 14,
        stop_if_true: None,
        time_period: CfTimePeriod::Last7Days,
        style: CFStyle::default(),
        formula: None,
    };
    let v: serde_json::Value = serde_json::to_value(&rule).unwrap();
    assert_eq!(v["timePeriod"], "last7Days");
    let back: CFRule = serde_json::from_value(v).unwrap();
    match back {
        CFRule::TimePeriod { time_period, .. } => {
            assert_eq!(time_period, CfTimePeriod::Last7Days)
        }
        _ => panic!("unexpected variant"),
    }
}

#[test]
fn tag_discriminator_is_type() {
    let rule = CFRule::CellValue {
        id: "r1".into(),
        priority: 1,
        stop_if_true: None,
        operator: CfOperator::GreaterThan,
        value1: serde_json::json!(100),
        value2: None,
        style: CFStyle::default(),
        text: None,
    };
    let json: serde_json::Value = serde_json::to_value(&rule).unwrap();
    assert_eq!(json["type"], "cellValue");
}

#[test]
fn cf_style_legacy_underline_bool_deserializes() {
    // Old Yrs documents store `"underline": true` — must still parse.
    let json = r#"{"underline":true,"bold":true}"#;
    let style: CFStyle = serde_json::from_str(json).unwrap();
    assert_eq!(style.underline_legacy, Some(true));
    assert_eq!(style.bold, Some(true));
}

#[test]
fn cf_style_typed_enum_wire_is_ooxml_token() {
    // CFStyle.underline_type / .border_style are typed ooxml enums; the
    // serde wire format must still be OOXML token strings byte-for-byte so
    // legacy Yrs/JSON docs continue to deserialize correctly.
    let style = CFStyle {
        underline_type: Some(UnderlineStyle::DoubleAccounting),
        border_style: Some(BorderStyle::MediumDashDotDot),
        ..Default::default()
    };
    let json = serde_json::to_value(&style).unwrap();
    assert_eq!(json["underlineType"], "doubleAccounting");
    assert_eq!(json["borderStyle"], "mediumDashDotDot");

    let rt: CFStyle = serde_json::from_value(json).unwrap();
    assert_eq!(rt.underline_type, Some(UnderlineStyle::DoubleAccounting));
    assert_eq!(rt.border_style, Some(BorderStyle::MediumDashDotDot));
}

#[test]
fn cf_style_legacy_string_tokens_deserialize_into_typed_enum() {
    // A legacy document with string values for underlineType / borderStyle
    // must still deserialize into the typed enum.
    let json = r#"{"underlineType":"single","borderStyle":"thin"}"#;
    let style: CFStyle = serde_json::from_str(json).unwrap();
    assert_eq!(style.underline_type, Some(UnderlineStyle::Single));
    assert_eq!(style.border_style, Some(BorderStyle::Thin));
}
