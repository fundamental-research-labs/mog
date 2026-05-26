//! Merged cell CRUD operations.
//! Port of `spreadsheet-model/src/merges.ts`.
//!
//! ## Identity
//!
//! `GridIndex` is the sole authority for (sheet, row, col) ↔ `CellId` resolution.
//! Read paths take `&GridIndex`; write paths that may allocate top-left or
//! bottom-right marker cells take `&mut GridIndex`.

use crate::storage::infra::grid_helpers::get_cells_map;

use cell_types::{CellId, SheetId};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::identity::GridIndex;
use compute_document::schema::{KEY_MERGE_BACKUPS, KEY_MERGES, KEY_VALUE};
use compute_document::undo::ORIGIN_USER_EDIT;
pub use domain_types::domain::merge::*;
use std::sync::Arc;
use value_types::ComputeError;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::storage::cells::values::write_cell_position_to_yrs;

/// Y.Map value format for stored merges. Wraps identity with ordering metadata.
/// This is a storage type, not a domain type.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMerge {
    pub top_left_id: String,
    pub bottom_right_id: String,
    /// Original file order index (for XLSX round-trip). None for user-created merges.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ord: Option<u32>,
    /// Resolved positions so export doesn't need Yrs idToPos.
    pub sr: u32,
    pub sc: u32,
    pub er: u32,
    pub ec: u32,
}

impl StoredMerge {
    pub fn to_identity(&self) -> IdentityMergedRegion {
        IdentityMergedRegion {
            top_left_id: self.top_left_id.clone(),
            bottom_right_id: self.bottom_right_id.clone(),
        }
    }
}

fn get_merges_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sm = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, KEY_MERGES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Serialize a `StoredMerge` to a JSON string (retained for test backward-compat).
#[cfg(test)]
fn serialize_merge(merge: &StoredMerge) -> String {
    serde_json::to_string(merge).expect("StoredMerge serialization should not fail")
}

// ---------------------------------------------------------------------------
// StoredMerge ↔ structured Y.Map helpers
// ---------------------------------------------------------------------------

use domain_types::yrs_schema::merge::{
    KEY_BOTTOM_RIGHT_ID, KEY_END_COL, KEY_END_ROW, KEY_ORDER, KEY_START_COL, KEY_START_ROW,
    KEY_TOP_LEFT_ID,
};

/// Convert a [`StoredMerge`] to Yrs prelim entries for structured Y.Map storage.
pub fn stored_merge_to_yrs_prelim(stored: &StoredMerge) -> Vec<(&str, Any)> {
    let mut entries = vec![
        (KEY_START_ROW, Any::Number(stored.sr as f64)),
        (KEY_START_COL, Any::Number(stored.sc as f64)),
        (KEY_END_ROW, Any::Number(stored.er as f64)),
        (KEY_END_COL, Any::Number(stored.ec as f64)),
        (
            KEY_TOP_LEFT_ID,
            Any::String(Arc::from(stored.top_left_id.as_str())),
        ),
        (
            KEY_BOTTOM_RIGHT_ID,
            Any::String(Arc::from(stored.bottom_right_id.as_str())),
        ),
    ];
    if let Some(ord) = stored.ord {
        entries.push((KEY_ORDER, Any::Number(ord as f64)));
    }
    entries
}

/// Read a [`StoredMerge`] from a Y.Map that contains structured merge data
/// (including cell identity fields `tl` and `br`).
fn stored_merge_from_yrs_map<T: yrs::ReadTxn>(map: &MapRef, txn: &T) -> Option<StoredMerge> {
    use domain_types::yrs_schema::helpers::{read_string, read_u32};
    Some(StoredMerge {
        sr: read_u32(map, txn, KEY_START_ROW)?,
        sc: read_u32(map, txn, KEY_START_COL)?,
        er: read_u32(map, txn, KEY_END_ROW)?,
        ec: read_u32(map, txn, KEY_END_COL)?,
        top_left_id: read_string(map, txn, KEY_TOP_LEFT_ID).unwrap_or_default(),
        bottom_right_id: read_string(map, txn, KEY_BOTTOM_RIGHT_ID).unwrap_or_default(),
        ord: read_u32(map, txn, KEY_ORDER),
    })
}

/// Check if two axis-aligned rectangles overlap.
#[allow(clippy::too_many_arguments)]
fn ranges_overlap(
    r1_sr: u32,
    r1_sc: u32,
    r1_er: u32,
    r1_ec: u32,
    r2_sr: u32,
    r2_sc: u32,
    r2_er: u32,
    r2_ec: u32,
) -> bool {
    !(r1_er < r2_sr || r1_sr > r2_er || r1_ec < r2_sc || r1_sc > r2_ec)
}

/// Parse a cell-id hex string into a `CellId`.
fn parse_cell_id_hex(hex: &str) -> Option<CellId> {
    hex_to_id(hex).map(CellId::from_raw)
}

