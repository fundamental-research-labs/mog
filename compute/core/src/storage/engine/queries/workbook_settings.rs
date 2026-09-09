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
use crate::storage::engine::history::metadata::capture_workbook_settings;
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

pub(in crate::storage::engine) fn get_workbook_settings(
    engine: &ComputeEngine,
) -> WorkbookSettings {
    services::queries::get_workbook_settings(&engine.stores)
}

pub(in crate::storage::engine) fn get_formula_reference_diagnostics(
    engine: &ComputeEngine,
    options: FormulaReferenceDiagnosticsOptions,
) -> Result<FormulaReferenceDiagnosticsPage, ComputeError> {
    crate::diagnostics::formula_references::collect_formula_reference_diagnostics(
        &engine.cell_store,
        &engine.stores.compute,
        options,
    )
}

pub(in crate::storage::engine) fn set_workbook_settings(
    engine: &mut ComputeEngine,
    settings: WorkbookSettings,
) -> Result<MutationResult, ComputeError> {
    let pre = workbook::get_settings(&engine.stores.storage.metadata);
    let pre_json = serde_json::to_value(&pre).expect("WorkbookSettings must serialize");

    capture_workbook_settings(&engine.stores.storage);
    workbook::set_settings(&mut engine.stores.storage.metadata, &settings);
    let post = workbook::get_settings(&engine.stores.storage.metadata);
    engine.sync_runtime_workbook_settings(&pre, &post);

    let post_json = serde_json::to_value(&post).expect("WorkbookSettings must serialize");
    let changed_keys = diff_top_level_keys(&pre_json, &post_json);
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

pub(in crate::storage::engine) fn patch_workbook_settings(
    engine: &mut ComputeEngine,
    patch: RustWorkbookSettingsPatch,
) -> Result<MutationResult, ComputeError> {
    let pre = workbook::get_settings(&engine.stores.storage.metadata);
    let pre_json = serde_json::to_value(&pre).expect("WorkbookSettings must serialize");

    capture_workbook_settings(&engine.stores.storage);
    let changed = workbook::patch_settings(&mut engine.stores.storage.metadata, &patch);
    if !changed {
        return Ok(MutationResult::empty());
    }

    let post = workbook::get_settings(&engine.stores.storage.metadata);
    engine.sync_runtime_workbook_settings(&pre, &post);

    let post_json = serde_json::to_value(&post).expect("WorkbookSettings must serialize");
    let changed_keys = diff_top_level_keys(&pre_json, &post_json);
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
