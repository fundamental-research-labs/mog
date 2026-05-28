use std::sync::Arc;

use super::StructuralOps;
use crate::identity::GridIndex;
use crate::mirror::{CellEntry, CellMirror, SheetMirror};
use crate::storage::infra::grid_helpers::{get_col_order_array, get_row_order_array};
use cell_types::{CellId, SheetId, SheetPos};
use value_types::{CellValue, FiniteF64};
use yrs::{Any, Array, ArrayPrelim, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_CELLS, KEY_COL_ORDER, KEY_ROW_ORDER};
use compute_document::undo::{ORIGIN_STRUCTURAL, ORIGIN_USER_EDIT};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

/// Set up a yrs Doc with one sheet that has cells, rowOrder, and colOrder.
/// Also sets up a CellMirror and GridIndex for that sheet.
/// Returns (doc, sheets_map, grid_index, mirror, sheet_id).
/// (Pre-R51 this also populated `cellGrid` / `cellPos`; those sub-maps
/// have been retired.)
fn setup_test_env(rows: u32, cols: u32) -> (Doc, MapRef, GridIndex, CellMirror, SheetId) {
    let sheet_id = make_sheet_id(1);
    let sheet_hex = id_to_hex(sheet_id.as_u128());

    // Set up yrs doc
    let doc = Doc::new();
    let sheets_map = doc.get_or_insert_map("sheets");

    // Set up GridIndex (creates RowIds/ColIds)
    let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::new());
    let grid_index = GridIndex::new(sheet_id, rows, cols, id_alloc);

    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

        // Create sheet map
        let sheet_map_prelim = MapPrelim::from([] as [(&str, yrs::Any); 0]);
        let sheet_map: MapRef = sheets_map.insert(&mut txn, &*sheet_hex, sheet_map_prelim);

        // Empty cells map
        let cells_prelim = MapPrelim::from([] as [(&str, yrs::Any); 0]);
        sheet_map.insert(&mut txn, KEY_CELLS, cells_prelim);

        // rowOrder YArray — populated from GridIndex
        let row_order: yrs::ArrayRef =
            sheet_map.insert(&mut txn, KEY_ROW_ORDER, ArrayPrelim::default());
        for r in 0..rows {
            if let Some(rid) = grid_index.row_id(r) {
                let hex = id_to_hex(rid.as_u128());
                row_order.push_back(&mut txn, Any::String(Arc::from(hex.as_str())));
            }
        }

        // colOrder YArray — populated from GridIndex
        let col_order: yrs::ArrayRef =
            sheet_map.insert(&mut txn, KEY_COL_ORDER, ArrayPrelim::default());
        for c in 0..cols {
            if let Some(cid) = grid_index.col_id(c) {
                let hex = id_to_hex(cid.as_u128());
                col_order.push_back(&mut txn, Any::String(Arc::from(hex.as_str())));
            }
        }

        // (Pre-R51 cellGrid/cellPos maps were created here; those sub-maps
        // have been retired. Position identity lives in the in-memory
        // `GridIndex`, populated above.)
    }

    // Set up CellMirror
    let mut mirror = CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), rows, cols);
    mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);

    (doc, sheets_map, grid_index, mirror, sheet_id)
}

/// Add a cell to all three stores: yrs doc, GridIndex, CellMirror.
fn add_cell(
    doc: &Doc,
    sheets_map: &MapRef,
    grid_index: &mut GridIndex,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    cell_id: CellId,
    row: u32,
    col: u32,
    value: CellValue,
    formula: Option<String>,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());

    // Register in GridIndex
    grid_index.register_cell(cell_id, row, col);

    // Add to yrs doc
    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) {
            // Write to cells map
            if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS) {
                let cell_prelim = match &formula {
                    Some(f) => MapPrelim::from([
                        ("v", compute_document::cell_serde::cell_value_to_any(&value)),
                        ("f", yrs::Any::String(std::sync::Arc::from(f.as_str()))),
                    ]),
                    None => MapPrelim::from([(
                        "v",
                        compute_document::cell_serde::cell_value_to_any(&value),
                    )]),
                };
                cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
            }

            // (Pre-R51 cellGrid/cellPos writes removed; position mapping
            // is owned by GridIndex — already registered above.)
        }
    }

    // Add to CellMirror
    let _ = formula; // formula string was written to yrs above
    let entry = CellEntry {
        value,
        formula: None,
    };
    mirror.insert_cell(sheet_id, cell_id, SheetPos::new(row, col), entry);
}

