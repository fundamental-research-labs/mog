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

    let (compute, recalc_result, cell_store) = {
        let _span = tracing::info_span!("compute_init_from_snapshot").entered();
        let mut compute = ComputeCore::new();
        let mut cell_store = CellStore::new();
        let recalc_result = compute.init_from_snapshot(&mut cell_store, snapshot.clone())?;
        (compute, recalc_result, cell_store)
    };

    let engine = assemble_engine_with_layout_metrics(
        storage,
        cell_store,
        compute,
        &snapshot,
        layout_metrics,
    )?;

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
    cell_store: CellStore,
    compute: ComputeCore,
    snapshot: &WorkbookSnapshot,
) -> Result<ComputeEngine, ComputeError> {
    assemble_engine_with_layout_metrics(
        storage,
        cell_store,
        compute,
        snapshot,
        domain_types::units::LayoutMetrics::default(),
    )
}

pub(in crate::storage::engine) fn assemble_engine_with_layout_metrics(
    storage: WorkbookStorage,
    mut cell_store: CellStore,
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
    cell_store.set_id_alloc(std::sync::Arc::clone(&grid_id_alloc));
    let id_alloc = std::sync::Arc::new(crate::storage::new_runtime_metadata_id_allocator());
    assemble_engine_inner(
        storage,
        cell_store,
        compute,
        snapshot,
        grid_id_alloc,
        id_alloc,
        layout_metrics,
    )
}

fn assemble_engine_inner(
    storage: WorkbookStorage,
    mut cell_store: CellStore,
    compute: ComputeCore,
    snapshot: &WorkbookSnapshot,
    grid_id_alloc: std::sync::Arc<cell_types::IdAllocator>,
    id_alloc: std::sync::Arc<cell_types::IdAllocator>,
    layout_metrics: domain_types::units::LayoutMetrics,
) -> Result<ComputeEngine, ComputeError> {
    let grid_indexes = build_grid_indexes(&cell_store, snapshot, grid_id_alloc.clone())?;
    let merge_indexes = build_merge_indexes(&storage, snapshot, &cell_store)?;

    // Share compact axes and register run ownership for cross-sheet references.
    cell_store.install_native_axes(
        grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_axis(), grid.col_axis())),
    );

    let settings = derive_settings(&storage);

    // Native policy changes and API events share one event buffer.
    let security_events = std::sync::Arc::new(
        crate::storage::engine::security_events::SecurityEventBuffer::default(),
    );
    let security = crate::storage::security_state::SecurityState::with_event_buffer(
        std::sync::Arc::clone(&security_events),
    );

    let mut engine = ComputeEngine {
        cell_store,
        stores: EngineStores {
            storage,
            grid_id_alloc,
            id_alloc,
            layout_metrics,
            grid_indexes,
            pixel_layouts: Default::default(),
            merge_indexes,
            compute,
            cf_cache: FxHashMap::default(),
            font_db: Default::default(),
            measurement_cache: compute_text_measurement::MeasurementCache::new(),
        },
        history: Default::default(),
        viewport: ViewportService::new(),
        settings,
        security,
        security_events,
        import_report: domain_types::ImportReport::default(),
        runtime_diagnostics: Default::default(),
        version_runtime_operation_context: Default::default(),

        scenario_session: crate::what_if::scenarios::ScenarioSessionState::default(),
        deferred_hydration: None,
    };

    crate::storage::engine::services::imported_filters::normalize_imported_auto_filter_visibility(
        &mut engine.stores,
        &mut engine.cell_store,
        None,
        domain_types::ImportPhase::FullHydration,
    );
    engine.init_cf_caches();
    normalize_named_range_refs(&mut engine);
    sync_enable_calculation_flags(&mut engine);

    Ok(engine)
}

/// Sync per-sheet `enable_calculation` flags from native metadata into the
/// `CellStore`'s `SheetStore` structs. This ensures the scheduler respects
pub(in crate::storage::engine) fn rebuild_engine_from_snapshot(
    engine: &mut ComputeEngine,
    new_storage: WorkbookStorage,
    workbook_snap: WorkbookSnapshot,
    do_recalc: bool,
) -> Result<RecalcResult, ComputeError> {
    engine.stores.storage = new_storage;

    // CellStore is built inside init_from_snapshot / init_from_snapshot_minimal.
    // Don't build it separately to avoid the double-build overhead.
    // Rebuild ComputeCore (also rebuilds CellStore)
    let recalc_result = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "store_compute_rebuild");
        engine.stores.compute = ComputeCore::new();
        let recalc_result = if do_recalc {
            engine
                .stores
                .compute
                .init_from_snapshot(&mut engine.cell_store, workbook_snap.clone())?
        } else {
            #[cfg(target_arch = "wasm32")]
            {
                engine
                    .stores
                    .compute
                    .init_from_snapshot_minimal(&mut engine.cell_store, workbook_snap.clone())?
            }
            #[cfg(not(target_arch = "wasm32"))]
            {
                engine
                    .stores
                    .compute
                    .init_from_snapshot_no_recalc(&mut engine.cell_store, workbook_snap.clone())?
            }
        };
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
    engine.cell_store.set_id_alloc(shared_alloc.clone());
    engine.stores.compute.set_id_alloc(shared_alloc);
    engine.stores.id_alloc =
        std::sync::Arc::new(crate::storage::new_runtime_metadata_id_allocator());

    // Rebuild indexes
    engine.stores.grid_indexes = build_grid_indexes(
        &engine.cell_store,
        &workbook_snap,
        engine.stores.grid_id_alloc.clone(),
    )?;
    engine.stores.merge_indexes =
        build_merge_indexes(&engine.stores.storage, &workbook_snap, &engine.cell_store)?;
    engine.stores.pixel_layouts = Default::default();

    // Share rebuilt axes and refresh compact run ownership.
    engine.cell_store.install_native_axes(
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

    Ok(recalc_result)
}
