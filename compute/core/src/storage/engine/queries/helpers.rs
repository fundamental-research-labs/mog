//! Shared helpers for query submodules.

use crate::snapshot::RustWorkbookSettingsPatch;
use compute_document::undo::{ORIGIN_UI_STATE, ORIGIN_USER_EDIT};
use value_types::CellValue;

pub(super) fn diff_top_level_keys(
    pre: &serde_json::Value,
    post: &serde_json::Value,
) -> Vec<String> {
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

pub(super) fn workbook_settings_origin_for_change(changed_keys: &[String]) -> &'static [u8] {
    if changed_keys
        .iter()
        .all(|key| matches!(key.as_str(), "selectedSheetIds" | "customSettings"))
    {
        ORIGIN_UI_STATE
    } else {
        ORIGIN_USER_EDIT
    }
}

pub(super) fn intended_patch_changed_keys(patch: &RustWorkbookSettingsPatch) -> Vec<String> {
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

pub(super) fn cell_value_to_type_string(value: Option<&CellValue>) -> &'static str {
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
