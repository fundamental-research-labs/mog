use super::super::YrsComputeEngine;
use super::super::services::features as svc;
use crate::snapshot::MutationResult;
use cell_types::SheetId;
use value_types::ComputeError;

pub(super) fn sort_range(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: crate::storage::engine::mutation::BridgeSortOptions,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
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
        crate::storage::engine::mutation::MutationOutput::Recalc(r) => {
            // Sorting changes positional identity. Range-backed imports do that
            // by reordering rowOrder while many visible values are unchanged, so
            // recalc.changed_cells is not a complete viewport invalidation set.
            // Rebuild registered sheet viewports from the post-sort engine state
            // so unchanged sparse/range-backed cells move visually with their rows.
            engine.mutation.pending_recalc = None;
            Ok((engine.produce_full_viewport_patches(sheet_id), r))
        }
        _ => Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(super) fn auto_fill(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    request: crate::engine_types::fill::BridgeAutoFillRequest,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(crate::storage::engine::mutation::EngineMutation::AutoFill {
        sheet_id: *sheet_id,
        request,
    })? {
        crate::storage::engine::mutation::MutationOutput::Recalc(r) => {
            Ok((engine.flush_viewport_patches(), r))
        }
        _ => Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(super) fn flash_fill(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    request: crate::engine_types::fill::BridgeFlashFillRequest,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(
        crate::storage::engine::mutation::EngineMutation::FlashFill {
            sheet_id: *sheet_id,
            request,
        },
    )? {
        crate::storage::engine::mutation::MutationOutput::Recalc(r) => {
            Ok((engine.flush_viewport_patches(), r))
        }
        _ => Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(super) fn copy_range(
    engine: &mut YrsComputeEngine,
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
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let cross_sheet = source_sheet_id != target_sheet_id;
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
        crate::storage::engine::mutation::MutationOutput::Recalc(r) => {
            let mut patches = engine.flush_viewport_patches();
            if cross_sheet {
                let target_full = engine.produce_full_viewport_patches(&target_sheet);
                patches =
                    compute_wire::mutation::concat_multi_viewport_patches(&[patches, target_full]);
            }
            Ok((patches, r))
        }
        _ => Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(super) fn remove_duplicates(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    columns: Vec<u32>,
    has_headers: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
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
        crate::storage::engine::mutation::MutationOutput::Recalc(r) => {
            // Discard the pending incremental recalc — the full
            // viewport rebuild subsumes it and captures the layout
            // collapse correctly.
            engine.mutation.pending_recalc = None;
            Ok((engine.produce_full_viewport_patches(&sid), r))
        }
        _ => Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(super) fn check_sort_range_merges(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> serde_json::Value {
    svc::check_sort_range_merges(
        &engine.stores,
        *sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
    )
}
