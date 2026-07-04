use std::{collections::HashSet, sync::Arc};

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::{KEY_CELLS, KEY_GRID_ID_TO_POS, KEY_GRID_INDEX, KEY_GRID_POS_TO_ID};
use compute_document::undo::ORIGIN_REMOTE;
use value_types::ComputeError;
use yrs::{Any, Map, MapRef, Origin, Out, ReadTxn, Transact};

use crate::storage::YrsStorage;
use crate::storage::cells::values::cell_has_identity_backing_metadata;
use crate::storage::engine::{YrsComputeEngine, construction};

pub(super) fn repair_orphaned_cell_bindings_after_sync(
    engine: &YrsComputeEngine,
) -> Result<(), ComputeError> {
    let mut removals = HashSet::new();
    let mut repairs = Vec::new();

    for sheet_id in engine.stores.storage.sheet_order() {
        let Some(axes) =
            construction::resolve_sheet_axes_from_yrs(&engine.stores.storage, sheet_id)?
        else {
            continue;
        };
        let axis_grid = axes.into_grid(sheet_id, engine.stores.grid_id_alloc.clone());

        collect_repairs_for_sheet(
            &engine.stores.storage,
            sheet_id,
            &axis_grid,
            &mut removals,
            &mut repairs,
        );
    }

    if removals.is_empty() && repairs.is_empty() {
        return Ok(());
    }

    let doc = engine.stores.storage.doc();
    let sheets = engine.stores.storage.sheets();
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_REMOTE));

    for Binding {
        sheet_id,
        pos_key,
        cell_hex,
    } in removals
    {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex.as_ref()) else {
            continue;
        };

        if let Some(Out::YMap(grid_index)) = sheet_map.get(&txn, KEY_GRID_INDEX) {
            if let Some(Out::YMap(pos_to_id)) = grid_index.get(&txn, KEY_GRID_POS_TO_ID)
                && matches!(
                    pos_to_id.get(&txn, pos_key.as_str()),
                    Some(Out::Any(Any::String(existing))) if existing.as_ref() == cell_hex
                )
            {
                pos_to_id.remove(&mut txn, pos_key.as_str());
            }

            if let Some(Out::YMap(id_to_pos)) = grid_index.get(&txn, KEY_GRID_ID_TO_POS)
                && matches!(
                    id_to_pos.get(&txn, cell_hex.as_str()),
                    Some(Out::Any(Any::String(existing))) if existing.as_ref() == pos_key
                )
            {
                id_to_pos.remove(&mut txn, cell_hex.as_str());
            }
        }

        if let Some(Out::YMap(cells)) = sheet_map.get(&txn, KEY_CELLS) {
            cells.remove(&mut txn, cell_hex.as_str());
        }
    }

    for Binding {
        sheet_id,
        pos_key,
        cell_hex,
    } in repairs
    {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex.as_ref()) else {
            continue;
        };
        let Some(Out::YMap(grid_index)) = sheet_map.get(&txn, KEY_GRID_INDEX) else {
            continue;
        };
        let Some(Out::YMap(pos_to_id)) = grid_index.get(&txn, KEY_GRID_POS_TO_ID) else {
            continue;
        };
        let cells = match sheet_map.get(&txn, KEY_CELLS) {
            Some(Out::YMap(cells)) => Some(cells),
            _ => None,
        };

        let should_repair = match pos_to_id.get(&txn, pos_key.as_str()) {
            Some(Out::Any(Any::String(existing))) if existing.as_ref() == cell_hex => false,
            Some(Out::Any(Any::String(existing)))
                if cell_identity_exists(
                    cells.as_ref(),
                    &txn,
                    sheets,
                    sheet_hex.as_ref(),
                    existing.as_ref(),
                ) =>
            {
                false
            }
            _ => cell_identity_exists(cells.as_ref(), &txn, sheets, sheet_hex.as_ref(), &cell_hex),
        };

        if should_repair {
            pos_to_id.insert(
                &mut txn,
                pos_key.as_str(),
                Any::String(Arc::from(cell_hex.as_str())),
            );
        }
    }

    Ok(())
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct Binding {
    sheet_id: SheetId,
    pos_key: String,
    cell_hex: String,
}

