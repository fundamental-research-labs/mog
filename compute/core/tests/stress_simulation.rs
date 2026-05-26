#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_common;
use stress_common::*;

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, CellEdit, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

// ===========================================================================
// Category 10: Multi-Sheet Financial Model Simulation (5 tests)
//
// These test realistic agent workflows — building and modifying models
// step by step, with exact value assertions after every step.
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 1: Build 3-statement model (40+ steps)
//
// Income statement with tax circularity (iterative calc).
//
// Model:
//   Revenue (A1) = 1000
//   COGS    (A2) = "=A1*0.4" = 400
//   Gross   (A3) = "=A1-A2"  = 600
//   OpEx    (A4) = 200
//   PreTax  (A5) = "=A3-A4-A6"  (EBIT minus Tax — circular with A6)
//   Tax     (A6) = "=A5*0.3"    (Tax depends on PreTax)
//
// Closed form for circular part:
//   PreTax = Gross - OpEx - Tax = 600 - 200 - Tax = 400 - Tax
//   Tax = PreTax * 0.3 = (400 - Tax) * 0.3
//   Tax + 0.3*Tax = 120
//   1.3 * Tax = 120
//   Tax = 120/1.3 = 92.307692...
//   PreTax = 400 - 92.307692... = 307.692307...
//   NetIncome (A7) = PreTax - Tax = 307.692307... - 92.307692... = 215.384615...
//     equivalently: NetIncome = PreTax * (1-0.3) = PreTax * 0.7
//
// Then modify Revenue to 2000:
//   COGS = 800, Gross = 1200, EBIT_base = 1200-200 = 1000
//   Tax = 1000*0.3/1.3 = 300/1.3 = 230.769230...
//   PreTax = 1000 - 230.769230... = 769.230769...
//   NetIncome = PreTax * 0.7 = 538.461538...
// ---------------------------------------------------------------------------
#[test]
fn test_build_three_statement_model() {
    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();

    // Init with iterative calc enabled, all sheets empty
    let snapshot = build_iterative_snapshot(
        vec![
            ("Income", 100, 26, vec![]),
            ("Balance", 100, 26, vec![]),
            ("CashFlow", 100, 26, vec![]),
        ],
        200,
        0.001,
    );
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // --- Build Income Statement on Sheet0 (Income) ---

    // Step 1: Revenue A1 = 1000
    set(&mut core, &mut mirror, 0, 0, 0, "1000");
    assert_mirror_number(&mirror, 0, 0, 0, 1000.0);

    // Step 2: COGS A2 = "=A1*0.4"
    set(&mut core, &mut mirror, 0, 1, 0, "=A1*0.4");
    assert_mirror_number(&mirror, 0, 1, 0, 400.0);

    // Step 3: Gross Profit A3 = "=A1-A2"
    set(&mut core, &mut mirror, 0, 2, 0, "=A1-A2");
    assert_mirror_number(&mirror, 0, 2, 0, 600.0);

    // Step 4: OpEx A4 = 200
    set(&mut core, &mut mirror, 0, 3, 0, "200");
    assert_mirror_number(&mirror, 0, 3, 0, 200.0);

    // Step 5: EBIT (non-circular first) A5 = "=A3-A4" = 600-200 = 400
    set(&mut core, &mut mirror, 0, 4, 0, "=A3-A4");
    assert_mirror_number(&mirror, 0, 4, 0, 400.0);

    // Step 6: Tax A6 = "=A5*0.3" = 400*0.3 = 120 (no cycle yet)
    set(&mut core, &mut mirror, 0, 5, 0, "=A5*0.3");
    assert_mirror_number(&mirror, 0, 5, 0, 120.0);

    // Step 7: NetIncome A7 = "=A5-A6" = 400-120 = 280
    set(&mut core, &mut mirror, 0, 6, 0, "=A5-A6");
    assert_mirror_number(&mirror, 0, 6, 0, 280.0);

    // Step 8: Now make it circular — change PreTax to include Tax deduction
    // PreTax A5 = "=A3-A4-A6" — this creates cycle A5→A6→A5
    // Use set_cells with skip_cycle_check=true to allow circular ref
    let s = sid(0);
    let edits: Vec<(
        SheetId,
        CellId,
        u32,
        u32,
        compute_core::bridge_types::CellInput,
    )> = vec![(
        s,
        cid(0, 4, 0),
        4,
        0,
        compute_core::bridge_types::CellInput::Parse {
            text: "=A3-A4-A6".to_string(),
        },
    )];
    let _r = core.set_cells(&mut mirror, &edits, true).unwrap();

    // Closed form: PreTax = 400 - Tax, Tax = PreTax*0.3
    // → 1.3*Tax = 120 → Tax = 120/1.3
    let expected_tax = 120.0 / 1.3; // 92.307692...
    let expected_pretax = 400.0 - expected_tax; // 307.692307...
    let expected_ni = expected_pretax - expected_tax; // 215.384615...

    assert_mirror_number_tol(&mirror, 0, 4, 0, expected_pretax, 0.01); // A5 PreTax
    assert_mirror_number_tol(&mirror, 0, 5, 0, expected_tax, 0.01); // A6 Tax
    assert_mirror_number_tol(&mirror, 0, 6, 0, expected_ni, 0.01); // A7 NetIncome

    // Non-circular cells should be unchanged
    assert_mirror_number(&mirror, 0, 0, 0, 1000.0); // Revenue
    assert_mirror_number(&mirror, 0, 1, 0, 400.0); // COGS
    assert_mirror_number(&mirror, 0, 2, 0, 600.0); // Gross
    assert_mirror_number(&mirror, 0, 3, 0, 200.0); // OpEx

    // --- Steps 9-15: Add balance sheet items ---

    // Step 9: Balance!A1 = Total Assets = 5000
    set(&mut core, &mut mirror, 1, 0, 0, "5000");
    assert_mirror_number(&mirror, 1, 0, 0, 5000.0);

    // Step 10: Balance!A2 = Equity = "=Balance!A1-Balance!A3" (Assets - Debt)
    // First set Debt so Equity can compute
    // Step 10a: Balance!A3 = Debt = 2000
    set(&mut core, &mut mirror, 1, 2, 0, "2000");
    assert_mirror_number(&mirror, 1, 2, 0, 2000.0);

    // Step 10b: Balance!A2 = Equity = "=A1-A3" = 5000-2000 = 3000
    set(&mut core, &mut mirror, 1, 1, 0, "=A1-A3");
    assert_mirror_number(&mirror, 1, 1, 0, 3000.0);

    // --- Steps 16-25: Add CashFlow items ---

    // Step 16: CashFlow!A1 = Operating CF = "=Income!A7" (NetIncome from income sheet)
    set(&mut core, &mut mirror, 2, 0, 0, "=Income!A7");
    assert_mirror_number_tol(&mirror, 2, 0, 0, expected_ni, 0.01);

    // Step 17: CashFlow!A2 = CapEx = 100
    set(&mut core, &mut mirror, 2, 1, 0, "100");
    assert_mirror_number(&mirror, 2, 1, 0, 100.0);

    // Step 18: CashFlow!A3 = Free CF = "=A1-A2"
    set(&mut core, &mut mirror, 2, 2, 0, "=A1-A2");
    assert_mirror_number_tol(&mirror, 2, 2, 0, expected_ni - 100.0, 0.01);

    // --- Steps 26-35: Modify Revenue to 2000, verify cascade ---

    // Step 26: Change Revenue to 2000
    set(&mut core, &mut mirror, 0, 0, 0, "2000");
    assert_mirror_number(&mirror, 0, 0, 0, 2000.0);

    // Step 27: COGS cascades = 2000*0.4 = 800
    assert_mirror_number(&mirror, 0, 1, 0, 800.0);

    // Step 28: Gross = 2000-800 = 1200
    assert_mirror_number(&mirror, 0, 2, 0, 1200.0);

    // Step 29: EBIT_base = Gross-OpEx = 1200-200 = 1000
    // Closed form: PreTax = 1000-Tax, Tax = PreTax*0.3
    // 1.3*Tax = 300 → Tax = 300/1.3
    let expected_tax2 = 300.0 / 1.3; // 230.769230...
    let expected_pretax2 = 1000.0 - expected_tax2; // 769.230769...
    let expected_ni2 = expected_pretax2 - expected_tax2; // 538.461538...

    assert_mirror_number_tol(&mirror, 0, 4, 0, expected_pretax2, 0.01); // PreTax
    assert_mirror_number_tol(&mirror, 0, 5, 0, expected_tax2, 0.01); // Tax
    assert_mirror_number_tol(&mirror, 0, 6, 0, expected_ni2, 0.01); // NetIncome

    // Step 30: CashFlow!A1 cascades = NetIncome2
    assert_mirror_number_tol(&mirror, 2, 0, 0, expected_ni2, 0.01);

    // Step 31: Free CF = NI2 - 100
    assert_mirror_number_tol(&mirror, 2, 2, 0, expected_ni2 - 100.0, 0.01);

    // --- Steps 36-40: Change tax rate by modifying Tax formula ---

    // Step 36: Add tax rate cell B1 = 0.25 on Income sheet
    set(&mut core, &mut mirror, 0, 0, 1, "0.25");
    assert_mirror_number(&mirror, 0, 0, 1, 0.25);

    // Step 37: Change Tax formula to use B1: "=A5*B1"
    let edits2: Vec<(
        SheetId,
        CellId,
        u32,
        u32,
        compute_core::bridge_types::CellInput,
    )> = vec![(
        s,
        cid(0, 5, 0),
        5,
        0,
        compute_core::bridge_types::CellInput::Parse {
            text: "=A5*B1".to_string(),
        },
    )];
    let _r = core.set_cells(&mut mirror, &edits2, true).unwrap();

    // New closed form with rate=0.25:
    // PreTax = 1000-Tax, Tax = PreTax*0.25
    // 1.25*Tax = 250 → Tax = 200
    // PreTax = 800, NI = 600
    assert_mirror_number_tol(&mirror, 0, 5, 0, 200.0, 0.01); // Tax
    assert_mirror_number_tol(&mirror, 0, 4, 0, 800.0, 0.01); // PreTax
    assert_mirror_number_tol(&mirror, 0, 6, 0, 600.0, 0.01); // NetIncome

    // Step 38: CashFlow cascades
    assert_mirror_number_tol(&mirror, 2, 0, 0, 600.0, 0.01); // Operating CF
    assert_mirror_number_tol(&mirror, 2, 2, 0, 500.0, 0.01); // Free CF = 600-100
}

