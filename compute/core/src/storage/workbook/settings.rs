//! Workbook Settings Storage Module
//!
//! Provides CRUD operations for workbook-level settings stored in the Yrs CRDT
//! document. Settings are stored in the `workbookSettings` Y.Map at the workbook
//! level.
//!
//! This is the Rust equivalent of `spreadsheet-model/src/workbook.ts`, porting
//! workbook settings management from TypeScript to Rust.
//!
//! # Operations
//!
//! - **get_settings** / **get_setting** — Read all or single settings
//! - **set_setting** / **set_settings** — Write single or multiple settings
//! - **reset_settings** — Clear all settings to defaults
//! - **protect_workbook** / **unprotect_workbook** — Protection management
//! - **is_operation_allowed** — Protection enforcement
//!
//! # Pattern
//!
//! All operations are free functions that take `(&Doc, &MapRef)` for the Yrs
//! document and workbook map. This is Pattern C: explicit Yrs component params.

use std::sync::Arc;

use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::snapshot::{
    AutomaticConversionPolicy, AutomaticConversionPolicyPatch, CalculationSettings,
    ProtectedWorkbookOperation, RustWorkbookSettingsPatch, WorkbookProtectionOptions,
    WorkbookSettings,
};
use compute_document::undo::ORIGIN_USER_EDIT;

