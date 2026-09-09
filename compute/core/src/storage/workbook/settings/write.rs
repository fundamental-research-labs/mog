use super::read::get_settings;
use crate::snapshot::{RustWorkbookSettingsPatch, WorkbookSettings};
use crate::storage::workbook::WorkbookMetadata;
use value_types::ComputeError;

/// Decode a single setting at the public JSON boundary, then mutate typed state.
pub fn set_setting(
    metadata: &mut WorkbookMetadata,
    key: &str,
    value: serde_json::Value,
) -> Result<(), ComputeError> {
    let mut settings = get_settings(metadata);
    let invalid = |error| ComputeError::InvalidInput {
        message: format!("Invalid workbook setting '{key}': {error}"),
    };
    match key {
        "showHorizontalScrollbar" => {
            settings.show_horizontal_scrollbar = serde_json::from_value(value).map_err(invalid)?
        }
        "showVerticalScrollbar" => {
            settings.show_vertical_scrollbar = serde_json::from_value(value).map_err(invalid)?
        }
        "autoHideScrollBars" => {
            settings.auto_hide_scroll_bars = serde_json::from_value(value).map_err(invalid)?
        }
        "showTabStrip" => {
            settings.show_tab_strip = serde_json::from_value(value).map_err(invalid)?
        }
        "showFormulaBar" => {
            settings.show_formula_bar = serde_json::from_value(value).map_err(invalid)?
        }
        "allowSheetReorder" => {
            settings.allow_sheet_reorder = serde_json::from_value(value).map_err(invalid)?
        }
        "autoFitOnDoubleClick" => {
            settings.auto_fit_on_double_click = serde_json::from_value(value).map_err(invalid)?
        }
        "showCutCopyIndicator" => {
            settings.show_cut_copy_indicator = serde_json::from_value(value).map_err(invalid)?
        }
        "allowDragFill" => {
            settings.allow_drag_fill = serde_json::from_value(value).map_err(invalid)?
        }
        "enterKeyDirection" => {
            settings.enter_key_direction = serde_json::from_value(value).map_err(invalid)?
        }
        "allowCellDragDrop" => {
            settings.allow_cell_drag_drop = serde_json::from_value(value).map_err(invalid)?
        }
        "themeId" => settings.theme_id = serde_json::from_value(value).map_err(invalid)?,
        "themeFontsId" => {
            settings.theme_fonts_id = serde_json::from_value(value).map_err(invalid)?
        }
        "culture" => settings.culture = serde_json::from_value(value).map_err(invalid)?,
        "selectedSheetIds" => {
            settings.selected_sheet_ids = serde_json::from_value(value).map_err(invalid)?
        }
        "isWorkbookProtected" => {
            settings.is_workbook_protected = serde_json::from_value(value).map_err(invalid)?
        }
        "workbookProtectionPasswordHash" => {
            settings.workbook_protection_password_hash =
                serde_json::from_value(value).map_err(invalid)?
        }
        "workbookProtectionOptions" => {
            settings.workbook_protection_options = serde_json::from_value(value).map_err(invalid)?
        }
        "calculationSettings" => {
            settings.calculation_settings = serde_json::from_value(value).map_err(invalid)?
        }
        "date1904" => settings.date1904 = serde_json::from_value(value).map_err(invalid)?,
        "defaultTableStyleId" => {
            settings.default_table_style_id = serde_json::from_value(value).map_err(invalid)?
        }
        "customSettings" => {
            settings.custom_settings = serde_json::from_value(value).map_err(invalid)?
        }
        "automaticConversionPolicy" => {
            settings.automatic_conversion_policy = serde_json::from_value(value).map_err(invalid)?
        }
        "defaultSlicerStyle" => {
            metadata.default_slicer_style = serde_json::from_value(value).map_err(invalid)?;
            return Ok(());
        }
        "defaultPivotTableStyle" => {
            metadata.default_pivot_table_style = serde_json::from_value(value).map_err(invalid)?;
            return Ok(());
        }
        _ => {
            return Err(ComputeError::InvalidInput {
                message: format!("Unknown workbook setting: {key}"),
            });
        }
    }
    set_settings(metadata, &settings);
    Ok(())
}

