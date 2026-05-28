//! Workbook settings types for global workbook configuration.
//!
//! [`WorkbookSettings`] holds all workbook-level preferences (UI, editing,
//! theme, localization, protection, calculation). [`CalculationSettings`]
//! controls iterative calculation for circular references.

use serde::{Deserialize, Serialize};
use value_types::FiniteF64;

use super::init::{default_max_change, default_max_iterations};

/// Calculation mode — when the engine recalculates formulas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalcMode {
    /// Automatic recalculation (default).
    #[default]
    Auto,
    /// Automatic except for data tables.
    AutoNoTable,
    /// Manual recalculation only.
    Manual,
}

/// Calculation settings for the workbook.
///
/// Controls iterative calculation for circular references.
/// Matches the TypeScript `CalculationSettings` interface from `@mog-sdk/spreadsheet-contracts/core`.
///
/// When iterative calculation is enabled, formulas with circular references
/// calculate iteratively until convergence or max iterations. When disabled (default),
/// circular references result in #CALC! errors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculationSettings {
    /// Whether to allow iterative calculation for circular references.
    /// When true, formulas with circular references calculate iteratively.
    /// When false (default), circular references show #CALC! error.
    #[serde(default)]
    pub enable_iterative_calculation: bool,

    /// Maximum number of iterations for iterative calculation.
    /// Excel default: 100
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,

    /// Maximum change between iterations for convergence.
    /// Calculation stops when all results change by less than this amount.
    /// Excel default: 0.001
    #[serde(default = "default_max_change")]
    pub max_change: FiniteF64,

    /// Calculation mode (auto/manual/autoNoTable).
    #[serde(default)]
    pub calc_mode: CalcMode,

    /// Whether to use full (15-digit) precision for calculations.
    #[serde(default = "default_true")]
    pub full_precision: bool,

    /// Cell reference style (true = R1C1, false = A1).
    #[serde(default)]
    pub r1c1_mode: bool,

    /// Whether to perform a full calculation when the file is opened.
    #[serde(default)]
    pub full_calc_on_load: bool,

    /// Whether the workbook calculation completed successfully when last saved.
    /// Preserved for XLSX import/export fidelity.
    #[serde(default = "default_true")]
    pub calc_completed: bool,

    /// Whether Excel should recalculate on save.
    /// Excel's OOXML default is true; imported files may explicitly set false.
    #[serde(default = "default_true")]
    pub calc_on_save: bool,

    /// Whether Excel may use concurrent calculation.
    /// Preserved for XLSX import/export fidelity.
    #[serde(default = "default_true")]
    pub concurrent_calc: bool,

    /// Explicit concurrent calculation thread count, when present in OOXML.
    #[serde(default)]
    pub concurrent_manual_count: Option<u32>,

    /// Whether Excel should force a full recalculation even in manual mode.
    #[serde(default)]
    pub force_full_calc: bool,

    /// Excel calculation engine version (`calcId` on `<calcPr>`).
    ///
    /// This is not runtime behavior, but it is workbook calculation metadata and
    /// must travel with modeled calculation settings rather than round-trip context.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calc_id: Option<u32>,

    /// Whether `iterateCount` was explicitly present in source OOXML.
    ///
    /// Excel often emits explicit default-valued calcPr attributes. The runtime
    /// calculation behavior is unchanged by this flag, but XLSX export needs it
    /// to preserve source-level contract fidelity without using raw XML replay.
    #[serde(default)]
    pub has_explicit_iterate_count: bool,

    /// Whether `iterateDelta` was explicitly present in source OOXML.
    #[serde(default)]
    pub has_explicit_iterate_delta: bool,
}

impl Default for CalculationSettings {
    fn default() -> Self {
        Self {
            enable_iterative_calculation: false,
            max_iterations: 100,
            max_change: FiniteF64::must(0.001),
            calc_mode: CalcMode::Auto,
            full_precision: true,
            r1c1_mode: false,
            full_calc_on_load: false,
            calc_completed: true,
            calc_on_save: true,
            concurrent_calc: true,
            concurrent_manual_count: None,
            force_full_calc: false,
            calc_id: None,
            has_explicit_iterate_count: false,
            has_explicit_iterate_delta: false,
        }
    }
}

