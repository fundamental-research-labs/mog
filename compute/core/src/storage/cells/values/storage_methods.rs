// ---------------------------------------------------------------------------
// Cell read/write methods on YrsStorage (moved from mod.rs)
// ---------------------------------------------------------------------------

use cell_types::{CellId, SheetId, SheetPos};
use compute_document::cell_serde::{
    build_cell_prelim, read_identity_formula_from_yrs, write_identity_formula_to_yrs,
    yrs_any_to_cell_value,
};
use compute_document::undo::ORIGIN_USER_EDIT;
use formula_types::IdentityFormula;

use crate::mirror::CellMirror;
use crate::storage::YrsStorage;
use compute_document::hex::id_to_hex;
use value_types::CellValue;
use yrs::{Array, Map, Origin, Transact};

use super::remove_cell_position_from_yrs;

impl YrsStorage {
    /// Read a cell value directly from the yrs document.
    ///
    /// Returns (value, legacy_formula, identity_formula).
    pub fn read_cell_from_yrs(
        &self,
        sheet_id: &SheetId,
        cell_id: &CellId,
    ) -> Option<(CellValue, Option<String>, Option<IdentityFormula>)> {
        self.read_cell_from_yrs_full(sheet_id, cell_id)
            .map(|(v, f, idf, _ar)| (v, f, idf))
    }

    /// Like [`Self::read_cell_from_yrs`] but also returns the persisted
    /// CSE array-formula range (`KEY_ARRAY_REF`) when present.
    ///
    /// table dependency work T6: CSE markers are persisted into Yrs (anchor cells
    /// carry `KEY_ARRAY_REF = "A1:C5"` style range). Hydration paths
    /// (`build_sheet_snapshot_from_yrs`) call this so undo/redo restores
    /// the array-formula brace, not just the value.
    #[allow(clippy::type_complexity)]
    pub fn read_cell_from_yrs_full(
        &self,
        sheet_id: &SheetId,
        cell_id: &CellId,
    ) -> Option<(
        CellValue,
        Option<String>,
        Option<IdentityFormula>,
        Option<String>,
    )> {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());

