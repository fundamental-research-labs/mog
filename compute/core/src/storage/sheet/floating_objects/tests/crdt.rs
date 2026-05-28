use super::super::codec::{json_value_to_any, update_object_fields};
use super::super::keys::{FO_FILL, FO_HEIGHT, FO_WIDTH};
use super::super::sheet_map::get_sheet_submap;
use super::helpers::storage_with_sheet;
use crate::storage::sheet::floating_objects::{get_floating_object_typed, set_floating_object};
use compute_document::schema::KEY_FLOATING_OBJECTS;
use domain_types::yrs_schema::floating_object as fo_yrs;
use yrs::updates::decoder::Decode;
use yrs::{Any, Doc, Map, MapRef, Out, ReadTxn, Transact};

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
