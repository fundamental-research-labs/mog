//! Core undo/redo behavior for single-cell edits.

use super::super::*;
use super::helpers::*;
use value_types::{CellValue, FiniteF64};

#[test]
fn test_undo_reverts_cell_edit() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Initial: A1 = 10
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a1()).unwrap(),
        CellValue::Number(FiniteF64::must(10.0))
    );

    // Edit A1 to 99
    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "99".into() },
        )
        .unwrap();
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a1()).unwrap(),
        CellValue::Number(FiniteF64::must(99.0))
    );

    // Undo should revert A1 back to 10
    assert!(engine.can_undo());
    let _undo_result = engine.undo().unwrap();

    // After undo, the yrs doc should have A1 = 10 again
    // Check yrs doc directly
    let (yrs_val, _, _) = engine
        .storage()
        .read_cell_from_yrs(&sheet_id(), &cell_id_a1())
        .expect("cell should exist in yrs after undo");
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(10.0)));
}

#[test]
fn test_redo_restores_cell_edit() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Edit A1 to 99
    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "99".into() },
        )
        .unwrap();

    // Undo
    engine.undo().unwrap();
    let (yrs_val, _, _) = engine
        .storage()
        .read_cell_from_yrs(&sheet_id(), &cell_id_a1())
        .unwrap();
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(10.0)));

    // Redo should restore A1 = 99
    assert!(engine.can_redo());
    let _redo_result = engine.redo().unwrap();

    let (yrs_val, _, _) = engine
        .storage()
        .read_cell_from_yrs(&sheet_id(), &cell_id_a1())
        .unwrap();
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(99.0)));
}

#[test]
fn test_multiple_edits_undo() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Edit A1 to 100
    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "100".into() },
        )
        .unwrap();

    // Edit B1 to 200
    engine
        .set_cell(
            &sheet_id(),
            cell_id_b1(),
            0,
            1,
            crate::bridge_types::CellInput::Parse { text: "200".into() },
        )
        .unwrap();

    // Both edits should be undoable
    assert!(engine.can_undo());

    // Undo B1 edit
    engine.undo().unwrap();

    // B1 should be back to 20 in yrs doc
    let (yrs_val, _, _) = engine
        .storage()
        .read_cell_from_yrs(&sheet_id(), &cell_id_b1())
        .unwrap();
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(20.0)));

    // Undo A1 edit
    engine.undo().unwrap();

    // A1 should be back to 10 in yrs doc
    let (yrs_val, _, _) = engine
        .storage()
        .read_cell_from_yrs(&sheet_id(), &cell_id_a1())
        .unwrap();
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(10.0)));
}

#[test]
fn test_undo_redo_state_transitions() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Initially, nothing to undo or redo
    assert!(!engine.can_undo());
    assert!(!engine.can_redo());

    // After edit, can undo but not redo
    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();
    assert!(engine.can_undo());
    assert!(!engine.can_redo());

    // After undo, can redo but not undo
    engine.undo().unwrap();
    assert!(!engine.can_undo());
    assert!(engine.can_redo());

    // After redo, can undo but not redo
    engine.redo().unwrap();
    assert!(engine.can_undo());
    assert!(!engine.can_redo());
}
