use super::grid_index::GridIndex;
use cell_types::{CellId, ColId, IdAllocator, RowId, SheetId};
use std::sync::Arc;

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn alloc() -> Arc<IdAllocator> {
    Arc::new(IdAllocator::new())
}

fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

// -----------------------------------------------------------------------
// new() tests
// -----------------------------------------------------------------------

#[test]
fn test_new_creates_correct_row_col_ids() {
    let grid = GridIndex::new(make_sheet_id(1), 5, 3, alloc());

    assert_eq!(grid.row_count(), 5);
    assert_eq!(grid.col_count(), 3);

    // Every row should have a RowId
    for i in 0..5 {
        assert!(grid.row_id(i).is_some(), "row {} should have a RowId", i);
    }
    // Every col should have a ColId
    for i in 0..3 {
        assert!(grid.col_id(i).is_some(), "col {} should have a ColId", i);
    }

    // Out of bounds should return None
    assert!(grid.row_id(5).is_none());
    assert!(grid.col_id(3).is_none());
}

#[test]
fn test_new_row_ids_are_unique() {
    let grid = GridIndex::new(make_sheet_id(1), 100, 10, alloc());
    let mut seen = std::collections::HashSet::new();
    for i in 0..100 {
        let rid = grid.row_id(i).unwrap();
        assert!(
            seen.insert(rid.as_u128()),
            "RowId at row {} is not unique",
            i
        );
    }
}

#[test]
fn test_new_col_ids_are_unique() {
    let grid = GridIndex::new(make_sheet_id(1), 10, 50, alloc());
    let mut seen = std::collections::HashSet::new();
    for i in 0..50 {
        let cid = grid.col_id(i).unwrap();
        assert!(
            seen.insert(cid.as_u128()),
            "ColId at col {} is not unique",
            i
        );
    }
}

#[test]
fn test_new_no_cells_materialized() {
    let grid = GridIndex::new(make_sheet_id(1), 10, 10, alloc());
    assert_eq!(grid.cell_count(), 0);
    assert_eq!(grid.cells().count(), 0);
}

// -----------------------------------------------------------------------
// ensure_cell_id / cell_id_at / cell_position
// -----------------------------------------------------------------------

#[test]
fn test_ensure_cell_id_creates_new_id() {
    let mut grid = GridIndex::new(make_sheet_id(1), 10, 10, alloc());
    assert!(grid.cell_id_at(0, 0).is_none());

    let cell_id = grid.ensure_cell_id(0, 0);
    assert_eq!(grid.cell_count(), 1);

    // Should be retrievable
    assert_eq!(grid.cell_id_at(0, 0), Some(cell_id));
    assert_eq!(grid.cell_position(&cell_id), Some((0, 0)));
}

#[test]
fn test_ensure_cell_id_returns_existing() {
    let mut grid = GridIndex::new(make_sheet_id(1), 10, 10, alloc());
    let first = grid.ensure_cell_id(3, 4);
    let second = grid.ensure_cell_id(3, 4);

    assert_eq!(first, second);
    assert_eq!(grid.cell_count(), 1);
}

#[test]
fn test_cell_id_at_returns_none_for_empty() {
    let grid = GridIndex::new(make_sheet_id(1), 10, 10, alloc());
    assert!(grid.cell_id_at(0, 0).is_none());
    assert!(grid.cell_id_at(5, 5).is_none());
}

// -----------------------------------------------------------------------
// register_cell / remove_cell
// -----------------------------------------------------------------------

#[test]
fn test_register_cell_external_id() {
    let mut grid = GridIndex::new(make_sheet_id(1), 10, 10, alloc());
    let external_id = make_cell_id(42);

    grid.register_cell(external_id, 2, 3);

    assert_eq!(grid.cell_id_at(2, 3), Some(external_id));
    assert_eq!(grid.cell_position(&external_id), Some((2, 3)));
    assert_eq!(grid.cell_count(), 1);
}