use crate::storage::infra::yrs_helpers::{any_to_json, read_bool, read_json, read_string};
use compute_document::schema::KEY_WORKBOOK_SETTINGS;
use domain_types::domain::slicer::{NamedSlicerStyle, SlicerCustomStyle};
use domain_types::domain::workbook::WorkbookProtection;
use domain_types::yrs_schema::protection;
use value_types::ComputeError;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Get the workbook settings map from the Yrs document.
fn get_settings_map<T: yrs::ReadTxn>(workbook: &MapRef, txn: &T) -> Option<MapRef> {
    match workbook.get(txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

/// Get all workbook settings from the Yrs document.
///
/// Reads each setting from the `workbookSettings` Y.Map and falls back to
/// defaults for any missing values. This matches the TS `getSettings()`.
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
fn build_settings_from_map<T: yrs::ReadTxn>(
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
            Some(Out::YMap(prot_map)) => read_bool(&prot_map, txn, protection::KEY_WB_IS_PROTECTED)
                .unwrap_or(defaults.is_workbook_protected),
            _ => defaults.is_workbook_protected,
        },
        workbook_protection_password_hash: match map.get(txn, "protection") {
            Some(Out::YMap(prot_map)) => match protection::workbook_from_yrs_map(&prot_map, txn) {
                Some(prot) => prot.workbook_hash_value,
                None => None,
            },
            _ => None,
        },
        workbook_protection_options: match map.get(txn, "protection") {
            Some(Out::YMap(prot_map)) => match protection::workbook_from_yrs_map(&prot_map, txn) {
                Some(prot) => Some(WorkbookProtectionOptions {
                    structure: prot.lock_structure,
                }),
                None => None,
            },
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

fn read_automatic_conversion_policy<T: yrs::ReadTxn>(
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

/// Get calculation settings with defaults applied.
pub fn get_calculation_settings(doc: &Doc, workbook: &MapRef) -> CalculationSettings {
    let settings = get_settings(doc, workbook);
    settings.calculation_settings.unwrap_or_default()
}

/// Check if iterative calculation is enabled.
pub fn is_iterative_calculation_enabled(doc: &Doc, workbook: &MapRef) -> bool {
    get_calculation_settings(doc, workbook).enable_iterative_calculation
}

// ---------------------------------------------------------------------------
// Setters
// ---------------------------------------------------------------------------

/// Set a single workbook setting.
///
/// The key should be the camelCase name matching the TypeScript `WorkbookSettings`
/// interface (e.g., "showHorizontalScrollbar", "themeId", etc.).
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

fn apply_patch_to_settings(settings: &mut WorkbookSettings, patch: &RustWorkbookSettingsPatch) {
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

fn patch_automatic_conversion_policy_in_txn(
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
/// Serializes to a JSON object and stores via `json_to_any`, which converts to
/// a structured `Any::Map` instead of a JSON string.
pub fn set_calculation_settings(doc: &Doc, workbook: &MapRef, updates: &CalculationSettings) {
    let json_val =
        serde_json::to_value(updates).expect("CalculationSettings serialization should not fail");
    set_setting(doc, workbook, "calculationSettings", json_val);
}

/// Enable or disable iterative calculation.
pub fn set_iterative_calculation_enabled(doc: &Doc, workbook: &MapRef, enabled: bool) {
    let mut current = get_calculation_settings(doc, workbook);
    current.enable_iterative_calculation = enabled;
    set_calculation_settings(doc, workbook, &current);
}

/// Set the default table style ID for new tables.
/// Pass `None` to clear the default (will use 'medium2').
pub fn set_default_table_style_id(doc: &Doc, workbook: &MapRef, style_id: Option<&str>) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    match style_id {
        Some(id) => {
            settings_map.insert(&mut txn, "defaultTableStyleId", Any::String(Arc::from(id)));
        }
        None => {
            settings_map.remove(&mut txn, "defaultTableStyleId");
        }
    }
}

/// Get the default table style ID for new tables.
pub fn get_default_table_style_id(doc: &Doc, workbook: &MapRef) -> Option<String> {
    let txn = doc.transact();
    let settings_map = get_settings_map(workbook, &txn)?;
    read_string(&settings_map, &txn, "defaultTableStyleId")
}

/// Set the default slicer style for new slicers.
/// Pass `None` to clear the default (will use 'light1').
pub fn set_default_slicer_style(doc: &Doc, workbook: &MapRef, style_id: Option<&str>) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    match style_id {
        Some(id) => {
            settings_map.insert(&mut txn, "defaultSlicerStyle", Any::String(Arc::from(id)));
        }
        None => {
            settings_map.remove(&mut txn, "defaultSlicerStyle");
        }
    }
}

/// Get the default slicer style for new slicers.
pub fn get_default_slicer_style(doc: &Doc, workbook: &MapRef) -> Option<String> {
    let txn = doc.transact();
    let settings_map = get_settings_map(workbook, &txn)?;
    read_string(&settings_map, &txn, "defaultSlicerStyle")
}

/// Set the default pivot table style for new pivot tables.
/// Pass `None` to clear the default (will use 'PivotStyleLight16').
pub fn set_default_pivot_table_style(doc: &Doc, workbook: &MapRef, style_id: Option<&str>) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    match style_id {
        Some(id) => {
            settings_map.insert(
                &mut txn,
                "defaultPivotTableStyle",
                Any::String(Arc::from(id)),
            );
        }
        None => {
            settings_map.remove(&mut txn, "defaultPivotTableStyle");
        }
    }
}

/// Get the default pivot table style for new pivot tables.
pub fn get_default_pivot_table_style(doc: &Doc, workbook: &MapRef) -> Option<String> {
    let txn = doc.transact();
    let settings_map = get_settings_map(workbook, &txn)?;
    read_string(&settings_map, &txn, "defaultPivotTableStyle")
}

// ---------------------------------------------------------------------------
// Named Slicer Style Registry
// ---------------------------------------------------------------------------

/// Key within the settings map that holds the named slicer styles sub-map.
const KEY_NAMED_SLICER_STYLES: &str = "namedSlicerStyles";

/// Ensure the named slicer styles sub-map exists, creating it if necessary.
fn ensure_named_slicer_styles_map(
    settings_map: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
) -> MapRef {
    match settings_map.get(txn, KEY_NAMED_SLICER_STYLES) {
        Some(Out::YMap(m)) => m,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            settings_map.insert(txn, KEY_NAMED_SLICER_STYLES, empty)
        }
    }
}

/// Get the named slicer styles sub-map (read-only).
fn get_named_slicer_styles_map<T: yrs::ReadTxn>(settings_map: &MapRef, txn: &T) -> Option<MapRef> {
    match settings_map.get(txn, KEY_NAMED_SLICER_STYLES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Generate a unique name by appending a numeric suffix if needed.
fn make_unique_style_name<T: yrs::ReadTxn>(
    styles_map: &MapRef,
    txn: &T,
    base_name: &str,
) -> String {
    if styles_map.get(txn, base_name).is_none() {
        return base_name.to_string();
    }
    let mut suffix = 1u32;
    loop {
        let candidate = format!("{base_name}{suffix}");
        if styles_map.get(txn, candidate.as_str()).is_none() {
            return candidate;
        }
        suffix += 1;
    }
}

/// Add a named slicer style to the workbook registry.
///
/// If `make_unique` is `true` and a style with the given name already exists,
/// a numeric suffix is appended to make the name unique. When `make_unique` is
/// `false`, an error is returned if a style with the given name already exists.
/// Returns the final name used.
pub fn add_named_slicer_style(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
    style: SlicerCustomStyle,
    make_unique: bool,
) -> Result<String, ComputeError> {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);
    let styles_map = ensure_named_slicer_styles_map(&settings_map, &mut txn);

    let final_name = if make_unique {
        make_unique_style_name(&styles_map, &txn, name)
    } else {
        // Reject if a style with this name already exists.
        if styles_map.get(&txn, name).is_some() {
            return Err(ComputeError::InvalidInput {
                message: format!("Slicer style '{name}' already exists"),
            });
        }
        name.to_string()
    };

    let named_style = NamedSlicerStyle {
        name: final_name.clone(),
        read_only: false,
        style,
    };
    let json_str = serde_json::to_string(&named_style).map_err(|e| ComputeError::InvalidInput {
        message: format!("Failed to serialize slicer style: {e}"),
    })?;
    styles_map.insert(
        &mut txn,
        final_name.as_str(),
        Any::String(Arc::from(json_str.as_str())),
    );
    Ok(final_name)
}

/// Get a named slicer style by name.
///
/// Returns `Ok(Some(style))` if found, `Ok(None)` if no entry exists for that
/// name, or `Err` if the stored data is corrupted and cannot be deserialized.
pub fn get_named_slicer_style(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
) -> Result<Option<NamedSlicerStyle>, ComputeError> {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return Ok(None),
    };
    let styles_map = match get_named_slicer_styles_map(&settings_map, &txn) {
        Some(m) => m,
        None => return Ok(None),
    };
    match styles_map.get(&txn, name) {
        Some(Out::Any(Any::String(s))) => match serde_json::from_str::<NamedSlicerStyle>(&s) {
            Ok(style) => Ok(Some(style)),
            Err(e) => {
                tracing::warn!("Failed to deserialize named slicer style '{name}': {e}");
                Err(ComputeError::InvalidInput {
                    message: format!("Corrupted slicer style data for '{name}': {e}"),
                })
            }
        },
        _ => Ok(None),
    }
}

/// Delete a named slicer style. Fails if the style is read-only or not found.
///
/// All checks and the removal are performed within a single mutable
/// transaction to avoid TOCTOU races.
pub fn delete_named_slicer_style(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
) -> Result<(), ComputeError> {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    // Navigate to the styles map. A TransactionMut implements ReadTxn, so we
    // can use `get_settings_map` (read-only lookup) within the mutable txn.
    let settings_map =
        get_settings_map(workbook, &txn).ok_or_else(|| ComputeError::InvalidInput {
            message: format!("Named slicer style not found: {name}"),
        })?;
    let styles_map = get_named_slicer_styles_map(&settings_map, &txn).ok_or_else(|| {
        ComputeError::InvalidInput {
            message: format!("Named slicer style not found: {name}"),
        }
    })?;

    // Check existence and read_only status.
    let existing = match styles_map.get(&txn, name) {
        Some(Out::Any(Any::String(s))) => match serde_json::from_str::<NamedSlicerStyle>(&s) {
            Ok(style) => Some(style),
            Err(e) => {
                tracing::warn!("Failed to deserialize named slicer style '{name}': {e}");
                return Err(ComputeError::InvalidInput {
                    message: format!("Corrupted slicer style data for '{name}': {e}"),
                });
            }
        },
        _ => None,
    };

    match existing {
        None => {
            return Err(ComputeError::InvalidInput {
                message: format!("Named slicer style not found: {name}"),
            });
        }
        Some(style) if style.read_only => {
            return Err(ComputeError::InvalidInput {
                message: format!("Cannot delete read-only slicer style: {name}"),
            });
        }
        _ => {}
    }

    // Perform the deletion within the same transaction.
    styles_map.remove(&mut txn, name);
    Ok(())
}

/// Duplicate a named slicer style, creating a copy with a unique name.
///
/// The new name is formed as "{original} Copy", with a numeric suffix if that
/// name is already taken. The read + write are performed in a single mutable
/// transaction to avoid TOCTOU races. Returns the new style's name.
pub fn duplicate_named_slicer_style(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
) -> Result<String, ComputeError> {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);
    let styles_map = ensure_named_slicer_styles_map(&settings_map, &mut txn);

    // Read the original style within this transaction.
    let original = match styles_map.get(&txn, name) {
        Some(Out::Any(Any::String(s))) => {
            serde_json::from_str::<NamedSlicerStyle>(&s).map_err(|e| {
                tracing::warn!("Failed to deserialize named slicer style '{name}': {e}");
                ComputeError::InvalidInput {
                    message: format!("Corrupted slicer style data for '{name}': {e}"),
                }
            })?
        }
        _ => {
            return Err(ComputeError::InvalidInput {
                message: format!("Named slicer style not found: {name}"),
            });
        }
    };

    // Generate unique name and insert, all within the same transaction.
    let base_copy_name = format!("{name} Copy");
    let final_name = make_unique_style_name(&styles_map, &txn, &base_copy_name);

    let new_style = NamedSlicerStyle {
        name: final_name.clone(),
        read_only: false,
        style: original.style,
    };
    let json_str = serde_json::to_string(&new_style).map_err(|e| ComputeError::InvalidInput {
        message: format!("Failed to serialize slicer style: {e}"),
    })?;
    styles_map.insert(
        &mut txn,
        final_name.as_str(),
        Any::String(Arc::from(json_str.as_str())),
    );
    Ok(final_name)
}

/// Get the count of named slicer styles in the registry.
pub fn get_named_slicer_style_count(doc: &Doc, workbook: &MapRef) -> u32 {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return 0,
    };
    let styles_map = match get_named_slicer_styles_map(&settings_map, &txn) {
        Some(m) => m,
        None => return 0,
    };
    styles_map.len(&txn)
}

