use crate::cells::CellStore;
use crate::cells::test_helpers::{make_cell_id, make_sheet_id, store_with_grid};
use cell_types::{CellId, RowId, SheetPos};

#[test]
fn test_insert_rows_shifts_positions() {
    let (mut cell_store, sheet_id) = store_with_grid();

    // Insert 2 rows at row 1 — rows 1,2 become 3,4; row 0 stays
    cell_store.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::InsertRows {
            at: 1,
            count: 2,
            new_row_ids: vec![RowId::from_raw(901), RowId::from_raw(902)],
        },
    );

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();

    // Row 0 cells unchanged
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(0, 0)).as_ref(),
        Some(&make_cell_id(100))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(0, 1)).as_ref(),
        Some(&make_cell_id(101))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(0, 2)).as_ref(),
        Some(&make_cell_id(102))
    );

    // Old row 1 -> now row 3
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(3, 0)).as_ref(),
        Some(&make_cell_id(110))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(3, 1)).as_ref(),
        Some(&make_cell_id(111))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(3, 2)).as_ref(),
        Some(&make_cell_id(112))
    );

    // Old row 2 -> now row 4
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(4, 0)).as_ref(),
        Some(&make_cell_id(120))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(4, 1)).as_ref(),
        Some(&make_cell_id(121))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(4, 2)).as_ref(),
        Some(&make_cell_id(122))
    );

    // Rows 1-2 are empty (newly inserted)
    assert!(
        sheet
            .authored_cell_id_at(SheetPos::new(1, 0))
            .as_ref()
            .is_none()
    );
    assert!(
        sheet
            .authored_cell_id_at(SheetPos::new(2, 0))
            .as_ref()
            .is_none()
    );

    // Reverse index also updated
    assert_eq!(
        sheet.position_of(&make_cell_id(110)).as_ref(),
        Some(&SheetPos::new(3, 0))
    );
    assert_eq!(
        sheet.position_of(&make_cell_id(120)).as_ref(),
        Some(&SheetPos::new(4, 0))
    );

    // Sheet rows updated
    assert_eq!(sheet.rows, 12);
}
#[test]
fn test_delete_rows_removes_and_shifts() {
    let (mut cell_store, sheet_id) = store_with_grid();

    // Delete row 1 (1 row). Cells at row=1 are deleted, row=2 shifts to row=1.
    let deleted = vec![make_cell_id(110), make_cell_id(111), make_cell_id(112)];
    cell_store.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::DeleteRows {
            at: 1,
            count: 1,
            deleted_cell_ids: deleted,
        },
    );

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();

    // Row 0 unchanged
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(0, 0)).as_ref(),
        Some(&make_cell_id(100))
    );

    // Old row 1 cells gone
    assert!(cell_store.cells.get(&make_cell_id(110)).is_none());
    assert!(cell_store.cells.get(&make_cell_id(111)).is_none());
    assert!(cell_store.cells.get(&make_cell_id(112)).is_none());

    // Old row 2 -> now row 1
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(1, 0)).as_ref(),
        Some(&make_cell_id(120))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(1, 1)).as_ref(),
        Some(&make_cell_id(121))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(1, 2)).as_ref(),
        Some(&make_cell_id(122))
    );

    // Reverse index
    assert_eq!(
        sheet.position_of(&make_cell_id(120)).as_ref(),
        Some(&SheetPos::new(1, 0))
    );

    // Sheet rows updated
    assert_eq!(sheet.rows, 9);

    // Total cells: started with 9, deleted 3 = 6
    assert_eq!(cell_store.iter_sheet_cells(&sheet_id).count(), 6);
}
#[test]
fn test_insert_cols_shifts_positions() {
    let (mut cell_store, sheet_id) = store_with_grid();

    // Insert 1 col at col 1 — col 1,2 become 2,3; col 0 stays
    cell_store.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::InsertCols {
            at: 1,
            count: 1,
            new_col_ids: vec![cell_types::ColId::from_raw(801)],
        },
    );

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();

    // Col 0 unchanged for all rows
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(0, 0)).as_ref(),
        Some(&make_cell_id(100))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(1, 0)).as_ref(),
        Some(&make_cell_id(110))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(2, 0)).as_ref(),
        Some(&make_cell_id(120))
    );

    // Old col 1 -> now col 2
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(0, 2)).as_ref(),
        Some(&make_cell_id(101))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(1, 2)).as_ref(),
        Some(&make_cell_id(111))
    );

    // Old col 2 -> now col 3
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(0, 3)).as_ref(),
        Some(&make_cell_id(102))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(1, 3)).as_ref(),
        Some(&make_cell_id(112))
    );

    // Col 1 is empty (newly inserted)
    assert!(
        sheet
            .authored_cell_id_at(SheetPos::new(0, 1))
            .as_ref()
            .is_none()
    );

    // Sheet cols updated
    assert_eq!(sheet.cols, 6);
}
#[test]
fn test_delete_cols_removes_and_shifts() {
    let (mut cell_store, sheet_id) = store_with_grid();

    // Delete col 0 (1 col). Cells at col=0 deleted, cols 1,2 shift to 0,1.
    let deleted = vec![make_cell_id(100), make_cell_id(110), make_cell_id(120)];
    cell_store.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::DeleteCols {
            at: 0,
            count: 1,
            deleted_cell_ids: deleted,
        },
    );

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();

    // Old col 0 cells gone
    assert!(cell_store.cells.get(&make_cell_id(100)).is_none());
    assert!(cell_store.cells.get(&make_cell_id(110)).is_none());
    assert!(cell_store.cells.get(&make_cell_id(120)).is_none());

    // Old col 1 -> now col 0
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(0, 0)).as_ref(),
        Some(&make_cell_id(101))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(1, 0)).as_ref(),
        Some(&make_cell_id(111))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(2, 0)).as_ref(),
        Some(&make_cell_id(121))
    );

    // Old col 2 -> now col 1
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(0, 1)).as_ref(),
        Some(&make_cell_id(102))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(1, 1)).as_ref(),
        Some(&make_cell_id(112))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(2, 1)).as_ref(),
        Some(&make_cell_id(122))
    );

    // Sheet cols updated
    assert_eq!(sheet.cols, 4);

    // Total cells: 9 - 3 = 6
    assert_eq!(cell_store.iter_sheet_cells(&sheet_id).count(), 6);
}
#[test]
fn test_remap_positions() {
    let (mut cell_store, sheet_id) = store_with_grid();

    // Swap rows 0 and 2 for col 0
    cell_store.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::RemapPositions {
            updates: vec![
                (make_cell_id(100), 2, 0), // was (0,0) -> (2,0)
                (make_cell_id(120), 0, 0), // was (2,0) -> (0,0)
            ],
        },
    );

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(2, 0)).as_ref(),
        Some(&make_cell_id(100))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(0, 0)).as_ref(),
        Some(&make_cell_id(120))
    );
    assert_eq!(
        sheet.position_of(&make_cell_id(100)).as_ref(),
        Some(&SheetPos::new(2, 0))
    );
    assert_eq!(
        sheet.position_of(&make_cell_id(120)).as_ref(),
        Some(&SheetPos::new(0, 0))
    );
}
#[test]
fn test_structure_change_on_nonexistent_sheet() {
    let mut cell_store = CellStore::new();
    // Should not panic
    cell_store.apply_structure_change(
        &make_sheet_id(999),
        &formula_types::StructureChange::InsertRows {
            at: 0,
            count: 1,
            new_row_ids: vec![],
        },
    );
}
#[test]
fn test_insert_rows_at_beginning() {
    let (mut cell_store, sheet_id) = store_with_grid();

    // Insert 1 row at the very beginning — all rows shift down by 1
    cell_store.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::InsertRows {
            at: 0,
            count: 1,
            new_row_ids: vec![RowId::from_raw(999)],
        },
    );

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();

    // All original cells shifted down by 1
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(1, 0)).as_ref(),
        Some(&make_cell_id(100))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(2, 0)).as_ref(),
        Some(&make_cell_id(110))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(3, 0)).as_ref(),
        Some(&make_cell_id(120))
    );

    // Row 0 is empty
    assert!(
        sheet
            .authored_cell_id_at(SheetPos::new(0, 0))
            .as_ref()
            .is_none()
    );
}
#[test]
fn test_insert_rows_at_end() {
    let (mut cell_store, sheet_id) = store_with_grid();

    // Insert 2 rows at row 3 (past all existing cells) — no positions change
    cell_store.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::InsertRows {
            at: 3,
            count: 2,
            new_row_ids: vec![RowId::from_raw(997), RowId::from_raw(998)],
        },
    );

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();

    // All positions unchanged
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(0, 0)).as_ref(),
        Some(&make_cell_id(100))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(1, 0)).as_ref(),
        Some(&make_cell_id(110))
    );
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(2, 0)).as_ref(),
        Some(&make_cell_id(120))
    );

    assert_eq!(sheet.rows, 12);
}
#[test]
fn test_delete_all_rows_with_cells() {
    let (mut cell_store, sheet_id) = store_with_grid();

    // Delete all 3 rows that have cells
    let all_cell_ids: Vec<CellId> = (0..3u32)
        .flat_map(|r| (0..3u32).map(move |c| make_cell_id((r * 10 + c + 100) as u128)))
        .collect();

    cell_store.apply_structure_change(
        &sheet_id,
        &formula_types::StructureChange::DeleteRows {
            at: 0,
            count: 3,
            deleted_cell_ids: all_cell_ids,
        },
    );

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert_eq!(cell_store.iter_sheet_cells(&sheet_id).count(), 0);
    assert_eq!(sheet.cell_by_axes.len(), 0);
    assert_eq!(sheet.axes_by_cell.len(), 0);
    assert_eq!(sheet.rows, 7);
}
