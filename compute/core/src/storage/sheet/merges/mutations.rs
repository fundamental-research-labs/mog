use crate::storage::cells::values::write_cell_position_to_yrs;
use crate::storage::infra::grid_helpers::get_cells_map;

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::KEY_VALUE;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use super::codec::{StoredMerge, stored_merge_to_yrs_prelim};
use super::resolve::{ranges_overlap, resolve_merge_entry};
use super::yrs_io::{get_merge_backups_map, get_merges_map};
use domain_types::domain::merge::IdentityMergedRegion;

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
    let backups_map = get_merge_backups_map(&txn, sheets, &sheet_hex);

    let count = to_remove.len() as u32;
    for key in &to_remove {
        merges_map.remove(&mut txn, key.as_str());

        if let Some(backups) = &backups_map {
            backups.remove(&mut txn, key.as_str());
        }
    }
    count
}

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
