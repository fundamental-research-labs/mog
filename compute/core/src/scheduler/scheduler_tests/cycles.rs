use super::*;
use value_types::CellError;

static FULL_RECALC_WITH_OPTIONS_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

// -----------------------------------------------------------------------
// Circular reference detection
// -----------------------------------------------------------------------

#[test]
fn test_circular_reference_detected() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
                    row: 0,
                    col: 0, // A1
                    value: CellValue::number(0.0),
                    formula: Some("=B1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1
                    value: CellValue::number(0.0),
                    formula: Some("=A1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
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
    };

    let result = core.init_from_snapshot(&mut mirror, snap).unwrap();

    // Imported circular formula cells may carry Excel cached values. With
    // iterative calculation disabled, preserve those cached values while still
    // emitting circular-reference diagnostics.
    let a1_id = cid(0x10);
    let b1_id = cid(0x11);

    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    let b1_val = core.get_cell_value(&mirror, &b1_id).unwrap();

    assert_eq!(*a1_val, CellValue::number(0.0));
    assert_eq!(*b1_val, CellValue::number(0.0));

    // Circular reference diagnostics should be emitted
    let has_circular_diag = result.errors.iter().any(|e| e.error.contains("Circular"));
    assert!(
        has_circular_diag,
        "Circular reference diagnostic should be emitted"
    );
}

#[test]
fn test_self_referencing_formula() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![CellData {
                cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
                row: 0,
                col: 0, // A1
                value: CellValue::number(0.0),
                formula: Some("=A1+1".to_string()),
                identity_formula: None,
                array_ref: None,
            }],
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
    };

    let result = core.init_from_snapshot(&mut mirror, snap).unwrap();

    // Imported self-references also preserve their cached value. New formulas
    // without a cached value are covered separately below.
    let a1_id = cid(0x10);
    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    assert_eq!(*a1_val, CellValue::number(0.0));

    // Circular reference diagnostic should be emitted
    let has_circular_diag = result.errors.iter().any(|e| e.error.contains("Circular"));
    assert!(
        has_circular_diag,
        "Circular reference diagnostic should be emitted"
    );
}

#[test]
fn blank_self_referencing_formula_materializes_circular_error() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![CellData {
                cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
                row: 0,
                col: 0,
                value: CellValue::Null,
                formula: Some("=A1+1".to_string()),
                identity_formula: None,
                array_ref: None,
            }],
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
    };

    let result = core.init_from_snapshot(&mut mirror, snap).unwrap();
    let a1_id = cid(0x10);

    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::Error(CellError::Circ, None)
    );
    assert!(result.errors.iter().any(|e| e.error.contains("Circular")));
}

