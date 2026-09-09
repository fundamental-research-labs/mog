use crate::cells::CellStore;
use crate::snapshot::{CellPosition, ChangeKind, MutationResult, SparklineChange};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::sparklines;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use value_types::ComputeError;

pub(in crate::storage::engine) fn add_sparkline(
    stores: &mut EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    sparkline: &sparklines::Sparkline,
) -> Result<MutationResult, ComputeError> {
    sparklines::add_sparkline(&mut stores.storage, sheet_id, sparkline);
    let mut result = MutationResult::empty();
    push_sparkline_change(
        cell_store,
        &mut result,
        sheet_id,
        sparkline.cell.row,
        sparkline.cell.col,
        ChangeKind::Set,
    );
    Ok(result)
}

pub(in crate::storage::engine) fn update_sparkline(
    stores: &mut EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    sparkline_id: &str,
    updates: &sparklines::SparklineUpdate,
) -> Result<MutationResult, ComputeError> {
    let before = sparklines::get_sparkline(&stores.storage, sheet_id, sparkline_id);

    let updated =
        sparklines::update_sparkline(&mut stores.storage, sheet_id, sparkline_id, updates);
    if !updated {
        return Err(ComputeError::InvalidInput {
            message: format!("sparkline '{sparkline_id}' not found"),
        });
    }

    let after = sparklines::get_sparkline(&stores.storage, sheet_id, sparkline_id);

    let mut result = MutationResult::empty();
    match (before, after) {
        (Some(old), Some(new)) if old.cell.row == new.cell.row && old.cell.col == new.cell.col => {
            push_sparkline_change(
                cell_store,
                &mut result,
                sheet_id,
                new.cell.row,
                new.cell.col,
                ChangeKind::Set,
            );
        }
        (Some(old), Some(new)) => {
            push_sparkline_change(
                cell_store,
                &mut result,
                sheet_id,
                old.cell.row,
                old.cell.col,
                ChangeKind::Removed,
            );
            push_sparkline_change(
                cell_store,
                &mut result,
                sheet_id,
                new.cell.row,
                new.cell.col,
                ChangeKind::Set,
            );
        }
        (None, Some(new)) => {
            push_sparkline_change(
                cell_store,
                &mut result,
                sheet_id,
                new.cell.row,
                new.cell.col,
                ChangeKind::Set,
            );
        }
        _ => {}
    }
    Ok(result)
}

