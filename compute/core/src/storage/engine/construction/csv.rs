use super::*;

// ---------------------------------------------------------------------------
// CSV import helpers
// ---------------------------------------------------------------------------
//
// CSV produces a `ParseOutput` (one sheet, 4-entry style palette, per-cell
// `style_id`) rather than its own intermediate IR. The hydration path is
// the same Range-before-Yrs pipeline as XLSX: allocate IDs →
// `parse_output_to_workbook_snapshot` with range classification →
// `hydrate_from_parse_output_with_ranges` → `rebuild_engine_from_snapshot`.
//
// CSV warnings flow through `tracing::warn!` (matching the XLSX
// diagnostics-handling pattern at the top of `parse_and_hydrate_xlsx`);
// they do NOT cross the bridge as TS errors.

/// Parse CSV bytes and hydrate a new `YrsStorage` from the parse output.
pub(in crate::storage::engine) fn parse_and_hydrate_csv(
    csv_data: &[u8],
    options: &csv_parser::CsvImportOptions,
) -> Result<XlsxHydrateResult, ComputeError> {
    use crate::import;
    use crate::storage::infra::hydration::{DefaultIdAllocator, allocate_sheet_ids};

    let t0 = crate::time_compat::WasmSafeInstant::now();
    let parsed = csv_parser::parse_csv_to_parse_output(csv_data, options.clone()).map_err(|e| {
        ComputeError::Deserialize {
            message: format!("CSV parse error: {}", e),
        }
    })?;
    let parse_output = parsed.output;
    eprintln!("[construction] csv parse: {}ms", t0.elapsed().as_millis());

    if !parsed.warnings.is_empty() {
        // Surface CSV warnings via tracing (matches XLSX diagnostics
        // handling). EncodingFallback means chardetng chose a non-UTF-8
        // encoding — this is informational, not a hard error, because
        // chardetng can misdetect valid UTF-8 CSVs (e.g. those with
        // BOM-less ASCII-only content). The file is still loaded with
        // the detected encoding; invalid sequences become U+FFFD.
        tracing::warn!(
            warning_count = parsed.warnings.len(),
            detected_encoding = %parsed.detected_encoding,
            detected_delimiter = %parsed.detected_delimiter,
            "CSV import produced warnings"
        );
        for warning in &parsed.warnings {
            tracing::warn!(?warning, "CSV warning");
        }
    }

    let mut allocator = DefaultIdAllocator::new();
    let allocations: Vec<_> = parse_output
        .sheets
        .iter()
        .map(|sheet| allocate_sheet_ids(sheet, &mut allocator))
        .collect();

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

    let t1 = crate::time_compat::WasmSafeInstant::now();
    let workbook_snap = import::parse_output_to_snapshot::parse_output_to_workbook_snapshot(
        &parse_output,
        Some(&id_map),
        &mut allocator,
    );
    eprintln!(
        "[construction] csv snapshot: {}ms",
        t1.elapsed().as_millis()
    );

    let t2 = crate::time_compat::WasmSafeInstant::now();
    let mut ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_data_per_sheet: Vec<Vec<snapshot_types::RangeData>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_style_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_styles_per_sheet: Vec<Vec<crate::storage::infra::hydration::ImportedRangeStyle>> =
        Vec::with_capacity(parse_output.sheets.len());

    for (sheet_idx, sheet_data) in parse_output.sheets.iter().enumerate() {
        let snap_sheet = &workbook_snap.sheets[sheet_idx];
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

    let (storage, id_map) = {
        let mut storage = YrsStorage::new();
        let id_map = storage.hydrate_from_parse_output_with_ranges(
            &parse_output,
            &allocations,
            &ranged_positions,
            &range_style_positions,
            &range_data_per_sheet,
            &range_styles_per_sheet,
            &mut allocator,
        )?;
        (storage, id_map)
    };
    eprintln!("[construction] csv hydrate: {}ms", t2.elapsed().as_millis());

    Ok((storage, workbook_snap, id_map.phantom_cells))
}

/// Construct a `YrsComputeEngine` from raw CSV bytes without recalculation.
pub(in crate::storage::engine) fn from_csv_bytes(
    csv_data: &[u8],
    options: &csv_parser::CsvImportOptions,
) -> Result<(YrsComputeEngine, RecalcResult), ComputeError> {
    let (storage, workbook_snap, phantom_cells) = parse_and_hydrate_csv(csv_data, options)?;

    let mut mirror = CellMirror::from_snapshot(workbook_snap.clone())?;
    let mut compute = ComputeCore::new();
    let recalc_result = compute.init_from_snapshot_no_recalc(&mut mirror, workbook_snap.clone())?;

    let mut engine = assemble_engine(storage, mirror, compute, &workbook_snap)?;

    for (sheet_id, cell_id, row, col) in phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(&sheet_id) {
            grid.register_cell(cell_id, row, col);
        }
    }

    Ok((engine, recalc_result))
}

/// Import from raw CSV bytes into an existing engine, with or without recalc.
pub(in crate::storage::engine) fn import_from_csv_bytes(
    engine: &mut YrsComputeEngine,
    csv_data: &[u8],
    options: &csv_parser::CsvImportOptions,
    do_recalc: bool,
) -> Result<RecalcResult, ComputeError> {
    let (storage, workbook_snap, phantom_cells) = parse_and_hydrate_csv(csv_data, options)?;
    let result = rebuild_engine_from_snapshot(engine, storage, workbook_snap, do_recalc)?;
    for (sheet_id, cell_id, row, col) in phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(&sheet_id) {
            grid.register_cell(cell_id, row, col);
        }
    }
    Ok(result)
}
