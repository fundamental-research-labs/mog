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
        .all(|key| key.as_str() == "selectedSheetIds")
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

pub(in crate::storage::engine) fn get_slicer_style_count(engine: &YrsComputeEngine) -> u32 {
    services::queries::get_named_slicer_style_count(&engine.stores)
}

pub(in crate::storage::engine) fn get_slicer_style(
    engine: &YrsComputeEngine,
    name: &str,
) -> Option<NamedSlicerStyle> {
    services::queries::get_named_slicer_style(&engine.stores, name)
}

pub(in crate::storage::engine) fn list_slicer_styles(
    engine: &YrsComputeEngine,
) -> Vec<NamedSlicerStyle> {
    services::queries::list_named_slicer_styles(&engine.stores)
}

pub(in crate::storage::engine) fn add_slicer_style(
    engine: &mut YrsComputeEngine,
    name: &str,
    style: SlicerCustomStyle,
    make_unique_name: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let final_name = workbook::add_named_slicer_style(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        name,
        style,
        make_unique_name,
    )?;
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty().with_data(&final_name)?,
    ))
}

pub(in crate::storage::engine) fn delete_slicer_style(
    engine: &mut YrsComputeEngine,
    name: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    workbook::delete_named_slicer_style(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        name,
    )?;
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn duplicate_slicer_style(
    engine: &mut YrsComputeEngine,
    name: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let new_name = workbook::duplicate_named_slicer_style(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        name,
    )?;
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty().with_data(&new_name)?,
    ))
}

pub(in crate::storage::engine) fn set_default_pivot_table_style(
    engine: &mut YrsComputeEngine,
    style_id: Option<String>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    workbook::set_default_pivot_table_style(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        style_id.as_deref(),
    );
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn get_default_pivot_table_style(
    engine: &YrsComputeEngine,
) -> Option<String> {
    services::queries::get_default_pivot_table_style(&engine.stores)
}

pub(in crate::storage::engine) fn get_custom_setting(
    engine: &YrsComputeEngine,
    key: &str,
) -> Option<String> {
    services::queries::get_custom_setting(&engine.stores, key)
}

pub(in crate::storage::engine) fn set_custom_setting(
    engine: &mut YrsComputeEngine,
    key: &str,
    value: Option<String>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    workbook::set_custom_setting(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        key,
        value.as_deref(),
    );
    Ok((
        serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(in crate::storage::engine) fn list_custom_settings(
    engine: &YrsComputeEngine,
) -> Vec<(String, String)> {
    services::queries::list_custom_settings(&engine.stores)
}

pub(in crate::storage::engine) fn get_named_range_by_id(
    engine: &YrsComputeEngine,
    id: &str,
) -> Option<DefinedName> {
    services::queries::get_named_range_by_id(&engine.stores, id)
}

pub(in crate::storage::engine) fn get_named_range_by_name(
    engine: &YrsComputeEngine,
    name: &str,
    scope: Option<String>,
) -> Option<DefinedName> {
    services::queries::get_named_range_by_name(&engine.stores, name, scope.as_deref())
}

pub(in crate::storage::engine) fn get_named_ranges_by_scope(
    engine: &YrsComputeEngine,
    scope: Option<String>,
) -> Vec<DefinedName> {
    services::queries::get_named_ranges_by_scope(&engine.stores, scope.as_deref())
}

pub(in crate::storage::engine) fn get_visible_named_ranges(
    engine: &YrsComputeEngine,
) -> Vec<DefinedName> {
    services::queries::get_visible_named_ranges(&engine.stores)
}

pub(in crate::storage::engine) fn named_range_exists(
    engine: &YrsComputeEngine,
    name: &str,
    scope: Option<String>,
) -> bool {
    services::queries::named_range_exists(&engine.stores, name, scope.as_deref())
}

pub(in crate::storage::engine) fn named_range_count(engine: &YrsComputeEngine) -> usize {
    services::queries::named_range_count(&engine.stores)
}

pub(in crate::storage::engine) fn validate_named_range_name(
    engine: &YrsComputeEngine,
    name: &str,
    scope: Option<String>,
    exclude_id: Option<String>,
) -> NameValidationResult {
    services::queries::validate_named_range_name(
        &engine.stores,
        name,
        scope.as_deref(),
        exclude_id.as_deref(),
    )
}

pub(in crate::storage::engine) fn resolve_named_range(
    engine: &YrsComputeEngine,
    name: &str,
    current_sheet: Option<String>,
) -> Option<DefinedName> {
    services::queries::resolve_named_range(&engine.stores, name, current_sheet.as_deref())
}

pub(in crate::storage::engine) fn get_visible_sheet_ids(engine: &YrsComputeEngine) -> Vec<String> {
    services::queries::get_visible_sheet_ids(&engine.stores)
}

pub(in crate::storage::engine) fn get_hidden_sheet_ids(engine: &YrsComputeEngine) -> Vec<String> {
    services::queries::get_hidden_sheet_ids(&engine.stores)
}

pub(in crate::storage::engine) fn count_visible_sheets(engine: &YrsComputeEngine) -> u32 {
    services::queries::count_visible_sheets(&engine.stores)
}

pub(in crate::storage::engine) fn get_sheet_order(engine: &YrsComputeEngine) -> Vec<String> {
    services::queries::get_sheet_order(&engine.stores)
}

pub(in crate::storage::engine) fn get_first_sheet_id(engine: &YrsComputeEngine) -> Option<String> {
    services::queries::get_first_sheet_id(&engine.stores)
}

pub(in crate::storage::engine) fn get_print_settings(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> domain_types::domain::print::PrintSettings {
    services::queries::get_print_settings(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_hf_images(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<domain_types::domain::print::HeaderFooterImageInfo> {
    services::queries::get_hf_images(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_sheet_meta(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Option<SheetMeta> {
    services::queries::get_sheet_meta(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn has_sheet_protection_password(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> bool {
    services::queries::has_sheet_protection_password(&engine.stores, sheet_id)
}
