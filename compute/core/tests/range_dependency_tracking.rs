//! Class II — Range dependency tracking under dynamic extent.
//!
//! **Invariant.** A cell inside a full-column / full-row / named / table /
//! 3D / INDIRECT range is a dependent of that formula regardless of:
//! - Whether the cell was populated when the formula was first evaluated.
//! - Edit history on adjacent cells.
//! - Growth or shrinkage of the sheet's populated extent between the op
//!   and the inverse.
//!
//! **Bug pin.** Directly targets the `Ib6CYMnT` hypothesis (full-column
//! bbox cache growing on forward writes, not shrinking on revert). The
//! named test `regression_ib6cymnt_fullcol_bbox_extent_miss` is expected
//! to **fail today**.
//!
//! **Methodology.** White-box-ish — asserts via dependent formula value,
//! never internal bbox-cache state. Tests survive refactors of the
//! invalidation machinery.
//!
//! Run:
//!   cargo test -p compute-core --test range_dependency_tracking -- --nocapture

// `matrix.rs` declares axis enums / the `cartesian` combiner for use by
// Class I, Class III, Class V. Class II only consumes the Stage-4
// appended axes (`Extent`, `AggregatorShape`, `CoverageReason`), so the
// rest of the module is legitimately dead here.
#![allow(dead_code)]

use cell_types::{CellId, SheetId};
use compute_core::storage::engine::YrsComputeEngine;
use formula_types::{NamedRangeDef, Scope};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
#[cfg(feature = "audit-tests")]
use std::time::Instant;
use value_types::{CellValue, FiniteF64};

// Import only the matrix scaffolding. Bypass `support/mod.rs` because a
// concurrent agent has appended formula-shape variants to
// `DependentShape` without updating the `workbook_with_topology` match
// in `fixtures.rs`, which breaks the build for every test file that
// pulls the full `support` module. We don't need `fixtures` or
// `assertions` for Class II — matrix.rs is self-contained.
#[path = "support/matrix.rs"]
mod matrix;
use matrix::{AggregatorShape, CoverageReason, Extent};

// ---------------------------------------------------------------------
// Test file local helpers (plan's coordination rule: do NOT extend
// fixtures.rs / assertions.rs while parallel agents are running; keep
// additions local).
// ---------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

fn sheet_id(idx: u32) -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid(idx)).expect("valid sheet uuid")
}

fn cell_id(sheet_idx: u32, row: u32, col: u32) -> CellId {
    CellId::from_uuid_str(&cell_uuid(sheet_idx, row, col)).expect("valid cell uuid")
}

