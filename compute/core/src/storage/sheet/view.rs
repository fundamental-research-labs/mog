//! Per-sheet viewport state — frozen panes, scroll position, view options,
//! zoom, and used range.

use std::sync::Arc;

use serde::Deserialize;
use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use cell_types::SheetId;
use compute_document::undo::{ORIGIN_UI_STATE, ORIGIN_USER_EDIT};
use domain_types::domain::sheet::{FrozenPanes, SheetScrollPosition, SheetViewOptions};
use domain_types::{SheetPaneConfig, SheetPaneId, SheetPaneState};

use super::yrs_helpers::{
    KEY_FROZEN_COLS, KEY_FROZEN_ROWS, KEY_RIGHT_TO_LEFT, KEY_SCROLL_LEFT_COL, KEY_SCROLL_TOP_ROW,
    KEY_SHOW_COLUMN_HEADERS, KEY_SHOW_FORMULAS, KEY_SHOW_GRIDLINES, KEY_SHOW_ROW_HEADERS,
    KEY_SHOW_ZERO_VALUES, KEY_USED_RANGE, KEY_ZOOM_SCALE, get_meta_map, meta_bool, meta_number,
    meta_optional_u32,
};

// =========================================================================
// Frozen Panes
// =========================================================================

/// Get frozen panes configuration for a sheet.
pub(crate) fn get_frozen_panes(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> FrozenPanes {
    let txn = doc.transact();
    match get_meta_map(&txn, sheets, sheet_id) {
        Some(meta) => FrozenPanes {
            rows: meta_number(&txn, &meta, KEY_FROZEN_ROWS, 0.0) as u32,
            cols: meta_number(&txn, &meta, KEY_FROZEN_COLS, 0.0) as u32,
        },
        None => FrozenPanes { rows: 0, cols: 0 },
    }
}

/// Set frozen panes for a sheet.
pub(crate) fn set_frozen_panes(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    rows: u32,
    cols: u32,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        meta.insert(&mut txn, KEY_FROZEN_ROWS, Any::Number(rows as f64));
        meta.insert(&mut txn, KEY_FROZEN_COLS, Any::Number(cols as f64));
        if rows > 0 || cols > 0 {
            let active_pane = match (rows > 0, cols > 0) {
                (true, true) => SheetPaneId::BottomRight,
                (true, false) => SheetPaneId::BottomLeft,
                (false, true) => SheetPaneId::TopRight,
                (false, false) => SheetPaneId::TopLeft,
            };
            let pane = SheetPaneConfig {
                state: SheetPaneState::Frozen,
                x_split: cols as f64,
                y_split: rows as f64,
                top_left_cell: Some(to_a1_cell(rows, cols)),
                active_pane: Some(active_pane),
            };
            if let Ok(json) = serde_json::to_string(&pane) {
                meta.insert(
                    &mut txn,
                    "sheetPaneConfig",
                    Any::String(Arc::from(json.as_str())),
                );
            }
        } else {
            meta.remove(&mut txn, "sheetPaneConfig");
            meta.remove(&mut txn, "frozenPaneTopLeftCell");
        }
    }
}

fn to_a1_cell(row: u32, col: u32) -> String {
    let mut col_num = col + 1;
    let mut letters = String::new();
    while col_num > 0 {
        col_num -= 1;
        letters.insert(0, (b'A' + (col_num % 26) as u8) as char);
        col_num /= 26;
    }
    format!("{}{}", letters, row + 1)
}

// =========================================================================
// Scroll Position
// =========================================================================

/// Get the scroll position for a sheet (defaults to top-left origin).
pub(crate) fn get_scroll_position(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> SheetScrollPosition {
    let txn = doc.transact();
    match get_meta_map(&txn, sheets, sheet_id) {
        Some(meta) => SheetScrollPosition {
            top_row: meta_number(&txn, &meta, KEY_SCROLL_TOP_ROW, 0.0) as u32,
            left_col: meta_number(&txn, &meta, KEY_SCROLL_LEFT_COL, 0.0) as u32,
        },
        None => SheetScrollPosition {
            top_row: 0,
            left_col: 0,
        },
    }
}

/// Set the scroll position for a sheet.
pub(crate) fn set_scroll_position(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    top_row: u32,
    left_col: u32,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_UI_STATE));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        meta.insert(&mut txn, KEY_SCROLL_TOP_ROW, Any::Number(top_row as f64));
        meta.insert(&mut txn, KEY_SCROLL_LEFT_COL, Any::Number(left_col as f64));
    }
}

// =========================================================================
// View Options
// =========================================================================

