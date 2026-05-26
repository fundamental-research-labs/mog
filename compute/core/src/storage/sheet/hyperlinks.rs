//! Hyperlinks module -- port of spreadsheet-model/src/cells/cell-hyperlinks.ts
//!
//! Manages hyperlink CRUD on cells. Excel treats hyperlinks as metadata separate
//! from cell values, stored on the cell data object as field "h".
//!
//! ## Yrs Storage Layout
//!
//! ```text
//! cells -> {cell_hex} -> Y.Map { v: value, f: formula, h: url, ... }
//! ```
//!
//! ## Key Design Points
//!
//! 1. Hyperlinks are self-contained metadata -- no dependencies on cell values or formulas.
//! 2. When removing hyperlink from an empty cell, the cell is fully deleted.
//! 3. Hyperlink-only cells have value = null (marker cells).
//! 4. Setting a hyperlink on an empty position creates a new cell with a GridIndex entry.
//!
//! ## Identity
//!
//! `GridIndex` is the sole authority for (sheet, row, col) ↔ `CellId`. Read paths
//! take `&GridIndex`; write paths that may allocate a marker cell take
//! `&mut GridIndex`.

use std::sync::Arc;

use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::storage::infra::grid_helpers::get_cells_map;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::{KEY_FORMULA, KEY_VALUE};
use domain_types::domain::hyperlink::Hyperlink;

use crate::range_manager::pos_to_a1;

/// The Yrs map key for hyperlink URLs within a cell map.
const KEY_HYPERLINK: &str = "h";
/// The Yrs map key for hyperlink internal location (e.g. "Sheet2!A1").
const KEY_HYPERLINK_LOCATION: &str = "hl";
/// The Yrs map key for hyperlink display text.
const KEY_HYPERLINK_DISPLAY: &str = "hd";
/// The Yrs map key for hyperlink tooltip.
const KEY_HYPERLINK_TOOLTIP: &str = "ht";
/// The Yrs map key for hyperlink uid (xr:uid revision tracking).
const KEY_HYPERLINK_UID: &str = "hu";

// =============================================================================
// Internal Helpers
// =============================================================================

/// Check if a cell map has any meaningful data beyond being an empty marker.
///
/// A cell is considered "empty" (no data) if it has no non-null value, no formula,
/// and no note. The hyperlink ("h") is NOT counted because this check runs after
/// the hyperlink has already been removed.
fn cell_has_data<T: yrs::ReadTxn>(txn: &T, cell_map: &MapRef) -> bool {
    // Check value: non-null means data exists
    match cell_map.get(txn, KEY_VALUE) {
        Some(Out::Any(Any::Null)) | Some(Out::Any(Any::Undefined)) | None => {}
        Some(_) => return true,
    }

    // Check formula
    if cell_map.get(txn, KEY_FORMULA).is_some() {
        return true;
    }

    // Check note (key "n" used by spreadsheet-model)
    if cell_map.get(txn, "n").is_some() {
        return true;
    }

    // Check cell note (key "c" used by some serialization paths)
    if cell_map.get(txn, "c").is_some() {
        return true;
    }

    false
}

// =============================================================================
// YrsStorage Hyperlink Operations
// =============================================================================

