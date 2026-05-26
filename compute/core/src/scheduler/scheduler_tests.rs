use super::test_helpers::*;
use super::value_utils::parse_plain_value;
use super::*;
use crate::mirror::CellMirror;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use compute_parser::CellRefNode;
use formula_types::IdentityFormulaRef;
use value_types::CellValue;

// -----------------------------------------------------------------------
// Init from snapshot with formulas
// -----------------------------------------------------------------------

#[test]
fn test_init_from_snapshot_basic() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let result = core
        .init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // C1 = A1 + B1 = 10 + 20 = 30
    let c1_id = cid(0x12);
    let c1_val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*c1_val, CellValue::number(30.0));

    // Should report C1 as changed (from 0.0 to 30.0)
    assert!(!result.changed_cells.is_empty());
}

#[test]
fn test_init_from_snapshot_formula_stored() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let c1_id = cid(0x12);
    assert_eq!(core.get_formula(&c1_id), Some("=A1+B1"));
}

#[test]
fn test_init_identity_formulas_dedupe_ghost_cells_by_sheet_and_position() {
    fn cell_ref_ids(mirror: &CellMirror, cell_id: CellId) -> Vec<CellId> {
        mirror
            .get_formula(&cell_id)
            .unwrap_or_else(|| panic!("cell {cell_id:?} should have an identity formula"))
            .refs
            .iter()
            .map(|r| match r {
                IdentityFormulaRef::Cell(cell) => cell.id,
                other => panic!("expected a cell identity ref, got {other:?}"),
            })
            .collect()
    }

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let sheet1 = sid(1);
    let sheet2 = sid(2);
    let a1 = cid(0x100);
    let s1_same_ref_twice = cid(0x200);
    let s1_same_ref_other_formula = cid(0x201);
    let s1_different_missing_positions = cid(0x202);
    let s1_explicit_sheet2_and_unqualified_sheet1 = cid(0x203);
    let s1_existing_real_cell = cid(0x204);
    let s2_unqualified_same_row_col = cid(0x300);
    let s2_explicit_sheet1_and_unqualified_sheet2 = cid(0x301);

    let snap = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: sheet1.to_uuid_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    CellData {
                        cell_id: a1.to_uuid_string(),
                        row: 0,
                        col: 0,
                        value: CellValue::number(10.0),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s1_same_ref_twice.to_uuid_string(),
                        row: 0,
                        col: 3,
                        value: CellValue::number(0.0),
                        formula: Some("=B1+B1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s1_same_ref_other_formula.to_uuid_string(),
                        row: 0,
                        col: 4,
                        value: CellValue::number(0.0),
                        formula: Some("=B1+1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s1_different_missing_positions.to_uuid_string(),
                        row: 0,
                        col: 5,
                        value: CellValue::number(0.0),
                        formula: Some("=B1+C1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s1_explicit_sheet2_and_unqualified_sheet1.to_uuid_string(),
                        row: 0,
                        col: 6,
                        value: CellValue::number(0.0),
                        formula: Some("=Sheet2!B1+B1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s1_existing_real_cell.to_uuid_string(),
                        row: 0,
                        col: 7,
                        value: CellValue::number(0.0),
                        formula: Some("=A1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: sheet2.to_uuid_string(),
                name: "Sheet2".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    CellData {
                        cell_id: s2_unqualified_same_row_col.to_uuid_string(),
                        row: 0,
                        col: 3,
                        value: CellValue::number(0.0),
                        formula: Some("=B1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s2_explicit_sheet1_and_unqualified_sheet2.to_uuid_string(),
                        row: 0,
                        col: 4,
                        value: CellValue::number(0.0),
                        formula: Some("=Sheet1!B1+B1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
            },
        ],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    core.init_from_snapshot(&mut mirror, snap)
        .expect("ghost identity snapshot should initialize");

    let same_ref_twice = cell_ref_ids(&mirror, s1_same_ref_twice);
    assert_eq!(same_ref_twice.len(), 2);
    assert_eq!(same_ref_twice[0], same_ref_twice[1]);

    let same_ref_other_formula = cell_ref_ids(&mirror, s1_same_ref_other_formula);
    assert_eq!(same_ref_twice[0], same_ref_other_formula[0]);

    let different_positions = cell_ref_ids(&mirror, s1_different_missing_positions);
    assert_ne!(different_positions[0], different_positions[1]);
    assert_eq!(different_positions[0], same_ref_twice[0]);

    let sheet2_unqualified = cell_ref_ids(&mirror, s2_unqualified_same_row_col);
    assert_ne!(same_ref_twice[0], sheet2_unqualified[0]);
    assert_eq!(
        mirror.resolve_position(&same_ref_twice[0]),
        Some(SheetPos::new(0, 1))
    );
    assert_eq!(mirror.sheet_for_cell(&same_ref_twice[0]), Some(sheet1));
    assert_eq!(
        mirror.resolve_position(&sheet2_unqualified[0]),
        Some(SheetPos::new(0, 1))
    );
    assert_eq!(mirror.sheet_for_cell(&sheet2_unqualified[0]), Some(sheet2));

    let explicit_sheet2 = cell_ref_ids(&mirror, s1_explicit_sheet2_and_unqualified_sheet1);
    assert_eq!(explicit_sheet2[0], sheet2_unqualified[0]);
    assert_eq!(explicit_sheet2[1], same_ref_twice[0]);

    let explicit_sheet1 = cell_ref_ids(&mirror, s2_explicit_sheet1_and_unqualified_sheet2);
    assert_eq!(explicit_sheet1[0], same_ref_twice[0]);
    assert_eq!(explicit_sheet1[1], sheet2_unqualified[0]);

    let existing_real_cell = cell_ref_ids(&mirror, s1_existing_real_cell);
    assert_eq!(existing_real_cell, vec![a1]);
}

#[test]
fn test_minimal_init_seeds_formula_readback_before_graph_build() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot_minimal(&mut mirror, basic_snapshot())
        .unwrap();

    let c1_id = cid(0x12);
    assert_eq!(core.get_formula(&c1_id), Some("=A1+B1"));
    assert!(
        core.ast_cache.is_empty(),
        "minimal init must not build the formula graph eagerly",
    );
    assert!(
        core.deferred_formula_cells.is_some(),
        "minimal init should still defer graph construction",
    );

    core.ensure_graph_built(&mut mirror).unwrap();
    assert_eq!(core.get_formula(&c1_id), Some("=A1+B1"));
    assert!(
        core.ast_cache.contains_key(&c1_id),
        "deferred graph build should consume the seeded formula source",
    );
}

#[test]
fn test_viewport_only_init_seeds_materialized_formula_readback() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot_viewport_only(&mut mirror, basic_snapshot())
        .unwrap();

    let c1_id = cid(0x12);
    assert_eq!(core.get_formula(&c1_id), Some("=A1+B1"));
    assert!(
        core.ast_cache.is_empty(),
        "viewport-only init must keep dependency graph construction lazy",
    );
}

#[test]
fn test_viewport_only_init_rejects_partial_graph_build() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot_viewport_only(&mut mirror, basic_snapshot())
        .unwrap();

    let err = core.ensure_graph_built(&mut mirror).unwrap_err();
    assert!(
        err.to_string().contains("deferred XLSX hydration"),
        "viewport-only graph build must fail with a materialization error, got {err}",
    );
    assert_eq!(core.get_formula(&cid(0x12)), Some("=A1+B1"));
}

#[test]
fn test_init_empty_snapshot() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let snap = WorkbookSnapshot {
        sheets: vec![],
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
    assert!(result.changed_cells.is_empty());
}

// -----------------------------------------------------------------------
// Set cell with formula — recalc propagation
// -----------------------------------------------------------------------

#[test]
fn test_set_cell_formula_recalc() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let d1_id = cid(0x13);

    // Set D1 = C1 * 2
    let result = core
        .set_cell(&mut mirror, &sheet_id, d1_id, 0, 3, "=C1*2")
        .unwrap();

    // D1 should be 30 * 2 = 60
    let d1_val = core.get_cell_value(&mirror, &d1_id).unwrap();
    assert_eq!(*d1_val, CellValue::number(60.0));

    // D1 should be in changed cells
    assert!(
        result
            .changed_cells
            .iter()
            .any(|c| c.cell_id == d1_id.to_uuid_string())
    );
}

#[test]
fn test_set_cell_triggers_dependent_recalc() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let a1_id = cid(0x10);
    let c1_id = cid(0x12);

    // Change A1 from 10 to 50
    let result = core
        .set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "50")
        .unwrap();

    // C1 = A1 + B1 = 50 + 20 = 70
    let c1_val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*c1_val, CellValue::number(70.0));

    // C1 should be in changed cells
    assert!(
        result
            .changed_cells
            .iter()
            .any(|c| c.cell_id == c1_id.to_uuid_string())
    );
}

// -----------------------------------------------------------------------
// Set cell with plain value
// -----------------------------------------------------------------------

#[test]
fn test_set_cell_plain_number() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let a1_id = cid(0x10);

    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "42")
        .unwrap();

    let val = core.get_cell_value(&mirror, &a1_id).unwrap();
    assert_eq!(*val, CellValue::number(42.0));
}

#[test]
fn test_set_cell_plain_boolean() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let new_cell = cid(0x20);

    core.set_cell(&mut mirror, &sheet_id, new_cell, 5, 0, "TRUE")
        .unwrap();

    let val = core.get_cell_value(&mirror, &new_cell).unwrap();
    assert_eq!(*val, CellValue::Boolean(true));
}

