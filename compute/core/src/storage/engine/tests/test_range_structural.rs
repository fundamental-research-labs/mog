//! pass 3 gate tests: structural operations on Range-backed sheets.
//!
//! Verifies that insert/delete rows/cols correctly interact with Elastic
//! and Strict Range anchors, preserving payload values, cleaning overrides,
//! and updating dependent formulas.
//!
//! **ID alignment note:** `YrsStorage::populate_yrs_doc` uses a fresh
//! `IdAllocator::new()` (starting at 1) to generate sequential row/col IDs
//! for the Yrs `rowOrder`/`colOrder` arrays. For a sheet with `rows: R,
//! cols: C`, row IDs are `1..=R` and col IDs are `(R+1)..=(R+C)`. The
//! Range's `row_ids`/`col_ids` must reference these same identities so the
//! spatial index maps them to display positions.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{RangeData, SheetSnapshot};
use cell_types::{ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId, SheetPos};
use formula_types::StructureChange;
use value_types::{CellValue, FiniteF64};

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const SHEET_UUID: &str = "a0000000-0000-4000-8000-000000000001";
const RANGE_UUID: &str = "b0000000-0000-4000-8000-000000000001";

/// For a sheet with `rows: 10, cols: 5`, `IdAllocator::new()` (starting at 1)
/// generates:
///   row IDs: 1..=10   (RowId(1) through RowId(10))
///   col IDs: 11..=15  (ColId(11) through ColId(15))
///
/// Our Range covers the first 5 rows and first 2 cols:
///   row IDs: [1, 2, 3, 4, 5]
///   col IDs: [11, 12]

fn yrs_row_id(i: usize) -> RowId {
    // IdAllocator starts at 1, rows are allocated first
    RowId::from_raw((i + 1) as u128)
}

fn yrs_col_id(sheet_rows: usize, i: usize) -> ColId {
    // Cols are allocated after all rows
    ColId::from_raw((sheet_rows + i + 1) as u128)
}

fn test_sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

fn test_range_id() -> RangeId {
    RangeId::from_uuid_str(RANGE_UUID).unwrap()
}

// -------------------------------------------------------------------
// Snapshot builders
// -------------------------------------------------------------------

