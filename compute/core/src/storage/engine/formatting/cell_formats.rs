use super::*;

pub(super) fn get_cell_format(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    cell_id: &CellId,
    row: u32,
    col: u32,
) -> CellFormat {
    let table_fmt =
        services::resolve_structured_format_at_cell(&engine.cell_store, sheet_id, row, col);
    properties::get_effective_format_by_id(
        &engine.stores.storage,
        sheet_id,
        Some(&cell_id),
        row,
        col,
        table_fmt.as_ref(),
        engine.stores.grid_indexes.get(sheet_id),
        engine.cell_store.get_sheet(sheet_id),
    )
}

pub(super) fn get_cell_format_with_cf(
    engine: &ComputeEngine,
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

fn get_transferable_cell_format(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> (CellFormat, bool) {
    // Resolve eager identities first, then compact native range positions.
    let pos = SheetPos::new(row, col);
    let cell_id = engine.cell_store.resolve_cell_id(sheet_id, pos);

    let fmt = if let Some(cid) = cell_id {
        // Cell exists: full cascade (default -> col -> row -> Format Range -> table -> cell)
        let table_fmt =
            services::resolve_structured_format_at_cell(&engine.cell_store, sheet_id, row, col);
        properties::get_effective_format_by_id(
            &engine.stores.storage,
            sheet_id,
            Some(&cid),
            row,
            col,
            table_fmt.as_ref(),
            engine.stores.grid_indexes.get(sheet_id),
            engine.cell_store.get_sheet(sheet_id),
        )
    } else {
        // No cell: positional only (default -> col -> row -> Format Range)
        properties::get_positional_format(
            &engine.stores.storage,
            sheet_id,
            row,
            col,
            engine.stores.grid_indexes.get(sheet_id),
            engine.cell_store.get_sheet(sheet_id),
        )
    };

    (fmt, cell_id.is_some())
}

pub(super) fn get_transferable_format(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> ResolvedCellFormat {
    // Keep symbolic theme references and exclude conditional-format/display
    // overlays so this dense result can be transferred back into a mutator.
    let (format, _) = get_transferable_cell_format(engine, sheet_id, row, col);
    ResolvedCellFormat::from(format)
}

pub(super) fn get_resolved_format(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> ResolvedCellFormat {
    let (mut fmt, cell_exists) = get_transferable_cell_format(engine, sheet_id, row, col);

    // Preserve the historical internal resolved path: theme refs and CF are
    // projected for consumers that need rendered appearance rather than a
    // transferable format snapshot.
    domain_types::theme_color::resolve_theme_refs(&mut fmt, &engine.settings.theme_palette);
    if cell_exists
        && let Some(cache_entry) = engine.stores.cf_cache.get(sheet_id)
        && let Some(cf_result) = cache_entry.results.get(&(row, col))
    {
        super::super::viewport::merge_cf_into_format(&mut fmt, cf_result);
    }

    ResolvedCellFormat::from(fmt)
}

pub(super) fn set_cell_format(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    cell_id: &CellId,
    format: &CellFormat,
) -> Result<MutationResult, ComputeError> {
    validation::format::validate_cell_format(format)?;
    services::formatting::set_cell_format(&mut engine.stores, sheet_id, cell_id, format);
    Ok(MutationResult::empty())
}

pub(super) fn clear_cell_format(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    cell_id: &CellId,
) -> Result<MutationResult, ComputeError> {
    services::formatting::clear_cell_format(&mut engine.stores, sheet_id, cell_id);
    Ok(MutationResult::empty())
}
