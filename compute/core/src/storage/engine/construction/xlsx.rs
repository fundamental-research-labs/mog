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

fn from_xlsx_bytes_inner(xlsx_data: &[u8]) -> Result<(ComputeEngine, RecalcResult), ComputeError> {
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
    let streamed_formulas = Rc::new(RefCell::new(
        Vec::<(cell_types::CellId, SheetId, String)>::new(),
    ));
    let streamed_styles = Rc::new(RefCell::new(Vec::<Vec<(u32, u32, u32)>>::new()));
    let parsed = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "parse");
        let store = live_store.clone();
        let ids = stream_sheet_ids.clone();
        let styles = streamed_styles.clone();
        let parsed = xlsx_parser::with_stream_cell_hook(
            move |sheet_idx, cell, strings, stats| {
                let mut store = store.borrow_mut();
                let mut ids = ids.borrow_mut();
                while ids.len() <= sheet_idx {
                    let name = format!("__stream{}", ids.len());
                    let sheet_id = store.open_stream_sheet(&name);
                    ids.push(sheet_id);
                }
                if cell.style_idx > 0 {
                    let mut styles = styles.borrow_mut();
                    while styles.len() <= sheet_idx {
                        styles.push(Vec::new());
                    }
                    styles[sheet_idx].push((cell.row, cell.col, cell.style_idx as u32));
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
                xlsx_parser::set_stream_resolved_hook(
                    move |sheet_idx, row, col, value, formula| {
                        let mut store = store.borrow_mut();
                        let ids = ids.borrow();
                        let Some(&sheet_id) = ids.get(sheet_idx) else {
                            return;
                        };
                        let Some(cell_id) = store.get_sheet(&sheet_id).and_then(|sheet| {
                            sheet.authored_cell_id_at(cell_types::SheetPos::new(row, col))
                        }) else {
                            return;
                        };
                        if let Some(value) = value {
                            let current_null = store
                                .get_cell_value(&cell_id)
                                .is_none_or(value_types::CellValue::is_null);
                            if current_null && !value.is_empty() {
                                let parsed = if value.eq_ignore_ascii_case("true") {
                                    value_types::CellValue::Boolean(true)
                                } else if value.eq_ignore_ascii_case("false") {
                                    value_types::CellValue::Boolean(false)
                                } else if let Ok(err) = value.parse::<value_types::CellError>() {
                                    value_types::CellValue::from(err)
                                } else {
                                    value
                                        .parse::<f64>()
                                        .ok()
                                        .map(value_types::CellValue::number)
                                        .unwrap_or_else(|| {
                                            value_types::CellValue::from(value.to_string())
                                        })
                                };
                                store.set_value_mut(&cell_id, parsed);
                            }
                        }
                        if let Some(formula) = formula {
                            formulas.borrow_mut().push((
                                cell_id,
                                sheet_id,
                                compute_parser::normalize_xlsx_formula(formula),
                            ));
                        }
                    },
                );
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
    let mut stream_sheet_ids = match Rc::try_unwrap(stream_sheet_ids) {
        Ok(cell) => cell.into_inner(),
        Err(rc) => rc.borrow().clone(),
    };
    let formula_cells = match Rc::try_unwrap(streamed_formulas) {
        Ok(cell) => cell.into_inner(),
        Err(rc) => rc.borrow().clone(),
    };
    let streamed_styles = match Rc::try_unwrap(streamed_styles) {
        Ok(cell) => cell.into_inner(),
        Err(rc) => rc.borrow().clone(),
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

    while stream_sheet_ids.len() < parse_output.sheets.len() {
        let idx = stream_sheet_ids.len();
        let name = parse_output.sheets[idx].name.clone();
        stream_sheet_ids.push(cell_store.open_stream_sheet(&name));
    }
    for (idx, sheet) in parse_output.sheets.iter_mut().enumerate() {
        let sheet_id = stream_sheet_ids[idx];
        cell_store.rename_sheet(&sheet_id, &sheet.name);
        if let Some(store_sheet) = cell_store.get_sheet_mut(&sheet_id) {
            store_sheet.grid_rows = sheet.rows.max(store_sheet.rows);
            store_sheet.grid_cols = sheet.cols.max(store_sheet.cols);
            sheet.rows = sheet
                .rows
                .max(store_sheet.rows)
                .max(store_sheet.identity_rows);
            sheet.cols = sheet
                .cols
                .max(store_sheet.cols)
                .max(store_sheet.identity_cols);
        }
    }

    // ── Pass 1: Allocate native identities onto streamed sheets ─────
    let mut allocator = DefaultIdAllocator::with_shared(cell_store.identity_allocator());
    let mut allocations: Vec<_> = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "id_allocation");
        let allocations: Vec<_> = parse_output
            .sheets
            .iter()
            .enumerate()
            .map(|(idx, sheet)| {
                let sheet_id = stream_sheet_ids[idx];
                let mut allocation =
                    crate::storage::infra::hydration::allocate_sheet_ids_after_sheet_id(
                        sheet,
                        &mut allocator,
                        sheet_id,
                    );
                if let Some(store_sheet) = cell_store.get_sheet(&sheet_id) {
                    let mut existing: Vec<_> = store_sheet.cells().collect();
                    existing.sort_by_key(|&(_, row, col)| (row, col));
                    let occupied: std::collections::HashSet<_> =
                        existing.iter().map(|&(_, row, col)| (row, col)).collect();
                    allocation
                        .identity_only_cells
                        .retain(|identity| !occupied.contains(&(identity.row, identity.col)));
                    allocation.cell_ids = existing.iter().map(|(id, _, _)| *id).collect();
                    allocation.existing_identities = existing;
                }
                allocation
            })
            .collect();
        profile.counter("sheets", allocations.len() as u64);
        allocations
    };

    for alloc in &allocations {
        cell_store.rebind_sheet_axes(
            alloc.sheet_id,
            alloc.row_axis.clone(),
            alloc.col_axis.clone(),
        );
    }

    let mut ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_style_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_styles_per_sheet: Vec<Vec<crate::storage::infra::hydration::ImportedRangeStyle>> =
        Vec::with_capacity(parse_output.sheets.len());
    {
        for (sheet_idx, sheet) in parse_output.sheets.iter().enumerate() {
            let sheet_id = allocations[sheet_idx].sheet_id;
            let extra_anchored: rustc_hash::FxHashSet<(u32, u32)> = formula_cells
                .iter()
                .filter(|(_, formula_sheet, _)| *formula_sheet == sheet_id)
                .filter_map(|(cell_id, _, _)| {
                    cell_store
                        .get_sheet(&sheet_id)
                        .and_then(|store_sheet| store_sheet.position_of(cell_id))
                        .map(|pos| (pos.row(), pos.col()))
                })
                .collect();
            let (ranges, ranged) =
                import::parse_output_to_snapshot::classifier::classify_store_sheet_ranges(
                    &cell_store,
                    sheet_id,
                    sheet,
                    &WorkbookSnapshot::default(),
                    &allocations[sheet_idx].row_axis,
                    &allocations[sheet_idx].col_axis,
                    &mut allocator,
                    &extra_anchored,
                );
            let to_remove: Vec<_> = ranged
                .iter()
                .filter_map(|&(row, col)| {
                    cell_store.get_sheet(&sheet_id).and_then(|store_sheet| {
                        store_sheet.authored_cell_id_at(cell_types::SheetPos::new(row, col))
                    })
                })
                .collect();
            for cell_id in to_remove {
                cell_store.remove_cell(&cell_id);
            }
            cell_store.install_imported_ranges(sheet_id, &ranges)?;
            if let Some(store_sheet) = cell_store.get_sheet(&sheet_id) {
                let mut remaining: Vec<_> = store_sheet.cells().collect();
                remaining.sort_by_key(|&(_, row, col)| (row, col));
                allocations[sheet_idx].cell_ids = remaining.iter().map(|(id, _, _)| *id).collect();
                allocations[sheet_idx].existing_identities = remaining;
            }
            if range_style_formats_enabled() {
                let styles = streamed_styles
                    .get(sheet_idx)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                let (style_positions, range_styles) = build_imported_range_style_plan(
                    styles,
                    &allocations[sheet_idx],
                    &ranges,
                    &mut allocator,
                );
                range_style_positions.push(style_positions);
                range_styles_per_sheet.push(range_styles);
            } else {
                range_style_positions.push(std::collections::HashSet::new());
                range_styles_per_sheet.push(Vec::new());
            }
            ranged_positions.push(ranged.into_iter().collect());
        }
    }

    for (sheet_idx, sheet) in parse_output.sheets.iter_mut().enumerate() {
        let style_map: std::collections::HashMap<(u32, u32), u32> = streamed_styles
            .get(sheet_idx)
            .into_iter()
            .flatten()
            .map(|&(row, col, style)| ((row, col), style))
            .collect();
        sheet.cells = allocations[sheet_idx]
            .existing_identities
            .iter()
            .map(|(_, row, col)| domain_types::CellData {
                row: *row,
                col: *col,
                style_id: style_map.get(&(*row, *col)).copied(),
                ..Default::default()
            })
            .collect();
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
