use std::collections::HashSet;

use cell_types::{ColId, RowId, SheetId};
use compute_document::observe::{AxisOrderAxis, AxisOrderChangeKind, DocumentChanges};
use value_types::ComputeError;

use crate::storage::engine::stores::EngineStores;

pub(super) fn capacity_replay_sheets(
    stores: &EngineStores,
    doc_changes: &DocumentChanges,
) -> HashSet<SheetId> {
    if doc_changes.axis_order.is_empty() || doc_changes.grid_index.is_empty() {
        return HashSet::new();
    }

    let grid_index_sheets: HashSet<SheetId> = doc_changes
        .grid_index
        .iter()
        .map(|change| change.sheet_id)
        .collect();
    let structural_change_sheets: HashSet<SheetId> =
        doc_changes.structural_changes.iter().copied().collect();
    let axis_sheets: HashSet<SheetId> = doc_changes
        .axis_order
        .iter()
        .map(|change| change.sheet_id)
        .collect();

    axis_sheets
        .into_iter()
        .filter(|sheet_id| {
            grid_index_sheets.contains(sheet_id)
                && !structural_change_sheets.contains(sheet_id)
                && has_tail_axis_changes(doc_changes, *sheet_id)
                && doc_changes
                    .axis_order
                    .iter()
                    .filter(|change| change.sheet_id == *sheet_id)
                    .all(|change| {
                        !matches!(change.kind, AxisOrderChangeKind::Structural)
                            && tail_change_matches_current_grid(stores, change)
                    })
        })
        .collect()
}

fn has_tail_axis_changes(doc_changes: &DocumentChanges, sheet_id: SheetId) -> bool {
    let mut has_tail_change = false;
    for change in doc_changes
        .axis_order
        .iter()
        .filter(|change| change.sheet_id == sheet_id)
    {
        if matches!(change.kind, AxisOrderChangeKind::Structural) {
            return false;
        }
        has_tail_change = true;
    }

    has_tail_change
}

fn tail_change_matches_current_grid(
    stores: &EngineStores,
    change: &compute_document::observe::AxisOrderChange,
) -> bool {
    let Some(grid) = stores.grid_indexes.get(&change.sheet_id) else {
        return false;
    };
    let current_len = match change.axis {
        AxisOrderAxis::Row => grid.row_count(),
        AxisOrderAxis::Col => grid.col_count(),
    };

    match &change.kind {
        AxisOrderChangeKind::TailInserted { start, .. } => *start == current_len,
        AxisOrderChangeKind::TailRemoved { start, count } => {
            start.saturating_add(*count) == current_len
        }
        AxisOrderChangeKind::Structural => false,
    }
}

fn decode_axis_id(raw: &str) -> Result<u128, ComputeError> {
    compute_document::hex::hex_to_id(raw).ok_or_else(|| ComputeError::InternalPanic {
        message: format!("invalid axis identity hex in rowOrder/colOrder replay: {raw}"),
    })
}

pub(super) fn apply_tail_inserts(
    stores: &mut EngineStores,
    doc_changes: &DocumentChanges,
    capacity_sheets: &HashSet<SheetId>,
) -> Result<(), ComputeError> {
    if capacity_sheets.is_empty() {
        return Ok(());
    }

    for change in &doc_changes.axis_order {
        if !capacity_sheets.contains(&change.sheet_id) {
            continue;
        }
        let AxisOrderChangeKind::TailInserted { start, ids } = &change.kind else {
            continue;
        };
        let Some(grid) = stores.grid_indexes.get_mut(&change.sheet_id) else {
            continue;
        };
        match change.axis {
            AxisOrderAxis::Row => {
                if grid.row_count() != *start {
                    continue;
                }
                let row_ids: Result<Vec<_>, _> = ids
                    .iter()
                    .map(|id| decode_axis_id(id).map(RowId::from_raw))
                    .collect();
                grid.append_row_ids(row_ids?);
            }
            AxisOrderAxis::Col => {
                if grid.col_count() != *start {
                    continue;
                }
                let col_ids: Result<Vec<_>, _> = ids
                    .iter()
                    .map(|id| decode_axis_id(id).map(ColId::from_raw))
                    .collect();
                grid.append_col_ids(col_ids?);
            }
        }
    }
    Ok(())
}

pub(super) fn apply_tail_removals(
    stores: &mut EngineStores,
    doc_changes: &DocumentChanges,
    capacity_sheets: &HashSet<SheetId>,
) {
    if capacity_sheets.is_empty() {
        return;
    }

    for change in &doc_changes.axis_order {
        if !capacity_sheets.contains(&change.sheet_id) {
            continue;
        }
        let AxisOrderChangeKind::TailRemoved { start, .. } = &change.kind else {
            continue;
        };
        let Some(grid) = stores.grid_indexes.get_mut(&change.sheet_id) else {
            continue;
        };
        match change.axis {
            AxisOrderAxis::Row => grid.truncate_rows(*start),
            AxisOrderAxis::Col => grid.truncate_cols(*start),
        }
    }
}
