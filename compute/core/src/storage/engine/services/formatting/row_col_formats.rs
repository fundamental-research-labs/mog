use crate::mirror::CellMirror;
use crate::snapshot::MutationResult;
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;
use cell_types::SheetId;
use domain_types::CellFormat;
use value_types::ComputeError;

pub(in crate::storage::engine) fn set_row_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
    format: &CellFormat,
) -> Result<MutationResult, ComputeError> {
    properties::set_row_format(
        &mut stores.storage,
        sheet_id,
        row,
        format,
        stores.grid_indexes.get(sheet_id),
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn set_col_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col: u32,
    format: &CellFormat,
) -> Result<MutationResult, ComputeError> {
    properties::set_col_format(
        &mut stores.storage,
        sheet_id,
        col,
        format,
        stores.grid_indexes.get(sheet_id),
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn clear_col_format(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    properties::clear_col_format_with_alloc(
        &mut stores.storage,
        sheet_id,
        col,
        stores.grid_indexes.get(sheet_id),
        &stores.id_alloc,
    );
    let Some(sheet_mirror) = mirror.get_sheet_mut(sheet_id) else {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    };
    properties::hydrate_col_format_ranges(&stores.storage, sheet_id, sheet_mirror);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn set_col_format_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
    format: &CellFormat,
) -> Result<MutationResult, ComputeError> {
    if !stores.grid_indexes.contains_key(sheet_id) {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    }
    properties::set_col_format_range_with_alloc(
        &mut stores.storage,
        sheet_id,
        start_col,
        end_col,
        format,
        &stores.id_alloc,
    );
    let Some(sheet_mirror) = mirror.get_sheet_mut(sheet_id) else {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    };
    properties::hydrate_col_format_ranges(&stores.storage, sheet_id, sheet_mirror);
    Ok(MutationResult::empty())
}