/// List all named slicer styles in the registry.
pub fn list_named_slicer_styles(doc: &Doc, workbook: &MapRef) -> Vec<NamedSlicerStyle> {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return Vec::new(),
    };
    let styles_map = match get_named_slicer_styles_map(&settings_map, &txn) {
        Some(m) => m,
        None => return Vec::new(),
    };

    let mut result = Vec::new();
    for (key, value) in styles_map.iter(&txn) {
        if let Out::Any(Any::String(s)) = value {
            match serde_json::from_str::<NamedSlicerStyle>(&s) {
                Ok(style) => result.push(style),
                Err(e) => {
                    tracing::warn!("Skipping corrupted named slicer style '{key}': {e}");
                }
            }
        }
    }
    result
}

// ---------------------------------------------------------------------------
// Custom Settings (arbitrary KV store)
// ---------------------------------------------------------------------------

/// Get a custom setting value by key.
pub fn get_custom_setting(doc: &Doc, workbook: &MapRef, key: &str) -> Option<String> {
    let txn = doc.transact();
    let settings_map = get_settings_map(workbook, &txn)?;
    if let Some(Out::YMap(custom_map)) = settings_map.get(&txn, "customSettings")
        && let Some(Out::Any(Any::String(v))) = custom_map.get(&txn, key)
    {
        return Some(v.to_string());
    }
    None
}

/// Set a custom setting value. Pass `None` to delete the key.
pub fn set_custom_setting(doc: &Doc, workbook: &MapRef, key: &str, value: Option<&str>) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    let custom_map = match settings_map.get(&txn, "customSettings") {
        Some(Out::YMap(m)) => m,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            settings_map.insert(&mut txn, "customSettings", empty)
        }
    };

    match value {
        Some(v) => {
            custom_map.insert(&mut txn, key, Any::String(Arc::from(v)));
        }
        None => {
            custom_map.remove(&mut txn, key);
        }
    }
}

/// List all custom settings as key-value pairs.
pub fn list_custom_settings(doc: &Doc, workbook: &MapRef) -> Vec<(String, String)> {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return Vec::new(),
    };
    let custom_map = match settings_map.get(&txn, "customSettings") {
        Some(Out::YMap(m)) => m,
        _ => return Vec::new(),
    };

    let mut result = Vec::new();
    for (key, value) in custom_map.iter(&txn) {
        if let Out::Any(Any::String(v)) = value {
            result.push((key.to_string(), v.to_string()));
        }
    }
    result
}

