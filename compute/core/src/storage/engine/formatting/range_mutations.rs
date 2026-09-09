use super::*;

pub(super) fn toggle_format_property(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    property: &str,
    active_row: u32,
    active_col: u32,
) -> Result<MutationResult, ComputeError> {
    let result = {
        services::formatting::toggle_format_property(
            &mut engine.stores,
            &mut engine.cell_store,
            sheet_id,
            ranges,
            property,
            active_row,
            active_col,
        )?
    };

    Ok(result)
}

pub(super) fn set_format_for_ranges(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    format: &CellFormat,
) -> Result<MutationResult, ComputeError> {
    validation::format::validate_cell_format(format)?;
    let result = {
        services::formatting::set_format_for_ranges(
            &mut engine.stores,
            &mut engine.cell_store,
            sheet_id,
            ranges,
            format,
        )?
    };

    Ok(result)
}

pub(super) fn patch_format_for_ranges(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    format: &CellFormat,
    clear_fields: &[String],
) -> Result<MutationResult, ComputeError> {
    validation::format::validate_cell_format(format)?;
    properties::apply_format_patch(&CellFormat::default(), format, clear_fields)?;
    let result = {
        services::formatting::patch_format_for_ranges(
            &mut engine.stores,
            &mut engine.cell_store,
            sheet_id,
            ranges,
            format,
            clear_fields,
        )?
    };

    Ok(result)
}

pub(super) fn patch_borders(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    operations: Vec<crate::bridge_types::BorderPatchOperation>,
) -> Result<MutationResult, ComputeError> {
    use crate::bridge_types::BorderPatchTarget;

    let operations: Vec<_> = operations
        .into_iter()
        .filter(|operation| !operation.is_noop())
        .collect();
    if operations.is_empty() {
        return Ok(MutationResult::empty());
    }
    if !engine.stores.grid_indexes.contains_key(sheet_id) {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    }

    // Validate the complete batch before its first write so malformed input
    // cannot leave a partially-applied border command.
    for operation in &operations {
        if let Some(field) = operation.conflicting_field() {
            return Err(ComputeError::InvalidInput {
                message: format!("Border patch cannot both set and clear {}", field.as_str()),
            });
        }
        validation::format::validate_cell_format(&CellFormat {
            borders: Some(operation.borders.clone()),
            ..Default::default()
        })?;
        match operation.target {
            BorderPatchTarget::Cells {
                start_row,
                start_col,
                end_row,
                end_col,
            } => {
                validation::range::validate_range_bounds(start_row, start_col, end_row, end_col)?;
                if end_row >= cell_types::MAX_ROWS || end_col >= cell_types::MAX_COLS {
                    return Err(ComputeError::InvalidInput {
                        message: format!(
                            "Border patch range ({start_row},{start_col})..({end_row},{end_col}) exceeds sheet bounds"
                        ),
                    });
                }
            }
            BorderPatchTarget::Row { row } => {
                if row >= cell_types::MAX_ROWS {
                    return Err(ComputeError::InvalidInput {
                        message: format!("Border patch row {row} exceeds sheet bounds"),
                    });
                }
                if engine
                    .stores
                    .grid_indexes
                    .get(sheet_id)
                    .and_then(|grid| grid.row_id(row))
                    .is_none()
                {
                    return Err(ComputeError::InvalidInput {
                        message: format!("Border patch row {row} is not materialized"),
                    });
                }
            }
            BorderPatchTarget::Column { col } => {
                if col >= cell_types::MAX_COLS {
                    return Err(ComputeError::InvalidInput {
                        message: format!("Border patch column {col} exceeds sheet bounds"),
                    });
                }
                if engine
                    .stores
                    .grid_indexes
                    .get(sheet_id)
                    .and_then(|grid| grid.col_id(col))
                    .is_none()
                {
                    return Err(ComputeError::InvalidInput {
                        message: format!("Border patch column {col} is not materialized"),
                    });
                }
            }
        }
    }

    {
        let mut result = MutationResult::empty();

        for operation in &operations {
            match operation.target {
                BorderPatchTarget::Cells {
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                } => {
                    let operation_result = {
                        services::formatting::patch_borders_for_ranges(
                            &mut engine.stores,
                            &mut engine.cell_store,
                            sheet_id,
                            &[(start_row, start_col, end_row, end_col)],
                            &operation.borders,
                            &operation.clear_fields,
                        )?
                    };
                    result
                        .property_changes
                        .extend(operation_result.property_changes);
                }
                BorderPatchTarget::Row { row } => {
                    services::formatting::patch_row_borders(
                        &mut engine.stores,
                        sheet_id,
                        row,
                        &operation.borders,
                        &operation.clear_fields,
                    )?;
                }
                BorderPatchTarget::Column { col } => {
                    services::formatting::patch_col_borders(
                        &mut engine.stores,
                        sheet_id,
                        col,
                        &operation.borders,
                        &operation.clear_fields,
                    )?;
                }
            }
        }

        Ok(result)
    }
}

pub(super) fn clear_format_for_ranges(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
) -> Result<MutationResult, ComputeError> {
    let result = {
        services::formatting::clear_format_for_ranges(
            &mut engine.stores,
            &mut engine.cell_store,
            sheet_id,
            ranges,
        )?
    };

    Ok(result)
}

pub(super) fn set_cell_properties_batch(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    updates: Vec<(u32, u32, CellFormat)>,
) -> Result<MutationResult, ComputeError> {
    if !engine.stores.grid_indexes.contains_key(sheet_id) {
        return Err(ComputeError::Eval {
            message: format!("Sheet not found: {:?}", sheet_id),
        });
    }

    for (row, col, format) in &updates {
        let cell_id = services::cell_editing::ensure_cell_id(
            &mut engine.stores,
            &mut engine.cell_store,
            sheet_id,
            *row,
            *col,
        )
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
        services::formatting::set_cell_format(&mut engine.stores, sheet_id, &cell_id, format);
    }

    Ok(MutationResult::empty())
}

pub(super) fn patch_cell_properties_batch(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    updates: Vec<(u32, u32, CellFormat, Vec<String>)>,
) -> Result<MutationResult, ComputeError> {
    if !engine.stores.grid_indexes.contains_key(sheet_id) {
        return Err(ComputeError::Eval {
            message: format!("Sheet not found: {:?}", sheet_id),
        });
    }

    for (_, _, format, clear_fields) in &updates {
        validation::format::validate_cell_format(format)?;
        properties::apply_format_patch(&CellFormat::default(), format, clear_fields)?;
    }
    for (row, col, format, clear_fields) in &updates {
        let cell_id = services::cell_editing::ensure_cell_id(
            &mut engine.stores,
            &mut engine.cell_store,
            sheet_id,
            *row,
            *col,
        )
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
        services::formatting::patch_cell_format(
            &mut engine.stores,
            sheet_id,
            &cell_id,
            format,
            clear_fields,
        )?;
    }

    Ok(MutationResult::empty())
}
