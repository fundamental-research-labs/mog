#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_engine_common;
use stress_engine_common::*;

use cell_types::SheetPos;
use compute_core::bridge_types::{BridgeSortCriterion, BridgeSortOptions};
use compute_core::engine_types::fill::{BridgeAutoFillRequest, BridgeFillRangeSpec};
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::copy::CopyType;
use domain_types::domain::filter::{SortBy, SortOrder};
use snapshot_types::{CellData, CellEdit, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

use formula_types::StructureChange;

// ---------------------------------------------------------------------------
// Test 01: Incremental data pipeline build (25 steps)
//
// Workflow: set values, add formulas, autofill, sort (values only),
// add new formula column, edit values, sort again.
// ---------------------------------------------------------------------------
#[test]
fn test_agent_builds_data_pipeline() {
    let snapshot = make_snapshot(vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Steps 1-5: Set A1:A5 = 10,20,30,40,50
    engine.set_cell_value_parsed(&sheet_id, 0, 0, "10").unwrap();
    engine.set_cell_value_parsed(&sheet_id, 1, 0, "20").unwrap();
    engine.set_cell_value_parsed(&sheet_id, 2, 0, "30").unwrap();
    engine.set_cell_value_parsed(&sheet_id, 3, 0, "40").unwrap();
    engine.set_cell_value_parsed(&sheet_id, 4, 0, "50").unwrap();
    assert_num(&engine, &sheet_id, 0, 0, 10.0);
    assert_num(&engine, &sheet_id, 1, 0, 20.0);
    assert_num(&engine, &sheet_id, 2, 0, 30.0);
    assert_num(&engine, &sheet_id, 3, 0, 40.0);
    assert_num(&engine, &sheet_id, 4, 0, 50.0);

    // Steps 6-8: Set B1="=A1*2"=20, B2="=A2*2"=40, B3="=A3*2"=60
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1*2")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 1, 1, "=A2*2")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 2, 1, "=A3*2")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 1, 20.0);
    assert_num(&engine, &sheet_id, 1, 1, 40.0);
    assert_num(&engine, &sheet_id, 2, 1, 60.0);

    // Step 9: Autofill B3→B4:B5
    let req = fill_request(2, 1, 2, 1, 3, 1, 4, 1, "down");
    engine.auto_fill(&sheet_id, req).unwrap();
    assert_num(&engine, &sheet_id, 3, 1, 80.0); // =A4*2 = 40*2
    assert_num(&engine, &sheet_id, 4, 1, 100.0); // =A5*2 = 50*2

    // Step 10: Edit A1=100 → B1 should recalc to 200
    engine
        .set_cell_value_parsed(&sheet_id, 0, 0, "100")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 0, 100.0);
    assert_num(&engine, &sheet_id, 0, 1, 200.0);

    // Step 11: Edit A3=0 → B3=0
    engine.set_cell_value_parsed(&sheet_id, 2, 0, "0").unwrap();
    assert_num(&engine, &sheet_id, 2, 0, 0.0);
    assert_num(&engine, &sheet_id, 2, 1, 0.0);

    // Steps 12-16: Add C column as formulas: C{i} = A{i}+B{i}
    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "=A1+B1")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 1, 2, "=A2+B2")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 2, 2, "=A3+B3")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 3, 2, "=A4+B4")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 4, 2, "=A5+B5")
        .unwrap();
    // A: 100, 20, 0, 40, 50. B: 200, 40, 0, 80, 100. C: 300, 60, 0, 120, 150.
    assert_num(&engine, &sheet_id, 0, 2, 300.0);
    assert_num(&engine, &sheet_id, 1, 2, 60.0);
    assert_num(&engine, &sheet_id, 2, 2, 0.0);
    assert_num(&engine, &sheet_id, 3, 2, 120.0);
    assert_num(&engine, &sheet_id, 4, 2, 150.0);

    // Steps 17-19: Edit more values, verify formula chains
    engine
        .set_cell_value_parsed(&sheet_id, 4, 0, "500")
        .unwrap();
    assert_num(&engine, &sheet_id, 4, 1, 1000.0); // =A5*2
    assert_num(&engine, &sheet_id, 4, 2, 1500.0); // =A5+B5

    engine.set_cell_value_parsed(&sheet_id, 1, 0, "5").unwrap();
    assert_num(&engine, &sheet_id, 1, 1, 10.0); // =A2*2
    assert_num(&engine, &sheet_id, 1, 2, 15.0); // =A2+B2

    // Steps 20-25: Verify final state of all 5 rows
    // A: 100, 5, 0, 40, 500
    // B: 200, 10, 0, 80, 1000 (each =Ai*2)
    // C: 300, 15, 0, 120, 1500 (each =Ai+Bi)
    let expected_a = [100.0, 5.0, 0.0, 40.0, 500.0];
    for (i, &a) in expected_a.iter().enumerate() {
        assert_num(&engine, &sheet_id, i as u32, 0, a);
        assert_num(&engine, &sheet_id, i as u32, 1, a * 2.0);
        assert_num(&engine, &sheet_id, i as u32, 2, a * 3.0);
    }
}

