use cell_types::{CellId, ColId, RowId, SheetId};
use compute_document::hex::id_to_hex;

use crate::mirror::CellMirror;

// -------------------------------------------------------------------
// Virtual CellId cleanup for structural deletes
// -------------------------------------------------------------------

/// Collect virtual CellIds from Range views whose rows fall in the doomed band
/// `[at, at+count)`. Must be called BEFORE `StructuralOps::delete_rows`
/// modifies identity maps.
///
/// Mirrors the logic in `CellMirror::apply_structure_change` (structure.rs
/// lines 101-147) but runs earlier so we can purge these from the Yrs CRDT.
pub(super) fn collect_virtual_cell_ids_for_deleted_rows(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    at: u32,
    count: u32,
) -> Vec<CellId> {
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return Vec::new();
    };
    if sheet.range_views_is_empty() {
        return Vec::new();
    }

    // Collect RowIds in the doomed band.
    let deleted_row_ids: Vec<RowId> = (at..at + count)
        .filter_map(|i| sheet.row_id_at(i))
        .collect();
    if deleted_row_ids.is_empty() {
        return Vec::new();
    }

    // Collect all ColIds that any Range view covers.
    let range_col_ids: rustc_hash::FxHashSet<ColId> = sheet
        .iter_ranges()
        .flat_map(|(_, rv)| rv.col_offset_by_id.keys().copied())
        .collect();

    // Collect all RowIds that any Range view covers, to filter deleted_row_ids.
    let range_row_ids: rustc_hash::FxHashSet<RowId> = sheet
        .iter_ranges()
        .flat_map(|(_, rv)| rv.row_offset_by_id.keys().copied())
        .collect();

    let mut result = Vec::new();
    for &rid in &deleted_row_ids {
        if !range_row_ids.contains(&rid) {
            continue;
        }
        for &cid in &range_col_ids {
            result.push(CellId::virtual_at(*sheet_id, rid, cid));
        }
    }
    result
}

/// Collect virtual CellIds from Range views whose columns fall in the doomed
/// band `[at, at+count)`. Symmetric to `collect_virtual_cell_ids_for_deleted_rows`.
pub(super) fn collect_virtual_cell_ids_for_deleted_cols(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    at: u32,
    count: u32,
) -> Vec<CellId> {
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return Vec::new();
    };
    if sheet.range_views_is_empty() {
        return Vec::new();
    }

    // Collect ColIds in the doomed band.
    let deleted_col_ids: Vec<ColId> = (at..at + count)
        .filter_map(|i| sheet.col_id_at(i))
        .collect();
    if deleted_col_ids.is_empty() {
        return Vec::new();
    }

    // Collect all RowIds that any Range view covers.
    let range_row_ids: rustc_hash::FxHashSet<RowId> = sheet
        .iter_ranges()
        .flat_map(|(_, rv)| rv.row_offset_by_id.keys().copied())
        .collect();

    // Collect all ColIds that any Range view covers, to filter deleted_col_ids.
    let range_col_ids: rustc_hash::FxHashSet<ColId> = sheet
        .iter_ranges()
        .flat_map(|(_, rv)| rv.col_offset_by_id.keys().copied())
        .collect();

    let mut result = Vec::new();
    for &cid in &deleted_col_ids {
        if !range_col_ids.contains(&cid) {
            continue;
        }
        for &rid in &range_row_ids {
            result.push(CellId::virtual_at(*sheet_id, rid, cid));
        }
    }
    result
}

/// Remove virtual CellId entries from the Yrs `cells` map. Uses a single
/// `ORIGIN_STRUCTURAL` transaction so undo groups this with the structural op.
///
/// Removing a key that does not exist in the Yrs map is a no-op, so this is
/// safe to call even if `StructuralOps::delete_rows/cols` already removed
/// some of these CellIds.
pub(super) fn purge_virtual_cell_ids_from_yrs(
    doc: &yrs::Doc,
    sheets_map: &yrs::MapRef,
    sheet_id: &SheetId,
    virtual_cell_ids: &[CellId],
) {
    use compute_document::schema::KEY_CELLS;
    use compute_document::undo::ORIGIN_STRUCTURAL;
    use yrs::{Map, Origin, Out, Transact};

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_STRUCTURAL));
    if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex)
        && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
    {
        for cell_id in virtual_cell_ids {
            let cell_hex = id_to_hex(cell_id.as_u128());
            cells_map.remove(&mut txn, &cell_hex);
        }
    }
}