// ---------------------------------------------------------------------------
// Workbook Protection
// ---------------------------------------------------------------------------

/// Check if the workbook is protected.
pub fn is_protected(doc: &Doc, workbook: &MapRef) -> bool {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return false,
    };
    if let Some(Out::YMap(prot_map)) = settings_map.get(&txn, "protection") {
        return read_bool(&prot_map, &txn, protection::KEY_WB_IS_PROTECTED).unwrap_or(false);
    }
    false
}

/// Get workbook protection options.
pub fn get_protection_options(doc: &Doc, workbook: &MapRef) -> WorkbookProtectionOptions {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return WorkbookProtectionOptions::default(),
    };
    if let Some(Out::YMap(prot_map)) = settings_map.get(&txn, "protection")
        && let Some(prot) = protection::workbook_from_yrs_map(&prot_map, &txn)
    {
        return WorkbookProtectionOptions {
            structure: prot.lock_structure,
        };
    }
    WorkbookProtectionOptions::default()
}

/// Check if the workbook has a protection password set.
pub fn has_protection_password(doc: &Doc, workbook: &MapRef) -> bool {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return false,
    };
    if let Some(Out::YMap(prot_map)) = settings_map.get(&txn, "protection")
        && let Some(prot) = protection::workbook_from_yrs_map(&prot_map, &txn)
    {
        return prot
            .workbook_hash_value
            .as_ref()
            .map(|h| !h.is_empty())
            .unwrap_or(false);
    }
    false
}

/// Protect the workbook with optional password hash and options.
///
/// Prevents sheet structure operations (add, delete, move, rename, hide, unhide).
///
/// Note: Password hashing is done by the caller (TypeScript layer) using
/// Excel-compatible XOR hashing. This function stores the pre-computed hash.
pub fn protect_workbook(
    doc: &Doc,
    workbook: &MapRef,
    password_hash: Option<&str>,
    options: Option<&WorkbookProtectionOptions>,
) {
    let full_options = options.cloned().unwrap_or_default();

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = ensure_settings_map(workbook, &mut txn);

    // Write structured "protection" sub-map
    let mut domain_prot = WorkbookProtection {
        lock_structure: full_options.structure,
        ..Default::default()
    };
    if let Some(hash) = password_hash
        && !hash.is_empty()
    {
        domain_prot.workbook_hash_value = Some(hash.to_string());
    }
    let mut entries = protection::workbook_to_yrs_prelim(&domain_prot);
    entries.push((protection::KEY_WB_IS_PROTECTED, Any::Bool(true)));
    let prot_prelim: MapPrelim = entries.into_iter().collect();
    settings_map.insert(&mut txn, "protection", prot_prelim);
}

/// Unprotect the workbook.
///
/// If the workbook has a password, the caller must verify it before calling
/// this function. This function does NOT verify the password — that responsibility
/// belongs to the TypeScript layer which has the hashing implementation.
///
/// Returns `true` if the workbook was successfully unprotected,
/// `false` if the provided password hash doesn't match the stored one.
pub fn unprotect_workbook(doc: &Doc, workbook: &MapRef, password_hash: Option<&str>) -> bool {
    let txn = doc.transact();
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return true, // No settings = not protected
    };

    // Check if workbook is even protected via structured "protection" sub-map
    let (is_protected, stored_hash) =
        if let Some(Out::YMap(prot_map)) = settings_map.get(&txn, "protection") {
            let protected =
                read_bool(&prot_map, &txn, protection::KEY_WB_IS_PROTECTED).unwrap_or(false);
            let hash = protection::workbook_from_yrs_map(&prot_map, &txn)
                .and_then(|prot| prot.workbook_hash_value);
            (protected, hash)
        } else {
            (false, None)
        };

    if !is_protected {
        return true; // Already unprotected
    }

    // Verify password hash if set
    if let Some(ref stored) = stored_hash
        && !stored.is_empty()
    {
        match password_hash {
            Some(provided) => {
                if provided != stored {
                    return false; // Wrong password
                }
            }
            None => return false, // Password required but not provided
        }
    }
    drop(txn);

    // Perform the unprotect
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let settings_map = match get_settings_map(workbook, &txn) {
        Some(m) => m,
        None => return true,
    };

    // Write default (unprotected) state to the structured "protection" sub-map
    let domain_prot = WorkbookProtection::default();
    let mut entries = protection::workbook_to_yrs_prelim(&domain_prot);
    entries.push((protection::KEY_WB_IS_PROTECTED, Any::Bool(false)));
    let prot_prelim: MapPrelim = entries.into_iter().collect();
    settings_map.insert(&mut txn, "protection", prot_prelim);

    true
}

