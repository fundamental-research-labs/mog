//! pass 6 §7 — Virtual identity regression suite.
//!
//! Tests the cell identity resolution APIs (`resolve_cell_id`,
//! `resolve_position`, `sheet_for_cell`, `get_cell_value_at`) that
//! underpin virtual CellId behavior for Range-resident positions.
//!
//! In the current codebase, CellIds are assigned during snapshot
//! hydration for every cell in the snapshot. These tests verify that
//! the identity-resolution round-trips are correct and stable across
//! mutations (edit, sort, insert/delete rows) — properties that virtual
//! CellIds derived from `(SheetId, RowId, ColId)` must also satisfy.
//!
//! Tests cover Range-first-class types including virtual CellId
//! derivation from `(SheetId, RowId, ColId)`, sub-256 Range reverse
//! resolution, and compaction stability.
//!
//! Run:
//!   cargo test -p compute-core --test range_virtual_identity_regression -- --nocapture

use cell_types::{
    CellId, ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId, SheetId, SheetPos,
};
use compute_core::bridge_types::{BridgeSortCriterion, BridgeSortMode, BridgeSortOptions};
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::filter::SortOrder;
use formula_types::StructureChange;
use snapshot_types::{CellData, RangeData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

fn sheet_id(idx: u32) -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid(idx)).expect("valid sheet uuid")
}

fn cell_id(sheet_idx: u32, row: u32, col: u32) -> CellId {
    CellId::from_uuid_str(&cell_uuid(sheet_idx, row, col)).expect("valid cell uuid")
}