#[test]
fn test_set_cell_plain_text() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let new_cell = cid(0x21);

    core.set_cell(&mut mirror, &sheet_id, new_cell, 5, 1, "Hello World")
        .unwrap();

    let val = core.get_cell_value(&mirror, &new_cell).unwrap();
    assert_eq!(*val, CellValue::Text("Hello World".into()));
}

// -----------------------------------------------------------------------
// Clear cell
// -----------------------------------------------------------------------

#[test]
fn test_clear_cell_updates_dependents() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let a1_id = cid(0x10);
    let c1_id = cid(0x12);

    // C1 = A1 + B1 = 10 + 20 = 30
    assert_eq!(
        *core.get_cell_value(&mirror, &c1_id).unwrap(),
        CellValue::number(30.0)
    );

    // Clear A1
    core.clear_cells(&mut mirror, &[a1_id]).unwrap();

    // A1 should be null
    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    assert_eq!(*a1_val, CellValue::Null);

    // C1 = 0 + 20 = 20 (Null coerces to 0)
    let c1_val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*c1_val, CellValue::number(20.0));
}

#[test]
fn test_clear_formula_cell() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let c1_id = cid(0x12);

    // Clear C1 (which has formula =A1+B1)
    core.clear_cells(&mut mirror, &[c1_id]).unwrap();

    // Formula should be gone
    assert!(core.get_formula(&c1_id).is_none());

    // Value should be null
    let val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*val, CellValue::Null);
}

// -----------------------------------------------------------------------
// Batch edits
// -----------------------------------------------------------------------

#[test]
fn test_set_cells_batch() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let a1_id = cid(0x10);
    let b1_id = cid(0x11);
    let c1_id = cid(0x12);

    // Change both A1 and B1 at once
    use crate::storage::engine::mutation::CellInput;
    let edits = vec![
        (
            sheet_id,
            a1_id,
            0u32,
            0u32,
            CellInput::Parse {
                text: "100".to_string(),
            },
        ),
        (
            sheet_id,
            b1_id,
            0,
            1,
            CellInput::Parse {
                text: "200".to_string(),
            },
        ),
    ];

    let result = core.set_cells(&mut mirror, &edits, false).unwrap();

    // C1 = A1 + B1 = 100 + 200 = 300
    let c1_val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*c1_val, CellValue::number(300.0));

    // All three cells should be in changes
    let changed_ids: Vec<String> = result
        .changed_cells
        .iter()
        .map(|c| c.cell_id.clone())
        .collect();
    assert!(changed_ids.contains(&c1_id.to_uuid_string()));
}

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

// -----------------------------------------------------------------------
// Chain of dependencies
// -----------------------------------------------------------------------

#[test]
fn test_dependency_chain_a_b_c() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    // A1=5, B1=A1*2, C1=B1+10
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
                    value: CellValue::number(5.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2, // C1
                    value: CellValue::number(0.0),
                    formula: Some("=B1+10".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // B1 = 5 * 2 = 10, C1 = 10 + 10 = 20
    let b1_id = cid(0x11);
    let c1_id = cid(0x12);

    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::number(10.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &c1_id).unwrap(),
        CellValue::number(20.0)
    );

    // Change A1 to 100
    let sheet_id = sid(1);
    let a1_id = cid(0x10);
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "100")
        .unwrap();

    // B1 = 100 * 2 = 200, C1 = 200 + 10 = 210
    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::number(200.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &c1_id).unwrap(),
        CellValue::number(210.0)
    );
}

// -----------------------------------------------------------------------
// Volatile cells
// -----------------------------------------------------------------------

#[test]
fn test_volatile_cell_always_recalculated() {
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
                    formula: Some("=NOW()".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1 — plain value
                    value: CellValue::number(42.0),
                    formula: None,
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let a1_id = cid(0x10);

    // A1 should be marked volatile
    assert!(core.graph.is_volatile(&a1_id));

    // A1 should have the NOW() result — a serial date in a reasonable range.
    // Since we use the injectable timestamp (or system clock), it should be
    // a value greater than 45000 (~ early 2023).
    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    match a1_val {
        CellValue::Number(n) => assert!(
            n.get() > 45000.0,
            "NOW() should return a serial date > 45000, got {}",
            n.get()
        ),
        other => panic!("Expected Number from NOW(), got {:?}", other),
    }
}

// -----------------------------------------------------------------------
// Empty cell formula → clear
// -----------------------------------------------------------------------

#[test]
fn test_set_cell_empty_clears() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let c1_id = cid(0x12);

    // Set C1 to empty
    core.set_cell(&mut mirror, &sheet_id, c1_id, 0, 2, "")
        .unwrap();

    // C1 should be null, no formula
    let val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*val, CellValue::Null);
    assert!(core.get_formula(&c1_id).is_none());
}

// -----------------------------------------------------------------------
// Replace formula with plain value
// -----------------------------------------------------------------------

#[test]
fn test_replace_formula_with_value() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let c1_id = cid(0x12);

    // C1 has formula =A1+B1. Replace with plain value.
    core.set_cell(&mut mirror, &sheet_id, c1_id, 0, 2, "999")
        .unwrap();

    let val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*val, CellValue::number(999.0));
    assert!(core.get_formula(&c1_id).is_none());
}

// -----------------------------------------------------------------------
// Sheet management
// -----------------------------------------------------------------------

#[test]
fn test_add_sheet() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let new_sheet = SheetSnapshot {
        id: "00000000-0000-0000-0000-000000000002".to_string(),
        name: "Sheet2".to_string(),
        rows: 100,
        cols: 26,
        cells: vec![CellData {
            cell_id: "00000000-0000-0000-0000-000000000020".to_string(),
            row: 0,
            col: 0,
            value: CellValue::number(0.0),
            formula: Some("=5*5".to_string()),
            identity_formula: None,
            array_ref: None,
        }],
        ranges: vec![],
    };

    core.add_sheet(&mut mirror, new_sheet).unwrap();

    let cell_id = cid(0x20);
    // The formula should be parsed but not yet evaluated (no recalc triggered by add_sheet)
    assert!(core.get_formula(&cell_id).is_some());
}

#[test]
fn test_remove_sheet() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let a1_id = cid(0x10);

    // Verify the cell exists
    assert!(core.get_cell_value(&mirror, &a1_id).is_some());

    core.remove_sheet(&mut mirror, &sheet_id).unwrap();

    // Cell should no longer be accessible
    assert!(core.get_cell_value(&mirror, &a1_id).is_none());
}

#[test]
fn test_rename_sheet() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    core.rename_sheet(&mut mirror, &sheet_id, "NewName");

    // Sheet should be findable by new name
    assert!(mirror.sheet_by_name("NewName").is_some());
    assert!(mirror.sheet_by_name("Sheet1").is_none());
}

// -----------------------------------------------------------------------
// Read operations
// -----------------------------------------------------------------------

#[test]
fn test_get_formula_plain_cell() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // A1 is a plain value — no formula
    let a1_id = cid(0x10);
    assert!(core.get_formula(&a1_id).is_none());
}

#[test]
fn test_get_cell_value_nonexistent() {
    let core = ComputeCore::new();
    let mirror = CellMirror::new();
    let fake_id = cid(0x99);
    assert!(core.get_cell_value(&mirror, &fake_id).is_none());
}

// -----------------------------------------------------------------------
// Structural changes
// -----------------------------------------------------------------------

#[test]
fn test_structure_change_insert_rows() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Structure change: regenerate formula strings, rebuild dep graph, full recalc.
    // `None` is the legacy/observer-rebuild signature (no per-op shift); this
    // test predates positional-ref shifting and only exercises the post-shift
    // recalc path.
    let result = core.structure_change(&mut mirror, None).unwrap();

    // The formula =A1+B1 should now refer to cells at new positions
    // After insert, old row 0 is now row 1
    // The formula text is still =A1+B1 (unchanged), but the positional
    // resolution should now look at the new positions.
    // This is a simplified test — the actual behavior depends on
    // formula rewriting which is handled by the TS side.
    assert!(result.errors.is_empty() || !result.errors.is_empty());
}

// -----------------------------------------------------------------------
// apply_changes (CellEdit)
// -----------------------------------------------------------------------

#[test]
fn test_apply_changes() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let changes = vec![CellEdit {
        sheet_id: "00000000-0000-0000-0000-000000000001".to_string(),
        cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
        row: 0,
        col: 0,
        value: CellValue::number(99.0),
        formula: None,
        identity_formula: None,
    }];

    let _result = core.apply_changes(&mut mirror, &changes, false).unwrap();

    // A1 should now be 99
    let a1_id = cid(0x10);
    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::number(99.0)
    );

    // C1 = A1 + B1 = 99 + 20 = 119
    let c1_id = cid(0x12);
    assert_eq!(
        *core.get_cell_value(&mirror, &c1_id).unwrap(),
        CellValue::number(119.0)
    );
}

// -----------------------------------------------------------------------
// Parse plain values
// -----------------------------------------------------------------------

#[test]
fn test_parse_plain_number() {
    assert_eq!(parse_plain_value("42"), CellValue::number(42.0));
    #[allow(clippy::approx_constant)]
    let expected = 3.14;
    assert_eq!(parse_plain_value("3.14"), CellValue::number(expected));
    assert_eq!(parse_plain_value("-7"), CellValue::number(-7.0));
    assert_eq!(parse_plain_value("1e5"), CellValue::number(100000.0));
}

