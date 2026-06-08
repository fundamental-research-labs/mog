use super::*;

pub(in crate::storage::engine) fn import_from_xlsx_bytes_deferred(
    engine: &mut YrsComputeEngine,
    xlsx_data: &[u8],
) -> Result<RecalcResult, ComputeError> {
    use crate::import;
    use crate::storage::infra::hydration::{DefaultIdAllocator, allocate_sheet_ids};

    // Pass 1: Parse XLSX — only the initial active visible sheet's cells
    // (ZIP decompress + XML parse). Remaining sheets get metadata only. Full
    // parse happens in complete_deferred_hydration.
    let parsed = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import_deferred", "parse");
        let parsed = xlsx_api::parse_initial_active_visible_sheet(xlsx_data).map_err(|e| {
            ComputeError::Deserialize {
                message: format!("XLSX parse error: {}", e),
            }
        })?;
        profile.counter("sheets", parsed.output.sheets.len() as u64);
        profile.counter(
            "cells",
            parsed
                .output
                .sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        parsed
    };
    let import_report = parsed.import_report;
    let parse_output = parsed.output;
    let diagnostics = parsed.diagnostics;
    if !diagnostics.errors.is_empty() {
        tracing::warn!(
            error_count = diagnostics.errors.len(),
            "XLSX import produced parse errors"
        );
    }

    // Import replaces the current document contents. The non-deferred path
    // rebuilds a fresh storage instance; the deferred path must do the same
    // before writing the critical first-paint hydration, otherwise callers that
    // import into an already-created blank/default engine can observe stale
    // sheet order and stale workbook maps.
    engine.update_buffer.clear();
    engine.stores.storage = YrsStorage::new();
    engine.import_report = import_report;
    engine.clear_runtime_diagnostics();

    // Pass 2: Allocate IDs for ALL sheets (fast — only ~4ms for 28 sheets).
    // Cell/Row/Col IDs are only allocated for sheets with cells or imported
    // dimensions. Metadata-only sheets still get stable SheetIds.
    let critical_sheet_index = xlsx_api::initial_active_visible_sheet_index(&parse_output)
        .filter(|idx| *idx < parse_output.sheets.len())
        .unwrap_or(0);
    let mut allocator = DefaultIdAllocator::new();
    let allocations: Vec<_> = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import_deferred", "id_allocation");
        let allocations: Vec<_> = parse_output
            .sheets
            .iter()
            .map(|sheet| allocate_sheet_ids(sheet, &mut allocator))
            .collect();
        profile.counter("sheets", allocations.len() as u64);
        profile.counter(
            "allocated_cells",
            allocations
                .iter()
                .map(|allocation| allocation.cell_ids.len() as u64)
                .sum::<u64>(),
        );
        profile.counter("critical_sheet_index", critical_sheet_index as u64);
        allocations
    };

    let id_map = {
        use crate::storage::infra::hydration::HydrationIdMap;
        let mut m = HydrationIdMap::default();
        for alloc in &allocations {
            m.sheet_ids.push(alloc.sheet_id);
            m.cell_ids.push(alloc.cell_ids.clone());
            m.row_ids.push(alloc.row_ids.clone());
            m.col_ids.push(alloc.col_ids.clone());
            for identity in &alloc.identity_only_cells {
                m.identity_only_cells.push((
                    alloc.sheet_id,
                    identity.cell_id,
                    identity.row,
                    identity.col,
                ));
            }
        }
        m
    };

    // Pass 3: Build snapshot from the selected parse output. All editable
    // sheets are present for tab strip/order, but only the critical sheet has
    // a full cell/domain payload.
    let workbook_snap = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new(
            "import_deferred",
            "parse_output_to_workbook_snapshot",
        );
        let snap = import::parse_output_to_snapshot::parse_output_to_workbook_snapshot(
            &parse_output,
            Some(&id_map),
            &mut allocator,
        );
        profile.counter("sheets", snap.sheets.len() as u64);
        profile.counter(
            "snapshot_cells",
            snap.sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        profile.counter(
            "ranges",
            snap.sheets
                .iter()
                .map(|sheet| sheet.ranges.len() as u64)
                .sum::<u64>(),
        );
        snap
    };

    // Pass 5: Hydrate the critical parse output into Yrs.
    //
    // Deferred import still avoids the expensive full-workbook cell hydration:
    // `parse_output` contains all sheet headers but only the critical sheet's
    // cells/domain payloads. Hydrating that data preserves the normal production
    // format read path (`properties::get_effective_format` -> Yrs
    // stylePalette/properties) for first paint, while keeping sheet
    // order/settings coherent for all tabs.
    let mut critical_ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut critical_range_data_per_sheet: Vec<Vec<snapshot_types::RangeData>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut critical_range_style_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut critical_range_styles_per_sheet: Vec<
        Vec<crate::storage::infra::hydration::ImportedRangeStyle>,
    > = Vec::with_capacity(parse_output.sheets.len());
    for sheet_idx in 0..parse_output.sheets.len() {
        if sheet_idx == critical_sheet_index && sheet_idx < workbook_snap.sheets.len() {
            let snap_sheet = &workbook_snap.sheets[sheet_idx];
            let snap_positions: std::collections::HashSet<(u32, u32)> =
                snap_sheet.cells.iter().map(|c| (c.row, c.col)).collect();
            let ranged = parse_output.sheets[sheet_idx]
                .cells
                .iter()
                .filter(|c| c.formula.is_some() || !c.value.is_null())
                .map(|c| (c.row, c.col))
                .filter(|pos| !snap_positions.contains(pos))
                .collect();
            critical_ranged_positions.push(ranged);
            critical_range_data_per_sheet.push(snap_sheet.ranges.clone());
        } else {
            critical_ranged_positions.push(std::collections::HashSet::new());
            critical_range_data_per_sheet.push(Vec::new());
        }
        critical_range_style_positions.push(std::collections::HashSet::new());
        critical_range_styles_per_sheet.push(Vec::new());
    }
    let mut critical_allocator = DefaultIdAllocator::new();
    {
        let mut profile = crate::xlsx_profile::PhaseTimer::new(
            "import_deferred",
            "hydrate_from_parse_output_with_ranges",
        );
        let _critical_id_map = engine
            .stores
            .storage
            .hydrate_from_parse_output_with_ranges(
                &parse_output,
                &allocations,
                &critical_ranged_positions,
                &critical_range_style_positions,
                &critical_range_data_per_sheet,
                &critical_range_styles_per_sheet,
                &mut critical_allocator,
            )?;
        engine
            .stores
            .storage
            .hydrate_imported_external_links(&parse_output.external_links)?;
        profile.counter("sheets", parse_output.sheets.len() as u64);
        profile.counter(
            "ranged_positions",
            critical_ranged_positions
                .iter()
                .map(|positions| positions.len() as u64)
                .sum::<u64>(),
        );
    }

    // Build CellMirror + viewport-only compute init.
    // Skips formula extraction entirely (deferred to ensure_graph_built).
    {
        let mut profile =
            crate::xlsx_profile::PhaseTimer::new("import_deferred", "mirror_compute_rebuild");
        engine.stores.compute = ComputeCore::new();
        engine
            .stores
            .compute
            .init_from_snapshot_viewport_only(&mut engine.mirror, workbook_snap.clone())?;
        profile.counter("sheets", workbook_snap.sheets.len() as u64);
        profile.counter(
            "snapshot_cells",
            workbook_snap
                .sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
    }

    // Pass 8: Build indexes from snapshot/parse_output.
    let seed = snapshot_id_high_water_mark(&workbook_snap);
    let shared_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_seed(seed));
    engine.stores.grid_id_alloc = std::sync::Arc::clone(&shared_alloc);
    engine.stores.compute.set_id_alloc(shared_alloc);
    engine.stores.id_alloc =
        std::sync::Arc::new(crate::storage::metadata_id_allocator_for_doc_client(
            engine.stores.storage.doc().client_id(),
        ));

    // Build indexes for only the critical sheet (viewport-visible).
    // Remaining sheets' indexes are built during complete_deferred_hydration.
    let critical_sheet_range = if workbook_snap.sheets.is_empty() {
        0..0
    } else {
        critical_sheet_index..critical_sheet_index.saturating_add(1)
    };
    engine.stores.grid_indexes = build_grid_indexes_from_allocations_range(
        &workbook_snap,
        &allocations,
        critical_sheet_range.clone(),
        engine.stores.grid_id_alloc.clone(),
    )?;
    engine.stores.merge_indexes = build_merge_indexes_from_parse_output_range(
        &parse_output,
        &workbook_snap,
        critical_sheet_range.clone(),
    )?;
    engine.stores.layout_indexes = build_layout_indexes_from_parse_output_range(
        &parse_output,
        &workbook_snap,
        &engine.stores.grid_indexes,
        critical_sheet_range,
    )?;

    engine.mirror.install_row_col_indexes(
        engine
            .stores
            .grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_ids_ordered(), grid.col_ids_ordered())),
    );
    hydrate_mirror_format_ranges(&engine.stores.storage, &mut engine.mirror);
    engine.mirror.finalize_range_hydration();

    crate::storage::engine::services::imported_filters::normalize_imported_auto_filter_visibility(
        &mut engine.stores,
        &mut engine.mirror,
        Some(&mut engine.import_report),
        domain_types::ImportPhase::CriticalSheet,
    );

    // Pass 9: Observer/undo/settings for the critical Yrs document.
    engine.update_buffer.clear();
    engine._update_subscription = crate::storage::engine::update_buffer::install_observer(
        engine.stores.storage.doc(),
        &engine.update_buffer,
    );
    let (observer, undo_manager) = create_observer_and_undo(&engine.stores.storage);
    engine.mutation.observer = observer;
    engine.mutation.undo_manager = undo_manager;
    engine.settings = derive_settings(&engine.stores.storage);
    engine.viewport.clear();

    // Register phantom cells from first sheet
    for (sheet_id, cell_id, row, col) in &id_map.phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(sheet_id) {
            grid.register_cell(*cell_id, *row, *col);
        }
    }

    // Store data for deferred Yrs hydration. `complete_deferred_hydration`
    // re-parses the workbook and re-allocates cells for all sheets before it
    // commits anything to the live engine.
    engine.deferred_hydration = Some(DeferredHydrationData {
        parse_output,
        allocations,
        workbook_snap,
        raw_xlsx_bytes: Some(xlsx_data.to_vec()),
    });

    Ok(RecalcResult::empty())
}