fn value_cell(sheet_idx: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn formula_cell(sheet_idx: u32, row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value: CellValue::Null,
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn sheet_snap(idx: u32, name: &str, cells: Vec<CellData>) -> SheetSnapshot {
    SheetSnapshot {
        id: sheet_uuid(idx),
        name: name.to_string(),
        rows: 100,
        cols: 26,
        cells,
        ranges: vec![],
    }
}

fn cell_at(engine: &YrsComputeEngine, sid: &SheetId, row: u32, col: u32) -> CellValue {
    engine
        .mirror()
        .get_cell_value_at(sid, SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

fn as_f64(cv: &CellValue) -> f64 {
    match cv {
        CellValue::Number(n) => n.get(),
        _ => f64::NAN,
    }
}

/// Build a workbook with data in A1:A5 (values 10,20,30,40,50)
/// and a formula in B1 = A3 (referencing a specific cell).
fn workbook_with_ref() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![sheet_snap(
            0,
            "Sheet1",
            vec![
                value_cell(0, 0, 0, 10.0),
                value_cell(0, 1, 0, 20.0),
                value_cell(0, 2, 0, 30.0),
                value_cell(0, 3, 0, 40.0),
                value_cell(0, 4, 0, 50.0),
                formula_cell(0, 0, 1, "A3"),
            ],
        )],
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Test 1: Formula refs cell before edit
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_formula_refs_cell_before_edit() {
    let (engine, _) = YrsComputeEngine::from_snapshot(workbook_with_ref()).expect("from_snapshot");
    let sid = sheet_id(0);

    // B1 = A3 should evaluate to 30.
    let b1 = cell_at(&engine, &sid, 0, 1);
    assert!(
        (as_f64(&b1) - 30.0).abs() < 1e-9,
        "B1 = A3 should be 30, got {:?}",
        b1
    );

    // Verify the CellId at A3 resolves correctly.
    let a3_cell = cell_id(0, 2, 0);
    let resolved = engine.mirror().resolve_position(&a3_cell);
    assert!(
        resolved.is_some(),
        "resolve_position for A3's CellId should return Some"
    );
    let pos = resolved.unwrap();
    assert_eq!(pos.row(), 2, "A3 should be at row 2");
    assert_eq!(pos.col(), 0, "A3 should be at col 0");
}

// ---------------------------------------------------------------------------
// Test 2: Formula refs cell after edit
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_formula_refs_cell_after_edit() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_with_ref()).expect("from_snapshot");
    let sid = sheet_id(0);
    let a3_cell = cell_id(0, 2, 0);

    // Edit A3 from 30 to 99.
    engine
        .set_cell(&sid, a3_cell, 2, 0, "99".into())
        .expect("set_cell");

    // B1 = A3 should now be 99.
    let b1 = cell_at(&engine, &sid, 0, 1);
    assert!(
        (as_f64(&b1) - 99.0).abs() < 1e-9,
        "B1 = A3 should be 99 after edit, got {:?}",
        b1
    );

    // The CellId for A3 should still resolve to the same position.
    let resolved = engine.mirror().resolve_position(&a3_cell);
    assert!(
        resolved.is_some(),
        "A3 CellId should still resolve after edit"
    );
    let pos = resolved.unwrap();
    assert_eq!(pos.row(), 2, "A3 CellId should still be at row 2");
    assert_eq!(pos.col(), 0, "A3 CellId should still be at col 0");

    // The cell value via CellId should be the override (99).
    let val = engine
        .mirror()
        .get_cell_value(&a3_cell)
        .cloned()
        .unwrap_or(CellValue::Null);
    assert!(
        (as_f64(&val) - 99.0).abs() < 1e-9,
        "get_cell_value(A3 CellId) should return override 99, got {:?}",
        val
    );
}

// ---------------------------------------------------------------------------
// Test 3: resolve_cell_id returns correct CellId for position
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_resolve_cell_id_for_position() {
    let (engine, _) = YrsComputeEngine::from_snapshot(workbook_with_ref()).expect("from_snapshot");
    let sid = sheet_id(0);

    // Resolve position (2, 0) = A3 to its CellId.
    let resolved = engine.mirror().resolve_cell_id(&sid, SheetPos::new(2, 0));
    assert!(
        resolved.is_some(),
        "resolve_cell_id(sheet, (2,0)) should return a CellId for A3"
    );

    let cid = resolved.unwrap();
    // The resolved CellId should match the one we seeded in the snapshot.
    let expected = cell_id(0, 2, 0);
    assert_eq!(
        cid, expected,
        "resolve_cell_id should return the seeded CellId for A3"
    );
}

// ---------------------------------------------------------------------------
// Test 4: resolve_position(cell_id) returns correct position
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_resolve_position_returns_correct_pos() {
    let (engine, _) = YrsComputeEngine::from_snapshot(workbook_with_ref()).expect("from_snapshot");

    // For each seeded cell, verify resolve_position returns the correct row/col.
    let cases: Vec<(u32, u32, f64)> = vec![
        (0, 0, 10.0),
        (1, 0, 20.0),
        (2, 0, 30.0),
        (3, 0, 40.0),
        (4, 0, 50.0),
    ];

    for (row, col, _expected_val) in &cases {
        let cid = cell_id(0, *row, *col);
        let pos = engine.mirror().resolve_position(&cid);
        assert!(
            pos.is_some(),
            "resolve_position for cell at ({}, {}) should return Some",
            row,
            col
        );
        let p = pos.unwrap();
        assert_eq!(
            p.row(),
            *row,
            "resolve_position row mismatch for ({}, {})",
            row,
            col
        );
        assert_eq!(
            p.col(),
            *col,
            "resolve_position col mismatch for ({}, {})",
            row,
            col
        );
    }
}

// ---------------------------------------------------------------------------
// Test 5: sheet_for_cell(cell_id)
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_sheet_for_cell() {
    let (engine, _) = YrsComputeEngine::from_snapshot(workbook_with_ref()).expect("from_snapshot");
    let expected_sid = sheet_id(0);

    for row in 0..5u32 {
        let cid = cell_id(0, row, 0);
        let sid = engine.mirror().sheet_for_cell(&cid);
        assert!(
            sid.is_some(),
            "sheet_for_cell for row {} should return Some",
            row
        );
        assert_eq!(
            sid.unwrap(),
            expected_sid,
            "sheet_for_cell should return the correct sheet"
        );
    }

    // Formula cell in B1 also belongs to the same sheet.
    let b1 = cell_id(0, 0, 1);
    let sid = engine.mirror().sheet_for_cell(&b1);
    assert!(
        sid.is_some(),
        "sheet_for_cell for B1 formula should return Some"
    );
    assert_eq!(sid.unwrap(), expected_sid);
}

// ---------------------------------------------------------------------------
// Test 6: get_cell_value_at returns override or payload
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_get_cell_value_at_returns_correct_value() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_with_ref()).expect("from_snapshot");
    let sid = sheet_id(0);

    // Before edit: get_cell_value_at(A3) returns the original value (30).
    let pre = cell_at(&engine, &sid, 2, 0);
    assert_eq!(as_f64(&pre), 30.0, "A3 should be 30 before edit");

    // Edit A3 to 99.
    let a3 = cell_id(0, 2, 0);
    engine
        .set_cell(&sid, a3, 2, 0, "99".into())
        .expect("set_cell");

    // After edit: get_cell_value_at(A3) returns the override (99).
    let post = cell_at(&engine, &sid, 2, 0);
    assert_eq!(as_f64(&post), 99.0, "A3 should be 99 after edit (override)");

    // Undo: get_cell_value_at(A3) should return the original (30).
    engine.undo().expect("undo");
    let undo = cell_at(&engine, &sid, 2, 0);
    assert_eq!(as_f64(&undo), 30.0, "A3 should be 30 after undo");
}

