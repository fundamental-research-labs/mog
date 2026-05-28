use super::helpers::storage_with_sheet;
use crate::storage::sheet::floating_objects::{
    delete_floating_object_group, get_all_floating_object_groups, get_floating_object_group,
    set_floating_object_group,
};

#[test]
fn test_set_and_get_floating_object_group() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let json = serde_json::json!({
        "children": ["obj-1", "obj-2"],
        "x": 50,
        "y": 50
    });

    set_floating_object_group(doc, sheets, &sheet_id, "grp-1", &json).expect("set should succeed");

    let result = get_floating_object_group(doc, sheets, &sheet_id, "grp-1");
    assert!(result.is_some());
    let val = result.unwrap();
    assert_eq!(val["children"][0], "obj-1");
}

#[test]
fn test_get_all_floating_object_groups() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    set_floating_object_group(
        doc,
        sheets,
        &sheet_id,
        "grp-1",
        &serde_json::json!({"a": 1}),
    )
    .unwrap();
    set_floating_object_group(
        doc,
        sheets,
        &sheet_id,
        "grp-2",
        &serde_json::json!({"b": 2}),
    )
    .unwrap();

    let all = get_all_floating_object_groups(doc, sheets, &sheet_id);
    assert_eq!(all.len(), 2);
}

#[test]
fn test_delete_floating_object_group() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    set_floating_object_group(doc, sheets, &sheet_id, "grp-1", &serde_json::json!({})).unwrap();
    assert!(delete_floating_object_group(
        doc, sheets, &sheet_id, "grp-1"
    ));
    assert!(get_floating_object_group(doc, sheets, &sheet_id, "grp-1").is_none());
}

#[test]
fn test_delete_nonexistent_floating_object_group() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    assert!(!delete_floating_object_group(
        doc, sheets, &sheet_id, "nope"
    ));
}

// -------------------------------------------------------------------
// Typed Floating Object Group CRUD
// -------------------------------------------------------------------
