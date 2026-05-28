//! Undo/redo mutation result payload coverage.

use super::super::*;
use super::helpers::*;

#[test]
fn test_undo_formula_clear_reports_restored_cell_change() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let (_patches, clear_result) = engine.batch_clear_cells(vec![cell_id_a2()]).unwrap();
    assert!(
        clear_result.recalc.changed_cells.iter().any(|change| change
            .position
            .as_ref()
            .is_some_and(|pos| pos.row == 1 && pos.col == 0)),
        "clearing A2 should report a changed cell"
    );

    assert!(engine.can_undo());
    let (_patches, undo_result) = engine.undo().unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(30.0));
    let restored = undo_result.recalc.changed_cells.iter().find(|change| {
        change
            .position
            .as_ref()
            .is_some_and(|pos| pos.row == 1 && pos.col == 0)
    });
    assert!(
        restored.is_some(),
        "undoing a formula clear must report A2 in changed_cells so UI subscribers invalidate; result={:?}",
        undo_result.recalc.changed_cells
    );
}

#[test]
fn test_undo_format_produces_property_changes() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Apply a format change (bold A1)
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let _fwd = engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    // Undo it
    assert!(engine.can_undo());
    let (patches, result) = engine.undo().unwrap();

    // The MutationResult should contain property_changes for the reverted cell
    assert!(
        !result.property_changes.is_empty(),
        "undo of format should produce property_changes, got: {:?}",
        result.property_changes,
    );

    // The first property change should reference the sheet
    let pc = &result.property_changes[0];
    assert_eq!(pc.sheet_id, sid.to_uuid_string());
}

#[test]
fn test_undo_format_produces_viewport_patches() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Register a viewport so patches get produced
    engine
        .register_viewport("main", &sid, 0, 0, 100, 26)
        .unwrap();

    // Apply a format change
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let _fwd = engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    // Undo it
    let (patches, _result) = engine.undo().unwrap();

    // Patches should be non-trivial (more than just the 2-byte count header)
    assert!(
        patches.len() > 2,
        "undo of format should produce viewport patches, got {} bytes",
        patches.len(),
    );
}

#[test]
fn test_undo_row_height_produces_dimension_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set a row height
    let _fwd = engine.set_row_height(&sid, 0, 40.0).unwrap();

    // Undo it
    assert!(engine.can_undo());
    let (_patches, result) = engine.undo().unwrap();

    assert!(
        !result.dimension_changes.is_empty(),
        "undo of row height should produce dimension_changes",
    );

    let dc = &result.dimension_changes[0];
    assert_eq!(dc.sheet_id, sid.to_uuid_string());
    assert_eq!(dc.axis, crate::snapshot::Axis::Row);
    assert_eq!(dc.index, 0);
}

#[test]
fn test_undo_mixed_mutation_produces_both_cell_and_property_changes() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Begin undo group so both changes are in one undo step
    engine.begin_undo_group().unwrap();

    // Change cell value
    engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();

    // Change format
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    engine.end_undo_group().unwrap();

    // Undo the group
    assert!(engine.can_undo());
    let (_patches, result) = engine.undo().unwrap();

    // Should have both cell changes (from recalc) and property changes
    assert!(
        !result.recalc.changed_cells.is_empty(),
        "undo of mixed mutation should produce cell changes",
    );
    assert!(
        !result.property_changes.is_empty(),
        "undo of mixed mutation should produce property_changes",
    );
}

#[test]
fn test_redo_produces_property_changes() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Apply a format change
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let _fwd = engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    // Undo
    engine.undo().unwrap();

    // Redo
    assert!(engine.can_redo());
    let (_patches, result) = engine.redo().unwrap();

    assert!(
        !result.property_changes.is_empty(),
        "redo of format should produce property_changes",
    );
}

#[test]
fn test_redo_row_height_produces_dimension_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set row height
    engine.set_row_height(&sid, 0, 40.0).unwrap();

    // Undo + redo
    engine.undo().unwrap();
    assert!(engine.can_redo());
    let (_patches, result) = engine.redo().unwrap();

    assert!(
        !result.dimension_changes.is_empty(),
        "redo of row height should produce dimension_changes",
    );
}
