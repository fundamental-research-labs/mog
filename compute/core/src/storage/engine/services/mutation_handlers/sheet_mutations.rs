use cell_types::SheetId;
use value_types::ComputeError;

use crate::mirror::CellMirror;
use crate::range_manager::RangeSpatialIndex;
use crate::snapshot::{
    ChangeKind, MutationResult, RecalcResult, SheetChange, SheetChangeField,
    SheetLifecycleRuntimeHint,
};
use crate::storage::engine::stores::EngineStores;
use compute_document::hex::id_to_hex;
use domain_types::units::Pixels;

// ---------------------------------------------------------------------------
// mutation_create_sheet
// ---------------------------------------------------------------------------

/// Create a new sheet with full store synchronization.
pub(in crate::storage::engine) fn mutation_create_sheet(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    name: &str,
    default_col_width_px: Option<f64>,
) -> Result<(String, MutationResult), ComputeError> {
    create_sheet(stores, mirror, name, default_col_width_px)
}

/// Create the implicit default sheet and return complete initial workbook state.
pub(in crate::storage::engine) fn mutation_create_default_sheet(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    name: &str,
    default_col_width_px: Option<f64>,
) -> Result<(String, MutationResult), ComputeError> {
    // Run the standard store-sync work; discard the slim per-mutation
    // `MutationResult` it builds — we re-emit a hydration-shape result
    // below so first-paint mirror state matches Rust exactly.
    let (hex, _slim_result) = create_sheet(stores, mirror, name, default_col_width_px)?;
    let result = super::build_mutation_result_for_hydration(stores, mirror, RecalcResult::empty());
    Ok((hex, result))
}

fn create_sheet(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    name: &str,
    default_col_width_px: Option<f64>,
) -> Result<(String, MutationResult), ComputeError> {
    use crate::storage::sheet::properties;

    // When name is empty, auto-generate a unique "SheetN" name.
    let name = if name.is_empty() {
        let order = stores.storage.sheet_order();
        properties::next_unique_sheet_name(&stores.storage, &order)
    } else {
        name.to_string()
    };

    let default_col_width = resolve_default_col_width(default_col_width_px, stores.layout_metrics)?;
    let default_col_width_cw = domain_types::units::pixels_to_char_width(
        default_col_width,
        stores.layout_metrics.column_width_mdw,
    );

    // Create sheet metadata and native values.
    let sheet_id = {
        stores.storage.create_sheet_with_width(
            mirror,
            &name,
            &stores.grid_id_alloc,
            default_col_width_cw,
        )?
    };
    crate::storage::engine::history::structure::capture_sheet(stores, mirror, sheet_id, true);
    let hex: String = id_to_hex(sheet_id.as_u128()).into();

    // Initialize the shared row and column identities.
    let snap_for_grid = crate::snapshot::SheetSnapshot {
        identities: Vec::new(),
        row_axis: None,
        col_axis: None,
        id: sheet_id.to_uuid_string(),
        name: name.to_string(),
        rows: 100,
        cols: 26,
        cells: vec![],
        ranges: vec![],
    };
    let grid = super::super::super::build_grid_from_native_sheet(
        mirror,
        sheet_id,
        &snap_for_grid,
        stores.grid_id_alloc.clone(),
    )?;
    let row_axis = grid.row_axis();
    let col_axis = grid.col_axis();
    stores.grid_indexes.insert(sheet_id, grid);

    // 3b. Create empty merge spatial index
    stores
        .merge_indexes
        .insert(sheet_id, RangeSpatialIndex::with_items(vec![]));

    // 3c. Create LayoutIndex (all defaults)
    stores.layout_indexes.insert(
        sheet_id,
        compute_layout_index::LayoutIndex::with_defaults(
            100,
            26,
            stores.layout_metrics.default_row_height(),
            default_col_width,
        ),
    );

    // 4. Add to ComputeCore via add_sheet with empty snapshot
    let snap = crate::snapshot::SheetSnapshot {
        identities: Vec::new(),
        row_axis: Some(row_axis.store().clone()),
        col_axis: Some(col_axis.store().clone()),
        id: sheet_id.to_uuid_string(),
        name: name.to_string(),
        rows: 100,
        cols: 26,
        cells: vec![],
        ranges: vec![],
    };
    stores.compute.add_sheet(mirror, snap)?;
    mirror.install_sheet_axes(sheet_id, row_axis, col_axis);

    // Build MutationResult via the canonical hydration helper. The helper
    // emits the `SheetChange { field: Sheet, kind: Set }` creation event
    // itself plus every per-sheet mirror dimension (settings, print
    // settings, scroll position, etc.) — closing the eight-of-nine
    // `mirror-matches-rust` dimensions that the slim shape used to leave
    // uninitialized for the new sheet.
    let mut result = MutationResult::empty();
    super::result_building::build_sheet_hydration_changes(
        stores,
        mirror,
        &sheet_id,
        None,
        &mut result,
    );
    result.sheet_lifecycle_runtime_hint = Some(SheetLifecycleRuntimeHint::focus(sheet_id));
    Ok((hex, result))
}

