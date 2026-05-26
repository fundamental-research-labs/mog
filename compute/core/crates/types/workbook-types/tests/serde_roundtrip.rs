use workbook_types::{
    ExternalA1Cell, ExternalAbsFlags, ExternalAddressKey, ExternalDepTarget, ExternalRefKey,
    ExternalSheetKey, LinkId, LinkStatus, LinkStatusView, WorkbookId,
};

#[test]
fn workbook_ids_serialize_as_uuid_text() {
    let id = WorkbookId::from_raw(0x1234567890abcdef1234567890abcdef);
    let json = serde_json::to_string(&id).unwrap();
    assert_eq!(json, "\"1234567890abcdef1234567890abcdef\"");
    assert_eq!(serde_json::from_str::<WorkbookId>(&json).unwrap(), id);
}

#[test]
fn external_ref_key_preserves_sheet_and_address_identity() {
    let link_id = LinkId::from_raw(0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa);
    let key = ExternalRefKey {
        link_id,
        sheet: Some(ExternalSheetKey::Name {
            name: "Sheet2".to_string(),
        }),
        address: ExternalAddressKey::A1 {
            r#ref: ExternalA1Cell { row: 1, col: 1 },
            abs: ExternalAbsFlags {
                row_abs: true,
                col_abs: false,
            },
        },
    };

    let json = serde_json::to_string(&key).unwrap();
    assert!(json.contains("\"sheet\""));
    assert!(json.contains("\"kind\":\"a1\""));
    assert_eq!(serde_json::from_str::<ExternalRefKey>(&json).unwrap(), key);
}

#[test]
fn external_dep_target_has_tagged_shape() {
    let dep = ExternalDepTarget::Name(workbook_types::ExternalNameRef {
        link_id: LinkId::from_raw(1),
        sheet: None,
        name: "Rates".to_string(),
    });
    let json = serde_json::to_value(dep).unwrap();
    assert_eq!(json["kind"], "name");
    assert_eq!(json["name"], "Rates");
}

#[test]
fn link_status_view_is_sanitized_status_only() {
    let view = LinkStatusView {
        link_id: LinkId::from_raw(7),
        status: LinkStatus::Denied,
        status_reason: Some(workbook_types::LinkStatusReason::PermissionDenied),
        last_resolved_at: None,
        cached_values_version: None,
    };
    let json = serde_json::to_string(&view).unwrap();
    assert!(json.contains("\"status\":\"denied\""));
    assert!(!json.contains("principal"));
}