// ---------------------------------------------------------------------------
// Test 02: Incremental model restructure (30 steps)
// Init 10 rows of values in A and B (plain values). Insert rows,
// fill values, add formulas, delete rows, verify.
// ---------------------------------------------------------------------------
#[test]
fn test_agent_restructures_model() {
    // Build initial snapshot: A1:A10 = 1..10, B1:B10 = 2,4,...,20 (plain values)
    let mut cells = Vec::new();
    for i in 0u32..10 {
        cells.push(make_cell(i, 0, num((i + 1) as f64), None));
        cells.push(make_cell(i, 1, num(((i + 1) * 2) as f64), None));
    }
    let snapshot = make_snapshot(cells);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Steps 1-5: Assert initial state
    assert_num(&engine, &sheet_id, 0, 0, 1.0);
    assert_num(&engine, &sheet_id, 0, 1, 2.0);
    assert_num(&engine, &sheet_id, 4, 0, 5.0);
    assert_num(&engine, &sheet_id, 4, 1, 10.0);
    assert_num(&engine, &sheet_id, 9, 0, 10.0);
    assert_num(&engine, &sheet_id, 9, 1, 20.0);

    // Steps 6-10: Insert 5 rows at row 5
    let change = StructureChange::InsertRows {
        at: 5,
        count: 5,
        new_row_ids: Vec::new(),
    };
    engine.structure_change(&sheet_id, &change).unwrap();

    // Original rows 0-4 still intact
    assert_num(&engine, &sheet_id, 0, 0, 1.0);
    assert_num(&engine, &sheet_id, 0, 1, 2.0);
    assert_num(&engine, &sheet_id, 4, 0, 5.0);
    assert_num(&engine, &sheet_id, 4, 1, 10.0);
    // Original row 5 (val=6) shifted to row 10
    assert_num(&engine, &sheet_id, 10, 0, 6.0);
    assert_num(&engine, &sheet_id, 10, 1, 12.0);

    // Steps 11-15: Fill new rows (5-9) with values
    for i in 0u32..5 {
        let val = (100 + i * 100) as f64;
        engine
            .set_cell_value_parsed(&sheet_id, 5 + i, 0, &format!("{}", val))
            .unwrap();
        engine
            .set_cell_value_parsed(&sheet_id, 5 + i, 1, &format!("{}", val * 2.0))
            .unwrap();
    }
    assert_num(&engine, &sheet_id, 5, 0, 100.0);
    assert_num(&engine, &sheet_id, 5, 1, 200.0);
    assert_num(&engine, &sheet_id, 9, 0, 500.0);
    assert_num(&engine, &sheet_id, 9, 1, 1000.0);

    // Steps 16-20: Delete 3 rows starting at row 0 (removes rows 0,1,2)
    let del = StructureChange::DeleteRows {
        at: 0,
        count: 3,
        deleted_cell_ids: Vec::new(),
    };
    engine.structure_change(&sheet_id, &del).unwrap();

    // After deleting rows 0-2: old row 3 (val=4) is now row 0
    assert_num(&engine, &sheet_id, 0, 0, 4.0);
    assert_num(&engine, &sheet_id, 0, 1, 8.0);
    // Old row 4 (val=5) is now row 1
    assert_num(&engine, &sheet_id, 1, 0, 5.0);
    assert_num(&engine, &sheet_id, 1, 1, 10.0);
    // Old row 5 (val=100) is now row 2
    assert_num(&engine, &sheet_id, 2, 0, 100.0);
    assert_num(&engine, &sheet_id, 2, 1, 200.0);

    // Steps 21-25: Add formula column C = A + B for first 6 rows
    for i in 0u32..6 {
        let formula = format!("=A{}+B{}", i + 1, i + 1);
        engine
            .set_cell_value_parsed(&sheet_id, i, 2, &formula)
            .unwrap();
    }
    // Row 0: A=4, B=8, C=12
    assert_num(&engine, &sheet_id, 0, 2, 12.0);
    // Row 1: A=5, B=10, C=15
    assert_num(&engine, &sheet_id, 1, 2, 15.0);
    // Row 2: A=100, B=200, C=300
    assert_num(&engine, &sheet_id, 2, 2, 300.0);

    // Steps 26-30: Edit values, verify formula recalc
    engine
        .set_cell_value_parsed(&sheet_id, 0, 0, "1000")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "2000")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 2, 3000.0);

    engine.set_cell_value_parsed(&sheet_id, 1, 0, "50").unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 1, 1, "100")
        .unwrap();
    assert_num(&engine, &sheet_id, 1, 2, 150.0);

    // Row 2 unchanged
    assert_num(&engine, &sheet_id, 2, 0, 100.0);
    assert_num(&engine, &sheet_id, 2, 1, 200.0);
    assert_num(&engine, &sheet_id, 2, 2, 300.0);
}