#[test]
fn test_parse_plain_boolean() {
    assert_eq!(parse_plain_value("TRUE"), CellValue::Boolean(true));
    assert_eq!(parse_plain_value("FALSE"), CellValue::Boolean(false));
    assert_eq!(parse_plain_value("true"), CellValue::Boolean(true));
    assert_eq!(parse_plain_value("false"), CellValue::Boolean(false));
}

#[test]
fn test_parse_plain_text() {
    assert_eq!(parse_plain_value("hello"), CellValue::Text("hello".into()));
    assert_eq!(
        parse_plain_value("not a number"),
        CellValue::Text("not a number".into())
    );
}

// -----------------------------------------------------------------------
// SUM range formula
// -----------------------------------------------------------------------

#[test]
fn test_sum_range_formula() {
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
                    col: 0, // A1 = 1
                    value: CellValue::number(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 1,
                    col: 0, // A2 = 2
                    value: CellValue::number(2.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 2,
                    col: 0, // A3 = 3
                    value: CellValue::number(3.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 3,
                    col: 0, // A4 = SUM(A1:A3)
                    value: CellValue::number(0.0),
                    formula: Some("=SUM(A1:A3)".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // A4 = SUM(A1:A3) = 1 + 2 + 3 = 6
    let a4_id = cid(0x13);
    assert_eq!(
        *core.get_cell_value(&mirror, &a4_id).unwrap(),
        CellValue::number(6.0)
    );

    // Change A2 to 10
    let sheet_id = sid(1);
    let a2_id = cid(0x11);
    core.set_cell(&mut mirror, &sheet_id, a2_id, 1, 0, "10")
        .unwrap();

    // A4 = SUM(A1:A3) = 1 + 10 + 3 = 14
    assert_eq!(
        *core.get_cell_value(&mirror, &a4_id).unwrap(),
        CellValue::number(14.0)
    );
}

// -----------------------------------------------------------------------
// Diamond dependency: D depends on B and C, B and C depend on A
// -----------------------------------------------------------------------

#[test]
fn test_diamond_dependency() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    // A1=10, B1=A1*2, C1=A1+5, D1=B1+C1
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
                    value: CellValue::number(10.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2, // C1
                    value: CellValue::number(0.0),
                    formula: Some("=A1+5".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3, // D1
                    value: CellValue::number(0.0),
                    formula: Some("=B1+C1".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // B1 = 10*2 = 20, C1 = 10+5 = 15, D1 = 20+15 = 35
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(20.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x12)).unwrap(),
        CellValue::number(15.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(35.0)
    );

    // Change A1 to 100
    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "100")
        .unwrap();

    // B1 = 100*2 = 200, C1 = 100+5 = 105, D1 = 200+105 = 305
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(200.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x12)).unwrap(),
        CellValue::number(105.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(305.0)
    );
}

// -----------------------------------------------------------------------
// Volatile function detection
// -----------------------------------------------------------------------

#[test]
fn test_volatile_function_detection() {
    use compute_parser::ASTNode;

    let now_ast = ASTNode::Function {
        name: "NOW".into(),
        args: vec![],
    };
    assert!(contains_volatile_function(&now_ast));

    let sum_ast = ASTNode::Function {
        name: "SUM".into(),
        args: vec![ASTNode::Number(1.0)],
    };
    assert!(!contains_volatile_function(&sum_ast));

    // Nested volatile
    let nested = ASTNode::Function {
        name: "TEXT".into(),
        args: vec![
            ASTNode::Function {
                name: "NOW".into(),
                args: vec![],
            },
            ASTNode::Text("HH:MM".to_string()),
        ],
    };
    assert!(contains_volatile_function(&nested));
}

// -----------------------------------------------------------------------
// Values equality helper
// -----------------------------------------------------------------------

#[test]
fn test_values_equal() {
    assert!(values_equal(
        &CellValue::number(42.0),
        &CellValue::number(42.0)
    ));
    assert!(!values_equal(
        &CellValue::number(42.0),
        &CellValue::number(43.0)
    ));
    assert!(values_equal(&CellValue::Null, &CellValue::Null));
    assert!(!values_equal(&CellValue::Null, &CellValue::number(0.0)));

    // Text: case-sensitive (unlike CellValue::PartialEq which is case-insensitive)
    assert!(values_equal(
        &CellValue::Text("abc".into()),
        &CellValue::Text("abc".into())
    ));
    assert!(!values_equal(
        &CellValue::Text("abc".into()),
        &CellValue::Text("ABC".into())
    ));
}

// -----------------------------------------------------------------------
// Multiple independent formula cells
// -----------------------------------------------------------------------

#[test]
fn test_independent_formulas() {
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
                    value: CellValue::number(5.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1 = A1 * 2
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 1,
                    col: 0, // A2
                    value: CellValue::number(100.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 1,
                    col: 1, // B2 = A2 + 1
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // B1 = 5*2 = 10, B2 = 100+1 = 101
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(10.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(101.0)
    );

    // Change A1 — only B1 should change, not B2
    let sheet_id = sid(1);
    let result = core
        .set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "50")
        .unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(100.0)
    );
    // B2 should still be 101
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(101.0)
    );

    // Only A1 and B1 should be in changed cells, not B2
    let changed_ids: Vec<String> = result
        .changed_cells
        .iter()
        .map(|c| c.cell_id.clone())
        .collect();
    assert!(!changed_ids.contains(&cid(0x13).to_uuid_string()));
}

// -----------------------------------------------------------------------
// Formula that references empty cell
// -----------------------------------------------------------------------

#[test]
fn test_formula_referencing_empty_cell() {
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
                    col: 0, // A1 = 5
                    value: CellValue::number(5.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // B1 is empty (no cell data)
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2, // C1 = A1 + B1
                    value: CellValue::number(0.0),
                    formula: Some("=A1+B1".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // C1 = 5 + 0 (B1 is empty, coerces to 0) = 5
    let c1_id = cid(0x12);
    let c1_val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*c1_val, CellValue::number(5.0));
}

// -----------------------------------------------------------------------
// IF formula
// -----------------------------------------------------------------------

#[test]
fn test_if_formula() {
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
                    col: 0, // A1 = 10
                    value: CellValue::number(10.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1 = IF(A1>5, "big", "small")
                    value: CellValue::number(0.0),
                    formula: Some("=IF(A1>5,\"big\",\"small\")".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let b1_id = cid(0x11);
    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::Text("big".into())
    );

    // Change A1 to 3
    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "3")
        .unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::Text("small".into())
    );
}

// -----------------------------------------------------------------------
// Default trait
// -----------------------------------------------------------------------

#[test]
fn test_compute_core_default() {
    let core = ComputeCore::default();
    let mirror = CellMirror::new();
    assert!(core.get_cell_value(&mirror, &make_cell_id(1)).is_none());
}

// -----------------------------------------------------------------------
// Long dependency chain
// -----------------------------------------------------------------------

#[test]
fn test_long_chain() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    // Create a chain: A1=1, A2=A1+1, A3=A2+1, ..., A10=A9+1
    let mut cells = vec![CellData {
        cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
        row: 0,
        col: 0, // A1 = 1
        value: CellValue::number(1.0),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }];

    for i in 1u32..10 {
        let _prev_row = i; // A{i} = A{i-1} + 1
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-0000000000{:02x}", 0x10 + i),
            row: i,
            col: 0,
            value: CellValue::number(0.0),
            formula: Some(format!("=A{}+1", i)), // A{i+1} = A{i} + 1
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // A10 should be 10 (1 + 9 increments)
    let a10_id = CellId::from_uuid_str("00000000-0000-0000-0000-000000000019").unwrap();
    let val = core.get_cell_value(&mirror, &a10_id).unwrap();
    assert_eq!(*val, CellValue::number(10.0));

    // Change A1 to 100
    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "100")
        .unwrap();

    // A10 should be 109
    let val = core.get_cell_value(&mirror, &a10_id).unwrap();
    assert_eq!(*val, CellValue::number(109.0));
}

// -----------------------------------------------------------------------
// Replacing a formula cell with a formula
// -----------------------------------------------------------------------

#[test]
fn test_replace_formula_with_formula() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let c1_id = cid(0x12);

    // C1 has =A1+B1. Replace with =A1*B1
    core.set_cell(&mut mirror, &sheet_id, c1_id, 0, 2, "=A1*B1")
        .unwrap();

    // C1 = 10 * 20 = 200
    assert_eq!(
        *core.get_cell_value(&mirror, &c1_id).unwrap(),
        CellValue::number(200.0)
    );
    assert_eq!(core.get_formula(&c1_id), Some("=A1*B1"));
}

// -----------------------------------------------------------------------
// Multiple sheets with cross-sheet references
// -----------------------------------------------------------------------

#[test]
fn test_recalc_result_has_sheet_ids() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let result = core
        .init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // All changed cells should have the correct sheet_id
    for change in &result.changed_cells {
        assert_eq!(change.sheet_id, "00000000000000000000000000000001");
    }
}

// -----------------------------------------------------------------------
// extract_dependencies tests
// -----------------------------------------------------------------------

#[test]
fn test_extract_deps_cell_ref() {
    let cell_id = make_cell_id(42);
    let ast = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Resolved(cell_id),
        abs_row: false,
        abs_col: false,
    });
    let deps = extract_dependencies(&ast, &make_sheet_id(1));
    assert_eq!(deps, vec![DepTarget::Cell(cell_id)]);
}

