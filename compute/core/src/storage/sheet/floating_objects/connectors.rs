use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_FLOATING_OBJECTS;
use domain_types::yrs_schema::floating_object as fo_yrs;
use yrs::{Doc, Map, MapRef, Out, Transact};

use super::sheet_map::get_sheet_submap;

pub(super) fn match_shape_id(json_val: &serde_json::Value, shape_id: &str) -> bool {
    match json_val {
        serde_json::Value::String(s) => s == shape_id,
        serde_json::Value::Number(n) => {
            // Compare numeric shapeId: convert both to string for comparison
            n.to_string() == shape_id
        }
        _ => false,
    }
}

/// Find all connectors in a sheet that reference a given shape ID via
/// `startConnection.shapeId` or `endConnection.shapeId`.
///
/// Returns a list of `(object_id, serde_json::Value)` pairs for each matching
/// connector. This is used to identify connectors that need re-routing when a
/// shape is moved or resized.
pub fn find_connectors_for_shape(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    shape_id: &str,
) -> Vec<(String, serde_json::Value)> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let map = match get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (key, value) in map.iter(&txn) {
        let obj = match &value {
            Out::YMap(inner) => {
                fo_yrs::from_yrs_map(inner, &txn).and_then(|o| serde_json::to_value(&o).ok())
            }
            _ => None,
        };
        if let Some(obj) = obj {
            // Check if this is a connector type
            let is_connector = obj.get("type").and_then(|v| v.as_str()) == Some("connector");
            if !is_connector {
                continue;
            }

            // Check startConnection.shapeId (may be string or number)
            let start_matches = obj
                .get("startConnection")
                .and_then(|c| c.get("shapeId"))
                .is_some_and(|v| match_shape_id(v, shape_id));

            // Check endConnection.shapeId (may be string or number)
            let end_matches = obj
                .get("endConnection")
                .and_then(|c| c.get("shapeId"))
                .is_some_and(|v| match_shape_id(v, shape_id));

            if start_matches || end_matches {
                result.push((key.to_string(), obj));
            }
        }
    }

    result
}
