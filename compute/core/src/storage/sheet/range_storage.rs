//! Range storage operations — create, remove, replace Range entries.

use cell_types::{CellId, PayloadEncoding, SheetPos};

use crate::cells::range_view::RangeView;
use crate::cells::{CellEntry, SheetStore};
use formula_types::IdentityFormula;
use rustc_hash::FxHashMap;

/// Move active range values into authored storage before removing the range.
/// Existing authored entries take priority; blank payload slots remain absent.
pub fn fold_range_to_cells(
    range: &RangeView,
    sheet: &mut SheetStore,
    cells: &mut FxHashMap<CellId, CellEntry>,
    formulas: &FxHashMap<CellId, IdentityFormula>,
) -> Vec<CellId> {
    if range.encoding == PayloadEncoding::None {
        return Vec::new();
    }
    let mut folded = Vec::new();
    range.visit_values(|row_id, col_id, value| {
        if value.is_null() {
            return;
        }
        let (Some(row), Some(col)) = (sheet.row_index_of(&row_id), sheet.col_index_of(&col_id))
        else {
            return;
        };
        let pos = SheetPos::new(row, col);
        let id = if let Some(id) = sheet.authored_cell_id_at(pos) {
            if !sheet.is_ghost(&id, cells, formulas)
                || (id.is_virtual() && cells.contains_key(&id))
            {
                return;
            }
            id
        } else {
            CellId::virtual_at(sheet.id, row_id, col_id)
        };
        sheet.register_cell(id, row, col);
        cells.insert(id, CellEntry { value });
        folded.push(id);
    });
    folded
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cells::range_view::RangeView;
    use cell_types::{ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId, SheetId};
    use std::sync::Arc;
    use value_types::CellValue;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_none_range_view() -> RangeView {
        let mut row_offset_by_id = crate::cells::range_view::RangeOffsets::default();
        row_offset_by_id.insert(RowId::from_raw(1), 0);
        row_offset_by_id.insert(RowId::from_raw(2), 1);
        let mut col_offset_by_id = crate::cells::range_view::RangeOffsets::default();
        col_offset_by_id.insert(ColId::from_raw(1), 0);
        RangeView {
            range_id: RangeId::from_raw(100),
            kind: RangeKind::Format,
            anchor: RangeAnchor::Strict {
                row_ids: vec![RowId::from_raw(1), RowId::from_raw(2)],
                col_ids: vec![ColId::from_raw(1)],
            },
            encoding: PayloadEncoding::None,
            values: Arc::from([] as [CellValue; 0]),
            payload_cols: 1,
            row_offset_by_id,
            col_offset_by_id,
        }
    }

    #[test]
    fn fold_none_encoding_returns_empty() {
        let rv = make_none_range_view();
        let mut sheet = SheetStore::new(SheetId::from_raw(1), "Sheet1".into(), 2, 1);
        let mut cells = rustc_hash::FxHashMap::default();
        let formulas = rustc_hash::FxHashMap::default();
        let folded = fold_range_to_cells(&rv, &mut sheet, &mut cells, &formulas);
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

    #[test]
    fn folding_retains_metadata_identities_and_preserves_value_and_formula_overrides() {
        let mut sheet = SheetStore::new(SheetId::from_raw(1), "Sheet1".into(), 6, 1);
        let rows: Vec<_> = (0..6).map(|row| sheet.row_id_at(row).unwrap()).collect();
        let col = sheet.col_id_at(0).unwrap();
        let ids: Vec<_> = rows
            .iter()
            .enumerate()
            .map(|(row, row_id)| {
                if row == 0 || row == 5 {
                    CellId::virtual_at(sheet.id, *row_id, col)
                } else {
                    CellId::from_raw(100 + row as u128)
                }
            })
            .collect();
        for (row, id) in ids.iter().enumerate() {
            sheet.register_cell(*id, row as u32, 0);
        }
        let mut cells = rustc_hash::FxHashMap::default();
        let mut formulas = rustc_hash::FxHashMap::default();
        // Metadata-only virtual and explicit IDs, followed by an old blank
        // ghost, retain their identity when the range payload becomes authored.
        cells.insert(
            ids[2],
            CellEntry {
                value: CellValue::Null,
            },
        );
        cells.insert(
            ids[3],
            CellEntry {
                value: CellValue::number(99.0),
            },
        );
        cells.insert(
            ids[4],
            CellEntry {
                value: CellValue::Null,
            },
        );
        formulas.insert(
            ids[4],
            formula_types::IdentityFormula {
                template: "1".into(),
                refs: Vec::new(),
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            },
        );
        // An explicit null override of a range virtual cell remains cleared.
        cells.insert(
            ids[5],
            CellEntry {
                value: CellValue::Null,
            },
        );
        let range = RangeView {
            range_id: RangeId::from_raw(100),
            kind: RangeKind::Data,
            anchor: RangeAnchor::Elastic {
                start_row: rows[0],
                end_row: rows[5],
                start_col: col,
                end_col: col,
            },
            encoding: PayloadEncoding::F64Le,
            values: (1..=6)
                .map(|value| CellValue::number(f64::from(value)))
                .collect(),
            payload_cols: 1,
            row_offset_by_id: rows
                .into_iter()
                .enumerate()
                .map(|(offset, id)| (id, offset as u32))
                .collect(),
            col_offset_by_id: [(col, 0)].into_iter().collect(),
        };
        let folded = fold_range_to_cells(&range, &mut sheet, &mut cells, &formulas);
        assert_eq!(folded, ids[..3]);
        for row in 0..6 {
            assert_eq!(
                sheet.authored_cell_id_at(SheetPos::new(row, 0)),
                Some(ids[row as usize])
            );
        }
        for row in 0..3 {
            assert_eq!(
                cells.get(&ids[row as usize]).map(|e| &e.value),
                Some(&CellValue::number(f64::from(row + 1)))
            );
        }
        assert_eq!(
            cells.get(&ids[3]).map(|e| &e.value),
            Some(&CellValue::number(99.0))
        );
        assert_eq!(
            cells.get(&ids[4]).map(|e| &e.value),
            Some(&CellValue::Null)
        );
        assert!(formulas.contains_key(&ids[4]));
        assert_eq!(
            cells.get(&ids[5]).map(|e| &e.value),
            Some(&CellValue::Null)
        );
    }
}