fn resolve_default_col_width(
    default_col_width_px: Option<f64>,
    layout_metrics: domain_types::units::LayoutMetrics,
) -> Result<Pixels, ComputeError> {
    match default_col_width_px {
        Some(width) if width.is_finite() && width > 0.0 => Ok(Pixels(width)),
        Some(width) => Err(ComputeError::InvalidInput {
            message: format!("Invalid default column width: {width}"),
        }),
        None => Ok(layout_metrics.default_column_width()),
    }
}

// ---------------------------------------------------------------------------
// mutation_delete_sheet
// ---------------------------------------------------------------------------

/// Delete a sheet with full store synchronization.
pub(in crate::storage::engine) fn mutation_delete_sheet(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
) -> Result<(MutationResult, RecalcResult), ComputeError> {
    // Validate: cannot delete last sheet
    let order = stores.storage.sheet_order();
    if order.len() <= 1 {
        return Err(ComputeError::Eval {
            message: "Cannot delete the last sheet".to_string(),
        });
    }
    if !order.contains(sheet_id) {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    }

    crate::storage::engine::history::structure::capture_sheet(stores, mirror, *sheet_id, false);
    let name = crate::storage::sheet::properties::get_sheet_name(&stores.storage, sheet_id);
    let sheet_id_str = sheet_id.to_uuid_string();

    crate::storage::workbook::imported_pivots::mark_output_sheet_deleted(
        &mut stores.storage,
        sheet_id,
    );
    crate::storage::workbook::imported_pivots::mark_source_sheet_deleted(
        &mut stores.storage,
        sheet_id,
    );

    let table_names: Vec<_> = mirror
        .all_tables()
        .iter()
        .rev()
        .filter(|table| table.sheet_id == sheet_id_str)
        .map(|table| table.name.clone())
        .collect();
    for name in table_names {
        stores.compute.remove_table(mirror, &name);
    }
    mirror.remove_pivot_table_defs_for_sheet(&sheet_id_str);
    mirror.remove_data_table_regions_for_sheet(&sheet_id_str);

    // Remove native OOXML payloads while their owning identities still resolve.
    let metadata_cells: Vec<_> = stores
        .storage
        .cell_metadata
        .keys()
        .copied()
        .filter(|id| {
            mirror.sheet_for_cell(id) == Some(*sheet_id)
                || stores
                    .grid_indexes
                    .get(sheet_id)
                    .is_some_and(|grid| grid.cell_position(id).is_some())
        })
        .collect();
    for id in metadata_cells {
        stores.storage.cell_metadata.remove(&id);
    }

    // 1. Remove from ComputeCore first — needs mirror data to find external dependents.
    //    This also calls mirror.remove_sheet internally.
    let recalc = stores.compute.remove_sheet(mirror, sheet_id)?;

    // 2. Remove native metadata (values were cleared by compute.remove_sheet)
    stores.storage.remove_sheet(mirror, sheet_id);

    // 3. Remove GridIndex, merge spatial index, and layout index
    stores.grid_indexes.remove(sheet_id);
    stores.merge_indexes.remove(sheet_id);
    stores.layout_indexes.remove(sheet_id);

    let mut result = MutationResult::empty();
    result.sheet_changes.push(SheetChange {
        sheet_id: sheet_id_str,
        kind: ChangeKind::Removed,
        field: SheetChangeField::Sheet,
        name,
        old_name: None,
        index: None,
        old_index: None,
        hidden: None,
        source_sheet_id: None,
        frozen_rows: None,
        old_frozen_rows: None,
        frozen_cols: None,
        old_frozen_cols: None,
        color: None,
        old_color: None,
    });
    result.sheet_lifecycle_runtime_hint = Some(SheetLifecycleRuntimeHint::reconcile());
    Ok((result, recalc))
}

// ---------------------------------------------------------------------------
// mutation_rename_sheet
// ---------------------------------------------------------------------------

/// Rename a sheet with full store synchronization.
pub(in crate::storage::engine) fn mutation_rename_sheet(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    name: &str,
) -> Result<MutationResult, ComputeError> {
    // 0. Capture old name for formula update
    let old_name = crate::storage::sheet::properties::get_sheet_name(&stores.storage, sheet_id);

    crate::storage::sheet::properties::rename_sheet(&mut stores.storage, sheet_id, name);
    // 2. Rename in ComputeCore, which updates the mirror and authored formula text.
    stores.compute.rename_sheet(mirror, sheet_id, name);
    crate::storage::workbook::imported_pivots::update_output_sheet_name_for_sheet(
        &mut stores.storage,
        sheet_id,
        name,
    );
    crate::storage::workbook::imported_pivots::update_source_sheet_name_for_sheet(
        &mut stores.storage,
        sheet_id,
        name,
    );

    let mut result = MutationResult::empty();
    result.sheet_changes.push(SheetChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        field: SheetChangeField::Name,
        name: Some(name.to_string()),
        old_name,
        index: None,
        old_index: None,
        hidden: None,
        source_sheet_id: None,
        frozen_rows: None,
        old_frozen_rows: None,
        frozen_cols: None,
        old_frozen_cols: None,
        color: None,
        old_color: None,
    });
    Ok(result)
}