/// Resolve an `IdentityMergedRegion` to row/col positions by looking up both
/// CellId hexes in the `GridIndex` — the sole identity authority.
fn resolve_region(grid: &GridIndex, merge: &IdentityMergedRegion) -> Option<ResolvedMergedRegion> {
    let tl_id = parse_cell_id_hex(&merge.top_left_id)?;
    let br_id = parse_cell_id_hex(&merge.bottom_right_id)?;

    let (sr, sc) = grid.cell_position(&tl_id)?;
    let (er, ec) = grid.cell_position(&br_id)?;

    Some(ResolvedMergedRegion::new(merge.clone(), sr, sc, er, ec))
}

/// Try to resolve a merge entry from either format:
/// 1. Structured Y.Map (preferred — full StoredMerge with cell IDs, or legacy coords-only)
/// 2. JSON string (`StoredMerge` — legacy format, covers both StoredMerge and old IdentityMergedRegion)
fn resolve_merge_entry<T: yrs::ReadTxn>(
    txn: &T,
    grid: &GridIndex,
    value: &Out,
) -> Option<ResolvedMergedRegion> {
    // Try structured Y.Map first (preferred)
    if let Out::YMap(map) = value {
        // Full StoredMerge with cell identity fields
        if let Some(stored) = stored_merge_from_yrs_map(map, txn) {
            return resolve_region(grid, &stored.to_identity());
        }
        // Legacy structured format without cell IDs (coords only)
        if let Some(region) = domain_types::yrs_schema::merge::from_yrs_map(map, txn) {
            return Some(ResolvedMergedRegion::new(
                IdentityMergedRegion {
                    top_left_id: String::new(),
                    bottom_right_id: String::new(),
                },
                region.start_row,
                region.start_col,
                region.end_row,
                region.end_col,
            ));
        }
    }
    // Try JSON string (StoredMerge — written by hydration since cec2a6c5)
    if let Out::Any(Any::String(json_str)) = value
        && let Ok(stored) = serde_json::from_str::<StoredMerge>(json_str)
    {
        return resolve_region(grid, &stored.to_identity());
    }
    None
}

/// Read a cell value string from the cells map (for data-loss checking).
fn read_cell_value<T: yrs::ReadTxn>(
    txn: &T,
    cells_map: &MapRef,
    cell_id_hex: &str,
) -> Option<String> {
    let cell_map = match cells_map.get(txn, cell_id_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match cell_map.get(txn, KEY_VALUE) {
        Some(Out::Any(Any::Null)) | Some(Out::Any(Any::Undefined)) | None => None,
        Some(Out::Any(Any::String(s))) if s.is_empty() => None,
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        Some(Out::Any(Any::Number(n))) => Some(n.to_string()),
        Some(Out::Any(Any::Bool(b))) => Some(b.to_string()),
        _ => None,
    }
}

// =============================================================================
// Free-function Merge Operations (Pattern C)
// =============================================================================

// -------------------------------------------------------------------
// merge_range
// -------------------------------------------------------------------

/// Merge a range of cells. Returns the created `IdentityMergedRegion`, or
/// `None` if the range is invalid or overlaps with an existing merge.
///
/// The value in the top-left cell is retained; non-origin cells have their
/// values cleared (cell identity is preserved for CRDT safety).
#[allow(clippy::too_many_arguments)]
pub fn merge_range(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<Option<IdentityMergedRegion>, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());

    // Validate range -- must span at least 2 cells
    if start_row > end_row || start_col > end_col {
        return Ok(None);
    }
    if start_row == end_row && start_col == end_col {
        return Ok(None);
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let merges_map = match get_merges_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => {
            return Err(ComputeError::SheetNotFound {
                sheet_id: sheet_hex.to_string(),
            });
        }
    };

    // Check for overlapping existing merges
    for (_key, value) in merges_map.iter(&txn) {
        if let Some(resolved) = resolve_merge_entry(&txn, grid, &value)
            && ranges_overlap(
                start_row,
                start_col,
                end_row,
                end_col,
                resolved.start_row,
                resolved.start_col,
                resolved.end_row,
                resolved.end_col,
            )
        {
            return Ok(None);
        }
    }

    // Get or create CellIds for top-left and bottom-right via the GridIndex.
    let tl_cell_id = grid.ensure_cell_id(start_row, start_col);
    let br_cell_id = grid.ensure_cell_id(end_row, end_col);
    let tl_id = id_to_hex(tl_cell_id.as_u128()).to_string();
    let br_id = id_to_hex(br_cell_id.as_u128()).to_string();

    // Ensure the cells map has entries for the newly allocated corner cells
    // (so subsequent value reads/writes find them). Placeholder value=null.
    if let Some(cells_map) = get_cells_map(&txn, sheets, &sheet_hex) {
        for corner_hex in [&tl_id, &br_id] {
            if !matches!(cells_map.get(&txn, corner_hex.as_str()), Some(Out::YMap(_))) {
                let cell_prelim = MapPrelim::from([(KEY_VALUE, Any::Null)]);
                cells_map.insert(&mut txn, corner_hex.as_str(), cell_prelim);
            }
        }
    }
    for (cell_hex, row, col) in [
        (tl_id.as_str(), start_row, start_col),
        (br_id.as_str(), end_row, end_col),
    ] {
        if let (Some(row_hex), Some(col_hex)) = (grid.row_id_hex(row), grid.col_id_hex(col)) {
            write_cell_position_to_yrs(
                &mut txn,
                sheets,
                &sheet_hex,
                cell_hex,
                row_hex.as_str(),
                col_hex.as_str(),
            );
        }
    }

    let stored = StoredMerge {
        top_left_id: tl_id.clone(),
        bottom_right_id: br_id.clone(),
        ord: None,
        sr: start_row,
        sc: start_col,
        er: end_row,
        ec: end_col,
    };
    let region = stored.to_identity();

    // Store merge keyed by top-left CellId hex (structured Y.Map)
    let entries = stored_merge_to_yrs_prelim(&stored);
    let nested: MapPrelim = entries.into_iter().collect();
    merges_map.insert(&mut txn, &*tl_id, nested);

    // Clear non-origin cell contents. Replacing the child cell map with a
    // marker `v:null` drops formula keys and other cell-local content while
    // preserving the CellId and separately-stored properties/formatting.
    if let Some(cells_map) = get_cells_map(&txn, sheets, &sheet_hex) {
        for (cell_id, r, c) in grid
            .cells_in_range(start_row, start_col, end_row, end_col)
            .collect::<Vec<_>>()
        {
            if r == start_row && c == start_col {
                continue;
            }
            let cell_hex = id_to_hex(cell_id.as_u128());
            if matches!(cells_map.get(&txn, &cell_hex), Some(Out::YMap(_))) {
                let cell_prelim = MapPrelim::from([(KEY_VALUE, Any::Null)]);
                cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
            }
        }
    }

    Ok(Some(region))
}

