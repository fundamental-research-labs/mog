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
use crate::storage::engine::formula_read;
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

pub(in crate::storage::engine) fn get_cell_data(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<serde_json::Value> {
    if let Some(mut data) = services::queries::get_cell_data(&engine.stores, sheet_id, row, col) {
        let cell_id = if let Some(cell_id_hex) = data.get("cell_id").and_then(|v| v.as_str())
            && let Some(id_u128) = compute_document::hex::hex_to_id(cell_id_hex)
        {
            Some(cell_types::CellId::from_raw(id_u128))
        } else {
            None
        };
        if let Some(formula) = formula_read::formula_text_at(
            &engine.stores,
            &engine.mirror,
            sheet_id,
            row,
            col,
            cell_id.as_ref(),
        ) {
            data["formula"] = serde_json::Value::String(
                formula.strip_prefix('=').unwrap_or(&formula).to_string(),
            );
        }
        data["region"] = region_json(&engine.mirror, sheet_id, row, col);
        return Some(data);
    }
    let region = region_json(&engine.mirror, sheet_id, row, col);
    let formula =
        formula_read::formula_text_at(&engine.stores, &engine.mirror, sheet_id, row, col, None)
            .map(|f| f.strip_prefix('=').unwrap_or(&f).to_string());
    let value = cell_values::get_effective_value(&engine.mirror, sheet_id, row, col);
    match (value, &region) {
        (Some(v), _) if !v.is_null() => Some(serde_json::json!({
            "cell_id": serde_json::Value::Null,
            "row": row,
            "col": col,
            "value": cell_value_to_json(&v),
            "formula": formula,
            "region": region,
        })),
        (_, serde_json::Value::Object(_)) => Some(serde_json::json!({
            "cell_id": serde_json::Value::Null,
            "row": row,
            "col": col,
            "formula": formula,
            "region": region,
        })),
        _ => None,
    }
}

pub(in crate::storage::engine) fn get_cell_data_by_id_hex(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<serde_json::Value> {
    services::queries::get_cell_data_by_id_hex(&engine.stores, sheet_id, cell_id_hex)
}

pub(in crate::storage::engine) fn get_display_value(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> String {
    engine.format_cell_display(sheet_id, row, col)
}

pub(in crate::storage::engine) fn get_raw_value(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> String {
    if let Some(cell_id) = engine
        .mirror
        .resolve_cell_id(sheet_id, cell_types::SheetPos::new(row, col))
        && let Some(formula) = engine.stores.compute.get_formula(&cell_id)
    {
        return if formula.starts_with('=') {
            formula.to_string()
        } else {
            format!("={}", formula)
        };
    }
    if let Some(formula) = data_table_formula::formula_at(&engine.mirror, sheet_id, row, col) {
        return formula;
    }
    services::queries::get_raw_value(&engine.mirror, &engine.stores, sheet_id, row, col)
}

pub(in crate::storage::engine) fn get_effective_value(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<serde_json::Value> {
    services::queries::get_effective_value(&engine.mirror, sheet_id, row, col)
}

pub(in crate::storage::engine) fn get_cell_count(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> usize {
    services::queries::get_cell_count(&engine.stores, sheet_id)
}

pub(in crate::storage::engine) fn get_current_region(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
) -> RectBounds {
    services::queries::get_current_region(&engine.stores, sheet_id, start_row, start_col)
}

pub(in crate::storage::engine) fn find_data_edge(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    direction: &str,
) -> CellPosition {
    services::queries::find_data_edge(
        &engine.stores,
        &engine.mirror,
        sheet_id,
        row,
        col,
        direction,
    )
}

pub(in crate::storage::engine) fn find_last_row(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> ColumnEdge {
    services::queries::find_last_row(&engine.stores, &engine.mirror, sheet_id, col)
}

pub(in crate::storage::engine) fn find_last_column(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
) -> RowEdge {
    services::queries::find_last_column(&engine.stores, &engine.mirror, sheet_id, row)
}