/// Build a WorkbookSnapshot with a single sheet (10 rows, 5 cols) containing
/// a 5-row, 2-col Elastic Range with f64 payload values:
///   row0: [1, 10]
///   row1: [2, 20]
///   row2: [3, 30]
///   row3: [4, 40]
///   row4: [5, 50]
fn range_backed_snapshot() -> WorkbookSnapshot {
    const SHEET_ROWS: usize = 10;
    const SHEET_COLS: usize = 5;
    const RANGE_ROWS: usize = 5;
    const RANGE_COLS: usize = 2;

    let mut payload = Vec::new();
    for row_vals in &[
        [1.0_f64, 10.0],
        [2.0, 20.0],
        [3.0, 30.0],
        [4.0, 40.0],
        [5.0, 50.0],
    ] {
        for &v in row_vals {
            payload.extend_from_slice(&v.to_le_bytes());
        }
    }

    let row_ids: Vec<RowId> = (0..RANGE_ROWS).map(yrs_row_id).collect();
    let col_ids: Vec<ColId> = (0..RANGE_COLS).map(|i| yrs_col_id(SHEET_ROWS, i)).collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: SHEET_ROWS as u32,
            cols: SHEET_COLS as u32,
            cells: vec![],
            ranges: vec![RangeData {
                range_id: test_range_id(),
                kind: RangeKind::Data,
                anchor: RangeAnchor::Elastic {
                    start_row: row_ids[0],
                    end_row: row_ids[RANGE_ROWS - 1],
                    start_col: col_ids[0],
                    end_col: col_ids[RANGE_COLS - 1],
                },
                encoding: PayloadEncoding::F64Le,
                payload,
                row_axis: None,
                col_axis: None,
                row_ids: row_ids.to_vec(),
                col_ids: col_ids.to_vec(),
            }],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Build a WorkbookSnapshot with a 1-row, 1-col Elastic Range (value = 42).
fn single_row_range_snapshot() -> WorkbookSnapshot {
    const SHEET_ROWS: usize = 5;
    const SHEET_COLS: usize = 3;

    let payload = 42.0_f64.to_le_bytes().to_vec();
    let rid = yrs_row_id(0);
    let cid = yrs_col_id(SHEET_ROWS, 0);

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: SHEET_ROWS as u32,
            cols: SHEET_COLS as u32,
            cells: vec![],
            ranges: vec![RangeData {
                range_id: test_range_id(),
                kind: RangeKind::Data,
                anchor: RangeAnchor::Elastic {
                    start_row: rid,
                    end_row: rid,
                    start_col: cid,
                    end_col: cid,
                },
                encoding: PayloadEncoding::F64Le,
                payload,
                row_axis: None,
                col_axis: None,
                row_ids: vec![rid],
                col_ids: vec![cid],
            }],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Build a Strict Range snapshot: 3 rows x 1 col with values [100, 200, 300].
fn strict_range_snapshot() -> WorkbookSnapshot {
    const SHEET_ROWS: usize = 10;
    const SHEET_COLS: usize = 5;

    let mut payload = Vec::new();
    for &v in &[100.0_f64, 200.0, 300.0] {
        payload.extend_from_slice(&v.to_le_bytes());
    }

    let rids: Vec<RowId> = (0..3).map(yrs_row_id).collect();
    let cids = vec![yrs_col_id(SHEET_ROWS, 0)];

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: SHEET_ROWS as u32,
            cols: SHEET_COLS as u32,
            cells: vec![],
            ranges: vec![RangeData {
                range_id: test_range_id(),
                kind: RangeKind::Data,
                anchor: RangeAnchor::Strict {
                    row_ids: rids.clone(),
                    col_ids: cids.clone(),
                },
                encoding: PayloadEncoding::F64Le,
                payload,
                row_axis: None,
                col_axis: None,
                row_ids: rids,
                col_ids: cids,
            }],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Extract a numeric f64 from a CellValue, returning None if Null or non-numeric.
fn as_f64(val: Option<&CellValue>) -> Option<f64> {
    match val {
        Some(CellValue::Number(n)) => Some(f64::from(*n)),
        _ => None,
    }
}

// ===================================================================
// Test 1: Insert row grows an Elastic Range
// ===================================================================

#[test]
fn range_elastic_insert_grows() {
    let snap = range_backed_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Before: rows 0..4 have col-0 values [1,2,3,4,5]
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(1.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 0))),
        Some(2.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 0))),
        Some(3.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 0))),
        Some(4.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 0))),
        Some(5.0)
    );

    // Insert 1 row at position 2 (pushes rows 2..4 down by 1).
    let new_row = RowId::from_raw(0xE001);
    let change = StructureChange::InsertRows {
        at: 2,
        count: 1,
        new_row_ids: vec![new_row],
    };
    engine.structure_change(&sid, &change).unwrap();

    // After insertion the display positions should read:
    //   row 0 -> 1, row 1 -> 2, row 2 -> Null (new), row 3 -> 3, row 4 -> 4, row 5 -> 5
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(1.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 0))),
        Some(2.0)
    );
    // The inserted row should be Null (no payload entry)
    let inserted = engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 0));
    assert!(
        inserted.is_none() || inserted == Some(&CellValue::Null),
        "Inserted row should be Null, got: {:?}",
        inserted
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 0))),
        Some(3.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 0))),
        Some(4.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(5, 0))),
        Some(5.0)
    );

    // Also check col 1 values shifted correctly
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(10.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 1))),
        Some(20.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 1))),
        Some(30.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(5, 1))),
        Some(50.0)
    );
}

// ===================================================================
// Test 2: Delete anchor rows from an Elastic Range
// ===================================================================

#[test]
fn range_elastic_anchor_reassignment() {
    let snap = range_backed_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Verify initial 5 values in col 0
    for r in 0..5u32 {
        assert!(
            as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(r, 0))).is_some(),
            "Row {} should have a value before any deletes",
            r
        );
    }

    // Delete the first row (start anchor row).
    let change = StructureChange::DeleteRows {
        at: 0,
        count: 1,
        deleted_cell_ids: vec![],
    };
    engine.structure_change(&sid, &change).unwrap();

    // After deleting row 0, the old rows 1..4 shift to 0..3.
    // Range should still exist with 4 values: [2, 3, 4, 5] in col 0.
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(2.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 0))),
        Some(5.0)
    );

    // Delete the last row (now at position 3 = end anchor).
    let change2 = StructureChange::DeleteRows {
        at: 3,
        count: 1,
        deleted_cell_ids: vec![],
    };
    engine.structure_change(&sid, &change2).unwrap();

    // Range should have 3 values: [2, 3, 4]
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(2.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 0))),
        Some(3.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 0))),
        Some(4.0)
    );

    // Delete all remaining 3 rows.
    let change3 = StructureChange::DeleteRows {
        at: 0,
        count: 3,
        deleted_cell_ids: vec![],
    };
    engine.structure_change(&sid, &change3).unwrap();

    // After all rows gone, values should be Null.
    let v = engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0));
    assert!(
        v.is_none() || v == Some(&CellValue::Null),
        "All range rows deleted: position should be Null, got: {:?}",
        v
    );
}