// -------------------------------------------------------------------
// merge_across
// -------------------------------------------------------------------

/// Create separate horizontal merges for each row in the selection.
///
/// Matches Excel's "Merge Across" behaviour: A1:C3 becomes three
/// merges A1:C1, A2:C2, A3:C3.
#[allow(clippy::too_many_arguments)]
pub fn merge_across(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<IdentityMergedRegion> {
    if start_col >= end_col || start_row > end_row {
        return vec![];
    }

    let mut results = Vec::new();
    for row in start_row..=end_row {
        if let Ok(Some(region)) =
            merge_range(doc, sheets, sheet_id, grid, row, start_col, row, end_col)
        {
            results.push(region);
        }
    }
    results
}

// -------------------------------------------------------------------
// merge_and_center
// -------------------------------------------------------------------

/// Merge and center: first unmerge any overlapping merges in the range,
/// then create a single merge spanning the full range.
///
/// Note: the center-alignment formatting is applied separately by the
/// caller via the properties/format domain.
#[allow(clippy::too_many_arguments)]
pub fn merge_and_center(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<Option<IdentityMergedRegion>, ComputeError> {
    // First unmerge anything in the range
    unmerge_range(
        doc, sheets, sheet_id, grid, start_row, start_col, end_row, end_col,
    );

    // Then create the new merge
    merge_range(
        doc, sheets, sheet_id, grid, start_row, start_col, end_row, end_col,
    )
}

// -------------------------------------------------------------------
// check_merge_data_loss
// -------------------------------------------------------------------

/// Check whether merging a range would clear data from non-origin cells.
///
/// Returns `(has_data_loss, cells_with_data)`.
pub fn check_merge_data_loss(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> (bool, u32) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return (false, 0),
    };

    let mut count: u32 = 0;
    for (cell_id, r, c) in grid.cells_in_range(start_row, start_col, end_row, end_col) {
        if r == start_row && c == start_col {
            continue; // skip origin
        }
        let cell_hex = id_to_hex(cell_id.as_u128());
        if read_cell_value(&txn, &cells_map, &cell_hex).is_some() {
            count += 1;
        }
    }

    (count > 0, count)
}

// -------------------------------------------------------------------
// unmerge_range
// -------------------------------------------------------------------

/// Remove all merges whose origin (top-left) falls within the given range.
///
/// Returns the number of merges removed.
#[allow(clippy::too_many_arguments)]
pub fn unmerge_range(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> u32 {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let merges_map = match get_merges_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return 0,
    };

    // Collect keys to remove
    let mut to_remove: Vec<String> = Vec::new();
    for (key, value) in merges_map.iter(&txn) {
        match resolve_merge_entry(&txn, grid, &value) {
            Some(resolved) => {
                if resolved.start_row >= start_row
                    && resolved.start_row <= end_row
                    && resolved.start_col >= start_col
                    && resolved.start_col <= end_col
                {
                    to_remove.push(key.to_string());
                }
            }
            None => {
                // Unresolvable merge -- remove it as well
                to_remove.push(key.to_string());
            }
        }
    }

    // Remove any merge backup entries for explicit unmerge. Undo of the merge
    // itself restores covered-cell contents by reversing the original merge
    // transaction; the user-facing Unmerge Cells command must not resurrect
    // values that Excel discarded during the confirmed merge.
    let backups_map = sheets
        .get(&txn, &sheet_hex)
        .and_then(|v| match v {
            Out::YMap(sm) => sm.get(&txn, KEY_MERGE_BACKUPS),
            _ => None,
        })
        .and_then(|v| match v {
            Out::YMap(m) => Some(m),
            _ => None,
        });

    let count = to_remove.len() as u32;
    for key in &to_remove {
        merges_map.remove(&mut txn, key.as_str());

        if let Some(backups) = &backups_map {
            backups.remove(&mut txn, key.as_str());
        }
    }
    count
}

// -------------------------------------------------------------------
// get_all_merges
// -------------------------------------------------------------------

/// Get all merged regions for a sheet with resolved positions.
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

/// Resolve a merge entry using inline positions (structured Y.Map).
fn resolve_merge_from_stored<T: yrs::ReadTxn>(
    value: &Out,
    txn: &T,
) -> Option<ResolvedMergedRegion> {
    if let Out::YMap(map) = value
        && let Some(stored) = stored_merge_from_yrs_map(map, txn)
    {
        let identity = stored.to_identity();
        return Some(ResolvedMergedRegion::new(
            identity, stored.sr, stored.sc, stored.er, stored.ec,
        ));
    }
    // JSON string (StoredMerge — written by hydration since cec2a6c5)
    if let Out::Any(Any::String(json_str)) = value
        && let Ok(stored) = serde_json::from_str::<StoredMerge>(json_str)
    {
        let identity = stored.to_identity();
        return Some(ResolvedMergedRegion::new(
            identity, stored.sr, stored.sc, stored.er, stored.ec,
        ));
    }
    None
}

// -------------------------------------------------------------------
// get_merges_in_range
// -------------------------------------------------------------------

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
// clear_all_merges
// -------------------------------------------------------------------

/// Clear all merged regions for a sheet.
pub fn clear_all_merges(doc: &Doc, sheets: &MapRef, sheet_id: SheetId) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let merges_map = match get_merges_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let keys: Vec<String> = merges_map
        .iter(&txn)
        .map(|(key, _)| key.to_string())
        .collect();

    for key in &keys {
        merges_map.remove(&mut txn, key.as_str());
    }
}