pub fn set_settings(metadata: &mut WorkbookMetadata, updates: &WorkbookSettings) {
    let previous = get_settings(metadata);
    if updates.date1904 != previous.date1904 {
        metadata
            .properties
            .get_or_insert_with(Default::default)
            .date1904 = updates.date1904;
    }
    if updates.workbook_protection_password_hash != previous.workbook_protection_password_hash
        || updates.workbook_protection_options != previous.workbook_protection_options
        || updates.is_workbook_protected != previous.is_workbook_protected
    {
        if !updates.is_workbook_protected
            && updates.workbook_protection_options.is_none()
            && updates.workbook_protection_password_hash.is_none()
        {
            metadata.protection = None;
        } else {
            let protection = metadata.protection.get_or_insert_with(Default::default);
            if updates.is_workbook_protected {
                protection.lock_structure = updates
                    .workbook_protection_options
                    .clone()
                    .unwrap_or_default()
                    .structure;
            } else {
                protection.lock_structure = false;
                protection.lock_windows = false;
                protection.lock_revision = false;
            }
            if updates.workbook_protection_password_hash
                != previous.workbook_protection_password_hash
            {
                protection.workbook_password = updates.workbook_protection_password_hash.clone();
                protection.workbook_hash_value = None;
                protection.workbook_salt_value = None;
                protection.workbook_spin_count = None;
                protection.workbook_algorithm_name = Default::default();
            }
        }
    }
    metadata.settings = updates.clone();
    // These fields are projections of the complete native OOXML objects.
    metadata.settings.date1904 = false;
    metadata.settings.workbook_protection_password_hash = None;
    metadata.settings.workbook_protection_options = None;
}

pub fn reset_settings(metadata: &mut WorkbookMetadata) {
    set_settings(metadata, &WorkbookSettings::default());
}

pub fn patch_settings(metadata: &mut WorkbookMetadata, patch: &RustWorkbookSettingsPatch) -> bool {
    let previous = get_settings(metadata);
    let mut settings = previous.clone();
    apply_patch_to_settings(&mut settings, patch);
    if previous == settings {
        return false;
    }
    set_settings(metadata, &settings);
    true
}

