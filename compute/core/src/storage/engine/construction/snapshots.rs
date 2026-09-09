use super::*;

pub(in crate::storage::engine) fn build_sheet_snapshot(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    name: &str,
) -> SheetSnapshot {
    let (rows, cols) = stores
        .grid_indexes
        .get(sheet_id)
        .map(|g| (g.row_count(), g.col_count()))
        .unwrap_or((100, 26));

    let mut cells = Vec::new();
    if let Some(sheet) = cell_store.get_sheet(sheet_id) {
        for (cell_id, entry) in sheet.cells_iter() {
            if let Some(pos) = cell_store.resolve_position(cell_id) {
                let formula = stores.compute.get_formula(cell_id).map(|s| s.to_string());

                // Reconstruct array_ref from the projection registry so that
                // rebuild_compute_core() preserves dynamic array metadata.
                // Without this, projections are not pre-registered on the
                // second full_recalc, causing false #SPILL! errors.
                let array_ref = cell_store.projection_registry.get(cell_id).map(|proj| {
                    let end_row = proj.origin_row + proj.rows - 1;
                    let end_col = proj.origin_col + proj.cols - 1;
                    let start =
                        crate::storage::engine::export::pos_to_a1(proj.origin_row, proj.origin_col);
                    let end = crate::storage::engine::export::pos_to_a1(end_row, end_col);
                    format!("{start}:{end}")
                });

                cells.push(crate::snapshot::CellData {
                    cell_id: cell_id.to_uuid_string(),
                    row: pos.row(),
                    col: pos.col(),
                    value: entry.value.clone(),
                    formula,
                    identity_formula: sheet.formula(cell_id).cloned(),
                    array_ref,
                });
            }
        }
    }

    // Metadata-only and formula-reference identities carry positions without
    // allocating an authored value. Include them in the transport snapshot.
    let mut seen: rustc_hash::FxHashSet<_> = cells
        .iter()
        .filter_map(|cell| CellId::from_uuid_str(&cell.cell_id).ok())
        .collect();
    let mut identities = Vec::new();
    let mut include_identity = |id: CellId, row: u32, col: u32| {
        if seen.insert(id) {
            identities.push(snapshot_types::CellIdentityPosition {
                cell_id: id,
                row,
                col,
            });
        }
    };
    for (id, row, col) in cell_store.cells(sheet_id) {
        include_identity(id, row, col);
    }

    let ranges = cell_store
        .get_sheet(sheet_id)
        .map(|sheet| {
            sheet
                .iter_ranges()
                .map(|(_, range)| range.to_snapshot())
                .collect()
        })
        .unwrap_or_default();

    SheetSnapshot {
        identities,
        row_axis: stores
            .grid_indexes
            .get(sheet_id)
            .map(|grid| grid.row_axis().store().clone()),
        col_axis: stores
            .grid_indexes
            .get(sheet_id)
            .map(|grid| grid.col_axis().store().clone()),
        id: sheet_id.to_uuid_string(),
        name: name.to_string(),
        rows,
        cols,
        cells,
        ranges,
    }
}

/// Build a complete `WorkbookSnapshot` from the engine's internal state.
///
/// Reads cell data from the `CellStore` (via `build_sheet_snapshot`),
/// named ranges from `WorkbookStorage` (native metadata), and
/// tables/pivot tables from the `CellStore` metadata, and data table regions
/// from the native metadata.
///
/// This MUST be called before replacing `ComputeCore`, since
/// `build_sheet_snapshot` reads formula strings from `ComputeCore`.
pub(in crate::storage::engine) fn build_workbook_snapshot(
    stores: &EngineStores,
    cell_store: &CellStore,
) -> WorkbookSnapshot {
    use crate::storage::sheet::properties;
    // 1. Build sheet snapshots
    let sheet_ids = stores.storage.sheet_order();
    let sheet_snapshots: Vec<SheetSnapshot> = sheet_ids
        .iter()
        .filter_map(|sheet_id| {
            let name = properties::get_sheet_name(&stores.storage, sheet_id)?;
            Some(build_sheet_snapshot(stores, cell_store, sheet_id, &name))
        })
        .collect();

    // Authored typed names remain available when ComputeCore is rebuilt.
    let defined_names = workbook_named_ranges::get_all_named_ranges(&stores.storage.metadata);
    let nil_sheet = SheetId::from_raw(0);
    let named_ranges_vec = defined_names_to_named_range_defs(defined_names, |identity| {
        stores
            .compute
            .to_a1_display_qualified(cell_store, &nil_sheet, identity)
    });

    // 3. Tables, pivot tables, data table regions from cell_store (before rebuild)
    let canonical_tables =
        crate::storage::engine::services::export::table_catalog_for_snapshot(stores, cell_store);
    let pivot_tables = cell_store.all_pivot_tables().to_vec();
    let data_table_regions = cell_store.all_data_table_regions().to_vec();

    // 4. Iterative calc settings
    let iterative_calc = stores.compute.iterative_calc();
    let max_iterations = stores.compute.max_iterations();
    let max_change = stores.compute.max_change();
    // The internal scheduler stores `max_change` as bare f64; the boundary
    // type pins it to `FiniteF64`. Convergence threshold values originate
    // from snapshots that were already finite-typed, so non-finite here
    // would only be possible via direct setter abuse — fall back to the
    // Excel default rather than panicking on extraction.
    let max_change = value_types::FiniteF64::new(max_change)
        .unwrap_or_else(|| value_types::FiniteF64::must(0.001));
    let mut calculation_settings =
        workbook_settings::get_calculation_settings(&stores.storage.metadata);
    calculation_settings.enable_iterative_calculation = iterative_calc;
    calculation_settings.max_iterations = max_iterations;
    calculation_settings.max_change = max_change;
    calculation_settings.calc_mode = stores.compute.calc_mode();

    WorkbookSnapshot {
        axis_run_high_water_mark: Some(
            stores
                .grid_id_alloc
                .axis_run_high_water_mark()
                .max(stores.compute.id_alloc().axis_run_high_water_mark()),
        ),
        identity_high_water_mark: Some(
            stores
                .grid_id_alloc
                .high_water_mark()
                .max(stores.compute.id_alloc().high_water_mark()),
        ),
        sheets: sheet_snapshots,
        named_ranges: named_ranges_vec,
        tables: Vec::new(),
        canonical_tables,
        pivot_tables,
        data_table_regions,
        iterative_calc,
        max_iterations,
        max_change,
        calculation_settings: Some(calculation_settings),
    }
}
