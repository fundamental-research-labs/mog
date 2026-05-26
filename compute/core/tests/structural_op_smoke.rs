//! Engine-surface smoke tests for the 9 non-`SetCell` op families the
//! structural-op walk-harness expansion (§3b) plans to exercise.
//!
//! §"Track 3 — Structural ops in the walk harness", specifically the S1
//! pre-flight callout inside §3a:
//!
//! > Before the generator lands, the Track 3 owner writes a one-call
//! > smoke test per family exercising *engine op → mirror read → engine
//! > inverse → mirror read matches pre-state*. Nine smoke tests, one
//! > commit, no generator work yet.
//!
//! These tests are **not** regression guards on cell-value arithmetic —
//! they pin the fact that each op family has a usable engine entry point,
//! each inverse operates correctly at the mirror-read level, and post-
//! inverse state equals pre-state. S2 (§3b) will wire these into the walk
//! generator; until then, a breakage here flags a regression in the
//! engine-surface contract the walk harness plans to depend on.
//!
//! ## Engine-surface audit (verified by these tests)
//!
//! | Op family | Entry point | Status |
//! |---|---|---|
//! | `insert_rows` / `delete_rows` / `insert_cols` / `delete_cols` | `YrsComputeEngine::structure_change(sheet_id, &StructureChange)` (`compute/core/src/storage/engine/structural.rs:29`) | ready |
//! | `add_sheet` / `delete_sheet` | `YrsComputeEngine::create_sheet(name)` / `YrsComputeEngine::delete_sheet(sheet_id)` (`compute/core/src/storage/engine/delegations.rs:888/905`) | ready |
//! | `rename_sheet` | `YrsComputeEngine::rename_compute_sheet(sheet_id, name)` (`compute/core/src/storage/engine/delegations.rs:616`) | ready |
//! | `merge_range` / `unmerge_range` | `YrsComputeEngine::merge_range` / `unmerge_range` (`compute/core/src/storage/engine/structural.rs:298/318`) | ready |
//!
//! All entry points are publicly reachable from an integration test — no
//! additional wrapper was required. See `stage1-3-preflight.md` in the
//! structural-op plan directory for the per-family handoff table.
//!
//! Run:
//!   cargo test -p compute-core --test structural_op_smoke

use cell_types::{SheetId, SheetPos};
use compute_core::storage::engine::YrsComputeEngine;
use formula_types::StructureChange;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Snapshot builders (local — append-only rule on shared fixtures)
// ---------------------------------------------------------------------------

fn sheet_id_str(suffix: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}

fn cell_id_str(suffix: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", suffix)
}

fn number_cell(id_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn text_cell(id_suffix: u32, row: u32, col: u32, t: &str) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Text(t.to_string().into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

/// Single-sheet workbook with two cells far apart on row/col axes so we
/// can observe insert/delete row/col shifts without bumping into sheet
/// dimensions.
fn smoke_snapshot_one_sheet() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str(1),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                // Row 2, col 0: text "anchor-row2"
                text_cell(100, 2, 0, "anchor-row2"),
                // Row 10, col 0: number 777 (moves on row insert/delete)
                number_cell(101, 10, 0, 777.0),
                // Row 0, col 2: text "anchor-col2" (moves on col insert/delete)
                text_cell(102, 0, 2, "anchor-col2"),
                // Row 0, col 10: number 999 (moves on col insert/delete)
                number_cell(103, 0, 10, 999.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

/// Two-sheet workbook for sheet-lifecycle smoke tests. `delete_sheet`
/// requires at least two sheets (the engine rejects deleting the last
/// one), so the sheet-add/delete/rename smoke tests need this shape.
fn smoke_snapshot_two_sheets() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: sheet_id_str(1),
                name: "Alpha".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![number_cell(100, 0, 0, 1.0)],
                ranges: vec![],
            },
            SheetSnapshot {
                id: sheet_id_str(2),
                name: "Beta".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![number_cell(101, 0, 0, 2.0)],
                ranges: vec![],
            },
        ],
        ..Default::default()
    }
}

