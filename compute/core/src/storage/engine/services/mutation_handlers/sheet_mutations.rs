use cell_types::SheetId;
use value_types::ComputeError;
use yrs::{Origin, Transact};

use crate::mirror::CellMirror;
use crate::range_manager::RangeSpatialIndex;
use crate::snapshot::{
    ChangeKind, MutationResult, RecalcResult, SheetChange, SheetChangeField,
    SheetLifecycleRuntimeHint,
};
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;
use compute_document::hex::id_to_hex;
use compute_document::undo::{ORIGIN_BOOTSTRAP, ORIGIN_USER_EDIT};
use domain_types::units::Pixels;

// ---------------------------------------------------------------------------
// mutation_create_sheet
// ---------------------------------------------------------------------------

/// Create a new sheet with full store synchronization.
pub(in crate::storage::engine) fn mutation_create_sheet(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    name: &str,
    default_col_width_px: Option<f64>,
) -> Result<(String, MutationResult), ComputeError> {
    create_sheet_with_origin(
        stores,
        mirror,
        mutation,
        name,
        Origin::from(ORIGIN_USER_EDIT),
        default_col_width_px,
    )
}

/// Create the implicit default "Sheet1" used when starting a blank workbook.
///
/// Identical to [`mutation_create_sheet`] in the storage work it performs,
/// except (a) the underlying Yrs transaction carries `ORIGIN_BOOTSTRAP` so
/// it never enters the undo stack (a freshly-created workbook must report
/// `canUndo == false`; routing the bootstrap through the user-edit origin
/// would put the sheet creation on the undo stack and the user's first
/// Cmd+Z would delete the only sheet), and (b) the returned `MutationResult`
/// is hydration-shaped — the same shape `import_from_xlsx_bytes` /
/// `import_from_csv_bytes` produce — instead of the slim per-mutation
/// `SheetChange` that user-edit sheet creation emits.
///
/// Why hydration-shaped: the blank-workbook bootstrap is the *only* path
/// (besides XLSX/CSV import and IndexedDB-replay settle) that brings the
/// engine from "no doc" to "doc is open and observable." The kernel state
/// mirror is populated from `MutationResult`. Without a hydration-shape
/// result, the mirror's `settingsBySheet` and `workbookSettings` stay at
/// their TS-side defaults forever — which disagree with Rust's serde-skipped
/// wire shape (`gridlineColor` defaulted in TS but absent on the wire,
/// `chartDataPointTrack` in TS but missing from Rust entirely, etc.).
/// `mirror-matches-rust` (Guard 2) fires deterministically across every
/// fresh-blank-document scenario as a result.
///
/// Routing the bootstrap through `build_mutation_result_for_hydration`
/// unifies all init paths under one MutationResult shape and eliminates
/// the entire class of "we forgot to emit X for the bootstrap" bugs.
pub(in crate::storage::engine) fn mutation_create_default_sheet(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    name: &str,
    default_col_width_px: Option<f64>,
) -> Result<(String, MutationResult), ComputeError> {
    // Run the standard store-sync work; discard the slim per-mutation
    // `MutationResult` it builds — we re-emit a hydration-shape result
    // below so first-paint mirror state matches Rust exactly.
    let (hex, _slim_result) = create_sheet_with_origin(
        stores,
        mirror,
        mutation,
        name,
        Origin::from(ORIGIN_BOOTSTRAP),
        default_col_width_px,
    )?;
    let result = super::build_mutation_result_for_hydration(stores, mirror, RecalcResult::empty());
    Ok((hex, result))
}

fn create_sheet_with_origin(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    name: &str,
    origin: Origin,
    default_col_width_px: Option<f64>,
) -> Result<(String, MutationResult), ComputeError> {
    use crate::storage::sheet::properties;

    // When name is empty, auto-generate a unique "SheetN" name.
    let name = if name.is_empty() {
        let order = stores.storage.sheet_order();
        properties::next_unique_sheet_name(stores.storage.doc(), stores.storage.sheets(), &order)
    } else {
        name.to_string()
    };

    let default_col_width = resolve_default_col_width(default_col_width_px)?;

    // 1 + 2. Create sheet in yrs Doc and mirror
    let sheet_id = {
        let _guard = mutation.suppress_guard();
        stores.storage.create_sheet_with_origin(
            mirror,
            &name,
            &stores.grid_id_alloc,
            origin,
            default_col_width,
        )?
    };
    let hex: String = id_to_hex(sheet_id.as_u128()).into();

    // 3. Create GridIndex from YArray data (ensures RowId/ColId match the YArrays)
    let snap_for_grid = crate::snapshot::SheetSnapshot {
        id: sheet_id.to_uuid_string(),
        name: name.to_string(),
        rows: 100,
        cols: 26,
        cells: vec![],
        ranges: vec![],
    };
    let grid = super::super::super::build_grid_from_yrs_for_sheet(
        &stores.storage,
        sheet_id,
        &snap_for_grid,
        stores.grid_id_alloc.clone(),
    )?;
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
            compute_layout_index::DEFAULT_ROW_HEIGHT,
            default_col_width,
        ),
    );

    // 4. Add to ComputeCore via add_sheet with empty snapshot
    let snap = crate::snapshot::SheetSnapshot {
        id: sheet_id.to_uuid_string(),
        name: name.to_string(),
        rows: 100,
        cols: 26,
        cells: vec![],
        ranges: vec![],
    };
    stores.compute.add_sheet(mirror, snap)?;

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

