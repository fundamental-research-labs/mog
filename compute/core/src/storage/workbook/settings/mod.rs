//! Workbook Settings Storage Module
//!
//! Typed native workbook settings and public settings projections.

mod calculation;
mod custom;
mod protection;
mod read;
mod styles;
mod write;

pub(crate) use calculation::{
    get_calculation_settings, is_iterative_calculation_enabled, set_calculation_settings,
    set_iterative_calculation_enabled,
};
pub(crate) use custom::{get_custom_setting, list_custom_settings, set_custom_setting};
pub(crate) use protection::{
    get_protection_options, has_protection_password, is_operation_allowed, is_protected,
    protect_workbook, unprotect_workbook,
};
pub(crate) use read::{get_setting, get_settings};
pub(crate) use styles::{
    add_named_slicer_style, delete_named_slicer_style, duplicate_named_slicer_style,
    get_default_pivot_table_style, get_default_slicer_style, get_default_table_style_id,
    get_named_slicer_style, get_named_slicer_style_count, list_named_slicer_styles,
    set_default_pivot_table_style, set_default_slicer_style, set_default_table_style_id,
};
pub(crate) use write::{patch_settings, reset_settings, set_setting, set_settings};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{
        AutomaticConversionPolicy, CalculationSettings, WorkbookProtectionOptions, WorkbookSettings,
    };
    use crate::storage::workbook::WorkbookMetadata;

    #[test]
    fn test_get_settings_defaults_on_empty() {
        let metadata = WorkbookMetadata::default();
        let settings = get_settings(&metadata);
        let defaults = WorkbookSettings::default();

        assert_eq!(settings, defaults);
        assert!(settings.show_horizontal_scrollbar);
        assert!(settings.show_vertical_scrollbar);
        assert!(!settings.auto_hide_scroll_bars);
        assert!(settings.show_tab_strip);
        assert!(settings.show_formula_bar);
        assert!(settings.allow_sheet_reorder);
        assert!(settings.auto_fit_on_double_click);
        assert!(settings.show_cut_copy_indicator);
        assert!(settings.allow_drag_fill);
        assert!(!settings.allow_cell_drag_drop);
        assert_eq!(settings.theme_id, "office");
        assert_eq!(settings.culture, "en-US");
        assert!(!settings.is_workbook_protected);
        assert!(settings.workbook_protection_password_hash.is_none());
        assert!(settings.workbook_protection_options.is_none());
        assert!(settings.calculation_settings.is_none());
        assert!(settings.default_table_style_id.is_none());
        assert!(settings.selected_sheet_ids.is_none());
        assert!(settings.theme_fonts_id.is_none());
    }

    // -------------------------------------------------------------------
    // Test 2: Set and get a single boolean setting
    // -------------------------------------------------------------------

    #[test]
    fn test_get_setting_individual() {
        let mut metadata = WorkbookMetadata::default();

        // Set a boolean
        set_setting(
            &mut metadata,
            "showTabStrip",
            serde_json::Value::Bool(false),
        )
        .unwrap();

        let val = get_setting(&metadata, "showTabStrip");
        assert_eq!(val, Some(serde_json::Value::Bool(false)));

        // Non-existent key returns None
        let val = get_setting(&metadata, "nonExistentKey");
        assert!(val.is_none());
    }

    // -------------------------------------------------------------------
    // Test 15: EnterKeyDirection setting
    // -------------------------------------------------------------------

    #[test]
    fn test_enter_key_direction() {
        let mut metadata = WorkbookMetadata::default();

        // Default is "down"
        let settings = get_settings(&metadata);
        assert_eq!(
            settings.enter_key_direction,
            crate::snapshot::EnterKeyDirection::Down
        );

        // Set to "right" — stored as JSON string
        let right_json = "right".to_owned();
        set_setting(
            &mut metadata,
            "enterKeyDirection",
            serde_json::Value::String(right_json),
        )
        .unwrap();

        let settings = get_settings(&metadata);
        assert_eq!(
            settings.enter_key_direction,
            crate::snapshot::EnterKeyDirection::Right
        );
    }

    // -------------------------------------------------------------------
    // Test 16: Selected sheet IDs
    // -------------------------------------------------------------------

    #[test]
    fn test_selected_sheet_ids() {
        let mut metadata = WorkbookMetadata::default();

        // Default: none
        let settings = get_settings(&metadata);
        assert!(settings.selected_sheet_ids.is_none());

        // Set selected sheets
        let sheet_ids = vec!["sheet1".to_string(), "sheet2".to_string()];
        let json_value = serde_json::to_value(&sheet_ids).unwrap();
        set_setting(&mut metadata, "selectedSheetIds", json_value).unwrap();

        let settings = get_settings(&metadata);
        assert_eq!(
            settings.selected_sheet_ids,
            Some(vec!["sheet1".to_string(), "sheet2".to_string()])
        );
    }

    // -------------------------------------------------------------------
    // Test 17: Theme fonts ID
    // -------------------------------------------------------------------

    #[test]
    fn test_theme_fonts_id() {
        let mut metadata = WorkbookMetadata::default();

        // Default: none
        let settings = get_settings(&metadata);
        assert!(settings.theme_fonts_id.is_none());

        // Set theme fonts
        set_setting(
            &mut metadata,
            "themeFontsId",
            serde_json::Value::String("arial".to_string()),
        )
        .unwrap();

        let settings = get_settings(&metadata);
        assert_eq!(settings.theme_fonts_id, Some("arial".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 18: WorkbookSettings serde roundtrip
    // -------------------------------------------------------------------

    #[test]
    fn test_workbook_settings_serde_roundtrip() {
        let settings = WorkbookSettings {
            show_horizontal_scrollbar: false,
            show_vertical_scrollbar: true,
            auto_hide_scroll_bars: true,
            show_tab_strip: false,
            show_formula_bar: true,
            allow_sheet_reorder: false,
            auto_fit_on_double_click: true,
            show_cut_copy_indicator: false,
            allow_drag_fill: true,
            enter_key_direction: crate::snapshot::EnterKeyDirection::Right,
            allow_cell_drag_drop: true,
            theme_id: "dark-mode".to_string(),
            theme_fonts_id: Some("arial".to_string()),
            culture: "de-DE".to_string(),
            selected_sheet_ids: Some(vec!["s1".to_string()]),
            is_workbook_protected: true,
            workbook_protection_password_hash: Some("ABCD".to_string()),
            workbook_protection_options: Some(WorkbookProtectionOptions { structure: true }),
            calculation_settings: Some(CalculationSettings {
                enable_iterative_calculation: true,
                max_iterations: 200,
                max_change: value_types::FiniteF64::must(0.01),
                ..Default::default()
            }),
            date1904: false,
            default_table_style_id: Some("dark1".to_string()),
            custom_settings: None,
            automatic_conversion_policy: AutomaticConversionPolicy::default(),
        };

        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: WorkbookSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(settings, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 19: WorkbookSettings default serde
    // -------------------------------------------------------------------

    #[test]
    fn test_workbook_settings_default_serde() {
        // Deserializing an empty object should produce defaults
        let json = "{}";
        let settings: WorkbookSettings = serde_json::from_str(json).unwrap();
        assert!(settings.show_horizontal_scrollbar);
        assert!(settings.show_vertical_scrollbar);
        assert!(!settings.auto_hide_scroll_bars);
        assert!(settings.show_tab_strip);
        assert_eq!(settings.theme_id, "office");
        assert_eq!(settings.culture, "en-US");
    }

    // -------------------------------------------------------------------
    // Test 20: CalculationSettings serde roundtrip
}

pub(crate) use styles::unique_style_name;