/// Get view options for a sheet.
pub(crate) fn get_view_options(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> SheetViewOptions {
    let txn = doc.transact();
    match get_meta_map(&txn, sheets, sheet_id) {
        Some(meta) => SheetViewOptions {
            show_gridlines: meta_bool(&txn, &meta, KEY_SHOW_GRIDLINES, true),
            show_row_headers: meta_bool(&txn, &meta, KEY_SHOW_ROW_HEADERS, true),
            show_column_headers: meta_bool(&txn, &meta, KEY_SHOW_COLUMN_HEADERS, true),
            right_to_left: meta_bool(&txn, &meta, KEY_RIGHT_TO_LEFT, false),
            show_formulas: meta_bool(&txn, &meta, KEY_SHOW_FORMULAS, false),
            show_zeros: meta_bool(&txn, &meta, KEY_SHOW_ZERO_VALUES, true),
            zoom_scale: meta_optional_u32(&txn, &meta, KEY_ZOOM_SCALE),
        },
        None => SheetViewOptions {
            show_gridlines: true,
            show_row_headers: true,
            show_column_headers: true,
            right_to_left: false,
            show_formulas: false,
            show_zeros: true,
            zoom_scale: None,
        },
    }
}

/// Set a single boolean view option.
/// `key` must be one of: "showGridlines", "showRowHeaders", "showColumnHeaders",
/// "rightToLeft", "showFormulas", "showZeroValues".
pub(crate) fn set_view_option(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    key: &str,
    value: bool,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        meta.insert(&mut txn, key, Any::Bool(value));
    }
}

// =========================================================================
// Used Range
// =========================================================================

/// Get the last row/col with data (used range end point).
/// Returns `(end_row, end_col)`, or `(0, 0)` if empty.
#[allow(dead_code)] // pub(crate) module — wire when data bounds are managed in Rust
pub(crate) fn get_used_range_end(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> (u32, u32) {
    let txn = doc.transact();
    let meta = match get_meta_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return (0, 0),
    };
    match meta.get(&txn, KEY_USED_RANGE) {
        Some(Out::Any(Any::String(s))) => {
            #[derive(Deserialize)]
            struct UsedRange {
                #[serde(rename = "endRow")]
                end_row: u32,
                #[serde(rename = "endCol")]
                end_col: u32,
            }
            match serde_json::from_str::<UsedRange>(&s) {
                Ok(ur) => (ur.end_row, ur.end_col),
                Err(_) => (0, 0),
            }
        }
        _ => (0, 0),
    }
}

/// Set the used range end point for a sheet.
#[allow(dead_code)] // pub(crate) module — wire when data bounds are managed in Rust
pub(crate) fn set_used_range(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    end_row: u32,
    end_col: u32,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        let json = format!(r#"{{"endRow":{},"endCol":{}}}"#, end_row, end_col);
        meta.insert(
            &mut txn,
            KEY_USED_RANGE,
            Any::String(Arc::from(json.as_str())),
        );
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
    fn test_frozen_panes() {
        let (storage, _mirror, sid) = setup();
        assert_eq!(
            get_frozen_panes(storage.doc(), storage.sheets(), &sid),
            FrozenPanes { rows: 0, cols: 0 }
        );

        set_frozen_panes(storage.doc(), storage.sheets(), &sid, 3, 2);
        assert_eq!(
            get_frozen_panes(storage.doc(), storage.sheets(), &sid),
            FrozenPanes { rows: 3, cols: 2 }
        );

        // Unfreeze
        set_frozen_panes(storage.doc(), storage.sheets(), &sid, 0, 0);
        assert_eq!(
            get_frozen_panes(storage.doc(), storage.sheets(), &sid),
            FrozenPanes { rows: 0, cols: 0 }
        );
    }

    #[test]
    fn test_scroll_position() {
        let (storage, _mirror, sid) = setup();
        assert_eq!(
            get_scroll_position(storage.doc(), storage.sheets(), &sid),
            SheetScrollPosition {
                top_row: 0,
                left_col: 0
            }
        );

        set_scroll_position(storage.doc(), storage.sheets(), &sid, 99, 5);
        assert_eq!(
            get_scroll_position(storage.doc(), storage.sheets(), &sid),
            SheetScrollPosition {
                top_row: 99,
                left_col: 5
            }
        );

        // Reset to origin
        set_scroll_position(storage.doc(), storage.sheets(), &sid, 0, 0);
        assert_eq!(
            get_scroll_position(storage.doc(), storage.sheets(), &sid),
            SheetScrollPosition {
                top_row: 0,
                left_col: 0
            }
        );
    }

    #[test]
    fn test_view_options() {
        let (storage, _mirror, sid) = setup();
        let opts = get_view_options(storage.doc(), storage.sheets(), &sid);
        assert!(opts.show_gridlines);
        assert!(opts.show_row_headers);
        assert!(opts.show_column_headers);

        set_view_option(
            storage.doc(),
            storage.sheets(),
            &sid,
            KEY_SHOW_GRIDLINES,
            false,
        );
        let opts = get_view_options(storage.doc(), storage.sheets(), &sid);
        assert!(!opts.show_gridlines);
        assert!(opts.show_row_headers);
    }

    #[test]
    fn test_used_range() {
        let (storage, _mirror, sid) = setup();
        assert_eq!(
            get_used_range_end(storage.doc(), storage.sheets(), &sid),
            (0, 0)
        );

        set_used_range(storage.doc(), storage.sheets(), &sid, 50, 10);
        assert_eq!(
            get_used_range_end(storage.doc(), storage.sheets(), &sid),
            (50, 10)
        );
    }
}
