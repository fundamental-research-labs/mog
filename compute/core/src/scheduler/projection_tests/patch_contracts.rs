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

// ---------------------------------------------------------------------------
// Bug reproduction (FIX-004 / right-fix/spill-teardown):
//
// When a user writes a real value to a member of an existing spill (e.g.,
// types "X" into A2 while A1 = SEQUENCE(5)), the scheduler MUST emit:
//
//   - exactly ONE patch for A2 — the user's "X" — never a teardown null.
//   - a CellChange for the anchor (A1) reflecting its transition to #SPILL!.
//
// Both invariants were violated before the right-fix:
//
//   1. Contradictory emission: a regular CellChange for A2="X" AND a teardown
//      ProjectionCellData for A2 with value=Null in the same RecalcResult.
//      The TS layer had to dedupe; this test pins the contract at the
//      Rust source so dedupe is unnecessary.
//
//   2. Missing anchor change: invalidate_projection_at pre-set A1 to #SPILL!
//      *before* recalc, so when topo eval re-evaluated A1's formula and
//      produced #SPILL! again, the value-equality check suppressed the
//      CellChange. The anchor's display state transition was therefore
//      invisible to the viewport patches.
// ---------------------------------------------------------------------------

#[test]
fn test_write_to_spill_member_emits_single_patch_per_cell_and_anchor_change() {
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

    // Step 2: User writes "X" to A2 (a spill member). This must:
    //   - tear down A1's projection
    //   - record the user's "X" at A2
    //   - report A1 transitioning to #SPILL!
    let a2_id = core
        .ensure_cell_id(&mut mirror, &sheet_id, SheetPos::new(1, 0))
        .unwrap();
    let result = core
        .set_cell(&mut mirror, &sheet_id, a2_id, 1, 0, "X")
        .unwrap();

    // Invariant 1: A2 must appear EXACTLY ONCE across all patches, with
    // its real text value "X" — never with Null/teardown semantics.
    let regular_at_a2: Vec<&CellChange> = result
        .changed_cells
        .iter()
        .filter(|c| {
            c.position
                .as_ref()
                .is_some_and(|p| p.row == 1 && p.col == 0)
        })
        .collect();
    let teardown_at_a2: Vec<&snapshot_types::ProjectionCellData> = result
        .projection_changes
        .iter()
        .flat_map(|pc| pc.projection_cells.iter())
        .filter(|c| c.row == 1 && c.col == 0)
        .collect();

    assert_eq!(
        regular_at_a2.len(),
        1,
        "A2 must have exactly one regular CellChange, got {} — {:?}",
        regular_at_a2.len(),
        regular_at_a2
    );
    let a2_change = regular_at_a2[0];
    assert!(
        matches!(a2_change.value, CellValue::Text(ref s) if s.as_ref() == "X"),
        "A2's CellChange must carry user value \"X\", got {:?}",
        a2_change.value
    );
    assert!(
        teardown_at_a2.is_empty(),
        "A2 must NOT appear in projection_changes — the regular write owns it; \
         emitting a Null-valued teardown for the same cell creates a \
         contradictory patch the buffer cannot reconcile. Found: {:?}",
        teardown_at_a2
    );

    // Invariant 2: A1's transition to #SPILL! must be in changed_cells.
    let a1_change = result
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .is_some_and(|p| p.row == 0 && p.col == 0)
        })
        .expect(
            "A1 transitioned from spill-source to #SPILL! and must appear in \
             changed_cells so the viewport patches its display state",
        );
    assert!(
        matches!(a1_change.value, CellValue::Error(CellError::Spill, _)),
        "A1's CellChange must carry #SPILL!, got {:?}",
        a1_change.value
    );

    // Mirror sanity: A1 is #SPILL!, A2 is "X".
    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::Error(CellError::Spill, None),
        "A1 mirror must be #SPILL!"
    );
    assert!(
        matches!(core.get_cell_value(&mirror, &a2_id).unwrap(), CellValue::Text(s) if s.as_ref() == "X"),
        "A2 mirror must be \"X\""
    );
}