// ---------------------------------------------------------------------------
// mutation_copy_sheet
// ---------------------------------------------------------------------------

/// Copy a sheet with full store synchronization.
pub(in crate::storage::engine) fn mutation_copy_sheet(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    source_sheet_id: &SheetId,
    new_name: &str,
) -> Result<(String, MutationResult), ComputeError> {
    use crate::identity::GridIndex;
    use crate::storage::engine::construction;

    let formulas_by_pos: std::collections::HashMap<_, _> = mirror
        .get_sheet(source_sheet_id)
        .into_iter()
        .flat_map(|sheet| {
            sheet.cells_iter().filter_map(|(id, _)| {
                let pos = sheet.position_of(id)?;
                let text = crate::storage::engine::formula_read::formula_text_for_cell_id(
                    stores,
                    mirror,
                    source_sheet_id,
                    id,
                )?;
                Some((pos, text))
            })
        })
        .collect();

    // Preserve sparse identities used only by formatting, merges, or comments.
    if let Some(grid) = stores.grid_indexes.get(source_sheet_id) {
        mirror.install_sheet_axes(*source_sheet_id, grid.row_axis(), grid.col_axis());
        for (id, row, col) in grid.cells() {
            mirror.register_identity_position(
                *source_sheet_id,
                cell_types::SheetPos::new(row, col),
                id,
            );
        }
    }

    // Copy the native values and their identity indexes together.
    let new_id = {
        stores
            .storage
            .copy_sheet(mirror, source_sheet_id, new_name, &stores.grid_id_alloc)?
    };
    crate::storage::engine::history::structure::capture_sheet(stores, mirror, new_id, true);
    let hex: String = id_to_hex(new_id.as_u128()).into();

    let sheet = mirror
        .get_sheet(&new_id)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: hex.clone(),
        })?;
    let (rows, cols) = (sheet.grid_rows, sheet.grid_cols);
    let mut new_grid = GridIndex::from_shared_axes(
        new_id,
        sheet.row_axis.clone(),
        sheet.col_axis.clone(),
        stores.grid_id_alloc.clone(),
    );
    for (id, pos) in &sheet.id_to_pos {
        new_grid.register_cell(*id, pos.row(), pos.col());
    }
    let mut formula_cells: Vec<_> = formulas_by_pos
        .into_iter()
        .filter_map(|(pos, text)| sheet.cell_id_at(pos).map(|id| (id, text)))
        .collect();
    stores.grid_indexes.insert(new_id, new_grid);

    // 3b. Build merge spatial index for the new sheet, and sync into mirror.
    super::super::mutation::rebuild_merge_index(stores, &new_id);
    super::super::mutation::sync_mirror_merge_regions(stores, mirror, &new_id);

    // 3c. Build LayoutIndex
    let li = construction::build_layout_index_for_sheet(
        &stores.storage,
        &new_id,
        rows,
        cols,
        stores.grid_indexes.get(&new_id),
        stores.layout_metrics,
    );
    stores.layout_indexes.insert(new_id, li);

    super::super::tables::copy_sheet_tables(
        stores,
        mirror,
        source_sheet_id,
        &new_id,
        &mut formula_cells,
    )?;
    stores
        .compute
        .register_sheet_formulas(mirror, new_id, formula_cells);
    super::super::objects::refresh_copied_cell_annotations(stores, mirror, &new_id)?;

    // Build MutationResult via the canonical hydration helper, threading
    // `source_sheet_id = Some(source)` so the creation event carries copy
    // provenance. The helper also emits tables / comments / filters /
    // floating objects / conditional formats / sparklines / pivots /
    // grouping / page breaks / print area+titles+settings / split config /
    // scroll position for the deep-cloned copy — the slim shape used to
    // emit zero of these even though `copy_sheet` copies their native metadata.
    // Keep this list aligned with every sheet-introduction path.
    let mut result = MutationResult::empty();
    super::result_building::build_sheet_hydration_changes(
        stores,
        mirror,
        &new_id,
        Some(source_sheet_id),
        &mut result,
    );
    result.sheet_lifecycle_runtime_hint = Some(SheetLifecycleRuntimeHint::focus(new_id));
    Ok((hex, result))
}
