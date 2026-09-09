use super::*;

// ---------------------------------------------------------------------------
// Engine constructors and assembly
// ---------------------------------------------------------------------------

/// Create a `ComputeEngine` from a workbook snapshot.
///
/// Populates the document, builds compute state and indexes, and runs initial recalc.
pub(in crate::storage::engine) fn from_snapshot(
    snapshot: WorkbookSnapshot,
) -> Result<(ComputeEngine, RecalcResult), ComputeError> {
    from_snapshot_with_layout_metrics(snapshot, domain_types::units::LayoutMetrics::default())
}

pub(in crate::storage::engine) fn from_snapshot_with_layout_metrics(
    snapshot: WorkbookSnapshot,
    layout_metrics: domain_types::units::LayoutMetrics,
) -> Result<(ComputeEngine, RecalcResult), ComputeError> {
    let layout_metrics = validate_layout_metrics(layout_metrics)?;
    let storage = {
        let _span = tracing::info_span!("metadata_from_snapshot").entered();
        WorkbookStorage::from_snapshot(snapshot.clone())?
    };

    let (compute, recalc_result, mirror) = {
        let _span = tracing::info_span!("compute_init_from_snapshot").entered();
        let mut compute = ComputeCore::new();
        let mut mirror = super::rebuild::build_initial_mirror(&storage, &snapshot, layout_metrics)?;
        let recalc_result =
            compute.init_from_snapshot_with_prebuilt_mirror(&mut mirror, snapshot.clone())?;
        (compute, recalc_result, mirror)
    };

    let mut engine =
        assemble_engine_with_layout_metrics(storage, mirror, compute, &snapshot, layout_metrics)?;
    engine.mark_metadata_evaluated();

    Ok((engine, recalc_result))
}

pub(in crate::storage::engine) fn snapshot_id_high_water_mark(snapshot: &WorkbookSnapshot) -> u64 {
    snapshot.next_identity_counter()
}

fn validate_layout_metrics(
    metrics: domain_types::units::LayoutMetrics,
) -> Result<domain_types::units::LayoutMetrics, ComputeError> {
    metrics
        .validate()
        .ok_or_else(|| ComputeError::InvalidInput {
            message: format!("Invalid layout metrics: {metrics:?}"),
        })
}

/// Assemble a fully initialized `ComputeEngine` from pre-built components.
///
/// Builds native indexes and settings, and initializes CF caches.
/// Seeds the runtime ID allocator past any IDs already present in the snapshot,
/// preventing collisions with XLSX-imported cell/sheet identities.
pub(in crate::storage::engine) fn assemble_engine(
    storage: WorkbookStorage,
    mirror: CellMirror,
    compute: ComputeCore,
    snapshot: &WorkbookSnapshot,
) -> Result<ComputeEngine, ComputeError> {
    assemble_engine_with_layout_metrics(
        storage,
        mirror,
        compute,
        snapshot,
        domain_types::units::LayoutMetrics::default(),
    )
}

pub(in crate::storage::engine) fn assemble_engine_with_layout_metrics(
    storage: WorkbookStorage,
    mirror: CellMirror,
    mut compute: ComputeCore,
    snapshot: &WorkbookSnapshot,
    layout_metrics: domain_types::units::LayoutMetrics,
) -> Result<ComputeEngine, ComputeError> {
    let layout_metrics = validate_layout_metrics(layout_metrics)?;
    let seed = snapshot_id_high_water_mark(snapshot).max(compute.id_alloc().high_water_mark());
    let grid_id_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_seed(seed));
    grid_id_alloc.ensure_axis_run_past(cell_types::AxisRunId::from_raw(
        snapshot
            .next_axis_run_counter()
            .max(compute.id_alloc().axis_run_high_water_mark())
            .saturating_sub(1),
    ));
    // Share the same allocator with ComputeCore to prevent CellId collisions
    // between ghost cells (formula resolution) and real cells (mutation handlers).
    compute.set_id_alloc(std::sync::Arc::clone(&grid_id_alloc));
    let id_alloc = std::sync::Arc::new(crate::storage::new_runtime_metadata_id_allocator());
    assemble_engine_inner(
        storage,
        mirror,
        compute,
        snapshot,
        grid_id_alloc,
        id_alloc,
        layout_metrics,
    )
}

