use crate::storage::workbook::slicers;
use crate::table::types::{Slicer, SlicerCache, TableColumn};
use value_types::ComputeError;

pub(in crate::storage::engine) fn map_slicer_invalidation_reason(
    reason: &str,
) -> Result<slicers::CacheInvalidationEventReason, ComputeError> {
    let internal: slicers::SlicerInvalidationReason =
        serde_json::from_value(serde_json::Value::String(reason.to_string())).map_err(|e| {
            ComputeError::Eval {
                message: format!("Invalid invalidation reason '{}': {}", reason, e),
            }
        })?;
    Ok(slicers::map_invalidation_reason(internal))
}

pub(in crate::storage::engine) fn map_slicer_disconnection_reason(
    reason: &str,
) -> Result<slicers::DisconnectionEventReason, ComputeError> {
    let internal: slicers::SlicerDisconnectionReason =
        serde_json::from_value(serde_json::Value::String(reason.to_string())).map_err(|e| {
            ComputeError::Eval {
                message: format!("Invalid disconnection reason '{}': {}", reason, e),
            }
        })?;
    Ok(slicers::map_disconnection_reason(internal))
}

pub(in crate::storage::engine) fn get_slicer_items_from_cache(
    cache: SlicerCache,
) -> Vec<slicers::SlicerItem> {
    slicers::cache_to_slicer_items(&cache)
}

pub(in crate::storage::engine) fn is_slicer_column_connected(
    source_column_id: &str,
    table_columns: &[TableColumn],
) -> bool {
    slicers::is_slicer_column_connected(source_column_id, table_columns)
}

pub(in crate::storage::engine) fn find_slicers_for_table(
    slicer_list: &[Slicer],
    table_id: &str,
) -> Vec<usize> {
    slicers::find_slicers_for_table(slicer_list, table_id)
}

pub(in crate::storage::engine) fn find_disconnected_slicers(
    slicer_list: &[Slicer],
    existing_table_ids: &[String],
) -> Vec<usize> {
    let id_refs: Vec<&str> = existing_table_ids.iter().map(|s| s.as_str()).collect();
    slicers::find_disconnected_slicers(slicer_list, &id_refs)
}

// -------------------------------------------------------------------
// Sorting