#[test]
fn test_teardown_only_covers_vacated_cells_not_the_blocker() {
    // Set up: A1 = SEQUENCE(5), spilling into A1:A5.
    // User writes "X" to A4 (a spill member further down the column).
    // Expected teardown coverage: A2, A3, A5 (the "vacated" cells); A4 must
    // be excluded because the user's regular CellChange is the authoritative
    // patch for that position. A1 transitions to #SPILL! via changed_cells.
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

    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();

    let a4_id = core
        .ensure_cell_id(&mut mirror, &sheet_id, SheetPos::new(3, 0))
        .unwrap();
    let result = core
        .set_cell(&mut mirror, &sheet_id, a4_id, 3, 0, "X")
        .unwrap();

    // Collect all cells appearing in projection_changes (teardowns).
    let teardown_positions: std::collections::HashSet<(u32, u32)> = result
        .projection_changes
        .iter()
        .flat_map(|pc| pc.projection_cells.iter().map(|c| (c.row, c.col)))
        .collect();

    // Each vacated cell (A2, A3, A5) must be in the teardown.
    for r in [1, 2, 4] {
        assert!(
            teardown_positions.contains(&(r, 0)),
            "vacated cell (row={}, col=0) must be in teardown projection_changes; \
             got positions={:?}",
            r,
            teardown_positions
        );
    }
    // A4 (the user-written cell) MUST NOT be in projection_changes.
    assert!(
        !teardown_positions.contains(&(3, 0)),
        "A4 (user-written) must NOT appear in teardown projection_changes — \
         the regular CellChange for A4 owns it; got positions={:?}",
        teardown_positions
    );

    // Regular changes still carry A4="X" and A1=#SPILL!.
    let a4_change = result
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .is_some_and(|p| p.row == 3 && p.col == 0)
        })
        .expect("A4 must be in changed_cells");
    assert!(
        matches!(a4_change.value, CellValue::Text(ref s) if s.as_ref() == "X"),
        "A4 must be \"X\""
    );
    let a1_change = result
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .is_some_and(|p| p.row == 0 && p.col == 0)
        })
        .expect("A1 must be in changed_cells");
    assert!(
        matches!(a1_change.value, CellValue::Error(CellError::Spill, _)),
        "A1 must be #SPILL!"
    );
}

#[test]
fn test_replacing_one_spill_with_another_emits_no_teardown_for_overlapping_cells() {
    // Set up: A1 = SEQUENCE(3) spills into A1:A3.
    // User writes =SEQUENCE(2) into A2 — A2 is currently a spill member of A1.
    // After recalc:
    //   - A1 transitions to #SPILL! (its spill is blocked by A2 now containing
    //     a different dynamic-array formula).
    //   - A2 spills into A2:A3 with values 1, 2.
    //
    // The wire output must NOT include a teardown null for A3: A3 is
    // authoritatively re-projected to the new spill value (2), and a
    // null teardown for the same position would race the new-spill value.
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
    let result = core
        .set_cell(&mut mirror, &sheet_id, a2_id, 1, 0, "=SEQUENCE(2)")
        .unwrap();

    // Inspect every patch (regular + projection) per position.
    // Build a multiset of (row, col) → list of values.
    use std::collections::HashMap;
    let mut patches_at: HashMap<(u32, u32), Vec<CellValue>> = HashMap::new();
    for c in &result.changed_cells {
        if let Some(pos) = &c.position {
            patches_at
                .entry((pos.row, pos.col))
                .or_default()
                .push(c.value.clone());
        }
    }
    for pc in &result.projection_changes {
        for cell in &pc.projection_cells {
            patches_at
                .entry((cell.row, cell.col))
                .or_default()
                .push(cell.value.clone());
        }
    }

    // A3 (row=2, col=0) must appear EXACTLY once with value 2 — never with
    // a Null teardown alongside the new-spill value.
    let a3_patches = patches_at.get(&(2, 0)).cloned().unwrap_or_default();
    assert_eq!(
        a3_patches.len(),
        1,
        "A3 must have exactly one patch (the new-spill value), got {}: {:?}",
        a3_patches.len(),
        a3_patches
    );
    assert!(
        matches!(a3_patches[0], CellValue::Number(_)),
        "A3 must carry a numeric spill value, got {:?}",
        a3_patches[0]
    );
    assert!(
        !matches!(a3_patches[0], CellValue::Null),
        "A3 must NOT have a Null teardown patch — the new-spill value owns it"
    );

    // A2 (the new anchor) must have exactly one regular CellChange (the
    // top-left of the new spill = 1). It must NOT also appear in
    // projection_changes (only non-anchor cells are projection cells).
    let a2_patches = patches_at.get(&(1, 0)).cloned().unwrap_or_default();
    assert_eq!(
        a2_patches.len(),
        1,
        "A2 must have exactly one patch (the new anchor's top-left), got {}: {:?}",
        a2_patches.len(),
        a2_patches
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
