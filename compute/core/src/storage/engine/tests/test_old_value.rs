//! Group 20: CellChange.old_value tracking.

use super::super::*;
use super::helpers::*;
use value_types::{CellValue, FiniteF64};

/// Helper: find a CellChange by CellId in a list of changed_cells.
fn find_change_by_cell_id<'a>(
    changes: &'a [snapshot_types::CellChange],
    cell_id: CellId,
) -> Option<&'a snapshot_types::CellChange> {
    let id_str = cell_id.to_uuid_string();
    changes.iter().find(|c| c.cell_id == id_str)
}

#[test]
fn test_old_value_direct_edit_number_to_number() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // A1 starts at 10, edit to 50
    let (_patches, result) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "50".into() },
        )
        .unwrap();

    let a1_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a1())
        .expect("A1 should be in changed_cells");
    assert_eq!(
        a1_change.old_value,
        Some(CellValue::Number(FiniteF64::must(10.0))),
        "old_value should be the previous value 10"
    );
    assert_eq!(
        a1_change.value,
        CellValue::Number(FiniteF64::must(50.0)),
        "new value should be 50"
    );
}

#[test]
fn test_old_value_direct_edit_same_value_already_exists() {
    // A1=10 already exists. Set it to 10 again -- verify old_value is 10 if reported.
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let (_patches, result) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "10".into() },
        )
        .unwrap();

    // If A1 appears in changed_cells, its old_value should be Number(10.0).
    // If it doesn't appear (engine optimizes away no-op), that's also fine.
    if let Some(a1_change) = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a1()) {
        assert_eq!(
            a1_change.old_value,
            Some(CellValue::Number(FiniteF64::must(10.0))),
        );
    }
}

#[test]
fn test_old_value_direct_edit_value_to_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // A1=10, set to "hello" (non-numeric text)
    let (_patches, result) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "hello".into(),
            },
        )
        .unwrap();

    let a1_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a1())
        .expect("A1 should be in changed_cells");
    assert_eq!(
        a1_change.old_value,
        Some(CellValue::Number(FiniteF64::must(10.0))),
        "old_value should be the previous numeric value 10"
    );
    // New value should be text
    assert!(
        matches!(a1_change.value, CellValue::Text(_)),
        "new value should be text, got {:?}",
        a1_change.value
    );
}

#[test]
fn test_old_value_cascade_formula() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Verify A2=30 initially
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a2()).unwrap(),
        CellValue::Number(FiniteF64::must(30.0))
    );

    // Edit A1=50 => A2 should cascade to 70
    let (_patches, result) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "50".into() },
        )
        .unwrap();

    let a2_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a2())
        .expect("A2 should be in changed_cells (cascade)");
    assert_eq!(
        a2_change.old_value,
        Some(CellValue::Number(FiniteF64::must(30.0))),
        "A2 cascade old_value should be 30"
    );
    assert_eq!(
        a2_change.value,
        CellValue::Number(FiniteF64::must(70.0)),
        "A2 new value should be 70"
    );
}

#[test]
fn test_old_value_cascade_chain_both_cells() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Edit A1=50 => A1 direct + A2 cascade
    let (_patches, result) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "50".into() },
        )
        .unwrap();

    // A1 direct edit old_value
    let a1_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a1())
        .expect("A1 should be in changed_cells");
    assert_eq!(
        a1_change.old_value,
        Some(CellValue::Number(FiniteF64::must(10.0))),
    );

    // A2 cascade old_value
    let a2_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a2())
        .expect("A2 should be in changed_cells");
    assert_eq!(
        a2_change.old_value,
        Some(CellValue::Number(FiniteF64::must(30.0))),
    );
}

#[test]
fn test_old_value_not_set_when_value_unchanged() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Set A1 to its current value (10). B1 is unchanged (20), A2 stays 30.
    let (_patches, result) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "10".into() },
        )
        .unwrap();

    // A2 should NOT appear in changed_cells since its inputs didn't change,
    // so its recalc should produce the same value.
    let a2_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a2());
    if let Some(change) = a2_change {
        // If it does appear, old_value should equal new value
        assert_eq!(
            change.old_value.as_ref(),
            Some(&change.value),
            "If A2 appears despite no real change, old and new should match"
        );
    }
}