/// Workbook protection options - matches Excel behavior.
///
/// Workbook protection prevents structural changes to sheets.
/// Matches the TypeScript `WorkbookProtectionOptions` interface
/// from `@mog-sdk/spreadsheet-contracts/protection`.
///
/// When a workbook is protected:
/// - Users cannot add, delete, rename, hide, unhide, or move sheets
/// - Sheet content can still be edited (unless sheet is also protected)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookProtectionOptions {
    /// Protect workbook structure (prevents sheet add/delete/move/rename/hide/unhide).
    /// Default: true when protection is enabled.
    #[serde(default = "default_true")]
    pub structure: bool,
}

/// Helper for serde default = true.
fn default_true() -> bool {
    true
}

/// Optional patch field for non-nullable settings.
///
/// Missing means "no change"; a present value means "replace"; explicit JSON
/// null is rejected by `deserialize_optional_non_null`.
pub type NonNullPatch<T> = Option<T>;

/// Tri-state patch field for nullable settings.
///
/// Missing means "no change"; present null means "clear"; present value means
/// "replace".
pub type NullablePatch<T> = Option<Option<T>>;

/// Deserialize an optional patch field while rejecting explicit JSON null.
///
/// Serde calls field-level `deserialize_with` only when the field is present;
/// the outer `Option` therefore distinguishes missing from present. This helper
/// rejects the present-null case before merge so nullable and non-nullable patch
/// fields keep distinct contracts.
pub fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    let value = Option::<T>::deserialize(deserializer)?;
    value
        .map(Some)
        .ok_or_else(|| serde::de::Error::custom("explicit null is not allowed for this setting"))
}

/// Deserialize a nullable patch field while preserving missing/null/value.
pub fn deserialize_nullable_patch<'de, D, T>(deserializer: D) -> Result<NullablePatch<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct NullablePatchVisitor<T>(std::marker::PhantomData<T>);

    impl<'de, T> serde::de::Visitor<'de> for NullablePatchVisitor<T>
    where
        T: Deserialize<'de>,
    {
        type Value = NullablePatch<T>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("null or a setting value")
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(Some(None))
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(Some(None))
        }

        fn visit_some<D2>(self, deserializer: D2) -> Result<Self::Value, D2::Error>
        where
            D2: serde::Deserializer<'de>,
        {
            T::deserialize(deserializer).map(Some).map(Some)
        }
    }

    deserializer.deserialize_option(NullablePatchVisitor(std::marker::PhantomData))
}

impl Default for WorkbookProtectionOptions {
    fn default() -> Self {
        Self { structure: true }
    }
}

/// Workbook-level automatic conversion policy.
///
/// Every field defaults to `true`, preserving existing automatic parsing for
/// older workbooks and partially-populated settings objects.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticConversionPolicy {
    #[serde(default = "default_true")]
    pub convert_date_like_text: bool,
    #[serde(default = "default_true")]
    pub convert_time_like_text: bool,
    #[serde(default = "default_true")]
    pub convert_fraction_like_text: bool,
    #[serde(default = "default_true")]
    pub convert_scientific_notation: bool,
    #[serde(default = "default_true")]
    pub convert_leading_zero_numbers: bool,
    #[serde(default = "default_true")]
    pub convert_long_digit_numbers: bool,
    #[serde(default = "default_true")]
    pub convert_percent_suffix: bool,
    #[serde(default = "default_true")]
    pub convert_currency_symbol: bool,
    #[serde(default = "default_true")]
    pub convert_formatted_numbers: bool,
}

impl Default for AutomaticConversionPolicy {
    fn default() -> Self {
        Self {
            convert_date_like_text: true,
            convert_time_like_text: true,
            convert_fraction_like_text: true,
            convert_scientific_notation: true,
            convert_leading_zero_numbers: true,
            convert_long_digit_numbers: true,
            convert_percent_suffix: true,
            convert_currency_symbol: true,
            convert_formatted_numbers: true,
        }
    }
}

/// Field-level patch for [`AutomaticConversionPolicy`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticConversionPolicyPatch {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub convert_date_like_text: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub convert_time_like_text: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub convert_fraction_like_text: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub convert_scientific_notation: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub convert_leading_zero_numbers: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub convert_long_digit_numbers: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub convert_percent_suffix: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub convert_currency_symbol: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub convert_formatted_numbers: NonNullPatch<bool>,
}

