//! Low-level Yrs helpers shared across the `sheet` module's sub-files.
//!
//! Per plan R56.A: centralize the `meta_{string,number,bool,optional_*}`
//! typed-accessor helpers, the sheetOrder array accessor, and the flat
//! `KEY_*` constants that name fields inside the sheet properties Y.Map.
//!
//! Visibility: everything is `pub(super)` so the helpers stay internal to
//! the `sheet` module. `get_meta_for_export` is `pub(crate)` because the
//! XLSX export layer reaches in for the raw meta MapRef.

use yrs::{Any, Array, ArrayRef, Map, MapRef, Out};

use cell_types::SheetId;
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::schema::{KEY_PROPERTIES, KEY_SHEET_ORDER};

// =============================================================================
// Meta-map field key constants (inside the per-sheet `meta` Y.Map).
// =============================================================================

pub(super) const KEY_FROZEN_ROWS: &str = "frozenRows";
pub(super) const KEY_FROZEN_COLS: &str = "frozenCols";
pub(super) const KEY_TAB_COLOR: &str = "tabColor";
pub(super) const KEY_HIDDEN: &str = "hidden";
pub(super) const KEY_SHOW_GRIDLINES: &str = "showGridlines";
pub(super) const KEY_SHOW_ROW_HEADERS: &str = "showRowHeaders";
pub(super) const KEY_SHOW_COLUMN_HEADERS: &str = "showColumnHeaders";
pub(super) const KEY_SHOW_FORMULAS: &str = "showFormulas";
pub(super) const KEY_SHOW_ZERO_VALUES: &str = "showZeroValues";
pub(super) const KEY_IS_PROTECTED: &str = "isProtected";
pub(super) const KEY_PROTECTION_PASSWORD_HASH: &str = "protectionPasswordHash";
pub(super) const KEY_PROTECTION_DETAILS: &str = "protectionDetails";
pub(super) const KEY_GRIDLINE_COLOR: &str = "gridlineColor";
pub(super) const KEY_RIGHT_TO_LEFT: &str = "rightToLeft";
pub(super) const KEY_ZOOM_SCALE: &str = "zoomScale";
pub(super) const KEY_DEFAULT_ROW_HEIGHT: &str = "defaultRowHeight";
pub(super) const KEY_DEFAULT_COL_WIDTH: &str = "defaultColWidth";
#[allow(dead_code)] // Used by get_used_range_end/set_used_range
pub(super) const KEY_USED_RANGE: &str = "usedRange";
#[allow(dead_code)] // Legacy key; print area now stored via RangeKind::PrintArea
pub(super) const KEY_PRINT_AREA: &str = "printArea";
pub(super) const KEY_PRINT_TITLES: &str = "printTitles";
pub(super) const KEY_PRINT_SETTINGS: &str = "printSettings";
pub(super) const KEY_SPLIT_CONFIG: &str = "splitConfig";
pub(super) const KEY_HF_IMAGES: &str = "hfImages";
pub(super) const KEY_SCROLL_TOP_ROW: &str = "scrollTopRow";
pub(super) const KEY_SCROLL_LEFT_COL: &str = "scrollLeftCol";
// File-format container metadata for imported, untouched data validations.
pub(super) const KEY_DV_DECLARED_COUNT: &str = "dvDeclaredCount";
pub(super) const KEY_ROWS: &str = "rows";
pub(super) const KEY_COLS: &str = "cols";
pub(super) const KEY_TAB_SELECTED: &str = "tabSelected";
pub(super) const KEY_ACTIVE_CELL: &str = "activeCell";
pub(super) const KEY_SQREF: &str = "sqref";
pub(super) const KEY_SHEET_UID: &str = "sheetUid";
pub(super) const KEY_DEFAULT_ROW_DESCENT: &str = "defaultRowDescent";
pub(super) const KEY_ZOOM_SCALE_NORMAL: &str = "zoomScaleNormal";
pub(super) const KEY_CUSTOM_HEIGHT: &str = "customHeight";
pub(super) const KEY_ZERO_HEIGHT: &str = "zeroHeight";
pub(super) const KEY_BASE_COL_WIDTH: &str = "baseColWidth";
pub(super) const KEY_OUTLINE_LEVEL_ROW: &str = "outlineLevelRow";
pub(super) const KEY_OUTLINE_LEVEL_COL: &str = "outlineLevelCol";
pub(super) const KEY_ENABLE_CALCULATION: &str = "enableCalculation";

// =============================================================================
// Meta map accessors.
// =============================================================================

/// Get the per-sheet `meta` MapRef. `pub(crate)` because the XLSX export
/// path reaches in for a raw MapRef to do its own schema-level reads.
pub(crate) fn get_meta_for_export<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Option<MapRef> {
    get_meta_map(txn, sheets_root, sheet_id)
}

/// Get the per-sheet `meta` MapRef.
pub(super) fn get_meta_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sheet_map = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_PROPERTIES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

// =============================================================================
// Typed primitive readers on a meta MapRef.
// =============================================================================

/// Read a string from a meta map.
pub(super) fn meta_string<T: yrs::ReadTxn>(txn: &T, meta: &MapRef, key: &str) -> Option<String> {
    match meta.get(txn, key) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}

/// Read a number from a meta map, with a default.
pub(super) fn meta_number<T: yrs::ReadTxn>(txn: &T, meta: &MapRef, key: &str, default: f64) -> f64 {
    match meta.get(txn, key) {
        Some(Out::Any(Any::Number(n))) => n,
        _ => default,
    }
}

/// Read an optional u32 from a meta map (stored as f64).
pub(super) fn meta_optional_u32<T: yrs::ReadTxn>(txn: &T, meta: &MapRef, key: &str) -> Option<u32> {
    match meta.get(txn, key) {
        Some(Out::Any(Any::Number(n))) => Some(n as u32),
        _ => None,
    }
}

/// Read a bool from a meta map, with a default.
pub(super) fn meta_bool<T: yrs::ReadTxn>(txn: &T, meta: &MapRef, key: &str, default: bool) -> bool {
    match meta.get(txn, key) {
        Some(Out::Any(Any::Bool(b))) => b,
        _ => default,
    }
}

/// Read a number from meta, returning None if absent.
pub(super) fn meta_optional_number<T: yrs::ReadTxn>(
    txn: &T,
    meta: &MapRef,
    key: &str,
) -> Option<f64> {
    match meta.get(txn, key) {
        Some(Out::Any(Any::Number(n))) => Some(n),
        _ => None,
    }
}

// =============================================================================
// Sheet-order ArrayRef accessors (stored on the workbook map).
// =============================================================================

/// Read the sheetOrder array from the workbook map.
pub(super) fn get_sheet_order_array<T: yrs::ReadTxn>(
    workbook: &MapRef,
    txn: &T,
) -> Option<ArrayRef> {
    match workbook.get(txn, KEY_SHEET_ORDER) {
        Some(Out::YArray(arr)) => Some(arr),
        _ => None,
    }
}

/// Read all sheet IDs from the sheetOrder array.
pub(super) fn read_sheet_order<T: yrs::ReadTxn>(workbook: &MapRef, txn: &T) -> Vec<SheetId> {
    let Some(order_arr) = get_sheet_order_array(workbook, txn) else {
        return Vec::new();
    };
    let len = order_arr.len(txn);
    let mut result = Vec::with_capacity(len as usize);
    for i in 0..len {
        if let Some(Out::Any(Any::String(s))) = order_arr.get(txn, i)
            && let Some(id) = hex_to_id(&s)
        {
            result.push(SheetId::from_raw(id));
        }
    }
    result
}
