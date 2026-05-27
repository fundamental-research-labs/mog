//! CRUD operations for sheet filters stored in Yrs.

use std::collections::HashMap;

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;
use yrs::{Doc, Map, MapRef, Origin, Transact};

use crate::storage::infra::yrs_helpers::now_millis;

use super::codec::{
    filter_state_to_stored, get_filters_map, read_all_filters, read_stored_filter_from_out,
    stored_to_filter_state, write_stored_filter,
};
use super::{ColumnFilter, FilterKind, FilterSortState, FilterState};

/// Create and persist a filter inside an existing Yrs transaction.
///
/// This is used by composite model mutations, such as table creation, where
/// the dependent filter must share the same undo/redo entry as its parent.
#[allow(clippy::too_many_arguments)]
pub fn create_filter_in_txn(
    txn: &mut yrs::TransactionMut,
    sheets: &MapRef,
    sheet_id: &SheetId,
    header_start_cell_id: &str,
    header_end_cell_id: &str,
    data_end_cell_id: &str,
    filter_type: FilterKind,
    table_id: Option<String>,
    id_alloc: &cell_types::IdAllocator,
) -> Result<FilterState, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let filters_map =
        get_filters_map(txn, sheets, &sheet_hex).ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_hex.to_string(),
        })?;

    let id = format!("{:032x}", id_alloc.next_u128());
    let now = now_millis();
    let state = FilterState {
        id: id.clone(),
        filter_kind: filter_type,
        header_start_cell_id: header_start_cell_id.to_string(),
        header_end_cell_id: header_end_cell_id.to_string(),
        data_end_cell_id: data_end_cell_id.to_string(),
        column_filters: HashMap::new(),
        advanced_filter: None,
        sort_state: None,
        table_id,
        created_at: Some(now),
        updated_at: Some(now),
        start_row: None,
        start_col: None,
        end_row: None,
        end_col: None,
    };

    let stored = filter_state_to_stored(&state);
    write_stored_filter(&filters_map, txn, &id, &stored);
    Ok(state)
}

/// Upsert a complete FilterState into the sheet filters map.
pub fn upsert_filter_state(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    state: &FilterState,
) -> Result<(), ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map =
        get_filters_map(&txn, sheets, &sheet_hex).ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_hex.to_string(),
        })?;
    let stored = filter_state_to_stored(state);
    write_stored_filter(&filters_map, &mut txn, &state.id, &stored);
    Ok(())
}

// YrsStorage Filter Operations
// =============================================================================

// -------------------------------------------------------------------
// Create
// -------------------------------------------------------------------

/// Create a new filter for a range.
///
/// Stores the filter definition in the Yrs filters map. The range corners
/// are specified as CellId strings (Cell Identity Model).
///
/// Returns the created filter state.
#[allow(clippy::too_many_arguments)]
pub fn create_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    header_start_cell_id: &str,
    header_end_cell_id: &str,
    data_end_cell_id: &str,
    filter_type: FilterKind,
    table_id: Option<String>,
    id_alloc: &cell_types::IdAllocator,
) -> Result<FilterState, ComputeError> {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    create_filter_in_txn(
        &mut txn,
        sheets,
        sheet_id,
        header_start_cell_id,
        header_end_cell_id,
        data_end_cell_id,
        filter_type,
        table_id,
        id_alloc,
    )
}

// -------------------------------------------------------------------
// Read
// -------------------------------------------------------------------

/// Get a filter by ID.
pub fn get_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<FilterState> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let filters_map = get_filters_map(&txn, sheets, &sheet_hex)?;
    let out = filters_map.get(&txn, filter_id)?;
    let stored = read_stored_filter_from_out(&out, &txn)?;
    Some(stored_to_filter_state(&stored))
}

/// Get all filters in a sheet.
pub fn get_filters_in_sheet(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<FilterState> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };
    read_all_filters(&txn, &filters_map)
}

/// Get the count of filters in a sheet.
pub fn get_filter_count(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> usize {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return 0,
    };
    filters_map.len(&txn) as usize
}

/// Get the filter associated with a table by table ID.
pub fn get_table_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    table_id: &str,
) -> Option<FilterState> {
    let filters = get_filters_in_sheet(doc, sheets, sheet_id);
    filters
        .into_iter()
        .find(|f| f.table_id.as_deref() == Some(table_id))
}