/// Direction for enter key movement after committing an edit.
/// Matches the TypeScript `EnterKeyDirection` type.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EnterKeyDirection {
    /// Move down (default).
    #[default]
    Down,
    /// Move right.
    Right,
    /// Move up.
    Up,
    /// Move left.
    Left,
    /// Stay in place.
    None,
}

/// Default theme ID.
fn default_theme_id() -> String {
    "office".to_string()
}

/// Default culture.
fn default_culture() -> String {
    "en-US".to_string()
}

/// Workbook-level settings (persisted in Yrs workbook metadata).
///
/// These apply globally to the entire workbook, not per-sheet.
/// Matches the TypeScript `WorkbookSettings` interface from `@mog-sdk/spreadsheet-contracts/core`.
///
/// All fields use `camelCase` serialization for compatibility with the TypeScript layer.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSettings {
    // === UI Visibility ===
    /// Whether horizontal scrollbar is visible (default: true).
    #[serde(default = "default_true")]
    pub show_horizontal_scrollbar: bool,

    /// Whether vertical scrollbar is visible (default: true).
    #[serde(default = "default_true")]
    pub show_vertical_scrollbar: bool,

    /// Whether scrollbars auto-hide when not scrolling (default: false).
    #[serde(default)]
    pub auto_hide_scroll_bars: bool,

    /// Whether the tab strip is visible (default: true).
    #[serde(default = "default_true")]
    pub show_tab_strip: bool,

    /// Whether the formula bar is visible (default: true).
    #[serde(default = "default_true")]
    pub show_formula_bar: bool,

    // === Editing Behavior ===
    /// Whether sheets can be reordered by dragging (default: true).
    #[serde(default = "default_true")]
    pub allow_sheet_reorder: bool,

    /// Whether to auto-fit column width on header double-click (default: true).
    #[serde(default = "default_true")]
    pub auto_fit_on_double_click: bool,

    /// Whether to show cut/copy indicator (marching ants) (default: true).
    #[serde(default = "default_true")]
    pub show_cut_copy_indicator: bool,

    /// Whether fill handle dragging is enabled (default: true).
    #[serde(default = "default_true")]
    pub allow_drag_fill: bool,

    /// Direction to move after pressing Enter (default: "down").
    #[serde(default)]
    pub enter_key_direction: EnterKeyDirection,

    /// Whether cell drag-and-drop to move cells is enabled (default: false).
    #[serde(default)]
    pub allow_cell_drag_drop: bool,

    // === Theme ===
    /// ID of active theme (default: "office").
    #[serde(default = "default_theme_id")]
    pub theme_id: String,

    /// Override for theme fonts. When set, uses this font theme instead
    /// of the fonts from the selected theme. None means use fonts from themeId.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_fonts_id: Option<String>,

    // === Localization ===
    /// Locale/culture for number, date, and currency formatting (default: "en-US").
    #[serde(default = "default_culture")]
    pub culture: String,

    // === Multi-Sheet Selection ===
    /// Currently selected sheet IDs for multi-sheet operations.
    /// Default: None (falls back to [activeSheetId]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_sheet_ids: Option<Vec<String>>,

    // === Workbook Protection ===
    /// Whether the workbook structure is protected (default: false).
    #[serde(default)]
    pub is_workbook_protected: bool,

    /// Hashed protection password for workbook (optional).
    /// Uses Excel-compatible XOR hash algorithm.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_protection_password_hash: Option<String>,

    /// Workbook protection options (what operations are prevented).
    /// Only relevant when `is_workbook_protected` is true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_protection_options: Option<WorkbookProtectionOptions>,

    // === Calculation ===
    /// Calculation settings including iterative calculation for circular references.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calculation_settings: Option<CalculationSettings>,

    /// Whether the workbook uses the 1904 date system (affects all date calculations).
    /// Default: false (1900 date system).
    #[serde(default)]
    pub date1904: bool,

    // === Tables ===
    /// Default table style ID for new tables.
    /// When None, new tables use the 'medium2' preset by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_table_style_id: Option<String>,

    /// Arbitrary key-value custom settings (OfficeJS: workbook.settings).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_settings: Option<std::collections::HashMap<String, serde_json::Value>>,

    /// Workbook-level controls for future automatic input conversions.
    #[serde(default)]
    pub automatic_conversion_policy: AutomaticConversionPolicy,
}

