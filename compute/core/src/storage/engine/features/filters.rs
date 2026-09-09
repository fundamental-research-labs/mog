use super::super::ComputeEngine;
use super::super::services::advanced_filter as advanced_filter_svc;
use super::super::services::filters as filter_svc;
use crate::snapshot::MutationResult;
use crate::storage::sheet::filters;
use cell_types::SheetId;
use value_types::{CellValue, ComputeError};

fn finish_filter_mutation(
    engine: &mut ComputeEngine,
    mut result: MutationResult,
) -> MutationResult {
    engine.assign_and_record_runtime_diagnostics(&mut result.diagnostics);
    result
}

fn ensure_filter_full_recalc_ready(engine: &ComputeEngine) -> Result<(), ComputeError> {
    engine.stores.compute.ensure_graph_construction_ready()
}

pub(super) fn create_filter(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    config: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    // Filter creation can register the filter range on existing rows
    // (ghost-cell identity allocation). Row visibility for those rows
    // is unchanged at this step, but the viewport buffer must observe
    // the new filter shape (header arrows, criteria, etc.) — emit a
    // full viewport rebuild via the same path used by
    // `produce_cf_viewport_patches`. filter viewport R5.
    let result =
        filter_svc::create_filter(&mut engine.stores, &mut engine.cell_store, sheet_id, config)?;

    Ok(finish_filter_mutation(engine, result))
}

