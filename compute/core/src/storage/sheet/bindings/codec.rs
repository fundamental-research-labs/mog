//! Structured Y.Map codec for sheet data bindings.

use std::sync::Arc;

use domain_types::yrs_schema::helpers::*;
use yrs::{Any, MapRef};

use crate::engine_types::bindings::SheetDataBinding;

const KEY_ID: &str = "id";
const KEY_SHEET_ID: &str = "sheetId";
const KEY_CONNECTION_ID: &str = "connectionId";
const KEY_COLUMN_MAPPINGS: &str = "columnMappings";
const KEY_AUTO_GENERATE_ROWS: &str = "autoGenerateRows";
const KEY_HEADER_ROW: &str = "headerRow";
const KEY_DATA_START_ROW: &str = "dataStartRow";
const KEY_PRESERVE_HEADER_FORMATTING: &str = "preserveHeaderFormatting";
const KEY_LAST_REFRESH: &str = "lastRefresh";
const KEY_LAST_ROW_COUNT: &str = "lastRowCount";

/// Convert a [`SheetDataBinding`] to Yrs prelim entries.
///
/// Scalar fields -> native Yrs keys. `column_mappings` uses JSON bridge.
pub(super) fn to_yrs_prelim(b: &SheetDataBinding) -> Vec<(&'static str, Any)> {
    let mut entries: Vec<(&'static str, Any)> = vec![
        (KEY_ID, Any::String(Arc::from(b.id.as_str()))),
        (KEY_SHEET_ID, Any::String(Arc::from(b.sheet_id.as_str()))),
        (
            KEY_CONNECTION_ID,
            Any::String(Arc::from(b.connection_id.as_str())),
        ),
        (KEY_COLUMN_MAPPINGS, json_any(&b.column_mappings)),
        (KEY_AUTO_GENERATE_ROWS, Any::Bool(b.auto_generate_rows)),
        (KEY_HEADER_ROW, Any::Number(b.header_row as f64)),
        (KEY_DATA_START_ROW, Any::Number(b.data_start_row as f64)),
        (
            KEY_PRESERVE_HEADER_FORMATTING,
            Any::Bool(b.preserve_header_formatting),
        ),
    ];
    if let Some(ts) = b.last_refresh {
        entries.push((KEY_LAST_REFRESH, Any::Number(ts as f64)));
    }
    if let Some(count) = b.last_row_count {
        entries.push((KEY_LAST_ROW_COUNT, Any::Number(count as f64)));
    }
    entries
}

/// Read a [`SheetDataBinding`] from a structured Y.Map.
pub(super) fn from_yrs_map<T: yrs::ReadTxn>(map: &MapRef, txn: &T) -> Option<SheetDataBinding> {
    let id = read_string(map, txn, KEY_ID)?;
    Some(SheetDataBinding {
        id,
        sheet_id: read_string(map, txn, KEY_SHEET_ID).unwrap_or_default(),
        connection_id: read_string(map, txn, KEY_CONNECTION_ID).unwrap_or_default(),
        column_mappings: read_json(map, txn, KEY_COLUMN_MAPPINGS).unwrap_or_default(),
        auto_generate_rows: read_bool(map, txn, KEY_AUTO_GENERATE_ROWS).unwrap_or(true),
        header_row: read_i32(map, txn, KEY_HEADER_ROW).unwrap_or(0),
        data_start_row: read_i32(map, txn, KEY_DATA_START_ROW).unwrap_or(1),
        preserve_header_formatting: read_bool(map, txn, KEY_PRESERVE_HEADER_FORMATTING)
            .unwrap_or(true),
        last_refresh: read_i64(map, txn, KEY_LAST_REFRESH),
        last_row_count: read_u32(map, txn, KEY_LAST_ROW_COUNT),
    })
}