impl Default for WorkbookSettings {
    fn default() -> Self {
        Self {
            show_horizontal_scrollbar: true,
            show_vertical_scrollbar: true,
            auto_hide_scroll_bars: false,
            show_tab_strip: true,
            show_formula_bar: true,
            allow_sheet_reorder: true,
            auto_fit_on_double_click: true,
            show_cut_copy_indicator: true,
            allow_drag_fill: true,
            enter_key_direction: EnterKeyDirection::default(),
            allow_cell_drag_drop: false,
            theme_id: "office".to_string(),
            theme_fonts_id: None,
            culture: "en-US".to_string(),
            selected_sheet_ids: None,
            is_workbook_protected: false,
            workbook_protection_password_hash: None,
            workbook_protection_options: None,
            calculation_settings: None,
            date1904: false,
            default_table_style_id: None,
            custom_settings: None,
            automatic_conversion_policy: AutomaticConversionPolicy::default(),
        }
    }
}

/// Partial patch for Rust-owned workbook settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RustWorkbookSettingsPatch {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub show_horizontal_scrollbar: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub show_vertical_scrollbar: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub auto_hide_scroll_bars: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub show_tab_strip: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub show_formula_bar: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub allow_sheet_reorder: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub auto_fit_on_double_click: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub show_cut_copy_indicator: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub allow_drag_fill: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub enter_key_direction: NonNullPatch<EnterKeyDirection>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub allow_cell_drag_drop: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub theme_id: NonNullPatch<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_nullable_patch"
    )]
    pub theme_fonts_id: NullablePatch<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub culture: NonNullPatch<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_nullable_patch"
    )]
    pub selected_sheet_ids: NullablePatch<Vec<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub is_workbook_protected: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_nullable_patch"
    )]
    pub workbook_protection_password_hash: NullablePatch<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_nullable_patch"
    )]
    pub workbook_protection_options: NullablePatch<WorkbookProtectionOptions>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_nullable_patch"
    )]
    pub calculation_settings: NullablePatch<CalculationSettings>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub date1904: NonNullPatch<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_nullable_patch"
    )]
    pub default_table_style_id: NullablePatch<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_nullable_patch"
    )]
    pub custom_settings: NullablePatch<std::collections::HashMap<String, serde_json::Value>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub automatic_conversion_policy: NonNullPatch<AutomaticConversionPolicyPatch>,
}

/// Types of workbook-level operations that can be protected.
/// Matches the TypeScript `ProtectedWorkbookOperation` type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProtectedWorkbookOperation {
    /// Add a new sheet.
    AddSheet,
    /// Delete a sheet.
    DeleteSheet,
    /// Rename a sheet.
    RenameSheet,
    /// Move a sheet.
    MoveSheet,
    /// Hide a sheet.
    HideSheet,
    /// Unhide a sheet.
    UnhideSheet,
    /// Copy a sheet.
    CopySheet,
}

// ============================================================================
// From impls: domain-types → snapshot-types
// ============================================================================

impl From<domain_types::domain::workbook::CalcMode> for CalcMode {
    fn from(v: domain_types::domain::workbook::CalcMode) -> Self {
        match v {
            domain_types::domain::workbook::CalcMode::Auto => Self::Auto,
            domain_types::domain::workbook::CalcMode::AutoNoTable => Self::AutoNoTable,
            domain_types::domain::workbook::CalcMode::Manual => Self::Manual,
        }
    }
}