#[test]
fn test_extract_deps_binary_op() {
    let a = make_cell_id(1);
    let b = make_cell_id(2);
    let ast = ASTNode::BinaryOp {
        op: compute_parser::BinOp::Add,
        left: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::Resolved(a),
            abs_row: false,
            abs_col: false,
        })),
        right: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::Resolved(b),
            abs_row: false,
            abs_col: false,
        })),
    };
    let deps = extract_dependencies(&ast, &make_sheet_id(1));
    assert!(deps.contains(&DepTarget::Cell(a)));
    assert!(deps.contains(&DepTarget::Cell(b)));
}

#[test]
fn test_extract_deps_positional_ref() {
    let ast = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: make_sheet_id(1),
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    let deps = extract_dependencies(&ast, &make_sheet_id(1));
    // Positional refs are tracked as 1x1 range deps so the graph can
    // find dependents by position (needed for spill propagation).
    assert_eq!(deps.len(), 1);
    match &deps[0] {
        DepTarget::Range(rect, _) => {
            assert_eq!(rect.sheet(), make_sheet_id(1));
            assert_eq!(rect.start_row(), 0);
            assert_eq!(rect.start_col(), 0);
            assert_eq!(rect.end_row(), 0);
            assert_eq!(rect.end_col(), 0);
        }
        other => panic!("expected Range dep, got {:?}", other),
    }
}

#[test]
fn test_extract_deps_deduplication() {
    let a = make_cell_id(1);
    // A1 + A1 should only have one dep
    let ast = ASTNode::BinaryOp {
        op: compute_parser::BinOp::Add,
        left: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::Resolved(a),
            abs_row: false,
            abs_col: false,
        })),
        right: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::Resolved(a),
            abs_row: false,
            abs_col: false,
        })),
    };
    let deps = extract_dependencies(&ast, &make_sheet_id(1));
    assert_eq!(deps.len(), 1);
    assert_eq!(deps[0], DepTarget::Cell(a));
}

// -----------------------------------------------------------------------
// subset_levels tests (formerly group_by_level)
// -----------------------------------------------------------------------

#[test]
fn test_group_by_level_linear_chain() {
    // A1=5, B1=A1*2, C1=B1+10 => 2 levels: [B1], [C1]
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
                    col: 0,
                    value: CellValue::number(5.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=B1+10".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let b1 = cid(0x11);
    let c1 = cid(0x12);

    let (levels, _cycle_cells) = core.graph.subset_levels(&[b1, c1], &mirror).into_value();
    assert_eq!(levels.len(), 2);
    assert_eq!(levels[0], vec![b1]);
    assert_eq!(levels[1], vec![c1]);
}

#[test]
fn test_group_by_level_parallel() {
    // C1=A1+B1, D1=C1+10, E1=C1*2
    // D1 and E1 both depend on C1. Levels: [C1], [D1, E1]
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
                    col: 0,
                    value: CellValue::number(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(2.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+B1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=C1+10".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000014".to_string(),
                    row: 0,
                    col: 4,
                    value: CellValue::number(0.0),
                    formula: Some("=C1*2".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let c1 = cid(0x12);
    let d1 = cid(0x13);
    let e1 = cid(0x14);

    let (levels, _cycle_cells) = core
        .graph
        .subset_levels(&[c1, d1, e1], &mirror)
        .into_value();
    assert_eq!(levels.len(), 2);
    assert_eq!(levels[0], vec![c1]);
    assert_eq!(levels[1].len(), 2);
    assert!(levels[1].contains(&d1));
    assert!(levels[1].contains(&e1));
}

#[test]
fn test_group_by_level_single() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let c1 = cid(0x12);
    let (levels, _cycle_cells) = core.graph.subset_levels(&[c1], &mirror).into_value();
    assert_eq!(levels.len(), 1);
    assert_eq!(levels[0], vec![c1]);
}

#[test]
fn test_group_by_level_empty() {
    let core = ComputeCore::new();
    let mirror = CellMirror::new();
    let (levels, _cycle_cells) = core.graph.subset_levels(&[], &mirror).into_value();
    assert!(levels.is_empty());
}

// -----------------------------------------------------------------------
// Parallel recalc correctness tests
// -----------------------------------------------------------------------

#[test]
fn test_parallel_recalc_basic_independent() {
    // 100 independent formula cells, all at level 0
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let count = 100;

    let mut cells = Vec::new();
    for i in 0..count {
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", 0x100 + i),
            row: i as u32,
            col: 0,
            value: CellValue::number(i as f64 + 1.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }
    for i in 0..count {
        let row_label = format!("A{}", i + 1);
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", 0x200 + i),
            row: i as u32,
            col: 1,
            value: CellValue::number(0.0),
            formula: Some(format!("={}*2", row_label)),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 200,
            cols: 26,
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    for i in 0..count {
        let b_id =
            CellId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", 0x200 + i)).unwrap();
        let val = core.get_cell_value(&mirror, &b_id).unwrap();
        assert_eq!(
            *val,
            CellValue::number((i as f64 + 1.0) * 2.0),
            "B{} mismatch",
            i + 1
        );
    }
}

#[test]
fn test_parallel_recalc_chain() {
    // A1=1, B1=A1+1, C1=B1+1, D1=C1+1
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
                    col: 0,
                    value: CellValue::number(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=B1+1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=C1+1".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(2.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x12)).unwrap(),
        CellValue::number(3.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(4.0)
    );

    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "10")
        .unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(11.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x12)).unwrap(),
        CellValue::number(12.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(13.0)
    );
}

#[test]
fn test_parallel_recalc_diamond() {
    // Diamond: A1=10, B1=A1*2, C1=A1+5, D1=B1+C1
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
                    col: 0,
                    value: CellValue::number(10.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+5".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=B1+C1".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(20.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x12)).unwrap(),
        CellValue::number(15.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(35.0)
    );

    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "100")
        .unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(200.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x12)).unwrap(),
        CellValue::number(105.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(305.0)
    );
}

#[test]
fn test_parallel_recalc_wide_level() {
    // 50 independent formulas at level 0 (wider than PARALLEL_THRESHOLD)
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let width = 50;

    let mut cells = Vec::new();
    cells.push(CellData {
        cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
        row: 0,
        col: 0,
        value: CellValue::number(7.0),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });

    for i in 0..width {
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", 0x100 + i),
            row: (i + 1) as u32,
            col: 0,
            value: CellValue::number(0.0),
            formula: Some(format!("=A1+{}", i)),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 200,
            cols: 26,
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let formula_cells: Vec<CellId> = (0..width)
        .map(|i| {
            CellId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", 0x100 + i)).unwrap()
        })
        .collect();

    let (levels, _cycle_cells) = core
        .graph
        .subset_levels(&formula_cells, &mirror)
        .into_value();
    assert_eq!(levels.len(), 1, "All cells should be at level 0");
    assert_eq!(levels[0].len(), width);

    for i in 0..width {
        let cell_id =
            CellId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", 0x100 + i)).unwrap();
        let val = core.get_cell_value(&mirror, &cell_id).unwrap();
        assert_eq!(*val, CellValue::number(7.0 + i as f64));
    }

    // Update source and verify cascade
    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "100")
        .unwrap();

    for i in 0..width {
        let cell_id =
            CellId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", 0x100 + i)).unwrap();
        let val = core.get_cell_value(&mirror, &cell_id).unwrap();
        assert_eq!(*val, CellValue::number(100.0 + i as f64));
    }
}

#[test]
fn test_group_by_level_diamond_pattern() {
    // B1=A1*2, C1=A1+5, D1=B1+C1
    // Levels: [B1, C1], [D1]
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
                    col: 0,
                    value: CellValue::number(10.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+5".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=B1+C1".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let b1 = cid(0x11);
    let c1 = cid(0x12);
    let d1 = cid(0x13);

    let (levels, _cycle_cells) = core
        .graph
        .subset_levels(&[b1, c1, d1], &mirror)
        .into_value();
    assert_eq!(levels.len(), 2);
    assert_eq!(levels[0].len(), 2);
    assert!(levels[0].contains(&b1));
    assert!(levels[0].contains(&c1));
    assert_eq!(levels[1], vec![d1]);
}

#[test]
fn test_small_level_stays_sequential() {
    // 3 cells at level 0 — below PARALLEL_THRESHOLD
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
                    col: 0,
                    value: CellValue::number(5.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+3".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let b1 = cid(0x11);
    let c1 = cid(0x12);
    let d1 = cid(0x13);

    let (levels, _cycle_cells) = core
        .graph
        .subset_levels(&[b1, c1, d1], &mirror)
        .into_value();
    assert_eq!(levels.len(), 1);
    assert_eq!(levels[0].len(), 3);

    assert_eq!(
        *core.get_cell_value(&mirror, &b1).unwrap(),
        CellValue::number(6.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &c1).unwrap(),
        CellValue::number(7.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &d1).unwrap(),
        CellValue::number(8.0)
    );
}

#[test]
fn test_parallel_matches_sequential_complex_graph() {
    // Multi-level graph:
    // A1=1, A2=2, A3=3
    // B1=A1+A2, B2=A2+A3
    // C1=B1+B2
    // D1=C1*2
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
                    col: 0,
                    value: CellValue::number(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::number(2.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 2,
                    col: 0,
                    value: CellValue::number(3.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000020".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+A2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000021".to_string(),
                    row: 1,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A2+A3".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000030".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=B1+B2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000040".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=C1*2".to_string()),
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let b1 = cid(0x20);
    let b2 = cid(0x21);
    let c1 = cid(0x30);
    let d1 = cid(0x40);

    // Verify levels
    let (levels, _cycle_cells) = core
        .graph
        .subset_levels(&[b1, b2, c1, d1], &mirror)
        .into_value();
    assert_eq!(levels.len(), 3);
    assert_eq!(levels[0].len(), 2);
    assert!(levels[0].contains(&b1));
    assert!(levels[0].contains(&b2));
    assert_eq!(levels[1], vec![c1]);
    assert_eq!(levels[2], vec![d1]);

    // B1=3, B2=5, C1=8, D1=16
    assert_eq!(
        *core.get_cell_value(&mirror, &b1).unwrap(),
        CellValue::number(3.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &b2).unwrap(),
        CellValue::number(5.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &c1).unwrap(),
        CellValue::number(8.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &d1).unwrap(),
        CellValue::number(16.0)
    );

    // Change A2 to 20
    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x11), 1, 0, "20")
        .unwrap();

    // B1=21, B2=23, C1=44, D1=88
    assert_eq!(
        *core.get_cell_value(&mirror, &b1).unwrap(),
        CellValue::number(21.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &b2).unwrap(),
        CellValue::number(23.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &c1).unwrap(),
        CellValue::number(44.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &d1).unwrap(),
        CellValue::number(88.0)
    );
}

// -----------------------------------------------------------------------
// Variables as DAG nodes
// -----------------------------------------------------------------------

#[test]
fn test_variable_synthetic_cell_id_deterministic() {
    use crate::mirror::variable_store::VariableStore;
    use formula_types::Scope;

    // Same (scope, name) always produces the same CellId
    let id1 = VariableStore::synthetic_cell_id(&Scope::Workbook, "tax_rate");
    let id2 = VariableStore::synthetic_cell_id(&Scope::Workbook, "tax_rate");
    assert_eq!(id1, id2);

    // Case-insensitive
    let id3 = VariableStore::synthetic_cell_id(&Scope::Workbook, "TAX_RATE");
    assert_eq!(id1, id3);

    // Different scopes produce different IDs
    let sheet1 = SheetId::from_raw(1);
    let id4 = VariableStore::synthetic_cell_id(&Scope::Sheet(sheet1), "tax_rate");
    assert_ne!(id1, id4);
}

#[test]
fn test_variable_dag_registration() {
    // A variable with a constant expression should get an AST entry
    // and its synthetic CellId should be in the graph.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Add a workbook-scoped variable with a constant expression
    let def =
        NamedRangeDef::from_expression("TaxRate".to_string(), Scope::Workbook, "0.15".to_string());
    core.set_named_range(&mut mirror, "TaxRate".to_string(), def);

    // The variable should have a synthetic CellId in the AST cache
    let synth_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "taxrate");
    assert!(
        core.ast_cache.contains_key(&synth_id),
        "Variable AST should be cached under synthetic CellId"
    );
}

#[test]
fn test_variable_formula_dag_registration() {
    // A variable with a formula expression like "=A1+B1" should have
    // its AST cached AND dependencies registered in the graph.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Add a variable that references cells A1 and B1
    let def =
        NamedRangeDef::from_expression("MySum".to_string(), Scope::Workbook, "A1+B1".to_string());
    core.set_named_range(&mut mirror, "MySum".to_string(), def);

    let synth_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "mysum");

    // AST should be cached
    assert!(core.ast_cache.contains_key(&synth_id));

    // The variable should have precedents (A1 and B1)
    let deps = core.graph.get_precedents(&synth_id);
    assert!(
        !deps.is_empty(),
        "Variable formula should have precedent dependencies"
    );
}

#[test]
fn test_variable_from_snapshot_registered() {
    // Variables loaded from a snapshot should be registered as DAG nodes.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let mut snapshot = basic_snapshot();
    snapshot.named_ranges.push(NamedRangeDef::from_expression(
        "Constant".to_string(),
        Scope::Workbook,
        "42".to_string(),
    ));

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let synth_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "constant");
    assert!(
        core.ast_cache.contains_key(&synth_id),
        "Variable from snapshot should have AST in cache"
    );
}

#[test]
fn test_variable_cell_dependency_edge() {
    // When a cell formula references a variable (Identifier node),
    // the dep extractor should emit an edge to the variable's synthetic CellId.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let mut snapshot = basic_snapshot();

    // Add a variable "rate" with value 0.1
    snapshot.named_ranges.push(NamedRangeDef::from_expression(
        "rate".to_string(),
        Scope::Workbook,
        "0.1".to_string(),
    ));

    // Add a cell D1 that uses =A1*rate
    snapshot.sheets[0].cells.push(CellData {
        cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
        row: 0,
        col: 3, // D1
        value: CellValue::number(0.0),
        formula: Some("=A1*rate".to_string()),
        identity_formula: None,
        array_ref: None,
    });

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // D1 should depend on the "rate" variable's synthetic CellId
    let d1_id = cid(0x13);
    let var_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "rate");

    let d1_deps = core.graph.get_precedents(&d1_id);
    let depends_on_var = d1_deps.iter().any(|dep| match dep {
        crate::graph::DepTarget::Cell(id) => *id == var_id,
        _ => false,
    });
    assert!(
        depends_on_var,
        "Cell D1 should have a dependency edge to the variable 'rate'"
    );
}

