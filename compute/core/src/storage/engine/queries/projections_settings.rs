#![allow(unused_imports, unused_variables)]
use super::helpers::diff_top_level_keys;
use crate::cells::StorePositionLookup;
use crate::diagnostics::formula_references::{
    FormulaReferenceDiagnosticsOptions, FormulaReferenceDiagnosticsPage,
};
use crate::engine_types::{
    CellPosition, CellPositionResult, ColumnEdge, DataBounds, DefaultFont, ProjectionData,
    RectBounds, RegexSearchOptions, RegexSearchResult, RowEdge, SheetProtectionConfig,
    SignCheckOptions, SignCheckResult, WorkbookSearchResult,
};
use crate::eval::Evaluator;
use crate::eval::sync_block_on;
use crate::eval_bridge::EvalContext;
use crate::range_manager::{self, A1CellRef, A1RangeRef};
use crate::snapshot::{
    BatchRangeEntry, BatchRangeRequest, BatchRangeResponse, BatchRangeResult, CalculationSettings,
    ChangeKind, IdentityCell, MutationResult, ProtectedWorkbookOperation, RangeCellData,
    RangeQueryResult, RustWorkbookSettingsPatch, ViewportMerge, WorkbookProtectionOptions,
    WorkbookSettings, WorkbookSettingsChange,
};
use crate::storage::cells::values as cell_values;
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::history::metadata::{
    capture_workbook_field, capture_workbook_settings,
};
use crate::storage::engine::query_serialization::{cell_value_to_json, region_json};
use crate::storage::engine::{data_table_formula, services};
use crate::storage::sheet::{hyperlinks, merges, properties as sheets};
use crate::storage::workbook::settings as workbook;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use domain_types::domain::merge::{CellMergeInfo, MergeRegion, ResolvedMergedRegion};
use domain_types::domain::sheet::{FrozenPanes, SheetMeta, SheetScrollPosition, SheetViewOptions};
use domain_types::domain::slicer::{NamedSlicerStyle, SlicerCustomStyle};
use domain_types::{DefinedName, NameValidationResult};
use formula_types::WorkbookLookup;
use value_types::CellValue;
use value_types::ComputeError;