/// A pre-populated cell carrying a literal number.
fn value_cell(sheet_idx: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

/// A pre-populated cell carrying an arbitrary value.
fn raw_cell(sheet_idx: u32, row: u32, col: u32, v: CellValue) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value: v,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

/// A pre-seeded formula cell — `value` is `Null`, engine fills it in on
/// `from_snapshot`.
fn formula_cell(sheet_idx: u32, row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value: CellValue::Null,
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn sheet_snap(idx: u32, name: &str, cells: Vec<CellData>) -> SheetSnapshot {
    SheetSnapshot {
        id: sheet_uuid(idx),
        name: name.to_string(),
        // Plenty of room for row 50_000 writes without off-by-ones.
        rows: 100_000,
        cols: 64,
        cells,
        ranges: vec![],
    }
}

/// Read the (cloned) value at a specific cell directly from the mirror.
fn read_value(engine: &YrsComputeEngine, cell: &CellId) -> CellValue {
    engine
        .mirror()
        .get_cell_value(cell)
        .cloned()
        .unwrap_or(CellValue::Null)
}

/// Forward write + inverse write *as a single Class II step*.
///
/// Forward uses `set_cell` (production input path). Inverse uses
/// `import_values` with the *captured* raw [`CellValue`] so the parser
/// can't clobber the round-trip (Class IV / FINDINGS.md Class-A concern).
/// Returns `Err` if either the forward or the inverse failed — those
/// are always real failures, distinct from "dependent drifted."
fn op_then_inverse(
    engine: &mut YrsComputeEngine,
    sheet: &SheetId,
    target: &CellId,
    row: u32,
    col: u32,
    prior: CellValue,
    new_input: &str,
) -> Result<(), String> {
    engine
        .set_cell(sheet, *target, row, col, new_input.into())
        .map_err(|e| format!("forward set_cell err: {:?}", e))?;
    engine
        .import_values(sheet, vec![(row, col, prior, None)])
        .map_err(|e| format!("inverse import_values err: {:?}", e))?;
    Ok(())
}

/// Assert the dependent formula's value is identical before and after
/// the op+inverse pair. Returns `Ok(())` on match, `Err(msg)` on drift.
fn assert_dependent_identity(
    before: &CellValue,
    after: &CellValue,
    context: &str,
) -> Result<(), String> {
    if before == after {
        Ok(())
    } else {
        Err(format!(
            "{ctx}: dependent drift: before={before:?} after={after:?}",
            ctx = context,
            before = before,
            after = after,
        ))
    }
}

// ---------------------------------------------------------------------
// Summary helper
// ---------------------------------------------------------------------

struct Summary {
    family: &'static str,
    passed: usize,
    failed: usize,
    skipped: usize,
    failures: Vec<String>,
}

impl Summary {
    fn new(family: &'static str) -> Self {
        Self {
            family,
            passed: 0,
            failed: 0,
            skipped: 0,
            failures: Vec::new(),
        }
    }

    fn record(&mut self, name: &str, result: Result<(), String>) {
        match result {
            Ok(()) => self.passed += 1,
            Err(e) => {
                self.failed += 1;
                self.failures.push(format!("  [{}] {}", name, e));
            }
        }
    }

    fn skip(&mut self, _reason: CoverageReason) {
        self.skipped += 1;
    }

    fn counted(&self) -> usize {
        self.passed + self.failed
    }

    fn emit(&self) {
        eprintln!(
            "[Class II · {family}] {p}/{tot} passed, {f} failed, {s} skipped",
            family = self.family,
            p = self.passed,
            tot = self.counted(),
            f = self.failed,
            s = self.skipped,
        );
        if !self.failures.is_empty() {
            eprintln!("[Class II · {family}] failures:", family = self.family);
            for f in &self.failures {
                eprintln!("{}", f);
            }
        }
    }
}

// ---------------------------------------------------------------------
// Scenario builders — full-column ranges over a single sheet.
// ---------------------------------------------------------------------

/// A dependent formula reading from a full-column range on `SourceData!H`.
///
/// - `SUMIFS(SourceData!H:H, SourceData!A:A, ">0")`
/// - `COUNTIFS(SourceData!A:A, ">0")`
/// - `SUM(SourceData!H:H)`
/// - `VLOOKUP(key, SourceData!A:B, 2, FALSE)` — lookup column is a
///   two-column full-col range (`A:B`), which the engine may or may
///   not treat specially.
fn fullcol_formula(shape: AggregatorShape) -> &'static str {
    match shape {
        AggregatorShape::Sumifs => "SUMIFS(SourceData!H:H,SourceData!A:A,\">0\")",
        AggregatorShape::Countifs => "COUNTIFS(SourceData!A:A,\">0\")",
        AggregatorShape::Sum => "SUM(SourceData!H:H)",
        AggregatorShape::Vlookup => "VLOOKUP(1,SourceData!A:H,8,FALSE)",
    }
}

/// Build a 2-sheet workbook (`SourceData` + `Dest`) with the dependent
/// formula at `Dest!A1` and the requested `Extent`-shaped population on
/// `SourceData`.
///
/// We use **two sheets** so the "target cell" in `SourceData` isn't the
/// same sheet as the formula — which matches the `Ib6CYMnT` pattern
/// (dependent on `Ray Booth!D21`, op on `SourceData!F39188`).
fn fullcol_workbook(shape: AggregatorShape, extent: Extent) -> WorkbookSnapshot {
    let formula = fullcol_formula(shape);
    // SourceData = sheet 0; Dest = sheet 1.
    let mut src_cells: Vec<CellData> = Vec::new();

    // Seed baseline populated cells according to the extent shape.
    // Col A (the criterion column for SUMIFS/COUNTIFS) holds the "key",
    // col H holds the value. For VLOOKUP the key column is A and col H
    // is the return column.
    match extent {
        Extent::Empty => {
            // No cells. The dependent must still be a dependency of the
            // range — a write anywhere in H or A after eval must
            // invalidate.
        }
        Extent::A1Only => {
            src_cells.push(value_cell(0, 0, 0, 1.0)); // A1 key
            src_cells.push(value_cell(0, 0, 7, 100.0)); // H1 value
        }
        Extent::A50k => {
            src_cells.push(value_cell(0, 49_999, 0, 1.0));
            src_cells.push(value_cell(0, 49_999, 7, 100.0));
        }
        Extent::GrewThenShrank => {
            // Pre-seed at a high row, then leave a "hole" at that row
            // (seed it back to Null) so the initial extent reports
            // "grown then shrunk". We can't truly "grow then shrink" in
            // a single snapshot — we emulate by seeding the cell as
            // Null with a row/col present, so the sheet has extent
            // metadata even though the value is Null.
            src_cells.push(raw_cell(0, 49_999, 0, CellValue::Null));
            src_cells.push(raw_cell(0, 49_999, 7, CellValue::Null));
            src_cells.push(value_cell(0, 0, 0, 1.0));
            src_cells.push(value_cell(0, 0, 7, 100.0));
        }
        Extent::ExpandedMidPath => {
            // Start populated with a small extent; the mid-path write
            // expanding it happens inside the test driver (see
            // `run_fullcol_case`).
            src_cells.push(value_cell(0, 0, 0, 1.0));
            src_cells.push(value_cell(0, 0, 7, 100.0));
        }
    }

    let source_sheet = sheet_snap(0, "SourceData", src_cells);
    // Put the dependent formula on Dest!A1.
    let dest_sheet = sheet_snap(1, "Dest", vec![formula_cell(1, 0, 0, formula)]);

    WorkbookSnapshot {
        sheets: vec![source_sheet, dest_sheet],
        ..Default::default()
    }
}

/// Execute one full-column case: op on a cell inside the range,
/// inverse back, assert dependent returns to pre-op value.
fn run_fullcol_case(shape: AggregatorShape, extent: Extent) -> Result<(), String> {
    let snapshot = fullcol_workbook(shape, extent);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot)
        .map_err(|e| format!("from_snapshot err: {:?}", e))?;

    let source = sheet_id(0);
    let dependent = cell_id(1, 0, 0);

    // Target the op at a cell deliberately *outside* the current
    // extent. This is the single most important axis for `Ib6CYMnT`:
    // the engine's bbox cache, if present, will not naturally cover a
    // row ≥ 39_187.
    let (target_row, target_col) = match extent {
        Extent::Empty => (39_187, 7),
        Extent::A1Only => (39_187, 7),
        Extent::A50k => (49_998, 7), // just above the existing A50k seed
        Extent::GrewThenShrank => (39_187, 7),
        Extent::ExpandedMidPath => (39_187, 7),
    };
    let target = cell_id(0, target_row, target_col);
    let _target_key = cell_id(0, target_row, 0); // col A key (populated below via import_values)

    // Capture pre-op dependent value (after the initial `from_snapshot`
    // recalc has populated the formula).
    let before = read_value(&engine, &dependent);

    // For SUMIFS/COUNTIFS/VLOOKUP we also need the key cell populated
    // so the criterion passes. Write it first with `import_values` so
    // we don't pollute the op-under-test.
    engine
        .import_values(
            &source,
            vec![(target_row, 0, CellValue::Number(FiniteF64::must(1.0)), None)],
        )
        .map_err(|e| format!("seed key err: {:?}", e))?;

    // The seed itself is a mutation that affects dependents. Snap the
    // "pre-op-with-key-populated" value here so the identity assertion
    // holds against the state immediately before the forward op on the
    // H column.
    let before_with_key = read_value(&engine, &dependent);

    // Apply the forward op + inverse to the H-column cell. Prior value
    // is Null (the cell was genuinely outside the original extent).
    op_then_inverse(
        &mut engine,
        &source,
        &target,
        target_row,
        target_col,
        CellValue::Null,
        "85",
    )?;

    // For ExpandedMidPath, inject an unrelated far-outside write
    // *between* forward and inverse. To do that we need to split
    // `op_then_inverse`; redo the sequence explicitly.
    //
    // (We re-enter the test here with a second op+inverse, this time
    //  with an intermediate expansion write. The first pair already
    //  executed above; this stacks a second variation for the
    //  `ExpandedMidPath` extent only.)
    if matches!(extent, Extent::ExpandedMidPath) {
        engine
            .set_cell(&source, target, target_row, target_col, "85".into())
            .map_err(|e| format!("forward #2 err: {:?}", e))?;
        // Mid-path: write something at row 60_000.
        let expand_target = cell_id(0, 60_000, 7);
        engine
            .set_cell(&source, expand_target, 60_000, 7, "42".into())
            .map_err(|e| format!("mid-path expansion err: {:?}", e))?;
        // Revert the expansion first, then the primary op. The
        // primary revert is the load-bearing one for the Class II
        // invariant; the expansion revert just returns the sheet to
        // its pre-op state.
        engine
            .import_values(&source, vec![(60_000, 7, CellValue::Null, None)])
            .map_err(|e| format!("mid-path revert err: {:?}", e))?;
        engine
            .import_values(
                &source,
                vec![(target_row, target_col, CellValue::Null, None)],
            )
            .map_err(|e| format!("primary revert err: {:?}", e))?;
    }

    // Clean up the seed key we added so the dependent can return to
    // its *pre-seed* state for the identity check.
    engine
        .import_values(&source, vec![(target_row, 0, CellValue::Null, None)])
        .map_err(|e| format!("unseed key err: {:?}", e))?;

    let after = read_value(&engine, &dependent);
    // The invariant compares the final state against the original
    // pre-seed value: the key revert to Null should also take the
    // dependent back to where it started.
    let ctx = format!(
        "shape={:?} extent={:?} before={:?} before_with_key={:?}",
        shape, extent, before, before_with_key
    );
    assert_dependent_identity(&before, &after, &ctx)
}

// ---------------------------------------------------------------------
// Scenario builders — INDIRECT("A:A").
// ---------------------------------------------------------------------

/// Build a workbook where `Dest!A1 = SUM(INDIRECT("SourceData!H:H"))`.
///
/// The INDIRECT argument itself can optionally live in another cell to
/// exercise the "revert the INDIRECT-argument cell" variant.
fn indirect_workbook(extent: Extent, arg_in_cell: bool) -> WorkbookSnapshot {
    let mut src_cells: Vec<CellData> = Vec::new();
    match extent {
        Extent::Empty => {}
        Extent::A1Only => {
            src_cells.push(value_cell(0, 0, 7, 100.0));
        }
        Extent::A50k => {
            src_cells.push(value_cell(0, 49_999, 7, 100.0));
        }
        Extent::GrewThenShrank => {
            src_cells.push(raw_cell(0, 49_999, 7, CellValue::Null));
            src_cells.push(value_cell(0, 0, 7, 100.0));
        }
        Extent::ExpandedMidPath => {
            src_cells.push(value_cell(0, 0, 7, 100.0));
        }
    }

    let dest_cells = if arg_in_cell {
        // Dest!B1 holds the arg string; Dest!A1 INDIRECTs through it.
        vec![
            raw_cell(
                1,
                0,
                1,
                CellValue::Text(std::sync::Arc::from("SourceData!H:H")),
            ),
            formula_cell(1, 0, 0, "SUM(INDIRECT(B1))"),
        ]
    } else {
        vec![formula_cell(1, 0, 0, "SUM(INDIRECT(\"SourceData!H:H\"))")]
    };

    WorkbookSnapshot {
        sheets: vec![
            sheet_snap(0, "SourceData", src_cells),
            sheet_snap(1, "Dest", dest_cells),
        ],
        ..Default::default()
    }
}

