use std::collections::HashMap;

use yrs::{Any, Map, MapPrelim, MapRef};

use compute_document::hex::id_to_hex;

use super::IdAllocator;

pub(super) type PositionMap = HashMap<(u32, u32), String>;

// ===========================================================================
// Identity helpers (Row/Col/Cell ID allocation)
// ===========================================================================

/// Get or create a CellId hex for a grid position during hydration.
///
/// Checks posToId first; if not found, allocates a new CellId via the
/// IdAllocator, inserts into both posToId and idToPos, and creates a
/// placeholder cell.
pub(super) fn get_or_create_cell_id_for_pos(
    cells_map: &MapRef,
    pos_map: &mut PositionMap,
    txn: &mut yrs::TransactionMut,
    row: u32,
    col: u32,
    allocator: &mut impl IdAllocator,
) -> String {
    let pos_key = (row, col);

    // Check in-memory map first
    if let Some(existing) = pos_map.get(&pos_key) {
        return existing.clone();
    }

    // Allocate new CellId and create placeholder cell in Yrs
    let cell_id = allocator.alloc_cell_id();
    let new_id_hex = id_to_hex(cell_id.as_u128());

    let cell_prelim = MapPrelim::from([("v", Any::Null)]);
    cells_map.insert(txn, &*new_id_hex, cell_prelim);

    // Track in in-memory map for subsequent lookups
    let new_id_str = new_id_hex.to_string();
    pos_map.insert(pos_key, new_id_str.clone());

    new_id_str
}

// NOTE: get_or_create_row_id and get_or_create_col_id have been removed.
// In the new model, all RowIds/ColIds are eagerly allocated into the
// rowOrder/colOrder YArrays during sheet creation. The hex strings are
// passed directly to hydration functions via the row_id_hexes/col_id_hexes
// vectors.
