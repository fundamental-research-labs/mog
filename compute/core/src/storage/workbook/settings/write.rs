use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::snapshot::{
    AutomaticConversionPolicy, AutomaticConversionPolicyPatch, RustWorkbookSettingsPatch,
    WorkbookSettings,
};

use super::map::{ensure_settings_map, json_to_any};
use super::read::get_settings;

pub fn set_setting(doc: &Doc, workbook: &MapRef, key: &str, value: serde_json::Value) {
    set_setting_with_origin(doc, workbook, key, value, ORIGIN_USER_EDIT);
}

/// Set a single workbook setting with an explicit undo origin.
pub fn set_setting_with_origin(
    doc: &Doc,
    workbook: &MapRef,
    key: &str,
    value: serde_json::Value,
    origin: &'static [u8],
) {
    let mut txn = doc.transact_mut_with(Origin::from(origin));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    let any_value = json_to_any(&value);
    settings_map.insert(&mut txn, key, any_value);
}

/// Set multiple workbook settings at once within a single transaction.
pub fn set_settings(doc: &Doc, workbook: &MapRef, updates: &WorkbookSettings) {
    set_settings_with_origin(doc, workbook, updates, ORIGIN_USER_EDIT);
}

/// Set multiple workbook settings at once with an explicit undo origin.
pub fn set_settings_with_origin(
    doc: &Doc,
    workbook: &MapRef,
    updates: &WorkbookSettings,
    origin: &'static [u8],
) {
    let mut txn = doc.transact_mut_with(Origin::from(origin));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    // Serialize WorkbookSettings to JSON, then write each field
    if let Ok(json_val) = serde_json::to_value(updates)
        && let serde_json::Value::Object(map) = json_val
    {
        for (key, value) in map {
            let any_value = json_to_any(&value);
            settings_map.insert(&mut txn, key.as_str(), any_value);
        }
    }
}

/// Reset all workbook settings to defaults.
pub fn reset_settings(doc: &Doc, workbook: &MapRef) {
    set_settings(doc, workbook, &WorkbookSettings::default());
}

/// Apply a partial workbook settings patch. Returns whether any field changed.
pub fn patch_settings_with_origin(
    doc: &Doc,
    workbook: &MapRef,
    patch: &RustWorkbookSettingsPatch,
    origin: &'static [u8],
) -> bool {
    let pre = get_settings(doc, workbook);
    let mut desired = pre.clone();
    apply_patch_to_settings(&mut desired, patch);
    if desired == pre {
        return false;
    }

    let mut txn = doc.transact_mut_with(Origin::from(origin));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    macro_rules! set_non_null {
        ($field:expr, $key:literal) => {
            if let Some(value) = &$field {
                let json = serde_json::to_value(value).expect("workbook setting must serialize");
                settings_map.insert(&mut txn, $key, json_to_any(&json));
            }
        };
    }
    macro_rules! set_nullable {
        ($field:expr, $key:literal) => {
            if let Some(value) = &$field {
                match value {
                    Some(inner) => {
                        let json =
                            serde_json::to_value(inner).expect("workbook setting must serialize");
                        settings_map.insert(&mut txn, $key, json_to_any(&json));
                    }
                    None => {
                        settings_map.remove(&mut txn, $key);
                    }
                }
            }
        };
    }

    set_non_null!(patch.show_horizontal_scrollbar, "showHorizontalScrollbar");
    set_non_null!(patch.show_vertical_scrollbar, "showVerticalScrollbar");
    set_non_null!(patch.auto_hide_scroll_bars, "autoHideScrollBars");
    set_non_null!(patch.show_tab_strip, "showTabStrip");
    set_non_null!(patch.show_formula_bar, "showFormulaBar");
    set_non_null!(patch.allow_sheet_reorder, "allowSheetReorder");
    set_non_null!(patch.auto_fit_on_double_click, "autoFitOnDoubleClick");
    set_non_null!(patch.show_cut_copy_indicator, "showCutCopyIndicator");
    set_non_null!(patch.allow_drag_fill, "allowDragFill");
    set_non_null!(patch.enter_key_direction, "enterKeyDirection");
    set_non_null!(patch.allow_cell_drag_drop, "allowCellDragDrop");
    set_non_null!(patch.theme_id, "themeId");
    set_nullable!(patch.theme_fonts_id, "themeFontsId");
    set_non_null!(patch.culture, "culture");
    set_nullable!(patch.selected_sheet_ids, "selectedSheetIds");
    set_non_null!(patch.is_workbook_protected, "isWorkbookProtected");
    set_nullable!(
        patch.workbook_protection_password_hash,
        "workbookProtectionPasswordHash"
    );
    set_nullable!(
        patch.workbook_protection_options,
        "workbookProtectionOptions"
    );
    set_nullable!(patch.calculation_settings, "calculationSettings");
    set_non_null!(patch.date1904, "date1904");
    set_nullable!(patch.default_table_style_id, "defaultTableStyleId");
    set_nullable!(patch.custom_settings, "customSettings");
    if let Some(policy_patch) = &patch.automatic_conversion_policy {
        patch_automatic_conversion_policy_in_txn(
            &settings_map,
            &mut txn,
            &pre.automatic_conversion_policy,
            policy_patch,
        );
    }
    drop(txn);

    true
}

