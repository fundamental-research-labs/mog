use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use domain_types::domain::merge::{CellMergeInfo, ResolvedMergedRegion};
use yrs::{Any, Doc, Map, MapRef, Out, Transact};

use super::codec::StoredMerge;
use super::resolve::{ranges_overlap, resolve_merge_entry, resolve_merge_from_stored};
use super::yrs_io::get_merges_map;

pub fn get_all_merges(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
) -> Vec<ResolvedMergedRegion> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let merges_map = match get_merges_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };

    // Collect merges with their stored ordering index (if present).
    let mut result: Vec<(u32, ResolvedMergedRegion)> = Vec::new();
    for (_key, value) in merges_map.iter(&txn) {
        // Resolve from inline positions (structured Y.Map or JSON), falling back to
        // the GridIndex lookup for merges created by runtime CRUD.
        let resolved = resolve_merge_from_stored(&value, &txn)
            .or_else(|| resolve_merge_entry(&txn, grid, &value));
        if let Some(resolved) = resolved {
            let order = match &value {
                Out::YMap(map) => domain_types::yrs_schema::helpers::read_u32(
                    map,
                    &txn,
                    domain_types::yrs_schema::merge::KEY_ORDER,
                )
                .unwrap_or(u32::MAX),
                Out::Any(Any::String(json_str)) => serde_json::from_str::<StoredMerge>(json_str)
                    .ok()
                    .and_then(|s| s.ord)
                    .unwrap_or(u32::MAX),
                _ => u32::MAX,
            };
            result.push((order, resolved));
        }
    }
    // Sort by original file order so exports reproduce the same merge ordering.
    result.sort_by_key(|(ord, _)| *ord);
    result.into_iter().map(|(_, m)| m).collect()
}

/// Iterate every merge region on a sheet and collect just their bounding
/// rectangles `(start_row, start_col, end_row, end_col)`.
///
/// Unlike [`get_all_merges`] this does **not** require a `GridIndex` —
/// positions are read directly from the inline `sr/sc/er/ec` fields on
/// each merge entry (structured Y.Map or legacy JSON string). That makes
/// the result a pure function of the Yrs CRDT state on this sheet, and
/// therefore identical on a merge originator and every merge receiver.
///
/// Entries that lack inline positions (extremely old formats that stored
/// only cell-id identity) are silently skipped — those paths have long
/// been migrated and we don't reintroduce a grid lookup just to resurrect
/// a rectangle the bounds query would otherwise miss. If this ever fires
/// in practice, it will show up as a missing bound, not wrong data.
pub fn iter_merge_bounds(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
) -> Vec<(u32, u32, u32, u32)> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let merges_map = match get_merges_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return Vec::new(),
    };

    let mut out = Vec::new();
    for (_key, value) in merges_map.iter(&txn) {
        if let Some(resolved) = resolve_merge_from_stored(&value, &txn) {
            out.push((
                resolved.start_row,
                resolved.start_col,
                resolved.end_row,
                resolved.end_col,
            ));
        }
    }
    out
}

/// Get merged regions that intersect with a given range.
#[allow(clippy::too_many_arguments)]
pub fn get_merges_in_range(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<ResolvedMergedRegion> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let merges_map = match get_merges_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (_key, value) in merges_map.iter(&txn) {
        // Prefer inline positions to avoid a GridIndex lookup when possible.
        let resolved = resolve_merge_from_stored(&value, &txn)
            .or_else(|| resolve_merge_entry(&txn, grid, &value));
        if let Some(resolved) = resolved
            && ranges_overlap(
                resolved.start_row,
                resolved.start_col,
                resolved.end_row,
                resolved.end_col,
                start_row,
                start_col,
                end_row,
                end_col,
            )
        {
            result.push(resolved);
        }
    }
    result
}

// -------------------------------------------------------------------
// get_merges_in_viewport
// -------------------------------------------------------------------

/// Get merged regions that intersect with a viewport rectangle.
/// Alias for `get_merges_in_range` -- semantically separate for clarity.
#[allow(clippy::too_many_arguments)]
pub fn get_merges_in_viewport(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<ResolvedMergedRegion> {
    get_merges_in_range(
        doc, sheets, sheet_id, grid, start_row, start_col, end_row, end_col,
    )
}

// -------------------------------------------------------------------
// get_merge_for_cell
// -------------------------------------------------------------------

/// Get the merge containing a specific cell, if any.
pub fn get_merge_for_cell(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    row: u32,
    col: u32,
) -> Option<CellMergeInfo> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let merges_map = get_merges_map(&txn, sheets, &sheet_hex)?;

    for (_key, value) in merges_map.iter(&txn) {
        let resolved = resolve_merge_from_stored(&value, &txn)
            .or_else(|| resolve_merge_entry(&txn, grid, &value));
        if let Some(resolved) = resolved
            && row >= resolved.start_row
            && row <= resolved.end_row
            && col >= resolved.start_col
            && col <= resolved.end_col
        {
            let is_origin = row == resolved.start_row && col == resolved.start_col;
            return Some(CellMergeInfo {
                merge: resolved,
                is_origin,
            });
        }
    }
    None
}

// -------------------------------------------------------------------
// is_merge_origin
// -------------------------------------------------------------------

/// Check if the cell at (row, col) is the origin (top-left) of a merge.
pub fn is_merge_origin(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    row: u32,
    col: u32,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    // Look up CellId at position via the GridIndex — the sole identity authority.
    let cell_id = match grid.cell_id_at(row, col) {
        Some(id) => id,
        None => return false,
    };
    let cell_hex = id_to_hex(cell_id.as_u128());

    let merges_map = match get_merges_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    merges_map.get(&txn, &cell_hex).is_some()
}

// -------------------------------------------------------------------
