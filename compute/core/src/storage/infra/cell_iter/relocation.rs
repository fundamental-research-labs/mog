use std::collections::HashSet;

use crate::cells::CellStore;
use crate::storage::WorkbookStorage;

use super::clear::clear_range_and_return_ids;
use super::types::RelocationResult;
use cell_types::{CellId, RangePos, SheetId};

/// Transfer metadata for a relocation and report the source/target identities.
/// The compute caller moves values and identity bindings together after clearing targets.
#[allow(clippy::too_many_arguments)]
pub fn relocate_cells(
    storage: &mut WorkbookStorage,
    source_sheet: SheetId,
    source_range: &RangePos,
    target_sheet: SheetId,
    target_start_row: u32,
    target_start_col: u32,
    cells: &CellStore,
) -> RelocationResult {
    let same_sheet = source_sheet == target_sheet;
    // --- 1. Snapshot source cells (CellId + original position) ---
    let source_cells: Vec<(CellId, u32, u32)> = cells
        .cells_in_range(
            &source_sheet,
            source_range.start_row(),
            source_range.start_col(),
            source_range.end_row(),
            source_range.end_col(),
        )
        .collect();

    if source_cells.is_empty() {
        return RelocationResult {
            moved_cell_ids: vec![],
            source_positions_vacated: vec![],
            target_cells_cleared: vec![],
            success: true,
            error: None,
        };
    }

    // --- 2. Calculate deltas ---
    let row_delta = target_start_row as i64 - source_range.start_row() as i64;
    let col_delta = target_start_col as i64 - source_range.start_col() as i64;

    // --- 3. Build set of moving CellIds for exclude ---
    let moving_ids: HashSet<CellId> = source_cells.iter().map(|(id, _, _)| *id).collect();

    // --- 4. Clear target range (excluding cells being moved) ---
    let target_range = RangePos::new(
        target_sheet,
        target_start_row,
        target_start_col,
        (source_range.end_row() as i64 + row_delta) as u32,
        (source_range.end_col() as i64 + col_delta) as u32,
    );

    let cleared = clear_range_and_return_ids(
        storage,
        target_sheet,
        cells,
        &target_range,
        Some(&moving_ids),
    );

    // --- 5. Apply moves ---
    // Move properties with the identity across worksheets.
    if !same_sheet {
        if storage.history.is_active() {
            for &(id, _, _) in &source_cells {
                crate::storage::engine::history::metadata::capture_cell_properties(
                    storage,
                    source_sheet,
                    id,
                );
                crate::storage::engine::history::metadata::capture_cell_properties(
                    storage,
                    target_sheet,
                    id,
                );
            }
        }
        crate::storage::engine::history::metadata::capture_sheet_field!(
            storage,
            source_sheet,
            hyperlinks
        );
        crate::storage::engine::history::metadata::capture_sheet_field!(
            storage,
            target_sheet,
            hyperlinks
        );
        let mut links = Vec::new();
        if let Some(sheet) = storage.sheet_metadata.get_mut(&source_sheet) {
            sheet.hyperlinks = std::mem::take(&mut sheet.hyperlinks)
                .into_iter()
                .filter_map(|link| {
                    let start_moves = moving_ids.contains(&link.start_id);
                    let end_moves = link.end_id.is_none_or(|id| moving_ids.contains(&id));
                    if start_moves && end_moves {
                        links.push(link);
                        None
                    } else if start_moves || link.end_id.is_some_and(|id| moving_ids.contains(&id))
                    {
                        None
                    } else {
                        Some(link)
                    }
                })
                .collect();
        }
        if let Some(sheet) = storage.sheet_metadata.get_mut(&target_sheet) {
            sheet.hyperlinks.extend(links);
        }
        let properties: Vec<_> = storage
            .sheet_metadata
            .get_mut(&source_sheet)
            .into_iter()
            .flat_map(|sheet| {
                source_cells
                    .iter()
                    .filter_map(|(id, _, _)| {
                        sheet.cell_properties.remove(id).map(|props| (*id, props))
                    })
                    .collect::<Vec<_>>()
            })
            .collect();
        if let Some(sheet) = storage.sheet_metadata.get_mut(&target_sheet) {
            sheet.cell_properties.extend(properties);
        }
    }

    let moved_ids: Vec<CellId> = source_cells.iter().map(|(id, _, _)| *id).collect();
    let source_positions_vacated: Vec<(u32, u32)> =
        source_cells.iter().map(|(_, r, c)| (*r, *c)).collect();

    RelocationResult {
        moved_cell_ids: moved_ids,
        source_positions_vacated,
        target_cells_cleared: cleared,
        success: true,
        error: None,
    }
}
