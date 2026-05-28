use super::super::YrsComputeEngine;
use super::super::services::advanced_filter as advanced_filter_svc;
use super::super::services::filters as filter_svc;
use crate::snapshot::MutationResult;
use crate::storage::sheet::filters;
use cell_types::SheetId;
use value_types::{CellValue, ComputeError};

pub(super) fn create_filter(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    config: serde_json::Value,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    // Filter creation can register the filter range on existing rows
    // (ghost-cell identity allocation). Row visibility for those rows
    // is unchanged at this step, but the viewport buffer must observe
    // the new filter shape (header arrows, criteria, etc.) — emit a
    // full viewport rebuild via the same path used by
    // `produce_cf_viewport_patches`. filter viewport R5.
    let result =
        filter_svc::create_filter(&mut engine.stores, &mut engine.mirror, sheet_id, config)?;
    let patches = engine.produce_cf_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn delete_filter(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let mut result =
        filter_svc::delete_filter(&mut engine.stores, &mut engine.mirror, sheet_id, filter_id)?;
    let mut recalc = engine.stores.compute.full_recalc(&mut engine.mirror)?;
    engine.prepare_recalc_for_flush(&mut recalc);
    result.recalc = recalc;
    engine.mutation.pending_recalc = None;
    Ok((engine.produce_full_viewport_patches(sheet_id), result))
}

pub(super) fn set_column_filter(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
    criteria: filters::ColumnFilter,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = filter_svc::set_column_filter(
        &mut engine.stores,
        &mut engine.mirror,
        sheet_id,
        filter_id,
        header_col,
        criteria,
    )?;
    let mut result = result;
    let mut recalc = engine.stores.compute.full_recalc(&mut engine.mirror)?;
    engine.prepare_recalc_for_flush(&mut recalc);
    result.recalc = recalc;
    engine.mutation.pending_recalc = None;
    Ok((engine.produce_full_viewport_patches(sheet_id), result))
}

pub(super) fn clear_column_filter(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = filter_svc::clear_column_filter(
        &mut engine.stores,
        &mut engine.mirror,
        sheet_id,
        filter_id,
        header_col,
    )?;
    let mut result = result;
    let mut recalc = engine.stores.compute.full_recalc(&mut engine.mirror)?;
    engine.prepare_recalc_for_flush(&mut recalc);
    result.recalc = recalc;
    engine.mutation.pending_recalc = None;
    Ok((engine.produce_full_viewport_patches(sheet_id), result))
}

pub(super) fn clear_all_column_filters(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = filter_svc::clear_all_column_filters(
        &mut engine.stores,
        &mut engine.mirror,
        sheet_id,
        filter_id,
    )?;
    let mut result = result;
    let mut recalc = engine.stores.compute.full_recalc(&mut engine.mirror)?;
    engine.prepare_recalc_for_flush(&mut recalc);
    result.recalc = recalc;
    engine.mutation.pending_recalc = None;
    Ok((engine.produce_full_viewport_patches(sheet_id), result))
}

pub(super) fn get_filters_in_sheet(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<filters::FilterState> {
    filter_svc::get_filters_in_sheet(&engine.stores, &engine.mirror, sheet_id)
}

pub(super) fn apply_advanced_filter(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    request: filters::AdvancedFilterRequest,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let mode = request.mode;
    let mut result = advanced_filter_svc::apply_advanced_filter(
        &mut engine.stores,
        &mut engine.mirror,
        &mut engine.mutation,
        sheet_id,
        request,
    )?;
    match mode {
        filters::AdvancedFilterMode::InPlace => {
            let mut recalc = engine.stores.compute.full_recalc(&mut engine.mirror)?;
            engine.prepare_recalc_for_flush(&mut recalc);
            result.recalc = recalc;
            engine.mutation.pending_recalc = None;
            Ok((engine.produce_full_viewport_patches(sheet_id), result))
        }
        filters::AdvancedFilterMode::CopyTo => {
            engine.prepare_recalc_for_flush(&mut result.recalc);
            Ok((engine.flush_viewport_patches(), result))
        }
    }
}

pub(super) fn apply_filter(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let mut result =
        filter_svc::apply_filter(&mut engine.stores, &mut engine.mirror, sheet_id, filter_id)?;

    // Recalculate so SUBTOTAL/AGGREGATE formulas pick up the new hidden-row
    // state immediately (they read `mirror.is_row_hidden()` during eval).
    let mut recalc = engine.stores.compute.full_recalc(&mut engine.mirror)?;
    // Run the standard post-recalc enrichment (CF cache refresh,
    // display text, validation) so the rebuild below reads a
    // consistent CF cache state for any cells whose visibility flipped.
    engine.prepare_recalc_for_flush(&mut recalc);
    // Discard the incremental recalc patch — the full viewport rebuild
    // below subsumes it and includes hidden-row layout state.
    result.recalc = recalc;
    engine.mutation.pending_recalc = None;
    let patches = engine.produce_cf_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn get_unique_column_values(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
) -> Vec<CellValue> {
    filter_svc::get_unique_column_values(
        &engine.stores,
        &engine.mirror,
        sheet_id,
        filter_id,
        header_col,
    )
}

pub(super) fn compute_dynamic_filter_serial_range(
    engine: &YrsComputeEngine,
    rule: filters::DynamicFilterRule,
) -> Option<(f64, f64)> {
    let now_serial = crate::eval::clock::get_current_serial_timestamp();
    let now_date = value_types::serial_to_date(now_serial)?;
    let table_rule = filters::convert_dynamic_rule(&rule);
    compute_table::compute_date_range_serial(&table_rule, now_date, chrono::Weekday::Sun)
}

pub(super) fn get_filter(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<filters::FilterState> {
    filter_svc::get_filter(&engine.stores, sheet_id, filter_id)
}

pub(super) fn get_filter_count(engine: &YrsComputeEngine, sheet_id: &SheetId) -> usize {
    filter_svc::get_filter_count(&engine.stores, sheet_id)
}

pub(super) fn get_table_filter(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    table_id: &str,
) -> Option<filters::FilterState> {
    filter_svc::get_table_filter(&engine.stores, sheet_id, table_id)
}

pub(super) fn get_active_filters(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<filters::FilterState> {
    filter_svc::get_active_filters(&engine.stores, sheet_id)
}

pub(super) fn get_active_filter_count(engine: &YrsComputeEngine, sheet_id: &SheetId) -> usize {
    filter_svc::get_active_filter_count(&engine.stores, sheet_id)
}

pub(super) fn set_filter_sort_state(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
    sort_state: Option<filters::FilterSortState>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    filter_svc::set_filter_sort_state(&mut engine.stores, sheet_id, filter_id, sort_state).map(
        |r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        },
    )
}

pub(super) fn get_filter_sort_state(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<filters::FilterSortState> {
    filter_svc::get_filter_sort_state(&engine.stores, sheet_id, filter_id)
}

pub(super) fn clear_all_filters(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    filter_svc::clear_all_filters(&mut engine.stores, sheet_id).map(|r| {
        (
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            r,
        )
    })
}

pub(super) fn get_filtered_record_count(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<filters::FilterRecordCount> {
    filter_svc::get_filtered_record_count(&engine.stores, &engine.mirror, sheet_id, filter_id)
}
