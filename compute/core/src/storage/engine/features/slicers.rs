use super::super::YrsComputeEngine;
use super::super::services::features as svc;
use crate::snapshot::MutationResult;
use crate::storage::workbook::slicers;
use crate::table::types::{Slicer, SlicerCache, TableColumn};
use cell_types::SheetId;
use domain_types::domain::slicer::{StoredSlicer, StoredSlicerUpdate};
use value_types::{CellValue, ComputeError};

pub(super) fn create_slicer(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    config: StoredSlicer,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    svc::create_slicer(&engine.stores, sheet_id, config).map(|r| {
        (
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            r,
        )
    })
}

pub(super) fn delete_slicer(
    engine: &YrsComputeEngine,
    _sheet_id: &SheetId,
    slicer_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    svc::delete_slicer(&engine.stores, slicer_id).map(|r| {
        (
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            r,
        )
    })
}

pub(super) fn update_slicer_config(
    engine: &YrsComputeEngine,
    _sheet_id: &SheetId,
    slicer_id: &str,
    update: StoredSlicerUpdate,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    svc::update_slicer_config(&engine.stores, slicer_id, &update).map(|r| {
        (
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            r,
        )
    })
}

pub(super) fn get_all_slicers(engine: &YrsComputeEngine, sheet_id: &SheetId) -> Vec<StoredSlicer> {
    svc::get_all_slicers(&engine.stores, sheet_id)
}

pub(super) fn get_all_slicers_workbook(engine: &YrsComputeEngine) -> Vec<StoredSlicer> {
    svc::get_all_slicers_workbook(&engine.stores)
}

pub(super) fn get_slicer_state(
    engine: &YrsComputeEngine,
    _sheet_id: &SheetId,
    slicer_id: &str,
) -> Option<StoredSlicer> {
    svc::get_slicer_state(&engine.stores, slicer_id)
}

pub(super) fn toggle_slicer_item(
    engine: &YrsComputeEngine,
    _sheet_id: &SheetId,
    slicer_id: &str,
    value: CellValue,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    svc::toggle_slicer_item(&engine.stores, slicer_id, &value).map(|r| {
        (
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            r,
        )
    })
}

pub(super) fn clear_slicer_selection(
    engine: &YrsComputeEngine,
    _sheet_id: &SheetId,
    slicer_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    svc::clear_slicer_selection(&engine.stores, slicer_id).map(|r| {
        (
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            r,
        )
    })
}

pub(super) fn map_slicer_invalidation_reason(
    engine: &YrsComputeEngine,
    reason: &str,
) -> Result<slicers::CacheInvalidationEventReason, ComputeError> {
    svc::map_slicer_invalidation_reason(reason)
}

pub(super) fn map_slicer_disconnection_reason(
    engine: &YrsComputeEngine,
    reason: &str,
) -> Result<slicers::DisconnectionEventReason, ComputeError> {
    svc::map_slicer_disconnection_reason(reason)
}

pub(super) fn get_slicer_items_from_cache(
    engine: &YrsComputeEngine,
    cache: SlicerCache,
) -> Vec<slicers::SlicerItem> {
    svc::get_slicer_items_from_cache(cache)
}

pub(super) fn is_slicer_column_connected(
    engine: &YrsComputeEngine,
    source_column_id: &str,
    table_columns: Vec<TableColumn>,
) -> bool {
    svc::is_slicer_column_connected(source_column_id, &table_columns)
}

pub(super) fn find_slicers_for_table(
    engine: &YrsComputeEngine,
    slicer_list: Vec<Slicer>,
    table_id: &str,
) -> Vec<usize> {
    svc::find_slicers_for_table(&slicer_list, table_id)
}

pub(super) fn find_disconnected_slicers(
    engine: &YrsComputeEngine,
    slicer_list: Vec<Slicer>,
    existing_table_ids: Vec<String>,
) -> Vec<usize> {
    svc::find_disconnected_slicers(&slicer_list, &existing_table_ids)
}
