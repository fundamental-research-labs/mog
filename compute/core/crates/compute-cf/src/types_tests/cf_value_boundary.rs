use super::*;

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
