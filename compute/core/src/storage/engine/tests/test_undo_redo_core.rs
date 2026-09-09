//! Core undo/redo behavior for authored values and their formula dependents.

use super::super::*;
use super::helpers::*;

fn assert_a1_and_dependent(engine: &ComputeEngine, value: f64, sum: f64) {
    assert_eq!(
        engine.cell_store().get_cell_value(&cell_id_a1()),
        Some(&num(value))
    );
    assert_eq!(cell_value_at(engine, &sheet_id(), 0, 0), num(value));
    assert_eq!(
        engine.cell_store().get_cell_value(&cell_id_a2()),
        Some(&num(sum))
    );
    assert_eq!(engine.get_formula(&cell_id_a2()).as_deref(), Some("=A1+B1"));
}

#[test]
fn test_undo_reverts_cell_edit() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    assert_a1_and_dependent(&engine, 10.0, 30.0);
    engine
        .set_cell(&sheet_id(), cell_id_a1(), 0, 0, "99".into())
        .unwrap();
    assert_a1_and_dependent(&engine, 99.0, 119.0);
    assert!(engine.can_undo());
    engine.undo().unwrap();
    assert_a1_and_dependent(&engine, 10.0, 30.0);
}

#[test]
fn test_redo_restores_cell_edit() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .set_cell(&sheet_id(), cell_id_a1(), 0, 0, "99".into())
        .unwrap();
    engine.undo().unwrap();
    assert_a1_and_dependent(&engine, 10.0, 30.0);
    assert!(engine.can_redo());
    engine.redo().unwrap();
    assert_a1_and_dependent(&engine, 99.0, 119.0);
}

#[test]
fn test_multiple_edits_undo() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .set_cell(&sheet_id(), cell_id_a1(), 0, 0, "100".into())
        .unwrap();
    engine
        .set_cell(&sheet_id(), cell_id_b1(), 0, 1, "200".into())
        .unwrap();
    assert_eq!(engine.get_undo_state().undo_depth, 2);
    assert_a1_and_dependent(&engine, 100.0, 300.0);
    engine.undo().unwrap();
    assert_eq!(
        engine.cell_store().get_cell_value(&cell_id_b1()),
        Some(&num(20.0))
    );
    assert_a1_and_dependent(&engine, 100.0, 120.0);
    engine.undo().unwrap();
    assert_a1_and_dependent(&engine, 10.0, 30.0);
}

#[test]
fn test_undo_redo_state_transitions() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    assert!(!engine.can_undo());
    assert!(!engine.can_redo());
    engine
        .set_cell(&sheet_id(), cell_id_a1(), 0, 0, "42".into())
        .unwrap();
    assert!(engine.can_undo());
    assert!(!engine.can_redo());
    engine.undo().unwrap();
    assert!(!engine.can_undo());
    assert!(engine.can_redo());
    engine.redo().unwrap();
    assert!(engine.can_undo());
    assert!(!engine.can_redo());
}