/// Check if a workbook-level operation is allowed.
///
/// This checks workbook protection only.
pub fn is_operation_allowed(
    doc: &Doc,
    workbook: &MapRef,
    operation: ProtectedWorkbookOperation,
) -> bool {
    // If workbook is not protected, all operations are allowed
    if !is_protected(doc, workbook) {
        return true;
    }

    let options = get_protection_options(doc, workbook);

    // Structure protection prevents all sheet structure operations
    if options.structure {
        !matches!(
            operation,
            ProtectedWorkbookOperation::AddSheet
                | ProtectedWorkbookOperation::DeleteSheet
                | ProtectedWorkbookOperation::RenameSheet
                | ProtectedWorkbookOperation::MoveSheet
                | ProtectedWorkbookOperation::HideSheet
                | ProtectedWorkbookOperation::UnhideSheet
                | ProtectedWorkbookOperation::CopySheet
        )
    } else {
        true
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Ensure the workbook settings map exists, creating it if necessary.
fn ensure_settings_map(workbook: &MapRef, txn: &mut yrs::TransactionMut<'_>) -> MapRef {
    match workbook.get(txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => m,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            workbook.insert(txn, KEY_WORKBOOK_SETTINGS, empty)
        }
    }
}

/// Convert a `serde_json::Value` to a `yrs::Any` for storage.
///
/// Recursively converts JSON objects to `Any::Map` and JSON arrays to
/// `Any::Array`, preserving structure instead of falling back to a serialized
/// JSON string.
fn json_to_any(value: &serde_json::Value) -> Any {
    match value {
        serde_json::Value::Null => Any::Null,
        serde_json::Value::Bool(b) => Any::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                Any::Number(f)
            } else {
                Any::Null
            }
        }
        serde_json::Value::String(s) => Any::String(Arc::from(s.as_str())),
        serde_json::Value::Object(map) => {
            let entries: std::collections::HashMap<String, Any> = map
                .iter()
                .map(|(k, v)| (k.clone(), json_to_any(v)))
                .collect();
            Any::Map(Arc::from(entries))
        }
        serde_json::Value::Array(arr) => {
            let items: Vec<Any> = arr.iter().map(json_to_any).collect();
            Any::Array(Arc::from(items))
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;

    // -------------------------------------------------------------------
    // Test 1: Default settings on empty storage
    // -------------------------------------------------------------------

    #[test]
    fn test_get_settings_defaults_on_empty() {
        let storage = YrsStorage::new();
        let settings = get_settings(storage.doc(), storage.workbook_map());
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
    fn test_protect_workbook() {
        let storage = YrsStorage::new();

        // Initially not protected
        assert!(!is_protected(storage.doc(), storage.workbook_map()));
        assert!(is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::AddSheet
        ));

        // Protect without password
        protect_workbook(storage.doc(), storage.workbook_map(), None, None);

        assert!(is_protected(storage.doc(), storage.workbook_map()));
        assert!(!has_protection_password(
            storage.doc(),
            storage.workbook_map()
        ));

        // Structure operations should be blocked
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::AddSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::DeleteSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::RenameSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::MoveSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::HideSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::UnhideSheet
        ));
        assert!(!is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::CopySheet
        ));
    }

    // -------------------------------------------------------------------
    // Test 7: Protection — protect with password
    // -------------------------------------------------------------------

    #[test]
    fn test_protect_workbook_with_password() {
        let storage = YrsStorage::new();

        // Protect with a password hash
        protect_workbook(storage.doc(), storage.workbook_map(), Some("ABCD"), None);

        assert!(is_protected(storage.doc(), storage.workbook_map()));
        assert!(has_protection_password(
            storage.doc(),
            storage.workbook_map()
        ));

        // Cannot unprotect with wrong password
        assert!(!unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            Some("WRONG")
        ));
        assert!(is_protected(storage.doc(), storage.workbook_map()));

        // Cannot unprotect without password
        assert!(!unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            None
        ));
        assert!(is_protected(storage.doc(), storage.workbook_map()));

        // Can unprotect with correct password
        assert!(unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            Some("ABCD")
        ));
        assert!(!is_protected(storage.doc(), storage.workbook_map()));
    }

    // -------------------------------------------------------------------
    // Test 8: Protection — unprotect without password
    // -------------------------------------------------------------------

    #[test]
    fn test_unprotect_workbook_no_password() {
        let storage = YrsStorage::new();

        protect_workbook(storage.doc(), storage.workbook_map(), None, None);
        assert!(is_protected(storage.doc(), storage.workbook_map()));

        // Unprotect succeeds without password when no password was set
        assert!(unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            None
        ));
        assert!(!is_protected(storage.doc(), storage.workbook_map()));
    }

    // -------------------------------------------------------------------
    // Test 9: Protection — unprotect clears all protection state
    // -------------------------------------------------------------------

    #[test]
    fn test_unprotect_clears_state() {
        let storage = YrsStorage::new();

        protect_workbook(storage.doc(), storage.workbook_map(), Some("HASH"), None);
        assert!(is_protected(storage.doc(), storage.workbook_map()));
        assert!(has_protection_password(
            storage.doc(),
            storage.workbook_map()
        ));

        // Verify protection options are set
        let options = get_protection_options(storage.doc(), storage.workbook_map());
        assert!(options.structure);

        // Unprotect
        assert!(unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            Some("HASH")
        ));

        assert!(!is_protected(storage.doc(), storage.workbook_map()));
        assert!(!has_protection_password(
            storage.doc(),
            storage.workbook_map()
        ));

        // Operations should be allowed again
        assert!(is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::AddSheet
        ));
    }

    // -------------------------------------------------------------------
    // Test 10: Protection — custom options
    // -------------------------------------------------------------------

    #[test]
    fn test_protect_with_custom_options() {
        let storage = YrsStorage::new();

        let options = WorkbookProtectionOptions { structure: false };
        protect_workbook(storage.doc(), storage.workbook_map(), None, Some(&options));

        assert!(is_protected(storage.doc(), storage.workbook_map()));

        // Structure is not protected, so operations should be allowed
        assert!(is_operation_allowed(
            storage.doc(),
            storage.workbook_map(),
            ProtectedWorkbookOperation::AddSheet
        ));
    }

    // -------------------------------------------------------------------
    // Test 11: Already unprotected — unprotect returns true
    // -------------------------------------------------------------------

    #[test]
    fn test_unprotect_already_unprotected() {
        let storage = YrsStorage::new();

        // Not protected at all
        assert!(unprotect_workbook(
            storage.doc(),
            storage.workbook_map(),
            None
        ));
    }

    // -------------------------------------------------------------------
    // Test 12: Calculation settings
    // -------------------------------------------------------------------

    #[test]
    fn test_calculation_settings() {
        let storage = YrsStorage::new();

        // Default: iterative calc disabled
        let calc = get_calculation_settings(storage.doc(), storage.workbook_map());
        assert!(!calc.enable_iterative_calculation);
        assert_eq!(calc.max_iterations, 100);
        assert!((calc.max_change.get() - 0.001).abs() < f64::EPSILON);

        assert!(!is_iterative_calculation_enabled(
            storage.doc(),
            storage.workbook_map()
        ));

        // Enable iterative calc
        set_iterative_calculation_enabled(storage.doc(), storage.workbook_map(), true);

        assert!(is_iterative_calculation_enabled(
            storage.doc(),
            storage.workbook_map()
        ));

        // Set full calculation settings
        let new_calc = CalculationSettings {
            enable_iterative_calculation: true,
            max_iterations: 500,
            max_change: value_types::FiniteF64::must(0.0001),
            ..Default::default()
        };
        set_calculation_settings(storage.doc(), storage.workbook_map(), &new_calc);

        let calc = get_calculation_settings(storage.doc(), storage.workbook_map());
        assert!(calc.enable_iterative_calculation);
        assert_eq!(calc.max_iterations, 500);
        assert!((calc.max_change.get() - 0.0001).abs() < f64::EPSILON);
    }

    // -------------------------------------------------------------------
    // Test 13: Default table style ID
    // -------------------------------------------------------------------

    #[test]
    fn test_default_table_style_id() {
        let storage = YrsStorage::new();

        // Default: none
        assert!(get_default_table_style_id(storage.doc(), storage.workbook_map()).is_none());

        // Set a style
        set_default_table_style_id(storage.doc(), storage.workbook_map(), Some("dark1"));
        assert_eq!(
            get_default_table_style_id(storage.doc(), storage.workbook_map()),
            Some("dark1".to_string())
        );

        // Clear the style
        set_default_table_style_id(storage.doc(), storage.workbook_map(), None);
        assert!(get_default_table_style_id(storage.doc(), storage.workbook_map()).is_none());
    }

    // -------------------------------------------------------------------
    // Test 14: get_setting returns correct value
    // -------------------------------------------------------------------

    #[test]
    fn test_get_setting_individual() {
        let storage = YrsStorage::new();

        // Set a boolean
        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "showTabStrip",
            serde_json::Value::Bool(false),
        );

        let val = get_setting(storage.doc(), storage.workbook_map(), "showTabStrip");
        assert_eq!(val, Some(serde_json::Value::Bool(false)));

        // Non-existent key returns None
        let val = get_setting(storage.doc(), storage.workbook_map(), "nonExistentKey");
        assert!(val.is_none());
    }

    // -------------------------------------------------------------------
    // Test 15: EnterKeyDirection setting
    // -------------------------------------------------------------------

    #[test]
    fn test_enter_key_direction() {
        let storage = YrsStorage::new();

        // Default is "down"
        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert_eq!(
            settings.enter_key_direction,
            crate::snapshot::EnterKeyDirection::Down
        );

        // Set to "right" — stored as JSON string
        let right_json = serde_json::to_string(&crate::snapshot::EnterKeyDirection::Right).unwrap();
        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "enterKeyDirection",
            serde_json::Value::String(right_json),
        );

        let settings = get_settings(storage.doc(), storage.workbook_map());
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
        let storage = YrsStorage::new();

        // Default: none
        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert!(settings.selected_sheet_ids.is_none());

        // Set selected sheets
        let sheet_ids = vec!["sheet1".to_string(), "sheet2".to_string()];
        let json_str = serde_json::to_string(&sheet_ids).unwrap();
        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "selectedSheetIds",
            serde_json::Value::String(json_str),
        );

        let settings = get_settings(storage.doc(), storage.workbook_map());
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
        let storage = YrsStorage::new();

        // Default: none
        let settings = get_settings(storage.doc(), storage.workbook_map());
        assert!(settings.theme_fonts_id.is_none());

        // Set theme fonts
        set_setting(
            storage.doc(),
            storage.workbook_map(),
            "themeFontsId",
            serde_json::Value::String("arial".to_string()),
        );

        let settings = get_settings(storage.doc(), storage.workbook_map());
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
    // -------------------------------------------------------------------

    #[test]
    fn test_calculation_settings_serde_roundtrip() {
        let calc = CalculationSettings {
            enable_iterative_calculation: true,
            max_iterations: 500,
            max_change: value_types::FiniteF64::must(0.0001),
            ..Default::default()
        };

        let json = serde_json::to_string(&calc).unwrap();
        let deserialized: CalculationSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(calc, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 21: CalculationSettings default serde
    // -------------------------------------------------------------------

    #[test]
    fn test_calculation_settings_default_serde() {
        let json = "{}";
        let calc: CalculationSettings = serde_json::from_str(json).unwrap();
        assert!(!calc.enable_iterative_calculation);
        assert_eq!(calc.max_iterations, 100);
        assert!((calc.max_change.get() - 0.001).abs() < f64::EPSILON);
    }

    // -------------------------------------------------------------------
    // Test 22: WorkbookProtectionOptions serde roundtrip
    // -------------------------------------------------------------------

    #[test]
    fn test_protection_options_serde_roundtrip() {
        let options = WorkbookProtectionOptions { structure: false };
        let json = serde_json::to_string(&options).unwrap();
        let deserialized: WorkbookProtectionOptions = serde_json::from_str(&json).unwrap();
        assert_eq!(options, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 23: Multiple set_setting calls accumulate
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

    // ===================================================================
    // Named Slicer Style Registry Tests
    // ===================================================================

    /// Helper: build a `SlicerCustomStyle` with identifiable colours.
    fn make_slicer_style(header_bg: &str) -> SlicerCustomStyle {
        SlicerCustomStyle {
            header_background_color: Some(header_bg.to_string()),
            header_text_color: Some("#FFFFFF".to_string()),
            header_font_size: Some(14.0),
            selected_background_color: Some("#0000FF".to_string()),
            selected_text_color: Some("#FFFFFF".to_string()),
            available_background_color: Some("#EEEEEE".to_string()),
            available_text_color: Some("#000000".to_string()),
            unavailable_background_color: None,
            unavailable_text_color: None,
            border_color: Some("#CCCCCC".to_string()),
            border_width: Some(1.0),
            item_border_radius: Some(4.0),
        }
    }

    // -------------------------------------------------------------------
    // Test 24: Add and get a named slicer style
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_add_and_get() {
        let storage = YrsStorage::new();
        let style = make_slicer_style("#FF0000");

        let name = add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "MyRedStyle",
            style.clone(),
            false,
        )
        .unwrap();
        assert_eq!(name, "MyRedStyle");

        let retrieved = get_named_slicer_style(storage.doc(), storage.workbook_map(), "MyRedStyle")
            .unwrap()
            .expect("style should exist");
        assert_eq!(retrieved.name, "MyRedStyle");
        assert!(!retrieved.read_only);
        assert_eq!(
            retrieved.style.header_background_color,
            Some("#FF0000".to_string())
        );
        assert_eq!(
            retrieved.style.header_text_color,
            Some("#FFFFFF".to_string())
        );
        assert_eq!(retrieved.style.header_font_size, Some(14.0));
        assert_eq!(
            retrieved.style.selected_background_color,
            Some("#0000FF".to_string())
        );
        assert_eq!(retrieved.style.border_width, Some(1.0));
        assert_eq!(retrieved.style.item_border_radius, Some(4.0));
        assert_eq!(retrieved.style, style);
    }

    // -------------------------------------------------------------------
    // Test 25: make_unique_name generates unique suffix on conflict
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_make_unique_name() {
        let storage = YrsStorage::new();

        let name1 = add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Corporate",
            make_slicer_style("#111111"),
            true,
        )
        .unwrap();
        assert_eq!(name1, "Corporate", "first add should use the name as-is");

        let name2 = add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Corporate",
            make_slicer_style("#222222"),
            true,
        )
        .unwrap();
        assert_eq!(name2, "Corporate1", "second add should get suffix 1");

        let name3 = add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Corporate",
            make_slicer_style("#333333"),
            true,
        )
        .unwrap();
        assert_eq!(name3, "Corporate2", "third add should get suffix 2");

        // All three should be independently retrievable.
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "Corporate")
                .unwrap()
                .is_some()
        );
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "Corporate1")
                .unwrap()
                .is_some()
        );
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "Corporate2")
                .unwrap()
                .is_some()
        );
    }

    // -------------------------------------------------------------------
    // Test 26: Delete non-read-only style succeeds
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_delete_non_readonly() {
        let storage = YrsStorage::new();

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Deletable",
            make_slicer_style("#AABBCC"),
            false,
        )
        .unwrap();
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "Deletable")
                .unwrap()
                .is_some()
        );

        delete_named_slicer_style(storage.doc(), storage.workbook_map(), "Deletable")
            .expect("delete should succeed for non-read-only style");

        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "Deletable")
                .unwrap()
                .is_none(),
            "style should be gone after deletion"
        );
    }

    // -------------------------------------------------------------------
    // Test 27: Delete read-only style fails
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_delete_readonly_fails() {
        let storage = YrsStorage::new();

        // Manually insert a read-only style by writing directly to the Yrs map.
        let read_only_style = NamedSlicerStyle {
            name: "BuiltIn".to_string(),
            read_only: true,
            style: make_slicer_style("#000000"),
        };
        {
            let mut txn = storage
                .doc()
                .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            let settings_map = ensure_settings_map(storage.workbook_map(), &mut txn);
            let styles_map = ensure_named_slicer_styles_map(&settings_map, &mut txn);
            let json_str = serde_json::to_string(&read_only_style).unwrap();
            styles_map.insert(
                &mut txn,
                "BuiltIn",
                Any::String(Arc::from(json_str.as_str())),
            );
        }

        // Verify it exists and is read-only.
        let retrieved = get_named_slicer_style(storage.doc(), storage.workbook_map(), "BuiltIn")
            .unwrap()
            .unwrap();
        assert!(retrieved.read_only);

        // Attempt to delete should fail.
        let result = delete_named_slicer_style(storage.doc(), storage.workbook_map(), "BuiltIn");
        assert!(result.is_err(), "deleting a read-only style should fail");
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("read-only"),
            "error message should mention read-only, got: {err_msg}"
        );

        // Style should still exist.
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "BuiltIn")
                .unwrap()
                .is_some()
        );
    }

    // -------------------------------------------------------------------
    // Test 28: Delete non-existent style fails
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_delete_nonexistent_fails() {
        let storage = YrsStorage::new();

        let result =
            delete_named_slicer_style(storage.doc(), storage.workbook_map(), "DoesNotExist");
        assert!(result.is_err(), "deleting non-existent style should fail");
    }

    // -------------------------------------------------------------------
    // Test 29: Duplicate creates copy with new name
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_duplicate() {
        let storage = YrsStorage::new();
        let original_style = make_slicer_style("#ABCDEF");

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Original",
            original_style.clone(),
            false,
        )
        .unwrap();

        let copy_name =
            duplicate_named_slicer_style(storage.doc(), storage.workbook_map(), "Original")
                .expect("duplicate should succeed");
        assert_eq!(copy_name, "Original Copy");

        let copy = get_named_slicer_style(storage.doc(), storage.workbook_map(), &copy_name)
            .unwrap()
            .unwrap();
        assert_eq!(copy.name, "Original Copy");
        assert!(!copy.read_only);
        assert_eq!(
            copy.style, original_style,
            "duplicated style properties should match original"
        );

        // Original should still exist and be unchanged.
        let original = get_named_slicer_style(storage.doc(), storage.workbook_map(), "Original")
            .unwrap()
            .unwrap();
        assert_eq!(original.style, original_style);
    }

    // -------------------------------------------------------------------
    // Test 30: Duplicate with name conflict appends suffix
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_duplicate_name_conflict() {
        let storage = YrsStorage::new();

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Base",
            make_slicer_style("#111111"),
            false,
        )
        .unwrap();

        // Pre-create "Base Copy" to force a conflict.
        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Base Copy",
            make_slicer_style("#222222"),
            false,
        )
        .unwrap();

        let dup_name =
            duplicate_named_slicer_style(storage.doc(), storage.workbook_map(), "Base").unwrap();
        assert_eq!(
            dup_name, "Base Copy1",
            "duplicate should append suffix when 'Base Copy' already exists"
        );
    }

    // -------------------------------------------------------------------
    // Test 31: Count reflects current registry size
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_count() {
        let storage = YrsStorage::new();

        // Initially zero.
        assert_eq!(
            get_named_slicer_style_count(storage.doc(), storage.workbook_map()),
            0
        );

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "S1",
            make_slicer_style("#AA0000"),
            false,
        )
        .unwrap();
        assert_eq!(
            get_named_slicer_style_count(storage.doc(), storage.workbook_map()),
            1
        );

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "S2",
            make_slicer_style("#00AA00"),
            false,
        )
        .unwrap();
        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "S3",
            make_slicer_style("#0000AA"),
            false,
        )
        .unwrap();
        assert_eq!(
            get_named_slicer_style_count(storage.doc(), storage.workbook_map()),
            3
        );

        // Delete one, count should decrease.
        delete_named_slicer_style(storage.doc(), storage.workbook_map(), "S2").unwrap();
        assert_eq!(
            get_named_slicer_style_count(storage.doc(), storage.workbook_map()),
            2
        );
    }

    // -------------------------------------------------------------------
    // Test 32: List returns all styles
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_list_all() {
        let storage = YrsStorage::new();

        // Initially empty.
        let styles = list_named_slicer_styles(storage.doc(), storage.workbook_map());
        assert!(styles.is_empty());

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Alpha",
            make_slicer_style("#A00000"),
            false,
        )
        .unwrap();
        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Beta",
            make_slicer_style("#00B000"),
            false,
        )
        .unwrap();
        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Gamma",
            make_slicer_style("#0000C0"),
            false,
        )
        .unwrap();

        let styles = list_named_slicer_styles(storage.doc(), storage.workbook_map());
        assert_eq!(styles.len(), 3);

        let mut names: Vec<String> = styles.iter().map(|s| s.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["Alpha", "Beta", "Gamma"]);

        // Verify each style has the correct header_background_color.
        let alpha = styles.iter().find(|s| s.name == "Alpha").unwrap();
        assert_eq!(
            alpha.style.header_background_color,
            Some("#A00000".to_string())
        );
        let beta = styles.iter().find(|s| s.name == "Beta").unwrap();
        assert_eq!(
            beta.style.header_background_color,
            Some("#00B000".to_string())
        );
        let gamma = styles.iter().find(|s| s.name == "Gamma").unwrap();
        assert_eq!(
            gamma.style.header_background_color,
            Some("#0000C0".to_string())
        );
    }

    // -------------------------------------------------------------------
    // Test 33: Get non-existent style returns None
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_get_nonexistent() {
        let storage = YrsStorage::new();
        assert!(
            get_named_slicer_style(storage.doc(), storage.workbook_map(), "NoSuchStyle")
                .unwrap()
                .is_none()
        );
    }

    // -------------------------------------------------------------------
    // Test 34: Add with make_unique=false errors on duplicate name
    // -------------------------------------------------------------------

    #[test]
    fn test_named_slicer_style_add_duplicate_without_make_unique_fails() {
        let storage = YrsStorage::new();

        add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Existing",
            make_slicer_style("#FF0000"),
            false,
        )
        .unwrap();

        // Second add with same name and make_unique=false should error.
        let result = add_named_slicer_style(
            storage.doc(),
            storage.workbook_map(),
            "Existing",
            make_slicer_style("#00FF00"),
            false,
        );
        assert!(
            result.is_err(),
            "adding duplicate name with make_unique=false should fail"
        );
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("already exists"),
            "error should mention 'already exists', got: {err_msg}"
        );

        // Original style should be unchanged.
        let retrieved = get_named_slicer_style(storage.doc(), storage.workbook_map(), "Existing")
            .unwrap()
            .unwrap();
        assert_eq!(
            retrieved.style.header_background_color,
            Some("#FF0000".to_string()),
            "original style should not have been overwritten"
        );
    }
}
