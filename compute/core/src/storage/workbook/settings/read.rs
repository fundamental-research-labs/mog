use yrs::{Any, Doc, Map, MapRef, Out, Transact};

use crate::snapshot::{AutomaticConversionPolicy, WorkbookProtectionOptions, WorkbookSettings};
use crate::storage::infra::yrs_helpers::{any_to_json, read_bool, read_json, read_string};
use domain_types::yrs_schema::protection as protection_schema;

use super::map::get_settings_map;

pub fn get_settings(doc: &Doc, workbook: &MapRef) -> WorkbookSettings {
    let txn = doc.transact();
    let settings_map = get_settings_map(workbook, &txn);
    build_settings_from_map(settings_map.as_ref(), &txn)
}

/// Get a single workbook setting value as a JSON value.
///
/// Returns `None` if the setting is not present in the Yrs document.
/// Callers should fall back to the default from `WorkbookSettings::default()`.
pub fn get_setting(doc: &Doc, workbook: &MapRef, key: &str) -> Option<serde_json::Value> {
    let txn = doc.transact();
    let settings_map = get_settings_map(workbook, &txn)?;
    match settings_map.get(&txn, key) {
        Some(Out::Any(Any::String(s))) => Some(serde_json::Value::String(s.to_string())),
        Some(Out::Any(Any::Bool(b))) => Some(serde_json::Value::Bool(b)),
        Some(Out::Any(Any::Number(n))) => {
            serde_json::Number::from_f64(n).map(serde_json::Value::Number)
        }
        Some(Out::Any(Any::Null)) => Some(serde_json::Value::Null),
        Some(Out::Any(any @ Any::Map(_))) | Some(Out::Any(any @ Any::Array(_))) => {
            Some(any_to_json(&any))
        }
        _ => None,
    }
}

/// Build a `WorkbookSettings` from a Yrs map, using defaults for missing fields.
pub(super) fn build_settings_from_map<T: yrs::ReadTxn>(
    settings_map: Option<&MapRef>,
    txn: &T,
) -> WorkbookSettings {
    let defaults = WorkbookSettings::default();

    let Some(map) = settings_map else {
        return defaults;
    };

    WorkbookSettings {
        show_horizontal_scrollbar: read_bool(map, txn, "showHorizontalScrollbar")
            .unwrap_or(defaults.show_horizontal_scrollbar),
        show_vertical_scrollbar: read_bool(map, txn, "showVerticalScrollbar")
            .unwrap_or(defaults.show_vertical_scrollbar),
        auto_hide_scroll_bars: read_bool(map, txn, "autoHideScrollBars")
            .unwrap_or(defaults.auto_hide_scroll_bars),
        show_tab_strip: read_bool(map, txn, "showTabStrip").unwrap_or(defaults.show_tab_strip),
        show_formula_bar: read_bool(map, txn, "showFormulaBar")
            .unwrap_or(defaults.show_formula_bar),
        allow_sheet_reorder: read_bool(map, txn, "allowSheetReorder")
            .unwrap_or(defaults.allow_sheet_reorder),
        auto_fit_on_double_click: read_bool(map, txn, "autoFitOnDoubleClick")
            .unwrap_or(defaults.auto_fit_on_double_click),
        show_cut_copy_indicator: read_bool(map, txn, "showCutCopyIndicator")
            .unwrap_or(defaults.show_cut_copy_indicator),
        allow_drag_fill: read_bool(map, txn, "allowDragFill").unwrap_or(defaults.allow_drag_fill),
        enter_key_direction: read_json(map, txn, "enterKeyDirection")
            .unwrap_or(defaults.enter_key_direction),
        allow_cell_drag_drop: read_bool(map, txn, "allowCellDragDrop")
            .unwrap_or(defaults.allow_cell_drag_drop),
        theme_id: read_string(map, txn, "themeId").unwrap_or(defaults.theme_id),
        theme_fonts_id: read_string(map, txn, "themeFontsId"),
        culture: read_string(map, txn, "culture").unwrap_or(defaults.culture),
        selected_sheet_ids: read_json(map, txn, "selectedSheetIds"),
        // Read protection from structured "protection" sub-map.
        is_workbook_protected: match map.get(txn, "protection") {
            Some(Out::YMap(prot_map)) => {
                read_bool(&prot_map, txn, protection_schema::KEY_WB_IS_PROTECTED)
                    .unwrap_or(defaults.is_workbook_protected)
            }
            _ => defaults.is_workbook_protected,
        },
        workbook_protection_password_hash: match map.get(txn, "protection") {
            Some(Out::YMap(prot_map)) => {
                match protection_schema::workbook_from_yrs_map(&prot_map, txn) {
                    Some(prot) => prot.workbook_hash_value,
                    None => None,
                }
            }
            _ => None,
        },
        workbook_protection_options: match map.get(txn, "protection") {
            Some(Out::YMap(prot_map)) => {
                match protection_schema::workbook_from_yrs_map(&prot_map, txn) {
                    Some(prot) => Some(WorkbookProtectionOptions {
                        structure: prot.lock_structure,
                    }),
                    None => None,
                }
            }
            _ => None,
        },
        calculation_settings: read_json(map, txn, "calculationSettings"),
        default_table_style_id: read_string(map, txn, "defaultTableStyleId"),
        date1904: read_bool(map, txn, "date1904").unwrap_or(false),
        custom_settings: {
            match map.get(txn, "customSettings") {
                Some(Out::YMap(custom_map)) => {
                    let mut result = std::collections::HashMap::new();
                    for (key, value) in custom_map.iter(txn) {
                        if let Out::Any(Any::String(v)) = value {
                            result
                                .insert(key.to_string(), serde_json::Value::String(v.to_string()));
                        }
                    }
                    if result.is_empty() {
                        None
                    } else {
                        Some(result)
                    }
                }
                _ => None,
            }
        },
        automatic_conversion_policy: read_automatic_conversion_policy(map, txn)
            .unwrap_or(defaults.automatic_conversion_policy),
    }
}