fn assemble_engine_inner(
    storage: WorkbookStorage,
    mut mirror: CellMirror,
    compute: ComputeCore,
    snapshot: &WorkbookSnapshot,
    grid_id_alloc: std::sync::Arc<cell_types::IdAllocator>,
    id_alloc: std::sync::Arc<cell_types::IdAllocator>,
    layout_metrics: domain_types::units::LayoutMetrics,
) -> Result<ComputeEngine, ComputeError> {
    crate::storage::engine::cell_metadata::refresh(&storage, &mut mirror, layout_metrics);
    mirror.date1904 = crate::storage::workbook::settings::get_settings(&storage.metadata).date1904;
    let grid_indexes = build_grid_indexes(&mirror, snapshot, grid_id_alloc.clone())?;
    let merge_indexes = build_merge_indexes(&storage, snapshot, &grid_indexes)?;
    let layout_indexes = build_layout_indexes(&storage, snapshot, &grid_indexes, layout_metrics)?;

    // unified reference model — seed the mirror's `RowId → (SheetId, row)` /
    // `ColId → (SheetId, col)` reverse index from the grid indexes so
    // `MirrorPositionLookup::row_index` / `col_index` can answer display
    // queries for full-row/full-col refs. Mutations that change row/col
    // identities re-seed via the same `install_row_col_indexes` entry point.
    mirror.install_native_axes(
        grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_axis(), grid.col_axis())),
    );

    let settings = derive_settings(&storage);

    let mut engine = ComputeEngine {
        mirror,
        stores: EngineStores {
            storage,
            grid_id_alloc,
            id_alloc,
            layout_metrics,
            grid_indexes,
            layout_indexes,
            merge_indexes,
            compute,
            cf_cache: FxHashMap::default(),
            font_db: compute_text_measurement::FontDb::with_defaults(),
            measurement_cache: compute_text_measurement::MeasurementCache::new(),
        },
        mutation: MutationCoordinator {
            pending_recalc: None,
            pending_format_patches: None,
        },
        history: Default::default(),
        viewport: ViewportService::new(),
        settings,
        import_report: domain_types::ImportReport::default(),
        runtime_diagnostics: Default::default(),
        version_runtime_operation_context: Default::default(),

        scenario_session: crate::what_if::scenarios::ScenarioSessionState::default(),
        deferred_hydration: None,
    };

    crate::storage::engine::services::imported_filters::normalize_imported_auto_filter_visibility(
        &mut engine.stores,
        &mut engine.mirror,
        None,
        domain_types::ImportPhase::FullHydration,
    );
    engine.init_cf_caches();
    normalize_named_range_refs(&mut engine);
    sync_enable_calculation_flags(&mut engine);

    Ok(engine)
}

