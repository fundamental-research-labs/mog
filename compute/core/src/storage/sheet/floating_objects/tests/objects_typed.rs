use super::helpers::{basic_object_config, make_sheet_id, storage_with_sheet};
use crate::storage::sheet::floating_objects::{
    create_floating_object, get_all_floating_objects_typed, get_floating_object_typed,
    set_floating_object, update_floating_object,
};
use domain_types::domain::floating_object::FloatingObjectData;
use value_types::ComputeError;

#[test]
fn test_create_floating_object_and_get_typed() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let object_id = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .expect("create should succeed");
    assert!(object_id.starts_with("fobj-"));

    let obj = get_floating_object_typed(doc, sheets, &sheet_id, &object_id).unwrap();
    assert_eq!(obj.common.id, object_id);
    assert_eq!(obj.common.width, 300.0);
    assert_eq!(obj.common.height, 400.0);
    assert!(obj.common.created_at != 0);
    assert!(obj.common.updated_at != 0);
}

#[test]
fn test_create_floating_object_z_index_auto_increment() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let id1 = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let id2 = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let id3 = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let o1 = get_floating_object_typed(doc, sheets, &sheet_id, &id1).unwrap();
    let o2 = get_floating_object_typed(doc, sheets, &sheet_id, &id2).unwrap();
    let o3 = get_floating_object_typed(doc, sheets, &sheet_id, &id3).unwrap();
    assert!(o1.common.z_index < o2.common.z_index);
    assert!(o2.common.z_index < o3.common.z_index);
}

#[test]
fn test_update_floating_object_typed() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let object_id = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let original = get_floating_object_typed(doc, sheets, &sheet_id, &object_id).unwrap();
    let original_updated_at = original.common.updated_at;

    let updates = serde_json::json!({ "width": 999.0, "height": 888.0 });
    let updated = update_floating_object(doc, sheets, &sheet_id, &object_id, &updates);
    assert!(updated);

    let obj = get_floating_object_typed(doc, sheets, &sheet_id, &object_id).unwrap();
    assert_eq!(obj.common.width, 999.0);
    assert_eq!(obj.common.height, 888.0);
    assert!(obj.common.updated_at >= original_updated_at);
}

#[test]
fn test_update_nonexistent_floating_object() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let updates = serde_json::json!({ "width": 999 });
    assert!(!update_floating_object(
        doc,
        sheets,
        &sheet_id,
        "nonexistent",
        &updates
    ));
}

#[test]
fn test_get_all_floating_objects_typed() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let id1 = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let mut pic_config = basic_object_config();
    pic_config["type"] = serde_json::json!("picture");
    pic_config["src"] = serde_json::json!("http://img.png");
    pic_config.as_object_mut().unwrap().remove("shapeType");
    let id2 = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &pic_config,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let all = get_all_floating_objects_typed(doc, sheets, &sheet_id);
    assert_eq!(all.len(), 2);
    let ids: Vec<&str> = all.iter().map(|o| o.common.id.as_str()).collect();
    assert!(ids.contains(&id1.as_str()));
    assert!(ids.contains(&id2.as_str()));
}

#[test]
fn test_create_floating_object_nonexistent_sheet() {
    let (storage, _) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let fake = make_sheet_id(999);
    let result = create_floating_object(
        doc,
        sheets,
        &fake,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    assert!(result.is_err());
    match result.unwrap_err() {
        ComputeError::SheetNotFound { .. } => {}
        other => panic!("Expected SheetNotFound, got {:?}", other),
    }
}

#[test]
fn test_opaque_set_typed_get() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    // Store via opaque JSON API with all required fields
    let json = serde_json::json!({
        "id": "obj-opaque",
        "sheetId": "whatever",
        "type": "shape",
        "shapeType": "rect",
        "anchorRow": 0,
        "anchorCol": 0,
        "anchorRowOffset": 0,
        "anchorColOffset": 0,
        "anchorMode": "oneCell",
        "width": 200.0,
        "height": 100.0,
        "zIndex": 5,
        "rotation": 0.0,
        "flipH": false,
        "flipV": false,
        "locked": false,
        "visible": true,
        "printable": true,
        "opacity": 1.0,
        "name": "",
        "createdAt": 0,
        "updatedAt": 0
    });
    set_floating_object(doc, sheets, &sheet_id, "obj-opaque", &json).unwrap();

    // Read via typed API
    let obj = get_floating_object_typed(doc, sheets, &sheet_id, "obj-opaque").unwrap();
    assert_eq!(obj.common.id, "obj-opaque");
    assert_eq!(obj.common.width, 200.0);
    assert_eq!(obj.common.height, 100.0);
    assert_eq!(obj.common.z_index, 5);
}

#[test]
fn test_shape_fill_preserved() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let mut config = basic_object_config();
    config["fill"] = serde_json::json!({ "type": "solid", "color": "#ff0000" });
    let object_id = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &config,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let obj = get_floating_object_typed(doc, sheets, &sheet_id, &object_id).unwrap();
    if let FloatingObjectData::Shape(shape) = &obj.data {
        let fill = shape.fill.as_ref().expect("fill should be present");
        assert_eq!(fill.color.as_deref(), Some("#ff0000"));
    } else {
        panic!("Expected Shape data");
    }
}
