#![allow(unused_imports, unused_variables)]
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

fn diff_top_level_keys(pre: &serde_json::Value, post: &serde_json::Value) -> Vec<String> {
    match (pre.as_object(), post.as_object()) {
        (Some(pre_map), Some(post_map)) => {
            let mut keys: Vec<String> = Vec::new();
            for (k, v_post) in post_map {
                match pre_map.get(k) {
                    Some(v_pre) if v_pre == v_post => {}
                    _ => keys.push(k.clone()),
                }
            }
            for k in pre_map.keys() {
                if !post_map.contains_key(k) {
                    keys.push(k.clone());
                }
            }
            keys
        }
        (None, Some(post_map)) => post_map.keys().cloned().collect(),
        _ => Vec::new(),
    }
}
fn workbook_settings_origin_for_change(changed_keys: &[String]) -> &'static [u8] {
    if changed_keys
        .iter()
        .all(|key| matches!(key.as_str(), "selectedSheetIds" | "customSettings"))
    {
        ORIGIN_UI_STATE
    } else {
        ORIGIN_USER_EDIT
    }
}
fn intended_patch_changed_keys(patch: &RustWorkbookSettingsPatch) -> Vec<String> {
    let mut keys = Vec::new();
    macro_rules! push_if_some {
        ($field:expr, $key:literal) => {
            if $field.is_some() {
                keys.push($key.to_string());
            }
        };
    }
    push_if_some!(patch.show_horizontal_scrollbar, "showHorizontalScrollbar");
    push_if_some!(patch.show_vertical_scrollbar, "showVerticalScrollbar");
    push_if_some!(patch.auto_hide_scroll_bars, "autoHideScrollBars");
    push_if_some!(patch.show_tab_strip, "showTabStrip");
    push_if_some!(patch.show_formula_bar, "showFormulaBar");
    push_if_some!(patch.allow_sheet_reorder, "allowSheetReorder");
    push_if_some!(patch.auto_fit_on_double_click, "autoFitOnDoubleClick");
    push_if_some!(patch.show_cut_copy_indicator, "showCutCopyIndicator");
    push_if_some!(patch.allow_drag_fill, "allowDragFill");
    push_if_some!(patch.enter_key_direction, "enterKeyDirection");
    push_if_some!(patch.allow_cell_drag_drop, "allowCellDragDrop");
    push_if_some!(patch.theme_id, "themeId");
    push_if_some!(patch.theme_fonts_id, "themeFontsId");
    push_if_some!(patch.culture, "culture");
    push_if_some!(patch.selected_sheet_ids, "selectedSheetIds");
    push_if_some!(patch.is_workbook_protected, "isWorkbookProtected");
    push_if_some!(
        patch.workbook_protection_password_hash,
        "workbookProtectionPasswordHash"
    );
    push_if_some!(
        patch.workbook_protection_options,
        "workbookProtectionOptions"
    );
    push_if_some!(patch.calculation_settings, "calculationSettings");
    push_if_some!(patch.date1904, "date1904");
    push_if_some!(patch.default_table_style_id, "defaultTableStyleId");
    push_if_some!(patch.custom_settings, "customSettings");
    push_if_some!(
        patch.automatic_conversion_policy,
        "automaticConversionPolicy"
    );
    keys
}
fn cell_value_to_type_string(value: Option<&CellValue>) -> &'static str {
    match value {
        None | Some(CellValue::Null) => "String",
        Some(CellValue::Number(n)) => {
            if n.get().fract() == 0.0 && n.get().abs() < (i32::MAX as f64) {
                "Integer"
            } else {
                "Double"
            }
        }
        Some(CellValue::Text(_)) => "String",
        Some(CellValue::Boolean(_)) => "Boolean",
        Some(CellValue::Error(..)) => "Error",
        Some(CellValue::Array(_)) => "Array",
        Some(CellValue::Control(_)) => "Boolean",
        Some(CellValue::Image(_)) => "String",
    }
}

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
