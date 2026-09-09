use std::collections::HashSet;

use crate::storage::WorkbookStorage;
use cell_types::{CellId, RangePos, SheetId};
use compute_document::identity::GridIndex;

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
/// Removes properties and unbinds cell identities
/// them from the GridIndex. Used for structural operations where `#REF!`
/// errors are the correct behavior.
///
/// `exclude` is an optional set of CellIds to skip (for overlapping
/// moves — the relocation path uses this to avoid wiping cells that are
/// about to be re-registered at target positions).
pub fn clear_range_and_return_ids(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    range: &RangePos,
    exclude: Option<&HashSet<CellId>>,
) -> Vec<CellId> {
    // Snapshot matching CellIds before mutating the grid. `cells_in_range`
    // yields `(CellId, row, col)` — we only need the id here.
    let targets: Vec<CellId> = grid
        .cells_in_range(
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

    if targets.is_empty() {
        return Vec::new();
    }

    if storage.history.is_active() {
        for &id in &targets {
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
        for id in &targets {
            sheet.cell_properties.remove(id);
        }
    }
    for id in &targets {
        storage.clear_cell_metadata(*id);
    }

    // Drop identity bindings so these cells no longer resolve at their
    // former positions.
    for cid in &targets {
        grid.remove_cell(cid);
    }
    crate::storage::engine::history::metadata::capture_pruned_axis_metadata(
        storage, sheet_id, grid,
    );
    if let Some(sheet) = storage.sheet_metadata.get_mut(&sheet_id) {
        sheet.hyperlinks.retain(|link| {
            grid.cell_position(&link.start_id).is_some()
                && link
                    .end_id
                    .is_none_or(|id| grid.cell_position(&id).is_some())
        });
        sheet.comments.retain(|comment| {
            comment
                .cell_ref
                .cell()
                .is_none_or(|id| grid.cell_position(&id).is_some())
        });
        for (id, annotation) in &mut sheet.cell_annotations {
            if grid.cell_position(id).is_none() {
                annotation.status = crate::engine_types::AnnotationStatus::Stale;
                annotation.stale_reason = Some("anchorMissing".into());
                annotation.checked_at = None;
            }
        }
    }

    targets
}