/// Set a hyperlink on a cell at the given position.
///
/// If a cell exists at the position, the hyperlink field is added/updated.
/// If no cell exists, a marker cell (value=null) is created with the hyperlink,
/// and the new CellId is registered in `grid`.
pub fn set_hyperlink(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid: &mut GridIndex,
    row: u32,
    col: u32,
    url: &str,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    if let Some(cell_id) = grid.cell_id_at(row, col) {
        // Cell exists at this position -- add/update the hyperlink field.
        let cell_hex = id_to_hex(cell_id.as_u128());
        if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, &cell_hex) {
            cell_map.insert(&mut txn, KEY_HYPERLINK, Any::String(Arc::from(url)));
        }
    } else {
        // No cell at this position -- allocate a marker cell with the hyperlink,
        // register it in the in-memory GridIndex, AND mirror the `(row, col) ↔
        // cell_id` mapping into the yrs `gridIndex/{posToId, idToPos}` sub-maps
        // (inside this same txn) so remote peers can resolve the cell's
        // position after CRDT sync.
        let cell_id = grid.ensure_cell_id(row, col);
        let cell_hex = id_to_hex(cell_id.as_u128());
        let row_hex = grid.row_id_hex(row);
        let col_hex = grid.col_id_hex(col);
        let cell_prelim = MapPrelim::from([
            (KEY_VALUE, Any::Null),
            (KEY_HYPERLINK, Any::String(Arc::from(url))),
        ]);
        cells_map.insert(&mut txn, &*cell_hex, cell_prelim);

        if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
            crate::storage::cells::values::write_cell_position_to_yrs(
                &mut txn,
                sheets,
                &sheet_hex,
                &cell_hex,
                rh.as_str(),
                ch.as_str(),
            );
        }
    }
}

/// Get the hyperlink URL for a cell at the given position.
///
/// Returns `None` if no cell exists at the position or the cell has no hyperlink.
pub fn get_hyperlink(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid: &GridIndex,
    row: u32,
    col: u32,
) -> Option<String> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let cell_id = grid.cell_id_at(row, col)?;
    let cell_hex = id_to_hex(cell_id.as_u128());
    let cells_map = get_cells_map(&txn, sheets, &sheet_hex)?;
    let cell_map = match cells_map.get(&txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    match cell_map.get(&txn, KEY_HYPERLINK) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}

/// Get the full hyperlink metadata for a cell at the given position.
///
/// Returns a `Hyperlink` with all available fields (target, location, display, tooltip).
/// Returns `None` if no cell exists at the position or the cell has no hyperlink ("h" key).
/// The `cell_ref` field is NOT populated by this function — the caller must set it.
#[allow(dead_code)]
pub fn get_hyperlink_full(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid: &GridIndex,
    row: u32,
    col: u32,
) -> Option<Hyperlink> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let cell_id = grid.cell_id_at(row, col)?;
    let cell_hex = id_to_hex(cell_id.as_u128());
    let cells_map = get_cells_map(&txn, sheets, &sheet_hex)?;
    let cell_map = match cells_map.get(&txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    // Must have the primary hyperlink key to be considered a hyperlink cell
    let target = match cell_map.get(&txn, KEY_HYPERLINK) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => return None,
    };

    let location = match cell_map.get(&txn, KEY_HYPERLINK_LOCATION) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };
    let display = match cell_map.get(&txn, KEY_HYPERLINK_DISPLAY) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };
    let tooltip = match cell_map.get(&txn, KEY_HYPERLINK_TOOLTIP) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };
    let uid = match cell_map.get(&txn, KEY_HYPERLINK_UID) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    };

    Some(Hyperlink {
        cell_ref: String::new(), // Caller must set this
        target,
        location,
        display,
        tooltip,
        uid,
    })
}