#[test]
fn test_remove_cell_cleans_up() {
    let mut grid = GridIndex::new(make_sheet_id(1), 10, 10, alloc());
    let cell_id = grid.ensure_cell_id(1, 1);

    assert_eq!(grid.cell_count(), 1);
    grid.remove_cell(&cell_id);

    assert_eq!(grid.cell_count(), 0);
    assert!(grid.cell_id_at(1, 1).is_none());
    assert!(grid.cell_position(&cell_id).is_none());
}

#[test]
fn test_remove_nonexistent_cell() {
    let mut grid = GridIndex::new(make_sheet_id(1), 10, 10, alloc());
    // Should not panic
    grid.remove_cell(&make_cell_id(999));
    assert_eq!(grid.cell_count(), 0);
}

// -----------------------------------------------------------------------
// row_id / col_id / row_index / col_index lookups
// -----------------------------------------------------------------------

#[test]
fn test_row_col_reverse_lookups() {
    let grid = GridIndex::new(make_sheet_id(1), 5, 3, alloc());

    // Forward + reverse for rows
    for i in 0..5 {
        let rid = grid.row_id(i).unwrap();
        assert_eq!(grid.row_index(&rid), Some(i));
    }

    // Forward + reverse for cols
    for i in 0..3 {
        let cid = grid.col_id(i).unwrap();
        assert_eq!(grid.col_index(&cid), Some(i));
    }
}

#[test]
fn test_row_index_nonexistent() {
    let grid = GridIndex::new(make_sheet_id(1), 5, 5, alloc());
    let fake_rid = RowId::from_raw(12345);
    assert!(grid.row_index(&fake_rid).is_none());
}

#[test]
fn test_col_index_nonexistent() {
    let grid = GridIndex::new(make_sheet_id(1), 5, 5, alloc());
    let fake_cid = ColId::from_raw(12345);
    assert!(grid.col_index(&fake_cid).is_none());
}

// -----------------------------------------------------------------------
// insert_rows
// -----------------------------------------------------------------------

#[test]
fn test_insert_rows_shifts_cell_positions() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 5, alloc());

    // Put cells at rows 0, 1, 2
    let c0 = grid.ensure_cell_id(0, 0);
    let c1 = grid.ensure_cell_id(1, 0);
    let c2 = grid.ensure_cell_id(2, 0);

    // Insert 2 rows at row 1
    let new_rids = grid.insert_rows(1, 2);
    assert_eq!(new_rids.len(), 2);

    // Row 0 unchanged
    assert_eq!(grid.cell_position(&c0), Some((0, 0)));
    // Row 1 -> row 3
    assert_eq!(grid.cell_position(&c1), Some((3, 0)));
    // Row 2 -> row 4
    assert_eq!(grid.cell_position(&c2), Some((4, 0)));

    // Row count increased
    assert_eq!(grid.row_count(), 7);
}

#[test]
fn test_insert_rows_generates_new_row_ids() {
    let mut grid = GridIndex::new(make_sheet_id(1), 3, 3, alloc());

    let old_rid_0 = grid.row_id(0).unwrap();
    let old_rid_1 = grid.row_id(1).unwrap();
    let old_rid_2 = grid.row_id(2).unwrap();

    let new_rids = grid.insert_rows(1, 2);
    assert_eq!(new_rids.len(), 2);

    // Row 0 RowId unchanged
    assert_eq!(grid.row_id(0).unwrap(), old_rid_0);

    // Rows 1 and 2 are new
    assert_eq!(grid.row_id(1).unwrap(), new_rids[0]);
    assert_eq!(grid.row_id(2).unwrap(), new_rids[1]);

    // Old rows 1 and 2 shifted to 3 and 4
    assert_eq!(grid.row_id(3).unwrap(), old_rid_1);
    assert_eq!(grid.row_id(4).unwrap(), old_rid_2);

    // Reverse lookups work
    assert_eq!(grid.row_index(&old_rid_1), Some(3));
    assert_eq!(grid.row_index(&new_rids[0]), Some(1));
}

