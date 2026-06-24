use super::*;

pub(super) fn get_displayed_cell_properties(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> CellFormat {
    let pos = SheetPos::new(row, col);
    let cell_id = engine
        .stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_id_at(row, col))
        .or_else(|| engine.mirror.resolve_cell_id(sheet_id, pos));

    let mut fmt = if let Some(cid) = cell_id {
        let cell_hex = id_to_hex(cid.as_u128());
        let table_fmt =
            services::resolve_structured_format_at_cell(&engine.mirror, sheet_id, row, col);
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
        properties::get_positional_format(
            &engine.stores.storage,
            sheet_id,
            row,
            col,
            engine.stores.grid_indexes.get(sheet_id),
            engine.mirror.get_sheet(sheet_id),
        )
    };

    // Theme resolution (matches viewport pipeline order).
    // No formula format inheritance — see `get_resolved_format` for rationale.
    domain_types::theme_color::resolve_theme_refs(&mut fmt, &engine.settings.theme_palette);

    // CF as 6th cascade layer (range-scoped — applies to blank cells too).
    super::super::viewport::apply_cf_to_format(
        engine.stores.cf_cache.get(sheet_id),
        &mut fmt,
        row,
        col,
    );

    // Number-format section color (e.g. [Red]) — value-dependent override.
    // Lower priority than CF font_color, higher than stored font_color.
    if let Some(value) =
        crate::storage::cells::values::get_effective_value(&engine.mirror, sheet_id, row, col)
    {
        let format_code = fmt.number_format.as_deref().unwrap_or("General");
        let fr = compute_formats::format_value(&value, format_code, &engine.settings.locale);
        if let Some(ref color) = fr.color {
            super::super::viewport::apply_number_format_color(
                &mut fmt,
                color,
                engine.stores.cf_cache.get(sheet_id),
                row,
                col,
            );
        }
    }

    fmt
}

pub(super) fn get_displayed_range_properties(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<Vec<Vec<CellFormat>>, ComputeError> {
    if start_row > end_row || start_col > end_col {
        return Err(ComputeError::Eval {
            message: "get_displayed_range_properties: inverted range (start > end)".to_string(),
        });
    }
    let num_rows = (end_row - start_row + 1) as u64;
    let num_cols = (end_col - start_col + 1) as u64;
    let cell_count = num_rows * num_cols;

    if cell_count > 10_000 {
        return Err(ComputeError::Eval {
            message: format!(
                "get_displayed_range_properties: range too large ({} cells, max 10000)",
                cell_count
            ),
        });
    }

    let grid_index = engine.stores.grid_indexes.get(sheet_id);
    let sheet_mirror = engine.mirror.get_sheet(sheet_id);
    let cf_cache_entry = engine.stores.cf_cache.get(sheet_id);
    let mut result = Vec::with_capacity(num_rows as usize);

    for row in start_row..=end_row {
        let mut row_formats = Vec::with_capacity(num_cols as usize);
        for col in start_col..=end_col {
            let cell_id = grid_index
                .and_then(|grid| grid.cell_id_at(row, col))
                .or_else(|| {
                    engine
                        .mirror
                        .resolve_cell_id(sheet_id, SheetPos::new(row, col))
                });

            let mut fmt = if let Some(cid) = cell_id {
                let cell_hex = id_to_hex(cid.as_u128());
                let table_fmt =
                    services::resolve_structured_format_at_cell(&engine.mirror, sheet_id, row, col);
                properties::get_effective_format(
                    &engine.stores.storage,
                    sheet_id,
                    &cell_hex,
                    row,
                    col,
                    table_fmt.as_ref(),
                    grid_index,
                    sheet_mirror,
                )
            } else {
                properties::get_positional_format(
                    &engine.stores.storage,
                    sheet_id,
                    row,
                    col,
                    grid_index,
                    sheet_mirror,
                )
            };

            // Theme resolution.
            // No formula format inheritance — see `get_resolved_format`.
            domain_types::theme_color::resolve_theme_refs(&mut fmt, &engine.settings.theme_palette);

            // CF as 6th cascade layer (range-scoped — applies to blank cells too).
            super::super::viewport::apply_cf_to_format(cf_cache_entry, &mut fmt, row, col);

            row_formats.push(fmt);
        }
        result.push(row_formats);
    }

    Ok(result)
}
