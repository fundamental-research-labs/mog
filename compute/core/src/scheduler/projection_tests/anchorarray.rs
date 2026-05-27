#![allow(unused_imports)]

use super::super::test_helpers::*;
use super::super::*;
use super::helpers::*;
use crate::mirror::CellMirror;
use crate::snapshot::CellData;
use std::sync::Arc;
use value_types::CellValue;

#[test]
fn test_anchorarray_sum_over_spill() {
    let a1_str = cell_id_str(0, 0);
    let b1_str = cell_id_str(0, 1);

    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b1_str.clone(),
            row: 0,
            col: 1,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b1_id = cell_id_from_str(&b1_str);

    // Set A1 = SEQUENCE(10) — spills 1..10 into A1:A10
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(10)")
        .unwrap();

    // Set B1 = SUM(ANCHORARRAY(A1)) — should sum 1+2+...+10 = 55
    core.set_cell(&mut mirror, &sheet_id, b1_id, 0, 1, "=SUM(ANCHORARRAY(A1))")
        .unwrap();

    let b1_val = core.get_cell_value(&mirror, &b1_id).unwrap();
    assert_eq!(
        *b1_val,
        CellValue::number(55.0),
        "SUM(ANCHORARRAY(A1)) should be 55 for SEQUENCE(10)"
    );
}

/// Test: =SUM(ANCHORARRAY(B1)) where B1 is NOT a projection source → #VALUE!
#[test]
fn test_anchorarray_non_source_returns_value_error() {
    let a1_str = cell_id_str(0, 0);
    let b1_str = cell_id_str(0, 1);

    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b1_str.clone(),
            row: 0,
            col: 1,
            value: CellValue::number(42.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // A1 = SUM(ANCHORARRAY(B1)) — B1 is a plain scalar, not a projection source
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SUM(ANCHORARRAY(B1))")
        .unwrap();

    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    assert_eq!(
        *a1_val,
        CellValue::Error(CellError::Value, None),
        "ANCHORARRAY on non-source cell should produce #VALUE!"
    );
}

/// Test: =SUM(ANCHORARRAY(A1)) after A1's formula is deleted → #VALUE!
#[test]
fn test_anchorarray_after_source_deleted() {
    let a1_str = cell_id_str(0, 0);
    let b1_str = cell_id_str(0, 1);

    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a1_str.clone(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: b1_str.clone(),
            row: 0,
            col: 1,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);
    let b1_id = cell_id_from_str(&b1_str);

    // Set A1 = SEQUENCE(5), then B1 = SUM(ANCHORARRAY(A1))
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();
    core.set_cell(&mut mirror, &sheet_id, b1_id, 0, 1, "=SUM(ANCHORARRAY(A1))")
        .unwrap();

    // Verify it works first
    let b1_val = core.get_cell_value(&mirror, &b1_id).unwrap();
    assert_eq!(
        *b1_val,
        CellValue::number(15.0),
        "SUM(ANCHORARRAY(A1)) should be 15 for SEQUENCE(5)"
    );

    // Now clear A1's formula by setting it to a plain value
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "hello")
        .unwrap();

    // B1 should now be #VALUE! because A1 is no longer a projection source
    let b1_val = core.get_cell_value(&mirror, &b1_id).unwrap();
    assert_eq!(
        *b1_val,
        CellValue::Error(CellError::Value, None),
        "ANCHORARRAY after source deletion should produce #VALUE!"
    );
}

// ---------------------------------------------------------------------------
// Bug reproduction: anchor clear must surface the cleared spill targets
// in the RecalcResult so the viewport buffer can patch them to empty.
// ---------------------------------------------------------------------------