// -----------------------------------------------------------------------
// delete_rows
// -----------------------------------------------------------------------

#[test]
fn test_delete_rows_removes_cells_in_range() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 3, alloc());

    // Cells at rows 0, 1, 2
    let c0 = grid.ensure_cell_id(0, 0);
    let c1 = grid.ensure_cell_id(1, 0);
    let c2 = grid.ensure_cell_id(2, 0);

    // Delete row 1
    let deleted = grid.delete_rows(1, 1);

    assert_eq!(deleted.len(), 1);
    assert_eq!(deleted[0], c1);

    // c0 still at (0,0)
    assert_eq!(grid.cell_position(&c0), Some((0, 0)));
    // c1 gone
    assert!(grid.cell_position(&c1).is_none());
    // c2 shifted from (2,0) to (1,0)
    assert_eq!(grid.cell_position(&c2), Some((1, 0)));

    assert_eq!(grid.row_count(), 4);
    assert_eq!(grid.cell_count(), 2);
}

#[test]
fn test_delete_rows_shifts_remaining_cells_up() {
    let mut grid = GridIndex::new(make_sheet_id(1), 10, 5, alloc());

    // Cell at row 5
    let c5 = grid.ensure_cell_id(5, 2);
    // Cell at row 8
    let c8 = grid.ensure_cell_id(8, 3);

    // Delete rows 2-4 (3 rows)
    grid.delete_rows(2, 3);

    // Row 5 -> row 2, row 8 -> row 5
    assert_eq!(grid.cell_position(&c5), Some((2, 2)));
    assert_eq!(grid.cell_position(&c8), Some((5, 3)));
    assert_eq!(grid.row_count(), 7);
}

// -----------------------------------------------------------------------
// insert_cols / delete_cols
// -----------------------------------------------------------------------

#[test]
fn test_insert_cols_shifts_cell_positions() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 5, alloc());

    let c0 = grid.ensure_cell_id(0, 0);
    let c1 = grid.ensure_cell_id(0, 1);
    let c2 = grid.ensure_cell_id(0, 2);

    let new_cids = grid.insert_cols(1, 2);
    assert_eq!(new_cids.len(), 2);

    // Col 0 unchanged
    assert_eq!(grid.cell_position(&c0), Some((0, 0)));
    // Col 1 -> col 3
    assert_eq!(grid.cell_position(&c1), Some((0, 3)));
    // Col 2 -> col 4
    assert_eq!(grid.cell_position(&c2), Some((0, 4)));

    assert_eq!(grid.col_count(), 7);
}

#[test]
fn test_delete_cols_removes_and_shifts() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 5, alloc());

    let c0 = grid.ensure_cell_id(0, 0);
    let c1 = grid.ensure_cell_id(0, 1);
    let c2 = grid.ensure_cell_id(0, 2);
    let c3 = grid.ensure_cell_id(0, 3);

    // Delete col 1 (1 column)
    let deleted = grid.delete_cols(1, 1);

    assert_eq!(deleted.len(), 1);
    assert_eq!(deleted[0], c1);

    // c0 unchanged
    assert_eq!(grid.cell_position(&c0), Some((0, 0)));
    // c1 gone
    assert!(grid.cell_position(&c1).is_none());
    // c2 shifted from (0,2) to (0,1)
    assert_eq!(grid.cell_position(&c2), Some((0, 1)));
    // c3 shifted from (0,3) to (0,2)
    assert_eq!(grid.cell_position(&c3), Some((0, 2)));

    assert_eq!(grid.col_count(), 4);
    assert_eq!(grid.cell_count(), 3);
}

// -----------------------------------------------------------------------
// sort_rows
// -----------------------------------------------------------------------

