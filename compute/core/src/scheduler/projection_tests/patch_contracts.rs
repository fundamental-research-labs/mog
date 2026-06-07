#![allow(unused_imports)]

use super::super::test_helpers::*;
use super::super::*;
use super::helpers::*;
use crate::mirror::CellMirror;
use crate::snapshot::CellData;
use std::sync::Arc;
use value_types::CellValue;

#[test]
fn test_clear_anchor_surfaces_cleared_spill_targets_in_recalc() {
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

    // Step 1: A1 = SEQUENCE(4) → spills to A1:A4 = 1,2,3,4
    let create_result = core
        .set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(4)")
        .unwrap();
    assert!(
        !create_result.projection_changes.is_empty(),
        "spill creation must emit projection_changes"
    );
    let created_targets: std::collections::HashSet<(u32, u32)> = create_result
        .projection_changes
        .iter()
        .flat_map(|pc| pc.projection_cells.iter().map(|c| (c.row, c.col)))
        .collect();
    assert!(created_targets.contains(&(1, 0)), "A2 patched on create");
    assert!(created_targets.contains(&(2, 0)), "A3 patched on create");
    assert!(created_targets.contains(&(3, 0)), "A4 patched on create");

    // Step 2: Clear A1 (the anchor). The spilled values at A2:A4 must be
    // surfaced in the RecalcResult so the viewport patches them to empty.
    let clear_result = core.clear_cells(&mut mirror, &[a1_id]).unwrap();

    // Verify col_data was cleared (engine-level invariant — already known to work).
    let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
    let col_slice = sheet_mirror.get_column_slice(0).expect("col_data");
    for r in 1..4u32 {
        assert_eq!(
            col_slice[r as usize],
            CellValue::Null,
            "A{} must be Null in col_data after anchor clear",
            r + 1
        );
    }

    // Now the bug: nothing in clear_result tells the UI that A2:A4 changed.
    // Either projection_changes must contain Null patches for A2:A4, or
    // changed_cells must include CellChange entries for those positions.
    let mentioned_positions: std::collections::HashSet<(u32, u32)> = clear_result
        .changed_cells
        .iter()
        .filter_map(|c| c.position.as_ref().map(|p| (p.row, p.col)))
        .chain(
            clear_result
                .projection_changes
                .iter()
                .flat_map(|pc| pc.projection_cells.iter().map(|c| (c.row, c.col))),
        )
        .collect();

    for r in 1..4u32 {
        assert!(
            mentioned_positions.contains(&(r, 0)),
            "BUG: A{} (cleared spill target) is not in RecalcResult — viewport will keep stale value. \
             changed_cells={:?} projection_changes={:?}",
            r + 1,
            clear_result
                .changed_cells
                .iter()
                .map(|c| (c.position.as_ref().map(|p| (p.row, p.col)), c.value.clone()))
                .collect::<Vec<_>>(),
            clear_result
                .projection_changes
                .iter()
                .map(|pc| pc
                    .projection_cells
                    .iter()
                    .map(|c| (c.row, c.col, c.value.clone()))
                    .collect::<Vec<_>>())
                .collect::<Vec<_>>(),
        );
    }
}

#[test]
fn test_write_to_spill_member_rejects_without_tearing_down_projection() {
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

    // Step 1: A1 = SEQUENCE(5) → spills to A1:A5 = 1,2,3,4,5
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();
    assert!(
        mirror.projection_registry.is_projected(&sheet_id, 1, 0),
        "A2 should be a projected position before user edit"
    );

    let a2_id = core
        .ensure_cell_id(&mut mirror, &sheet_id, SheetPos::new(1, 0))
        .unwrap();
    let err = core
        .set_cell(&mut mirror, &sheet_id, a2_id, 1, 0, "X")
        .expect_err("editing a dynamic-array spill member should reject");

    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "expected PartialArrayWrite, got {err:?}",
    );

    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::number(1.0),
        "A1 mirror should remain the spill anchor value"
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(1, 0))
            .cloned(),
        Some(CellValue::number(2.0)),
        "A2 should remain projected from A1 after rejected write"
    );
}