/// Get all active filters in a sheet (filters with non-empty column_filters).
pub fn get_active_filters(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<FilterState> {
    let filters = get_filters_in_sheet(doc, sheets, sheet_id);
    filters
        .into_iter()
        .filter(|f| !f.column_filters.is_empty())
        .collect()
}

/// Get count of active column filters across all filters in a sheet.
pub fn get_active_filter_count(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> usize {
    let filters = get_filters_in_sheet(doc, sheets, sheet_id);
    filters.iter().map(|f| f.column_filters.len()).sum()
}

// -------------------------------------------------------------------
// Update — Column Filters
// -------------------------------------------------------------------

/// Set filter criteria for a specific column (by header CellId).
pub fn set_column_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    header_cell_id: &str,
    criteria: ColumnFilter,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let out = match filters_map.get(&txn, filter_id) {
        Some(o) => o,
        None => return,
    };
    let mut stored = match read_stored_filter_from_out(&out, &txn) {
        Some(y) => y,
        None => return,
    };

    // Add the new column filter directly
    stored
        .column_filters
        .insert(header_cell_id.to_string(), criteria);
    stored.updated_at = Some(now_millis());

    write_stored_filter(&filters_map, &mut txn, filter_id, &stored);
}

/// Clear filter criteria for a specific column.
pub fn clear_column_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    header_cell_id: &str,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let out = match filters_map.get(&txn, filter_id) {
        Some(o) => o,
        None => return,
    };
    let mut stored = match read_stored_filter_from_out(&out, &txn) {
        Some(y) => y,
        None => return,
    };

    stored.column_filters.remove(header_cell_id);
    stored.updated_at = Some(now_millis());

    write_stored_filter(&filters_map, &mut txn, filter_id, &stored);
}

/// Clear all column filters (show all rows).
pub fn clear_all_column_filters(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, filter_id: &str) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let out = match filters_map.get(&txn, filter_id) {
        Some(o) => o,
        None => return,
    };
    let mut stored = match read_stored_filter_from_out(&out, &txn) {
        Some(y) => y,
        None => return,
    };

    stored.column_filters.clear();
    stored.updated_at = Some(now_millis());

    write_stored_filter(&filters_map, &mut txn, filter_id, &stored);
}

// -------------------------------------------------------------------
// Update — Sort State
// -------------------------------------------------------------------

/// Set the sort state for a filter.
pub fn set_filter_sort_state(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    sort_state: Option<FilterSortState>,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let out = match filters_map.get(&txn, filter_id) {
        Some(o) => o,
        None => return,
    };
    let mut stored = match read_stored_filter_from_out(&out, &txn) {
        Some(y) => y,
        None => return,
    };

    stored.sort_state = sort_state;
    stored.updated_at = Some(now_millis());

    write_stored_filter(&filters_map, &mut txn, filter_id, &stored);
}

/// Get the sort state for a filter.
pub fn get_filter_sort_state(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<FilterSortState> {
    let filter = get_filter(doc, sheets, sheet_id, filter_id)?;
    filter.sort_state
}

// -------------------------------------------------------------------
// Delete
// -------------------------------------------------------------------

/// Delete a filter. Returns true if the filter was found and deleted.
pub fn delete_filter_in_txn(
    txn: &mut yrs::TransactionMut,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let filters_map = match get_filters_map(txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };

    if filters_map.get(txn, filter_id).is_none() {
        return false;
    }

    filters_map.remove(txn, filter_id);
    true
}

/// Delete a filter. Returns true if the filter was found and deleted.
pub fn delete_filter(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, filter_id: &str) -> bool {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    delete_filter_in_txn(&mut txn, sheets, sheet_id, filter_id)
}

/// Clear all filters for a sheet.
pub fn clear_all_filters(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let filters_map = match get_filters_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let keys: Vec<String> = filters_map
        .iter(&txn)
        .map(|(key, _)| key.to_string())
        .collect();

    for key in &keys {
        filters_map.remove(&mut txn, key.as_str());
    }
}

// -------------------------------------------------------------------
