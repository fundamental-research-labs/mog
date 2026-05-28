use super::super::YrsComputeEngine;
use super::super::services::features as svc;
use crate::snapshot::MutationResult;
use crate::storage::sheet::sparklines;
use cell_types::SheetId;
use value_types::ComputeError;

fn sparkline_change_positions(result: &MutationResult) -> Vec<(u32, u32)> {
    let mut positions = Vec::new();
    for change in &result.sparkline_changes {
        let Some(position) = change.position.as_ref() else {
            continue;
        };
        let key = (position.row, position.col);
        if !positions.contains(&key) {
            positions.push(key);
        }
    }
    positions
}

pub(super) fn add_sparkline(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    sparkline: sparklines::Sparkline,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::add_sparkline(&engine.stores, sheet_id, &sparkline)?;
    let positions = sparkline_change_positions(&result);
    let patches = if positions.is_empty() {
        compute_wire::mutation::serialize_multi_viewport_patches(&[])
    } else {
        engine.produce_sparkline_viewport_patches(sheet_id, &positions)
    };
    Ok((patches, result))
}

pub(super) fn update_sparkline(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    sparkline_id: &str,
    updates: sparklines::SparklineUpdate,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::update_sparkline(&engine.stores, sheet_id, sparkline_id, &updates)?;
    let positions = sparkline_change_positions(&result);
    let patches = if positions.is_empty() {
        compute_wire::mutation::serialize_multi_viewport_patches(&[])
    } else {
        engine.produce_sparkline_viewport_patches(sheet_id, &positions)
    };
    Ok((patches, result))
}

pub(super) fn delete_sparkline(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::delete_sparkline(&engine.stores, sheet_id, sparkline_id)?;
    let positions = sparkline_change_positions(&result);
    let patches = if positions.is_empty() {
        compute_wire::mutation::serialize_multi_viewport_patches(&[])
    } else {
        engine.produce_sparkline_viewport_patches(sheet_id, &positions)
    };
    Ok((patches, result))
}

pub(super) fn get_sparklines_in_sheet(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<sparklines::Sparkline> {
    svc::get_sparklines_in_sheet(&engine.stores, sheet_id)
}

pub(super) fn get_sparkline(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> Option<sparklines::Sparkline> {
    svc::get_sparkline(&engine.stores, sheet_id, sparkline_id)
}

pub(super) fn get_sparkline_at_cell(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<sparklines::Sparkline> {
    svc::get_sparkline_at_cell(&engine.stores, sheet_id, row, col)
}

pub(super) fn add_sparkline_group(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    group: sparklines::SparklineGroup,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::add_sparkline_group(&mut engine.stores, sheet_id, &group)?;
    let positions = sparkline_change_positions(&result);
    let patches = if positions.is_empty() {
        compute_wire::mutation::serialize_multi_viewport_patches(&[])
    } else {
        engine.produce_sparkline_viewport_patches(sheet_id, &positions)
    };
    Ok((patches, result))
}

pub(super) fn get_sparkline_group(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<sparklines::SparklineGroup> {
    svc::get_sparkline_group(&engine.stores, sheet_id, group_id)
}

pub(super) fn get_sparkline_groups_in_sheet(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<sparklines::SparklineGroup> {
    svc::get_sparkline_groups_in_sheet(&engine.stores, sheet_id)
}

pub(super) fn delete_sparkline_group(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
    delete_sparklines: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result =
        svc::delete_sparkline_group(&mut engine.stores, sheet_id, group_id, delete_sparklines)?;
    let positions = if delete_sparklines {
        sparkline_change_positions(&result)
    } else {
        Vec::new()
    };
    let patches = if positions.is_empty() {
        compute_wire::mutation::serialize_multi_viewport_patches(&[])
    } else {
        engine.produce_sparkline_viewport_patches(sheet_id, &positions)
    };
    Ok((patches, result))
}

pub(super) fn clear_sparklines_in_range(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    svc::clear_sparklines_in_range(
        &mut engine.stores,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
    )
    .map(|result| {
        let positions = sparkline_change_positions(&result);
        let patches = if positions.is_empty() {
            compute_wire::mutation::serialize_multi_viewport_patches(&[])
        } else {
            engine.produce_sparkline_viewport_patches(sheet_id, &positions)
        };
        (patches, result)
    })
}

pub(super) fn clear_sparklines_for_sheet(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::clear_sparklines_for_sheet(&mut engine.stores, sheet_id)?;
    let positions = sparkline_change_positions(&result);
    let patches = if positions.is_empty() {
        compute_wire::mutation::serialize_multi_viewport_patches(&[])
    } else {
        engine.produce_sparkline_viewport_patches(sheet_id, &positions)
    };
    Ok((patches, result))
}

pub(super) fn has_sparkline(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    svc::has_sparkline(&engine.stores, sheet_id, row, col)
}
