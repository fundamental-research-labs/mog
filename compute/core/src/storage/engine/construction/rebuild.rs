use cell_types::SheetId;
use rustc_hash::FxHashMap;
use value_types::ComputeError;

use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use crate::snapshot::WorkbookSnapshot;
use crate::storage::WorkbookStorage;
use crate::storage::sheet::visibility;

pub(in crate::storage::engine) fn build_finalized_mirror_from_snapshot(
    storage: &WorkbookStorage,
    snapshot: &WorkbookSnapshot,
    grid_indexes: &FxHashMap<SheetId, GridIndex>,
    layout_metrics: domain_types::units::LayoutMetrics,
) -> Result<CellMirror, ComputeError> {
    let mut mirror = CellMirror::from_snapshot(snapshot.clone())?;
    mirror.install_cell_metadata_provider(crate::storage::engine::cell_metadata::provider(
        storage,
        layout_metrics,
    ));
    mirror.date1904 = crate::storage::workbook::settings::get_settings(&storage.metadata).date1904;
    install_ordered_row_col_indexes(&mut mirror, grid_indexes);
    sync_enable_calculation_flags_for_mirror(storage, &mut mirror);
    mirror.finalize_range_hydration();
    Ok(mirror)
}

pub(in crate::storage::engine) fn install_ordered_row_col_indexes(
    mirror: &mut CellMirror,
    grid_indexes: &FxHashMap<SheetId, GridIndex>,
) {
    mirror.install_native_axes(
        grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_axis(), grid.col_axis())),
    );
}

pub(in crate::storage::engine) fn sync_enable_calculation_flags_for_mirror(
    storage: &WorkbookStorage,
    mirror: &mut CellMirror,
) {
    let sheet_ids: Vec<_> = mirror.sheet_ids().copied().collect();
    for sheet_id in sheet_ids {
        let enabled = visibility::is_sheet_calculation_enabled(&storage, &sheet_id);
        mirror.set_enable_calculation(&sheet_id, enabled);
    }
}

/// Build the native axes and metadata projection before initial evaluation.
pub(in crate::storage::engine) fn build_initial_mirror(
    storage: &WorkbookStorage,
    snapshot: &WorkbookSnapshot,
    layout_metrics: domain_types::units::LayoutMetrics,
) -> Result<CellMirror, ComputeError> {
    let mut mirror = CellMirror::from_snapshot(snapshot.clone())?;
    let indexes = super::indexes::build_grid_indexes(
        &mirror,
        snapshot,
        std::sync::Arc::new(cell_types::IdAllocator::with_seed(
            snapshot.next_identity_counter(),
        )),
    )?;
    mirror.install_cell_metadata_provider(crate::storage::engine::cell_metadata::provider(
        storage,
        layout_metrics,
    ));
    mirror.date1904 = crate::storage::workbook::settings::get_settings(&storage.metadata).date1904;
    install_ordered_row_col_indexes(&mut mirror, &indexes);
    sync_enable_calculation_flags_for_mirror(storage, &mut mirror);
    mirror.finalize_range_hydration();
    Ok(mirror)
}
