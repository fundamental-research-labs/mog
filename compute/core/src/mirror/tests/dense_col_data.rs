use crate::mirror::CellEntry;
use crate::mirror::test_helpers::{make_cell_id, mirror_with_grid};
use cell_types::{RowId, SheetPos};
use value_types::{CellValue, FiniteF64};

#[test]
fn test_set_value_mut_invalidates_dense_cache() {
    let (mut mirror, sheet_id) = mirror_with_grid();
    // Materialize column 0 into dense cache using direct field access
    // to avoid borrow conflicts (get_sheet borrows &self, dense_cache_mut borrows &mut self).
    let sheet = &mirror.sheets[&sheet_id];
    mirror.dense_cache.materialize(&sheet_id, 0, sheet);
    assert!(mirror.dense_cache().get(&sheet_id, 0).is_some());

    // set_value_mut should invalidate the dense cache for that column
    let cell_id = make_cell_id(100); // row=0, col=0
    mirror.set_value_mut(&cell_id, CellValue::Number(FiniteF64::must(999.0)));
    assert!(
        mirror.dense_cache().get(&sheet_id, 0).is_none(),
        "dense cache should be invalidated after set_value_mut"
    );
}
#[test]
fn test_insert_cell_invalidates_dense_cache() {
    let (mut mirror, sheet_id) = mirror_with_grid();
    let sheet = &mirror.sheets[&sheet_id];
    mirror.dense_cache.materialize(&sheet_id, 0, sheet);
    assert!(mirror.dense_cache().get(&sheet_id, 0).is_some());

    // insert_cell should invalidate the dense cache
    let entry = CellEntry {
        value: CellValue::Number(FiniteF64::must(777.0)),
        formula: None,
    };
    mirror.insert_cell(&sheet_id, make_cell_id(500), SheetPos::new(5, 0), entry);
    assert!(
        mirror.dense_cache().get(&sheet_id, 0).is_none(),
        "dense cache should be invalidated after insert_cell"
    );
}
#[test]
fn test_remove_cell_clears_col_data_and_dense_cache() {
    let (mut mirror, sheet_id) = mirror_with_grid();

    // First populate col_data by applying an edit (which updates col_data)
    let cell_id = make_cell_id(100); // row=0, col=0
    mirror.apply_edit(
        &sheet_id,
        cell_id,
        SheetPos::new(0, 0),
        CellValue::Number(FiniteF64::must(42.0)),
        None,
    );

    // Materialize dense cache
    let sheet = &mirror.sheets[&sheet_id];
    mirror.dense_cache.materialize(&sheet_id, 0, sheet);
    assert!(mirror.dense_cache().get(&sheet_id, 0).is_some());

    // Remove the cell
    mirror.remove_cell(&cell_id);

    // Dense cache should be invalidated
    assert!(
        mirror.dense_cache().get(&sheet_id, 0).is_none(),
        "dense cache should be invalidated after remove_cell"
    );

    // col_data should have Null at the old position
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    if let Some(col_vec) = sheet.col_data.get(&0) {
        if !col_vec.is_empty() {
            assert_eq!(
                col_vec[0],
                CellValue::Null,
                "col_data should be cleared to Null after remove_cell"
            );
        }
    }
}
#[test]
fn test_col_data_grows_on_out_of_bounds_insert() {
    let (mut mirror, sheet_id) = mirror_with_grid();

    // The grid has cells at rows 0-2, cols 0-2. col_data may have vectors of length ~3.
    // Insert a cell at row 8 (beyond col_data vector length) — should grow, not silently drop.
    let entry = CellEntry {
        value: CellValue::Number(FiniteF64::must(88.0)),
        formula: None,
    };
    mirror.insert_cell(&sheet_id, make_cell_id(800), SheetPos::new(8, 0), entry);

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    if let Some(col_vec) = sheet.col_data.get(&0) {
        assert!(
            col_vec.len() > 8,
            "col_data vector should have grown to accommodate row 8"
        );
        assert_eq!(
            col_vec[8],
            CellValue::Number(FiniteF64::must(88.0)),
            "col_data should contain the inserted value at row 8"
        );
    }
}
#[test]
fn test_col_data_grows_on_set_value_mut() {
    let (mut mirror, sheet_id) = mirror_with_grid();

    // Insert a cell at a high row that won't be in col_data initially
    let cell_id = make_cell_id(900);
    let entry = CellEntry {
        value: CellValue::Number(FiniteF64::must(1.0)),
        formula: None,
    };
    mirror.insert_cell(&sheet_id, cell_id, SheetPos::new(9, 0), entry);

    // Now set_value_mut at row 9 — the col_data vector should grow to accommodate
    mirror.set_value_mut(&cell_id, CellValue::Number(FiniteF64::must(99.0)));

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    if let Some(col_vec) = sheet.col_data.get(&0) {
        assert!(
            col_vec.len() > 9,
            "col_data should grow for set_value_mut at high row"
        );
        assert_eq!(col_vec[9], CellValue::Number(FiniteF64::must(99.0)));
    }
}
#[test]
fn test_col_data_rebuilt_after_insert_rows() {
    let (mut mirror, sheet_id) = mirror_with_grid();

    // Populate col_data via apply_edit
    mirror.apply_edit(
        &sheet_id,
        make_cell_id(100),
        SheetPos::new(0, 0),
        CellValue::Number(FiniteF64::must(10.0)),
        None,
    );
    mirror.apply_edit(
        &sheet_id,
        make_cell_id(110),
        SheetPos::new(1, 0),
        CellValue::Number(FiniteF64::must(20.0)),
        None,
    );

    // Insert 2 rows at row 1 — row 1 becomes row 3
    mirror.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::InsertRows {
            at: 1,
            count: 2,
            new_row_ids: vec![
                cell_types::RowId::from_raw(901),
                cell_types::RowId::from_raw(902),
            ],
        },
    );

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    if let Some(col_vec) = sheet.col_data.get(&0) {
        // Row 0 should still have value 10.0
        assert_eq!(
            col_vec[0],
            CellValue::Number(FiniteF64::must(10.0)),
            "row 0 value should be preserved after insert_rows"
        );
        // Row 3 (shifted from row 1) should have value 20.0
        if col_vec.len() > 3 {
            assert_eq!(
                col_vec[3],
                CellValue::Number(FiniteF64::must(20.0)),
                "shifted row value should be at new position in col_data"
            );
        }
    }
}
#[test]
fn test_col_data_rebuilt_after_delete_rows() {
    let (mut mirror, sheet_id) = mirror_with_grid();

    // Delete row 0 — cells at row 0 are deleted, row 1 shifts to row 0
    let deleted = vec![make_cell_id(100), make_cell_id(101), make_cell_id(102)];
    mirror.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::DeleteRows {
            at: 0,
            count: 1,
            deleted_cell_ids: deleted,
        },
    );

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    // After deleting row 0, old row 1 (cell_id 110, value=10.0) should be at row 0
    if let Some(col_vec) = sheet.col_data.get(&0) {
        assert_eq!(
            col_vec[0],
            CellValue::Number(FiniteF64::must(10.0)),
            "after delete, shifted cell should be at new position in col_data"
        );
    }
}
#[test]
fn test_col_data_padded_to_sheet_rows_after_insert() {
    // Regression: rebuild_col_data must pad vectors to sheet.rows
    // (matching snapshot load invariant), not just to last-occupied-row+1.
    let (mut mirror, sheet_id) = mirror_with_grid();
    // mirror_with_grid: 3×3 grid in a 10×5 sheet, rows 0-2 occupied

    // Insert 2 rows at row 1 → sheet.rows goes from 10 to 12
    mirror.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::InsertRows {
            at: 1,
            count: 2,
            new_row_ids: vec![RowId::from_raw(801), RowId::from_raw(802)],
        },
    );

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.rows, 12, "sheet.rows should be 10 + 2 = 12");
    for (col, col_vec) in &sheet.col_data {
        assert_eq!(
            col_vec.len(),
            sheet.rows as usize,
            "col_data[{col}] should be padded to sheet.rows ({}) but was {}",
            sheet.rows,
            col_vec.len(),
        );
    }
}
#[test]
fn test_col_data_padded_to_sheet_rows_after_delete() {
    let (mut mirror, sheet_id) = mirror_with_grid();
    // Delete row 0
    let deleted = vec![make_cell_id(100), make_cell_id(101), make_cell_id(102)];
    mirror.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::DeleteRows {
            at: 0,
            count: 1,
            deleted_cell_ids: deleted,
        },
    );

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.rows, 9, "sheet.rows should be 10 - 1 = 9");
    for (col, col_vec) in &sheet.col_data {
        assert_eq!(
            col_vec.len(),
            sheet.rows as usize,
            "col_data[{col}] should be padded to sheet.rows ({}) but was {}",
            sheet.rows,
            col_vec.len(),
        );
    }
}
