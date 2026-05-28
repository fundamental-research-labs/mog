//! Per-sheet settings dispatch and round-trip fidelity metadata.
//!
//! Three concerns:
//!   - `SheetSettings` aggregate read + string-keyed write for the TS bridge.
//!   - `SheetRoundtripMeta` — extra fields read from the meta map needed
//!     for lossless XLSX round-trip fidelity, not used at runtime.
//!   - `get_default_row_descent` — single extra accessor reading
//!     `defaultRowDescent` from the meta map, called by XLSX export.

use std::sync::Arc;

use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::sheet::{SheetProtectionOptions, SheetSettings};
use domain_types::units::{
    CharWidth, Pixels, Points, char_width_to_pixels, pixels_to_char_width, pixels_to_points,
    platform_mdw, points_to_pixels,
};
use domain_types::yrs_schema::protection as protection_schema;

use super::yrs_helpers::{
    KEY_ACTIVE_CELL, KEY_BASE_COL_WIDTH, KEY_CUSTOM_HEIGHT, KEY_DEFAULT_COL_WIDTH,
    KEY_DEFAULT_ROW_DESCENT, KEY_DEFAULT_ROW_HEIGHT, KEY_GRIDLINE_COLOR, KEY_IS_PROTECTED,
    KEY_OUTLINE_LEVEL_COL, KEY_OUTLINE_LEVEL_ROW, KEY_PROTECTION_DETAILS,
    KEY_PROTECTION_PASSWORD_HASH, KEY_RIGHT_TO_LEFT, KEY_SHEET_UID, KEY_SHOW_COLUMN_HEADERS,
    KEY_SHOW_FORMULAS, KEY_SHOW_GRIDLINES, KEY_SHOW_ROW_HEADERS, KEY_SHOW_ZERO_VALUES, KEY_SQREF,
    KEY_TAB_SELECTED, KEY_ZERO_HEIGHT, KEY_ZOOM_SCALE, KEY_ZOOM_SCALE_NORMAL, get_meta_map,
    meta_bool, meta_number, meta_optional_number, meta_optional_u32, meta_string,
};

// =========================================================================
// SheetSettings — aggregate read + string-keyed write for TS bridge
// =========================================================================

/// Canonical list of camelCase Yrs meta keys that comprise a `SheetSettings`
/// payload. Mirrors the TS-side `SHEET_SETTINGS_FIELDS` (kernel
/// `core-defaults.ts`) and is the single source of truth used by the
/// observer-translation path in `mutation_handlers/result_building.rs`
/// to decide whether a sheet-meta change should hydrate a
/// `SheetSettingsChange` (full settings snapshot) instead of a
/// discriminator-only `SheetChange`.
///
/// Top-level meta keys only — protection sub-options (e.g.
/// `selectLockedCells`, `formatCells`, …) live inside the nested
/// `protectionDetails` Y.Map and surface to the observer at a deeper
/// path; they are not part of this list.
pub const SHEET_SETTINGS_KEYS: &[&str] = &[
    // SheetViewOptions
    "showGridlines",
    "showRowHeaders",
    "showColumnHeaders",
    "rightToLeft",
    "showFormulas",
    "showZeroValues",
    "zoomScale",
    // Protection (top-level meta keys)
    "isProtected",
    "protectionPasswordHash",
    "protectionDetails",
    // Other settings stored on the sheet meta map
    "gridlineColor",
    "defaultRowHeight",
    "defaultColWidth",
];

/// Returns true if `key` is one of the top-level sheet-meta keys that
/// participate in `SheetSettings`. Use this to route observer-translated
/// sheet-meta changes between `SheetSettingsChange` and `SheetChange`.
pub fn is_sheet_settings_key(key: &str) -> bool {
    SHEET_SETTINGS_KEYS.contains(&key)
}

