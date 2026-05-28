use super::helpers::{basic_object_config, storage_with_sheet};
use crate::storage::sheet::floating_objects::{
    bring_floating_object_forward, bring_floating_object_to_front, create_floating_object,
    get_floating_object_max_z_index, get_floating_object_min_z_index, get_floating_object_typed,
    get_floating_objects_in_z_order, send_floating_object_backward, send_floating_object_to_back,
};

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