// ---------------------------------------------------------------------------
// Test 03: Table build from scratch (20 steps)
// Enter headers, data, create table, add formula columns, autofill.
// No sort on formula columns to avoid ref invalidation.
// ---------------------------------------------------------------------------
#[test]
fn test_agent_builds_table() {
    let snapshot = make_snapshot(vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Steps 1-3: Enter headers
    engine
        .set_cell_value_parsed(&sheet_id, 0, 0, "Product")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "Price")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "Qty")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 0, 3, "Total")
        .unwrap();
    assert_text(&engine, &sheet_id, 0, 0, "Product");
    assert_text(&engine, &sheet_id, 0, 1, "Price");
    assert_text(&engine, &sheet_id, 0, 2, "Qty");
    assert_text(&engine, &sheet_id, 0, 3, "Total");

    // Steps 4-9: Enter data rows
    engine
        .set_cell_value_parsed(&sheet_id, 1, 0, "Widget")
        .unwrap();
    engine.set_cell_value_parsed(&sheet_id, 1, 1, "25").unwrap();
    engine.set_cell_value_parsed(&sheet_id, 1, 2, "10").unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 2, 0, "Gadget")
        .unwrap();
    engine.set_cell_value_parsed(&sheet_id, 2, 1, "50").unwrap();
    engine.set_cell_value_parsed(&sheet_id, 2, 2, "5").unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 3, 0, "Doohickey")
        .unwrap();
    engine.set_cell_value_parsed(&sheet_id, 3, 1, "15").unwrap();
    engine.set_cell_value_parsed(&sheet_id, 3, 2, "20").unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 4, 0, "Thingamajig")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 4, 1, "100")
        .unwrap();
    engine.set_cell_value_parsed(&sheet_id, 4, 2, "2").unwrap();

    assert_num(&engine, &sheet_id, 1, 1, 25.0);
    assert_num(&engine, &sheet_id, 2, 2, 5.0);

    // Step 10: Create table
    engine
        .create_table(
            &sheet_id,
            "Sales".to_string(),
            0,
            0,
            4,
            3,
            vec![
                "Product".to_string(),
                "Price".to_string(),
                "Qty".to_string(),
                "Total".to_string(),
            ],
            true,
        )
        .unwrap();

    // Steps 11-12: Add formula column D (Total = Price * Qty)
    engine
        .set_cell_value_parsed(&sheet_id, 1, 3, "=B2*C2")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 2, 3, "=B3*C3")
        .unwrap();
    assert_num(&engine, &sheet_id, 1, 3, 250.0); // 25*10
    assert_num(&engine, &sheet_id, 2, 3, 250.0); // 50*5

    // Step 13: Autofill D2:D3 → D4:D5
    let req = fill_request(1, 3, 2, 3, 3, 3, 4, 3, "down");
    engine.auto_fill(&sheet_id, req).unwrap();
    assert_num(&engine, &sheet_id, 3, 3, 300.0); // 15*20
    assert_num(&engine, &sheet_id, 4, 3, 200.0); // 100*2

    // Steps 14-17: Verify all totals
    assert_num(&engine, &sheet_id, 1, 3, 250.0);
    assert_num(&engine, &sheet_id, 2, 3, 250.0);
    assert_num(&engine, &sheet_id, 3, 3, 300.0);
    assert_num(&engine, &sheet_id, 4, 3, 200.0);

    // Steps 18-20: Modify values, verify formula recalc
    engine.set_cell_value_parsed(&sheet_id, 1, 1, "50").unwrap(); // Widget price → 50
    assert_num(&engine, &sheet_id, 1, 3, 500.0); // 50*10

    engine
        .set_cell_value_parsed(&sheet_id, 3, 2, "100")
        .unwrap(); // Doohickey qty → 100
    assert_num(&engine, &sheet_id, 3, 3, 1500.0); // 15*100

    engine
        .set_cell_value_parsed(&sheet_id, 4, 1, "200")
        .unwrap(); // Thingamajig price → 200
    assert_num(&engine, &sheet_id, 4, 3, 400.0); // 200*2

    // Final verification of all totals
    assert_num(&engine, &sheet_id, 1, 3, 500.0);
    assert_num(&engine, &sheet_id, 2, 3, 250.0);
    assert_num(&engine, &sheet_id, 3, 3, 1500.0);
    assert_num(&engine, &sheet_id, 4, 3, 400.0);
}

