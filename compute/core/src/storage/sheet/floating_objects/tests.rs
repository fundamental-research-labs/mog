use super::*;
use crate::engine_types::floating_objects::ZOrderEntry;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use compute_layout_index::LayoutIndex;
use domain_types::domain::floating_object::FloatingObjectData;
use domain_types::yrs_schema::floating_object as fo_yrs;
use value_types::ComputeError;
use yrs::updates::decoder::Decode;
use yrs::{Any, Doc, Map, MapRef, Out, ReadTxn, Transact};

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn storage_with_sheet() -> (YrsStorage, SheetId) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");
    (storage, sheet_id)
}

fn basic_object_config() -> serde_json::Value {
    serde_json::json!({
        "type": "shape",
        "shapeType": "rect",
        "anchorRow": 0,
        "anchorCol": 0,
        "anchorRowOffset": 0,
        "anchorColOffset": 0,
        "anchorMode": "oneCell",
        "width": 300.0,
        "height": 400.0,
        "visible": true,
        "printable": true,
        "flipH": false,
        "flipV": false,
        "opacity": 1.0,
        "rotation": 0.0
    })
}

#[test]
fn test_compute_object_pixel_bounds_projects_emu_anchor_units() {
    let layout = LayoutIndex::with_defaults(
        10,
        10,
        domain_types::units::Pixels(20.0),
        domain_types::units::Pixels(64.0),
    );
    let obj = serde_json::json!({
        "anchor": {
            "anchorMode": "oneCell",
            "anchorRow": 2,
            "anchorCol": 3,
            "anchorRowOffsetEmu": 5 * 9525,
            "anchorColOffsetEmu": 7 * 9525,
            "extentCxEmu": 88 * 9525,
            "extentCyEmu": 44 * 9525
        },
        "rotation": 15
    });

    let bounds = compute_object_pixel_bounds(None, Some(&layout), &obj).unwrap();

    assert_eq!(bounds.x.get(), 3.0 * 64.0 + 7.0);
    assert_eq!(bounds.y.get(), 2.0 * 20.0 + 5.0);
    assert_eq!(bounds.width.get(), 88.0);
    assert_eq!(bounds.height.get(), 44.0);
    assert_eq!(bounds.rotation.get(), 15.0);
}

#[test]
fn test_compute_object_pixel_bounds_projects_two_cell_emu_offsets() {
    let layout = LayoutIndex::with_defaults(
        10,
        10,
        domain_types::units::Pixels(20.0),
        domain_types::units::Pixels(64.0),
    );
    let obj = serde_json::json!({
        "anchor": {
            "anchorMode": "twoCell",
            "anchorRow": 1,
            "anchorCol": 1,
            "anchorRowOffsetEmu": 3 * 9525,
            "anchorColOffsetEmu": 4 * 9525,
            "endRow": 4,
            "endCol": 3,
            "endRowOffsetEmu": 9 * 9525,
            "endColOffsetEmu": 12 * 9525
        }
    });

    let bounds = compute_object_pixel_bounds(None, Some(&layout), &obj).unwrap();

    assert_eq!(bounds.x.get(), 68.0);
    assert_eq!(bounds.y.get(), 23.0);
    assert_eq!(bounds.width.get(), 136.0);
    assert_eq!(bounds.height.get(), 66.0);
}

// -------------------------------------------------------------------
// Floating Object CRUD (opaque JSON API)
// -------------------------------------------------------------------

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
// Typed Floating Object CRUD
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// Z-Order Operations
// -------------------------------------------------------------------

#[test]
fn test_z_index_empty_sheet() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    assert_eq!(get_floating_object_max_z_index(doc, sheets, &sheet_id), 0);
    assert_eq!(get_floating_object_min_z_index(doc, sheets, &sheet_id), 0);
}

#[test]
fn test_bring_floating_object_to_front() {
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
    bring_floating_object_to_front(doc, sheets, &sheet_id, &id1);
    let o1 = get_floating_object_typed(doc, sheets, &sheet_id, &id1).unwrap();
    let o2 = get_floating_object_typed(doc, sheets, &sheet_id, &id2).unwrap();
    let o3 = get_floating_object_typed(doc, sheets, &sheet_id, &id3).unwrap();
    assert!(o1.common.z_index > o2.common.z_index);
    assert!(o1.common.z_index > o3.common.z_index);
}

