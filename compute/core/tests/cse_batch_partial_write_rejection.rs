//! CSE (Ctrl+Shift+Enter) batch-path partial-write rejection.
//!
//! `ComputeCore::set_cell` rejects writes that fall inside an existing CSE
//! array-formula extent with `ComputeError::PartialArrayWrite`
//! (`compute/core/src/scheduler/edit.rs:49-87`). The batch entry point
//! `ComputeCore::set_cells` (which is the production user-edit path —
//! `Worksheet::setCell` → `setCellsByPosition` lowers a single cell write
//! into a one-element batch) skips that guard: it calls `process_input`
//! directly without first checking `mirror.cse_anchor_covering(...)`. The
//! result is that real user typing into a CSE member silently overwrites
//! the projection, splitting the array.
//!
//! This is the regression test that pins the contract. It currently FAILS
//! before the fix because `set_cells` does not reject partial-array
//! writes; once the guard is lifted to cover both single and batch paths,
//! it will pass.

#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_common;
use stress_common::*;

use cell_types::SheetId;
use compute_core::bridge_types::CellInput;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use value_types::{CellValue, ComputeError};

#[test]
fn batch_path_rejects_partial_array_write_into_cse_member() {
    // ----- Setup -----------------------------------------------------------
    // A1:A3 = [10, 20, 30], B1:B3 = [1, 2, 3]. D1 will host a 3x1 CSE
    // `=A1:A3*B1:B3` covering D1:D3. We pre-allocate D1's CellId via the
    // snapshot so `set_array_formula` has an anchor, and pre-allocate D2's
    // CellId so the batch write below has a concrete target without
    // routing through the engine-services CellId allocator.
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(10.0), None),
            (1, 0, CellValue::number(20.0), None),
            (2, 0, CellValue::number(30.0), None),
            (0, 1, CellValue::number(1.0), None),
            (1, 1, CellValue::number(2.0), None),
            (2, 1, CellValue::number(3.0), None),
            // Pre-allocate the anchor + the member cell we will try to
            // overwrite below.
            (0, 3, CellValue::Null, None), // D1 (anchor)
            (1, 3, CellValue::Null, None), // D2 (member)
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let sheet_id = sid(0);
    let d1_id = cid(0, 0, 3);
    let d2_id = cid(0, 1, 3);

    // ----- Lay down the CSE array formula on D1:D3 ------------------------
    core.set_array_formula(
        &mut mirror,
        &sheet_id,
        d1_id,
        /* top_row */ 0,
        /* left_col */ 3,
        /* bottom_row */ 2,
        /* right_col */ 3,
        "=A1:A3*B1:B3",
    )
    .expect("set_array_formula should succeed on an empty rectangle");

    // Sanity: D2 = 20 * 2 = 40 — the spill landed.
    assert_pos_number(&mirror, 0, 1, 3, 40.0);

    // ----- Batch-path partial-write attempt -------------------------------
    // The production write path: `Worksheet::setCell` →
    // `setCellsByPosition` → `mutation_set_cells_by_position`
    // (compute/core/src/storage/engine/services/mutation_handlers/cell_mutations.rs:290-323)
    // → `ComputeCore::set_cells`. Even a single-cell user edit lowers to a
    // one-element batch, so this is the path that real keystrokes take.
    let edits: Vec<(SheetId, cell_types::CellId, u32, u32, CellInput)> = vec![(
        sheet_id,
        d2_id,
        1,
        3,
        CellInput::Literal {
            text: "999".to_string(),
        },
    )];

    let result = core.set_cells(&mut mirror, &edits, /* skip_cycle_check */ false);

    // ----- Assertion 1: returned Err(PartialArrayWrite) -------------------
    // This assertion currently fails because `ComputeCore::set_cells` skips
    // the `cse_anchor_covering` guard that `ComputeCore::set_cell` has at
    // `compute/core/src/scheduler/edit.rs:49-87`. The fix is to lift that
    // guard into `process_input` (or its caller) so both the single-cell
    // and batch paths reject partial-array writes uniformly.
    match result {
        Err(ComputeError::PartialArrayWrite {
            row,
            col,
            anchor_row,
            anchor_col,
            ..
        }) => {
            assert_eq!(
                (row, col),
                (1, 3),
                "PartialArrayWrite must report the rejected cell's (row, col)"
            );
            assert_eq!(
                (anchor_row, anchor_col),
                (0, 3),
                "PartialArrayWrite must report the CSE anchor at D1=(0,3)"
            );
        }
        Err(other) => panic!(
            "expected Err(ComputeError::PartialArrayWrite), got Err({:?})",
            other
        ),
        Ok(_) => panic!(
            "expected Err(ComputeError::PartialArrayWrite), got Ok(_) — \
             ComputeCore::set_cells silently overwrote D2 (a CSE member). \
             The single-cell guard at scheduler/edit.rs:49-87 is not \
             mirrored in scheduler/edit.rs::set_cells, so all production \
             edits (which go through the batch path) skip the check."
        ),
    }

    // ----- Assertion 2: D2 was NOT mutated --------------------------------
    // Atomicity: even if a future fix returns Err, it must not have written
    // 999 into D2 first. D2 must still hold the spilled product 40.
    assert_pos_number(&mirror, 0, 1, 3, 40.0);
}