pub(in crate::storage::engine) fn delete_sparkline(
    stores: &mut EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> Result<MutationResult, ComputeError> {
    let before = sparklines::get_sparkline(&stores.storage, sheet_id, sparkline_id);
    let deleted = sparklines::delete_sparkline(&mut stores.storage, sheet_id, sparkline_id);
    if !deleted {
        return Err(ComputeError::InvalidInput {
            message: format!("sparkline '{sparkline_id}' not found"),
        });
    }
    let mut result = MutationResult::empty();
    if let Some(old) = before {
        push_sparkline_change(
            cell_store,
            &mut result,
            sheet_id,
            old.cell.row,
            old.cell.col,
            ChangeKind::Removed,
        );
    }
    Ok(result)
}

pub(in crate::storage::engine) fn get_sparklines_in_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<sparklines::Sparkline> {
    sparklines::get_sparklines_in_sheet(&stores.storage, sheet_id)
}

pub(in crate::storage::engine) fn get_sparkline(
    stores: &EngineStores,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> Option<sparklines::Sparkline> {
    sparklines::get_sparkline(&stores.storage, sheet_id, sparkline_id)
}

pub(in crate::storage::engine) fn get_sparkline_at_cell(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<sparklines::Sparkline> {
    sparklines::get_sparkline_at_cell(&stores.storage, sheet_id, row, col)
}

pub(in crate::storage::engine) fn add_sparkline_group(
    stores: &mut EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    group: &sparklines::SparklineGroup,
) -> Result<MutationResult, ComputeError> {
    sparklines::add_sparkline_group(&mut stores.storage, sheet_id, group);
    let mut result = MutationResult::empty();
    for sparkline_id in &group.sparkline_ids {
        if let Some(sparkline) = sparklines::get_sparkline(&stores.storage, sheet_id, sparkline_id)
        {
            push_sparkline_change(
                cell_store,
                &mut result,
                sheet_id,
                sparkline.cell.row,
                sparkline.cell.col,
                ChangeKind::Set,
            );
        }
    }
    Ok(result)
}

pub(in crate::storage::engine) fn get_sparkline_group(
    stores: &EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<sparklines::SparklineGroup> {
    sparklines::get_sparkline_group(&stores.storage, sheet_id, group_id)
}

pub(in crate::storage::engine) fn get_sparkline_groups_in_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<sparklines::SparklineGroup> {
    sparklines::get_sparkline_groups_in_sheet(&stores.storage, sheet_id)
}

pub(in crate::storage::engine) fn delete_sparkline_group(
    stores: &mut EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    group_id: &str,
    delete_sparklines: bool,
) -> Result<MutationResult, ComputeError> {
    let before_group = sparklines::get_sparkline_group(&stores.storage, sheet_id, group_id);
    let before_sparklines: Vec<sparklines::Sparkline> = before_group
        .as_ref()
        .map(|group| {
            group
                .sparkline_ids
                .iter()
                .filter_map(|sparkline_id| {
                    sparklines::get_sparkline(&stores.storage, sheet_id, sparkline_id)
                })
                .collect()
        })
        .unwrap_or_default();

    let deleted = sparklines::delete_sparkline_group(
        &mut stores.storage,
        sheet_id,
        group_id,
        delete_sparklines,
    );
    if !deleted {
        return Err(ComputeError::InvalidInput {
            message: format!("sparkline group '{group_id}' not found"),
        });
    }
    let mut result = MutationResult::empty();
    let kind = if delete_sparklines {
        ChangeKind::Removed
    } else {
        ChangeKind::Set
    };
    for sparkline in before_sparklines {
        push_sparkline_change(
            cell_store,
            &mut result,
            sheet_id,
            sparkline.cell.row,
            sparkline.cell.col,
            kind,
        );
    }
    Ok(result)
}

pub(in crate::storage::engine) fn clear_sparklines_in_range(
    stores: &mut EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let range = sparklines::CellRange::new(start_row, start_col, end_row, end_col);
    let before: Vec<sparklines::Sparkline> =
        sparklines::get_sparklines_in_sheet(&stores.storage, sheet_id)
            .into_iter()
            .filter(|sparkline| {
                sparkline.cell.row >= start_row
                    && sparkline.cell.row <= end_row
                    && sparkline.cell.col >= start_col
                    && sparkline.cell.col <= end_col
            })
            .collect();

    sparklines::clear_sparklines_in_range(&mut stores.storage, sheet_id, &range);
    let mut result = MutationResult::empty();
    for sparkline in before {
        push_sparkline_change(
            cell_store,
            &mut result,
            sheet_id,
            sparkline.cell.row,
            sparkline.cell.col,
            ChangeKind::Removed,
        );
    }
    Ok(result)
}

pub(in crate::storage::engine) fn clear_sparklines_for_sheet(
    stores: &mut EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let before = sparklines::get_sparklines_in_sheet(&stores.storage, sheet_id);
    sparklines::clear_sparklines_for_sheet(&mut stores.storage, sheet_id);
    let mut result = MutationResult::empty();
    for sparkline in before {
        push_sparkline_change(
            cell_store,
            &mut result,
            sheet_id,
            sparkline.cell.row,
            sparkline.cell.col,
            ChangeKind::Removed,
        );
    }
    Ok(result)
}

fn push_sparkline_change(
    cell_store: &CellStore,
    result: &mut MutationResult,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    kind: ChangeKind,
) {
    let cell_id = cell_store
        .get_sheet(sheet_id)
        .and_then(|sheet| sheet.cell_id_at(cell_types::SheetPos::new(row, col)))
        .map(|cell_id| id_to_hex(cell_id.as_u128()).to_string())
        .unwrap_or_default();

    result.sparkline_changes.push(SparklineChange {
        sheet_id: sheet_id.to_uuid_string(),
        cell_id,
        position: Some(CellPosition { row, col }),
        kind,
    });
}

pub(in crate::storage::engine) fn has_sparkline(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    sparklines::has_sparkline(&stores.storage, sheet_id, row, col)
}