/// Read the row count from the rowOrder YArray length.
fn read_yrs_row_count(doc: &Doc, sheets_map: &MapRef, sheet_id: &SheetId) -> u32 {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) {
        if let Some(row_order) = get_row_order_array(&sheet_map, &txn) {
            return row_order.len(&txn);
        }
    }
    0
}

/// Read the col count from the colOrder YArray length.
fn read_yrs_col_count(doc: &Doc, sheets_map: &MapRef, sheet_id: &SheetId) -> u32 {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) {
        if let Some(col_order) = get_col_order_array(&sheet_map, &txn) {
            return col_order.len(&txn);
        }
    }
    0
}

/// Check if a cell exists in the yrs doc.
fn cell_exists_in_yrs(
    doc: &Doc,
    sheets_map: &MapRef,
    sheet_id: &SheetId,
    cell_id: &CellId,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let txn = doc.transact();
    if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) {
        if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS) {
            return cells_map.get(&txn, &*cell_hex).is_some();
        }
    }
    false
}

// -----------------------------------------------------------------------
// Test 1: Insert rows shifts cell positions down
// -----------------------------------------------------------------------

#[test]
fn test_insert_rows_shifts_cell_positions_down() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(10, 5);

    // Add cells at rows 0, 1, 2
    let c0 = make_cell_id(100);
    let c1 = make_cell_id(101);
    let c2 = make_cell_id(102);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c0,
        0,
        0,
        CellValue::Number(FiniteF64::must(10.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c1,
        1,
        0,
        CellValue::Number(FiniteF64::must(20.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c2,
        2,
        0,
        CellValue::Number(FiniteF64::must(30.0)),
        None,
    );

    // Insert 2 rows at row 1
    let new_rids =
        StructuralOps::insert_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 1, 2)
            .unwrap();

    assert_eq!(new_rids.len(), 2);

    // GridIndex: c0 stays at (0,0), c1 moves to (3,0), c2 moves to (4,0)
    assert_eq!(grid.cell_position(&c0), Some((0, 0)));
    assert_eq!(grid.cell_position(&c1), Some((3, 0)));
    assert_eq!(grid.cell_position(&c2), Some((4, 0)));
    assert_eq!(grid.row_count(), 12);

    // CellMirror: positions updated
    assert_eq!(mirror.resolve_position(&c0), Some(SheetPos::new(0, 0)));
    assert_eq!(mirror.resolve_position(&c1), Some(SheetPos::new(3, 0)));
    assert_eq!(mirror.resolve_position(&c2), Some(SheetPos::new(4, 0)));

    // Mirror row count updated
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.rows, 12);

    // Yrs doc: rowOrder length updated
    assert_eq!(read_yrs_row_count(&doc, &sheets_map, &sheet_id), 12);
}

// -----------------------------------------------------------------------
// Test 2: Delete rows removes cells and shifts remaining up
// -----------------------------------------------------------------------

#[test]
fn test_delete_rows_removes_and_shifts_up() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(10, 5);

    let c0 = make_cell_id(200);
    let c1 = make_cell_id(201);
    let c2 = make_cell_id(202);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c0,
        0,
        0,
        CellValue::Number(FiniteF64::must(10.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c1,
        1,
        0,
        CellValue::Number(FiniteF64::must(20.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c2,
        3,
        0,
        CellValue::Number(FiniteF64::must(40.0)),
        None,
    );

    // Delete row 1 (1 row)
    let deleted =
        StructuralOps::delete_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 1, 1)
            .unwrap();

    // c1 was at row 1, should be deleted
    assert_eq!(deleted.len(), 1);
    assert_eq!(deleted[0], c1);

    // GridIndex: c0 at (0,0), c1 gone, c2 shifted from (3,0) to (2,0)
    assert_eq!(grid.cell_position(&c0), Some((0, 0)));
    assert!(grid.cell_position(&c1).is_none());
    assert_eq!(grid.cell_position(&c2), Some((2, 0)));
    assert_eq!(grid.row_count(), 9);

    // CellMirror: positions updated
    assert!(mirror.get_cell_value(&c1).is_none());
    assert_eq!(mirror.resolve_position(&c2), Some(SheetPos::new(2, 0)));

    // Mirror row count
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.rows, 9);

    // Yrs doc: c1 removed, rowOrder length updated
    assert!(!cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c1));
    assert!(cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c0));
    assert_eq!(read_yrs_row_count(&doc, &sheets_map, &sheet_id), 9);
}