impl From<domain_types::domain::workbook::CalculationProperties> for CalculationSettings {
    fn from(v: domain_types::domain::workbook::CalculationProperties) -> Self {
        // Domain `iterate_delta` is bare f64 (parsed from XLSX). If the file
        // carries a non-finite value, fall back to the Excel default rather
        // than panicking — malformed XLSX should degrade, not crash.
        let max_change = FiniteF64::new(v.iterate_delta).unwrap_or_else(default_max_change);
        Self {
            enable_iterative_calculation: v.iterate,
            max_iterations: v.iterate_count,
            max_change,
            calc_mode: v.calc_mode.into(),
            full_precision: v.full_precision,
            r1c1_mode: v.ref_mode == domain_types::domain::workbook::RefMode::R1C1,
            full_calc_on_load: v.full_calc_on_load,
            calc_completed: v.calc_completed,
            calc_on_save: v.calc_on_save,
            concurrent_calc: v.concurrent_calc,
            concurrent_manual_count: v.concurrent_manual_count,
            force_full_calc: v.force_full_calc,
            calc_id: v.calc_id,
            has_explicit_iterate_count: v.has_explicit_iterate_count,
            has_explicit_iterate_delta: v.has_explicit_iterate_delta,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ----------------------------------------------------------------
    // From conversion: domain_types::CalculationProperties → CalculationSettings
    // ----------------------------------------------------------------

    #[test]
    fn from_domain_calc_props_to_calc_settings() {
        let domain = domain_types::domain::workbook::CalculationProperties {
            iterate: true,
            iterate_count: 250,
            iterate_delta: 0.05,
            calc_mode: domain_types::domain::workbook::CalcMode::Manual,
            full_calc_on_load: true,
            ref_mode: domain_types::domain::workbook::RefMode::R1C1,
            full_precision: false,
            calc_completed: false,
            calc_on_save: false,
            concurrent_calc: false,
            concurrent_manual_count: Some(4),
            calc_id: Some(191029),
            force_full_calc: true,
            has_explicit_iterate_count: true,
            has_explicit_iterate_delta: true,
        };
        let settings: CalculationSettings = domain.into();
        assert_eq!(settings.enable_iterative_calculation, true);
        assert_eq!(settings.max_iterations, 250);
        assert_eq!(settings.max_change.get(), 0.05);
        assert_eq!(settings.calc_mode, CalcMode::Manual);
        assert_eq!(settings.full_precision, false);
        assert_eq!(settings.r1c1_mode, true);
        assert_eq!(settings.full_calc_on_load, true);
        assert_eq!(settings.calc_completed, false);
        assert_eq!(settings.calc_on_save, false);
        assert_eq!(settings.concurrent_calc, false);
        assert_eq!(settings.concurrent_manual_count, Some(4));
        assert_eq!(settings.force_full_calc, true);
        assert_eq!(settings.calc_id, Some(191029));
    }

    #[test]
    fn from_domain_calc_props_defaults() {
        let domain = domain_types::domain::workbook::CalculationProperties::default();
        let settings: CalculationSettings = domain.into();
        assert_eq!(settings.enable_iterative_calculation, false);
        assert_eq!(settings.max_iterations, 100);
        assert_eq!(settings.max_change.get(), 0.001);
        assert_eq!(settings.calc_mode, CalcMode::Auto);
        assert_eq!(settings.full_precision, true);
        assert_eq!(settings.r1c1_mode, false);
        assert_eq!(settings.full_calc_on_load, false);
        assert_eq!(settings.force_full_calc, false);
    }

    // ----------------------------------------------------------------
    // CalcMode conversion: all three variants
    // ----------------------------------------------------------------

    #[test]
    fn calc_mode_conversion_auto() {
        let domain = domain_types::domain::workbook::CalcMode::Auto;
        let snapshot: CalcMode = domain.into();
        assert_eq!(snapshot, CalcMode::Auto);
    }

    #[test]
    fn calc_mode_conversion_auto_no_table() {
        let domain = domain_types::domain::workbook::CalcMode::AutoNoTable;
        let snapshot: CalcMode = domain.into();
        assert_eq!(snapshot, CalcMode::AutoNoTable);
    }

    #[test]
    fn calc_mode_conversion_manual() {
        let domain = domain_types::domain::workbook::CalcMode::Manual;
        let snapshot: CalcMode = domain.into();
        assert_eq!(snapshot, CalcMode::Manual);
    }

    // ----------------------------------------------------------------
    // WorkbookSettings serde: date1904 with camelCase
    // ----------------------------------------------------------------

    #[test]
    fn workbook_settings_date1904_serde() {
        let mut settings = WorkbookSettings::default();
        settings.date1904 = true;

        let json = serde_json::to_string(&settings).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            v["date1904"], true,
            "date1904 should serialize as camelCase"
        );

        let deserialized: WorkbookSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.date1904, true);
    }