// ---------------------------------------------------------------------------
// Test 2: Modify assumptions (20 steps)
//
// Init with convergent circular model (tax circularity).
// Revenue=parameter, margin=0.4, tax_rate=0.3.
//   GrossProfit = Revenue * (1-margin) = Revenue * 0.6
//   PreTax = GrossProfit - Tax
//   Tax = PreTax * rate
//
// Closed form:
//   PreTax = GP - Tax = GP - PreTax*rate
//   PreTax(1+rate) = GP
//   PreTax = GP/(1+rate) = Revenue*0.6/1.3
//   Tax = PreTax * rate = Revenue*0.6*0.3/1.3 = Revenue*0.18/1.3
//   NetIncome = PreTax - Tax = PreTax*0.7 = Revenue*0.6*0.7/1.3 = Revenue*0.42/1.3
//
// Loop: set Revenue to 1000,1500,...,10500 (20 steps). After each assert closed-form.
// ---------------------------------------------------------------------------
#[test]
fn test_modify_assumptions_20_sweeps() {
    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();

    // Init with iterative calc enabled, build non-circular parts in snapshot
    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (0, 0, CellValue::number(1000.0), None), // A1 = Revenue
                (1, 0, CellValue::number(0.0), Some("=A1*0.6")), // A2 = GrossProfit
            ],
        )],
        200,
        0.001,
    );
    let _result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    assert_mirror_number(&mirror, 0, 0, 0, 1000.0); // Revenue
    assert_mirror_number(&mirror, 0, 1, 0, 600.0); // GrossProfit

    // Add circular formulas via set_cells(skip_cycle_check=true)
    let s = sid(0);
    let cycle_edits: Vec<(
        SheetId,
        CellId,
        u32,
        u32,
        compute_core::bridge_types::CellInput,
    )> = vec![
        (
            s,
            cid(0, 2, 0),
            2,
            0,
            compute_core::bridge_types::CellInput::Parse {
                text: "=A2-A4".to_string(),
            },
        ), // A3 = PreTax (circular)
        (
            s,
            cid(0, 3, 0),
            3,
            0,
            compute_core::bridge_types::CellInput::Parse {
                text: "=A3*0.3".to_string(),
            },
        ), // A4 = Tax (circular)
    ];
    let _r = core.set_cells(&mut mirror, &cycle_edits, true).unwrap();

    // Verify cycle converged
    let rev0 = 1000.0;
    let pt0 = rev0 * 0.6 / 1.3;
    let tax0 = pt0 * 0.3;

    assert_mirror_number_tol(&mirror, 0, 2, 0, pt0, 0.01); // PreTax
    assert_mirror_number_tol(&mirror, 0, 3, 0, tax0, 0.01); // Tax

    // Add NetIncome after cycle is established
    set(&mut core, &mut mirror, 0, 4, 0, "=A3-A4");
    let ni0 = pt0 - tax0;
    assert_mirror_number_tol(&mirror, 0, 4, 0, ni0, 0.01); // NetIncome

    // Loop 20 steps: Revenue = 1500, 2000, ..., 10500
    // (skip 1000 since it's the initial state — set_cell with same value
    //  may not re-trigger cycle convergence)
    for step in 1u32..=20 {
        let revenue = 1000.0 + (step as f64) * 500.0;
        set(
            &mut core,
            &mut mirror,
            0,
            0,
            0,
            &format!("{}", revenue as u32),
        );

        // Closed form:
        //   GrossProfit = Revenue * 0.6
        //   PreTax = Revenue * 0.6 / 1.3
        //   Tax = PreTax * 0.3
        //   NetIncome = PreTax - Tax = PreTax * 0.7
        let gp = revenue * 0.6;
        let pretax = gp / 1.3;
        let tax = pretax * 0.3;
        let ni = pretax - tax;

        assert_mirror_number(&mirror, 0, 0, 0, revenue);
        assert_mirror_number(&mirror, 0, 1, 0, gp);
        assert_mirror_number_tol(&mirror, 0, 2, 0, pretax, 0.01);
        assert_mirror_number_tol(&mirror, 0, 3, 0, tax, 0.01);
        assert_mirror_number_tol(&mirror, 0, 4, 0, ni, 0.01);
    }
}

