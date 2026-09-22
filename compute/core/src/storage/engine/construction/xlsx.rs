use super::*;
mod stream;
use stream::NativeCellSink;

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
    on_chunk: impl FnMut(&xlsx_parser::StreamLoadStats, &CellStore),
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
    on_chunk: impl FnMut(&xlsx_parser::StreamLoadStats, &CellStore),
) -> Result<(ComputeEngine, RecalcResult), ComputeError> {
    let mut on_chunk = on_chunk;
    let (
        storage,
        workbook_snap,
        import_report,
        imported_formats,
        mut cell_store,
        formula_cells,
        stats,
    ) = parse_and_hydrate_xlsx(xlsx_data, &mut on_chunk)?;

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
    engine.stream_load_stats = stats;
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
    recalc_mode: XlsxRecalculation,
) -> Result<RecalcResult, ComputeError> {
    let char_code_page = engine.cell_store.char_code_page;
    let (mut loaded, recalc) =
        from_xlsx_bytes_with_layout(xlsx_data, engine.stores.layout_metrics, |_, _| {})?;
    loaded.cell_store.char_code_page = char_code_page;
    let result = match recalc_mode {
        XlsxRecalculation::Never => recalc,
        XlsxRecalculation::Always => loaded.recalculate()?,
        XlsxRecalculation::OnLoad => loaded.recalculate_on_import_open()?,
    };
    engine.cell_store = loaded.cell_store;
    engine.stores = loaded.stores;
    engine.viewport = loaded.viewport;
    engine.settings = loaded.settings;
    engine.import_report = loaded.import_report;
    engine.runtime_diagnostics = loaded.runtime_diagnostics;
    engine.version_runtime_operation_context = loaded.version_runtime_operation_context;
    engine.scenario_session = loaded.scenario_session;
    engine.stream_load_stats = loaded.stream_load_stats;
    engine.clear_runtime_diagnostics();

    Ok(result)
}

/// Parse the workbook once and hydrate native metadata with the identities
/// used by the snapshot's sparse cells and compact ranges.
pub(in crate::storage::engine) fn parse_and_hydrate_xlsx(
    xlsx_data: &[u8],
    progress: &mut dyn FnMut(&xlsx_parser::StreamLoadStats, &CellStore),
) -> Result<XlsxStreamHydrateResult, ComputeError> {
    use crate::import;
    use crate::storage::infra::hydration::DefaultIdAllocator;
    let mut sink = NativeCellSink::new(progress);
    let (mut parse_output, diagnostics) =
        xlsx_parser::parse_xlsx_to_output_with_sink(xlsx_data, &mut sink).map_err(|error| {
            ComputeError::Deserialize {
                message: format!("XLSX parse error: {error}"),
            }
        })?;
    let import_report = diagnostics.clone().into_import_report();
    let NativeCellSink {
        store: mut cell_store,
        sheets: mut stream_sheet_ids,
        stats,
        ..
    } = sink;
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

    let formula_cells: Vec<_> = parse_output
        .sheets
        .iter()
        .enumerate()
        .flat_map(|(idx, sheet)| {
            let sheet_id = stream_sheet_ids[idx];
            sheet
                .cells
                .iter()
                .filter_map(|cell| {
                    let formula = cell.formula.as_deref()?;
                    let cell_id = cell_store
                        .get_sheet(&sheet_id)?
                        .authored_cell_id_at(cell_types::SheetPos::new(cell.row, cell.col))?;
                    Some((
                        cell_id,
                        sheet_id,
                        compute_parser::normalize_xlsx_formula(formula),
                    ))
                })
                .collect::<Vec<_>>()
        })
        .collect();

    // Workbook metadata can enrich scalar error caches. Install those final
    // values before chart fingerprints read their source cells.
    for (sheet_index, sheet) in parse_output.sheets.iter().enumerate() {
        let sheet_id = stream_sheet_ids[sheet_index];
        for cell in sheet
            .cells
            .iter()
            .filter(|cell| cell.imported_rich_error.is_some())
        {
            let id = cell_store
                .get_sheet(&sheet_id)
                .and_then(|sheet| {
                    sheet.authored_cell_id_at(cell_types::SheetPos::new(cell.row, cell.col))
                })
                .expect("rich-error metadata keeps its streamed identity");
            cell_store.set_value_mut(&id, cell.value.clone());
        }
    }

    xlsx_parser::refresh_chart_source_fingerprints(
        &mut parse_output.sheets,
        |sheets, ranges, emit| {
            for (index, sheet_id) in stream_sheet_ids.iter().enumerate() {
                let sheet = cell_store.get_sheet(sheet_id).expect("streamed sheet");
                let name = sheets[index].name.replace("''", "'").to_lowercase();
                for (id, row, col) in sheet.cells() {
                    if ranges
                        .iter()
                        .any(|range| range.sheet_name == name && range.contains(row, col))
                    {
                        if let Some(value) = cell_store.get_cell_value(&id) {
                            let cells = &sheets[index].cells;
                            let formula = cells
                                .binary_search_by_key(&(row, col), |cell| (cell.row, cell.col))
                                .ok()
                                .and_then(|idx| cells[idx].formula.as_deref())
                                .unwrap_or_default();
                            emit(&name, row, col, formula, value);
                        }
                    }
                }
            }
        },
    );

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
                    allocation.cell_ids = sheet
                        .cells
                        .iter()
                        .map(|cell| {
                            store_sheet
                                .authored_cell_id_at(cell_types::SheetPos::new(cell.row, cell.col))
                                .expect("metadata cell was streamed")
                        })
                        .collect();
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
                let keep_identity = cell.projection_role
                    == domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget
                    || cell.vm.is_some()
                    || cell.cell_metadata_index.is_some()
                    || cell.array_ref.is_some()
                    || cell.cell_formula.is_some()
                    || cell.rich_string.is_some()
                    || cell.imported_rich_error.is_some()
                    || cell.formula.is_some()
                    || (matches!(cell.value, value_types::CellValue::Number(_))
                        && cell.original_value.is_some())
                    || cell.original_sst_index.is_some()
                    || cell.date_lexical_value.is_some()
                    || cell.phonetic;
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
                allocations[sheet_idx].existing_identities = remaining;
            }
            if range_style_formats_enabled() {
                let parse_styles: Vec<(u32, u32, u32)> = sheet
                    .cells
                    .iter()
                    .filter_map(|cell| cell.style_id.map(|style| (cell.row, cell.col, style)))
                    .collect();
                let styles = parse_styles.as_slice();
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
        let sheet_id = stream_sheet_ids[sheet_idx];
        sheet
            .cells
            .retain(|cell| !ranged_positions[sheet_idx].contains(&(cell.row, cell.col)));
        allocations[sheet_idx].cell_ids = sheet
            .cells
            .iter()
            .map(|cell| {
                cell_store
                    .get_sheet(&sheet_id)
                    .and_then(|sheet| {
                        sheet.authored_cell_id_at(cell_types::SheetPos::new(cell.row, cell.col))
                    })
                    .expect("retained metadata keeps its streamed identity")
            })
            .collect();
    }

    for (sheet_idx, sheet) in parse_output.sheets.iter().enumerate() {
        let sheet_id = allocations[sheet_idx].sheet_id;
        for (cell, cell_id) in sheet
            .cells
            .iter()
            .zip(allocations[sheet_idx].cell_ids.iter())
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
        stats,
    ))
}