/// Complete the deferred Yrs CRDT hydration.
/// Call after first viewport paint to enable mutations and persistence.
pub(in crate::storage::engine) fn stage_deferred_hydration(
    engine: &YrsComputeEngine,
) -> Result<Option<DeferredHydrationCompletion>, ComputeError> {
    let Some(data) = engine.deferred_hydration.as_ref() else {
        return Ok(None);
    };

    // Debug breadcrumbs for WASM std::time panic investigation.
    // tracing::info! routes through the configured subscriber → browser console.
    macro_rules! dh_log {
        ($msg:expr) => {
            tracing::info!(target: "deferred_hydration", $msg);
        };
    }

    let completion = {
        // Pass 0: Re-parse XLSX with full options (all sheets' cells).
        // The fast path only parsed the first sheet's cells. Keep the pending
        // guard installed until every fallible full-hydration step has staged
        // successfully; a failed hydrate must remain retryable/protected.
        dh_log!("phase 0: re-parse XLSX");
        let (full_parse_output, mut import_report) = {
            let mut profile =
                crate::xlsx_profile::PhaseTimer::new("complete_deferred_hydration", "parse");
            let (parsed, report) = if let Some(raw_bytes) = &data.raw_xlsx_bytes {
                let parsed = xlsx_api::parse(raw_bytes).map_err(|e| ComputeError::Deserialize {
                    message: format!("XLSX full re-parse error: {}", e),
                })?;
                (parsed.output, parsed.import_report)
            } else {
                (data.parse_output.clone(), engine.import_report.clone())
            };
            profile.counter("sheets", parsed.sheets.len() as u64);
            profile.counter(
                "cells",
                parsed
                    .sheets
                    .iter()
                    .map(|sheet| sheet.cells.len() as u64)
                    .sum::<u64>(),
            );
            let mut merged_report = engine.import_report.clone();
            merge_import_reports(&mut merged_report, report);
            (parsed, merged_report)
        };
        dh_log!("phase 0 done");

        // Pass 1: Re-allocate IDs for ALL sheets, reusing any IDs assigned by
        // the first-paint parse while still consuming allocator slots for the
        // full workbook shape.
        use crate::storage::infra::hydration::allocate_sheet_ids_with_previous_allocation;
        let mut allocator = crate::storage::infra::hydration::DefaultIdAllocator::with_seed(
            seed_after_allocations(&data.allocations),
        );
        let allocations: Vec<_> = {
            let mut profile = crate::xlsx_profile::PhaseTimer::new(
                "complete_deferred_hydration",
                "id_allocation",
            );
            let allocations: Vec<_> = full_parse_output
                .sheets
                .iter()
                .enumerate()
                .map(|(i, sheet)| {
                    allocate_sheet_ids_with_previous_allocation(
                        sheet,
                        &mut allocator,
                        data.allocations.get(i),
                    )
                })
                .collect();
            profile.counter("sheets", allocations.len() as u64);
            profile.counter(
                "allocated_cells",
                allocations
                    .iter()
                    .map(|allocation| allocation.cell_ids.len() as u64)
                    .sum::<u64>(),
            );
            allocations
        };

        let id_map_full = {
            use crate::storage::infra::hydration::HydrationIdMap;
            let mut m = HydrationIdMap::default();
            for alloc in &allocations {
                m.sheet_ids.push(alloc.sheet_id);
                m.cell_ids.push(alloc.cell_ids.clone());
                m.row_ids.push(alloc.row_ids.clone());
                m.col_ids.push(alloc.col_ids.clone());
                for identity in &alloc.identity_only_cells {
                    m.identity_only_cells.push((
                        alloc.sheet_id,
                        identity.cell_id,
                        identity.row,
                        identity.col,
                    ));
                }
            }
            m
        };

        let full_snap = {
            use crate::import;
            let mut profile = crate::xlsx_profile::PhaseTimer::new(
                "complete_deferred_hydration",
                "parse_output_to_workbook_snapshot",
            );
            let snap = import::parse_output_to_snapshot::parse_output_to_workbook_snapshot(
                &full_parse_output,
                Some(&id_map_full),
                &mut allocator,
            );
            profile.counter("sheets", snap.sheets.len() as u64);
            profile.counter(
                "snapshot_cells",
                snap.sheets
                    .iter()
                    .map(|sheet| sheet.cells.len() as u64)
                    .sum::<u64>(),
            );
            profile.counter(
                "ranges",
                snap.sheets
                    .iter()
                    .map(|sheet| sheet.ranges.len() as u64)
                    .sum::<u64>(),
            );
            snap
        };

        let mut ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> =
            Vec::with_capacity(full_parse_output.sheets.len());
        let mut range_data_per_sheet: Vec<Vec<snapshot_types::RangeData>> =
            Vec::with_capacity(full_parse_output.sheets.len());
        let mut range_style_positions: Vec<std::collections::HashSet<(u32, u32)>> =
            Vec::with_capacity(full_parse_output.sheets.len());
        let mut range_styles_per_sheet: Vec<
            Vec<crate::storage::infra::hydration::ImportedRangeStyle>,
        > = Vec::with_capacity(full_parse_output.sheets.len());
        {
            let mut profile = crate::xlsx_profile::PhaseTimer::new(
                "complete_deferred_hydration",
                "ranged_positions",
            );
            for (sheet_idx, sheet_data) in full_parse_output.sheets.iter().enumerate() {
                let snap_sheet = &full_snap.sheets[sheet_idx];
                let snap_positions: std::collections::HashSet<(u32, u32)> =
                    snap_sheet.cells.iter().map(|c| (c.row, c.col)).collect();
                let ranged: std::collections::HashSet<(u32, u32)> = sheet_data
                    .cells
                    .iter()
                    .filter(|c| c.formula.is_some() || !c.value.is_null())
                    .map(|c| (c.row, c.col))
                    .filter(|pos| !snap_positions.contains(pos))
                    .collect();
                ranged_positions.push(ranged);
                range_data_per_sheet.push(snap_sheet.ranges.clone());
                range_style_positions.push(std::collections::HashSet::new());
                range_styles_per_sheet.push(Vec::new());
            }
            profile.counter("sheets", ranged_positions.len() as u64);
            profile.counter(
                "ranged_positions",
                ranged_positions
                    .iter()
                    .map(|positions| positions.len() as u64)
                    .sum::<u64>(),
            );
        }

        dh_log!("phase 1 done: IDs allocated, snapshot built");

        dh_log!("phase 2a: YrsStorage::new()");
        let mut new_storage = YrsStorage::new();
        dh_log!("phase 2b: hydrate_from_parse_output_with_ranges start");
        let id_map = {
            let mut profile = crate::xlsx_profile::PhaseTimer::new(
                "complete_deferred_hydration",
                "hydrate_from_parse_output_with_ranges",
            );
            let id_map = new_storage.hydrate_from_parse_output_with_ranges(
                &full_parse_output,
                &allocations,
                &ranged_positions,
                &range_style_positions,
                &range_data_per_sheet,
                &range_styles_per_sheet,
                &mut allocator,
            )?;
            new_storage.hydrate_imported_external_links(&full_parse_output.external_links)?;
            profile.counter("sheets", full_parse_output.sheets.len() as u64);
            profile.counter(
                "ranged_positions",
                ranged_positions
                    .iter()
                    .map(|positions| positions.len() as u64)
                    .sum::<u64>(),
            );
            id_map
        };

        dh_log!("phase 2 done: YrsStorage hydrated");

        let seed = snapshot_id_high_water_mark(&full_snap);
        let shared_alloc = std::sync::Arc::new(cell_types::IdAllocator::with_seed(seed));
        let grid_indexes =
            build_grid_indexes_from_yrs(&new_storage, &full_snap, shared_alloc.clone())?;
        let merge_indexes = build_merge_indexes(&new_storage, &full_snap, &grid_indexes)?;
        let layout_indexes = build_layout_indexes(&new_storage, &full_snap, &grid_indexes)?;

        dh_log!("phase 3 done: grid/merge/layout indexes built");

        // Rebuild ComputeCore and CellMirror against the staged full snapshot
        // before committing them to the live engine.
        let (new_compute, mut new_mirror) = {
            let mut profile = crate::xlsx_profile::PhaseTimer::new(
                "complete_deferred_hydration",
                "mirror_compute_rebuild",
            );
            let mut new_compute = ComputeCore::new();
            let mut new_mirror = CellMirror::new();
            #[cfg(target_arch = "wasm32")]
            {
                new_compute.init_from_snapshot_minimal(&mut new_mirror, full_snap.clone())?;
            }
            #[cfg(not(target_arch = "wasm32"))]
            {
                new_compute.init_from_snapshot_no_recalc(&mut new_mirror, full_snap.clone())?;
            }
            profile.counter("sheets", full_snap.sheets.len() as u64);
            profile.counter(
                "snapshot_cells",
                full_snap
                    .sheets
                    .iter()
                    .map(|sheet| sheet.cells.len() as u64)
                    .sum::<u64>(),
            );
            new_compute.set_id_alloc(shared_alloc.clone());
            (new_compute, new_mirror)
        };

        dh_log!("phase 4 done: ComputeCore init_from_snapshot_minimal");

        new_mirror.install_row_col_indexes(
            grid_indexes
                .iter()
                .map(|(sid, grid)| (*sid, grid.row_ids_ordered(), grid.col_ids_ordered())),
        );
        hydrate_mirror_format_ranges(&new_storage, &mut new_mirror);
        new_mirror.finalize_range_hydration();

        let settings = derive_settings(&new_storage);
        let calculation = full_parse_output.calculation.clone();
        let id_alloc = std::sync::Arc::new(crate::storage::metadata_id_allocator_for_doc_client(
            new_storage.doc().client_id(),
        ));
        let mut stores = EngineStores {
            storage: new_storage,
            grid_id_alloc: shared_alloc,
            id_alloc,
            grid_indexes,
            layout_indexes,
            merge_indexes,
            compute: new_compute,
            cf_cache: FxHashMap::default(),
            font_db: compute_text_measurement::FontDb::with_defaults(),
            measurement_cache: compute_text_measurement::MeasurementCache::new(),
            custom_table_styles: FxHashMap::default(),
            custom_cell_styles: FxHashMap::default(),
        };
        load_custom_cell_styles(&mut stores);
        load_custom_table_styles(&mut stores);
        crate::storage::engine::services::imported_filters::normalize_imported_auto_filter_visibility(
            &mut stores,
            &mut new_mirror,
            Some(&mut import_report),
            domain_types::ImportPhase::FullHydration,
        );

        DeferredHydrationCompletion {
            stores,
            mirror: new_mirror,
            settings,
            phantom_cells: id_map.phantom_cells,
            calculation,
            import_report,
        }
    };

    dh_log!("phase 5 done: mirror finalized, settings derived");

    Ok(Some(completion))
}

