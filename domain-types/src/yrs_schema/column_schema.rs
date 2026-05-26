//! Yrs schema for [`ColumnSchema`] and [`RangeSchema`] — structured Y.Map with
//! JSON-encoded complex nested fields (constraints, distribution, ranges, ui).

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, MapPrelim, Out, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::domain::validation::*;

// ============================================================================
// ColumnSchema Y.Map keys
// ============================================================================

pub const KEY_ID: &str = "id";
pub const KEY_NAME: &str = "name";
pub const KEY_SCHEMA_TYPE: &str = "type";
pub const KEY_CONSTRAINTS: &str = "constraints";
pub const KEY_DISTRIBUTION: &str = "distribution";
pub const KEY_DESCRIPTION: &str = "description";

// ============================================================================
// RangeSchema Y.Map keys
// ============================================================================

pub const KEY_CREATED_AT: &str = "createdAt";
pub const KEY_RANGES: &str = "ranges";
pub const KEY_SCHEMA: &str = "schema";
pub const KEY_ENFORCEMENT: &str = "enforcement";
pub const KEY_UI: &str = "ui";

// ============================================================================
// ColumnSchema -> Y.Map
// ============================================================================

/// Convert a [`ColumnSchema`] to Yrs prelim entries for initial hydration.
pub fn column_to_yrs_prelim(cs: &ColumnSchema) -> Vec<(&str, Any)> {
    let type_str = serde_json::to_value(cs.schema_type)
        .ok()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();

    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_ID, Any::String(Arc::from(cs.id.as_str()))),
        (KEY_NAME, Any::String(Arc::from(cs.name.as_str()))),
        (KEY_SCHEMA_TYPE, Any::String(Arc::from(type_str.as_str()))),
    ];

    if let Some(ref c) = cs.constraints {
        entries.push((KEY_CONSTRAINTS, json_any(c)));
    }
    if let Some(ref d) = cs.distribution {
        entries.push((KEY_DISTRIBUTION, json_any(d)));
    }
    if let Some(ref desc) = cs.description {
        entries.push((KEY_DESCRIPTION, Any::String(Arc::from(desc.as_str()))));
    }

    entries
}

/// Write a [`ColumnSchema`] into a parent Y.Map at the given key, creating a
/// nested Y.Map.
pub fn write_column_schema(
    parent: &MapRef,
    txn: &mut TransactionMut,
    key: &str,
    cs: &ColumnSchema,
) {
    parent.insert(txn, key, MapPrelim::from([] as [(&str, Any); 0]));
    let map = match parent.get(txn, key) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };
    map.insert(txn, KEY_ID, Any::String(Arc::from(cs.id.as_str())));
    map.insert(txn, KEY_NAME, Any::String(Arc::from(cs.name.as_str())));
    {
        let type_str = serde_json::to_value(cs.schema_type)
            .ok()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        map.insert(
            txn,
            KEY_SCHEMA_TYPE,
            Any::String(Arc::from(type_str.as_str())),
        );
    }
    if let Some(ref c) = cs.constraints {
        write_json(&map, txn, KEY_CONSTRAINTS, c);
    }
    if let Some(ref d) = cs.distribution {
        write_json(&map, txn, KEY_DISTRIBUTION, d);
    }
    if let Some(ref desc) = cs.description {
        map.insert(txn, KEY_DESCRIPTION, Any::String(Arc::from(desc.as_str())));
    }
}

