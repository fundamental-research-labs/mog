use super::helpers::{make_sheet_id, storage_with_sheet};
use crate::storage::sheet::floating_objects::{
    delete_floating_object, get_all_floating_objects, get_floating_object, set_floating_object,
};

#[test]
fn test_set_and_get_floating_object() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let json = serde_json::json!({
        "type": "picture",
        "x": 100,
        "y": 200,
        "width": 300,
        "height": 400
    });

    set_floating_object(doc, sheets, &sheet_id, "obj-1", &json).expect("set should succeed");

    let result = get_floating_object(doc, sheets, &sheet_id, "obj-1");
    assert!(result.is_some());
    let val = result.unwrap();
    assert_eq!(val["type"], "picture");
    assert_eq!(val["width"], 300);
}

#[test]
fn test_get_nonexistent_floating_object() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    assert!(get_floating_object(doc, sheets, &sheet_id, "nope").is_none());
}

#[test]
fn test_get_all_floating_objects() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    set_floating_object(
        doc,
        sheets,
        &sheet_id,
        "obj-1",
        &serde_json::json!({"type": "shape"}),
    )
    .unwrap();
    set_floating_object(
        doc,
        sheets,
        &sheet_id,
        "obj-2",
        &serde_json::json!({"type": "textbox"}),
    )
    .unwrap();

    let all = get_all_floating_objects(doc, sheets, &sheet_id);
    assert_eq!(all.len(), 2);
    let ids: Vec<&str> = all.iter().map(|(id, _)| id.as_str()).collect();
    assert!(ids.contains(&"obj-1"));
    assert!(ids.contains(&"obj-2"));
}

#[test]
fn test_get_all_floating_objects_empty() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    assert!(get_all_floating_objects(doc, sheets, &sheet_id).is_empty());
}

#[test]
fn test_delete_floating_object() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    set_floating_object(
        doc,
        sheets,
        &sheet_id,
        "obj-1",
        &serde_json::json!({"type": "chart"}),
    )
    .unwrap();
    assert!(get_floating_object(doc, sheets, &sheet_id, "obj-1").is_some());

    let deleted = delete_floating_object(doc, sheets, &sheet_id, "obj-1");
    assert!(deleted);
    assert!(get_floating_object(doc, sheets, &sheet_id, "obj-1").is_none());
}

#[test]
fn test_delete_nonexistent_floating_object() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    assert!(!delete_floating_object(doc, sheets, &sheet_id, "nope"));
}

#[test]
fn test_overwrite_floating_object() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    set_floating_object(
        doc,
        sheets,
        &sheet_id,
        "obj-1",
        &serde_json::json!({"width": 100}),
    )
    .unwrap();
    set_floating_object(
        doc,
        sheets,
        &sheet_id,
        "obj-1",
        &serde_json::json!({"width": 999}),
    )
    .unwrap();

    let val = get_floating_object(doc, sheets, &sheet_id, "obj-1").unwrap();
    assert_eq!(val["width"], 999);
}

#[test]
fn test_floating_object_nonexistent_sheet() {
    let (storage, _) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let fake = make_sheet_id(999);
    assert!(set_floating_object(doc, sheets, &fake, "obj-1", &serde_json::json!({})).is_err());
    assert!(get_floating_object(doc, sheets, &fake, "obj-1").is_none());
    assert!(get_all_floating_objects(doc, sheets, &fake).is_empty());
    assert!(!delete_floating_object(doc, sheets, &fake, "obj-1"));
}

// -------------------------------------------------------------------
