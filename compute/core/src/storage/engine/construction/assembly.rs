use super::*;

// ---------------------------------------------------------------------------
// Engine constructors and assembly
// ---------------------------------------------------------------------------

/// Create a `YrsComputeEngine` from a workbook snapshot.
///
/// Populates the yrs document, builds ComputeCore, GridIndexes, observer,
/// undo manager, and runs initial recalc.
pub(in crate::storage::engine) fn from_snapshot(
    snapshot: WorkbookSnapshot,
) -> Result<(YrsComputeEngine, RecalcResult), ComputeError> {
    let storage = {
        let _span = tracing::info_span!("yrs_storage_from_snapshot").entered();
        YrsStorage::from_snapshot(snapshot.clone())?
    };

    let (compute, recalc_result, mirror) = {
        let _span = tracing::info_span!("compute_init_from_snapshot").entered();
        let mut compute = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let recalc_result = compute.init_from_snapshot(&mut mirror, snapshot.clone())?;
        (compute, recalc_result, mirror)
    };

    let engine = assemble_engine(storage, mirror, compute, &snapshot)?;

    Ok((engine, recalc_result))
}

/// Create a `YrsComputeEngine` from raw Yrs state bytes.
///
/// Used for collaboration: the first engine pushes its Yrs state to the
/// coordinator, and subsequent engines are created from those bytes.
/// This ensures all engines share the same CellIds and Yrs document
/// history, which is required for CRDT sync to work correctly.
pub(in crate::storage::engine) fn from_yrs_state(
    state: &[u8],
) -> Result<(YrsComputeEngine, RecalcResult), ComputeError> {
    let storage = YrsStorage::from_yrs_state(state).map_err(|e| ComputeError::Eval {
        message: format!("from_yrs_state: {e}"),
    })?;

    // Guard: reject documents whose schema version is newer than this binary.
    {
        let txn = storage.doc().transact();
        compute_document::schema::guard_schema_version(&txn, storage.workbook_map())?;
    }

    // Use the Doc's unique client_id to partition the ID space.
    // Each collaborative engine gets a non-overlapping region of the u128 space:
    //   IDs = (client_id << 64) | counter
    // This prevents CellId collisions between engines that fork from the same state.
    let client_id = storage.doc().client_id();
    let collab_alloc =
        std::sync::Arc::new(cell_types::IdAllocator::with_client_partition(client_id));

    let snapshot = build_workbook_snapshot_from_yrs(&storage)?;

    let (compute, _initial_recalc_result, mirror) = {
        let mut compute = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let recalc_result = compute.init_from_snapshot(&mut mirror, snapshot.clone())?;
        // Override ComputeCore's allocator AFTER init_from_snapshot (which
        // unconditionally reseeds). Share the SAME Arc as grid_id_alloc to
        // prevent CellId collisions between ghost cells (allocated by
        // ComputeCore during formula resolution) and real cells (allocated
        // by mutation handlers via grid_id_alloc).
        compute.set_id_alloc(std::sync::Arc::clone(&collab_alloc));
        (compute, recalc_result, mirror)
    };

    let mut engine = assemble_engine_with_alloc(
        storage,
        mirror,
        compute,
        &snapshot,
        collab_alloc.clone(),
        collab_alloc,
    )?;

    // `assemble_engine_with_alloc` normalizes any legacy/import-era raw-A1
    // defined-name refs in Yrs to canonical IdentityFormula JSON. The initial
    // snapshot above was built before that normalization, so replaying an XLSX
    // import whose persisted names were still raw A1 would omit those names
    // from ComputeCore and recalculate dependent formulas to #REF!. Rebuild
    // once from the now-normalized Yrs state so provider replay observes the
    // same named-range semantics as first-load XLSX import.
    let recalc_result = engine.rebuild_compute_core()?;

    Ok((engine, recalc_result))
}

pub(in crate::storage::engine) fn snapshot_id_high_water_mark(snapshot: &WorkbookSnapshot) -> u64 {
    let mut max_id: u128 = 0;
    for sheet in &snapshot.sheets {
        if let Ok(sid) = cell_types::SheetId::from_uuid_str(&sheet.id) {
            max_id = max_id.max(sid.as_u128());
        }
        for cell in &sheet.cells {
            if let Ok(cid) = cell_types::CellId::from_uuid_str(&cell.cell_id) {
                max_id = max_id.max(cid.as_u128());
            }
        }
    }
    // The allocator's next_u128() returns the counter THEN increments, so we
    // need to seed with max + 1 to avoid reusing the max ID itself.
    // Also add headroom for row/col IDs that were allocated during hydration
    // but aren't stored in the snapshot (they live only in the yrs grid index).
    // A generous margin (+ 100_000) covers workbooks up to ~100K rows/cols of
    // interleaved row/col ID allocations.
    let seed = (max_id as u64).saturating_add(100_000);
    // Ensure seed is at least 1 (IdAllocator expects starting value >= 1).
    seed.max(1)
}

