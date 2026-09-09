use super::*;

pub(super) fn set_row_format(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    format: CellFormat,
) -> Result<MutationResult, ComputeError> {
    let result = services::formatting::set_row_format(&mut engine.stores, sheet_id, row, &format)?;

    Ok(result)
}

pub(super) fn patch_row_format(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    format: CellFormat,
    clear_fields: Vec<String>,
) -> Result<MutationResult, ComputeError> {
    validation::format::validate_cell_format(&format)?;
    properties::apply_format_patch(&CellFormat::default(), &format, &clear_fields)?;
    let result = services::formatting::patch_row_format(
        &mut engine.stores,
        sheet_id,
        row,
        &format,
        &clear_fields,
    )?;

    Ok(result)
}

pub(super) fn set_col_format(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    col: u32,
    format: CellFormat,
) -> Result<MutationResult, ComputeError> {
    let result = services::formatting::set_col_format(&mut engine.stores, sheet_id, col, &format)?;

    Ok(result)
}

pub(super) fn patch_col_format(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    col: u32,
    format: CellFormat,
    clear_fields: Vec<String>,
) -> Result<MutationResult, ComputeError> {
    validation::format::validate_cell_format(&format)?;
    properties::apply_format_patch(&CellFormat::default(), &format, &clear_fields)?;
    let result = services::formatting::patch_col_format(
        &mut engine.stores,
        sheet_id,
        col,
        &format,
        &clear_fields,
    )?;

    Ok(result)
}

pub(super) fn clear_col_format(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    let result = services::formatting::clear_col_format(
        &mut engine.stores,
        &mut engine.cell_store,
        sheet_id,
        col,
    )?;

    Ok(result)
}

pub(super) fn set_col_format_range(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
    format: CellFormat,
) -> Result<MutationResult, ComputeError> {
    if start_col > end_col || end_col >= cell_types::MAX_COLS {
        return Err(ComputeError::Eval {
            message: format!(
                "Invalid column format range: start_col={start_col}, end_col={end_col}"
            ),
        });
    }
    let result = services::formatting::set_col_format_range(
        &mut engine.stores,
        &mut engine.cell_store,
        sheet_id,
        start_col,
        end_col,
        &format,
    )?;

    Ok(result)
}

pub(super) fn get_row_formats(
    engine: &ComputeEngine,
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
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    updates: Vec<(u32, CellFormat)>,
) -> Result<MutationResult, ComputeError> {
    for (row, format) in &updates {
        services::formatting::set_row_format(&mut engine.stores, sheet_id, *row, format)?;
    }

    Ok(MutationResult::empty())
}

pub(super) fn patch_row_formats(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    updates: Vec<(u32, CellFormat, Vec<String>)>,
) -> Result<MutationResult, ComputeError> {
    for (_, format, clear_fields) in &updates {
        validation::format::validate_cell_format(format)?;
        properties::apply_format_patch(&CellFormat::default(), format, clear_fields)?;
    }
    for (row, format, clear_fields) in &updates {
        services::formatting::patch_row_format(
            &mut engine.stores,
            sheet_id,
            *row,
            format,
            clear_fields,
        )?;
    }

    Ok(MutationResult::empty())
}

pub(super) fn get_col_formats(
    engine: &ComputeEngine,
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
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    updates: Vec<(u32, CellFormat)>,
) -> Result<MutationResult, ComputeError> {
    for (col, format) in &updates {
        services::formatting::set_col_format(&mut engine.stores, sheet_id, *col, format)?;
    }

    Ok(MutationResult::empty())
}

pub(super) fn patch_col_formats(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    updates: Vec<(u32, CellFormat, Vec<String>)>,
) -> Result<MutationResult, ComputeError> {
    for (_, format, clear_fields) in &updates {
        validation::format::validate_cell_format(format)?;
        properties::apply_format_patch(&CellFormat::default(), format, clear_fields)?;
    }
    for (col, format, clear_fields) in &updates {
        services::formatting::patch_col_format(
            &mut engine.stores,
            sheet_id,
            *col,
            format,
            clear_fields,
        )?;
    }

    Ok(MutationResult::empty())
}