// ===================================================================
// Test 3: Delete the only row of a 1-row Elastic Range
// ===================================================================

#[test]
fn range_elastic_single_row_delete() {
    let snap = single_row_range_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Verify the single value exists
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(42.0)
    );

    // Delete the only row
    let change = StructureChange::DeleteRows {
        at: 0,
        count: 1,
        deleted_cell_ids: vec![],
    };
    engine.structure_change(&sid, &change).unwrap();

    // The range should be gone; all positions read Null
    let v = engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0));
    assert!(
        v.is_none() || v == Some(&CellValue::Null),
        "Single-row Range deleted: position should be Null, got: {:?}",
        v
    );
}

// ===================================================================
// Test 4: Insert near a Strict Range leaves it unchanged
// ===================================================================

#[test]
fn range_strict_insert_unchanged() {
    let snap = strict_range_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Before: rows 0,1,2 have values [100, 200, 300]
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(100.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 0))),
        Some(200.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 0))),
        Some(300.0)
    );

    // Insert 1 row at position 1 (between the strict range rows).
    let new_row = RowId::from_raw(0xE002);
    let change = StructureChange::InsertRows {
        at: 1,
        count: 1,
        new_row_ids: vec![new_row],
    };
    engine.structure_change(&sid, &change).unwrap();

    // The strict range rows shift with the grid: row 0 stays, row 1 -> 2, row 2 -> 3.
    // Values remain bound to their row_ids so they follow the shift.
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(100.0)
    );
    // Inserted row at position 1 has no range value
    let inserted = engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 0));
    assert!(
        inserted.is_none() || inserted == Some(&CellValue::Null),
        "Inserted row in strict range should be Null, got: {:?}",
        inserted
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 0))),
        Some(200.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 0))),
        Some(300.0)
    );
}

// ===================================================================
// Test 5: Delete row cleans up per-cell overrides
// ===================================================================

#[test]
fn range_delete_cleans_overrides() {
    let snap = range_backed_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Override row 2, col 0 (original Range value = 3.0) with a per-cell edit.
    let override_cell_id = CellId::from_uuid_str("f0000000-0000-4000-8000-000000000001").unwrap();
    engine
        .set_cell(
            &sid,
            override_cell_id,
            2,
            0,
            crate::bridge_types::CellInput::Parse { text: "999".into() },
        )
        .unwrap();

    // Verify the override is visible
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 0))),
        Some(999.0)
    );

    // Delete row 2 (the overridden row).
    let change = StructureChange::DeleteRows {
        at: 2,
        count: 1,
        deleted_cell_ids: vec![override_cell_id],
    };
    engine.structure_change(&sid, &change).unwrap();

    // Row 2 is now what was row 3 (value = 4.0). The override should be gone.
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 0))),
        Some(4.0),
        "After deleting the overridden row, the next Range value should appear"
    );
}

// ===================================================================
// Test 6: Formula referencing Range cells survives structural insert
// ===================================================================

#[test]
fn range_formula_survives_structural() {
    let snap = range_backed_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Set a formula cell at (0, 2) = =A1+A2 AFTER engine creation so that
    // Range values are already materialized in col_data (finalize_range_hydration
    // runs after init_from_snapshot's recalc).
    let formula_cell_id = CellId::from_uuid_str("f1000000-0000-4000-8000-000000000001").unwrap();
    engine
        .set_cell(
            &sid,
            formula_cell_id,
            0,
            2,
            crate::bridge_types::CellInput::Parse {
                text: "=A1+A2".into(),
            },
        )
        .unwrap();

    // Verify formula result: A1 + A2 = 1 + 2 = 3
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 2))),
        Some(3.0),
        "Formula =A1+A2 should evaluate to 3"
    );

    // Insert a row at position 0 (pushes everything down by 1).
    let new_row = RowId::from_raw(0xE003);
    let change = StructureChange::InsertRows {
        at: 0,
        count: 1,
        new_row_ids: vec![new_row],
    };
    engine.structure_change(&sid, &change).unwrap();

    // The formula cell moved from (0,2) to (1,2).
    // Its references should have adjusted: =A2+A3 = 1 + 2 = 3
    let formula_val = as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 2)));
    assert_eq!(
        formula_val,
        Some(3.0),
        "After insert at row 0, formula should still compute 1+2=3 with shifted refs"
    );
}

// ===================================================================
// Test 7: SUM over an Elastic Range recalculates after insert
// ===================================================================