// ---------------------------------------------------------------------------
// Range-backed snapshot helpers
// ---------------------------------------------------------------------------

/// Row ID matching IdAllocator::new() convention: row IDs start at 1.
fn yrs_row_id(row_index: usize) -> RowId {
    RowId::from_raw((row_index + 1) as u128)
}

/// Col ID matching IdAllocator::new() convention: col IDs start after all rows.
fn yrs_col_id(sheet_rows: usize, col_index: usize) -> ColId {
    ColId::from_raw((sheet_rows + col_index + 1) as u128)
}

/// Deterministic UUID string for a RangeId.
fn range_uuid(idx: u32) -> String {
    format!("b0000000-0000-4000-8000-{:012x}", idx as u64)
}

// ---------------------------------------------------------------------------
// Test 7: CellIds stable across compaction
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_stable_across_compaction() {
    // Build a 4-row, 1-col Range-backed sheet: values [10, 20, 30, 40].
    // Sheet has 10 rows, 5 cols. Add a formula in B1 = A3 to verify
    // formula deps survive compaction.
    const SHEET_ROWS: u32 = 10;
    const SHEET_COLS: u32 = 5;
    const RANGE_ROWS: u32 = 4;

    let row_ids: Vec<RowId> = (0..RANGE_ROWS as usize).map(yrs_row_id).collect();
    let col_ids: Vec<ColId> = vec![yrs_col_id(SHEET_ROWS as usize, 0)];

    let payload: Vec<u8> = [10.0_f64, 20.0, 30.0, 40.0]
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .collect();

    let range_data = RangeData {
        range_id: RangeId::from_uuid_str(&range_uuid(0)).unwrap(),
        kind: RangeKind::Data,
        anchor: RangeAnchor::Elastic {
            start_row: row_ids[0],
            end_row: *row_ids.last().unwrap(),
            start_col: col_ids[0],
            end_col: col_ids[0],
        },
        encoding: PayloadEncoding::F64Le,
        payload,
        row_axis: None,
        col_axis: None,
        row_ids: row_ids.to_vec(),
        col_ids: col_ids.clone(),
    };

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Sheet1".to_string(),
            rows: SHEET_ROWS,
            cols: SHEET_COLS,
            cells: vec![formula_cell(0, 0, 1, "A3")],
            ranges: vec![range_data],
        }],
        ..Default::default()
    };

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let sid = sheet_id(0);

    // Capture CellIds for all 4 Range positions before overrides.
    let mut pre_ids: Vec<CellId> = Vec::new();
    for r in 0..4u32 {
        let cid = engine
            .mirror()
            .resolve_cell_id(&sid, SheetPos::new(r, 0))
            .unwrap_or_else(|| panic!("CellId at row {} should exist", r));
        pre_ids.push(cid);
    }

    // Override 2 of 4 cells (50% > 25% threshold) to trigger compaction.
    engine
        .set_cell(&sid, pre_ids[0], 0, 0, "100".into())
        .expect("set_cell A1");
    engine
        .set_cell(&sid, pre_ids[2], 2, 0, "300".into())
        .expect("set_cell A3");

    // After overrides (and potential compaction), verify CellIds are stable.
    for r in 0..4u32 {
        let cid = engine
            .mirror()
            .resolve_cell_id(&sid, SheetPos::new(r, 0))
            .unwrap_or_else(|| panic!("CellId at row {} should still exist after compaction", r));
        assert_eq!(
            cid, pre_ids[r as usize],
            "CellId at row {} should be unchanged after compaction",
            r
        );
    }

    // Verify positions resolve correctly.
    for r in 0..4u32 {
        let pos = engine.mirror().resolve_position(&pre_ids[r as usize]);
        assert!(pos.is_some(), "CellId at row {} should still resolve", r);
        assert_eq!(
            pos.unwrap().row(),
            r,
            "CellId at row {} should still be at row {}",
            r,
            r
        );
    }

    // Verify values are correct (overrides applied).
    let expected = [100.0, 20.0, 300.0, 40.0];
    for r in 0..4u32 {
        let v = engine
            .mirror()
            .get_cell_value(&pre_ids[r as usize])
            .cloned()
            .unwrap_or(CellValue::Null);
        assert_eq!(
            as_f64(&v),
            expected[r as usize],
            "CellId value at row {} should be {}",
            r,
            expected[r as usize]
        );
    }

    // Verify formula B1 = A3 reflects the override (300).
    let b1 = cell_at(&engine, &sid, 0, 1);
    assert!(
        (as_f64(&b1) - 300.0).abs() < 1e-9,
        "B1 = A3 should be 300 after compaction, got {:?}",
        b1
    );
}

