use std::collections::HashSet;

use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::KEY_VALUE;
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Transact};

use super::super::grid_helpers::{get_cells_map, get_properties_map};
use cell_types::{CellId, RangePos, SheetId};

/// Clear the `cells` map entries for the given cell hexes.
///
/// Position-agnostic: callers resolve `(row, col) → CellId` via
/// `grid_indexes` and hand the resulting hex strings here. Works on
/// XLSX-hydrated sheets.
///
/// When `clear_properties` is true, the properties map entry is removed
/// as well ("clear all" semantic). When false, only the value is nulled
/// and formatting is preserved ("clear contents").
pub fn clear_cells_by_hex(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    cell_hexes: &[String],
    clear_properties: bool,
) {
    if cell_hexes.is_empty() {
        return;
    }
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let Some(cells_map) = get_cells_map(&txn, sheets, &sheet_hex) else {
        return;
    };
    let props_map = if clear_properties {
        get_properties_map(&txn, sheets, &sheet_hex)
    } else {
        None
    };

    for cell_hex in cell_hexes {
        // yrs `Map::insert` on an existing key replaces the MapRef,
        // so stale formula + cached-result keys are dropped. Write a
        // marker cell with only KEY_VALUE=Null so identity is preserved.
        let cell_prelim = MapPrelim::from([(KEY_VALUE, Any::Null)]);
        cells_map.insert(&mut txn, cell_hex.as_str(), cell_prelim);

        if let Some(ref pm) = props_map {
            pm.remove(&mut txn, cell_hex.as_str());
        }
    }
}

/// Clear all cells in a range and return their CellIds.
///
/// Fully deletes cells (removes from cells map + properties) and unbinds
/// them from the GridIndex. Used for structural operations where `#REF!`
/// errors are the correct behavior.
///
/// `exclude` is an optional set of CellIds to skip (for overlapping
/// moves — the relocation path uses this to avoid wiping cells that are
/// about to be re-registered at target positions).
pub fn clear_range_and_return_ids(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    range: &RangePos,
    exclude: Option<&HashSet<CellId>>,
) -> Vec<CellId> {
    // Snapshot matching CellIds before mutating the grid. `cells_in_range`
    // yields `(CellId, row, col)` — we only need the id here.
    let targets: Vec<CellId> = grid
        .cells_in_range(
            range.start_row(),
            range.start_col(),
            range.end_row(),
            range.end_col(),
        )
        .map(|(cid, _, _)| cid)
        .filter(|cid| match exclude {
            Some(exc) => !exc.contains(cid),
            None => true,
        })
        .collect();

    if targets.is_empty() {
        return Vec::new();
    }

    // Remove yrs cells + properties entries. For full delete we want the
    // cells map entry gone (not a marker cell), so we don't use
    // `clear_cells_by_hex` here — inline the minimal removal.
    {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let cells_map = get_cells_map(&txn, sheets, &sheet_hex);
        let props_map = get_properties_map(&txn, sheets, &sheet_hex);

        for cid in &targets {
            let cell_hex = id_to_hex(cid.as_u128());
            if let Some(ref cm) = cells_map {
                cm.remove(&mut txn, &cell_hex);
            }
            if let Some(ref pm) = props_map {
                pm.remove(&mut txn, &cell_hex);
            }
        }
    }

    // Drop identity bindings so these cells no longer resolve at their
    // former positions.
    for cid in &targets {
        grid.remove_cell(cid);
    }

    targets
}
