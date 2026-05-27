use super::*;

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
