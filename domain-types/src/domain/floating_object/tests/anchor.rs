use crate::domain::floating_object::{AnchorMode, FloatingObjectAnchor};

#[test]
fn test_anchor_mode_serialization() {
    assert_eq!(
        serde_json::to_string(&AnchorMode::OneCell).unwrap(),
        r#""oneCell""#
    );
    assert_eq!(
        serde_json::to_string(&AnchorMode::TwoCell).unwrap(),
        r#""twoCell""#
    );
    assert_eq!(
        serde_json::to_string(&AnchorMode::Absolute).unwrap(),
        r#""absolute""#
    );

    let am: AnchorMode = serde_json::from_str(r#""twoCell""#).unwrap();
    assert_eq!(am, AnchorMode::TwoCell);
}

#[test]
fn test_floating_object_anchor_typed_round_trip_cases() {
    let cases = [
        FloatingObjectAnchor {
            anchor_row: 1,
            anchor_col: 2,
            anchor_row_offset: 10,
            anchor_col_offset: 20,
            anchor_mode: AnchorMode::OneCell,
            extent_cx: Some(1_143_000),
            extent_cy: Some(762_000),
            ..Default::default()
        },
        FloatingObjectAnchor {
            anchor_row: 4,
            anchor_col: 1,
            anchor_row_offset: 30,
            anchor_col_offset: 40,
            anchor_mode: AnchorMode::TwoCell,
            end_row: Some(9),
            end_col: Some(5),
            end_row_offset: Some(50),
            end_col_offset: Some(60),
            ..Default::default()
        },
        FloatingObjectAnchor {
            anchor_mode: AnchorMode::Absolute,
            absolute_x: Some(321_000),
            absolute_y: Some(654_000),
            extent_cx: Some(952_500),
            extent_cy: Some(476_250),
            ..Default::default()
        },
    ];

    for anchor in cases {
        let json = serde_json::to_value(&anchor).expect("serialize anchor");
        let restored: FloatingObjectAnchor =
            serde_json::from_value(json).expect("deserialize anchor");
        assert_eq!(restored, anchor);
    }
}