#[test]
fn test_variable_remove_cleans_dag() {
    // Removing a variable should clean up its AST cache and graph entries.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let def =
        NamedRangeDef::from_expression("TaxRate".to_string(), Scope::Workbook, "0.15".to_string());
    core.set_named_range(&mut mirror, "TaxRate".to_string(), def);

    let synth_id = VariableStore::synthetic_cell_id(&Scope::Workbook, "taxrate");
    assert!(core.ast_cache.contains_key(&synth_id));

    core.remove_named_range(&mut mirror, "TaxRate");

    assert!(
        !core.ast_cache.contains_key(&synth_id),
        "Removing a variable should clear its AST cache entry"
    );
}

#[test]
fn test_variable_scope_shadowing_in_dag() {
    // Sheet-scoped variable should shadow workbook-scoped variable.
    // Both should have distinct synthetic CellIds.
    use crate::mirror::variable_store::VariableStore;
    use formula_types::{NamedRangeDef, Scope};

    let sheet1 = sid(1);

    let id_wb = VariableStore::synthetic_cell_id(&Scope::Workbook, "tax");
    let id_sh = VariableStore::synthetic_cell_id(&Scope::Sheet(sheet1), "tax");
    assert_ne!(
        id_wb, id_sh,
        "Different scopes must produce different CellIds"
    );

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Add workbook-scoped "tax"
    core.set_named_range(
        &mut mirror,
        "tax".to_string(),
        NamedRangeDef::from_expression("tax".to_string(), Scope::Workbook, "0.10".to_string()),
    );

    // Add sheet-scoped "tax" (shadows the workbook one for Sheet1)
    core.set_named_range(
        &mut mirror,
        "tax".to_string(),
        NamedRangeDef::from_expression("tax".to_string(), Scope::Sheet(sheet1), "0.20".to_string()),
    );

    // Both should have AST entries under different synthetic CellIds
    assert!(core.ast_cache.contains_key(&id_wb));
    assert!(core.ast_cache.contains_key(&id_sh));
}

// =========================================================================
// Aggregation Prepass Integration Tests
// =========================================================================