pub(super) fn read_automatic_conversion_policy<T: yrs::ReadTxn>(
    map: &MapRef,
    txn: &T,
) -> Option<AutomaticConversionPolicy> {
    match map.get(txn, "automaticConversionPolicy") {
        Some(Out::YMap(policy_map)) => {
            let defaults = AutomaticConversionPolicy::default();
            Some(AutomaticConversionPolicy {
                convert_date_like_text: read_bool(&policy_map, txn, "convertDateLikeText")
                    .unwrap_or(defaults.convert_date_like_text),
                convert_time_like_text: read_bool(&policy_map, txn, "convertTimeLikeText")
                    .unwrap_or(defaults.convert_time_like_text),
                convert_fraction_like_text: read_bool(&policy_map, txn, "convertFractionLikeText")
                    .unwrap_or(defaults.convert_fraction_like_text),
                convert_scientific_notation: read_bool(
                    &policy_map,
                    txn,
                    "convertScientificNotation",
                )
                .unwrap_or(defaults.convert_scientific_notation),
                convert_leading_zero_numbers: read_bool(
                    &policy_map,
                    txn,
                    "convertLeadingZeroNumbers",
                )
                .unwrap_or(defaults.convert_leading_zero_numbers),
                convert_long_digit_numbers: read_bool(&policy_map, txn, "convertLongDigitNumbers")
                    .unwrap_or(defaults.convert_long_digit_numbers),
                convert_percent_suffix: read_bool(&policy_map, txn, "convertPercentSuffix")
                    .unwrap_or(defaults.convert_percent_suffix),
                convert_currency_symbol: read_bool(&policy_map, txn, "convertCurrencySymbol")
                    .unwrap_or(defaults.convert_currency_symbol),
                convert_formatted_numbers: read_bool(&policy_map, txn, "convertFormattedNumbers")
                    .unwrap_or(defaults.convert_formatted_numbers),
            })
        }
        Some(Out::Any(Any::Map(_))) | Some(Out::Any(Any::String(_))) => {
            read_json(map, txn, "automaticConversionPolicy")
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Calculation settings helpers
// ---------------------------------------------------------------------------