// ---------------------------------------------------------------------------
// Test 3: Scenario analysis (15 steps)
//
// Same model. Add 3 scenario columns (B, C, D) with different revenue
// assumptions. Each scenario has its own independent cycle.
//
// Column A = Base: Revenue=1000
// Column B = Bull: Revenue=2000
// Column C = Bear: Revenue=500
//
// Each column: row0=Revenue, row1="=row0*0.6" (GP), row2="=row1-row3" (PreTax),
//              row3="=row2*0.3" (Tax), row4="=row2-row3" (NI)
//
// Closed form per scenario: PreTax = Rev*0.6/1.3, Tax = PreTax*0.3, NI = PreTax*0.7
// ---------------------------------------------------------------------------
#[test]
fn test_scenario_analysis_three_columns() {
    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();

    // Init with iterative calc enabled, empty sheet
    let snapshot = build_iterative_snapshot(vec![("Scenarios", 100, 26, vec![])], 200, 0.001);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let s = sid(0);

    // Helper: build one scenario column via set_cells(skip=true)
    // col: column index, revenue: revenue value
    let build_scenario =
        |core: &mut ComputeCore, mirror: &mut CellMirror, col: u32, revenue: f64| {
            // Set revenue constant first
            let col_letter = (b'A' + col as u8) as char;
            let rev_str = format!("{}", revenue as u32);

            // Row 0: Revenue
            set(core, mirror, 0, 0, col, &rev_str);

            // Row 1: GrossProfit = "=<col>1*0.6"
            set(core, mirror, 0, 1, col, &format!("={}1*0.6", col_letter));

            // Rows 2-4 form a cycle, use set_cells with skip_cycle_check=true
            let edits: Vec<(
                SheetId,
                CellId,
                u32,
                u32,
                compute_core::bridge_types::CellInput,
            )> = vec![
                (
                    s,
                    cid(0, 2, col),
                    2,
                    col,
                    compute_core::bridge_types::CellInput::Parse {
                        text: format!("={}2-{}4", col_letter, col_letter),
                    }, // PreTax = GP - Tax
                ),
                (
                    s,
                    cid(0, 3, col),
                    3,
                    col,
                    compute_core::bridge_types::CellInput::Parse {
                        text: format!("={}3*0.3", col_letter),
                    }, // Tax = PreTax * 0.3
                ),
                (
                    s,
                    cid(0, 4, col),
                    4,
                    col,
                    compute_core::bridge_types::CellInput::Parse {
                        text: format!("={}3-{}4", col_letter, col_letter),
                    }, // NI = PreTax - Tax
                ),
            ];
            core.set_cells(mirror, &edits, true).unwrap();
        };

    // Step 1-5: Build Base scenario (column A, col=0)
    build_scenario(&mut core, &mut mirror, 0, 1000.0);

    // Verify Base: Revenue=1000
    let base_pt = 1000.0 * 0.6 / 1.3;
    let base_tax = base_pt * 0.3;
    let base_ni = base_pt - base_tax;
    assert_mirror_number(&mirror, 0, 0, 0, 1000.0);
    assert_mirror_number(&mirror, 0, 1, 0, 600.0);
    assert_mirror_number_tol(&mirror, 0, 2, 0, base_pt, 0.01);
    assert_mirror_number_tol(&mirror, 0, 3, 0, base_tax, 0.01);
    assert_mirror_number_tol(&mirror, 0, 4, 0, base_ni, 0.01);

    // Step 6-10: Build Bull scenario (column B, col=1)
    build_scenario(&mut core, &mut mirror, 1, 2000.0);

    let bull_pt = 2000.0 * 0.6 / 1.3;
    let bull_tax = bull_pt * 0.3;
    let bull_ni = bull_pt - bull_tax;
    assert_mirror_number(&mirror, 0, 0, 1, 2000.0);
    assert_mirror_number(&mirror, 0, 1, 1, 1200.0);
    assert_mirror_number_tol(&mirror, 0, 2, 1, bull_pt, 0.01);
    assert_mirror_number_tol(&mirror, 0, 3, 1, bull_tax, 0.01);
    assert_mirror_number_tol(&mirror, 0, 4, 1, bull_ni, 0.01);

    // Base should be unaffected
    assert_mirror_number_tol(&mirror, 0, 2, 0, base_pt, 0.01);
    assert_mirror_number_tol(&mirror, 0, 3, 0, base_tax, 0.01);

    // Step 11-15: Build Bear scenario (column C, col=2)
    build_scenario(&mut core, &mut mirror, 2, 500.0);

    let bear_pt = 500.0 * 0.6 / 1.3;
    let bear_tax = bear_pt * 0.3;
    let bear_ni = bear_pt - bear_tax;
    assert_mirror_number(&mirror, 0, 0, 2, 500.0);
    assert_mirror_number(&mirror, 0, 1, 2, 300.0);
    assert_mirror_number_tol(&mirror, 0, 2, 2, bear_pt, 0.01);
    assert_mirror_number_tol(&mirror, 0, 3, 2, bear_tax, 0.01);
    assert_mirror_number_tol(&mirror, 0, 4, 2, bear_ni, 0.01);

    // All three scenarios should coexist independently
    assert_mirror_number_tol(&mirror, 0, 2, 0, base_pt, 0.01);
    assert_mirror_number_tol(&mirror, 0, 2, 1, bull_pt, 0.01);
    assert_mirror_number_tol(&mirror, 0, 2, 2, bear_pt, 0.01);
}

