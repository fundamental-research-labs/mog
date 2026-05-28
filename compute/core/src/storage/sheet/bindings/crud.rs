//! Sheet-level data binding CRUD operations.

use yrs::{Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use super::{codec, ids, yrs_io};
use crate::engine_types::bindings::{
    ColumnMapping, CreateBindingOptions, SheetDataBinding, UpdateBindingFields,
};
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;

/// Create a new sheet data binding.
///
/// Stores the binding as a structured Y.Map in the sheet's `bindings` map.
///
/// # Errors
///
/// Returns `ComputeError::SheetNotFound` if the sheet does not exist.
pub fn create_binding(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &str,
    connection_id: &str,
    column_mappings: Vec<ColumnMapping>,
    options: CreateBindingOptions,
    id_alloc: &cell_types::IdAllocator,
) -> Result<SheetDataBinding, ComputeError> {
    let binding_id = ids::generate_binding_id(id_alloc);

    let binding = SheetDataBinding {
        id: binding_id.clone(),
        sheet_id: sheet_id.to_string(),
        connection_id: connection_id.to_string(),
        column_mappings,
        auto_generate_rows: options.auto_generate_rows.unwrap_or(true),
        header_row: options.header_row.unwrap_or(0),
        data_start_row: options.data_start_row.unwrap_or(1),
        preserve_header_formatting: options.preserve_header_formatting.unwrap_or(true),
        last_refresh: None,
        last_row_count: None,
    };

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let bindings_map = yrs_io::get_bindings_map(&txn, sheets, sheet_id).ok_or_else(|| {
        ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_string(),
        }
    })?;

    // Write as structured Y.Map
    let prelim: MapPrelim = codec::to_yrs_prelim(&binding).into_iter().collect();
    bindings_map.insert(&mut txn, &*binding_id, prelim);

    Ok(binding)
}

/// Get all data bindings for a sheet.
///
/// Returns an empty vector if the sheet or bindings map does not exist.
pub fn get_all_bindings(doc: &Doc, sheets: &MapRef, sheet_id: &str) -> Vec<SheetDataBinding> {
    let txn = doc.transact();
    let bindings_map = match yrs_io::get_bindings_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return vec![],
    };
    yrs_io::read_all_bindings(&txn, &bindings_map)
}

/// Get a specific data binding by ID.
///
/// Returns `None` if the sheet or binding does not exist.
pub fn get_binding(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &str,
    binding_id: &str,
) -> Option<SheetDataBinding> {
    let txn = doc.transact();
    let bindings_map = yrs_io::get_bindings_map(&txn, sheets, sheet_id)?;
    let out = bindings_map.get(&txn, binding_id)?;
    match &out {
        Out::YMap(map) => codec::from_yrs_map(map, &txn),
        _ => None,
    }
}

/// Update a sheet data binding with partial field updates.
///
/// Returns the updated binding, or `None` if the sheet or binding was not found.
pub fn update_binding(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &str,
    binding_id: &str,
    updates: UpdateBindingFields,
) -> Option<SheetDataBinding> {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let bindings_map = yrs_io::get_bindings_map(&txn, sheets, sheet_id)?;
    let out = bindings_map.get(&txn, binding_id)?;
    let mut binding = match &out {
        Out::YMap(map) => codec::from_yrs_map(map, &txn)?,
        _ => return None,
    };

    // Apply updates
    if let Some(conn) = updates.connection_id {
        binding.connection_id = conn;
    }
    if let Some(mappings) = updates.column_mappings {
        binding.column_mappings = mappings;
    }
    if let Some(v) = updates.auto_generate_rows {
        binding.auto_generate_rows = v;
    }
    if let Some(v) = updates.header_row {
        binding.header_row = v;
    }
    if let Some(v) = updates.data_start_row {
        binding.data_start_row = v;
    }
    if let Some(v) = updates.preserve_header_formatting {
        binding.preserve_header_formatting = v;
    }

    // Write back as structured Y.Map
    let prelim: MapPrelim = codec::to_yrs_prelim(&binding).into_iter().collect();
    bindings_map.insert(&mut txn, binding_id, prelim);

    Some(binding)
}

/// Update binding refresh metadata (lastRefresh, lastRowCount).
///
/// This is a lightweight update intended for system-level bookkeeping
/// (no undo tracking in the TS version).
pub fn update_refresh_metadata(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &str,
    binding_id: &str,
    last_refresh: i64,
    last_row_count: u32,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let bindings_map = match yrs_io::get_bindings_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return,
    };
    let out = match bindings_map.get(&txn, binding_id) {
        Some(v) => v,
        None => return,
    };
    let mut binding = match &out {
        Out::YMap(map) => match codec::from_yrs_map(map, &txn) {
            Some(b) => b,
            None => return,
        },
        _ => return,
    };

    binding.last_refresh = Some(last_refresh);
    binding.last_row_count = Some(last_row_count);

    // Write back as structured Y.Map
    let prelim: MapPrelim = codec::to_yrs_prelim(&binding).into_iter().collect();
    bindings_map.insert(&mut txn, binding_id, prelim);
}

/// Remove a sheet data binding.
///
/// Returns `true` if the binding was found and removed, `false` otherwise.
pub fn remove_binding(doc: &Doc, sheets: &MapRef, sheet_id: &str, binding_id: &str) -> bool {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let bindings_map = match yrs_io::get_bindings_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return false,
    };

    // Check if binding exists before removing
    if bindings_map.get(&txn, binding_id).is_none() {
        return false;
    }

    bindings_map.remove(&mut txn, binding_id);
    true
}
