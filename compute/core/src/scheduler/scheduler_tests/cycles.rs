use super::*;

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

    // With always-converge: A1=B1, B1=A1 is a stable tautology seeded from
    // cached values (0.0). Both cells should be numbers, not errors.
    let a1_id = cid(0x10);
    let b1_id = cid(0x11);

    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    let b1_val = core.get_cell_value(&mirror, &b1_id).unwrap();

    assert!(
        matches!(*a1_val, CellValue::Number(_)),
        "A1 should be a number: {:?}",
        a1_val
    );
    assert!(
        matches!(*b1_val, CellValue::Number(_)),
        "B1 should be a number: {:?}",
        b1_val
    );

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

    // With always-converge: A1=A1+1 is divergent, caps at max_iterations.
    // Starting from cached value 0.0, it should be a large number, not an error.
    let a1_id = cid(0x10);
    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    assert!(
        matches!(*a1_val, CellValue::Number(_)),
        "Self-reference should produce a number (divergent, capped): {:?}",
        a1_val
    );

    // Circular reference diagnostic should be emitted
    let has_circular_diag = result.errors.iter().any(|e| e.error.contains("Circular"));
    assert!(
        has_circular_diag,
        "Circular reference diagnostic should be emitted"
    );
}

// Regression guard for the user-facing `wb.calculate()` idempotency contract
// under non-iterative cycles.
//
// The guard deliberately exercises the engine-level entry point
// `YrsComputeEngine::recalculate_with_options` (the Rust peer that
// `wb.calculate()` dispatches through the bridge: TS `wb.calculate()` →
// `compute_full_recalc` → `BridgeService::full_recalc` →
// `Engine::recalculate_with_options`) rather than `ComputeCore::full_recalc`.
// The inner `full_recalc` is NOT idempotent under single-pass cycle
// evaluation — each call advances the cycle by one iteration because numeric
// cells are warm-started from the previous pass, not reset to the seed.
// Idempotency is a property of the engine wrapper, which short-circuits on a
// clean dirty bit.
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
// On current `origin/dev` this test FAILS: `recalculate_with_options`
// re-arms the dirty bit whenever a recalc touches a cycle that did not
// converge (the default non-iterative mode never converges because
// `iterative_converged` is never set to `true` there). So the second call
// re-enters `full_recalc`, advances the cycle one more iteration, and emits
// a non-empty `changed_cells`. PR B removes that re-arm, after which the
// second call short-circuits and this test passes.
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
    assert!(
        matches!(a1_after_first, Some(CellValue::Number(_))),
        "A1 should be a number after first recalculate, got {:?}",
        a1_after_first
    );
    assert!(
        matches!(a2_after_first, Some(CellValue::Number(_))),
        "A2 should be a number after first recalculate, got {:?}",
        a2_after_first
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
    let before = match core.get_cell_value(&mirror, &a1).unwrap() {
        CellValue::Number(n) => n.get(),
        other => panic!("A1 should start numeric after init, got {other:?}"),
    };

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
    assert_eq!(after - before, 4.0);
    assert!(!core.iterative_calc());
    assert_eq!(core.max_iterations(), 100);
    assert_eq!(core.max_change(), 0.001);
}