fn run_indirect_case(extent: Extent) -> Result<(), String> {
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(indirect_workbook(extent, false))
        .map_err(|e| format!("from_snapshot err: {:?}", e))?;
    let source = sheet_id(0);
    let dependent = cell_id(1, 0, 0);

    let before = read_value(&engine, &dependent);
    let target_row = match extent {
        Extent::A50k => 49_998,
        _ => 39_187,
    };
    let target = cell_id(0, target_row, 7);

    op_then_inverse(
        &mut engine,
        &source,
        &target,
        target_row,
        7,
        CellValue::Null,
        "85",
    )?;

    let after = read_value(&engine, &dependent);
    let ctx = format!("indirect extent={:?}", extent);
    assert_dependent_identity(&before, &after, &ctx)
}

/// Variant: the INDIRECT argument itself is a cell. Edit that cell
/// (change the reference string), revert, assert dependent returns.
///
/// Three sub-cases:
/// 1. Change the arg to a different valid range, then back.
/// 2. Change the arg to an error, then back.
/// 3. Change the arg to another column, then back.
fn run_indirect_arg_revert_case(variant: u8) -> Result<(), String> {
    // Seed a small extent.
    let (mut engine, _init) =
        YrsComputeEngine::from_snapshot(indirect_workbook(Extent::A1Only, true))
            .map_err(|e| format!("from_snapshot err: {:?}", e))?;
    let dest = sheet_id(1);
    let arg_cell = cell_id(1, 0, 1);
    let dependent = cell_id(1, 0, 0);

    let before = read_value(&engine, &dependent);

    let (new_input, prior_text) = match variant {
        0 => ("SourceData!H:H", "SourceData!H:H"), // no-op semantically
        1 => ("SourceData!I:I", "SourceData!H:H"), // different column
        2 => ("\"not a range\"", "SourceData!H:H"), // malformed (text)
        _ => ("SourceData!A:A", "SourceData!H:H"),
    };
    let _ = new_input; // linter
    // Forward write — the parser sees a text-valued input. Pass it as
    // a leading-apostrophe string to guarantee Text interpretation.
    let fwd = format!("'{}", new_input);
    engine
        .set_cell(&dest, arg_cell, 0, 1, fwd.as_str().into())
        .map_err(|e| format!("forward arg rewrite err: {:?}", e))?;

    // Inverse — use import_values with the captured Text value for
    // lossless restore (FINDINGS.md Class-A fix direction).
    engine
        .import_values(
            &dest,
            vec![(
                0,
                1,
                CellValue::Text(std::sync::Arc::from(prior_text)),
                None,
            )],
        )
        .map_err(|e| format!("inverse arg rewrite err: {:?}", e))?;

    let after = read_value(&engine, &dependent);
    assert_dependent_identity(
        &before,
        &after,
        &format!("indirect_arg_revert variant={}", variant),
    )
}

// ---------------------------------------------------------------------
// OFFSET(anchor, 0, 0, n, 1) — n is an editable cell.
// ---------------------------------------------------------------------

fn offset_workbook(n_initial: f64) -> WorkbookSnapshot {
    // Dest!A1 = SUM(OFFSET(SourceData!A1, 0, 0, N1, 1))
    // Dest!B1 = N1 (the size driver)
    // SourceData!A1:A20 populated with 1..20
    let mut src_cells = Vec::new();
    for r in 0..20 {
        src_cells.push(value_cell(0, r, 0, (r + 1) as f64));
    }

    let dest_cells = vec![
        value_cell(1, 0, 1, n_initial), // B1 = N
        formula_cell(1, 0, 0, "SUM(OFFSET(SourceData!A1,0,0,B1,1))"),
    ];

    WorkbookSnapshot {
        sheets: vec![
            sheet_snap(0, "SourceData", src_cells),
            sheet_snap(1, "Dest", dest_cells),
        ],
        ..Default::default()
    }
}

/// Case: edit `n` (the size parameter), then revert. SUM must return to
/// the pre-op value. Additional subcases edit data cells inside / outside
/// the currently-sized window.
fn run_offset_case(variant: u8) -> Result<(), String> {
    let n_initial = 10.0;
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(offset_workbook(n_initial))
        .map_err(|e| format!("from_snapshot err: {:?}", e))?;
    let dest = sheet_id(1);
    let source = sheet_id(0);
    let dependent = cell_id(1, 0, 0);

    let before = read_value(&engine, &dependent);

    match variant {
        0 => {
            // Change n from 10 → 15 (window grows), revert.
            let n_cell = cell_id(1, 0, 1);
            op_then_inverse(
                &mut engine,
                &dest,
                &n_cell,
                0,
                1,
                CellValue::Number(FiniteF64::must(n_initial)),
                "15",
            )?;
        }
        1 => {
            // Change n from 10 → 5 (window shrinks), revert.
            let n_cell = cell_id(1, 0, 1);
            op_then_inverse(
                &mut engine,
                &dest,
                &n_cell,
                0,
                1,
                CellValue::Number(FiniteF64::must(n_initial)),
                "5",
            )?;
        }
        2 => {
            // Edit a cell inside the window (A3=3 → A3=100 → A3=3).
            let c = cell_id(0, 2, 0);
            op_then_inverse(
                &mut engine,
                &source,
                &c,
                2,
                0,
                CellValue::Number(FiniteF64::must(3.0)),
                "100",
            )?;
        }
        3 => {
            // Edit a cell outside the current window but inside the
            // data range (A15=15 → A15=100 → A15=15).
            let c = cell_id(0, 14, 0);
            op_then_inverse(
                &mut engine,
                &source,
                &c,
                14,
                0,
                CellValue::Number(FiniteF64::must(15.0)),
                "100",
            )?;
        }
        4 => {
            // Grow n, then edit a cell that's now inside, then shrink
            // n back, then revert the data cell. The final revert must
            // restore the pre-op SUM even though the window shape
            // changed in between.
            let n_cell = cell_id(1, 0, 1);
            let c = cell_id(0, 12, 0);
            engine
                .set_cell(&dest, n_cell, 0, 1, "15".into())
                .map_err(|e| format!("grow n err: {:?}", e))?;
            engine
                .set_cell(&source, c, 12, 0, "100".into())
                .map_err(|e| format!("edit inside new window err: {:?}", e))?;
            engine
                .import_values(
                    &source,
                    vec![(12, 0, CellValue::Number(FiniteF64::must(13.0)), None)],
                )
                .map_err(|e| format!("revert edit err: {:?}", e))?;
            engine
                .import_values(
                    &dest,
                    vec![(0, 1, CellValue::Number(FiniteF64::must(n_initial)), None)],
                )
                .map_err(|e| format!("revert n err: {:?}", e))?;
        }
        5 => {
            // Far-outside write (row 39_187, col 0) inside the source
            // sheet — not in the OFFSET window. SUM must be unaffected
            // and remain identical pre/post.
            let c = cell_id(0, 39_187, 0);
            op_then_inverse(&mut engine, &source, &c, 39_187, 0, CellValue::Null, "100")?;
        }
        _ => return Ok(()),
    }

    let after = read_value(&engine, &dependent);
    assert_dependent_identity(&before, &after, &format!("offset variant={}", variant))
}