/// Assemble a fully initialized `YrsComputeEngine` from pre-built components.
///
/// Builds indexes, observer, undo manager, settings, and initializes CF caches.
/// Seeds the runtime ID allocator past any IDs already present in the snapshot,
/// preventing collisions with XLSX-imported cell/sheet identities.
pub(in crate::storage::engine) fn assemble_engine(
    storage: YrsStorage,
    mirror: CellMirror,
    mut compute: ComputeCore,
    snapshot: &WorkbookSnapshot,
) -> Result<YrsComputeEngine, ComputeError> {
    let seed = snapshot_id_high_water_mark(snapshot);
    let grid_id_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_seed(seed));
    // Share the same allocator with ComputeCore to prevent CellId collisions
    // between ghost cells (formula resolution) and real cells (mutation handlers).
    compute.set_id_alloc(std::sync::Arc::clone(&grid_id_alloc));
    let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_client_partition(
        storage.doc().client_id(),
    ));
    assemble_engine_inner(storage, mirror, compute, snapshot, grid_id_alloc, id_alloc)
}

/// Like `assemble_engine` but with custom ID allocators (for collaborative mode).
pub(in crate::storage::engine) fn assemble_engine_with_alloc(
    storage: YrsStorage,
    mirror: CellMirror,
    compute: ComputeCore,
    snapshot: &WorkbookSnapshot,
    grid_id_alloc: std::sync::Arc<cell_types::IdAllocator>,
    id_alloc: std::sync::Arc<cell_types::IdAllocator>,
) -> Result<YrsComputeEngine, ComputeError> {
    assemble_engine_inner(storage, mirror, compute, snapshot, grid_id_alloc, id_alloc)
}

fn assemble_engine_inner(
    storage: YrsStorage,
    mut mirror: CellMirror,
    compute: ComputeCore,
    snapshot: &WorkbookSnapshot,
    grid_id_alloc: std::sync::Arc<cell_types::IdAllocator>,
    id_alloc: std::sync::Arc<cell_types::IdAllocator>,
) -> Result<YrsComputeEngine, ComputeError> {
    let grid_indexes = build_grid_indexes_from_yrs(&storage, snapshot, grid_id_alloc.clone())?;
    let merge_indexes = build_merge_indexes(&storage, snapshot, &grid_indexes)?;
    let layout_indexes = build_layout_indexes(&storage, snapshot, &grid_indexes)?;

    // unified reference model — seed the mirror's `RowId → (SheetId, row)` /
    // `ColId → (SheetId, col)` reverse index from the grid indexes so
    // `MirrorPositionLookup::row_index` / `col_index` can answer display
    // queries for full-row/full-col refs. Mutations that change row/col
    // identities re-seed via the same `install_row_col_indexes` entry point.
    mirror.install_row_col_indexes(
        grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_ids_ordered(), grid.col_ids_ordered())),
    );
    hydrate_mirror_format_ranges(&storage, &mut mirror);
    mirror.finalize_range_hydration();

    let (observer, undo_manager) = create_observer_and_undo(&storage);
    let settings = derive_settings(&storage);

    // Seed `SecurityState` from the current doc before returning —
    // R2.3 "seed on load" invariant. `SecurityState::new` reads the
    // security map and flips `active` to match the snapshot; a
    // freshly-loaded snapshot containing policies is active from the
    // first call, without waiting for the observer to fire on a
    // transition that never happens.
    //
    // The `SecurityEventBuffer` is allocated here so the engine and
    // `SecurityState` both carry a clone — the observer pushes
    // `PoliciesReloaded` through the `SecurityState` clone, while
    // `security_ops` emits per-CRUD events through the engine clone.
    // Both write into the same ring buffer (R2.3 step 5).
    let security_events = std::sync::Arc::new(
        crate::storage::engine::security_events::SecurityEventBuffer::default(),
    );
    let security = crate::storage::security_state::SecurityState::with_event_buffer(
        storage.doc(),
        std::sync::Arc::clone(&security_events),
    );

    // Install the update_v1 observer for Provider-protocol fan-out.
    // The subscription handle's lifetime is tied to the engine via the
    // `_update_subscription` field so the observer stays attached for
    // the engine's lifetime (plan §3.1: "engine-side observer stays
    // installed for the doc's lifetime").
    let update_buffer =
        std::sync::Arc::new(crate::storage::engine::update_buffer::UpdateBuffer::default());
    let update_subscription =
        crate::storage::engine::update_buffer::install_observer(storage.doc(), &update_buffer);

    let mut engine = YrsComputeEngine {
        mirror,
        stores: EngineStores {
            storage,
            grid_id_alloc,
            id_alloc,
            grid_indexes,
            layout_indexes,
            merge_indexes,
            compute,
            cf_cache: FxHashMap::default(),
            font_db: compute_text_measurement::FontDb::with_defaults(),
            measurement_cache: compute_text_measurement::MeasurementCache::new(),
            custom_table_styles: FxHashMap::default(),
            custom_cell_styles: FxHashMap::default(),
        },
        mutation: MutationCoordinator {
            observer,
            undo_manager,
            pending_recalc: None,
            pending_format_patches: None,
            sheet_lifecycle_history: Default::default(),
        },
        viewport: ViewportService::new(),
        settings,
        security,
        security_events,
        update_buffer,
        _update_subscription: update_subscription,
        scenario_session: crate::what_if::scenarios::ScenarioSessionState::default(),
        deferred_hydration: None,
    };

    load_custom_cell_styles(&mut engine.stores);
    load_custom_table_styles(&mut engine.stores);
    engine.init_cf_caches();
    normalize_named_range_refs(&mut engine);
    sync_enable_calculation_flags(&mut engine);

    Ok(engine)
}