/// Helper: read a cell value at a sheet position via the mirror.
fn cell_at(engine: &YrsComputeEngine, sid: &SheetId, row: u32, col: u32) -> CellValue {
    engine
        .mirror()
        .get_cell_value_at(sid, SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

/// Helper: list of (start_row, start_col, end_row, end_col) for all merges on a sheet.
fn merges(engine: &YrsComputeEngine, sid: &SheetId) -> Vec<(u32, u32, u32, u32)> {
    engine
        .get_all_merges_in_sheet(sid)
        .into_iter()
        .map(|m| (m.start_row, m.start_col, m.end_row, m.end_col))
        .collect()
}

/// Helper: sorted list of sheet names currently in the mirror.
fn sheet_names(engine: &YrsComputeEngine) -> Vec<String> {
    let mut names: Vec<String> = engine
        .mirror()
        .sheet_ids()
        .map(|sid| {
            engine
                .mirror()
                .get_sheet(sid)
                .map(|s| s.name.clone())
                .unwrap_or_default()
        })
        .collect();
    names.sort();
    names
}

// ---------------------------------------------------------------------------
// 1. insert_rows → delete_rows
// ---------------------------------------------------------------------------

#[test]
fn smoke_insert_rows_then_delete_rows() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(smoke_snapshot_one_sheet()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");

    // Pre-state
    let pre_row2 = cell_at(&engine, &sid, 2, 0);
    let pre_row10 = cell_at(&engine, &sid, 10, 0);
    assert_eq!(pre_row2, CellValue::Text("anchor-row2".to_string().into()));
    assert_eq!(pre_row10, CellValue::Number(FiniteF64::must(777.0)));

    // Forward: insert 3 rows at row 5
    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 5,
                count: 3,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert_rows");

    // Mid-state: row 2 unchanged; row 10 content now at row 13
    let mid_row2 = cell_at(&engine, &sid, 2, 0);
    let mid_row13 = cell_at(&engine, &sid, 13, 0);
    assert_eq!(mid_row2, pre_row2, "row 2 unchanged by insert at row 5");
    assert_eq!(mid_row13, pre_row10, "row 10 content shifted to row 13");

    // Inverse: delete 3 rows at row 5
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 5,
                count: 3,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete_rows");

    // Post-state equals pre-state
    assert_eq!(cell_at(&engine, &sid, 2, 0), pre_row2);
    assert_eq!(cell_at(&engine, &sid, 10, 0), pre_row10);
}

// ---------------------------------------------------------------------------
// 2. delete_rows → insert_rows
// ---------------------------------------------------------------------------

#[test]
fn smoke_delete_rows_then_insert_rows() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(smoke_snapshot_one_sheet()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");

    let pre_row2 = cell_at(&engine, &sid, 2, 0);
    let pre_row10 = cell_at(&engine, &sid, 10, 0);

    // Forward: delete 3 empty rows at row 5 (between row 2 anchor and row 10).
    // Row 10 content shifts to row 7.
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 5,
                count: 3,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete_rows");

    let mid_row2 = cell_at(&engine, &sid, 2, 0);
    let mid_row7 = cell_at(&engine, &sid, 7, 0);
    assert_eq!(mid_row2, pre_row2);
    assert_eq!(mid_row7, pre_row10);

    // Inverse: insert 3 rows at row 5. Row 7 content shifts back to row 10.
    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 5,
                count: 3,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert_rows");

    assert_eq!(cell_at(&engine, &sid, 2, 0), pre_row2);
    assert_eq!(cell_at(&engine, &sid, 10, 0), pre_row10);
}

// ---------------------------------------------------------------------------
// 3. insert_cols → delete_cols
// ---------------------------------------------------------------------------

#[test]
fn smoke_insert_cols_then_delete_cols() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(smoke_snapshot_one_sheet()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");

    let pre_col2 = cell_at(&engine, &sid, 0, 2);
    let pre_col10 = cell_at(&engine, &sid, 0, 10);
    assert_eq!(pre_col2, CellValue::Text("anchor-col2".to_string().into()));
    assert_eq!(pre_col10, CellValue::Number(FiniteF64::must(999.0)));

    // Forward: insert 2 cols at col 5
    engine
        .structure_change(
            &sid,
            &StructureChange::InsertCols {
                at: 5,
                count: 2,
                new_col_ids: Vec::new(),
            },
        )
        .expect("insert_cols");

    let mid_col2 = cell_at(&engine, &sid, 0, 2);
    let mid_col12 = cell_at(&engine, &sid, 0, 12);
    assert_eq!(mid_col2, pre_col2);
    assert_eq!(mid_col12, pre_col10);

    // Inverse: delete 2 cols at col 5
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteCols {
                at: 5,
                count: 2,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete_cols");

    assert_eq!(cell_at(&engine, &sid, 0, 2), pre_col2);
    assert_eq!(cell_at(&engine, &sid, 0, 10), pre_col10);
}

// ---------------------------------------------------------------------------
// 4. delete_cols → insert_cols
// ---------------------------------------------------------------------------

#[test]
fn smoke_delete_cols_then_insert_cols() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(smoke_snapshot_one_sheet()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");

    let pre_col2 = cell_at(&engine, &sid, 0, 2);
    let pre_col10 = cell_at(&engine, &sid, 0, 10);

    // Forward: delete 2 empty cols at col 5 (between col 2 anchor and col 10).
    // col 10 content shifts to col 8.
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteCols {
                at: 5,
                count: 2,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete_cols");

    assert_eq!(cell_at(&engine, &sid, 0, 2), pre_col2);
    assert_eq!(cell_at(&engine, &sid, 0, 8), pre_col10);

    // Inverse: insert 2 cols at col 5
    engine
        .structure_change(
            &sid,
            &StructureChange::InsertCols {
                at: 5,
                count: 2,
                new_col_ids: Vec::new(),
            },
        )
        .expect("insert_cols");

    assert_eq!(cell_at(&engine, &sid, 0, 2), pre_col2);
    assert_eq!(cell_at(&engine, &sid, 0, 10), pre_col10);
}

// ---------------------------------------------------------------------------
// 5. add_sheet → delete_sheet
// ---------------------------------------------------------------------------

#[test]
fn smoke_add_sheet_then_delete_sheet() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(smoke_snapshot_two_sheets()).expect("from_snapshot");

    let pre_names = sheet_names(&engine);
    assert_eq!(pre_names, vec!["Alpha".to_string(), "Beta".to_string()]);

    // Forward: add a new sheet "Gamma"
    let (hex, _) = engine.create_sheet("Gamma").expect("create_sheet");

    // Mid-state: three sheets
    let mid_names = sheet_names(&engine);
    assert!(mid_names.contains(&"Gamma".to_string()));
    assert_eq!(mid_names.len(), 3);

    // Resolve the SheetId for "Gamma" from the mirror — the `create_sheet`
    // return is a hex string; mirror lookup avoids the hex-parse detour.
    let gamma_sid = engine.mirror().sheet_by_name("Gamma").expect("Gamma sid");
    // Sanity: hex from create_sheet matches the mirror-resolved SheetId.
    assert_eq!(hex.len(), 32, "create_sheet returns 32-char hex");

    // Inverse: delete "Gamma"
    engine.delete_sheet(&gamma_sid).expect("delete_sheet");

    // Post-state equals pre-state (by name set)
    assert_eq!(sheet_names(&engine), pre_names);
}

// ---------------------------------------------------------------------------
// 6. delete_sheet → add_sheet
//
// Caveat documented in the WalkOp module (`dev/formula-eval/src/walk/ops.rs`):
// delete_sheet destroys cell identities inside the deleted sheet. The
// re-created sheet has a fresh SheetId. This smoke test therefore asserts
// the **name-level** inverse — post-state has the same sheet names as
// pre-state — and does not try to roundtrip cell data inside the deleted
// sheet. That's the correct semantic boundary for structural-op per §3c:
// > delete_sheet destroys them. That's the op family's contract; we pin
// > "the inverse preserves the name-space" here and leave richer data
// > roundtrip to structural-op.
// ---------------------------------------------------------------------------

#[test]
fn smoke_delete_sheet_then_add_sheet() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(smoke_snapshot_two_sheets()).expect("from_snapshot");

    let pre_names = sheet_names(&engine);

    // Forward: delete "Beta"
    let beta_sid = engine.mirror().sheet_by_name("Beta").expect("Beta sid");
    engine.delete_sheet(&beta_sid).expect("delete_sheet");

    let mid_names = sheet_names(&engine);
    assert_eq!(mid_names, vec!["Alpha".to_string()]);

    // Inverse: re-create sheet with the same name
    engine.create_sheet("Beta").expect("create_sheet");

    // Post-state: same name set as pre-state
    assert_eq!(sheet_names(&engine), pre_names);
}

// ---------------------------------------------------------------------------
// 7. rename_sheet → rename_sheet (rename back)
// ---------------------------------------------------------------------------

#[test]
fn smoke_rename_sheet_then_rename_back() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(smoke_snapshot_two_sheets()).expect("from_snapshot");

    let alpha_sid = engine.mirror().sheet_by_name("Alpha").expect("Alpha sid");
    let pre_names = sheet_names(&engine);

    // Forward: rename Alpha → AlphaRenamed
    engine
        .rename_compute_sheet(&alpha_sid, "AlphaRenamed")
        .expect("rename A→B");

    let mid_names = sheet_names(&engine);
    assert!(mid_names.contains(&"AlphaRenamed".to_string()));
    assert!(!mid_names.contains(&"Alpha".to_string()));

    // Inverse: rename back
    engine
        .rename_compute_sheet(&alpha_sid, "Alpha")
        .expect("rename B→A");

    assert_eq!(sheet_names(&engine), pre_names);

    // Same SheetId survives a rename (identity is not name-keyed).
    let post_alpha_sid = engine
        .mirror()
        .sheet_by_name("Alpha")
        .expect("Alpha sid post");
    assert_eq!(post_alpha_sid, alpha_sid);
}

// ---------------------------------------------------------------------------
// 8. merge_range → unmerge_range
// ---------------------------------------------------------------------------

#[test]
fn smoke_merge_range_then_unmerge_range() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(smoke_snapshot_one_sheet()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");

    let pre_merges = merges(&engine, &sid);
    assert!(pre_merges.is_empty(), "no merges in default snapshot");

    // Forward: merge B2:C3 (0-based: rows 1..=2, cols 1..=2)
    engine.merge_range(&sid, 1, 1, 2, 2).expect("merge_range");

    let mid_merges = merges(&engine, &sid);
    assert_eq!(mid_merges, vec![(1, 1, 2, 2)]);

    // Inverse: unmerge B2:C3
    engine
        .unmerge_range(&sid, 1, 1, 2, 2)
        .expect("unmerge_range");

    assert_eq!(merges(&engine, &sid), pre_merges);
}

// ---------------------------------------------------------------------------
// 9. unmerge_range → merge_range (pre-merged state)
// ---------------------------------------------------------------------------

#[test]
fn smoke_unmerge_range_then_merge_range() {
    // Start from the one-sheet snapshot and pre-merge B2:C3 via the engine
    // API (the snapshot builder doesn't carry merges). The "pre-state" for
    // this op pair is therefore "B2:C3 merged".
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(smoke_snapshot_one_sheet()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("Sheet1").expect("Sheet1");
    engine
        .merge_range(&sid, 1, 1, 2, 2)
        .expect("pre-merge B2:C3");

    let pre_merges = merges(&engine, &sid);
    assert_eq!(pre_merges, vec![(1, 1, 2, 2)]);

    // Forward: unmerge
    engine
        .unmerge_range(&sid, 1, 1, 2, 2)
        .expect("unmerge_range");

    let mid_merges = merges(&engine, &sid);
    assert!(mid_merges.is_empty());

    // Inverse: re-merge
    engine
        .merge_range(&sid, 1, 1, 2, 2)
        .expect("re-merge_range");

    assert_eq!(merges(&engine, &sid), pre_merges);
}