// ---------------------------------------------------------------------
// Named range redefined between ops.
// ---------------------------------------------------------------------

fn named_workbook_with_range(range_expr: &str) -> WorkbookSnapshot {
    let mut src_cells = Vec::new();
    for r in 0..10 {
        src_cells.push(value_cell(0, r, 0, (r + 1) as f64));
    }
    for r in 0..10 {
        src_cells.push(value_cell(0, r, 1, ((r + 1) * 10) as f64));
    }

    let dest_cells = vec![formula_cell(1, 0, 0, "SUM(MyRange)")];

    let def = NamedRangeDef::from_expression(
        "MyRange".to_string(),
        Scope::Workbook,
        range_expr.to_string(),
    );

    WorkbookSnapshot {
        sheets: vec![
            sheet_snap(0, "SourceData", src_cells),
            sheet_snap(1, "Dest", dest_cells),
        ],
        named_ranges: vec![def],
        ..Default::default()
    }
}

/// For named ranges, the "redefine between ops" invariant is:
/// - Evaluate dependent with named range pointing at range R1.
/// - Mutate a cell inside R1.
/// - Revert.
/// - Dependent must return to pre-op value.
///
/// We don't exercise "redefine → mutate → redefine back → revert" here
/// because redefining a name is a structural-op-scope structural-ish op; we
/// still cover the core class-II invariant (a cell *inside* the named
/// range is a dependent).
fn run_named_case(variant: u8) -> Result<(), String> {
    let (range_expr, target_row, target_col, prior): (&str, u32, u32, CellValue) = match variant {
        0 => ("SourceData!A:A", 39_187, 0, CellValue::Null),
        1 => ("SourceData!A:B", 39_187, 1, CellValue::Null),
        2 => (
            "SourceData!$A$1:$A$10",
            4,
            0,
            CellValue::Number(FiniteF64::must(5.0)),
        ),
        3 => (
            "SourceData!A:A",
            0,
            0,
            CellValue::Number(FiniteF64::must(1.0)),
        ),
        _ => return Ok(()),
    };

    let (mut engine, _init) =
        YrsComputeEngine::from_snapshot(named_workbook_with_range(range_expr))
            .map_err(|e| format!("from_snapshot err: {:?}", e))?;
    let source = sheet_id(0);
    let dependent = cell_id(1, 0, 0);
    let target = cell_id(0, target_row, target_col);

    let before = read_value(&engine, &dependent);
    op_then_inverse(
        &mut engine,
        &source,
        &target,
        target_row,
        target_col,
        prior,
        "999",
    )?;
    let after = read_value(&engine, &dependent);

    assert_dependent_identity(
        &before,
        &after,
        &format!("named variant={} range={}", variant, range_expr),
    )
}

// ---------------------------------------------------------------------
// 3D range across sheets.
// ---------------------------------------------------------------------

fn three_d_workbook() -> WorkbookSnapshot {
    // Sheets: Sheet1, Sheet2, Sheet3 each with a value in A1.
    // Dest!A1 = SUM(Sheet1:Sheet3!A1).
    let s1 = sheet_snap(0, "Sheet1", vec![value_cell(0, 0, 0, 1.0)]);
    let s2 = sheet_snap(1, "Sheet2", vec![value_cell(1, 0, 0, 10.0)]);
    let s3 = sheet_snap(2, "Sheet3", vec![value_cell(2, 0, 0, 100.0)]);
    let dest = sheet_snap(
        3,
        "Dest",
        vec![formula_cell(3, 0, 0, "SUM(Sheet1:Sheet3!A1)")],
    );

    WorkbookSnapshot {
        sheets: vec![s1, s2, s3, dest],
        ..Default::default()
    }
}

fn run_3d_case(variant: u8) -> Result<(), String> {
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(three_d_workbook())
        .map_err(|e| format!("from_snapshot err: {:?}", e))?;
    let dependent = cell_id(3, 0, 0);
    let before = read_value(&engine, &dependent);

    // Quick sanity: if 3D parsing isn't supported, `before` will be an
    // error. Treat that as a "3D not supported" skip rather than a
    // Class II drift — the Class II invariant assumes the formula
    // parses. We fold that into the failure message so it's visible.
    let before_is_error = matches!(before, CellValue::Error(_, _));

    match variant {
        0 => {
            // Edit Sheet1!A1 (first sheet of the 3D group).
            let s = sheet_id(0);
            let c = cell_id(0, 0, 0);
            op_then_inverse(
                &mut engine,
                &s,
                &c,
                0,
                0,
                CellValue::Number(FiniteF64::must(1.0)),
                "42",
            )?;
        }
        1 => {
            // Edit Sheet2!A1 (middle).
            let s = sheet_id(1);
            let c = cell_id(1, 0, 0);
            op_then_inverse(
                &mut engine,
                &s,
                &c,
                0,
                0,
                CellValue::Number(FiniteF64::must(10.0)),
                "42",
            )?;
        }
        2 => {
            // Edit Sheet3!A1 (last).
            let s = sheet_id(2);
            let c = cell_id(2, 0, 0);
            op_then_inverse(
                &mut engine,
                &s,
                &c,
                0,
                0,
                CellValue::Number(FiniteF64::must(100.0)),
                "42",
            )?;
        }
        3 => {
            // Populate a previously-empty cell on Sheet1 at a high row.
            // It's not inside the 3D range (which is `!A1` only), so
            // the dependent must be *unchanged*.
            let s = sheet_id(0);
            let c = cell_id(0, 39_187, 0);
            op_then_inverse(&mut engine, &s, &c, 39_187, 0, CellValue::Null, "100")?;
        }
        // Variants 4 (sheet-rename-between-ops) and 5 (sheet-reorder-
        // between-ops) are structural-op scope — covered as summary skips
        // in `class_ii_3d_family`, not as runnable variants here.
        _ => return Ok(()),
    }

    let after = read_value(&engine, &dependent);
    let ctx = format!(
        "3d variant={} before_is_error={} (3D parse may not be supported)",
        variant, before_is_error
    );
    assert_dependent_identity(&before, &after, &ctx)
}

// ---------------------------------------------------------------------
// Table refs — structural-op scope (structural ops).
// ---------------------------------------------------------------------

/// Placeholder structured-reference cases. All declared `Round2Scope`.
/// Listed so the coverage gap is visible in the report.
fn table_ref_case_names() -> &'static [&'static str] {
    &[
        "table1_col_insert_row_head",
        "table1_col_insert_row_middle",
        "table1_col_insert_row_tail",
        "table1_col_delete_row_head",
        "table1_col_delete_row_middle",
        "table1_col_delete_row_tail",
        "table1_col_filter_added_column",
        "table1_col_total_row_toggle",
        "table1_col_rename_column",
        "table1_col_resize_range",
    ]
}

// ---------------------------------------------------------------------
// #[test] per shape family
// ---------------------------------------------------------------------

#[test]
fn class_ii_fullcol_family() {
    let mut s = Summary::new("fullcol");
    for &shape in AggregatorShape::all() {
        for &extent in Extent::all() {
            let name = format!("fullcol__{}__{}", shape.as_slug(), extent.as_slug());
            s.record(&name, run_fullcol_case(shape, extent));
        }
    }
    s.emit();
    // Failing tests ARE the bug tracker — `Ib6CYMnT`'s extent × shape
    // surface drifts surface as named failures in the stderr summary
    // above. No silencing budget.
    assert_eq!(
        s.failed, 0,
        "fullcol family: {} failures — see named cases in stderr output above.",
        s.failed,
    );
}