// Regression guard for the user-facing `wb.calculate()` idempotency contract
// under non-iterative cycles.
//
// The guard deliberately exercises the engine-level entry point
// `YrsComputeEngine::recalculate_with_options` (the Rust peer that
// `wb.calculate()` dispatches through the bridge: TS `wb.calculate()` →
// `compute_full_recalc` → `BridgeService::full_recalc` →
// `Engine::recalculate_with_options`) rather than `ComputeCore::full_recalc`.
// Idempotency is a property of the engine wrapper, which short-circuits on a
// clean dirty bit. A second user-facing call must not re-emit the already
// materialized circular errors.
//
// The invariant this test pins down:
//
//   Given a workbook containing a cycle and no intervening mutation, a
//   subsequent `calculate()` (no iterative override) must:
//     1. return `RecalcResult { changed_cells: [], .. }` (the dirty
//        short-circuit fires — no work done, no new changes emitted), and
//     2. leave mirror values for the cycle cells byte-identical to what
//        they were after the previous `calculate()`.
//
// A single-cell mutation precedes the first `calculate()` to arm the dirty
// bit — without it, `from_snapshot`'s own `clear_dirty()` at the end of
// init would make the FIRST call a short-circuit, hiding the cycle path.
#[test]
fn test_calculate_idempotent_under_cycles() {
    use crate::storage::engine::YrsComputeEngine;
    use snapshot_types::RecalcOptions;

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000020".to_string(),
                    row: 1,
                    col: 0, // A2 = A1 + 1
                    value: CellValue::number(0.0),
                    formula: Some("=A1+1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
                    row: 0,
                    col: 0, // A1 = A2 + 1
                    value: CellValue::number(0.0),
                    formula: Some("=A2+1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
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
    };

    let (mut engine, _init_recalc) =
        YrsComputeEngine::from_snapshot(snap).expect("engine construction should succeed");

    let sheet_id = sid(1);
    let a1_id = cid(0x10);
    let a2_id = cid(0x20);

    // Arm the dirty bit so the first `calculate()` actually runs a full
    // recalc over the cycle. Touching an unrelated cell is the user-visible
    // analog of any mutation that precedes `wb.calculate()` in real
    // workflows (here B1 is outside the cycle and doesn't perturb it).
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "7")
        .expect("mutation to arm dirty bit should succeed");

    // First user-facing recalc: should actually compute the cycle and emit
    // at least one changed cell (the B1 mutation itself, plus whatever the
    // cycle produces in this pass).
    let opts = RecalcOptions::default();
    let first = engine
        .recalculate_with_options(&opts)
        .expect("first recalculate should succeed");
    assert!(
        !first.changed_cells.is_empty(),
        "first recalculate after a mutation must emit changed_cells \
         (got empty), otherwise the test isn't exercising the cycle code path"
    );

    // Capture mirror values for the cycle cells after the first recalc.
    let a1_after_first = engine.mirror().get_cell_value(&a1_id).cloned();
    let a2_after_first = engine.mirror().get_cell_value(&a2_id).cloned();
    assert_eq!(
        a1_after_first,
        Some(CellValue::number(0.0)),
        "A1 should preserve imported cached circular value"
    );
    assert_eq!(
        a2_after_first,
        Some(CellValue::number(0.0)),
        "A2 should preserve imported cached circular value"
    );

    // Second user-facing recalc with NO intervening mutation. The dirty
    // short-circuit must fire: zero changed cells, and the mirror must
    // remain bit-identical to its state after the first recalc.
    let second = engine
        .recalculate_with_options(&opts)
        .expect("second recalculate should succeed");
    assert!(
        second.changed_cells.is_empty(),
        "second recalculate with no intervening mutation must short-circuit \
         to RecalcResult::empty(), got {} changed_cells",
        second.changed_cells.len()
    );

    let a1_after_second = engine.mirror().get_cell_value(&a1_id).cloned();
    let a2_after_second = engine.mirror().get_cell_value(&a2_id).cloned();
    assert_eq!(
        a1_after_first, a1_after_second,
        "A1 mirror value must be identical across two recalcs with no \
         intervening mutation"
    );
    assert_eq!(
        a2_after_first, a2_after_second,
        "A2 mirror value must be identical across two recalcs with no \
         intervening mutation"
    );
}

fn self_cycle_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![CellData {
                cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
                row: 0,
                col: 0,
                value: CellValue::Null,
                formula: Some("=A1+1".to_string()),
                identity_formula: None,
                array_ref: None,
            }],
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

#[test]
fn full_recalc_with_options_success_restores_settings_and_clears_pending_manual_dirty() {
    use snapshot_types::RecalcOptions;

    let _guard = FULL_RECALC_WITH_OPTIONS_TEST_LOCK.lock().unwrap();
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .expect("basic snapshot should initialize");
    core.set_iterative_calc(false);
    core.set_max_iterations(77);
    core.set_max_change(0.25);
    core.pending_manual_dirty_cells.insert(cid(0xfeed));

    let result = core
        .full_recalc_with_options(
            &mut mirror,
            &RecalcOptions {
                iterative: Some(true),
                max_iterations: Some(3),
                max_change: Some(value_types::FiniteF64::must(0.00001)),
            },
        )
        .expect("full recalc with overrides should succeed");

    assert!(!result.metrics.has_circular_refs);
    assert!(!core.iterative_calc());
    assert_eq!(core.max_iterations(), 77);
    assert_eq!(core.max_change(), 0.25);
    assert!(core.pending_manual_dirty_cells.is_empty());
}

#[test]
fn full_recalc_with_options_err_restores_settings_and_keeps_pending_manual_dirty() {
    use snapshot_types::RecalcOptions;

    let _guard = FULL_RECALC_WITH_OPTIONS_TEST_LOCK.lock().unwrap();
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot_viewport_only(&mut mirror, basic_snapshot())
        .expect("viewport-only snapshot should initialize");
    core.set_iterative_calc(false);
    core.set_max_iterations(77);
    core.set_max_change(0.25);
    let dirty = cid(0xfeed);
    core.pending_manual_dirty_cells.insert(dirty);

    let err = core
        .full_recalc_with_options(
            &mut mirror,
            &RecalcOptions {
                iterative: Some(true),
                max_iterations: Some(3),
                max_change: Some(value_types::FiniteF64::must(0.00001)),
            },
        )
        .unwrap_err();

    assert!(
        err.to_string().contains("deferred XLSX hydration"),
        "expected viewport-only full recalc error, got {err}"
    );
    assert!(!core.iterative_calc());
    assert_eq!(core.max_iterations(), 77);
    assert_eq!(core.max_change(), 0.25);
    assert!(core.pending_manual_dirty_cells.contains(&dirty));
}