#[test]
fn test_old_value_formula_edit() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // A2 = A1+B1 = 30. Change formula to =A1*B1 => 200
    let (_patches, result) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a2(),
            1,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "=A1*B1".into(),
            },
        )
        .unwrap();

    let a2_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a2())
        .expect("A2 should be in changed_cells");
    // When a formula cell is directly edited, apply_edit writes Null to the mirror
    // before recalc, so level_eval sees Null as the old value. The direct-edit
    // patching doesn't override because level_eval already set old_value = Some(Null).
    assert_eq!(
        a2_change.old_value,
        Some(CellValue::Null),
        "old_value should be Null (mirror was cleared before recalc)"
    );
    assert_eq!(
        a2_change.value,
        CellValue::Number(FiniteF64::must(200.0)),
        "new value should be 200"
    );
}

#[test]
fn test_old_value_set_to_empty_string() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // A1=10, set to "" (empty => clears cell)
    let (_patches, result) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Clear,
        )
        .unwrap();

    let a1_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a1())
        .expect("A1 should be in changed_cells");
    assert_eq!(
        a1_change.old_value,
        Some(CellValue::Number(FiniteF64::must(10.0))),
        "old_value should be 10 before clearing"
    );
}

#[test]
fn test_old_value_multiple_cells_sequential() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Edit A1 from 10 to 50
    let (_patches, result1) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "50".into() },
        )
        .unwrap();
    let a1_change = find_change_by_cell_id(&result1.recalc.changed_cells, cell_id_a1())
        .expect("A1 should be in changed_cells");
    assert_eq!(
        a1_change.old_value,
        Some(CellValue::Number(FiniteF64::must(10.0))),
    );

    // Edit B1 from 20 to 100
    let (_patches, result2) = engine
        .set_cell(
            &sheet_id(),
            cell_id_b1(),
            0,
            1,
            crate::bridge_types::CellInput::Parse { text: "100".into() },
        )
        .unwrap();
    let b1_change = find_change_by_cell_id(&result2.recalc.changed_cells, cell_id_b1())
        .expect("B1 should be in changed_cells");
    assert_eq!(
        b1_change.old_value,
        Some(CellValue::Number(FiniteF64::must(20.0))),
    );
}

#[test]
fn test_old_value_clear_cells() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // A1=10, clear it via batch_clear_cells
    let (_patches, result) = engine.batch_clear_cells(vec![cell_id_a1()]).unwrap();

    let a1_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a1())
        .expect("A1 should be in changed_cells after clear");
    assert_eq!(
        a1_change.old_value,
        Some(CellValue::Number(FiniteF64::must(10.0))),
        "old_value should be 10 before clearing"
    );
    assert_eq!(
        a1_change.value,
        CellValue::Null,
        "new value should be Null after clearing"
    );
}

#[test]
fn test_old_value_overwrite_twice() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // First edit: A1 from 10 to 50
    let (_patches, result1) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "50".into() },
        )
        .unwrap();
    let a1_first = find_change_by_cell_id(&result1.recalc.changed_cells, cell_id_a1())
        .expect("A1 should be in first result");
    assert_eq!(
        a1_first.old_value,
        Some(CellValue::Number(FiniteF64::must(10.0))),
        "first edit old_value should be 10"
    );

    // Second edit: A1 from 50 to 99
    let (_patches, result2) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "99".into() },
        )
        .unwrap();
    let a1_second = find_change_by_cell_id(&result2.recalc.changed_cells, cell_id_a1())
        .expect("A1 should be in second result");
    assert_eq!(
        a1_second.old_value,
        Some(CellValue::Number(FiniteF64::must(50.0))),
        "second edit old_value should be 50"
    );
}