/// Batch-read ALL hyperlinks for a sheet in a single transaction.
///
/// Iterates the cells map once, finding cells with hyperlink keys, and resolves
/// their positions via the `GridIndex` (the authoritative identity store).
pub fn get_all_hyperlinks(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid: &GridIndex,
) -> Vec<Hyperlink> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (cell_hex, cell_out) in cells_map.iter(&txn) {
        let cell_map = match cell_out {
            Out::YMap(m) => m,
            _ => continue,
        };

        // Only process cells that have the hyperlink key
        let raw_url = match cell_map.get(&txn, KEY_HYPERLINK) {
            Some(Out::Any(Any::String(s))) => s.to_string(),
            _ => continue,
        };

        // Resolve position from GridIndex — the sole identity authority.
        let cell_ref = compute_document::hex::hex_to_id(cell_hex)
            .and_then(|raw| {
                let cid = cell_types::CellId::from_raw(raw);
                grid.cell_position(&cid)
            })
            .map(|(row, col)| pos_to_a1(row, col))
            .unwrap_or_default();

        // Distinguish internal (#location) from external (URL) hyperlinks.
        // During hydration, internal links are stored as "#<location>".
        // Empty string means uid-only marker hyperlink (no target, no location).
        let (target, location_from_url) = if raw_url.is_empty() {
            (None, None)
        } else if let Some(location) = raw_url.strip_prefix('#') {
            // Internal link: no external target, location is the part after "#"
            (None, Some(location.to_string()))
        } else {
            (Some(raw_url), None)
        };

        // Prefer the explicitly stored location field, fall back to the one derived from URL
        let location = match cell_map.get(&txn, KEY_HYPERLINK_LOCATION) {
            Some(Out::Any(Any::String(s))) => Some(s.to_string()),
            _ => location_from_url,
        };
        let display = match cell_map.get(&txn, KEY_HYPERLINK_DISPLAY) {
            Some(Out::Any(Any::String(s))) => Some(s.to_string()),
            _ => None,
        };
        let tooltip = match cell_map.get(&txn, KEY_HYPERLINK_TOOLTIP) {
            Some(Out::Any(Any::String(s))) => Some(s.to_string()),
            _ => None,
        };
        let uid = match cell_map.get(&txn, KEY_HYPERLINK_UID) {
            Some(Out::Any(Any::String(s))) => Some(s.to_string()),
            _ => None,
        };

        // Read original range ref for range hyperlinks (e.g., "A1:B2")
        let final_cell_ref = match cell_map.get(&txn, "hr") {
            Some(Out::Any(Any::String(s))) => s.to_string(),
            _ => cell_ref,
        };

        // Read original order index for round-trip fidelity
        let order = match cell_map.get(&txn, "ho") {
            Some(Out::Any(Any::Number(n))) => n as u32,
            _ => u32::MAX, // no stored order → sort last
        };

        result.push((
            order,
            Hyperlink {
                cell_ref: final_cell_ref,
                target,
                location,
                display,
                tooltip,
                uid,
            },
        ));
    }

    // Sort by original document order if available, then by cell_ref as tiebreaker
    result.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cell_ref.cmp(&b.1.cell_ref)));
    result.into_iter().map(|(_, h)| h).collect()
}