#[test]
fn test_formula_write_to_spill_member_is_rejected() {
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

    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(3)")
        .unwrap();

    let a2_id = core
        .ensure_cell_id(&mut mirror, &sheet_id, SheetPos::new(1, 0))
        .unwrap();
    let err = core
        .set_cell(&mut mirror, &sheet_id, a2_id, 1, 0, "=SEQUENCE(2)")
        .expect_err("formula write into an active spill member should reject");

    assert!(
        matches!(err, ComputeError::PartialArrayWrite { .. }),
        "expected PartialArrayWrite, got {err:?}",
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::number(1.0),
        "A1 should remain the original spill anchor"
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(2, 0))
            .cloned(),
        Some(CellValue::number(3.0)),
        "A3 should remain the original spill child"
    );
}

#[test]
fn test_clearing_blocker_restores_spill_via_clear_cells() {
    // Set up: A1 = SEQUENCE(3); A2 = "X" (blocker) at the time SEQUENCE evaluates.
    // Result: A1 = #SPILL!. spill_blockers tracks A2 → A1.
    // User clears A2 via clear_cells. The spill source A1 must re-evaluate
    // and successfully spill. The recalc result must surface:
    //   - A2 = Null (from the clear)
    //   - A1 = top-left of new spill
    //   - A2/A3 as restoration projection_changes (non-null values)
    let a1_str = cell_id_str(0, 0);
    let a2_str = cell_id_str(1, 0);

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
            cell_id: a2_str.clone(),
            row: 1,
            col: 0,
            value: CellValue::Text("X".into()),
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
    let a2_id = cell_id_from_str(&a2_str);

    // Write SEQUENCE(3) — A1 should be #SPILL! because A2 is blocking.
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(3)")
        .unwrap();
    assert!(
        matches!(
            *core.get_cell_value(&mirror, &a1_id).unwrap(),
            CellValue::Error(CellError::Spill, _)
        ),
        "A1 must be #SPILL! while A2 blocks"
    );

    // Clear A2 via clear_cells. This should re-dirty A1 (via spill_blockers)
    // and surface the spill restoration.
    let result = core.clear_cells(&mut mirror, &[a2_id]).unwrap();

    // A1 transitions back to a number (top-left of the spill = 1).
    let a1_change = result
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .is_some_and(|p| p.row == 0 && p.col == 0)
        })
        .expect("A1 must be in changed_cells after blocker clear");
    assert!(
        matches!(a1_change.value, CellValue::Number(n) if n.get() == 1.0),
        "A1 must be 1 (top-left of restored spill), got {:?}",
        a1_change.value
    );

    // A2/A3 spill members carry the projected values (2, 3) in
    // projection_changes — not Null teardowns.
    let proj_at: std::collections::HashMap<(u32, u32), CellValue> = result
        .projection_changes
        .iter()
        .flat_map(|pc| {
            pc.projection_cells
                .iter()
                .map(|c| ((c.row, c.col), c.value.clone()))
        })
        .collect();

    let a2_proj = proj_at
        .get(&(1, 0))
        .expect("A2 must have a projection patch (restored)");
    assert!(
        matches!(a2_proj, CellValue::Number(n) if n.get() == 2.0),
        "A2 projection patch must carry 2, got {:?}",
        a2_proj
    );
    let a3_proj = proj_at
        .get(&(2, 0))
        .expect("A3 must have a projection patch (restored)");
    assert!(
        matches!(a3_proj, CellValue::Number(n) if n.get() == 3.0),
        "A3 projection patch must carry 3, got {:?}",
        a3_proj
    );
}

// ---------------------------------------------------------------------------
// CSE (Ctrl+Shift+Enter) array-formula entry + partial-write rejection.
//
// `set_array_formula` is the new authoritative path for CSE entries; it
// marks the anchor in `mirror.cse_anchors` and registers the projection
// extent the user selected. `set_cell` then rejects any write that
// falls inside that extent (anchor or member) with
// `ComputeError::PartialArrayWrite`. Tearing down the CSE is exactly
// `clear_cells` on the anchor.
// ---------------------------------------------------------------------------