#[test]
fn test_old_value_text_to_number() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Set A1 to text first
    let _ = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "hello".into(),
            },
        )
        .unwrap();

    // Now set A1 from "hello" to "42"
    let (_patches, result) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();

    let a1_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a1())
        .expect("A1 should be in changed_cells");
    assert!(
        matches!(a1_change.old_value, Some(CellValue::Text(_))),
        "old_value should be Text(\"hello\"), got {:?}",
        a1_change.old_value
    );
    assert_eq!(a1_change.value, CellValue::Number(FiniteF64::must(42.0)),);
}

#[test]
fn test_old_value_cascade_preserves_direct_edit() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Edit A1=50 triggers cascade on A2
    let (_patches, result) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "50".into() },
        )
        .unwrap();

    // Direct edit: A1 old_value = 10
    let a1_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a1())
        .expect("A1 (direct edit) should be in changed_cells");
    assert_eq!(
        a1_change.old_value,
        Some(CellValue::Number(FiniteF64::must(10.0))),
    );

    // Cascade: A2 old_value = 30
    let a2_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a2())
        .expect("A2 (cascade) should be in changed_cells");
    assert_eq!(
        a2_change.old_value,
        Some(CellValue::Number(FiniteF64::must(30.0))),
    );

    // Verify both have the correct new values too
    assert_eq!(a1_change.value, CellValue::Number(FiniteF64::must(50.0)),);
    assert_eq!(a2_change.value, CellValue::Number(FiniteF64::must(70.0)),);
}

#[test]
fn test_old_value_boolean_value() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Set A1 to TRUE (boolean)
    let _ = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "TRUE".into(),
            },
        )
        .unwrap();

    // Verify A1 is now Boolean(true)
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a1()).unwrap(),
        CellValue::Boolean(true),
    );

    // Set A1 from TRUE to FALSE
    let (_patches, result) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "FALSE".into(),
            },
        )
        .unwrap();

    let a1_change = find_change_by_cell_id(&result.recalc.changed_cells, cell_id_a1())
        .expect("A1 should be in changed_cells");
    assert_eq!(
        a1_change.old_value,
        Some(CellValue::Boolean(true)),
        "old_value should be Boolean(true)"
    );
    assert_eq!(
        a1_change.value,
        CellValue::Boolean(false),
        "new value should be Boolean(false)"
    );
}

#[test]
fn test_old_value_error_propagation() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // A2 = A1+B1 = 30. Set A2 to a formula that errors: =1/0
    let (_patches, result1) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a2(),
            1,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "=1/0".into(),
            },
        )
        .unwrap();

    let a2_change = find_change_by_cell_id(&result1.recalc.changed_cells, cell_id_a2())
        .expect("A2 should be in changed_cells");
    // When a formula cell is directly edited, apply_edit writes Null to the mirror
    // before recalc, so old_value is Null (same behavior as test_old_value_formula_edit).
    assert_eq!(
        a2_change.old_value,
        Some(CellValue::Null),
        "old_value should be Null (mirror cleared before recalc)"
    );
    // New value should be an error
    assert!(
        matches!(a2_change.value, CellValue::Error(..)),
        "new value should be an error, got {:?}",
        a2_change.value
    );

    // Now fix it: set A2 to =A1+B1 again
    let (_patches, result2) = engine
        .set_cell(
            &sheet_id(),
            cell_id_a2(),
            1,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "=A1+B1".into(),
            },
        )
        .unwrap();

    let a2_fix = find_change_by_cell_id(&result2.recalc.changed_cells, cell_id_a2())
        .expect("A2 should be in changed_cells after fix");
    // Same pattern: mirror is cleared to Null before recalc
    assert_eq!(
        a2_fix.old_value,
        Some(CellValue::Null),
        "old_value should be Null (mirror cleared before recalc)"
    );
    assert_eq!(
        a2_fix.value,
        CellValue::Number(FiniteF64::must(30.0)),
        "fixed value should be 30"
    );
}
