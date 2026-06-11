//! Undo behavior and value preservation for merge operations.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;
use value_types::FiniteF64;

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
fn test_merge_preserves_origin_formula_value_when_child_is_precedent() {
    let sid = sheet_id();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![
                CellData {
                    cell_id: cell_id_a1().to_uuid_string(),
                    row: 0,
                    col: 0,
                    value: num(3.0),
                    formula: Some("=B1+C1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: cell_id_b1().to_uuid_string(),
                    row: 0,
                    col: 1,
                    value: num(2.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440004".to_string(),
                    row: 0,
                    col: 2,
                    value: num(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(3.0));

    engine.merge_range(&sid, 0, 0, 0, 1).unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(3.0));
    assert_eq!(engine.get_formula(&cell_id_a1()).as_deref(), Some("=B1+C1"));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), CellValue::Null);
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
