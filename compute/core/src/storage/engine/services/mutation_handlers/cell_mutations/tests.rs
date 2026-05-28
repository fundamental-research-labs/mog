use cell_types::{CellId, SheetId};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, ComputeError};

use super::*;
use crate::storage::engine::YrsComputeEngine;

const SHEET_UUID: &str = "aa000000000000000000000000000001";
const A1_UUID: &str = "aa000000000000000000000000000101";
const J10_UUID: &str = "aa000000000000000000000000000102";
const CSE_A1_UUID: &str = "aa000000000000000000000000000103";
const FULL_SHEET_END_ROW: u32 = 1_048_575;
const FULL_SHEET_END_COL: u32 = 16_383;

fn snapshot_with_cells(cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn cell_change_at(
    changes: &[snapshot_types::CellChange],
    row: u32,
    col: u32,
) -> Option<&snapshot_types::CellChange> {
    changes
        .iter()
        .find(|change| change.position.as_ref().map(|pos| (pos.row, pos.col)) == Some((row, col)))
}

#[test]
fn mutation_clear_range_whole_sheet_uses_sparse_grid_targets() {
    let snapshot = snapshot_with_cells(vec![
        CellData {
            cell_id: A1_UUID.to_string(),
            row: 0,
            col: 0,
            value: CellValue::number(10.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: J10_UUID.to_string(),
            row: 9,
            col: 9,
            value: CellValue::number(20.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
    let a1_id = CellId::from_uuid_str(A1_UUID).expect("A1 uuid");
    let j10_id = CellId::from_uuid_str(J10_UUID).expect("J10 uuid");

    let started = std::time::Instant::now();
    let (_patches, result) = engine
        .clear_range(&sheet_id, 0, 0, FULL_SHEET_END_ROW, FULL_SHEET_END_COL)
        .expect("clear_range");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(2),
        "whole-sheet clear must not scan the selected coordinate area; elapsed {:?}",
        started.elapsed(),
    );

    assert_eq!(
        engine.mirror().get_cell_value(&a1_id).cloned(),
        Some(CellValue::Null),
    );
    assert_eq!(
        engine.mirror().get_cell_value(&j10_id).cloned(),
        Some(CellValue::Null),
    );
    assert!(
        cell_change_at(&result.recalc.changed_cells, 0, 0).is_some(),
        "A1 should be reported as changed",
    );
    assert!(
        cell_change_at(&result.recalc.changed_cells, 9, 9).is_some(),
        "J10 should be reported as changed",
    );
}

#[test]
fn mutation_clear_range_by_position_whole_sheet_uses_sparse_grid_targets() {
    let snapshot = snapshot_with_cells(vec![
        CellData {
            cell_id: A1_UUID.to_string(),
            row: 0,
            col: 0,
            value: CellValue::number(10.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: J10_UUID.to_string(),
            row: 9,
            col: 9,
            value: CellValue::number(20.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
    let a1_id = CellId::from_uuid_str(A1_UUID).expect("A1 uuid");
    let j10_id = CellId::from_uuid_str(J10_UUID).expect("J10 uuid");

    let started = std::time::Instant::now();
    let (_patches, result) = engine
        .clear_range_by_position(sheet_id, 0, 0, FULL_SHEET_END_ROW, FULL_SHEET_END_COL)
        .expect("clear_range_by_position");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(2),
        "whole-sheet clear-all must not scan the selected coordinate area; elapsed {:?}",
        started.elapsed(),
    );

    assert_eq!(
        engine.mirror().get_cell_value(&a1_id).cloned(),
        Some(CellValue::Null),
    );
    assert_eq!(
        engine.mirror().get_cell_value(&j10_id).cloned(),
        Some(CellValue::Null),
    );
    assert!(
        cell_change_at(&result.recalc.changed_cells, 0, 0).is_some(),
        "A1 should be reported as changed",
    );
    assert!(
        cell_change_at(&result.recalc.changed_cells, 9, 9).is_some(),
        "J10 should be reported as changed",
    );
}

#[test]
fn mutation_clear_range_sparse_projection_overlap_rejects_partial_cse_clear() {
    let snapshot = snapshot_with_cells(vec![CellData {
        cell_id: CSE_A1_UUID.to_string(),
        row: 0,
        col: 0,
        value: CellValue::number(1.0),
        formula: Some("SEQUENCE(2,3)".to_string()),
        identity_formula: None,
        array_ref: Some("A1:C2".to_string()),
    }]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
    let anchor_id = CellId::from_uuid_str(CSE_A1_UUID).expect("CSE anchor uuid");

    assert!(
        engine.mirror().is_cse_anchor(&anchor_id),
        "precondition: snapshot array_ref should register a CSE anchor",
    );

    let err = engine
        .clear_range(&sheet_id, 1, 1, 1, 1)
        .expect_err("clear_range over projected member should reject");

    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "expected PartialArrayWrite, got {err:?}",
    );
    assert!(
        engine.mirror().is_cse_anchor(&anchor_id),
        "partial CSE range clear must leave the anchor intact",
    );
    assert_eq!(
        engine.mirror().get_cell_value(&anchor_id).cloned(),
        Some(CellValue::number(1.0)),
    );
}

#[test]
fn mutation_clear_range_full_cse_extent_clears_anchor() {
    let snapshot = snapshot_with_cells(vec![CellData {
        cell_id: CSE_A1_UUID.to_string(),
        row: 0,
        col: 0,
        value: CellValue::number(1.0),
        formula: Some("SEQUENCE(2,3)".to_string()),
        identity_formula: None,
        array_ref: Some("A1:C2".to_string()),
    }]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
    let anchor_id = CellId::from_uuid_str(CSE_A1_UUID).expect("CSE anchor uuid");

    let (_patches, result) = engine
        .clear_range(&sheet_id, 0, 0, 1, 2)
        .expect("clear_range over full CSE extent");

    assert!(
        !engine.mirror().is_cse_anchor(&anchor_id),
        "full CSE extent clear should tear down the anchor",
    );
    assert_eq!(
        engine.mirror().get_cell_value(&anchor_id).cloned(),
        Some(CellValue::Null),
    );
    assert!(
        cell_change_at(&result.recalc.changed_cells, 0, 0).is_some(),
        "CSE anchor should be reported as changed",
    );
}

#[test]
fn mutation_clear_range_by_position_rejects_partial_cse_clear() {
    let snapshot = snapshot_with_cells(vec![CellData {
        cell_id: CSE_A1_UUID.to_string(),
        row: 0,
        col: 0,
        value: CellValue::number(1.0),
        formula: Some("SEQUENCE(2,3)".to_string()),
        identity_formula: None,
        array_ref: Some("A1:C2".to_string()),
    }]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
    let anchor_id = CellId::from_uuid_str(CSE_A1_UUID).expect("CSE anchor uuid");

    let err = engine
        .clear_range_by_position(sheet_id, 1, 1, 1, 1)
        .expect_err("clear all over projected member should reject");

    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "expected PartialArrayWrite, got {err:?}",
    );
    assert!(
        engine.mirror().is_cse_anchor(&anchor_id),
        "partial clear-all must leave the CSE anchor intact",
    );
}

/// Bug regression: `mutation_set_cells_raw` must not destroy the
/// iterative-calc convergence seed when re-entering the same formula.
///
/// Before the fix, step 4 of `mutation_set_cells_raw` unconditionally
/// overwrote the mirror with the caller-supplied `value` (which, for a
/// formula edit, is typically `CellValue::Null`). By the time step 5
/// dispatched to `set_cells_raw` → `process_value_input`, the mirror had
/// already been nulled, defeating the same-formula seed detection.
///
/// We pre-converge A1 at 10.0 using a formula whose fixed point depends
/// on the seed (`IF(A1>=5, A1, A1+1)` — stable above 5, climbs from 0
/// to 5 otherwise). Re-entering the same formula must leave A1 at 10.0.
/// With the bug, iterative calc would restart from 0 and converge to 5.0.
#[test]
fn mutation_set_cells_raw_preserves_iterative_seed_on_same_formula_reentry() {
    let snapshot = WorkbookSnapshot {
        iterative_calc: true,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![CellData {
                cell_id: A1_UUID.to_string(),
                row: 0,
                col: 0,
                value: value_types::CellValue::number(10.0),
                formula: Some("IF(A1>=5, A1, A1+1)".to_string()),
                identity_formula: None,
                array_ref: None,
            }],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("sheet uuid");
    let a1_id = CellId::from_uuid_str(A1_UUID).expect("cell uuid");

    // Precondition: A1 converged at ~10.0 (seeded at 10; formula holds).
    let before = engine.mirror().get_cell_value(&a1_id).cloned();
    let before_n = match before {
        Some(value_types::CellValue::Number(n)) => n.get(),
        _ => panic!("pre-check: A1 must be Number, got {:?}", before),
    };
    assert!(
        (before_n - 10.0).abs() < 0.01,
        "pre-check: A1 must converge at ~10.0; got {}",
        before_n,
    );

    // Re-enter the SAME formula via mutation_set_cells_raw.
    engine.with_internals_for_test(|stores, mirror, mutation| {
        let edits = vec![(
            sheet_id,
            a1_id,
            0u32,
            0u32,
            value_types::CellValue::Null,
            Some("IF(A1>=5, A1, A1+1)".to_string()),
        )];
        // skip_cycle_check=true: iterative-calc intentionally allows
        // self-cycles. Matches how init_from_snapshot (via
        // `bulk_parse_and_register` + `set_precedents_fresh`) avoids
        // per-edge cycle detection.
        mutation_set_cells_raw(stores, mirror, mutation, edits, true)
            .expect("mutation_set_cells_raw");
    });

    // Post-check: A1 must still hold ~10.0. If the pre-write destroyed
    // the seed, iterative calc would restart from 0 → converge to 5.0.
    let after = engine.mirror().get_cell_value(&a1_id).cloned();
    let after_n = match after {
        Some(value_types::CellValue::Number(n)) => n.get(),
        _ => panic!("post-check: A1 must be Number, got {:?}", after),
    };
    assert!(
        (after_n - 10.0).abs() < 0.01,
        "mutation_set_cells_raw must preserve the iterative-calc seed \
             when re-entering the same formula; expected ~10.0, got {}",
        after_n,
    );
}
