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
    from_xlsx_bytes_with_layout(
        xlsx_data,
        domain_types::units::LayoutMetrics::default(),
        on_chunk,
    )
}

fn from_xlsx_bytes_with_layout(
    xlsx_data: &[u8],
    layout_metrics: domain_types::units::LayoutMetrics,
    on_chunk: impl FnMut(&xlsx_parser::StreamLoadStats, &CellStore) + 'static,
) -> Result<(ComputeEngine, RecalcResult), ComputeError> {
    LOAD_PROGRESS.with(|slot| *slot.borrow_mut() = Some(Box::new(on_chunk)));
    let result = from_xlsx_bytes_inner(xlsx_data, layout_metrics);
    LOAD_PROGRESS.with(|slot| *slot.borrow_mut() = None);
    result
}

fn from_xlsx_bytes_inner(
    xlsx_data: &[u8],
    layout_metrics: domain_types::units::LayoutMetrics,
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

    let mut engine = super::assembly::assemble_engine_with_layout_metrics(
        storage,
        cell_store,
        compute,
        &workbook_snap,
        layout_metrics,
    )?;
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
    let char_code_page = engine.cell_store.char_code_page;
    let (mut loaded, recalc) =
        from_xlsx_bytes_with_layout(xlsx_data, engine.stores.layout_metrics, |_, _| {})?;
    loaded.cell_store.char_code_page = char_code_page;
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
    let streamed_array_refs = Rc::new(RefCell::new(Vec::<Vec<(u32, u32, String)>>::new()));
    let streamed_formula_props = Rc::new(RefCell::new(Vec::<Vec<(u32, u32, u8, bool)>>::new()));
    let streamed_cell_formulas = Rc::new(RefCell::new(Vec::<
        Vec<(u32, u32, ooxml_types::worksheet::CellFormula)>,
    >::new()));
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
                let array_refs = streamed_array_refs.clone();
                let formula_props = streamed_formula_props.clone();
                let cell_formulas = streamed_cell_formulas.clone();
                xlsx_parser::set_stream_resolved_hook(
                    move |sheet_idx,
                          row,
                          col,
                          value,
                          formula,
                          cached_value_type,
                          array_ref,
                          has_empty_cached_value,
                          cell_formula| {
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
                        if cached_value_type != 0 || has_empty_cached_value {
                            let mut props = formula_props.borrow_mut();
                            while props.len() <= sheet_idx {
                                props.push(Vec::new());
                            }
                            props[sheet_idx].push((
                                row,
                                col,
                                cached_value_type,
                                has_empty_cached_value,
                            ));
                        }
                        let current_null = store
                            .get_cell_value(&cell_id)
                            .is_none_or(value_types::CellValue::is_null);
                        if current_null {
                            let parsed = match cached_value_type {
                                xlsx_parser::CELL_TYPE_FORMULA_STRING
                                | xlsx_parser::CELL_TYPE_STRING => Some(
                                    value_types::CellValue::from(value.unwrap_or("").to_string()),
                                ),
                                xlsx_parser::CELL_TYPE_BOOL => {
                                    value.and_then(|value| match value {
                                        "1" | "TRUE" | "true" => {
                                            Some(value_types::CellValue::Boolean(true))
                                        }
                                        "0" | "FALSE" | "false" => {
                                            Some(value_types::CellValue::Boolean(false))
                                        }
                                        _ => None,
                                    })
                                }
                                xlsx_parser::CELL_TYPE_ERROR => value.map(|value| {
                                    value
                                        .parse::<value_types::CellError>()
                                        .ok()
                                        .map(value_types::CellValue::from)
                                        .unwrap_or_else(|| {
                                            value_types::CellValue::from(value.to_string())
                                        })
                                }),
                                _ => value.filter(|value| !value.is_empty()).map(|value| {
                                    if value.eq_ignore_ascii_case("true") {
                                        value_types::CellValue::Boolean(true)
                                    } else if value.eq_ignore_ascii_case("false") {
                                        value_types::CellValue::Boolean(false)
                                    } else if let Ok(err) = value.parse::<value_types::CellError>()
                                    {
                                        value_types::CellValue::from(err)
                                    } else {
                                        value
                                            .parse::<f64>()
                                            .ok()
                                            .map(value_types::CellValue::number)
                                            .unwrap_or_else(|| {
                                                value_types::CellValue::from(value.to_string())
                                            })
                                    }
                                }),
                            };
                            if let Some(parsed) = parsed {
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
                        if let Some(array_ref) = array_ref {
                            let mut refs = array_refs.borrow_mut();
                            while refs.len() <= sheet_idx {
                                refs.push(Vec::new());
                            }
                            refs[sheet_idx].push((row, col, array_ref.to_string()));
                        }
                        if let Some(cell_formula) = cell_formula {
                            let mut formulas = cell_formulas.borrow_mut();
                            while formulas.len() <= sheet_idx {
                                formulas.push(Vec::new());
                            }
                            formulas[sheet_idx].push((row, col, cell_formula.clone()));
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
    let streamed_array_refs = match Rc::try_unwrap(streamed_array_refs) {
        Ok(cell) => cell.into_inner(),
        Err(rc) => rc.borrow().clone(),
    };
    let streamed_formula_props = match Rc::try_unwrap(streamed_formula_props) {
        Ok(cell) => cell.into_inner(),
        Err(rc) => rc.borrow().clone(),
    };
    let streamed_cell_formulas = match Rc::try_unwrap(streamed_cell_formulas) {
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
            let mut extra_anchored: rustc_hash::FxHashSet<(u32, u32)> = formula_cells
                .iter()
                .filter(|(_, formula_sheet, _)| *formula_sheet == sheet_id)
                .filter_map(|(cell_id, _, _)| {
                    cell_store
                        .get_sheet(&sheet_id)
                        .and_then(|store_sheet| store_sheet.position_of(cell_id))
                        .map(|pos| (pos.row(), pos.col()))
                })
                .collect();
            extra_anchored.extend(sheet.cells.iter().filter_map(|cell| {
                let keep_identity = cell.vm.is_some()
                    || cell.cell_metadata_index.is_some()
                    || cell.array_ref.is_some()
                    || cell.cell_formula.is_some()
                    || cell.rich_string.is_some()
                    || cell.imported_rich_error.is_some()
                    || cell.formula.is_some();
                keep_identity.then_some((cell.row, cell.col))
            }));
            for table in &sheet.tables {
                if !table.has_headers {
                    continue;
                }
                let Some(range) = compute_parser::parse_a1_range(&table.range_ref) else {
                    continue;
                };
                let (
                    formula_types::CellRef::Positional {
                        row: start_row,
                        col: start_col,
                        ..
                    },
                    formula_types::CellRef::Positional {
                        row: end_row,
                        col: end_col,
                        ..
                    },
                ) = (range.start, range.end)
                else {
                    continue;
                };
                let header_row = start_row.min(end_row);
                let left = start_col.min(end_col);
                let right = start_col.max(end_col);
                for col in left..=right {
                    extra_anchored.insert((header_row, col));
                }
            }
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
                let parse_styles: Vec<(u32, u32, u32)> = sheet
                    .cells
                    .iter()
                    .filter_map(|cell| cell.style_id.map(|style| (cell.row, cell.col, style)))
                    .collect();
                let streamed = streamed_styles
                    .get(sheet_idx)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                let styles = if parse_styles.is_empty() {
                    streamed
                } else {
                    parse_styles.as_slice()
                };
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

    let formula_ids: rustc_hash::FxHashSet<cell_types::CellId> = formula_cells
        .iter()
        .map(|(cell_id, _, _)| *cell_id)
        .collect();
    let formula_by_id: rustc_hash::FxHashMap<cell_types::CellId, String> = formula_cells
        .iter()
        .map(|(cell_id, _, formula)| (*cell_id, formula.clone()))
        .collect();
    for (sheet_idx, sheet) in parse_output.sheets.iter_mut().enumerate() {
        let style_map: std::collections::HashMap<(u32, u32), u32> = streamed_styles
            .get(sheet_idx)
            .into_iter()
            .flatten()
            .map(|&(row, col, style)| ((row, col), style))
            .collect();
        let array_map: std::collections::HashMap<(u32, u32), String> = streamed_array_refs
            .get(sheet_idx)
            .into_iter()
            .flatten()
            .map(|(row, col, array_ref)| ((*row, *col), array_ref.clone()))
            .collect();
        let formula_prop_map: std::collections::HashMap<(u32, u32), (u8, bool)> =
            streamed_formula_props
                .get(sheet_idx)
                .into_iter()
                .flatten()
                .map(|&(row, col, cached_type, has_empty)| ((row, col), (cached_type, has_empty)))
                .collect();
        let cell_formula_map: std::collections::HashMap<
            (u32, u32),
            ooxml_types::worksheet::CellFormula,
        > = streamed_cell_formulas
            .get(sheet_idx)
            .into_iter()
            .flatten()
            .map(|(row, col, formula)| ((*row, *col), formula.clone()))
            .collect();
        let mut parse_meta: rustc_hash::FxHashMap<(u32, u32), domain_types::CellData> = sheet
            .cells
            .drain(..)
            .map(|cell| ((cell.row, cell.col), cell))
            .collect();
        let mut rebuilt = Vec::with_capacity(allocations[sheet_idx].existing_identities.len());
        for (cell_id, row, col) in &allocations[sheet_idx].existing_identities {
            let mut cell = parse_meta.remove(&(*row, *col)).unwrap_or_else(|| {
                domain_types::CellData {
                    row: *row,
                    col: *col,
                    ..Default::default()
                }
            });
            cell.row = *row;
            cell.col = *col;
            if cell.style_id.is_none() {
                cell.style_id = style_map.get(&(*row, *col)).copied();
            }
            if cell.array_ref.is_none() {
                cell.array_ref = array_map.get(&(*row, *col)).cloned();
            }
            if cell.array_ref.is_some() && cell.formula.is_none() {
                cell.formula = formula_by_id.get(cell_id).cloned();
            }
            if cell.cell_formula.is_none() {
                cell.cell_formula = cell_formula_map.get(&(*row, *col)).cloned();
            }
            if let Some(&(cached_type, has_empty)) = formula_prop_map.get(&(*row, *col)) {
                if cached_type != 0 {
                    cell.formula_result_type = Some(cached_type);
                }
                cell.has_empty_cached_value |= has_empty;
            }
            let is_blank = cell_store
                .get_cell_value(cell_id)
                .is_none_or(value_types::CellValue::is_null)
                && !formula_ids.contains(cell_id)
                && cell.array_ref.is_none()
                && !cell.has_empty_cached_value
                && cell.formula_result_type.is_none();
            if is_blank
                && cell.original_value.is_none()
                && cell.projection_role
                    != domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget
            {
                cell.original_value = Some(String::new());
            }
            if cell.projection_role
                == domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget
            {
                if cell.style_id.is_none() {
                    cell.original_value = None;
                    cell.has_empty_cached_value = false;
                    cell.formula_result_type = None;
                }
            } else {
                let store_null = cell_store
                    .get_cell_value(cell_id)
                    .is_none_or(value_types::CellValue::is_null);
                if store_null || cell.imported_rich_error.is_some() {
                    cell_store.set_value_mut(cell_id, cell.value.clone());
                }
            }
            rebuilt.push(cell);
        }
        sheet.cells = rebuilt;
    }

    for (sheet_idx, sheet) in parse_output.sheets.iter().enumerate() {
        let sheet_id = allocations[sheet_idx].sheet_id;
        for (cell, (cell_id, _, _)) in sheet
            .cells
            .iter()
            .zip(allocations[sheet_idx].existing_identities.iter())
        {
            if cell.projection_role
                == domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget
            {
                cell_store.remove_cell(cell_id);
                cell_store.register_identity_position(
                    sheet_id,
                    cell_types::SheetPos::new(cell.row, cell.col),
                    *cell_id,
                );
                continue;
            }
            let Some(array_ref) = cell.array_ref.as_deref() else {
                continue;
            };
            let Some(range) = compute_parser::parse_a1_range(array_ref) else {
                continue;
            };
            let (
                formula_types::CellRef::Positional {
                    row: start_row,
                    col: start_col,
                    ..
                },
                formula_types::CellRef::Positional {
                    row: end_row,
                    col: end_col,
                    ..
                },
            ) = (range.start, range.end)
            else {
                continue;
            };
            let rows = start_row.abs_diff(end_row) + 1;
            let cols = start_col.abs_diff(end_col) + 1;
            if rows > 1 || cols > 1 {
                cell_store.projection_registry.register(
                    *cell_id,
                    sheet_id,
                    start_row.min(end_row),
                    start_col.min(end_col),
                    rows,
                    cols,
                );
            } else {
                cell_store.cse_single_cell.insert(*cell_id);
            }
            if cell.projection_role == domain_types::ImportedCellProjectionRole::DynamicArraySource
            {
                cell_store.cse_single_cell.remove(cell_id);
            } else {
                cell_store.cse_anchors.insert(*cell_id);
            }
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
    for &(sheet_id, cell_id, row, col) in &id_map.identities {
        let pos = cell_types::SheetPos::new(row, col);
        if cell_store
            .get_sheet(&sheet_id)
            .and_then(|sheet| sheet.authored_cell_id_at(pos))
            .is_some()
        {
            continue;
        }
        cell_store.register_identity_position(sheet_id, pos, cell_id);
    }
    Ok((
        storage,
        workbook_snap,
        import_report,
        imported_formats,
        cell_store,
        formula_cells,
    ))
}