/// Sync per-sheet `enable_calculation` flags from native metadata into the
/// `CellMirror`'s `SheetMirror` structs. This ensures the scheduler respects
pub(in crate::storage::engine) fn rebuild_engine_from_snapshot(
    engine: &mut ComputeEngine,
    new_storage: WorkbookStorage,
    workbook_snap: WorkbookSnapshot,
    do_recalc: bool,
) -> Result<RecalcResult, ComputeError> {
    let char_code_page = engine.mirror.char_code_page;
    engine.stores.storage = new_storage;

    // CellMirror is built inside init_from_snapshot / init_from_snapshot_minimal.
    // Don't build it separately to avoid the double-build overhead.
    // Rebuild ComputeCore (also rebuilds CellMirror)
    let recalc_result = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "mirror_compute_rebuild");
        engine.stores.compute = ComputeCore::new();
        let date1904 = workbook_settings::get_settings(&engine.stores.storage.metadata).date1904;
        let recalc_result = if do_recalc {
            engine.mirror = super::rebuild::build_initial_mirror(
                &engine.stores.storage,
                &workbook_snap,
                engine.stores.layout_metrics,
            )?;
            engine.mirror.char_code_page = char_code_page;
            engine.mirror.date1904 = date1904;
            engine
                .stores
                .compute
                .init_from_snapshot_with_prebuilt_mirror(
                    &mut engine.mirror,
                    workbook_snap.clone(),
                )?
        } else {
            #[cfg(target_arch = "wasm32")]
            {
                engine
                    .stores
                    .compute
                    .init_from_snapshot_minimal(&mut engine.mirror, workbook_snap.clone())?
            }
            #[cfg(not(target_arch = "wasm32"))]
            {
                engine
                    .stores
                    .compute
                    .init_from_snapshot_no_recalc(&mut engine.mirror, workbook_snap.clone())?
            }
        };
        // The no-recalc/minimal branches replace the mirror inside the
        // scheduler initializer. Reapply the runtime-only calculation option
        // after either branch; the recalc branch also set it before parsing.
        engine.mirror.char_code_page = char_code_page;
        engine.mirror.date1904 = date1904;
        engine.mirror.install_cell_metadata_provider(
            crate::storage::engine::cell_metadata::provider(
                &engine.stores.storage,
                engine.stores.layout_metrics,
            ),
        );
        profile.counter("sheets", workbook_snap.sheets.len() as u64);
        profile.counter(
            "snapshot_cells",
            workbook_snap
                .sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        recalc_result
    };

    // Re-seed the ID allocator past any IDs in the new snapshot to avoid
    // collisions between newly allocated IDs and existing XLSX-imported ones.
    // Share a single allocator between grid_id_alloc and ComputeCore to prevent
    // CellId collisions between ghost cells and real cells.
    let seed = snapshot_id_high_water_mark(&workbook_snap)
        .max(engine.stores.compute.id_alloc().high_water_mark());
    let shared_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_seed(seed));
    shared_alloc.ensure_axis_run_past(cell_types::AxisRunId::from_raw(
        workbook_snap
            .next_axis_run_counter()
            .max(engine.stores.compute.id_alloc().axis_run_high_water_mark())
            .saturating_sub(1),
    ));
    engine.stores.grid_id_alloc = std::sync::Arc::clone(&shared_alloc);
    engine.stores.compute.set_id_alloc(shared_alloc);
    engine.stores.id_alloc =
        std::sync::Arc::new(crate::storage::new_runtime_metadata_id_allocator());

    // Rebuild indexes
    engine.stores.grid_indexes = build_grid_indexes(
        &engine.mirror,
        &workbook_snap,
        engine.stores.grid_id_alloc.clone(),
    )?;
    engine.stores.merge_indexes = build_merge_indexes(
        &engine.stores.storage,
        &workbook_snap,
        &engine.stores.grid_indexes,
    )?;
    engine.stores.layout_indexes = build_layout_indexes(
        &engine.stores.storage,
        &workbook_snap,
        &engine.stores.grid_indexes,
        engine.stores.layout_metrics,
    )?;

    // unified reference model — re-seed mirror's row/col reverse index after the rebuild.
    engine.mirror.install_native_axes(
        engine
            .stores
            .grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_axis(), grid.col_axis())),
    );

    // Derive settings and clear the old viewport.

    engine.settings = derive_settings(&engine.stores.storage);
    engine.viewport.clear();

    // Pre-populate CF caches
    engine.init_cf_caches();

    // Normalize named-range references into their canonical format.
    normalize_named_range_refs(engine);
    if do_recalc {
        engine.mark_metadata_evaluated();
    }

    Ok(recalc_result)
}
