use super::super::codec::{
    json_value_to_any, read_all_entries_as_json, read_all_typed, read_object_structured,
    update_object_fields, write_object_from_json,
};
use super::super::keys::{FO_LOCKED, FO_WIDTH};
use super::super::sheet_map::get_sheet_submap;
use super::helpers::storage_with_sheet;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use yrs::{Any, Doc, Map, MapRef, Out, ReadTxn, Transact};

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