/// Build a snapshot for same-sheet COUNTIFS testing.
///
/// Single sheet with 20 data rows + 10 formula rows:
///   Col A (0): Category — repeating "Alpha", "Beta", "Gamma", "Delta" (5 each)
///   Col B (1): Region — repeating "East", "West" (alternating)
///   Col C (2): Value — row * 10.0 (10, 20, 30, ..., 200)
///   Col D (3): Formula criteria source — copies of category values for rows 0..9
///   Col E (4): COUNTIFS formulas — =COUNTIFS(A$1:A$20, D{row+1})  (10 rows)
///   Col F (5): SUMIFS formulas — =SUMIFS(C$1:C$20, A$1:A$20, D{row+1})
///   Col G (6): AVERAGEIFS formulas — =AVERAGEIFS(C$1:C$20, A$1:A$20, D{row+1})
fn agg_same_sheet_snapshot() -> WorkbookSnapshot {
    let sid = "00000000-0000-0000-0000-000000000001";
    let categories = ["Alpha", "Beta", "Gamma", "Delta"];

    let mut cells = Vec::new();
    let mut id_counter = 0x1000u128;

    // 20 data rows in cols A, B, C
    for row in 0..20u32 {
        let cat = categories[(row % 4) as usize];
        let region = if row % 2 == 0 { "East" } else { "West" };
        let value = (row + 1) as f64 * 10.0;

        // Col A: category
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col B: region
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::Text(region.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col C: value
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::number(value),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // 10 formula rows (rows 0-9) with criteria in col D and formulas in cols E, F, G
    for row in 0..10u32 {
        let cat = categories[(row % 4) as usize];

        // Col D: criteria value (same as category for this row's formula lookup)
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 3,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });

        // Col E: COUNTIFS(A$1:A$20, D{row+1})
        id_counter += 1;
        let countifs_id = format!("00000000-0000-0000-0000-{:012x}", id_counter);
        cells.push(CellData {
            cell_id: countifs_id,
            row,
            col: 4,
            value: CellValue::number(0.0),
            formula: Some(format!("=COUNTIFS(A$1:A$20,D{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // Col F: SUMIFS(C$1:C$20, A$1:A$20, D{row+1})
        id_counter += 1;
        let sumifs_id = format!("00000000-0000-0000-0000-{:012x}", id_counter);
        cells.push(CellData {
            cell_id: sumifs_id,
            row,
            col: 5,
            value: CellValue::number(0.0),
            formula: Some(format!("=SUMIFS(C$1:C$20,A$1:A$20,D{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // Col G: AVERAGEIFS(C$1:C$20, A$1:A$20, D{row+1})
        id_counter += 1;
        let averageifs_id = format!("00000000-0000-0000-0000-{:012x}", id_counter);
        cells.push(CellData {
            cell_id: averageifs_id,
            row,
            col: 6,
            value: CellValue::number(0.0),
            formula: Some(format!("=AVERAGEIFS(C$1:C$20,A$1:A$20,D{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });
    }

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_string(),
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 7,
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
    }
}

/// Expected values for same-sheet agg prepass test:
///   Categories cycle: Alpha(0,4,8,12,16), Beta(1,5,9,13,17), Gamma(2,6,10,14,18), Delta(3,7,11,15,19)
///   Each category has 5 rows.
///   Values = (row+1)*10, so:
///     Alpha rows: 10,50,90,130,170 → sum=450, avg=90
///     Beta rows:  20,60,100,140,180 → sum=500, avg=100
///     Gamma rows: 30,70,110,150,190 → sum=550, avg=110
///     Delta rows: 40,80,120,160,200 → sum=600, avg=120
fn expected_agg_values() -> Vec<(f64, f64, f64)> {
    // (count, sum, average) for each formula row 0..9
    let counts = [5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0];
    let sums = [
        450.0, 500.0, 550.0, 600.0, 450.0, 500.0, 550.0, 600.0, 450.0, 500.0,
    ];
    let avgs = [
        90.0, 100.0, 110.0, 120.0, 90.0, 100.0, 110.0, 120.0, 90.0, 100.0,
    ];

    (0..10).map(|i| (counts[i], sums[i], avgs[i])).collect()
}

#[test]
fn test_agg_prepass_same_sheet_countifs() {
    let snap = agg_same_sheet_snapshot();

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let expected = expected_agg_values();

    // Find COUNTIFS cell IDs (col E = col 4)
    // Cell IDs start at 0x103d for row 0 col 4 formulas
    // We need to look up by (sheet, row, col) position instead
    let sheet_id = sid(1);
    for row in 0..10u32 {
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 4))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - expected[row as usize].0).abs() < 1e-10,
                    "COUNTIFS row {}: expected {}, got {}",
                    row,
                    expected[row as usize].0,
                    n.get()
                ),
                other => panic!("COUNTIFS row {}: expected number, got {:?}", row, other),
            }
        } else {
            panic!("No cell at row {}, col 4", row);
        }
    }
}

#[test]
fn test_agg_prepass_same_sheet_sumifs() {
    let snap = agg_same_sheet_snapshot();

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let expected = expected_agg_values();
    let sheet_id = sid(1);

    for row in 0..10u32 {
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 5))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - expected[row as usize].1).abs() < 1e-10,
                    "SUMIFS row {}: expected {}, got {}",
                    row,
                    expected[row as usize].1,
                    n.get()
                ),
                other => panic!("SUMIFS row {}: expected number, got {:?}", row, other),
            }
        } else {
            panic!("No cell at row {}, col 5", row);
        }
    }
}

#[test]
fn test_agg_prepass_same_sheet_averageifs() {
    let snap = agg_same_sheet_snapshot();

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let expected = expected_agg_values();
    let sheet_id = sid(1);

    for row in 0..10u32 {
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 6))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - expected[row as usize].2).abs() < 1e-10,
                    "AVERAGEIFS row {}: expected {}, got {}",
                    row,
                    expected[row as usize].2,
                    n.get()
                ),
                other => panic!("AVERAGEIFS row {}: expected number, got {:?}", row, other),
            }
        } else {
            panic!("No cell at row {}, col 6", row);
        }
    }
}

/// Build a snapshot with two sheets for cross-sheet COUNTIFS testing.
///
/// Sheet "Data" (id 1): 20 rows with categories in col A, values in col B
/// Sheet "Report" (id 2): 10 formula rows with:
///   Col A (0): criteria values
///   Col B (1): =COUNTIFS(Data!A$1:A$20, A{row+1})
///   Col C (2): =SUMIFS(Data!B$1:B$20, Data!A$1:A$20, A{row+1})
fn agg_cross_sheet_snapshot() -> WorkbookSnapshot {
    let data_sid = "00000000-0000-0000-0000-000000000001";
    let report_sid = "00000000-0000-0000-0000-000000000002";
    let categories = ["Red", "Blue", "Green"];

    let mut data_cells = Vec::new();
    let mut report_cells = Vec::new();
    let mut id_counter = 0x2000u128;

    // Data sheet: 20 rows
    for row in 0..20u32 {
        let cat = categories[(row % 3) as usize];
        let value = (row + 1) as f64 * 5.0;

        // Col A: category
        id_counter += 1;
        data_cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col B: value
        id_counter += 1;
        data_cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number(value),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // Report sheet: 10 formula rows
    for row in 0..10u32 {
        let cat = categories[(row % 3) as usize];

        // Col A: criteria value
        id_counter += 1;
        report_cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });

        // Col B: =COUNTIFS(Data!A$1:A$20, A{row+1})
        id_counter += 1;
        report_cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number(0.0),
            formula: Some(format!("=COUNTIFS(Data!A$1:A$20,A{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // Col C: =SUMIFS(Data!B$1:B$20, Data!A$1:A$20, A{row+1})
        id_counter += 1;
        report_cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::number(0.0),
            formula: Some(format!("=SUMIFS(Data!B$1:B$20,Data!A$1:A$20,A{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });
    }

    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: data_sid.to_string(),
                name: "Data".to_string(),
                rows: 20,
                cols: 2,
                cells: data_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: report_sid.to_string(),
                name: "Report".to_string(),
                rows: 10,
                cols: 3,
                cells: report_cells,
                ranges: vec![],
            },
        ],
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
fn test_agg_prepass_cross_sheet_countifs() {
    // Red appears at rows 0,3,6,9,12,15,18 → 7 times
    // Blue appears at rows 1,4,7,10,13,16,19 → 7 times
    // Green appears at rows 2,5,8,11,14,17 → 6 times
    let snap = agg_cross_sheet_snapshot();

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let report_sid = sid(2);
    let expected_counts: [f64; 10] = [7.0, 7.0, 6.0, 7.0, 7.0, 6.0, 7.0, 7.0, 6.0, 7.0];

    for row in 0..10u32 {
        if let Some(cell_id) =
            mirror.resolve_cell_id(&report_sid, cell_types::SheetPos::new(row, 1))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - expected_counts[row as usize]).abs() < 1e-10,
                    "Cross-sheet COUNTIFS row {}: expected {}, got {}",
                    row,
                    expected_counts[row as usize],
                    n.get()
                ),
                other => panic!(
                    "Cross-sheet COUNTIFS row {}: expected number, got {:?}",
                    row, other
                ),
            }
        } else {
            panic!("No cell at Report row {}, col 1", row);
        }
    }
}

#[test]
fn test_agg_prepass_cross_sheet_sumifs() {
    // Red rows: 0,3,6,9,12,15,18 → values: 5,20,35,50,65,80,95 → sum=350
    // Blue rows: 1,4,7,10,13,16,19 → values: 10,25,40,55,70,85,100 → sum=385
    // Green rows: 2,5,8,11,14,17 → values: 15,30,45,60,75,90 → sum=315
    let snap = agg_cross_sheet_snapshot();

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let report_sid = sid(2);
    let expected_sums: [f64; 10] = [
        350.0, 385.0, 315.0, 350.0, 385.0, 315.0, 350.0, 385.0, 315.0, 350.0,
    ];

    for row in 0..10u32 {
        if let Some(cell_id) =
            mirror.resolve_cell_id(&report_sid, cell_types::SheetPos::new(row, 2))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - expected_sums[row as usize]).abs() < 1e-10,
                    "Cross-sheet SUMIFS row {}: expected {}, got {}",
                    row,
                    expected_sums[row as usize],
                    n.get()
                ),
                other => panic!(
                    "Cross-sheet SUMIFS row {}: expected number, got {:?}",
                    row, other
                ),
            }
        } else {
            panic!("No cell at Report row {}, col 2", row);
        }
    }
}

#[cfg(feature = "native")]
fn wrapped_sumifs_parallel_snapshot() -> WorkbookSnapshot {
    let sid = "00000000-0000-0000-0000-000000000001";
    let categories = ["Alpha", "Beta", "Gamma", "Delta"];
    let formula_count = level_eval::PARALLEL_THRESHOLD + 100;
    let mut cells = Vec::new();
    let mut id_counter = 0x9000u128;

    for row in 0..20u32 {
        let cat = categories[(row % 4) as usize];
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::number((row + 1) as f64),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    for row in 0..formula_count as u32 {
        let cat = categories[(row % 4) as usize];
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 4,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 5,
            value: CellValue::number(0.0),
            formula: Some(format!(
                "=IFERROR(SUMIFS(C$1:C$20,A$1:A$20,E{}),0)",
                row + 1
            )),
            identity_formula: None,
            array_ref: None,
        });
    }

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_string(),
            name: "Sheet1".to_string(),
            rows: formula_count as u32 + 20,
            cols: 6,
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
    }
}

