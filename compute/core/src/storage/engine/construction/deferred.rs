use super::*;

pub(in crate::storage::engine) fn import_from_xlsx_bytes_deferred(
    engine: &mut ComputeEngine,
    xlsx_data: &[u8],
) -> Result<RecalcResult, ComputeError> {
    use crate::import;
    use crate::storage::infra::hydration::{DefaultIdAllocator, allocate_sheet_ids};

    // Pass 1: Parse XLSX — only the initial active visible sheet's cells
    // (ZIP decompress + XML parse). Remaining sheets get metadata only and load during completion.
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

    engine.stores.storage = WorkbookStorage::new();
    engine.import_report = import_report;
    engine.clear_runtime_diagnostics();

    // Allocate compact axes and sparse anchors for every sheet header.
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
            m.row_axes.push(alloc.row_axis.clone());
            m.col_axes.push(alloc.col_axis.clone());
            for identity in &alloc.identity_only_cells {
                m.identities
                    .push((alloc.sheet_id, identity.cell_id, identity.row, identity.col));
            }
        }
        m
    };

    // Pass 3: Build snapshot from the selected parse output. All editable
    // sheets are present for tab strip/order, but only the critical sheet has
    // a full cell/domain payload.
    let mut workbook_snap = {
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

    // Hydrate all sheet headers and the active sheet's metadata so first
    // display uses the same native settings and style path as normal import.
    let mut critical_ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut critical_range_style_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut critical_range_styles_per_sheet: Vec<
        Vec<crate::storage::infra::hydration::ImportedRangeStyle>,
    > = Vec::with_capacity(parse_output.sheets.len());
    for sheet_idx in 0..parse_output.sheets.len() {
        let plan = match (
            sheet_idx == critical_sheet_index,
            workbook_snap.sheets.get(sheet_idx),
        ) {
            (true, Some(snap_sheet)) => build_deferred_critical_sheet_range_plan(
                &parse_output.sheets[sheet_idx],
                snap_sheet,
                &allocations[sheet_idx],
                &mut allocator,
            ),
            _ => DeferredCriticalSheetRangePlan::default(),
        };
        critical_ranged_positions.push(plan.ranged_positions);

        critical_range_style_positions.push(plan.range_style_positions);
        critical_range_styles_per_sheet.push(plan.range_styles);
    }
    {
        let mut profile = crate::xlsx_profile::PhaseTimer::new(
            "import_deferred",
            "hydrate_from_parse_output_with_ranges",
        );
        let critical_id_map = engine
            .stores
            .storage
            .hydrate_from_parse_output_with_ranges(
                &parse_output,
                &allocations,
                &critical_ranged_positions,
                &critical_range_style_positions,
                &mut allocator,
            )?;
        critical_id_map.install_snapshot_identities(&mut workbook_snap);
        workbook_snap.canonical_tables = critical_id_map.canonical_tables;
        workbook_snap.tables.clear();
        engine
            .stores
            .storage
            .metadata
            .external_links
            .import(&parse_output.external_links);
        profile.counter("sheets", parse_output.sheets.len() as u64);
        profile.counter(
            "ranged_positions",
            critical_ranged_positions
                .iter()
                .map(|positions| positions.len() as u64)
                .sum::<u64>(),
        );
        profile.counter(
            "range_style_positions",
            critical_range_style_positions
                .iter()
                .map(|positions| positions.len() as u64)
                .sum::<u64>(),
        );
        profile.counter(
            "range_styles",
            critical_range_styles_per_sheet
                .iter()
                .map(|styles| styles.len() as u64)
                .sum::<u64>(),
        );
    }

    allocator.stamp_snapshot_counters(&mut workbook_snap);
    // Build CellStore + viewport-only compute init.
    // Skips formula extraction entirely (deferred to ensure_graph_built).
    {
        let mut profile =
            crate::xlsx_profile::PhaseTimer::new("import_deferred", "store_compute_rebuild");
        engine.stores.compute = ComputeCore::new();
        engine
            .stores
            .compute
            .init_from_snapshot_viewport_only(&mut engine.cell_store, workbook_snap.clone())?;
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
    shared_alloc.ensure_axis_run_past(cell_types::AxisRunId::from_raw(
        workbook_snap.next_axis_run_counter().saturating_sub(1),
    ));
    engine.stores.grid_id_alloc = std::sync::Arc::clone(&shared_alloc);
    engine.cell_store.set_id_alloc(shared_alloc.clone());
    engine.stores.compute.set_id_alloc(shared_alloc);
    engine.stores.id_alloc =
        std::sync::Arc::new(crate::storage::new_runtime_metadata_id_allocator());

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
    engine.stores.pixel_layouts = Default::default();

    engine.cell_store.install_native_axes(
        engine
            .stores
            .grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_axis(), grid.col_axis())),
    );
    let imported_formats = collect_imported_formats(
        &parse_output,
        &allocations
            .iter()
            .map(|allocation| allocation.sheet_id)
            .collect::<Vec<_>>(),
        &critical_range_styles_per_sheet,
    );
    install_imported_formats(
        &mut engine.cell_store,
        &engine.stores.storage.metadata.style_palette,
        &imported_formats,
    );
    engine.cell_store.finalize_range_hydration();

    crate::storage::engine::services::imported_filters::normalize_imported_auto_filter_visibility(
        &mut engine.stores,
        &mut engine.cell_store,
        Some(&mut engine.import_report),
        domain_types::ImportPhase::CriticalSheet,
    );

    engine.settings = derive_settings(&engine.stores.storage);
    engine.viewport.clear();

    engine.deferred_hydration = Some(DeferredHydrationData {
        loaded_sheet_index: critical_sheet_index,
        raw_xlsx_bytes: xlsx_data.to_vec(),
    });

    Ok(RecalcResult::empty())
}

