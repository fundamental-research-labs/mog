//! Range storage operations — create, remove, replace Range entries.

use cell_types::{CellId, PayloadEncoding, RowId, SheetId, SheetPos};
use rustc_hash::FxHashMap;
use value_types::CellValue;

use crate::mirror::CellEntry;
use crate::mirror::range_view::RangeView;

/// Fold a Range's payload data into per-cell entries before removal.
///
/// For each position in the Range extent, decode the payload value and insert
/// it as a regular cell entry -- unless an override cell already exists (user
/// edits take priority). Also registers `pos_to_id` and `id_to_pos` entries
/// for each folded cell so that position-based lookups succeed after the Range
/// is removed.
///
/// Returns the list of virtual CellIds that were newly inserted (callers use
/// this to update workbook-level `cell_to_sheet`).
pub fn fold_range_to_cells(
    range_view: &RangeView,
    cells: &mut FxHashMap<CellId, CellEntry>,
    pos_to_id: &mut FxHashMap<SheetPos, CellId>,
    id_to_pos: &mut FxHashMap<CellId, SheetPos>,
    row_to_index: &FxHashMap<RowId, u32>,
    col_to_index: &FxHashMap<cell_types::ColId, u32>,
    sheet_id: &SheetId,
) -> Vec<CellId> {
    if range_view.encoding == PayloadEncoding::None {
        return Vec::new();
    }
    let mut folded_ids = Vec::new();
    range_view.visit_values(|row_id, col_id, value| {
        let virtual_id = CellId::virtual_at(*sheet_id, row_id, col_id);
        if cells.contains_key(&virtual_id) || matches!(value, CellValue::Null) {
            return;
        }

        cells.insert(
            virtual_id,
            CellEntry {
                value,
                formula: None,
            },
        );
        // Register position maps so lookups via pos_to_id / id_to_pos
        // succeed after the Range is removed.
        if let (Some(&row_idx), Some(&col_idx)) =
            (row_to_index.get(&row_id), col_to_index.get(&col_id))
        {
            let pos = SheetPos::new(row_idx, col_idx);
            pos_to_id.insert(pos, virtual_id);
            id_to_pos.insert(virtual_id, pos);
        }
        folded_ids.push(virtual_id);
    });
    folded_ids
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::range_view::RangeView;
    use cell_types::{ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId, SheetId};
    use std::sync::Arc;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_none_range_view() -> RangeView {
        let mut row_offset_by_id = FxHashMap::default();
        row_offset_by_id.insert(RowId::from_raw(1), 0);
        row_offset_by_id.insert(RowId::from_raw(2), 1);
        let mut col_offset_by_id = FxHashMap::default();
        col_offset_by_id.insert(ColId::from_raw(1), 0);
        RangeView {
            range_id: RangeId::from_raw(100),
            kind: RangeKind::Format,
            anchor: RangeAnchor::Strict {
                row_ids: vec![RowId::from_raw(1), RowId::from_raw(2)],
                col_ids: vec![ColId::from_raw(1)],
            },
            encoding: PayloadEncoding::None,
            payload: Arc::from([] as [u8; 0]),
            row_offset_by_id,
            col_offset_by_id,
            overrides: FxHashMap::default(),
            override_count: 0,
            folded_up_to: None,
        }
    }

    #[test]
    fn fold_none_encoding_returns_empty() {
        let rv = make_none_range_view();
        let mut cells = FxHashMap::default();
        let mut pos_to_id = FxHashMap::default();
        let mut id_to_pos = FxHashMap::default();
        let row_to_index = FxHashMap::default();
        let col_to_index = FxHashMap::default();
        let sheet_id = SheetId::from_raw(1);

        let folded = fold_range_to_cells(
            &rv,
            &mut cells,
            &mut pos_to_id,
            &mut id_to_pos,
            &row_to_index,
            &col_to_index,
            &sheet_id,
        );
        assert!(
            folded.is_empty(),
            "PayloadEncoding::None should not fold any cells"
        );
        assert!(
            cells.is_empty(),
            "No cells should be created for None encoding"
        );
    }

    #[test]
    fn decode_value_none_returns_null() {
        let rv = make_none_range_view();
        let val = rv.decode_value(0, 0);
        assert!(matches!(val, CellValue::Null));
    }
}