pub(super) fn apply_patch_to_settings(
    settings: &mut WorkbookSettings,
    patch: &RustWorkbookSettingsPatch,
) {
    macro_rules! apply_field {
        ($field:ident) => {
            if let Some(value) = &patch.$field {
                settings.$field = value.clone();
            }
        };
    }
    apply_field!(show_horizontal_scrollbar);
    apply_field!(show_vertical_scrollbar);
    apply_field!(auto_hide_scroll_bars);
    apply_field!(show_tab_strip);
    apply_field!(show_formula_bar);
    apply_field!(allow_sheet_reorder);
    apply_field!(auto_fit_on_double_click);
    apply_field!(show_cut_copy_indicator);
    apply_field!(allow_drag_fill);
    apply_field!(enter_key_direction);
    apply_field!(allow_cell_drag_drop);
    apply_field!(theme_id);
    apply_field!(theme_fonts_id);
    apply_field!(culture);
    apply_field!(selected_sheet_ids);
    apply_field!(is_workbook_protected);
    apply_field!(workbook_protection_password_hash);
    apply_field!(workbook_protection_options);
    apply_field!(calculation_settings);
    apply_field!(date1904);
    apply_field!(default_table_style_id);
    apply_field!(custom_settings);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{AutomaticConversionPolicy, AutomaticConversionPolicyPatch};
    use crate::storage::workbook::WorkbookMetadata;
    use serde_json::json;

    #[test]
    fn invalid_setting_does_not_change_native_state() {
        let mut metadata = WorkbookMetadata::default();
        let before = get_settings(&metadata);
        assert!(set_setting(&mut metadata, "culture", json!(42)).is_err());
        assert!(set_setting(&mut metadata, "unknownSetting", json!(true)).is_err());
        assert_eq!(get_settings(&metadata), before);
    }

    #[test]
    fn clearing_protection_updates_the_exported_lock_flags() {
        let mut metadata = WorkbookMetadata::default();
        super::super::protect_workbook(&mut metadata, Some("CC2A"), None);
        set_setting(&mut metadata, "isWorkbookProtected", json!(false)).unwrap();
        let protection = metadata.protection.as_ref().unwrap();
        assert!(!protection.lock_structure);
        assert!(!protection.lock_windows);
        assert!(!protection.lock_revision);
        assert!(!get_settings(&metadata).is_workbook_protected);
    }

    #[test]
    fn test_set_get_single_bool_setting() {
        let mut metadata = WorkbookMetadata::default();

        // Default is true
        let settings = get_settings(&metadata);
        assert!(settings.show_horizontal_scrollbar);

        // Set to false
        set_setting(
            &mut metadata,
            "showHorizontalScrollbar",
            serde_json::Value::Bool(false),
        )
        .unwrap();

        let settings = get_settings(&metadata);
        assert!(!settings.show_horizontal_scrollbar);
        // Other settings unchanged
        assert!(settings.show_vertical_scrollbar);
    }

    // -------------------------------------------------------------------
    // Test 3: Set and get a single string setting
    // -------------------------------------------------------------------

    #[test]
    fn test_set_get_single_string_setting() {
        let mut metadata = WorkbookMetadata::default();

        set_setting(
            &mut metadata,
            "themeId",
            serde_json::Value::String("dark-mode".to_string()),
        )
        .unwrap();

        let settings = get_settings(&metadata);
        assert_eq!(settings.theme_id, "dark-mode");
    }

    // -------------------------------------------------------------------
    // Test 4: Set multiple settings
    // -------------------------------------------------------------------

    #[test]
    fn test_set_settings_multiple() {
        let mut metadata = WorkbookMetadata::default();

        let mut updates = WorkbookSettings::default();
        updates.show_horizontal_scrollbar = false;
        updates.show_vertical_scrollbar = false;
        updates.theme_id = "slice".to_string();
        updates.culture = "de-DE".to_string();

        set_settings(&mut metadata, &updates);

        let settings = get_settings(&metadata);
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
        let mut metadata = WorkbookMetadata::default();

        // Set non-default values
        set_setting(
            &mut metadata,
            "showHorizontalScrollbar",
            serde_json::Value::Bool(false),
        )
        .unwrap();
        set_setting(
            &mut metadata,
            "themeId",
            serde_json::Value::String("dark".to_string()),
        )
        .unwrap();

        // Verify changed
        let settings = get_settings(&metadata);
        assert!(!settings.show_horizontal_scrollbar);
        assert_eq!(settings.theme_id, "dark");

        // Reset
        reset_settings(&mut metadata);

        let settings = get_settings(&metadata);
        assert!(settings.show_horizontal_scrollbar);
        assert_eq!(settings.theme_id, "office");
    }

    // -------------------------------------------------------------------
    // Test 6: Protection — protect and check
    // -------------------------------------------------------------------
    #[test]
    fn test_multiple_set_setting_calls() {
        let mut metadata = WorkbookMetadata::default();

        set_setting(
            &mut metadata,
            "showHorizontalScrollbar",
            serde_json::Value::Bool(false),
        )
        .unwrap();
        set_setting(
            &mut metadata,
            "showVerticalScrollbar",
            serde_json::Value::Bool(false),
        )
        .unwrap();
        set_setting(
            &mut metadata,
            "culture",
            serde_json::Value::String("ja-JP".to_string()),
        )
        .unwrap();

        let settings = get_settings(&metadata);
        assert!(!settings.show_horizontal_scrollbar);
        assert!(!settings.show_vertical_scrollbar);
        assert_eq!(settings.culture, "ja-JP");
        // Other settings remain at defaults
        assert!(settings.show_tab_strip);
    }

    #[test]
    fn test_patch_nullable_remove_and_automatic_conversion_policy() {
        let mut metadata = WorkbookMetadata::default();
        set_setting(&mut metadata, "themeFontsId", json!("body-font")).unwrap();

        let patch = RustWorkbookSettingsPatch {
            theme_fonts_id: Some(None),
            automatic_conversion_policy: Some(AutomaticConversionPolicyPatch {
                convert_date_like_text: Some(false),
                convert_currency_symbol: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        };

        assert!(patch_settings(&mut metadata, &patch));
        let settings = get_settings(&metadata);
        assert_eq!(settings.theme_fonts_id, None);
        assert!(!settings.automatic_conversion_policy.convert_date_like_text);
        assert!(!settings.automatic_conversion_policy.convert_currency_symbol);
        assert_eq!(
            settings.automatic_conversion_policy.convert_time_like_text,
            AutomaticConversionPolicy::default().convert_time_like_text
        );
    }
}
