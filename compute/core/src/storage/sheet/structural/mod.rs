//! Structural operations on yrs-backed storage.
//!
//! Provides insert/delete rows/columns operations that coordinate three
//! subsystems:
//!
//! 1. **GridIndex** (Cell Identity Model) — updates CellId<->position mappings
//! 2. **yrs Doc** — updates rowOrder/colOrder YArrays, removes deleted cells
//! 3. **CellMirror** — updates the fast-read position index
//!
//! Each operation executes as a single yrs transaction with `ORIGIN_STRUCTURAL`
//! so that the undo manager treats it as one undoable step.
//!
//! # Design
//!
//! Row/column counts are derived from `rowOrder.len()` / `colOrder.len()` —
//! no `meta.rows` / `meta.cols` counters are maintained.
//!
//! Cell positions are tracked in the authoritative in-memory `GridIndex`
//! (mirrored into the yrs `gridIndex/posToId/idToPos` sub-maps), so insert
//! operations require no shifting of per-cell CRDT entries.
//!
//! `StructuralOps` methods take explicit references to the components they
//! need (`&Doc`, `&MapRef`, `&mut GridIndex`, `&mut CellMirror`), rather
//! than `&mut YrsStorage`. This keeps the integration flexible — the caller
//! (ComputeCore or a future bridge layer) wires them together.

mod axis_order;
mod deleted_cells;
mod removed_ranges;

#[cfg(test)]
mod hidden_metadata_tests;
#[cfg(test)]
mod tests;

use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact, TransactionMut};

use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use cell_types::{CellId, ColId, RowId, SheetId};
use formula_types::StructureChange;
use value_types::ComputeError;

use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_HIDDEN_COLS, KEY_HIDDEN_ROWS};
use compute_document::undo::ORIGIN_STRUCTURAL;

/// Structural operations on yrs-backed storage.
///
/// These operations modify the grid structure (insert/delete rows/cols)
/// while maintaining Cell Identity Model invariants:
/// - CellIds remain stable across structural changes
/// - Position index is updated via GridIndex
/// - yrs document is updated in a single transaction with ORIGIN_STRUCTURAL
/// - CellMirror is updated to reflect new positions
pub struct StructuralOps;

fn remap_position_keyed_bool_map(
    txn: &mut TransactionMut,
    map: &MapRef,
    at: u32,
    count: u32,
    forward: bool,
) {
    if count == 0 {
        return;
    }

    let mut removals = Vec::new();
    let mut insertions = Vec::new();
    let delete_end = at.saturating_add(count);

    for (key, value) in map.iter(txn) {
        if !matches!(value, Out::Any(Any::Bool(true))) {
            continue;
        }
        let Ok(pos) = key.parse::<u32>() else {
            continue;
        };

        if forward {
            if pos >= at {
                removals.push(key.to_string());
                insertions.push(pos + count);
            }
        } else if pos >= at && pos < delete_end {
            removals.push(key.to_string());
        } else if pos >= delete_end {
            removals.push(key.to_string());
            insertions.push(pos - count);
        }
    }

    for key in removals {
        map.remove(txn, &key);
    }
    for pos in insertions {
        let key = pos.to_string();
        map.insert(txn, &*key, Any::Bool(true));
    }
}

fn remap_hidden_cache(
    txn: &mut TransactionMut,
    sheet_map: &MapRef,
    hidden_key: &str,
    at: u32,
    count: u32,
    forward: bool,
) {
    if let Some(Out::YMap(map)) = sheet_map.get(txn, hidden_key) {
        remap_position_keyed_bool_map(txn, &map, at, count, forward);
    }
}

