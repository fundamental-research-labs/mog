//! Integration test: a dynamic-array spill must be blocked when its target
//! range overlaps an existing merged-cell region.
//!
//! Bug (currently exposed by this test):
//!   `ProjectionRegistry::check_conflict` (compute/core/src/projection.rs:267-313)
//!   only recognizes two blocker classes — foreign-projection overlap and existing
//!   non-null cell content via `mirror.resolve_cell_id`. It never queries
//!   `mirror.get_merge_regions(sheet_id)`. As a result, a formula like
//!   `=SEQUENCE(5)` placed at A1 will happily project values into A1:A5 even when
//!   A3:B3 is already merged. Excel's behavior, and the behavior every other
//!   spreadsheet engine ships, is to refuse the spill: the anchor displays
//!   `#SPILL!` and no projection cells are written.
//!
//! A companion UI scenario already covers this end-to-end. This test pins the
//! same behavior at the compute-core layer so the regression is caught at the
//! unit boundary, not just by the slow UI suite.
//!
//! Run:
//!   cargo test -p compute-core --test spill_blocker_merged_region -- --nocapture
//!
//! Expected before the fix: FAILS at the A1 == #SPILL! assertion.

use cell_types::{CellId, SheetId};
use compute_core::mirror::{CellMirror, MergeRegion};
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// UUID helpers — same shape as the helpers in scheduler/test_helpers.rs and
// the `sid`/`cid` helpers used elsewhere in compute-core's test suite.
// ---------------------------------------------------------------------------

fn sid(suffix: u128) -> SheetId {
    SheetId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", suffix)).unwrap()
}

fn cid(suffix: u128) -> CellId {
    CellId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", suffix)).unwrap()
}

fn sid_str(suffix: u128) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}

/// Build a single-sheet workbook with no cells. Sheet id = `sid(1)`.
fn empty_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid_str(1),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Build a single-sheet workbook with a 2-cell horizontal merge at A3:B3
/// represented as plain content cells. The merge metadata itself is injected
/// post-init via `mirror.add_merge_region`, since the public `WorkbookSnapshot`
/// type doesn't yet carry merges (see `mirror/snapshot.rs::hydrate_domain_maps`).
fn snapshot_with_merge_anchor() -> WorkbookSnapshot {
    // We deliberately leave the merge anchor at A3 *empty* (no value, no
    // formula) so the existing "non-null cell content" blocker class in
    // `check_conflict` cannot fire. The only thing standing between the
    // SEQUENCE spill and A3 is the merge region itself.
    empty_snapshot()
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

/// `=SEQUENCE(5)` at A1 must spill #SPILL! when A3:B3 is merged.
///
/// Sequence:
///  1. Bootstrap empty Sheet1 (100x26).
///  2. Pre-merge A3:B3.
///  3. Sanity-check the merge is registered in the mirror.
///  4. Set A1 = `=SEQUENCE(5)`.
///  5. Assert A1 evaluates to `#SPILL!` (currently it evaluates to `1`).
///  6. Assert A2 was NOT populated (must be Null, not 2). This is the
///     stronger, "did the engine bail out before writing anything?" check —
///     a fix that emits `#SPILL!` but still writes the projection would pass
///     step 5 alone.
///  7. Baseline contrast: unmerge A3:B3 and re-set the formula. The spill
///     must now succeed (A1..A5 == 1..5). Without this, the test could be
///     "passing for the wrong reason" — e.g., parser failure or a global
///     SEQUENCE outage.
#[test]
fn sequence_spill_blocked_by_merged_region() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    // Step 1: bootstrap.
    core.init_from_snapshot(&mut mirror, snapshot_with_merge_anchor())
        .expect("init_from_snapshot failed");
    let sheet_id = sid(1);

    // Step 2: pre-merge A3:B3 (zero-based row=2, cols=0..=1).
    mirror.add_merge_region(
        &sheet_id,
        MergeRegion {
            start_row: 2,
            start_col: 0,
            end_row: 2,
            end_col: 1,
        },
    );

    // Step 3: sanity-check.
    let merges = mirror.get_merge_regions(&sheet_id);
    assert_eq!(merges.len(), 1, "merge region should be registered");
    assert_eq!(merges[0].start_row, 2);
    assert_eq!(merges[0].start_col, 0);
    assert_eq!(merges[0].end_row, 2);
    assert_eq!(merges[0].end_col, 1);

    // Step 4: set A1 = SEQUENCE(5). Natural spill target is A1:A5.
    let a1_id = cid(0xa1);
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .expect("set_cell A1 = SEQUENCE(5) failed");

    // Step 5: A1 must be #SPILL! because A3 sits inside the merge.
    let a1_val = core
        .get_cell_value(&mirror, &a1_id)
        .expect("A1 should be present in mirror after set_cell");
    assert_eq!(
        *a1_val,
        CellValue::Error(CellError::Spill, None),
        "A1 should evaluate to #SPILL! when SEQUENCE(5) target overlaps merged A3:B3, \
         got {:?}. Bug: ProjectionRegistry::check_conflict ignores mirror.merge_regions.",
        a1_val
    );

    // Step 6: A2 must be Null — the spill must not have been written at all.
    // We read column 0's dense slice; index 1 corresponds to A2.
    let sheet_mirror = mirror
        .get_sheet(&sheet_id)
        .expect("Sheet1 should exist in mirror");
    if let Some(col_a) = sheet_mirror.get_column_slice(0) {
        // It's fine for the column to be too short to address row 1 — that
        // also means "A2 was not written". Treat that as Null.
        let a2_val = col_a.get(1).cloned().unwrap_or(CellValue::Null);
        assert_eq!(
            a2_val,
            CellValue::Null,
            "A2 should be blank (Null) when the SEQUENCE spill is blocked, \
             got {:?}. A non-Null A2 means the engine emitted #SPILL! but still \
             wrote the projection — fix is incomplete.",
            a2_val
        );
    }

    // ---------------------------------------------------------------------
    // Step 7: baseline contrast. Remove the merge and re-spill — the same
    // formula must now succeed end-to-end. Proves the test isn't broken
    // structurally; the merge is genuinely the lone blocker.
    // ---------------------------------------------------------------------
    mirror.remove_merge_region(&sheet_id, 2, 0, 2, 1);
    assert!(
        mirror.get_merge_regions(&sheet_id).is_empty(),
        "merge should be removed before baseline re-spill"
    );

    // Re-set the formula (same anchor cell id) to retrigger spill evaluation
    // now that the blocker is gone.
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .expect("set_cell A1 = SEQUENCE(5) (post-unmerge) failed");

    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    assert_eq!(
        *a1_val,
        CellValue::number(1.0),
        "after unmerge, A1 should be 1 (top-left of SEQUENCE(5))"
    );

    let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
    let col_a = sheet_mirror
        .get_column_slice(0)
        .expect("col A should exist after successful spill");
    for row in 0..5u32 {
        assert_eq!(
            col_a[row as usize],
            CellValue::number((row + 1) as f64),
            "after unmerge, A{} should be {} (baseline spill)",
            row + 1,
            row + 1
        );
    }
}
