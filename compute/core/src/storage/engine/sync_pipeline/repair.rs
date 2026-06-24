use std::collections::HashSet;

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_CELLS, KEY_GRID_ID_TO_POS, KEY_GRID_INDEX, KEY_GRID_POS_TO_ID};
use compute_document::undo::ORIGIN_REMOTE;
use value_types::ComputeError;
use yrs::{Any, Map, Origin, Out, Transact};

use crate::storage::YrsStorage;
use crate::storage::engine::{YrsComputeEngine, construction};

pub(super) fn repair_orphaned_cell_bindings_after_sync(
    engine: &YrsComputeEngine,
) -> Result<(), ComputeError> {
    let mut orphaned = HashSet::new();

    for sheet_id in engine.stores.storage.sheet_order() {
        let Some(axes) =
            construction::resolve_sheet_axes_from_yrs(&engine.stores.storage, sheet_id)?
        else {
            continue;
        };
        let axis_grid = axes.into_grid(sheet_id, engine.stores.grid_id_alloc.clone());

        for (pos_key, cell_hex) in collect_grid_position_bindings(&engine.stores.storage, sheet_id)
        {
            let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
                continue;
            };
            if axis_grid.row_index_from_hex(row_hex).is_none()
                || axis_grid.col_index_from_hex(col_hex).is_none()
            {
                orphaned.insert((sheet_id, pos_key, cell_hex));
            }
        }
    }

    if orphaned.is_empty() {
        return Ok(());
    }

    let doc = engine.stores.storage.doc();
    let sheets = engine.stores.storage.sheets();
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_REMOTE));

    for (sheet_id, pos_key, cell_hex) in orphaned {
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

    Ok(())
}

fn collect_grid_position_bindings(
    storage: &YrsStorage,
    sheet_id: SheetId,
) -> Vec<(String, String)> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let Some(Out::YMap(sheet_map)) = storage.sheets().get(&txn, sheet_hex.as_ref()) else {
        return Vec::new();
    };
    let Some(Out::YMap(grid_index)) = sheet_map.get(&txn, KEY_GRID_INDEX) else {
        return Vec::new();
    };

    let mut bindings = Vec::new();
    if let Some(Out::YMap(pos_to_id)) = grid_index.get(&txn, KEY_GRID_POS_TO_ID) {
        bindings.extend(
            pos_to_id
                .iter(&txn)
                .filter_map(|(pos_key, value)| match value {
                    Out::Any(Any::String(cell_hex)) => {
                        Some((pos_key.to_string(), cell_hex.to_string()))
                    }
                    _ => None,
                }),
        );
    }

    if let Some(Out::YMap(id_to_pos)) = grid_index.get(&txn, KEY_GRID_ID_TO_POS) {
        bindings.extend(
            id_to_pos
                .iter(&txn)
                .filter_map(|(cell_hex, value)| match value {
                    Out::Any(Any::String(pos_key)) => {
                        Some((pos_key.to_string(), cell_hex.to_string()))
                    }
                    _ => None,
                }),
        );
    }

    bindings
}