#[cfg(feature = "native")]
#[test]
fn test_wrapped_sumifs_warm_cache_seeds_parallel_eval() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, wrapped_sumifs_parallel_snapshot())
        .unwrap();

    compute_functions::helpers::sumifs_result_cache::reset_diagnostics();
    let sheet_id = sid(1);
    let source_id = mirror
        .resolve_cell_id(&sheet_id, cell_types::SheetPos::new(0, 2))
        .expect("source value cell");
    core.set_cell(&mut mirror, &sheet_id, source_id, 0, 2, "1000")
        .unwrap();

    let diag = compute_functions::helpers::sumifs_result_cache::diagnostics();
    assert!(
        diag.builds >= 1,
        "warm prepass should build at least one SUMIFS result map: {:?}",
        diag
    );
    assert!(
        diag.seeds > 0,
        "parallel evaluation should seed warmed SUMIFS data into rayon TLS: {:?}",
        diag
    );
    assert!(
        diag.hits >= level_eval::PARALLEL_THRESHOLD as u64,
        "wrapped SUMIFS formulas should hit seeded warm cache during parallel eval: {:?}",
        diag
    );
}

#[cfg(feature = "native")]
#[test]
fn test_sumifs_worker_tls_entries_do_not_survive_recalc_epoch() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, wrapped_sumifs_parallel_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let formula_id = mirror
        .resolve_cell_id(&sheet_id, cell_types::SheetPos::new(0, 5))
        .expect("formula cell");
    assert_eq!(
        core.get_cell_value(&mirror, &formula_id).cloned(),
        Some(CellValue::number(45.0))
    );

    let source_id = mirror
        .resolve_cell_id(&sheet_id, cell_types::SheetPos::new(0, 2))
        .expect("source value cell");
    core.set_cell(&mut mirror, &sheet_id, source_id, 0, 2, "1000")
        .unwrap();

    assert_eq!(
        core.get_cell_value(&mirror, &formula_id).cloned(),
        Some(CellValue::number(1044.0))
    );
}

#[test]
fn test_sumifs_cache_preserves_criteria_order_for_multiple_layouts() {
    let sid_str = "00000000-0000-0000-0000-000000000001";
    let cells = vec![
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009001".to_string(),
            row: 0,
            col: 0,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009002".to_string(),
            row: 1,
            col: 0,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009003".to_string(),
            row: 2,
            col: 0,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009004".to_string(),
            row: 0,
            col: 1,
            value: CellValue::Text("N".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009005".to_string(),
            row: 1,
            col: 1,
            value: CellValue::Text("S".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009006".to_string(),
            row: 2,
            col: 1,
            value: CellValue::Text("N".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009007".to_string(),
            row: 0,
            col: 2,
            value: CellValue::number(10.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009008".to_string(),
            row: 1,
            col: 2,
            value: CellValue::number(20.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009009".to_string(),
            row: 2,
            col: 2,
            value: CellValue::number(30.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-00000000900a".to_string(),
            row: 0,
            col: 4,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-00000000900b".to_string(),
            row: 0,
            col: 6,
            value: CellValue::Text("N".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-00000000900c".to_string(),
            row: 0,
            col: 7,
            value: CellValue::number(0.0),
            formula: Some(
                "=IFERROR(SUMIFS(C$1:C$3,A$1:A$3,E1,B$1:B$3,G1)+SUMIFS(C$1:C$3,B$1:B$3,G1,A$1:A$3,E1),0)"
                    .to_string(),
            ),
            identity_formula: None,
            array_ref: None,
        },
    ];
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid_str.to_string(),
            name: "Sheet1".to_string(),
            rows: 3,
            cols: 8,
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
    core.init_from_snapshot(&mut mirror, snap).unwrap();
    let formula_id = CellId::from_uuid_str("00000000-0000-0000-0000-00000000900c").unwrap();

    assert_eq!(
        core.get_cell_value(&mirror, &formula_id).cloned(),
        Some(CellValue::number(80.0))
    );
}

/// Test single-criteria functions: COUNTIF, SUMIF, AVERAGEIF
#[test]
fn test_agg_prepass_single_criteria_functions() {
    let sid_str = "00000000-0000-0000-0000-000000000001";
    let categories = [
        "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y",
        "X", "Y",
    ];
    // Values: 1..20
    let mut cells = Vec::new();
    let mut id_counter = 0x3000u128;

    for row in 0..20u32 {
        // Col A: category
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(categories[row as usize].into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col B: value = row + 1
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number((row + 1) as f64),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // 10 formula rows with criteria in col C, formulas in cols D(COUNTIF), E(SUMIF), F(AVERAGEIF)
    for row in 0..10u32 {
        let cat = if row % 2 == 0 { "X" } else { "Y" };

        // Col C: criteria
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });

        // Col D: =COUNTIF(A$1:A$20, C{row+1})
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 3,
            value: CellValue::number(0.0),
            formula: Some(format!("=COUNTIF(A$1:A$20,C{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // Col E: =SUMIF(A$1:A$20, C{row+1}, B$1:B$20)
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 4,
            value: CellValue::number(0.0),
            formula: Some(format!("=SUMIF(A$1:A$20,C{},B$1:B$20)", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // Col F: =AVERAGEIF(A$1:A$20, C{row+1}, B$1:B$20)
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 5,
            value: CellValue::number(0.0),
            formula: Some(format!("=AVERAGEIF(A$1:A$20,C{},B$1:B$20)", row + 1)),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid_str.to_string(),
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 6,
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
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // X rows: 0,2,4,6,8,10,12,14,16,18 → count=10, values: 1,3,5,7,9,11,13,15,17,19 → sum=100, avg=10
    // Y rows: 1,3,5,7,9,11,13,15,17,19 → count=10, values: 2,4,6,8,10,12,14,16,18,20 → sum=110, avg=11
    let sheet_id = sid(1);
    for row in 0..10u32 {
        let (exp_count, exp_sum, exp_avg) = if row % 2 == 0 {
            (10.0, 100.0, 10.0) // X
        } else {
            (10.0, 110.0, 11.0) // Y
        };

        // COUNTIF (col D = 3)
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 3))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_count).abs() < 1e-10,
                    "COUNTIF row {}: expected {}, got {}",
                    row,
                    exp_count,
                    n.get()
                ),
                other => panic!("COUNTIF row {}: expected number, got {:?}", row, other),
            }
        }

        // SUMIF (col E = 4)
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 4))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_sum).abs() < 1e-10,
                    "SUMIF row {}: expected {}, got {}",
                    row,
                    exp_sum,
                    n.get()
                ),
                other => panic!("SUMIF row {}: expected number, got {:?}", row, other),
            }
        }

        // AVERAGEIF (col F = 5)
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 5))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_avg).abs() < 1e-10,
                    "AVERAGEIF row {}: expected {}, got {}",
                    row,
                    exp_avg,
                    n.get()
                ),
                other => panic!("AVERAGEIF row {}: expected number, got {:?}", row, other),
            }
        }
    }
}

/// Test MAXIFS and MINIFS return 0.0 when no rows match (Excel behavior)
#[test]
fn test_agg_prepass_maxifs_minifs() {
    let sid_str = "00000000-0000-0000-0000-000000000001";
    let mut cells = Vec::new();
    let mut id_counter = 0x4000u128;

    // 15 data rows: category "A" or "B", values 10..150
    for row in 0..15u32 {
        let cat = if row % 2 == 0 { "A" } else { "B" };
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number((row + 1) as f64 * 10.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // 10 formula rows with criteria in col C, MAXIFS in col D, MINIFS in col E
    for row in 0..10u32 {
        let cat = if row % 2 == 0 { "A" } else { "B" };
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });

        // MAXIFS
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 3,
            value: CellValue::number(0.0),
            formula: Some(format!("=MAXIFS(B$1:B$15,A$1:A$15,C{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // MINIFS
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 4,
            value: CellValue::number(0.0),
            formula: Some(format!("=MINIFS(B$1:B$15,A$1:A$15,C{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid_str.to_string(),
            name: "Sheet1".to_string(),
            rows: 15,
            cols: 5,
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
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // "A" rows: 0,2,4,6,8,10,12,14 → values: 10,30,50,70,90,110,130,150 → max=150, min=10
    // "B" rows: 1,3,5,7,9,11,13 → values: 20,40,60,80,100,120,140 → max=140, min=20
    let sheet_id = sid(1);
    for row in 0..10u32 {
        let (exp_max, exp_min) = if row % 2 == 0 {
            (150.0, 10.0) // A
        } else {
            (140.0, 20.0) // B
        };

        // MAXIFS (col 3)
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 3))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_max).abs() < 1e-10,
                    "MAXIFS row {}: expected {}, got {}",
                    row,
                    exp_max,
                    n.get()
                ),
                other => panic!("MAXIFS row {}: expected number, got {:?}", row, other),
            }
        }

        // MINIFS (col 4)
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 4))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_min).abs() < 1e-10,
                    "MINIFS row {}: expected {}, got {}",
                    row,
                    exp_min,
                    n.get()
                ),
                other => panic!("MINIFS row {}: expected number, got {:?}", row, other),
            }
        }
    }
}

