#![allow(unused_imports)]

use super::super::test_helpers::*;
use super::super::*;
use super::helpers::*;
use crate::mirror::CellMirror;
use crate::snapshot::CellData;
use std::sync::Arc;
use value_types::CellValue;

#[test]
fn test_set_array_formula_marks_anchor_and_registers_projection() {
    let a1_str = cell_id_str(0, 0);
    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // Enter `=SEQUENCE(2,3)` as a 2x3 CSE on A1:C2.
    let _result = core
        .set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula should succeed");

    // Anchor is marked.
    assert!(
        mirror.is_cse_anchor(&a1_id),
        "anchor must be in mirror.cse_anchors after set_array_formula"
    );
    // Projection extent matches the user's selection.
    let proj = mirror
        .projection_registry
        .get(&a1_id)
        .expect("projection registered");
    assert_eq!(proj.origin_row, 0);
    assert_eq!(proj.origin_col, 0);
    assert_eq!(proj.rows, 2);
    assert_eq!(proj.cols, 3);
    // Anchor lookup answers correctly for the anchor cell and a member.
    let (a, _) = mirror
        .cse_anchor_covering(&sheet_id, 0, 0)
        .expect("anchor covers itself");
    assert_eq!(a, a1_id);
    let (a, _) = mirror
        .cse_anchor_covering(&sheet_id, 1, 2)
        .expect("anchor covers (1,2)");
    assert_eq!(a, a1_id);
    // Out-of-extent positions are not covered.
    assert!(mirror.cse_anchor_covering(&sheet_id, 2, 0).is_none());
}

#[test]
fn test_set_cell_rejects_partial_array_write_on_member() {
    let a1_str = cell_id_str(0, 0);
    let b2_str = cell_id_str(1, 1);
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
        // Pre-allocate a CellId for B2 so set_cell has a target without
        // needing the engine-services layer (this is a scheduler-level
        // test).
        CellData {
            cell_id: b2_str.clone(),
            row: 1,
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
    let b2_id = cell_id_from_str(&b2_str);

    // Enter a 2x3 CSE on A1:C2.
    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula should succeed");

    // Writing to B2 (a member) must be rejected.
    let err = core
        .set_cell(&mut mirror, &sheet_id, b2_id, 1, 1, "X")
        .expect_err("partial-array write must be rejected");
    match err {
        ComputeError::PartialArrayWrite {
            row,
            col,
            anchor_row,
            anchor_col,
            ..
        } => {
            assert_eq!((row, col), (1, 1));
            assert_eq!((anchor_row, anchor_col), (0, 0));
        }
        other => panic!("expected PartialArrayWrite, got {:?}", other),
    }
}

#[test]
fn test_set_cell_rejects_partial_array_write_on_anchor() {
    let a1_str = cell_id_str(0, 0);
    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula should succeed");

    // Re-typing into the anchor (non-Clear) must be rejected — the
    // user must clear the array first.
    let err = core
        .set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=A1+1")
        .expect_err("anchor non-clear write must be rejected");
    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "got {:?}",
        err,
    );
}

#[test]
fn test_clear_cells_on_anchor_tears_down_cse() {
    let a1_str = cell_id_str(0, 0);
    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula should succeed");
    assert!(mirror.is_cse_anchor(&a1_id));

    // clear_cells on the anchor tears down the CSE registration.
    let _ = core.clear_cells(&mut mirror, &[a1_id]).unwrap();

    assert!(
        !mirror.is_cse_anchor(&a1_id),
        "anchor must be unmarked after clear_cells",
    );
    assert!(
        mirror.projection_registry.get(&a1_id).is_none(),
        "projection must be cleared after clear_cells",
    );
}

#[test]
fn test_clear_anchor_via_set_cell_tears_down_cse() {
    // Per-architecture: anchor edits are rejected EXCEPT a Clear
    // input — that path tears down the CSE. This is the natural
    // entry point when the user selects the anchor and presses
    // Delete (which routes to ClearCells in the action layer, but
    // engine-internal callers can also issue CellInput::Clear via
    // set_cell directly).
    let a1_str = cell_id_str(0, 0);
    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula should succeed");

    // Clear the anchor via set_cell with CellInput::Clear.
    use crate::storage::engine::mutation::CellInput;
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, CellInput::Clear)
        .expect("Clear on anchor must succeed");

    assert!(
        !mirror.is_cse_anchor(&a1_id),
        "anchor must be unmarked after Clear on anchor",
    );
}

#[test]
fn test_set_array_formula_re_entry_replaces_extent() {
    let a1_str = cell_id_str(0, 0);
    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // First entry: 2x3
    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .unwrap();
    // Re-entry on the same anchor: 1x2 — should replace the prior extent.
    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 0, 1, "=SEQUENCE(1,2)")
        .unwrap();

    let proj = mirror.projection_registry.get(&a1_id).expect("registered");
    assert_eq!(proj.rows, 1);
    assert_eq!(proj.cols, 2);
    assert!(mirror.is_cse_anchor(&a1_id));
}

// ---------------------------------------------------------------------------
// T6 table dependency work → 64: CSE rejection-family completeness.
//
// unified-reference over-rejected Clear on CSE members. table dependency work swung too
// far and allowed teardown via SubstituteAnchorClear. array-member clear regression
// corrects to true Excel parity: Clear on a single CSE member is
// rejected with PartialArrayWrite (same as typing). The user must
// select the entire CSE extent to delete.
//
//   6a) `Clear` on a CSE *member* is rejected with PartialArrayWrite.
//   6b) `set_array_formula` cross-CSE overlap check must scan the whole
//       new rectangle, not only its top-left corner.
// ---------------------------------------------------------------------------

