use cell_types::{CellId, SheetId};

use crate::identity::GridIndex;
use crate::storage::YrsStorage;

use super::stores::EngineStores;

/// Apply observed `gridIndex/posToId` entry changes to the in-memory
/// `GridIndex` for each affected sheet.
///
/// Each entry carries a `CellId` and the `rowHex`/`colHex` identity pair;
/// resolve those to the current `(row, col)` by consulting the sheet's
/// `rowOrder`/`colOrder` YArrays (the same source-of-truth hydration uses).
/// Entries whose row/col hex no longer resolves — e.g. a row was deleted
/// between the write and the observation — are silently skipped.
///
/// Runs on both the writer (idempotent: register_cell is a no-op) and on
/// every peer that applies a remote update containing a `posToId` insert,
/// so a metadata-only write (comment, hyperlink, format on a previously
/// empty cell) propagates the cell's position into the peer's in-memory
/// `GridIndex` without waiting for a sheet-lifecycle rebuild.
pub(in crate::storage::engine) fn apply_grid_index_changes(
    stores: &mut EngineStores,
    changes: &[compute_document::observe::GridIndexCellChange],
) {
    use crate::storage::infra::grid_helpers;
    use compute_document::hex::id_to_hex;
    use compute_document::observe::CellChangeKind;
    use yrs::{Array, Map, Out, Transact};

    if changes.is_empty() {
        return;
    }

    let txn = stores.storage.doc().transact();
    for change in changes {
        let sheet_hex = id_to_hex(change.sheet_id.as_u128());
        let Some(Out::YMap(sheet_map)) = stores.storage.sheets().get(&txn, &sheet_hex) else {
            continue;
        };
        let Some(row_arr) = grid_helpers::get_row_order_array(&sheet_map, &txn) else {
            continue;
        };
        let Some(col_arr) = grid_helpers::get_col_order_array(&sheet_map, &txn) else {
            continue;
        };
        let row = (0..row_arr.len(&txn)).find(|&i| {
            matches!(
                row_arr.get(&txn, i),
                Some(Out::Any(yrs::Any::String(s))) if s.as_ref() == change.row_hex
            )
        });
        let col = (0..col_arr.len(&txn)).find(|&i| {
            matches!(
                col_arr.get(&txn, i),
                Some(Out::Any(yrs::Any::String(s))) if s.as_ref() == change.col_hex
            )
        });
        let (Some(row), Some(col)) = (row, col) else {
            continue;
        };

        match change.kind {
            CellChangeKind::Modified => {
                if let Some(grid) = stores.grid_indexes.get_mut(&change.sheet_id) {
                    grid.register_cell(change.cell_id, row, col);
                }
            }
            CellChangeKind::Removed => {
                if let Some(grid) = stores.grid_indexes.get_mut(&change.sheet_id) {
                    // Guard: only remove if the cell is still at the vacated position.
                    // A preceding Modified event in the same observer batch may have
                    // already moved the cell to its new position — blindly removing
                    // would evict it from the new slot instead of the old one.
                    if grid.cell_position(&change.cell_id) == Some((row, col)) {
                        grid.remove_cell(&change.cell_id);
                    }
                }
            }
        }
    }
}

/// Build a GridIndex for a single sheet by reading rowOrder/colOrder from Yrs.
pub(in crate::storage::engine) fn build_grid_from_yrs_for_sheet(
    storage: &YrsStorage,
    sheet_id: SheetId,
    sheet_snap: &crate::snapshot::SheetSnapshot,
    id_alloc: std::sync::Arc<cell_types::IdAllocator>,
) -> GridIndex {
    use crate::storage::infra::grid_helpers;
    use yrs::{Map, Out, Transact};

    let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
    let (row_hexes, col_hexes, pos_to_id_entries) = {
        let txn = storage.doc().transact();
        let sm = storage
            .sheets()
            .get(&txn, &sheet_hex)
            .and_then(|v| match v {
                Out::YMap(m) => Some(m),
                _ => None,
            });
        if let Some(sm) = sm {
            let rh = grid_helpers::get_row_order_array(&sm, &txn)
                .map(|a| grid_helpers::read_row_order(&a, &txn))
                .unwrap_or_default();
            let ch = grid_helpers::get_col_order_array(&sm, &txn)
                .map(|a| grid_helpers::read_col_order(&a, &txn))
                .unwrap_or_default();
            let pos_to_id_entries = sm
                .get(&txn, compute_document::schema::KEY_GRID_INDEX)
                .and_then(|out| match out {
                    Out::YMap(grid_index_map) => {
                        grid_index_map.get(&txn, compute_document::schema::KEY_GRID_POS_TO_ID)
                    }
                    _ => None,
                })
                .and_then(|out| match out {
                    Out::YMap(pos_to_id) => Some(
                        pos_to_id
                            .iter(&txn)
                            .filter_map(|(pos_key, value)| match value {
                                yrs::Out::Any(yrs::Any::String(cell_hex)) => {
                                    Some((pos_key.to_string(), cell_hex.to_string()))
                                }
                                _ => None,
                            })
                            .collect::<Vec<_>>(),
                    ),
                    _ => None,
                })
                .unwrap_or_default();
            (rh, ch, pos_to_id_entries)
        } else {
            (vec![], vec![], vec![])
        }
    };

    let mut grid = if !row_hexes.is_empty() || !col_hexes.is_empty() {
        GridIndex::from_yrs_arrays(sheet_id, &row_hexes, &col_hexes, id_alloc)
    } else {
        GridIndex::new(sheet_id, sheet_snap.rows, sheet_snap.cols, id_alloc)
    };

    for (pos_key, cell_hex) in pos_to_id_entries {
        let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
            continue;
        };
        let (Some(row), Some(col)) = (
            grid.row_index_from_hex(row_hex),
            grid.col_index_from_hex(col_hex),
        ) else {
            continue;
        };
        if let Some(cell_raw) = compute_document::hex::hex_to_id(&cell_hex) {
            grid.register_cell(CellId::from_raw(cell_raw), row, col);
        }
    }

    for cell_data in &sheet_snap.cells {
        if let Ok(cell_id) = CellId::from_uuid_str(&cell_data.cell_id) {
            grid.register_cell(cell_id, cell_data.row, cell_data.col);
        }
    }
    grid
}