fn seed_after_allocations(
    allocations: &[crate::storage::infra::hydration::SheetIdAllocation],
) -> u64 {
    let mut max_id = 0_u128;

    for allocation in allocations {
        max_id = max_id.max(allocation.sheet_id.as_u128());
        for row_id in &allocation.row_ids {
            max_id = max_id.max(row_id.as_u128());
        }
        for col_id in &allocation.col_ids {
            max_id = max_id.max(col_id.as_u128());
        }
        for cell_id in &allocation.cell_ids {
            max_id = max_id.max(cell_id.as_u128());
        }
        for identity in &allocation.identity_only_cells {
            max_id = max_id.max(identity.cell_id.as_u128());
        }
    }

    u64::try_from(max_id)
        .unwrap_or(u64::MAX.saturating_sub(1))
        .saturating_add(1)
        .max(1)
}

fn merge_import_reports(
    target: &mut domain_types::ImportReport,
    source: domain_types::ImportReport,
) {
    target.diagnostics.extend(source.diagnostics);
    target.force_recalc_cells.extend(source.force_recalc_cells);
    target.object_statuses.extend(source.object_statuses);
    target.stats = source.stats;
    target.canonicalize();
}

pub(in crate::storage::engine) fn commit_deferred_hydration(
    engine: &mut YrsComputeEngine,
    completion: DeferredHydrationCompletion,
) {
    // Commit the fully staged state. From this point onward the live engine is
    // all-sheet materialized and export/graph guards can be cleared.
    engine.update_buffer.clear();
    engine.stores = completion.stores;
    engine._update_subscription = crate::storage::engine::update_buffer::install_observer(
        engine.stores.storage.doc(),
        &engine.update_buffer,
    );
    engine.mirror = completion.mirror;

    let (observer, undo_manager) = create_observer_and_undo(&engine.stores.storage);
    engine.mutation.observer = observer;
    engine.mutation.undo_manager = undo_manager;
    engine.settings = completion.settings;
    engine.import_report = completion.import_report;
    engine.viewport.clear();

    engine.init_cf_caches();

    normalize_named_range_refs(engine);
    sync_enable_calculation_flags(engine);

    for (sheet_id, cell_id, row, col) in completion.phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(&sheet_id) {
            grid.register_cell(cell_id, row, col);
        }
    }

    engine.deferred_hydration = None;
}
