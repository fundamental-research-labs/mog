//! Yrs storage codec for sheet filter state.

use std::collections::HashMap;
use std::sync::Arc;

use yrs::{Any, Map, MapPrelim, MapRef, Out};

use compute_document::schema::KEY_FILTERS;

use super::{AdvancedFilterState, ColumnFilter, FilterKind, FilterSortState, FilterState};

/// The storage serialization of FilterState.
///
/// `column_filters` and `sort_state` are native Rust types.  Individual
/// `ColumnFilter` values are still written as JSON strings per-column inside
/// the Yrs Y.Map (escape hatch for complex tagged enum), but this struct no
/// longer forces a JSON round-trip for the Rust intermediary layer.
#[derive(Debug, Clone)]
pub(in crate::storage::sheet::filters) struct StoredFilterState {
    pub(in crate::storage::sheet::filters) id: String,
    pub(in crate::storage::sheet::filters) filter_type: FilterKind,
    pub(in crate::storage::sheet::filters) header_start_cell_id: String,
    pub(in crate::storage::sheet::filters) header_end_cell_id: String,
    pub(in crate::storage::sheet::filters) data_end_cell_id: String,
    pub(in crate::storage::sheet::filters) column_filters: HashMap<String, ColumnFilter>,
    pub(in crate::storage::sheet::filters) advanced_filter: Option<AdvancedFilterState>,
    pub(in crate::storage::sheet::filters) sort_state: Option<FilterSortState>,
    pub(in crate::storage::sheet::filters) table_id: Option<String>,
    pub(in crate::storage::sheet::filters) created_at: Option<u64>,
    pub(in crate::storage::sheet::filters) updated_at: Option<u64>,
}

// =============================================================================
// Internal Helpers
// =============================================================================

/// Get the `filters` MapRef for a given sheet (read-only).
pub(in crate::storage::sheet::filters) fn get_filters_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_FILTERS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

// =============================================================================
// Structured Y.Map read/write helpers
// =============================================================================

/// Y.Map key constants for StoredFilterState fields.
mod filter_keys {
    pub const ID: &str = "id";
    pub const FILTER_TYPE: &str = "type";
    pub const HEADER_START_CELL_ID: &str = "headerStartCellId";
    pub const HEADER_END_CELL_ID: &str = "headerEndCellId";
    pub const DATA_END_CELL_ID: &str = "dataEndCellId";
    pub const COLUMN_FILTERS: &str = "columnFilters";
    pub const ADVANCED_FILTER: &str = "advancedFilter";
    pub const SORT_STATE: &str = "sortState";
    pub const TABLE_ID: &str = "tableId";
    pub const CREATED_AT: &str = "createdAt";
    pub const UPDATED_AT: &str = "updatedAt";
}

/// Read a string from a Y.Map.
fn flt_read_str<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<String> {
    match map.get(txn, key)? {
        Out::Any(Any::String(s)) => Some(s.to_string()),
        _ => None,
    }
}

fn flt_read_num<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<f64> {
    match map.get(txn, key)? {
        Out::Any(Any::Number(n)) => Some(n),
        _ => None,
    }
}

/// Write a StoredFilterState into a parent Y.Map at the given key.
///
/// Creates an empty Y.Map sub-entry, then populates all fields as native
/// Yrs keys.  `column_filters` is serialized to a JSON string per the
/// escape-hatch pattern (complex tagged enum).  `sort_state` is likewise
/// serialized to JSON for the Yrs layer.
pub(in crate::storage::sheet::filters) fn write_stored_filter(
    parent: &MapRef,
    txn: &mut yrs::TransactionMut,
    key: &str,
    stored: &StoredFilterState,
) {
    use filter_keys::*;
    parent.insert(txn, key, MapPrelim::from([] as [(&str, Any); 0]));
    let map = match parent.get(txn, key) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };
    let ft_str = match stored.filter_type {
        FilterKind::AutoFilter => "autoFilter",
        FilterKind::TableFilter => "tableFilter",
        FilterKind::AdvancedFilter => "advancedFilter",
    };
    map.insert(txn, ID, Any::String(Arc::from(stored.id.as_str())));
    map.insert(txn, FILTER_TYPE, Any::String(Arc::from(ft_str)));
    map.insert(
        txn,
        HEADER_START_CELL_ID,
        Any::String(Arc::from(stored.header_start_cell_id.as_str())),
    );
    map.insert(
        txn,
        HEADER_END_CELL_ID,
        Any::String(Arc::from(stored.header_end_cell_id.as_str())),
    );
    map.insert(
        txn,
        DATA_END_CELL_ID,
        Any::String(Arc::from(stored.data_end_cell_id.as_str())),
    );
    // Write column_filters as a JSON string per the Yrs escape-hatch pattern
    let cf_json =
        serde_json::to_string(&stored.column_filters).unwrap_or_else(|_| "{}".to_string());
    map.insert(
        txn,
        COLUMN_FILTERS,
        Any::String(Arc::from(cf_json.as_str())),
    );
    if let Some(ref advanced_filter) = stored.advanced_filter {
        let af_json = serde_json::to_string(advanced_filter).unwrap_or_else(|_| "null".to_string());
        map.insert(
            txn,
            ADVANCED_FILTER,
            Any::String(Arc::from(af_json.as_str())),
        );
    }
    if let Some(ref ss) = stored.sort_state {
        let ss_json = serde_json::to_string(ss).unwrap_or_else(|_| "null".to_string());
        map.insert(txn, SORT_STATE, Any::String(Arc::from(ss_json.as_str())));
    }
    if let Some(ref tid) = stored.table_id {
        map.insert(txn, TABLE_ID, Any::String(Arc::from(tid.as_str())));
    }
    if let Some(ts) = stored.created_at {
        map.insert(txn, CREATED_AT, Any::Number(ts as f64));
    }
    if let Some(ts) = stored.updated_at {
        map.insert(txn, UPDATED_AT, Any::Number(ts as f64));
    }
}