// -----------------------------------------------------------------------
// Test 3: Insert cols shifts cell positions right
// -----------------------------------------------------------------------

#[test]
fn test_insert_cols_shifts_cell_positions_right() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(5, 5);

    let c0 = make_cell_id(300);
    let c1 = make_cell_id(301);
    let c2 = make_cell_id(302);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c0,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c1,
        0,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c2,
        0,
        3,
        CellValue::Number(FiniteF64::must(4.0)),
        None,
    );

    // Insert 2 cols at col 1
    let new_cids =
        StructuralOps::insert_cols(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 1, 2)
            .unwrap();

    assert_eq!(new_cids.len(), 2);

    // GridIndex: c0 at (0,0), c1 moves to (0,3), c2 moves to (0,5)
    assert_eq!(grid.cell_position(&c0), Some((0, 0)));
    assert_eq!(grid.cell_position(&c1), Some((0, 3)));
    assert_eq!(grid.cell_position(&c2), Some((0, 5)));
    assert_eq!(grid.col_count(), 7);

    // CellMirror: positions updated
    assert_eq!(mirror.resolve_position(&c0), Some(SheetPos::new(0, 0)));
    assert_eq!(mirror.resolve_position(&c1), Some(SheetPos::new(0, 3)));
    assert_eq!(mirror.resolve_position(&c2), Some(SheetPos::new(0, 5)));

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.cols, 7);

    // Yrs doc: colOrder length updated
    assert_eq!(read_yrs_col_count(&doc, &sheets_map, &sheet_id), 7);
}

// -----------------------------------------------------------------------
// Test 4: Delete cols removes cells and shifts remaining left
// -----------------------------------------------------------------------

#[test]
fn test_delete_cols_removes_and_shifts_left() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(5, 5);

    let c0 = make_cell_id(400);
    let c1 = make_cell_id(401);
    let c2 = make_cell_id(402);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c0,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c1,
        0,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c2,
        0,
        3,
        CellValue::Number(FiniteF64::must(4.0)),
        None,
    );

    // Delete col 1 (1 col)
    let deleted =
        StructuralOps::delete_cols(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 1, 1)
            .unwrap();

    assert_eq!(deleted.len(), 1);
    assert_eq!(deleted[0], c1);

    // GridIndex: c0 at (0,0), c1 gone, c2 from (0,3) to (0,2)
    assert_eq!(grid.cell_position(&c0), Some((0, 0)));
    assert!(grid.cell_position(&c1).is_none());
    assert_eq!(grid.cell_position(&c2), Some((0, 2)));
    assert_eq!(grid.col_count(), 4);

    // CellMirror
    assert!(mirror.get_cell_value(&c1).is_none());
    assert_eq!(mirror.resolve_position(&c2), Some(SheetPos::new(0, 2)));

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.cols, 4);

    // Yrs doc
    assert!(!cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c1));
    assert_eq!(read_yrs_col_count(&doc, &sheets_map, &sheet_id), 4);
}

// -----------------------------------------------------------------------
// Test 5: Insert at beginning vs middle vs end
// -----------------------------------------------------------------------

#[test]
fn test_insert_rows_at_beginning() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(5, 3);

    let c = make_cell_id(500);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        None,
    );

    // Insert at row 0 (beginning)
    StructuralOps::insert_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 0, 3).unwrap();

    // Cell should shift down by 3
    assert_eq!(grid.cell_position(&c), Some((3, 0)));
    assert_eq!(mirror.resolve_position(&c), Some(SheetPos::new(3, 0)));
    assert_eq!(grid.row_count(), 8);
    assert_eq!(read_yrs_row_count(&doc, &sheets_map, &sheet_id), 8);
}

