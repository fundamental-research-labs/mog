use super::*;

/// Construct a `ComputeEngine` from raw XLSX bytes without recalculation.
pub(in crate::storage::engine) fn from_xlsx_bytes(
    xlsx_data: &[u8],
) -> Result<(ComputeEngine, RecalcResult), ComputeError> {
    let (storage, workbook_snap, import_report, imported_formats, mut cell_store, formula_cells) =
        parse_and_hydrate_xlsx(xlsx_data)?;

    let (cell_store, compute, recalc_result) = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "store_compute_rebuild");
        let mut compute = ComputeCore::new();
        let recalc_result = compute.init_from_populated_store_no_recalc(
            &mut cell_store,
            formula_cells,
            &workbook_snap,
        )?;
        profile.counter("sheets", workbook_snap.sheets.len() as u64);
        profile.counter(
            "snapshot_cells",
            workbook_snap
                .sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        (cell_store, compute, recalc_result)
    };

    let mut engine = assemble_engine(storage, cell_store, compute, &workbook_snap)?;
    install_imported_formats(
        &mut engine.cell_store,
        &engine.stores.storage.metadata.style_palette,
        &imported_formats,
    );
    engine.import_report = import_report;
    engine.stream_load_stats = xlsx_parser::last_stream_load_stats();
    crate::storage::engine::services::imported_filters::normalize_imported_auto_filter_visibility(
        &mut engine.stores,
        &mut engine.cell_store,
        Some(&mut engine.import_report),
        domain_types::ImportPhase::FullHydration,
    );

    Ok((engine, recalc_result))
}

/// Memory-map a local `.xlsx` and stream-inflate it into a live engine.
///
/// The mapping avoids an owned full-file `Vec<u8>`. Worksheet XML is inflated
/// in chunks rather than materialized as a complete document.
#[cfg(all(not(target_arch = "wasm32"), feature = "native"))]
pub(in crate::storage::engine) fn from_xlsx_path(
    path: &str,
) -> Result<(ComputeEngine, RecalcResult), ComputeError> {
    use xlsx_parser::pipeline::mmap::MmapXlsxFile;

    // SAFETY: CLI/path load is a trusted local file that is not mutated while
    // the mapping is live. Untrusted payloads must use `from_xlsx_bytes`.
    let mapped = unsafe { MmapXlsxFile::open(path) }.map_err(|e| ComputeError::Deserialize {
        message: format!("mmap {path}: {e}"),
    })?;
    from_xlsx_bytes(mapped.as_slice())
}

/// Import from raw XLSX bytes into an existing engine, with or without recalc.
///
/// Classify homogeneous values into compact native ranges before assembly.
pub(in crate::storage::engine) fn import_from_xlsx_bytes(
    engine: &mut ComputeEngine,
    xlsx_data: &[u8],
    do_recalc: bool,
) -> Result<RecalcResult, ComputeError> {
    let (loaded, recalc) = from_xlsx_bytes(xlsx_data)?;
    engine.cell_store = loaded.cell_store;
    engine.stores = loaded.stores;
    engine.viewport = loaded.viewport;
    engine.settings = loaded.settings;
    engine.import_report = loaded.import_report;
    engine.runtime_diagnostics = loaded.runtime_diagnostics;
    engine.version_runtime_operation_context = loaded.version_runtime_operation_context;
    engine.scenario_session = loaded.scenario_session;
    engine.deferred_hydration = loaded.deferred_hydration;
    engine.stream_load_stats = loaded.stream_load_stats;
    engine.clear_runtime_diagnostics();
    let result = if do_recalc {
        engine.recalculate()?
    } else {
        recalc
    };

    Ok(result)
}