impl StructuralOps {
    /// Insert `count` rows starting at `at_row` in the given sheet.
    ///
    /// Updates:
    /// - GridIndex: generates new RowIds, shifts cell positions down
    /// - yrs Doc: inserts new RowId hex strings into `rowOrder` YArray
    /// - CellMirror: shifts position index via `apply_structure_change`
    pub fn insert_rows(
        doc: &Doc,
        sheets_map: &MapRef,
        grid_index: &mut GridIndex,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        at_row: u32,
        count: u32,
    ) -> Result<Vec<RowId>, ComputeError> {
        // 1. Update GridIndex — generates new RowIds and shifts positions
        let new_row_ids = grid_index.insert_rows(at_row, count);

        // 2. Update yrs doc in a single ORIGIN_STRUCTURAL transaction
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        {
            let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_STRUCTURAL));
            if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) {
                axis_order::insert_row_ids(&mut txn, &sheet_map, grid_index, at_row, count);
                remap_hidden_cache(&mut txn, &sheet_map, KEY_HIDDEN_ROWS, at_row, count, true);
            }
        }

        // 3. Update CellMirror via structure change
        let change = StructureChange::InsertRows {
            at: at_row,
            count,
            new_row_ids: new_row_ids.clone(),
        };
        let _ = mirror.apply_structure_change(sheet_id, &change);

        Ok(new_row_ids)
    }

    /// Delete `count` rows starting at `at_row` in the given sheet.
    ///
    /// Cells in deleted rows are removed from both yrs and mirror.
    /// Returns the CellIds of deleted cells.
    ///
    /// Updates:
    /// - GridIndex: removes cells in deleted rows, shifts remaining up
    /// - yrs Doc: removes from rowOrder and the cells map
    /// - CellMirror: removes cells and shifts via `apply_structure_change`
    pub fn delete_rows(
        doc: &Doc,
        sheets_map: &MapRef,
        grid_index: &mut GridIndex,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        at_row: u32,
        count: u32,
    ) -> Result<Vec<CellId>, ComputeError> {
        // 1. Update GridIndex — removes cells and shifts positions.
        //    (Pre-R51 code snapshotted row/col id hexes here to remove legacy
        //    `cellGrid` / `cellPos` entries; those sub-maps are retired, so
        //    the authoritative `GridIndex` removal is all we need.)
        let deleted_cell_ids = grid_index.delete_rows(at_row, count);

        // 2. Update yrs doc in a single ORIGIN_STRUCTURAL transaction
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        {
            let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_STRUCTURAL));
            if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) {
                axis_order::remove_rows(&mut txn, &sheet_map, at_row, count);
                remap_hidden_cache(&mut txn, &sheet_map, KEY_HIDDEN_ROWS, at_row, count, false);
                deleted_cells::remove_deleted_cells(&mut txn, &sheet_map, &deleted_cell_ids);
            }
        }

        // 3. Update CellMirror via structure change
        let change = StructureChange::DeleteRows {
            at: at_row,
            count,
            deleted_cell_ids: deleted_cell_ids.clone(),
        };
        let removed_ranges = mirror.apply_structure_change(sheet_id, &change);

        // 4. Clean up Yrs entries for structurally removed Ranges
        if !removed_ranges.is_empty() {
            removed_ranges::cleanup_removed_ranges_from_yrs(
                doc,
                sheets_map,
                sheet_id,
                &removed_ranges,
            );
        }

        Ok(deleted_cell_ids)
    }

    /// Insert `count` columns starting at `at_col` in the given sheet.
    ///
    /// Updates:
    /// - GridIndex: generates new ColIds, shifts cell positions right
    /// - yrs Doc: inserts new ColId hex strings into `colOrder` YArray
    /// - CellMirror: shifts position index via `apply_structure_change`
    pub fn insert_cols(
        doc: &Doc,
        sheets_map: &MapRef,
        grid_index: &mut GridIndex,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        at_col: u32,
        count: u32,
    ) -> Result<Vec<ColId>, ComputeError> {
        // 1. Update GridIndex — generates new ColIds and shifts positions
        let new_col_ids = grid_index.insert_cols(at_col, count);

        // 2. Update yrs doc in a single ORIGIN_STRUCTURAL transaction
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        {
            let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_STRUCTURAL));
            if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) {
                axis_order::insert_col_ids(&mut txn, &sheet_map, grid_index, at_col, count);
                remap_hidden_cache(&mut txn, &sheet_map, KEY_HIDDEN_COLS, at_col, count, true);
            }
        }

        // 3. Update CellMirror via structure change
        let change = StructureChange::InsertCols {
            at: at_col,
            count,
            new_col_ids: new_col_ids.clone(),
        };
        let _ = mirror.apply_structure_change(sheet_id, &change);

        Ok(new_col_ids)
    }

    /// Delete `count` columns starting at `at_col` in the given sheet.
    ///
    /// Cells in deleted columns are removed from both yrs and mirror.
    /// Returns the CellIds of deleted cells.
    ///
    /// Updates:
    /// - GridIndex: removes cells in deleted cols, shifts remaining left
    /// - yrs Doc: removes from colOrder and the cells map
    /// - CellMirror: removes cells and shifts via `apply_structure_change`
    pub fn delete_cols(
        doc: &Doc,
        sheets_map: &MapRef,
        grid_index: &mut GridIndex,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        at_col: u32,
        count: u32,
    ) -> Result<Vec<CellId>, ComputeError> {
        // 1. Update GridIndex — removes cells and shifts positions.
        //    (Pre-R51 code snapshotted row/col id hexes here to remove legacy
        //    `cellGrid` / `cellPos` entries; those sub-maps are retired, so
        //    the authoritative `GridIndex` removal is all we need.)
        let deleted_cell_ids = grid_index.delete_cols(at_col, count);

        // 2. Update yrs doc in a single ORIGIN_STRUCTURAL transaction
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        {
            let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_STRUCTURAL));
            if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) {
                axis_order::remove_cols(&mut txn, &sheet_map, at_col, count);
                remap_hidden_cache(&mut txn, &sheet_map, KEY_HIDDEN_COLS, at_col, count, false);
                deleted_cells::remove_deleted_cells(&mut txn, &sheet_map, &deleted_cell_ids);
            }
        }

        // 3. Update CellMirror via structure change
        let change = StructureChange::DeleteCols {
            at: at_col,
            count,
            deleted_cell_ids: deleted_cell_ids.clone(),
        };
        let removed_ranges = mirror.apply_structure_change(sheet_id, &change);

        // 4. Clean up Yrs entries for structurally removed Ranges
        if !removed_ranges.is_empty() {
            removed_ranges::cleanup_removed_ranges_from_yrs(
                doc,
                sheets_map,
                sheet_id,
                &removed_ranges,
            );
        }

        Ok(deleted_cell_ids)
    }
}
