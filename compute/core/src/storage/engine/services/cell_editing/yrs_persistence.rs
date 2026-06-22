use cell_types::{CellId, SheetId};
use value_types::{CellValue, ComputeError};
use yrs::{Map, MapRef, Origin, Out, Transact, TransactionMut};

use crate::storage::cells::values::write_cell_position_to_yrs;
use crate::storage::engine::stores::EngineStores;
use compute_document::cell_serde::{build_cell_prelim, write_identity_formula_to_yrs};
use compute_document::hex::id_to_hex;
use compute_document::schema::{
    KEY_CELLS, KEY_FORMULA_AGGREGATE, KEY_FORMULA_DYNAMIC_ARRAY, KEY_FORMULA_REFS,
    KEY_FORMULA_TEMPLATE, KEY_FORMULA_VOLATILE,
};
use compute_document::undo::ORIGIN_USER_EDIT;
use formula_types::IdentityFormula;

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

/// Overlay canonical formula identity metadata onto an already-written formula cell.
///
/// Value write paths intentionally commit legacy `KEY_FORMULA` text before the
/// scheduler parses and registers the identity formula. Once the scheduler has
/// updated the mirror, callers use this helper to make Yrs carry the same
/// semantic formula state. Boolean identity flags are sparse-on-true in Yrs, so
/// stale keys must be removed before writing the current identity.
pub(in crate::storage::engine) fn write_cell_identity_formula_to_yrs(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id: CellId,
    identity_formula: &IdentityFormula,
) -> Result<(), ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let sheets_map = stores.storage.doc().get_or_insert_map("sheets");
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) else {
        return Ok(());
    };
    let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS) else {
        return Ok(());
    };
    let Some(Out::YMap(cell_map)) = cells_map.get(&txn, &cell_hex) else {
        return Ok(());
    };

    for key in [
        KEY_FORMULA_TEMPLATE,
        KEY_FORMULA_REFS,
        KEY_FORMULA_DYNAMIC_ARRAY,
        KEY_FORMULA_VOLATILE,
        KEY_FORMULA_AGGREGATE,
    ] {
        cell_map.remove(&mut txn, key);
    }

    write_identity_formula_to_yrs(&cell_map, &mut txn, identity_formula).map_err(|err| {
        ComputeError::InvalidInput {
            message: format!("failed to persist formula identity metadata: {err}"),
        }
    })
}