fn resolve_default_col_width(default_col_width_px: Option<f64>) -> Result<Pixels, ComputeError> {
    match default_col_width_px {
        Some(width) if width.is_finite() && width > 0.0 => Ok(Pixels(width)),
        Some(width) => Err(ComputeError::InvalidInput {
            message: format!("Invalid default column width: {width}"),
        }),
        None => Ok(compute_layout_index::platform_default_col_width()),
    }
}

// ---------------------------------------------------------------------------
// mutation_delete_sheet
// ---------------------------------------------------------------------------

/// Delete a sheet with full store synchronization.
pub(in crate::storage::engine) fn mutation_delete_sheet(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
) -> Result<(MutationResult, RecalcResult), ComputeError> {
    // Validate: cannot delete last sheet
    let order = stores.storage.sheet_order();
    if order.len() <= 1 {
        return Err(ComputeError::Eval {
            message: "Cannot delete the last sheet".to_string(),
        });
    }

    let name = crate::storage::sheet::properties::get_sheet_name(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    );
    let sheet_id_str = sheet_id.to_uuid_string();

    crate::storage::workbook::imported_pivots::mark_output_sheet_deleted(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        sheet_id,
    );
    crate::storage::workbook::imported_pivots::mark_source_sheet_deleted(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        sheet_id,
    );

    // 1. Remove from ComputeCore first — needs mirror data to find external dependents.
    //    This also calls mirror.remove_sheet internally.
    let recalc = stores.compute.remove_sheet(mirror, sheet_id)?;

    // 2. Remove from yrs Doc (mirror already cleared by compute.remove_sheet)
    mutation.observer.set_suppressed(true);
    stores.storage.remove_sheet(mirror, sheet_id);
    mutation.observer.set_suppressed(false);

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
    let old_name = crate::storage::sheet::properties::get_sheet_name(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    );

    // 1. Rename sheet metadata and persisted formula text atomically so one
    // undo/redo step keeps the tab name and formulas in sync.
    if let Some(ref old) = old_name {
        let mut txn = stores
            .storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        crate::storage::sheet::properties::rename_sheet_in_txn(
            &mut txn,
            stores.storage.sheets(),
            sheet_id,
            name,
        );
        crate::storage::cells::formula_updater::update_formula_templates_on_sheet_rename_in_txn(
            &mut txn,
            stores.storage.workbook_map(),
            stores.storage.sheets(),
            old,
            name,
        );
    } else {
        crate::storage::sheet::properties::rename_sheet(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            name,
        );
    }

    // 2. Rename in ComputeCore, which updates the mirror and authored formula text.
    stores.compute.rename_sheet(mirror, sheet_id, name);
    crate::storage::workbook::imported_pivots::update_output_sheet_name_for_sheet(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        name,
    );
    crate::storage::workbook::imported_pivots::update_source_sheet_name_for_sheet(
        stores.storage.doc(),
        stores.storage.sheets(),
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
    mutation: &mut MutationCoordinator,
    source_sheet_id: &SheetId,
    new_name: &str,
) -> Result<(String, MutationResult), ComputeError> {
    use crate::identity::GridIndex;
    use crate::storage::engine::construction;

    // 1 + 2. Copy in yrs Doc and mirror (mirror gets an empty cells snapshot)
    let new_id = {
        let _guard = mutation.suppress_guard();
        stores
            .storage
            .copy_sheet(mirror, source_sheet_id, new_name, &stores.grid_id_alloc)?
    };
    let hex: String = id_to_hex(new_id.as_u128()).into();

    // 2b. Re-populate mirror from Yrs — copy_sheet creates an empty mirror entry,
    // but the cells were written to Yrs. Read them back to populate the mirror.
    if let Some(snap) = construction::build_sheet_snapshot_from_yrs(&stores.storage, &new_id)? {
        mirror.remove_sheet(&new_id);
        mirror.add_sheet(snap)?;
    }

    // 3. Build GridIndex for the new sheet
    let (rows, cols) = stores
        .grid_indexes
        .get(source_sheet_id)
        .map(|g| (g.row_count(), g.col_count()))
        .unwrap_or((100, 26));

    let mut new_grid = GridIndex::new(new_id, rows, cols, stores.grid_id_alloc.clone());

    // Register cells from mirror data for the new sheet
    if let Some(sheet) = mirror.get_sheet(&new_id) {
        for (cell_id, _entry) in sheet.cells_iter() {
            if let Some(pos) = mirror.resolve_position(cell_id) {
                new_grid.register_cell(*cell_id, pos.row(), pos.col());
            }
        }
    }
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
    );
    stores.layout_indexes.insert(new_id, li);

    // 4. Build a SheetSnapshot from yrs (not mirror/compute, which hasn't been initialized yet)
    let snap = construction::build_sheet_snapshot_from_yrs(&stores.storage, &new_id)?.ok_or_else(
        || ComputeError::SheetNotFound {
            sheet_id: hex.clone(),
        },
    )?;
    stores.compute.add_sheet(mirror, snap)?;

    // Build MutationResult via the canonical hydration helper, threading
    // `source_sheet_id = Some(source)` so the creation event carries copy
    // provenance. The helper also emits tables / comments / filters /
    // floating objects / conditional formats / sparklines / pivots /
    // grouping / page breaks / print area+titles+settings / split config /
    // scroll position for the deep-cloned copy — the slim shape used to
    // emit zero of these even though `copy_sheet` deep-clones them in Yrs.
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