#[test]
fn test_send_floating_object_to_back() {
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
    send_floating_object_to_back(doc, sheets, &sheet_id, &id3);
    let o1 = get_floating_object_typed(doc, sheets, &sheet_id, &id1).unwrap();
    let o2 = get_floating_object_typed(doc, sheets, &sheet_id, &id2).unwrap();
    let o3 = get_floating_object_typed(doc, sheets, &sheet_id, &id3).unwrap();
    assert!(o3.common.z_index < o1.common.z_index);
    assert!(o3.common.z_index < o2.common.z_index);
}

#[test]
fn test_bring_floating_object_forward() {
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
    let _id3 = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let z1_before = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
        .unwrap()
        .common
        .z_index;
    let z2_before = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
        .unwrap()
        .common
        .z_index;
    bring_floating_object_forward(doc, sheets, &sheet_id, &id1);
    let z1_after = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
        .unwrap()
        .common
        .z_index;
    let z2_after = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
        .unwrap()
        .common
        .z_index;
    assert_eq!(z1_after, z2_before);
    assert_eq!(z2_after, z1_before);
}

#[test]
fn test_send_floating_object_backward() {
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
    let _id3 = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let z1_before = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
        .unwrap()
        .common
        .z_index;
    let z2_before = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
        .unwrap()
        .common
        .z_index;
    send_floating_object_backward(doc, sheets, &sheet_id, &id2);
    let z1_after = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
        .unwrap()
        .common
        .z_index;
    let z2_after = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
        .unwrap()
        .common
        .z_index;
    assert_eq!(z2_after, z1_before);
    assert_eq!(z1_after, z2_before);
}

#[test]
fn test_bring_forward_at_top_is_noop() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let _id1 = create_floating_object(
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
    let z2_before = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
        .unwrap()
        .common
        .z_index;
    bring_floating_object_forward(doc, sheets, &sheet_id, &id2);
    let z2_after = get_floating_object_typed(doc, sheets, &sheet_id, &id2)
        .unwrap()
        .common
        .z_index;
    assert_eq!(z2_before, z2_after);
}

#[test]
fn test_send_backward_at_bottom_is_noop() {
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
    let _id2 = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let z1_before = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
        .unwrap()
        .common
        .z_index;
    send_floating_object_backward(doc, sheets, &sheet_id, &id1);
    let z1_after = get_floating_object_typed(doc, sheets, &sheet_id, &id1)
        .unwrap()
        .common
        .z_index;
    assert_eq!(z1_before, z1_after);
}

#[test]
fn test_get_floating_objects_in_z_order() {
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
    send_floating_object_to_back(doc, sheets, &sheet_id, &id3);
    let ordered = get_floating_objects_in_z_order(doc, sheets, &sheet_id);
    assert_eq!(ordered.len(), 3);
    assert_eq!(ordered[0].common.id, id3);
    assert_eq!(ordered[1].common.id, id1);
    assert_eq!(ordered[2].common.id, id2);
}

// -------------------------------------------------------------------
// Floating Object Group CRUD (opaque JSON API)
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// Unified Z-Order (Charts as Floating Objects)
// -------------------------------------------------------------------