/// Sync per-sheet `enable_calculation` flags from the Yrs document into the
/// `CellMirror`'s `SheetMirror` structs. This ensures the scheduler respects
pub(in crate::storage::engine) fn rebuild_engine_from_snapshot(
    engine: &mut YrsComputeEngine,
    new_storage: YrsStorage,
    workbook_snap: WorkbookSnapshot,
    do_recalc: bool,
) -> Result<RecalcResult, ComputeError> {
    engine.stores.storage = new_storage;
    // The update_v1 observer was installed on the old doc at engine construction
    // time. Replacing storage above discards that doc; reinstall the observer on
    // the new doc so cell edits continue to feed update_buffer (and from there,
    // the IndexedDB provider via drainPendingUpdates).
    engine._update_subscription = crate::storage::engine::update_buffer::install_observer(
        engine.stores.storage.doc(),
        &engine.update_buffer,
    );
    // CellMirror is built inside init_from_snapshot / init_from_snapshot_minimal.
    // Don't build it separately to avoid the double-build overhead.
    // Rebuild ComputeCore (also rebuilds CellMirror)
    let recalc_result = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "mirror_compute_rebuild");
        engine.stores.compute = ComputeCore::new();
        let recalc_result = if do_recalc {
            engine
                .stores
                .compute
                .init_from_snapshot(&mut engine.mirror, workbook_snap.clone())?
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
    let seed = snapshot_id_high_water_mark(&workbook_snap);
    let shared_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_seed(seed));
    engine.stores.grid_id_alloc = std::sync::Arc::clone(&shared_alloc);
    engine.stores.compute.set_id_alloc(shared_alloc);
    engine.stores.id_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_client_partition(
        engine.stores.storage.doc().client_id(),
    ));

    // Rebuild indexes
    engine.stores.grid_indexes = build_grid_indexes_from_yrs(
        &engine.stores.storage,
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
    )?;

    // unified reference model — re-seed mirror's row/col reverse index after the rebuild.
    engine.mirror.install_row_col_indexes(
        engine
            .stores
            .grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_ids_ordered(), grid.col_ids_ordered())),
    );
    hydrate_mirror_format_ranges(&engine.stores.storage, &mut engine.mirror);
    engine.mirror.finalize_range_hydration();

    // Recreate observer + undo, derive settings, clear viewport
    let (observer, undo_manager) = create_observer_and_undo(&engine.stores.storage);
    engine.mutation.observer = observer;
    engine.mutation.undo_manager = undo_manager;
    engine.settings = derive_settings(&engine.stores.storage);
    engine.viewport.clear();

    // Pre-populate CF caches
    engine.init_cf_caches();

    // Normalize named-range refs so Yrs has a single canonical format.
    normalize_named_range_refs(engine);

    Ok(recalc_result)
}
