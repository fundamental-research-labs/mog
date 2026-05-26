//! Custom cell style CRUD service functions.
//!
//! Read-only queries take `&EngineStores`.
//! Mutations take `&mut EngineStores` and write through to the Yrs CRDT
//! document under `workbook.custom_cell_styles` for persistence and
//! collaboration sync.

use compute_document::schema::KEY_CUSTOM_CELL_STYLES;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::cell_style::CellStyleDef;
use value_types::ComputeError;
use yrs::{Any, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::snapshot::MutationResult;
use crate::storage::engine::stores::EngineStores;

/// Get or create the `custom_cell_styles` Y.Map under the workbook map.
///
/// For documents created before this feature was added, the map won't exist
/// in the schema. This helper ensures it's always present for writes.
fn get_or_create_styles_map(workbook: &MapRef, txn: &mut yrs::TransactionMut) -> MapRef {
    match workbook.get(txn, KEY_CUSTOM_CELL_STYLES) {
        Some(Out::YMap(m)) => m,
        _ => workbook.insert(
            txn,
            KEY_CUSTOM_CELL_STYLES,
            MapPrelim::from([] as [(&str, Any); 0]),
        ),
    }
}

// TODO(sync): Wire up Yrs observe callback for KEY_CUSTOM_CELL_STYLES map.
// On remote insert/update: deserialize JSON string and upsert into
// stores.custom_cell_styles.  On remote delete: remove from the map.
// The DocumentObserver in compute-document/src/observe.rs would need
// a new variant for workbook-level custom cell style changes.
// For now, the in-memory cache is populated from Yrs on engine construction,
// so single-user and file-load paths are correct.

/// Get all custom cell styles, sorted by name.
pub(in crate::storage::engine) fn get_all_custom_cell_styles(
    stores: &EngineStores,
) -> Vec<CellStyleDef> {
    let mut result: Vec<_> = stores.custom_cell_styles.values().cloned().collect();
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

/// Create a custom cell style.
///
/// Inserts into the in-memory FxHashMap and writes through to the Yrs CRDT
/// map for persistence.
pub(in crate::storage::engine) fn create_custom_cell_style(
    stores: &mut EngineStores,
    style: CellStyleDef,
) -> Result<MutationResult, ComputeError> {
    let style_id = style.id.clone();

    // Serialize for Yrs persistence
    let json_str = serde_json::to_string(&style).map_err(|e| ComputeError::Eval {
        message: format!("Failed to serialize cell style: {}", e),
    })?;

    // 1. Insert into in-memory cache
    stores.custom_cell_styles.insert(style_id.clone(), style);

    // 2. Write through to Yrs
    {
        let doc = stores.storage.doc();
        let workbook = doc.get_or_insert_map("workbook");
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let styles_map = get_or_create_styles_map(&workbook, &mut txn);
        styles_map.insert(
            &mut txn,
            &*style_id,
            Any::String(std::sync::Arc::from(json_str.as_str())),
        );
    }

    Ok(MutationResult::empty().with_data(&style_id)?)
}

/// Delete a custom cell style by ID.
pub(in crate::storage::engine) fn delete_custom_cell_style(
    stores: &mut EngineStores,
    style_id: &str,
) -> Result<MutationResult, ComputeError> {
    // 1. Remove from in-memory cache
    stores.custom_cell_styles.remove(style_id);

    // 2. Remove from Yrs
    {
        let doc = stores.storage.doc();
        let workbook = doc.get_or_insert_map("workbook");
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let styles_map = get_or_create_styles_map(&workbook, &mut txn);
        styles_map.remove(&mut txn, style_id);
    }

    Ok(MutationResult::empty())
}

/// Update a custom cell style.
///
/// Replaces the entry in the in-memory FxHashMap and Yrs map.
pub(in crate::storage::engine) fn update_custom_cell_style(
    stores: &mut EngineStores,
    style_id: &str,
    style: CellStyleDef,
) -> Result<MutationResult, ComputeError> {
    // Serialize for Yrs persistence
    let json_str = serde_json::to_string(&style).map_err(|e| ComputeError::Eval {
        message: format!("Failed to serialize cell style: {}", e),
    })?;

    // 1. Update in-memory cache
    stores
        .custom_cell_styles
        .insert(style_id.to_string(), style);

    // 2. Write through to Yrs
    {
        let doc = stores.storage.doc();
        let workbook = doc.get_or_insert_map("workbook");
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let styles_map = get_or_create_styles_map(&workbook, &mut txn);
        styles_map.remove(&mut txn, style_id);
        styles_map.insert(
            &mut txn,
            style_id,
            Any::String(std::sync::Arc::from(json_str.as_str())),
        );
    }

    Ok(MutationResult::empty())
}