/// Stage only unloaded worksheet payloads. The loaded native sheet and workbook
/// metadata survive unchanged until this complete state can be committed.
pub(in crate::storage::engine) fn stage_deferred_hydration(
    engine: &ComputeEngine,
) -> Result<Option<DeferredHydrationCompletion>, ComputeError> {
    use crate::storage::infra::hydration::{
        DefaultIdAllocator, HydrationIdMap, SheetIdAllocation,
        allocate_sheet_ids_with_previous_allocation,
    };
    let Some(data) = engine.deferred_hydration.as_ref() else {
        return Ok(None);
    };
    let sheet_ids = engine.stores.storage.sheet_order();
    let remaining: Vec<_> = (0..sheet_ids.len())
        .filter(|index| *index != data.loaded_sheet_index)
        .collect();
    let parsed =
        xlsx_api::parse_selected_sheets(&data.raw_xlsx_bytes, &remaining).map_err(|error| {
            ComputeError::Deserialize {
                message: format!("XLSX remaining-sheet parse error: {error}"),
            }
        })?;
    let output = parsed.output;
    if output.sheets.len() != sheet_ids.len() {
        return Err(ComputeError::Deserialize {
            message: "deferred worksheet inventory changed".into(),
        });
    }
    let mut import_report = engine.import_report.clone();
    merge_import_reports(&mut import_report, parsed.import_report);
    let shared_alloc = Arc::new(IdAllocator::with_seed(
        engine.stores.grid_id_alloc.high_water_mark(),
    ));
    shared_alloc.ensure_axis_run_past(cell_types::AxisRunId::from_raw(
        engine
            .stores
            .grid_id_alloc
            .axis_run_high_water_mark()
            .saturating_sub(1),
    ));
    let mut allocator = DefaultIdAllocator::with_shared(shared_alloc.clone());
    for sheet_id in &sheet_ids {
        if let Some(sheet) = engine.cell_store.get_sheet(sheet_id) {
            allocator.reserve_axis(sheet.row_axis.store());
            allocator.reserve_axis(sheet.col_axis.store());
        }
    }

    // Preserve the identity of metadata-only sheet headers and any sparse
    // anchors already allocated on them. No active value snapshot is retained.
    let mut allocations = Vec::with_capacity(sheet_ids.len());
    for (index, (&sheet_id, sheet_data)) in sheet_ids.iter().zip(&output.sheets).enumerate() {
        let sheet =
            engine
                .cell_store
                .get_sheet(&sheet_id)
                .ok_or_else(|| ComputeError::Deserialize {
                    message: "missing native deferred sheet".into(),
                })?;
        let previous = SheetIdAllocation {
            sheet_id,
            sheet_hex: compute_document::hex::id_to_hex(sheet_id.as_u128()),
            row_axis: sheet.row_axis.store().clone(),
            col_axis: sheet.col_axis.store().clone(),
            cell_ids: Vec::new(),
            identity_only_cells: Vec::new(),
        };
        let mut allocation = if index == data.loaded_sheet_index {
            previous
        } else {
            allocate_sheet_ids_with_previous_allocation(sheet_data, &mut allocator, Some(&previous))
        };
        for (cell, allocated) in sheet_data.cells.iter().zip(&mut allocation.cell_ids) {
            if let Some(id) = sheet.cell_id_at(cell_types::SheetPos::new(cell.row, cell.col)) {
                *allocated = id;
            }
        }
        for identity in &mut allocation.identity_only_cells {
            if let Some(id) =
                sheet.cell_id_at(cell_types::SheetPos::new(identity.row, identity.col))
            {
                identity.cell_id = id;
            }
        }
        allocations.push(allocation);
    }
    let mut id_map = HydrationIdMap::default();
    for allocation in &allocations {
        id_map.sheet_ids.push(allocation.sheet_id);
        id_map.cell_ids.push(allocation.cell_ids.clone());
        id_map.row_axes.push(allocation.row_axis.clone());
        id_map.col_axes.push(allocation.col_axis.clone());
        id_map
            .identities
            .extend(allocation.identity_only_cells.iter().map(|identity| {
                (
                    allocation.sheet_id,
                    identity.cell_id,
                    identity.row,
                    identity.col,
                )
            }));
    }
    let mut snapshot = crate::import::parse_output_to_snapshot::parse_output_to_workbook_snapshot(
        &output,
        Some(&id_map),
        &mut allocator,
    );
    let mut ranged_positions = Vec::with_capacity(sheet_ids.len());
    let mut range_style_positions = Vec::with_capacity(sheet_ids.len());
    let mut range_styles = Vec::with_capacity(sheet_ids.len());
    for (index, sheet_data) in output.sheets.iter().enumerate() {
        let plan = build_deferred_critical_sheet_range_plan(
            sheet_data,
            &snapshot.sheets[index],
            &allocations[index],
            &mut allocator,
        );
        ranged_positions.push(plan.ranged_positions);
        range_style_positions.push(plan.range_style_positions);
        range_styles.push(plan.range_styles);
    }
    let mut storage = engine.stores.storage.clone();
    let imported_ids = storage.hydrate_remaining_sheets(
        &output,
        &allocations,
        &ranged_positions,
        &range_style_positions,
        data.loaded_sheet_index,
        engine.cell_store.all_tables(),
        &mut allocator,
    )?;
    imported_ids.install_snapshot_identities(&mut snapshot);

    // Staging shares active range payloads via Arc. Only newly parsed sheets
    // decode payloads; after commit the old native state is dropped.
    let mut cell_store = engine.cell_store.clone();
    let mut formula_cells = Vec::new();
    if let Some(&active) = sheet_ids.get(data.loaded_sheet_index) {
        if let Some(sheet) = cell_store.get_sheet(&active) {
            formula_cells.extend(sheet.cells_iter().filter_map(|(&id, _)| {
                engine
                    .stores
                    .compute
                    .get_formula(&id)
                    .map(|text| (id, active, text.to_owned()))
            }));
        }
    }
    for (index, sheet_snapshot) in snapshot.sheets.iter().enumerate() {
        if index == data.loaded_sheet_index {
            continue;
        }
        let sheet_id = sheet_ids[index];
        formula_cells.extend(sheet_snapshot.cells.iter().filter_map(|cell| {
            Some((
                CellId::from_uuid_str(&cell.cell_id).ok()?,
                sheet_id,
                cell.formula.clone()?,
            ))
        }));
        cell_store.remove_sheet(&sheet_id);
        cell_store.add_sheet(sheet_snapshot.clone())?;
    }
    for table in imported_ids.canonical_tables {
        cell_store.set_table(table);
    }
    for pivot in &snapshot.pivot_tables {
        cell_store.upsert_pivot_table_def(pivot.clone());
    }
    for region in &snapshot.data_table_regions {
        cell_store.upsert_data_table_region(region.clone());
    }

    let mut grid_indexes = build_grid_indexes(&cell_store, &snapshot, shared_alloc.clone())?;
    let merge_indexes = build_merge_indexes(&storage, &snapshot, &cell_store)?;
    let layout_metrics = engine.stores.layout_metrics;
    cell_store.install_native_axes(
        grid_indexes
            .iter()
            .map(|(id, grid)| (*id, grid.row_axis(), grid.col_axis())),
    );
    let imported_formats = collect_imported_formats(&output, &sheet_ids, &range_styles)
        .into_iter()
        .filter(|(id, _)| Some(id) != sheet_ids.get(data.loaded_sheet_index))
        .collect::<Vec<_>>();
    install_imported_formats(
        &mut cell_store,
        &storage.metadata.style_palette,
        &imported_formats,
    );
    cell_store.finalize_range_hydration();
    let settings = derive_settings(&storage);
    let calculation = output.calculation.clone();
    cell_store.set_id_alloc(shared_alloc.clone());
    let mut compute = ComputeCore::new();
    compute.init_native_formula_descriptors(
        &mut cell_store,
        &sheet_ids,
        &calculation.clone().into(),
        formula_cells,
        shared_alloc.clone(),
    );
    #[cfg(not(target_arch = "wasm32"))]
    compute.ensure_graph_built(&mut cell_store)?;
    // Formula resolution may extend the store's shared axes.
    for (sheet_id, grid) in &mut grid_indexes {
        if let Some(sheet) = cell_store.get_sheet(sheet_id) {
            grid.restore_shared_axes(sheet.row_axis.clone(), sheet.col_axis.clone());
        }
    }
    let mut stores = EngineStores {
        storage,
        layout_metrics,
        grid_id_alloc: shared_alloc,
        id_alloc: Arc::new(crate::storage::new_runtime_metadata_id_allocator()),
        grid_indexes,
        pixel_layouts: Default::default(),
        merge_indexes,
        compute,
        cf_cache: FxHashMap::default(),
        font_db: Default::default(),
        measurement_cache: compute_text_measurement::MeasurementCache::new(),
    };
    crate::storage::engine::services::imported_filters::normalize_imported_auto_filter_visibility(
        &mut stores,
        &mut cell_store,
        Some(&mut import_report),
        domain_types::ImportPhase::FullHydration,
    );
    Ok(Some(DeferredHydrationCompletion {
        stores,
        cell_store,
        settings,
        calculation,
        import_report,
    }))
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

#[derive(Default)]
struct DeferredCriticalSheetRangePlan {
    ranged_positions: std::collections::HashSet<(u32, u32)>,
    range_style_positions: std::collections::HashSet<(u32, u32)>,
    range_styles: Vec<crate::storage::infra::hydration::ImportedRangeStyle>,
}

fn build_deferred_critical_sheet_range_plan(
    sheet_data: &domain_types::SheetData,
    snap_sheet: &SheetSnapshot,
    allocation: &crate::storage::infra::hydration::SheetIdAllocation,
    allocator: &mut crate::storage::infra::hydration::DefaultIdAllocator,
) -> DeferredCriticalSheetRangePlan {
    let snap_positions: std::collections::HashSet<(u32, u32)> =
        snap_sheet.cells.iter().map(|c| (c.row, c.col)).collect();
    let ranged_positions = sheet_data
        .cells
        .iter()
        .filter(|c| c.formula.is_some() || !c.value.is_null())
        .map(|c| (c.row, c.col))
        .filter(|pos| !snap_positions.contains(pos))
        .collect();
    let (range_style_positions, range_styles) = range_style_formats_enabled()
        .then(|| {
            build_imported_range_style_plan(sheet_data, allocation, &snap_sheet.ranges, allocator)
        })
        .unwrap_or_default();

    DeferredCriticalSheetRangePlan {
        ranged_positions,
        range_style_positions,
        range_styles,
    }
}

pub(in crate::storage::engine) fn commit_deferred_hydration(
    engine: &mut ComputeEngine,
    completion: DeferredHydrationCompletion,
) {
    engine.stores = completion.stores;

    engine.cell_store = completion.cell_store;

    engine.settings = completion.settings;
    engine.import_report = completion.import_report;
    engine.viewport.clear();

    engine.init_cf_caches();

    normalize_named_range_refs(engine);
    sync_enable_calculation_flags(engine);

    engine.deferred_hydration = None;
}