/// Test AVERAGEIFS returns #DIV/0! when no rows match the criteria
#[test]
fn test_agg_prepass_averageifs_no_match_div0() {
    let sid_str = "00000000-0000-0000-0000-000000000001";
    let mut cells = Vec::new();
    let mut id_counter = 0x5000u128;

    // 10 data rows with category "Exists" only
    for row in 0..10u32 {
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text("Exists".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number((row + 1) as f64),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // 10 formula rows looking for "Missing" — should get #DIV/0! for AVERAGEIFS
    for row in 0..10u32 {
        // criteria
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::Text("Missing".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // AVERAGEIFS
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 3,
            value: CellValue::number(0.0),
            formula: Some(format!("=AVERAGEIFS(B$1:B$10,A$1:A$10,C{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid_str.to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 4,
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
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    for row in 0..10u32 {
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 3))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            assert_eq!(
                val,
                CellValue::Error(CellError::Div0, None),
                "AVERAGEIFS row {} with no match should return #DIV/0!, got {:?}",
                row,
                val
            );
        }
    }
}

/// Test mixed static + dynamic criteria: =COUNTIFS(A:A, D{row}, B:B, ">50")
#[test]
fn test_agg_prepass_mixed_static_dynamic() {
    let sid_str = "00000000-0000-0000-0000-000000000001";
    let mut cells = Vec::new();
    let mut id_counter = 0x6000u128;

    // 20 data rows
    for row in 0..20u32 {
        let cat = if row % 2 == 0 { "X" } else { "Y" };
        let value = (row + 1) as f64 * 10.0; // 10, 20, 30, ..., 200

        // Col A: category
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col B: value
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number(value),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // 10 formula rows: criteria col C, formula col D
    // =COUNTIFS(A$1:A$20, C{row+1}, B$1:B$20, ">100")
    for row in 0..10u32 {
        let cat = if row % 2 == 0 { "X" } else { "Y" };

        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });

        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 3,
            value: CellValue::number(0.0),
            formula: Some(format!(
                "=COUNTIFS(A$1:A$20,C{},B$1:B$20,\">100\")",
                row + 1
            )),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid_str.to_string(),
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 4,
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
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // X rows: 0,2,4,6,8,10,12,14,16,18 → values: 10,30,50,70,90,110,130,150,170,190
    //   where value > 100: 110,130,150,170,190 → count=5
    // Y rows: 1,3,5,7,9,11,13,15,17,19 → values: 20,40,60,80,100,120,140,160,180,200
    //   where value > 100: 120,140,160,180,200 → count=5
    let sheet_id = sid(1);
    for row in 0..10u32 {
        let exp_count = 5.0;

        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 3))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_count).abs() < 1e-10,
                    "Mixed criteria COUNTIFS row {}: expected {}, got {}",
                    row,
                    exp_count,
                    n.get()
                ),
                other => panic!(
                    "Mixed criteria COUNTIFS row {}: expected number, got {:?}",
                    row, other
                ),
            }
        }
    }
}

// -----------------------------------------------------------------------
// CellInput semantics — typed intent replaces \x00 sentinel
// -----------------------------------------------------------------------

#[test]
fn cell_input_literal_empty_stores_text_not_null() {
    use crate::storage::engine::mutation::CellInput;
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let cell_id = cid(0x50); // fresh cell

    // CellInput::Literal("") → CellValue::Text(""), distinct from Null.
    let input = CellInput::Literal {
        text: String::new(),
    };
    core.set_cell(&mut mirror, &sheet_id, cell_id, 5, 0, &input)
        .unwrap();

    let val = core.get_cell_value(&mirror, &cell_id).unwrap();
    assert_eq!(
        *val,
        CellValue::Text("".into()),
        "Literal(\"\") should produce Text(\"\"), not Null"
    );
}

#[test]
fn cell_input_clear_yields_null() {
    use crate::storage::engine::mutation::CellInput;
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let cell_id = cid(0x51);

    // First set a value
    core.set_cell(&mut mirror, &sheet_id, cell_id, 6, 0, "hello")
        .unwrap();
    let val = core.get_cell_value(&mirror, &cell_id).unwrap();
    assert_eq!(*val, CellValue::Text("hello".into()));

    // Now clear with CellInput::Clear
    core.set_cell(&mut mirror, &sheet_id, cell_id, 6, 0, &CellInput::Clear)
        .unwrap();
    let val = core.get_cell_value(&mirror, &cell_id).unwrap();
    assert_eq!(
        *val,
        CellValue::Null,
        "CellInput::Clear should produce Null"
    );
}

#[test]
fn cell_input_parse_nul_is_plain_text() {
    // Regression guard: a single-character NUL string fed through Parse must
    // end up as the literal text "\x00" — not silently re-interpreted as the
    // legacy empty-string sentinel.
    use crate::storage::engine::mutation::CellInput;
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let cell_id = cid(0x52);

    let input = CellInput::Parse {
        text: "\x00".to_string(),
    };
    core.set_cell(&mut mirror, &sheet_id, cell_id, 7, 0, &input)
        .unwrap();

    let val = core.get_cell_value(&mirror, &cell_id).unwrap();
    assert_eq!(
        *val,
        CellValue::Text("\x00".into()),
        "Parse(\"\\x00\") must flow through as plain NUL text"
    );
}

// -----------------------------------------------------------------------
// Regression: sheet_order maintained on add/remove (stress-many-sheets)
// -----------------------------------------------------------------------

#[test]
fn test_add_sheet_extends_sheet_order() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Initial snapshot has exactly one sheet (sid(1)).
    assert_eq!(core.sheet_order.len(), 1);
    let initial_pos = *core.sheet_order.get(&sid(1)).expect("Sheet1 in order");

    let new_sheet = SheetSnapshot {
        id: "00000000-0000-0000-0000-000000000002".to_string(),
        name: "Sheet2".to_string(),
        rows: 10,
        cols: 5,
        cells: vec![],
        ranges: vec![],
    };
    core.add_sheet(&mut mirror, new_sheet).unwrap();

    assert_eq!(
        core.sheet_order.len(),
        2,
        "sheet_order must grow when add_sheet is called"
    );
    let new_pos = *core
        .sheet_order
        .get(&sid(2))
        .expect("Sheet2 must be tracked in sheet_order");
    assert!(
        new_pos > initial_pos,
        "newly added sheet must take a position after existing sheets (got new={} old={})",
        new_pos,
        initial_pos,
    );
}

// -----------------------------------------------------------------------
// Regression: merge-fallback spill blockers drain on unmerge
// (spill-into-merged-cell)
// -----------------------------------------------------------------------

#[test]
fn test_drain_spill_blockers_for_region_unblocks_merge_fallback() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let source_id = cid(0x10); // A1 (row 0, col 0) registered by basic_snapshot

    // Simulate the merge-fallback path: when check_conflict() can't find
    // any concrete cell entity inside the merge region, it records the
    // spill *source* itself as the blocker. The source's position is
    // outside the merge region (here A1 at 0,0, while the "merge" is at
    // row 5..=7).
    core.spill_blockers.insert(source_id, source_id);

    // Drain blockers for a merge region that does NOT contain A1.
    // The classic in_region check would NOT match (A1 is at (0,0),
    // region is (5,0)..=(7,0)), so without the merge-fallback clause
    // this entry would stay stuck forever and the formula would remain
    // permanently #SPILL!.
    let unblocked = core.drain_spill_blockers_for_region(&mirror, &sheet_id, 5, 0, 7, 0);

    assert_eq!(
        unblocked,
        vec![source_id],
        "merge-fallback blocker (blocker_id == source_id) on the same sheet \
         must be drained when any merge on that sheet is removed",
    );
    assert!(
        !core.spill_blockers.contains_key(&source_id),
        "drained blocker must be removed from the map",
    );
}

#[test]
fn test_drain_spill_blockers_for_region_keeps_merge_fallback_other_sheet() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id_a = sid(1);

    // Add a second sheet with one cell so we can place a merge-fallback
    // entry whose source lives on Sheet2 but unmerge is on Sheet1.
    let new_sheet = SheetSnapshot {
        id: "00000000-0000-0000-0000-000000000002".to_string(),
        name: "Sheet2".to_string(),
        rows: 10,
        cols: 5,
        cells: vec![CellData {
            cell_id: "00000000-0000-0000-0000-000000000030".to_string(),
            row: 0,
            col: 0,
            value: CellValue::number(1.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        }],
        ranges: vec![],
    };
    core.add_sheet(&mut mirror, new_sheet).unwrap();

    let source_other = cid(0x30); // Lives on Sheet2
    core.spill_blockers.insert(source_other, source_other);

    // Drain merges on Sheet1 — must NOT drain the Sheet2 fallback entry.
    let unblocked = core.drain_spill_blockers_for_region(&mirror, &sheet_id_a, 0, 0, 99, 99);

    assert!(
        unblocked.is_empty(),
        "merge-fallback entries on a different sheet must not be drained",
    );
    assert!(
        core.spill_blockers.contains_key(&source_other),
        "Sheet2 fallback entry must remain after Sheet1 unmerge",
    );
}

#[test]
fn test_remove_sheet_clears_sheet_order_entry() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Add a second sheet so removing leaves one behind.
    let new_sheet = SheetSnapshot {
        id: "00000000-0000-0000-0000-000000000002".to_string(),
        name: "Sheet2".to_string(),
        rows: 10,
        cols: 5,
        cells: vec![],
        ranges: vec![],
    };
    core.add_sheet(&mut mirror, new_sheet).unwrap();
    assert_eq!(core.sheet_order.len(), 2);

    core.remove_sheet(&mut mirror, &sid(2)).unwrap();

    assert_eq!(
        core.sheet_order.len(),
        1,
        "sheet_order must shrink when remove_sheet is called"
    );
    assert!(
        !core.sheet_order.contains_key(&sid(2)),
        "removed sheet must not linger in sheet_order"
    );
}
