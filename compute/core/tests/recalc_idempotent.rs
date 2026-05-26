//! Idempotence of `Engine::recalculate*()` — no mutations, no work.
//!
//! Calling `wb.calculate()` twice in a row with zero mutations between the
//! calls must not re-evaluate any formula cells on the second call. The TS
//! surface is `wb.calculate()` → `compute_full_recalc` → Rust
//! `BridgeService::full_recalc` → `Engine::recalculate_with_options`. This
//! file tests the invariant one layer below the RPC boundary, which is the
//! closest layer to the TS API that does not pay for serialization.
//!
//! **Expected state of these tests today: failing.** `full_recalc`
//! unconditionally walks every formula cell. The tests are checked in as live
//! `#[test]` cases (no `#[ignore]`) so they serve as the bug tracker until the
//! `wb.calculate()` short-circuit lands.
//!
//! Run:
//!   cargo test -p compute-core --test recalc_idempotent -- --nocapture

use cell_types::SheetPos;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{
    CalcMode, CalculationSettings, CellData, RecalcOptions, SheetSnapshot, WorkbookSnapshot,
};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn cell_uuid(row: u32, col: u32) -> String {
    format!("c0000000{:04x}{:04x}0000000000000000", row, col)
}

fn value_cell(row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_uuid(row, col),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn formula_cell(row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        cell_id: cell_uuid(row, col),
        row,
        col,
        value: CellValue::Null,
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn one_sheet_snapshot(cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn sheet_id() -> cell_types::SheetId {
    cell_types::SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
}

fn number_at(engine: &YrsComputeEngine, row: u32, col: u32) -> f64 {
    match engine
        .mirror()
        .get_cell_value_at(&sheet_id(), SheetPos::new(row, col))
    {
        Some(CellValue::Number(n)) => n.get(),
        other => panic!("expected numeric value at ({row}, {col}), got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Test 1: pure "call twice" — simplest shape of the invariant
// ---------------------------------------------------------------------------

/// Two `recalculate()` calls with no mutations between them. The second call
/// must evaluate zero formula cells. This is the minimal reproduction of the
/// finding — if this fails, every larger variant fails too.
///
/// Under the recalc idempotency design, `init_from_snapshot` ends with `clear_dirty()`,
/// so the FIRST `recalculate_with_options()` call also short-circuits —
/// there's been no mutation since init.
#[test]
fn idempotent_recalc_reports_zero_cells_evaluated() {
    // A1=10, B1=20, A2=A1+B1, A3=A2*2, A4=SUM(A1:B1)
    let cells = vec![
        value_cell(0, 0, 10.0),
        value_cell(0, 1, 20.0),
        formula_cell(1, 0, "=A1+B1"),
        formula_cell(2, 0, "=A2*2"),
        formula_cell(3, 0, "=SUM(A1:B1)"),
    ];

    let (mut engine, init_recalc) =
        YrsComputeEngine::from_snapshot(one_sheet_snapshot(cells)).unwrap();

    // Init path evaluated the three formula cells.
    assert!(
        init_recalc.metrics.cells_evaluated >= 3,
        "init should evaluate all formulas, got {}",
        init_recalc.metrics.cells_evaluated
    );

    // Call 1: init just cleared the dirty bit, so r1 is also a short-circuit.
    let opts = RecalcOptions::default();
    let r1 = engine.recalculate_with_options(&opts).unwrap();

    // Call 2: still no mutations. Same short-circuit.
    let r2 = engine.recalculate_with_options(&opts).unwrap();

    assert_eq!(
        r1.metrics.cells_evaluated, 0,
        "post-init recalc must short-circuit — got {} on call 1",
        r1.metrics.cells_evaluated,
    );
    assert_eq!(
        r2.metrics.cells_evaluated, 0,
        "idempotent recalc must evaluate zero cells; got {} on call 2 (call 1: {})",
        r2.metrics.cells_evaluated, r1.metrics.cells_evaluated,
    );
    assert!(
        r2.changed_cells.is_empty(),
        "idempotent recalc must report no cell changes — got {} changed",
        r2.changed_cells.len(),
    );
}

// ---------------------------------------------------------------------------
// Test 2: call-twice with an XLSX export between — mirrors the repro
// ---------------------------------------------------------------------------

/// The finding's reproduction does `calculate → toXlsx → calculate`. If this
/// test fails while Test 1 passes, the non-idempotence is caused by export
/// side-effects dirtying state, not by the recalc path itself.
#[test]
fn idempotent_recalc_after_xlsx_export() {
    let cells = vec![
        value_cell(0, 0, 10.0),
        value_cell(0, 1, 20.0),
        formula_cell(1, 0, "=A1+B1"),
        formula_cell(2, 0, "=A2*2"),
    ];

    let (mut engine, _init) = YrsComputeEngine::from_snapshot(one_sheet_snapshot(cells)).unwrap();

    let opts = RecalcOptions::default();
    let r1 = engine.recalculate_with_options(&opts).unwrap();

    // Export between calls — mirrors `wb.toXlsx()` in the TS repro.
    // The invariant under test: export must NOT flip the dirty bit.
    let _bytes = engine
        .export_to_xlsx_bytes()
        .expect("export_to_xlsx_bytes should succeed");

    let r2 = engine.recalculate_with_options(&opts).unwrap();

    assert_eq!(
        r1.metrics.cells_evaluated, 0,
        "pre-export recalc must short-circuit — got {} on call 1",
        r1.metrics.cells_evaluated,
    );
    assert_eq!(
        r2.metrics.cells_evaluated, 0,
        "idempotent recalc after toXlsx must evaluate zero cells — got {}",
        r2.metrics.cells_evaluated,
    );
    assert!(r2.changed_cells.is_empty());
}

// ---------------------------------------------------------------------------
// Test 3: range-dep formula (SUMIF) — exercises the barrier-graph path
// ---------------------------------------------------------------------------

/// The drawing-import-roundtrip regression lives in `build_barrier_graph`.
/// Range-dependent formulas (SUMIF/VLOOKUP/INDEX/...) are what populate the
/// selective-deps / aggregate-deps paths in that function. If the fix for
/// idempotence only cached the cell-to-cell side of the graph and not the
/// range-deps side, Test 1 could pass while this one fails.
#[test]
fn idempotent_recalc_with_range_dep_formulas() {
    let mut cells = Vec::new();
    // 20 data rows in col A + col B, one SUMIF and one SUM that read them.
    for i in 0..20 {
        cells.push(value_cell(i, 0, (i + 1) as f64));
        cells.push(value_cell(i, 1, ((i % 3) + 1) as f64));
    }
    cells.push(formula_cell(0, 3, "=SUMIF(B1:B20,2,A1:A20)"));
    cells.push(formula_cell(1, 3, "=SUM(A1:A20)"));
    cells.push(formula_cell(2, 3, "=D1+D2"));

    let (mut engine, _init) = YrsComputeEngine::from_snapshot(one_sheet_snapshot(cells)).unwrap();

    let opts = RecalcOptions::default();
    let r1 = engine.recalculate_with_options(&opts).unwrap();
    let r2 = engine.recalculate_with_options(&opts).unwrap();

    assert_eq!(
        r1.metrics.cells_evaluated, 0,
        "post-init recalc must short-circuit — got {} on call 1",
        r1.metrics.cells_evaluated,
    );
    assert_eq!(
        r2.metrics.cells_evaluated, 0,
        "idempotent recalc with range-dep formulas must evaluate zero cells — got {}",
        r2.metrics.cells_evaluated,
    );
    assert!(r2.changed_cells.is_empty());
}

// ---------------------------------------------------------------------------
// Test 4: sanity check — edit between calls *does* trigger re-evaluation
// ---------------------------------------------------------------------------

/// Guard against a false-green fix that makes recalculate a no-op in all
/// cases. After a real edit, any mutation must flip the dirty bit so the
/// next `recalculate_with_options()` does a full pass — not a dirty-only
/// diff.
#[test]
fn recalc_after_edit_still_evaluates() {
    // One formula cell — full recalc must evaluate exactly it.
    let cells = vec![
        value_cell(0, 0, 10.0),
        value_cell(0, 1, 20.0),
        formula_cell(1, 0, "=A1+B1"),
    ];
    let formula_count = 1u64;

    let (mut engine, _init) = YrsComputeEngine::from_snapshot(one_sheet_snapshot(cells)).unwrap();

    let opts = RecalcOptions::default();
    let _r1 = engine.recalculate_with_options(&opts).unwrap();

    // Real mutation: change A1 from 10 to 99.
    let sheet_id =
        cell_types::SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    let cell_id = cell_types::CellId::from_uuid_str(&cell_uuid(0, 0)).unwrap();
    engine
        .set_cell(&sheet_id, cell_id, 0, 0, "99".into())
        .unwrap();

    let r2 = engine.recalculate_with_options(&opts).unwrap();

    assert_eq!(
        r2.metrics.cells_evaluated, formula_count,
        "any mutation must trigger a full recalc on the next \
         recalculate_with_options() — expected all {} formula cells to \
         re-evaluate, got {}",
        formula_count, r2.metrics.cells_evaluated,
    );
}

// ---------------------------------------------------------------------------
// Test 5: structural change (insert row) also flips the bit
// ---------------------------------------------------------------------------

/// `structure_change` is a mutation path distinct from cell edits. Inserting
/// a row must flip the dirty bit so the next `recalculate_with_options()`
/// does a full recalc.
#[test]
fn recalc_after_structural_change_still_evaluates() {
    let cells = vec![
        value_cell(0, 0, 10.0),
        value_cell(0, 1, 20.0),
        formula_cell(1, 0, "=A1+B1"),
        formula_cell(2, 0, "=A2*2"),
    ];
    let formula_count = 2u64;

    let (mut engine, _init) = YrsComputeEngine::from_snapshot(one_sheet_snapshot(cells)).unwrap();

    let opts = RecalcOptions::default();
    let _r1 = engine.recalculate_with_options(&opts).unwrap();

    // Structural mutation: insert one row at the top.
    let sheet_id =
        cell_types::SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    let change = formula_types::StructureChange::InsertRows {
        at: 0,
        count: 1,
        new_row_ids: Vec::new(),
    };
    engine.structure_change(&sheet_id, &change).unwrap();

    let r2 = engine.recalculate_with_options(&opts).unwrap();

    assert_eq!(
        r2.metrics.cells_evaluated, formula_count,
        "structural change must flip the dirty bit — expected all {} \
         formula cells to re-evaluate, got {}",
        formula_count, r2.metrics.cells_evaluated,
    );
}

// ---------------------------------------------------------------------------
// Test 6: multiple edits between calculates — bit accumulates correctly
// ---------------------------------------------------------------------------

/// Three cell edits before one `recalculate_with_options()`. The inline
/// on-edit recalc after each `set_cell` must not prematurely clear the
/// dirty bit — the full recalc triggered by `recalculate_with_options`
/// must still process all formula cells.
///
/// The formulas depend on all three edited cells to make the full-count
/// assertion meaningful: if the on-edit incremental path had cleared the
/// bit, the final full recalc would see `cells_evaluated == 0`.
#[test]
fn recalc_bit_accumulates_across_multiple_edits() {
    let cells = vec![
        value_cell(0, 0, 10.0),
        value_cell(0, 1, 20.0),
        value_cell(0, 2, 30.0),
        formula_cell(1, 0, "=A1+B1+C1"),
        formula_cell(1, 1, "=A1*B1"),
        formula_cell(1, 2, "=SUM(A1:C1)"),
    ];
    let formula_count = 3u64;

    let (mut engine, _init) = YrsComputeEngine::from_snapshot(one_sheet_snapshot(cells)).unwrap();

    let opts = RecalcOptions::default();
    let _r1 = engine.recalculate_with_options(&opts).unwrap();

    let sheet_id =
        cell_types::SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();

    // Three edits at different cells.
    let cid_a1 = cell_types::CellId::from_uuid_str(&cell_uuid(0, 0)).unwrap();
    let cid_b1 = cell_types::CellId::from_uuid_str(&cell_uuid(0, 1)).unwrap();
    let cid_c1 = cell_types::CellId::from_uuid_str(&cell_uuid(0, 2)).unwrap();
    engine
        .set_cell(&sheet_id, cid_a1, 0, 0, "11".into())
        .unwrap();
    engine
        .set_cell(&sheet_id, cid_b1, 0, 1, "22".into())
        .unwrap();
    engine
        .set_cell(&sheet_id, cid_c1, 0, 2, "33".into())
        .unwrap();

    let r2 = engine.recalculate_with_options(&opts).unwrap();

    assert_eq!(
        r2.metrics.cells_evaluated, formula_count,
        "accumulated edits must flip the dirty bit and the next full \
         recalc must evaluate all {} formula cells — got {}. \
         If this reads 0, the on-edit incremental recalc is clearing the \
         bit prematurely.",
        formula_count, r2.metrics.cells_evaluated,
    );
}

// ---------------------------------------------------------------------------
// Test 7: init leaves the bit clean — recalc immediately after from_snapshot
// ---------------------------------------------------------------------------

/// `init_from_snapshot` ends with `clear_dirty()`. An immediate
/// `recalculate_with_options()` after `from_snapshot` must short-circuit.
#[test]
fn init_leaves_bit_clean() {
    let cells = vec![
        value_cell(0, 0, 10.0),
        value_cell(0, 1, 20.0),
        formula_cell(1, 0, "=A1+B1"),
        formula_cell(2, 0, "=A2*2"),
    ];

    let (mut engine, init_recalc) =
        YrsComputeEngine::from_snapshot(one_sheet_snapshot(cells)).unwrap();

    // Init did the heavy lifting.
    assert!(
        init_recalc.metrics.cells_evaluated >= 2,
        "init should evaluate all formulas, got {}",
        init_recalc.metrics.cells_evaluated,
    );

    // Immediate follow-up: no mutations since init.
    let opts = RecalcOptions::default();
    let r = engine.recalculate_with_options(&opts).unwrap();

    assert_eq!(
        r.metrics.cells_evaluated, 0,
        "init must leave dirty=false — next recalc should short-circuit, \
         got {} cells evaluated",
        r.metrics.cells_evaluated,
    );
    assert!(r.changed_cells.is_empty());
}

#[test]
fn manual_calculation_keeps_dependents_stale_until_explicit_recalc() {
    let cells = vec![value_cell(0, 0, 10.0), formula_cell(0, 1, "=A1+1")];
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(one_sheet_snapshot(cells)).unwrap();
    assert_eq!(number_at(&engine, 0, 1), 11.0);

    let mut settings = engine.get_workbook_settings();
    settings.calculation_settings = Some(CalculationSettings {
        calc_mode: CalcMode::Manual,
        ..CalculationSettings::default()
    });
    engine
        .set_workbook_settings(settings)
        .expect("set manual calculation mode");

    let a1 = cell_types::CellId::from_uuid_str(&cell_uuid(0, 0)).unwrap();
    engine
        .set_cell(&sheet_id(), a1, 0, 0, "99".into())
        .expect("edit A1 in manual mode");

    assert_eq!(number_at(&engine, 0, 0), 99.0);
    assert_eq!(
        number_at(&engine, 0, 1),
        11.0,
        "manual mode must leave dependent formula display stale after input edit",
    );

    let recalc = engine
        .recalculate_with_options(&RecalcOptions::default())
        .expect("explicit recalc");
    assert!(recalc.metrics.cells_evaluated >= 1);
    assert_eq!(number_at(&engine, 0, 1), 100.0);
}

#[test]
fn clean_recalc_still_evaluates_volatile_formulas() {
    compute_core::scheduler::ComputeCore::set_current_time(46147.25);
    let cells = vec![formula_cell(0, 0, "=NOW()")];
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(one_sheet_snapshot(cells)).unwrap();
    assert_eq!(number_at(&engine, 0, 0), 46147.25);

    // Init leaves dirty=false, but volatile formulas must still calculate on
    // explicit recalc so NOW()/TODAY()/RAND() can advance.
    compute_core::scheduler::ComputeCore::set_current_time(46147.75);
    let recalc = engine
        .recalculate_with_options(&RecalcOptions::default())
        .expect("volatile recalc");

    compute_core::scheduler::ComputeCore::set_current_time(0.0);

    assert!(
        recalc.metrics.cells_evaluated >= 1,
        "clean volatile recalc must not short-circuit",
    );
    assert_eq!(number_at(&engine, 0, 0), 46147.75);
}