#[test]
fn full_recalc_with_options_panic_restores_settings_and_keeps_pending_manual_dirty() {
    use snapshot_types::RecalcOptions;

    let _guard = FULL_RECALC_WITH_OPTIONS_TEST_LOCK.lock().unwrap();
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .expect("basic snapshot should initialize");
    core.set_iterative_calc(false);
    core.set_max_iterations(77);
    core.set_max_change(0.25);
    let dirty = cid(0xfeed);
    core.pending_manual_dirty_cells.insert(dirty);
    super::recalc::set_recalc_options_panic_before_full_recalc_for_tests(true);

    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = core.full_recalc_with_options(
            &mut mirror,
            &RecalcOptions {
                iterative: Some(true),
                max_iterations: Some(3),
                max_change: Some(value_types::FiniteF64::must(0.00001)),
            },
        );
    }));

    assert!(panic.is_err());
    assert!(!core.iterative_calc());
    assert_eq!(core.max_iterations(), 77);
    assert_eq!(core.max_change(), 0.25);
    assert!(core.pending_manual_dirty_cells.contains(&dirty));
}

#[test]
fn full_recalc_with_options_repeated_calls_do_not_leak_iterative_state() {
    use snapshot_types::RecalcOptions;

    let _guard = FULL_RECALC_WITH_OPTIONS_TEST_LOCK.lock().unwrap();
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, self_cycle_snapshot())
        .expect("self-cycle snapshot should initialize");
    core.set_iterative_calc(false);
    core.set_max_iterations(100);
    core.set_max_change(0.001);

    let first = core
        .full_recalc_with_options(
            &mut mirror,
            &RecalcOptions {
                iterative: Some(true),
                max_iterations: Some(2),
                max_change: Some(value_types::FiniteF64::must(0.00001)),
            },
        )
        .expect("first iterative override should succeed");
    assert_eq!(first.metrics.iterative_iterations, 2);
    assert!(!core.iterative_calc());
    assert_eq!(core.max_iterations(), 100);
    assert_eq!(core.max_change(), 0.001);

    let second = core
        .full_recalc_with_options(
            &mut mirror,
            &RecalcOptions {
                iterative: Some(true),
                max_iterations: Some(5),
                max_change: Some(value_types::FiniteF64::must(0.00001)),
            },
        )
        .expect("second iterative override should succeed");
    assert_eq!(second.metrics.iterative_iterations, 5);
    assert!(!core.iterative_calc());
    assert_eq!(core.max_iterations(), 100);
    assert_eq!(core.max_change(), 0.001);
}

#[test]
fn full_recalc_with_options_circular_workbook_consumes_per_call_options() {
    use snapshot_types::RecalcOptions;

    let _guard = FULL_RECALC_WITH_OPTIONS_TEST_LOCK.lock().unwrap();
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, self_cycle_snapshot())
        .expect("self-cycle snapshot should initialize");
    let a1 = cid(0x10);
    assert_eq!(
        *core.get_cell_value(&mirror, &a1).unwrap(),
        CellValue::Error(CellError::Circ, None),
        "A1 should start as a circular error when no cached value exists"
    );

    let result = core
        .full_recalc_with_options(
            &mut mirror,
            &RecalcOptions {
                iterative: Some(true),
                max_iterations: Some(4),
                max_change: Some(value_types::FiniteF64::must(0.00001)),
            },
        )
        .expect("iterative full recalc should succeed");
    let after = match core.get_cell_value(&mirror, &a1).unwrap() {
        CellValue::Number(n) => n.get(),
        other => panic!("A1 should remain numeric after iterative recalc, got {other:?}"),
    };

    assert!(result.metrics.has_circular_refs);
    assert_eq!(result.metrics.iterative_iterations, 4);
    assert!(!result.metrics.iterative_converged);
    assert_eq!(after, 4.0);
    assert!(!core.iterative_calc());
    assert_eq!(core.max_iterations(), 100);
    assert_eq!(core.max_change(), 0.001);
}

