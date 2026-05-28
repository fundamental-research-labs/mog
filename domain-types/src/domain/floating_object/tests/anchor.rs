use crate::domain::floating_object::AnchorMode;

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