#[test]
fn test_unified_z_order_interleave() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    // Create chart as a floating object
    let chart_config = serde_json::json!({ "chartType": "bar", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
    let chart_json = create_chart_object(
        doc,
        sheets,
        &sheet_id,
        &chart_config,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let chart_id = chart_json["id"].as_str().unwrap().to_string();

    // Create shape floating object
    let obj_id = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let entries = get_all_in_z_order(doc, sheets, &sheet_id);
    assert_eq!(entries.len(), 2);

    // Both should be present
    let has_chart = entries
        .iter()
        .any(|e| matches!(e, ZOrderEntry::Chart { id, .. } if id == &chart_id));
    let has_obj = entries
        .iter()
        .any(|e| matches!(e, ZOrderEntry::FloatingObject { id, .. } if id == &obj_id));
    assert!(has_chart);
    assert!(has_obj);

    // They should be sorted by z_index
    let z_indices: Vec<i32> = entries
        .iter()
        .map(|e| match e {
            ZOrderEntry::Chart { z_index, .. } => *z_index,
            ZOrderEntry::FloatingObject { z_index, .. } => *z_index,
        })
        .collect();
    for i in 1..z_indices.len() {
        assert!(z_indices[i] >= z_indices[i - 1]);
    }
}

#[test]
fn test_unified_max_min_z_index() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    // Empty sheet
    assert_eq!(get_max_z_index_all(doc, sheets, &sheet_id), 0);
    assert_eq!(get_min_z_index_all(doc, sheets, &sheet_id), 0);

    // Add chart (as floating object) and shape floating object
    let chart_config = serde_json::json!({ "chartType": "bar", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
    let _chart_json = create_chart_object(
        doc,
        sheets,
        &sheet_id,
        &chart_config,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let _obj_id = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let max_z = get_max_z_index_all(doc, sheets, &sheet_id);
    let min_z = get_min_z_index_all(doc, sheets, &sheet_id);
    assert!(max_z >= min_z);
    assert!(max_z >= 0);
}

// -------------------------------------------------------------------
// Chart as Floating Object — CRUD
// -------------------------------------------------------------------

#[test]
fn test_create_chart_object_basic() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let config = serde_json::json!({
        "chartType": "bar",
        "anchorRow": 2,
        "anchorCol": 3,
        "width": 500,
        "height": 400,
        "dataRange": "A1:D10",
        "series": [{"name": "Revenue"}]
    });
    let obj = create_chart_object(
        doc,
        sheets,
        &sheet_id,
        &config,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(obj["type"], "chart");
    assert_eq!(obj["chartType"], "bar");
    assert_eq!(obj["anchor"]["anchorRow"].as_i64(), Some(2));
    assert_eq!(obj["anchor"]["anchorCol"].as_i64(), Some(3));
    assert_eq!(obj["width"].as_f64(), Some(500.0));
    assert_eq!(obj["height"].as_f64(), Some(400.0));
    assert!(obj["id"].as_str().is_some());
    assert!(obj["zIndex"].as_i64().is_some());
    // Domain data should be at top level (no chartConfig sub-object)
    assert_eq!(obj["dataRange"], "A1:D10");
    assert_eq!(obj["series"][0]["name"], "Revenue");
    assert!(
        obj.get("chartConfig").is_none(),
        "chartConfig sub-object should not exist"
    );
}

#[test]
fn test_chart_z_index_unified_with_shapes() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    // Create a shape first
    let _shape_id = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let shape_z = get_floating_object_max_z_index(doc, sheets, &sheet_id);

    // Create a chart — should get a higher z-index
    let chart_config = serde_json::json!({ "chartType": "line", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
    let chart_obj = create_chart_object(
        doc,
        sheets,
        &sheet_id,
        &chart_config,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let chart_z = chart_obj["zIndex"].as_i64().unwrap() as i32;
    assert!(chart_z > shape_z);
}

#[test]
fn test_get_chart_objects() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    // Create a shape and a chart
    let _shape_id = create_floating_object(
        doc,
        sheets,
        &sheet_id,
        &basic_object_config(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let chart_config = serde_json::json!({ "chartType": "pie", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
    let _chart_obj = create_chart_object(
        doc,
        sheets,
        &sheet_id,
        &chart_config,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // get_chart_objects should only return charts, not shapes
    let charts = get_chart_objects(doc, sheets, &sheet_id);
    assert_eq!(charts.len(), 1);
    assert_eq!(charts[0]["type"], "chart");
    assert_eq!(charts[0]["chartType"], "pie");
}

#[test]
fn test_get_charts_linked_to_table_query() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    // Create two charts, one linked to a table
    let config1 = serde_json::json!({ "chartType": "bar", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300, "sourceTableId": "table-A" });
    let _c1 = create_chart_object(
        doc,
        sheets,
        &sheet_id,
        &config1,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let config2 = serde_json::json!({ "chartType": "line", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
    let _c2 = create_chart_object(
        doc,
        sheets,
        &sheet_id,
        &config2,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let linked = get_charts_linked_to_table(doc, sheets, &sheet_id, "table-A");
    assert_eq!(linked.len(), 1);
    assert_eq!(linked[0]["chartType"], "bar");

    let linked_b = get_charts_linked_to_table(doc, sheets, &sheet_id, "table-B");
    assert!(linked_b.is_empty());
}

#[test]
fn test_delete_chart_floating_object() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let config = serde_json::json!({ "chartType": "bar", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300 });
    let chart_obj = create_chart_object(
        doc,
        sheets,
        &sheet_id,
        &config,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let chart_id = chart_obj["id"].as_str().unwrap();

    assert!(get_floating_object(doc, sheets, &sheet_id, chart_id).is_some());
    let deleted = delete_floating_object(doc, sheets, &sheet_id, chart_id);
    assert!(deleted);
    assert!(get_floating_object(doc, sheets, &sheet_id, chart_id).is_none());
}

#[test]
fn test_update_chart_config() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let config = serde_json::json!({ "chartType": "bar", "anchorRow": 0, "anchorCol": 0, "width": 400, "height": 300, "dataRange": "A1:B5" });
    let chart_obj = create_chart_object(
        doc,
        sheets,
        &sheet_id,
        &config,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let chart_id = chart_obj["id"].as_str().unwrap();

    // Update chart fields directly as individual top-level keys
    let updates = serde_json::json!({ "dataRange": "A1:C10", "legend": {"show": true} });
    let updated = update_floating_object(doc, sheets, &sheet_id, chart_id, &updates);
    assert!(updated);

    let obj = get_floating_object(doc, sheets, &sheet_id, chart_id).unwrap();
    assert_eq!(obj["dataRange"], "A1:C10");
    assert_eq!(obj["legend"]["show"], true);
}

// -------------------------------------------------------------------
// Cross-API: opaque set, typed get
// -------------------------------------------------------------------

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

// -------------------------------------------------------------------
// Structured CRDT Storage
// -------------------------------------------------------------------

/// Helper: get the floatingObjects sub-map for a sheet, creating a txn internally.
fn get_fo_map_for_sheet(storage: &YrsStorage, sheet_id: &SheetId) -> (Doc, MapRef) {
    // We need direct access to the map for low-level structured tests.
    // Clone the doc reference and get the sheets map.
    let doc = storage.doc().clone();
    let sheets = storage.sheets().clone();
    let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let map = get_sheet_submap(
        &txn,
        &sheets,
        &sheet_hex,
        compute_document::schema::KEY_FLOATING_OBJECTS,
    )
    .expect("floatingObjects map should exist");
    drop(txn);
    (doc, map)
}

#[test]
fn test_json_value_to_any_number() {
    let val = serde_json::json!(42.5);
    let any = json_value_to_any(&val);
    match any {
        Any::Number(n) => assert_eq!(n, 42.5),
        other => panic!("Expected Any::Number, got {:?}", other),
    }
}

#[test]
fn test_json_value_to_any_string() {
    let val = serde_json::json!("shape");
    let any = json_value_to_any(&val);
    match any {
        Any::String(s) => assert_eq!(&*s, "shape"),
        other => panic!("Expected Any::String, got {:?}", other),
    }
}

#[test]
fn test_json_value_to_any_bool() {
    let val = serde_json::json!(true);
    let any = json_value_to_any(&val);
    match any {
        Any::Bool(b) => assert!(b),
        other => panic!("Expected Any::Bool, got {:?}", other),
    }
}

#[test]
fn test_json_value_to_any_null() {
    let val = serde_json::Value::Null;
    let any = json_value_to_any(&val);
    assert!(matches!(any, Any::Null));
}

#[test]
fn test_json_value_to_any_object() {
    let val = serde_json::json!({"color": "#ff0000", "opacity": 0.8});
    let any = json_value_to_any(&val);
    match any {
        Any::String(s) => {
            let parsed: serde_json::Value = serde_json::from_str(&s).unwrap();
            assert_eq!(parsed["color"], "#ff0000");
            assert_eq!(parsed["opacity"], 0.8);
        }
        other => panic!("Expected Any::String (JSON), got {:?}", other),
    }
}

#[test]
fn test_write_and_read_object_via_unified_schema() {
    let (storage, sheet_id) = storage_with_sheet();
    let (doc, map) = get_fo_map_for_sheet(&storage, &sheet_id);

    let json = serde_json::json!({
        "id": "obj-structured-1",
        "sheetId": "abc",
        "type": "shape",
        "shapeType": "rect",
        "anchorRow": 0,
        "anchorCol": 0,
        "anchorRowOffset": 0,
        "anchorColOffset": 0,
        "anchorMode": "oneCell",
        "width": 100.0,
        "height": 50.0,
        "locked": false,
        "visible": true,
        "printable": true,
        "flipH": false,
        "flipV": false,
        "opacity": 1.0,
        "rotation": 0.0,
        "zIndex": 3,
        "name": "Shape 1",
        "createdAt": 0,
        "updatedAt": 0,
        "fill": {"color": "#00ff00", "type": "solid"}
    });

    // Write via unified schema
    {
        let mut txn = doc.transact_mut();
        write_object_from_json(&mut txn, &map, "obj-structured-1", &json);
    }

    // Read back via unified schema reader
    {
        let txn = doc.transact();
        let result = read_object_structured(&txn, &map, "obj-structured-1");
        assert!(result.is_some());
        let obj = result.unwrap();
        assert_eq!(obj.common.id, "obj-structured-1");
        assert_eq!(obj.object_type(), "shape");
        assert_eq!(obj.common.width, 100.0);
        assert_eq!(obj.common.height, 50.0);
        assert!(!obj.common.locked);
        assert_eq!(obj.common.z_index, 3);
    }
}

#[test]
fn test_read_object_structured_nonexistent() {
    let (storage, sheet_id) = storage_with_sheet();
    let (doc, map) = get_fo_map_for_sheet(&storage, &sheet_id);
    let txn = doc.transact();
    assert!(read_object_structured(&txn, &map, "does-not-exist").is_none());
}

#[test]
fn test_read_all_typed_multiple_entries() {
    let (storage, sheet_id) = storage_with_sheet();
    let (doc, map) = get_fo_map_for_sheet(&storage, &sheet_id);

    {
        let mut txn = doc.transact_mut();

        let obj1 = serde_json::json!({
            "id": "obj-1", "sheetId": "abc", "type": "shape", "shapeType": "rect",
            "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
            "anchorMode": "oneCell", "width": 100.0, "height": 50.0,
            "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
            "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
        });
        write_object_from_json(&mut txn, &map, "obj-1", &obj1);

        let obj2 = serde_json::json!({
            "id": "obj-2", "sheetId": "abc", "type": "picture", "src": "http://img.png",
            "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
            "anchorMode": "oneCell", "width": 200.0, "height": 100.0,
            "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
            "opacity": 1.0, "rotation": 0.0, "zIndex": 1, "name": "", "createdAt": 0, "updatedAt": 0
        });
        write_object_from_json(&mut txn, &map, "obj-2", &obj2);
    }

    {
        let txn = doc.transact();
        let all = read_all_typed(&txn, &map);
        assert_eq!(all.len(), 2);
        let ids: Vec<&str> = all.iter().map(|o| o.common.id.as_str()).collect();
        assert!(ids.contains(&"obj-1"));
        assert!(ids.contains(&"obj-2"));
    }
}

#[test]
fn test_read_all_entries_as_json_multiple() {
    let (storage, sheet_id) = storage_with_sheet();
    let (doc, map) = get_fo_map_for_sheet(&storage, &sheet_id);

    {
        let mut txn = doc.transact_mut();

        let obj1 = serde_json::json!({
            "id": "ent-1", "sheetId": "s", "type": "shape", "shapeType": "rect",
            "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
            "anchorMode": "oneCell", "width": 10.0, "height": 10.0,
            "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
            "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
        });
        write_object_from_json(&mut txn, &map, "ent-1", &obj1);

        let obj2 = serde_json::json!({
            "id": "ent-2", "sheetId": "s", "type": "shape", "shapeType": "oval",
            "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
            "anchorMode": "oneCell", "width": 10.0, "height": 10.0,
            "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
            "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
        });
        write_object_from_json(&mut txn, &map, "ent-2", &obj2);
    }

    {
        let txn = doc.transact();
        let all = read_all_entries_as_json(&txn, &map);
        assert_eq!(all.len(), 2);
        let keys: Vec<&str> = all.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"ent-1"));
        assert!(keys.contains(&"ent-2"));
    }
}

#[test]
fn test_update_object_fields_partial() {
    let (storage, sheet_id) = storage_with_sheet();
    let (doc, map) = get_fo_map_for_sheet(&storage, &sheet_id);

    // Create entry
    let json = serde_json::json!({
        "id": "obj-update-1", "sheetId": "s", "type": "shape", "shapeType": "rect",
        "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
        "anchorMode": "oneCell", "width": 100.0, "height": 50.0,
        "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
        "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
    });
    {
        let mut txn = doc.transact_mut();
        write_object_from_json(&mut txn, &map, "obj-update-1", &json);
    }

    // Partially update width and locked
    {
        let mut txn = doc.transact_mut();
        let inner = match map.get(&txn, "obj-update-1") {
            Some(Out::YMap(m)) => m,
            other => panic!("Expected YMap, got {:?}", other),
        };
        update_object_fields(
            &mut txn,
            &inner,
            &[(FO_WIDTH, Any::Number(99.0)), (FO_LOCKED, Any::Bool(true))],
        );
    }

    // Verify partial update
    {
        let txn = doc.transact();
        let result = read_object_structured(&txn, &map, "obj-update-1").unwrap();
        assert_eq!(result.common.width, 99.0);
        assert!(result.common.locked);
        assert_eq!(result.common.height, 50.0); // untouched
    }
}

// -------------------------------------------------------------------
// Concurrent Edit Integration Tests (CRDT merge behavior)
// -------------------------------------------------------------------

/// Sync all state from `src` into `dst`. Both docs end up with the same state.
fn sync_docs(src: &Doc, dst: &Doc) {
    let sv = dst.transact().state_vector();
    let update = src.transact().encode_diff_v1(&sv);
    let decoded = yrs::Update::decode_v1(&update).expect("decode update");
    dst.transact_mut()
        .apply_update(decoded)
        .expect("apply update");
}

/// Create a second Doc that is an exact clone of `src`, and return it
/// along with the floatingObjects MapRef (looked up by sheet_hex).
fn fork_doc(src: &Doc, sheet_hex: &str) -> (Doc, MapRef) {
    let doc2 = Doc::new();

    // Full state sync from src → doc2
    let update = src.transact().encode_diff_v1(&yrs::StateVector::default());
    let decoded = yrs::Update::decode_v1(&update).expect("decode update");
    doc2.transact_mut()
        .apply_update(decoded)
        .expect("apply update");

    // Look up the floatingObjects map in doc2
    let sheets2 = doc2.get_or_insert_map(compute_document::schema::KEY_SHEETS);
    let txn = doc2.transact();
    let map2 = get_sheet_submap(&txn, &sheets2, sheet_hex, KEY_FLOATING_OBJECTS)
        .expect("floatingObjects map should exist in forked doc");
    drop(txn);
    (doc2, map2)
}

#[test]
fn test_concurrent_edits_different_fields_merge_cleanly() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc1 = storage.doc();
    let sheets1 = storage.sheets();
    let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());

    let shape_json = serde_json::json!({
        "id": "obj-concurrent-1", "sheetId": "s", "type": "shape", "shapeType": "rect",
        "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
        "anchorMode": "oneCell", "width": 100.0, "height": 50.0,
        "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
        "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0,
        "fill": {"color": "#ff0000", "type": "solid"}
    });
    set_floating_object(doc1, sheets1, &sheet_id, "obj-concurrent-1", &shape_json).unwrap();

    let (doc2, map2) = fork_doc(doc1, &sheet_hex);

    // Doc1: change width
    {
        let fo_map =
            get_sheet_submap(&doc1.transact(), sheets1, &sheet_hex, KEY_FLOATING_OBJECTS).unwrap();
        let mut txn = doc1.transact_mut();
        let inner = match fo_map.get(&txn, "obj-concurrent-1") {
            Some(Out::YMap(m)) => m,
            other => panic!("Expected YMap, got {:?}", other),
        };
        update_object_fields(&mut txn, &inner, &[(FO_WIDTH, Any::Number(99.0))]);
    }

    // Doc2: change fill
    {
        let mut txn = doc2.transact_mut();
        let inner = match map2.get(&txn, "obj-concurrent-1") {
            Some(Out::YMap(m)) => m,
            other => panic!("Expected YMap in doc2, got {:?}", other),
        };
        let new_fill = serde_json::json!({"color": "#00ff00", "type": "solid"});
        let fill_any = json_value_to_any(&new_fill);
        update_object_fields(&mut txn, &inner, &[(FO_FILL, fill_any)]);
    }

    sync_docs(doc1, &doc2);
    sync_docs(&doc2, doc1);

    // Both changes present in doc1
    {
        let obj = get_floating_object_typed(doc1, sheets1, &sheet_id, "obj-concurrent-1").unwrap();
        assert_eq!(obj.common.width, 99.0);
        assert_eq!(obj.common.height, 50.0);
    }
}

#[test]
fn test_concurrent_same_field_last_writer_wins() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc1 = storage.doc();
    let sheets1 = storage.sheets();
    let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());

    let shape_json = serde_json::json!({
        "id": "obj-lww-1", "sheetId": "s", "type": "shape", "shapeType": "rect",
        "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
        "anchorMode": "oneCell", "width": 100.0, "height": 50.0,
        "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
        "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
    });
    set_floating_object(doc1, sheets1, &sheet_id, "obj-lww-1", &shape_json).unwrap();

    let (doc2, map2) = fork_doc(doc1, &sheet_hex);

    // Doc1: set width = 111
    {
        let fo_map =
            get_sheet_submap(&doc1.transact(), sheets1, &sheet_hex, KEY_FLOATING_OBJECTS).unwrap();
        let mut txn = doc1.transact_mut();
        let inner = match fo_map.get(&txn, "obj-lww-1") {
            Some(Out::YMap(m)) => m,
            other => panic!("Expected YMap, got {:?}", other),
        };
        update_object_fields(&mut txn, &inner, &[(FO_WIDTH, Any::Number(111.0))]);
    }

    // Doc2: set width = 222
    {
        let mut txn = doc2.transact_mut();
        let inner = match map2.get(&txn, "obj-lww-1") {
            Some(Out::YMap(m)) => m,
            other => panic!("Expected YMap in doc2, got {:?}", other),
        };
        update_object_fields(&mut txn, &inner, &[(FO_WIDTH, Any::Number(222.0))]);
    }

    sync_docs(doc1, &doc2);
    sync_docs(&doc2, doc1);

    let val1 = get_floating_object_typed(doc1, sheets1, &sheet_id, "obj-lww-1")
        .unwrap()
        .common
        .width;
    let val2 = {
        let txn = doc2.transact();
        let obj = fo_yrs::from_yrs_map(
            &match map2.get(&txn, "obj-lww-1") {
                Some(Out::YMap(m)) => m,
                _ => panic!("expected ymap"),
            },
            &txn,
        )
        .unwrap();
        obj.common.width
    };

    assert_eq!(
        val1, val2,
        "Both docs should have the same LWW value for width"
    );
    assert!(
        val1 == 111.0 || val1 == 222.0,
        "width should be 111 or 222, got {}",
        val1
    );
}

#[test]
fn test_concurrent_create_and_update() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc1 = storage.doc();
    let sheets1 = storage.sheets();
    let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());

    let shape_json = serde_json::json!({
        "id": "obj-create-1", "sheetId": "s", "type": "shape", "shapeType": "rect",
        "anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0,
        "anchorMode": "oneCell", "width": 100.0, "height": 50.0,
        "locked": false, "visible": true, "printable": true, "flipH": false, "flipV": false,
        "opacity": 1.0, "rotation": 0.0, "zIndex": 0, "name": "", "createdAt": 0, "updatedAt": 0
    });
    set_floating_object(doc1, sheets1, &sheet_id, "obj-create-1", &shape_json).unwrap();

    let (doc2, map2) = fork_doc(doc1, &sheet_hex);

    // Doc2: update width
    {
        let mut txn = doc2.transact_mut();
        let inner = match map2.get(&txn, "obj-create-1") {
            Some(Out::YMap(m)) => m,
            other => panic!("Expected YMap in doc2, got {:?}", other),
        };
        update_object_fields(&mut txn, &inner, &[(FO_WIDTH, Any::Number(999.0))]);
    }

    // Doc1: update height
    {
        let fo_map =
            get_sheet_submap(&doc1.transact(), sheets1, &sheet_hex, KEY_FLOATING_OBJECTS).unwrap();
        let mut txn = doc1.transact_mut();
        let inner = match fo_map.get(&txn, "obj-create-1") {
            Some(Out::YMap(m)) => m,
            other => panic!("Expected YMap, got {:?}", other),
        };
        update_object_fields(&mut txn, &inner, &[(FO_HEIGHT, Any::Number(777.0))]);
    }

    sync_docs(doc1, &doc2);
    sync_docs(&doc2, doc1);

    let obj = get_floating_object_typed(doc1, sheets1, &sheet_id, "obj-create-1").unwrap();
    assert_eq!(obj.object_type(), "shape");
    assert_eq!(obj.common.width, 999.0);
    assert_eq!(obj.common.height, 777.0);
}