// ---------------------------------------------------------------------------
// Test 8: CellIds stable across sort
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_stable_across_sort() {
    // Build workbook with values 50,40,30,20,10 in A1:A5 and formula B1=A3.
    let snap = WorkbookSnapshot {
        sheets: vec![sheet_snap(
            0,
            "Sheet1",
            vec![
                value_cell(0, 0, 0, 50.0),
                value_cell(0, 1, 0, 40.0),
                value_cell(0, 2, 0, 30.0),
                value_cell(0, 3, 0, 20.0),
                value_cell(0, 4, 0, 10.0),
                formula_cell(0, 0, 1, "SUM(A1:A5)"),
            ],
        )],
        ..Default::default()
    };

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let sid = sheet_id(0);

    // Capture CellIds at each position before sort.
    let mut pre_ids: Vec<Option<CellId>> = Vec::new();
    for r in 0..5u32 {
        pre_ids.push(engine.mirror().resolve_cell_id(&sid, SheetPos::new(r, 0)));
    }

    // Sort A1:A5 ascending.
    engine
        .sort_range(
            &sid,
            0,
            0,
            4,
            0,
            BridgeSortOptions {
                criteria: vec![BridgeSortCriterion {
                    column: 0,
                    direction: SortOrder::Asc,
                    case_sensitive: false,
                    mode: BridgeSortMode::Value { custom_list: None },
                }],
                has_headers: false,
                visible_rows_only: false,
            },
        )
        .expect("sort_range");

    // After sort, values should be 10,20,30,40,50.
    for r in 0..5u32 {
        let v = cell_at(&engine, &sid, r, 0);
        assert_eq!(
            as_f64(&v),
            (r + 1) as f64 * 10.0,
            "after sort, row {} should be {}",
            r,
            (r + 1) * 10
        );
    }

    // CellIds at new positions should still resolve, and each cell_id
    // should return the value that was associated with it before the sort.
    // (CellIds follow the data they're attached to, not the grid position.)
    for (orig_row, pre_opt) in pre_ids.iter().enumerate() {
        if let Some(cid) = pre_opt {
            let val = engine
                .mirror()
                .get_cell_value(cid)
                .cloned()
                .unwrap_or(CellValue::Null);
            // The original value at row orig_row was (50 - orig_row*10).
            let expected = 50.0 - (orig_row as f64 * 10.0);
            assert!(
                (as_f64(&val) - expected).abs() < 1e-9,
                "CellId from original row {} should still have value {}, got {:?}",
                orig_row,
                expected,
                val
            );
        }
    }

    // SUM should be unchanged (150).
    let sum = cell_at(&engine, &sid, 0, 1);
    assert!(
        (as_f64(&sum) - 150.0).abs() < 1e-9,
        "SUM should be 150 after sort, got {:?}",
        sum
    );
}