// ---------------------------------------------------------------------------
// Test 4: Debug broken formulas (10 steps)
//
// Init model with intentionally wrong formulas (parse errors, wrong refs).
// Fix them one by one. After each fix, assert the cell evaluates correctly.
// ---------------------------------------------------------------------------
#[test]
fn test_debug_broken_formulas_incremental() {
    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();

    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Step 1: Set A1 = 100 (constant, correct)
    set(&mut core, &mut mirror, 0, 0, 0, "100");
    assert_mirror_number(&mirror, 0, 0, 0, 100.0);

    // Step 2: Set A2 = "=A1*" (parse error — incomplete expression)
    set(&mut core, &mut mirror, 0, 1, 0, "=A1*");
    // Parse error produces an error value
    assert_mirror_is_any_error(&mirror, 0, 1, 0);

    // Step 3: Set A3 = "=A2+10" — depends on broken A2
    set(&mut core, &mut mirror, 0, 2, 0, "=A2+10");
    // A2 is an error, so A3 propagates error
    assert_mirror_is_any_error(&mirror, 0, 2, 0);

    // Step 4: Set A4 = "=NOSUCHFUNC(A1)" — unknown function
    set(&mut core, &mut mirror, 0, 3, 0, "=NOSUCHFUNC(A1)");
    assert_mirror_is_any_error(&mirror, 0, 3, 0);

    // Step 5: Set A5 = "=1/0" — #DIV/0!
    set(&mut core, &mut mirror, 0, 4, 0, "=1/0");
    assert_mirror_error(&mirror, 0, 4, 0, CellError::Div0);

    // Step 6: Fix A2 — correct formula "=A1*2" = 200
    set(&mut core, &mut mirror, 0, 1, 0, "=A1*2");
    assert_mirror_number(&mirror, 0, 1, 0, 200.0);

    // Step 7: A3 should now cascade-fix = A2+10 = 210
    assert_mirror_number(&mirror, 0, 2, 0, 210.0);

    // Step 8: Fix A4 — correct formula "=SUM(A1)" = 100
    set(&mut core, &mut mirror, 0, 3, 0, "=SUM(A1)");
    assert_mirror_number(&mirror, 0, 3, 0, 100.0);

    // Step 9: Fix A5 — correct formula "=A1/2" = 50
    set(&mut core, &mut mirror, 0, 4, 0, "=A1/2");
    assert_mirror_number(&mirror, 0, 4, 0, 50.0);

    // Step 10: Add A6 = "=A2+A3+A4+A5" = 200+210+100+50 = 560
    set(&mut core, &mut mirror, 0, 5, 0, "=A2+A3+A4+A5");
    assert_mirror_number(&mirror, 0, 5, 0, 560.0);

    // Verify entire column is clean
    assert_mirror_number(&mirror, 0, 0, 0, 100.0);
    assert_mirror_number(&mirror, 0, 1, 0, 200.0);
    assert_mirror_number(&mirror, 0, 2, 0, 210.0);
    assert_mirror_number(&mirror, 0, 3, 0, 100.0);
    assert_mirror_number(&mirror, 0, 4, 0, 50.0);
    assert_mirror_number(&mirror, 0, 5, 0, 560.0);
}