#[test]
fn t6_clear_on_cse_member_rejects_with_partial_array_write() {
    // Anchor A1, 2x3 CSE on A1:C2. Clear B2 (a member) — must be
    // rejected with PartialArrayWrite (Excel parity: "You cannot
    // change part of an array"). The CSE must remain intact.
    let a1_str = cell_id_str(0, 0);
    let b2_str = cell_id_str(1, 1);
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
            cell_id: b2_str.clone(),
            row: 1,
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
    let b2_id = cell_id_from_str(&b2_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula");

    assert!(mirror.is_cse_anchor(&a1_id));

    use crate::storage::engine::mutation::CellInput;
    let err = core
        .set_cell(&mut mirror, &sheet_id, b2_id, 1, 1, CellInput::Clear)
        .expect_err("Clear on CSE member must be rejected");
    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "expected PartialArrayWrite, got {:?}",
        err
    );
    assert!(
        mirror.is_cse_anchor(&a1_id),
        "CSE must remain intact after rejected member-Clear",
    );
}

#[test]
fn t6_clear_on_cse_member_via_clear_cells_tears_down_whole_array() {
    // Same family, different entry point: scheduler-level `clear_cells`
    // on a member ID also tears down the whole array.
    let a1_str = cell_id_str(0, 0);
    let b2_str = cell_id_str(1, 1);
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
            cell_id: b2_str.clone(),
            row: 1,
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
    let b2_id = cell_id_from_str(&b2_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula");

    let _ = core.clear_cells(&mut mirror, &[b2_id]).unwrap();

    assert!(
        !mirror.is_cse_anchor(&a1_id),
        "anchor must be unmarked after clear_cells on member",
    );
}

#[test]
fn t6_type_into_member_still_rejected_with_partial_array_write() {
    // Type-into-member is the OTHER half of the family — that path
    // remains a reject. Lock it in so the family table stays correct.
    let a1_str = cell_id_str(0, 0);
    let b2_str = cell_id_str(1, 1);
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
            cell_id: b2_str.clone(),
            row: 1,
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
    let b2_id = cell_id_from_str(&b2_str);

    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 2, "=SEQUENCE(2,3)")
        .expect("set_array_formula");

    // Type "X" into B2 — text input on a CSE member: reject.
    let err = core
        .set_cell(&mut mirror, &sheet_id, b2_id, 1, 1, "X")
        .expect_err("Parse on CSE member must reject");
    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "got {:?}",
        err
    );
    // The CSE itself must NOT be torn down by the rejected attempt.
    assert!(mirror.is_cse_anchor(&a1_id));
}

#[test]
fn t6_set_array_formula_overlap_detected_by_interior_cells() {
    // legacy string-rewrite narrow check resolved only `(top_row, left_col)`. New
    // CSE C1:D3 overlapping existing A2:E2: C1 is OUTSIDE the old
    // extent, but C2/D2 are interior. filter viewport must detect this.
    let a2_str = cell_id_str(1, 0); // anchor of existing CSE
    let c1_str = cell_id_str(0, 2); // new anchor (outside old extent)
    let snap = spill_snapshot(vec![
        CellData {
            cell_id: a2_str.clone(),
            row: 1,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: c1_str.clone(),
            row: 0,
            col: 2,
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
    let a2_id = cell_id_from_str(&a2_str);
    let c1_id = cell_id_from_str(&c1_str);

    // Existing CSE: A2:E2 (1 row × 5 cols, anchored at A2).
    core.set_array_formula(&mut mirror, &sheet_id, a2_id, 1, 0, 1, 4, "=SEQUENCE(1,5)")
        .expect("first set_array_formula");

    // New CSE: C1:D3 (3 rows × 2 cols, anchored at C1). Top-left C1
    // is OUTSIDE the existing A2:E2; but interior cells C2/D2 are
    // inside. Must be rejected.
    let err = core
        .set_array_formula(&mut mirror, &sheet_id, c1_id, 0, 2, 2, 3, "=SEQUENCE(3,2)")
        .expect_err("interior-cell overlap must be rejected");
    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "got {:?}",
        err
    );
}

#[test]
fn t6_set_array_formula_non_overlapping_succeeds() {
    // Sanity: a non-overlapping CSE next to an existing one is allowed.
    let a1_str = cell_id_str(0, 0);
    let d1_str = cell_id_str(0, 3);
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
            cell_id: d1_str.clone(),
            row: 0,
            col: 3,
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
    let d1_id = cell_id_from_str(&d1_str);

    // A1:B2
    core.set_array_formula(&mut mirror, &sheet_id, a1_id, 0, 0, 1, 1, "=SEQUENCE(2,2)")
        .expect("first set_array_formula");
    // D1:E2 — adjacent, no overlap.
    core.set_array_formula(&mut mirror, &sheet_id, d1_id, 0, 3, 1, 4, "=SEQUENCE(2,2)")
        .expect("non-overlapping must succeed");

    assert!(mirror.is_cse_anchor(&a1_id));
    assert!(mirror.is_cse_anchor(&d1_id));
}
