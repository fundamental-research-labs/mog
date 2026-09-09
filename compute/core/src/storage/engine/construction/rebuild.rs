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
) -> Result<CellStore, ComputeError> {
    let mut cell_store = CellStore::from_snapshot(snapshot.clone())?;
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