pub(super) fn delete_filter(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<MutationResult, ComputeError> {
    ensure_filter_full_recalc_ready(engine)?;
    let mut result = filter_svc::delete_filter(
        &mut engine.stores,
        &mut engine.cell_store,
        sheet_id,
        filter_id,
    )?;
    let mut recalc = engine.stores.compute.full_recalc(&mut engine.cell_store)?;
    engine.postprocess_mutation_recalc(&mut recalc);
    result.recalc = recalc;

    Ok(finish_filter_mutation(engine, result))
}

pub(super) fn set_column_filter(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
    criteria: filters::ColumnFilter,
) -> Result<MutationResult, ComputeError> {
    ensure_filter_full_recalc_ready(engine)?;
    let result = filter_svc::set_column_filter(
        &mut engine.stores,
        &mut engine.cell_store,
        &engine.settings,
        sheet_id,
        filter_id,
        header_col,
        criteria,
    )?;
    let mut result = result;
    let mut recalc = engine.stores.compute.full_recalc(&mut engine.cell_store)?;
    engine.postprocess_mutation_recalc(&mut recalc);
    result.recalc = recalc;

    Ok(finish_filter_mutation(engine, result))
}

pub(super) fn clear_column_filter(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
) -> Result<MutationResult, ComputeError> {
    ensure_filter_full_recalc_ready(engine)?;
    let result = filter_svc::clear_column_filter(
        &mut engine.stores,
        &mut engine.cell_store,
        &engine.settings,
        sheet_id,
        filter_id,
        header_col,
    )?;
    let mut result = result;
    let mut recalc = engine.stores.compute.full_recalc(&mut engine.cell_store)?;
    engine.postprocess_mutation_recalc(&mut recalc);
    result.recalc = recalc;

    Ok(finish_filter_mutation(engine, result))
}

pub(super) fn clear_all_column_filters(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<MutationResult, ComputeError> {
    ensure_filter_full_recalc_ready(engine)?;
    let result = filter_svc::clear_all_column_filters(
        &mut engine.stores,
        &mut engine.cell_store,
        &engine.settings,
        sheet_id,
        filter_id,
    )?;
    let mut result = result;
    let mut recalc = engine.stores.compute.full_recalc(&mut engine.cell_store)?;
    engine.postprocess_mutation_recalc(&mut recalc);
    result.recalc = recalc;

    Ok(finish_filter_mutation(engine, result))
}

pub(super) fn get_filters_in_sheet(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<filters::FilterState> {
    filter_svc::get_filters_in_sheet(&engine.stores, &engine.cell_store, sheet_id)
}

pub(super) fn get_filter_header_info(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<filters::FilterHeaderInfo> {
    filter_svc::get_filter_header_info(&engine.stores, &engine.cell_store, sheet_id)
}

pub(super) fn apply_advanced_filter(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    request: filters::AdvancedFilterRequest,
) -> Result<MutationResult, ComputeError> {
    let mode = request.mode;
    if matches!(mode, filters::AdvancedFilterMode::InPlace) {
        ensure_filter_full_recalc_ready(engine)?;
    }
    let mut result = advanced_filter_svc::apply_advanced_filter(
        &mut engine.stores,
        &mut engine.cell_store,
        sheet_id,
        request,
    )?;
    match mode {
        filters::AdvancedFilterMode::InPlace => {
            let mut recalc = engine.stores.compute.full_recalc(&mut engine.cell_store)?;
            engine.postprocess_mutation_recalc(&mut recalc);
            result.recalc = recalc;

            Ok(finish_filter_mutation(engine, result))
        }
        filters::AdvancedFilterMode::CopyTo => {
            engine.postprocess_mutation_recalc(&mut result.recalc);

            Ok(finish_filter_mutation(engine, result))
        }
    }
}

pub(super) fn apply_filter(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<MutationResult, ComputeError> {
    ensure_filter_full_recalc_ready(engine)?;
    let result = filter_svc::apply_filter(
        &mut engine.stores,
        &mut engine.cell_store,
        &engine.settings,
        sheet_id,
        filter_id,
    )?;
    finish_filter_apply(engine, result)
}

pub(super) fn reapply_filter(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Result<MutationResult, ComputeError> {
    ensure_filter_full_recalc_ready(engine)?;
    let result = filter_svc::reapply_filter(
        &mut engine.stores,
        &mut engine.cell_store,
        &engine.settings,
        sheet_id,
        filter_id,
    )?;
    finish_filter_apply(engine, result)
}

fn finish_filter_apply(
    engine: &mut ComputeEngine,
    mut result: MutationResult,
) -> Result<MutationResult, ComputeError> {
    // Recalculate so SUBTOTAL/AGGREGATE formulas pick up the new hidden-row
    // state immediately (they read `cell_store.is_row_hidden()` during eval).
    let mut recalc = engine.stores.compute.full_recalc(&mut engine.cell_store)?;
    // Run the standard post-recalc enrichment (CF cache refresh,
    // display text, validation) for cells affected by visibility changes.
    engine.postprocess_mutation_recalc(&mut recalc);
    result.recalc = recalc;

    Ok(finish_filter_mutation(engine, result))
}

pub(super) fn get_unique_column_values(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
) -> Vec<CellValue> {
    filter_svc::get_unique_column_values(
        &engine.stores,
        &engine.cell_store,
        sheet_id,
        filter_id,
        header_col,
    )
}

pub(super) fn compute_dynamic_filter_serial_range(
    _engine: &ComputeEngine,
    rule: filters::DynamicFilterRule,
) -> Option<(f64, f64)> {
    let now_serial = crate::eval::clock::get_current_serial_timestamp();
    let now_date = value_types::serial_to_date(now_serial)?;
    let table_rule = filters::convert_dynamic_rule(&rule);
    compute_table::compute_date_range_serial(&table_rule, now_date, chrono::Weekday::Sun)
}

pub(super) fn get_filter(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<filters::FilterState> {
    filter_svc::get_filter(&engine.stores, sheet_id, filter_id)
}

pub(super) fn get_filter_count(engine: &ComputeEngine, sheet_id: &SheetId) -> usize {
    filter_svc::get_filter_count(&engine.stores, sheet_id)
}

pub(super) fn get_table_filter(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    table_id: &str,
) -> Option<filters::FilterState> {
    filter_svc::get_table_filter(&engine.stores, sheet_id, table_id)
}

pub(super) fn get_active_filters(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<filters::FilterState> {
    filter_svc::get_active_filters(&engine.stores, sheet_id)
}

pub(super) fn get_active_filter_count(engine: &ComputeEngine, sheet_id: &SheetId) -> usize {
    filter_svc::get_active_filter_count(&engine.stores, sheet_id)
}

pub(super) fn set_filter_sort_state(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
    sort_state: Option<filters::FilterSortState>,
) -> Result<MutationResult, ComputeError> {
    let result =
        filter_svc::set_filter_sort_state(&mut engine.stores, sheet_id, filter_id, sort_state)?;
    Ok(finish_filter_mutation(engine, result))
}

pub(super) fn get_filter_sort_state(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<filters::FilterSortState> {
    filter_svc::get_filter_sort_state(&engine.stores, sheet_id, filter_id)
}

pub(super) fn clear_all_filters(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    ensure_filter_full_recalc_ready(engine)?;
    let mut result =
        filter_svc::clear_all_filters(&mut engine.stores, &mut engine.cell_store, sheet_id)?;
    let mut recalc = engine.stores.compute.full_recalc(&mut engine.cell_store)?;
    engine.postprocess_mutation_recalc(&mut recalc);
    result.recalc = recalc;

    Ok(finish_filter_mutation(engine, result))
}

pub(super) fn get_filtered_record_count(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<filters::FilterRecordCount> {
    filter_svc::get_filtered_record_count(
        &engine.stores,
        &engine.cell_store,
        &engine.settings,
        sheet_id,
        filter_id,
    )
}