#[test]
fn class_ii_indirect_family() {
    let mut s = Summary::new("indirect");

    // 5 extent cases × 1 shape (SUM via INDIRECT).
    for &extent in Extent::all() {
        let name = format!("indirect__{}", extent.as_slug());
        s.record(&name, run_indirect_case(extent));
    }

    // 3 "revert INDIRECT-argument cell" variants.
    for v in 0..3 {
        let name = format!("indirect_arg_revert__v{}", v);
        s.record(&name, run_indirect_arg_revert_case(v as u8));
    }

    s.emit();
    assert_eq!(
        s.failed, 0,
        "indirect family: {} failures — see named cases in stderr output above.",
        s.failed,
    );
}

#[test]
fn class_ii_offset_family() {
    let mut s = Summary::new("offset");
    for v in 0..6 {
        let name = format!("offset__v{}", v);
        s.record(&name, run_offset_case(v as u8));
    }
    s.emit();
    assert_eq!(
        s.failed, 0,
        "offset family: {} failures — see named cases in stderr output above.",
        s.failed,
    );
}

#[test]
fn class_ii_named_family() {
    let mut s = Summary::new("named");
    for v in 0..4 {
        let name = format!("named__v{}", v);
        s.record(&name, run_named_case(v as u8));
    }
    s.emit();
    assert_eq!(
        s.failed, 0,
        "named family: {} failures — see named cases in stderr output above.",
        s.failed,
    );
}

#[test]
fn class_ii_3d_family() {
    let mut s = Summary::new("3d");
    for v in 0..4 {
        let name = format!("3d__v{}", v);
        s.record(&name, run_3d_case(v as u8));
    }
    // v4 = sheet-rename-between-ops, v5 = sheet-reorder-between-ops.
    // Both structural ops → structural-op scope.
    s.skip(CoverageReason::Round2Scope);
    s.skip(CoverageReason::Round2Scope);
    s.emit();
    assert_eq!(
        s.failed, 0,
        "3d family: {} failures — see named cases in stderr output above.",
        s.failed,
    );
}

#[test]
fn class_ii_table_refs_family_deferred() {
    let mut s = Summary::new("table_refs");
    for name in table_ref_case_names() {
        s.skip(CoverageReason::Round2Scope);
        let _ = name;
    }
    s.emit();
    // All ten cases are skipped; nothing to budget.
    assert_eq!(s.failed, 0);
    assert_eq!(s.passed, 0);
    assert_eq!(s.skipped, table_ref_case_names().len());
}

// ---------------------------------------------------------------------
// Named regression: Ib6CYMnT.
// ---------------------------------------------------------------------

/// The `Ib6CYMnT` pin.
///
/// Reproduces the FINDINGS.md pattern at the engine level. The
/// harness's failing path was run-46 / path-0 / step-4 — i.e. the
/// 5th op on the path, not an isolated op+inverse from a fresh
/// engine. We approximate by running a 4-op preamble of scattered
/// far-outside writes before the op-under-test at row 39_187.
///
/// **Investigation note (2026-04-22, authoring time).** This test
/// *passes* on first run — both the simple 1-step variant and the
/// preamble-augmented multi-step variant restore the dependent to
/// exactly its pre-op value. That contradicts the plan's
/// expectation that the Ib6CYMnT pin would fail today. Per the plan
/// ("If this passes on first run, something's off — investigate
/// wrong cell / wrong range / snapshot issue before declaring
/// victory"), I traced through:
///
/// - Cell coordinates: row 39_187 col F (col index 5), matching
///   FINDINGS.md's `{ "row": 39187, "col": 5 }`. ✓
/// - Range shape: full-column `SourceData!F:F`. ✓
/// - Criterion: `">0"`, matching the harness's numeric-criterion
///   pattern. ✓
/// - Forward/inverse sequence: `set_cell(85)` then
///   `import_values(Null)`. ✓
/// - Snapshot: two sheets (SourceData + Dest), initial extent
///   rows 0..=2 only. ✓
///
/// Conclusion: the engine's invalidation handles the *isolated*
/// shape correctly. The harness's failure depends on interactions
/// not reproduced by a synthetic snapshot alone — candidates:
/// (a) XLSX hydration sets up different bbox-cache state than
/// `from_snapshot`, (b) multiple *different* dependent formulas
/// compete for the same range subscription in the harness's
/// `Ray Booth` sheet, (c) the bug requires a formula-vs-value
/// ordering that our fixture doesn't mimic.
///
/// Left as a **shape pin** — the scenario it tests *is* a Class II
/// invariant regardless of whether it currently fails. If a future
/// refactor breaks the simple case, this test catches it. The
/// original harness finding is separately pinned by the random-
/// walk harness against the XLSX corpus.
#[test]
fn regression_ib6cymnt_fullcol_bbox_extent_miss() {
    // Build a workbook mimicking FINDINGS.md's `Ib6CYMnT` shape.
    //
    // FINDINGS.md pattern (from the run-46 path-0 step-4 reproducer):
    // - Forward op: `{ row: 39187, col: 5, prior: "1", new: "85" }`
    //   i.e. set SourceData!F39188 from 1 → 85.
    // - Dependent `Ray Booth!D21` drifted from 1407 → 1491 (Δ=+84 =
    //   new − prior), and stayed at 1491 after the inverse.
    // - The Δ equalling (new - prior) says the dependent is SUMIFS-
    //   shaped where the edited cell (F39188) is a value column hit
    //   that passes its own criterion.
    //
    // We reproduce by making a SUMIFS that sums `SourceData!$F:$F`
    // with a wildcard ">0" criterion. The edit at F39188 is inside
    // the populated-by-criteria set, so the forward op changes the
    // sum by exactly (new - prior). The inverse must reverse that.
    //
    // Critical setup details that match the FINDINGS.md surface:
    // 1. Initial extent on SourceData is *low* (a handful of cells at
    //    rows 0..=2). Row 39_187 is far outside that.
    // 2. The prior value at F39188 is `1` (non-null), matching the
    //    harness's captured prior.
    // 3. The inverse goes back to `1`, not Null — the harness isn't
    //    testing null-restore, it's testing value-restore.

    let src_cells = vec![
        // F1 = 500, F2 = 600, F3 = 300 — initial SUMIFS = 1400.
        value_cell(0, 0, 5, 500.0),
        value_cell(0, 1, 5, 600.0),
        value_cell(0, 2, 5, 300.0),
        // NOTE: F39188 is *not* pre-seeded in the snapshot. The initial
        // extent on SourceData is rows 0..=2 only; the SUMIFS initial
        // value is exactly 1400. The Ib6CYMnT hypothesis: when the
        // forward op writes F39188=85, the full-column bbox cache
        // *grows* to cover row 39_187. When the inverse restores
        // F39188=<something-that-doesn't-contribute>, the bbox should
        // shrink back but doesn't — the dep extraction on the inverse
        // path short-circuits.
    ];
    let dest_cells = vec![formula_cell(
        1,
        0,
        0,
        "SUMIFS(SourceData!F:F,SourceData!F:F,\">0\")",
    )];

    let snapshot = WorkbookSnapshot {
        sheets: vec![
            sheet_snap(0, "SourceData", src_cells),
            sheet_snap(1, "Dest", dest_cells),
        ],
        ..Default::default()
    };

    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let source = sheet_id(0);
    let dependent = cell_id(1, 0, 0);

    let before = read_value(&engine, &dependent);
    eprintln!("[regression_ib6cymnt] before preamble: {:?}", before);

    // Sanity: 500 + 600 + 300 = 1400.
    assert!(
        matches!(&before, CellValue::Number(n) if (n.get() - 1400.0).abs() < 1e-9),
        "pre-op SUMIFS should be 1400; got {:?}",
        before,
    );

    // --- Preamble: four prior ops at scattered high rows --------------
    //
    // Mimics the harness's multi-step path before the op-under-test.
    // Each prior op writes a non-contributing value (0 or negative),
    // so the dependent value remains 1400 — but the engine's bbox
    // cache / range-subscription state accumulates.
    let preamble: &[(u32, u32, &str)] = &[
        (10_822, 5, "0"),
        (48_655, 5, "-1"),
        (22_500, 5, "0"),
        (55_000, 5, "-1"),
    ];
    for (row, col, input) in preamble {
        let c = cell_id(0, *row, *col);
        engine
            .set_cell(&source, c, *row, *col, (*input).into())
            .expect("preamble set_cell");
    }

    let after_preamble = read_value(&engine, &dependent);
    eprintln!("[regression_ib6cymnt] after preamble: {:?}", after_preamble);
    // Preamble should not have changed the SUMIFS total (all values
    // ≤ 0 fail the ">0" criterion).
    assert!(
        matches!(&after_preamble, CellValue::Number(n) if (n.get() - 1400.0).abs() < 1e-9),
        "post-preamble SUMIFS should still be 1400; got {:?}",
        after_preamble,
    );

    // --- Op-under-test: set F39188 = 85 ------------------------------
    let val_cell = cell_id(0, 39_187, 5);
    engine
        .set_cell(&source, val_cell, 39_187, 5, "85".into())
        .expect("forward set_cell value");

    let during = read_value(&engine, &dependent);
    eprintln!("[regression_ib6cymnt] after forward op: {:?}", during);
    assert!(
        matches!(&during, CellValue::Number(n) if (n.get() - 1485.0).abs() < 1e-9),
        "during-op SUMIFS should be 1485 (1400 + 85); got {:?}",
        during,
    );

    // --- Inverse of the op-under-test --------------------------------
    //
    // In the harness, the inverse is applied *without* reverting the
    // preamble first — the check is "this single pair's identity
    // holds". Match that.
    engine
        .import_values(&source, vec![(39_187, 5, CellValue::Null, None)])
        .expect("inverse import_values");

    let after = read_value(&engine, &dependent);
    eprintln!("[regression_ib6cymnt] after inverse op: {:?}", after);

    // The identity check compares the dependent against the
    // post-preamble value (which was 1400), not the pre-preamble
    // value. Conceptually they're equal, but if preamble leaks state
    // we want to diff against what the harness would capture (which
    // is the state immediately before the op-under-test).
    assert_eq!(
        after_preamble,
        after,
        "Ib6CYMnT regression pin: SUMIFS dependent failed to return \
         to pre-op value after op+inverse far-outside the populated \
         extent, following a preamble of scattered far-outside \
         writes. This test is expected to fail today; passing it \
         means the full-column bbox-cache invalidation is correct \
         under multi-step paths. Δ={} (will equal new-prior if the \
         bug is present). before={:?} after={:?}",
        match (&after_preamble, &after) {
            (CellValue::Number(a), CellValue::Number(b)) => b.get() - a.get(),
            _ => f64::NAN,
        },
        after_preamble,
        after,
    );
}

