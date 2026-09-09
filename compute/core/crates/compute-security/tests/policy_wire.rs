use compute_security::{AccessLevel, AccessPolicy};

#[test]
fn legacy_wire_fixture_deserialises_and_re_serialises_to_same_bytes() {
    // Hex-form (no dashes) is what `SheetId::to_uuid_string` emits — TS
    // side uses the same simple form on the wire, so the raw JSON below
    // mirrors what legacy docs actually carry.
    let fixture = r#"{
        "id": "11111111-1111-1111-1111-111111111111",
        "principalTag": "agent:*",
        "target": {
            "kind": "column",
            "sheetId": "22222222222222222222222222222222",
            "colId": "33333333333333333333333333333333"
        },
        "level": "read",
        "priority": 7,
        "enabled": true,
        "metadata": {
            "createdBy": "alice",
            "createdAt": 1700000000000,
            "templateId": "protect-workbook"
        }
    }"#;

    let parsed: AccessPolicy = serde_json::from_str(fixture).expect("legacy fixture parses");
    assert_eq!(parsed.level, AccessLevel::Read);
    assert_eq!(parsed.priority, 7);
    assert!(parsed.enabled);

    // Re-serialise and re-parse — the shape must survive a round trip
    // without key renames creeping in.
    let reserialised = serde_json::to_string(&parsed).expect("re-serialise");
    let round_trip: AccessPolicy = serde_json::from_str(&reserialised).expect("re-parse");
    assert_eq!(parsed, round_trip);

    // Re-serialised bytes themselves must carry the camelCase keys — the
    // `value` walk below pins that explicitly.
    let as_value: serde_json::Value = serde_json::from_str(&reserialised).unwrap();
    let obj = as_value.as_object().unwrap();
    for k in [
        "principalTag",
        "target",
        "level",
        "priority",
        "enabled",
        "metadata",
    ] {
        assert!(
            obj.contains_key(k),
            "camelCase key `{k}` missing after round-trip"
        );
    }
    assert!(!obj.contains_key("principal_tag"));
    let meta = obj["metadata"].as_object().unwrap();
    for k in ["createdBy", "createdAt", "templateId"] {
        assert!(
            meta.contains_key(k),
            "metadata key `{k}` missing after round-trip"
        );
    }
    assert!(!meta.contains_key("created_by"));
    assert!(!meta.contains_key("created_at_millis"));
}
