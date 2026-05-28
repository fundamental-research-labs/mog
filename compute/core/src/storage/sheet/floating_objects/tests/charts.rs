use super::helpers::{basic_object_config, storage_with_sheet};
use crate::engine_types::floating_objects::ZOrderEntry;
use crate::storage::sheet::floating_objects::{
    create_chart_object, create_floating_object, delete_floating_object, get_all_in_z_order,
    get_chart_objects, get_charts_linked_to_table, get_floating_object,
    get_floating_object_max_z_index, get_max_z_index_all, get_min_z_index_all,
    update_floating_object,
};

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