// -------------------------------------------------------------------
// validate_and_clean_merges
// -------------------------------------------------------------------

/// Validate merges and remove any whose CellIds can no longer be resolved.
///
/// Returns the number of invalid merges removed.
pub fn validate_and_clean_merges(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
) -> u32 {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let merges_map = match get_merges_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return 0,
    };

    let mut to_remove: Vec<String> = Vec::new();
    for (key, value) in merges_map.iter(&txn) {
        if resolve_merge_entry(&txn, grid, &value).is_none() {
            to_remove.push(key.to_string());
        }
    }

    let count = to_remove.len() as u32;
    for key in &to_remove {
        merges_map.remove(&mut txn, key.as_str());
    }
    count
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use cell_types::{SheetId, SheetPos};

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    /// Create a storage with one sheet plus a fresh `GridIndex` that serves
    /// as the authoritative identity store for that sheet in the test.
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

    /// Seed a cell value at (row, col) so data-loss checks can detect it.
    fn seed_cell_value(
        storage: &YrsStorage,
        grid: &mut GridIndex,
        sheet_id: SheetId,
        row: u32,
        col: u32,
        val: &str,
    ) {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_id = grid.ensure_cell_id(row, col);
        let cell_hex = id_to_hex(cell_id.as_u128());
        let mut txn = storage.doc().transact_mut();
        if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
            let cell_prelim = MapPrelim::from([(KEY_VALUE, Any::String(Arc::from(val)))]);
            cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
        }
    }

    fn stored_cell_value(
        storage: &YrsStorage,
        grid: &GridIndex,
        sheet_id: SheetId,
        row: u32,
        col: u32,
    ) -> Option<String> {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_id = grid.cell_id_at(row, col)?;
        let cell_hex = id_to_hex(cell_id.as_u128());
        let txn = storage.doc().transact();
        let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex)?;
        read_cell_value(&txn, &cells_map, &cell_hex)
    }

    // -------------------------------------------------------------------
    // Test 1: Simple merge
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_range_basic() {
        let (storage, sid, mut grid) = storage_with_sheet();
        let result = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 2);
        assert!(result.is_ok());
        let region = result.unwrap();
        assert!(region.is_some());
        let region = region.unwrap();
        assert!(!region.top_left_id.is_empty());
        assert!(!region.bottom_right_id.is_empty());
        assert_ne!(region.top_left_id, region.bottom_right_id);

        let top_left = CellId::from_raw(hex_to_id(&region.top_left_id).unwrap());
        let bottom_right = CellId::from_raw(hex_to_id(&region.bottom_right_id).unwrap());
        assert_eq!(
            storage.read_cell_position_from_yrs(&sid, &top_left),
            Some(SheetPos::new(0, 0))
        );
        assert_eq!(
            storage.read_cell_position_from_yrs(&sid, &bottom_right),
            Some(SheetPos::new(2, 2))
        );
    }

    // -------------------------------------------------------------------
    // Test 2: Single cell is invalid
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_range_single_cell_returns_none() {
        let (storage, sid, mut grid) = storage_with_sheet();
        let result =
            merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 5, 5, 5, 5).unwrap();
        assert!(result.is_none());
    }

    // -------------------------------------------------------------------
    // Test 3: Invalid range (start > end)
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_range_invalid_range() {
        let (storage, sid, mut grid) = storage_with_sheet();
        assert!(
            merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 5, 0, 3, 0,)
                .unwrap()
                .is_none()
        );
        assert!(
            merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 5, 0, 3,)
                .unwrap()
                .is_none()
        );
    }

    // -------------------------------------------------------------------
    // Test 4: Overlapping merge rejected
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_range_overlap_rejected() {
        let (storage, sid, mut grid) = storage_with_sheet();
        let r1 = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 2).unwrap();
        assert!(r1.is_some());

        // Overlapping merge should be rejected
        let r2 = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 1, 1, 3, 3).unwrap();
        assert!(r2.is_none());
    }

    // -------------------------------------------------------------------
    // Test 5: Non-overlapping merges succeed
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_range_non_overlapping() {
        let (storage, sid, mut grid) = storage_with_sheet();
        let r1 = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();
        assert!(r1.is_some());

        let r2 = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 3, 1, 4).unwrap();
        assert!(r2.is_some());

        let r3 = merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 3, 0, 4, 1).unwrap();
        assert!(r3.is_some());

        let all = get_all_merges(storage.doc(), storage.sheets(), sid, &grid);
        assert_eq!(all.len(), 3);
    }

    // -------------------------------------------------------------------
    // Test 6: get_all_merges resolution
    // -------------------------------------------------------------------

    #[test]
    fn test_get_all_merges_resolves_positions() {
        let (storage, sid, mut grid) = storage_with_sheet();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 2, 3, 5, 6).unwrap();

        let all = get_all_merges(storage.doc(), storage.sheets(), sid, &grid);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].start_row, 2);
        assert_eq!(all[0].start_col, 3);
        assert_eq!(all[0].end_row, 5);
        assert_eq!(all[0].end_col, 6);
        assert_eq!(all[0].row_span(), 4);
        assert_eq!(all[0].col_span(), 4);
    }

    // -------------------------------------------------------------------
    // Test 7: unmerge_range removes by origin
    // -------------------------------------------------------------------

    #[test]
    fn test_unmerge_range() {
        let (storage, sid, mut grid) = storage_with_sheet();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 2).unwrap();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 5, 5, 7, 7).unwrap();
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            2
        );

        // Unmerge the first merge (origin at 0,0)
        let removed = unmerge_range(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 2, 2);
        assert_eq!(removed, 1);
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            1
        );

        // The remaining merge is the one at 5,5
        let remaining = get_all_merges(storage.doc(), storage.sheets(), sid, &grid);
        assert_eq!(remaining[0].start_row, 5);
    }

    #[test]
    fn test_merge_range_discards_non_origin_values_on_explicit_unmerge() {
        let (storage, sid, mut grid) = storage_with_sheet();
        seed_cell_value(&storage, &mut grid, sid, 0, 0, "Keep");
        seed_cell_value(&storage, &mut grid, sid, 0, 1, "Drop1");
        seed_cell_value(&storage, &mut grid, sid, 1, 0, "Drop2");
        seed_cell_value(&storage, &mut grid, sid, 1, 1, "Drop3");

        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();

        assert_eq!(
            stored_cell_value(&storage, &grid, sid, 0, 0).as_deref(),
            Some("Keep")
        );
        assert_eq!(stored_cell_value(&storage, &grid, sid, 0, 1), None);
        assert_eq!(stored_cell_value(&storage, &grid, sid, 1, 0), None);
        assert_eq!(stored_cell_value(&storage, &grid, sid, 1, 1), None);

        let removed = unmerge_range(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 1, 1);
        assert_eq!(removed, 1);

        assert_eq!(
            stored_cell_value(&storage, &grid, sid, 0, 0).as_deref(),
            Some("Keep")
        );
        assert_eq!(stored_cell_value(&storage, &grid, sid, 0, 1), None);
        assert_eq!(stored_cell_value(&storage, &grid, sid, 1, 0), None);
        assert_eq!(stored_cell_value(&storage, &grid, sid, 1, 1), None);
    }

    // -------------------------------------------------------------------
    // Test 8: merge_across
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_across() {
        let (storage, sid, mut grid) = storage_with_sheet();
        let results = merge_across(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 3);
        assert_eq!(results.len(), 3);

        let all = get_all_merges(storage.doc(), storage.sheets(), sid, &grid);
        assert_eq!(all.len(), 3);

        // Each merge should span one row and 4 columns
        for m in &all {
            assert_eq!(m.row_span(), 1);
            assert_eq!(m.col_span(), 4);
        }
    }

    // -------------------------------------------------------------------
    // Test 9: merge_across with single column returns empty
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_across_single_column() {
        let (storage, sid, mut grid) = storage_with_sheet();
        let results = merge_across(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 0);
        assert!(results.is_empty());
    }

    // -------------------------------------------------------------------
    // Test 10: merge_and_center unmerges then merges
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_and_center() {
        let (storage, sid, mut grid) = storage_with_sheet();
        // Create an initial merge
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            1
        );

        // merge_and_center over a bigger range that includes the existing merge
        let result = merge_and_center(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 3, 3);
        assert!(result.is_ok());
        assert!(result.unwrap().is_some());

        // Should have exactly 1 merge now (the new one)
        let all = get_all_merges(storage.doc(), storage.sheets(), sid, &grid);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].end_row, 3);
        assert_eq!(all[0].end_col, 3);
    }

    // -------------------------------------------------------------------
    // Test 11: get_merge_for_cell
    // -------------------------------------------------------------------

    #[test]
    fn test_get_merge_for_cell() {
        let (storage, sid, mut grid) = storage_with_sheet();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 2, 3, 5, 6).unwrap();

        // Origin cell
        let info = get_merge_for_cell(storage.doc(), storage.sheets(), sid, &grid, 2, 3);
        assert!(info.is_some());
        assert!(info.unwrap().is_origin);

        // Interior cell
        let info = get_merge_for_cell(storage.doc(), storage.sheets(), sid, &grid, 4, 5);
        assert!(info.is_some());
        assert!(!info.unwrap().is_origin);

        // Outside cell
        let info = get_merge_for_cell(storage.doc(), storage.sheets(), sid, &grid, 0, 0);
        assert!(info.is_none());
    }

    // -------------------------------------------------------------------
    // Test 12: is_merge_origin
    // -------------------------------------------------------------------

    #[test]
    fn test_is_merge_origin() {
        let (storage, sid, mut grid) = storage_with_sheet();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 1, 1, 3, 3).unwrap();

        assert!(is_merge_origin(
            storage.doc(),
            storage.sheets(),
            sid,
            &grid,
            1,
            1
        ));
        assert!(!is_merge_origin(
            storage.doc(),
            storage.sheets(),
            sid,
            &grid,
            2,
            2
        ));
        assert!(!is_merge_origin(
            storage.doc(),
            storage.sheets(),
            sid,
            &grid,
            0,
            0
        ));
    }

    // -------------------------------------------------------------------
    // Test 13: clear_all_merges
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_all_merges() {
        let (storage, sid, mut grid) = storage_with_sheet();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 3, 3, 4, 4).unwrap();
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            2
        );

        clear_all_merges(storage.doc(), storage.sheets(), sid);
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            0
        );
    }

    // -------------------------------------------------------------------
    // Test 14: clear_all_merges on empty sheet is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_all_merges_empty() {
        let (storage, sid, grid) = storage_with_sheet();
        // Should not panic
        clear_all_merges(storage.doc(), storage.sheets(), sid);
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            0
        );
    }

    // -------------------------------------------------------------------
    // Test 15: get_merges_in_range
    // -------------------------------------------------------------------

    #[test]
    fn test_get_merges_in_range() {
        let (storage, sid, mut grid) = storage_with_sheet();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 2).unwrap();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 5, 5, 7, 7).unwrap();
        merge_range(
            storage.doc(),
            storage.sheets(),
            sid,
            &mut grid,
            10,
            10,
            12,
            12,
        )
        .unwrap();

        // Range overlaps with first two merges
        let in_range = get_merges_in_range(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 6, 6);
        assert_eq!(in_range.len(), 2);

        // Range overlaps with only the last merge
        let in_range2 =
            get_merges_in_range(storage.doc(), storage.sheets(), sid, &grid, 9, 9, 15, 15);
        assert_eq!(in_range2.len(), 1);

        // Range overlaps with nothing
        let in_range3 =
            get_merges_in_range(storage.doc(), storage.sheets(), sid, &grid, 20, 20, 25, 25);
        assert_eq!(in_range3.len(), 0);
    }

    // -------------------------------------------------------------------
    // Test 16: get_merges_in_viewport (delegates to get_merges_in_range)
    // -------------------------------------------------------------------

    #[test]
    fn test_get_merges_in_viewport() {
        let (storage, sid, mut grid) = storage_with_sheet();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 3, 3).unwrap();

        let in_vp =
            get_merges_in_viewport(storage.doc(), storage.sheets(), sid, &grid, 1, 1, 10, 10);
        assert_eq!(in_vp.len(), 1);

        let in_vp_empty =
            get_merges_in_viewport(storage.doc(), storage.sheets(), sid, &grid, 5, 5, 10, 10);
        assert_eq!(in_vp_empty.len(), 0);
    }

    // -------------------------------------------------------------------
    // Test 17: check_merge_data_loss
    // -------------------------------------------------------------------

    #[test]
    fn test_check_merge_data_loss() {
        let (storage, sid, mut grid) = storage_with_sheet();

        // Seed some data into cells that would be cleared
        seed_cell_value(&storage, &mut grid, sid, 0, 1, "Hello");
        seed_cell_value(&storage, &mut grid, sid, 1, 0, "World");

        let (has_loss, count) =
            check_merge_data_loss(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 1, 1);
        assert!(has_loss);
        assert_eq!(count, 2);
    }

    // -------------------------------------------------------------------
    // Test 18: check_merge_data_loss with no data
    // -------------------------------------------------------------------

    #[test]
    fn test_check_merge_data_loss_no_data() {
        let (storage, sid, grid) = storage_with_sheet();
        let (has_loss, count) =
            check_merge_data_loss(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 1, 1);
        assert!(!has_loss);
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // Test 19: validate_and_clean_merges
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_and_clean_merges_removes_invalid() {
        let (storage, sid, mut grid) = storage_with_sheet();
        let sheet_hex = id_to_hex(sid.as_u128());

        // Create a valid merge
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();

        // Manually insert an invalid merge (CellIds not in GridIndex, no inline positions)
        {
            let mut txn = storage.doc().transact_mut();
            if let Some(mm) = get_merges_map(&txn, &storage.sheets_ref(), &sheet_hex) {
                // Omit sr/sc/er/ec so resolve_merge_from_stored fails,
                // and fake cell IDs so resolve_merge_entry also fails.
                let raw_json = r#"{"topLeftId":"deadbeef00000000deadbeef00000001","bottomRightId":"deadbeef00000000deadbeef00000002"}"#;
                mm.insert(
                    &mut txn,
                    "deadbeef00000000deadbeef00000001",
                    Any::String(Arc::from(raw_json)),
                );
            }
        }

        // We should have 2 entries in the merges map now
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            1
        ); // only 1 resolves

        let removed = validate_and_clean_merges(storage.doc(), storage.sheets(), sid, &grid);
        assert_eq!(removed, 1);

        // Only the valid merge remains
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            1
        );
    }

    // -------------------------------------------------------------------
    // Test 20: validate_and_clean_merges with all valid
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_and_clean_merges_all_valid() {
        let (storage, sid, mut grid) = storage_with_sheet();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 1, 1).unwrap();
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 3, 3, 4, 4).unwrap();

        let removed = validate_and_clean_merges(storage.doc(), storage.sheets(), sid, &grid);
        assert_eq!(removed, 0);
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            2
        );
    }

    // -------------------------------------------------------------------
    // Test 21: merge_range on nonexistent sheet returns error
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_range_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let fake_sheet = make_sheet_id(999);
        let mut grid = GridIndex::new(fake_sheet, 10, 10, Arc::new(cell_types::IdAllocator::new()));
        let result = merge_range(
            storage.doc(),
            storage.sheets(),
            fake_sheet,
            &mut grid,
            0,
            0,
            1,
            1,
        );
        assert!(result.is_err());
        match result.unwrap_err() {
            ComputeError::SheetNotFound { .. } => {}
            other => panic!("Expected SheetNotFound, got {:?}", other),
        }
    }

    // -------------------------------------------------------------------
    // Test 22: unmerge on empty sheet returns 0
    // -------------------------------------------------------------------

    #[test]
    fn test_unmerge_empty() {
        let (storage, sid, grid) = storage_with_sheet();
        let removed = unmerge_range(storage.doc(), storage.sheets(), sid, &grid, 0, 0, 10, 10);
        assert_eq!(removed, 0);
    }

    // -------------------------------------------------------------------
    // Test 23: serde roundtrip for IdentityMergedRegion
    // -------------------------------------------------------------------

    #[test]
    fn test_stored_merge_serde_roundtrip() {
        let stored = StoredMerge {
            top_left_id: "aabb0000aabb0000aabb0000aabb0001".to_string(),
            bottom_right_id: "aabb0000aabb0000aabb0000aabb0002".to_string(),
            ord: Some(0),
            sr: 0,
            sc: 0,
            er: 2,
            ec: 2,
        };
        let json = serialize_merge(&stored);
        // StoredMerge JSON is backward-compatible with IdentityMergedRegion deserialization
        let parsed: StoredMerge = serde_json::from_str(&json).unwrap();
        assert_eq!(stored.top_left_id, parsed.top_left_id);
        assert_eq!(stored.bottom_right_id, parsed.bottom_right_id);
        assert_eq!(stored.ord, parsed.ord);

        // Also verify backward compat: IdentityMergedRegion can still deserialize from StoredMerge JSON
        let identity: IdentityMergedRegion = serde_json::from_str(&json).unwrap();
        assert_eq!(stored.top_left_id, identity.top_left_id);
        assert_eq!(stored.bottom_right_id, identity.bottom_right_id);
    }

    // -------------------------------------------------------------------
    // Test 23b: old IdentityMergedRegion JSON deserializes as StoredMerge
    // -------------------------------------------------------------------

    #[test]
    fn test_old_identity_json_deserializes_as_stored_merge() {
        // This is the JSON format written by the old runtime CRUD path (no `ord` field)
        let old_json =
            r#"{"topLeftId":"aabb0001","bottomRightId":"ccdd0002","sr":0,"sc":0,"er":1,"ec":1}"#;
        let parsed: StoredMerge = serde_json::from_str(old_json).unwrap();
        assert_eq!(parsed.top_left_id, "aabb0001");
        assert_eq!(parsed.bottom_right_id, "ccdd0002");
        assert_eq!(parsed.ord, None); // missing field defaults to None
        assert_eq!(parsed.sr, 0);
        assert_eq!(parsed.sc, 0);
        assert_eq!(parsed.er, 1);
        assert_eq!(parsed.ec, 1);
    }

    // -------------------------------------------------------------------
    // Test 24: ranges_overlap helper
    // -------------------------------------------------------------------

    #[test]
    fn test_ranges_overlap() {
        // Overlapping
        assert!(ranges_overlap(0, 0, 2, 2, 1, 1, 3, 3));
        // Edge-touching
        assert!(ranges_overlap(0, 0, 2, 2, 2, 2, 4, 4));
        // Non-overlapping
        assert!(!ranges_overlap(0, 0, 2, 2, 3, 3, 5, 5));
        assert!(!ranges_overlap(0, 0, 2, 2, 0, 3, 2, 5));
    }

    // -------------------------------------------------------------------
    // Test 25: nonexistent sheet returns empty for queries
    // -------------------------------------------------------------------

    #[test]
    fn test_nonexistent_sheet_returns_empty() {
        let storage = YrsStorage::new();
        let fake = make_sheet_id(999);
        let grid = GridIndex::new(fake, 10, 10, Arc::new(cell_types::IdAllocator::new()));

        assert!(get_all_merges(storage.doc(), storage.sheets(), fake, &grid).is_empty());
        assert!(
            get_merges_in_range(storage.doc(), storage.sheets(), fake, &grid, 0, 0, 10, 10)
                .is_empty()
        );
        assert!(get_merge_for_cell(storage.doc(), storage.sheets(), fake, &grid, 0, 0).is_none());
        assert!(!is_merge_origin(
            storage.doc(),
            storage.sheets(),
            fake,
            &grid,
            0,
            0
        ));
    }

    // -------------------------------------------------------------------
    // Test 26: merge_across with overlapping existing merge skips rows
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_across_skips_overlapping_rows() {
        let (storage, sid, mut grid) = storage_with_sheet();
        // Create a merge that blocks row 1
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 1, 0, 1, 3).unwrap();

        // merge_across rows 0-2, cols 0-3
        let results = merge_across(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 3);
        // Row 1 should be skipped (already merged), rows 0 and 2 succeed
        assert_eq!(results.len(), 2);
    }

    // -------------------------------------------------------------------
    // Test 27: unmerge only affects merges with origin inside range
    // -------------------------------------------------------------------

    #[test]
    fn test_unmerge_only_origin_inside() {
        let (storage, sid, mut grid) = storage_with_sheet();
        // Merge A: origin at (0,0), extends to (2,2)
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 2, 2).unwrap();
        // Merge B: origin at (5,0), extends to (7,2)
        merge_range(storage.doc(), storage.sheets(), sid, &mut grid, 5, 0, 7, 2).unwrap();

        // Unmerge range that covers bottom part of A but not its origin
        let removed = unmerge_range(storage.doc(), storage.sheets(), sid, &grid, 1, 0, 4, 2);
        assert_eq!(removed, 0); // origin at (0,0) is not in [1..4, 0..2]

        // Both merges still exist
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            2
        );
    }

    // -------------------------------------------------------------------
    // Test 28: multiple merge_and_center calls
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_and_center_idempotent() {
        let (storage, sid, mut grid) = storage_with_sheet();
        merge_and_center(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 3, 3).unwrap();
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            1
        );

        // Calling again with same range should still result in 1 merge
        merge_and_center(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0, 3, 3).unwrap();
        assert_eq!(
            get_all_merges(storage.doc(), storage.sheets(), sid, &grid).len(),
            1
        );
    }
}
