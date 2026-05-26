pub(in crate::storage::engine) mod format;
pub(in crate::storage::engine) mod range;
pub(in crate::storage::engine) mod sheet;
pub(in crate::storage::engine) mod structure;

use super::YrsComputeEngine;
use super::mutation::EngineMutation;
use value_types::ComputeError;

pub fn validate_mutation(
    mutation: &EngineMutation,
    engine: &YrsComputeEngine,
) -> Result<(), ComputeError> {
    match mutation {
        EngineMutation::CreateSheet { name, .. }
        | EngineMutation::CreateDefaultSheet { name, .. } => {
            if !name.is_empty() {
                sheet::validate_sheet_name(name)?;
            }
            sheet::validate_sheet_name_unique(name, engine)?;
        }
        EngineMutation::RenameSheet { name, sheet_id, .. } => {
            sheet::validate_sheet_name(name)?;
            sheet::validate_sheet_name_unique_excluding(name, sheet_id, engine)?;
        }
        EngineMutation::CopySheet { new_name, .. } => {
            if !new_name.is_empty() {
                sheet::validate_sheet_name(new_name)?;
            }
            sheet::validate_sheet_name_unique(new_name, engine)?;
        }
        EngineMutation::SetCellsByPosition { .. } => {}
        EngineMutation::CreateDataTable { input } => {
            crate::data_table::prepare_data_table_creation(engine.mirror(), input)?;
        }
        EngineMutation::ClearRangeByPosition {
            start_row,
            start_col,
            end_row,
            end_col,
            ..
        }
        | EngineMutation::ClearRange {
            start_row,
            start_col,
            end_row,
            end_col,
            ..
        }
        | EngineMutation::ClearRangeAndReturnIds {
            start_row,
            start_col,
            end_row,
            end_col,
            ..
        }
        | EngineMutation::CreateSubtotals {
            start_row,
            start_col,
            end_row,
            end_col,
            ..
        } => {
            range::validate_range_bounds(*start_row, *start_col, *end_row, *end_col)?;
        }
        EngineMutation::SortRange {
            start_row,
            start_col,
            end_row,
            end_col,
            options,
            ..
        } => {
            range::validate_sort_criteria(&options.criteria)?;
            range::validate_range_bounds(*start_row, *start_col, *end_row, *end_col)?;
        }
        EngineMutation::CopyRange {
            src_start_row,
            src_start_col,
            src_end_row,
            src_end_col,
            target_row,
            target_col,
            transpose,
            ..
        } => {
            range::validate_range_bounds(
                *src_start_row,
                *src_start_col,
                *src_end_row,
                *src_end_col,
            )?;
            // Validate target extent (accounting for transpose)
            let (range_rows, range_cols) = if *transpose {
                (src_end_col - src_start_col, src_end_row - src_start_row)
            } else {
                (src_end_row - src_start_row, src_end_col - src_start_col)
            };
            range::validate_range_bounds(
                *target_row,
                *target_col,
                target_row + range_rows,
                target_col + range_cols,
            )?;
        }
        _ => {}
    }
    Ok(())
}