/// Get all settings for a sheet.
pub(crate) fn get_sheet_settings(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> SheetSettings {
    let txn = doc.transact();
    match get_meta_map(&txn, sheets, sheet_id) {
        Some(meta) => SheetSettings {
            show_gridlines: meta_bool(&txn, &meta, KEY_SHOW_GRIDLINES, true),
            show_row_headers: meta_bool(&txn, &meta, KEY_SHOW_ROW_HEADERS, true),
            show_column_headers: meta_bool(&txn, &meta, KEY_SHOW_COLUMN_HEADERS, true),
            is_protected: meta_bool(&txn, &meta, KEY_IS_PROTECTED, false),
            protection_password_hash: meta_string(&txn, &meta, KEY_PROTECTION_PASSWORD_HASH),
            show_zero_values: meta_bool(&txn, &meta, KEY_SHOW_ZERO_VALUES, true),
            gridline_color: meta_string(&txn, &meta, KEY_GRIDLINE_COLOR),
            right_to_left: meta_bool(&txn, &meta, KEY_RIGHT_TO_LEFT, false),
            show_formulas: meta_bool(&txn, &meta, KEY_SHOW_FORMULAS, false),
            zoom_scale: meta_optional_u32(&txn, &meta, KEY_ZOOM_SCALE),
            protection_options: {
                match meta.get(&txn, KEY_PROTECTION_DETAILS) {
                    Some(yrs::Out::YMap(prot_map)) => {
                        protection_schema::sheet_from_yrs_map(&prot_map, &txn)
                            .map(|sp| SheetProtectionOptions::from(&sp))
                    }
                    _ => None,
                }
            },
            default_row_height: {
                // Yrs stores canonical (points); convert to pixels for TS bridge
                let pt = Points(meta_number(&txn, &meta, KEY_DEFAULT_ROW_HEIGHT, 15.0));
                points_to_pixels(pt).0
            },
            default_col_width: {
                // Yrs stores canonical (char-width); convert to pixels for TS bridge
                let cw = CharWidth(meta_number(&txn, &meta, KEY_DEFAULT_COL_WIDTH, 8.43));
                char_width_to_pixels(cw, platform_mdw()).0
            },
        },
        None => SheetSettings::default(),
    }
}

/// Returns true if `key` is a protection option that belongs in the
/// `protectionDetails` Y.Map (keys match SheetProtectionOptions camelCase fields).
fn is_protection_option_key(key: &str) -> bool {
    matches!(
        key,
        "selectLockedCells"
            | "selectUnlockedCells"
            | "formatCells"
            | "formatColumns"
            | "formatRows"
            | "insertColumns"
            | "insertRows"
            | "insertHyperlinks"
            | "deleteColumns"
            | "deleteRows"
            | "sort"
            | "useAutoFilter"
            | "usePivotTableReports"
            | "editObjects"
            | "editScenarios"
    )
}

/// Set a single sheet setting by key and string value.
///
/// Recognized keys: showGridlines, showRowHeaders, showColumnHeaders,
/// isProtected, showZeroValues, rightToLeft, gridlineColor,
/// defaultRowHeight, defaultColWidth, plus protection option keys
/// (selectLockedCells, selectUnlockedCells, formatCells, etc.).
///
/// Protection option keys are routed into the nested `protectionDetails` Y.Map
/// so that `get_sheet_settings` reads them back correctly.
pub(crate) fn set_sheet_setting(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    key: &str,
    value: &str,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        if is_protection_option_key(key) {
            // Protection option keys are stored inside the nested protectionDetails Y.Map.
            // Keys match directly — no mapping needed.
            let prot_map = match meta.get(&txn, KEY_PROTECTION_DETAILS) {
                Some(Out::YMap(existing)) => existing,
                _ => {
                    meta.insert(&mut txn, KEY_PROTECTION_DETAILS, MapPrelim::default());
                    match meta.get(&txn, KEY_PROTECTION_DETAILS) {
                        Some(Out::YMap(m)) => m,
                        _ => return,
                    }
                }
            };
            if value == "true" || value == "false" {
                prot_map.insert(&mut txn, key, Any::Bool(value == "true"));
            } else {
                prot_map.insert(&mut txn, key, Any::String(Arc::from(value)));
            }
            return;
        }

        // Regular settings — store as flat top-level keys in the meta map
        if value == "true" || value == "false" {
            meta.insert(&mut txn, key, Any::Bool(value == "true"));
        } else if let Ok(n) = value.parse::<f64>() {
            // The TS bridge sends pixel values for dimensions; convert to
            // canonical units before storing so GET round-trips correctly.
            let stored = match key {
                KEY_DEFAULT_COL_WIDTH => pixels_to_char_width(Pixels(n), platform_mdw()).0,
                KEY_DEFAULT_ROW_HEIGHT => pixels_to_points(Pixels(n)).0,
                _ => n,
            };
            meta.insert(&mut txn, key, Any::Number(stored));
        } else {
            meta.insert(&mut txn, key, Any::String(Arc::from(value)));
        }
    }
}

// =========================================================================
// Round-trip fidelity metadata
// =========================================================================

