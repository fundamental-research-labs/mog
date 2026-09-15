use super::*;
use std::cell::RefCell;

thread_local! {
    static LOAD_PROGRESS: RefCell<Option<Box<dyn FnMut(&xlsx_parser::StreamLoadStats, &CellStore)>>> =
        RefCell::new(None);
}

/// Construct a `ComputeEngine` from raw XLSX bytes without recalculation.
pub(in crate::storage::engine) fn from_xlsx_bytes(
    xlsx_data: &[u8],
) -> Result<(ComputeEngine, RecalcResult), ComputeError> {
    from_xlsx_bytes_with_progress(xlsx_data, |_, _| {})
}

/// Same as [`from_xlsx_bytes`], invoking `on_chunk` after each streamed cell
/// with the live store (cells already ingested).
pub(in crate::storage::engine) fn from_xlsx_bytes_with_progress(
    xlsx_data: &[u8],
    on_chunk: impl FnMut(&xlsx_parser::StreamLoadStats, &CellStore) + 'static,
) -> Result<(ComputeEngine, RecalcResult), ComputeError> {
    LOAD_PROGRESS.with(|slot| *slot.borrow_mut() = Some(Box::new(on_chunk)));
    let result = from_xlsx_bytes_inner(xlsx_data);
    LOAD_PROGRESS.with(|slot| *slot.borrow_mut() = None);
    result
}