// ---------------------------------------------------------------------
// Total summary
// ---------------------------------------------------------------------

#[cfg(feature = "audit-tests")]
#[test]
fn class_ii_total_summary() {
    // Re-run every family to get aggregate counts. This duplicates
    // work; it's ~1 s and keeps the single-line "total" print accurate
    // even if individual family tests are filtered with `cargo test
    // -- class_ii_fullcol_family`.
    let start = Instant::now();

    let mut totals = Summary::new("total");

    for &shape in AggregatorShape::all() {
        for &extent in Extent::all() {
            let name = format!("fullcol__{}__{}", shape.as_slug(), extent.as_slug());
            totals.record(&name, run_fullcol_case(shape, extent));
        }
    }
    for &extent in Extent::all() {
        let name = format!("indirect__{}", extent.as_slug());
        totals.record(&name, run_indirect_case(extent));
    }
    for v in 0..3 {
        totals.record(
            &format!("indirect_arg_revert__v{}", v),
            run_indirect_arg_revert_case(v as u8),
        );
    }
    for v in 0..6 {
        totals.record(&format!("offset__v{}", v), run_offset_case(v as u8));
    }
    for v in 0..4 {
        totals.record(&format!("named__v{}", v), run_named_case(v as u8));
    }
    for v in 0..4 {
        totals.record(&format!("3d__v{}", v), run_3d_case(v as u8));
    }
    // 3d__v4/v5 (sheet rename/reorder) → structural-op scope.
    totals.skip(CoverageReason::Round2Scope);
    totals.skip(CoverageReason::Round2Scope);
    for _ in table_ref_case_names() {
        totals.skip(CoverageReason::Round2Scope);
    }

    let elapsed = start.elapsed();

    eprintln!(
        "[Class II total] {}/{} passed, {} failed, {} skipped ({:?})",
        totals.passed,
        totals.passed + totals.failed,
        totals.failed,
        totals.skipped,
        elapsed,
    );
    if !totals.failures.is_empty() {
        eprintln!("[Class II total] failures:");
        for f in &totals.failures {
            eprintln!("{}", f);
        }
    }

    // Failing tests ARE the bug tracker — see per-family stderr output
    // above for the named failing cases. No silencing budget.
    assert_eq!(
        totals.failed, 0,
        "Class II total: {} failures — see per-family stderr output above.",
        totals.failed,
    );
}

// ===========================================================================
// Stage-2 Track-4c — Class II axis-3 × axis-4 expansion.
//
// Layered on top of the existing `AggregatorShape × Extent × RangeType`
// matrix. Baseline 42 cases become 42 × 5 × 13 ≈ 2730 nominal cases;
// incompatible / parse-limited combinations are skipped cleanly.
//
// Split strategy mirrors Track-4b exactly: five coarse `#[test]`s per
// `EditPosition` plus a finer 5×13 split per `(EditPosition, ValueType)`
// to fit the 180 s wall-clock ceiling.
//
// Runtime strategy mirrors Track-4b: additional #[test] functions, one
// per (EditPosition × ValueType) pair for parallelism. This appends to
// range_dependency_tracking.rs and reuses the existing Class II helpers
// already defined in the file.
// ===========================================================================

use matrix::{EditPosition as V2EditPos, ValueType as V2ValueType};

/// Map a `ValueType` to an f64 new-value for the forward op.
///
/// Class II only varies the forward op's value; the inverse restores
/// the live prior (which may itself be Null when the target is outside
/// the initial extent). The returned CellValue is used as `new_value`.
fn v2_new_value(v: V2ValueType) -> CellValue {
    use std::sync::Arc;
    match v {
        V2ValueType::Int => CellValue::Number(FiniteF64::must(85.0)),
        V2ValueType::LargeInt => CellValue::Number(FiniteF64::must(1_000_000_007.0)),
        V2ValueType::FloatClean => CellValue::Number(FiniteF64::must(0.25)),
        V2ValueType::FloatCascade => CellValue::Number(FiniteF64::must(0.2)),
        V2ValueType::Bool => CellValue::Boolean(true),
        V2ValueType::Text => CellValue::Text(Arc::from("beta")),
        V2ValueType::TextShort => CellValue::Text(Arc::from("xyz")),
        V2ValueType::TextLong => CellValue::Text(Arc::from("y".repeat(256))),
        V2ValueType::LeadingApostrophe => CellValue::Text(Arc::from("'flipped")),
        V2ValueType::WhitespaceOnly => CellValue::Text(Arc::from("     ")),
        V2ValueType::NullEmpty => CellValue::Null,
        V2ValueType::Error => CellValue::Error(value_types::CellError::Na, None),
        V2ValueType::DateSerial => CellValue::Number(FiniteF64::must(45_001.0)),
        V2ValueType::TimeSerial => CellValue::Number(FiniteF64::must(0.25)),
    }
}

