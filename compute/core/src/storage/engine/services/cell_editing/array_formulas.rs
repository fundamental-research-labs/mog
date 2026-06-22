use cell_types::SheetId;
use value_types::{CellValue, ComputeError};
use yrs::{Map, Origin, Out, Transact};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_CELLS;
use compute_document::undo::ORIGIN_USER_EDIT;

use super::{
    a1_range_string, ensure_cell_id_mirrored, persist_cell_formula_identity, write_cell_to_yrs,
};

pub(in crate::storage::engine) fn set_array_formula(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    top_row: u32,
    left_col: u32,
    bottom_row: u32,
    right_col: u32,
    formula: &str,
) -> Result<RecalcResult, ComputeError> {
    if bottom_row < top_row || right_col < left_col {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "set_array_formula: invalid range ({},{})..=({},{})",
                top_row, left_col, bottom_row, right_col
            ),
        });
    }
    // Resolve / mint a CellId for the anchor in both the in-memory
    // grid index and the Yrs `gridIndex/{posToId, idToPos}` mirror.
    // Same path used by metadata writes on empty positions.
    let Some(anchor_id) = ensure_cell_id_mirrored(stores, mirror, sheet_id, top_row, left_col)
    else {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    };

    // Snapshot old anchor value for the change-set patch.
    let old_val = stores
        .compute
        .get_cell_value(mirror, &anchor_id)
        .cloned()
        .or_else(|| mirror.get_cell_value(&anchor_id).cloned())
        .unwrap_or(CellValue::Null);
    let old_formula = stores.compute.get_formula(&anchor_id).map(str::to_owned);

    // Write the formula text to Yrs (suppressed observer, so we own
    // the change-set construction). The body is normalized in the
    // scheduler too, but Yrs storage requires the leading `=`-stripped
    // form via `build_cell_prelim` (which `write_cell_to_yrs` calls).
    let formula_body = formula.trim_start().strip_prefix('=').unwrap_or(formula);

    mutation.observer.set_suppressed(true);
    write_cell_to_yrs(
        stores,
        sheet_id,
        anchor_id,
        top_row,
        left_col,
        &CellValue::Null,
        Some(formula_body),
    );
    mutation.observer.set_suppressed(false);

    mirror.apply_edit(
        sheet_id,
        anchor_id,
        cell_types::SheetPos::new(top_row, left_col),
        CellValue::Null,
        None,
    );

    if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
        grid.register_cell(anchor_id, top_row, left_col);
    }

    let mut result = stores.compute.set_array_formula(
        mirror, sheet_id, anchor_id, top_row, left_col, bottom_row, right_col, formula,
    )?;
    {
        let _guard = mutation.suppress_guard();
        persist_cell_formula_identity(stores, mirror, sheet_id, anchor_id)?;
    }

    // Persist the CSE marker into Yrs so the array-formula brace
    // survives Yrs undo/redo. unified-reference left this runtime-only
    // (mirror.cse_anchors), which meant undoing the CSE entry restored
    // the value but lost the brace — this is the legacy string-rewrite followup.
    //
    // Stored on the anchor cell as `KEY_ARRAY_REF`, mirroring OOXML
    // `<f t="array" ref="A1:C5">`. Hydration paths read this back into
    // `mirror.cse_anchors` + `projection_registry` (snapshot-types
    // already carries `array_ref` on `CellData`).
    {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let anchor_hex = id_to_hex(anchor_id.as_u128());
        let range_a1 = a1_range_string(top_row, left_col, bottom_row, right_col);
        let sheets_map = stores.storage.doc().get_or_insert_map("sheets");
        let mut txn = stores
            .storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex)
            && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
            && let Some(Out::YMap(cell_map)) = cells_map.get(&txn, &anchor_hex)
        {
            compute_document::cell_serde::write_array_ref_to_yrs(&cell_map, &mut txn, &range_a1);
        }
    }

    // Patch before-side fields onto the seed change.
    let cell_id_str = anchor_id.to_uuid_string();
    for change in &mut result.changed_cells {
        if change.cell_id == cell_id_str {
            change.old_value = Some(old_val.clone());
            if change.old_formula.is_none() {
                change.old_formula = old_formula.clone();
            }
        }
    }

    Ok(result)
}
