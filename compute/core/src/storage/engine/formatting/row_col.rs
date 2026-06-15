use super::*;

pub(super) fn set_row_format(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    format: CellFormat,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = services::formatting::set_row_format(&mut engine.stores, sheet_id, row, &format)?;
    let patches = engine.produce_row_col_format_viewport_patches(sheet_id, &[row], &[]);
    Ok((patches, result))
}

pub(super) fn set_col_format(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    col: u32,
    format: CellFormat,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = services::formatting::set_col_format(&mut engine.stores, sheet_id, col, &format)?;
    let patches = engine.produce_row_col_format_viewport_patches(sheet_id, &[], &[col]);
    Ok((patches, result))
}

pub(super) fn clear_col_format(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = services::formatting::clear_col_format(
        &mut engine.stores,
        &mut engine.mirror,
        sheet_id,
        col,
    )?;
    let patches = engine.produce_row_col_format_viewport_patches(sheet_id, &[], &[col]);
    Ok((patches, result))
}

pub(super) fn set_col_format_range(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
    format: CellFormat,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    if start_col > end_col || end_col >= cell_types::MAX_COLS {
        return Err(ComputeError::Eval {
            message: format!(
                "Invalid column format range: start_col={start_col}, end_col={end_col}"
            ),
        });
    }
    let result = services::formatting::set_col_format_range(
        &mut engine.stores,
        &mut engine.mirror,
        sheet_id,
        start_col,
        end_col,
        &format,
    )?;
    let cols = if start_col <= end_col {
        (start_col..=end_col).collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let patches = engine.produce_row_col_format_viewport_patches(sheet_id, &[], &cols);
    Ok((patches, result))
}

pub(super) fn get_row_formats(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    rows: Vec<u32>,
) -> Vec<(u32, Option<CellFormat>)> {
    let grid_index = engine.stores.grid_indexes.get(sheet_id);
    rows.into_iter()
        .map(|row| {
            let fmt = properties::get_row_format(&engine.stores.storage, sheet_id, row, grid_index);
            (row, fmt)
        })
        .collect()
}

pub(super) fn set_row_formats(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    updates: Vec<(u32, CellFormat)>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    for (row, format) in &updates {
        services::formatting::set_row_format(&mut engine.stores, sheet_id, *row, format)?;
    }
    let rows = updates
        .iter()
        .map(|(row, _format)| *row)
        .collect::<Vec<_>>();
    let patches = engine.produce_row_col_format_viewport_patches(sheet_id, &rows, &[]);
    Ok((patches, MutationResult::empty()))
}

pub(super) fn get_col_formats(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    cols: Vec<u32>,
) -> Vec<(u32, Option<CellFormat>)> {
    let grid_index = engine.stores.grid_indexes.get(sheet_id);
    cols.into_iter()
        .map(|col| {
            let fmt = properties::get_col_format(&engine.stores.storage, sheet_id, col, grid_index);
            (col, fmt)
        })
        .collect()
}

pub(super) fn set_col_formats(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    updates: Vec<(u32, CellFormat)>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    for (col, format) in &updates {
        services::formatting::set_col_format(&mut engine.stores, sheet_id, *col, format)?;
    }
    let cols = updates
        .iter()
        .map(|(col, _format)| *col)
        .collect::<Vec<_>>();
    let patches = engine.produce_row_col_format_viewport_patches(sheet_id, &[], &cols);
    Ok((patches, MutationResult::empty()))
}
