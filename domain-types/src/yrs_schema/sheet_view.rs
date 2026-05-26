//! Yrs schema for [`SheetViewOptions`] — flat Y.Map with bool/number keys.

use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::domain::sheet::SheetViewOptions;

pub const KEY_SHOW_GRIDLINES: &str = "showGridlines";
pub const KEY_SHOW_ROW_HEADERS: &str = "showRowHeaders";
pub const KEY_SHOW_COLUMN_HEADERS: &str = "showColumnHeaders";
pub const KEY_RIGHT_TO_LEFT: &str = "rightToLeft";
pub const KEY_SHOW_FORMULAS: &str = "showFormulas";
pub const KEY_SHOW_ZERO_VALUES: &str = "showZeroValues";
pub const KEY_ZOOM_SCALE: &str = "zoomScale";

/// Convert a [`SheetViewOptions`] to Yrs prelim entries for initial hydration.
/// Only emits non-default values.
pub fn to_yrs_prelim(opts: &SheetViewOptions) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = Vec::new();
    if !opts.show_gridlines {
        entries.push((KEY_SHOW_GRIDLINES, Any::Bool(false)));
    }
    if !opts.show_row_headers {
        entries.push((KEY_SHOW_ROW_HEADERS, Any::Bool(false)));
    }
    if !opts.show_column_headers {
        entries.push((KEY_SHOW_COLUMN_HEADERS, Any::Bool(false)));
    }
    if opts.right_to_left {
        entries.push((KEY_RIGHT_TO_LEFT, Any::Bool(true)));
    }
    if opts.show_formulas {
        entries.push((KEY_SHOW_FORMULAS, Any::Bool(true)));
    }
    if !opts.show_zeros {
        entries.push((KEY_SHOW_ZERO_VALUES, Any::Bool(false)));
    }
    if let Some(zoom) = opts.zoom_scale {
        entries.push((KEY_ZOOM_SCALE, Any::Number(zoom as f64)));
    }
    entries
}

/// Read a [`SheetViewOptions`] from a Y.Map with defaults.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> SheetViewOptions {
    SheetViewOptions {
        show_gridlines: read_bool(map, txn, KEY_SHOW_GRIDLINES).unwrap_or(true),
        show_row_headers: read_bool(map, txn, KEY_SHOW_ROW_HEADERS).unwrap_or(true),
        show_column_headers: read_bool(map, txn, KEY_SHOW_COLUMN_HEADERS).unwrap_or(true),
        right_to_left: read_bool(map, txn, KEY_RIGHT_TO_LEFT).unwrap_or(false),
        show_formulas: read_bool(map, txn, KEY_SHOW_FORMULAS).unwrap_or(false),
        show_zeros: read_bool(map, txn, KEY_SHOW_ZERO_VALUES).unwrap_or(true),
        zoom_scale: read_u32(map, txn, KEY_ZOOM_SCALE),
    }
}

/// Update a single field on an existing SheetViewOptions Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}