/// Extra metadata needed for lossless XLSX round-tripping but not used at runtime.
pub struct SheetRoundtripMeta {
    pub tab_selected: bool,
    pub active_cell: Option<String>,
    pub sqref: Option<String>,
    pub uid: Option<String>,
    pub default_row_height: Option<f64>,
    pub default_col_width: Option<f64>,
    pub default_row_descent: Option<f64>,
    pub base_col_width: Option<u32>,
    pub zoom_scale_normal: Option<u32>,
    /// Whether the default row height is custom (customHeight="1" on sheetFormatPr).
    pub custom_height: bool,
    /// Whether zero-height rows are the default (zeroHeight="1" on sheetFormatPr).
    pub zero_height: bool,
    /// Whether default rows use thick top borders.
    pub thick_top: bool,
    /// Whether default rows use thick bottom borders.
    pub thick_bottom: bool,
    /// Outline level for rows (outlineLevelRow on sheetFormatPr).
    pub outline_level_row: Option<u8>,
    /// Outline level for columns (outlineLevelCol on sheetFormatPr).
    pub outline_level_col: Option<u8>,
    /// Trailing column ranges (e.g. `<col max="16384">`) preserved for round-trip fidelity.
    pub trailing_col_ranges: Vec<domain_types::TrailingColRange>,
}

/// Read round-trip fidelity fields from the Yrs meta map.
pub(crate) fn get_roundtrip_meta(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> SheetRoundtripMeta {
    let txn = doc.transact();
    match get_meta_map(&txn, sheets, sheet_id) {
        Some(meta) => SheetRoundtripMeta {
            tab_selected: meta_bool(&txn, &meta, KEY_TAB_SELECTED, false),
            active_cell: meta_string(&txn, &meta, KEY_ACTIVE_CELL),
            sqref: meta_string(&txn, &meta, KEY_SQREF),
            uid: meta_string(&txn, &meta, KEY_SHEET_UID),
            default_row_height: meta_optional_number(&txn, &meta, KEY_DEFAULT_ROW_HEIGHT),
            default_col_width: meta_optional_number(&txn, &meta, KEY_DEFAULT_COL_WIDTH),
            default_row_descent: meta_optional_number(&txn, &meta, KEY_DEFAULT_ROW_DESCENT),
            base_col_width: meta_optional_u32(&txn, &meta, KEY_BASE_COL_WIDTH),
            zoom_scale_normal: meta_optional_u32(&txn, &meta, KEY_ZOOM_SCALE_NORMAL),
            custom_height: meta_bool(&txn, &meta, KEY_CUSTOM_HEIGHT, false),
            zero_height: meta_bool(&txn, &meta, KEY_ZERO_HEIGHT, false),
            thick_top: meta_bool(&txn, &meta, "thickTop", false),
            thick_bottom: meta_bool(&txn, &meta, "thickBottom", false),
            outline_level_row: meta_optional_u32(&txn, &meta, KEY_OUTLINE_LEVEL_ROW)
                .map(|v| v as u8),
            outline_level_col: meta_optional_u32(&txn, &meta, KEY_OUTLINE_LEVEL_COL)
                .map(|v| v as u8),
            trailing_col_ranges: meta_string(&txn, &meta, "trailingColRanges")
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default(),
        },
        None => SheetRoundtripMeta {
            tab_selected: false,
            active_cell: None,
            sqref: None,
            uid: None,
            default_row_height: None,
            default_col_width: None,
            default_row_descent: None,
            base_col_width: None,
            zoom_scale_normal: None,
            custom_height: false,
            zero_height: false,
            thick_top: false,
            thick_bottom: false,
            outline_level_row: None,
            outline_level_col: None,
            trailing_col_ranges: Vec::new(),
        },
    }
}

/// Get the default row descent (x14ac:dyDescent) for a sheet, if set.
pub(crate) fn get_default_row_descent(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Option<f64> {
    let txn = doc.transact();
    let meta = get_meta_map(&txn, sheets, sheet_id)?;
    match meta.get(&txn, KEY_DEFAULT_ROW_DESCENT) {
        Some(Out::Any(Any::Number(n))) => Some(n),
        _ => None,
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sheet::test_support::setup;

    #[test]
    fn test_sheet_settings() {
        let (storage, _mirror, sid) = setup();
        let settings = get_sheet_settings(storage.doc(), storage.sheets(), &sid);
        assert!(settings.show_gridlines);
        assert!(!settings.is_protected);
        assert_eq!(settings.default_row_height, 20.0);

        set_sheet_setting(
            storage.doc(),
            storage.sheets(),
            &sid,
            "showGridlines",
            "false",
        );
        let settings = get_sheet_settings(storage.doc(), storage.sheets(), &sid);
        assert!(!settings.show_gridlines);

        set_sheet_setting(
            storage.doc(),
            storage.sheets(),
            &sid,
            "defaultRowHeight",
            "25.0",
        );
        let settings = get_sheet_settings(storage.doc(), storage.sheets(), &sid);
        assert_eq!(settings.default_row_height, 25.0);
    }
}
