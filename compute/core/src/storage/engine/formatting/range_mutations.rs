use super::*;

pub(super) fn toggle_format_property(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    property: &str,
    active_row: u32,
    active_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let (affected_cells, result) = {
        services::formatting::toggle_format_property(
            &mut engine.stores,
            &mut engine.mirror,
            sheet_id,
            ranges,
            property,
            active_row,
            active_col,
        )?
    };
    let patches = range_format_patches(engine, sheet_id, &affected_cells, &result);
    Ok((patches, result))
}

pub(super) fn set_format_for_ranges(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    format: &CellFormat,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    validation::format::validate_cell_format(format)?;
    let (affected_cells, result) = {
        services::formatting::set_format_for_ranges(
            &mut engine.stores,
            &mut engine.mirror,
            sheet_id,
            ranges,
            format,
        )?
    };
    let patches = range_format_patches(engine, sheet_id, &affected_cells, &result);
    Ok((patches, result))
}

pub(super) fn patch_format_for_ranges(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    format: &CellFormat,
    clear_fields: &[String],
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    validation::format::validate_cell_format(format)?;
    properties::apply_format_patch(&CellFormat::default(), format, clear_fields)?;
    let (affected_cells, result) = {
        services::formatting::patch_format_for_ranges(
            &mut engine.stores,
            &mut engine.mirror,
            sheet_id,
            ranges,
            format,
            clear_fields,
        )?
    };
    let patches = range_format_patches(engine, sheet_id, &affected_cells, &result);
    Ok((patches, result))
}

pub(super) fn patch_borders(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    operations: Vec<crate::bridge_types::BorderPatchOperation>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    use crate::bridge_types::BorderPatchTarget;

    let operations: Vec<_> = operations
        .into_iter()
        .filter(|operation| !operation.is_noop())
        .collect();
    if operations.is_empty() {
        return Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ));
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
        let mut affected_cells = Vec::new();
        let mut affected_rows = Vec::new();
        let mut affected_cols = Vec::new();

        for operation in &operations {
            match operation.target {
                BorderPatchTarget::Cells {
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                } => {
                    let (cells, operation_result) = {
                        services::formatting::patch_borders_for_ranges(
                            &mut engine.stores,
                            &mut engine.mirror,
                            sheet_id,
                            &[(start_row, start_col, end_row, end_col)],
                            &operation.borders,
                            &operation.clear_fields,
                        )?
                    };
                    affected_cells.extend(cells);
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
                    affected_rows.push(row);
                }
                BorderPatchTarget::Column { col } => {
                    services::formatting::patch_col_borders(
                        &mut engine.stores,
                        sheet_id,
                        col,
                        &operation.borders,
                        &operation.clear_fields,
                    )?;
                    affected_cols.push(col);
                }
            }
        }

        let patches = if result
            .property_changes
            .iter()
            .any(|change| change.cell_id.is_empty())
        {
            engine.produce_full_viewport_patches(sheet_id)
        } else if affected_rows.is_empty() && affected_cols.is_empty() {
            engine.produce_format_change_patches(sheet_id, &affected_cells)
        } else if affected_cells.is_empty() {
            engine.produce_row_col_format_viewport_patches(sheet_id, &affected_rows, &affected_cols)
        } else {
            // Mixed direct-cell and inherited row/column mutations are rare,
            // but a full registered-viewport rebuild is the only complete
            // patch because row/column formats also affect virtual cells.
            engine.produce_full_viewport_patches(sheet_id)
        };

        Ok((patches, result))
    }
}

pub(super) fn clear_format_for_ranges(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let (affected_cells, result) = {
        services::formatting::clear_format_for_ranges(
            &mut engine.stores,
            &mut engine.mirror,
            sheet_id,
            ranges,
        )?
    };
    let patches = range_format_patches(engine, sheet_id, &affected_cells, &result);
    Ok((patches, result))
}

pub(super) fn set_cell_properties_batch(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    updates: Vec<(u32, u32, CellFormat)>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    if !engine.stores.grid_indexes.contains_key(sheet_id) {
        return Err(ComputeError::Eval {
            message: format!("Sheet not found: {:?}", sheet_id),
        });
    }

    for (row, col, format) in &updates {
        let Some(grid) = engine.stores.grid_indexes.get_mut(sheet_id) else {
            continue;
        };
        // Pre-register virtual CellId for Range-resident positions so
        // ensure_cell_id returns the deterministic virtual ID.
        crate::storage::cells::values::maybe_register_virtual_cell_id(
            &engine.mirror,
            sheet_id,
            grid,
            *row,
            *col,
        );
        let cell_id = grid.ensure_cell_id(*row, *col);
        let cell_hex = id_to_hex(cell_id.as_u128());
        services::formatting::set_cell_format(&mut engine.stores, sheet_id, &cell_hex, format);
    }

    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(super) fn patch_cell_properties_batch(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    updates: Vec<(u32, u32, CellFormat, Vec<String>)>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
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
        let Some(grid) = engine.stores.grid_indexes.get_mut(sheet_id) else {
            continue;
        };
        crate::storage::cells::values::maybe_register_virtual_cell_id(
            &engine.mirror,
            sheet_id,
            grid,
            *row,
            *col,
        );
        let cell_id = grid.ensure_cell_id(*row, *col);
        let cell_hex = id_to_hex(cell_id.as_u128());
        services::formatting::patch_cell_format(
            &mut engine.stores,
            sheet_id,
            &cell_hex,
            format,
            clear_fields,
        )?;
    }

    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

/// Range-level changes also affect virtual cells absent from the eager cell list.
fn range_format_patches(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    cells: &[(u128, u32, u32)],
    result: &MutationResult,
) -> Vec<u8> {
    if result
        .property_changes
        .iter()
        .any(|change| change.cell_id.is_empty())
    {
        engine.produce_full_viewport_patches(sheet_id)
    } else {
        engine.produce_format_change_patches(sheet_id, cells)
    }
}
