use cell_types::SheetId;
use rustc_hash::FxHashMap;
use value_types::ComputeError;

use crate::cells::CellStore;
use crate::identity::GridIndex;
use crate::snapshot::WorkbookSnapshot;
use crate::storage::WorkbookStorage;
use crate::storage::sheet::visibility;

pub(in crate::storage::engine) fn build_finalized_store_from_snapshot(
    storage: &WorkbookStorage,
    snapshot: &WorkbookSnapshot,
    grid_indexes: &FxHashMap<SheetId, GridIndex>,
    layout_metrics: domain_types::units::LayoutMetrics,
) -> Result<CellStore, ComputeError> {
    let mut cell_store = CellStore::from_snapshot(snapshot.clone())?;
    cell_store.install_imported_array_caches(&storage.imported_array_caches);
    cell_store.install_cell_metadata_provider(crate::storage::engine::cell_metadata::provider(
        storage,
        layout_metrics,
    ));
    cell_store.date1904 =
        crate::storage::workbook::settings::get_settings(&storage.metadata).date1904;
    install_ordered_row_col_indexes(&mut cell_store, grid_indexes);
    sync_enable_calculation_flags_for_store(storage, &mut cell_store);
    cell_store.finalize_range_hydration();
    Ok(cell_store)
}

pub(in crate::storage::engine) fn install_ordered_row_col_indexes(
    cell_store: &mut CellStore,
    grid_indexes: &FxHashMap<SheetId, GridIndex>,
) {
    cell_store.install_native_axes(
        grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_axis(), grid.col_axis())),
    );
}

pub(in crate::storage::engine) fn sync_enable_calculation_flags_for_store(
    storage: &WorkbookStorage,
    cell_store: &mut CellStore,
) {
    let sheet_ids: Vec<_> = cell_store.sheet_ids().copied().collect();
    for sheet_id in sheet_ids {
        let enabled = visibility::is_sheet_calculation_enabled(&storage, &sheet_id);
        cell_store.set_enable_calculation(&sheet_id, enabled);
    }
}

/// Build the native axes and metadata projection before initial evaluation.
pub(in crate::storage::engine) fn build_initial_store(
    storage: &WorkbookStorage,
    snapshot: &WorkbookSnapshot,
    layout_metrics: domain_types::units::LayoutMetrics,
) -> Result<CellStore, ComputeError> {
    let mut cell_store = CellStore::from_snapshot(snapshot.clone())?;
    cell_store.install_imported_array_caches(&storage.imported_array_caches);
    let indexes = super::indexes::build_grid_indexes(
        &cell_store,
        snapshot,
        std::sync::Arc::new(cell_types::IdAllocator::with_seed(
            snapshot.next_identity_counter(),
        )),
    )?;
    cell_store.install_cell_metadata_provider(crate::storage::engine::cell_metadata::provider(
        storage,
        layout_metrics,
    ));
    cell_store.date1904 =
        crate::storage::workbook::settings::get_settings(&storage.metadata).date1904;
    install_ordered_row_col_indexes(&mut cell_store, &indexes);
    sync_enable_calculation_flags_for_store(storage, &mut cell_store);
    cell_store.finalize_range_hydration();
    Ok(cell_store)
}