fn collect_repairs_for_sheet(
    storage: &YrsStorage,
    sheet_id: SheetId,
    axis_grid: &GridIndex,
    removals: &mut HashSet<Binding>,
    repairs: &mut Vec<Binding>,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let Some(Out::YMap(sheet_map)) = storage.sheets().get(&txn, sheet_hex.as_ref()) else {
        return;
    };
    let Some(Out::YMap(grid_index)) = sheet_map.get(&txn, KEY_GRID_INDEX) else {
        return;
    };
    let cells = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(cells)) => Some(cells),
        _ => None,
    };

    if let Some(Out::YMap(pos_to_id)) = grid_index.get(&txn, KEY_GRID_POS_TO_ID) {
        for (pos_key, value) in pos_to_id.iter(&txn) {
            let Out::Any(Any::String(cell_hex)) = value else {
                continue;
            };
            if !position_resolves(axis_grid, pos_key.as_ref())
                || !cell_identity_exists(
                    cells.as_ref(),
                    &txn,
                    storage.sheets(),
                    sheet_hex.as_ref(),
                    cell_hex.as_ref(),
                )
            {
                removals.insert(Binding {
                    sheet_id,
                    pos_key: pos_key.to_string(),
                    cell_hex: cell_hex.to_string(),
                });
            }
        }
    }

    if let Some(Out::YMap(id_to_pos)) = grid_index.get(&txn, KEY_GRID_ID_TO_POS) {
        let pos_to_id = match grid_index.get(&txn, KEY_GRID_POS_TO_ID) {
            Some(Out::YMap(pos_to_id)) => Some(pos_to_id),
            _ => None,
        };
        for (cell_hex, value) in id_to_pos.iter(&txn) {
            let Out::Any(Any::String(pos_key)) = value else {
                continue;
            };
            let cell_hex_str: &str = &cell_hex;
            let pos_key_str: &str = &pos_key;
            let binding = Binding {
                sheet_id,
                pos_key: pos_key_str.to_string(),
                cell_hex: cell_hex_str.to_string(),
            };

            if !position_resolves(axis_grid, pos_key_str)
                || !cell_identity_exists(
                    cells.as_ref(),
                    &txn,
                    storage.sheets(),
                    sheet_hex.as_ref(),
                    cell_hex_str,
                )
            {
                removals.insert(binding);
                continue;
            }

            let needs_repair = match pos_to_id
                .as_ref()
                .and_then(|map| map.get(&txn, pos_key_str))
            {
                Some(Out::Any(Any::String(existing))) if existing.as_ref() == cell_hex_str => false,
                Some(Out::Any(Any::String(existing)))
                    if cell_identity_exists(
                        cells.as_ref(),
                        &txn,
                        storage.sheets(),
                        sheet_hex.as_ref(),
                        existing.as_ref(),
                    ) =>
                {
                    false
                }
                _ => true,
            };

            if needs_repair {
                repairs.push(binding);
            }
        }
    }
}

fn position_resolves(axis_grid: &GridIndex, pos_key: &str) -> bool {
    let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
        return false;
    };
    axis_grid.row_index_from_hex(row_hex).is_some()
        && axis_grid.col_index_from_hex(col_hex).is_some()
}

fn cell_identity_exists<T: ReadTxn>(
    cells: Option<&MapRef>,
    txn: &T,
    sheets: &MapRef,
    sheet_hex: &str,
    cell_hex: &str,
) -> bool {
    cells.is_some_and(|cells| cells.get(txn, cell_hex).is_some())
        || cell_has_identity_backing_metadata(txn, sheets, sheet_hex, cell_hex)
}