#[test]
fn test_sort_rows_remaps_positions() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 3, alloc());

    // Cell at (0,0) with value-like identity
    let c0 = make_cell_id(100);
    grid.register_cell(c0, 0, 0);

    let c1 = make_cell_id(101);
    grid.register_cell(c1, 1, 0);

    let c2 = make_cell_id(102);
    grid.register_cell(c2, 2, 0);

    // Reverse order: row 0->2, row 1->1, row 2->0
    grid.sort_rows(&[(0, 2), (1, 1), (2, 0)]);

    assert_eq!(grid.cell_position(&c0), Some((2, 0)));
    assert_eq!(grid.cell_position(&c1), Some((1, 0)));
    assert_eq!(grid.cell_position(&c2), Some((0, 0)));
}

#[test]
fn test_sort_rows_preserves_columns() {
    let mut grid = GridIndex::new(make_sheet_id(1), 3, 3, alloc());

    // Multiple cells in row 0 across columns
    let c00 = make_cell_id(200);
    grid.register_cell(c00, 0, 0);
    let c01 = make_cell_id(201);
    grid.register_cell(c01, 0, 1);
    let c02 = make_cell_id(202);
    grid.register_cell(c02, 0, 2);

    // Cell in row 2
    let c20 = make_cell_id(210);
    grid.register_cell(c20, 2, 0);

    // Swap rows 0 and 2
    grid.sort_rows(&[(0, 2), (2, 0)]);

    // Row 0 cells -> row 2
    assert_eq!(grid.cell_position(&c00), Some((2, 0)));
    assert_eq!(grid.cell_position(&c01), Some((2, 1)));
    assert_eq!(grid.cell_position(&c02), Some((2, 2)));

    // Row 2 cell -> row 0
    assert_eq!(grid.cell_position(&c20), Some((0, 0)));
}

// -----------------------------------------------------------------------
// cell_count / cells() iterator
// -----------------------------------------------------------------------

#[test]
fn test_cell_count_tracks_materialized_cells() {
    let mut grid = GridIndex::new(make_sheet_id(1), 10, 10, alloc());

    assert_eq!(grid.cell_count(), 0);

    grid.ensure_cell_id(0, 0);
    assert_eq!(grid.cell_count(), 1);

    grid.ensure_cell_id(1, 1);
    assert_eq!(grid.cell_count(), 2);

    // ensure_cell_id on existing doesn't add
    grid.ensure_cell_id(0, 0);
    assert_eq!(grid.cell_count(), 2);

    // remove reduces count
    let c = grid.cell_id_at(0, 0).unwrap();
    grid.remove_cell(&c);
    assert_eq!(grid.cell_count(), 1);
}

#[test]
fn test_cells_iterator_returns_all_cells() {
    let mut grid = GridIndex::new(make_sheet_id(1), 10, 10, alloc());

    let c1 = grid.ensure_cell_id(0, 0);
    let c2 = grid.ensure_cell_id(3, 4);
    let c3 = grid.ensure_cell_id(7, 9);

    let mut cells: Vec<(CellId, u32, u32)> = grid.cells().collect();
    cells.sort_by_key(|&(_, r, c)| (r, c));

    assert_eq!(cells.len(), 3);
    assert_eq!(cells[0], (c1, 0, 0));
    assert_eq!(cells[1], (c2, 3, 4));
    assert_eq!(cells[2], (c3, 7, 9));
}

// -----------------------------------------------------------------------
// Edge cases
// -----------------------------------------------------------------------

#[test]
fn test_zero_dimension_grid() {
    let grid = GridIndex::new(make_sheet_id(1), 0, 0, alloc());
    assert_eq!(grid.row_count(), 0);
    assert_eq!(grid.col_count(), 0);
    assert_eq!(grid.cell_count(), 0);
}