/// Read a [`ColumnSchema`] from a structured Y.Map. Returns `None` if the map
/// does not contain structured fields.
pub fn column_from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<ColumnSchema> {
    // Detect structured format: must have at least the type key or id key
    let has_structured = map.get(txn, KEY_SCHEMA_TYPE).is_some()
        || map.get(txn, KEY_ID).is_some()
        || map.get(txn, KEY_NAME).is_some();
    if !has_structured {
        return None;
    }
    let schema_type = read_string(map, txn, KEY_SCHEMA_TYPE)
        .and_then(|s| serde_json::from_value::<SchemaType>(serde_json::Value::String(s)).ok())
        .unwrap_or(SchemaType::Any);
    Some(ColumnSchema {
        id: read_string(map, txn, KEY_ID).unwrap_or_default(),
        name: read_string(map, txn, KEY_NAME).unwrap_or_default(),
        schema_type,
        constraints: read_json(map, txn, KEY_CONSTRAINTS),
        distribution: read_json(map, txn, KEY_DISTRIBUTION),
        description: read_string(map, txn, KEY_DESCRIPTION),
    })
}

/// Read a [`ColumnSchema`] from a Yrs `Out` value.
pub fn column_from_yrs_out<T: ReadTxn>(out: &Out, txn: &T) -> Option<ColumnSchema> {
    match out {
        Out::YMap(map) => column_from_yrs_map(map, txn),
        _ => None,
    }
}

// ============================================================================
// RangeSchema -> Y.Map
// ============================================================================

/// Convert a [`RangeSchema`] to Yrs prelim entries for initial hydration.
pub fn range_to_yrs_prelim(rs: &RangeSchema) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_ID, Any::String(Arc::from(rs.id.as_str()))),
        (KEY_CREATED_AT, Any::Number(rs.created_at as f64)),
        (KEY_RANGES, json_any(&rs.ranges)),
        (KEY_SCHEMA, json_any(&rs.schema)),
    ];

    if let Some(ref e) = rs.enforcement {
        let e_str = serde_json::to_value(e)
            .ok()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        entries.push((KEY_ENFORCEMENT, Any::String(Arc::from(e_str.as_str()))));
    }
    if let Some(ref ui) = rs.ui {
        entries.push((KEY_UI, json_any(ui)));
    }

    entries
}

/// Write a [`RangeSchema`] into a parent Y.Map at the given key, creating a
/// nested Y.Map.
pub fn write_range_schema(parent: &MapRef, txn: &mut TransactionMut, key: &str, rs: &RangeSchema) {
    parent.insert(txn, key, MapPrelim::from([] as [(&str, Any); 0]));
    let map = match parent.get(txn, key) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };
    map.insert(txn, KEY_ID, Any::String(Arc::from(rs.id.as_str())));
    map.insert(txn, KEY_CREATED_AT, Any::Number(rs.created_at as f64));
    write_json(&map, txn, KEY_RANGES, &rs.ranges);
    write_json(&map, txn, KEY_SCHEMA, &rs.schema);
    if let Some(ref e) = rs.enforcement {
        let e_str = serde_json::to_value(e)
            .ok()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        map.insert(txn, KEY_ENFORCEMENT, Any::String(Arc::from(e_str.as_str())));
    }
    if let Some(ref ui) = rs.ui {
        write_json(&map, txn, KEY_UI, ui);
    }
}

/// Read a [`RangeSchema`] from a structured Y.Map.
pub fn range_from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<RangeSchema> {
    let id = read_string(map, txn, KEY_ID)?;
    Some(RangeSchema {
        id,
        created_at: read_number(map, txn, KEY_CREATED_AT).unwrap_or(0.0) as i64,
        ranges: read_json(map, txn, KEY_RANGES).unwrap_or_default(),
        schema: read_json(map, txn, KEY_SCHEMA).unwrap_or(RangeSchemaDefinition {
            schema_type: None,
            constraints: None,
        }),
        enforcement: read_string(map, txn, KEY_ENFORCEMENT).and_then(|s| {
            serde_json::from_value::<EnforcementLevel>(serde_json::Value::String(s)).ok()
        }),
        ui: read_json(map, txn, KEY_UI),
    })
}

/// Read a [`RangeSchema`] from a Yrs `Out` value.
pub fn range_from_yrs_out<T: ReadTxn>(out: &Out, txn: &T) -> Option<RangeSchema> {
    match out {
        Out::YMap(map) => range_from_yrs_map(map, txn),
        _ => None,
    }
}