pub(in crate::storage::engine) fn get_projection_range(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<RectBounds> {
    services::queries::get_projection_range(&engine.cell_store, sheet_id, row, col)
}

pub(in crate::storage::engine) fn get_projection_source(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<SheetPos> {
    services::queries::get_projection_source(&engine.cell_store, sheet_id, row, col)
}

pub(in crate::storage::engine) fn get_viewport_projection_data(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<ProjectionData> {
    services::queries::get_viewport_projection_data(
        &engine.cell_store,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
    )
}

pub(in crate::storage::engine) fn get_calc_mode(engine: &ComputeEngine) -> String {
    services::queries::get_calc_mode(&engine.stores)
}

pub(in crate::storage::engine) fn get_default_font(engine: &ComputeEngine) -> DefaultFont {
    services::queries::get_default_font()
}

pub(in crate::storage::engine) fn get_workbook_setting(
    engine: &ComputeEngine,
    key: &str,
) -> Option<serde_json::Value> {
    services::queries::get_workbook_setting(&engine.stores, key)
}

pub(in crate::storage::engine) fn set_workbook_setting(
    engine: &mut ComputeEngine,
    key: &str,
    value: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let pre = workbook::get_settings(&engine.stores.storage.metadata);
    capture_workbook_settings(&engine.stores.storage);
    capture_workbook_field!(engine.stores.storage, default_slicer_style);
    capture_workbook_field!(engine.stores.storage, default_pivot_table_style);
    workbook::set_setting(&mut engine.stores.storage.metadata, key, value)?;
    let post = workbook::get_settings(&engine.stores.storage.metadata);
    engine.sync_runtime_workbook_settings(&pre, &post);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn reset_workbook_settings(
    engine: &mut ComputeEngine,
) -> Result<MutationResult, ComputeError> {
    let pre = workbook::get_settings(&engine.stores.storage.metadata);
    capture_workbook_settings(&engine.stores.storage);
    workbook::reset_settings(&mut engine.stores.storage.metadata);
    let post = workbook::get_settings(&engine.stores.storage.metadata);
    engine.sync_runtime_workbook_settings(&pre, &post);

    let pre_json = serde_json::to_value(&pre).expect("WorkbookSettings must serialize");
    let post_json = serde_json::to_value(&post).expect("WorkbookSettings must serialize");
    let changed_keys = diff_top_level_keys(&pre_json, &post_json);
    let mut result = MutationResult::empty();
    result
        .workbook_settings_changes
        .push(WorkbookSettingsChange {
            kind: ChangeKind::Removed,
            changed_keys,
            settings: post_json,
        });
    Ok(result)
}

pub(in crate::storage::engine) fn get_calculation_settings(
    engine: &ComputeEngine,
) -> CalculationSettings {
    services::queries::get_calculation_settings(&engine.stores)
}

pub(in crate::storage::engine) fn set_calculation_settings(
    engine: &mut ComputeEngine,
    settings: CalculationSettings,
) -> Result<MutationResult, ComputeError> {
    let pre_calc = workbook::get_calculation_settings(&engine.stores.storage.metadata);
    capture_workbook_field!(engine.stores.storage, settings.calculation_settings);
    workbook::set_calculation_settings(&mut engine.stores.storage.metadata, &settings);
    let post_calc = workbook::get_calculation_settings(&engine.stores.storage.metadata);
    engine.sync_runtime_calculation_settings(&pre_calc, &post_calc);

    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn is_iterative_calculation_enabled(engine: &ComputeEngine) -> bool {
    services::queries::is_iterative_calculation_enabled(&engine.stores)
}

pub(in crate::storage::engine) fn set_iterative_calculation_enabled(
    engine: &mut ComputeEngine,
    enabled: bool,
) -> Result<MutationResult, ComputeError> {
    let pre_calc = workbook::get_calculation_settings(&engine.stores.storage.metadata);
    capture_workbook_field!(engine.stores.storage, settings.calculation_settings);
    workbook::set_iterative_calculation_enabled(&mut engine.stores.storage.metadata, enabled);
    let post_calc = workbook::get_calculation_settings(&engine.stores.storage.metadata);
    engine.sync_runtime_calculation_settings(&pre_calc, &post_calc);

    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn protect_workbook(
    engine: &mut ComputeEngine,
    password_hash: Option<String>,
    options: Option<WorkbookProtectionOptions>,
) -> Result<MutationResult, ComputeError> {
    capture_workbook_field!(engine.stores.storage, settings.is_workbook_protected);
    capture_workbook_field!(engine.stores.storage, protection);
    workbook::protect_workbook(
        &mut engine.stores.storage.metadata,
        password_hash.as_deref(),
        options.as_ref(),
    );
    let post = workbook::get_settings(&engine.stores.storage.metadata);
    let post_json = serde_json::to_value(&post).expect("WorkbookSettings must serialize");
    let changed_keys = match &post_json {
        serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    let mut result = MutationResult::empty();
    result
        .workbook_settings_changes
        .push(WorkbookSettingsChange {
            kind: ChangeKind::Set,
            changed_keys,
            settings: post_json,
        });
    Ok(result)
}

pub(in crate::storage::engine) fn unprotect_workbook(
    engine: &mut ComputeEngine,
    password_hash: Option<String>,
) -> Result<MutationResult, ComputeError> {
    capture_workbook_field!(engine.stores.storage, settings.is_workbook_protected);
    capture_workbook_field!(engine.stores.storage, protection);
    let success = workbook::unprotect_workbook(
        &mut engine.stores.storage.metadata,
        password_hash.as_deref(),
    );
    let post = workbook::get_settings(&engine.stores.storage.metadata);
    let post_json = serde_json::to_value(&post).expect("WorkbookSettings must serialize");
    let changed_keys = match &post_json {
        serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    let mut result = MutationResult::empty().with_data(&success)?;
    result
        .workbook_settings_changes
        .push(WorkbookSettingsChange {
            kind: ChangeKind::Set,
            changed_keys,
            settings: post_json,
        });
    Ok(result)
}

pub(in crate::storage::engine) fn get_workbook_protection_options(
    engine: &ComputeEngine,
) -> WorkbookProtectionOptions {
    services::queries::get_workbook_protection_options(&engine.stores)
}

pub(in crate::storage::engine) fn has_workbook_protection_password(engine: &ComputeEngine) -> bool {
    services::queries::has_workbook_protection_password(&engine.stores)
}

pub(in crate::storage::engine) fn is_workbook_protected(engine: &ComputeEngine) -> bool {
    services::queries::is_workbook_protected(&engine.stores)
}

pub(in crate::storage::engine) fn is_workbook_operation_allowed(
    engine: &ComputeEngine,
    operation: ProtectedWorkbookOperation,
) -> Result<bool, ComputeError> {
    services::queries::is_workbook_operation_allowed(&engine.stores, operation)
}

pub(in crate::storage::engine) fn set_default_table_style_id(
    engine: &mut ComputeEngine,
    style_id: Option<String>,
) -> Result<MutationResult, ComputeError> {
    capture_workbook_field!(engine.stores.storage, settings.default_table_style_id);
    workbook::set_default_table_style_id(&mut engine.stores.storage.metadata, style_id.as_deref());
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn get_default_table_style_id(
    engine: &ComputeEngine,
) -> Option<String> {
    services::queries::get_default_table_style_id(&engine.stores)
}

pub(in crate::storage::engine) fn set_default_slicer_style(
    engine: &mut ComputeEngine,
    style_id: Option<String>,
) -> Result<MutationResult, ComputeError> {
    capture_workbook_field!(engine.stores.storage, default_slicer_style);
    workbook::set_default_slicer_style(&mut engine.stores.storage.metadata, style_id.as_deref());
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn get_default_slicer_style(
    engine: &ComputeEngine,
) -> Option<String> {
    services::queries::get_default_slicer_style(&engine.stores)
}
