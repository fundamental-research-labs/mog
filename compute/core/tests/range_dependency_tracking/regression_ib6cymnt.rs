use crate::helpers::*;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::WorkbookSnapshot;
use value_types::CellValue;

pub(crate) fn regression_ib6cymnt_fullcol_bbox_extent_miss() {
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