// ---------------------------------------------------------------------------
// Test 9: CellIds stable across insert/delete
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_stable_across_insert_delete() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_with_ref()).expect("from_snapshot");
    let sid = sheet_id(0);

    // Capture the CellId for A3 (row 2, col 0) before insert.
    let a3_cid = engine
        .mirror()
        .resolve_cell_id(&sid, SheetPos::new(2, 0))
        .expect("A3 should have a CellId");

    // Capture the CellId for A5 (row 4, col 0).
    let a5_cid = engine
        .mirror()
        .resolve_cell_id(&sid, SheetPos::new(4, 0))
        .expect("A5 should have a CellId");

    // Insert 2 rows at row 1 (above A3).
    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 1,
                count: 2,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert_rows");

    // A3's CellId should now resolve to row 4 (shifted down by 2).
    let new_pos = engine.mirror().resolve_position(&a3_cid);
    assert!(
        new_pos.is_some(),
        "A3's CellId should still resolve after insert"
    );
    let p = new_pos.unwrap();
    assert_eq!(
        p.row(),
        4,
        "A3's CellId should be at row 4 after inserting 2 rows at row 1"
    );
    assert_eq!(p.col(), 0, "A3's CellId should still be at col 0");

    // The value associated with A3's CellId should still be 30.
    let val = engine
        .mirror()
        .get_cell_value(&a3_cid)
        .cloned()
        .unwrap_or(CellValue::Null);
    assert!(
        (as_f64(&val) - 30.0).abs() < 1e-9,
        "A3's CellId value should still be 30, got {:?}",
        val
    );

    // A5's CellId should now be at row 6.
    let a5_pos = engine.mirror().resolve_position(&a5_cid);
    assert!(
        a5_pos.is_some(),
        "A5's CellId should still resolve after insert"
    );
    assert_eq!(
        a5_pos.unwrap().row(),
        6,
        "A5's CellId should be at row 6 after insert"
    );

    // sheet_for_cell should return the correct sheet.
    let sheet = engine.mirror().sheet_for_cell(&a3_cid);
    assert_eq!(
        sheet,
        Some(sid),
        "sheet_for_cell should return the correct sheet"
    );

    // Delete the 2 inserted rows to restore.
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 1,
                count: 2,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete_rows");

    // A3's CellId should be back at row 2.
    let restored_pos = engine.mirror().resolve_position(&a3_cid);
    assert!(
        restored_pos.is_some(),
        "A3's CellId should still resolve after delete"
    );
    assert_eq!(
        restored_pos.unwrap().row(),
        2,
        "A3's CellId should be back at row 2 after delete"
    );

    // A5's CellId should be back at row 4.
    let a5_restored = engine.mirror().resolve_position(&a5_cid);
    assert_eq!(
        a5_restored.unwrap().row(),
        4,
        "A5's CellId should be back at row 4"
    );
}

// ---------------------------------------------------------------------------
// Additional: identity round-trip for every position
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_resolve_roundtrip() {
    let (engine, _) = YrsComputeEngine::from_snapshot(workbook_with_ref()).expect("from_snapshot");
    let sid = sheet_id(0);

    // For every cell in the snapshot, verify the resolve roundtrip:
    //   pos -> cell_id -> pos
    //   cell_id -> pos -> cell_id
    for row in 0..5u32 {
        let pos = SheetPos::new(row, 0);
        let cid = engine.mirror().resolve_cell_id(&sid, pos);
        assert!(
            cid.is_some(),
            "resolve_cell_id should return Some for populated row {}",
            row
        );
        let cid = cid.unwrap();

        // Roundtrip: cell_id -> pos
        let pos_back = engine.mirror().resolve_position(&cid);
        assert!(
            pos_back.is_some(),
            "resolve_position should return Some for CellId at row {}",
            row
        );
        let p = pos_back.unwrap();
        assert_eq!(p.row(), row, "roundtrip row mismatch for row {}", row);
        assert_eq!(p.col(), 0, "roundtrip col mismatch for row {}", row);

        // Roundtrip: pos -> cell_id -> pos -> cell_id
        let cid_back = engine.mirror().resolve_cell_id(&sid, p);
        assert_eq!(
            cid_back,
            Some(cid),
            "roundtrip cell_id mismatch for row {}",
            row
        );
    }
}