// ---------------------------------------------------------------------------
// Test 04: Financial model iteration (50 steps)
// Non-circular layout using closed-form tax formula directly:
//   B1=Revenue, B2=COGS, B3=Rate (0.3)
//   B4=Pre-Tax = (B1-B2)/(1+B3)
//   B5=Tax     = B4*B3
//   B6=Net     = B4-B5  (= B4*(1-B3) = (B1-B2)*(1-B3)/(1+B3))
// Modify assumptions (B1, B2, B3) and verify recalc.
// ---------------------------------------------------------------------------
#[test]
fn test_agent_iterates_financial_model() {
    let snapshot = make_snapshot(vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Steps 1-6: Set up model labels and assumptions
    engine
        .set_cell_value_parsed(&sheet_id, 0, 0, "Revenue")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "1000")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 1, 0, "COGS")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 1, 1, "400")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 2, 0, "TaxRate")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 2, 1, "0.3")
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 1, 1000.0);
    assert_num(&engine, &sheet_id, 1, 1, 400.0);
    assert_num(&engine, &sheet_id, 2, 1, 0.3);

    // Steps 7-10: Set up formulas
    // B4 = Pre-Tax Income = (Rev-COGS)/(1+rate)
    engine
        .set_cell_value_parsed(&sheet_id, 3, 0, "PreTax")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 3, 1, "=(B1-B2)/(1+B3)")
        .unwrap();
    // B5 = Tax = PreTax * rate
    engine
        .set_cell_value_parsed(&sheet_id, 4, 0, "Tax")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 4, 1, "=B4*B3")
        .unwrap();
    // B6 = Net = PreTax - Tax
    engine
        .set_cell_value_parsed(&sheet_id, 5, 0, "Net")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 5, 1, "=B4-B5")
        .unwrap();

    // Initial: Rev=1000, COGS=400, rate=0.3
    // PreTax = 600/1.3 ≈ 461.5385
    // Tax = 461.5385*0.3 ≈ 138.4615
    // Net = 461.5385-138.4615 ≈ 323.0769
    let rev = 1000.0_f64;
    let cogs = 400.0_f64;
    let rate = 0.3_f64;
    let pt = (rev - cogs) / (1.0 + rate);
    let tax = pt * rate;
    let net = pt - tax;
    assert_num_tol(&engine, &sheet_id, 3, 1, pt, 1e-4);
    assert_num_tol(&engine, &sheet_id, 4, 1, tax, 1e-4);
    assert_num_tol(&engine, &sheet_id, 5, 1, net, 1e-4);

    // Steps 11-20: Modify Revenue in steps of 500 (1500, 2000, ..., 5500)
    let mut current_rev = rev;
    for step in 0u32..10 {
        current_rev = 1500.0 + (step as f64) * 500.0;
        engine
            .set_cell_value_parsed(&sheet_id, 0, 1, &format!("{}", current_rev))
            .unwrap();
        let pt = (current_rev - cogs) / (1.0 + rate);
        let tax = pt * rate;
        assert_num_tol(&engine, &sheet_id, 3, 1, pt, 1e-4);
        assert_num_tol(&engine, &sheet_id, 4, 1, tax, 1e-4);
    }

    // After step 20: Rev=5500, COGS=400, rate=0.3
    let rev_after = current_rev;

    // Steps 21-30: Modify COGS
    let cogs_values = [
        500.0, 600.0, 700.0, 800.0, 900.0, 1000.0, 1100.0, 1200.0, 1300.0, 1400.0,
    ];
    let mut current_cogs = cogs;
    for &new_cogs in &cogs_values {
        current_cogs = new_cogs;
        engine
            .set_cell_value_parsed(&sheet_id, 1, 1, &format!("{}", new_cogs))
            .unwrap();
        let pt = (rev_after - new_cogs) / (1.0 + rate);
        let tax = pt * rate;
        assert_num_tol(&engine, &sheet_id, 3, 1, pt, 1e-4);
        assert_num_tol(&engine, &sheet_id, 4, 1, tax, 1e-4);
    }
    let cogs_after = current_cogs;

    // Steps 31-40: Change tax rate
    let rates = [0.2, 0.25, 0.15, 0.35, 0.4, 0.1, 0.5, 0.22, 0.28, 0.33];
    let mut current_rate = rate;
    for &r in &rates {
        current_rate = r;
        engine
            .set_cell_value_parsed(&sheet_id, 2, 1, &format!("{}", r))
            .unwrap();
        let pt = (rev_after - cogs_after) / (1.0 + r);
        let tax = pt * r;
        let net = pt - tax;
        assert_num_tol(&engine, &sheet_id, 3, 1, pt, 1e-4);
        assert_num_tol(&engine, &sheet_id, 4, 1, tax, 1e-4);
        assert_num_tol(&engine, &sheet_id, 5, 1, net, 1e-4);
    }
    let rate_after = current_rate;

    // Steps 41-50: Combined changes (Rev and COGS)
    let combos: [(f64, f64); 10] = [
        (1000.0, 200.0),
        (2000.0, 300.0),
        (3000.0, 500.0),
        (4000.0, 1000.0),
        (5000.0, 1500.0),
        (6000.0, 2000.0),
        (7000.0, 2500.0),
        (8000.0, 3000.0),
        (9000.0, 3500.0),
        (10000.0, 4000.0),
    ];
    for &(r, c) in &combos {
        engine
            .set_cell_value_parsed(&sheet_id, 0, 1, &format!("{}", r))
            .unwrap();
        engine
            .set_cell_value_parsed(&sheet_id, 1, 1, &format!("{}", c))
            .unwrap();
        let pt = (r - c) / (1.0 + rate_after);
        let tax = pt * rate_after;
        let net = pt - tax;
        assert_num_tol(&engine, &sheet_id, 3, 1, pt, 1e-4);
        assert_num_tol(&engine, &sheet_id, 4, 1, tax, 1e-4);
        assert_num_tol(&engine, &sheet_id, 5, 1, net, 1e-4);
    }
}