pub(super) fn apply_patch_to_settings(
    settings: &mut WorkbookSettings,
    patch: &RustWorkbookSettingsPatch,
) {
    macro_rules! apply_non_null {
        ($field:ident) => {
            if let Some(value) = &patch.$field {
                settings.$field = value.clone();
            }
        };
    }
    macro_rules! apply_nullable {
        ($field:ident) => {
            if let Some(value) = &patch.$field {
                settings.$field = value.clone();
            }
        };
    }
    apply_non_null!(show_horizontal_scrollbar);
    apply_non_null!(show_vertical_scrollbar);
    apply_non_null!(auto_hide_scroll_bars);
    apply_non_null!(show_tab_strip);
    apply_non_null!(show_formula_bar);
    apply_non_null!(allow_sheet_reorder);
    apply_non_null!(auto_fit_on_double_click);
    apply_non_null!(show_cut_copy_indicator);
    apply_non_null!(allow_drag_fill);
    apply_non_null!(enter_key_direction);
    apply_non_null!(allow_cell_drag_drop);
    apply_non_null!(theme_id);
    apply_nullable!(theme_fonts_id);
    apply_non_null!(culture);
    apply_nullable!(selected_sheet_ids);
    apply_non_null!(is_workbook_protected);
    apply_nullable!(workbook_protection_password_hash);
    apply_nullable!(workbook_protection_options);
    apply_nullable!(calculation_settings);
    apply_non_null!(date1904);
    apply_nullable!(default_table_style_id);
    apply_nullable!(custom_settings);
    if let Some(policy) = &patch.automatic_conversion_policy {
        if let Some(value) = policy.convert_date_like_text {
            settings.automatic_conversion_policy.convert_date_like_text = value;
        }
        if let Some(value) = policy.convert_time_like_text {
            settings.automatic_conversion_policy.convert_time_like_text = value;
        }
        if let Some(value) = policy.convert_fraction_like_text {
            settings
                .automatic_conversion_policy
                .convert_fraction_like_text = value;
        }
        if let Some(value) = policy.convert_scientific_notation {
            settings
                .automatic_conversion_policy
                .convert_scientific_notation = value;
        }
        if let Some(value) = policy.convert_leading_zero_numbers {
            settings
                .automatic_conversion_policy
                .convert_leading_zero_numbers = value;
        }
        if let Some(value) = policy.convert_long_digit_numbers {
            settings
                .automatic_conversion_policy
                .convert_long_digit_numbers = value;
        }
        if let Some(value) = policy.convert_percent_suffix {
            settings.automatic_conversion_policy.convert_percent_suffix = value;
        }
        if let Some(value) = policy.convert_currency_symbol {
            settings.automatic_conversion_policy.convert_currency_symbol = value;
        }
        if let Some(value) = policy.convert_formatted_numbers {
            settings
                .automatic_conversion_policy
                .convert_formatted_numbers = value;
        }
    }
}

pub(super) fn patch_automatic_conversion_policy_in_txn(
    settings_map: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    base: &AutomaticConversionPolicy,
    patch: &AutomaticConversionPolicyPatch,
) {
    let policy_map = match settings_map.get(txn, "automaticConversionPolicy") {
        Some(Out::YMap(map)) => map,
        _ => {
            let base_json = serde_json::to_value(base).expect("serialize");
            match json_to_any(&base_json) {
                Any::Map(entries) => settings_map.insert(
                    txn,
                    "automaticConversionPolicy",
                    entries
                        .iter()
                        .map(|(k, v)| (k.as_str(), v.clone()))
                        .collect::<MapPrelim>(),
                ),
                _ => settings_map.insert(
                    txn,
                    "automaticConversionPolicy",
                    std::iter::empty::<(&str, Any)>().collect::<MapPrelim>(),
                ),
            }
        }
    };
    macro_rules! patch_bool {
        ($field:expr, $key:literal) => {
            if let Some(value) = $field {
                policy_map.insert(txn, $key, Any::Bool(value));
            }
        };
    }
    patch_bool!(patch.convert_date_like_text, "convertDateLikeText");
    patch_bool!(patch.convert_time_like_text, "convertTimeLikeText");
    patch_bool!(patch.convert_fraction_like_text, "convertFractionLikeText");
    patch_bool!(
        patch.convert_scientific_notation,
        "convertScientificNotation"
    );
    patch_bool!(
        patch.convert_leading_zero_numbers,
        "convertLeadingZeroNumbers"
    );
    patch_bool!(patch.convert_long_digit_numbers, "convertLongDigitNumbers");
    patch_bool!(patch.convert_percent_suffix, "convertPercentSuffix");
    patch_bool!(patch.convert_currency_symbol, "convertCurrencySymbol");
    patch_bool!(patch.convert_formatted_numbers, "convertFormattedNumbers");
}