// ---------------------------------------------------------------------------
// Additional: multi-sheet identity isolation
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_multi_sheet_isolation() {
    // Two sheets with same-position cells should have different CellIds.
    let snap = WorkbookSnapshot {
        sheets: vec![
            sheet_snap(0, "Alpha", vec![value_cell(0, 0, 0, 1.0)]),
            sheet_snap(1, "Beta", vec![value_cell(1, 0, 0, 2.0)]),
        ],
        ..Default::default()
    };

    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let alpha_sid = sheet_id(0);
    let beta_sid = sheet_id(1);

    let alpha_cid = engine
        .mirror()
        .resolve_cell_id(&alpha_sid, SheetPos::new(0, 0))
        .expect("Alpha A1 should have a CellId");
    let beta_cid = engine
        .mirror()
        .resolve_cell_id(&beta_sid, SheetPos::new(0, 0))
        .expect("Beta A1 should have a CellId");

    // CellIds should be different across sheets.
    assert_ne!(
        alpha_cid, beta_cid,
        "CellIds at same position on different sheets should differ"
    );

    // sheet_for_cell should return the correct sheet for each.
    assert_eq!(
        engine.mirror().sheet_for_cell(&alpha_cid),
        Some(alpha_sid),
        "Alpha's CellId should resolve to Alpha"
    );
    assert_eq!(
        engine.mirror().sheet_for_cell(&beta_cid),
        Some(beta_sid),
        "Beta's CellId should resolve to Beta"
    );

    // Values should be distinct.
    let alpha_val = engine
        .mirror()
        .get_cell_value(&alpha_cid)
        .cloned()
        .unwrap_or(CellValue::Null);
    let beta_val = engine
        .mirror()
        .get_cell_value(&beta_cid)
        .cloned()
        .unwrap_or(CellValue::Null);
    assert_eq!(as_f64(&alpha_val), 1.0, "Alpha A1 should be 1");
    assert_eq!(as_f64(&beta_val), 2.0, "Beta A1 should be 2");
}

// ---------------------------------------------------------------------------
// Additional: identity stability across undo/redo
// ---------------------------------------------------------------------------

#[test]
fn virtual_id_stable_across_undo_redo() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_with_ref()).expect("from_snapshot");
    let sid = sheet_id(0);

    // Capture CellId for A3.
    let a3_cid = engine
        .mirror()
        .resolve_cell_id(&sid, SheetPos::new(2, 0))
        .expect("A3 CellId");

    // Edit A3.
    engine
        .set_cell(&sid, a3_cid, 2, 0, "99".into())
        .expect("set_cell");

    // After edit, CellId should still resolve.
    let pos_after_edit = engine.mirror().resolve_position(&a3_cid);
    assert_eq!(
        pos_after_edit.map(|p| p.row()),
        Some(2),
        "A3 CellId should still be at row 2 after edit"
    );

    // Undo.
    engine.undo().expect("undo");

    // CellId should still resolve after undo.
    let pos_after_undo = engine.mirror().resolve_position(&a3_cid);
    assert_eq!(
        pos_after_undo.map(|p| p.row()),
        Some(2),
        "A3 CellId should still be at row 2 after undo"
    );

    // Value should be back to 30.
    let val = engine
        .mirror()
        .get_cell_value(&a3_cid)
        .cloned()
        .unwrap_or(CellValue::Null);
    assert!(
        (as_f64(&val) - 30.0).abs() < 1e-9,
        "A3 should be 30 after undo, got {:?}",
        val
    );

    // Redo.
    engine.redo().expect("redo");

    // CellId should still resolve after redo.
    let pos_after_redo = engine.mirror().resolve_position(&a3_cid);
    assert_eq!(
        pos_after_redo.map(|p| p.row()),
        Some(2),
        "A3 CellId should still be at row 2 after redo"
    );

    // Value should be 99 again.
    let val = engine
        .mirror()
        .get_cell_value(&a3_cid)
        .cloned()
        .unwrap_or(CellValue::Null);
    assert!(
        (as_f64(&val) - 99.0).abs() < 1e-9,
        "A3 should be 99 after redo, got {:?}",
        val
    );
}
