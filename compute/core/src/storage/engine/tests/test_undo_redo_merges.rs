//! Undo behavior and value preservation for merge operations.

use super::super::*;
use super::helpers::*;
use value_types::CellValue;

#[test]
fn test_undo_merge_produces_merge_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Merge A1:B1
    let _fwd = engine.merge_range(&sid, 0, 0, 0, 1).unwrap();

    // Undo it
    assert!(engine.can_undo());
    let (_patches, result) = engine.undo().unwrap();

    assert!(
        !result.merge_changes.is_empty(),
        "undo of merge should produce merge_changes",
    );
}

#[test]
fn test_merge_range_discards_non_origin_values_after_explicit_unmerge() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine.merge_range(&sid, 0, 0, 1, 1).unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), CellValue::Null);

    engine.unmerge_range(&sid, 0, 0, 1, 1).unwrap();

    assert!(engine.get_all_merges_in_sheet(&sid).is_empty());
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), CellValue::Null);
}

#[test]
fn test_rejected_overlapping_merge_does_not_discard_values() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine.merge_range(&sid, 0, 0, 0, 1).unwrap();
    let (_patches, result) = engine.merge_range(&sid, 0, 0, 1, 1).unwrap();

    assert!(result.merge_changes.is_empty());
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(30.0));
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), num(40.0));
}

#[test]
fn test_undo_merge_restores_discarded_non_origin_values() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine.merge_range(&sid, 0, 0, 1, 1).unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), CellValue::Null);

    assert!(engine.can_undo());
    engine.undo().unwrap();

    assert!(engine.get_all_merges_in_sheet(&sid).is_empty());
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), num(20.0));
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(30.0));
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), num(40.0));
}