/// Remove the hyperlink from a cell at the given position.
///
/// If the cell has other data (value, formula, note), it is preserved with only
/// the hyperlink removed. If the cell becomes empty after removing the hyperlink,
/// it is deleted entirely and its CellId is deregistered from `grid`.
pub fn remove_hyperlink(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid: &mut GridIndex,
    row: u32,
    col: u32,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let cell_id = match grid.cell_id_at(row, col) {
        Some(id) => id,
        None => return,
    };
    let cell_hex = id_to_hex(cell_id.as_u128());

    let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let cell_map = match cells_map.get(&txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };

    // Remove all hyperlink fields
    cell_map.remove(&mut txn, KEY_HYPERLINK);
    cell_map.remove(&mut txn, KEY_HYPERLINK_LOCATION);
    cell_map.remove(&mut txn, KEY_HYPERLINK_DISPLAY);
    cell_map.remove(&mut txn, KEY_HYPERLINK_TOOLTIP);

    // Check if cell is now empty (no value, no formula, no note)
    if !cell_has_data(&txn, &cell_map) {
        // Delete the cell entirely from cells map and deregister from GridIndex.
        cells_map.remove(&mut txn, &cell_hex);
        drop(txn);
        grid.remove_cell(&cell_id);
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use cell_types::SheetId;

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    /// Create a YrsStorage with one sheet plus a fresh `GridIndex` that serves
    /// as the authoritative identity store for that sheet.
    fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sheet_id = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
            .expect("add_sheet should succeed");

        let grid = GridIndex::new(sheet_id, 100, 26, Arc::new(cell_types::IdAllocator::new()));

        (storage, sheet_id, grid)
    }

    /// Seed a cell with a value at a position, registering identity in `grid`.
    fn seed_cell(
        storage: &YrsStorage,
        grid: &mut GridIndex,
        sheet_id: SheetId,
        row: u32,
        col: u32,
        value: Any,
    ) -> String {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_id = grid.ensure_cell_id(row, col);
        let cell_hex = id_to_hex(cell_id.as_u128());
        let mut txn = storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

        if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
            let cell_prelim = MapPrelim::from([(KEY_VALUE, value)]);
            cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
        }

        cell_hex.to_string()
    }

    /// Seed a cell with a value and a formula at a position.
    fn seed_cell_with_formula(
        storage: &YrsStorage,
        grid: &mut GridIndex,
        sheet_id: SheetId,
        row: u32,
        col: u32,
        value: Any,
        formula: &str,
    ) -> String {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_id = grid.ensure_cell_id(row, col);
        let cell_hex = id_to_hex(cell_id.as_u128());
        let mut txn = storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

        if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
            let cell_prelim = MapPrelim::from([
                (KEY_VALUE, value),
                (KEY_FORMULA, Any::String(Arc::from(formula))),
            ]);
            cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
        }

        cell_hex.to_string()
    }

    /// Check if a cell exists in the cells map.
    fn cell_exists(storage: &YrsStorage, sheet_id: SheetId, cell_hex: &str) -> bool {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let txn = storage.doc().transact();
        if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
            matches!(cells_map.get(&txn, cell_hex), Some(Out::YMap(_)))
        } else {
            false
        }
    }

    /// Check if a position has a registered CellId in the GridIndex.
    fn pos_exists_in_grid(grid: &GridIndex, row: u32, col: u32) -> bool {
        grid.cell_id_at(row, col).is_some()
    }

    // -------------------------------------------------------------------
    // Test 1: set_hyperlink on existing cell
    // -------------------------------------------------------------------

    #[test]
    fn test_set_hyperlink_on_existing_cell() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        // Seed a cell with a value at (0, 0)
        let cell_hex = seed_cell(&storage, &mut grid, sheet_id, 0, 0, Any::Number(42.0));

        // Set hyperlink
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            0,
            0,
            "https://example.com",
        );

        // Verify the hyperlink was set
        let url = get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0);
        assert_eq!(url, Some("https://example.com".to_string()));

        // Verify cell still has its value
        let sheet_hex_str = id_to_hex(sheet_id.as_u128());
        let txn = storage.doc().transact();
        let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex_str).unwrap();
        let cell_map = match cells_map.get(&txn, &*cell_hex) {
            Some(Out::YMap(m)) => m,
            _ => panic!("cell should exist"),
        };
        assert!(matches!(
            cell_map.get(&txn, KEY_VALUE),
            Some(Out::Any(Any::Number(n))) if n == 42.0
        ));
    }

    // -------------------------------------------------------------------
    // Test 2: set_hyperlink on empty position (creates marker cell)
    // -------------------------------------------------------------------

    #[test]
    fn test_set_hyperlink_on_empty_position() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        // No cell at (5, 3)
        assert!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 5, 3).is_none()
        );

        // Set hyperlink on empty position
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            5,
            3,
            "https://marker.test",
        );

        // Hyperlink should be readable
        assert_eq!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 5, 3),
            Some("https://marker.test".to_string())
        );

        // Grid index should have the new cell
        assert!(pos_exists_in_grid(&grid, 5, 3));

        // The cell should have value=null (marker cell)
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let txn = storage.doc().transact();
        let cell_id = grid.cell_id_at(5, 3).unwrap();
        let cell_hex = id_to_hex(cell_id.as_u128());
        let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
        let cell_map = match cells_map.get(&txn, &*cell_hex) {
            Some(Out::YMap(m)) => m,
            _ => panic!("marker cell should exist"),
        };
        assert!(matches!(
            cell_map.get(&txn, KEY_VALUE),
            Some(Out::Any(Any::Null))
        ));
    }

    // -------------------------------------------------------------------
    // Test 3: get_hyperlink returns URL
    // -------------------------------------------------------------------

    #[test]
    fn test_get_hyperlink_returns_url() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        seed_cell(
            &storage,
            &mut grid,
            sheet_id,
            2,
            1,
            Any::String(Arc::from("text")),
        );
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            2,
            1,
            "mailto:test@example.com",
        );

        let result = get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 2, 1);
        assert_eq!(result, Some("mailto:test@example.com".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 4: get_hyperlink on empty cell returns None
    // -------------------------------------------------------------------

    #[test]
    fn test_get_hyperlink_on_empty_cell_returns_none() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        // No cell at (10, 10)
        assert!(
            get_hyperlink(
                storage.doc(),
                &storage.sheets_ref(),
                &sheet_id,
                &grid,
                10,
                10
            )
            .is_none()
        );

        // Cell with value but no hyperlink
        seed_cell(&storage, &mut grid, sheet_id, 0, 0, Any::Number(99.0));
        assert!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0).is_none()
        );
    }

    // -------------------------------------------------------------------
    // Test 5: remove_hyperlink preserves cell with value
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_hyperlink_preserves_cell_with_value() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        // Seed a cell with actual value
        let cell_hex = seed_cell(&storage, &mut grid, sheet_id, 0, 0, Any::Number(42.0));

        // Add hyperlink then remove it
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            0,
            0,
            "https://example.com",
        );
        assert!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0).is_some()
        );

        remove_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            0,
            0,
        );

        // Hyperlink gone
        assert!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0).is_none()
        );

        // Cell still exists with its value
        assert!(cell_exists(&storage, sheet_id, &cell_hex));

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let txn = storage.doc().transact();
        let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
        let cell_map = match cells_map.get(&txn, &*cell_hex) {
            Some(Out::YMap(m)) => m,
            _ => panic!("cell should still exist"),
        };
        assert!(matches!(
            cell_map.get(&txn, KEY_VALUE),
            Some(Out::Any(Any::Number(n))) if n == 42.0
        ));
    }

    // -------------------------------------------------------------------
    // Test 6: remove_hyperlink deletes empty cell
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_hyperlink_deletes_empty_cell() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        // Set hyperlink on empty position (creates marker cell)
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            3,
            3,
            "https://tobedeleted.com",
        );
        assert!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 3, 3).is_some()
        );
        assert!(pos_exists_in_grid(&grid, 3, 3));

        // Remove hyperlink -- cell should be deleted entirely
        remove_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            3,
            3,
        );

        assert!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 3, 3).is_none()
        );

        // Grid index entry should be cleaned up
        assert!(!pos_exists_in_grid(&grid, 3, 3));
    }

    // -------------------------------------------------------------------
    // Test 7: set/get/remove round-trip
    // -------------------------------------------------------------------

    #[test]
    fn test_hyperlink_roundtrip() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        // Initially no hyperlink
        assert!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0).is_none()
        );

        // Set
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            0,
            0,
            "https://roundtrip.test",
        );
        assert_eq!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0),
            Some("https://roundtrip.test".to_string())
        );

        // Remove
        remove_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            0,
            0,
        );
        assert!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0).is_none()
        );
    }

    // -------------------------------------------------------------------
    // Test 8: multiple hyperlinks on different cells
    // -------------------------------------------------------------------

    #[test]
    fn test_multiple_hyperlinks_different_cells() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            0,
            0,
            "https://a.com",
        );
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            1,
            1,
            "https://b.com",
        );
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            2,
            2,
            "https://c.com",
        );

        assert_eq!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0),
            Some("https://a.com".to_string())
        );
        assert_eq!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 1, 1),
            Some("https://b.com".to_string())
        );
        assert_eq!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 2, 2),
            Some("https://c.com".to_string())
        );

        // Remove one, others unaffected
        remove_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            1,
            1,
        );
        assert!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 1, 1).is_none()
        );
        assert_eq!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0),
            Some("https://a.com".to_string())
        );
        assert_eq!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 2, 2),
            Some("https://c.com".to_string())
        );
    }

    // -------------------------------------------------------------------
    // Test 9: overwrite hyperlink URL
    // -------------------------------------------------------------------

    #[test]
    fn test_overwrite_hyperlink_url() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            0,
            0,
            "https://old.com",
        );
        assert_eq!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0),
            Some("https://old.com".to_string())
        );

        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            0,
            0,
            "https://new.com",
        );
        assert_eq!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0),
            Some("https://new.com".to_string())
        );
    }

    // -------------------------------------------------------------------
    // Test 10: remove_hyperlink on cell with no hyperlink is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_hyperlink_no_hyperlink_is_noop() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        // Seed cell with value but no hyperlink
        let cell_hex = seed_cell(&storage, &mut grid, sheet_id, 0, 0, Any::Number(10.0));

        // Remove should be a no-op (cell still has value)
        remove_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            0,
            0,
        );

        // Cell should still exist
        assert!(cell_exists(&storage, sheet_id, &cell_hex));
    }

    // -------------------------------------------------------------------
    // Test 11: remove_hyperlink on nonexistent position is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_hyperlink_nonexistent_position_is_noop() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();
        // Should not panic
        remove_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            99,
            99,
        );
    }

    // -------------------------------------------------------------------
    // Test 12: remove_hyperlink preserves cell with formula
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_hyperlink_preserves_cell_with_formula() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        // Seed a cell with a formula
        let cell_hex = seed_cell_with_formula(
            &storage,
            &mut grid,
            sheet_id,
            0,
            0,
            Any::Number(100.0),
            "=SUM(A1:A10)",
        );

        // Add and remove hyperlink
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            0,
            0,
            "https://formula.test",
        );
        remove_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            0,
            0,
        );

        // Cell should still exist (has formula)
        assert!(cell_exists(&storage, sheet_id, &cell_hex));

        // Verify formula is preserved
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let txn = storage.doc().transact();
        let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
        let cell_map = match cells_map.get(&txn, &*cell_hex) {
            Some(Out::YMap(m)) => m,
            _ => panic!("cell should exist"),
        };
        assert!(matches!(
            cell_map.get(&txn, KEY_FORMULA),
            Some(Out::Any(Any::String(s))) if &*s == "=SUM(A1:A10)"
        ));
    }

    // -------------------------------------------------------------------
    // Test 13: set_hyperlink with various URL schemes
    // -------------------------------------------------------------------

    #[test]
    fn test_hyperlink_various_url_schemes() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        let urls = [
            "https://example.com",
            "http://plain.example.com",
            "mailto:user@example.com",
            "ftp://files.example.com/doc.pdf",
            "#Sheet2!A1",
        ];

        for (i, url) in urls.iter().enumerate() {
            set_hyperlink(
                storage.doc(),
                &storage.sheets_ref(),
                &sheet_id,
                &mut grid,
                i as u32,
                0,
                url,
            );
            assert_eq!(
                get_hyperlink(
                    storage.doc(),
                    &storage.sheets_ref(),
                    &sheet_id,
                    &grid,
                    i as u32,
                    0
                ),
                Some(url.to_string()),
                "URL scheme '{}' should round-trip",
                url
            );
        }
    }

    // -------------------------------------------------------------------
    // Test 14: overwrite hyperlink on marker cell then remove deletes cell
    // -------------------------------------------------------------------

    #[test]
    fn test_overwrite_then_remove_marker_cell() {
        let (storage, sheet_id, mut grid) = storage_with_sheet();

        // Create marker cell with hyperlink
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            7,
            7,
            "https://first.com",
        );
        assert!(pos_exists_in_grid(&grid, 7, 7));

        // Overwrite
        set_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            7,
            7,
            "https://second.com",
        );
        assert_eq!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 7, 7),
            Some("https://second.com".to_string())
        );

        // Remove -- should delete marker cell
        remove_hyperlink(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            &mut grid,
            7,
            7,
        );
        assert!(
            get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 7, 7).is_none()
        );
        assert!(!pos_exists_in_grid(&grid, 7, 7));
    }
}
