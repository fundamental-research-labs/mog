use super::*;

pub(super) fn query_range_properties(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<Vec<Vec<Option<CellFormat>>>, ComputeError> {
    if start_row > end_row || start_col > end_col {
        return Err(ComputeError::Eval {
            message: "query_range_properties: inverted range (start > end)".to_string(),
        });
    }
    let num_rows = (end_row - start_row + 1) as u64;
    let num_cols = (end_col - start_col + 1) as u64;
    let cell_count = num_rows * num_cols;

    if cell_count > 10_000 {
        return Err(ComputeError::Eval {
            message: format!(
                "query_range_properties: range too large ({} cells, max 10000)",
                cell_count
            ),
        });
    }

    let grid_index = engine.stores.grid_indexes.get(sheet_id);
    let sheet_mirror = engine.mirror.get_sheet(sheet_id);
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

            let fmt = if let Some(cid) = cell_id {
                let cell_hex = id_to_hex(cid.as_u128());
                let table_fmt = services::tables::resolve_table_format_at_cell(
                    &engine.mirror,
                    sheet_id,
                    row,
                    col,
                );
                Some(properties::get_effective_format(
                    &engine.stores.storage,
                    sheet_id,
                    &cell_hex,
                    row,
                    col,
                    table_fmt.as_ref(),
                    grid_index,
                    sheet_mirror,
                ))
            } else {
                // No cell at this position — return positional format if non-default
                let positional = properties::get_positional_format(
                    &engine.stores.storage,
                    sheet_id,
                    row,
                    col,
                    grid_index,
                    sheet_mirror,
                );
                if positional == CellFormat::default() {
                    None
                } else {
                    Some(positional)
                }
            };
            row_formats.push(fmt);
        }
        result.push(row_formats);
    }

    Ok(result)
}