#[test]
fn iterative_calc_solves_chained_debt_schedule_cycles() {
    use snapshot_types::RecalcOptions;

    fn value_cell(cell_id: CellId, row: u32, col: u32, value: f64) -> CellData {
        CellData {
            cell_id: cell_id.to_uuid_string(),
            row,
            col,
            value: CellValue::number(value),
            formula: None,
            identity_formula: None,
            array_ref: None,
        }
    }

    fn formula_cell(cell_id: CellId, row: u32, col: u32, formula: &str) -> CellData {
        CellData {
            cell_id: cell_id.to_uuid_string(),
            row,
            col,
            value: CellValue::Null,
            formula: Some(formula.to_string()),
            identity_formula: None,
            array_ref: None,
        }
    }

    fn expect_number(core: &ComputeCore, mirror: &CellMirror, cell_id: CellId) -> f64 {
        match core.get_cell_value(mirror, &cell_id).unwrap() {
            CellValue::Number(n) => n.get(),
            other => panic!("expected numeric value for {cell_id:?}, got {other:?}"),
        }
    }

    let cells = vec![
        // Period 1 (E): internal cycle E21 -> E25 -> E24 -> E26 -> E22 -> E21.
        value_cell(cid(0xe20), 19, 4, 400.0),
        formula_cell(cid(0xe21), 20, 4, "=E25*0.05"),
        formula_cell(cid(0xe22), 21, 4, "=0.75*(E20-E21)"),
        value_cell(cid(0xe23), 22, 4, 5000.0),
        formula_cell(cid(0xe24), 23, 4, "=E23-E26"),
        formula_cell(cid(0xe25), 24, 4, "=(E23+E24)/2"),
        formula_cell(cid(0xe26), 25, 4, "=MIN(E22,E23)"),
        // Period 2 (F): beginning balance depends on period 1 ending balance.
        value_cell(cid(0xf20), 19, 5, 440.0),
        formula_cell(cid(0xf21), 20, 5, "=F25*0.05"),
        formula_cell(cid(0xf22), 21, 5, "=0.75*(F20-F21)"),
        formula_cell(cid(0xf23), 22, 5, "=E24"),
        formula_cell(cid(0xf24), 23, 5, "=F23-F26"),
        formula_cell(cid(0xf25), 24, 5, "=(F23+F24)/2"),
        formula_cell(cid(0xf26), 25, 5, "=MIN(F22,F23)"),
        // Period 3 (G): beginning balance depends on period 2 ending balance.
        value_cell(cid(0x1020), 19, 6, 484.0),
        formula_cell(cid(0x1021), 20, 6, "=G25*0.05"),
        formula_cell(cid(0x1022), 21, 6, "=0.75*(G20-G21)"),
        formula_cell(cid(0x1023), 22, 6, "=F24"),
        formula_cell(cid(0x1024), 23, 6, "=G23-G26"),
        formula_cell(cid(0x1025), 24, 6, "=(G23+G24)/2"),
        formula_cell(cid(0x1026), 25, 6, "=MIN(G22,G23)"),
    ];

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 10,
            cells,
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
    };

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap)
        .expect("debt schedule snapshot should initialize");

    let result = core
        .full_recalc_with_options(
            &mut mirror,
            &RecalcOptions {
                iterative: Some(true),
                max_iterations: Some(100),
                max_change: Some(value_types::FiniteF64::must(0.001)),
            },
        )
        .expect("iterative recalc should run");

    assert!(result.metrics.has_circular_refs);
    assert!(
        result.metrics.iterative_converged,
        "expected chained cycles to converge, metrics = {:?}",
        result.metrics
    );

    let e_end = expect_number(&core, &mirror, cid(0xe24));
    let f_begin = expect_number(&core, &mirror, cid(0xf23));
    let f_end = expect_number(&core, &mirror, cid(0xf24));
    let g_begin = expect_number(&core, &mirror, cid(0x1023));
    let g_end = expect_number(&core, &mirror, cid(0x1024));

    assert!(
        (e_end - f_begin).abs() < 0.01,
        "period 2 beginning balance must use period 1 ending balance"
    );
    assert!(
        (f_end - g_begin).abs() < 0.01,
        "period 3 beginning balance must use period 2 ending balance"
    );
    assert!(e_end > f_end && f_end > g_end);
    assert!(g_end > 0.0);
}

