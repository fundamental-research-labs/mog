use super::super::ComputeEngine;
use super::super::services::features as svc;
use crate::snapshot::MutationResult;
use cell_types::SheetId;
use value_types::ComputeError;

pub(super) fn sort_range(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: crate::storage::engine::mutation::BridgeSortOptions,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(
        crate::storage::engine::mutation::EngineMutation::SortRange {
            sheet_id: *sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            options,
        },
    )? {
        crate::storage::engine::mutation::MutationOutput::Recalc(r) => Ok(r),
        _ => Ok(MutationResult::empty()),
    }
}

pub(super) fn auto_fill(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    request: crate::engine_types::fill::BridgeAutoFillRequest,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(crate::storage::engine::mutation::EngineMutation::AutoFill {
        sheet_id: *sheet_id,
        request,
    })? {
        crate::storage::engine::mutation::MutationOutput::Recalc(r) => Ok(r),
        _ => Ok(MutationResult::empty()),
    }
}

pub(super) fn auto_fill_preview(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    request: crate::engine_types::fill::BridgeAutoFillRequest,
) -> Result<crate::engine_types::fill::BridgeAutoFillPreviewResult, ComputeError> {
    super::super::services::mutation_handlers::auto_fill_preview(
        &engine.stores,
        &engine.cell_store,
        sheet_id,
        request,
    )
}

pub(super) fn flash_fill(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    request: crate::engine_types::fill::BridgeFlashFillRequest,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(
        crate::storage::engine::mutation::EngineMutation::FlashFill {
            sheet_id: *sheet_id,
            request,
        },
    )? {
        crate::storage::engine::mutation::MutationOutput::Recalc(r) => Ok(r),
        _ => Ok(MutationResult::empty()),
    }
}

pub(super) fn copy_range(
    engine: &mut ComputeEngine,
    source_sheet_id: &SheetId,
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    target_sheet_id: &SheetId,
    target_row: u32,
    target_col: u32,
    copy_type: domain_types::domain::copy::CopyType,
    skip_blanks: bool,
    transpose: bool,
) -> Result<MutationResult, ComputeError> {
    let target_sheet = *target_sheet_id;
    match engine.apply_mutation(
        crate::storage::engine::mutation::EngineMutation::CopyRange {
            source_sheet_id: *source_sheet_id,
            src_start_row,
            src_start_col,
            src_end_row,
            src_end_col,
            target_sheet_id: target_sheet,
            target_row,
            target_col,
            copy_type,
            skip_blanks,
            transpose,
        },
    )? {
        crate::storage::engine::mutation::MutationOutput::Recalc(r) => Ok(r),
        _ => Ok(MutationResult::empty()),
    }
}

pub(super) fn remove_duplicates(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    columns: Vec<u32>,
    has_headers: bool,
) -> Result<MutationResult, ComputeError> {
    let sid = *sheet_id;
    match engine.apply_mutation(
        crate::storage::engine::mutation::EngineMutation::RemoveDuplicates {
            sheet_id: sid,
            start_row,
            start_col,
            end_row,
            end_col,
            columns,
            has_headers,
        },
    )? {
        crate::storage::engine::mutation::MutationOutput::Recalc(r) => Ok(r),
        _ => Ok(MutationResult::empty()),
    }
}

pub(super) fn check_sort_range_merges(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> serde_json::Value {
    svc::check_sort_range_merges(
        &engine.stores,
        &engine.cell_store,
        *sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
    )
}
