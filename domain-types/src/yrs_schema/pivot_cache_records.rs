//! Pivot cache record row storage.
//!
//! Values are keyed by Excel pivot cache id and stored as typed `CellValue`
//! rows. This keeps imported cache rows in workbook-owned Yrs state without
//! preserving raw OOXML.

use std::collections::HashMap;

use value_types::CellValue;
use yrs::{Any, Map, Out, ReadTxn};

use crate::yrs_schema::helpers::json_any;

pub type PivotCacheRecords = HashMap<u32, Vec<Vec<CellValue>>>;

pub fn cache_key(cache_id: u32) -> String {
    cache_id.to_string()
}

pub fn to_yrs_prelim(records: &PivotCacheRecords) -> Vec<(String, Any)> {
    records
        .iter()
        .map(|(cache_id, rows)| (cache_key(*cache_id), json_any(rows)))
        .collect()
}

pub fn from_yrs_map<T: ReadTxn>(
    map: &yrs::types::map::MapRef,
    txn: &T,
) -> PivotCacheRecords {
    let mut records = HashMap::new();
    for (key, value) in map.iter(txn) {
        let Ok(cache_id) = key.parse::<u32>() else {
            continue;
        };
        let Out::Any(Any::String(json)) = value else {
            continue;
        };
        if let Ok(rows) = serde_json::from_str::<Vec<Vec<CellValue>>>(&json) {
            records.insert(cache_id, rows);
        }
    }
    records
}