        let txn = self.doc.transact();
        let sheet_map = match self.sheets.get(&txn, &sheet_hex) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let cells_map = match sheet_map.get(&txn, compute_document::schema::KEY_CELLS) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let cell_map = match cells_map.get(&txn, &cell_hex) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };

        let value = yrs_any_to_cell_value(&cell_map, &txn);
        let formula = match cell_map.get(&txn, compute_document::schema::KEY_FORMULA) {
            Some(yrs::Out::Any(yrs::Any::String(s))) => {
                let f = s.to_string();
                // KEY_FORMULA stores body only (without '='); re-add it for callers.
                if f.starts_with('=') {
                    Some(f)
                } else {
                    Some(format!("={}", f))
                }
            }
            _ => None,
        };
        let identity_formula = read_identity_formula_from_yrs(&cell_map, &txn);
        let array_ref = compute_document::cell_serde::read_array_ref_from_yrs(&cell_map, &txn);

        Some((value, formula, identity_formula, array_ref))
    }

    /// Read a cell's position from the yrs document.
    ///
    /// Reads `gridIndex/idToPos` (the authoritative yrs-side identity
    /// store post-GridIndex migration), decomposes the `"rowHex:colHex"` value, and
    /// resolves the row/column indices via the `rowOrder` / `colOrder`
    /// YArrays. Returns `None` when the mapping is absent (cell never
    /// written, or written before the yrs-side mirror was introduced).
    ///
    /// Used by observer-driven paths (`apply_cell_changes`) during
    /// undo/redo when the in-memory `GridIndex` has been cleared and
    /// must be re-populated from yrs.
    pub fn read_cell_position_from_yrs(
        &self,
        sheet_id: &SheetId,
        cell_id: &CellId,
    ) -> Option<SheetPos> {
        use crate::storage::infra::grid_helpers;
        use compute_document::schema::KEY_GRID_INDEX;

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());
        let txn = self.doc.transact();

        let sheet_map = match self.sheets.get(&txn, &sheet_hex) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let gi_map = match sheet_map.get(&txn, KEY_GRID_INDEX) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let id_to_pos = match gi_map.get(&txn, "idToPos") {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let pos_key = match id_to_pos.get(&txn, &cell_hex) {
            Some(yrs::Out::Any(yrs::Any::String(s))) => s.to_string(),
            _ => return None,
        };
        let (row_hex, col_hex) = pos_key.split_once(':')?;

        // Resolve row/col indices via rowOrder / colOrder arrays.
        let row_arr = grid_helpers::get_row_order_array(&sheet_map, &txn)?;
        let col_arr = grid_helpers::get_col_order_array(&sheet_map, &txn)?;
        let mut row_idx: Option<u32> = None;
        for i in 0..row_arr.len(&txn) {
            if let Some(yrs::Out::Any(yrs::Any::String(s))) = row_arr.get(&txn, i)
                && s.as_ref() == row_hex
            {
                row_idx = Some(i);
                break;
            }
        }
        let mut col_idx: Option<u32> = None;
        for i in 0..col_arr.len(&txn) {
            if let Some(yrs::Out::Any(yrs::Any::String(s))) = col_arr.get(&txn, i)
                && s.as_ref() == col_hex
            {
                col_idx = Some(i);
                break;
            }
        }
        Some(SheetPos::new(row_idx?, col_idx?))
    }

    /// Read which CellId currently owns a position in the yrs document.
    ///
    /// Reads `gridIndex/posToId` by constructing the `"rowHex:colHex"` key
    /// from the `rowOrder` / `colOrder` YArrays. Returns `None` when the
    /// position is unmapped. Consumers that have an in-memory `GridIndex`
    /// available should prefer that store — this method exists for paths
    /// (collaboration sync, observer recovery) where the in-memory index
    /// may be stale or absent.
    pub fn read_cell_id_at_pos(&self, sheet_id: &SheetId, row: u32, col: u32) -> Option<CellId> {
        use crate::storage::infra::grid_helpers;
        use compute_document::hex::hex_to_id;
        use compute_document::schema::KEY_GRID_INDEX;

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let txn = self.doc.transact();

        let sheet_map = match self.sheets.get(&txn, &sheet_hex) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let row_arr = grid_helpers::get_row_order_array(&sheet_map, &txn)?;
        let col_arr = grid_helpers::get_col_order_array(&sheet_map, &txn)?;
        let row_hex = match row_arr.get(&txn, row) {
            Some(yrs::Out::Any(yrs::Any::String(s))) => s.to_string(),
            _ => return None,
        };
        let col_hex = match col_arr.get(&txn, col) {
            Some(yrs::Out::Any(yrs::Any::String(s))) => s.to_string(),
            _ => return None,
        };
        let pos_key = format!("{}:{}", row_hex, col_hex);
        let gi_map = match sheet_map.get(&txn, KEY_GRID_INDEX) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let pos_to_id = match gi_map.get(&txn, "posToId") {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let cell_hex = match pos_to_id.get(&txn, pos_key.as_str()) {
            Some(yrs::Out::Any(yrs::Any::String(s))) => s.to_string(),
            _ => return None,
        };
        hex_to_id(&cell_hex).map(CellId::from_raw)
    }

    /// Write a cell value + optional formula. Updates both yrs doc and mirror.
    #[allow(clippy::too_many_arguments)]
    pub fn set_cell(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        value: CellValue,
        formula: Option<String>,
        identity_formula: Option<IdentityFormula>,
    ) {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());

        {
            let mut txn = self.doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

            // Navigate to cells map
            if let Some(yrs::Out::YMap(sheet_map)) = self.sheets.get(&txn, &sheet_hex)
                && let Some(yrs::Out::YMap(cells_map)) =
                    sheet_map.get(&txn, compute_document::schema::KEY_CELLS)
            {
                let cell_prelim =
                    build_cell_prelim(&value, formula.as_deref(), identity_formula.as_ref());
                let cell_map: yrs::MapRef = cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
                if let Some(idf) = &identity_formula
                    && let Err(e) = write_identity_formula_to_yrs(&cell_map, &mut txn, idf)
                {
                    tracing::error!("write_identity_formula_to_yrs failed: {e}");
                }
            }
        }

        // Update mirror with the identity formula.
        mirror.apply_edit(
            sheet_id,
            cell_id,
            SheetPos::new(row, col),
            value,
            identity_formula,
        );
    }

    /// Remove a cell from both yrs doc and mirror.
    pub fn remove_cell(&mut self, mirror: &mut CellMirror, sheet_id: &SheetId, cell_id: &CellId) {
        self.remove_cell_with_origin(mirror, sheet_id, cell_id, None);
    }

    /// Remove a cell with an explicit origin tag for the yrs transaction.
    pub fn remove_cell_with_origin(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: &CellId,
        origin: Option<&[u8]>,
    ) {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());

        {
            let mut txn = match origin {
                Some(o) => self.doc.transact_mut_with(yrs::Origin::from(o)),
                None => self.doc.transact_mut(),
            };
            if let Some(yrs::Out::YMap(sheet_map)) = self.sheets.get(&txn, &sheet_hex)
                && let Some(yrs::Out::YMap(cells_map)) =
                    sheet_map.get(&txn, compute_document::schema::KEY_CELLS)
            {
                cells_map.remove(&mut txn, &cell_hex);
            }
            // Also drop the yrs-side identity mapping so stale entries
            // don't leak into `read_cell_position_from_yrs` / CRDT sync.
            remove_cell_position_from_yrs(&mut txn, &self.sheets, &sheet_hex, &cell_hex);
        }

        mirror.remove_cell(cell_id);
    }
}