#[test]
fn range_elastic_insert_dep_reexpansion() {
    let snap = range_backed_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Set SUM formula at (6, 0) AFTER engine creation so Range values are
    // already materialized.
    let sum_cell_id = CellId::from_uuid_str("f2000000-0000-4000-8000-000000000001").unwrap();
    engine
        .set_cell(
            &sid,
            sum_cell_id,
            6,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "=SUM(A1:A5)".into(),
            },
        )
        .unwrap();

    // Verify SUM = 1+2+3+4+5 = 15
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(6, 0))),
        Some(15.0),
        "SUM(A1:A5) should be 15"
    );

    // Insert a row at position 2 (between the range rows).
    let new_row = RowId::from_raw(0xE004);
    let change = StructureChange::InsertRows {
        at: 2,
        count: 1,
        new_row_ids: vec![new_row],
    };
    engine.structure_change(&sid, &change).unwrap();

    // The SUM formula should have expanded to =SUM(A1:A6) and the new row
    // has Null (treated as 0), so SUM should still be 15.
    // The formula cell itself moved from row 6 to row 7.
    let sum_val = as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(7, 0)));
    assert_eq!(
        sum_val,
        Some(15.0),
        "After inserting a Null row, SUM should still be 15 (Null treated as 0)"
    );
}

// ===================================================================
// Test 8: XLSX-like structural roundtrip (insert then delete)
// ===================================================================

#[test]
fn xlsx_structural_roundtrip() {
    let snap = range_backed_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Insert 1 row at position 1.
    let new_row = RowId::from_raw(0xE005);
    let insert = StructureChange::InsertRows {
        at: 1,
        count: 1,
        new_row_ids: vec![new_row],
    };
    engine.structure_change(&sid, &insert).unwrap();

    // After insert: [1, Null, 2, 3, 4, 5] in col 0
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(1.0)
    );
    let v1 = engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 0));
    assert!(v1.is_none() || v1 == Some(&CellValue::Null));
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 0))),
        Some(2.0)
    );

    // Now delete the row we just inserted (row 1).
    let delete = StructureChange::DeleteRows {
        at: 1,
        count: 1,
        deleted_cell_ids: vec![],
    };
    engine.structure_change(&sid, &delete).unwrap();

    // After roundtrip: should be back to [1, 2, 3, 4, 5]
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(1.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 0))),
        Some(2.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 0))),
        Some(3.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 0))),
        Some(4.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 0))),
        Some(5.0)
    );
}

// ===================================================================
// Test 9: Insert rows + delete rows roundtrip on Elastic Range
// ===================================================================

#[test]
fn xlsx_rowcol_insert_delete_roundtrip() {
    let snap = range_backed_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Verify initial 2-col extent: col 0 and col 1
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(1.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(10.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 0))),
        Some(5.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 1))),
        Some(50.0)
    );

    // Insert 2 rows at position 3.
    let new_r1 = RowId::from_raw(0xE006);
    let new_r2 = RowId::from_raw(0xE007);
    let insert_rows = StructureChange::InsertRows {
        at: 3,
        count: 2,
        new_row_ids: vec![new_r1, new_r2],
    };
    engine.structure_change(&sid, &insert_rows).unwrap();

    // After insert: rows 0,1,2 unchanged, rows 3,4 = Null, rows 5,6 = old rows 3,4.
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(1.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 0))),
        Some(2.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 0))),
        Some(3.0)
    );
    let v3 = engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 0));
    assert!(v3.is_none() || v3 == Some(&CellValue::Null));
    let v4 = engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 0));
    assert!(v4.is_none() || v4 == Some(&CellValue::Null));
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(5, 0))),
        Some(4.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(6, 0))),
        Some(5.0)
    );

    // Verify col 1 also shifted correctly after row insert.
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(10.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(5, 1))),
        Some(40.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(6, 1))),
        Some(50.0)
    );

    // Delete the 2 rows we just inserted (at positions 3 and 4).
    let delete_rows = StructureChange::DeleteRows {
        at: 3,
        count: 2,
        deleted_cell_ids: vec![],
    };
    engine.structure_change(&sid, &delete_rows).unwrap();

    // After roundtrip, should be back to original [1,2,3,4,5] in col 0
    // and [10,20,30,40,50] in col 1.
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 0))),
        Some(1.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 0))),
        Some(2.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 0))),
        Some(3.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 0))),
        Some(4.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 0))),
        Some(5.0)
    );

    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(10.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 1))),
        Some(20.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 1))),
        Some(30.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 1))),
        Some(40.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 1))),
        Some(50.0)
    );
}