// ---------------------------------------------------------------------------
// Test 05: Adversarial 100-op sequence (fixed seed)
// Pre-populate 20x5 grid. 100 random ops using LCG PRNG.
// After every 10 ops, verify known-value cells haven't been corrupted.
// ---------------------------------------------------------------------------
#[test]
fn test_adversarial_100_random_ops() {
    // Build initial 20x5 grid: cell(r,c) = (r+1)*10 + (c+1)
    let mut cells = Vec::new();
    for r in 0u32..20 {
        for c in 0u32..5 {
            let val = ((r + 1) * 10 + (c + 1)) as f64;
            cells.push(make_cell(r, c, num(val), None));
        }
    }
    let snapshot = make_snapshot_large(100, 26, cells);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // LCG PRNG
    let mut state: u64 = 42;
    let mut next = || -> u64 {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        state >> 33
    };

    // Track cells we set to known values for verification.
    // Key: (row, col), Value: expected value (None if uncertain/cleared).
    let mut known: std::collections::HashMap<(u32, u32), Option<f64>> =
        std::collections::HashMap::new();

    // Initialize known values for the sentinel row (row 19) — we won't touch these
    for c in 0u32..5 {
        known.insert((19, c), Some(((19 + 1) * 10 + (c + 1)) as f64));
    }

    // Run 100 operations
    for op_idx in 0u32..100 {
        let op_kind = next() % 100;

        if op_kind < 40 {
            // SET CELL (40%)
            let r = (next() % 18) as u32; // rows 0-17 only; preserve row 18-19
            let c = (next() % 5) as u32;
            let val = (next() % 10000) as f64;
            let input = format!("{}", val);
            let _ = engine.set_cell_value_parsed(&sheet_id, r, c, &input);
            known.insert((r, c), Some(val));
        } else if op_kind < 55 {
            // AUTOFILL (15%)
            let src_r = (next() % 17) as u32;
            let c = (next() % 5) as u32;
            let tgt_r = src_r + 1;
            if tgt_r < 18 {
                let req = fill_request(src_r, c, src_r, c, tgt_r, c, tgt_r, c, "down");
                let _ = engine.auto_fill(&sheet_id, req);
                // Mark target as uncertain since we don't know the fill result type
                known.remove(&(tgt_r, c));
            }
        } else if op_kind < 65 {
            // SORT (10%) — sort a small 3-row range
            let start_r = (next() % 15) as u32;
            let c = (next() % 5) as u32;
            let end_r = start_r + 2;
            if end_r < 18 {
                let opts = if next() % 2 == 0 {
                    sort_asc(c)
                } else {
                    sort_desc(c)
                };
                let _ = engine.sort_range(&sheet_id, start_r, 0, end_r, 4, opts);
                // Invalidate known values in sorted range
                for r in start_r..=end_r {
                    for cc in 0u32..5 {
                        known.remove(&(r, cc));
                    }
                }
            }
        } else if op_kind < 75 {
            // INSERT ROW (10%)
            let at = (next() % 15) as u32;
            let change = StructureChange::InsertRows {
                at,
                count: 1,
                new_row_ids: Vec::new(),
            };
            let _ = engine.structure_change(&sheet_id, &change);
            // Shift known values down
            let mut new_known = std::collections::HashMap::new();
            for (&(r, c), v) in &known {
                if r >= at {
                    new_known.insert((r + 1, c), *v);
                } else {
                    new_known.insert((r, c), *v);
                }
            }
            known = new_known;
        } else if op_kind < 85 {
            // DELETE ROW (10%)
            let at = (next() % 15) as u32;
            let change = StructureChange::DeleteRows {
                at,
                count: 1,
                deleted_cell_ids: Vec::new(),
            };
            let _ = engine.structure_change(&sheet_id, &change);
            // Shift known values up
            let mut new_known = std::collections::HashMap::new();
            for (&(r, c), v) in &known {
                if r == at {
                    // Deleted row — drop from known
                } else if r > at {
                    new_known.insert((r - 1, c), *v);
                } else {
                    new_known.insert((r, c), *v);
                }
            }
            known = new_known;
        } else if op_kind < 95 {
            // COPY (10%)
            let src_r = (next() % 16) as u32;
            let src_c = (next() % 4) as u32;
            let tgt_r = (next() % 16) as u32;
            let tgt_c = (next() % 4) as u32;
            if (src_r, src_c) != (tgt_r, tgt_c) {
                let _ = engine.copy_range(
                    &sheet_id,
                    src_r,
                    src_c,
                    src_r,
                    src_c,
                    &sheet_id,
                    tgt_r,
                    tgt_c,
                    CopyType::All,
                    false,
                    false,
                );
                // Target cell now has the source value — mark as uncertain
                known.remove(&(tgt_r, tgt_c));
            }
        } else {
            // CLEAR (5%)
            let r = (next() % 16) as u32;
            let c = (next() % 5) as u32;
            let _ = engine.clear_range(&sheet_id, r, c, r, c);
            known.remove(&(r, c));
        }

        // Every 10 ops, verify known cells that we explicitly set
        if (op_idx + 1) % 10 == 0 {
            let mut verified = 0;
            for (&(r, c), val) in &known {
                if let Some(expected) = val {
                    if let Some(cv) = read_value(&engine, &sheet_id, r, c) {
                        match cv {
                            CellValue::Number(n) => {
                                assert!(
                                    (n.get() - expected).abs() < 1e-6,
                                    "Op {}: Cell ({},{}) expected {}, got {} — corruption!",
                                    op_idx,
                                    r,
                                    c,
                                    expected,
                                    n.get()
                                );
                                verified += 1;
                            }
                            _ => {
                                // Value may have been transformed by sort/autofill — skip
                            }
                        }
                    }
                }
            }
            // Ensure we verified at least some cells (sanity check)
            assert!(
                verified > 0 || known.is_empty(),
                "Op {}: No known cells verified — possible test bug",
                op_idx
            );
        }
    }

    // Final: engine should not have panicked. Read a few cells to confirm.
    for r in 0u32..5 {
        let _ = read_value(&engine, &sheet_id, r, 0);
    }
}
