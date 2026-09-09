use std::collections::HashSet;

use crate::cells::CellStore;
use crate::storage::WorkbookStorage;
use cell_types::{CellId, RangePos, SheetId};

/// Clear properties for resolved cell identities. Values and formulas are cleared
/// by the compute mutation that calls this helper.
pub fn clear_cells_by_hex(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    cell_hexes: &[String],
    clear_properties: bool,
) {
    if clear_properties {
        for hex in cell_hexes {
            crate::storage::properties::clear_properties(storage, &sheet_id, hex);
        }
    }
}

/// Clear all cells in a range and return their CellIds.
///
/// Clears sparse metadata; the compute caller clears values and unbinds identities.
///
/// `exclude` is an optional set of CellIds to skip (for overlapping
/// moves — the relocation path uses this to avoid wiping cells that are
/// about to be re-registered at target positions).
pub fn clear_range_and_return_ids(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    cells: &CellStore,
    range: &RangePos,
    exclude: Option<&HashSet<CellId>>,
) -> Vec<CellId> {
    // Snapshot matching CellIds before mutating the grid. `cells_in_range`
    // yields `(CellId, row, col)` — we only need the id here.
    let targets: Vec<CellId> = cells
        .cells_in_range(
            &sheet_id,
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

    clear_metadata_for_cell_ids(storage, sheet_id, &targets);
    targets
}

/// Remove metadata for structurally deleted identities, retaining history inverses.
pub(crate) fn clear_metadata_for_cell_ids(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    cell_ids: &[CellId],
) {
    if cell_ids.is_empty() {
        return;
    }

    let target_set: HashSet<CellId> = cell_ids.iter().copied().collect();
    crate::storage::engine::history::metadata::capture_pruned_cell_metadata(
        storage,
        sheet_id,
        |id| target_set.contains(&id),
    );
    if storage.history.is_active() {
        for &id in cell_ids {
            if storage
                .sheet_metadata
                .get(&sheet_id)
                .is_some_and(|sheet| sheet.cell_properties.contains_key(&id))
            {
                crate::storage::engine::history::metadata::capture_cell_properties(
                    storage, sheet_id, id,
                );
            }
        }
    }
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, sheet_id, hyperlinks);
    if let Some(sheet) = storage.sheet_metadata.get_mut(&sheet_id) {
        for id in cell_ids {
            sheet.cell_properties.remove(id);
        }
    }
    for id in cell_ids {
        storage.clear_cell_metadata(*id);
    }

    if let Some(sheet) = storage.sheet_metadata.get_mut(&sheet_id) {
        sheet.hyperlinks.retain(|link| {
            !target_set.contains(&link.start_id)
                && link.end_id.is_none_or(|id| !target_set.contains(&id))
        });
        sheet.comments.retain(|comment| {
            comment
                .cell_ref
                .cell()
                .is_none_or(|id| !target_set.contains(&id))
        });
        for (id, annotation) in &mut sheet.cell_annotations {
            if target_set.contains(id) {
                annotation.status = crate::engine_types::AnnotationStatus::Stale;
                annotation.stale_reason = Some("anchorMissing".into());
                annotation.checked_at = None;
            }
        }
    }
}
