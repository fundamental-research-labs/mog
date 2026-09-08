#![allow(unused_imports, unused_variables)]
use super::helpers::{
    diff_top_level_keys, intended_patch_changed_keys, workbook_settings_origin_for_change,
};
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
use crate::eval_bridge::MirrorContext;
use crate::mirror::MirrorPositionLookup;
use crate::range_manager::{self, A1CellRef, A1RangeRef};
use crate::snapshot::{
    BatchRangeEntry, BatchRangeRequest, BatchRangeResponse, BatchRangeResult, CalculationSettings,
    ChangeKind, IdentityCell, MutationResult, ProtectedWorkbookOperation, RangeCellData,
    RangeQueryResult, RustWorkbookSettingsPatch, ViewportMerge, WorkbookProtectionOptions,
    WorkbookSettings, WorkbookSettingsChange,
};
use crate::storage::cells::values as cell_values;
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::query_serialization::{cell_value_to_json, region_json};
use crate::storage::engine::{data_table_formula, services};
use crate::storage::sheet::{hyperlinks, merges, properties as sheets};
use crate::storage::workbook::settings as workbook;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::undo::{ORIGIN_UI_STATE, ORIGIN_USER_EDIT};
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::domain::merge::{CellMergeInfo, MergeRegion, ResolvedMergedRegion};
use domain_types::domain::sheet::{FrozenPanes, SheetMeta, SheetScrollPosition, SheetViewOptions};
use domain_types::domain::slicer::{NamedSlicerStyle, SlicerCustomStyle};
use domain_types::{DefinedName, NameValidationResult};
use formula_types::WorkbookLookup;
use value_types::CellValue;
use value_types::ComputeError;

pub(in crate::storage::engine) fn get_workbook_settings(
    engine: &YrsComputeEngine,
) -> WorkbookSettings {
    services::queries::get_workbook_settings(&engine.stores)
}

pub(in crate::storage::engine) fn get_formula_reference_diagnostics(
    engine: &YrsComputeEngine,
    options: FormulaReferenceDiagnosticsOptions,
) -> Result<FormulaReferenceDiagnosticsPage, ComputeError> {
    crate::diagnostics::formula_references::collect_formula_reference_diagnostics(
        &engine.mirror,
        &engine.stores.compute,
        options,
    )
}

pub(in crate::storage::engine) fn set_workbook_settings(
    engine: &mut YrsComputeEngine,
    settings: WorkbookSettings,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let pre = workbook::get_settings(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
    );
    let desired_json = serde_json::to_value(&settings).expect("WorkbookSettings must serialize");
    let pre_json = serde_json::to_value(&pre).expect("WorkbookSettings must serialize");
    let intended_changed_keys = diff_top_level_keys(&pre_json, &desired_json);
    let origin = workbook_settings_origin_for_change(&intended_changed_keys);

    workbook::set_settings_with_origin(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        &settings,
        origin,
    );
    let post = workbook::get_settings(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
    );
    let pre_calc = pre.calculation_settings.clone().unwrap_or_default();
    let post_calc = post.calculation_settings.clone().unwrap_or_default();
    engine.sync_runtime_calculation_settings(&pre_calc, &post_calc);

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
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn patch_workbook_settings(
    engine: &mut YrsComputeEngine,
    patch: RustWorkbookSettingsPatch,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let pre = workbook::get_settings(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
    );
    let pre_json = serde_json::to_value(&pre).expect("WorkbookSettings must serialize");
    let intended_changed_keys = intended_patch_changed_keys(&patch);
    let origin = workbook_settings_origin_for_change(&intended_changed_keys);

    let changed = workbook::patch_settings_with_origin(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        &patch,
        origin,
    );
    if !changed {
        return Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ));
    }

    let post = workbook::get_settings(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
    );
    let pre_calc = pre.calculation_settings.clone().unwrap_or_default();
    let post_calc = post.calculation_settings.clone().unwrap_or_default();
    engine.sync_runtime_calculation_settings(&pre_calc, &post_calc);

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
    Ok((serialize_multi_viewport_patches(&[]), result))
}
