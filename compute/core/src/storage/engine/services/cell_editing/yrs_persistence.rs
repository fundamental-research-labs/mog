use cell_types::{CellId, SheetId};
use value_types::CellValue;
use yrs::{Map, MapRef, Origin, Out, Transact, TransactionMut};

use crate::storage::cells::values::write_cell_position_to_yrs;
use crate::storage::engine::stores::EngineStores;
use compute_document::cell_serde::build_cell_prelim;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_CELLS;
use compute_document::undo::ORIGIN_USER_EDIT;

/// Write a cell value to the yrs Doc with ORIGIN_USER_EDIT.
///
/// Writes the cell data to the "cells" sub-map and mirrors the position
/// into `gridIndex/{posToId, idToPos}` (the authoritative yrs-side
/// identity store post-GridIndex migration) so that observer consumers —
/// undo/redo and `build_sheet_snapshot_from_yrs` structural rebuild —
/// can resolve `(row, col)` after the in-memory `GridIndex` has been
/// cleared.
///
/// Identity registration in the in-memory `GridIndex` is still the
/// caller's responsibility via `stores.grid_indexes.register_cell` /
/// `ensure_cell_id`; this function reads `row`/`col` hex IDs from that
/// index to build the yrs-side mapping.
pub(in crate::storage::engine) fn write_cell_to_yrs(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id: CellId,
    row: u32,
    col: u32,
    value: &CellValue,
    formula: Option<&str>,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());

    // Resolve row/col hex from the in-memory GridIndex BEFORE opening the
    // write transaction (the index is the sole identity authority; the
    // yrs-side mapping is a mirror for observer recovery).
    let (row_hex, col_hex) = stores
        .grid_indexes
        .get(sheet_id)
        .map(|g| (g.row_id_hex(row), g.col_id_hex(col)))
        .unwrap_or((None, None));

    // Get the sheets MapRef BEFORE creating the write transaction.
    // get_or_insert_map may internally acquire a write lock, so calling
    // it while a transact_mut is already active would deadlock.
    let sheets_map = stores.storage.doc().get_or_insert_map("sheets");

    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    // Mirror the position into gridIndex/{posToId, idToPos} so
    // observer-driven paths (undo/redo, structural rebuild) can resolve
    // (row, col) from yrs when the in-memory GridIndex is stale/cleared.
    if let (Some(rh), Some(ch)) = (row_hex.as_ref(), col_hex.as_ref()) {
        write_cell_to_yrs_in_txn(
            &mut txn,
            &sheets_map,
            &sheet_hex,
            cell_id,
            rh.as_str(),
            ch.as_str(),
            value,
            formula,
        );
    }
}

/// Transaction-scoped variant of [`write_cell_to_yrs`].
///
/// Bulk mutation paths use this after pre-growing dimensions and resolving
/// row/column ids so the whole batch commits as one user edit transaction.
pub(in crate::storage::engine) fn write_cell_to_yrs_in_txn(
    txn: &mut TransactionMut<'_>,
    sheets_map: &MapRef,
    sheet_hex: &str,
    cell_id: CellId,
    row_hex: &str,
    col_hex: &str,
    value: &CellValue,
    formula: Option<&str>,
) {
    let cell_hex = id_to_hex(cell_id.as_u128());

    if let Some(Out::YMap(sheet_map)) = sheets_map.get(&*txn, sheet_hex)
        && let Some(Out::YMap(cells_map)) = sheet_map.get(&*txn, KEY_CELLS)
    {
        let cell_prelim = build_cell_prelim(value, formula, None);
        cells_map.insert(txn, &*cell_hex, cell_prelim);
    }

    write_cell_position_to_yrs(txn, sheets_map, sheet_hex, &cell_hex, row_hex, col_hex);
}