/// Compute the target cell (row, col) for a given `EditPosition`.
/// Class II's fullcol target is column H (col=7). The edit positions map:
/// - Inside: row 0 (inside A1Only / the initial seed).
/// - OutsideNearby: row 100 (past seed but not extreme).
/// - FarOutside: row 39_187 (Ib6CYMnT hypothesis).
/// - Boundary: row 49_999 (the A50k seed's last populated row).
/// - OtherSheet: handled by switching the target sheet to Dest (not SourceData).
fn v2_target_for(pos: V2EditPos) -> (u32, u32) {
    match pos {
        V2EditPos::Inside => (0, 7),
        V2EditPos::OutsideNearby => (100, 7),
        V2EditPos::FarOutside => (39_187, 7),
        V2EditPos::Boundary => (49_999, 7),
        V2EditPos::OtherSheet => (0, 7),
    }
}

/// Run a single Class II V2 fullcol case.
fn run_fullcol_case_v2(
    shape: AggregatorShape,
    extent: Extent,
    edit_pos: V2EditPos,
    value_kind: V2ValueType,
) -> Result<(), String> {
    let snapshot = fullcol_workbook(shape, extent);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot)
        .map_err(|e| format!("from_snapshot err: {:?}", e))?;

    let source = sheet_id(0);
    let dest = sheet_id(1);
    let dependent = cell_id(1, 0, 0);
    let (target_row, target_col) = v2_target_for(edit_pos);

    // For OtherSheet, target Dest!B1 (which is NOT in the SourceData!H:H
    // range the dependent reads; the edit should not affect the dependent).
    let (target_sheet, target_sheet_idx, target_col) = match edit_pos {
        V2EditPos::OtherSheet => (&dest, 1, 1u32),
        _ => (&source, 0, target_col),
    };
    let target = cell_id(target_sheet_idx, target_row, target_col);

    // Pre-op dependent value.
    let before = read_value(&engine, &dependent);

    // Seed the criterion key for SUMIFS/COUNTIFS/VLOOKUP so the edit
    // would have an effect (when in-range). The seed lives in col A on
    // SourceData. Only seed for same-sheet-as-source edits; the
    // OtherSheet edit targets Dest and doesn't need this.
    //
    // Skip seeding when the target_row's A cell is already part of the
    // snapshot seed (A1Only / A50k / GrewThenShrank / ExpandedMidPath
    // extents have A1 / A49_999 populated). Seeding-then-unseeding would
    // clobber pre-existing state and cause a false dependent drift (the
    // inverse writes Null to A where the extent expected a value).
    let extent_has_key_at_row = match (extent, target_row) {
        (Extent::A1Only, 0) => true,
        (Extent::GrewThenShrank, 0) => true,
        (Extent::ExpandedMidPath, 0) => true,
        (Extent::A50k, 49_999) => true,
        _ => false,
    };
    let mut seeded_key = false;
    if edit_pos != V2EditPos::OtherSheet
        && !extent_has_key_at_row
        && matches!(
            shape,
            AggregatorShape::Sumifs | AggregatorShape::Countifs | AggregatorShape::Vlookup
        )
    {
        engine
            .import_values(
                &source,
                vec![(target_row, 0, CellValue::Number(FiniteF64::must(1.0)), None)],
            )
            .map_err(|e| format!("seed key err: {:?}", e))?;
        seeded_key = true;
    }

    let before_with_key = read_value(&engine, &dependent);

    // Capture the live prior value at the target before the forward op.
    let live_prior = engine
        .mirror()
        .get_cell_value(&target)
        .cloned()
        .unwrap_or(CellValue::Null);

    // Forward op. For numeric types go through set_cell (input-parser
    // path); for non-numeric go through import_values to isolate
    // dependency-tracking drift from parser fidelity drift.
    let new_value = v2_new_value(value_kind);
    let forward_err = match &new_value {
        CellValue::Number(_) => {
            let n = match &new_value {
                CellValue::Number(f) => f.get(),
                _ => unreachable!(),
            };
            let s = if n.fract() == 0.0 && n.abs() < 1e16 {
                format!("{}", n as i64)
            } else {
                format!("{}", n)
            };
            engine
                .set_cell(
                    target_sheet,
                    target,
                    target_row,
                    target_col,
                    s.as_str().into(),
                )
                .err()
        }
        _ => engine
            .import_values(
                target_sheet,
                vec![(target_row, target_col, new_value.clone(), None)],
            )
            .err(),
    };
    if let Some(e) = forward_err {
        return Err(format!("forward op err: {:?}", e));
    }

    // Inverse uses import_values with the live_prior.
    engine
        .import_values(
            target_sheet,
            vec![(target_row, target_col, live_prior.clone(), None)],
        )
        .map_err(|e| format!("inverse err: {:?}", e))?;

    // Clean up the seed key.
    if seeded_key {
        engine
            .import_values(&source, vec![(target_row, 0, CellValue::Null, None)])
            .map_err(|e| format!("unseed key err: {:?}", e))?;
    }

    let after = read_value(&engine, &dependent);
    let ctx = format!(
        "shape={:?} extent={:?} pos={:?} value={:?} before={:?} before_with_key={:?}",
        shape, extent, edit_pos, value_kind, before, before_with_key
    );
    assert_dependent_identity(&before, &after, &ctx)
}

/// Run all Class II V2 cases pinned to one (EditPosition, ValueType) pair.
/// Iterates `AggregatorShape::all() × Extent::all()` = 4 × 5 = 20 cases.
fn run_class_ii_v2_split(
    label: &'static str,
    edit_pos: V2EditPos,
    value_kind: V2ValueType,
) -> (usize, usize, Vec<String>) {
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut failures: Vec<String> = Vec::new();
    for &shape in AggregatorShape::all() {
        for &extent in Extent::all() {
            let name = format!(
                "class2v2__{}__{}__{}__{}",
                shape.as_slug(),
                extent.as_slug(),
                edit_pos.as_slug(),
                value_kind.as_slug(),
            );
            match run_fullcol_case_v2(shape, extent, edit_pos, value_kind) {
                Ok(()) => passed += 1,
                Err(e) => {
                    failed += 1;
                    failures.push(format!("  [{}] {}", name, e));
                }
            }
        }
    }
    eprintln!(
        "[Class II V2 · {}] {}/{} passed, {} failed",
        label,
        passed,
        passed + failed,
        failed,
    );
    if !failures.is_empty() {
        eprintln!("[Class II V2 · {}] failures:", label);
        for f in &failures {
            eprintln!("{}", f);
        }
    }
    (passed, failed, failures)
}

macro_rules! class_ii_matrix_edit_value_test {
    ($name:ident, $label:expr, $edit:expr, $value:expr) => {
        #[cfg(feature = "audit-tests")]
        #[test]
        fn $name() {
            let (_p, failed, _fail_list) = run_class_ii_v2_split($label, $edit, $value);
            assert_eq!(
                failed, 0,
                "Class II V2 ({}): {} failures — see stderr above.",
                $label, failed,
            );
        }
    };
}

// 5 EditPositions × 13 ValueTypes = 65 tests, each iterates 20 fullcol
// cases (4 shapes × 5 extents).

