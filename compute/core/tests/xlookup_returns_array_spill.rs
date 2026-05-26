//! Regression test: `XLOOKUP` with a multi-cell return array must spill.
//!
//! Bug (origin/dev HEAD): `=XLOOKUP("k2", A1:A3, B1:D3)` placed at F1 should
//! spill across F1:H1 with the matched row `["a2","b2","c2"]`. Today F1 picks
//! up just `"a2"` (the top-left of the produced 1x3 array) and G1, H1 stay
//! blank — spill is never registered.
//!
//! Root cause (per prior investigation):
//!   `FnXlookup` in `compute/core/crates/compute-functions/src/lookup/modern.rs`
//!   does not override `returns_array() -> bool`; the default in `trait_def.rs`
//!   is `false`. The spill scheduler at `compute/core/src/scheduler/spill.rs`
//!   evaluates the formula, sees `CellValue::Array { rows: 1, cols: 3 }`, then
//!   consults `ast_cache.get(cell_id).is_dynamic_array`. The dynamic-array
//!   detector (`ast_contains_array_function` in `scheduler/init.rs`) sets
//!   `is_dynamic_array=true` only when the called function is in
//!   `INLINE_ARRAY_FUNCTIONS` OR has `returns_array() == true`. Since
//!   `FnXlookup::returns_array()` returns the default `false`,
//!   `is_dynamic_array` stays `false` and the spill scheduler takes the
//!   implicit-intersection branch, overwriting `*new_value` with `arr.get(0,0)`.
//!   Spill is never registered, so G1/H1 remain blank.
//!
//! The fix (NOT applied here — this test is the failing deliverable) is to
//! add `fn returns_array(&self) -> bool { true }` to
//! `impl PureFunction for FnXlookup`.
//!
//! Run:
//!   cargo test -p compute-core --test xlookup_returns_array_spill -- --nocapture

#![allow(dead_code)]
#[allow(dead_code)]
mod stress_common;
use stress_common::*;

use cell_types::SheetPos;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use value_types::CellValue;

/// Read whatever value sits at the given sheet position — works for both
/// real cells (origin of a spill) and projected col_data (spill targets).
fn pos_value(mirror: &CellMirror, si: u32, row: u32, col: u32) -> Option<CellValue> {
    mirror
        .get_cell_value_at(&sid(si), SheetPos::new(row, col))
        .cloned()
}

/// Assert the value at a sheet position is `CellValue::Text(expected)`.
/// Works for spill-origin cells (F1) and spill-target positions (G1, H1).
fn assert_pos_text(mirror: &CellMirror, si: u32, row: u32, col: u32, expected: &str) {
    match pos_value(mirror, si, row, col) {
        Some(CellValue::Text(t)) => assert_eq!(
            &*t, expected,
            "pos ({si},{row},{col}) expected Text({expected:?}), got Text({t:?})",
        ),
        other => panic!("pos ({si},{row},{col}) expected Text({expected:?}), got {other:?}",),
    }
}

/// Assert the value at a sheet position is empty / Null — spill must not
/// bleed past the declared array shape.
fn assert_pos_blank(mirror: &CellMirror, si: u32, row: u32, col: u32) {
    match pos_value(mirror, si, row, col) {
        None | Some(CellValue::Null) => {}
        Some(other) => panic!("pos ({si},{row},{col}) expected blank/Null, got {other:?}",),
    }
}

/// `XLOOKUP("k2", A1:A3, B1:D3)` must spill across F1:H1 = ["a2","b2","c2"].
///
/// Pre-fix: F1 carries `"a2"` as a scalar (top-left of the 1x3 array, surfaced
/// via the implicit-intersection branch of the spill scheduler) but G1/H1
/// remain blank because `is_dynamic_array=false` suppresses spill registration.
/// The G1 assertion below is the one that fails on `origin/dev` HEAD.
#[test]
fn xlookup_multi_cell_return_spills_across_row() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();

    // Empty sheet — we will populate everything via the production parse path
    // (`Scheduler::set_cell` → `CellInput::Parse`) so the test exercises the
    // same edit pipeline a UI typing session would.
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");

    // A1:A3 — the lookup column.
    let _ = set(&mut core, &mut mirror, 0, 0, 0, "k1");
    let _ = set(&mut core, &mut mirror, 0, 1, 0, "k2");
    let _ = set(&mut core, &mut mirror, 0, 2, 0, "k3");

    // B1:D3 — the 3x3 return grid (one row per key, three columns wide).
    let grid: [[&str; 3]; 3] = [["a1", "b1", "c1"], ["a2", "b2", "c2"], ["a3", "b3", "c3"]];
    for (r, row) in grid.iter().enumerate() {
        for (c, cell) in row.iter().enumerate() {
            // B is col 1, C is col 2, D is col 3.
            let _ = set(&mut core, &mut mirror, 0, r as u32, (c as u32) + 1, cell);
        }
    }

    // Sanity-check the inputs landed (catches any setup-vs-bug confusion in
    // the failure output: if these panic, the bug we want to expose has not
    // even been reached).
    assert_pos_text(&mirror, 0, 1, 0, "k2");
    assert_pos_text(&mirror, 0, 1, 1, "a2");
    assert_pos_text(&mirror, 0, 1, 2, "b2");
    assert_pos_text(&mirror, 0, 1, 3, "c2");

    // F1 = =XLOOKUP("k2", A1:A3, B1:D3). F is column 5 (0-based).
    // The trailing `,,0,1` keeps us in plain exact-match, default search mode
    // — same defaults the parser will inject anyway, written explicitly for
    // documentation.
    let _ = set(
        &mut core,
        &mut mirror,
        0,
        0,
        5,
        "=XLOOKUP(\"k2\",A1:A3,B1:D3)",
    );

    // F1 — spill origin. Pre-fix this passes because the implicit-intersection
    // branch writes `arr.get(0,0)` → "a2". Post-fix it still passes because
    // the spill scheduler stores the array's top-left scalar at the origin.
    assert_pos_text(&mirror, 0, 0, 5, "a2");

    // G1 — first spill target. Pre-fix: BLANK (the assertion that exposes the
    // bug). Post-fix: "b2".
    assert_pos_text(&mirror, 0, 0, 6, "b2");

    // H1 — second spill target. Pre-fix: BLANK. Post-fix: "c2".
    assert_pos_text(&mirror, 0, 0, 7, "c2");

    // I1 — past the end of the 1x3 spill. Must remain blank both pre- and
    // post-fix; this guards a future over-eager fix from spilling one column
    // too far.
    assert_pos_blank(&mirror, 0, 0, 8);
}
