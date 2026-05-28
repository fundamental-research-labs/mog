use super::*;

pub(super) fn get_cell_format(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    cell_id: &CellId,
    row: u32,
    col: u32,
) -> CellFormat {
    let cell_hex = id_to_hex(cell_id.as_u128());
    let table_fmt =
        services::tables::resolve_table_format_at_cell(&engine.mirror, sheet_id, row, col);
    properties::get_effective_format(
        &engine.stores.storage,
        sheet_id,
        &cell_hex,
        row,
        col,
        table_fmt.as_ref(),
        engine.stores.grid_indexes.get(sheet_id),
        engine.mirror.get_sheet(sheet_id),
    )
}

pub(super) fn get_cell_format_with_cf(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    cell_id: &CellId,
    row: u32,
    col: u32,
) -> CellFormat {
    let mut fmt = engine.get_cell_format(sheet_id, cell_id, row, col);

    // Merge CF as 6th layer
    if let Some(cache_entry) = engine.stores.cf_cache.get(sheet_id)
        && let Some(cf_result) = cache_entry.results.get(&(row, col))
    {
        super::super::viewport::merge_cf_into_format(&mut fmt, cf_result);
    }

    fmt
}

pub(super) fn get_resolved_format(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> ResolvedCellFormat {
    // Use grid_indexes (the in-memory position→id allocator) to find cell IDs.
    // This reflects the latest state including recent mutations from
    // set_format_for_ranges, unlike the Yrs CRDT which may lag.
    let pos = SheetPos::new(row, col);
    let cell_id = engine
        .stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_id_at(row, col))
        .or_else(|| engine.mirror.resolve_cell_id(sheet_id, pos));

    let mut fmt = if let Some(cid) = cell_id {
        // Cell exists: full cascade (default -> col -> row -> Format Range -> table -> cell)
        let cell_hex = id_to_hex(cid.as_u128());
        let table_fmt =
            services::tables::resolve_table_format_at_cell(&engine.mirror, sheet_id, row, col);
        properties::get_effective_format(
            &engine.stores.storage,
            sheet_id,
            &cell_hex,
            row,
            col,
            table_fmt.as_ref(),
            engine.stores.grid_indexes.get(sheet_id),
            engine.mirror.get_sheet(sheet_id),
        )
    } else {
        // No cell: positional only (default -> col -> row -> Format Range)
        properties::get_positional_format(
            &engine.stores.storage,
            sheet_id,
            row,
            col,
            engine.stores.grid_indexes.get(sheet_id),
            engine.mirror.get_sheet(sheet_id),
        )
    };

    // Theme resolution BEFORE CF (matches viewport pipeline order).
    // No formula format inheritance: a formula cell uses its OWN format.
    // Excel applies operand-format inheritance at edit time (the format is
    // baked into the formula cell), not at display time.
    domain_types::theme_color::resolve_theme_refs(&mut fmt, &engine.settings.theme_palette);

    // CF as 6th layer (only if a cell exists — CF rules are cell-bound)
    if cell_id.is_some()
        && let Some(cache_entry) = engine.stores.cf_cache.get(sheet_id)
        && let Some(cf_result) = cache_entry.results.get(&(row, col))
    {
        super::super::viewport::merge_cf_into_format(&mut fmt, cf_result);
    }

    ResolvedCellFormat::from(fmt)
}

pub(super) fn set_cell_format(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    cell_id: &CellId,
    format: &CellFormat,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    validation::format::validate_cell_format(format)?;
    let cell_hex = id_to_hex(cell_id.as_u128());
    services::formatting::set_cell_format(&mut engine.stores, sheet_id, &cell_hex, format);
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(super) fn clear_cell_format(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    cell_id: &CellId,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let cell_hex = id_to_hex(cell_id.as_u128());
    services::formatting::clear_cell_format(&mut engine.stores, sheet_id, &cell_hex);
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}