/// Set calculation settings (merges with current values).
///

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{AutomaticConversionPolicy, AutomaticConversionPolicyPatch};
    use crate::storage::YrsStorage;
    use serde_json::json;

    #[test]
    fn test_set_get_single_bool_setting() {
        let storage = YrsStorage::new();

        // Default is true
        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert!(settings.show_horizontal_scrollbar);

        // Set to false
        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "showHorizontalScrollbar",
            serde_json::Value::Bool(false),
        );

        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert!(!settings.show_horizontal_scrollbar);
        // Other settings unchanged
        assert!(settings.show_vertical_scrollbar);
    }

    // -------------------------------------------------------------------
    // Test 3: Set and get a single string setting
    // -------------------------------------------------------------------

    #[test]
    fn test_set_get_single_string_setting() {
        let storage = YrsStorage::new();

        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "themeId",
            serde_json::Value::String("dark-mode".to_string()),
        );

        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert_eq!(settings.theme_id, "dark-mode");
    }

    // -------------------------------------------------------------------
    // Test 4: Set multiple settings
    // -------------------------------------------------------------------

    #[test]
    fn test_set_settings_multiple() {
        let storage = YrsStorage::new();

        let mut updates = WorkbookSettings::default();
        updates.show_horizontal_scrollbar = false;
        updates.show_vertical_scrollbar = false;
        updates.theme_id = "slice".to_string();
        updates.culture = "de-DE".to_string();

        set_settings(storage.doc(), storage.workbook_map(), &updates);

        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert!(!settings.show_horizontal_scrollbar);
        assert!(!settings.show_vertical_scrollbar);
        assert_eq!(settings.theme_id, "slice");
        assert_eq!(settings.culture, "de-DE");
    }

    // -------------------------------------------------------------------
    // Test 5: Reset settings to defaults
    // -------------------------------------------------------------------

    #[test]
    fn test_reset_settings() {
        let storage = YrsStorage::new();

        // Set non-default values
        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "showHorizontalScrollbar",
            serde_json::Value::Bool(false),
        );
        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "themeId",
            serde_json::Value::String("dark".to_string()),
        );

        // Verify changed
        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert!(!settings.show_horizontal_scrollbar);
        assert_eq!(settings.theme_id, "dark");

        // Reset
        reset_settings(storage.doc(), storage.workbook_map());

        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert!(settings.show_horizontal_scrollbar);
        assert_eq!(settings.theme_id, "office");
    }

    // -------------------------------------------------------------------
    // Test 6: Protection — protect and check
    // -------------------------------------------------------------------
    #[test]
    fn test_multiple_set_setting_calls() {
        let storage = YrsStorage::new();

        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "showHorizontalScrollbar",
            serde_json::Value::Bool(false),
        );
        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "showVerticalScrollbar",
            serde_json::Value::Bool(false),
        );
        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "culture",
            serde_json::Value::String("ja-JP".to_string()),
        );

        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert!(!settings.show_horizontal_scrollbar);
        assert!(!settings.show_vertical_scrollbar);
        assert_eq!(settings.culture, "ja-JP");
        // Other settings remain at defaults
        assert!(settings.show_tab_strip);
    }

    #[test]
    fn test_patch_nullable_remove_and_automatic_conversion_policy() {
        let storage = YrsStorage::new();
        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "themeFontsId",
            json!("body-font"),
        );

        let patch = RustWorkbookSettingsPatch {
            theme_fonts_id: Some(None),
            automatic_conversion_policy: Some(AutomaticConversionPolicyPatch {
                convert_date_like_text: Some(false),
                convert_currency_symbol: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        };

        assert!(patch_settings_with_origin(
            storage.doc(),
            storage.workbook_map(),
            &patch,
            ORIGIN_USER_EDIT
        ));
        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert_eq!(settings.theme_fonts_id, None);
        assert!(!settings.automatic_conversion_policy.convert_date_like_text);
        assert!(!settings.automatic_conversion_policy.convert_currency_symbol);
        assert_eq!(
            settings.automatic_conversion_policy.convert_time_like_text,
            AutomaticConversionPolicy::default().convert_time_like_text
        );
    }
}
