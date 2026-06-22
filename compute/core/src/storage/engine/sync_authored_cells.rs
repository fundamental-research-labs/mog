use std::collections::{HashMap, HashSet};

use cell_types::{CellId, SheetId};
use value_types::CellValue;

use crate::mirror::{CellEntry, CellMirror, MirrorPositionLookup};
use crate::scheduler::ComputeCore;
use crate::snapshot::{CellChange, CellPosition};

type AuthoredCellKey = (SheetId, CellId);

#[derive(Clone, Debug)]
pub(super) struct AuthoredCellSnapshot {
    sheet_ids: HashSet<SheetId>,
    cells: HashMap<AuthoredCellKey, AuthoredCellState>,
}

#[derive(Clone, Debug)]
struct AuthoredCellState {
    sheet_id: SheetId,
    cell_id: CellId,
    position: CellPosition,
    value: CellValue,
    formula: Option<String>,
}

pub(super) fn snapshot_authored_cells(
    mirror: &CellMirror,
    compute: &ComputeCore,
) -> AuthoredCellSnapshot {
    let sheet_ids: HashSet<_> = mirror.sheet_ids().copied().collect();
    let mut cells = HashMap::new();

    for sheet_id in &sheet_ids {
        let Some(sheet) = mirror.get_sheet(sheet_id) else {
            continue;
        };

        for (cell_id, entry) in sheet.cells_iter() {
            if cell_id.is_virtual() {
                continue;
            }

            let formula = authored_formula_text(mirror, compute, *sheet_id, cell_id, entry);
            if entry.value.is_null() && formula.is_none() {
                continue;
            }

            let Some(pos) = sheet.position_of(cell_id) else {
                continue;
            };

            cells.insert(
                (*sheet_id, *cell_id),
                AuthoredCellState {
                    sheet_id: *sheet_id,
                    cell_id: *cell_id,
                    position: CellPosition {
                        row: pos.row(),
                        col: pos.col(),
                    },
                    value: entry.value.clone(),
                    formula,
                },
            );
        }
    }

    AuthoredCellSnapshot { sheet_ids, cells }
}

pub(super) fn diff_authored_cell_changes(
    before: &AuthoredCellSnapshot,
    after: &AuthoredCellSnapshot,
) -> Vec<CellChange> {
    let mut keys: Vec<_> = before
        .cells
        .keys()
        .chain(after.cells.keys())
        .copied()
        .collect();
    keys.sort_by_key(|(sheet_id, cell_id)| (sheet_id.as_u128(), cell_id.as_u128()));
    keys.dedup();

    let mut changes = Vec::new();
    for key in keys {
        match (before.cells.get(&key), after.cells.get(&key)) {
            (None, Some(new_state)) => {
                changes.push(cell_change(None, Some(new_state)));
            }
            (Some(old_state), None) => {
                if after.sheet_ids.contains(&old_state.sheet_id) {
                    changes.push(cell_change(Some(old_state), None));
                }
            }
            (Some(old_state), Some(new_state))
                if authored_content_changed(old_state, new_state) =>
            {
                changes.push(cell_change(Some(old_state), Some(new_state)));
            }
            _ => {}
        }
    }

    changes
}

fn authored_formula_text(
    mirror: &CellMirror,
    compute: &ComputeCore,
    sheet_id: SheetId,
    cell_id: &CellId,
    entry: &CellEntry,
) -> Option<String> {
    compute.get_formula(cell_id).map(str::to_owned).or_else(|| {
        entry.formula.as_deref().map(|formula| {
            let lookup = MirrorPositionLookup::new(mirror, sheet_id);
            compute_parser::to_a1_string(formula, &lookup)
        })
    })
}

fn authored_content_changed(before: &AuthoredCellState, after: &AuthoredCellState) -> bool {
    if before.formula != after.formula {
        return true;
    }

    before.formula.is_none() && before.value != after.value
}

fn cell_change(
    before: Option<&AuthoredCellState>,
    after: Option<&AuthoredCellState>,
) -> CellChange {
    let state = after
        .or(before)
        .expect("authored change has at least one side");
    CellChange {
        cell_id: state.cell_id.to_uuid_string(),
        sheet_id: state.sheet_id.to_uuid_string(),
        position: Some(state.position.clone()),
        value: after
            .map(|state| state.value.clone())
            .unwrap_or(CellValue::Null),
        display_text: None,
        old_display_text: None,
        old_formula: before.and_then(|state| state.formula.clone()),
        new_formula: after.and_then(|state| state.formula.clone()),
        number_format: None,
        format_idx: None,
        extra_flags: 0,
        old_value: Some(
            before
                .map(|state| state.value.clone())
                .unwrap_or(CellValue::Null),
        ),
    }
}