// ---------------------------------------------------------------------------
// Test 5: Full 60-step agent workflow
//
// Build → test → revise → finalize.
//
// Steps 1-15: Build income model with tax circularity incrementally.
// Steps 16-25: Modify assumptions (Revenue), verify closed-form after each.
// Steps 26-35: Add more cells (depreciation, interest), verify chain.
// Steps 36-45: Clear some cells, re-add with different formulas.
// Steps 46-60: Final adjustments. Assert final state.
//
// Income model (iterative):
//   A1 = Revenue, A2 = COGS = A1*margin, A3 = Gross = A1-A2
//   A4 = OpEx, A5 = Depreciation, A6 = EBIT = A3-A4-A5
//   A7 = Interest, A8 = PreTax = A6-A7-A9
//   A9 = Tax = A8*rate, A10 = NetIncome = A8-A9
//
// Circular: A8↔A9 (PreTax depends on Tax and vice versa)
//
// Closed form (non-circular EBIT = Gross-OpEx-Depr-Interest = G):
//   PreTax = G - Tax
//   Tax = PreTax * rate
//   → PreTax = G / (1+rate)
//   Tax = G * rate / (1+rate)
//   NI = PreTax - Tax = G * (1-rate) / (1+rate) = PreTax*(1-rate)
//     Wait: NI = PreTax - Tax = PreTax*(1-rate)
//     Actually NI = PreTax - Tax = G/(1+r) - G*r/(1+r) = G*(1-r)/(1+r)
// ---------------------------------------------------------------------------
#[test]
fn test_full_60_step_agent_workflow() {
    let mut core = ComputeCore::default();
    let mut mirror = CellMirror::default();

    let snapshot = build_iterative_snapshot(vec![("Model", 100, 26, vec![])], 200, 0.001);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let s = sid(0);
    let rate = 0.3;

    // === Pass 1: Build income model (Steps 1-15) ===

    // Step 1: Revenue A1 = 1000
    set(&mut core, &mut mirror, 0, 0, 0, "1000");
    assert_mirror_number(&mirror, 0, 0, 0, 1000.0);

    // Step 2: Margin B1 = 0.4
    set(&mut core, &mut mirror, 0, 0, 1, "0.4");
    assert_mirror_number(&mirror, 0, 0, 1, 0.4);

    // Step 3: Tax rate B2 = 0.3
    set(&mut core, &mut mirror, 0, 1, 1, "0.3");
    assert_mirror_number(&mirror, 0, 1, 1, 0.3);

    // Step 4: COGS A2 = "=A1*B1" = 1000*0.4 = 400
    set(&mut core, &mut mirror, 0, 1, 0, "=A1*B1");
    assert_mirror_number(&mirror, 0, 1, 0, 400.0);

    // Step 5: Gross A3 = "=A1-A2" = 600
    set(&mut core, &mut mirror, 0, 2, 0, "=A1-A2");
    assert_mirror_number(&mirror, 0, 2, 0, 600.0);

    // Step 6: OpEx A4 = 150
    set(&mut core, &mut mirror, 0, 3, 0, "150");
    assert_mirror_number(&mirror, 0, 3, 0, 150.0);

    // Step 7: Depreciation A5 = 50
    set(&mut core, &mut mirror, 0, 4, 0, "50");
    assert_mirror_number(&mirror, 0, 4, 0, 50.0);

    // Step 8: EBIT A6 = "=A3-A4-A5" = 600-150-50 = 400
    set(&mut core, &mut mirror, 0, 5, 0, "=A3-A4-A5");
    assert_mirror_number(&mirror, 0, 5, 0, 400.0);

    // Step 9: Interest A7 = 30
    set(&mut core, &mut mirror, 0, 6, 0, "30");
    assert_mirror_number(&mirror, 0, 6, 0, 30.0);

    // Step 10: PreTax A8 = "=A6-A7" = 400-30 = 370 (non-circular first)
    set(&mut core, &mut mirror, 0, 7, 0, "=A6-A7");
    assert_mirror_number(&mirror, 0, 7, 0, 370.0);

    // Step 11: Tax A9 = "=A8*B2" = 370*0.3 = 111 (non-circular)
    set(&mut core, &mut mirror, 0, 8, 0, "=A8*B2");
    assert_mirror_number(&mirror, 0, 8, 0, 111.0);

    // Step 12: NetIncome A10 = "=A8-A9" = 370-111 = 259
    set(&mut core, &mut mirror, 0, 9, 0, "=A8-A9");
    assert_mirror_number(&mirror, 0, 9, 0, 259.0);

    // Step 13: Now make circular — PreTax A8 = "=A6-A7-A9"
    let edits: Vec<(
        SheetId,
        CellId,
        u32,
        u32,
        compute_core::bridge_types::CellInput,
    )> = vec![(
        s,
        cid(0, 7, 0),
        7,
        0,
        compute_core::bridge_types::CellInput::Parse {
            text: "=A6-A7-A9".to_string(),
        },
    )];
    let _r = core.set_cells(&mut mirror, &edits, true).unwrap();

    // G = EBIT - Interest = 400 - 30 = 370
    // PreTax = G - Tax = 370 - Tax, Tax = PreTax * 0.3
    // 1.3*Tax = 370*0.3 = 111 → Tax = 111/1.3 = 85.384615...
    // PreTax = 370 - 85.384615... = 284.615384...
    // NI = PreTax - Tax = 199.230769...
    let g_val = 370.0;
    let expected_tax = g_val * rate / (1.0 + rate);
    let expected_pt = g_val / (1.0 + rate);
    let expected_ni = expected_pt - expected_tax;

    // Step 14: Assert circular values
    assert_mirror_number_tol(&mirror, 0, 7, 0, expected_pt, 0.01);
    assert_mirror_number_tol(&mirror, 0, 8, 0, expected_tax, 0.01);
    assert_mirror_number_tol(&mirror, 0, 9, 0, expected_ni, 0.01);

    // Step 15: Verify non-circular cells intact
    assert_mirror_number(&mirror, 0, 0, 0, 1000.0);
    assert_mirror_number(&mirror, 0, 1, 0, 400.0);
    assert_mirror_number(&mirror, 0, 2, 0, 600.0);
    assert_mirror_number(&mirror, 0, 3, 0, 150.0);
    assert_mirror_number(&mirror, 0, 4, 0, 50.0);
    assert_mirror_number(&mirror, 0, 5, 0, 400.0);
    assert_mirror_number(&mirror, 0, 6, 0, 30.0);

    // === Pass 2: Modify assumptions (Steps 16-25) ===

    // Vary Revenue from 1000 to 5500 in 10 steps of 500
    for step in 0u32..10 {
        let revenue = 1000.0 + (step as f64) * 500.0;
        set(
            &mut core,
            &mut mirror,
            0,
            0,
            0,
            &format!("{}", revenue as u32),
        );

        // Recalculated:
        //   COGS = Revenue * 0.4
        //   Gross = Revenue * 0.6
        //   EBIT = Gross - 150 - 50 = Revenue*0.6 - 200
        //   G = EBIT - 30 = Revenue*0.6 - 230
        //   PreTax = G / 1.3
        //   Tax = G * 0.3 / 1.3
        //   NI = G * 0.7 / 1.3
        let cogs = revenue * 0.4;
        let gross = revenue * 0.6;
        let ebit = gross - 200.0;
        let g = ebit - 30.0;
        let pt = g / 1.3;
        let tax = g * 0.3 / 1.3;
        let ni = pt - tax;

        assert_mirror_number(&mirror, 0, 0, 0, revenue);
        assert_mirror_number(&mirror, 0, 1, 0, cogs);
        assert_mirror_number(&mirror, 0, 2, 0, gross);
        assert_mirror_number(&mirror, 0, 5, 0, ebit);
        assert_mirror_number_tol(&mirror, 0, 7, 0, pt, 0.01);
        assert_mirror_number_tol(&mirror, 0, 8, 0, tax, 0.01);
        assert_mirror_number_tol(&mirror, 0, 9, 0, ni, 0.01);
    }

    // After loop, Revenue = 5500
    assert_mirror_number(&mirror, 0, 0, 0, 5500.0);

    // === Pass 3: Add more cells (Steps 26-35) ===

    // Step 26: Change depreciation to formula: A5 = "=A1*0.05" = 5500*0.05 = 275
    set(&mut core, &mut mirror, 0, 4, 0, "=A1*0.05");
    assert_mirror_number(&mirror, 0, 4, 0, 275.0);

    // Step 27: EBIT recalculates = Gross - OpEx - Depr = 3300-150-275 = 2875
    assert_mirror_number(&mirror, 0, 5, 0, 2875.0);

    // Step 28: G = EBIT - Interest = 2875-30 = 2845
    // PreTax = 2845/1.3, Tax = 2845*0.3/1.3, NI = 2845*0.7/1.3
    let g28 = 2845.0;
    assert_mirror_number_tol(&mirror, 0, 7, 0, g28 / 1.3, 0.01);
    assert_mirror_number_tol(&mirror, 0, 8, 0, g28 * 0.3 / 1.3, 0.01);
    assert_mirror_number_tol(&mirror, 0, 9, 0, g28 * 0.7 / 1.3, 0.01);

    // Step 29: Change Interest to formula: A7 = "=2000*0.04" = 80
    set(&mut core, &mut mirror, 0, 6, 0, "=2000*0.04");
    assert_mirror_number(&mirror, 0, 6, 0, 80.0);

    // Step 30: G = 2875-80 = 2795
    let g30 = 2795.0;
    assert_mirror_number_tol(&mirror, 0, 7, 0, g30 / 1.3, 0.01);
    assert_mirror_number_tol(&mirror, 0, 8, 0, g30 * 0.3 / 1.3, 0.01);

    // Step 31: Add RetainedEarnings A11 = "=A10" (same as NI)
    set(&mut core, &mut mirror, 0, 10, 0, "=A10");
    let ni30 = g30 * 0.7 / 1.3;
    assert_mirror_number_tol(&mirror, 0, 10, 0, ni30, 0.01);

    // Step 32: Add Dividend A12 = "=A11*0.4" (40% payout)
    set(&mut core, &mut mirror, 0, 11, 0, "=A11*0.4");
    assert_mirror_number_tol(&mirror, 0, 11, 0, ni30 * 0.4, 0.01);

    // Step 33: Add RetainedAfterDiv A13 = "=A11-A12" = NI*0.6
    set(&mut core, &mut mirror, 0, 12, 0, "=A11-A12");
    assert_mirror_number_tol(&mirror, 0, 12, 0, ni30 * 0.6, 0.01);

    // Step 34: Verify chain integrity
    assert_mirror_number(&mirror, 0, 0, 0, 5500.0);
    assert_mirror_number(&mirror, 0, 3, 0, 150.0);

    // Step 35: Change Revenue back to 1000 and verify full cascade
    set(&mut core, &mut mirror, 0, 0, 0, "1000");
    // COGS=400, Gross=600, Depr=1000*0.05=50, EBIT=600-150-50=400
    // Interest=80, G=400-80=320
    // PreTax=320/1.3, Tax=320*0.3/1.3, NI=320*0.7/1.3
    let g35 = 320.0;
    assert_mirror_number(&mirror, 0, 1, 0, 400.0);
    assert_mirror_number(&mirror, 0, 2, 0, 600.0);
    assert_mirror_number(&mirror, 0, 4, 0, 50.0);
    assert_mirror_number(&mirror, 0, 5, 0, 400.0);
    assert_mirror_number(&mirror, 0, 6, 0, 80.0);
    assert_mirror_number_tol(&mirror, 0, 7, 0, g35 / 1.3, 0.01);
    assert_mirror_number_tol(&mirror, 0, 8, 0, g35 * 0.3 / 1.3, 0.01);
    let ni35 = g35 * 0.7 / 1.3;
    assert_mirror_number_tol(&mirror, 0, 9, 0, ni35, 0.01);
    assert_mirror_number_tol(&mirror, 0, 10, 0, ni35, 0.01);
    assert_mirror_number_tol(&mirror, 0, 11, 0, ni35 * 0.4, 0.01);
    assert_mirror_number_tol(&mirror, 0, 12, 0, ni35 * 0.6, 0.01);

    // === Pass 4: Clear and rebuild (Steps 36-45) ===

    // Step 36: Clear Depreciation — set to constant 0
    set(&mut core, &mut mirror, 0, 4, 0, "0");
    assert_mirror_number(&mirror, 0, 4, 0, 0.0);

    // Step 37: EBIT = 600-150-0 = 450
    assert_mirror_number(&mirror, 0, 5, 0, 450.0);

    // Step 38: G = 450-80 = 370, verify cascade
    let g38 = 370.0;
    assert_mirror_number_tol(&mirror, 0, 7, 0, g38 / 1.3, 0.01);

    // Step 39: Clear Interest — set to 0
    set(&mut core, &mut mirror, 0, 6, 0, "0");
    assert_mirror_number(&mirror, 0, 6, 0, 0.0);

    // Step 40: G = EBIT - 0 = 450
    let g40 = 450.0;
    assert_mirror_number_tol(&mirror, 0, 7, 0, g40 / 1.3, 0.01);
    assert_mirror_number_tol(&mirror, 0, 8, 0, g40 * 0.3 / 1.3, 0.01);

    // Step 41: Re-add Depreciation = "=A1*0.1" = 100
    set(&mut core, &mut mirror, 0, 4, 0, "=A1*0.1");
    assert_mirror_number(&mirror, 0, 4, 0, 100.0);

    // Step 42: EBIT = 600-150-100 = 350
    assert_mirror_number(&mirror, 0, 5, 0, 350.0);

    // Step 43: G = 350-0 = 350
    let g43 = 350.0;
    assert_mirror_number_tol(&mirror, 0, 7, 0, g43 / 1.3, 0.01);

    // Step 44: Re-add Interest = "=3000*0.05" = 150
    set(&mut core, &mut mirror, 0, 6, 0, "=3000*0.05");
    assert_mirror_number(&mirror, 0, 6, 0, 150.0);

    // Step 45: G = 350-150 = 200
    let g45 = 200.0;
    assert_mirror_number_tol(&mirror, 0, 7, 0, g45 / 1.3, 0.01);
    assert_mirror_number_tol(&mirror, 0, 8, 0, g45 * 0.3 / 1.3, 0.01);
    let ni45 = g45 * 0.7 / 1.3;
    assert_mirror_number_tol(&mirror, 0, 9, 0, ni45, 0.01);

    // === Pass 5: Final adjustments (Steps 46-60) ===

    // Step 46: Change margin to 0.3 (B1)
    set(&mut core, &mut mirror, 0, 0, 1, "0.3");
    assert_mirror_number(&mirror, 0, 0, 1, 0.3);

    // Step 47: COGS = 1000*0.3 = 300
    assert_mirror_number(&mirror, 0, 1, 0, 300.0);

    // Step 48: Gross = 1000-300 = 700
    assert_mirror_number(&mirror, 0, 2, 0, 700.0);

    // Step 49: Depr = 1000*0.1 = 100 (unchanged), EBIT = 700-150-100 = 450
    assert_mirror_number(&mirror, 0, 5, 0, 450.0);

    // Step 50: G = 450-150 = 300
    let g50 = 300.0;
    assert_mirror_number_tol(&mirror, 0, 7, 0, g50 / 1.3, 0.01);

    // Step 51: Change tax rate to 0.25 (B2)
    set(&mut core, &mut mirror, 0, 1, 1, "0.25");
    assert_mirror_number(&mirror, 0, 1, 1, 0.25);

    // Step 52: G stays 300 (tax rate doesn't affect EBIT)
    // PreTax = 300/1.25 = 240, Tax = 300*0.25/1.25 = 60, NI = 240-60 = 180
    assert_mirror_number_tol(&mirror, 0, 7, 0, 300.0 / 1.25, 0.01);
    assert_mirror_number_tol(&mirror, 0, 8, 0, 300.0 * 0.25 / 1.25, 0.01);
    let ni52 = 300.0 / 1.25 - 300.0 * 0.25 / 1.25;
    assert_mirror_number_tol(&mirror, 0, 9, 0, ni52, 0.01);

    // Step 53: RetainedEarnings should cascade
    assert_mirror_number_tol(&mirror, 0, 10, 0, ni52, 0.01);

    // Step 54: Dividend = NI * 0.4
    assert_mirror_number_tol(&mirror, 0, 11, 0, ni52 * 0.4, 0.01);

    // Step 55: RetainedAfterDiv = NI * 0.6
    assert_mirror_number_tol(&mirror, 0, 12, 0, ni52 * 0.6, 0.01);

    // Step 56: Revenue bump to 3000
    set(&mut core, &mut mirror, 0, 0, 0, "3000");
    assert_mirror_number(&mirror, 0, 0, 0, 3000.0);

    // Step 57: COGS = 3000*0.3 = 900, Gross = 2100
    assert_mirror_number(&mirror, 0, 1, 0, 900.0);
    assert_mirror_number(&mirror, 0, 2, 0, 2100.0);

    // Step 58: Depr = 3000*0.1 = 300, EBIT = 2100-150-300 = 1650
    assert_mirror_number(&mirror, 0, 4, 0, 300.0);
    assert_mirror_number(&mirror, 0, 5, 0, 1650.0);

    // Step 59: G = 1650-150 = 1500, rate=0.25
    // PreTax = 1500/1.25 = 1200, Tax = 1500*0.25/1.25 = 300, NI = 900
    let g59 = 1500.0;
    assert_mirror_number_tol(&mirror, 0, 7, 0, g59 / 1.25, 0.01);
    assert_mirror_number_tol(&mirror, 0, 8, 0, g59 * 0.25 / 1.25, 0.01);
    let ni59 = g59 / 1.25 - g59 * 0.25 / 1.25; // 1200 - 300 = 900
    assert_mirror_number_tol(&mirror, 0, 9, 0, ni59, 0.01);

    // Step 60: Final state verification — every cell
    assert_mirror_number(&mirror, 0, 0, 0, 3000.0); // A1  Revenue
    assert_mirror_number(&mirror, 0, 0, 1, 0.3); // B1  Margin
    assert_mirror_number(&mirror, 0, 1, 1, 0.25); // B2  TaxRate
    assert_mirror_number(&mirror, 0, 1, 0, 900.0); // A2  COGS
    assert_mirror_number(&mirror, 0, 2, 0, 2100.0); // A3  Gross
    assert_mirror_number(&mirror, 0, 3, 0, 150.0); // A4  OpEx
    assert_mirror_number(&mirror, 0, 4, 0, 300.0); // A5  Depreciation
    assert_mirror_number(&mirror, 0, 5, 0, 1650.0); // A6  EBIT
    assert_mirror_number(&mirror, 0, 6, 0, 150.0); // A7  Interest
    assert_mirror_number_tol(&mirror, 0, 7, 0, 1200.0, 0.01); // A8  PreTax
    assert_mirror_number_tol(&mirror, 0, 8, 0, 300.0, 0.01); // A9  Tax
    assert_mirror_number_tol(&mirror, 0, 9, 0, 900.0, 0.01); // A10 NetIncome
    assert_mirror_number_tol(&mirror, 0, 10, 0, 900.0, 0.01); // A11 RetainedEarnings
    assert_mirror_number_tol(&mirror, 0, 11, 0, 360.0, 0.01); // A12 Dividend (900*0.4)
    assert_mirror_number_tol(&mirror, 0, 12, 0, 540.0, 0.01); // A13 RetainedAfterDiv (900*0.6)
}