/// Read a StoredFilterState from a structured Y.Map.
fn stored_filter_from_yrs_map<T: yrs::ReadTxn>(map: &MapRef, txn: &T) -> Option<StoredFilterState> {
    use filter_keys::*;
    let id = flt_read_str(map, txn, ID)?;
    let ft_str = flt_read_str(map, txn, FILTER_TYPE).unwrap_or_else(|| "autoFilter".to_string());
    let filter_type = match ft_str.as_str() {
        "tableFilter" => FilterKind::TableFilter,
        "advancedFilter" => FilterKind::AdvancedFilter,
        _ => FilterKind::AutoFilter,
    };
    Some(StoredFilterState {
        id,
        filter_type,
        header_start_cell_id: flt_read_str(map, txn, HEADER_START_CELL_ID).unwrap_or_default(),
        header_end_cell_id: flt_read_str(map, txn, HEADER_END_CELL_ID).unwrap_or_default(),
        data_end_cell_id: flt_read_str(map, txn, DATA_END_CELL_ID).unwrap_or_default(),
        column_filters: {
            let cf_str = flt_read_str(map, txn, COLUMN_FILTERS).unwrap_or_else(|| "{}".to_string());
            serde_json::from_str(&cf_str).unwrap_or_default()
        },
        advanced_filter: flt_read_str(map, txn, ADVANCED_FILTER)
            .and_then(|s| serde_json::from_str(&s).ok()),
        sort_state: flt_read_str(map, txn, SORT_STATE).and_then(|s| serde_json::from_str(&s).ok()),
        table_id: flt_read_str(map, txn, TABLE_ID),
        created_at: flt_read_num(map, txn, CREATED_AT).map(|n| n as u64),
        updated_at: flt_read_num(map, txn, UPDATED_AT).map(|n| n as u64),
    })
}

/// Read a StoredFilterState from a Yrs Out value.
pub(in crate::storage::sheet::filters) fn read_stored_filter_from_out<T: yrs::ReadTxn>(
    out: &Out,
    txn: &T,
) -> Option<StoredFilterState> {
    match out {
        Out::YMap(map) => stored_filter_from_yrs_map(map, txn),
        _ => None,
    }
}

/// Convert StoredFilterState to FilterState (runtime representation).
pub(in crate::storage::sheet::filters) fn stored_to_filter_state(
    stored: &StoredFilterState,
) -> FilterState {
    FilterState {
        id: stored.id.clone(),
        filter_kind: stored.filter_type.clone(),
        header_start_cell_id: stored.header_start_cell_id.clone(),
        header_end_cell_id: stored.header_end_cell_id.clone(),
        data_end_cell_id: stored.data_end_cell_id.clone(),
        column_filters: stored.column_filters.clone(),
        advanced_filter: stored.advanced_filter.clone(),
        sort_state: stored.sort_state.clone(),
        table_id: stored.table_id.clone(),
        created_at: stored.created_at,
        updated_at: stored.updated_at,
        start_row: None,
        start_col: None,
        end_row: None,
        end_col: None,
    }
}

/// Convert FilterState to StoredFilterState for storage.
pub(in crate::storage::sheet::filters) fn filter_state_to_stored(
    state: &FilterState,
) -> StoredFilterState {
    StoredFilterState {
        id: state.id.clone(),
        filter_type: state.filter_kind.clone(),
        header_start_cell_id: state.header_start_cell_id.clone(),
        header_end_cell_id: state.header_end_cell_id.clone(),
        data_end_cell_id: state.data_end_cell_id.clone(),
        column_filters: state.column_filters.clone(),
        advanced_filter: state.advanced_filter.clone(),
        sort_state: state.sort_state.clone(),
        table_id: state.table_id.clone(),
        created_at: state.created_at,
        updated_at: state.updated_at,
    }
}

/// Public wrapper for hydration to write a FilterState to Y.Map.
///
/// Converts FilterState -> StoredFilterState and writes it as a structured
/// Y.Map entry, using the same path as runtime CRUD operations.
pub fn write_filter_state_to_ymap(
    filters_map: &MapRef,
    txn: &mut yrs::TransactionMut,
    state: &FilterState,
) {
    let stored = filter_state_to_stored(state);
    write_stored_filter(filters_map, txn, &state.id, &stored);
}

/// Read all filters from a filters map.
pub(in crate::storage::sheet::filters) fn read_all_filters<T: yrs::ReadTxn>(
    txn: &T,
    filters_map: &MapRef,
) -> Vec<FilterState> {
    let mut result = Vec::new();
    for (_key, value) in filters_map.iter(txn) {
        if let Some(stored) = read_stored_filter_from_out(&value, txn) {
            result.push(stored_to_filter_state(&stored));
        }
    }
    result
}

// =============================================================================
