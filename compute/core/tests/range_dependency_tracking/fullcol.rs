use crate::helpers::*;
use crate::matrix::{AggregatorShape, Extent};
use crate::summary::Summary;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

pub(crate) fn fullcol_formula(shape: AggregatorShape) -> &'static str {
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
pub(crate) fn fullcol_workbook(shape: AggregatorShape, extent: Extent) -> WorkbookSnapshot {
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
pub(crate) fn run_fullcol_case(shape: AggregatorShape, extent: Extent) -> Result<(), String> {
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

pub(crate) fn class_ii_fullcol_family() {
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