/// Parse the workbook once and hydrate native metadata with the identities
/// used by the snapshot's sparse cells and compact ranges.
pub(in crate::storage::engine) fn parse_and_hydrate_xlsx(
    xlsx_data: &[u8],
) -> Result<XlsxStreamHydrateResult, ComputeError> {
    use crate::import;
    use crate::storage::infra::hydration::{allocate_sheet_ids, DefaultIdAllocator};

    let parsed = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "parse");
        let parsed = xlsx_api::parse(xlsx_data).map_err(|e| ComputeError::Deserialize {
            message: format!("XLSX parse error: {}", e),
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
    let mut parse_output = parsed.output;
    let diagnostics = parsed.diagnostics;
    if !diagnostics.errors.is_empty() {
        tracing::warn!(
            error_count = diagnostics.errors.len(),
            "XLSX import produced parse errors"
        );
    }
    if !diagnostics.force_recalc_cells.is_empty() {
        tracing::info!(
            count = diagnostics.force_recalc_cells.len(),
            "XLSX import: cells requiring forced recalc"
        );
    }

    // ── Pass 1: Allocate native identities ──────────────────────────
    let mut allocator = DefaultIdAllocator::new();
    let allocations: Vec<_> = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "id_allocation");
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
        allocations
    };

    // ── Pass 2: Hydrate native metadata while sheet cells still exist ─
    let empty_ranged: Vec<std::collections::HashSet<(u32, u32)>> =
        vec![std::collections::HashSet::new(); parse_output.sheets.len()];
    let empty_range_styles: Vec<Vec<crate::storage::infra::hydration::ImportedRangeStyle>> =
        vec![Vec::new(); parse_output.sheets.len()];
    let (storage, id_map) = {
        let mut profile =
            crate::xlsx_profile::PhaseTimer::new("import", "hydrate_from_parse_output_with_ranges");
        let mut storage = WorkbookStorage::new();
        let id_map = storage.hydrate_from_parse_output_with_ranges(
            &parse_output,
            &allocations,
            &empty_ranged,
            &empty_ranged,
            &mut allocator,
        )?;
        storage
            .metadata
            .external_links
            .import(&parse_output.external_links);
        profile.counter("sheets", parse_output.sheets.len() as u64);
        (storage, id_map)
    };

    let imported_formats =
        collect_imported_formats(&parse_output, &id_map.sheet_ids, &empty_range_styles);

    // ── Pass 3: Write each sheet into the live store, then drop its IR ─
    let mut cell_store = CellStore::new();
    let mut formula_cells = Vec::new();
    {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "stream_cells_into_store");
        for (sheet_idx, sheet) in parse_output.sheets.iter_mut().enumerate() {
            let mut sheet_id_map = crate::storage::infra::hydration::HydrationIdMap::default();
            sheet_id_map.sheet_ids.push(id_map.sheet_ids[sheet_idx]);
            sheet_id_map
                .cell_ids
                .push(id_map.cell_ids[sheet_idx].clone());
            sheet_id_map
                .row_axes
                .push(id_map.row_axes[sheet_idx].clone());
            sheet_id_map
                .col_axes
                .push(id_map.col_axes[sheet_idx].clone());
            sheet_id_map.identities.extend(
                id_map
                    .identities
                    .iter()
                    .filter(|(sid, _, _, _)| *sid == id_map.sheet_ids[sheet_idx])
                    .copied(),
            );
            let mut snap_sheets = import::parse_output_to_snapshot::sheet_lowering::convert_sheets(
                std::slice::from_ref(sheet),
                Some(&sheet_id_map),
            );
            let mut snap_sheet = snap_sheets.remove(0);
            import::parse_output_to_snapshot::classifier::classify_sheet_ranges(
                &mut snap_sheet,
                sheet,
                &WorkbookSnapshot::default(),
                None,
                &id_map.row_axes[sheet_idx],
                &id_map.col_axes[sheet_idx],
                &mut allocator,
            );
            for cell in &snap_sheet.cells {
                if let Some(formula) = &cell.formula {
                    let cell_id =
                        cell_types::CellId::from_uuid_str(&cell.cell_id).map_err(|e| {
                            ComputeError::Deserialize {
                                message: format!("imported cell id: {e}"),
                            }
                        })?;
                    formula_cells.push((
                        cell_id,
                        id_map.sheet_ids[sheet_idx],
                        compute_parser::normalize_xlsx_formula(formula),
                    ));
                }
            }
            cell_store.add_sheet(snap_sheet)?;
            sheet.cells.clear();
        }
        profile.counter("sheets", id_map.sheet_ids.len() as u64);
        profile.counter("formulas", formula_cells.len() as u64);
    }

    // Slim snapshot: sheet identities and workbook metadata, no cell grid IR.
    let mut workbook_snap = import::parse_output_to_snapshot::parse_output_to_workbook_snapshot(
        &parse_output,
        Some(&id_map),
        &mut allocator,
    );
    id_map.install_snapshot_identities(&mut workbook_snap);
    workbook_snap.canonical_tables = id_map.canonical_tables;
    workbook_snap.tables.clear();
    allocator.stamp_snapshot_counters(&mut workbook_snap);
    cell_store.install_imported_workbook_defs(&workbook_snap);
    Ok((
        storage,
        workbook_snap,
        import_report,
        imported_formats,
        cell_store,
        formula_cells,
    ))
}
