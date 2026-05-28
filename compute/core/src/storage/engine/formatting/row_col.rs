use super::*;

pub(super) fn set_row_format(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    format: CellFormat,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = services::formatting::set_row_format(&mut engine.stores, sheet_id, row, &format)?;
    // Row-level format affects every cell in the row, including virtual
    // positions with no allocated cell — there is no enumerable affected
    // set, so rebuild the visible viewport region. Mirrors the broad-effect
    // pattern used by `produce_cf_viewport_patches`.
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn set_col_format(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    col: u32,
    format: CellFormat,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = services::formatting::set_col_format(&mut engine.stores, sheet_id, col, &format)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
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
    let patches = engine.produce_full_viewport_patches(sheet_id);
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
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, MutationResult::empty()))
}