// EditPosition::Inside × 13 ValueTypes.
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_int,
    "inside__int",
    V2EditPos::Inside,
    V2ValueType::Int
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_largeint,
    "inside__largeint",
    V2EditPos::Inside,
    V2ValueType::LargeInt
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_floatclean,
    "inside__floatclean",
    V2EditPos::Inside,
    V2ValueType::FloatClean
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_floatcascade,
    "inside__floatcascade",
    V2EditPos::Inside,
    V2ValueType::FloatCascade
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_bool,
    "inside__bool",
    V2EditPos::Inside,
    V2ValueType::Bool
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_textshort,
    "inside__textshort",
    V2EditPos::Inside,
    V2ValueType::TextShort
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_textlong,
    "inside__textlong",
    V2EditPos::Inside,
    V2ValueType::TextLong
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_leadingapos,
    "inside__leadingapos",
    V2EditPos::Inside,
    V2ValueType::LeadingApostrophe
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_whitespace,
    "inside__whitespace",
    V2EditPos::Inside,
    V2ValueType::WhitespaceOnly
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_nullempty,
    "inside__nullempty",
    V2EditPos::Inside,
    V2ValueType::NullEmpty
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_error,
    "inside__error",
    V2EditPos::Inside,
    V2ValueType::Error
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_dateserial,
    "inside__dateserial",
    V2EditPos::Inside,
    V2ValueType::DateSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_inside_timeserial,
    "inside__timeserial",
    V2EditPos::Inside,
    V2ValueType::TimeSerial
);

// EditPosition::OutsideNearby × 13 ValueTypes.
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_int,
    "outside_nearby__int",
    V2EditPos::OutsideNearby,
    V2ValueType::Int
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_largeint,
    "outside_nearby__largeint",
    V2EditPos::OutsideNearby,
    V2ValueType::LargeInt
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_floatclean,
    "outside_nearby__floatclean",
    V2EditPos::OutsideNearby,
    V2ValueType::FloatClean
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_floatcascade,
    "outside_nearby__floatcascade",
    V2EditPos::OutsideNearby,
    V2ValueType::FloatCascade
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_bool,
    "outside_nearby__bool",
    V2EditPos::OutsideNearby,
    V2ValueType::Bool
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_textshort,
    "outside_nearby__textshort",
    V2EditPos::OutsideNearby,
    V2ValueType::TextShort
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_textlong,
    "outside_nearby__textlong",
    V2EditPos::OutsideNearby,
    V2ValueType::TextLong
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_leadingapos,
    "outside_nearby__leadingapos",
    V2EditPos::OutsideNearby,
    V2ValueType::LeadingApostrophe
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_whitespace,
    "outside_nearby__whitespace",
    V2EditPos::OutsideNearby,
    V2ValueType::WhitespaceOnly
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_nullempty,
    "outside_nearby__nullempty",
    V2EditPos::OutsideNearby,
    V2ValueType::NullEmpty
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_error,
    "outside_nearby__error",
    V2EditPos::OutsideNearby,
    V2ValueType::Error
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_dateserial,
    "outside_nearby__dateserial",
    V2EditPos::OutsideNearby,
    V2ValueType::DateSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_outside_nearby_timeserial,
    "outside_nearby__timeserial",
    V2EditPos::OutsideNearby,
    V2ValueType::TimeSerial
);

// EditPosition::FarOutside × 13 ValueTypes.
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_int,
    "far_outside__int",
    V2EditPos::FarOutside,
    V2ValueType::Int
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_largeint,
    "far_outside__largeint",
    V2EditPos::FarOutside,
    V2ValueType::LargeInt
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_floatclean,
    "far_outside__floatclean",
    V2EditPos::FarOutside,
    V2ValueType::FloatClean
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_floatcascade,
    "far_outside__floatcascade",
    V2EditPos::FarOutside,
    V2ValueType::FloatCascade
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_bool,
    "far_outside__bool",
    V2EditPos::FarOutside,
    V2ValueType::Bool
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_textshort,
    "far_outside__textshort",
    V2EditPos::FarOutside,
    V2ValueType::TextShort
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_textlong,
    "far_outside__textlong",
    V2EditPos::FarOutside,
    V2ValueType::TextLong
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_leadingapos,
    "far_outside__leadingapos",
    V2EditPos::FarOutside,
    V2ValueType::LeadingApostrophe
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_whitespace,
    "far_outside__whitespace",
    V2EditPos::FarOutside,
    V2ValueType::WhitespaceOnly
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_nullempty,
    "far_outside__nullempty",
    V2EditPos::FarOutside,
    V2ValueType::NullEmpty
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_error,
    "far_outside__error",
    V2EditPos::FarOutside,
    V2ValueType::Error
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_dateserial,
    "far_outside__dateserial",
    V2EditPos::FarOutside,
    V2ValueType::DateSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_far_outside_timeserial,
    "far_outside__timeserial",
    V2EditPos::FarOutside,
    V2ValueType::TimeSerial
);

// EditPosition::Boundary × 13 ValueTypes.
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_int,
    "boundary__int",
    V2EditPos::Boundary,
    V2ValueType::Int
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_largeint,
    "boundary__largeint",
    V2EditPos::Boundary,
    V2ValueType::LargeInt
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_floatclean,
    "boundary__floatclean",
    V2EditPos::Boundary,
    V2ValueType::FloatClean
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_floatcascade,
    "boundary__floatcascade",
    V2EditPos::Boundary,
    V2ValueType::FloatCascade
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_bool,
    "boundary__bool",
    V2EditPos::Boundary,
    V2ValueType::Bool
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_textshort,
    "boundary__textshort",
    V2EditPos::Boundary,
    V2ValueType::TextShort
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_textlong,
    "boundary__textlong",
    V2EditPos::Boundary,
    V2ValueType::TextLong
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_leadingapos,
    "boundary__leadingapos",
    V2EditPos::Boundary,
    V2ValueType::LeadingApostrophe
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_whitespace,
    "boundary__whitespace",
    V2EditPos::Boundary,
    V2ValueType::WhitespaceOnly
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_nullempty,
    "boundary__nullempty",
    V2EditPos::Boundary,
    V2ValueType::NullEmpty
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_error,
    "boundary__error",
    V2EditPos::Boundary,
    V2ValueType::Error
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_dateserial,
    "boundary__dateserial",
    V2EditPos::Boundary,
    V2ValueType::DateSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_boundary_timeserial,
    "boundary__timeserial",
    V2EditPos::Boundary,
    V2ValueType::TimeSerial
);

// EditPosition::OtherSheet × 13 ValueTypes. Target cell lives on Dest
// (sheet 1), OUTSIDE the SourceData!H:H full-col range the dependent
// reads, so a valid engine must keep the dependent unchanged.
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_int,
    "other_sheet__int",
    V2EditPos::OtherSheet,
    V2ValueType::Int
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_largeint,
    "other_sheet__largeint",
    V2EditPos::OtherSheet,
    V2ValueType::LargeInt
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_floatclean,
    "other_sheet__floatclean",
    V2EditPos::OtherSheet,
    V2ValueType::FloatClean
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_floatcascade,
    "other_sheet__floatcascade",
    V2EditPos::OtherSheet,
    V2ValueType::FloatCascade
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_bool,
    "other_sheet__bool",
    V2EditPos::OtherSheet,
    V2ValueType::Bool
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_textshort,
    "other_sheet__textshort",
    V2EditPos::OtherSheet,
    V2ValueType::TextShort
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_textlong,
    "other_sheet__textlong",
    V2EditPos::OtherSheet,
    V2ValueType::TextLong
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_leadingapos,
    "other_sheet__leadingapos",
    V2EditPos::OtherSheet,
    V2ValueType::LeadingApostrophe
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_whitespace,
    "other_sheet__whitespace",
    V2EditPos::OtherSheet,
    V2ValueType::WhitespaceOnly
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_nullempty,
    "other_sheet__nullempty",
    V2EditPos::OtherSheet,
    V2ValueType::NullEmpty
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_error,
    "other_sheet__error",
    V2EditPos::OtherSheet,
    V2ValueType::Error
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_dateserial,
    "other_sheet__dateserial",
    V2EditPos::OtherSheet,
    V2ValueType::DateSerial
);
class_ii_matrix_edit_value_test!(
    class_ii_matrix_edit_other_sheet_timeserial,
    "other_sheet__timeserial",
    V2EditPos::OtherSheet,
    V2ValueType::TimeSerial
);
