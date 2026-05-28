use super::*;

/// Construct a `YrsComputeEngine` from raw XLSX bytes without recalculation.
pub(in crate::storage::engine) fn from_xlsx_bytes(
    xlsx_data: &[u8],
) -> Result<(YrsComputeEngine, RecalcResult), ComputeError> {
    let (storage, workbook_snap, phantom_cells) = parse_and_hydrate_xlsx(xlsx_data)?;

    let (mirror, compute, recalc_result) = {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "mirror_compute_rebuild");
        let mut mirror = CellMirror::from_snapshot(workbook_snap.clone())?;
        let mut compute = ComputeCore::new();
        let recalc_result =
            compute.init_from_snapshot_no_recalc(&mut mirror, workbook_snap.clone())?;
        profile.counter("sheets", workbook_snap.sheets.len() as u64);
        profile.counter(
            "snapshot_cells",
            workbook_snap
                .sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        (mirror, compute, recalc_result)
    };

    let mut engine = assemble_engine(storage, mirror, compute, &workbook_snap)?;

    // Register physical phantom cells (created during hydration for merges and
    // hyperlinks on cells with no data) in the GridIndex so position-based
    // lookups can find them.
    for (sheet_id, cell_id, row, col) in phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(&sheet_id) {
            grid.register_cell(cell_id, row, col);
        }
    }

    Ok((engine, recalc_result))
}

/// Import from raw XLSX bytes into an existing engine, with or without recalc.
///
/// Uses the Range-optimized hydration pipeline: the classifier runs BEFORE
/// Yrs cell writes, so ranged cells are written as compact Range entries
/// instead of individual per-cell entries. This keeps the Yrs document small
/// enough for WASM's 4GB memory ceiling.
pub(in crate::storage::engine) fn import_from_xlsx_bytes(
    engine: &mut YrsComputeEngine,
    xlsx_data: &[u8],
    do_recalc: bool,
) -> Result<RecalcResult, ComputeError> {
    let (storage, workbook_snap, phantom_cells) = parse_and_hydrate_xlsx(xlsx_data)?;
    let result = rebuild_engine_from_snapshot(engine, storage, workbook_snap, do_recalc)?;
    for (sheet_id, cell_id, row, col) in phantom_cells {
        if let Some(grid) = engine.stores.grid_indexes.get_mut(&sheet_id) {
            grid.register_cell(cell_id, row, col);
        }
    }
    Ok(result)
}