#[test]
fn test_insert_rows_at_beginning() {
    let mut grid = GridIndex::new(make_sheet_id(1), 3, 3, alloc());
    let c = grid.ensure_cell_id(0, 0);

    grid.insert_rows(0, 2);

    assert_eq!(grid.cell_position(&c), Some((2, 0)));
    assert_eq!(grid.row_count(), 5);
}

#[test]
fn test_insert_rows_at_end() {
    let mut grid = GridIndex::new(make_sheet_id(1), 3, 3, alloc());
    let c = grid.ensure_cell_id(0, 0);

    grid.insert_rows(3, 2);

    // Cell position should not change
    assert_eq!(grid.cell_position(&c), Some((0, 0)));
    assert_eq!(grid.row_count(), 5);
}

#[test]
fn test_delete_all_rows_with_cells() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 3, alloc());
    grid.ensure_cell_id(0, 0);
    grid.ensure_cell_id(1, 0);
    grid.ensure_cell_id(2, 0);

    let deleted = grid.delete_rows(0, 3);
    assert_eq!(deleted.len(), 3);
    assert_eq!(grid.cell_count(), 0);
    assert_eq!(grid.row_count(), 2);
}

#[test]
fn test_sheet_id_accessor() {
    let sid = make_sheet_id(42);
    let grid = GridIndex::new(sid, 5, 5, alloc());
    assert_eq!(grid.sheet_id(), sid);
}

#[test]
fn test_sort_rows_empty_permutation() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 5, alloc());
    let c = grid.ensure_cell_id(0, 0);

    // Empty permutation should be a no-op
    grid.sort_rows(&[]);
    assert_eq!(grid.cell_position(&c), Some((0, 0)));
}

#[test]
fn test_multiple_cells_across_rows_and_cols() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 5, alloc());

    // Create a 3x3 grid of cells
    let mut cells = Vec::new();
    for r in 0..3 {
        for c in 0..3 {
            let cell_id = grid.ensure_cell_id(r, c);
            cells.push((cell_id, r, c));
        }
    }

    assert_eq!(grid.cell_count(), 9);

    // Insert 1 row at row 1 -- row 0 cells stay, rows 1-2 shift to 2-3
    grid.insert_rows(1, 1);

    // Row 0 unchanged
    assert_eq!(grid.cell_position(&cells[0].0), Some((0, 0)));
    assert_eq!(grid.cell_position(&cells[1].0), Some((0, 1)));
    assert_eq!(grid.cell_position(&cells[2].0), Some((0, 2)));

    // Row 1 -> row 2
    assert_eq!(grid.cell_position(&cells[3].0), Some((2, 0)));
    assert_eq!(grid.cell_position(&cells[4].0), Some((2, 1)));
    assert_eq!(grid.cell_position(&cells[5].0), Some((2, 2)));

    // Row 2 -> row 3
    assert_eq!(grid.cell_position(&cells[6].0), Some((3, 0)));
    assert_eq!(grid.cell_position(&cells[7].0), Some((3, 1)));
    assert_eq!(grid.cell_position(&cells[8].0), Some((3, 2)));

    // Still 9 cells
    assert_eq!(grid.cell_count(), 9);
}

#[test]
fn test_register_cell_overwrites_existing_at_position() {
    let mut grid = GridIndex::new(make_sheet_id(1), 10, 10, alloc());
    let old_id = grid.ensure_cell_id(2, 3);
    let new_id = make_cell_id(999);

    grid.register_cell(new_id, 2, 3);

    // New id should be at position
    assert_eq!(grid.cell_id_at(2, 3), Some(new_id));
    // Old id should be cleaned up
    assert!(grid.cell_position(&old_id).is_none());
    // Only 1 cell
    assert_eq!(grid.cell_count(), 1);
}

#[test]
fn test_register_cell_moves_existing_cell_id() {
    let mut grid = GridIndex::new(make_sheet_id(1), 10, 10, alloc());
    let cell_id = make_cell_id(500);

    grid.register_cell(cell_id, 1, 1);
    grid.register_cell(cell_id, 3, 4);

    // Should be at new position
    assert_eq!(grid.cell_position(&cell_id), Some((3, 4)));
    // Old position should be empty
    assert!(grid.cell_id_at(1, 1).is_none());
    // Only 1 cell
    assert_eq!(grid.cell_count(), 1);
}