    #[test]
    fn workbook_settings_default_serde_roundtrip() {
        let original = WorkbookSettings::default();
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: WorkbookSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn workbook_settings_automatic_conversion_policy_defaults_true() {
        let settings: WorkbookSettings = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(
            settings.automatic_conversion_policy,
            AutomaticConversionPolicy::default()
        );

        let partial: WorkbookSettings =
            serde_json::from_str(r#"{"automaticConversionPolicy":{"convertDateLikeText":false}}"#)
                .unwrap();
        assert!(!partial.automatic_conversion_policy.convert_date_like_text);
        assert!(partial.automatic_conversion_policy.convert_time_like_text);
    }

    #[test]
    fn rust_workbook_settings_patch_rejects_non_nullable_null() {
        let err = serde_json::from_str::<RustWorkbookSettingsPatch>(r#"{"showFormulaBar":null}"#)
            .unwrap_err();
        assert!(err.to_string().contains("explicit null"));

        let nested = serde_json::from_str::<RustWorkbookSettingsPatch>(
            r#"{"automaticConversionPolicy":{"convertDateLikeText":null}}"#,
        )
        .unwrap_err();
        assert!(nested.to_string().contains("explicit null"));
    }

    #[test]
    fn rust_workbook_settings_patch_nullable_distinguishes_null() {
        let patch: RustWorkbookSettingsPatch =
            serde_json::from_str(r#"{"themeFontsId":null}"#).unwrap();
        assert_eq!(patch.theme_fonts_id, Some(None));

        let patch: RustWorkbookSettingsPatch =
            serde_json::from_str(r#"{"themeFontsId":"office"}"#).unwrap();
        assert_eq!(patch.theme_fonts_id, Some(Some("office".to_string())));
    }

    // ----------------------------------------------------------------
    // CalculationSettings enriched serde: new fields
    // ----------------------------------------------------------------

    #[test]
    fn calc_settings_enriched_serde_roundtrip() {
        let settings = CalculationSettings {
            enable_iterative_calculation: true,
            max_iterations: 500,
            max_change: FiniteF64::must(0.0001),
            calc_mode: CalcMode::Manual,
            full_precision: false,
            r1c1_mode: true,
            full_calc_on_load: true,
            force_full_calc: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: CalculationSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(settings, deserialized);

        // Verify camelCase for new fields
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v.get("calcMode").is_some(), "expected camelCase calcMode");
        assert!(
            v.get("fullPrecision").is_some(),
            "expected camelCase fullPrecision"
        );
        assert!(v.get("r1c1Mode").is_some(), "expected camelCase r1c1Mode");
        assert!(
            v.get("fullCalcOnLoad").is_some(),
            "expected camelCase fullCalcOnLoad"
        );
        assert!(
            v.get("forceFullCalc").is_some(),
            "expected camelCase forceFullCalc"
        );
    }

    #[test]
    fn calc_settings_default_serde_roundtrip() {
        let original = CalculationSettings::default();
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: CalculationSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn calc_settings_partial_json_defaults() {
        // Only provide iterative calc fields; new fields should get defaults
        let json =
            r#"{"enableIterativeCalculation": true, "maxIterations": 200, "maxChange": 0.01}"#;
        let settings: CalculationSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.enable_iterative_calculation, true);
        assert_eq!(settings.max_iterations, 200);
        assert_eq!(settings.max_change.get(), 0.01);
        // New fields should default
        assert_eq!(settings.calc_mode, CalcMode::Auto);
        assert_eq!(settings.full_precision, true);
        assert_eq!(settings.r1c1_mode, false);
        assert_eq!(settings.full_calc_on_load, false);
        assert_eq!(settings.force_full_calc, false);
    }

    #[test]
    fn calc_mode_serde_camel_case() {
        assert_eq!(serde_json::to_string(&CalcMode::Auto).unwrap(), r#""auto""#);
        assert_eq!(
            serde_json::to_string(&CalcMode::AutoNoTable).unwrap(),
            r#""autoNoTable""#
        );
        assert_eq!(
            serde_json::to_string(&CalcMode::Manual).unwrap(),
            r#""manual""#
        );

        assert_eq!(
            serde_json::from_str::<CalcMode>(r#""auto""#).unwrap(),
            CalcMode::Auto
        );
        assert_eq!(
            serde_json::from_str::<CalcMode>(r#""autoNoTable""#).unwrap(),
            CalcMode::AutoNoTable
        );
        assert_eq!(
            serde_json::from_str::<CalcMode>(r#""manual""#).unwrap(),
            CalcMode::Manual
        );
    }
}