#[test]
fn test_insert_rows_at_end() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(5, 3);

    let c = make_cell_id(501);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c,
        2,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        None,
    );

    // Insert at row 5 (end, past all cells)
    StructuralOps::insert_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 5, 3).unwrap();

    // Cell position unchanged
    assert_eq!(grid.cell_position(&c), Some((2, 0)));
    assert_eq!(mirror.resolve_position(&c), Some(SheetPos::new(2, 0)));
    assert_eq!(grid.row_count(), 8);
}

#[test]
fn test_insert_cols_at_beginning() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(3, 5);

    let c = make_cell_id(502);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        None,
    );

    // Insert at col 0
    StructuralOps::insert_cols(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 0, 2).unwrap();

    assert_eq!(grid.cell_position(&c), Some((0, 2)));
    assert_eq!(mirror.resolve_position(&c), Some(SheetPos::new(0, 2)));
    assert_eq!(grid.col_count(), 7);
}

// -----------------------------------------------------------------------
// Test 6: Delete all rows in range
// -----------------------------------------------------------------------

#[test]
fn test_delete_all_rows_with_cells() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(5, 3);

    // Add cells in rows 0, 1, 2
    let c0 = make_cell_id(600);
    let c1 = make_cell_id(601);
    let c2 = make_cell_id(602);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c0,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c1,
        1,
        0,
        CellValue::Number(FiniteF64::must(2.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c2,
        2,
        0,
        CellValue::Number(FiniteF64::must(3.0)),
        None,
    );

    // Delete rows 0-2 (all rows with cells)
    let deleted =
        StructuralOps::delete_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 0, 3)
            .unwrap();

    assert_eq!(deleted.len(), 3);

    // All cells gone
    assert!(grid.cell_position(&c0).is_none());
    assert!(grid.cell_position(&c1).is_none());
    assert!(grid.cell_position(&c2).is_none());
    assert_eq!(grid.cell_count(), 0);
    assert_eq!(grid.row_count(), 2); // 5 - 3 = 2

    // Mirror also empty
    assert!(mirror.get_cell_value(&c0).is_none());
    assert!(mirror.get_cell_value(&c1).is_none());
    assert!(mirror.get_cell_value(&c2).is_none());

    // Yrs doc: all cells removed
    assert!(!cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c0));
    assert!(!cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c1));
    assert!(!cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c2));
    assert_eq!(read_yrs_row_count(&doc, &sheets_map, &sheet_id), 2);
}

// -----------------------------------------------------------------------
// Test 7: Multiple structural operations in sequence
// -----------------------------------------------------------------------

#[test]
fn test_multiple_structural_operations_in_sequence() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(10, 10);

    // Add cell at (2, 2)
    let c = make_cell_id(700);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c,
        2,
        2,
        CellValue::Number(FiniteF64::must(42.0)),
        None,
    );

    // Step 1: Insert 2 rows at row 1 -> cell moves from (2,2) to (4,2)
    StructuralOps::insert_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 1, 2).unwrap();
    assert_eq!(grid.cell_position(&c), Some((4, 2)));
    assert_eq!(mirror.resolve_position(&c), Some(SheetPos::new(4, 2)));

    // Step 2: Insert 1 col at col 0 -> cell moves from (4,2) to (4,3)
    StructuralOps::insert_cols(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 0, 1).unwrap();
    assert_eq!(grid.cell_position(&c), Some((4, 3)));
    assert_eq!(mirror.resolve_position(&c), Some(SheetPos::new(4, 3)));

    // Step 3: Delete 1 row at row 0 -> cell moves from (4,3) to (3,3)
    StructuralOps::delete_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 0, 1).unwrap();
    assert_eq!(grid.cell_position(&c), Some((3, 3)));
    assert_eq!(mirror.resolve_position(&c), Some(SheetPos::new(3, 3)));

    // Step 4: Delete 1 col at col 0 -> cell moves from (3,3) to (3,2)
    StructuralOps::delete_cols(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 0, 1).unwrap();
    assert_eq!(grid.cell_position(&c), Some((3, 2)));
    assert_eq!(mirror.resolve_position(&c), Some(SheetPos::new(3, 2)));

    // Final dimensions: 10+2-1 = 11 rows, 10+1-1 = 10 cols
    assert_eq!(grid.row_count(), 11);
    assert_eq!(grid.col_count(), 10);
    assert_eq!(read_yrs_row_count(&doc, &sheets_map, &sheet_id), 11);
    assert_eq!(read_yrs_col_count(&doc, &sheets_map, &sheet_id), 10);

    // Cell value is preserved
    assert_eq!(
        *mirror.get_cell_value(&c).unwrap(),
        CellValue::Number(FiniteF64::must(42.0))
    );
}