#[test]
fn iterative_calc_recovers_chained_debt_schedule_after_incremental_edits() {
    use snapshot_types::RecalcOptions;

    fn empty_snapshot() -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "00000000-0000-0000-0000-000000000001".to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 10,
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

    fn set(
        core: &mut ComputeCore,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: &str,
    ) {
        core.set_cell(mirror, sheet_id, cell_id, row, col, input)
            .expect("incremental set_cell should succeed");
    }

    fn expect_number(core: &ComputeCore, mirror: &CellMirror, cell_id: CellId) -> f64 {
        match core.get_cell_value(mirror, &cell_id).unwrap() {
            CellValue::Number(n) => n.get(),
            other => panic!("expected numeric value for {cell_id:?}, got {other:?}"),
        }
    }

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let sheet_id = sid(1);
    core.init_from_snapshot(&mut mirror, empty_snapshot())
        .expect("empty workbook should initialize");

    for (cell_id, row, input) in [
        (cid(0xb1), 0, "1000"),
        (cid(0xb2), 1, "400"),
        (cid(0xb3), 2, "=B1-B2"),
        (cid(0xb4), 3, "200"),
        (cid(0xb5), 4, "=B3-B4"),
        (cid(0xb6), 5, "=B12*0.05"),
        (cid(0xb7), 6, "=B5-B6"),
        (cid(0xb8), 7, "=MAX(B7*0.25,0)"),
        (cid(0xb9), 8, "=B7-B8"),
        (cid(0xb10), 9, "5000"),
        (cid(0xb11), 10, "=B10-B13"),
        (cid(0xb12), 11, "=(B10+B11)/2"),
        (cid(0xb13), 12, "=MIN(B9,B10)"),
    ] {
        set(&mut core, &mut mirror, &sheet_id, cell_id, row, 1, input);
    }

    core.full_recalc_with_options(
        &mut mirror,
        &RecalcOptions {
            iterative: Some(true),
            max_iterations: Some(100),
            max_change: Some(value_types::FiniteF64::must(0.001)),
        },
    )
    .expect("one-period iterative recalc should run");

    let cols = [
        (4, 0xe20, "400", None),
        (5, 0xf20, "440", Some(0xe24)),
        (6, 0x1020, "484", Some(0xf24)),
    ];

    for (col, ebitda_id, ebitda, prior_end_id) in cols {
        let col_name = match col {
            4 => "E",
            5 => "F",
            6 => "G",
            _ => unreachable!(),
        };
        set(
            &mut core,
            &mut mirror,
            &sheet_id,
            cid(ebitda_id),
            19,
            col,
            ebitda,
        );
        set(
            &mut core,
            &mut mirror,
            &sheet_id,
            cid(ebitda_id + 1),
            20,
            col,
            &format!("={col_name}25*0.05"),
        );
        set(
            &mut core,
            &mut mirror,
            &sheet_id,
            cid(ebitda_id + 2),
            21,
            col,
            &format!("=0.75*({col_name}20-{col_name}21)"),
        );
        let begin_formula;
        let begin_input = if let Some(prior) = prior_end_id {
            begin_formula = format!("={}", if prior == 0xe24 { "E24" } else { "F24" });
            begin_formula.as_str()
        } else {
            "5000"
        };
        set(
            &mut core,
            &mut mirror,
            &sheet_id,
            cid(ebitda_id + 3),
            22,
            col,
            begin_input,
        );
        set(
            &mut core,
            &mut mirror,
            &sheet_id,
            cid(ebitda_id + 4),
            23,
            col,
            &format!("={col_name}23-{col_name}26"),
        );
        set(
            &mut core,
            &mut mirror,
            &sheet_id,
            cid(ebitda_id + 5),
            24,
            col,
            &format!("=({col_name}23+{col_name}24)/2"),
        );
        set(
            &mut core,
            &mut mirror,
            &sheet_id,
            cid(ebitda_id + 6),
            25,
            col,
            &format!("=MIN({col_name}22,{col_name}23)"),
        );
    }

    let result = core
        .full_recalc_with_options(
            &mut mirror,
            &RecalcOptions {
                iterative: Some(true),
                max_iterations: Some(100),
                max_change: Some(value_types::FiniteF64::must(0.001)),
            },
        )
        .expect("multi-period iterative recalc should run");

    assert!(
        result.metrics.iterative_converged,
        "expected sequentially entered chained cycles to converge, metrics = {:?}",
        result.metrics
    );

    let e_end = expect_number(&core, &mirror, cid(0xe24));
    let f_begin = expect_number(&core, &mirror, cid(0xf23));
    let f_end = expect_number(&core, &mirror, cid(0xf24));
    let g_begin = expect_number(&core, &mirror, cid(0x1023));
    let g_end = expect_number(&core, &mirror, cid(0x1024));

    assert!((e_end - f_begin).abs() < 0.01);
    assert!((f_end - g_begin).abs() < 0.01);
    assert!(e_end > f_end && f_end > g_end);
    assert!(g_end > 0.0);
}