#[test]
fn test_insert_rows_beyond_bounds_clamps() {
    let mut grid = GridIndex::new(make_sheet_id(1), 3, 3, alloc());
    let c = grid.ensure_cell_id(2, 0);

    // Insert at position beyond current row count — should clamp to end
    grid.insert_rows(100, 2);

    // Existing cell unchanged
    assert_eq!(grid.cell_position(&c), Some((2, 0)));
    assert_eq!(grid.row_count(), 5);
}

#[test]
fn test_delete_rows_beyond_bounds_clamps() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 3, alloc());
    let c = grid.ensure_cell_id(0, 0);

    // Delete starting beyond bounds — should be a no-op
    let deleted = grid.delete_rows(10, 3);
    assert_eq!(deleted.len(), 0);
    assert_eq!(grid.row_count(), 5);
    assert_eq!(grid.cell_position(&c), Some((0, 0)));
}

#[test]
fn test_delete_rows_count_exceeds_remaining() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 3, alloc());
    grid.ensure_cell_id(3, 0);
    grid.ensure_cell_id(4, 0);

    // Delete 100 rows starting at row 3 — should clamp to 2
    let deleted = grid.delete_rows(3, 100);
    assert_eq!(deleted.len(), 2);
    assert_eq!(grid.row_count(), 3);
}

// -----------------------------------------------------------------------
// sort_rows — bijection validation
// -----------------------------------------------------------------------

#[test]
fn test_sort_rows_three_way_cycle() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 3, alloc());

    let c0 = make_cell_id(300);
    grid.register_cell(c0, 0, 0);
    let c1 = make_cell_id(301);
    grid.register_cell(c1, 1, 0);
    let c2 = make_cell_id(302);
    grid.register_cell(c2, 2, 0);

    // Record original RowIds
    let rid0 = grid.row_id(0).unwrap();
    let rid1 = grid.row_id(1).unwrap();
    let rid2 = grid.row_id(2).unwrap();

    // 3-way cycle: 0->1, 1->2, 2->0
    grid.sort_rows(&[(0, 1), (1, 2), (2, 0)]);

    // Cell positions follow the cycle
    assert_eq!(grid.cell_position(&c0), Some((1, 0)));
    assert_eq!(grid.cell_position(&c1), Some((2, 0)));
    assert_eq!(grid.cell_position(&c2), Some((0, 0)));

    // RowIds remain unchanged (Yrs rowOrder is authoritative)
    assert_eq!(grid.row_id(0).unwrap(), rid0);
    assert_eq!(grid.row_id(1).unwrap(), rid1);
    assert_eq!(grid.row_id(2).unwrap(), rid2);

    // Reverse lookups are consistent
    assert_eq!(grid.row_index(&rid0), Some(0));
    assert_eq!(grid.row_index(&rid1), Some(1));
    assert_eq!(grid.row_index(&rid2), Some(2));
}

#[cfg(debug_assertions)]
#[test]
#[should_panic(expected = "duplicate new_row target")]
fn test_sort_rows_panics_on_duplicate_new_rows() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 3, alloc());
    // Two different old_rows both mapping to new_row 0 — not injective
    grid.sort_rows(&[(0, 0), (1, 0)]);
}

#[cfg(debug_assertions)]
#[test]
#[should_panic(expected = "source set != target set")]
fn test_sort_rows_panics_on_non_bijective_permutation() {
    let mut grid = GridIndex::new(make_sheet_id(1), 5, 3, alloc());
    // Sources {0, 1} != targets {1, 2} — row 2 would be overwritten, row 0 data lost
    grid.sort_rows(&[(0, 1), (1, 2)]);
}