// -----------------------------------------------------------------------
// Test 8: Structural operations with formulas (formulas preserved)
// -----------------------------------------------------------------------

#[test]
fn test_structural_ops_preserve_formulas() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(10, 5);

    // Add a cell with a formula at (1, 0)
    let c_formula = make_cell_id(800);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c_formula,
        1,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
        Some("=SUM(A1:A10)".to_string()),
    );

    // Add a plain value cell at (0, 0)
    let c_value = make_cell_id(801);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c_value,
        0,
        0,
        CellValue::Number(FiniteF64::must(10.0)),
        None,
    );

    // Insert 2 rows at row 1 -> formula cell moves from (1,0) to (3,0)
    StructuralOps::insert_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 1, 2).unwrap();

    // Cell positions shifted
    assert_eq!(grid.cell_position(&c_formula), Some((3, 0)));
    assert_eq!(grid.cell_position(&c_value), Some((0, 0)));

    // Formula cell still has its value and formula in mirror
    assert_eq!(
        *mirror.get_cell_value(&c_formula).unwrap(),
        CellValue::Number(FiniteF64::must(42.0))
    );
    // Formula is no longer stored in CellEntry (yrs doc is the authoritative source).
    assert!(mirror.get_formula(&c_formula).is_none());

    // Value cell unchanged
    assert_eq!(
        *mirror.get_cell_value(&c_value).unwrap(),
        CellValue::Number(FiniteF64::must(10.0))
    );

    // Both cells still exist in yrs doc
    assert!(cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c_formula));
    assert!(cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c_value));
}

// -----------------------------------------------------------------------
// Test 9: CellIds remain stable across structural changes
// -----------------------------------------------------------------------

#[test]
fn test_cell_ids_stable_across_structural_changes() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(10, 10);

    // Add several cells
    let cells: Vec<(CellId, u32, u32)> = vec![
        (make_cell_id(900), 0, 0),
        (make_cell_id(901), 2, 3),
        (make_cell_id(902), 5, 7),
        (make_cell_id(903), 8, 1),
    ];
    for &(cid, r, c) in &cells {
        add_cell(
            &doc,
            &sheets_map,
            &mut grid,
            &mut mirror,
            &sheet_id,
            cid,
            r,
            c,
            CellValue::Number(FiniteF64::must((r * 10 + c) as f64)),
            None,
        );
    }

    // Perform multiple structural operations
    StructuralOps::insert_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 3, 5).unwrap();
    StructuralOps::insert_cols(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 2, 3).unwrap();
    StructuralOps::delete_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 0, 1).unwrap();
    StructuralOps::delete_cols(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 0, 1).unwrap();

    // All surviving CellIds should still be retrievable with consistent positions
    // Cell 900 was at (0,0): delete_rows(0,1) removes it
    assert!(grid.cell_position(&make_cell_id(900)).is_none());

    // Cell 901 was at (2,3):
    //   insert_rows(3,5) -> (2,3) (before insertion point, no change)
    //   insert_cols(2,3) -> (2,6) (col 3 >= 2, shift right by 3)
    //   delete_rows(0,1) -> (1,6) (shift up by 1)
    //   delete_cols(0,1) -> (1,5) (shift left by 1)
    assert_eq!(grid.cell_position(&make_cell_id(901)), Some((1, 5)));
    assert_eq!(
        mirror.resolve_position(&make_cell_id(901)),
        Some(SheetPos::new(1, 5))
    );

    // Values preserved for surviving cells
    assert_eq!(
        *mirror.get_cell_value(&make_cell_id(901)).unwrap(),
        CellValue::Number(FiniteF64::must(23.0))
    );
}

