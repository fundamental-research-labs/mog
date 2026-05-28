use super::helpers::{make_sheet_id, storage_with_sheet};
use crate::storage::sheet::floating_objects::{
    create_floating_object_group, get_all_floating_object_groups_typed,
    get_floating_object_group_typed, update_floating_object_group,
};

#[test]
fn test_create_floating_object_group_typed() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let config = serde_json::json!({
        "children": ["obj-a", "obj-b"],
        "x": 10.0,
        "y": 20.0,
        "width": 200.0,
        "height": 150.0
    });
    let group_id = create_floating_object_group(
        doc,
        sheets,
        &sheet_id,
        &config,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .expect("create group should succeed");
    assert!(group_id.starts_with("grp-"));

    let grp = get_floating_object_group_typed(doc, sheets, &sheet_id, &group_id).unwrap();
    assert_eq!(grp.id, group_id);
    assert_eq!(grp.children, vec!["obj-a", "obj-b"]);
    assert_eq!(grp.x, Some(value_types::FiniteF64::must(10.0)));
    assert_eq!(grp.y, Some(value_types::FiniteF64::must(20.0)));
    assert_eq!(grp.width, Some(value_types::FiniteF64::must(200.0)));
    assert_eq!(grp.height, Some(value_types::FiniteF64::must(150.0)));
}

#[test]
fn test_update_floating_object_group_typed() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let config = serde_json::json!({ "children": ["obj-a"], "x": 10.0 });
    let group_id = create_floating_object_group(
        doc,
        sheets,
        &sheet_id,
        &config,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let updates = serde_json::json!({ "x": 99.0, "width": 500.0 });
    let updated = update_floating_object_group(doc, sheets, &sheet_id, &group_id, &updates);
    assert!(updated);

    let grp = get_floating_object_group_typed(doc, sheets, &sheet_id, &group_id).unwrap();
    assert_eq!(grp.x, Some(value_types::FiniteF64::must(99.0)));
    assert_eq!(grp.width, Some(value_types::FiniteF64::must(500.0)));
    assert_eq!(grp.children, vec!["obj-a"]); // untouched
}

#[test]
fn test_get_all_floating_object_groups_typed() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let id1 = create_floating_object_group(
        doc,
        sheets,
        &sheet_id,
        &serde_json::json!({"children": []}),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let id2 = create_floating_object_group(
        doc,
        sheets,
        &sheet_id,
        &serde_json::json!({"children": []}),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let all = get_all_floating_object_groups_typed(doc, sheets, &sheet_id);
    assert_eq!(all.len(), 2);
    let ids: Vec<&str> = all.iter().map(|g| g.id.as_str()).collect();
    assert!(ids.contains(&id1.as_str()));
    assert!(ids.contains(&id2.as_str()));
}

#[test]
fn test_create_floating_object_group_nonexistent_sheet() {
    let (storage, _) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let fake = make_sheet_id(999);
    let result = create_floating_object_group(
        doc,
        sheets,
        &fake,
        &serde_json::json!({"children": []}),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    assert!(result.is_err());
}
