use super::super::ComputeEngine;
use super::super::services::features as svc;
use crate::snapshot::MutationResult;
use crate::storage::sheet::sparklines;
use cell_types::SheetId;
use value_types::ComputeError;

pub(super) fn add_sparkline(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    sparkline: sparklines::Sparkline,
) -> Result<MutationResult, ComputeError> {
    svc::add_sparkline(&mut engine.stores, &engine.cell_store, sheet_id, &sparkline)
}

pub(super) fn update_sparkline(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    sparkline_id: &str,
    updates: sparklines::SparklineUpdate,
) -> Result<MutationResult, ComputeError> {
    svc::update_sparkline(
        &mut engine.stores,
        &engine.cell_store,
        sheet_id,
        sparkline_id,
        &updates,
    )
}

pub(super) fn delete_sparkline(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> Result<MutationResult, ComputeError> {
    svc::delete_sparkline(
        &mut engine.stores,
        &engine.cell_store,
        sheet_id,
        sparkline_id,
    )
}

pub(super) fn get_sparklines_in_sheet(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<sparklines::Sparkline> {
    svc::get_sparklines_in_sheet(&engine.stores, sheet_id)
}

pub(super) fn get_sparkline(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> Option<sparklines::Sparkline> {
    svc::get_sparkline(&engine.stores, sheet_id, sparkline_id)
}

pub(super) fn get_sparkline_at_cell(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<sparklines::Sparkline> {
    svc::get_sparkline_at_cell(&engine.stores, sheet_id, row, col)
}

pub(super) fn add_sparkline_group(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    group: sparklines::SparklineGroup,
) -> Result<MutationResult, ComputeError> {
    svc::add_sparkline_group(&mut engine.stores, &engine.cell_store, sheet_id, &group)
}

pub(super) fn get_sparkline_group(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<sparklines::SparklineGroup> {
    svc::get_sparkline_group(&engine.stores, sheet_id, group_id)
}

pub(super) fn get_sparkline_groups_in_sheet(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<sparklines::SparklineGroup> {
    svc::get_sparkline_groups_in_sheet(&engine.stores, sheet_id)
}

pub(super) fn delete_sparkline_group(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
    delete_sparklines: bool,
) -> Result<MutationResult, ComputeError> {
    svc::delete_sparkline_group(
        &mut engine.stores,
        &engine.cell_store,
        sheet_id,
        group_id,
        delete_sparklines,
    )
}

pub(super) fn clear_sparklines_in_range(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    svc::clear_sparklines_in_range(
        &mut engine.stores,
        &engine.cell_store,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
    )
}

pub(super) fn clear_sparklines_for_sheet(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    svc::clear_sparklines_for_sheet(&mut engine.stores, &engine.cell_store, sheet_id)
}

pub(super) fn has_sparkline(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    svc::has_sparkline(&engine.stores, sheet_id, row, col)
}
