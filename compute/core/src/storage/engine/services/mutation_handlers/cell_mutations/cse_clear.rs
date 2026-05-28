use std::collections::{HashMap, HashSet};

use cell_types::{CellId, SheetId};
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;

pub(super) fn collect_materialized_cells_in_range(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<(u32, u32, CellId)> {
    stores
        .grid_indexes
        .get(sheet_id)
        .map(|grid| {
            grid.cells_in_range(start_row, start_col, end_row, end_col)
                .map(|(cell_id, row, col)| (row, col, cell_id))
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn push_resolved_clear_target(
    mirror: &CellMirror,
    resolved: &mut Vec<(u32, u32, CellId)>,
    direct_edit_old_values: &mut HashMap<CellId, CellValue>,
    seen_cell_ids: &mut HashSet<CellId>,
    row: u32,
    col: u32,
    cell_id: CellId,
) {
    if seen_cell_ids.insert(cell_id) {
        let old_val = mirror
            .get_cell_value(&cell_id)
            .cloned()
            .unwrap_or(CellValue::Null);
        direct_edit_old_values.insert(cell_id, old_val);
        resolved.push((row, col, cell_id));
    }
}

fn projection_fully_covered_by_range(
    projection_origin_row: u32,
    projection_origin_col: u32,
    projection_rows: u32,
    projection_cols: u32,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> bool {
    let projection_end_row = projection_origin_row + projection_rows - 1;
    let projection_end_col = projection_origin_col + projection_cols - 1;
    start_row <= projection_origin_row
        && start_col <= projection_origin_col
        && end_row >= projection_end_row
        && end_col >= projection_end_col
}

pub(super) fn cse_anchor_clear_targets_for_range(
    mirror: &CellMirror,
    sheet_id: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<Vec<(u32, u32, CellId)>, ComputeError> {
    let mut anchors = Vec::new();
    let end_row_exclusive = end_row.saturating_add(1);
    let end_col_exclusive = end_col.saturating_add(1);

    for projection in mirror.projection_registry.projections_in_range(
        &sheet_id,
        start_row,
        start_col,
        end_row_exclusive,
        end_col_exclusive,
    ) {
        if !mirror.is_cse_anchor(&projection.source) {
            continue;
        }

        let Some(anchor_pos) = mirror.resolve_position(&projection.source) else {
            continue;
        };

        if !projection_fully_covered_by_range(
            projection.origin_row,
            projection.origin_col,
            projection.rows,
            projection.cols,
            start_row,
            start_col,
            end_row,
            end_col,
        ) {
            let row = start_row.max(projection.origin_row);
            let col = start_col.max(projection.origin_col);
            return Err(ComputeError::PartialArrayWrite {
                sheet_id: sheet_id.to_uuid_string(),
                row,
                col,
                anchor_row: anchor_pos.row(),
                anchor_col: anchor_pos.col(),
            });
        }

        anchors.push((anchor_pos.row(), anchor_pos.col(), projection.source));
    }

    Ok(anchors)
}