/// Fast-path XLSX import: parses XLSX, builds snapshot and indexes from
/// parse_output (NO Yrs CRDT hydration). Stores data for deferred hydration.
///
/// This is ~2x faster than `import_from_xlsx_bytes` because it skips the
/// 2-second Yrs hydration step. The engine can display viewport data
/// immediately. Call `complete_deferred_hydration()` after first paint
pub(in crate::storage::engine) fn parse_and_hydrate_xlsx(
    xlsx_data: &[u8],
) -> Result<XlsxHydrateResult, ComputeError> {
    use crate::import;
    use crate::storage::infra::hydration::{DefaultIdAllocator, allocate_sheet_ids};

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
    let parse_output = parsed.output;
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

    // ── Pass 1: Allocate IDs (no Yrs writes) ──────────────────────────
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

    // Build HydrationIdMap from pre-allocations so the snapshot builder
    // can use the same IDs.
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

    // ── Pass 2: Build snapshot + run classifier ───────────────────────
    let workbook_snap = {
        let mut profile =
            crate::xlsx_profile::PhaseTimer::new("import", "parse_output_to_workbook_snapshot");
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
    // ── Pass 3: Collect ranged positions per sheet ────────────────────
    // After the classifier runs, `workbook_snap.sheets[i].ranges` contains
    // the promoted RangeData entries. We need to identify which (row, col)
    // positions were ranged so we can skip them during Yrs cell writes.
    //
    // Only non-empty cells can be ranged (the classifier ignores Null cells).
    // Empty styled cells are already skipped by hydrate_cells_with_ids, so
    // we exclude them from the diff to keep the HashSet small.
    let mut ranged_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_data_per_sheet: Vec<Vec<snapshot_types::RangeData>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_style_positions: Vec<std::collections::HashSet<(u32, u32)>> =
        Vec::with_capacity(parse_output.sheets.len());
    let mut range_styles_per_sheet: Vec<Vec<crate::storage::infra::hydration::ImportedRangeStyle>> =
        Vec::with_capacity(parse_output.sheets.len());
    let range_style_formats_enabled = range_style_formats_enabled();

    {
        let mut profile = crate::xlsx_profile::PhaseTimer::new("import", "ranged_positions");
        for (sheet_idx, sheet_data) in parse_output.sheets.iter().enumerate() {
            let snap_sheet = &workbook_snap.sheets[sheet_idx];

            let snap_positions: std::collections::HashSet<(u32, u32)> =
                snap_sheet.cells.iter().map(|c| (c.row, c.col)).collect();

            // Only check non-empty cells against the snapshot. Empty cells are
            // skipped by hydrate_cells_with_ids regardless of ranged_positions.
            let ranged: std::collections::HashSet<(u32, u32)> = sheet_data
                .cells
                .iter()
                .filter(|c| c.formula.is_some() || !c.value.is_null())
                .map(|c| (c.row, c.col))
                .filter(|pos| !snap_positions.contains(pos))
                .collect();

            ranged_positions.push(ranged);
            let ranges = snap_sheet.ranges.clone();
            if range_style_formats_enabled {
                let (style_positions, range_styles) = build_imported_range_style_plan(
                    sheet_data,
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
            range_data_per_sheet.push(ranges);
        }
        profile.counter("sheets", ranged_positions.len() as u64);
        profile.counter(
            "ranged_positions",
            ranged_positions
                .iter()
                .map(|positions| positions.len() as u64)
                .sum::<u64>(),
        );
        let mut ranged_style_id = 0_u64;
        let mut ranged_original_value = 0_u64;
        let mut ranged_original_sst_index = 0_u64;
        let mut ranged_formula_metadata = 0_u64;
        for (sheet_idx, sheet_data) in parse_output.sheets.iter().enumerate() {
            let ranged = &ranged_positions[sheet_idx];
            for cell in &sheet_data.cells {
                if !ranged.contains(&(cell.row, cell.col)) {
                    continue;
                }
                if cell.style_id.is_some() {
                    ranged_style_id += 1;
                }
                if cell.original_value.is_some() {
                    ranged_original_value += 1;
                }
                if cell.original_sst_index.is_some() {
                    ranged_original_sst_index += 1;
                }
                if cell.formula.is_some()
                    || cell.cell_formula.is_some()
                    || cell.formula_result_type.is_some()
                    || cell.has_empty_cached_value
                {
                    ranged_formula_metadata += 1;
                }
            }
        }
        profile.counter("ranged_style_id", ranged_style_id);
        profile.counter("ranged_original_value", ranged_original_value);
        profile.counter("ranged_original_sst_index", ranged_original_sst_index);
        profile.counter("ranged_formula_metadata", ranged_formula_metadata);
        profile.counter(
            "range_style_positions",
            range_style_positions
                .iter()
                .map(|positions| positions.len() as u64)
                .sum::<u64>(),
        );
        profile.counter(
            "range_styles",
            range_styles_per_sheet
                .iter()
                .map(|styles| styles.len() as u64)
                .sum::<u64>(),
        );
    }

    // ── Pass 4: Hydrate Yrs (skipping ranged cells) ───────────────────
    let (storage, id_map) = {
        let mut profile =
            crate::xlsx_profile::PhaseTimer::new("import", "hydrate_from_parse_output_with_ranges");
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
        storage.hydrate_imported_external_links(&parse_output.external_links)?;
        profile.counter("sheets", parse_output.sheets.len() as u64);
        profile.counter(
            "ranged_positions",
            ranged_positions
                .iter()
                .map(|positions| positions.len() as u64)
                .sum::<u64>(),
        );
        (storage, id_map)
    };

    Ok((storage, workbook_snap, id_map.phantom_cells))
}