// -----------------------------------------------------------------------
// Test 10: Yrs structural transaction uses ORIGIN_STRUCTURAL
// -----------------------------------------------------------------------

#[test]
fn test_structural_transaction_uses_correct_origin() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(10, 5);

    // Set up an UndoManager to verify the origin is correct
    let undo_mgr = compute_document::undo::UndoRedoManager::new(&doc, &sheets_map);

    // Perform a structural operation
    StructuralOps::insert_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 0, 1).unwrap();

    // The structural change should be tracked by the undo manager
    // (ORIGIN_STRUCTURAL is in the tracked origins)
    assert!(undo_mgr.can_undo());
    assert_eq!(undo_mgr.undo_depth(), 1);
}

// -----------------------------------------------------------------------
// Test 11: Delete rows with multiple cells per row
// -----------------------------------------------------------------------

#[test]
fn test_delete_rows_multiple_cells_per_row() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(5, 5);

    // Add 3 cells in row 1
    let c10 = make_cell_id(1100);
    let c11 = make_cell_id(1101);
    let c12 = make_cell_id(1102);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c10,
        1,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c11,
        1,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c12,
        1,
        2,
        CellValue::Number(FiniteF64::must(3.0)),
        None,
    );

    // Add a cell in row 3 (will shift)
    let c30 = make_cell_id(1130);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c30,
        3,
        0,
        CellValue::Number(FiniteF64::must(4.0)),
        None,
    );

    // Delete row 1
    let deleted =
        StructuralOps::delete_rows(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 1, 1)
            .unwrap();

    // All 3 cells in row 1 should be deleted
    assert_eq!(deleted.len(), 3);
    assert!(grid.cell_position(&c10).is_none());
    assert!(grid.cell_position(&c11).is_none());
    assert!(grid.cell_position(&c12).is_none());

    // Cell at row 3 should shift to row 2
    assert_eq!(grid.cell_position(&c30), Some((2, 0)));
    assert_eq!(mirror.resolve_position(&c30), Some(SheetPos::new(2, 0)));

    // Yrs: all deleted cells removed
    assert!(!cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c10));
    assert!(!cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c11));
    assert!(!cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c12));
    assert!(cell_exists_in_yrs(&doc, &sheets_map, &sheet_id, &c30));
}

// -----------------------------------------------------------------------
// Test 12: Delete cols spanning multiple columns
// -----------------------------------------------------------------------

#[test]
fn test_delete_multiple_cols() {
    let (doc, sheets_map, mut grid, mut mirror, sheet_id) = setup_test_env(5, 10);

    // Add cells across cols 0-5
    let c0 = make_cell_id(1200);
    let c2 = make_cell_id(1202);
    let c5 = make_cell_id(1205);
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c0,
        0,
        0,
        CellValue::Number(FiniteF64::must(0.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c2,
        0,
        2,
        CellValue::Number(FiniteF64::must(2.0)),
        None,
    );
    add_cell(
        &doc,
        &sheets_map,
        &mut grid,
        &mut mirror,
        &sheet_id,
        c5,
        0,
        5,
        CellValue::Number(FiniteF64::must(5.0)),
        None,
    );

    // Delete cols 1-3 (3 cols)
    let deleted =
        StructuralOps::delete_cols(&doc, &sheets_map, &mut grid, &mut mirror, &sheet_id, 1, 3)
            .unwrap();

    // c2 was at col 2 (in range 1..4), should be deleted
    assert_eq!(deleted.len(), 1);
    assert_eq!(deleted[0], c2);

    // c0 at col 0 unchanged
    assert_eq!(grid.cell_position(&c0), Some((0, 0)));

    // c5 was at col 5, shifts left by 3 to col 2
    assert_eq!(grid.cell_position(&c5), Some((0, 2)));
    assert_eq!(mirror.resolve_position(&c5), Some(SheetPos::new(0, 2)));

    assert_eq!(grid.col_count(), 7); // 10 - 3
    assert_eq!(read_yrs_col_count(&doc, &sheets_map, &sheet_id), 7);
}
