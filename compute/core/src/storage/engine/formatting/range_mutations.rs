use super::*;

pub(super) fn toggle_format_property(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    property: &str,
    active_row: u32,
    active_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let (affected_cells, result) = {
        let _guard = engine.mutation.suppress_guard();
        services::formatting::toggle_format_property(
            &mut engine.stores,
            &engine.mirror,
            sheet_id,
            ranges,
            property,
            active_row,
            active_col,
        )?
    };
    let patches = engine.produce_format_change_patches(sheet_id, &affected_cells);
    Ok((patches, result))
}

pub(super) fn set_format_for_ranges(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    format: &CellFormat,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    validation::format::validate_cell_format(format)?;
    let (affected_cells, result) = {
        let _guard = engine.mutation.suppress_guard();
        services::formatting::set_format_for_ranges(
            &mut engine.stores,
            &engine.mirror,
            sheet_id,
            ranges,
            format,
        )?
    };
    let patches = engine.produce_format_change_patches(sheet_id, &affected_cells);
    Ok((patches, result))
}

pub(super) fn clear_format_for_ranges(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let (affected_cells, result) = {
        let _guard = engine.mutation.suppress_guard();
        services::formatting::clear_format_for_ranges(&mut engine.stores, sheet_id, ranges)?
    };
    let patches = engine.produce_format_change_patches(sheet_id, &affected_cells);
    Ok((patches, result))
}

pub(super) fn set_cell_properties_batch(
    engine: &mut YrsComputeEngine,
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