fn from_xlsx_bytes_inner(
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
    use crate::storage::infra::hydration::DefaultIdAllocator;
    use std::rc::Rc;

    let live_store = Rc::new(RefCell::new(CellStore::new()));
    let stream_sheet_ids = Rc::new(RefCell::new(Vec::<SheetId>::new()));
    let streamed_formulas = Rc::new(RefCell::new(Vec::<(cell_types::CellId, SheetId, String)>::new()));
    let parsed = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "parse");
        let store = live_store.clone();
        let ids = stream_sheet_ids.clone();
        let parsed = xlsx_parser::with_stream_cell_hook(
            move |sheet_idx, cell, strings, stats| {
                let mut store = store.borrow_mut();
                let mut ids = ids.borrow_mut();
                while ids.len() <= sheet_idx {
                    let name = format!("__stream{}", ids.len());
                    let sheet_id = store.open_stream_sheet(&name);
                    ids.push(sheet_id);
                }
                let _ = store.ingest_streamed_xlsx_cell(&ids[sheet_idx], cell, strings);
                LOAD_PROGRESS.with(|slot| {
                    if let Some(observer) = slot.borrow_mut().as_mut() {
                        observer(stats, &store);
                    }
                });
            },
            || {
                let store = live_store.clone();
                let ids = stream_sheet_ids.clone();
                let formulas = streamed_formulas.clone();
                xlsx_parser::set_stream_resolved_hook(move |sheet_idx, row, col, value, formula| {
                    let mut store = store.borrow_mut();
                    let ids = ids.borrow();
                    let Some(&sheet_id) = ids.get(sheet_idx) else {
                        return;
                    };
                    let Some(cell_id) = store
                        .get_sheet(&sheet_id)
                        .and_then(|sheet| {
                            sheet.authored_cell_id_at(cell_types::SheetPos::new(row, col))
                        })
                    else {
                        return;
                    };
                    if let Some(value) = value {
                        let parsed = value
                            .parse::<f64>()
                            .ok()
                            .map(value_types::CellValue::number)
                            .unwrap_or_else(|| value_types::CellValue::from(value.to_string()));
                        store.set_value_mut(&cell_id, parsed);
                    }
                    if let Some(formula) = formula {
                        formulas.borrow_mut().push((
                            cell_id,
                            sheet_id,
                            compute_parser::normalize_xlsx_formula(formula),
                        ));
                    }
                });
                xlsx_api::parse(xlsx_data).map_err(|e| ComputeError::Deserialize {
                    message: format!("XLSX parse error: {}", e),
                })
            },
        )?;
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
    let mut cell_store = match Rc::try_unwrap(live_store) {
        Ok(cell) => cell.into_inner(),
        Err(rc) => rc.borrow().clone(),
    };
    let stream_sheet_ids = match Rc::try_unwrap(stream_sheet_ids) {
        Ok(cell) => cell.into_inner(),
        Err(rc) => rc.borrow().clone(),
    };
    let _ = match Rc::try_unwrap(streamed_formulas) {
        Ok(cell) => cell.into_inner(),
        Err(rc) => rc.borrow().clone(),
    };
    for sheet_id in &stream_sheet_ids {
        cell_store.remove_sheet(sheet_id);
    }
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
            .map(|sheet| {
                crate::storage::infra::hydration::allocate_sheet_ids(sheet, &mut allocator)
            })
            .collect();
        profile.counter("sheets", allocations.len() as u64);
        allocations
    };

    let mut formula_cells = Vec::new();
    let mut ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_style_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_styles_per_sheet: Vec<Vec<crate::storage::infra::hydration::ImportedRangeStyle>> =
        Vec::with_capacity(parse_output.sheets.len());
    {
        for (sheet_idx, sheet) in parse_output.sheets.iter_mut().enumerate() {
            let mut sheet_id_map = crate::storage::infra::hydration::HydrationIdMap::default();
            sheet_id_map.sheet_ids.push(allocations[sheet_idx].sheet_id);
            sheet_id_map
                .cell_ids
                .push(allocations[sheet_idx].cell_ids.clone());
            sheet_id_map
                .row_axes
                .push(allocations[sheet_idx].row_axis.clone());
            sheet_id_map
                .col_axes
                .push(allocations[sheet_idx].col_axis.clone());
            for identity in &allocations[sheet_idx].identity_only_cells {
                sheet_id_map.identities.push((
                    allocations[sheet_idx].sheet_id,
                    identity.cell_id,
                    identity.row,
                    identity.col,
                ));
            }
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
                &allocations[sheet_idx].row_axis,
                &allocations[sheet_idx].col_axis,
                &mut allocator,
            );
            let snap_positions: std::collections::HashSet<(u32, u32)> =
                snap_sheet.cells.iter().map(|c| (c.row, c.col)).collect();
            let ranged: std::collections::HashSet<(u32, u32)> = sheet
                .cells
                .iter()
                .filter(|c| c.formula.is_some() || !c.value.is_null())
                .map(|c| (c.row, c.col))
                .filter(|pos| !snap_positions.contains(pos))
                .collect();
            if range_style_formats_enabled() {
                let (style_positions, range_styles) = build_imported_range_style_plan(
                    sheet,
                    &allocations[sheet_idx],
                    &snap_sheet.ranges,
                    &mut allocator,
                );
                range_style_positions.push(style_positions);
                range_styles_per_sheet.push(range_styles);
            } else {
                range_style_positions.push(std::collections::HashSet::new());
                range_styles_per_sheet.push(Vec::new());
            }
            ranged_positions.push(ranged);
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
                        allocations[sheet_idx].sheet_id,
                        compute_parser::normalize_xlsx_formula(formula),
                    ));
                }
            }
            cell_store.add_sheet(snap_sheet)?;
        }
    }

    // ── Pass 3: Hydrate native metadata while sheet cells still exist ─
    let (storage, id_map) = {
        let mut profile =
            crate::xlsx_profile::PhaseTimer::new("import", "hydrate_from_parse_output_with_ranges");
        let mut storage = WorkbookStorage::new();
        let id_map = storage.hydrate_from_parse_output_with_ranges(
            &parse_output,
            &allocations,
            &ranged_positions,
            &range_style_positions,
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
        collect_imported_formats(&parse_output, &id_map.sheet_ids, &range_styles_per_sheet);
    for sheet in &mut parse_output.sheets {
        sheet.cells.clear();
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
